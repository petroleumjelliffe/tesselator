# Interaction specification — drawing, selection, editing, snapping, fills

Status: decisions recorded 2026-09-30, ready for planning. Organises every interaction requirement by entity, state and behaviour, and checks them against a use-case list. It consolidates the interaction parts of the engine design (`2026-09-27-engine-rebuild-design.md` §4 Hit-testing, Snapping and Regions, §6), the pen-joins amendment (`2026-09-29-pen-joins-amendment.md`) and the snapping-and-handles amendment (`2026-09-29-snapping-and-handles-amendment.md`), and the user's interaction notes and answers of 2026-09-30. The amendments keep their rationale and maths; where this file and they disagree, this file wins.

**Status tags** on every requirement:

- **built** — in the app on `feature/rebuild`.
- **specced** — in an earlier amendment, not built yet.
- **new** — decided 2026-09-30.
- **change** — decided 2026-09-30 and replaces built behaviour.

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
| **Box handle** | A bounding-box scale handle or the rotate knob. | bbox handle |
| **Symmetry element** | Mirror axis, rotation point, translation. | `Element` |
| **Transform group** | An ordered set of elements composed into one transform; groups stack ("then"). | group, binding |
| **Region** | A closed area enclosed by visible lines (§7). | face |
| **Fill shape** | A coloured shape made by the Fill tool from a region's outline (§7). | new entity |

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
| Grid point | snap on | no | no | point (fallback) | built |
| Path, any instance | yes | yes | node, body, box | line | built; targets new |
| Node / endpoint, any instance | selected instance only (S2) | yes | yes | point | built; S2 change |
| Handle | selected instance | no | yes | — | built; snapping specced |
| Box handle | selected instance | no | yes | — | built; snapping specced |
| In-progress stroke, original | while drawing | no | — | line | new |
| In-progress stroke, clones and repeats | while drawing (ghosts) | no | — | start: point; body: line | new |
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
| Grid snap | on · off (`G`); silent, never hinted | built; decided 2026-10-01 |
| Target snap | always on; hold `⌘` / `Ctrl` to turn it off for one gesture | built 2026-10-01 (was: `G` turned targets off) |

Pen, Freehand and (later) Shape tools share one rule set for nodes, snapping and commit (§5, §6).

### 4.2 Selection

| State | Contents | Status |
|---|---|---|
| Nothing | — | built |
| Instances | one or more (path, instance) pairs: originals, repeats, clones | one built; several new |
| Nodes | one or more (node, instance it was picked through) | built in one frame; across instances new |
| Element | one symmetry element | built |
| Fill shape | one | change (was a seed) |

### 4.3 Gesture

| State | Entered by | Left by | Status |
|---|---|---|---|
| Idle / hover | — | press | built |
| Pressing | pointer down | move past 3 px (drag) or up (click) | built |
| Stroke (Freehand) | press | release; `Esc` discards | built; `Esc` new |
| Stroke, pinned | §6.6 | breakaway or release | new |
| Path in progress (Pen) | first click | `Esc`, `Enter`, last point, start point | built |
| Drag (nodes, handle, box, body, element) | press and move | release; `Esc` cancels and restores | built; `Esc` new |
| Marquee | press on empty space in Select and move | release | built |
| Two-pointer navigation | second pointer | both up | built |

**K1 (change). `Esc` is two-stage.** First press cancels the gesture or ends the path in progress. Second press clears the selection and switches to Select.

---

## 5. Drawing

