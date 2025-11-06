// Application state
import { CONFIG } from './config.js';

export const state = {
  tileSize: { ...CONFIG.TILE_SIZE },
  geometries: [], // [{id, points:[{id,x,y}], closed}]
  instances: [], // [{id, geometryId, transform:{tx,ty,rotation,mirrorX,mirrorY}}]
  activeTool: "draw", // 'draw' | 'edit' | 'transform'
  currentDrawing: null, // geometryId if a polyline is being drawn

  // viewport
  pan: { x: 0, y: 0 },
  zoom: 1,

  // selection
  selectedGeometryId: null,
  selectedPointId: null,
  selectedInstanceId: null,
  selectedSegmentIndex: null, // index of selected segment in geometry.segments

  // interaction
  dragging: null, // { type: 'pan' | 'point' | 'instance' | 'controlPoint', ... }
  spacePanning: false,
  gridSnapping: true, // toggle with 'G' key
};

// Getters
export function getGeometryById(id) {
  return state.geometries.find((g) => g.id === id) || null;
}

export function getInstanceById(id) {
  return state.instances.find((i) => i.id === id) || null;
}

export function getSelectedInstance() {
  if (!state.selectedInstanceId) return null;
  return getInstanceById(state.selectedInstanceId);
}
