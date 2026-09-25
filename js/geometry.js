// Geometry and subtile operations
import { state, getGeometryById, getSubtileById, getSelectedSubtile } from './state.js';
import { makeId } from './utils.js';
import { CONFIG } from './config.js';

// Create a new subtile with new geometry at the given world position
export function createNewSubtileAt(worldPt) {
  const geom = {
    id: makeId(),
    points: [{ id: makeId(), x: 0, y: 0 }], // Start at local (0,0)
    segments: [],
    closed: false,
  };
  state.geometries.push(geom);

  const subtile = {
    id: makeId(),
    geometryId: geom.id,
    x: worldPt.x,
    y: worldPt.y,
    width: CONFIG.TILE_SIZE.x,
    height: CONFIG.TILE_SIZE.y,
    rotation: 0,
    mirrorX: false,
    mirrorY: false,
  };
  state.subtiles.push(subtile);

  state.currentDrawing = subtile.id;
  state.selectedGeometryId = geom.id;
  state.selectedPointId = geom.points[0].id;
  state.selectedSubtileId = subtile.id;

  return { geom, subtile };
}

// Add a point to the current drawing (in subtile-local coordinates)
export function addPointToCurrentDrawing(localPt) {
  if (!state.currentDrawing) return;
  const subtile = getSubtileById(state.currentDrawing);
  if (!subtile) return;

  const geom = getGeometryById(subtile.geometryId);
  if (!geom) return;

  const pt = { id: makeId(), x: localPt.x, y: localPt.y };
  geom.points.push(pt);
  geom.segments.push({ type: 'line' });

  state.selectedGeometryId = geom.id;
  state.selectedPointId = pt.id;
}

// Finish the current drawing
export function finishCurrentDrawing(localPt) {
  if (!state.currentDrawing) return;
  const subtile = getSubtileById(state.currentDrawing);
  if (!subtile) return;

  const geom = getGeometryById(subtile.geometryId);
  if (!geom || geom.points.length < 2) {
    state.currentDrawing = null;
    return;
  }

  const first = geom.points[0];
  const dx = localPt.x - first.x;
  const dy = localPt.y - first.y;
  const distSq = dx * dx + dy * dy;
  const thresholdLocal = (CONFIG.SNAP_CLOSE_THRESHOLD / state.zoom);

  if (distSq < thresholdLocal * thresholdLocal) {
    geom.closed = true;
    geom.segments.push({ type: 'line' });
  }

  state.currentDrawing = null;
}

// Clone the selected subtile (creates new subtile with same geometry)
export function cloneSelectedSubtile() {
  const baseSubtile = getSelectedSubtile();
  if (!baseSubtile) return null;

  const newSubtile = {
    id: makeId(),
    geometryId: baseSubtile.geometryId, // SAME geometry
    x: baseSubtile.x + 20,
    y: baseSubtile.y + 20,
    width: baseSubtile.width,
    height: baseSubtile.height,
    rotation: baseSubtile.rotation,
    mirrorX: baseSubtile.mirrorX,
    mirrorY: baseSubtile.mirrorY,
  };

  state.subtiles.push(newSubtile);
  state.selectedSubtileId = newSubtile.id;

  return newSubtile;
}

// Delete a subtile
export function deleteSubtile(subtileId) {
  const subtile = getSubtileById(subtileId);
  if (!subtile) return;

  const geomId = subtile.geometryId;
  state.subtiles = state.subtiles.filter((s) => s.id !== subtileId);

  if (state.selectedSubtileId === subtileId) {
    state.selectedSubtileId = null;
  }

  // If no more subtiles reference this geometry, delete it
  const stillUsed = state.subtiles.some((s) => s.geometryId === geomId);
  if (!stillUsed) {
    deleteGeometry(geomId);
  }
}

// Delete a geometry
export function deleteGeometry(geomId) {
  const geomIndex = state.geometries.findIndex((g) => g.id === geomId);
  if (geomIndex === -1) return;

  state.geometries.splice(geomIndex, 1);

  // Remove all subtiles using this geometry
  state.subtiles = state.subtiles.filter((s) => s.geometryId !== geomId);

  if (state.selectedGeometryId === geomId) {
    state.selectedGeometryId = null;
    state.selectedPointId = null;
  }
  if (state.currentDrawing) {
    const drawingSubtile = getSubtileById(state.currentDrawing);
    if (drawingSubtile && drawingSubtile.geometryId === geomId) {
      state.currentDrawing = null;
    }
  }
}

// Delete a point from a geometry
export function deletePoint(geomId, pointId) {
  const geom = getGeometryById(geomId);
  if (!geom) return;

  const idx = geom.points.findIndex((p) => p.id === pointId);
  if (idx === -1) return;

  geom.points.splice(idx, 1);

  // Remove the segment coming into this point
  if (idx > 0 && geom.segments.length >= idx) {
    geom.segments.splice(idx - 1, 1);
  }
  if (idx === 0 && geom.closed && geom.segments.length > 0) {
    geom.segments.pop();
  }

  if (geom.points.length < 2) {
    deleteGeometry(geomId);
    return;
  }

  const newIndex = Math.min(idx, geom.points.length - 1);
  state.selectedPointId = geom.points[newIndex].id;
}

// Toggle segment type between line and bezier
export function toggleSegmentType(geomId, segmentIndex) {
  const geom = getGeometryById(geomId);
  if (!geom || segmentIndex < 0 || segmentIndex >= geom.segments.length) return;

  const segment = geom.segments[segmentIndex];
  const p1 = geom.points[segmentIndex];
  const p2 = geom.points[(segmentIndex + 1) % geom.points.length];

  if (segment.type === 'line') {
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    geom.segments[segmentIndex] = {
      type: 'bezier',
      cp: { x: midX, y: midY }
    };
  } else {
    geom.segments[segmentIndex] = { type: 'line' };
  }
}

// Calculate bounding box of all subtiles (for base tile)
export function calculateBaseTileBounds() {
  if (state.subtiles.length === 0) {
    return { x: 0, y: 0, width: CONFIG.TILE_SIZE.x, height: CONFIG.TILE_SIZE.y };
  }

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  state.subtiles.forEach(subtile => {
    minX = Math.min(minX, subtile.x);
    minY = Math.min(minY, subtile.y);
    maxX = Math.max(maxX, subtile.x + subtile.width);
    maxY = Math.max(maxY, subtile.y + subtile.height);
  });

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}