| ID | Requirement | Status |
|---|---|---|
| D1 | Press, drag, release draws a stroke, simplified and fitted on release. | built |
| D2 | The stroke's clones and repeats are drawn live as ghosts. | built |
| D3 | The start snaps to the drawing targets (§6.3). | new (was: existing points only) |
| D4 | The end snaps to the drawing targets plus the stroke itself, its start, and its own clones and repeats (§6.3). | new (was: points only) |
| D5 | Starting on an open endpoint of a path on the active layer extends that path. | built |
| D6 | Starting or ending on a line of a path on the active layer splits that line and shares the node (as the Pen does). On another layer: location only (O2). | Pen built; Freehand new |
| D7 | Ending on the stroke's own line splits it there and shares the node: a loop with a tail. (A stroke that crosses itself already forms a loop with two danglers, because regions split at crossings; ending *on* the line needs the exact split.) | new |
| D8 | Ending on its own clone's start or line is a location snap only. The original is never split. The snap is made against the **fitted** stroke's clone, not the raw ghost, so the end lies on the final clone. | new |
| D9 | A path that starts or ends on a mirror axis or rotation point stays a separate path from its clone; they meet exactly. | new |
| D10 | Ending on the opposite tile edge at the repeat of the stroke's own start continues the line seamlessly into its repeat (edge wrap). | new |
| D11 | Several unconnected strokes can be drawn in a row; nothing joins unless a snap lands. | built |
| D12 | **Tracing.** While the pointer is down, the stroke can follow a visible line on any layer, peel off, and rejoin, and still produce one path (§6.6). The followed stretch copies that exact part of the curve. The copy is not linked to the line it came from. | new |
| D13 | Where a stroke peels off or rejoins a traced line, the fitted curve has no kink (tangent-continuous). | new |
| D14 | Pen clicks use the same targets and commit rules as Freehand ends. | new |
| D15 | A toggle shows a ghost of the cursor in every clone of the applicable transform group: the edited path's own groups, else the groups new paths receive, else none. Not in repeats. | new |

**The tracing workflow (UC-D16).** Sketch a bird's body as one loose line on a layer. On another layer, draw the wings as one fluid outline: follow the body for a stretch, peel off into the wing, rejoin. Hide the sketch layer. The wing outline stands on its own. The sketch is dimmed by giving it a light colour and thin weight; there is no special reference-layer concept.

---

## 6. Snapping

### 6.1 Targets

| Code | Target | Kind | Status |
|---|---|---|---|
| T1 | Tile corners (lattice points in the 3×3 window) | point | new |
| T2 | Tile edges | line | new |
| T3 | Mirror axes: elements, and axes implied by stacked groups | line | new |
| T4 | Rotation points of elements | point | new |
| T5 | Intersections of target lines | point | new |
| T6 | Nodes and endpoints of visible paths, every instance | point | built (anchors) |
| T7 | Lines of visible paths, every instance | line | Pen built; others new |
| T8 | The stroke's own line, minus a tail behind the pen tip | line | new |
| T9 | The stroke's own start, once the stroke is long enough | point | new |
| T10 | The stroke's own clones and repeats: their start and line | point / line | new |
| T11 | Grid | point (fallback) | built |
| T12 | Handle guides: axis lines through the anchors, tangents, mirror normals | line | specced |
| T13 | Scale fractions of the lattice spans | value | specced |

Hidden paths and paths on hidden layers are never targets.

### 6.2 Choice

- **SN1.** Candidates are the targets within the threshold, `SNAP_PX × hitScale / zoom` (doubled for touch), measured from the **raw** pointer, never from a previously snapped position.
- **SN2. Precedence** is one ordered list in config, easy to reorder. Default: intersection → endpoint or node → the stroke's own start → rotation point → tile corner → any line → grid. A point within range beats a line within range; within a class the nearest wins, ties by the list.
- **SN3. Own clones are solved, not chased.** During a node or body drag, the dragged node's own clones move with it, so they are not targets as positions. Instead, each own clone whose relative transform has a fixed set becomes that set: a mirror clone becomes its axis ("meets its mirror clone"), a rotated clone its centre ("meets its rotated clone"). Translations and glides have no fixed set and add nothing. This stops the clone and the axis from competing, and stops the snap from chasing a target that moves with it. (Drawing is unaffected: the stroke's own clones' starts are fixed once the stroke starts.)
  - **SN3a. Ends meet each other's clones.** In a body drag, the other ends' clones move with the path too, so they are solved the same way. Each moving end is paired with every clone of every other moving end ("meets its clone's end"). A rotated clone gives one spot. A mirror gives a line of spots, but only when the two ends already line up along the axis; a glide only when their offset along the axis equals the glide's. Otherwise moving the path can never make them meet, so no hint appears. Translations add nothing. In a node drag the other ends stay still, so their clones are ordinary node targets (T6).
