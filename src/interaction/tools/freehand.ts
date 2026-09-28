// Freehand: press and drag; the stroke is fitted on release (actions.finishFreehand).
import { doc } from '../../state/doc';
import * as A from '../../actions';
import * as P from '../../engine/paths';
import { orbit } from '../../engine/transform';
import { CONFIG } from '../../config';
import { startDrag, type ToolModule } from './common';
import type { Node, Matrix } from '../../types';

// Ghost the stroke through the extended path's bindings, else through the chains new paths receive.
function previewMatrices(startNode: Node | null): Matrix[] {
  const d = doc.value;
  const extendId = startNode ? P.openEndAt(d, startNode.pointId) : null;
  const chains = extendId ? d.bindings.filter((b) => b.pathId === extendId).map((b) => b.ops) : d.newPathOps;
  return chains.flatMap((ops) => orbit(ops, d.elements, d.lattice, CONFIG.ORBIT_CAP).matrices);
}

export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => {
  let startNode: Node | null = null, start = w;
  if (t && t.kind === 'point') { startNode = { pointId: t.pointId, cell: t.cell }; start = P.nodeWorld(doc.value, startNode); }
  startDrag(e, t, start, ctx.hitScale, { kind: 'free', raw: [{ x: start.x, y: start.y }], startNode, cloneMatrices: previewMatrices(startNode) });
};

export const onMove: ToolModule['onMove'] = (d, w) => {
  if (d.kind !== 'free') return;
  const last = d.raw[d.raw.length - 1];
  if (Math.hypot(w.x - last.x, w.y - last.y) < 1.5) return;
  d.raw.push({ x: w.x, y: w.y });
};

export const onUp: ToolModule['onUp'] = (d) => { if (d.kind === 'free') A.finishFreehand(d); };
