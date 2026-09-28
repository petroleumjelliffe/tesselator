# Engine rebuild (Project 1 of 2) — design

Date: 2026-09-27, revised 2026-09-28 (Preact + Vite + TypeScript; lattice coordinates throughout; geometric hit-testing; editable copies; holes; persistence; export; touch and pen)
Branch: `feature/rebuild`
Behavioural reference: Claude Design project "Tessellation Designer v2 Symmetry" (the working prototype). Layout for this project is the prototype's own floating-panel chrome. The Layers / Properties chrome from "Editing UI Wireframes" turn 2 is Project 2.

Project 1 goes beyond the prototype in these agreed ways: symmetry is built from three primitives (translate, mirror, rotate) composed in order; closed regions can be filled, with holes; paths sit in a structure or a detail sublayer around the fills; any rendered copy of a path (in a neighbouring cell or through a symmetry) can be selected and edited in place; the document and UI preferences autosave; the design exports as JSON and as a tile, a 3×3, or an N×M wallpaper SVG.

## 1. Goal

Rebuild the editor from scratch so the served app behaves like the v2 prototype and adds fills: a lattice tile, construction elements, paths that wrap across tile edges, clones produced by ordered compositions of elements, and regions bounded by all of that which can be coloured.

Success: open the app, add a 180° rotation, draw one edge, and the shape repeats and clones across the tiling as the prototype does. Click the copy in the next cell over and drag its point: the original moves and every copy follows, while the handles stay where you clicked. Switch to Fill, hover, and the two enclosed regions light up; click each with a colour and the tessellation reads as figure and ground. Reload and it is still there. Export a 12×8 wallpaper SVG and it opens in a browser as the artwork. Every interaction in §6 works. Pure modules are covered by Vitest; the main flows by Playwright.

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

**Run:** `npm run dev` (Vite dev server with hot reload), `npm test` (Vitest, pure modules, state and actions), `npm run e2e` (Playwright against the dev server), `npm run build`.

**Delete:** `geometry.js`, `state.js`, `transforms.js`, `styles.css`, `tessellation_editor_phase3_delete.html`, `FEATURE_SPEC.md`, everything under `js/`. They live on `feature/subtiles` / `feature/ui-refinement` and in history.

**Layout:**

```
index.html                    Vite entry, mounts <App/>
package.json, vite.config.ts, tsconfig.json, playwright.config.ts
src/main.tsx                  mount
src/styles.css                tokens, panels, buttons, SVG classes
src/config.ts                 constants, colours, presets, swatches
src/types.ts                  Doc, Point, Node, Path, Segment, Element (union), Binding, Fill, Matrix, Copy, Selection, Drag, HitTarget
src/ids.ts                    makeId()
src/engine/lattice.ts         pure: L and L⁻¹, cells, snapping in (u, v)
src/engine/transform.ts       pure: matrices, element matrices, copy matrices, orbit, classify
src/engine/paths.ts           pure: draft mutations for points/paths/elements/bindings/fills
src/engine/hit.ts             pure: hitTest (priority hit-testing over every copy), anchors, marquee, bbox maths
src/engine/freehand.ts        pure: RDP + quadratic fit
src/engine/regions.ts         pure: planar arrangement → faces with holes, faceAt, facePathData, centroid
src/engine/serialize.ts       pure: Doc ↔ JSON (versioned), SVG export
src/state/doc.ts              doc signal, draft(), commit(), derived computeds (copies, faces, anchors)
src/state/ui.ts               UI signals: layer, tool, selection, hover, drag, view, prefs
src/state/history.ts          undo/redo over doc references, one entry per gesture
src/state/persist.ts          localStorage autosave + restore for document and prefs
src/actions.ts                user-level actions (draft → mutate → commit)
src/interaction/pointer.ts    pointer/keyboard/wheel on the SVG, hitTest, dispatch to tools
src/interaction/tools/*.ts    select, pen, freehand, fill, construct, common
src/components/App.tsx        layout
src/components/Canvas.tsx     the SVG scene: defs + <use> copies + base cell + overlays
src/components/Chrome.tsx     bars, palette, undo, file group, hint, help/settings (small child components alongside)
src/example.ts                demo document (loaded with ?example)
tests/unit/*.test.ts          Vitest
tests/e2e/*.spec.ts           Playwright
```

`CLAUDE.md` is rewritten at the end of the project to describe the new model and stack.

## 3. Data model

All document entities carry stable string ids (`makeId()`), never array indices. Arrays keep insertion order for z-order. The document is an **immutable value**: actions produce a new `Doc` and commit it (§5); nothing mutates the committed document.

