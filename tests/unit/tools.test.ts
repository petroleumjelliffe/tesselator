// Tool-level tests: hitTest → the tool's onDown / onMove / onUp, as pointer.ts drives them. The bugs these guard were in
// the tools' routing, which action-level tests did not reach.
import { test, expect } from 'vitest';
import { doc, emptyDoc } from '../../src/state/doc';
import * as UI from '../../src/state/ui';
import * as P from '../../src/engine/paths';
import * as A from '../../src/actions';
import * as pen from '../../src/interaction/tools/pen';
import * as freehand from '../../src/interaction/tools/freehand';
import * as select from '../../src/interaction/tools/select';
import { STR } from '../../src/strings';
import { hoverAt } from '../../src/interaction/pointer';
import { reset, beginGesture, endGesture } from '../../src/state/history';
import { copies, cloneMatrices } from '../../src/state/derived';
import { hitTest, type HitContext } from '../../src/engine/hit';
import type { ToolModule, ToolCtx } from '../../src/interaction/tools/common';
import type { Doc, XY, UV } from '../../src/types';

const ev = (over: Partial<PointerEvent> = {}) => ({ pointerId: 1, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, pointerType: 'mouse', ...over }) as unknown as PointerEvent;
const ctx: ToolCtx = { snapOn: true, hitScale: 1, threshold: 12 };
function fresh(tool: 'pen' | 'freehand', build: (d: Doc) => void = () => {}) {
  reset(); UI.resetUi(); const d = emptyDoc(); build(d); doc.value = d;
  UI.view.value = { pan: { x: 0, y: 0 }, zoom: 1 }; UI.prefs.value = { ...UI.prefs.value, snap: true }; UI.tool.value = tool; UI.activeLayerId.value = d.layers[0].id;
}
function line(d: Doc, pts: UV[], layerId = d.layers[0].id) {
  const p = P.startPath(d, P.addPoint(d, pts[0]), { color: '#000', weight: 2 }, layerId);
  for (const uv of pts.slice(1)) P.appendNode(d, p.id, P.addPoint(d, uv));
  return p;
}
const hctx = (): HitContext => ({ layer: UI.layer.value, tool: UI.tool.value, selection: UI.selection.value, pen: UI.pen.value, zoom: 1, hitScale: 1, copies: copies.value, cloneMatrices: cloneMatrices.value, faces: [] });
const hit = (w: XY) => hitTest(doc.value, hctx(), w);
// pointer.ts: hover, then press, optional moves (the gesture opens on the first), release.
function gesture(tool: ToolModule, pts: XY[], e = ev()) {
  hoverAt(pts[0], hit(pts[0]), ctx);
  tool.onDown(hit(pts[0]), pts[0], e, ctx);
  const d = UI.drag.value;
  if (!d) return;
  for (const p of pts.slice(1)) { if (!d.moved) { d.moved = true; beginGesture(); } tool.onMove(d, p, e, ctx); }
  UI.drag.value = null;
  try { tool.onUp(d, pts[pts.length - 1], e, ctx); } finally { endGesture(); }
}
const click = (w: XY) => gesture(pen, [w]);
const newest = () => doc.value.paths[doc.value.paths.length - 1];
const along = (from: XY, to: XY, n = 12): XY[] => Array.from({ length: n + 1 }, (_, i) => ({ x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n }));

// --- A / C1: Pen and Freehand go through drawSnap

test('Pen: a click on another layer\'s line does not split it; the new node is location only, on the line', () => {
  let hostId = '';
  fresh('pen', (d) => { d.layers.push({ id: 'L2', name: 'Layer 2' }); hostId = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }], 'L2').id; });
  expect(hit({ x: 120, y: 122 })?.kind).toBe('segment');
  click({ x: 120, y: 122 });
  const host = P.getPath(doc.value, hostId)!, p = UI.pen.value && P.getPath(doc.value, UI.pen.value.pathId);
  expect(host.segments).toHaveLength(1);
  expect(p).toBeTruthy();
  expect(p!.layerId).toBe(doc.value.layers[0].id);
  expect(P.pathNodes(host).some((n) => n.pointId === p!.start.pointId)).toBe(false);
  const at = P.nodeWorld(doc.value, p!.start);
  expect(at.x).toBeCloseTo(120, 6); expect(at.y).toBeCloseTo(120, 6);
});

