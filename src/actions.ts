// Every user-level mutation. Chrome and tools call these so they stay in sync. Each returns whether it changed anything.
import { doc, draft, emptyDoc } from './state/doc';
import { commit, undo as hUndo, redo as hRedo } from './state/history';
import * as UI from './state/ui';
import { copyMatrix, cloneMatrices, faces } from './state/derived';
import * as P from './engine/paths';
import { toWorld, toUV, snapGrid, snapFraction } from './engine/lattice';
import { apply, invert, mirrorAngle, mirrorDirFromAngle } from './engine/transform';
import { snapWorld, projectOnSegment, seedOf, type Anchor } from './engine/hit';
import { faceAt, seedFor, fillOfFace } from './engine/regions';
import { strokeToPath } from './engine/freehand';
import { CONFIG } from './config';
import type { Doc, XY, UV, Node, Copy, ElementKind, Lattice, Drag, Style, Tool, Layer } from './types';

export function mutate(fn: (d: Doc) => boolean | void): boolean {
  const d = draft();
  if (fn(d) === false) return false;
  commit(d);
  return true;
}

export const threshold = (hitScale = 1) => (CONFIG.SNAP_PX * hitScale) / UI.view.value.zoom;
export const uvOf = (w: XY): UV => toUV(w, doc.value.lattice);
export const worldOf = (uv: UV): XY => toWorld(uv, doc.value.lattice);
export function snapPoint(w: XY, gridOn: boolean, skip?: (a: Anchor) => boolean, hitScale = 1) {
  return snapWorld(doc.value, w, threshold(hitScale), UI.prefs.value.gridDivisions, skip, gridOn);
}
export function snapDeltaUV(dw: XY, on: boolean): UV {
  const d = uvOf(dw);
  return on ? snapGrid(d, UI.prefs.value.gridDivisions) : d;
}
const baseCopy: Copy = { cell: { c: 0, r: 0 }, bindingId: null, power: 0 };
// After a binding's groups change, a selected clone's power can point past the end of (or at a deduped-null slot in)
// the new cloneMatrices; fall back to the base copy rather than let the selection silently act on the source path.
function resetCloneSelectionIfGone(bindingId: string): void {
  const s = UI.selection.value;
  if (!s || s.kind !== 'path' || s.copy.bindingId !== bindingId) return;
  if ((cloneMatrices.value.get(bindingId) ?? [])[s.copy.power - 1] == null) UI.selection.value = { kind: 'path', id: s.id, copy: baseCopy };
}

// --- tools, layers, prefs

export function setTool(t: Tool): boolean {
  if (UI.layer.value !== 'drawing') { UI.layer.value = 'drawing'; if (UI.selection.value?.kind === 'element') UI.selection.value = null; }
  if (UI.tool.value === t) return false;
  endPen();
  UI.tool.value = t;
  if (t === 'freehand' || t === 'fill') UI.selection.value = null;
  UI.fillPreview.value = null;
  return true;
}
export function setLayer(l: Layer): boolean {
  if (UI.layer.value === l) return false;
  endPen();
  UI.layer.value = l;
  const s = UI.selection.value;
  if (s && (l === 'construction') !== (s.kind === 'element')) UI.selection.value = null;
  return true;
}
export function toggleSnap(): boolean { UI.prefs.value = { ...UI.prefs.value, snap: !UI.prefs.value.snap }; return true; }
export function toggleFreeScale(): boolean { UI.freeScale.value = !UI.freeScale.value; return true; }
export function toggleAddToSelection(): boolean { UI.addToSelection.value = !UI.addToSelection.value; return true; }
export function toggleHelp(): boolean { UI.showHelp.value = !UI.showHelp.value; return true; }
export function setGridDivisions(n: number): boolean { UI.prefs.value = { ...UI.prefs.value, gridDivisions: Math.max(2, Math.min(16, Math.round(n))) }; return true; }
export function setGhostOpacity(x: number): boolean { UI.prefs.value = { ...UI.prefs.value, ghostOpacity: Math.max(0.1, Math.min(1, x)) }; return true; }
// Undo/redo drop the pen without committing (a commit here would itself be undone). A snapshot taken mid-drawing holds
// that path with no segments; only the pen may own such a path (spec §9), so restoring it resumes drawing it.
export function undo(): boolean { UI.pen.value = null; UI.cursor.value = null; const ok = hUndo(); rearmPen(); return ok; }
export function redo(): boolean { UI.pen.value = null; UI.cursor.value = null; const ok = hRedo(); rearmPen(); return ok; }
// A zero-segment path exists only while the Pen owns it, so restoring one restores the Pen: tool, layer and pen state together.
function rearmPen(): void {
  const p = doc.value.paths.find((q) => q.segments.length === 0);
  if (!p) return;
  if (UI.layer.value !== 'drawing') { UI.layer.value = 'drawing'; if (UI.selection.value?.kind === 'element') UI.selection.value = null; }
  UI.tool.value = 'pen';
  UI.pen.value = { pathId: p.id };
}

