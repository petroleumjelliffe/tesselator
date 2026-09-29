import { test, expect } from 'vitest';
import * as P from '../../src/engine/paths';
import { computeFaces, faceAt, seedFor, facePathData, collectSegments, subCurve, faceContains, sameRegion } from '../../src/engine/regions';
import { CONFIG } from '../../src/config';
import type { Doc, UV } from '../../src/types';

const style = { color: '#000', weight: 2 };
function makeDoc(): Doc { return { version: 2, lattice: { ...CONFIG.LATTICE_PRESETS.Square }, points: [], paths: [], elements: [], bindings: [], fills: [], layers: [{ id: 'L1', name: 'Layer 1' }], newPathGroups: [] }; }
function polyline(doc: Doc, pts: UV[], close = false) {
  const nodes = pts.map((p) => P.addPoint(doc, p));
  const path = P.startPath(doc, nodes[0], style, 'L1');
  for (const n of nodes.slice(1)) P.appendNode(doc, path.id, n);
  if (close) P.appendNode(doc, path.id, nodes[0]);
  return path;
}
const S = (x: number) => x / 240;
const square = (doc: Doc, x0 = 60, y0 = 60, x1 = 180, y1 = 180) =>
  polyline(doc, [{ u: S(x0), v: S(y0) }, { u: S(x1), v: S(y0) }, { u: S(x1), v: S(y1) }, { u: S(x0), v: S(y1) }], true);

test('a closed square gives one face per cell copy; outside points find nothing', () => {
  const doc = makeDoc(); square(doc);
  const faces = computeFaces(doc);
  expect(faces).toHaveLength(9);
  const f = faceAt(faces, { x: 120, y: 120 })!;
  expect(f.area).toBeCloseTo(14400, 6);
  expect(f.centroid.x).toBeCloseTo(120, 6);
  expect(faceAt(faces, { x: 30, y: 30 })).toBe(null);
  expect(faceAt(faces, { x: 5000, y: 5000 })).toBe(null);
});

test('two crossing lines inside a square make four faces', () => {
  const doc = makeDoc(); square(doc);
  polyline(doc, [{ u: S(60), v: S(120) }, { u: S(180), v: S(120) }]);
  polyline(doc, [{ u: S(120), v: S(60) }, { u: S(120), v: S(180) }]);
  const faces = computeFaces(doc);
  expect(faces).toHaveLength(36);
  expect(faceAt(faces, { x: 90, y: 90 })!.area).toBeCloseTo(3600, 6);
});

test('a dangling stroke inside a face does not split it', () => {
  const doc = makeDoc(); square(doc);
  polyline(doc, [{ u: S(120), v: S(120) }, { u: S(150), v: S(150) }]);
  const faces = computeFaces(doc);
  expect(faces).toHaveLength(9);
  expect(faceAt(faces, { x: 70, y: 70 })!.area).toBeCloseTo(14400, 6);
});

test('clone edges from a 180° rotation close regions with the source edges', () => {
  const doc = makeDoc();
  const top = polyline(doc, [{ u: 0, v: 0 }, { u: 1, v: 0 }]);
  const left = polyline(doc, [{ u: 0, v: 0 }, { u: 0, v: 1 }]);
  polyline(doc, [{ u: 0, v: 0 }, { u: 1, v: 1 }]);
  const r2 = P.addElement(doc, { kind: 'rotate', u: 0.5, v: 0.5, n: 2 });
  P.addBinding(doc, top.id, [[r2.id]]); P.addBinding(doc, left.id, [[r2.id]]);
  const faces = computeFaces(doc);
  expect(faces).toHaveLength(18);
  expect(faceAt(faces, { x: 60, y: 180 })!.area).toBeCloseTo(28800, 6);
  expect(faceAt(faces, { x: 180, y: 60 })!.area).toBeCloseTo(28800, 6);
});

test('a face straddling the cell edge is found once per copy', () => {
  const doc = makeDoc();
  square(doc, 180, 60, 300, 180);
  const faces = computeFaces(doc);
  expect(faces.filter((f) => f.outer.poly.some((p) => Math.abs(p.x - 240) < 1e-6))).toHaveLength(0);
  expect(faceAt(faces, { x: 240, y: 120 })!.area).toBeCloseTo(14400, 6);
  expect(faceAt(faces, { x: 0, y: 120 })!.area).toBeCloseTo(14400, 6);
});

test('coincident edges from a mirror on the path are deduplicated', () => {
  const doc = makeDoc();
  const sq = square(doc);
  const m = P.addElement(doc, { kind: 'mirror', u: 0.5, v: 0, du: 0, dv: 1 });
  P.addBinding(doc, sq.id, [[m.id]]);
  const faces = computeFaces(doc);
  expect(faces).toHaveLength(9);
  expect(faceAt(faces, { x: 120, y: 120 })!.area).toBeCloseTo(14400, 6);
});

test('a closed loop inside a face becomes its hole', () => {
  const doc = makeDoc();
  square(doc); square(doc, 100, 100, 140, 140);
  const faces = computeFaces(doc);
  expect(faces).toHaveLength(18);
  const outer = faceAt(faces, { x: 70, y: 70 })!;
  expect(outer.holes).toHaveLength(1);
  expect(outer.area).toBeCloseTo(14400, 6);
  const inner = faceAt(faces, { x: 120, y: 120 })!;
  expect(inner.area).toBeCloseTo(1600, 6);
  expect(inner.holes).toHaveLength(0);
  expect(facePathData(outer).split('M')).toHaveLength(3);        // two subpaths
  expect(faceContains(outer, { x: 120, y: 120 })).toBe(false);   // in the hole
});

