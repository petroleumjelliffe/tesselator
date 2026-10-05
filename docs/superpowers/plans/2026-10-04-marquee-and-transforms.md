# Marquee and Transforms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A marquee selects whole path instances (S8), several selected instances show their nodes (S10) and move together (E5b), and a single selected path's box scales with `⇧` / `⌥` modifiers and silent size fractions (E6, T13), rotates from just outside a corner (E6a, H10), while translation elements resize to the same size fractions (E6b).

**Architecture:** One pure size-fraction helper (`nearestFraction` / `fractionWithin` in `src/engine/lattice.ts`) serves both box scale (`snapScale` in `src/engine/snap.ts`) and the translation tip drag (`src/interaction/tools/construct.ts`). Box maths (`boxScale`, `isOriginal`, the rotate zone, `instancesInRect`) is pure in `src/engine/hit.ts` and `src/engine/transform.ts`; the Select tool (`src/interaction/tools/select.ts`) drives it, and a several-path body drag carries the other selected paths as "riders" that follow the grabbed instance's on-screen delta through their own frames. The canvas cursor moves into a small testable module (`src/interaction/cursor.ts`).

**Tech Stack:** Preact + `@preact/signals`, TypeScript strict, Vite, Vitest.

**Spec:** `~/Developer/personal/tesselator/docs/superpowers/specs/2026-09-30-interaction-spec.md` (binding). This plan covers S8, S10, E5b, E6 with §6.5 box modifiers and T13, E6a with H10, and E6b. Out of scope: S7, SN2a, H9, D15, R9, R10, layers, regions, fills.

## Global Constraints

