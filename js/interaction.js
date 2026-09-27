// Event handlers and hit testing for subtile-based system
import { state, getGeometryById, getSubtileById, clearSelection } from './state.js';
import { getSvgPoint, screenToWorld, worldToSubtileLocal, isPointInSubtile, snapToGrid } from './transform.js';
import {
  createNewSubtileAt,
  addPointToCurrentDrawing,
  isNearDrawingStart,
  closeCurrentDrawing,
  finishCurrentDrawing,
  insertPointOnSegment,
  toggleSegmentType,
  straightenSegment,
  segmentCount,
  getSegmentHandle,
} from './geometry.js';
import { pushHistory } from './history.js';
import * as actions from './actions.js';
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
      const dist = Math.hypot(localPt.x - pt.x, localPt.y - pt.y);
      if (dist < threshold && dist < bestDist) {
        bestDist = dist;
        best = { subtileId: subtile.id, geometryId: geom.id, pointId: pt.id };
      }
    });
  });

  return best;
}

// Hit test for segment handles on the selected tile: control points of curves and
// midpoints of straight segments (dragging a midpoint bends the segment)
export function hitTestControlPoint(worldPt) {
  if (state.activeTool !== 'edit' || !state.selectedGeometryId || !state.selectedSubtileId) return null;
  const subtile = getSubtileById(state.selectedSubtileId);
  if (!subtile || subtile.geometryId !== state.selectedGeometryId) return null;
  const geom = getGeometryById(subtile.geometryId);
  if (!geom || geom.points.length < 2) return null;

  const threshold = CONFIG.POINT_HIT_THRESHOLD / state.zoom;
  const localPt = worldToSubtileLocal(worldPt, subtile);
  let best = null;
  let bestDist = Infinity;

  const n = segmentCount(geom);
  for (let idx = 0; idx < n; idx++) {
    const h = getSegmentHandle(geom, idx);
    const dist = Math.hypot(localPt.x - h.x, localPt.y - h.y);
    if (dist < threshold && dist < bestDist) {
      bestDist = dist;
      const seg = geom.segments[idx];
      best = {
        subtileId: subtile.id,
        geometryId: geom.id,
        segmentIndex: idx,
        isCurve: seg.type === 'bezier' && !!seg.cp,
      };
    }
  }

  return best;
}

