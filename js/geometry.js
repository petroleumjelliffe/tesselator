// Geometry and instance operations
import { state, getGeometryById, getInstanceById, getSelectedInstance } from './state.js';
import { makeId, clone } from './utils.js';
import { CONFIG } from './config.js';

export function addGeometryAtPoint(worldPt) {
  const geom = {
    id: makeId(),
    points: [{ id: makeId(), x: worldPt.x, y: worldPt.y }],
    segments: [], // segments[i] connects points[i] to points[i+1]
    closed: false,
  };
  state.geometries.push(geom);

  // Create default instance in base orientation
  const inst = {
    id: makeId(),
    geometryId: geom.id,
    transform: {
      tx: 0,
      ty: 0,
      rotation: 0,
      mirrorX: false,
      mirrorY: false,
    },
  };
  state.instances.push(inst);

  state.currentDrawing = geom.id;
  state.selectedGeometryId = geom.id;
  state.selectedPointId = geom.points[0].id;
  state.selectedInstanceId = inst.id;
  return geom;
}

export function addPointToCurrentDrawing(worldPt) {
  if (!state.currentDrawing) return;
  const geom = getGeometryById(state.currentDrawing);
  if (!geom) return;
  const pt = { id: makeId(), x: worldPt.x, y: worldPt.y };
  geom.points.push(pt);
  // Add a line segment from the previous point to this new point
  geom.segments.push({ type: 'line' });
  state.selectedGeometryId = geom.id;
  state.selectedPointId = pt.id;
}

export function finishCurrentDrawing(worldPt) {
  if (!state.currentDrawing) return;
  const geom = getGeometryById(state.currentDrawing);
  if (!geom || geom.points.length < 2) {
    state.currentDrawing = null;
    return;
  }

  const first = geom.points[0];
  const dx = worldPt.x - first.x;
  const dy = worldPt.y - first.y;
  const distSq = dx * dx + dy * dy;
  const thresholdWorld = (CONFIG.SNAP_CLOSE_THRESHOLD / state.zoom) * (CONFIG.SNAP_CLOSE_THRESHOLD / state.zoom);
  if (distSq < thresholdWorld) {
    geom.closed = true;
    // Add closing segment from last point to first point
    geom.segments.push({ type: 'line' });
  }

  state.currentDrawing = null;
}

export function deleteGeometry(geomId) {
  const geomIndex = state.geometries.findIndex((g) => g.id === geomId);
  if (geomIndex === -1) return;
  state.geometries.splice(geomIndex, 1);

  // Remove all instances of this geometry
  state.instances = state.instances.filter(
    (i) => i.geometryId !== geomId
  );

  if (state.selectedGeometryId === geomId) {
    state.selectedGeometryId = null;
    state.selectedPointId = null;
  }
  if (state.currentDrawing === geomId) {
    state.currentDrawing = null;
  }
  if (state.selectedInstanceId) {
    const inst = getInstanceById(state.selectedInstanceId);
    if (!inst || inst.geometryId === geomId) {
      state.selectedInstanceId = null;
    }
  }
}

export function deleteInstance(instanceId) {
  const inst = getInstanceById(instanceId);
  if (!inst) return;
  const geomId = inst.geometryId;

  state.instances = state.instances.filter((i) => i.id !== instanceId);

  if (state.selectedInstanceId === instanceId) {
    state.selectedInstanceId = null;
  }

  // If no more instances reference this geometry, delete the geometry too
  const stillUsed = state.instances.some(
    (i) => i.geometryId === geomId
  );
  if (!stillUsed) {
    deleteGeometry(geomId);
  }
}

export function deletePoint(geomId, pointId) {
  const geom = getGeometryById(geomId);
  if (!geom) return;
  const idx = geom.points.findIndex((p) => p.id === pointId);
  if (idx === -1) return;

  geom.points.splice(idx, 1);

  // Remove the segment coming into this point (if not the first point)
  if (idx > 0 && geom.segments.length >= idx) {
    geom.segments.splice(idx - 1, 1);
  }
  // If this is the first point of a closed shape, remove the closing segment
  if (idx === 0 && geom.closed && geom.segments.length > 0) {
    geom.segments.pop(); // Remove the closing segment
  }

  if (geom.points.length < 2) {
    // Not enough points to form a line: delete whole geometry
    deleteGeometry(geomId);
    return;
  }

  const newIndex = Math.min(idx, geom.points.length - 1);
  state.selectedPointId = geom.points[newIndex].id;
}

export function cloneSelectedInstance() {
  const baseInst =
    getSelectedInstance() ||
    (state.selectedGeometryId
      ? state.instances.find(
          (i) => i.geometryId === state.selectedGeometryId
        )
      : null);

  if (!baseInst) return;

  const newInst = {
    id: makeId(),
    geometryId: baseInst.geometryId,
    transform: {
      tx: baseInst.transform.tx + 20,
      ty: baseInst.transform.ty + 20,
      rotation: baseInst.transform.rotation,
      mirrorX: baseInst.transform.mirrorX,
      mirrorY: baseInst.transform.mirrorY,
    },
  };
  state.instances.push(newInst);
  state.selectedInstanceId = newInst.id;
  return newInst;
}

// Convert a segment between line and bezier
export function toggleSegmentType(geomId, segmentIndex) {
  const geom = getGeometryById(geomId);
  if (!geom || segmentIndex < 0 || segmentIndex >= geom.segments.length) return;

  const segment = geom.segments[segmentIndex];
  const p1 = geom.points[segmentIndex];
  const p2 = geom.points[(segmentIndex + 1) % geom.points.length];

  if (segment.type === 'line') {
    // Convert to bezier with control point at midpoint
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    geom.segments[segmentIndex] = {
      type: 'bezier',
      cp: { x: midX, y: midY }
    };
  } else {
    // Convert to line
    geom.segments[segmentIndex] = { type: 'line' };
  }
}

// Get segment index from two point indices
export function getSegmentIndex(geom, pointIdx1, pointIdx2) {
  if (!geom) return -1;
  const numPoints = geom.points.length;

  // Check if consecutive points
  if (pointIdx2 === (pointIdx1 + 1) % numPoints) {
    return pointIdx1;
  }
  if (pointIdx1 === (pointIdx2 + 1) % numPoints) {
    return pointIdx2;
  }
  return -1;
}
