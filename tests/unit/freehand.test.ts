import { test, expect } from 'vitest';
import { simplify, fitQuadratic, strokeToPath } from '../../src/engine/freehand';

const line = Array.from({ length: 30 }, (_, i) => ({ x: i * 4, y: 0.3 * Math.sin(i) }));
const arc = Array.from({ length: 21 }, (_, i) => { const t = i / 20, u = 1 - t; return { x: 2 * u * t * 50 + t * t * 100, y: 2 * u * t * 100 }; });

test('simplify collapses a near-straight stroke to its endpoints', () => {
  const s = simplify(line, 5);
  expect(s).toHaveLength(2); expect(s[0]).toBe(line[0]); expect(s[1]).toBe(line[29]);
});

test('fitQuadratic recovers a control point close to the true one and rejects a line', () => {
  const cp = fitQuadratic(arc, 0, arc.length - 1)!;
  expect(Math.abs(cp.x - 50)).toBeLessThan(10); expect(Math.abs(cp.y - 100)).toBeLessThan(10);
  expect(fitQuadratic(line, 0, line.length - 1)).toBe(null);
});

test('strokeToPath rejects a jitter and returns points plus cps otherwise', () => {
  expect(strokeToPath([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }])).toBe(null);
  const out = strokeToPath(arc, { eps: 60 })!;
  expect(out.points).toHaveLength(2); expect(out.cps).toHaveLength(1); expect(out.cps[0]).toBeTruthy();
  expect(strokeToPath(line)!.cps[0]).toBe(null);
});