- **SN4. Stickiness.** A snap that holds stays until the pointer is 1.5× the threshold from it, or until a candidate earlier in the precedence list comes within the threshold, or until a same-class candidate is nearer by more than half the threshold.
- **SN5.** Duplicate candidates at the same spot are reported once, with the highest-precedence label.

### 6.3 Which targets apply to which gesture

| Gesture | Targets |
|---|---|
| Freehand start, Pen click with no path in progress | T1–T7, T11 |
| Freehand end, Pen click on a path in progress | T1–T11 |
| Freehand mid-stroke | only while pinned (§6.6) |
| Node drag (one) | T1–T7 and SN3, T11 |
| Nodes drag (several) | the grabbed node, as one node drag |
| Body drag | each endpoint (every node of a closed path) as a node drag; the nearest snap moves the whole path |
| Box scale | T13; hints also show on the selection's endpoints when they land on T1–T7 |
| Handle drag | T12 |

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

Status: Pen built for same-layer rows; everything else new. Merges across layers are a **change**.

### 6.5 Toggles

- **Grid** (decided 2026-10-01): `G` turns grid snapping on and off. The grid is the fallback when no target is near, and it is never hinted.
- **Targets** (decided 2026-10-01): snapping to every target in §6.1 (T1–T10, T12–T13) is always on. Holding `⌘` / `Ctrl` turns it off for that gesture, existing points included, for a fully free placement. The grid still applies while `G` is on. There is no target toggle for now. The canvas suppresses the context menu so `Ctrl`-click works on a Mac.
- `⇧` keeps its meanings: free scale, add to selection.

### 6.6 Pinned movement (tracing)

- **Trigger.** Explicit: only while `⌥` is held (decided 2026-09-30 after the playground showed that pinning on a line start made ordinary strokes follow lines). Without it the stroke always follows the pointer, and snapping applies only to the start and, on release, the end. Touch needs a chrome toggle in place of `⌥`. Holding `⌥` is itself the request, so tracing works whether snapping is on or off (`G`, `⌘`/`Ctrl`). The playground keeps the other triggers to compare.
- **Follow.** While pinned, stroke points are the pointer projected onto the line.
- **Breakaway.** The pin releases when the pointer is more than the breakaway distance (default 24 px) from the line. The same line cannot re-pin until the pointer has been twice that distance away.
- **Result.** One path. The followed stretch is an exact copy of that part of the line (D12), joined without a kink (D13). The line followed is never split or joined (it is a guide, on any layer).

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

---

## 8. Selection and editing

