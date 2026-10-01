// Select tool, plus the point / segment / anchor / control-point / bbox drags that Pen reuses.
import { doc } from '../../state/doc';
import * as UI from '../../state/ui';
import * as A from '../../actions';
import * as P from '../../engine/paths';
import { commit } from '../../state/history';
import { copyMatrix, snapTargets } from '../../state/derived';
import { pointsInRect, bboxHandles, scaleFor, scaleMatrix } from '../../engine/hit';
import { toUV } from '../../engine/lattice';
import { apply, invert, compose, rotation, cellMatrix } from '../../engine/transform';
import { pickSnap, gridResult, pointCopyMatrices, ownFixedCands, NODE_ONLY, bodyTargets, snapBodyDelta, snapScale, cpLines, snapToLines } from '../../engine/snap';
import { CONFIG } from '../../config';
import { STR } from '../../strings';
import { startDrag, cloneBodyMove, type ToolModule, type ToolCtx } from './common';
import type { HitTarget, XY, Drag, Copy, Cell, Matrix, TargetSet, SnapResult, Node } from '../../types';

const sameCopy = (a: Copy, b: Copy) => a.cell.c === b.cell.c && a.cell.r === b.cell.r && a.bindingId === b.bindingId && a.power === b.power;

// Snap for a node being dragged: every target except the point itself and lines touching it, plus its own clones resolved
// to their axis or centre (SN3), the held snap, and the grid as a fallback. S maps the point's base-cell position to the drag.
function nodeSnap(targets: TargetSet, pointId: string, S: Matrix, w: XY, ctx: ToolCtx): SnapResult | null {
  const extra = ctx.snapOn ? ownFixedCands(S, pointCopyMatrices(doc.value, pointId), w, ctx.threshold) : [];
  const s = pickSnap(targets, w, ctx.threshold, { extra, sticky: UI.snapSticky.value, excludePoints: new Set([pointId]), cats: ctx.snapOn ? undefined : NODE_ONLY });
  return s ?? (ctx.snapOn ? gridResult(w, doc.value.lattice, UI.prefs.value.gridDivisions) : null);
}

// Select tool with a path selected: the first move of a drag on one of its nodes unlinks it from other paths first.
function unlinkForDrag(pointId: string, cell: Cell, via?: Copy): Node | null {
  const s = UI.selection.value;
  if (UI.tool.value !== 'select' || !s || s.kind !== 'path') return null;
  return A.unlinkNode(s.id, pointId, cell, via);
}

export function pointDown(t: Extract<HitTarget, { kind: 'point' }>, w: XY, e: PointerEvent, hitScale: number): void {
  const selPts = UI.selectedPointIds();
  if (UI.tool.value === 'select' && selPts.includes(t.pointId) && selPts.length > 1) {
    startDrag(e, t, w, hitScale, { kind: 'pts', ids: selPts.slice(), startPos: P.snapshotPositions(doc.value, selPts) });
    return;
  }
  startDrag(e, t, w, hitScale, { kind: 'pt', pointId: t.pointId, cell: t.cell, via: t.via, targets: snapTargets.value, snap: null });
}

function startBBox(t: HitTarget, w: XY, e: PointerEvent, hitScale: number): void {
  const s = UI.selection.value;
  if (!s || s.kind !== 'path') return;
  const path = P.getPath(doc.value, s.id);
  if (!path) return;
  const M = copyMatrix(s.copy), box = P.boundsWorld(doc.value, path, M);
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const h = t.kind === 'bboxrot' ? { x: cx, y: box.y0 - CONFIG.BBOX_ROT_OFFSET / UI.view.value.zoom, ax: cx, ay: cy, cursor: 'grab' } : bboxHandles(box)[(t as Extract<HitTarget, { kind: 'bbox' }>).h];
  startDrag(e, t, w, hitScale, { kind: 'bbox', mode: t.kind === 'bboxrot' ? 'rot' : 'scale', h, box, cx, cy, pathId: s.id, copy: s.copy, startDoc: doc.value, M: null, nodes: P.pathWorld(doc.value, path).map((q) => apply(M, q)) });
}

export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => {
  if (!t) { startDrag(e, null, w, ctx.hitScale, { kind: 'marquee', cur: w, add: e.shiftKey || UI.addToSelection.value }); if (!e.shiftKey && !UI.addToSelection.value) UI.selection.value = null; return; }
  switch (t.kind) {
    case 'point': return pointDown(t, w, e, ctx.hitScale);
    case 'segment': {
      const path = P.getPath(doc.value, t.pathId); if (!path) return;
      const ids = [...new Set(P.pathNodes(path).map((n) => n.pointId))];
      return startDrag(e, t, w, ctx.hitScale, { kind: 'body', pathId: t.pathId, copy: t.copy, ids, startPos: P.snapshotPositions(doc.value, ids), startEls: doc.value.elements.map((x) => ({ ...x })), targets: null, snap: null });
    }
    case 'canchor': return startDrag(e, t, w, ctx.hitScale, { kind: 'canchor', pathId: t.pathId, pointId: t.pointId, cell: t.cell, copy: t.copy, targets: snapTargets.value, snap: null });
    case 'diamond': return startDrag(e, t, w, ctx.hitScale, { kind: 'cp', pathId: t.pathId, j: t.j, copy: t.copy, lines: cpLines(doc.value, t.pathId, t.j, t.copy) });
    case 'bbox': case 'bboxrot': return startBBox(t, w, e, ctx.hitScale);
    default: return startDrag(e, t, w, ctx.hitScale, { kind: 'click' });
  }
};

