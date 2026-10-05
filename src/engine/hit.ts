// Geometric hit-testing and snapping. Pure: takes a doc and a context, returns targets.
import { CONFIG } from '../config';
import { toWorld, toUV, cellOf, nodeUV, windowOffsets, snapGrid } from './lattice';
import { apply, cellMatrix, compose, orbit } from './transform';
import { getPath, pathNodes, pathWorld, pathCpsWorld, boundsWorld, getElement, nodeWorld } from './paths';
import { faceAt, fillOfFace } from './regions';
import type { Doc, XY, Lattice, Matrix, Copy, CopyInfo, Cell, Face, HitTarget, Layer, Tool, Selection, Box, BoxHandle, Path, LineTarget } from '../types';

export type HitContext = {
  layer: Layer; tool: Tool; selection: Selection; pen: { pathId: string } | null;
  zoom: number; hitScale: number; copies: CopyInfo[]; cloneMatrices: Map<string, (Matrix | null)[]>; faces: Face[];
};
export type Anchor = { x: number; y: number; pointId: string; cell: Cell; bindingId?: string; power?: number; via?: Copy };

export function copyMatrixOf(copy: Copy, lat: Lattice, cm: Map<string, (Matrix | null)[]>): Matrix {
  const Mo = cellMatrix(copy.cell, lat);
  if (!copy.bindingId) return Mo;
  const M = (cm.get(copy.bindingId) ?? [])[copy.power - 1];
  return M ? compose(Mo, M) : Mo;
}

// Spec §1: the original is the path as stored, in the tile: no clone and cell (0, 0). A repeat elsewhere is not.
export const isOriginal = (c: Copy): boolean => !c.bindingId && c.cell.c === 0 && c.cell.r === 0;

const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: XY, b: XY): XY => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function segmentDistance(a: XY, b: XY, cp: XY | null, p: XY): number {
  if (!cp) {
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
    return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
  }
  let best = Infinity, prev = a;
  for (let i = 1; i <= 16; i++) {
    const t = i / 16, u = 1 - t;
    const q = { x: u * u * a.x + 2 * u * t * cp.x + t * t * b.x, y: u * u * a.y + 2 * u * t * cp.y + t * t * b.y };
    best = Math.min(best, segmentDistance(prev, q, null, p));
    prev = q;
  }
  return best;
}

// Which points are drawn (and therefore hittable): all while drawing; else the selected path's, the selected points.
export function visiblePointIds(doc: Doc, ctx: HitContext): Set<string> | null {
  if (ctx.pen || ctx.tool === 'freehand' || ctx.tool === 'pen') return null;
  const s = ctx.selection, set = new Set<string>();
  if (s && s.kind === 'points') for (const id of s.ids) if (!s.copies?.[id]) set.add(id);
  return set;
}

// H8: paths with an instance (original, repeat or clone) within `radius` world units of `w`, so Pen/Freehand can draw
// a path's nodes only when it is worth looking at. Reads the already-built target lines (the cached `snapTargets`,
// which carry every copy's line as a `LineTarget` with `source.pathId`) rather than rebuilding geometry, so this is
// just a distance pass, cheap enough to run on every cursor move. A path drops out as soon as one line is near enough.
export function pathsNear(lines: readonly LineTarget[], w: XY, radius: number): Set<string> {
  const out = new Set<string>();
  for (const t of lines) {
    if (!t.source || out.has(t.source.pathId)) continue;
    if (segmentDistance(t.a, t.b, t.cp, w) <= radius) out.add(t.source.pathId);
  }
  return out;
}

// World point mapped into the base cell (for fills and faces).
export function seedOf(world: XY, lat: Lattice): XY {
  return toWorld(cellOf(toUV(world, lat)).local, lat);
}

