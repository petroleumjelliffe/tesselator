import { test, expect } from 'vitest';
import * as P from '../../src/engine/paths';
import { buildTargets, pickSnap, precedence, choose, strokeCopies, strokeCands, pointCopyMatrices, ownFixedCands, nearestOnSeg, gridResult, solveCopyMeet, bodyTargets, snapBodyDelta, snapScale, cpLines, snapToLines, windowCopies } from '../../src/engine/snap';
import { cellMatrix, apply, rotation, IDENTITY } from '../../src/engine/transform';
import { CONFIG } from '../../src/config';
import { STR } from '../../src/strings';
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
  expect(pickSnap(T, { x: 120, y: 125 }, 12, { cats: new Set(['node' as const]) })).toBe(null);
  expect(pickSnap(T, { x: 50, y: 118 }, 12, { cats: new Set(['node' as const]) })?.cat).toBe('node');
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

const addXY = (a: XY, b: XY): XY => ({ x: a.x + b.x, y: a.y + b.y });

test('solveCopyMeet: a point for a quarter turn, a line for a mirror, nothing for a translation', () => {
  const K = rotation(Math.PI / 2, 120, 120), pi = { x: 100, y: 50 }, pj = { x: 30, y: 60 };
  const r = solveCopyMeet(IDENTITY, K, pi, pj);
  expect(r?.kind).toBe('point');
  if (r?.kind === 'point') near(addXY(pi, r.delta), apply(K, addXY(pj, r.delta)));
  const m = solveCopyMeet(IDENTITY, [-1, 0, 0, 1, 240, 0], { x: 100, y: 50 }, { x: 100, y: 50 });   // the vertical line x = 120
  expect(m?.kind).toBe('line');
  if (m?.kind === 'line') { near(m.base, { x: 20, y: 0 }); expect(Math.abs(m.dir.x)).toBeCloseTo(0, 9); }
  expect(solveCopyMeet(IDENTITY, [1, 0, 0, 1, 240, 0], pi, pj)).toBe(null);
});

test('snapBodyDelta: an end lands on a corner, on another path\'s line, or nothing', () => {
  const d = makeDoc();
  const stub = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.5, v: 0.1 }]);          // (24,24)-(120,24)
  const other = line(d, [{ u: -0.2, v: 0.3 }, { u: 0.2, v: 0.3 }]);        // (-48,72)-(48,72)
  const T = bodyTargets(d, buildTargets(d), stub.id)!;
  const c = snapBodyDelta(T, { x: -20, y: -20 }, 12, null)!;               // start lands at (4, 4): corner (0, 0)
  expect(c.res.cat).toBe('corner'); near(c.delta, { x: -24, y: -24 }); expect(c.nodeIndex).toBe(0);
  const k = snapBodyDelta(T, { x: 6, y: 45 }, 12, null)!;                  // start lands at (30, 69): 3 from the other line
  expect(k.res.hit).toMatchObject({ kind: 'curve', pathId: other.id, j: 0 }); near(k.delta, { x: 6, y: 48 });
  expect(snapBodyDelta(T, { x: 60, y: 160 }, 12, null)).toBe(null);
});

test('snapBodyDelta: segments touching the dragged points are not targets', () => {
  const d = makeDoc();
  const stub = line(d, [{ u: 0.3, v: 0.3 }, { u: 0.6, v: 0.3 }]);
  const joined = P.startPath(d, { ...stub.start, cell: { ...stub.start.cell } }, { color: '#000', weight: 2 }, 'L1');
  P.appendNode(d, joined.id, P.addPoint(d, { u: 0.3, v: 0.6 }));          // moves with the stub
  expect(snapBodyDelta(bodyTargets(d, buildTargets(d), stub.id)!, { x: 2, y: 0 }, 12, null)).toBe(null);
});

