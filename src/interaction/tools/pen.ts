import * as UI from '../../state/ui';
import * as A from '../../actions';
import * as select from './select';
import { startDrag, type ToolModule } from './common';

export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => {
  if (t && (t.kind === 'point' || t.kind === 'canchor' || t.kind === 'diamond')) { select.onDown(t, w, e, ctx); return; }
  A.penClickEmpty(w, ctx.snapOn, ctx.hitScale);
  startDrag(e, t, w, ctx.hitScale, { kind: 'click' });
};

export const onMove: ToolModule['onMove'] = (d, w, e, ctx) => { select.onMove(d, w, e, ctx); };

export const onUp: ToolModule['onUp'] = (d) => {
  if (d.moved || !d.target) return;
  if (d.target.kind === 'point') A.penClickNode({ pointId: d.target.pointId, cell: d.target.cell });
  else if (d.target.kind === 'canchor') A.penClickNode({ pointId: d.target.pointId, cell: d.target.cell });
  UI.cursor.value = null;
};
