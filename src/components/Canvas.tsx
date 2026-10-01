import type { JSX } from 'preact';
import { useRef, useEffect } from 'preact/hooks';
import { CONFIG } from '../config';
import { attachPointer } from '../interaction/pointer';
import { doc } from '../state/doc';
import { layer, tool, selection, hover, drag, pen, cursor, view, prefs, space, fillPreview, snapHint } from '../state/ui';
import { cloneMatrices, visibleCells, copies, copyMatrix, faces } from '../state/derived';
import { toWorld, nodeUV, windowOffsets, cellPolygon } from '../engine/lattice';
import { IDENTITY, apply, toSvg } from '../engine/transform';
import { getPath, getElement, pathNodes, pathWorld, pathCpsWorld, boundsWorld, nodeWorld, sameNode } from '../engine/paths';
import { bboxHandles, seedOf } from '../engine/hit';
import { faceAt, facePathData, fillFace } from '../engine/regions';
import { segD, pathD } from '../engine/svgpath';
import type { XY, Path, Matrix, Cell, HitTarget } from '../types';

const isBase = (o: Cell) => o.c === 0 && o.r === 0;
const cellKey = (o: Cell) => `${o.c},${o.r}`;
const sameCopy = (a: { cell: Cell; bindingId: string | null; power: number }, b: typeof a) =>
  a.cell.c === b.cell.c && a.cell.r === b.cell.r && a.bindingId === b.bindingId && a.power === b.power;
const hoverIs = (h: HitTarget | null, kind: HitTarget['kind']) => !!h && h.kind === kind;

// Base cell geometry: every source and clone, at cell (0,0), in world coordinates.
function entriesOf(p: Path): Matrix[] {
  const d = doc.value, cm = cloneMatrices.value;
  return [IDENTITY, ...d.bindings.filter((b) => b.pathId === p.id).flatMap((b) => (cm.get(b.id) ?? []).filter((M): M is Matrix => M !== null))];
}

// One <g> per layer, bottom to top: that layer's seeded faces, then every source and clone stroke of its paths.
function CellDefs() {
  const d = doc.value, fs = faces.value;
  return (
    <defs>{d.layers.map((l) => {
      const fills = d.fills.filter((f) => f.layerId === l.id).map((f) => ({ f, face: fillFace(fs, f, d.lattice) })).filter((x) => x.face).sort((a, b) => b.face!.area - a.face!.area);
      const strokes = d.paths.filter((p) => p.layerId === l.id).flatMap((p) => {
        const P = pathWorld(d, p), C = pathCpsWorld(d, p);
        return entriesOf(p).map((M, i) => <path key={`${p.id}:${i}`} class="stroke" d={pathD(P.map((q) => apply(M, q)), C.map((c) => c && apply(M, c)))} stroke={p.style.color} stroke-width={p.style.weight} />);
      });
      return <g key={l.id} id={`cell-layer-${l.id}`}>{fills.map(({ f, face }) => <path key={f.id} class="fill" d={facePathData(face!)} fill={f.color} />)}{strokes}</g>;
    })}</defs>
  );
}

function Uses({ id }: { id: string }) {
  const lat = doc.value.lattice, ghost = prefs.value.ghostOpacity;
  return <g>{visibleCells.value.map((o) => { const t = toWorld({ u: o.c, v: o.r }, lat); return <use key={cellKey(o)} href={`#${id}`} transform={`translate(${t.x} ${t.y})`} opacity={isBase(o) ? 1 : ghost} />; })}</g>;
}

function Grid() {
  const lat = doc.value.lattice, div = prefs.value.gridDivisions, lines = [];
  for (let i = 1; i < div; i++) {
    const t = i / div;
    lines.push(<line key={`u${i}`} class="grid-line" x1={lat.ax * t} y1={lat.ay * t} x2={lat.ax * t + lat.bx} y2={lat.ay * t + lat.by} />);
    lines.push(<line key={`v${i}`} class="grid-line" x1={lat.bx * t} y1={lat.by * t} x2={lat.bx * t + lat.ax} y2={lat.by * t + lat.ay} />);
  }
  return <g>{lines}</g>;
}

