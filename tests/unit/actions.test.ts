import { test, expect } from 'vitest';
import { doc, draft, emptyDoc } from '../../src/state/doc';
import * as UI from '../../src/state/ui';
import * as A from '../../src/actions';
import * as P from '../../src/engine/paths';
import { reset, canUndo, commit, beginGesture, endGesture, historyVersion } from '../../src/state/history';
import { parseDoc, serializeDoc } from '../../src/engine/serialize';
import { faces, copyMatrix } from '../../src/state/derived';
import { apply, invert } from '../../src/engine/transform';
import { CONFIG } from '../../src/config';
import * as select from '../../src/interaction/tools/select';
import type { Drag } from '../../src/types';
import { computeFaces } from '../../src/engine/regions';
import { anchorsWorld } from '../../src/engine/hit';

function fresh() { reset(); UI.resetUi(); doc.value = emptyDoc(); UI.viewport.value = { width: 800, height: 600 }; UI.prefs.value = { ...UI.prefs.value, snap: false }; }
const W = (u: number, v: number) => ({ x: u * 240, y: v * 240 });

test('pen: empty clicks build a path, clicking the last node ends it, short paths are discarded', () => {
  fresh();
  A.penClickEmpty(W(0.1, 0.1), false); expect(UI.pen.value).toBeTruthy();
  A.penClickEmpty(W(0.4, 0.1), false);
  const path = doc.value.paths[0];
  expect(path.segments).toHaveLength(1);
  A.penClickNode(path.segments[0].to);
  expect(UI.pen.value).toBe(null);
  A.penClickEmpty(W(0.8, 0.8), false); A.endPen();
  expect(doc.value.paths).toHaveLength(1);
  expect(doc.value.points).toHaveLength(2);
});

test('pen: new paths receive newPathGroups; clicking an open end resumes and reverses', () => {
  fresh();
  A.addElement('rotate'); expect(UI.layer.value).toBe('construction');
  A.setTool('pen'); expect(UI.layer.value).toBe('drawing');
  A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.4, 0.1), false); A.endPen();
  expect(doc.value.bindings).toHaveLength(1);
  const path = doc.value.paths[0], first = path.start.pointId;
  A.penClickNode(path.start);
  expect(UI.pen.value?.pathId).toBe(path.id);
  expect(doc.value.paths[0].segments[0].to.pointId).toBe(first);
});

test('addElement binds the selected path; deleteElement drops bindings and chains', () => {
  fresh();
  A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.4, 0.1), false); A.endPen();
  A.selectPathAt(doc.value.paths[0].id);
  A.addElement('mirror');
  const el = doc.value.elements[0];
  expect(doc.value.bindings[0].groups).toEqual([[el.id]]);
  A.deleteElement(el.id);
  expect(doc.value.bindings).toHaveLength(0); expect(doc.value.newPathGroups).toHaveLength(0); expect(UI.selection.value).toBe(null);
});

test('fillAt seeds at the centroid, recolours on a second click, and maps neighbour cells to the same region', () => {
  fresh();
  for (const p of [W(0.25, 0.25), W(0.75, 0.25), W(0.75, 0.75), W(0.25, 0.75)]) A.penClickEmpty(p, false);
  A.penClickNode(doc.value.paths[0].start); A.endPen();
  A.setTool('fill');
  expect(faces.value).toHaveLength(9);
  expect(A.fillAt(W(0.05, 0.05))).toBe(false);
  expect(A.fillAt(W(0.3, 0.3))).toBe(true);
  expect(doc.value.fills[0].u).toBeCloseTo(0.5, 6); expect(doc.value.fills[0].v).toBeCloseTo(0.5, 6);
  UI.prefs.value = { ...UI.prefs.value, fillColor: '#123456' };
  A.fillAt(W(0.6, 0.6));
  expect(doc.value.fills).toHaveLength(1); expect(doc.value.fills[0].color).toBe('#123456');
  expect(A.fillAt(W(1.5, 0.5))).toBe(true); expect(doc.value.fills).toHaveLength(1);
});

