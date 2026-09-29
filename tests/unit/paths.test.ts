import { test, expect } from 'vitest';
import * as P from '../../src/engine/paths';
import { rotation, cloneCount } from '../../src/engine/transform';
import { CONFIG } from '../../src/config';
import type { Doc, UV } from '../../src/types';

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

test('movePoint and movePointsBy shift adjacent control points by half per moved endpoint', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0, v: 0 }, { u: 0.4, v: 0 }, { u: 0.8, v: 0 }]);
  P.setControlPointAbs(doc, path.id, 0, { u: 0.2, v: 0.2 });
  P.setControlPointAbs(doc, path.id, 1, { u: 0.6, v: 0.2 });
  const [n0, n1] = P.pathNodes(path);
  P.movePoint(doc, n1.pointId, 0.4, 0.1);
  expect(P.cpAbs(path, 0)!.v).toBeCloseTo(0.25, 9);
  expect(P.cpAbs(path, 1)!.v).toBeCloseTo(0.25, 9);
  const ids = [n0.pointId, n1.pointId];
  P.movePointsBy(doc, ids, P.snapshotPositions(doc, ids), 0, 0.1);
  expect(P.cpAbs(path, 0)!.v).toBeCloseTo(0.35, 9);
  expect(P.cpAbs(path, 1)!.v).toBeCloseTo(0.3, 9);
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