- Runtime dependencies stay exactly `preact` and `@preact/signals`.
- `npx tsc --noEmit -p ~/Developer/personal/tesselator` is clean after every commit.
- Tests: `npx vitest run --root ~/Developer/personal/tesselator` (single file: append `tests/unit/<file>.test.ts`).
- No browser, Playwright, Chrome DevTools or dev-server driving (the user's server runs on 5173).
- `src/engine/*` stays pure.
- Document mutations go through `src/actions.ts` (`A.mutate`, named actions) or the existing gesture `commit` in the box drag.
- Every user-visible string lives in `src/strings.ts`.
- Keep the `?` help sheet (`Help` in `src/components/Chrome.tsx`) in sync with `onKeyDown` in `src/interaction/pointer.ts`.
- Commit after each task; the message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never `cd` into the project: use absolute paths, `--root`, `-p`, `git -C ~/Developer/personal/tesselator`.
- Write home paths as `~/...`.
- Never stage `playground.html` or `src/playground/`; stage only the files a task names.

## Review Focus

The five failure modes the spec implies, no existing test covers, and a user is most likely to hit. Each has a test in its owning task.

1. **`⇧` / `⌥` pressed or released mid-scale.** The scale must depend only on the modifiers at the latest move, recomputed from the press (no compounding). Test: Task 2, "⇧ and ⌥ pressed or released mid-drag".
2. **Rotating a path that shares a point with another path.** The point must stay shared, the other path's unshared end must not move, and one undo must restore both. Test: Task 3, "rotating a path that shares a point".
3. **The rotate zone over another path's line.** In a dense design the zone outside a corner often lies on a neighbour's line: the zone must win (like a box handle) and the rotation must leave the neighbour alone. Test: Task 3, "the rotate zone wins over another path's line".
4. **A marquee over a path whose nodes span cells.** A path that leaves the tile through an edge has nodes in two cells; the marquee must judge the instance where it is drawn, in either tile. Test: Task 4, "a path leaving the tile through its right edge".
5. **E5b with a clone and its original both selected.** The path must move exactly once, through its original (the original follows the pointer, the clone follows its transform), even when the clone is the one grabbed. With only a clone selected, the clone follows the pointer and the original moves by the matching transformed amount. Tests: Task 6, "original and mirror clone selected" and "only a clone of a rider selected".

Also pinned (lower risk): `Esc` mid-rotate restores the path and leaves no history entry (Task 3); a zero-width box (a vertical line) writes no NaN under any modifier (Task 2).

---

## File Structure

| File | Responsibility in this plan |
| --- | --- |
| `src/config.ts` | `FRACTION_MAX_N` (4), `BBOX_ROT_ZONE_PX` (18), `ROTATE_STEP_DEG` (15); remove `SCALE_FRACTIONS` and `BBOX_ROT_OFFSET` |
| `src/types.ts` | `HitTarget` `bboxrot` gains the corner `h`; `bbox` drag gains `a0`; `body` drag gains `riders` and `replace`; new `BodyRider`; `BodyTargets` gains `excludePaths` |
| `src/engine/lattice.ts` | `nearestFraction`, `fractionWithin` (T13, shared) |
| `src/engine/hit.ts` | `boxScale` replaces `scaleFor`; `isOriginal`; the rotate zone replaces the rotation knob; `instancesInRect` |
| `src/engine/snap.ts` | `snapScale` rewritten for T13 on the box; `bodyTargets` takes the riders; `snapBodyDelta` reads `excludePaths` |
| `src/engine/transform.ts` | `rotationAngle`, `angleDeg` |
| `src/state/ui.ts` | `freeScale` becomes `keepProportions`; `selectedInstances()` |
| `src/state/derived.ts` | `multiNodeMarks` (S10) |
| `src/actions.ts` | `toggleKeepProportions` replaces `toggleFreeScale`; `selectInstances` |
| `src/interaction/tools/construct.ts` | E6b: translation tip snaps to size fractions |
| `src/interaction/tools/select.ts` | E6 scale, E6a rotation, S8 marquee, E5b riders |
| `src/interaction/cursor.ts` (new) | the canvas cursor, including the rotate cursor (moved out of `Canvas.tsx`) |
| `src/components/Canvas.tsx` | no rotation knob; cursor from `cursor.ts`; S10 node marks |
| `src/components/Chrome.tsx` | Proportional toggle; help sheet lines |
| `src/strings.ts` | hints, help, angle label; drop the scale label |
| `tests/unit/lattice.test.ts`, `transform.test.ts`, `hit.test.ts`, `snap.test.ts` | pure maths |
| `tests/unit/tools.test.ts` | every behaviour test, through `hitTest` → `hoverAt` → the tool's `onDown` / `onMove` / `onUp` |
| `CLAUDE.md`, the spec | shortcuts, limitations, architecture; status columns |

Task order: 1 → 2 → 3 → 4 → 5 → 6 → 7. Task 2 uses Task 1's helper; Task 3 reuses Task 2's test helpers; Tasks 5 and 6 reuse Task 4's selection plumbing and test helpers.

---

### Task 1: Size fractions (T13) and translation resize (E6b)

**Files:**
- Modify: `src/config.ts` (add `FRACTION_MAX_N` after `SCALE_FRACTIONS`, line 27)
- Modify: `src/engine/lattice.ts` (add two functions after `snapFraction`, lines 45–50)
- Modify: `src/interaction/tools/construct.ts` (import line 6; delete `twelfths`, line 30; `eltip` case, lines 52–60)
- Modify: `src/strings.ts` (`hint.translate`, line 36)
- Test: `tests/unit/lattice.test.ts`, `tests/unit/tools.test.ts`

**Interfaces:**
- Produces: `nearestFraction(x: number, maxN: number): number` — the nearest k/n to `x`, k any integer, 1 ≤ n ≤ maxN.
- Produces: `fractionWithin(x: number, unit: number, maxN: number, tol: number): number | null` — `nearestFraction(x, maxN)` when `|x − q| · unit ≤ tol` (world units), else null.
- Produces: `CONFIG.FRACTION_MAX_N = 4`.
- Consumes: `ToolCtx.targetsOn`, `ToolCtx.threshold` (`src/interaction/tools/common.ts`).

- [ ] **Step 1: Write the failing engine test**

In `tests/unit/lattice.test.ts`, change the import on line 2 to:

```ts
import { toWorld, toUV, cellOf, nodeUV, windowOffsets, visibleOffsets, snapGrid, snapFraction, isDegenerate, cellPolygon, latticeAngle, nearestFraction, fractionWithin } from '../../src/engine/lattice';
```

Append:

```ts
test('nearestFraction: the nearest k/n with n ≤ maxN, any integer k; fractionWithin applies a world tolerance', () => {
  expect(nearestFraction(0.26, 4)).toBe(0.25);
  expect(nearestFraction(0.32, 4)).toBeCloseTo(1 / 3, 12);
  expect(nearestFraction(0.55, 4)).toBe(0.5);
  expect(nearestFraction(1.26, 4)).toBe(1.25);
  expect(nearestFraction(-0.26, 4)).toBe(-0.25);
  expect(nearestFraction(0.1, 4)).toBe(0);
  expect(nearestFraction(0.32, 2)).toBe(0.5);                 // thirds are not offered when maxN is 2
  expect(fractionWithin(0.508, 240, 4, 12)).toBe(0.5);        // 2 world px away
  expect(fractionWithin(0.1, 240, 4, 12)).toBe(null);         // 24 px from 0
  expect(fractionWithin(0.1, 240, 4, 30)).toBe(0);
});
```

- [ ] **Step 2: Run it and expect a failure**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/lattice.test.ts`
Expected: FAIL — `nearestFraction` is not exported.

- [ ] **Step 3: Implement the helper**

In `src/engine/lattice.ts`, after `snapFraction` (ends line 50), add:

```ts
// Spec T13: the nearest k/n to x (k any integer, 1 ≤ n ≤ maxN). Ties keep the smaller n.
export function nearestFraction(x: number, maxN: number): number {
  let best = Math.round(x), bd = Math.abs(x - best);
  for (let n = 2; n <= maxN; n++) {
    const q = Math.round(x * n) / n, dd = Math.abs(x - q);
    if (dd < bd - 1e-12) { bd = dd; best = q; }
  }
  return best;
}

// T13, silent: x snapped to its nearest k/n when that is within `tol` world units, one unit of x being `unit` long.
export function fractionWithin(x: number, unit: number, maxN: number, tol: number): number | null {
  const q = nearestFraction(x, maxN);
  return Math.abs(x - q) * unit <= tol ? q : null;
}
```

In `src/config.ts`, after line 27 (`SCALE_FRACTIONS`), add:

```ts
  FRACTION_MAX_N: 4,     // T13: size fractions k/n of the tile, n ≤ this (may later grow with zoom)
```

- [ ] **Step 4: Run the engine test and expect a pass**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/lattice.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tool tests (E6b)**

In `tests/unit/tools.test.ts`, add to the import block (after line 10):

```ts
import * as construct from '../../src/interaction/tools/construct';
```

Append at the end of the file:

```ts
// --- E6b: a translation element's u and v snap silently to k/n of the tile (T13); ⌘ / Ctrl frees them; G is ignored

function translateScene(u = 0.5, v = 0) {
  let id = '';
  fresh('pen', (d) => { id = P.addElement(d, { kind: 'translate', u, v }).id; });
  UI.layer.value = 'construction';
  const el = () => { const e = P.getElement(doc.value, id)!; if (e.kind !== 'translate') throw new Error('not a translation'); return e; };
  return { id, el };
}

test('E6b: dragging a translation tip near (1/2, 1/4) lands exactly there, grid on or off, with no hint', () => {
  for (const c of [ctx, noGrid]) {
    const { el } = translateScene();
    expect(hit({ x: 120, y: 0 })).toMatchObject({ kind: 'eltip' });
    gesture(construct, [{ x: 120, y: 0 }, { x: 121, y: 40 }, { x: 122, y: 61 }], ev(), c);   // u = 0.508, v = 0.254
    expect(el().u).toBe(0.5); expect(el().v).toBe(0.25);
    expect(UI.snapHint.value).toBe(null);
  }
});

test('E6b: with ⌘ held the tip lands where the pointer is, even with the grid on', () => {
  const { el } = translateScene();
  gesture(construct, [{ x: 120, y: 0 }, { x: 121, y: 40 }, { x: 122, y: 61 }], ev({ metaKey: true }), free(ctx));
  expect(el().u).toBeCloseTo(122 / 240, 9); expect(el().v).toBeCloseTo(61 / 240, 9);
});

test('E6b: a component more than the threshold from every fraction stays free; the other still snaps', () => {
  const { el } = translateScene();
  gesture(construct, [{ x: 120, y: 0 }, { x: 60, y: 60 }, { x: 24, y: 121 }], ev(), ctx);   // u = 0.1 (24 px from 0), v = 0.504
  expect(el().u).toBeCloseTo(0.1, 9); expect(el().v).toBe(0.5);
});
```

- [ ] **Step 6: Run them and expect failures**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/tools.test.ts`
Expected: FAIL — the first test's grid-on pass succeeds (twelfths happen to give 1/2 and 1/4) but its `noGrid` pass fails (nothing snaps with the grid off); the second test fails (twelfths still apply with the grid on); the third fails (twelfths turn u = 0.1 into 1/12).

- [ ] **Step 7: Implement E6b in the construct tool**

In `src/interaction/tools/construct.ts`:

Line 6 becomes:

```ts
import { toUV, isDegenerate, fractionWithin } from '../../engine/lattice';
```

Delete line 30 (`const twelfths = (x: number) => Math.round(x * 12) / 12;`).

Replace the `eltip` case (lines 52–60) with:

```ts
    case 'eltip': {
      A.mutate((dd) => {
        const el = P.getElement(dd, d.id); if (!el || el.kind !== 'translate') return false;
        const lat = dd.lattice;
        let { u, v } = toUV(w, lat);
        if (ctx.targetsOn) {   // E6b, T13: silent k/n of the tile; ignores G; ⌘ / Ctrl frees
          u = fractionWithin(u, Math.hypot(lat.ax, lat.ay), CONFIG.FRACTION_MAX_N, ctx.threshold) ?? u;
          v = fractionWithin(v, Math.hypot(lat.bx, lat.by), CONFIG.FRACTION_MAX_N, ctx.threshold) ?? v;
        }
        el.u = u; el.v = v;
      });
      return;
    }
```

In `src/strings.ts`, line 36 becomes:

```ts
    translate: 'Translation: drag the diamond to set the vector · snaps to quarters, thirds and halves of the tile · hold ⌘ or Ctrl for any length',
```

- [ ] **Step 8: Run the tests and type check, expect a pass**

Run: `npx vitest run --root ~/Developer/personal/tesselator` then `npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: all tests PASS; tsc prints nothing.

- [ ] **Step 9: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/config.ts src/engine/lattice.ts src/interaction/tools/construct.ts src/strings.ts tests/unit/lattice.test.ts tests/unit/tools.test.ts
git -C ~/Developer/personal/tesselator commit -m "E6b, T13: translation resize snaps silently to k/n of the tile; shared size-fraction helper" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Box scale modifiers and silent size fractions (E6, §6.5, T13)

Today a corner drag is proportional unless `⇧` (or the touch "Free" toggle) is held, and the scale snaps to `CONFIG.SCALE_FRACTIONS` of the node extents with a "scale …" hint. After this task: corners scale each axis freely by default, `⇧` keeps proportions, `⌥` scales about the box centre, they combine, and the box's width and height snap silently to k/n of the tile (n ≤ 4) unless `⌘` / `Ctrl`. The endpoint hints stay.

**Files:**
- Modify: `src/engine/hit.ts` (replace `scaleFor`, lines 256–267)
- Modify: `src/engine/snap.ts` (imports lines 6 and 11; replace `snapScale`, lines 401–420)
- Modify: `src/config.ts` (delete `SCALE_FRACTIONS`, line 27)
- Modify: `src/interaction/tools/select.ts` (import line 8; scale branch of the `bbox` case, lines 209–218)
- Modify: `src/state/ui.ts` (`freeScale`, lines 24 and 40)
- Modify: `src/actions.ts` (`toggleFreeScale`, line 155)
- Modify: `src/components/Chrome.tsx` (the Free button, line 149)
- Modify: `src/strings.ts` (`snap.scale` line 29, `hint.path` line 41, `titles.freeScale` line 119, `bar.freeScale` line 181)
- Test: `tests/unit/hit.test.ts` (import line 3, lines 103–109), `tests/unit/snap.test.ts` (lines 262–277), `tests/unit/tools.test.ts`

**Existing tests that change:**
- `tests/unit/hit.test.ts` "marquee, projection, bbox maths, seedOf": the four `scaleFor` lines (105–109) become `boxScale` calls with explicit modifiers (Step 1).
- `tests/unit/snap.test.ts` "snapScale: an edge lands on a half and a third…" and "snapScale: a uniform corner…" (lines 262–277): rewritten for the box, the fixed point and `maxN` (Step 1).
- `tests/unit/tools.test.ts` "Select: scaling a path with nothing else near shows no endpoint hint" (lines 262–275) stays as it is and must still pass: × 1.4 makes the box 100.8 wide, 19.2 px from the nearest fraction (120).

**Interfaces:**
- Produces (`src/engine/hit.ts`): `type ScaleMods = { proportional: boolean; fromCentre: boolean }` and `boxScale(box: Box, h: BoxHandle, p: XY, mods: ScaleMods): { sx: number; sy: number; ax: number; ay: number }` (`ax, ay` is the fixed point). Removes `scaleFor`.
- Produces (`src/engine/snap.ts`): `snapScale(box: Box, lat: Lattice, h: BoxHandle, a: XY, raw: { sx: number; sy: number }, proportional: boolean, threshold: number, maxN: number): { sx: number; sy: number; snapped: boolean }`.
- Produces: `UI.keepProportions: Signal<boolean>`, `A.toggleKeepProportions(): boolean`. Removes `UI.freeScale`, `A.toggleFreeScale`.
- Consumes: `nearestFraction` (Task 1), `CONFIG.FRACTION_MAX_N` (Task 1).

- [ ] **Step 1: Rewrite the engine tests to the new rules**

In `tests/unit/hit.test.ts`, line 3 becomes:

```ts
import { hitTest, anchorsWorld, snapWorld, pointsInRect, projectOnSegment, bboxHandles, boxScale, scaleMatrix, seedOf, pathsNear, type HitContext } from '../../src/engine/hit';
```

Replace lines 103–109 (from `const hs = bboxHandles(...)` through the `Number.isNaN(scaleFor(...))` line) with:

```ts
  const box = { x0: 0, y0: 0, x1: 100, y1: 50 }, hs = bboxHandles(box);
  expect(hs).toHaveLength(8);
  const plain = { proportional: false, fromCentre: false };
  const u = boxScale(box, hs[2], { x: 200, y: 100 }, { ...plain, proportional: true }); expect(u.sx).toBeCloseTo(2, 9); expect(u.sy).toBeCloseTo(2, 9);
  const f = boxScale(box, hs[2], { x: 200, y: 25 }, plain); expect(f.sx).toBeCloseTo(2, 9); expect(f.sy).toBeCloseTo(0.5, 9);
  const c = boxScale(box, hs[2], { x: 150, y: 75 }, { ...plain, fromCentre: true }); expect(c).toMatchObject({ ax: 50, ay: 25 }); expect(c.sx).toBeCloseTo(2, 9); expect(c.sy).toBeCloseTo(2, 9);
  const e = boxScale(box, hs[6], { x: 150, y: 0 }, { ...plain, proportional: true }); expect(e.sx).toBeCloseTo(1.5, 9); expect(e.sy).toBeCloseTo(1.5, 9);   // ⇧ on an edge: both axes
  const flatBox = { x0: 0, y0: 10, x1: 100, y1: 10 }, flat = bboxHandles(flatBox);   // zero-height box: edge handles coincide with the box centre line
  expect(boxScale(flatBox, flat[4], { x: 50, y: 40 }, plain)).toMatchObject({ sx: 1, sy: 1 });
  expect(Number.isNaN(boxScale(flatBox, flat[0], { x: 200, y: 10 }, { proportional: true, fromCentre: true }).sx)).toBe(false);
```

In `tests/unit/snap.test.ts`, replace lines 262–277 (the `const lat = …, F = …` line and both `snapScale` tests) with:

```ts
const lat = { ...CONFIG.LATTICE_PRESETS.Square };

test('snapScale: an edge lands on k/n of the tile (n ≤ 4) within the threshold; a flat axis is not snapped', () => {
  const box = { x0: 0, y0: 0, x1: 100, y1: 0 }, right = { x: 100, y: 0, ax: 0, ay: 0, cursor: '' }, a = { x: 0, y: 0 };
  expect(snapScale(box, lat, right, a, { sx: 1.21, sy: 1 }, false, 12, 4)).toEqual({ sx: 1.2, sy: 1, snapped: true });   // 121 → 120 = 1/2
  expect(snapScale(box, lat, right, a, { sx: 0.81, sy: 1 }, false, 12, 4).sx).toBeCloseTo(0.8, 9);                        // 81 → 80 = 1/3
  expect(snapScale(box, lat, right, a, { sx: 1.62, sy: 1 }, false, 12, 4).sx).toBeCloseTo(1.6, 9);                        // 162 → 160 = 2/3
  expect(snapScale(box, lat, right, a, { sx: 1, sy: 1 }, false, 12, 4).snapped).toBe(false);                              // 100: 20 from 80 and 120
  const bottom = { x: 50, y: 10, ax: 50, ay: 0, cursor: '' };
  expect(snapScale(box, lat, bottom, { x: 50, y: 0 }, { sx: 1, sy: 3 }, false, 12, 4)).toEqual({ sx: 1, sy: 3, snapped: false });
});

test('snapScale: a proportional corner takes the nearest candidate from either axis; about the centre the handle moves half as far', () => {
  const box = { x0: 0, y0: 0, x1: 100, y1: 60 }, corner = { x: 100, y: 60, ax: 0, ay: 0, cursor: '' };
  const s = snapScale(box, lat, corner, { x: 0, y: 0 }, { sx: 1.19, sy: 1.19 }, true, 12, 4);
  expect(s.snapped).toBe(true); expect(s.sx).toBeCloseTo(1.2, 9); expect(s.sy).toBeCloseTo(1.2, 9);
  const c = snapScale(box, lat, corner, { x: 50, y: 30 }, { sx: 1.21, sy: 1 }, false, 12, 4);
  expect(c.snapped).toBe(true); expect(c.sx).toBeCloseTo(1.2, 9);
});
```

- [ ] **Step 2: Run them and expect failures**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/hit.test.ts tests/unit/snap.test.ts`
Expected: FAIL — `boxScale` is not exported; `snapScale` takes a node list.

- [ ] **Step 3: Implement `boxScale` and the new `snapScale`**

In `src/engine/hit.ts`, replace `scaleFor` (lines 256–267) with:

```ts
// E6, §6.5 box modifiers: the scale a box handle dragged to p gives, and the fixed point it scales about. `proportional`
// (⇧) keeps the box's proportions: a corner projects p onto its diagonal, an edge applies its factor to both axes.
// `fromCentre` (⌥) scales about the box centre instead of the opposite handle. A handle with no extent on an axis (a
// zero-width or zero-height box) leaves that axis at 1, so nothing divides by zero.
export type ScaleMods = { proportional: boolean; fromCentre: boolean };
export function boxScale(box: Box, h: BoxHandle, p: XY, mods: ScaleMods): { sx: number; sy: number; ax: number; ay: number } {
  const ax = mods.fromCentre ? (box.x0 + box.x1) / 2 : h.ax, ay = mods.fromCentre ? (box.y0 + box.y1) / 2 : h.ay;
  const vx = h.x - ax, vy = h.y - ay;
  if (!vx && !vy) return { sx: 1, sy: 1, ax, ay };
  const clamp = (v: number) => (Math.abs(v) < 0.05 ? (v < 0 ? -0.05 : 0.05) : v);
  let sx = 1, sy = 1;
  if (vx && vy && mods.proportional) sx = sy = ((p.x - ax) * vx + (p.y - ay) * vy) / (vx * vx + vy * vy);
  else {
    if (vx) sx = (p.x - ax) / vx;
    if (vy) sy = (p.y - ay) / vy;
    if (mods.proportional) { if (vx) sy = sx; else sx = sy; }
  }
  return { sx: clamp(sx), sy: clamp(sy), ax, ay };
}
```

In `src/engine/snap.ts`, line 6 becomes:

```ts
import { toWorld, toUV, snapGrid, windowOffsets, nearestFraction } from './lattice';
```

and in the type import on line 11 add `Box` after `BoxHandle`:

```ts
import type { Doc, XY, Matrix, Copy, Lattice, SnapCat, SnapHit, SnapResult, PointTarget, LineTarget, TargetSet, StrokeCopy, Line, BoxHandle, Box, BodyTargets, BodySnap } from '../types';
```

Replace `snapScale` (lines 401–420) with:

```ts
// T13 (silent): a scaled box dimension snaps to k/n of the tile's span on that axis (n ≤ maxN, k ≥ 1): the width to
// |a.x| or |b.x|, the height to |a.y| or |b.y| (a span under 1 px is skipped). For a candidate scale c the handle is
// |s − c|·|v| from where the pointer put it (v from the fixed point `a` to the handle), so that is held to `threshold`.
// Proportional: a corner takes the nearest candidate of either axis for both, an edge its own axis's. Otherwise each
// moving axis snaps on its own.
export function snapScale(box: Box, lat: Lattice, h: BoxHandle, a: XY, raw: { sx: number; sy: number }, proportional: boolean, threshold: number, maxN: number): { sx: number; sy: number; snapped: boolean } {
  const W = box.x1 - box.x0, H = box.y1 - box.y0, vx = h.x - a.x, vy = h.y - a.y;
  const cands = (s: number, ext: number, spans: number[]): number[] => {
    if (ext < 1e-6) return [];
    const out: number[] = [];
    for (const span of spans) {
      if (span < 1) continue;
      const q = nearestFraction((Math.abs(s) * ext) / span, maxN);
      if (q > 0) out.push(((s < 0 ? -1 : 1) * q * span) / ext);
    }
    return out;
  };
  const pick = (s: number, cs: number[], len: number): number | null => {
    let best: number | null = null, bd = threshold;
    for (const c of cs) { const dd = Math.abs(s - c) * len; if (dd <= bd) { bd = dd; best = c; } }
    return best;
  };
  const cx = vx ? cands(raw.sx, W, [Math.abs(lat.ax), Math.abs(lat.bx)]) : [];
  const cy = vy ? cands(raw.sy, H, [Math.abs(lat.ay), Math.abs(lat.by)]) : [];
  if (proportional) {
    const s = vx && vy ? pick(raw.sx, [...cx, ...cy], Math.hypot(vx, vy)) : vx ? pick(raw.sx, cx, Math.abs(vx)) : vy ? pick(raw.sy, cy, Math.abs(vy)) : null;
    return s === null ? { ...raw, snapped: false } : { sx: s, sy: s, snapped: true };
  }
  const sx = vx ? pick(raw.sx, cx, Math.abs(vx)) : null, sy = vy ? pick(raw.sy, cy, Math.abs(vy)) : null;
  return { sx: sx ?? raw.sx, sy: sy ?? raw.sy, snapped: sx !== null || sy !== null };
}
```

Delete line 27 of `src/config.ts` (`SCALE_FRACTIONS: …`).

- [ ] **Step 4: Run the engine tests and expect a pass**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/hit.test.ts tests/unit/snap.test.ts`
Expected: PASS. (`select.ts` does not compile yet; Vitest does not type-check, and Step 7 fixes it.)

- [ ] **Step 5: Write the failing tool tests**

Append to `tests/unit/tools.test.ts`:

```ts
// --- E6, §6.5: box scale modifiers (⇧ proportions, ⌥ from the centre) and silent size fractions (T13)

const withCmd = (over: Partial<PointerEvent> = {}) => ev({ metaKey: true, ...over });
const expectAt = (p: XY, x: number, y: number) => { expect(p.x).toBeCloseTo(x, 6); expect(p.y).toBeCloseTo(y, 6); };
// A drag through `tool` with one event per point (the press uses es[0], the release the last); returns the hint shown
// after the last move.
function track(tool: ToolModule, pts: XY[], es: PointerEvent[], c: ToolCtx) {
  hoverAt(pts[0], hit(pts[0]), c);
  tool.onDown(hit(pts[0]), pts[0], es[0], c);
  const d = UI.drag.value!;
  d.moved = true; beginGesture();
  for (let i = 1; i < pts.length; i++) tool.onMove(d, pts[i], es[i], c);
  const hint = UI.snapHint.value;
  UI.drag.value = null;
  try { tool.onUp(d, pts[pts.length - 1], es[es.length - 1], c); } finally { endGesture(); }
  return hint;
}
// An open rhombus, selected, whose box (48,48)–(120,120) has empty corners: (84,48) → (120,84) → (84,120) → (48,84).
function rhombusScene(more: (d: Doc, rhombusId: string) => void = () => {}) {
  let id = '';
  fresh('freehand', (d) => { id = line(d, [{ u: 0.35, v: 0.2 }, { u: 0.5, v: 0.35 }, { u: 0.35, v: 0.5 }, { u: 0.2, v: 0.35 }]).id; more(d, id); });
  UI.tool.value = 'select';
  UI.selection.value = { kind: 'path', id, copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 } };
  const at = (i: number) => P.nodeWorld(doc.value, P.pathNodes(P.getPath(doc.value, id)!)[i]);
  return { id, at };
}

