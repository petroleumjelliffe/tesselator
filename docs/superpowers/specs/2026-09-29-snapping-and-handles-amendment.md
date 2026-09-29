# Snapping and handles — amendment to the engine design

Amends `2026-09-27-engine-rebuild-design.md` (§4 Snapping, §6 Select, §10 testing) after `2026-09-29-pen-joins-amendment.md`, which it builds on. Requested 2026-09-29: path drags, bounding-box scaling and control-point drags should snap to the things a tessellation is built from; an anchor drag should carry its control points rigidly; a filled region should be a handle for the path around it. Where this file and the earlier ones disagree, this file wins.

## 0. Decisions taken without the user (review these first)

1. **"Endpoints" means the two end nodes of an open path, and every node of a closed path.** A closed path has no ends, and its corners are what one wants on a tile corner.
2. **The new snaps follow the snap toggle.** `G` turns them off, `⇧` inverts for one gesture. The existing anchor snap on a single point drag is unchanged (it stays on regardless).
3. **Dropping a snapped end on another path joins them** (a shared point, or a split-and-share on a curve), exactly as the Pen join and the point-drop merge already do. Without this, an end that "touches" a curve only touches it to within floating point, and region detection does not close a face there: the fish bug again. Snaps onto the dragged path's own copies and onto cell corners move the path but do not join anything.
4. **"Endpoints of its lattice copies" cannot be a drag target.** Translating a path translates all its lattice copies (and translate-element clones) by the same amount, so the distance from an end to its own translated copy never changes during a drag. Only copies with a rotation or reflection in them move relative to the source. This is stated in §2 so the gap is visible, not silently dropped.
5. **Scale fractions are 1, ½ and ⅓ of each lattice vector's horizontal and vertical span**, measured against the path's node extent (control points excluded). The box handles are axis-aligned, so this is the reading that works on every preset, including skewed ones.
6. **Control points snap to horizontal and vertical lines through either end node of their segment** (0°, ±90°, 180° from the anchor), and to tangent lines from neighbouring segments. Where two such lines cross near the pointer, the crossing wins.
7. **A click in a filled region selects the path that bounds most of it**; a second click on the same region selects the fill, so fill deletion is still reachable. Pressing and dragging in the region drags the path. Fills enclosed by one copy of the dragged path travel with it.

## 1. What changes and why

1. **Path drags snap.** Dragging a path (by a segment or, new, by its filled interior) snaps its ends to cell corners, to other paths' nodes and curves (any copy), and to the ends of its own rotated or mirrored clones.
2. **Scaling snaps to lattice fractions,** so a motif scaled to ½ or ⅓ of a lattice span repeats exactly.
3. **Control points snap** to axis angles at either anchor and to tangency with neighbouring segments.
4. **Anchor drags carry control points rigidly.** Moving a node moves the control point of each segment that touches it by the same amount, not by half.
5. **Filled regions are handles** for selecting and dragging the path around them.

Not changed: region detection, the fill model, groups, layers, the single point drag's snapping.

## 2. Path-drag snapping

Applies to a Select-tool body drag of a source copy or a cell copy (`copy.bindingId === null`). A clone copy's body drag still moves elements (§6 of the engine design) and does not snap this way.

**Notation.** `S` is the selected copy's world matrix and `S_L` its linear part. The raw pointer delta `Δ` gives a raw source delta `δ₀ = S_L⁻¹ Δ` (world units, source frame). A moving node `i` with source world position `pᵢ` is on screen at `Eᵢ(δ) = S(pᵢ) + S_L δ`. All copy matrices are isometries, so `|Eᵢ(δ) − Eᵢ(δ₀)| = |δ − δ₀|`, and every distance below is a world distance compared with the usual threshold `SNAP_PX · hitScale / zoom`.

**Moving nodes.** The path's end nodes if it is open, all its nodes if it is closed. Via nodes are never moving nodes (their world position is tied to another path's copy).

**Targets.**

| Class | Target | Snapped δ |
| --- | --- | --- |
| point | A lattice point in the 3×3 window (every cell corner, `u, v ∈ {−1 … 2}`) | `S_L⁻¹ (T − S(pᵢ))` |
| point | A node of another path, any copy in the window (every entry of `anchorsWorld` whose point is not on the dragged path) | same |
| point | An end of the dragged path's own copy `K` where `K_L − S_L` has full rank (a rotation relative to `S`) | the unique solution of `(S_L − K_L) δ = K(pⱼ) − S(pᵢ)` |
| line | The same, where `K_L − S_L` has rank 1 (a reflection or glide relative to `S`) and the system is solvable | the solution line; the snapped δ is the projection of `δ₀` on it |
| curve | A segment of another path, any copy in the window | the nearest point `T` on the segment to `Eᵢ(δ₀)` (the existing `nearestT`, clamped to `[0.02, 0.98]`; the ends are node targets), then as for a point |

