// Regions: every copy in the 3×3 window is split at crossings, walked into a planar graph, and its loops
// become faces (positive area) and holes (negative loops nested in a face of another component).
import { CONFIG } from '../config';
import { windowOffsets, toUV, toWorld } from './lattice';
import { apply, cellMatrix, compose, orbit } from './transform';
import { pathWorld, pathCpsWorld } from './paths';
import type { Doc, XY, Lattice, Fill, WorldSeg, Piece, Loop, Face } from '../types';

const MERGE = 1e-4, T_EPS = 1e-7, AREA_EPS = 1e-6, REGION_EPS = 1e-6;

function bez(s: WorldSeg, t: number): XY {
  if (!s.cp) return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
  const u = 1 - t;
  return { x: u * u * s.a.x + 2 * u * t * s.cp.x + t * t * s.b.x, y: u * u * s.a.y + 2 * u * t * s.cp.y + t * t * s.b.y };
}
function sampleCount(s: WorldSeg): number {
  if (!s.cp) return 1;
  const len = Math.hypot(s.cp.x - s.a.x, s.cp.y - s.a.y) + Math.hypot(s.b.x - s.cp.x, s.b.y - s.cp.y);
  return Math.max(8, Math.min(32, Math.round(len / 8)));
}

export function subCurve(s: WorldSeg, t0: number, t1: number): { a: XY; cp: XY; b: XY } {
  const cp = s.cp!;
  const lerp = (u: XY, v: XY, t: number): XY => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t });
  return { a: bez(s, t0), cp: lerp(lerp(s.a, cp, t0), lerp(cp, s.b, t0), t1), b: bez(s, t1) };
}

export function collectSegments(doc: Doc, cap = CONFIG.ORBIT_CAP): WorldSeg[] {
  const segs: WorldSeg[] = [];
  const clones = doc.bindings.map((b) => ({ b, ms: orbit(b.ops, doc.elements, doc.lattice, cap).matrices }));
  for (const cell of windowOffsets()) {
    const Mo = cellMatrix(cell, doc.lattice);
    for (const path of doc.paths) {
      const Pw = pathWorld(doc, path), C = pathCpsWorld(doc, path);
      const push = (M: typeof Mo, bindingId: string | null, power: number) => {
        const P2 = Pw.map((p) => apply(M, p)), C2 = C.map((c) => c && apply(M, c));
        for (let j = 0; j < P2.length - 1; j++) {
          if (Math.hypot(P2[j + 1].x - P2[j].x, P2[j + 1].y - P2[j].y) < MERGE) continue;
          segs.push({ a: P2[j], b: P2[j + 1], cp: C2[j], source: { pathId: path.id, copy: { cell, bindingId, power }, j } });
        }
      };
      push(Mo, null, 0);
      for (const { b, ms } of clones) if (b.pathId === path.id) ms.forEach((M, k) => push(compose(Mo, M), b.id, k + 1));
    }
  }
  return segs;
}

type PieceLine = { si: number; t0: number; t1: number; p: XY; q: XY };
function pieces(segs: WorldSeg[]): PieceLine[] {
  const out: PieceLine[] = [];
  segs.forEach((s, si) => {
    const n = sampleCount(s);
    let prev = bez(s, 0);
    for (let i = 1; i <= n; i++) { const t = i / n, p = bez(s, t); out.push({ si, t0: (i - 1) / n, t1: t, p: prev, q: p }); prev = p; }
  });
  return out;
}

function intersect(p1: XY, p2: XY, p3: XY, p4: XY): { t: number; u: number } | null {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y, d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den, u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den, e = 1e-9;
  if (t < -e || t > 1 + e || u < -e || u > 1 + e) return null;
  return { t: Math.min(1, Math.max(0, t)), u: Math.min(1, Math.max(0, u)) };
}

