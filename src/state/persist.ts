// Autosave the document and UI prefs to localStorage; restore them on load.
import { effect } from '@preact/signals';
import { CONFIG } from '../config';
import { doc } from './doc';
import * as UI from './ui';
import { parseDoc, serializeDoc } from '../engine/serialize';
import type { Prefs, Tool, View } from '../types';

type StoredPrefs = { prefs: Prefs; tool: Tool; activeLayerId: string | null; view: View };

function reject(key: string, raw: string) {
  try { localStorage.setItem(`${key}-rejected`, raw); localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

// Move the stored document aside (to the -rejected key) when it passed parsing but still could not be used.
export function rejectStoredDoc(): void {
  try { const raw = localStorage.getItem(CONFIG.STORAGE_DOC_KEY); if (raw) reject(CONFIG.STORAGE_DOC_KEY, raw); } catch { /* storage unavailable */ }
}

// Stored prefs over the defaults. Before 2026-10-01 `G` was `snap` (it turned targets off too); its value becomes `grid`.
export function migratePrefs(base: Prefs, stored: Partial<Prefs> & { snap?: unknown }): Prefs {
  const { snap, ...rest } = stored;
  const out: Prefs = { ...base, ...rest };
  if (typeof rest.grid !== 'boolean') out.grid = typeof snap === 'boolean' ? snap : base.grid;
  return out;
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
        UI.prefs.value = migratePrefs(UI.prefs.value, s.prefs);
        if (s.tool && ['select', 'pen', 'freehand', 'fill'].includes(s.tool)) UI.tool.value = s.tool;
        if (s.activeLayerId === null || typeof s.activeLayerId === 'string') UI.activeLayerId.value = s.activeLayerId ?? null;
        const v = s.view;
        if (v && Number.isFinite(v.zoom) && v.zoom > 0 && v.pan && Number.isFinite(v.pan.x) && Number.isFinite(v.pan.y)) UI.view.value = { zoom: v.zoom, pan: { x: v.pan.x, y: v.pan.y } };
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
    const s: StoredPrefs = { prefs: UI.prefs.value, tool: UI.tool.value, activeLayerId: UI.activeLayerId.value, view: UI.view.value };
    try { localStorage.setItem(CONFIG.STORAGE_PREFS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  });
  return () => { stopDoc(); stopPrefs(); clearTimeout(timer); };
}
