# Interaction specification — drawing, selection, editing, snapping, fills

Status: decisions recorded 2026-09-30 and amended through 2026-10-04 (dated inline). The snapping-and-drawing plan, the 2026-10-01 feedback round and the marquee-and-transforms plan (S8, S10, E5b, E6, E6a, E6b, T13, H10) are built; the rest is ready for planning. Organises every interaction requirement by entity, state and behaviour, and checks them against a use-case list. It consolidates the interaction parts of the engine design (`2026-09-27-engine-rebuild-design.md` §4 Hit-testing, Snapping and Regions, §6), the pen-joins amendment (`2026-09-29-pen-joins-amendment.md`) and the snapping-and-handles amendment (`2026-09-29-snapping-and-handles-amendment.md`), and the user's interaction notes and answers of 2026-09-30. The amendments keep their rationale and maths; where this file and they disagree, this file wins.

**Status tags** on every requirement:

- **built** — in the app on `main` (deployed to GitHub Pages).
- **specced** — in an earlier amendment, not built yet.
- **new** — decided, not built yet (date given where later than 2026-09-30).
- **change** — decided, not built yet, and replaces built behaviour.
- **open** — needs a decision; the row says what is undecided.

Decisions are listed in §11 with the question each one answers. The roadmap (§12) holds what was deliberately deferred. The playground (`/playground.html`, §13) exists to tune the snapping rules by feel.

---

## 1. Vocabulary and strings

| UI word | Meaning | Code word |
|---|---|---|
| **Tile** | The base cell: the parallelogram spanned by lattice vectors a and b (the "center area"). | base cell, `cell {0,0}` |
| **Repeat** | A lattice-translated copy of anything, in a neighbouring tile. | cell copy |
| **Clone** | A symmetry copy made by transform groups (mirror, rotation, glide…), in any tile. | clone copy |
| **Original** | The path as stored, in the tile. | source copy |
| **Instance** | Any drawn copy of a path: original, repeat or clone. | `Copy` |
| **Path** | An open or closed chain of segments, on one layer. | `Path` |
| **Endpoint** | The first or last node of an open path. | |
| **Node** | Any vertex of a path, endpoints included ("anchor point"). | `Node` |
| **Handle** | The control point of a curved segment (◇). | `cp`, diamond |
| **Box handle** | A bounding-box scale handle; rotation is just outside a corner (E6a). | bbox handle |
| **Symmetry element** | Mirror axis, rotation point, translation. | `Element` |
| **Transform group** | An ordered set of elements composed into one transform; groups stack ("then"). | group, binding |
| **Region** | A closed area enclosed by visible lines (§7). | face |
| **Fill shape** | A coloured shape made by the Fill tool from a region's outline (§7). | new entity |
| **Placement node** | The marker showing where a drawing click would put its point (H9). | |

**V1 (new).** Every user-visible string (hints, labels, help, panel text) lives in one table of keys, so a word can be renamed in one place as the vocabulary settles. Plain module of constants; no library.

---

## 2. Ownership

**O1 (change).** Every point, path and fill shape belongs to exactly one layer. Two layers never share a point.

**O2 (change).** Snapping onto anything on another layer copies its location only: no merge, no split, no via node across layers. Joins and splits happen only within a layer.

**O3 (change).** On load, a point referenced by paths on more than one layer is duplicated so each layer has its own copy (positions unchanged).

Linking copied locations across layers so they move together is on the roadmap (§12).

---

## 3. Entities

"Point target" means a stroke end, click or dragged node can land exactly on it. "Line target" means it can land anywhere along it, at the spot nearest the pointer (§6).

| Entity | Visible | Selectable | Draggable | Snap target | Status |
|---|---|---|---|---|---|
| Tile corner | frame | no | no | point | new |
| Tile edge | frame | no | no | line | new |
| Mirror axis | Construction; dimmed on Drawing | Construction | Construction | line | new as a target |
| Mirror axis implied by stacked groups (e.g. the six axes of a snowflake made from one rotation and one mirror) | not drawn | no | no | line | new |
| Rotation point (an element) | Construction; dimmed on Drawing | Construction | Construction | point | new as a target |
| Intersection of two target lines (axis × axis, axis × edge, path × axis, path × edge) | not drawn | no | no | point | new |
| Grid point | `G` on | no | no | point (fallback); filters lines (SN2a) | built; filter new |
| Path, any instance | yes | yes | node, body, box | line | built; targets new |
| Node / endpoint, any instance | selected instance(s); otherwise paths near the cursor, in Select as while drawing (S2, H8) | yes | yes | point | built |
| Handle | selected instance | no | yes | — | built |
| Box handle | single selected instance | no | yes | — | built |
| In-progress stroke, original | while drawing | no | — | line | built |
| In-progress stroke, clones and repeats | while drawing (ghosts) | no | — | start: point; body: line | built |
| Placement node and cursor ghosts | drawing tool armed (H9, D15) | no | — | — | new |
| Region | Fill tool hover | no | no | — | change (§7) |
| Fill shape | yes | yes | no (later: nodes) | — | change (§7) |

