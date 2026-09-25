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

// Convert world coordinates to subtile-local coordinates
export function worldToSubtileLocal(worldPt, subtile) {
  return {
    x: worldPt.x - subtile.x,
    y: worldPt.y - subtile.y,
  };
}

// Convert subtile-local coordinates to world coordinates
export function subtileLocalToWorld(localPt, subtile) {
  return {
    x: localPt.x + subtile.x,
    y: localPt.y + subtile.y,
  };
}

// Check if a world point is inside a subtile
export function isPointInSubtile(worldPt, subtile) {
  return worldPt.x >= subtile.x &&
         worldPt.x <= subtile.x + subtile.width &&
         worldPt.y >= subtile.y &&
         worldPt.y <= subtile.y + subtile.height;
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