test('E6: a corner scales each axis on its own by default; ⇧ (or the Proportional toggle) keeps proportions', () => {
  let s = rhombusScene();
  expect(hit({ x: 120, y: 120 })).toMatchObject({ kind: 'bbox', h: 2 });
  track(select, [{ x: 120, y: 120 }, { x: 156, y: 138 }], [withCmd(), withCmd()], free(ctx));   // ⌘: no size fractions, the raw maths
  expectAt(s.at(1), 156, 93); expectAt(s.at(2), 102, 138);                                         // × 1.5 wide, × 1.25 tall, from (48,48)
  s = rhombusScene();
  const sh = withCmd({ shiftKey: true });
  track(select, [{ x: 120, y: 120 }, { x: 156, y: 138 }], [sh, sh], free(ctx));
  expectAt(s.at(1), 147, 97.5); expectAt(s.at(2), 97.5, 147);                                       // × 1.375 both ways
  s = rhombusScene();
  A.toggleKeepProportions();
  track(select, [{ x: 120, y: 120 }, { x: 156, y: 138 }], [withCmd(), withCmd()], free(ctx));
  expectAt(s.at(1), 147, 97.5);
});

test('E6: ⌥ scales from the box centre, and ⇧⌥ from the centre keeping proportions', () => {
  let s = rhombusScene();
  const alt = withCmd({ altKey: true });
  track(select, [{ x: 120, y: 120 }, { x: 156, y: 138 }], [alt, alt], free(ctx));
  expectAt(s.at(0), 84, 30); expectAt(s.at(1), 156, 84); expectAt(s.at(2), 84, 138);               // × 2 wide, × 1.5 tall about (84,84)
  s = rhombusScene();
  const both = withCmd({ altKey: true, shiftKey: true });
  track(select, [{ x: 120, y: 120 }, { x: 156, y: 138 }], [both, both], free(ctx));
  expectAt(s.at(0), 84, 21); expectAt(s.at(1), 147, 84); expectAt(s.at(2), 84, 147);               // × 1.75 both ways about (84,84)
});

test('E6 (review focus): ⇧ and ⌥ pressed or released mid-drag apply from the next move; only the last move\'s modifiers count', () => {
  let s = rhombusScene();
  const both = withCmd({ altKey: true, shiftKey: true });
  track(select, [{ x: 120, y: 120 }, { x: 138, y: 138 }, { x: 156, y: 138 }], [both, both, withCmd()], free(ctx));   // released before the last move
  expectAt(s.at(1), 156, 93); expectAt(s.at(2), 102, 138);                                           // as a plain drag to (156,138)
  s = rhombusScene();
  track(select, [{ x: 120, y: 120 }, { x: 156, y: 138 }, { x: 156, y: 138 }], [withCmd(), withCmd(), both], free(ctx));   // pressed, then one more move
  expectAt(s.at(1), 147, 84); expectAt(s.at(2), 84, 147);                                            // as a ⇧⌥ drag
});

test('E6, T13: a corner drag brings the width to exactly 1/3 of the tile, silently, grid on or off; ⌘ frees it', () => {
  for (const c of [ctx, noGrid]) {
    const s = rhombusScene();
    const hint = track(select, [{ x: 120, y: 120 }, { x: 129, y: 150 }], [ev(), ev()], c);           // raw: 81 wide (1 px from 80), 102 tall (18 from 120)
    const b = P.boundsWorld(doc.value, P.getPath(doc.value, s.id)!);
    expect(b.x1 - b.x0).toBeCloseTo(80, 6); expect(b.y1 - b.y0).toBeCloseTo(102, 6);
    expect(hint).toBe(null);                                                                        // H10: the size fractions are never hinted
  }
  const s = rhombusScene();
  track(select, [{ x: 120, y: 120 }, { x: 129, y: 150 }], [withCmd(), withCmd()], free(ctx));
  const b = P.boundsWorld(doc.value, P.getPath(doc.value, s.id)!);
  expect(b.x1 - b.x0).toBeCloseTo(81, 6);
});

test('E6: the endpoint hints still show while scaling: an end landing on another path\'s node', () => {
  rhombusScene((d) => { line(d, [{ u: 98 / 240, v: 0.2 }, { u: 98 / 240, v: 10 / 240 }]); });   // a node at (98, 48)
  const hint = track(select, [{ x: 120, y: 120 }, { x: 148, y: 148 }], [ev(), ev()], ctx);         // 100 × 100: no fraction near; the first end comes to (98, 48)
  expect(hint?.label).toBe(STR.snap.node);
  expectAt(hint!.at, 98, 48);
});

test('E6: the side handle of a vertical line (a zero-width box) changes nothing and writes no NaN, with any modifiers', () => {
  let id = '';
  fresh('freehand', (d) => { id = line(d, [{ u: 0.5, v: 0.2 }, { u: 0.5, v: 0.8 }]).id; });        // (120,48) → (120,192)
  UI.tool.value = 'select'; UI.selection.value = { kind: 'path', id, copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 } };
  expect(hit({ x: 120, y: 120 })).toMatchObject({ kind: 'bbox', h: 6 });                           // both side handles sit on the midpoint
  for (const e of [ev(), ev({ shiftKey: true }), ev({ altKey: true }), ev({ shiftKey: true, altKey: true })]) {
    track(select, [{ x: 120, y: 120 }, { x: 150, y: 130 }], [e, e], ctx);
    expect(doc.value.points.every((q) => Number.isFinite(q.u) && Number.isFinite(q.v))).toBe(true);
    const p = P.getPath(doc.value, id)!;
    expectAt(P.nodeWorld(doc.value, p.start), 120, 48); expectAt(P.nodeWorld(doc.value, p.segments[0].to), 120, 192);
  }
});
```

- [ ] **Step 6: Run them and expect failures**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/tools.test.ts`
Expected: FAIL — `select.ts` still imports `scaleFor`, and `A.toggleKeepProportions` does not exist.

- [ ] **Step 7: Wire the Select tool, the toggle and the strings**

In `src/interaction/tools/select.ts`, line 8 becomes:

```ts
import { pointsInRectAll, bboxHandles, boxScale, scaleMatrix } from '../../engine/hit';
```

Replace the scale branch of the `bbox` case (lines 209–218, from `} else {` through `T = scaleMatrix(d.h.ax, d.h.ay, sx, sy);` and its closing `}`) with:

```ts
      } else {
        // E6, §6.5: ⇧ keeps proportions, ⌥ scales from the box centre; they combine. The size fractions (T13) snap
        // silently unless ⌘ / Ctrl is held, whatever G says.
        const proportional = e.shiftKey || UI.keepProportions.value;
        const b = boxScale(d.box, d.h, w, { proportional, fromCentre: e.altKey });
        let { sx, sy } = b;
        if (ctx.targetsOn) {
          const s = snapScale(d.box, doc.value.lattice, d.h, { x: b.ax, y: b.ay }, { sx, sy }, proportional, ctx.threshold, CONFIG.FRACTION_MAX_N);
          sx = s.sx; sy = s.sy;
        }
        UI.snapHint.value = null;   // H10: no hint for the size fractions; the endpoint hints below still apply
        T = scaleMatrix(b.ax, b.ay, sx, sy);
      }
```

In `src/state/ui.ts`, line 24 becomes:

```ts
export const keepProportions = signal(false);  // touch stand-in for ⇧ while box-scaling: keep proportions
```

and in `resetUi` (line 40) replace `freeScale.value = false;` with `keepProportions.value = false;`.

In `src/actions.ts`, line 155 becomes:

```ts
export function toggleKeepProportions(): boolean { UI.keepProportions.value = !UI.keepProportions.value; return true; }
```

In `src/components/Chrome.tsx`, line 149 becomes:

```tsx
      <Btn cls="small" on={UI.keepProportions.value} title={STR.titles.keepProportions} onClick={() => A.toggleKeepProportions()}>{STR.bar.keepProportions}</Btn>
```

In `src/strings.ts`:
- delete line 29 (`scale: (f: string) => \`scale ${f}\`,`);
- line 41 becomes:

```ts
    path: 'Path: click a line to insert a point · drag ◇ to bend · double-click ◇ to straighten · box handles scale (⇧ keeps proportions, ⌥ from the centre, ⌘ frees the size steps) · any copy is editable · Layer chips move it · drag a node to pull it off a shared point',
```

- line 119 (`freeScale: 'Scale freely …'`) becomes:

```ts
    keepProportions: 'Keep proportions while scaling from the box handles (stands in for ⇧)',
```

- line 181 (`freeScale: 'Free',`) becomes:

```ts
    keepProportions: 'Proportional',
```

- [ ] **Step 8: Run all tests and the type check, expect a pass**

Run: `npx vitest run --root ~/Developer/personal/tesselator` then `npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: all PASS, including the unchanged "Select: scaling a path with nothing else near shows no endpoint hint"; tsc prints nothing.

- [ ] **Step 9: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/engine/hit.ts src/engine/snap.ts src/config.ts src/interaction/tools/select.ts src/state/ui.ts src/actions.ts src/components/Chrome.tsx src/strings.ts tests/unit/hit.test.ts tests/unit/snap.test.ts tests/unit/tools.test.ts
git -C ~/Developer/personal/tesselator commit -m "E6: box scale with ⇧ proportions and ⌥ from the centre; silent size fractions (T13)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Rotation from just outside a box corner (E6a, H10)

Today a knob 26 px above the box (`CONFIG.BBOX_ROT_OFFSET`, hit kind `bboxrot`, drawn in `BBox` in `Canvas.tsx` lines 149–152) rotates any selected instance about the box centre, from the knob's angle, in 15° steps while `G` is on, with no hint. After this task: there is no knob; hovering outside the box within 18 screen px beyond a corner handle's hit radius shows a rotate cursor, only when the selected instance is the original (no binding, cell (0, 0)); dragging from there rotates about the box centre from the press angle, in 15° steps while `G` is on (`⌘` does not free them), with a hint showing the angle at the turned corner.

**Files:**
- Modify: `src/types.ts` (`bboxrot`, line 84; `bbox` drag, line 107)
- Modify: `src/config.ts` (line 8)
- Modify: `src/engine/transform.ts` (add two functions before `toSvg`, line 159)
- Modify: `src/engine/hit.ts` (add `isOriginal` after `copyMatrixOf`, line 20; the box block, lines 113–119)
- Create: `src/interaction/cursor.ts`
- Modify: `src/interaction/tools/select.ts` (imports lines 8 and 10; `startBBox`, lines 91–101; the `rot` branch, lines 205–208)
- Modify: `src/components/Canvas.tsx` (import line 6; `BBox` lines 148–153; delete `cursorFor` and `bboxCursor`, lines 291–300)
- Modify: `src/strings.ts` (`snap` block; `hint.path`)
- Test: `tests/unit/transform.test.ts`, `tests/unit/tools.test.ts`

**Existing tests that change:** none reference the knob (`bboxrot` appears in no test). "priority: bbox handle beats point beats segment" in `hit.test.ts` must still pass (the zone is outside the box and beyond the handle radius).

**Interfaces:**
- Produces (`src/engine/transform.ts`): `rotationAngle(theta: number, stepDeg: number): number` — theta normalised to (−π, π], rounded to `stepDeg` degrees when `stepDeg > 0`; `angleDeg(theta: number): number` — degrees to one decimal, `-0` returned as `0`.
- Produces (`src/engine/hit.ts`): `isOriginal(c: Copy): boolean`; `HitTarget` `{ kind: 'bboxrot'; h: number }` (h = corner 0–3 in `bboxHandles` order).
- Produces (`src/interaction/cursor.ts`): `ROTATE_CURSOR: string`, `cursorFor(h?: HitTarget | null): string`.
- Produces: `CONFIG.BBOX_ROT_ZONE_PX = 18`, `CONFIG.ROTATE_STEP_DEG = 15`; removes `CONFIG.BBOX_ROT_OFFSET`.
- Produces: `STR.snap.angle(deg: number): string`.
- Consumes: Task 2's `track`, `rhombusScene`, `expectAt`, `withCmd` test helpers.

- [ ] **Step 1: Write the failing engine test**

In `tests/unit/transform.test.ts`, append `rotationAngle, angleDeg` to the import list on line 2, then append:

```ts
test('rotationAngle normalises to (−π, π] and steps; angleDeg reads tenths of a degree', () => {
  expect(rotationAngle(Math.PI / 2 + 0.05, 15)).toBeCloseTo(Math.PI / 2, 12);
  expect(rotationAngle((3 * Math.PI) / 2, 0)).toBeCloseTo(-Math.PI / 2, 12);
  expect(rotationAngle(0.1, 0)).toBeCloseTo(0.1, 12);
  expect(rotationAngle(Math.PI / 24 - 0.001, 15)).toBe(0);
  expect(angleDeg(Math.PI / 2)).toBe(90);
  expect(Object.is(angleDeg(-1e-9), 0)).toBe(true);
  expect(angleDeg(Math.atan2(41, 46) + Math.PI / 4)).toBe(86.7);
});
```

- [ ] **Step 2: Run it and expect a failure**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/transform.test.ts`
Expected: FAIL — `rotationAngle` is not exported.

