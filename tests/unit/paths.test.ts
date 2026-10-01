import { test, expect } from 'vitest';
import * as P from '../../src/engine/paths';
import { rotation, translation, cloneCount } from '../../src/engine/transform';
import { CONFIG } from '../../src/config';
import type { Doc, UV, XY } from '../../src/types';

function makeDoc(): Doc {
  return { version: 2, lattice: { ...CONFIG.LATTICE_PRESETS.Square }, points: [], paths: [], elements: [], bindings: [], fills: [], layers: [{ id: 'L1', name: 'Layer 1' }], newPathGroups: [] };
}
const style = { color: '#000', weight: 2 };
function polyline(doc: Doc, pts: UV[], close = false) {
  const nodes = pts.map((p) => P.addPoint(doc, p));
  const path = P.startPath(doc, nodes[0], style, 'L1');
  for (const n of nodes.slice(1)) P.appendNode(doc, path.id, n);
  if (close) P.appendNode(doc, path.id, nodes[0]);
  return path;
}

test('addPoint stores the cell-local point and the cell; nodeWorld maps through the lattice', () => {
  const doc = makeDoc();
  const n = P.addPoint(doc, { u: 1.25, v: 0.5 });
  expect(n.cell).toEqual({ c: 1, r: 0 });
  expect(P.getPoint(doc, n.pointId)!.u).toBeCloseTo(0.25, 9);
  expect(P.nodeWorld(doc, n)).toEqual({ x: 300, y: 120 });
});

test('append and insert keep segments consistent; a repeat of the last node is ignored', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0, v: 0 }, { u: 0.5, v: 0 }, { u: 0.5, v: 0.5 }]);
  expect(path.segments).toHaveLength(2);
  expect(P.appendNode(doc, path.id, path.segments[1].to)).toBe(false);
  P.insertNode(doc, path.id, 0, { u: 0.25, v: 0 });
  expect(path.segments).toHaveLength(3);
  expect(P.nodeWorld(doc, path.segments[0].to)).toEqual({ x: 60, y: 0 });
});

test('inserting into a curved segment splits at t = 0.5 with halved control points, kept relative to their cells', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0, v: 0 }, { u: 1, v: 0 }]);
  P.setControlPointAbs(doc, path.id, 0, { u: 0.5, v: 1 });
  const node = P.insertNode(doc, path.id, 0, null);
  expect(P.nodeUVAbs(doc, node)).toEqual({ u: 0.5, v: 0.5 });
  expect(P.cpAbs(path, 0)).toEqual({ u: 0.25, v: 0.5 });
  expect(P.cpAbs(path, 1)).toEqual({ u: 0.75, v: 0.5 });
  expect(path.segments[0].cp).toEqual({ u: 0.25, v: 0.5 });      // relative to cell (0,0)
  expect(path.segments[1].cp).toEqual({ u: 0.75, v: 0.5 });      // node is in cell (0,0) too
});

test('control points are stored relative to the previous node cell, so a wrapped segment keeps cp local', () => {
  const doc = makeDoc();
  const a = P.addPoint(doc, { u: 0.9, v: 0.5 });
  const path = P.startPath(doc, { pointId: a.pointId, cell: { c: 1, r: 0 } }, style, 'L1');
  P.appendNode(doc, path.id, P.addPoint(doc, { u: 2.2, v: 0.5 }));
  P.setControlPointWorld(doc, path.id, 0, { x: 2.0 * 240, y: 0.7 * 240 });
  expect(path.segments[0].cp!.u).toBeCloseTo(1.0, 9);   // 2.0 − cell 1
  expect(path.segments[0].cp!.v).toBeCloseTo(0.7, 9);
  expect(P.cpWorld(doc, path, 0)!.x).toBeCloseTo(480, 9);
});

test('a path is closed only when the last node is the start node in the same cell', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0.1, v: 0.1 }, { u: 0.5, v: 0.1 }, { u: 0.5, v: 0.5 }]);
  expect(P.isClosed(path)).toBe(false);
  P.appendNode(doc, path.id, path.start);
  expect(P.isClosed(path)).toBe(true);
  const wrap = polyline(doc, [{ u: 0.1, v: 0.1 }, { u: 0.5, v: 0.1 }]);
  P.appendNode(doc, wrap.id, { pointId: wrap.start.pointId, cell: { c: 1, r: 0 } });
  expect(P.isClosed(wrap)).toBe(false);
  expect(P.nodeWorld(doc, wrap.segments[1].to).x).toBeCloseTo(264, 9);
});

