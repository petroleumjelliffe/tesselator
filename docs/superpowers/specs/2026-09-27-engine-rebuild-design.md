# Engine rebuild (Project 1 of 2) — design

Date: 2026-09-27
Branch: `feature/rebuild`
Behavioural reference: Claude Design project "Tessellation Designer v2 Symmetry" (the working prototype). Layout for this project is the prototype's own floating-panel chrome. The Layers / Properties chrome from "Editing UI Wireframes" turn 2 is Project 2.

Project 1 goes beyond the prototype in three agreed ways: symmetry is built from three primitives (translate, mirror, rotate) composed in order; closed regions can be filled; paths sit in a structure or a detail sublayer around the fills.

## 1. Goal

Rebuild the editor from scratch so the served app behaves like the v2 prototype and adds fills: a lattice tile, construction elements, paths that wrap across tile edges, clones produced by ordered compositions of elements, and regions bounded by all of that which can be coloured. Vanilla ES modules + SVG, no build step, no runtime dependencies.

Success: open `index.html`, add a 180° rotation, draw one edge, and the shape repeats and clones across the tiling as the prototype does. Switch to Fill, hover, and the two enclosed regions light up; click each with a colour and the tessellation reads as figure and ground. Every interaction in §6 works. Pure modules are covered by `node --test`.

### Non-goals (Project 2 or later)

- Layers panel, Properties panel, tool options row, icon rail.
- Node tool (A), Hand (H), Zoom (Z) tools, groups, lock/hide/rename/reorder, context menu.
- Scissors, join, shapes, eyedropper.
- Composing clones across bindings (full group closure). Each clone belongs to one binding and one power.
- Propagating fills through elements automatically. A fill is one click per region.
- Enforcing the crystallographic restriction. The UI hints; the engine allows any n.
- Persistence, export. The old subtile model, which is removed, not migrated.

## 2. Repository changes

Delete: `geometry.js`, `state.js`, `transforms.js`, `styles.css`, `tessellation_editor_phase3_delete.html`, `FEATURE_SPEC.md`, everything under `js/`. They live on `feature/subtiles` / `feature/ui-refinement` and in history.

New layout:

```
index.html            chrome markup
styles.css            all styles, CSS custom properties for the palette
js/main.js            boot: wire DOM, create handlers, first render
js/config.js          constants, colours, lattice presets, swatches, weights
js/state.js           the state object, id generator, selectors
js/lattice.js         lattice maths, cells, grid snapping
js/transform.js       2×3 matrices, element matrices, orbits, classification
js/paths.js           point / path / binding document mutations
js/regions.js         planar arrangement, faces, seed lookup
js/freehand.js        RDP simplify + quadratic fit
js/history.js         snapshot undo/redo
js/actions.js         user-level actions (shared by UI + keyboard)
js/hit.js             anchor snapping, marquee tests, bounding-box maths
js/render.js          rebuild the SVG from state
js/ui.js              rebuild the HTML chrome from state
js/interaction.js     pointer + keyboard state machine
tests/*.test.js       node --test, pure modules only
package.json          {"type":"module","scripts":{"test":"node --test tests/"}} — no deps
```

`CLAUDE.md` is rewritten at the end of the project to describe the new model.

## 3. Data model

All document entities carry stable string ids (`makeId()`), never array indices. Arrays keep insertion order for z-order.

```js
lattice:  { ax, ay, bx, by }                     // world-space basis vectors a, b
points:   [{ id, x, y }]                         // cell-local (cell 0,0) coordinates
paths:    [{ id, nodes: [{ pointId, cell: { c, r } }], cps: [ {x,y} | null ],
             style: { color, weight }, layer: 'structure' | 'detail' }]
elements: [{ id, kind: 'translate', u, v }       // fractions of a and b, e.g. (1/2, 0)
           { id, kind: 'mirror',    cx, cy, angle }   // line through (cx,cy), degrees in [0,180)
           { id, kind: 'rotate',    cx, cy, n }]      // 1/n turn about (cx,cy); n ∈ {2,3,4,6}, any int allowed
bindings: [{ id, pathId, ops: [elementId, ...] }] // ordered composition; a path may have several
fills:    [{ id, x, y, color }]                   // seed point, base-cell world frame
```