test('Freehand: a stroke starting on another layer\'s endpoint is a new path on the active layer; the other path is unchanged', () => {
  let otherId = '';
  fresh('freehand', (d) => { d.layers.push({ id: 'L2', name: 'Layer 2' }); otherId = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.5, v: 0.5 }], 'L2').id; });
  expect(hit({ x: 49, y: 121 })?.kind).toBe('point');
  gesture(freehand, along({ x: 49, y: 121 }, { x: 60, y: 200 }));
  const other = P.getPath(doc.value, otherId)!, p = newest();
  expect(other.segments).toHaveLength(1);
  expect(p.id).not.toBe(otherId);
  expect(p.layerId).toBe(doc.value.layers[0].id);
  expect(P.pathNodes(other).some((n) => n.pointId === p.start.pointId)).toBe(false);
  const at = P.nodeWorld(doc.value, p.start);
  expect(at.x).toBeCloseTo(48, 6); expect(at.y).toBeCloseTo(120, 6);
});

test('Freehand: a stroke starting on an open end of a path on the active layer extends that path', () => {
  let id = '';
  fresh('freehand', (d) => { id = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.5, v: 0.5 }]).id; });
  gesture(freehand, along({ x: 121, y: 121 }, { x: 130, y: 220 }));
  expect(doc.value.paths).toHaveLength(1);
  expect(P.getPath(doc.value, id)!.segments.length).toBeGreaterThan(1);
});

// --- A / I1: the path in progress is in its own targets only

test('Pen: a click near its own start closes the path and ends the Pen', () => {
  fresh('pen');
  click({ x: 60, y: 60 }); click({ x: 180, y: 60 }); click({ x: 180, y: 180 });   // on the 30 px grid
  const id = UI.pen.value!.pathId;
  click({ x: 63, y: 62 });
  expect(P.isClosed(P.getPath(doc.value, id)!)).toBe(true);
  expect(UI.pen.value).toBe(null);
});

test('Pen: a click on its own earlier segment splits it there and ends the Pen', () => {
  fresh('pen');
  click({ x: 60, y: 60 }); click({ x: 180, y: 60 }); click({ x: 180, y: 180 });
  const id = UI.pen.value!.pathId;
  click({ x: 105, y: 63 });
  const nodes = P.pathNodes(P.getPath(doc.value, id)!), last = nodes[nodes.length - 1];
  expect(nodes.slice(1, -1).some((n) => n.pointId === last.pointId)).toBe(true);
  expect(P.nodeWorld(doc.value, last).y).toBeCloseTo(60, 6);
  expect(UI.pen.value).toBe(null);
});

test('Pen: a click on its own mirror clone\'s start is location only, never a via node', () => {
  fresh('pen', (d) => { const el = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 }); d.newPathGroups = [[el.id]]; });
  click({ x: 60, y: 60 }); click({ x: 90, y: 150 });
  const id = UI.pen.value!.pathId;
  expect(hit({ x: 178, y: 61 })?.kind).toBe('canchor');           // the clone's start, (180, 60)
  click({ x: 178, y: 61 });
  const p = P.getPath(doc.value, id)!, last = P.pathNodes(p)[P.pathNodes(p).length - 1];
  expect(p.segments).toHaveLength(2);
  expect(last.via).toBeUndefined();
  expect(last.pointId).not.toBe(p.start.pointId);
  const at = P.nodeWorld(doc.value, last);
  expect(at.x).toBeCloseTo(180, 6); expect(at.y).toBeCloseTo(60, 6);
});

// --- A / I2: the hint shows over lines and points

test('Pen: the snap hint shows while hovering over a line', () => {
  fresh('pen', (d) => { line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]); });
  const w = { x: 120, y: 122 };
  hoverAt(w, hit(w), ctx);
  expect(UI.hover.value?.kind).toBe('segment');
  expect(UI.snapHint.value?.at.y).toBeCloseTo(120, 6);
});

