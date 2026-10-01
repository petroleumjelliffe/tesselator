import * as UI from '../../state/ui';
import * as A from '../../actions';
import * as select from './select';
import { startDrag, type ToolModule } from './common';

export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => {
  if (t && (t.kind === 'point' || t.kind === 'canchor' || t.kind === 'diamond')) { select.onDown(t, w, e, ctx); return; }
  if (t && t.kind === 'segment') { startDrag(e, t, w, ctx.hitScale, { kind: 'click' }); return; }
  A.penClickEmpty(w, ctx.snapOn, ctx.hitScale);
  startDrag(e, t, w, ctx.hitScale, { kind: 'click' });
};

export const onMove: ToolModule['onMove'] = (d, w, e, ctx) => { select.onMove(d, w, e, ctx); };

export const onUp: ToolModule['onUp'] = (d, w, e, ctx) => {
  if (d.kind === 'pt' && d.moved && d.snap && !d.via) { A.joinDroppedPoint(d.pointId, d.cell, d.snap.hit); UI.cursor.value = null; return; }
  if (d.moved || !d.target) return;
  if (d.target.kind === 'point') A.penClickNode({ pointId: d.target.pointId, cell: d.target.cell, ...(d.target.via ? { via: d.target.via } : {}) });
  else if (d.target.kind === 'canchor') A.penClickNode({ pointId: d.target.pointId, cell: d.target.cell, via: { cell: { ...d.target.copy.cell }, bindingId: d.target.copy.bindingId!, power: d.target.copy.power } });   // clone anchors only exist for clone copies
  else if (d.target.kind === 'segment') A.penClickSegment(d.target.pathId, d.target.j, d.target.copy, w, ctx.snapOn, ctx.hitScale);
  UI.cursor.value = null;
};
