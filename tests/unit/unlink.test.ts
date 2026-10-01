import { test, expect } from 'vitest';
import { doc, emptyDoc } from '../../src/state/doc';
import * as UI from '../../src/state/ui';
import * as A from '../../src/actions';
import * as P from '../../src/engine/paths';
import * as S from '../../src/interaction/tools/select';
import { reset, beginGesture, endGesture } from '../../src/state/history';
import { copyMatrix } from '../../src/state/derived';
import { apply } from '../../src/engine/transform';
import type { Doc, HitTarget, XY, UV, Copy } from '../../src/types';

const base: Copy = { cell: { c: 0, r: 0 }, bindingId: null, power: 0 };
const ev = () => ({ pointerId: 1, shiftKey: false, metaKey: false, ctrlKey: false, pointerType: 'mouse' }) as unknown as PointerEvent;
const ctxOff = { targetsOn: false, gridOn: false, hitScale: 1, threshold: 12 };   // ⌘ held: a free drag
function line(d: Doc, pts: UV[]) {
  const p = P.startPath(d, P.addPoint(d, pts[0]), { color: '#000', weight: 2 }, d.layers[0].id);
  for (const uv of pts.slice(1)) P.appendNode(d, p.id, P.addPoint(d, uv));
  return p;
}
function scene() {
  reset(); UI.resetUi(); UI.tool.value = 'select'; UI.view.value = { pan: { x: 0, y: 0 }, zoom: 1 };
  const d = emptyDoc();
  const a = line(d, [{ u: 0.2, v: 0.2 }, { u: 0.5, v: 0.5 }]), shared = a.segments[0].to;
  const b = P.startPath(d, { ...shared, cell: { ...shared.cell } }, { color: '#000', weight: 2 }, d.layers[0].id);
  P.appendNode(d, b.id, P.addPoint(d, { u: 0.8, v: 0.2 }));
  doc.value = d;
  return { aId: a.id, bId: b.id, shared: shared.pointId };
}
function drag(t: HitTarget, from: XY, to: XY, ctx = ctxOff) {
  S.onDown(t, from, ev(), ctx);
  const d = UI.drag.value!;
  d.moved = true; beginGesture();
  S.onMove(d, to, ev(), ctx);
  UI.drag.value = null;
  S.onUp(d, to, ev(), ctx);
  endGesture();
}
const pt = (pointId: string): HitTarget => ({ kind: 'point', pointId, cell: { c: 0, r: 0 } });
const endOf = (id: string) => P.getPath(doc.value, id)!.segments[0].to;
const startOf = (id: string) => P.getPath(doc.value, id)!.start;

test('with its path selected, dragging a shared node moves only that path; one undo relinks', () => {
  const { aId, bId, shared } = scene();
  UI.selection.value = { kind: 'path', id: aId, copy: base };
  drag(pt(shared), { x: 120, y: 120 }, { x: 150, y: 120 });
  expect(endOf(aId).pointId).not.toBe(shared);
  expect(P.nodeWorld(doc.value, endOf(aId)).x).toBeCloseTo(150, 6);
  expect(startOf(bId).pointId).toBe(shared);
  expect(P.nodeWorld(doc.value, startOf(bId)).x).toBeCloseTo(120, 6);
  A.undo();
  expect(endOf(aId).pointId).toBe(shared);
});

test('S2/S6 fix round 2: dragging a shared plain node of a path selected at a non-origin raw instance detaches it without moving the other path; one undo relinks', () => {
  const { aId, bId, shared } = scene();
  const copy: Copy = { cell: { c: 1, r: 0 }, bindingId: null, power: 0 };   // a raw repeat instance, not the base cell
  UI.selection.value = { kind: 'path', id: aId, copy };
  const bPointBefore = { ...P.getPoint(doc.value, shared)! };
  // As hit.ts reports this raw instance's plain node (S2): cell is the node's own cell shifted by copy.cell.
  const nodeCell = endOf(aId).cell;
  const t: HitTarget = { kind: 'point', pointId: shared, cell: { c: nodeCell.c + copy.cell.c, r: nodeCell.r + copy.cell.r } };
  const before = apply(copyMatrix(copy), P.nodeWorld(doc.value, endOf(aId)));

  drag(t, before, { x: before.x + 30, y: before.y });

  expect(endOf(aId).pointId).not.toBe(shared);
  const detachedAtInstance = apply(copyMatrix(copy), P.nodeWorld(doc.value, endOf(aId)));
  expect(detachedAtInstance.x).toBeCloseTo(before.x + 30, 6);
  expect(detachedAtInstance.y).toBeCloseTo(before.y, 6);
  expect(startOf(bId).pointId).toBe(shared);
  const bPointAfter = P.getPoint(doc.value, shared)!;
  expect(bPointAfter.u).toBeCloseTo(bPointBefore.u, 9);
  expect(bPointAfter.v).toBeCloseTo(bPointBefore.v, 9);

  A.undo();
  expect(endOf(aId).pointId).toBe(shared);
});

