// Event handlers and hit testing
import { state, getGeometryById, getInstanceById, getSelectedInstance } from './state.js';
import { getSvgPoint, screenToWorld, isInCenterTile, applyInstanceToPoint, worldToGeometryPoint, snapToGrid } from './transform.js';
import { addGeometryAtPoint, addPointToCurrentDrawing, finishCurrentDrawing, deleteGeometry, deleteInstance, deletePoint, toggleSegmentType } from './geometry.js';
import { CONFIG } from './config.js';
import { clone } from './utils.js';

// Hit testing: find nearest point instance across all tiles/instances
export function hitTestPoint(worldPt) {
  const w = state.tileSize.x;
  const h = state.tileSize.y;
  const threshold = CONFIG.POINT_HIT_THRESHOLD / state.zoom;
  let best = null;
  let bestDist = Infinity;

  state.instances.forEach((inst) => {
    const geom = getGeometryById(inst.geometryId);
    if (!geom) return;

    geom.points.forEach((pt) => {
      const instPt = applyInstanceToPoint(inst, pt);

      for (let row = -1; row <= 1; row++) {
        for (let col = -1; col <= 1; col++) {
          const copyX = instPt.x + col * w;
          const copyY = instPt.y + row * h;
          const dx = worldPt.x - copyX;
          const dy = worldPt.y - copyY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < threshold && dist < bestDist) {
            bestDist = dist;
            best = {
              geometryId: geom.id,
              pointId: pt.id,
              instanceId: inst.id,
              tileRow: row,
              tileCol: col,
            };
          }
        }
      }
    });
  });

  return best;
}

// Hit testing for instances (for transform mode) – closest instance based on any point
export function hitTestInstance(worldPt) {
  const w = state.tileSize.x;
  const h = state.tileSize.y;
  const threshold = CONFIG.INSTANCE_HIT_THRESHOLD / state.zoom;
  let best = null;
  let bestDist = Infinity;

  state.instances.forEach((inst) => {
    const geom = getGeometryById(inst.geometryId);
    if (!geom) return;

    geom.points.forEach((pt) => {
      const instPt = applyInstanceToPoint(inst, pt);

      for (let row = -1; row <= 1; row++) {
        for (let col = -1; col <= 1; col++) {
          const copyX = instPt.x + col * w;
          const copyY = instPt.y + row * h;
          const dx = worldPt.x - copyX;
          const dy = worldPt.y - copyY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < threshold && dist < bestDist) {
            bestDist = dist;
            best = {
              instanceId: inst.id,
            };
          }
        }
      }
    });
  });

  return best;
}

// Hit testing for segments (clicking on the line between two points)
export function hitTestSegment(worldPt) {
  if (state.activeTool !== 'edit') return null;

  const w = state.tileSize.x;
  const h = state.tileSize.y;
  const threshold = 10 / state.zoom; // distance from line to count as hit
  let best = null;
  let bestDist = Infinity;

  state.instances.forEach((inst) => {
    const geom = getGeometryById(inst.geometryId);
    if (!geom || geom.points.length < 2) return;

    const numSegments = geom.closed ? geom.points.length : geom.points.length - 1;

    for (let i = 0; i < numSegments; i++) {
      const p1 = geom.points[i];
      const p2 = geom.points[(i + 1) % geom.points.length];

      const p1Transformed = applyInstanceToPoint(inst, p1);
      const p2Transformed = applyInstanceToPoint(inst, p2);

      for (let row = -1; row <= 1; row++) {
        for (let col = -1; col <= 1; col++) {
          const p1x = p1Transformed.x + col * w;
          const p1y = p1Transformed.y + row * h;
          const p2x = p2Transformed.x + col * w;
          const p2y = p2Transformed.y + row * h;

          // Calculate distance from point to line segment
          const dx = p2x - p1x;
          const dy = p2y - p1y;
          const lengthSq = dx * dx + dy * dy;
          if (lengthSq === 0) continue; // p1 and p2 are the same

          const t = Math.max(0, Math.min(1,
            ((worldPt.x - p1x) * dx + (worldPt.y - p1y) * dy) / lengthSq
          ));

          const projX = p1x + t * dx;
          const projY = p1y + t * dy;
          const distX = worldPt.x - projX;
          const distY = worldPt.y - projY;
          const dist = Math.sqrt(distX * distX + distY * distY);

          if (dist < threshold && dist < bestDist) {
            bestDist = dist;
            best = {
              geometryId: geom.id,
              segmentIndex: i,
              instanceId: inst.id,
              tileRow: row,
              tileCol: col,
            };
          }
        }
      }
    }
  });

  return best;
}

