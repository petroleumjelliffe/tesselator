import { signal } from '@preact/signals';
import { CONFIG } from '../config';
import type { Layer, Tool, PathLayer, Selection, HitTarget, Drag, XY, View, Prefs, PointerKind, Copy } from '../types';

export const layer = signal<Layer>('drawing');
export const sublayer = signal<PathLayer>('structure');
export const tool = signal<Tool>('pen');
export const pen = signal<{ pathId: string } | null>(null);
export const selection = signal<Selection>(null);
export const hover = signal<HitTarget | null>(null);
export const drag = signal<Drag | null>(null);
export const cursor = signal<XY | null>(null);
export const view = signal<View>({ pan: { x: 0, y: 0 }, zoom: 1 });
export const viewport = signal({ width: 0, height: 0 });
export const space = signal(false);
export const prefs = signal<Prefs>({ style: { color: '#1c1b18', weight: 2 }, fillColor: '#c2255c', snap: true, gridDivisions: CONFIG.DEFAULT_GRID_DIVISIONS, ghostOpacity: CONFIG.DEFAULT_GHOST_OPACITY });
export const showHelp = signal(false);
export const exportOpen = signal(false);
export const lastSavedAt = signal<number | null>(null);
export const lastPointerType = signal<PointerKind>('mouse');
export const fillPreview = signal<XY | null>(null);   // world point while a Fill press is held

export function resetUi(): void {
  layer.value = 'drawing'; sublayer.value = 'structure'; tool.value = 'pen'; pen.value = null; selection.value = null;
  hover.value = null; drag.value = null; cursor.value = null; view.value = { pan: { x: 0, y: 0 }, zoom: 1 }; space.value = false;
  showHelp.value = false; exportOpen.value = false; fillPreview.value = null;
}

export function clearSelection(): void { selection.value = null; }
export function selectedPathId(): string | null { const s = selection.value; return s && s.kind === 'path' ? s.id : null; }
export function selectedCopy(): Copy | null { const s = selection.value; return s && s.kind === 'path' ? s.copy : null; }
export function selectedPointIds(): string[] { const s = selection.value; return s && s.kind === 'points' ? s.ids : []; }
export function selectedElementId(): string | null { const s = selection.value; return s && s.kind === 'element' ? s.id : null; }