Rotation centres that a pattern implies without an element (the extra 2-fold centres of a half-turn tile) are **not** targets. Where mirror axes cross, the intersection target already covers kaleidoscope centres.

---

## 4. States

### 4.1 Mode and tool

| State | Values | Status |
|---|---|---|
| Layer mode | Drawing · Construction (`Tab`) | built |
| Tool | Select `V` · Pen `P` · Freehand `F` · Fill `B` | built |
| Grid snap | on · off (`G`); silent when moving, shown by the placement node when drawing (H9) | built; decided 2026-10-01, amended 2026-10-02 |
| Target snap | always on; hold `⌘` / `Ctrl` to turn it off for one gesture | built 2026-10-01 (was: `G` turned targets off) |

Pen, Freehand and (later) Shape tools share one rule set for nodes, snapping and commit (§5, §6).

### 4.2 Selection

| State | Contents | Status |
|---|---|---|
| Nothing | — | built |
| Instances | one or more (path, instance) pairs: originals, repeats, clones; by click, `⇧`-click (S4) or marquee (S8) | built |
| Nodes | one or more (node, instance it was picked through) | built |
| Element | one symmetry element | built |
| Fill shape | one | change (was a seed) |

### 4.3 Gesture

| State | Entered by | Left by | Status |
|---|---|---|---|
| Idle / hover | — | press | built |
| Pressing | pointer down | move past 3 px (drag) or up (click) | built |
| Stroke (Freehand) | press | release; `Esc` discards | built |
| Stroke, pinned | §6.6 | breakaway, `⌥` up, or release | built |
| Path in progress (Pen) | first click | `Esc`, `Enter`, last point, start point | built |
| Drag (nodes, handle, box, body, several paths, element) | press and move | release; `Esc` cancels and restores | built |
| Marquee | press on empty space in Select and move | release | built |
| Two-pointer navigation | second pointer | both up | built |

**K1 (built). `Esc` is two-stage.** First press cancels the gesture or ends the path in progress. Second press clears the selection and switches to Select.

---

## 5. Drawing

| ID | Requirement | Status |
|---|---|---|
| D1 | Press, drag, release draws a stroke, simplified and fitted on release. | built |
| D2 | The stroke's clones and repeats are drawn live as ghosts. | built |
| D3 | The start snaps to the drawing targets (§6.3). | built |
| D4 | The end snaps to the drawing targets plus the stroke itself, its start, and its own clones and repeats (§6.3). | built |
| D5 | Starting on an open endpoint of a path on the active layer extends that path. | built |
| D6 | Starting or ending on a line of a path on the active layer splits that line and shares the node (as the Pen does). On another layer: location only (O2). | built |
| D7 | Ending on the stroke's own line splits it there and shares the node: a loop with a tail. (A stroke that crosses itself already forms a loop with two danglers, because regions split at crossings; ending *on* the line needs the exact split.) | built |
| D8 | Ending on its own clone's start or line is a location snap only. The original is never split. The snap is made against the **fitted** stroke's clone, not the raw ghost, so the end lies on the final clone. | built |
| D9 | A path that starts or ends on a mirror axis or rotation point stays a separate path from its clone; they meet exactly. | built |
| D10 | Ending on the opposite tile edge at the repeat of the stroke's own start continues the line seamlessly into its repeat (edge wrap). | built |
| D11 | Several unconnected strokes can be drawn in a row; nothing joins unless a snap lands. | built |
| D12 | **Tracing.** While `⌥` is held, the stroke can follow a visible line on any layer, peel off, and rejoin, and still produce one path (§6.6). The followed stretch copies that exact part of the curve. The copy is not linked to the line it came from. | built, except the exact copy: the traced stretch is fitted like the rest of the stroke |
| D13 | Where a stroke peels off or rejoins a traced line, the fitted curve has no kink (tangent-continuous). | new (not built) |
| D14 | Pen clicks use the same targets and commit rules as Freehand ends. | built |
| D15 | **Cursor ghosts.** While Pen or Freehand is armed and the pointer is on the canvas, a ghost of the placement node (H9) shows in every clone of the applicable transform groups: while drawing, the drawn path's groups; otherwise the groups new paths receive (decided 2026-10-04); none if there are none. Base tile only, not repeats. Always on; no toggle for now. | new |

