import { test, expect } from 'vitest';
import * as P from '../../src/engine/paths';
import { joinable, nodeForSnap, joinPointToHit, splitNearest } from '../../src/engine/joins';
import { makeDoc, line } from './fixtures';
import type { SnapResult, Copy } from '../../src/types';

const base: Copy = { cell: { c: 0, r: 0 }, bindingId: null, power: 0 };
const res = (hit: SnapResult['hit'], at = { x: 0, y: 0 }): SnapResult => ({ at, cls: 'point', cat: 'node', id: 'x', label: 'x', hit, d: 0 });

test('joinable: same layer only; a shared point needs every user on the layer', () => {
  const d = makeDoc();
  d.layers.push({ id: 'L2', name: 'Layer 2' });
  const a = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]);
  expect(joinable(d, { kind: 'curve', pathId: a.id, j: 0, t: 0.5, copy: base }, 'L1')).toBe(true);
  expect(joinable(d, { kind: 'curve', pathId: a.id, j: 0, t: 0.5, copy: base }, 'L2')).toBe(false);
  expect(joinable(d, { kind: 'node', pointId: a.start.pointId, cell: { c: 0, r: 0 }, copy: base }, 'L2')).toBe(false);
  expect(joinable(d, { kind: 'place' }, 'L1')).toBe(false);
});

test('nodeForSnap: shares a node, splits a line (raw cell and clone via), else a new point at the snap', () => {
  const d = makeDoc();
  const a = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]);
  expect(nodeForSnap(d, res({ kind: 'node', pointId: a.start.pointId, cell: { c: 1, r: 0 }, copy: base }), { x: 0, y: 0 }, 'L1')).toEqual({ pointId: a.start.pointId, cell: { c: 1, r: 0 } });
  const n = nodeForSnap(d, res({ kind: 'curve', pathId: a.id, j: 0, t: 0.5, copy: { cell: { c: 1, r: 0 }, bindingId: null, power: 0 } }), { x: 0, y: 0 }, 'L1');
  expect(a.segments).toHaveLength(2);
  expect(n.cell).toEqual({ c: 1, r: 0 });
  const w = P.nodeWorld(d, n); expect(w.x).toBeCloseTo(360, 6); expect(w.y).toBeCloseTo(120, 6);
  const other = nodeForSnap(d, res({ kind: 'curve', pathId: a.id, j: 0, t: 0.5, copy: base }), { x: 1, y: 2 }, 'L2');   // another layer: location only
  expect(a.segments).toHaveLength(2);
  const pw = P.nodeWorld(d, other); expect(pw.x).toBeCloseTo(0, 6); expect(pw.y).toBeCloseTo(0, 6);                    // at s.at
  const free = nodeForSnap(d, null, { x: 30, y: 40 }, 'L1');
  const fw = P.nodeWorld(d, free); expect(fw.x).toBeCloseTo(30, 6); expect(fw.y).toBeCloseTo(40, 6);
});

test('joinPointToHit: a dropped point merges into a node or a split line; location-only hits do nothing', () => {
  const d = makeDoc();
  const host = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]);
  const stub = line(d, [{ u: 0.5, v: 0.1 }, { u: 0.5, v: 0.49 }]);
  const end = stub.segments[0].to;
  expect(joinPointToHit(d, end.pointId, end.cell, { kind: 'place' }, 'L1')).toBe(false);
  expect(joinPointToHit(d, end.pointId, end.cell, { kind: 'curve', pathId: host.id, j: 0, t: 0.5, copy: base }, 'L1')).toBe(true);
  expect(host.segments).toHaveLength(2);
  expect(stub.segments[0].to.pointId).toBe(host.segments[0].to.pointId);
});

test('splitNearest: splits the nearest earlier segment, or returns an end node', () => {
  const d = makeDoc();
  const p = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.5, v: 0.1 }, { u: 0.5, v: 0.5 }]);   // (24,24)-(120,24)-(120,120)
  const n = splitNearest(d, p.id, { x: 72, y: 24 }, 1)!;
  expect(p.segments).toHaveLength(3);
  const w = P.nodeWorld(d, n); expect(w.x).toBeCloseTo(72, 6);
  expect(splitNearest(d, p.id, { x: 24, y: 24 }, 1)).toEqual(p.start);
});
