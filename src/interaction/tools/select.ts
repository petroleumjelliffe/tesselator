// Select tool, plus the point / segment / anchor / control-point / bbox drags that Pen reuses.
import { doc } from '../../state/doc';
import * as UI from '../../state/ui';
import * as A from '../../actions';
import * as P from '../../engine/paths';
import { commit } from '../../state/history';
import { copyMatrix, snapTargets, copies } from '../../state/derived';
import { pointsInRectAll, bboxHandles, boxScale, scaleMatrix, isOriginal, instancesInRect } from '../../engine/hit';
import { toUV } from '../../engine/lattice';
import { apply, invert, compose, rotation, cellMatrix, isIdentity, rotationAngle, angleDeg } from '../../engine/transform';
import { pickSnap, gridResult, pointCopyMatrices, ownFixedCands, bodyTargets, snapBodyDelta, snapScale, cpLines, snapToLines } from '../../engine/snap';
import { CONFIG } from '../../config';
import { STR } from '../../strings';
import { startDrag, type ToolModule, type ToolCtx } from './common';
import type { HitTarget, XY, Drag, Copy, Cell, Matrix, TargetSet, SnapResult, Node, SnapCat, BodySnap } from '../../types';

const sameCopy = (a: Copy, b: Copy) => a.cell.c === b.cell.c && a.cell.r === b.cell.r && a.bindingId === b.bindingId && a.power === b.power;

// Snap for a node being dragged: every target except the point itself and lines touching it, plus its own clones resolved
// to their axis or centre (SN3), the held snap, and the grid as a fallback. S maps the point's base-cell position to the drag.
// `also` names further points that move with it (a several-point drag), which are not targets either.
// With targets off (⌘ / Ctrl) nothing attracts but the grid.
function nodeSnap(targets: TargetSet, pointId: string, S: Matrix, w: XY, ctx: ToolCtx, also: string[] = []): SnapResult | null {
  const s = ctx.targetsOn
    ? pickSnap(targets, w, ctx.threshold, { extra: ownFixedCands(S, pointCopyMatrices(doc.value, pointId), w, ctx.threshold), sticky: UI.snapSticky.value, excludePoints: new Set([pointId, ...also]), prefer: A.joinsOn(doc.value, A.layerOfPoint(doc.value, pointId)) })
    : null;
  return s ?? (ctx.gridOn ? gridResult(w, doc.value.lattice, UI.prefs.value.gridDivisions) : null);
}

// A node dragged through a copy (a clone anchor, or a point picked through a clone) is moved in its source frame, so
// a drop joins what lies under it in that frame: the node or line at M⁻¹(at), which the instance shows exactly on the
// snapped target. Where nothing is there (the target cannot be expressed in that frame, e.g. a plain node whose
// pre-image is no copy of anything), the drop stays location only. Same-layer rule as every join (joinDroppedPoint).
// The moved point now sits on the pre-image; node targets of different points never hide each other, so the node
// there is still a target.
const JOINABLE: ReadonlySet<SnapCat> = new Set<SnapCat>(['node', 'line']);
function joinThrough(M: Matrix, pointId: string, cell: Cell, s: SnapResult, also: string[] = []): void {
  if (s.hit.kind !== 'node' && s.hit.kind !== 'curve') return;
  const src = apply(invert(M), s.at), d = doc.value;
  const r = pickSnap(snapTargets.value, src, 1e-6 * (1 + Math.hypot(src.x, src.y)), { excludePoints: new Set([pointId, ...also]), cats: JOINABLE, prefer: A.joinsOn(d, A.layerOfPoint(d, pointId)) });
  if (r && (r.hit.kind === 'node' || r.hit.kind === 'curve')) A.joinDroppedPoint(pointId, cell, r.hit);
}

