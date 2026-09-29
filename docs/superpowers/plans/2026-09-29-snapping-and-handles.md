# Snapping and Handles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Path drags snap their ends to cell corners, other paths' nodes and curves, and their own rotated or mirrored clones, and join on release; bounding-box scaling snaps to 1, ½, ⅓ of the lattice spans; control points snap to axis angles and tangency; anchor drags carry control points rigidly; a filled region selects and drags the path around it.

**Architecture:** A new pure module `src/engine/snap.ts` computes every snap from a `Doc` plus explicit inputs. The Select tool builds the inputs at the start of a drag, applies the result on each move, publishes `UI.snapHint` for the canvas, and on release calls `A.joinDroppedNode`, which reuses the Pen-joins split and merge (`insertNodeAt`, `mergePoints`) plus a new `mergeIntoNode` for via targets. Body-drag snapping runs in the source frame, because the only copies it applies to (source and cell copies) are pure translations of the source.

**Tech Stack:** Preact + `@preact/signals`, TypeScript strict, Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-snapping-and-handles-amendment.md` (binding), amending `docs/superpowers/specs/2026-09-27-engine-rebuild-design.md` after `docs/superpowers/specs/2026-09-29-pen-joins-amendment.md`.

**Prerequisite:** Pen-joins Task 2 (`docs/superpowers/plans/2026-09-29-pen-joins.md`) is merged first. This plan uses `insertNodeAt`, `nearestT`, `mergePoints`, `viaMatrix`, `withViaRepair` and `Node.via` from pen-joins Task 1, and edits `select.ts` and `pointer.ts`, which pen-joins Task 2 also edits. Start from a tree where `npx vitest run` and `npx tsc --noEmit` pass.

## Global Constraints

- Runtime dependencies stay exactly `preact` and `@preact/signals`. `npx tsc --noEmit` is clean (strict) after every commit; the user tests by hand on this branch, so no commit may fail to type-check.
- No Chrome DevTools MCP browser driving, no server on port 5173, no Playwright. Verify with `npx tsc --noEmit -p ~/Developer/personal/tesselator` and `npx vitest run --root ~/Developer/personal/tesselator`.
- `src/engine/*` stays pure. The document is never mutated after commit; mutation helpers receive a draft; tools change state through `src/actions.ts` or `A.mutate`.
- Every distance compared with a threshold is a world distance; the threshold is `ctx.threshold` (`SNAP_PX · hitScale / zoom`).
- The new snaps follow `ctx.snapOn` (`G` toggles, `⇧` inverts for one gesture), except bounding-box scaling, which uses `UI.prefs.value.snap` alone because `⇧` means "free" there.
- Point-class snaps beat line- and curve-class snaps; within a class the nearest wins.
- Scale fractions: `CONFIG.SCALE_FRACTIONS = [1, 1 / 2, 1 / 3]`.
- A join on release is part of the drag's single history entry, and is skipped when a via node references the dragged point.
- Region detection is not changed.
- Commit after every task with a message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `cd` into the project; use absolute paths or `git -C`; write home paths as `~/...`. Stage only the files the task names (other sessions may have work in the tree).

## Review Focus

1. A path that shares a point with another path must not snap to that other path's adjacent segment, which moves with the drag. Pinned by Task 3's "segments touching the dragged points are not targets" test.
2. Dragging a path through a cell copy far from the base cell (cell (2, 0)) must snap and join exactly as in the base cell. Pinned by Task 6's "drag through cell (2, 0)" test.
3. Releasing with snapping off, or with no snap held, must move the path and join nothing. Pinned by Task 6's "snap off" test.
4. One undo after a joined drop must restore both paths (the host is unsplit and the dragged point is back). Pinned by Task 6's undo test.
5. A control point next to a straight neighbour must snap to that straight segment's line, not only to curved neighbours' handles. Pinned by Task 4's tangent test.

---

## File map

| File | Change |
| --- | --- |
| `src/types.ts` | `Line`, `SnapHit`, `BodySnap`, `BodyTargets`, `FillMove`; body, cp and bbox drag fields; fill hit target `owner` |
| `src/config.ts` | `SCALE_FRACTIONS` |
| `src/engine/paths.ts` | rigid `shiftControlPoints`; `mergePoints` split into `rewriteNodes` + `mergePoints` + `mergeIntoNode`; `moveFillSeeds` |
| `src/engine/snap.ts` (new) | `solveCopyMeet`, `windowCopies`, `bodyTargets`, `snapBodyDelta`, `snapScale`, `cpLines`, `snapToLines`, `faceOwner`, `enclosedFills` |
| `src/engine/hit.ts` | fill target carries `owner` |
| `src/state/ui.ts` | `snapHint` signal |
| `src/actions.ts` | `joinDroppedNode` |
| `src/interaction/pointer.ts` | tool `onUp` runs before `endGesture`; clear `snapHint` |
| `src/interaction/tools/select.ts` | body snapping, join, fill-follow, fill-area select and drag, cp snapping, scale snapping |
| `src/components/Canvas.tsx`, `src/styles.css` | `SnapMark` |
| `tests/unit/paths.test.ts`, `tests/unit/snap.test.ts` (new), `tests/unit/hit.test.ts`, `tests/unit/select.test.ts` (new) | tests |
| `CLAUDE.md`, `src/components/Chrome.tsx` | docs and the Select hint |

---

### Task 1: Anchor drags carry control points rigidly

**Files:**
- Modify: `src/engine/paths.ts` (`shiftControlPoints`)
- Test: `tests/unit/paths.test.ts` (the test named "movePoint and movePointsBy shift adjacent control points by half per moved endpoint")

**Interfaces:**
- Produces: `shiftControlPoints(doc, ids, du, dv)` moves the control point of every segment with at least one end in `ids` by `(du, dv)`, once. Signature unchanged.

- [ ] **Step 1: Rewrite the existing test to the new rule**

Replace the whole test "movePoint and movePointsBy shift adjacent control points by half per moved endpoint" with:

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

In `shiftControlPoints`, the segment loop counts moved ends in `n` and adds `(du * n) / 2`. Keep the count (or any via-aware variant pen-joins introduced) and replace only the amount, so a segment with one or two moved ends shifts by the full delta once:

```ts
      if (n) s.cp = { u: s.cp.u + du, v: s.cp.v + dv };
```

Update the comment above the function, if any, to: `// Every segment with a moved end carries its control point by the full delta, once (handles stay rigid at the moved node).`

- [ ] **Step 4: Run all tests and typecheck**

Run: `npx vitest run --root ~/Developer/personal/tesselator && npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: PASS. If another test pinned the half rule (search `tests/unit` for `0.25` next to `cpAbs`), update its expected value to the full-delta result and say so in the commit message.

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
- Produces: `mergeIntoNode(doc: Doc, fromId: string, fromCell: Cell, target: Node): void`. With no `target.via` it is exactly `mergePoints(doc, fromId, fromCell, target.pointId, target.cell)`. With a via it rewrites every plain node referencing `fromId` in cell `c` to `{ pointId: target.pointId, cell: target.cell, via: { ...target.via, cell: target.via.cell + (c − fromCell) } }`. Via nodes referencing `fromId` are left alone (callers skip that case).
- Produces: `mergePoints` keeps its signature and behaviour.

- [ ] **Step 1: Failing test**

Append to `tests/unit/paths.test.ts` (it already has `makeDoc`, `polyline` and `closeXY`):

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

If `polyline` in this file takes a different shape (for example `[u, v]` pairs), adapt the literal arguments; do not change the helper.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/paths.test.ts -t "mergeIntoNode"`
Expected: FAIL, `P.mergeIntoNode is not a function`.

- [ ] **Step 3: Implement by splitting `mergePoints`**

Replace `mergePoints` with a shared rewrite and two callers. The body of `rewriteNodes` is the current `mergePoints` loop and tail with the node map passed in, so the zero-length and control-point re-basing rules are kept verbatim:

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

// Replace every reference to `fromId` (seen in `fromCell`) by `toId` at the same place (seen in `toCell`).
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

If the committed `mergePoints` differs from the loop above (pen-joins may have refined it), move its loop into `rewriteNodes` as it is and keep only the node map in `mergePoints`.

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

### Task 3: Body-drag snapping engine

**Files:**
- Modify: `src/types.ts`
- Create: `src/engine/snap.ts`
- Test: `tests/unit/snap.test.ts` (new)

**Interfaces:**
- Consumes: `getPath`, `pathNodes`, `pathWorld`, `isClosed`, `nearestT`, `cloneMatrices` from `paths.ts`; `collectSegments` from `regions.ts`; `apply`, `compose`, `invert`, `cellMatrix`, `IDENTITY` from `transform.ts`; `toWorld`, `windowOffsets` from `lattice.ts`.
- Produces (types in `src/types.ts`):
  ```ts
  export type Line = { p: XY; dir: XY };                     // dir is a unit vector
  export type SnapHit =
    | { kind: 'corner' }
    | { kind: 'own' }                                         // an end of the dragged path's own rotated or mirrored copy
    | { kind: 'node'; pointId: string; cell: Cell; copy: Copy }            // another path's node, seen through `copy`
    | { kind: 'curve'; pathId: string; j: number; t: number; copy: Copy }; // a point on another path's segment j
  export type BodySnap = { delta: XY; nodeIndex: number; at: XY; cls: 'point' | 'line' | 'curve'; hit: SnapHit; line?: [XY, XY] };
  export type BodyTargets = {
    moving: { index: number; p: XY }[];                       // source-frame world positions at drag start
    points: { at: XY; hit: SnapHit }[];
    own: { K: Matrix; p: XY }[];
    segs: WorldSeg[];
  };
  ```
- Produces (`src/engine/snap.ts`):
  - `solveCopyMeet(S: Matrix, K: Matrix, pi: XY, pj: XY): { kind: 'point'; delta: XY } | { kind: 'line'; base: XY; dir: XY } | null`
  - `windowCopies(doc: Doc, pathId: string): { copy: Copy; M: Matrix }[]`
  - `bodyTargets(doc: Doc, pathId: string): BodyTargets | null`
  - `snapBodyDelta(T: BodyTargets, raw: XY, threshold: number): BodySnap | null` (`raw` and `delta` are source-frame world deltas; `null` means "no target, fall back to the grid")
  - `bezAt(a: XY, cp: XY | null, b: XY, t: number): XY`

- [ ] **Step 1: Types**

Add the types above to `src/types.ts` below `WorldSeg`.

- [ ] **Step 2: Failing tests**

Create `tests/unit/snap.test.ts`:

```ts
import { test, expect } from 'vitest';
import * as P from '../../src/engine/paths';
import { solveCopyMeet, bodyTargets, snapBodyDelta } from '../../src/engine/snap';
import { apply, rotation, IDENTITY } from '../../src/engine/transform';
import { CONFIG } from '../../src/config';
import type { Doc, Matrix, XY, UV } from '../../src/types';

export function makeDoc(): Doc { return { version: 2, lattice: { ...CONFIG.LATTICE_PRESETS.Square }, points: [], paths: [], elements: [], bindings: [], fills: [], layers: [{ id: 'L1', name: 'Layer 1' }], newPathGroups: [] }; }
export function line(d: Doc, pts: UV[], closed = false) {
  const n0 = P.addPoint(d, pts[0]);
  const p = P.startPath(d, n0, { color: '#000', weight: 2 }, 'L1');
  for (const uv of pts.slice(1)) P.appendNode(d, p.id, P.addPoint(d, uv));
  if (closed) P.appendNode(d, p.id, { pointId: n0.pointId, cell: { ...n0.cell } });
  return p;
}
const near = (a: XY, b: XY, eps = 1e-6) => { expect(a.x).toBeCloseTo(b.x, 6); expect(a.y).toBeCloseTo(b.y, 6); void eps; };
const add = (a: XY, b: XY): XY => ({ x: a.x + b.x, y: a.y + b.y });

test('solveCopyMeet: a point for a quarter turn, a line for a mirror, nothing for a translation', () => {
  const K = rotation(Math.PI / 2, 120, 120), pi = { x: 100, y: 50 }, pj = { x: 30, y: 60 };
  const r = solveCopyMeet(IDENTITY, K, pi, pj);
  expect(r?.kind).toBe('point');
  if (r?.kind === 'point') near(add(pi, r.delta), apply(K, add(pj, r.delta)));
  const mirror: Matrix = [-1, 0, 0, 1, 240, 0];                      // the vertical line x = 120
  const m = solveCopyMeet(IDENTITY, mirror, { x: 100, y: 50 }, { x: 100, y: 50 });
  expect(m?.kind).toBe('line');
  if (m?.kind === 'line') { near(m.base, { x: 20, y: 0 }); expect(Math.abs(m.dir.x)).toBeCloseTo(0, 9); expect(Math.abs(m.dir.y)).toBeCloseTo(1, 9); }
  expect(solveCopyMeet(IDENTITY, [1, 0, 0, 1, 240, 0], pi, pj)).toBe(null);
});

test('snapBodyDelta: a corner beats a nearer curve; a curve alone snaps; nothing near returns null', () => {
  const d = makeDoc();
  const stub = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.5, v: 0.1 }]);          // world (24, 24) to (120, 24)
  const other = line(d, [{ u: -0.2, v: 0.03 }, { u: 0.2, v: 0.03 }]);      // world (-48, 7.2) to (48, 7.2)
  const T = bodyTargets(d, stub.id)!;
  const c = snapBodyDelta(T, { x: -20, y: -20 }, 12)!;                     // start lands at (4, 4): curve 3.2 away, corner 5.7
  expect(c.hit).toEqual({ kind: 'corner' }); near(c.delta, { x: -24, y: -24 }); expect(c.nodeIndex).toBe(0);
  const k = snapBodyDelta(T, { x: 6, y: -15 }, 12)!;                       // start lands at (30, 9)
  expect(k.cls).toBe('curve'); near(k.delta, { x: 6, y: -16.8 });
  expect(k.hit).toMatchObject({ kind: 'curve', pathId: other.id, j: 0, copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 } });
  expect(snapBodyDelta(T, { x: 6, y: 60 }, 12)).toBe(null);
});

test('snapBodyDelta: segments touching the dragged points are not targets', () => {
  const d = makeDoc();
  const stub = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.5, v: 0.1 }]);
  const joined = P.startPath(d, { ...stub.start, cell: { ...stub.start.cell } }, { color: '#000', weight: 2 }, 'L1');
  P.appendNode(d, joined.id, P.addPoint(d, { u: 0.1, v: 0.4 }));          // (24, 24) to (24, 96): moves with the stub
  expect(snapBodyDelta(bodyTargets(d, stub.id)!, { x: 2, y: 0 }, 12)).toBe(null);
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
  const s = snapBodyDelta(bodyTargets(d, stub.id)!, add(sol.delta, { x: 1, y: 1 }), 12)!;
  expect(s.hit).toEqual({ kind: 'own' });
  near(s.delta, sol.delta);
});
```

- [ ] **Step 3: Run to see them fail**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/snap.test.ts`
Expected: FAIL, cannot resolve `../../src/engine/snap`.

- [ ] **Step 4: Implement `src/engine/snap.ts`**

```ts
// Snapping for path drags, bounding-box scaling and control-point drags, and the path a filled region belongs to.
// Pure: takes a doc and explicit inputs, returns values. World distances throughout.
import { toWorld, windowOffsets } from './lattice';
import { apply, compose, invert, cellMatrix } from './transform';
import { getPath, pathNodes, pathWorld, isClosed, nearestT, cloneMatrices } from './paths';
import { collectSegments } from './regions';
import type { Doc, XY, Matrix, Copy, WorldSeg, BodyTargets, BodySnap, SnapHit } from '../types';

const add = (a: XY, b: XY): XY => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: XY, b: XY): XY => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: XY, k: number): XY => ({ x: a.x * k, y: a.y * k });
const dot = (a: XY, b: XY) => a.x * b.x + a.y * b.y;
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const linear = (M: Matrix, v: XY): XY => ({ x: M[0] * v.x + M[2] * v.y, y: M[1] * v.x + M[3] * v.y });

export function bezAt(a: XY, cp: XY | null, b: XY, t: number): XY {
  if (!cp) return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  const s = 1 - t;
  return { x: s * s * a.x + 2 * s * t * cp.x + t * t * b.x, y: s * s * a.y + 2 * s * t * cp.y + t * t * b.y };
}

// Solve S(pi) + S_L δ = K(pj) + K_L δ for the source-frame delta δ. Full rank: one δ. Rank 1 (a reflection relative to S):
// a line of δ when solvable. K_L = S_L (a translation relative to S): the two move in lockstep, so null.
export function solveCopyMeet(S: Matrix, K: Matrix, pi: XY, pj: XY): { kind: 'point'; delta: XY } | { kind: 'line'; base: XY; dir: XY } | null {
  const A = [S[0] - K[0], S[1] - K[1], S[2] - K[2], S[3] - K[3]];   // x' = A0 x + A2 y, y' = A1 x + A3 y
  const r = sub(apply(K, pj), apply(S, pi));
  const f2 = A[0] ** 2 + A[1] ** 2 + A[2] ** 2 + A[3] ** 2;
  if (f2 < 1e-12) return null;
  const det = A[0] * A[3] - A[2] * A[1];
  if (Math.abs(det) > 1e-9 * f2) return { kind: 'point', delta: { x: (A[3] * r.x - A[2] * r.y) / det, y: (-A[1] * r.x + A[0] * r.y) / det } };
  const base = { x: (A[0] * r.x + A[1] * r.y) / f2, y: (A[2] * r.x + A[3] * r.y) / f2 };   // Aᵀr / |A|², the pseudo-inverse for rank 1
  const back = { x: A[0] * base.x + A[2] * base.y, y: A[1] * base.x + A[3] * base.y };
  if (dist(back, r) > 1e-6 * (1 + Math.hypot(r.x, r.y))) return null;
  const r0 = { x: A[0], y: A[2] }, r1 = { x: A[1], y: A[3] };
  const row = Math.hypot(r0.x, r0.y) >= Math.hypot(r1.x, r1.y) ? r0 : r1, L = Math.hypot(row.x, row.y);
  return { kind: 'line', base, dir: { x: -row.y / L, y: row.x / L } };
}

// Every copy of a path in the 3×3 window: the plain cell copies and every live clone in each cell.
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

// Everything a body drag of `pathId` can snap to, in the source frame. Taken once at the start of the drag: the targets
// do not move (anything that moves with the path is excluded) and the path's own copies' matrices do not change.
export function bodyTargets(doc: Doc, pathId: string): BodyTargets | null {
  const path = getPath(doc, pathId);
  if (!path) return null;
  const nodes = pathNodes(path), Pw = pathWorld(doc, path);
  const idx = isClosed(path) ? nodes.slice(0, -1).map((_, i) => i) : [0, nodes.length - 1];
  const moving = idx.filter((i) => !nodes[i].via).map((i) => ({ index: i, p: Pw[i] }));
  const mine = new Set(nodes.map((n) => n.pointId));
  const ownBindings = new Set(doc.bindings.filter((b) => b.pathId === pathId).map((b) => b.id));
  const movesWith = (n: { pointId: string; via?: Copy }) => mine.has(n.pointId) || (!!n.via && ownBindings.has(n.via.bindingId!));
  const points: BodyTargets['points'] = [];
  for (let v = -1; v <= 2; v++) for (let u = -1; u <= 2; u++) points.push({ at: toWorld({ u, v }, doc.lattice), hit: { kind: 'corner' } });
  for (const q of doc.paths) {
    if (q.id === pathId) continue;
    const qn = pathNodes(q), qw = pathWorld(doc, q);
    for (const { copy, M } of windowCopies(doc, q.id)) qn.forEach((n, i) => {
      if (n.via || movesWith(n)) return;
      points.push({ at: apply(M, qw[i]), hit: { kind: 'node', pointId: n.pointId, cell: { ...n.cell }, copy } });
    });
  }
  const own: BodyTargets['own'] = [];
  for (const { copy, M } of windowCopies(doc, pathId)) if (copy.bindingId) for (const m of moving) own.push({ K: M, p: m.p });
  const segs = collectSegments(doc).filter((s) => {
    if (s.source.pathId === pathId) return false;
    const qn = pathNodes(getPath(doc, s.source.pathId)!);
    return !movesWith(qn[s.source.j]) && !movesWith(qn[s.source.j + 1]);
  });
  return { moving, points, own, segs };
}

const boxDist = (s: WorldSeg, p: XY): number => {
  const xs = [s.a.x, s.b.x, ...(s.cp ? [s.cp.x] : [])], ys = [s.a.y, s.b.y, ...(s.cp ? [s.cp.y] : [])];
  const dx = Math.max(Math.min(...xs) - p.x, 0, p.x - Math.max(...xs)), dy = Math.max(Math.min(...ys) - p.y, 0, p.y - Math.max(...ys));
  return Math.hypot(dx, dy);
};

// The best snap for a raw source-frame delta, or null. Point-class candidates (corners, other nodes, meeting a rotated
// own copy) beat line-class (meeting a mirrored own copy) and curve-class (another path's segment).
export function snapBodyDelta(T: BodyTargets, raw: XY, threshold: number): BodySnap | null {
  let best: BodySnap | null = null, bd = threshold;
  const offer = (dd: number, s: BodySnap) => { if (dd <= bd) { bd = dd; best = s; } };
  for (const m of T.moving) {
    const e0 = add(m.p, raw);
    for (const t of T.points) offer(dist(t.at, e0), { delta: add(raw, sub(t.at, e0)), nodeIndex: m.index, at: t.at, cls: 'point', hit: t.hit });
    for (const o of T.own) {
      const r = solveCopyMeet([1, 0, 0, 1, 0, 0], o.K, m.p, o.p);
      if (r?.kind === 'point') offer(dist(r.delta, raw), { delta: r.delta, nodeIndex: m.index, at: add(m.p, r.delta), cls: 'point', hit: { kind: 'own' } });
    }
  }
  if (best) return best;
  for (const m of T.moving) {
    const e0 = add(m.p, raw);
    for (const o of T.own) {
      const r = solveCopyMeet([1, 0, 0, 1, 0, 0], o.K, m.p, o.p);
      if (r?.kind !== 'line') continue;
      const delta = add(r.base, mul(r.dir, dot(sub(raw, r.base), r.dir))), at = add(m.p, delta);
      offer(dist(delta, raw), { delta, nodeIndex: m.index, at, cls: 'line', hit: { kind: 'own' }, line: [add(at, mul(r.dir, -1e4)), add(at, mul(r.dir, 1e4))] });
    }
    for (const s of T.segs) {
      if (boxDist(s, e0) > bd) continue;
      const t = nearestT(s.a, s.cp, s.b, e0), q = bezAt(s.a, s.cp, s.b, t);
      offer(dist(q, e0), { delta: add(raw, sub(q, e0)), nodeIndex: m.index, at: q, cls: 'curve',
        hit: { kind: 'curve', pathId: s.source.pathId, j: s.source.j, t, copy: { cell: { ...s.source.copy.cell }, bindingId: s.source.copy.bindingId, power: s.source.copy.power } } });
    }
  }
  return best;
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/snap.test.ts && npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/types.ts src/engine/snap.ts tests/unit/snap.test.ts
git -C ~/Developer/personal/tesselator commit -m "Engine: body-drag snap targets (corners, other nodes and curves, own rotated and mirrored copies)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Scale and control-point snapping engine

**Files:**
- Modify: `src/config.ts`, `src/engine/snap.ts`
- Test: `tests/unit/snap.test.ts`

**Interfaces:**
- Consumes: `Line` (Task 3), `windowCopies`, `collectSegments`, `viaMatrix` from `paths.ts`.
- Produces:
  - `CONFIG.SCALE_FRACTIONS = [1, 1 / 2, 1 / 3] as const`
  - `snapScale(nodes: XY[], lat: Lattice, h: BoxHandle, raw: { sx: number; sy: number }, free: boolean, threshold: number, fractions: readonly number[]): { sx: number; sy: number; snapped: boolean }`
  - `cpLines(doc: Doc, pathId: string, j: number, copy: Copy): Line[]` (world lines at the copy)
  - `snapToLines(w: XY, lines: Line[], threshold: number): { at: XY; used: Line[] } | null`

- [ ] **Step 1: Failing tests**

Append to `tests/unit/snap.test.ts`, and extend its imports to `import { solveCopyMeet, bodyTargets, snapBodyDelta, snapScale, cpLines, snapToLines } from '../../src/engine/snap';`:

```ts
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
  const t = snapToLines({ x: 116, y: 16 }, L, 12)!;                                  // near the line through B along B→C
  expect(t.used).toHaveLength(1); expect(t.at.x).toBeCloseTo(114, 6); expect(t.at.y).toBeCloseTo(18, 6);
  const x = snapToLines({ x: 50, y: -45 }, L, 12)!;                                  // near the vertical through A and that tangent
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

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/snap.test.ts`
Expected: FAIL, `snapScale` is not exported.

- [ ] **Step 3: Implement**

In `src/config.ts`, after `CLONE_CAP`: `SCALE_FRACTIONS: [1, 1 / 2, 1 / 3] as const,   // bounding-box scale snaps to these fractions of each lattice span`.

In `src/engine/snap.ts`, add `viaMatrix` to the `paths` import and `Lattice, BoxHandle, Line` to the type import, then append:

```ts
const unit = (v: XY): XY | null => { const L = Math.hypot(v.x, v.y); return L < 1e-9 ? null : { x: v.x / L, y: v.y / L }; };
const cross = (a: XY, b: XY) => a.x * b.y - a.y * b.x;

// Scale factors that make the path's node extent 1, ½ or ⅓ of a lattice vector's horizontal (width) or vertical
// (height) span. Measured as how far the handle would jump; the raw factor's sign is kept so a flip still works.
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

// Lines a control point of segment j may snap to, in world at `copy`: horizontal and vertical through either end;
// through an end along any other segment that meets it there (its control point, or its other end if straight);
// through an end along the normal of a mirror copy of this path that fixes that end. Worked out at the copy's
// cell-(0, 0) version, whose neighbourhood lies in the 3×3 window, then shifted by the copy's cell (everything is
// lattice-periodic).
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
    if (T[0] * T[3] - T[2] * T[1] >= 0) continue;                                    // not a reflection
    for (const X of ends) {
      if (dist(apply(T, X), X) > 1e-4) continue;
      const c0 = { x: T[0] - 1, y: T[1] }, c1 = { x: T[2], y: T[3] - 1 };            // columns of T_L − I span the normal
      const dir = unit(Math.hypot(c0.x, c0.y) >= Math.hypot(c1.x, c1.y) ? c0 : c1);
      if (dir) out.push({ p: X, dir });
    }
  }
  return out.map((l) => ({ p: add(l.p, off), dir: l.dir }));
}

// Lines within the threshold of w; the nearest crossing of two of them if it is within the threshold too, else the
// projection on the nearest line.
export function snapToLines(w: XY, lines: Line[], threshold: number): { at: XY; used: Line[] } | null {
  const near = lines.map((l) => ({ l, d: Math.abs(cross(l.dir, sub(w, l.p))) })).filter((x) => x.d <= threshold).sort((a, b) => a.d - b.d);
  if (!near.length) return null;
  let best: { at: XY; used: Line[] } | null = null, bd = threshold;
  for (let i = 0; i < near.length; i++) for (let k = i + 1; k < near.length; k++) {
    const a = near[i].l, b = near[k].l, den = cross(a.dir, b.dir);
    if (Math.abs(den) < 1e-9) continue;
    const at = add(a.p, mul(a.dir, cross(sub(b.p, a.p), b.dir) / den)), dd = dist(at, w);
    if (dd <= bd) { bd = dd; best = { at, used: [a, b] }; }
  }
  if (best) return best;
  const l = near[0].l;
  return { at: add(l.p, mul(l.dir, dot(sub(w, l.p), l.dir))), used: [l] };
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/snap.test.ts && npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/config.ts src/engine/snap.ts tests/unit/snap.test.ts
git -C ~/Developer/personal/tesselator commit -m "Engine: scale snaps to lattice fractions; control points snap to axes, tangents and mirror normals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The path a filled region belongs to, and fills that travel

**Files:**
- Modify: `src/types.ts`, `src/engine/snap.ts`, `src/engine/paths.ts`, `src/engine/hit.ts`
- Test: `tests/unit/snap.test.ts`, `tests/unit/hit.test.ts`, `tests/unit/paths.test.ts`

**Interfaces:**
- Consumes: `Face`, `Piece` from types; `faceAt` from `regions.ts`; `viaMatrix` from `paths.ts`.
- Produces:
  - type `FillMove = { fillId: string; M: Matrix; seed: XY }` in `src/types.ts`
  - fill hit target: `{ kind: 'fill'; fillId: string; owner: { pathId: string; copy: Copy } | null }`
  - `faceOwner(doc: Doc, face: Face): { pathId: string; copy: Copy } | null` (copy in window terms, not yet shifted by a clicked cell)
  - `enclosedFills(doc: Doc, faces: Face[], pathId: string): FillMove[]`
  - `moveFillSeeds(doc: Doc, moves: FillMove[], delta: XY): void` in `paths.ts` (`delta` is a source-frame world delta; each seed moves by `M`'s linear part applied to it and is mapped back into the base cell)

- [ ] **Step 1: Failing tests**

Append to `tests/unit/snap.test.ts` (extend the snap import with `faceOwner, enclosedFills`, and add `import { computeFaces, faceAt } from '../../src/engine/regions';`):

```ts
test('faceOwner and enclosedFills: one closed path owns and carries its fill; a region shared by two paths is not carried', () => {
  const d = makeDoc();
  const sq = line(d, [{ u: 0.2, v: 0.2 }, { u: 0.4, v: 0.2 }, { u: 0.4, v: 0.4 }, { u: 0.2, v: 0.4 }], true);
  const f1 = P.addFill(d, { u: 0.3, v: 0.3 }, '#f00', 'L1');
  const p1 = line(d, [{ u: 0.6, v: 0.6 }, { u: 0.6, v: 0.9 }, { u: 0.9, v: 0.9 }]);
  const n1 = P.pathNodes(p1);
  const p2 = P.startPath(d, { ...n1[2], cell: { ...n1[2].cell } }, { color: '#000', weight: 2 }, 'L1');
  P.appendNode(d, p2.id, P.addPoint(d, { u: 0.9, v: 0.6 }));
  P.appendNode(d, p2.id, { ...n1[0], cell: { ...n1[0].cell } });
  P.addFill(d, { u: 0.75, v: 0.75 }, '#0f0', 'L1');
  const faces = computeFaces(d);
  expect(faceOwner(d, faceAt(faces, { x: 72, y: 72 })!)).toEqual({ pathId: sq.id, copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 } });
  expect(faceOwner(d, faceAt(faces, { x: 180, y: 180 })!)?.pathId).toBe(p2.id);          // equal shares: the later path
  expect(enclosedFills(d, faces, sq.id).map((m) => m.fillId)).toEqual([f1.id]);
  expect(enclosedFills(d, faces, p1.id)).toEqual([]);
});
```

Append to `tests/unit/paths.test.ts`:

```ts
test('moveFillSeeds moves a seed by the copy\'s linear part and wraps it into the base cell', () => {
  const doc = makeDoc();
  const f = P.addFill(doc, { u: 0.5, v: 0.5 }, '#f00', 'L1');
  P.moveFillSeeds(doc, [{ fillId: f.id, M: [1, 0, 0, 1, 0, 0], seed: { x: 120, y: 120 } }], { x: 24, y: 0 });
  expect(f.u).toBeCloseTo(0.6, 9); expect(f.v).toBeCloseTo(0.5, 9);
  P.moveFillSeeds(doc, [{ fillId: f.id, M: [1, 0, 0, 1, 0, 0], seed: { x: 120, y: 120 } }], { x: -144, y: 0 });
  expect(f.u).toBeCloseTo(0.9, 9);
  P.moveFillSeeds(doc, [{ fillId: f.id, M: [-1, 0, 0, 1, 240, 0], seed: { x: 120, y: 120 } }], { x: 24, y: 0 });   // a mirror copy moves it the other way
  expect(f.u).toBeCloseTo(0.4, 9);
});
```

In `tests/unit/hit.test.ts`, change the three fill expectations near line 121 from `toEqual({ kind: 'fill', fillId: fill.id })` to `toMatchObject({ kind: 'fill', fillId: fill.id })`, and add after that test:

```ts
test('a filled region reports the path that bounds it, at the copy under the pointer', () => {
  const d = makeDoc();
  const n0 = P.addPoint(d, { u: 0.2, v: 0.2 });
  const sq = P.startPath(d, n0, { color: '#000', weight: 2 }, 'L1');
  for (const uv of [{ u: 0.8, v: 0.2 }, { u: 0.8, v: 0.8 }, { u: 0.2, v: 0.8 }]) P.appendNode(d, sq.id, P.addPoint(d, uv));
  P.appendNode(d, sq.id, { ...n0, cell: { ...n0.cell } });
  const fill = P.addFill(d, { u: 0.5, v: 0.5 }, '#f00', 'L1');
  const ctx = ctxFor(d, { faces: computeFaces(d) });
  expect(hitTest(d, ctx, { x: 360, y: 120 })).toEqual({ kind: 'fill', fillId: fill.id, owner: { pathId: sq.id, copy: { cell: { c: 1, r: 0 }, bindingId: null, power: 0 } } });
  expect(hitTest(d, { ...ctx, tool: 'fill' }, { x: 120, y: 120 })).toMatchObject({ kind: 'fill', owner: null });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/snap.test.ts tests/unit/paths.test.ts tests/unit/hit.test.ts`
Expected: FAIL (`faceOwner`, `moveFillSeeds` missing; the hit target has no `owner`).

- [ ] **Step 3: Implement**

`src/types.ts`: add `export type FillMove = { fillId: string; M: Matrix; seed: XY };` and change the fill member of `HitTarget` to `| { kind: 'fill'; fillId: string; owner: { pathId: string; copy: Copy } | null }`.

`src/engine/snap.ts`: add `faceAt` to the `regions` import and `Face, Piece, FillMove` to the type import, then append:

```ts
const sameCopy = (a: Copy, b: Copy) => a.cell.c === b.cell.c && a.cell.r === b.cell.r && a.bindingId === b.bindingId && a.power === b.power;

function pieceLength(pc: Piece): number {
  const { a, cp, b } = pc.seg;
  let L = 0, prev = bezAt(a, cp, b, pc.t0);
  for (let i = 1; i <= 8; i++) { const q = bezAt(a, cp, b, pc.t0 + ((pc.t1 - pc.t0) * i) / 8); L += dist(prev, q); prev = q; }
  return L;
}

// The path copy that contributes the most length to a face's outer boundary (ties: the path later in doc.paths).
export function faceOwner(doc: Doc, face: Face): { pathId: string; copy: Copy } | null {
  const order = new Map(doc.paths.map((p, i) => [p.id, i] as const));
  const tally: { pathId: string; copy: Copy; len: number }[] = [];
  for (const pc of face.outer.pieces) {
    const s = pc.seg.source;
    let e = tally.find((x) => x.pathId === s.pathId && sameCopy(x.copy, s.copy));
    if (!e) { e = { pathId: s.pathId, copy: s.copy, len: 0 }; tally.push(e); }
    e.len += pieceLength(pc);
  }
  let best: (typeof tally)[number] | null = null;
  for (const e of tally) {
    if (!best || e.len > best.len + 1e-6 || (Math.abs(e.len - best.len) <= 1e-6 && (order.get(e.pathId) ?? -1) > (order.get(best.pathId) ?? -1))) best = e;
  }
  return best && { pathId: best.pathId, copy: { cell: { ...best.copy.cell }, bindingId: best.copy.bindingId, power: best.copy.power } };
}

// Fills whose region's outer boundary comes entirely from one copy of the path, with that copy's matrix and the seed's
// world position, so a drag of the path can carry them.
export function enclosedFills(doc: Doc, faces: Face[], pathId: string): FillMove[] {
  const out: FillMove[] = [];
  for (const f of doc.fills) {
    const seed = toWorld(f, doc.lattice), face = faceAt(faces, seed);
    const src = face ? face.outer.pieces.map((pc) => pc.seg.source) : [];
    if (!src.length || !src.every((s) => s.pathId === pathId && sameCopy(s.copy, src[0].copy))) continue;
    out.push({ fillId: f.id, M: viaMatrix(doc, src[0].copy), seed });
  }
  return out;
}
```

`src/engine/paths.ts`, in the fills section after `removeFill` (add `FillMove` to the type import; `cellOf`, `toUV` are already imported):

```ts
// Move fill seeds with a dragged path: each by its copy's linear part applied to the source-frame delta, wrapped into the base cell.
export function moveFillSeeds(doc: Doc, moves: FillMove[], delta: XY): void {
  for (const m of moves) {
    const f = getFill(doc, m.fillId);
    if (!f) continue;
    const w = { x: m.seed.x + m.M[0] * delta.x + m.M[2] * delta.y, y: m.seed.y + m.M[1] * delta.x + m.M[3] * delta.y };
    const { local } = cellOf(toUV(w, doc.lattice));
    f.u = local.u; f.v = local.v;
  }
}
```

`src/engine/hit.ts`: import `faceOwner` from `./snap` and `cellOf` from `./lattice`, and replace the fill return:

```ts
      if (fill) {
        const o = ctx.tool === 'select' ? faceOwner(doc, face) : null, k = cellOf(toUV(w, lat)).cell;
        return { kind: 'fill', fillId: fill.id, owner: o && { pathId: o.pathId, copy: { ...o.copy, cell: { c: o.copy.cell.c + k.c, r: o.copy.cell.r + k.r } } } };
      }
```

- [ ] **Step 4: Run all tests and typecheck**

Run: `npx vitest run --root ~/Developer/personal/tesselator && npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: PASS. `tsc` also checks every other place that builds a fill hit target; there is none outside `hit.ts` today.

- [ ] **Step 5: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/types.ts src/engine/snap.ts src/engine/paths.ts src/engine/hit.ts tests/unit/snap.test.ts tests/unit/paths.test.ts tests/unit/hit.test.ts
git -C ~/Developer/personal/tesselator commit -m "Engine: a filled region names the path around it; fills enclosed by a path can travel with it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Wire it into the Select tool, the pointer, actions and the canvas

**Files:**
- Modify: `src/types.ts` (drag fields), `src/state/ui.ts`, `src/actions.ts`, `src/interaction/pointer.ts`, `src/interaction/tools/select.ts`, `src/components/Canvas.tsx`, `src/styles.css`, `src/components/Chrome.tsx`, `CLAUDE.md`
- Test: `tests/unit/select.test.ts` (new)

**Interfaces:**
- Consumes: everything from Tasks 2 to 5.
- Produces:
  - `UI.snapHint: Signal<SnapHint | null>`, `type SnapHint = { at: XY; kind: 'point' | 'line' | 'curve' | 'scale' | 'cp'; lines?: [XY, XY][] }` (exported from `ui.ts`), reset by `resetUi`.
  - `A.joinDroppedNode(pathId: string, nodeIndex: number, hit: SnapHit): boolean`
  - Drag fields: body `targets: BodyTargets | null; snap: BodySnap | null; fills: FillMove[] | null`; cp `lines: Line[]`; bbox `nodes: XY[]`.

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
import { faces } from '../../src/state/derived';
import { computeFaces } from '../../src/engine/regions';
import type { Doc, HitTarget, XY, UV, Copy } from '../../src/types';

const base: Copy = { cell: { c: 0, r: 0 }, bindingId: null, power: 0 };
const ev = () => ({ pointerId: 1, shiftKey: false, pointerType: 'mouse' }) as unknown as PointerEvent;
const ctxOn = { snapOn: true, hitScale: 1, threshold: 12 }, ctxOff = { snapOn: false, hitScale: 1, threshold: 12 };
function fresh(build: (d: Doc) => void) { reset(); UI.resetUi(); const d = emptyDoc(); build(d); doc.value = d; faces.value = computeFaces(d); UI.tool.value = 'select'; }
function line(d: Doc, pts: UV[], closed = false) {
  const n0 = P.addPoint(d, pts[0]);
  const p = P.startPath(d, n0, { color: '#000', weight: 2 }, d.layers[0].id);
  for (const uv of pts.slice(1)) P.appendNode(d, p.id, P.addPoint(d, uv));
  if (closed) P.appendNode(d, p.id, { pointId: n0.pointId, cell: { ...n0.cell } });
  return p;
}
// Mirrors pointer.ts: the gesture opens on the first move and closes after the tool's onUp.
function drag(t: HitTarget, from: XY, to: XY, ctx = ctxOn) {
  S.onDown(t, from, ev(), ctx);
  const d = UI.drag.value!;
  d.moved = true; beginGesture();
  S.onMove(d, to, ev(), ctx);
  UI.drag.value = null;
  S.onUp(d, to, ev(), ctx);
  endGesture();
}
function click(t: HitTarget, at: XY) { S.onDown(t, at, ev(), ctxOn); const d = UI.drag.value!; UI.drag.value = null; S.onUp(d, at, ev(), ctxOn); }
const seg = (pathId: string, copy: Copy = base): HitTarget => ({ kind: 'segment', pathId, j: 0, copy });

test('a body drag released on another path\'s line splits it and shares the point; one undo reverts both', () => {
  let stubId = '', hostId = '';
  fresh((d) => { hostId = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]).id; stubId = line(d, [{ u: 0.5, v: 0.1 }, { u: 0.5, v: 0.45 }]).id; });
  const endId = P.getPath(doc.value, stubId)!.segments[0].to.pointId;
  drag(seg(stubId), { x: 120, y: 60 }, { x: 120, y: 70 });            // the end goes to (120, 118), 2 from the host
  const host = P.getPath(doc.value, hostId)!, stub = P.getPath(doc.value, stubId)!;
  expect(host.segments).toHaveLength(2);
  expect(host.segments[0].to.pointId).toBe(stub.segments[0].to.pointId);
  const w = P.nodeWorld(doc.value, stub.segments[0].to);
  expect(w.x).toBeCloseTo(120, 6); expect(w.y).toBeCloseTo(120, 6);
  A.undo();
  expect(P.getPath(doc.value, hostId)!.segments).toHaveLength(1);
  expect(P.getPoint(doc.value, endId)!.v).toBeCloseTo(0.45, 9);
});

test('a body drag released on a clone\'s line joins through a via node', () => {
  let stubId = '', bId = '';
  fresh((d) => {
    const host = line(d, [{ u: 0.1, v: 0.2 }, { u: 0.4, v: 0.2 }]);      // its half-turn clone runs (216,192)–(144,192)
    const el = P.addElement(d, { kind: 'rotate', u: 0.5, v: 0.5, n: 2 });
    bId = P.addBinding(d, host.id, [[el.id]]).id;
    stubId = line(d, [{ u: 0.75, v: 0.5 }, { u: 0.75, v: 0.77 }]).id;    // ends at (180, 184.8)
  });
  drag(seg(stubId), { x: 180, y: 150 }, { x: 180, y: 153 });
  const end = P.getPath(doc.value, stubId)!.segments[0].to;
  expect(end.via).toEqual({ cell: { c: 0, r: 0 }, bindingId: bId, power: 1 });
  const w = P.nodeWorld(doc.value, end);
  expect(w.x).toBeCloseTo(180, 6); expect(w.y).toBeCloseTo(192, 6);
});

test('drag through cell (2, 0) snaps and joins as in the base cell', () => {
  let stubId = '', hostId = '';
  fresh((d) => { hostId = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]).id; stubId = line(d, [{ u: 0.5, v: 0.1 }, { u: 0.5, v: 0.45 }]).id; });
  drag(seg(stubId, { cell: { c: 2, r: 0 }, bindingId: null, power: 0 }), { x: 600, y: 60 }, { x: 600, y: 70 });
  expect(P.getPath(doc.value, hostId)!.segments).toHaveLength(2);
  expect(P.getPath(doc.value, hostId)!.segments[0].to.pointId).toBe(P.getPath(doc.value, stubId)!.segments[0].to.pointId);
});

test('with snapping off the path moves by the raw delta and joins nothing', () => {
  let stubId = '', hostId = '';
  fresh((d) => { hostId = line(d, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }]).id; stubId = line(d, [{ u: 0.5, v: 0.1 }, { u: 0.5, v: 0.45 }]).id; });
  drag(seg(stubId), { x: 120, y: 60 }, { x: 120, y: 70 }, ctxOff);
  expect(P.getPath(doc.value, hostId)!.segments).toHaveLength(1);
  expect(P.nodeWorld(doc.value, P.getPath(doc.value, stubId)!.segments[0].to).y).toBeCloseTo(118, 6);
  expect(UI.snapHint.value).toBe(null);
});

test('a filled region: click selects the path, click again selects the fill, drag carries the fill', () => {
  let sqId = '', fillId = '';
  fresh((d) => { sqId = line(d, [{ u: 0.2, v: 0.2 }, { u: 0.4, v: 0.2 }, { u: 0.4, v: 0.4 }, { u: 0.2, v: 0.4 }], true).id; fillId = P.addFill(d, { u: 0.3, v: 0.3 }, '#f00', d.layers[0].id).id; });
  const t: HitTarget = { kind: 'fill', fillId, owner: { pathId: sqId, copy: base } };
  click(t, { x: 72, y: 72 });
  expect(UI.selection.value).toEqual({ kind: 'path', id: sqId, copy: base });
  click(t, { x: 72, y: 72 });
  expect(UI.selection.value).toEqual({ kind: 'fill', id: fillId });
  drag(t, { x: 72, y: 72 }, { x: 72 + 60, y: 72 }, ctxOff);
  expect(P.getFill(doc.value, fillId)!.u).toBeCloseTo(0.55, 9);
  expect(P.getPoint(doc.value, P.getPath(doc.value, sqId)!.start.pointId)!.u).toBeCloseTo(0.45, 9);
});

test('a control-point drag snaps to the horizontal through its anchor', () => {
  let pid = '';
  fresh((d) => { pid = line(d, [{ u: 0.2, v: 0.2 }, { u: 0.6, v: 0.6 }]).id; });
  drag({ kind: 'diamond', pathId: pid, j: 0, copy: base }, { x: 96, y: 96 }, { x: 100, y: 52 });   // 4 below y = 48 through A
  const cp = P.cpWorld(doc.value, P.getPath(doc.value, pid)!, 0)!;
  expect(cp.y).toBeCloseTo(48, 6); expect(cp.x).toBeCloseTo(100, 6);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/select.test.ts`
Expected: FAIL (no join, no `snapHint`, the fill click selects the fill).

- [ ] **Step 3: Types and UI state**

`src/types.ts`: the body drag becomes
`| { kind: 'body'; pathId: string; copy: Copy; ids: string[]; startPos: Record<string, UV>; startEls: Element[]; targets: BodyTargets | null; snap: BodySnap | null; fills: FillMove[] | null }`,
the cp drag `| { kind: 'cp'; pathId: string; j: number; copy: Copy; lines: Line[] }`, and the bbox drag gains `nodes: XY[]`.

`src/state/ui.ts`:

```ts
export type SnapHint = { at: XY; kind: 'point' | 'line' | 'curve' | 'scale' | 'cp'; lines?: [XY, XY][] };
export const snapHint = signal<SnapHint | null>(null);       // what the current drag snapped to, for the canvas
```

and add `snapHint.value = null;` to `resetUi`.

- [ ] **Step 4: `A.joinDroppedNode`**

In `src/actions.ts` (add `SnapHit` to the type import):

```ts
// A body drag released on a snap joins the snapped end to what it landed on: another path's node (merged, or seen
// through its clone) or another path's segment (split at t first). Corners and the path's own copies join nothing.
// Skipped when a via node references the dragged point (a via onto a via is not representable).
export function joinDroppedNode(pathId: string, nodeIndex: number, hit: SnapHit): boolean {
  if (hit.kind === 'corner' || hit.kind === 'own') return false;
  return mutate((d) => {
    const path = P.getPath(d, pathId);
    const from = path && P.pathNodes(path)[nodeIndex];
    if (!from || from.via) return false;
    if (d.paths.some((p) => P.pathNodes(p).some((n) => n.via && n.pointId === from.pointId))) return false;
    let pointId: string, cell: { c: number; r: number };
    if (hit.kind === 'node') { pointId = hit.pointId; cell = hit.cell; }
    else { const n = P.insertNodeAt(d, hit.pathId, hit.j, hit.t); if (n.via) return false; pointId = n.pointId; cell = n.cell; }
    if (pointId === from.pointId) return false;
    const c = hit.copy;
    const target: Node = c.bindingId
      ? { pointId, cell: { ...cell }, via: { cell: { ...c.cell }, bindingId: c.bindingId, power: c.power } }
      : { pointId, cell: { c: cell.c + c.cell.c, r: cell.r + c.cell.r } };
    P.mergeIntoNode(d, from.pointId, from.cell, target);
  });
}
```

- [ ] **Step 5: Pointer: the tool's release runs inside the gesture**

In `src/interaction/pointer.ts` `onUp`, replace

```ts
    endGesture();
    t.onUp(d, world(e), e, ctxOf(e));
```

with

```ts
    t.onUp(d, world(e), e, ctxOf(e));   // inside the gesture, so a merge or join on release is part of the drag's undo step
    endGesture();
    UI.snapHint.value = null;
```

and in `onCancel`, inside the `if (UI.drag.value || dragTool)` block, add `UI.snapHint.value = null;`. (If pen-joins Task 2 already moved `t.onUp` before `endGesture`, keep its order and only add the two `snapHint` lines.) A release that is not a drag never opened a gesture, so its commits are ordinary entries as before.

- [ ] **Step 6: Select tool**

In `src/interaction/tools/select.ts`: import `faces` from `../../state/derived` (next to `copyMatrix`), `bodyTargets, snapBodyDelta, snapScale, cpLines, snapToLines, enclosedFills` from `../../engine/snap`, and `Path` from types if needed.

Add a body-drag starter and use it for segments and filled regions:

```ts
function startBody(t: HitTarget, pathId: string, copy: Copy, w: XY, e: PointerEvent, hitScale: number): void {
  const path = P.getPath(doc.value, pathId);
  if (!path) return;
  const ids = [...new Set(P.pathNodes(path).map((n) => n.pointId))];
  startDrag(e, t, w, hitScale, { kind: 'body', pathId, copy, ids, startPos: P.snapshotPositions(doc.value, ids), startEls: doc.value.elements.map((x) => ({ ...x })), targets: null, snap: null, fills: null });
}
```

In `onDown`:

```ts
    case 'segment': return startBody(t, t.pathId, t.copy, w, e, ctx.hitScale);
    case 'fill': return t.owner ? startBody(t, t.owner.pathId, t.owner.copy, w, e, ctx.hitScale) : startDrag(e, t, w, ctx.hitScale, { kind: 'click' });
    case 'diamond': return startDrag(e, t, w, ctx.hitScale, { kind: 'cp', pathId: t.pathId, j: t.j, copy: t.copy, lines: cpLines(doc.value, t.pathId, t.j, t.copy) });
```

In `startBBox`, add `nodes: P.pathWorld(doc.value, path).map((q) => apply(M, q))` to the drag spec.

In `onMove`, replace the `body` case:

```ts
    case 'body': {
      if (!d.moved) return;
      if (d.copy.bindingId) { cloneBodyMove(d, w, ctx); return; }
      // A source or cell copy is a pure translation of the source, so the pointer delta is the source delta. Targets and
      // enclosed fills are taken on the first move, before anything has moved.
      if (!d.targets) d.targets = bodyTargets(doc.value, d.pathId);
      if (!d.fills) d.fills = enclosedFills(doc.value, faces.value, d.pathId);
      const raw = { x: w.x - d.start.x, y: w.y - d.start.y };
      const sn = ctx.snapOn && d.targets ? snapBodyDelta(d.targets, raw, ctx.threshold) : null;
      d.snap = sn;
      const dv = sn ? A.uvOf(sn.delta) : A.snapDeltaUV(raw, ctx.snapOn);
      const off = A.worldOf({ u: d.copy.cell.c, v: d.copy.cell.r }), sh = (p: XY): XY => ({ x: p.x + off.x, y: p.y + off.y });
      UI.snapHint.value = sn ? { at: sh(sn.at), kind: sn.cls, lines: sn.line && [[sh(sn.line[0]), sh(sn.line[1])]] } : null;
      const fills = d.fills, dw = A.worldOf(dv);
      A.mutate((dd) => { P.movePointsBy(dd, d.ids, d.startPos, dv.u, dv.v); P.moveFillSeeds(dd, fills, dw); });
      return;
    }
```

Replace the `cp` case:

```ts
    case 'cp': {
      if (!d.moved) return;
      const M = copyMatrix(d.copy), s = ctx.snapOn ? snapToLines(w, d.lines, ctx.threshold) : null;
      UI.snapHint.value = s ? { at: s.at, kind: 'cp', lines: s.used.map((l) => [{ x: l.p.x - l.dir.x * 1e4, y: l.p.y - l.dir.y * 1e4 }, { x: l.p.x + l.dir.x * 1e4, y: l.p.y + l.dir.y * 1e4 }] as [XY, XY]) } : null;
      A.mutate((dd) => { P.setControlPointWorld(dd, d.pathId, d.j, apply(invert(M), s ? s.at : w)); });
      return;
    }
```

In the `bbox` case, replace the `else` (scale) branch:

```ts
      } else {
        const free = e.shiftKey || UI.freeScale.value;
        let { sx, sy } = scaleFor(d.h, w, free);
        UI.snapHint.value = null;
        if (UI.prefs.value.snap) {   // ⇧ means "free" here, so it does not invert snapping
          const s = snapScale(d.nodes, doc.value.lattice, d.h, { sx, sy }, free, ctx.threshold, CONFIG.SCALE_FRACTIONS);
          if (s.snapped) { sx = s.sx; sy = s.sy; UI.snapHint.value = { at: { x: d.h.ax + sx * (d.h.x - d.h.ax), y: d.h.ay + sy * (d.h.y - d.h.ay) }, kind: 'scale' }; }
        }
        T = scaleMatrix(d.h.ax, d.h.ay, sx, sy);
      }
```

In `onUp`, before `if (d.moved || !d.target) return;`, add:

```ts
  if (d.kind === 'body' && d.moved && d.snap) { A.joinDroppedNode(d.pathId, d.snap.nodeIndex, d.snap.hit); return; }
```

and replace the `fill` case:

```ts
    case 'fill':
      if (t.owner && !(s && s.kind === 'path' && s.id === t.owner.pathId && sameCopy(s.copy, t.owner.copy))) A.selectPathAt(t.owner.pathId, t.owner.copy);
      else A.selectFill(t.fillId);
      return;
```

If the `linear` helper in `select.ts` is now unused, delete it.

- [ ] **Step 7: Canvas mark**

In `src/components/Canvas.tsx`, add `snapHint` to the `../state/ui` import and add:

```tsx
function SnapMark() {
  const h = snapHint.value;
  if (!h) return null;
  const z = view.value.zoom;
  return <g>{(h.lines ?? []).map(([a, b], i) => <line key={i} class="guide" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />)}<circle class="snap-ring" cx={h.at.x} cy={h.at.y} r={7 / z} /></g>;
}
```

Render it right after `<Guides />` in the overlay list. In `src/styles.css`, after `.guide`: `.snap-ring { fill: none; stroke: var(--accent); stroke-width: 1.5; vector-effect: non-scaling-stroke; }`.

- [ ] **Step 8: Hint copy and docs**

In `src/components/Chrome.tsx`, in the hint switch, find the `case 'select':` return and append ` · drag inside a fill to move its path · second click selects the fill` to the Select text.

In `CLAUDE.md`, under Architecture add: ``- `src/engine/snap.ts` is pure snapping: body-drag targets (corners, other paths' nodes and curves, own rotated or mirrored copies), scale fractions of the lattice spans, control-point axis, tangent and mirror-normal lines, and the path that owns a filled region. The Select tool publishes the snap in `UI.snapHint`; a body drag released on a snap joins through `A.joinDroppedNode`.`` Under Model, change nothing. Under Known limitations, add: ``- Point drags and multi-point drags do not snap to curves or cell corners yet; a path's ends cannot snap to its own lattice copies (they move in lockstep).``

- [ ] **Step 9: Run everything**

Run: `npx vitest run --root ~/Developer/personal/tesselator && npx tsc --noEmit -p ~/Developer/personal/tesselator && npx vite build ~/Developer/personal/tesselator`
Expected: all PASS, build succeeds.

- [ ] **Step 10: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/types.ts src/state/ui.ts src/actions.ts src/interaction/pointer.ts src/interaction/tools/select.ts src/components/Canvas.tsx src/styles.css src/components/Chrome.tsx CLAUDE.md tests/unit/select.test.ts
git -C ~/Developer/personal/tesselator commit -m "Select: snapping path drags with joins on release, scale and control-point snaps, filled regions as handles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** §0 decisions: 1 (ends vs all nodes) → `bodyTargets`; 2 (toggle) → Task 6 `ctx.snapOn`, scale on `prefs.snap`; 3 (join) → Task 2 and `joinDroppedNode`; 4 (lattice copies) → `solveCopyMeet` returns null, CLAUDE.md limitation; 5 (fractions) → `snapScale`; 6 (cp lines) → `cpLines`; 7 (fill clicks) → Task 6 `onUp`. §2 targets, choice, feedback, join table → Tasks 3 and 6. §3 → Task 4 and the bbox branch. §4 axis, tangent, mirror-normal, crossing → Task 4 and the cp branch. §5 → Task 1. §6 owner, hit target, click cycle, drag, fills → Tasks 5 and 6. §7 engine additions → Tasks 2 to 5. §8 → CLAUDE.md limitations. §9 tests → each named test exists (paths: Tasks 1, 2, 5; snap: Tasks 3 to 5; actions-level behaviour in `select.test.ts`).

**Type consistency.** `BodyTargets`, `BodySnap`, `SnapHit`, `Line`, `FillMove` are defined once in `src/types.ts` (Tasks 3 and 5) and used by `snap.ts`, the drag union, `joinDroppedNode` and the tests with the same fields. `snapBodyDelta(T, raw, threshold)`, `snapScale(nodes, lat, h, raw, free, threshold, fractions)`, `cpLines(doc, pathId, j, copy)`, `snapToLines(w, lines, threshold)`, `faceOwner(doc, face)`, `enclosedFills(doc, faces, pathId)`, `moveFillSeeds(doc, moves, delta)`, `mergeIntoNode(doc, fromId, fromCell, target)` match between definition and every call.

**Review Focus.** 1 → Task 3 "segments touching the dragged points"; 2 → Task 6 "drag through cell (2, 0)"; 3 → Task 6 "with snapping off"; 4 → Task 6 undo assertions in the first test; 5 → Task 4 tangent test (the neighbour B→C is straight).
