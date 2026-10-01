// Every user-level mutation. Chrome and tools call these so they stay in sync. Each returns whether it changed anything.
import { doc, draft, emptyDoc } from './state/doc';
import { commit, undo as hUndo, redo as hRedo, gestureActive } from './state/history';
import * as UI from './state/ui';
import { copyMatrix, cloneMatrices, faces, snapTargets } from './state/derived';
import * as P from './engine/paths';
import { toWorld, toUV, snapGrid, snapFraction } from './engine/lattice';
import { apply, invert, mirrorAngle, mirrorDirFromAngle } from './engine/transform';
import { projectOnSegment, seedOf } from './engine/hit';
import { faceAt, seedFor, fillOfFace } from './engine/regions';
import { strokeToPath } from './engine/freehand';
import { pickSnap, gridResult, strokeCopies, strokeCands, nearestOnSeg, bezAt } from './engine/snap';
import { joinable, joinPointToHit, nodeForSnap, splitNearest } from './engine/joins';
import { CONFIG } from './config';
import type { Doc, XY, UV, Cell, Node, Copy, ElementKind, Lattice, Drag, Style, Tool, Layer, SnapResult, SnapHit, Path, SnapCat } from './types';

// Every mutation is bracketed by via repair, so a change that removes a binding or clone slot (element edits, lattice
// edits, deletions) materialises the via nodes that depended on it where they were, whether or not `fn` remembered
// P.withViaRepair. Inside a gesture the repair waits for endGesture (history.ts), which holds the gesture's snapshot.
export function mutate(fn: (d: Doc) => boolean | void): boolean {
  const d = draft();
  const snap = gestureActive() ? null : P.viaSnapshot(d);
  if (fn(d) === false) return false;
  if (snap) P.repairVia(d, snap);
  commit(d);
  return true;
}

export const threshold = (hitScale = 1) => (CONFIG.SNAP_PX * hitScale) / UI.view.value.zoom;
export const uvOf = (w: XY): UV => toUV(w, doc.value.lattice);
export const worldOf = (uv: UV): XY => toWorld(uv, doc.value.lattice);
export function snapDeltaUV(dw: XY, on: boolean): UV {
  const d = uvOf(dw);
  return on ? snapGrid(d, UI.prefs.value.gridDivisions) : d;
}

export function hintOf(s: SnapResult | null): UI.SnapHint | null { return s ? { at: s.at, label: s.label, line: s.line } : null; }

// A stroke for drawSnap: its world polyline (start first, tip last), the groups its clones come from, and the stored path
// it belongs to (the Pen path in progress, or the path a Freehand stroke extends), if any.
export type DrawStroke = { pts: XY[]; groups: string[][][]; pathId?: string };

// Spec I1: the path being drawn offers itself only as its own targets (own start, own line, own clones and repeats), so
// its lines and the points only it uses are not plain targets. A point another path also uses stays a real node target.
function ownExclusions(d: Doc, pathId: string): { excludePaths: Set<string>; excludePoints: Set<string> } {
  const own = P.getPath(d, pathId), others = new Set(d.paths.filter((p) => p.id !== pathId).flatMap((p) => P.pathNodes(p).map((n) => n.pointId)));
  return { excludePaths: new Set([pathId]), excludePoints: new Set(own ? P.pathNodes(own).map((n) => n.pointId).filter((id) => !others.has(id)) : []) };
}

// The snap for a drawing point (Pen click, stroke start or end, hover): every target, the stroke's own targets, the held
// snap; the grid when nothing else is near. With snapping off only existing points attract: nodes, and the stroke's own
// start (its own nodes are not node targets, I1, so closing a shape still works with snapping off).
const NODE_OR_OWN_START: ReadonlySet<SnapCat> = new Set<SnapCat>(['node', 'ownStart']);
export function drawSnap(w: XY, on: boolean, hitScale: number, stroke: DrawStroke | null): SnapResult | null {
  const thr = threshold(hitScale), d = doc.value;
  const extra = stroke ? strokeCands(stroke.pts, stroke.groups.flatMap((g) => strokeCopies(d, g)), w, thr) : [];
  const ex = stroke?.pathId ? ownExclusions(d, stroke.pathId) : {};
  const layerId = (stroke?.pathId && P.getPath(d, stroke.pathId)?.layerId) || activeLayerId(d);
  const s = pickSnap(snapTargets.value, w, thr, { extra, sticky: UI.snapSticky.value, cats: on ? undefined : NODE_OR_OWN_START, prefer: joinsOn(d, layerId), ...ex });
  return s ?? (on ? gridResult(w, d.lattice, UI.prefs.value.gridDivisions) : null);
}

