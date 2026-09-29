// Freehand: press and drag; the stroke is fitted on release (actions.finishFreehand).
import { doc } from '../../state/doc';
import * as A from '../../actions';
import * as P from '../../engine/paths';
import { orbit } from '../../engine/transform';
import { CONFIG } from '../../config';
import { startDrag, type ToolModule } from './common';
import type { Node, Matrix } from '../../types';

// Ghost the stroke through the extended path's bindings, else through the binding a new path would get.
function previewMatrices(startNode: Node | null): Matrix[] {
  const d = doc.value;
  const extendId = startNode && !startNode.via ? P.openEndAt(d, startNode.pointId) : null;   // as finishFreehand: a via start never extends a path
  const groupsList = extendId ? d.bindings.filter((b) => b.pathId === extendId).map((b) => b.groups) : [d.newPathGroups];
  return groupsList.flatMap((g) => orbit(g, d.elements, d.lattice, CONFIG.ORBIT_CAP, CONFIG.CLONE_CAP).matrices.filter((M): M is Matrix => M !== null));
}

export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => {
  let startNode: Node | null = null, start = w;
  if (t && t.kind === 'point') { startNode = { pointId: t.pointId, cell: t.cell, ...(t.via ? { via: t.via } : {}) }; start = P.nodeWorld(doc.value, startNode); }
  startDrag(e, t, start, ctx.hitScale, { kind: 'free', raw: [{ x: start.x, y: start.y }], startNode, cloneMatrices: previewMatrices(startNode) });
};

export const onMove: ToolModule['onMove'] = (d, w) => {
  if (d.kind !== 'free') return;
  const last = d.raw[d.raw.length - 1];
  if (Math.hypot(w.x - last.x, w.y - last.y) < 1.5) return;
  d.raw.push({ x: w.x, y: w.y });
};

export const onUp: ToolModule['onUp'] = (d) => { if (d.kind === 'free') A.finishFreehand(d); };
