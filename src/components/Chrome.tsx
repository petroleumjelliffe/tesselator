import type { ComponentChildren } from 'preact';
import { Fragment } from 'preact';
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
import { STR } from '../strings';

const SYMBOL = STR.bar.symbol;
export function elementLabel(el: Element): string { return `${SYMBOL[el.kind]}${doc.value.elements.indexOf(el) + 1}`; }
export function chainLabel(groups: string[][]): string { const one = (g: string[]) => g.map((id) => { const e = getElement(doc.value, id); return e ? elementLabel(e) : '?'; }).join(STR.bar.chainArrow); return groups.map(one).join(STR.bar.chainThen) || STR.bar.chainEmpty; }
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
    <Btn on={!cons} title={STR.titles.drawingLayer} onClick={() => A.setLayer('drawing')}>{STR.bar.drawing}</Btn>
    <Btn on={cons} cls="violet" title={STR.titles.constructionLayer} onClick={() => A.setLayer('construction')}>{STR.bar.construction}</Btn>
  </div>;
}

function LayerPicker() {
  const d = doc.value, active = A.activeLayerId(d);
  return <>{d.layers.map((l, i) => <Btn key={l.id} cls="small" on={l.id === active} title={STR.titles.layerPick(l.name, i + 1, d.layers.length)} onClick={() => A.setActiveLayer(l.id)}>{l.name}</Btn>)}
    <Btn cls="small outline" title={STR.titles.addLayer} onClick={() => A.addLayer()}>{STR.bar.addLayer}</Btn></>;
}

function ToolBar() {
  const t = UI.tool.value, p = UI.prefs.value;
  return <div class="panel">
    <Btn on={t === 'select'} kbd="V" title={STR.titles.select} onClick={() => A.setTool('select')}>{STR.bar.select}</Btn>
    <Btn on={t === 'pen'} kbd="P" title={STR.titles.pen} onClick={() => A.setTool('pen')}>{STR.bar.pen}</Btn>
    <Btn on={t === 'freehand'} kbd="F" title={STR.titles.freehand} onClick={() => A.setTool('freehand')}>{STR.bar.freehand}</Btn>
    <Btn on={t === 'fill'} kbd="B" title={STR.titles.fill} onClick={() => A.setTool('fill')}>{STR.bar.fill}</Btn>
    <Sep />
    <LayerPicker />
    <Sep />
    <Btn on={p.grid} cls="small" kbd="G" title={STR.titles.grid} onClick={() => A.toggleGrid()}>{STR.bar.grid}</Btn>
    {UI.pen.value && <><Sep /><Btn cls="small outline" kbd="↵" title={STR.titles.endPath} onClick={() => A.endPen()}>{STR.bar.endPath}</Btn></>}
    {t === 'select' && <Btn cls="small" on={UI.addToSelection.value} title={STR.titles.addToSelection} onClick={() => A.toggleAddToSelection()}>{STR.bar.addToSelection}</Btn>}
  </div>;
}

function ElementsBar() {
  const d = doc.value, open = openElements.value;
  return <div class="panel bar">
    <Label>{STR.bar.elements}</Label>
    <Btn cls="violet" kbd="O" title={STR.titles.addRotation} onClick={() => A.addElement('rotate')}>{STR.bar.addRotation}</Btn>
    <Btn cls="violet" kbd="M" title={STR.titles.addMirror} onClick={() => A.addElement('mirror')}>{STR.bar.addMirror}</Btn>
    <Btn cls="violet" kbd="T" title={STR.titles.addTranslate} onClick={() => A.addElement('translate')}>{STR.bar.addTranslate}</Btn>
    {d.elements.map((e) => <Btn key={e.id} cls="small violet" on={A.isNewPathElement(e.id)} title={STR.titles.elementChip(A.isNewPathElement(e.id))} onClick={() => A.selectElement(e.id)}>{elementLabel(e)}{open.has(e.id) ? STR.bar.newPathWarn : ''}</Btn>)}
    {d.elements.length > 0 && <Label>{STR.bar.filledMeansNewPaths}</Label>}
    {open.size > 0 && <Label>{STR.bar.openWarning}</Label>}
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
    <Label>{STR.bar.lattice}</Label>
    {Object.entries(CONFIG.LATTICE_PRESETS).map(([name, p]) => <Btn key={name} cls="small preset" on={isOn(p)} title={name} onClick={() => A.setLattice(p)}><PresetIcon p={p} />{name}</Btn>)}
    <Label>{STR.bar.latticeInfo(Math.round(Math.hypot(l.ax, l.ay)), Math.round(Math.hypot(l.bx, l.by)), Math.round(latticeAngle(l)))}</Label>
  </div>;
}

