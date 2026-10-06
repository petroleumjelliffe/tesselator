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
import * as construct from '../../src/interaction/tools/construct';
import { STR } from '../../src/strings';
import { CONFIG } from '../../src/config';
import { restore } from '../../src/state/persist';
import { hoverAt } from '../../src/interaction/pointer';
import { reset, beginGesture, endGesture, abortGesture, undo } from '../../src/state/history';
import { copies, cloneMatrices, copyMatrix, multiNodeMarks } from '../../src/state/derived';
import { apply } from '../../src/engine/transform';
import { hitTest, type HitContext } from '../../src/engine/hit';
import type { ToolModule, ToolCtx } from '../../src/interaction/tools/common';
import type { Doc, XY, UV } from '../../src/types';
import { cursorFor, ROTATE_CURSOR } from '../../src/interaction/cursor';
import { hintText } from '../../src/components/Chrome';

const ev = (over: Partial<PointerEvent> = {}) => ({ pointerId: 1, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, pointerType: 'mouse', ...over }) as unknown as PointerEvent;
const ctx: ToolCtx = { targetsOn: true, gridOn: true, hitScale: 1, threshold: 12 };
function fresh(tool: 'pen' | 'freehand', build: (d: Doc) => void = () => {}) {
  reset(); UI.resetUi(); const d = emptyDoc(); build(d); doc.value = d;
  UI.view.value = { pan: { x: 0, y: 0 }, zoom: 1 }; UI.prefs.value = { ...UI.prefs.value, grid: true }; UI.tool.value = tool; UI.activeLayerId.value = d.layers[0].id;
}
function line(d: Doc, pts: UV[], layerId = d.layers[0].id) {
  const p = P.startPath(d, P.addPoint(d, pts[0]), { color: '#000', weight: 2 }, layerId);
  for (const uv of pts.slice(1)) P.appendNode(d, p.id, P.addPoint(d, uv));
  return p;
}
const hctx = (hitScale = 1): HitContext => ({ layer: UI.layer.value, tool: UI.tool.value, selection: UI.selection.value, pen: UI.pen.value, zoom: 1, hitScale, copies: copies.value, cloneMatrices: cloneMatrices.value, faces: [] });
const hit = (w: XY, hitScale = 1) => hitTest(doc.value, hctx(hitScale), w);
// pointer.ts: hover, then press, optional moves (the gesture opens on the first), release.
function gesture(tool: ToolModule, pts: XY[], e = ev(), c = ctx, release = pts[pts.length - 1]) {
  hoverAt(pts[0], hit(pts[0]), c);
  tool.onDown(hit(pts[0]), pts[0], e, c);
  const d = UI.drag.value;
  if (!d) return;
  for (const p of pts.slice(1)) { if (!d.moved) { d.moved = true; beginGesture(); } tool.onMove(d, p, e, c); }
  UI.drag.value = null;
  try { tool.onUp(d, release, e, c); } finally { endGesture(); }
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
  gesture(freehand, [...along({ x: 61, y: 181 }, { x: 100, y: 220 }), ...along({ x: 100, y: 220 }, { x: 178, y: 62 }).slice(1)]);   // along the clone's line: its held snap yields to the start (SN4)
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

function selectDrag(pts: XY[], c = ctx, release = pts[pts.length - 1]) {
  select.onDown(hit(pts[0]), pts[0], ev(), c);
  const d = UI.drag.value!;
  d.moved = true; beginGesture();
  for (const p of pts.slice(1)) select.onMove(d, p, ev(), c);
  UI.drag.value = null;
  select.onUp(d, release, ev(), c); endGesture();
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

test('N1: a several-point drag that joins on release keeps the other points\' clone copies', () => {
  let a = '', b = '', x = '';
  fresh('freehand', (d) => {
    a = line(d, [{ u: 0.05, v: 0.1 }, { u: 0.05, v: 0.5 }]).start.pointId;                        // raw (12, 24)
    const el = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });
    const pb = line(d, [{ u: 0.9, v: 0.1 }, { u: 0.9, v: 0.3 }]); P.addBinding(d, pb.id, [[el.id]]);
    b = pb.start.pointId;                                                                          // image (24, 24)
    x = line(d, [{ u: 0.2, v: 0.1 }, { u: 0.2, v: 0.3 }]).start.pointId;                           // a node at (48, 24)
  });
  UI.tool.value = 'select';
  select.onDown(null, { x: 0, y: 10 }, ev(), ctx);
  const m = UI.drag.value!; m.moved = true;
  select.onMove(m, { x: 40, y: 40 }, ev(), ctx);
  UI.drag.value = null; select.onUp(m, { x: 40, y: 40 }, ev(), ctx);
  const s0 = UI.selection.value;
  expect(s0 && s0.kind === 'points' && s0.copies?.[b]?.bindingId).toBeTruthy();
  selectDrag([{ x: 12, y: 24 }, { x: 40, y: 25 }, { x: 46, y: 25 }]);                              // grab the raw one onto X
  expect(doc.value.points.some((q) => q.id === a)).toBe(false);
  const s = UI.selection.value;
  expect(s && s.kind === 'points' && [...s.ids].sort()).toEqual([b, x].sort());
  expect(s && s.kind === 'points' && s.copies?.[b]?.bindingId).toBeTruthy();
});

test('N2: the own-line hint covers a long tip segment up to 3× the threshold from the tip, and the click splits there', () => {
  fresh('pen');
  click({ x: 60, y: 60 }); click({ x: 60, y: 90 }); click({ x: 210, y: 90 });   // a 150 px tip segment
  const id = UI.pen.value!.pathId;
  hoverAt({ x: 120, y: 93 }, hit({ x: 120, y: 93 }), ctx);
  expect(UI.snapHint.value?.label).toBe(STR.snap.ownLine);
  hoverAt({ x: 200, y: 93 }, hit({ x: 200, y: 93 }), ctx);                   // 10 px from the tip: inside the 36 px tail, beyond the sticky reach
  expect(UI.snapHint.value?.label).not.toBe(STR.snap.ownLine);
  click({ x: 120, y: 93 });
  const nodes = P.pathNodes(P.getPath(doc.value, id)!), last = nodes[nodes.length - 1];
  expect(nodes.slice(1, -1).some((n) => n.pointId === last.pointId)).toBe(true);
  expect(P.nodeWorld(doc.value, last).x).toBeCloseTo(120, 6);              // where the hint showed, on the tip segment
  expect(P.nodeWorld(doc.value, last).y).toBeCloseTo(90, 6);
  expect(UI.pen.value).toBe(null);
});

test('N2: a one-segment Pen path offers its own line', () => {
  fresh('pen');
  click({ x: 60, y: 60 }); click({ x: 210, y: 60 });
  hoverAt({ x: 100, y: 63 }, hit({ x: 100, y: 63 }), ctx);
  expect(UI.snapHint.value?.label).toBe(STR.snap.ownLine);
});

// --- Snap feedback (2026-10-01): G is the grid only; targets always attract; ⌘ / Ctrl frees; no hint, no snap (H7)

const noGrid: ToolCtx = { ...ctx, gridOn: false };
const free = (c: ToolCtx): ToolCtx => ({ ...c, targetsOn: false });   // ⌘ / Ctrl held

for (const c of [noGrid, ctx]) {
  test(`Pen, no stroke yet, grid ${c.gridOn ? 'on' : 'off'}: hovering near a tile edge, another path's line and a tile corner shows each hint`, () => {
    fresh('pen', (d) => { line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]); });   // y = 120, x 48..192
    const at = (w: XY) => { hoverAt(w, hit(w), c); return UI.snapHint.value; };
    const e = at({ x: 100, y: 235 });                                                     // 5 px from the edge y = 240
    expect(e?.label).toBe(STR.snap.edge); expect(e?.at.y).toBeCloseTo(240, 6); expect(e?.at.x).toBeCloseTo(100, 6);
    const l = at({ x: 100, y: 125 });                                                     // 5 px from the line
    expect(l?.label).toBe(STR.snap.line); expect(l?.at.y).toBeCloseTo(120, 6);
    const k = at({ x: 237, y: 236 });                                                     // 5 px from the corner (240, 240)
    expect(k?.label).toBe(STR.snap.corner); expect(k?.at.x).toBeCloseTo(240, 6); expect(k?.at.y).toBeCloseTo(240, 6);
  });
}

test('Freehand, grid off: an end released 5 px from its own mirror clone\'s line ends on that line (shown, then used)', () => {
  fresh('freehand', (d) => { const el = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 }); d.newPathGroups = [[el.id]]; });   // x = 120
  let label: string | undefined;
  const pts = [...along({ x: 40, y: 40 }, { x: 40, y: 200 }), ...along({ x: 40, y: 200 }, { x: 195, y: 150 }).slice(1)];   // the clone runs down x = 200
  hoverAt(pts[0], hit(pts[0]), noGrid);
  freehand.onDown(hit(pts[0]), pts[0], ev(), noGrid);
  const d = UI.drag.value!; d.moved = true; beginGesture();
  for (const p of pts.slice(1)) { freehand.onMove(d, p, ev(), noGrid); label = UI.snapHint.value?.label; }
  UI.drag.value = null; freehand.onUp(d, pts[pts.length - 1], ev(), noGrid); endGesture();
  expect(label).toBe(STR.snap.ownCloneLine);
  const nodes = P.pathNodes(newest()), end = P.nodeWorld(doc.value, nodes[nodes.length - 1]);
  expect(end.x).toBeCloseTo(200, 1);
});