export function hitTest(doc: Doc, ctx: HitContext, w: XY): HitTarget | null {
  const z = ctx.zoom, s = ctx.hitScale, lat = doc.lattice;
  const rPoint = ((CONFIG.HANDLE_PX + 2) * s) / z, rSeg = ((CONFIG.HIT_WIDTH / 2) * s) / z;

  if (ctx.layer === 'construction') {
    const selId = ctx.selection && ctx.selection.kind === 'element' ? ctx.selection.id : null;
    const sel = selId ? getElement(doc, selId) : null;
    if (sel && sel.kind === 'mirror') {
      const c = toWorld(sel, lat), d = toWorld({ u: sel.du, v: sel.dv }, lat), L = Math.hypot(d.x, d.y) || 1;
      const R = CONFIG.ELEMENT_ROT_OFFSET / z, knob = { x: c.x + (R * d.x) / L, y: c.y + (R * d.y) / L };
      if (dist(w, knob) <= rPoint) return { kind: 'elrot', elementId: sel.id };
    }
    if (sel && sel.kind === 'translate' && dist(w, toWorld(sel, lat)) <= rPoint) return { kind: 'eltip', elementId: sel.id };
    for (const e of [...doc.elements].reverse()) {
      if (e.kind === 'rotate') { if (dist(w, toWorld(e, lat)) <= rPoint + 3 / z) return { kind: 'element', elementId: e.id }; }
      else if (e.kind === 'mirror') {
        const c = toWorld(e, lat), d = toWorld({ u: e.du, v: e.dv }, lat), L = Math.hypot(d.x, d.y) || 1;
        if (dist(w, c) <= rPoint) return { kind: 'element', elementId: e.id };
        const perp = Math.abs((w.x - c.x) * d.y - (w.y - c.y) * d.x) / L;
        if (perp <= rSeg) return { kind: 'element', elementId: e.id };
      } else {
        const tip = toWorld(e, lat);
        if (dist(w, tip) <= rPoint) return { kind: 'eltip', elementId: e.id };
        if (segmentDistance({ x: 0, y: 0 }, tip, null, w) <= rSeg) return { kind: 'eltip', elementId: e.id };
      }
    }
    if (dist(w, { x: lat.ax, y: lat.ay }) <= rPoint) return { kind: 'lat', which: 'a' };
    if (dist(w, { x: lat.bx, y: lat.by }) <= rPoint) return { kind: 'lat', which: 'b' };
    return null;
  }

  const sel = ctx.selection;
  const selPath = sel && sel.kind === 'path' ? getPath(doc, sel.id) : null;
  const selM = sel && sel.kind === 'path' ? copyMatrixOf(sel.copy, lat, ctx.cloneMatrices) : null;

  // S2/S6: the selected instance's own nodes, tested first so a node beats a coincident box handle.
  if (ctx.tool === 'select' && selPath && selM && sel && sel.kind === 'path') {
    const nodes = pathNodes(selPath), Pw = pathWorld(doc, selPath).map((q) => apply(selM, q)), k = sel.copy.cell;
    for (let i = 0; i < nodes.length; i++) {
      if (dist(w, Pw[i]) > rPoint) continue;
      const n = nodes[i];
      if (sel.copy.bindingId) { if (!n.via) return { kind: 'canchor', pathId: selPath.id, pointId: n.pointId, cell: n.cell, copy: sel.copy }; continue; }
      return n.via ? { kind: 'point', pointId: n.pointId, cell: n.cell, via: { ...n.via, cell: { c: n.via.cell.c + k.c, r: n.via.cell.r + k.r } } }
        : { kind: 'point', pointId: n.pointId, cell: { c: n.cell.c + k.c, r: n.cell.r + k.r } };
    }
  }
  if (ctx.tool === 'select' && selPath && selM && sel && sel.kind === 'path') {
    const box = boundsWorld(doc, selPath, selM);
    const hs = bboxHandles(box);
    for (let i = 0; i < hs.length; i++) if (dist(w, hs[i]) <= rPoint) return { kind: 'bbox', h: i };
    // E6a: just outside a corner handle (outside the box, within BBOX_ROT_ZONE_PX beyond its hit radius) rotates, for the
    // original only. Like a box handle it beats whatever lies beneath.
    const inBox = w.x >= box.x0 && w.x <= box.x1 && w.y >= box.y0 && w.y <= box.y1;
    if (isOriginal(sel.copy) && !inBox) {
      let best = -1, bd = rPoint + (CONFIG.BBOX_ROT_ZONE_PX * s) / z;
      for (let i = 0; i < 4; i++) { const dd = dist(w, hs[i]); if (dd <= bd) { bd = dd; best = i; } }
      if (best >= 0) return { kind: 'bboxrot', h: best };
    }
  }
  if (ctx.tool === 'select' && selPath && selM && sel && sel.kind === 'path') {
    const Pw = pathWorld(doc, selPath).map((p) => apply(selM, p)), C = pathCpsWorld(doc, selPath).map((c) => c && apply(selM, c));
    for (let j = 0; j < selPath.segments.length; j++) {
      const h = C[j] ?? mid(Pw[j], Pw[j + 1]);
      if (dist(w, h) <= rPoint) return { kind: 'diamond', pathId: selPath.id, j, copy: sel.copy };
    }
  }
  if (ctx.tool !== 'fill') {
    const vis = visiblePointIds(doc, ctx);
    let best: HitTarget | null = null, bd = rPoint;
    for (const cell of windowOffsets()) for (const pt of doc.points) {
      if (vis && !vis.has(pt.id)) continue;
      const d = dist(w, toWorld(nodeUV(pt, cell), lat));
      if (d < bd) { bd = d; best = { kind: 'point', pointId: pt.id, cell }; }
    }
    if (sel && sel.kind === 'points' && sel.copies) for (const [id, copy] of Object.entries(sel.copies)) {
      const pt = doc.points.find((q) => q.id === id);
      if (!pt) continue;
      const M = copyMatrixOf(copy, lat, ctx.cloneMatrices), at = apply(M, toWorld(pt, lat)), dd = dist(w, at);
      if (dd < bd) { bd = dd; best = { kind: 'point', pointId: id, cell: { c: 0, r: 0 }, via: copy }; }
    }
    // Via nodes of the pen path and the selected path sit on a clone; hit them as points with their via.
    const penPath = ctx.pen ? getPath(doc, ctx.pen.pathId) : null;
    for (const p of [penPath]) if (p) for (const n of pathNodes(p)) {
      if (!n.via) continue;
      const d = dist(w, nodeWorld(doc, n));
      if (d < bd) { bd = d; best = { kind: 'point', pointId: n.pointId, cell: n.cell, via: n.via }; }
    }
    if (best) return best;
  }
  if (ctx.tool === 'select' || ctx.tool === 'pen') {
    const anchorsOf = (p: Path, copy: Copy, M: Matrix): HitTarget | null => {
      const Pw = pathWorld(doc, p).map((q) => apply(M, q)), nodes = pathNodes(p);
      for (let i = 0; i < nodes.length; i++) if (!nodes[i].via && dist(w, Pw[i]) <= rPoint) return { kind: 'canchor', pathId: p.id, pointId: nodes[i].pointId, cell: nodes[i].cell, copy };   // a via node's image is a copy of a copy: not an anchor
      return null;
    };
    if (ctx.tool === 'pen') {
      for (const ci of ctx.copies) { if (!ci.copy.bindingId) continue; const p = getPath(doc, ci.pathId); const t = p && anchorsOf(p, ci.copy, ci.M); if (t) return t; }
    }
  }
  if (ctx.tool === 'select' || ctx.tool === 'pen') {
    let best: HitTarget | null = null, bd = rSeg;
    for (const ci of ctx.copies) {
      if (ctx.tool === 'pen' && ctx.pen && ci.pathId === ctx.pen.pathId) continue;   // the path in progress is not a join target
      const p = getPath(doc, ci.pathId);
      if (!p) continue;
      const Pw = pathWorld(doc, p).map((q) => apply(ci.M, q)), C = pathCpsWorld(doc, p).map((c) => c && apply(ci.M, c));
      for (let j = 0; j < p.segments.length; j++) {
        const d = segmentDistance(Pw[j], Pw[j + 1], C[j], w);
        if (d < bd) { bd = d; best = { kind: 'segment', pathId: p.id, j, copy: ci.copy }; }
      }
    }
    if (best) return best;
  }
  if (ctx.tool === 'select' || ctx.tool === 'fill') {
    const face = faceAt(ctx.faces, seedOf(w, lat));
    if (face) {
      const fill = fillOfFace(doc.fills, ctx.faces, face, lat);
      if (fill) return { kind: 'fill', fillId: fill.id };
      if (ctx.tool === 'fill') return { kind: 'face', face };
    }
  }
  return null;
}