**Everything in the document is in lattice coordinates `(u, v)`.** World position = `u·a + v·b`. World space exists only at render and hit-test time. Consequences: grid and fraction snapping are rounding; a node's cell is `floor(u), floor(v)` of its world-equivalent placement; changing the lattice deforms the whole design affinely and coherently (an Escher-style shear of a p1 or p2 design stays a valid tessellation, since 180° turns commute with any affine map); mirrors and 3-, 4-, 6-fold rotations remain meaningful only on the lattice they were designed for, which the UI already hints.

```ts
type UV = { u: number; v: number };
type Cell = { c: number; r: number };
type Node = { pointId: string; cell: Cell };
type Segment = { to: Node; cp: UV | null };        // cp is relative to the origin of the segment's first node's cell
type Path = { id: string; start: Node; segments: Segment[]; style: { color: string; weight: number }; layer: 'structure' | 'detail' };
type Element =
  | { id: string; kind: 'translate'; u: number; v: number }            // translation vector, fractions of a and b
  | { id: string; kind: 'mirror'; u: number; v: number; du: number; dv: number }   // line through (u,v) with lattice direction (du,dv)
  | { id: string; kind: 'rotate'; u: number; v: number; n: number };   // 1/n turn about (u,v)
type Binding = { id: string; pathId: string; ops: string[] };           // ordered element ids
type Fill = { id: string; u: number; v: number; color: string };        // seed, base-cell frame
type Doc = { version: 1; lattice: { ax; ay; bx; by }; points: (UV & { id: string })[]; paths: Path[]; elements: Element[]; bindings: Binding[]; fills: Fill[]; newPathOps: string[][] };
```

- **Points** are stored with `u, v` normally in `[0, 1)`, and nodes add an integer cell. One point can appear in several cells of one path; that is how a path leaves the tile on one edge and continues from the opposite edge.
- **Segments own their control point.** `segments[j]` runs from the previous node (`start` for `j = 0`, else `segments[j-1].to`) to `segments[j].to`. `cp` is quadratic, relative to the previous node's cell origin. When an endpoint moves by `(du, dv)`, each adjacent control point moves by half of that (both endpoints: the full delta).
- A path is **closed** when `segments[last].to` is the same point in the same cell as `start`. There is no `closed` flag.
- `layer` decides whether the path's stroke is drawn below or above fills. Both sublayers participate in region detection. Copies inherit their source path's sublayer.
- An **element** is one primitive isometry, positioned in lattice coordinates so that "cell centre" and "one third along the diagonal" survive a preset change. A mirror's direction is a lattice direction, so a mirror along `b` stays along `b` after a skew; its world angle is derived. There is no glide kind: Escher's glide is a binding `[mirror, translate(1/2, 0)]` with the mirror along `a`. The **lattice** is the pair of translate(1,0) and translate(0,1) everything is measured against. It has handles on the Construction layer but is not an element: it cannot be deleted, bound or disarmed.
- A **binding** clones one path through the composite of its `ops`, applied left to right. Its clones are the powers of that composite up to, but excluding, the first power that is a lattice translation (§4). Deleting a path or an element deletes the bindings that reference it. Deleting the last node reference to a point deletes the point.
- A **fill** paints whichever region contains its seed (§4). Fills have no reference to paths, so they survive edits as long as the region still contains the seed.
- `newPathOps` lists the chains every new path receives. It is part of the document and of history.

**Copies.** Everything the user sees is a copy of a path: `type Copy = { cell: Cell; bindingId: string | null; power: number }`. The source in the base cell is `{ cell: {0,0}, bindingId: null, power: 0 }`. A copy's world matrix is `cellMatrix(cell) ∘ cloneMatrix(bindingId, power)` (or just `cellMatrix` for a source copy). Selection and drags always carry the copy the user clicked, so handles render there and edits map back through the copy's inverse.

UI state (signals, never in history):

```ts
layer: 'drawing' | 'construction'
sublayer: 'structure' | 'detail'                 // for new paths; persisted
tool: 'select' | 'pen' | 'freehand' | 'fill'    // persisted
pen: { pathId } | null                           // path being extended
selection: null
         | { kind: 'path'; id; copy: Copy }        // a source or a clone, at the copy that was clicked
         | { kind: 'element'; id }
         | { kind: 'points'; ids: string[] }
         | { kind: 'fill'; id }
hover: HitTarget | null                          // result of hit-testing on pointer move
drag: Drag | null                                // discriminated union per tool, see §6
cursor: { x, y } | null                          // world; pen rubber band
view: { pan: { x, y }; zoom }                    // persisted
viewport: { width; height }
space: boolean
prefs: { style: { color; weight }; fillColor; snap; gridDivisions; ghostOpacity }   // persisted
showHelp: boolean; lastSavedAt: number | null
```