test('deletePoints removes every occurrence, bridges straight, prunes orphans and bindings', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0.1, v: 0.1 }, { u: 0.5, v: 0.1 }, { u: 0.5, v: 0.5 }, { u: 0.1, v: 0.5 }], true);
  P.setControlPointAbs(doc, path.id, 1, { u: 0.6, v: 0.3 });
  const el = P.addElement(doc, { kind: 'rotate', u: 0.5, v: 0.5, n: 2 });
  P.addBinding(doc, path.id, [[el.id]]);
  P.deletePoints(doc, [path.start.pointId]);
  expect(P.pathNodes(path)).toHaveLength(3);
  expect(path.segments).toHaveLength(2);
  expect(path.segments[0].cp).toEqual({ u: 0.6, v: 0.3 });
  expect(doc.points).toHaveLength(3);
  expect(doc.bindings).toHaveLength(1);
  P.deletePoints(doc, [path.start.pointId, path.segments[0].to.pointId]);
  expect(doc.paths).toHaveLength(0);
  expect(doc.points).toHaveLength(0);
  expect(doc.bindings).toHaveLength(0);
});

test('deletePath removes bindings and orphaned points but keeps shared points', () => {
  const doc = makeDoc();
  const a = polyline(doc, [{ u: 0, v: 0 }, { u: 0.2, v: 0 }]);
  const b = P.startPath(doc, a.segments[0].to, style, 'L1');
  P.appendNode(doc, b.id, P.addPoint(doc, { u: 0.2, v: 0.2 }));
  P.addBinding(doc, a.id, []);
  P.deletePath(doc, a.id);
  expect(doc.paths).toHaveLength(1);
  expect(doc.points).toHaveLength(2);
  expect(doc.bindings).toHaveLength(0);
});

test('openEndAt / reversePath / orientToEnd keep control points on the right side of the segment', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0.1, v: 0.1 }, { u: 0.5, v: 0.1 }, { u: 0.5, v: 0.5 }]);
  P.setControlPointAbs(doc, path.id, 0, { u: 0.3, v: -0.1 });
  const first = path.start.pointId;
  expect(P.openEndAt(doc, first)).toBe(path.id);
  expect(P.openEndAt(doc, path.segments[0].to.pointId)).toBe(null);
  P.orientToEnd(doc, path.id, first, { c: 1, r: 0 });
  const last = path.segments[1].to;
  expect(last.pointId).toBe(first);
  expect(last.cell).toEqual({ c: 1, r: 0 });
  expect(P.cpAbs(path, 1)!.u).toBeCloseTo(1.3, 9);   // shifted one cell with the path
  expect(P.cpAbs(path, 1)!.v).toBeCloseTo(-0.1, 9);
});

test('movePoint carries both neighbouring control points rigidly; movePointsBy moves a shared one once', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0, v: 0 }, { u: 0.4, v: 0 }, { u: 0.8, v: 0 }]);
  P.setControlPointAbs(doc, path.id, 0, { u: 0.2, v: 0.2 });
  P.setControlPointAbs(doc, path.id, 1, { u: 0.6, v: 0.2 });
  const [n0, n1] = P.pathNodes(path);
  P.movePoint(doc, n1.pointId, 0.4, 0.1);                   // the middle node moves by (0, 0.1)
  expect(P.cpAbs(path, 0)!.v).toBeCloseTo(0.3, 9);
  expect(P.cpAbs(path, 1)!.v).toBeCloseTo(0.3, 9);
  expect(P.cpAbs(path, 0)!.u).toBeCloseTo(0.2, 9);
  const ids = [n0.pointId, n1.pointId];
  P.movePointsBy(doc, ids, P.snapshotPositions(doc, ids), 0, 0.1);   // both ends of segment 0, one end of segment 1
  expect(P.cpAbs(path, 0)!.v).toBeCloseTo(0.4, 9);
  expect(P.cpAbs(path, 1)!.v).toBeCloseTo(0.4, 9);
});

