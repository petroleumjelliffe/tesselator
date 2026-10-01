import { test, expect } from 'vitest';
import * as P from '../../src/engine/paths';
import { buildTargets, pickSnap, precedence, strokeCopies, strokeCands, pointCopyMatrices, ownFixedCands, nearestOnSeg, gridResult, NODE_ONLY } from '../../src/engine/snap';
import { cellMatrix } from '../../src/engine/transform';
import { CONFIG } from '../../src/config';
import { makeDoc, line } from './fixtures';
import type { Doc, XY, SnapResult } from '../../src/types';

const near = (a: XY, b: XY) => { expect(a.x).toBeCloseTo(b.x, 6); expect(a.y).toBeCloseTo(b.y, 6); };
function mirrorDoc(): Doc {                               // square 240, a mirror along b through the tile centre: the line x = 120 (and x = 360, x = -120)
  const d = makeDoc();
  P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });
  return d;
}

test('nearestOnSeg on a straight and a curved segment', () => {
  const s = nearestOnSeg({ x: 0, y: 0 }, null, { x: 100, y: 0 }, { x: 30, y: 7 });
  near(s.q, { x: 30, y: 0 }); expect(s.t).toBeCloseTo(0.3, 9); expect(s.d).toBeCloseTo(7, 9);
  const c = nearestOnSeg({ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }, { x: 50, y: 60 });   // apex (50, 50)
  near(c.q, { x: 50, y: 50 }); expect(c.t).toBeCloseTo(0.5, 6);
});

test('buildTargets: corners, edges, the mirror axis, and where the axis crosses the tile edge', () => {
  const T = buildTargets(mirrorDoc());
  expect(T.points.some((t) => t.cat === 'corner' && t.at.x === 0 && t.at.y === 0)).toBe(true);
  expect(T.lines.some((t) => t.cat === 'axis' && Math.abs(t.a.x - 120) < 1e-6 && Math.abs(t.b.x - 120) < 1e-6)).toBe(true);
  expect(T.lines.filter((t) => t.cat === 'edge').length).toBeGreaterThanOrEqual(8);
  expect(T.points.some((t) => t.cat === 'intersection' && Math.abs(t.at.x - 120) < 1e-6 && Math.abs(t.at.y) < 1e-6)).toBe(true);
});

test('pickSnap: a point beats a nearer line; nothing in range is null; a line projects', () => {
  const T = buildTargets(mirrorDoc());
  const a = pickSnap(T, { x: 117, y: 50 }, 12)!;          // axis 3 away, nothing else near
  expect(a.cat).toBe('axis'); near(a.at, { x: 120, y: 50 }); expect(a.hit).toEqual({ kind: 'place' });
  const b = pickSnap(T, { x: 118, y: 6 }, 12)!;           // the axis × edge crossing (120, 0) is 6.3 away; the axis is 2 away
  expect(b.cat).toBe('intersection'); near(b.at, { x: 120, y: 0 });
  expect(pickSnap(T, { x: 60, y: 60 }, 12)).toBe(null);
});

test('pickSnap: other paths\' nodes and lines carry hits; exclusions drop them and the lines touching them', () => {
  const d = makeDoc();
  const p = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]);   // (48,120)-(192,120)
  const T = buildTargets(d);
  const n = pickSnap(T, { x: 50, y: 118 }, 12)!;
  expect(n.cat).toBe('node'); expect(n.hit).toMatchObject({ kind: 'node', pointId: p.start.pointId, cell: { c: 0, r: 0 } });
  const l = pickSnap(T, { x: 120, y: 125 }, 12)!;
  expect(l.cat).toBe('line'); expect(l.hit).toMatchObject({ kind: 'curve', pathId: p.id, j: 0, copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 } });
  expect((l.hit as { t: number }).t).toBeCloseTo(0.5, 6);
  expect(pickSnap(T, { x: 120, y: 125 }, 12, { excludePoints: new Set([p.start.pointId]) })).toBe(null);
  expect(pickSnap(T, { x: 120, y: 125 }, 12, { excludePaths: new Set([p.id]) })).toBe(null);
  expect(pickSnap(T, { x: 120, y: 125 }, 12, { cats: NODE_ONLY })).toBe(null);
  expect(pickSnap(T, { x: 50, y: 118 }, 12, { cats: NODE_ONLY })?.cat).toBe('node');
});

