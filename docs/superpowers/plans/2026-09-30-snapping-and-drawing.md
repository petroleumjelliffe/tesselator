# Snapping and Drawing Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every drawing and editing gesture snaps to the targets a tessellation is built from (tile corners and edges, mirror axes, rotation points, intersections, other paths' nodes and lines, the stroke's own start, line, clones and repeats), with hints, precedence, stickiness and no flicker; joins happen on release within a layer; Alt traces along a line; selection shows nodes on the clicked instance only and can hold several instances; `Esc` is two-stage; `⌘`/`Ctrl` inverts snapping.

**Architecture:** A new pure module `src/engine/snap.ts` builds a `TargetSet` from a `Doc` (cached as a `computed` in `derived.ts`) and chooses among candidates with one precedence list and a stickiness rule (`pickSnap`). Gesture-specific candidates (the stroke's own targets, a dragged node's own clones resolved to their axis or centre, body drags' own-copy meets) are passed in as `extra`. A new pure module `src/engine/joins.ts` turns a snap result into a node on release (share, split, via, or a new point) and enforces the same-layer rule. Tools publish `UI.snapHint`; the canvas draws a ring, the line used and a label.

**Tech Stack:** Preact + `@preact/signals`, TypeScript strict, Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-interaction-spec.md` (binding; §5 Drawing, §6 Snapping, §8 Selection and editing, §9 Hinting, K1, V1). It supersedes the organisation of `docs/superpowers/specs/2026-09-29-snapping-and-handles-amendment.md`, whose maths (own-copy meets, scale fractions, handle guides, unlink) this plan reuses. This plan replaces the unexecuted `docs/superpowers/plans/2026-09-29-snapping-and-handles.md`; its "filled regions as handles" task is dropped (spec R7: fills become shapes, in the next plan).

**Not in this plan (next plan, `2026-09-30-layers-regions-fills.md`):** layer ownership migration (O1, O3), hidden layers, regions from visible paths at or below the active layer (R1), fill shapes (R4–R8). This plan does enforce O2 for every join it creates: a snap onto another layer's geometry is location only.

## Global Constraints

- Runtime dependencies stay exactly `preact` and `@preact/signals`. `npx tsc --noEmit -p ~/Developer/personal/tesselator` is clean after every commit; the user tests by hand on this branch, so no commit may fail to type-check.
- No Chrome DevTools MCP browser driving, no server on port 5173 (the user's dev server runs there), no Playwright. Verify with `npx tsc --noEmit -p ~/Developer/personal/tesselator` and `npx vitest run --root ~/Developer/personal/tesselator`.
- `src/engine/*` stays pure. Mutation helpers receive a draft; tools change the document only through `src/actions.ts` (`A.mutate` and named actions).
- Threshold: `SNAP_PX × hitScale / zoom` (`ctx.threshold`, `A.threshold(hitScale)`), doubled for touch through `hitScale`. Sticky release `1.5×` threshold; same-class rival margin `0.5×` threshold. Tracing breakaway 24 px.
- Precedence (spec SN2), one list in `CONFIG.SNAP_PRECEDENCE`: points `intersection, node, ownStart, ownFixed, ownClone, ownRepeat, centre, corner, grid`; then lines `ownFixed, axis, edge, line, ownLine, ownClone, ownRepeat`. A point within the threshold beats a line within the threshold.
- Snapping toggle: `G` flips `prefs.snap`; holding `⌘` or `Ctrl` inverts it for one gesture (`ctx.snapOn = prefs.snap !== (metaKey || ctrlKey)`). **With snapping off, existing points (category `node`) still attract Pen clicks, point drags and stroke ends, as they do today; every other target and the grid turn off.** Bounding-box scaling uses `prefs.snap` alone, because `⇧` means "free" there.
- Same-layer rule (spec O2): a release joins (merge, split, via) only when the target geometry is on the drawing path's layer: a `curve` hit's host path has that `layerId`, and every path using a `node` hit's point has it. Otherwise the snap is location only.
- What you see is what you get (spec H6): the snap shown when the pointer goes down or up is the snap used; `UI.snapSticky` carries the held id from hover into the press.
- Commit after every task with a message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `cd` into the project; use absolute paths, `--root`, `-p` or `git -C`; write home paths as `~/...`. Stage only the files the task names.

## Review Focus

1. A stroke that starts on a line of a path on another layer must not split that path (location only). Pinned by Task 9's "other layer" test.
2. Dragging a node toward a mirror axis must settle on the axis, not alternate between the axis and the node's own mirror image. Pinned by Task 3's `ownFixedCands` test and Task 7's "settles on the axis" test.
3. A held (sticky) snap must not survive a target that is earlier in the precedence list coming into range. Pinned by Task 3's stickiness test.
4. With snapping off, a Pen click near an existing point must still reuse it (and nothing else may attract it). Pinned by Task 9's "snap off" test.
5. `Esc` during a node drag must restore the node and leave no history entry. Pinned by Task 6's `Esc` test.

---

## File map

| File | Change |
| --- | --- |
| `src/types.ts` | `SnapCat`, `SnapHit`, `SnapResult`, `PointTarget`, `LineTarget`, `TargetSet`, `StrokeCopy`, `Line`, `BodySnap`, `BodyTargets`; drag fields; `Selection` gains `paths` and point `copies` |
| `src/config.ts` | `SNAP_PRECEDENCE`, `SNAP_STICKY_RELEASE`, `SNAP_STICKY_MARGIN`, `TRACE_BREAKAWAY_PX`, `SCALE_FRACTIONS` |
| `src/strings.ts` (new) | every user-visible string (V1); snap labels first, the rest in Task 13 |
| `src/engine/paths.ts` | rigid `shiftControlPoints`; `rewriteNodes` + `mergePoints` + `mergeIntoNode`; `detachFromPath` |
| `src/engine/snap.ts` (new) | `bezAt`, `nearestOnSeg`, `buildTargets`, `pickSnap`, `precedence`, `gridResult`, `strokeCopies`, `strokeCands`, `pointCopyMatrices`, `ownFixedCands`, `solveCopyMeet`, `bodyTargets`, `snapBodyDelta`, `snapScale`, `cpLines`, `snapToLines` |
| `src/engine/joins.ts` (new) | `joinable`, `nodeForSnap`, `joinPointToHit`, `splitNearest` |
| `src/engine/hit.ts` | selected-instance nodes first (S6), nodes only on the selected instance (S2), selected points through their copies (S5) |
| `src/state/ui.ts`, `src/state/derived.ts` | `snapHint`, `snapSticky`; `snapTargets` computed |
| `src/actions.ts` | `drawSnap`, `penStroke`, `hoverSnap`, Pen and Freehand commits through `joins.ts`, `joinDroppedNode`, `joinDroppedPoint`, `unlinkNode`, `toggleInstance`, multi-instance delete |
| `src/interaction/pointer.ts` | `⌘`/`Ctrl` override, hover hints, sticky hand-off, two-stage `Esc` |
| `src/interaction/tools/select.ts`, `pen.ts`, `freehand.ts` | snapping drags, joins on release, tracing |
| `src/components/Canvas.tsx`, `src/styles.css`, `src/components/Chrome.tsx` | `SnapMark` with label, selected-instance nodes, multi-instance halos and bar, copy |
| `CLAUDE.md` | architecture and limitations |
| `tests/unit/snap.test.ts`, `tests/unit/joins.test.ts`, `tests/unit/select.test.ts`, `tests/unit/draw.test.ts`, `tests/unit/unlink.test.ts` (new); `paths.test.ts`, `hit.test.ts`, `actions.test.ts` | tests |

Task order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13. Tasks 1, 2, 4 and 8 are independent of each other's code; the rest depend on Task 3.

---

### Task 1: Anchor drags carry control points rigidly

**Files:**
- Modify: `src/engine/paths.ts` (`shiftControlPoints`)
- Test: `tests/unit/paths.test.ts`

**Interfaces:**
- Produces: `shiftControlPoints(doc, ids, du, dv)` moves the control point of every segment with at least one end in `ids` by `(du, dv)`, once. Signature unchanged.

- [ ] **Step 1: Rewrite the existing test to the new rule**

In `tests/unit/paths.test.ts`, find the test whose name contains "shift adjacent control points by half" and replace it with (keep using the file's own helpers; if `polyline` takes `[u, v]` pairs, adapt the literals, not the helper):

```ts
test('movePoint carries both neighbouring control points rigidly; movePointsBy moves a shared one once', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0, v: 0 }, { u: 0.4, v: 0 }, { u: 0.8, v: 0 }]);
  P.setControlPointAbs(doc, path.id, 0, { u: 0.2, v: 0.2 });
  P.setControlPointAbs(doc, path.id, 1, { u: 0.6, v: 0.2 });
  const [n0, n1] = P.pathNodes(path);
  P.movePoint(doc, n1.pointId, 0.4, 0.1);                   // the middle node moves by (0, 0.1)
  expect(P.cpAbs(path, 0)!.v).toBeCloseTo(0.3, 9);
  expect(P.cpAbs(path, 1)!.v).toBeCloseTo(0.3, 9);
  expect(P.cpAbs(path, 0)!.u).toBeCloseTo(0.2, 9);
  const ids = [n0.pointId, n1.pointId];
  P.movePointsBy(doc, ids, P.snapshotPositions(doc, ids), 0, 0.1);   // both ends of segment 0, one end of segment 1
  expect(P.cpAbs(path, 0)!.v).toBeCloseTo(0.4, 9);
  expect(P.cpAbs(path, 1)!.v).toBeCloseTo(0.4, 9);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/paths.test.ts -t "rigidly"`
Expected: FAIL, `expected 0.25 to be close to 0.3`.

- [ ] **Step 3: Implement**

In `shiftControlPoints` (`src/engine/paths.ts`) replace the line `if (n) s.cp = { u: s.cp.u + (du * n) / 2, v: s.cp.v + (dv * n) / 2 };` with:

```ts
      if (n) s.cp = { u: s.cp.u + du, v: s.cp.v + dv };   // rigid: a moved end carries the handle by the full delta, once
```

- [ ] **Step 4: Run all tests and typecheck**

Run: `npx vitest run --root ~/Developer/personal/tesselator && npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: PASS. If another test pinned the half rule (search `tests/unit` for expectations near `cpAbs` that equal half a move), update its expected value to the full-delta result and name it in the commit message.

- [ ] **Step 5: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/engine/paths.ts tests/unit/paths.test.ts
git -C ~/Developer/personal/tesselator commit -m "Engine: an anchor drag carries its control points rigidly

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Merge into a node seen through a clone

**Files:**
- Modify: `src/engine/paths.ts` (`mergePoints`)
- Test: `tests/unit/paths.test.ts`

**Interfaces:**
- Produces: `mergeIntoNode(doc: Doc, fromId: string, fromCell: Cell, target: Node): void`. Without `target.via` it is `mergePoints(doc, fromId, fromCell, target.pointId, target.cell)`. With a via it rewrites every plain node referencing `fromId` in cell `c` to `{ pointId: target.pointId, cell: target.cell, via: { ...target.via, cell: target.via.cell + (c − fromCell) } }`, and deletes `fromId`. Via nodes referencing `fromId` are left alone.
- `mergePoints` keeps its signature and behaviour.

- [ ] **Step 1: Failing tests**

Append to `tests/unit/paths.test.ts` (it already has `makeDoc`, `polyline`, `closeXY`; adapt literal shapes to its helpers if they differ):

```ts
test('mergeIntoNode onto a clone rewrites every reference as a via node with shifted via cells', () => {
  const doc = makeDoc();
  const body = polyline(doc, [{ u: 0.1, v: 0.1 }, { u: 0.3, v: 0.1 }]);
  const el = P.addElement(doc, { kind: 'rotate', u: 0.5, v: 0.5, n: 2 });
  const b = P.addBinding(doc, body.id, [[el.id]]);
  const tail = polyline(doc, [{ u: 0.5, v: 0.6 }, { u: 0.85, v: 0.85 }]);
  const fromId = tail.segments[0].to.pointId;
  const other = P.startPath(doc, { pointId: tail.start.pointId, cell: { c: 1, r: 0 } }, { color: '#000', weight: 2 }, 'L1');
  P.appendNode(doc, other.id, { pointId: fromId, cell: { c: 1, r: 0 } });            // the same point seen in cell (1, 0)
  const target = { pointId: body.start.pointId, cell: { c: 0, r: 0 }, via: { cell: { c: 0, r: 0 }, bindingId: b.id, power: 1 } };
  const at = P.nodeWorld(doc, target);
  P.mergeIntoNode(doc, fromId, { c: 0, r: 0 }, target);
  expect(tail.segments[0].to).toEqual(target);
  expect(other.segments[0].to).toEqual({ ...target, via: { ...target.via, cell: { c: 1, r: 0 } } });
  closeXY(P.nodeWorld(doc, tail.segments[0].to), at.x, at.y);
  closeXY(P.nodeWorld(doc, other.segments[0].to), at.x + 240, at.y);
  expect(doc.points.some((q) => q.id === fromId)).toBe(false);
});

test('mergeIntoNode without a via is mergePoints', () => {
  const doc = makeDoc();
  const a = polyline(doc, [{ u: 0.1, v: 0.1 }, { u: 0.3, v: 0.1 }]);
  const c = polyline(doc, [{ u: 0.3, v: 0.5 }, { u: 0.31, v: 0.11 }]);
  const fromId = c.segments[0].to.pointId;
  P.mergeIntoNode(doc, fromId, { c: 0, r: 0 }, { pointId: a.segments[0].to.pointId, cell: { c: 0, r: 0 } });
  expect(c.segments[0].to).toEqual({ pointId: a.segments[0].to.pointId, cell: { c: 0, r: 0 } });
  expect(doc.points.some((q) => q.id === fromId)).toBe(false);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/paths.test.ts -t "mergeIntoNode"`
Expected: FAIL, `P.mergeIntoNode is not a function`.

- [ ] **Step 3: Implement by splitting `mergePoints`**

Replace `mergePoints` in `src/engine/paths.ts` with a shared rewrite and two callers. `rewriteNodes` is the current loop and tail with the node map passed in, so the zero-length and control-point re-basing rules are kept verbatim:

```ts
// Rewrite nodes through `map` (which returns the same object for a node it leaves alone), dropping segments that become
// zero-length and re-basing a control point only after a replaced previous node; then drop emptied paths and orphans.
function rewriteNodes(doc: Doc, map: (n: Node) => Node): void {
  for (const p of doc.paths) {
    const prevs = p.segments.map((_, j) => prevNode(p, j)), abs = p.segments.map((_, j) => cpAbs(p, j));
    p.start = map(p.start);
    const keep: Segment[] = [];
    let prev = p.start;
    p.segments.forEach((s, j) => {
      const to = map(s.to);
      if (sameNode(prev, to)) return;                                                  // zero-length: dropped
      const c = abs[j];
      keep.push({ to, cp: c && prev !== prevs[j] ? rel(c, prev.cell) : s.cp });       // re-base only after a replaced node
      prev = to;
    });
    p.segments = keep;
  }
  withViaRepair(doc, () => {
    doc.paths = doc.paths.filter((p) => p.segments.length > 0);
    const kept = new Set(doc.paths.map((p) => p.id));
    doc.bindings = doc.bindings.filter((b) => kept.has(b.pathId));
    pruneOrphans(doc);
  });
}

// Replace every reference to `fromId` (seen in `fromCell`) by `toId` at the same place (seen in `toCell`), keeping
// absolute control points, dropping a segment that becomes zero-length, then deleting the point. A via node that
// referenced `fromId` is rewritten the same way (its world position is unchanged, since the copy sees the same place).
export function mergePoints(doc: Doc, fromId: string, fromCell: Cell, toId: string, toCell: Cell): void {
  if (fromId === toId) return;
  const dc = toCell.c - fromCell.c, dr = toCell.r - fromCell.r;
  rewriteNodes(doc, (n) => (n.pointId === fromId ? cloneNode({ ...n, cell: { c: n.cell.c + dc, r: n.cell.r + dr }, pointId: toId }) : n));
}

// Merge into any node. A via target turns each plain reference into a via node whose copy cell is shifted by that
// reference's cell offset, so it keeps the same place relative to the others. Via references to `fromId` are left alone.
export function mergeIntoNode(doc: Doc, fromId: string, fromCell: Cell, target: Node): void {
  if (!target.via) { mergePoints(doc, fromId, fromCell, target.pointId, target.cell); return; }
  if (fromId === target.pointId) return;
  const tv = target.via;
  rewriteNodes(doc, (n) => (n.pointId === fromId && !n.via
    ? { pointId: target.pointId, cell: { ...target.cell }, via: { ...tv, cell: { c: tv.cell.c + n.cell.c - fromCell.c, r: tv.cell.r + n.cell.r - fromCell.r } } }
    : n));
}
```

- [ ] **Step 4: Run all tests and typecheck**

Run: `npx vitest run --root ~/Developer/personal/tesselator && npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: PASS, including the existing `mergePoints` tests.

- [ ] **Step 5: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/engine/paths.ts tests/unit/paths.test.ts
git -C ~/Developer/personal/tesselator commit -m "Engine: mergeIntoNode joins a point onto a clone through via nodes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Snap targets, precedence, stickiness, own targets

**Files:**
- Modify: `src/types.ts`, `src/config.ts`
- Create: `src/strings.ts`, `src/engine/snap.ts`
- Test: `tests/unit/snap.test.ts` (new)

**Interfaces:**
- Consumes: `anchorsWorld` (`hit.ts`), `collectSegments` (`regions.ts`), `getPath`, `pathNodes`, `cloneMatrices` (`paths.ts`), `orbit`, `classify`, `apply`, `compose`, `invert`, `cellMatrix` (`transform.ts`), `toWorld`, `toUV`, `snapGrid`, `windowOffsets` (`lattice.ts`).
- Produces (types, `src/types.ts`):
  ```ts
  export type SnapCat = 'intersection' | 'node' | 'ownStart' | 'ownFixed' | 'ownClone' | 'ownRepeat' | 'centre' | 'corner' | 'grid'
    | 'axis' | 'edge' | 'line' | 'ownLine';
  export type SnapHit =
    | { kind: 'place' }                                                     // location only
    | { kind: 'own' }                                                       // a body drag meets its own rotated or mirrored copy
    | { kind: 'node'; pointId: string; cell: Cell; copy: Copy }             // cell: where the point is seen (raw), or its own cell (clone, with copy = the clone)
    | { kind: 'curve'; pathId: string; j: number; t: number; copy: Copy }   // a point on another path's segment j, seen through copy
    | { kind: 'ownStart' }                                                  // the stroke's own start (close)
    | { kind: 'ownRepeat'; cell: Cell }                                     // the stroke's own start, repeated in `cell` (edge wrap)
    | { kind: 'ownLine' }                                                   // the stroke's own line (loop and tail)
    | { kind: 'ownCopy'; M: Matrix };                                       // a line of the stroke's own clone or repeat M (location; re-snapped to the fitted copy)
  export type SnapResult = { at: XY; cls: 'point' | 'line'; cat: SnapCat; id: string; label: string; hit: SnapHit; d: number; line?: XY[] };
  export type PointTarget = { at: XY; cat: SnapCat; id: string; label: string; hit: SnapHit; pointIds?: string[]; pathIds?: string[] };
  export type LineTarget = { a: XY; b: XY; cp: XY | null; cat: SnapCat; id: string; label: string; source?: { pathId: string; copy: Copy; j: number }; ends?: string[] };
  export type TargetSet = { points: PointTarget[]; lines: LineTarget[] };
  export type StrokeCopy = { M: Matrix; kind: 'clone' | 'repeat'; cell: Cell };
  ```
- Produces (`src/engine/snap.ts`):
  - `bezAt(a: XY, cp: XY | null, b: XY, t: number): XY`
  - `nearestOnSeg(a: XY, cp: XY | null, b: XY, p: XY): { t: number; q: XY; d: number }` (t in [0, 1])
  - `buildTargets(doc: Doc): TargetSet`
  - `type PickOpts = { extra?: SnapResult[]; sticky?: string | null; excludePoints?: ReadonlySet<string>; excludePaths?: ReadonlySet<string>; cats?: ReadonlySet<SnapCat>; pointsOnly?: boolean; linesOnly?: boolean }`
  - `pickSnap(set: TargetSet, p: XY, threshold: number, opts?: PickOpts): SnapResult | null`
  - `precedence(x: { cls: 'point' | 'line'; cat: SnapCat }): number`
  - `gridResult(p: XY, lat: Lattice, div: number): SnapResult`
  - `NODE_ONLY: ReadonlySet<SnapCat>` (= `{ 'node' }`, used when snapping is off)
  - `strokeCopies(doc: Doc, groups: string[][]): StrokeCopy[]`
  - `strokeCands(stroke: XY[], copies: StrokeCopy[], p: XY, threshold: number): SnapResult[]`
  - `pointCopyMatrices(doc: Doc, pointId: string): Matrix[]`
  - `ownFixedCands(S: Matrix, Ks: Matrix[], p: XY, threshold: number): SnapResult[]`
- Produces (`src/strings.ts`): `export const STR = { snap: { … } } as const` (Task 13 adds the rest).
- Produces (`src/config.ts`): `SNAP_PRECEDENCE`, `SNAP_STICKY_RELEASE`, `SNAP_STICKY_MARGIN`.

- [ ] **Step 1: Types, config, strings**

Add the types above to `src/types.ts` after the `Face` type. Add to `CONFIG` in `src/config.ts`, after `CLONE_CAP`:

```ts
  // Snapping (spec 2026-09-30 §6): one precedence list, points before lines; a held snap lets go at 1.5× the threshold
  // and yields to a same-class rival only when that rival is nearer by half the threshold.
  SNAP_PRECEDENCE: {
    point: ['intersection', 'node', 'ownStart', 'ownFixed', 'ownClone', 'ownRepeat', 'centre', 'corner', 'grid'],
    line: ['ownFixed', 'axis', 'edge', 'line', 'ownLine', 'ownClone', 'ownRepeat'],
  } as const,
  SNAP_STICKY_RELEASE: 1.5,
  SNAP_STICKY_MARGIN: 0.5,
```

Create `src/strings.ts`:

```ts
// Every user-visible string lives here (spec V1), so a word can be renamed in one place as the vocabulary settles.
export const STR = {
  snap: {
    corner: 'tile corner',
    edge: 'tile edge',
    axis: 'mirror axis',
    impliedAxis: 'mirror axis (stacked groups)',
    centre: (n: number) => `rotation point (1/${n})`,
    cross: (a: string, b: string) => `${a} × ${b}`,
    node: 'node',
    cloneNode: 'node of a clone',
    line: 'line',
    cloneLine: 'line of a clone',
    ownLine: 'this line',
    ownStart: 'this line\'s start',
    cloneStart: 'its clone\'s start',
    repeatStart: 'its repeat\'s start',
    ownCloneLine: 'its clone',
    ownRepeatLine: 'its repeat',
    meetsMirror: 'meets its mirror clone',
    meetsRotated: 'meets its rotated clone',
    meetsOwn: 'meets its own copy',
    grid: 'grid',
    scale: (f: string) => `scale ${f}`,
    guide: 'guide',
  },
} as const;
```

- [ ] **Step 2: Failing tests**

Create `tests/unit/snap.test.ts`:

```ts
import { test, expect } from 'vitest';
import * as P from '../../src/engine/paths';
import { buildTargets, pickSnap, precedence, strokeCopies, strokeCands, pointCopyMatrices, ownFixedCands, nearestOnSeg, gridResult, NODE_ONLY } from '../../src/engine/snap';
import { cellMatrix } from '../../src/engine/transform';
import { CONFIG } from '../../src/config';
import type { Doc, UV, XY, SnapResult } from '../../src/types';

export function makeDoc(): Doc { return { version: 2, lattice: { ...CONFIG.LATTICE_PRESETS.Square }, points: [], paths: [], elements: [], bindings: [], fills: [], layers: [{ id: 'L1', name: 'Layer 1' }], newPathGroups: [] }; }
export function line(d: Doc, pts: UV[], closed = false, layerId = 'L1') {
  const n0 = P.addPoint(d, pts[0]);
  const p = P.startPath(d, n0, { color: '#000', weight: 2 }, layerId);
  for (const uv of pts.slice(1)) P.appendNode(d, p.id, P.addPoint(d, uv));
  if (closed) P.appendNode(d, p.id, { pointId: n0.pointId, cell: { ...n0.cell } });
  return p;
}
const near = (a: XY, b: XY) => { expect(a.x).toBeCloseTo(b.x, 6); expect(a.y).toBeCloseTo(b.y, 6); };
function mirrorDoc() {                                   // square 240, a mirror along b through the tile centre: the line x = 120 (and x = 360, x = -120)
  const d = makeDoc();
  P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });
  return d;
}

test('nearestOnSeg on a straight and a curved segment', () => {
  const s = nearestOnSeg({ x: 0, y: 0 }, null, { x: 100, y: 0 }, { x: 30, y: 7 });
  near(s.q, { x: 30, y: 0 }); expect(s.t).toBeCloseTo(0.3, 9); expect(s.d).toBeCloseTo(7, 9);
  const c = nearestOnSeg({ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }, { x: 50, y: 60 });   // apex (50, 50)
  near(c.q, { x: 50, y: 50 }); expect(c.t).toBeCloseTo(0.5, 6);
});

test('buildTargets: corners, edges, the mirror axis, and where the axis crosses the tile edge', () => {
  const T = buildTargets(mirrorDoc());
  expect(T.points.some((t) => t.cat === 'corner' && t.at.x === 0 && t.at.y === 0)).toBe(true);
  expect(T.lines.some((t) => t.cat === 'axis' && Math.abs(t.a.x - 120) < 1e-6 && Math.abs(t.b.x - 120) < 1e-6)).toBe(true);
  expect(T.lines.filter((t) => t.cat === 'edge').length).toBeGreaterThanOrEqual(8);
  expect(T.points.some((t) => t.cat === 'intersection' && Math.abs(t.at.x - 120) < 1e-6 && Math.abs(t.at.y) < 1e-6)).toBe(true);
});

test('pickSnap: a point beats a nearer line; nothing in range is null; a line projects', () => {
  const T = buildTargets(mirrorDoc());
  const a = pickSnap(T, { x: 117, y: 50 }, 12)!;          // axis 3 away, nothing else near
  expect(a.cat).toBe('axis'); near(a.at, { x: 120, y: 50 }); expect(a.hit).toEqual({ kind: 'place' });
  const b = pickSnap(T, { x: 118, y: 6 }, 12)!;           // the axis × edge crossing (120, 0) is 6.3 away; the axis is 2 away
  expect(b.cat).toBe('intersection'); near(b.at, { x: 120, y: 0 });
  expect(pickSnap(T, { x: 60, y: 60 }, 12)).toBe(null);
});

test('pickSnap: other paths\' nodes and lines carry hits; exclusions drop them and the lines touching them', () => {
  const d = makeDoc();
  const p = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]);   // (48,120)-(192,120)
  const T = buildTargets(d);
  const n = pickSnap(T, { x: 50, y: 118 }, 12)!;
  expect(n.cat).toBe('node'); expect(n.hit).toMatchObject({ kind: 'node', pointId: p.start.pointId, cell: { c: 0, r: 0 } });
  const l = pickSnap(T, { x: 120, y: 125 }, 12)!;
  expect(l.cat).toBe('line'); expect(l.hit).toMatchObject({ kind: 'curve', pathId: p.id, j: 0, copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 } });
  expect((l.hit as { t: number }).t).toBeCloseTo(0.5, 6);
  expect(pickSnap(T, { x: 120, y: 125 }, 12, { excludePoints: new Set([p.start.pointId]) })).toBe(null);
  expect(pickSnap(T, { x: 120, y: 125 }, 12, { excludePaths: new Set([p.id]) })).toBe(null);
  expect(pickSnap(T, { x: 120, y: 125 }, 12, { cats: NODE_ONLY })).toBe(null);
  expect(pickSnap(T, { x: 50, y: 118 }, 12, { cats: NODE_ONLY })?.cat).toBe('node');
});

test('stickiness: a held line survives out to 1.5× and a same-class rival must be clearly nearer; an earlier class takes over', () => {
  const T = buildTargets(mirrorDoc());
  const held = pickSnap(T, { x: 135, y: 60 }, 12, { sticky: pickSnap(T, { x: 125, y: 60 }, 12)!.id })!;   // 15 from the axis: beyond 12, inside 18
  expect(held.cat).toBe('axis');
  expect(pickSnap(T, { x: 139, y: 60 }, 12, { sticky: held.id })).toBe(null);                              // 19: let go
  const corner = pickSnap(T, { x: 118, y: 6 }, 12, { sticky: held.id })!;
  expect(corner.cat).toBe('intersection');                                                                  // a point is earlier than any line
  expect(precedence({ cls: 'point', cat: 'corner' })).toBeLessThan(precedence({ cls: 'line', cat: 'axis' }));
});

test('strokeCands: own line minus the tail, own start once long enough, a clone\'s start, a repeat\'s start', () => {
  const d = mirrorDoc();
  const groups = [[d.elements[0].id]];
  const copies = strokeCopies(d, groups);
  expect(copies.some((c) => c.kind === 'repeat' && c.cell.c === 1 && c.cell.r === 0)).toBe(true);
  const stroke = [{ x: 20, y: 100 }, { x: 60, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 140 }];
  const kinds = (p: XY) => strokeCands(stroke, copies, p, 12).map((c) => c.cat);
  expect(kinds({ x: 40, y: 104 })).toContain('ownLine');
  expect(kinds({ x: 98, y: 136 })).not.toContain('ownLine');                 // the tail behind the tip is not a target
  expect(kinds({ x: 22, y: 102 })).toContain('ownStart');
  const cs = strokeCands(stroke, copies, { x: 220, y: 100 }, 12).find((c) => c.cat === 'ownClone' && c.cls === 'point')!;   // mirror of (20, 100) is (220, 100)
  near(cs.at, { x: 220, y: 100 }); expect(cs.hit).toEqual({ kind: 'place' });
  const rs = strokeCands(stroke, copies, { x: 258, y: 100 }, 12).find((c) => c.cat === 'ownRepeat' && c.cls === 'point')!;  // repeat of the start in cell (1, 0)
  expect(rs.hit).toEqual({ kind: 'ownRepeat', cell: { c: 1, r: 0 } });
  expect(strokeCands([{ x: 0, y: 0 }, { x: 10, y: 0 }], copies, { x: 1, y: 1 }, 12).some((c) => c.cat === 'ownStart')).toBe(false);
});

test('ownFixedCands: a mirror clone of the dragged point resolves to the axis; a half turn to its centre', () => {
  const d = mirrorDoc();
  const p = line(d, [{ u: 0.3, v: 0.2 }, { u: 0.3, v: 0.6 }]);
  P.addBinding(d, p.id, [[d.elements[0].id]]);
  const Ks = pointCopyMatrices(d, p.start.pointId);
  const S = cellMatrix({ c: 0, r: 0 }, d.lattice);
  const c = ownFixedCands(S, Ks, { x: 115, y: 48 }, 12).find((x) => x.cls === 'line')!;
  expect(c.cat).toBe('ownFixed'); near(c.at, { x: 120, y: 48 }); expect(c.hit).toEqual({ kind: 'place' });
  const r = makeDoc();
  const el = P.addElement(r, { kind: 'rotate', u: 0.5, v: 0.5, n: 2 });
  const q = line(r, [{ u: 0.3, v: 0.2 }, { u: 0.3, v: 0.6 }]);
  P.addBinding(r, q.id, [[el.id]]);
  const k = ownFixedCands(S, pointCopyMatrices(r, q.start.pointId), { x: 118, y: 122 }, 12).find((x) => x.cls === 'point')!;
  near(k.at, { x: 120, y: 120 });
});

test('gridResult rounds to the grid', () => {
  const g = gridResult({ x: 31, y: 59 }, CONFIG.LATTICE_PRESETS.Square, 8);
  near(g.at, { x: 30, y: 60 }); expect(g.cat).toBe('grid');
});

test('a stroke result is a SnapResult', () => {
  const r: SnapResult = { at: { x: 0, y: 0 }, cls: 'point', cat: 'grid', id: 'grid', label: 'grid', hit: { kind: 'place' }, d: 0 };
  expect(r.cls).toBe('point');
});
```

- [ ] **Step 3: Run to see them fail**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/snap.test.ts`
Expected: FAIL, cannot resolve `../../src/engine/snap`.

- [ ] **Step 4: Implement `src/engine/snap.ts`**

```ts
// Snapping (spec 2026-09-30 §6): the targets a gesture can land on, the choice among them (one precedence list,
// points before lines, sticky holds), and the gesture-specific candidates (a stroke's own targets, a dragged node's own
// clones resolved to their axis or centre). Pure: takes a doc and explicit inputs. World distances throughout.
import { CONFIG } from '../config';
import { STR } from '../strings';
import { toWorld, toUV, snapGrid, windowOffsets } from './lattice';
import { apply, compose, invert, cellMatrix, classify, orbit } from './transform';
import { getPath, pathNodes, cloneMatrices } from './paths';
import { collectSegments } from './regions';
import { anchorsWorld } from './hit';
import type { Doc, XY, Matrix, Cell, Copy, Lattice, SnapCat, SnapHit, SnapResult, PointTarget, LineTarget, TargetSet, StrokeCopy } from '../types';

const add = (a: XY, b: XY): XY => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: XY, b: XY): XY => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: XY, k: number): XY => ({ x: a.x * k, y: a.y * k });
const dot = (a: XY, b: XY) => a.x * b.x + a.y * b.y;
const cross = (a: XY, b: XY) => a.x * b.y - a.y * b.x;
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const BASE: Copy = { cell: { c: 0, r: 0 }, bindingId: null, power: 0 };
const WINDOW = [-1, 0, 1, 2];
const ptKey = (p: XY) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
const copyKey = (c: Copy) => `${c.cell.c},${c.cell.r},${c.bindingId ?? ''},${c.power}`;
function lineKey(a: XY, b: XY): string {
  let ang = Math.atan2(b.y - a.y, b.x - a.x);
  if (ang < 0) ang += Math.PI;
  if (ang >= Math.PI - 1e-6) ang -= Math.PI;
  return `${ang.toFixed(4)}:${(-Math.sin(ang) * a.x + Math.cos(ang) * a.y).toFixed(3)}`;
}

export function bezAt(a: XY, cp: XY | null, b: XY, t: number): XY {
  if (!cp) return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  const s = 1 - t;
  return { x: s * s * a.x + 2 * s * t * cp.x + t * t * b.x, y: s * s * a.y + 2 * s * t * cp.y + t * t * b.y };
}

// Nearest point on a straight or quadratic segment: exact for a line; sampled then refined by ternary search for a curve.
export function nearestOnSeg(a: XY, cp: XY | null, b: XY, p: XY): { t: number; q: XY; d: number } {
  if (!cp) {
    const ab = sub(b, a), L = dot(ab, ab) || 1, t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / L)), q = add(a, mul(ab, t));
    return { t, q, d: dist(p, q) };
  }
  let bt = 0, bd = Infinity;
  for (let i = 0; i <= 32; i++) { const t = i / 32, d = dist(p, bezAt(a, cp, b, t)); if (d < bd) { bd = d; bt = t; } }
  let lo = Math.max(0, bt - 1 / 32), hi = Math.min(1, bt + 1 / 32);
  for (let k = 0; k < 30; k++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (dist(p, bezAt(a, cp, b, m1)) < dist(p, bezAt(a, cp, b, m2))) hi = m2; else lo = m1;
  }
  const t = (lo + hi) / 2, q = bezAt(a, cp, b, t);
  return { t, q, d: dist(p, q) };
}

function segX(a: XY, b: XY, c: XY, d: XY): XY | null {
  const r = sub(b, a), s = sub(d, c), den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(c, a), s) / den, u = cross(sub(c, a), r) / den;
  return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? add(a, mul(r, t)) : null;
}
const sampled = (t: LineTarget, n = 16): XY[] => (t.cp ? Array.from({ length: n + 1 }, (_, i) => bezAt(t.a, t.cp, t.b, i / n)) : [t.a, t.b]);
const boxDist = (t: LineTarget, p: XY): number => {
  const xs = [t.a.x, t.b.x, ...(t.cp ? [t.cp.x] : [])], ys = [t.a.y, t.b.y, ...(t.cp ? [t.cp.y] : [])];
  return Math.hypot(Math.max(Math.min(...xs) - p.x, 0, p.x - Math.max(...xs)), Math.max(Math.min(...ys) - p.y, 0, p.y - Math.max(...ys)));
};

// Everything a gesture can land on in the 3×3 window: tile corners and edges, mirror axes (elements, and the axes the
// stacked groups imply), rotation points, intersections of those with each other and with path lines, and every node
// and line of every path copy (originals, repeats, clones). Hidden-layer filtering arrives with the layers plan.
export function buildTargets(doc: Doc): TargetSet {
  const lat = doc.lattice, points: PointTarget[] = [], lines: LineTarget[] = [];
  const corners = WINDOW.flatMap((u) => WINDOW.map((v) => toWorld({ u, v }, lat)));
  const x0 = Math.min(...corners.map((p) => p.x)), x1 = Math.max(...corners.map((p) => p.x));
  const y0 = Math.min(...corners.map((p) => p.y)), y1 = Math.max(...corners.map((p) => p.y));
  const inBox = (p: XY) => p.x >= x0 - 1e-6 && p.x <= x1 + 1e-6 && p.y >= y0 - 1e-6 && p.y <= y1 + 1e-6;
  const diag = Math.hypot(x1 - x0, y1 - y0), mid = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const seenP = new Set<string>(), seenL = new Set<string>();
  const pushP = (t: Omit<PointTarget, 'id'> & { id?: string }) => {
    const k = `${t.cat}:${ptKey(t.at)}`;
    if (!inBox(t.at) || seenP.has(k)) return;
    seenP.add(k);
    points.push({ ...t, id: t.id ?? k });
  };
  const pushStatic = (a: XY, b: XY, cat: SnapCat, label: string) => {
    const k = lineKey(a, b);
    if (seenL.has(k)) return;
    seenL.add(k);
    lines.push({ a, b, cp: null, cat, id: `${cat}:${k}`, label });
  };
  const axis = (P: XY, D0: XY, label: string) => {
    const n = Math.hypot(D0.x, D0.y);
    if (n < 1e-9) return;
    const D = mul(D0, diag / n);
    if (Math.abs(cross(sub(mid, P), D)) / diag > diag / 2) return;   // the line misses the window
    pushStatic(sub(P, D), add(P, D), 'axis', label);
  };

  for (const at of corners) pushP({ at, cat: 'corner', label: STR.snap.corner, hit: { kind: 'place' } });
  for (const k of WINDOW) {
    pushStatic(toWorld({ u: k, v: -1 }, lat), toWorld({ u: k, v: 2 }, lat), 'edge', STR.snap.edge);
    pushStatic(toWorld({ u: -1, v: k }, lat), toWorld({ u: 2, v: k }, lat), 'edge', STR.snap.edge);
  }
  for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) for (const e of doc.elements) {
    if (e.kind === 'mirror') axis(toWorld({ u: e.u + c, v: e.v + r }, lat), toWorld({ u: e.du, v: e.dv }, lat), STR.snap.axis);
    else if (e.kind === 'rotate') pushP({ at: toWorld({ u: e.u + c, v: e.v + r }, lat), cat: 'centre', label: STR.snap.centre(e.n), hit: { kind: 'place' } });
  }
  // Axes implied by stacked groups (a rotation then a mirror has several): the reflections among their clone matrices.
  const seenG = new Set<string>();
  for (const g of [doc.newPathGroups, ...doc.bindings.map((b) => b.groups)]) {
    const k = JSON.stringify(g);
    if (!g.length || seenG.has(k)) continue;
    seenG.add(k);
    for (const C of orbit(g, doc.elements, lat, CONFIG.ORBIT_CAP, CONFIG.CLONE_CAP).matrices) {
      if (!C) continue;
      for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
        const cl = classify(compose(cellMatrix({ c, r }, lat), C));
        if (cl.kind === 'reflection') { const th = (cl.line.angle * Math.PI) / 180; axis(cl.line.point, { x: Math.cos(th), y: Math.sin(th) }, STR.snap.impliedAxis); }
      }
    }
  }
  const statics = lines.slice();
  for (let i = 0; i < statics.length; i++) for (let j = i + 1; j < statics.length; j++) {
    if (statics[i].cat === 'edge' && statics[j].cat === 'edge') continue;   // those are the corners
    const x = segX(statics[i].a, statics[i].b, statics[j].a, statics[j].b);
    if (x) pushP({ at: x, cat: 'intersection', label: STR.snap.cross(statics[i].label, statics[j].label), hit: { kind: 'place' } });
  }
  for (const s of collectSegments(doc)) {
    const path = getPath(doc, s.source.pathId);
    if (!path) continue;
    const nodes = pathNodes(path), ends = [nodes[s.source.j].pointId, nodes[s.source.j + 1].pointId];
    const t: LineTarget = { a: s.a, b: s.b, cp: s.cp, cat: 'line', id: `l:${s.source.pathId}:${s.source.j}:${copyKey(s.source.copy)}`,
      label: s.source.copy.bindingId ? STR.snap.cloneLine : STR.snap.line, source: { pathId: s.source.pathId, copy: s.source.copy, j: s.source.j }, ends };
    lines.push(t);
    const pl = sampled(t);
    for (let i = 0; i + 1 < pl.length; i++) for (const st of statics) {
      const x = segX(pl[i], pl[i + 1], st.a, st.b);
      if (x) pushP({ at: x, cat: 'intersection', label: STR.snap.cross(t.label, st.label), hit: { kind: 'place' }, pointIds: ends, pathIds: [s.source.pathId] });
    }
  }
  for (const a of anchorsWorld(doc)) {
    const copy: Copy = a.bindingId && a.via ? a.via : BASE;
    pushP({ at: { x: a.x, y: a.y }, cat: 'node', id: `n:${a.pointId}:${a.cell.c},${a.cell.r}:${copyKey(copy)}`, label: a.bindingId ? STR.snap.cloneNode : STR.snap.node,
      hit: { kind: 'node', pointId: a.pointId, cell: { ...a.cell }, copy: { cell: { ...copy.cell }, bindingId: copy.bindingId, power: copy.power } }, pointIds: [a.pointId] });
  }
  return { points, lines };
}

export const NODE_ONLY: ReadonlySet<SnapCat> = new Set<SnapCat>(['node']);

export function precedence(x: { cls: 'point' | 'line'; cat: SnapCat }): number {
  const list = (x.cls === 'point' ? CONFIG.SNAP_PRECEDENCE.point : CONFIG.SNAP_PRECEDENCE.line) as readonly SnapCat[];
  const i = list.indexOf(x.cat);
  return (x.cls === 'point' ? 0 : 100) + (i < 0 ? 50 : i);
}

// One pick among candidates: the nearest point within the threshold, else the nearest line, ties by precedence. A held
// (sticky) candidate stays until it is beyond 1.5× the threshold, an earlier-precedence category is in range, or a
// same-class rival is nearer by half the threshold.
export function choose(cands: SnapResult[], threshold: number, sticky: string | null): SnapResult | null {
  const key = (x: SnapResult) => x.d + precedence(x) * 1e-3 * threshold;
  const best = (xs: SnapResult[]) => xs.reduce<SnapResult | null>((b, x) => (!b || key(x) < key(b) ? x : b), null);
  const within = cands.filter((x) => x.d <= threshold);
  let pick = best(within.filter((x) => x.cls === 'point')) ?? best(within.filter((x) => x.cls === 'line'));
  const prev = sticky ? cands.find((x) => x.id === sticky) ?? null : null;
  if (prev) {
    if (!pick) pick = prev;
    else if (pick.id !== prev.id) {
      const earlier = precedence(pick) < precedence(prev) && pick.cat !== prev.cat;
      const nearer = pick.cls === prev.cls && pick.d < prev.d - CONFIG.SNAP_STICKY_MARGIN * threshold;
      if (!earlier && !nearer) pick = prev;
    }
  }
  return pick;
}

export type PickOpts = {
  extra?: SnapResult[]; sticky?: string | null; excludePoints?: ReadonlySet<string>; excludePaths?: ReadonlySet<string>;
  cats?: ReadonlySet<SnapCat>; pointsOnly?: boolean; linesOnly?: boolean;
};

export function pickSnap(set: TargetSet, p: XY, threshold: number, opts: PickOpts = {}): SnapResult | null {
  const reach = CONFIG.SNAP_STICKY_RELEASE * threshold, cands: SnapResult[] = [];
  const allowed = (cat: SnapCat) => !opts.cats || opts.cats.has(cat);
  const blocked = (pointIds?: string[], pathIds?: string[]) =>
    (!!pointIds && !!opts.excludePoints && pointIds.some((id) => opts.excludePoints!.has(id))) ||
    (!!pathIds && !!opts.excludePaths && pathIds.some((id) => opts.excludePaths!.has(id)));
  if (!opts.linesOnly) for (const t of set.points) {
    if (!allowed(t.cat) || blocked(t.pointIds, t.pathIds)) continue;
    const d = dist(p, t.at);
    if (d <= reach) cands.push({ at: t.at, cls: 'point', cat: t.cat, id: t.id, label: t.label, hit: t.hit, d });
  }
  if (!opts.pointsOnly) for (const t of set.lines) {
    if (!allowed(t.cat) || blocked(t.ends, t.source && [t.source.pathId]) || boxDist(t, p) > reach) continue;
    const r = nearestOnSeg(t.a, t.cp, t.b, p);
    if (r.d > reach) continue;
    const hit: SnapHit = t.source ? { kind: 'curve', pathId: t.source.pathId, j: t.source.j, t: r.t, copy: t.source.copy } : { kind: 'place' };
    cands.push({ at: r.q, cls: 'line', cat: t.cat, id: t.id, label: t.label, hit, d: r.d, line: sampled(t, 32) });
  }
  for (const x of opts.extra ?? []) {
    if (x.d > reach || !allowed(x.cat) || (opts.pointsOnly && x.cls === 'line') || (opts.linesOnly && x.cls === 'point')) continue;
    cands.push(x);
  }
  return choose(cands, threshold, opts.sticky ?? null);
}

export function gridResult(p: XY, lat: Lattice, div: number): SnapResult {
  const at = toWorld(snapGrid(toUV(p, lat), div), lat);
  return { at, cls: 'point', cat: 'grid', id: 'grid', label: STR.snap.grid, hit: { kind: 'place' }, d: dist(p, at) };
}

// The copies a new or extended stroke will have in the window: its repeats (pure cell translations, cell ≠ 0) and its
// clones (the groups' clone matrices, in every window cell).
export function strokeCopies(doc: Doc, groups: string[][]): StrokeCopy[] {
  const out: StrokeCopy[] = [], lat = doc.lattice;
  const clones = groups.length ? orbit(groups, doc.elements, lat, CONFIG.ORBIT_CAP, CONFIG.CLONE_CAP).matrices.filter((m): m is Matrix => !!m) : [];
  for (const cell of windowOffsets()) {
    const Mo = cellMatrix(cell, lat);
    if (cell.c || cell.r) out.push({ M: Mo, kind: 'repeat', cell });
    for (const C of clones) out.push({ M: compose(Mo, C), kind: 'clone', cell });
  }
  return out;
}

function polyLength(pts: XY[]): number { let n = 0; for (let i = 1; i < pts.length; i++) n += dist(pts[i - 1], pts[i]); return n; }
function trimTail(pts: XY[], len: number): XY[] {
  let acc = 0;
  for (let i = pts.length - 1; i > 0; i--) { acc += dist(pts[i], pts[i - 1]); if (acc >= len) return pts.slice(0, i); }
  return [];
}
function nearestOnPoly(pl: XY[], p: XY): { q: XY; d: number } | null {
  let best: { q: XY; d: number } | null = null;
  for (let i = 0; i + 1 < pl.length; i++) { const r = nearestOnSeg(pl[i], null, pl[i + 1], p); if (!best || r.d < best.d) best = r; }
  return best;
}

// A stroke's own targets (spec T8–T10): its line minus a tail of 3× the threshold behind the tip, its start once it is
// longer than 4× the threshold, and the start and line of each of its clones and repeats. `stroke` is world points.
export function strokeCands(stroke: XY[], copies: StrokeCopy[], p: XY, threshold: number): SnapResult[] {
  const out: SnapResult[] = [], reach = CONFIG.SNAP_STICKY_RELEASE * threshold;
  if (stroke.length < 2) return out;
  const body = trimTail(stroke, 3 * threshold);
  const r = body.length >= 2 ? nearestOnPoly(body, p) : null;
  if (r && r.d <= reach) out.push({ at: r.q, cls: 'line', cat: 'ownLine', id: 'own:line', label: STR.snap.ownLine, hit: { kind: 'ownLine' }, d: r.d, line: body });
  if (polyLength(stroke) > 4 * threshold) {
    const d = dist(p, stroke[0]);
    if (d <= reach) out.push({ at: stroke[0], cls: 'point', cat: 'ownStart', id: 'own:start', label: STR.snap.ownStart, hit: { kind: 'ownStart' }, d });
  }
  copies.forEach((c, i) => {
    const s0 = apply(c.M, stroke[0]), d0 = dist(p, s0), rep = c.kind === 'repeat';
    if (d0 <= reach) out.push(rep
      ? { at: s0, cls: 'point', cat: 'ownRepeat', id: `own:rs:${i}`, label: STR.snap.repeatStart, hit: { kind: 'ownRepeat', cell: { ...c.cell } }, d: d0 }
      : { at: s0, cls: 'point', cat: 'ownClone', id: `own:cs:${i}`, label: STR.snap.cloneStart, hit: { kind: 'place' }, d: d0 });
    if (body.length < 2) return;
    const pl = body.map((q) => apply(c.M, q)), rr = nearestOnPoly(pl, p);
    if (rr && rr.d <= reach) out.push({ at: rr.q, cls: 'line', cat: rep ? 'ownRepeat' : 'ownClone', id: `own:cl:${i}`, label: rep ? STR.snap.ownRepeatLine : STR.snap.ownCloneLine, hit: { kind: 'ownCopy', M: c.M }, d: rr.d, line: pl });
  });
  return out;
}

// Every matrix that maps a point's base-cell world position to one of its copies in the window: each raw cell copy
// and each clone copy, for every path that uses the point (as a plain node, in that node's cell).
export function pointCopyMatrices(doc: Doc, pointId: string): Matrix[] {
  const out: Matrix[] = [], lat = doc.lattice;
  for (const path of doc.paths) {
    const n = pathNodes(path).find((x) => x.pointId === pointId && !x.via);
    if (!n) continue;
    const Mn = cellMatrix(n.cell, lat), clones = doc.bindings.filter((b) => b.pathId === path.id).flatMap((b) => cloneMatrices(doc, b.id).matrices.filter((m): m is Matrix => !!m));
    for (const cell of windowOffsets()) {
      const Mo = cellMatrix(cell, lat);
      out.push(compose(Mo, Mn));
      for (const C of clones) out.push(compose(Mo, compose(C, Mn)));
    }
  }
  return out;
}

// SN3: a dragged node's own copies move with it, so they are never chased. A copy whose relative map T = K ∘ S⁻¹ is a
// reflection offers its mirror line ("meets its mirror clone"); a rotation offers its centre. Translations and glides
// offer nothing. S maps the point's base-cell world position to where it is being dragged.
export function ownFixedCands(S: Matrix, Ks: Matrix[], p: XY, threshold: number): SnapResult[] {
  const out: SnapResult[] = [], reach = CONFIG.SNAP_STICKY_RELEASE * threshold, Si = invert(S), seen = new Set<string>();
  for (const K of Ks) {
    const cl = classify(compose(K, Si));
    if (cl.kind === 'reflection') {
      const th = (cl.line.angle * Math.PI) / 180, D = { x: Math.cos(th) * 1e4, y: Math.sin(th) * 1e4 };
      const a = sub(cl.line.point, D), b = add(cl.line.point, D), id = `fx:${lineKey(a, b)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const r = nearestOnSeg(a, null, b, p);
      if (r.d <= reach) out.push({ at: r.q, cls: 'line', cat: 'ownFixed', id, label: STR.snap.meetsMirror, hit: { kind: 'place' }, d: r.d, line: [a, b] });
    } else if (cl.kind === 'rotation') {
      const id = `fc:${ptKey(cl.center)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const d = dist(p, cl.center);
      if (d <= reach) out.push({ at: cl.center, cls: 'point', cat: 'ownFixed', id, label: STR.snap.meetsRotated, hit: { kind: 'place' }, d });
    }
  }
  return out;
}

export type { Cell };
```

Remove the trailing `export type { Cell };` if `tsc` reports `Cell` unused elsewhere; it exists only so the import is used if no other code in the file references `Cell`. (Prefer deleting both the line and `Cell` from the import if unused.)

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/snap.test.ts && npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: PASS. If the intersection test fails because `classify` returns the mirror line's angle as 90° and the line key rounds differently, compare with `lineKey` and fix the key, not the test.

- [ ] **Step 6: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/types.ts src/config.ts src/strings.ts src/engine/snap.ts tests/unit/snap.test.ts
git -C ~/Developer/personal/tesselator commit -m "Engine: snap targets with one precedence list, sticky holds, and a stroke's and a dragged node's own targets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Joins on release

**Files:**
- Create: `src/engine/joins.ts`
- Test: `tests/unit/joins.test.ts` (new)

**Interfaces:**
- Consumes: `SnapHit`, `SnapResult` (Task 3), `nearestOnSeg` (Task 3), `mergeIntoNode` (Task 2), `insertNodeAt`, `addPoint`, `getPath`, `pathNodes`, `pathWorld`, `pathCpsWorld` (`paths.ts`).
- Produces (`src/engine/joins.ts`):
  - `joinable(doc: Doc, hit: SnapHit, layerId: string): boolean` — same-layer rule (O2).
  - `nodeForSnap(doc: Doc, s: SnapResult | null, w: XY, layerId: string): Node` — share a node, split a line (sharing, or via for a clone), or add a point at the snapped or raw position.
  - `joinPointToHit(doc: Doc, fromId: string, fromCell: Cell, hit: SnapHit, layerId: string): boolean` — merge a dropped point into a node or a split line; false when not joinable, when a via node references `fromId`, or when the hit is location only.
  - `splitNearest(doc: Doc, pathId: string, at: XY, maxJ: number): Node | null` — the node at the nearest spot on segments `0 … maxJ − 1` (an existing end node if the spot is an end, else a split).

- [ ] **Step 1: Failing tests**

Create `tests/unit/joins.test.ts`:

```ts
import { test, expect } from 'vitest';
import * as P from '../../src/engine/paths';
import { joinable, nodeForSnap, joinPointToHit, splitNearest } from '../../src/engine/joins';
import { makeDoc, line } from './snap.test';
import type { SnapResult, Copy } from '../../src/types';

const base: Copy = { cell: { c: 0, r: 0 }, bindingId: null, power: 0 };
const res = (hit: SnapResult['hit'], at = { x: 0, y: 0 }): SnapResult => ({ at, cls: 'point', cat: 'node', id: 'x', label: 'x', hit, d: 0 });

test('joinable: same layer only; a shared point needs every user on the layer', () => {
  const d = makeDoc();
  d.layers.push({ id: 'L2', name: 'Layer 2' });
  const a = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]);
  expect(joinable(d, { kind: 'curve', pathId: a.id, j: 0, t: 0.5, copy: base }, 'L1')).toBe(true);
  expect(joinable(d, { kind: 'curve', pathId: a.id, j: 0, t: 0.5, copy: base }, 'L2')).toBe(false);
  expect(joinable(d, { kind: 'node', pointId: a.start.pointId, cell: { c: 0, r: 0 }, copy: base }, 'L2')).toBe(false);
  expect(joinable(d, { kind: 'place' }, 'L1')).toBe(false);
});

test('nodeForSnap: shares a node, splits a line (raw cell and clone via), else a new point at the snap', () => {
  const d = makeDoc();
  const a = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]);
  expect(nodeForSnap(d, res({ kind: 'node', pointId: a.start.pointId, cell: { c: 1, r: 0 }, copy: base }), { x: 0, y: 0 }, 'L1')).toEqual({ pointId: a.start.pointId, cell: { c: 1, r: 0 } });
  const n = nodeForSnap(d, res({ kind: 'curve', pathId: a.id, j: 0, t: 0.5, copy: { cell: { c: 1, r: 0 }, bindingId: null, power: 0 } }), { x: 0, y: 0 }, 'L1');
  expect(a.segments).toHaveLength(2);
  expect(n.cell).toEqual({ c: 1, r: 0 });
  const w = P.nodeWorld(d, n); expect(w.x).toBeCloseTo(360, 6); expect(w.y).toBeCloseTo(120, 6);
  const other = nodeForSnap(d, res({ kind: 'curve', pathId: a.id, j: 0, t: 0.5, copy: base }), { x: 1, y: 2 }, 'L2');   // another layer: location only
  expect(a.segments).toHaveLength(2);
  const pw = P.nodeWorld(d, other); expect(pw.x).toBeCloseTo(0, 6); expect(pw.y).toBeCloseTo(0, 6);                    // at s.at
  const free = nodeForSnap(d, null, { x: 30, y: 40 }, 'L1');
  const fw = P.nodeWorld(d, free); expect(fw.x).toBeCloseTo(30, 6); expect(fw.y).toBeCloseTo(40, 6);
});

test('joinPointToHit: a dropped point merges into a node or a split line; location-only hits do nothing', () => {
  const d = makeDoc();
  const host = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]);
  const stub = line(d, [{ u: 0.5, v: 0.1 }, { u: 0.5, v: 0.49 }]);
  const end = stub.segments[0].to;
  expect(joinPointToHit(d, end.pointId, end.cell, { kind: 'place' }, 'L1')).toBe(false);
  expect(joinPointToHit(d, end.pointId, end.cell, { kind: 'curve', pathId: host.id, j: 0, t: 0.5, copy: base }, 'L1')).toBe(true);
  expect(host.segments).toHaveLength(2);
  expect(stub.segments[0].to.pointId).toBe(host.segments[0].to.pointId);
});

test('splitNearest: splits the nearest earlier segment, or returns an end node', () => {
  const d = makeDoc();
  const p = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.5, v: 0.1 }, { u: 0.5, v: 0.5 }]);   // (24,24)-(120,24)-(120,120)
  const n = splitNearest(d, p.id, { x: 72, y: 24 }, 1)!;
  expect(p.segments).toHaveLength(3);
  const w = P.nodeWorld(d, n); expect(w.x).toBeCloseTo(72, 6);
  expect(splitNearest(d, p.id, { x: 24, y: 24 }, 1)).toEqual(p.start);
});
```

Export `makeDoc` and `line` from `tests/unit/snap.test.ts` (they are already declared with `export` in Task 3).

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/joins.test.ts`
Expected: FAIL, cannot resolve `../../src/engine/joins`.

- [ ] **Step 3: Implement `src/engine/joins.ts`**

```ts
// What a snap does on release (spec 2026-09-30 §6.4): share a node, split a line and share the new node (a via node
// when it is seen through a clone), or place a new point. Joins happen only within a layer (O2). Draft mutations.
import { toUV } from './lattice';
import { getPath, pathNodes, pathWorld, pathCpsWorld, insertNodeAt, addPoint, mergeIntoNode } from './paths';
import { nearestOnSeg } from './snap';
import type { Doc, XY, Cell, Node, Copy, SnapHit, SnapResult } from '../types';

const clampT = (t: number) => Math.max(0.02, Math.min(0.98, t));

export function joinable(doc: Doc, hit: SnapHit, layerId: string): boolean {
  if (hit.kind === 'curve') return getPath(doc, hit.pathId)?.layerId === layerId;
  if (hit.kind === 'node') {
    const users = doc.paths.filter((p) => pathNodes(p).some((n) => n.pointId === hit.pointId));
    return users.length > 0 && users.every((p) => p.layerId === layerId);
  }
  return false;
}

// The node a seen point becomes: raw (its cell already includes the copy's cell) or through a clone (a via node).
function seenNode(pointId: string, cell: Cell, copy: Copy, raw: boolean): Node {
  return copy.bindingId
    ? { pointId, cell: { ...cell }, via: { cell: { ...copy.cell }, bindingId: copy.bindingId, power: copy.power } }
    : raw ? { pointId, cell: { ...cell } } : { pointId, cell: { c: cell.c + copy.cell.c, r: cell.r + copy.cell.r } };
}

export function nodeForSnap(doc: Doc, s: SnapResult | null, w: XY, layerId: string): Node {
  const h = s?.hit;
  if (h && h.kind === 'node' && joinable(doc, h, layerId)) return seenNode(h.pointId, h.cell, h.copy, true);
  if (h && h.kind === 'curve' && joinable(doc, h, layerId)) {
    const n = insertNodeAt(doc, h.pathId, h.j, clampT(h.t));
    return seenNode(n.pointId, n.cell, h.copy, false);
  }
  return addPoint(doc, toUV(s ? s.at : w, doc.lattice));
}

export function joinPointToHit(doc: Doc, fromId: string, fromCell: Cell, hit: SnapHit, layerId: string): boolean {
  if ((hit.kind !== 'node' && hit.kind !== 'curve') || !joinable(doc, hit, layerId)) return false;
  if (doc.paths.some((p) => pathNodes(p).some((n) => n.via && n.pointId === fromId))) return false;   // a via onto a via is not representable
  let target: Node;
  if (hit.kind === 'node') {
    if (hit.pointId === fromId) return false;
    target = seenNode(hit.pointId, hit.cell, hit.copy, true);
  } else {
    const n = insertNodeAt(doc, hit.pathId, hit.j, clampT(hit.t));
    target = seenNode(n.pointId, n.cell, hit.copy, false);
  }
  mergeIntoNode(doc, fromId, fromCell, target);
  return true;
}

export function splitNearest(doc: Doc, pathId: string, at: XY, maxJ: number): Node | null {
  const p = getPath(doc, pathId);
  if (!p) return null;
  const W = pathWorld(doc, p), C = pathCpsWorld(doc, p);
  let best: { j: number; t: number; d: number } | null = null;
  for (let j = 0; j < Math.min(maxJ, p.segments.length); j++) {
    const r = nearestOnSeg(W[j], C[j], W[j + 1], at);
    if (!best || r.d < best.d) best = { j, t: r.t, d: r.d };
  }
  if (!best) return null;
  const nodes = pathNodes(p);
  if (best.t < 0.02) return nodes[best.j];
  if (best.t > 0.98) return nodes[best.j + 1];
  return insertNodeAt(doc, pathId, best.j, best.t);
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/joins.test.ts && npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/engine/joins.ts tests/unit/joins.test.ts
git -C ~/Developer/personal/tesselator commit -m "Engine: joins on release, same layer only (share, split, via, or a new point)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Body-drag, scale and control-point snapping engine

**Files:**
- Modify: `src/types.ts`, `src/config.ts`, `src/engine/snap.ts`
- Test: `tests/unit/snap.test.ts`

**Interfaces:**
- Consumes: `TargetSet`, `pickSnap`, `choose`, `precedence` (Task 3); `pathNodes`, `pathWorld`, `isClosed`, `viaMatrix`, `getPath` (`paths.ts`); `windowOffsets`.
- Produces (types):
  ```ts
  export type Line = { p: XY; dir: XY };   // dir is a unit vector
  export type BodyTargets = { pathId: string; moving: { index: number; p: XY }[]; own: { K: Matrix; p: XY }[]; exclude: ReadonlySet<string>; set: TargetSet };
  export type BodySnap = { delta: XY; nodeIndex: number; res: SnapResult };
  ```
- Produces (`src/engine/snap.ts`):
  - `solveCopyMeet(S: Matrix, K: Matrix, pi: XY, pj: XY): { kind: 'point'; delta: XY } | { kind: 'line'; base: XY; dir: XY } | null`
  - `windowCopies(doc: Doc, pathId: string): { copy: Copy; M: Matrix }[]`
  - `bodyTargets(doc: Doc, set: TargetSet, pathId: string): BodyTargets | null`
  - `snapBodyDelta(T: BodyTargets, raw: XY, threshold: number, sticky: string | null): BodySnap | null` (`raw`/`delta` source-frame world deltas)
  - `CONFIG.SCALE_FRACTIONS = [1, 1 / 2, 1 / 3] as const`
  - `snapScale(nodes: XY[], lat: Lattice, h: BoxHandle, raw: { sx: number; sy: number }, free: boolean, threshold: number, fractions: readonly number[]): { sx: number; sy: number; snapped: boolean }`
  - `cpLines(doc: Doc, pathId: string, j: number, copy: Copy): Line[]`
  - `snapToLines(w: XY, lines: Line[], threshold: number): { at: XY; used: Line[] } | null`

- [ ] **Step 1: Types and config**

Add `Line`, `BodyTargets`, `BodySnap` to `src/types.ts` after `StrokeCopy`. Add to `CONFIG` after `SNAP_STICKY_MARGIN`: `SCALE_FRACTIONS: [1, 1 / 2, 1 / 3] as const,   // bounding-box scale snaps to these fractions of each lattice span`.

- [ ] **Step 2: Failing tests**

Append to `tests/unit/snap.test.ts`, extending its import from `../../src/engine/snap` with `solveCopyMeet, bodyTargets, snapBodyDelta, snapScale, cpLines, snapToLines`, and adding `import { apply, rotation, IDENTITY } from '../../src/engine/transform';` (merge with the existing `transform` import):

```ts
const addXY = (a: XY, b: XY): XY => ({ x: a.x + b.x, y: a.y + b.y });

test('solveCopyMeet: a point for a quarter turn, a line for a mirror, nothing for a translation', () => {
  const K = rotation(Math.PI / 2, 120, 120), pi = { x: 100, y: 50 }, pj = { x: 30, y: 60 };
  const r = solveCopyMeet(IDENTITY, K, pi, pj);
  expect(r?.kind).toBe('point');
  if (r?.kind === 'point') near(addXY(pi, r.delta), apply(K, addXY(pj, r.delta)));
  const m = solveCopyMeet(IDENTITY, [-1, 0, 0, 1, 240, 0], { x: 100, y: 50 }, { x: 100, y: 50 });   // the vertical line x = 120
  expect(m?.kind).toBe('line');
  if (m?.kind === 'line') { near(m.base, { x: 20, y: 0 }); expect(Math.abs(m.dir.x)).toBeCloseTo(0, 9); }
  expect(solveCopyMeet(IDENTITY, [1, 0, 0, 1, 240, 0], pi, pj)).toBe(null);
});

test('snapBodyDelta: an end lands on a corner, on another path\'s line, or nothing', () => {
  const d = makeDoc();
  const stub = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.5, v: 0.1 }]);          // (24,24)-(120,24)
  const other = line(d, [{ u: -0.2, v: 0.3 }, { u: 0.2, v: 0.3 }]);        // (-48,72)-(48,72)
  const T = bodyTargets(d, buildTargets(d), stub.id)!;
  const c = snapBodyDelta(T, { x: -20, y: -20 }, 12, null)!;               // start lands at (4, 4): corner (0, 0)
  expect(c.res.cat).toBe('corner'); near(c.delta, { x: -24, y: -24 }); expect(c.nodeIndex).toBe(0);
  const k = snapBodyDelta(T, { x: 6, y: 45 }, 12, null)!;                  // start lands at (30, 69): 3 from the other line
  expect(k.res.hit).toMatchObject({ kind: 'curve', pathId: other.id, j: 0 }); near(k.delta, { x: 6, y: 48 });
  expect(snapBodyDelta(T, { x: 60, y: 160 }, 12, null)).toBe(null);
});

test('snapBodyDelta: segments touching the dragged points are not targets', () => {
  const d = makeDoc();
  const stub = line(d, [{ u: 0.3, v: 0.3 }, { u: 0.6, v: 0.3 }]);
  const joined = P.startPath(d, { ...stub.start, cell: { ...stub.start.cell } }, { color: '#000', weight: 2 }, 'L1');
  P.appendNode(d, joined.id, P.addPoint(d, { u: 0.3, v: 0.6 }));          // moves with the stub
  expect(snapBodyDelta(bodyTargets(d, buildTargets(d), stub.id)!, { x: 2, y: 0 }, 12, null)).toBe(null);
});

test('snapBodyDelta: an end meets its own quarter-turn clone', () => {
  const d = makeDoc();
  const stub = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.4, v: 0.1 }]);
  const el = P.addElement(d, { kind: 'rotate', u: 0.5, v: 0.5, n: 4 });
  const b = P.addBinding(d, stub.id, [[el.id]]);
  const K = P.cloneMatrices(d, b.id).matrices[0]!;
  const Pw = P.pathWorld(d, stub);
  const sol = solveCopyMeet(IDENTITY, K, Pw[1], Pw[0]);
  expect(sol?.kind).toBe('point');
  if (sol?.kind !== 'point') return;
  const s = snapBodyDelta(bodyTargets(d, buildTargets(d), stub.id)!, addXY(sol.delta, { x: 1, y: 1 }), 12, null)!;
  expect(s.res.hit).toEqual({ kind: 'own' });
  near(s.delta, sol.delta);
});

const lat = { ...CONFIG.LATTICE_PRESETS.Square }, F = [1, 1 / 2, 1 / 3];

test('snapScale: an edge lands on a half and a third of the lattice span; a flat axis is not snapped', () => {
  const nodes = [{ x: 0, y: 0 }, { x: 100, y: 0 }], right = { x: 100, y: 0, ax: 0, ay: 0, cursor: '' };
  expect(snapScale(nodes, lat, right, { sx: 1.21, sy: 1 }, false, 12, F)).toEqual({ sx: 1.2, sy: 1, snapped: true });
  expect(snapScale(nodes, lat, right, { sx: 0.81, sy: 1 }, false, 12, F).sx).toBeCloseTo(0.8, 9);
  expect(snapScale(nodes, lat, right, { sx: 1.5, sy: 1 }, false, 12, F).snapped).toBe(false);
  const bottom = { x: 50, y: 10, ax: 50, ay: 0, cursor: '' };
  expect(snapScale(nodes, lat, bottom, { sx: 1, sy: 3 }, false, 12, F)).toEqual({ sx: 1, sy: 3, snapped: false });
});

test('snapScale: a uniform corner takes the nearest target from either axis', () => {
  const nodes = [{ x: 0, y: 0 }, { x: 100, y: 60 }], corner = { x: 100, y: 60, ax: 0, ay: 0, cursor: '' };
  const s = snapScale(nodes, lat, corner, { sx: 1.19, sy: 1.19 }, false, 12, F);
  expect(s.snapped).toBe(true); expect(s.sx).toBeCloseTo(1.2, 9); expect(s.sy).toBeCloseTo(1.2, 9);
});

test('cpLines and snapToLines: tangent to a straight neighbour, and the crossing of two lines', () => {
  const d = makeDoc();
  const p = line(d, [{ u: 0.2, v: 0.2 }, { u: 0.6, v: 0.2 }, { u: 0.9, v: 0.5 }]);   // A (48,48), B (144,48), C (216,120)
  const L = cpLines(d, p.id, 0, { cell: { c: 0, r: 0 }, bindingId: null, power: 0 });
  const t = snapToLines({ x: 116, y: 16 }, L, 12)!;
  expect(t.used).toHaveLength(1); expect(t.at.x).toBeCloseTo(114, 6); expect(t.at.y).toBeCloseTo(18, 6);
  const x = snapToLines({ x: 50, y: -45 }, L, 12)!;
  expect(x.used).toHaveLength(2); expect(x.at.x).toBeCloseTo(48, 6); expect(x.at.y).toBeCloseTo(-48, 6);
  expect(snapToLines({ x: 90, y: 100 }, L, 12)).toBe(null);
});

test('cpLines: a node on the path\'s own mirror line offers the mirror normal; lines follow a copy in another cell', () => {
  const d = makeDoc();
  const p = line(d, [{ u: 0.2, v: 0.1 }, { u: 0.4, v: 0.4 }]);                        // B (96, 96) lies on y = x
  const el = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 1, dv: 1 });
  P.addBinding(d, p.id, [[el.id]]);
  const L = cpLines(d, p.id, 0, { cell: { c: 0, r: 0 }, bindingId: null, power: 0 });
  expect(L.some((l) => Math.hypot(l.p.x - 96, l.p.y - 96) < 1e-6 && Math.abs(l.dir.x + l.dir.y) < 1e-9)).toBe(true);
  const L2 = cpLines(d, p.id, 0, { cell: { c: 2, r: 0 }, bindingId: null, power: 0 });
  expect(L2.some((l) => Math.hypot(l.p.x - 576, l.p.y - 96) < 1e-6 && Math.abs(l.dir.x + l.dir.y) < 1e-9)).toBe(true);
});
```

- [ ] **Step 3: Run to see them fail**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/snap.test.ts`
Expected: FAIL, `solveCopyMeet` is not exported.

- [ ] **Step 4: Implement**

In `src/engine/snap.ts`, extend the `paths` import with `pathWorld, isClosed, viaMatrix, pathCpsWorld` (and keep `getPath, pathNodes, cloneMatrices`), the type import with `Line, BoxHandle, BodyTargets, BodySnap`, and append:

```ts
// Solve S(pi) + S_L δ = K(pj) + K_L δ for the source-frame delta δ. Full rank: one δ. Rank 1 (a reflection relative to S):
// a line of δ when solvable. K_L = S_L (a translation relative to S): the two move in lockstep, so null.
export function solveCopyMeet(S: Matrix, K: Matrix, pi: XY, pj: XY): { kind: 'point'; delta: XY } | { kind: 'line'; base: XY; dir: XY } | null {
  const A = [S[0] - K[0], S[1] - K[1], S[2] - K[2], S[3] - K[3]];
  const r = sub(apply(K, pj), apply(S, pi));
  const f2 = A[0] ** 2 + A[1] ** 2 + A[2] ** 2 + A[3] ** 2;
  if (f2 < 1e-12) return null;
  const det = A[0] * A[3] - A[2] * A[1];
  if (Math.abs(det) > 1e-9 * f2) return { kind: 'point', delta: { x: (A[3] * r.x - A[2] * r.y) / det, y: (-A[1] * r.x + A[0] * r.y) / det } };
  const base = { x: (A[0] * r.x + A[1] * r.y) / f2, y: (A[2] * r.x + A[3] * r.y) / f2 };
  const back = { x: A[0] * base.x + A[2] * base.y, y: A[1] * base.x + A[3] * base.y };
  if (dist(back, r) > 1e-6 * (1 + Math.hypot(r.x, r.y))) return null;
  const r0 = { x: A[0], y: A[2] }, r1 = { x: A[1], y: A[3] };
  const row = Math.hypot(r0.x, r0.y) >= Math.hypot(r1.x, r1.y) ? r0 : r1, L = Math.hypot(row.x, row.y);
  return { kind: 'line', base, dir: { x: -row.y / L, y: row.x / L } };
}

export function windowCopies(doc: Doc, pathId: string): { copy: Copy; M: Matrix }[] {
  const out: { copy: Copy; M: Matrix }[] = [];
  const clones = doc.bindings.filter((b) => b.pathId === pathId).map((b) => ({ b, ms: cloneMatrices(doc, b.id).matrices }));
  for (const cell of windowOffsets()) {
    const Mo = cellMatrix(cell, doc.lattice);
    out.push({ copy: { cell, bindingId: null, power: 0 }, M: Mo });
    for (const { b, ms } of clones) ms.forEach((M, k) => { if (M) out.push({ copy: { cell, bindingId: b.id, power: k + 1 }, M: compose(Mo, M) }); });
  }
  return out;
}

// A body drag's inputs, taken once at drag start: the moving ends (every node of a closed path) in the source frame, the
// path's own clone copies for SN3 meets, and every point that moves with the path (its own and those of paths that share
// them), whose targets and adjacent lines are excluded.
export function bodyTargets(doc: Doc, set: TargetSet, pathId: string): BodyTargets | null {
  const path = getPath(doc, pathId);
  if (!path) return null;
  const nodes = pathNodes(path), Pw = pathWorld(doc, path);
  const idx = isClosed(path) ? nodes.slice(0, -1).map((_, i) => i) : [0, nodes.length - 1];
  const moving = idx.filter((i) => !nodes[i].via).map((i) => ({ index: i, p: Pw[i] }));
  const own: BodyTargets['own'] = [];
  for (const { copy, M } of windowCopies(doc, pathId)) if (copy.bindingId) for (const m of moving) own.push({ K: M, p: m.p });
  return { pathId, moving, own, exclude: new Set(nodes.map((n) => n.pointId)), set };
}

// The best snap for a raw source-frame delta: each moving end looks for a target (precedence and stickiness as everywhere),
// plus meeting the path's own rotated or mirrored copies (solved, never chased); the best end moves the whole path.
export function snapBodyDelta(T: BodyTargets, raw: XY, threshold: number, sticky: string | null): BodySnap | null {
  const reach = CONFIG.SNAP_STICKY_RELEASE * threshold;
  const exPaths = new Set([T.pathId]);
  let best: BodySnap | null = null;
  const better = (a: SnapResult, b: SnapResult) => (a.id === sticky) || (b.id !== sticky && (a.cls !== b.cls ? a.cls === 'point' : a.d + precedence(a) * 1e-3 * threshold < b.d + precedence(b) * 1e-3 * threshold));
  for (const m of T.moving) {
    const e0 = add(m.p, raw), extra: SnapResult[] = [];
    for (const o of T.own) {
      const r = solveCopyMeet([1, 0, 0, 1, 0, 0], o.K, m.p, o.p);
      if (r?.kind === 'point') {
        const at = add(m.p, r.delta), d = dist(at, e0);
        if (d <= reach) extra.push({ at, cls: 'point', cat: 'ownFixed', id: `own:p:${ptKey(at)}`, label: STR.snap.meetsOwn, hit: { kind: 'own' }, d });
      } else if (r?.kind === 'line') {
        const delta = add(r.base, mul(r.dir, dot(sub(raw, r.base), r.dir))), at = add(m.p, delta), d = dist(at, e0);
        if (d <= reach) extra.push({ at, cls: 'line', cat: 'ownFixed', id: `own:l:${ptKey(add(m.p, r.base))}:${r.dir.x.toFixed(4)}`, label: STR.snap.meetsMirror, hit: { kind: 'own' }, d, line: [add(at, mul(r.dir, -1e4)), add(at, mul(r.dir, 1e4))] });
      }
    }
    const res = pickSnap(T.set, e0, threshold, { extra, sticky, excludePoints: T.exclude, excludePaths: exPaths });
    if (res && (!best || better(res, best.res))) best = { delta: add(raw, sub(res.at, e0)), nodeIndex: m.index, res };
  }
  return best;
}

const unit = (v: XY): XY | null => { const L = Math.hypot(v.x, v.y); return L < 1e-9 ? null : { x: v.x / L, y: v.y / L }; };

export function snapScale(nodes: XY[], lat: Lattice, h: BoxHandle, raw: { sx: number; sy: number }, free: boolean, threshold: number, fractions: readonly number[]): { sx: number; sy: number; snapped: boolean } {
  const xs = nodes.map((p) => p.x), ys = nodes.map((p) => p.y);
  const Wn = Math.max(...xs) - Math.min(...xs), Hn = Math.max(...ys) - Math.min(...ys);
  const spans = (a: number, b: number) => [Math.abs(a), Math.abs(b)].filter((s) => s >= 1).flatMap((s) => fractions.map((f) => f * s));
  const sgn = (s: number) => (s < 0 ? -1 : 1);
  const cands = (ext: number, targets: number[], s: number) => (ext < 1e-6 ? [] : targets.map((t) => (sgn(s) * t) / ext));
  const pick = (s: number, cs: number[], len: number): number | null => {
    let best: number | null = null, bd = threshold;
    for (const c of cs) { const dd = Math.abs(s - c) * len; if (dd <= bd) { bd = dd; best = c; } }
    return best;
  };
  const vx = h.x - h.ax, vy = h.y - h.ay;
  const cx = cands(Wn, spans(lat.ax, lat.bx), raw.sx), cy = cands(Hn, spans(lat.ay, lat.by), raw.sy);
  if (vx && vy && !free) {
    const s = pick(raw.sx, [...cx, ...cy], Math.hypot(vx, vy));
    return s === null ? { ...raw, snapped: false } : { sx: s, sy: s, snapped: true };
  }
  const sx = vx ? pick(raw.sx, cx, Math.abs(vx)) : null, sy = vy ? pick(raw.sy, cy, Math.abs(vy)) : null;
  return { sx: sx ?? raw.sx, sy: sy ?? raw.sy, snapped: sx !== null || sy !== null };
}

// Lines a control point of segment j may snap to, in world at `copy`: horizontal and vertical through either end; through
// an end along any other segment meeting it there (that segment's control point, or other end if straight); through an
// end along the normal of a mirror copy of this path that fixes that end. Worked out at the copy's cell-(0, 0) version,
// then shifted by the copy's cell.
export function cpLines(doc: Doc, pathId: string, j: number, copy: Copy): Line[] {
  const path = getPath(doc, pathId);
  if (!path || !path.segments[j]) return [];
  const M0 = viaMatrix(doc, { ...copy, cell: { c: 0, r: 0 } }), off = toWorld({ u: copy.cell.c, v: copy.cell.r }, doc.lattice);
  const Pw = pathWorld(doc, path), ends = [apply(M0, Pw[j]), apply(M0, Pw[j + 1])];
  const out: Line[] = [];
  for (const X of ends) out.push({ p: X, dir: { x: 1, y: 0 } }, { p: X, dir: { x: 0, y: 1 } });
  const segs = collectSegments(doc).filter((s) => !(s.source.pathId === pathId && s.source.j === j));
  for (const X of ends) for (const s of segs) {
    for (const [end, other] of [[s.a, s.cp ?? s.b], [s.b, s.cp ?? s.a]] as const) {
      if (dist(end, X) > 1e-4) continue;
      const dir = unit(sub(other, end));
      if (dir) out.push({ p: X, dir });
    }
  }
  const M0inv = invert(M0);
  for (const { M: K } of windowCopies(doc, pathId)) {
    const T = compose(K, M0inv);
    if (T[0] * T[3] - T[2] * T[1] >= 0) continue;
    for (const X of ends) {
      if (dist(apply(T, X), X) > 1e-4) continue;
      const c0 = { x: T[0] - 1, y: T[1] }, c1 = { x: T[2], y: T[3] - 1 };
      const dir = unit(Math.hypot(c0.x, c0.y) >= Math.hypot(c1.x, c1.y) ? c0 : c1);
      if (dir) out.push({ p: X, dir });
    }
  }
  return out.map((l) => ({ p: add(l.p, off), dir: l.dir }));
}

export function snapToLines(w: XY, lines: Line[], threshold: number): { at: XY; used: Line[] } | null {
  const nearL = lines.map((l) => ({ l, d: Math.abs(cross(l.dir, sub(w, l.p))) })).filter((x) => x.d <= threshold).sort((a, b) => a.d - b.d);
  if (!nearL.length) return null;
  let best: { at: XY; used: Line[] } | null = null, bd = threshold;
  for (let i = 0; i < nearL.length; i++) for (let k = i + 1; k < nearL.length; k++) {
    const a = nearL[i].l, b = nearL[k].l, den = cross(a.dir, b.dir);
    if (Math.abs(den) < 1e-9) continue;
    const at = add(a.p, mul(a.dir, cross(sub(b.p, a.p), b.dir) / den)), dd = dist(at, w);
    if (dd <= bd) { bd = dd; best = { at, used: [a, b] }; }
  }
  if (best) return best;
  const l = nearL[0].l;
  return { at: add(l.p, mul(l.dir, dot(sub(w, l.p), l.dir))), used: [l] };
}
```

`pathCpsWorld` may end up unused in `snap.ts`; drop it from the import if `tsc` says so.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/snap.test.ts && npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/types.ts src/config.ts src/engine/snap.ts tests/unit/snap.test.ts
git -C ~/Developer/personal/tesselator commit -m "Engine: body-drag snapping on the shared targets; scale fractions; control-point guides

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Snap state, hints, the override key, hover hints and two-stage Esc

**Files:**
- Modify: `src/state/ui.ts`, `src/state/derived.ts`, `src/actions.ts`, `src/interaction/pointer.ts`, `src/components/Canvas.tsx`, `src/styles.css`, `src/components/Chrome.tsx`
- Test: `tests/unit/actions.test.ts`

**Interfaces:**
- Consumes: `buildTargets`, `pickSnap`, `gridResult`, `strokeCopies`, `strokeCands`, `NODE_ONLY` (Task 3).
- Produces:
  - `UI.snapHint: Signal<SnapHint | null>`, `type SnapHint = { at: XY; label?: string; line?: XY[] }` (exported from `ui.ts`); `UI.snapSticky: Signal<string | null>`. Both reset by `resetUi`.
  - `snapTargets` computed in `derived.ts`: `computed(() => buildTargets(doc.value))`.
  - `A.hintOf(s: SnapResult | null): SnapHint | null`
  - `A.drawSnap(w: XY, on: boolean, hitScale: number, stroke: { pts: XY[]; groups: string[][][] } | null): SnapResult | null`
  - `A.penStroke(): { pts: XY[]; groups: string[][][] } | null`
  - `A.hoverSnap(w: XY, on: boolean, hitScale: number): void` — sets `snapHint` and `snapSticky` for Pen and Freehand.
  - `ctx.snapOn = prefs.snap !== (metaKey || ctrlKey)`.

- [ ] **Step 1: Failing tests**

Append to `tests/unit/actions.test.ts` (it already has `fresh()` and `W(u, v)`; add `import { snapTargets } from '../../src/state/derived';` beside the other derived import):

```ts
test('drawSnap: a mirror axis attracts a Pen point; with snapping off only existing points do', () => {
  fresh();
  A.addElement('mirror'); A.setTool('pen'); A.clearSel();      // a mirror along b through the tile centre: x = 120 (addElement selects it)
  const s = A.drawSnap({ x: 116, y: 60 }, true, 1, null)!;
  expect(s.cat).toBe('axis'); expect(s.at.x).toBeCloseTo(120, 6);
  expect(A.drawSnap({ x: 116, y: 60 }, false, 1, null)).toBe(null);
  A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.4, 0.1), false); A.endPen();
  expect(A.drawSnap({ x: 26, y: 26 }, false, 1, null)?.cat).toBe('node');
});

test('hoverSnap publishes the hint and the held id; Esc semantics live in pointer.ts', () => {
  fresh();
  A.addElement('mirror'); A.setTool('freehand');
  A.hoverSnap({ x: 117, y: 60 }, true, 1);
  expect(UI.snapHint.value?.at.x).toBeCloseTo(120, 6);
  expect(UI.snapSticky.value).toBeTruthy();
  expect(snapTargets.value.lines.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/actions.test.ts -t "drawSnap|hoverSnap"`
Expected: FAIL, `A.drawSnap is not a function`.

- [ ] **Step 3: UI state and derived targets**

In `src/state/ui.ts` add (and import `XY` if missing):

```ts
export type SnapHint = { at: XY; label?: string; line?: XY[] };
export const snapHint = signal<SnapHint | null>(null);       // what the current gesture or hover would snap to, for the canvas
export const snapSticky = signal<string | null>(null);       // id of the held snap (spec SN4, H6): hover hands it to the press
```

and in `resetUi` add `snapHint.value = null; snapSticky.value = null;`.

In `src/state/derived.ts` add `import { buildTargets } from '../engine/snap';` and:

```ts
// Snap targets for the current document (recomputed on commit; drags take them once at drag start).
export const snapTargets = computed(() => buildTargets(doc.value));
```

- [ ] **Step 4: Actions**

In `src/actions.ts` add imports: `import { pickSnap, gridResult, strokeCopies, strokeCands, NODE_ONLY } from './engine/snap';`, `snapTargets` from `./state/derived` (merge with the existing derived import), and `SnapResult` from `./types`. Then add after `snapDeltaUV`:

```ts
export function hintOf(s: SnapResult | null): UI.SnapHint | null { return s ? { at: s.at, label: s.label, line: s.line } : null; }

// The snap for a drawing point (Pen click, stroke start or end, hover): every target, the stroke's own targets, the held
// snap; the grid when nothing else is near. With snapping off only existing points attract.
export function drawSnap(w: XY, on: boolean, hitScale: number, stroke: { pts: XY[]; groups: string[][][] } | null): SnapResult | null {
  const thr = threshold(hitScale), d = doc.value;
  const extra = on && stroke ? strokeCands(stroke.pts, stroke.groups.flatMap((g) => strokeCopies(d, g)), w, thr) : [];
  const s = pickSnap(snapTargets.value, w, thr, { extra, sticky: UI.snapSticky.value, cats: on ? undefined : NODE_ONLY });
  return s ?? (on ? gridResult(w, d.lattice, UI.prefs.value.gridDivisions) : null);
}

// The Pen path in progress as a stroke: its world nodes and its bindings' groups.
export function penStroke(): { pts: XY[]; groups: string[][][] } | null {
  const pn = UI.pen.value, p = pn && P.getPath(doc.value, pn.pathId);
  if (!p) return null;
  return { pts: P.pathWorld(doc.value, p), groups: doc.value.bindings.filter((b) => b.pathId === p.id).map((b) => b.groups) };
}

export function hoverSnap(w: XY, on: boolean, hitScale: number): void {
  const s = drawSnap(w, on, hitScale, UI.tool.value === 'pen' ? penStroke() : null);
  const shown = s && s.cat !== 'grid' ? s : null;           // the grid is not worth a hint
  UI.snapHint.value = hintOf(shown);
  UI.snapSticky.value = shown?.id ?? null;
}
```

- [ ] **Step 5: Pointer**

In `src/interaction/pointer.ts`:

- `ctxOf`: replace `snapOn: UI.prefs.value.snap !== e.shiftKey` with `snapOn: UI.prefs.value.snap !== (e.metaKey || e.ctrlKey)`.
- In `onMove`, replace `if (!d) { UI.hover.value = hitTest(doc.value, hitCtx(scaleOf(e)), w); return; }` with:

```ts
    if (!d) {
      UI.hover.value = hitTest(doc.value, hitCtx(scaleOf(e)), w);
      const drawing = UI.layer.value === 'drawing' && (UI.tool.value === 'pen' || UI.tool.value === 'freehand');
      if (drawing && !UI.hover.value) { const c = ctxOf(e); A.hoverSnap(w, c.snapOn, c.hitScale); }
      else if (UI.snapHint.value) { UI.snapHint.value = null; UI.snapSticky.value = null; }
      return;
    }
```

- In `onUp`, after the `try { … } finally { endGesture(); }` line add `UI.snapHint.value = null; UI.snapSticky.value = null;`.
- In `onCancel`, inside the `if (UI.drag.value || dragTool)` block add `UI.snapHint.value = null; UI.snapSticky.value = null;`.
- Replace the `case 'Escape':` line with the two-stage rule (K1):

```ts
      case 'Escape':
        if (UI.drag.value) { abortGesture(); UI.drag.value = null; dragTool = null; UI.fillPreview.value = null; UI.snapHint.value = null; UI.snapSticky.value = null; return; }   // cancel the gesture, restoring what it moved
        if (UI.pen.value) { A.endPen(); return; }
        A.clearSel(); A.setTool('select'); return;
```

`abortGesture` reverts the gesture's commits when one is open; a drag that never moved has none. A Freehand stroke commits only on release, so cancelling it discards it.

- [ ] **Step 6: Canvas mark and copy**

In `src/components/Canvas.tsx`, add `snapHint` to the `../state/ui` import and:

```tsx
function SnapMark() {
  const h = snapHint.value;
  if (!h) return null;
  const z = view.value.zoom;
  return <g class="snap-mark">
    {h.line && <polyline class="snap-line" points={h.line.map((p) => `${p.x},${p.y}`).join(' ')} />}
    <circle class="snap-ring" cx={h.at.x} cy={h.at.y} r={7 / z} />
    {h.label && <text class="snap-label" x={h.at.x + 10 / z} y={h.at.y - 10 / z} font-size={12 / z}>{h.label}</text>}
  </g>;
}
```

Render `<SnapMark />` last in the overlay list (after `<LatticeHandles />`). In `src/styles.css` after `.guide`:

```css
.snap-ring { fill: none; stroke: #e8590c; stroke-width: 2; vector-effect: non-scaling-stroke; }
.snap-line { fill: none; stroke: #e8590c; stroke-width: 3; opacity: 0.45; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.snap-label { fill: #e8590c; font-weight: 600; paint-order: stroke; stroke: var(--bg); stroke-width: 3px; pointer-events: none; }
```

In `src/components/Chrome.tsx`: the Snap button title becomes `"Snapping (G); hold ⌘ or Ctrl to invert for one gesture"`; in `Help`, replace `<K k="G" /> snap (hold <K k="⇧" /> to invert)` with `<K k="G" /> snap (hold <K k="⌘" /> or <K k="Ctrl" /> to invert)`, and append to the first `<span>` line: ` · <K k="Esc" /> cancels what is in progress, again clears and returns to Select`.

- [ ] **Step 7: Run everything**

Run: `npx vitest run --root ~/Developer/personal/tesselator && npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: PASS. Any existing test that relied on `⇧` inverting snapping through `ctxOf` is not reachable from unit tests (they call actions directly); none should change.

- [ ] **Step 8: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/state/ui.ts src/state/derived.ts src/actions.ts src/interaction/pointer.ts src/components/Canvas.tsx src/styles.css src/components/Chrome.tsx tests/unit/actions.test.ts
git -C ~/Developer/personal/tesselator commit -m "Snap hints with labels, Cmd/Ctrl inverts snapping, hover hints while drawing, two-stage Esc

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Select drags snap and join on release

**Files:**
- Modify: `src/types.ts` (drag fields), `src/actions.ts`, `src/interaction/tools/select.ts`, `src/interaction/tools/pen.ts`
- Test: `tests/unit/select.test.ts` (new)

**Interfaces:**
- Consumes: Tasks 3–6.
- Produces:
  - Drag fields: `pt` drag becomes `{ kind: 'pt'; pointId; cell; via?; targets: TargetSet; snap: SnapResult | null }` (the `snapTo` field is removed); `canchor` gains `targets: TargetSet; snap: SnapResult | null`; `body` gains `targets: BodyTargets | null; snap: BodySnap | null`; `cp` gains `lines: Line[]`; `bbox` gains `nodes: XY[]`.
  - `A.joinDroppedNode(pathId: string, nodeIndex: number, hit: SnapHit): boolean`
  - `A.joinDroppedPoint(pointId: string, cell: Cell, hit: SnapHit): boolean` (replaces `mergeDroppedPoint`, keeping its selection fix-ups)

- [ ] **Step 1: Failing tests**

Create `tests/unit/select.test.ts`:

```ts
import { test, expect } from 'vitest';
import { doc, emptyDoc } from '../../src/state/doc';
import * as UI from '../../src/state/ui';
import * as A from '../../src/actions';
import * as P from '../../src/engine/paths';
import * as S from '../../src/interaction/tools/select';
import { reset, beginGesture, endGesture } from '../../src/state/history';
import type { Doc, HitTarget, XY, UV, Copy } from '../../src/types';

const base: Copy = { cell: { c: 0, r: 0 }, bindingId: null, power: 0 };
const ev = () => ({ pointerId: 1, shiftKey: false, metaKey: false, ctrlKey: false, pointerType: 'mouse' }) as unknown as PointerEvent;
const ctxOn = { snapOn: true, hitScale: 1, threshold: 12 }, ctxOff = { snapOn: false, hitScale: 1, threshold: 12 };
function fresh(build: (d: Doc) => void) { reset(); UI.resetUi(); const d = emptyDoc(); build(d); doc.value = d; UI.tool.value = 'select'; UI.view.value = { pan: { x: 0, y: 0 }, zoom: 1 }; }
function line(d: Doc, pts: UV[], layerId = d.layers[0].id) {
  const p = P.startPath(d, P.addPoint(d, pts[0]), { color: '#000', weight: 2 }, layerId);
  for (const uv of pts.slice(1)) P.appendNode(d, p.id, P.addPoint(d, uv));
  return p;
}
// Mirrors pointer.ts: the gesture opens on the first move and closes after the tool's onUp.
function drag(t: HitTarget, from: XY, to: XY | XY[], ctx = ctxOn) {
  S.onDown(t, from, ev(), ctx);
  const d = UI.drag.value!;
  d.moved = true; beginGesture();
  for (const p of Array.isArray(to) ? to : [to]) S.onMove(d, p, ev(), ctx);
  UI.drag.value = null;
  S.onUp(d, Array.isArray(to) ? to[to.length - 1] : to, ev(), ctx);
  endGesture();
}
const seg = (pathId: string, copy: Copy = base): HitTarget => ({ kind: 'segment', pathId, j: 0, copy });

test('a body drag released on another path\'s line splits it and shares the point; one undo reverts both', () => {
  let stubId = '', hostId = '';
  fresh((d) => { hostId = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]).id; stubId = line(d, [{ u: 0.5, v: 0.1 }, { u: 0.5, v: 0.45 }]).id; });
  const endId = P.getPath(doc.value, stubId)!.segments[0].to.pointId;
  drag(seg(stubId), { x: 120, y: 60 }, { x: 120, y: 70 });            // the end goes to (120, 118), 2 from the host
  const host = P.getPath(doc.value, hostId)!, stub = P.getPath(doc.value, stubId)!;
  expect(host.segments).toHaveLength(2);
  expect(host.segments[0].to.pointId).toBe(stub.segments[0].to.pointId);
  A.undo();
  expect(P.getPath(doc.value, hostId)!.segments).toHaveLength(1);
  expect(P.getPoint(doc.value, endId)!.v).toBeCloseTo(0.45, 9);
});

test('a body drag onto a line on another layer moves but does not join', () => {
  let stubId = '', hostId = '';
  fresh((d) => { d.layers.push({ id: 'L2', name: 'Layer 2' }); hostId = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }], 'L2').id; stubId = line(d, [{ u: 0.5, v: 0.1 }, { u: 0.5, v: 0.45 }]).id; });
  drag(seg(stubId), { x: 120, y: 60 }, { x: 120, y: 70 });
  expect(P.getPath(doc.value, hostId)!.segments).toHaveLength(1);
  expect(P.nodeWorld(doc.value, P.getPath(doc.value, stubId)!.segments[0].to).y).toBeCloseTo(120, 6);   // it still landed on the line
});

test('drag through cell (2, 0) snaps and joins as in the base cell', () => {
  let stubId = '', hostId = '';
  fresh((d) => { hostId = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]).id; stubId = line(d, [{ u: 0.5, v: 0.1 }, { u: 0.5, v: 0.45 }]).id; });
  drag(seg(stubId, { cell: { c: 2, r: 0 }, bindingId: null, power: 0 }), { x: 600, y: 60 }, { x: 600, y: 70 });
  expect(P.getPath(doc.value, hostId)!.segments).toHaveLength(2);
});

test('with snapping off a body drag moves by the raw delta and joins nothing', () => {
  let stubId = '', hostId = '';
  fresh((d) => { hostId = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]).id; stubId = line(d, [{ u: 0.5, v: 0.1 }, { u: 0.5, v: 0.45 }]).id; });
  drag(seg(stubId), { x: 120, y: 60 }, { x: 120, y: 70 }, ctxOff);
  expect(P.getPath(doc.value, hostId)!.segments).toHaveLength(1);
  expect(P.nodeWorld(doc.value, P.getPath(doc.value, stubId)!.segments[0].to).y).toBeCloseTo(118, 6);
});

test('a point drag settles on the mirror axis, not on its own mirror image', () => {
  let pid = '';
  fresh((d) => {
    const el = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });   // x = 120
    const p = line(d, [{ u: 0.3, v: 0.2 }, { u: 0.3, v: 0.6 }]);
    P.addBinding(d, p.id, [[el.id]]);
    pid = p.start.pointId;
  });
  const t: HitTarget = { kind: 'point', pointId: pid, cell: { c: 0, r: 0 } };
  drag(t, { x: 72, y: 48 }, [{ x: 100, y: 48 }, { x: 110, y: 48 }, { x: 114, y: 48 }, { x: 116, y: 48 }]);
  const w = P.nodeWorld(doc.value, { pointId: pid, cell: { c: 0, r: 0 } });
  expect(w.x).toBeCloseTo(120, 6); expect(w.y).toBeCloseTo(48, 6);
});

test('a point dropped on another path\'s line joins it (same layer)', () => {
  let hostId = '', stubId = '', pid = '';
  fresh((d) => { hostId = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]).id; const s = line(d, [{ u: 0.5, v: 0.1 }, { u: 0.5, v: 0.3 }]); stubId = s.id; pid = s.segments[0].to.pointId; });
  drag({ kind: 'point', pointId: pid, cell: { c: 0, r: 0 } }, { x: 120, y: 72 }, { x: 121, y: 117 });
  const host = P.getPath(doc.value, hostId)!, stub = P.getPath(doc.value, stubId)!;
  expect(host.segments).toHaveLength(2);
  expect(stub.segments[0].to.pointId).toBe(host.segments[0].to.pointId);
});

test('a control-point drag snaps to the horizontal through its anchor', () => {
  let pid = '';
  fresh((d) => { pid = line(d, [{ u: 0.2, v: 0.2 }, { u: 0.6, v: 0.6 }]).id; });
  drag({ kind: 'diamond', pathId: pid, j: 0, copy: base }, { x: 96, y: 96 }, { x: 100, y: 52 });
  const cp = P.cpWorld(doc.value, P.getPath(doc.value, pid)!, 0)!;
  expect(cp.y).toBeCloseTo(48, 6); expect(cp.x).toBeCloseTo(100, 6);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/select.test.ts`
Expected: FAIL (no join on body drop, the point does not settle on the axis, no cp snap).

- [ ] **Step 3: Types**

In `src/types.ts`, in the `Drag` union:

```ts
  | { kind: 'pt'; pointId: string; cell: Cell; via?: Copy; targets: TargetSet; snap: SnapResult | null; unlinked?: boolean }
  | { kind: 'body'; pathId: string; copy: Copy; ids: string[]; startPos: Record<string, UV>; startEls: Element[]; targets: BodyTargets | null; snap: BodySnap | null }
  | { kind: 'canchor'; pathId: string; pointId: string; cell: Cell; copy: Copy; targets: TargetSet; snap: SnapResult | null; unlinked?: boolean }
  | { kind: 'cp'; pathId: string; j: number; copy: Copy; lines: Line[] }
  | { kind: 'bbox'; mode: 'scale' | 'rot'; h: BoxHandle; box: Box; cx: number; cy: number; pathId: string; copy: Copy; startDoc: Doc; M: Matrix | null; nodes: XY[] }
```

(`unlinked` is used by Task 8.)

- [ ] **Step 4: Actions**

In `src/actions.ts` add `import { joinPointToHit } from './engine/joins';` and `SnapHit` to the type import. Replace `mergeDroppedPoint` with:

```ts
// A point drag released on a snap joins the point to what it landed on (same layer only; see engine/joins.ts).
export function joinDroppedPoint(pointId: string, cell: Cell, hit: SnapHit): boolean {
  const layerOf = (d: Doc) => d.paths.find((p) => P.pathNodes(p).some((n) => n.pointId === pointId))?.layerId ?? activeLayerId(d);
  let toId: string | null = null;
  const ok = mutate((d) => {
    if (!P.getPoint(d, pointId)) return false;
    const before = new Set(d.points.map((q) => q.id));
    if (!joinPointToHit(d, pointId, cell, hit, layerOf(d))) return false;
    const users = d.paths.flatMap((p) => P.pathNodes(p)).map((n) => n.pointId);
    toId = hit.kind === 'node' ? hit.pointId : users.find((id) => !before.has(id)) ?? null;
  });
  if (!ok) return false;
  const s = UI.selection.value;
  if (s && s.kind === 'points' && toId) UI.selection.value = { kind: 'points', ids: [...new Set(s.ids.map((id) => (id === pointId ? toId! : id)))] };
  else if (s && s.kind === 'path' && !P.getPath(doc.value, s.id)) UI.selection.value = null;
  if (UI.pen.value && !P.getPath(doc.value, UI.pen.value.pathId)) UI.pen.value = null;
  return true;
}

// A body drag released on a snap joins the snapped end (same layer only). Corners, axes and the path's own copies join nothing.
export function joinDroppedNode(pathId: string, nodeIndex: number, hit: SnapHit): boolean {
  if (hit.kind !== 'node' && hit.kind !== 'curve') return false;
  return mutate((d) => {
    const path = P.getPath(d, pathId);
    const from = path && P.pathNodes(path)[nodeIndex];
    if (!path || !from || from.via) return false;
    return joinPointToHit(d, from.pointId, from.cell, hit, path.layerId) ? undefined : false;
  });
}
```

Search the code for `mergeDroppedPoint` (Pen tool) and update it in Step 6.

- [ ] **Step 5: Select tool**

In `src/interaction/tools/select.ts` add imports: `snapTargets` from `../../state/derived` (beside `copyMatrix`), `{ pickSnap, gridResult, pointCopyMatrices, ownFixedCands, NODE_ONLY, bodyTargets, snapBodyDelta, snapScale, cpLines, snapToLines }` from `../../engine/snap`, `{ cellMatrix }` from `../../engine/transform` (merge), `CONFIG` is already imported, and `Matrix` from types.

Add a shared point-snap helper:

```ts
// Snap for a node being dragged: every target except the point itself and lines touching it, plus its own clones resolved
// to their axis or centre (SN3), the held snap, and the grid as a fallback. S maps the point's base-cell position to the drag.
function nodeSnap(targets: TargetSet, pointId: string, S: Matrix, w: XY, ctx: ToolCtx): SnapResult | null {
  const extra = ctx.snapOn ? ownFixedCands(S, pointCopyMatrices(doc.value, pointId), w, ctx.threshold) : [];
  const s = pickSnap(targets, w, ctx.threshold, { extra, sticky: UI.snapSticky.value, excludePoints: new Set([pointId]), cats: ctx.snapOn ? undefined : NODE_ONLY });
  return s ?? (ctx.snapOn ? gridResult(w, doc.value.lattice, UI.prefs.value.gridDivisions) : null);
}
```

(import `TargetSet`, `SnapResult` types; `ToolCtx` is already imported.)

`pointDown`: the `pt` spec becomes `{ kind: 'pt', pointId: t.pointId, cell: t.cell, via: t.via, targets: snapTargets.value, snap: null }`.

`onDown`:

```ts
    case 'canchor': return startDrag(e, t, w, ctx.hitScale, { kind: 'canchor', pathId: t.pathId, pointId: t.pointId, cell: t.cell, copy: t.copy, targets: snapTargets.value, snap: null });
    case 'diamond': return startDrag(e, t, w, ctx.hitScale, { kind: 'cp', pathId: t.pathId, j: t.j, copy: t.copy, lines: cpLines(doc.value, t.pathId, t.j, t.copy) });
```

and the `segment` case's body spec gains `targets: null, snap: null`. In `startBBox` add `nodes: P.pathWorld(doc.value, path).map((q) => apply(M, q))` to the spec.

`onMove`, `pt` case:

```ts
    case 'pt': {
      if (!d.moved) return;
      const S = d.via ? compose(P.viaMatrix(doc.value, d.via), cellMatrix(d.cell, doc.value.lattice)) : cellMatrix(d.cell, doc.value.lattice);
      const s = nodeSnap(d.targets, d.pointId, S, w, ctx);
      d.snap = s; UI.snapSticky.value = s?.id ?? null; UI.snapHint.value = A.hintOf(s && s.cat !== 'grid' ? s : null);
      const at = s ? s.at : w;
      const src = d.via ? apply(invert(P.viaMatrix(doc.value, d.via)), at) : at;
      A.mutate((dd) => { const uv = toUV(src, dd.lattice); P.movePoint(dd, d.pointId, uv.u - d.cell.c, uv.v - d.cell.r); });
      return;
    }
```

`canchor` case:

```ts
    case 'canchor': {
      if (!d.moved) return;
      const M = copyMatrix(d.copy), S = compose(M, cellMatrix(d.cell, doc.value.lattice));
      const s = nodeSnap(d.targets, d.pointId, S, w, ctx);
      d.snap = s; UI.snapSticky.value = s?.id ?? null; UI.snapHint.value = A.hintOf(s && s.cat !== 'grid' ? s : null);
      const src = apply(invert(M), s ? s.at : w);
      A.mutate((dd) => { const uv = toUV(src, dd.lattice); P.movePoint(dd, d.pointId, uv.u - d.cell.c, uv.v - d.cell.r); });
      return;
    }
```

`body` case:

```ts
    case 'body': {
      if (!d.moved) return;
      if (d.copy.bindingId) { cloneBodyMove(d, w, ctx); return; }
      // A source or cell copy is a pure translation of the source, so the pointer delta is the source delta.
      if (!d.targets) d.targets = bodyTargets(doc.value, snapTargets.value, d.pathId);
      const raw = { x: w.x - d.start.x, y: w.y - d.start.y };
      const sn = ctx.snapOn && d.targets ? snapBodyDelta(d.targets, raw, ctx.threshold, UI.snapSticky.value) : null;
      d.snap = sn; UI.snapSticky.value = sn?.res.id ?? null;
      const dv = sn ? A.uvOf(sn.delta) : A.snapDeltaUV(raw, ctx.snapOn);
      const off = A.worldOf({ u: d.copy.cell.c, v: d.copy.cell.r }), sh = (p: XY): XY => ({ x: p.x + off.x, y: p.y + off.y });
      UI.snapHint.value = sn ? { at: sh(sn.res.at), label: sn.res.label, line: sn.res.line?.map(sh) } : null;
      A.mutate((dd) => { P.movePointsBy(dd, d.ids, d.startPos, dv.u, dv.v); });
      return;
    }
```

`cp` case:

```ts
    case 'cp': {
      if (!d.moved) return;
      const M = copyMatrix(d.copy), s = ctx.snapOn ? snapToLines(w, d.lines, ctx.threshold) : null;
      UI.snapHint.value = s ? { at: s.at, label: STR.snap.guide, line: s.used.flatMap((l) => [{ x: l.p.x - l.dir.x * 1e4, y: l.p.y - l.dir.y * 1e4 }, { x: l.p.x + l.dir.x * 1e4, y: l.p.y + l.dir.y * 1e4 }]) } : null;
      A.mutate((dd) => { P.setControlPointWorld(dd, d.pathId, d.j, apply(invert(M), s ? s.at : w)); });
      return;
    }
```

(import `STR` from `../../strings`.) In the `bbox` case replace the scale `else` branch:

```ts
      } else {
        const free = e.shiftKey || UI.freeScale.value;
        let { sx, sy } = scaleFor(d.h, w, free);
        UI.snapHint.value = null;
        if (UI.prefs.value.snap) {   // ⇧ means "free" here, so it does not invert snapping
          const s = snapScale(d.nodes, doc.value.lattice, d.h, { sx, sy }, free, ctx.threshold, CONFIG.SCALE_FRACTIONS);
          if (s.snapped) { sx = s.sx; sy = s.sy; UI.snapHint.value = { at: { x: d.h.ax + sx * (d.h.x - d.h.ax), y: d.h.ay + sy * (d.h.y - d.h.ay) }, label: STR.snap.scale(`${Math.round(sx * 1000) / 1000} × ${Math.round(sy * 1000) / 1000}`) }; }
        }
        T = scaleMatrix(d.h.ax, d.h.ay, sx, sy);
      }
```

and after the bbox `commit(next)`, when no scale hint was set, hint the first endpoint that now sits on a point target (E6, H5):

```ts
      if (!UI.snapHint.value && UI.prefs.value.snap) {
        const ends = d.nodes.length ? [apply(T, d.nodes[0]), apply(T, d.nodes[d.nodes.length - 1])] : [];
        for (const q of ends) { const s = pickSnap(snapTargets.value, q, ctx.threshold, { pointsOnly: true, excludePaths: new Set([d.pathId]) }); if (s && s.d < 1) { UI.snapHint.value = A.hintOf(s); break; } }
      }
```

`onUp`: replace `if (d.kind === 'pt' && d.moved && d.snapTo) { A.mergeDroppedPoint(…); return; }` with:

```ts
  if (d.kind === 'pt' && d.moved && d.snap && !d.via) { A.joinDroppedPoint(d.pointId, d.cell, d.snap.hit); return; }
  if (d.kind === 'body' && d.moved && d.snap) { A.joinDroppedNode(d.pathId, d.snap.nodeIndex, d.snap.res.hit); return; }
```

Delete the now-unused `linear` helper if `tsc` flags it.

- [ ] **Step 6: Pen tool**

In `src/interaction/tools/pen.ts`, `onUp`: replace the `mergeDroppedPoint` line with `if (d.kind === 'pt' && d.moved && d.snap && !d.via) { A.joinDroppedPoint(d.pointId, d.cell, d.snap.hit); UI.cursor.value = null; return; }`.

- [ ] **Step 7: Run everything**

Run: `npx vitest run --root ~/Developer/personal/tesselator && npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: PASS. Existing tests that called `A.mergeDroppedPoint` must call `A.joinDroppedPoint(fromId, fromCell, { kind: 'node', pointId: toId, cell: toCell, copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 } })` instead; update them and name them in the commit message. Existing tests that build `pt` drags by hand need `targets: snapTargets.value, snap: null` instead of `snapTo: null`.

- [ ] **Step 8: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/types.ts src/actions.ts src/interaction/tools/select.ts src/interaction/tools/pen.ts tests/unit/select.test.ts tests/unit/actions.test.ts
git -C ~/Developer/personal/tesselator commit -m "Select: node, body, scale and control-point drags snap; drops join within a layer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Dragging a node of the selected path unlinks it

**Files:**
- Modify: `src/engine/paths.ts`, `src/actions.ts`, `src/interaction/tools/select.ts`, `src/components/Chrome.tsx`
- Test: `tests/unit/paths.test.ts`, `tests/unit/unlink.test.ts` (new)

**Interfaces:**
- Produces: `detachFromPath(doc: Doc, pathId: string, node: Node): Node | null` (`paths.ts`); `A.unlinkNode(pathId: string, pointId: string, via?: Copy): Node | null`. Uses the `unlinked?: boolean` drag fields from Task 7.

- [ ] **Step 1: Failing engine tests**

Append to `tests/unit/paths.test.ts`:

```ts
test('detachFromPath gives the path its own copy of a shared point; the other path keeps the old one', () => {
  const doc = makeDoc();
  const a = polyline(doc, [{ u: 0.2, v: 0.2 }, { u: 0.5, v: 0.5 }]);
  const shared = a.segments[0].to;
  const b = P.startPath(doc, { ...shared, cell: { ...shared.cell } }, { color: '#000', weight: 2 }, 'L1');
  P.appendNode(doc, b.id, P.addPoint(doc, { u: 0.8, v: 0.2 }));
  const n = P.detachFromPath(doc, a.id, shared)!;
  expect(n.pointId).not.toBe(shared.pointId);
  expect(a.segments[0].to).toEqual(n);
  expect(b.start.pointId).toBe(shared.pointId);
  closeXY(P.nodeWorld(doc, n), 120, 120);
  expect(P.detachFromPath(doc, a.id, n)).toBe(null);
});

test('detachFromPath keeps a closed path closed and leaves its control points alone', () => {
  const doc = makeDoc();
  const sq = polyline(doc, [{ u: 0.2, v: 0.2 }, { u: 0.6, v: 0.2 }, { u: 0.6, v: 0.6 }]);
  P.appendNode(doc, sq.id, { ...sq.start, cell: { ...sq.start.cell } });
  P.setControlPointAbs(doc, sq.id, 2, { u: 0.3, v: 0.5 });
  const other = P.startPath(doc, { ...sq.start, cell: { c: 1, r: 0 } }, { color: '#000', weight: 2 }, 'L1');
  P.appendNode(doc, other.id, P.addPoint(doc, { u: 0.9, v: 0.9 }));
  const n = P.detachFromPath(doc, sq.id, sq.start)!;
  expect(P.isClosed(sq)).toBe(true);
  expect(sq.segments[2].to.pointId).toBe(n.pointId);
  expect(P.cpAbs(sq, 2)).toEqual({ u: 0.3, v: 0.5 });
  expect(other.start.pointId).not.toBe(n.pointId);
});

test('detachFromPath turns a via end into a plain node where it was', () => {
  const doc = makeDoc();
  const body = polyline(doc, [{ u: 0.1, v: 0.1 }, { u: 0.3, v: 0.1 }]);
  const el = P.addElement(doc, { kind: 'rotate', u: 0.5, v: 0.5, n: 2 });
  const b = P.addBinding(doc, body.id, [[el.id]]);
  const tail = P.startPath(doc, P.addPoint(doc, { u: 0.5, v: 0.6 }), { color: '#000', weight: 2 }, 'L1');
  const via = { pointId: body.start.pointId, cell: { c: 0, r: 0 }, via: { cell: { c: 0, r: 0 }, bindingId: b.id, power: 1 } };
  P.appendNode(doc, tail.id, via);
  P.setControlPointAbs(doc, tail.id, 0, { u: 0.7, v: 0.7 });
  const at = P.nodeWorld(doc, via), cp = P.cpAbs(tail, 0)!;
  const n = P.detachFromPath(doc, tail.id, via)!;
  expect(n.via).toBeUndefined();
  expect(tail.segments[0].to).toEqual(n);
  closeXY(P.nodeWorld(doc, n), at.x, at.y);
  expect(P.cpAbs(tail, 0)!.u).toBeCloseTo(cp.u, 9); expect(P.cpAbs(tail, 0)!.v).toBeCloseTo(cp.v, 9);
  expect(P.getPoint(doc, body.start.pointId)).not.toBe(null);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/paths.test.ts -t "detachFromPath"`
Expected: FAIL, `P.detachFromPath is not a function`.

- [ ] **Step 3: Implement `detachFromPath`**

In `src/engine/paths.ts`, after `mergeIntoNode` (import `makeId` is already present):

```ts
// Give path `pathId` its own point for `node`, so a drag of it leaves every other path (and every via node elsewhere that
// saw the old point) where it is. A plain node: every plain node of the path on that point switches to a new point at the
// same (u, v), each keeping its cell; null when no other path references the point. A via node: it, and every node of the
// path equal to it, becomes a plain node at a new point at its world position. Control points are re-based so they do not move.
export function detachFromPath(doc: Doc, pathId: string, node: Node): Node | null {
  const path = getPath(doc, pathId), pt = getPoint(doc, node.pointId);
  if (!path || !pt) return null;
  const abs = path.segments.map((_, j) => cpAbs(path, j));
  let map: (n: Node) => Node, fresh: Node;
  if (node.via) {
    const f = addPoint(doc, toUV(nodeWorld(doc, node), doc.lattice));
    fresh = f;
    map = (n) => (sameNode(n, node) ? { pointId: f.pointId, cell: { ...f.cell } } : n);
  } else {
    if (!doc.paths.some((p) => p.id !== pathId && pathNodes(p).some((n) => n.pointId === node.pointId))) return null;
    const np = { id: makeId('pt'), u: pt.u, v: pt.v };
    doc.points.push(np);
    fresh = { pointId: np.id, cell: { ...node.cell } };
    map = (n) => (n.pointId === node.pointId && !n.via ? { pointId: np.id, cell: { ...n.cell } } : n);
  }
  path.start = map(path.start);
  for (const s of path.segments) s.to = map(s.to);
  path.segments.forEach((s, j) => { const c = abs[j]; s.cp = c && rel(c, prevNode(path, j).cell); });
  return fresh;
}
```

- [ ] **Step 4: Run the engine tests**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Failing interaction tests**

Create `tests/unit/unlink.test.ts`:

```ts
import { test, expect } from 'vitest';
import { doc, emptyDoc } from '../../src/state/doc';
import * as UI from '../../src/state/ui';
import * as A from '../../src/actions';
import * as P from '../../src/engine/paths';
import * as S from '../../src/interaction/tools/select';
import { reset, beginGesture, endGesture } from '../../src/state/history';
import type { Doc, HitTarget, XY, UV, Copy } from '../../src/types';

const base: Copy = { cell: { c: 0, r: 0 }, bindingId: null, power: 0 };
const ev = () => ({ pointerId: 1, shiftKey: false, metaKey: false, ctrlKey: false, pointerType: 'mouse' }) as unknown as PointerEvent;
const ctxOff = { snapOn: false, hitScale: 1, threshold: 12 };
function line(d: Doc, pts: UV[]) {
  const p = P.startPath(d, P.addPoint(d, pts[0]), { color: '#000', weight: 2 }, d.layers[0].id);
  for (const uv of pts.slice(1)) P.appendNode(d, p.id, P.addPoint(d, uv));
  return p;
}
function scene() {
  reset(); UI.resetUi(); UI.tool.value = 'select'; UI.view.value = { pan: { x: 0, y: 0 }, zoom: 1 };
  const d = emptyDoc();
  const a = line(d, [{ u: 0.2, v: 0.2 }, { u: 0.5, v: 0.5 }]), shared = a.segments[0].to;
  const b = P.startPath(d, { ...shared, cell: { ...shared.cell } }, { color: '#000', weight: 2 }, d.layers[0].id);
  P.appendNode(d, b.id, P.addPoint(d, { u: 0.8, v: 0.2 }));
  doc.value = d;
  return { aId: a.id, bId: b.id, shared: shared.pointId };
}
function drag(t: HitTarget, from: XY, to: XY) {
  S.onDown(t, from, ev(), ctxOff);
  const d = UI.drag.value!;
  d.moved = true; beginGesture();
  S.onMove(d, to, ev(), ctxOff);
  UI.drag.value = null;
  S.onUp(d, to, ev(), ctxOff);
  endGesture();
}
const pt = (pointId: string): HitTarget => ({ kind: 'point', pointId, cell: { c: 0, r: 0 } });
const endOf = (id: string) => P.getPath(doc.value, id)!.segments[0].to;
const startOf = (id: string) => P.getPath(doc.value, id)!.start;

test('with its path selected, dragging a shared node moves only that path; one undo relinks', () => {
  const { aId, bId, shared } = scene();
  UI.selection.value = { kind: 'path', id: aId, copy: base };
  drag(pt(shared), { x: 120, y: 120 }, { x: 150, y: 120 });
  expect(endOf(aId).pointId).not.toBe(shared);
  expect(P.nodeWorld(doc.value, endOf(aId)).x).toBeCloseTo(150, 6);
  expect(startOf(bId).pointId).toBe(shared);
  expect(P.nodeWorld(doc.value, startOf(bId)).x).toBeCloseTo(120, 6);
  A.undo();
  expect(endOf(aId).pointId).toBe(shared);
});

test('dropping the unlinked node back on the old point merges them again (points attract with snapping off)', () => {
  const { aId, shared } = scene();
  UI.selection.value = { kind: 'path', id: aId, copy: base };
  drag(pt(shared), { x: 120, y: 120 }, { x: 150, y: 120 });
  drag(pt(endOf(aId).pointId), { x: 150, y: 120 }, { x: 125, y: 121 });
  expect(endOf(aId).pointId).toBe(shared);
});

test('without the path selected, dragging the shared point moves both paths', () => {
  const { aId, bId, shared } = scene();
  UI.selection.value = { kind: 'points', ids: [shared] };
  drag(pt(shared), { x: 120, y: 120 }, { x: 150, y: 120 });
  expect(endOf(aId).pointId).toBe(shared);
  expect(P.nodeWorld(doc.value, startOf(bId)).x).toBeCloseTo(150, 6);
});
```

- [ ] **Step 6: Run to see them fail**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/unlink.test.ts`
Expected: the first two FAIL (b's start moves to x = 150); the third passes.

- [ ] **Step 7: Wire it**

`src/actions.ts` (add `Copy` to the type import if missing):

```ts
// Give the path its own point for one of its nodes (a plain node on `pointId`, or its via node through `via`), so a drag
// moves only this path. Null when nothing was shared.
export function unlinkNode(pathId: string, pointId: string, via?: Copy): Node | null {
  let out: Node | null = null;
  mutate((d) => {
    const path = P.getPath(d, pathId);
    const node = path && P.pathNodes(path).find((n) => n.pointId === pointId && (via
      ? !!n.via && n.via.bindingId === via.bindingId && n.via.power === via.power && n.via.cell.c === via.cell.c && n.via.cell.r === via.cell.r
      : !n.via));
    out = node ? P.detachFromPath(d, pathId, node) : null;
    return out ? undefined : false;
  });
  return out;
}
```

`src/interaction/tools/select.ts` (import `Node`):

```ts
// Select tool with a path selected: the first move of a drag on one of its nodes unlinks it from other paths first.
function unlinkForDrag(pointId: string, via?: Copy): Node | null {
  const s = UI.selection.value;
  if (UI.tool.value !== 'select' || !s || s.kind !== 'path') return null;
  return A.unlinkNode(s.id, pointId, via);
}
```

At the top of the `pt` case after `if (!d.moved) return;`:

```ts
      if (!d.unlinked) {
        d.unlinked = true;
        const n = unlinkForDrag(d.pointId, d.via);
        if (n) { if (d.via) d.cell = n.cell; d.pointId = n.pointId; d.via = undefined; }
      }
```

At the top of the `canchor` case after `if (!d.moved) return;`:

```ts
      if (!d.unlinked) { d.unlinked = true; const n = unlinkForDrag(d.pointId); if (n) d.pointId = n.pointId; }
```

The `pt` drag's `targets` were taken before the unlink, so the old point (where the other path still is) remains a target: dropping back on it relinks through `joinDroppedPoint`.

`src/components/Chrome.tsx`: in `hintText`, the selected-path Select hint gains ` · drag a node to pull it off a shared point`.

- [ ] **Step 8: Run everything**

Run: `npx vitest run --root ~/Developer/personal/tesselator && npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/engine/paths.ts src/actions.ts src/interaction/tools/select.ts src/components/Chrome.tsx tests/unit/paths.test.ts tests/unit/unlink.test.ts
git -C ~/Developer/personal/tesselator commit -m "Select: dragging a node of the selected path pulls it off a shared point

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Freehand and Pen snap their ends, with joins and own targets

**Files:**
- Modify: `src/types.ts` (the `free` drag), `src/actions.ts` (`penClickEmpty`, `finishFreehand`), `src/interaction/tools/freehand.ts`
- Test: `tests/unit/draw.test.ts` (new)

**Interfaces:**
- Consumes: `drawSnap`, `penStroke`, `hintOf` (Task 6); `nodeForSnap`, `splitNearest` (Task 4); `nearestOnSeg` (Task 3).
- Produces:
  - `free` drag: `{ kind: 'free'; raw: XY[]; startNode: Node | null; startSnap: SnapResult | null; groups: string[][][]; cloneMatrices: Matrix[]; end: SnapResult | null; pin: { id: string; geom: XY[] } | null; cooldown: { id: string; geom: XY[] } | null }` (`pin`/`cooldown` are used by Task 10).
  - `A.finishFreehand(dr: Extract<Drag, { kind: 'free' }>, end: SnapResult | null): boolean`
  - `A.penClickEmpty(w, on, hitScale)` keeps its signature.

- [ ] **Step 1: Failing tests**

Create `tests/unit/draw.test.ts`:

```ts
import { test, expect } from 'vitest';
import { doc, emptyDoc } from '../../src/state/doc';
import * as UI from '../../src/state/ui';
import * as A from '../../src/actions';
import * as P from '../../src/engine/paths';
import { reset } from '../../src/state/history';
import type { Doc, Drag, XY, UV, SnapResult } from '../../src/types';

function fresh(build: (d: Doc) => void = () => {}) { reset(); UI.resetUi(); const d = emptyDoc(); build(d); doc.value = d; UI.view.value = { pan: { x: 0, y: 0 }, zoom: 1 }; UI.prefs.value = { ...UI.prefs.value, snap: true }; UI.tool.value = 'freehand'; }
function line(d: Doc, pts: UV[], layerId = d.layers[0].id) {
  const p = P.startPath(d, P.addPoint(d, pts[0]), { color: '#000', weight: 2 }, layerId);
  for (const uv of pts.slice(1)) P.appendNode(d, p.id, P.addPoint(d, uv));
  return p;
}
const stroke = (from: XY, to: XY, n = 12): XY[] => Array.from({ length: n + 1 }, (_, i) => ({ x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n }));
// Mirrors the Freehand tool: the start snaps on press, the end on release.
function draw(raw: XY[]): boolean {
  const s0 = A.drawSnap(raw[0], true, 1, null);
  const start = s0 ? s0.at : raw[0];
  const dr = { kind: 'free', raw: [start, ...raw.slice(1)], startNode: null, startSnap: s0, groups: [doc.value.newPathGroups], cloneMatrices: [], end: null, pin: null, cooldown: null,
    target: null, start, moved: true, pointerId: 1, hitScale: 1 } as unknown as Extract<Drag, { kind: 'free' }>;
  const end = A.drawSnap(raw[raw.length - 1], true, 1, { pts: dr.raw, groups: dr.groups });
  return A.finishFreehand(dr, end);
}
const newest = () => doc.value.paths[doc.value.paths.length - 1];

test('a stroke ending on another path\'s line splits it and shares the node', () => {
  let hostId = '';
  fresh((d) => { hostId = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]).id; });
  draw(stroke({ x: 120, y: 30 }, { x: 121, y: 117 }));
  const host = P.getPath(doc.value, hostId)!;
  expect(host.segments).toHaveLength(2);
  const p = newest(), last = P.pathNodes(p).at(-1)!;
  expect(last.pointId).toBe(host.segments[0].to.pointId);
});

test('a stroke starting on a line on another layer does not split it (location only)', () => {
  let hostId = '';
  fresh((d) => { d.layers.push({ id: 'L2', name: 'Layer 2' }); hostId = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }], 'L2').id; });
  UI.activeLayerId.value = doc.value.layers[0].id;
  draw(stroke({ x: 120, y: 118 }, { x: 140, y: 40 }));
  expect(P.getPath(doc.value, hostId)!.segments).toHaveLength(1);
  expect(P.nodeWorld(doc.value, newest().start).y).toBeCloseTo(120, 6);
});

test('a stroke ending on its own start closes the shape', () => {
  fresh();
  draw([...stroke({ x: 30, y: 30 }, { x: 150, y: 30 }), ...stroke({ x: 150, y: 30 }, { x: 150, y: 150 }).slice(1), ...stroke({ x: 150, y: 150 }, { x: 32, y: 33 }).slice(1)]);   // starts on a grid point (the start snaps to the grid)
  expect(P.isClosed(newest())).toBe(true);
});

test('a stroke ending on its own repeated start wraps into the next tile', () => {
  fresh();
  draw(stroke({ x: 0, y: 100 }, { x: 238, y: 101 }));            // the start (0, 100) snaps to the tile edge; its repeat is (240, 100)
  const p = newest(), first = p.start, last = P.pathNodes(p).at(-1)!;
  expect(last.pointId).toBe(first.pointId);
  expect(last.cell).toEqual({ c: first.cell.c + 1, r: first.cell.r });
});

test('a stroke ending on its own line splits itself: a loop with a tail', () => {
  fresh();
  draw([...stroke({ x: 30, y: 60 }, { x: 180, y: 60 }), ...stroke({ x: 180, y: 60 }, { x: 180, y: 150 }).slice(1), ...stroke({ x: 180, y: 150 }, { x: 101, y: 63 }).slice(1)]);
  const nodes = P.pathNodes(newest()), last = nodes.at(-1)!;
  expect(nodes.slice(1, -1).some((n) => n.pointId === last.pointId)).toBe(true);
});

test('Pen: a click near a mirror axis lands on it; with snapping off a click near a point reuses it', () => {
  fresh();
  A.addElement('mirror'); A.setTool('pen'); A.clearSel();     // addElement selects the element; a Pen click would only clear that
  A.penClickEmpty({ x: 116, y: 60 }, true);
  expect(P.nodeWorld(doc.value, newest().start).x).toBeCloseTo(120, 6);
  A.endPen();
  A.penClickEmpty({ x: 30, y: 30 }, false); A.penClickEmpty({ x: 90, y: 30 }, false); A.endPen();
  const pts = doc.value.points.length;
  A.penClickEmpty({ x: 32, y: 31 }, false);
  expect(doc.value.points.length).toBe(pts);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/draw.test.ts`
Expected: FAIL (`finishFreehand` takes one argument and ignores the snaps; the Pen click lands at x = 116).

- [ ] **Step 3: Types**

Replace the `free` member of the `Drag` union in `src/types.ts`:

```ts
  | { kind: 'free'; raw: XY[]; startNode: Node | null; startSnap: SnapResult | null; groups: string[][][]; cloneMatrices: Matrix[]; end: SnapResult | null; pin: { id: string; geom: XY[] } | null; cooldown: { id: string; geom: XY[] } | null }
```

- [ ] **Step 4: `finishFreehand` and `penClickEmpty`**

In `src/actions.ts` add `import { nodeForSnap, splitNearest } from './engine/joins';` and `import { nearestOnSeg } from './engine/snap';` (merge with the snap import), then replace `finishFreehand`:

```ts
// End a Freehand stroke (spec D3–D11): fit it, then make its start and end nodes from their snaps: share or split
// same-layer geometry, close on its own start, wrap into its own repeat, split itself (loop and tail), or sit on its
// own clone's line re-snapped to the fitted clone; anything else is a new point where the snap put it.
export function finishFreehand(dr: Extract<Drag, { kind: 'free' }>, end: SnapResult | null): boolean {
  const raw = end ? [...dr.raw.slice(0, -1), end.at] : dr.raw;
  const fit = strokeToPath(raw, { eps: CONFIG.FREEHAND_EPS, minDeviation: CONFIG.FREEHAND_MIN_DEVIATION });
  if (!fit) return false;
  let pathId: string | null = null;
  const ok = mutate((d) => {
    const extendId = dr.startNode && !dr.startNode.via ? P.openEndAt(d, dr.startNode.pointId) : null;
    const layerId = extendId ? P.getPath(d, extendId)!.layerId : activeLayerId(d);
    const startNode = dr.startNode ?? nodeForSnap(d, dr.startSnap, fit.points[0], layerId);
    const h = end?.hit, n = fit.points.length;
    const inner = fit.points.slice(1, -1).map((v) => P.addPoint(d, toUV(v, d.lattice)));
    let last: Node | 'self' | 'copy';
    if (h?.kind === 'ownStart') last = startNode;
    else if (h?.kind === 'ownRepeat' && !startNode.via) last = { pointId: startNode.pointId, cell: { c: startNode.cell.c + h.cell.c, r: startNode.cell.r + h.cell.r } };
    else if (h?.kind === 'ownLine') last = 'self';
    else if (h?.kind === 'ownCopy') last = 'copy';
    else last = nodeForSnap(d, end, fit.points[n - 1], layerId);
    const lastNode: Node = typeof last === 'string' ? P.addPoint(d, toUV(fit.points[n - 1], d.lattice)) : last;
    let path;
    if (extendId) { path = P.getPath(d, extendId)!; P.orientToEnd(d, extendId, startNode.pointId, startNode.cell); }
    else path = P.startPath(d, startNode, UI.prefs.value.style, layerId);
    const from = path.segments.length;
    [...inner, lastNode].forEach((node, j) => { if (P.appendNode(d, path.id, node) && fit.cps[j]) P.setControlPointWorld(d, path.id, path.segments.length - 1, fit.cps[j]); });
    if (path.segments.length === 0) { P.deletePath(d, path.id); return false; }
    if (last === 'self') {                                   // D7: land on the stroke's own earlier line and share the node there
      const at = fit.points[n - 1], host = splitNearest(d, path.id, at, path.segments.length - 1);
      if (host) P.mergePoints(d, lastNode.pointId, lastNode.cell, host.pointId, host.cell);
    } else if (last === 'copy' && h?.kind === 'ownCopy') {  // D8: re-snap the end onto the fitted copy (location only)
      const p = P.getPath(d, path.id)!, W = P.pathWorld(d, p).map((q) => apply(h.M, q)), C = P.pathCpsWorld(d, p).map((c) => c && apply(h.M, c));
      let best: XY | null = null, bd = Infinity;
      for (let j = from; j < p.segments.length - 1; j++) { const r = nearestOnSeg(W[j], C[j], W[j + 1], fit.points[n - 1]); if (r.d < bd) { bd = r.d; best = r.q; } }
      if (best) { const uv = toUV(best, d.lattice); P.movePoint(d, lastNode.pointId, uv.u - lastNode.cell.c, uv.v - lastNode.cell.r); }
    }
    if (!extendId) bindNewPath(d, path.id);
    pathId = path.id;
  });
  if (pathId && P.getPath(doc.value, pathId)) UI.selection.value = { kind: 'path', id: pathId, copy: baseCopy };
  return ok;
}
```

(`apply` comes from `./engine/transform`; add it to that import if missing. `Node` and `XY` types are already imported in `actions.ts`; add any that are not.)

Replace `penClickEmpty`:

```ts
// A Pen click on empty space (spec D14): the same targets and commits as a stroke end. On a path in progress, its own
// start closes it, its repeated start wraps it, and its own earlier line splits it; each ends the path.
export function penClickEmpty(w: XY, on: boolean, hitScale = 1): boolean {
  if (UI.selection.value && !UI.pen.value) { UI.selection.value = null; return true; }
  const penNow = UI.pen.value;
  const s = drawSnap(w, on, hitScale, penNow ? penStroke() : null);
  let started: string | null = null, ended = false;
  const ok = mutate((d) => {
    const penPath = penNow ? P.getPath(d, penNow.pathId) : null;
    const layerId = penPath ? penPath.layerId : activeLayerId(d);
    const h = s?.hit;
    if (penPath && h && (h.kind === 'ownStart' || h.kind === 'ownRepeat' || h.kind === 'ownLine')) {
      const st = penPath.start;
      let node: Node | null = null;
      if (h.kind === 'ownStart') node = st;
      else if (h.kind === 'ownRepeat' && !st.via) node = { pointId: st.pointId, cell: { c: st.cell.c + h.cell.c, r: st.cell.r + h.cell.r } };
      else if (h.kind === 'ownLine') node = splitNearest(d, penPath.id, s!.at, penPath.segments.length - 1);
      if (node) { P.appendNode(d, penPath.id, node); ended = true; return; }
    }
    const node = nodeForSnap(d, s, w, layerId);
    if (penNow) { P.appendNode(d, penNow.pathId, node); return; }
    const path = P.startPath(d, node, UI.prefs.value.style, layerId);
    bindNewPath(d, path.id);
    started = path.id;
  });
  if (started) UI.pen.value = { pathId: started };
  if (ended) endPen();
  return ok;
}
```

- [ ] **Step 5: Freehand tool**

Replace `src/interaction/tools/freehand.ts`:

```ts
// Freehand: press and drag; the start snaps on press, the end is hinted live and snaps on release (spec D3, D4).
import { doc } from '../../state/doc';
import * as UI from '../../state/ui';
import * as A from '../../actions';
import * as P from '../../engine/paths';
import { orbit } from '../../engine/transform';
import { CONFIG } from '../../config';
import { startDrag, type ToolModule } from './common';
import type { Node, Matrix } from '../../types';

// The groups the stroke's clones come from: the extended path's bindings, else the groups new paths receive.
function groupsFor(startNode: Node | null): string[][][] {
  const d = doc.value;
  const extendId = startNode && !startNode.via ? P.openEndAt(d, startNode.pointId) : null;   // as finishFreehand: a via start never extends a path
  return extendId ? d.bindings.filter((b) => b.pathId === extendId).map((b) => b.groups) : [d.newPathGroups];
}

export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => {
  let startNode: Node | null = null, start = w;
  let startSnap = null;
  if (t && t.kind === 'point') { startNode = { pointId: t.pointId, cell: t.cell, ...(t.via ? { via: t.via } : {}) }; start = P.nodeWorld(doc.value, startNode); }
  else { startSnap = A.drawSnap(w, ctx.snapOn, ctx.hitScale, null); if (startSnap) start = startSnap.at; }
  const groups = groupsFor(startNode), d = doc.value;
  const cloneMatrices = groups.flatMap((g) => orbit(g, d.elements, d.lattice, CONFIG.ORBIT_CAP, CONFIG.CLONE_CAP).matrices.filter((M): M is Matrix => M !== null));
  startDrag(e, t, start, ctx.hitScale, { kind: 'free', raw: [{ x: start.x, y: start.y }], startNode, startSnap, groups, cloneMatrices, end: null, pin: null, cooldown: null });
  UI.snapSticky.value = null;
};

export const onMove: ToolModule['onMove'] = (d, w, _e, ctx) => {
  if (d.kind !== 'free') return;
  const last = d.raw[d.raw.length - 1];
  if (Math.hypot(w.x - last.x, w.y - last.y) >= 1.5) d.raw.push({ x: w.x, y: w.y });
  const s = A.drawSnap(w, ctx.snapOn, ctx.hitScale, { pts: d.raw, groups: d.groups });
  d.end = s && s.cat !== 'grid' ? s : null;
  UI.snapSticky.value = d.end?.id ?? null;
  UI.snapHint.value = A.hintOf(d.end);
};

export const onUp: ToolModule['onUp'] = (d, w, _e, ctx) => {
  if (d.kind !== 'free') return;
  const end = A.drawSnap(w, ctx.snapOn, ctx.hitScale, { pts: d.raw, groups: d.groups });   // H6: the held snap is the snap used
  A.finishFreehand(d, end);
};
```

The canvas `FreehandPreview` keeps using `dr.raw` and `dr.cloneMatrices`; no change.

- [ ] **Step 6: Run everything**

Run: `npx vitest run --root ~/Developer/personal/tesselator && npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: PASS. Existing tests that call `A.finishFreehand(dr)` must pass a second argument (`null` keeps the old "no end snap" behaviour except that raw anchors no longer attract; if a test relied on the end landing on an existing point, pass `A.drawSnap(lastPoint, false, 1, null)`). Existing Pen tests keep passing because with snapping off only points attract. Name changed tests in the commit message.

- [ ] **Step 7: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/types.ts src/actions.ts src/interaction/tools/freehand.ts tests/unit/draw.test.ts tests/unit/actions.test.ts
git -C ~/Developer/personal/tesselator commit -m "Freehand and Pen snap starts and ends to every target, join within a layer, close, wrap and split themselves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Tracing along a line while Alt is held

**Files:**
- Modify: `src/config.ts`, `src/interaction/tools/freehand.ts`
- Test: `tests/unit/draw.test.ts`

**Interfaces:**
- Consumes: `snapTargets` (`derived.ts`), `pickSnap` (Task 3), the `free` drag's `pin`/`cooldown` (Task 9).
- Produces: `CONFIG.TRACE_BREAKAWAY_PX = 24`; exported pure helper `traceStep(d: Extract<Drag, { kind: 'free' }>, w: XY, alt: boolean, threshold: number, breakaway: number): XY` in `freehand.ts` (returns the point to record).

- [ ] **Step 1: Failing test**

Append to `tests/unit/draw.test.ts` (add `import { traceStep } from '../../src/interaction/tools/freehand';`):

```ts
test('tracing: with Alt held the stroke follows a nearby line, lets go past the breakaway, and does not re-pin until far', () => {
  fresh((d) => { line(d, [{ u: 0.1, v: 0.5 }, { u: 0.9, v: 0.5 }]); });
  const dr = { kind: 'free', raw: [{ x: 30, y: 125 }], pin: null, cooldown: null } as unknown as Extract<Drag, { kind: 'free' }>;
  expect(traceStep(dr, { x: 60, y: 126 }, true, 12, 24).y).toBeCloseTo(120, 6);     // pinned to y = 120
  expect(traceStep(dr, { x: 90, y: 140 }, true, 12, 24).y).toBeCloseTo(120, 6);     // 20 away: still pinned
  expect(traceStep(dr, { x: 100, y: 150 }, true, 12, 24).y).toBeCloseTo(150, 6);    // 30 away: let go
  expect(traceStep(dr, { x: 110, y: 128 }, true, 12, 24).y).toBeCloseTo(128, 6);    // within 2× breakaway of the same line: no re-pin
  expect(traceStep(dr, { x: 120, y: 125 }, false, 12, 24).y).toBeCloseTo(125, 6);   // Alt released: free
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/draw.test.ts -t "tracing"`
Expected: FAIL, `traceStep` is not exported.

- [ ] **Step 3: Implement**

`src/config.ts`, after `SCALE_FRACTIONS`: `TRACE_BREAKAWAY_PX: 24,   // a traced stroke lets go of its line beyond this distance (screen px)`.

In `src/interaction/tools/freehand.ts` add imports `snapTargets` from `../../state/derived`, `pickSnap` from `../../engine/snap`, `XY`, `Drag`, `SnapCat` types, and:

```ts
const TRACE_CATS: ReadonlySet<SnapCat> = new Set<SnapCat>(['edge', 'axis', 'line']);
const nearestOnPolyline = (pl: XY[], p: XY): { q: XY; d: number } => {
  let best = { q: pl[0], d: Infinity };
  for (let i = 0; i + 1 < pl.length; i++) {
    const a = pl[i], b = pl[i + 1], dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)), q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.d) best = { q, d };
  }
  return best;
};

// Spec §6.6: while Alt is held the stroke follows the nearest line (tile edge, mirror axis, or any path's line on any
// layer) within the threshold, projecting each point onto it. Beyond the breakaway it lets go, and the same line cannot
// re-pin until the pointer has been twice the breakaway away. Returns the point to record.
export function traceStep(d: Extract<Drag, { kind: 'free' }>, w: XY, alt: boolean, threshold: number, breakaway: number): XY {
  if (d.cooldown && nearestOnPolyline(d.cooldown.geom, w).d > 2 * breakaway) d.cooldown = null;
  if (!alt) { d.pin = null; return w; }
  if (!d.pin) {
    const s = pickSnap(snapTargets.value, w, threshold, { linesOnly: true, cats: TRACE_CATS });
    if (s && s.line && s.id !== d.cooldown?.id) d.pin = { id: s.id, geom: s.line };
  }
  if (!d.pin) return w;
  const r = nearestOnPolyline(d.pin.geom, w);
  if (r.d > breakaway) { d.cooldown = d.pin; d.pin = null; return w; }
  return r.q;
}
```

In `onMove`, replace the first two lines of the body with:

```ts
  const k = UI.view.value.zoom, p = traceStep(d, w, e.altKey, ctx.threshold, (CONFIG.TRACE_BREAKAWAY_PX * ctx.hitScale) / k);
  const last = d.raw[d.raw.length - 1];
  if (Math.hypot(p.x - last.x, p.y - last.y) >= 1.5) d.raw.push({ x: p.x, y: p.y });
  if (d.pin) { UI.snapHint.value = { at: p, line: d.pin.geom }; d.end = null; return; }
```

(rename the `_e` parameter to `e`), leaving the end-snap lines after it.

- [ ] **Step 4: Run everything**

Run: `npx vitest run --root ~/Developer/personal/tesselator && npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/config.ts src/interaction/tools/freehand.ts tests/unit/draw.test.ts
git -C ~/Developer/personal/tesselator commit -m "Freehand: hold Alt to trace along a line, with breakaway and no immediate re-pin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Nodes on the selected instance only; nodes win over box handles

**Files:**
- Modify: `src/engine/hit.ts`, `src/components/Canvas.tsx`
- Test: `tests/unit/hit.test.ts`

**Interfaces:**
- Produces: with a path instance selected in Select, its nodes are drawn and hit only at that instance (S2); they are tested before box handles (S6). A raw instance in cell `k` reports `{ kind: 'point', pointId, cell: node.cell + k }` (a via node: `via` with its cell shifted by `k`); a clone instance reports `canchor` as today.

- [ ] **Step 1: Failing tests**

Append to `tests/unit/hit.test.ts` (it has `makeDoc`, `ctxFor`):

```ts
test('S2/S6: a selected instance\'s nodes are hit there and only there, before its box handles', () => {
  const d = makeDoc();
  const n0 = P.addPoint(d, { u: 0.2, v: 0.2 });
  const p = P.startPath(d, n0, { color: '#000', weight: 2 }, 'L1');
  P.appendNode(d, p.id, P.addPoint(d, { u: 0.6, v: 0.2 }));                         // (48,48)-(144,48): a flat box whose corners are the nodes
  const sel = { kind: 'path' as const, id: p.id, copy: { cell: { c: 1, r: 0 }, bindingId: null, power: 0 } };
  const ctx = ctxFor(d, { selection: sel });
  expect(hitTest(d, ctx, { x: 288, y: 48 })).toEqual({ kind: 'point', pointId: n0.pointId, cell: { c: 1, r: 0 } });   // the node beats the coincident box corner
  expect(hitTest(d, ctx, { x: 48, y: 48 })?.kind).not.toBe('point');                                                    // the same node in the base cell is not shown
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/hit.test.ts -t "S2/S6"`
Expected: FAIL (the box corner wins; the base-cell node is hit).

- [ ] **Step 3: Implement in `hit.ts`**

In `visiblePointIds`, delete the line that adds the selected path's nodes (`if (s && s.kind === 'path') { … }`), keeping selected points.

In `hitTest`, before the `bbox` block (`if (ctx.tool === 'select' && selPath && selM && sel && sel.kind === 'path') { const box = …`), insert:

```ts
  // S2/S6: the selected instance's own nodes, tested first so a node beats a coincident box handle.
  if (ctx.tool === 'select' && selPath && selM && sel && sel.kind === 'path') {
    const nodes = pathNodes(selPath), Pw = pathWorld(doc, selPath).map((q) => apply(selM, q)), k = sel.copy.cell;
    for (let i = 0; i < nodes.length; i++) {
      if (dist(w, Pw[i]) > rPoint) continue;
      const n = nodes[i];
      if (sel.copy.bindingId) { if (!n.via) return { kind: 'canchor', pathId: selPath.id, pointId: n.pointId, cell: n.cell, copy: sel.copy }; continue; }
      return n.via ? { kind: 'point', pointId: n.pointId, cell: n.cell, via: { ...n.via, cell: { c: n.via.cell.c + k.c, r: n.via.cell.r + k.r } } }
        : { kind: 'point', pointId: n.pointId, cell: { c: n.cell.c + k.c, r: n.cell.r + k.r } };
    }
  }
```

In the "via nodes of the pen path and the selected path" loop, change `for (const p of [penPath, selPath])` to `for (const p of [penPath])`. Remove the clone-anchor branch for the selected clone copy (`else if (selPath && selM && sel && sel.kind === 'path' && sel.copy.bindingId) { … }`) since the block above now handles it.

- [ ] **Step 4: Canvas**

In `Points()` in `src/components/Canvas.tsx`: change `for (const p of [penPath, selPath]) if (p) for (const n of pathNodes(p)) show.add(n.pointId);` to `if (penPath) for (const n of pathNodes(penPath)) show.add(n.pointId);`, change the via loop's `for (const p of [penPath, selPath])` to `for (const p of [penPath])`, and before `return` add the selected raw instance's nodes:

```tsx
  // S2: the selected instance's nodes, drawn only there (a clone instance's are drawn by CloneAnchors).
  if (layer.value === 'drawing' && sel && sel.kind === 'path' && selPath && !sel.copy.bindingId && !showAll) {
    const M = copyMatrix(sel.copy);
    pathNodes(selPath).forEach((n, i) => {
      const w = apply(M, nodeWorld(d, n));
      const isHover = !!h && h.kind === 'point' && h.pointId === n.pointId;
      out.push(<circle key={`sel:${i}`} class={['pt', isHover && 'hover'].filter(Boolean).join(' ')} cx={w.x} cy={w.y} r={CONFIG.HANDLE_PX / z} />);
    });
  }
```

(import `copyMatrix` from `../state/derived` and `apply` from `../engine/transform` if missing.)

- [ ] **Step 5: Run everything**

Run: `npx vitest run --root ~/Developer/personal/tesselator && npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: PASS. Update any existing hit test that expected a selected path's node to be hit in a cell other than the selected instance's, or the box corner to beat a coincident node; name them in the commit message.

- [ ] **Step 6: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/engine/hit.ts src/components/Canvas.tsx tests/unit/hit.test.ts
git -C ~/Developer/personal/tesselator commit -m "Select: nodes show and hit only on the selected instance, and beat box handles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Several instances selected; marquee across instances

**Files:**
- Modify: `src/types.ts` (`Selection`, the `pts` drag), `src/state/ui.ts`, `src/actions.ts`, `src/engine/hit.ts`, `src/interaction/tools/select.ts`, `src/components/Canvas.tsx`, `src/components/Chrome.tsx`
- Test: `tests/unit/select.test.ts`

**Interfaces:**
- Produces:
  - `Selection` gains `| { kind: 'paths'; items: { id: string; copy: Copy }[] }` and the points member becomes `{ kind: 'points'; ids: string[]; copies?: Record<string, Copy> }` (a point picked through a clone records that clone).
  - `A.toggleInstance(pathId: string, copy: Copy): boolean` — `⇧`-click on a line: toggles the instance; one item collapses to `path`, none to `null`.
  - `deleteSelection` deletes every path in a `paths` selection.
  - `pointsInRectAll(doc: Doc, r: Box, cloneMats: Map<string, (Matrix | null)[]>): { ids: string[]; copies: Record<string, Copy> }` in `hit.ts`.
  - `pts` drag gains `copies: Record<string, Copy>; targets: TargetSet; grab: { pointId: string; at: XY } | null`.

- [ ] **Step 1: Failing tests**

Append to `tests/unit/select.test.ts`:

```ts
test('⇧-click toggles instances, including a clone; Delete removes their paths', () => {
  let a = '', b = '';
  fresh((d) => { a = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.4, v: 0.1 }]).id; b = line(d, [{ u: 0.1, v: 0.7 }, { u: 0.4, v: 0.7 }]).id; });
  A.selectPathAt(a);
  A.toggleInstance(b, { cell: { c: 1, r: 0 }, bindingId: null, power: 0 });
  expect(UI.selection.value).toEqual({ kind: 'paths', items: [{ id: a, copy: base }, { id: b, copy: { cell: { c: 1, r: 0 }, bindingId: null, power: 0 } }] });
  A.toggleInstance(a, base);
  expect(UI.selection.value).toEqual({ kind: 'path', id: b, copy: { cell: { c: 1, r: 0 }, bindingId: null, power: 0 } });
  A.toggleInstance(a, base);
  A.deleteSelection();
  expect(doc.value.paths).toHaveLength(0);
});

test('a marquee picks points through a mirror clone; dragging moves them through that clone', () => {
  let pid = '';
  fresh((d) => {
    const el = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });
    const p = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.2, v: 0.4 }]);
    P.addBinding(d, p.id, [[el.id]]);
    pid = p.start.pointId;                                       // (24, 24); its mirror image is (216, 24)
  });
  S.onDown(null, { x: 200, y: 10 }, ev(), ctxOff);
  const m = UI.drag.value!; m.moved = true;
  S.onMove(m, { x: 230, y: 40 }, ev(), ctxOff);
  UI.drag.value = null;
  S.onUp(m, { x: 230, y: 40 }, ev(), ctxOff);
  const s = UI.selection.value;
  expect(s && s.kind === 'points' && s.ids).toEqual([pid]);
  expect(s && s.kind === 'points' && s.copies?.[pid]?.bindingId).toBeTruthy();
  const via = (s as { copies: Record<string, Copy> }).copies[pid];
  drag({ kind: 'point', pointId: pid, cell: { c: 0, r: 0 }, via }, { x: 216, y: 24 }, { x: 226, y: 24 }, ctxOff);   // right on the clone
  expect(P.getPoint(doc.value, pid)!.u).toBeCloseTo(0.1 - 10 / 240, 9);                                            // left on the original
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/select.test.ts -t "instances|marquee"`
Expected: FAIL (`A.toggleInstance` missing; the marquee does not see clone points).

- [ ] **Step 3: Types and UI helpers**

In `src/types.ts`, the `Selection` union: change the points member to `| { kind: 'points'; ids: string[]; copies?: Record<string, Copy> }` and add `| { kind: 'paths'; items: { id: string; copy: Copy }[] }`. The `pts` drag becomes `| { kind: 'pts'; ids: string[]; startPos: Record<string, UV>; copies: Record<string, Copy>; targets: TargetSet; grab: { pointId: string; at: XY } | null }`.

`src/state/ui.ts` helpers keep returning `null`/`[]` for the new kind (`selectedPathId` already checks `kind === 'path'`).

- [ ] **Step 4: Actions**

In `src/actions.ts`:

```ts
// ⇧-click on a line (spec S4): toggle that instance in the selection. One instance is a plain path selection.
export function toggleInstance(pathId: string, copy: Copy): boolean {
  const s = UI.selection.value, same = (x: { id: string; copy: Copy }) => x.id === pathId && sameCopy(x.copy, copy);
  const items = s && s.kind === 'paths' ? s.items.slice() : s && s.kind === 'path' ? [{ id: s.id, copy: s.copy }] : [];
  const i = items.findIndex(same);
  if (i >= 0) items.splice(i, 1); else items.push({ id: pathId, copy });
  UI.selection.value = items.length === 0 ? null : items.length === 1 ? { kind: 'path', id: items[0].id, copy: items[0].copy } : { kind: 'paths', items };
  UI.pendingGroup.value = null;
  return true;
}
```

(define `const sameCopy = (a: Copy, b: Copy) => a.cell.c === b.cell.c && a.cell.r === b.cell.r && a.bindingId === b.bindingId && a.power === b.power;` near the top of `actions.ts` if it does not exist.) In `deleteSelection`, add a branch before the existing ones: `if (s && s.kind === 'paths') { const ids = new Set(s.items.map((x) => x.id)); const ok = mutate((d) => { for (const id of ids) P.deletePath(d, id); }); UI.selection.value = null; return ok; }`. Change `selectPoints(ids: string[], copies?: Record<string, Copy>)` to store `copies` when given: `UI.selection.value = u.length ? { kind: 'points', ids: u, ...(copies ? { copies } : {}) } : null;`.

- [ ] **Step 5: Hit-testing**

In `src/engine/hit.ts`, add:

```ts
// Points inside a rectangle (spec S5): raw copies in any window cell, and clone images, recording the clone each was picked through.
export function pointsInRectAll(doc: Doc, r: Box): { ids: string[]; copies: Record<string, Copy> } {
  const ids = new Set(pointsInRect(doc, r)), copies: Record<string, Copy> = {};
  for (const a of anchorsWorld(doc)) {
    if (!a.bindingId || !a.via || ids.has(a.pointId)) continue;
    if (a.x >= r.x0 && a.x <= r.x1 && a.y >= r.y0 && a.y <= r.y1) { ids.add(a.pointId); copies[a.pointId] = { cell: { ...a.via.cell }, bindingId: a.via.bindingId, power: a.via.power }; }
  }
  return { ids: [...ids], copies };
}
```

In `hitTest`'s point loop, after the raw-point loop and before the pen via loop, hit selected points picked through clones at their clone position:

```ts
    if (sel && sel.kind === 'points' && sel.copies) for (const [id, copy] of Object.entries(sel.copies)) {
      const pt = doc.points.find((q) => q.id === id);
      if (!pt) continue;
      const M = copyMatrixOf(copy, lat, ctx.cloneMatrices), at = apply(M, toWorld(pt, lat)), dd = dist(w, at);
      if (dd < bd) { bd = dd; best = { kind: 'point', pointId: id, cell: { c: 0, r: 0 }, via: copy }; }
    }
```

and in `visiblePointIds` skip ids present in `s.copies` (they are shown at their clone, not raw): `if (s && s.kind === 'points') for (const id of s.ids) if (!s.copies?.[id]) set.add(id);`.

- [ ] **Step 6: Select tool**

In `src/interaction/tools/select.ts`:

`pointDown` — a press on a selected point with several selected starts a `pts` drag; via presses (clone-picked points) count too:

```ts
  if (UI.tool.value === 'select' && selPts.includes(t.pointId) && selPts.length > 1) {
    const s = UI.selection.value, copies = s && s.kind === 'points' ? s.copies ?? {} : {};
    const pt = P.getPoint(doc.value, t.pointId)!, rawAt = A.worldOf({ u: pt.u + t.cell.c, v: pt.v + t.cell.r });
    const at = t.via ? apply(P.viaMatrix(doc.value, t.via), rawAt) : rawAt;
    startDrag(e, t, w, hitScale, { kind: 'pts', ids: selPts.slice(), startPos: P.snapshotPositions(doc.value, selPts), copies, targets: snapTargets.value, grab: { pointId: t.pointId, at } });
    return;
  }
```

`onMove`, `pts` case — the grabbed node snaps (spec §6.3) and every point moves through the copy it was picked in:

```ts
    case 'pts': {
      if (!d.moved) return;
      let delta = { x: w.x - d.start.x, y: w.y - d.start.y };
      if (d.grab) {
        const raw = { x: d.grab.at.x + delta.x, y: d.grab.at.y + delta.y };
        const s = pickSnap(d.targets, raw, ctx.threshold, { sticky: UI.snapSticky.value, excludePoints: new Set(d.ids), cats: ctx.snapOn ? undefined : NODE_ONLY });
        UI.snapSticky.value = s?.id ?? null; UI.snapHint.value = A.hintOf(s);
        if (s) delta = { x: s.at.x - d.grab.at.x, y: s.at.y - d.grab.at.y };
      }
      const groups = new Map<string, { ids: string[]; M: Matrix | null }>();
      for (const id of d.ids) {
        const c = d.copies[id], k = c ? `${c.cell.c},${c.cell.r},${c.bindingId},${c.power}` : 'raw';
        if (!groups.has(k)) groups.set(k, { ids: [], M: c ? P.viaMatrix(doc.value, c) : null });
        groups.get(k)!.ids.push(id);
      }
      A.mutate((dd) => {
        for (const g of groups.values()) {
          // A point picked through a clone moves through that clone's inverse (its linear part: a delta has no offset).
          const lin = g.M ? apply(invert([g.M[0], g.M[1], g.M[2], g.M[3], 0, 0]), delta) : delta;
          const dv = A.uvOf(lin);
          P.movePointsBy(dd, g.ids, d.startPos, dv.u, dv.v);
        }
      });
      return;
    }
```

With snapping off and no point near, `delta` stays raw (multi-point drags have no grid snap).

`onUp`, the marquee: replace `A.selectPoints([...(d.add ? UI.selectedPointIds() : []), ...pointsInRect(doc.value, r)]);` with

```ts
    const got = pointsInRectAll(doc.value, r), prev = UI.selection.value;
    const prevCopies = d.add && prev && prev.kind === 'points' ? prev.copies ?? {} : {};
    A.selectPoints([...(d.add ? UI.selectedPointIds() : []), ...got.ids], { ...prevCopies, ...got.copies });
```

`onUp`, the `segment` case: when `e.shiftKey || UI.addToSelection.value`, call `A.toggleInstance(t.pathId, t.copy)` and return, before the existing insert-node / select logic.

Import `pointsInRectAll` from `../../engine/hit`, and `Matrix` from types.

- [ ] **Step 7: Canvas and chrome**

`Highlights()` in `Canvas.tsx`: when the selection is `paths`, draw the same halo the single-path case draws for each item (reuse that code with each `{ id, copy }`). `Points()`: for a `points` selection with `copies`, draw each clone-picked point at `apply(copyMatrix(copy), toWorld(pt))` with class `pt sel` (and do not draw it raw).

`SelectionBar()` in `Chrome.tsx`: add a branch for `s.kind === 'paths'`: `inner = <Label>{s.items.length} instances · Delete removes their paths</Label>;` and the Delete button label stays "Delete".

- [ ] **Step 8: Run everything**

Run: `npx vitest run --root ~/Developer/personal/tesselator && npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: PASS. Any `switch` on `selection.kind` that `tsc` reports as non-exhaustive gets a `paths` branch that does nothing (bars hide, tools ignore).

- [ ] **Step 9: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/types.ts src/state/ui.ts src/actions.ts src/engine/hit.ts src/interaction/tools/select.ts src/components/Canvas.tsx src/components/Chrome.tsx tests/unit/select.test.ts
git -C ~/Developer/personal/tesselator commit -m "Select: shift-click several instances; marquee picks points through clones and drags them through those clones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Strings table and docs

**Files:**
- Modify: `src/strings.ts`, `src/components/Chrome.tsx`, `CLAUDE.md`
- Test: none new (copy only); the full suite and type-check guard it.

**Interfaces:**
- Produces: `STR` gains `hint`, `help`, `bar`, `titles` sections holding every user-visible string in `Chrome.tsx` (hint texts, help lines, button labels, titles, confirm and alert messages). `Chrome.tsx` reads them from `STR`.

- [ ] **Step 1: Move the strings**

In `src/strings.ts`, add sections and move every literal user-visible string from `src/components/Chrome.tsx` into them, one key per string (functions for strings with values, e.g. `instances: (n: number) => \`${n} instances · Delete removes their paths\``). Keep the wording exactly as it is in `Chrome.tsx` after Tasks 6, 8 and 12; this task moves copy, it does not rewrite it. Example of the shape:

```ts
  hint: {
    construction: 'Construction layer: add or drag elements and lattice handles · the drawing is locked · Tab to go back',
    select: 'Select: click a point, line, copy or fill · drag a line to move the path · drag empty space to marquee points',
    // …every other hintText() return value
  },
  titles: {
    snap: 'Snapping (G); hold ⌘ or Ctrl to invert for one gesture',
    // …every other title=
  },
```

Replace each literal in `Chrome.tsx` with its `STR` key. Leave keyboard glyphs inside `<K k="…" />` as they are.

- [ ] **Step 2: Docs**

In `CLAUDE.md`, under Architecture, add:

- `` `src/engine/snap.ts` is pure snapping: `buildTargets` (tile corners and edges, mirror axes incl. those implied by stacked groups, rotation points, intersections, every node and line of every copy), `pickSnap` (one precedence list in `CONFIG.SNAP_PRECEDENCE`, points before lines, sticky holds), a stroke's own targets (`strokeCands`), a dragged node's own clones resolved to their axis or centre (`ownFixedCands`), body-drag meets (`snapBodyDelta`), scale fractions and handle guides. `snapTargets` in `derived.ts` caches the targets; drags take them at drag start. ``
- `` `src/engine/joins.ts` turns a snap into a node on release: share, split, via, or a new point; joins only within a layer. ``
- `` `src/strings.ts` holds every user-visible string. ``

Under Shortcuts: `G` snap, hold `⌘`/`Ctrl` to invert; `⌥` while drawing traces a line; `Esc` cancels what is in progress, again clears and returns to Select.

Under Known limitations, add: `- A traced stretch is fitted like the rest of the stroke, so on a curve it follows the line within the fitting tolerance rather than copying it exactly, and the fitted curve can kink where it peels off (spec D12, D13).` and `- Regions still read every path on every layer, fills are still seeds, and existing documents may share points across layers; the layers, regions and fills plan changes these.`

Remove any limitation line these tasks made false (e.g. "Point drags and multi-point drags do not snap to curves or cell corners").

- [ ] **Step 3: Run everything**

Run: `npx vitest run --root ~/Developer/personal/tesselator && npx tsc --noEmit -p ~/Developer/personal/tesselator && npx vite build ~/Developer/personal/tesselator`
Expected: PASS; build succeeds.

- [ ] **Step 4: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/strings.ts src/components/Chrome.tsx CLAUDE.md
git -C ~/Developer/personal/tesselator commit -m "Strings: every user-visible string in one table; docs for snapping and joins

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** V1 → Tasks 3 and 13. O2 → Task 4 `joinable`, used by Tasks 7 and 9. K1 → Task 6. D1–D2 built. D3–D4 → Task 9 (start on press, end hinted and on release). D5 → Task 9 (`openEndAt`, kept). D6 → Task 9 (`nodeForSnap` curve split at start and end). D7 → Task 9 (`splitNearest` + `mergePoints`). D8 → Task 9 (`ownCopy` re-snap against the fitted copy). D9 → no join for axis and centre hits (`place`). D10 → Task 9 (`ownRepeat`). D11 → built. D12 → Task 10 (projection onto the line, one path); exact copy and D13 no-kink are listed as a limitation in Task 13. D14 → Task 9 (`penClickEmpty` through `drawSnap` and `nodeForSnap`). D15 (cursor ghosts) → not in this plan; the Freehand preview already ghosts the stroke; add it to the next plan's chrome work. §6.1 T1–T7 → Task 3 `buildTargets`; T8–T10 → `strokeCands`; T11 → `gridResult`; T12 → Task 5 `cpLines`; T13 → `snapScale`. SN1 (raw pointer) → every caller passes the raw pointer; SN2 → `CONFIG.SNAP_PRECEDENCE`, `precedence`, `choose`; SN3 → `ownFixedCands` (node drags) and `solveCopyMeet` (body drags); SN4 → `choose`; SN5 → dedup in `buildTargets` and `ownFixedCands`. §6.3 → Tasks 7, 9, 12 (grabbed node). §6.4 → Tasks 4, 7, 9. §6.5 → Task 6. §6.6 → Task 10. S1 built; S2, S6 → Task 11; S3 built; S4, S5 → Task 12. E1–E2 built; E3 → Task 1; E4 → Task 8; E5 → Task 7; E6 → Task 7 (scale snap and endpoint hints); E7 → Task 7; E8 → Task 7 (`joinDroppedPoint`); E9 → Task 7. H1–H6 → Tasks 6, 7, 9, 10.

**Gaps deliberately left:** D15 cursor ghosts (move to the next plan); exact-copy tracing and D13 (limitation); O1, O3, R1–R8 (next plan).

**Type consistency.** `SnapCat`, `SnapHit`, `SnapResult`, `TargetSet`, `StrokeCopy` (Task 3), `Line`, `BodyTargets`, `BodySnap` (Task 5) are defined once in `src/types.ts` and used with the same fields in `snap.ts`, `joins.ts`, the drag union, actions and tests. `pickSnap(set, p, threshold, opts)`, `drawSnap(w, on, hitScale, stroke)`, `nodeForSnap(doc, s, w, layerId)`, `joinPointToHit(doc, fromId, fromCell, hit, layerId)`, `splitNearest(doc, pathId, at, maxJ)`, `bodyTargets(doc, set, pathId)`, `snapBodyDelta(T, raw, threshold, sticky)`, `finishFreehand(dr, end)`, `joinDroppedPoint(pointId, cell, hit)`, `joinDroppedNode(pathId, nodeIndex, hit)`, `toggleInstance(pathId, copy)`, `traceStep(d, w, alt, threshold, breakaway)` match between definition and every call.

**Review Focus.** 1 → Task 9 "starting on a line on another layer"; 2 → Task 3 `ownFixedCands` and Task 7 "settles on the mirror axis"; 3 → Task 3 stickiness test (the intersection takes over the held axis); 4 → Task 9 Pen "with snapping off"; 5 → Task 6's `Esc` branch calls `abortGesture` (manual check: drag a node, press `Esc`, the node returns and Undo has nothing new).