test('Freehand: extending a path, an end on that path\'s own mirror clone start is location only (no via node)', () => {
  let id = '';
  fresh('freehand', (d) => {
    const el = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });   // x = 120
    const p = line(d, [{ u: 0.25, v: 0.25 }, { u: 0.25, v: 0.75 }]);                 // (60,60) → (60,180); its clone starts at (180,60)
    P.addBinding(d, p.id, [[el.id]]);
    id = p.id;
  });
  gesture(freehand, [...along({ x: 61, y: 181 }, { x: 100, y: 220 }), ...along({ x: 100, y: 220 }, { x: 130, y: 61 }).slice(1), ...along({ x: 130, y: 61 }, { x: 178, y: 61 }).slice(1)]);
  expect(doc.value.paths).toHaveLength(1);
  const nodes = P.pathNodes(P.getPath(doc.value, id)!), last = nodes[nodes.length - 1];
  expect(nodes.length).toBeGreaterThan(2);
  expect(last.via).toBeUndefined();
  const at = P.nodeWorld(doc.value, last);
  expect(at.x).toBeCloseTo(180, 6); expect(at.y).toBeCloseTo(60, 6);
});

// --- B / C2: an unlink on the first move refreshes the drag's targets

test('Select: dragging a shared end of the selected path never lands on that path\'s own (stale) line', () => {
  let aId = '';
  fresh('freehand', (d) => {
    const a = line(d, [{ u: 0.2, v: 0.2 }, { u: 0.5, v: 0.5 }]), shared = a.segments[0].to;   // A: (48,48) → (120,120)
    const b = P.startPath(d, { ...shared, cell: { ...shared.cell } }, { color: '#000', weight: 2 }, d.layers[0].id);
    P.appendNode(d, b.id, P.addPoint(d, { u: 0.8, v: 0.2 }));                                 // B: (120,120) → (192,48)
    aId = a.id;
  });
  UI.tool.value = 'select';
  UI.selection.value = { kind: 'path', id: aId, copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 } };
  expect(hit({ x: 120, y: 120 })?.kind).toBe('point');
  let hint: string | undefined;
  const pts = [{ x: 120, y: 120 }, { x: 110, y: 110 }, { x: 95, y: 98 }, { x: 84, y: 88 }];
  hoverAt(pts[0], hit(pts[0]), ctx);
  select.onDown(hit(pts[0]), pts[0], ev(), ctx);
  const d = UI.drag.value!;
  d.moved = true; beginGesture();
  for (const p of pts.slice(1)) { select.onMove(d, p, ev(), ctx); hint = UI.snapHint.value?.label; }
  UI.drag.value = null;
  select.onUp(d, pts[pts.length - 1], ev(), ctx); endGesture();
  expect(hint).not.toBe(STR.snap.line);
  const a = P.getPath(doc.value, aId)!, end = P.nodeWorld(doc.value, a.segments[0].to);
  expect(a.segments).toHaveLength(1);
  expect(end.x).toBeCloseTo(90, 6); expect(end.y).toBeCloseTo(90, 6);          // the grid point, not (68.06, 68.06) on A's old line
});

// --- C / I3: a traced stroke ends on the traced line

test('Freehand: Alt-tracing a line and releasing 16 px off it ends on the line; the traced line is not split', () => {
  let id = '';
  fresh('freehand', (d) => { id = line(d, [{ u: 0.1, v: 0.5 }, { u: 0.9, v: 0.5 }]).id; });   // y = 120, x 24..216
  const alt = ev({ altKey: true });
  gesture(freehand, [{ x: 40, y: 160 }, { x: 45, y: 140 }, ...along({ x: 50, y: 126 }, { x: 150, y: 136 }, 20)], alt);   // starts off the line, pins at (50, 126)
  const p = newest();
  expect(p.id).not.toBe(id);
  const nodes = P.pathNodes(p), end = P.nodeWorld(doc.value, nodes[nodes.length - 1]);
  expect(end.y).toBeCloseTo(120, 6);
  expect(end.x).toBeCloseTo(150, 6);
  expect(P.getPath(doc.value, id)!.segments).toHaveLength(1);
});

// --- D / I4: clone-anchor and several-point drags behave as node drags

function selectDrag(pts: XY[]) {
  select.onDown(hit(pts[0]), pts[0], ev(), ctx);
  const d = UI.drag.value!;
  d.moved = true; beginGesture();
  for (const p of pts.slice(1)) select.onMove(d, p, ev(), ctx);
  UI.drag.value = null;
  select.onUp(d, pts[pts.length - 1], ev(), ctx); endGesture();
}