**The tracing workflow (UC-D16).** Sketch a bird's body as one loose line on a layer. On another layer, draw the wings as one fluid outline: follow the body for a stretch, peel off into the wing, rejoin. Hide the sketch layer. The wing outline stands on its own. The sketch is dimmed by giving it a light colour and thin weight; there is no special reference-layer concept.

---

## 6. Snapping

### 6.1 Targets

| Code | Target | Kind | Status |
|---|---|---|---|
| T1 | Tile corners (lattice points in the 3×3 window) | point | built |
| T2 | Tile edges | line | built |
| T3 | Mirror axes: elements, and axes implied by stacked groups | line | built |
| T4 | Rotation points of elements | point | built |
| T5 | Intersections of target lines | point | built |
| T6 | Nodes and endpoints of visible paths, every instance | point | built (anchors) |
| T7 | Lines of visible paths, every instance | line | built |
| T8 | The stroke's own line, minus a tail behind the pen tip | line | built |
| T9 | The stroke's own start, once the stroke is long enough | point | built |
| T10 | The stroke's own clones and repeats: their start and line | point / line | built |
| T11 | Grid | point (fallback); filters line targets while `G` is on (SN2a) | built; filter new |
| T12 | Handle guides: axis lines through the anchors, tangents, mirror normals | line | built |
| T13 | Size fractions: k/n of the tile's width and height, n ≤ `CONFIG.FRACTION_MAX_N` (4 for now; may later grow with zoom). Silent (§6.5). | value | built (was: hinted scale fractions) |

Hidden paths and paths on hidden layers are never targets (with layer hiding, §12).

Targets exist only within the 3×3 window around the tile; body drags of repeats and clones are reduced to it. Drawing and node drags further out get fewer targets (roadmap).

### 6.2 Choice

- **SN1.** Candidates are the targets within the threshold, `SNAP_PX × hitScale / zoom` (doubled for touch), measured from the **raw** pointer, never from a previously snapped position.
- **SN2. Precedence** is one ordered list in config, easy to reorder. Default points: intersection → node → the stroke's own start → own-clone fixed set (SN3) → own clone → own repeat → rotation point → tile corner → grid. Lines: own-clone axis (SN3) → mirror axis → tile edge → path line → own line → own clone → own repeat. A point within range beats a line within range; within a class the nearest wins, ties by the list.
- **SN2a. The grid filters lines** (decided 2026-10-02): while `G` is on, a line target (tile edge, axis, path line, a stroke's own line or its clones' lines, handle guides) snaps only where it crosses a grid line. For a tile edge or a lattice-aligned axis these are exactly its grid points; a curve or diagonal axis snaps at its grid-line crossings, so the point stays exactly on the line. Point targets (nodes, corners, centres, intersections, own start, clone meets) are never filtered. Plain grid points remain the fallback when nothing else holds. With `G` off, lines snap continuously. `⌘` / `Ctrl` frees everything. This applies in every gesture (drawing, moving, editing); only the hinting differs (H9).
- **SN3. Own clones are solved, not chased.** During a node or body drag, the dragged node's own clones move with it, so they are not targets as positions. Instead, each own clone whose relative transform has a fixed set becomes that set: a mirror clone becomes its axis ("meets its mirror clone"), a rotated clone its centre ("meets its rotated clone"). Translations and glides have no fixed set and add nothing. This stops the clone and the axis from competing, and stops the snap from chasing a target that moves with it. (Drawing is unaffected: the stroke's own clones' starts are fixed once the stroke starts.)
  - **SN3a. Ends meet each other's clones.** In a body drag, the other ends' clones move with the path too, so they are solved the same way. Each moving end is paired with every clone of every other moving end ("meets its clone's end"). A rotated clone gives one spot. A mirror gives a line of spots, but only when the two ends already line up along the axis; a glide only when their offset along the axis equals the glide's. Otherwise moving the path can never make them meet, so no hint appears. Translations add nothing. In a node drag the other ends stay still, so their clones are ordinary node targets (T6).
- **SN4. Stickiness.** A snap that holds stays until the pointer is 1.5× the threshold from it, or until a candidate earlier in the precedence list comes within the threshold, or until a same-class candidate is nearer by more than half the threshold.
- **SN5.** Duplicate candidates at the same spot are reported once, with the highest-precedence label. Nodes of different points at the same spot are all kept; among them the one that a release would join on the drawing layer wins (built 2026-10-01).

### 6.3 Which targets apply to which gesture

