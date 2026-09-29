// Select tool, plus the point / segment / anchor / control-point / bbox drags that Pen reuses.
import { doc } from '../../state/doc';
import * as UI from '../../state/ui';
import * as A from '../../actions';
import * as P from '../../engine/paths';
import { commit } from '../../state/history';
import { copyMatrix } from '../../state/derived';
import { pointsInRect, bboxHandles, scaleFor, scaleMatrix } from '../../engine/hit';
import { toUV } from '../../engine/lattice';
import { apply, invert, compose, rotation } from '../../engine/transform';
import { CONFIG } from '../../config';
import { startDrag, cloneBodyMove, type ToolModule, type ToolCtx } from './common';
import type { HitTarget, XY, Drag, Copy } from '../../types';

const sameCopy = (a: Copy, b: Copy) => a.cell.c === b.cell.c && a.cell.r === b.cell.r && a.bindingId === b.bindingId && a.power === b.power;
const linear = (M: readonly number[], p: XY): XY => ({ x: M[0] * p.x + M[2] * p.y, y: M[1] * p.x + M[3] * p.y });

export function pointDown(t: Extract<HitTarget, { kind: 'point' }>, w: XY, e: PointerEvent, hitScale: number): void {
  const selPts = UI.selectedPointIds();
  if (UI.tool.value === 'select' && selPts.includes(t.pointId) && selPts.length > 1) {
    startDrag(e, t, w, hitScale, { kind: 'pts', ids: selPts.slice(), startPos: P.snapshotPositions(doc.value, selPts) });
    return;
  }
  startDrag(e, t, w, hitScale, { kind: 'pt', pointId: t.pointId, cell: t.cell, via: t.via, snapTo: null });
}

function startBBox(t: HitTarget, w: XY, e: PointerEvent, hitScale: number): void {
  const s = UI.selection.value;
  if (!s || s.kind !== 'path') return;
  const path = P.getPath(doc.value, s.id);
  if (!path) return;
  const M = copyMatrix(s.copy), box = P.boundsWorld(doc.value, path, M);
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const h = t.kind === 'bboxrot' ? { x: cx, y: box.y0 - CONFIG.BBOX_ROT_OFFSET / UI.view.value.zoom, ax: cx, ay: cy, cursor: 'grab' } : bboxHandles(box)[(t as Extract<HitTarget, { kind: 'bbox' }>).h];
  startDrag(e, t, w, hitScale, { kind: 'bbox', mode: t.kind === 'bboxrot' ? 'rot' : 'scale', h, box, cx, cy, pathId: s.id, copy: s.copy, startDoc: doc.value, M: null });
}

export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => {
  if (!t) { startDrag(e, null, w, ctx.hitScale, { kind: 'marquee', cur: w, add: e.shiftKey || UI.addToSelection.value }); if (!e.shiftKey && !UI.addToSelection.value) UI.selection.value = null; return; }
  switch (t.kind) {
    case 'point': return pointDown(t, w, e, ctx.hitScale);
    case 'segment': {
      const path = P.getPath(doc.value, t.pathId); if (!path) return;
      const ids = [...new Set(P.pathNodes(path).map((n) => n.pointId))];
      return startDrag(e, t, w, ctx.hitScale, { kind: 'body', pathId: t.pathId, copy: t.copy, ids, startPos: P.snapshotPositions(doc.value, ids), startEls: doc.value.elements.map((x) => ({ ...x })) });
    }
    case 'canchor': return startDrag(e, t, w, ctx.hitScale, { kind: 'canchor', pathId: t.pathId, pointId: t.pointId, cell: t.cell, copy: t.copy });
    case 'diamond': return startDrag(e, t, w, ctx.hitScale, { kind: 'cp', pathId: t.pathId, j: t.j, copy: t.copy });
    case 'bbox': case 'bboxrot': return startBBox(t, w, e, ctx.hitScale);
    default: return startDrag(e, t, w, ctx.hitScale, { kind: 'click' });
  }
};

