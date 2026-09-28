# Engine rebuild (Project 1 of 2) — design

Date: 2026-09-27
Branch: `feature/rebuild`
Source of truth: Claude Design project "Tessellation Designer v2 Symmetry" (the working prototype). Layout for this project is the prototype's own floating-panel chrome. The Layers / Properties chrome from "Editing UI Wireframes" turn 2 is Project 2.

## 1. Goal

Rebuild the editor from scratch so that the served app behaves like the v2 prototype: a lattice tile, symmetry elements on a Construction layer, paths that wrap across tile edges, and clones produced by symmetries. Same interactions, same feel, implemented as vanilla ES modules + SVG with no build step and no runtime dependencies.

Success: open `index.html`, add a point symmetry, draw a path, and the shape repeats and clones across all nine cells exactly as the prototype does. Every interaction in §6 works. Pure modules are covered by `node --test`.

### Non-goals (Project 2 or later)

- Layers panel, Properties panel, tool options row, icon rail.
- Node tool (A), Hand (H), Zoom (Z) tools, groups, lock/hide/rename/reorder, context menu.
- Scissors, join, shapes, fill, eyedropper.
- Persistence (save/load, localStorage), export.
- The old subtile model. It is removed, not migrated.

## 2. Repository changes

Delete: `geometry.js`, `state.js`, `transforms.js`, `styles.css`, `tessellation_editor_phase3_delete.html`, `FEATURE_SPEC.md`, everything under `js/`. They live on `feature/subtiles` / `feature/ui-refinement` and in history.

New layout:

```
index.html            chrome markup + CSS custom properties
styles.css            all styles (moved out of index.html)
js/main.js            boot: wire DOM, create handlers, first render
js/config.js          constants, colours, presets
js/state.js           the state object, id generator, selectors
js/lattice.js         lattice maths, cells, grid snapping
js/symmetry.js        symmetry transforms and inverses
js/paths.js           point/path/clone document mutations
js/freehand.js        RDP simplify + quadratic fit
js/history.js         snapshot undo/redo
js/actions.js         user-level actions (shared by UI + keyboard)
js/hit.js             snapping to anchors, marquee tests, bbox maths
js/render.js          rebuild the SVG from state
js/ui.js              rebuild the HTML chrome from state
js/interaction.js     pointer + keyboard state machine
tests/*.test.js       node --test, pure modules only
package.json          {"type":"module","scripts":{"test":"node --test tests/"}} — no deps
```

`CLAUDE.md` is rewritten at the end of the project to describe the new model.

## 3. Data model

All document entities carry stable string ids (`makeId()`), never array indices. Arrays keep insertion order for z-order and layer listing.

```js
lattice:   { ax, ay, bx, by }                 // world-space basis vectors a, b
points:    [{ id, x, y }]                     // cell-local (cell 0,0) coordinates
paths:     [{ id, nodes: [{ pointId, cell: { c, r } }], cps: [ {x,y} | null ], style: { color, weight } }]
symmetries:[{ id, kind: 'point' | 'line', cx, cy, angle, glide, armed }]
clones:    [{ id, pathId, symmetryId }]
```

- A **node** is a point placed in a specific cell. World position = `point + c·a + r·b`. Two nodes of one path may reference the same point in different cells; that is how a path leaves the tile on one edge and continues from the opposite edge.
- `cps[j]` is the quadratic control point of the segment between `nodes[j]` and `nodes[j+1]`, in **world** coordinates of the base cell (not cell-local). `cps.length === nodes.length - 1`. When an endpoint moves by `(dx,dy)`, each adjacent control point moves by half of that (both endpoints: full delta).
- A path is **closed** when its first and last node are the same point in the same cell. There is no `closed` flag.
- `symmetries[].angle` is in degrees, normalised to `[0,180)`. `glide` is a signed distance along the line's direction (0 = plain mirror). `armed` means "clone every new path through me". Point symmetries ignore `angle` and `glide`.
- A **clone** is a (path, symmetry) pair. Clones are never materialised; they are computed at render time. Deleting a path or symmetry deletes its clones. Deleting the last node reference to a point deletes the point (`pruneOrphans`).

UI state (not in history):