| Gesture | Targets |
|---|---|
| Freehand start, Pen click with no path in progress | T1–T7, T11 |
| Freehand end, Pen click on a path in progress | T1–T11 |
| Freehand mid-stroke | only while pinned (§6.6) |
| Node drag (one) | T1–T7 and SN3, T11 |
| Nodes drag (several) | the grabbed node, as one node drag |
| Body drag (any instance, E5a) | each endpoint (every node of a closed path) as a node drag, measured at the grabbed instance; the nearest snap moves the whole path |
| Several paths dragged (E5b) | the grabbed instance only, as a body drag |
| Box scale | T13 (silent); hints also show on the selection's endpoints when they land on T1–T7 |
| Translation element resize (construction) | T13 on its u and v components, silent |
| Box rotate | angle steps (§6.5), shown by the rotation hint (E6a) |
| Handle drag | T12 |
| Element drag (construction: mirror, rotation point, translation move) | element centre snaps silently to nodes and the grid; mirror angle steps with `[` `]` | built; open: whether element moves should use the full target set with hints |
| Any gesture with `⌘` / `Ctrl` held | grid only (if `G` on), size fractions off | built |

### 6.4 Commit (what a snap does on release)

| Landed on | Same layer | Other layer |
|---|---|---|
| Tile corner, edge, grid, axis, rotation point, intersection | location | location |
| Node of an original or repeat | merge (share the point) | location |
| Node of a clone | via node | location |
| Line of an original or repeat | split it, share the node | location |
| Line of a clone | split the original, via node | location |
| The stroke's own line | split it, share the node (D7) | — |
| The stroke's own clone or repeat | location (D8, D10) | — |
| A node of the Pen path in progress | ends the path there (close or loop) | — |
| Nothing (no hint showing, H7) | raw point, or grid point while `G` is on | — |

Status: built for Pen, Freehand and Select drags (2026-10-01). A dragged clone instance joins at the pre-image in the original's frame, else location only.

### 6.5 Toggles

- **Grid** (decided 2026-10-01): `G` turns grid snapping on and off. It filters line targets to their grid-line crossings (SN2a, 2026-10-02) and is the fallback when no target is near. It is never hinted while moving or editing; while drawing, the placement node (H9) shows the grid point a click would use (amended 2026-10-02).
- **Targets** (decided 2026-10-01): snapping to every target in §6.1 (T1–T10, T12–T13) is always on. Holding `⌘` / `Ctrl` turns it off for that gesture, existing points included, for a fully free placement. The grid still applies while `G` is on. There is no target toggle for now. The canvas suppresses the context menu so `Ctrl`-click works on a Mac.
- Silent step quantisation (15° rotation steps, lattice handle steps) counts as grid: it follows `G`, and `⌘` / `Ctrl` does not free it (recorded 2026-10-01).
- **Size fractions** (decided 2026-10-02): resizing a translation element and resizing the selection box snap silently to k/n of the tile's width and height (T13), n ≤ 4. They are always on, have no toggle, ignore `G`, and holding `⌘` / `Ctrl` turns them off. They replace the twelfths step for translations and the hinted scale fractions. H7 does not apply to them (like the grid, they are never hinted).
- Box scale modifiers (decided 2026-10-02): `⇧` keeps proportions, `⌥` scales from the box centre; they combine. `⌘` / `Ctrl` frees the size fractions (T13). `⇧` still adds to the selection on click.

### 6.6 Pinned movement (tracing)

- **Trigger.** Explicit: only while `⌥` is held (decided 2026-09-30 after the playground showed that pinning on a line start made ordinary strokes follow lines). Without it the stroke always follows the pointer, and snapping applies only to the start and, on release, the end. Touch needs a chrome toggle in place of `⌥`. Holding `⌥` is itself the request, so tracing works whether snapping is on or off (`G`, `⌘`/`Ctrl`). The playground keeps the other triggers to compare.
- **Follow.** While pinned, stroke points are the pointer projected onto the line.
- **Breakaway.** The pin releases when the pointer is more than the breakaway distance (default 24 px) from the line. The same line cannot re-pin until the pointer has been twice that distance away.
- **Result.** One path. The followed stretch is an exact copy of that part of the line (D12), joined without a kink (D13). The line followed is never split or joined (it is a guide, on any layer).
- **Release while pinned.** The end lands on the followed line at the pointer's projection; a node or intersection on that line still wins by precedence (built 2026-10-01).

---

## 7. Regions and fills