test('snapBodyDelta: an end meets its own quarter-turn clone', () => {
  const d = makeDoc();
  const stub = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.4, v: 0.1 }]);
  const el = P.addElement(d, { kind: 'rotate', u: 0.5, v: 0.5, n: 4 });
  const b = P.addBinding(d, stub.id, [[el.id]]);
  const K = P.cloneMatrices(d, b.id).matrices[0]!;
  const Pw = P.pathWorld(d, stub);
  const sol = solveCopyMeet(IDENTITY, K, Pw[1], Pw[0]);
  expect(sol?.kind).toBe('point');
  if (sol?.kind !== 'point') return;
  const s = snapBodyDelta(bodyTargets(d, buildTargets(d), stub.id)!, addXY(sol.delta, { x: 1, y: 1 }), 12, null)!;
  expect(s.res.hit).toEqual({ kind: 'own' });
  near(s.delta, sol.delta);
});

const TIE_EPS = [-0.5, -1e-6, -1e-9, 0, 1e-9, 1e-6, 0.5];

test('snapBodyDelta: the start meets the clone of the end (rotation, SN3a), stably across tiny pointer changes', () => {
  const d = makeDoc();
  const stub = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.4, v: 0.1 }]);       // open two-node path
  const el = P.addElement(d, { kind: 'rotate', u: 0.5, v: 0.5, n: 4 });
  const b = P.addBinding(d, stub.id, [[el.id]]);
  const Pw = P.pathWorld(d, stub);
  const wc = windowCopies(d, stub.id).find((c) => c.copy.bindingId === b.id && c.copy.cell.c === 0 && c.copy.cell.r === 0)!;
  const sol = solveCopyMeet(IDENTITY, wc.M, Pw[0], Pw[1]);              // start (pi) meets the clone of the end (pj)
  expect(sol?.kind).toBe('point');
  if (sol?.kind !== 'point') return;
  const T = bodyTargets(d, buildTargets(d), stub.id)!;
  // End B (the end) meets the inverse clone of end A (the start) at the exact same body delta: a tie on `d` that must
  // resolve to one stable nodeIndex/id/at, not flip with sub-pixel pointer noise (round 1 fix).
  let ref: ReturnType<typeof snapBodyDelta> = null;
  for (const ox of TIE_EPS) for (const oy of TIE_EPS) {
    const s = snapBodyDelta(T, addXY(sol.delta, { x: ox, y: oy }), 12, null)!;
    expect(s).toBeTruthy();
    expect(s.res.cls).toBe('point');
    expect(s.res.cat).toBe('ownFixed');
    expect(s.res.label).toBe(STR.snap.meetsCloneEnd);
    if (!ref) ref = s;
    else {
      expect(s.nodeIndex).toBe(ref.nodeIndex);
      expect(s.res.id).toBe(ref.res.id);
      near(s.res.at, ref.res.at);
    }
  }
  near(ref!.delta, sol.delta);                                          // the body moves by exactly the solved delta
  near(apply(wc.M, addXY(Pw[1], ref!.delta)), addXY(Pw[0], ref!.delta)); // the end's clone now sits on the moved start
});

function mirrorAxisDoc(): { d: Doc; elId: string } {                   // square 240, vertical mirror axis through u = 0.5 (x = 120)
  const d = makeDoc();
  const el = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });
  return { d, elId: el.id };
}

test('snapBodyDelta: ends lined up along a mirror axis offer a clone-end line hint, stably across tiny pointer changes', () => {
  const { d, elId } = mirrorAxisDoc();
  const stub = line(d, [{ u: 0.2, v: 0.3 }, { u: 0.4, v: 0.3 }]);       // same v: lined up along the (vertical) axis
  const b = P.addBinding(d, stub.id, [[elId]]);
  const Pw = P.pathWorld(d, stub);
  const wc = windowCopies(d, stub.id).find((c) => c.copy.bindingId === b.id && c.copy.cell.c === 0 && c.copy.cell.r === 0)!;
  const sol = solveCopyMeet(IDENTITY, wc.M, Pw[0], Pw[1]);
  expect(sol?.kind).toBe('line');
  if (sol?.kind !== 'line') return;
  const T = bodyTargets(d, buildTargets(d), stub.id)!;
  // The end-meets-start pairing (mirror is self-inverse) solves to the identical line, so the same tie as the rotation
  // case arises here on the perpendicular distance to the line; sweep across it and require a stable winner.
  const along = addXY(sol.base, sol.dir);                               // a point on the line, one unit from the base
  const perp = { x: -sol.dir.y, y: sol.dir.x };                         // unit vector perpendicular to the line
  let ref: ReturnType<typeof snapBodyDelta> = null;
  for (const e of TIE_EPS) {
    const raw = addXY(along, { x: perp.x * e, y: perp.y * e });
    const s = snapBodyDelta(T, raw, 12, null)!;
    expect(s).toBeTruthy();
    expect(s.res.cls).toBe('line');
    expect(s.res.cat).toBe('ownFixed');
    expect(s.res.label).toBe(STR.snap.meetsCloneEndLine);
    if (!ref) ref = s;
    else {
      expect(s.nodeIndex).toBe(ref.nodeIndex);
      expect(s.res.id).toBe(ref.res.id);
      near(s.res.at, ref.res.at);
    }
  }
});

