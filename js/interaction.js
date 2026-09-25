// Event handlers and hit testing for subtile-based system
import { state, getGeometryById, getSubtileById, getSelectedSubtile } from './state.js';
import { getSvgPoint, screenToWorld, worldToSubtileLocal, isPointInSubtile, snapToGrid } from './transform.js';
import {
  createNewSubtileAt,
  addPointToCurrentDrawing,
  finishCurrentDrawing,
  deleteGeometry,
  deleteSubtile,
  deletePoint,
  toggleSegmentType
} from './geometry.js';
import { CONFIG } from './config.js';
import { clone } from './utils.js';

// Hit test to find which subtile contains a world point
export function hitTestSubtile(worldPt) {
  // Check subtiles in reverse order (top to bottom in rendering)
  for (let i = state.subtiles.length - 1; i >= 0; i--) {
    const subtile = state.subtiles[i];
    if (isPointInSubtile(worldPt, subtile)) {
      return subtile;
    }
  }
  return null;
}

// Hit test to find a point within any subtile
export function hitTestPoint(worldPt) {
  const threshold = CONFIG.POINT_HIT_THRESHOLD / state.zoom;
  let best = null;
  let bestDist = Infinity;

  state.subtiles.forEach((subtile) => {
    const geom = getGeometryById(subtile.geometryId);
    if (!geom) return;

    const localPt = worldToSubtileLocal(worldPt, subtile);

    geom.points.forEach((pt) => {
      const dx = localPt.x - pt.x;
      const dy = localPt.y - pt.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < threshold && dist < bestDist) {
        bestDist = dist;
        best = {
          subtileId: subtile.id,
          geometryId: geom.id,
          pointId: pt.id,
        };
      }
    });
  });

  return best;
}

// Hit test for control points (when in edit mode)
export function hitTestControlPoint(worldPt) {
  if (!state.selectedGeometryId || state.activeTool !== 'edit') return null;

  const threshold = CONFIG.POINT_HIT_THRESHOLD / state.zoom;
  let best = null;
  let bestDist = Infinity;

  state.subtiles.forEach((subtile) => {
    if (subtile.geometryId !== state.selectedGeometryId) return;

    const geom = getGeometryById(subtile.geometryId);
    if (!geom) return;

    const localPt = worldToSubtileLocal(worldPt, subtile);

    geom.segments.forEach((segment, idx) => {
      if (segment.type === 'bezier' && segment.cp) {
        const dx = localPt.x - segment.cp.x;
        const dy = localPt.y - segment.cp.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < threshold && dist < bestDist) {
          bestDist = dist;
          best = {
            subtileId: subtile.id,
            geometryId: geom.id,
            segmentIndex: idx,
          };
        }
      }
    });
  });

  return best;
}

// Hit test for segments (clicking on the line between two points)
export function hitTestSegment(worldPt) {
  if (state.activeTool !== 'edit') return null;

  const threshold = 10 / state.zoom;
  let best = null;
  let bestDist = Infinity;

  state.subtiles.forEach((subtile) => {
    const geom = getGeometryById(subtile.geometryId);
    if (!geom || geom.points.length < 2) return;

    const localPt = worldToSubtileLocal(worldPt, subtile);
    const numSegments = geom.closed ? geom.points.length : geom.points.length - 1;

    for (let i = 0; i < numSegments; i++) {
      const p1 = geom.points[i];
      const p2 = geom.points[(i + 1) % geom.points.length];

      // Calculate distance from point to line segment
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const lengthSq = dx * dx + dy * dy;
      if (lengthSq === 0) continue;

      const t = Math.max(0, Math.min(1,
        ((localPt.x - p1.x) * dx + (localPt.y - p1.y) * dy) / lengthSq
      ));

      const projX = p1.x + t * dx;
      const projY = p1.y + t * dy;
      const distX = localPt.x - projX;
      const distY = localPt.y - projY;
      const dist = Math.sqrt(distX * distX + distY * distY);

      if (dist < threshold && dist < bestDist) {
        bestDist = dist;
        best = {
          subtileId: subtile.id,
          geometryId: geom.id,
          segmentIndex: i,
        };
      }
    }
  });

  return best;
}

