import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { doc } from '../state/doc';
import * as UI from '../state/ui';
import * as A from '../actions';
import { canUndo, canRedo, historyVersion } from '../state/history';
import { cloneMatrices, openElements } from '../state/derived';
import { orbit, cloneCount, mirrorAngle } from '../engine/transform';
import { latticeAngle } from '../engine/lattice';
import { getPath, getBinding, getElement, getFill } from '../engine/paths';
import { exportSvg, serializeDoc, parseDoc } from '../engine/serialize';
import { CONFIG } from '../config';
import { fmtFrac } from './Canvas';
import type { Element, Binding, Lattice } from '../types';

const SYMBOL = { rotate: '↻', mirror: '⟋', translate: '⇢' } as const;
export function elementLabel(el: Element): string { return `${SYMBOL[el.kind]}${doc.value.elements.indexOf(el) + 1}`; }
export function chainLabel(groups: string[][]): string { const one = (g: string[]) => g.map((id) => { const e = getElement(doc.value, id); return e ? elementLabel(e) : '?'; }).join(' → '); return groups.map(one).join(' · then ') || '(empty)'; }
const orbitOf = (groups: string[][]) => orbit(groups, doc.value.elements, doc.value.lattice, CONFIG.ORBIT_CAP, CONFIG.CLONE_CAP);

type BtnProps = { on?: boolean; cls?: string; kbd?: string; title?: string; disabled?: boolean; onClick: () => void; children: ComponentChildren };
function Btn({ on, cls = '', kbd, title, disabled, onClick, children }: BtnProps) {
  return <button class={`btn ${cls}${on ? ' on' : ''}`} title={title ?? ''} disabled={disabled} onClick={onClick}>{children}{kbd && <> <span class="kbd">{kbd}</span></>}</button>;
}
const Sep = () => <span class="sep" />;
const Label = ({ children }: { children: ComponentChildren }) => <span class="label">{children}</span>;

function latticeFits(n: number, lat: Lattice): boolean {
  const equal = Math.abs(Math.hypot(lat.ax, lat.ay) - Math.hypot(lat.bx, lat.by)) < 1, ang = latticeAngle(lat);
  if (n === 2) return true;
  if (n === 4) return equal && Math.abs(ang - 90) < 1;
  if (n === 3 || n === 6) return equal && (Math.abs(ang - 60) < 1 || Math.abs(ang - 120) < 1);
  return false;
}

function LayerBar() {
  const cons = UI.layer.value === 'construction';
  return <div class="panel">
    <Btn on={!cons} title="Drawing layer: paths, points, fills (Tab)" onClick={() => A.setLayer('drawing')}>✎ Drawing</Btn>
    <Btn on={cons} cls="violet" title="Construction layer: elements and lattice (Tab)" onClick={() => A.setLayer('construction')}>⟋ Construction</Btn>
  </div>;
}

function LayerPicker() {
  const d = doc.value, active = A.activeLayerId(d);
  return <>{d.layers.map((l) => <Btn key={l.id} cls="small" on={l.id === active} title={`New paths and fills go to ${l.name}`} onClick={() => A.setActiveLayer(l.id)}>{l.name}</Btn>)}
    <Btn cls="small outline" title="Add a layer on top and make it active" onClick={() => A.addLayer()}>+ layer</Btn></>;
}

function ToolBar() {
  const t = UI.tool.value, p = UI.prefs.value;
  return <div class="panel">
    <Btn on={t === 'select'} kbd="V" title="Select (V)" onClick={() => A.setTool('select')}>↖ Select</Btn>
    <Btn on={t === 'pen'} kbd="P" title="Pen (P)" onClick={() => A.setTool('pen')}>✎ Pen</Btn>
    <Btn on={t === 'freehand'} kbd="F" title="Freehand (F)" onClick={() => A.setTool('freehand')}>〰 Freehand</Btn>
    <Btn on={t === 'fill'} kbd="B" title="Fill (B)" onClick={() => A.setTool('fill')}>◐ Fill</Btn>
    <Sep />
    <LayerPicker />
    <Sep />
    <Btn on={p.snap} cls="small" kbd="G" title="Grid snapping (G); hold Shift to invert" onClick={() => A.toggleSnap()}>⌗ Snap</Btn>
    {UI.pen.value && <><Sep /><Btn cls="small outline" kbd="↵" title="End the current path (Enter / Esc)" onClick={() => A.endPen()}>End path</Btn></>}
    {t === 'select' && <Btn cls="small" on={UI.addToSelection.value} title="Add to the selection while marquee-selecting (stands in for Shift)" onClick={() => A.toggleAddToSelection()}>Add</Btn>}
  </div>;
}

