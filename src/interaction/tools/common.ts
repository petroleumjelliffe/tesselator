import { doc } from '../../state/doc';
import * as UI from '../../state/ui';
import * as A from '../../actions';
import { toUV, snapFraction } from '../../engine/lattice';
import { snapWorld } from '../../engine/hit';
import type { HitTarget, XY, UV, Drag, DragSpec } from '../../types';

// Spec §6.5: targets (nodes, lines, edges, corners, …) always attract unless ⌘ / Ctrl is held for the gesture; the grid
// is a separate, silent fallback toggled by `G`.
export type ToolCtx = { targetsOn: boolean; gridOn: boolean; hitScale: number; threshold: number };
export type ToolModule = {
  onDown(target: HitTarget | null, w: XY, e: PointerEvent, ctx: ToolCtx): void;
  onMove(d: Drag, w: XY, e: PointerEvent, ctx: ToolCtx): void;
  onUp(d: Drag, w: XY, e: PointerEvent, ctx: ToolCtx): void;
};

export function startDrag(e: PointerEvent, target: HitTarget | null, start: XY, hitScale: number, rest: DragSpec): void {
  UI.drag.value = { target, start, moved: false, pointerId: e.pointerId, hitScale, ...rest } as Drag;
}

// Element centres snap to an anchor if one is near (a target), else to the finer of grid and twelfths (the grid).
export function snapElement(w: XY, ctx: ToolCtx): UV {
  const s = ctx.targetsOn ? snapWorld(doc.value, w, A.threshold(ctx.hitScale), UI.prefs.value.gridDivisions, undefined, false) : null;
  if (s?.anchor) return toUV(s, doc.value.lattice);
  const uv = toUV(w, doc.value.lattice);
  return ctx.gridOn ? snapFraction(uv, UI.prefs.value.gridDivisions, doc.value.lattice) : uv;
}
