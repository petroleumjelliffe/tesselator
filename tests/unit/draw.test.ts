import { test, expect } from 'vitest';
import { doc, emptyDoc } from '../../src/state/doc';
import * as UI from '../../src/state/ui';
import * as A from '../../src/actions';
import * as P from '../../src/engine/paths';
import { reset } from '../../src/state/history';
import { traceStep } from '../../src/interaction/tools/freehand';
import type { Doc, Drag, XY, UV, SnapResult } from '../../src/types';
const GRID = { targetsOn: true, gridOn: true, hitScale: 1 }, NOGRID = { targetsOn: true, gridOn: false, hitScale: 1 };

function fresh(build: (d: Doc) => void = () => {}) { reset(); UI.resetUi(); const d = emptyDoc(); build(d); doc.value = d; UI.view.value = { pan: { x: 0, y: 0 }, zoom: 1 }; UI.prefs.value = { ...UI.prefs.value, grid: true }; UI.tool.value = 'freehand'; }
function line(d: Doc, pts: UV[], layerId = d.layers[0].id) {
  const p = P.startPath(d, P.addPoint(d, pts[0]), { color: '#000', weight: 2 }, layerId);
  for (const uv of pts.slice(1)) P.appendNode(d, p.id, P.addPoint(d, uv));
  return p;
}
const stroke = (from: XY, to: XY, n = 12): XY[] => Array.from({ length: n + 1 }, (_, i) => ({ x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n }));
// Mirrors the Freehand tool: the start snaps on press, the end on release.
function draw(raw: XY[]): boolean {
  const s0 = A.drawSnap(raw[0], GRID, null);
  const start = s0 ? s0.at : raw[0];
  const dr = { kind: 'free', raw: [start, ...raw.slice(1)], startNode: null, startSnap: s0, groups: [doc.value.newPathGroups], cloneMatrices: [], end: null, pin: null, cooldown: null,
    target: null, start, moved: true, pointerId: 1, hitScale: 1 } as unknown as Extract<Drag, { kind: 'free' }>;
  const end = A.drawSnap(raw[raw.length - 1], GRID, { pts: dr.raw, groups: dr.groups });
  return A.finishFreehand(dr, end);
}
const newest = () => doc.value.paths[doc.value.paths.length - 1];

test('a stroke ending on another path\'s line splits it and shares the node', () => {
  let hostId = '';
  fresh((d) => { hostId = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]).id; });
  draw(stroke({ x: 120, y: 30 }, { x: 121, y: 117 }));
  const host = P.getPath(doc.value, hostId)!;
  expect(host.segments).toHaveLength(2);
  const p = newest(), last = P.pathNodes(p).at(-1)!;
  expect(last.pointId).toBe(host.segments[0].to.pointId);
});

test('a stroke starting on a line on another layer does not split it (location only)', () => {
  let hostId = '';
  fresh((d) => { d.layers.push({ id: 'L2', name: 'Layer 2' }); hostId = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }], 'L2').id; });
  UI.activeLayerId.value = doc.value.layers[0].id;
  draw(stroke({ x: 120, y: 118 }, { x: 140, y: 40 }));
  expect(P.getPath(doc.value, hostId)!.segments).toHaveLength(1);
  expect(P.nodeWorld(doc.value, newest().start).y).toBeCloseTo(120, 6);
});

test('a stroke ending on its own start closes the shape', () => {
  fresh();
  draw([...stroke({ x: 30, y: 30 }, { x: 150, y: 30 }), ...stroke({ x: 150, y: 30 }, { x: 150, y: 150 }).slice(1), ...stroke({ x: 150, y: 150 }, { x: 32, y: 33 }).slice(1)]);   // starts on a grid point (the start snaps to the grid)
  expect(P.isClosed(newest())).toBe(true);
});

test('a stroke ending on its own repeated start wraps into the next tile', () => {
  fresh();
  draw(stroke({ x: 0, y: 100 }, { x: 238, y: 101 }));            // the start (0, 100) snaps to the tile edge; its repeat is (240, 100)
  const p = newest(), first = p.start, last = P.pathNodes(p).at(-1)!;
  expect(last.pointId).toBe(first.pointId);
  expect(last.cell).toEqual({ c: first.cell.c + 1, r: first.cell.r });
});

test('a stroke ending on its own line splits itself: a loop with a tail', () => {
  fresh();
  draw([...stroke({ x: 30, y: 60 }, { x: 180, y: 60 }), ...stroke({ x: 180, y: 60 }, { x: 180, y: 150 }).slice(1), ...stroke({ x: 180, y: 150 }, { x: 101, y: 63 }).slice(1)]);
  const nodes = P.pathNodes(newest()), last = nodes.at(-1)!;
  expect(nodes.slice(1, -1).some((n) => n.pointId === last.pointId)).toBe(true);
});

test('Pen: a click near a mirror axis lands on it; with snapping off a click near a point reuses it', () => {
  fresh();
  A.addElement('mirror'); A.setTool('pen'); A.clearSel();     // addElement selects the element; a Pen click would only clear that
  A.penClickEmpty({ x: 116, y: 60 }, GRID);
  expect(P.nodeWorld(doc.value, newest().start).x).toBeCloseTo(120, 6);
  A.endPen();
  A.penClickEmpty({ x: 30, y: 30 }, NOGRID); A.penClickEmpty({ x: 90, y: 30 }, NOGRID); A.endPen();
  const pts = doc.value.points.length;
  A.penClickEmpty({ x: 32, y: 31 }, NOGRID);
  expect(doc.value.points.length).toBe(pts);
});

test('tracing: with Alt held the stroke follows a nearby line, lets go past the breakaway, and does not re-pin until far', () => {
  fresh((d) => { line(d, [{ u: 0.1, v: 0.5 }, { u: 0.9, v: 0.5 }]); });
  const dr = { kind: 'free', raw: [{ x: 30, y: 125 }], pin: null, cooldown: null } as unknown as Extract<Drag, { kind: 'free' }>;
  expect(traceStep(dr, { x: 60, y: 126 }, true, 12, 24).y).toBeCloseTo(120, 6);     // pinned to y = 120
  expect(traceStep(dr, { x: 90, y: 140 }, true, 12, 24).y).toBeCloseTo(120, 6);     // 20 away: still pinned
  expect(traceStep(dr, { x: 100, y: 150 }, true, 12, 24).y).toBeCloseTo(150, 6);    // 30 away: let go
  expect(traceStep(dr, { x: 110, y: 128 }, true, 12, 24).y).toBeCloseTo(128, 6);    // within 2× breakaway of the same line: no re-pin
  expect(traceStep(dr, { x: 120, y: 125 }, false, 12, 24).y).toBeCloseTo(125, 6);   // Alt released: free
});
