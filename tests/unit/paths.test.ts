import { test, expect } from 'vitest';
import * as P from '../../src/engine/paths';
import { rotation } from '../../src/engine/transform';
import { CONFIG } from '../../src/config';
import type { Doc, UV } from '../../src/types';

function makeDoc(): Doc {
  return { version: 1, lattice: { ...CONFIG.LATTICE_PRESETS.Square }, points: [], paths: [], elements: [], bindings: [], fills: [], newPathOps: [] };
}
const style = { color: '#000', weight: 2 };
function polyline(doc: Doc, pts: UV[], close = false) {
  const nodes = pts.map((p) => P.addPoint(doc, p));
  const path = P.startPath(doc, nodes[0], style);
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
  const path = P.startPath(doc, { pointId: a.pointId, cell: { c: 1, r: 0 } }, style);
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
  P.addBinding(doc, path.id, [el.id]);
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
  const b = P.startPath(doc, a.segments[0].to, style);
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

test('bindings toggle ops in order; cloneMatrices uses the orbit; deleting an element removes its bindings', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0, v: 0 }, { u: 0.5, v: 0 }]);
  const m = P.addElement(doc, { kind: 'mirror', u: 0, v: 0.5, du: 1, dv: 0 });
  const t = P.addElement(doc, { kind: 'translate', u: 0.5, v: 0 });
  const b = P.addBinding(doc, path.id, []);
  expect(P.cloneMatrices(doc, b.id).matrices).toHaveLength(0);
  P.toggleOp(doc, b.id, m.id); P.toggleOp(doc, b.id, t.id);
  expect(b.ops).toEqual([m.id, t.id]);
  expect(P.cloneMatrices(doc, b.id).matrices).toHaveLength(1);
  P.toggleOp(doc, b.id, m.id);
  expect(b.ops).toEqual([t.id]);
  P.deleteElement(doc, t.id);
  expect(doc.bindings).toHaveLength(0);
});

test('fills are added and removed by id', () => {
  const doc = makeDoc();
  const f = P.addFill(doc, { u: 0.5, v: 0.5 }, '#f00');
  expect(doc.fills).toHaveLength(1);
  P.removeFill(doc, f.id);
  expect(doc.fills).toHaveLength(0);
});

test('openEndAt ignores a path with no segments', () => {
  const doc = makeDoc();
  const n = P.addPoint(doc, { u: 0.1, v: 0.1 });
  P.startPath(doc, n, style);
  expect(P.openEndAt(doc, n.pointId)).toBe(null);
});