test('Freehand, grid off: an end released 5 px from its own repeat\'s start wraps into that repeat', () => {
  fresh('freehand');
  gesture(freehand, [...along({ x: 220, y: 100 }, { x: 120, y: 150 }), ...along({ x: 120, y: 150 }, { x: -16, y: 103 }).slice(1)], ev(), noGrid);   // the repeat in cell (-1, 0) starts at (-20, 100)
  const p = newest(), nodes = P.pathNodes(p), last = nodes[nodes.length - 1];
  expect(last.pointId).toBe(p.start.pointId);
  expect(last.cell).toEqual({ c: p.start.cell.c - 1, r: p.start.cell.r });
});

for (const c of [noGrid, ctx]) {
  test(`Freehand, grid ${c.gridOn ? 'on' : 'off'}: an end hint that went away before the release is not used, even if the release is back in range`, () => {
    fresh('freehand');
    let shown: string | undefined;
    const pts = [...along({ x: 60, y: 60 }, { x: 100, y: 235 }), { x: 125, y: 225 }, { x: 150, y: 214 }];   // 5 px from the edge y = 240, then away to 26 px
    hoverAt(pts[0], hit(pts[0]), c);
    freehand.onDown(hit(pts[0]), pts[0], ev(), c);
    const d = UI.drag.value!; d.moved = true; beginGesture();
    for (const p of pts.slice(1)) { freehand.onMove(d, p, ev(), c); if (p.y === 235) shown = UI.snapHint.value?.label; }
    expect(shown).toBe(STR.snap.edge);
    expect(UI.snapHint.value).toBe(null);
    UI.drag.value = null; freehand.onUp(d, { x: 155, y: 236 }, ev(), c); endGesture();   // released 4 px from the edge with no hint showing
    const nodes = P.pathNodes(newest()), end = P.nodeWorld(doc.value, nodes[nodes.length - 1]);
    if (c.gridOn) { expect(end.x).toBeCloseTo(150, 6); expect(end.y).toBeCloseTo(240, 6); }   // the grid point nearest (155, 236), not the edge at (155, 240)
    else { expect(end.x).toBeCloseTo(155, 6); expect(end.y).toBeCloseTo(236, 6); }
  });
}

test('Select, grid off: a node dragged 5 px from another path\'s line, then from a tile edge, snaps to each', () => {
  let id = '';
  fresh('freehand', (d) => { id = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.25, v: 0.1 }]).id; line(d, [{ u: 0.5, v: 0.5 }, { u: 0.9, v: 0.5 }]); });   // A: (24,24) → (60,24); B: y = 120, x 120..216
  UI.tool.value = 'select';
  const A_ = () => P.getPath(doc.value, id)!, end = () => P.nodeWorld(doc.value, A_().segments[0].to), start = () => P.nodeWorld(doc.value, A_().start);
  const sel = () => { UI.selection.value = { kind: 'path', id, copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 } }; };
  sel(); expect(hit({ x: 60, y: 24 })?.kind).toBe('point');
  selectDrag([{ x: 60, y: 24 }, { x: 120, y: 80 }, { x: 170, y: 125 }], noGrid);
  expect(end().x).toBeCloseTo(170, 6); expect(end().y).toBeCloseTo(120, 6);                      // on B's line (and split into it)
  expect(start().x).toBeCloseTo(24, 6);                                                         // a node drag, not a body drag
  sel(); expect(hit({ x: 24, y: 24 })?.kind).toBe('point');
  selectDrag([{ x: 24, y: 24 }, { x: 60, y: 180 }, { x: 70, y: 235 }], noGrid);
  expect(start().x).toBeCloseTo(70, 6); expect(start().y).toBeCloseTo(240, 6);
  // H7: released 3 px from B's line after a last move 20 px off it (no hint): the drop stays where the last move put it.
  const bSegs = doc.value.paths.find((q) => q.id !== id)!.segments.length;
  sel(); selectDrag([{ x: 70, y: 240 }, { x: 150, y: 140 }, { x: 200, y: 100 }], noGrid, { x: 200, y: 117 });
  expect(start().x).toBeCloseTo(200, 6); expect(start().y).toBeCloseTo(100, 6);
  expect(doc.value.paths.find((q) => q.id !== id)!.segments).toHaveLength(bSegs);
});

test('Pen with ⌘ held next to a node: grid off lands raw and joins nothing; grid on lands on the grid', () => {
  let x = '';
  fresh('pen', (d) => { x = line(d, [{ u: 0.52, v: 0.52 }, { u: 0.8, v: 0.52 }]).start.pointId; });   // a node at (124.8, 124.8)
  const w = { x: 127, y: 122 };
  gesture(pen, [w], ev({ metaKey: true }), free(noGrid));
  expect(UI.snapHint.value).toBe(null);
  let p = P.getPath(doc.value, UI.pen.value!.pathId)!;
  expect(p.start.pointId).not.toBe(x);
  expect(P.nodeWorld(doc.value, p.start).x).toBeCloseTo(127, 6); expect(P.nodeWorld(doc.value, p.start).y).toBeCloseTo(122, 6);
  A.endPen(); doc.value = { ...doc.value, paths: doc.value.paths.filter((q) => q.id !== p.id) };
  gesture(pen, [w], ev({ metaKey: true }), free(ctx));
  p = P.getPath(doc.value, UI.pen.value!.pathId)!;
  expect(p.start.pointId).not.toBe(x);
  expect(P.nodeWorld(doc.value, p.start).x).toBeCloseTo(120, 6); expect(P.nodeWorld(doc.value, p.start).y).toBeCloseTo(120, 6);
});

test('G toggles prefs.grid; a stored { snap: false } loads as grid: false', () => {
  fresh('pen');
  expect(UI.prefs.value.grid).toBe(true);
  A.toggleGrid(); expect(UI.prefs.value.grid).toBe(false);
  A.toggleGrid(); expect(UI.prefs.value.grid).toBe(true);
  const store = new Map<string, string>();
  const g = globalThis as { localStorage?: unknown };
  const had = g.localStorage;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  try {
    const { snap: _s, grid: _g, ...rest } = { ...UI.prefs.value, snap: false };
    store.set(CONFIG.STORAGE_PREFS_KEY, JSON.stringify({ prefs: { ...rest, snap: false }, tool: 'pen', activeLayerId: null, view: { zoom: 1, pan: { x: 0, y: 0 } } }));
    restore();
    expect(UI.prefs.value.grid).toBe(false);
    expect('snap' in UI.prefs.value).toBe(false);
    const load = (extra: object) => {
      UI.prefs.value = { ...UI.prefs.value, grid: true };
      store.set(CONFIG.STORAGE_PREFS_KEY, JSON.stringify({ prefs: { ...rest, ...extra }, tool: 'pen', activeLayerId: null, view: { zoom: 1, pan: { x: 0, y: 0 } } }));
      restore();
      return UI.prefs.value.grid;
    };
    expect(load({ grid: false })).toBe(false);
    expect(load({})).toBe(true);
    UI.prefs.value = { ...UI.prefs.value, grid: false };
    store.set(CONFIG.STORAGE_PREFS_KEY, JSON.stringify({ prefs: rest, tool: 'pen', activeLayerId: null, view: { zoom: 1, pan: { x: 0, y: 0 } } }));
    restore();
    expect(UI.prefs.value.grid).toBe(true);    // neither field: the default
  } finally { g.localStorage = had; }
});

// --- Fix round 1: a hover record is reused only for the same mode and document

test('Pen: hover next to an open end, then ⌘-click at the same point (no pointer move): lands raw, joins nothing', () => {
  let id = '', end = '';
  fresh('pen', (d) => { const p = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.5, v: 0.5 }]); id = p.id; end = p.segments[0].to.pointId; });   // open end at (120, 120)
  const w = { x: 123, y: 122 }, cmd = ev({ metaKey: true });
  hoverAt(w, hit(w), noGrid);
  expect(UI.snapHint.value?.label).toBe(STR.snap.node);
  pen.onDown(hit(w), w, cmd, free(noGrid));
  const d = UI.drag.value; UI.drag.value = null;
  if (d) pen.onUp(d, w, cmd, free(noGrid));
  expect(P.getPath(doc.value, id)!.segments).toHaveLength(1);
  const p = UI.pen.value && P.getPath(doc.value, UI.pen.value.pathId);
  expect(p && p.id).not.toBe(id);
  expect(p!.start.pointId).not.toBe(end);
  const at = P.nodeWorld(doc.value, p!.start);
  expect(at.x).toBeCloseTo(123, 6); expect(at.y).toBeCloseTo(122, 6);
});

