# Engine rebuild (Project 1 of 2) — design

Date: 2026-09-27, revised 2026-09-28 (Preact + Vite + TypeScript, immutable documents, `<use>` rendering, holes, persistence, export)
Branch: `feature/rebuild`
Behavioural reference: Claude Design project "Tessellation Designer v2 Symmetry" (the working prototype). Layout for this project is the prototype's own floating-panel chrome. The Layers / Properties chrome from "Editing UI Wireframes" turn 2 is Project 2.

Project 1 goes beyond the prototype in these agreed ways: symmetry is built from three primitives (translate, mirror, rotate) composed in order; closed regions can be filled, with holes; paths sit in a structure or a detail sublayer around the fills; the document autosaves and can be exported as JSON and as tiled SVG.

## 1. Goal

Rebuild the editor from scratch so the served app behaves like the v2 prototype and adds fills: a lattice tile, construction elements, paths that wrap across tile edges, clones produced by ordered compositions of elements, and regions bounded by all of that which can be coloured.

Success: open the app, add a 180° rotation, draw one edge, and the shape repeats and clones across the tiling as the prototype does. Switch to Fill, hover, and the two enclosed regions light up; click each with a colour and the tessellation reads as figure and ground. Reload and it is still there. Export a 4×4 SVG and it opens in a browser as the artwork. Every interaction in §6 works. Pure modules are covered by Vitest; the main flows by Playwright.

### Non-goals (Project 2 or later)

- Layers panel, Properties panel, tool options row, icon rail.
- Node tool (A), Hand (H), Zoom (Z) tools, groups, lock/hide/rename/reorder, context menu.
- Scissors, join, shapes, eyedropper.
- Composing clones across bindings (full group closure). Each clone belongs to one binding and one power.
- Propagating fills through elements automatically. A fill is one click per region.
- Enforcing the crystallographic restriction. The UI hints; the engine allows any n.
- Reordering ops inside a chain by drag; a friendlier treatment of open orbits (currently capped at 12 clones with a warning).
- Multi-document, cloud sync, PNG export.
- The old subtile model, which is removed, not migrated.

## 2. Stack and repository

**Stack:** Vite, Preact, `@preact/signals`, TypeScript (`strict`). Runtime dependencies are exactly `preact` and `@preact/signals`. Dev dependencies: `vite`, `typescript`, `@preact/preset-vite`, `vitest`, `@playwright/test`. `vite build` produces a static `dist/` deployable anywhere.

**Run:** `npm run dev` (Vite dev server with hot reload), `npm test` (Vitest, pure modules and actions), `npm run e2e` (Playwright against the dev server), `npm run build`.

**Delete:** `geometry.js`, `state.js`, `transforms.js`, `styles.css`, `tessellation_editor_phase3_delete.html`, `FEATURE_SPEC.md`, everything under `js/`. They live on `feature/subtiles` / `feature/ui-refinement` and in history.

**Layout:**

```
index.html                    Vite entry, mounts <App/>
package.json, vite.config.ts, tsconfig.json, playwright.config.ts
src/main.tsx                  mount
src/styles.css                tokens, panels, buttons, SVG classes
src/config.ts                 constants, colours, presets, swatches
src/types.ts                  Doc, Point, Node, Path, Segment, Element (union), Binding, Fill, Matrix, Selection, Drag
src/ids.ts                    makeId()
src/engine/lattice.ts         pure: basis maths, cells, snapping
src/engine/transform.ts       pure: matrices, element matrices, orbit, classify
src/engine/paths.ts           pure: draft mutations for points/paths/elements/bindings/fills
src/engine/hit.ts             pure: anchors, snapping, marquee, bbox maths
src/engine/freehand.ts        pure: RDP + quadratic fit
src/engine/regions.ts         pure: planar arrangement → faces with holes, faceAt, facePathData
src/engine/serialize.ts       pure: Doc ↔ JSON (versioned), tiled SVG export
src/state/doc.ts              doc signal, commit(), draft(), derived computeds (clone matrices, faces)
src/state/ui.ts               UI signals: layer, tool, selection, hover, drag, view, style, snap, help
src/state/history.ts          undo/redo over doc references
src/state/persist.ts          localStorage autosave + restore
src/actions.ts                user-level actions (draft → mutate → commit)
src/interaction/pointer.ts    delegated pointer/keyboard/wheel on the SVG, dispatches to tools
src/interaction/tools/*.ts    select, pen, freehand, fill, construct, common
src/components/App.tsx        layout
src/components/Canvas.tsx     the SVG scene: defs + base cell + <use> copies + overlays
src/components/Chrome.tsx     top-left bars, palette, undo, hint, help (small child components in the same folder)
src/example.ts                demo document (loaded with ?example)
tests/unit/*.test.ts          Vitest
tests/e2e/*.spec.ts           Playwright
```