test('stickiness: a held line survives out to 1.5× and a same-class rival must be clearly nearer; an earlier class takes over', () => {
  const T = buildTargets(mirrorDoc());
  const held = pickSnap(T, { x: 135, y: 60 }, 12, { sticky: pickSnap(T, { x: 125, y: 60 }, 12)!.id })!;   // 15 from the axis: beyond 12, inside 18
  expect(held.cat).toBe('axis');
  expect(pickSnap(T, { x: 139, y: 60 }, 12, { sticky: held.id })).toBe(null);                              // 19: let go
  const corner = pickSnap(T, { x: 118, y: 6 }, 12, { sticky: held.id })!;
  expect(corner.cat).toBe('intersection');                                                                  // a point is earlier than any line
  expect(precedence({ cls: 'point', cat: 'corner' })).toBeLessThan(precedence({ cls: 'line', cat: 'axis' }));
});

test('strokeCands: own line minus the tail, own start once long enough, a clone\'s start, a repeat\'s start', () => {
  const d = mirrorDoc();
  const groups = [[d.elements[0].id]];
  const copies = strokeCopies(d, groups);
  expect(copies.some((c) => c.kind === 'repeat' && c.cell.c === 1 && c.cell.r === 0)).toBe(true);
  const stroke = [{ x: 20, y: 100 }, { x: 60, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 140 }];
  const kinds = (p: XY) => strokeCands(stroke, copies, p, 12).map((c) => c.cat);
  expect(kinds({ x: 40, y: 104 })).toContain('ownLine');
  expect(kinds({ x: 98, y: 136 })).not.toContain('ownLine');                 // the tail behind the tip is not a target
  expect(kinds({ x: 22, y: 102 })).toContain('ownStart');
  const cs = strokeCands(stroke, copies, { x: 220, y: 100 }, 12).find((c) => c.cat === 'ownClone' && c.cls === 'point')!;   // mirror of (20, 100) is (220, 100)
  near(cs.at, { x: 220, y: 100 }); expect(cs.hit).toEqual({ kind: 'place' });
  const rs = strokeCands(stroke, copies, { x: 258, y: 100 }, 12).find((c) => c.cat === 'ownRepeat' && c.cls === 'point')!;  // repeat of the start in cell (1, 0)
  expect(rs.hit).toEqual({ kind: 'ownRepeat', cell: { c: 1, r: 0 } });
  expect(strokeCands([{ x: 0, y: 0 }, { x: 10, y: 0 }], copies, { x: 1, y: 1 }, 12).some((c) => c.cat === 'ownStart')).toBe(false);
});

test('ownFixedCands: a mirror clone of the dragged point resolves to the axis; a half turn to its centre', () => {
  const d = mirrorDoc();
  const p = line(d, [{ u: 0.3, v: 0.2 }, { u: 0.3, v: 0.6 }]);
  P.addBinding(d, p.id, [[d.elements[0].id]]);
  const Ks = pointCopyMatrices(d, p.start.pointId);
  const S = cellMatrix({ c: 0, r: 0 }, d.lattice);
  const c = ownFixedCands(S, Ks, { x: 115, y: 48 }, 12).find((x) => x.cls === 'line')!;
  expect(c.cat).toBe('ownFixed'); near(c.at, { x: 120, y: 48 }); expect(c.hit).toEqual({ kind: 'place' });
  const r = makeDoc();
  const el = P.addElement(r, { kind: 'rotate', u: 0.5, v: 0.5, n: 2 });
  const q = line(r, [{ u: 0.3, v: 0.2 }, { u: 0.3, v: 0.6 }]);
  P.addBinding(r, q.id, [[el.id]]);
  const k = ownFixedCands(S, pointCopyMatrices(r, q.start.pointId), { x: 118, y: 122 }, 12).find((x) => x.cls === 'point')!;
  near(k.at, { x: 120, y: 120 });
});

test('gridResult rounds to the grid', () => {
  const g = gridResult({ x: 31, y: 59 }, CONFIG.LATTICE_PRESETS.Square, 8);
  near(g.at, { x: 30, y: 60 }); expect(g.cat).toBe('grid');
});

test('a stroke result is a SnapResult', () => {
  const r: SnapResult = { at: { x: 0, y: 0 }, cls: 'point', cat: 'grid', id: 'grid', label: 'grid', hit: { kind: 'place' }, d: 0 };
  expect(r.cls).toBe('point');
});