function ElementsBar() {
  const d = doc.value, open = openElements.value;
  return <div class="panel bar">
    <Label>Elements</Label>
    <Btn cls="violet" kbd="O" title="Add a rotation (1/n turn). New paths are cloned through it." onClick={() => A.addElement('rotate')}>+ ↻ Rotation</Btn>
    <Btn cls="violet" kbd="M" title="Add a mirror line." onClick={() => A.addElement('mirror')}>+ ⟋ Mirror</Btn>
    <Btn cls="violet" kbd="T" title="Add a translation by a fraction of the lattice." onClick={() => A.addElement('translate')}>+ ⇢ Translate</Btn>
    {d.elements.map((e) => <Btn key={e.id} cls="small violet" on={A.isNewPathGroup([e.id])} title={A.isNewPathGroup([e.id]) ? 'Applies to new paths · click to select' : 'Click to select'} onClick={() => A.selectElement(e.id)}>{elementLabel(e)}{open.has(e.id) ? ' ⚠' : ''}</Btn>)}
    {d.elements.length > 0 && <Label>filled = applies to new paths</Label>}
    {open.size > 0 && <Label>⚠ an element does not close on this lattice</Label>}
  </div>;
}

function PresetIcon({ p }: { p: Lattice }) {
  const pts = [[0, 0], [p.ax, p.ay], [p.ax + p.bx, p.ay + p.by], [p.bx, p.by]].map(([x, y]) => `${10 + ((x + 120) / 480) * 40},${8 + ((y + 20) / 240) * 22}`).join(' ');
  return <svg width="34" height="22" viewBox="0 0 60 36"><polygon points={pts} fill="none" stroke="currentColor" stroke-width="2" /></svg>;
}

function LatticeBar() {
  const l = doc.value.lattice;
  const isOn = (p: Lattice) => (['ax', 'ay', 'bx', 'by'] as const).every((k) => Math.abs(p[k] - l[k]) < 0.5);
  return <div class="panel bar">
    <Label>▱ Lattice</Label>
    {Object.entries(CONFIG.LATTICE_PRESETS).map(([name, p]) => <Btn key={name} cls="small preset" on={isOn(p)} title={name} onClick={() => A.setLattice(p)}><PresetIcon p={p} />{name}</Btn>)}
    <Label>a {Math.round(Math.hypot(l.ax, l.ay))} · b {Math.round(Math.hypot(l.bx, l.by))} · {Math.round(latticeAngle(l))}° · drag the pink a / b handles</Label>
  </div>;
}

function ChainRow({ b }: { b: Binding }) {
  const o = orbitOf(b.groups), n = cloneCount(o);
  return <>
    <Label>{chainLabel(b.groups)} · {n} clone{n === 1 ? '' : 's'}{o.open ? ' ⚠' : ''}</Label>
    <Btn cls="small" on={A.isNewPathGroups(b.groups)} title="Give new paths this binding" onClick={() => A.setNewPathGroups(b.groups)}>★</Btn>
    <Btn cls="small" title="Remove this binding" onClick={() => A.removeBinding(b.id)}>✕</Btn>
    <Sep />
  </>;
}