test('seedFor uses the centroid when it lies inside, else the click', () => {
  const doc = makeDoc();
  square(doc);
  const sq = faceAt(computeFaces(doc), { x: 70, y: 70 })!;
  expect(seedFor(sq, { x: 70, y: 70 })).toEqual(sq.centroid);
  const doc2 = makeDoc();   // a U shape: top bar plus two legs, notch open at the bottom; its centroid falls in the notch
  polyline(doc2, [{ u: S(0), v: S(0) }, { u: S(100), v: S(0) }, { u: S(100), v: S(100) }, { u: S(70), v: S(100) }, { u: S(70), v: S(30) }, { u: S(30), v: S(30) }, { u: S(30), v: S(100) }, { u: S(0), v: S(100) }], true);
  const u = faceAt(computeFaces(doc2), { x: 15, y: 60 })!;       // inside the left leg
  expect(faceContains(u, u.centroid)).toBe(false);
  expect(seedFor(u, { x: 15, y: 60 })).toEqual({ x: 15, y: 60 });
});

test('a curved face is rebuilt from exact sub-curves', () => {
  const seg = { a: { x: 0, y: 0 }, cp: { x: 50, y: 100 }, b: { x: 100, y: 0 }, source: { pathId: 'p', copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 }, j: 0 } };
  const left = subCurve(seg, 0, 0.5), right = subCurve(seg, 0.5, 1);
  expect(left.b).toEqual({ x: 50, y: 50 }); expect(left.cp).toEqual({ x: 25, y: 50 }); expect(right.cp).toEqual({ x: 75, y: 50 });
  const doc = makeDoc();
  const path = polyline(doc, [{ u: S(60), v: S(60) }, { u: S(180), v: S(60) }], true);
  P.setControlPointAbs(doc, path.id, 0, { u: S(120), v: 0 });
  P.setControlPointAbs(doc, path.id, 1, { u: S(120), v: S(120) });
  const faces = computeFaces(doc);
  const f = faceAt(faces, { x: 120, y: 60 })!;
  expect(f).toBeTruthy();
  const d = facePathData(f);
  expect(d).toMatch(/^M/); expect(d).toMatch(/Q/); expect(d).toMatch(/Z$/);
});

test('computeFaces is memoised per document reference', () => {
  const doc = makeDoc(); square(doc);
  const a = computeFaces(doc);
  expect(computeFaces(doc)).toBe(a);
  expect(computeFaces({ ...doc })).not.toBe(a);
});

test('collectSegments skips zero-length segments', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0, v: 0 }, { u: 0.1, v: 0 }]);
  doc.points.push({ id: 'dup', u: 0.1, v: 0 });
  path.segments.push({ to: { pointId: 'dup', cell: { c: 0, r: 0 } }, cp: null });
  expect(collectSegments(doc)).toHaveLength(9);
});

test('a curved chord through a square splits it in two (straight x curve crossings)', () => {
  const doc = makeDoc(); square(doc);
  const chord = polyline(doc, [{ u: S(30), v: S(120) }, { u: S(210), v: S(120) }]);   // endpoints outside the square
  P.setControlPointAbs(doc, chord.id, 0, { u: S(120), v: S(60) });                    // apex at y = 90, inside the square
  const faces = computeFaces(doc);
  expect(faces).toHaveLength(18);
  const above = faceAt(faces, { x: 120, y: 70 })!, below = faceAt(faces, { x: 120, y: 150 })!;
  expect(above).toBeTruthy(); expect(below).toBeTruthy();
  expect(above.area + below.area).toBeCloseTo(14400, 0);
  expect(facePathData(above)).toMatch(/Q/);
});

test('two curves crossing twice enclose a lens (curve x curve crossings)', () => {
  const doc = makeDoc();
  const a = polyline(doc, [{ u: S(40), v: S(100) }, { u: S(200), v: S(100) }]);
  P.setControlPointAbs(doc, a.id, 0, { u: S(120), v: S(20) });    // bows up to y = 60
  const b = polyline(doc, [{ u: S(40), v: S(60) }, { u: S(200), v: S(60) }]);
  P.setControlPointAbs(doc, b.id, 0, { u: S(120), v: S(140) });   // bows down to y = 100
  const faces = computeFaces(doc);
  expect(faces).toHaveLength(9);
  const lens = faceAt(faces, { x: 120, y: 80 })!;
  expect(lens).toBeTruthy();
  expect(lens.area).toBeGreaterThan(0);
  expect(faceAt(faces, { x: 120, y: 30 })).toBe(null);
});

test('faces do not depend on which layer a fill or path is on', () => {
  const doc = makeDoc(); square(doc);
  const top = P.addLayer(doc);
  const before = computeFaces(doc).map((f) => [f.area, f.centroid.x, f.centroid.y]);
  const moved = structuredClone(doc);
  moved.paths[0].layerId = top.id;
  P.addFill(moved, { u: 0.5, v: 0.5 }, '#f00', top.id);
  expect(computeFaces(moved).map((f) => [f.area, f.centroid.x, f.centroid.y])).toEqual(before);
});

test('sameRegion identifies the window copies of one region and separates distinct regions', () => {
  const doc = makeDoc();
  square(doc, 180, 60, 300, 180); square(doc, 60, 60, 100, 100);
  const faces = computeFaces(doc), lat = doc.lattice;
  const left = faceAt(faces, { x: 200, y: 120 })!, right = faceAt(faces, { x: 250, y: 120 })!, wrapped = faceAt(faces, { x: 10, y: 120 })!;
  expect(left).toBe(right);                                  // same copy: the face straddling x = 240
  expect(wrapped).not.toBe(left);                            // the copy in cell (-1, 0)
  expect(sameRegion(left, wrapped, lat)).toBe(true);
  expect(sameRegion(left, faceAt(faces, { x: 80, y: 80 })!, lat)).toBe(false);
});