| ID | Requirement | Status |
|---|---|---|
| R1 | Regions are computed from **visible** stroked paths on the **active layer and the layers below it**. Hidden paths, hidden layers and layers above are ignored. Fill shapes never bound regions. | change (was: every path on every layer) |
| R2 | Nothing is filled automatically. A region gets colour only from a Fill-tool click. | built; restated |
| R3 | The Fill tool highlights the region under the pointer, on hover and while pressed. | built |
| R4 | A Fill click copies the region's outline (outer boundary and holes, exact curve pieces) into a new **fill shape** on the active layer, with the fill colour. Its points belong to that layer (O1). | change (was: a live seed) |
| R5 | A fill shape persists: later edits, moves or visibility changes of the paths below never change it. Refill to update. | change |
| R6 | A fill shape repeats by the lattice only, not through clones. Fill each mirrored region separately (this leaves room for alternating colours). | new |
| R7 | Unfilled regions are transparent to clicks in Select. A fill shape is an ordinary object: select, recolour, delete. Clicking it selects the fill shape. | change (was: a click in a region selects its owner path, specced) |
| R8 | Saved documents with seed fills are converted to fill shapes once on load (outline of the region the seed paints at load time). | change |
| R9 | A fill shape has a repeat pattern (decided 2026-10-02): **every tile** (default), **rows** (alternate by tile row), **columns** (alternate by tile column) or **checkered** (alternate where c + r is odd). The tile itself (c = r = 0) always gets the first colour. A patterned fill has two colours; the second colours the tiles the pattern skips, or is "none" to leave them unfilled. The Fill tool's chrome sets the pattern and second colour for the next fill; a selected fill shape shows the same controls and can be changed. Alternation by transform (colour-swapping groups) is on the roadmap. | new |
| R10 | **Near-miss gaps** (open, proposed 2026-10-02): line ends that stop within a small distance (about 2 px at 100%) of another end or a line are treated as touching when regions are computed, without changing the drawing; and loose ends near something are marked while the Fill tool is active. Undecided: whether to do either, and the distance. | open |

---

## 8. Selection and editing

| ID | Requirement | Status |
|---|---|---|
| S1 | Click a line of any instance selects the path at that instance. | built |
| S2 | Nodes show on the selected instance(s), not on every instance. In Select, an unselected path's nodes (raw nodes and clone anchors alike) are hinted while the cursor is near the path, by the same reveal as while drawing (H8), so a node can be clicked, `⇧`-clicked, dragged or deleted without selecting its path first (decided 2026-10-06). | built |
| S3 | `⇧`-click adds or removes a node, on any instance: a hinted node of an unselected path, or a clone's node, which is picked through that clone (S5). A plain click on a clone's node selects that point through the clone. | built |
| S4 | `⇧`-click adds or removes an instance (original, repeat or clone). Delete removes the selected instances' whole paths; per-clone actions wait for the roadmap. `⌫` with a node hovered (on any instance, a clone's node included) deletes that node, not the selection (2026-10-06). | built; open: one selected clone + Delete removes only that clone's binding, but several selected instances delete whole paths — make these consistent? |
| S5 | Marquee selects nodes of every visible instance inside it; a node picked through a clone moves through that clone's inverse. | built; S8 decides between nodes and whole instances |
| S6 | Where a node and a box handle coincide, the node wins. | built |
| S7 | With several paths selected (S4), the transform-group panel edits all of them at once (decided 2026-10-02). It shows the groups they share; where they differ, an element shows as mixed. Every change (add or remove an element in group N, add a `+ then` group, remove a group) is applied to each selected path's binding, one undo for the whole change. A path without a binding gets one. Selecting several instances of the same path edits that path once. | open: whether a change applies step by step to each path or copies one path's whole set of groups (2026-10-04: the user will try both before deciding; not in the next build) |
| S8 | A marquee that contains **every node of a path instance** selects that instance as a path, not its nodes (decided 2026-10-02). If it contains several whole instances, they become a several-paths selection (S4, S7). If the marquee contains no whole instance, it selects nodes as before (S5). If it contains some whole instances and some partial ones, it selects the whole instances only. Holding `⌥` while releasing the marquee always selects nodes. | built |
| S9 | Pressing a hinted node of an unselected path drags that node (revised 2026-10-06; until then its nodes were hidden and the press dragged the whole path). Pressing the line still drags the path. | built |
| S10 | With several paths selected, nodes show on every selected instance, and there is no bounding box; scaling and rotating several paths at once is on the roadmap. | built |
| E1 | Drag a node; all instances follow. | built |
| E2 | Drag selected nodes as a unit. | built |
| E3 | Handles move rigidly with a dragged node. | built |
| E4 | Dragging a node of the selected path pulls it off a shared point. | built |
| E5 | Drag a path's body; its endpoints snap as they move (§6.3) and join on release (§6.4). | built |
| E5a | Dragging the body of a clone or repeat moves the **original** path so the grabbed copy follows the pointer; transforms never move (decided 2026-10-01: moving the transform broke rational placement and multiplied copies). Snapping is measured at the grabbed copy. Transforms move only by their own handles. | built 2026-10-01 (change; was: moved the transform) |
| E5b | With several paths selected (S4, S8), pressing on any selected instance and dragging moves the **whole selection** (decided 2026-10-02). Each selected instance moves by the same on-screen delta: its original moves through that instance's frame (E5a). A path moves once (decided 2026-10-05): if its original (or a repeat) is selected, the original moves by the pointer's delta and its clones follow their transforms, even when a clone is the one grabbed; if only clones of it are selected, the grabbed clone (else the first selected clone) follows the pointer and the original moves by the matching transformed amount. Snapping is measured at the grabbed instance only (§6.3 body row), and only the grabbed path joins on release. One undo. A click on a selected instance without dragging selects just that instance. Pressing an unselected path replaces the selection and drags it alone. | built |
| E6 | Box handles scale a single selected path; scale snaps silently to size fractions (T13); endpoint hints while scaling; `⇧` keeps proportions, `⌥` scales from the centre (§6.5). | built |
| E6a | **Rotation** (decided 2026-10-02): hovering just outside a corner handle of a selected path's box shows the rotate cursor; dragging from there rotates the path about the box centre (only, for now). Only when the selected instance is the **original** (decided 2026-10-04); a selected repeat or clone shows no rotate cursor. A hint shows the angle while rotating. Angle steps follow §6.5. No separate rotation handle. | built |
| E6b | Resizing a translation element (construction layer) snaps its u and v components silently to size fractions (T13); `⌘` / `Ctrl` frees it. | built (was: twelfths, following `G`) |
| E7 | Handle drags snap to axis angles, tangents, mirror normals. | built |
| E8 | Dropping a node on a node (same layer) merges them. | built |
| E9 | Dropping a node on a line (same layer) splits the line and shares the node. | built |

