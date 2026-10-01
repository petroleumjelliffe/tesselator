// Snapping (spec 2026-09-30 §6): the targets a gesture can land on, the choice among them (one precedence list,
// points before lines, sticky holds), and the gesture-specific candidates (a stroke's own targets, a dragged node's own
// clones resolved to their axis or centre). Pure: takes a doc and explicit inputs. World distances throughout.
import { CONFIG } from '../config';
import { STR } from '../strings';
import { toWorld, toUV, snapGrid, windowOffsets } from './lattice';
import { apply, compose, invert, cellMatrix, classify, orbit } from './transform';
import { getPath, pathNodes, cloneMatrices } from './paths';
import { collectSegments } from './regions';
import { anchorsWorld } from './hit';
import type { Doc, XY, Matrix, Copy, Lattice, SnapCat, SnapHit, SnapResult, PointTarget, LineTarget, TargetSet, StrokeCopy } from '../types';

const add = (a: XY, b: XY): XY => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: XY, b: XY): XY => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: XY, k: number): XY => ({ x: a.x * k, y: a.y * k });
const dot = (a: XY, b: XY) => a.x * b.x + a.y * b.y;
const cross = (a: XY, b: XY) => a.x * b.y - a.y * b.x;
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const BASE: Copy = { cell: { c: 0, r: 0 }, bindingId: null, power: 0 };
const WINDOW = [-1, 0, 1, 2];
const ptKey = (p: XY) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
const copyKey = (c: Copy) => `${c.cell.c},${c.cell.r},${c.bindingId ?? ''},${c.power}`;
function lineKey(a: XY, b: XY): string {
  let ang = Math.atan2(b.y - a.y, b.x - a.x);
  if (ang < 0) ang += Math.PI;
  if (ang >= Math.PI - 1e-6) ang -= Math.PI;
  return `${ang.toFixed(4)}:${(-Math.sin(ang) * a.x + Math.cos(ang) * a.y).toFixed(3)}`;
}

export function bezAt(a: XY, cp: XY | null, b: XY, t: number): XY {
  if (!cp) return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  const s = 1 - t;
  return { x: s * s * a.x + 2 * s * t * cp.x + t * t * b.x, y: s * s * a.y + 2 * s * t * cp.y + t * t * b.y };
}

// Nearest point on a straight or quadratic segment: exact for a line; sampled then refined by ternary search for a curve.
export function nearestOnSeg(a: XY, cp: XY | null, b: XY, p: XY): { t: number; q: XY; d: number } {
  if (!cp) {
    const ab = sub(b, a), L = dot(ab, ab) || 1, t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / L)), q = add(a, mul(ab, t));
    return { t, q, d: dist(p, q) };
  }
  let bt = 0, bd = Infinity;
  for (let i = 0; i <= 32; i++) { const t = i / 32, d = dist(p, bezAt(a, cp, b, t)); if (d < bd) { bd = d; bt = t; } }
  let lo = Math.max(0, bt - 1 / 32), hi = Math.min(1, bt + 1 / 32);
  for (let k = 0; k < 50; k++) {   // 30 leaves ~1e-6 world-unit error near a flat minimum (tangent perpendicular to p); 50 reaches the float64 noise floor
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (dist(p, bezAt(a, cp, b, m1)) < dist(p, bezAt(a, cp, b, m2))) hi = m2; else lo = m1;
  }
  const t = (lo + hi) / 2, q = bezAt(a, cp, b, t);
  return { t, q, d: dist(p, q) };
}

function segX(a: XY, b: XY, c: XY, d: XY): XY | null {
  const r = sub(b, a), s = sub(d, c), den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(c, a), s) / den, u = cross(sub(c, a), r) / den;
  return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? add(a, mul(r, t)) : null;
}
const sampled = (t: LineTarget, n = 16): XY[] => (t.cp ? Array.from({ length: n + 1 }, (_, i) => bezAt(t.a, t.cp, t.b, i / n)) : [t.a, t.b]);
const boxDist = (t: LineTarget, p: XY): number => {
  const xs = [t.a.x, t.b.x, ...(t.cp ? [t.cp.x] : [])], ys = [t.a.y, t.b.y, ...(t.cp ? [t.cp.y] : [])];
  return Math.hypot(Math.max(Math.min(...xs) - p.x, 0, p.x - Math.max(...xs)), Math.max(Math.min(...ys) - p.y, 0, p.y - Math.max(...ys)));
};

