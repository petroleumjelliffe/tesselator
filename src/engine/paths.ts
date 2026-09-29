// Draft mutations. Every function takes a Doc draft and mutates it; nothing here touches UI state.
import { makeId } from '../ids';
import { toWorld, toUV, cellOf, nodeUV } from './lattice';
import { IDENTITY, apply, orbit, clonePowers, cellMatrix, compose, invert, type Orbit } from './transform';
import { CONFIG } from '../config';
import type { Doc, UV, XY, Cell, Node, Segment, Path, Element, Binding, Fill, Matrix, Style, Box, DocLayer, Lattice, Copy } from '../types';

export const getPoint = (doc: Doc, id: string) => doc.points.find((p) => p.id === id) ?? null;
export const getPath = (doc: Doc, id: string) => doc.paths.find((p) => p.id === id) ?? null;
export const getElement = (doc: Doc, id: string) => doc.elements.find((e) => e.id === id) ?? null;
export const getBinding = (doc: Doc, id: string) => doc.bindings.find((b) => b.id === id) ?? null;
export const getFill = (doc: Doc, id: string) => doc.fills.find((f) => f.id === id) ?? null;

const sameCell = (a: Cell, b: Cell) => a.c === b.c && a.r === b.r;
const sameVia = (a?: Copy, b?: Copy) => (!a && !b) || (!!a && !!b && sameCell(a.cell, b.cell) && a.bindingId === b.bindingId && a.power === b.power);
export function sameNode(a: Node, b: Node): boolean { return a.pointId === b.pointId && sameCell(a.cell, b.cell) && sameVia(a.via, b.via); }
const cloneNode = (n: Node): Node => ({ pointId: n.pointId, cell: { c: n.cell.c, r: n.cell.r }, ...(n.via ? { via: { cell: { ...n.via.cell }, bindingId: n.via.bindingId, power: n.via.power } } : {}) });

export function pathNodes(path: Path): Node[] { return [path.start, ...path.segments.map((s) => s.to)]; }
export function prevNode(path: Path, j: number): Node { return j === 0 ? path.start : path.segments[j - 1].to; }

// The world matrix of a copy: cell translation composed with the clone matrix (identity for a slot that is missing).
export function viaMatrix(doc: Doc, via: Copy): Matrix {
  const Mo = cellMatrix(via.cell, doc.lattice);
  const M = via.bindingId ? cloneMatrices(doc, via.bindingId).matrices[via.power - 1] : null;
  return M ? compose(Mo, M) : Mo;
}
export function viaLive(doc: Doc, via: Copy): boolean { return !!via.bindingId && !!cloneMatrices(doc, via.bindingId).matrices[via.power - 1]; }

export function nodeWorld(doc: Doc, node: Node): XY {
  const p = getPoint(doc, node.pointId);
  if (!p) throw new Error(`missing point ${node.pointId}`);
  const w = toWorld(nodeUV(p, node.cell), doc.lattice);
  return node.via ? apply(viaMatrix(doc, node.via), w) : w;
}
export function nodeUVAbs(doc: Doc, node: Node): UV {
  if (node.via) return toUV(nodeWorld(doc, node), doc.lattice);
  const p = getPoint(doc, node.pointId);
  if (!p) throw new Error(`missing point ${node.pointId}`);
  return nodeUV(p, node.cell);
}
export function pathWorld(doc: Doc, path: Path): XY[] { return pathNodes(path).map((n) => nodeWorld(doc, n)); }

// Absolute lattice coordinates of a control point (relative cp + previous node's cell).
export function cpAbs(path: Path, j: number): UV | null {
  const cp = path.segments[j].cp;
  if (!cp) return null;
  const prev = prevNode(path, j);
  return { u: cp.u + prev.cell.c, v: cp.v + prev.cell.r };
}
export function cpWorld(doc: Doc, path: Path, j: number): XY | null {
  const a = cpAbs(path, j);
  return a && toWorld(a, doc.lattice);
}
export function pathCpsWorld(doc: Doc, path: Path): (XY | null)[] { return path.segments.map((_, j) => cpWorld(doc, path, j)); }

const rel = (abs: UV, cell: Cell): UV => ({ u: abs.u - cell.c, v: abs.v - cell.r });

export function isClosed(path: Path): boolean {
  return path.segments.length >= 2 && sameNode(path.start, path.segments[path.segments.length - 1].to);
}

