// The canvas cursor for the hovered target, the tool and the layer (moved out of Canvas.tsx so it can be tested).
// E6a: the rotate zone outside a box corner shows a rotate cursor, an inline SVG (CSS has no rotate cursor).
import * as UI from '../state/ui';
import type { HitTarget } from '../types';

const ROTATE_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>"
  + "<path d='M19 12a7 7 0 1 1-2.05-4.95' fill='none' stroke='white' stroke-width='4'/>"
  + "<path d='M19 12a7 7 0 1 1-2.05-4.95' fill='none' stroke='black' stroke-width='2'/>"
  + "<path d='M18 3v5h-5' fill='none' stroke='black' stroke-width='2'/></svg>";
export const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(ROTATE_SVG)}") 12 12, alias`;
const BBOX_CURSORS = ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize', 'ns-resize', 'ns-resize', 'ew-resize', 'ew-resize'];

export function cursorFor(h: HitTarget | null = UI.hover.value): string {
  if (UI.space.value && UI.pen.value) return 'grab';
  if (UI.layer.value === 'construction') return h ? (h.kind === 'elrot' || h.kind === 'eltip' ? 'grab' : 'move') : 'default';
  if (h && h.kind === 'bbox') return BBOX_CURSORS[h.h];
  if (h && h.kind === 'bboxrot') return ROTATE_CURSOR;
  if (h && h.kind === 'diamond') return 'grab';
  if (h && (h.kind === 'point' || h.kind === 'segment' || h.kind === 'canchor' || h.kind === 'fill')) return 'pointer';
  return UI.tool.value === 'select' || UI.tool.value === 'fill' ? 'default' : 'crosshair';
}