// Everything a gesture can land on in the 3×3 window: tile corners and edges, mirror axes (elements, and the axes the
// stacked groups imply), rotation points, intersections of those with each other and with path lines, and every node
// and line of every path copy (originals, repeats, clones). Hidden-layer filtering arrives with the layers plan.
export function buildTargets(doc: Doc): TargetSet {
  const lat = doc.lattice, points: PointTarget[] = [], lines: LineTarget[] = [];
  const corners = WINDOW.flatMap((u) => WINDOW.map((v) => toWorld({ u, v }, lat)));
  const x0 = Math.min(...corners.map((p) => p.x)), x1 = Math.max(...corners.map((p) => p.x));
  const y0 = Math.min(...corners.map((p) => p.y)), y1 = Math.max(...corners.map((p) => p.y));
  const inBox = (p: XY) => p.x >= x0 - 1e-6 && p.x <= x1 + 1e-6 && p.y >= y0 - 1e-6 && p.y <= y1 + 1e-6;
  const diag = Math.hypot(x1 - x0, y1 - y0), mid = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const seenP = new Set<string>(), seenL = new Set<string>();
  const pushP = (t: Omit<PointTarget, 'id'> & { id?: string }) => {
    const k = `${t.cat}:${ptKey(t.at)}`;
    if (!inBox(t.at) || seenP.has(k)) return;
    seenP.add(k);
    points.push({ ...t, id: t.id ?? k });
  };
  const pushStatic = (a: XY, b: XY, cat: SnapCat, label: string) => {
    const k = lineKey(a, b);
    if (seenL.has(k)) return;
    seenL.add(k);
    lines.push({ a, b, cp: null, cat, id: `${cat}:${k}`, label });
  };
  const axis = (P: XY, D0: XY, label: string) => {
    const n = Math.hypot(D0.x, D0.y);
    if (n < 1e-9) return;
    const D = mul(D0, diag / n);
    if (Math.abs(cross(sub(mid, P), D)) / diag > diag / 2) return;   // the line misses the window
    pushStatic(sub(P, D), add(P, D), 'axis', label);
  };

  for (const at of corners) pushP({ at, cat: 'corner', label: STR.snap.corner, hit: { kind: 'place' } });
  for (const k of WINDOW) {
    pushStatic(toWorld({ u: k, v: -1 }, lat), toWorld({ u: k, v: 2 }, lat), 'edge', STR.snap.edge);
    pushStatic(toWorld({ u: -1, v: k }, lat), toWorld({ u: 2, v: k }, lat), 'edge', STR.snap.edge);
  }
  for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) for (const e of doc.elements) {
    if (e.kind === 'mirror') axis(toWorld({ u: e.u + c, v: e.v + r }, lat), toWorld({ u: e.du, v: e.dv }, lat), STR.snap.axis);
    else if (e.kind === 'rotate') pushP({ at: toWorld({ u: e.u + c, v: e.v + r }, lat), cat: 'centre', label: STR.snap.centre(e.n), hit: { kind: 'place' } });
  }
  // Axes implied by stacked groups (a rotation then a mirror has several): the reflections among their clone matrices.
  const seenG = new Set<string>();
  for (const g of [doc.newPathGroups, ...doc.bindings.map((b) => b.groups)]) {
    const k = JSON.stringify(g);
    if (!g.length || seenG.has(k)) continue;
    seenG.add(k);
    for (const C of orbit(g, doc.elements, lat, CONFIG.ORBIT_CAP, CONFIG.CLONE_CAP).matrices) {
      if (!C) continue;
      for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
        const cl = classify(compose(cellMatrix({ c, r }, lat), C));
        if (cl.kind === 'reflection') { const th = (cl.line.angle * Math.PI) / 180; axis(cl.line.point, { x: Math.cos(th), y: Math.sin(th) }, STR.snap.impliedAxis); }
      }
    }
  }
  const statics = lines.slice();
  for (let i = 0; i < statics.length; i++) for (let j = i + 1; j < statics.length; j++) {
    if (statics[i].cat === 'edge' && statics[j].cat === 'edge') continue;   // those are the corners
    const x = segX(statics[i].a, statics[i].b, statics[j].a, statics[j].b);
    if (x) pushP({ at: x, cat: 'intersection', label: STR.snap.cross(statics[i].label, statics[j].label), hit: { kind: 'place' } });
  }
  for (const s of collectSegments(doc)) {
    const path = getPath(doc, s.source.pathId);
    if (!path) continue;
    const nodes = pathNodes(path), ends = [nodes[s.source.j].pointId, nodes[s.source.j + 1].pointId];
    const t: LineTarget = { a: s.a, b: s.b, cp: s.cp, cat: 'line', id: `l:${s.source.pathId}:${s.source.j}:${copyKey(s.source.copy)}`,
      label: s.source.copy.bindingId ? STR.snap.cloneLine : STR.snap.line, source: { pathId: s.source.pathId, copy: s.source.copy, j: s.source.j }, ends };
    lines.push(t);
    const pl = sampled(t);
    for (let i = 0; i + 1 < pl.length; i++) for (const st of statics) {
      const x = segX(pl[i], pl[i + 1], st.a, st.b);
      if (x) pushP({ at: x, cat: 'intersection', label: STR.snap.cross(t.label, st.label), hit: { kind: 'place' }, pointIds: ends, pathIds: [s.source.pathId] });
    }
  }
  for (const a of anchorsWorld(doc)) {
    const copy: Copy = a.bindingId && a.via ? a.via : BASE;
    pushP({ at: { x: a.x, y: a.y }, cat: 'node', id: `n:${a.pointId}:${a.cell.c},${a.cell.r}:${copyKey(copy)}`, label: a.bindingId ? STR.snap.cloneNode : STR.snap.node,
      hit: { kind: 'node', pointId: a.pointId, cell: { ...a.cell }, copy: { cell: { ...copy.cell }, bindingId: copy.bindingId, power: copy.power } }, pointIds: [a.pointId] });
  }
  return { points, lines };
}

