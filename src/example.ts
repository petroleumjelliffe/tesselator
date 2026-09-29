import { emptyDoc } from './state/doc';
import * as P from './engine/paths';
import type { Doc } from './types';

// A wavy tile boundary cloned through a 180° turn, one fill, and a detail loop on a layer above.
export function exampleDoc(): Doc {
  const d = emptyDoc();
  d.layers[0].name = 'Outline';
  const outline = d.layers[0].id, detail = P.addLayer(d, 'Detail').id;
  const style = { color: '#1c1b18', weight: 2 };
  const r2 = P.addElement(d, { kind: 'rotate', u: 0.5, v: 0.5, n: 2 });
  d.newPathGroups = [[r2.id]];
  const o = P.addPoint(d, { u: 0, v: 0 });
  const top = P.startPath(d, o, style, outline);
  P.appendNode(d, top.id, P.addPoint(d, { u: 1, v: 0 }));
  P.setControlPointAbs(d, top.id, 0, { u: 0.5, v: 0.3 });
  P.addBinding(d, top.id, [[r2.id]]);
  const left = P.startPath(d, o, style, outline);
  P.appendNode(d, left.id, P.addPoint(d, { u: 0, v: 1 }));
  P.setControlPointAbs(d, left.id, 0, { u: -0.25, v: 0.5 });
  P.addBinding(d, left.id, [[r2.id]]);
  const eye = P.startPath(d, P.addPoint(d, { u: 0.375, v: 0.42 }), { color: '#c2255c', weight: 2 }, detail);
  P.appendNode(d, eye.id, P.addPoint(d, { u: 0.5, v: 0.42 }));
  P.appendNode(d, eye.id, eye.start);
  P.setControlPointAbs(d, eye.id, 0, { u: 0.44, v: 0.33 });
  P.setControlPointAbs(d, eye.id, 1, { u: 0.44, v: 0.51 });
  P.addFill(d, { u: 0.5, v: 0.62 }, '#c98a12', outline);
  return d;
}