test('Freehand: hover next to an open end, then a ⌘ stroke from the same point starts raw and extends nothing', () => {
  let id = '';
  fresh('freehand', (d) => { id = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.5, v: 0.5 }]).id; });   // open end at (120, 120)
  const pts = along({ x: 123, y: 122 }, { x: 130, y: 220 }), c = free(noGrid);
  hoverAt(pts[0], hit(pts[0]), noGrid);
  expect(UI.snapHint.value?.label).toBe(STR.snap.node);
  const cmd = ev({ metaKey: true });
  freehand.onDown(hit(pts[0]), pts[0], cmd, c);
  const d = UI.drag.value!; d.moved = true; beginGesture();
  for (const p of pts.slice(1)) freehand.onMove(d, p, cmd, c);
  UI.drag.value = null; freehand.onUp(d, pts[pts.length - 1], cmd, c); endGesture();
  expect(doc.value.paths).toHaveLength(2);
  expect(P.getPath(doc.value, id)!.segments).toHaveLength(1);
  const at = P.nodeWorld(doc.value, newest().start);
  expect(at.x).toBeCloseTo(123, 6); expect(at.y).toBeCloseTo(122, 6);
});

// --- B / E5a: dragging the body of a clone or repeat moves the original; transforms never move

// A: (48,48) → (72,72). `kind` picks its one-element binding: translate (1/2, 0) puts the clone at (168,48) → (192,72);
// a mirror about x = 120 puts it at (192,48) → (168,72).
function bodyScene(kind: 'translate' | 'mirror') {
  let id = '';
  fresh('freehand', (d) => {
    const el = kind === 'translate' ? P.addElement(d, { kind: 'translate', u: 0.5, v: 0 }) : P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });
    id = line(d, [{ u: 0.2, v: 0.2 }, { u: 0.3, v: 0.3 }]).id; P.addBinding(d, id, [[el.id]]);
  });
  UI.tool.value = 'select'; UI.selection.value = null;
  const path = () => P.getPath(doc.value, id)!;
  return { id, start: () => P.nodeWorld(doc.value, path().start), end: () => P.nodeWorld(doc.value, path().segments[0].to) };
}

test('E5a: dragging a translation clone\'s body moves the original; elements and copies are unchanged', () => {
  const { start, end } = bodyScene('translate');
  const els = structuredClone(doc.value.elements), n = copies.value.length;
  const t = hit({ x: 180, y: 60 });
  expect(t?.kind).toBe('segment'); expect(t?.kind === 'segment' && t.copy.bindingId).toBeTruthy();
  selectDrag([{ x: 180, y: 60 }, { x: 195, y: 65 }, { x: 210, y: 70 }], noGrid);
  expect(doc.value.elements).toEqual(els);
  expect(copies.value.length).toBe(n);
  expect(start().x).toBeCloseTo(78, 6); expect(start().y).toBeCloseTo(58, 6);
  expect(end().x).toBeCloseTo(102, 6); expect(end().y).toBeCloseTo(82, 6);
});

test('E5a: dragging a mirror clone\'s body +30 px in x moves the original −30 px; the clone follows the pointer', () => {
  const { start, end } = bodyScene('mirror');
  const els = structuredClone(doc.value.elements);
  const t = hit({ x: 180, y: 60 });
  expect(t?.kind === 'segment' && t.copy.bindingId).toBeTruthy();
  selectDrag([{ x: 180, y: 60 }, { x: 195, y: 60 }, { x: 210, y: 60 }], noGrid);
  expect(doc.value.elements).toEqual(els);
  expect(start().x).toBeCloseTo(18, 6); expect(start().y).toBeCloseTo(48, 6);
  expect(end().x).toBeCloseTo(42, 6); expect(end().y).toBeCloseTo(72, 6);
  // the clone's start is the mirror of the original's: 240 − 18 = 222, i.e. 30 px right of 192
  expect(240 - start().x).toBeCloseTo(222, 6);
});

test('E5a: dragging a repeat at cell {1,0} moves the original by the same delta', () => {
  let id = '';
  fresh('freehand', (d) => { id = line(d, [{ u: 0.2, v: 0.2 }, { u: 0.3, v: 0.3 }]).id; });
  UI.tool.value = 'select'; UI.selection.value = null;
  const t = hit({ x: 300, y: 60 });
  expect(t?.kind === 'segment' && t.copy.cell.c).toBe(1);
  selectDrag([{ x: 300, y: 60 }, { x: 315, y: 65 }, { x: 330, y: 70 }], noGrid);
  const s = P.nodeWorld(doc.value, P.getPath(doc.value, id)!.start);
  expect(s.x).toBeCloseTo(78, 6); expect(s.y).toBeCloseTo(58, 6);
});

test('E5a: a clone dragged with its start 4 px from a tile corner lands on the corner; the hint shows at the clone', () => {
  const { start } = bodyScene('translate');
  // the clone's start (168,48) moves by (69.6, −44.8) to (237.6, 3.2), 4 px from the corner (240, 0)
  const pts = [{ x: 180, y: 60 }, { x: 220, y: 30 }, { x: 249.6, y: 15.2 }];
  select.onDown(hit(pts[0]), pts[0], ev(), noGrid);
  const d = UI.drag.value!;
  d.moved = true; beginGesture();
  for (const p of pts.slice(1)) select.onMove(d, p, ev(), noGrid);
  const hint = UI.snapHint.value;
  UI.drag.value = null;
  select.onUp(d, pts[2], ev(), noGrid); endGesture();
  expect(hint?.at.x).toBeCloseTo(240, 6); expect(hint?.at.y).toBeCloseTo(0, 6);
  expect(start().x).toBeCloseTo(120, 6); expect(start().y).toBeCloseTo(0, 6);   // the original's start; its clone is at (240, 0)
});

test('E5a: one undo restores everything after a clone body drag', () => {
  bodyScene('mirror');
  const before = structuredClone(doc.value);
  selectDrag([{ x: 180, y: 60 }, { x: 200, y: 70 }, { x: 215, y: 90 }]);
  expect(doc.value).not.toEqual(before);
  undo();
  expect(doc.value).toEqual(before);
  // Esc mid-drag (abortGesture) restores everything too
  select.onDown(hit({ x: 180, y: 60 }), { x: 180, y: 60 }, ev(), ctx);
  const d = UI.drag.value!;
  d.moved = true; beginGesture();
  select.onMove(d, { x: 215, y: 90 }, ev(), ctx);
  expect(doc.value).not.toEqual(before);
  UI.drag.value = null; abortGesture();
  expect(doc.value).toEqual(before);
});

test('E5a: a clone body dropped with its end on a same-layer clone node joins the pre-image in the original\'s frame', () => {
  const { aId, x } = cloneScene(true);                                                // A's clone (192,48) → (192,120); Q's clone starts at (180,180)
  UI.selection.value = null;
  const t = hit({ x: 192, y: 84 });
  expect(t?.kind === 'segment' && t.copy.bindingId).toBeTruthy();
  selectDrag([{ x: 192, y: 84 }, { x: 186, y: 120 }, { x: 181, y: 146 }], noGrid);   // the clone's end comes to (181,182)
  const end = P.getPath(doc.value, aId)!.segments[0].to;
  expect(end.pointId).toBe(x);                                                       // A's source end is Q's start (60,180)
  expect(end.via).toBeUndefined();
});

// --- B fix round 1: a 1/4-turn clone grabbed in cell {1,0}, a clone reaching outside the 3×3 window, neutral labels

// A: (48,48) → (72,48), one quarter turn about (120,120). The +90° clone runs (192,48) → (192,72); in cell {1,0}, (432,48) → (432,72).
function quarterScene() {
  let id = '';
  fresh('freehand', (d) => {
    const el = P.addElement(d, { kind: 'rotate', u: 0.5, v: 0.5, n: 4 });
    id = line(d, [{ u: 0.2, v: 0.2 }, { u: 0.3, v: 0.2 }]).id; P.addBinding(d, id, [[el.id]]);
  });
  UI.tool.value = 'select'; UI.selection.value = null;
  const t = hit({ x: 432, y: 60 });
  if (t?.kind !== 'segment') throw new Error(`expected a segment, got ${t?.kind}`);
  const shown = () => apply(copyMatrix(t.copy), P.nodeWorld(doc.value, P.getPath(doc.value, id)!.start));
  return { t, shown };
}

test('E5a: a quarter-turn clone grabbed in cell {1,0} follows the pointer exactly', () => {
  const { t, shown } = quarterScene();
  expect(t.copy.bindingId).toBeTruthy(); expect(t.copy.cell).toEqual({ c: 1, r: 0 });
  const s0 = shown();
  expect(s0.x).toBeCloseTo(432, 6); expect(s0.y).toBeCloseTo(48, 6);
  selectDrag([{ x: 432, y: 60 }, { x: 442, y: 66 }, { x: 452, y: 72 }], noGrid);
  const s1 = shown();
  expect(s1.x - s0.x).toBeCloseTo(20, 6); expect(s1.y - s0.y).toBeCloseTo(12, 6);
});