- [ ] **Step 3: Implement the angle helpers**

In `src/engine/transform.ts`, before `toSvg` (line 159), add:

```ts
// E6a: a rotation angle (radians) normalised to (−π, π], rounded to `stepDeg`-degree steps when stepDeg > 0.
export function rotationAngle(theta: number, stepDeg: number): number {
  let t = Math.atan2(Math.sin(theta), Math.cos(theta));
  if (stepDeg > 0) { const k = (stepDeg * Math.PI) / 180; t = Math.round(t / k) * k; }
  return t <= -Math.PI ? t + 2 * Math.PI : t;
}

// H10: the angle in degrees for the rotation hint, to one decimal (clockwise on screen is positive).
export function angleDeg(theta: number): number {
  const d = Math.round(((theta * 180) / Math.PI) * 10) / 10;
  return d === 0 ? 0 : d;
}
```

- [ ] **Step 4: Run it and expect a pass**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/transform.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tool tests**

In `tests/unit/tools.test.ts`, add to the import block:

```ts
import { cursorFor, ROTATE_CURSOR } from '../../src/interaction/cursor';
```

Append:

```ts
// --- E6a, H10: rotation just outside a box corner, originals only, 15° steps following G, an angle hint

test('E6a: hovering just outside a corner of the selected original shows the rotate cursor; inside the box, a repeat or a clone shows none', () => {
  const s = rhombusScene();
  const w = { x: 130, y: 38 };                                                                        // 14 px from the corner (120, 48), outside the box
  hoverAt(w, hit(w), ctx);
  expect(UI.hover.value).toMatchObject({ kind: 'bboxrot', h: 1 });
  expect(cursorFor()).toBe(ROTATE_CURSOR);
  hoverAt({ x: 110, y: 58 }, hit({ x: 110, y: 58 }), ctx);                                            // inside the box
  expect(cursorFor()).not.toBe(ROTATE_CURSOR);
  UI.selection.value = { kind: 'path', id: s.id, copy: { cell: { c: 1, r: 0 }, bindingId: null, power: 0 } };   // its repeat, box (288,48)–(360,120)
  hoverAt({ x: 370, y: 38 }, hit({ x: 370, y: 38 }), ctx);
  expect(UI.hover.value?.kind).not.toBe('bboxrot');
  expect(cursorFor()).not.toBe(ROTATE_CURSOR);
  expect(hit({ x: 360, y: 48 })).toMatchObject({ kind: 'bbox', h: 1 });                              // the repeat still scales
  let bind = '';
  const m = rhombusScene((d, rid) => { const el = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 }); bind = P.addBinding(d, rid, [[el.id]]).id; });
  UI.selection.value = { kind: 'path', id: m.id, copy: { cell: { c: 0, r: 0 }, bindingId: bind, power: 1 } };   // its mirror clone, box (120,48)–(192,120)
  hoverAt({ x: 202, y: 38 }, hit({ x: 202, y: 38 }), ctx);
  expect(UI.hover.value?.kind).not.toBe('bboxrot');
  expect(hit({ x: 192, y: 48 })).toMatchObject({ kind: 'bbox', h: 1 });
});

test('E6a: dragging from the rotate zone turns the path about its box centre in 15° steps while G is on, ⌘ or not; the hint shows the angle', () => {
  for (const [c, e] of [[ctx, ev()], [free(ctx), ev({ metaKey: true })]] as const) {
    const s = rhombusScene();
    const hint = track(select, [{ x: 130, y: 38 }, { x: 140, y: 90 }, { x: 130, y: 125 }], [e, e, e], c);   // 86.7° raw: steps to 90°
    expectAt(s.at(0), 120, 84); expectAt(s.at(1), 84, 120); expectAt(s.at(2), 48, 84); expectAt(s.at(3), 84, 48);
    expect(hint?.label).toBe(STR.snap.angle(90));
    expectAt(hint!.at, 120, 120);                                                                      // the grabbed corner (120, 48), turned
  }
});

test('E6a: with G off the angle is free, and the hint reads it to a tenth of a degree', () => {
  const s = rhombusScene();
  const hint = track(select, [{ x: 130, y: 38 }, { x: 130, y: 125 }], [ev(), ev()], noGrid);
  const th = Math.atan2(41, 46) + Math.PI / 4;                                                        // from the press angle (−45°)
  expectAt(s.at(0), 84 + 36 * Math.sin(th), 84 - 36 * Math.cos(th));
  expect(hint?.label).toBe(STR.snap.angle(Math.round((th * 1800) / Math.PI) / 10));
});

test('E6a: Esc mid-rotation restores the path and leaves no history entry', () => {
  rhombusScene();
  const before = structuredClone(doc.value), p0 = { x: 130, y: 38 };
  hoverAt(p0, hit(p0), ctx);
  select.onDown(hit(p0), p0, ev(), ctx);
  const d = UI.drag.value!; d.moved = true; beginGesture();
  select.onMove(d, { x: 130, y: 130 }, ev(), ctx);
  expect(doc.value).not.toEqual(before);
  UI.drag.value = null; abortGesture();                                                               // what pointer.ts does on Esc mid-drag
  expect(doc.value).toEqual(before);
  expect(undo()).toBe(false);
});

test('E6a (review focus): rotating a path that shares a point with another keeps the point shared; the other path\'s far end stays; one undo', () => {
  let oId = '';
  const s = rhombusScene((d, rid) => {
    const shared = P.getPath(d, rid)!.segments[0].to;                                                 // (120, 84)
    const o = P.startPath(d, { ...shared, cell: { ...shared.cell } }, { color: '#000', weight: 2 }, d.layers[0].id);
    P.appendNode(d, o.id, P.addPoint(d, { u: 200 / 240, v: 0.35 }));                                // → (200, 84)
    oId = o.id;
  });
  const before = structuredClone(doc.value);
  track(select, [{ x: 130, y: 38 }, { x: 130, y: 130 }], [ev(), ev()], ctx);
  const o = P.getPath(doc.value, oId)!;
  expect(o.start.pointId).toBe(P.getPath(doc.value, s.id)!.segments[0].to.pointId);
  expectAt(P.nodeWorld(doc.value, o.start), 84, 120);
  expectAt(P.nodeWorld(doc.value, o.segments[0].to), 200, 84);
  undo();
  expect(doc.value).toEqual(before);
});

test('E6a (review focus): the rotate zone wins over another path\'s line under it; the rotation leaves that path alone', () => {
  let lId = '';
  const s = rhombusScene((d) => { lId = line(d, [{ u: 100 / 240, v: 38 / 240 }, { u: 200 / 240, v: 38 / 240 }]).id; });   // y = 38, through (130, 38)
  UI.selection.value = null;
  expect(hit({ x: 130, y: 38 })).toMatchObject({ kind: 'segment', pathId: lId });
  UI.selection.value = { kind: 'path', id: s.id, copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 } };
  expect(hit({ x: 130, y: 38 })).toMatchObject({ kind: 'bboxrot', h: 1 });
  const lBefore = P.pathNodes(P.getPath(doc.value, lId)!).map((n) => P.nodeWorld(doc.value, n));
  track(select, [{ x: 130, y: 38 }, { x: 130, y: 130 }], [ev(), ev()], ctx);
  expectAt(s.at(0), 120, 84);
  P.pathNodes(P.getPath(doc.value, lId)!).forEach((n, i) => expectAt(P.nodeWorld(doc.value, n), lBefore[i].x, lBefore[i].y));
  expect(UI.selection.value).toMatchObject({ kind: 'path', id: s.id });
});
```

- [ ] **Step 6: Run them and expect failures**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/tools.test.ts`
Expected: FAIL — `src/interaction/cursor.ts` does not exist.

- [ ] **Step 7: Implement the rotate zone, the drag and the cursor**

`src/types.ts`, line 84 becomes:

```ts
  | { kind: 'bboxrot'; h: number }                                       // E6a: the rotate zone outside corner h (0–3)
```

and in the `bbox` drag (line 107) add `a0: number;` after `cy: number;`:

```ts
  | { kind: 'bbox'; mode: 'scale' | 'rot'; h: BoxHandle; box: Box; cx: number; cy: number; a0: number; pathId: string; copy: Copy; startDoc: Doc; M: Matrix | null; nodes: XY[]; targets: TargetSet; own: Set<string> }
```

`src/config.ts`, line 8 (`BBOX_ROT_OFFSET: 26,`) becomes:

```ts
  BBOX_ROT_ZONE_PX: 18,  // E6a: the rotate zone reaches this many screen px beyond a corner handle's hit radius, outside the box
  ROTATE_STEP_DEG: 15,   // E6a, §6.5: rotation steps while G is on (silent quantisation counts as grid)
```

`src/engine/hit.ts`, after `copyMatrixOf` (line 20), add:

```ts
// Spec §1: the original is the path as stored, in the tile: no clone and cell (0, 0). A repeat elsewhere is not.
export const isOriginal = (c: Copy): boolean => !c.bindingId && c.cell.c === 0 && c.cell.r === 0;
```

and replace the box block (lines 113–119) with:

```ts
  if (ctx.tool === 'select' && selPath && selM && sel && sel.kind === 'path') {
    const box = boundsWorld(doc, selPath, selM);
    const hs = bboxHandles(box);
    for (let i = 0; i < hs.length; i++) if (dist(w, hs[i]) <= rPoint) return { kind: 'bbox', h: i };
    // E6a: just outside a corner handle (outside the box, within BBOX_ROT_ZONE_PX beyond its hit radius) rotates, for the
    // original only. Like a box handle it beats whatever lies beneath.
    const inBox = w.x >= box.x0 && w.x <= box.x1 && w.y >= box.y0 && w.y <= box.y1;
    if (isOriginal(sel.copy) && !inBox) {
      let best = -1, bd = rPoint + (CONFIG.BBOX_ROT_ZONE_PX * s) / z;
      for (let i = 0; i < 4; i++) { const dd = dist(w, hs[i]); if (dd <= bd) { bd = dd; best = i; } }
      if (best >= 0) return { kind: 'bboxrot', h: best };
    }
  }
```

Create `src/interaction/cursor.ts`:

```ts
// The canvas cursor for the hovered target, the tool and the layer (moved out of Canvas.tsx so it can be tested).
// E6a: the rotate zone outside a box corner shows a rotate cursor, an inline SVG (CSS has no rotate cursor).
import * as UI from '../state/ui';
import type { HitTarget } from '../types';

const ROTATE_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>"
  + "<path d='M19 12a7 7 0 1 1-2.05-4.95' fill='none' stroke='white' stroke-width='4'/>"
  + "<path d='M19 12a7 7 0 1 1-2.05-4.95' fill='none' stroke='black' stroke-width='2'/>"
  + "<path d='M18 3v5h-5' fill='none' stroke='black' stroke-width='2'/></svg>";
export const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(ROTATE_SVG)}") 12 12, alias`;
const BBOX_CURSORS = ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize', 'ns-resize', 'ns-resize', 'ew-resize', 'ew-resize'];