test('transformPath applies a world matrix to points and control points and maps back to lattice coords', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0, v: 0 }, { u: 0.5, v: 0 }]);
  P.setControlPointAbs(doc, path.id, 0, { u: 0.25, v: 0.25 });
  P.transformPath(doc, path.id, rotation(Math.PI / 2, 0, 0));
  const w = P.pathWorld(doc, path);
  expect(w[1].x).toBeCloseTo(0, 6); expect(w[1].y).toBeCloseTo(120, 6);
  const cp = P.cpWorld(doc, path, 0)!;
  expect(cp.x).toBeCloseTo(-60, 6); expect(cp.y).toBeCloseTo(60, 6);
  const b = P.boundsWorld(doc, path);
  expect(b.x0).toBeCloseTo(-60, 6); expect(b.y1).toBeCloseTo(120, 6);
});

test('changing the lattice leaves every lattice coordinate untouched', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0.1, v: 0.1 }, { u: 0.6, v: 0.1 }]);
  P.setControlPointAbs(doc, path.id, 0, { u: 0.35, v: 0.3 });
  const before = JSON.stringify([doc.points, doc.paths]);
  doc.lattice = { ...CONFIG.LATTICE_PRESETS['Hex / triangle'] };
  expect(JSON.stringify([doc.points, doc.paths])).toBe(before);
  expect(P.cpWorld(doc, path, 0)!.x).toBeCloseTo(0.35 * 240 + 0.3 * -120, 6);
});

test('bindings hold groups; cloneMatrices is the group product; deleting an element prunes groups, then bindings', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0, v: 0 }, { u: 0.5, v: 0 }]);
  const m = P.addElement(doc, { kind: 'mirror', u: 0, v: 0.5, du: 1, dv: 0 });
  const t = P.addElement(doc, { kind: 'translate', u: 0.5, v: 0 });
  const mb = P.addElement(doc, { kind: 'mirror', u: 0.5, v: 0, du: 0, dv: 1 });
  const b = P.addBinding(doc, path.id, [[m.id, t.id], [mb.id]]);
  expect(cloneCount(P.cloneMatrices(doc, b.id))).toBe(3);
  doc.newPathGroups = [[m.id, t.id], [mb.id]];
  P.deleteElement(doc, mb.id);
  expect(b.groups).toEqual([[m.id, t.id]]);
  expect(doc.newPathGroups).toEqual([[m.id, t.id]]);
  P.deleteElement(doc, m.id); P.deleteElement(doc, t.id);
  expect(doc.bindings).toHaveLength(0);
  expect(doc.newPathGroups).toEqual([]);
});

test('placeInGroup / removeFromBinding move an element between groups and never leave an empty group', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0, v: 0 }, { u: 0.5, v: 0 }]);
  const a = P.addElement(doc, { kind: 'mirror', u: 0.5, v: 0.5, du: 1, dv: 0 });
  const c = P.addElement(doc, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });
  const b = P.addBinding(doc, path.id, [[a.id]]);
  expect(P.placeInGroup(doc, b.id, c.id, 1)).toBe(true);   // gi === groups.length → new group
  expect(b.groups).toEqual([[a.id], [c.id]]);
  expect(P.placeInGroup(doc, b.id, a.id, 0)).toBe(false);  // already in group 0: nothing changes
  expect(b.groups).toEqual([[a.id], [c.id]]);
  expect(P.placeInGroup(doc, b.id, c.id, 2)).toBe(false);  // the sole element of the last group into the new group after it: nothing changes
  expect(b.groups).toEqual([[a.id], [c.id]]);
  P.placeInGroup(doc, b.id, c.id, 0);                 // moves into group 0; its old group is dropped
  expect(b.groups).toEqual([[a.id, c.id]]);
  P.placeInGroup(doc, b.id, a.id, 1);                 // out of group 0 into a new group after it
  expect(b.groups).toEqual([[c.id], [a.id]]);
  P.removeFromBinding(doc, b.id, c.id);
  expect(b.groups).toEqual([[a.id]]);
  expect(P.placeInGroup(doc, b.id, a.id, 1)).toBe(false);  // [[a]] with a into the new group: nothing changes
  expect(b.groups).toEqual([[a.id]]);
  P.removeFromBinding(doc, b.id, a.id);
  expect(doc.bindings).toHaveLength(0);               // a binding with no groups is removed
});

