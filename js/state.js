// Application state
import { CONFIG } from './config.js';

export const state = {
  // Core data
  geometries: [], // [{id, points:[{id,x,y}], segments, closed}] - geometry in subtile-local coordinates
  subtiles: [], // [{id, geometryId, x, y, width, height, rotation, mirrorX, mirrorY}] - subtile containers

  activeTool: "draw", // 'draw' (Pen) | 'edit' (Edit points) | 'transform' (Select)
  currentDrawing: null, // subtileId if actively drawing in a subtile
  cursorWorld: null, // last pointer position in world space (for the pen rubber band)

  // viewport
  pan: { x: 0, y: 0 },
  zoom: 1,

  // selection
  selectedGeometryId: null,
  selectedPointId: null,
  selectedSubtileId: null,
  selectedSegmentIndex: null, // index of selected segment in geometry.segments
  selectedResizeHandle: null, // 'top' | 'right' | 'bottom' | 'left' when dragging subtile edge

  // interaction
  dragging: null, // { type: 'pan' | 'point' | 'subtile' | 'controlPoint' | 'resizeHandle', historyPushed, ... }
  spacePanning: false,
  gridSnapping: true, // toggle with 'G' key
  showTilingGrid: false, // 3x3 repeat toggle (OFF by default), '3' key
};

// Getters
export function getGeometryById(id) {
  return state.geometries.find((g) => g.id === id) || null;
}

export function getSubtileById(id) {
  return state.subtiles.find((s) => s.id === id) || null;
}

export function getSelectedSubtile() {
  if (!state.selectedSubtileId) return null;
  return getSubtileById(state.selectedSubtileId);
}

export function getSelectedGeometry() {
  if (!state.selectedGeometryId) return null;
  return getGeometryById(state.selectedGeometryId);
}

export function clearSelection() {
  state.selectedGeometryId = null;
  state.selectedPointId = null;
  state.selectedSubtileId = null;
  state.selectedSegmentIndex = null;
}
