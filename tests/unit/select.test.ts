import { test, expect } from 'vitest';
import { doc, emptyDoc } from '../../src/state/doc';
import * as UI from '../../src/state/ui';
import * as A from '../../src/actions';
import * as P from '../../src/engine/paths';
import * as S from '../../src/interaction/tools/select';
import { reset, beginGesture, endGesture } from '../../src/state/history';
import type { Doc, HitTarget, XY, UV, Copy } from '../../src/types';

const base: Copy = { cell: { c: 0, r: 0 }, bindingId: null, power: 0 };
const ev = () => ({ pointerId: 1, shiftKey: false, metaKey: false, ctrlKey: false, pointerType: 'mouse' }) as unknown as PointerEvent;
const ctxOn = { snapOn: true, hitScale: 1, threshold: 12 }, ctxOff = { snapOn: false, hitScale: 1, threshold: 12 };
function fresh(build: (d: Doc) => void) { reset(); UI.resetUi(); const d = emptyDoc(); build(d); doc.value = d; UI.tool.value = 'select'; UI.view.value = { pan: { x: 0, y: 0 }, zoom: 1 }; }
function line(d: Doc, pts: UV[], layerId = d.layers[0].id) {
  const p = P.startPath(d, P.addPoint(d, pts[0]), { color: '#000', weight: 2 }, layerId);
  for (const uv of pts.slice(1)) P.appendNode(d, p.id, P.addPoint(d, uv));
  return p;
}
// Mirrors pointer.ts: the gesture opens on the first move and closes after the tool's onUp.
function drag(t: HitTarget, from: XY, to: XY | XY[], ctx = ctxOn) {
  S.onDown(t, from, ev(), ctx);
  const d = UI.drag.value!;
  d.moved = true; beginGesture();
  for (const p of Array.isArray(to) ? to : [to]) S.onMove(d, p, ev(), ctx);
  UI.drag.value = null;
  S.onUp(d, Array.isArray(to) ? to[to.length - 1] : to, ev(), ctx);
  endGesture();
}
const seg = (pathId: string, copy: Copy = base): HitTarget => ({ kind: 'segment', pathId, j: 0, copy });

test('a body drag released on another path\'s line splits it and shares the point; one undo reverts both', () => {
  let stubId = '', hostId = '';
  fresh((d) => { hostId = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]).id; stubId = line(d, [{ u: 0.5, v: 0.1 }, { u: 0.5, v: 0.45 }]).id; });
  const endId = P.getPath(doc.value, stubId)!.segments[0].to.pointId;
  drag(seg(stubId), { x: 120, y: 60 }, { x: 120, y: 70 });            // the end goes to (120, 118), 2 from the host
  const host = P.getPath(doc.value, hostId)!, stub = P.getPath(doc.value, stubId)!;
  expect(host.segments).toHaveLength(2);
  expect(host.segments[0].to.pointId).toBe(stub.segments[0].to.pointId);
  A.undo();
  expect(P.getPath(doc.value, hostId)!.segments).toHaveLength(1);
  expect(P.getPoint(doc.value, endId)!.v).toBeCloseTo(0.45, 9);
});

test('a body drag onto a line on another layer moves but does not join', () => {
  let stubId = '', hostId = '';
  fresh((d) => { d.layers.push({ id: 'L2', name: 'Layer 2' }); hostId = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }], 'L2').id; stubId = line(d, [{ u: 0.5, v: 0.1 }, { u: 0.5, v: 0.45 }]).id; });
  drag(seg(stubId), { x: 120, y: 60 }, { x: 120, y: 70 });
  expect(P.getPath(doc.value, hostId)!.segments).toHaveLength(1);
  expect(P.nodeWorld(doc.value, P.getPath(doc.value, stubId)!.segments[0].to).y).toBeCloseTo(120, 6);   // it still landed on the line
});

test('drag through cell (2, 0) snaps and joins as in the base cell', () => {
  let stubId = '', hostId = '';
  fresh((d) => { hostId = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]).id; stubId = line(d, [{ u: 0.5, v: 0.1 }, { u: 0.5, v: 0.45 }]).id; });
  drag(seg(stubId, { cell: { c: 2, r: 0 }, bindingId: null, power: 0 }), { x: 600, y: 60 }, { x: 600, y: 70 });
  expect(P.getPath(doc.value, hostId)!.segments).toHaveLength(2);
});

test('with snapping off a body drag moves by the raw delta and joins nothing', () => {
  let stubId = '', hostId = '';
  fresh((d) => { hostId = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]).id; stubId = line(d, [{ u: 0.5, v: 0.1 }, { u: 0.5, v: 0.45 }]).id; });
  drag(seg(stubId), { x: 120, y: 60 }, { x: 120, y: 70 }, ctxOff);
  expect(P.getPath(doc.value, hostId)!.segments).toHaveLength(1);
  expect(P.nodeWorld(doc.value, P.getPath(doc.value, stubId)!.segments[0].to).y).toBeCloseTo(118, 6);
});

test('a point drag settles on the mirror axis, not on its own mirror image', () => {
  let pid = '';
  fresh((d) => {
    const el = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });   // x = 120
    const p = line(d, [{ u: 0.3, v: 0.2 }, { u: 0.3, v: 0.6 }]);
    P.addBinding(d, p.id, [[el.id]]);
    pid = p.start.pointId;
  });
  const t: HitTarget = { kind: 'point', pointId: pid, cell: { c: 0, r: 0 } };
  drag(t, { x: 72, y: 48 }, [{ x: 100, y: 48 }, { x: 110, y: 48 }, { x: 114, y: 48 }, { x: 116, y: 48 }]);
  const w = P.nodeWorld(doc.value, { pointId: pid, cell: { c: 0, r: 0 } });
  expect(w.x).toBeCloseTo(120, 6); expect(w.y).toBeCloseTo(48, 6);
});

test('a point dropped on another path\'s line joins it (same layer)', () => {
  let hostId = '', stubId = '', pid = '';
  fresh((d) => { hostId = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]).id; const s = line(d, [{ u: 0.5, v: 0.1 }, { u: 0.5, v: 0.3 }]); stubId = s.id; pid = s.segments[0].to.pointId; });
  drag({ kind: 'point', pointId: pid, cell: { c: 0, r: 0 } }, { x: 120, y: 72 }, { x: 121, y: 117 });
  const host = P.getPath(doc.value, hostId)!, stub = P.getPath(doc.value, stubId)!;
  expect(host.segments).toHaveLength(2);
  expect(stub.segments[0].to.pointId).toBe(host.segments[0].to.pointId);
});

test('a control-point drag snaps to the horizontal through its anchor', () => {
  let pid = '';
  fresh((d) => { pid = line(d, [{ u: 0.2, v: 0.2 }, { u: 0.6, v: 0.6 }]).id; });
  drag({ kind: 'diamond', pathId: pid, j: 0, copy: base }, { x: 96, y: 96 }, { x: 100, y: 52 });
  const cp = P.cpWorld(doc.value, P.getPath(doc.value, pid)!, 0)!;
  expect(cp.y).toBeCloseTo(48, 6); expect(cp.x).toBeCloseTo(100, 6);
});