## 4. Coordinate spaces and maths

### Lattice

`L(uv) = u·a + v·b` and `L⁻¹`. `cellOf(uv)` = `floor(u), floor(v)` plus the remainder. Grid snap rounds `u, v` to multiples of `1/gridDivisions`. **Fraction snap** (element positions and translate vectors) rounds to the finer of the grid and twelfths, so 1/2, 1/3, 1/4 and 1/6 are always reachable. Shift inverts the snap setting for the duration of a gesture. A lattice is degenerate when `|det| < 400` world units²; gestures that would produce one are ignored.

Distances, thresholds and hit tests happen in world space (screen pixels ÷ zoom), because the lattice is not orthonormal. Results are mapped back to `(u, v)` before they enter the document.

### View

Screen → world: `(sx - pan.x) / zoom`. The SVG root `<g>` carries `translate(pan) scale(zoom)`. On load (if no persisted view) and on `⌘0`, fit the base cell plus a margin. **Visible cells** = the range of cell offsets whose parallelogram intersects the viewport, clamped to 7×7 around the base cell.

### Transforms

One representation everywhere: `type Matrix = readonly [a, b, c, d, e, f]` in SVG order (`x' = a·x + c·y + e`, `y' = b·x + d·y + f`), always in **world** space.

- `matrixOf(element, lattice)`: translate → `T(L(u, v))`; mirror → reflection across the line through `L(u, v)` with direction `L(du, dv)`; rotate → rotation by `2π/n` about `L(u, v)`.
- `cellMatrix(cell, lattice)` → `T(L(c, r))`; `copyMatrix(copy, doc)` → `cellMatrix ∘ cloneMatrix`.
- `compose(A, B)` (apply B then A), `invert(M)`, `apply(M, p)`, `power(M, k)`.
- `isLatticeTranslation(M, lattice)`: linear part is the identity within 1e-6 and `L⁻¹` of the translation is an integer pair within 1e-6.
- `orbit(ops, elements, lattice, cap = 12)`: composite `M`; return `[M¹, M², …, M^(k-1)]` where `M^k` is the first lattice translation. If none within `cap`, return `cap` powers and `open: true` so the UI can warn that the element does not close on this lattice. Rotations always close (Rⁿ is the identity); `open` arises from translations by fractions that are not small rationals, such as `translate(0.37, 0)`.
- `classify(M)` → `'identity' | 'translation' | 'rotation' | 'reflection' | 'glide'` with centre / line / vector, for labels and hints only.

Orbit sizes the tests pin down:

| ops | clones |
|---|---|
| rotate n | n − 1 |
| mirror | 1 |
| mirror, translate(1/2 along the line) | 1 |
| mirror, translate(1/3 along the line) | 5 (odd powers are reflected copies, even powers translations; M⁶ is the first lattice translation) |
| translate(1/2, 0) | 1 |
| translate(1/2, 1/2) | 1 |
| translate(1, 0) | 0 |
| rotate 2, translate(1/2, 0) | 1 (a rotation about a shifted centre) |
| empty chain | 0 |

Quadratic beziers are affine-invariant, so `L`, clone matrices and copy matrices all map control points exactly.

### Hit-testing

`hitTest(doc, ui, world, zoom) → HitTarget | null` in `engine/hit.ts` is geometric, not DOM-based, so it works on `<use>` copies and is unit-testable. It returns the topmost target by this priority for the active layer and tool:

- Drawing, Select: bbox handles and rotate knob → segment diamonds of the selected copy → points (3×3 window, any copy) → clone anchors of the selected clone copy → segments of any copy in the visible cells → fills (any cell) → nothing.
- Drawing, Pen: points → clone anchors (all clones) → nothing (empty click adds a point).
- Drawing, Freehand: points → nothing.
- Drawing, Fill: fills → faces → nothing.
- Construction: mirror knob and translation tip of the selected element → element marks and lines → lattice handles → nothing.

Segment distance uses the flattened curve (16 samples). Thresholds are `SNAP_PX / zoom` for points and handles and `HIT_WIDTH / 2 / zoom` for segments. A segment target carries `{ pathId, j, copy }`; a point target `{ pointId, cell }`; a fill target `{ fillId }`; a face target `{ face }`.

### Snapping