`CLAUDE.md` is rewritten at the end of the project to describe the new model and stack.

## 3. Data model

All document entities carry stable string ids (`makeId()`), never array indices. Arrays keep insertion order for z-order. The document is an **immutable value**: actions produce a new `Doc` and commit it (§5); nothing mutates the committed document.

```ts
type Cell = { c: number; r: number };
type Node = { pointId: string; cell: Cell };
type Segment = { to: Node; cp: { x: number; y: number } | null };   // cp is cell-local to the segment's first node's cell
type Path = { id: string; start: Node; segments: Segment[]; style: { color: string; weight: number }; layer: 'structure' | 'detail' };
type Element =
  | { id: string; kind: 'translate'; u: number; v: number }         // fractions of a and b
  | { id: string; kind: 'mirror'; cx: number; cy: number; angle: number }   // world; degrees in [0, 180)
  | { id: string; kind: 'rotate'; cx: number; cy: number; n: number };      // 1/n turn about (cx, cy)
type Binding = { id: string; pathId: string; ops: string[] };         // ordered element ids
type Fill = { id: string; x: number; y: number; color: string };      // seed, base-cell frame
type Doc = { version: 1; lattice: { ax; ay; bx; by }; points: { id; x; y }[]; paths: Path[]; elements: Element[]; bindings: Binding[]; fills: Fill[]; newPathOps: string[][] };
```

- **Points are cell-local, in world units.** A node is a point placed in a cell; world position = `point + c·a + r·b`. One point can appear in several cells of one path; that is how a path leaves the tile on one edge and continues from the opposite edge. Changing the lattice moves nodes with their cells but does not stretch shapes (rigid). Storing points in lattice `(u, v)` instead, which would stretch a design when the lattice changes, was considered and rejected: symmetry elements are rigid, and a stretched mirror image is no longer a mirror image.
- **Segments own their control point.** `segments[j]` runs from the previous node (`start` for `j = 0`, else `segments[j-1].to`) to `segments[j].to`. `cp` is quadratic and stored relative to the origin of the previous node's cell, so it follows the cell when the lattice changes. When an endpoint moves by `(dx, dy)`, each adjacent control point moves by half of that (both endpoints: the full delta).
- A path is **closed** when `segments[last].to` is the same point in the same cell as `start`. There is no `closed` flag.
- `layer` decides whether the path's stroke is drawn below or above fills. Both sublayers participate in region detection. Clones inherit their source path's sublayer.
- An **element** is one primitive isometry. There is no glide kind: Escher's glide is a binding `[mirror, translate(1/2, 0)]` with the mirror parallel to a. The **lattice** is the pair of translate(1,0) and translate(0,1) everything is measured against. It is shown on the Construction layer and has handles, but it is not an element: it cannot be deleted, bound or disarmed.
- A **binding** clones one path through the composite of its `ops`, applied left to right. Its clones are the powers of that composite up to, but excluding, the first power that is a lattice translation (§4). A clone is identified by `(bindingId, power)`. Deleting a path or an element deletes the bindings that reference it. Deleting the last node reference to a point deletes the point.
- A **fill** paints whichever region contains its seed (§4). Fills have no reference to paths, so they survive edits as long as the region still contains the seed.
- `newPathOps` lists the chains every new path receives. It is part of the document and of history.