// Every point copy in the 3×3 window, and every clone point (with its binding and power).
export function anchorsWorld(doc: Doc, skip?: (a: Anchor) => boolean, cap = CONFIG.ORBIT_CAP): Anchor[] {
  const out: Anchor[] = [], lat = doc.lattice;
  const clones = doc.bindings.map((b) => ({ b, path: getPath(doc, b.pathId), ms: orbit(b.groups, doc.elements, lat, cap, CONFIG.CLONE_CAP).matrices })).filter((c) => c.path);
  for (const cell of windowOffsets()) {
    const Mo = cellMatrix(cell, lat);
    for (const pt of doc.points) {
      const w = toWorld(nodeUV(pt, cell), lat), a: Anchor = { x: w.x, y: w.y, pointId: pt.id, cell };
      if (!skip || !skip(a)) out.push(a);
    }
    for (const { b, path, ms } of clones) {
      const Pw = pathWorld(doc, path!), nodes = pathNodes(path!);
      ms.forEach((M, k) => {
        if (!M) return;
        const MM = compose(Mo, M);
        nodes.forEach((n, i) => { if (n.via) return; const w = apply(MM, Pw[i]), a: Anchor = { x: w.x, y: w.y, pointId: n.pointId, cell: n.cell, bindingId: b.id, power: k + 1, via: { cell, bindingId: b.id, power: k + 1 } }; if (!skip || !skip(a)) out.push(a); });
      });
    }
  }
  return out;
}