// One cluster per group: every element is a chip; lit = in this group. Clicking a lit chip removes the element from
// the binding; clicking an unlit one moves the element into this group (an element appears at most once per binding).
function GroupCluster({ b, gi, group, pending }: { b: Binding; gi: number; group: string[]; pending?: boolean }) {
  const d = doc.value;
  return <span class={pending ? 'group pending' : 'group'}>
    {d.elements.map((e) => { const here = group.includes(e.id); return <Btn key={e.id} cls="small violet" on={here} title={here ? STR.titles.removeFromBinding : gi === b.groups.length ? STR.titles.startNewGroupWithElement : STR.titles.putInGroup} onClick={() => (here ? A.removeElementFromBinding(b.id, e.id) : A.placeElementInGroup(b.id, e.id, gi))}>{elementLabel(e)}</Btn>; })}
    {pending && <Btn cls="small" title={STR.titles.cancelNewGroup} onClick={() => A.cancelPending()}>{STR.bar.close}</Btn>}
  </span>;
}

function ChainRow({ b }: { b: Binding }) {
  const o = orbitOf(b.groups), n = cloneCount(o), pending = UI.pendingGroup.value;
  const pendingHere = !!pending && 'bindingId' in pending && pending.bindingId === b.id;
  return <>
    <Label>{STR.bar.clonesLabel(n, o.open)}</Label>
    {b.groups.map((g, gi) => <Fragment key={gi}>{gi > 0 && <Label>{STR.bar.then}</Label>}<GroupCluster b={b} gi={gi} group={g} /></Fragment>)}
    {pendingHere
      ? <><Label>{STR.bar.then}</Label><GroupCluster b={b} gi={b.groups.length} group={[]} pending /></>
      : <Btn cls="small outline" title={STR.titles.addThenGroup} onClick={() => A.startGroup(b.id)}>{STR.bar.addThenGroup}</Btn>}
    <Btn cls="small" on={A.isNewPathGroups(b.groups)} title={STR.titles.newPathBinding} onClick={() => A.setNewPathGroups(b.groups)}>{STR.bar.newPathStar}</Btn>
    <Btn cls="small" title={STR.titles.removeBinding} onClick={() => A.removeBinding(b.id)}>{STR.bar.close}</Btn>
    <Sep />
  </>;
}

// "+ chain": a second, independent binding on the path. It exists only once it has an element.
function NewChain({ pathId }: { pathId: string }) {
  const d = doc.value, pending = UI.pendingGroup.value;
  if (!(pending && 'pathId' in pending && pending.pathId === pathId)) return <Btn cls="small outline" title={STR.titles.startChain} onClick={() => A.startChain(pathId)}>{STR.bar.startChain}</Btn>;
  return <span class="group pending">
    {d.elements.map((e) => <Btn key={e.id} cls="small violet" title={STR.titles.startNewBindingWithElement} onClick={() => A.addElementToNewChain(pathId, e.id)}>{elementLabel(e)}</Btn>)}
    <Btn cls="small" title={STR.titles.cancelNewBinding} onClick={() => A.cancelPending()}>{STR.bar.close}</Btn>
  </span>;
}