// A split of a segment: the parameter on the true curve and the vertex position, which is the crossing point on the
// flattened chord so that both segments through a crossing land on one shared vertex (the true-curve points at their
// respective parameters differ by the chord sagitta, far more than MERGE). The outline still uses subCurve(t0, t1).
type Split = { t: number; p: XY };
function splitParams(segs: WorldSeg[]): Split[][] {
  const ps = pieces(segs), params: Split[][] = segs.map((s) => [{ t: 0, p: s.a }, { t: 1, p: s.b }]);
  if (!ps.length) return params;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pc of ps) { minX = Math.min(minX, pc.p.x, pc.q.x); maxX = Math.max(maxX, pc.p.x, pc.q.x); minY = Math.min(minY, pc.p.y, pc.q.y); maxY = Math.max(maxY, pc.p.y, pc.q.y); }
  const cell = Math.max((maxX - minX) / 64, (maxY - minY) / 64, 1);
  const buckets = new Map<number, number[]>();
  ps.forEach((pc, i) => {
    const x0 = Math.floor((Math.min(pc.p.x, pc.q.x) - minX) / cell), x1 = Math.floor((Math.max(pc.p.x, pc.q.x) - minX) / cell);
    const y0 = Math.floor((Math.min(pc.p.y, pc.q.y) - minY) / cell), y1 = Math.floor((Math.max(pc.p.y, pc.q.y) - minY) / cell);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = x * 4096 + y; const list = buckets.get(k); if (list) list.push(i); else buckets.set(k, [i]); }
  });
  const seen = new Set<number>();
  for (const list of buckets.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const A = ps[list[i]], B = ps[list[j]];
    if (A.si === B.si) continue;
    const key = Math.min(list[i], list[j]) * 1e7 + Math.max(list[i], list[j]);
    if (seen.has(key)) continue;
    seen.add(key);
    const h = intersect(A.p, A.q, B.p, B.q);
    if (!h) continue;
    const x: XY = { x: A.p.x + (A.q.x - A.p.x) * h.t, y: A.p.y + (A.q.y - A.p.y) * h.t };
    params[A.si].push({ t: A.t0 + (A.t1 - A.t0) * h.t, p: x });
    params[B.si].push({ t: B.t0 + (B.t1 - B.t0) * h.u, p: x });
  }
  return params.map((list) => { const s = list.sort((a, b) => a.t - b.t), out = [s[0]]; for (const x of s) if (x.t - out[out.length - 1].t > T_EPS) out.push(x); return out; });
}

type Vert = { x: number; y: number; out: number[]; comp: number };
type Edge = { va: number; vb: number; poly: XY[]; seg: WorldSeg; t0: number; t1: number };
type Half = { from: number; to: number; edge: number; rev: boolean; angle: number; twin: number; next: number };