export function addPoint(doc: Doc, uv: UV): Node {
  const { cell, local } = cellOf(uv);
  const pt = { id: makeId('pt'), u: local.u, v: local.v };
  doc.points.push(pt);
  return { pointId: pt.id, cell };
}

export function startPath(doc: Doc, node: Node, style: Style, layerId: string): Path {
  const path: Path = { id: makeId('path'), start: cloneNode(node), segments: [], style: { ...style }, layerId };
  doc.paths.push(path);
  return path;
}

export function appendNode(doc: Doc, pathId: string, node: Node): boolean {
  const p = getPath(doc, pathId);
  if (!p) return false;
  const nodes = pathNodes(p);
  if (sameNode(nodes[nodes.length - 1], node)) return false;
  p.segments.push({ to: cloneNode(node), cp: null });
  return true;
}

const lerp = (a: UV, b: UV, t: number): UV => ({ u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t });

// Split segment j at parameter t (de Casteljau for a curve, linear for a straight segment). The outline is unchanged.
// Affine, so lattice coords are fine.
export function insertNodeAt(doc: Doc, pathId: string, j: number, t: number): Node {
  const p = getPath(doc, pathId);
  if (!p) throw new Error('no path');
  const seg = p.segments[j], prev = prevNode(p, j);
  const A = nodeUVAbs(doc, prev), B = nodeUVAbs(doc, seg.to), cp = cpAbs(p, j);
  let m: UV, c0: UV | null, c1: UV | null;
  if (cp) { c0 = lerp(A, cp, t); c1 = lerp(cp, B, t); m = lerp(c0, c1, t); }
  else { m = lerp(A, B, t); c0 = null; c1 = null; }
  const node = addPoint(doc, m);
  p.segments.splice(j, 1, { to: node, cp: c0 && rel(c0, prev.cell) }, { to: seg.to, cp: c1 && rel(c1, node.cell) });
  return node;
}

// Split segment j. Straight: at `uv` (absolute). Curved: at t = 0.5, ignoring `uv`.
export function insertNode(doc: Doc, pathId: string, j: number, uv: UV | null): Node {
  const p = getPath(doc, pathId);
  if (!p) throw new Error('no path');
  if (p.segments[j].cp) return insertNodeAt(doc, pathId, j, 0.5);
  if (!uv) throw new Error('straight insert needs a position');
  const seg = p.segments[j];
  const node = addPoint(doc, uv);
  p.segments.splice(j, 1, { to: node, cp: null }, { to: seg.to, cp: null });
  return node;
}

// Parameter on a world-space segment nearest to p, clamped away from the ends (the endpoints are hit as points).
export function nearestT(a: XY, cp: XY | null, b: XY, p: XY): number {
  const clamp = (t: number) => Math.max(0.02, Math.min(0.98, t));
  if (!cp) { const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1; return clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L); }
  const q = (t: number): XY => { const s = 1 - t; return { x: s * s * a.x + 2 * s * t * cp.x + t * t * b.x, y: s * s * a.y + 2 * s * t * cp.y + t * t * b.y }; };
  const d1 = (t: number): XY => ({ x: 2 * ((1 - t) * (cp.x - a.x) + t * (b.x - cp.x)), y: 2 * ((1 - t) * (cp.y - a.y) + t * (b.y - cp.y)) });
  const d2: XY = { x: 2 * (a.x - 2 * cp.x + b.x), y: 2 * (a.y - 2 * cp.y + b.y) };
  let best = 0, bd = Infinity;
  for (let i = 0; i <= 32; i++) { const t = i / 32, r = q(t), d = (r.x - p.x) ** 2 + (r.y - p.y) ** 2; if (d < bd) { bd = d; best = t; } }
  let t = best;
  for (let k = 0; k < 6; k++) {
    const r = q(t), v = d1(t);
    const f = (r.x - p.x) * v.x + (r.y - p.y) * v.y, fp = v.x * v.x + v.y * v.y + (r.x - p.x) * d2.x + (r.y - p.y) * d2.y;
    if (!fp) break;
    const next = Math.max(0, Math.min(1, t - f / fp));
    if (Math.abs(next - t) < 1e-12) { t = next; break; }
    t = next;
  }
  const r = q(t);
  if ((r.x - p.x) ** 2 + (r.y - p.y) ** 2 > bd) t = best;   // Newton wandered off: keep the sampled seed
  return clamp(t);
}

