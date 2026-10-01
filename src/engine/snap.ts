// Snapping (spec 2026-09-30 §6): the targets a gesture can land on, the choice among them (one precedence list,
// points before lines, sticky holds), and the gesture-specific candidates (a stroke's own targets, a dragged node's own
// clones resolved to their axis or centre). Pure: takes a doc and explicit inputs. World distances throughout.
import { CONFIG } from '../config';
import { STR } from '../strings';
import { toWorld, toUV, snapGrid, windowOffsets } from './lattice';
import { apply, compose, invert, cellMatrix, classify, orbit } from './transform';
import { getPath, pathNodes, cloneMatrices, pathWorld, isClosed, viaMatrix } from './paths';
import { collectSegments } from './regions';
import { anchorsWorld } from './hit';
import type { Doc, XY, Matrix, Copy, Lattice, SnapCat, SnapHit, SnapResult, PointTarget, LineTarget, TargetSet, StrokeCopy, Line, BoxHandle, BodyTargets, BodySnap } from '../types';

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

// Solve S(pi) + S_L δ = K(pj) + K_L δ for the source-frame delta δ. Full rank: one δ. Rank 1 (a reflection relative to S):
// a line of δ when solvable. K_L = S_L (a translation relative to S): the two move in lockstep, so null.
export function solveCopyMeet(S: Matrix, K: Matrix, pi: XY, pj: XY): { kind: 'point'; delta: XY } | { kind: 'line'; base: XY; dir: XY } | null {
  const A = [S[0] - K[0], S[1] - K[1], S[2] - K[2], S[3] - K[3]];
  const r = sub(apply(K, pj), apply(S, pi));
  const f2 = A[0] ** 2 + A[1] ** 2 + A[2] ** 2 + A[3] ** 2;
  if (f2 < 1e-12) return null;
  const det = A[0] * A[3] - A[2] * A[1];
  if (Math.abs(det) > 1e-9 * f2) return { kind: 'point', delta: { x: (A[3] * r.x - A[2] * r.y) / det, y: (-A[1] * r.x + A[0] * r.y) / det } };
  const base = { x: (A[0] * r.x + A[1] * r.y) / f2, y: (A[2] * r.x + A[3] * r.y) / f2 };
  const back = { x: A[0] * base.x + A[2] * base.y, y: A[1] * base.x + A[3] * base.y };
  if (dist(back, r) > 1e-6 * (1 + Math.hypot(r.x, r.y))) return null;
  const r0 = { x: A[0], y: A[2] }, r1 = { x: A[1], y: A[3] };
  const row = Math.hypot(r0.x, r0.y) >= Math.hypot(r1.x, r1.y) ? r0 : r1, L = Math.hypot(row.x, row.y);
  return { kind: 'line', base, dir: { x: -row.y / L, y: row.x / L } };
}

export function windowCopies(doc: Doc, pathId: string): { copy: Copy; M: Matrix }[] {
  const out: { copy: Copy; M: Matrix }[] = [];
  const clones = doc.bindings.filter((b) => b.pathId === pathId).map((b) => ({ b, ms: cloneMatrices(doc, b.id).matrices }));
  for (const cell of windowOffsets()) {
    const Mo = cellMatrix(cell, doc.lattice);
    out.push({ copy: { cell, bindingId: null, power: 0 }, M: Mo });
    for (const { b, ms } of clones) ms.forEach((M, k) => { if (M) out.push({ copy: { cell, bindingId: b.id, power: k + 1 }, M: compose(Mo, M) }); });
  }
  return out;
}

// A body drag's inputs, taken once at drag start: the moving ends (every node of a closed path) in the source frame, the
// path's own clone copies for SN3 meets, and every point that moves with the path (its own and those of paths that share
// them), whose targets and adjacent lines are excluded.
export function bodyTargets(doc: Doc, set: TargetSet, pathId: string): BodyTargets | null {
  const path = getPath(doc, pathId);
  if (!path) return null;
  const nodes = pathNodes(path), Pw = pathWorld(doc, path);
  const idx = isClosed(path) ? nodes.slice(0, -1).map((_, i) => i) : [0, nodes.length - 1];
  const moving = idx.filter((i) => !nodes[i].via).map((i) => ({ index: i, p: Pw[i] }));
  const own: BodyTargets['own'] = [];
  for (const { copy, M } of windowCopies(doc, pathId)) if (copy.bindingId) for (const m of moving) own.push({ K: M, p: m.p, index: m.index });
  return { pathId, moving, own, exclude: new Set(nodes.map((n) => n.pointId)), set };
}