export function cursorFor(h: HitTarget | null = UI.hover.value): string {
  if (UI.space.value && UI.pen.value) return 'grab';
  if (UI.layer.value === 'construction') return h ? (h.kind === 'elrot' || h.kind === 'eltip' ? 'grab' : 'move') : 'default';
  if (h && h.kind === 'bbox') return BBOX_CURSORS[h.h];
  if (h && h.kind === 'bboxrot') return ROTATE_CURSOR;
  if (h && h.kind === 'diamond') return 'grab';
  if (h && (h.kind === 'point' || h.kind === 'segment' || h.kind === 'canchor' || h.kind === 'fill')) return 'pointer';
  return UI.tool.value === 'select' || UI.tool.value === 'fill' ? 'default' : 'crosshair';
}
```

`src/interaction/tools/select.ts`:

Line 8 becomes:

```ts
import { pointsInRectAll, bboxHandles, boxScale, scaleMatrix, isOriginal } from '../../engine/hit';
```

Line 10 becomes:

```ts
import { apply, invert, compose, rotation, cellMatrix, isIdentity, rotationAngle, angleDeg } from '../../engine/transform';
```

Replace `startBBox` (lines 91–101) with:

```ts
function startBBox(t: Extract<HitTarget, { kind: 'bbox' | 'bboxrot' }>, w: XY, e: PointerEvent, hitScale: number): void {
  const s = UI.selection.value;
  if (!s || s.kind !== 'path') return;
  const path = P.getPath(doc.value, s.id);
  if (!path) return;
  if (t.kind === 'bboxrot' && !isOriginal(s.copy)) return;   // E6a: originals only
  const M = copyMatrix(s.copy), box = P.boundsWorld(doc.value, path, M);
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  startDrag(e, t, w, hitScale, { kind: 'bbox', mode: t.kind === 'bboxrot' ? 'rot' : 'scale', h: bboxHandles(box)[t.h], box, cx, cy, a0: Math.atan2(w.y - cy, w.x - cx),
    pathId: s.id, copy: s.copy, startDoc: doc.value, M: null, nodes: P.pathWorld(doc.value, path).map((q) => apply(M, q)),
    targets: snapTargets.value, own: new Set(P.pathNodes(path).map((n) => n.pointId)) });   // I5: the targets at the press; the path's own nodes move with it
}
```

(The `case 'bbox': case 'bboxrot': return startBBox(t, w, e, ctx.hitScale);` line in `onDown` stays; TypeScript narrows `t` to the two kinds there.)

Replace the `rot` branch of the `bbox` case (lines 205–208, `if (d.mode === 'rot') { … T = rotation(th, d.cx, d.cy); }`) with:

```ts
      if (d.mode === 'rot') {
        // E6a, H10: about the box centre, from the angle at the press; 15° steps while G is on (silent quantisation
        // counts as grid, §6.5, so ⌘ / Ctrl does not free it). The hint shows the angle at the grabbed corner.
        const th = rotationAngle(Math.atan2(w.y - d.cy, w.x - d.cx) - d.a0, ctx.gridOn ? CONFIG.ROTATE_STEP_DEG : 0);
        T = rotation(th, d.cx, d.cy);
        UI.snapHint.value = { at: apply(T, { x: d.h.x, y: d.h.y }), label: STR.snap.angle(angleDeg(th)) };
      }
```

(The endpoint-hint block after `d.M = T;` only runs when no hint is set, so it never runs while rotating.)

`src/components/Canvas.tsx`:
- line 6: remove `space` from the `../state/ui` import list;
- add after line 4: `import { cursorFor } from '../interaction/cursor';`
- replace lines 148–153 of `BBox` (from `if (bd) return <g>{polys}</g>;` through the closing `</g>;`) with:

```tsx
  if (bd) return <g>{polys}</g>;
  const s = 10 / z;   // E6a: no rotation knob; rotation is the zone just outside a corner (cursor.ts)
  return <g>{polys}
    {bboxHandles(box).map((hd, i) => <rect key={i} class={h && h.kind === 'bbox' && h.h === i ? 'handle hover' : 'handle'} x={hd.x - s / 2} y={hd.y - s / 2} width={s} height={s} />)}
  </g>;
```

- delete `cursorFor` and `bboxCursor` (lines 291–300); `Canvas()` keeps calling `cursorFor()`, now imported.

`src/strings.ts`, in the `snap` block (after `guide: 'guide',`) add:

```ts
    angle: (deg: number) => `${deg}°`,
```

and `hint.path` becomes:

```ts
    path: 'Path: click a line to insert a point · drag ◇ to bend · double-click ◇ to straighten · box handles scale (⇧ keeps proportions, ⌥ from the centre, ⌘ frees the size steps) · drag just outside a corner to rotate · any copy is editable · Layer chips move it · drag a node to pull it off a shared point',
```

- [ ] **Step 8: Run all tests and the type check, expect a pass**

Run: `npx vitest run --root ~/Developer/personal/tesselator` then `npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: all PASS; tsc prints nothing (a leftover `CONFIG.BBOX_ROT_OFFSET` reference would fail here).

- [ ] **Step 9: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/types.ts src/config.ts src/engine/transform.ts src/engine/hit.ts src/interaction/cursor.ts src/interaction/tools/select.ts src/components/Canvas.tsx src/strings.ts tests/unit/transform.test.ts tests/unit/tools.test.ts
git -C ~/Developer/personal/tesselator commit -m "E6a, H10: rotate from just outside a box corner, originals only, with an angle hint; no rotation knob" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: A marquee selects whole instances (S8)

Today a marquee always selects nodes (`onUp` marquee case in `select.ts`, lines 236–243, via `pointsInRectAll`). After this task: the instances (original, repeat or clone, among the visible ones) whose every node lies inside become the selection, one as a `path` selection, several as `paths`; with none whole it selects nodes as before; `⌥` held at release always selects nodes; `⇧` adds.

**Files:**
- Modify: `src/engine/hit.ts` (add `instancesInRect` after `pointsInRectAll`, line 232)
- Modify: `src/state/ui.ts` (add `selectedInstances` after `selectedPointIds`, line 48)
- Modify: `src/actions.ts` (add `selectInstances` after `toggleInstance`, line 322)
- Modify: `src/interaction/tools/select.ts` (imports lines 7–8; the marquee case of `onUp`)
- Modify: `src/strings.ts` (`hint.select`, line 42)
- Test: `tests/unit/tools.test.ts`

**Existing tests that change:** none. The four existing marquee tests (`tools.test.ts` "⇧-click trimming a marquee picked through a clone…" and "N1: a several-point drag…", `select.test.ts` "a marquee picks points through a mirror clone…" and "a grouped drag through a clone…") each hold only part of every instance, so they still select nodes; they must pass unchanged.

**Interfaces:**
- Produces (`src/engine/hit.ts`): `instancesInRect(doc: Doc, r: Box, copies: CopyInfo[]): { id: string; copy: Copy }[]` — in `copies` order.
- Produces (`src/state/ui.ts`): `selectedInstances(): { id: string; copy: Copy }[]` — `[]` unless the selection is `path` or `paths`.
- Produces (`src/actions.ts`): `selectInstances(items: { id: string; copy: Copy }[]): boolean` — duplicates dropped, order kept; 0 → null, 1 → `path`, more → `paths`.
- Consumes: `copies` (`src/state/derived.ts`).

- [ ] **Step 1: Write the failing tool tests**

Append to `tests/unit/tools.test.ts`:

```ts
// --- S8: a marquee selects the instances it wholly contains; else nodes; ⌥ at release always picks nodes

const base0 = { cell: { c: 0, r: 0 }, bindingId: null, power: 0 };
// A (24,24) → (72,24), B (24,72) → (72,96), C (150,24) → (216,24). Select tool, nothing selected.
function threePaths(more: (d: Doc) => void = () => {}) {
  const ids = { a: '', b: '', c: '' };
  fresh('freehand', (d) => {
    ids.a = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.3, v: 0.1 }]).id;
    ids.b = line(d, [{ u: 0.1, v: 0.3 }, { u: 0.3, v: 0.4 }]).id;
    ids.c = line(d, [{ u: 0.625, v: 0.1 }, { u: 0.9, v: 0.1 }]).id;
    more(d);
  });
  UI.tool.value = 'select'; UI.selection.value = null;
  return ids;
}
// A marquee drag through the Select tool, from empty space; returns the selection after the release.
function marquee(from: XY, to: XY, e = ev()) {
  expect(hit(from)).toBe(null);
  select.onDown(hit(from), from, e, ctx);
  const m = UI.drag.value!; m.moved = true;
  select.onMove(m, to, e, ctx);
  UI.drag.value = null; select.onUp(m, to, e, ctx);
  return UI.selection.value;
}

test('S8: a marquee around two whole paths selects both as paths; around one, that path', () => {
  const { a, b } = threePaths();
  expect(marquee({ x: 10, y: 10 }, { x: 90, y: 110 })).toEqual({ kind: 'paths', items: [{ id: a, copy: base0 }, { id: b, copy: base0 }] });
  expect(marquee({ x: 10, y: 10 }, { x: 90, y: 40 })).toEqual({ kind: 'path', id: a, copy: base0 });
});

test('S8: whole and partial instances together select only the whole ones; with no whole instance, nodes', () => {
  const { a, b } = threePaths();
  expect(marquee({ x: 10, y: 10 }, { x: 170, y: 40 })).toEqual({ kind: 'path', id: a, copy: base0 });   // C's start is inside, its end is not
  const s = marquee({ x: 40, y: 0 }, { x: 90, y: 110 });                                                  // only A's and B's ends; (40, 0) is clear of A's rotate zone
  const pa = P.getPath(doc.value, a)!, pb = P.getPath(doc.value, b)!;
  expect(s && s.kind === 'points' && [...s.ids].sort()).toEqual([pa.segments[0].to.pointId, pb.segments[0].to.pointId].sort());
});

test('S8: ⌥ held at release selects the nodes even around whole paths', () => {
  threePaths();
  const s = marquee({ x: 10, y: 10 }, { x: 90, y: 110 }, ev({ altKey: true }));
  expect(s?.kind).toBe('points');
  expect(s && s.kind === 'points' && s.ids.length).toBe(4);
});

test('S8: a ⇧-marquee adds whole instances to the instances already selected', () => {
  const { a, c } = threePaths();
  A.selectPathAt(c);
  expect(marquee({ x: 10, y: 10 }, { x: 90, y: 40 }, ev({ shiftKey: true }))).toEqual({ kind: 'paths', items: [{ id: c, copy: base0 }, { id: a, copy: base0 }] });
});

test('S8 (review focus): a path leaving the tile through its right edge is whole in a marquee around where it is drawn, in either tile', () => {
  let id = '', start = '';
  fresh('freehand', (d) => {
    const n = P.addPoint(d, { u: 0.9, v: 0.5 }); start = n.pointId;                                   // (216, 120)
    const p = P.startPath(d, n, { color: '#000', weight: 2 }, d.layers[0].id);
    P.appendNode(d, p.id, { ...P.addPoint(d, { u: 0.1, v: 0.5 }), cell: { c: 1, r: 0 } });            // (264, 120), in the next tile
    id = p.id;
  });
  UI.tool.value = 'select'; UI.selection.value = null;
  expect(marquee({ x: 200, y: 100 }, { x: 280, y: 140 })).toEqual({ kind: 'path', id, copy: base0 });
  expect(marquee({ x: -40, y: 100 }, { x: 40, y: 140 })).toEqual({ kind: 'path', id, copy: { cell: { c: -1, r: 0 }, bindingId: null, power: 0 } });   // its repeat, (−24,120) → (24,120)
  const s = marquee({ x: 196, y: 96 }, { x: 250, y: 140 });                                               // only the start is inside
  expect(s && s.kind === 'points' && s.ids).toEqual([start]);
});
```

- [ ] **Step 2: Run them and expect failures**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/tools.test.ts`
Expected: FAIL — every marquee returns a `points` selection.

- [ ] **Step 3: Implement**

`src/engine/hit.ts`, after `pointsInRectAll` (ends line 232), add:

```ts
// S8: the instances among `copies` (the visible ones) whose every node, where that instance draws it, lies inside the
// rectangle; in `copies` order. A node in another cell or seen through a via counts at its drawn position.
export function instancesInRect(doc: Doc, r: Box, copies: CopyInfo[]): { id: string; copy: Copy }[] {
  const inside = (q: XY) => q.x >= r.x0 && q.x <= r.x1 && q.y >= r.y0 && q.y <= r.y1;
  const out: { id: string; copy: Copy }[] = [];
  for (const ci of copies) {
    const p = getPath(doc, ci.pathId);
    if (p && pathWorld(doc, p).every((q) => inside(apply(ci.M, q)))) out.push({ id: p.id, copy: ci.copy });
  }
  return out;
}
```

`src/state/ui.ts`, after `selectedPointIds` (line 48), add:

```ts
export function selectedInstances(): { id: string; copy: Copy }[] { const s = selection.value; return s && s.kind === 'paths' ? s.items : s && s.kind === 'path' ? [{ id: s.id, copy: s.copy }] : []; }
```

`src/actions.ts`, after `toggleInstance` (ends line 322), add:

```ts
// S8: select whole instances. One is a plain path selection, several the 'paths' selection; duplicates are dropped, order kept.
export function selectInstances(items: { id: string; copy: Copy }[]): boolean {
  const u: { id: string; copy: Copy }[] = [];
  for (const it of items) if (!u.some((x) => x.id === it.id && sameCopy(x.copy, it.copy))) u.push({ id: it.id, copy: { ...it.copy, cell: { ...it.copy.cell } } });
  UI.selection.value = u.length === 0 ? null : u.length === 1 ? { kind: 'path', id: u[0].id, copy: u[0].copy } : { kind: 'paths', items: u };
  UI.pendingGroup.value = null;
  return true;
}
```

`src/interaction/tools/select.ts`:
- line 7 becomes `import { copyMatrix, snapTargets, copies } from '../../state/derived';`
- line 8 becomes `import { pointsInRectAll, bboxHandles, boxScale, scaleMatrix, isOriginal, instancesInRect } from '../../engine/hit';`
- replace the marquee case at the top of `onUp` (from `if (d.kind === 'marquee') {` through its closing `}`) with:

```ts
  if (d.kind === 'marquee') {
    if (!d.moved) return;
    const r = { x0: Math.min(d.start.x, d.cur.x), x1: Math.max(d.start.x, d.cur.x), y0: Math.min(d.start.y, d.cur.y), y1: Math.max(d.start.y, d.cur.y) };
    // S8: the instances wholly inside become the selection (one path, or several); ⌥ at the release always picks nodes.
    // With no whole instance, the nodes inside (S5). ⇧ adds to a selection of the same kind.
    const whole = e.altKey ? [] : instancesInRect(doc.value, r, copies.value);
    if (whole.length) { A.selectInstances([...(d.add ? UI.selectedInstances() : []), ...whole]); return; }
    const got = pointsInRectAll(doc.value, r), prev = UI.selection.value;
    const prevCopies = d.add && prev && prev.kind === 'points' ? prev.copies ?? {} : {};
    A.selectPoints([...(d.add ? UI.selectedPointIds() : []), ...got.ids], { ...prevCopies, ...got.copies });
    return;
  }
