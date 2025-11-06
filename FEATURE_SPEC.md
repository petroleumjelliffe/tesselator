# Tessellation Editor - Feature Spec: Bezier Curves & Undo

## Current State
- Polyline drawing tool with straight line segments
- Edit mode for moving points
- Transform mode for moving/rotating/mirroring instances
- Clone and delete functionality
- 3x3 tiled view with pan/zoom

## 1. Bezier Curve Support

### Data Structure Changes
- Modify geometry points to include optional control points:
  - Each segment between points can be either **linear** or **bezier**
  - Store control point data: `{id, x, y, type: 'line'|'bezier', cp1: {x,y}, cp2: {x,y}}`
  - Default to linear segments for backward compatibility

### UI/UX
- **New Tool**: "Convert to Curve" mode or keyboard shortcut (e.g., 'C')
- **Edit Mode Enhancement**:
  - Select a line segment to convert it to bezier
  - Show control point handles when bezier segment is selected
  - Drag control points to adjust curve shape
  - Visual distinction: control points shown as smaller hollow circles connected with dashed lines

### Rendering
- Replace `<polyline>` with `<path>` using SVG path commands
- Generate path data: `M` (move), `L` (line), `C` (cubic bezier)
- Maintain proper rendering across transforms (rotation, mirror)

### Interaction
- Click segment → toggle linear/bezier
- Drag control points in edit mode
- Control points follow instance transforms
- Hit testing for control point handles
- Grid snapping option - when dragging points, snap to nearest grid intersection
- add point: while drawing or editing points, allow hovering over active segment, and insert a point when clicking.  preview the handle on hover, and place it on click.
- allow resizing the grid, and adjusting aspect ratio.  grid can be portrait or landscape rectangles

## 2. Undo/Redo System

### Implementation
- **History Stack**: Array of state snapshots (deep clones)
- **Undo Stack**: Track past states
- **Redo Stack**: Track undone states (cleared on new action)
- **Max History**: Limit to last 50 actions (configurable)

### Tracked Actions
- Draw new geometry
- Add/move/delete points
- Convert segment to/from bezier
- Move/adjust control points
- Transform instances (translate, rotate, mirror)
- Clone instances
- Delete geometry/instances

### UI
- Keyboard shortcuts: Ctrl+Z (undo), Ctrl+Shift+Z or Ctrl+Y (redo)
- Toolbar buttons: ⟲ Undo / ⟳ Redo (with disabled state)
- Status hint showing available undo/redo count

### Technical Details
- Save state **after** each discrete action completes
- Don't save intermediate drag states (only save on pointer up)
- Don't save pan/zoom changes
- Deep clone state to prevent reference mutations
- Clear redo stack when new action occurs

## Open Questions
1. Should bezier curves default to symmetric control points (smooth curves) or independent?
2. Should we support quadratic bezier (1 control point) or only cubic (2 control points)?
3. Auto-smooth option for converting multiple segments?
4. Undo limit: 50 states or memory-based limit?
5. Should we show a "curve degree" indicator for bezier segments?

## Implementation Order
1. Undo/redo system first (easier, provides safety net for testing)
2. Bezier curve data structure
3. Bezier rendering
4. Bezier UI interactions
5. Integration testing with transforms and cloning