export const NODE_ONLY: ReadonlySet<SnapCat> = new Set<SnapCat>(['node']);

export function precedence(x: { cls: 'point' | 'line'; cat: SnapCat }): number {
  const list = (x.cls === 'point' ? CONFIG.SNAP_PRECEDENCE.point : CONFIG.SNAP_PRECEDENCE.line) as readonly SnapCat[];
  const i = list.indexOf(x.cat);
  return (x.cls === 'point' ? 0 : 100) + (i < 0 ? 50 : i);
}

// One pick among candidates: the nearest point within the threshold, else the nearest line, ties by precedence. A held
// (sticky) candidate stays until it is beyond 1.5× the threshold, an earlier-precedence category is in range, or a
// same-class rival is nearer by half the threshold.
export function choose(cands: SnapResult[], threshold: number, sticky: string | null): SnapResult | null {
  const key = (x: SnapResult) => x.d + precedence(x) * 1e-3 * threshold;
  const best = (xs: SnapResult[]) => xs.reduce<SnapResult | null>((b, x) => (!b || key(x) < key(b) ? x : b), null);
  const within = cands.filter((x) => x.d <= threshold);
  let pick = best(within.filter((x) => x.cls === 'point')) ?? best(within.filter((x) => x.cls === 'line'));
  const prev = sticky ? cands.find((x) => x.id === sticky) ?? null : null;
  if (prev) {
    if (!pick) pick = prev;
    else if (pick.id !== prev.id) {
      const earlier = precedence(pick) < precedence(prev) && pick.cat !== prev.cat;
      const nearer = pick.cls === prev.cls && pick.d < prev.d - CONFIG.SNAP_STICKY_MARGIN * threshold;
      if (!earlier && !nearer) pick = prev;
    }
  }
  return pick;
}

export type PickOpts = {
  extra?: SnapResult[]; sticky?: string | null; excludePoints?: ReadonlySet<string>; excludePaths?: ReadonlySet<string>;
  cats?: ReadonlySet<SnapCat>; pointsOnly?: boolean; linesOnly?: boolean;
};