function SelectionBar() {
  const s = UI.selection.value, d = doc.value;
  if (!s || s.kind === 'points') return null;
  let inner: ComponentChildren = null;
  if (s.kind === 'path') {
    const path = getPath(d, s.id); if (!path) return null;
    const b = s.copy.bindingId ? getBinding(d, s.copy.bindingId) : null;
    inner = <>
      <Label>{b ? STR.bar.cloneOfPath(d.paths.indexOf(path) + 1, chainLabel(b.groups), s.copy.power) : STR.bar.pathLabel(d.paths.indexOf(path) + 1)}</Label>
      {b && <Btn cls="small violet" title={STR.titles.selectCloneElement} onClick={() => { const first = b.groups[0]?.[0]; if (first) { A.selectElement(first); A.setLayer('construction'); } }}>{STR.bar.selectCloneElement}</Btn>}
      {b && <Btn cls="small outline" title={STR.titles.selectSourcePath} onClick={() => A.selectPathAt(path.id)}>{STR.bar.selectSourcePath}</Btn>}
      {d.bindings.filter((x) => x.pathId === path.id).map((x) => <ChainRow key={x.id} b={x} />)}
      {d.elements.length === 0 ? <Label>{STR.bar.addElementPrompt}</Label> : <NewChain pathId={path.id} />}
      <Btn cls="small violet" title={STR.titles.newGroupedRotation} onClick={() => A.addElement('rotate')}>{STR.bar.newRotation}</Btn>
      <Btn cls="small violet" title={STR.titles.newGroupedMirror} onClick={() => A.addElement('mirror')}>{STR.bar.newMirror}</Btn>
      <Btn cls="small violet" title={STR.titles.newGroupedTranslate} onClick={() => A.addElement('translate')}>{STR.bar.newTranslate}</Btn>
      <Sep />
      {path.segments.some((x) => x.cp) && <Btn cls="small outline" title={STR.titles.straighten} onClick={() => A.straightenPath(path.id)}>{STR.bar.straighten}</Btn>}
      <Btn cls="small" on={UI.keepProportions.value} title={STR.titles.keepProportions} onClick={() => A.toggleKeepProportions()}>{STR.bar.keepProportions}</Btn>
      <Sep /><Label>{STR.bar.layerColon}</Label>{d.layers.map((l) => <Btn key={l.id} cls="small" on={l.id === path.layerId} title={STR.titles.moveToLayer(l.name)} onClick={() => A.setPathLayer(path.id, l.id)}>{l.name}</Btn>)}
    </>;
  } else if (s.kind === 'element') {
    const el = getElement(d, s.id); if (!el) return null;
    const bound = d.bindings.filter((x) => x.groups.some((g) => g.includes(el.id))).length;
    const name = STR.bar.elementName[el.kind];
    inner = <>
      <Label>{STR.bar.elementLabel(name, elementLabel(el))}</Label>
      <Btn cls="small violet" on={A.isNewPathElement(el.id)} title={STR.titles.applyElementToNewPaths} onClick={() => A.toggleNewPathElement(el.id)}>{STR.bar.applyToNewPaths}</Btn>
      <Sep />
      {el.kind === 'rotate' && <>{[2, 3, 4, 6].map((n) => <Btn key={n} cls="small outline" on={el.n === n} title={STR.titles.nFoldRotation(n)} onClick={() => A.setRotationOrder(el.id, n)}>{STR.bar.oneOverN(n)}</Btn>)}{!latticeFits(el.n, d.lattice) && <Label>{STR.bar.doesNotTile(el.n)}</Label>}</>}
      {el.kind === 'mirror' && <><Btn cls="small outline" title={STR.titles.rotateMirrorCCW} onClick={() => A.rotateMirror(el.id, -15)}>{STR.bar.rotateCCW}</Btn><Btn cls="small outline" title={STR.titles.rotateMirrorCW} onClick={() => A.rotateMirror(el.id, 15)}>{STR.bar.rotateCW}</Btn><Label>{Math.round(mirrorAngle(el, d.lattice))}°</Label></>}
      {el.kind === 'translate' && <><Label>({fmtFrac(el.u)}, {fmtFrac(el.v)})</Label>{([[STR.bar.translationPreset.halfA, 0.5, 0], [STR.bar.translationPreset.thirdA, 1 / 3, 0], [STR.bar.translationPreset.halfB, 0, 0.5], [STR.bar.translationPreset.halfAB, 0.5, 0.5]] as const).map(([t, u, v]) => <Btn key={t} cls="small outline" on={Math.abs(el.u - u) < 1e-9 && Math.abs(el.v - v) < 1e-9} title={STR.titles.setTranslationVector} onClick={() => A.setTranslation(el.id, u, v)}>{t}</Btn>)}</>}
      <Label>{bound ? STR.bar.boundIn(bound) : STR.bar.noPathsYet}</Label>
    </>;
  } else if (s.kind === 'paths') {
    inner = <Label>{STR.bar.instancesDelete(s.items.length)}</Label>;
  } else if (s.kind === 'fill') {
    const fill = getFill(d, s.id); if (!fill) return null;
    inner = <><Label>{STR.bar.fillPickColour}</Label><Sep /><Label>{STR.bar.layerColon}</Label>{d.layers.map((l) => <Btn key={l.id} cls="small" on={l.id === fill.layerId} title={STR.titles.moveFillToLayer(l.name)} onClick={() => A.setFillLayer(fill.id, l.id)}>{l.name}</Btn>)}</>;
  }
  return <div class="panel bar">{inner}<Sep /><Btn cls="small outline" kbd="⌫" title={s.kind === 'path' && s.copy.bindingId ? STR.titles.deleteCloneChain : STR.titles.deleteSelection} onClick={() => A.deleteSelection()}>{s.kind === 'path' && s.copy.bindingId ? STR.bar.unlink : STR.bar.delete}</Btn></div>;
}

