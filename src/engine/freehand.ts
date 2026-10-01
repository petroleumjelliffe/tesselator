import type { XY } from '../types';

export function simplify(pts: XY[], eps: number): XY[] {
  if (pts.length < 3) return pts.slice();
  const a = pts[0], b = pts[pts.length - 1], L = Math.hypot(b.x - a.x, b.y - a.y);
  let idx = 0, md = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    // A closed loop (a === b, as a stroke snapped onto its own start) has no line to measure a perpendicular distance
    // against; fall back to distance from the shared endpoint, so the farthest point still becomes the split.
    const d = L < 1e-9 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L;
    if (d > md) { md = d; idx = i; }
  }
  if (md <= eps) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

export function fitQuadratic(raw: XY[], i0: number, i1: number, minDeviation = 2.5): XY | null {
  const P0 = raw[i0], P2 = raw[i1];
  if (i1 - i0 < 2) return null;
  const cum = [0];
  for (let i = i0 + 1; i <= i1; i++) cum.push(cum[cum.length - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y));
  const L = cum[cum.length - 1] || 1, chord = Math.hypot(P2.x - P0.x, P2.y - P0.y) || 1;
  let nx = 0, ny = 0, den = 0, dev = 0;
  for (let i = i0 + 1; i < i1; i++) {
    const t = cum[i - i0] / L, b0 = (1 - t) ** 2, b1 = 2 * t * (1 - t), b2 = t * t, S = raw[i];
    nx += b1 * (S.x - b0 * P0.x - b2 * P2.x); ny += b1 * (S.y - b0 * P0.y - b2 * P2.y); den += b1 * b1;
    dev = Math.max(dev, Math.abs((P2.x - P0.x) * (P0.y - S.y) - (P0.x - S.x) * (P2.y - P0.y)) / chord);
  }
  if (!den || dev < minDeviation) return null;
  return { x: nx / den, y: ny / den };
}

export function strokeToPath(raw: XY[], { eps = 5, minDeviation = 2.5 } = {}): { points: XY[]; cps: (XY | null)[] } | null {
  if (raw.length < 2) return null;
  const simp = simplify(raw, eps);
  if (simp.length < 2) return null;
  if (simp.length === 2 && Math.hypot(simp[1].x - simp[0].x, simp[1].y - simp[0].y) < 4) return null;
  const idx = simp.map((v) => raw.indexOf(v)), cps: (XY | null)[] = [];
  for (let j = 0; j < simp.length - 1; j++) cps.push(fitQuadratic(raw, idx[j], idx[j + 1], minDeviation));
  return { points: simp.map((p) => ({ x: p.x, y: p.y })), cps };
}