test('dragGroupFor picks the first group with a nonzero power in the clone index, falling back to the first group', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0, v: 0 }, { u: 0.5, v: 0 }]);
  const r2 = P.addElement(doc, { kind: 'rotate', u: 0.5, v: 0.5, n: 2 });
  const m = P.addElement(doc, { kind: 'mirror', u: 0, v: 0.5, du: 1, dv: 0 });
  const b = P.addBinding(doc, path.id, [[r2.id], [m.id]]);           // slots: 1 = r2, 2 = m, 3 = m ∘ r2
  expect(P.dragGroupFor(b, 1, doc.elements, doc.lattice)).toEqual([r2.id]);
  expect(P.dragGroupFor(b, 2, doc.elements, doc.lattice)).toEqual([m.id]);
  expect(P.dragGroupFor(b, 3, doc.elements, doc.lattice)).toEqual([r2.id]);
  expect(P.dragGroupFor(b, 0, doc.elements, doc.lattice)).toEqual([r2.id]);   // all zeros / out of range → first group
  expect(P.dragGroupFor(b, 9, doc.elements, doc.lattice)).toEqual([r2.id]);
  expect(P.dragGroupFor({ id: 'x', pathId: path.id, groups: [] }, 1, doc.elements, doc.lattice)).toBe(null);
});

test('addLayer names layers in order and pushes on top; layerIdOr falls back to the top layer', () => {
  const doc = makeDoc();
  const l2 = P.addLayer(doc);
  expect(l2.name).toBe('Layer 2');
  expect(doc.layers.map((l) => l.id)).toEqual(['L1', l2.id]);
  expect(P.topLayerId(doc)).toBe(l2.id);
  expect(P.layerIdOr(doc, 'L1')).toBe('L1');
  expect(P.layerIdOr(doc, 'gone')).toBe(l2.id);
  expect(P.layerIdOr(doc, null)).toBe(l2.id);
});

test('fills are added and removed by id', () => {
  const doc = makeDoc();
  const f = P.addFill(doc, { u: 0.5, v: 0.5 }, '#f00', 'L1');
  expect(doc.fills).toHaveLength(1);
  P.removeFill(doc, f.id);
  expect(doc.fills).toHaveLength(0);
});

test('openEndAt ignores a path with no segments', () => {
  const doc = makeDoc();
  const n = P.addPoint(doc, { u: 0.1, v: 0.1 });
  P.startPath(doc, n, style, 'L1');
  expect(P.openEndAt(doc, n.pointId)).toBe(null);
});

const bez = (a: UV, c: UV | null, b: UV, t: number): UV => {
  if (!c) return { u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t };
  const s = 1 - t; return { u: s * s * a.u + 2 * s * t * c.u + t * t * b.u, v: s * s * a.v + 2 * s * t * c.v + t * t * b.v };
};

test('insertNodeAt splits a curve at any t without changing its outline', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0.1, v: 0.1 }, { u: 0.9, v: 0.2 }]);
  P.setControlPointAbs(doc, path.id, 0, { u: 0.5, v: 0.8 });
  const A = P.nodeUVAbs(doc, path.start), B = P.nodeUVAbs(doc, path.segments[0].to), C = P.cpAbs(path, 0)!;
  const node = P.insertNodeAt(doc, path.id, 0, 0.3);
  expect(path.segments).toHaveLength(2);
  const m = P.nodeUVAbs(doc, node), e = bez(A, C, B, 0.3);
  expect(m.u).toBeCloseTo(e.u, 12); expect(m.v).toBeCloseTo(e.v, 12);
  for (let i = 0; i <= 10; i++) {
    const s = i / 10;
    const first = bez(A, P.cpAbs(path, 0), P.nodeUVAbs(doc, node), s), orig = bez(A, C, B, 0.3 * s);
    expect(first.u).toBeCloseTo(orig.u, 9); expect(first.v).toBeCloseTo(orig.v, 9);
    const second = bez(P.nodeUVAbs(doc, node), P.cpAbs(path, 1), B, s), orig2 = bez(A, C, B, 0.3 + 0.7 * s);
    expect(second.u).toBeCloseTo(orig2.u, 9); expect(second.v).toBeCloseTo(orig2.v, 9);
  }
  const straight = polyline(doc, [{ u: 0, v: 0.5 }, { u: 0.4, v: 0.5 }]);
  const n2 = P.insertNodeAt(doc, straight.id, 0, 0.25);
  expect(P.nodeUVAbs(doc, n2)).toEqual({ u: 0.1, v: 0.5 });
  expect(straight.segments.map((s) => s.cp)).toEqual([null, null]);
});

