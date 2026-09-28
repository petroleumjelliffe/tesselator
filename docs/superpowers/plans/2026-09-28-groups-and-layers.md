# Groups and Layers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bindings become ordered lists of element groups whose clones are the product of the groups; the fixed structure/fills/detail sandwich becomes generic ordered layers; the document moves to version 2 with automatic v1 migration.

**Architecture:** `orbit()` gains a group product with a stable mixed-radix clone index and null slots for deduplicated clones; every clone consumer skips nulls. The document gets `layers`, `layerId` on paths and fills, `groups` on bindings and `newPathGroups`. `parseDoc` accepts v1 and v2 and migrates v1 (one group per old chain; three layers Structure / Fills / Detail). Rendering and export emit one `<g id="cell-layer-<id>">` per layer, fills first then strokes. The chrome shows group clusters with `+ then`, a layer picker with `+ layer`, and "Layer:" move chips.

**Tech Stack:** Preact + `@preact/signals`, TypeScript strict, Vite, Vitest. No Playwright in this plan (user decision); verification is `npx tsc --noEmit` and `npm test`.

**Spec:** `docs/superpowers/specs/2026-09-28-groups-and-layers-amendment.md` (binding; where it disagrees with `docs/superpowers/specs/2026-09-27-engine-rebuild-design.md`, the amendment wins).

## Global Constraints