function Palette() {
  const d = doc.value, p = UI.prefs.value, s = UI.selection.value;
  const fillSel = s && s.kind === 'fill' ? getFill(d, s.id) : null;
  const fillMode = UI.tool.value === 'fill' || !!fillSel;
  const pid = UI.selectedPathId(), path = pid ? getPath(d, pid) : null;
  const sty = path ? path.style : p.style;
  const cur = fillMode ? (fillSel ? fillSel.color : p.fillColor) : sty.color;
  return <div class="panel palette">
    <span class="title">{fillMode ? STR.bar.palette.fill : path ? STR.bar.palette.path : STR.bar.palette.stroke}</span>
    <div class="grid">{CONFIG.SWATCHES.map(([name, c]) => <button key={c} class={`swatch${cur === c ? ' on' : ''}`} title={name} onClick={() => (fillMode ? A.setFillColor(c) : A.setStyle({ color: c }))}><span style={{ background: c }} /></button>)}</div>
    {!fillMode && <><span class="rule" /><div class="row">{CONFIG.WEIGHTS.map((w) => <button key={w} class={`weight${sty.weight === w ? ' on' : ''}`} title={STR.titles.weightPx(w)} onClick={() => A.setStyle({ weight: w })}><span style={{ height: `${Math.max(1.5, w)}px`, background: sty.color }} /></button>)}</div></>}
  </div>;
}

function UndoBar() {
  historyVersion.value;
  return <div class="panel">
    <Btn cls="icon" title={STR.titles.undo} disabled={!canUndo()} onClick={() => A.undo()}>{STR.bar.undoIcon}</Btn>
    <Btn cls="icon" title={STR.titles.redo} disabled={!canRedo()} onClick={() => A.redo()}>{STR.bar.redoIcon}</Btn>
  </div>;
}

function hintText(): string {
  const s = UI.selection.value, d = doc.value;
  if (UI.layer.value === 'construction') {
    if (s && s.kind === 'element') {
      const el = getElement(d, s.id);
      if (el?.kind === 'rotate') return STR.hint.rotate;
      if (el?.kind === 'mirror') return STR.hint.mirror;
      return STR.hint.translate;
    }
    return STR.hint.construction;
  }
  switch (UI.tool.value) {
    case 'select':
      if (s && s.kind === 'points') return STR.hint.points(s.ids.length);
      if (s && s.kind === 'paths') return STR.hint.instances(s.items.length);
      if (s && s.kind === 'path' && s.copy.bindingId) return STR.hint.clone;
      if (s && s.kind === 'path') return STR.hint.path;
      return STR.hint.select;
    case 'freehand': return STR.hint.freehand;
    case 'fill': return STR.hint.fill;
    default:
      if (UI.pen.value) return STR.hint.penActive;
      if (!d.points.length && !d.elements.length) return STR.hint.addElement;
      return STR.hint.pen;
  }
}

function Hint() {
  const d = doc.value, cm = cloneMatrices.value;
  const clones = [...cm.values()].reduce((n, ms) => n + cloneCount({ matrices: ms }), 0);
  const pl = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const saved = UI.lastSavedAt.value && Date.now() - UI.lastSavedAt.value < 1500 ? STR.hint.saved : '';
  return <div class="hint"><span class="text">{hintText()}</span><span class="counts">{pl(d.points.length, STR.hint.counts.point)} · {pl(d.paths.length, STR.hint.counts.path)} · {pl(d.elements.length, STR.hint.counts.element)} · {pl(clones, STR.hint.counts.clone)} · {pl(d.fills.length, STR.hint.counts.fill)} · {pl(d.layers.length, STR.hint.counts.layer)}{saved}</span></div>;
}