test('editing through a copy in cell (1,0) and through a clone moves the source', () => {
  fresh();
  A.addElement('rotate'); A.setTool('pen');
  A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.4, 0.1), false); A.endPen();
  const path = doc.value.paths[0], pid = path.start.pointId, b = doc.value.bindings[0];
  // a drag of the point through its copy in cell (1,0): pointer at world (1.2, 0.2) → point becomes (0.2, 0.2)
  A.mutate((d) => { const uv = A.uvOf(W(1.2, 0.2)); P.movePoint(d, pid, uv.u - 1, uv.v - 0); });
  expect(P.getPoint(doc.value, pid)!.u).toBeCloseTo(0.2, 9); expect(P.getPoint(doc.value, pid)!.v).toBeCloseTo(0.2, 9);
  // through the clone: pointer at the clone's image of (0.3, 0.3) → source becomes (0.3, 0.3)
  const M = copyMatrix({ cell: { c: 0, r: 0 }, bindingId: b.id, power: 1 });
  const src = apply(invert(M), apply(M, W(0.3, 0.3)));
  A.mutate((d) => { const uv = A.uvOf(src); P.movePoint(d, pid, uv.u, uv.v); });
  expect(P.getPoint(doc.value, pid)!.u).toBeCloseTo(0.3, 9);
});

test('insertNodeOnSegment through a clone copy maps the click back to the source segment', () => {
  fresh();
  A.addElement('rotate'); A.setTool('pen');
  A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.5, 0.1), false); A.endPen();
  const path = doc.value.paths[0], b = doc.value.bindings[0];
  const copy = { cell: { c: 0, r: 0 }, bindingId: b.id, power: 1 };
  const clickOnClone = apply(copyMatrix(copy), W(0.3, 0.1));
  expect(A.insertNodeOnSegment(path.id, 0, clickOnClone, copy, false)).toBe(true);
  const mid = P.nodeUVAbs(doc.value, doc.value.paths[0].segments[0].to);
  expect(mid.u).toBeCloseTo(0.3, 6); expect(mid.v).toBeCloseTo(0.1, 6);
});

test('finishFreehand creates a bound path and rejects a jitter', () => {
  fresh();
  A.addElement('rotate'); A.setTool('freehand');
  const base = { target: null, start: { x: 0, y: 0 }, moved: true, pointerId: 1, hitScale: 1, kind: 'free' as const, startNode: null, cloneMatrices: [] };
  expect(A.finishFreehand({ ...base, raw: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })).toBe(false);
  const raw = Array.from({ length: 30 }, (_, i) => ({ x: 20 + i * 5, y: 40 + 30 * Math.sin(i / 5) }));
  expect(A.finishFreehand({ ...base, raw })).toBe(true);
  expect(doc.value.paths).toHaveLength(1); expect(doc.value.bindings).toHaveLength(1);
  expect(doc.value.paths[0].segments.length).toBeGreaterThan(0);
});

test('finishFreehand starting on a via node keeps the via on the new path\'s start instead of resuming the via-ended path', () => {
  fresh(); A.addElement('rotate'); A.setTool('pen');
  A.penClickEmpty(W(0.1, 0.5), false); A.penClickEmpty(W(0.4, 0.5), false); A.endPen();
  const body = doc.value.paths[0], b = doc.value.bindings[0];
  const clone = { cell: { c: 0, r: 0 }, bindingId: b.id, power: 1 };
  A.setTool('pen');
  A.penClickSegment(body.id, 0, clone, W(0.8, 0.52), false);                          // splits the source, tail starts on a via node
  A.penClickEmpty(W(0.8, 0.9), false); A.endPen();
  const tailStart = doc.value.paths[1].start;
  expect(tailStart.via).toEqual(clone);
  A.setTool('freehand');
  const startNode = { pointId: tailStart.pointId, cell: tailStart.cell, via: tailStart.via };
  const start = P.nodeWorld(doc.value, startNode);
  const raw = Array.from({ length: 30 }, (_, i) => ({ x: start.x + i * 5, y: start.y + 30 * Math.sin(i / 5) }));
  const dr: Extract<Drag, { kind: 'free' }> = { kind: 'free', raw, startNode, cloneMatrices: [], target: null, start, moved: true, pointerId: 1, hitScale: 1 };
  const pathsBefore = doc.value.paths.length;
  expect(A.finishFreehand(dr)).toBe(true);
  expect(doc.value.paths).toHaveLength(pathsBefore + 1);                              // a new path, not an extension of the via-ended tail
  expect(doc.value.paths[doc.value.paths.length - 1].start).toEqual(startNode);
});

