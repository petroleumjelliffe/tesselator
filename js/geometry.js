// Geometry and subtile operations
import { state, getGeometryById, getSubtileById, getSelectedSubtile } from './state.js';
import { makeId } from './utils.js';
import { CONFIG } from './config.js';
import { getSubtileCorners } from './transform.js';

// Number of drawable segments for a geometry (guards against a stale segments array)
export function segmentCount(geom) {
  const n = geom.points.length;
  const expected = geom.closed ? n : Math.max(0, n - 1);
  return Math.min(expected, geom.segments.length);
}

// The draggable handle for a segment: its control point if curved, else its midpoint
export function getSegmentHandle(geom, idx) {
  const p1 = geom.points[idx];
  const p2 = geom.points[(idx + 1) % geom.points.length];
  const seg = geom.segments[idx];
  if (seg && seg.type === 'bezier' && seg.cp) return seg.cp;
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

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
  state.selectedSegmentIndex = null;

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

// Is a local point close enough to the drawing's first point to close the shape?
export function isNearDrawingStart(localPt) {
  if (!state.currentDrawing) return false;
  const subtile = getSubtileById(state.currentDrawing);
  const geom = subtile && getGeometryById(subtile.geometryId);
  if (!geom || geom.points.length < 3) return false;
  const first = geom.points[0];
  const dx = localPt.x - first.x;
  const dy = localPt.y - first.y;
  const threshold = CONFIG.SNAP_CLOSE_THRESHOLD / state.zoom;
  return dx * dx + dy * dy < threshold * threshold;
}

// Close the current drawing back to its first point
export function closeCurrentDrawing() {
  if (!state.currentDrawing) return;
  const subtile = getSubtileById(state.currentDrawing);
  const geom = subtile && getGeometryById(subtile.geometryId);
  if (geom && geom.points.length >= 3 && !geom.closed) {
    geom.closed = true;
    geom.segments.push({ type: 'line' });
  }
  state.currentDrawing = null;
  state.cursorWorld = null;
}

// End the current drawing as an open path. A tile with fewer than two points is discarded.
export function endCurrentDrawing() {
  if (!state.currentDrawing) return;
  const subtile = getSubtileById(state.currentDrawing);
  const geom = subtile && getGeometryById(subtile.geometryId);
  state.currentDrawing = null;
  state.cursorWorld = null;
  if (geom && geom.points.length < 2) {
    deleteGeometry(geom.id);
    state.selectedSubtileId = null;
  }
}

// Finish the current drawing at a click position: closes if near the first point
export function finishCurrentDrawing(localPt) {
  if (isNearDrawingStart(localPt)) closeCurrentDrawing();
  else endCurrentDrawing();
}

// Clone the selected subtile (creates new subtile with same geometry)
export function cloneSelectedSubtile() {
  const baseSubtile = getSelectedSubtile();
  if (!baseSubtile) return null;

  const step = baseSubtile.width / CONFIG.GRID_DIVISIONS;
  const newSubtile = {
    id: makeId(),
    geometryId: baseSubtile.geometryId, // SAME geometry
    x: baseSubtile.x + step,
    y: baseSubtile.y + step,
    width: baseSubtile.width,
    height: baseSubtile.height,
    rotation: baseSubtile.rotation,
    mirrorX: baseSubtile.mirrorX,
    mirrorY: baseSubtile.mirrorY,
  };

  state.subtiles.push(newSubtile);
  state.selectedSubtileId = newSubtile.id;
  state.selectedGeometryId = newSubtile.geometryId;

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
  if (state.currentDrawing === subtileId) {
    state.currentDrawing = null;
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
    state.selectedSegmentIndex = null;
  }
  if (state.selectedSubtileId && !getSubtileById(state.selectedSubtileId)) {
    state.selectedSubtileId = null;
  }
  if (state.currentDrawing) {
    const drawingSubtile = getSubtileById(state.currentDrawing);
    if (!drawingSubtile || drawingSubtile.geometryId === geomId) {
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
  state.selectedSegmentIndex = null;
}

// Insert a point into a segment. A straight segment splits at the projection of
// localPt onto it; a curve splits at its midpoint (de Casteljau at t = 0.5).
export function insertPointOnSegment(geomId, segmentIndex, localPt) {
  const geom = getGeometryById(geomId);
  if (!geom || segmentIndex < 0 || segmentIndex >= segmentCount(geom)) return null;

  const p1 = geom.points[segmentIndex];
  const p2 = geom.points[(segmentIndex + 1) % geom.points.length];
  const seg = geom.segments[segmentIndex];

  let newPt;
  let newSegs;
  if (seg.type === 'bezier' && seg.cp) {
    const cp = seg.cp;
    newPt = {
      id: makeId(),
      x: 0.25 * p1.x + 0.5 * cp.x + 0.25 * p2.x,
      y: 0.25 * p1.y + 0.5 * cp.y + 0.25 * p2.y,
    };
    newSegs = [
      { type: 'bezier', cp: { x: (p1.x + cp.x) / 2, y: (p1.y + cp.y) / 2 } },
      { type: 'bezier', cp: { x: (cp.x + p2.x) / 2, y: (cp.y + p2.y) / 2 } },
    ];
  } else {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lengthSq = dx * dx + dy * dy || 1;
    const t = Math.max(0.05, Math.min(0.95,
      ((localPt.x - p1.x) * dx + (localPt.y - p1.y) * dy) / lengthSq
    ));
    newPt = { id: makeId(), x: p1.x + t * dx, y: p1.y + t * dy };
    newSegs = [{ type: 'line' }, { type: 'line' }];
  }

  geom.points.splice(segmentIndex + 1, 0, newPt);
  geom.segments.splice(segmentIndex, 1, ...newSegs);

  state.selectedGeometryId = geom.id;
  state.selectedPointId = newPt.id;
  state.selectedSegmentIndex = null;
  return newPt;
}

// Toggle segment type between line and bezier
export function toggleSegmentType(geomId, segmentIndex) {
  const geom = getGeometryById(geomId);
  if (!geom || segmentIndex < 0 || segmentIndex >= geom.segments.length) return;

  const segment = geom.segments[segmentIndex];
  if (segment.type === 'line') {
    const mid = getSegmentHandle(geom, segmentIndex);
    geom.segments[segmentIndex] = { type: 'bezier', cp: { x: mid.x, y: mid.y } };
  } else {
    geom.segments[segmentIndex] = { type: 'line' };
  }
}

// Turn a curved segment back into a straight line
export function straightenSegment(geomId, segmentIndex) {
  const geom = getGeometryById(geomId);
  if (!geom || !geom.segments[segmentIndex]) return;
  geom.segments[segmentIndex] = { type: 'line' };
}

// Calculate bounding box of all subtiles (for base tile), honouring rotation/mirroring
export function calculateBaseTileBounds() {
  if (state.subtiles.length === 0) {
    return { x: 0, y: 0, width: CONFIG.TILE_SIZE.x, height: CONFIG.TILE_SIZE.y };
  }

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  state.subtiles.forEach((subtile) => {
    getSubtileCorners(subtile).forEach((c) => {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x);
      maxY = Math.max(maxY, c.y);
    });
  });

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

// Example scene: one interlocking tile plus a linked clone, centred on the origin
export function loadExample() {
  const w = CONFIG.TILE_SIZE.x;
  const h = CONFIG.TILE_SIZE.y;
  const geom = {
    id: makeId(),
    points: [
      { id: makeId(), x: 0, y: 0 },
      { id: makeId(), x: w, y: 0 },
      { id: makeId(), x: w, y: h },
      { id: makeId(), x: 0, y: h },
    ],
    // Opposite edges carry complementary bumps so the tile repeats seamlessly
    segments: [
      { type: 'bezier', cp: { x: w / 2, y: -h * 0.2 } },
      { type: 'bezier', cp: { x: w * 1.2, y: h / 2 } },
      { type: 'bezier', cp: { x: w / 2, y: h * 0.8 } },
      { type: 'bezier', cp: { x: w * 0.2, y: h / 2 } },
    ],
    closed: true,
  };
  state.geometries = [geom];
  state.subtiles = [
    { id: makeId(), geometryId: geom.id, x: -w, y: -h / 2, width: w, height: h, rotation: 0, mirrorX: false, mirrorY: false },
    { id: makeId(), geometryId: geom.id, x: 0, y: -h / 2, width: w, height: h, rotation: 0, mirrorX: false, mirrorY: false },
  ];
  state.currentDrawing = null;
  state.selectedGeometryId = null;
  state.selectedPointId = null;
  state.selectedSubtileId = null;
  state.selectedSegmentIndex = null;
  state.showTilingGrid = true;
}
