import { test, expect } from 'vitest';
import * as P from '../../src/engine/paths';
import { hitTest, anchorsWorld, snapWorld, pointsInRect, projectOnSegment, bboxHandles, scaleFor, scaleMatrix, seedOf, type HitContext } from '../../src/engine/hit';
import { orbit, apply, cellMatrix, compose } from '../../src/engine/transform';
import { windowOffsets } from '../../src/engine/lattice';
import { CONFIG } from '../../src/config';
import type { Doc, CopyInfo, Matrix, Selection } from '../../src/types';

function makeDoc(): Doc { return { version: 1, lattice: { ...CONFIG.LATTICE_PRESETS.Square }, points: [], paths: [], elements: [], bindings: [], fills: [], newPathOps: [] }; }
function copiesOf(d: Doc): { copies: CopyInfo[]; cm: Map<string, Matrix[]> } {
  const cm = new Map<string, Matrix[]>();
  for (const b of d.bindings) cm.set(b.id, orbit(b.ops, d.elements, d.lattice).matrices);
  const copies: CopyInfo[] = [];
  for (const cell of windowOffsets()) for (const p of d.paths) {
    const Mo = cellMatrix(cell, d.lattice);
    copies.push({ pathId: p.id, copy: { cell, bindingId: null, power: 0 }, M: Mo });
    for (const b of d.bindings) if (b.pathId === p.id) (cm.get(b.id) ?? []).forEach((M, k) => copies.push({ pathId: p.id, copy: { cell, bindingId: b.id, power: k + 1 }, M: compose(Mo, M) }));
  }
  return { copies, cm };
}
function ctxFor(d: Doc, over: Partial<HitContext> = {}): HitContext {
  const { copies, cm } = copiesOf(d);
  return { layer: 'drawing', tool: 'select', selection: null, pen: null, zoom: 1, hitScale: 1, copies, cloneMatrices: cm, faces: [], ...over };
}
function scene() {
  const d = makeDoc();
  const n = P.addPoint(d, { u: 0.1, v: 0.1 });                       // (24, 24)
  const path = P.startPath(d, n, { color: '#000', weight: 2 });
  P.appendNode(d, path.id, P.addPoint(d, { u: 0.4, v: 0.1 }));        // (96, 24)
  const el = P.addElement(d, { kind: 'rotate', u: 0.5, v: 0.5, n: 2 });
  const b = P.addBinding(d, path.id, [el.id]);
  return { d, path, n, el, b };
}

test('segments of any copy are hit and report their copy', () => {
  const { d, path, b } = scene();
  const ctx = ctxFor(d);
  const base = hitTest(d, ctx, { x: 60, y: 27 });
  expect(base).toMatchObject({ kind: 'segment', pathId: path.id, j: 0, copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 } });
  const right = hitTest(d, ctx, { x: 300, y: 27 });
  expect(right).toMatchObject({ kind: 'segment', copy: { cell: { c: 1, r: 0 } } });
  const clone = hitTest(d, ctx, { x: 180, y: 216 });                 // image of the segment under the 180° turn
  expect(clone).toMatchObject({ kind: 'segment', copy: { bindingId: b.id, power: 1 } });
});

test('priority: bbox handle beats point beats segment; points are only hit when visible', () => {
  const { d, path } = scene();
  const sel: Selection = { kind: 'path', id: path.id, copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 } };
  const ctx = ctxFor(d, { selection: sel });
  expect(hitTest(d, ctx, { x: 24, y: 24 })!.kind).toBe('bbox');       // corner handle sits on the point
  expect(hitTest(d, ctx, { x: 60, y: 24 })!.kind).toBe('bbox');       // a zero-height box puts its edge handle on the midpoint too
  const penSel = ctxFor(d, { tool: 'pen', selection: sel });
  expect(hitTest(d, penSel, { x: 60, y: 24 })!.kind).toBe('diamond');  // Pen has no bbox, so the midpoint diamond wins
  const noSel = ctxFor(d);
  expect(hitTest(d, noSel, { x: 24, y: 24 })!.kind).toBe('segment');  // point not visible with nothing selected
  const penCtx = ctxFor(d, { tool: 'pen' });
  expect(hitTest(d, penCtx, { x: 24, y: 24 })).toMatchObject({ kind: 'point', cell: { c: 0, r: 0 } });
  expect(hitTest(d, penCtx, { x: 264, y: 24 })).toMatchObject({ kind: 'point', cell: { c: 1, r: 0 } });
});

