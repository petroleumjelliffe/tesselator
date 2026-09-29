// Geometric hit-testing and snapping. Pure: takes a doc and a context, returns targets.
import { CONFIG } from '../config';
import { toWorld, toUV, cellOf, nodeUV, windowOffsets, snapGrid } from './lattice';
import { apply, cellMatrix, compose, orbit } from './transform';
import { getPath, pathNodes, pathWorld, pathCpsWorld, boundsWorld, getElement } from './paths';
import { faceAt, fillOfFace } from './regions';
import type { Doc, XY, Lattice, Matrix, Copy, CopyInfo, Cell, Face, HitTarget, Layer, Tool, Selection, Box, BoxHandle, Path } from '../types';

export type HitContext = {
  layer: Layer; tool: Tool; selection: Selection; pen: { pathId: string } | null;
  zoom: number; hitScale: number; copies: CopyInfo[]; cloneMatrices: Map<string, (Matrix | null)[]>; faces: Face[];
};
export type Anchor = { x: number; y: number; pointId: string; cell: Cell; bindingId?: string; power?: number };

export function copyMatrixOf(copy: Copy, lat: Lattice, cm: Map<string, (Matrix | null)[]>): Matrix {
  const Mo = cellMatrix(copy.cell, lat);
  if (!copy.bindingId) return Mo;
  const M = (cm.get(copy.bindingId) ?? [])[copy.power - 1];
  return M ? compose(Mo, M) : Mo;
}

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
  if (s && s.kind === 'points') for (const id of s.ids) set.add(id);
  if (s && s.kind === 'path') { const p = getPath(doc, s.id); if (p) for (const n of pathNodes(p)) set.add(n.pointId); }
  return set;
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

  if (ctx.tool === 'select' && selPath && selM && sel && sel.kind === 'path') {
    const box = boundsWorld(doc, selPath, selM);
    const hs = bboxHandles(box);
    for (let i = 0; i < hs.length; i++) if (dist(w, hs[i]) <= rPoint) return { kind: 'bbox', h: i };
    const knob = { x: (box.x0 + box.x1) / 2, y: box.y0 - CONFIG.BBOX_ROT_OFFSET / z };
    if (dist(w, knob) <= rPoint) return { kind: 'bboxrot' };
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
    if (best) return best;
  }
  if (ctx.tool === 'select' || ctx.tool === 'pen') {
    const anchorsOf = (p: Path, copy: Copy, M: Matrix): HitTarget | null => {
      const Pw = pathWorld(doc, p).map((q) => apply(M, q)), nodes = pathNodes(p);
      for (let i = 0; i < nodes.length; i++) if (dist(w, Pw[i]) <= rPoint) return { kind: 'canchor', pathId: p.id, pointId: nodes[i].pointId, cell: nodes[i].cell, copy };
      return null;
    };
    if (ctx.tool === 'pen') {
      for (const ci of ctx.copies) { if (!ci.copy.bindingId) continue; const p = getPath(doc, ci.pathId); const t = p && anchorsOf(p, ci.copy, ci.M); if (t) return t; }
    } else if (selPath && selM && sel && sel.kind === 'path' && sel.copy.bindingId) {
      const t = anchorsOf(selPath, sel.copy, selM);
      if (t) return t;
    }
  }
  if (ctx.tool === 'select') {
    let best: HitTarget | null = null, bd = rSeg;
    for (const ci of ctx.copies) {
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
        nodes.forEach((n, i) => { const w = apply(MM, Pw[i]), a: Anchor = { x: w.x, y: w.y, pointId: n.pointId, cell: n.cell, bindingId: b.id, power: k + 1 }; if (!skip || !skip(a)) out.push(a); });
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

export function scaleFor(h: BoxHandle, p: XY, free: boolean): { sx: number; sy: number } {
  const vx = h.x - h.ax, vy = h.y - h.ay;
  if (!vx && !vy) return { sx: 1, sy: 1 };
  const clamp = (v: number) => (Math.abs(v) < 0.05 ? (v < 0 ? -0.05 : 0.05) : v);
  let sx = 1, sy = 1;
  if (vx && vy) {
    if (free) { sx = (p.x - h.ax) / vx; sy = (p.y - h.ay) / vy; }
    else { const u = ((p.x - h.ax) * vx + (p.y - h.ay) * vy) / (vx * vx + vy * vy); sx = sy = u; }
  } else if (vx) sx = (p.x - h.ax) / vx;
  else sy = (p.y - h.ay) / vy;
  return { sx: clamp(sx), sy: clamp(sy) };
}
