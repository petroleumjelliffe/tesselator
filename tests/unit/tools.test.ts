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
import { CONFIG } from '../../src/config';
import { restore } from '../../src/state/persist';
import { hoverAt } from '../../src/interaction/pointer';
import { reset, beginGesture, endGesture, abortGesture, undo } from '../../src/state/history';
import { copies, cloneMatrices, copyMatrix } from '../../src/state/derived';
import { apply } from '../../src/engine/transform';
import { hitTest, type HitContext } from '../../src/engine/hit';
import type { ToolModule, ToolCtx } from '../../src/interaction/tools/common';
import type { Doc, XY, UV } from '../../src/types';

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
const hctx = (): HitContext => ({ layer: UI.layer.value, tool: UI.tool.value, selection: UI.selection.value, pen: UI.pen.value, zoom: 1, hitScale: 1, copies: copies.value, cloneMatrices: cloneMatrices.value, faces: [] });
const hit = (w: XY) => hitTest(doc.value, hctx(), w);
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