export function pruneOrphans(doc: Doc): void {
  const used = new Set<string>();
  for (const p of doc.paths) for (const n of pathNodes(p)) used.add(n.pointId);
  doc.points = doc.points.filter((pt) => used.has(pt.id));
}

// Remove points from every path. The bridging segment between the survivors is straight.
export function deletePoints(doc: Doc, ids: string[]): void {
  const set = new Set(ids);
  const keep: Path[] = [];
  for (const p of doc.paths) {
    const nodes = pathNodes(p);
    const cpIn: (UV | null)[] = [null, ...p.segments.map((s) => s.cp)];   // cp of the segment entering node i (relative to node i−1's cell)
    let start: Node | null = null;
    const segs: Segment[] = [];
    let bridge = false;
    nodes.forEach((n, i) => {
      if (set.has(n.pointId)) { bridge = true; return; }
      if (!start) start = n;
      else segs.push({ to: n, cp: bridge ? null : cpIn[i] });
      bridge = false;
    });
    if (start && segs.length >= 1) { p.start = start; p.segments = segs; keep.push(p); }
  }
  const kept = new Set(keep.map((p) => p.id));
  withViaRepair(doc, () => {
    doc.paths = keep;
    doc.bindings = doc.bindings.filter((b) => kept.has(b.pathId));
    pruneOrphans(doc);
  });
}

export function deletePath(doc: Doc, pathId: string): void {
  withViaRepair(doc, () => {
    doc.paths = doc.paths.filter((p) => p.id !== pathId);
    doc.bindings = doc.bindings.filter((b) => b.pathId !== pathId);
    pruneOrphans(doc);
  });
}

// The open path whose start or end is `pointId` seen plainly: an end that is a via node sits elsewhere (on a clone), so a click on the point itself does not resume it.
export function openEndAt(doc: Doc, pointId: string): string | null {
  const plainEnd = (n: Node) => n.pointId === pointId && !n.via;
  const p = doc.paths.find((q) => q.segments.length > 0 && !isClosed(q) && (plainEnd(q.start) || plainEnd(q.segments[q.segments.length - 1].to)));
  return p ? p.id : null;
}

// Reverse node order. A cp relative to the old "from" cell becomes relative to the old "to" cell.
export function reversePath(p: Path): void {
  const nodes = pathNodes(p);
  const segs: Segment[] = [];
  for (let j = p.segments.length - 1; j >= 0; j--) {
    const from = nodes[j], to = p.segments[j].to, cp = p.segments[j].cp;
    segs.push({ to: cloneNode(from), cp: cp ? { u: cp.u + from.cell.c - to.cell.c, v: cp.v + from.cell.r - to.cell.r } : null });
  }
  p.start = cloneNode(nodes[nodes.length - 1]);
  p.segments = segs;
}

// Make `pointId` the last node, placed in `cell`, reversing and shifting cells as needed. A shift moves a plain node's
// `cell` and a via node's `via.cell`; a cp is relative to the previous node's `cell`, so it needs no change after a plain
// node and must move with the path after a via node (whose `cell` stays put). The end wanted is the plain one: a path
// X → via(X) ends on X's clone image, so it is reversed to continue from the plain X at its start.
export function orientToEnd(doc: Doc, pathId: string, pointId: string, cell: Cell): void {
  const p = getPath(doc, pathId);
  if (!p || !p.segments.length) return;
  const end = p.segments[p.segments.length - 1].to;
  if (end.via || end.pointId !== pointId) reversePath(p);
  const last = p.segments[p.segments.length - 1].to;
  const dc = cell.c - last.cell.c, dr = cell.r - last.cell.r;
  if (!dc && !dr) return;
  const shift = (n: Node): Node => n.via
    ? { pointId: n.pointId, cell: { ...n.cell }, via: { ...n.via, cell: { c: n.via.cell.c + dc, r: n.via.cell.r + dr } } }
    : { pointId: n.pointId, cell: { c: n.cell.c + dc, r: n.cell.r + dr } };
  const viaBefore = p.segments.map((_, j) => !!prevNode(p, j).via);
  p.start = shift(p.start);
  p.segments = p.segments.map((s, j) => ({ to: shift(s.to), cp: s.cp && viaBefore[j] ? { u: s.cp.u + dc, v: s.cp.v + dr } : s.cp }));
}

