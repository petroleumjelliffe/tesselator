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
});

test('"Apply to new paths" keeps newPathGroups free of repeats, so a new path\'s binding always reloads', () => {
  fresh();
  A.addElement('mirror'); A.addElement('translate');
  const [m, t] = doc.value.elements.map((e) => e.id);
  A.setNewPathGroups([[m, t]]);                          // ★ on a binding whose one group chains both
  expect(doc.value.newPathGroups).toEqual([[m, t]]);
  A.toggleNewPathGroup([m]);                             // "Apply to new paths" on m: m leaves the chain
  expect(doc.value.newPathGroups).toEqual([[t], [m]]);
  A.setTool('pen'); A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.4, 0.1), false); A.endPen();
  const ids = doc.value.bindings[0].groups.flat();
  expect(new Set(ids).size).toBe(ids.length);
  expect(parseDoc(serializeDoc(doc.value))).toEqual(doc.value);
  A.toggleNewPathGroup([m]);                             // and the exact group toggles off again
  expect(doc.value.newPathGroups).toEqual([[t]]);
});