test('snapBodyDelta: ends not lined up along a mirror axis can never meet, so no clone-end hint appears', () => {
  const { d, elId } = mirrorAxisDoc();
  const stub = line(d, [{ u: 0.2, v: 0.3 }, { u: 0.4, v: 0.6 }]);       // different v: never lines up
  const b = P.addBinding(d, stub.id, [[elId]]);
  const Pw = P.pathWorld(d, stub);
  const wc = windowCopies(d, stub.id).find((c) => c.copy.bindingId === b.id && c.copy.cell.c === 0 && c.copy.cell.r === 0)!;
  expect(solveCopyMeet(IDENTITY, wc.M, Pw[0], Pw[1])).toBe(null);       // confirms they can never meet
  const T = bodyTargets(d, buildTargets(d), stub.id)!;
  let sawSnap = false;
  for (let dx = -20; dx <= 20; dx += 5) for (let dy = -20; dy <= 20; dy += 5) {
    const s = snapBodyDelta(T, { x: dx, y: dy }, 12, null);
    if (s) sawSnap = true;
    expect(s?.res.label).not.toBe(STR.snap.meetsCloneEnd);
    expect(s?.res.label).not.toBe(STR.snap.meetsCloneEndLine);
  }
  expect(sawSnap).toBe(true);                                          // the sweep isn't vacuously empty
});

test('snapBodyDelta: a tied delta still prefers a point over a line, even from a higher moving index (round 2 regression)', () => {
  const d = makeDoc();                                                  // no elements/bindings: the tie is built directly from ordinary targets
  // start (index 0) at (-120, 240): a raw of (240, 0) lands it at (120, 240), exactly on the grid edge y = 240.
  // end (index 1) at (0, 0): the same raw lands it exactly on the grid corner (240, 0).
  // Both therefore resolve to the identical body delta (240, 0) -- a tie where the lower index (start) is a line and
  // the higher index (end) is a point. The point must win regardless of index.
  const stub = line(d, [{ u: -0.5, v: 1 }, { u: 0, v: 0 }]);
  const T = bodyTargets(d, buildTargets(d), stub.id)!;
  const s = snapBodyDelta(T, { x: 240, y: 0 }, 12, null)!;
  expect(s).toBeTruthy();
  near(s.delta, { x: 240, y: 0 });
  expect(s.nodeIndex).toBe(1);
  expect(s.res.cls).toBe('point');
  expect(s.res.cat).toBe('corner');
  near(s.res.at, { x: 240, y: 0 });
});

const lat = { ...CONFIG.LATTICE_PRESETS.Square };

test('snapScale: an edge lands on k/n of the tile (n ≤ 4) within the threshold; a flat axis is not snapped', () => {
  const box = { x0: 0, y0: 0, x1: 100, y1: 0 }, right = { x: 100, y: 0, ax: 0, ay: 0, cursor: '' }, a = { x: 0, y: 0 };
  expect(snapScale(box, lat, right, a, { sx: 1.21, sy: 1 }, false, 12, 4)).toEqual({ sx: 1.2, sy: 1, snapped: true });   // 121 → 120 = 1/2
  expect(snapScale(box, lat, right, a, { sx: 0.81, sy: 1 }, false, 12, 4).sx).toBeCloseTo(0.8, 9);                        // 81 → 80 = 1/3
  expect(snapScale(box, lat, right, a, { sx: 1.62, sy: 1 }, false, 12, 4).sx).toBeCloseTo(1.6, 9);                        // 162 → 160 = 2/3
  expect(snapScale(box, lat, right, a, { sx: 1, sy: 1 }, false, 12, 4).snapped).toBe(false);                              // 100: 20 from 80 and 120
  const bottom = { x: 50, y: 10, ax: 50, ay: 0, cursor: '' };
  expect(snapScale(box, lat, bottom, { x: 50, y: 0 }, { sx: 1, sy: 3 }, false, 12, 4)).toEqual({ sx: 1, sy: 3, snapped: false });
});