Copies with `K_L = S_L` (cell copies and translate-only clones) are skipped: they move in lockstep with the source (decision 4). Pairs `(i, j)` range over every moving node and every node of the copy, so a rotation clone's end can meet the source's other end.

**Choice.** The nearest point-class candidate within the threshold wins. Otherwise the nearest line- or curve-class candidate within the threshold wins. Otherwise, with snapping on, the delta is grid-snapped as today; with snapping off, `δ₀` is used.

**Feedback.** While a snap holds, `UI.snapHint` carries the snapped world position and its class; the canvas draws a ring there (and, for a line snap, the line). It is cleared when the drag ends.

**Join on release.** When the drag ends on a snap, the join depends on what was hit:

| Snapped onto | On release |
| --- | --- |
| a cell corner, or the dragged path's own copy | nothing more (the positions coincide exactly) |
| a node of another path, raw copy | the dragged node's point is merged into that point (`mergePoints`, as for a point drop). Snapping runs in the source frame, since a cell copy is a pure translation of the source, so the target cell is the target copy's cell plus its node's cell |
| a node of another path, clone copy | every node referencing the dragged point becomes a via node onto that point through that clone (`mergeIntoNode`, §7) |
| a curve of another path, raw copy | that segment is split at `t` (`insertNodeAt`), then merged as for a raw node |
| a curve of another path, clone copy | the source segment is split at `t`, then the dragged node becomes a via node onto the new point through that clone |

The join is part of the drag's single history entry. It is skipped (the move stays, nothing is merged) when a via node anywhere references the dragged point, since a via onto a via is not representable.

## 3. Scale snapping

Applies to the bounding-box scale handles (not the rotate knob, which keeps its 15° snap).

- **Measured extent.** The path's nodes at the selected copy, in world: width `Wₙ` and height `Hₙ`. Control points are excluded so the measure is where the curve meets its neighbours. An axis whose extent is under 1e-6 is not snapped.
- **Targets.** Widths `f · |aₓ|` and `f · |bₓ|`; heights `f · |a_y|` and `f · |b_y|`; for `f ∈ {1, ½, ⅓}` (config `SCALE_FRACTIONS`). A span under 1 world unit is ignored (every preset has `a_y = 0`).
- **Edge handle.** The candidate factor is `±target / Wₙ` (the sign of the raw factor is kept, so a flip still works). It is taken when the handle would move by at most the threshold: `|s_raw − s_t| · |h − anchor| ≤ threshold`, measured along the handle's axis.
- **Corner handle, uniform.** Candidates come from both axes' targets; the nearest one within the threshold (measured along the diagonal) sets the one factor.
- **Corner handle, free** (`⇧` or the Free toggle). Each axis snaps independently as an edge handle would.
- **Toggle.** `⇧` already means "free" on a corner handle, so here it does not invert snapping; only the snap setting (`G`) turns scale snapping off.
- **Feedback.** `UI.snapHint` carries the snapped handle position; the canvas marks it.

## 4. Control-point snapping

Applies to a diamond drag (filled or hollow) at the selected copy. All geometry is in world at that copy and mapped back through its inverse, as every edit is.

**Candidate lines** for segment `j` with end nodes `A` and `B`:

- **Axis lines.** The horizontal and vertical lines through `A` and through `B` (the handle at 0°, ±90° or 180° from either anchor).
- **Tangent lines.** For each end `X ∈ {A, B}`, every other segment of any path, in any copy in the 3×3 window, with an end within 1e-4 world units of `X`: the line through `X` and that segment's control point (or its other end, if it is straight). Making the control point collinear with it makes the join smooth.
- **Mirror normals.** For each own copy `K ≠ S` of this path whose relative map `T = K ∘ S⁻¹` is a reflection that fixes `X`: the line through `X` along the mirror's normal. A curve crossing its own mirror line is smooth there only when it crosses at right angles. (A half-turn about `X` is always smooth and adds nothing.)