function SelectionBar() {
  const s = UI.selection.value, d = doc.value;
  if (!s || s.kind === 'points') return null;
  let inner: ComponentChildren = null;
  if (s.kind === 'path') {
    const path = getPath(d, s.id); if (!path) return null;
    const b = s.copy.bindingId ? getBinding(d, s.copy.bindingId) : null;
    inner = <>
      <Label>{b ? `Clone of path ${d.paths.indexOf(path) + 1} via ${chainLabel(b.groups)} · clone ${s.copy.power}` : `Path ${d.paths.indexOf(path) + 1}`}</Label>
      {b && <Btn cls="small violet" title="Select the first element of this clone's chain (switches to Construction)" onClick={() => { const first = b.groups[0]?.[0]; if (first) { A.selectElement(first); A.setLayer('construction'); } }}>Select its element</Btn>}
      {b && <Btn cls="small outline" title="Select the source path in the base cell" onClick={() => A.selectPathAt(path.id)}>Select source path</Btn>}
      {d.bindings.filter((x) => x.pathId === path.id).map((x) => <ChainRow key={x.id} b={x} />)}
      <Btn cls="small violet" title="New rotation cloning this path" onClick={() => A.addElement('rotate')}>+ ↻</Btn>
      <Btn cls="small violet" title="New mirror cloning this path" onClick={() => A.addElement('mirror')}>+ ⟋</Btn>
      <Btn cls="small violet" title="New translation cloning this path" onClick={() => A.addElement('translate')}>+ ⇢</Btn>
      <Sep />
      {path.segments.some((x) => x.cp) && <Btn cls="small outline" title="Straighten every curved segment (double-click a diamond for one)" onClick={() => A.straightenPath(path.id)}>Straighten</Btn>}
      <Btn cls="small" on={UI.freeScale.value} title="Scale freely from the box corners (stands in for Shift)" onClick={() => A.toggleFreeScale()}>Free</Btn>
    </>;
  } else if (s.kind === 'element') {
    const el = getElement(d, s.id); if (!el) return null;
    const bound = d.bindings.filter((x) => x.groups.some((g) => g.includes(el.id))).length;
    const name = { rotate: 'Rotation', mirror: 'Mirror', translate: 'Translation' }[el.kind];
    inner = <>
      <Label>{name} {elementLabel(el)}</Label>
      <Btn cls="small violet" on={A.isNewPathGroup([el.id])} title="Clone every new path through this element" onClick={() => A.toggleNewPathGroup([el.id])}>Apply to new paths</Btn>
      <Sep />
      {el.kind === 'rotate' && <>{[2, 3, 4, 6].map((n) => <Btn key={n} cls="small outline" on={el.n === n} title={`${n}-fold rotation`} onClick={() => A.setRotationOrder(el.id, n)}>1/{n}</Btn>)}{!latticeFits(el.n, d.lattice) && <Label>⚠ 1/{el.n} does not tile on this lattice</Label>}</>}
      {el.kind === 'mirror' && <><Btn cls="small outline" title="Rotate −15° ([)" onClick={() => A.rotateMirror(el.id, -15)}>↺</Btn><Btn cls="small outline" title="Rotate +15° (])" onClick={() => A.rotateMirror(el.id, 15)}>↻</Btn><Label>{Math.round(mirrorAngle(el, d.lattice))}°</Label></>}
      {el.kind === 'translate' && <><Label>({fmtFrac(el.u)}, {fmtFrac(el.v)})</Label>{([['½ a', 0.5, 0], ['⅓ a', 1 / 3, 0], ['½ b', 0, 0.5], ['½ a+b', 0.5, 0.5]] as const).map(([t, u, v]) => <Btn key={t} cls="small outline" on={Math.abs(el.u - u) < 1e-9 && Math.abs(el.v - v) < 1e-9} title="Set the translation vector" onClick={() => A.setTranslation(el.id, u, v)}>{t}</Btn>)}</>}
      <Label>{bound ? `· in ${bound} binding${bound > 1 ? 's' : ''}` : '· no paths yet'}</Label>
    </>;
  } else if (s.kind === 'fill') {
    inner = <Label>Fill · pick a colour in the palette</Label>;
  }
  return <div class="panel bar">{inner}<Sep /><Btn cls="small outline" kbd="⌫" title={s.kind === 'path' && s.copy.bindingId ? 'Remove this clone chain (⌫)' : 'Delete the selection (⌫)'} onClick={() => A.deleteSelection()}>{s.kind === 'path' && s.copy.bindingId ? 'Unlink' : 'Delete'}</Btn></div>;
}

function Palette() {
  const d = doc.value, p = UI.prefs.value, s = UI.selection.value;
  const fillSel = s && s.kind === 'fill' ? getFill(d, s.id) : null;
  const fillMode = UI.tool.value === 'fill' || !!fillSel;
  const pid = UI.selectedPathId(), path = pid ? getPath(d, pid) : null;
  const sty = path ? path.style : p.style;
  const cur = fillMode ? (fillSel ? fillSel.color : p.fillColor) : sty.color;
  return <div class="panel palette">
    <span class="title">{fillMode ? 'Fill' : path ? 'Path' : 'Stroke'}</span>
    <div class="grid">{CONFIG.SWATCHES.map(([name, c]) => <button key={c} class={`swatch${cur === c ? ' on' : ''}`} title={name} onClick={() => (fillMode ? A.setFillColor(c) : A.setStyle({ color: c }))}><span style={{ background: c }} /></button>)}</div>
    {!fillMode && <><span class="rule" /><div class="row">{CONFIG.WEIGHTS.map((w) => <button key={w} class={`weight${sty.weight === w ? ' on' : ''}`} title={`${w}px`} onClick={() => A.setStyle({ weight: w })}><span style={{ height: `${Math.max(1.5, w)}px`, background: sty.color }} /></button>)}</div></>}
  </div>;
}

