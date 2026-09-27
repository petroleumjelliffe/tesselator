// Configuration constants
export const CONFIG = {
  // Tile settings
  TILE_SIZE: { x: 300, y: 300 },
  GRID_DIVISIONS: 8,
  TILE_ROWS: 3,
  TILE_COLS: 3,

  // Interaction thresholds
  POINT_HIT_THRESHOLD: 10, // pixels (screen space)
  SEGMENT_HIT_THRESHOLD: 10, // pixels (screen space)
  INSTANCE_HIT_THRESHOLD: 20, // pixels (screen space)
  SNAP_CLOSE_THRESHOLD: 10, // pixels (screen space) for closing polylines

  // Zoom limits
  ZOOM_MIN: 0.2,
  ZOOM_MAX: 5,
  ZOOM_FACTOR: 1.1,

  // Visual settings (screen-space pixels; divide by zoom in world space)
  POINT_RADIUS: 6,
  POINT_RADIUS_DIM: 5,
  CONTROL_HANDLE_SIZE: 8,
  GHOST_OPACITY: 0.45,

  // Transform increments
  ROTATION_INCREMENT: 90, // degrees

  // Colors (mirrors the CSS custom properties in index.html)
  COLORS: {
    background: '#f4f2ec',
    ink: '#1c1b18',
    muted: '#7a766c',
    grid: '#e2dfd5',
    frame: '#b9b5aa',
    accent: '#3b6fd1',
    link: 'rgba(59,111,209,0.55)',
    lattice: '#c2255c',
  },
};
