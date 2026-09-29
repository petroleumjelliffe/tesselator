import { CONFIG } from '../config';
import { makeId } from '../ids';
import { windowOffsets, cellPolygon, toUV, toWorld } from './lattice';
import { IDENTITY, apply, orbit } from './transform';
import { pathWorld, pathCpsWorld } from './paths';
import { computeFaces, fillFace, facePathData } from './regions';
import { pathD } from './svgpath';
import type { Doc, XY, Cell, Lattice, Box, Matrix, Point, Path, Fill, Element, DocLayer } from '../types';

export function serializeDoc(d: Doc): string { return JSON.stringify(d); }

// --- version 1 (before groups and layers), kept for migration

type PathV1 = Omit<Path, 'layerId'> & { layer: 'structure' | 'detail' };
type BindingV1 = { id: string; pathId: string; ops: string[] };
export type DocV1 = { version: 1; lattice: Lattice; points: Point[]; paths: PathV1[]; elements: Element[]; bindings: BindingV1[]; fills: Omit<Fill, 'layerId'>[]; newPathOps: string[][] };

// Three layers preserve the old appearance exactly: structure strokes, then every fill, then detail strokes.
export function migrateV1(d: DocV1): Doc {
  const structure: DocLayer = { id: makeId('layer'), name: 'Structure' }, fills: DocLayer = { id: makeId('layer'), name: 'Fills' }, detail: DocLayer = { id: makeId('layer'), name: 'Detail' };
  return {
    version: 2, lattice: { ...d.lattice }, points: d.points, elements: d.elements,
    paths: d.paths.map(({ layer, ...p }) => ({ ...p, layerId: layer === 'detail' ? detail.id : structure.id })),
    bindings: d.bindings.filter((b) => b.ops.length).map((b) => ({ id: b.id, pathId: b.pathId, groups: [b.ops.slice()] })),
    fills: d.fills.map((f) => ({ ...f, layerId: fills.id })),
    layers: [structure, fills, detail],
    newPathGroups: d.newPathOps.filter((c) => c.length).map((c) => c.slice()),
  };
}

// --- validation: per-entity shapes against types.ts, then references. A dangling pointId, pathId or layerId is
// refused (it would throw in render on every reload); unknown element ids in groups are dropped, and a group or
// binding emptied by that goes away. A binding that then still names an element twice is refused.
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isCell = (x: any): boolean => !!x && isNum(x.c) && isNum(x.r);
const isNode = (x: any): boolean => !!x && isStr(x.pointId) && isCell(x.cell);
const isCp = (x: any): boolean => x === null || (!!x && isNum(x.u) && isNum(x.v));
const isStyle = (x: any): boolean => !!x && isStr(x.color) && isNum(x.weight);
const isPoint = (x: any): boolean => !!x && isStr(x.id) && isNum(x.u) && isNum(x.v);
const isSegment = (x: any): boolean => !!x && isNode(x.to) && isCp(x.cp);
const isPathCore = (x: any): boolean => !!x && isStr(x.id) && isNode(x.start) && isStyle(x.style) && Array.isArray(x.segments) && x.segments.every(isSegment);
const isPathV1 = (x: any): boolean => isPathCore(x) && (x.layer === 'structure' || x.layer === 'detail');
const isPathV2 = (x: any): boolean => isPathCore(x) && isStr(x.layerId);
const isElement = (x: any): boolean => {
  if (!x || !isStr(x.id) || !isNum(x.u) || !isNum(x.v)) return false;
  if (x.kind === 'translate') return true;
  if (x.kind === 'mirror') return isNum(x.du) && isNum(x.dv);
  if (x.kind === 'rotate') return Number.isInteger(x.n) && x.n >= 2;
  return false;
};
const isStrList = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const isGroups = (x: unknown): x is string[][] => Array.isArray(x) && x.every((g) => isStrList(g) && g.length > 0);
const isBindingV1 = (x: any): boolean => !!x && isStr(x.id) && isStr(x.pathId) && isStrList(x.ops);
const isBindingV2 = (x: any): boolean => !!x && isStr(x.id) && isStr(x.pathId) && isGroups(x.groups) && x.groups.length > 0;
const hasRepeat = (groups: string[][]): boolean => new Set(groups.flat()).size !== groups.flat().length;
const isFillCore = (x: any): boolean => !!x && isStr(x.id) && isNum(x.u) && isNum(x.v) && isStr(x.color);
const isFillV2 = (x: any): boolean => isFillCore(x) && isStr(x.layerId);
const isLayer = (x: any): boolean => !!x && isStr(x.id) && isStr(x.name);