// Event handlers
export function createEventHandlers(svg, render) {
  function onPointerDown(evt) {
    evt.preventDefault();
    svg.setPointerCapture(evt.pointerId);

    const button = evt.button;
    const svgPt = getSvgPoint(svg, evt);
    const worldPt = screenToWorld(svgPt);

    const isPanButton = button === 1 || button === 2 || state.spacePanning;

    if (isPanButton) {
      state.dragging = {
        type: "pan",
        startPan: clone(state.pan),
        startPointer: { x: evt.clientX, y: evt.clientY },
      };
      return;
    }

    if (state.activeTool === "draw") {
      if (!state.currentDrawing) {
        // Start a new drawing by creating a new subtile
        const { subtile } = createNewSubtileAt(worldPt);
        render();
      } else {
        // Add point to current drawing
        const subtile = getSubtileById(state.currentDrawing);
        if (subtile) {
          const localPt = worldToSubtileLocal(worldPt, subtile);
          const snapped = snapToGrid(localPt, subtile, state.gridSnapping);
          addPointToCurrentDrawing(snapped);
          render();
        }
      }
      return;
    }

    if (state.activeTool === "edit") {
      // Priority: control points > points > segments

      // First check for control point hits
      const cpHit = hitTestControlPoint(worldPt);
      if (cpHit) {
        state.selectedGeometryId = cpHit.geometryId;
        state.selectedSubtileId = cpHit.subtileId;
        state.selectedSegmentIndex = cpHit.segmentIndex;
        state.selectedPointId = null;
        state.dragging = {
          type: "controlPoint",
          subtileId: cpHit.subtileId,
          geometryId: cpHit.geometryId,
          segmentIndex: cpHit.segmentIndex,
        };
        render();
        return;
      }

      // Then check for point hits
      const pointHit = hitTestPoint(worldPt);
      if (pointHit) {
        state.selectedGeometryId = pointHit.geometryId;
        state.selectedPointId = pointHit.pointId;
        state.selectedSubtileId = pointHit.subtileId;
        state.selectedSegmentIndex = null;
        state.dragging = {
          type: "point",
          subtileId: pointHit.subtileId,
          geometryId: pointHit.geometryId,
          pointId: pointHit.pointId,
        };
        render();
        return;
      }

      // Finally check for segment hits
      const segHit = hitTestSegment(worldPt);
      if (segHit) {
        state.selectedGeometryId = segHit.geometryId;
        state.selectedSubtileId = segHit.subtileId;
        state.selectedSegmentIndex = segHit.segmentIndex;
        state.selectedPointId = null;
        render();
        return;
      }

      // Nothing hit - clear selection
      state.selectedGeometryId = null;
      state.selectedPointId = null;
      state.selectedSegmentIndex = null;
      render();
      return;
    }

    if (state.activeTool === "transform") {
      // Check if we clicked on a subtile
      const subtile = hitTestSubtile(worldPt);
      if (subtile) {
        state.selectedSubtileId = subtile.id;
        state.selectedGeometryId = subtile.geometryId;
        state.dragging = {
          type: "subtile",
          subtileId: subtile.id,
          startWorld: worldPt,
          startX: subtile.x,
          startY: subtile.y,
        };
        render();
      } else {
        // Click background: clear selection
        state.selectedSubtileId = null;
        state.selectedGeometryId = null;
        render();
      }
      return;
    }
  }

  function onPointerMove(evt) {
    if (!state.dragging) return;
    evt.preventDefault();

    if (state.dragging.type === "pan") {
      const dx = evt.clientX - state.dragging.startPointer.x;
      const dy = evt.clientY - state.dragging.startPointer.y;
      state.pan.x = state.dragging.startPan.x + dx;
      state.pan.y = state.dragging.startPan.y + dy;
      render();
      return;
    }

    if (state.dragging.type === "point") {
      const svgPt = getSvgPoint(svg, evt);
      const worldPt = screenToWorld(svgPt);
      const subtile = getSubtileById(state.dragging.subtileId);
      const geom = getGeometryById(state.dragging.geometryId);
      if (!subtile || !geom) return;

      const pt = geom.points.find((p) => p.id === state.dragging.pointId);
      if (!pt) return;

      let localPt = worldToSubtileLocal(worldPt, subtile);
      localPt = snapToGrid(localPt, subtile, state.gridSnapping);

      pt.x = localPt.x;
      pt.y = localPt.y;

      render();
      return;
    }

    if (state.dragging.type === "controlPoint") {
      const svgPt = getSvgPoint(svg, evt);
      const worldPt = screenToWorld(svgPt);
      const subtile = getSubtileById(state.dragging.subtileId);
      const geom = getGeometryById(state.dragging.geometryId);
      if (!subtile || !geom) return;

      const segment = geom.segments[state.dragging.segmentIndex];
      if (!segment || segment.type !== 'bezier') return;

      let localPt = worldToSubtileLocal(worldPt, subtile);
      localPt = snapToGrid(localPt, subtile, state.gridSnapping);

      segment.cp.x = localPt.x;
      segment.cp.y = localPt.y;

      render();
      return;
    }

    if (state.dragging.type === "subtile") {
      const svgPt = getSvgPoint(svg, evt);
      const worldPt = screenToWorld(svgPt);
      const subtile = getSubtileById(state.dragging.subtileId);
      if (!subtile) return;

      const dx = worldPt.x - state.dragging.startWorld.x;
      const dy = worldPt.y - state.dragging.startWorld.y;

      subtile.x = state.dragging.startX + dx;
      subtile.y = state.dragging.startY + dy;

      // TODO: Add edge-snapping logic here

      render();
      return;
    }
  }

  function onPointerUp(evt) {
    svg.releasePointerCapture(evt.pointerId);
    state.dragging = null;
  }

  function onDblClick(evt) {
    if (state.activeTool !== "draw" || !state.currentDrawing) return;
    evt.preventDefault();
    const svgPt = getSvgPoint(svg, evt);
    const worldPt = screenToWorld(svgPt);
    const subtile = getSubtileById(state.currentDrawing);
    if (subtile) {
      const localPt = worldToSubtileLocal(worldPt, subtile);
      finishCurrentDrawing(localPt);
      render();
    }
  }

  function onWheel(evt) {
    evt.preventDefault();
    const delta = -evt.deltaY;
    const zoomFactor = delta > 0 ? CONFIG.ZOOM_FACTOR : 1 / CONFIG.ZOOM_FACTOR;

    const svgPt = getSvgPoint(svg, evt);
    const before = screenToWorld(svgPt);

    state.zoom *= zoomFactor;
    state.zoom = Math.max(CONFIG.ZOOM_MIN, Math.min(CONFIG.ZOOM_MAX, state.zoom));

    const after = screenToWorld(svgPt);
    // Adjust pan to zoom around cursor
    state.pan.x += (after.x - before.x) * state.zoom;
    state.pan.y += (after.y - before.y) * state.zoom;

    render();
  }

  function onKeyDown(evt) {
    if (evt.code === "Space") {
      state.spacePanning = true;
    }

    // Deletion
    if (evt.key === "Backspace" || evt.key === "Delete") {
      if (state.activeTool === "transform" && state.selectedSubtileId) {
        // Delete selected subtile
        deleteSubtile(state.selectedSubtileId);
      } else if (state.selectedGeometryId && state.selectedPointId) {
        // Delete selected point
        deletePoint(state.selectedGeometryId, state.selectedPointId);
      } else if (state.selectedGeometryId) {
        // Delete whole geometry (all subtiles using it)
        deleteGeometry(state.selectedGeometryId);
      }
      render();
      evt.preventDefault();
      return;
    }

    // Tool switching
    if (evt.key === "d" || evt.key === "D") {
      state.activeTool = "draw";
      state.currentDrawing = null;
      render();
    }
    if (evt.key === "e" || evt.key === "E") {
      state.activeTool = "edit";
      state.currentDrawing = null;
      render();
    }
    if (evt.key === "t" || evt.key === "T") {
      state.activeTool = "transform";
      state.currentDrawing = null;
      render();
    }

    // Toggle segment type (line <-> bezier)
    if (evt.key === "c" || evt.key === "C") {
      if (state.selectedGeometryId && state.selectedSegmentIndex !== null) {
        toggleSegmentType(state.selectedGeometryId, state.selectedSegmentIndex);
        render();
        evt.preventDefault();
      }
    }

    // Toggle grid snapping
    if (evt.key === "g" || evt.key === "G") {
      state.gridSnapping = !state.gridSnapping;
      render();
      evt.preventDefault();
    }

    // Toggle 3x3 tiling grid
    if (evt.key === "v" || evt.key === "V") {
      state.showTilingGrid = !state.showTilingGrid;
      render();
      evt.preventDefault();
    }

    // Rotation / mirroring shortcuts for selected subtile
    const subtile = getSelectedSubtile();
    if (subtile) {
      if (evt.key === "[") {
        subtile.rotation -= CONFIG.ROTATION_INCREMENT;
        render();
      }
      if (evt.key === "]") {
        subtile.rotation += CONFIG.ROTATION_INCREMENT;
        render();
      }
      if (evt.key === "x" || evt.key === "X") {
        subtile.mirrorX = !subtile.mirrorX;
        render();
      }
      if (evt.key === "y" || evt.key === "Y") {
        subtile.mirrorY = !subtile.mirrorY;
        render();
      }
    }
  }

  function onKeyUp(evt) {
    if (evt.code === "Space") {
      state.spacePanning = false;
    }
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDblClick,
    onWheel,
    onKeyDown,
    onKeyUp,
  };
}