const K = ({ k }: { k: string }) => <span class="kbd">{k}</span>;
function Help() {
  const p = UI.prefs.value;
  return <div class="help">
    <span><K k="Tab" />{STR.help.tabSwitch}<K k="Esc" />{STR.help.escCancel}</span>
    <span><K k="V" />{STR.help.toolSelect}<K k="P" />{STR.help.toolPen}<K k="F" />{STR.help.toolFreehand}<K k="B" />{STR.help.toolFill}<K k="G" />{STR.help.toolGridHold}<K k="⌘" />{STR.help.toolSnapOr}<K k="Ctrl" />{STR.help.toolSnapFree}</span>
    <span><K k="O" />{STR.help.elRotation}<K k="M" />{STR.help.elMirror}<K k="T" />{STR.help.elTranslation}</span>
    <span class="violet">{STR.help.elementsIntro}<K k="[" />{STR.help.elementsBetween}<K k="]" />{STR.help.elementsRest}</span>
    <span>{STR.help.penIntro}<K k="Esc" />{STR.help.penOr}<K k="↵" />{STR.help.penToEnd}<K k="Space" />{STR.help.penSpace}</span>
    <span>{STR.help.freehandIntro}<K k="⌥" />{STR.help.freehandTrace}</span>
    <span>{STR.help.selectIntro}<K k="⇧" />{STR.help.selectShift}</span>
    <span>{STR.help.clone}</span>
    <span>{STR.help.fill}</span>
    <span>{STR.help.wheelIntro}<K k="⌘" />{STR.help.wheelZoom}<K k="⌘0" />{STR.help.wheelFit}<K k="⌫" />{STR.help.wheelDelete}<K k="⌘Z" />{STR.help.wheelUndo}<K k="⇧⌘Z" />{STR.help.wheelRedo}</span>
    <div class="settings">
      <label>{STR.help.grid}<input type="range" min="2" max="16" step="1" value={p.gridDivisions} onInput={(e) => A.setGridDivisions(+(e.currentTarget as HTMLInputElement).value)} /> {p.gridDivisions}</label>
      <label>{STR.help.ghosts}<input type="range" min="0.1" max="1" step="0.05" value={p.ghostOpacity} onInput={(e) => A.setGhostOpacity(+(e.currentTarget as HTMLInputElement).value)} /></label>
      <Btn cls="small outline" title={STR.titles.fitTile} onClick={() => A.fitToTile()}>{STR.help.resetView}</Btn>
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
      <Btn cls="small" on={mode === 'tile'} title={STR.titles.exportTile} onClick={() => setMode('tile')}>{STR.bar.tile}</Btn>
      <Btn cls="small" on={mode === 'grid3'} title={STR.titles.export3x3} onClick={() => setMode('grid3')}>{STR.bar.grid3x3}</Btn>
      <Btn cls="small" on={mode === 'wall'} title={STR.titles.exportWallpaper} onClick={() => setMode('wall')}>{STR.bar.wallpaper}</Btn>
    </div>
    {mode === 'wall' && <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>{STR.bar.columns}<input class="field" type="number" min="1" max={CONFIG.MAX_WALLPAPER} value={cols} onInput={(e) => setCols(+(e.currentTarget as HTMLInputElement).value)} />{STR.bar.rows}<input class="field" type="number" min="1" max={CONFIG.MAX_WALLPAPER} value={rows} onInput={(e) => setRows(+(e.currentTarget as HTMLInputElement).value)} /></label>}
    {error && <Label>{STR.bar.errorMsg(error)}</Label>}
    <Btn cls="outline" title={STR.titles.downloadSvg} onClick={run}>{STR.bar.downloadSvg}</Btn>
  </div>;
}

function FileGroup() {
  const importJson = () => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json' });
    input.onchange = async () => {
      const f = input.files?.[0]; if (!f) return;
      const d = parseDoc(await f.text());
      if (!d) { alert(STR.bar.importNotUnderstood); return; }
      if (doc.value.paths.length && !confirm(STR.bar.replaceDesign)) return;
      A.importDocument(d); A.fitToTile();
    };
    input.click();
  };
  return <div class="panel">
    <Btn cls="small outline" on={UI.exportOpen.value} title={STR.titles.exportSvg} onClick={() => { UI.exportOpen.value = !UI.exportOpen.value; }}>{STR.bar.exportSvgBtn}</Btn>
    <Btn cls="small outline" title={STR.titles.exportJson} onClick={() => download('tessellation.json', serializeDoc(doc.value), 'application/json')}>{STR.bar.exportJsonBtn}</Btn>
    <Btn cls="small outline" title={STR.titles.importJson} onClick={importJson}>{STR.bar.importJsonBtn}</Btn>
    <Btn cls="small outline" title={STR.titles.newDocument} onClick={() => { if (!doc.value.paths.length || confirm(STR.bar.discardDesign)) A.newDocument(); }}>{STR.bar.newBtn}</Btn>
  </div>;
}

export function TopRight() {
  return <div class="top-right">
    <div style={{ display: 'flex', gap: '8px' }}><FileGroup /><Btn cls="icon outline" title={STR.titles.shortcutsHelp} onClick={() => A.toggleHelp()}>{STR.bar.shortcutsIcon}</Btn></div>
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