function Frames() {
  const lat = doc.value.lattice;
  return <g>{visibleCells.value.map((o) => <polygon key={cellKey(o)} class={isBase(o) ? 'frame base' : 'frame'} points={cellPolygon(o, lat).map((p) => `${p.x},${p.y}`).join(' ')} />)}</g>;
}

function latticeRadius(): number {
  const lat = doc.value.lattice;
  return 1.5 * Math.max(Math.hypot(lat.ax, lat.ay), Math.hypot(lat.bx, lat.by), Math.hypot(lat.ax + lat.bx, lat.ay + lat.by) * 0.6);
}
const mirrorDir = (e: { du: number; dv: number }) => { const d = toWorld({ u: e.du, v: e.dv }, doc.value.lattice), L = Math.hypot(d.x, d.y) || 1; return { x: d.x / L, y: d.y / L }; };

function ElementGhosts() {
  const d = doc.value, z = view.value.zoom, E = 2.4 * latticeRadius();
  return <g>{d.elements.flatMap((e) => visibleCells.value.filter((o) => !isBase(o)).map((o) => {
    const t = toWorld({ u: o.c, v: o.r }, d.lattice), c = toWorld(e, d.lattice);
    if (e.kind === 'rotate') return <circle key={`${e.id}:${cellKey(o)}`} class="el-ghost" cx={c.x + t.x} cy={c.y + t.y} r={6 / z} />;
    if (e.kind === 'mirror') { const dir = mirrorDir(e); return <line key={`${e.id}:${cellKey(o)}`} class="el-ghost" x1={c.x + t.x - E * dir.x} y1={c.y + t.y - E * dir.y} x2={c.x + t.x + E * dir.x} y2={c.y + t.y + E * dir.y} />; }
    return null;
  }))}</g>;
}

// Halos on the selected copy, linked copies, and the hovered segment; fill hover tint.
function Highlights() {
  const d = doc.value, z = view.value.zoom, sel = selection.value, h = hover.value, out = [];
  const haloFor = (p: Path, M: Matrix, opacity: number, key: string) =>
    <path key={key} class="halo" d={pathD(pathWorld(d, p).map((q) => apply(M, q)), pathCpsWorld(d, p).map((c) => c && apply(M, c)))} stroke-width={p.style.weight + 6 / z} opacity={opacity} />;
  if (sel && sel.kind === 'path') {
    const p = getPath(d, sel.id);
    if (p) for (const ci of copies.value) if (ci.pathId === p.id) out.push(haloFor(p, ci.M, sameCopy(ci.copy, sel.copy) ? 0.3 : 0.15, `sel:${cellKey(ci.copy.cell)}:${ci.copy.bindingId}:${ci.copy.power}`));
  } else if (sel && sel.kind === 'element') {
    for (const ci of copies.value) { const b = ci.copy.bindingId && d.bindings.find((x) => x.id === ci.copy.bindingId); const p = b && b.groups.some((g) => g.includes(sel.id)) ? getPath(d, ci.pathId) : null; if (p) out.push(haloFor(p, ci.M, 0.15, `el:${cellKey(ci.copy.cell)}:${ci.copy.bindingId}:${ci.copy.power}`)); }
  }
  if (h && h.kind === 'segment' && !(sel && sel.kind === 'path' && sel.id === h.pathId && sameCopy(sel.copy, h.copy))) {
    const p = getPath(d, h.pathId);
    if (p) { const M = copyMatrix(h.copy); const P = pathWorld(d, p).map((q) => apply(M, q)), C = pathCpsWorld(d, p).map((c) => c && apply(M, c)); out.push(<path key="hov" class="halo" d={segD(P[h.j], P[h.j + 1], C[h.j])} stroke-width={p.style.weight + 6 / z} opacity={0.12} />); }
  }
  const probe = tool.value === 'fill' && layer.value === 'drawing' ? (fillPreview.value ?? cursor.value) : null;
  if (probe) {
    const face = faceAt(faces.value, seedOf(probe, d.lattice));
    if (face) { const dd = facePathData(face); for (const o of visibleCells.value) { const t = toWorld({ u: o.c, v: o.r }, d.lattice); out.push(<path key={`fh:${cellKey(o)}`} class="fill-hover" d={dd} transform={`translate(${t.x} ${t.y})`} />); } }
  }
  return <g>{out}</g>;
}