test('Select: dragging several points with nothing near snaps the grabbed one to the grid', () => {
  let a = '', b = '';
  fresh('freehand', (d) => { const p = line(d, [{ u: 0.2, v: 0.2 }, { u: 0.3, v: 0.3 }]); a = p.start.pointId; b = p.segments[0].to.pointId; });   // (48,48), (72,72)
  UI.tool.value = 'select'; UI.selection.value = { kind: 'points', ids: [a, b] };
  expect(hit({ x: 48, y: 48 })?.kind).toBe('point');
  selectDrag([{ x: 48, y: 48 }, { x: 80, y: 50 }, { x: 101, y: 52 }]);
  const pa = P.nodeWorld(doc.value, { pointId: a, cell: { c: 0, r: 0 } }), pb = P.nodeWorld(doc.value, { pointId: b, cell: { c: 0, r: 0 } });
  expect(pa.x).toBeCloseTo(90, 6); expect(pa.y).toBeCloseTo(60, 6);                // the grid point nearest (101, 52)
  expect(pb.x).toBeCloseTo(114, 6); expect(pb.y).toBeCloseTo(84, 6);               // moved rigidly
});

test('Select: several points dragged with the grabbed one onto a same-layer node join there', () => {
  let a = '', b = '', x = '';
  fresh('freehand', (d) => {
    const p = line(d, [{ u: 0.2, v: 0.2 }, { u: 0.3, v: 0.3 }]); a = p.start.pointId; b = p.segments[0].to.pointId;
    x = line(d, [{ u: 0.5, v: 0.25 }, { u: 0.7, v: 0.25 }]).start.pointId;            // a node at (120, 60)
  });
  UI.tool.value = 'select'; UI.selection.value = { kind: 'points', ids: [a, b] };
  selectDrag([{ x: 48, y: 48 }, { x: 100, y: 55 }, { x: 117, y: 58 }]);
  expect(doc.value.paths[0].start.pointId).toBe(x);
  expect(doc.value.points.some((q) => q.id === a)).toBe(false);
});

// Mirror x = 120. A: (48,48) → (48,120), its clone ends at (192,120). Q: (60,180) → (60,216), its clone starts at (180,180).
function cloneScene(bindQ: boolean) {
  let aId = '', aBind = '', x = '';
  fresh('freehand', (d) => {
    const el = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });
    const a = line(d, [{ u: 0.2, v: 0.2 }, { u: 0.2, v: 0.5 }]); aId = a.id; aBind = P.addBinding(d, a.id, [[el.id]]).id;
    const q = line(d, [{ u: 0.25, v: 0.75 }, { u: 0.25, v: 0.9 }]); x = q.start.pointId;
    if (bindQ) P.addBinding(d, q.id, [[el.id]]);
    else P.movePoint(d, x, 0.75, 0.75);                                                // Q unbound, starting at (180,180) itself
  });
  UI.tool.value = 'select';
  UI.selection.value = { kind: 'path', id: aId, copy: { cell: { c: 0, r: 0 }, bindingId: aBind, power: 1 } };
  return { aId, x };
}

test('Select: a clone-anchor drag released on a same-layer node joins through the clone\'s frame', () => {
  const { aId, x } = cloneScene(true);
  expect(hit({ x: 192, y: 120 })?.kind).toBe('canchor');
  selectDrag([{ x: 192, y: 120 }, { x: 185, y: 160 }, { x: 181, y: 178 }]);          // onto Q's clone start (180,180)
  const end = P.getPath(doc.value, aId)!.segments[0].to;
  expect(end.pointId).toBe(x);                                                       // A's source end is Q's start (60,180)
  expect(end.via).toBeUndefined();
});

test('Select: a clone-anchor drop whose pre-image is no node is location only', () => {
  const { aId, x } = cloneScene(false);
  selectDrag([{ x: 192, y: 120 }, { x: 185, y: 160 }, { x: 181, y: 178 }]);          // onto Q's raw start (180,180): nothing at (60,180)
  const end = P.getPath(doc.value, aId)!.segments[0].to;
  expect(end.pointId).not.toBe(x);
  const at = P.nodeWorld(doc.value, end);
  expect(at.x).toBeCloseTo(60, 6); expect(at.y).toBeCloseTo(180, 6);
});

// --- E / I5: box-scale endpoint hints come from the targets at the press, without the path's own nodes

