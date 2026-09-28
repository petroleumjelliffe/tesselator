import type { UV, XY, Cell, Lattice, View } from '../types';

export function toWorld(uv: UV, lat: Lattice): XY {
  return { x: uv.u * lat.ax + uv.v * lat.bx, y: uv.u * lat.ay + uv.v * lat.by };
}

export function toUV(p: XY, lat: Lattice): UV {
  const det = lat.ax * lat.by - lat.bx * lat.ay || 1;
  return { u: (p.x * lat.by - p.y * lat.bx) / det, v: (-p.x * lat.ay + p.y * lat.ax) / det };
}

const EPS = 1e-9;
export function cellOf(uv: UV): { cell: Cell; local: UV } {
  const c = Math.floor(uv.u + EPS), r = Math.floor(uv.v + EPS);
  const local = { u: uv.u - c, v: uv.v - r };
  if (Math.abs(local.u) < EPS) local.u = 0;
  if (Math.abs(local.v) < EPS) local.v = 0;
  return { cell: { c, r }, local };
}

export function nodeUV(point: UV, cell: Cell): UV { return { u: point.u + cell.c, v: point.v + cell.r }; }

export function windowOffsets(): Cell[] {
  const out: Cell[] = [];
  for (let r = -1; r <= 1; r++) for (let c = -1; c <= 1; c++) out.push({ c, r });
  return out;
}

export function visibleOffsets(view: View, lat: Lattice, width: number, height: number, radius = 3): Cell[] {
  const corners = [[0, 0], [width, 0], [0, height], [width, height]].map(([sx, sy]) =>
    toUV({ x: (sx - view.pan.x) / view.zoom, y: (sy - view.pan.y) / view.zoom }, lat));
  const us = corners.map((k) => k.u), vs = corners.map((k) => k.v);
  const c0 = Math.max(-radius, Math.floor(Math.min(...us)) - 1), c1 = Math.min(radius, Math.floor(Math.max(...us)) + 1);
  const r0 = Math.max(-radius, Math.floor(Math.min(...vs)) - 1), r1 = Math.min(radius, Math.floor(Math.max(...vs)) + 1);
  const out: Cell[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push({ c, r });
  if (!out.some((o) => o.c === 0 && o.r === 0)) out.push({ c: 0, r: 0 });
  return out;
}

export function snapGrid(uv: UV, div: number): UV {
  return { u: Math.round(uv.u * div) / div, v: Math.round(uv.v * div) / div };
}

// The finer of the grid and twelfths, judged by world distance.
export function snapFraction(uv: UV, div: number, lat: Lattice): UV {
  const a = snapGrid(uv, div), b = snapGrid(uv, 12);
  const p = toWorld(uv, lat), wa = toWorld(a, lat), wb = toWorld(b, lat);
  return Math.hypot(wa.x - p.x, wa.y - p.y) <= Math.hypot(wb.x - p.x, wb.y - p.y) ? a : b;
}

export function isDegenerate(lat: Lattice, min = 400): boolean {
  return Math.abs(lat.ax * lat.by - lat.bx * lat.ay) < min;
}

export function cellPolygon(cell: Cell, lat: Lattice): XY[] {
  return [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 1, v: 1 }, { u: 0, v: 1 }].map((k) => toWorld({ u: k.u + cell.c, v: k.v + cell.r }, lat));
}

export function latticeAngle(lat: Lattice): number {
  return Math.abs((Math.atan2(lat.ax * lat.by - lat.ay * lat.bx, lat.ax * lat.bx + lat.ay * lat.by) * 180) / Math.PI);
}