**Choice.** Lines within the threshold of the pointer are collected. If two of them cross within the threshold of the pointer, the nearest crossing wins. Otherwise the pointer is projected onto the nearest line. Otherwise it is used as is. Snapping off turns all of this off.

**Feedback.** `UI.snapHint` carries the snapped position and the line or lines used; the canvas draws them as guides.

## 5. Anchor drags carry control points

`shiftControlPoints` moves the control point of every segment with at least one moved end by the full delta, once. This replaces "shift adjacent control points by half per moved endpoint".

- A single point drag (Select point, Pen point, clone anchor) moves both neighbouring control points rigidly with the node: the handles keep their length and angle at that node.
- A segment whose ends both move (body drag, multi-point drag) moves its control point once, as before.
- Consequence to accept: a quadratic segment has one control point shared by its two ends, so the far end's tangent turns when the near end moves. Straight segments stay straight.

## 6. Filled regions select and drag their path

- **Owner.** For a face, group its outer-loop pieces by `(pathId, copy)` and sum their lengths; the owner is the group with the largest total (ties: the path later in `doc.paths`). The face was found at the click mapped into the base cell, so the owner's `copy.cell` is shifted by the clicked cell to name the copy under the pointer.
- **Hit target.** The Select tool's fill target becomes `{ kind: 'fill'; fillId; owner: { pathId; copy } | null }`. Priority is unchanged (segments beat fills).
- **Click** (no drag): if the owner is already selected at that copy, select the fill; otherwise select the owner at that copy. A face with no owner selects the fill as today.
- **Press and drag:** a body drag of the owner at that copy, identical to dragging one of its segments (so §2 applies to a source or cell copy, and a clone copy moves its element).
- **Fills travel with the path.** When a body drag of a source or cell copy starts, every fill whose face's outer loop comes entirely from one copy `K` of the dragged path is recorded with its starting seed. During the drag its seed is `seedOf(seed₀ + K_L · δ)`, mapped back into the base cell. Faces are not recomputed during a drag, so the lookup uses the faces at drag start. Fills bounded by several paths stay where they are.

## 7. Engine additions

- `src/engine/snap.ts` (pure): `solveCopyMeet`, `snapBodyDelta`, `snapScale`, `snapControlPoint`, `faceOwner`, `enclosedFills`. Each takes a `Doc` plus explicit inputs and returns values; tools gather the inputs and apply the result.
- `mergeIntoNode(doc, fromId, fromCell, target: Node)` in `paths.ts`: `mergePoints` when `target` has no via; otherwise every plain node referencing `fromId` in cell `c` becomes `{ pointId: target.pointId, cell: target.cell, via: { ...target.via, cell: target.via.cell + (c − fromCell) } }`, with `mergePoints`' zero-length and control-point re-basing rules, and `fromId` is deleted.
- `UI.snapHint: { at: XY; kind: 'point' | 'line' | 'curve' | 'scale' | 'cp'; lines?: [XY, XY][] } | null`.
- `CONFIG.SCALE_FRACTIONS = [1, 1/2, 1/3]`.

## 8. Not in this amendment

- Curve and corner targets for single point drags and multi-point drags (the snap functions are reusable; wiring them is a follow-up).
- Snapping a clone copy's body drag (it moves elements).
- Tangent continuity across a path's own lattice wrap (a segment meeting its own translated copy); smoothness there needs the adjacent segment's control point, which §4 already offers when it exists.
- Selecting an unfilled region.

## 9. Testing

- `paths`: a single `movePoint` shifts both neighbouring control points by the full delta; `movePointsBy` over both ends shifts once; `mergeIntoNode` with a via target rewrites references with shifted `via.cell` and keeps world positions.
- `snap`: `solveCopyMeet` returns a point for a quarter-turn, a line for a mirror (end onto the mirror line), `null` for a lattice copy; `snapBodyDelta` prefers a corner over a curve at equal distance, snaps an end onto a curve of a neighbouring cell copy, falls back to the grid; `snapScale` lands a width on `|a|/2` and `|a|/3` and ignores a zero-height path; `snapControlPoint` lands on a horizontal through an anchor, on a sibling's tangent line, on a mirror normal, and on the crossing of two lines; `faceOwner` picks the dominant path and shifts the cell; `enclosedFills` excludes a fill bounded by two paths.
- `actions`: a body drag released on another path's curve splits it and shares the point, and one undo reverts both the move and the join; released on a clone's curve produces a via node; a fill inside a dragged closed path moves with it; clicking a filled region selects the path, clicking again selects the fill.