function UndoBar() {
  historyVersion.value;
  return <div class="panel">
    <Btn cls="icon" title="Undo (⌘Z)" disabled={!canUndo()} onClick={() => A.undo()}>↶</Btn>
    <Btn cls="icon" title="Redo (⇧⌘Z)" disabled={!canRedo()} onClick={() => A.redo()}>↷</Btn>
  </div>;
}

function hintText(): string {
  const s = UI.selection.value, d = doc.value;
  if (UI.layer.value === 'construction') {
    if (s && s.kind === 'element') {
      const el = getElement(d, s.id);
      if (el?.kind === 'rotate') return 'Rotation: drag to move · pick 1/2, 1/3, 1/4 or 1/6 · clones turn about it';
      if (el?.kind === 'mirror') return 'Mirror: drag to move · knob or [ ] rotates · put a translation after it in a chain for a glide';
      return 'Translation: drag the diamond to set the vector · snaps to twelfths of the lattice';
    }
    return 'Construction layer: add or drag elements and lattice handles · the drawing is locked · Tab to go back';
  }
  switch (UI.tool.value) {
    case 'select':
      if (s && s.kind === 'points') return `${s.ids.length} point${s.ids.length > 1 ? 's' : ''} selected · drag to move together · ⇧-click adds · ⌫ deletes`;
      if (s && s.kind === 'path' && s.copy.bindingId) return 'Clone: drag its body to move its element · drag its anchors to edit the shared shape';
      if (s && s.kind === 'path') return 'Path: click a line to insert a point · drag ◇ to bend · double-click ◇ to straighten · box handles scale and rotate · any copy is editable';
      return 'Select: click a point, line, copy or fill · drag a line to move the path · drag empty space to marquee points';
    case 'freehand': return 'Freehand: press and drag · release to fit curves · start on a point to continue its path';
    case 'fill': return 'Fill: press to preview a closed region · release to colour it · press again to recolour';
    default:
      if (UI.pen.value) return 'Pen: click to add · click a point or clone anchor to connect · click the last point, Esc or ↵ to finish · Space+drag moves the elements';
      if (!d.points.length && !d.elements.length) return 'Add an element (O rotation, M mirror, T translation), then draw — every stroke is cloned through it in every cell';
      return 'Pen: click a point to start or resume a path · click empty space to add a point';
  }
}

function Hint() {
  const d = doc.value, cm = cloneMatrices.value;
  const clones = [...cm.values()].reduce((n, ms) => n + cloneCount({ matrices: ms }), 0);
  const pl = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const saved = UI.lastSavedAt.value && Date.now() - UI.lastSavedAt.value < 1500 ? ' · saved' : '';
  return <div class="hint"><span class="text">{hintText()}</span><span class="counts">{pl(d.points.length, 'point')} · {pl(d.paths.length, 'path')} · {pl(d.elements.length, 'element')} · {pl(clones, 'clone')} · {pl(d.fills.length, 'fill')}{saved}</span></div>;
}

