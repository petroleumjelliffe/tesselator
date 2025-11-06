// Configuration constants
export const CONFIG = {
  // Tile settings
  TILE_SIZE: { x: 300, y: 300 },
  GRID_DIVISIONS: 8,
  TILE_ROWS: 3,
  TILE_COLS: 3,

  // Interaction thresholds
  POINT_HIT_THRESHOLD: 10, // pixels (screen space)
  INSTANCE_HIT_THRESHOLD: 20, // pixels (screen space)
  SNAP_CLOSE_THRESHOLD: 10, // pixels (screen space) for closing polylines

  // Zoom limits
  ZOOM_MIN: 0.2,
  ZOOM_MAX: 5,
  ZOOM_FACTOR: 1.1,

  // Visual settings
  POINT_RADIUS: 4, // world space
  CONTROL_POINT_RADIUS: 3, // world space

  // Transform increments
  ROTATION_INCREMENT: 15, // degrees

  // Colors (for programmatic styling if needed)
  COLORS: {
    background: '#18181b',
    grid: '#374151',
    gridInner: '#27272f',
    gridBase: '#f97316',
    path: '#38bdf8',
    pathInstanceSelected: '#22c55e',
    pathGeometrySelected: '#f97316',
    pointHandle: '#0ea5e9',
    pointHandleSelected: '#f97316',
  },
};