test('E5a: a quarter-turn clone in cell {1,0} dragged 3.5 px from a tile corner lands on it; the hint is there too', () => {
  const { shown } = quarterScene();
  const pts = [{ x: 432, y: 60 }, { x: 460, y: 30 }, { x: 477.5, y: 14.5 }];          // the clone's start to (477.5, 2.5)
  select.onDown(hit(pts[0]), pts[0], ev(), noGrid);
  const d = UI.drag.value!;
  d.moved = true; beginGesture();
  for (const p of pts.slice(1)) select.onMove(d, p, ev(), noGrid);
  const hint = UI.snapHint.value;
  UI.drag.value = null;
  select.onUp(d, pts[2], ev(), noGrid); endGesture();
  expect(hint?.at.x).toBeCloseTo(480, 6); expect(hint?.at.y).toBeCloseTo(0, 6);
  const s = shown();
  expect(s.x).toBeCloseTo(480, 6); expect(s.y).toBeCloseTo(0, 6);
});

test('E5a: a translate (5/2, 0) clone, far outside the 3×3 window, still snaps to a tile corner', () => {
  let id = '';
  fresh('freehand', (d) => {
    const el = P.addElement(d, { kind: 'translate', u: 2.5, v: 0 });
    id = line(d, [{ u: 0.2, v: 0.2 }, { u: 0.3, v: 0.3 }]).id; P.addBinding(d, id, [[el.id]]);
  });
  UI.tool.value = 'select'; UI.selection.value = null;
  UI.viewport.value = { width: 1000, height: 400 };                                   // cells up to c = 3 are visible
  try {
    const t = hit({ x: 660, y: 60 });                                                 // the clone (648,48) → (672,72), shown in cell {0,0}
    expect(t?.kind === 'segment' && t.copy.bindingId ? t.copy.cell : null).toEqual({ c: 0, r: 0 });
    const pts = [{ x: 660, y: 60 }, { x: 700, y: 30 }, { x: 729.6, y: 15.2 }];        // its start to (717.6, 3.2), 4 px from (720, 0)
    select.onDown(t, pts[0], ev(), noGrid);
    const d = UI.drag.value!;
    d.moved = true; beginGesture();
    for (const p of pts.slice(1)) select.onMove(d, p, ev(), noGrid);
    const hint = UI.snapHint.value;
    UI.drag.value = null;
    select.onUp(d, pts[2], ev(), noGrid); endGesture();
    expect(hint?.at.x).toBeCloseTo(720, 6); expect(hint?.at.y).toBeCloseTo(0, 6);
    const s = P.nodeWorld(doc.value, P.getPath(doc.value, id)!.start);
    expect(s.x).toBeCloseTo(120, 6); expect(s.y).toBeCloseTo(0, 6);                 // the original's start: its clone is at (720, 0)
  } finally { UI.viewport.value = { width: 0, height: 0 }; }
});

test('E5a: a mirror clone grabbed and meeting the original is labelled neutrally; the original keeps "mirror clone"', () => {
  // A: (60,60) → (60,100), mirror x = 120: its clone runs down x = 180. Dragging either until it meets the axis.
  const drag = (from: XY, to: XY) => {
    fresh('freehand', (d) => {
      const el = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });
      const p = line(d, [{ u: 0.25, v: 0.25 }, { u: 0.25, v: 0.4167 }]); P.addBinding(d, p.id, [[el.id]]);
    });
    UI.tool.value = 'select'; UI.selection.value = null;
    select.onDown(hit(from), from, ev(), noGrid);
    const d = UI.drag.value!;
    d.moved = true; beginGesture();
    select.onMove(d, to, ev(), noGrid);
    const label = UI.snapHint.value?.label;
    UI.drag.value = null; abortGesture();
    return label;
  };
  expect(drag({ x: 180, y: 80 }, { x: 122, y: 80 })).toBe(STR.snap.meetsMirrorCopy);
  expect(drag({ x: 60, y: 80 }, { x: 118, y: 80 })).toBe(STR.snap.meetsMirror);
});

// --- E6b: a translation element's u and v snap silently to k/n of the tile (T13); ⌘ / Ctrl frees them; G is ignored

function translateScene(u = 0.5, v = 0) {
  let id = '';
  fresh('pen', (d) => { id = P.addElement(d, { kind: 'translate', u, v }).id; });
  UI.layer.value = 'construction';
  const el = () => { const e = P.getElement(doc.value, id)!; if (e.kind !== 'translate') throw new Error('not a translation'); return e; };
  return { id, el };
}

test('E6b: dragging a translation tip near (1/2, 1/4) lands exactly there, grid on or off, with no hint', () => {
  for (const c of [ctx, noGrid]) {
    const { el } = translateScene();
    expect(hit({ x: 120, y: 0 })).toMatchObject({ kind: 'eltip' });
    gesture(construct, [{ x: 120, y: 0 }, { x: 121, y: 40 }, { x: 122, y: 61 }], ev(), c);   // u = 0.508, v = 0.254
    expect(el().u).toBe(0.5); expect(el().v).toBe(0.25);
    expect(UI.snapHint.value).toBe(null);
  }
});

test('E6b: with ⌘ held the tip lands where the pointer is, even with the grid on', () => {
  const { el } = translateScene();
  gesture(construct, [{ x: 120, y: 0 }, { x: 121, y: 40 }, { x: 122, y: 61 }], ev({ metaKey: true }), free(ctx));
  expect(el().u).toBeCloseTo(122 / 240, 9); expect(el().v).toBeCloseTo(61 / 240, 9);
});

test('E6b: a component more than the threshold from every fraction stays free; the other still snaps', () => {
  const { el } = translateScene();
  gesture(construct, [{ x: 120, y: 0 }, { x: 60, y: 60 }, { x: 24, y: 121 }], ev(), ctx);   // u = 0.1 (24 px from 0), v = 0.504
  expect(el().u).toBeCloseTo(0.1, 9); expect(el().v).toBe(0.5);
});

// --- E6, §6.5: box scale modifiers (⇧ proportions, ⌥ from the centre) and silent size fractions (T13)

const withCmd = (over: Partial<PointerEvent> = {}) => ev({ metaKey: true, ...over });
const expectAt = (p: XY, x: number, y: number) => { expect(p.x).toBeCloseTo(x, 6); expect(p.y).toBeCloseTo(y, 6); };
// A drag through `tool` with one event per point (the press uses es[0], the release the last); returns the hint shown
// after the last move.
function track(tool: ToolModule, pts: XY[], es: PointerEvent[], c: ToolCtx) {
  hoverAt(pts[0], hit(pts[0]), c);
  tool.onDown(hit(pts[0]), pts[0], es[0], c);
  const d = UI.drag.value!;
  d.moved = true; beginGesture();
  for (let i = 1; i < pts.length; i++) tool.onMove(d, pts[i], es[i], c);
  const hint = UI.snapHint.value;
  UI.drag.value = null;
  try { tool.onUp(d, pts[pts.length - 1], es[es.length - 1], c); } finally { endGesture(); }
  return hint;
}
// An open rhombus, selected, whose box (48,48)–(120,120) has empty corners: (84,48) → (120,84) → (84,120) → (48,84).
function rhombusScene(more: (d: Doc, rhombusId: string) => void = () => {}) {
  let id = '';
  fresh('freehand', (d) => { id = line(d, [{ u: 0.35, v: 0.2 }, { u: 0.5, v: 0.35 }, { u: 0.35, v: 0.5 }, { u: 0.2, v: 0.35 }]).id; more(d, id); });
  UI.tool.value = 'select';
  UI.selection.value = { kind: 'path', id, copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 } };
  const at = (i: number) => P.nodeWorld(doc.value, P.pathNodes(P.getPath(doc.value, id)!)[i]);
  return { id, at };
}

test('E6: a corner scales each axis on its own by default; ⇧ (or the Proportional toggle) keeps proportions', () => {
  let s = rhombusScene();
  expect(hit({ x: 120, y: 120 })).toMatchObject({ kind: 'bbox', h: 2 });
  track(select, [{ x: 120, y: 120 }, { x: 156, y: 138 }], [withCmd(), withCmd()], free(ctx));   // ⌘: no size fractions, the raw maths
  expectAt(s.at(1), 156, 93); expectAt(s.at(2), 102, 138);                                         // × 1.5 wide, × 1.25 tall, from (48,48)
  s = rhombusScene();
  const sh = withCmd({ shiftKey: true });
  track(select, [{ x: 120, y: 120 }, { x: 156, y: 138 }], [sh, sh], free(ctx));
  expectAt(s.at(1), 147, 97.5); expectAt(s.at(2), 97.5, 147);                                       // × 1.375 both ways
  s = rhombusScene();
  A.toggleKeepProportions();
  track(select, [{ x: 120, y: 120 }, { x: 156, y: 138 }], [withCmd(), withCmd()], free(ctx));
  expectAt(s.at(1), 147, 97.5);
});

test('E6: ⌥ scales from the box centre, and ⇧⌥ from the centre keeping proportions', () => {
  let s = rhombusScene();
  const alt = withCmd({ altKey: true });
  track(select, [{ x: 120, y: 120 }, { x: 156, y: 138 }], [alt, alt], free(ctx));
  expectAt(s.at(0), 84, 30); expectAt(s.at(1), 156, 84); expectAt(s.at(2), 84, 138);               // × 2 wide, × 1.5 tall about (84,84)
  s = rhombusScene();
  const both = withCmd({ altKey: true, shiftKey: true });
  track(select, [{ x: 120, y: 120 }, { x: 156, y: 138 }], [both, both], free(ctx));
  expectAt(s.at(0), 84, 21); expectAt(s.at(1), 147, 84); expectAt(s.at(2), 84, 147);               // × 1.75 both ways about (84,84)
});