UI state (signals, never in history or persistence):

```ts
layer: 'drawing' | 'construction'
sublayer: 'structure' | 'detail'                 // for new paths
tool: 'select' | 'pen' | 'freehand' | 'fill'
pen: { pathId } | null                           // path being extended
selection: null | { kind: 'path'; id } | { kind: 'clone'; bindingId; power } | { kind: 'element'; id } | { kind: 'points'; ids: string[] } | { kind: 'fill'; id }
hover: pointId | null
hoverPoint: { x, y } | null                      // Fill tool, world
drag: Drag | null                                // discriminated union per tool, see §6
cursor: { x, y } | null                          // world; pen rubber band
view: { pan: { x, y }; zoom }
viewport: { width; height }
space: boolean
style: { color; weight }                         // default stroke for new paths
fillColor: string
snap: boolean; gridDivisions: 8; ghostOpacity: 0.45; showHelp: boolean
```

## 4. Coordinate spaces and maths

### View

Screen → world: `(sx - pan.x) / zoom`. The SVG root `<g>` carries `translate(pan) scale(zoom)`. Hit thresholds and handle sizes in `config.ts` are screen pixels; divide by `zoom` in world space. On load and on `⌘0`, fit the base cell plus a margin. **Visible cells** = the range of cell offsets whose parallelogram intersects the viewport, clamped to 7×7 around the base cell.

### Lattice

World → (u,v): solve `p = u·a + v·b`. `cellOf(p)` = `floor(u), floor(v)` plus the cell-local remainder. Grid snap rounds `u, v` to multiples of `1/gridDivisions`. **Fraction snap** (for element positions and translate vectors) rounds to the finer of the grid and twelfths, so 1/2, 1/3, 1/4 and 1/6 are always reachable. Shift inverts the snap setting for the duration of a gesture. `stepAlong(dir)` = grid step measured along a direction. A lattice is degenerate when `|det| < 400`; gestures that would produce one are ignored.

### Transforms

One representation everywhere: `type Matrix = readonly [a, b, c, d, e, f]` in SVG order (`x' = a·x + c·y + e`, `y' = b·x + d·y + f`).

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
| empty chain | 0 |

Quadratic beziers are affine-invariant, so a clone's control points are the images of the source's control points and clones stay exact.

### Snapping

`snapWorld(p)`: nearest anchor within `SNAP_PX / zoom`, else grid snap. Anchors are every point and every clone point in the 3×3 window of cells. A `skip` predicate excludes the thing being dragged.

### Regions

Computed by `regions.ts` from a `Doc`, memoised on the document reference (§5):

1. Collect segments from every path and every clone, placed in the 3×3 window of cells, tagged with `(source, cellOffset, segmentIndex)`.
2. Flatten curves into polylines (adaptive, 8–32 samples by length), find all pairwise intersections and touches with a spatial hash, and split segments there, recording the split parameter `t` on the original curve.
3. Build the planar graph: merge coincident vertices within 1e-4, deduplicate coincident edges (a path lying on its own mirror line or on a cell edge), sort half-edges around each vertex by angle, walk faces with the interior on the left. Dangling edges are walked on both sides by the same face and do not split it.
4. Positive-area loops are faces. Negative-area loops are component boundaries; each one nested inside a face (and not inside a smaller face) becomes a **hole** of that face. A face is `{ outer, holes, area, pieces }`.
5. Each loop keeps its outline as exact pieces: for each edge, the original segment split at `[t0, t1]` by de Casteljau, so rendering is exact at any zoom. `facePathData(face)` emits the outer loop and every hole as subpaths, rendered with `fill-rule: evenodd`.
6. `faceAt(faces, p)` finds the smallest face whose outer loop contains `p` and no hole contains it. A seed in a hole, outside every face, or exactly on an edge resolves to no face and paints nothing.

