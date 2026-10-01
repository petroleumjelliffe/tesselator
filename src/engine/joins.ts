// What a snap does on release (spec 2026-09-30 §6.4): share a node, split a line and share the new node (a via node
// when it is seen through a clone), or place a new point. Joins happen only within a layer (O2). Draft mutations.
import { toUV } from './lattice';
import { getPath, pathNodes, pathWorld, pathCpsWorld, insertNodeAt, addPoint, mergeIntoNode } from './paths';
import { nearestOnSeg } from './snap';
import type { Doc, XY, Cell, Node, Copy, SnapHit, SnapResult } from '../types';

const clampT = (t: number) => Math.max(0.02, Math.min(0.98, t));

export function joinable(doc: Doc, hit: SnapHit, layerId: string): boolean {
  if (hit.kind === 'curve') return getPath(doc, hit.pathId)?.layerId === layerId;
  if (hit.kind === 'node') {
    const users = doc.paths.filter((p) => pathNodes(p).some((n) => n.pointId === hit.pointId));
    return users.length > 0 && users.every((p) => p.layerId === layerId);
  }
  return false;
}

// The node a seen point becomes: raw (its cell already includes the copy's cell) or through a clone (a via node).
function seenNode(pointId: string, cell: Cell, copy: Copy, raw: boolean): Node {
  return copy.bindingId
    ? { pointId, cell: { ...cell }, via: { cell: { ...copy.cell }, bindingId: copy.bindingId, power: copy.power } }
    : raw ? { pointId, cell: { ...cell } } : { pointId, cell: { c: cell.c + copy.cell.c, r: cell.r + copy.cell.r } };
}

export function nodeForSnap(doc: Doc, s: SnapResult | null, w: XY, layerId: string): Node {
  const h = s?.hit;
  if (h && h.kind === 'node' && joinable(doc, h, layerId)) return seenNode(h.pointId, h.cell, h.copy, true);
  if (h && h.kind === 'curve' && joinable(doc, h, layerId)) {
    const n = insertNodeAt(doc, h.pathId, h.j, clampT(h.t));
    return seenNode(n.pointId, n.cell, h.copy, false);
  }
  return addPoint(doc, toUV(s ? s.at : w, doc.lattice));
}

export function joinPointToHit(doc: Doc, fromId: string, fromCell: Cell, hit: SnapHit, layerId: string): boolean {
  if ((hit.kind !== 'node' && hit.kind !== 'curve') || !joinable(doc, hit, layerId)) return false;
  if (doc.paths.some((p) => pathNodes(p).some((n) => n.via && n.pointId === fromId))) return false;   // a via onto a via is not representable
  let target: Node;
  if (hit.kind === 'node') {
    if (hit.pointId === fromId) return false;
    target = seenNode(hit.pointId, hit.cell, hit.copy, true);
  } else {
    const n = insertNodeAt(doc, hit.pathId, hit.j, clampT(hit.t));
    target = seenNode(n.pointId, n.cell, hit.copy, false);
  }
  mergeIntoNode(doc, fromId, fromCell, target);
  return true;
}

export function splitNearest(doc: Doc, pathId: string, at: XY, maxJ: number): Node | null {
  const p = getPath(doc, pathId);
  if (!p) return null;
  const W = pathWorld(doc, p), C = pathCpsWorld(doc, p);
  let best: { j: number; t: number; d: number } | null = null;
  for (let j = 0; j < Math.min(maxJ, p.segments.length); j++) {
    const r = nearestOnSeg(W[j], C[j], W[j + 1], at);
    if (!best || r.d < best.d) best = { j, t: r.t, d: r.d };
  }
  if (!best) return null;
  const nodes = pathNodes(p);
  if (best.t < 0.02) return nodes[best.j];
  if (best.t > 0.98) return nodes[best.j + 1];
  return insertNodeAt(doc, pathId, best.j, best.t);
}
