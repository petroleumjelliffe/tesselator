import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { restore } from '../../src/state/persist';
import { doc, emptyDoc } from '../../src/state/doc';
import * as UI from '../../src/state/ui';
import { serializeDoc } from '../../src/engine/serialize';
import { exampleDoc } from '../../src/example';
import { CONFIG } from '../../src/config';

// restore() reads localStorage only; a Map-backed stand-in is enough to exercise it without a DOM.
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, String(v)); }, removeItem: (k: string) => { store.delete(k); } };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  UI.resetUi(); doc.value = emptyDoc(); UI.view.value = { pan: { x: 0, y: 0 }, zoom: 1 };
});
afterEach(() => { delete (globalThis as any).localStorage; vi.restoreAllMocks(); });

const prefsWith = (view: unknown) => JSON.stringify({ prefs: UI.prefs.value, tool: 'select', activeLayerId: null, view });

test('a stored view is restored only when zoom and both pan coordinates are finite', () => {
  store.set(CONFIG.STORAGE_PREFS_KEY, prefsWith({ zoom: 2 }));
  restore();
  expect(UI.view.value).toEqual({ pan: { x: 0, y: 0 }, zoom: 1 });
  store.set(CONFIG.STORAGE_PREFS_KEY, prefsWith({ zoom: 2, pan: { x: 'a', y: 5 } }));
  restore();
  expect(UI.view.value).toEqual({ pan: { x: 0, y: 0 }, zoom: 1 });
  store.set(CONFIG.STORAGE_PREFS_KEY, prefsWith({ zoom: 2, pan: { x: 30, y: 40 } }));
  restore();
  expect(UI.view.value).toEqual({ pan: { x: 30, y: 40 }, zoom: 2 });
});

test('a stored document with a dangling point reference is rejected and kept under the -rejected key', () => {
  const d = exampleDoc();
  const raw = serializeDoc({ ...d, paths: d.paths.map((p, i) => (i === 0 ? { ...p, start: { ...p.start, pointId: 'pt_missing' } } : p)) });
  store.set(CONFIG.STORAGE_DOC_KEY, raw);
  expect(restore()).toBe(false);
  expect(doc.value.paths).toHaveLength(0);
  expect(store.get(CONFIG.STORAGE_DOC_KEY)).toBeUndefined();
  expect(store.get(`${CONFIG.STORAGE_DOC_KEY}-rejected`)).toBe(raw);
  store.set(CONFIG.STORAGE_DOC_KEY, serializeDoc(d));
  expect(restore()).toBe(true);
  expect(doc.value).toEqual(d);
});

test('a stored v1 document is migrated on restore and a stored active layer id is kept', () => {
  const v1 = JSON.parse(readFileSync(new URL('../../docs/examples/fish.json', import.meta.url), 'utf8'));
  store.set(CONFIG.STORAGE_DOC_KEY, JSON.stringify(v1));
  store.set(CONFIG.STORAGE_PREFS_KEY, JSON.stringify({ prefs: UI.prefs.value, tool: 'select', activeLayerId: 'layer_x', view: { pan: { x: 0, y: 0 }, zoom: 1 } }));
  expect(restore()).toBe(true);
  expect(doc.value.version).toBe(2);
  expect(doc.value.layers).toHaveLength(3);
  expect(UI.activeLayerId.value).toBe('layer_x');
});
