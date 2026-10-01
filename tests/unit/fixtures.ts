import * as P from '../../src/engine/paths';
import { CONFIG } from '../../src/config';
import type { Doc, UV } from '../../src/types';

export function makeDoc(): Doc { return { version: 2, lattice: { ...CONFIG.LATTICE_PRESETS.Square }, points: [], paths: [], elements: [], bindings: [], fills: [], layers: [{ id: 'L1', name: 'Layer 1' }], newPathGroups: [] }; }
export function line(d: Doc, pts: UV[], closed = false, layerId = 'L1') {
  const n0 = P.addPoint(d, pts[0]);
  const p = P.startPath(d, n0, { color: '#000', weight: 2 }, layerId);
  for (const uv of pts.slice(1)) P.appendNode(d, p.id, P.addPoint(d, uv));
  if (closed) P.appendNode(d, p.id, { pointId: n0.pointId, cell: { ...n0.cell } });
  return p;
}