```

`src/strings.ts`, line 42 becomes:

```ts
    select: 'Select: click a point, line, copy or fill · drag a line to move the path · drag empty space to select the paths wholly inside (⌥ for their nodes)',
```

- [ ] **Step 4: Run all tests and the type check, expect a pass**

Run: `npx vitest run --root ~/Developer/personal/tesselator` then `npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: all PASS, including the four existing marquee tests; tsc prints nothing.

- [ ] **Step 5: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/engine/hit.ts src/state/ui.ts src/actions.ts src/interaction/tools/select.ts src/strings.ts tests/unit/tools.test.ts
git -C ~/Developer/personal/tesselator commit -m "S8: a marquee selects the instances it wholly contains; ⌥ at release picks nodes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Several selected instances show their nodes, with no box (S10)

Today a `paths` selection draws halos only (`Highlights` in `Canvas.tsx`), and no box (`BBox` and the box hit only handle `path`). After this task every node of every selected instance is drawn where that instance draws it: a raw instance's as points, a clone's as clone anchors (via nodes of a clone are left out, as for a single clone). The nodes are display only: pressing one presses that instance's line (E5b, Task 6). The no-box rule is pinned by a hit test.

**Files:**
- Modify: `src/state/derived.ts` (imports lines 4–6; add `multiNodeMarks` at the end)
- Modify: `src/components/Canvas.tsx` (import line 7; `Points`, after the S2 block ending line 211)
- Test: `tests/unit/tools.test.ts`

**Interfaces:**
- Produces (`src/state/derived.ts`): `type NodeMark = { at: XY; clone: boolean }`; `multiNodeMarks: ReadonlySignal<NodeMark[]>` — empty unless the selection is `paths`.
- Consumes: Task 4's `threePaths`, `marquee`, `base0` test helpers.

- [ ] **Step 1: Write the failing tool test**

In `tests/unit/tools.test.ts`, change the derived import (line 16) to:

```ts
import { copies, cloneMatrices, copyMatrix, multiNodeMarks } from '../../src/state/derived';
```

Append:

```ts
// --- S10: several selected instances show every node; no box, no rotate zone

test('S10: a marquee around a path and a clone of another shows every node of both instances; neither has a box', () => {
  let a = '', bBind = '';
  fresh('freehand', (d) => {
    a = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.3, v: 0.1 }]).id;                                        // (24,24) → (72,24)
    const el = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });                      // x = 120
    const b = line(d, [{ u: 0.75, v: 0.3 }, { u: 0.9, v: 0.4 }]); bBind = P.addBinding(d, b.id, [[el.id]]).id;   // (180,72) → (216,96); clone (60,72) → (24,96)
  });
  UI.tool.value = 'select'; UI.selection.value = null;
  const s = marquee({ x: 10, y: 10 }, { x: 90, y: 110 });
  expect(s && s.kind === 'paths' && s.items.map((x) => x.copy.bindingId)).toEqual([null, bBind]);
  const m = multiNodeMarks.value;
  expect(m.map((x) => x.clone)).toEqual([false, false, true, true]);
  expectAt(m[0].at, 24, 24); expectAt(m[1].at, 72, 24); expectAt(m[2].at, 60, 72); expectAt(m[3].at, 24, 96);
  expect(hit({ x: 24, y: 24 })?.kind).toBe('segment');                                                // no box handle on A's box corner
  expect(hit({ x: 82, y: 14 })).toBe(null);                                                            // no rotate zone either ...
  A.selectPathAt(a);
  expect(hit({ x: 82, y: 14 })).toMatchObject({ kind: 'bboxrot' });                                    // ... which A alone has
  expect(multiNodeMarks.value).toEqual([]);
});
```

- [ ] **Step 2: Run it and expect a failure**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/tools.test.ts`
Expected: FAIL — `multiNodeMarks` is not exported.

- [ ] **Step 3: Implement**

`src/state/derived.ts`:
- line 4 becomes `import { view, viewport, drag, selection } from './ui';`
- line 6 becomes `import { cellMatrix, compose, orbit, ownClones, apply } from '../engine/transform';`
- add after line 9: `import { getPath, pathNodes, pathWorld } from '../engine/paths';`
- line 10 becomes `import type { Matrix, Cell, Copy, CopyInfo, Doc, Face, XY } from '../types';`
- append at the end:

```ts
// S10: with several instances selected, every node of each, where that instance draws it. A clone instance's via nodes
// are left out, as CloneAnchors does for a single clone.
export type NodeMark = { at: XY; clone: boolean };
export const multiNodeMarks = computed<NodeMark[]>(() => {
  const s = selection.value, d = doc.value, out: NodeMark[] = [];
  if (!s || s.kind !== 'paths') return out;
  for (const it of s.items) {
    const p = getPath(d, it.id);
    if (!p) continue;
    const M = copyMatrix(it.copy, d), clone = !!it.copy.bindingId, W = pathWorld(d, p);
    pathNodes(p).forEach((n, i) => { if (!(clone && n.via)) out.push({ at: apply(M, W[i]), clone }); });
  }
  return out;
});
```

`src/components/Canvas.tsx`:
- line 7 becomes `import { cloneMatrices, visibleCells, copies, copyMatrix, faces, snapTargets, multiNodeMarks } from '../state/derived';`
- in `Points`, after the S2 block (ends line 211) and before `return`, add:

```tsx
  // S10: several selected instances show every node: a raw instance's as points, a clone's as clone anchors.
  if (layer.value === 'drawing' && sel && sel.kind === 'paths' && !showAll) multiNodeMarks.value.forEach((m, i) => {
    out.push(m.clone
      ? <rect key={`msel:${i}`} class="canchor sel" x={m.at.x - 5 / z} y={m.at.y - 5 / z} width={10 / z} height={10 / z} rx={2 / z} />
      : <circle key={`msel:${i}`} class="pt" cx={m.at.x} cy={m.at.y} r={CONFIG.HANDLE_PX / z} />);
  });
```

- [ ] **Step 4: Run all tests and the type check, expect a pass**

Run: `npx vitest run --root ~/Developer/personal/tesselator` then `npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: all PASS; tsc prints nothing.

- [ ] **Step 5: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/state/derived.ts src/components/Canvas.tsx tests/unit/tools.test.ts
git -C ~/Developer/personal/tesselator commit -m "S10: several selected instances show every node; no box" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Dragging any selected instance moves the whole selection (E5b)

Today a body drag moves only the pressed path (`onDown` `segment` case, `select.ts` lines 107–111; `onMove` `body` case, lines 169–184; `joinBody`, lines 57–64), whatever is selected. After this task, with a `paths` selection, pressing a selected instance and dragging moves every selected path: the grabbed one exactly as E5a, the others ("riders") by the grabbed instance's on-screen delta through their own instance's frame. A path moves once, through its **driving instance** (decided by the user 2026-10-05): a selected original or repeat if there is one, so the original follows the pointer and its clones follow their transforms; otherwise the grabbed instance if it is one of the path's, else its first selected clone, so that clone follows the pointer and the original moves by the matching transformed amount. When the grabbed instance is a clone whose original is also selected, the drag's frame (snapping and hint) is the original's. Snapping is measured at the grabbed instance only, with every rider excluded from the targets, and only the grabbed path joins. One undo. A click without a drag narrows to the clicked instance (already the `segment` branch of `onUp`, pinned here). Pressing an unselected path replaces the selection on the first move and drags it alone.

**Files:**
- Modify: `src/types.ts` (add `BodyRider`; `BodyTargets`, line 76; `body` drag, line 104)
- Modify: `src/engine/snap.ts` (`bodyTargets`, lines 346–358; `snapBodyDelta`, line 367)
- Modify: `src/interaction/tools/select.ts` (`joinBody`; new `ridersFor`; `onDown` `segment` case; `onMove` `body` case; the body line of `onUp`)
- Modify: `src/strings.ts` (`hint.instances` line 39, `bar.instancesDelete` line 193)
- Test: `tests/unit/tools.test.ts`

**Existing tests that change:** none. `snap.test.ts` calls `bodyTargets(d, set, pathId)` without riders; the default `also = []` keeps them as they are. All E5a tests in `tools.test.ts` and the body-drag tests in `select.test.ts` must pass unchanged (riders are empty without a `paths` selection).

**Interfaces:**
- Produces (`src/types.ts`): `type BodyRider = { pathId: string; ids: string[]; startPos: Record<string, UV>; Li: Matrix }`; `BodyTargets` gains `excludePaths: ReadonlySet<string>`; the `body` drag gains `riders: BodyRider[]; replace: boolean`.
- Produces (`src/engine/snap.ts`): `bodyTargets(doc: Doc, set: TargetSet, pathId: string, G: Matrix = [1, 0, 0, 1, 0, 0], also: readonly string[] = []): BodyTargets | null`.
- Consumes: `A.selectPathAt`, Task 4's `threePaths`, `marquee`, `base0`, Task 2's `expectAt`.

- [ ] **Step 1: Write the failing tool tests**

Append to `tests/unit/tools.test.ts`:

```ts
// --- E5b: dragging any selected instance moves the whole selection

const startOf = (id: string) => P.nodeWorld(doc.value, P.getPath(doc.value, id)!.start);

test('E5b: with two paths selected, dragging one moves both by the same delta; the third stays; one undo puts them back', () => {
  const { a, b, c } = threePaths();
  marquee({ x: 10, y: 10 }, { x: 90, y: 110 });
  const before = structuredClone(doc.value);
  expect(hit({ x: 48, y: 24 })).toMatchObject({ kind: 'segment', pathId: a });
  gesture(select, [{ x: 48, y: 24 }, { x: 63, y: 34 }, { x: 78, y: 44 }], ev(), noGrid);
  expectAt(startOf(a), 54, 44); expectAt(startOf(b), 54, 92); expectAt(startOf(c), 150, 24);
  expect(UI.selection.value?.kind).toBe('paths');
  undo();
  expect(doc.value).toEqual(before);
});

test('E5b: the snap is measured at the grabbed instance and only the grabbed path joins; the other moves by the same delta', () => {
  let dId = '', fId = '';
  const { a, b } = threePaths((d) => {
    dId = line(d, [{ u: 103 / 240, v: 45 / 240 }, { u: 103 / 240, v: 10 / 240 }]).id;              // a node at (103, 45)
    fId = line(d, [{ u: 104 / 240, v: 118 / 240 }, { u: 150 / 240, v: 118 / 240 }]).id;            // a node at (104, 118)
  });
  marquee({ x: 10, y: 10 }, { x: 90, y: 110 });
  gesture(select, [{ x: 48, y: 24 }, { x: 63, y: 34 }, { x: 78, y: 44 }], ev(), noGrid);           // A's end comes to (102, 44), 1.4 px from D's node
  const pa = P.getPath(doc.value, a)!, pb = P.getPath(doc.value, b)!;
  expect(pa.segments[0].to.pointId).toBe(P.getPath(doc.value, dId)!.start.pointId);                 // A joined D
  expectAt(P.nodeWorld(doc.value, pb.segments[0].to), 103, 117);                                   // B moved by A's snapped delta (31, 21) ...
  expect(pb.segments[0].to.pointId).not.toBe(P.getPath(doc.value, fId)!.start.pointId);            // ... and joined nothing, 1.4 px from F's node
});

test('E5b (review focus): original and mirror clone selected; grabbing the clone moves the original by the pointer delta, once', () => {
  let id = '';
  fresh('freehand', (d) => {
    const el = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });                    // x = 120
    id = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.3, v: 0.1 }]).id; P.addBinding(d, id, [[el.id]]);       // (24,24) → (72,24); clone (216,24) → (168,24)
  });
  UI.tool.value = 'select'; UI.selection.value = null;
  const s = marquee({ x: 10, y: 10 }, { x: 230, y: 40 });
  expect(s && s.kind === 'paths' && s.items.map((x) => [x.id, !!x.copy.bindingId])).toEqual([[id, false], [id, true]]);
  const t = hit({ x: 192, y: 24 });
  expect(t?.kind === 'segment' && t.copy.bindingId).toBeTruthy();
  gesture(select, [{ x: 192, y: 24 }, { x: 180, y: 24 }, { x: 168, y: 24 }], ev(), noGrid);         // the clone 24 px left
  const p = P.getPath(doc.value, id)!;
  expectAt(P.nodeWorld(doc.value, p.start), 0, 24); expectAt(P.nodeWorld(doc.value, p.segments[0].to), 48, 24);   // the original 24 px left (the pointer's delta), once; its clone follows the mirror
});

test('E5b (review focus): only a clone of a rider selected; the clone follows the pointer and the original moves the mirrored way', () => {
  let x = '', y = '';
  fresh('freehand', (d) => {
    const el = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });                    // x = 120
    x = line(d, [{ u: 0.1, v: 0.1 }, { u: 0.3, v: 0.1 }]).id; P.addBinding(d, x, [[el.id]]);         // (24,24) → (72,24); clone (216,24) → (168,24)
    y = line(d, [{ u: 0.1, v: 0.3 }, { u: 0.3, v: 0.3 }]).id;                                        // (24,72) → (72,72), no clones
  });
  UI.tool.value = 'select';
  const tc = hit({ x: 192, y: 24 });
  expect(tc?.kind === 'segment' && tc.copy.bindingId).toBeTruthy();
  UI.selection.value = { kind: 'paths', items: [{ id: x, copy: tc!.kind === 'segment' ? tc!.copy : base0 }, { id: y, copy: base0 }] };
  expect(hit({ x: 48, y: 72 })).toMatchObject({ kind: 'segment', pathId: y });
  gesture(select, [{ x: 48, y: 72 }, { x: 60, y: 72 }, { x: 72, y: 72 }], ev(), noGrid);           // Y 24 px right
  expectAt(startOf(y), 48, 72);
  const p = P.getPath(doc.value, x)!;
  expectAt(P.nodeWorld(doc.value, p.start), 0, 24); expectAt(P.nodeWorld(doc.value, p.segments[0].to), 48, 24);   // X's original 24 px left, so its selected clone moved 24 px right with the pointer
});

test('E5b: a click on a selected instance without a drag selects just that instance', () => {
  const { b } = threePaths();
  marquee({ x: 10, y: 10 }, { x: 90, y: 110 });
  const t = hit({ x: 48, y: 84 });
  expect(t).toMatchObject({ kind: 'segment', pathId: b });
  select.onDown(t, { x: 48, y: 84 }, ev(), ctx);
  const d = UI.drag.value!; UI.drag.value = null; select.onUp(d, { x: 48, y: 84 }, ev(), ctx);
  expect(UI.selection.value).toEqual({ kind: 'path', id: b, copy: base0 });
});

test('E5b: pressing an unselected path replaces the selection and drags that path alone', () => {
  const { a, b, c } = threePaths();
  marquee({ x: 10, y: 10 }, { x: 90, y: 110 });
  gesture(select, [{ x: 183, y: 24 }, { x: 183, y: 39 }, { x: 183, y: 54 }], ev(), noGrid);
  expect(UI.selection.value).toEqual({ kind: 'path', id: c, copy: base0 });
  expectAt(startOf(c), 150, 54); expectAt(startOf(a), 24, 24); expectAt(startOf(b), 24, 72);
});
```

