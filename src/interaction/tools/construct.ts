// Construction layer: drag elements, rotate mirrors, set translation vectors, drag lattice handles.
import { doc } from '../../state/doc';
import * as UI from '../../state/ui';
import * as A from '../../actions';
import * as P from '../../engine/paths';
import { toUV, isDegenerate } from '../../engine/lattice';
import { mirrorDirFromAngle } from '../../engine/transform';
import { CONFIG } from '../../config';
import { startDrag, snapElement, type ToolModule } from './common';
import type { HitTarget, XY, Element } from '../../types';

export function startMultiDrag(w: XY, t: HitTarget | null, e: PointerEvent): void {
  const d = doc.value, pn = UI.pen.value;
  const own = pn ? d.bindings.filter((b) => b.pathId === pn.pathId).map((b) => b.ops[0]).filter(Boolean) : [];
  const ids = own.length ? own : d.newPathOps.map((c) => c[0]).filter(Boolean);
  startDrag(e, t, w, e.pointerType === 'touch' ? CONFIG.TOUCH_HIT_SCALE : 1, { kind: 'elmulti', ids: [...new Set(ids)], startEls: d.elements.map((x) => ({ ...x })) });
}

export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => {
  if (!t) { startDrag(e, null, w, ctx.hitScale, { kind: 'click' }); UI.selection.value = null; return; }
  switch (t.kind) {
    case 'element': { const el = P.getElement(doc.value, t.elementId); if (!el) return; startDrag(e, t, w, ctx.hitScale, { kind: 'elc', id: el.id, u0: el.u, v0: el.v }); return; }
    case 'elrot': startDrag(e, t, w, ctx.hitScale, { kind: 'elrot', id: t.elementId }); return;
    case 'eltip': startDrag(e, t, w, ctx.hitScale, { kind: 'eltip', id: t.elementId }); return;
    case 'lat': startDrag(e, t, w, ctx.hitScale, { kind: 'lat', which: t.which }); return;
    default: startDrag(e, t, w, ctx.hitScale, { kind: 'click' });
  }
};

const twelfths = (x: number) => Math.round(x * 12) / 12;

export const onMove: ToolModule['onMove'] = (d, w, e, ctx) => {
  if (!d.moved) return;
  switch (d.kind) {
    case 'elc': {
      const lat = doc.value.lattice, delta = toUV({ x: w.x - d.start.x, y: w.y - d.start.y }, lat);
      const target = { u: d.u0 + delta.u, v: d.v0 + delta.v };
      const uv = snapElement(A.worldOf(target), ctx.snapOn, ctx.hitScale);
      A.mutate((dd) => { const el = P.getElement(dd, d.id); if (!el) return false; el.u = uv.u; el.v = uv.v; });
      return;
    }
    case 'elrot': {
      A.mutate((dd) => {
        const el = P.getElement(dd, d.id); if (!el || el.kind !== 'mirror') return false;
        const c = A.worldOf(el);
        let ang = (Math.atan2(w.y - c.y, w.x - c.x) * 180) / Math.PI;
        if (ctx.snapOn) ang = Math.round(ang / 15) * 15;
        const dir = mirrorDirFromAngle(ang, dd.lattice); el.du = dir.du; el.dv = dir.dv;
      });
      return;
    }
    case 'eltip': {
      A.mutate((dd) => {
        const el = P.getElement(dd, d.id); if (!el || el.kind !== 'translate') return false;
        let { u, v } = toUV(w, dd.lattice);
        if (ctx.snapOn) { u = twelfths(u); v = twelfths(v); }
        el.u = u; el.v = v;
      });
      return;
    }
    case 'lat': {
      let x = w.x, y = w.y;
      if (ctx.snapOn) { const len = Math.max(40, Math.round(Math.hypot(x, y) / 10) * 10), ang = Math.round(Math.atan2(y, x) / (Math.PI / 12)) * (Math.PI / 12); x = len * Math.cos(ang); y = len * Math.sin(ang); }
      const nl = { ...doc.value.lattice };
      if (d.which === 'a') { nl.ax = x; nl.ay = y; } else { nl.bx = x; nl.by = y; }
      if (isDegenerate(nl, CONFIG.MIN_LATTICE_DET)) return;
      A.mutate((dd) => { dd.lattice = nl; });
      return;
    }
    case 'elmulti': {
      const dv = A.snapDeltaUV({ x: w.x - d.start.x, y: w.y - d.start.y }, ctx.snapOn);
      A.mutate((dd) => {
        for (const id of d.ids) {
          const x = P.getElement(dd, id), s = d.startEls.find((z) => z.id === id) as Element | undefined;
          if (!x || !s || x.kind === 'translate') continue;
          x.u = s.u + dv.u; x.v = s.v + dv.v;
        }
      });
      return;
    }
    default:
  }
};

export const onUp: ToolModule['onUp'] = (d) => {
  if (d.moved || !d.target) return;
  if (d.target.kind === 'element' || d.target.kind === 'elrot' || d.target.kind === 'eltip') A.selectElement(d.target.elementId);
};
