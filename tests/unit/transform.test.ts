import { test, expect } from 'vitest';
import { IDENTITY, translation, rotation, reflection, compose, invert, apply, power, cellMatrix, matrixOf, isLatticeTranslation, composite, orbit, classify, toSvg, mirrorAngle, mirrorDirFromAngle } from '../../src/engine/transform';
import { CONFIG } from '../../src/config';
import type { Element, XY } from '../../src/types';

const lat = CONFIG.LATTICE_PRESETS.Square, hex = CONFIG.LATTICE_PRESETS['Hex / triangle'], rh = CONFIG.LATTICE_PRESETS['Rhombus 60°'];
const near = (p: XY, q: XY) => { expect(p.x).toBeCloseTo(q.x, 6); expect(p.y).toBeCloseTo(q.y, 6); };
const mirror = (e: Element) => { if (e.kind !== 'mirror') throw new Error('not a mirror'); return e; };

test('primitive matrices move sample points correctly', () => {
  near(apply(translation(10, -5), { x: 1, y: 1 }), { x: 11, y: -4 });
  near(apply(rotation(Math.PI / 2, 100, 100), { x: 110, y: 100 }), { x: 100, y: 110 });
  near(apply(reflection(Math.PI / 2, 50, 0), { x: 60, y: 7 }), { x: 40, y: 7 });
  near(apply(reflection(0, 0, 20), { x: 3, y: 25 }), { x: 3, y: 15 });
});

test('compose applies B then A; invert undoes; power repeats', () => {
  const A = rotation(Math.PI / 3, 10, 10), B = translation(5, 0), p = { x: 1, y: 2 };
  near(apply(compose(A, B), p), apply(A, apply(B, p)));
  near(apply(compose(invert(A), A), p), p);
  near(apply(power(A, 6), p), p);
  expect(power(A, 0)).toEqual(IDENTITY);
});

const els: Element[] = [
  { id: 'r2', kind: 'rotate', u: 0.5, v: 0.5, n: 2 },
  { id: 'r3', kind: 'rotate', u: 1 / 3, v: 1 / 3, n: 3 },
  { id: 'r4', kind: 'rotate', u: 0, v: 0, n: 4 },
  { id: 'r6', kind: 'rotate', u: 0, v: 0, n: 6 },
  { id: 'r5', kind: 'rotate', u: 0, v: 0, n: 5 },
  { id: 'm', kind: 'mirror', u: 0, v: 0.5, du: 1, dv: 0 },
  { id: 'mb', kind: 'mirror', u: 0.5, v: 0, du: 0, dv: 1 },
  { id: 't12', kind: 'translate', u: 0.5, v: 0 },
  { id: 't13', kind: 'translate', u: 1 / 3, v: 0 },
  { id: 'tc', kind: 'translate', u: 0.5, v: 0.5 },
  { id: 't1', kind: 'translate', u: 1, v: 0 },
  { id: 't37', kind: 'translate', u: 0.37, v: 0 },
];

test('matrixOf builds each element kind in world space from lattice coordinates', () => {
  near(apply(matrixOf(els[7], lat), { x: 0, y: 0 }), { x: 120, y: 0 });
  near(apply(matrixOf(els[0], lat), { x: 0, y: 0 }), { x: 240, y: 240 });
  near(apply(matrixOf(els[6], lat), { x: 0, y: 5 }), { x: 240, y: 5 });      // mirror along b at u = 1/2 is the line x = 120
  near(apply(cellMatrix({ c: 1, r: -1 }, lat), { x: 0, y: 0 }), { x: 240, y: -240 });
  // on a skewed lattice, a mirror along b reflects across the line through L(0.5, 0) with direction b
  const M = matrixOf(els[6], rh);
  near(apply(M, { x: 120, y: 0 }), { x: 120, y: 0 });                          // on the line
  near(apply(M, { x: 120 + 120, y: 207.85 }), { x: 120 + 120, y: 207.85 });    // also on the line (one b along)
});

test('mirror angle round-trips through a lattice direction', () => {
  expect(mirrorAngle(mirror(els[6]), lat)).toBeCloseTo(90, 6);
  expect(mirrorAngle(mirror(els[6]), rh)).toBeCloseTo(60, 1);
  const d = mirrorDirFromAngle(45, lat);
  expect(d.du).toBeCloseTo(d.dv, 9);
});

test('isLatticeTranslation accepts integer lattice steps only', () => {
  expect(isLatticeTranslation(translation(240, -480), lat)).toBe(true);
  expect(isLatticeTranslation(translation(120, 0), lat)).toBe(false);
  expect(isLatticeTranslation(rotation(Math.PI, 0, 0), lat)).toBe(false);
  expect(isLatticeTranslation(IDENTITY, lat)).toBe(true);
});

test('orbit sizes match the spec table', () => {
  const n = (ops: string[], L = lat) => orbit(ops, els, L).matrices.length;
  expect(n(['r2'])).toBe(1);
  expect(n(['r3'], hex)).toBe(2);
  expect(n(['r4'])).toBe(3);
  expect(n(['r6'], hex)).toBe(5);
  expect(n(['m'])).toBe(1);
  expect(n(['m', 't12'])).toBe(1);
  expect(n(['m', 't13'])).toBe(5);   // odd powers are reflected copies, even powers translations; M⁶ is the first lattice translation
  expect(n(['t12'])).toBe(1);
  expect(n(['tc'])).toBe(1);
  expect(n(['t1'])).toBe(0);
  expect(n(['r2', 't12'])).toBe(1);
  expect(n([])).toBe(0);
  expect(orbit([], els, lat).open).toBe(false);
});

test('a 5-fold rotation still closes (R⁵ is the identity); a translation by 0.37 never does and is capped open', () => {
  expect(orbit(['r5'], els, lat).matrices).toHaveLength(4);
  const o = orbit(['t37'], els, lat, 12);
  expect(o.matrices).toHaveLength(12); expect(o.open).toBe(true);
});

test('composite applies ops left to right', () => {
  const p = { x: 10, y: 20 };
  near(apply(composite(['m', 't12'], els, lat), p), apply(matrixOf(els[7], lat), apply(matrixOf(els[5], lat), p)));
});

test('classify recognises each isometry', () => {
  expect(classify(IDENTITY).kind).toBe('identity');
  expect(classify(translation(3, 4)).kind).toBe('translation');
  const rot = classify(compose(matrixOf(els[0], lat), matrixOf(els[7], lat)));
  expect(rot.kind).toBe('rotation');
  if (rot.kind === 'rotation') near(rot.center, { x: 60, y: 120 });
  const g = classify(composite(['m', 't12'], els, lat));
  expect(g.kind).toBe('glide');
  if (g.kind === 'glide') expect(Math.abs(g.slide)).toBeCloseTo(120, 6);
  expect(classify(matrixOf(els[5], lat)).kind).toBe('reflection');
});

test('toSvg formats a matrix attribute', () => {
  expect(toSvg(translation(1, 2))).toBe('matrix(1 0 0 1 1 2)');
});
