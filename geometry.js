// Geometry operations: add, delete, modify geometries and instances
export class GeometryManager {
  constructor(stateManager) {
    this.stateManager = stateManager;
  }

  getState() {
    return this.stateManager.getState();
  }

  saveState() {
    this.stateManager.saveState();
  }

  // Get geometry by ID
  getGeometryById(id) {
    const state = this.getState();
    return state.geometries.find((g) => g.id === id) || null;
  }

  // Get instance by ID
  getInstanceById(id) {
    const state = this.getState();
    return state.instances.find((i) => i.id === id) || null;
  }

  // Get selected instance
  getSelectedInstance() {
    const state = this.getState();
    if (!state.selectedInstanceId) return null;
    return this.getInstanceById(state.selectedInstanceId);
  }

  // Add new geometry at a point
  addGeometryAtPoint(worldPt) {
    this.saveState();

    const state = this.getState();
    const geom = {
      id: this.stateManager.makeId(),
      points: [{ id: this.stateManager.makeId(), x: worldPt.x, y: worldPt.y }],
      closed: false,
    };
    state.geometries.push(geom);

    // Create default instance in base orientation
    const inst = {
      id: this.stateManager.makeId(),
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

  // Add point to current drawing
  addPointToCurrentDrawing(worldPt) {
    const state = this.getState();
    if (!state.currentDrawing) return;

    const geom = this.getGeometryById(state.currentDrawing);
    if (!geom) return;

    this.saveState();

    const pt = {
      id: this.stateManager.makeId(),
      x: worldPt.x,
      y: worldPt.y,
    };
    geom.points.push(pt);
    state.selectedGeometryId = geom.id;
    state.selectedPointId = pt.id;
  }

  // Finish current drawing (check for closed loop)
  finishCurrentDrawing(worldPt, zoom) {
    const state = this.getState();
    if (!state.currentDrawing) return;

    const geom = this.getGeometryById(state.currentDrawing);
    if (!geom || geom.points.length < 2) {
      state.currentDrawing = null;
      return;
    }

    const first = geom.points[0];
    const dx = worldPt.x - first.x;
    const dy = worldPt.y - first.y;
    const distSq = dx * dx + dy * dy;
    const thresholdWorld = (10 / zoom) * (10 / zoom);

    if (distSq < thresholdWorld) {
      this.saveState();
      geom.closed = true;
    }

    state.currentDrawing = null;
  }

  // Delete a geometry (and all its instances)
  deleteGeometry(geomId) {
    const state = this.getState();
    const geomIndex = state.geometries.findIndex((g) => g.id === geomId);
    if (geomIndex === -1) return;

    this.saveState();

    state.geometries.splice(geomIndex, 1);
    state.instances = state.instances.filter((i) => i.geometryId !== geomId);

    if (state.selectedGeometryId === geomId) {
      state.selectedGeometryId = null;
      state.selectedPointId = null;
    }
    if (state.currentDrawing === geomId) {
      state.currentDrawing = null;
    }
    if (state.selectedInstanceId) {
      const inst = this.getInstanceById(state.selectedInstanceId);
      if (!inst || inst.geometryId === geomId) {
        state.selectedInstanceId = null;
      }
    }
  }

  // Delete an instance
  deleteInstance(instanceId) {
    const inst = this.getInstanceById(instanceId);
    if (!inst) return;

    this.saveState();

    const state = this.getState();
    const geomId = inst.geometryId;

    state.instances = state.instances.filter((i) => i.id !== instanceId);

    if (state.selectedInstanceId === instanceId) {
      state.selectedInstanceId = null;
    }

    // If no more instances reference this geometry, delete the geometry too
    const stillUsed = state.instances.some((i) => i.geometryId === geomId);
    if (!stillUsed) {
      this.deleteGeometry(geomId);
    }
  }

  // Delete a point from a geometry
  deletePoint(geomId, pointId) {
    const geom = this.getGeometryById(geomId);
    if (!geom) return;

    const idx = geom.points.findIndex((p) => p.id === pointId);
    if (idx === -1) return;

    this.saveState();

    const state = this.getState();
    geom.points.splice(idx, 1);

    if (geom.points.length < 2) {
      // Not enough points to form a line: delete whole geometry
      this.deleteGeometry(geomId);
      return;
    }

    const newIndex = Math.min(idx, geom.points.length - 1);
    state.selectedPointId = geom.points[newIndex].id;
  }

  // Clone an instance (linked copy with same geometry)
  cloneSelectedInstance() {
    const state = this.getState();
    const baseInst =
      this.getSelectedInstance() ||
      (state.selectedGeometryId
        ? state.instances.find((i) => i.geometryId === state.selectedGeometryId)
        : null);

    if (!baseInst) return null;

    this.saveState();

    const newInst = {
      id: this.stateManager.makeId(),
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

  // Update a point position
  updatePoint(geomId, pointId, newX, newY) {
    const geom = this.getGeometryById(geomId);
    if (!geom) return;

    const pt = geom.points.find((p) => p.id === pointId);
    if (!pt) return;

    pt.x = newX;
    pt.y = newY;
  }

  // Update instance transform
  updateInstanceTransform(instanceId, transform) {
    const inst = this.getInstanceById(instanceId);
    if (!inst) return;

    Object.assign(inst.transform, transform);
  }
}
