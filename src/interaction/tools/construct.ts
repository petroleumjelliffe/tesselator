import * as UI from '../../state/ui';
import { startDrag, type ToolModule } from './common';
import type { HitTarget, XY } from '../../types';
export function startMultiDrag(_w: XY, _t: HitTarget | null, _e: PointerEvent): void {}
export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => { startDrag(e, t, w, ctx.hitScale, { kind: 'click' }); if (!t) UI.selection.value = null; };
export const onMove: ToolModule['onMove'] = () => {};
export const onUp: ToolModule['onUp'] = () => {};
