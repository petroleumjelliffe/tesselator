import type { Lattice } from './types';

export const CONFIG = {
  SNAP_PX: 12,
  HANDLE_PX: 6,          // radius of point / handle hit circles
  HIT_WIDTH: 14,         // segment hit width
  DRAG_THRESHOLD_PX: 3,
  BBOX_ROT_OFFSET: 26,
  ELEMENT_ROT_OFFSET: 70,
  TOUCH_HIT_SCALE: 2,

  ZOOM_MIN: 0.2,
  ZOOM_MAX: 8,
  MAX_HISTORY: 50,
  ORBIT_CAP: 12,
  CLONE_CAP: 48,         // clones per binding across all groups

  // Snapping (spec 2026-09-30 §6): one precedence list, points before lines; a held snap lets go at 1.5× the threshold
  // and yields to a same-class rival only when that rival is nearer by half the threshold.
  SNAP_PRECEDENCE: {
    point: ['intersection', 'node', 'ownStart', 'ownFixed', 'ownClone', 'ownRepeat', 'centre', 'corner', 'grid'],
    line: ['ownFixed', 'axis', 'edge', 'line', 'ownLine', 'ownClone', 'ownRepeat'],
  } as const,
  SNAP_STICKY_RELEASE: 1.5,
  SNAP_STICKY_MARGIN: 0.5,
  NODE_REVEAL_PX: 48,    // H8: while Pen/Freehand is active, a path's nodes show only within this many screen px of it
  FRACTION_MAX_N: 4,     // T13: size fractions k/n of the tile, n ≤ this (may later grow with zoom)
  TRACE_BREAKAWAY_PX: 24,   // a traced stroke lets go of its line beyond this distance (screen px)
  MIN_LATTICE_DET: 400,
  VISIBLE_CELL_RADIUS: 3,
  DEFAULT_GRID_DIVISIONS: 8,
  DEFAULT_GHOST_OPACITY: 0.45,
  FREEHAND_EPS: 5,
  FREEHAND_MIN_DEVIATION: 2.5,
  AUTOSAVE_MS: 300,
  MAX_WALLPAPER: 64,

  COLORS: {
    background: '#f4f2ec', ink: '#1c1b18', muted: '#7a766c', grid: '#e2dfd5', frame: '#b9b5aa',
    accent: '#3b6fd1', element: '#7048e8', lattice: '#c2255c',
  },
  SWATCHES: [['Ink', '#1c1b18'], ['Red', '#c2255c'], ['Blue', '#1c7ed6'], ['Green', '#2b8a3e'], ['Ochre', '#c98a12'], ['Violet', '#7048e8']] as const,
  WEIGHTS: [1, 2, 3.5, 6, 10] as const,
  LATTICE_PRESETS: {
    Square: { ax: 240, ay: 0, bx: 0, by: 240 },
    Rectangle: { ax: 300, ay: 0, bx: 0, by: 200 },
    Parallelogram: { ax: 240, ay: 0, bx: 100, by: 220 },
    'Rhombus 60°': { ax: 240, ay: 0, bx: 120, by: 207.85 },
    'Hex / triangle': { ax: 240, ay: 0, bx: -120, by: 207.85 },
  } as Record<string, Lattice>,
  STORAGE_DOC_KEY: 'tessellator.doc.v1',
  STORAGE_PREFS_KEY: 'tessellator.prefs.v1',
};