function selectedCopy() {
  const sel = selection.value;
  if (!sel || sel.kind !== 'path') return null;
  const p = getPath(doc.value, sel.id);
  return p ? { p, M: copyMatrix(sel.copy), copy: sel.copy } : null;
}

function Guides() {
  const sc = selectedCopy(); if (!sc) return null;
  const d = doc.value, P = pathWorld(d, sc.p).map((q) => apply(sc.M, q)), C = pathCpsWorld(d, sc.p).map((c) => c && apply(sc.M, c));
  return <g>{C.flatMap((c, j) => c ? [<line key={`a${j}`} class="guide" x1={P[j].x} y1={P[j].y} x2={c.x} y2={c.y} />, <line key={`b${j}`} class="guide" x1={c.x} y1={c.y} x2={P[j + 1].x} y2={P[j + 1].y} />] : [])}</g>;
}

function FreehandPreview() {
  const dr = drag.value; if (!dr || dr.kind !== 'free' || dr.raw.length < 2) return null;
  const d = doc.value, st = prefs.value.style, dd = dr.raw.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const ghosts = [];
  for (const o of visibleCells.value) { const t = toWorld({ u: o.c, v: o.r }, d.lattice); for (const [i, M] of [IDENTITY, ...dr.cloneMatrices].entries()) { if (isBase(o) && i === 0) continue; ghosts.push(<path key={`${cellKey(o)}:${i}`} class="free" d={dd} transform={`translate(${t.x} ${t.y}) ${toSvg(M)}`} stroke={st.color} stroke-width={st.weight} opacity={0.3} />); } }
  return <g>{ghosts}<path class="free" d={dd} stroke={st.color} stroke-width={st.weight} opacity={0.9} /></g>;
}

function Marquee() {
  const dr = drag.value; if (!dr || dr.kind !== 'marquee' || !dr.moved) return null;
  return <rect class="marquee" x={Math.min(dr.start.x, dr.cur.x)} y={Math.min(dr.start.y, dr.cur.y)} width={Math.abs(dr.cur.x - dr.start.x)} height={Math.abs(dr.cur.y - dr.start.y)} />;
}

function Rubber() {
  const pn = pen.value, c = cursor.value; if (!pn || !c) return null;
  const p = getPath(doc.value, pn.pathId); if (!p) return null;
  const nodes = pathNodes(p), last = nodeWorld(doc.value, nodes[nodes.length - 1]);
  return <line class="rubber" x1={last.x} y1={last.y} x2={c.x} y2={c.y} />;
}

function BBox() {
  if (layer.value !== 'drawing' || tool.value !== 'select') return null;
  const sc = selectedCopy(); if (!sc) return null;
  const d = doc.value, z = view.value.zoom, dr = drag.value, bd = !!dr && dr.kind === 'bbox', h = hover.value;
  const box = bd && dr.kind === 'bbox' ? dr.box : boundsWorld(d, sc.p, sc.M);
  let corners: XY[] = [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }];
  if (bd && dr.kind === 'bbox' && dr.M) corners = corners.map((c) => apply(dr.M!, c));
  const polys = visibleCells.value.map((o) => { const t = toWorld({ u: o.c, v: o.r }, d.lattice); return <polygon key={cellKey(o)} class={isBase(o) ? 'bbox' : 'bbox ghost'} points={corners.map((c) => `${c.x + t.x},${c.y + t.y}`).join(' ')} />; });
  if (bd) return <g>{polys}</g>;
  const s = 10 / z, cx = (box.x0 + box.x1) / 2, ry = box.y0 - CONFIG.BBOX_ROT_OFFSET / z;
  return <g>{polys}
    {bboxHandles(box).map((hd, i) => <rect key={i} class={h && h.kind === 'bbox' && h.h === i ? 'handle hover' : 'handle'} x={hd.x - s / 2} y={hd.y - s / 2} width={s} height={s} />)}
    <line class="guide" x1={cx} y1={box.y0} x2={cx} y2={ry} /><circle class={hoverIs(h, 'bboxrot') ? 'handle hover' : 'handle'} cx={cx} cy={ry} r={6 / z} />
  </g>;
}

