// Snapshot-based undo/redo. Every mutating action calls pushHistory() before
// touching state; drags push once on their first movement.
import { state } from './state.js';

const MAX_HISTORY = 50;
const past = [];
const future = [];

function snapshot() {
  return JSON.stringify({
    geometries: state.geometries,
    subtiles: state.subtiles,
  });
}

function restore(snap) {
  const data = JSON.parse(snap);
  state.geometries = data.geometries;
  state.subtiles = data.subtiles;
  state.currentDrawing = null;
  state.dragging = null;
  state.selectedGeometryId = null;
  state.selectedPointId = null;
  state.selectedSubtileId = null;
  state.selectedSegmentIndex = null;
}

export function pushHistory() {
  past.push(snapshot());
  if (past.length > MAX_HISTORY) past.shift();
  future.length = 0;
}

export function undo() {
  if (!past.length) return false;
  future.push(snapshot());
  restore(past.pop());
  return true;
}

export function redo() {
  if (!future.length) return false;
  past.push(snapshot());
  restore(future.pop());
  return true;
}

export function canUndo() {
  return past.length > 0;
}

export function canRedo() {
  return future.length > 0;
}