test('nearestT finds the closest parameter on straight and curved segments, clamped away from the ends', () => {
  expect(P.nearestT({ x: 0, y: 0 }, null, { x: 100, y: 0 }, { x: 30, y: 7 })).toBeCloseTo(0.3, 9);
  expect(P.nearestT({ x: 0, y: 0 }, null, { x: 100, y: 0 }, { x: -50, y: 0 })).toBe(0.02);
  expect(P.nearestT({ x: 0, y: 0 }, null, { x: 100, y: 0 }, { x: 500, y: 0 })).toBe(0.98);
  const a = { x: 0, y: 0 }, c = { x: 50, y: 100 }, b = { x: 100, y: 0 };
  const q = (t: number) => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y });
  for (const t0 of [0.2, 0.5, 0.77]) {
    const p = q(t0), d = { x: 2 * ((1 - t0) * (c.x - a.x) + t0 * (b.x - c.x)), y: 2 * ((1 - t0) * (c.y - a.y) + t0 * (b.y - c.y)) }, L = Math.hypot(d.x, d.y);
    expect(P.nearestT(a, c, b, p)).toBeCloseTo(t0, 6);                                                        // on the curve
    expect(P.nearestT(a, c, b, { x: p.x - (3 * d.y) / L, y: p.y + (3 * d.x) / L })).toBeCloseTo(t0, 3);   // 3px along the normal
  }
});

test('via nodes: world position goes through the copy; sameNode and isClosed respect via; orientToEnd shifts via.cell', () => {
  const doc = makeDoc();
  const body = polyline(doc, [{ u: 0.1, v: 0.1 }, { u: 0.5, v: 0.1 }]);
  const m = P.addElement(doc, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });
  const b = P.addBinding(doc, body.id, [[m.id]]);
  const via = { cell: { c: 0, r: 1 }, bindingId: b.id, power: 1 };
  const tail = P.startPath(doc, { pointId: body.start.pointId, cell: body.start.cell, via }, style, 'L1');
  P.appendNode(doc, tail.id, P.addPoint(doc, { u: 0.9, v: 0.9 }));
  const w = P.nodeWorld(doc, tail.start);
  expect(w.x).toBeCloseTo(240 - 24, 9); expect(w.y).toBeCloseTo(24 + 240, 9);            // mirrored about x = 120, one cell down
  expect(P.nodeUVAbs(doc, tail.start).u).toBeCloseTo(0.9, 9); expect(P.nodeUVAbs(doc, tail.start).v).toBeCloseTo(1.1, 9);
  expect(P.sameNode(tail.start, { pointId: body.start.pointId, cell: body.start.cell })).toBe(false);
  expect(P.sameNode(tail.start, { pointId: body.start.pointId, cell: body.start.cell, via: { ...via } })).toBe(true);
  P.appendNode(doc, tail.id, tail.start);
  expect(P.isClosed(tail)).toBe(true);
  expect(P.appendNode(doc, tail.id, { ...tail.start, via: { ...via } })).toBe(false);   // repeat of the last node
  const open = P.startPath(doc, { pointId: body.start.pointId, cell: body.start.cell, via }, style, 'L1');
  const end = P.addPoint(doc, { u: 0.8, v: 0.8 });
  P.appendNode(doc, open.id, end);
  P.orientToEnd(doc, open.id, open.start.pointId, { c: 1, r: 0 });                   // reverse, then shift so the via node lands in cell (1,0)
  const last = open.segments[open.segments.length - 1].to;
  expect(last.via).toEqual({ cell: { c: 1, r: 1 }, bindingId: b.id, power: 1 });
  expect(last.cell).toEqual(body.start.cell);
  expect(open.start.cell).toEqual({ c: 1, r: 0 });
});