// Hit test for segments (clicking on the line between two points)
export function hitTestSegment(worldPt) {
  if (state.activeTool !== 'edit') return null;

  const threshold = CONFIG.SEGMENT_HIT_THRESHOLD / state.zoom;
  let best = null;
  let bestDist = Infinity;

  state.subtiles.forEach((subtile) => {
    const geom = getGeometryById(subtile.geometryId);
    if (!geom || geom.points.length < 2) return;

    const localPt = worldToSubtileLocal(worldPt, subtile);
    const numSegments = segmentCount(geom);

    for (let i = 0; i < numSegments; i++) {
      const p1 = geom.points[i];
      const p2 = geom.points[(i + 1) % geom.points.length];

      // Distance from point to the segment's chord
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const lengthSq = dx * dx + dy * dy;
      if (lengthSq === 0) continue;

      const t = Math.max(0, Math.min(1,
        ((localPt.x - p1.x) * dx + (localPt.y - p1.y) * dy) / lengthSq
      ));
      const dist = Math.hypot(localPt.x - (p1.x + t * dx), localPt.y - (p1.y + t * dy));

      if (dist < threshold && dist < bestDist) {
        bestDist = dist;
        best = { subtileId: subtile.id, geometryId: geom.id, segmentIndex: i };
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
    if (button !== 0) return;

    if (state.activeTool === "draw") {
      if (!state.currentDrawing) {
        // Start a new tile with its first point at the click
        pushHistory();
        createNewSubtileAt(worldPt);
        state.cursorWorld = worldPt;
        render();
        return;
      }

      const subtile = getSubtileById(state.currentDrawing);
      const geom = subtile && getGeometryById(subtile.geometryId);
      if (!subtile || !geom) {
        state.currentDrawing = null;
        render();
        return;
      }

      const localPt = snapToGrid(worldToSubtileLocal(worldPt, subtile), subtile, state.gridSnapping);

      // Clicking the first point closes the shape
      if (isNearDrawingStart(localPt)) {
        pushHistory();
        closeCurrentDrawing();
        render();
        return;
      }

      // Ignore a repeat click on the last point (e.g. the second click of a double-click)
      const last = geom.points[geom.points.length - 1];
      if (last && last.x === localPt.x && last.y === localPt.y) return;

      pushHistory();
      addPointToCurrentDrawing(localPt);
      render();
      return;
    }

    if (state.activeTool === "edit") {
      // Priority: segment handles > points > segments

      const cpHit = hitTestControlPoint(worldPt);
      if (cpHit) {
        state.selectedSegmentIndex = cpHit.segmentIndex;
        state.selectedPointId = null;
        state.dragging = {
          type: "controlPoint",
          subtileId: cpHit.subtileId,
          geometryId: cpHit.geometryId,
          segmentIndex: cpHit.segmentIndex,
          // Dragging a straight segment's midpoint bends it into a curve on first move
          convertToCurve: !cpHit.isCurve,
          historyPushed: false,
        };
        render();
        return;
      }

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
          historyPushed: false,
        };
        render();
        return;
      }

      const segHit = hitTestSegment(worldPt);
      if (segHit) {
        const alreadySelected =
          state.selectedGeometryId === segHit.geometryId &&
          state.selectedSubtileId === segHit.subtileId &&
          state.selectedSegmentIndex === segHit.segmentIndex;
        if (alreadySelected) {
          // Second click on a selected segment inserts a point there
          const subtile = getSubtileById(segHit.subtileId);
          const localPt = snapToGrid(worldToSubtileLocal(worldPt, subtile), subtile, state.gridSnapping);
          pushHistory();
          insertPointOnSegment(segHit.geometryId, segHit.segmentIndex, localPt);
        } else {
          state.selectedGeometryId = segHit.geometryId;
          state.selectedSubtileId = segHit.subtileId;
          state.selectedSegmentIndex = segHit.segmentIndex;
          state.selectedPointId = null;
        }
        render();
        return;
      }

      // Nothing hit - clear selection
      clearSelection();
      render();
      return;
    }

    if (state.activeTool === "transform") {
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
          historyPushed: false,
        };
      } else {
        clearSelection();
      }
      render();
      return;
    }
  }

  function onPointerMove(evt) {
    const svgPt = getSvgPoint(svg, evt);
    const worldPt = screenToWorld(svgPt);

    if (!state.dragging) {
      // Pen rubber band follows the cursor while a shape is being drawn
      if (state.activeTool === "draw" && state.currentDrawing) {
        state.cursorWorld = worldPt;
        render();
      }
      return;
    }
    evt.preventDefault();

    if (state.dragging.type === "pan") {
      const dx = evt.clientX - state.dragging.startPointer.x;
      const dy = evt.clientY - state.dragging.startPointer.y;
      state.pan.x = state.dragging.startPan.x + dx;
      state.pan.y = state.dragging.startPan.y + dy;
      render();
      return;
    }

    // Every other drag mutates the model: record one history entry on first movement
    if (!state.dragging.historyPushed) {
      pushHistory();
      state.dragging.historyPushed = true;
    }

    if (state.dragging.type === "point") {
      const subtile = getSubtileById(state.dragging.subtileId);
      const geom = getGeometryById(state.dragging.geometryId);
      if (!subtile || !geom) return;

      const pt = geom.points.find((p) => p.id === state.dragging.pointId);
      if (!pt) return;

      const localPt = snapToGrid(worldToSubtileLocal(worldPt, subtile), subtile, state.gridSnapping);
      pt.x = localPt.x;
      pt.y = localPt.y;
      render();
      return;
    }

    if (state.dragging.type === "controlPoint") {
      const subtile = getSubtileById(state.dragging.subtileId);
      const geom = getGeometryById(state.dragging.geometryId);
      if (!subtile || !geom) return;

      if (state.dragging.convertToCurve) {
        toggleSegmentType(geom.id, state.dragging.segmentIndex);
        state.dragging.convertToCurve = false;
      }
      const segment = geom.segments[state.dragging.segmentIndex];
      if (!segment || segment.type !== 'bezier') return;

      const localPt = snapToGrid(worldToSubtileLocal(worldPt, subtile), subtile, state.gridSnapping);
      segment.cp.x = localPt.x;
      segment.cp.y = localPt.y;
      render();
      return;
    }

    if (state.dragging.type === "subtile") {
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
    if (svg.hasPointerCapture && svg.hasPointerCapture(evt.pointerId)) {
      svg.releasePointerCapture(evt.pointerId);
    }
    state.dragging = null;
  }

  function onDblClick(evt) {
    const svgPt = getSvgPoint(svg, evt);
    const worldPt = screenToWorld(svgPt);

    if (state.activeTool === "draw" && state.currentDrawing) {
      evt.preventDefault();
      const subtile = getSubtileById(state.currentDrawing);
      if (subtile) {
        const localPt = worldToSubtileLocal(worldPt, subtile);
        if (isNearDrawingStart(localPt)) pushHistory();
        finishCurrentDrawing(localPt);
        render();
      }
      return;
    }

    if (state.activeTool === "edit") {
      // Double-clicking a curve handle straightens the segment
      const cpHit = hitTestControlPoint(worldPt);
      if (cpHit && cpHit.isCurve) {
        evt.preventDefault();
        pushHistory();
        straightenSegment(cpHit.geometryId, cpHit.segmentIndex);
        state.selectedSegmentIndex = cpHit.segmentIndex;
        render();
      }
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
    if (evt.target && /input|textarea|select/i.test(evt.target.tagName)) return;
    const meta = evt.metaKey || evt.ctrlKey;

    // Undo / redo
    if (meta && (evt.key === "z" || evt.key === "Z")) {
      evt.preventDefault();
      if (evt.shiftKey) actions.redo();
      else actions.undo();
      render();
      return;
    }
    if (meta && (evt.key === "y" || evt.key === "Y")) {
      evt.preventDefault();
      actions.redo();
      render();
      return;
    }
    if (meta) return; // leave other browser shortcuts alone

    if (evt.code === "Space") {
      evt.preventDefault();
      if (!state.spacePanning) {
        state.spacePanning = true;
        render();
      }
      return;
    }

    if (evt.key === "Escape") {
      if (!actions.finishDrawing()) clearSelection();
      render();
      return;
    }
    if (evt.key === "Enter") {
      if (actions.finishDrawing()) render();
      return;
    }

    if (evt.key === "Backspace" || evt.key === "Delete") {
      evt.preventDefault();
      if (actions.deleteSelection()) render();
      return;
    }

    const key = evt.key.toLowerCase();

    // Tool switching (D and T kept as aliases of the older shortcuts)
    if (key === "v" || key === "t") { actions.setTool("transform"); render(); return; }
    if (key === "p" || key === "d") { actions.setTool("draw"); render(); return; }
    if (key === "e") { actions.setTool("edit"); render(); return; }

    // C: curve toggle on a selected segment, otherwise clone the selected tile
    if (key === "c") {
      evt.preventDefault();
      if (state.activeTool === "edit" && state.selectedSegmentIndex !== null) {
        if (actions.toggleSelectedSegmentCurve()) render();
      } else if (state.activeTool === "transform") {
        if (actions.cloneSelection()) render();
      }
      return;
    }

    if (key === "g") { evt.preventDefault(); actions.toggleSnap(); render(); return; }
    if (evt.key === "3") { evt.preventDefault(); actions.toggleTiling(); render(); return; }

    // Rotation / mirroring for the selected tile (Select tool)
    if (state.activeTool === "transform") {
      if (evt.key === "[") { if (actions.rotateSelection(-1)) render(); return; }
      if (evt.key === "]") { if (actions.rotateSelection(1)) render(); return; }
      if (key === "x") { if (actions.mirrorSelection("mirrorX")) render(); return; }
      if (key === "y") { if (actions.mirrorSelection("mirrorY")) render(); return; }
    }
  }

  function onKeyUp(evt) {
    if (evt.code === "Space") {
      state.spacePanning = false;
      render();
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
