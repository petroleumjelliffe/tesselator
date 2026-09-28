// One listener set on the SVG. Single pointer → active tool. Two pointers → pan and pinch-zoom; a second
// finger during a drag reverts that drag. Keyboard and wheel live here too.
import { doc } from '../state/doc';
import * as UI from '../state/ui';
import * as A from '../actions';
import { beginGesture, endGesture, abortGesture } from '../state/history';
import { copies, cloneMatrices, faces } from '../state/derived';
import { hitTest, type HitContext } from '../engine/hit';
import { CONFIG } from '../config';
import * as select from './tools/select';
import * as pen from './tools/pen';
import * as freehand from './tools/freehand';
import * as fill from './tools/fill';
import * as construct from './tools/construct';
import type { ToolModule, ToolCtx } from './tools/common';
import type { XY, View, PointerKind } from '../types';

const TOOLS: Record<string, ToolModule> = { select, pen, freehand, fill };
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: XY, b: XY): XY => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function attachPointer(svg: SVGSVGElement): () => void {
  const pointers = new Map<number, XY>();
  let nav: { startMid: XY; startDist: number; startView: View } | null = null;
  let navDead = false;
  let dragTool: ToolModule | null = null;

  const screen = (e: PointerEvent | WheelEvent): XY => { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const world = (e: PointerEvent | WheelEvent): XY => { const s = screen(e), v = UI.view.value; return { x: (s.x - v.pan.x) / v.zoom, y: (s.y - v.pan.y) / v.zoom }; };
  const kindOf = (e: PointerEvent): PointerKind => (e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse');
  const scaleOf = (e: PointerEvent) => (e.pointerType === 'touch' ? CONFIG.TOUCH_HIT_SCALE : 1);
  const ctxOf = (e: PointerEvent): ToolCtx => ({ snapOn: UI.prefs.value.snap !== e.shiftKey, hitScale: scaleOf(e), threshold: A.threshold(scaleOf(e)) });
  const hitCtx = (hitScale: number): HitContext => ({ layer: UI.layer.value, tool: UI.tool.value, selection: UI.selection.value, pen: UI.pen.value, zoom: UI.view.value.zoom, hitScale, copies: copies.value, cloneMatrices: cloneMatrices.value, faces: faces.value });
  const activeTool = (): ToolModule => (UI.layer.value === 'construction' ? construct : TOOLS[UI.tool.value]);

  function onDown(e: PointerEvent) {
    UI.lastPointerType.value = kindOf(e);
    if (e.button !== 0) return;                        // never recorded: a right/middle press released elsewhere would strand its id
    if (e.pointerType === 'mouse') pointers.clear();   // a mouse is one pointer; a stale id would count as a second finger
    pointers.set(e.pointerId, screen(e));
    if (pointers.size === 2) {
      if (UI.drag.value) { abortGesture(); UI.drag.value = null; UI.fillPreview.value = null; dragTool = null; }
      const [a, b] = [...pointers.values()];
      nav = { startMid: mid(a, b), startDist: Math.max(1, dist(a, b)), startView: UI.view.value };
      navDead = true;
      return;
    }
    if (pointers.size > 2 || navDead) return;
    const w = world(e), target = hitTest(doc.value, hitCtx(scaleOf(e)), w);
    let t = activeTool();
    if (UI.space.value && UI.layer.value === 'drawing' && (UI.pen.value || UI.tool.value === 'freehand')) { construct.startMultiDrag(w, target, e); t = construct; }
    else t.onDown(target, w, e, ctxOf(e));
    if (UI.drag.value) { dragTool = t; try { svg.setPointerCapture(e.pointerId); } catch { /* unsupported */ } }
  }

  function onMove(e: PointerEvent) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, screen(e));
    if (nav && pointers.size >= 2) {
      const [a, b] = [...pointers.values()], m = mid(a, b), d = Math.max(1, dist(a, b));
      const z0 = nav.startView.zoom, z = Math.min(CONFIG.ZOOM_MAX, Math.max(CONFIG.ZOOM_MIN, (z0 * d) / nav.startDist));
      const anchor = { x: (nav.startMid.x - nav.startView.pan.x) / z0, y: (nav.startMid.y - nav.startView.pan.y) / z0 };
      UI.view.value = { zoom: z, pan: { x: m.x - anchor.x * z, y: m.y - anchor.y * z } };
      return;
    }
    if (navDead) return;
    const w = world(e);
    UI.cursor.value = w;
    const d = UI.drag.value;
    if (!d) { UI.hover.value = hitTest(doc.value, hitCtx(scaleOf(e)), w); return; }
    if (d.pointerId !== e.pointerId || !dragTool) return;
    if (!d.moved && dist(w, d.start) > CONFIG.DRAG_THRESHOLD_PX / UI.view.value.zoom) { d.moved = true; beginGesture(); }
    dragTool.onMove(d, w, e, ctxOf(e));
    if (UI.drag.value) UI.drag.value = { ...UI.drag.value };   // republish so components see mutated fields
  }

  function onUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (nav) { if (pointers.size < 2) nav = null; if (pointers.size === 0) navDead = false; return; }
    if (pointers.size === 0) navDead = false;
    const d = UI.drag.value;
    if (dragTool && !d) { dragTool = null; endGesture(); return; }   // drag cleared under us (undo/redo): close the gesture anyway
    if (!d || d.pointerId !== e.pointerId || !dragTool) return;
    const t = dragTool;
    UI.drag.value = null; dragTool = null;
    endGesture();
    t.onUp(d, world(e), e, ctxOf(e));
    UI.hover.value = hitTest(doc.value, hitCtx(scaleOf(e)), world(e));
  }

  function onCancel(e?: PointerEvent) {
    if (e) pointers.delete(e.pointerId); else pointers.clear();
    if (!pointers.size) { nav = null; navDead = false; }
    if (UI.drag.value || dragTool) { UI.drag.value = null; dragTool = null; endGesture(); UI.fillPreview.value = null; }
  }

  // Safety net for a release the SVG never sees (over a floating panel, outside the window, or capture lost): forget the
  // id so it cannot pose as a second pointer later and leave navDead set until reload. Runs after the SVG's own handlers.
  function onWindowUp(e: PointerEvent) {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size < 2) nav = null;
    if (pointers.size === 0) navDead = false;
  }

  function onDblClick(e: MouseEvent) {
    const w = world(e as unknown as PointerEvent), t = hitTest(doc.value, hitCtx(1), w);
    if (t && t.kind === 'diamond') A.straightenSegment(t.pathId, t.j);
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) A.zoomAt(screen(e), Math.exp(-e.deltaY * 0.01));
    else A.panBy(-e.deltaX, -e.deltaY);
  }

  function onKeyDown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement | null)?.tagName ?? '';
    if (/input|textarea|select/i.test(tag)) return;
    const meta = e.metaKey || e.ctrlKey, k = e.key;
    if (e.code === 'Space') { e.preventDefault(); UI.space.value = true; return; }
    if (k === 'Tab') { e.preventDefault(); A.setLayer(UI.layer.value === 'drawing' ? 'construction' : 'drawing'); return; }
    if (meta && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) A.redo(); else A.undo(); return; }
    if (meta && (k === 'y' || k === 'Y')) { e.preventDefault(); A.redo(); return; }
    if (meta && k === '0') { e.preventDefault(); A.fitToTile(); return; }
    if (meta) return;
    switch (k) {
      case 'Escape': if (UI.pen.value) A.endPen(); else UI.selection.value = null; return;
      case 'Enter': A.endPen(); return;
      case 'Backspace': case 'Delete': e.preventDefault(); A.deleteHoveredOrSelection(); return;
      case '[': A.rotateSelectedElement(-15); return;
      case ']': A.rotateSelectedElement(15); return;
      case '?': A.toggleHelp(); return;
      default:
    }
    switch (k.toLowerCase()) {
      case 'v': A.setTool('select'); break;
      case 'p': A.setTool('pen'); break;
      case 'f': A.setTool(UI.tool.value === 'freehand' ? 'pen' : 'freehand'); break;
      case 'b': A.setTool('fill'); break;
      case 'o': A.addElement('rotate'); break;
      case 'm': A.addElement('mirror'); break;
      case 't': A.addElement('translate'); break;
      case 'g': A.toggleSnap(); break;
      default:
    }
  }
  function onKeyUp(e: KeyboardEvent) { if (e.code === 'Space') UI.space.value = false; }
  const swallow = (e: Event) => e.preventDefault();
  const blur = () => onCancel();

  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onCancel);
  svg.addEventListener('dblclick', onDblClick);
  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('contextmenu', swallow);
  for (const g of ['gesturestart', 'gesturechange', 'gestureend']) svg.addEventListener(g, swallow);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', blur);
  for (const g of ['pointerup', 'pointercancel', 'lostpointercapture']) window.addEventListener(g, onWindowUp as EventListener);
  return () => {
    svg.removeEventListener('pointerdown', onDown); svg.removeEventListener('pointermove', onMove); svg.removeEventListener('pointerup', onUp);
    svg.removeEventListener('pointercancel', onCancel); svg.removeEventListener('dblclick', onDblClick); svg.removeEventListener('wheel', onWheel);
    svg.removeEventListener('contextmenu', swallow); for (const g of ['gesturestart', 'gesturechange', 'gestureend']) svg.removeEventListener(g, swallow);
    window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', blur);
    for (const g of ['pointerup', 'pointercancel', 'lostpointercapture']) window.removeEventListener(g, onWindowUp as EventListener);
  };
}