// --- layers

export function activeLayerId(d: Doc = doc.value): string { return P.layerIdOr(d, UI.activeLayerId.value); }
export function setActiveLayer(id: string): boolean { if (!doc.value.layers.some((l) => l.id === id)) return false; UI.activeLayerId.value = id; return true; }
export function addLayer(): boolean {
  let id: string | null = null;
  const ok = mutate((d) => { id = P.addLayer(d).id; });
  if (id) UI.activeLayerId.value = id;
  return ok;
}
export function setPathLayer(pathId: string, layerId: string): boolean {
  return mutate((d) => { const p = P.getPath(d, pathId); if (!p || p.layerId === layerId || !d.layers.some((l) => l.id === layerId)) return false; p.layerId = layerId; });
}
export function setFillLayer(fillId: string, layerId: string): boolean {
  return mutate((d) => { const f = P.getFill(d, fillId); if (!f || f.layerId === layerId || !d.layers.some((l) => l.id === layerId)) return false; f.layerId = layerId; });
}

// --- pen

function bindNewPath(d: Doc, pathId: string) { if (d.newPathGroups.length) P.addBinding(d, pathId, d.newPathGroups); }

export function penClickEmpty(w: XY, on: boolean, hitScale = 1): boolean {
  if (UI.selection.value && !UI.pen.value) { UI.selection.value = null; return true; }
  const s = snapPoint(w, on, undefined, hitScale);
  const penNow = UI.pen.value;
  let started: string | null = null;
  const ok = mutate((d) => {
    const node: Node = s.anchor && !s.anchor.bindingId ? { pointId: s.anchor.pointId, cell: s.anchor.cell } : P.addPoint(d, toUV(s, d.lattice));
    if (penNow) { P.appendNode(d, penNow.pathId, node); return; }
    const path = P.startPath(d, node, UI.prefs.value.style, activeLayerId(d));
    bindNewPath(d, path.id);
    started = path.id;
  });
  if (started) UI.pen.value = { pathId: started };
  return ok;
}

export function penClickNode(node: Node): boolean {
  const penNow = UI.pen.value;
  if (penNow) {
    const path = P.getPath(doc.value, penNow.pathId);
    if (!path) { UI.pen.value = null; return false; }
    const nodes = P.pathNodes(path);
    if (P.sameNode(nodes[nodes.length - 1], node)) { endPen(); return true; }
    return mutate((d) => { P.appendNode(d, penNow.pathId, node); });
  }
  let pathId: string | null = null;
  const ok = mutate((d) => {
    const openId = P.openEndAt(d, node.pointId);
    if (openId) { P.orientToEnd(d, openId, node.pointId, node.cell); pathId = openId; return; }
    const path = P.startPath(d, node, UI.prefs.value.style, activeLayerId(d));
    bindNewPath(d, path.id);
    pathId = path.id;
  });
  if (pathId) { UI.pen.value = { pathId }; UI.selection.value = null; }
  return ok;
}

export function endPen(): boolean {
  const penNow = UI.pen.value;
  if (!penNow) return false;
  UI.pen.value = null;
  UI.cursor.value = null;
  const path = P.getPath(doc.value, penNow.pathId);
  if (path && path.segments.length === 0) mutate((d) => { P.deletePath(d, penNow.pathId); });
  return true;
}

// --- selection