test('mergePoints rewrites every reference with the cell offset, re-bases control points, collapses a zero-length segment and deletes the point', () => {
  const doc = makeDoc();
  const a = polyline(doc, [{ u: 0.1, v: 0.1 }, { u: 0.5, v: 0.1 }, { u: 0.5, v: 0.5 }]);
  P.setControlPointAbs(doc, a.id, 1, { u: 0.7, v: 0.3 });
  const b = polyline(doc, [{ u: 0.9, v: 0.5 }, { u: 0.9, v: 0.9 }]);
  const from = a.segments[1].to, to = b.start;                       // drag a's last point (cell 0,0) onto b's start seen in cell (1,0)
  P.mergePoints(doc, from.pointId, from.cell, to.pointId, { c: 1, r: 0 });
  expect(doc.points.some((p) => p.id === from.pointId)).toBe(false);
  expect(a.segments[1].to).toEqual({ pointId: to.pointId, cell: { c: 1, r: 0 } });
  expect(P.cpAbs(a, 1)!.u).toBeCloseTo(0.7, 9); expect(P.cpAbs(a, 1)!.v).toBeCloseTo(0.3, 9);   // absolute cp unchanged
  expect(a.segments[1].cp).toEqual({ u: 0.7 - 0, v: 0.3 - 0 });                                   // relative to the previous node's cell (0,0)
  // merging consecutive nodes collapses the segment between them
  const c = polyline(doc, [{ u: 0.2, v: 0.2 }, { u: 0.25, v: 0.2 }, { u: 0.6, v: 0.6 }]);
  const mid = c.segments[0].to;
  P.mergePoints(doc, mid.pointId, mid.cell, c.start.pointId, c.start.cell);
  expect(c.segments).toHaveLength(1);
  expect(c.segments[0].to.pointId).not.toBe(c.start.pointId);
});

test('withViaRepair materialises a via node at its last world position when its binding, element or slot goes away', () => {
  const make = () => {
    const doc = makeDoc();
    const body = polyline(doc, [{ u: 0.1, v: 0.1 }, { u: 0.5, v: 0.1 }]);
    const m = P.addElement(doc, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });
    const r = P.addElement(doc, { kind: 'rotate', u: 0.5, v: 0.5, n: 2 });
    const b = P.addBinding(doc, body.id, [[m.id], [r.id]]);                       // slots: m, r, r∘m
    const tail = P.startPath(doc, { pointId: body.start.pointId, cell: body.start.cell, via: { cell: { c: 0, r: 0 }, bindingId: b.id, power: 3 } }, style, 'L1');
    P.appendNode(doc, tail.id, P.addPoint(doc, { u: 0.9, v: 0.9 }));
    return { doc, body, m, r, b, tail, before: P.nodeWorld(doc, tail.start) };
  };
  const near = (p: XY, q: XY) => { expect(p.x).toBeCloseTo(q.x, 6); expect(p.y).toBeCloseTo(q.y, 6); };
  { const s = make(); P.removeBinding(s.doc, s.b.id); expect(s.tail.start.via).toBeUndefined(); near(P.nodeWorld(s.doc, s.tail.start), s.before); expect(s.doc.points).toHaveLength(4); }
  { const s = make(); P.deleteElement(s.doc, s.r.id); expect(s.tail.start.via).toBeUndefined(); near(P.nodeWorld(s.doc, s.tail.start), s.before); }
  { const s = make(); P.removeFromBinding(s.doc, s.b.id, s.r.id); expect(s.tail.start.via).toBeUndefined(); near(P.nodeWorld(s.doc, s.tail.start), s.before); }
  { const s = make(); P.placeInGroup(s.doc, s.b.id, s.r.id, 0); expect(s.tail.start.via).toBeUndefined(); near(P.nodeWorld(s.doc, s.tail.start), s.before); }   // [[m, r]] has one slot; slot 3 is gone
  { const s = make(); P.deletePath(s.doc, s.body.id); expect(s.tail.start.via).toBeUndefined(); near(P.nodeWorld(s.doc, s.tail.start), s.before); }
  { const s = make(); P.deleteElement(s.doc, s.m.id); expect(s.tail.start.via).toBeUndefined(); near(P.nodeWorld(s.doc, s.tail.start), s.before); }   // [[r]] has one slot; slot 3 is gone
});

// --- fix round 1

const closeXY = (p: XY, x: number, y: number) => { expect(p.x).toBeCloseTo(x, 6); expect(p.y).toBeCloseTo(y, 6); };
// A body with one mirror (x = 120) and a tail whose start is the body's start seen through that mirror's clone.
function mirroredTail(doc: Doc, viaCell = { c: 0, r: 0 }) {
  const body = polyline(doc, [{ u: 0.1, v: 0.1 }, { u: 0.5, v: 0.1 }]);
  const m = P.addElement(doc, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });
  const b = P.addBinding(doc, body.id, [[m.id]]);
  const tail = P.startPath(doc, { pointId: body.start.pointId, cell: body.start.cell, via: { cell: viaCell, bindingId: b.id, power: 1 } }, style, 'L1');
  const end = P.addPoint(doc, { u: 0.9, v: 0.9 });
  P.appendNode(doc, tail.id, end);
  return { body, m, b, tail, end };
}