test('thresholds scale with zoom and double for touch', () => {
  const { d } = scene();
  const pen = ctxFor(d, { tool: 'pen' });
  expect(hitTest(d, pen, { x: 24, y: 36 })).toBe(null);                              // 12 px away: too far for mouse
  expect(hitTest(d, { ...pen, hitScale: 2 }, { x: 24, y: 36 })!.kind).toBe('point'); // touch reaches it
  expect(hitTest(d, { ...pen, zoom: 4 }, { x: 24, y: 27 })).toBe(null);              // 3 world px = 12 screen px at zoom 4
});

test('construction layer hits elements and lattice handles, selected mirror exposes its knob', () => {
  const d = makeDoc();
  const m = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0, du: 0, dv: 1 });        // line x = 120
  const ctx = ctxFor(d, { layer: 'construction' });
  expect(hitTest(d, ctx, { x: 121, y: 200 })).toMatchObject({ kind: 'element', elementId: m.id });
  expect(hitTest(d, ctx, { x: 240, y: 0 })).toMatchObject({ kind: 'lat', which: 'a' });
  const sel = ctxFor(d, { layer: 'construction', selection: { kind: 'element', id: m.id } });
  expect(hitTest(d, sel, { x: 120, y: 70 })).toMatchObject({ kind: 'elrot' });
  expect(hitTest(d, ctxFor(d), { x: 121, y: 200 })).toBe(null);                     // drawing layer ignores elements
});

test('anchors and snapping: neighbour copies, clone points, skip, grid fallback', () => {
  const { d, n } = scene();
  const all = anchorsWorld(d);
  expect(all.filter((a) => !a.bindingId)).toHaveLength(18);
  expect(all.filter((a) => a.bindingId)).toHaveLength(18);
  const s = snapWorld(d, { x: 267, y: 26 }, 12, 8);
  expect(s.x).toBeCloseTo(264, 9); expect(s.anchor).toMatchObject({ pointId: n.pointId, cell: { c: 1, r: 0 } });
  const skipped = snapWorld(d, { x: 267, y: 26 }, 12, 8, (a) => !a.bindingId && a.pointId === n.pointId);
  expect(skipped.x).toBeCloseTo(270, 9); expect(skipped.anchor).toBe(null);          // grid: 240 + 30
  const raw = snapWorld(d, { x: 267, y: 26 }, 12, 8, () => true, false);
  expect(raw.x).toBe(267);
  const own = snapWorld(d, { x: 214, y: 218 }, 12, 8, (a) => !a.bindingId && a.pointId === n.pointId);
  expect(own.anchor).toMatchObject({ bindingId: d.bindings[0].id });                 // may snap to its own clone image
});

test('marquee, projection, bbox maths, seedOf', () => {
  const { d, n } = scene();
  expect(pointsInRect(d, { x0: 260, y0: 20, x1: 270, y1: 30 })).toEqual([n.pointId]);
  expect(projectOnSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: -50, y: 9 }).x).toBeCloseTo(5, 9);
  const hs = bboxHandles({ x0: 0, y0: 0, x1: 100, y1: 50 });
  expect(hs).toHaveLength(8);
  const u = scaleFor(hs[2], { x: 200, y: 100 }, false); expect(u.sx).toBeCloseTo(2, 9); expect(u.sy).toBeCloseTo(2, 9);
  const f = scaleFor(hs[2], { x: 200, y: 25 }, true); expect(f.sy).toBeCloseTo(0.5, 9);
  expect(apply(scaleMatrix(0, 0, 2, 2), { x: 10, y: 5 })).toEqual({ x: 20, y: 10 });
  expect(seedOf({ x: 300, y: 120 }, d.lattice)).toEqual({ x: 60, y: 120 });
});