test('zoomAt keeps the point under the cursor fixed and never enters history', () => {
  fresh();
  UI.view.value = { pan: { x: 100, y: 50 }, zoom: 1 };
  A.zoomAt({ x: 300, y: 200 }, 2);
  expect(UI.view.value.zoom).toBe(2); expect(UI.view.value.pan.x).toBe(300 - (300 - 100) * 2);
  A.zoomAt({ x: 0, y: 0 }, 1000); expect(UI.view.value.zoom).toBe(CONFIG.ZOOM_MAX);
  expect(canUndo()).toBe(false);
});

test('a gesture of many mutate() calls is one undo step', () => {
  fresh();
  A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.4, 0.1), false); A.endPen();
  const pid = doc.value.paths[0].start.pointId;
  beginGesture();
  for (let i = 1; i <= 5; i++) A.mutate((d) => { P.movePoint(d, pid, 0.1 + i * 0.01, 0.1); });
  endGesture();
  expect(P.getPoint(doc.value, pid)!.u).toBeCloseTo(0.15, 9);
  A.undo();
  expect(P.getPoint(doc.value, pid)!.u).toBeCloseTo(0.1, 9);
});

test('straightenPath clears every curved segment on a path, and is a no-op once straight', () => {
  fresh();
  A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.4, 0.1), false); A.penClickEmpty(W(0.4, 0.4), false); A.endPen();
  const path = doc.value.paths[0];
  A.mutate((d) => { const p = P.getPath(d, path.id)!; p.segments[0].cp = { u: 0.25, v: 0.05 }; p.segments[1].cp = { u: 0.45, v: 0.25 }; });
  expect(doc.value.paths[0].segments.some((s) => s.cp)).toBe(true);
  A.selectPathAt(path.id);
  expect(A.straightenPath(path.id)).toBe(true);
  expect(doc.value.paths[0].segments.every((s) => s.cp === null)).toBe(true);
  expect(A.straightenPath(path.id)).toBe(false);
});

test('undo right after the first pen click removes the one-node path and its point', () => {
  fresh();
  A.penClickEmpty(W(0.1, 0.1), false);
  expect(doc.value.paths).toHaveLength(1); expect(UI.pen.value).toBeTruthy();
  expect(A.undo()).toBe(true);
  expect(doc.value.paths).toHaveLength(0);
  expect(doc.value.points).toHaveLength(0);
  expect(UI.pen.value).toBe(null);
});

test('undo after two pen clicks resumes drawing the one-node path instead of leaving it stranded', () => {
  fresh();
  A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.4, 0.1), false);
  A.undo();
  const path = doc.value.paths[0];
  expect(path.segments).toHaveLength(0);
  expect(UI.pen.value).toEqual({ pathId: path.id });
  expect(() => A.penClickNode(path.start)).not.toThrow();   // repeat of the last node ends the pen, which deletes the empty path
  expect(doc.value.paths).toHaveLength(0); expect(UI.pen.value).toBe(null);
  A.redo(); expect(doc.value.paths).toHaveLength(0);         // endPen's delete cleared the redo stack
});

test('undo that restores a pen path in progress also restores the Pen tool and Drawing layer', () => {
  fresh();
  A.penClickEmpty(W(0.1, 0.1), false);
  A.setTool('select');                                       // endPen commits the delete of the one-node path
  expect(doc.value.paths).toHaveLength(0);
  A.setLayer('construction');
  expect(A.undo()).toBe(true);
  expect(doc.value.paths).toHaveLength(1);
  expect(UI.tool.value).toBe('pen');
  expect(UI.layer.value).toBe('drawing');
  expect(UI.pen.value).toEqual({ pathId: doc.value.paths[0].id });
});

