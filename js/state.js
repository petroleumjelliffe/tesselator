// Application state
import { CONFIG } from './config.js';

export const state = {
  // Core data
  geometries: [], // [{id, points:[{id,x,y}], segments, closed}] - geometry in subtile-local coordinates
  subtiles: [], // [{id, geometryId, x, y, width, height, rotation, mirrorX, mirrorY}] - subtile containers

  activeTool: "draw", // 'draw' | 'edit' | 'transform'
  currentDrawing: null, // subtileId if actively drawing in a subtile

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
  dragging: null, // { type: 'pan' | 'point' | 'subtile' | 'controlPoint' | 'resizeHandle', ... }
  spacePanning: false,
  gridSnapping: true, // toggle with 'G' key
  showTilingGrid: false, // 3x3 grid toggle (OFF by default)
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
