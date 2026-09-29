# Groups and layers — amendment to the engine design

Amends `2026-09-27-engine-rebuild-design.md` (§3 data model, §4 transforms, §5 persistence, §6 selection bar and construction, §7 rendering, §10 testing). Decided 2026-09-28 after trying the finished Project 1 engine on the fish design (`docs/examples/fish.json`). Where this file and the original disagree, this file wins.

## 1. What changes and why

1. **Bindings are lists of groups.** Today a binding composes its whole chain into one matrix and clones are that matrix's powers, so a third element folds into the same isometry instead of acting on the clones already made. The user wants to stack: a group of transforms makes clones, the next group applies to the source *and* those clones, and so on. That yields corner mirrors, kaleidoscopes and snowflakes from stacked mirrors and rotations.
2. **Layers are generic and ordered.** The fixed structure / fills / detail sandwich is replaced by an ordered list of layers. Paths and fills belong to layers. Fills can therefore sit on a layer above the lines, or below, per design.
3. **One binding per path by default,** and a new element stacks as a new group on it, so the user stops merging one-element chains by hand.

Not changed: elements (translate, mirror, rotate), lattice-as-modulus, copies, region detection, the fill model. Translation elements stay; their main use is the offset of a glide, since a pure sub-lattice translation is better expressed by shrinking the lattice.

## 2. Bindings with groups

```ts
type Binding = { id: string; pathId: string; groups: string[][] };   // ordered groups of ordered element ids
type Doc = { version: 2; …; newPathGroups: string[][] };            // the groups every new path's binding receives
```

**Semantics.**

- A **group** is an ordered composition of elements, applied left to right, exactly as a chain is today. Its **own clones** are the powers of that composite up to, but excluding, the first power that is a lattice translation, capped at `ORBIT_CAP` (12) with `open: true` past the cap. A mirror or glide group has one clone; a rotate-6 group has five.
- The binding's clones are the **product** of its groups. For groups `G1 … Gk` with own-clone counts `n1 … nk`, every tuple `(p1 … pk)` with `0 ≤ pi ≤ ni`, not all zero, is a clone with matrix `Gk^pk ∘ … ∘ G1^p1` (group 1 applied first). Group 2 therefore acts on the source and every clone of group 1, group 3 on all of those.
- **Index.** A clone's `power` (field name kept; meaning is now "clone index") is the mixed-radix number `p1 + (n1+1)·p2 + (n1+1)(n2+1)·p3 + …`. Appending a group never renumbers existing clones, so a future per-binding exclusion list ("hide clone 3") survives edits. Changing an earlier group's own-clone count does renumber; that is accepted.
- **Dedup.** A tuple whose matrix is itself a lattice translation is the source again and is dropped. Two tuples whose matrices differ only by a lattice translation are the same clone; the lower index is kept and the higher is dropped from the matrix list (its index is skipped, not reused).
- **Cap.** The product is truncated at `CLONE_CAP` (48) in index order and the binding reports `open: true`, shown with the existing warning glyph.
- An element appears **at most once per binding**. Clicking its chip in another group of the same binding moves it there.

`orbit(groups, elements, lattice)` returns `{ matrices: (Matrix | null)[]; open: boolean }` where `matrices[i]` is the clone with index `i + 1` or `null` for a deduplicated slot. Every consumer that iterates clones skips nulls (`derived.copies`, `hit`, `regions`, `serialize`, freehand ghosts). The one-group case reproduces today's table exactly.

Orbit sizes the tests pin down, in addition to the original table (which now describes one-group bindings):

| groups | clones |
|---|---|
| [mirror + translate ½ along it] | 1 |
| [mirror + translate ½], [mirror ⟂ the first] | 3 |
| [mirror along a], [mirror along b], [mirror along the diagonal], all through the cell centre, square lattice | 7 (the corner-mirror group of order 8) |
| [rotate 6], [mirror through the centre] | 11 |
| [mirror A], [mirror A] (same element twice is refused by the UI; if present, dedups) | 1 |
| [rotate 2], [rotate 2 about the same centre] | 1 (second group's clone coincides with the first, mod lattice) |
| [translate ½ along a], [translate ½ along b] | 3 |

**Defaults and construction.** `O`, `M`, `T` create the element and append it as a new one-element group to `newPathGroups`. If a path is selected, the element is also appended as a new group to that path's first binding (created if the path has none). "Apply to new paths" on an element toggles its one-element group in `newPathGroups`. A new path gets one binding with `newPathGroups` (empty groups list → no binding).

**Drags.** Dragging a clone copy's body moves the first element of the **first group that contributes to the dragged copy** (the first group with a nonzero power in the copy's clone index) by the existing inverse formulas. That is exact when the other contributing groups are translations and follows in the transformed frame otherwise. `Space`+drag while drawing moves the first element of the first group of each of the path's bindings.