// SN5 at choice time: of coincident candidates, prefer the one a release would join on this layer.
export const joinsOn = (d: Doc, layerId: string) => (x: SnapResult): boolean => joinable(d, x.hit, layerId);
// The layer of the path(s) using a point; the active layer for a point no path uses.
export const layerOfPoint = (d: Doc, pointId: string): string => d.paths.find((p) => P.pathNodes(p).some((n) => n.pointId === pointId))?.layerId ?? activeLayerId(d);

// A path's world polyline, curves sampled, in its own node order.
export function pathPolyline(d: Doc, p: Path): XY[] {
  const W = P.pathWorld(d, p), C = P.pathCpsWorld(d, p), out: XY[] = [W[0]];
  for (let j = 0; j + 1 < W.length; j++) {
    if (!C[j]) { out.push(W[j + 1]); continue; }
    for (let i = 1; i <= 8; i++) out.push(bezAt(W[j], C[j], W[j + 1], i / 8));
  }
  return out;
}

// The Pen path in progress as a stroke: its world polyline and its bindings' groups.
export function penStroke(): DrawStroke | null {
  const pn = UI.pen.value, p = pn && P.getPath(doc.value, pn.pathId);
  if (!p) return null;
  return { pts: pathPolyline(doc.value, p), groups: doc.value.bindings.filter((b) => b.pathId === p.id).map((b) => b.groups), pathId: p.id };
}

// Spec D5: a drawing start extends a path only when it lands on a plain node that is an open end of a path on the drawing
// layer and every path using that point is on it. Returns that path and the node as seen (its window cell).
export function extendTarget(d: Doc, s: SnapResult | null, layerId: string = activeLayerId(d)): { pathId: string; node: Node } | null {
  const h = s?.hit;
  if (!h || h.kind !== 'node' || h.copy.bindingId || !joinable(d, h, layerId)) return null;
  const id = P.openEndAt(d, h.pointId), path = id ? P.getPath(d, id) : null;
  return path && path.layerId === layerId ? { pathId: path.id, node: { pointId: h.pointId, cell: { ...h.cell } } } : null;
}

export function hoverSnap(w: XY, on: boolean, hitScale: number): void {
  const s = drawSnap(w, on, hitScale, UI.tool.value === 'pen' ? penStroke() : null);
  const shown = s && s.cat !== 'grid' ? s : null;           // the grid is not worth a hint
  UI.snapHint.value = hintOf(shown);
  UI.snapSticky.value = shown?.id ?? null;
}

const baseCopy: Copy = { cell: { c: 0, r: 0 }, bindingId: null, power: 0 };
const sameCopy = (a: Copy, b: Copy) => a.cell.c === b.cell.c && a.cell.r === b.cell.r && a.bindingId === b.bindingId && a.power === b.power;
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
  UI.snapHint.value = null; UI.snapSticky.value = null;
  return true;
}
export function setLayer(l: Layer): boolean {
  if (UI.layer.value === l) return false;
  endPen();
  UI.layer.value = l;
  const s = UI.selection.value;
  if (s && (l === 'construction') !== (s.kind === 'element')) UI.selection.value = null;
  UI.snapHint.value = null; UI.snapSticky.value = null;
  return true;
}
export function toggleSnap(): boolean { UI.prefs.value = { ...UI.prefs.value, snap: !UI.prefs.value.snap }; UI.snapHint.value = null; UI.snapSticky.value = null; return true; }
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

// The node a drawing end makes on its own path (spec D7, D10, UC-D9): its start (close), its start's repeat in the
// neighbouring tile (wrap), or a split of its own earlier line among segments 0..maxJ-1 (loop and tail). Null for any
// other hit. Shared by the Pen and Freehand.
function ownEndNode(d: Doc, path: Path, h: SnapHit | undefined, at: XY, maxJ: number): Node | null {
  const st = path.start;
  if (h?.kind === 'ownStart') return st;
  if (h?.kind === 'ownRepeat') return st.via ? null : { pointId: st.pointId, cell: { c: st.cell.c + h.cell.c, r: st.cell.r + h.cell.r } };
  if (h?.kind === 'ownLine') return splitNearest(d, path.id, at, maxJ);
  return null;
}