export function selectPathAt(pathId: string, copy: Copy = baseCopy): boolean { UI.selection.value = { kind: 'path', id: pathId, copy }; UI.pendingGroup.value = null; return true; }
export function selectPoints(ids: string[]): boolean { const u = [...new Set(ids)]; UI.selection.value = u.length ? { kind: 'points', ids: u } : null; UI.pendingGroup.value = null; return true; }
export function togglePointSelection(id: string): boolean { const cur = UI.selectedPointIds(); return selectPoints(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]); }
export function selectElement(id: string): boolean { UI.selection.value = { kind: 'element', id }; UI.pendingGroup.value = null; return true; }
export function selectFill(id: string): boolean { UI.selection.value = { kind: 'fill', id }; UI.pendingGroup.value = null; return true; }
export function clearSel(): boolean { UI.selection.value = null; UI.pendingGroup.value = null; return true; }

// --- segments

export function insertNodeOnSegment(pathId: string, j: number, w: XY, copy: Copy, on: boolean): boolean {
  const path = P.getPath(doc.value, pathId);
  if (!path || j < 0 || j >= path.segments.length) return false;
  const M = copyMatrix(copy);
  const src = apply(invert(M), w);
  return mutate((d) => {
    const p = P.getPath(d, pathId)!;
    if (p.segments[j].cp) { P.insertNode(d, pathId, j, null); return; }
    const A = P.nodeWorld(d, P.prevNode(p, j)), B = P.nodeWorld(d, p.segments[j].to);
    let m = toUV(projectOnSegment(A, B, src), d.lattice);
    if (on) m = snapGrid(m, UI.prefs.value.gridDivisions);
    P.insertNode(d, pathId, j, m);
  });
}

export function straightenSegment(pathId: string, j: number): boolean {
  const path = P.getPath(doc.value, pathId);
  if (!path || !path.segments[j]?.cp) return false;
  return mutate((d) => { P.setControlPointAbs(d, pathId, j, null); });
}

export function straightenPath(pathId: string): boolean {
  const path = P.getPath(doc.value, pathId);
  if (!path || !path.segments.some((s) => s.cp)) return false;
  return mutate((d) => { const p = P.getPath(d, pathId)!; p.segments.forEach((s) => { s.cp = null; }); });
}

// --- delete

export function deleteSelection(): boolean {
  const s = UI.selection.value;
  if (!s) return false;
  const ok = mutate((d) => {
    if (s.kind === 'points') P.deletePoints(d, s.ids);
    else if (s.kind === 'path') { if (s.copy.bindingId) P.removeBinding(d, s.copy.bindingId); else P.deletePath(d, s.id); }
    else if (s.kind === 'element') P.deleteElement(d, s.id);
    else if (s.kind === 'fill') P.removeFill(d, s.id);
  });
  UI.selection.value = null; UI.hover.value = null; UI.pendingGroup.value = null;
  endPen();
  return ok;
}

export function deleteHoveredOrSelection(): boolean {
  const h = UI.hover.value, s = UI.selection.value;
  if (h && h.kind === 'point' && !(s && s.kind === 'points')) {
    const ok = mutate((d) => { P.deletePoints(d, [h.pointId]); });
    UI.hover.value = null;
    if (s && s.kind === 'path' && !P.getPath(doc.value, s.id)) UI.selection.value = null;
    if (UI.pen.value && !P.getPath(doc.value, UI.pen.value.pathId)) UI.pen.value = null;
    return ok;
  }
  return deleteSelection();
}

// --- style

export function setStyle(patch: Partial<Style>): boolean {
  const pid = UI.selectedPathId();
  if (pid) mutate((d) => { const p = P.getPath(d, pid); if (!p) return false; Object.assign(p.style, patch); });
  UI.prefs.value = { ...UI.prefs.value, style: { ...UI.prefs.value.style, ...patch } };
  return true;
}
export function setFillColor(color: string): boolean {
  UI.prefs.value = { ...UI.prefs.value, fillColor: color };
  const s = UI.selection.value;
  if (s && s.kind === 'fill') mutate((d) => { const f = P.getFill(d, s.id); if (!f) return false; f.color = color; });
  return true;
}

// --- elements, bindings, groups

const groupKey = (g: string[]) => g.join('>');
const groupsKey = (gs: string[][]) => gs.map(groupKey).join('|');