export function pickSnap(set: TargetSet, p: XY, threshold: number, opts: PickOpts = {}): SnapResult | null {
  const reach = CONFIG.SNAP_STICKY_RELEASE * threshold, cands: SnapResult[] = [];
  const allowed = (cat: SnapCat) => !opts.cats || opts.cats.has(cat);
  const blocked = (pointIds?: string[], pathIds?: string[]) =>
    (!!pointIds && !!opts.excludePoints && pointIds.some((id) => opts.excludePoints!.has(id))) ||
    (!!pathIds && !!opts.excludePaths && pathIds.some((id) => opts.excludePaths!.has(id)));
  if (!opts.linesOnly) for (const t of set.points) {
    if (!allowed(t.cat) || blocked(t.pointIds, t.pathIds)) continue;
    const d = dist(p, t.at);
    if (d <= reach) cands.push({ at: t.at, cls: 'point', cat: t.cat, id: t.id, label: t.label, hit: t.hit, d });
  }
  if (!opts.pointsOnly) for (const t of set.lines) {
    if (!allowed(t.cat) || blocked(t.ends, t.source && [t.source.pathId]) || boxDist(t, p) > reach) continue;
    const r = nearestOnSeg(t.a, t.cp, t.b, p);
    if (r.d > reach) continue;
    const hit: SnapHit = t.source ? { kind: 'curve', pathId: t.source.pathId, j: t.source.j, t: r.t, copy: t.source.copy } : { kind: 'place' };
    cands.push({ at: r.q, cls: 'line', cat: t.cat, id: t.id, label: t.label, hit, d: r.d, line: sampled(t, 32) });
  }
  for (const x of opts.extra ?? []) {
    if (x.d > reach || !allowed(x.cat) || (opts.pointsOnly && x.cls === 'line') || (opts.linesOnly && x.cls === 'point')) continue;
    cands.push(x);
  }
  return choose(cands, threshold, opts.sticky ?? null);
}

export function gridResult(p: XY, lat: Lattice, div: number): SnapResult {
  const at = toWorld(snapGrid(toUV(p, lat), div), lat);
  return { at, cls: 'point', cat: 'grid', id: 'grid', label: STR.snap.grid, hit: { kind: 'place' }, d: dist(p, at) };
}

// The copies a new or extended stroke will have in the window: its repeats (pure cell translations, cell ≠ 0) and its
// clones (the groups' clone matrices, in every window cell).
export function strokeCopies(doc: Doc, groups: string[][]): StrokeCopy[] {
  const out: StrokeCopy[] = [], lat = doc.lattice;
  const clones = groups.length ? orbit(groups, doc.elements, lat, CONFIG.ORBIT_CAP, CONFIG.CLONE_CAP).matrices.filter((m): m is Matrix => !!m) : [];
  for (const cell of windowOffsets()) {
    const Mo = cellMatrix(cell, lat);
    if (cell.c || cell.r) out.push({ M: Mo, kind: 'repeat', cell });
    for (const C of clones) out.push({ M: compose(Mo, C), kind: 'clone', cell });
  }
  return out;
}

function polyLength(pts: XY[]): number { let n = 0; for (let i = 1; i < pts.length; i++) n += dist(pts[i - 1], pts[i]); return n; }
function trimTail(pts: XY[], len: number): XY[] {
  let acc = 0;
  for (let i = pts.length - 1; i > 0; i--) { acc += dist(pts[i], pts[i - 1]); if (acc >= len) return pts.slice(0, i); }
  return [];
}
function nearestOnPoly(pl: XY[], p: XY): { q: XY; d: number } | null {
  let best: { q: XY; d: number } | null = null;
  for (let i = 0; i + 1 < pl.length; i++) { const r = nearestOnSeg(pl[i], null, pl[i + 1], p); if (!best || r.d < best.d) best = r; }
  return best;
}

