// Undo/redo over document references. A gesture records one entry however many commits it makes.
import { signal } from '@preact/signals';
import { CONFIG } from '../config';
import { doc, draft } from './doc';
import { selection, pen, hover, drag, pendingGroup, clearSnap } from './ui';
import { viaSnapshot, repairVia, pathNodes, viaLive } from '../engine/paths';
import type { Doc, XY } from '../types';

const past: Doc[] = [];
const future: Doc[] = [];
let inGesture = false;
let gestureBase: Doc | null = null;
let gestureSnap: Map<string, XY> | null = null;   // every via node's world position when the gesture began
export const historyVersion = signal(0);

function trim() { while (past.length > CONFIG.MAX_HISTORY) past.shift(); }
function clearTransient() {
  selection.value = null; pen.value = null; hover.value = null; drag.value = null; pendingGroup.value = null;
  clearSnap();
}

export function commit(next: Doc): void {
  if (inGesture) {
    if (!gestureBase) { gestureBase = doc.value; past.push(gestureBase); trim(); future.length = 0; }
  } else {
    past.push(doc.value); trim(); future.length = 0;
  }
  doc.value = next;
  historyVersion.value++;
}

export function gestureActive(): boolean { return inGesture; }
const hasDeadVia = (d: Doc) => d.paths.some((p) => pathNodes(p).some((n) => !!n.via && !viaLive(d, n.via)));

// A gesture's commits skip via repair (mutate defers it to here): a via node whose clone slot the gesture removed is
// materialised where the gesture found it, in a commit that still coalesces into the gesture's one history entry.
export function beginGesture(): void { inGesture = true; gestureBase = null; gestureSnap = viaSnapshot(doc.value); }
export function endGesture(): void {
  if (inGesture && gestureSnap && hasDeadVia(doc.value)) { const d = draft(); repairVia(d, gestureSnap); commit(d); }
  inGesture = false; gestureBase = null; gestureSnap = null;
}

// Revert everything the current gesture did and forget it.
export function abortGesture(): void {
  if (inGesture && gestureBase) { past.pop(); doc.value = gestureBase; }
  inGesture = false; gestureBase = null; gestureSnap = null;
  historyVersion.value++;
}

export function undo(): boolean {
  endGesture();   // the drag that owned the gesture is cleared below; its later commits must not coalesce
  if (!past.length) return false;
  future.push(doc.value);
  doc.value = past.pop()!;
  clearTransient();
  historyVersion.value++;
  return true;
}

export function redo(): boolean {
  endGesture();
  if (!future.length) return false;
  past.push(doc.value);
  doc.value = future.pop()!;
  clearTransient();
  historyVersion.value++;
  return true;
}

export function canUndo(): boolean { historyVersion.value; return past.length > 0; }
export function canRedo(): boolean { historyVersion.value; return future.length > 0; }
export function reset(): void { past.length = 0; future.length = 0; inGesture = false; gestureBase = null; gestureSnap = null; historyVersion.value++; }