// A Pen click (spec D14): the same targets and commits as a stroke end, whatever the click hit. On a path in progress,
// its own start closes it, its repeated start wraps it, and its own earlier line splits it; each ends the path, as does
// landing on a node the path already has. With no path in progress, an open end on the drawing layer resumes that path
// (D5); anything else starts a new one. Joins are same-layer only (O2, in nodeForSnap / extendTarget).
export function penClickEmpty(w: XY, on: boolean, hitScale = 1): boolean {
  if (UI.selection.value && !UI.pen.value) { UI.selection.value = null; return true; }
  const penNow = UI.pen.value;
  const s = drawSnap(w, on, hitScale, penNow ? penStroke() : null);
  let started: string | null = null, ended = false;
  const ok = mutate((d) => {
    const penPath = penNow ? P.getPath(d, penNow.pathId) : null;
    const layerId = penPath ? penPath.layerId : activeLayerId(d);
    const own = penPath && s ? ownEndNode(d, penPath, s.hit, s.at, penPath.segments.length) : null;   // any segment: the own line already leaves out the tail at the tip
    if (penPath && own) { P.appendNode(d, penPath.id, own); ended = true; return; }
    if (!penPath) {
      const ext = extendTarget(d, s, layerId);
      if (ext) { P.orientToEnd(d, ext.pathId, ext.node.pointId, ext.node.cell); started = ext.pathId; return; }
    }
    const node = nodeForSnap(d, s, w, layerId);
    if (penPath) {
      const had = P.pathNodes(penPath);
      if (!P.appendNode(d, penPath.id, node)) { ended = true; return false; }   // the last node again: done
      if (had.some((n) => P.sameNode(n, node))) ended = true;                   // closed, or a loop on its own node
      return;
    }
    const path = P.startPath(d, node, UI.prefs.value.style, layerId);
    bindNewPath(d, path.id);
    started = path.id;
  });
  if (started) UI.pen.value = { pathId: started };
  if (ended) endPen();
  return ok || ended;
}

// A point drag released on a snap joins the point to what it landed on (same layer only; see engine/joins.ts).
export function joinDroppedPoint(pointId: string, cell: Cell, hit: SnapHit): boolean {
  let toId: string | null = null;
  const ok = mutate((d) => {
    if (!P.getPoint(d, pointId)) return false;
    const before = new Set(d.points.map((q) => q.id));
    if (!joinPointToHit(d, pointId, cell, hit, layerOfPoint(d, pointId))) return false;
    const users = d.paths.flatMap((p) => P.pathNodes(p)).map((n) => n.pointId);
    toId = hit.kind === 'node' ? hit.pointId : users.find((id) => !before.has(id)) ?? null;
  });
  if (!ok) return false;
  const s = UI.selection.value;
  if (s && s.kind === 'points' && toId) {   // the joined point becomes the target; the others keep the copies they were picked through
    const copies = { ...(s.copies ?? {}) };
    delete copies[pointId];
    UI.selection.value = { kind: 'points', ids: [...new Set(s.ids.map((id) => (id === pointId ? toId! : id)))], ...(Object.keys(copies).length ? { copies } : {}) };
  }
  else if (s && s.kind === 'path' && !P.getPath(doc.value, s.id)) UI.selection.value = null;
  if (UI.pen.value && !P.getPath(doc.value, UI.pen.value.pathId)) UI.pen.value = null;
  return true;
}

// Give the path its own point for one of its nodes (a plain node on `pointId` in `cell`, or its via node through `via`),
// so a drag moves only this path. Null when nothing was shared.
export function unlinkNode(pathId: string, pointId: string, cell: Cell, via?: Copy): Node | null {
  let out: Node | null = null;
  mutate((d) => {
    const path = P.getPath(d, pathId);
    const node = path && P.pathNodes(path).find((n) => n.pointId === pointId && P.sameCell(n.cell, cell) && P.sameVia(n.via, via));
    out = node ? P.detachFromPath(d, pathId, node) : null;
    return out ? undefined : false;
  });
  return out;
}