const K = ({ k }: { k: string }) => <span class="kbd">{k}</span>;
function Help() {
  const p = UI.prefs.value;
  return <div class="help">
    <span><K k="Tab" /> Drawing ↔ Construction · only the active layer responds to the pointer</span>
    <span><K k="V" /> select · <K k="P" /> pen · <K k="F" /> freehand · <K k="B" /> fill · <K k="G" /> snap (hold <K k="⇧" /> to invert)</span>
    <span><K k="O" /> rotation · <K k="M" /> mirror · <K k="T" /> translation — bound to the selected path, else applied to new paths</span>
    <span class="violet">Elements: drag to move · mirror knob or <K k="[" /> <K k="]" /> rotates · translation diamond sets the vector · a group applies left to right; a mirror then a half translation is a glide; a "then" group stacks on the clones so far</span>
    <span>Pen: click a point to start or resume · click empty space to add · click the last point, <K k="Esc" /> or <K k="↵" /> to end · <K k="Space" />+drag moves the elements</span>
    <span>Select: click any copy of a line to select its path there, again to insert a point · drag ◇ to bend, double-click to straighten · marquee points · <K k="⇧" /> adds · box handles scale / rotate</span>
    <span>Clone: drag its body to move its element · drag its anchors to edit the shared point</span>
    <span>Fill: press to preview a closed region, release to colour · fills draw below the lines of their layer; put them on a higher layer to cover lines</span>
    <span>Wheel pans · <K k="⌘" />+wheel zooms · two fingers pan and pinch · <K k="⌘0" /> fits · hover a point + <K k="⌫" /> deletes · <K k="⌘Z" /> undo · <K k="⇧⌘Z" /> redo</span>
    <div class="settings">
      <label>Grid <input type="range" min="2" max="16" step="1" value={p.gridDivisions} onInput={(e) => A.setGridDivisions(+(e.currentTarget as HTMLInputElement).value)} /> {p.gridDivisions}</label>
      <label>Ghosts <input type="range" min="0.1" max="1" step="0.05" value={p.ghostOpacity} onInput={(e) => A.setGhostOpacity(+(e.currentTarget as HTMLInputElement).value)} /></label>
      <Btn cls="small outline" title="Fit the tile (⌘0)" onClick={() => A.fitToTile()}>Reset view</Btn>
    </div>
  </div>;
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportPopover() {
  const [mode, setMode] = useState<'tile' | 'grid3' | 'wall'>('wall');
  const [rows, setRows] = useState(8);
  const [cols, setCols] = useState(12);
  const [error, setError] = useState('');
  const run = () => {
    try {
      const m = mode === 'tile' ? { kind: 'tile' as const } : mode === 'grid3' ? { kind: 'grid' as const, rows: 3, cols: 3 } : { kind: 'grid' as const, rows, cols };
      download(mode === 'tile' ? 'tile.svg' : `tessellation-${m.kind === 'grid' ? `${m.cols}x${m.rows}` : ''}.svg`, exportSvg(doc.value, m), 'image/svg+xml');
      UI.exportOpen.value = false;
    } catch (err) { setError((err as Error).message); }
  };
  return <div class="popover" data-testid="export-popover">
    <div style={{ display: 'flex', gap: '4px' }}>
      <Btn cls="small" on={mode === 'tile'} title="A single tile, clipped to the cell" onClick={() => setMode('tile')}>Tile</Btn>
      <Btn cls="small" on={mode === 'grid3'} title="The 3×3 window around the tile" onClick={() => setMode('grid3')}>3×3</Btn>
      <Btn cls="small" on={mode === 'wall'} title="A rectangular field of columns × rows cells" onClick={() => setMode('wall')}>Wallpaper</Btn>
    </div>
    {mode === 'wall' && <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>Columns <input class="field" type="number" min="1" max={CONFIG.MAX_WALLPAPER} value={cols} onInput={(e) => setCols(+(e.currentTarget as HTMLInputElement).value)} /> Rows <input class="field" type="number" min="1" max={CONFIG.MAX_WALLPAPER} value={rows} onInput={(e) => setRows(+(e.currentTarget as HTMLInputElement).value)} /></label>}
    {error && <Label>⚠ {error}</Label>}
    <Btn cls="outline" title="Download the exported SVG" onClick={run}>Download SVG</Btn>
  </div>;
}

function FileGroup() {
  const importJson = () => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json' });
    input.onchange = async () => {
      const f = input.files?.[0]; if (!f) return;
      const d = parseDoc(await f.text());
      if (!d) { alert('That file is not a Tessellator document this version understands.'); return; }
      if (doc.value.paths.length && !confirm('Replace the current design?')) return;
      A.importDocument(d); A.fitToTile();
    };
    input.click();
  };
  return <div class="panel">
    <Btn cls="small outline" on={UI.exportOpen.value} title="Export as SVG" onClick={() => { UI.exportOpen.value = !UI.exportOpen.value; }}>Export SVG</Btn>
    <Btn cls="small outline" title="Download the document as JSON" onClick={() => download('tessellation.json', serializeDoc(doc.value), 'application/json')}>Export JSON</Btn>
    <Btn cls="small outline" title="Load a JSON document" onClick={importJson}>Import JSON</Btn>
    <Btn cls="small outline" title="Start a new design" onClick={() => { if (!doc.value.paths.length || confirm('Discard the current design?')) A.newDocument(); }}>New</Btn>
  </div>;
}

export function TopRight() {
  return <div class="top-right">
    <div style={{ display: 'flex', gap: '8px' }}><FileGroup /><Btn cls="icon outline" title="Shortcuts and settings (?)" onClick={() => A.toggleHelp()}>?</Btn></div>
    {UI.exportOpen.value && <ExportPopover />}
    {UI.showHelp.value && <Help />}
  </div>;
}

export function Chrome() {
  const cons = UI.layer.value === 'construction';
  return <div class="chrome">
    <div class="top-left"><LayerBar />{!cons && <ToolBar />}{cons && !UI.selection.value && <><ElementsBar /><LatticeBar /></>}<SelectionBar /></div>
    <div class="bottom-left">{!cons && <Palette />}<UndoBar /></div>
    <Hint />
    <TopRight />
  </div>;
}