test('a region straddling the cell edge is one fill from either side, seeded inside the base cell', () => {
  fresh();
  for (const p of [W(0.75, 0.25), W(1.25, 0.25), W(1.25, 0.75), W(0.75, 0.75)]) A.penClickEmpty(p, false);
  A.penClickNode(doc.value.paths[0].start); A.endPen();
  A.setTool('fill');
  expect(A.fillAt({ x: 250, y: 120 })).toBe(true);
  UI.prefs.value = { ...UI.prefs.value, fillColor: '#123456' };
  expect(A.fillAt({ x: 200, y: 120 })).toBe(true);
  expect(doc.value.fills).toHaveLength(1);
  expect(doc.value.fills[0].color).toBe('#123456');
  const { u, v } = doc.value.fills[0];
  expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThan(1); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1);
  expect(UI.selection.value).toEqual({ kind: 'fill', id: doc.value.fills[0].id });
  A.deleteSelection();
  expect(doc.value.fills).toHaveLength(0);
});

test('a new path gets one binding holding every new-path group; O on a selected path stacks a group on its binding', () => {
  fresh();
  A.addElement('rotate'); A.addElement('mirror');
  expect(doc.value.newPathGroups).toHaveLength(2);
  A.setTool('pen'); A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.4, 0.1), false); A.endPen();
  expect(doc.value.bindings).toHaveLength(1);
  expect(doc.value.bindings[0].groups).toEqual(doc.value.newPathGroups);
  const path = doc.value.paths[0];
  A.setTool('select'); A.selectPathAt(path.id);
  A.addElement('translate');
  expect(doc.value.bindings).toHaveLength(1);
  expect(doc.value.bindings[0].groups).toHaveLength(3);
  expect(doc.value.bindings[0].groups[2]).toEqual([doc.value.elements[2].id]);
  expect(doc.value.newPathGroups).toHaveLength(3);
});

test('a stale activeLayerId falls back to the top layer; addLayer makes the new layer active; fills and paths land there', () => {
  fresh();
  UI.activeLayerId.value = 'gone';
  expect(A.activeLayerId()).toBe(doc.value.layers[0].id);
  A.addLayer();
  const top = doc.value.layers[1].id;
  expect(UI.activeLayerId.value).toBe(top);
  A.setTool('pen'); A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.4, 0.1), false); A.endPen();
  expect(doc.value.paths[0].layerId).toBe(top);
  A.setPathLayer(doc.value.paths[0].id, doc.value.layers[0].id);
  expect(doc.value.paths[0].layerId).toBe(doc.value.layers[0].id);
  expect(A.setPathLayer(doc.value.paths[0].id, 'nope')).toBe(false);
});