export function shiftControlPoints(doc: Doc, ids: string[], du: number, dv: number): void {
  if (!du && !dv) return;
  const set = new Set(ids);
  for (const p of doc.paths) {
    p.segments.forEach((s, j) => {
      if (!s.cp) return;
      const n = (set.has(prevNode(p, j).pointId) ? 1 : 0) + (set.has(s.to.pointId) ? 1 : 0);
      if (n) s.cp = { u: s.cp.u + (du * n) / 2, v: s.cp.v + (dv * n) / 2 };
    });
  }
}

export function movePoint(doc: Doc, pointId: string, u: number, v: number): void {
  const p = getPoint(doc, pointId);
  if (!p) return;
  const du = u - p.u, dv = v - p.v;
  if (!du && !dv) return;
  p.u = u; p.v = v;
  shiftControlPoints(doc, [pointId], du, dv);
}

export function snapshotPositions(doc: Doc, ids: string[]): Record<string, UV> {
  const out: Record<string, UV> = {};
  for (const id of ids) { const p = getPoint(doc, id); if (p) out[id] = { u: p.u, v: p.v }; }
  return out;
}

export function movePointsBy(doc: Doc, ids: string[], startPos: Record<string, UV>, du: number, dv: number): void {
  if (!ids.length) return;
  const first = getPoint(doc, ids[0]);
  if (!first) return;
  const ddu = startPos[ids[0]].u + du - first.u, ddv = startPos[ids[0]].v + dv - first.v;
  for (const id of ids) { const p = getPoint(doc, id); if (p) { p.u = startPos[id].u + du; p.v = startPos[id].v + dv; } }
  shiftControlPoints(doc, ids, ddu, ddv);
}

// Replace every reference to `fromId` (seen in `fromCell`) by `toId` at the same place (seen in `toCell`), keeping
// absolute control points, dropping a segment that becomes zero-length, then deleting the point. A via node that
// referenced `fromId` is rewritten the same way (its world position is unchanged, since the copy sees the same place).
export function mergePoints(doc: Doc, fromId: string, fromCell: Cell, toId: string, toCell: Cell): void {
  if (fromId === toId) return;
  const dc = toCell.c - fromCell.c, dr = toCell.r - fromCell.r;
  for (const p of doc.paths) {
    const prevs = p.segments.map((_, j) => prevNode(p, j)), abs = p.segments.map((_, j) => cpAbs(p, j));
    const map = (n: Node): Node => (n.pointId === fromId ? cloneNode({ ...n, cell: { c: n.cell.c + dc, r: n.cell.r + dr }, pointId: toId }) : n);
    p.start = map(p.start);
    const keep: Segment[] = [];
    let prev = p.start;
    p.segments.forEach((s, j) => {
      const to = map(s.to);
      if (sameNode(prev, to)) return;                                                  // zero-length: dropped
      const c = abs[j];
      keep.push({ to, cp: c && prev !== prevs[j] ? rel(c, prev.cell) : s.cp });       // re-base only after a replaced node
      prev = to;
    });
    p.segments = keep;
  }
  withViaRepair(doc, () => {
    doc.paths = doc.paths.filter((p) => p.segments.length > 0);
    const kept = new Set(doc.paths.map((p) => p.id));
    doc.bindings = doc.bindings.filter((b) => kept.has(b.pathId));
    pruneOrphans(doc);
  });
}

export function setControlPointAbs(doc: Doc, pathId: string, j: number, abs: UV | null): void {
  const p = getPath(doc, pathId);
  if (!p) return;
  p.segments[j].cp = abs ? rel(abs, prevNode(p, j).cell) : null;
}

export function setControlPointWorld(doc: Doc, pathId: string, j: number, xy: XY | null): void {
  setControlPointAbs(doc, pathId, j, xy ? toUV(xy, doc.lattice) : null);
}