- A **node** is a point placed in a specific cell. World position = `point + c·a + r·b`. Two nodes of one path may reference the same point in different cells; that is how a path leaves the tile on one edge and continues from the opposite edge.
- `cps[j]` is the quadratic control point of the segment between `nodes[j]` and `nodes[j+1]`, in **world** coordinates of the base cell (not cell-local). `cps.length === nodes.length - 1`. When an endpoint moves by `(dx,dy)`, each adjacent control point moves by half of that (both endpoints: the full delta).
- A path is **closed** when its first and last node are the same point in the same cell. There is no `closed` flag.
- `layer` decides whether the path's stroke is drawn below or above fills. Both sublayers participate in region detection. Clones inherit their source path's sublayer.
- An **element** is one primitive isometry. There is no glide kind: Escher's glide is a binding `[mirror, translate(1/2, 0)]` with the mirror parallel to a. The **lattice** is the pair of translate(1,0) and translate(0,1) everything is measured against. It is shown on the Construction layer and has handles, but it is not an element: it cannot be deleted, bound or disarmed.
- A **binding** clones one path through the composite of its `ops`, applied left to right. Its clones are the powers of that composite up to, but excluding, the first power that is a lattice translation (§4). A clone is identified by `(bindingId, power)`. Deleting a path or an element deletes the bindings that reference it. Deleting the last node reference to a point deletes the point.
- A **fill** paints whichever region contains its seed (§4). Fills have no reference to paths, so they survive edits as long as the region still contains the seed.

UI state (never in history):

```js
layer: 'drawing' | 'construction'
sublayer: 'structure' | 'detail'                 // for new paths
tool: 'select' | 'pen' | 'freehand' | 'fill'
pen: { pathId } | null                           // path being extended
newPathOps: [ [elementId, ...], ... ]            // chains applied to every new path
selection: null
         | { kind: 'path', id }
         | { kind: 'clone', bindingId, power }
         | { kind: 'element', id }
         | { kind: 'points', ids: [] }
         | { kind: 'fill', id }
hover: pointId | null
hoverFace: faceKey | null                        // Fill tool
drag: { kind, ... } | null                       // see §6
cursor: { x, y } | null                          // world; pen rubber band
view: { pan: {x,y}, zoom }
space: boolean
style: { color, weight }                         // default stroke for new paths
fillColor
snap: boolean, gridDivisions: 8, ghostOpacity: 0.45, showHelp: false
```

## 4. Coordinate spaces and maths

### View

Screen → world: `(sx - pan.x) / zoom`. The SVG root `<g>` carries `translate(pan) scale(zoom)`. Hit thresholds and handle sizes in `config.js` are screen pixels; divide by `zoom` in world space. On load and on `⌘0`, fit the base cell plus a margin. **Visible cells** = the range of cell offsets whose parallelogram intersects the viewport, clamped to 7×7 around the base cell.

### Lattice

World → (u,v): solve `p = u·a + v·b`. `cellOf(p)` = `floor(u), floor(v)` plus the cell-local remainder. Grid snap rounds `u, v` to multiples of `1/gridDivisions`. **Fraction snap** (for element positions and translate vectors) rounds to the finer of the grid and twelfths, so 1/2, 1/3, 1/4 and 1/6 are always reachable. Shift inverts the snap setting for the duration of a gesture. `stepAlong(dir)` = grid step measured along a direction. A lattice is degenerate when `|det| < 400`; gestures that would produce one are ignored.

### Transforms

One representation everywhere: a 2×3 affine matrix `[a, b, c, d, e, f]`.

- `matrixOf(element, lattice)`: translate → `T(u·a + v·b)`; mirror → reflection across the line; rotate → rotation by `2π/n` about the centre.
- `cellMatrix(c, r, lattice)` → `T(c·a + r·b)`.
- `compose(A, B)` (apply B then A), `invert(M)`, `apply(M, p)`, `power(M, k)`.
- `isLatticeTranslation(M, lattice)`: linear part is the identity within 1e-6 and the translation is an integer (u,v) within 1e-6.
- `orbit(ops, elements, lattice, cap = 12)`: composite `M`; return `[M¹, M², …, M^(k-1)]` where `M^k` is the first lattice translation. If none within `cap`, return `cap` powers and `open: true` so the UI can warn that the element does not close on this lattice.
- `classify(M)` → `'identity' | 'translation' | 'rotation' | 'reflection' | 'glide'` with centre / line / vector, for labels and hints only.

