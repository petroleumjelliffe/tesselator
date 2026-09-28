# Engine Rebuild (Project 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the tessellation editor from scratch around a lattice, three primitive symmetry elements composed into bindings, wrapping paths, computed clones, and seed-based region fills, at interaction parity with the v2 prototype.

**Architecture:** One mutable `state` object; every handler mutates it and calls `render()`, which clears the SVG and rebuilds it, then rebuilds the HTML chrome. Pure modules (`lattice`, `transform`, `paths`, `hit`, `freehand`, `regions`) take a `doc` argument and never touch the DOM, so they run under `node --test`. Pointer handling is one delegated listener set on the SVG that dispatches on `data-kind` attributes to per-tool modules.

**Tech Stack:** Vanilla JavaScript ES modules, SVG, CSS custom properties. No build step, no runtime dependencies. Tests use Node's built-in `node:test` and `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-09-27-engine-rebuild-design.md`

## Global Constraints

- No runtime dependencies and no build step. `package.json` has no `dependencies` or `devDependencies`.
- Only `index.html`, `styles.css`, `js/**` are live app code. Tests live in `tests/`.
- Serve with `python3 -m http.server 5173 --bind 127.0.0.1` and open `http://127.0.0.1:5173/`. Hard-refresh after edits.
- All document entities use string ids from `makeId()`; never array indices.
- Points are cell-local; control points and fill seeds are world coordinates in the base-cell frame; `cps.length === nodes.length - 1` always.
- Matrices are `[a, b, c, d, e, f]` with `x' = a·x + c·y + e`, `y' = b·x + d·y + f` (SVG order). `compose(A, B)` applies B then A.
- Hit thresholds and handle sizes in `config.js` are screen pixels; divide by `state.view.zoom` in world space.
- History: `push()` before every discrete mutation, `beginDrag()` on a gesture's first movement, never for pan/zoom.
- Palette: background `#f4f2ec`, ink `#1c1b18`, accent `#3b6fd1`, elements `#7048e8`, lattice `#c2255c`, muted `#7a766c`, grid `#e2dfd5`, frame `#b9b5aa`.
- Every chrome control is a `<button>` with a `title` and at least 36 px hit height.
- Commit after every task with a message ending in `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **Coincident edges** (a path lying on its own mirror line or on a cell edge, so its clone or lattice copy duplicates it) must not produce zero-area faces or lose fills. Test in Task 7: duplicate edges are deduplicated.
2. **An empty binding chain** (`ops: []`) must yield zero clones, not an identity clone drawn on top of the source. Test in Task 3: `orbit([])` returns no matrices.
3. **A skewed lattice** must snap in lattice coordinates, not screen axes: on the rhombus preset a grid snap lands on `u, v` multiples. Test in Task 2.
4. **A fill seed outside every region, or exactly on an edge,** must render nothing and never throw. Test in Task 7: `faceAt` returns `null` for an outside point.
5. **Deleting a point that appears twice in one path** (a closed path's first/last node) must remove both occurrences and keep `cps` in sync. Test in Task 4.

## File structure

```
package.json                  scripts only, no deps
index.html                    SVG canvas + chrome container + module script
styles.css                    tokens, panels, buttons, SVG element classes
js/ids.js                     makeId()
js/config.js                  constants, colours, presets, swatches
js/state.js                   state object + selectors
js/lattice.js                 pure: basis maths, cells, snapping
js/transform.js               pure: matrices, element matrices, orbit, classify
js/paths.js                   pure: doc mutations for points/paths/elements/bindings/fills
js/hit.js                     pure: anchors, snapping, marquee, bbox maths
js/freehand.js                pure: RDP + quadratic fit
js/regions.js                 pure: planar arrangement → faces, faceAt, facePathData
js/history.js                 snapshot undo/redo over state
js/actions.js                 user-level mutations (push history, mutate, return bool)
js/render.js                  SVG rebuild
js/ui.js                      chrome rebuild + click delegation
js/interaction.js             pointer/keyboard/wheel core, dispatches to tools
js/tools/select.js            select tool + shared point/segment/cp drags
js/tools/pen.js               pen tool
js/tools/construct.js         construction layer: elements, lattice, clone body drags
js/tools/freehand.js          freehand tool
js/tools/fill.js              fill tool
js/example.js                 demo document (loaded with #example)
js/main.js                    boot
tests/*.test.js               one file per pure module + history
```

The spec lists `interaction.js` as one file; this plan splits the per-tool handlers into `js/tools/*.js` with a fixed interface (`onDown(hit, w, e, ctx)`, `onMove(drag, w, e, ctx)`, `onUp(drag, w, e, ctx)`) so each file stays small. Everything else follows the spec's module table.

---

### Task 1: Clean slate and scaffolding

**Files:**
- Delete: `geometry.js`, `state.js`, `transforms.js`, `styles.css`, `tessellation_editor_phase3_delete.html`, `FEATURE_SPEC.md`, `js/*` (all of it)
- Create: `package.json`, `index.html`, `styles.css`, `js/ids.js`, `js/config.js`, `js/state.js`, `js/main.js`, `tests/state.test.js`

**Interfaces:**
- Produces: `makeId(prefix?) → string`; `CONFIG` constants (names below); `state` object and selectors `getPoint(id)`, `getPath(id)`, `getElement(id)`, `getBinding(id)`, `getFill(id)`, `clearSelection()`, `selectedPathId()`, `selectedElementId()`.

- [ ] **Step 1: Delete the old code**

```bash
git rm -q geometry.js state.js transforms.js styles.css tessellation_editor_phase3_delete.html FEATURE_SPEC.md js/*.js
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "tesselator",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/",
    "serve": "python3 -m http.server 5173 --bind 127.0.0.1"
  }
}
```

- [ ] **Step 3: Create `js/ids.js`**

```js
// Stable string ids for document entities. Never use array indices as identity.
let counter = 0;
export function makeId(prefix = 'id') {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}
```

- [ ] **Step 4: Create `js/config.js`**

```js
export const CONFIG = {
  // screen-space pixels; divide by state.view.zoom in world space
  SNAP_PX: 12,
  DRAG_THRESHOLD_PX: 3,
  POINT_RADIUS: 6,
  HANDLE_SIZE: 8,
  HIT_WIDTH: 14,
  BBOX_ROT_OFFSET: 26,
  ELEMENT_ROT_OFFSET: 70,

  ZOOM_MIN: 0.2,
  ZOOM_MAX: 8,
  MAX_HISTORY: 50,
  ORBIT_CAP: 12,
  MIN_LATTICE_DET: 400,
  VISIBLE_CELL_RADIUS: 3,
  GRID_DIVISIONS: 8,
  GHOST_OPACITY: 0.45,
  FREEHAND_EPS: 5,
  FREEHAND_MIN_DEVIATION: 2.5,

  COLORS: {
    background: '#f4f2ec',
    ink: '#1c1b18',
    muted: '#7a766c',
    grid: '#e2dfd5',
    frame: '#b9b5aa',
    accent: '#3b6fd1',
    element: '#7048e8',
    lattice: '#c2255c',
  },

  SWATCHES: [
    ['Ink', '#1c1b18'], ['Red', '#c2255c'], ['Blue', '#1c7ed6'],
    ['Green', '#2b8a3e'], ['Ochre', '#c98a12'], ['Violet', '#7048e8'],
  ],
  WEIGHTS: [1, 2, 3.5, 6, 10],

  LATTICE_PRESETS: {
    Square: { ax: 240, ay: 0, bx: 0, by: 240 },
    Rectangle: { ax: 300, ay: 0, bx: 0, by: 200 },
    Parallelogram: { ax: 240, ay: 0, bx: 100, by: 220 },
    'Rhombus 60°': { ax: 240, ay: 0, bx: 120, by: 207.85 },
    'Hex / triangle': { ax: 240, ay: 0, bx: -120, by: 207.85 },
  },
};
```

- [ ] **Step 5: Create `js/state.js`**

```js
import { CONFIG } from './config.js';

// The whole application state. Handlers mutate it directly, then call render().
// Document keys (in history): lattice, points, paths, elements, bindings, fills, newPathOps.
export const state = {
  lattice: { ...CONFIG.LATTICE_PRESETS.Square },
  points: [],     // [{ id, x, y }] cell-local
  paths: [],      // [{ id, nodes: [{ pointId, cell: {c, r} }], cps: [{x,y}|null], style: {color, weight}, layer }]
  elements: [],   // [{ id, kind: 'translate', u, v } | { id, kind: 'mirror', cx, cy, angle } | { id, kind: 'rotate', cx, cy, n }]
  bindings: [],   // [{ id, pathId, ops: [elementId] }]
  fills: [],      // [{ id, x, y, color }] seed in base-cell world frame
  newPathOps: [], // [[elementId, ...], ...] chains applied to every new path

  layer: 'drawing',        // 'drawing' | 'construction'
  sublayer: 'structure',   // 'structure' | 'detail' for new paths
  tool: 'pen',             // 'select' | 'pen' | 'freehand' | 'fill'
  pen: null,               // { pathId } while a path is being extended
  selection: null,         // see spec §3
  hover: null,             // pointId under the pointer
  hoverPoint: null,        // world point under the pointer (Fill tool)
  drag: null,              // { kind, hit, start, moved, ... }
  cursor: null,            // world point for the pen rubber band
  space: false,

  view: { pan: { x: 0, y: 0 }, zoom: 1 },
  viewport: { width: 0, height: 0 },

  style: { color: '#1c1b18', weight: 2 },
  fillColor: '#c2255c',
  snap: true,
  gridDivisions: CONFIG.GRID_DIVISIONS,
  ghostOpacity: CONFIG.GHOST_OPACITY,
  showHelp: false,
};

export const DOC_KEYS = ['lattice', 'points', 'paths', 'elements', 'bindings', 'fills', 'newPathOps'];

export function getPoint(id) { return state.points.find((p) => p.id === id) || null; }
export function getPath(id) { return state.paths.find((p) => p.id === id) || null; }
export function getElement(id) { return state.elements.find((e) => e.id === id) || null; }
export function getBinding(id) { return state.bindings.find((b) => b.id === id) || null; }
export function getFill(id) { return state.fills.find((f) => f.id === id) || null; }

export function clearSelection() { state.selection = null; }

// The path a selection refers to: the path itself, or a clone's source path.
export function selectedPathId() {
  const s = state.selection;
  if (!s) return null;
  if (s.kind === 'path') return s.id;
  if (s.kind === 'clone') { const b = getBinding(s.bindingId); return b ? b.pathId : null; }
  return null;
}

// The element a selection refers to: the element itself, or a clone's first op.
export function selectedElementId() {
  const s = state.selection;
  if (!s) return null;
  if (s.kind === 'element') return s.id;
  if (s.kind === 'clone') { const b = getBinding(s.bindingId); return b && b.ops.length ? b.ops[0] : null; }
  return null;
}

export function selectedPointIds() {
  const s = state.selection;
  return s && s.kind === 'points' ? s.ids : [];
}
```

- [ ] **Step 6: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tessellator</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<svg id="canvas" xmlns="http://www.w3.org/2000/svg"></svg>
<div id="chrome"></div>
<script type="module" src="js/main.js"></script>
</body>
</html>
```

- [ ] **Step 7: Create `styles.css`**

```css
:root {
  --bg: #f4f2ec; --ink: #1c1b18; --muted: #7a766c; --grid: #e2dfd5; --frame: #b9b5aa;
  --accent: #3b6fd1; --element: #7048e8; --lattice: #c2255c; --panel-border: #d8d4c9;
  --shadow: 0 2px 8px rgba(28, 27, 24, 0.08);
}
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--ink);
  font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; overflow: hidden; }
#canvas { position: fixed; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; user-select: none; }
#chrome { position: fixed; inset: 0; pointer-events: none; }
#chrome > * { pointer-events: auto; }

/* panels + controls */
.panel { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 4px; background: #fff;
  border: 1px solid var(--panel-border); border-radius: 10px; box-shadow: var(--shadow); }
.panel.bar { padding: 6px 8px; gap: 6px; }
.panel .label { font-size: 12px; color: var(--muted); margin: 0 2px; }
.btn { min-height: 36px; padding: 0 12px; border: 1px solid transparent; border-radius: 8px; background: #fff;
  color: var(--ink); font: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.btn:hover { background: #f1eee6; }
.btn.on { background: var(--ink); color: #fff; }
.btn.outline { border-color: var(--panel-border); }
.btn.violet { border-color: var(--element); color: var(--element); }
.btn.violet.on { background: var(--element); color: #fff; }
.btn.small { font-size: 12px; padding: 0 10px; }
.btn.icon { width: 40px; padding: 0; justify-content: center; font-size: 18px; }
.btn:disabled { opacity: 0.3; cursor: default; }
.btn.warn::after { content: '⚠'; margin-left: 4px; }
.kbd { font: 11px ui-monospace, Menlo, monospace; border: 1px solid currentColor; border-radius: 3px; padding: 0 4px; opacity: 0.7; }
.sep { width: 1px; height: 24px; background: var(--panel-border); margin: 0 4px; }
.swatch { width: 40px; height: 36px; border: 0; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; }
.swatch span { display: block; width: 20px; height: 20px; border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,0.12); }
.swatch.on span { box-shadow: 0 0 0 2px #fff, 0 0 0 3.5px var(--ink); }
.weight { width: 24px; height: 36px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; }
.weight.on { background: #efece4; }
.weight span { display: block; width: 16px; border-radius: 99px; }

.top-left { position: absolute; left: 16px; top: 12px; max-width: calc(100% - 90px); display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; }
.bottom-left { position: absolute; left: 16px; bottom: 12px; display: flex; flex-direction: column; gap: 8px; }
.palette { display: flex; flex-direction: column; gap: 6px; padding: 8px; }
.palette .title { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); padding-left: 2px; }
.palette .grid { display: grid; grid-template-columns: repeat(3, 40px); gap: 2px; }
.palette .rule { height: 1px; background: var(--panel-border); }
.palette .row { display: flex; gap: 2px; }
.hint { position: absolute; left: 132px; right: 16px; bottom: 12px; min-height: 54px; display: flex; justify-content: space-between;
  align-items: center; gap: 24px; color: var(--muted); pointer-events: none; }
.hint .text { flex: 1; min-width: 0; font-size: 13px; }
.hint .counts { flex: none; font-size: 12px; white-space: nowrap; }
.top-right { position: absolute; right: 16px; top: 12px; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.help { width: 280px; padding: 12px 14px; background: #fff; border: 1px solid var(--panel-border); border-radius: 10px;
  box-shadow: var(--shadow); font-size: 12px; line-height: 1.5; display: flex; flex-direction: column; gap: 4px; }
.help .violet { color: var(--element); }
.preset svg { flex: none; }

/* SVG classes. Strokes on paths are world units; everything else is screen-constant. */
.grid-line { stroke: var(--grid); stroke-width: 1; vector-effect: non-scaling-stroke; pointer-events: none; }
.frame { fill: none; stroke: var(--frame); stroke-width: 1; stroke-dasharray: 6 5; vector-effect: non-scaling-stroke; pointer-events: none; }
.frame.base { stroke: var(--ink); stroke-width: 1.5; }
.el-ghost { fill: none; stroke: var(--element); stroke-width: 1; stroke-dasharray: 6 5; opacity: 0.22; vector-effect: non-scaling-stroke; pointer-events: none; }
.stroke { fill: none; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.halo { fill: none; stroke: var(--accent); stroke-linecap: round; pointer-events: none; }
.seg-hit { fill: none; stroke: transparent; cursor: pointer; }
.seg-hit:hover { stroke: rgba(59, 111, 209, 0.18); }
.guide { stroke: var(--accent); stroke-width: 1; stroke-dasharray: 2 3; opacity: 0.7; vector-effect: non-scaling-stroke; pointer-events: none; }
.rubber { stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 4 4; vector-effect: non-scaling-stroke; pointer-events: none; }
.marquee { fill: rgba(59, 111, 209, 0.08); stroke: var(--accent); stroke-width: 1; stroke-dasharray: 4 3; vector-effect: non-scaling-stroke; pointer-events: none; }
.bbox { fill: none; stroke: var(--accent); stroke-width: 1; stroke-dasharray: 4 3; vector-effect: non-scaling-stroke; pointer-events: none; }
.bbox.ghost { stroke-dasharray: 3 4; opacity: 0.35; }
.handle { fill: #fff; stroke: var(--accent); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.handle:hover { fill: #e6edfa; stroke-width: 2.5; }
.diamond { stroke: var(--accent); stroke-width: 1.5; vector-effect: non-scaling-stroke; cursor: grab; }
.diamond:hover { stroke-width: 2.5; }
.pt { fill: var(--bg); stroke: var(--ink); stroke-width: 1.5; vector-effect: non-scaling-stroke; cursor: pointer; }
.pt:hover, .pt.hover { stroke: var(--accent); stroke-width: 2.5; }
.pt.sel { fill: var(--accent); stroke: var(--accent); }
.pt.dim { fill: var(--bg); stroke: #9c988c; }
.canchor { fill: var(--bg); stroke: #9c988c; stroke-width: 1.5; vector-effect: non-scaling-stroke; cursor: pointer; }
.canchor.sel { fill: #e6edfa; stroke: var(--accent); }
.canchor:hover { stroke: var(--accent); stroke-width: 2.5; }
.el-line { stroke: var(--element); stroke-dasharray: 10 6; vector-effect: non-scaling-stroke; pointer-events: none; }
.el-hit { stroke: transparent; cursor: move; }
.el-hit:hover { stroke: rgba(112, 72, 232, 0.12); }
.el-mark { fill: #fff; stroke: var(--element); stroke-width: 1.5; vector-effect: non-scaling-stroke; cursor: move; }
.el-mark.armed { fill: #efe9fb; }
.el-mark:hover { fill: #efe9fb; stroke-width: 2.5; }
.el-cross { stroke: var(--element); stroke-width: 1; vector-effect: non-scaling-stroke; pointer-events: none; }
.el-knob { fill: #fff; stroke: var(--element); stroke-width: 1.5; vector-effect: non-scaling-stroke; cursor: grab; }
.el-knob:hover { fill: #efe9fb; stroke-width: 2.5; }
.el-arrow { stroke: var(--element); stroke-width: 2; vector-effect: non-scaling-stroke; pointer-events: none; }
.el-label { fill: var(--element); font-size: 11px; pointer-events: none; }
.lat-line { stroke: var(--lattice); stroke-width: 1; stroke-dasharray: 2 3; opacity: 0.6; vector-effect: non-scaling-stroke; pointer-events: none; }
.lat-handle { fill: #fff; stroke: var(--lattice); stroke-width: 1.5; vector-effect: non-scaling-stroke; cursor: move; }
.lat-handle:hover { fill: #fbe7ee; stroke-width: 2.5; }
.lat-label { fill: var(--lattice); font-size: 11px; font-style: italic; pointer-events: none; }
.fill { stroke: none; }
.fill.hit { cursor: pointer; }
.fill-hover { fill: var(--accent); opacity: 0.25; pointer-events: none; }
.free { fill: none; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.inactive-layer { opacity: 0.45; }
```

- [ ] **Step 8: Create a placeholder `js/main.js`**

```js
import { state } from './state.js';
console.log('tessellator booting', state.lattice);
```

- [ ] **Step 9: Write `tests/state.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, DOC_KEYS, getPath, selectedPathId, clearSelection } from '../js/state.js';
import { makeId } from '../js/ids.js';

test('state starts on the square lattice with empty document arrays', () => {
  assert.equal(state.lattice.ax, 240);
  for (const k of ['points', 'paths', 'elements', 'bindings', 'fills', 'newPathOps']) assert.deepEqual(state[k], []);
  assert.equal(DOC_KEYS.length, 7);
});

test('makeId returns unique strings', () => {
  const a = makeId('p'), b = makeId('p');
  assert.notEqual(a, b);
  assert.match(a, /^p_/);
});

test('selectedPathId resolves a clone to its source path', () => {
  state.paths.push({ id: 'pA', nodes: [], cps: [], style: {}, layer: 'structure' });
  state.bindings.push({ id: 'bA', pathId: 'pA', ops: [] });
  state.selection = { kind: 'clone', bindingId: 'bA', power: 1 };
  assert.equal(selectedPathId(), 'pA');
  assert.equal(getPath('pA').id, 'pA');
  clearSelection();
  assert.equal(selectedPathId(), null);
  state.paths.length = 0; state.bindings.length = 0;
});
```

- [ ] **Step 10: Run the tests**

Run: `npm test`
Expected: 3 passing.

- [ ] **Step 11: Serve and check the shell loads**

Run: `npm run serve` in the background, open `http://127.0.0.1:5173/`. The page is a blank warm background with no console errors and the boot log line.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "Clean slate: remove subtile editor, add scaffolding and state

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Lattice maths

**Files:**
- Create: `js/lattice.js`, `tests/lattice.test.js`

**Interfaces:**
- Produces: `toWorld({c, r}, lat) → {x, y}`, `toUV({x, y}, lat) → {u, v}`, `fromUV(u, v, lat) → {x, y}`, `cellOf({x, y}, lat) → {c, r, local: {x, y}}`, `windowOffsets() → [{c, r}]` (9, row-major, `[4]` is the base cell), `visibleOffsets(view, lat, width, height, radius) → [{c, r}]` (always includes `{0,0}`), `snapToGrid(p, lat, div)`, `snapToFraction(p, lat, div)`, `stepAlong(dir, lat, div) → number`, `isDegenerate(lat, min) → boolean`.

- [ ] **Step 1: Write `tests/lattice.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toWorld, toUV, fromUV, cellOf, windowOffsets, visibleOffsets, snapToGrid, snapToFraction, stepAlong, isDegenerate } from '../js/lattice.js';
import { CONFIG } from '../js/config.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('toUV/fromUV round-trip on every preset', () => {
  for (const lat of Object.values(CONFIG.LATTICE_PRESETS)) {
    const p = { x: 37.5, y: -91.25 };
    const { u, v } = toUV(p, lat);
    const q = fromUV(u, v, lat);
    close(q.x, p.x); close(q.y, p.y);
  }
});

test('toWorld places cell (1,1) at a + b', () => {
  const lat = CONFIG.LATTICE_PRESETS['Rhombus 60°'];
  const w = toWorld({ c: 1, r: 1 }, lat);
  close(w.x, 360); close(w.y, 207.85);
});

test('cellOf returns the cell and the cell-local remainder', () => {
  const lat = CONFIG.LATTICE_PRESETS.Square;
  const c = cellOf({ x: 250, y: -10 }, lat);
  assert.equal(c.c, 1); assert.equal(c.r, -1);
  close(c.local.x, 10); close(c.local.y, 230);
  const b = cellOf({ x: 240, y: 240 }, lat); // exactly on a corner belongs to the next cell
  assert.equal(b.c, 1); assert.equal(b.r, 1); close(b.local.x, 0); close(b.local.y, 0);
});

test('windowOffsets is the 3x3 neighbourhood with the base cell at index 4', () => {
  const w = windowOffsets();
  assert.equal(w.length, 9);
  assert.deepEqual(w[4], { c: 0, r: 0 });
  assert.deepEqual(w[0], { c: -1, r: -1 });
});

test('visibleOffsets covers the viewport, is clamped, and always includes the base cell', () => {
  const lat = CONFIG.LATTICE_PRESETS.Square;
  const far = visibleOffsets({ pan: { x: -5000, y: -5000 }, zoom: 1 }, lat, 100, 100, 3);
  assert.ok(far.some((o) => o.c === 0 && o.r === 0));
  const wide = visibleOffsets({ pan: { x: 1200, y: 1200 }, zoom: 0.1 }, lat, 2400, 2400, 3);
  assert.ok(wide.every((o) => Math.abs(o.c) <= 3 && Math.abs(o.r) <= 3));
  assert.equal(wide.length, 49);
});

test('snapToGrid rounds in lattice coordinates on a skewed lattice', () => {
  const lat = CONFIG.LATTICE_PRESETS['Rhombus 60°'];
  const p = fromUV(0.51, 0.24, lat);
  const s = toUV(snapToGrid(p, lat, 8), lat);
  close(s.u, 0.5); close(s.v, 0.25);
});

test('snapToFraction reaches thirds when the grid is eighths', () => {
  const lat = CONFIG.LATTICE_PRESETS.Square;
  const p = fromUV(0.34, 0.0, lat);
  const s = toUV(snapToFraction(p, lat, 8), lat);
  close(s.u, 1 / 3); close(s.v, 0);
});

test('stepAlong measures the grid step along a direction', () => {
  const lat = CONFIG.LATTICE_PRESETS.Square;
  close(stepAlong({ x: 1, y: 0 }, lat, 8), 30);
  close(stepAlong({ x: 0, y: 1 }, lat, 8), 30);
});

test('isDegenerate rejects a collapsed lattice', () => {
  assert.equal(isDegenerate({ ax: 240, ay: 0, bx: 240, by: 1 }), true);
  assert.equal(isDegenerate(CONFIG.LATTICE_PRESETS.Square), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/lattice.test.js`
Expected: FAIL, cannot find module `js/lattice.js`.

- [ ] **Step 3: Create `js/lattice.js`**

```js
// Lattice maths. A lattice is two world-space vectors a = (ax, ay), b = (bx, by).
// (u, v) are lattice coordinates: p = u·a + v·b. A cell is the parallelogram [c, c+1) × [r, r+1).

export function toWorld(cell, lat) {
  return { x: cell.c * lat.ax + cell.r * lat.bx, y: cell.c * lat.ay + cell.r * lat.by };
}

export function toUV(p, lat) {
  const det = lat.ax * lat.by - lat.bx * lat.ay || 1;
  return { u: (p.x * lat.by - p.y * lat.bx) / det, v: (-p.x * lat.ay + p.y * lat.ax) / det };
}

export function fromUV(u, v, lat) {
  return { x: u * lat.ax + v * lat.bx, y: u * lat.ay + v * lat.by };
}

export function cellOf(p, lat) {
  const { u, v } = toUV(p, lat);
  const c = Math.floor(u + 1e-9), r = Math.floor(v + 1e-9);
  const o = toWorld({ c, r }, lat);
  return { c, r, local: { x: p.x - o.x, y: p.y - o.y } };
}

export function windowOffsets() {
  const out = [];
  for (let r = -1; r <= 1; r++) for (let c = -1; c <= 1; c++) out.push({ c, r });
  return out;
}

// Cell offsets whose parallelogram may intersect the viewport, clamped to ±radius.
export function visibleOffsets(view, lat, width, height, radius = 3) {
  const corners = [[0, 0], [width, 0], [0, height], [width, height]].map(([sx, sy]) =>
    toUV({ x: (sx - view.pan.x) / view.zoom, y: (sy - view.pan.y) / view.zoom }, lat));
  const us = corners.map((k) => k.u), vs = corners.map((k) => k.v);
  const c0 = Math.max(-radius, Math.floor(Math.min(...us)) - 1), c1 = Math.min(radius, Math.floor(Math.max(...us)) + 1);
  const r0 = Math.max(-radius, Math.floor(Math.min(...vs)) - 1), r1 = Math.min(radius, Math.floor(Math.max(...vs)) + 1);
  const out = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push({ c, r });
  if (!out.some((o) => o.c === 0 && o.r === 0)) out.push({ c: 0, r: 0 });
  return out;
}

export function snapToGrid(p, lat, div) {
  const { u, v } = toUV(p, lat);
  return fromUV(Math.round(u * div) / div, Math.round(v * div) / div, lat);
}

// The finer of the grid and twelfths, so 1/2, 1/3, 1/4 and 1/6 are always reachable.
export function snapToFraction(p, lat, div) {
  const a = snapToGrid(p, lat, div), b = snapToGrid(p, lat, 12);
  const da = Math.hypot(a.x - p.x, a.y - p.y), db = Math.hypot(b.x - p.x, b.y - p.y);
  return da <= db ? a : b;
}

// Grid step measured along a unit direction (used for glide-like snapping along a line).
export function stepAlong(dir, lat, div) {
  const pa = Math.abs(lat.ax * dir.x + lat.ay * dir.y), pb = Math.abs(lat.bx * dir.x + lat.by * dir.y);
  return Math.max(pa, pb) / div || 10;
}

export function isDegenerate(lat, min = 400) {
  return Math.abs(lat.ax * lat.by - lat.bx * lat.ay) < min;
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/lattice.test.js`
Expected: all pass. If `visibleOffsets` length differs from 49, check the ±1 padding and the clamp.

- [ ] **Step 5: Commit**

```bash
git add js/lattice.js tests/lattice.test.js
git commit -m "Add lattice maths with tests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Transforms, element matrices, orbits

**Files:**
- Create: `js/transform.js`, `tests/transform.test.js`

**Interfaces:**
- Consumes: `toUV` from `lattice.js`.
- Produces: `IDENTITY`, `translation(dx, dy)`, `rotation(theta, cx, cy)`, `reflection(angleDeg, cx, cy)`, `compose(A, B)`, `invert(M)`, `apply(M, p)`, `power(M, k)`, `cellMatrix(c, r, lat)`, `matrixOf(element, lat)`, `isLatticeTranslation(M, lat, eps)`, `composite(ops, elements, lat)`, `orbit(ops, elements, lat, cap) → { matrices: [M¹…], open }`, `classify(M) → { kind, ... }`, `toSvg(M) → 'matrix(a b c d e f)'`.

- [ ] **Step 1: Write `tests/transform.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY, translation, rotation, reflection, compose, invert, apply, power, cellMatrix, matrixOf, isLatticeTranslation, composite, orbit, classify, toSvg } from '../js/transform.js';
import { CONFIG } from '../js/config.js';

const lat = CONFIG.LATTICE_PRESETS.Square;
const hex = CONFIG.LATTICE_PRESETS['Hex / triangle'];
const near = (p, q, eps = 1e-6) => assert.ok(Math.abs(p.x - q.x) < eps && Math.abs(p.y - q.y) < eps, `${JSON.stringify(p)} !~ ${JSON.stringify(q)}`);

test('primitive matrices move sample points correctly', () => {
  near(apply(translation(10, -5), { x: 1, y: 1 }), { x: 11, y: -4 });
  near(apply(rotation(Math.PI / 2, 100, 100), { x: 110, y: 100 }), { x: 100, y: 110 });
  near(apply(reflection(90, 50, 0), { x: 60, y: 7 }), { x: 40, y: 7 });   // vertical line x=50
  near(apply(reflection(0, 0, 20), { x: 3, y: 25 }), { x: 3, y: 15 });    // horizontal line y=20
});

test('compose applies B then A; invert undoes; power repeats', () => {
  const A = rotation(Math.PI / 3, 10, 10), B = translation(5, 0);
  const p = { x: 1, y: 2 };
  near(apply(compose(A, B), p), apply(A, apply(B, p)));
  near(apply(compose(invert(A), A), p), p);
  near(apply(power(A, 6), p), p);
  assert.deepEqual(power(A, 0), IDENTITY);
});

test('matrixOf builds each element kind from the lattice', () => {
  near(apply(matrixOf({ kind: 'translate', u: 0.5, v: 0 }, lat), { x: 0, y: 0 }), { x: 120, y: 0 });
  near(apply(matrixOf({ kind: 'rotate', cx: 120, cy: 120, n: 2 }, lat), { x: 0, y: 0 }), { x: 240, y: 240 });
  near(apply(matrixOf({ kind: 'mirror', cx: 120, cy: 0, angle: 90 }, lat), { x: 0, y: 5 }), { x: 240, y: 5 });
  near(apply(cellMatrix(1, -1, lat), { x: 0, y: 0 }), { x: 240, y: -240 });
});

test('isLatticeTranslation accepts integer lattice steps only', () => {
  assert.equal(isLatticeTranslation(translation(240, -480), lat), true);
  assert.equal(isLatticeTranslation(translation(120, 0), lat), false);
  assert.equal(isLatticeTranslation(rotation(Math.PI, 0, 0), lat), false);
  assert.equal(isLatticeTranslation(IDENTITY, lat), true);
});

const els = [
  { id: 'r2', kind: 'rotate', cx: 120, cy: 120, n: 2 },
  { id: 'r3', kind: 'rotate', cx: 80, cy: 69.28, n: 3 },
  { id: 'r4', kind: 'rotate', cx: 0, cy: 0, n: 4 },
  { id: 'r6', kind: 'rotate', cx: 0, cy: 0, n: 6 },
  { id: 'r5', kind: 'rotate', cx: 0, cy: 0, n: 5 },
  { id: 'm', kind: 'mirror', cx: 0, cy: 120, angle: 0 },
  { id: 't12', kind: 'translate', u: 0.5, v: 0 },
  { id: 't13', kind: 'translate', u: 1 / 3, v: 0 },
  { id: 'tc', kind: 'translate', u: 0.5, v: 0.5 },
  { id: 't1', kind: 'translate', u: 1, v: 0 },
];

test('orbit sizes match the spec table', () => {
  const n = (ops, L = lat) => orbit(ops, els, L).matrices.length;
  assert.equal(n(['r2']), 1);
  assert.equal(n(['r3'], hex), 2);
  assert.equal(n(['r4']), 3);
  assert.equal(n(['r6'], hex), 5);
  assert.equal(n(['m']), 1);
  assert.equal(n(['m', 't12']), 1);
  assert.equal(n(['m', 't13']), 2);
  assert.equal(n(['t12']), 1);
  assert.equal(n(['tc']), 1);
  assert.equal(n(['t1']), 0);
  assert.equal(n(['r2', 't12']), 1);
});

test('an empty chain yields no clones and is not open', () => {
  const o = orbit([], els, lat);
  assert.equal(o.matrices.length, 0);
  assert.equal(o.open, false);
});

test('an element that never closes is capped and flagged open', () => {
  const o = orbit(['r5'], els, lat, 12);
  assert.equal(o.matrices.length, 12);
  assert.equal(o.open, true);
});

test('composite applies ops left to right', () => {
  const M = composite(['m', 't12'], els, lat);
  const p = { x: 10, y: 20 };
  near(apply(M, p), apply(matrixOf(els[6], lat), apply(matrixOf(els[5], lat), p)));
});

test('classify recognises each isometry', () => {
  assert.equal(classify(IDENTITY).kind, 'identity');
  assert.equal(classify(translation(3, 4)).kind, 'translation');
  const rot = classify(compose(matrixOf(els[0], lat), matrixOf(els[6], lat)));
  assert.equal(rot.kind, 'rotation');
  near(rot.center, { x: 60, y: 120 }); // R(p + 120) = 120 − x in x, 240 − y in y
  const g = classify(composite(['m', 't12'], els, lat));
  assert.equal(g.kind, 'glide');
  assert.ok(Math.abs(Math.abs(g.slide) - 120) < 1e-6);
  assert.equal(classify(matrixOf(els[5], lat)).kind, 'reflection');
});

test('toSvg formats a matrix attribute', () => {
  assert.equal(toSvg(translation(1, 2)), 'matrix(1 0 0 1 1 2)');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/transform.test.js`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Create `js/transform.js`**

```js
// 2×3 affine matrices in SVG order: [a, b, c, d, e, f] with x' = a·x + c·y + e, y' = b·x + d·y + f.
import { toUV } from './lattice.js';

export const IDENTITY = [1, 0, 0, 1, 0, 0];

export function translation(dx, dy) { return [1, 0, 0, 1, dx, dy]; }

export function rotation(theta, cx = 0, cy = 0) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}

// Reflection across the line through (cx, cy) at angleDeg from the x axis.
export function reflection(angleDeg, cx = 0, cy = 0) {
  const t = (angleDeg * Math.PI) / 180, c2 = Math.cos(2 * t), s2 = Math.sin(2 * t);
  return [c2, s2, s2, -c2, cx - c2 * cx - s2 * cy, cy - s2 * cx + c2 * cy];
}

// A∘B: apply B first, then A.
export function compose(A, B) {
  return [
    A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}

export function invert(M) {
  const [a, b, c, d, e, f] = M;
  const det = a * d - b * c;
  const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}

export function apply(M, p) {
  return { x: M[0] * p.x + M[2] * p.y + M[4], y: M[1] * p.x + M[3] * p.y + M[5] };
}

export function power(M, k) {
  let R = IDENTITY;
  for (let i = 0; i < k; i++) R = compose(M, R);
  return R;
}

export function cellMatrix(c, r, lat) {
  return translation(c * lat.ax + r * lat.bx, c * lat.ay + r * lat.by);
}

export function matrixOf(el, lat) {
  if (el.kind === 'translate') return translation(el.u * lat.ax + el.v * lat.bx, el.u * lat.ay + el.v * lat.by);
  if (el.kind === 'mirror') return reflection(el.angle, el.cx, el.cy);
  if (el.kind === 'rotate') return rotation((2 * Math.PI) / el.n, el.cx, el.cy);
  throw new Error(`unknown element kind: ${el.kind}`);
}

export function isLatticeTranslation(M, lat, eps = 1e-6) {
  if (Math.abs(M[0] - 1) > eps || Math.abs(M[1]) > eps || Math.abs(M[2]) > eps || Math.abs(M[3] - 1) > eps) return false;
  const { u, v } = toUV({ x: M[4], y: M[5] }, lat);
  return Math.abs(u - Math.round(u)) < eps && Math.abs(v - Math.round(v)) < eps;
}

// Ordered composition of element ids, applied left to right. Unknown ids are skipped.
export function composite(ops, elements, lat) {
  let M = IDENTITY;
  for (const id of ops) {
    const el = elements.find((e) => e.id === id);
    if (el) M = compose(matrixOf(el, lat), M);
  }
  return M;
}

// Clone matrices of a chain: M¹, M², … up to (excluding) the first lattice translation.
export function orbit(ops, elements, lat, cap = 12) {
  const M = composite(ops, elements, lat);
  const matrices = [];
  let P = M;
  for (let k = 1; k <= cap; k++) {
    if (isLatticeTranslation(P, lat)) return { matrices, open: false };
    matrices.push(P);
    P = compose(M, P);
  }
  return { matrices, open: true };
}

// Which isometry a matrix is, with its centre / line / vector. For labels and hints only.
export function classify(M, eps = 1e-6) {
  const [a, b, c, d, e, f] = M;
  const det = a * d - b * c;
  if (det > 0) {
    if (Math.abs(a - 1) < eps && Math.abs(b) < eps) {
      return Math.abs(e) < eps && Math.abs(f) < eps ? { kind: 'identity' } : { kind: 'translation', vector: { x: e, y: f } };
    }
    const theta = Math.atan2(b, a);
    const m00 = 1 - a, m01 = -c, m10 = -b, m11 = 1 - d;
    const dd = m00 * m11 - m01 * m10;
    return { kind: 'rotation', angle: theta, center: { x: (m11 * e - m01 * f) / dd, y: (-m10 * e + m00 * f) / dd } };
  }
  const theta = Math.atan2(b, a) / 2;
  const dir = { x: Math.cos(theta), y: Math.sin(theta) };
  const along = e * dir.x + f * dir.y;
  const px = e - along * dir.x, py = f - along * dir.y;
  const line = { angle: (theta * 180) / Math.PI, point: { x: px / 2, y: py / 2 } };
  return Math.abs(along) < eps ? { kind: 'reflection', line } : { kind: 'glide', line, slide: along };
}

export function toSvg(M) { return `matrix(${M.join(' ')})`; }
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/transform.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add js/transform.js tests/transform.test.js
git commit -m "Add affine transforms, element matrices and orbits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 4: Path, element, binding and fill mutations

**Files:**
- Create: `js/paths.js`, `tests/paths.test.js`

**Interfaces:**
- Consumes: `makeId`, `toWorld`, `cellOf`, `apply`, `orbit`.
- Produces (all take `doc` = `{ lattice, points, paths, elements, bindings, fills }` first): `getPoint`, `getPath`, `getElement`, `getBinding`, `sameNode(a, b)`, `nodeWorld(doc, node)`, `pathWorld(doc, path)`, `isClosed(path)`, `addPoint(doc, world) → node`, `startPath(doc, node, style, layer) → path`, `appendNode(doc, pathId, node) → boolean`, `insertNode(doc, pathId, j, world) → node`, `pruneOrphans(doc)`, `deletePoints(doc, ids)`, `deletePath(doc, pathId)`, `openEndAt(doc, pointId) → pathId|null`, `orientToEnd(doc, pathId, pointId, cell)`, `shiftControlPoints(doc, ids, dx, dy)`, `movePoint(doc, pointId, x, y)`, `movePointsBy(doc, ids, startPos, dx, dy)`, `snapshotPositions(doc, ids) → {id: {x,y}}`, `setControlPoint(doc, pathId, j, cp|null)`, `transformPath(doc, pathId, M)`, `bounds(doc, pathId) → {x0,y0,x1,y1}`, `addElement(doc, el) → element`, `deleteElement(doc, id)`, `addBinding(doc, pathId, ops) → binding`, `toggleOp(doc, bindingId, elementId)`, `removeBinding(doc, id)`, `cloneMatrices(doc, bindingId, cap) → { matrices, open }`, `addFill(doc, seed) → fill`, `removeFill(doc, id)`.

- [ ] **Step 1: Write `tests/paths.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../js/paths.js';
import { CONFIG } from '../js/config.js';
import { rotation } from '../js/transform.js';

function makeDoc() {
  return { lattice: { ...CONFIG.LATTICE_PRESETS.Square }, points: [], paths: [], elements: [], bindings: [], fills: [] };
}
const style = { color: '#000', weight: 2 };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

// Build a path through world points; returns the path.
function polyline(doc, pts) {
  const nodes = pts.map((p) => P.addPoint(doc, p));
  const path = P.startPath(doc, nodes[0], style);
  for (const n of nodes.slice(1)) P.appendNode(doc, path.id, n);
  return path;
}

test('addPoint stores cell-local coordinates and the cell', () => {
  const doc = makeDoc();
  const n = P.addPoint(doc, { x: 250, y: 10 });
  assert.deepEqual(n.cell, { c: 1, r: 0 });
  near(P.getPoint(doc, n.pointId).x, 10);
  const w = P.nodeWorld(doc, n);
  near(w.x, 250); near(w.y, 10);
});

test('append and insert keep cps.length === nodes.length - 1', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  assert.equal(path.cps.length, 2);
  assert.equal(P.appendNode(doc, path.id, path.nodes[2]), false); // repeat of the last node is ignored
  P.insertNode(doc, path.id, 0, { x: 50, y: 0 });
  assert.equal(path.nodes.length, 4);
  assert.equal(path.cps.length, 3);
  near(P.nodeWorld(doc, path.nodes[1]).x, 50);
});

test('inserting into a curved segment splits it at t = 0.5 with halved control points', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  P.setControlPoint(doc, path.id, 0, { x: 50, y: 100 });
  const node = P.insertNode(doc, path.id, 0, null);
  const w = P.nodeWorld(doc, node);
  near(w.x, 50); near(w.y, 50);
  assert.deepEqual(path.cps[0], { x: 25, y: 50 });
  assert.deepEqual(path.cps[1], { x: 75, y: 50 });
});

test('a path is closed only when first and last node are the same point in the same cell', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 100 }]);
  assert.equal(P.isClosed(path), false);
  P.appendNode(doc, path.id, path.nodes[0]);
  assert.equal(P.isClosed(path), true);
  const wrap = polyline(doc, [{ x: 10, y: 10 }, { x: 100, y: 10 }]);
  P.appendNode(doc, wrap.id, { pointId: wrap.nodes[0].pointId, cell: { c: 1, r: 0 } }); // same point, next cell
  assert.equal(P.isClosed(wrap), false);
  near(P.nodeWorld(doc, wrap.nodes[2]).x, 250);
});

test('deletePoints removes every occurrence, keeps cps aligned, prunes orphans and bindings', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 100 }, { x: 10, y: 100 }]);
  P.appendNode(doc, path.id, path.nodes[0]); // closed: first point appears twice
  P.setControlPoint(doc, path.id, 1, { x: 120, y: 55 });
  const el = P.addElement(doc, { kind: 'rotate', cx: 120, cy: 120, n: 2 });
  P.addBinding(doc, path.id, [el.id]);
  P.deletePoints(doc, [path.nodes[0].pointId]);
  assert.equal(path.nodes.length, 3);
  assert.equal(path.cps.length, 2);
  assert.deepEqual(path.cps[0], { x: 120, y: 55 }); // the surviving curve kept its control point
  assert.equal(doc.points.length, 3);
  assert.equal(doc.bindings.length, 1);
  P.deletePoints(doc, [path.nodes[0].pointId, path.nodes[1].pointId]);
  assert.equal(doc.paths.length, 0);
  assert.equal(doc.points.length, 0);
  assert.equal(doc.bindings.length, 0);
});

test('deletePath removes its bindings and orphaned points', () => {
  const doc = makeDoc();
  const a = polyline(doc, [{ x: 0, y: 0 }, { x: 50, y: 0 }]);
  const b = P.startPath(doc, a.nodes[1], style);
  P.appendNode(doc, b.id, P.addPoint(doc, { x: 50, y: 50 }));
  P.addBinding(doc, a.id, []);
  P.deletePath(doc, a.id);
  assert.equal(doc.paths.length, 1);
  assert.equal(doc.points.length, 2); // the shared point survives
  assert.equal(doc.bindings.length, 0);
});

test('openEndAt and orientToEnd resume a path from either end, shifting cells', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 100 }]);
  P.setControlPoint(doc, path.id, 0, { x: 55, y: -20 });
  const first = path.nodes[0].pointId;
  assert.equal(P.openEndAt(doc, first), path.id);
  assert.equal(P.openEndAt(doc, path.nodes[1].pointId), null);
  P.orientToEnd(doc, path.id, first, { c: 1, r: 0 });
  assert.equal(path.nodes[2].pointId, first);
  assert.deepEqual(path.nodes[2].cell, { c: 1, r: 0 });
  near(path.cps[1].x, 55 + 240); // the reversed, shifted control point
  near(path.cps[1].y, -20);
});

test('movePoint shifts adjacent control points by half the delta', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }]);
  P.setControlPoint(doc, path.id, 0, { x: 50, y: 50 });
  P.setControlPoint(doc, path.id, 1, { x: 150, y: 50 });
  P.movePoint(doc, path.nodes[1].pointId, 100, 20);
  near(path.cps[0].y, 60); near(path.cps[1].y, 60);
  P.movePointsBy(doc, [path.nodes[0].pointId, path.nodes[1].pointId], P.snapshotPositions(doc, [path.nodes[0].pointId, path.nodes[1].pointId]), 0, 10);
  near(path.cps[0].y, 70);  // both endpoints moved: full delta
  near(path.cps[1].y, 65);  // one endpoint moved: half
});

test('transformPath applies a matrix to points and control points', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  P.setControlPoint(doc, path.id, 0, { x: 50, y: 50 });
  P.transformPath(doc, path.id, rotation(Math.PI / 2, 0, 0));
  const w = P.pathWorld(doc, path);
  near(w[1].x, 0); near(w[1].y, 100);
  near(path.cps[0].x, -50); near(path.cps[0].y, 50);
  const b = P.bounds(doc, path.id);
  near(b.x0, -50); near(b.y1, 100);
});

test('bindings toggle ops in order and cloneMatrices uses the orbit', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  const m = P.addElement(doc, { kind: 'mirror', cx: 0, cy: 120, angle: 0 });
  const t = P.addElement(doc, { kind: 'translate', u: 0.5, v: 0 });
  const b = P.addBinding(doc, path.id, []);
  assert.equal(P.cloneMatrices(doc, b.id).matrices.length, 0);
  P.toggleOp(doc, b.id, m.id); P.toggleOp(doc, b.id, t.id);
  assert.deepEqual(b.ops, [m.id, t.id]);
  assert.equal(P.cloneMatrices(doc, b.id).matrices.length, 1);
  P.toggleOp(doc, b.id, m.id);
  assert.deepEqual(b.ops, [t.id]);
  P.deleteElement(doc, t.id);
  assert.equal(doc.bindings.length, 0);
});

test('fills are added and removed by id', () => {
  const doc = makeDoc();
  const f = P.addFill(doc, { x: 1, y: 2, color: '#f00' });
  assert.equal(doc.fills.length, 1);
  P.removeFill(doc, f.id);
  assert.equal(doc.fills.length, 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/paths.test.js`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Create `js/paths.js`**

```js
// Document mutations for points, paths, elements, bindings and fills.
// Every function takes the document first and never touches UI state.
import { makeId } from './ids.js';
import { toWorld, cellOf } from './lattice.js';
import { apply, orbit } from './transform.js';

export function getPoint(doc, id) { return doc.points.find((p) => p.id === id) || null; }
export function getPath(doc, id) { return doc.paths.find((p) => p.id === id) || null; }
export function getElement(doc, id) { return doc.elements.find((e) => e.id === id) || null; }
export function getBinding(doc, id) { return doc.bindings.find((b) => b.id === id) || null; }

export function sameNode(a, b) {
  return a.pointId === b.pointId && a.cell.c === b.cell.c && a.cell.r === b.cell.r;
}

export function nodeWorld(doc, node) {
  const p = getPoint(doc, node.pointId);
  const o = toWorld(node.cell, doc.lattice);
  return { x: p.x + o.x, y: p.y + o.y };
}

export function pathWorld(doc, path) { return path.nodes.map((n) => nodeWorld(doc, n)); }

export function isClosed(path) {
  return path.nodes.length > 2 && sameNode(path.nodes[0], path.nodes[path.nodes.length - 1]);
}

// Create a point at a world position; returns the node that places it.
export function addPoint(doc, world) {
  const ce = cellOf(world, doc.lattice);
  const pt = { id: makeId('pt'), x: ce.local.x, y: ce.local.y };
  doc.points.push(pt);
  return { pointId: pt.id, cell: { c: ce.c, r: ce.r } };
}

export function startPath(doc, node, style, layer = 'structure') {
  const path = { id: makeId('path'), nodes: [{ pointId: node.pointId, cell: { ...node.cell } }], cps: [], style: { ...style }, layer };
  doc.paths.push(path);
  return path;
}

// Append a node; a repeat of the last node is ignored (returns false).
export function appendNode(doc, pathId, node) {
  const p = getPath(doc, pathId);
  const last = p.nodes[p.nodes.length - 1];
  if (last && sameNode(last, node)) return false;
  p.nodes.push({ pointId: node.pointId, cell: { ...node.cell } });
  if (p.nodes.length > 1) p.cps.push(null);
  return true;
}

// Insert a node into segment j. A straight segment splits at `world`;
// a curved one splits at t = 0.5 (de Casteljau), ignoring `world`.
export function insertNode(doc, pathId, j, world) {
  const p = getPath(doc, pathId);
  const A = nodeWorld(doc, p.nodes[j]), B = nodeWorld(doc, p.nodes[j + 1]), cp = p.cps[j];
  let m, cpsNew;
  if (cp) {
    m = { x: 0.25 * A.x + 0.5 * cp.x + 0.25 * B.x, y: 0.25 * A.y + 0.5 * cp.y + 0.25 * B.y };
    cpsNew = [{ x: (A.x + cp.x) / 2, y: (A.y + cp.y) / 2 }, { x: (cp.x + B.x) / 2, y: (cp.y + B.y) / 2 }];
  } else {
    m = world;
    cpsNew = [null, null];
  }
  const node = addPoint(doc, m);
  p.nodes.splice(j + 1, 0, node);
  p.cps.splice(j, 1, ...cpsNew);
  return node;
}

export function pruneOrphans(doc) {
  const used = new Set();
  for (const p of doc.paths) for (const n of p.nodes) used.add(n.pointId);
  doc.points = doc.points.filter((pt) => used.has(pt.id));
}

// Remove points from every path. Segments adjacent to a removed node are dropped;
// the bridging segment between the surviving neighbours is straight.
export function deletePoints(doc, ids) {
  const set = new Set(ids);
  const keep = [];
  for (const p of doc.paths) {
    const nodes = [], cps = [];
    let bridge = false;
    p.nodes.forEach((n, j) => {
      if (set.has(n.pointId)) { bridge = true; return; }
      if (nodes.length) cps.push(bridge ? null : (p.cps[j - 1] ?? null));
      nodes.push(n);
      bridge = false;
    });
    if (nodes.length >= 2) { p.nodes = nodes; p.cps = cps; keep.push(p); }
  }
  const kept = new Set(keep.map((p) => p.id));
  doc.paths = keep;
  doc.bindings = doc.bindings.filter((b) => kept.has(b.pathId));
  pruneOrphans(doc);
}

export function deletePath(doc, pathId) {
  doc.paths = doc.paths.filter((p) => p.id !== pathId);
  doc.bindings = doc.bindings.filter((b) => b.pathId !== pathId);
  pruneOrphans(doc);
}

// The open path that starts or ends at this point, if any.
export function openEndAt(doc, pointId) {
  const p = doc.paths.find((q) => !isClosed(q) && (q.nodes[0].pointId === pointId || q.nodes[q.nodes.length - 1].pointId === pointId));
  return p ? p.id : null;
}

// Make `pointId` the last node of the path, placed in `cell`: reverse if needed, then shift every cell.
export function orientToEnd(doc, pathId, pointId, cell) {
  const p = getPath(doc, pathId);
  if (p.nodes[p.nodes.length - 1].pointId !== pointId) { p.nodes.reverse(); p.cps.reverse(); }
  const last = p.nodes[p.nodes.length - 1];
  const dc = cell.c - last.cell.c, dr = cell.r - last.cell.r;
  if (dc || dr) {
    const sh = toWorld({ c: dc, r: dr }, doc.lattice);
    p.nodes = p.nodes.map((n) => ({ pointId: n.pointId, cell: { c: n.cell.c + dc, r: n.cell.r + dr } }));
    p.cps = p.cps.map((c) => c && { x: c.x + sh.x, y: c.y + sh.y });
  }
}

// Each control point adjacent to a moved point follows by half the delta per moved endpoint.
export function shiftControlPoints(doc, ids, dx, dy) {
  if (!dx && !dy) return;
  const set = new Set(ids);
  for (const p of doc.paths) {
    p.cps = p.cps.map((c, j) => {
      if (!c) return c;
      const n = (set.has(p.nodes[j].pointId) ? 1 : 0) + (set.has(p.nodes[j + 1].pointId) ? 1 : 0);
      return n ? { x: c.x + (dx * n) / 2, y: c.y + (dy * n) / 2 } : c;
    });
  }
}

export function movePoint(doc, pointId, x, y) {
  const p = getPoint(doc, pointId);
  const dx = x - p.x, dy = y - p.y;
  if (!dx && !dy) return;
  p.x = x; p.y = y;
  shiftControlPoints(doc, [pointId], dx, dy);
}

export function snapshotPositions(doc, ids) {
  const out = {};
  for (const id of ids) { const p = getPoint(doc, id); out[id] = { x: p.x, y: p.y }; }
  return out;
}

// Move a set of points to start + (dx, dy). Control points follow by the actual change since the last call.
export function movePointsBy(doc, ids, startPos, dx, dy) {
  if (!ids.length) return;
  const first = getPoint(doc, ids[0]);
  const ddx = startPos[ids[0]].x + dx - first.x, ddy = startPos[ids[0]].y + dy - first.y;
  for (const id of ids) { const p = getPoint(doc, id); p.x = startPos[id].x + dx; p.y = startPos[id].y + dy; }
  shiftControlPoints(doc, ids, ddx, ddy);
}

export function setControlPoint(doc, pathId, j, cp) {
  getPath(doc, pathId).cps[j] = cp ? { x: cp.x, y: cp.y } : null;
}

// Apply a world matrix to a path: each distinct point once (in its first cell), and every control point.
export function transformPath(doc, pathId, M) {
  const p = getPath(doc, pathId);
  const seen = new Set();
  for (const n of p.nodes) {
    if (seen.has(n.pointId)) continue;
    seen.add(n.pointId);
    const pt = getPoint(doc, n.pointId);
    const o = toWorld(n.cell, doc.lattice);
    const w = apply(M, { x: pt.x + o.x, y: pt.y + o.y });
    pt.x = w.x - o.x; pt.y = w.y - o.y;
  }
  p.cps = p.cps.map((c) => c && apply(M, c));
}

export function bounds(doc, pathId) {
  const p = getPath(doc, pathId);
  const W = pathWorld(doc, p).concat(p.cps.filter(Boolean));
  const xs = W.map((q) => q.x), ys = W.map((q) => q.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// --- elements, bindings, fills

export function addElement(doc, el) {
  const e = { id: makeId('el'), ...el };
  doc.elements.push(e);
  return e;
}

// Deleting an element removes every binding that uses it.
export function deleteElement(doc, id) {
  doc.elements = doc.elements.filter((e) => e.id !== id);
  doc.bindings = doc.bindings.filter((b) => !b.ops.includes(id));
}

export function addBinding(doc, pathId, ops = []) {
  const b = { id: makeId('bind'), pathId, ops: ops.slice() };
  doc.bindings.push(b);
  return b;
}

// Remove the element from the chain if present, otherwise append it.
export function toggleOp(doc, bindingId, elementId) {
  const b = getBinding(doc, bindingId);
  const i = b.ops.indexOf(elementId);
  if (i >= 0) b.ops.splice(i, 1); else b.ops.push(elementId);
}

export function removeBinding(doc, id) { doc.bindings = doc.bindings.filter((b) => b.id !== id); }

export function cloneMatrices(doc, bindingId, cap = 12) {
  const b = getBinding(doc, bindingId);
  return b ? orbit(b.ops, doc.elements, doc.lattice, cap) : { matrices: [], open: false };
}

export function addFill(doc, seed) {
  const f = { id: makeId('fill'), x: seed.x, y: seed.y, color: seed.color };
  doc.fills.push(f);
  return f;
}

export function removeFill(doc, id) { doc.fills = doc.fills.filter((f) => f.id !== id); }
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/paths.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add js/paths.js tests/paths.test.js
git commit -m "Add document mutations for paths, elements, bindings and fills

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Snapping, marquee, bounding-box maths, and history

**Files:**
- Create: `js/hit.js`, `js/history.js`, `tests/hit.test.js`, `tests/history.test.js`

**Interfaces:**
- Produces (`hit.js`): `anchorsWorld(doc, skip?) → [{x, y, pointId, cell, bindingId?, power?}]`, `snapWorld(doc, p, threshold, div, skip?, gridOn?) → {x, y, anchor}`, `pointsInRect(doc, {x0,y0,x1,y1}) → ids`, `projectOnSegment(A, B, p) → {x,y}`, `bboxHandles(box) → [8 handles {x,y,ax,ay,cursor}]`, `scaleMatrix(ax, ay, sx, sy)`, `scaleFor(handle, p, free) → {sx, sy}`.
- Produces (`history.js`): `push()`, `undo() → boolean`, `redo() → boolean`, `canUndo()`, `canRedo()`, `beginDrag()`, `endDrag()`, `reset()`.
- The `skip` predicate receives an anchor descriptor `{ pointId, cell, bindingId?, power? }` and returns true to exclude it.

- [ ] **Step 1: Write `tests/hit.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../js/paths.js';
import { anchorsWorld, snapWorld, pointsInRect, projectOnSegment, bboxHandles, scaleMatrix, scaleFor } from '../js/hit.js';
import { apply } from '../js/transform.js';
import { CONFIG } from '../js/config.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
function makeDoc() { return { lattice: { ...CONFIG.LATTICE_PRESETS.Square }, points: [], paths: [], elements: [], bindings: [], fills: [] }; }

test('anchorsWorld lists raw points in 9 cells and clone points with their binding', () => {
  const doc = makeDoc();
  const n = P.addPoint(doc, { x: 10, y: 10 });
  const path = P.startPath(doc, n, {});
  P.appendNode(doc, path.id, P.addPoint(doc, { x: 60, y: 10 }));
  const el = P.addElement(doc, { kind: 'rotate', cx: 120, cy: 120, n: 2 });
  P.addBinding(doc, path.id, [el.id]);
  const all = anchorsWorld(doc);
  assert.equal(all.filter((a) => !a.bindingId).length, 18);
  const clones = all.filter((a) => a.bindingId);
  assert.equal(clones.length, 18);
  const c = clones.find((a) => a.cell.c === 0 && a.cell.r === 0 && a.pointId === n.pointId && a.power === 1);
  const inBase = clones.filter((a) => Math.abs(a.x - 230) < 1e-9 && Math.abs(a.y - 230) < 1e-9);
  assert.equal(inBase.length, 1);
  assert.equal(c.pointId, n.pointId);
});

test('snapWorld prefers a neighbouring-cell anchor over the grid, honours skip, and falls back to grid', () => {
  const doc = makeDoc();
  const n = P.addPoint(doc, { x: 10, y: 10 });
  const s = snapWorld(doc, { x: 253, y: 12 }, 12, 8);
  near(s.x, 250); near(s.y, 10);
  assert.equal(s.anchor.pointId, n.pointId);
  assert.deepEqual(s.anchor.cell, { c: 1, r: 0 });
  const skipped = snapWorld(doc, { x: 253, y: 12 }, 12, 8, (a) => a.pointId === n.pointId);
  near(skipped.x, 240); near(skipped.y, 0);
  assert.equal(skipped.anchor, null);
  const raw = snapWorld(doc, { x: 253, y: 12 }, 12, 8, (a) => a.pointId === n.pointId, false);
  near(raw.x, 253);
});

test('pointsInRect finds a point through any of its 9 copies', () => {
  const doc = makeDoc();
  const n = P.addPoint(doc, { x: 10, y: 10 });
  assert.deepEqual(pointsInRect(doc, { x0: 245, y0: 0, x1: 260, y1: 20 }), [n.pointId]);
  assert.deepEqual(pointsInRect(doc, { x0: 100, y0: 100, x1: 120, y1: 120 }), []);
});

test('projectOnSegment clamps to the interior of the segment', () => {
  const p = projectOnSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 40, y: 30 });
  near(p.x, 40); near(p.y, 0);
  near(projectOnSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: -50, y: 0 }).x, 5);
});

test('bbox handles, scale factors and scale matrix', () => {
  const box = { x0: 0, y0: 0, x1: 100, y1: 50 };
  const hs = bboxHandles(box);
  assert.equal(hs.length, 8);
  const corner = hs[2]; // (100,50) anchored at (0,0)
  const u = scaleFor(corner, { x: 200, y: 100 }, false);
  near(u.sx, 2); near(u.sy, 2);
  const f = scaleFor(corner, { x: 200, y: 25 }, true);
  near(f.sx, 2); near(f.sy, 0.5);
  const edge = hs[6]; // right edge
  near(scaleFor(edge, { x: 50, y: 999 }, false).sx, 0.5);
  const M = scaleMatrix(0, 0, 2, 2);
  const q = apply(M, { x: 10, y: 5 });
  near(q.x, 20); near(q.y, 10);
});
```

- [ ] **Step 2: Write `tests/history.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/state.js';
import { push, undo, redo, canUndo, canRedo, beginDrag, endDrag, reset } from '../js/history.js';

test('push/undo/redo restore document keys and clear selection', () => {
  reset();
  state.points = [];
  push();
  state.points = [{ id: 'a', x: 1, y: 1 }];
  state.selection = { kind: 'points', ids: ['a'] };
  assert.equal(canUndo(), true);
  assert.equal(undo(), true);
  assert.deepEqual(state.points, []);
  assert.equal(state.selection, null);
  assert.equal(canRedo(), true);
  assert.equal(redo(), true);
  assert.deepEqual(state.points, [{ id: 'a', x: 1, y: 1 }]);
  assert.equal(undo(), true);
  assert.equal(undo(), false);
});

test('a new push clears redo, and the stack is capped at 50', () => {
  reset();
  push(); state.points = [{ id: 'x', x: 0, y: 0 }];
  undo();
  assert.equal(canRedo(), true);
  push();
  assert.equal(canRedo(), false);
  reset();
  for (let i = 0; i < 60; i++) { push(); state.points = [{ id: `p${i}`, x: i, y: 0 }]; }
  let n = 0; while (undo()) n++;
  assert.equal(n, 50);
});

test('beginDrag pushes once per gesture', () => {
  reset();
  beginDrag(); beginDrag(); beginDrag();
  endDrag();
  let n = 0; while (undo()) n++;
  assert.equal(n, 1);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `node --test tests/hit.test.js tests/history.test.js`
Expected: FAIL, cannot find modules.

- [ ] **Step 4: Create `js/hit.js`**

```js
// Snapping and geometry helpers for interaction. Pure: takes a doc, returns values.
import { windowOffsets, snapToGrid, toWorld } from './lattice.js';
import { apply, cellMatrix, compose, orbit } from './transform.js';
import { getPath, pathWorld } from './paths.js';

// Every point copy and every clone point in the 3×3 window.
// Raw anchors carry the copy's cell; clone anchors carry the source node's own cell.
export function anchorsWorld(doc, skip, cap = 12) {
  const out = [];
  const clones = doc.bindings
    .map((b) => ({ b, path: getPath(doc, b.pathId), ms: orbit(b.ops, doc.elements, doc.lattice, cap).matrices }))
    .filter((c) => c.path);
  for (const o of windowOffsets()) {
    const Mo = cellMatrix(o.c, o.r, doc.lattice);
    for (const pt of doc.points) {
      const a = { pointId: pt.id, cell: o };
      if (skip && skip(a)) continue;
      const w = apply(Mo, pt);
      out.push({ x: w.x, y: w.y, ...a });
    }
    for (const { b, path, ms } of clones) {
      const P = pathWorld(doc, path);
      ms.forEach((M, k) => {
        const MM = compose(Mo, M);
        path.nodes.forEach((n, j) => {
          const a = { pointId: n.pointId, cell: n.cell, bindingId: b.id, power: k + 1 };
          if (skip && skip(a)) return;
          const w = apply(MM, P[j]);
          out.push({ x: w.x, y: w.y, ...a });
        });
      });
    }
  }
  return out;
}

// Nearest anchor within threshold, else grid snap (or the raw point when gridOn is false).
export function snapWorld(doc, p, threshold, div, skip, gridOn = true) {
  let best = null, bd = threshold;
  for (const a of anchorsWorld(doc, skip)) {
    const d = Math.hypot(a.x - p.x, a.y - p.y);
    if (d < bd) { bd = d; best = a; }
  }
  if (best) return { x: best.x, y: best.y, anchor: best };
  const g = gridOn ? snapToGrid(p, doc.lattice, div) : p;
  return { x: g.x, y: g.y, anchor: null };
}

export function pointsInRect(doc, rect) {
  const offs = windowOffsets();
  const ids = [];
  for (const pt of doc.points) {
    const hit = offs.some((o) => {
      const w = toWorld(o, doc.lattice);
      const x = pt.x + w.x, y = pt.y + w.y;
      return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
    });
    if (hit) ids.push(pt.id);
  }
  return ids;
}

export function projectOnSegment(A, B, p, tMin = 0.05, tMax = 0.95) {
  const dx = B.x - A.x, dy = B.y - A.y;
  const L = dx * dx + dy * dy || 1;
  const t = Math.max(tMin, Math.min(tMax, ((p.x - A.x) * dx + (p.y - A.y) * dy) / L));
  return { x: A.x + t * dx, y: A.y + t * dy };
}

// Eight scale handles: four corners then top, bottom, right, left. Each anchors at its opposite.
export function bboxHandles(box) {
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  return [
    { x: box.x0, y: box.y0, ax: box.x1, ay: box.y1, cursor: 'nwse-resize' },
    { x: box.x1, y: box.y0, ax: box.x0, ay: box.y1, cursor: 'nesw-resize' },
    { x: box.x1, y: box.y1, ax: box.x0, ay: box.y0, cursor: 'nwse-resize' },
    { x: box.x0, y: box.y1, ax: box.x1, ay: box.y0, cursor: 'nesw-resize' },
    { x: cx, y: box.y0, ax: cx, ay: box.y1, cursor: 'ns-resize' },
    { x: cx, y: box.y1, ax: cx, ay: box.y0, cursor: 'ns-resize' },
    { x: box.x1, y: cy, ax: box.x0, ay: cy, cursor: 'ew-resize' },
    { x: box.x0, y: cy, ax: box.x1, ay: cy, cursor: 'ew-resize' },
  ];
}

export function scaleMatrix(ax, ay, sx, sy) { return [sx, 0, 0, sy, ax - sx * ax, ay - sy * ay]; }

// Scale factors for dragging handle h to pointer p. Corners scale uniformly unless `free`.
export function scaleFor(h, p, free) {
  const vx = h.x - h.ax, vy = h.y - h.ay;
  const clamp = (v) => (Math.abs(v) < 0.05 ? (v < 0 ? -0.05 : 0.05) : v);
  let sx = 1, sy = 1;
  if (vx && vy) {
    if (free) { sx = (p.x - h.ax) / vx; sy = (p.y - h.ay) / vy; }
    else { const u = ((p.x - h.ax) * vx + (p.y - h.ay) * vy) / (vx * vx + vy * vy); sx = sy = u; }
  } else if (vx) sx = (p.x - h.ax) / vx;
  else sy = (p.y - h.ay) / vy;
  return { sx: clamp(sx), sy: clamp(sy) };
}
```

- [ ] **Step 5: Create `js/history.js`**

```js
// Snapshot undo/redo over the document keys of state. push() before a discrete mutation;
// beginDrag() on a gesture's first movement (pushes once), endDrag() on pointer up.
import { state, DOC_KEYS } from './state.js';
import { CONFIG } from './config.js';

const past = [];
const future = [];
let dragPushed = false;

function snapshot() {
  const o = {};
  for (const k of DOC_KEYS) o[k] = state[k];
  return JSON.stringify(o);
}

function restore(snap) {
  let data;
  try { data = JSON.parse(snap); } catch (err) { console.error('history: bad snapshot', err); return false; }
  Object.assign(state, data);
  state.selection = null; state.pen = null; state.hover = null; state.drag = null;
  return true;
}

export function push() {
  past.push(snapshot());
  if (past.length > CONFIG.MAX_HISTORY) past.shift();
  future.length = 0;
}

export function undo() {
  if (!past.length) return false;
  future.push(snapshot());
  return restore(past.pop());
}

export function redo() {
  if (!future.length) return false;
  past.push(snapshot());
  return restore(future.pop());
}

export function canUndo() { return past.length > 0; }
export function canRedo() { return future.length > 0; }

export function beginDrag() {
  if (dragPushed) return;
  dragPushed = true;
  push();
}

export function endDrag() { dragPushed = false; }

export function reset() { past.length = 0; future.length = 0; dragPushed = false; }
```

- [ ] **Step 6: Run the tests**

Run: `node --test tests/hit.test.js tests/history.test.js`
Expected: all pass. In the anchors test the clone of point (10,10) through a 180° turn about (120,120) lands at (230,230); the assertion counts that exactly one clone anchor sits there in the base cell.

- [ ] **Step 7: Commit**

```bash
git add js/hit.js js/history.js tests/hit.test.js tests/history.test.js
git commit -m "Add snapping, bbox maths and snapshot history

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Freehand simplification and curve fitting

**Files:**
- Create: `js/freehand.js`, `tests/freehand.test.js`

**Interfaces:**
- Produces: `simplify(points, eps) → points` (returns references into the input), `fitQuadratic(raw, i0, i1, minDeviation) → {x,y}|null`, `strokeToPath(raw, {eps, minDeviation}) → { points: [{x,y}], cps: [{x,y}|null] } | null`.

- [ ] **Step 1: Write `tests/freehand.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simplify, fitQuadratic, strokeToPath } from '../js/freehand.js';

const line = Array.from({ length: 30 }, (_, i) => ({ x: i * 4, y: 0.3 * Math.sin(i) }));
const arc = Array.from({ length: 21 }, (_, i) => { const t = i / 20, u = 1 - t; return { x: 2 * u * t * 50 + t * t * 100, y: 2 * u * t * 100 }; }); // quadratic (0,0) (50,100) (100,0)

test('simplify collapses a near-straight stroke to its endpoints', () => {
  const s = simplify(line, 5);
  assert.equal(s.length, 2);
  assert.equal(s[0], line[0]);
  assert.equal(s[1], line[line.length - 1]);
});

test('fitQuadratic recovers a control point close to the true one', () => {
  const cp = fitQuadratic(arc, 0, arc.length - 1);
  assert.ok(cp, 'expected a control point');
  assert.ok(Math.abs(cp.x - 50) < 10 && Math.abs(cp.y - 100) < 10, JSON.stringify(cp));
  assert.equal(fitQuadratic(line, 0, line.length - 1), null);
});

test('strokeToPath rejects a short jitter and returns points plus cps otherwise', () => {
  assert.equal(strokeToPath([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }]), null);
  const out = strokeToPath(arc, { eps: 60 });
  assert.equal(out.points.length, 2);
  assert.equal(out.cps.length, 1);
  assert.ok(out.cps[0]);
  const straight = strokeToPath(line);
  assert.equal(straight.cps[0], null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/freehand.test.js`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Create `js/freehand.js`**

```js
// Freehand strokes: Ramer–Douglas–Peucker simplification, then one quadratic per simplified segment.

export function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const a = pts[0], b = pts[pts.length - 1];
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let idx = 0, md = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L;
    if (d > md) { md = d; idx = i; }
  }
  if (md <= eps) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

// Least-squares quadratic control point for raw[i0..i1] with chord-length parameterisation.
// Returns null when the samples barely deviate from the chord.
export function fitQuadratic(raw, i0, i1, minDeviation = 2.5) {
  const P0 = raw[i0], P2 = raw[i1];
  if (i1 - i0 < 2) return null;
  const cum = [0];
  for (let i = i0 + 1; i <= i1; i++) cum.push(cum[cum.length - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y));
  const L = cum[cum.length - 1] || 1;
  const chord = Math.hypot(P2.x - P0.x, P2.y - P0.y) || 1;
  let nx = 0, ny = 0, den = 0, dev = 0;
  for (let i = i0 + 1; i < i1; i++) {
    const t = cum[i - i0] / L, b0 = (1 - t) ** 2, b1 = 2 * t * (1 - t), b2 = t * t, S = raw[i];
    nx += b1 * (S.x - b0 * P0.x - b2 * P2.x);
    ny += b1 * (S.y - b0 * P0.y - b2 * P2.y);
    den += b1 * b1;
    dev = Math.max(dev, Math.abs((P2.x - P0.x) * (P0.y - S.y) - (P0.x - S.x) * (P2.y - P0.y)) / chord);
  }
  if (!den || dev < minDeviation) return null;
  return { x: nx / den, y: ny / den };
}

export function strokeToPath(raw, { eps = 5, minDeviation = 2.5 } = {}) {
  if (raw.length < 2) return null;
  const simp = simplify(raw, eps);
  if (simp.length < 2) return null;
  if (simp.length === 2 && Math.hypot(simp[1].x - simp[0].x, simp[1].y - simp[0].y) < 4) return null;
  const idx = simp.map((v) => raw.indexOf(v));
  const cps = [];
  for (let j = 0; j < simp.length - 1; j++) cps.push(fitQuadratic(raw, idx[j], idx[j + 1], minDeviation));
  return { points: simp.map((p) => ({ x: p.x, y: p.y })), cps };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/freehand.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add js/freehand.js tests/freehand.test.js
git commit -m "Add freehand simplification and quadratic fitting

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Regions — planar arrangement, faces, seed lookup

**Files:**
- Create: `js/regions.js`, `tests/regions.test.js`

**Interfaces:**
- Consumes: `windowOffsets`, `apply`, `cellMatrix`, `compose`, `orbit`, `pathWorld`.
- Produces: `computeFaces(doc) → faces` (memoised on document geometry; each face is `{ poly: [{x,y}], area, pieces: [{ seg, t0, t1, reversed }] }`, sorted by area descending), `faceAt(faces, p) → face|null` (smallest containing face), `facePathData(face) → string`, `collectSegments(doc)`, `subCurve(seg, t0, t1)`, `pointInPoly(poly, p)`.
- A `seg` is `{ a, b, cp|null, source }` in world coordinates.

- [ ] **Step 1: Write `tests/regions.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../js/paths.js';
import { computeFaces, faceAt, facePathData, collectSegments, subCurve } from '../js/regions.js';
import { CONFIG } from '../js/config.js';

const style = { color: '#000', weight: 2 };
function makeDoc() { return { lattice: { ...CONFIG.LATTICE_PRESETS.Square }, points: [], paths: [], elements: [], bindings: [], fills: [] }; }
function polyline(doc, pts, close = false) {
  const nodes = pts.map((p) => P.addPoint(doc, p));
  const path = P.startPath(doc, nodes[0], style);
  for (const n of nodes.slice(1)) P.appendNode(doc, path.id, n);
  if (close) P.appendNode(doc, path.id, nodes[0]);
  return path;
}
const square = (doc) => polyline(doc, [{ x: 60, y: 60 }, { x: 180, y: 60 }, { x: 180, y: 180 }, { x: 60, y: 180 }], true);
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('a closed square gives one face per cell copy', () => {
  const doc = makeDoc(); square(doc);
  const faces = computeFaces(doc);
  assert.equal(faces.length, 9);
  const f = faceAt(faces, { x: 120, y: 120 });
  assert.ok(f); near(f.area, 14400);
  assert.equal(faceAt(faces, { x: 30, y: 30 }), null);
  assert.equal(faceAt(faces, { x: 5000, y: 5000 }), null);
});

test('two crossing lines inside a square make four faces', () => {
  const doc = makeDoc(); square(doc);
  polyline(doc, [{ x: 60, y: 120 }, { x: 180, y: 120 }]);
  polyline(doc, [{ x: 120, y: 60 }, { x: 120, y: 180 }]);
  const faces = computeFaces(doc);
  assert.equal(faces.length, 36);
  near(faceAt(faces, { x: 90, y: 90 }).area, 3600);
});

test('a dangling stroke inside a face does not split it', () => {
  const doc = makeDoc(); square(doc);
  polyline(doc, [{ x: 120, y: 120 }, { x: 150, y: 150 }]);
  const faces = computeFaces(doc);
  assert.equal(faces.length, 9);
  near(faceAt(faces, { x: 70, y: 70 }).area, 14400);
});

test('clone edges from a 180° rotation close regions with the source edges', () => {
  const doc = makeDoc();
  const top = polyline(doc, [{ x: 0, y: 0 }, { x: 240, y: 0 }]);
  const left = polyline(doc, [{ x: 0, y: 0 }, { x: 0, y: 240 }]);
  polyline(doc, [{ x: 0, y: 0 }, { x: 240, y: 240 }]);
  const r2 = P.addElement(doc, { kind: 'rotate', cx: 120, cy: 120, n: 2 });
  P.addBinding(doc, top.id, [r2.id]); P.addBinding(doc, left.id, [r2.id]);
  const faces = computeFaces(doc);
  assert.equal(faces.length, 18);
  near(faceAt(faces, { x: 60, y: 180 }).area, 28800);
  near(faceAt(faces, { x: 180, y: 60 }).area, 28800);
});

test('a face straddling the cell edge is found once per copy', () => {
  const doc = makeDoc();
  polyline(doc, [{ x: 180, y: 60 }, { x: 300, y: 60 }, { x: 300, y: 180 }, { x: 180, y: 180 }], true);
  const faces = computeFaces(doc);
  assert.equal(faces.filter((f) => f.poly.some((p) => Math.abs(p.x - 240) < 1e-6)).length, 0); // no vertex on the cell edge
  near(faceAt(faces, { x: 240, y: 120 }).area, 14400);
  near(faceAt(faces, { x: 0, y: 120 }).area, 14400);
});

test('coincident edges from a mirror on the path are deduplicated', () => {
  const doc = makeDoc();
  const sq = square(doc);
  const m = P.addElement(doc, { kind: 'mirror', cx: 120, cy: 0, angle: 90 });
  P.addBinding(doc, sq.id, [m.id]);
  const faces = computeFaces(doc);
  assert.equal(faces.length, 9);
  near(faceAt(faces, { x: 120, y: 120 }).area, 14400);
});

test('a curved face is rebuilt from exact sub-curves', () => {
  const seg = { a: { x: 0, y: 0 }, cp: { x: 50, y: 100 }, b: { x: 100, y: 0 } };
  const left = subCurve(seg, 0, 0.5), right = subCurve(seg, 0.5, 1);
  near(left.b.x, 50); near(left.b.y, 50);
  near(right.a.x, 50);
  near(left.cp.x, 25); near(left.cp.y, 50);
  near(right.cp.x, 75); near(right.cp.y, 50);
  const doc = makeDoc();
  const path = polyline(doc, [{ x: 60, y: 60 }, { x: 180, y: 60 }], true);
  P.setControlPoint(doc, path.id, 0, { x: 120, y: 0 });
  P.setControlPoint(doc, path.id, 1, { x: 120, y: 120 });
  const faces = computeFaces(doc);
  const f = faceAt(faces, { x: 120, y: 60 });
  assert.ok(f);
  const d = facePathData(f);
  assert.match(d, /^M/); assert.match(d, /Q/); assert.match(d, /Z$/);
});

test('computeFaces is memoised on document geometry', () => {
  const doc = makeDoc(); square(doc);
  const a = computeFaces(doc);
  assert.equal(computeFaces(doc), a);
  doc.fills.push({ id: 'f', x: 1, y: 1, color: '#000' });
  assert.equal(computeFaces(doc), a); // fills do not change geometry
  P.movePoint(doc, doc.points[0].id, 61, 60);
  assert.notEqual(computeFaces(doc), a);
});

test('collectSegments skips zero-length segments', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  P.appendNode(doc, path.id, { pointId: path.nodes[1].pointId, cell: { c: 0, r: 0 } }); // ignored by appendNode
  doc.points.push({ id: 'dup', x: 10, y: 0 });
  path.nodes.push({ pointId: 'dup', cell: { c: 0, r: 0 } }); path.cps.push(null);
  assert.equal(collectSegments(doc).length, 9);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/regions.test.js`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Create `js/regions.js`**

```js
// Regions: every stroke and clone in the 3×3 window is split at crossings, walked into a planar
// graph, and its faces are returned with exact curve pieces. Fills resolve to faces by seed point.
import { windowOffsets } from './lattice.js';
import { apply, cellMatrix, compose, orbit } from './transform.js';
import { pathWorld } from './paths.js';

const MERGE = 1e-4;   // vertices closer than this are one vertex
const T_EPS = 1e-7;   // split parameters closer than this are one split
const AREA_EPS = 1e-6;

function bez(s, t) {
  if (!s.cp) return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
  const u = 1 - t;
  return { x: u * u * s.a.x + 2 * u * t * s.cp.x + t * t * s.b.x, y: u * u * s.a.y + 2 * u * t * s.cp.y + t * t * s.b.y };
}

function sampleCount(s) {
  if (!s.cp) return 1;
  const len = Math.hypot(s.cp.x - s.a.x, s.cp.y - s.a.y) + Math.hypot(s.b.x - s.cp.x, s.b.y - s.cp.y);
  return Math.max(8, Math.min(32, Math.round(len / 8)));
}

// Exact quadratic sub-curve on [t0, t1] (blossom form).
export function subCurve(s, t0, t1) {
  const lerp = (u, v, t) => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t });
  return { a: bez(s, t0), cp: lerp(lerp(s.a, s.cp, t0), lerp(s.cp, s.b, t0), t1), b: bez(s, t1) };
}

// 1. Segments from every path and clone, in every cell of the 3×3 window.
export function collectSegments(doc, cap = 12) {
  const segs = [];
  const push = (Pw, Cw, source) => {
    for (let j = 0; j < Pw.length - 1; j++) {
      const a = Pw[j], b = Pw[j + 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) < MERGE) continue;
      segs.push({ a, b, cp: Cw[j] || null, source: { ...source, j } });
    }
  };
  const clones = doc.bindings.map((b) => ({ b, ms: orbit(b.ops, doc.elements, doc.lattice, cap).matrices }));
  for (const o of windowOffsets()) {
    const Mo = cellMatrix(o.c, o.r, doc.lattice);
    for (const path of doc.paths) {
      const Pl = pathWorld(doc, path), C = path.cps;
      push(Pl.map((p) => apply(Mo, p)), C.map((c) => c && apply(Mo, c)), { pathId: path.id, cell: o });
      for (const { b, ms } of clones) {
        if (b.pathId !== path.id) continue;
        ms.forEach((M, k) => {
          const MM = compose(Mo, M);
          push(Pl.map((p) => apply(MM, p)), C.map((c) => c && apply(MM, c)), { pathId: path.id, cell: o, bindingId: b.id, power: k + 1 });
        });
      }
    }
  }
  return segs;
}

// 2. Flatten, find crossings with a spatial hash, collect split parameters per segment.
function pieces(segs) {
  const out = [];
  segs.forEach((s, si) => {
    const n = sampleCount(s);
    let prev = bez(s, 0);
    for (let i = 1; i <= n; i++) {
      const t = i / n, p = bez(s, t);
      out.push({ si, t0: (i - 1) / n, t1: t, p: prev, q: p });
      prev = p;
    }
  });
  return out;
}

function intersect(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y, d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den;
  const e = 1e-9;
  if (t < -e || t > 1 + e || u < -e || u > 1 + e) return null;
  return { t: Math.min(1, Math.max(0, t)), u: Math.min(1, Math.max(0, u)) };
}

function splitParams(segs) {
  const ps = pieces(segs);
  const params = segs.map(() => [0, 1]);
  if (!ps.length) return params;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pc of ps) {
    minX = Math.min(minX, pc.p.x, pc.q.x); maxX = Math.max(maxX, pc.p.x, pc.q.x);
    minY = Math.min(minY, pc.p.y, pc.q.y); maxY = Math.max(maxY, pc.p.y, pc.q.y);
  }
  const cell = Math.max((maxX - minX) / 64, (maxY - minY) / 64, 1);
  const buckets = new Map();
  ps.forEach((pc, i) => {
    const x0 = Math.floor((Math.min(pc.p.x, pc.q.x) - minX) / cell), x1 = Math.floor((Math.max(pc.p.x, pc.q.x) - minX) / cell);
    const y0 = Math.floor((Math.min(pc.p.y, pc.q.y) - minY) / cell), y1 = Math.floor((Math.max(pc.p.y, pc.q.y) - minY) / cell);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const k = x * 4096 + y;
      let list = buckets.get(k);
      if (!list) buckets.set(k, (list = []));
      list.push(i);
    }
  });
  const seen = new Set();
  for (const list of buckets.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const A = ps[list[i]], B = ps[list[j]];
      if (A.si === B.si) continue;
      const key = Math.min(list[i], list[j]) * 1e7 + Math.max(list[i], list[j]);
      if (seen.has(key)) continue;
      seen.add(key);
      const h = intersect(A.p, A.q, B.p, B.q);
      if (!h) continue;
      params[A.si].push(A.t0 + (A.t1 - A.t0) * h.t);
      params[B.si].push(B.t0 + (B.t1 - B.t0) * h.u);
    }
  }
  return params.map((list) => {
    const s = list.sort((a, b) => a - b);
    const out = [s[0]];
    for (const t of s) if (t - out[out.length - 1] > T_EPS) out.push(t);
    return out;
  });
}

// 3. Planar graph: merged vertices, deduplicated edges, half-edges sorted by angle, next pointers.
function buildGraph(segs, params) {
  const verts = [];
  const grid = new Map();
  const vertexAt = (p) => {
    const gx = Math.round(p.x / MERGE), gy = Math.round(p.y / MERGE);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const list = grid.get(`${gx + dx},${gy + dy}`);
      if (!list) continue;
      for (const id of list) if (Math.hypot(verts[id].x - p.x, verts[id].y - p.y) <= MERGE) return id;
    }
    const id = verts.length;
    verts.push({ x: p.x, y: p.y, out: [] });
    const key = `${gx},${gy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(id);
    return id;
  };
  const edges = [];
  const edgeKeys = new Set();
  segs.forEach((s, si) => {
    const ts = params[si];
    for (let k = 0; k < ts.length - 1; k++) {
      const t0 = ts[k], t1 = ts[k + 1];
      const n = s.cp ? Math.max(2, Math.ceil(sampleCount(s) * (t1 - t0))) : 1;
      const poly = [];
      for (let i = 0; i <= n; i++) poly.push(bez(s, t0 + ((t1 - t0) * i) / n));
      const va = vertexAt(poly[0]), vb = vertexAt(poly[n]);
      if (va === vb) continue;
      const mid = bez(s, (t0 + t1) / 2);
      const key = `${Math.min(va, vb)}:${Math.max(va, vb)}:${Math.round(mid.x / MERGE)},${Math.round(mid.y / MERGE)}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ va, vb, poly, seg: s, t0, t1 });
    }
  });
  const half = [];
  edges.forEach((e, ei) => {
    const n = e.poly.length;
    const fwd = { from: e.va, to: e.vb, edge: ei, rev: false, angle: Math.atan2(e.poly[1].y - e.poly[0].y, e.poly[1].x - e.poly[0].x) };
    const bwd = { from: e.vb, to: e.va, edge: ei, rev: true, angle: Math.atan2(e.poly[n - 2].y - e.poly[n - 1].y, e.poly[n - 2].x - e.poly[n - 1].x) };
    fwd.twin = half.length + 1; bwd.twin = half.length;
    half.push(fwd, bwd);
    verts[e.va].out.push(half.length - 2);
    verts[e.vb].out.push(half.length - 1);
  });
  for (const v of verts) v.out.sort((a, b) => half[a].angle - half[b].angle);
  for (const h of half) {
    const v = verts[h.to];
    const idx = v.out.indexOf(h.twin);
    h.next = v.out[(idx - 1 + v.out.length) % v.out.length];
  }
  return { verts, edges, half };
}

// 4. Walk faces (interior on the left, positive shoelace area). Outer boundaries come out negative and are dropped.
function walkFaces(g) {
  const faces = [];
  const visited = new Array(g.half.length).fill(false);
  for (let s = 0; s < g.half.length; s++) {
    if (visited[s]) continue;
    const loop = [];
    let i = s, guard = 0;
    while (!visited[i] && guard++ <= g.half.length) { visited[i] = true; loop.push(i); i = g.half[i].next; }
    const poly = [];
    for (const hi of loop) {
      const h = g.half[hi], e = g.edges[h.edge];
      const pts = h.rev ? e.poly.slice().reverse() : e.poly;
      for (let k = 0; k < pts.length - 1; k++) poly.push(pts[k]);
    }
    let area = 0;
    for (let k = 0; k < poly.length; k++) { const p = poly[k], q = poly[(k + 1) % poly.length]; area += p.x * q.y - q.x * p.y; }
    area /= 2;
    if (area <= AREA_EPS) continue;
    const pcs = loop.map((hi) => { const h = g.half[hi], e = g.edges[h.edge]; return { seg: e.seg, t0: e.t0, t1: e.t1, reversed: h.rev }; });
    faces.push({ poly, area, pieces: pcs });
  }
  faces.sort((a, b) => b.area - a.area);
  return faces;
}

let cache = { key: null, faces: [] };
function docKey(doc) { return JSON.stringify([doc.lattice, doc.points, doc.paths, doc.elements, doc.bindings]); }

export function computeFaces(doc) {
  const key = docKey(doc);
  if (cache.key === key) return cache.faces;
  let faces = [];
  try {
    const segs = collectSegments(doc);
    faces = walkFaces(buildGraph(segs, splitParams(segs)));
  } catch (err) {
    console.error('regions: face computation failed', err);
    faces = [];
  }
  cache = { key, faces };
  return faces;
}

export function pointInPoly(poly, p) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Smallest face containing p (faces are sorted largest first).
export function faceAt(faces, p) {
  for (let i = faces.length - 1; i >= 0; i--) if (pointInPoly(faces[i].poly, p)) return faces[i];
  return null;
}

export function facePathData(face) {
  const parts = [];
  face.pieces.forEach((pc, i) => {
    const s = pc.seg;
    let a, cp, b;
    if (s.cp) ({ a, cp, b } = subCurve(s, pc.t0, pc.t1));
    else { a = bez(s, pc.t0); b = bez(s, pc.t1); cp = null; }
    if (pc.reversed) [a, b] = [b, a];
    if (i === 0) parts.push(`M${a.x},${a.y}`);
    parts.push(cp ? `Q${cp.x},${cp.y} ${b.x},${b.y}` : `L${b.x},${b.y}`);
  });
  return parts.join(' ') + ' Z';
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/regions.test.js`
Expected: all pass. If the crossing-lines count is off, check that T-junction touches at the square's edges are found (the tolerance `e` in `intersect` must admit `t = 0` and `t = 1`). If the mirror test yields more than 9 faces, check the edge dedup key.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`
Expected: all files pass.

```bash
git add js/regions.js tests/regions.test.js
git commit -m "Add planar-arrangement regions with exact curve faces

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 8: SVG rendering and boot with an example document

**Files:**
- Create: `js/render.js`, `js/example.js`
- Modify: `js/main.js` (replace the placeholder)

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: `render(svg, afterRender?)`, `el(tag, attrs, parent?)`, `seedOf(world) → {x, y}` (base-cell frame), `loadExample()`.
- Every pointer-sensitive SVG element carries `data-kind` and the ids below. Later tasks dispatch on exactly these names:

| data-kind | other data attributes |
|---|---|
| `point` | `data-id`, `data-cell="c,r"` (the copy's cell) |
| `segment` | `data-path`, `data-j`, `data-binding` ('' for the source), `data-power` (0 for the source) |
| `canchor` | `data-binding`, `data-power`, `data-point`, `data-cell` (the source node's cell) |
| `diamond` | `data-path`, `data-j`, `data-binding`, `data-power` |
| `bbox` | `data-h` (0–7, order of `bboxHandles`) |
| `bboxrot` | — |
| `fill` | `data-id` |
| `element` | `data-id` |
| `elrot` | `data-id` (mirror rotate knob) |
| `eltip` | `data-id` (translation arrow / tip) |
| `lat` | `data-which` ('a' or 'b') |

- [ ] **Step 1: Create `js/render.js`**

```js
// Full rebuild of the SVG from state. Order (bottom to top) follows spec §7.
import { state, getPath, getBinding, selectedPathId, selectedElementId, selectedPointIds } from './state.js';
import { CONFIG } from './config.js';
import { toWorld, windowOffsets, visibleOffsets, fromUV, cellOf } from './lattice.js';
import { IDENTITY, apply, cellMatrix, compose, orbit, toSvg } from './transform.js';
import { pathWorld, bounds, nodeWorld } from './paths.js';
import { bboxHandles } from './hit.js';
import { computeFaces, faceAt, facePathData } from './regions.js';

const NS = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== '') n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

const isBase = (o) => o.c === 0 && o.r === 0;
const segD = (a, b, cp) => (cp ? `M${a.x},${a.y} Q${cp.x},${cp.y} ${b.x},${b.y}` : `M${a.x},${a.y} L${b.x},${b.y}`);
function pathD(P, C) { let d = ''; for (let j = 0; j < P.length - 1; j++) d += segD(P[j], P[j + 1], C[j]) + ' '; return d; }

// A world point expressed in the base-cell frame (used for fill seeds and hover lookup).
export function seedOf(world) { return cellOf(world, state.lattice).local; }

function buildContext() {
  const z = state.view.zoom;
  const vis = visibleOffsets(state.view, state.lattice, state.viewport.width, state.viewport.height, CONFIG.VISIBLE_CELL_RADIUS);
  const clonesOf = new Map();
  for (const b of state.bindings) {
    if (!clonesOf.has(b.pathId)) clonesOf.set(b.pathId, []);
    const list = clonesOf.get(b.pathId);
    orbit(b.ops, state.elements, state.lattice, CONFIG.ORBIT_CAP).matrices.forEach((M, k) => list.push({ bindingId: b.id, power: k + 1, M }));
  }
  const drawing = state.layer === 'drawing';
  const freeDrag = !!(state.drag && state.drag.kind === 'free');
  return {
    z, vis, win: windowOffsets(), clonesOf, drawing,
    sel: state.selection, selPath: selectedPathId(), selEl: selectedElementId(), selPts: new Set(selectedPointIds()),
    drawPE: drawing ? 'auto' : 'none', consPE: drawing ? 'none' : 'auto',
    segHit: drawing && state.tool === 'select' && !state.pen && !freeDrag,
    fillHit: drawing && state.tool === 'select',
    showAllPoints: drawing && (!!state.pen || state.tool === 'freehand'),
    faces: computeFaces(state),
  };
}

// The source entry plus one entry per clone matrix.
function entries(ctx, path) {
  return [{ M: IDENTITY, bindingId: null, power: 0 }, ...(ctx.clonesOf.get(path.id) || [])];
}
function isSelectedEntry(ctx, path, e) {
  const s = ctx.sel;
  if (!s) return false;
  if (e.bindingId) return s.kind === 'clone' && s.bindingId === e.bindingId && s.power === e.power;
  return s.kind === 'path' && s.id === path.id;
}
function isLinked(ctx, path, e) {
  if (path.id === ctx.selPath) return true;
  if (e.bindingId && ctx.selEl) { const b = getBinding(e.bindingId); return !!b && b.ops.includes(ctx.selEl); }
  return false;
}
function selectedEntry(ctx) {
  if (!ctx.sel || !ctx.selPath) return null;
  const path = getPath(ctx.selPath);
  if (!path) return null;
  const e = entries(ctx, path).find((x) => isSelectedEntry(ctx, path, x));
  return e ? { path, e } : null;
}

export function render(svg, afterRender) {
  svg.replaceChildren();
  const ctx = buildContext();
  svg.style.cursor = state.space && state.pen ? 'grab' : (state.tool === 'select' || state.tool === 'fill' || !ctx.drawing) ? 'default' : 'crosshair';
  const root = el('g', { transform: `translate(${state.view.pan.x},${state.view.pan.y}) scale(${ctx.z})` }, svg);
  renderGrid(root, ctx);
  renderFrames(root, ctx);
  renderElementGhosts(root, ctx);
  renderStrokes(root, ctx, 'structure');
  renderFills(root, ctx);
  renderStrokes(root, ctx, 'detail');
  renderGuides(root, ctx);
  renderFreehand(root, ctx);
  renderMarquee(root, ctx);
  renderRubber(root, ctx);
  renderBBox(root, ctx);
  renderDiamonds(root, ctx);
  renderPoints(root, ctx);
  renderCloneAnchors(root, ctx);
  renderElements(root, ctx);
  renderLattice(root, ctx);
  if (afterRender) afterRender();
}

function renderGrid(root) {
  const lat = state.lattice, div = state.gridDivisions;
  const g = el('g', {}, root);
  for (let i = 1; i < div; i++) {
    const t = i / div;
    el('line', { x1: lat.ax * t, y1: lat.ay * t, x2: lat.ax * t + lat.bx, y2: lat.ay * t + lat.by, class: 'grid-line' }, g);
    el('line', { x1: lat.bx * t, y1: lat.by * t, x2: lat.bx * t + lat.ax, y2: lat.by * t + lat.ay, class: 'grid-line' }, g);
  }
}

function cellPolygon(o) {
  const lat = state.lattice, t = toWorld(o, lat);
  return [[0, 0], [lat.ax, lat.ay], [lat.ax + lat.bx, lat.ay + lat.by], [lat.bx, lat.by]].map(([x, y]) => `${x + t.x},${y + t.y}`).join(' ');
}

function renderFrames(root, ctx) {
  const g = el('g', {}, root);
  for (const o of ctx.vis) el('polygon', { points: cellPolygon(o), class: isBase(o) ? 'frame base' : 'frame' }, g);
}

function latticeRadius() {
  const lat = state.lattice;
  return 1.5 * Math.max(Math.hypot(lat.ax, lat.ay), Math.hypot(lat.bx, lat.by), Math.hypot(lat.ax + lat.bx, lat.ay + lat.by) * 0.6);
}
const dirOf = (e) => ({ x: Math.cos((e.angle * Math.PI) / 180), y: Math.sin((e.angle * Math.PI) / 180) });

function renderElementGhosts(root, ctx) {
  const g = el('g', {}, root);
  const E = 2.4 * latticeRadius();
  for (const e of state.elements) {
    for (const o of ctx.vis) {
      if (isBase(o)) continue;
      const t = toWorld(o, state.lattice);
      if (e.kind === 'rotate') el('circle', { cx: e.cx + t.x, cy: e.cy + t.y, r: 6 / ctx.z, class: 'el-ghost' }, g);
      else if (e.kind === 'mirror') { const d = dirOf(e); el('line', { x1: e.cx + t.x - E * d.x, y1: e.cy + t.y - E * d.y, x2: e.cx + t.x + E * d.x, y2: e.cy + t.y + E * d.y, class: 'el-ghost' }, g); }
    }
  }
}

function renderStrokes(root, ctx, layer) {
  const g = el('g', { class: ctx.drawing ? null : 'inactive-layer' }, root);
  for (const path of state.paths) {
    if ((path.layer || 'structure') !== layer) continue;
    const P = pathWorld(state, path), C = path.cps, sty = path.style;
    for (const e of entries(ctx, path)) {
      const selected = isSelectedEntry(ctx, path, e), linked = !selected && isLinked(ctx, path, e);
      for (const o of ctx.vis) {
        const M = compose(cellMatrix(o.c, o.r, state.lattice), e.M);
        const Pw = P.map((p) => apply(M, p)), Cw = C.map((c) => c && apply(M, c));
        if (!isBase(o)) {
          el('path', { d: pathD(Pw, Cw), class: 'stroke', stroke: sty.color, 'stroke-width': sty.weight, opacity: state.ghostOpacity }, g);
          continue;
        }
        for (let j = 0; j < Pw.length - 1; j++) {
          const d = segD(Pw[j], Pw[j + 1], Cw[j]);
          if (selected || linked) el('path', { d, class: 'halo', 'stroke-width': sty.weight + 6 / ctx.z, opacity: selected ? 0.3 : 0.15 }, g);
          el('path', { d, class: 'stroke', stroke: sty.color, 'stroke-width': sty.weight }, g);
          if (ctx.segHit) el('path', { d, class: 'seg-hit', 'stroke-width': CONFIG.HIT_WIDTH / ctx.z, 'pointer-events': 'stroke',
            'data-kind': 'segment', 'data-path': path.id, 'data-j': j, 'data-binding': e.bindingId || null, 'data-power': e.power }, g);
        }
      }
    }
  }
}

function renderFills(root, ctx) {
  const g = el('g', { class: ctx.drawing ? null : 'inactive-layer' }, root);
  const resolved = state.fills.map((f) => ({ f, face: faceAt(ctx.faces, f) })).filter((r) => r.face).sort((a, b) => b.face.area - a.face.area);
  for (const { f, face } of resolved) {
    const d = facePathData(face);
    for (const o of ctx.vis) {
      const t = toWorld(o, state.lattice), hit = ctx.fillHit && isBase(o);
      el('path', { d, transform: `translate(${t.x},${t.y})`, class: hit ? 'fill hit' : 'fill', fill: f.color, opacity: isBase(o) ? 1 : state.ghostOpacity,
        'pointer-events': hit ? 'auto' : 'none', 'data-kind': 'fill', 'data-id': f.id }, g);
    }
  }
  if (ctx.drawing && state.tool === 'fill' && state.hoverPoint && !state.drag) {
    const hf = faceAt(ctx.faces, seedOf(state.hoverPoint));
    if (hf) { const d = facePathData(hf); for (const o of ctx.vis) { const t = toWorld(o, state.lattice); el('path', { d, transform: `translate(${t.x},${t.y})`, class: 'fill-hover' }, g); } }
  }
}

function renderGuides(root, ctx) {
  const se = selectedEntry(ctx);
  if (!se) return;
  const P = pathWorld(state, se.path).map((p) => apply(se.e.M, p)), C = se.path.cps.map((c) => c && apply(se.e.M, c));
  for (let j = 0; j < P.length - 1; j++) {
    if (!C[j]) continue;
    el('line', { x1: P[j].x, y1: P[j].y, x2: C[j].x, y2: C[j].y, class: 'guide' }, root);
    el('line', { x1: C[j].x, y1: C[j].y, x2: P[j + 1].x, y2: P[j + 1].y, class: 'guide' }, root);
  }
}

function renderFreehand(root, ctx) {
  const d = state.drag;
  if (!d || d.kind !== 'free' || d.raw.length < 2) return;
  const dd = d.raw.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  for (const o of ctx.vis) {
    const Mo = cellMatrix(o.c, o.r, state.lattice);
    for (const M of [IDENTITY, ...(d.cloneMatrices || [])]) {
      if (isBase(o) && M === IDENTITY) continue;
      el('path', { d: dd, transform: toSvg(compose(Mo, M)), class: 'free', stroke: state.style.color, 'stroke-width': state.style.weight, opacity: 0.3 }, root);
    }
  }
  el('path', { d: dd, class: 'free', stroke: state.style.color, 'stroke-width': state.style.weight, opacity: 0.9 }, root);
}

function renderMarquee(root) {
  const d = state.drag;
  if (!d || d.kind !== 'marquee' || !d.moved) return;
  el('rect', { x: Math.min(d.start.x, d.cur.x), y: Math.min(d.start.y, d.cur.y), width: Math.abs(d.cur.x - d.start.x), height: Math.abs(d.cur.y - d.start.y), class: 'marquee' }, root);
}

function renderRubber(root) {
  if (!state.pen || !state.cursor) return;
  const path = getPath(state.pen.pathId);
  if (!path || !path.nodes.length) return;
  const last = nodeWorld(state, path.nodes[path.nodes.length - 1]);
  el('line', { x1: last.x, y1: last.y, x2: state.cursor.x, y2: state.cursor.y, class: 'rubber' }, root);
}

function renderBBox(root, ctx) {
  if (!ctx.drawing || state.tool !== 'select' || !ctx.sel || ctx.sel.kind !== 'path') return;
  const path = getPath(ctx.sel.id);
  if (!path || path.nodes.length < 2) return;
  const d = state.drag, bd = !!(d && d.kind === 'bbox');
  const box = bd ? d.box : bounds(state, path.id);
  let corners = [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }];
  if (bd && d.M) corners = corners.map((c) => apply(d.M, c));
  for (const o of ctx.vis) {
    const t = toWorld(o, state.lattice);
    el('polygon', { points: corners.map((c) => `${c.x + t.x},${c.y + t.y}`).join(' '), class: isBase(o) ? 'bbox' : 'bbox ghost' }, root);
  }
  if (bd) return;
  const s = 10 / ctx.z;
  bboxHandles(box).forEach((h, i) => el('rect', { x: h.x - s / 2, y: h.y - s / 2, width: s, height: s, class: 'handle', style: `cursor:${h.cursor}`, 'data-kind': 'bbox', 'data-h': i }, root));
  const cx = (box.x0 + box.x1) / 2, ry = box.y0 - CONFIG.BBOX_ROT_OFFSET / ctx.z;
  el('line', { x1: cx, y1: box.y0, x2: cx, y2: ry, class: 'guide' }, root);
  el('circle', { cx, cy: ry, r: 6 / ctx.z, class: 'handle', style: 'cursor:grab', 'data-kind': 'bboxrot' }, root);
}

function renderDiamonds(root, ctx) {
  if (!ctx.drawing || state.tool === 'freehand' || state.tool === 'fill') return;
  const se = selectedEntry(ctx);
  if (!se) return;
  const P = pathWorld(state, se.path).map((p) => apply(se.e.M, p)), C = se.path.cps.map((c) => c && apply(se.e.M, c));
  const s = CONFIG.HANDLE_SIZE / ctx.z;
  for (let j = 0; j < P.length - 1; j++) {
    const h = C[j] || { x: (P[j].x + P[j + 1].x) / 2, y: (P[j].y + P[j + 1].y) / 2 };
    el('rect', { x: h.x - s / 2, y: h.y - s / 2, width: s, height: s, transform: `rotate(45 ${h.x} ${h.y})`, class: 'diamond',
      fill: C[j] ? CONFIG.COLORS.accent : CONFIG.COLORS.background, 'pointer-events': ctx.drawPE,
      'data-kind': 'diamond', 'data-path': se.path.id, 'data-j': j, 'data-binding': se.e.bindingId || null, 'data-power': se.e.power }, root);
  }
}

function renderPoints(root, ctx) {
  const g = el('g', { class: ctx.drawing ? null : 'inactive-layer' }, root);
  const show = new Set(ctx.selPts);
  const penPath = state.pen ? getPath(state.pen.pathId) : null;
  const selPath = ctx.selPath ? getPath(ctx.selPath) : null;
  for (const p of [penPath, selPath]) if (p) for (const n of p.nodes) show.add(n.pointId);
  const penLast = penPath && penPath.nodes.length ? penPath.nodes[penPath.nodes.length - 1] : null;
  for (const o of ctx.win) {
    const t = toWorld(o, state.lattice);
    for (const pt of state.points) {
      if (!ctx.showAllPoints && !show.has(pt.id)) continue;
      const isLast = !!penLast && penLast.pointId === pt.id && penLast.cell.c === o.c && penLast.cell.r === o.r;
      let cls = 'pt';
      if (isLast || ctx.selPts.has(pt.id)) cls += ' sel';
      if (state.hover === pt.id) cls += ' hover';
      if (!isBase(o)) cls += ' dim';
      el('circle', { cx: pt.x + t.x, cy: pt.y + t.y, r: (isBase(o) ? CONFIG.POINT_RADIUS : CONFIG.POINT_RADIUS - 1) / ctx.z, class: cls,
        'pointer-events': ctx.drawPE, 'data-kind': 'point', 'data-id': pt.id, 'data-cell': `${o.c},${o.r}` }, g);
    }
  }
}

function renderCloneAnchors(root, ctx) {
  if (!ctx.drawing) return;
  const s = 10 / ctx.z;
  for (const path of state.paths) {
    const P = pathWorld(state, path);
    for (const e of entries(ctx, path)) {
      if (!e.bindingId) continue;
      const selected = isSelectedEntry(ctx, path, e);
      if (!selected && state.tool !== 'freehand') continue;
      path.nodes.forEach((n, j) => {
        const w = apply(e.M, P[j]);
        el('rect', { x: w.x - s / 2, y: w.y - s / 2, width: s, height: s, rx: 2 / ctx.z, class: selected ? 'canchor sel' : 'canchor', 'pointer-events': ctx.drawPE,
          'data-kind': 'canchor', 'data-binding': e.bindingId, 'data-power': e.power, 'data-point': n.pointId, 'data-cell': `${n.cell.c},${n.cell.r}` }, root);
      });
    }
  }
}

function renderElements(root, ctx) {
  const g = el('g', { class: ctx.drawing ? 'inactive-layer' : null }, root);
  const z = ctx.z, E = 2.4 * latticeRadius();
  const armed = new Set(state.newPathOps.flat());
  for (const e of state.elements) {
    const selected = ctx.selEl === e.id;
    const isSelf = !!ctx.sel && ctx.sel.kind === 'element' && ctx.sel.id === e.id;
    const markClass = 'el-mark' + (armed.has(e.id) ? ' armed' : '');
    if (e.kind === 'rotate') {
      el('line', { x1: e.cx - 14 / z, y1: e.cy, x2: e.cx + 14 / z, y2: e.cy, class: 'el-cross' }, g);
      el('line', { x1: e.cx, y1: e.cy - 14 / z, x2: e.cx, y2: e.cy + 14 / z, class: 'el-cross' }, g);
      el('circle', { cx: e.cx, cy: e.cy, r: (selected ? 9 : 7) / z, class: markClass, 'stroke-width': selected ? 2.5 : 1.5, 'pointer-events': ctx.consPE, 'data-kind': 'element', 'data-id': e.id }, g);
      el('text', { x: e.cx + 10 / z, y: e.cy - 10 / z, class: 'el-label', 'font-size': 11 / z }, g).textContent = `${e.n}`;
    } else if (e.kind === 'mirror') {
      const d = dirOf(e);
      const x1 = e.cx - E * d.x, y1 = e.cy - E * d.y, x2 = e.cx + E * d.x, y2 = e.cy + E * d.y;
      el('line', { x1, y1, x2, y2, class: 'el-line', 'stroke-width': selected ? 2.5 : 1.5, opacity: armed.has(e.id) || selected ? 1 : 0.6 }, g);
      el('line', { x1, y1, x2, y2, class: 'el-hit', 'stroke-width': CONFIG.HIT_WIDTH / z, 'pointer-events': ctx.consPE === 'auto' ? 'stroke' : 'none', 'data-kind': 'element', 'data-id': e.id }, g);
      el('circle', { cx: e.cx, cy: e.cy, r: (selected ? 8 : 6) / z, class: markClass, 'stroke-width': selected ? 2.5 : 1.5, 'pointer-events': ctx.consPE, 'data-kind': 'element', 'data-id': e.id }, g);
      if (isSelf) {
        const R = CONFIG.ELEMENT_ROT_OFFSET / z, rx = e.cx + R * d.x, ry = e.cy + R * d.y;
        el('circle', { cx: rx, cy: ry, r: 6 / z, class: 'el-knob', 'pointer-events': ctx.consPE, 'data-kind': 'elrot', 'data-id': e.id }, g);
      }
    } else if (e.kind === 'translate') {
      const v = fromUV(e.u, e.v, state.lattice);
      el('line', { x1: 0, y1: 0, x2: v.x, y2: v.y, class: 'el-arrow', opacity: armed.has(e.id) || selected ? 1 : 0.6 }, g);
      el('line', { x1: 0, y1: 0, x2: v.x, y2: v.y, class: 'el-hit', 'stroke-width': CONFIG.HIT_WIDTH / z, 'pointer-events': ctx.consPE === 'auto' ? 'stroke' : 'none', 'data-kind': 'eltip', 'data-id': e.id }, g);
      const s = 10 / z;
      el('rect', { x: v.x - s / 2, y: v.y - s / 2, width: s, height: s, transform: `rotate(45 ${v.x} ${v.y})`, class: markClass, 'pointer-events': ctx.consPE, 'data-kind': 'eltip', 'data-id': e.id }, g);
      el('text', { x: v.x + 10 / z, y: v.y - 10 / z, class: 'el-label', 'font-size': 11 / z }, g).textContent = `${fmtFrac(e.u)}, ${fmtFrac(e.v)}`;
    }
  }
}

// 0.5 → "1/2", 0.3333 → "1/3", 0 → "0", 0.4 → "0.4"
export function fmtFrac(x) {
  if (Math.abs(x) < 1e-9) return '0';
  for (const d of [1, 2, 3, 4, 6, 12]) { const n = Math.round(x * d); if (Math.abs(n / d - x) < 1e-6) return d === 1 ? `${n}` : `${n}/${d}`; }
  return x.toFixed(2);
}

function renderLattice(root, ctx) {
  const g = el('g', { class: ctx.drawing ? 'inactive-layer' : null }, root);
  const lat = state.lattice, z = ctx.z;
  for (const [which, x, y] of [['a', lat.ax, lat.ay], ['b', lat.bx, lat.by]]) {
    el('line', { x1: 0, y1: 0, x2: x, y2: y, class: 'lat-line' }, g);
    el('circle', { cx: x, cy: y, r: 7 / z, class: 'lat-handle', 'pointer-events': ctx.consPE, 'data-kind': 'lat', 'data-which': which }, g);
    el('text', { x: x + 10 / z, y: y - 8 / z, class: 'lat-label', 'font-size': 11 / z }, g).textContent = which;
  }
}
```

- [ ] **Step 2: Create `js/example.js`**

```js
// A demo document: a wavy tile boundary cloned through a 180° turn, one fill, and a detail loop.
import { state } from './state.js';
import { CONFIG } from './config.js';
import * as P from './paths.js';

export function loadExample() {
  state.lattice = { ...CONFIG.LATTICE_PRESETS.Square };
  state.points = []; state.paths = []; state.elements = []; state.bindings = []; state.fills = [];
  const style = { color: '#1c1b18', weight: 2 };
  const r2 = P.addElement(state, { kind: 'rotate', cx: 120, cy: 120, n: 2 });
  state.newPathOps = [[r2.id]];

  const o = P.addPoint(state, { x: 0, y: 0 });
  const top = P.startPath(state, o, style);
  P.appendNode(state, top.id, P.addPoint(state, { x: 240, y: 0 }));
  P.setControlPoint(state, top.id, 0, { x: 120, y: 70 });
  P.addBinding(state, top.id, [r2.id]);

  const left = P.startPath(state, o, style);
  P.appendNode(state, left.id, P.addPoint(state, { x: 0, y: 240 }));
  P.setControlPoint(state, left.id, 0, { x: -60, y: 120 });
  P.addBinding(state, left.id, [r2.id]);

  const eye = P.startPath(state, P.addPoint(state, { x: 90, y: 100 }), { color: '#c2255c', weight: 2 }, 'detail');
  P.appendNode(state, eye.id, P.addPoint(state, { x: 120, y: 100 }));
  P.appendNode(state, eye.id, eye.nodes[0]);
  P.setControlPoint(state, eye.id, 0, { x: 105, y: 80 });
  P.setControlPoint(state, eye.id, 1, { x: 105, y: 120 });

  P.addFill(state, { x: 120, y: 150, color: '#c98a12' });
}
```

- [ ] **Step 3: Replace `js/main.js`**

```js
import { state } from './state.js';
import { render } from './render.js';
import { loadExample } from './example.js';
import { CONFIG } from './config.js';

const svg = document.getElementById('canvas');

function measure() {
  const r = svg.getBoundingClientRect();
  state.viewport = { width: r.width, height: r.height };
}

// Fit the base cell plus a margin into the viewport.
export function fitView() {
  const lat = state.lattice;
  const xs = [0, lat.ax, lat.bx, lat.ax + lat.bx], ys = [0, lat.ay, lat.by, lat.ay + lat.by];
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const zoom = Math.min(CONFIG.ZOOM_MAX, Math.max(CONFIG.ZOOM_MIN, Math.min(state.viewport.width / (w * 1.6), state.viewport.height / (h * 1.6))));
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  state.view = { zoom, pan: { x: state.viewport.width / 2 - cx * zoom, y: state.viewport.height / 2 - cy * zoom } };
}

function rerender() { render(svg); }

measure();
if (location.hash === '#example') loadExample();
fitView();
rerender();
window.addEventListener('resize', () => { measure(); rerender(); });
```

(`fitView` moves into `actions.js` in Task 9; here it lives in `main.js` so the scene is visible now.)

- [ ] **Step 4: Verify in the browser**

Serve and open `http://127.0.0.1:5173/#example`. Expected, with no console errors:
- A dotted 3×3-plus grid of square frames, the base cell in ink, grid lines inside it.
- A wavy boundary in the base cell, its 180° clone completing the tile, ghosted copies in every neighbouring cell.
- An ochre fill covering the tile region (the region bounded by the wavy top, its rotated copy at the bottom, the wavy left and its copy on the right) in the base cell, at reduced opacity elsewhere.
- A small red lens (the "eye") drawn above the fill.
- A violet rotation mark with a "2" at the cell centre (dimmed, since the layer is Drawing), and pink `a` / `b` handles.

If the fill is missing, run `computeFaces(state)` in the console (import `regions.js` as a module) and check `faces.length` is non-zero; a zero means the boundary is not closing, most likely because the wavy top's clone does not meet the left edge's clone within `MERGE`.

- [ ] **Step 5: Commit**

```bash
git add js/render.js js/example.js js/main.js
git commit -m "Render the scene from state: strokes, clones, fills, elements

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 9: User-level actions

**Files:**
- Create: `js/actions.js`
- Modify: `js/main.js` (import `fitView` from actions instead of defining it)

**Interfaces:**
- Consumes: state selectors, `history.js`, `paths.js`, `lattice.js`, `transform.js`, `hit.js`, `regions.js`, `freehand.js`.
- Produces (every function mutates state, records history where the spec says, and returns `true` if it did anything): `threshold()`, `cloneMatrix(bindingId, power) → M|null`, `setTool(tool)`, `setLayer(layer)`, `setSublayer(sub)`, `toggleSnap()`, `toggleHelp()`, `undo()`, `redo()`, `penClickEmpty(world, gridOn)`, `penClickNode(node)`, `endPen()`, `selectPath(id)`, `selectClone(bindingId, power)`, `selectElement(id)`, `selectFill(id)`, `selectPoints(ids)`, `togglePointSelection(id)`, `clearSel()`, `insertNodeOnSegment(pathId, j, world, M, gridOn)`, `straightenSegment(pathId, j)`, `deleteSelection()`, `deleteHoveredOrSelection()`, `setStyle(patch)`, `setFillColor(color)`, `togglePathLayer(pathId)`, `addElement(kind)`, `setRotationOrder(id, n)`, `rotateElement(id, deg)`, `rotateSelectedElement(deg)`, `setTranslation(id, u, v)`, `toggleNewPathChain(ops)`, `isNewPathChain(ops)`, `toggleOpOnBinding(bindingId, elementId)`, `addChain(pathId)`, `removeBinding(id)`, `deleteElement(id)`, `setLattice(lat)`, `fillAt(world)`, `finishFreehand(drag)`, `zoomAt(screen, factor)`, `panBy(dx, dy)`, `fitView()`.
- A `node` is `{ pointId, cell: {c, r} }`. `world`/`screen` are `{x, y}`.

- [ ] **Step 1: Create `js/actions.js`**

```js
// Every user-level mutation. Toolbar (ui.js) and keyboard/pointer (tools) call these so they stay in sync.
// Each pushes history itself where the spec requires and returns whether it changed anything.
import { state, getPath, getBinding, getElement, getFill, clearSelection, selectedPathId, selectedElementId } from './state.js';
import { CONFIG } from './config.js';
import * as H from './history.js';
import * as P from './paths.js';
import { toWorld, cellOf, snapToGrid } from './lattice.js';
import { apply, invert } from './transform.js';
import { snapWorld, projectOnSegment } from './hit.js';
import { computeFaces, faceAt } from './regions.js';
import { strokeToPath } from './freehand.js';

export const threshold = () => CONFIG.SNAP_PX / state.view.zoom;

export function cloneMatrix(bindingId, power) {
  const ms = P.cloneMatrices(state, bindingId, CONFIG.ORBIT_CAP).matrices;
  return ms[power - 1] || null;
}

// --- tools and layers

export function setTool(tool) {
  if (state.layer !== 'drawing') {
    state.layer = 'drawing';
    if (state.selection && state.selection.kind === 'element') clearSelection();
  }
  if (state.tool === tool) return false;
  endPen();
  state.tool = tool;
  if (tool === 'freehand' || tool === 'fill') clearSelection();
  if (tool !== 'fill') state.hoverPoint = null;
  return true;
}

export function setLayer(layer) {
  if (state.layer === layer) return false;
  endPen();
  state.layer = layer;
  const s = state.selection;
  if (s && (layer === 'construction') !== (s.kind === 'element')) clearSelection();
  return true;
}

export function setSublayer(sub) { state.sublayer = sub; return true; }
export function toggleSnap() { state.snap = !state.snap; return true; }
export function toggleHelp() { state.showHelp = !state.showHelp; return true; }
export function undo() { endPen(); return H.undo(); }
export function redo() { endPen(); return H.redo(); }

// --- pen

function bindNewPath(path) { for (const ops of state.newPathOps) P.addBinding(state, path.id, ops); }

// Click on empty canvas: add a point and start or extend the pen path. With a selection and no pen path, just deselect.
export function penClickEmpty(world, gridOn = true) {
  if (state.selection && !state.pen) { clearSelection(); return true; }
  const w = snapWorld(state, world, threshold(), state.gridDivisions, null, gridOn);
  H.push();
  const node = w.anchor && !w.anchor.bindingId ? { pointId: w.anchor.pointId, cell: w.anchor.cell } : P.addPoint(state, w);
  if (state.pen) {
    P.appendNode(state, state.pen.pathId, node);
  } else {
    const path = P.startPath(state, node, state.style, state.sublayer);
    bindNewPath(path);
    state.pen = { pathId: path.id };
  }
  return true;
}

// Click on an existing point or clone anchor (node already resolved to the source point + cell).
export function penClickNode(node) {
  if (state.pen) {
    const path = getPath(state.pen.pathId);
    const last = path.nodes[path.nodes.length - 1];
    if (P.sameNode(last, node)) { endPen(); return true; }
    H.push();
    P.appendNode(state, path.id, node);
    return true;
  }
  H.push();
  const openId = P.openEndAt(state, node.pointId);
  if (openId) {
    P.orientToEnd(state, openId, node.pointId, node.cell);
    state.pen = { pathId: openId };
    clearSelection();
    return true;
  }
  const path = P.startPath(state, node, state.style, state.sublayer);
  bindNewPath(path);
  state.pen = { pathId: path.id };
  clearSelection();
  return true;
}

export function endPen() {
  if (!state.pen) return false;
  const path = getPath(state.pen.pathId);
  if (path && path.nodes.length < 2) P.deletePath(state, path.id);
  state.pen = null;
  state.cursor = null;
  return true;
}

// --- selection

export function selectPath(id) { state.selection = { kind: 'path', id }; return true; }
export function selectClone(bindingId, power) { state.selection = { kind: 'clone', bindingId, power }; return true; }
export function selectElement(id) { state.selection = { kind: 'element', id }; return true; }
export function selectFill(id) { state.selection = { kind: 'fill', id }; return true; }
export function selectPoints(ids) { const u = [...new Set(ids)]; state.selection = u.length ? { kind: 'points', ids: u } : null; return true; }
export function togglePointSelection(id) {
  const cur = state.selection && state.selection.kind === 'points' ? state.selection.ids : [];
  return selectPoints(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
}
export function clearSel() { clearSelection(); return true; }

// --- segments

// Insert a node into segment j at the click. For a clone, `M` is the clone matrix so the click maps back to the source.
export function insertNodeOnSegment(pathId, j, world, M = null, gridOn = true) {
  const path = getPath(pathId);
  if (!path || j < 0 || j >= path.nodes.length - 1) return false;
  H.push();
  if (path.cps[j]) { P.insertNode(state, pathId, j, null); return true; }
  const A = P.nodeWorld(state, path.nodes[j]), B = P.nodeWorld(state, path.nodes[j + 1]);
  const w = M ? apply(invert(M), world) : world;
  let m = projectOnSegment(A, B, w);
  if (gridOn) m = snapToGrid(m, state.lattice, state.gridDivisions);
  P.insertNode(state, pathId, j, m);
  return true;
}

export function straightenSegment(pathId, j) {
  const path = getPath(pathId);
  if (!path || !path.cps[j]) return false;
  H.push();
  P.setControlPoint(state, pathId, j, null);
  return true;
}

// --- delete

function removeElementEverywhere(id) {
  P.deleteElement(state, id);
  state.newPathOps = state.newPathOps.map((c) => c.filter((x) => x !== id)).filter((c) => c.length);
}

export function deleteSelection() {
  const s = state.selection;
  if (!s) return false;
  H.push();
  if (s.kind === 'points') P.deletePoints(state, s.ids);
  else if (s.kind === 'path') P.deletePath(state, s.id);
  else if (s.kind === 'clone') P.removeBinding(state, s.bindingId);
  else if (s.kind === 'element') removeElementEverywhere(s.id);
  else if (s.kind === 'fill') P.removeFill(state, s.id);
  clearSelection();
  state.hover = null;
  endPen();
  return true;
}

// Backspace: the hovered point wins unless a multi-selection is active.
export function deleteHoveredOrSelection() {
  const s = state.selection;
  if (state.hover && !(s && s.kind === 'points')) {
    H.push();
    P.deletePoints(state, [state.hover]);
    state.hover = null;
    if (s && s.kind === 'path' && !getPath(s.id)) clearSelection();
    if (state.pen && !getPath(state.pen.pathId)) state.pen = null;
    return true;
  }
  return deleteSelection();
}

// --- style and sublayer

export function setStyle(patch) {
  const pid = selectedPathId();
  if (pid) { H.push(); Object.assign(getPath(pid).style, patch); }
  Object.assign(state.style, patch);
  return true;
}

export function setFillColor(color) {
  state.fillColor = color;
  const s = state.selection;
  if (s && s.kind === 'fill' && getFill(s.id)) { H.push(); getFill(s.id).color = color; }
  return true;
}

export function togglePathLayer(pathId) {
  const p = getPath(pathId);
  if (!p) return false;
  H.push();
  p.layer = p.layer === 'detail' ? 'structure' : 'detail';
  return true;
}

// --- elements, bindings, chains

const chainKey = (ops) => ops.join('>');

export function addElement(kind) {
  H.push();
  const c = toWorld({ c: 0.5, r: 0.5 }, state.lattice);
  const spec = kind === 'translate' ? { kind, u: 0.5, v: 0.5 }
    : kind === 'mirror' ? { kind, cx: c.x, cy: c.y, angle: 90 }
    : { kind: 'rotate', cx: c.x, cy: c.y, n: 2 };
  const e = P.addElement(state, spec);
  state.newPathOps.push([e.id]);
  const pid = selectedPathId();
  if (pid) P.addBinding(state, pid, [e.id]);
  endPen();
  state.layer = 'construction';
  state.selection = { kind: 'element', id: e.id };
  return true;
}

export function setRotationOrder(id, n) {
  const e = getElement(id);
  if (!e || e.kind !== 'rotate' || e.n === n) return false;
  H.push();
  e.n = n;
  return true;
}

export function rotateElement(id, deg) {
  const e = getElement(id);
  if (!e || e.kind !== 'mirror') return false;
  H.push();
  e.angle = (((e.angle + deg) % 180) + 180) % 180;
  return true;
}

export function rotateSelectedElement(deg) {
  const id = selectedElementId();
  return id ? rotateElement(id, deg) : false;
}

export function setTranslation(id, u, v) {
  const e = getElement(id);
  if (!e || e.kind !== 'translate') return false;
  H.push();
  e.u = u; e.v = v;
  return true;
}

export function isNewPathChain(ops) { const k = chainKey(ops); return state.newPathOps.some((c) => chainKey(c) === k); }

export function toggleNewPathChain(ops) {
  const k = chainKey(ops);
  const i = state.newPathOps.findIndex((c) => chainKey(c) === k);
  H.push();
  if (i >= 0) state.newPathOps.splice(i, 1); else state.newPathOps.push(ops.slice());
  return true;
}

export function toggleOpOnBinding(bindingId, elementId) {
  if (!getBinding(bindingId) || !getElement(elementId)) return false;
  H.push();
  P.toggleOp(state, bindingId, elementId);
  return true;
}

export function addChain(pathId) {
  if (!getPath(pathId)) return false;
  H.push();
  P.addBinding(state, pathId, []);
  return true;
}

export function removeBinding(id) {
  if (!getBinding(id)) return false;
  H.push();
  P.removeBinding(state, id);
  if (state.selection && state.selection.kind === 'clone' && state.selection.bindingId === id) clearSelection();
  return true;
}

export function deleteElement(id) {
  if (!getElement(id)) return false;
  H.push();
  const wasSelected = selectedElementId() === id;
  removeElementEverywhere(id);
  if (wasSelected) clearSelection();
  return true;
}

export function setLattice(lat) {
  H.push();
  state.lattice = { ...lat };
  return true;
}

// --- fills

// Place or recolour a fill in the region under a world point.
export function fillAt(world) {
  const faces = computeFaces(state);
  const seed = cellOf(world, state.lattice).local;
  const face = faceAt(faces, seed);
  if (!face) return false;
  H.push();
  const existing = state.fills.find((f) => faceAt(faces, f) === face);
  if (existing) { existing.color = state.fillColor; state.selection = { kind: 'fill', id: existing.id }; }
  else { const f = P.addFill(state, { x: seed.x, y: seed.y, color: state.fillColor }); state.selection = { kind: 'fill', id: f.id }; }
  return true;
}

// --- freehand

// drag: { raw: [{x,y}], startNode: node|null }
export function finishFreehand(drag) {
  const fit = strokeToPath(drag.raw, { eps: CONFIG.FREEHAND_EPS, minDeviation: CONFIG.FREEHAND_MIN_DEVIATION });
  if (!fit) return false;
  const lastPt = fit.points[fit.points.length - 1];
  const endSnap = snapWorld(state, lastPt, threshold(), state.gridDivisions, (a) => !!a.bindingId, false);
  H.push();
  const nodes = fit.points.map((v, j) => {
    if (j === 0 && drag.startNode) return drag.startNode;
    if (j === fit.points.length - 1 && endSnap.anchor) return { pointId: endSnap.anchor.pointId, cell: endSnap.anchor.cell };
    return P.addPoint(state, v);
  });
  const extendId = drag.startNode ? P.openEndAt(state, drag.startNode.pointId) : null;
  let path;
  if (extendId) {
    path = getPath(extendId);
    P.orientToEnd(state, extendId, drag.startNode.pointId, drag.startNode.cell);
  } else {
    path = P.startPath(state, nodes[0], state.style, state.sublayer);
  }
  nodes.slice(1).forEach((n, j) => { if (P.appendNode(state, path.id, n)) path.cps[path.cps.length - 1] = fit.cps[j]; });
  if (!extendId) bindNewPath(path);
  if (path.nodes.length < 2) { P.deletePath(state, path.id); return false; }
  state.selection = { kind: 'path', id: path.id };
  return true;
}

// --- view (never in history)

export function zoomAt(screen, factor) {
  const v = state.view;
  const z = Math.min(CONFIG.ZOOM_MAX, Math.max(CONFIG.ZOOM_MIN, v.zoom * factor));
  const k = z / v.zoom;
  v.pan = { x: screen.x - (screen.x - v.pan.x) * k, y: screen.y - (screen.y - v.pan.y) * k };
  v.zoom = z;
  return true;
}

export function panBy(dx, dy) { state.view.pan.x += dx; state.view.pan.y += dy; return true; }

// Fit the base cell plus a margin into the viewport.
export function fitView() {
  const lat = state.lattice;
  const xs = [0, lat.ax, lat.bx, lat.ax + lat.bx], ys = [0, lat.ay, lat.by, lat.ay + lat.by];
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const zoom = Math.min(CONFIG.ZOOM_MAX, Math.max(CONFIG.ZOOM_MIN, Math.min(state.viewport.width / (w * 1.6), state.viewport.height / (h * 1.6))));
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  state.view = { zoom, pan: { x: state.viewport.width / 2 - cx * zoom, y: state.viewport.height / 2 - cy * zoom } };
  return true;
}
```

- [ ] **Step 2: Update `js/main.js` to use the shared `fitView`**

Replace the local `fitView` definition with `import { fitView } from './actions.js';` and keep the rest of the boot sequence.

- [ ] **Step 3: Write `tests/actions.test.js`**

`actions.js` imports `history.js` and `state.js`, both DOM-free, so the pen and fill flows can be tested in Node.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/state.js';
import * as A from '../js/actions.js';
import { reset, canUndo } from '../js/history.js';
import { CONFIG } from '../js/config.js';

function fresh() {
  reset();
  Object.assign(state, { lattice: { ...CONFIG.LATTICE_PRESETS.Square }, points: [], paths: [], elements: [], bindings: [], fills: [], newPathOps: [],
    layer: 'drawing', sublayer: 'structure', tool: 'pen', pen: null, selection: null, hover: null, drag: null, view: { pan: { x: 0, y: 0 }, zoom: 1 }, viewport: { width: 800, height: 600 } });
}

test('pen: empty clicks build a path, clicking the last point ends it, short paths are discarded', () => {
  fresh();
  A.penClickEmpty({ x: 10, y: 10 }, false);
  assert.ok(state.pen);
  A.penClickEmpty({ x: 100, y: 10 }, false);
  const path = state.paths[0];
  assert.equal(path.nodes.length, 2);
  A.penClickNode(path.nodes[1]);   // repeat of the last node ends the path
  assert.equal(state.pen, null);
  assert.equal(state.paths.length, 1);
  A.penClickEmpty({ x: 200, y: 200 }, false);
  A.endPen();                       // one-node path is discarded
  assert.equal(state.paths.length, 1);
  assert.equal(state.points.length, 2);
});

test('pen: new paths receive every chain in newPathOps; clicking an open end resumes the path', () => {
  fresh();
  A.addElement('rotate');
  assert.equal(state.layer, 'construction');
  assert.equal(state.newPathOps.length, 1);
  A.setTool('pen');
  A.penClickEmpty({ x: 10, y: 10 }, false); A.penClickEmpty({ x: 100, y: 10 }, false); A.endPen();
  assert.equal(state.bindings.length, 1);
  const path = state.paths[0];
  A.penClickNode(path.nodes[0]);    // resume from the first node: path is reversed
  assert.ok(state.pen && state.pen.pathId === path.id);
  assert.equal(path.nodes[1].pointId, state.points[0].id);
});

test('addElement binds a selected path and deleteElement drops it from chains', () => {
  fresh();
  A.penClickEmpty({ x: 10, y: 10 }, false); A.penClickEmpty({ x: 100, y: 10 }, false); A.endPen();
  A.selectPath(state.paths[0].id);
  A.addElement('mirror');
  const el = state.elements[0];
  assert.equal(state.bindings.length, 1);
  assert.deepEqual(state.bindings[0].ops, [el.id]);
  A.deleteElement(el.id);
  assert.equal(state.bindings.length, 0);
  assert.equal(state.newPathOps.length, 0);
  assert.equal(state.selection, null);
});

test('fillAt seeds the region under the click and recolours on a second click', () => {
  fresh();
  for (const p of [{ x: 60, y: 60 }, { x: 180, y: 60 }, { x: 180, y: 180 }, { x: 60, y: 180 }]) A.penClickEmpty(p, false);
  A.penClickNode(state.paths[0].nodes[0]); // back to the first node closes the loop; the pen stays active
  A.endPen();
  assert.equal(state.paths[0].nodes.length, 5);
  A.setTool('fill');
  assert.equal(A.fillAt({ x: 30, y: 30 }), false);
  assert.equal(A.fillAt({ x: 120, y: 120 }), true);
  assert.equal(state.fills.length, 1);
  state.fillColor = '#123456';
  A.fillAt({ x: 130, y: 130 });
  assert.equal(state.fills.length, 1);
  assert.equal(state.fills[0].color, '#123456');
  assert.equal(A.fillAt({ x: 120 + 240, y: 120 }), true); // neighbouring copy maps to the same seed region
  assert.equal(state.fills.length, 1);
});

test('finishFreehand creates a bound path and rejects a jitter', () => {
  fresh();
  A.addElement('rotate'); A.setTool('freehand');
  assert.equal(A.finishFreehand({ raw: [{ x: 0, y: 0 }, { x: 1, y: 1 }], startNode: null }), false);
  const raw = Array.from({ length: 30 }, (_, i) => ({ x: 20 + i * 5, y: 40 + 30 * Math.sin(i / 5) }));
  assert.equal(A.finishFreehand({ raw, startNode: null }), true);
  assert.equal(state.paths.length, 1);
  assert.equal(state.bindings.length, 1);
  assert.ok(state.paths[0].nodes.length >= 2);
  assert.equal(state.paths[0].cps.length, state.paths[0].nodes.length - 1);
});

test('zoomAt keeps the point under the cursor fixed and clamps', () => {
  fresh();
  state.view = { pan: { x: 100, y: 50 }, zoom: 1 };
  A.zoomAt({ x: 300, y: 200 }, 2);
  assert.equal(state.view.zoom, 2);
  assert.equal(state.view.pan.x, 300 - (300 - 100) * 2);
  A.zoomAt({ x: 0, y: 0 }, 1000);
  assert.equal(state.view.zoom, CONFIG.ZOOM_MAX);
  assert.equal(canUndo(), false); // view never enters history
});
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: all pass. In the fill test, `penClickNode(nodes[0])` appends the first node again, which makes `isClosed` true and the region computable; `endPen` then leaves the closed path in place.

- [ ] **Step 5: Verify the boot still works**

Open `http://127.0.0.1:5173/#example`; same scene as Task 8, no console errors.

- [ ] **Step 6: Commit**

```bash
git add js/actions.js js/main.js tests/actions.test.js
git commit -m "Add user-level actions with pen, fill and freehand flows

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 10: Pointer and keyboard core, drawing-layer tools

**Files:**
- Create: `js/interaction.js`, `js/tools/common.js`, `js/tools/select.js`, `js/tools/pen.js`, `js/tools/freehand.js`, `js/tools/fill.js`, `js/tools/construct.js` (background click + Space-drag only; Task 11 completes it)
- Modify: `js/main.js`

**Interfaces:**
- Consumes: `actions.js`, `history.js`, `paths.js`, `hit.js`, `lattice.js`, `transform.js`, the `data-kind` table from Task 8.
- Produces: `createHandlers(svg, rerender) → { attach, ctx }`. Tool modules export `onDown(hit, w, e, ctx)`, `onMove(drag, w, e, ctx)`, `onUp(drag, w, e, ctx)`. `common.js` exports `parseCell(s)`, `snapDelta(dv, on)`, `snapPoint(w, on, skip)`, `snapElementPos(w, on)`, `cloneBodyMove(drag, w, e, ctx)`.
- `hit` is `{ kind, d }` where `d` is the element's dataset. `ctx` is `{ world(e), screen(e), snapOn(e), threshold(), hit(e) }`.
- Every pointerdown creates `state.drag = { kind, hit, start, moved, tool, ... }`; a click is a drag that never moved. `drag.tool` is the module that started it and receives move/up.

- [ ] **Step 1: Create `js/tools/common.js`**

```js
// Helpers shared by tool modules.
import { state, getBinding, getElement } from '../state.js';
import { CONFIG } from '../config.js';
import * as H from '../history.js';
import { snapToGrid, snapToFraction, toUV, fromUV } from '../lattice.js';
import { snapWorld } from '../hit.js';

export function parseCell(s) { const [c, r] = (s || '0,0').split(',').map(Number); return { c, r }; }
export const threshold = () => CONFIG.SNAP_PX / state.view.zoom;
export function snapDelta(dv, on) { return on ? snapToGrid(dv, state.lattice, state.gridDivisions) : dv; }
export function snapPoint(w, on, skip) { return snapWorld(state, w, threshold(), state.gridDivisions, skip, on); }

// Element centres snap to an anchor if one is near, else to the finer of grid and twelfths.
export function snapElementPos(w, on) {
  const s = snapWorld(state, w, threshold(), state.gridDivisions, null, false);
  if (s.anchor) return { x: s.x, y: s.y };
  return on ? snapToFraction(w, state.lattice, state.gridDivisions) : w;
}

const twelfths = (x) => Math.round(x * 12) / 12;
function setTranslateVector(el, world, on) {
  let { u, v } = toUV(world, state.lattice);
  if (on) { u = twelfths(u); v = twelfths(v); }
  el.u = u; el.v = v;
}

// Dragging a clone's body moves the first element of its chain so the clone follows the pointer.
// drag: { bindingId, start, startEls: [element copies at gesture start] }
export function cloneBodyMove(d, w, e, ctx) {
  const b = getBinding(d.bindingId);
  if (!b || !b.ops.length) return;
  const first = getElement(b.ops[0]);
  const s0 = d.startEls.find((z) => z.id === b.ops[0]);
  if (!first || !s0) return;
  H.beginDrag();
  const on = ctx.snapOn(e);
  const dx = w.x - d.start.x, dy = w.y - d.start.y;
  if (first.kind === 'rotate') {
    // clone moves by (I − R)·δ when the centre moves by δ, so δ = (I − R)⁻¹·Δ
    const th = (2 * Math.PI) / first.n, c = Math.cos(th), s = Math.sin(th), det = 2 * (1 - c);
    const ex = ((1 - c) * dx - s * dy) / det, ey = (s * dx + (1 - c) * dy) / det;
    const p = snapElementPos({ x: s0.cx + ex, y: s0.cy + ey }, on);
    first.cx = p.x; first.cy = p.y;
    return;
  }
  if (first.kind === 'mirror') {
    const a = (s0.angle * Math.PI) / 180, dir = { x: Math.cos(a), y: Math.sin(a) }, nrm = { x: -dir.y, y: dir.x };
    const pe = dx * nrm.x + dy * nrm.y, al = dx * dir.x + dy * dir.y;
    const p = snapElementPos({ x: s0.cx + (pe / 2) * nrm.x, y: s0.cy + (pe / 2) * nrm.y }, on);
    first.cx = p.x; first.cy = p.y;
    const tId = b.ops.slice(1).find((id) => { const x = getElement(id); return x && x.kind === 'translate'; });
    if (tId) {
      const t = getElement(tId), t0 = d.startEls.find((z) => z.id === tId);
      const v0 = fromUV(t0.u, t0.v, state.lattice);
      setTranslateVector(t, { x: v0.x + al * dir.x, y: v0.y + al * dir.y }, on);
    }
    return;
  }
  const v0 = fromUV(s0.u, s0.v, state.lattice);
  setTranslateVector(first, { x: v0.x + dx, y: v0.y + dy }, on);
}
```

- [ ] **Step 2: Create `js/tools/select.js`**

```js
// Select tool, plus the point / segment / control-point / anchor drags that Pen reuses.
import { state, getPath, selectedPointIds } from '../state.js';
import { CONFIG } from '../config.js';
import * as A from '../actions.js';
import * as H from '../history.js';
import * as P from '../paths.js';
import { pointsInRect, bboxHandles, scaleFor, scaleMatrix } from '../hit.js';
import { toWorld } from '../lattice.js';
import { apply, invert, rotation } from '../transform.js';
import { parseCell, snapDelta, snapPoint, cloneBodyMove } from './common.js';

export function pointDown(hit, w) {
  const id = hit.d.id, cell = parseCell(hit.d.cell), selPts = selectedPointIds();
  if (state.tool === 'select' && selPts.includes(id) && selPts.length > 1) {
    state.drag = { kind: 'pts', hit, start: w, moved: false, ids: selPts.slice(), startPos: P.snapshotPositions(state, selPts) };
    return;
  }
  state.drag = { kind: 'pt', hit, start: w, moved: false, pointId: id, cell };
}

function startBBox(hit, w) {
  const s = state.selection;
  if (!s || s.kind !== 'path') return;
  const path = getPath(s.id);
  if (!path) return;
  const box = P.bounds(state, s.id);
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const ids = [...new Set(path.nodes.map((n) => n.pointId))];
  const h = hit.kind === 'bboxrot' ? { x: cx, y: box.y0 - CONFIG.BBOX_ROT_OFFSET / state.view.zoom } : bboxHandles(box)[+hit.d.h];
  state.drag = { kind: 'bbox', hit, start: w, moved: false, mode: hit.kind === 'bboxrot' ? 'rot' : 'scale', h, box, cx, cy,
    pathId: s.id, ids, startPos: P.snapshotPositions(state, ids), startCps: path.cps.map((c) => c && { ...c }), M: null };
}

export function onDown(hit, w, e) {
  switch (hit.kind) {
    case 'point': pointDown(hit, w); return;
    case 'segment': {
      const path = getPath(hit.d.path);
      if (!path) return;
      const ids = [...new Set(path.nodes.map((n) => n.pointId))];
      state.drag = { kind: 'body', hit, start: w, moved: false, pathId: path.id, bindingId: hit.d.binding || null, power: +hit.d.power || 0,
        ids, startPos: P.snapshotPositions(state, ids), startEls: state.elements.map((x) => ({ ...x })) };
      return;
    }
    case 'canchor':
      state.drag = { kind: 'canchor', hit, start: w, moved: false, pointId: hit.d.point, cell: parseCell(hit.d.cell), bindingId: hit.d.binding, power: +hit.d.power };
      return;
    case 'diamond':
      state.drag = { kind: 'cp', hit, start: w, moved: false, pathId: hit.d.path, j: +hit.d.j, bindingId: hit.d.binding || null, power: +hit.d.power || 0 };
      return;
    case 'bbox': case 'bboxrot': startBBox(hit, w); return;
    case 'fill': state.drag = { kind: 'click', hit, start: w, moved: false }; return;
    default:
      state.drag = { kind: 'marquee', hit, start: w, cur: w, moved: false, add: e.shiftKey };
      if (!e.shiftKey) state.selection = null;
  }
}

export function onMove(d, w, e, ctx) {
  const on = ctx.snapOn(e);
  switch (d.kind) {
    case 'marquee': d.cur = w; return;
    case 'pt': {
      if (!d.moved) return;
      H.beginDrag();
      const s = snapPoint(w, on, (a) => !a.bindingId && a.pointId === d.pointId);
      const o = toWorld(d.cell, state.lattice);
      P.movePoint(state, d.pointId, s.x - o.x, s.y - o.y);
      return;
    }
    case 'pts': {
      if (!d.moved) return;
      H.beginDrag();
      const dv = snapDelta({ x: w.x - d.start.x, y: w.y - d.start.y }, on);
      P.movePointsBy(state, d.ids, d.startPos, dv.x, dv.y);
      return;
    }
    case 'body': {
      if (!d.moved) return;
      if (d.bindingId) { cloneBodyMove(d, w, e, ctx); return; }
      H.beginDrag();
      const dv = snapDelta({ x: w.x - d.start.x, y: w.y - d.start.y }, on);
      P.movePointsBy(state, d.ids, d.startPos, dv.x, dv.y);
      return;
    }
    case 'canchor': {
      if (!d.moved) return;
      const M = A.cloneMatrix(d.bindingId, d.power);
      if (!M) return;
      H.beginDrag();
      const s = snapPoint(w, on, (a) => !a.bindingId && a.pointId === d.pointId);
      const loc = apply(invert(M), s);
      const o = toWorld(d.cell, state.lattice);
      P.movePoint(state, d.pointId, loc.x - o.x, loc.y - o.y);
      return;
    }
    case 'cp': {
      if (!d.moved) return;
      H.beginDrag();
      const M = d.bindingId ? A.cloneMatrix(d.bindingId, d.power) : null;
      P.setControlPoint(state, d.pathId, d.j, M ? apply(invert(M), w) : w);
      return;
    }
    case 'bbox': {
      if (!d.moved) return;
      H.beginDrag();
      let M;
      if (d.mode === 'rot') {
        let th = Math.atan2(w.y - d.cy, w.x - d.cx) - Math.atan2(d.h.y - d.cy, d.h.x - d.cx);
        if (on) th = Math.round(th / (Math.PI / 12)) * (Math.PI / 12);
        M = rotation(th, d.cx, d.cy);
      } else {
        const { sx, sy } = scaleFor(d.h, w, e.shiftKey);
        M = scaleMatrix(d.h.ax, d.h.ay, sx, sy);
      }
      // restore the gesture's starting geometry, then apply M from scratch
      for (const id of d.ids) { const p = P.getPoint(state, id); p.x = d.startPos[id].x; p.y = d.startPos[id].y; }
      getPath(d.pathId).cps = d.startCps.map((c) => c && { ...c });
      P.transformPath(state, d.pathId, M);
      d.M = M;
      return;
    }
    default:
  }
}

export function onUp(d, w, e, ctx) {
  if (d.kind === 'marquee') {
    if (!d.moved) return;
    const r = { x0: Math.min(d.start.x, d.cur.x), x1: Math.max(d.start.x, d.cur.x), y0: Math.min(d.start.y, d.cur.y), y1: Math.max(d.start.y, d.cur.y) };
    const cur = d.add ? selectedPointIds() : [];
    A.selectPoints([...cur, ...pointsInRect(state, r)]);
    return;
  }
  if (d.moved) return;
  const h = d.hit, s = state.selection;
  switch (h.kind) {
    case 'point':
      if (e.shiftKey) A.togglePointSelection(h.d.id); else A.selectPoints([h.d.id]);
      return;
    case 'segment': {
      const bindingId = h.d.binding || null, power = +h.d.power || 0, j = +h.d.j;
      if (bindingId) {
        if (s && s.kind === 'clone' && s.bindingId === bindingId && s.power === power) A.insertNodeOnSegment(h.d.path, j, w, A.cloneMatrix(bindingId, power), ctx.snapOn(e));
        else A.selectClone(bindingId, power);
      } else if (s && s.kind === 'path' && s.id === h.d.path) A.insertNodeOnSegment(h.d.path, j, w, null, ctx.snapOn(e));
      else A.selectPath(h.d.path);
      return;
    }
    case 'canchor': A.selectClone(h.d.binding, +h.d.power); return;
    case 'fill': A.selectFill(h.d.id); return;
    default:
  }
}
```

- [ ] **Step 3: Create `js/tools/pen.js`**

```js
// Pen tool: click to add, click a point to connect or resume, click the last point / Esc / Enter to end.
import { state } from '../state.js';
import * as A from '../actions.js';
import * as select from './select.js';
import { parseCell } from './common.js';

export function onDown(hit, w, e, ctx) {
  if (['point', 'canchor', 'diamond', 'bbox', 'bboxrot'].includes(hit.kind)) { select.onDown(hit, w, e, ctx); return; }
  A.penClickEmpty(w, ctx.snapOn(e));
  state.drag = { kind: 'click', hit, start: w, moved: false };
}

export function onMove(d, w, e, ctx) { select.onMove(d, w, e, ctx); }

export function onUp(d) {
  if (d.moved) return;
  if (d.hit.kind === 'point') A.penClickNode({ pointId: d.hit.d.id, cell: parseCell(d.hit.d.cell) });
  else if (d.hit.kind === 'canchor') A.penClickNode({ pointId: d.hit.d.point, cell: parseCell(d.hit.d.cell) });
}
```

- [ ] **Step 4: Create `js/tools/freehand.js`**

```js
// Freehand tool: press and drag; the stroke is fitted on release (actions.finishFreehand).
import { state } from '../state.js';
import { CONFIG } from '../config.js';
import * as A from '../actions.js';
import * as P from '../paths.js';
import { orbit } from '../transform.js';
import { parseCell } from './common.js';

// Matrices to ghost the stroke through: the extended path's bindings, else the chains new paths receive.
function previewMatrices(startNode) {
  const extendId = startNode ? P.openEndAt(state, startNode.pointId) : null;
  const chains = extendId ? state.bindings.filter((b) => b.pathId === extendId).map((b) => b.ops) : state.newPathOps;
  return chains.flatMap((ops) => orbit(ops, state.elements, state.lattice, CONFIG.ORBIT_CAP).matrices);
}

export function onDown(hit, w) {
  let startNode = null, start = w;
  if (hit.kind === 'point') { startNode = { pointId: hit.d.id, cell: parseCell(hit.d.cell) }; start = P.nodeWorld(state, startNode); }
  state.drag = { kind: 'free', hit, start, moved: false, raw: [{ x: start.x, y: start.y }], startNode, cloneMatrices: previewMatrices(startNode) };
}

export function onMove(d, w) {
  const last = d.raw[d.raw.length - 1];
  if (Math.hypot(w.x - last.x, w.y - last.y) < 1.5) return;
  d.raw.push({ x: w.x, y: w.y });
}

export function onUp(d) { A.finishFreehand(d); }
```

- [ ] **Step 5: Create `js/tools/fill.js`**

```js
// Fill tool: hover tints the region under the pointer (render.js); a click seeds or recolours it.
import { state } from '../state.js';
import * as A from '../actions.js';

export function onDown(hit, w) { state.drag = { kind: 'click', hit, start: w, moved: false }; }
export function onMove() {}
export function onUp(d, w) { if (!d.moved) A.fillAt(w); }
```

- [ ] **Step 6: Create the first `js/tools/construct.js`**

Only what the drawing layer needs now: Space-drag while drawing, and background clicks on the Construction layer. Task 11 replaces this file with the full version.

```js
// Construction layer (partial: Task 11 adds element, lattice and knob drags).
import { state, getElement } from '../state.js';
import * as H from '../history.js';
import { snapDelta } from './common.js';

// Space+drag while drawing: move the elements that clone the current path (or that new paths would get).
export function startMultiDrag(w, hit) {
  const ids = state.pen
    ? state.bindings.filter((b) => b.pathId === state.pen.pathId).map((b) => b.ops[0]).filter(Boolean)
    : state.newPathOps.map((c) => c[0]).filter(Boolean);
  state.drag = { kind: 'elmulti', hit, start: w, moved: false, ids: [...new Set(ids)], startEls: state.elements.map((x) => ({ ...x })) };
}

export function onDown(hit, w) {
  state.drag = { kind: 'click', hit, start: w, moved: false };
  if (hit.kind === 'background') state.selection = null;
}

export function onMove(d, w, e, ctx) {
  if (d.kind !== 'elmulti' || !d.moved) return;
  H.beginDrag();
  const dv = snapDelta({ x: w.x - d.start.x, y: w.y - d.start.y }, ctx.snapOn(e));
  for (const id of d.ids) {
    const x = getElement(id), s = d.startEls.find((z) => z.id === id);
    if (!x || !s || x.kind === 'translate') continue;
    x.cx = s.cx + dv.x; x.cy = s.cy + dv.y;
  }
}

export function onUp() {}
```

- [ ] **Step 7: Create `js/interaction.js`**

```js
// Pointer, keyboard and wheel handling. One delegated listener set on the SVG; per-tool modules do the work.
import { state } from './state.js';
import { CONFIG } from './config.js';
import * as A from './actions.js';
import * as H from './history.js';
import * as select from './tools/select.js';
import * as pen from './tools/pen.js';
import * as freehand from './tools/freehand.js';
import * as fill from './tools/fill.js';
import * as construct from './tools/construct.js';

const TOOLS = { select, pen, freehand, fill };

export function createHandlers(svg, rerender) {
  const ctx = {
    world(e) { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left - state.view.pan.x) / state.view.zoom, y: (e.clientY - r.top - state.view.pan.y) / state.view.zoom }; },
    screen(e) { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; },
    snapOn(e) { return state.snap !== !!e.shiftKey; },
    threshold() { return CONFIG.SNAP_PX / state.view.zoom; },
    hit(e) {
      const t = e.target && e.target.closest ? e.target.closest('[data-kind]') : null;
      return t ? { kind: t.dataset.kind, d: { ...t.dataset } } : { kind: 'background', d: {} };
    },
  };
  const activeTool = () => (state.layer === 'construction' ? construct : TOOLS[state.tool]);

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const w = ctx.world(e), hit = ctx.hit(e);
    let tool = activeTool();
    if (state.space && state.layer === 'drawing' && (state.pen || state.tool === 'freehand')) { construct.startMultiDrag(w, hit); tool = construct; }
    else tool.onDown(hit, w, e, ctx);
    if (state.drag) {
      state.drag.tool = tool;
      try { svg.setPointerCapture(e.pointerId); } catch (_) { /* capture unsupported */ }
    }
    rerender();
  }

  function onPointerMove(e) {
    const w = ctx.world(e);
    state.cursor = w;
    const d = state.drag;
    if (!d) {
      const prevHover = state.hover;
      const hit = ctx.hit(e);
      state.hover = hit.kind === 'point' ? hit.d.id : null;
      if (state.tool === 'fill') state.hoverPoint = w;
      if (prevHover !== state.hover || state.pen || state.tool === 'fill') rerender();
      return;
    }
    if (!d.moved && Math.hypot(w.x - d.start.x, w.y - d.start.y) > CONFIG.DRAG_THRESHOLD_PX / state.view.zoom) d.moved = true;
    d.tool.onMove(d, w, e, ctx);
    rerender();
  }

  function onPointerUp(e) {
    const d = state.drag;
    if (!d) return;
    const w = ctx.world(e);
    state.drag = null;
    H.endDrag();
    d.tool.onUp(d, w, e, ctx);
    rerender();
  }

  function onPointerCancel() {
    if (!state.drag) return;
    state.drag = null;
    H.endDrag();
    rerender();
  }

  function onDblClick(e) {
    const hit = ctx.hit(e);
    if (hit.kind === 'diamond' && A.straightenSegment(hit.d.path, +hit.d.j)) rerender();
  }

  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) A.zoomAt(ctx.screen(e), Math.exp(-e.deltaY * 0.01));
    else A.panBy(-e.deltaX, -e.deltaY);
    rerender();
  }

  function onKeyDown(e) {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    const meta = e.metaKey || e.ctrlKey, k = e.key;
    if (e.code === 'Space') { e.preventDefault(); if (!state.space) { state.space = true; rerender(); } return; }
    if (k === 'Tab') { e.preventDefault(); A.setLayer(state.layer === 'drawing' ? 'construction' : 'drawing'); }
    else if (meta && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) A.redo(); else A.undo(); }
    else if (meta && (k === 'y' || k === 'Y')) { e.preventDefault(); A.redo(); }
    else if (meta && k === '0') { e.preventDefault(); A.fitView(); }
    else if (k === 'Escape') { if (state.pen) A.endPen(); else state.selection = null; }
    else if (k === 'Enter') A.endPen();
    else if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); A.deleteHoveredOrSelection(); }
    else if (k === '[') A.rotateSelectedElement(-15);
    else if (k === ']') A.rotateSelectedElement(15);
    else if (k === '?') A.toggleHelp();
    else if (!meta) {
      switch (k.toLowerCase()) {
        case 'v': A.setTool('select'); break;
        case 'p': A.setTool('pen'); break;
        case 'f': A.setTool(state.tool === 'freehand' ? 'pen' : 'freehand'); break;
        case 'b': A.setTool('fill'); break;
        case 'o': A.addElement('rotate'); break;
        case 'm': A.addElement('mirror'); break;
        case 't': A.addElement('translate'); break;
        case 'g': A.toggleSnap(); break;
        default: return;
      }
    } else return;
    rerender();
  }

  function onKeyUp(e) { if (e.code === 'Space') { state.space = false; rerender(); } }

  function attach() {
    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', onPointerCancel);
    svg.addEventListener('dblclick', onDblClick);
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onPointerCancel);
  }

  return { attach, ctx };
}
```

- [ ] **Step 8: Wire the handlers in `js/main.js`**

```js
import { state } from './state.js';
import { render } from './render.js';
import { loadExample } from './example.js';
import { fitView } from './actions.js';
import { createHandlers } from './interaction.js';

const svg = document.getElementById('canvas');

function measure() {
  const r = svg.getBoundingClientRect();
  state.viewport = { width: r.width, height: r.height };
}

function rerender() { render(svg); }

measure();
if (location.hash === '#example') loadExample();
fitView();
createHandlers(svg, rerender).attach();
window.addEventListener('resize', () => { measure(); rerender(); });
rerender();
```

- [ ] **Step 9: Verify in the browser**

Open `http://127.0.0.1:5173/` (blank document) and work through, with no console errors:
1. Press `O` (adds a rotation, switches to Construction), then `P` (back to Drawing, Pen).
2. Click four spots to draw; the rubber band follows the pointer; the 180° clone appears live; ghosts in every cell. Press `Enter` to end.
3. Click the first point of that path: the path resumes from that end (rubber band from it). Press `Esc`.
4. `V`, click a segment: halo and diamonds appear. Click the same segment again: a point is inserted. Drag a diamond: the segment bends, the clone bends with it. Double-click the diamond: straight again.
5. Drag a point: it moves and snaps; its clone moves. Drag a clone anchor (the small squares on the clone): the source point moves through the inverse. Drag the clone's body: the rotation centre moves so the clone follows.
6. Marquee three points, drag them together. Drag the bounding-box corner: uniform scale; `⇧`-drag: free; drag the knob above: rotate, snapping to 15°.
7. `⌘Z` repeatedly undoes each gesture as one step; `⇧⌘Z` redoes.
8. Wheel pans; `⌘`+wheel zooms about the cursor; `⌘0` refits.
9. `F`, press-drag a wavy stroke: live preview with ghost clones; on release a fitted path with curves.
10. Draw a closed loop with the Pen, press `B`, hover inside: tint; click: a fill appears. `V`, click the fill: selected; `⌫` removes it.
11. Hover a point with the Pen and press `⌫`: the point is deleted.

- [ ] **Step 10: Commit**

```bash
git add js/interaction.js js/tools js/main.js
git commit -m "Add pointer/keyboard core with Pen, Select, Freehand and Fill tools

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Construction layer interactions

**Files:**
- Modify: `js/tools/construct.js` (replace the whole file)

**Interfaces:**
- Consumes: `snapElementPos`, `snapDelta` from `common.js`; `isDegenerate`, `toUV` from `lattice.js`; `actions.selectElement`.
- Produces: full `onDown/onMove/onUp` for `element`, `elrot`, `eltip`, `lat` and background hits; `startMultiDrag` unchanged.

- [ ] **Step 1: Replace `js/tools/construct.js`**

```js
// Construction layer: drag elements, rotate mirrors, set translation vectors, drag lattice handles.
import { state, getElement } from '../state.js';
import { CONFIG } from '../config.js';
import * as A from '../actions.js';
import * as H from '../history.js';
import { toUV, isDegenerate } from '../lattice.js';
import { snapDelta, snapElementPos } from './common.js';

// Space+drag while drawing: move the elements that clone the current path (or that new paths would get).
export function startMultiDrag(w, hit) {
  const ids = state.pen
    ? state.bindings.filter((b) => b.pathId === state.pen.pathId).map((b) => b.ops[0]).filter(Boolean)
    : state.newPathOps.map((c) => c[0]).filter(Boolean);
  state.drag = { kind: 'elmulti', hit, start: w, moved: false, ids: [...new Set(ids)], startEls: state.elements.map((x) => ({ ...x })) };
}

export function onDown(hit, w) {
  switch (hit.kind) {
    case 'element': {
      const el = getElement(hit.d.id);
      if (!el) return;
      state.drag = { kind: 'elc', hit, start: w, moved: false, id: el.id, cx0: el.cx, cy0: el.cy };
      return;
    }
    case 'elrot': state.drag = { kind: 'elrot', hit, start: w, moved: false, id: hit.d.id }; return;
    case 'eltip': state.drag = { kind: 'eltip', hit, start: w, moved: false, id: hit.d.id }; return;
    case 'lat': state.drag = { kind: 'lat', hit, start: w, moved: false, which: hit.d.which }; return;
    default:
      state.drag = { kind: 'click', hit, start: w, moved: false };
      if (hit.kind === 'background') state.selection = null;
  }
}

export function onMove(d, w, e, ctx) {
  if (!d.moved) return;
  const on = ctx.snapOn(e);
  const el = d.id ? getElement(d.id) : null;
  switch (d.kind) {
    case 'elc': {
      if (!el) return;
      H.beginDrag();
      const p = snapElementPos({ x: d.cx0 + w.x - d.start.x, y: d.cy0 + w.y - d.start.y }, on);
      el.cx = p.x; el.cy = p.y;
      return;
    }
    case 'elrot': {
      if (!el) return;
      H.beginDrag();
      let ang = (Math.atan2(w.y - el.cy, w.x - el.cx) * 180) / Math.PI;
      if (on) ang = Math.round(ang / 15) * 15;
      el.angle = ((ang % 180) + 180) % 180;
      return;
    }
    case 'eltip': {
      if (!el) return;
      H.beginDrag();
      let { u, v } = toUV(w, state.lattice);
      if (on) { u = Math.round(u * 12) / 12; v = Math.round(v * 12) / 12; }
      el.u = u; el.v = v;
      return;
    }
    case 'lat': {
      H.beginDrag();
      let x = w.x, y = w.y;
      if (on) {
        const len = Math.max(40, Math.round(Math.hypot(x, y) / 10) * 10);
        const ang = Math.round(Math.atan2(y, x) / (Math.PI / 12)) * (Math.PI / 12);
        x = len * Math.cos(ang); y = len * Math.sin(ang);
      }
      const nl = { ...state.lattice };
      if (d.which === 'a') { nl.ax = x; nl.ay = y; } else { nl.bx = x; nl.by = y; }
      if (isDegenerate(nl, CONFIG.MIN_LATTICE_DET)) return;
      state.lattice = nl;
      return;
    }
    case 'elmulti': {
      H.beginDrag();
      const dv = snapDelta({ x: w.x - d.start.x, y: w.y - d.start.y }, on);
      for (const id of d.ids) {
        const x = getElement(id), s = d.startEls.find((z) => z.id === id);
        if (!x || !s || x.kind === 'translate') continue;
        x.cx = s.cx + dv.x; x.cy = s.cy + dv.y;
      }
      return;
    }
    default:
  }
}

export function onUp(d) {
  if (d.moved) return;
  if (['element', 'elrot', 'eltip'].includes(d.hit.kind)) A.selectElement(d.hit.d.id);
}
```

- [ ] **Step 2: Verify in the browser**

On `http://127.0.0.1:5173/`, no console errors:
1. `O`, `M`, `T`: three elements appear at the cell centre (rotation mark with "2", a vertical dashed mirror line, an arrow to the half-cell diagonal), each selected as it is added.
2. Drag the rotation mark: it snaps to grid and twelfth fractions; hold `⇧` to drag freely.
3. Click the mirror to select it: a knob appears along the line. Drag the knob: the line rotates, snapping to 15°. `[` / `]` rotate by 15°.
4. Drag the translation diamond: the arrow tip snaps to twelfths.
5. Drag the pink `a` handle: the cell skews; the frames, grid and ghosts follow; the view does not jump. Try to drag `b` onto `a`: the drag stops before the lattice collapses.
6. `Tab` to Drawing, draw a path (it is cloned through all three chains), `Tab` back, drag the mirror: every clone through it follows.
7. While drawing with the Pen, hold `Space` and drag on empty canvas: the elements that clone the pen path move together.
8. Click empty canvas on the Construction layer: selection clears.

- [ ] **Step 3: Commit**

```bash
git add js/tools/construct.js
git commit -m "Add construction-layer drags for elements and lattice

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 12: Chrome — bars, palette, hint, help

**Files:**
- Create: `js/ui.js`
- Modify: `js/main.js`

**Interfaces:**
- Consumes: `actions.js`, `history.js` (`canUndo`, `canRedo`), `render.js` (`fmtFrac`), `transform.js` (`orbit`).
- Produces: `renderChrome(root)`, `bindChrome(root, rerender)`, `elementLabel(el) → '↻1'`-style label.
- Chrome buttons carry `data-action` (a key of `ACTIONS`) and `data-arg`. Compound args are `|`-joined.

- [ ] **Step 1: Create `js/ui.js`**

```js
// HTML chrome, rebuilt from state after every render. One delegated click handler dispatches data-action.
import { state, getPath, getBinding, getElement, getFill, selectedPathId, selectedElementId } from './state.js';
import { CONFIG } from './config.js';
import * as A from './actions.js';
import * as H from './history.js';
import { orbit } from './transform.js';
import { fmtFrac } from './render.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SYMBOL = { rotate: '↻', mirror: '⟋', translate: '⇢' };

function btn(label, action, arg = '', { on = false, cls = '', title = '', kbd = '', disabled = false } = {}) {
  return `<button class="btn ${cls}${on ? ' on' : ''}" data-action="${action}" data-arg="${esc(arg)}" title="${esc(title)}"${disabled ? ' disabled' : ''}>${label}${kbd ? ` <span class="kbd">${kbd}</span>` : ''}</button>`;
}
const sep = () => '<span class="sep"></span>';
const label = (t) => `<span class="label">${esc(t)}</span>`;

export function elementLabel(el) { return `${SYMBOL[el.kind]}${state.elements.indexOf(el) + 1}`; }
function chainLabel(ops) { return ops.map((id) => { const e = getElement(id); return e ? elementLabel(e) : '?'; }).join(' → ') || '(empty chain)'; }
function orbitOf(ops) { return orbit(ops, state.elements, state.lattice, CONFIG.ORBIT_CAP); }

function latticeAngle() { const l = state.lattice; return Math.abs((Math.atan2(l.ax * l.by - l.ay * l.bx, l.ax * l.bx + l.ay * l.by) * 180) / Math.PI); }
function latticeFits(n) {
  const l = state.lattice, equal = Math.abs(Math.hypot(l.ax, l.ay) - Math.hypot(l.bx, l.by)) < 1, ang = latticeAngle();
  if (n === 2) return true;
  if (n === 4) return equal && Math.abs(ang - 90) < 1;
  if (n === 3 || n === 6) return equal && (Math.abs(ang - 60) < 1 || Math.abs(ang - 120) < 1);
  return false;
}

// --- bars

function layerBar() {
  const cons = state.layer === 'construction';
  return `<div class="panel">${btn('✎ Drawing', 'setLayer', 'drawing', { on: !cons, title: 'Drawing layer: paths, points, fills (Tab)' })}${btn('⟋ Construction', 'setLayer', 'construction', { on: cons, cls: 'violet', title: 'Construction layer: elements and lattice (Tab)' })}</div>`;
}

function toolBar() {
  const t = state.tool;
  return `<div class="panel">${btn('↖ Select', 'setTool', 'select', { on: t === 'select', kbd: 'V', title: 'Select (V)' })}${btn('✎ Pen', 'setTool', 'pen', { on: t === 'pen', kbd: 'P', title: 'Pen (P)' })}${btn('〰 Freehand', 'setTool', 'freehand', { on: t === 'freehand', kbd: 'F', title: 'Freehand (F)' })}${btn('◐ Fill', 'setTool', 'fill', { on: t === 'fill', kbd: 'B', title: 'Fill (B)' })}${sep()}${btn('Structure', 'setSublayer', 'structure', { on: state.sublayer === 'structure', cls: 'small', title: 'New paths go below fills' })}${btn('Detail', 'setSublayer', 'detail', { on: state.sublayer === 'detail', cls: 'small', title: 'New paths go above fills' })}${sep()}${btn('⌗ Snap', 'toggleSnap', '', { on: state.snap, cls: 'small', kbd: 'G', title: 'Grid snapping (G); hold Shift to invert' })}</div>`;
}

function elementsBar() {
  const chips = state.elements.map((e) => btn(elementLabel(e), 'selectElement', e.id, { on: A.isNewPathChain([e.id]), cls: 'small violet', title: A.isNewPathChain([e.id]) ? 'Applies to new paths · click to select' : 'Click to select' })).join('');
  const open = state.elements.some((e) => orbitOf([e.id]).open);
  return `<div class="panel bar">${label('Elements')}${btn('+ ↻ Rotation', 'addElement', 'rotate', { cls: 'violet', kbd: 'O', title: 'Add a rotation (1/n turn). New paths are cloned through it.' })}${btn('+ ⟋ Mirror', 'addElement', 'mirror', { cls: 'violet', kbd: 'M', title: 'Add a mirror line.' })}${btn('+ ⇢ Translate', 'addElement', 'translate', { cls: 'violet', kbd: 'T', title: 'Add a translation by a fraction of the lattice.' })}${chips}${state.elements.length ? label('filled = applies to new paths') : ''}${open ? label('⚠ an element does not close on this lattice') : ''}</div>`;
}

function presetIcon(p) {
  const pts = [[0, 0], [p.ax, p.ay], [p.ax + p.bx, p.ay + p.by], [p.bx, p.by]].map(([x, y]) => `${10 + ((x + 120) / 480) * 40},${8 + ((y + 20) / 240) * 22}`).join(' ');
  return `<svg width="34" height="22" viewBox="0 0 60 36"><polygon points="${pts}" fill="none" stroke="currentColor" stroke-width="2"></polygon></svg>`;
}

function latticeBar() {
  const l = state.lattice;
  const isOn = (p) => ['ax', 'ay', 'bx', 'by'].every((k) => Math.abs(p[k] - l[k]) < 0.5);
  const presets = Object.entries(CONFIG.LATTICE_PRESETS).map(([name, p]) => btn(`${presetIcon(p)}${esc(name)}`, 'setLattice', name, { on: isOn(p), cls: 'small preset', title: name })).join('');
  return `<div class="panel bar">${label('▱ Lattice')}${presets}${label(`a ${Math.round(Math.hypot(l.ax, l.ay))} · b ${Math.round(Math.hypot(l.bx, l.by))} · ${Math.round(latticeAngle())}° · drag the pink a / b handles`)}</div>`;
}

function selectionBar() {
  const s = state.selection;
  if (!s || s.kind === 'points') return '';
  let inner = '';
  if (s.kind === 'path') {
    const path = getPath(s.id);
    if (!path) return '';
    const rows = state.bindings.filter((b) => b.pathId === path.id).map((b) => {
      const chips = state.elements.map((e) => btn(elementLabel(e), 'toggleOp', `${b.id}|${e.id}`, { on: b.ops.includes(e.id), cls: 'small violet', title: 'Toggle this element in the chain (click order = apply order)' })).join('');
      const n = orbitOf(b.ops).matrices.length;
      return `${label(`${chainLabel(b.ops)} · ${n} clone${n === 1 ? '' : 's'}`)}${chips}${btn('★', 'toggleChain', b.id, { on: A.isNewPathChain(b.ops), cls: 'small', title: 'Apply this chain to new paths' })}${btn('✕', 'removeBinding', b.id, { cls: 'small', title: 'Remove this chain' })}${sep()}`;
    }).join('');
    inner = `${label(`Path ${state.paths.indexOf(path) + 1}`)}${rows}${btn('+ chain', 'addChain', path.id, { cls: 'small outline', title: 'Start an empty chain; click element chips to fill it' })}${btn('+ ↻', 'addElement', 'rotate', { cls: 'small violet', title: 'New rotation cloning this path' })}${btn('+ ⟋', 'addElement', 'mirror', { cls: 'small violet', title: 'New mirror cloning this path' })}${btn('+ ⇢', 'addElement', 'translate', { cls: 'small violet', title: 'New translation cloning this path' })}${sep()}${btn(path.layer === 'detail' ? 'Above fills' : 'Below fills', 'togglePathLayer', path.id, { cls: 'small outline', title: 'Structure paths sit below fills, detail paths above' })}`;
  } else if (s.kind === 'clone') {
    const b = getBinding(s.bindingId);
    if (!b) return '';
    const path = getPath(b.pathId);
    inner = `${label(`Clone of path ${path ? state.paths.indexOf(path) + 1 : '?'} via ${chainLabel(b.ops)} · power ${s.power}`)}${btn('Select its element', 'selectCloneElement', '', { cls: 'small violet' })}${btn('Select source path', 'selectSourcePath', '', { cls: 'small outline' })}`;
  } else if (s.kind === 'element') {
    const el = getElement(s.id);
    if (!el) return '';
    const bound = state.bindings.filter((b) => b.ops.includes(el.id)).length;
    let controls = btn('Apply to new paths', 'toggleArmed', el.id, { on: A.isNewPathChain([el.id]), cls: 'small violet', title: 'Clone every new path through this element' });
    if (el.kind === 'rotate') {
      controls += sep() + [2, 3, 4, 6].map((n) => btn(`1/${n}`, 'setOrder', `${el.id}|${n}`, { on: el.n === n, cls: 'small outline', title: `${n}-fold rotation` })).join('');
      if (!latticeFits(el.n)) controls += label(`⚠ 1/${el.n} does not tile on this lattice`);
    } else if (el.kind === 'mirror') {
      controls += sep() + btn('↺', 'rotEl', `${el.id}|-15`, { cls: 'small outline', title: 'Rotate −15° ([)' }) + btn('↻', 'rotEl', `${el.id}|15`, { cls: 'small outline', title: 'Rotate +15° (])' }) + label(`${Math.round(el.angle)}°`);
    } else {
      controls += sep() + label(`(${fmtFrac(el.u)}, ${fmtFrac(el.v)})`) + [['½ a', 0.5, 0], ['⅓ a', 1 / 3, 0], ['½ b', 0, 0.5], ['½ a+b', 0.5, 0.5]]
        .map(([t, u, v]) => btn(t, 'setTranslate', `${el.id}|${u}|${v}`, { on: Math.abs(el.u - u) < 1e-9 && Math.abs(el.v - v) < 1e-9, cls: 'small outline', title: 'Set the translation vector' })).join('');
    }
    const name = { rotate: 'Rotation', mirror: 'Mirror', translate: 'Translation' }[el.kind];
    inner = `${label(`${name} ${elementLabel(el)}`)}${controls}${label(bound ? `· in ${bound} chain${bound > 1 ? 's' : ''}` : '· no paths yet')}`;
  } else if (s.kind === 'fill') {
    inner = label('Fill · pick a colour in the palette');
  }
  return `<div class="panel bar">${inner}${sep()}${btn(s.kind === 'clone' ? 'Unlink' : 'Delete', 'deleteSelection', '', { cls: 'small outline', kbd: '⌫' })}</div>`;
}

function palette() {
  const fillSel = state.selection && state.selection.kind === 'fill' ? getFill(state.selection.id) : null;
  const fillMode = state.tool === 'fill' || !!fillSel;
  const pid = selectedPathId();
  const sty = pid && getPath(pid) ? getPath(pid).style : state.style;
  const cur = fillMode ? (fillSel ? fillSel.color : state.fillColor) : sty.color;
  const sw = CONFIG.SWATCHES.map(([name, c]) => `<button class="swatch${cur === c ? ' on' : ''}" data-action="setColor" data-arg="${c}" title="${name}"><span style="background:${c}"></span></button>`).join('');
  const weights = fillMode ? '' : `<span class="rule"></span><div class="row">${CONFIG.WEIGHTS.map((w) => `<button class="weight${sty.weight === w ? ' on' : ''}" data-action="setWeight" data-arg="${w}" title="${w}px"><span style="height:${Math.max(1.5, w)}px;background:${sty.color}"></span></button>`).join('')}</div>`;
  return `<div class="panel palette"><span class="title">${fillMode ? 'Fill' : pid ? 'Path' : 'Stroke'}</span><div class="grid">${sw}</div>${weights}</div>`;
}

function undoBar() {
  return `<div class="panel">${btn('↶', 'undo', '', { cls: 'icon', title: 'Undo (⌘Z)', disabled: !H.canUndo() })}${btn('↷', 'redo', '', { cls: 'icon', title: 'Redo (⇧⌘Z)', disabled: !H.canRedo() })}</div>`;
}

function hint() {
  const s = state.selection;
  if (state.layer === 'construction') {
    if (s && s.kind === 'element') {
      const el = getElement(s.id);
      if (el.kind === 'rotate') return 'Rotation: drag to move · pick 1/2, 1/3, 1/4 or 1/6 · clones turn about it';
      if (el.kind === 'mirror') return 'Mirror: drag to move · knob or [ ] rotates · put a translation after it in a chain for a glide';
      return 'Translation: drag the diamond to set the vector · snaps to twelfths of the lattice';
    }
    return 'Construction layer: add or drag elements and lattice handles · the drawing is locked · Tab to go back';
  }
  switch (state.tool) {
    case 'select':
      if (s && s.kind === 'points') return `${s.ids.length} point${s.ids.length > 1 ? 's' : ''} selected · drag to move together · ⇧-click adds · ⌫ deletes`;
      if (s && s.kind === 'clone') return 'Clone: drag its body to move its element · drag its anchors to edit the shared shape';
      if (s && s.kind === 'path') return 'Path: click a line to insert a point · drag ◇ to bend · double-click ◇ to straighten · box handles scale and rotate';
      return 'Select: click a point, line, clone or fill · drag a line to move the path · drag empty space to marquee points';
    case 'freehand': return 'Freehand: press and drag · release to fit curves · start on a point to continue its path';
    case 'fill': return 'Fill: hover a closed region to preview · click to colour it · click again to recolour';
    default:
      if (state.pen) return 'Pen: click to add · click a point or clone anchor to connect · click the last point, Esc or ↵ to finish · Space+drag moves the elements';
      if (!state.points.length && !state.elements.length) return 'Add an element (O rotation, M mirror, T translation), then draw — every stroke is cloned through it in every cell';
      return 'Pen: click a point to start or resume a path · click empty space to add a point';
  }
}

function counts() {
  const clones = state.bindings.reduce((n, b) => n + orbitOf(b.ops).matrices.length, 0);
  const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return `${pl(state.points.length, 'point')} · ${pl(state.paths.length, 'path')} · ${pl(state.elements.length, 'element')} · ${pl(clones, 'clone')} · ${pl(state.fills.length, 'fill')}`;
}

function help() {
  const k = (t) => `<span class="kbd">${t}</span>`;
  return `<div class="help">
<span>${k('Tab')} Drawing ↔ Construction · only the active layer responds to the pointer</span>
<span>${k('V')} select · ${k('P')} pen · ${k('F')} freehand · ${k('B')} fill · ${k('G')} snap (hold ${k('⇧')} to invert)</span>
<span>${k('O')} rotation · ${k('M')} mirror · ${k('T')} translation — bound to the selected path, else applied to new paths</span>
<span class="violet">Elements: drag to move · mirror knob or ${k('[')} ${k(']')} rotates · translation diamond sets the vector · a chain is applied left to right; a mirror then a half translation is a glide</span>
<span>Pen: click a point to start or resume · click empty space to add · click the last point, ${k('Esc')} or ${k('↵')} to end · ${k('Space')}+drag moves the elements</span>
<span>Select: click a line to select its path, again to insert a point · drag ◇ to bend, double-click to straighten · marquee points · ${k('⇧')} adds · box handles scale / rotate</span>
<span>Clone: drag its body to move its element · drag its anchors to edit the shared point</span>
<span>Fill: hover a closed region, click to colour · Structure paths sit below fills, Detail paths above</span>
<span>Wheel pans · ${k('⌘')}+wheel zooms · ${k('⌘0')} fits · hover a point + ${k('⌫')} deletes · ${k('⌘Z')} undo · ${k('⇧⌘Z')} redo</span>
</div>`;
}

export function renderChrome(root) {
  const cons = state.layer === 'construction';
  root.innerHTML = `<div class="top-left">${layerBar()}${cons ? '' : toolBar()}${cons && !state.selection ? elementsBar() + latticeBar() : ''}${selectionBar()}</div>
<div class="bottom-left">${cons ? '' : palette()}${undoBar()}</div>
<div class="hint"><span class="text">${esc(hint())}</span><span class="counts">${esc(counts())}</span></div>
<div class="top-right">${btn('?', 'toggleHelp', '', { cls: 'icon outline', title: 'Shortcuts (?)' })}${state.showHelp ? help() : ''}</div>`;
}

const ACTIONS = {
  setLayer: (a) => A.setLayer(a),
  setTool: (a) => A.setTool(a),
  setSublayer: (a) => A.setSublayer(a),
  toggleSnap: () => A.toggleSnap(),
  addElement: (a) => A.addElement(a),
  selectElement: (a) => A.selectElement(a),
  setLattice: (a) => A.setLattice(CONFIG.LATTICE_PRESETS[a]),
  toggleOp: (a) => { const [b, e] = a.split('|'); return A.toggleOpOnBinding(b, e); },
  toggleChain: (a) => { const b = getBinding(a); return b ? A.toggleNewPathChain(b.ops) : false; },
  removeBinding: (a) => A.removeBinding(a),
  addChain: (a) => A.addChain(a),
  togglePathLayer: (a) => A.togglePathLayer(a),
  selectCloneElement: () => { const id = selectedElementId(); if (!id) return false; A.selectElement(id); state.layer = 'construction'; return true; },
  selectSourcePath: () => { const s = state.selection; const b = s && s.kind === 'clone' ? getBinding(s.bindingId) : null; return b ? A.selectPath(b.pathId) : false; },
  toggleArmed: (a) => A.toggleNewPathChain([a]),
  setOrder: (a) => { const [id, n] = a.split('|'); return A.setRotationOrder(id, +n); },
  rotEl: (a) => { const [id, d] = a.split('|'); return A.rotateElement(id, +d); },
  setTranslate: (a) => { const [id, u, v] = a.split('|'); return A.setTranslation(id, +u, +v); },
  deleteSelection: () => A.deleteSelection(),
  setColor: (a) => (state.tool === 'fill' || (state.selection && state.selection.kind === 'fill') ? A.setFillColor(a) : A.setStyle({ color: a })),
  setWeight: (a) => A.setStyle({ weight: +a }),
  undo: () => A.undo(),
  redo: () => A.redo(),
  toggleHelp: () => A.toggleHelp(),
};

export function bindChrome(root, rerender) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b || b.disabled) return;
    const fn = ACTIONS[b.dataset.action];
    if (!fn) return;
    fn(b.dataset.arg);
    rerender();
  });
}
```

- [ ] **Step 2: Wire the chrome in `js/main.js`**

Add the imports and pass `renderChrome` as the after-render callback:

```js
import { state } from './state.js';
import { render } from './render.js';
import { renderChrome, bindChrome } from './ui.js';
import { loadExample } from './example.js';
import { fitView } from './actions.js';
import { createHandlers } from './interaction.js';

const svg = document.getElementById('canvas');
const chrome = document.getElementById('chrome');

function measure() {
  const r = svg.getBoundingClientRect();
  state.viewport = { width: r.width, height: r.height };
}

function rerender() { render(svg, () => renderChrome(chrome)); }

measure();
if (location.hash === '#example') loadExample();
fitView();
bindChrome(chrome, rerender);
createHandlers(svg, rerender).attach();
window.addEventListener('resize', () => { measure(); rerender(); });
rerender();
```

- [ ] **Step 3: Verify in the browser**

On `http://127.0.0.1:5173/`, no console errors:
1. Top-left shows Drawing / Construction and the tool group with Structure / Detail and Snap; bottom-left the stroke palette and greyed undo/redo; the hint reads the empty-state line; counts read zeros; `?` opens the sheet.
2. Click Construction: the Elements bar and Lattice bar appear. Click "+ ↻ Rotation": the element is selected and its bar shows Apply to new paths (on), the 1/n chips and Delete. Pick 1/3: the warning label appears on the square lattice. Click "Hex / triangle" in the Lattice bar after deselecting: the warning goes away when the element is reselected.
3. Draw a path on the Drawing layer, select it: the bar shows one chain row with the element chip on, ★ on, ✕, "+ chain", the three "+" buttons and "Below fills". Click "+ chain", then the element chip in the new row: a second clone set appears. Click ✕ on it: gone.
4. With a path selected the palette title reads "Path" and a swatch click recolours it. Press `B`: the palette title reads "Fill" and the weights hide.
5. Click a clone: the bar reads "Clone of path 1 via ↻1 · power 1" with "Select its element" (switches to Construction with it selected) and "Unlink".
6. Undo/redo buttons enable and disable with history; the counts line updates on every change.

- [ ] **Step 4: Commit**

```bash
git add js/ui.js js/main.js
git commit -m "Add floating chrome: layer/tool bars, element and lattice bars, selection bar, palette, hint, help

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Rewrite `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (replace the whole file)

- [ ] **Step 1: Replace `CLAUDE.md`**

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based tessellation editor: vanilla JavaScript ES modules + SVG, no framework, no build step, no runtime dependencies. Entry point is `index.html`, which loads `js/main.js` as a module. `#example` in the URL loads a demo document.

## Running it

ES modules won't load from `file://`, so serve the directory over HTTP:

```
npm run serve        # python3 -m http.server 5173 --bind 127.0.0.1
```

Then open http://127.0.0.1:5173/. There is no hot reload; hard-refresh after edits.

Tests: `npm test` runs `node --test tests/` with no dependencies. Only the pure modules and `history`/`actions` are tested; interactions are checked in the browser.

## Design documents

- `docs/superpowers/specs/2026-09-27-engine-rebuild-design.md` is the engine spec and the behavioural reference.
- `docs/superpowers/plans/2026-09-27-engine-rebuild.md` is the implementation plan it was built from.
- The Claude Design project "Tessellation Designer v2 Symmetry" was the original prototype.

## Model

Everything repeats along a **lattice** (`state.lattice`, vectors a and b). Points are stored **cell-local**; a path's nodes are `{ pointId, cell: {c, r} }`, so one point can appear in several cells and a path can leave the tile on one edge and continue from the other. Control points (`cps`, one per segment, quadratic) and fill seeds are world coordinates in the base-cell frame. A path is closed when its first and last node are the same point in the same cell. Paths have a `layer` of `structure` (drawn below fills) or `detail` (above).

**Elements** are the three primitive isometries: `translate {u, v}` (fractions of a and b), `mirror {cx, cy, angle}`, `rotate {cx, cy, n}` (1/n turn). There is no glide kind: a glide is a chain `[mirror, translate]`. The lattice itself is not an element.

**Bindings** are `{ pathId, ops: [elementId, ...] }`, applied left to right. Clones are never stored: `orbit()` in `js/transform.js` returns the powers of the chain's composite up to the first lattice translation (capped at 12, flagged `open` if it never closes). A clone is identified by `(bindingId, power)`. `state.newPathOps` is the list of chains every new path receives.

**Fills** are seed points `{x, y, color}`. `js/regions.js` builds a planar arrangement of every stroke and clone in the 3×3 window, walks its faces, and each seed paints the face containing it. Regions are recomputed (memoised on geometry) on every render.

## Architecture

**State + full re-render.** `js/state.js` exports one mutable `state`. Handlers mutate it, then call `render()` (`js/render.js`), which clears the SVG and rebuilds it, then rebuilds the HTML chrome (`js/ui.js`). Pointer-sensitive SVG elements carry `data-kind` and ids; `js/interaction.js` has one delegated listener set and dispatches to `js/tools/*.js` (`onDown/onMove/onUp`). Every pointerdown creates `state.drag`; a click is a drag that never moved past 3 px.

**Pure modules** (`lattice`, `transform`, `paths`, `hit`, `freehand`, `regions`) take a `doc` argument and never import `state`. Matrices are `[a, b, c, d, e, f]` in SVG order; `compose(A, B)` applies B then A.

**Actions** (`js/actions.js`) hold every user-level mutation. Toolbar and keyboard both call them. Each pushes history itself.

**History** (`js/history.js`) is snapshot-based over the document keys. `push()` before a discrete mutation; drags call `beginDrag()` on their first movement so one gesture is one entry. Pan/zoom never enter history.

**Coordinate spaces.** Screen → world via `state.view` (pan, zoom). World ↔ lattice `(u, v)` in `js/lattice.js`. Hit thresholds and handle sizes in `js/config.js` are screen pixels; divide by zoom. Anchor snapping (`js/hit.js`) considers every point and clone point in the 3×3 window, then falls back to the grid; element positions snap to the finer of the grid and twelfths.

## Shortcuts

`Tab` layer · `V` `P` `F` `B` tools · `O` `M` `T` add elements · `[` `]` rotate a mirror · `G` snap · `Esc`/`Enter` end pen · `⌫` delete hovered point or selection · `⌘Z` / `⇧⌘Z` · `⌘0` fit · wheel pans, `⌘`+wheel zooms. The `?` sheet in `js/ui.js` must stay in sync with `onKeyDown` in `js/interaction.js`.

## Known limitations

- Clones are not composed across bindings (no group closure).
- A face with a hole paints over the hole; fill the inner region explicitly.
- Collinear overlapping edges that are not identical are not split against each other.
```

- [ ] **Step 2: Run everything one last time**

Run: `npm test`
Expected: all pass. Open `http://127.0.0.1:5173/#example` and confirm the demo renders and the tools work as in Tasks 10–12.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Rewrite CLAUDE.md for the lattice/element/fill engine

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
