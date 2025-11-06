// Coordinate transformation utilities
import { state } from './state.js';
import { CONFIG } from './config.js';

export function getSvgPoint(svg, evt) {
  const rect = svg.getBoundingClientRect();
  return {
    x: evt.clientX - rect.left,
    y: evt.clientY - rect.top,
  };
}

export function screenToWorld(pt) {
  return {
    x: (pt.x - state.pan.x) / state.zoom,
    y: (pt.y - state.pan.y) / state.zoom,
  };
}

export function isInCenterTile(worldPt) {
  const w = state.tileSize.x;
  const h = state.tileSize.y;
  return (
    worldPt.x >= 0 && worldPt.x <= w && worldPt.y >= 0 && worldPt.y <= h
  );
}

export function applyInstanceToPoint(inst, pt) {
  const t = inst.transform;
  const rad = (t.rotation * Math.PI) / 180;
  let x = pt.x;
  let y = pt.y;
  if (t.mirrorX) x = -x;
  if (t.mirrorY) y = -y;
  const cos = Math.cos(rad),
    sin = Math.sin(rad);
  const rx = x * cos - y * sin;
  const ry = x * sin + y * cos;
  return { x: rx + t.tx, y: ry + t.ty };
}

export function worldToGeometryPoint(worldPt, inst, tileRow, tileCol) {
  const w = state.tileSize.x;
  const h = state.tileSize.y;
  const t = inst.transform;

  // Remove tile and instance translation
  const localX = worldPt.x - tileCol * w - t.tx;
  const localY = worldPt.y - tileRow * h - t.ty;

  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad),
    sin = Math.sin(rad);

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

// Snap a point to the nearest grid intersection
export function snapToGrid(pt, enabled = true) {
  if (!enabled) return pt;

  const w = state.tileSize.x;
  const h = state.tileSize.y;
  const gridStepX = w / CONFIG.GRID_DIVISIONS;
  const gridStepY = h / CONFIG.GRID_DIVISIONS;

  return {
    x: Math.round(pt.x / gridStepX) * gridStepX,
    y: Math.round(pt.y / gridStepY) * gridStepY,
  };
}