Orbit sizes the tests pin down:

| ops | clones |
|---|---|
| rotate n | n − 1 |
| mirror | 1 |
| mirror, translate(1/2 along the line) | 1 |
| mirror, translate(1/3 along the line) | 2 |
| translate(1/2, 0) | 1 |
| translate(1/2, 1/2) | 1 |
| translate(1, 0) | 0 |
| rotate 2, translate(1/2, 0) | 1 (a rotation about a shifted centre) |

Quadratic beziers are affine-invariant, so a clone's control points are the images of the source's control points and clones stay exact.

### Snapping

`snapWorld(p)`: nearest anchor within `SNAP_PX / zoom`, else grid snap. Anchors are every point and every clone point in the 3×3 window of cells. A `skip` predicate excludes the thing being dragged.

### Regions

Computed by `regions.js` from a **document**, not from state, after every mutation:

1. Collect segments from every path and every clone, placed in the 3×3 window of cells, tagged with `(source, cellOffset, segmentIndex, t0, t1)`.
2. Flatten curves into polylines (adaptive, 8–32 samples by chord length), find all pairwise intersections and touches, and split segments there, recording the split parameter `t` on the original curve.
3. Build the planar graph: merge coincident vertices within 1e-6, sort half-edges around each vertex by angle, walk faces. Dangling edges are walked on both sides by the same face and do not split it. The unbounded face and any face touching the window boundary are discarded.
4. Each face keeps its outline as a list of exact pieces: for each edge, the original segment split at `[t0, t1]` by de Casteljau, so rendering is exact at any zoom.
5. `faceAt(faces, p)` finds the face containing `p` by an even-odd test on the flattened outline. Each fill seed resolves to the face containing its seed, or none.

A face found in the 3×3 window that lies entirely within it is a valid region even if it straddles the base cell's edge. Rendering translates each seeded face to every visible cell. The cost is quadratic in segment count; results are memoised on a document hash so drags without geometry changes do not recompute.

### History

Snapshot = JSON of `{ points, paths, elements, bindings, fills, lattice, newPathOps }`, max 50. `push()` before every discrete mutation; drags call `beginDrag()` on their first movement past 3 px so one gesture is one entry. Restoring clears selection, pen, hover and drag. Pan and zoom never enter history.

## 5. Modules and responsibilities

| Module | Exports | Depends on |
|---|---|---|
| `lattice.js` | `toWorld`, `toUV`, `fromUV`, `cellOf`, `windowOffsets`, `visibleOffsets(view, lat)`, `snapToGrid`, `snapToFraction`, `stepAlong`, `isDegenerate` | — |
| `transform.js` | `matrixOf`, `cellMatrix`, `compose`, `invert`, `apply`, `power`, `isLatticeTranslation`, `orbit`, `classify` | lattice |
| `paths.js` | `nodeWorld`, `pathWorld`, `addPoint`, `startPath`, `appendNode`, `insertNode`, `deletePoints`, `deletePath`, `pruneOrphans`, `openEndAt`, `orientToEnd`, `movePoint`, `movePoints`, `shiftControlPoints`, `setControlPoint`, `transformPath(doc, pathId, M)`, `bounds`, `isClosed`, `addBinding`, `toggleOp`, `removeBinding`, `cloneMatrices(doc, bindingId)`, `addElement`, `moveElement`, `deleteElement` | lattice, transform |
| `regions.js` | `computeFaces(doc)`, `faceAt(faces, p)`, `facePathData(face)` | lattice, transform, paths |
| `freehand.js` | `simplify(raw, eps)`, `fitQuadratic(raw, i0, i1)`, `strokeToPath(raw)` | — |
| `hit.js` | `anchorsWorld`, `snapWorld`, `pointsInRect`, `bboxHandles`, `scaleMatrix`, `rotateMatrix` | lattice, transform, paths |
| `history.js` | `push`, `undo`, `redo`, `canUndo`, `canRedo`, `beginDrag` | state |
| `actions.js` | every user-level mutation; each pushes history itself and returns whether it did anything | all of the above |
| `render.js` | `render(svg)` — clears and rebuilds | state, config, lattice, transform, paths, regions, hit |
| `ui.js` | `renderChrome(root)` — button states, bars, hint, counts | state, actions |
| `interaction.js` | `createHandlers(svg, rerender)` — pointer/keyboard, drag state machine | actions, hit, regions |
| `main.js` | boot | everything |