test('E6 (review focus): ⇧ and ⌥ pressed or released mid-drag apply from the next move; only the last move\'s modifiers count', () => {
  let s = rhombusScene();
  const both = withCmd({ altKey: true, shiftKey: true });
  track(select, [{ x: 120, y: 120 }, { x: 138, y: 138 }, { x: 156, y: 138 }], [both, both, withCmd()], free(ctx));   // released before the last move
  expectAt(s.at(1), 156, 93); expectAt(s.at(2), 102, 138);                                           // as a plain drag to (156,138)
  s = rhombusScene();
  track(select, [{ x: 120, y: 120 }, { x: 156, y: 138 }, { x: 156, y: 138 }], [withCmd(), withCmd(), both], free(ctx));   // pressed, then one more move
  expectAt(s.at(1), 147, 84); expectAt(s.at(2), 84, 147);                                            // as a ⇧⌥ drag
});

test('E6, T13: a corner drag brings the width to exactly 1/3 of the tile, silently, grid on or off; ⌘ frees it', () => {
  for (const c of [ctx, noGrid]) {
    const s = rhombusScene();
    const hint = track(select, [{ x: 120, y: 120 }, { x: 129, y: 150 }], [ev(), ev()], c);           // raw: 81 wide (1 px from 80), 102 tall (18 from 120)
    const b = P.boundsWorld(doc.value, P.getPath(doc.value, s.id)!);
    expect(b.x1 - b.x0).toBeCloseTo(80, 6); expect(b.y1 - b.y0).toBeCloseTo(102, 6);
    expect(hint).toBe(null);                                                                        // H10: the size fractions are never hinted
  }
  const s = rhombusScene();
  track(select, [{ x: 120, y: 120 }, { x: 129, y: 150 }], [withCmd(), withCmd()], free(ctx));
  const b = P.boundsWorld(doc.value, P.getPath(doc.value, s.id)!);
  expect(b.x1 - b.x0).toBeCloseTo(81, 6);
});

test('E6: the endpoint hints still show while scaling: an end landing on another path\'s node', () => {
  rhombusScene((d) => { line(d, [{ u: 98 / 240, v: 0.2 }, { u: 98 / 240, v: 10 / 240 }]); });   // a node at (98, 48)
  const hint = track(select, [{ x: 120, y: 120 }, { x: 148, y: 148 }], [ev(), ev()], ctx);         // 100 × 100: no fraction near; the first end comes to (98, 48)
  expect(hint?.label).toBe(STR.snap.node);
  expectAt(hint!.at, 98, 48);
});

test('E6: the side handle of a vertical line (a zero-width box) changes nothing and writes no NaN, with any modifiers', () => {
  let id = '';
  fresh('freehand', (d) => { id = line(d, [{ u: 0.5, v: 0.2 }, { u: 0.5, v: 0.8 }]).id; });        // (120,48) → (120,192)
  UI.tool.value = 'select'; UI.selection.value = { kind: 'path', id, copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 } };
  expect(hit({ x: 120, y: 120 })).toMatchObject({ kind: 'bbox', h: 6 });                           // both side handles sit on the midpoint
  for (const e of [ev(), ev({ shiftKey: true }), ev({ altKey: true }), ev({ shiftKey: true, altKey: true })]) {
    track(select, [{ x: 120, y: 120 }, { x: 150, y: 130 }], [e, e], ctx);
    expect(doc.value.points.every((q) => Number.isFinite(q.u) && Number.isFinite(q.v))).toBe(true);
    const p = P.getPath(doc.value, id)!;
    expectAt(P.nodeWorld(doc.value, p.start), 120, 48); expectAt(P.nodeWorld(doc.value, p.segments[0].to), 120, 192);
  }
});

// --- E6a, H10: rotation just outside a box corner, originals only, 15° steps following G, an angle hint

test('E6a: hovering just outside a corner of the selected original shows the rotate cursor; inside the box, a repeat or a clone shows none', () => {
  const s = rhombusScene();
  const w = { x: 130, y: 38 };                                                                        // 14 px from the corner (120, 48), outside the box
  hoverAt(w, hit(w), ctx);
  expect(UI.hover.value).toMatchObject({ kind: 'bboxrot', h: 1 });
  expect(cursorFor()).toBe(ROTATE_CURSOR);
  hoverAt({ x: 110, y: 58 }, hit({ x: 110, y: 58 }), ctx);                                            // inside the box
  expect(cursorFor()).not.toBe(ROTATE_CURSOR);
  UI.selection.value = { kind: 'path', id: s.id, copy: { cell: { c: 1, r: 0 }, bindingId: null, power: 0 } };   // its repeat, box (288,48)–(360,120)
  hoverAt({ x: 370, y: 38 }, hit({ x: 370, y: 38 }), ctx);
  expect(UI.hover.value?.kind).not.toBe('bboxrot');
  expect(cursorFor()).not.toBe(ROTATE_CURSOR);
  expect(hit({ x: 360, y: 48 })).toMatchObject({ kind: 'bbox', h: 1 });                              // the repeat still scales
  let bind = '';
  const m = rhombusScene((d, rid) => { const el = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 }); bind = P.addBinding(d, rid, [[el.id]]).id; });
  UI.selection.value = { kind: 'path', id: m.id, copy: { cell: { c: 0, r: 0 }, bindingId: bind, power: 1 } };   // its mirror clone, box (120,48)–(192,120)
  hoverAt({ x: 202, y: 38 }, hit({ x: 202, y: 38 }), ctx);
  expect(UI.hover.value?.kind).not.toBe('bboxrot');
  expect(hit({ x: 192, y: 48 })).toMatchObject({ kind: 'bbox', h: 1 });
});

test('E6a: dragging from the rotate zone turns the path about its box centre in 15° steps while G is on, ⌘ or not; the hint shows the angle', () => {
  for (const [c, e] of [[ctx, ev()], [free(ctx), ev({ metaKey: true })]] as const) {
    const s = rhombusScene();
    const hint = track(select, [{ x: 130, y: 38 }, { x: 140, y: 90 }, { x: 130, y: 125 }], [e, e, e], c);   // 86.7° raw: steps to 90°
    expectAt(s.at(0), 120, 84); expectAt(s.at(1), 84, 120); expectAt(s.at(2), 48, 84); expectAt(s.at(3), 84, 48);
    expect(hint?.label).toBe(STR.snap.angle(90));
    expectAt(hint!.at, 120, 120);                                                                      // the grabbed corner (120, 48), turned
  }
});

test('E6a: with G off the angle is free, and the hint reads it to a tenth of a degree', () => {
  const s = rhombusScene();
  const hint = track(select, [{ x: 130, y: 38 }, { x: 130, y: 125 }], [ev(), ev()], noGrid);
  const th = Math.atan2(41, 46) + Math.PI / 4;                                                        // from the press angle (−45°)
  expectAt(s.at(0), 84 + 36 * Math.sin(th), 84 - 36 * Math.cos(th));
  expect(hint?.label).toBe(STR.snap.angle(Math.round((th * 1800) / Math.PI) / 10));
});

test('E6a: Esc mid-rotation restores the path and leaves no history entry', () => {
  rhombusScene();
  const before = structuredClone(doc.value), p0 = { x: 130, y: 38 };
  hoverAt(p0, hit(p0), ctx);
  select.onDown(hit(p0), p0, ev(), ctx);
  const d = UI.drag.value!; d.moved = true; beginGesture();
  select.onMove(d, { x: 130, y: 130 }, ev(), ctx);
  expect(doc.value).not.toEqual(before);
  UI.drag.value = null; abortGesture();                                                               // what pointer.ts does on Esc mid-drag
  expect(doc.value).toEqual(before);
  expect(undo()).toBe(false);
});

test('E6a (review focus): rotating a path that shares a point with another keeps the point shared; the other path\'s far end stays; one undo', () => {
  let oId = '';
  const s = rhombusScene((d, rid) => {
    const shared = P.getPath(d, rid)!.segments[0].to;                                                 // (120, 84)
    const o = P.startPath(d, { ...shared, cell: { ...shared.cell } }, { color: '#000', weight: 2 }, d.layers[0].id);
    P.appendNode(d, o.id, P.addPoint(d, { u: 200 / 240, v: 0.35 }));                                // → (200, 84)
    oId = o.id;
  });
  const before = structuredClone(doc.value);
  track(select, [{ x: 130, y: 38 }, { x: 130, y: 130 }], [ev(), ev()], ctx);
  const o = P.getPath(doc.value, oId)!;
  expect(o.start.pointId).toBe(P.getPath(doc.value, s.id)!.segments[0].to.pointId);
  expectAt(P.nodeWorld(doc.value, o.start), 84, 120);
  expectAt(P.nodeWorld(doc.value, o.segments[0].to), 200, 84);
  undo();
  expect(doc.value).toEqual(before);
});

