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

export function screenToWorld(svgPt) {
  return {
    x: (svgPt.x - state.pan.x) / state.zoom,
    y: (svgPt.y - state.pan.y) / state.zoom,
  };
}

// A subtile's placement in world space: translate to its origin, then rotate and
// mirror about the centre of its box. Points stay in subtile-local coordinates.
function subtileFrame(subtile) {
  const rad = ((subtile.rotation || 0) * Math.PI) / 180;
  return {
    cos: Math.cos(rad),
    sin: Math.sin(rad),
    sx: subtile.mirrorX ? -1 : 1,
    sy: subtile.mirrorY ? -1 : 1,
    cx: subtile.width / 2,
    cy: subtile.height / 2,
  };
}

// Convert subtile-local coordinates to world coordinates
export function subtileLocalToWorld(localPt, subtile) {
  const { cos, sin, sx, sy, cx, cy } = subtileFrame(subtile);
  const x = (localPt.x - cx) * sx;
  const y = (localPt.y - cy) * sy;
  return {
    x: subtile.x + cx + x * cos - y * sin,
    y: subtile.y + cy + x * sin + y * cos,
  };
}

// Convert world coordinates to subtile-local coordinates (inverse of the above)
export function worldToSubtileLocal(worldPt, subtile) {
  const { cos, sin, sx, sy, cx, cy } = subtileFrame(subtile);
  const x = worldPt.x - subtile.x - cx;
  const y = worldPt.y - subtile.y - cy;
  const rx = x * cos + y * sin;
  const ry = -x * sin + y * cos;
  return {
    x: rx * sx + cx,
    y: ry * sy + cy,
  };
}

// SVG transform attribute that maps subtile-local coordinates to world space
export function subtileTransformString(subtile) {
  const cx = subtile.width / 2;
  const cy = subtile.height / 2;
  const sx = subtile.mirrorX ? -1 : 1;
  const sy = subtile.mirrorY ? -1 : 1;
  return `translate(${subtile.x + cx},${subtile.y + cy}) rotate(${subtile.rotation || 0}) scale(${sx},${sy}) translate(${-cx},${-cy})`;
}

// World-space corners of a subtile's box (accounts for rotation/mirroring)
export function getSubtileCorners(subtile) {
  return [
    { x: 0, y: 0 },
    { x: subtile.width, y: 0 },
    { x: subtile.width, y: subtile.height },
    { x: 0, y: subtile.height },
  ].map((p) => subtileLocalToWorld(p, subtile));
}

// Check if a world point is inside a subtile
export function isPointInSubtile(worldPt, subtile) {
  const l = worldToSubtileLocal(worldPt, subtile);
  return l.x >= 0 && l.x <= subtile.width && l.y >= 0 && l.y <= subtile.height;
}

// Snap a point to the nearest grid intersection (in subtile-local coordinates)
export function snapToGrid(localPt, subtile, enabled = true) {
  if (!enabled) return localPt;

  const gridStepX = subtile.width / CONFIG.GRID_DIVISIONS;
  const gridStepY = subtile.height / CONFIG.GRID_DIVISIONS;

  return {
    x: Math.round(localPt.x / gridStepX) * gridStepX,
    y: Math.round(localPt.y / gridStepY) * gridStepY,
  };
}