export const onMove: ToolModule['onMove'] = (d, w, e, ctx) => {
  switch (d.kind) {
    case 'marquee': d.cur = w; return;
    case 'pt': {
      if (!d.moved) return;
      const own = d.via;   // a via node must not snap to its own image (the anchor sitting where it is), or the drag advances in threshold-sized jumps
      const s = A.snapPoint(w, ctx.snapOn, (a) => a.pointId === d.pointId && (!a.bindingId || (!!own && a.bindingId === own.bindingId && a.power === own.power)), ctx.hitScale);
      d.snapTo = !d.via && s.anchor && !s.anchor.bindingId && s.anchor.pointId !== d.pointId ? { pointId: s.anchor.pointId, cell: s.anchor.cell } : null;   // a raw point copy of another point: merge on release
      const src = d.via ? apply(invert(P.viaMatrix(doc.value, d.via)), s) : s;   // a via node moves its point through the inverse of its copy
      A.mutate((dd) => { const uv = toUV(src, dd.lattice); P.movePoint(dd, d.pointId, uv.u - d.cell.c, uv.v - d.cell.r); });
      return;
    }
    case 'pts': {
      if (!d.moved) return;
      const dv = A.snapDeltaUV({ x: w.x - d.start.x, y: w.y - d.start.y }, ctx.snapOn);
      A.mutate((dd) => { P.movePointsBy(dd, d.ids, d.startPos, dv.u, dv.v); });
      return;
    }
    case 'body': {
      if (!d.moved) return;
      if (d.copy.bindingId) { cloneBodyMove(d, w, ctx); return; }
      const M = copyMatrix(d.copy);
      const dv = A.snapDeltaUV(linear(invert(M), { x: w.x - d.start.x, y: w.y - d.start.y }), ctx.snapOn);
      A.mutate((dd) => { P.movePointsBy(dd, d.ids, d.startPos, dv.u, dv.v); });
      return;
    }
    case 'canchor': {
      if (!d.moved) return;
      const M = copyMatrix(d.copy);
      const s = A.snapPoint(w, ctx.snapOn, (a) => a.pointId === d.pointId && (!a.bindingId || (a.bindingId === d.copy.bindingId && a.power === d.copy.power)), ctx.hitScale);   // not its own image either
      const src = apply(invert(M), s);
      A.mutate((dd) => { const uv = toUV(src, dd.lattice); P.movePoint(dd, d.pointId, uv.u - d.cell.c, uv.v - d.cell.r); });
      return;
    }
    case 'cp': {
      if (!d.moved) return;
      const M = copyMatrix(d.copy);
      A.mutate((dd) => { P.setControlPointWorld(dd, d.pathId, d.j, apply(invert(M), w)); });
      return;
    }
    case 'bbox': {
      if (!d.moved) return;
      let T;
      if (d.mode === 'rot') {
        let th = Math.atan2(w.y - d.cy, w.x - d.cx) - Math.atan2(d.h.y - d.cy, d.h.x - d.cx);
        if (ctx.snapOn) th = Math.round(th / (Math.PI / 12)) * (Math.PI / 12);
        T = rotation(th, d.cx, d.cy);
      } else {
        const { sx, sy } = scaleFor(d.h, w, e.shiftKey || UI.freeScale.value);
        T = scaleMatrix(d.h.ax, d.h.ay, sx, sy);
      }
      const Mc = copyMatrix(d.copy, d.startDoc);
      const Msrc = compose(invert(Mc), compose(T, Mc));
      const next = structuredClone(d.startDoc);
      P.transformPath(next, d.pathId, Msrc);
      commit(next);
      d.M = T;
      return;
    }
    default:
  }
};

export const onUp: ToolModule['onUp'] = (d, w, e, ctx) => {
  if (d.kind === 'marquee') {
    if (!d.moved) return;
    const r = { x0: Math.min(d.start.x, d.cur.x), x1: Math.max(d.start.x, d.cur.x), y0: Math.min(d.start.y, d.cur.y), y1: Math.max(d.start.y, d.cur.y) };
    A.selectPoints([...(d.add ? UI.selectedPointIds() : []), ...pointsInRect(doc.value, r)]);
    return;
  }
  if (d.kind === 'pt' && d.moved && d.snapTo) { A.mergeDroppedPoint(d.pointId, d.cell, d.snapTo.pointId, d.snapTo.cell); return; }
  if (d.moved || !d.target) return;
  const t = d.target, s = UI.selection.value;
  switch (t.kind) {
    case 'point': if (e.shiftKey || UI.addToSelection.value) A.togglePointSelection(t.pointId); else A.selectPoints([t.pointId]); return;
    case 'segment':
      if (s && s.kind === 'path' && s.id === t.pathId && sameCopy(s.copy, t.copy)) A.insertNodeOnSegment(t.pathId, t.j, w, t.copy, ctx.snapOn);
      else A.selectPathAt(t.pathId, t.copy);
      return;
    case 'canchor': A.selectPathAt(t.pathId, t.copy); return;
    case 'fill': A.selectFill(t.fillId); return;
    default:
  }
};
