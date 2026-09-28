// Fill: press to preview the region under the pointer, release to seed or recolour it.
import * as UI from '../../state/ui';
import * as A from '../../actions';
import { startDrag, type ToolModule } from './common';

export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => {
  startDrag(e, t, w, ctx.hitScale, { kind: 'fillpress' });
  UI.fillPreview.value = w;
};

export const onMove: ToolModule['onMove'] = (d, w) => { if (d.kind === 'fillpress') UI.fillPreview.value = w; };

export const onUp: ToolModule['onUp'] = (d, w) => {
  UI.fillPreview.value = null;
  if (d.kind === 'fillpress') A.fillAt(w);
};