// O / M / T: the element joins newPathGroups as its own group and, if a path is selected, that path's first binding
// as a new group (created if the path has none).
export function addElement(kind: ElementKind): boolean {
  const pid = UI.selectedPathId();
  let id: string | null = null;
  const ok = mutate((d) => {
    const spec = kind === 'translate' ? { kind, u: 0.5, v: 0.5 } as const
      : kind === 'mirror' ? { kind, u: 0.5, v: 0.5, du: 0, dv: 1 } as const
      : { kind: 'rotate' as const, u: 0.5, v: 0.5, n: 2 };
    const e = P.addElement(d, spec);
    d.newPathGroups.push([e.id]);
    if (pid) { const b = d.bindings.find((x) => x.pathId === pid); if (b) b.groups.push([e.id]); else P.addBinding(d, pid, [[e.id]]); }
    id = e.id;
  });
  if (id) { endPen(); UI.layer.value = 'construction'; UI.selection.value = { kind: 'element', id }; UI.pendingGroup.value = null; }
  return ok;
}
export function setRotationOrder(id: string, n: number): boolean {
  return mutate((d) => { const e = P.getElement(d, id); if (!e || e.kind !== 'rotate' || e.n === n) return false; e.n = n; });
}
export function rotateMirror(id: string, deg: number): boolean {
  return mutate((d) => { const e = P.getElement(d, id); if (!e || e.kind !== 'mirror') return false; const dir = mirrorDirFromAngle(mirrorAngle(e, d.lattice) + deg, d.lattice); e.du = dir.du; e.dv = dir.dv; });
}
export function rotateSelectedElement(deg: number): boolean { const id = UI.selectedElementId(); return id ? rotateMirror(id, deg) : false; }
export function setTranslation(id: string, u: number, v: number): boolean {
  return mutate((d) => { const e = P.getElement(d, id); if (!e || e.kind !== 'translate') return false; e.u = u; e.v = v; });
}
// A single group in newPathGroups ("Apply to new paths" on an element).
export function isNewPathGroup(group: string[]): boolean { const k = groupKey(group); return doc.value.newPathGroups.some((g) => groupKey(g) === k); }
// Adding a group first takes its ids out of every other group, so newPathGroups names an element at most once (as a
// binding must: a new path copies this list into its binding, which the validator would otherwise refuse on reload).
export function toggleNewPathGroup(group: string[]): boolean {
  const k = groupKey(group);
  return mutate((d) => {
    const i = d.newPathGroups.findIndex((g) => groupKey(g) === k);
    if (i >= 0) { d.newPathGroups.splice(i, 1); return; }
    const ids = new Set(group);
    d.newPathGroups = d.newPathGroups.map((g) => g.filter((x) => !ids.has(x))).filter((g) => g.length);
    d.newPathGroups.push(group.slice());
  });
}
// The whole list (the ★ on a binding row): make new paths get exactly this binding, or nothing if they already do.
export function isNewPathGroups(groups: string[][]): boolean { return groupsKey(groups) === groupsKey(doc.value.newPathGroups); }
export function setNewPathGroups(groups: string[][]): boolean {
  return mutate((d) => { d.newPathGroups = groupsKey(groups) === groupsKey(d.newPathGroups) ? [] : groups.map((g) => g.slice()); });
}
export function placeElementInGroup(bindingId: string, elementId: string, gi: number): boolean {
  const ok = mutate((d) => { if (!P.getBinding(d, bindingId) || !P.getElement(d, elementId)) return false; return P.placeInGroup(d, bindingId, elementId, gi); });
  if (ok) { UI.pendingGroup.value = null; resetCloneSelectionIfGone(bindingId); }
  return ok;
}
export function removeElementFromBinding(bindingId: string, elementId: string): boolean {
  const ok = mutate((d) => { const b = P.getBinding(d, bindingId); if (!b || !b.groups.some((g) => g.includes(elementId))) return false; P.removeFromBinding(d, bindingId, elementId); });
  if (ok) resetCloneSelectionIfGone(bindingId);
  return ok;
}
export function startGroup(bindingId: string): boolean { UI.pendingGroup.value = { bindingId }; return true; }
export function startChain(pathId: string): boolean { UI.pendingGroup.value = { pathId }; return true; }
export function cancelPending(): boolean { if (!UI.pendingGroup.value) return false; UI.pendingGroup.value = null; return true; }
export function addElementToNewChain(pathId: string, elementId: string): boolean {
  const ok = mutate((d) => { if (!P.getPath(d, pathId) || !P.getElement(d, elementId)) return false; P.addBinding(d, pathId, [[elementId]]); });
  if (ok) UI.pendingGroup.value = null;
  return ok;
}
export function removeBinding(id: string): boolean {
  const ok = mutate((d) => { if (!P.getBinding(d, id)) return false; P.removeBinding(d, id); });
  const s = UI.selection.value;
  if (ok && s && s.kind === 'path' && s.copy.bindingId === id) UI.selection.value = { kind: 'path', id: s.id, copy: baseCopy };
  return ok;
}
export function deleteElement(id: string): boolean {
  const ok = mutate((d) => { if (!P.getElement(d, id)) return false; P.deleteElement(d, id); });
  if (ok && UI.selectedElementId() === id) UI.selection.value = null;
  return ok;
}
export function setLattice(lat: Lattice): boolean { return mutate((d) => { d.lattice = { ...lat }; }); }

