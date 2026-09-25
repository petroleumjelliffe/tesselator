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

**State + full re-render.** `js/state.js` exports one mutable `state` object. Every handler mutates it directly, then calls `render()`, which clears the SVG and rebuilds it from scratch (`js/render.js`). There is no diffing, no event bus, and no undo yet. Pass the render callback from `main.js` into `createEventHandlers` rather than importing render into interaction code.

**Data model (branch `feature/subtiles`).** Two arrays:

- `geometries`: `{id, points:[{id,x,y}], segments:[{type:'line'} | {type:'bezier', cp:{x,y}}], closed}`. Points are in **subtile-local** coordinates. `segments[i]` joins `points[i]` to `points[i+1]`; a closed shape has one extra segment back to `points[0]`. Keep `points` and `segments` in sync when inserting/deleting (see `deletePoint` in `js/geometry.js`).
- `subtiles`: `{id, geometryId, x, y, width, height, rotation, mirrorX, mirrorY}`. A subtile is a rectangular container placed in world space. "Clone linked" creates a new subtile pointing at the **same** `geometryId`, so edits to points show up in every clone. Deleting the last subtile referencing a geometry deletes the geometry.

`main` still uses the older `instances` model (`{geometryId, transform:{tx,ty,rotation,mirrorX,mirrorY}}`); this branch replaced it with subtiles.

**Coordinate spaces** (`js/transform.js`): screen (pointer event px) → world (divide out `state.pan`/`state.zoom`) → subtile-local (subtract `subtile.x/y`). Hit-test thresholds and handle radii in `js/config.js` are screen-space pixels; divide by `state.zoom` when comparing in world space, as the existing code does. Grid snapping is relative to the subtile (`width / GRID_DIVISIONS`), not the world.

**Base tile** is not stored; `calculateBaseTileBounds()` derives it as the bounding box of all subtiles, and the optional 3×3 tiling grid (`V` key) is drawn around that.

**Interaction** (`js/interaction.js`): behavior is switched on `state.activeTool` (`draw` / `edit` / `transform`). In edit mode hit-test priority is control points → points → segments. Drags go through `state.dragging.type`. Keyboard shortcuts live in `onKeyDown`; the hint text in `index.html` lists them and should be kept in sync.

## Known gaps in this branch

- Subtile `rotation`/`mirrorX`/`mirrorY` are editable (`[`, `]`, `X`, `Y`) and shown in the toolbar panel, but `renderSubtiles` only applies `translate`, so they have no visual effect yet.
- `selectedResizeHandle` and the `resizeHandle` drag type are declared in state but not implemented.
- Edge snapping when dragging subtiles is a TODO in `onPointerMove`.