test('group editing actions move an element between groups and clear the pending group', () => {
  fresh();
  A.addElement('mirror'); A.addElement('rotate');
  A.setTool('pen'); A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.4, 0.1), false); A.endPen();
  const b = doc.value.bindings[0], [m, r] = doc.value.elements.map((e) => e.id);
  expect(b.groups).toEqual([[m], [r]]);
  A.startGroup(b.id); expect(UI.pendingGroup.value).toEqual({ bindingId: b.id });
  const hv = historyVersion.value;
  expect(A.placeElementInGroup(b.id, m, 0)).toBe(false);   // already there: no commit, pending group kept
  expect(historyVersion.value).toBe(hv);
  expect(UI.pendingGroup.value).toEqual({ bindingId: b.id });
  A.placeElementInGroup(b.id, r, 0);
  expect(doc.value.bindings[0].groups).toEqual([[m, r]]);
  expect(UI.pendingGroup.value).toBe(null);
  A.removeElementFromBinding(b.id, m); A.removeElementFromBinding(b.id, r);
  expect(doc.value.bindings).toHaveLength(0);
  A.setTool('select'); A.selectPathAt(doc.value.paths[0].id); A.startChain(doc.value.paths[0].id);
  A.addElementToNewChain(doc.value.paths[0].id, m);
  expect(doc.value.bindings[0].groups).toEqual([[m]]);
  expect(UI.pendingGroup.value).toBe(null);
  // A selected clone whose power slot disappears when a removeElementFromBinding drops the binding's clone count
  // (here 3 clones down to 1, so power 2's slot no longer exists) falls back to the base copy.
  const nb = doc.value.bindings[0];
  A.startGroup(nb.id); A.placeElementInGroup(nb.id, r, nb.groups.length);
  UI.selection.value = { kind: 'path', id: doc.value.paths[0].id, copy: { cell: { c: 0, r: 0 }, bindingId: nb.id, power: 2 } };
  A.removeElementFromBinding(nb.id, r);
  expect((UI.selection.value as { kind: 'path'; copy: { bindingId: string | null } }).copy.bindingId).toBe(null);
  // Removing the binding a pending group names clears that pending group.
  A.startGroup(nb.id); expect(UI.pendingGroup.value).toEqual({ bindingId: nb.id });
  expect(A.removeBinding(nb.id)).toBe(true);
  expect(doc.value.bindings).toHaveLength(0);
  expect(UI.pendingGroup.value).toBe(null);
});

test('"Apply to new paths" is lit and toggled per element, keeping newPathGroups free of repeats so a new path\'s binding always reloads', () => {
  fresh();
  A.addElement('mirror'); A.addElement('translate');
  const [m, t] = doc.value.elements.map((e) => e.id);
  A.setNewPathGroups([[m, t]]);                          // ★ on a binding whose one group chains both
  expect(doc.value.newPathGroups).toEqual([[m, t]]);
  expect(A.isNewPathElement(m)).toBe(true); expect(A.isNewPathElement(t)).toBe(true);   // lit wherever it appears (as the canvas marks it)
  A.toggleNewPathElement(m);                             // "Apply to new paths" on a lit m: m leaves the chain
  expect(doc.value.newPathGroups).toEqual([[t]]);
  expect(A.isNewPathElement(m)).toBe(false);
  A.toggleNewPathElement(m);                             // and on an unlit m: m joins as its own group
  expect(doc.value.newPathGroups).toEqual([[t], [m]]);
  A.setTool('pen'); A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.4, 0.1), false); A.endPen();
  const ids = doc.value.bindings[0].groups.flat();
  expect(new Set(ids).size).toBe(ids.length);
  expect(parseDoc(serializeDoc(doc.value))).toEqual(doc.value);
  A.toggleNewPathElement(m);
  expect(doc.value.newPathGroups).toEqual([[t]]);
});

// --- pen joins (spec 2026-09-29 §3–§4)

const base = { cell: { c: 0, r: 0 }, bindingId: null, power: 0 };

test('pen: clicking a source segment inserts a shared node and starts a path from it; the outline is unchanged', () => {
  fresh(); A.setTool('pen');
  A.penClickEmpty(W(0.1, 0.5), false); A.penClickEmpty(W(0.9, 0.5), false); A.endPen();
  const body = doc.value.paths[0];
  A.setTool('pen');
  expect(A.penClickSegment(body.id, 0, base, W(0.3, 0.52), false)).toBe(true);
  const b2 = doc.value.paths[0];
  expect(b2.segments).toHaveLength(2);
  expect(P.nodeUVAbs(doc.value, b2.segments[0].to)).toEqual({ u: expect.closeTo(0.3, 6), v: expect.closeTo(0.5, 6) });
  const tail = doc.value.paths[1];
  expect(UI.pen.value?.pathId).toBe(tail.id);
  expect(tail.start).toEqual(b2.segments[0].to);                                   // shared node
  A.penClickEmpty(W(0.3, 0.9), false); A.endPen();
  expect(doc.value.points).toHaveLength(4);
});

