import { test, expect } from 'vitest';
import * as P from '../../src/engine/paths';
import { hitTest, anchorsWorld, snapWorld, pointsInRect, projectOnSegment, bboxHandles, scaleFor, scaleMatrix, seedOf, pathsNear, type HitContext } from '../../src/engine/hit';
import { orbit, apply, cellMatrix, compose } from '../../src/engine/transform';
import { windowOffsets } from '../../src/engine/lattice';
import { computeFaces } from '../../src/engine/regions';
import { buildTargets } from '../../src/engine/snap';
import { CONFIG } from '../../src/config';
import type { Doc, CopyInfo, Matrix, Selection } from '../../src/types';

function makeDoc(): Doc { return { version: 2, lattice: { ...CONFIG.LATTICE_PRESETS.Square }, points: [], paths: [], elements: [], bindings: [], fills: [], layers: [{ id: 'L1', name: 'Layer 1' }], newPathGroups: [] }; }
function copiesOf(d: Doc): { copies: CopyInfo[]; cm: Map<string, (Matrix | null)[]> } {
  const cm = new Map<string, (Matrix | null)[]>();
  for (const b of d.bindings) cm.set(b.id, orbit(b.groups, d.elements, d.lattice, CONFIG.ORBIT_CAP, CONFIG.CLONE_CAP).matrices);
  const copies: CopyInfo[] = [];
  for (const cell of windowOffsets()) for (const p of d.paths) {
    const Mo = cellMatrix(cell, d.lattice);
    copies.push({ pathId: p.id, copy: { cell, bindingId: null, power: 0 }, M: Mo });
    for (const b of d.bindings) if (b.pathId === p.id) (cm.get(b.id) ?? []).forEach((M, k) => { if (M) copies.push({ pathId: p.id, copy: { cell, bindingId: b.id, power: k + 1 }, M: compose(Mo, M) }); });
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
  const path = P.startPath(d, n, { color: '#000', weight: 2 }, 'L1');
  P.appendNode(d, path.id, P.addPoint(d, { u: 0.4, v: 0.1 }));        // (96, 24)
  const el = P.addElement(d, { kind: 'rotate', u: 0.5, v: 0.5, n: 2 });
  const b = P.addBinding(d, path.id, [[el.id]]);
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
  expect(hitTest(d, ctx, { x: 24, y: 24 })!.kind).toBe('point');      // the node beats the coincident corner handle (S6)
  expect(hitTest(d, ctx, { x: 60, y: 24 })!.kind).toBe('bbox');       // a zero-height box puts its edge handle on the midpoint too
  P.setControlPointWorld(d, path.id, 0, { x: 50, y: 70 });            // now the box has height and the diamond sits away from every handle
  expect(hitTest(d, ctxFor(d, { selection: sel }), { x: 50, y: 70 })!.kind).toBe('diamond');
  expect(hitTest(d, ctxFor(d, { tool: 'pen', selection: sel }), { x: 50, y: 70 })).toBe(null);   // Pen never hits diamonds
  expect(hitTest(d, ctxFor(d, { tool: 'freehand' }), { x: 216, y: 216 })).toBe(null);           // Freehand never hits clone anchors
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
  const flat = bboxHandles({ x0: 0, y0: 10, x1: 100, y1: 10 });   // zero-height box: edge handles coincide with the box centre line
  expect(scaleFor(flat[4], { x: 50, y: 40 }, false)).toEqual({ sx: 1, sy: 1 });
  expect(Number.isNaN(scaleFor(flat[0], { x: 200, y: 10 }, false).sx)).toBe(false);
  expect(apply(scaleMatrix(0, 0, 2, 2), { x: 10, y: 5 })).toEqual({ x: 20, y: 10 });
  expect(seedOf({ x: 300, y: 120 }, d.lattice)).toEqual({ x: 60, y: 120 });
});

test('a fill on a region straddling the cell edge is hit from either side of the edge', () => {
  const d = makeDoc();
  const pts = [{ u: 0.75, v: 0.25 }, { u: 1.25, v: 0.25 }, { u: 1.25, v: 0.75 }, { u: 0.75, v: 0.75 }].map((p) => P.addPoint(d, p));
  const path = P.startPath(d, pts[0], { color: '#000', weight: 2 }, 'L1');
  for (const n of pts.slice(1)) P.appendNode(d, path.id, n);
  P.appendNode(d, path.id, pts[0]);
  const fill = P.addFill(d, { u: 0.9, v: 0.5 }, '#f00', 'L1');                       // seeded left of the edge, inside the base cell
  const ctx = ctxFor(d, { tool: 'fill', faces: computeFaces(d) });
  expect(hitTest(d, ctx, { x: 200, y: 120 })).toEqual({ kind: 'fill', fillId: fill.id });
  expect(hitTest(d, ctx, { x: 250, y: 120 })).toEqual({ kind: 'fill', fillId: fill.id });
  expect(hitTest(d, ctx, { x: 10, y: 120 })).toEqual({ kind: 'fill', fillId: fill.id });   // the copy in cell (-1, 0)
  expect(hitTest(d, ctx, { x: 120, y: 20 })).toBe(null);
});

test('the Pen hits segments of any copy after points and anchors, but not the path in progress', () => {
  const { d, path, b } = scene();
  const pen = ctxFor(d, { tool: 'pen' });
  expect(hitTest(d, pen, { x: 60, y: 27 })).toMatchObject({ kind: 'segment', pathId: path.id, j: 0, copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 } });
  expect(hitTest(d, pen, { x: 180, y: 213 })).toMatchObject({ kind: 'segment', pathId: path.id, j: 0, copy: { cell: { c: 0, r: 0 }, bindingId: b.id, power: 1 } });   // the half-turn copy
  expect(hitTest(d, pen, { x: 25, y: 25 })).toMatchObject({ kind: 'point' });                    // points win
  expect(hitTest(d, ctxFor(d, { tool: 'pen', pen: { pathId: path.id } }), { x: 60, y: 27 })).toBe(null);
});