```js
layer: 'drawing' | 'construction'
tool: 'select' | 'pen' | 'freehand'
pen: { pathId } | null                      // path being extended
selection: null
         | { kind: 'path', id }
         | { kind: 'clone', id }
         | { kind: 'symmetry', id }
         | { kind: 'points', ids: [] }
hover: pointId | null
drag: { kind, ... } | null                  // see §6
cursor: { x, y } | null                     // world; pen rubber band
view: { pan: {x,y}, zoom }
space: boolean                              // Space held
style: { color, weight }                    // default for new paths
snap: boolean, gridDivisions: 8, ghostOpacity: 0.45, showHelp: false
```

## 4. Coordinate spaces and maths

- **Screen → world**: `(sx - pan.x) / zoom`. The SVG root `<g>` carries `translate(pan) scale(zoom)`. All hit thresholds and handle sizes in `config.js` are screen pixels; divide by `zoom` in world space.
- **World → lattice (u,v)**: solve `p = u·a + v·b`. `cell(p)` = `floor(u), floor(v)` plus the cell-local remainder.
- **Grid snap** (`snap2`): round `u, v` to multiples of `1/gridDivisions`. Shift inverts the snap setting for the duration of the gesture.
- **Anchor snap** (`snapWorld`): nearest existing point or clone point in any of the 9 neighbouring cells within `SNAP_PX / zoom`, else grid snap. A `skip` predicate excludes the thing being dragged.
- **Symmetry transform** `apply(sym, p)`: point → `(2cx - x, 2cy - y)`. Line → reflect across the line through `(cx,cy)` at `angle`, then translate by `glide` along the line direction. `invert` undoes it. `matrix(sym)` gives the equivalent SVG matrix for ghosting freehand strokes.
- **Lattice steps**: `stepAlong(dir)` = grid step measured along a direction (for glide snapping). `halfAlong(dir)` = half of the dominant lattice vector along that direction (Escher's half-step glide).
- **View fit**: on load and on `⌘0`, fit the base cell plus a margin into the viewport.

## 5. Modules and responsibilities

| Module | Exports (pure unless noted) | Depends on |
|---|---|---|
| `lattice.js` | `toWorld(cell, lat)`, `toUV(p, lat)`, `fromUV`, `cellOf(p, lat)`, `neighbourOffsets(lat)`, `snapToGrid(p, lat, div)`, `stepAlong`, `halfAlong`, `isDegenerate(lat)` | — |
| `symmetry.js` | `direction(sym)`, `apply(sym, p)`, `invert(sym, p)`, `matrix(sym)`, `normaliseAngle` | — |
| `paths.js` | `nodeWorld(doc, node)`, `pathWorld(doc, path)`, `addPoint`, `startPath`, `appendNode`, `insertNode`, `deletePoints`, `deletePath`, `pruneOrphans`, `openEndAt`, `orientToEnd`, `movePoint`, `movePoints`, `shiftControlPoints`, `setControlPoint`, `transformPath(doc, pathId, M)`, `bounds(doc, pathId)` | lattice, symmetry |
| `freehand.js` | `simplify(raw, eps)` (RDP), `fitQuadratic(raw, i0, i1)`, `strokeToPath(raw)` → `{ points, cps }` | — |
| `hit.js` | `anchorsWorld(doc, skip)`, `snapWorld(doc, p, threshold, skip)`, `pointsInRect`, `bboxHandles(box)`, `scaleMatrix`, `rotateMatrix`, `applyMatrix` | lattice, symmetry |
| `history.js` | `push()`, `undo()`, `redo()`, `canUndo()`, `canRedo()`, `beginDrag()` (push once per gesture) | state |
| `actions.js` | every user-level mutation; each pushes history itself and returns whether it did anything | all of the above |
| `render.js` | `render(svg)` — clears and rebuilds | state, config, lattice, symmetry, paths, hit |
| `ui.js` | `renderChrome(root)` — sets button states, bars, hint, counts | state, actions |
| `interaction.js` | `createHandlers(svg, rerender)` — pointer/keyboard, drag state machine | actions, hit |
| `main.js` | boot | everything |

"Pure" modules take a `doc` argument (`{ points, paths, symmetries, clones, lattice }`) and return new values or mutate only the `doc` they were given. They never import `state.js`, so they are testable in Node without a DOM.

Rendering is **full rebuild**: mutate state, call `render()`, which clears the SVG, rebuilds it, then calls `renderChrome()`. Elements that respond to the pointer carry `data-kind` and `data-id` attributes; `interaction.js` attaches one `pointerdown`/`pointermove`/`pointerup` listener set to the SVG and dispatches on those attributes. No per-element listeners, no diffing.

## 6. Interactions (parity with the prototype)

### Layers

`Tab` toggles Drawing ↔ Construction. Only the active layer's elements receive pointer events; the other layer renders dimmed. Switching layers ends any pen path and clears a selection that belongs to the other layer.

### Drawing layer tools

**Pen (P)**
- Click empty space: add a point (anchor-snapped, then grid-snapped) and either start a new path there or append it to the path in progress.
- Click an existing point: start a new path from it, or, if it is the open end of a path, resume that path (reversing node order if needed so the clicked end is last). While a path is in progress, clicking a point appends it; clicking the last point again ends the path.
- Click a clone anchor while drawing: appends the underlying point in its own cell (through the inverse transform).
- `Esc` / `Enter` end the path. A path with fewer than two nodes is discarded.
- Rubber band from the last node to the cursor.
- `Space`+drag while a path is in progress moves every symmetry that clones that path (or every armed symmetry if none yet).

**Freehand (F)**
- Press and drag on empty space or on a point. Raw stroke is previewed live, plus one ghost per armed symmetry and per neighbouring cell.
- On release: RDP simplify (eps 5 world units), fit a quadratic per simplified segment (null if the deviation is under 2.5), snap the last point to an existing anchor if within threshold. If the stroke started on the open end of a path, extend that path; otherwise create a new path with armed clones.

**Select (V)**
- Click a segment: select its path. Click again on a selected path's segment: insert a node there (straight: at the click projection, grid-snapped; curve: de Casteljau split at t = 0.5).
- Click a point: select that point. `⇧`-click toggles it in a multi-selection. Drag on empty space: marquee (adds with `⇧`). Selected points drag together, grid-snapped by delta.
- Drag a segment of a path: move the whole path (delta snapped).
- Drag a point: move it, anchor-snapped (excluding itself), then grid-snapped.
- Selected path shows a bounding box: 8 scale handles (corner = uniform, `⇧` = free; edge = one axis) and a rotate knob above the top edge (`⇧`-free, snapped to 15°). Scaling/rotation transforms the path's points and control points; clones follow automatically.
- Each segment of a selected path shows a diamond handle at its control point (filled) or midpoint (hollow). Drag it to bend (sets the control point). Double-click it to straighten.
- Click a clone: select it. Drag a clone's body: moves its symmetry (point: by half the delta; line: perpendicular part moves the line, parallel part changes the glide, both snapped). Drag a clone's anchor: edits the shared point through the inverse transform.
- `⌫` deletes: the hovered point if any and no multi-selection; else the selection (points, path, clone → unlink, symmetry).

### Construction layer

- `O` adds a point symmetry, `M` adds a mirror line, both at the cell centre, armed, selected. If a path was selected when adding, the new symmetry immediately clones it.
- Drag an element to move it (anchor/grid snapped). Selected line shows a rotate knob (snapped to 15°) and, when glide ≠ 0, a diamond on the axis to drag the glide (snapped to grid steps, magnetised to the half step). `[` / `]` rotate by 15°.
- Lattice handles `a` and `b` are draggable (length to 10 units, angle to 15° when snapping). A drag that would make the lattice degenerate (|det| < 400) is ignored. The viewBox does not refit during a lattice drag.
- Clicking empty space clears the selection.

### Selection bar actions

Path: chips to toggle which symmetries clone it; "+ Point" / "+ Line" to add a symmetry bound to it; Delete.
Clone: "Select its symmetry", "Select source path", Unlink.
Symmetry: "Apply to new paths" (armed), and for lines: rotate ±15°, angle readout, Glide toggle with −/+/½ step controls; Delete.
Points: hint only.

### Stroke palette

Six swatches and five weights. With a path or clone selected, changes apply to that path (and become the default). With nothing selected, they set the default for new paths.

### View

Wheel = pan. `⌘`/`Ctrl`+wheel and pinch = zoom about the cursor (clamped). `⌘0` = fit tile. Pan/zoom never enter history.

### History

`⌘Z` / `⇧⌘Z` / `⌘Y`. Snapshot = JSON of `{ points, paths, symmetries, clones, lattice }`, max 50. `push()` before every discrete mutation; drags call `beginDrag()` on their first movement past 3 px so a gesture is one entry. Restoring clears selection, pen, hover and drag. Undo/redo buttons reflect availability.

### Hint bar

One line of context-sensitive help (text copied from the prototype) and counts: points · paths · symmetries · clones. `?` toggles the shortcut sheet.

## 7. Rendering order (bottom to top)

1. Grid lines inside the base cell (`gridDivisions − 1` lines each way).
2. Nine cell frames; base cell in ink, neighbours in muted.
3. Symmetry ghosts in the eight neighbouring cells (dashed violet).
4. Ghost paths: every path and clone repeated in the eight neighbouring cells, at `ghostOpacity`.
5. Main segments: halo (when selected or linked), the stroke, and a transparent 14 px hit path.
6. Control-point guide lines for the selected path.
7. Freehand preview and its ghosts.
8. Marquee rectangle. Pen rubber band.
9. Bounding box, its ghost boxes, scale handles, rotate knob.
10. Segment diamonds.
11. Points (only those of the selected path, the pen path, the selection, or all while drawing).
12. Clone anchors (selected clone, or all clones while in Freehand).
13. Symmetry elements: lines, glide bar + diamond, rotate knob, centre markers.
14. Lattice handles and the `a` / `b` labels.

Handle radii and hit widths are divided by `zoom`. Path stroke width is world units (scales with zoom). Frames, guides and handles use `vector-effect: non-scaling-stroke`.

## 8. Chrome (prototype layout)

Floating panels over a full-viewport SVG, warm palette (`#f4f2ec` background, `#1c1b18` ink, `#3b6fd1` accent, `#7048e8` symmetry, `#c2255c` lattice), all as CSS custom properties.

- Top-left: layer toggle (Drawing / Construction); on Drawing, the tool group (Select / Pen / Freehand); on Construction with nothing selected, the Symmetry bar (add point, add line, one chip per element) and the Lattice bar (five presets with a small parallelogram icon, readout of |a|, |b|, angle). With a selection, the selection bar (§6).
- Bottom-left: stroke palette (Drawing only), then the undo/redo cluster.
- Bottom: hint text and counts.
- Top-right: `?` button and the shortcut sheet.

All controls are `<button>`s with `title`s and minimum 36 px hit targets.

## 9. Error handling

- Every pointer handler bails on non-primary buttons and when the target layer is inactive.
- `pointercancel` and window `blur` end any drag without committing further changes (history already has the snapshot from `beginDrag`).
- Mutations that would leave a path with fewer than two nodes delete the path; the only exception is the pen path in progress.
- Deleting a symmetry removes its clones; deleting a path removes its clones; `pruneOrphans` runs after any node removal.
- Degenerate lattices are rejected at the gesture (§6). Presets are always valid.
- Snapshots are JSON; a failed restore (should not happen) leaves state untouched and logs.

## 10. Testing

`npm test` runs `node --test tests/` with no dependencies. Coverage targets:

- `lattice.test.js`: `toUV`/`fromUV` round trip for every preset; `cellOf` on cell boundaries; grid snap; `stepAlong` / `halfAlong` against hand-computed values.
- `symmetry.test.js`: point symmetry is an involution; mirror without glide is an involution; `invert(apply(p)) === p` with glide; `matrix` agrees with `apply` on sample points.
- `paths.test.js`: append/insert keep `cps.length === nodes.length − 1`; delete points splits paths correctly and prunes orphans; `openEndAt` / `orientToEnd`; `movePoint` shifts adjacent control points by half; `transformPath` with scale and rotate; wrap-around path (same point, two cells) reports closed.
- `freehand.test.js`: RDP on a straight line returns two points; a sampled arc yields a non-null control point near the true one; a short jitter stroke is rejected.
- `hit.test.js`: `snapWorld` prefers an anchor in a neighbouring cell over grid; `skip` excludes the dragged point; bbox handles and matrices.
- `history.test.js`: push/undo/redo ordering, cap at 50, `beginDrag` pushes once per gesture, redo cleared on new push.

Browser interactions are verified manually against the checklist in §6, and by driving the served page with Chrome DevTools during implementation.

## 11. Implementation order

1. Repo cleanup, `package.json`, `index.html` shell, `config.js`, `state.js`.
2. `lattice.js`, `symmetry.js` + tests.
3. `paths.js`, `hit.js`, `history.js` + tests.
4. `render.js` for the static scene (grid, frames, ghosts, paths, points) with a hard-coded example doc.
5. `interaction.js` + `actions.js`: Pen, then Select (points, path drag, marquee), then segment handles and insert.
6. Construction layer: symmetries, clones, lattice handles, glide.
7. `freehand.js` + tests, then the Freehand tool.
8. Bounding box scale/rotate.
9. Chrome (`ui.js`), palette, hint, help, view pan/zoom/fit.
10. Rewrite `CLAUDE.md`.
