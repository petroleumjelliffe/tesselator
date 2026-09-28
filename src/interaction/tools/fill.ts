import { startDrag, type ToolModule } from './common';
export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => { startDrag(e, t, w, ctx.hitScale, { kind: 'click' }); };
export const onMove: ToolModule['onMove'] = () => {};
export const onUp: ToolModule['onUp'] = () => {};
