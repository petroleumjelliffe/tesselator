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
const ctxOff = { snapOn: false, hitScale: 1, threshold: 12 };
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
function drag(t: HitTarget, from: XY, to: XY) {
  S.onDown(t, from, ev(), ctxOff);
  const d = UI.drag.value!;
  d.moved = true; beginGesture();
  S.onMove(d, to, ev(), ctxOff);
  UI.drag.value = null;
  S.onUp(d, to, ev(), ctxOff);
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

test('dropping the unlinked node back on the old point merges them again (points attract with snapping off)', () => {
  const { aId, shared } = scene();
  UI.selection.value = { kind: 'path', id: aId, copy: base };
  drag(pt(shared), { x: 120, y: 120 }, { x: 150, y: 120 });
  expect(endOf(aId).pointId).not.toBe(shared);
  drag(pt(endOf(aId).pointId), { x: 150, y: 120 }, { x: 125, y: 121 });
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