export const onMove: ToolModule['onMove'] = (d, w, e, ctx) => {
  switch (d.kind) {
    case 'marquee': d.cur = w; return;
    case 'pt': {
      if (!d.moved) return;
      if (!d.unlinked) {
        d.unlinked = true;
        const n = unlinkForDrag(d.pointId, d.cell, d.via);
        if (n) { if (d.via) d.cell = n.cell; d.pointId = n.pointId; d.via = undefined; }
      }
      const S = d.via ? compose(P.viaMatrix(doc.value, d.via), cellMatrix(d.cell, doc.value.lattice)) : cellMatrix(d.cell, doc.value.lattice);
      const s = nodeSnap(d.targets, d.pointId, S, w, ctx);
      d.snap = s; UI.snapSticky.value = s?.id ?? null; UI.snapHint.value = A.hintOf(s && s.cat !== 'grid' ? s : null);
      const at = s ? s.at : w;
      const src = d.via ? apply(invert(P.viaMatrix(doc.value, d.via)), at) : at;
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
      // A source or cell copy is a pure translation of the source, so the pointer delta is the source delta.
      if (!d.targets) d.targets = bodyTargets(doc.value, snapTargets.value, d.pathId);
      const raw = { x: w.x - d.start.x, y: w.y - d.start.y };
      const sn = ctx.snapOn && d.targets ? snapBodyDelta(d.targets, raw, ctx.threshold, UI.snapSticky.value) : null;
      d.snap = sn; UI.snapSticky.value = sn?.res.id ?? null;
      const dv = sn ? A.uvOf(sn.delta) : A.snapDeltaUV(raw, ctx.snapOn);
      const off = A.worldOf({ u: d.copy.cell.c, v: d.copy.cell.r }), sh = (p: XY): XY => ({ x: p.x + off.x, y: p.y + off.y });
      UI.snapHint.value = sn ? { at: sh(sn.res.at), label: sn.res.label, line: sn.res.line?.map(sh) } : null;
      A.mutate((dd) => { P.movePointsBy(dd, d.ids, d.startPos, dv.u, dv.v); });
      return;
    }
    case 'canchor': {
      if (!d.moved) return;
      if (!d.unlinked) { d.unlinked = true; const n = unlinkForDrag(d.pointId, d.cell); if (n) d.pointId = n.pointId; }
      const M = copyMatrix(d.copy), S = compose(M, cellMatrix(d.cell, doc.value.lattice));
      const s = nodeSnap(d.targets, d.pointId, S, w, ctx);
      d.snap = s; UI.snapSticky.value = s?.id ?? null; UI.snapHint.value = A.hintOf(s && s.cat !== 'grid' ? s : null);
      const src = apply(invert(M), s ? s.at : w);
      A.mutate((dd) => { const uv = toUV(src, dd.lattice); P.movePoint(dd, d.pointId, uv.u - d.cell.c, uv.v - d.cell.r); });
      return;
    }
    case 'cp': {
      if (!d.moved) return;
      const M = copyMatrix(d.copy), s = ctx.snapOn ? snapToLines(w, d.lines, ctx.threshold) : null;
      UI.snapHint.value = s ? { at: s.at, label: STR.snap.guide, line: s.used.flatMap((l) => [{ x: l.p.x - l.dir.x * 1e4, y: l.p.y - l.dir.y * 1e4 }, { x: l.p.x + l.dir.x * 1e4, y: l.p.y + l.dir.y * 1e4 }]) } : null;
      A.mutate((dd) => { P.setControlPointWorld(dd, d.pathId, d.j, apply(invert(M), s ? s.at : w)); });
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
        const free = e.shiftKey || UI.freeScale.value;
        let { sx, sy } = scaleFor(d.h, w, free);
        UI.snapHint.value = null;
        if (UI.prefs.value.snap) {   // ⇧ means "free" here, so it does not invert snapping
          const s = snapScale(d.nodes, doc.value.lattice, d.h, { sx, sy }, free, ctx.threshold, CONFIG.SCALE_FRACTIONS);
          if (s.snapped) { sx = s.sx; sy = s.sy; UI.snapHint.value = { at: { x: d.h.ax + sx * (d.h.x - d.h.ax), y: d.h.ay + sy * (d.h.y - d.h.ay) }, label: STR.snap.scale(`${Math.round(sx * 1000) / 1000} × ${Math.round(sy * 1000) / 1000}`) }; }
        }
        T = scaleMatrix(d.h.ax, d.h.ay, sx, sy);
      }
      const Mc = copyMatrix(d.copy, d.startDoc);
      const Msrc = compose(invert(Mc), compose(T, Mc));
      const next = structuredClone(d.startDoc);
      P.transformPath(next, d.pathId, Msrc);
      commit(next);
      d.M = T;
      if (!UI.snapHint.value && UI.prefs.value.snap) {
        const ends = d.nodes.length ? [apply(T, d.nodes[0]), apply(T, d.nodes[d.nodes.length - 1])] : [];
        for (const q of ends) { const s = pickSnap(snapTargets.value, q, ctx.threshold, { pointsOnly: true, excludePaths: new Set([d.pathId]) }); if (s && s.d < 1) { UI.snapHint.value = A.hintOf(s); break; } }
      }
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
  if (d.kind === 'pt' && d.moved && d.snap && !d.via) { A.joinDroppedPoint(d.pointId, d.cell, d.snap.hit); return; }
  if (d.kind === 'body' && d.moved && d.snap) { A.joinDroppedNode(d.pathId, d.snap.nodeIndex, d.snap.res.hit); return; }
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