function Diamonds() {
  if (layer.value !== 'drawing' || tool.value !== 'select') return null;
  const sc = selectedCopy(); if (!sc) return null;
  const d = doc.value, z = view.value.zoom, s = CONFIG.HANDLE_PX * 1.4 / z, h = hover.value;
  const P = pathWorld(d, sc.p).map((q) => apply(sc.M, q)), C = pathCpsWorld(d, sc.p).map((c) => c && apply(sc.M, c));
  return <g>{sc.p.segments.map((_, j) => { const c = C[j], m = c ?? { x: (P[j].x + P[j + 1].x) / 2, y: (P[j].y + P[j + 1].y) / 2 }; return <rect key={j} class={h && h.kind === 'diamond' && h.j === j ? 'diamond hover' : 'diamond'} x={m.x - s / 2} y={m.y - s / 2} width={s} height={s} transform={`rotate(45 ${m.x} ${m.y})`} fill={c ? CONFIG.COLORS.accent : CONFIG.COLORS.background} />; })}</g>;
}

function Points() {
  const d = doc.value, z = view.value.zoom, sel = selection.value, h = hover.value, pn = pen.value;
  const showAll = layer.value === 'drawing' && (!!pn || tool.value === 'pen' || tool.value === 'freehand');
  const show = new Set<string>();
  if (sel && sel.kind === 'points') for (const id of sel.ids) show.add(id);
  const penPath = pn ? getPath(d, pn.pathId) : null, selPath = sel && sel.kind === 'path' ? getPath(d, sel.id) : null;
  if (penPath) for (const n of pathNodes(penPath)) show.add(n.pointId);
  const penLast = penPath ? pathNodes(penPath).at(-1)! : null;
  const selPts = new Set(sel && sel.kind === 'points' ? sel.ids : []);
  const out = [];
  for (const o of windowOffsets()) for (const pt of d.points) {
    if (!showAll && !show.has(pt.id)) continue;
    const w = toWorld(nodeUV(pt, o), d.lattice);
    const isLast = !!penLast && sameNode(penLast, { pointId: pt.id, cell: o });   // a via pen end does not light the source copy
    const isHover = !!h && h.kind === 'point' && !h.via && h.pointId === pt.id && h.cell.c === o.c && h.cell.r === o.r;   // a hovered via node lights its own circle below, not the raw point
    const cls = ['pt', (isLast || selPts.has(pt.id)) && 'sel', isHover && 'hover', !isBase(o) && 'dim'].filter(Boolean).join(' ');
    out.push(<circle key={`${pt.id}:${cellKey(o)}`} class={cls} cx={w.x} cy={w.y} r={(isBase(o) ? CONFIG.HANDLE_PX : CONFIG.HANDLE_PX - 1) / z} />);
  }
  // Via nodes of the pen path: drawn where they are, on the clone.
  for (const p of [penPath]) if (p) for (const [i, n] of pathNodes(p).entries()) {
    if (!n.via) continue;
    const w = nodeWorld(d, n);
    const isLast = !!penLast && sameNode(penLast, n);
    const isHover = !!h && h.kind === 'point' && !!h.via && h.pointId === n.pointId && h.via.bindingId === n.via.bindingId && h.via.power === n.via.power && h.via.cell.c === n.via.cell.c && h.via.cell.r === n.via.cell.r;
    out.push(<circle key={`via:${p.id}:${i}`} class={['pt', isLast && 'sel', isHover && 'hover'].filter(Boolean).join(' ')} cx={w.x} cy={w.y} r={CONFIG.HANDLE_PX / z} />);
  }
  // S2: the selected instance's nodes, drawn only there (a clone instance's are drawn by CloneAnchors).
  if (layer.value === 'drawing' && sel && sel.kind === 'path' && selPath && !sel.copy.bindingId && !showAll) {
    const M = copyMatrix(sel.copy), k = sel.copy.cell;
    pathNodes(selPath).forEach((n, i) => {
      const w = apply(M, nodeWorld(d, n));
      const isHover = !!h && h.kind === 'point' && h.pointId === n.pointId && (n.via
        ? !!h.via && h.via.bindingId === n.via.bindingId && h.via.power === n.via.power && h.via.cell.c === n.via.cell.c + k.c && h.via.cell.r === n.via.cell.r + k.r
        : !h.via && h.cell.c === n.cell.c + k.c && h.cell.r === n.cell.r + k.r);
      out.push(<circle key={`sel:${i}`} class={['pt', isHover && 'hover'].filter(Boolean).join(' ')} cx={w.x} cy={w.y} r={CONFIG.HANDLE_PX / z} />);
    });
  }
  return <g class={layer.value === 'drawing' ? undefined : 'inactive-layer'}>{out}</g>;
}

