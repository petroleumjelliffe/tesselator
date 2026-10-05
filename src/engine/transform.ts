import type { Matrix, XY, UV, Cell, Lattice, Element } from '../types';
import { toWorld, toUV } from './lattice';

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function translation(dx: number, dy: number): Matrix { return [1, 0, 0, 1, dx, dy]; }

// The linear part is the identity: a pure translation (the identity included).
export function isTranslation(M: Matrix, eps = 1e-9): boolean {
  return Math.abs(M[0] - 1) + Math.abs(M[1]) + Math.abs(M[2]) + Math.abs(M[3] - 1) <= eps;
}
export function isIdentity(M: Matrix, eps = 1e-9): boolean { return isTranslation(M, eps) && Math.abs(M[4]) + Math.abs(M[5]) <= eps; }

export function rotation(theta: number, cx = 0, cy = 0): Matrix {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}

// Reflection across the line through (cx, cy) at angle theta (radians) from the x axis.
export function reflection(theta: number, cx = 0, cy = 0): Matrix {
  const c2 = Math.cos(2 * theta), s2 = Math.sin(2 * theta);
  return [c2, s2, s2, -c2, cx - c2 * cx - s2 * cy, cy - s2 * cx + c2 * cy];
}

export function compose(A: Matrix, B: Matrix): Matrix {
  return [
    A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}

export function invert(M: Matrix): Matrix {
  const [a, b, c, d, e, f] = M;
  const det = a * d - b * c;
  const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}

export function apply(M: Matrix, p: XY): XY {
  return { x: M[0] * p.x + M[2] * p.y + M[4], y: M[1] * p.x + M[3] * p.y + M[5] };
}

export function power(M: Matrix, k: number): Matrix {
  let R = IDENTITY;
  for (let i = 0; i < k; i++) R = compose(M, R);
  return R;
}

export function cellMatrix(cell: Cell, lat: Lattice): Matrix {
  const t = toWorld({ u: cell.c, v: cell.r }, lat);
  return translation(t.x, t.y);
}

export function mirrorAngle(el: { du: number; dv: number }, lat: Lattice): number {
  const d = toWorld({ u: el.du, v: el.dv }, lat);
  return (((Math.atan2(d.y, d.x) * 180) / Math.PI) % 180 + 180) % 180;
}

export function mirrorDirFromAngle(deg: number, lat: Lattice): { du: number; dv: number } {
  const t = (deg * Math.PI) / 180;
  const uv = toUV({ x: Math.cos(t), y: Math.sin(t) }, lat);
  return { du: uv.u, dv: uv.v };
}

export function matrixOf(el: Element, lat: Lattice): Matrix {
  if (el.kind === 'translate') { const t = toWorld({ u: el.u, v: el.v }, lat); return translation(t.x, t.y); }
  const c = toWorld({ u: el.u, v: el.v }, lat);
  if (el.kind === 'mirror') { const d = toWorld({ u: el.du, v: el.dv }, lat); return reflection(Math.atan2(d.y, d.x), c.x, c.y); }
  return rotation((2 * Math.PI) / el.n, c.x, c.y);
}

export function isLatticeTranslation(M: Matrix, lat: Lattice, eps = 1e-6): boolean {
  if (Math.abs(M[0] - 1) > eps || Math.abs(M[1]) > eps || Math.abs(M[2]) > eps || Math.abs(M[3] - 1) > eps) return false;
  const { u, v } = toUV({ x: M[4], y: M[5] }, lat);
  return Math.abs(u - Math.round(u)) < eps && Math.abs(v - Math.round(v)) < eps;
}

export function composite(ops: string[], elements: Element[], lat: Lattice): Matrix {
  let M = IDENTITY;
  for (const id of ops) {
    const el = elements.find((e) => e.id === id);
    if (el) M = compose(matrixOf(el, lat), M);
  }
  return M;
}

// Own clones of one group: powers of its composite up to, but excluding, the first lattice translation.
export function ownClones(group: string[], elements: Element[], lat: Lattice, cap = 12): { matrices: Matrix[]; open: boolean } {
  const M = composite(group, elements, lat);
  const matrices: Matrix[] = [];
  let P = M;
  for (let k = 1; k <= cap; k++) {
    if (isLatticeTranslation(P, lat)) return { matrices, open: false };
    matrices.push(P);
    P = compose(M, P);
  }
  return { matrices, open: true };
}

export type Orbit = { matrices: (Matrix | null)[]; open: boolean };

// Clones of a binding: the product of its groups. Tuple (p1 … pk), not all zero, has matrix Gk^pk ∘ … ∘ G1^p1 and
// index p1 + (n1+1)·p2 + (n1+1)(n2+1)·p3 + …; matrices[index − 1] holds it, or null when it is the source again or
// coincides (modulo a lattice translation) with a lower-indexed clone. Truncated at cloneCap in index order.
export function orbit(groups: string[][], elements: Element[], lat: Lattice, ownCap = 12, cloneCap = 48): Orbit {
  const own = groups.map((g) => ownClones(g, elements, lat, ownCap));
  const radix = own.map((o) => o.matrices.length + 1);
  const total = radix.reduce((a, b) => a * b, 1);
  const matrices: (Matrix | null)[] = [], kept: Matrix[] = [];
  let open = own.some((o) => o.open);
  for (let i = 1; i < total; i++) {
    if (matrices.length >= cloneCap) { open = true; break; }
    let M: Matrix = IDENTITY, rest = i;
    own.forEach((o, g) => { const p = rest % radix[g]; rest = Math.floor(rest / radix[g]); if (p) M = compose(o.matrices[p - 1], M); });
    const dup = isLatticeTranslation(M, lat) || kept.some((K) => isLatticeTranslation(compose(M, invert(K)), lat));
    if (dup) matrices.push(null); else { matrices.push(M); kept.push(M); }
  }
  return { matrices, open };
}

// Decode a clone index into its per-group powers (mixed radix, group 1 least significant), each radix being that
// group's own clone count + 1. The source (index 0) and an index past the product decode to all zeros.
export function clonePowers(groups: string[][], elements: Element[], lat: Lattice, index: number, ownCap = 12): number[] {
  const radix = groups.map((g) => ownClones(g, elements, lat, ownCap).matrices.length + 1);
  const total = radix.reduce((a, b) => a * b, 1);
  if (!Number.isInteger(index) || index <= 0 || index >= total) return radix.map(() => 0);
  let rest = index;
  return radix.map((r) => { const p = rest % r; rest = Math.floor(rest / r); return p; });
}

export const cloneCount = (o: { matrices: (Matrix | null)[] }): number => o.matrices.filter((m) => m !== null).length;

export type Classified =
  | { kind: 'identity' }
  | { kind: 'translation'; vector: XY }
  | { kind: 'rotation'; angle: number; center: XY }
  | { kind: 'reflection'; line: { angle: number; point: XY } }
  | { kind: 'glide'; line: { angle: number; point: XY }; slide: number };

export function classify(M: Matrix, eps = 1e-6): Classified {
  const [a, b, c, d, e, f] = M;
  const det = a * d - b * c;
  if (det > 0) {
    if (Math.abs(a - 1) < eps && Math.abs(b) < eps) {
      return Math.abs(e) < eps && Math.abs(f) < eps ? { kind: 'identity' } : { kind: 'translation', vector: { x: e, y: f } };
    }
    const m00 = 1 - a, m01 = -c, m10 = -b, m11 = 1 - d, dd = m00 * m11 - m01 * m10;
    return { kind: 'rotation', angle: Math.atan2(b, a), center: { x: (m11 * e - m01 * f) / dd, y: (-m10 * e + m00 * f) / dd } };
  }
  const theta = Math.atan2(b, a) / 2;
  const dir = { x: Math.cos(theta), y: Math.sin(theta) };
  const along = e * dir.x + f * dir.y;
  const px = e - along * dir.x, py = f - along * dir.y;
  const line = { angle: (theta * 180) / Math.PI, point: { x: px / 2, y: py / 2 } };
  return Math.abs(along) < eps ? { kind: 'reflection', line } : { kind: 'glide', line, slide: along };
}

// E6a: a rotation angle (radians) normalised to (−π, π], rounded to `stepDeg`-degree steps when stepDeg > 0.
export function rotationAngle(theta: number, stepDeg: number): number {
  let t = Math.atan2(Math.sin(theta), Math.cos(theta));
  if (stepDeg > 0) { const k = (stepDeg * Math.PI) / 180; t = Math.round(t / k) * k; }
  return t <= -Math.PI ? t + 2 * Math.PI : t;
}

// H10: the angle in degrees for the rotation hint, to one decimal (clockwise on screen is positive).
export function angleDeg(theta: number): number {
  const d = Math.round(((theta * 180) / Math.PI) * 10) / 10;
  return d === 0 ? 0 : d;
}

export function toSvg(M: Matrix): string { return `matrix(${M.join(' ')})`; }