// Hit testing for control points (for edit mode)
export function hitTestControlPoint(worldPt) {
  if (!state.selectedGeometryId || state.activeTool !== 'edit') return null;

  const w = state.tileSize.x;
  const h = state.tileSize.y;
  const threshold = CONFIG.POINT_HIT_THRESHOLD / state.zoom;
  let best = null;
  let bestDist = Infinity;

  state.instances.forEach((inst) => {
    if (inst.geometryId !== state.selectedGeometryId) return;
    const geom = getGeometryById(inst.geometryId);
    if (!geom) return;

    geom.segments.forEach((segment, idx) => {
      if (segment.type === 'bezier' && segment.cp) {
        const cpTransformed = applyInstanceToPoint(inst, segment.cp);

        for (let row = -1; row <= 1; row++) {
          for (let col = -1; col <= 1; col++) {
            const copyX = cpTransformed.x + col * w;
            const copyY = cpTransformed.y + row * h;
            const dx = worldPt.x - copyX;
            const dy = worldPt.y - copyY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < threshold && dist < bestDist) {
              bestDist = dist;
              best = {
                geometryId: geom.id,
                segmentIndex: idx,
                instanceId: inst.id,
                tileRow: row,
                tileCol: col,
              };
            }
          }
        }
      }
    });
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

    const isPanButton =
      button === 1 || button === 2 || state.spacePanning;

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
        // Only start a new polyline inside the center tile
        if (!isInCenterTile(worldPt)) return;
        addGeometryAtPoint(worldPt);
      } else {
        // Subsequent points: allow anywhere, no wrapping
        addPointToCurrentDrawing(worldPt);
      }
      render();
      return;
    }

    if (state.activeTool === "edit") {
      // Priority: control points > points > segments

      // First check for control point hits (highest priority)
      const cpHit = hitTestControlPoint(worldPt);
      if (cpHit) {
        const geom = getGeometryById(cpHit.geometryId);
        const inst = getInstanceById(cpHit.instanceId);
        if (!geom || !inst) return;

        state.selectedGeometryId = cpHit.geometryId;
        state.selectedInstanceId = cpHit.instanceId;
        state.selectedSegmentIndex = cpHit.segmentIndex;
        state.selectedPointId = null;
        state.dragging = {
          type: "controlPoint",
          geometryId: cpHit.geometryId,
          segmentIndex: cpHit.segmentIndex,
          instanceId: cpHit.instanceId,
          tileRow: cpHit.tileRow,
          tileCol: cpHit.tileCol,
        };
        render();
        return;
      }

      // Then check for regular point hits
      const pointHit = hitTestPoint(worldPt);
      if (pointHit) {
        const geom = getGeometryById(pointHit.geometryId);
        const inst = getInstanceById(pointHit.instanceId);
        if (!geom || !inst) return;
        const pt = geom.points.find((p) => p.id === pointHit.pointId);
        if (!pt) return;

        state.selectedGeometryId = pointHit.geometryId;
        state.selectedPointId = pointHit.pointId;
        state.selectedInstanceId = pointHit.instanceId;
        state.selectedSegmentIndex = null;
        state.dragging = {
          type: "point",
          geometryId: pointHit.geometryId,
          pointId: pointHit.pointId,
          instanceId: pointHit.instanceId,
          tileRow: pointHit.tileRow,
          tileCol: pointHit.tileCol,
        };
        render();
        return;
      }

      // Finally check for segment hits (lowest priority)
      const segHit = hitTestSegment(worldPt);
      if (segHit) {
        const geom = getGeometryById(segHit.geometryId);
        const inst = getInstanceById(segHit.instanceId);
        if (!geom || !inst) return;

        state.selectedGeometryId = segHit.geometryId;
        state.selectedInstanceId = segHit.instanceId;
        state.selectedSegmentIndex = segHit.segmentIndex;
        state.selectedPointId = null;
        render();
        return;
      }

      // Nothing hit - clear selection
      state.selectedGeometryId = null;
      state.selectedPointId = null;
      state.selectedSegmentIndex = null;
      // don't clear instance selection here so you can still transform it
      render();
      return;
    }

    if (state.activeTool === "transform") {
      const hitInst = hitTestInstance(worldPt);
      if (hitInst) {
        const inst = getInstanceById(hitInst.instanceId);
        if (!inst) return;
        state.selectedInstanceId = inst.id;
        state.selectedGeometryId = inst.geometryId;
        state.dragging = {
          type: "instance",
          instanceId: inst.id,
          startWorld: worldPt,
          startTx: inst.transform.tx,
          startTy: inst.transform.ty,
        };
        render();
      } else {
        // Click background: clear instance selection
        state.selectedInstanceId = null;
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
      const geom = getGeometryById(state.dragging.geometryId);
      const inst = getInstanceById(state.dragging.instanceId);
      if (!geom || !inst) return;
      const pt = geom.points.find((p) => p.id === state.dragging.pointId);
      if (!pt) return;

      let newGeomPt = worldToGeometryPoint(
        worldPt,
        inst,
        state.dragging.tileRow,
        state.dragging.tileCol
      );

      // Apply grid snapping
      newGeomPt = snapToGrid(newGeomPt, state.gridSnapping);

      pt.x = newGeomPt.x;
      pt.y = newGeomPt.y;

      render();
      return;
    }

    if (state.dragging.type === "controlPoint") {
      const svgPt = getSvgPoint(svg, evt);
      const worldPt = screenToWorld(svgPt);
      const geom = getGeometryById(state.dragging.geometryId);
      const inst = getInstanceById(state.dragging.instanceId);
      if (!geom || !inst) return;

      const segment = geom.segments[state.dragging.segmentIndex];
      if (!segment || segment.type !== 'bezier') return;

      let newGeomPt = worldToGeometryPoint(
        worldPt,
        inst,
        state.dragging.tileRow,
        state.dragging.tileCol
      );

      // Apply grid snapping
      newGeomPt = snapToGrid(newGeomPt, state.gridSnapping);

      segment.cp.x = newGeomPt.x;
      segment.cp.y = newGeomPt.y;

      render();
      return;
    }

    if (state.dragging.type === "instance") {
      const svgPt = getSvgPoint(svg, evt);
      const worldPt = screenToWorld(svgPt);
      const inst = getInstanceById(state.dragging.instanceId);
      if (!inst) return;

      const dx = worldPt.x - state.dragging.startWorld.x;
      const dy = worldPt.y - state.dragging.startWorld.y;
      inst.transform.tx = state.dragging.startTx + dx;
      inst.transform.ty = state.dragging.startTy + dy;

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
    finishCurrentDrawing(worldPt);
    render();
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
      const inst = getSelectedInstance();
      if (state.activeTool === "transform" && inst) {
        // Delete just this instance; if it's the last instance, delete its geometry too
        deleteInstance(inst.id);
      } else if (state.selectedGeometryId && state.selectedPointId) {
        // Delete selected point
        deletePoint(state.selectedGeometryId, state.selectedPointId);
      } else if (state.selectedGeometryId) {
        // Delete whole geometry (all its instances)
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

    // Rotation / mirroring shortcuts for selected instance
    const inst = getSelectedInstance();
    if (inst) {
      if (evt.key === "[") {
        inst.transform.rotation -= CONFIG.ROTATION_INCREMENT;
        render();
      }
      if (evt.key === "]") {
        inst.transform.rotation += CONFIG.ROTATION_INCREMENT;
        render();
      }
      if (evt.key === "x" || evt.key === "X") {
        inst.transform.mirrorX = !inst.transform.mirrorX;
        render();
      }
      if (evt.key === "y" || evt.key === "Y") {
        inst.transform.mirrorY = !inst.transform.mirrorY;
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