test('removeFromBinding (a nested repair) materialises the via node where it was, not at its cell-only position', () => {
  const doc = makeDoc();
  const { m, b, tail } = mirroredTail(doc);
  closeXY(P.nodeWorld(doc, tail.start), 216, 24);
  P.removeFromBinding(doc, b.id, m.id);
  expect(doc.bindings).toHaveLength(0);
  expect(tail.start.via).toBeUndefined();
  closeXY(P.nodeWorld(doc, tail.start), 216, 24);
});

test('materialising a via node re-bases the control point of the segment leaving it', () => {
  const doc = makeDoc();
  const { b, tail } = mirroredTail(doc, { c: 0, r: 1 });
  P.setControlPointAbs(doc, tail.id, 0, { u: 0.5, v: 1.5 });
  expect(P.cpWorld(doc, tail, 0)).toEqual({ x: 120, y: 360 });
  P.removeBinding(doc, b.id);
  expect(tail.start.via).toBeUndefined();
  expect(tail.start.cell).toEqual({ c: 0, r: 1 });          // materialised at (0.9, 1.1): a different cell from the via node's (0,0)
  closeXY(P.cpWorld(doc, tail, 0)!, 120, 360);
});

test('orientToEnd shift moves the control point of a segment leaving a via node along with the path', () => {
  const doc = makeDoc();
  const { b, tail, end } = mirroredTail(doc);
  P.setControlPointAbs(doc, tail.id, 0, { u: 0.9, v: 0.5 });
  closeXY(P.cpWorld(doc, tail, 0)!, 216, 120);
  P.orientToEnd(doc, tail.id, end.pointId, { c: 1, r: 0 });   // already last: a pure shift by (1, 0)
  expect(tail.start.via).toEqual({ cell: { c: 1, r: 0 }, bindingId: b.id, power: 1 });
  expect(tail.start.cell).toEqual({ c: 0, r: 0 });
  closeXY(P.nodeWorld(doc, tail.start), 456, 24);
  closeXY(P.nodeWorld(doc, tail.segments[0].to), 456, 216);
  closeXY(P.cpWorld(doc, tail, 0)!, 456, 120);
});

test('transformPath moves a via node by M (its underlying point by V⁻¹ M V)', () => {
  const doc = makeDoc();
  const { body, tail } = mirroredTail(doc);
  const w0 = P.pathWorld(doc, tail);
  P.transformPath(doc, tail.id, translation(10, 0));
  const w1 = P.pathWorld(doc, tail);
  closeXY(w1[0], w0[0].x + 10, w0[0].y);
  closeXY(w1[1], w0[1].x + 10, w0[1].y);
  closeXY(P.nodeWorld(doc, body.start), 14, 24);             // the shared point moved −10 under the mirror
});

test('mergePoints drops the bindings of a path that collapses to nothing and repairs via nodes on them', () => {
  const doc = makeDoc();
  const { body, b, tail } = mirroredTail(doc);
  const before = P.nodeWorld(doc, tail.start);
  const from = body.segments[0].to;
  P.mergePoints(doc, from.pointId, from.cell, body.start.pointId, body.start.cell);
  expect(doc.paths.map((p) => p.id)).toEqual([tail.id]);
  expect(doc.bindings).toHaveLength(0);
  expect(doc.bindings.some((x) => x.id === b.id)).toBe(false);
  expect(tail.start.via).toBeUndefined();
  closeXY(P.nodeWorld(doc, tail.start), before.x, before.y);
  expect(doc.points).toHaveLength(2);
});