test('a via node of the selected path is hit as a point carrying its via', () => {
  const { d, path, b } = scene();
  const via = { cell: { c: 0, r: 0 }, bindingId: b.id, power: 1 };
  const tail = P.startPath(d, { pointId: path.start.pointId, cell: path.start.cell, via }, { color: '#000', weight: 2 }, 'L1');
  P.appendNode(d, tail.id, P.addPoint(d, { u: 0.95, v: 0.4 })); P.appendNode(d, tail.id, P.addPoint(d, { u: 0.4, v: 0.95 }));   // a bend, so the via node (216,216) is inside the box, clear of its handles
  const w = P.nodeWorld(d, tail.start);
  const t = hitTest(d, ctxFor(d, { selection: { kind: 'path', id: tail.id, copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 } } }), { x: w.x + 2, y: w.y + 1 });
  expect(t).toMatchObject({ kind: 'point', pointId: path.start.pointId, via });
});

test('S2/S6: a selected instance\'s nodes are hit there and only there, before its box handles', () => {
  const d = makeDoc();
  const n0 = P.addPoint(d, { u: 0.2, v: 0.2 });
  const p = P.startPath(d, n0, { color: '#000', weight: 2 }, 'L1');
  P.appendNode(d, p.id, P.addPoint(d, { u: 0.6, v: 0.2 }));                         // (48,48)-(144,48): a flat box whose corners are the nodes
  const sel = { kind: 'path' as const, id: p.id, copy: { cell: { c: 1, r: 0 }, bindingId: null, power: 0 } };
  const ctx = ctxFor(d, { selection: sel });
  expect(hitTest(d, ctx, { x: 288, y: 48 })).toEqual({ kind: 'point', pointId: n0.pointId, cell: { c: 1, r: 0 } });   // the node beats the coincident box corner
  expect(hitTest(d, ctx, { x: 48, y: 48 })?.kind).not.toBe('point');                                                    // the same node in the base cell is not shown
});

test('the clone image of a via node is neither an anchor nor a canchor hit; the plain nodes of the same clone still are', () => {
  const { d, path, b } = scene();
  const tail = P.startPath(d, { pointId: path.start.pointId, cell: path.start.cell, via: { cell: { c: 0, r: 0 }, bindingId: b.id, power: 1 } }, { color: '#000', weight: 2 }, 'L1');   // starts at (216,216)
  const end = P.addPoint(d, { u: 0.9, v: 0.5 });                                                         // (216,120)
  P.appendNode(d, tail.id, end);
  const m = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });                          // x = 120
  const tb = P.addBinding(d, tail.id, [[m.id]]);                                                         // tail clone: (24,216) → (24,120)
  const tailAnchors = anchorsWorld(d).filter((a) => a.bindingId === tb.id);
  expect(tailAnchors.some((a) => a.pointId === path.start.pointId)).toBe(false);
  const endImage = tailAnchors.find((a) => a.pointId === end.pointId && a.via!.cell.c === 0 && a.via!.cell.r === 0)!;
  expect(endImage.x).toBeCloseTo(24, 9); expect(endImage.y).toBeCloseTo(120, 9);
  const pen = ctxFor(d, { tool: 'pen' });
  expect(hitTest(d, pen, { x: 24, y: 216 })?.kind).not.toBe('canchor');
  expect(hitTest(d, pen, { x: 24, y: 120 })).toMatchObject({ kind: 'canchor', pathId: tail.id, pointId: end.pointId, copy: { bindingId: tb.id, power: 1 } });
});

test('H8: pathsNear finds paths with an instance within radius, straight line', () => {
  const d = makeDoc();
  const a = P.addPoint(d, { u: 0, v: 0 }), b = P.addPoint(d, { u: 1, v: 0 });   // (0,0)-(240,0)
  const path = P.startPath(d, a, { color: '#000', weight: 2 }, 'L1');
  P.appendNode(d, path.id, b);
  const lines = buildTargets(d).lines;
  expect(pathsNear(lines, { x: 100, y: 30 }, 48)).toEqual(new Set([path.id]));     // 30 px away: included
  expect(pathsNear(lines, { x: 100, y: 100 }, 48)).toEqual(new Set());            // 100 px away: excluded
});

test('H8: pathsNear includes a path when only one of its clone instances is near', () => {
  const { d, path } = scene();   // original segment (24,24)-(96,24); its 180°-about-(120,120) clone is (216,216)-(144,216)
  const lines = buildTargets(d).lines;
  expect(pathsNear(lines, { x: 180, y: 300 }, 48)).toEqual(new Set());                 // far from both the original and the clone
  expect(pathsNear(lines, { x: 180, y: 246 }, 48)).toEqual(new Set([path.id]));        // 30 px from the clone, far from the original
});

test('H8: pathsNear ignores non-path lines (tile edges, axes)', () => {
  const d = makeDoc();
  P.addElement(d, { kind: 'mirror', u: 0.5, v: 0, du: 0, dv: 1 });   // an axis with no source path, line x = 120
  const lines = buildTargets(d).lines;
  expect(lines.some((l) => !l.source)).toBe(true);           // sanity: non-path lines are present in the set
  expect(pathsNear(lines, { x: 120, y: 100 }, 48)).toEqual(new Set());   // near the axis, but no path to report
});