// The best snap for a raw source-frame delta: each moving end looks for a target (precedence and stickiness as everywhere),
// plus meeting the path's own rotated or mirrored copies (solved, never chased); the best end moves the whole path.
export function snapBodyDelta(T: BodyTargets, raw: XY, threshold: number, sticky: string | null): BodySnap | null {
  const reach = CONFIG.SNAP_STICKY_RELEASE * threshold;
  const exPaths = new Set([T.pathId]);
  let best: BodySnap | null = null;
  const better = (a: SnapResult, b: SnapResult) => (a.id === sticky) || (b.id !== sticky && (a.cls !== b.cls ? a.cls === 'point' : a.d + precedence(a) * 1e-3 * threshold < b.d + precedence(b) * 1e-3 * threshold));
  for (const m of T.moving) {
    const e0 = add(m.p, raw), extra: SnapResult[] = [];
    for (const o of T.own) {
      const r = solveCopyMeet([1, 0, 0, 1, 0, 0], o.K, m.p, o.p), cross = o.index !== m.index;
      if (r?.kind === 'point') {
        const at = add(m.p, r.delta), d = dist(at, e0);
        const id = cross ? `own:p:${m.index}>${o.index}:${ptKey(at)}` : `own:p:${ptKey(at)}`;
        if (d <= reach) extra.push({ at, cls: 'point', cat: 'ownFixed', id, label: cross ? STR.snap.meetsCloneEnd : STR.snap.meetsOwn, hit: { kind: 'own' }, d });
      } else if (r?.kind === 'line') {
        const delta = add(r.base, mul(r.dir, dot(sub(raw, r.base), r.dir))), at = add(m.p, delta), d = dist(at, e0);
        const id = cross ? `own:l:${m.index}>${o.index}:${ptKey(add(m.p, r.base))}:${r.dir.x.toFixed(4)}` : `own:l:${ptKey(add(m.p, r.base))}:${r.dir.x.toFixed(4)}`;
        if (d <= reach) extra.push({ at, cls: 'line', cat: 'ownFixed', id, label: cross ? STR.snap.meetsCloneEndLine : STR.snap.meetsMirror, hit: { kind: 'own' }, d, line: [add(at, mul(r.dir, -1e4)), add(at, mul(r.dir, 1e4))] });
      }
    }
    const res = pickSnap(T.set, e0, threshold, { extra, sticky, excludePoints: T.exclude, excludePaths: exPaths });
    if (res && (!best || better(res, best.res))) best = { delta: add(raw, sub(res.at, e0)), nodeIndex: m.index, res };
  }
  return best;
}

const unit = (v: XY): XY | null => { const L = Math.hypot(v.x, v.y); return L < 1e-9 ? null : { x: v.x / L, y: v.y / L }; };

export function snapScale(nodes: XY[], lat: Lattice, h: BoxHandle, raw: { sx: number; sy: number }, free: boolean, threshold: number, fractions: readonly number[]): { sx: number; sy: number; snapped: boolean } {
  const xs = nodes.map((p) => p.x), ys = nodes.map((p) => p.y);
  const Wn = Math.max(...xs) - Math.min(...xs), Hn = Math.max(...ys) - Math.min(...ys);
  const spans = (a: number, b: number) => [Math.abs(a), Math.abs(b)].filter((s) => s >= 1).flatMap((s) => fractions.map((f) => f * s));
  const sgn = (s: number) => (s < 0 ? -1 : 1);
  const cands = (ext: number, targets: number[], s: number) => (ext < 1e-6 ? [] : targets.map((t) => (sgn(s) * t) / ext));
  const pick = (s: number, cs: number[], len: number): number | null => {
    let best: number | null = null, bd = threshold;
    for (const c of cs) { const dd = Math.abs(s - c) * len; if (dd <= bd) { bd = dd; best = c; } }
    return best;
  };
  const vx = h.x - h.ax, vy = h.y - h.ay;
  const cx = cands(Wn, spans(lat.ax, lat.bx), raw.sx), cy = cands(Hn, spans(lat.ay, lat.by), raw.sy);
  if (vx && vy && !free) {
    const s = pick(raw.sx, [...cx, ...cy], Math.hypot(vx, vy));
    return s === null ? { ...raw, snapped: false } : { sx: s, sy: s, snapped: true };
  }
  const sx = vx ? pick(raw.sx, cx, Math.abs(vx)) : null, sy = vy ? pick(raw.sy, cy, Math.abs(vy)) : null;
  return { sx: sx ?? raw.sx, sy: sy ?? raw.sy, snapped: sx !== null || sy !== null };
}