test('E6a (review focus): the rotate zone wins over another path\'s line under it; the rotation leaves that path alone', () => {
  let lId = '';
  const s = rhombusScene((d) => { lId = line(d, [{ u: 100 / 240, v: 38 / 240 }, { u: 200 / 240, v: 38 / 240 }]).id; });   // y = 38, through (130, 38)
  UI.selection.value = null;
  expect(hit({ x: 130, y: 38 })).toMatchObject({ kind: 'segment', pathId: lId });
  UI.selection.value = { kind: 'path', id: s.id, copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 } };
  expect(hit({ x: 130, y: 38 })).toMatchObject({ kind: 'bboxrot', h: 1 });
  const lBefore = P.pathNodes(P.getPath(doc.value, lId)!).map((n) => P.nodeWorld(doc.value, n));
  track(select, [{ x: 130, y: 38 }, { x: 130, y: 130 }], [ev(), ev()], ctx);
  expectAt(s.at(0), 120, 84);
  P.pathNodes(P.getPath(doc.value, lId)!).forEach((n, i) => expectAt(P.nodeWorld(doc.value, n), lBefore[i].x, lBefore[i].y));
  expect(UI.selection.value).toMatchObject({ kind: 'path', id: s.id });
});

test('E6a (final review): a selected horizontal line body-drags from 1 px off its stroke, for mouse and touch; it never rotates there', () => {
  let id = '';
  fresh('freehand', (d) => { id = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.5, v: 0.5 }]).id; });         // (48,120) → (120,120), a zero-height box
  UI.tool.value = 'select'; A.selectPathAt(id);
  const handles = [48, 84, 120];                                                                      // corner, edge and side handles, nodes and the diamond
  for (const hs of [1, 2]) {
    const rPoint = (CONFIG.HANDLE_PX + 2) * hs;
    for (let x = 50; x <= 118; x++) {
      const t = hit({ x, y: 121 }, hs);
      expect(t?.kind).not.toBe('bboxrot');
      if (handles.every((hx) => Math.hypot(x - hx, 1) > rPoint)) expect(t).toMatchObject({ kind: 'segment', pathId: id });
    }
  }
  const touch: ToolCtx = { ...noGrid, hitScale: 2, threshold: 24 };
  const p0 = { x: 66, y: 121 };
  expect(hit(p0, 2)).toMatchObject({ kind: 'segment', pathId: id });
  hoverAt(p0, hit(p0, 2), touch);
  select.onDown(hit(p0, 2), p0, ev({ pointerType: 'touch' }), touch);
  const d = UI.drag.value!; d.moved = true; beginGesture();
  select.onMove(d, { x: 66, y: 161 }, ev({ pointerType: 'touch' }), touch);
  UI.drag.value = null; try { select.onUp(d, { x: 66, y: 161 }, ev({ pointerType: 'touch' }), touch); } finally { endGesture(); }
  expectAt(startOf(id), 48, 160); expectAt(P.nodeWorld(doc.value, P.getPath(doc.value, id)!.segments[0].to), 120, 160);
});

test('E6a (final review): 1 px outside a selected square\'s edge near a corner is its line; 20 px diagonally out of the corner rotates', () => {
  let id = '';
  fresh('freehand', (d) => { id = line(d, [{ u: 0.2, v: 0.2 }, { u: 0.5, v: 0.2 }, { u: 0.5, v: 0.5 }, { u: 0.2, v: 0.5 }, { u: 0.2, v: 0.2 }]).id; });   // (48,48)–(120,120)
  UI.tool.value = 'select'; A.selectPathAt(id);
  for (const hs of [1, 2]) {
    expect(hit({ x: 66, y: 47 }, hs)).toMatchObject({ kind: 'segment', pathId: id });
    expect(hit({ x: 47, y: 66 }, hs)).toMatchObject({ kind: 'segment', pathId: id });
    expect(hit({ x: 48 - 14.2, y: 48 - 14.2 }, hs)).toMatchObject({ kind: 'bboxrot', h: 0 });
  }
  hoverAt({ x: 66, y: 47 }, hit({ x: 66, y: 47 }), ctx);
  expect(cursorFor()).not.toBe(ROTATE_CURSOR);
});

test('E6a (final review): a click without a move in the rotate zone is an ordinary click: another path\'s line there is selected, empty space clears', () => {
  let lId = '';
  const s = rhombusScene((d) => { lId = line(d, [{ u: 100 / 240, v: 38 / 240 }, { u: 200 / 240, v: 38 / 240 }]).id; });   // y = 38, through (130, 38)
  expect(hit({ x: 130, y: 38 })).toMatchObject({ kind: 'bboxrot', h: 1 });
  gesture(select, [{ x: 130, y: 38 }]);
  expect(UI.selection.value).toEqual({ kind: 'path', id: lId, copy: base0 });
  A.selectPathAt(s.id);
  expect(hit({ x: 34, y: 34 })).toMatchObject({ kind: 'bboxrot', h: 0 });                             // empty, outside the top-left corner
  gesture(select, [{ x: 34, y: 34 }]);
  expect(UI.selection.value).toBe(null);
  A.selectPathAt(s.id);
  expect(hit({ x: 120, y: 84 })).toMatchObject({ kind: 'point' });                                     // the node on the side handle: unchanged
  expect(hit({ x: 84, y: 48 })).toMatchObject({ kind: 'point' });
});

test('E6a (final review): a click on a box handle without a move keeps the selection and inserts nothing', () => {
  let id = '';
  fresh('freehand', (d) => { id = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.5, v: 0.5 }]).id; });         // (48,120) → (120,120); the top edge handle sits on its midpoint
  UI.tool.value = 'select'; A.selectPathAt(id);
  expect(hit({ x: 84, y: 120 })).toMatchObject({ kind: 'bbox' });
  gesture(select, [{ x: 84, y: 120 }]);
  expect(UI.selection.value).toEqual({ kind: 'path', id, copy: base0 });
  expect(P.getPath(doc.value, id)!.segments).toHaveLength(1);
});

test('E6a (final review): a click without a move on a box corner with nothing under it keeps the selection', () => {
  const s = rhombusScene();
  expect(hit({ x: 120, y: 120 })).toMatchObject({ kind: 'bbox', h: 2 });
  gesture(select, [{ x: 120, y: 120 }]);
  expect(UI.selection.value).toEqual({ kind: 'path', id: s.id, copy: base0 });
});

test('E6a (final review): the hint offers rotation for a selected original only; a repeat\'s hint does not', () => {
  const s = rhombusScene();
  expect(hintText()).toBe(STR.hint.path);
  expect(STR.hint.path).toContain(STR.hint.rotatePhrase);
  gesture(select, [{ x: 336, y: 60 }]);                                                               // the repeat's first edge, (324,48) → (360,84)
  expect(UI.selection.value).toEqual({ kind: 'path', id: s.id, copy: { cell: { c: 1, r: 0 }, bindingId: null, power: 0 } });
  expect(hintText()).toBe(STR.hint.pathRepeat);
  expect(STR.hint.pathRepeat).not.toContain(STR.hint.rotatePhrase);
});

test('H10 (final review): the rotation\'s angle hint has no snap ring; a snap hint keeps it', () => {
  rhombusScene();
  const hint = track(select, [{ x: 130, y: 38 }, { x: 140, y: 90 }, { x: 130, y: 125 }], [ev(), ev(), ev()], ctx);
  expect(hint?.label).toBe(STR.snap.angle(90));
  expect(hint?.ring).toBe(false);
  const { a } = threePaths((d) => { line(d, [{ u: 103 / 240, v: 45 / 240 }, { u: 103 / 240, v: 10 / 240 }]); });
  A.selectPathAt(a);
  const snap = track(select, [{ x: 36, y: 24 }, { x: 51, y: 34 }, { x: 66, y: 44 }], [ev(), ev(), ev()], noGrid);   // clear of A's handles; its end comes to (102, 44)
  expect(snap).toBeTruthy();
  expect(snap!.ring).not.toBe(false);
});

// --- S8: a marquee selects the instances it wholly contains; else nodes; ⌥ at release always picks nodes

const base0 = { cell: { c: 0, r: 0 }, bindingId: null, power: 0 };
// A (24,24) → (72,24), B (24,72) → (72,96), C (150,24) → (216,24). Select tool, nothing selected.
function threePaths(more: (d: Doc) => void = () => {}) {
  const ids = { a: '', b: '', c: '' };
  fresh('freehand', (d) => {
    ids.a = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.3, v: 0.1 }]).id;
    ids.b = line(d, [{ u: 0.1, v: 0.3 }, { u: 0.3, v: 0.4 }]).id;
    ids.c = line(d, [{ u: 0.625, v: 0.1 }, { u: 0.9, v: 0.1 }]).id;
    more(d);
  });
  UI.tool.value = 'select'; UI.selection.value = null;
  return ids;
}
// A marquee drag through the Select tool, from empty space; returns the selection after the release.
function marquee(from: XY, to: XY, e = ev()) {
  expect(hit(from)).toBe(null);
  select.onDown(hit(from), from, e, ctx);
  const m = UI.drag.value!; m.moved = true;
  select.onMove(m, to, e, ctx);
  UI.drag.value = null; select.onUp(m, to, e, ctx);
  return UI.selection.value;
}