// A body drag released on a snap joins the snapped end (same layer only). Corners, axes and the path's own copies join nothing.
export function joinDroppedNode(pathId: string, nodeIndex: number, hit: SnapHit): boolean {
  if (hit.kind !== 'node' && hit.kind !== 'curve') return false;
  return mutate((d) => {
    const path = P.getPath(d, pathId);
    const from = path && P.pathNodes(path)[nodeIndex];
    if (!path || !from || from.via) return false;
    return joinPointToHit(d, from.pointId, from.cell, hit, path.layerId) ? undefined : false;
  });
}

export function endPen(): boolean {
  UI.snapHint.value = null; UI.snapSticky.value = null;
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
export function selectPoints(ids: string[], copies?: Record<string, Copy>): boolean { const u = [...new Set(ids)]; UI.selection.value = u.length ? { kind: 'points', ids: u, ...(copies ? { copies } : {}) } : null; UI.pendingGroup.value = null; return true; }
// ⇧-click a point (spec S3). The others keep the copies they were picked through; an added point keeps the one it was
// clicked through (`copy`, when it was seen through a clone).
export function togglePointSelection(id: string, copy?: Copy): boolean {
  const s = UI.selection.value, cur = UI.selectedPointIds(), copies = { ...(s && s.kind === 'points' ? s.copies ?? {} : {}) };
  const on = !cur.includes(id);
  delete copies[id];
  if (on && copy) copies[id] = copy;
  return selectPoints(on ? [...cur, id] : cur.filter((x) => x !== id), Object.keys(copies).length ? copies : undefined);
}
export function selectElement(id: string): boolean { UI.selection.value = { kind: 'element', id }; UI.pendingGroup.value = null; return true; }
export function selectFill(id: string): boolean { UI.selection.value = { kind: 'fill', id }; UI.pendingGroup.value = null; return true; }
export function clearSel(): boolean { UI.selection.value = null; UI.pendingGroup.value = null; return true; }

// ⇧-click on a line (spec S4): toggle that instance in the selection. One instance is a plain path selection.
export function toggleInstance(pathId: string, copy: Copy): boolean {
  const s = UI.selection.value, same = (x: { id: string; copy: Copy }) => x.id === pathId && sameCopy(x.copy, copy);
  const items = s && s.kind === 'paths' ? s.items.slice() : s && s.kind === 'path' ? [{ id: s.id, copy: s.copy }] : [];
  const i = items.findIndex(same);
  if (i >= 0) items.splice(i, 1); else items.push({ id: pathId, copy });
  UI.selection.value = items.length === 0 ? null : items.length === 1 ? { kind: 'path', id: items[0].id, copy: items[0].copy } : { kind: 'paths', items };
  UI.pendingGroup.value = null;
  return true;
}

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
  if (s.kind === 'paths') {
    const ids = new Set(s.items.map((x) => x.id));
    const ok = mutate((d) => { for (const id of ids) P.deletePath(d, id); });
    UI.selection.value = null;
    return ok;
  }
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
// "Apply to new paths" on an element: lit when the element appears anywhere in newPathGroups (the same test the
// canvas uses to mark it armed). Off takes it out of wherever it is, dropping an emptied group; on appends it as its
// own group. So newPathGroups names an element at most once (as a binding must: a new path copies this list into its
// binding, which the validator would otherwise refuse on reload).
export function isNewPathElement(id: string): boolean { return doc.value.newPathGroups.some((g) => g.includes(id)); }
export function toggleNewPathElement(id: string): boolean {
  return mutate((d) => {
    if (d.newPathGroups.some((g) => g.includes(id))) { d.newPathGroups = d.newPathGroups.map((g) => g.filter((x) => x !== id)).filter((g) => g.length); return; }
    d.newPathGroups.push([id]);
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
  const s = UI.selection.value, pg = UI.pendingGroup.value;
  if (ok && s && s.kind === 'path' && s.copy.bindingId === id) UI.selection.value = { kind: 'path', id: s.id, copy: baseCopy };
  if (ok && pg && 'bindingId' in pg && pg.bindingId === id) UI.pendingGroup.value = null;
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

// The path a Freehand stroke extends (D5): its start node is a plain open end of a path on the active layer.
function freeExtends(d: Doc, dr: Extract<Drag, { kind: 'free' }>): string | null {
  const n = dr.startNode, id = n && !n.via ? P.openEndAt(d, n.pointId) : null;
  return id && P.getPath(d, id)!.layerId === activeLayerId(d) ? id : null;
}

// A Freehand stroke as drawSnap sees it. Extending path E, the stroke is E (oriented to end at the start node, in that
// node's cell) followed by the raw points, and E is its own path (I1): E's start is the own start, E's lines its own line.
export function freeStroke(dr: Extract<Drag, { kind: 'free' }>): DrawStroke {
  const d = doc.value, id = freeExtends(d, dr), E = id ? P.getPath(d, id) : null;
  if (!E || !dr.startNode) return { pts: dr.raw, groups: dr.groups };
  const nodes = P.pathNodes(E), last = nodes[nodes.length - 1], atEnd = !last.via && last.pointId === dr.startNode.pointId;
  const end = atEnd ? last : nodes[0], off = toWorld({ u: dr.startNode.cell.c - end.cell.c, v: dr.startNode.cell.r - end.cell.r }, d.lattice);
  const pl = pathPolyline(d, E).map((q) => ({ x: q.x + off.x, y: q.y + off.y }));
  return { pts: [...(atEnd ? pl : pl.reverse()), ...dr.raw.slice(1)], groups: dr.groups, pathId: E.id };
}

// End a Freehand stroke (spec D3–D11): fit it, then make its start and end nodes from their snaps: share or split
// same-layer geometry, close on its own start, wrap into its own repeat, split itself (loop and tail), or sit on its
// own clone's line re-snapped to the fitted clone; anything else is a new point where the snap put it. Extending a path,
// "its own" means the whole extended path.
export function finishFreehand(dr: Extract<Drag, { kind: 'free' }>, end: SnapResult | null): boolean {
  const raw = end ? [...dr.raw.slice(0, -1), end.at] : dr.raw;
  const fit = strokeToPath(raw, { eps: CONFIG.FREEHAND_EPS, minDeviation: CONFIG.FREEHAND_MIN_DEVIATION });
  if (!fit) return false;
  let pathId: string | null = null;
  const ok = mutate((d) => {
    const extendId = freeExtends(d, dr), layerId = activeLayerId(d);
    let path;
    if (extendId) { path = P.getPath(d, extendId)!; P.orientToEnd(d, extendId, dr.startNode!.pointId, dr.startNode!.cell); }
    else path = P.startPath(d, dr.startNode ?? nodeForSnap(d, dr.startSnap, fit.points[0], layerId), UI.prefs.value.style, layerId);
    const h = end?.hit, n = fit.points.length, at = fit.points[n - 1];
    const add = (node: Node, j: number) => { if (P.appendNode(d, path.id, node) && fit.cps[j]) P.setControlPointWorld(d, path.id, path.segments.length - 1, fit.cps[j]); };
    fit.points.slice(1, -1).forEach((v, j) => add(P.addPoint(d, toUV(v, d.lattice)), j));
    // Own start, repeat or line (D7: split the stroke's own earlier line, every segment so far, and share the node there);
    // its own clone (D8) is a new point, re-snapped below; anything else as any drawing end.
    const own = ownEndNode(d, path, h, at, path.segments.length);
    const lastNode = own ?? (h?.kind === 'ownCopy' ? P.addPoint(d, toUV(at, d.lattice)) : nodeForSnap(d, end, at, layerId));
    add(lastNode, n - 2);
    if (path.segments.length === 0) { P.deletePath(d, path.id); return false; }
    if (h?.kind === 'ownCopy') {                             // D8: re-snap the end onto the fitted copy (location only)
      const p = P.getPath(d, path.id)!, W = P.pathWorld(d, p).map((q) => apply(h.M, q)), C = P.pathCpsWorld(d, p).map((c) => c && apply(h.M, c));
      let best: XY | null = null, bd = Infinity;
      for (let j = 0; j < p.segments.length - 1; j++) { const r = nearestOnSeg(W[j], C[j], W[j + 1], at); if (r.d < bd) { bd = r.d; best = r.q; } }
      if (best) { const uv = toUV(best, d.lattice); P.movePoint(d, lastNode.pointId, uv.u - lastNode.cell.c, uv.v - lastNode.cell.r); }
    }
    if (!extendId) bindNewPath(d, path.id);
    pathId = path.id;
  });
  if (pathId && P.getPath(doc.value, pathId)) UI.selection.value = { kind: 'path', id: pathId, copy: baseCopy };
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
