import { doc } from '../../state/doc';
import * as UI from '../../state/ui';
import * as A from '../../actions';
import * as P from '../../engine/paths';
import { toWorld, toUV, snapFraction } from '../../engine/lattice';
import { snapWorld } from '../../engine/hit';
import type { HitTarget, XY, UV, Drag, DragSpec, Element } from '../../types';

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
const twelfths = (uv: UV): UV => ({ u: Math.round(uv.u * 12) / 12, v: Math.round(uv.v * 12) / 12 });

// Dragging a clone copy's body moves the first element of the first group that produced the copy (the first group
// with a nonzero power in its clone index) so the copy follows the pointer; a one-group binding drives its one group.
export function cloneBodyMove(d: Extract<Drag, { kind: 'body' }>, w: XY, ctx: ToolCtx): void {
  const b = P.getBinding(doc.value, d.copy.bindingId!);
  const g0 = b && P.dragGroupFor(b, d.copy.power, doc.value.elements, doc.value.lattice);
  if (!b || !g0 || !g0.length) return;
  const s0 = d.startEls.find((z) => z.id === g0[0]);
  if (!s0) return;
  const dx = w.x - d.start.x, dy = w.y - d.start.y;
  A.mutate((dd) => {
    const first = P.getElement(dd, g0[0]);
    if (!first) return false;
    const lat = dd.lattice, c0 = toWorld(s0, lat);
    if (first.kind === 'rotate' && s0.kind === 'rotate') {
      const th = (2 * Math.PI) / first.n, c = Math.cos(th), s = Math.sin(th), det = 2 * (1 - c);
      const ex = ((1 - c) * dx - s * dy) / det, ey = (s * dx + (1 - c) * dy) / det;
      const uv = snapElement({ x: c0.x + ex, y: c0.y + ey }, ctx);
      first.u = uv.u; first.v = uv.v;
      return;
    }
    if (first.kind === 'mirror' && s0.kind === 'mirror') {
      const dv = toWorld({ u: s0.du, v: s0.dv }, lat), L = Math.hypot(dv.x, dv.y) || 1, dir = { x: dv.x / L, y: dv.y / L }, nrm = { x: -dir.y, y: dir.x };
      const pe = dx * nrm.x + dy * nrm.y, al = dx * dir.x + dy * dir.y;
      const uv = snapElement({ x: c0.x + (pe / 2) * nrm.x, y: c0.y + (pe / 2) * nrm.y }, ctx);
      first.u = uv.u; first.v = uv.v;
      const tId = g0.slice(1).find((id) => P.getElement(dd, id)?.kind === 'translate');
      if (tId) {
        const t = P.getElement(dd, tId) as Extract<Element, { kind: 'translate' }>, t0 = d.startEls.find((z) => z.id === tId) as Extract<Element, { kind: 'translate' }>;
        const v0 = toWorld(t0, lat);
        let uv2 = toUV({ x: v0.x + al * dir.x, y: v0.y + al * dir.y }, lat);
        if (ctx.gridOn) uv2 = twelfths(uv2);
        t.u = uv2.u; t.v = uv2.v;
      }
      return;
    }
    if (first.kind === 'translate' && s0.kind === 'translate') {
      let uv = toUV({ x: c0.x + dx, y: c0.y + dy }, lat);
      if (ctx.gridOn) uv = twelfths(uv);
      first.u = uv.u; first.v = uv.v;
    }
  });
}