Rendering translates each seeded face to every visible cell via `<use>` (§7). The cost is roughly quadratic in segment count; results are cached per document reference so drags without geometry changes do not recompute, and the computation is skipped for frames where the document has not been committed.

## 5. State, history, persistence

**Document signal.** `doc.ts` holds `doc: Signal<Doc>`. An action calls `draft()` (a `structuredClone` of the current document), applies mutation helpers from `engine/paths.ts` to the draft, then `commit(next, { history: true | 'drag' })`. Helpers never see the committed document. Derived values are `computed`s on `doc`: `cloneMatricesByBinding`, `faces`, `anchors`. Because the document reference only changes on commit, memoisation is identity-based and free.

**History** (`history.ts`) keeps `past: Doc[]` and `future: Doc[]` of references, max 50. `commit(next)` pushes the previous document and clears `future`. A drag commits many times but records one entry: the first commit of a gesture pushes, later commits within the same gesture replace. Undo and redo swap references and clear selection, pen, hover and drag. Pan and zoom never enter history.

**Persistence** (`persist.ts`). Every commit schedules a debounced (300 ms) write of the document to `localStorage` under a versioned key. On load, the stored document is restored if present and valid; `?example` loads the demo instead; `?blank` starts empty. **JSON export** downloads the document; **JSON import** replaces it (one history entry). A schema `version` field guards both; unknown versions are refused with a message.

**SVG export** (`serialize.ts`). Given rows × columns (default 4×4) the export writes a standalone SVG with the base cell's structure strokes, fills and detail strokes in `<defs>` and one `<use>` per cell, with a `viewBox` covering the requested cells. No frames, grid, handles or elements. Strokes keep their weights and colours; fills keep their colours and `evenodd`.

## 6. Interactions

All pointer handling is one delegated listener set on the SVG (`pointer.ts`). Pointer-sensitive elements carry `data-kind` and ids; the handler dispatches to per-tool modules with `onDown / onMove / onUp`. Every pointerdown creates a `drag`; a click is a drag that never moved past 3 px. Pointer capture keeps a gesture alive off the canvas; `pointercancel` and window `blur` end it without further changes.

### Layers

`Tab` toggles Drawing ↔ Construction. Only the active layer's elements receive pointer events; the other renders dimmed. Switching layers ends any pen path and clears a selection that belongs to the other layer. On Drawing, a Structure / Detail toggle sets `sublayer` for new paths.

### Pen (P)