| ID | Requirement | Status |
|---|---|---|
| S1 | Click a line of any instance selects the path at that instance. | built |
| S2 | Nodes show only on the selected instance(s), not on every instance. | change |
| S3 | `⇧`-click adds or removes a node. | built |
| S4 | `⇧`-click adds or removes an instance (original, repeat or clone). Delete removes the selected instances' whole paths; per-clone actions wait for the roadmap. | new |
| S5 | Marquee selects nodes of every visible instance inside it; a node picked through a clone moves through that clone's inverse. | built in one frame; new across instances |
| S6 | Where a node and a box handle coincide, the node wins. | new |
| E1 | Drag a node; all instances follow. | built |
| E2 | Drag selected nodes as a unit. | built |
| E3 | Handles move rigidly with a dragged node. | specced |
| E4 | Dragging a node of the selected path pulls it off a shared point. | specced |
| E5 | Drag a path's body; its endpoints snap as they move (§6.3) and join on release (§6.4). | move built; snapping specced, extended |
| E5a | Dragging the body of a clone or repeat moves the **original** path so the grabbed copy follows the pointer; transforms never move (decided 2026-10-01: moving the transform broke rational placement and multiplied copies). Snapping is measured at the grabbed copy. Transforms move only by their own handles. | change (was: moved the transform) |
| E6 | Box handles scale and rotate; scale snaps to lattice fractions; endpoint hints while scaling. | built; snap specced; hints new |
| E7 | Handle drags snap to axis angles, tangents, mirror normals. | specced |
| E8 | Dropping a node on a node (same layer) merges them. | built; cross-layer change |
| E9 | Dropping a node on a line (same layer) splits the line and shares the node. | new |

---

## 9. Hinting

| ID | Requirement | Status |
|---|---|---|
| H1 | While a snap holds, mark the target: a ring for a point, the highlighted line for a line. | specced for drags; new elsewhere |
| H2 | Show the hint before pressing, at the pointer, in Pen and Freehand. | new |
| H3 | A short label names the target ("tile corner", "meets its mirror clone"). | new |
| H4 | While pinned, the followed line stays highlighted. | new |
| H5 | Hints update every pointer move, and while dragging or scaling they show at the selection's endpoints. | new |
| H6 | What you see is what you get: if a hint is showing when the pointer goes down or up, that is the snap used, including a sticky hold beyond the plain threshold (SN4). | built for Pen, Freehand and Select drags |
| H7 | No hint, no snap (decided 2026-10-01): a target snap happens only if its hint is visible at that moment; otherwise the point lands where the pointer is, or on the grid while `G` is on. A commit never re-picks a snap that was not shown. | built for Pen, Freehand and Select drags |
| H8 | While Pen or Freehand is selected, nodes are shown only for paths near the cursor (within a few thresholds of any of their instances), not for every path (decided 2026-10-01). | new |

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
| UC-F1 | Fill a region bounded by paths on lower layers, then add details above it. | R1, R4 |
| UC-F2 | Edit or hide the paths below a fill; the fill stays. | R5 |
| UC-F3 | Click inside an unfilled region; it does nothing. | R7 |

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

---

## 12. Roadmap (deferred on purpose)

1. **Transform group per layer.** Every path on a layer is cloned by the layer's groups; per-path groups become optional. The cursor preview then uses the layer's groups.
2. **Groups that apply to some instances only** (houndstooth: clone the copy along y, the original along x). Options: each group names which instances it applies to; per-clone hiding; groups as a tree.
3. **Per-clone hiding** of individual clones and repeats.
4. **Linked locations across layers** that move together.
5. **Fill shapes linked to their source lines** so they follow edits.
6. **Fills that follow clones** and alternating colours.
7. **Combining paths that meet at an axis** into one path, removing the symmetry.
8. **Shape tool** with true circle and oval segments (an ellipse-arc segment type through regions, splitting, snapping and export; ellipses stay ellipses under lattice skew).
9. **Slice tool** at selected nodes and path crossings.
10. **Node editing on fill shapes.**
11. **Bug:** deleting a node picked on a clone deletes the whole original path.
12. Snap categories as user settings, if the playground shows a need.

---

## 13. Playground

`/playground.html` (Vite dev server) is throwaway. Paths are world-space polylines; it reuses the engine's lattice and transform maths only. It has no layers, regions, fills or joins. Instead it **announces** which use case each stroke or drag enacts and what the app would do on release (e.g. "UC-D3: would split this stroke and share the node"). It has toggles for the open tuning choices: pin trigger, breakaway, threshold, precedence mode, stickiness, own-clone resolution, cursor ghosts and target categories. Findings flow back into this file; nothing from the playground ships.