- [ ] **Step 2: Run them and expect failures**

Run: `npx vitest run --root ~/Developer/personal/tesselator tests/unit/tools.test.ts`
Expected: FAIL — B does not move with A; the selection stays `paths` after dragging C. (The click-narrows test already passes; it pins existing behaviour.)

- [ ] **Step 3: Implement the types and the snap plumbing**

`src/types.ts`:
- line 76 becomes:

```ts
export type BodyTargets = { pathId: string; moving: { index: number; p: XY }[]; own: { K: Matrix; p: XY; index: number; neutral?: boolean }[]; exclude: ReadonlySet<string>; excludePaths: ReadonlySet<string>; set: TargetSet };
// E5b: another selected path moving with a body drag. Li maps the grabbed instance's on-screen delta to its original's.
export type BodyRider = { pathId: string; ids: string[]; startPos: Record<string, UV>; Li: Matrix };
```

- the `body` drag (line 104) becomes:

```ts
  | { kind: 'body'; pathId: string; copy: Copy; ids: string[]; startPos: Record<string, UV>; frame: { G: Matrix; cell: Cell }; targets: BodyTargets | null; snap: BodySnap | null; riders: BodyRider[]; replace: boolean }
```

`src/engine/snap.ts`:
- `bodyTargets` signature (line 346) becomes:

```ts
export function bodyTargets(doc: Doc, set: TargetSet, pathId: string, G: Matrix = [1, 0, 0, 1, 0, 0], also: readonly string[] = []): BodyTargets | null {
```

- its `return` (line 357) becomes:

```ts
  // E5b: paths moving with this one (`also`) are not targets either: their nodes and lines are where they were.
  const alsoPts = also.flatMap((id) => { const q = getPath(doc, id); return q ? pathNodes(q).map((n) => n.pointId) : []; });
  return { pathId, moving, own, exclude: new Set([...nodes.map((n) => n.pointId), ...alsoPts]), excludePaths: new Set([pathId, ...also]), set };
```

- in `snapBodyDelta`, line 367 (`const exPaths = new Set([T.pathId]);`) becomes:

```ts
  const exPaths = T.excludePaths;
```

- [ ] **Step 4: Implement riders in the Select tool**

In `src/interaction/tools/select.ts`:

Add `BodyRider` to the type import (line 15):

```ts
import type { HitTarget, XY, Drag, Copy, Cell, Matrix, TargetSet, SnapResult, Node, SnapCat, BodySnap, BodyRider } from '../../types';
```

Replace `joinBody` (lines 57–64) with:

```ts
// §6.4 for a body drag: the snap was measured at the grabbed copy G, but the join happens in the original's frame, so a
// node or line target joins what lies at its pre-image G⁻¹(at), as joinThrough does; otherwise location only. `ids` and
// `also` (E5b riders' points and paths) moved with it, so they are never join targets.
function joinBody(pathId: string, G: Matrix, s: BodySnap, ids: string[], also: string[] = []): void {
  if (s.res.hit.kind !== 'node' && s.res.hit.kind !== 'curve') return;
  if (isIdentity(G)) { A.joinDroppedNode(pathId, s.nodeIndex, s.res.hit); return; }
  const src = apply(invert(G), s.res.at), d = doc.value, path = P.getPath(d, pathId);
  if (!path) return;
  const r = pickSnap(snapTargets.value, src, 1e-6 * (1 + Math.hypot(src.x, src.y)), { excludePoints: new Set(ids), excludePaths: new Set([pathId, ...also]), cats: JOINABLE, prefer: A.joinsOn(d, path.layerId) });
  if (r && (r.hit.kind === 'node' || r.hit.kind === 'curve')) A.joinDroppedNode(pathId, s.nodeIndex, r.hit);
}

// E5b: the instance whose frame moves a path (decided 2026-10-05): a selected original or repeat if there is one, so the
// original follows the pointer; otherwise the grabbed instance if it is this path's, else the path's first selected clone.
function drivingCopy(items: { id: string; copy: Copy }[], pathId: string, grabbed: Copy | null): Copy | null {
  const mine = items.filter((x) => x.id === pathId).map((x) => x.copy);
  return mine.find((c) => !c.bindingId) ?? (grabbed && mine.some((c) => sameCopy(c, grabbed)) ? grabbed : mine[0] ?? null);
}

// E5b: the other selected paths that ride along a body drag, each once, through its driving instance (the grabbed path
// itself moves with the grab). Each follows the grabbed path's on-screen delta through its driving instance's frame
// (E5a), so its original moves by Li (the inverse of that instance's linear part). A point already moved by the grabbed
// path or an earlier rider is not moved twice.
function ridersFor(items: { id: string; copy: Copy }[], grabbedId: string, claimed: Set<string>): BodyRider[] {
  const out: BodyRider[] = [], seen = new Set([grabbedId]);
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    const p = P.getPath(doc.value, it.id);
    if (!p) continue;
    const ids = [...new Set(P.pathNodes(p).map((n) => n.pointId))].filter((id) => !claimed.has(id));
    for (const id of ids) claimed.add(id);
    const M = copyMatrix(drivingCopy(items, it.id, null) ?? it.copy);
    out.push({ pathId: it.id, ids, startPos: P.snapshotPositions(doc.value, ids), Li: invert([M[0], M[1], M[2], M[3], 0, 0]) });
  }
  return out;
}
```

Replace the `segment` case of `onDown` (lines 107–111) with:

```ts
    case 'segment': {
      const path = P.getPath(doc.value, t.pathId); if (!path) return;
      const ids = [...new Set(P.pathNodes(path).map((n) => n.pointId))];
      // E5b: pressing a selected instance of a several-path selection drags them all; pressing any other path replaces
      // the selection (on the first move, so a click still goes through onUp) and drags it alone.
      const s = UI.selection.value, multi = s && s.kind === 'paths' ? s.items : null;
      const inSel = !!multi && multi.some((x) => x.id === t.pathId && sameCopy(x.copy, t.copy));
      const riders = multi && inSel ? ridersFor(multi, t.pathId, new Set(ids)) : [];
      const drive = (multi && inSel ? drivingCopy(multi, t.pathId, t.copy) : null) ?? t.copy;   // a selected original drives its clone's grab
      return startDrag(e, t, w, ctx.hitScale, { kind: 'body', pathId: t.pathId, copy: t.copy, ids, startPos: P.snapshotPositions(doc.value, ids), frame: bodyFrame(t.pathId, drive), targets: null, snap: null, riders, replace: !!multi && !inSel });
    }
```

Replace the `body` case of `onMove` (lines 169–184) with:

```ts
    case 'body': {
      if (!d.moved) return;
      if (d.replace) { d.replace = false; A.selectPathAt(d.pathId, d.copy); }   // E5b: an unselected path replaces the selection
      // E5a: a body drag on any copy moves the original so the grabbed copy follows the pointer; elements never move.
      // The snap is measured at the grabbed copy, placed near the base cell by G (bodyFrame), and the world delta maps
      // back to the source through G's linear part. The hint is shown at the grabbed copy itself, its cell added back.
      const { G, cell } = d.frame, Gl = invert([G[0], G[1], G[2], G[3], 0, 0]);
      if (!d.targets) d.targets = bodyTargets(doc.value, snapTargets.value, d.pathId, G, d.riders.map((r) => r.pathId));
      const raw = { x: w.x - d.start.x, y: w.y - d.start.y };
      const sn = ctx.targetsOn && d.targets ? snapBodyDelta(d.targets, raw, ctx.threshold, UI.snapSticky.value) : null;
      d.snap = sn; UI.snapSticky.value = sn?.res.id ?? null;
      const dv = sn ? A.uvOf(apply(Gl, sn.delta)) : A.snapDeltaUV(apply(Gl, raw), ctx.gridOn);
      const D = apply([G[0], G[1], G[2], G[3], 0, 0], A.worldOf(dv));   // E5b: the grabbed instance's on-screen delta, which every rider follows
      const off = A.worldOf({ u: cell.c, v: cell.r }), sh = (p: XY): XY => ({ x: p.x + off.x, y: p.y + off.y });
      UI.snapHint.value = sn ? { at: sh(sn.res.at), label: sn.res.label, line: sn.res.line?.map(sh) } : null;
      A.mutate((dd) => {
        P.movePointsBy(dd, d.ids, d.startPos, dv.u, dv.v);
        for (const r of d.riders) { const rv = A.uvOf(apply(r.Li, D)); P.movePointsBy(dd, r.ids, r.startPos, rv.u, rv.v); }
      });
      return;
    }
```

In `onUp`, the body line (currently `if (d.kind === 'body' && d.moved && d.snap) { joinBody(d.pathId, d.frame.G, d.snap, d.ids); return; }`) becomes:

```ts
  if (d.kind === 'body' && d.moved && d.snap) { joinBody(d.pathId, d.frame.G, d.snap, [...d.ids, ...d.riders.flatMap((r) => r.ids)], d.riders.map((r) => r.pathId)); return; }   // E5b: only the grabbed path joins
```

`src/strings.ts`:
- line 39 becomes:

```ts
    instances: (n: number) => `${n} instances · drag one to move them all · click one to select just it · ⌫ deletes their paths`,
```

- line 193 becomes:

```ts
    instancesDelete: (n: number) => `${n} instances · drag one to move them all · Delete removes their paths`,
```

- [ ] **Step 5: Run all tests and the type check, expect a pass**

Run: `npx vitest run --root ~/Developer/personal/tesselator` then `npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: all PASS, including every existing E5a and body-drag test; tsc prints nothing.

- [ ] **Step 6: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/types.ts src/engine/snap.ts src/interaction/tools/select.ts src/strings.ts tests/unit/tools.test.ts
git -C ~/Developer/personal/tesselator commit -m "E5b: dragging any selected instance moves the whole selection; snap and join at the grabbed one" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Help sheet, CLAUDE.md and spec status

**Files:**
- Modify: `src/strings.ts` (`help.selectIntro` line 73, `help.selectShift` line 74, `help.clone` line 75, `hint.clone` line 40; new help keys)
- Modify: `src/components/Chrome.tsx` (`Help`, line 241)
- Modify: `~/Developer/personal/tesselator/CLAUDE.md`
- Modify: `~/Developer/personal/tesselator/docs/superpowers/specs/2026-09-30-interaction-spec.md`

**Interfaces:**
- Produces: `STR.help.selectAlt`, `STR.help.boxIntro`, `STR.help.boxShift`, `STR.help.boxAlt`, `STR.help.boxCmd`.

- [ ] **Step 1: Update the help strings**

In `src/strings.ts`, the `help` block's `selectIntro`, `selectShift` and `clone` (lines 73–75) become, with four new keys after `selectShift`:

```ts
    selectIntro: 'Select: click any copy of a line to select its path there, again to insert a point · drag ◇ to bend, double-click to straighten · drag empty space to select the paths wholly inside · ',
    selectShift: ' adds · ',
    selectAlt: ' at the release selects their nodes instead · with several paths selected, drag any one to move them all · drop a point on a point to merge them',
    boxIntro: 'Box: handles scale, snapping to quarters, thirds and halves of the tile · ',
    boxShift: ' keeps proportions · ',
    boxAlt: ' scales from the centre · drag just outside a corner of an original to rotate (15° steps while G is on) · ',
    boxCmd: ' scales freely',
    clone: 'Clone: drag its body to move the original so the clone follows (the elements stay put) · drag its anchors to edit the shared point',
