// Shared SVG path-data helpers for a poly-line-with-quadratic-curves path: used by the live
// Canvas render and by SVG export (serialize.ts) so both draw exactly the same geometry.
import type { XY } from '../types';

export const segD = (a: XY, b: XY, cp: XY | null) => (cp ? `M${a.x},${a.y} Q${cp.x},${cp.y} ${b.x},${b.y}` : `M${a.x},${a.y} L${b.x},${b.y}`);
export const pathD = (P: XY[], C: (XY | null)[]) => P.slice(1).map((b, j) => segD(P[j], b, C[j])).join(' ');