test('S8: a marquee around two whole paths selects both as paths; around one, that path', () => {
  const { a, b } = threePaths();
  expect(marquee({ x: 10, y: 10 }, { x: 90, y: 110 })).toEqual({ kind: 'paths', items: [{ id: a, copy: base0 }, { id: b, copy: base0 }] });
  expect(marquee({ x: 10, y: 10 }, { x: 90, y: 40 })).toEqual({ kind: 'path', id: a, copy: base0 });
});

test('S8: whole and partial instances together select only the whole ones; with no whole instance, nodes', () => {
  const { a, b } = threePaths();
  expect(marquee({ x: 10, y: 10 }, { x: 170, y: 40 })).toEqual({ kind: 'path', id: a, copy: base0 });   // C's start is inside, its end is not
  const s = marquee({ x: 40, y: 0 }, { x: 90, y: 110 });                                                  // only A's and B's ends; (40, 0) is clear of A's rotate zone
  const pa = P.getPath(doc.value, a)!, pb = P.getPath(doc.value, b)!;
  expect(s && s.kind === 'points' && [...s.ids].sort()).toEqual([pa.segments[0].to.pointId, pb.segments[0].to.pointId].sort());
});

test('S8: ⌥ held at release selects the nodes even around whole paths', () => {
  threePaths();
  const s = marquee({ x: 10, y: 10 }, { x: 90, y: 110 }, ev({ altKey: true }));
  expect(s?.kind).toBe('points');
  expect(s && s.kind === 'points' && s.ids.length).toBe(4);
});

test('S8: a ⇧-marquee adds whole instances to the instances already selected', () => {
  const { a, c } = threePaths();
  A.selectPathAt(c);
  expect(marquee({ x: 10, y: 10 }, { x: 90, y: 40 }, ev({ shiftKey: true }))).toEqual({ kind: 'paths', items: [{ id: c, copy: base0 }, { id: a, copy: base0 }] });
});

test('S8 (review focus): a path leaving the tile through its right edge is whole in a marquee around where it is drawn, in either tile', () => {
  let id = '', start = '';
  fresh('freehand', (d) => {
    const n = P.addPoint(d, { u: 0.9, v: 0.5 }); start = n.pointId;                                   // (216, 120)
    const p = P.startPath(d, n, { color: '#000', weight: 2 }, d.layers[0].id);
    P.appendNode(d, p.id, { ...P.addPoint(d, { u: 0.1, v: 0.5 }), cell: { c: 1, r: 0 } });            // (264, 120), in the next tile
    id = p.id;
  });
  UI.tool.value = 'select'; UI.selection.value = null;
  expect(marquee({ x: 200, y: 100 }, { x: 280, y: 140 })).toEqual({ kind: 'path', id, copy: base0 });
  expect(marquee({ x: -40, y: 100 }, { x: 40, y: 140 })).toEqual({ kind: 'path', id, copy: { cell: { c: -1, r: 0 }, bindingId: null, power: 0 } });   // its repeat, (−24,120) → (24,120)
  const s = marquee({ x: 196, y: 96 }, { x: 250, y: 140 });                                               // only the start is inside
  expect(s && s.kind === 'points' && s.ids).toEqual([start]);
});

// --- S10: several selected instances show every node; no box, no rotate zone

test('S10: a marquee around a path and a clone of another shows every node of both instances; neither has a box', () => {
  let a = '', bBind = '';
  fresh('freehand', (d) => {
    a = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.3, v: 0.1 }]).id;                                        // (24,24) → (72,24)
    const el = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });                      // x = 120
    const b = line(d, [{ u: 0.75, v: 0.3 }, { u: 0.9, v: 0.4 }]); bBind = P.addBinding(d, b.id, [[el.id]]).id;   // (180,72) → (216,96); clone (60,72) → (24,96)
  });
  UI.tool.value = 'select'; UI.selection.value = null;
  const s = marquee({ x: 10, y: 10 }, { x: 90, y: 110 });
  expect(s && s.kind === 'paths' && s.items.map((x) => x.copy.bindingId)).toEqual([null, bBind]);
  const m = multiNodeMarks.value;
  expect(m.map((x) => x.clone)).toEqual([false, false, true, true]);
  expectAt(m[0].at, 24, 24); expectAt(m[1].at, 72, 24); expectAt(m[2].at, 60, 72); expectAt(m[3].at, 24, 96);
  expect(hit({ x: 24, y: 24 })?.kind).toBe('point');                                                  // no box handle on A's box corner: its node (S2)
  expect(hit({ x: 82, y: 14 })).toBe(null);                                                            // no rotate zone either ...
  A.selectPathAt(a);
  expect(hit({ x: 82, y: 14 })).toMatchObject({ kind: 'bboxrot' });                                    // ... which A alone has
  expect(multiNodeMarks.value).toEqual([]);
});

// --- E5b: dragging any selected instance moves the whole selection

const startOf = (id: string) => P.nodeWorld(doc.value, P.getPath(doc.value, id)!.start);

test('E5b: with two paths selected, dragging one moves both by the same delta; the third stays; one undo puts them back', () => {
  const { a, b, c } = threePaths();
  marquee({ x: 10, y: 10 }, { x: 90, y: 110 });
  const before = structuredClone(doc.value);
  expect(hit({ x: 48, y: 24 })).toMatchObject({ kind: 'segment', pathId: a });
  gesture(select, [{ x: 48, y: 24 }, { x: 63, y: 34 }, { x: 78, y: 44 }], ev(), noGrid);
  expectAt(startOf(a), 54, 44); expectAt(startOf(b), 54, 92); expectAt(startOf(c), 150, 24);
  expect(UI.selection.value?.kind).toBe('paths');
  undo();
  expect(doc.value).toEqual(before);
});

test('E5b: the snap is measured at the grabbed instance and only the grabbed path joins; the other moves by the same delta', () => {
  let dId = '', fId = '';
  const { a, b } = threePaths((d) => {
    dId = line(d, [{ u: 103 / 240, v: 45 / 240 }, { u: 103 / 240, v: 10 / 240 }]).id;              // a node at (103, 45)
    fId = line(d, [{ u: 104 / 240, v: 118 / 240 }, { u: 150 / 240, v: 118 / 240 }]).id;            // a node at (104, 118)
  });
  marquee({ x: 10, y: 10 }, { x: 90, y: 110 });
  gesture(select, [{ x: 48, y: 24 }, { x: 63, y: 34 }, { x: 78, y: 44 }], ev(), noGrid);           // A's end comes to (102, 44), 1.4 px from D's node
  const pa = P.getPath(doc.value, a)!, pb = P.getPath(doc.value, b)!;
  expect(pa.segments[0].to.pointId).toBe(P.getPath(doc.value, dId)!.start.pointId);                 // A joined D
  expectAt(P.nodeWorld(doc.value, pb.segments[0].to), 103, 117);                                   // B moved by A's snapped delta (31, 21) ...
  expect(pb.segments[0].to.pointId).not.toBe(P.getPath(doc.value, fId)!.start.pointId);            // ... and joined nothing, 1.4 px from F's node
});

test('E5b (review focus): original and mirror clone selected; grabbing the clone moves the original by the pointer delta, once', () => {
  let id = '';
  fresh('freehand', (d) => {
    const el = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });                    // x = 120
    id = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.3, v: 0.1 }]).id; P.addBinding(d, id, [[el.id]]);       // (24,24) → (72,24); clone (216,24) → (168,24)
  });
  UI.tool.value = 'select'; UI.selection.value = null;
  const s = marquee({ x: 10, y: 10 }, { x: 230, y: 40 });
  expect(s && s.kind === 'paths' && s.items.map((x) => [x.id, !!x.copy.bindingId])).toEqual([[id, false], [id, true]]);
  const t = hit({ x: 192, y: 24 });
  expect(t?.kind === 'segment' && t.copy.bindingId).toBeTruthy();
  gesture(select, [{ x: 192, y: 24 }, { x: 180, y: 24 }, { x: 168, y: 24 }], ev(), noGrid);         // the clone 24 px left
  const p = P.getPath(doc.value, id)!;
  expectAt(P.nodeWorld(doc.value, p.start), 0, 24); expectAt(P.nodeWorld(doc.value, p.segments[0].to), 48, 24);   // the original 24 px left (the pointer's delta), once; its clone follows the mirror
});

test('E5b (review focus): only a clone of a rider selected; the clone follows the pointer and the original moves the mirrored way', () => {
  let x = '', y = '';
  fresh('freehand', (d) => {
    const el = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });                    // x = 120
    x = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.3, v: 0.1 }]).id; P.addBinding(d, x, [[el.id]]);         // (24,24) → (72,24); clone (216,24) → (168,24)
    y = line(d, [{ u: 0.1, v: 0.3 }, { u: 0.3, v: 0.3 }]).id;                                        // (24,72) → (72,72), no clones
  });
  UI.tool.value = 'select';
  const tc = hit({ x: 192, y: 24 });
  expect(tc?.kind === 'segment' && tc.copy.bindingId).toBeTruthy();
  UI.selection.value = { kind: 'paths', items: [{ id: x, copy: tc!.kind === 'segment' ? tc!.copy : base0 }, { id: y, copy: base0 }] };
  expect(hit({ x: 48, y: 72 })).toMatchObject({ kind: 'segment', pathId: y });
  gesture(select, [{ x: 48, y: 72 }, { x: 60, y: 72 }, { x: 72, y: 72 }], ev(), noGrid);           // Y 24 px right
  expectAt(startOf(y), 48, 72);
  const p = P.getPath(doc.value, x)!;
  expectAt(P.nodeWorld(doc.value, p.start), 0, 24); expectAt(P.nodeWorld(doc.value, p.segments[0].to), 48, 24);   // X's original 24 px left, so its selected clone moved 24 px right with the pointer
});

