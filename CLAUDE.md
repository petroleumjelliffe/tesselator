# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based tessellation editor: vanilla JavaScript ES modules + SVG, no framework, no build step, no dependencies, no tests. Entry point is `index.html`, which loads `js/main.js` as a module.

## Running it

ES modules won't load from `file://`, so serve the directory over HTTP:

```
python3 -m http.server 5173 --bind 127.0.0.1
```

Then open http://127.0.0.1:5173/. There is no hot reload; hard-refresh after edits (Python's server sends cache headers).

## Live code vs. dead code

Only `index.html` and `js/*.js` are live. Ignore these unless asked:

- Root-level `geometry.js`, `state.js`, `transforms.js` — an older class-based design (`StateManager`, `GeometryManager`, `TransformManager`) that nothing imports.
- `tessellation_editor_phase3_delete.html` — a self-contained single-file prototype that predates the `js/` split.

`FEATURE_SPEC.md` is the roadmap (bezier curves, undo/redo). It describes cubic beziers, but the implementation uses quadratic (single `cp`).

## Architecture

**State + full re-render.** `js/state.js` exports one mutable `state` object. Every handler mutates it directly, then calls `render()`, which clears the SVG and rebuilds it from scratch (`js/render.js`). There is no diffing and no event bus. Pass the render callback from `main.js` into `createEventHandlers` rather than importing render into interaction code. `render()` takes an `afterRender` callback; `main.js` uses it to refresh the HTML chrome (selection bar, hint, counts, undo buttons) after every paint.

**Undo/redo** (`js/history.js`) is snapshot-based: `pushHistory()` serialises `geometries` + `subtiles` and must be called *before* a mutation. Drags push once on their first `pointermove` via `state.dragging.historyPushed`. Restoring a snapshot clears all selection.

**Actions** (`js/actions.js`) hold every user-level mutation (clone, rotate, mirror, delete, curve toggle, undo/redo, toggles). Both the toolbar (`main.js`) and keyboard handler (`interaction.js`) call these so the two stay in sync; each action pushes history itself and returns whether it did anything.

**Data model (branch `feature/subtiles`).** Two arrays:

- `geometries`: `{id, points:[{id,x,y}], segments:[{type:'line'} | {type:'bezier', cp:{x,y}}], closed}`. Points are in **subtile-local** coordinates. `segments[i]` joins `points[i]` to `points[i+1]`; a closed shape has one extra segment back to `points[0]`. Keep `points` and `segments` in sync when inserting/deleting (see `deletePoint` in `js/geometry.js`).
- `subtiles`: `{id, geometryId, x, y, width, height, rotation, mirrorX, mirrorY}`. A subtile is a rectangular container placed in world space. "Clone linked" creates a new subtile pointing at the **same** `geometryId`, so edits to points show up in every clone. Deleting the last subtile referencing a geometry deletes the geometry.

`main` still uses the older `instances` model (`{geometryId, transform:{tx,ty,rotation,mirrorX,mirrorY}}`); this branch replaced it with subtiles.

**Coordinate spaces** (`js/transform.js`): screen (pointer event px) → world (divide out `state.pan`/`state.zoom`) → subtile-local via `worldToSubtileLocal`, which inverts the subtile's translate + rotate/mirror about its box centre (`subtileTransformString` produces the matching SVG transform). Rotation/mirroring are rigid, so distance thresholds still work in local space. Hit-test thresholds and handle radii in `js/config.js` are screen-space pixels; divide by `state.zoom` when comparing in world space, as the existing code does. Grid snapping is relative to the subtile (`width / GRID_DIVISIONS`), not the world.

**Base tile** is not stored; `calculateBaseTileBounds()` derives it as the bounding box of all subtile corners (after rotation/mirroring). The optional 3×3 repeat (`3` key, or the Tile popover) draws frames around it plus ghosted copies of every shape in the eight neighbouring cells.

**Interaction** (`js/interaction.js`): behavior is switched on `state.activeTool`. The internal names are `draw` / `edit` / `transform`; the UI calls them Pen (`P`, alias `D`) / Edit (`E`) / Select (`V`, alias `T`). In edit mode hit-test priority is segment handles → points → segments. Segment handles are the curve's control point or, for straight segments, the midpoint; dragging a midpoint converts the segment to a curve on first move, and double-clicking a curve handle straightens it. A second click on an already-selected segment inserts a point. In Pen mode, clicking the first point closes the shape; a repeat click on the last point is ignored so double-click-to-finish doesn't add a stray point. Drags go through `state.dragging.type`. Keyboard shortcuts live in `onKeyDown`; the `?` help popover in `index.html` lists them and should be kept in sync. `C` toggles the curve when a segment is selected in Edit mode, otherwise clones the selected tile in Select mode.

## UI

The look follows the Claude Design prototype "Tessellation Designer": warm light palette (CSS custom properties in `index.html`), floating panels over a full-viewport SVG, a contextual selection bar that changes with the tool and selection, a bottom hint bar with counts, and Tile / `?` popovers top-right. Strokes use `vector-effect: non-scaling-stroke`; handle radii are divided by `state.zoom` so everything stays a constant screen size. The prototype's lattice vectors, freehand tool, bounding-box scaling and pivot/half-step clone locks are **not** implemented because the engine has no lattice model.

## Known gaps in this branch

- `selectedResizeHandle` and the `resizeHandle` drag type are declared in state but not implemented.
- Edge snapping when dragging subtiles is a TODO in `onPointerMove`.