function CloneAnchors() {
  if (layer.value !== 'drawing') return null;
  const d = doc.value, z = view.value.zoom, sel = selection.value, h = hover.value, s = 10 / z, out: JSX.Element[] = [];
  for (const ci of copies.value) {
    if (!ci.copy.bindingId) continue;
    const selected = !!sel && sel.kind === 'path' && sel.id === ci.pathId && sameCopy(sel.copy, ci.copy);
    if (!selected && tool.value !== 'freehand' && tool.value !== 'pen') continue;
    const p = getPath(d, ci.pathId); if (!p) continue;
    const P = pathWorld(d, p).map((q) => apply(ci.M, q));
    pathNodes(p).forEach((n, i) => {
      if (n.via) return;   // not an anchor (see hit.ts)
      const isHover = !!h && h.kind === 'canchor' && h.pointId === n.pointId && sameCopy(h.copy, ci.copy);
      out.push(<rect key={`${ci.pathId}:${cellKey(ci.copy.cell)}:${ci.copy.bindingId}:${ci.copy.power}:${i}`} class={['canchor', selected && 'sel', isHover && 'hover'].filter(Boolean).join(' ')} x={P[i].x - s / 2} y={P[i].y - s / 2} width={s} height={s} rx={2 / z} />);
    });
  }
  return <g>{out}</g>;
}

function Elements() {
  const d = doc.value, z = view.value.zoom, sel = selection.value, h = hover.value, E = 2.4 * latticeRadius();
  const armed = new Set(d.newPathGroups.flat());
  const selId = sel && sel.kind === 'element' ? sel.id : null;
  const hovId = h && (h.kind === 'element' || h.kind === 'elrot' || h.kind === 'eltip') ? h.elementId : null;
  return <g class={layer.value === 'construction' ? undefined : 'inactive-layer'}>{d.elements.map((e) => {
    const selected = selId === e.id, c = toWorld(e, d.lattice);
    const mark = ['el-mark', armed.has(e.id) && 'armed', hovId === e.id && 'hover'].filter(Boolean).join(' ');
    if (e.kind === 'rotate') return <g key={e.id}>
      <line class="el-cross" x1={c.x - 14 / z} y1={c.y} x2={c.x + 14 / z} y2={c.y} /><line class="el-cross" x1={c.x} y1={c.y - 14 / z} x2={c.x} y2={c.y + 14 / z} />
      <circle class={mark} cx={c.x} cy={c.y} r={(selected ? 9 : 7) / z} stroke-width={selected ? 2.5 : 1.5} />
      <text class="el-label" x={c.x + 10 / z} y={c.y - 10 / z} font-size={11 / z}>{e.n}</text></g>;
    if (e.kind === 'mirror') {
      const dir = mirrorDir(e), R = CONFIG.ELEMENT_ROT_OFFSET / z;
      return <g key={e.id}>
        <line class="el-line" x1={c.x - E * dir.x} y1={c.y - E * dir.y} x2={c.x + E * dir.x} y2={c.y + E * dir.y} stroke-width={selected ? 2.5 : 1.5} opacity={armed.has(e.id) || selected ? 1 : 0.6} />
        <circle class={mark} cx={c.x} cy={c.y} r={(selected ? 8 : 6) / z} stroke-width={selected ? 2.5 : 1.5} />
        {selected && <circle class={hoverIs(h, 'elrot') ? 'el-knob hover' : 'el-knob'} cx={c.x + R * dir.x} cy={c.y + R * dir.y} r={6 / z} />}</g>;
    }
    const s = 10 / z;
    return <g key={e.id}>
      <line class="el-arrow" x1={0} y1={0} x2={c.x} y2={c.y} opacity={armed.has(e.id) || selected ? 1 : 0.6} />
      <rect class={mark} x={c.x - s / 2} y={c.y - s / 2} width={s} height={s} transform={`rotate(45 ${c.x} ${c.y})`} />
      <text class="el-label" x={c.x + 10 / z} y={c.y - 10 / z} font-size={11 / z}>{fmtFrac(e.u)}, {fmtFrac(e.v)}</text></g>;
  })}</g>;
}

