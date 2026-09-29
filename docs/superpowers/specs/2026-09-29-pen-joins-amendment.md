# Pen joins — amendment to the engine design

Amends `2026-09-27-engine-rebuild-design.md` (§3 data model, §6 Pen and Select, §9 invariants, §10 testing) after `2026-09-28-groups-and-layers-amendment.md`. Decided 2026-09-29 after a fish design whose tail was drawn "into" the body produced no regions: the tail's ends were 0.15 and 0.31 world units from the body curves, and region detection joins lines only where they cross or share a point exactly. Where this file and the earlier ones disagree, this file wins.

## 1. What changes and why

1. **The Pen joins lines by sharing points.** Clicking a line with the Pen inserts a real node into that line at the clicked spot and draws from it. Two curves that meet there pass through one shared vertex, so region detection needs no tolerance and later edits keep the join.
2. **Nodes can sit on a clone.** A fish tail always ends on a clone copy of the body. A node may now reference a point *through a copy* ("this point, as seen through binding b, clone k, in cell c"), so a join to a clone is exact too.
3. **Dropping a point on another point merges them.** Dragging a point already snaps to nearby points; releasing it on one now makes them the same point.

Not changed: region detection (no tolerance is added), the fill model, groups and layers.

## 2. Nodes through copies

```ts
type Node = { pointId: string; cell: Cell; via?: Copy };   // via: the copy this node is seen through
```

- A plain node's world position is `toWorld(point + cell)` as before. A node with `via` is at `copyMatrix(via) · toWorld(point + cell)`, where `copyMatrix` is the same `cellMatrix(via.cell) ∘ cloneMatrix(via.bindingId, via.power)` every rendered copy uses. `via.bindingId` is never null (a plain cell copy is expressed with `cell` alone).
- Control points stay relative to the previous node's `cell`; `via` does not affect them.
- Two nodes are the same node when `pointId`, `cell` and `via` (cell, binding, power) all agree. A path is closed when its last node is its start node in this sense.
- Shifting a path by a lattice vector (`orientToEnd`) shifts `via.cell` for a via node and `cell` for a plain node.
- **Materialisation.** When a via node's binding is removed, its element deleted, or its clone slot disappears after a group edit, the node becomes a plain node at a new free point placed at its last world position. Nothing on screen moves; the join is simply no longer live.
- Deleting the underlying point deletes the via node like any other reference to that point.
- Serialization: `via` is optional; when present it must name an existing binding, an integer `power ≥ 1` and a finite cell. A document with a `via` that fails this is refused. Documents without `via` are unchanged (version stays 2).

## 3. The Pen joins lines

Hit priority for the Pen becomes: points → clone anchors → **segments of any copy** → empty space.

- **Click a segment** (any copy, except a segment of the path in progress): split the *source* segment at the clicked spot and use the new node.
  - Straight segment: the click is mapped through the copy's inverse and projected onto the segment. Curved segment: the parameter `t` nearest the mapped click is found (32 samples, then Newton refinement on `(B(t) − p) · B′(t) = 0`), clamped to `[0.02, 0.98]`. No grid snapping: the node must lie on the line.
  - The split is exact: node `M = lerp(lerp(A, C, t), lerp(C, B, t), t)`, first half control point `lerp(A, C, t)`, second half `lerp(C, B, t)`; the outline does not change. A straight segment splits into two straight segments.
  - The new node is `{ pointId, cell }` when the clicked copy is the source or a neighbouring cell copy (cell = copy cell + the node's own cell), and `{ pointId, cell, via: copy }` when it is a clone copy.
  - With a path in progress the node is appended; otherwise a new path starts there with the default bindings.
- **Click a clone anchor:** append a via node for that anchor (the segment lands where the user clicked). This replaces "append the underlying point in its own cell".
- **Click empty space that snaps onto a clone anchor:** the same via node. Snapping onto a raw point copy still reuses that point.
- A segment of the path in progress is not a join target; the click falls through to the empty-space rule.

## 4. Dragging a point onto a point merges them

Releasing a point drag (the Select or Pen point drag) whose last snap landed on another raw point copy (not a clone anchor, not a copy of the dragged point itself) replaces the dragged point everywhere: every node that referenced it now references the target point, with its cell offset by the difference between the two copies, and the dragged point is deleted. A via node is never merged. The merge is part of the drag's single history entry.

## 5. Interaction details

- Via nodes render where they are, as nodes of their path (they are also, by construction, clone anchors of the host path).
- Dragging a via node moves the underlying point through the inverse of its copy, as clone-anchor drags do today. Marquee selection and bounding-box transforms act on the underlying points.
- The Pen's rubber line starts from the true world position of the last node, via or not.

## 6. Roadmap (not in this amendment)

**Attached nodes.** A node stored as "on segment j of path p at parameter t, through copy c" instead of a coordinate: the host stays one smooth segment, editing the host slides the node along it, and dragging the node slides rather than detaches. Region detection would split the host at t and share the vertex. It needs host-edit re-mapping (reverse, insert, delete), cycle prevention and a per-document position resolver. Decided 2026-09-29 to defer in favour of the split above; revisit when body curves are edited often after tails are drawn.

## 7. Testing

- `paths`: `insertNodeAt(t)` on a curved segment leaves the outline unchanged (sample the two halves against the original at ten parameters); `nearestT` on a quadratic; `mergePoints` rewrites every reference with cell offsets and deletes the point; `sameNode` and `isClosed` respect `via`; `orientToEnd` shifts `via.cell`; `materializeVia` converts a node and keeps its world position.
- `hit`: in Pen mode a click on a clone copy's segment reports `segment` with that copy; points still win over segments.
- `actions`: Pen click on a source segment inserts a shared node and starts a path from it; on a clone segment inserts a node in the source and starts a via node; clone-anchor click appends a via node; releasing a point drag on another point merges them; removing the binding materialises the via node at the same world position.
- `regions`: a fish built from actions (body with a glide binding, tail started on the body and ended on the body's clone) produces faces; a straight and a curved T-junction drawn through `penClickSegment` each split exactly (the square-plus-chord case gives 18 faces).
- `serialize`: a via node round-trips; a via naming a missing binding is refused.
