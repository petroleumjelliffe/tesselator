# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based tessellation editor: Preact + `@preact/signals`, TypeScript (strict), Vite. Runtime dependencies are only `preact` and `@preact/signals`. `?example` in the URL loads a demo document; `?blank` starts empty; otherwise the last autosaved document is restored from localStorage.

## Running it

```
npm run dev      # http://127.0.0.1:5173/ with hot reload
npm test         # Vitest: engine, state, actions
npm run e2e      # Playwright is configured (tests/e2e/, reuses a dev server on 5173) but has no specs yet; flows are listed in the plan
npm run build    # tsc --noEmit && vite build → dist/
```

## Design documents

- `docs/superpowers/specs/2026-09-27-engine-rebuild-design.md` is the engine spec and the behavioural reference.
- `docs/superpowers/plans/2026-09-28-engine-rebuild-preact.md` is the implementation plan it was built from.
- The Claude Design project "Tessellation Designer v2 Symmetry" was the original prototype.

## Model (all lattice coordinates)

Everything in the document is in lattice `(u, v)` coordinates; world position is `u·a + v·b` for the lattice vectors in `doc.lattice`. World space exists only at render and hit-test time, so changing the lattice deforms the whole design affinely.

- **Points** are `(u, v)` in the base cell; a path's nodes are `{ pointId, cell }`, so one point can appear in several cells and a path can leave the tile on one edge and continue from the other.
- **Paths** are `{ start, segments: [{ to, cp }] }`. `cp` is a quadratic control point relative to the previous node's cell origin. Closed = last node is the start node in the same cell. `layerId` names the document layer the path is on. A node may carry `via: Copy`, meaning "this point as seen through that copy"; its position is `copyMatrix(via) · toWorld(point + cell)`. The Pen joins lines by splitting the clicked segment (`insertNodeAt`) and sharing the node; a join to a clone copy is a via node. Dropping a dragged point on another point merges them (`mergePoints`). Via nodes are materialised as plain nodes when their copy disappears (`withViaRepair`).
- **Layers** (`doc.layers`, bottom to top) are `{ id, name }`. Paths and fills belong to one layer; within a layer fills draw below strokes. New paths and fills go to the active layer (`UI.activeLayerId`, persisted; falls back to the top layer). Region detection uses every path on every layer.
- **Elements** are the three primitive isometries: `translate {u, v}`, `mirror {u, v, du, dv}` (centre and lattice direction), `rotate {u, v, n}` (1/n turn). There is no glide kind: a glide is a group `[mirror, translate]`. The lattice is not an element.
- **Bindings** `{ pathId, groups: string[][] }` are ordered lists of groups. A group composes its elements left to right; its own clones are the powers of that composite up to the first lattice translation (cap 12, `open` past it). The binding's clones are the product across groups: `orbit()` in `src/engine/transform.ts` returns `matrices[i]` for clone index `i + 1` (mixed-radix over the groups, stable when a group is appended) or `null` for a clone that coincides with the source or a lower index modulo the lattice; truncated at `CLONE_CAP` (48). Every consumer skips nulls. `doc.newPathGroups` is the binding every new path receives; `O` / `M` / `T` append a one-element group to it and to the selected path's first binding.
- **Fills** are seed points with a `layerId`; `src/engine/regions.ts` builds a planar arrangement of every copy in the 3×3 window and each seed paints the face containing it (faces carry holes; even-odd rendering). Seeds are placed at the face centroid when it lies inside. A region is identified across its window copies by `sameRegion`.
- **Copies.** Everything on screen is a `Copy { cell, bindingId, power }` of a path with matrix `cellMatrix ∘ cloneMatrix`; `power` is the clone index. Selection carries the copy the user clicked; handles render there and edits map back through the copy's inverse. Dragging the body of any copy (original, repeat or clone) moves the original so the grabbed copy follows the pointer; the snap is measured at that copy (`bodyTargets(..., G)`) and joins happen at the pre-image. Elements move only by their own handles.

## Architecture