- Click empty space: add a point (anchor-snapped, then grid-snapped); start a new path there or append to the path in progress. A new path gets one binding per chain in `newPathOps`. If the snap lands on a raw point copy, that point is reused (shared) rather than duplicated.
- Click an existing point: start a new path from it, or, if it is the open end of a path, resume that path (reversing segment order if needed so the clicked end is last). While a path is in progress, clicking a point appends it; clicking the last point again ends the path.
- Click a clone anchor: append the underlying point in its own cell (through the inverse of that clone's matrix).
- `Esc` / `Enter` end the path. A path with fewer than one segment is discarded.
- Rubber band from the last node to the cursor.
- `Space`+drag while a path is in progress moves the first element of each of that path's bindings (or of each chain in `newPathOps` if the path has none).

### Freehand (F)

Press and drag on empty space or on a point. The raw stroke is previewed live, plus one ghost per clone matrix the new path would get and per neighbouring cell. On release: RDP simplify (eps 5 world units), fit a quadratic per simplified segment (null if the deviation is under 2.5), snap the last point to a raw anchor if within threshold. If the stroke started on the open end of a path, extend that path; otherwise create a new path with the default bindings.

### Select (V)

- Click a segment: select its path. Click again on a selected path's segment: insert a node there (straight: at the click projection, grid-snapped; curve: de Casteljau split at t = 0.5).
- Click a point: select it. `⇧`-click toggles membership. Drag on empty space: marquee (adds with `⇧`). Selected points drag together, delta grid-snapped.
- Drag a segment: move the whole path. Drag a point: move it, anchor-snapped (excluding its own raw copies, so it can snap to its own image), then grid-snapped.
- Selected path shows a bounding box: eight scale handles (corner = uniform, `⇧` = free; edge = one axis) and a rotate knob above the top edge (snapped to 15°). Scaling and rotation transform the path's points and control points from the gesture's starting geometry; clones follow.
- Each segment of a selected path shows a diamond at its control point (filled) or midpoint (hollow). Drag to bend. Double-click to straighten.
- Click a clone: select it. Drag a clone's **anchor**: edit the shared point through the inverse of the clone's matrix. Drag a clone's **body**: move the first element of its binding so that the clone follows the pointer. For a rotation by `1/n` the centre moves by `(I − R)⁻¹·Δ`; for a mirror, half the perpendicular component of `Δ` moves the line, and the parallel component is given to the first translate element in the chain if there is one, otherwise dropped.
- Click a filled region: select the fill.
- `⌫` deletes: the hovered point if any and no multi-selection; otherwise the selection (points, path, clone → remove its binding, element, fill).

### Fill (B)

- Hovering tints the region under the cursor, so closure is visible before committing.
- Click inside a region: place a seed with `fillColor`, replacing any seed whose face is the same region. Click in a hole or outside every region: no-op.
- Click an existing fill with the Fill tool: recolour it to `fillColor`.
- The palette shows Fill swatches while the Fill tool is active or a fill is selected, Stroke swatches otherwise.

### Construction layer

- `O` adds a rotation (n = 2), `M` a mirror, `T` a translation (default `(1/2, 1/2)`), each at the cell centre, selected, and appended as a one-op chain to `newPathOps`. If a path was selected when adding, the path also gets a binding through the new element.
- Drag an element to move it (anchor-snapped, then fraction-snapped). A selected mirror shows a rotate knob (snapped to 15°); `[` / `]` rotate by 15°. A selected rotation shows chips 2 · 3 · 4 · 6 and a hint when `n` does not fit the lattice (3 and 6 want the hex preset, 4 wants square). A translation is drawn as an arrow from the cell origin; drag its tip, fraction-snapped.
- Lattice handles `a` and `b` are draggable (length to 10 units, angle to 15° when snapping) through the same drag path as elements. The view does not refit during a lattice drag.
- Clicking empty space clears the selection.

### Selection bar

- **Path**: one row per binding showing its chain as chips ("↻1 → ⟋2"); clicking an element chip toggles that element in the chain (append or remove); "+ chain" starts an empty binding that the next chip click populates; a star on each chain toggles whether it is in `newPathOps`; "+ ↻" / "+ ⟋" / "+ ⇢" add a new element bound to this path; Below / Above fills toggle; Delete.
- **Clone**: "Select its element", "Select source path", Unlink (removes the binding).
- **Element**: "Apply to new paths" (toggles its one-op chain in `newPathOps`); rotation: n chips; mirror: rotate ±15° and angle readout; translation: u, v readout with ½ · ⅓ · ¼ shortcuts along a and b; "in N chains"; Delete.
- **Fill**: colour comes from the palette; Delete.
- **Points**: hint only.

### Palette

Six swatches and five weights. With a path or clone selected, stroke changes apply to that path and become the default. With nothing selected, they set the default. In fill mode the swatches set `fillColor` and recolour a selected fill.

### File

A small top-right group: Export SVG (prompts rows × columns, default 4×4), Export JSON, Import JSON (file picker; confirms if the current document is not empty), New (confirms). Autosave needs no control; the hint bar shows "saved" briefly after a write.

### View

Wheel = pan. `⌘`/`Ctrl`+wheel and pinch = zoom about the cursor (clamped). `⌘0` = fit.

### History and help

`⌘Z` / `⇧⌘Z` / `⌘Y`. Undo/redo buttons reflect availability. `?` toggles the shortcut sheet. The hint bar shows one context line (prototype wording, extended for Fill and elements) and counts: points · paths · elements · clones · fills.

## 7. Rendering

`Canvas.tsx` renders from the `doc` signal and the UI signals. The base cell is rendered once into `<defs>` as three groups, `#cell-structure`, `#cell-fills`, `#cell-detail`, each containing every path and clone (or seeded face) of that layer in base-cell coordinates. Every visible non-base cell then draws three `<use href>` elements translated by the cell offset, at `ghostOpacity`. The base cell draws the same three groups directly (so they can carry halos, hit targets and hover tints) at full opacity. Element ghosts are drawn per cell as before (one small mark per element per cell).

Bottom to top:

1. Grid lines inside the base cell.
2. Cell frames for every visible cell; base cell in ink, others muted.
3. Element ghosts in the neighbouring cells (dashed violet).
4. Neighbour cells: `<use #cell-structure>`, `<use #cell-fills>`, `<use #cell-detail>` per cell.
5. Base cell structure strokes, with a halo when selected or linked and a transparent 14 px hit path per segment (Select tool only).
6. Base cell fills (`evenodd`), hit targets in Select; the hovered face tinted in the accent colour in Fill.
7. Base cell detail strokes, as 5.
8. Control-point guide lines for the selected path or clone.
9. Freehand preview and its ghosts. Marquee. Pen rubber band.
10. Bounding box, ghost boxes, scale handles, rotate knob.
11. Segment diamonds.
12. Points (those of the selected path, the pen path, the selection, or all while drawing) in the 3×3 window, dimmed outside the base cell, each carrying its copy's cell.
13. Clone anchors (selected clone, or all clones while in Freehand).
14. Elements: mirror lines, translation arrows, rotation centres with their `n`, rotate knobs.
15. Lattice handles and the `a` / `b` labels.

Handle radii and hit widths are divided by `zoom`. Path stroke width is in world units. Frames, guides and handles use `vector-effect: non-scaling-stroke`. Lists are keyed by entity id (and cell offset) so Preact reuses nodes across renders.

## 8. Chrome (prototype layout)

Floating panels over a full-viewport SVG, warm palette (`#f4f2ec` background, `#1c1b18` ink, `#3b6fd1` accent, `#7048e8` elements, `#c2255c` lattice) as CSS custom properties.

- Top-left: layer toggle (Drawing / Construction). On Drawing: the tool group (Select / Pen / Freehand / Fill) and the Structure / Detail toggle. On Construction with nothing selected: the Elements bar (add rotation, mirror, translation; one chip per element, filled when in `newPathOps`) and the Lattice bar (five presets with a parallelogram icon, readout of |a|, |b|, angle). With a selection: the selection bar (§6).
- Bottom-left: palette (Drawing only), then the undo/redo cluster.
- Bottom: hint text and counts.
- Top-right: the File group and `?` with the shortcut sheet.

All controls are `<button>`s with `title`s and 36 px minimum hit targets.

## 9. Error handling

- Pointer handlers bail on non-primary buttons and when the target layer is inactive.
- `pointercancel` and window `blur` end any drag without further changes.
- Mutations that would leave a path with no segments delete the path, except the pen path in progress.
- Deleting an element removes bindings that use it and drops it from `newPathOps`; deleting a path removes its bindings; orphaned points are pruned after any node removal.
- An orbit that does not close within the cap renders its capped clones and the element's chip shows a warning glyph with a hint.
- Degenerate lattices are rejected at the gesture. Presets are always valid.
- Region computation is wrapped so a numerical failure logs and renders no fills for that document rather than breaking the render.
- A corrupt or foreign-version document in localStorage or an import is refused with a message and the app starts empty; the bad value is left in place under a `-rejected` key for recovery.

## 10. Testing

**Vitest** (`npm test`), pure modules and actions:

- `lattice`: `toUV` / `fromUV` round trip for every preset; `cellOf` on boundaries; grid and fraction snapping on a skewed lattice; `stepAlong`; `isDegenerate`.
- `transform`: `matrixOf` for each primitive against hand-computed points; `compose` / `invert` / `power`; `isLatticeTranslation`; `orbit` sizes for every row of the table in §4 including the empty chain, plus the `open` flag for rotate 5; `classify` of `[mirror, translate]` is a glide and of `[rotate 2, translate]` is a rotation with the expected centre.
- `paths`: append / insert keep segments consistent; delete points splits paths, removes both occurrences of a closed path's shared node, and prunes orphans; `openEndAt` / `orientToEnd` shift cells and control points together; `movePoint` shifts adjacent control points by half; `transformPath`; a wrap-around path is not closed, a path returning to its first node in the same cell is; `toggleOp` ordering; `cloneMatrices` for power 2 of a 3-fold rotation and its inverse round-trips a point; changing the lattice keeps every control point at the same cell-local position.
- `regions`: a closed square → one face; two crossing lines inside a square → four faces; a dangling stroke inside a face does not split it; source edges plus a 180° rotation on a square lattice → two faces per cell; a face straddling the cell edge is found once; coincident edges from a mirror on the path are deduplicated; a closed loop inside a face becomes a hole, `faceAt` inside the hole is null, and `facePathData` has two subpaths; a seed outside every region is null; a curved edge split at `t` reproduces the original curve when re-joined; the computation is memoised per document reference.
- `freehand`: RDP on a straight line returns two points; a sampled arc yields a control point near the true one; a short jitter stroke is rejected.
- `hit`: `snapWorld` prefers an anchor in a neighbouring cell over the grid; `skip` excludes the dragged point but not its clone images; bbox handles and matrices.
- `history` / `doc`: commit pushes and clears redo; a drag records one entry; cap at 50; undo restores the exact previous reference and clears selection.
- `serialize`: JSON round trip preserves the document; a foreign version is refused; the SVG export contains one `<use>` per requested cell and the expected `viewBox`.
- `actions`: pen flow (add, resume, end, discard), `addElement` binds the selected path, `fillAt` seeds and recolours, `finishFreehand`, `zoomAt` keeps the cursor fixed and never enters history.

**Playwright** (`npm run e2e`), against the dev server:

- Draw and clone: press `O`, draw three points with the Pen, assert the number of stroke elements in `#cell-structure` and that a `<use>` exists per neighbouring cell.
- Fill: draw a closed loop, press `B`, click inside, assert a filled `<path>` with the chosen colour appears; reload the page and assert it is still there (autosave).
- Undo a drag: drag a point, press `⌘Z`, assert its `cx` returned to the original.
- Export: click Export SVG, assert a download with `<use>` elements is produced.

## 11. Implementation order

1. Repo cleanup, Vite + Preact + TypeScript + Vitest + Playwright setup, `types.ts`, `config.ts`, `ids.ts`, empty `App`.
2. `engine/lattice.ts`, `engine/transform.ts` + tests.
3. `engine/paths.ts`, `engine/hit.ts` + tests.
4. `state/doc.ts`, `state/ui.ts`, `state/history.ts` + tests.
5. `engine/regions.ts` (with holes) + tests.
6. `Canvas.tsx` static scene: defs, base cell, `<use>` copies, fills, points, elements; `example.ts`.
7. `actions.ts` + tests; `pointer.ts` with Pen and Select tools.
8. Construction tool: elements, lattice handles, clone body drags, chains.
9. `engine/freehand.ts` + tests; Freehand tool. Bounding box scale / rotate. Fill tool.
10. `Chrome.tsx`: bars, palette, hint, help, view pan / zoom / fit.
11. `state/persist.ts`, `engine/serialize.ts` + tests; File group; Playwright flows.
12. Rewrite `CLAUDE.md`.