test('mergePoints rewrites a via node that references the merged point and keeps its world position', () => {
  const doc = makeDoc();
  const { body, b, tail } = mirroredTail(doc);
  const other = polyline(doc, [{ u: 0.3, v: 0.1 }, { u: 0.7, v: 0.7 }]);
  const fromId = body.start.pointId;
  P.movePoint(doc, fromId, 1.3, 0.1);                        // dragged one cell over, onto other.start seen in cell (1, 0)
  const before = P.nodeWorld(doc, tail.start);
  P.mergePoints(doc, fromId, body.start.cell, other.start.pointId, { c: 1, r: 0 });
  expect(tail.start).toEqual({ pointId: other.start.pointId, cell: { c: 1, r: 0 }, via: { cell: { c: 0, r: 0 }, bindingId: b.id, power: 1 } });
  closeXY(P.nodeWorld(doc, tail.start), before.x, before.y);
  expect(doc.points.some((q) => q.id === fromId)).toBe(false);
});

test('deletePath materialises via nodes on the deleted path and prunes the point they used to see', () => {
  const doc = makeDoc();
  const { body, tail } = mirroredTail(doc);
  const before = P.nodeWorld(doc, tail.start);
  P.deletePath(doc, body.id);
  expect(tail.start.via).toBeUndefined();
  closeXY(P.nodeWorld(doc, tail.start), before.x, before.y);
  expect(doc.points).toHaveLength(2);
});

test('a closed path that starts and ends on the same via node stays closed when the node is materialised', () => {
  const doc = makeDoc();
  const { b, tail } = mirroredTail(doc);
  P.appendNode(doc, tail.id, P.addPoint(doc, { u: 0.9, v: 0.5 }));
  P.appendNode(doc, tail.id, tail.start);
  expect(P.isClosed(tail)).toBe(true);
  const before = P.nodeWorld(doc, tail.start);
  P.removeBinding(doc, b.id);
  expect(tail.start.via).toBeUndefined();
  expect(P.isClosed(tail)).toBe(true);
  expect(tail.segments[tail.segments.length - 1].to).toEqual(tail.start);
  closeXY(P.nodeWorld(doc, tail.start), before.x, before.y);
  expect(doc.points).toHaveLength(5);                                                // body 2 + tail 2 free + one materialised
});

test('mergeIntoNode onto a clone rewrites every reference as a via node with shifted via cells', () => {
  const doc = makeDoc();
  const body = polyline(doc, [{ u: 0.1, v: 0.1 }, { u: 0.3, v: 0.1 }]);
  const el = P.addElement(doc, { kind: 'rotate', u: 0.5, v: 0.5, n: 2 });
  const b = P.addBinding(doc, body.id, [[el.id]]);
  const tail = polyline(doc, [{ u: 0.5, v: 0.6 }, { u: 0.85, v: 0.85 }]);
  const fromId = tail.segments[0].to.pointId;
  const other = P.startPath(doc, { pointId: tail.start.pointId, cell: { c: 1, r: 0 } }, { color: '#000', weight: 2 }, 'L1');
  P.appendNode(doc, other.id, { pointId: fromId, cell: { c: 1, r: 0 } });            // the same point seen in cell (1, 0)
  const target = { pointId: body.start.pointId, cell: { c: 0, r: 0 }, via: { cell: { c: 0, r: 0 }, bindingId: b.id, power: 1 } };
  const at = P.nodeWorld(doc, target);
  P.mergeIntoNode(doc, fromId, { c: 0, r: 0 }, target);
  expect(tail.segments[0].to).toEqual(target);
  expect(other.segments[0].to).toEqual({ ...target, via: { ...target.via, cell: { c: 1, r: 0 } } });
  closeXY(P.nodeWorld(doc, tail.segments[0].to), at.x, at.y);
  closeXY(P.nodeWorld(doc, other.segments[0].to), at.x + 240, at.y);
  expect(doc.points.some((q) => q.id === fromId)).toBe(false);
});

test('mergeIntoNode without a via is mergePoints', () => {
  const doc = makeDoc();
  const a = polyline(doc, [{ u: 0.1, v: 0.1 }, { u: 0.3, v: 0.1 }]);
  const c = polyline(doc, [{ u: 0.3, v: 0.5 }, { u: 0.31, v: 0.11 }]);
  const fromId = c.segments[0].to.pointId;
  P.mergeIntoNode(doc, fromId, { c: 0, r: 0 }, { pointId: a.segments[0].to.pointId, cell: { c: 0, r: 0 } });
  expect(c.segments[0].to).toEqual({ pointId: a.segments[0].to.pointId, cell: { c: 0, r: 0 } });
  expect(doc.points.some((q) => q.id === fromId)).toBe(false);
});
