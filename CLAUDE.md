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
- **Paths** are `{ start, segments: [{ to, cp }] }`. `cp` is a quadratic control point relative to the previous node's cell origin. Closed = last node is the start node in the same cell. `layer` is `structure` (below fills) or `detail` (above).
- **Elements** are the three primitive isometries: `translate {u, v}`, `mirror {u, v, du, dv}` (centre and lattice direction), `rotate {u, v, n}` (1/n turn). There is no glide kind: a glide is a chain `[mirror, translate]`. The lattice is not an element.
- **Bindings** `{ pathId, ops }` are ordered chains. Clones are never stored: `orbit()` in `src/engine/transform.ts` returns the powers of the chain's composite up to the first lattice translation (cap 12, `open` if it never closes). `doc.newPathOps` lists chains every new path receives.
- **Fills** are seed points; `src/engine/regions.ts` builds a planar arrangement of every copy in the 3×3 window and each seed paints the face containing it (faces carry holes; even-odd rendering). Seeds are placed at the face centroid when it lies inside.
- **Copies.** Everything on screen is a `Copy { cell, bindingId, power }` of a path with matrix `cellMatrix ∘ cloneMatrix`. Selection carries the copy the user clicked; handles render there and edits map back through the copy's inverse.

## Architecture

- `src/engine/*` is pure: takes a `Doc` (or a draft) and returns values. Matrices are `[a, b, c, d, e, f]` in SVG order; `compose(A, B)` applies B then A.
- `src/state/doc.ts` holds the committed document in a signal; `draft()` clones it. `src/state/history.ts` commits, records one entry per gesture (`beginGesture` / `endGesture`, `abortGesture` reverts), and undoes by reference. `src/state/derived.ts` has the computeds: clone matrices, visible cells, copies, anchors, and `faces` (recomputed on the next frame after a commit, never while a drag is set). `src/state/persist.ts` autosaves the document and prefs.
- `src/actions.ts` holds every user-level mutation as `mutate(draft => ...)`. Chrome and tools call these.
- `src/interaction/pointer.ts` is one listener set on the SVG: hit-test geometrically (`src/engine/hit.ts`), dispatch to `src/interaction/tools/*` (`onDown/onMove/onUp`), two pointers = pan and pinch (a second finger reverts a drag), thresholds double for touch.
- `src/components/Canvas.tsx` renders the base cell once into `<defs>` (`#cell-structure`, `#cell-fills`, `#cell-detail`) and places `<use>` per visible cell; overlays (halos, handles, points, elements) are drawn at the selected copy. `src/components/Chrome.tsx` is the floating chrome.

## Shortcuts

`Tab` layer · `V` `P` `F` `B` tools · `O` `M` `T` add elements · `[` `]` rotate a mirror · `G` snap · `Esc`/`Enter` end pen · `Space`+drag moves elements · `⌫` delete hovered point or selection · `⌘Z` / `⇧⌘Z` · `⌘0` fit · wheel pans, `⌘`+wheel zooms, two fingers pan and pinch. The `?` sheet in `Chrome.tsx` must stay in sync with `onKeyDown` in `pointer.ts`.

## Known limitations

- Clones are not composed across bindings (no group closure).
- Collinear overlapping edges that are not identical are not split against each other.
- Only the base cell's copies are hit-tested for segments in the visible cells; points are hit in the 3×3 window.