`snapWorld(p)`: nearest anchor within `SNAP_PX / zoom`, else grid snap. Anchors are every point and every clone point in the 3×3 window of cells. A `skip` predicate excludes the thing being dragged (its raw copies only, so a point can snap to its own image).

### Regions

Computed by `regions.ts` from a `Doc` in world space, memoised on the document reference (§5):

1. Collect segments from every copy in the 3×3 window, tagged with `(pathId, copy, j)`.
2. Flatten curves into polylines (adaptive, 8–32 samples by length), find all pairwise intersections and touches with a spatial hash, and split segments there, recording the split parameter `t` on the original curve.
3. Build the planar graph: merge coincident vertices within 1e-4, deduplicate coincident edges (a path lying on its own mirror line or on a cell edge), sort half-edges around each vertex by angle, walk faces with the interior on the left. Dangling edges are walked on both sides by the same face and do not split it.
4. Positive-area loops are faces. Negative-area loops are component boundaries; each one nested inside a face (and not inside a smaller face) becomes a **hole** of that face. A face is `{ outer, holes, area, centroid, pieces }`.
5. Each loop keeps its outline as exact pieces: for each edge, the original segment split at `[t0, t1]` by de Casteljau, so rendering is exact at any zoom. `facePathData(face)` emits the outer loop and every hole as subpaths, rendered with `fill-rule: evenodd`.
6. `faceAt(faces, p)` finds the smallest face whose outer loop contains `p` and no hole contains it. A seed in a hole, outside every face, or exactly on an edge resolves to no face and paints nothing.
7. `seedFor(face, click)` returns the face's centroid if the centroid lies inside the face (outside its holes), else the click point. Fills are placed there, so a later nudge of an edge does not silently drop the fill.

## 5. State, history, persistence, export

**Document signal.** `doc.ts` holds `doc: Signal<Doc>`. An action calls `draft()` (a `structuredClone` of the current document), applies mutation helpers from `engine/paths.ts` to the draft, then `commit(next)`. Helpers never see the committed document. Derived values are `computed`s on `doc`: `cloneMatricesByBinding`, `copies` (every copy in the visible cells with its matrix), `anchors`, `faces`.

**Faces during gestures.** `faces` is not recomputed while `drag` is set. The last completed faces stay on screen (fills lag a moving edge by one gesture) and the computation runs once on gesture end. Outside a gesture it runs on the next animation frame after a commit, never more than once per frame. The Fill tool has no drags, so hover tints are always current.

**History** (`history.ts`) keeps `past: Doc[]` and `future: Doc[]` of references, max 50. `commit(next)` pushes the previous document and clears `future`. A gesture (`beginGesture()` … `endGesture()`, called by the pointer core) commits many times but records one entry: the first commit inside a gesture pushes, later commits replace. Undo and redo swap references and clear selection, pen, hover and drag; if the restored document contains a zero-segment path (one the Pen owned), the Pen resumes on it with the Pen tool and Drawing layer active, so no zero-segment path is ever stranded. View changes never enter history.

**Persistence** (`persist.ts`). Every commit schedules a debounced (300 ms) write of the document to `localStorage` under a versioned key; `prefs`, `tool`, `sublayer` and `view` are written under a second key on change. On load the stored document and prefs are restored if present and valid; `?example` loads the demo instead; `?blank` starts empty. **JSON export** downloads the document; **JSON import** replaces it (one history entry). A schema `version` guards both; unknown versions are refused with a message and the bad value is kept under a `-rejected` key.

**SVG export** (`serialize.ts`). Three sizes: **Tile** (the base cell, clipped to the exact cell polygon, so a hex tile exports as a hexagon-shaped parallelogram, not a box), **3×3**, and **Wallpaper** (rows × columns, up to 64×64). For 3×3 and Wallpaper the output region is the bounding rectangle of the requested cells; every cell intersecting that rectangle is placed as a `<use>` so skewed lattices have no ragged corners, and the whole is clipped to the rectangle. The file contains the base cell's structure strokes, fills (`evenodd`) and detail strokes in `<defs>`; no frames, grid, handles or elements. Strokes keep weights and colours.

## 6. Interactions

All pointer handling is one listener set on the SVG (`pointer.ts`). On pointerdown it calls `hitTest` and dispatches to the active tool's `onDown(target, world, e)`; every pointerdown creates a `drag`; a click is a drag that never moved past 3 px. On pointermove without a drag it updates `hover` (which drives cursor and highlight). Pointer capture keeps a gesture alive off the canvas; `pointercancel` and window `blur` end it without further changes.