// E5a: a body drag's frame, fixed at the press. G places the grabbed copy for snapping: its clone matrix, or the identity
// for the original or a repeat. A clone's G is reduced by the lattice cell k holding G·(the path's start), so the copy is
// measured in the base cell, where the 3×3 target window covers it, however far its translation reaches. `cell` (the
// copy's own cell plus k) puts the hint back where the copy is shown.
function bodyFrame(pathId: string, copy: Copy): { G: Matrix; cell: Cell } {
  const d = doc.value, path = P.getPath(d, pathId), G0 = copyMatrix({ ...copy, cell: { c: 0, r: 0 } });
  if (!copy.bindingId || !path) return { G: G0, cell: copy.cell };
  const uv = toUV(apply(G0, P.pathWorld(d, path)[0]), d.lattice), k = { c: Math.floor(uv.u), r: Math.floor(uv.v) };
  return { G: compose(cellMatrix({ c: -k.c, r: -k.r }, d.lattice), G0), cell: { c: copy.cell.c + k.c, r: copy.cell.r + k.r } };
}

// §6.4 for a body drag: the snap was measured at the grabbed copy G, but the join happens in the original's frame, so a
// node or line target joins what lies at its pre-image G⁻¹(at), as joinThrough does; otherwise location only.
function joinBody(pathId: string, G: Matrix, s: BodySnap, ids: string[]): void {
  if (s.res.hit.kind !== 'node' && s.res.hit.kind !== 'curve') return;
  if (isIdentity(G)) { A.joinDroppedNode(pathId, s.nodeIndex, s.res.hit); return; }
  const src = apply(invert(G), s.res.at), d = doc.value, path = P.getPath(d, pathId);
  if (!path) return;
  const r = pickSnap(snapTargets.value, src, 1e-6 * (1 + Math.hypot(src.x, src.y)), { excludePoints: new Set(ids), excludePaths: new Set([pathId]), cats: JOINABLE, prefer: A.joinsOn(d, path.layerId) });
  if (r && (r.hit.kind === 'node' || r.hit.kind === 'curve')) A.joinDroppedNode(pathId, s.nodeIndex, r.hit);
}

// Select tool with a path selected: the first move of a drag on one of its nodes unlinks it from other paths first.
// S2: a selected raw instance's nodes are hit with the instance's copy.cell folded into whichever field carries the node's
// own position (via.cell for a via node, cell otherwise); unshift it before matching, since the stored node — and the
// detached node unlinkNode hands back — is always in the document frame, not the selected instance's. A clone instance's
// cell/anchor (canchor) is never shifted this way, so it passes through unchanged.
function unlinkForDrag(pointId: string, cell: Cell, via?: Copy): Node | null {
  const s = UI.selection.value;
  if (UI.tool.value !== 'select' || !s || s.kind !== 'path') return null;
  if (s.copy.bindingId) return A.unlinkNode(s.id, pointId, cell, via);
  const k = s.copy.cell, unshift = (c: Cell): Cell => ({ c: c.c - k.c, r: c.r - k.r });
  return via ? A.unlinkNode(s.id, pointId, cell, { ...via, cell: unshift(via.cell) }) : A.unlinkNode(s.id, pointId, unshift(cell), via);
}

export function pointDown(t: Extract<HitTarget, { kind: 'point' }>, w: XY, e: PointerEvent, hitScale: number): void {
  const selPts = UI.selectedPointIds();
  if (UI.tool.value === 'select' && selPts.includes(t.pointId) && selPts.length > 1) {
    const s = UI.selection.value, copies = s && s.kind === 'points' ? s.copies ?? {} : {};
    const pt = P.getPoint(doc.value, t.pointId)!, rawAt = A.worldOf({ u: pt.u + t.cell.c, v: pt.v + t.cell.r });
    const at = t.via ? apply(P.viaMatrix(doc.value, t.via), rawAt) : rawAt;
    startDrag(e, t, w, hitScale, { kind: 'pts', ids: selPts.slice(), startPos: P.snapshotPositions(doc.value, selPts), copies, targets: snapTargets.value, grab: { pointId: t.pointId, cell: t.cell, via: t.via, at }, snap: null });
    return;
  }
  startDrag(e, t, w, hitScale, { kind: 'pt', pointId: t.pointId, cell: t.cell, via: t.via, targets: snapTargets.value, snap: null });
}

