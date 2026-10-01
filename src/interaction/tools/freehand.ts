// Freehand: press and drag; the start snaps on press, the end is hinted live and snaps on release (spec D3, D4).
import { doc } from '../../state/doc';
import * as UI from '../../state/ui';
import * as A from '../../actions';
import { orbit } from '../../engine/transform';
import { pickSnap } from '../../engine/snap';
import { snapTargets } from '../../state/derived';
import { CONFIG } from '../../config';
import { startDrag, type ToolModule } from './common';
import type { Matrix, XY, Drag, SnapCat } from '../../types';

const TRACE_CATS: ReadonlySet<SnapCat> = new Set<SnapCat>(['edge', 'axis', 'line']);
const nearestOnPolyline = (pl: XY[], p: XY): { q: XY; d: number } => {
  let best = { q: pl[0], d: Infinity };
  for (let i = 0; i + 1 < pl.length; i++) {
    const a = pl[i], b = pl[i + 1], dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)), q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.d) best = { q, d };
  }
  return best;
};

// Spec §6.6: while Alt is held the stroke follows the nearest line (tile edge, mirror axis, or any path's line on any
// layer) within the threshold, projecting each point onto it. Beyond the breakaway it lets go, and the same line cannot
// re-pin until the pointer has been twice the breakaway away. Returns the point to record.
export function traceStep(d: Extract<Drag, { kind: 'free' }>, w: XY, alt: boolean, threshold: number, breakaway: number): XY {
  if (d.cooldown && nearestOnPolyline(d.cooldown.geom, w).d > 2 * breakaway) d.cooldown = null;
  if (!alt) { d.pin = null; return w; }
  if (!d.pin) {
    const s = pickSnap(snapTargets.value, w, threshold, { linesOnly: true, cats: TRACE_CATS });
    if (s && s.line && s.id !== d.cooldown?.id) d.pin = { id: s.id, geom: s.line };
  }
  if (!d.pin) return w;
  const r = nearestOnPolyline(d.pin.geom, w);
  if (r.d > breakaway) { d.cooldown = d.pin; d.pin = null; return w; }
  return r.q;
}

// Spec D3, D5, O2: the start is the snap at the press, like any drawing point. It extends a path only when it lands on a
// plain open end of a path on the active layer; otherwise the new path starts there (a same-layer join or location only,
// decided by nodeForSnap at the end). The stroke's clones come from the extended path's bindings, else the new-path groups.
export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => {
  const d = doc.value, startSnap = A.drawSnap(w, ctx.snapOn, ctx.hitScale, null), ext = A.extendTarget(d, startSnap);
  const start = startSnap ? startSnap.at : w;
  const groups = ext ? d.bindings.filter((b) => b.pathId === ext.pathId).map((b) => b.groups) : [d.newPathGroups];
  const cloneMatrices = groups.flatMap((g) => orbit(g, d.elements, d.lattice, CONFIG.ORBIT_CAP, CONFIG.CLONE_CAP).matrices.filter((M): M is Matrix => M !== null));
  startDrag(e, t, start, ctx.hitScale, { kind: 'free', raw: [{ x: start.x, y: start.y }], startNode: ext?.node ?? null, startSnap, groups, cloneMatrices, end: null, pin: null, cooldown: null });
  UI.snapSticky.value = null;
};

export const onMove: ToolModule['onMove'] = (d, w, e, ctx) => {
  if (d.kind !== 'free') return;
  const k = UI.view.value.zoom, p = traceStep(d, w, e.altKey, ctx.threshold, (CONFIG.TRACE_BREAKAWAY_PX * ctx.hitScale) / k);
  const last = d.raw[d.raw.length - 1];
  if (Math.hypot(p.x - last.x, p.y - last.y) >= 1.5) d.raw.push({ x: p.x, y: p.y });
  if (d.pin) { UI.snapHint.value = { at: p, line: d.pin.geom }; d.end = null; return; }
  const s = A.drawSnap(w, ctx.snapOn, ctx.hitScale, A.freeStroke(d));
  d.end = s && s.cat !== 'grid' ? s : null;
  UI.snapSticky.value = d.end?.id ?? null;
  UI.snapHint.value = A.hintOf(d.end);
};

export const onUp: ToolModule['onUp'] = (d, w, _e, ctx) => {
  if (d.kind !== 'free') return;
  const end = A.drawSnap(w, ctx.snapOn, ctx.hitScale, A.freeStroke(d));   // H6: the held snap is the snap used
  A.finishFreehand(d, end);
};
