// Undo/redo over document references. A gesture records one entry however many commits it makes.
import { signal } from '@preact/signals';
import { CONFIG } from '../config';
import { doc } from './doc';
import { selection, pen, hover, drag } from './ui';
import type { Doc } from '../types';

const past: Doc[] = [];
const future: Doc[] = [];
let inGesture = false;
let gestureBase: Doc | null = null;
export const historyVersion = signal(0);

function trim() { while (past.length > CONFIG.MAX_HISTORY) past.shift(); }
function clearTransient() { selection.value = null; pen.value = null; hover.value = null; drag.value = null; }

export function commit(next: Doc): void {
  if (inGesture) {
    if (!gestureBase) { gestureBase = doc.value; past.push(gestureBase); trim(); future.length = 0; }
  } else {
    past.push(doc.value); trim(); future.length = 0;
  }
  doc.value = next;
  historyVersion.value++;
}

export function beginGesture(): void { inGesture = true; gestureBase = null; }
export function endGesture(): void { inGesture = false; gestureBase = null; }

// Revert everything the current gesture did and forget it.
export function abortGesture(): void {
  if (inGesture && gestureBase) { past.pop(); doc.value = gestureBase; }
  inGesture = false; gestureBase = null;
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
export function reset(): void { past.length = 0; future.length = 0; inGesture = false; gestureBase = null; historyVersion.value++; }