export function snapWorld(doc: Doc, p: XY, threshold: number, div: number, skip?: (a: Anchor) => boolean, gridOn = true): { x: number; y: number; anchor: Anchor | null } {
  let best: Anchor | null = null, bd = threshold;
  for (const a of anchorsWorld(doc, skip)) { const d = dist(a, p); if (d < bd) { bd = d; best = a; } }
  if (best) return { x: best.x, y: best.y, anchor: best };
  if (!gridOn) return { x: p.x, y: p.y, anchor: null };
  const g = toWorld(snapGrid(toUV(p, doc.lattice), div), doc.lattice);
  return { x: g.x, y: g.y, anchor: null };
}

export function pointsInRect(doc: Doc, r: Box): string[] {
  const ids: string[] = [];
  for (const pt of doc.points) {
    if (windowOffsets().some((cell) => { const w = toWorld(nodeUV(pt, cell), doc.lattice); return w.x >= r.x0 && w.x <= r.x1 && w.y >= r.y0 && w.y <= r.y1; })) ids.push(pt.id);
  }
  return ids;
}

// Points inside a rectangle (spec S5): raw copies in any window cell, and clone images, recording the clone each was picked through.
export function pointsInRectAll(doc: Doc, r: Box): { ids: string[]; copies: Record<string, Copy> } {
  const ids = new Set(pointsInRect(doc, r)), copies: Record<string, Copy> = {};
  for (const a of anchorsWorld(doc)) {
    if (!a.bindingId || !a.via || ids.has(a.pointId)) continue;
    if (a.x >= r.x0 && a.x <= r.x1 && a.y >= r.y0 && a.y <= r.y1) { ids.add(a.pointId); copies[a.pointId] = { cell: { ...a.via.cell }, bindingId: a.via.bindingId, power: a.via.power }; }
  }
  return { ids: [...ids], copies };
}

export function projectOnSegment(A: XY, B: XY, p: XY, tMin = 0.05, tMax = 0.95): XY {
  const dx = B.x - A.x, dy = B.y - A.y, L = dx * dx + dy * dy || 1;
  const t = Math.max(tMin, Math.min(tMax, ((p.x - A.x) * dx + (p.y - A.y) * dy) / L));
  return { x: A.x + t * dx, y: A.y + t * dy };
}

export function bboxHandles(box: Box): BoxHandle[] {
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  return [
    { x: box.x0, y: box.y0, ax: box.x1, ay: box.y1, cursor: 'nwse-resize' },
    { x: box.x1, y: box.y0, ax: box.x0, ay: box.y1, cursor: 'nesw-resize' },
    { x: box.x1, y: box.y1, ax: box.x0, ay: box.y0, cursor: 'nwse-resize' },
    { x: box.x0, y: box.y1, ax: box.x1, ay: box.y0, cursor: 'nesw-resize' },
    { x: cx, y: box.y0, ax: cx, ay: box.y1, cursor: 'ns-resize' },
    { x: cx, y: box.y1, ax: cx, ay: box.y0, cursor: 'ns-resize' },
    { x: box.x1, y: cy, ax: box.x0, ay: cy, cursor: 'ew-resize' },
    { x: box.x0, y: cy, ax: box.x1, ay: cy, cursor: 'ew-resize' },
  ];
}

export function scaleMatrix(ax: number, ay: number, sx: number, sy: number): Matrix { return [sx, 0, 0, sy, ax - sx * ax, ay - sy * ay]; }

// E6, §6.5 box modifiers: the scale a box handle dragged to p gives, and the fixed point it scales about. `proportional`
// (⇧) keeps the box's proportions: a corner projects p onto its diagonal, an edge applies its factor to both axes.
// `fromCentre` (⌥) scales about the box centre instead of the opposite handle. A handle with no extent on an axis (a
// zero-width or zero-height box) leaves that axis at 1, so nothing divides by zero.
export type ScaleMods = { proportional: boolean; fromCentre: boolean };
export function boxScale(box: Box, h: BoxHandle, p: XY, mods: ScaleMods): { sx: number; sy: number; ax: number; ay: number } {
  const ax = mods.fromCentre ? (box.x0 + box.x1) / 2 : h.ax, ay = mods.fromCentre ? (box.y0 + box.y1) / 2 : h.ay;
  const vx = h.x - ax, vy = h.y - ay;
  if (!vx && !vy) return { sx: 1, sy: 1, ax, ay };
  const clamp = (v: number) => (Math.abs(v) < 0.05 ? (v < 0 ? -0.05 : 0.05) : v);
  let sx = 1, sy = 1;
  if (vx && vy && mods.proportional) sx = sy = ((p.x - ax) * vx + (p.y - ay) * vy) / (vx * vx + vy * vy);
  else {
    if (vx) sx = (p.x - ax) / vx;
    if (vy) sy = (p.y - ay) / vy;
    if (mods.proportional) { if (vx) sy = sx; else sx = sy; }
  }
  return { sx: clamp(sx), sy: clamp(sy), ax, ay };
}