---

## 9. Hinting

| ID | Requirement | Status |
|---|---|---|
| H1 | While a snap holds, mark the target: a ring for a point, the highlighted line for a line. | built |
| H2 | Show the hint before pressing, at the pointer, in Pen and Freehand. | built |
| H3 | A short label names the target ("tile corner", "meets its mirror clone"). | built |
| H4 | While pinned, the followed line stays highlighted. | built |
| H5 | Hints update every pointer move, and while dragging or scaling they show at the selection's endpoints. | built |
| H6 | What you see is what you get: if a hint is showing when the pointer goes down or up, that is the snap used, including a sticky hold beyond the plain threshold (SN4). | built for Pen, Freehand and Select drags |
| H7 | No hint, no snap (decided 2026-10-01): a target snap happens only if its hint is visible at that moment; otherwise the point lands where the pointer is, or on the grid while `G` is on. A commit never re-picks a snap that was not shown. | built for Pen, Freehand and Select drags |
| H8 | While Pen or Freehand is selected, nodes are shown only for paths near the cursor (within 48 screen px of any of their instances), not for every path (decided 2026-10-01). The path in progress always shows its nodes. Display only: hidden nodes still snap. In Select the same reveal hints unselected paths' nodes (S2, 2026-10-06); the selected instance's nodes always show. | built |
| H9 | **Placement node** (decided 2026-10-02): while Pen or Freehand is selected and the pointer is on the canvas, a node marker always shows where a click (Pen) or press (Freehand start) would place the point: on the snapped target when one holds (with its usual label), on the nearest grid point when `G` is on and no target holds (no label), otherwise at the raw pointer. It is what a click uses (H6, H7). Drawing only: moving and editing keep the grid silent. | new |
| H10 | Rotating shows the angle (E6a); scaling with size fractions shows no hint (§6.5). | built |

---

## 10. Use cases

