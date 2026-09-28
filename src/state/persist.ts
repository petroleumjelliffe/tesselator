// Autosave the document and UI prefs to localStorage; restore them on load.
import { effect } from '@preact/signals';
import { CONFIG } from '../config';
import { doc } from './doc';
import * as UI from './ui';
import { parseDoc, serializeDoc } from '../engine/serialize';
import type { Prefs, Tool, PathLayer, View } from '../types';

type StoredPrefs = { prefs: Prefs; tool: Tool; sublayer: PathLayer; view: View };

function reject(key: string, raw: string) {
  try { localStorage.setItem(`${key}-rejected`, raw); localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

export function restore(): boolean {
  let loaded = false;
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE_DOC_KEY);
    if (raw) {
      const d = parseDoc(raw);
      if (d) { doc.value = d; loaded = true; } else { console.warn('stored document rejected'); reject(CONFIG.STORAGE_DOC_KEY, raw); }
    }
    const p = localStorage.getItem(CONFIG.STORAGE_PREFS_KEY);
    if (p) {
      const s = JSON.parse(p) as Partial<StoredPrefs>;
      if (s && s.prefs && typeof s.prefs.gridDivisions === 'number' && s.prefs.style) {
        UI.prefs.value = { ...UI.prefs.value, ...s.prefs };
        if (s.tool && ['select', 'pen', 'freehand', 'fill'].includes(s.tool)) UI.tool.value = s.tool;
        if (s.sublayer === 'structure' || s.sublayer === 'detail') UI.sublayer.value = s.sublayer;
        if (s.view && Number.isFinite(s.view.zoom) && s.view.zoom > 0) UI.view.value = s.view;
      } else reject(CONFIG.STORAGE_PREFS_KEY, p);
    }
  } catch (err) { console.warn('restore failed', err); }
  return loaded;
}

export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopDoc = effect(() => {
    const d = doc.value;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { localStorage.setItem(CONFIG.STORAGE_DOC_KEY, serializeDoc(d)); UI.lastSavedAt.value = Date.now(); } catch { /* quota or private mode */ }
    }, CONFIG.AUTOSAVE_MS);
  });
  const stopPrefs = effect(() => {
    const s: StoredPrefs = { prefs: UI.prefs.value, tool: UI.tool.value, sublayer: UI.sublayer.value, view: UI.view.value };
    try { localStorage.setItem(CONFIG.STORAGE_PREFS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  });
  return () => { stopDoc(); stopPrefs(); clearTimeout(timer); };
}