test('pen: clicking a segment of the path in progress adds a free point instead of splitting it', () => {
  fresh(); A.setTool('pen');
  A.penClickEmpty(W(0.1, 0.5), false); A.penClickEmpty(W(0.9, 0.5), false);
  const p = doc.value.paths[0];
  A.penClickSegment(p.id, 0, base, W(0.5, 0.52), false);
  expect(doc.value.paths).toHaveLength(1);
  expect(doc.value.paths[0].segments).toHaveLength(2);                              // appended, not split
  expect(doc.value.paths[0].segments[1].to.via).toBeUndefined();
});

test('pen: clicking a clone segment splits the source and starts a via node at the clicked spot; releasing a dragged point on a point merges them', () => {
  fresh();
  A.addElement('rotate');                                                            // half-turn about the centre, applied to new paths
  A.setTool('pen');
  A.penClickEmpty(W(0.1, 0.5), false); A.penClickEmpty(W(0.4, 0.5), false); A.endPen();
  const body = doc.value.paths[0], b = doc.value.bindings[0];
  const clone = { cell: { c: 0, r: 0 }, bindingId: b.id, power: 1 };
  A.setTool('pen');
  A.penClickSegment(body.id, 0, clone, W(0.8, 0.52), false);                         // the clone runs (0.9,0.5)→(0.6,0.5)
  const tail = doc.value.paths[1];
  expect(doc.value.paths[0].segments).toHaveLength(2);                              // source split
  expect(tail.start.via).toEqual(clone);
  const w = P.nodeWorld(doc.value, tail.start);
  expect(w.x).toBeCloseTo(0.8 * 240, 4); expect(w.y).toBeCloseTo(0.5 * 240, 4);
  A.penClickEmpty(W(0.8, 0.9), false); A.endPen();
  // merge: drag the tail's free end onto the body's start (re-read the tail: each commit is a fresh draft)
  const end = doc.value.paths[1].segments[0].to, target = body.start;
  expect(A.mergeDroppedPoint(end.pointId, end.cell, target.pointId, target.cell)).toBe(true);
  expect(doc.value.points.some((p) => p.id === end.pointId)).toBe(false);
  expect(doc.value.paths[1].segments[0].to).toEqual({ pointId: target.pointId, cell: target.cell });
  expect(parseDoc(serializeDoc(doc.value))).toEqual(doc.value);
});

test('removing the binding a via node depends on materialises the node where it was', () => {
  fresh(); A.addElement('mirror'); A.setTool('pen');
  A.penClickEmpty(W(0.1, 0.3), false); A.penClickEmpty(W(0.4, 0.3), false); A.endPen();
  const body = doc.value.paths[0], b = doc.value.bindings[0];
  A.setTool('pen');
  A.penClickSegment(body.id, 0, { cell: { c: 0, r: 0 }, bindingId: b.id, power: 1 }, W(0.7, 0.31), false);
  A.penClickEmpty(W(0.7, 0.8), false); A.endPen();
  const before = P.nodeWorld(doc.value, doc.value.paths[1].start);
  A.removeBinding(b.id);
  const after = doc.value.paths[1].start;
  expect(after.via).toBeUndefined();
  expect(P.nodeWorld(doc.value, after).x).toBeCloseTo(before.x, 6); expect(P.nodeWorld(doc.value, after).y).toBeCloseTo(before.y, 6);
});

// --- tools: the point drag with a via node, and merge on release

