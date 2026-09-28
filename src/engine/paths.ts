// Draft mutations. Every function takes a Doc draft and mutates it; nothing here touches UI state.
import { makeId } from '../ids';
import { toWorld, toUV, cellOf, nodeUV } from './lattice';
import { IDENTITY, apply, orbit } from './transform';
import type { Doc, UV, XY, Cell, Node, Segment, Path, Element, Binding, Fill, Matrix, Style, PathLayer, Box } from '../types';

export const getPoint = (doc: Doc, id: string) => doc.points.find((p) => p.id === id) ?? null;
export const getPath = (doc: Doc, id: string) => doc.paths.find((p) => p.id === id) ?? null;
export const getElement = (doc: Doc, id: string) => doc.elements.find((e) => e.id === id) ?? null;
export const getBinding = (doc: Doc, id: string) => doc.bindings.find((b) => b.id === id) ?? null;
export const getFill = (doc: Doc, id: string) => doc.fills.find((f) => f.id === id) ?? null;

export function sameNode(a: Node, b: Node): boolean {
  return a.pointId === b.pointId && a.cell.c === b.cell.c && a.cell.r === b.cell.r;
}
const cloneNode = (n: Node): Node => ({ pointId: n.pointId, cell: { c: n.cell.c, r: n.cell.r } });

export function pathNodes(path: Path): Node[] { return [path.start, ...path.segments.map((s) => s.to)]; }
export function prevNode(path: Path, j: number): Node { return j === 0 ? path.start : path.segments[j - 1].to; }

export function nodeUVAbs(doc: Doc, node: Node): UV {
  const p = getPoint(doc, node.pointId);
  if (!p) throw new Error(`missing point ${node.pointId}`);
  return nodeUV(p, node.cell);
}
export function nodeWorld(doc: Doc, node: Node): XY { return toWorld(nodeUVAbs(doc, node), doc.lattice); }
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

export function startPath(doc: Doc, node: Node, style: Style, layer: PathLayer = 'structure'): Path {
  const path: Path = { id: makeId('path'), start: cloneNode(node), segments: [], style: { ...style }, layer };
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

// Split segment j. Straight: at `uv` (absolute). Curved: at t = 0.5, ignoring `uv`. Affine, so lattice coords are fine.
export function insertNode(doc: Doc, pathId: string, j: number, uv: UV | null): Node {
  const p = getPath(doc, pathId);
  if (!p) throw new Error('no path');
  const seg = p.segments[j], prev = prevNode(p, j);
  const A = nodeUVAbs(doc, prev), B = nodeUVAbs(doc, seg.to), cp = cpAbs(p, j);
  let m: UV, c0: UV | null, c1: UV | null;
  if (cp) {
    m = { u: 0.25 * A.u + 0.5 * cp.u + 0.25 * B.u, v: 0.25 * A.v + 0.5 * cp.v + 0.25 * B.v };
    c0 = { u: (A.u + cp.u) / 2, v: (A.v + cp.v) / 2 };
    c1 = { u: (cp.u + B.u) / 2, v: (cp.v + B.v) / 2 };
  } else {
    if (!uv) throw new Error('straight insert needs a position');
    m = uv; c0 = null; c1 = null;
  }
  const node = addPoint(doc, m);
  const s0: Segment = { to: node, cp: c0 && rel(c0, prev.cell) };
  const s1: Segment = { to: seg.to, cp: c1 && rel(c1, node.cell) };
  p.segments.splice(j, 1, s0, s1);
  return node;
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
  doc.paths = keep;
  doc.bindings = doc.bindings.filter((b) => kept.has(b.pathId));
  pruneOrphans(doc);
}

export function deletePath(doc: Doc, pathId: string): void {
  doc.paths = doc.paths.filter((p) => p.id !== pathId);
  doc.bindings = doc.bindings.filter((b) => b.pathId !== pathId);
  pruneOrphans(doc);
}

export function openEndAt(doc: Doc, pointId: string): string | null {
  const p = doc.paths.find((q) => q.segments.length > 0 && !isClosed(q) && (q.start.pointId === pointId || q.segments[q.segments.length - 1].to.pointId === pointId));
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

// Make `pointId` the last node, placed in `cell`, reversing and shifting cells as needed. Relative cps need no change on a shift.
export function orientToEnd(doc: Doc, pathId: string, pointId: string, cell: Cell): void {
  const p = getPath(doc, pathId);
  if (!p || !p.segments.length) return;
  if (p.segments[p.segments.length - 1].to.pointId !== pointId) reversePath(p);
  const last = p.segments[p.segments.length - 1].to;
  const dc = cell.c - last.cell.c, dr = cell.r - last.cell.r;
  if (!dc && !dr) return;
  const shift = (n: Node): Node => ({ pointId: n.pointId, cell: { c: n.cell.c + dc, r: n.cell.r + dr } });
  p.start = shift(p.start);
  p.segments = p.segments.map((s) => ({ to: shift(s.to), cp: s.cp }));
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

export function setControlPointAbs(doc: Doc, pathId: string, j: number, abs: UV | null): void {
  const p = getPath(doc, pathId);
  if (!p) return;
  p.segments[j].cp = abs ? rel(abs, prevNode(p, j).cell) : null;
}

export function setControlPointWorld(doc: Doc, pathId: string, j: number, xy: XY | null): void {
  setControlPointAbs(doc, pathId, j, xy ? toUV(xy, doc.lattice) : null);
}

// Apply a world matrix: each distinct point once (in its first cell), and every control point.
export function transformPath(doc: Doc, pathId: string, M: Matrix): void {
  const p = getPath(doc, pathId);
  if (!p) return;
  const cps = p.segments.map((_, j) => cpWorld(doc, p, j));
  const seen = new Set<string>();
  for (const n of pathNodes(p)) {
    if (seen.has(n.pointId)) continue;
    seen.add(n.pointId);
    const pt = getPoint(doc, n.pointId)!;
    const w = apply(M, toWorld(nodeUV(pt, n.cell), doc.lattice));
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

export function deleteElement(doc: Doc, id: string): void {
  doc.elements = doc.elements.filter((e) => e.id !== id);
  doc.bindings = doc.bindings.filter((b) => !b.ops.includes(id));
  doc.newPathOps = doc.newPathOps.map((c) => c.filter((x) => x !== id)).filter((c) => c.length);
}

export function addBinding(doc: Doc, pathId: string, ops: string[] = []): Binding {
  const b: Binding = { id: makeId('bind'), pathId, ops: ops.slice() };
  doc.bindings.push(b);
  return b;
}

export function toggleOp(doc: Doc, bindingId: string, elementId: string): void {
  const b = getBinding(doc, bindingId);
  if (!b) return;
  const i = b.ops.indexOf(elementId);
  if (i >= 0) b.ops.splice(i, 1); else b.ops.push(elementId);
}

export function removeBinding(doc: Doc, id: string): void { doc.bindings = doc.bindings.filter((b) => b.id !== id); }

export function cloneMatrices(doc: Doc, bindingId: string, cap = 12): { matrices: Matrix[]; open: boolean } {
  const b = getBinding(doc, bindingId);
  return b ? orbit(b.ops, doc.elements, doc.lattice, cap) : { matrices: [], open: false };
}

export function addFill(doc: Doc, uv: UV, color: string): Fill {
  const f: Fill = { id: makeId('fill'), u: uv.u, v: uv.v, color };
  doc.fills.push(f);
  return f;
}

export function removeFill(doc: Doc, id: string): void { doc.fills = doc.fills.filter((f) => f.id !== id); }