function startBBox(t: Extract<HitTarget, { kind: 'bbox' | 'bboxrot' }>, w: XY, e: PointerEvent, hitScale: number): void {
  const s = UI.selection.value;
  if (!s || s.kind !== 'path') return;
  const path = P.getPath(doc.value, s.id);
  if (!path) return;
  if (t.kind === 'bboxrot' && !isOriginal(s.copy)) return;   // E6a: originals only
  const M = copyMatrix(s.copy), box = P.boundsWorld(doc.value, path, M);
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  startDrag(e, t, w, hitScale, { kind: 'bbox', mode: t.kind === 'bboxrot' ? 'rot' : 'scale', h: bboxHandles(box)[t.h], box, cx, cy, a0: Math.atan2(w.y - cy, w.x - cx),
    pathId: s.id, copy: s.copy, startDoc: doc.value, M: null, nodes: P.pathWorld(doc.value, path).map((q) => apply(M, q)),
    targets: snapTargets.value, own: new Set(P.pathNodes(path).map((n) => n.pointId)) });   // I5: the targets at the press; the path's own nodes move with it
}

export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => {
  if (!t) { startDrag(e, null, w, ctx.hitScale, { kind: 'marquee', cur: w, add: e.shiftKey || UI.addToSelection.value }); if (!e.shiftKey && !UI.addToSelection.value) UI.selection.value = null; return; }
  switch (t.kind) {
    case 'point': return pointDown(t, w, e, ctx.hitScale);
    case 'segment': {
      const path = P.getPath(doc.value, t.pathId); if (!path) return;
      const ids = [...new Set(P.pathNodes(path).map((n) => n.pointId))];
      return startDrag(e, t, w, ctx.hitScale, { kind: 'body', pathId: t.pathId, copy: t.copy, ids, startPos: P.snapshotPositions(doc.value, ids), frame: bodyFrame(t.pathId, t.copy), targets: null, snap: null });
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
        if (n) {
          // The detached node's cell comes back in the document frame; re-add the selected raw instance's cell (S2) to stay in its frame.
          const s = UI.selection.value, k = s && s.kind === 'path' && !s.copy.bindingId ? s.copy.cell : { c: 0, r: 0 };
          d.cell = { c: n.cell.c + k.c, r: n.cell.r + k.r };
          d.pointId = n.pointId; d.via = undefined;
          d.targets = snapTargets.value;   // C2: the old targets put this path's own lines on the shared point id; rebuild from the unlinked doc
        }
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
      let delta = { x: w.x - d.start.x, y: w.y - d.start.y };
      if (d.grab) {   // spec §6.3: the grabbed node snaps as one node drag (SN3, grid fallback); the others follow rigidly
        const g = d.grab, raw = { x: g.at.x + delta.x, y: g.at.y + delta.y }, lat = doc.value.lattice;
        const S = g.via ? compose(P.viaMatrix(doc.value, g.via), cellMatrix(g.cell, lat)) : cellMatrix(g.cell, lat);
        const s = nodeSnap(d.targets, g.pointId, S, raw, ctx, d.ids);
        d.snap = s; UI.snapSticky.value = s?.id ?? null; UI.snapHint.value = A.hintOf(s && s.cat !== 'grid' ? s : null);
        if (s) delta = { x: s.at.x - g.at.x, y: s.at.y - g.at.y };
      }
      const groups = new Map<string, { ids: string[]; M: Matrix | null }>();
      for (const id of d.ids) {
        const c = d.copies[id], k = c ? `${c.cell.c},${c.cell.r},${c.bindingId},${c.power}` : 'raw';
        if (!groups.has(k)) groups.set(k, { ids: [], M: c ? P.viaMatrix(doc.value, c) : null });
        groups.get(k)!.ids.push(id);
      }
      A.mutate((dd) => {
        for (const g of groups.values()) {
          // A point picked through a clone moves through that clone's inverse (its linear part: a delta has no offset).
          const lin = g.M ? apply(invert([g.M[0], g.M[1], g.M[2], g.M[3], 0, 0]), delta) : delta;
          const dv = A.uvOf(lin);
          P.movePointsBy(dd, g.ids, d.startPos, dv.u, dv.v);
        }
      });
      return;
    }
    case 'body': {
      if (!d.moved) return;
      // E5a: a body drag on any copy moves the original so the grabbed copy follows the pointer; elements never move.
      // The snap is measured at the grabbed copy, placed near the base cell by G (bodyFrame), and the world delta maps
      // back to the source through G's linear part. The hint is shown at the grabbed copy itself, its cell added back.
      const { G, cell } = d.frame, Gl = invert([G[0], G[1], G[2], G[3], 0, 0]);
      if (!d.targets) d.targets = bodyTargets(doc.value, snapTargets.value, d.pathId, G);
      const raw = { x: w.x - d.start.x, y: w.y - d.start.y };
      const sn = ctx.targetsOn && d.targets ? snapBodyDelta(d.targets, raw, ctx.threshold, UI.snapSticky.value) : null;
      d.snap = sn; UI.snapSticky.value = sn?.res.id ?? null;
      const dv = sn ? A.uvOf(apply(Gl, sn.delta)) : A.snapDeltaUV(apply(Gl, raw), ctx.gridOn);
      const off = A.worldOf({ u: cell.c, v: cell.r }), sh = (p: XY): XY => ({ x: p.x + off.x, y: p.y + off.y });
      UI.snapHint.value = sn ? { at: sh(sn.res.at), label: sn.res.label, line: sn.res.line?.map(sh) } : null;
      A.mutate((dd) => { P.movePointsBy(dd, d.ids, d.startPos, dv.u, dv.v); });
      return;
    }
    case 'canchor': {
      if (!d.moved) return;
      if (!d.unlinked) { d.unlinked = true; const n = unlinkForDrag(d.pointId, d.cell); if (n) { d.pointId = n.pointId; d.targets = snapTargets.value; } }
      const M = copyMatrix(d.copy), S = compose(M, cellMatrix(d.cell, doc.value.lattice));
      const s = nodeSnap(d.targets, d.pointId, S, w, ctx);
      d.snap = s; UI.snapSticky.value = s?.id ?? null; UI.snapHint.value = A.hintOf(s && s.cat !== 'grid' ? s : null);
      const src = apply(invert(M), s ? s.at : w);
      A.mutate((dd) => { const uv = toUV(src, dd.lattice); P.movePoint(dd, d.pointId, uv.u - d.cell.c, uv.v - d.cell.r); });
      return;
    }
    case 'cp': {
      if (!d.moved) return;
      const M = copyMatrix(d.copy), s = ctx.targetsOn ? snapToLines(w, d.lines, ctx.threshold) : null;
      UI.snapHint.value = s ? { at: s.at, label: STR.snap.guide, line: s.used.flatMap((l) => [{ x: l.p.x - l.dir.x * 1e4, y: l.p.y - l.dir.y * 1e4 }, { x: l.p.x + l.dir.x * 1e4, y: l.p.y + l.dir.y * 1e4 }]) } : null;
      A.mutate((dd) => { P.setControlPointWorld(dd, d.pathId, d.j, apply(invert(M), s ? s.at : w)); });
      return;
    }
    case 'bbox': {
      if (!d.moved) return;
      let T;
      if (d.mode === 'rot') {
        // E6a, H10: about the box centre, from the angle at the press; 15° steps while G is on (silent quantisation
        // counts as grid, §6.5, so ⌘ / Ctrl does not free it). The hint shows the angle at the grabbed corner.
        const th = rotationAngle(Math.atan2(w.y - d.cy, w.x - d.cx) - d.a0, ctx.gridOn ? CONFIG.ROTATE_STEP_DEG : 0);
        T = rotation(th, d.cx, d.cy);
        UI.snapHint.value = { at: apply(T, { x: d.h.x, y: d.h.y }), label: STR.snap.angle(angleDeg(th)) };
      } else {
        // E6, §6.5: ⇧ keeps proportions, ⌥ scales from the box centre; they combine. The size fractions (T13) snap
        // silently unless ⌘ / Ctrl is held, whatever G says.
        const proportional = e.shiftKey || UI.keepProportions.value;
        const b = boxScale(d.box, d.h, w, { proportional, fromCentre: e.altKey });
        let { sx, sy } = b;
        if (ctx.targetsOn) {
          const s = snapScale(d.box, doc.value.lattice, d.h, { x: b.ax, y: b.ay }, { sx, sy }, proportional, ctx.threshold, CONFIG.FRACTION_MAX_N);
          sx = s.sx; sy = s.sy;
        }
        UI.snapHint.value = null;   // H10: no hint for the size fractions; the endpoint hints below still apply
        T = scaleMatrix(b.ax, b.ay, sx, sy);
      }
      const Mc = copyMatrix(d.copy, d.startDoc);
      const Msrc = compose(invert(Mc), compose(T, Mc));
      const next = structuredClone(d.startDoc);
      P.transformPath(next, d.pathId, Msrc);
      commit(next);
      d.M = T;
      if (!UI.snapHint.value && ctx.targetsOn) {
        const ends = d.nodes.length ? [apply(T, d.nodes[0]), apply(T, d.nodes[d.nodes.length - 1])] : [];
        for (const q of ends) { const s = pickSnap(d.targets, q, ctx.threshold, { pointsOnly: true, excludePaths: new Set([d.pathId]), excludePoints: d.own }); if (s && s.d < 1) { UI.snapHint.value = A.hintOf(s); break; } }
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
    // S8: the instances wholly inside become the selection (one path, or several); ⌥ at the release always picks nodes.
    // With no whole instance, the nodes inside (S5). ⇧ adds to a selection of the same kind.
    const whole = e.altKey ? [] : instancesInRect(doc.value, r, copies.value);
    if (whole.length) { A.selectInstances([...(d.add ? UI.selectedInstances() : []), ...whole]); return; }
    const got = pointsInRectAll(doc.value, r), prev = UI.selection.value;
    const prevCopies = d.add && prev && prev.kind === 'points' ? prev.copies ?? {} : {};
    A.selectPoints([...(d.add ? UI.selectedPointIds() : []), ...got.ids], { ...prevCopies, ...got.copies });
    return;
  }
  if (d.kind === 'pt' && d.moved && d.snap && !d.via) { A.joinDroppedPoint(d.pointId, d.cell, d.snap.hit); return; }
  if (d.kind === 'canchor' && d.moved && d.snap) { joinThrough(copyMatrix(d.copy), d.pointId, d.cell, d.snap); return; }
  if (d.kind === 'pts' && d.moved && d.snap && d.grab) {
    const g = d.grab, others = d.ids.filter((id) => id !== g.pointId);
    if (g.via) joinThrough(P.viaMatrix(doc.value, g.via), g.pointId, g.cell, d.snap, others);
    else if (d.snap.hit.kind === 'node' || d.snap.hit.kind === 'curve') A.joinDroppedPoint(g.pointId, g.cell, d.snap.hit);
    return;
  }
  if (d.kind === 'body' && d.moved && d.snap) { joinBody(d.pathId, d.frame.G, d.snap, d.ids); return; }
  if (d.moved || !d.target) return;
  const t = d.target, s = UI.selection.value;
  switch (t.kind) {
    case 'point': if (e.shiftKey || UI.addToSelection.value) A.togglePointSelection(t.pointId, t.via); else A.selectPoints([t.pointId], t.via ? { [t.pointId]: t.via } : undefined); return;
    case 'segment':
      if (e.shiftKey || UI.addToSelection.value) { A.toggleInstance(t.pathId, t.copy); return; }
      if (s && s.kind === 'path' && s.id === t.pathId && sameCopy(s.copy, t.copy)) A.insertNodeOnSegment(t.pathId, t.j, w, t.copy, ctx.gridOn);
      else A.selectPathAt(t.pathId, t.copy);
      return;
    case 'canchor': A.selectPathAt(t.pathId, t.copy); return;
    case 'fill': A.selectFill(t.fillId); return;
    default:
  }
};