| ID | Use case | Requirements |
|---|---|---|
| UC-D1 | Draw one or more lines whose ends touch nothing. | D1, D11 |
| UC-D2 | End a line on its own clone's start. | D4, D8 |
| UC-D3 | End a line on the line drawn so far (loop and tail). | D7 |
| UC-D4 | End on a tile edge, mirror axis or rotation point. | D4, T2–T4 |
| UC-D5 | Start and end a second line on the tile boundary, lines, clones or repeats. | D3, D4, D6 |
| UC-D6 | Extend a path from its endpoint. | D5 |
| UC-D7 | Start on a mirror axis; path and clone meet there as two paths. | D9 |
| UC-D8 | Follow a line while pressed. | D12, §6.6 |
| UC-D9 | Close a shape on its own start. | T9 |
| UC-D10 | Leave one tile edge and continue from the opposite edge. | D10 |
| UC-D11 | Start in the middle of another line (T-junction). | D6 |
| UC-D12 | End exactly where a path crosses an axis or edge. | T5 |
| UC-D13 | Rosette: end on the rotation point. | T4 |
| UC-D14 | Abandon a stroke with `Esc`. | K1 |
| UC-D15 | See the cursor's clones before drawing. | D15 |
| UC-D16 | Trace wings off a sketched body on another layer, as one fluid line. | D12, D13, O2 |
| UC-D17 | With Pen armed, watch the placement node sit on the grid point (`G` on) or snapped target the click will use. | H9 |
| UC-D18 | Hold `⌘` and click next to an existing node; the point lands freely, no join. | §6.5 |
| UC-D19 | Let a hint lapse before releasing a stroke; the end lands at the pointer, not on the lapsed target. | H7 |
| UC-D20 | Draw with many paths on screen; only paths near the cursor show their nodes. | H8 |
| UC-E1 | Select a path, see its nodes, drag one. | S1, S2, E1 |
| UC-E2 | Marquee nodes and drag them as a unit. | S5, E2 |
| UC-E3 | See snap targets live while dragging or scaling. | H1, H5 |
| UC-E4 | Drag a node onto another line to join it. | E9 |
| UC-E5 | Drag a whole path until its endpoint lands on a target. | E5 |
| UC-E6 | Select several instances and delete their paths. | S4 |
| UC-E7 | Grab an endpoint that sits on a box corner. | S6 |
| UC-E8 | Cancel a drag with `Esc`. | K1 |
| UC-E9 | Drag a node toward a mirror axis without the snap flickering between the axis and the node's own clone. | SN3, SN4 |
| UC-E10 | Drag a whole path until its start meets its clone's end (or its end meets its clone's start). | SN3a |
| UC-E11 | Hover just outside a box corner, see the rotate cursor, and rotate the path, reading the angle from the hint. | E6a |
| UC-E12 | Scale a selected path so its width is exactly a third of the tile; hold `⌘` to scale freely. | E6, T13 |
| UC-E13 | Resize a translation element to half the tile's height; hold `⌘` to place it freely. | E6b, T13 |
| UC-E14 | Select three paths and add the same mirror group to all of them; one undo removes it from all three. | S7 |
| UC-E15 | Drag a marquee around four paths; the four paths are selected, not their nodes. Hold `⌥` to get their nodes instead. | S8 |
| UC-E16 | With four paths selected, drag one of them; all four move together, and one undo puts them back. | E5b |
| UC-E17 | Scale a path from its centre keeping its proportions (`⇧⌥` while dragging a corner). | E6 |
| UC-E18 | Drag a mirror clone of a path; the original moves the mirrored way and the transforms stay put. | E5a |
| UC-E19 | Slide a dragged node along a tile edge with `G` on; it steps from grid point to grid point. | SN2a |
| UC-E20 | Press a node of an unselected path; the whole path moves. Select it first, then drag the node. | S9 |
| UC-F1 | Fill a region bounded by paths on lower layers, then add details above it. | R1, R4 |
| UC-F2 | Edit or hide the paths below a fill; the fill stays. | R5 |
| UC-F3 | Click inside an unfilled region; it does nothing. | R7 |
| UC-F4 | Fill a region in a checkered pattern of two colours, then switch it to alternate by rows. | R9 |

---

## 11. Decisions (2026-09-30)

| Q | Decision |
|---|---|
| Vocabulary | Use the §1 words; all strings in one table (V1). |
| Ending on your own line | Split and share (D7). Self-crossing already forms loops. |
| Ending on your own clone | Location only; never split the original; snap against the fitted clone (D8). |
| Fused at an axis | Two paths that meet (D9). Combining would remove the symmetry; revisit later. |
| Tracing | One workflow (D12, D13, UC-D16). Dimming is styling, not a concept. |
| Pen parity | Pen, Freehand and Shapes share rules (D14). |
| Induced symmetry | Implied mirror axes and their crossings only; no implied rotation centres. |
| Priority | Points before lines, intersections first; one config list (SN2). |
| Cursor ghosts | Path's groups, else new-path groups, else none (D15). |
| Several instances selected | Select and delete whole paths (S4); per-clone actions on the roadmap. |
| Marquee scope | Every visible instance (S5). |
| Snap override key | `⌘` / `Ctrl` held (§6.5). |
| Node vs box handle | Node wins (S6). |
| `Esc` | Two-stage (K1). |
| Snap categories as settings | Not now; playground only. |
| Shape tool | True circles and ovals, not curve approximations; after snapping is done. |
| Slice tool | Split at selected nodes or at path crossings; not a knife stroke. |
| Scaling and dragging | Snap hints on the selection's endpoints (E5, E6, H5). |
| Layer ownership | Points and paths belong to one layer; cross-layer snaps copy location (O1–O3). |
| Regions | Visible paths, active layer and below (R1). |
| Fills | Frozen fill shapes, lattice repeat only, don't bound regions (R4–R7). |
| Grid vs targets (2026-10-01) | `G` is the grid only; targets always on; `⌘` / `Ctrl` frees a gesture (§6.5). |
| No hint, no snap (2026-10-01) | H7; the grid and size fractions are the silent exceptions. |
| Nodes while drawing (2026-10-01) | Only near the cursor (H8). |
| Nodes in Select (2026-10-06) | Unselected paths' nodes, clone anchors included, are hinted near the cursor and act as nodes: click, `⇧`-click, drag, `⌫` (S2, S3, S9). |
| Dragging a copy (2026-10-01) | Moves the original; transforms never move (E5a). |
| Grid and lines (2026-10-02) | The grid filters lines to grid-line crossings, everywhere (SN2a). |
| Drawing feedback (2026-10-02) | Placement node, including grid points (H9). |
| Size snapping (2026-10-02) | Silent k/n of the tile, n ≤ 4, for box scale and translation resize; `⌘` frees (T13). |
| Box modifiers (2026-10-02) | `⇧` proportions, `⌥` from centre; rotation by hovering outside a corner, originals only (E6, E6a). |
| Alternating fills (2026-10-02) | Rows, columns, checkered by tile (R9). |
| Several paths (2026-10-02) | Marquee selects whole paths (S8, `⌥` for nodes); dragging any selected one moves all (E5b); group editing open (S7). |
| Cursor ghosts (2026-10-04) | Ghost the placement node in clones of the new-path groups while armed (D15). |