test('snapScale: a proportional corner takes the nearest candidate from either axis; about the centre the handle moves half as far', () => {
  const box = { x0: 0, y0: 0, x1: 100, y1: 60 }, corner = { x: 100, y: 60, ax: 0, ay: 0, cursor: '' };
  const s = snapScale(box, lat, corner, { x: 0, y: 0 }, { sx: 1.19, sy: 1.19 }, true, 12, 4);
  expect(s.snapped).toBe(true); expect(s.sx).toBeCloseTo(1.2, 9); expect(s.sy).toBeCloseTo(1.2, 9);
  const c = snapScale(box, lat, corner, { x: 50, y: 30 }, { sx: 1.21, sy: 1 }, false, 12, 4);
  expect(c.snapped).toBe(true); expect(c.sx).toBeCloseTo(1.2, 9);
});

test('cpLines and snapToLines: tangent to a straight neighbour, and the crossing of two lines', () => {
  const d = makeDoc();
  const p = line(d, [{ u: 0.2, v: 0.2 }, { u: 0.6, v: 0.2 }, { u: 0.9, v: 0.5 }]);   // A (48,48), B (144,48), C (216,120)
  const L = cpLines(d, p.id, 0, { cell: { c: 0, r: 0 }, bindingId: null, power: 0 });
  const t = snapToLines({ x: 116, y: 16 }, L, 12)!;
  expect(t.used).toHaveLength(1); expect(t.at.x).toBeCloseTo(114, 6); expect(t.at.y).toBeCloseTo(18, 6);
  const x = snapToLines({ x: 50, y: -45 }, L, 12)!;
  expect(x.used).toHaveLength(2); expect(x.at.x).toBeCloseTo(48, 6); expect(x.at.y).toBeCloseTo(-48, 6);
  expect(snapToLines({ x: 90, y: 100 }, L, 12)).toBe(null);
});

test('cpLines: a node on the path\'s own mirror line offers the mirror normal; lines follow a copy in another cell', () => {
  const d = makeDoc();
  const p = line(d, [{ u: 0.2, v: 0.1 }, { u: 0.4, v: 0.4 }]);                        // B (96, 96) lies on y = x
  const el = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 1, dv: 1 });
  P.addBinding(d, p.id, [[el.id]]);
  const L = cpLines(d, p.id, 0, { cell: { c: 0, r: 0 }, bindingId: null, power: 0 });
  expect(L.some((l) => Math.hypot(l.p.x - 96, l.p.y - 96) < 1e-6 && Math.abs(l.dir.x + l.dir.y) < 1e-9)).toBe(true);
  const L2 = cpLines(d, p.id, 0, { cell: { c: 2, r: 0 }, bindingId: null, power: 0 });
  expect(L2.some((l) => Math.hypot(l.p.x - 576, l.p.y - 96) < 1e-6 && Math.abs(l.dir.x + l.dir.y) < 1e-9)).toBe(true);
});

test('SN4: a held line yields to any point within the threshold, even of the same category', () => {
  const held: SnapResult = { at: { x: 0, y: 0 }, cls: 'line', cat: 'ownClone', id: 'own:cl:0', label: 'its clone', hit: { kind: 'place' }, d: 2 };
  const pt: SnapResult = { at: { x: 5, y: 5 }, cls: 'point', cat: 'ownClone', id: 'own:cs:0', label: 'its clone\'s start', hit: { kind: 'place' }, d: 8 };
  expect(choose([held, pt], 12, 'own:cl:0')?.id).toBe('own:cs:0');
  const far = { ...pt, d: 14 };                                                    // beyond the threshold: the line holds
  expect(choose([held, far], 12, 'own:cl:0')?.id).toBe('own:cl:0');
});