// Apply a world matrix: each distinct point once (in its first cell), and every control point. A via node moves by M
// like any other node, so its underlying point moves by V⁻¹ M V (V being the copy's matrix).
export function transformPath(doc: Doc, pathId: string, M: Matrix): void {
  const p = getPath(doc, pathId);
  if (!p) return;
  const cps = p.segments.map((_, j) => cpWorld(doc, p, j));
  const seen = new Set<string>();
  for (const n of pathNodes(p)) {
    if (seen.has(n.pointId)) continue;
    seen.add(n.pointId);
    const pt = getPoint(doc, n.pointId)!;
    let Mn = M;
    if (n.via) { const V = viaMatrix(doc, n.via); Mn = compose(invert(V), compose(M, V)); }
    const w = apply(Mn, toWorld(nodeUV(pt, n.cell), doc.lattice));
    const uv = toUV(w, doc.lattice);
    pt.u = uv.u - n.cell.c; pt.v = uv.v - n.cell.r;
  }
  p.segments.forEach((s, j) => { const c = cps[j]; s.cp = c ? rel(toUV(apply(M, c), doc.lattice), prevNode(p, j).cell) : null; });
}

export function boundsWorld(doc: Doc, path: Path, M: Matrix = IDENTITY): Box {
  const W = pathWorld(doc, path).concat(pathCpsWorld(doc, path).filter((c): c is XY => !!c)).map((q) => apply(M, q));
  const xs = W.map((q) => q.x), ys = W.map((q) => q.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// --- elements, bindings, fills

type ElementSpec =
  | { kind: 'translate'; u: number; v: number }
  | { kind: 'mirror'; u: number; v: number; du: number; dv: number }
  | { kind: 'rotate'; u: number; v: number; n: number };

export function addElement(doc: Doc, spec: ElementSpec): Element {
  const e = { id: makeId('el'), ...spec } as Element;
  doc.elements.push(e);
  return e;
}

const pruneGroups = (groups: string[][], id: string): string[][] => groups.map((g) => g.filter((x) => x !== id)).filter((g) => g.length);

// A via node's identity, stable across structuredClone of a draft: the same node in a snapshot and in the draft share it.
const viaKey = (n: Node) => `${n.pointId}|${n.cell.c}|${n.cell.r}|${n.via!.cell.c}|${n.via!.cell.r}|${n.via!.bindingId}|${n.via!.power}`;

// Every via node's world position, keyed by identity: take it before a change that may remove bindings or clone slots.
export function viaSnapshot(doc: Doc): Map<string, XY> {
  const out = new Map<string, XY>();
  for (const p of doc.paths) for (const n of pathNodes(p)) if (n.via) { const k = viaKey(n); if (!out.has(k)) out.set(k, nodeWorld(doc, n)); }
  return out;
}

// Turn every via node whose copy is no longer live into a plain node at a new free point where the snapshot saw it
// (or, for a node the snapshot does not know, where it is now). One new point per dead via identity, so a path
// closed on it stays closed. Control points stay where they were: a materialised node's cell generally differs from
// the via node's, so the cp of the segment leaving it is re-based. Returns whether anything was materialised.
export function repairVia(doc: Doc, snap: Map<string, XY>): boolean {
  let repaired = false;
  const made = new Map<string, Node>();
  for (const p of doc.paths) {
    const prevs = p.segments.map((_, j) => prevNode(p, j)), abs = p.segments.map((_, j) => cpAbs(p, j));
    const fix = (n: Node): Node => {
      if (!n.via || viaLive(doc, n.via)) return n;
      const key = viaKey(n);
      let m = made.get(key);
      if (!m) { const w = snap.get(key) ?? nodeWorld(doc, n); m = addPoint(doc, toUV(w, doc.lattice)); made.set(key, m); repaired = true; }
      return cloneNode(m);
    };
    p.start = fix(p.start);
    for (const s of p.segments) s.to = fix(s.to);
    p.segments.forEach((s, j) => { const c = abs[j], q = prevNode(p, j); if (c && q !== prevs[j]) s.cp = rel(c, q.cell); });   // re-base only after a replaced node
  }
  if (repaired) pruneOrphans(doc);   // the point a materialised node used to see may now be unreferenced
  return repaired;
}

// viaSnapshot, apply a change that may remove bindings or clone slots, then repairVia. Only the outermost call
// snapshots and repairs (an inner one would snapshot a half-applied change); nested calls just run their body.
// `mutate` (actions.ts) and gestures (state/history.ts) do the same around every user-level mutation, so a draft
// change that forgets this wrapper is still repaired; the wrapper remains for engine-level callers and tests.
let viaRepairDepth = 0;
export function withViaRepair(doc: Doc, fn: () => void): void {
  if (viaRepairDepth > 0) { fn(); return; }
  const snap = viaSnapshot(doc);
  viaRepairDepth++;
  try { fn(); } finally { viaRepairDepth--; }
  if (snap.size) repairVia(doc, snap);
}

// Deleting an element removes it from every group (in place, so a held Binding stays current); an emptied group
// goes, and a binding with no groups goes.
export function deleteElement(doc: Doc, id: string): void {
  withViaRepair(doc, () => {
    doc.elements = doc.elements.filter((e) => e.id !== id);
    for (const b of doc.bindings) b.groups = pruneGroups(b.groups, id);
    doc.bindings = doc.bindings.filter((b) => b.groups.length);
    doc.newPathGroups = pruneGroups(doc.newPathGroups, id);
  });
}

export function addBinding(doc: Doc, pathId: string, groups: string[][] = []): Binding {
  const b: Binding = { id: makeId('bind'), pathId, groups: groups.map((g) => g.slice()) };
  doc.bindings.push(b);
  return b;
}

const sameGroups = (a: string[][], b: string[][]) => a.length === b.length && a.every((g, i) => g.length === b[i].length && g.every((x, j) => x === b[i][j]));

// Put an element in group gi of a binding (gi === groups.length starts a new group). An element appears at most
// once per binding, so it is first removed from wherever it was; a group emptied by that removal is dropped and gi
// shifts down with it. A placement that leaves the groups as they were (into the group it is already in, or the sole
// element of the last group into the new group after it) changes nothing and returns false.
export function placeInGroup(doc: Doc, bindingId: string, elementId: string, gi: number): boolean {
  const b = getBinding(doc, bindingId);
  if (!b) return false;
  const from = b.groups.findIndex((g) => g.includes(elementId));
  if (from >= 0 && from === gi) return false;
  const groups = b.groups.map((g) => g.slice());
  if (from >= 0) {
    groups[from] = groups[from].filter((x) => x !== elementId);
    if (!groups[from].length) { groups.splice(from, 1); if (from < gi) gi--; }
  }
  gi = Math.max(0, Math.min(gi, groups.length));
  if (gi === groups.length) groups.push([elementId]); else groups[gi].push(elementId);
  if (sameGroups(groups, b.groups)) return false;
  withViaRepair(doc, () => { b.groups = groups; });
  return true;
}

export function removeFromBinding(doc: Doc, bindingId: string, elementId: string): void {
  const b = getBinding(doc, bindingId);
  if (!b) return;
  withViaRepair(doc, () => {
    b.groups = pruneGroups(b.groups, elementId);
    if (!b.groups.length) removeBinding(doc, bindingId);
  });
}

export function removeBinding(doc: Doc, id: string): void {
  withViaRepair(doc, () => { doc.bindings = doc.bindings.filter((b) => b.id !== id); });
}

// The group a drag of clone `power`'s body should drive: the first group with a nonzero power in the copy's clone
// index (moving its first element moves that copy), or the first group when the index decodes to all zeros.
export function dragGroupFor(b: Binding, power: number, elements: Element[], lat: Lattice, ownCap = 12): string[] | null {
  if (!b.groups.length) return null;
  const gi = clonePowers(b.groups, elements, lat, power, ownCap).findIndex((p) => p > 0);
  return b.groups[gi >= 0 ? gi : 0];
}

export function cloneMatrices(doc: Doc, bindingId: string, ownCap = CONFIG.ORBIT_CAP, cloneCap = CONFIG.CLONE_CAP): Orbit {
  const b = getBinding(doc, bindingId);
  return b ? orbit(b.groups, doc.elements, doc.lattice, ownCap, cloneCap) : { matrices: [], open: false };
}

export function addFill(doc: Doc, uv: UV, color: string, layerId: string): Fill {
  const f: Fill = { id: makeId('fill'), u: uv.u, v: uv.v, color, layerId };
  doc.fills.push(f);
  return f;
}

export function removeFill(doc: Doc, id: string): void { doc.fills = doc.fills.filter((f) => f.id !== id); }

// --- layers (bottom to top)

export function addLayer(doc: Doc, name = `Layer ${doc.layers.length + 1}`): DocLayer {
  const l: DocLayer = { id: makeId('layer'), name };
  doc.layers.push(l);
  return l;
}
export const topLayerId = (doc: Doc): string => doc.layers[doc.layers.length - 1].id;
export const layerIdOr = (doc: Doc, id: string | null | undefined): string => (id && doc.layers.some((l) => l.id === id) ? id : topLayerId(doc));