---

## 12. Roadmap (deferred on purpose)

1. **Transform group per layer.** Every path on a layer is cloned by the layer's groups; per-path groups become optional. The cursor preview then uses the layer's groups.
2. **Groups that apply to some instances only** (houndstooth: clone the copy along y, the original along x). Options: each group names which instances it applies to; per-clone hiding; groups as a tree.
3. **Per-clone hiding** of individual clones and repeats.
4. **Linked locations across layers** that move together.
5. **Fill shapes linked to their source lines** so they follow edits.
6. **Fills that follow clones**, and colour-swapping by transform (Escher-style counterchange). Alternation by tile is R9.
7. **Combining paths that meet at an axis** into one path, removing the symmetry.
8. **Shape tool** with true circle and oval segments (an ellipse-arc segment type through regions, splitting, snapping and export; ellipses stay ellipses under lattice skew).
9. **Slice tool** at selected nodes and path crossings.
10. **Node editing on fill shapes.**
11. **Bug:** deleting a node picked on a clone deletes the whole original path.
12. Snap categories as user settings, if the playground shows a need.
13. **Targets beyond the 3×3 window** for drawing and node drags (reduce the query point by its lattice cell, as body drags do).
14. **Scale and rotate several selected paths** with one box (S10); rotation about other pivots (E6a is centre only).
15. **Size fractions finer with zoom** (`FRACTION_MAX_N` above 4 when zoomed in).
16. **Touch tracing toggle** in place of `⌥` (§6.6).
17. **A cue before a node unlinks** (E4) — the selected path's line moving alone is the only feedback today.
18. **Automatic deploy** to GitHub Pages on push to `main`.
19. **Overdraw mode** (requested 2026-10-04): where a new path crosses earlier paths, it is drawn passing over them: a small gap (knockout) in the earlier line at each crossing, in the background colour. Display only; the paths and regions are unchanged. The simpler case of braid mode.
20. **Braid mode** (requested 2026-10-04): every crossing is resolved as over or under, alternating along each line like a weave or Celtic knot. Possible methods: split the lines at crossings on release and store an over/under flag per crossing; or compute crossings live and keep only a per-crossing toggle. Open: how crossings across clones and repeats stay consistent with the symmetry, and how a user flips one. 2026-10-06: the Weave Playground in Claude Design works out over/under crossings for Celtic knots (https://claude.ai/design/p/ae4a1512-e4eb-4441-a3dd-ae43d3476931?file=Weave+Playground.dc.html); the same treatment applied to overlapping paths would make braids.
21. **Performance analysis** (requested 2026-10-06): the browser crashes and resets on larger designs, most likely a memory leak or too many nodes (the 3×3 window of every copy's geometry, the region arrangement, the SVG `<use>` per cell per layer). Profile a heavy document, find what grows, and set budgets (copy cap, face count, redraw cost per gesture).
22. **Polyline functions** (requested 2026-10-06): paths generated from a function instead of drawn and bezier-fitted — sine waves and polar-coordinate curves (spirals, rosettes) as smooth polylines or exact segments — for smoother lines without quadratic approximation and for more precise rotational patterns.

---

## 13. Playground

`/playground.html` (Vite dev server) is throwaway. Paths are world-space polylines; it reuses the engine's lattice and transform maths only. It has no layers, regions, fills or joins. Instead it **announces** which use case each stroke or drag enacts and what the app would do on release (e.g. "UC-D3: would split this stroke and share the node"). It has toggles for the open tuning choices: pin trigger, breakaway, threshold, precedence mode, stickiness, own-clone resolution, cursor ghosts and target categories. Findings flow back into this file; nothing from the playground ships.