export function fmtFrac(x: number): string {
  if (Math.abs(x) < 1e-9) return '0';
  for (const d of [1, 2, 3, 4, 6, 12]) { const n = Math.round(x * d); if (Math.abs(n / d - x) < 1e-6) return d === 1 ? `${n}` : `${n}/${d}`; }
  return x.toFixed(2);
}

function LatticeHandles() {
  const lat = doc.value.lattice, z = view.value.zoom, h = hover.value;
  return <g class={layer.value === 'construction' ? undefined : 'inactive-layer'}>{([['a', lat.ax, lat.ay], ['b', lat.bx, lat.by]] as const).map(([w, x, y]) => <g key={w}>
    <line class="lat-line" x1={0} y1={0} x2={x} y2={y} />
    <circle class={h && h.kind === 'lat' && h.which === w ? 'lat-handle hover' : 'lat-handle'} cx={x} cy={y} r={7 / z} />
    <text class="lat-label" x={x + 10 / z} y={y - 8 / z} font-size={11 / z}>{w}</text></g>)}</g>;
}

function SnapMark() {
  const h = snapHint.value;
  if (!h) return null;
  const z = view.value.zoom;
  return <g class="snap-mark">
    {h.line && <polyline class="snap-line" points={h.line.map((p) => `${p.x},${p.y}`).join(' ')} />}
    <circle class="snap-ring" cx={h.at.x} cy={h.at.y} r={7 / z} />
    {h.label && <text class="snap-label" x={h.at.x + 10 / z} y={h.at.y - 10 / z} font-size={12 / z}>{h.label}</text>}
  </g>;
}

function cursorFor(): string {
  const h = hover.value, t = tool.value;
  if (space.value && pen.value) return 'grab';
  if (layer.value === 'construction') return h ? (h.kind === 'elrot' || h.kind === 'eltip' ? 'grab' : 'move') : 'default';
  if (h && h.kind === 'bbox') return bboxCursor(h.h);
  if (h && (h.kind === 'bboxrot' || h.kind === 'diamond')) return 'grab';
  if (h && (h.kind === 'point' || h.kind === 'segment' || h.kind === 'canchor' || h.kind === 'fill')) return 'pointer';
  return t === 'select' || t === 'fill' ? 'default' : 'crosshair';
}
const bboxCursor = (i: number) => ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize', 'ns-resize', 'ns-resize', 'ew-resize', 'ew-resize'][i];

export function Canvas() {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => attachPointer(ref.current!), []);
  const v = view.value;
  const drawing = layer.value === 'drawing';
  return (
    <svg ref={ref} class="canvas" style={{ cursor: cursorFor() }} data-testid="canvas">
      <CellDefs />
      <g transform={`translate(${v.pan.x} ${v.pan.y}) scale(${v.zoom})`}>
        <Grid /><Frames /><ElementGhosts />
        <g class={drawing ? undefined : 'inactive-layer'}>{doc.value.layers.map((l) => <Uses key={l.id} id={`cell-layer-${l.id}`} />)}</g>
        <Highlights /><Guides /><FreehandPreview /><Marquee /><Rubber /><BBox /><Diamonds /><Points /><CloneAnchors /><Elements /><LatticeHandles /><SnapMark />
      </g>
    </svg>
  );
}