**Migration (v1 → v2).** `ops` becomes `groups: [ops]`; `newPathOps: string[][]` becomes `newPathGroups`: each old chain is one group, in order. Deleting an element removes it from every group; a group left empty is removed; a binding left with no groups is removed.

## 3. Layers

```ts
type Layer = { id: string; name: string };
type Path = { …; layerId: string };
type Fill = { …; layerId: string };
type Doc = { version: 2; layers: Layer[]; … };   // bottom to top
```

- Layers are ordered bottom to top. Within a layer, **fills draw below strokes**, so lines on the same layer as their fills stay visible. To hide lines under colour, put the fills on a higher layer.
- New paths and fills go to the **active layer** (`activeLayerId`, a UI pref, persisted; falls back to the top layer if the id is gone).
- Copies inherit their source path's layer. Elements and the lattice are not on layers.
- **Region detection uses every path on every layer**, as today. A per-layer "defines regions" switch is deferred until it is needed.
- A new document has one layer, `Layer 1`. The demo document uses two.
- The `sublayer` UI pref and the Structure / Detail toggle are removed.

**UI (Project 1 scope).** On the Drawing layer the selection bar shows a layer picker: one chip per layer in order, the active one lit, and `+ layer`, which adds `Layer N` on top and makes it active. With a path or fill selected the bar also shows "Layer:" chips that move it. Rename, reorder, hide and lock stay in the Project 2 layers panel; the model already supports them.

**Rendering.** The base cell is rendered once into `<defs>` as one group per layer, `#cell-layer-<id>`, containing that layer's seeded faces then its source and clone strokes. Every visible cell draws one `<use>` per layer in order. SVG export emits the same groups, named by layer.

**Migration (v1 → v2).** Three layers preserve the old appearance exactly: `Structure` (paths with `layer: 'structure'`), `Fills` (every fill), `Detail` (paths with `layer: 'detail'`). Files with no fills still get all three so the mapping is predictable.

## 4. Persistence

`version: 2`. Import accepts v1 and v2; a v1 file is migrated on load and on import (one history entry as before). Validation covers `groups` (non-empty arrays of known element ids, no repeats within a binding), `layers` (non-empty, unique ids), and `layerId` references. Stored v1 documents in `localStorage` migrate on first load and are written back as v2.

## 5. Testing

- `transform`: the table in §2; the null-slot convention; `CLONE_CAP` truncation sets `open`.
- `paths`: element deletion prunes groups and bindings; move-between-groups; new path receives `newPathGroups`.
- `serialize`: the v1 fish document migrates to one-group bindings and three layers, round-trips as v2, and renders the same clone count; v2 with a bad `layerId` is refused.
- `regions`: a document with fills on a top layer produces the same faces as with fills on the bottom.
- Rendering: the defs contain one group per layer in document order; a fill on a lower layer than its lines is covered by them.

## 6. Non-goals (still)

- Group closure across generators (the true wallpaper group). Stacking is the model.
- Per-clone exclusions (the index scheme is designed for it).
- Tracing a face outline into a path, or a region picker that follows lines.
- Layer rename / reorder / hide / lock (Project 2 panel).
- Per-layer region participation.

## 7. Implementation order

1. Groups in the engine: types, `orbit` over groups with index and dedup, consumers skip nulls, migration, tests.
2. Groups in the chrome: chain row with group clusters, `+ then`, move-between-groups, new-element defaults, `newPathGroups` star.
3. Layers in the model and renderer: types, migration, defs per layer, export, active layer pref, tests.
4. Layers in the chrome: picker, `+ layer`, move chips; remove Structure / Detail.
5. Update `CLAUDE.md` and the original spec's §3 pointer to this amendment.
