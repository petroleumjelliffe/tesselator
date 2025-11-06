// Coordinate transformation utilities
export class TransformManager {
  constructor(stateManager) {
    this.stateManager = stateManager;
  }

  getState() {
    return this.stateManager.getState();
  }

  // Convert SVG client coordinates to SVG point
  getSvgPoint(evt, svg) {
    const rect = svg.getBoundingClientRect();
    return {
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top,
    };
  }

  // Convert screen coordinates to world coordinates
  screenToWorld(pt) {
    const state = this.getState();
    return {
      x: (pt.x - state.pan.x) / state.zoom,
      y: (pt.y - state.pan.y) / state.zoom,
    };
  }

  // Check if a world point is in the center (base) tile
  isInCenterTile(worldPt) {
    const state = this.getState();
    const w = state.tileSize.x;
    const h = state.tileSize.y;
    return worldPt.x >= 0 && worldPt.x <= w && worldPt.y >= 0 && worldPt.y <= h;
  }

  // Apply instance transform to a geometry point
  applyInstanceToPoint(inst, pt) {
    const t = inst.transform;
    const rad = (t.rotation * Math.PI) / 180;
    let x = pt.x;
    let y = pt.y;

    if (t.mirrorX) x = -x;
    if (t.mirrorY) y = -y;

    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;

    return { x: rx + t.tx, y: ry + t.ty };
  }

  // Convert world point to geometry point (inverse transform)
  worldToGeometryPoint(worldPt, inst, tileRow, tileCol) {
    const state = this.getState();
    const w = state.tileSize.x;
    const h = state.tileSize.y;
    const t = inst.transform;

    // Remove tile and instance translation
    const localX = worldPt.x - tileCol * w - t.tx;
    const localY = worldPt.y - tileRow * h - t.ty;

    const rad = (t.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // Inverse rotation
    const xr = cos * localX + sin * localY;
    const yr = -sin * localX + cos * localY;

    // Inverse mirror
    let gx = xr;
    let gy = yr;
    if (t.mirrorX) gx = -gx;
    if (t.mirrorY) gy = -gy;

    return { x: gx, y: gy };
  }

  // Center view on base tile
  centerView(svg) {
    const state = this.getState();
    const containerRect = svg.getBoundingClientRect();
    const cx = containerRect.width / 2;
    const cy = containerRect.height / 2;

    state.pan.x = cx - (state.tileSize.x * state.zoom) / 2;
    state.pan.y = cy - (state.tileSize.y * state.zoom) / 2;
  }

  // Zoom at a specific point
  zoomAt(svgPt, zoomFactor) {
    const state = this.getState();
    const before = this.screenToWorld(svgPt);

    state.zoom *= zoomFactor;
    state.zoom = Math.max(0.2, Math.min(5, state.zoom));

    const after = this.screenToWorld(svgPt);
    state.pan.x += (after.x - before.x) * state.zoom;
    state.pan.y += (after.y - before.y) * state.zoom;
  }
}