function buildGraph(segs: WorldSeg[], params: Split[][]) {
  const verts: Vert[] = [], grid = new Map<string, number[]>();
  const vertexAt = (p: XY): number => {
    const gx = Math.round(p.x / MERGE), gy = Math.round(p.y / MERGE);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const list = grid.get(`${gx + dx},${gy + dy}`);
      if (list) for (const id of list) if (Math.hypot(verts[id].x - p.x, verts[id].y - p.y) <= MERGE) return id;
    }
    const id = verts.length;
    verts.push({ x: p.x, y: p.y, out: [], comp: -1 });
    const key = `${gx},${gy}`;
    const list = grid.get(key); if (list) list.push(id); else grid.set(key, [id]);
    return id;
  };
  const edges: Edge[] = [], edgeKeys = new Set<string>();
  segs.forEach((s, si) => {
    const ts = params[si];
    for (let k = 0; k < ts.length - 1; k++) {
      const { t: t0, p: pa } = ts[k], { t: t1, p: pb } = ts[k + 1];
      const n = s.cp ? Math.max(2, Math.ceil(sampleCount(s) * (t1 - t0))) : 1;
      const poly: XY[] = [pa];
      for (let i = 1; i < n; i++) poly.push(bez(s, t0 + ((t1 - t0) * i) / n));
      poly.push(pb);
      const va = vertexAt(pa), vb = vertexAt(pb);
      if (va === vb) continue;
      const m = bez(s, (t0 + t1) / 2);
      const key = `${Math.min(va, vb)}:${Math.max(va, vb)}:${Math.round(m.x / MERGE)},${Math.round(m.y / MERGE)}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ va, vb, poly, seg: s, t0, t1 });
    }
  });
  const half: Half[] = [];
  edges.forEach((e, ei) => {
    const n = e.poly.length;
    const fwd: Half = { from: e.va, to: e.vb, edge: ei, rev: false, angle: Math.atan2(e.poly[1].y - e.poly[0].y, e.poly[1].x - e.poly[0].x), twin: half.length + 1, next: -1 };
    const bwd: Half = { from: e.vb, to: e.va, edge: ei, rev: true, angle: Math.atan2(e.poly[n - 2].y - e.poly[n - 1].y, e.poly[n - 2].x - e.poly[n - 1].x), twin: half.length, next: -1 };
    half.push(fwd, bwd);
    verts[e.va].out.push(half.length - 2);
    verts[e.vb].out.push(half.length - 1);
  });
  for (const v of verts) v.out.sort((a, b) => half[a].angle - half[b].angle);
  for (const h of half) { const v = verts[h.to], idx = v.out.indexOf(h.twin); h.next = v.out[(idx - 1 + v.out.length) % v.out.length]; }
  // connected components
  let comp = 0;
  for (let i = 0; i < verts.length; i++) {
    if (verts[i].comp >= 0) continue;
    const stack = [i]; verts[i].comp = comp;
    while (stack.length) { const v = verts[stack.pop()!]; for (const hi of v.out) { const to = half[hi].to; if (verts[to].comp < 0) { verts[to].comp = comp; stack.push(to); } } }
    comp++;
  }
  return { verts, edges, half };
}

function shoelace(poly: XY[]): number {
  let a = 0;
  for (let k = 0; k < poly.length; k++) { const p = poly[k], q = poly[(k + 1) % poly.length]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}

function centroidOf(poly: XY[]): XY {
  let a = 0, cx = 0, cy = 0;
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k], q = poly[(k + 1) % poly.length], w = p.x * q.y - q.x * p.y;
    a += w; cx += (p.x + q.x) * w; cy += (p.y + q.y) * w;
  }
  if (Math.abs(a) < AREA_EPS) return poly[0];
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

function walkLoops(g: ReturnType<typeof buildGraph>): { pos: (Loop & { comp: number })[]; neg: (Loop & { comp: number })[] } {
  const pos: (Loop & { comp: number })[] = [], neg: (Loop & { comp: number })[] = [];
  const visited = new Array(g.half.length).fill(false);
  for (let s = 0; s < g.half.length; s++) {
    if (visited[s]) continue;
    const loop: number[] = [];
    let i = s, guard = 0;
    while (!visited[i] && guard++ <= g.half.length) { visited[i] = true; loop.push(i); i = g.half[i].next; }
    const poly: XY[] = [];
    for (const hi of loop) { const h = g.half[hi], e = g.edges[h.edge]; const pts = h.rev ? e.poly.slice().reverse() : e.poly; for (let k = 0; k < pts.length - 1; k++) poly.push(pts[k]); }
    const area = shoelace(poly);
    if (Math.abs(area) <= AREA_EPS) continue;
    const pcs: Piece[] = loop.map((hi) => { const h = g.half[hi], e = g.edges[h.edge]; return { seg: e.seg, t0: e.t0, t1: e.t1, reversed: h.rev }; });
    const comp = g.verts[g.half[loop[0]].from].comp;
    (area > 0 ? pos : neg).push({ poly, area: Math.abs(area), pieces: pcs, comp });
  }
  return { pos, neg };
}

export function pointInPoly(poly: XY[], p: XY): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function faceContains(face: Face, p: XY): boolean {
  return pointInPoly(face.outer.poly, p) && !face.holes.some((h) => pointInPoly(h.poly, p));
}

function assemble(pos: (Loop & { comp: number })[], neg: (Loop & { comp: number })[]): Face[] {
  const faces = pos.slice().sort((a, b) => b.area - a.area).map((l) => ({ outer: l, holes: [] as Loop[], area: l.area, centroid: centroidOf(l.poly), comp: l.comp }));
  for (const n of neg) {
    const probe = n.poly[0];
    for (let i = faces.length - 1; i >= 0; i--) {
      const f = faces[i];
      if (f.comp === n.comp) continue;
      if (pointInPoly(f.outer.poly, probe)) { f.holes.push({ poly: n.poly, area: n.area, pieces: n.pieces }); break; }
    }
  }
  return faces.map(({ outer, holes, area, centroid }) => ({ outer: { poly: outer.poly, area: outer.area, pieces: outer.pieces }, holes, area, centroid }));
}

const memo = new WeakMap<Doc, Face[]>();
export function computeFaces(doc: Doc): Face[] {
  const hit = memo.get(doc);
  if (hit) return hit;
  let faces: Face[] = [];
  try {
    const segs = collectSegments(doc);
    const { pos, neg } = walkLoops(buildGraph(segs, splitParams(segs)));
    faces = assemble(pos, neg);
  } catch (err) {
    console.error('regions: face computation failed', err);
    faces = [];
  }
  memo.set(doc, faces);
  return faces;
}

// Smallest face containing p, outside its holes. Faces are sorted largest first.
export function faceAt(faces: Face[], p: XY): Face | null {
  for (let i = faces.length - 1; i >= 0; i--) {
    const f = faces[i];
    if (!pointInPoly(f.outer.poly, p)) continue;
    return f.holes.some((h) => pointInPoly(h.poly, p)) ? null : f;
  }
  return null;
}

export function seedFor(face: Face, click: XY): XY {
  return faceContains(face, face.centroid) ? face.centroid : click;
}

// Faces are computed once per window copy, so one region is several Face objects that are lattice translates of one
// another. Two faces are the same region when their centroids differ by a whole lattice vector and their areas agree.
export function sameRegion(a: Face, b: Face, lat: Lattice): boolean {
  if (Math.abs(a.area - b.area) > REGION_EPS * Math.max(1, a.area)) return false;
  const p = toUV(a.centroid, lat), q = toUV(b.centroid, lat), du = q.u - p.u, dv = q.v - p.v;
  return Math.abs(du - Math.round(du)) < REGION_EPS && Math.abs(dv - Math.round(dv)) < REGION_EPS;
}

// The face copy a fill's seed lands in (the seed is kept in the base cell), and the fill that colours a face's region.
export function fillFace(faces: Face[], fill: Fill, lat: Lattice): Face | null { return faceAt(faces, toWorld(fill, lat)); }
export function fillOfFace(fills: Fill[], faces: Face[], face: Face, lat: Lattice): Fill | null {
  return fills.find((f) => { const g = fillFace(faces, f, lat); return !!g && sameRegion(g, face, lat); }) ?? null;
}

function loopPathData(loop: Loop): string {
  const parts: string[] = [];
  loop.pieces.forEach((pc, i) => {
    const s = pc.seg;
    let a: XY, cp: XY | null, b: XY;
    if (s.cp) ({ a, cp, b } = subCurve(s, pc.t0, pc.t1)); else { a = bez(s, pc.t0); b = bez(s, pc.t1); cp = null; }
    if (pc.reversed) [a, b] = [b, a];
    if (i === 0) parts.push(`M${a.x},${a.y}`);
    parts.push(cp ? `Q${cp.x},${cp.y} ${b.x},${b.y}` : `L${b.x},${b.y}`);
  });
  return parts.join(' ') + ' Z';
}

export function facePathData(face: Face): string {
  return [face.outer, ...face.holes].map(loopPathData).join(' ');
}