```

and `hint.clone` (line 40) becomes (the old text described moving the element, which E5a replaced):

```ts
    clone: 'Clone: drag its body to move the original so this clone follows · drag its anchors to edit the shared shape · drag an anchor on a shared point to pull it off · box handles scale it',
```

In `src/components/Chrome.tsx`, line 241 becomes two lines:

```tsx
    <span>{STR.help.selectIntro}<K k="⇧" />{STR.help.selectShift}<K k="⌥" />{STR.help.selectAlt}</span>
    <span>{STR.help.boxIntro}<K k="⇧" />{STR.help.boxShift}<K k="⌥" />{STR.help.boxAlt}<K k="⌘" />{STR.help.boxCmd}</span>
```

`onKeyDown` in `pointer.ts` gains no keys in this plan (the new behaviour is pointer modifiers), so nothing else in the sheet changes.

- [ ] **Step 2: Update CLAUDE.md**

In `~/Developer/personal/tesselator/CLAUDE.md`:

- **Shortcuts**: replace `` · `⌥` while drawing traces a line · `` with:

```
 · `⌥` while drawing traces a line · `⌥` at a marquee's release picks nodes instead of whole paths · `⇧` / `⌥` while box-scaling keep proportions / scale from the centre (`⌘`/`Ctrl` frees the size fractions) · drag just outside a box corner of an original to rotate (15° steps while `G` is on) · 
```

- **Model**, end of the **Copies.** paragraph, append:

```
 With several instances selected (`Selection` `paths`, from `⇧`-click or a marquee that wholly contains them, S8), every node of each is shown (`multiNodeMarks`, display only) and dragging any selected instance moves every selected path once: the grabbed one as above, the others as riders by the grabbed instance's on-screen delta through their own instance's frame (`ridersFor` in `select.ts`); snapping is measured at the grabbed instance, riders are not targets, and only the grabbed path joins.
```

- **Architecture**, after the `src/engine/joins.ts` bullet, add:

```
- Size fractions (T13): `nearestFraction` / `fractionWithin` in `src/engine/lattice.ts` give the nearest k/n (n ≤ `CONFIG.FRACTION_MAX_N`); box scale (`snapScale` in `snap.ts`, on the drawn box) and the translation tip drag (`construct.ts`) snap to them silently within the snap threshold, ignore `G`, and are freed by `⌘`/`Ctrl`. Box maths is pure in `src/engine/hit.ts`: `boxScale` (`⇧` proportional, `⌥` from the centre), `isOriginal`, the rotate zone (`bboxrot`, outside the box within `BBOX_ROT_ZONE_PX` of a corner, originals only) and `instancesInRect` (S8). `src/interaction/cursor.ts` holds the canvas cursor, including the inline-SVG rotate cursor.
```

- **Known limitations**, add:

```
- Box scale and rotation act on one selected path; several selected paths only move together (spec roadmap 14). Rotation is about the box centre only.
- Toggling `⇧` or `⌥` during a box scale applies from the next pointer move.
- Touch has stand-ins for `⇧` (Proportional while scaling, Add while marquee-selecting) but none for `⌥` (scale from the centre, marquee nodes).
- Size fractions read the tile's width as `|a.x|` or `|b.x|` and its height as `|a.y|` or `|b.y|`; on a skewed lattice that is the lattice vectors' spans, not the tile's bounding box.
- With several paths selected their nodes are shown but not draggable; click one instance to edit its nodes.
- The side handles of a zero-width (or zero-height) box sit on the path's midpoint, over its diamond, and scale nothing.
```

- [ ] **Step 3: Update the spec's status columns**

In `~/Developer/personal/tesselator/docs/superpowers/specs/2026-09-30-interaction-spec.md` make these exact replacements (each old string is unique in the file):

| Old | New |
| --- | --- |
| `The snapping-and-drawing plan and the 2026-10-01 feedback round are built; the rest is ready for planning.` | `The snapping-and-drawing plan, the 2026-10-01 feedback round and the marquee-and-transforms plan (S8, S10, E5b, E6, E6a, E6b, T13, H10) are built; the rest is ready for planning.` |
| `\| single selected instance \| no \| yes \| — \| built; T13, modifiers and rotation new \|` | `\| single selected instance \| no \| yes \| — \| built \|` |
| `by click, `⇧`-click (S4) or marquee (S8) \| built; marquee new \|` | `by click, `⇧`-click (S4) or marquee (S8) \| built \|` |
| `\| release; `Esc` cancels and restores \| built; several paths new (E5b) \|` | `\| release; `Esc` cancels and restores \| built \|` |
| `Silent (§6.5). \| value \| change 2026-10-02 (was: hinted scale fractions) \|` | `Silent (§6.5). \| value \| built (was: hinted scale fractions) \|` |
| `moves through that clone's inverse. \| built (S8 changes what a marquee selects) \|` | `moves through that clone's inverse. \| built; S8 decides between nodes and whole instances \|` |
| `Holding `⌥` while releasing the marquee always selects nodes. \| new \|` | `Holding `⌥` while releasing the marquee always selects nodes. \| built \|` |
| `scaling and rotating several paths at once is on the roadmap. \| new \|` | `scaling and rotating several paths at once is on the roadmap. \| built \|` |
| `Pressing an unselected path replaces the selection and drags it alone. \| new \|` | `Pressing an unselected path replaces the selection and drags it alone. \| built \|` |
| `` `⇧` keeps proportions, `⌥` scales from the centre (§6.5). \| built; T13 and modifiers new \| `` | `` `⇧` keeps proportions, `⌥` scales from the centre (§6.5). \| built \| `` |
| `Angle steps follow §6.5. No separate rotation handle. \| new \|` | `Angle steps follow §6.5. No separate rotation handle. \| built \|` |
| ``snaps its u and v components silently to size fractions (T13); `⌘` / `Ctrl` frees it. \| new 2026-10-02 (was: twelfths, following `G`) \|`` | ``snaps its u and v components silently to size fractions (T13); `⌘` / `Ctrl` frees it. \| built (was: twelfths, following `G`) \|`` |
| `scaling with size fractions shows no hint (§6.5). \| new \|` | `scaling with size fractions shows no hint (§6.5). \| built \|` |

(In the table above `\|` stands for a literal `|` in the spec row.)

- [ ] **Step 4: Run all tests and the type check, expect a pass**

Run: `npx vitest run --root ~/Developer/personal/tesselator` then `npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: all PASS; tsc prints nothing.

- [ ] **Step 5: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/strings.ts src/components/Chrome.tsx CLAUDE.md docs/superpowers/specs/2026-09-30-interaction-spec.md
git -C ~/Developer/personal/tesselator commit -m "Docs: help sheet, CLAUDE.md and spec status for marquee and transforms" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Decisions this plan makes where the spec is silent

1. **The tile's width and height for T13** are the lattice vectors' x spans (`|a.x|`, `|b.x|`) and y spans (`|a.y|`, `|b.y|`), as the old `snapScale` read them; k is any positive integer, so widths beyond one tile (5/4, 4/3, …) snap too.
2. **Silent snapping uses the snap threshold.** A size fraction is taken only when the handle (or the translation tip, per component) is within `ctx.threshold` of it; otherwise the value is free. E6b used to quantise to twelfths always.
3. **The box is the drawn box** (nodes and control points, `boundsWorld`), not the node extents the old `snapScale` used, so "a third of the tile wide" matches what the user sees.
4. **`⇧` on an edge handle** applies its factor to both axes, about the box's centre line on the other axis (the edge handle's own anchor).
5. **The touch "Free" toggle becomes "Proportional"**, because `⇧` now means "keep proportions".
6. **The rotate zone** is outside the box and within `BBOX_ROT_ZONE_PX` (18 screen px, doubled for touch) beyond a corner handle's hit radius; the nearest corner wins. Like a box handle it beats another path's line beneath it, and a click there without a drag does nothing.
7. **The rotation angle** is measured from the press point; the hint ring sits at the turned corner, reads clockwise-positive degrees to 0.1°, normalised to (−180°, 180°].
8. **Scaling a repeat or clone still works**; only rotation is limited to the original. Rotation and scale keep shared points shared (the other path's node follows), as body drags do.
9. **S8 `⇧`-marquee** adds whole instances to an instance selection; over a node selection the instances replace it. Nodes are still added only to a node selection.
10. **"Visible instance" for S8** means the instances in the visible cells (`copies`), as drawn; S5's node marquee keeps its 3×3 window.
11. **S10 nodes are display only.** Pressing one presses that instance's line (E5b); to edit a node, click the instance first (S9 precedent).
12. **E5b "pressing an unselected path replaces the selection"** applies when a several-path selection is active, and happens on the first move; a single-path selection keeps today's behaviour.
13. **Repeats count as originals for E5b's driving instance** (they share the original's orientation), so a selected repeat also makes the original follow the pointer.
14. **Shared points between selected paths** move once, with the first path that claims them (the grabbed path first). The other selected paths are excluded from the grabbed instance's targets and from its join.

## Self-Review

**Spec coverage.**
- S8: Task 4 covers whole → `path`, several → `paths`, mixed → whole only, none → nodes, `⌥` → nodes, `⇧` adds, and a path spanning cells.
- S10: Task 5 covers the nodes of each selected instance (raw and clone) and no box or rotate zone.
- E5b, Task 6:
  - each original moves through its instance's frame: the riders' `Li`, and the clone test;
  - a path selected through several instances moves once: the clone and original test;
  - snapping at the grabbed instance only, and only it joins: the D and F test;
  - one undo;
  - a click narrows;
  - an unselected press replaces.
- E6 and §6.5, Task 2:
  - `⇧`, the Proportional toggle, `⌥`, and `⇧⌥`;
  - T13 silent, ignoring `G`, freed by `⌘`;
  - no hint for the fractions (H10), while the endpoint hints stay;
  - the old "⇧ = free" and hinted fractions are removed.
- E6a and H10, Task 3:
  - rotate cursor outside a corner, originals only (a repeat at cell {1,0} and a clone show none);
  - rotation about the centre;
  - 15° steps following `G` and not freed by `⌘`;
  - angle hint;
  - the knob is removed.
- E6b: Task 1 covers k/n, n ≤ 4, `⌘` frees, `G` ignored, twelfths removed.

**Placeholder scan.** Every step names exact files, current line ranges and full replacement code; every test is written out in full. There is no "similar to" and no TBD.

**Type consistency.**
- Producers and consumers agree on these signatures:
  - `boxScale(box, h, p, mods)` → `{ sx, sy, ax, ay }`, used in `select.ts`;
  - `snapScale(box, lat, h, a, raw, proportional, threshold, maxN)`, used in `select.ts` and `snap.test.ts`;
  - `nearestFraction` / `fractionWithin`, used in `snap.ts` and `construct.ts`;
  - `rotationAngle` / `angleDeg`, used in `select.ts`;
  - `isOriginal`, used in `hit.ts` and `select.ts`;
  - `HitTarget` `bboxrot` with `h`, produced in `hit.ts` and read in `startBBox` and `cursor.ts`;
  - the `bbox` drag's `a0`, set in `startBBox` and read in the `rot` branch;
  - `instancesInRect(doc, r, copies)`;
  - `selectInstances(items)` and `selectedInstances()`;
  - `multiNodeMarks`;
  - `BodyRider` and `BodyTargets.excludePaths`;
  - `bodyTargets(…, G, also)`;
  - the `body` drag's `riders` and `replace`, set in `onDown` and read in `onMove` and `onUp`.
- The renames are applied everywhere they appear:
  - `UI.keepProportions` and `A.toggleKeepProportions` in `ui.ts`, `actions.ts`, `Chrome.tsx` and the tests;
  - `STR.titles.keepProportions` and `STR.bar.keepProportions`.
- The removals have no references left, which tsc checks at Tasks 2 and 3: `scaleFor`, `SCALE_FRACTIONS`, `STR.snap.scale`, `BBOX_ROT_OFFSET`, `freeScale`, and `cursorFor` / `bboxCursor` in `Canvas.tsx`. The untracked playground imports only `transform` and `lattice` functions that stay.

**Test helpers.**
- Tasks 2–6 append to `tests/unit/tools.test.ts` and reuse its `fresh`, `line`, `hit`, `ev`, `ctx`, `noGrid`, `free`, `gesture` and `undo`.
- New helpers are defined once, before first use:
  - `withCmd`, `expectAt`, `track` and `rhombusScene` in Task 2;
  - `base0`, `threePaths` and `marquee` in Task 4;
  - `startOf` in Task 6.

**Review Focus.**
1. `⇧`/`⌥` mid-drag: Task 2.
2. Shared-point rotation: Task 3.
3. Rotate zone over another line: Task 3.
4. Marquee spanning cells: Task 4.
5. Clone and original in E5b: Task 6.

Also pinned: `Esc` mid-rotate (Task 3) and the zero-width box (Task 2).

**Geometry checks.** The test coordinates were worked through against the 240 px square lattice at zoom 1 (threshold 12, point radius 8, segment half-width 7):
- every expected hit kind;
- no unintended snap within 18 px (the sticky reach) of the moving ends in the E5b and scale tests;
- the existing marquee tests each hold only part of every instance, so they keep selecting nodes.
