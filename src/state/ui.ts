import { signal } from '@preact/signals';
import { CONFIG } from '../config';
import type { Layer, Tool, Selection, HitTarget, Drag, XY, View, Prefs, PointerKind, Copy, Lattice } from '../types';

export const layer = signal<Layer>('drawing');
export const tool = signal<Tool>('pen');
export const pen = signal<{ pathId: string } | null>(null);
export const activeLayerId = signal<string | null>(null);                                        // new paths and fills go here; null = top layer
export const pendingGroup = signal<{ bindingId: string } | { pathId: string } | null>(null);   // an empty group (or binding) the next chip click fills
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
export const viewRestored = signal(false);            // true when the initial view came from a saved session; App skips fitView then
export const freeScale = signal(false);        // touch stand-in for Shift while scaling
export const addToSelection = signal(false);   // touch stand-in for Shift while marquee-selecting

export function resetUi(): void {
  layer.value = 'drawing'; tool.value = 'pen'; pen.value = null; selection.value = null;
  hover.value = null; drag.value = null; cursor.value = null; view.value = { pan: { x: 0, y: 0 }, zoom: 1 }; space.value = false;
  showHelp.value = false; exportOpen.value = false; fillPreview.value = null;
  freeScale.value = false; addToSelection.value = false;
  activeLayerId.value = null; pendingGroup.value = null;
}

export function clearSelection(): void { selection.value = null; }
export function selectedPathId(): string | null { const s = selection.value; return s && s.kind === 'path' ? s.id : null; }
export function selectedCopy(): Copy | null { const s = selection.value; return s && s.kind === 'path' ? s.copy : null; }
export function selectedPointIds(): string[] { const s = selection.value; return s && s.kind === 'points' ? s.ids : []; }
export function selectedElementId(): string | null { const s = selection.value; return s && s.kind === 'element' ? s.id : null; }

export function fitView(lat: Lattice): void {
  const xs = [0, lat.ax, lat.bx, lat.ax + lat.bx], ys = [0, lat.ay, lat.by, lat.ay + lat.by];
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const { width, height } = viewport.value;
  const zoom = Math.min(CONFIG.ZOOM_MAX, Math.max(CONFIG.ZOOM_MIN, Math.min(width / (w * 1.6), height / (h * 1.6)) || 1));
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  view.value = { zoom, pan: { x: width / 2 - cx * zoom, y: height / 2 - cy * zoom } };
}