function checkCommon(o: any): boolean {
  if (!o || !o.lattice) return false;
  for (const k of ['points', 'paths', 'elements', 'bindings', 'fills']) if (!Array.isArray(o[k])) return false;
  const l = o.lattice;
  if (![l.ax, l.ay, l.bx, l.by].every(isNum)) return false;
  if (!o.points.every(isPoint) || !o.elements.every(isElement)) return false;
  const pointIds = new Set<string>(o.points.map((pt: Point) => pt.id));
  for (const path of o.paths as Path[]) if (!pointIds.has(path.start.pointId) || path.segments.some((sg) => !pointIds.has(sg.to.pointId))) return false;
  const pathIds = new Set<string>(o.paths.map((path: Path) => path.id));
  return (o.bindings as { pathId: string }[]).every((b) => pathIds.has(b.pathId));
}

export function parseDoc(json: string): Doc | null {
  try {
    const o = JSON.parse(json);
    if (!o || !checkCommon(o)) return null;
    const elIds = new Set<string>(o.elements.map((e: Element) => e.id));
    const known = (g: string[]) => g.filter((id) => elIds.has(id));
    const knownGroups = (groups: string[][]) => groups.map(known).filter((g) => g.length);
    const l = o.lattice, lattice: Lattice = { ax: l.ax, ay: l.ay, bx: l.bx, by: l.by };
    if (o.version === 1) {
      if (!o.paths.every(isPathV1) || !o.bindings.every(isBindingV1) || !o.fills.every(isFillCore)) return null;
      if (o.newPathOps !== undefined && !(Array.isArray(o.newPathOps) && o.newPathOps.every(isStrList))) return null;
      const v1: DocV1 = { version: 1, lattice, points: o.points, paths: o.paths, elements: o.elements, fills: o.fills,
        bindings: (o.bindings as BindingV1[]).map((b) => ({ ...b, ops: known(b.ops) })),
        newPathOps: (Array.isArray(o.newPathOps) ? (o.newPathOps as string[][]) : []).map(known) };
      return migrateV1(v1);
    }
    if (o.version !== 2) return null;
    if (!Array.isArray(o.layers) || !o.layers.length || !o.layers.every(isLayer)) return null;
    const layerIds = new Set<string>(o.layers.map((x: DocLayer) => x.id));
    if (layerIds.size !== o.layers.length) return null;
    if (!o.paths.every(isPathV2) || !o.bindings.every(isBindingV2) || !o.fills.every(isFillV2)) return null;
    if (!(o.paths as Path[]).every((p) => layerIds.has(p.layerId)) || !(o.fills as Fill[]).every((f) => layerIds.has(f.layerId))) return null;
    if (o.newPathGroups !== undefined && !isGroups(o.newPathGroups)) return null;
    const bindings = (o.bindings as { id: string; pathId: string; groups: string[][] }[]).map((b) => ({ id: b.id, pathId: b.pathId, groups: knownGroups(b.groups) })).filter((b) => b.groups.length);
    if (bindings.some((b) => hasRepeat(b.groups))) return null;
    return { version: 2, lattice, points: o.points, paths: o.paths, elements: o.elements, bindings, fills: o.fills, layers: o.layers, newPathGroups: knownGroups(Array.isArray(o.newPathGroups) ? o.newPathGroups : []) };
  } catch { return null; }
}

export type ExportMode = { kind: 'tile' } | { kind: 'grid'; rows: number; cols: number };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const bbox = (pts: XY[]): Box => ({ x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) });

const cloneMs = (d: Doc, pathId: string): Matrix[] => d.bindings.filter((b) => b.pathId === pathId).flatMap((b) => orbit(b.groups, d.elements, d.lattice, CONFIG.ORBIT_CAP, CONFIG.CLONE_CAP).matrices.filter((M): M is Matrix => M !== null));

// One group per layer, bottom to top; inside a layer the seeded faces come first, then every source and clone stroke.
function cellDefs(d: Doc): string {
  const faces = computeFaces(d);
  return d.layers.map((l) => {
    const fills = d.fills.filter((f) => f.layerId === l.id).map((f) => ({ f, face: fillFace(faces, f, d.lattice) })).filter((x) => x.face).sort((a, b) => b.face!.area - a.face!.area)
      .map(({ f, face }) => `<path d="${facePathData(face!)}" fill="${esc(f.color)}" fill-rule="evenodd"/>`).join('');
    const strokes = d.paths.filter((p) => p.layerId === l.id).flatMap((p) => {
      const P = pathWorld(d, p), C = pathCpsWorld(d, p);
      return [IDENTITY, ...cloneMs(d, p.id)].map((M) => `<path d="${pathD(P.map((q) => apply(M, q)), C.map((c) => c && apply(M, c)))}" fill="none" stroke="${esc(p.style.color)}" stroke-width="${p.style.weight}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }).join('');
    return `<g id="cell-layer-${esc(l.id)}">${fills}${strokes}</g>`;
  }).join('');
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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${rect.x0} ${rect.y0} ${w} ${h}" width="${w}" height="${h}"><defs>${cellDefs(d)}<clipPath id="clip">${clip}</clipPath></defs><g clip-path="url(#clip)">${d.layers.map((l) => uses(`cell-layer-${esc(l.id)}`)).join('')}</g></svg>`;
}