Pure modules take a `doc` argument (`{ points, paths, elements, bindings, fills, lattice }`) and return new values or mutate only the `doc` they were given. They never import `state.js`, so they run in Node without a DOM.

Rendering is a **full rebuild**: mutate state, call `render()`, which clears the SVG, rebuilds it, then calls `renderChrome()`. Pointer-sensitive elements carry `data-kind` and `data-id` (and `data-power`, `data-face` where relevant); `interaction.js` attaches one set of `pointerdown` / `pointermove` / `pointerup` listeners to the SVG and dispatches on those attributes. No per-element listeners, no diffing.

## 6. Interactions

### Layers

`Tab` toggles Drawing ↔ Construction. Only the active layer's elements receive pointer events; the other renders dimmed. Switching layers ends any pen path and clears a selection that belongs to the other layer. On Drawing, a Structure / Detail toggle sets `sublayer` for new paths.

### Pen (P)

- Click empty space: add a point (anchor-snapped, then grid-snapped); start a new path there or append to the path in progress. A new path gets one binding per chain in `newPathOps`.
- Click an existing point: start a new path from it, or, if it is the open end of a path, resume that path (reversing node order if needed so the clicked end is last). While a path is in progress, clicking a point appends it; clicking the last point again ends the path.
- Click a clone anchor: append the underlying point in its own cell (through the inverse of that clone's matrix).
- `Esc` / `Enter` end the path. A path with fewer than two nodes is discarded.
- Rubber band from the last node to the cursor.
- `Space`+drag while a path is in progress moves the first element of each of that path's bindings (or of each chain in `newPathOps` if the path has none).

### Freehand (F)

Press and drag on empty space or on a point. The raw stroke is previewed live, plus one ghost per clone matrix the new path would get and per neighbouring cell. On release: RDP simplify (eps 5 world units), fit a quadratic per simplified segment (null if the deviation is under 2.5), snap the last point to an anchor if within threshold. If the stroke started on the open end of a path, extend that path; otherwise create a new path with the default bindings.

### Select (V)

- Click a segment: select its path. Click again on a selected path's segment: insert a node there (straight: at the click projection, grid-snapped; curve: de Casteljau split at t = 0.5).
- Click a point: select it. `⇧`-click toggles membership. Drag on empty space: marquee (adds with `⇧`). Selected points drag together, delta grid-snapped.
- Drag a segment: move the whole path. Drag a point: move it, anchor-snapped (excluding itself), then grid-snapped.
- Selected path shows a bounding box: eight scale handles (corner = uniform, `⇧` = free; edge = one axis) and a rotate knob above the top edge (snapped to 15°). Scaling and rotation transform the path's points and control points; clones follow.
- Each segment of a selected path shows a diamond at its control point (filled) or midpoint (hollow). Drag to bend. Double-click to straighten.
- Click a clone: select it. Drag a clone's **anchor**: edit the shared point through the inverse of the clone's matrix. Drag a clone's **body**: move the first element of its binding so that the clone follows the pointer. For a rotation by `1/n` the centre moves by `(I − R)⁻¹·Δ`; for a mirror only the perpendicular component of `Δ` moves the line, and the parallel component is given to the first translate element in the chain if there is one, otherwise dropped.
- Click a filled region: select the fill.
- `⌫` deletes: the hovered point if any and no multi-selection; otherwise the selection (points, path, clone → remove its binding, element, fill).

### Fill (B)

- Hovering tints the region under the cursor (`hoverFace`), so closure is visible before committing.
- Click inside a region: place a seed with `fillColor`, replacing any seed whose face is the same region. Click on nothing: no-op.
- Click an existing fill with the Fill tool: recolour it to `fillColor`.
- The palette shows Fill swatches while the Fill tool is active or a fill is selected, Stroke swatches otherwise.

### Construction layer

- `O` adds a rotation (n = 2), `M` a mirror, `T` a translation (default `(1/2, 1/2)`), each at the cell centre, selected, and appended as a one-op chain to `newPathOps`. If a path was selected when adding, the path also gets a binding through the new element.
- Drag an element to move it (anchor-snapped, then fraction-snapped). A selected mirror shows a rotate knob (snapped to 15°); `[` / `]` rotate by 15°. A selected rotation shows chips 2 · 3 · 4 · 6 and a hint when `n` does not fit the lattice (3 and 6 want the hex preset, 4 wants square). A translation is drawn as an arrow from the cell origin; drag its tip, fraction-snapped.
- Lattice handles `a` and `b` are draggable (length to 10 units, angle to 15° when snapping) through the same drag path as elements. The view does not refit during a lattice drag.
- Clicking empty space clears the selection.

### Selection bar

- **Path**: one row per binding showing its chain as chips ("↻2 · ⟋ · ⇢"); clicking an element chip toggles that element in the chain (append or remove); "+ chain" starts an empty binding that the next chip click populates; a star on each chain toggles whether it is in `newPathOps`; "+ ↻" / "+ ⟋" / "+ ⇢" add a new element bound to this path; Below / Above fills toggle; Delete.
- **Clone**: "Select its element", "Select source path", Unlink (removes the binding).
- **Element**: "Apply to new paths" (toggles its one-op chain in `newPathOps`); rotation: n chips; mirror: rotate ±15° and angle readout; translation: u, v readout with ½ · ⅓ · ¼ shortcuts along a and b; "clones N paths"; Delete.
- **Fill**: colour swatches; Delete.
- **Points**: hint only.

### Palette

Six swatches and five weights. With a path or clone selected, stroke changes apply to that path and become the default. With nothing selected, they set the default. In fill mode the swatches set `fillColor` and recolour a selected fill.

### View

Wheel = pan. `⌘`/`Ctrl`+wheel and pinch = zoom about the cursor (clamped). `⌘0` = fit.

### History and help

`⌘Z` / `⇧⌘Z` / `⌘Y`. Undo/redo buttons reflect availability. `?` toggles the shortcut sheet. The hint bar shows one context line (prototype wording, extended for Fill and elements) and counts: points · paths · elements · clones · fills.

## 7. Rendering order (bottom to top)

1. Grid lines inside the base cell.
2. Cell frames for every visible cell; base cell in ink, others muted.
3. Element ghosts in the neighbouring cells (dashed violet).
4. **Structure strokes**: paths and clones with `layer: 'structure'`, in every visible cell; ghost opacity outside the base cell. Base-cell segments carry a halo when selected or linked and a transparent 14 px hit path.
5. **Fills**: each seeded face, translated to every visible cell; full opacity in the base cell, ghost opacity elsewhere; the hovered face tinted in the accent colour.
6. **Detail strokes**: as 4, for `layer: 'detail'`.
7. Control-point guide lines for the selected path.
8. Freehand preview and its ghosts. Marquee. Pen rubber band.
9. Bounding box, ghost boxes, scale handles, rotate knob.
10. Segment diamonds.
11. Points (those of the selected path, the pen path, the selection, or all while drawing).
12. Clone anchors (selected clone, or all clones while in Freehand).
13. Elements: mirror lines, translation arrows, rotation centres with their `n`, rotate knobs.
14. Lattice handles and the `a` / `b` labels.

Handle radii and hit widths are divided by `zoom`. Path stroke width is in world units. Frames, guides and handles use `vector-effect: non-scaling-stroke`.

## 8. Chrome (prototype layout)

Floating panels over a full-viewport SVG, warm palette (`#f4f2ec` background, `#1c1b18` ink, `#3b6fd1` accent, `#7048e8` elements, `#c2255c` lattice) as CSS custom properties.

- Top-left: layer toggle (Drawing / Construction). On Drawing: the tool group (Select / Pen / Freehand / Fill) and the Structure / Detail toggle. On Construction with nothing selected: the Elements bar (add rotation, mirror, translation; one chip per element, filled when in `newPathOps`) and the Lattice bar (five presets with a parallelogram icon, readout of |a|, |b|, angle). With a selection: the selection bar (§6).
- Bottom-left: palette (Drawing only), then the undo/redo cluster.
- Bottom: hint text and counts.
- Top-right: `?` and the shortcut sheet.

All controls are `<button>`s with `title`s and 36 px minimum hit targets.

## 9. Error handling

- Pointer handlers bail on non-primary buttons and when the target layer is inactive.
- `pointercancel` and window `blur` end any drag without further changes.
- Mutations that would leave a path with fewer than two nodes delete the path, except the pen path in progress.
- Deleting an element removes bindings that use it and drops it from `newPathOps`; deleting a path removes its bindings; `pruneOrphans` runs after any node removal.
- An orbit that does not close within the cap renders its capped clones and the element's chip shows a warning glyph with a hint.
- Degenerate lattices are rejected at the gesture. Presets are always valid.
- Region computation is wrapped so a numerical failure logs and renders no fills for that frame rather than breaking the render.
- Snapshots are JSON; a failed restore leaves state untouched and logs.

## 10. Testing

`npm test` runs `node --test tests/` with no dependencies.

- `lattice.test.js`: `toUV` / `fromUV` round trip for every preset; `cellOf` on boundaries; grid and fraction snapping; `stepAlong`; `isDegenerate`.
- `transform.test.js`: `matrixOf` for each primitive against hand-computed points; `compose` / `invert` / `power`; `isLatticeTranslation`; `orbit` sizes for every row of the table in §4 plus the `open` flag for rotate 5; `classify` of `[mirror, translate]` is a glide and of `[rotate 2, translate]` is a rotation with the expected centre.
- `paths.test.js`: append / insert keep `cps.length === nodes.length − 1`; delete points splits paths and prunes orphans; `openEndAt` / `orientToEnd`; `movePoint` shifts adjacent control points by half; `transformPath`; a wrap-around path is not closed, a path returning to its first node in the same cell is; `toggleOp` ordering; `cloneMatrices` for power 2 of a 3-fold rotation and its inverse round-trips a point.
- `regions.test.js`: a closed square → one face; two crossing lines inside a square → four faces; a dangling stroke inside a face does not split it; a single edge plus a 180° rotation on a square lattice → two faces per cell; a face straddling the cell edge is found once; `faceAt` picks the right face; a curved edge split at `t` reproduces the original curve when re-joined.
- `freehand.test.js`: RDP on a straight line returns two points; a sampled arc yields a control point near the true one; a short jitter stroke is rejected.
- `hit.test.js`: `snapWorld` prefers an anchor in a neighbouring cell over the grid; `skip` excludes the dragged point; bbox handles and matrices.
- `history.test.js`: push / undo / redo ordering, cap at 50, `beginDrag` pushes once per gesture, redo cleared on new push.

Browser interactions are verified against §6 by driving the served page with Chrome DevTools during implementation.

## 11. Implementation order

1. Repo cleanup, `package.json`, `index.html` shell, `styles.css`, `config.js`, `state.js`.
2. `lattice.js`, `transform.js` + tests.
3. `paths.js`, `hit.js`, `history.js` + tests.
4. `render.js` for the static scene (grid, frames, ghosts, strokes, clones, points) with a hard-coded example doc.
5. `interaction.js` + `actions.js`: Pen, then Select (points, path drag, marquee), then diamonds and insert.
6. Construction layer: elements, bindings, chains, clone anchors and body drags, lattice handles.
7. `freehand.js` + tests, then the Freehand tool.
8. Bounding box scale / rotate.
9. `regions.js` + tests.
10. Fill tool, fill rendering, sublayers, palette fill mode.
11. Chrome (`ui.js`), hint, help, view pan / zoom / fit.
12. Rewrite `CLAUDE.md`.
