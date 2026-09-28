import { doc } from '../../state/doc';
import * as UI from '../../state/ui';
import * as A from '../../actions';
import * as P from '../../engine/paths';
import { toWorld, toUV, snapFraction } from '../../engine/lattice';
import { snapWorld } from '../../engine/hit';
import type { HitTarget, XY, UV, Drag, DragSpec, Element } from '../../types';

export type ToolCtx = { snapOn: boolean; hitScale: number; threshold: number };
export type ToolModule = {
  onDown(target: HitTarget | null, w: XY, e: PointerEvent, ctx: ToolCtx): void;
  onMove(d: Drag, w: XY, e: PointerEvent, ctx: ToolCtx): void;
  onUp(d: Drag, w: XY, e: PointerEvent, ctx: ToolCtx): void;
};

export function startDrag(e: PointerEvent, target: HitTarget | null, start: XY, hitScale: number, rest: DragSpec): void {
  UI.drag.value = { target, start, moved: false, pointerId: e.pointerId, hitScale, ...rest } as Drag;
}

// Element centres snap to an anchor if one is near, else to the finer of grid and twelfths.
export function snapElement(w: XY, on: boolean, hitScale: number): UV {
  const s = snapWorld(doc.value, w, A.threshold(hitScale), UI.prefs.value.gridDivisions, undefined, false);
  const uv = toUV(s.anchor ? s : w, doc.value.lattice);
  return s.anchor || !on ? uv : snapFraction(uv, UI.prefs.value.gridDivisions, doc.value.lattice);
}
const twelfths = (uv: UV): UV => ({ u: Math.round(uv.u * 12) / 12, v: Math.round(uv.v * 12) / 12 });

// Dragging a clone copy's body moves the first element of its chain so the copy follows the pointer.
export function cloneBodyMove(d: Extract<Drag, { kind: 'body' }>, w: XY, ctx: ToolCtx): void {
  const b = P.getBinding(doc.value, d.copy.bindingId!);
  if (!b || !b.ops.length) return;
  const s0 = d.startEls.find((z) => z.id === b.ops[0]);
  if (!s0) return;
  const dx = w.x - d.start.x, dy = w.y - d.start.y;
  A.mutate((dd) => {
    const first = P.getElement(dd, b.ops[0]);
    if (!first) return false;
    const lat = dd.lattice, c0 = toWorld(s0, lat);
    if (first.kind === 'rotate' && s0.kind === 'rotate') {
      const th = (2 * Math.PI) / first.n, c = Math.cos(th), s = Math.sin(th), det = 2 * (1 - c);
      const ex = ((1 - c) * dx - s * dy) / det, ey = (s * dx + (1 - c) * dy) / det;
      const uv = snapElement({ x: c0.x + ex, y: c0.y + ey }, ctx.snapOn, ctx.hitScale);
      first.u = uv.u; first.v = uv.v;
      return;
    }
    if (first.kind === 'mirror' && s0.kind === 'mirror') {
      const dv = toWorld({ u: s0.du, v: s0.dv }, lat), L = Math.hypot(dv.x, dv.y) || 1, dir = { x: dv.x / L, y: dv.y / L }, nrm = { x: -dir.y, y: dir.x };
      const pe = dx * nrm.x + dy * nrm.y, al = dx * dir.x + dy * dir.y;
      const uv = snapElement({ x: c0.x + (pe / 2) * nrm.x, y: c0.y + (pe / 2) * nrm.y }, ctx.snapOn, ctx.hitScale);
      first.u = uv.u; first.v = uv.v;
      const tId = b.ops.slice(1).find((id) => P.getElement(dd, id)?.kind === 'translate');
      if (tId) {
        const t = P.getElement(dd, tId) as Extract<Element, { kind: 'translate' }>, t0 = d.startEls.find((z) => z.id === tId) as Extract<Element, { kind: 'translate' }>;
        const v0 = toWorld(t0, lat);
        let uv2 = toUV({ x: v0.x + al * dir.x, y: v0.y + al * dir.y }, lat);
        if (ctx.snapOn) uv2 = twelfths(uv2);
        t.u = uv2.u; t.v = uv2.v;
      }
      return;
    }
    if (first.kind === 'translate' && s0.kind === 'translate') {
      let uv = toUV({ x: c0.x + dx, y: c0.y + dy }, lat);
      if (ctx.snapOn) uv = twelfths(uv);
      first.u = uv.u; first.v = uv.v;
    }
  });
}