// A stroke's own targets (spec T8–T10): its line minus a tail of 3× the threshold behind the tip, its start once it is
// longer than 4× the threshold, and the start and line of each of its clones and repeats. `stroke` is world points.
export function strokeCands(stroke: XY[], copies: StrokeCopy[], p: XY, threshold: number): SnapResult[] {
  const out: SnapResult[] = [], reach = CONFIG.SNAP_STICKY_RELEASE * threshold;
  if (stroke.length < 2) return out;
  const body = trimTail(stroke, 3 * threshold);
  const r = body.length >= 2 ? nearestOnPoly(body, p) : null;
  if (r && r.d <= reach) out.push({ at: r.q, cls: 'line', cat: 'ownLine', id: 'own:line', label: STR.snap.ownLine, hit: { kind: 'ownLine' }, d: r.d, line: body });
  if (polyLength(stroke) > 4 * threshold) {
    const d = dist(p, stroke[0]);
    if (d <= reach) out.push({ at: stroke[0], cls: 'point', cat: 'ownStart', id: 'own:start', label: STR.snap.ownStart, hit: { kind: 'ownStart' }, d });
  }
  copies.forEach((c, i) => {
    const s0 = apply(c.M, stroke[0]), d0 = dist(p, s0), rep = c.kind === 'repeat';
    if (d0 <= reach) out.push(rep
      ? { at: s0, cls: 'point', cat: 'ownRepeat', id: `own:rs:${i}`, label: STR.snap.repeatStart, hit: { kind: 'ownRepeat', cell: { ...c.cell } }, d: d0 }
      : { at: s0, cls: 'point', cat: 'ownClone', id: `own:cs:${i}`, label: STR.snap.cloneStart, hit: { kind: 'place' }, d: d0 });
    if (body.length < 2) return;
    const pl = body.map((q) => apply(c.M, q)), rr = nearestOnPoly(pl, p);
    if (rr && rr.d <= reach) out.push({ at: rr.q, cls: 'line', cat: rep ? 'ownRepeat' : 'ownClone', id: `own:cl:${i}`, label: rep ? STR.snap.ownRepeatLine : STR.snap.ownCloneLine, hit: { kind: 'ownCopy', M: c.M }, d: rr.d, line: pl });
  });
  return out;
}

// Every matrix that maps a point's base-cell world position to one of its copies in the window: each raw cell copy
// and each clone copy, for every path that uses the point (as a plain node, in that node's cell).
export function pointCopyMatrices(doc: Doc, pointId: string): Matrix[] {
  const out: Matrix[] = [], lat = doc.lattice;
  for (const path of doc.paths) {
    const n = pathNodes(path).find((x) => x.pointId === pointId && !x.via);
    if (!n) continue;
    const Mn = cellMatrix(n.cell, lat), clones = doc.bindings.filter((b) => b.pathId === path.id).flatMap((b) => cloneMatrices(doc, b.id).matrices.filter((m): m is Matrix => !!m));
    for (const cell of windowOffsets()) {
      const Mo = cellMatrix(cell, lat);
      out.push(compose(Mo, Mn));
      for (const C of clones) out.push(compose(Mo, compose(C, Mn)));
    }
  }
  return out;
}

// SN3: a dragged node's own copies move with it, so they are never chased. A copy whose relative map T = K ∘ S⁻¹ is a
// reflection offers its mirror line ("meets its mirror clone"); a rotation offers its centre. Translations and glides
// offer nothing. S maps the point's base-cell world position to where it is being dragged.
export function ownFixedCands(S: Matrix, Ks: Matrix[], p: XY, threshold: number): SnapResult[] {
  const out: SnapResult[] = [], reach = CONFIG.SNAP_STICKY_RELEASE * threshold, Si = invert(S), seen = new Set<string>();
  for (const K of Ks) {
    const cl = classify(compose(K, Si));
    if (cl.kind === 'reflection') {
      const th = (cl.line.angle * Math.PI) / 180, D = { x: Math.cos(th) * 1e4, y: Math.sin(th) * 1e4 };
      const a = sub(cl.line.point, D), b = add(cl.line.point, D), id = `fx:${lineKey(a, b)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const r = nearestOnSeg(a, null, b, p);
      if (r.d <= reach) out.push({ at: r.q, cls: 'line', cat: 'ownFixed', id, label: STR.snap.meetsMirror, hit: { kind: 'place' }, d: r.d, line: [a, b] });
    } else if (cl.kind === 'rotation') {
      const id = `fc:${ptKey(cl.center)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const d = dist(p, cl.center);
      if (d <= reach) out.push({ at: cl.center, cls: 'point', cat: 'ownFixed', id, label: STR.snap.meetsRotated, hit: { kind: 'place' }, d });
    }
  }
  return out;
}