// --- fills

export function fillAt(w: XY): boolean {
  const fs = faces.value, lat = doc.value.lattice;
  const face = faceAt(fs, seedOf(w, lat));
  if (!face) return false;
  const color = UI.prefs.value.fillColor;
  const existing = fillOfFace(doc.value.fills, fs, face, lat);
  let id: string | null = null;
  const ok = mutate((d) => {
    if (existing) { const f = P.getFill(d, existing.id)!; f.color = color; id = f.id; return; }
    const seed = toUV(seedOf(seedFor(face, seedOf(w, lat)), lat), lat);   // the centroid of a straddling copy may lie outside the base cell
    id = P.addFill(d, seed, color, activeLayerId(d)).id;
  });
  if (id) UI.selection.value = { kind: 'fill', id };
  return ok;
}

// --- freehand

export function finishFreehand(dr: Extract<Drag, { kind: 'free' }>): boolean {
  const fit = strokeToPath(dr.raw, { eps: CONFIG.FREEHAND_EPS, minDeviation: CONFIG.FREEHAND_MIN_DEVIATION });
  if (!fit) return false;
  const last = fit.points[fit.points.length - 1];
  const endSnap = snapPoint(last, false, (a) => !!a.bindingId, dr.hitScale);
  let pathId: string | null = null;
  const ok = mutate((d) => {
    const nodes = fit.points.map((v, j) => {
      if (j === 0 && dr.startNode) return dr.startNode;
      if (j === fit.points.length - 1 && endSnap.anchor) return { pointId: endSnap.anchor.pointId, cell: endSnap.anchor.cell };
      return P.addPoint(d, toUV(v, d.lattice));
    });
    const extendId = dr.startNode ? P.openEndAt(d, dr.startNode.pointId) : null;
    let path;
    if (extendId) { path = P.getPath(d, extendId)!; P.orientToEnd(d, extendId, dr.startNode!.pointId, dr.startNode!.cell); }
    else path = P.startPath(d, nodes[0], UI.prefs.value.style, activeLayerId(d));
    nodes.slice(1).forEach((n, j) => { if (P.appendNode(d, path.id, n) && fit.cps[j]) P.setControlPointWorld(d, path.id, path.segments.length - 1, fit.cps[j]); });
    if (!extendId) bindNewPath(d, path.id);
    if (path.segments.length === 0) { P.deletePath(d, path.id); return false; }
    pathId = path.id;
  });
  if (pathId) UI.selection.value = { kind: 'path', id: pathId, copy: baseCopy };
  return ok;
}

// --- view (never in history)

export function zoomAt(screen: XY, factor: number): boolean {
  const v = UI.view.value;
  const z = Math.min(CONFIG.ZOOM_MAX, Math.max(CONFIG.ZOOM_MIN, v.zoom * factor)), k = z / v.zoom;
  UI.view.value = { zoom: z, pan: { x: screen.x - (screen.x - v.pan.x) * k, y: screen.y - (screen.y - v.pan.y) * k } };
  return true;
}
export function panBy(dx: number, dy: number): boolean { const v = UI.view.value; UI.view.value = { zoom: v.zoom, pan: { x: v.pan.x + dx, y: v.pan.y + dy } }; return true; }
export function fitToTile(): boolean { UI.fitView(doc.value.lattice); return true; }
export function newDocument(): boolean { commit(emptyDoc()); UI.selection.value = null; UI.pen.value = null; UI.activeLayerId.value = null; UI.pendingGroup.value = null; return true; }
export function importDocument(d: Doc): boolean { commit(d); UI.selection.value = null; UI.pen.value = null; UI.activeLayerId.value = null; UI.pendingGroup.value = null; return true; }