test('dragging a via node follows the pointer each move (it never snaps to its own image); releasing a raw point on another point merges them', () => {
  fresh(); A.addElement('rotate'); A.setTool('pen');
  A.penClickEmpty(W(0.1, 0.5), false); A.penClickEmpty(W(0.4, 0.5), false); A.endPen();
  const body = doc.value.paths[0], b = doc.value.bindings[0];
  A.setTool('pen');
  A.penClickSegment(body.id, 0, { cell: { c: 0, r: 0 }, bindingId: b.id, power: 1 }, W(0.8, 0.52), false);
  A.penClickEmpty(W(0.8, 0.9), false); A.endPen();
  A.setTool('select');
  const ctx = { snapOn: false, hitScale: 1, threshold: 12 }, ev = {} as PointerEvent;
  const n = doc.value.paths[1].start, w0 = P.nodeWorld(doc.value, n);
  const d: Drag = { kind: 'pt', pointId: n.pointId, cell: n.cell, via: n.via, snapTo: null, target: null, start: w0, moved: true, pointerId: 1, hitScale: 1 };
  for (let i = 1; i <= 4; i++) {
    select.onMove(d, { x: w0.x + 3 * i, y: w0.y + 2 * i }, ev, ctx);
    const w = P.nodeWorld(doc.value, doc.value.paths[1].start);
    expect(w.x).toBeCloseTo(w0.x + 3 * i, 6); expect(w.y).toBeCloseTo(w0.y + 2 * i, 6);
  }
  expect(d.snapTo).toBe(null);                                                                   // a via node never merges
  expect(doc.value.paths[1].start.via).toEqual(n.via);
  // the tail's free end dragged onto the body's start: snapTo is set on the move, the release merges
  const end = doc.value.paths[1].segments[0].to, target = P.nodeWorld(doc.value, body.start);
  const dp: Drag = { kind: 'pt', pointId: end.pointId, cell: end.cell, snapTo: null, target: null, start: P.nodeWorld(doc.value, end), moved: true, pointerId: 1, hitScale: 1 };
  select.onMove(dp, { x: target.x + 4, y: target.y - 3 }, ev, ctx);
  expect(dp.snapTo).toEqual({ pointId: body.start.pointId, cell: body.start.cell });
  select.onUp(dp, { x: target.x + 4, y: target.y - 3 }, ev, ctx);
  expect(doc.value.points.some((p) => p.id === end.pointId)).toBe(false);
  expect(doc.value.paths[1].segments[0].to).toEqual({ pointId: body.start.pointId, cell: body.start.cell });
});

test('a merge on release is part of the drag gesture: one undo restores the document from before the drag', () => {
  fresh(); A.setTool('pen');
  A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.4, 0.1), false); A.endPen();
  A.penClickEmpty(W(0.6, 0.6), false); A.penClickEmpty(W(0.9, 0.6), false); A.endPen();
  const start = doc.value, a = doc.value.paths[0], b = doc.value.paths[1];
  const from = b.start, to = a.segments[0].to;
  beginGesture();                                                                                // as pointer.ts does once the drag has moved
  A.mutate((d) => { P.movePoint(d, from.pointId, 0.45, 0.12); });
  A.mutate((d) => { P.movePoint(d, from.pointId, 0.41, 0.1); });
  expect(A.mergeDroppedPoint(from.pointId, from.cell, to.pointId, to.cell)).toBe(true);
  endGesture();
  expect(doc.value.paths[1].start).toEqual(to);
  A.undo();
  expect(doc.value).toBe(start);                                                                 // not just the merge: the moves went with it
  A.redo();
  expect(doc.value.paths[1].start).toEqual(to);
});

// --- fix round 1

// Body (0.1,0.5)→(0.4,0.5) under a half-turn about the centre; its clone runs (216,120)→(144,120).
function bodyWithHalfTurn() {
  fresh(); A.addElement('rotate'); A.setTool('pen');
  A.penClickEmpty(W(0.1, 0.5), false); A.penClickEmpty(W(0.4, 0.5), false); A.endPen();
  const body = doc.value.paths[0], b = doc.value.bindings[0];
  return { body, b, clone: { cell: { c: 0, r: 0 }, bindingId: b.id, power: 1 } };
}