- Runtime dependencies stay exactly `preact` and `@preact/signals`.
- `npx tsc --noEmit` clean (`strict: true`) after every commit; the user is testing by hand on the same branch, so no commit may leave the tree failing to type-check.
- No Chrome DevTools MCP browser driving; no server started, stopped or restarted on port 5173; no Playwright runs or browser installs. Verify with `npx tsc --noEmit` and `npm test`.
- The document is never mutated after commit. Mutation helpers receive a draft produced by `draft()`; every state change from a component goes through `src/actions.ts`.
- Every chrome control is a `<button>` with a `title`.
- A group's own clones are the powers of its composite up to, but excluding, the first lattice translation, capped at `ORBIT_CAP` (12) with `open: true` past the cap. The binding's clones are the product across groups, index `p1 + (n1+1)·p2 + (n1+1)(n2+1)·p3 + …`, truncated at `CLONE_CAP` (48) in index order with `open: true`.
- `orbit(groups, elements, lattice)` returns `{ matrices: (Matrix | null)[]; open: boolean }`; `matrices[i]` is the clone with index `i + 1`, `null` for a deduplicated slot. Every consumer skips nulls. `Copy.power` keeps its name and now means clone index.
- An element appears at most once per binding. A group left empty is removed; a binding left with no groups is removed.
- Layers are ordered bottom to top; within a layer fills draw below strokes. New paths and fills go to the active layer (`activeLayerId` UI pref, persisted; falls back to the top layer). Region detection uses every path on every layer. A new document has one layer `Layer 1`.
- Document `version: 2`. v1 → v2 migration: `ops` → `groups: [ops]` (an empty `ops` binding is dropped), `newPathOps` → `newPathGroups` (empty chains dropped), layers `Structure` (paths with `layer: 'structure'`), `Fills` (every fill), `Detail` (paths with `layer: 'detail'`), always all three.
- In code the document layer type is named `DocLayer` (the spec writes `Layer`); `Layer` stays the UI mode `'drawing' | 'construction'`. This is a naming choice only.
- Commit after every task with a message ending in `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never `cd` into the project; use absolute paths or `git -C`.

## Review Focus

1. A v1 document whose binding has `ops: []` or whose `newPathOps` holds an empty chain must migrate without producing an empty group (the v2 validator would refuse it on the next load). Pinned by Task 2's serialize test "migration drops empty chains".
2. Two identical groups in one binding (the same element twice cannot happen through the UI, but a hand-edited file can hold two mirrors at the same place) must produce one clone, not a crash or a doubled stroke. Pinned by Task 1's orbit table rows 5 and 6.
3. Deleting the active layer's last use (the layer id vanishes on import or New) must not strand `activeLayerId`: the next path goes to the top layer. Pinned by Task 2's actions test "a stale activeLayerId falls back to the top layer".
4. The demo and a migrated document must render the same clone count before and after migration. Pinned by Task 2's serialize test on `docs/examples/fish.json`.
5. Moving a chip into a pending `+ then` group and then clicking it again must not leave a binding with an empty group. Pinned by Task 2's paths test "placeInGroup / removeFromBinding never leave an empty group".

---

## File map

| File | Change |
|---|---|
| `src/config.ts` | add `CLONE_CAP: 48` |
| `src/types.ts` | `DocLayer`, `Binding.groups`, `Path.layerId`, `Fill.layerId`, `Doc` v2 with `layers`, `newPathGroups`; drop `PathLayer` |
| `src/engine/transform.ts` | `ownClones` (old orbit), new `orbit` over groups, `cloneCount`, `Orbit` type |
| `src/engine/paths.ts` | `startPath` takes `layerId`; `deleteElement` prunes groups; `addBinding(groups)`; `placeInGroup`, `removeFromBinding`; `addFill(layerId)`; `addLayer`, `topLayerId`, `layerIdOr` |
| `src/engine/serialize.ts` | `DocV1`, `migrateV1`, `parseDoc` accepting v1/v2, per-layer defs and uses |
| `src/engine/hit.ts`, `src/engine/regions.ts` | iterate `orbit(b.groups…)` skipping nulls |
| `src/state/doc.ts`, `src/example.ts` | v2 empty and demo documents |
| `src/state/ui.ts`, `src/state/history.ts`, `src/state/persist.ts` | `activeLayerId`, `pendingGroup`; prefs persistence |
| `src/state/derived.ts` | null-aware clone map, `openElements` via `ownClones` |
| `src/actions.ts` | group, layer and new-path-group actions; pen/freehand/fill use the active layer |
| `src/interaction/tools/{common,construct,freehand}.ts` | first element of the first group; product preview |
| `src/components/Canvas.tsx` | one `<g id="cell-layer-<id>">` per layer; group-aware highlights |
| `src/components/Chrome.tsx` | Task 2: compile-through; Task 3: group clusters; Task 4: layer picker and move chips |
| `src/styles.css` | `.group` cluster |
| `tests/unit/*.test.ts` | v2 fixtures; new tests per task |
| `CLAUDE.md`, original spec | Task 5 |

---

### Task 1: `orbit` over groups

**Files:**
- Modify: `src/config.ts`, `src/engine/transform.ts:82-92`
- Test: `tests/unit/transform.test.ts`

**Interfaces:**
- Consumes: `composite`, `compose`, `invert`, `isLatticeTranslation`, `IDENTITY` (all in `transform.ts`).
- Produces: `export type Orbit = { matrices: (Matrix | null)[]; open: boolean }`; `export function ownClones(group: string[], elements: Element[], lat: Lattice, cap = 12): { matrices: Matrix[]; open: boolean }` (the old `orbit` body); `export function orbit(groups: string[][], elements: Element[], lat: Lattice, ownCap = 12, cloneCap = 48): Orbit`; `export const cloneCount = (o: { matrices: (Matrix | null)[] }): number`. Nothing else in the repo changes in this task: the old `orbit(ops, …)` callers keep compiling because `ownClones` keeps the old signature and this task temporarily exports `orbit` under the new signature **only after** Step 3 renames every existing call site of `orbit` to `ownClones` (there are seven: `paths.ts:4,263`, `derived.ts:6,13,19`, `hit.ts:4,155`, `regions.ts:5,30`, `serialize.ts:3,69`, `freehand.ts:5,15`, `Chrome.tsx:8,19`, and `hit.test.ts:13`). Task 2 then switches them to the new `orbit` one by one.

- [ ] **Step 1: Add `CLONE_CAP` to `src/config.ts`**

After `ORBIT_CAP: 12,` add:

```ts
  CLONE_CAP: 48,         // clones per binding across all groups
```

- [ ] **Step 2: Write the failing tests**

Replace the test `'orbit sizes match the spec table'` and the one after it in `tests/unit/transform.test.ts` with the following, and add `ownClones`, `cloneCount` to the import line:

```ts
test('one-group orbits match the original spec table', () => {
  const n = (ops: string[], L = lat) => cloneCount(orbit([ops], els, L));
  expect(n(['r2'])).toBe(1);
  expect(n(['r3'], hex)).toBe(2);
  expect(n(['r4'])).toBe(3);
  expect(n(['r6'], hex)).toBe(5);
  expect(n(['m'])).toBe(1);
  expect(n(['m', 't12'])).toBe(1);
  expect(n(['m', 't13'])).toBe(5);   // odd powers are reflected copies, even powers translations; M⁶ is the first lattice translation
  expect(n(['t12'])).toBe(1);
  expect(n(['tc'])).toBe(1);
  expect(n(['t1'])).toBe(0);
  expect(n(['r2', 't12'])).toBe(1);
  expect(orbit([], els, lat)).toEqual({ matrices: [], open: false });
  expect(orbit([[]], els, lat)).toEqual({ matrices: [], open: false });
  expect(ownClones(['r4'], els, lat).matrices).toHaveLength(3);
});

test('a 5-fold rotation still closes (R⁵ is the identity); a translation by 0.37 never does and is capped open', () => {
  expect(cloneCount(orbit([['r5']], els, lat))).toBe(4);
  const o = orbit([['t37']], els, lat, 12);
  expect(cloneCount(o)).toBe(12); expect(o.open).toBe(true);
});

const grp: Element[] = [
  { id: 'ma', kind: 'mirror', u: 0.5, v: 0.5, du: 1, dv: 0 },     // along a through the centre
  { id: 'mb', kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 },     // along b through the centre
  { id: 'md', kind: 'mirror', u: 0.5, v: 0.5, du: 1, dv: 1 },     // diagonal through the centre
  { id: 'ga', kind: 'mirror', u: 0, v: 0.5, du: 1, dv: 0 },       // mirror along a at v = 1/2 …
  { id: 'ta', kind: 'translate', u: 0.5, v: 0 },                  // … plus half a = glide
  { id: 'tb', kind: 'translate', u: 0, v: 0.5 },
  { id: 'r2', kind: 'rotate', u: 0.5, v: 0.5, n: 2 },
  { id: 'r2b', kind: 'rotate', u: 0.5, v: 0.5, n: 2 },
  { id: 'r6', kind: 'rotate', u: 0, v: 0, n: 6 },
  { id: 'mh', kind: 'mirror', u: 0, v: 0, du: 1, dv: 0 },
];

test('group products match the amendment table', () => {
  const n = (groups: string[][], L = lat) => cloneCount(orbit(groups, grp, L));
  expect(n([['ga', 'ta']])).toBe(1);
  expect(n([['ga', 'ta'], ['mb']])).toBe(3);
  expect(n([['ma'], ['mb'], ['md']])).toBe(7);          // the corner-mirror group of order 8
  expect(n([['r6'], ['mh']], hex)).toBe(11);
  expect(n([['ma'], ['ma']])).toBe(1);                  // same element twice dedups
  expect(n([['r2'], ['r2b']])).toBe(1);                 // second group's clone coincides with the first, mod lattice
  expect(n([['ta'], ['tb']])).toBe(3);
});

test('clone indices are mixed-radix, stable under appending a group, and null slots mark deduplicated clones', () => {
  const one = orbit([['ma']], grp, lat), two = orbit([['ma'], ['tb']], grp, lat);
  expect(two.matrices[0]).toEqual(one.matrices[0]);                                // index 1 unchanged
  expect(two.matrices).toHaveLength(3);
  near(apply(two.matrices[2]!, { x: 10, y: 20 }), apply(matrixOf(grp[5], lat), apply(matrixOf(grp[0], lat), { x: 10, y: 20 })));   // index 3 = tb ∘ ma
  const dup = orbit([['ma'], ['ma']], grp, lat);
  expect(dup.matrices).toEqual([dup.matrices[0], null, null]);                     // (0,1) equals (1,0); (1,1) is the identity
  expect(dup.matrices[0]).not.toBe(null);
});

test('the product is truncated at the clone cap in index order and reported open', () => {
  const many: Element[] = [
    { id: 'a', kind: 'rotate', u: 0, v: 0, n: 6 }, { id: 'b', kind: 'rotate', u: 0.5, v: 0.5, n: 6 }, { id: 'c', kind: 'rotate', u: 1 / 3, v: 1 / 3, n: 6 },
  ];
  const o = orbit([['a'], ['b'], ['c']], many, hex, 12, 48);
  expect(o.matrices).toHaveLength(48);
  expect(o.open).toBe(true);
  const small = orbit([['a'], ['b'], ['c']], many, hex, 12, 5);
  expect(small.matrices).toHaveLength(5); expect(small.open).toBe(true);
});
```

Also change the existing `'composite applies ops left to right'` test's `orbit` usage if any (none) and, in `tests/unit/hit.test.ts:13`, change `orbit(b.ops, …)` to `ownClones(b.ops, …)` (import it) so that file keeps compiling until Task 2.

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run tests/unit/transform.test.ts --root ~/Developer/personal/tesselator`
Expected: FAIL — `ownClones` / `cloneCount` are not exported; the `orbit([ops])` calls return wrong counts.

- [ ] **Step 4: Implement**

In `src/engine/transform.ts` replace the `orbit` function (lines 82–92) with:

```ts
// Own clones of one group: powers of its composite up to, but excluding, the first lattice translation.
export function ownClones(group: string[], elements: Element[], lat: Lattice, cap = 12): { matrices: Matrix[]; open: boolean } {
  const M = composite(group, elements, lat);
  const matrices: Matrix[] = [];
  let P = M;
  for (let k = 1; k <= cap; k++) {
    if (isLatticeTranslation(P, lat)) return { matrices, open: false };
    matrices.push(P);
    P = compose(M, P);
  }
  return { matrices, open: true };
}

export type Orbit = { matrices: (Matrix | null)[]; open: boolean };

// Clones of a binding: the product of its groups. Tuple (p1 … pk), not all zero, has matrix Gk^pk ∘ … ∘ G1^p1 and
// index p1 + (n1+1)·p2 + (n1+1)(n2+1)·p3 + …; matrices[index − 1] holds it, or null when it is the source again or
// coincides (modulo a lattice translation) with a lower-indexed clone. Truncated at cloneCap in index order.
export function orbit(groups: string[][], elements: Element[], lat: Lattice, ownCap = 12, cloneCap = 48): Orbit {
  const own = groups.map((g) => ownClones(g, elements, lat, ownCap));
  const radix = own.map((o) => o.matrices.length + 1);
  const total = radix.reduce((a, b) => a * b, 1);
  const matrices: (Matrix | null)[] = [], kept: Matrix[] = [];
  let open = own.some((o) => o.open);
  for (let i = 1; i < total; i++) {
    if (matrices.length >= cloneCap) { open = true; break; }
    let M: Matrix = IDENTITY, rest = i;
    own.forEach((o, g) => { const p = rest % radix[g]; rest = Math.floor(rest / radix[g]); if (p) M = compose(o.matrices[p - 1], M); });
    const dup = isLatticeTranslation(M, lat) || kept.some((K) => isLatticeTranslation(compose(M, invert(K)), lat));
    if (dup) matrices.push(null); else { matrices.push(M); kept.push(M); }
  }
  return { matrices, open };
}

export const cloneCount = (o: { matrices: (Matrix | null)[] }): number => o.matrices.filter((m) => m !== null).length;
```

Then rename every existing call of `orbit(` outside `transform.ts` to `ownClones(` (same arguments) and fix the import lines: `src/engine/paths.ts` (import line 4, call line 263), `src/state/derived.ts` (6, 13, 19), `src/engine/hit.ts` (4, 155), `src/engine/regions.ts` (5, 30), `src/engine/serialize.ts` (3, 69), `src/interaction/tools/freehand.ts` (5, 15), `src/components/Chrome.tsx` (8, 19), `tests/unit/hit.test.ts` (2, 13). This keeps the tree type-checking; Task 2 replaces each with the group `orbit`.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx tsc --noEmit -p ~/Developer/personal/tesselator && npx vitest run --root ~/Developer/personal/tesselator`
Expected: clean; all tests pass (88 before this task, now 91).

- [ ] **Step 6: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/config.ts src/engine/transform.ts src/engine/paths.ts src/state/derived.ts src/engine/hit.ts src/engine/regions.ts src/engine/serialize.ts src/interaction/tools/freehand.ts src/components/Chrome.tsx tests/unit/transform.test.ts tests/unit/hit.test.ts
git -C ~/Developer/personal/tesselator commit -m "$(printf 'Orbit over groups: product with mixed-radix index, dedup and clone cap\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')"
```

---
### Task 2: Document version 2 — groups and layers in the model, engine, state, actions and renderer

This is the cut-over. It touches many files because the type change ripples through TypeScript; it lands as one commit so the tree never fails to type-check. The chrome is only brought to "compiles and works"; Tasks 3 and 4 give it the designed controls.

**Files:**
- Modify: `src/types.ts`, `src/state/doc.ts`, `src/example.ts`, `src/engine/paths.ts`, `src/engine/serialize.ts`, `src/engine/hit.ts`, `src/engine/regions.ts`, `src/state/derived.ts`, `src/state/ui.ts`, `src/state/history.ts`, `src/state/persist.ts`, `src/actions.ts`, `src/interaction/tools/common.ts`, `src/interaction/tools/construct.ts`, `src/interaction/tools/freehand.ts`, `src/components/Canvas.tsx`, `src/components/Chrome.tsx`, `src/main.tsx`
- Test: `tests/unit/paths.test.ts`, `tests/unit/serialize.test.ts`, `tests/unit/regions.test.ts`, `tests/unit/hit.test.ts`, `tests/unit/actions.test.ts`, `tests/unit/persist.test.ts`, new `tests/unit/migrate.test.ts`

**Interfaces:**
- Consumes: `orbit(groups, …)`, `ownClones`, `cloneCount`, `Orbit` from Task 1.
- Produces (used by Tasks 3–4): in `paths.ts` — `startPath(doc, node, style, layerId)`, `addBinding(doc, pathId, groups: string[][] = [])`, `placeInGroup(doc, bindingId, elementId, gi)`, `removeFromBinding(doc, bindingId, elementId)`, `addFill(doc, uv, color, layerId)`, `addLayer(doc, name?)`, `topLayerId(doc)`, `layerIdOr(doc, id)`; in `ui.ts` — `activeLayerId: Signal<string | null>`, `pendingGroup: Signal<{ bindingId: string } | { pathId: string } | null>`; in `actions.ts` — `activeLayerId(d?)`, `setActiveLayer(id)`, `addLayer()`, `setPathLayer(pathId, layerId)`, `setFillLayer(fillId, layerId)`, `isNewPathGroup(group)`, `toggleNewPathGroup(group)`, `isNewPathGroups(groups)`, `setNewPathGroups(groups)`, `placeElementInGroup(bindingId, elementId, gi)`, `removeElementFromBinding(bindingId, elementId)`, `startGroup(bindingId)`, `startChain(pathId)`, `addElementToNewChain(pathId, elementId)`, `cancelPending()`; in `serialize.ts` — `migrateV1`, `DocV1`; in `Chrome.tsx` — `chainLabel(groups: string[][])`.

- [ ] **Step 1: Types**

Replace these lines in `src/types.ts`:

```ts
export type PathLayer = 'structure' | 'detail';
export type Style = { color: string; weight: number };
export type Path = { id: string; start: Node; segments: Segment[]; style: Style; layer: PathLayer };
```
with
```ts
export type Style = { color: string; weight: number };
export type DocLayer = { id: string; name: string };                     // a document layer (the UI mode type below is `Layer`)
export type Path = { id: string; start: Node; segments: Segment[]; style: Style; layerId: string };
```
and
```ts
export type Binding = { id: string; pathId: string; ops: string[] };
export type Fill = { id: string; u: number; v: number; color: string };

export type Doc = {
  version: 1;
  lattice: Lattice;
  points: Point[];
  paths: Path[];
  elements: Element[];
  bindings: Binding[];
  fills: Fill[];
  newPathOps: string[][];
};
```
with
```ts
export type Binding = { id: string; pathId: string; groups: string[][] };   // ordered groups of ordered element ids
export type Fill = { id: string; u: number; v: number; color: string; layerId: string };

export type Doc = {
  version: 2;
  lattice: Lattice;
  points: Point[];
  paths: Path[];
  elements: Element[];
  bindings: Binding[];
  fills: Fill[];
  layers: DocLayer[];          // bottom to top
  newPathGroups: string[][];   // the groups every new path's binding receives
};
```
The `Copy` comment becomes `// A rendered copy of a path: the source in a cell, or a clone (binding + clone index, stored as \`power\`) in a cell.`

- [ ] **Step 2: Empty and demo documents**

`src/state/doc.ts`:

```ts
import { signal } from '@preact/signals';
import { CONFIG } from '../config';
import { makeId } from '../ids';
import type { Doc } from '../types';

export function emptyDoc(): Doc {
  return { version: 2, lattice: { ...CONFIG.LATTICE_PRESETS.Square }, points: [], paths: [], elements: [], bindings: [], fills: [], layers: [{ id: makeId('layer'), name: 'Layer 1' }], newPathGroups: [] };
}

// The committed document. Never mutated: actions draft(), mutate the draft, and commit() it (history.ts).
export const doc = signal<Doc>(emptyDoc());

export function draft(): Doc { return structuredClone(doc.value); }
```

`src/example.ts` (two layers: the outline and its fill on `Outline`, the eye on `Detail`):

```ts
import { emptyDoc } from './state/doc';
import * as P from './engine/paths';
import type { Doc } from './types';

// A wavy tile boundary cloned through a 180° turn, one fill, and a detail loop on a layer above.
export function exampleDoc(): Doc {
  const d = emptyDoc();
  d.layers[0].name = 'Outline';
  const outline = d.layers[0].id, detail = P.addLayer(d, 'Detail').id;
  const style = { color: '#1c1b18', weight: 2 };
  const r2 = P.addElement(d, { kind: 'rotate', u: 0.5, v: 0.5, n: 2 });
  d.newPathGroups = [[r2.id]];
  const o = P.addPoint(d, { u: 0, v: 0 });
  const top = P.startPath(d, o, style, outline);
  P.appendNode(d, top.id, P.addPoint(d, { u: 1, v: 0 }));
  P.setControlPointAbs(d, top.id, 0, { u: 0.5, v: 0.3 });
  P.addBinding(d, top.id, [[r2.id]]);
  const left = P.startPath(d, o, style, outline);
  P.appendNode(d, left.id, P.addPoint(d, { u: 0, v: 1 }));
  P.setControlPointAbs(d, left.id, 0, { u: -0.25, v: 0.5 });
  P.addBinding(d, left.id, [[r2.id]]);
  const eye = P.startPath(d, P.addPoint(d, { u: 0.375, v: 0.42 }), { color: '#c2255c', weight: 2 }, detail);
  P.appendNode(d, eye.id, P.addPoint(d, { u: 0.5, v: 0.42 }));
  P.appendNode(d, eye.id, eye.start);
  P.setControlPointAbs(d, eye.id, 0, { u: 0.44, v: 0.33 });
  P.setControlPointAbs(d, eye.id, 1, { u: 0.44, v: 0.51 });
  P.addFill(d, { u: 0.5, v: 0.62 }, '#c98a12', outline);
  return d;
}
```

- [ ] **Step 3: Write the failing engine tests**

`tests/unit/paths.test.ts`: change `makeDoc` and `polyline`, replace the bindings test, add three tests.

```ts
function makeDoc(): Doc {
  return { version: 2, lattice: { ...CONFIG.LATTICE_PRESETS.Square }, points: [], paths: [], elements: [], bindings: [], fills: [], layers: [{ id: 'L1', name: 'Layer 1' }], newPathGroups: [] };
}
const style = { color: '#000', weight: 2 };
function polyline(doc: Doc, pts: UV[], close = false) {
  const nodes = pts.map((p) => P.addPoint(doc, p));
  const path = P.startPath(doc, nodes[0], style, 'L1');
  for (const n of nodes.slice(1)) P.appendNode(doc, path.id, n);
  if (close) P.appendNode(doc, path.id, nodes[0]);
  return path;
}
```
Every other `P.startPath(doc, …, style)` in the file gains the fourth argument `'L1'`; every `P.addFill(doc, …, '#f00')` gains `'L1'`. Replace the test `'bindings toggle ops in order; cloneMatrices uses the orbit; deleting an element removes its bindings'` with:

```ts
test('bindings hold groups; cloneMatrices is the group product; deleting an element prunes groups, then bindings', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0, v: 0 }, { u: 0.5, v: 0 }]);
  const m = P.addElement(doc, { kind: 'mirror', u: 0, v: 0.5, du: 1, dv: 0 });
  const t = P.addElement(doc, { kind: 'translate', u: 0.5, v: 0 });
  const mb = P.addElement(doc, { kind: 'mirror', u: 0.5, v: 0, du: 0, dv: 1 });
  const b = P.addBinding(doc, path.id, [[m.id, t.id], [mb.id]]);
  expect(cloneCount(P.cloneMatrices(doc, b.id))).toBe(3);
  doc.newPathGroups = [[m.id, t.id], [mb.id]];
  P.deleteElement(doc, mb.id);
  expect(b.groups).toEqual([[m.id, t.id]]);
  expect(doc.newPathGroups).toEqual([[m.id, t.id]]);
  P.deleteElement(doc, m.id); P.deleteElement(doc, t.id);
  expect(doc.bindings).toHaveLength(0);
  expect(doc.newPathGroups).toEqual([]);
});

test('placeInGroup / removeFromBinding move an element between groups and never leave an empty group', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0, v: 0 }, { u: 0.5, v: 0 }]);
  const a = P.addElement(doc, { kind: 'mirror', u: 0.5, v: 0.5, du: 1, dv: 0 });
  const c = P.addElement(doc, { kind: 'mirror', u: 0.5, v: 0.5, du: 0, dv: 1 });
  const b = P.addBinding(doc, path.id, [[a.id]]);
  P.placeInGroup(doc, b.id, c.id, 1);                 // gi === groups.length → new group
  expect(b.groups).toEqual([[a.id], [c.id]]);
  P.placeInGroup(doc, b.id, c.id, 0);                 // moves into group 0; its old group is dropped
  expect(b.groups).toEqual([[a.id, c.id]]);
  P.placeInGroup(doc, b.id, a.id, 1);                 // out of group 0 into a new group after it
  expect(b.groups).toEqual([[c.id], [a.id]]);
  P.removeFromBinding(doc, b.id, c.id);
  expect(b.groups).toEqual([[a.id]]);
  P.removeFromBinding(doc, b.id, a.id);
  expect(doc.bindings).toHaveLength(0);               // a binding with no groups is removed
});

test('addLayer names layers in order and pushes on top; layerIdOr falls back to the top layer', () => {
  const doc = makeDoc();
  const l2 = P.addLayer(doc);
  expect(l2.name).toBe('Layer 2');
  expect(doc.layers.map((l) => l.id)).toEqual(['L1', l2.id]);
  expect(P.topLayerId(doc)).toBe(l2.id);
  expect(P.layerIdOr(doc, 'L1')).toBe('L1');
  expect(P.layerIdOr(doc, 'gone')).toBe(l2.id);
  expect(P.layerIdOr(doc, null)).toBe(l2.id);
});
```
Add `import { cloneCount } from '../../src/engine/transform';`.

`tests/unit/regions.test.ts`: `makeDoc` becomes the v2 shape above (with `layers: [{ id: 'L1', name: 'Layer 1' }], newPathGroups: []`), `P.startPath(doc, nodes[0], style, 'L1')`, every `P.addBinding(doc, x.id, [el.id])` becomes `P.addBinding(doc, x.id, [[el.id]])`, every `P.addFill(doc, uv, color)` gains `'L1'`. Add:

```ts
test('faces do not depend on which layer a fill or path is on', () => {
  const doc = makeDoc(); square(doc);
  const top = P.addLayer(doc);
  const before = computeFaces(doc).map((f) => [f.area, f.centroid.x, f.centroid.y]);
  const moved = structuredClone(doc);
  moved.paths[0].layerId = top.id;
  P.addFill(moved, { u: 0.5, v: 0.5 }, '#f00', top.id);
  expect(computeFaces(moved).map((f) => [f.area, f.centroid.x, f.centroid.y])).toEqual(before);
});
```

`tests/unit/hit.test.ts`: `makeDoc` → v2 shape; line 13 becomes `for (const b of d.bindings) cm.set(b.id, orbit(b.groups, d.elements, d.lattice, CONFIG.ORBIT_CAP, CONFIG.CLONE_CAP).matrices);` (import `orbit`, drop `ownClones`); `copies` construction skips nulls: `(cm.get(b.id) ?? []).forEach((M, k) => { if (M) out.push({ pathId: p.id, copy: { cell, bindingId: b.id, power: k + 1 }, M: compose(Mo, M) }); })` (adapt to the file's existing helper); every `P.startPath(…, style)` gains `'L1'`; every `P.addBinding(d, id, [x])` becomes `[[x]]`; every `P.addFill(…)` gains `'L1'`. Read the file and apply these mechanically — it has five such sites.

- [ ] **Step 4: Write the failing migration and serialization tests**

Create `tests/unit/migrate.test.ts`:

```ts
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDoc, serializeDoc, migrateV1, type DocV1 } from '../../src/engine/serialize';
import { orbit, ownClones, cloneCount } from '../../src/engine/transform';
import { CONFIG } from '../../src/config';

const fishJson = readFileSync(new URL('../../docs/examples/fish.json', import.meta.url), 'utf8');
const fishV1 = JSON.parse(fishJson) as DocV1;

test('the fish document migrates to one-group bindings and three layers, and round-trips as v2', () => {
  const d = parseDoc(fishJson)!;
  expect(d).not.toBe(null);
  expect(d.version).toBe(2);
  expect(d.layers.map((l) => l.name)).toEqual(['Structure', 'Fills', 'Detail']);
  const [structure, fills, detail] = d.layers.map((l) => l.id);
  expect(d.bindings).toHaveLength(fishV1.bindings.length);
  d.bindings.forEach((b, i) => expect(b.groups).toEqual([fishV1.bindings[i].ops]));
  expect(d.newPathGroups).toEqual(fishV1.newPathOps);
  d.paths.forEach((p, i) => expect(p.layerId).toBe(fishV1.paths[i].layer === 'detail' ? detail : structure));
  expect(d.paths.some((p) => p.layerId === detail)).toBe(true);
  expect(d.fills.every((f) => f.layerId === fills)).toBe(true);
  expect(d.fills).toHaveLength(fishV1.fills.length);
  expect(parseDoc(serializeDoc(d))).toEqual(d);
});

test('migration keeps every clone: each one-group binding has exactly its old chain\'s clones', () => {
  const d = parseDoc(fishJson)!;
  d.bindings.forEach((b, i) => {
    const old = ownClones(fishV1.bindings[i].ops, d.elements, d.lattice, CONFIG.ORBIT_CAP).matrices.length;
    expect(cloneCount(orbit(b.groups, d.elements, d.lattice, CONFIG.ORBIT_CAP, CONFIG.CLONE_CAP))).toBe(old);
  });
});

test('migration drops empty chains and always creates all three layers', () => {
  const v1: DocV1 = { ...fishV1, bindings: [...fishV1.bindings, { id: 'b_empty', pathId: fishV1.paths[0].id, ops: [] }], newPathOps: [[], fishV1.newPathOps[0]], fills: [] };
  const d = migrateV1(v1);
  expect(d.bindings.every((b) => b.groups.length && b.groups.every((g) => g.length))).toBe(true);
  expect(d.bindings).toHaveLength(fishV1.bindings.length);
  expect(d.newPathGroups).toEqual([fishV1.newPathOps[0]]);
  expect(d.layers).toHaveLength(3);
  expect(parseDoc(serializeDoc(d))).toEqual(d);                       // the migrated document passes v2 validation
});

test('v2 validation refuses a bad layerId, a repeated element within a binding, or no layers', () => {
  const d = parseDoc(fishJson)!;
  expect(parseDoc(JSON.stringify({ ...d, paths: d.paths.map((p, i) => (i === 0 ? { ...p, layerId: 'nope' } : p)) }))).toBe(null);
  expect(parseDoc(JSON.stringify({ ...d, fills: d.fills.map((f, i) => (i === 0 ? { ...f, layerId: 'nope' } : f)) }))).toBe(null);
  const el = d.bindings[0].groups[0][0];
  expect(parseDoc(JSON.stringify({ ...d, bindings: d.bindings.map((b, i) => (i === 0 ? { ...b, groups: [[el], [el]] } : b)) }))).toBe(null);
  expect(parseDoc(JSON.stringify({ ...d, layers: [] }))).toBe(null);
  expect(parseDoc(JSON.stringify({ ...d, layers: [d.layers[0], d.layers[0]] }))).toBe(null);
  expect(parseDoc(JSON.stringify({ ...d, version: 3 }))).toBe(null);
});

test('unknown element ids are dropped from groups; an emptied group or binding goes away', () => {
  const d = parseDoc(fishJson)!;
  const odd = { ...d, bindings: d.bindings.map((b, i) => (i === 0 ? { ...b, groups: [[...b.groups[0], 'el_missing'], ['el_missing']] } : b)), newPathGroups: [...d.newPathGroups, ['el_missing']] };
  const parsed = parseDoc(JSON.stringify(odd))!;
  expect(parsed.bindings[0].groups).toEqual(d.bindings[0].groups);
  expect(parsed.newPathGroups).toEqual(d.newPathGroups);
  const gone = { ...d, bindings: d.bindings.map((b, i) => (i === 0 ? { ...b, groups: [['el_missing']] } : b)) };
  expect(parseDoc(JSON.stringify(gone))!.bindings).toHaveLength(d.bindings.length - 1);
});
```

`tests/unit/serialize.test.ts`: update the existing tests — the first test's `version: 2` line becomes `version: 3`; `'unknown element ids are dropped from binding ops and newPathOps…'` is deleted (the migrate test covers v2); the tile-export test's `<use href="#cell-structure"` expectations become: `expect(svg.match(/<use href="#cell-layer-/g)).toHaveLength(18)` (two layers × 9 cells) and `expect(svg).toContain('id="cell-layer-')`; the grid test's `#cell-fills` count becomes `svg.match(/<use href="#cell-layer-/g)).toHaveLength(18)` and the hex `#cell-detail` count becomes a count of `#cell-layer-` greater than 18. Add:

```ts
test('export writes one group per layer in document order, fills before strokes inside a layer', () => {
  const d = exampleDoc();
  const svg = exportSvg(d, { kind: 'tile' });
  const ids = [...svg.matchAll(/<g id="cell-layer-([^"]+)">/g)].map((m) => m[1]);
  expect(ids).toEqual(d.layers.map((l) => l.id));
  const outline = svg.slice(svg.indexOf(`<g id="cell-layer-${d.layers[0].id}">`), svg.indexOf(`<g id="cell-layer-${d.layers[1].id}">`));
  expect(outline.indexOf('fill-rule="evenodd"')).toBeLessThan(outline.indexOf('stroke-linecap'));
});
```

`tests/unit/persist.test.ts`: `prefsWith` becomes `JSON.stringify({ prefs: UI.prefs.value, tool: 'select', activeLayerId: null, view })`; add:

```ts
test('a stored v1 document is migrated on restore and a stored active layer id is kept', () => {
  const v1 = JSON.parse(readFileSync(new URL('../../docs/examples/fish.json', import.meta.url), 'utf8'));
  store.set(CONFIG.STORAGE_DOC_KEY, JSON.stringify(v1));
  store.set(CONFIG.STORAGE_PREFS_KEY, JSON.stringify({ prefs: UI.prefs.value, tool: 'select', activeLayerId: 'layer_x', view: { pan: { x: 0, y: 0 }, zoom: 1 } }));
  expect(restore()).toBe(true);
  expect(doc.value.version).toBe(2);
  expect(doc.value.layers).toHaveLength(3);
  expect(UI.activeLayerId.value).toBe('layer_x');
});
```
with `import { readFileSync } from 'node:fs';`.

- [ ] **Step 5: Run the engine tests to see them fail**

Run: `npx vitest run tests/unit/paths.test.ts tests/unit/migrate.test.ts --root ~/Developer/personal/tesselator`
Expected: FAIL (type errors on `layers`, `groups`, missing exports).

- [ ] **Step 6: `src/engine/paths.ts`**

Change the import to `import type { Doc, UV, XY, Cell, Node, Segment, Path, Element, Binding, Fill, Matrix, Style, Box, DocLayer } from '../types';` and `import { IDENTITY, apply, orbit, type Orbit } from './transform';`.

`startPath`:
```ts
export function startPath(doc: Doc, node: Node, style: Style, layerId: string): Path {
  const path: Path = { id: makeId('path'), start: cloneNode(node), segments: [], style: { ...style }, layerId };
  doc.paths.push(path);
  return path;
}
```

Replace everything from `export function deleteElement` to the end of the file with:

```ts
const pruneGroups = (groups: string[][], id: string): string[][] => groups.map((g) => g.filter((x) => x !== id)).filter((g) => g.length);

// Deleting an element removes it from every group; an emptied group goes, and a binding with no groups goes.
export function deleteElement(doc: Doc, id: string): void {
  doc.elements = doc.elements.filter((e) => e.id !== id);
  doc.bindings = doc.bindings.map((b) => ({ ...b, groups: pruneGroups(b.groups, id) })).filter((b) => b.groups.length);
  doc.newPathGroups = pruneGroups(doc.newPathGroups, id);
}

export function addBinding(doc: Doc, pathId: string, groups: string[][] = []): Binding {
  const b: Binding = { id: makeId('bind'), pathId, groups: groups.map((g) => g.slice()) };
  doc.bindings.push(b);
  return b;
}

// Put an element in group gi of a binding (gi === groups.length starts a new group). An element appears at most
// once per binding, so it is first removed from wherever it was; a group emptied by that removal is dropped and gi
// shifts down with it.
export function placeInGroup(doc: Doc, bindingId: string, elementId: string, gi: number): void {
  const b = getBinding(doc, bindingId);
  if (!b) return;
  const from = b.groups.findIndex((g) => g.includes(elementId));
  if (from >= 0) {
    b.groups[from] = b.groups[from].filter((x) => x !== elementId);
    if (!b.groups[from].length) { b.groups.splice(from, 1); if (from < gi) gi--; }
  }
  gi = Math.max(0, Math.min(gi, b.groups.length));
  if (gi === b.groups.length) b.groups.push([elementId]); else b.groups[gi].push(elementId);
}

export function removeFromBinding(doc: Doc, bindingId: string, elementId: string): void {
  const b = getBinding(doc, bindingId);
  if (!b) return;
  b.groups = pruneGroups(b.groups, elementId);
  if (!b.groups.length) removeBinding(doc, bindingId);
}

export function removeBinding(doc: Doc, id: string): void { doc.bindings = doc.bindings.filter((b) => b.id !== id); }

export function cloneMatrices(doc: Doc, bindingId: string, ownCap = 12, cloneCap = 48): Orbit {
  const b = getBinding(doc, bindingId);
  return b ? orbit(b.groups, doc.elements, doc.lattice, ownCap, cloneCap) : { matrices: [], open: false };
}

export function addFill(doc: Doc, uv: UV, color: string, layerId: string): Fill {
  const f: Fill = { id: makeId('fill'), u: uv.u, v: uv.v, color, layerId };
  doc.fills.push(f);
  return f;
}

export function removeFill(doc: Doc, id: string): void { doc.fills = doc.fills.filter((f) => f.id !== id); }

// --- layers (bottom to top)

export function addLayer(doc: Doc, name = `Layer ${doc.layers.length + 1}`): DocLayer {
  const l: DocLayer = { id: makeId('layer'), name };
  doc.layers.push(l);
  return l;
}
export const topLayerId = (doc: Doc): string => doc.layers[doc.layers.length - 1].id;
export const layerIdOr = (doc: Doc, id: string | null | undefined): string => (id && doc.layers.some((l) => l.id === id) ? id : topLayerId(doc));
```
Delete the old `toggleOp` and the old `addElement` stays as is (above `deleteElement`).

- [ ] **Step 7: `src/engine/serialize.ts`**

Replace everything from the top of the file through the end of `parseDoc` with:

```ts
import { CONFIG } from '../config';
import { makeId } from '../ids';
import { windowOffsets, cellPolygon, toUV, toWorld } from './lattice';
import { IDENTITY, apply, orbit } from './transform';
import { pathWorld, pathCpsWorld } from './paths';
import { computeFaces, fillFace, facePathData } from './regions';
import { pathD } from './svgpath';
import type { Doc, XY, Cell, Lattice, Box, Matrix, Point, Path, Fill, Element, DocLayer } from '../types';

export function serializeDoc(d: Doc): string { return JSON.stringify(d); }

// --- version 1 (before groups and layers), kept for migration

type PathV1 = Omit<Path, 'layerId'> & { layer: 'structure' | 'detail' };
type BindingV1 = { id: string; pathId: string; ops: string[] };
export type DocV1 = { version: 1; lattice: Lattice; points: Point[]; paths: PathV1[]; elements: Element[]; bindings: BindingV1[]; fills: Omit<Fill, 'layerId'>[]; newPathOps: string[][] };

// Three layers preserve the old appearance exactly: structure strokes, then every fill, then detail strokes.
export function migrateV1(d: DocV1): Doc {
  const structure: DocLayer = { id: makeId('layer'), name: 'Structure' }, fills: DocLayer = { id: makeId('layer'), name: 'Fills' }, detail: DocLayer = { id: makeId('layer'), name: 'Detail' };
  return {
    version: 2, lattice: { ...d.lattice }, points: d.points, elements: d.elements,
    paths: d.paths.map(({ layer, ...p }) => ({ ...p, layerId: layer === 'detail' ? detail.id : structure.id })),
    bindings: d.bindings.filter((b) => b.ops.length).map((b) => ({ id: b.id, pathId: b.pathId, groups: [b.ops.slice()] })),
    fills: d.fills.map((f) => ({ ...f, layerId: fills.id })),
    layers: [structure, fills, detail],
    newPathGroups: d.newPathOps.filter((c) => c.length).map((c) => c.slice()),
  };
}

// --- validation: per-entity shapes against types.ts, then references. A dangling pointId, pathId or layerId is
// refused (it would throw in render on every reload); unknown element ids in groups are dropped, and a group or
// binding emptied by that goes away.
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isCell = (x: any): boolean => !!x && isNum(x.c) && isNum(x.r);
const isNode = (x: any): boolean => !!x && isStr(x.pointId) && isCell(x.cell);
const isCp = (x: any): boolean => x === null || (!!x && isNum(x.u) && isNum(x.v));
const isStyle = (x: any): boolean => !!x && isStr(x.color) && isNum(x.weight);
const isPoint = (x: any): boolean => !!x && isStr(x.id) && isNum(x.u) && isNum(x.v);
const isSegment = (x: any): boolean => !!x && isNode(x.to) && isCp(x.cp);
const isPathCore = (x: any): boolean => !!x && isStr(x.id) && isNode(x.start) && isStyle(x.style) && Array.isArray(x.segments) && x.segments.every(isSegment);
const isPathV1 = (x: any): boolean => isPathCore(x) && (x.layer === 'structure' || x.layer === 'detail');
const isPathV2 = (x: any): boolean => isPathCore(x) && isStr(x.layerId);
const isElement = (x: any): boolean => {
  if (!x || !isStr(x.id) || !isNum(x.u) || !isNum(x.v)) return false;
  if (x.kind === 'translate') return true;
  if (x.kind === 'mirror') return isNum(x.du) && isNum(x.dv);
  if (x.kind === 'rotate') return Number.isInteger(x.n) && x.n >= 2;
  return false;
};
const isStrList = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const isGroups = (x: unknown): x is string[][] => Array.isArray(x) && x.every((g) => isStrList(g) && g.length > 0);
const isBindingV1 = (x: any): boolean => !!x && isStr(x.id) && isStr(x.pathId) && isStrList(x.ops);
const isBindingV2 = (x: any): boolean => !!x && isStr(x.id) && isStr(x.pathId) && isGroups(x.groups) && x.groups.length > 0 && new Set(x.groups.flat()).size === x.groups.flat().length;
const isFillCore = (x: any): boolean => !!x && isStr(x.id) && isNum(x.u) && isNum(x.v) && isStr(x.color);
const isFillV2 = (x: any): boolean => isFillCore(x) && isStr(x.layerId);
const isLayer = (x: any): boolean => !!x && isStr(x.id) && isStr(x.name);

function checkCommon(o: any): boolean {
  if (!o || !o.lattice) return false;
  for (const k of ['points', 'paths', 'elements', 'bindings', 'fills']) if (!Array.isArray(o[k])) return false;
  const l = o.lattice;
  if (![l.ax, l.ay, l.bx, l.by].every(isNum)) return false;
  if (!o.points.every(isPoint) || !o.elements.every(isElement)) return false;
  const pointIds = new Set<string>(o.points.map((pt: Point) => pt.id));
  for (const path of o.paths as Path[]) if (!pointIds.has(path.start.pointId) || path.segments.some((sg) => !pointIds.has(sg.to.pointId))) return false;
  const pathIds = new Set<string>(o.paths.map((path: Path) => path.id));
  return (o.bindings as { pathId: string }[]).every((b) => pathIds.has(b.pathId));
}

export function parseDoc(json: string): Doc | null {
  try {
    const o = JSON.parse(json);
    if (!o || !checkCommon(o)) return null;
    const elIds = new Set<string>(o.elements.map((e: Element) => e.id));
    const known = (g: string[]) => g.filter((id) => elIds.has(id));
    const knownGroups = (groups: string[][]) => groups.map(known).filter((g) => g.length);
    const l = o.lattice, lattice: Lattice = { ax: l.ax, ay: l.ay, bx: l.bx, by: l.by };
    if (o.version === 1) {
      if (!o.paths.every(isPathV1) || !o.bindings.every(isBindingV1) || !o.fills.every(isFillCore)) return null;
      if (o.newPathOps !== undefined && !(Array.isArray(o.newPathOps) && o.newPathOps.every(isStrList))) return null;
      const v1: DocV1 = { version: 1, lattice, points: o.points, paths: o.paths, elements: o.elements, fills: o.fills,
        bindings: (o.bindings as BindingV1[]).map((b) => ({ ...b, ops: known(b.ops) })),
        newPathOps: (Array.isArray(o.newPathOps) ? (o.newPathOps as string[][]) : []).map(known) };
      return migrateV1(v1);
    }
    if (o.version !== 2) return null;
    if (!Array.isArray(o.layers) || !o.layers.length || !o.layers.every(isLayer)) return null;
    const layerIds = new Set<string>(o.layers.map((x: DocLayer) => x.id));
    if (layerIds.size !== o.layers.length) return null;
    if (!o.paths.every(isPathV2) || !o.bindings.every(isBindingV2) || !o.fills.every(isFillV2)) return null;
    if (!(o.paths as Path[]).every((p) => layerIds.has(p.layerId)) || !(o.fills as Fill[]).every((f) => layerIds.has(f.layerId))) return null;
    if (o.newPathGroups !== undefined && !isGroups(o.newPathGroups)) return null;
    const bindings = (o.bindings as { id: string; pathId: string; groups: string[][] }[]).map((b) => ({ id: b.id, pathId: b.pathId, groups: knownGroups(b.groups) })).filter((b) => b.groups.length);
    return { version: 2, lattice, points: o.points, paths: o.paths, elements: o.elements, bindings, fills: o.fills, layers: o.layers, newPathGroups: knownGroups(Array.isArray(o.newPathGroups) ? o.newPathGroups : []) };
  } catch { return null; }
}
```

Replace `cellDefs` and the last line of `exportSvg` with:

```ts
const cloneMs = (d: Doc, pathId: string): Matrix[] => d.bindings.filter((b) => b.pathId === pathId).flatMap((b) => orbit(b.groups, d.elements, d.lattice, CONFIG.ORBIT_CAP, CONFIG.CLONE_CAP).matrices.filter((M): M is Matrix => M !== null));

// One group per layer, bottom to top; inside a layer the seeded faces come first, then every source and clone stroke.
function cellDefs(d: Doc): string {
  const faces = computeFaces(d);
  return d.layers.map((l) => {
    const fills = d.fills.filter((f) => f.layerId === l.id).map((f) => ({ f, face: fillFace(faces, f, d.lattice) })).filter((x) => x.face).sort((a, b) => b.face!.area - a.face!.area)
      .map(({ f, face }) => `<path d="${facePathData(face!)}" fill="${esc(f.color)}" fill-rule="evenodd"/>`).join('');
    const strokes = d.paths.filter((p) => p.layerId === l.id).flatMap((p) => {
      const P = pathWorld(d, p), C = pathCpsWorld(d, p);
      return [IDENTITY, ...cloneMs(d, p.id)].map((M) => `<path d="${pathD(P.map((q) => apply(M, q)), C.map((c) => c && apply(M, c)))}" fill="none" stroke="${esc(p.style.color)}" stroke-width="${p.style.weight}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }).join('');
    return `<g id="cell-layer-${esc(l.id)}">${fills}${strokes}</g>`;
  }).join('');
}
```
and in `exportSvg` the final `return` uses `${d.layers.map((l) => uses(`cell-layer-${esc(l.id)}`)).join('')}` in place of the three `uses(...)` calls. (`esc` and `bbox` stay where they are, above `cellDefs`.)

- [ ] **Step 8: Clone consumers skip nulls**

`src/engine/hit.ts`: import `orbit` (not `ownClones`); `HitContext.cloneMatrices: Map<string, (Matrix | null)[]>`; `copyMatrixOf(copy, lat, cm: Map<string, (Matrix | null)[]>)` (its body already treats a null as "no clone"). In `anchorsWorld`: `ms: orbit(b.groups, doc.elements, lat, cap, CONFIG.CLONE_CAP).matrices` and `ms.forEach((M, k) => { if (!M) return; const MM = compose(Mo, M); … })`.

`src/engine/regions.ts` `collectSegments`: `const clones = doc.bindings.map((b) => ({ b, ms: orbit(b.groups, doc.elements, doc.lattice, cap, CONFIG.CLONE_CAP).matrices }));` and `ms.forEach((M, k) => { if (M) push(compose(Mo, M), b.id, k + 1); })`.

`src/state/derived.ts`:
```ts
import { cellMatrix, compose, orbit, ownClones } from '../engine/transform';
…
export const cloneMatrices = computed(() => {
  const d = doc.value, m = new Map<string, (Matrix | null)[]>();
  for (const b of d.bindings) m.set(b.id, orbit(b.groups, d.elements, d.lattice, CONFIG.ORBIT_CAP, CONFIG.CLONE_CAP).matrices);
  return m;
});

export const openElements = computed(() => {
  const d = doc.value;
  return new Set(d.elements.filter((e) => ownClones([e.id], d.elements, d.lattice, CONFIG.ORBIT_CAP).open).map((e) => e.id));
});
```
`copyMatrix`'s `cm` parameter type becomes `Map<string, (Matrix | null)[]>`; in `copies`: `(cm.get(b.id) ?? []).forEach((M, k) => { if (M) out.push({ pathId: p.id, copy: { cell, bindingId: b.id, power: k + 1 }, M: compose(Mo, M) }); });`.

`src/interaction/tools/freehand.ts`:
```ts
// Ghost the stroke through the extended path's bindings, else through the binding a new path would get.
function previewMatrices(startNode: Node | null): Matrix[] {
  const d = doc.value;
  const extendId = startNode ? P.openEndAt(d, startNode.pointId) : null;
  const groupsList = extendId ? d.bindings.filter((b) => b.pathId === extendId).map((b) => b.groups) : [d.newPathGroups];
  return groupsList.flatMap((g) => orbit(g, d.elements, d.lattice, CONFIG.ORBIT_CAP, CONFIG.CLONE_CAP).matrices.filter((M): M is Matrix => M !== null));
}
```
(import `orbit`.)

`src/interaction/tools/common.ts` `cloneBodyMove`: replace `if (!b || !b.ops.length) return; const s0 = d.startEls.find((z) => z.id === b.ops[0]);` with `const g0 = b?.groups[0]; if (!b || !g0 || !g0.length) return; const s0 = d.startEls.find((z) => z.id === g0[0]);`; `P.getElement(dd, b.ops[0])` → `P.getElement(dd, g0[0])`; `b.ops.slice(1).find(…)` → `g0.slice(1).find(…)`.

`src/interaction/tools/construct.ts` `startMultiDrag`:
```ts
  const own = pn ? d.bindings.filter((b) => b.pathId === pn.pathId).map((b) => b.groups[0]?.[0]).filter((x): x is string => !!x) : [];
  const ids = own.length ? own : d.newPathGroups.map((g) => g[0]).filter((x): x is string => !!x);
```

- [ ] **Step 9: UI state, history, persistence**

`src/state/ui.ts`: delete the `sublayer` signal and its `resetUi` assignment; drop `PathLayer` from the import; add after `pen`:
```ts
export const activeLayerId = signal<string | null>(null);                                        // new paths and fills go here; null = top layer
export const pendingGroup = signal<{ bindingId: string } | { pathId: string } | null>(null);   // an empty group (or binding) the next chip click fills
```
and in `resetUi`: `activeLayerId.value = null; pendingGroup.value = null;`.

`src/state/history.ts` `clearTransient`: add `pendingGroup.value = null;` (import it from `./ui`).

`src/state/persist.ts`: `type StoredPrefs = { prefs: Prefs; tool: Tool; activeLayerId: string | null; view: View };`; drop `PathLayer` from the import; in `restore` replace the `sublayer` line with `if (s.activeLayerId === null || typeof s.activeLayerId === 'string') UI.activeLayerId.value = s.activeLayerId ?? null;`; in `startAutosave` the prefs object becomes `{ prefs: UI.prefs.value, tool: UI.tool.value, activeLayerId: UI.activeLayerId.value, view: UI.view.value }`. A stored v1 document migrates inside `parseDoc`; the next autosave writes v2 under the same key.

- [ ] **Step 10: `src/actions.ts`**

Import line: drop `PathLayer`. Replace `setSublayer` with nothing (delete it). Replace the block `// --- pen` … `bindNewPath` with:

```ts
// --- layers

export function activeLayerId(d: Doc = doc.value): string { return P.layerIdOr(d, UI.activeLayerId.value); }
export function setActiveLayer(id: string): boolean { if (!doc.value.layers.some((l) => l.id === id)) return false; UI.activeLayerId.value = id; return true; }
export function addLayer(): boolean {
  let id: string | null = null;
  const ok = mutate((d) => { id = P.addLayer(d).id; });
  if (id) UI.activeLayerId.value = id;
  return ok;
}
export function setPathLayer(pathId: string, layerId: string): boolean {
  return mutate((d) => { const p = P.getPath(d, pathId); if (!p || p.layerId === layerId || !d.layers.some((l) => l.id === layerId)) return false; p.layerId = layerId; });
}
export function setFillLayer(fillId: string, layerId: string): boolean {
  return mutate((d) => { const f = P.getFill(d, fillId); if (!f || f.layerId === layerId || !d.layers.some((l) => l.id === layerId)) return false; f.layerId = layerId; });
}

// --- pen

function bindNewPath(d: Doc, pathId: string) { if (d.newPathGroups.length) P.addBinding(d, pathId, d.newPathGroups); }
```
Every `P.startPath(d, node, UI.prefs.value.style, UI.sublayer.value)` (three sites: `penClickEmpty`, `penClickNode`, `finishFreehand`) becomes `P.startPath(d, node, UI.prefs.value.style, activeLayerId(d))`. In `fillAt`: `id = P.addFill(d, seed, color, activeLayerId(d)).id;`.

Delete `togglePathLayer`. Replace the block from `// --- elements, bindings, chains` through `deleteElement` with:

```ts
// --- elements, bindings, groups

const groupKey = (g: string[]) => g.join('>');
const groupsKey = (gs: string[][]) => gs.map(groupKey).join('|');

// O / M / T: the element joins newPathGroups as its own group and, if a path is selected, that path's first binding
// as a new group (created if the path has none).
export function addElement(kind: ElementKind): boolean {
  const pid = UI.selectedPathId();
  let id: string | null = null;
  const ok = mutate((d) => {
    const spec = kind === 'translate' ? { kind, u: 0.5, v: 0.5 } as const
      : kind === 'mirror' ? { kind, u: 0.5, v: 0.5, du: 0, dv: 1 } as const
      : { kind: 'rotate' as const, u: 0.5, v: 0.5, n: 2 };
    const e = P.addElement(d, spec);
    d.newPathGroups.push([e.id]);
    if (pid) { const b = d.bindings.find((x) => x.pathId === pid); if (b) b.groups.push([e.id]); else P.addBinding(d, pid, [[e.id]]); }
    id = e.id;
  });
  if (id) { endPen(); UI.layer.value = 'construction'; UI.selection.value = { kind: 'element', id }; UI.pendingGroup.value = null; }
  return ok;
}
export function setRotationOrder(id: string, n: number): boolean {
  return mutate((d) => { const e = P.getElement(d, id); if (!e || e.kind !== 'rotate' || e.n === n) return false; e.n = n; });
}
export function rotateMirror(id: string, deg: number): boolean {
  return mutate((d) => { const e = P.getElement(d, id); if (!e || e.kind !== 'mirror') return false; const dir = mirrorDirFromAngle(mirrorAngle(e, d.lattice) + deg, d.lattice); e.du = dir.du; e.dv = dir.dv; });
}
export function rotateSelectedElement(deg: number): boolean { const id = UI.selectedElementId(); return id ? rotateMirror(id, deg) : false; }
export function setTranslation(id: string, u: number, v: number): boolean {
  return mutate((d) => { const e = P.getElement(d, id); if (!e || e.kind !== 'translate') return false; e.u = u; e.v = v; });
}
// A single group in newPathGroups ("Apply to new paths" on an element).
export function isNewPathGroup(group: string[]): boolean { const k = groupKey(group); return doc.value.newPathGroups.some((g) => groupKey(g) === k); }
export function toggleNewPathGroup(group: string[]): boolean {
  const k = groupKey(group);
  return mutate((d) => { const i = d.newPathGroups.findIndex((g) => groupKey(g) === k); if (i >= 0) d.newPathGroups.splice(i, 1); else d.newPathGroups.push(group.slice()); });
}
// The whole list (the ★ on a binding row): make new paths get exactly this binding, or nothing if they already do.
export function isNewPathGroups(groups: string[][]): boolean { return groupsKey(groups) === groupsKey(doc.value.newPathGroups); }
export function setNewPathGroups(groups: string[][]): boolean {
  return mutate((d) => { d.newPathGroups = groupsKey(groups) === groupsKey(d.newPathGroups) ? [] : groups.map((g) => g.slice()); });
}
export function placeElementInGroup(bindingId: string, elementId: string, gi: number): boolean {
  const ok = mutate((d) => { if (!P.getBinding(d, bindingId) || !P.getElement(d, elementId)) return false; P.placeInGroup(d, bindingId, elementId, gi); });
  if (ok) UI.pendingGroup.value = null;
  return ok;
}
export function removeElementFromBinding(bindingId: string, elementId: string): boolean {
  const ok = mutate((d) => { const b = P.getBinding(d, bindingId); if (!b || !b.groups.some((g) => g.includes(elementId))) return false; P.removeFromBinding(d, bindingId, elementId); });
  const s = UI.selection.value;
  if (ok && s && s.kind === 'path' && s.copy.bindingId === bindingId && !P.getBinding(doc.value, bindingId)) UI.selection.value = { kind: 'path', id: s.id, copy: baseCopy };
  return ok;
}
export function startGroup(bindingId: string): boolean { UI.pendingGroup.value = { bindingId }; return true; }
export function startChain(pathId: string): boolean { UI.pendingGroup.value = { pathId }; return true; }
export function cancelPending(): boolean { if (!UI.pendingGroup.value) return false; UI.pendingGroup.value = null; return true; }
export function addElementToNewChain(pathId: string, elementId: string): boolean {
  const ok = mutate((d) => { if (!P.getPath(d, pathId) || !P.getElement(d, elementId)) return false; P.addBinding(d, pathId, [[elementId]]); });
  if (ok) UI.pendingGroup.value = null;
  return ok;
}
export function removeBinding(id: string): boolean {
  const ok = mutate((d) => { if (!P.getBinding(d, id)) return false; P.removeBinding(d, id); });
  const s = UI.selection.value;
  if (ok && s && s.kind === 'path' && s.copy.bindingId === id) UI.selection.value = { kind: 'path', id: s.id, copy: baseCopy };
  return ok;
}
export function deleteElement(id: string): boolean {
  const ok = mutate((d) => { if (!P.getElement(d, id)) return false; P.deleteElement(d, id); });
  if (ok && UI.selectedElementId() === id) UI.selection.value = null;
  return ok;
}
```
(`toggleOpOnBinding`, `addChain`, `isNewPathChain`, `toggleNewPathChain` and `chainKey` are gone.) In `selectPathAt`, `selectPoints`, `selectElement`, `selectFill`, `clearSel` and `deleteSelection` add `UI.pendingGroup.value = null;` before returning. `newDocument` and `importDocument` add `UI.activeLayerId.value = null; UI.pendingGroup.value = null;`.

- [ ] **Step 11: Canvas**

`src/components/Canvas.tsx`: `entriesOf` filters nulls: `return [IDENTITY, ...d.bindings.filter((b) => b.pathId === p.id).flatMap((b) => (cm.get(b.id) ?? []).filter((M): M is Matrix => M !== null))];`. Replace `CellDefs` with:

```tsx
// One <g> per layer, bottom to top: that layer's seeded faces, then every source and clone stroke of its paths.
function CellDefs() {
  const d = doc.value, fs = faces.value;
  return (
    <defs>{d.layers.map((l) => {
      const fills = d.fills.filter((f) => f.layerId === l.id).map((f) => ({ f, face: fillFace(fs, f, d.lattice) })).filter((x) => x.face).sort((a, b) => b.face!.area - a.face!.area);
      const strokes = d.paths.filter((p) => p.layerId === l.id).flatMap((p) => {
        const P = pathWorld(d, p), C = pathCpsWorld(d, p);
        return entriesOf(p).map((M, i) => <path key={`${p.id}:${i}`} class="stroke" d={pathD(P.map((q) => apply(M, q)), C.map((c) => c && apply(M, c)))} stroke={p.style.color} stroke-width={p.style.weight} />);
      });
      return <g key={l.id} id={`cell-layer-${l.id}`}>{fills.map(({ f, face }) => <path key={f.id} class="fill" d={facePathData(face!)} fill={f.color} />)}{strokes}</g>;
    })}</defs>
  );
}
```
In `Canvas()` replace the three `<Uses>` with `{doc.value.layers.map((l) => <Uses key={l.id} id={`cell-layer-${l.id}`} />)}`. In `Highlights`, the element-selection branch: `const p = b && b.groups.some((g) => g.includes(sel.id)) ? getPath(d, ci.pathId) : null;`. In `Elements`: `const armed = new Set(d.newPathGroups.flat());`. `getElement` is imported but unused there already (deferred minor) — leave it.

- [ ] **Step 12: Chrome, compile-through only**

`src/components/Chrome.tsx` (Tasks 3 and 4 replace these pieces with the designed controls; here the goal is a working app):
- imports: `import { orbit, cloneCount, mirrorAngle } from '../engine/transform';` and `const orbitOf = (groups: string[][]) => orbit(groups, doc.value.elements, doc.value.lattice, CONFIG.ORBIT_CAP, CONFIG.CLONE_CAP);`
- `chainLabel`: `export function chainLabel(groups: string[][]): string { const one = (g: string[]) => g.map((id) => { const e = getElement(doc.value, id); return e ? elementLabel(e) : '?'; }).join(' → '); return groups.map(one).join(' · then ') || '(empty)'; }`
- `ToolBar`: replace the two Structure / Detail buttons with `<LayerPicker />` where
  ```tsx
  function LayerPicker() {
    const d = doc.value, active = A.activeLayerId(d);
    return <>{d.layers.map((l) => <Btn key={l.id} cls="small" on={l.id === active} title={`New paths and fills go to ${l.name}`} onClick={() => A.setActiveLayer(l.id)}>{l.name}</Btn>)}
      <Btn cls="small outline" title="Add a layer on top and make it active" onClick={() => A.addLayer()}>+ layer</Btn></>;
  }
  ```
- `ElementsBar`: `A.isNewPathChain([e.id])` → `A.isNewPathGroup([e.id])` (both places).
- `ChainRow`: 
  ```tsx
  function ChainRow({ b }: { b: Binding }) {
    const o = orbitOf(b.groups), n = cloneCount(o);
    return <>
      <Label>{chainLabel(b.groups)} · {n} clone{n === 1 ? '' : 's'}{o.open ? ' ⚠' : ''}</Label>
      <Btn cls="small" on={A.isNewPathGroups(b.groups)} title="Give new paths this binding" onClick={() => A.setNewPathGroups(b.groups)}>★</Btn>
      <Btn cls="small" title="Remove this binding" onClick={() => A.removeBinding(b.id)}>✕</Btn>
      <Sep />
    </>;
  }
  ```
- `SelectionBar` path branch: label `… via ${chainLabel(b.groups)} · clone ${s.copy.power}`; "Select its element" uses `b.groups[0]?.[0]`; delete the "+ chain" button and the Below/Above fills button; keep the three "+ ↻ / + ⟋ / + ⇢" buttons.
- Element branch: `const bound = d.bindings.filter((x) => x.groups.some((g) => g.includes(el.id))).length;`; "Apply to new paths": `on={A.isNewPathGroup([el.id])} onClick={() => A.toggleNewPathGroup([el.id])}`; label `· in ${bound} binding${bound > 1 ? 's' : ''}`.
- `Hint`: `const clones = [...cm.values()].reduce((n, ms) => n + cloneCount({ matrices: ms }), 0);`.
- `Help`: the Fill line becomes `<span>Fill: press to preview a closed region, release to colour · fills draw below the lines of their layer; put them on a higher layer to cover lines</span>`; the Elements line ends `… a group applies left to right; a mirror then a half translation is a glide; a "then" group stacks on the clones so far`.

`src/main.tsx` needs no change (it imports nothing removed). Grep the repo for `sublayer`, `newPathOps`, `\.ops\b`, `PathLayer`, `togglePathLayer`, `toggleOpOnBinding`, `addChain`, `isNewPathChain`, `cell-structure`, `cell-fills`, `cell-detail`: every hit must be gone.

- [ ] **Step 13: Actions and remaining test fixtures**

`tests/unit/actions.test.ts`: `bindings[0].ops` → `bindings[0].groups` with expected `[[el.id]]`; `newPathOps` → `newPathGroups`; the test title `'pen: new paths receive newPathOps…'` → `newPathGroups`. Add:

```ts
test('a new path gets one binding holding every new-path group; O on a selected path stacks a group on its binding', () => {
  fresh();
  A.addElement('rotate'); A.addElement('mirror');
  expect(doc.value.newPathGroups).toHaveLength(2);
  A.setTool('pen'); A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.4, 0.1), false); A.endPen();
  expect(doc.value.bindings).toHaveLength(1);
  expect(doc.value.bindings[0].groups).toEqual(doc.value.newPathGroups);
  const path = doc.value.paths[0];
  A.setTool('select'); A.selectPathAt(path.id);
  A.addElement('translate');
  expect(doc.value.bindings).toHaveLength(1);
  expect(doc.value.bindings[0].groups).toHaveLength(3);
  expect(doc.value.bindings[0].groups[2]).toEqual([doc.value.elements[2].id]);
  expect(doc.value.newPathGroups).toHaveLength(3);
});

test('a stale activeLayerId falls back to the top layer; addLayer makes the new layer active; fills and paths land there', () => {
  fresh();
  UI.activeLayerId.value = 'gone';
  expect(A.activeLayerId()).toBe(doc.value.layers[0].id);
  A.addLayer();
  const top = doc.value.layers[1].id;
  expect(UI.activeLayerId.value).toBe(top);
  A.setTool('pen'); A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.4, 0.1), false); A.endPen();
  expect(doc.value.paths[0].layerId).toBe(top);
  A.setPathLayer(doc.value.paths[0].id, doc.value.layers[0].id);
  expect(doc.value.paths[0].layerId).toBe(doc.value.layers[0].id);
  expect(A.setPathLayer(doc.value.paths[0].id, 'nope')).toBe(false);
});

test('group editing actions move an element between groups and clear the pending group', () => {
  fresh();
  A.addElement('mirror'); A.addElement('rotate');
  A.setTool('pen'); A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.4, 0.1), false); A.endPen();
  const b = doc.value.bindings[0], [m, r] = doc.value.elements.map((e) => e.id);
  expect(b.groups).toEqual([[m], [r]]);
  A.startGroup(b.id); expect(UI.pendingGroup.value).toEqual({ bindingId: b.id });
  A.placeElementInGroup(b.id, r, 0);
  expect(doc.value.bindings[0].groups).toEqual([[m, r]]);
  expect(UI.pendingGroup.value).toBe(null);
  A.removeElementFromBinding(b.id, m); A.removeElementFromBinding(b.id, r);
  expect(doc.value.bindings).toHaveLength(0);
  A.setTool('select'); A.selectPathAt(doc.value.paths[0].id); A.startChain(doc.value.paths[0].id);
  A.addElementToNewChain(doc.value.paths[0].id, m);
  expect(doc.value.bindings[0].groups).toEqual([[m]]);
  expect(UI.pendingGroup.value).toBe(null);
});
```
The existing fill tests in that file call `A.fillAt(...)` and read `doc.value.fills` — they need no change. Any test that builds a doc by hand uses `emptyDoc()`.

- [ ] **Step 14: Typecheck, run everything, fix what the compiler finds**

Run: `npx tsc --noEmit -p ~/Developer/personal/tesselator`
Expected: clean. If a site was missed, the compiler names it; fix it in the spirit of the steps above (skip nulls, use groups, pass a layer id).

Run: `npx vitest run --root ~/Developer/personal/tesselator`
Expected: all green (about 105 tests).

- [ ] **Step 15: Commit**

```bash
git -C ~/Developer/personal/tesselator add -A src tests
git -C ~/Developer/personal/tesselator commit -m "$(printf 'Document v2: binding groups and ordered layers, with v1 migration\n\nBindings hold ordered groups whose product is the clone set; paths and\nfills live on ordered layers rendered as one <g> per layer. parseDoc\naccepts v1 and migrates it (one group per chain; Structure / Fills /\nDetail layers). Chrome is brought to parity only; the designed group\nand layer controls follow.\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')"
```

---
### Task 3: Groups in the chrome — clusters, `+ then`, move between groups, `+ chain`

**Files:**
- Modify: `src/components/Chrome.tsx` (`ChainRow`, `SelectionBar` path branch), `src/styles.css`
- Test: none new (chrome has no unit harness); `npx tsc --noEmit` and the Task 2 action tests cover the actions these controls call. The implementer reads the rendered JSX against the spec's §2 "Defaults and construction" and §7 step 2 and lists in the report which control calls which action.

**Interfaces:**
- Consumes: `A.placeElementInGroup`, `A.removeElementFromBinding`, `A.startGroup`, `A.startChain`, `A.addElementToNewChain`, `A.cancelPending`, `A.isNewPathGroups`, `A.setNewPathGroups`, `A.removeBinding`, `UI.pendingGroup`, `chainLabel`, `elementLabel`, `orbitOf`, `cloneCount`.
- Produces: nothing new.

- [ ] **Step 1: Cluster style**

Append to `src/styles.css`:

```css
.group { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border: 1px dashed var(--element); border-radius: 9px; }
.group.pending { border-style: dotted; }
```

- [ ] **Step 2: Replace `ChainRow` and the path branch's chain controls**

In `src/components/Chrome.tsx` add `import { Fragment } from 'preact';` and replace `ChainRow` with:

```tsx
// One cluster per group: every element is a chip; lit = in this group. Clicking a lit chip removes the element from
// the binding; clicking an unlit one moves the element into this group (an element appears at most once per binding).
function GroupCluster({ b, gi, group, pending }: { b: Binding; gi: number; group: string[]; pending?: boolean }) {
  const d = doc.value;
  return <span class={pending ? 'group pending' : 'group'}>
    {d.elements.map((e) => { const here = group.includes(e.id); return <Btn key={e.id} cls="small violet" on={here} title={here ? 'Remove this element from the binding' : gi === b.groups.length ? 'Start the new group with this element' : 'Put this element in this group (moves it out of another group)'} onClick={() => (here ? A.removeElementFromBinding(b.id, e.id) : A.placeElementInGroup(b.id, e.id, gi))}>{elementLabel(e)}</Btn>; })}
    {pending && <Btn cls="small" title="Cancel the new group" onClick={() => A.cancelPending()}>✕</Btn>}
  </span>;
}

function ChainRow({ b }: { b: Binding }) {
  const o = orbitOf(b.groups), n = cloneCount(o), pending = UI.pendingGroup.value;
  const pendingHere = !!pending && 'bindingId' in pending && pending.bindingId === b.id;
  return <>
    <Label>{n} clone{n === 1 ? '' : 's'}{o.open ? ' ⚠' : ''}:</Label>
    {b.groups.map((g, gi) => <Fragment key={gi}>{gi > 0 && <Label>then</Label>}<GroupCluster b={b} gi={gi} group={g} /></Fragment>)}
    {pendingHere
      ? <><Label>then</Label><GroupCluster b={b} gi={b.groups.length} group={[]} pending /></>
      : <Btn cls="small outline" title="Add a group that applies to the source and to every clone so far" onClick={() => A.startGroup(b.id)}>+ then</Btn>}
    <Btn cls="small" on={A.isNewPathGroups(b.groups)} title="Give every new path this binding (★ lit = they get it now)" onClick={() => A.setNewPathGroups(b.groups)}>★</Btn>
    <Btn cls="small" title="Remove this binding and its clones" onClick={() => A.removeBinding(b.id)}>✕</Btn>
    <Sep />
  </>;
}

// "+ chain": a second, independent binding on the path. It exists only once it has an element.
function NewChain({ pathId }: { pathId: string }) {
  const d = doc.value, pending = UI.pendingGroup.value;
  if (!(pending && 'pathId' in pending && pending.pathId === pathId)) return <Btn cls="small outline" title="Start another binding on this path (independent clones)" onClick={() => A.startChain(pathId)}>+ chain</Btn>;
  return <span class="group pending">
    {d.elements.map((e) => <Btn key={e.id} cls="small violet" title="Start the new binding with this element" onClick={() => A.addElementToNewChain(pathId, e.id)}>{elementLabel(e)}</Btn>)}
    <Btn cls="small" title="Cancel the new binding" onClick={() => A.cancelPending()}>✕</Btn>
  </span>;
}
```

In `SelectionBar`'s path branch, after the `ChainRow` list add `<NewChain pathId={path.id} />` (this restores the "+ chain" control Task 2 removed, now safe because a binding is created only with its first element). Keep "+ ↻ / + ⟋ / + ⇢" with titles `"New rotation, stacked as a group on this path's binding"` etc. If the path has no elements at all, `GroupCluster` renders an empty dashed box; hide `+ then` and `+ chain` when `d.elements.length === 0` and show `<Label>add an element with O, M or T</Label>` instead.

- [ ] **Step 3: Typecheck and tests**

Run: `npx tsc --noEmit -p ~/Developer/personal/tesselator && npx vitest run --root ~/Developer/personal/tesselator`
Expected: clean, all green.

- [ ] **Step 4: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/components/Chrome.tsx src/styles.css
git -C ~/Developer/personal/tesselator commit -m "$(printf 'Chrome: group clusters with + then, move-between-groups and + chain\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')"
```

---

### Task 4: Layers in the chrome — picker, `+ layer`, move chips, copy

**Files:**
- Modify: `src/components/Chrome.tsx` (`LayerPicker` placement, `SelectionBar` path and fill branches, `hintText`, `Help`, `Hint` counts)
- Test: none new; `npx tsc --noEmit` and Task 2's layer action tests.

**Interfaces:**
- Consumes: `A.setActiveLayer`, `A.addLayer`, `A.setPathLayer`, `A.setFillLayer`, `A.activeLayerId`.

- [ ] **Step 1: Layer picker and move chips**

Task 2 put `LayerPicker` inside `ToolBar`. Keep it there (the spec puts the picker in the selection bar "on the Drawing layer"; the tool panel is the always-present Drawing-layer bar, so the picker belongs with it), but give the chips a title that names the layer's position: ``title={`${l.name} · layer ${i + 1} of ${d.layers.length} from the bottom · new paths and fills go here`}``.

In `SelectionBar`:
- path branch, after Straighten / Free: `<Sep /><Label>Layer:</Label>{d.layers.map((l) => <Btn key={l.id} cls="small" on={l.id === path.layerId} title={`Move this path to ${l.name}`} onClick={() => A.setPathLayer(path.id, l.id)}>{l.name}</Btn>)}`
- fill branch: replace the single label with
  ```tsx
  const fill = getFill(d, s.id); if (!fill) return null;
  inner = <><Label>Fill · pick a colour in the palette</Label><Sep /><Label>Layer:</Label>{d.layers.map((l) => <Btn key={l.id} cls="small" on={l.id === fill.layerId} title={`Move this fill to ${l.name}`} onClick={() => A.setFillLayer(fill.id, l.id)}>{l.name}</Btn>)}</>;
  ```

- [ ] **Step 2: Copy**

- `hintText` Select/path line: `'Path: click a line to insert a point · drag ◇ to bend · double-click ◇ to straighten · box handles scale and rotate · any copy is editable · Layer chips move it'`.
- `hintText` clone line: `'Clone: drag its body to move the first element of its first group · drag its anchors to edit the shared shape'`.
- `hintText` construction element line for rotation: `'Rotation: drag to move · pick 1/2, 1/3, 1/4 or 1/6 · clones turn about it · O on a selected path stacks it as a new group'`.
- `Help` elements line: `<span class="violet">Elements: drag to move · mirror knob or <K k="[" /> <K k="]" /> rotates · translation diamond sets the vector · a group applies left to right (a mirror then a half translation is a glide) · a "then" group applies to the source and every clone so far</span>`.
- `Help` line for O/M/T: `<span><K k="O" /> rotation · <K k="M" /> mirror · <K k="T" /> translation — stacked as a new group on the selected path's binding, and given to new paths</span>`.
- `Hint` counts: append `· ${pl(d.layers.length, 'layer')}` after fills.

- [ ] **Step 3: Typecheck and tests**

Run: `npx tsc --noEmit -p ~/Developer/personal/tesselator && npx vitest run --root ~/Developer/personal/tesselator`
Expected: clean, all green.

- [ ] **Step 4: Commit**

```bash
git -C ~/Developer/personal/tesselator add src/components/Chrome.tsx
git -C ~/Developer/personal/tesselator commit -m "$(printf 'Chrome: layer picker, + layer, Layer move chips, updated copy\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')"
```

---
### Task 5: Documentation — `CLAUDE.md` and the original spec's pointer

**Files:**
- Modify: `CLAUDE.md` (Model and Architecture sections, Known limitations), `docs/superpowers/specs/2026-09-27-engine-rebuild-design.md` (one paragraph under the title)

- [ ] **Step 1: Point the original spec at the amendment**

Insert directly under the H1 of `docs/superpowers/specs/2026-09-27-engine-rebuild-design.md`:

```markdown
> **Amended 2026-09-28** by `2026-09-28-groups-and-layers-amendment.md`: bindings are ordered lists of element groups (clones = product across groups), layers are generic and ordered (`layers`, `layerId` on paths and fills; the structure / fills / detail sandwich and the `sublayer` pref are gone), and the document is version 2 with v1 migration. Where the two disagree, the amendment wins.
```

- [ ] **Step 2: Update `CLAUDE.md`**

Replace the "Model (all lattice coordinates)" bullets for Paths, Elements, Bindings and Fills with:

```markdown
- **Paths** are `{ start, segments: [{ to, cp }] }`. `cp` is a quadratic control point relative to the previous node's cell origin. Closed = last node is the start node in the same cell. `layerId` names the document layer the path is on.
- **Layers** (`doc.layers`, bottom to top) are `{ id, name }`. Paths and fills belong to one layer; within a layer fills draw below strokes. New paths and fills go to the active layer (`UI.activeLayerId`, persisted; falls back to the top layer). Region detection uses every path on every layer.
- **Elements** are the three primitive isometries: `translate {u, v}`, `mirror {u, v, du, dv}` (centre and lattice direction), `rotate {u, v, n}` (1/n turn). There is no glide kind: a glide is a group `[mirror, translate]`. The lattice is not an element.
- **Bindings** `{ pathId, groups: string[][] }` are ordered lists of groups. A group composes its elements left to right; its own clones are the powers of that composite up to the first lattice translation (cap 12, `open` past it). The binding's clones are the product across groups: `orbit()` in `src/engine/transform.ts` returns `matrices[i]` for clone index `i + 1` (mixed-radix over the groups, stable when a group is appended) or `null` for a clone that coincides with the source or a lower index modulo the lattice; truncated at `CLONE_CAP` (48). Every consumer skips nulls. `doc.newPathGroups` is the binding every new path receives; `O` / `M` / `T` append a one-element group to it and to the selected path's first binding.
- **Fills** are seed points with a `layerId`; `src/engine/regions.ts` builds a planar arrangement of every copy in the 3×3 window and each seed paints the face containing it (faces carry holes; even-odd rendering). Seeds are placed at the face centroid when it lies inside. A region is identified across its window copies by `sameRegion`.
- **Copies.** Everything on screen is a `Copy { cell, bindingId, power }` of a path with matrix `cellMatrix ∘ cloneMatrix`; `power` is the clone index. Selection carries the copy the user clicked; handles render there and edits map back through the copy's inverse.
```

In "Architecture", the Canvas bullet becomes: `src/components/Canvas.tsx` renders the base cell once into `<defs>` as one `<g id="cell-layer-<id>">` per layer (that layer's faces, then its source and clone strokes) and places one `<use>` per layer per visible cell; overlays are drawn at the selected copy. `src/components/Chrome.tsx` is the floating chrome (group clusters with `+ then`, layer picker with `+ layer`).

In "Architecture", the persistence sentence gains: `src/engine/serialize.ts` accepts document versions 1 and 2 and migrates v1 on load and import (`migrateV1`: one group per old chain; layers Structure / Fills / Detail).

"Known limitations": add `- Clone-body drags move the first element of the first group; with later non-translation groups the copy follows in the transformed frame.` and `- Layer rename, reorder, hide and lock are not in this chrome (Project 2).` Remove nothing else.

- [ ] **Step 3: Check and commit**

Run: `npx tsc --noEmit -p ~/Developer/personal/tesselator && npx vitest run --root ~/Developer/personal/tesselator` (nothing changed in code; this confirms the tree is still green at the commit).

```bash
git -C ~/Developer/personal/tesselator add CLAUDE.md docs/superpowers/specs/2026-09-27-engine-rebuild-design.md
git -C ~/Developer/personal/tesselator commit -m "$(printf 'Docs: describe binding groups and layers; point the spec at the amendment\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')"
```

---

## Self-review

**Spec coverage.** §2 groups semantics, index, dedup, cap, null convention, one-group parity → Task 1. Defaults and construction (O/M/T stacking, "Apply to new paths", new path gets one binding) → Task 2 actions. Drags (first element of the first group; Space-drag) → Task 2 tools. Migration → Task 2 serialize. §3 layers model, active layer, region detection over all layers, one-layer new doc, two-layer demo, `sublayer` removed → Task 2. Layer UI → Tasks 2 (picker) and 4 (move chips, copy). Rendering per layer and export → Task 2. §4 persistence and validation → Task 2. §5 tests: transform table → Task 1; paths deletion / move / new path → Task 2; serialize fish migration, round-trip, clone count, bad layerId → Task 2 (`migrate.test.ts`); regions layer independence → Task 2; rendering defs per layer → Task 2 serialize test (the SVG export shares the per-layer structure with Canvas; the Canvas component itself has no unit harness). §7 order followed. 

**Placeholders.** None; every step carries its code or the exact edit.

**Type consistency.** `orbit(groups, elements, lat, ownCap, cloneCap)` and `Orbit` (Task 1) are used with those names in paths, derived, hit, regions, serialize, freehand and Chrome (Task 2). `placeInGroup(doc, bindingId, elementId, gi)` / `removeFromBinding` (paths) ↔ `placeElementInGroup` / `removeElementFromBinding` (actions) ↔ `GroupCluster` (Task 3). `UI.pendingGroup` shape `{ bindingId } | { pathId } | null` matches `startGroup`, `startChain`, `ChainRow`, `NewChain`. `addFill(doc, uv, color, layerId)` and `startPath(doc, node, style, layerId)` are used with four arguments everywhere. `DocLayer` is the document layer type; `Layer` remains the UI mode.

**Review Focus.** Each line names its pinning test: 1 → `migrate.test.ts` "migration drops empty chains"; 2 → Task 1 table rows; 3 → `actions.test.ts` "a stale activeLayerId…"; 4 → `migrate.test.ts` "migration keeps every clone"; 5 → `paths.test.ts` "placeInGroup / removeFromBinding never leave an empty group".