// Lines a control point of segment j may snap to, in world at `copy`: horizontal and vertical through either end; through
// an end along any other segment meeting it there (that segment's control point, or other end if straight); through an
// end along the normal of a mirror copy of this path that fixes that end. Worked out at the copy's cell-(0, 0) version,
// then shifted by the copy's cell.
export function cpLines(doc: Doc, pathId: string, j: number, copy: Copy): Line[] {
  const path = getPath(doc, pathId);
  if (!path || !path.segments[j]) return [];
  const M0 = viaMatrix(doc, { ...copy, cell: { c: 0, r: 0 } }), off = toWorld({ u: copy.cell.c, v: copy.cell.r }, doc.lattice);
  const Pw = pathWorld(doc, path), ends = [apply(M0, Pw[j]), apply(M0, Pw[j + 1])];
  const out: Line[] = [];
  for (const X of ends) out.push({ p: X, dir: { x: 1, y: 0 } }, { p: X, dir: { x: 0, y: 1 } });
  const segs = collectSegments(doc).filter((s) => !(s.source.pathId === pathId && s.source.j === j));
  for (const X of ends) for (const s of segs) {
    for (const [end, other] of [[s.a, s.cp ?? s.b], [s.b, s.cp ?? s.a]] as const) {
      if (dist(end, X) > 1e-4) continue;
      const dir = unit(sub(other, end));
      if (dir) out.push({ p: X, dir });
    }
  }
  const M0inv = invert(M0);
  for (const { M: K } of windowCopies(doc, pathId)) {
    const T = compose(K, M0inv);
    if (T[0] * T[3] - T[2] * T[1] >= 0) continue;
    for (const X of ends) {
      if (dist(apply(T, X), X) > 1e-4) continue;
      const c0 = { x: T[0] - 1, y: T[1] }, c1 = { x: T[2], y: T[3] - 1 };
      const dir = unit(Math.hypot(c0.x, c0.y) >= Math.hypot(c1.x, c1.y) ? c0 : c1);
      if (dir) out.push({ p: X, dir });
    }
  }
  return out.map((l) => ({ p: add(l.p, off), dir: l.dir }));
}

export function snapToLines(w: XY, lines: Line[], threshold: number): { at: XY; used: Line[] } | null {
  const nearL = lines.map((l) => ({ l, d: Math.abs(cross(l.dir, sub(w, l.p))) })).filter((x) => x.d <= threshold).sort((a, b) => a.d - b.d);
  if (!nearL.length) return null;
  let best: { at: XY; used: Line[] } | null = null, bd = threshold;
  for (let i = 0; i < nearL.length; i++) for (let k = i + 1; k < nearL.length; k++) {
    const a = nearL[i].l, b = nearL[k].l, den = cross(a.dir, b.dir);
    if (Math.abs(den) < 1e-9) continue;
    const at = add(a.p, mul(a.dir, cross(sub(b.p, a.p), b.dir) / den)), dd = dist(at, w);
    if (dd <= bd) { bd = dd; best = { at, used: [a, b] }; }
  }
  if (best) return best;
  const l = nearL[0].l;
  return { at: add(l.p, mul(l.dir, dot(sub(w, l.p), l.dir))), used: [l] };
}
