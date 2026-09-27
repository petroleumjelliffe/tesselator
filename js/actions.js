// Shared user actions, invoked from both the toolbar (main.js) and the keyboard
// (interaction.js). Each mutates state and records history; callers re-render.
import { state, getSelectedSubtile, getGeometryById, clearSelection } from './state.js';
import { pushHistory, undo as historyUndo, redo as historyRedo } from './history.js';
import {
  cloneSelectedSubtile,
  deleteSubtile,
  deletePoint,
  deleteGeometry,
  toggleSegmentType,
  endCurrentDrawing,
  loadExample,
} from './geometry.js';
import { CONFIG } from './config.js';

export function setTool(tool) {
  if (state.activeTool === tool) return;
  if (state.currentDrawing) endCurrentDrawing();
  state.activeTool = tool;
  state.cursorWorld = null;
  if (tool === 'transform') {
    // Select works on whole tiles; drop point-level selection
    state.selectedPointId = null;
    state.selectedSegmentIndex = null;
  }
}

export function finishDrawing() {
  if (!state.currentDrawing) return false;
  endCurrentDrawing();
  return true;
}

export function cloneSelection() {
  if (!getSelectedSubtile()) return false;
  pushHistory();
  cloneSelectedSubtile();
  return true;
}

export function rotateSelection(direction) {
  const subtile = getSelectedSubtile();
  if (!subtile) return false;
  pushHistory();
  const next = subtile.rotation + direction * CONFIG.ROTATION_INCREMENT;
  subtile.rotation = ((next % 360) + 360) % 360;
  return true;
}

export function mirrorSelection(axis) {
  const subtile = getSelectedSubtile();
  if (!subtile) return false;
  pushHistory();
  subtile[axis] = !subtile[axis];
  return true;
}

export function toggleSelectedSegmentCurve() {
  const geom = getGeometryById(state.selectedGeometryId);
  if (!geom || state.selectedSegmentIndex === null) return false;
  pushHistory();
  toggleSegmentType(geom.id, state.selectedSegmentIndex);
  return true;
}

// Delete whatever is selected: tile (Select tool), point, or whole shape
export function deleteSelection() {
  if (state.activeTool === 'transform' && state.selectedSubtileId) {
    pushHistory();
    deleteSubtile(state.selectedSubtileId);
    clearSelection();
    return true;
  }
  if (state.selectedGeometryId && state.selectedPointId) {
    pushHistory();
    deletePoint(state.selectedGeometryId, state.selectedPointId);
    return true;
  }
  if (state.selectedGeometryId) {
    pushHistory();
    deleteGeometry(state.selectedGeometryId);
    clearSelection();
    return true;
  }
  return false;
}

export function undo() {
  if (state.currentDrawing) endCurrentDrawing();
  return historyUndo();
}

export function redo() {
  if (state.currentDrawing) endCurrentDrawing();
  return historyRedo();
}

export function toggleSnap() {
  state.gridSnapping = !state.gridSnapping;
}

export function toggleTiling() {
  state.showTilingGrid = !state.showTilingGrid;
}

export function loadExampleScene() {
  pushHistory();
  loadExample();
}