test('dropping the unlinked node back on the old point merges them again (points attract with the grid off)', () => {
  const { aId, shared } = scene();
  UI.selection.value = { kind: 'path', id: aId, copy: base };
  drag(pt(shared), { x: 120, y: 120 }, { x: 150, y: 120 });
  expect(endOf(aId).pointId).not.toBe(shared);
  drag(pt(endOf(aId).pointId), { x: 150, y: 120 }, { x: 125, y: 121 }, { ...ctxOff, targetsOn: true });
  expect(endOf(aId).pointId).toBe(shared);
});

test('without the path selected, dragging the shared point moves both paths', () => {
  const { aId, bId, shared } = scene();
  UI.selection.value = { kind: 'points', ids: [shared] };
  drag(pt(shared), { x: 120, y: 120 }, { x: 150, y: 120 });
  expect(endOf(aId).pointId).toBe(shared);
  expect(P.nodeWorld(doc.value, startOf(bId)).x).toBeCloseTo(150, 6);
});

test('dragging a via end of the selected path detaches it into a plain node at the same spot; one undo restores the via', () => {
  reset(); UI.resetUi(); UI.tool.value = 'select'; UI.view.value = { pan: { x: 0, y: 0 }, zoom: 1 };
  const d = emptyDoc();
  const body = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.3, v: 0.1 }]);
  const el = P.addElement(d, { kind: 'rotate', u: 0.5, v: 0.5, n: 2 });
  const bind = P.addBinding(d, body.id, [[el.id]]);
  const tail = P.startPath(d, P.addPoint(d, { u: 0.5, v: 0.6 }), { color: '#000', weight: 2 }, d.layers[0].id);
  const via: Copy = { cell: { c: 0, r: 0 }, bindingId: bind.id, power: 1 };
  P.appendNode(d, tail.id, { pointId: body.start.pointId, cell: { c: 0, r: 0 }, via });
  doc.value = d;
  UI.selection.value = { kind: 'path', id: tail.id, copy: base };
  const before = P.nodeWorld(doc.value, tail.segments[0].to);
  const t: HitTarget = { kind: 'point', pointId: body.start.pointId, cell: { c: 0, r: 0 }, via };

  S.onDown(t, before, ev(), ctxOff);
  const drg = UI.drag.value!;
  drg.moved = true; beginGesture();
  S.onMove(drg, before, ev(), ctxOff);   // first move: unlinks, no real displacement yet
  const detached = P.getPath(doc.value, tail.id)!.segments[0].to;
  expect(detached.via).toBeUndefined();
  expect(detached.pointId).not.toBe(body.start.pointId);
  expect(P.nodeWorld(doc.value, detached).x).toBeCloseTo(before.x, 6);
  expect(P.nodeWorld(doc.value, detached).y).toBeCloseTo(before.y, 6);

  S.onMove(drg, { x: before.x + 30, y: before.y }, ev(), ctxOff);   // then it moves like a normal node
  UI.drag.value = null;
  S.onUp(drg, { x: before.x + 30, y: before.y }, ev(), ctxOff);
  endGesture();
  const moved = P.getPath(doc.value, tail.id)!.segments[0].to;
  expect(P.nodeWorld(doc.value, moved).x).toBeCloseTo(before.x + 30, 6);

  A.undo();
  const restored = P.getPath(doc.value, tail.id)!.segments[0].to;
  expect(restored.via).toEqual(via);
  expect(restored.pointId).toBe(body.start.pointId);
});