- `src/engine/*` is pure: takes a `Doc` (or a draft) and returns values. Matrices are `[a, b, c, d, e, f]` in SVG order; `compose(A, B)` applies B then A.
- `src/state/doc.ts` holds the committed document in a signal; `draft()` clones it. `src/state/history.ts` commits, records one entry per gesture (`beginGesture` / `endGesture`, `abortGesture` reverts), and undoes by reference. `src/state/derived.ts` has the computeds: clone matrices, visible cells, copies, anchors, and `faces` (recomputed on the next frame after a commit, never while a drag is set). `src/state/persist.ts` autosaves the document and prefs. `src/engine/serialize.ts` accepts document versions 1 and 2 and migrates v1 on load and import (`migrateV1`: one group per old chain; layers Structure / Fills / Detail).
- `src/actions.ts` holds every user-level mutation as `mutate(draft => ...)`. Chrome and tools call these.
- `src/interaction/pointer.ts` is one listener set on the SVG: hit-test geometrically (`src/engine/hit.ts`), dispatch to `src/interaction/tools/*` (`onDown/onMove/onUp`), two pointers = pan and pinch (a second finger reverts a drag), thresholds double for touch.
- `src/components/Canvas.tsx` renders the base cell once into `<defs>` as one `<g id="cell-layer-<id>">` per layer (that layer's faces, then its source and clone strokes) and places one `<use>` per layer per visible cell; overlays are drawn at the selected copy. `src/components/Chrome.tsx` is the floating chrome (group clusters with `+ then`, layer picker with `+ layer`).
- `src/engine/snap.ts` is pure snapping: `buildTargets` (tile corners and edges, mirror axes incl. those implied by stacked groups, rotation points, intersections, every node and line of every copy), `pickSnap` (one precedence list in `CONFIG.SNAP_PRECEDENCE`, points before lines, sticky holds), a stroke's own targets (`strokeCands`), a dragged node's own clones resolved to their axis or centre (`ownFixedCands`), body-drag meets (`snapBodyDelta`), scale fractions and handle guides. `snapTargets` in `derived.ts` caches the targets; drags take them at drag start. Targets always attract unless `⌘`/`Ctrl` is held (`ToolCtx.targetsOn`); `G` toggles only the grid (`prefs.grid`, `ToolCtx.gridOn`), the silent fallback that is never hinted. No hint, no snap (spec H7): a Pen click or Freehand start uses the snap behind the hover hint (`pressSnap` in `actions.ts`, `UI.snapShown`), a Freehand end and every Select drag use the last snap shown while moving; nothing re-picks on release.
- `src/engine/joins.ts` turns a snap into a node on release: share, split, via, or a new point; joins only within a layer.
- `src/strings.ts` holds every user-visible string.

## Shortcuts

`Tab` layer · `V` `P` `F` `B` tools · `O` `M` `T` add elements · `[` `]` rotate a mirror · `G` grid snap · hold `⌘`/`Ctrl` for a free point (no target snapping) · `⌥` while drawing traces a line · `Esc` cancels what is in progress, again clears and returns to Select · `Enter` end pen · `Space`+drag moves elements · `⌫` delete hovered point or selection · `⌘Z` / `⇧⌘Z` · `⌘0` fit · wheel pans, `⌘`+wheel zooms, two fingers pan and pinch. The `?` sheet in `Chrome.tsx` must stay in sync with `onKeyDown` in `pointer.ts`.

## Known limitations

- Clones are not composed across bindings (no group closure).
- Collinear overlapping edges that are not identical are not split against each other.
- Only the base cell's copies are hit-tested for segments in the visible cells; points are hit in the 3×3 window.
- Body drags apply grid steps to the original's movement, so under a rotation that doesn't line up with the lattice (e.g. 1/6 turn on a square lattice), the grabbed copy moves on a rotated grid.
- Layer rename, reorder, hide and lock are not in this chrome (Project 2).
- A traced stretch is fitted like the rest of the stroke, so on a curve it follows the line within the fitting tolerance rather than copying it exactly, and the fitted curve can kink where it peels off (spec D12, D13).
- Regions still read every path on every layer, fills are still seeds, and existing documents may share points across layers; the layers, regions and fills plan changes these.
- Touch has no toggle for tracing yet (⌥ only).
- A via node on a path selected through a clone copy is not drawn or hit.
