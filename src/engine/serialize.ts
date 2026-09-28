import { CONFIG } from '../config';
import { windowOffsets, cellPolygon, toUV, toWorld } from './lattice';
import { IDENTITY, apply, orbit } from './transform';
import { pathWorld, pathCpsWorld } from './paths';
import { computeFaces, faceAt, facePathData } from './regions';
import { pathD } from './svgpath';
import type { Doc, XY, Cell, Lattice, Box } from '../types';

export function serializeDoc(d: Doc): string { return JSON.stringify(d); }

export function parseDoc(json: string): Doc | null {
  try {
    const o = JSON.parse(json);
    if (!o || o.version !== 1 || !o.lattice) return null;
    for (const k of ['points', 'paths', 'elements', 'bindings', 'fills']) if (!Array.isArray(o[k])) return null;
    const l = o.lattice;
    if (![l.ax, l.ay, l.bx, l.by].every((x: unknown) => typeof x === 'number' && Number.isFinite(x))) return null;
    return { version: 1, lattice: { ax: l.ax, ay: l.ay, bx: l.bx, by: l.by }, points: o.points, paths: o.paths, elements: o.elements, bindings: o.bindings, fills: o.fills, newPathOps: Array.isArray(o.newPathOps) ? o.newPathOps : [] };
  } catch { return null; }
}

export type ExportMode = { kind: 'tile' } | { kind: 'grid'; rows: number; cols: number };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const bbox = (pts: XY[]): Box => ({ x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) });

function cellDefs(d: Doc): string {
  const strokes = (lyr: 'structure' | 'detail') => d.paths.filter((p) => p.layer === lyr).flatMap((p) => {
    const P = pathWorld(d, p), C = pathCpsWorld(d, p);
    const Ms = [IDENTITY, ...d.bindings.filter((b) => b.pathId === p.id).flatMap((b) => orbit(b.ops, d.elements, d.lattice, CONFIG.ORBIT_CAP).matrices)];
    return Ms.map((M) => `<path d="${pathD(P.map((q) => apply(M, q)), C.map((c) => c && apply(M, c)))}" fill="none" stroke="${esc(p.style.color)}" stroke-width="${p.style.weight}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }).join('');
  const faces = computeFaces(d);
  const fills = d.fills.map((f) => ({ f, face: faceAt(faces, toWorld(f, d.lattice)) })).filter((x) => x.face).sort((a, b) => b.face!.area - a.face!.area)
    .map(({ f, face }) => `<path d="${facePathData(face!)}" fill="${esc(f.color)}" fill-rule="evenodd"/>`).join('');
  return `<g id="cell-structure">${strokes('structure')}</g><g id="cell-fills">${fills}</g><g id="cell-detail">${strokes('detail')}</g>`;
}

// Cells whose parallelogram overlaps the rectangle (touching edges do not count).
function cellsIntersecting(rect: Box, lat: Lattice): Cell[] {
  const corners = [{ x: rect.x0, y: rect.y0 }, { x: rect.x1, y: rect.y0 }, { x: rect.x0, y: rect.y1 }, { x: rect.x1, y: rect.y1 }].map((p) => toUV(p, lat));
  const c0 = Math.floor(Math.min(...corners.map((k) => k.u))) - 1, c1 = Math.floor(Math.max(...corners.map((k) => k.u))) + 1;
  const r0 = Math.floor(Math.min(...corners.map((k) => k.v))) - 1, r1 = Math.floor(Math.max(...corners.map((k) => k.v))) + 1;
  const out: Cell[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const b = bbox(cellPolygon({ c, r }, lat));
    if (b.x1 > rect.x0 + 1e-9 && b.x0 < rect.x1 - 1e-9 && b.y1 > rect.y0 + 1e-9 && b.y0 < rect.y1 - 1e-9) out.push({ c, r });
  }
  return out;
}

export function exportSvg(d: Doc, mode: ExportMode): string {
  const lat = d.lattice;
  let rect: Box, clip: string, cells: Cell[];
  if (mode.kind === 'tile') {
    const poly = cellPolygon({ c: 0, r: 0 }, lat);
    rect = bbox(poly);
    clip = `<polygon points="${poly.map((p) => `${p.x},${p.y}`).join(' ')}"/>`;
    cells = windowOffsets();
  } else {
    const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= CONFIG.MAX_WALLPAPER;
    if (!ok(mode.rows) || !ok(mode.cols)) throw new Error(`rows and columns must be whole numbers from 1 to ${CONFIG.MAX_WALLPAPER}`);
    rect = bbox([{ u: 0, v: 0 }, { u: mode.cols, v: 0 }, { u: 0, v: mode.rows }, { u: mode.cols, v: mode.rows }].map((k) => toWorld(k, lat)));
    clip = `<rect x="${rect.x0}" y="${rect.y0}" width="${rect.x1 - rect.x0}" height="${rect.y1 - rect.y0}"/>`;
    cells = cellsIntersecting(rect, lat);
  }
  const uses = (id: string) => cells.map((o) => { const t = toWorld({ u: o.c, v: o.r }, lat); return `<use href="#${id}" transform="translate(${t.x} ${t.y})"/>`; }).join('');
  const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${rect.x0} ${rect.y0} ${w} ${h}" width="${w}" height="${h}"><defs>${cellDefs(d)}<clipPath id="clip">${clip}</clipPath></defs><g clip-path="url(#clip)">${uses('cell-structure')}${uses('cell-fills')}${uses('cell-detail')}</g></svg>`;
}
