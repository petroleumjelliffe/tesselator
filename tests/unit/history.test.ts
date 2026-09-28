import { test, expect } from 'vitest';
import { doc, draft, emptyDoc } from '../../src/state/doc';
import { commit, beginGesture, endGesture, abortGesture, undo, redo, canUndo, canRedo, reset } from '../../src/state/history';
import { selection, resetUi } from '../../src/state/ui';
import { copies, cloneMatrices, visibleCells } from '../../src/state/derived';
import { viewport } from '../../src/state/ui';
import * as P from '../../src/engine/paths';

function fresh() { reset(); resetUi(); doc.value = emptyDoc(); }

test('commit pushes, undo/redo swap references, selection clears', () => {
  fresh();
  const a = doc.value;
  const d = draft(); P.addPoint(d, { u: 0.1, v: 0.1 }); commit(d);
  selection.value = { kind: 'points', ids: [d.points[0].id] };
  expect(canUndo()).toBe(true);
  expect(undo()).toBe(true);
  expect(doc.value).toBe(a);
  expect(selection.value).toBe(null);
  expect(canRedo()).toBe(true);
  expect(redo()).toBe(true);
  expect(doc.value).toBe(d);
  undo(); expect(undo()).toBe(false);
});

test('a new commit clears redo and the stack is capped at 50', () => {
  fresh();
  commit(draft()); undo(); expect(canRedo()).toBe(true);
  commit(draft()); expect(canRedo()).toBe(false);
  fresh();
  for (let i = 0; i < 60; i++) commit(draft());
  let n = 0; while (undo()) n++;
  expect(n).toBe(50);
});

test('a gesture records one entry however many commits it makes; abort restores the base', () => {
  fresh();
  const base = doc.value;
  beginGesture();
  for (let i = 0; i < 5; i++) { const d = draft(); P.addPoint(d, { u: i / 10, v: 0 }); commit(d); }
  endGesture();
  expect(doc.value.points).toHaveLength(5);
  expect(undo()).toBe(true);
  expect(doc.value).toBe(base);
  expect(undo()).toBe(false);
  redo();
  beginGesture();
  const d = draft(); P.addPoint(d, { u: 0.9, v: 0.9 }); commit(d);
  abortGesture();
  expect(doc.value.points).toHaveLength(5);
  expect(canRedo()).toBe(false);
});

test('derived copies list the source and every clone per visible cell', () => {
  fresh();
  viewport.value = { width: 400, height: 400 };
  const d = draft();
  const n = P.addPoint(d, { u: 0.1, v: 0.1 });
  const path = P.startPath(d, n, { color: '#000', weight: 1 });
  P.appendNode(d, path.id, P.addPoint(d, { u: 0.4, v: 0.1 }));
  const el = P.addElement(d, { kind: 'rotate', u: 0.5, v: 0.5, n: 4 });
  P.addBinding(d, path.id, [el.id]);
  commit(d);
  expect(cloneMatrices.value.get(d.bindings[0].id)).toHaveLength(3);
  const perCell = copies.value.filter((c) => c.copy.cell.c === 0 && c.copy.cell.r === 0);
  expect(perCell).toHaveLength(4);
  expect(copies.value.length).toBe(visibleCells.value.length * 4);
});