**Touch and pen.** Pointer Events serve mouse, pen and touch alike; `touch-action: none` on the SVG stops the browser from scrolling or zooming the page. Three rules make touch usable without a separate code path:

- **Two pointers = navigation.** While two pointers are down no tool runs. The gesture pans by the delta of the pointers' midpoint and zooms by the ratio of their distance, about the midpoint. A second pointer landing during a one-pointer drag reverts that drag to its pre-gesture state and drops its history entry, so an accidental extra finger never leaves a half-moved point behind. When one pointer lifts, the other does not resume a tool; the gesture ends when both are up. Safari's `gesturestart` / `gesturechange` events are prevented and ignored in favour of pointer tracking.
- **Thresholds follow the pointer type.** When `pointerType` is `touch`, the snap, handle and segment hit radii in `config.ts` double; `pen` and `mouse` use the base values. Handles render at their normal size because hit-testing is geometric (§4), so the picture does not change, only the tolerance.
- **Nothing requires hover or a modifier key.** Every hover behaviour has a press path: the Fill tool tints the region on pointerdown and commits on pointerup, so a finger can see the region before lifting, and moving the finger before lifting re-targets. Every modifier has a chrome control: End path (for `Esc` / `Enter`), Straighten (for double-click on a diamond), a Free toggle in the selection bar that stands in for `⇧` while scaling, an Add toggle that stands in for `⇧` while marquee-selecting, and the existing Snap button for `⇧`-inverted snapping. `Space`-drag stays keyboard-only; on touch, elements are moved on the Construction layer.

Out of scope for Project 1: palm rejection beyond the two-pointer rule, pen pressure and tilt, a phone-sized layout, and long-press menus.

**Editing through a copy.** Whatever copy the user clicks, in a neighbouring cell or through a symmetry, becomes the focus: the path is selected with that copy, handles and anchors render at that copy, and every drag maps the pointer through the copy's inverse matrix before touching the document. The source and all other copies follow. The user never has to look back at the base cell.

### Layers

`Tab` toggles Drawing ↔ Construction. Only the active layer's targets are hit-tested; the other renders dimmed. Switching layers ends any pen path and clears a selection that belongs to the other layer. On Drawing, a Structure / Detail toggle sets `sublayer` for new paths.

### Pen (P)