test('S2/S6 fix: the via start of a path selected at a non-origin raw instance detaches without moving the shared point; one undo restores it', () => {
  reset(); UI.resetUi(); UI.tool.value = 'select'; UI.view.value = { pan: { x: 0, y: 0 }, zoom: 1 };
  const d = emptyDoc();
  const bodyA = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.3, v: 0.1 }]);
  const el = P.addElement(d, { kind: 'rotate', u: 0.5, v: 0.5, n: 2 });
  const bind = P.addBinding(d, bodyA.id, [[el.id]]);
  const via: Copy = { cell: { c: 0, r: 0 }, bindingId: bind.id, power: 1 };
  const pathB = P.startPath(d, { pointId: bodyA.start.pointId, cell: { c: 0, r: 0 }, via }, { color: '#000', weight: 2 }, d.layers[0].id);
  P.appendNode(d, pathB.id, P.addPoint(d, { u: 0.9, v: 0.6 }));
  doc.value = d;
  const copy: Copy = { cell: { c: 1, r: 0 }, bindingId: null, power: 0 };   // a raw repeat instance, not the base cell
  UI.selection.value = { kind: 'path', id: pathB.id, copy };

  const aPointBefore = { ...P.getPoint(doc.value, bodyA.start.pointId)! };
  // As hit.ts reports the via start of this raw instance (S2): cell unshifted, via.cell shifted by copy.cell.
  const shiftedVia: Copy = { ...via, cell: { c: via.cell.c + copy.cell.c, r: via.cell.r + copy.cell.r } };
  const t: HitTarget = { kind: 'point', pointId: bodyA.start.pointId, cell: { c: 0, r: 0 }, via: shiftedVia };
  const before = apply(copyMatrix(copy), P.nodeWorld(doc.value, pathB.start));

  drag(t, before, { x: before.x + 30, y: before.y });

  const detached = P.getPath(doc.value, pathB.id)!.start;
  expect(detached.via).toBeUndefined();
  expect(detached.pointId).not.toBe(bodyA.start.pointId);
  const detachedAtInstance = apply(copyMatrix(copy), P.nodeWorld(doc.value, detached));
  expect(detachedAtInstance.x).toBeCloseTo(before.x + 30, 6);
  expect(detachedAtInstance.y).toBeCloseTo(before.y, 6);

  const aPointAfter = P.getPoint(doc.value, bodyA.start.pointId)!;
  expect(aPointAfter.u).toBeCloseTo(aPointBefore.u, 9);
  expect(aPointAfter.v).toBeCloseTo(aPointBefore.v, 9);

  A.undo();
  const restored = P.getPath(doc.value, pathB.id)!.start;
  expect(restored.via).toEqual(via);
  expect(restored.pointId).toBe(bodyA.start.pointId);
});

test('canchor: dragging a clone\'s shared anchor off a point shared with another path leaves that path in place', () => {
  reset(); UI.resetUi(); UI.tool.value = 'select'; UI.view.value = { pan: { x: 0, y: 0 }, zoom: 1 };
  const d = emptyDoc();
  const a = line(d, [{ u: 0.2, v: 0.2 }, { u: 0.5, v: 0.5 }]), shared = a.segments[0].to;
  const b = P.startPath(d, { ...shared, cell: { ...shared.cell } }, { color: '#000', weight: 2 }, d.layers[0].id);
  P.appendNode(d, b.id, P.addPoint(d, { u: 0.8, v: 0.2 }));
  const el = P.addElement(d, { kind: 'translate', u: 0.3, v: 0 });
  const bind = P.addBinding(d, a.id, [[el.id]]);
  doc.value = d;
  const copy: Copy = { cell: { c: 0, r: 0 }, bindingId: bind.id, power: 1 };
  UI.selection.value = { kind: 'path', id: a.id, copy };
  const anchorAt = apply(copyMatrix(copy), P.nodeWorld(doc.value, { pointId: shared.pointId, cell: { c: 0, r: 0 } }));
  const t: HitTarget = { kind: 'canchor', pathId: a.id, pointId: shared.pointId, cell: { c: 0, r: 0 }, copy };

  drag(t, anchorAt, { x: anchorAt.x + 20, y: anchorAt.y + 5 });

  const aNode = P.getPath(doc.value, a.id)!.segments[0].to;
  expect(aNode.pointId).not.toBe(shared.pointId);
  expect(startOf(b.id).pointId).toBe(shared.pointId);
  expect(P.nodeWorld(doc.value, startOf(b.id)).x).toBeCloseTo(120, 6);
  expect(P.nodeWorld(doc.value, startOf(b.id)).y).toBeCloseTo(120, 6);
});
