import { test, expect } from 'vitest';
import { IDENTITY, translation, rotation, reflection, compose, invert, apply, power, cellMatrix, matrixOf, isLatticeTranslation, composite, orbit, ownClones, cloneCount, classify, toSvg, mirrorAngle, mirrorDirFromAngle, clonePowers } from '../../src/engine/transform';
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

test('one-group orbits match the original spec table', () => {
  const n = (ops: string[], L = lat) => cloneCount(orbit([ops], els, L));
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
  expect(orbit([], els, lat)).toEqual({ matrices: [], open: false });
  expect(orbit([[]], els, lat)).toEqual({ matrices: [], open: false });
  expect(ownClones(['r4'], els, lat).matrices).toHaveLength(3);
});

test('a 5-fold rotation still closes (R⁵ is the identity); a translation by 0.37 never does and is capped open', () => {
  expect(cloneCount(orbit([['r5']], els, lat))).toBe(4);
  const o = orbit([['t37']], els, lat, 12);
  expect(cloneCount(o)).toBe(12); expect(o.open).toBe(true);
});

const grp: Element[] = [
  { id: 'ma', kind: 'mirror', u: 0.5, v: 0.5, du: 1, dv: 0 },     // along a through the centre
  { id: 'mb', kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 },     // along b through the centre
  { id: 'md', kind: 'mirror', u: 0.5, v: 0.5, du: 1, dv: 1 },     // diagonal through the centre
  { id: 'ga', kind: 'mirror', u: 0, v: 0.5, du: 1, dv: 0 },       // mirror along a at v = 1/2 …
  { id: 'ta', kind: 'translate', u: 0.5, v: 0 },                  // … plus half a = glide
  { id: 'tb', kind: 'translate', u: 0, v: 0.5 },
  { id: 'r2', kind: 'rotate', u: 0.5, v: 0.5, n: 2 },
  { id: 'r2b', kind: 'rotate', u: 0.5, v: 0.5, n: 2 },
  { id: 'r6', kind: 'rotate', u: 0, v: 0, n: 6 },
  { id: 'mh', kind: 'mirror', u: 0, v: 0, du: 1, dv: 0 },
  { id: 'r2x', kind: 'rotate', u: 1, v: 0.5, n: 2 },              // half-turn about (1, 1/2) = T(a) ∘ r2 on the square lattice
];

test('group products match the amendment table', () => {
  const n = (groups: string[][], L = lat) => cloneCount(orbit(groups, grp, L));
  expect(n([['ga', 'ta']])).toBe(1);
  expect(n([['ga', 'ta'], ['mb']])).toBe(3);
  expect(n([['ma'], ['mb'], ['md']])).toBe(7);          // the corner-mirror group of order 8
  expect(n([['r6'], ['mh']], hex)).toBe(11);
  expect(n([['ma'], ['ma']])).toBe(1);                  // same element twice dedups
  expect(n([['r2'], ['r2b']])).toBe(1);                 // second group's clone coincides with the first, mod lattice
  expect(n([['ta'], ['tb']])).toBe(3);
});

test('clone indices are mixed-radix, stable under appending a group, and null slots mark deduplicated clones', () => {
  const one = orbit([['ma']], grp, lat), two = orbit([['ma'], ['tb']], grp, lat);
  expect(two.matrices[0]).toEqual(one.matrices[0]);                                // index 1 unchanged
  expect(two.matrices).toHaveLength(3);
  near(apply(two.matrices[2]!, { x: 10, y: 20 }), apply(matrixOf(grp[5], lat), apply(matrixOf(grp[0], lat), { x: 10, y: 20 })));   // index 3 = tb ∘ ma
  const dup = orbit([['ma'], ['ma']], grp, lat);
  expect(dup.matrices).toEqual([dup.matrices[0], null, null]);                     // (0,1) equals (1,0); (1,1) is the identity
  expect(dup.matrices[0]).not.toBe(null);
});

test('clonePowers decodes a clone index into per-group powers, group 1 least significant', () => {
  expect(clonePowers([['ma'], ['tb']], grp, lat, 1)).toEqual([1, 0]);
  expect(clonePowers([['ma'], ['tb']], grp, lat, 2)).toEqual([0, 1]);
  expect(clonePowers([['ma'], ['tb']], grp, lat, 3)).toEqual([1, 1]);
  expect(clonePowers([['ma'], ['tb']], grp, lat, 0)).toEqual([0, 0]);      // the source / out of range decode to all zeros
  expect(clonePowers([['ma'], ['tb']], grp, lat, 4)).toEqual([0, 0]);
  expect(clonePowers([['r6'], ['mh']], grp, hex, 7)).toEqual([1, 1]);     // radix 6 then 2
});

test('the product is truncated at the clone cap in index order and reported open', () => {
  const many: Element[] = [
    { id: 'a', kind: 'rotate', u: 0, v: 0, n: 6 }, { id: 'b', kind: 'rotate', u: 0.5, v: 0.5, n: 6 }, { id: 'c', kind: 'rotate', u: 1 / 3, v: 1 / 3, n: 6 },
  ];
  const o = orbit([['a'], ['b'], ['c']], many, hex, 12, 48);
  expect(o.matrices).toHaveLength(48);
  expect(o.open).toBe(true);
  const small = orbit([['a'], ['b'], ['c']], many, hex, 12, 5);
  expect(small.matrices).toHaveLength(5); expect(small.open).toBe(true);
});

test('two clones that differ by a nonzero lattice translation are one clone; an exact-fit cap is not open', () => {
  const o = orbit([['r2'], ['r2x']], grp, lat);
  expect(o.matrices).toHaveLength(3);
  expect(o.matrices[0]).not.toBe(null);
  expect(o.matrices[1]).toBe(null);                     // r2x = T(a) ∘ r2: same clone modulo the lattice
  expect(o.matrices[2]).toBe(null);                     // r2x ∘ r2 is the lattice translation by a
  expect(cloneCount(o)).toBe(1);
  expect(apply(o.matrices[0]!, { x: 0, y: 0 })).toEqual(apply(matrixOf(grp[6], lat), { x: 0, y: 0 }));
  const exact = orbit([['ma'], ['tb']], grp, lat, 12, 3);   // product has exactly 3 slots
  expect(exact.matrices).toHaveLength(3); expect(exact.open).toBe(false);
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