- Click empty space: add a point (anchor-snapped, then grid-snapped); start a new path there or append to the path in progress. A new path gets one binding per chain in `newPathOps`. If the snap lands on a raw point copy, that point is reused (shared) rather than duplicated.
- Click an existing point (any copy): start a new path from it, or, if it is the open end of a path, resume that path (reversing segment order if needed so the clicked end is last). While a path is in progress, clicking a point appends it; clicking the last point again ends the path.
- Click a clone anchor: append the underlying point in its own cell (through the inverse of that copy's matrix).
- `Esc` / `Enter` end the path. A path with no segments is discarded.
- Rubber band from the last node to the cursor.
- `Space`+drag while a path is in progress moves the first element of each of that path's bindings (or of each chain in `newPathOps` if the path has none).

### Freehand (F)

Press and drag on empty space or on a point. The raw stroke is previewed live, plus one ghost per clone matrix the new path would get and per neighbouring cell. On release: RDP simplify (eps 5 world units), fit a quadratic per simplified segment (null if the deviation is under 2.5), snap the last point to a raw anchor if within threshold. If the stroke started on the open end of a path, extend that path; otherwise create a new path with the default bindings.

### Select (V)

- Click a segment of any copy: select its path at that copy. Click again on a segment of the selected copy: insert a node there (straight: at the click projection mapped to the source, grid-snapped; curve: de Casteljau split at t = 0.5).
- Click a point: select it. `⇧`-click toggles membership. Drag on empty space: marquee (adds with `⇧`). Selected points drag together, delta grid-snapped.
- Drag a segment: move the whole path (delta mapped through the copy's inverse linear part). Drag a point: move it, anchor-snapped (excluding its own raw copies), then grid-snapped.
- The selected copy shows a bounding box: eight scale handles (corner = uniform, `⇧` = free; edge = one axis) and a rotate knob above the top edge (snapped to 15°). Scaling and rotation transform the path from the gesture's starting geometry, expressed at the copy and mapped back; all copies follow.
- Each segment of the selected copy shows a diamond at its control point (filled) or midpoint (hollow). Drag to bend. Double-click to straighten.
- A selected clone copy also shows clone anchors at its nodes; dragging one edits the shared point through the inverse. Dragging a clone copy's **body** moves the first element of its binding so that the copy follows the pointer: for a rotation by `1/n` the centre moves by `(I − R)⁻¹·Δ`; for a mirror, half the perpendicular component of `Δ` moves the line, and the parallel component is given to the first translate element in the chain if there is one, otherwise dropped.
- Click a filled region (any cell): select the fill.
- `⌫` deletes: the hovered point if any and no multi-selection; otherwise the selection (points, path → the path, clone copy → its binding, element, fill).

### Fill (B)

- Hovering tints the region under the cursor in every cell, so closure is visible before committing. With a pointer down (finger or otherwise) the tint follows the pointer and nothing is committed until release, so touch users get the same preview.
- Release inside a region: place a seed (§4.7) with `fillColor`, replacing any seed whose face is the same region. Release in a hole or outside every region: no-op.
- Click an existing fill: recolour it to `fillColor`.
- The palette shows Fill swatches while the Fill tool is active or a fill is selected, Stroke swatches otherwise.

### Construction layer

- `O` adds a rotation (n = 2), `M` a mirror, `T` a translation (default `(1/2, 1/2)`), each at `(1/2, 1/2)`, selected, and appended as a one-op chain to `newPathOps`. A new mirror's direction is `(0, 1)` (along `b`). If a path was selected when adding, the path also gets a binding through the new element.
- Drag an element to move it (anchor-snapped, then fraction-snapped). A selected mirror shows a rotate knob; dragging it or pressing `[` / `]` rotates in world space by 15° steps (snapped when snapping is on) and stores the resulting lattice direction. A selected rotation shows chips 2 · 3 · 4 · 6 and a hint when `n` does not fit the lattice (3 and 6 want the hex preset, 4 wants square). A translation is drawn as an arrow from the cell origin; drag its tip, fraction-snapped.
- Lattice handles `a` and `b` are draggable (length to 10 units, angle to 15° when snapping) through the same drag path as elements. Because the document is in lattice coordinates, the drawing deforms live with the handle. The view does not refit during a lattice drag.
- Clicking empty space clears the selection.

### Selection bar

- **Path** (source copy): one row per binding showing its chain as chips ("↻1 → ⟋2"); clicking an element chip toggles that element in the chain (append or remove); "+ chain" starts an empty binding that the next chip click populates; a star on each chain toggles whether it is in `newPathOps`; "+ ↻" / "+ ⟋" / "+ ⇢" add a new element bound to this path; Below / Above fills toggle; Delete.
- **Path** (clone copy): the same rows, plus "Select its element" and "Unlink" (removes the binding), and the label names the chain and power.
- **Element**: "Apply to new paths" (toggles its one-op chain in `newPathOps`); rotation: n chips; mirror: rotate ±15° and angle readout; translation: u, v readout with ½ · ⅓ · ¼ shortcuts along a and b; "in N chains"; Delete.
- **Fill**: colour comes from the palette; Delete.
- **Points**: hint only.

### Palette

Six swatches and five weights. With a path selected (any copy), stroke changes apply to that path and become the default. With nothing selected, they set the default. In fill mode the swatches set `fillColor` and recolour a selected fill.

### File group (top-right)

Export SVG opens a small popover: Tile · 3×3 · Wallpaper with rows and columns fields (default 12 × 8). Export JSON. Import JSON (file picker; confirms if the current document is not empty). New (confirms). The hint bar shows "saved" briefly after an autosave.

### Settings (in the `?` sheet)

Grid divisions (2–16), ghost opacity (0.1–1), and a Reset view button. Both values are prefs and persist.

### View

Wheel = pan. `⌘`/`Ctrl`+wheel and trackpad pinch = zoom about the cursor (clamped). Two-finger touch = pan and pinch zoom (see Touch and pen above). `⌘0` and the Reset view button = fit.

### History and help

`⌘Z` / `⇧⌘Z` / `⌘Y`. Undo/redo buttons reflect availability. `?` toggles the shortcut sheet with the settings row. The hint bar shows one context line and counts: points · paths · elements · clones · fills.

## 7. Rendering

`Canvas.tsx` renders from the `doc` signal and the UI signals. The base cell is rendered once into `<defs>` as three groups, `#cell-structure`, `#cell-fills`, `#cell-detail`, each containing every source and clone (or seeded face) of that layer in world coordinates of the base cell. Every visible cell, including the base cell, draws three `<use href>` elements translated by the cell offset; non-base cells at `ghostOpacity`. Nothing in these groups is interactive: hit-testing is geometric (§4), so no hit paths are needed. Highlights (halo on the selected and linked copies, hover highlight, fill hover tint) are drawn as overlays at the copy's world position.

Bottom to top:

1. Grid lines inside the base cell.
2. Cell frames for every visible cell; base cell in ink, others muted.
3. Element ghosts in the neighbouring cells (dashed violet).
4. Per visible cell: `<use #cell-structure>`, `<use #cell-fills>`, `<use #cell-detail>`.
5. Halos: the selected copy at 0.3 opacity, linked copies (same path, or clones through the selected element) at 0.15; the hovered segment's copy lightly. Fill hover tint (Fill tool) in every cell.
6. Control-point guide lines for the selected copy.
7. Freehand preview and its ghosts. Marquee. Pen rubber band.
8. Bounding box, ghost boxes, scale handles, rotate knob, at the selected copy.
9. Segment diamonds at the selected copy.
10. Points (those of the selected path, the pen path, the selection, or all while drawing) in the 3×3 window, dimmed outside the base cell.
11. Clone anchors at the selected clone copy, or at every clone while in Freehand.
12. Elements: mirror lines, translation arrows, rotation centres with their `n`, rotate knobs.
13. Lattice handles and the `a` / `b` labels.

Handle radii and hit widths are divided by `zoom`. Path stroke width is in world units. Frames, guides and handles use `vector-effect: non-scaling-stroke`. Lists are keyed by entity id (and cell offset) so Preact reuses nodes across renders. The SVG's cursor reflects `hover` (pointer over targets, grab over knobs, crosshair for Pen).

## 8. Chrome (prototype layout)

Floating panels over a full-viewport SVG, warm palette (`#f4f2ec` background, `#1c1b18` ink, `#3b6fd1` accent, `#7048e8` elements, `#c2255c` lattice) as CSS custom properties.

- Top-left: layer toggle (Drawing / Construction). On Drawing: the tool group (Select / Pen / Freehand / Fill) and the Structure / Detail toggle. On Construction with nothing selected: the Elements bar (add rotation, mirror, translation; one chip per element, filled when in `newPathOps`) and the Lattice bar (five presets with a parallelogram icon, readout of |a|, |b|, angle). With a selection: the selection bar (§6).
- Bottom-left: palette (Drawing only), then the undo/redo cluster.
- Bottom: hint text and counts.
- Top-right: the File group and `?` with the shortcut sheet and settings.

All controls are `<button>`s with `title`s and 36 px minimum hit targets, growing to 44 px when the last pointer seen was a touch. Panels wrap so the chrome fits a tablet in landscape (1024 px wide) without covering the base cell.

The selection bar for a path gains End path (visible while the pen is active), Straighten (visible when the selected segment is curved), and the Free and Add toggles described under Touch and pen. These are always present, not touch-only, so the app has no hidden modes.

## 9. Error handling

- Pointer handlers bail on non-primary buttons and when the target layer is inactive.
- `pointercancel` and window `blur` end any drag without further changes.
- Mutations that would leave a path with no segments delete the path, except the pen path in progress.
- Deleting an element removes bindings that use it and drops it from `newPathOps`; deleting a path removes its bindings; orphaned points are pruned after any node removal.
- An orbit that does not close within the cap renders its capped clones and the element's chip shows a warning glyph with a hint.
- Degenerate lattices are rejected at the gesture. Presets are always valid.
- Region computation is wrapped so a numerical failure logs and renders no fills for that document rather than breaking the render.
- A corrupt or foreign-version document or prefs value in localStorage or an import is refused with a message and the app starts from defaults; the bad value is left under a `-rejected` key.
- Wallpaper export refuses sizes over 64×64 with a message.
- A third pointer landing during a two-pointer gesture is ignored; the gesture continues with the first two until either lifts.

## 10. Testing

**Vitest** (`npm test`):

- `lattice`: `L` / `L⁻¹` round trip for every preset; `cellOf` on boundaries; grid and fraction snapping in `(u, v)`; `isDegenerate`.
- `transform`: `matrixOf` for each primitive against hand-computed points, including a mirror whose direction is a lattice direction on a skewed lattice; `copyMatrix`; `compose` / `invert` / `power`; `isLatticeTranslation`; `orbit` sizes for every row of the table in §4 including the empty chain, plus the `open` flag for translate(0.37); `classify` of `[mirror, translate]` is a glide and of `[rotate 2, translate]` is a rotation with the expected centre.
- `paths`: append / insert keep segments consistent; delete points splits paths, removes both occurrences of a closed path's shared node, and prunes orphans; `openEndAt` / `orientToEnd` shift cells and control points together; `movePoint` shifts adjacent control points by half; `transformPath` given a world matrix at a copy maps back correctly; a wrap-around path is not closed, a path returning to its first node in the same cell is; `toggleOp` ordering; changing the lattice leaves every `(u, v)` untouched.
- `hit`: priority order (a handle beats a point beats a segment beats a fill); a segment of a copy in cell (1, 0) is hit and reports that copy; a clone segment reports its binding and power; thresholds scale with zoom and double for `pointerType: 'touch'`; `snapWorld` prefers an anchor in a neighbouring cell over the grid; `skip` excludes the dragged point but not its clone images; bbox handles and matrices.
- `regions`: a closed square → one face; two crossing lines inside a square → four faces; a dangling stroke inside a face does not split it; source edges plus a 180° rotation → two faces per cell; a face straddling the cell edge is found once; coincident edges from a mirror on the path are deduplicated; a closed loop inside a face becomes a hole, `faceAt` inside the hole is null, `facePathData` has two subpaths; `seedFor` returns the centroid for a convex face and the click for a crescent whose centroid is outside; a seed outside every region is null; a curved edge split at `t` reproduces the original curve; memoised per document reference.
- `freehand`: RDP on a straight line returns two points; a sampled arc yields a control point near the true one; a short jitter stroke is rejected.
- `doc` / `history`: commit pushes and clears redo; a gesture records one entry; cap at 50; undo restores the exact previous reference and clears selection; faces are not recomputed while a drag is set.
- `serialize`: JSON round trip preserves the document; a foreign version is refused; Tile export has a clip path matching the cell polygon; 3×3 export contains nine `<use>` per layer group plus the extra cells a skewed lattice needs; Wallpaper 12×8 has the expected `viewBox`; 65×65 is refused.
- `actions`: pen flow (add, resume, end, discard), `addElement` binds the selected path, `fillAt` seeds at the centroid and recolours, `finishFreehand`, editing through a copy in cell (1, 0) moves the source point, `zoomAt` keeps the cursor fixed and never enters history.

**Playwright** (`npm run e2e`), against the dev server:

- Draw and clone: press `O`, draw three points with the Pen, assert the number of stroke elements in `#cell-structure` and one `<use>` per visible cell.
- Edit a ghost: click a segment in the cell to the right, drag its point, assert the base-cell copy moved by the same amount and the handles stayed in the right-hand cell.
- Fill: draw a closed loop, press `B`, click inside, assert a filled `<path>` with the chosen colour; reload and assert it is still there (autosave), and that the tool and snap setting were restored.
- Undo a drag: drag a point, press `⌘Z`, assert its position returned.
- Export: choose Wallpaper 4×3, assert a download whose SVG has the expected `viewBox` and `<use>` count.
- Touch: dispatch two synthetic `touch` pointers, move them apart, assert the zoom increased and the midpoint stayed fixed; start a one-finger drag on a point, land a second finger, assert the point returned to its pre-drag position and the two-finger pan took over; tap a segment with a `touch` pointer at 1.5× the mouse threshold and assert it was selected.
- Fill by touch: press inside a region with a `touch` pointer, assert the tint appears before release, release, assert the fill exists.

## 11. Implementation order

1. Repo cleanup, Vite + Preact + TypeScript + Vitest + Playwright setup, `types.ts`, `config.ts`, `ids.ts`, empty `App`.
2. `engine/lattice.ts`, `engine/transform.ts` + tests.
3. `engine/paths.ts` + tests.
4. `state/doc.ts`, `state/ui.ts`, `state/history.ts` + tests.
5. `engine/hit.ts` (hitTest, anchors, bbox) + tests.
6. `engine/regions.ts` (holes, centroid, seedFor) + tests.
7. `Canvas.tsx` static scene: defs, `<use>` cells, overlays for a hard-coded selection; `example.ts`.
8. `actions.ts` + tests; `pointer.ts` with Pen and Select tools, editing through copies.
9. Construction tool: elements, lattice handles, clone body drags, chains.
10. `engine/freehand.ts` + tests; Freehand tool. Bounding box scale / rotate. Fill tool.
11. `Chrome.tsx`: bars, palette, hint, help with settings, view pan / zoom / fit.
12. `state/persist.ts` (document and prefs), `engine/serialize.ts` + tests; File group with the export popover; Playwright flows.
13. Touch: two-pointer navigation in `pointer.ts`, pointer-type thresholds, press-to-preview fill, the End path / Straighten / Free / Add controls, touch hit sizes; Playwright touch flows.
14. Rewrite `CLAUDE.md`.