test('E5b (final review): original and its repeat selected; grabbing the repeat shows the snap hint in the repeat\'s tile, under the pointer', () => {
  let dId = '';
  const { a } = threePaths((d) => { dId = line(d, [{ u: 103 / 240, v: 45 / 240 }, { u: 103 / 240, v: 10 / 240 }]).id; });   // a node at (103, 45); its repeat at (343, 45)
  const rep = { cell: { c: 1, r: 0 }, bindingId: null, power: 0 };
  UI.selection.value = { kind: 'paths', items: [{ id: a, copy: base0 }, { id: a, copy: rep }] };
  expect(hit({ x: 288, y: 24 })).toMatchObject({ kind: 'segment', pathId: a, copy: rep });
  const hint = track(select, [{ x: 288, y: 24 }, { x: 303, y: 34 }, { x: 318, y: 44 }], [ev(), ev(), ev()], noGrid);   // the repeat's end comes to (342, 44)
  expect(hint).toBeTruthy();
  expectAt(hint!.at, 343, 45);                                                                       // D's node as the repeat sees it, not (103, 45)
  expect(P.getPath(doc.value, a)!.segments[0].to.pointId).toBe(P.getPath(doc.value, dId)!.start.pointId);   // the snap and join were right already
});

test('E5b: a click on a selected instance without a drag selects just that instance', () => {
  const { b } = threePaths();
  marquee({ x: 10, y: 10 }, { x: 90, y: 110 });
  const t = hit({ x: 48, y: 84 });
  expect(t).toMatchObject({ kind: 'segment', pathId: b });
  select.onDown(t, { x: 48, y: 84 }, ev(), ctx);
  const d = UI.drag.value!; UI.drag.value = null; select.onUp(d, { x: 48, y: 84 }, ev(), ctx);
  expect(UI.selection.value).toEqual({ kind: 'path', id: b, copy: base0 });
});

test('E5b: pressing an unselected path replaces the selection and drags that path alone', () => {
  const { a, b, c } = threePaths();
  marquee({ x: 10, y: 10 }, { x: 90, y: 110 });
  gesture(select, [{ x: 183, y: 24 }, { x: 183, y: 39 }, { x: 183, y: 54 }], ev(), noGrid);
  expect(UI.selection.value).toEqual({ kind: 'path', id: c, copy: base0 });
  expectAt(startOf(c), 150, 54); expectAt(startOf(a), 24, 24); expectAt(startOf(b), 24, 72);
});

test('E5b (review focus): a quarter-turn clone rides with its inverse linear part, not the forward rotation (a mirror cannot tell them apart)', () => {
  let x = '', y = '';
  fresh('freehand', (d) => {
    const el = P.addElement(d, { kind: 'rotate', u: 0.5, v: 0.5, n: 4 });                           // centre (120, 120)
    x = line(d, [{ u: 0.2, v: 0.2 }, { u: 0.3, v: 0.2 }]).id; P.addBinding(d, x, [[el.id]]);        // (48,48) → (72,48); quarter clone (432,48) → (432,72)
    y = line(d, [{ u: 150 / 240, v: 150 / 240 }, { u: 170 / 240, v: 150 / 240 }]).id;               // (150,150) → (170,150), no clones
  });
  UI.tool.value = 'select'; UI.selection.value = null;
  const t = hit({ x: 432, y: 60 });
  if (t?.kind !== 'segment') throw new Error(`expected a segment, got ${t?.kind}`);
  UI.selection.value = { kind: 'paths', items: [{ id: x, copy: t.copy }, { id: y, copy: base0 }] };
  const px = P.getPath(doc.value, x)!;
  const cloneBefore = P.pathWorld(doc.value, px).map((q) => apply(copyMatrix(t.copy), q));
  expectAt(cloneBefore[0], 432, 48); expectAt(cloneBefore[1], 432, 72);
  expect(hit({ x: 160, y: 150 })).toMatchObject({ kind: 'segment', pathId: y });                    // mid-line, clear of both nodes (hittable since S2, 2026-10-06)
  gesture(select, [{ x: 160, y: 150 }, { x: 177, y: 157 }], ev(), noGrid);                          // Y dragged by (17, 7); nothing within 18 px of either end
  const cloneAfter = P.pathWorld(doc.value, P.getPath(doc.value, x)!).map((q) => apply(copyMatrix(t.copy), q));
  for (let i = 0; i < cloneBefore.length; i++) expectAt(cloneAfter[i], cloneBefore[i].x + 17, cloneBefore[i].y + 7);   // the clone followed the pointer exactly
  const py = P.getPath(doc.value, y)!;
  expectAt(P.nodeWorld(doc.value, py.start), 167, 157); expectAt(P.nodeWorld(doc.value, py.segments[0].to), 187, 157);
});

// --- 2026-10-06: nodes of unselected paths are hinted and hittable in Select (S2, S3, S9 revised); a clone's nodes too

const selClick = (w: XY, e = ev()) => { gesture(select, [w], e); return UI.selection.value; };
// A (24,24) → (48,24) → (72,24) with a translate (0.5, 0) group: its clone is (144,24) → (168,24) → (192,24).
function clonedLine() {
  const r = { id: '', a: '', m: '', b: '', bind: '' };
  fresh('freehand', (d) => {
    const el = P.addElement(d, { kind: 'translate', u: 0.5, v: 0 });
    const p = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.2, v: 0.1 }, { u: 0.3, v: 0.1 }]);
    r.id = p.id; r.a = p.start.pointId; r.m = p.segments[0].to.pointId; r.b = p.segments[1].to.pointId; r.bind = P.addBinding(d, p.id, [[el.id]]).id;
  });
  UI.tool.value = 'select'; UI.selection.value = null;
  return r;
}
const cloneCopy = (bind: string) => ({ cell: { c: 0, r: 0 }, bindingId: bind, power: 1 });

test('S2/S3: in Select a node of an unselected path hits as a point; a click selects it and ⇧-click adds another path\'s node', () => {
  const { a, b } = threePaths();
  const aStart = P.getPath(doc.value, a)!.start.pointId, bStart = P.getPath(doc.value, b)!.start.pointId;
  expect(hit({ x: 24, y: 24 })).toMatchObject({ kind: 'point', pointId: aStart });
  expect(selClick({ x: 24, y: 24 })).toEqual({ kind: 'points', ids: [aStart] });
  expect(hit({ x: 24, y: 72 })).toMatchObject({ kind: 'point', pointId: bStart });
  expect(selClick({ x: 24, y: 72 }, ev({ shiftKey: true }))).toEqual({ kind: 'points', ids: [aStart, bStart] });
});

test('S9 (revised): pressing a node of an unselected path and dragging moves that node, not the path', () => {
  const { a } = threePaths();
  gesture(select, [{ x: 24, y: 24 }, { x: 27, y: 35 }, { x: 30, y: 45 }], ev(), noGrid);
  const p = P.getPath(doc.value, a)!;
  expectAt(P.nodeWorld(doc.value, p.start), 30, 45); expectAt(P.nodeWorld(doc.value, p.segments[0].to), 72, 24);
});

test('S2/S3: a clone\'s node of an unselected path hits as a clone anchor; a click selects the point through the clone, ⇧-click adds a raw node', () => {
  const { a, b, bind } = clonedLine();
  expect(hit({ x: 144, y: 24 })).toMatchObject({ kind: 'canchor', pointId: a, copy: cloneCopy(bind) });
  expect(selClick({ x: 144, y: 24 })).toEqual({ kind: 'points', ids: [a], copies: { [a]: cloneCopy(bind) } });
  expect(selClick({ x: 72, y: 24 }, ev({ shiftKey: true }))).toEqual({ kind: 'points', ids: [a, b], copies: { [a]: cloneCopy(bind) } });
  expect(selClick({ x: 144, y: 24 }, ev({ shiftKey: true }))).toEqual({ kind: 'points', ids: [b] });
});

test('Delete: ⌫ with a clone\'s node hovered removes that node, whether the original or the clone is selected', () => {
  for (const selectAt of [{ x: 36, y: 24 }, { x: 156, y: 24 }]) {
    const { id, m, bind } = clonedLine();
    expect(selClick(selectAt)).toMatchObject({ kind: 'path', id });
    const t = hit({ x: 168, y: 24 });
    expect(t).toMatchObject({ kind: 'canchor', pointId: m, copy: cloneCopy(bind) });
    hoverAt({ x: 168, y: 24 }, t, ctx);
    expect(A.deleteHoveredOrSelection()).toBe(true);
    const p = P.getPath(doc.value, id)!;
    expect(p).toBeTruthy();
    expect(P.pathNodes(p).map((n) => n.pointId)).not.toContain(m);
    expect(P.pathNodes(p)).toHaveLength(2);
    expect(doc.value.bindings.map((x) => x.id)).toEqual([bind]);
  }
});
