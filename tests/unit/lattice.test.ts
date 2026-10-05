import { test, expect } from 'vitest';
import { toWorld, toUV, cellOf, nodeUV, windowOffsets, visibleOffsets, snapGrid, snapFraction, isDegenerate, cellPolygon, latticeAngle, nearestFraction, fractionWithin } from '../../src/engine/lattice';
import { CONFIG } from '../../src/config';

const sq = CONFIG.LATTICE_PRESETS.Square, rh = CONFIG.LATTICE_PRESETS['Rhombus 60°'];

test('toUV/toWorld round-trip on every preset', () => {
  for (const lat of Object.values(CONFIG.LATTICE_PRESETS)) {
    const p = { x: 37.5, y: -91.25 }, q = toWorld(toUV(p, lat), lat);
    expect(q.x).toBeCloseTo(p.x, 9); expect(q.y).toBeCloseTo(p.y, 9);
  }
});

test('cellOf floors and keeps the remainder; a corner belongs to the next cell', () => {
  expect(cellOf({ u: 1.25, v: -0.5 })).toEqual({ cell: { c: 1, r: -1 }, local: { u: 0.25, v: 0.5 } });
  expect(cellOf({ u: 1, v: 1 })).toEqual({ cell: { c: 1, r: 1 }, local: { u: 0, v: 0 } });
  expect(nodeUV({ u: 0.25, v: 0.5 }, { c: 1, r: -1 })).toEqual({ u: 1.25, v: -0.5 });
});

test('windowOffsets is the 3x3 neighbourhood, base at index 4', () => {
  const w = windowOffsets();
  expect(w).toHaveLength(9); expect(w[4]).toEqual({ c: 0, r: 0 }); expect(w[0]).toEqual({ c: -1, r: -1 });
});

test('visibleOffsets covers the viewport, is clamped, always includes the base cell', () => {
  const far = visibleOffsets({ pan: { x: -5000, y: -5000 }, zoom: 1 }, sq, 100, 100, 3);
  expect(far.some((o) => o.c === 0 && o.r === 0)).toBe(true);
  const wide = visibleOffsets({ pan: { x: 1200, y: 1200 }, zoom: 0.1 }, sq, 2400, 2400, 3);
  expect(wide).toHaveLength(49);
  expect(wide.every((o) => Math.abs(o.c) <= 3 && Math.abs(o.r) <= 3)).toBe(true);
});

test('snapGrid and snapFraction round in lattice coordinates on a skewed lattice', () => {
  expect(snapGrid({ u: 0.51, v: 0.24 }, 8)).toEqual({ u: 0.5, v: 0.25 });
  const s = snapFraction({ u: 0.34, v: 0.01 }, 8, rh);
  expect(s.u).toBeCloseTo(1 / 3, 9); expect(s.v).toBeCloseTo(0, 9);
  const g = snapFraction({ u: 0.38, v: 0 }, 8, rh);
  expect(g.u).toBeCloseTo(0.375, 9);
});

test('isDegenerate, cellPolygon and latticeAngle', () => {
  expect(isDegenerate({ ax: 240, ay: 0, bx: 240, by: 1 })).toBe(true);
  expect(isDegenerate(sq)).toBe(false);
  expect(cellPolygon({ c: 1, r: 0 }, sq)[2]).toEqual({ x: 480, y: 240 });
  expect(latticeAngle(rh)).toBeCloseTo(60, 1);
  expect(latticeAngle(sq)).toBeCloseTo(90, 9);
});

test('nearestFraction: the nearest k/n with n ≤ maxN, any integer k; fractionWithin applies a world tolerance', () => {
  expect(nearestFraction(0.26, 4)).toBe(0.25);
  expect(nearestFraction(0.32, 4)).toBeCloseTo(1 / 3, 12);
  expect(nearestFraction(0.55, 4)).toBe(0.5);
  expect(nearestFraction(1.26, 4)).toBe(1.25);
  expect(nearestFraction(-0.26, 4)).toBe(-0.25);
  expect(nearestFraction(0.1, 4)).toBe(0);
  expect(nearestFraction(0.32, 2)).toBe(0.5);                 // thirds are not offered when maxN is 2
  expect(fractionWithin(0.508, 240, 4, 12)).toBe(0.5);        // 2 world px away
  expect(fractionWithin(0.1, 240, 4, 12)).toBe(null);         // 24 px from 0
  expect(fractionWithin(0.1, 240, 4, 30)).toBe(0);
});
