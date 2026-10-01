// Pen: every click goes through drawSnap (spec D14), whatever it hit, so the same-layer rule and the path's own targets
// apply (O2, I1). A press on a point or clone anchor can still become a drag of that node; a click on the path's last
// node ends the path.
import { doc } from '../../state/doc';
import * as UI from '../../state/ui';
import * as A from '../../actions';
import * as P from '../../engine/paths';
import * as select from './select';
import { startDrag, type ToolModule } from './common';

export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => {
  if (t && (t.kind === 'point' || t.kind === 'canchor')) { select.onDown(t, w, e, ctx); return; }   // a click, or a node drag
  if (t && UI.selection.value && !UI.pen.value) UI.selection.value = null;                             // a hit starts drawing at once
  A.penClickEmpty(w, ctx.snapOn, ctx.hitScale);
  startDrag(e, t, w, ctx.hitScale, { kind: 'click' });
};

export const onMove: ToolModule['onMove'] = (d, w, e, ctx) => { select.onMove(d, w, e, ctx); };

export const onUp: ToolModule['onUp'] = (d, w, e, ctx) => {
  UI.cursor.value = null;
  if (d.moved) { if (d.kind === 'pt' || d.kind === 'canchor') select.onUp(d, w, e, ctx); return; }
  const t = d.target;
  if (!t || (t.kind !== 'point' && t.kind !== 'canchor')) return;
  const pn = UI.pen.value, path = pn && P.getPath(doc.value, pn.pathId);
  if (path && t.kind === 'point') {
    const nodes = P.pathNodes(path);
    if (P.sameNode(nodes[nodes.length - 1], { pointId: t.pointId, cell: t.cell, ...(t.via ? { via: t.via } : {}) })) { A.endPen(); return; }
  }
  if (!pn) UI.selection.value = null;
  A.penClickEmpty(d.start, ctx.snapOn, ctx.hitScale);   // H6: the snap at the press, as the hint showed it
};