test('pen: a plain click on a point does not resume an open path whose end is a via node on that point', () => {
  const { body, clone } = bodyWithHalfTurn();
  A.setTool('pen');
  A.penClickEmpty(W(0.2, 0.8), false);
  A.penClickSegment(body.id, 0, clone, W(0.8, 0.52), false);                          // tail ends on the clone at (192,120); the split point itself is at (48,120)
  A.endPen();
  const tail = doc.value.paths[1], split = doc.value.paths[0].segments[0].to;
  expect(tail.segments[0].to).toEqual({ pointId: split.pointId, cell: split.cell, via: clone });
  expect(P.openEndAt(doc.value, split.pointId)).toBe(null);
  A.penClickNode({ pointId: split.pointId, cell: split.cell });
  expect(doc.value.paths).toHaveLength(3);
  expect(UI.pen.value?.pathId).toBe(doc.value.paths[2].id);
  expect(doc.value.paths[2].start).toEqual({ pointId: split.pointId, cell: split.cell });
  expect(doc.value.paths[1].segments[0].to.via).toEqual(clone);                       // the tail is untouched
});

test('pen: with a path in progress, clicking a clone anchor appends a via node at the anchor', () => {
  const { body, clone } = bodyWithHalfTurn();
  A.setTool('pen');
  A.penClickEmpty(W(0.8, 0.8), false);
  expect(A.penClickNode({ pointId: body.start.pointId, cell: body.start.cell, via: clone })).toBe(true);
  const p = doc.value.paths[1], last = p.segments[p.segments.length - 1].to;
  expect(last).toEqual({ pointId: body.start.pointId, cell: body.start.cell, via: clone });
  const anchor = anchorsWorld(doc.value).find((a) => a.bindingId === clone.bindingId && a.power === 1 && a.pointId === body.start.pointId && a.cell.c === 0 && a.cell.r === 0 && a.via!.cell.c === 0 && a.via!.cell.r === 0)!;
  const w = P.nodeWorld(doc.value, last);
  expect(w.x).toBeCloseTo(anchor.x, 9); expect(w.y).toBeCloseTo(anchor.y, 9);
  expect(w.x).toBeCloseTo(216, 9); expect(w.y).toBeCloseTo(120, 9);
});

test('pen: an empty click within the snap threshold of a clone anchor starts a path on a via node at that anchor', () => {
  const { body, clone } = bodyWithHalfTurn();
  A.setTool('pen');
  expect(A.penClickEmpty({ x: 216 + 5, y: 120 - 3 }, true)).toBe(true);                // no raw point near (221,117); the clone anchor is at (216,120)
  const p = doc.value.paths[1];
  expect(p.start).toEqual({ pointId: body.start.pointId, cell: body.start.cell, via: clone });
  expect(P.nodeWorld(doc.value, p.start)).toEqual({ x: 216, y: 120 });
  expect(doc.value.points).toHaveLength(2);                                            // no point was added
  A.endPen();
});

test('regions: a straight and a curved T-junction drawn with the Pen through penClickSegment each split a square exactly (18 faces)', () => {
  const drawSquare = () => {
    fresh(); A.setTool('pen');
    for (const q of [W(0.25, 0.25), W(0.75, 0.25), W(0.75, 0.75), W(0.25, 0.75)]) A.penClickEmpty(q, false);
    A.penClickNode(doc.value.paths[0].start); A.endPen();                             // closes; segments: 0 top, 1 right, 2 bottom, 3 left
    return doc.value.paths[0];
  };
  const chord = (sq: { id: string }, rightClick: { x: number; y: number }) => {
    A.setTool('pen');
    expect(A.penClickSegment(sq.id, 3, base, W(0.26, 0.5), false)).toBe(true);        // left edge → (60,120)
    expect(A.penClickSegment(sq.id, 1, base, rightClick, false)).toBe(true);          // right edge (still segment 1)
    A.endPen();
  };
  const sq = drawSquare(); chord(sq, W(0.74, 0.5));
  expect(doc.value.paths[0].segments).toHaveLength(6); expect(doc.value.paths[1].segments).toHaveLength(1);
  expect(computeFaces(doc.value)).toHaveLength(18);
  const sq2 = drawSquare();
  A.mutate((d) => { P.setControlPointAbs(d, sq2.id, 1, { u: 220 / 240, v: 0.5 }); });   // right edge bulges to x = 200
  chord(sq2, { x: 195, y: 100 });
  expect(computeFaces(doc.value)).toHaveLength(18);
});