test('Select: scaling a path with nothing else near shows no endpoint hint', () => {
  let id = '';
  fresh('freehand', (d) => { id = line(d, [{ u: 0.2, v: 0.2 }, { u: 0.5, v: 0.5 }]).id; });   // (48,48) → (120,120)
  UI.tool.value = 'select'; UI.selection.value = { kind: 'path', id, copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 } };
  expect(hit({ x: 120, y: 84 })?.kind).toBe('bbox');                                        // the right edge handle
  select.onDown(hit({ x: 120, y: 84 }), { x: 120, y: 84 }, ev(), ctx);
  const d = UI.drag.value!;
  d.moved = true; beginGesture();
  select.onMove(d, { x: 148.8, y: 84 }, ev(), ctx);                                         // × 1.4: no lattice fraction near
  const hint = UI.snapHint.value;
  UI.drag.value = null; select.onUp(d, { x: 148.8, y: 84 }, ev(), ctx); endGesture();
  expect(P.nodeWorld(doc.value, P.getPath(doc.value, id)!.segments[0].to).x).toBeCloseTo(148.8, 6);
  expect(hint).toBe(null);
});

// --- E / M1: point clicks keep the frame points were picked through

test('Select: ⇧-click trimming a marquee picked through a clone keeps the clone frame of the rest', () => {
  let a = '', b = '';
  fresh('freehand', (d) => {
    const el = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });
    const p = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.15, v: 0.15 }, { u: 0.4, v: 0.6 }]);            // (24,24), (36,36), (96,144)
    P.addBinding(d, p.id, [[el.id]]);
    a = p.start.pointId; b = p.segments[0].to.pointId;                                           // mirror images (216,24), (204,36)
  });
  UI.tool.value = 'select';
  select.onDown(null, { x: 195, y: 10 }, ev(), ctx);
  const m = UI.drag.value!; m.moved = true;
  select.onMove(m, { x: 230, y: 45 }, ev(), ctx);
  UI.drag.value = null; select.onUp(m, { x: 230, y: 45 }, ev(), ctx);
  const s0 = UI.selection.value;
  expect(s0 && s0.kind === 'points' && [...s0.ids].sort()).toEqual([a, b].sort());
  const t = hit({ x: 216, y: 24 });
  expect(t).toMatchObject({ kind: 'point', pointId: a });
  const shift = ev({ shiftKey: true });
  select.onDown(t, { x: 216, y: 24 }, shift, ctx);
  const c = UI.drag.value!; UI.drag.value = null; select.onUp(c, { x: 216, y: 24 }, shift, ctx);
  const s = UI.selection.value;
  expect(s && s.kind === 'points' && s.ids).toEqual([b]);
  expect(s && s.kind === 'points' && s.copies?.[b]?.bindingId).toBeTruthy();
  select.onDown(t, { x: 216, y: 24 }, shift, ctx);                                               // ⇧-click it back: through the clone again
  const c2 = UI.drag.value!; UI.drag.value = null; select.onUp(c2, { x: 216, y: 24 }, shift, ctx);
  const s2 = UI.selection.value;
  expect(s2 && s2.kind === 'points' && s2.copies?.[a]?.bindingId).toBeTruthy();
  expect(s2 && s2.kind === 'points' && s2.copies?.[b]?.bindingId).toBeTruthy();
});

// --- Residual round

test('N3: a point placed on another layer\'s point stays a target; clicking it again on its own layer resumes its path', () => {
  let l2 = '';
  fresh('pen', (d) => { d.layers.push({ id: 'L2', name: 'Layer 2' }); l2 = line(d, [{ u: 0.25, v: 0.25 }, { u: 0.5, v: 0.5 }], 'L2').id; });   // L2 ends at (120,120)
  const l2Before = JSON.stringify(P.getPath(doc.value, l2));
  click({ x: 60, y: 180 }); click({ x: 120, y: 120 });                     // on L1: the end is a location-only copy of L2's end
  const id = UI.pen.value!.pathId;
  A.endPen();
  const y = P.getPath(doc.value, id)!.segments[0].to;
  expect(P.pathNodes(P.getPath(doc.value, l2)!).some((n) => n.pointId === y.pointId)).toBe(false);
  click({ x: 120, y: 120 });
  expect(UI.pen.value?.pathId).toBe(id);                                     // resumed (D5), not a new unconnected path
  expect(doc.value.paths).toHaveLength(2);
  expect(JSON.stringify(P.getPath(doc.value, l2))).toBe(l2Before);
});
