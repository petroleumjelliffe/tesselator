// Freehand: press and drag; the start snaps on press, the end is hinted live and snaps on release (spec D3, D4).
import { doc } from '../../state/doc';
import * as UI from '../../state/ui';
import * as A from '../../actions';
import * as P from '../../engine/paths';
import { orbit } from '../../engine/transform';
import { CONFIG } from '../../config';
import { startDrag, type ToolModule } from './common';
import type { Node, Matrix } from '../../types';

// The groups the stroke's clones come from: the extended path's bindings, else the groups new paths receive.
function groupsFor(startNode: Node | null): string[][][] {
  const d = doc.value;
  const extendId = startNode && !startNode.via ? P.openEndAt(d, startNode.pointId) : null;   // as finishFreehand: a via start never extends a path
  return extendId ? d.bindings.filter((b) => b.pathId === extendId).map((b) => b.groups) : [d.newPathGroups];
}

export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => {
  let startNode: Node | null = null, start = w;
  let startSnap = null;
  if (t && t.kind === 'point') { startNode = { pointId: t.pointId, cell: t.cell, ...(t.via ? { via: t.via } : {}) }; start = P.nodeWorld(doc.value, startNode); }
  else { startSnap = A.drawSnap(w, ctx.snapOn, ctx.hitScale, null); if (startSnap) start = startSnap.at; }
  const groups = groupsFor(startNode), d = doc.value;
  const cloneMatrices = groups.flatMap((g) => orbit(g, d.elements, d.lattice, CONFIG.ORBIT_CAP, CONFIG.CLONE_CAP).matrices.filter((M): M is Matrix => M !== null));
  startDrag(e, t, start, ctx.hitScale, { kind: 'free', raw: [{ x: start.x, y: start.y }], startNode, startSnap, groups, cloneMatrices, end: null, pin: null, cooldown: null });
  UI.snapSticky.value = null;
};

export const onMove: ToolModule['onMove'] = (d, w, _e, ctx) => {
  if (d.kind !== 'free') return;
  const last = d.raw[d.raw.length - 1];
  if (Math.hypot(w.x - last.x, w.y - last.y) >= 1.5) d.raw.push({ x: w.x, y: w.y });
  const s = A.drawSnap(w, ctx.snapOn, ctx.hitScale, { pts: d.raw, groups: d.groups });
  d.end = s && s.cat !== 'grid' ? s : null;
  UI.snapSticky.value = d.end?.id ?? null;
  UI.snapHint.value = A.hintOf(d.end);
};

export const onUp: ToolModule['onUp'] = (d, w, _e, ctx) => {
  if (d.kind !== 'free') return;
  const end = A.drawSnap(w, ctx.snapOn, ctx.hitScale, { pts: d.raw, groups: d.groups });   // H6: the held snap is the snap used
  A.finishFreehand(d, end);
};
