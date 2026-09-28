# Engine Rebuild (Project 1) Implementation Plan — Preact + Vite + TypeScript

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the tessellation editor from scratch around a lattice, three primitive symmetry elements composed into bindings, wrapping paths, computed clones editable through any rendered copy, and seed-based region fills with holes, plus autosave, JSON and SVG export, and touch input.

**Architecture:** The document is an immutable value in a Preact signal; actions clone it, mutate the draft with pure helpers, and commit. Everything in the document is in lattice `(u, v)` coordinates; world space exists only at render and hit-test time. Rendering draws the base cell once into `<defs>` and places `<use>` copies per visible cell. Hit-testing is geometric in the engine, so any copy is selectable and editable in place. Pointer handling is one listener set on the SVG that dispatches to per-tool modules.

**Tech Stack:** Vite, Preact, `@preact/signals`, TypeScript strict, Vitest, Playwright. Runtime dependencies: `preact`, `@preact/signals` only.

**Spec:** `docs/superpowers/specs/2026-09-27-engine-rebuild-design.md`

## Global Constraints

- Runtime dependencies are exactly `preact` and `@preact/signals`. Dev dependencies: `vite`, `typescript`, `@preact/preset-vite`, `vitest`, `@playwright/test`.
- `npm run dev` serves on `http://127.0.0.1:5173/`; `npm test` runs Vitest; `npm run e2e` runs Playwright; `npm run build` must pass with `tsc --noEmit` clean (`strict: true`).
- Every document entity has a string id from `makeId()`; never array indices.
- The document is never mutated after commit. Mutation helpers receive a draft produced by `draft()`.
- Document coordinates are lattice `(u, v)`. Control points are relative to the origin of their segment's first node's cell. Fill seeds are base-cell `(u, v)`. Element centres are `(u, v)`; mirror directions are lattice directions `(du, dv)`.
- Matrices are `readonly [a, b, c, d, e, f]` in SVG order, always in world space. `compose(A, B)` applies B then A.
- Hit thresholds in `config.ts` are screen pixels: divide by `zoom`, multiply by `hitScale` (2 for `pointerType === 'touch'`, else 1).
- History: `commit()` records; a gesture (`beginGesture()` … `endGesture()`) records one entry. View changes never enter history.
- Palette: background `#f4f2ec`, ink `#1c1b18`, accent `#3b6fd1`, elements `#7048e8`, lattice `#c2255c`, muted `#7a766c`, grid `#e2dfd5`, frame `#b9b5aa`.
- Every chrome control is a `<button>` with a `title`, 36 px minimum height, 44 px after a touch.
- Commit after every task with a message ending in `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **Coincident edges** (a path lying on its own mirror line or on a cell edge) must not produce zero-area faces or lose fills. Test in Task 6: duplicate edges are deduplicated.
2. **An empty binding chain** must yield zero clones, not an identity copy. Test in Task 2: `orbit([])` returns no matrices.
3. **A seed in a hole, outside every region, or on a preset change** must render nothing and never throw; a seed placed by clicking near an edge must survive a nudge because it sits at the centroid. Tests in Task 6 (`faceAt` in a hole is null; `seedFor` picks the centroid) and Task 9 (`fillAt` seeds at the centroid).
4. **Editing through a copy in a neighbouring cell or through a clone** must move the source by the inverse-mapped delta, not the raw delta. Tests in Task 5 (`hitTest` reports the copy) and Task 9 (moving a point via a copy in cell (1, 0) and via a clone).
5. **A second finger during a drag** must revert the drag to its pre-gesture state and hand over to navigation, never leave a half-moved point behind. Test in Task 14 (Playwright) and Task 4 (`abortGesture()` restores the recorded document).

## File structure

```
package.json, vite.config.ts, tsconfig.json, playwright.config.ts, index.html
src/main.tsx                       mount <App/>
src/styles.css                     tokens, panels, buttons, SVG classes, touch sizes
src/config.ts                      constants, colours, presets, swatches
src/types.ts                       all shared types
src/ids.ts                         makeId()
src/engine/lattice.ts              L, L⁻¹, cells, snapping in (u, v)
src/engine/transform.ts            matrices, matrixOf, orbit, classify
src/engine/paths.ts                draft mutations
src/engine/hit.ts                  hitTest, anchors, marquee, bbox maths
src/engine/regions.ts              arrangement → faces with holes, faceAt, seedFor, facePathData
src/engine/freehand.ts             RDP + quadratic fit
src/engine/serialize.ts            Doc ↔ JSON, SVG export
src/state/doc.ts                   doc signal, draft(), emptyDoc()
src/state/history.ts               commit, gestures, undo/redo, abortGesture
src/state/ui.ts                    UI signals
src/state/derived.ts               computeds: cloneMatrices, visibleCells, copies, anchors, faces (gated)
src/state/persist.ts               autosave + restore
src/actions.ts                     user-level actions
src/interaction/pointer.ts         pointer/keyboard/wheel, two-pointer navigation, dispatch
src/interaction/tools/common.ts    shared helpers and drags
src/interaction/tools/select.ts    select tool + shared point/segment/cp/anchor/bbox drags
src/interaction/tools/pen.ts       pen tool
src/interaction/tools/freehand.ts  freehand tool
src/interaction/tools/fill.ts      fill tool (press to preview)
src/interaction/tools/construct.ts construction layer
src/components/App.tsx
src/components/Canvas.tsx          SVG scene
src/components/Chrome.tsx          bars, palette, undo, file group, hint, help/settings
src/example.ts                     demo document
tests/unit/*.test.ts               Vitest
tests/e2e/*.spec.ts                Playwright
```

Deviation from the spec's file list, stated here so nobody hunts for it: the doc-level computeds live in `state/derived.ts` rather than `state/doc.ts`, to avoid an import cycle between the doc signal and history.

---

### Task 1: Clean slate, toolchain, types, config, empty app

**Files:**
- Delete: `geometry.js`, `state.js`, `transforms.js`, `styles.css`, `tessellation_editor_phase3_delete.html`, `FEATURE_SPEC.md`, `js/*`, `index.html`
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `playwright.config.ts`, `index.html`, `src/main.tsx`, `src/components/App.tsx`, `src/styles.css`, `src/config.ts`, `src/types.ts`, `src/ids.ts`, `tests/unit/ids.test.ts`, `.gitignore` (append)

**Interfaces:**
- Produces: every shared type in `types.ts` (used verbatim by all later tasks), `CONFIG`, `makeId(prefix?)`.

- [ ] **Step 1: Delete the old code**

```bash
git rm -q geometry.js state.js transforms.js styles.css tessellation_editor_phase3_delete.html FEATURE_SPEC.md index.html js/*.js
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "tesselator",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 5173",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@preact/signals": "^1.3.0",
    "preact": "^10.24.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0",
    "@preact/preset-vite": "^2.9.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

Then run `npm install` and `npx playwright install chromium`.

- [ ] **Step 3: Create `vite.config.ts`, `tsconfig.json`, `playwright.config.ts`**

`vite.config.ts`:

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
});
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "noUncheckedIndexedAccess": false,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["vite/client"]
  },
  "include": ["src", "tests", "vite.config.ts", "playwright.config.ts"]
}
```

`playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5173', ...devices['Desktop Chrome'], hasTouch: true },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
});
```

Append to `.gitignore`:

```
dist/
test-results/
playwright-report/
```

- [ ] **Step 4: Create `index.html` and `src/main.tsx`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>Tessellator</title>
</head>
<body>
<div id="root"></div>
<script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

```tsx
import { render } from 'preact';
import { App } from './components/App';
import './styles.css';

render(<App />, document.getElementById('root')!);
```

- [ ] **Step 5: Create `src/components/App.tsx` (placeholder until Task 7)**

```tsx
export function App() {
  return <div class="app"><svg class="canvas" /><div class="chrome" /></div>;
}
```

- [ ] **Step 6: Create `src/types.ts`**

```ts
export type UV = { u: number; v: number };
export type XY = { x: number; y: number };
export type Cell = { c: number; r: number };
export type Lattice = { ax: number; ay: number; bx: number; by: number };
export type Matrix = readonly [number, number, number, number, number, number];

export type Node = { pointId: string; cell: Cell };
export type Segment = { to: Node; cp: UV | null };          // cp relative to the previous node's cell origin
export type PathLayer = 'structure' | 'detail';
export type Style = { color: string; weight: number };
export type Path = { id: string; start: Node; segments: Segment[]; style: Style; layer: PathLayer };
export type Point = UV & { id: string };

export type Element =
  | { id: string; kind: 'translate'; u: number; v: number }
  | { id: string; kind: 'mirror'; u: number; v: number; du: number; dv: number }
  | { id: string; kind: 'rotate'; u: number; v: number; n: number };
export type ElementKind = Element['kind'];

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

// A rendered copy of a path: the source in a cell, or a clone (binding + power) in a cell.
export type Copy = { cell: Cell; bindingId: string | null; power: number };
export type CopyInfo = { pathId: string; copy: Copy; M: Matrix };

export type Layer = 'drawing' | 'construction';
export type Tool = 'select' | 'pen' | 'freehand' | 'fill';
export type View = { pan: XY; zoom: number };
export type Prefs = { style: Style; fillColor: string; snap: boolean; gridDivisions: number; ghostOpacity: number };

export type Selection =
  | null
  | { kind: 'path'; id: string; copy: Copy }
  | { kind: 'element'; id: string }
  | { kind: 'points'; ids: string[] }
  | { kind: 'fill'; id: string };

// Regions
export type WorldSeg = { a: XY; b: XY; cp: XY | null; source: { pathId: string; copy: Copy; j: number } };
export type Piece = { seg: WorldSeg; t0: number; t1: number; reversed: boolean };
export type Loop = { poly: XY[]; area: number; pieces: Piece[] };
export type Face = { outer: Loop; holes: Loop[]; area: number; centroid: XY };

export type BoxHandle = { x: number; y: number; ax: number; ay: number; cursor: string };
export type Box = { x0: number; y0: number; x1: number; y1: number };

export type HitTarget =
  | { kind: 'bbox'; h: number }
  | { kind: 'bboxrot' }
  | { kind: 'diamond'; pathId: string; j: number; copy: Copy }
  | { kind: 'point'; pointId: string; cell: Cell }
  | { kind: 'canchor'; pathId: string; pointId: string; cell: Cell; copy: Copy }
  | { kind: 'segment'; pathId: string; j: number; copy: Copy }
  | { kind: 'fill'; fillId: string }
  | { kind: 'face'; face: Face }
  | { kind: 'elrot'; elementId: string }
  | { kind: 'eltip'; elementId: string }
  | { kind: 'element'; elementId: string }
  | { kind: 'lat'; which: 'a' | 'b' };

export type PointerKind = 'mouse' | 'pen' | 'touch';

export type DragBase = { target: HitTarget | null; start: XY; moved: boolean; pointerId: number; hitScale: number };
export type Drag = DragBase & (
  | { kind: 'click' }
  | { kind: 'marquee'; cur: XY; add: boolean }
  | { kind: 'pt'; pointId: string; cell: Cell }
  | { kind: 'pts'; ids: string[]; startPos: Record<string, UV> }
  | { kind: 'body'; pathId: string; copy: Copy; ids: string[]; startPos: Record<string, UV>; startEls: Element[] }
  | { kind: 'canchor'; pathId: string; pointId: string; cell: Cell; copy: Copy }
  | { kind: 'cp'; pathId: string; j: number; copy: Copy }
  | { kind: 'bbox'; mode: 'scale' | 'rot'; h: BoxHandle; box: Box; cx: number; cy: number; pathId: string; copy: Copy; startDoc: Doc; M: Matrix | null }
  | { kind: 'free'; raw: XY[]; startNode: Node | null; cloneMatrices: Matrix[] }
  | { kind: 'fillpress' }
  | { kind: 'elc'; id: string; u0: number; v0: number }
  | { kind: 'elrot'; id: string }
  | { kind: 'eltip'; id: string }
  | { kind: 'lat'; which: 'a' | 'b' }
  | { kind: 'elmulti'; ids: string[]; startEls: Element[] }
);

// Omit that distributes over a union, so each Drag variant keeps its own fields.
export type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
export type DragSpec = DistributiveOmit<Drag, keyof DragBase>;
```

- [ ] **Step 7: Create `src/config.ts` and `src/ids.ts`**

```ts
import type { Lattice } from './types';

export const CONFIG = {
  SNAP_PX: 12,
  HANDLE_PX: 6,          // radius of point / handle hit circles
  HIT_WIDTH: 14,         // segment hit width
  DRAG_THRESHOLD_PX: 3,
  BBOX_ROT_OFFSET: 26,
  ELEMENT_ROT_OFFSET: 70,
  TOUCH_HIT_SCALE: 2,

  ZOOM_MIN: 0.2,
  ZOOM_MAX: 8,
  MAX_HISTORY: 50,
  ORBIT_CAP: 12,
  MIN_LATTICE_DET: 400,
  VISIBLE_CELL_RADIUS: 3,
  DEFAULT_GRID_DIVISIONS: 8,
  DEFAULT_GHOST_OPACITY: 0.45,
  FREEHAND_EPS: 5,
  FREEHAND_MIN_DEVIATION: 2.5,
  AUTOSAVE_MS: 300,
  MAX_WALLPAPER: 64,

  COLORS: {
    background: '#f4f2ec', ink: '#1c1b18', muted: '#7a766c', grid: '#e2dfd5', frame: '#b9b5aa',
    accent: '#3b6fd1', element: '#7048e8', lattice: '#c2255c',
  },
  SWATCHES: [['Ink', '#1c1b18'], ['Red', '#c2255c'], ['Blue', '#1c7ed6'], ['Green', '#2b8a3e'], ['Ochre', '#c98a12'], ['Violet', '#7048e8']] as const,
  WEIGHTS: [1, 2, 3.5, 6, 10] as const,
  LATTICE_PRESETS: {
    Square: { ax: 240, ay: 0, bx: 0, by: 240 },
    Rectangle: { ax: 300, ay: 0, bx: 0, by: 200 },
    Parallelogram: { ax: 240, ay: 0, bx: 100, by: 220 },
    'Rhombus 60°': { ax: 240, ay: 0, bx: 120, by: 207.85 },
    'Hex / triangle': { ax: 240, ay: 0, bx: -120, by: 207.85 },
  } as Record<string, Lattice>,
  STORAGE_DOC_KEY: 'tessellator.doc.v1',
  STORAGE_PREFS_KEY: 'tessellator.prefs.v1',
};
```

```ts
let counter = 0;
export function makeId(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}
```

- [ ] **Step 8: Create `src/styles.css`**

```css
:root {
  --bg: #f4f2ec; --ink: #1c1b18; --muted: #7a766c; --grid: #e2dfd5; --frame: #b9b5aa;
  --accent: #3b6fd1; --element: #7048e8; --lattice: #c2255c; --panel-border: #d8d4c9;
  --shadow: 0 2px 8px rgba(28, 27, 24, 0.08); --btn-h: 36px;
}
html, body, #root { margin: 0; height: 100%; }
body { background: var(--bg); color: var(--ink); font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; overflow: hidden; }
.app { position: fixed; inset: 0; }
.app[data-pointer="touch"] { --btn-h: 44px; }
.canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; user-select: none; -webkit-user-select: none; }
.chrome { position: absolute; inset: 0; pointer-events: none; }
.chrome > * { pointer-events: auto; }

.panel { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 4px; background: #fff; border: 1px solid var(--panel-border); border-radius: 10px; box-shadow: var(--shadow); }
.panel.bar { padding: 6px 8px; gap: 6px; }
.panel .label { font-size: 12px; color: var(--muted); margin: 0 2px; }
.btn { min-height: var(--btn-h); padding: 0 12px; border: 1px solid transparent; border-radius: 8px; background: #fff; color: var(--ink); font: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.btn:hover { background: #f1eee6; }
.btn.on { background: var(--ink); color: #fff; }
.btn.outline { border-color: var(--panel-border); }
.btn.violet { border-color: var(--element); color: var(--element); }
.btn.violet.on { background: var(--element); color: #fff; }
.btn.small { font-size: 12px; padding: 0 10px; }
.btn.icon { width: 40px; padding: 0; justify-content: center; font-size: 18px; }
.btn:disabled { opacity: 0.3; cursor: default; }
.kbd { font: 11px ui-monospace, Menlo, monospace; border: 1px solid currentColor; border-radius: 3px; padding: 0 4px; opacity: 0.7; }
.sep { width: 1px; height: 24px; background: var(--panel-border); margin: 0 4px; }
.swatch { width: 40px; height: var(--btn-h); border: 0; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; }
.swatch span { display: block; width: 20px; height: 20px; border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,0.12); }
.swatch.on span { box-shadow: 0 0 0 2px #fff, 0 0 0 3.5px var(--ink); }
.weight { width: 24px; height: var(--btn-h); border: 0; border-radius: 6px; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; }
.weight.on { background: #efece4; }
.weight span { display: block; width: 16px; border-radius: 99px; }
.field { width: 56px; min-height: 30px; border: 1px solid var(--panel-border); border-radius: 6px; font: inherit; padding: 0 6px; }
.top-left { position: absolute; left: 16px; top: 12px; max-width: calc(100% - 200px); display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; }
.bottom-left { position: absolute; left: 16px; bottom: 12px; display: flex; flex-direction: column; gap: 8px; }
.palette { display: flex; flex-direction: column; gap: 6px; padding: 8px; }
.palette .title { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); padding-left: 2px; }
.palette .grid { display: grid; grid-template-columns: repeat(3, 40px); gap: 2px; }
.palette .rule { height: 1px; background: var(--panel-border); }
.palette .row { display: flex; gap: 2px; }
.hint { position: absolute; left: 132px; right: 16px; bottom: 12px; min-height: 54px; display: flex; justify-content: space-between; align-items: center; gap: 24px; color: var(--muted); pointer-events: none; }
.hint .text { flex: 1; min-width: 0; font-size: 13px; }
.hint .counts { flex: none; font-size: 12px; white-space: nowrap; }
.top-right { position: absolute; right: 16px; top: 12px; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.help { width: 300px; padding: 12px 14px; background: #fff; border: 1px solid var(--panel-border); border-radius: 10px; box-shadow: var(--shadow); font-size: 12px; line-height: 1.5; display: flex; flex-direction: column; gap: 4px; }
.help .violet { color: var(--element); }
.help .settings { display: flex; align-items: center; gap: 8px; padding-top: 6px; border-top: 1px solid var(--panel-border); margin-top: 4px; }
.popover { width: 260px; padding: 10px 12px; background: #fff; border: 1px solid var(--panel-border); border-radius: 10px; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 8px; }
.preset svg { flex: none; }

/* SVG. Path strokes are world units; everything else is screen-constant. */
.grid-line { stroke: var(--grid); stroke-width: 1; vector-effect: non-scaling-stroke; }
.frame { fill: none; stroke: var(--frame); stroke-width: 1; stroke-dasharray: 6 5; vector-effect: non-scaling-stroke; }
.frame.base { stroke: var(--ink); stroke-width: 1.5; }
.el-ghost { fill: none; stroke: var(--element); stroke-width: 1; stroke-dasharray: 6 5; opacity: 0.22; vector-effect: non-scaling-stroke; }
.stroke { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.halo { fill: none; stroke: var(--accent); stroke-linecap: round; }
.guide { stroke: var(--accent); stroke-width: 1; stroke-dasharray: 2 3; opacity: 0.7; vector-effect: non-scaling-stroke; }
.rubber { stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 4 4; vector-effect: non-scaling-stroke; }
.marquee { fill: rgba(59, 111, 209, 0.08); stroke: var(--accent); stroke-width: 1; stroke-dasharray: 4 3; vector-effect: non-scaling-stroke; }
.bbox { fill: none; stroke: var(--accent); stroke-width: 1; stroke-dasharray: 4 3; vector-effect: non-scaling-stroke; }
.bbox.ghost { stroke-dasharray: 3 4; opacity: 0.35; }
.handle { fill: #fff; stroke: var(--accent); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.handle.hover { fill: #e6edfa; stroke-width: 2.5; }
.diamond { stroke: var(--accent); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.diamond.hover { stroke-width: 2.5; }
.pt { fill: var(--bg); stroke: var(--ink); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.pt.hover { stroke: var(--accent); stroke-width: 2.5; }
.pt.sel { fill: var(--accent); stroke: var(--accent); }
.pt.dim { stroke: #9c988c; }
.canchor { fill: var(--bg); stroke: #9c988c; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.canchor.sel { fill: #e6edfa; stroke: var(--accent); }
.canchor.hover { stroke: var(--accent); stroke-width: 2.5; }
.el-line { stroke: var(--element); stroke-dasharray: 10 6; vector-effect: non-scaling-stroke; }
.el-mark { fill: #fff; stroke: var(--element); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.el-mark.armed { fill: #efe9fb; }
.el-mark.hover { fill: #efe9fb; stroke-width: 2.5; }
.el-cross { stroke: var(--element); stroke-width: 1; vector-effect: non-scaling-stroke; }
.el-knob { fill: #fff; stroke: var(--element); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.el-knob.hover { fill: #efe9fb; stroke-width: 2.5; }
.el-arrow { stroke: var(--element); stroke-width: 2; vector-effect: non-scaling-stroke; }
.el-label { fill: var(--element); }
.lat-line { stroke: var(--lattice); stroke-width: 1; stroke-dasharray: 2 3; opacity: 0.6; vector-effect: non-scaling-stroke; }
.lat-handle { fill: #fff; stroke: var(--lattice); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.lat-handle.hover { fill: #fbe7ee; stroke-width: 2.5; }
.lat-label { fill: var(--lattice); font-style: italic; }
.fill { stroke: none; fill-rule: evenodd; }
.fill-hover { fill: var(--accent); opacity: 0.25; fill-rule: evenodd; }
.free { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.inactive-layer { opacity: 0.45; }
```

- [ ] **Step 9: Write `tests/unit/ids.test.ts`**

```ts
import { test, expect } from 'vitest';
import { makeId } from '../../src/ids';
import { CONFIG } from '../../src/config';

test('makeId returns unique prefixed strings', () => {
  const a = makeId('p'), b = makeId('p');
  expect(a).not.toBe(b);
  expect(a).toMatch(/^p_/);
});

test('config exposes five lattice presets and six swatches', () => {
  expect(Object.keys(CONFIG.LATTICE_PRESETS)).toHaveLength(5);
  expect(CONFIG.SWATCHES).toHaveLength(6);
});
```

- [ ] **Step 10: Run tests, typecheck, and the dev server**

Run: `npm test` → 2 passing. Run: `npx tsc --noEmit` → clean. Run: `npm run dev` and open `http://127.0.0.1:5173/`: a blank warm page, no console errors.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "Clean slate: Vite + Preact + TypeScript toolchain, types and config

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Lattice maths and transforms

**Files:**
- Create: `src/engine/lattice.ts`, `src/engine/transform.ts`, `tests/unit/lattice.test.ts`, `tests/unit/transform.test.ts`

**Interfaces:**
- `lattice.ts`: `toWorld(uv, lat) → XY`, `toUV(p, lat) → UV`, `cellOf(uv) → { cell, local }`, `nodeUV(point, cell) → UV`, `windowOffsets() → Cell[]` (9, row-major, `[4]` is base), `visibleOffsets(view, lat, w, h, radius) → Cell[]` (always includes base), `snapGrid(uv, div) → UV`, `snapFraction(uv, div, lat) → UV`, `isDegenerate(lat, min?) → boolean`, `cellPolygon(cell, lat) → XY[]`, `latticeAngle(lat) → degrees`.
- `transform.ts`: `IDENTITY`, `translation`, `rotation(theta, cx, cy)`, `reflection(angleRad, cx, cy)`, `compose`, `invert`, `apply`, `power`, `cellMatrix(cell, lat)`, `matrixOf(element, lat)`, `isLatticeTranslation(M, lat)`, `composite(ops, elements, lat)`, `orbit(ops, elements, lat, cap?) → { matrices, open }`, `classify(M)`, `toSvg(M)`, `mirrorAngle(el, lat) → degrees` (world angle of a mirror), `mirrorDirFromAngle(deg, lat) → { du, dv }`.

- [ ] **Step 1: Write `tests/unit/lattice.test.ts`**

```ts
import { test, expect } from 'vitest';
import { toWorld, toUV, cellOf, nodeUV, windowOffsets, visibleOffsets, snapGrid, snapFraction, isDegenerate, cellPolygon, latticeAngle } from '../../src/engine/lattice';
import { CONFIG } from '../../src/config';

const sq = CONFIG.LATTICE_PRESETS.Square, rh = CONFIG.LATTICE_PRESETS['Rhombus 60°'];

test('toUV/toWorld round-trip on every preset', () => {
  for (const lat of Object.values(CONFIG.LATTICE_PRESETS)) {
    const p = { x: 37.5, y: -91.25 }, q = toWorld(toUV(p, lat), lat);
    expect(q.x).toBeCloseTo(p.x, 9); expect(q.y).toBeCloseTo(p.y, 9);
  }
});

test('cellOf floors and keeps the remainder; a corner belongs to the next cell', () => {
  expect(cellOf({ u: 1.25, v: -0.5 })).toEqual({ cell: { c: 1, r: -1 }, local: { u: 0.25, v: 0.5 } });
  expect(cellOf({ u: 1, v: 1 })).toEqual({ cell: { c: 1, r: 1 }, local: { u: 0, v: 0 } });
  expect(nodeUV({ u: 0.25, v: 0.5 }, { c: 1, r: -1 })).toEqual({ u: 1.25, v: -0.5 });
});

test('windowOffsets is the 3x3 neighbourhood, base at index 4', () => {
  const w = windowOffsets();
  expect(w).toHaveLength(9); expect(w[4]).toEqual({ c: 0, r: 0 }); expect(w[0]).toEqual({ c: -1, r: -1 });
});

test('visibleOffsets covers the viewport, is clamped, always includes the base cell', () => {
  const far = visibleOffsets({ pan: { x: -5000, y: -5000 }, zoom: 1 }, sq, 100, 100, 3);
  expect(far.some((o) => o.c === 0 && o.r === 0)).toBe(true);
  const wide = visibleOffsets({ pan: { x: 1200, y: 1200 }, zoom: 0.1 }, sq, 2400, 2400, 3);
  expect(wide).toHaveLength(49);
  expect(wide.every((o) => Math.abs(o.c) <= 3 && Math.abs(o.r) <= 3)).toBe(true);
});

test('snapGrid and snapFraction round in lattice coordinates on a skewed lattice', () => {
  expect(snapGrid({ u: 0.51, v: 0.24 }, 8)).toEqual({ u: 0.5, v: 0.25 });
  const s = snapFraction({ u: 0.34, v: 0.01 }, 8, rh);
  expect(s.u).toBeCloseTo(1 / 3, 9); expect(s.v).toBeCloseTo(0, 9);
  const g = snapFraction({ u: 0.38, v: 0 }, 8, rh);
  expect(g.u).toBeCloseTo(0.375, 9);
});

test('isDegenerate, cellPolygon and latticeAngle', () => {
  expect(isDegenerate({ ax: 240, ay: 0, bx: 240, by: 1 })).toBe(true);
  expect(isDegenerate(sq)).toBe(false);
  expect(cellPolygon({ c: 1, r: 0 }, sq)[2]).toEqual({ x: 480, y: 240 });
  expect(latticeAngle(rh)).toBeCloseTo(60, 1);
  expect(latticeAngle(sq)).toBeCloseTo(90, 9);
});
```

- [ ] **Step 2: Write `tests/unit/transform.test.ts`**

```ts
import { test, expect } from 'vitest';
import { IDENTITY, translation, rotation, reflection, compose, invert, apply, power, cellMatrix, matrixOf, isLatticeTranslation, composite, orbit, classify, toSvg, mirrorAngle, mirrorDirFromAngle } from '../../src/engine/transform';
import { CONFIG } from '../../src/config';
import type { Element, XY } from '../../src/types';

const lat = CONFIG.LATTICE_PRESETS.Square, hex = CONFIG.LATTICE_PRESETS['Hex / triangle'], rh = CONFIG.LATTICE_PRESETS['Rhombus 60°'];
const near = (p: XY, q: XY) => { expect(p.x).toBeCloseTo(q.x, 6); expect(p.y).toBeCloseTo(q.y, 6); };

test('primitive matrices move sample points correctly', () => {
  near(apply(translation(10, -5), { x: 1, y: 1 }), { x: 11, y: -4 });
  near(apply(rotation(Math.PI / 2, 100, 100), { x: 110, y: 100 }), { x: 100, y: 110 });
  near(apply(reflection(Math.PI / 2, 50, 0), { x: 60, y: 7 }), { x: 40, y: 7 });
  near(apply(reflection(0, 0, 20), { x: 3, y: 25 }), { x: 3, y: 15 });
});

test('compose applies B then A; invert undoes; power repeats', () => {
  const A = rotation(Math.PI / 3, 10, 10), B = translation(5, 0), p = { x: 1, y: 2 };
  near(apply(compose(A, B), p), apply(A, apply(B, p)));
  near(apply(compose(invert(A), A), p), p);
  near(apply(power(A, 6), p), p);
  expect(power(A, 0)).toEqual(IDENTITY);
});

const els: Element[] = [
  { id: 'r2', kind: 'rotate', u: 0.5, v: 0.5, n: 2 },
  { id: 'r3', kind: 'rotate', u: 1 / 3, v: 1 / 3, n: 3 },
  { id: 'r4', kind: 'rotate', u: 0, v: 0, n: 4 },
  { id: 'r6', kind: 'rotate', u: 0, v: 0, n: 6 },
  { id: 'r5', kind: 'rotate', u: 0, v: 0, n: 5 },
  { id: 'm', kind: 'mirror', u: 0, v: 0.5, du: 1, dv: 0 },
  { id: 'mb', kind: 'mirror', u: 0.5, v: 0, du: 0, dv: 1 },
  { id: 't12', kind: 'translate', u: 0.5, v: 0 },
  { id: 't13', kind: 'translate', u: 1 / 3, v: 0 },
  { id: 'tc', kind: 'translate', u: 0.5, v: 0.5 },
  { id: 't1', kind: 'translate', u: 1, v: 0 },
  { id: 't37', kind: 'translate', u: 0.37, v: 0 },
];

test('matrixOf builds each element kind in world space from lattice coordinates', () => {
  near(apply(matrixOf(els[7], lat), { x: 0, y: 0 }), { x: 120, y: 0 });
  near(apply(matrixOf(els[0], lat), { x: 0, y: 0 }), { x: 240, y: 240 });
  near(apply(matrixOf(els[6], lat), { x: 0, y: 5 }), { x: 240, y: 5 });      // mirror along b at u = 1/2 is the line x = 120
  near(apply(cellMatrix({ c: 1, r: -1 }, lat), { x: 0, y: 0 }), { x: 240, y: -240 });
  // on a skewed lattice, a mirror along b reflects across the line through L(0.5, 0) with direction b
  const M = matrixOf(els[6], rh);
  near(apply(M, { x: 120, y: 0 }), { x: 120, y: 0 });                          // on the line
  near(apply(M, { x: 120 + 120, y: 207.85 }), { x: 120 + 120, y: 207.85 });    // also on the line (one b along)
});

test('mirror angle round-trips through a lattice direction', () => {
  expect(mirrorAngle(els[6], lat)).toBeCloseTo(90, 6);
  expect(mirrorAngle(els[6], rh)).toBeCloseTo(60, 1);
  const d = mirrorDirFromAngle(45, lat);
  expect(d.du).toBeCloseTo(d.dv, 9);
});

test('isLatticeTranslation accepts integer lattice steps only', () => {
  expect(isLatticeTranslation(translation(240, -480), lat)).toBe(true);
  expect(isLatticeTranslation(translation(120, 0), lat)).toBe(false);
  expect(isLatticeTranslation(rotation(Math.PI, 0, 0), lat)).toBe(false);
  expect(isLatticeTranslation(IDENTITY, lat)).toBe(true);
});

test('orbit sizes match the spec table', () => {
  const n = (ops: string[], L = lat) => orbit(ops, els, L).matrices.length;
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
  expect(n([])).toBe(0);
  expect(orbit([], els, lat).open).toBe(false);
});

test('a 5-fold rotation still closes (R⁵ is the identity); a translation by 0.37 never does and is capped open', () => {
  expect(orbit(['r5'], els, lat).matrices).toHaveLength(4);
  const o = orbit(['t37'], els, lat, 12);
  expect(o.matrices).toHaveLength(12); expect(o.open).toBe(true);
});

test('composite applies ops left to right', () => {
  const p = { x: 10, y: 20 };
  near(apply(composite(['m', 't12'], els, lat), p), apply(matrixOf(els[7], lat), apply(matrixOf(els[5], lat), p)));
});

test('classify recognises each isometry', () => {
  expect(classify(IDENTITY).kind).toBe('identity');
  expect(classify(translation(3, 4)).kind).toBe('translation');
  const rot = classify(compose(matrixOf(els[0], lat), matrixOf(els[7], lat)));
  expect(rot.kind).toBe('rotation');
  if (rot.kind === 'rotation') near(rot.center, { x: 60, y: 120 });
  const g = classify(composite(['m', 't12'], els, lat));
  expect(g.kind).toBe('glide');
  if (g.kind === 'glide') expect(Math.abs(g.slide)).toBeCloseTo(120, 6);
  expect(classify(matrixOf(els[5], lat)).kind).toBe('reflection');
});

test('toSvg formats a matrix attribute', () => {
  expect(toSvg(translation(1, 2))).toBe('matrix(1 0 0 1 1 2)');
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm test` → both files fail to import.

- [ ] **Step 4: Create `src/engine/lattice.ts`**

```ts
import type { UV, XY, Cell, Lattice, View } from '../types';

export function toWorld(uv: UV, lat: Lattice): XY {
  return { x: uv.u * lat.ax + uv.v * lat.bx, y: uv.u * lat.ay + uv.v * lat.by };
}

export function toUV(p: XY, lat: Lattice): UV {
  const det = lat.ax * lat.by - lat.bx * lat.ay || 1;
  return { u: (p.x * lat.by - p.y * lat.bx) / det, v: (-p.x * lat.ay + p.y * lat.ax) / det };
}

const EPS = 1e-9;
export function cellOf(uv: UV): { cell: Cell; local: UV } {
  const c = Math.floor(uv.u + EPS), r = Math.floor(uv.v + EPS);
  const local = { u: uv.u - c, v: uv.v - r };
  if (Math.abs(local.u) < EPS) local.u = 0;
  if (Math.abs(local.v) < EPS) local.v = 0;
  return { cell: { c, r }, local };
}

export function nodeUV(point: UV, cell: Cell): UV { return { u: point.u + cell.c, v: point.v + cell.r }; }

export function windowOffsets(): Cell[] {
  const out: Cell[] = [];
  for (let r = -1; r <= 1; r++) for (let c = -1; c <= 1; c++) out.push({ c, r });
  return out;
}

export function visibleOffsets(view: View, lat: Lattice, width: number, height: number, radius = 3): Cell[] {
  const corners = [[0, 0], [width, 0], [0, height], [width, height]].map(([sx, sy]) =>
    toUV({ x: (sx - view.pan.x) / view.zoom, y: (sy - view.pan.y) / view.zoom }, lat));
  const us = corners.map((k) => k.u), vs = corners.map((k) => k.v);
  const c0 = Math.max(-radius, Math.floor(Math.min(...us)) - 1), c1 = Math.min(radius, Math.floor(Math.max(...us)) + 1);
  const r0 = Math.max(-radius, Math.floor(Math.min(...vs)) - 1), r1 = Math.min(radius, Math.floor(Math.max(...vs)) + 1);
  const out: Cell[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push({ c, r });
  if (!out.some((o) => o.c === 0 && o.r === 0)) out.push({ c: 0, r: 0 });
  return out;
}

export function snapGrid(uv: UV, div: number): UV {
  return { u: Math.round(uv.u * div) / div, v: Math.round(uv.v * div) / div };
}

// The finer of the grid and twelfths, judged by world distance.
export function snapFraction(uv: UV, div: number, lat: Lattice): UV {
  const a = snapGrid(uv, div), b = snapGrid(uv, 12);
  const p = toWorld(uv, lat), wa = toWorld(a, lat), wb = toWorld(b, lat);
  return Math.hypot(wa.x - p.x, wa.y - p.y) <= Math.hypot(wb.x - p.x, wb.y - p.y) ? a : b;
}

export function isDegenerate(lat: Lattice, min = 400): boolean {
  return Math.abs(lat.ax * lat.by - lat.bx * lat.ay) < min;
}

export function cellPolygon(cell: Cell, lat: Lattice): XY[] {
  return [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 1, v: 1 }, { u: 0, v: 1 }].map((k) => toWorld({ u: k.u + cell.c, v: k.v + cell.r }, lat));
}

export function latticeAngle(lat: Lattice): number {
  return Math.abs((Math.atan2(lat.ax * lat.by - lat.ay * lat.bx, lat.ax * lat.bx + lat.ay * lat.by) * 180) / Math.PI);
}
```

- [ ] **Step 5: Create `src/engine/transform.ts`**

```ts
import type { Matrix, XY, UV, Cell, Lattice, Element } from '../types';
import { toWorld, toUV } from './lattice';

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function translation(dx: number, dy: number): Matrix { return [1, 0, 0, 1, dx, dy]; }

export function rotation(theta: number, cx = 0, cy = 0): Matrix {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}

// Reflection across the line through (cx, cy) at angle theta (radians) from the x axis.
export function reflection(theta: number, cx = 0, cy = 0): Matrix {
  const c2 = Math.cos(2 * theta), s2 = Math.sin(2 * theta);
  return [c2, s2, s2, -c2, cx - c2 * cx - s2 * cy, cy - s2 * cx + c2 * cy];
}

export function compose(A: Matrix, B: Matrix): Matrix {
  return [
    A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}

export function invert(M: Matrix): Matrix {
  const [a, b, c, d, e, f] = M;
  const det = a * d - b * c;
  const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}

export function apply(M: Matrix, p: XY): XY {
  return { x: M[0] * p.x + M[2] * p.y + M[4], y: M[1] * p.x + M[3] * p.y + M[5] };
}

export function power(M: Matrix, k: number): Matrix {
  let R = IDENTITY;
  for (let i = 0; i < k; i++) R = compose(M, R);
  return R;
}

export function cellMatrix(cell: Cell, lat: Lattice): Matrix {
  const t = toWorld({ u: cell.c, v: cell.r }, lat);
  return translation(t.x, t.y);
}

export function mirrorAngle(el: { du: number; dv: number }, lat: Lattice): number {
  const d = toWorld({ u: el.du, v: el.dv }, lat);
  return (((Math.atan2(d.y, d.x) * 180) / Math.PI) % 180 + 180) % 180;
}

export function mirrorDirFromAngle(deg: number, lat: Lattice): { du: number; dv: number } {
  const t = (deg * Math.PI) / 180;
  const uv = toUV({ x: Math.cos(t), y: Math.sin(t) }, lat);
  return { du: uv.u, dv: uv.v };
}

export function matrixOf(el: Element, lat: Lattice): Matrix {
  if (el.kind === 'translate') { const t = toWorld({ u: el.u, v: el.v }, lat); return translation(t.x, t.y); }
  const c = toWorld({ u: el.u, v: el.v }, lat);
  if (el.kind === 'mirror') { const d = toWorld({ u: el.du, v: el.dv }, lat); return reflection(Math.atan2(d.y, d.x), c.x, c.y); }
  return rotation((2 * Math.PI) / el.n, c.x, c.y);
}

export function isLatticeTranslation(M: Matrix, lat: Lattice, eps = 1e-6): boolean {
  if (Math.abs(M[0] - 1) > eps || Math.abs(M[1]) > eps || Math.abs(M[2]) > eps || Math.abs(M[3] - 1) > eps) return false;
  const { u, v } = toUV({ x: M[4], y: M[5] }, lat);
  return Math.abs(u - Math.round(u)) < eps && Math.abs(v - Math.round(v)) < eps;
}

export function composite(ops: string[], elements: Element[], lat: Lattice): Matrix {
  let M = IDENTITY;
  for (const id of ops) {
    const el = elements.find((e) => e.id === id);
    if (el) M = compose(matrixOf(el, lat), M);
  }
  return M;
}

export function orbit(ops: string[], elements: Element[], lat: Lattice, cap = 12): { matrices: Matrix[]; open: boolean } {
  const M = composite(ops, elements, lat);
  const matrices: Matrix[] = [];
  let P = M;
  for (let k = 1; k <= cap; k++) {
    if (isLatticeTranslation(P, lat)) return { matrices, open: false };
    matrices.push(P);
    P = compose(M, P);
  }
  return { matrices, open: true };
}

export type Classified =
  | { kind: 'identity' }
  | { kind: 'translation'; vector: XY }
  | { kind: 'rotation'; angle: number; center: XY }
  | { kind: 'reflection'; line: { angle: number; point: XY } }
  | { kind: 'glide'; line: { angle: number; point: XY }; slide: number };

export function classify(M: Matrix, eps = 1e-6): Classified {
  const [a, b, c, d, e, f] = M;
  const det = a * d - b * c;
  if (det > 0) {
    if (Math.abs(a - 1) < eps && Math.abs(b) < eps) {
      return Math.abs(e) < eps && Math.abs(f) < eps ? { kind: 'identity' } : { kind: 'translation', vector: { x: e, y: f } };
    }
    const m00 = 1 - a, m01 = -c, m10 = -b, m11 = 1 - d, dd = m00 * m11 - m01 * m10;
    return { kind: 'rotation', angle: Math.atan2(b, a), center: { x: (m11 * e - m01 * f) / dd, y: (-m10 * e + m00 * f) / dd } };
  }
  const theta = Math.atan2(b, a) / 2;
  const dir = { x: Math.cos(theta), y: Math.sin(theta) };
  const along = e * dir.x + f * dir.y;
  const px = e - along * dir.x, py = f - along * dir.y;
  const line = { angle: (theta * 180) / Math.PI, point: { x: px / 2, y: py / 2 } };
  return Math.abs(along) < eps ? { kind: 'reflection', line } : { kind: 'glide', line, slide: along };
}

export function toSvg(M: Matrix): string { return `matrix(${M.join(' ')})`; }
```

- [ ] **Step 6: Run the tests**

Run: `npm test` → all pass. The rotation-centre expectation: a 180° turn about (120,120) applied after a translation by 120 in x is `x ↦ 120 − x`, `y ↦ 240 − y`, fixed point (60, 120).

- [ ] **Step 7: Commit**

```bash
git add src/engine/lattice.ts src/engine/transform.ts tests/unit/lattice.test.ts tests/unit/transform.test.ts
git commit -m "Add lattice maths and affine transforms with orbits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 3: Document mutations (paths, elements, bindings, fills)

**Files:**
- Create: `src/engine/paths.ts`, `tests/unit/paths.test.ts`

**Interfaces:**
- All functions take a `Doc` draft first and mutate it. `getPoint/getPath/getElement/getBinding/getFill(doc, id)`, `sameNode(a, b)`, `pathNodes(path) → Node[]`, `prevNode(path, j) → Node`, `nodeUVAbs(doc, node) → UV`, `nodeWorld(doc, node) → XY`, `pathWorld(doc, path) → XY[]`, `cpAbs(path, j) → UV|null` (absolute lattice coords), `cpWorld(doc, path, j) → XY|null`, `pathCpsWorld(doc, path) → (XY|null)[]`, `isClosed(path)`, `addPoint(doc, uv) → Node`, `startPath(doc, node, style, layer?) → Path`, `appendNode(doc, pathId, node) → boolean`, `insertNode(doc, pathId, j, uv|null) → Node`, `pruneOrphans(doc)`, `deletePoints(doc, ids)`, `deletePath(doc, pathId)`, `openEndAt(doc, pointId) → pathId|null`, `reversePath(path)`, `orientToEnd(doc, pathId, pointId, cell)`, `shiftControlPoints(doc, ids, du, dv)`, `movePoint(doc, pointId, u, v)`, `snapshotPositions(doc, ids)`, `movePointsBy(doc, ids, startPos, du, dv)`, `setControlPointAbs(doc, pathId, j, uv|null)`, `setControlPointWorld(doc, pathId, j, xy|null)`, `transformPath(doc, pathId, M)` (world matrix), `boundsWorld(doc, path, M?) → Box`, `addElement(doc, spec) → Element`, `deleteElement(doc, id)`, `addBinding(doc, pathId, ops?) → Binding`, `toggleOp(doc, bindingId, elementId)`, `removeBinding(doc, id)`, `cloneMatrices(doc, bindingId, cap?) → { matrices, open }`, `addFill(doc, uv, color) → Fill`, `removeFill(doc, id)`.

- [ ] **Step 1: Write `tests/unit/paths.test.ts`**

```ts
import { test, expect } from 'vitest';
import * as P from '../../src/engine/paths';
import { rotation } from '../../src/engine/transform';
import { CONFIG } from '../../src/config';
import type { Doc, UV } from '../../src/types';

function makeDoc(): Doc {
  return { version: 1, lattice: { ...CONFIG.LATTICE_PRESETS.Square }, points: [], paths: [], elements: [], bindings: [], fills: [], newPathOps: [] };
}
const style = { color: '#000', weight: 2 };
function polyline(doc: Doc, pts: UV[], close = false) {
  const nodes = pts.map((p) => P.addPoint(doc, p));
  const path = P.startPath(doc, nodes[0], style);
  for (const n of nodes.slice(1)) P.appendNode(doc, path.id, n);
  if (close) P.appendNode(doc, path.id, nodes[0]);
  return path;
}

test('addPoint stores the cell-local point and the cell; nodeWorld maps through the lattice', () => {
  const doc = makeDoc();
  const n = P.addPoint(doc, { u: 1.25, v: 0.5 });
  expect(n.cell).toEqual({ c: 1, r: 0 });
  expect(P.getPoint(doc, n.pointId)!.u).toBeCloseTo(0.25, 9);
  expect(P.nodeWorld(doc, n)).toEqual({ x: 300, y: 120 });
});

test('append and insert keep segments consistent; a repeat of the last node is ignored', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0, v: 0 }, { u: 0.5, v: 0 }, { u: 0.5, v: 0.5 }]);
  expect(path.segments).toHaveLength(2);
  expect(P.appendNode(doc, path.id, path.segments[1].to)).toBe(false);
  P.insertNode(doc, path.id, 0, { u: 0.25, v: 0 });
  expect(path.segments).toHaveLength(3);
  expect(P.nodeWorld(doc, path.segments[0].to)).toEqual({ x: 60, y: 0 });
});

test('inserting into a curved segment splits at t = 0.5 with halved control points, kept relative to their cells', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0, v: 0 }, { u: 1, v: 0 }]);
  P.setControlPointAbs(doc, path.id, 0, { u: 0.5, v: 1 });
  const node = P.insertNode(doc, path.id, 0, null);
  expect(P.nodeUVAbs(doc, node)).toEqual({ u: 0.5, v: 0.5 });
  expect(P.cpAbs(path, 0)).toEqual({ u: 0.25, v: 0.5 });
  expect(P.cpAbs(path, 1)).toEqual({ u: 0.75, v: 0.5 });
  expect(path.segments[0].cp).toEqual({ u: 0.25, v: 0.5 });      // relative to cell (0,0)
  expect(path.segments[1].cp).toEqual({ u: 0.75, v: 0.5 });      // node is in cell (0,0) too
});

test('control points are stored relative to the previous node cell, so a wrapped segment keeps cp local', () => {
  const doc = makeDoc();
  const a = P.addPoint(doc, { u: 0.9, v: 0.5 });
  const path = P.startPath(doc, { pointId: a.pointId, cell: { c: 1, r: 0 } }, style);
  P.appendNode(doc, path.id, P.addPoint(doc, { u: 2.2, v: 0.5 }));
  P.setControlPointWorld(doc, path.id, 0, { x: 2.0 * 240, y: 0.7 * 240 });
  expect(path.segments[0].cp!.u).toBeCloseTo(1.0, 9);   // 2.0 − cell 1
  expect(path.segments[0].cp!.v).toBeCloseTo(0.7, 9);
  expect(P.cpWorld(doc, path, 0)!.x).toBeCloseTo(480, 9);
});

test('a path is closed only when the last node is the start node in the same cell', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0.1, v: 0.1 }, { u: 0.5, v: 0.1 }, { u: 0.5, v: 0.5 }]);
  expect(P.isClosed(path)).toBe(false);
  P.appendNode(doc, path.id, path.start);
  expect(P.isClosed(path)).toBe(true);
  const wrap = polyline(doc, [{ u: 0.1, v: 0.1 }, { u: 0.5, v: 0.1 }]);
  P.appendNode(doc, wrap.id, { pointId: wrap.start.pointId, cell: { c: 1, r: 0 } });
  expect(P.isClosed(wrap)).toBe(false);
  expect(P.nodeWorld(doc, wrap.segments[1].to).x).toBeCloseTo(264, 9);
});

test('deletePoints removes every occurrence, bridges straight, prunes orphans and bindings', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0.1, v: 0.1 }, { u: 0.5, v: 0.1 }, { u: 0.5, v: 0.5 }, { u: 0.1, v: 0.5 }], true);
  P.setControlPointAbs(doc, path.id, 1, { u: 0.6, v: 0.3 });
  const el = P.addElement(doc, { kind: 'rotate', u: 0.5, v: 0.5, n: 2 });
  P.addBinding(doc, path.id, [el.id]);
  P.deletePoints(doc, [path.start.pointId]);
  expect(P.pathNodes(path)).toHaveLength(3);
  expect(path.segments).toHaveLength(2);
  expect(path.segments[0].cp).toEqual({ u: 0.6, v: 0.3 });
  expect(doc.points).toHaveLength(3);
  expect(doc.bindings).toHaveLength(1);
  P.deletePoints(doc, [path.start.pointId, path.segments[0].to.pointId]);
  expect(doc.paths).toHaveLength(0);
  expect(doc.points).toHaveLength(0);
  expect(doc.bindings).toHaveLength(0);
});

test('deletePath removes bindings and orphaned points but keeps shared points', () => {
  const doc = makeDoc();
  const a = polyline(doc, [{ u: 0, v: 0 }, { u: 0.2, v: 0 }]);
  const b = P.startPath(doc, a.segments[0].to, style);
  P.appendNode(doc, b.id, P.addPoint(doc, { u: 0.2, v: 0.2 }));
  P.addBinding(doc, a.id, []);
  P.deletePath(doc, a.id);
  expect(doc.paths).toHaveLength(1);
  expect(doc.points).toHaveLength(2);
  expect(doc.bindings).toHaveLength(0);
});

test('openEndAt / reversePath / orientToEnd keep control points on the right side of the segment', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0.1, v: 0.1 }, { u: 0.5, v: 0.1 }, { u: 0.5, v: 0.5 }]);
  P.setControlPointAbs(doc, path.id, 0, { u: 0.3, v: -0.1 });
  const first = path.start.pointId;
  expect(P.openEndAt(doc, first)).toBe(path.id);
  expect(P.openEndAt(doc, path.segments[0].to.pointId)).toBe(null);
  P.orientToEnd(doc, path.id, first, { c: 1, r: 0 });
  const last = path.segments[1].to;
  expect(last.pointId).toBe(first);
  expect(last.cell).toEqual({ c: 1, r: 0 });
  expect(P.cpAbs(path, 1)!.u).toBeCloseTo(1.3, 9);   // shifted one cell with the path
  expect(P.cpAbs(path, 1)!.v).toBeCloseTo(-0.1, 9);
});

test('movePoint and movePointsBy shift adjacent control points by half per moved endpoint', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0, v: 0 }, { u: 0.4, v: 0 }, { u: 0.8, v: 0 }]);
  P.setControlPointAbs(doc, path.id, 0, { u: 0.2, v: 0.2 });
  P.setControlPointAbs(doc, path.id, 1, { u: 0.6, v: 0.2 });
  const [n0, n1] = P.pathNodes(path);
  P.movePoint(doc, n1.pointId, 0.4, 0.1);
  expect(P.cpAbs(path, 0)!.v).toBeCloseTo(0.25, 9);
  expect(P.cpAbs(path, 1)!.v).toBeCloseTo(0.25, 9);
  const ids = [n0.pointId, n1.pointId];
  P.movePointsBy(doc, ids, P.snapshotPositions(doc, ids), 0, 0.1);
  expect(P.cpAbs(path, 0)!.v).toBeCloseTo(0.35, 9);
  expect(P.cpAbs(path, 1)!.v).toBeCloseTo(0.3, 9);
});

test('transformPath applies a world matrix to points and control points and maps back to lattice coords', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0, v: 0 }, { u: 0.5, v: 0 }]);
  P.setControlPointAbs(doc, path.id, 0, { u: 0.25, v: 0.25 });
  P.transformPath(doc, path.id, rotation(Math.PI / 2, 0, 0));
  const w = P.pathWorld(doc, path);
  expect(w[1].x).toBeCloseTo(0, 6); expect(w[1].y).toBeCloseTo(120, 6);
  const cp = P.cpWorld(doc, path, 0)!;
  expect(cp.x).toBeCloseTo(-60, 6); expect(cp.y).toBeCloseTo(60, 6);
  const b = P.boundsWorld(doc, path);
  expect(b.x0).toBeCloseTo(-60, 6); expect(b.y1).toBeCloseTo(120, 6);
});

test('changing the lattice leaves every lattice coordinate untouched', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0.1, v: 0.1 }, { u: 0.6, v: 0.1 }]);
  P.setControlPointAbs(doc, path.id, 0, { u: 0.35, v: 0.3 });
  const before = JSON.stringify([doc.points, doc.paths]);
  doc.lattice = { ...CONFIG.LATTICE_PRESETS['Hex / triangle'] };
  expect(JSON.stringify([doc.points, doc.paths])).toBe(before);
  expect(P.cpWorld(doc, path, 0)!.x).toBeCloseTo(0.35 * 240 + 0.3 * -120, 6);
});

test('bindings toggle ops in order; cloneMatrices uses the orbit; deleting an element removes its bindings', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0, v: 0 }, { u: 0.5, v: 0 }]);
  const m = P.addElement(doc, { kind: 'mirror', u: 0, v: 0.5, du: 1, dv: 0 });
  const t = P.addElement(doc, { kind: 'translate', u: 0.5, v: 0 });
  const b = P.addBinding(doc, path.id, []);
  expect(P.cloneMatrices(doc, b.id).matrices).toHaveLength(0);
  P.toggleOp(doc, b.id, m.id); P.toggleOp(doc, b.id, t.id);
  expect(b.ops).toEqual([m.id, t.id]);
  expect(P.cloneMatrices(doc, b.id).matrices).toHaveLength(1);
  P.toggleOp(doc, b.id, m.id);
  expect(b.ops).toEqual([t.id]);
  P.deleteElement(doc, t.id);
  expect(doc.bindings).toHaveLength(0);
});

test('fills are added and removed by id', () => {
  const doc = makeDoc();
  const f = P.addFill(doc, { u: 0.5, v: 0.5 }, '#f00');
  expect(doc.fills).toHaveLength(1);
  P.removeFill(doc, f.id);
  expect(doc.fills).toHaveLength(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test` → `paths.test.ts` fails to import.

- [ ] **Step 3: Create `src/engine/paths.ts`**

```ts
// Draft mutations. Every function takes a Doc draft and mutates it; nothing here touches UI state.
import { makeId } from '../ids';
import { toWorld, toUV, cellOf, nodeUV } from './lattice';
import { IDENTITY, apply, orbit } from './transform';
import type { Doc, UV, XY, Cell, Node, Segment, Path, Element, Binding, Fill, Matrix, Style, PathLayer, Box } from '../types';

export const getPoint = (doc: Doc, id: string) => doc.points.find((p) => p.id === id) ?? null;
export const getPath = (doc: Doc, id: string) => doc.paths.find((p) => p.id === id) ?? null;
export const getElement = (doc: Doc, id: string) => doc.elements.find((e) => e.id === id) ?? null;
export const getBinding = (doc: Doc, id: string) => doc.bindings.find((b) => b.id === id) ?? null;
export const getFill = (doc: Doc, id: string) => doc.fills.find((f) => f.id === id) ?? null;

export function sameNode(a: Node, b: Node): boolean {
  return a.pointId === b.pointId && a.cell.c === b.cell.c && a.cell.r === b.cell.r;
}
const cloneNode = (n: Node): Node => ({ pointId: n.pointId, cell: { c: n.cell.c, r: n.cell.r } });

export function pathNodes(path: Path): Node[] { return [path.start, ...path.segments.map((s) => s.to)]; }
export function prevNode(path: Path, j: number): Node { return j === 0 ? path.start : path.segments[j - 1].to; }

export function nodeUVAbs(doc: Doc, node: Node): UV {
  const p = getPoint(doc, node.pointId);
  if (!p) throw new Error(`missing point ${node.pointId}`);
  return nodeUV(p, node.cell);
}
export function nodeWorld(doc: Doc, node: Node): XY { return toWorld(nodeUVAbs(doc, node), doc.lattice); }
export function pathWorld(doc: Doc, path: Path): XY[] { return pathNodes(path).map((n) => nodeWorld(doc, n)); }

// Absolute lattice coordinates of a control point (relative cp + previous node's cell).
export function cpAbs(path: Path, j: number): UV | null {
  const cp = path.segments[j].cp;
  if (!cp) return null;
  const prev = prevNode(path, j);
  return { u: cp.u + prev.cell.c, v: cp.v + prev.cell.r };
}
export function cpWorld(doc: Doc, path: Path, j: number): XY | null {
  const a = cpAbs(path, j);
  return a && toWorld(a, doc.lattice);
}
export function pathCpsWorld(doc: Doc, path: Path): (XY | null)[] { return path.segments.map((_, j) => cpWorld(doc, path, j)); }

const rel = (abs: UV, cell: Cell): UV => ({ u: abs.u - cell.c, v: abs.v - cell.r });

export function isClosed(path: Path): boolean {
  return path.segments.length >= 2 && sameNode(path.start, path.segments[path.segments.length - 1].to);
}

export function addPoint(doc: Doc, uv: UV): Node {
  const { cell, local } = cellOf(uv);
  const pt = { id: makeId('pt'), u: local.u, v: local.v };
  doc.points.push(pt);
  return { pointId: pt.id, cell };
}

export function startPath(doc: Doc, node: Node, style: Style, layer: PathLayer = 'structure'): Path {
  const path: Path = { id: makeId('path'), start: cloneNode(node), segments: [], style: { ...style }, layer };
  doc.paths.push(path);
  return path;
}

export function appendNode(doc: Doc, pathId: string, node: Node): boolean {
  const p = getPath(doc, pathId);
  if (!p) return false;
  const nodes = pathNodes(p);
  if (sameNode(nodes[nodes.length - 1], node)) return false;
  p.segments.push({ to: cloneNode(node), cp: null });
  return true;
}

// Split segment j. Straight: at `uv` (absolute). Curved: at t = 0.5, ignoring `uv`. Affine, so lattice coords are fine.
export function insertNode(doc: Doc, pathId: string, j: number, uv: UV | null): Node {
  const p = getPath(doc, pathId);
  if (!p) throw new Error('no path');
  const seg = p.segments[j], prev = prevNode(p, j);
  const A = nodeUVAbs(doc, prev), B = nodeUVAbs(doc, seg.to), cp = cpAbs(p, j);
  let m: UV, c0: UV | null, c1: UV | null;
  if (cp) {
    m = { u: 0.25 * A.u + 0.5 * cp.u + 0.25 * B.u, v: 0.25 * A.v + 0.5 * cp.v + 0.25 * B.v };
    c0 = { u: (A.u + cp.u) / 2, v: (A.v + cp.v) / 2 };
    c1 = { u: (cp.u + B.u) / 2, v: (cp.v + B.v) / 2 };
  } else {
    if (!uv) throw new Error('straight insert needs a position');
    m = uv; c0 = null; c1 = null;
  }
  const node = addPoint(doc, m);
  const s0: Segment = { to: node, cp: c0 && rel(c0, prev.cell) };
  const s1: Segment = { to: seg.to, cp: c1 && rel(c1, node.cell) };
  p.segments.splice(j, 1, s0, s1);
  return node;
}

export function pruneOrphans(doc: Doc): void {
  const used = new Set<string>();
  for (const p of doc.paths) for (const n of pathNodes(p)) used.add(n.pointId);
  doc.points = doc.points.filter((pt) => used.has(pt.id));
}

// Remove points from every path. The bridging segment between the survivors is straight.
export function deletePoints(doc: Doc, ids: string[]): void {
  const set = new Set(ids);
  const keep: Path[] = [];
  for (const p of doc.paths) {
    const nodes = pathNodes(p);
    const cpIn: (UV | null)[] = [null, ...p.segments.map((s) => s.cp)];   // cp of the segment entering node i (relative to node i−1's cell)
    let start: Node | null = null;
    const segs: Segment[] = [];
    let bridge = false;
    nodes.forEach((n, i) => {
      if (set.has(n.pointId)) { bridge = true; return; }
      if (!start) start = n;
      else segs.push({ to: n, cp: bridge ? null : cpIn[i] });
      bridge = false;
    });
    if (start && segs.length >= 1) { p.start = start; p.segments = segs; keep.push(p); }
  }
  const kept = new Set(keep.map((p) => p.id));
  doc.paths = keep;
  doc.bindings = doc.bindings.filter((b) => kept.has(b.pathId));
  pruneOrphans(doc);
}

export function deletePath(doc: Doc, pathId: string): void {
  doc.paths = doc.paths.filter((p) => p.id !== pathId);
  doc.bindings = doc.bindings.filter((b) => b.pathId !== pathId);
  pruneOrphans(doc);
}

export function openEndAt(doc: Doc, pointId: string): string | null {
  const p = doc.paths.find((q) => !isClosed(q) && (q.start.pointId === pointId || q.segments[q.segments.length - 1]?.to.pointId === pointId));
  return p ? p.id : null;
}

// Reverse node order. A cp relative to the old "from" cell becomes relative to the old "to" cell.
export function reversePath(p: Path): void {
  const nodes = pathNodes(p);
  const segs: Segment[] = [];
  for (let j = p.segments.length - 1; j >= 0; j--) {
    const from = nodes[j], to = p.segments[j].to, cp = p.segments[j].cp;
    segs.push({ to: cloneNode(from), cp: cp ? { u: cp.u + from.cell.c - to.cell.c, v: cp.v + from.cell.r - to.cell.r } : null });
  }
  p.start = cloneNode(nodes[nodes.length - 1]);
  p.segments = segs;
}

// Make `pointId` the last node, placed in `cell`, reversing and shifting cells as needed. Relative cps need no change on a shift.
export function orientToEnd(doc: Doc, pathId: string, pointId: string, cell: Cell): void {
  const p = getPath(doc, pathId);
  if (!p) return;
  if (p.segments[p.segments.length - 1].to.pointId !== pointId) reversePath(p);
  const last = p.segments[p.segments.length - 1].to;
  const dc = cell.c - last.cell.c, dr = cell.r - last.cell.r;
  if (!dc && !dr) return;
  const shift = (n: Node): Node => ({ pointId: n.pointId, cell: { c: n.cell.c + dc, r: n.cell.r + dr } });
  p.start = shift(p.start);
  p.segments = p.segments.map((s) => ({ to: shift(s.to), cp: s.cp }));
}

export function shiftControlPoints(doc: Doc, ids: string[], du: number, dv: number): void {
  if (!du && !dv) return;
  const set = new Set(ids);
  for (const p of doc.paths) {
    p.segments.forEach((s, j) => {
      if (!s.cp) return;
      const n = (set.has(prevNode(p, j).pointId) ? 1 : 0) + (set.has(s.to.pointId) ? 1 : 0);
      if (n) s.cp = { u: s.cp.u + (du * n) / 2, v: s.cp.v + (dv * n) / 2 };
    });
  }
}

export function movePoint(doc: Doc, pointId: string, u: number, v: number): void {
  const p = getPoint(doc, pointId);
  if (!p) return;
  const du = u - p.u, dv = v - p.v;
  if (!du && !dv) return;
  p.u = u; p.v = v;
  shiftControlPoints(doc, [pointId], du, dv);
}

export function snapshotPositions(doc: Doc, ids: string[]): Record<string, UV> {
  const out: Record<string, UV> = {};
  for (const id of ids) { const p = getPoint(doc, id); if (p) out[id] = { u: p.u, v: p.v }; }
  return out;
}

export function movePointsBy(doc: Doc, ids: string[], startPos: Record<string, UV>, du: number, dv: number): void {
  if (!ids.length) return;
  const first = getPoint(doc, ids[0]);
  if (!first) return;
  const ddu = startPos[ids[0]].u + du - first.u, ddv = startPos[ids[0]].v + dv - first.v;
  for (const id of ids) { const p = getPoint(doc, id); if (p) { p.u = startPos[id].u + du; p.v = startPos[id].v + dv; } }
  shiftControlPoints(doc, ids, ddu, ddv);
}

export function setControlPointAbs(doc: Doc, pathId: string, j: number, abs: UV | null): void {
  const p = getPath(doc, pathId);
  if (!p) return;
  p.segments[j].cp = abs ? rel(abs, prevNode(p, j).cell) : null;
}

export function setControlPointWorld(doc: Doc, pathId: string, j: number, xy: XY | null): void {
  setControlPointAbs(doc, pathId, j, xy ? toUV(xy, doc.lattice) : null);
}

// Apply a world matrix: each distinct point once (in its first cell), and every control point.
export function transformPath(doc: Doc, pathId: string, M: Matrix): void {
  const p = getPath(doc, pathId);
  if (!p) return;
  const cps = p.segments.map((_, j) => cpWorld(doc, p, j));
  const seen = new Set<string>();
  for (const n of pathNodes(p)) {
    if (seen.has(n.pointId)) continue;
    seen.add(n.pointId);
    const pt = getPoint(doc, n.pointId)!;
    const w = apply(M, toWorld(nodeUV(pt, n.cell), doc.lattice));
    const uv = toUV(w, doc.lattice);
    pt.u = uv.u - n.cell.c; pt.v = uv.v - n.cell.r;
  }
  p.segments.forEach((s, j) => { const c = cps[j]; s.cp = c ? rel(toUV(apply(M, c), doc.lattice), prevNode(p, j).cell) : null; });
}

export function boundsWorld(doc: Doc, path: Path, M: Matrix = IDENTITY): Box {
  const W = pathWorld(doc, path).concat(pathCpsWorld(doc, path).filter((c): c is XY => !!c)).map((q) => apply(M, q));
  const xs = W.map((q) => q.x), ys = W.map((q) => q.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// --- elements, bindings, fills

export function addElement(doc: Doc, spec: Omit<Element, 'id'>): Element {
  const e = { id: makeId('el'), ...spec } as Element;
  doc.elements.push(e);
  return e;
}

export function deleteElement(doc: Doc, id: string): void {
  doc.elements = doc.elements.filter((e) => e.id !== id);
  doc.bindings = doc.bindings.filter((b) => !b.ops.includes(id));
  doc.newPathOps = doc.newPathOps.map((c) => c.filter((x) => x !== id)).filter((c) => c.length);
}

export function addBinding(doc: Doc, pathId: string, ops: string[] = []): Binding {
  const b: Binding = { id: makeId('bind'), pathId, ops: ops.slice() };
  doc.bindings.push(b);
  return b;
}

export function toggleOp(doc: Doc, bindingId: string, elementId: string): void {
  const b = getBinding(doc, bindingId);
  if (!b) return;
  const i = b.ops.indexOf(elementId);
  if (i >= 0) b.ops.splice(i, 1); else b.ops.push(elementId);
}

export function removeBinding(doc: Doc, id: string): void { doc.bindings = doc.bindings.filter((b) => b.id !== id); }

export function cloneMatrices(doc: Doc, bindingId: string, cap = 12): { matrices: Matrix[]; open: boolean } {
  const b = getBinding(doc, bindingId);
  return b ? orbit(b.ops, doc.elements, doc.lattice, cap) : { matrices: [], open: false };
}

export function addFill(doc: Doc, uv: UV, color: string): Fill {
  const f: Fill = { id: makeId('fill'), u: uv.u, v: uv.v, color };
  doc.fills.push(f);
  return f;
}

export function removeFill(doc: Doc, id: string): void { doc.fills = doc.fills.filter((f) => f.id !== id); }
```

- [ ] **Step 4: Run the tests**

Run: `npm test` → all pass. If `deletePoints` leaves a wrong `cp`, check that `cpIn[i]` is the cp of the segment *entering* node `i`, which is `segments[i-1].cp`.

- [ ] **Step 5: Commit**

```bash
git add src/engine/paths.ts tests/unit/paths.test.ts
git commit -m "Add document mutations in lattice coordinates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: State — document signal, history with gestures, UI signals, derived copies

**Files:**
- Create: `src/state/doc.ts`, `src/state/ui.ts`, `src/state/history.ts`, `src/state/derived.ts`, `tests/unit/history.test.ts`

**Interfaces:**
- `doc.ts`: `doc: Signal<Doc>`, `emptyDoc() → Doc`, `draft() → Doc`.
- `ui.ts`: signals `layer`, `sublayer`, `tool`, `pen`, `selection`, `hover`, `drag`, `cursor`, `view`, `viewport`, `space`, `prefs`, `showHelp`, `lastSavedAt`, `lastPointerType`, `fillPreview`, `exportOpen`; `resetUi()`; helpers `selectedPathId()`, `selectedCopy()`, `selectedElementId()`, `selectedPointIds()`, `clearSelection()`.
- `history.ts`: `commit(next)`, `beginGesture()`, `endGesture()`, `abortGesture()`, `undo() → boolean`, `redo() → boolean`, `canUndo()`, `canRedo()`, `historyVersion: Signal<number>`, `reset()`.
- `derived.ts`: `cloneMatrices: ReadonlySignal<Map<string, Matrix[]>>`, `openElements: ReadonlySignal<Set<string>>`, `visibleCells: ReadonlySignal<Cell[]>`, `copies: ReadonlySignal<CopyInfo[]>`, `copyMatrix(copy, d?, cm?) → Matrix`. Task 5 adds `anchors`; Task 6 adds `faces`.

- [ ] **Step 1: Write `tests/unit/history.test.ts`**

```ts
import { test, expect } from 'vitest';
import { doc, draft, emptyDoc } from '../../src/state/doc';
import { commit, beginGesture, endGesture, abortGesture, undo, redo, canUndo, canRedo, reset } from '../../src/state/history';
import { selection, resetUi } from '../../src/state/ui';
import { copies, cloneMatrices, visibleCells } from '../../src/state/derived';
import { viewport } from '../../src/state/ui';
import * as P from '../../src/engine/paths';

function fresh() { reset(); resetUi(); doc.value = emptyDoc(); }

test('commit pushes, undo/redo swap references, selection clears', () => {
  fresh();
  const a = doc.value;
  const d = draft(); P.addPoint(d, { u: 0.1, v: 0.1 }); commit(d);
  selection.value = { kind: 'points', ids: [d.points[0].id] };
  expect(canUndo()).toBe(true);
  expect(undo()).toBe(true);
  expect(doc.value).toBe(a);
  expect(selection.value).toBe(null);
  expect(canRedo()).toBe(true);
  expect(redo()).toBe(true);
  expect(doc.value).toBe(d);
  undo(); expect(undo()).toBe(false);
});

test('a new commit clears redo and the stack is capped at 50', () => {
  fresh();
  commit(draft()); undo(); expect(canRedo()).toBe(true);
  commit(draft()); expect(canRedo()).toBe(false);
  fresh();
  for (let i = 0; i < 60; i++) commit(draft());
  let n = 0; while (undo()) n++;
  expect(n).toBe(50);
});

test('a gesture records one entry however many commits it makes; abort restores the base', () => {
  fresh();
  const base = doc.value;
  beginGesture();
  for (let i = 0; i < 5; i++) { const d = draft(); P.addPoint(d, { u: i / 10, v: 0 }); commit(d); }
  endGesture();
  expect(doc.value.points).toHaveLength(5);
  expect(undo()).toBe(true);
  expect(doc.value).toBe(base);
  expect(undo()).toBe(false);
  redo();
  beginGesture();
  const d = draft(); P.addPoint(d, { u: 0.9, v: 0.9 }); commit(d);
  abortGesture();
  expect(doc.value.points).toHaveLength(5);
  expect(canRedo()).toBe(false);
});

test('derived copies list the source and every clone per visible cell', () => {
  fresh();
  viewport.value = { width: 400, height: 400 };
  const d = draft();
  const n = P.addPoint(d, { u: 0.1, v: 0.1 });
  const path = P.startPath(d, n, { color: '#000', weight: 1 });
  P.appendNode(d, path.id, P.addPoint(d, { u: 0.4, v: 0.1 }));
  const el = P.addElement(d, { kind: 'rotate', u: 0.5, v: 0.5, n: 4 });
  P.addBinding(d, path.id, [el.id]);
  commit(d);
  expect(cloneMatrices.value.get(d.bindings[0].id)).toHaveLength(3);
  const perCell = copies.value.filter((c) => c.copy.cell.c === 0 && c.copy.cell.r === 0);
  expect(perCell).toHaveLength(4);
  expect(copies.value.length).toBe(visibleCells.value.length * 4);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test` → import errors.

- [ ] **Step 3: Create `src/state/doc.ts`**

```ts
import { signal } from '@preact/signals';
import { CONFIG } from '../config';
import type { Doc } from '../types';

export function emptyDoc(): Doc {
  return { version: 1, lattice: { ...CONFIG.LATTICE_PRESETS.Square }, points: [], paths: [], elements: [], bindings: [], fills: [], newPathOps: [] };
}

// The committed document. Never mutated: actions draft(), mutate the draft, and commit() it (history.ts).
export const doc = signal<Doc>(emptyDoc());

export function draft(): Doc { return structuredClone(doc.value); }
```

- [ ] **Step 4: Create `src/state/ui.ts`**

```ts
import { signal } from '@preact/signals';
import { CONFIG } from '../config';
import type { Layer, Tool, PathLayer, Selection, HitTarget, Drag, XY, View, Prefs, PointerKind, Copy } from '../types';

export const layer = signal<Layer>('drawing');
export const sublayer = signal<PathLayer>('structure');
export const tool = signal<Tool>('pen');
export const pen = signal<{ pathId: string } | null>(null);
export const selection = signal<Selection>(null);
export const hover = signal<HitTarget | null>(null);
export const drag = signal<Drag | null>(null);
export const cursor = signal<XY | null>(null);
export const view = signal<View>({ pan: { x: 0, y: 0 }, zoom: 1 });
export const viewport = signal({ width: 0, height: 0 });
export const space = signal(false);
export const prefs = signal<Prefs>({ style: { color: '#1c1b18', weight: 2 }, fillColor: '#c2255c', snap: true, gridDivisions: CONFIG.DEFAULT_GRID_DIVISIONS, ghostOpacity: CONFIG.DEFAULT_GHOST_OPACITY });
export const showHelp = signal(false);
export const exportOpen = signal(false);
export const lastSavedAt = signal<number | null>(null);
export const lastPointerType = signal<PointerKind>('mouse');
export const fillPreview = signal<XY | null>(null);   // world point while a Fill press is held

export function resetUi(): void {
  layer.value = 'drawing'; sublayer.value = 'structure'; tool.value = 'pen'; pen.value = null; selection.value = null;
  hover.value = null; drag.value = null; cursor.value = null; view.value = { pan: { x: 0, y: 0 }, zoom: 1 }; space.value = false;
  showHelp.value = false; exportOpen.value = false; fillPreview.value = null;
}

export function clearSelection(): void { selection.value = null; }
export function selectedPathId(): string | null { const s = selection.value; return s && s.kind === 'path' ? s.id : null; }
export function selectedCopy(): Copy | null { const s = selection.value; return s && s.kind === 'path' ? s.copy : null; }
export function selectedPointIds(): string[] { const s = selection.value; return s && s.kind === 'points' ? s.ids : []; }
export function selectedElementId(): string | null { const s = selection.value; return s && s.kind === 'element' ? s.id : null; }
```

- [ ] **Step 5: Create `src/state/history.ts`**

```ts
// Undo/redo over document references. A gesture records one entry however many commits it makes.
import { signal } from '@preact/signals';
import { CONFIG } from '../config';
import { doc } from './doc';
import { selection, pen, hover, drag } from './ui';
import type { Doc } from '../types';

const past: Doc[] = [];
const future: Doc[] = [];
let inGesture = false;
let gestureBase: Doc | null = null;
export const historyVersion = signal(0);

function trim() { while (past.length > CONFIG.MAX_HISTORY) past.shift(); }
function clearTransient() { selection.value = null; pen.value = null; hover.value = null; drag.value = null; }

export function commit(next: Doc): void {
  if (inGesture) {
    if (!gestureBase) { gestureBase = doc.value; past.push(gestureBase); trim(); future.length = 0; }
  } else {
    past.push(doc.value); trim(); future.length = 0;
  }
  doc.value = next;
  historyVersion.value++;
}

export function beginGesture(): void { inGesture = true; gestureBase = null; }
export function endGesture(): void { inGesture = false; gestureBase = null; }

// Revert everything the current gesture did and forget it.
export function abortGesture(): void {
  if (inGesture && gestureBase) { past.pop(); doc.value = gestureBase; }
  inGesture = false; gestureBase = null;
  historyVersion.value++;
}

export function undo(): boolean {
  if (!past.length) return false;
  future.push(doc.value);
  doc.value = past.pop()!;
  clearTransient();
  historyVersion.value++;
  return true;
}

export function redo(): boolean {
  if (!future.length) return false;
  past.push(doc.value);
  doc.value = future.pop()!;
  clearTransient();
  historyVersion.value++;
  return true;
}

export function canUndo(): boolean { historyVersion.value; return past.length > 0; }
export function canRedo(): boolean { historyVersion.value; return future.length > 0; }
export function reset(): void { past.length = 0; future.length = 0; inGesture = false; gestureBase = null; historyVersion.value++; }
```

- [ ] **Step 6: Create `src/state/derived.ts`**

```ts
import { computed } from '@preact/signals';
import { CONFIG } from '../config';
import { doc } from './doc';
import { view, viewport } from './ui';
import { visibleOffsets } from '../engine/lattice';
import { cellMatrix, compose, orbit } from '../engine/transform';
import type { Matrix, Cell, Copy, CopyInfo, Doc } from '../types';

export const cloneMatrices = computed(() => {
  const d = doc.value, m = new Map<string, Matrix[]>();
  for (const b of d.bindings) m.set(b.id, orbit(b.ops, d.elements, d.lattice, CONFIG.ORBIT_CAP).matrices);
  return m;
});

export const openElements = computed(() => {
  const d = doc.value;
  return new Set(d.elements.filter((e) => orbit([e.id], d.elements, d.lattice, CONFIG.ORBIT_CAP).open).map((e) => e.id));
});

export const visibleCells = computed<Cell[]>(() =>
  visibleOffsets(view.value, doc.value.lattice, viewport.value.width, viewport.value.height, CONFIG.VISIBLE_CELL_RADIUS));

export function copyMatrix(copy: Copy, d: Doc = doc.value, cm: Map<string, Matrix[]> = cloneMatrices.value): Matrix {
  const Mo = cellMatrix(copy.cell, d.lattice);
  if (!copy.bindingId) return Mo;
  const M = (cm.get(copy.bindingId) ?? [])[copy.power - 1];
  return M ? compose(Mo, M) : Mo;
}

// Every rendered copy in the visible cells: the source and each clone of every path.
export const copies = computed<CopyInfo[]>(() => {
  const d = doc.value, cm = cloneMatrices.value, out: CopyInfo[] = [];
  for (const cell of visibleCells.value) {
    const Mo = cellMatrix(cell, d.lattice);
    for (const p of d.paths) {
      out.push({ pathId: p.id, copy: { cell, bindingId: null, power: 0 }, M: Mo });
      for (const b of d.bindings) {
        if (b.pathId !== p.id) continue;
        (cm.get(b.id) ?? []).forEach((M, k) => out.push({ pathId: p.id, copy: { cell, bindingId: b.id, power: k + 1 }, M: compose(Mo, M) }));
      }
    }
  }
  return out;
});
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `npm test` and `npx tsc --noEmit` → pass, clean.

- [ ] **Step 8: Commit**

```bash
git add src/state tests/unit/history.test.ts
git commit -m "Add document signal, gesture-aware history and derived copies

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Geometric hit-testing, snapping, marquee and bbox maths

**Files:**
- Create: `src/engine/hit.ts`, `tests/unit/hit.test.ts`
- Modify: `src/state/derived.ts` (add `anchors`)

**Interfaces:**
- `HitContext = { layer, tool, selection, pen, zoom, hitScale, copies: CopyInfo[], cloneMatrices: Map<string, Matrix[]>, faces: Face[] }`.
- `hitTest(doc, ctx, world) → HitTarget | null`; `copyMatrixOf(copy, lat, cloneMatrices) → Matrix`; `visiblePointIds(doc, ctx) → Set<string> | null` (null = all); `anchorsWorld(doc, skip?) → Anchor[]` where `Anchor = { x, y, pointId, cell, bindingId?, power? }`; `snapWorld(doc, p, threshold, div, skip?, gridOn?) → { x, y, anchor }`; `pointsInRect(doc, box) → ids`; `projectOnSegment(A, B, p)`; `bboxHandles(box) → BoxHandle[8]`; `scaleFor(h, p, free) → { sx, sy }`; `scaleMatrix(ax, ay, sx, sy)`; `seedOf(world, lat) → XY` (base-cell world point).

- [ ] **Step 1: Write `tests/unit/hit.test.ts`**

```ts
import { test, expect } from 'vitest';
import * as P from '../../src/engine/paths';
import { hitTest, anchorsWorld, snapWorld, pointsInRect, projectOnSegment, bboxHandles, scaleFor, scaleMatrix, seedOf, type HitContext } from '../../src/engine/hit';
import { orbit, apply, cellMatrix, compose } from '../../src/engine/transform';
import { windowOffsets } from '../../src/engine/lattice';
import { CONFIG } from '../../src/config';
import type { Doc, CopyInfo, Matrix, Selection } from '../../src/types';

function makeDoc(): Doc { return { version: 1, lattice: { ...CONFIG.LATTICE_PRESETS.Square }, points: [], paths: [], elements: [], bindings: [], fills: [], newPathOps: [] }; }
function copiesOf(d: Doc): { copies: CopyInfo[]; cm: Map<string, Matrix[]> } {
  const cm = new Map<string, Matrix[]>();
  for (const b of d.bindings) cm.set(b.id, orbit(b.ops, d.elements, d.lattice).matrices);
  const copies: CopyInfo[] = [];
  for (const cell of windowOffsets()) for (const p of d.paths) {
    const Mo = cellMatrix(cell, d.lattice);
    copies.push({ pathId: p.id, copy: { cell, bindingId: null, power: 0 }, M: Mo });
    for (const b of d.bindings) if (b.pathId === p.id) (cm.get(b.id) ?? []).forEach((M, k) => copies.push({ pathId: p.id, copy: { cell, bindingId: b.id, power: k + 1 }, M: compose(Mo, M) }));
  }
  return { copies, cm };
}
function ctxFor(d: Doc, over: Partial<HitContext> = {}): HitContext {
  const { copies, cm } = copiesOf(d);
  return { layer: 'drawing', tool: 'select', selection: null, pen: null, zoom: 1, hitScale: 1, copies, cloneMatrices: cm, faces: [], ...over };
}
function scene() {
  const d = makeDoc();
  const n = P.addPoint(d, { u: 0.1, v: 0.1 });                       // (24, 24)
  const path = P.startPath(d, n, { color: '#000', weight: 2 });
  P.appendNode(d, path.id, P.addPoint(d, { u: 0.4, v: 0.1 }));        // (96, 24)
  const el = P.addElement(d, { kind: 'rotate', u: 0.5, v: 0.5, n: 2 });
  const b = P.addBinding(d, path.id, [el.id]);
  return { d, path, n, el, b };
}

test('segments of any copy are hit and report their copy', () => {
  const { d, path, b } = scene();
  const ctx = ctxFor(d);
  const base = hitTest(d, ctx, { x: 60, y: 27 });
  expect(base).toMatchObject({ kind: 'segment', pathId: path.id, j: 0, copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 } });
  const right = hitTest(d, ctx, { x: 300, y: 27 });
  expect(right).toMatchObject({ kind: 'segment', copy: { cell: { c: 1, r: 0 } } });
  const clone = hitTest(d, ctx, { x: 180, y: 216 });                 // image of the segment under the 180° turn
  expect(clone).toMatchObject({ kind: 'segment', copy: { bindingId: b.id, power: 1 } });
});

test('priority: bbox handle beats point beats segment; points are only hit when visible', () => {
  const { d, path } = scene();
  const sel: Selection = { kind: 'path', id: path.id, copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 } };
  const ctx = ctxFor(d, { selection: sel });
  expect(hitTest(d, ctx, { x: 24, y: 24 })!.kind).toBe('bbox');       // corner handle sits on the point
  expect(hitTest(d, ctx, { x: 60, y: 24 })!.kind).toBe('bbox');       // a zero-height box puts its edge handle on the midpoint too
  P.setControlPointWorld(d, path.id, 0, { x: 50, y: 70 });            // now the box has height and the diamond sits away from every handle
  expect(hitTest(d, ctxFor(d, { selection: sel }), { x: 50, y: 70 })!.kind).toBe('diamond');
  expect(hitTest(d, ctxFor(d, { tool: 'pen', selection: sel }), { x: 50, y: 70 })).toBe(null);   // Pen never hits diamonds
  expect(hitTest(d, ctxFor(d, { tool: 'freehand' }), { x: 216, y: 216 })).toBe(null);           // Freehand never hits clone anchors
  const noSel = ctxFor(d);
  expect(hitTest(d, noSel, { x: 24, y: 24 })!.kind).toBe('segment');  // point not visible with nothing selected
  const penCtx = ctxFor(d, { tool: 'pen' });
  expect(hitTest(d, penCtx, { x: 24, y: 24 })).toMatchObject({ kind: 'point', cell: { c: 0, r: 0 } });
  expect(hitTest(d, penCtx, { x: 264, y: 24 })).toMatchObject({ kind: 'point', cell: { c: 1, r: 0 } });
});

test('thresholds scale with zoom and double for touch', () => {
  const { d } = scene();
  const pen = ctxFor(d, { tool: 'pen' });
  expect(hitTest(d, pen, { x: 24, y: 36 })).toBe(null);                              // 12 px away: too far for mouse
  expect(hitTest(d, { ...pen, hitScale: 2 }, { x: 24, y: 36 })!.kind).toBe('point'); // touch reaches it
  expect(hitTest(d, { ...pen, zoom: 4 }, { x: 24, y: 27 })).toBe(null);              // 3 world px = 12 screen px at zoom 4
});

test('construction layer hits elements and lattice handles, selected mirror exposes its knob', () => {
  const d = makeDoc();
  const m = P.addElement(d, { kind: 'mirror', u: 0.5, v: 0, du: 0, dv: 1 });        // line x = 120
  const ctx = ctxFor(d, { layer: 'construction' });
  expect(hitTest(d, ctx, { x: 121, y: 200 })).toMatchObject({ kind: 'element', elementId: m.id });
  expect(hitTest(d, ctx, { x: 240, y: 0 })).toMatchObject({ kind: 'lat', which: 'a' });
  const sel = ctxFor(d, { layer: 'construction', selection: { kind: 'element', id: m.id } });
  expect(hitTest(d, sel, { x: 120, y: 70 })).toMatchObject({ kind: 'elrot' });
  expect(hitTest(d, ctxFor(d), { x: 121, y: 200 })).toBe(null);                     // drawing layer ignores elements
});

test('anchors and snapping: neighbour copies, clone points, skip, grid fallback', () => {
  const { d, n } = scene();
  const all = anchorsWorld(d);
  expect(all.filter((a) => !a.bindingId)).toHaveLength(18);
  expect(all.filter((a) => a.bindingId)).toHaveLength(18);
  const s = snapWorld(d, { x: 267, y: 26 }, 12, 8);
  expect(s.x).toBeCloseTo(264, 9); expect(s.anchor).toMatchObject({ pointId: n.pointId, cell: { c: 1, r: 0 } });
  const skipped = snapWorld(d, { x: 267, y: 26 }, 12, 8, (a) => !a.bindingId && a.pointId === n.pointId);
  expect(skipped.x).toBeCloseTo(270, 9); expect(skipped.anchor).toBe(null);          // grid: 240 + 30
  const raw = snapWorld(d, { x: 267, y: 26 }, 12, 8, () => true, false);
  expect(raw.x).toBe(267);
  const own = snapWorld(d, { x: 214, y: 218 }, 12, 8, (a) => !a.bindingId && a.pointId === n.pointId);
  expect(own.anchor).toMatchObject({ bindingId: d.bindings[0].id });                 // may snap to its own clone image
});

test('marquee, projection, bbox maths, seedOf', () => {
  const { d, n } = scene();
  expect(pointsInRect(d, { x0: 260, y0: 20, x1: 270, y1: 30 })).toEqual([n.pointId]);
  expect(projectOnSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: -50, y: 9 }).x).toBeCloseTo(5, 9);
  const hs = bboxHandles({ x0: 0, y0: 0, x1: 100, y1: 50 });
  expect(hs).toHaveLength(8);
  const u = scaleFor(hs[2], { x: 200, y: 100 }, false); expect(u.sx).toBeCloseTo(2, 9); expect(u.sy).toBeCloseTo(2, 9);
  const f = scaleFor(hs[2], { x: 200, y: 25 }, true); expect(f.sy).toBeCloseTo(0.5, 9);
  expect(apply(scaleMatrix(0, 0, 2, 2), { x: 10, y: 5 })).toEqual({ x: 20, y: 10 });
  expect(seedOf({ x: 300, y: 120 }, d.lattice)).toEqual({ x: 60, y: 120 });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test` → import error.

- [ ] **Step 3: Create `src/engine/hit.ts`**

```ts
// Geometric hit-testing and snapping. Pure: takes a doc and a context, returns targets.
import { CONFIG } from '../config';
import { toWorld, toUV, cellOf, nodeUV, windowOffsets, snapGrid } from './lattice';
import { apply, cellMatrix, compose, orbit } from './transform';
import { getPath, pathNodes, pathWorld, pathCpsWorld, boundsWorld, getElement } from './paths';
import { faceAt } from './regions';
import type { Doc, XY, Lattice, Matrix, Copy, CopyInfo, Cell, Face, HitTarget, Layer, Tool, Selection, Box, BoxHandle, Path } from '../types';

export type HitContext = {
  layer: Layer; tool: Tool; selection: Selection; pen: { pathId: string } | null;
  zoom: number; hitScale: number; copies: CopyInfo[]; cloneMatrices: Map<string, Matrix[]>; faces: Face[];
};
export type Anchor = { x: number; y: number; pointId: string; cell: Cell; bindingId?: string; power?: number };

export function copyMatrixOf(copy: Copy, lat: Lattice, cm: Map<string, Matrix[]>): Matrix {
  const Mo = cellMatrix(copy.cell, lat);
  if (!copy.bindingId) return Mo;
  const M = (cm.get(copy.bindingId) ?? [])[copy.power - 1];
  return M ? compose(Mo, M) : Mo;
}

const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: XY, b: XY): XY => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function segmentDistance(a: XY, b: XY, cp: XY | null, p: XY): number {
  if (!cp) {
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
    return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
  }
  let best = Infinity, prev = a;
  for (let i = 1; i <= 16; i++) {
    const t = i / 16, u = 1 - t;
    const q = { x: u * u * a.x + 2 * u * t * cp.x + t * t * b.x, y: u * u * a.y + 2 * u * t * cp.y + t * t * b.y };
    best = Math.min(best, segmentDistance(prev, q, null, p));
    prev = q;
  }
  return best;
}

// Which points are drawn (and therefore hittable): all while drawing; else the selected path's, the selected points.
export function visiblePointIds(doc: Doc, ctx: HitContext): Set<string> | null {
  if (ctx.pen || ctx.tool === 'freehand') return null;
  const s = ctx.selection, set = new Set<string>();
  if (s && s.kind === 'points') for (const id of s.ids) set.add(id);
  if (s && s.kind === 'path') { const p = getPath(doc, s.id); if (p) for (const n of pathNodes(p)) set.add(n.pointId); }
  return set;
}

// World point mapped into the base cell (for fills and faces).
export function seedOf(world: XY, lat: Lattice): XY {
  return toWorld(cellOf(toUV(world, lat)).local, lat);
}

export function hitTest(doc: Doc, ctx: HitContext, w: XY): HitTarget | null {
  const z = ctx.zoom, s = ctx.hitScale, lat = doc.lattice;
  const rPoint = ((CONFIG.HANDLE_PX + 2) * s) / z, rSeg = ((CONFIG.HIT_WIDTH / 2) * s) / z;

  if (ctx.layer === 'construction') {
    const selId = ctx.selection && ctx.selection.kind === 'element' ? ctx.selection.id : null;
    const sel = selId ? getElement(doc, selId) : null;
    if (sel && sel.kind === 'mirror') {
      const c = toWorld(sel, lat), d = toWorld({ u: sel.du, v: sel.dv }, lat), L = Math.hypot(d.x, d.y) || 1;
      const R = CONFIG.ELEMENT_ROT_OFFSET / z, knob = { x: c.x + (R * d.x) / L, y: c.y + (R * d.y) / L };
      if (dist(w, knob) <= rPoint) return { kind: 'elrot', elementId: sel.id };
    }
    if (sel && sel.kind === 'translate' && dist(w, toWorld(sel, lat)) <= rPoint) return { kind: 'eltip', elementId: sel.id };
    for (const e of [...doc.elements].reverse()) {
      if (e.kind === 'rotate') { if (dist(w, toWorld(e, lat)) <= rPoint + 3 / z) return { kind: 'element', elementId: e.id }; }
      else if (e.kind === 'mirror') {
        const c = toWorld(e, lat), d = toWorld({ u: e.du, v: e.dv }, lat), L = Math.hypot(d.x, d.y) || 1;
        if (dist(w, c) <= rPoint) return { kind: 'element', elementId: e.id };
        const perp = Math.abs((w.x - c.x) * d.y - (w.y - c.y) * d.x) / L;
        if (perp <= rSeg) return { kind: 'element', elementId: e.id };
      } else {
        const tip = toWorld(e, lat);
        if (dist(w, tip) <= rPoint) return { kind: 'eltip', elementId: e.id };
        if (segmentDistance({ x: 0, y: 0 }, tip, null, w) <= rSeg) return { kind: 'eltip', elementId: e.id };
      }
    }
    if (dist(w, { x: lat.ax, y: lat.ay }) <= rPoint) return { kind: 'lat', which: 'a' };
    if (dist(w, { x: lat.bx, y: lat.by }) <= rPoint) return { kind: 'lat', which: 'b' };
    return null;
  }

  const sel = ctx.selection;
  const selPath = sel && sel.kind === 'path' ? getPath(doc, sel.id) : null;
  const selM = sel && sel.kind === 'path' ? copyMatrixOf(sel.copy, lat, ctx.cloneMatrices) : null;

  if (ctx.tool === 'select' && selPath && selM && sel && sel.kind === 'path') {
    const box = boundsWorld(doc, selPath, selM);
    const hs = bboxHandles(box);
    for (let i = 0; i < hs.length; i++) if (dist(w, hs[i]) <= rPoint) return { kind: 'bbox', h: i };
    const knob = { x: (box.x0 + box.x1) / 2, y: box.y0 - CONFIG.BBOX_ROT_OFFSET / z };
    if (dist(w, knob) <= rPoint) return { kind: 'bboxrot' };
  }
  if (ctx.tool === 'select' && selPath && selM && sel && sel.kind === 'path') {
    const Pw = pathWorld(doc, selPath).map((p) => apply(selM, p)), C = pathCpsWorld(doc, selPath).map((c) => c && apply(selM, c));
    for (let j = 0; j < selPath.segments.length; j++) {
      const h = C[j] ?? mid(Pw[j], Pw[j + 1]);
      if (dist(w, h) <= rPoint) return { kind: 'diamond', pathId: selPath.id, j, copy: sel.copy };
    }
  }
  if (ctx.tool !== 'fill') {
    const vis = visiblePointIds(doc, ctx);
    let best: HitTarget | null = null, bd = rPoint;
    for (const cell of windowOffsets()) for (const pt of doc.points) {
      if (vis && !vis.has(pt.id)) continue;
      const d = dist(w, toWorld(nodeUV(pt, cell), lat));
      if (d < bd) { bd = d; best = { kind: 'point', pointId: pt.id, cell }; }
    }
    if (best) return best;
  }
  if (ctx.tool === 'select' || ctx.tool === 'pen') {
    const anchorsOf = (p: Path, copy: Copy, M: Matrix): HitTarget | null => {
      const Pw = pathWorld(doc, p).map((q) => apply(M, q)), nodes = pathNodes(p);
      for (let i = 0; i < nodes.length; i++) if (dist(w, Pw[i]) <= rPoint) return { kind: 'canchor', pathId: p.id, pointId: nodes[i].pointId, cell: nodes[i].cell, copy };
      return null;
    };
    if (ctx.tool === 'pen') {
      for (const ci of ctx.copies) { if (!ci.copy.bindingId) continue; const p = getPath(doc, ci.pathId); const t = p && anchorsOf(p, ci.copy, ci.M); if (t) return t; }
    } else if (selPath && selM && sel && sel.kind === 'path' && sel.copy.bindingId) {
      const t = anchorsOf(selPath, sel.copy, selM);
      if (t) return t;
    }
  }
  if (ctx.tool === 'select') {
    let best: HitTarget | null = null, bd = rSeg;
    for (const ci of ctx.copies) {
      const p = getPath(doc, ci.pathId);
      if (!p) continue;
      const Pw = pathWorld(doc, p).map((q) => apply(ci.M, q)), C = pathCpsWorld(doc, p).map((c) => c && apply(ci.M, c));
      for (let j = 0; j < p.segments.length; j++) {
        const d = segmentDistance(Pw[j], Pw[j + 1], C[j], w);
        if (d < bd) { bd = d; best = { kind: 'segment', pathId: p.id, j, copy: ci.copy }; }
      }
    }
    if (best) return best;
  }
  if (ctx.tool === 'select' || ctx.tool === 'fill') {
    const face = faceAt(ctx.faces, seedOf(w, lat));
    if (face) {
      const fill = doc.fills.find((f) => faceAt(ctx.faces, toWorld(f, lat)) === face);
      if (fill) return { kind: 'fill', fillId: fill.id };
      if (ctx.tool === 'fill') return { kind: 'face', face };
    }
  }
  return null;
}

// Every point copy in the 3×3 window, and every clone point (with its binding and power).
export function anchorsWorld(doc: Doc, skip?: (a: Anchor) => boolean, cap = CONFIG.ORBIT_CAP): Anchor[] {
  const out: Anchor[] = [], lat = doc.lattice;
  const clones = doc.bindings.map((b) => ({ b, path: getPath(doc, b.pathId), ms: orbit(b.ops, doc.elements, lat, cap).matrices })).filter((c) => c.path);
  for (const cell of windowOffsets()) {
    const Mo = cellMatrix(cell, lat);
    for (const pt of doc.points) {
      const w = toWorld(nodeUV(pt, cell), lat), a: Anchor = { x: w.x, y: w.y, pointId: pt.id, cell };
      if (!skip || !skip(a)) out.push(a);
    }
    for (const { b, path, ms } of clones) {
      const Pw = pathWorld(doc, path!), nodes = pathNodes(path!);
      ms.forEach((M, k) => {
        const MM = compose(Mo, M);
        nodes.forEach((n, i) => { const w = apply(MM, Pw[i]), a: Anchor = { x: w.x, y: w.y, pointId: n.pointId, cell: n.cell, bindingId: b.id, power: k + 1 }; if (!skip || !skip(a)) out.push(a); });
      });
    }
  }
  return out;
}

export function snapWorld(doc: Doc, p: XY, threshold: number, div: number, skip?: (a: Anchor) => boolean, gridOn = true): { x: number; y: number; anchor: Anchor | null } {
  let best: Anchor | null = null, bd = threshold;
  for (const a of anchorsWorld(doc, skip)) { const d = dist(a, p); if (d < bd) { bd = d; best = a; } }
  if (best) return { x: best.x, y: best.y, anchor: best };
  if (!gridOn) return { x: p.x, y: p.y, anchor: null };
  const g = toWorld(snapGrid(toUV(p, doc.lattice), div), doc.lattice);
  return { x: g.x, y: g.y, anchor: null };
}

export function pointsInRect(doc: Doc, r: Box): string[] {
  const ids: string[] = [];
  for (const pt of doc.points) {
    if (windowOffsets().some((cell) => { const w = toWorld(nodeUV(pt, cell), doc.lattice); return w.x >= r.x0 && w.x <= r.x1 && w.y >= r.y0 && w.y <= r.y1; })) ids.push(pt.id);
  }
  return ids;
}

export function projectOnSegment(A: XY, B: XY, p: XY, tMin = 0.05, tMax = 0.95): XY {
  const dx = B.x - A.x, dy = B.y - A.y, L = dx * dx + dy * dy || 1;
  const t = Math.max(tMin, Math.min(tMax, ((p.x - A.x) * dx + (p.y - A.y) * dy) / L));
  return { x: A.x + t * dx, y: A.y + t * dy };
}

export function bboxHandles(box: Box): BoxHandle[] {
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

export function scaleMatrix(ax: number, ay: number, sx: number, sy: number): Matrix { return [sx, 0, 0, sy, ax - sx * ax, ay - sy * ay]; }

export function scaleFor(h: BoxHandle, p: XY, free: boolean): { sx: number; sy: number } {
  const vx = h.x - h.ax, vy = h.y - h.ay;
  const clamp = (v: number) => (Math.abs(v) < 0.05 ? (v < 0 ? -0.05 : 0.05) : v);
  let sx = 1, sy = 1;
  if (vx && vy) {
    if (free) { sx = (p.x - h.ax) / vx; sy = (p.y - h.ay) / vy; }
    else { const u = ((p.x - h.ax) * vx + (p.y - h.ay) * vy) / (vx * vx + vy * vy); sx = sy = u; }
  } else if (vx) sx = (p.x - h.ax) / vx;
  else sy = (p.y - h.ay) / vy;
  return { sx: clamp(sx), sy: clamp(sy) };
}
```

`hit.ts` imports `faceAt` from `regions.ts`, which Task 6 creates. For this task create a minimal `src/engine/regions.ts` with only the signature so the test suite compiles, and let Task 6 replace it:

```ts
import type { Face, XY } from '../types';
export function faceAt(_faces: Face[], _p: XY): Face | null { return null; }
```

- [ ] **Step 4: Add `anchors` to `src/state/derived.ts`**

```ts
import { anchorsWorld } from '../engine/hit';
export const anchors = computed(() => anchorsWorld(doc.value));
```

- [ ] **Step 5: Run the tests**

Run: `npm test` → all pass. In the priority test, the bbox of a horizontal two-point path is a zero-height box whose corner handles sit on the points, so the handle wins at (24, 24). The clone hit at (180, 216): the segment (24,24)–(96,24) under a 180° turn about (120,120) becomes (216,216)–(144,216).

- [ ] **Step 6: Commit**

```bash
git add src/engine/hit.ts src/engine/regions.ts src/state/derived.ts tests/unit/hit.test.ts
git commit -m "Add geometric hit-testing over copies, snapping and bbox maths

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 6: Regions — arrangement, faces with holes, seeds

**Files:**
- Modify: `src/engine/regions.ts` (replace the stub), `src/state/derived.ts` (add gated `faces`)
- Create: `tests/unit/regions.test.ts`

**Interfaces:**
- `computeFaces(doc) → Face[]` (memoised per document reference; sorted by area descending; each face `{ outer, holes, area, centroid }`), `faceAt(faces, p) → Face | null`, `seedFor(face, click) → XY`, `facePathData(face) → string`, `collectSegments(doc) → WorldSeg[]`, `subCurve(seg, t0, t1)`, `pointInPoly(poly, p)`, `faceContains(face, p)`.
- `derived.ts`: `faces: Signal<Face[]>` updated on the next animation frame after a commit, never while `drag` is set.

- [ ] **Step 1: Write `tests/unit/regions.test.ts`**

```ts
import { test, expect } from 'vitest';
import * as P from '../../src/engine/paths';
import { computeFaces, faceAt, seedFor, facePathData, collectSegments, subCurve, faceContains } from '../../src/engine/regions';
import { CONFIG } from '../../src/config';
import type { Doc, UV } from '../../src/types';

const style = { color: '#000', weight: 2 };
function makeDoc(): Doc { return { version: 1, lattice: { ...CONFIG.LATTICE_PRESETS.Square }, points: [], paths: [], elements: [], bindings: [], fills: [], newPathOps: [] }; }
function polyline(doc: Doc, pts: UV[], close = false) {
  const nodes = pts.map((p) => P.addPoint(doc, p));
  const path = P.startPath(doc, nodes[0], style);
  for (const n of nodes.slice(1)) P.appendNode(doc, path.id, n);
  if (close) P.appendNode(doc, path.id, nodes[0]);
  return path;
}
const S = (x: number) => x / 240;
const square = (doc: Doc, x0 = 60, y0 = 60, x1 = 180, y1 = 180) =>
  polyline(doc, [{ u: S(x0), v: S(y0) }, { u: S(x1), v: S(y0) }, { u: S(x1), v: S(y1) }, { u: S(x0), v: S(y1) }], true);

test('a closed square gives one face per cell copy; outside points find nothing', () => {
  const doc = makeDoc(); square(doc);
  const faces = computeFaces(doc);
  expect(faces).toHaveLength(9);
  const f = faceAt(faces, { x: 120, y: 120 })!;
  expect(f.area).toBeCloseTo(14400, 6);
  expect(f.centroid.x).toBeCloseTo(120, 6);
  expect(faceAt(faces, { x: 30, y: 30 })).toBe(null);
  expect(faceAt(faces, { x: 5000, y: 5000 })).toBe(null);
});

test('two crossing lines inside a square make four faces', () => {
  const doc = makeDoc(); square(doc);
  polyline(doc, [{ u: S(60), v: S(120) }, { u: S(180), v: S(120) }]);
  polyline(doc, [{ u: S(120), v: S(60) }, { u: S(120), v: S(180) }]);
  const faces = computeFaces(doc);
  expect(faces).toHaveLength(36);
  expect(faceAt(faces, { x: 90, y: 90 })!.area).toBeCloseTo(3600, 6);
});

test('a dangling stroke inside a face does not split it', () => {
  const doc = makeDoc(); square(doc);
  polyline(doc, [{ u: S(120), v: S(120) }, { u: S(150), v: S(150) }]);
  const faces = computeFaces(doc);
  expect(faces).toHaveLength(9);
  expect(faceAt(faces, { x: 70, y: 70 })!.area).toBeCloseTo(14400, 6);
});

test('clone edges from a 180° rotation close regions with the source edges', () => {
  const doc = makeDoc();
  const top = polyline(doc, [{ u: 0, v: 0 }, { u: 1, v: 0 }]);
  const left = polyline(doc, [{ u: 0, v: 0 }, { u: 0, v: 1 }]);
  polyline(doc, [{ u: 0, v: 0 }, { u: 1, v: 1 }]);
  const r2 = P.addElement(doc, { kind: 'rotate', u: 0.5, v: 0.5, n: 2 });
  P.addBinding(doc, top.id, [r2.id]); P.addBinding(doc, left.id, [r2.id]);
  const faces = computeFaces(doc);
  expect(faces).toHaveLength(18);
  expect(faceAt(faces, { x: 60, y: 180 })!.area).toBeCloseTo(28800, 6);
  expect(faceAt(faces, { x: 180, y: 60 })!.area).toBeCloseTo(28800, 6);
});

test('a face straddling the cell edge is found once per copy', () => {
  const doc = makeDoc();
  square(doc, 180, 60, 300, 180);
  const faces = computeFaces(doc);
  expect(faces.filter((f) => f.outer.poly.some((p) => Math.abs(p.x - 240) < 1e-6))).toHaveLength(0);
  expect(faceAt(faces, { x: 240, y: 120 })!.area).toBeCloseTo(14400, 6);
  expect(faceAt(faces, { x: 0, y: 120 })!.area).toBeCloseTo(14400, 6);
});

test('coincident edges from a mirror on the path are deduplicated', () => {
  const doc = makeDoc();
  const sq = square(doc);
  const m = P.addElement(doc, { kind: 'mirror', u: 0.5, v: 0, du: 0, dv: 1 });
  P.addBinding(doc, sq.id, [m.id]);
  const faces = computeFaces(doc);
  expect(faces).toHaveLength(9);
  expect(faceAt(faces, { x: 120, y: 120 })!.area).toBeCloseTo(14400, 6);
});

test('a closed loop inside a face becomes its hole', () => {
  const doc = makeDoc();
  square(doc); square(doc, 100, 100, 140, 140);
  const faces = computeFaces(doc);
  expect(faces).toHaveLength(18);
  const outer = faceAt(faces, { x: 70, y: 70 })!;
  expect(outer.holes).toHaveLength(1);
  expect(outer.area).toBeCloseTo(14400, 6);
  const inner = faceAt(faces, { x: 120, y: 120 })!;
  expect(inner.area).toBeCloseTo(1600, 6);
  expect(inner.holes).toHaveLength(0);
  expect(facePathData(outer).split('M')).toHaveLength(3);        // two subpaths
  expect(faceContains(outer, { x: 120, y: 120 })).toBe(false);   // in the hole
});

test('seedFor uses the centroid when it lies inside, else the click', () => {
  const doc = makeDoc();
  square(doc);
  const sq = faceAt(computeFaces(doc), { x: 70, y: 70 })!;
  expect(seedFor(sq, { x: 70, y: 70 })).toEqual(sq.centroid);
  const doc2 = makeDoc();   // a U shape: top bar plus two legs, notch open at the bottom; its centroid falls in the notch
  polyline(doc2, [{ u: S(0), v: S(0) }, { u: S(100), v: S(0) }, { u: S(100), v: S(100) }, { u: S(70), v: S(100) }, { u: S(70), v: S(30) }, { u: S(30), v: S(30) }, { u: S(30), v: S(100) }, { u: S(0), v: S(100) }], true);
  const u = faceAt(computeFaces(doc2), { x: 15, y: 60 })!;       // inside the left leg
  expect(faceContains(u, u.centroid)).toBe(false);
  expect(seedFor(u, { x: 15, y: 60 })).toEqual({ x: 15, y: 60 });
});

test('a curved face is rebuilt from exact sub-curves', () => {
  const seg = { a: { x: 0, y: 0 }, cp: { x: 50, y: 100 }, b: { x: 100, y: 0 }, source: { pathId: 'p', copy: { cell: { c: 0, r: 0 }, bindingId: null, power: 0 }, j: 0 } };
  const left = subCurve(seg, 0, 0.5), right = subCurve(seg, 0.5, 1);
  expect(left.b).toEqual({ x: 50, y: 50 }); expect(left.cp).toEqual({ x: 25, y: 50 }); expect(right.cp).toEqual({ x: 75, y: 50 });
  const doc = makeDoc();
  const path = polyline(doc, [{ u: S(60), v: S(60) }, { u: S(180), v: S(60) }], true);
  P.setControlPointAbs(doc, path.id, 0, { u: S(120), v: 0 });
  P.setControlPointAbs(doc, path.id, 1, { u: S(120), v: S(120) });
  const faces = computeFaces(doc);
  const f = faceAt(faces, { x: 120, y: 60 })!;
  expect(f).toBeTruthy();
  const d = facePathData(f);
  expect(d).toMatch(/^M/); expect(d).toMatch(/Q/); expect(d).toMatch(/Z$/);
});

test('computeFaces is memoised per document reference', () => {
  const doc = makeDoc(); square(doc);
  const a = computeFaces(doc);
  expect(computeFaces(doc)).toBe(a);
  expect(computeFaces({ ...doc })).not.toBe(a);
});

test('collectSegments skips zero-length segments', () => {
  const doc = makeDoc();
  const path = polyline(doc, [{ u: 0, v: 0 }, { u: 0.1, v: 0 }]);
  doc.points.push({ id: 'dup', u: 0.1, v: 0 });
  path.segments.push({ to: { pointId: 'dup', cell: { c: 0, r: 0 } }, cp: null });
  expect(collectSegments(doc)).toHaveLength(9);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test` → the regions tests fail (stub returns null / missing exports).

- [ ] **Step 3: Replace `src/engine/regions.ts`**

```ts
// Regions: every copy in the 3×3 window is split at crossings, walked into a planar graph, and its loops
// become faces (positive area) and holes (negative loops nested in a face of another component).
import { CONFIG } from '../config';
import { windowOffsets } from './lattice';
import { apply, cellMatrix, compose, orbit } from './transform';
import { pathWorld, pathCpsWorld } from './paths';
import type { Doc, XY, WorldSeg, Piece, Loop, Face } from '../types';

const MERGE = 1e-4, T_EPS = 1e-7, AREA_EPS = 1e-6;

function bez(s: WorldSeg, t: number): XY {
  if (!s.cp) return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
  const u = 1 - t;
  return { x: u * u * s.a.x + 2 * u * t * s.cp.x + t * t * s.b.x, y: u * u * s.a.y + 2 * u * t * s.cp.y + t * t * s.b.y };
}
function sampleCount(s: WorldSeg): number {
  if (!s.cp) return 1;
  const len = Math.hypot(s.cp.x - s.a.x, s.cp.y - s.a.y) + Math.hypot(s.b.x - s.cp.x, s.b.y - s.cp.y);
  return Math.max(8, Math.min(32, Math.round(len / 8)));
}

export function subCurve(s: WorldSeg, t0: number, t1: number): { a: XY; cp: XY; b: XY } {
  const cp = s.cp!;
  const lerp = (u: XY, v: XY, t: number): XY => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t });
  return { a: bez(s, t0), cp: lerp(lerp(s.a, cp, t0), lerp(cp, s.b, t0), t1), b: bez(s, t1) };
}

export function collectSegments(doc: Doc, cap = CONFIG.ORBIT_CAP): WorldSeg[] {
  const segs: WorldSeg[] = [];
  const clones = doc.bindings.map((b) => ({ b, ms: orbit(b.ops, doc.elements, doc.lattice, cap).matrices }));
  for (const cell of windowOffsets()) {
    const Mo = cellMatrix(cell, doc.lattice);
    for (const path of doc.paths) {
      const Pw = pathWorld(doc, path), C = pathCpsWorld(doc, path);
      const push = (M: typeof Mo, bindingId: string | null, power: number) => {
        const P2 = Pw.map((p) => apply(M, p)), C2 = C.map((c) => c && apply(M, c));
        for (let j = 0; j < P2.length - 1; j++) {
          if (Math.hypot(P2[j + 1].x - P2[j].x, P2[j + 1].y - P2[j].y) < MERGE) continue;
          segs.push({ a: P2[j], b: P2[j + 1], cp: C2[j], source: { pathId: path.id, copy: { cell, bindingId, power }, j } });
        }
      };
      push(Mo, null, 0);
      for (const { b, ms } of clones) if (b.pathId === path.id) ms.forEach((M, k) => push(compose(Mo, M), b.id, k + 1));
    }
  }
  return segs;
}

type PieceLine = { si: number; t0: number; t1: number; p: XY; q: XY };
function pieces(segs: WorldSeg[]): PieceLine[] {
  const out: PieceLine[] = [];
  segs.forEach((s, si) => {
    const n = sampleCount(s);
    let prev = bez(s, 0);
    for (let i = 1; i <= n; i++) { const t = i / n, p = bez(s, t); out.push({ si, t0: (i - 1) / n, t1: t, p: prev, q: p }); prev = p; }
  });
  return out;
}

function intersect(p1: XY, p2: XY, p3: XY, p4: XY): { t: number; u: number } | null {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y, d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den, u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den, e = 1e-9;
  if (t < -e || t > 1 + e || u < -e || u > 1 + e) return null;
  return { t: Math.min(1, Math.max(0, t)), u: Math.min(1, Math.max(0, u)) };
}

function splitParams(segs: WorldSeg[]): number[][] {
  const ps = pieces(segs), params = segs.map(() => [0, 1]);
  if (!ps.length) return params;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pc of ps) { minX = Math.min(minX, pc.p.x, pc.q.x); maxX = Math.max(maxX, pc.p.x, pc.q.x); minY = Math.min(minY, pc.p.y, pc.q.y); maxY = Math.max(maxY, pc.p.y, pc.q.y); }
  const cell = Math.max((maxX - minX) / 64, (maxY - minY) / 64, 1);
  const buckets = new Map<number, number[]>();
  ps.forEach((pc, i) => {
    const x0 = Math.floor((Math.min(pc.p.x, pc.q.x) - minX) / cell), x1 = Math.floor((Math.max(pc.p.x, pc.q.x) - minX) / cell);
    const y0 = Math.floor((Math.min(pc.p.y, pc.q.y) - minY) / cell), y1 = Math.floor((Math.max(pc.p.y, pc.q.y) - minY) / cell);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = x * 4096 + y; const list = buckets.get(k); if (list) list.push(i); else buckets.set(k, [i]); }
  });
  const seen = new Set<number>();
  for (const list of buckets.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
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
  return params.map((list) => { const s = list.sort((a, b) => a - b), out = [s[0]]; for (const t of s) if (t - out[out.length - 1] > T_EPS) out.push(t); return out; });
}

type Vert = { x: number; y: number; out: number[]; comp: number };
type Edge = { va: number; vb: number; poly: XY[]; seg: WorldSeg; t0: number; t1: number };
type Half = { from: number; to: number; edge: number; rev: boolean; angle: number; twin: number; next: number };

function buildGraph(segs: WorldSeg[], params: number[][]) {
  const verts: Vert[] = [], grid = new Map<string, number[]>();
  const vertexAt = (p: XY): number => {
    const gx = Math.round(p.x / MERGE), gy = Math.round(p.y / MERGE);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const list = grid.get(`${gx + dx},${gy + dy}`);
      if (list) for (const id of list) if (Math.hypot(verts[id].x - p.x, verts[id].y - p.y) <= MERGE) return id;
    }
    const id = verts.length;
    verts.push({ x: p.x, y: p.y, out: [], comp: -1 });
    const key = `${gx},${gy}`;
    const list = grid.get(key); if (list) list.push(id); else grid.set(key, [id]);
    return id;
  };
  const edges: Edge[] = [], edgeKeys = new Set<string>();
  segs.forEach((s, si) => {
    const ts = params[si];
    for (let k = 0; k < ts.length - 1; k++) {
      const t0 = ts[k], t1 = ts[k + 1];
      const n = s.cp ? Math.max(2, Math.ceil(sampleCount(s) * (t1 - t0))) : 1;
      const poly: XY[] = [];
      for (let i = 0; i <= n; i++) poly.push(bez(s, t0 + ((t1 - t0) * i) / n));
      const va = vertexAt(poly[0]), vb = vertexAt(poly[n]);
      if (va === vb) continue;
      const m = bez(s, (t0 + t1) / 2);
      const key = `${Math.min(va, vb)}:${Math.max(va, vb)}:${Math.round(m.x / MERGE)},${Math.round(m.y / MERGE)}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ va, vb, poly, seg: s, t0, t1 });
    }
  });
  const half: Half[] = [];
  edges.forEach((e, ei) => {
    const n = e.poly.length;
    const fwd: Half = { from: e.va, to: e.vb, edge: ei, rev: false, angle: Math.atan2(e.poly[1].y - e.poly[0].y, e.poly[1].x - e.poly[0].x), twin: half.length + 1, next: -1 };
    const bwd: Half = { from: e.vb, to: e.va, edge: ei, rev: true, angle: Math.atan2(e.poly[n - 2].y - e.poly[n - 1].y, e.poly[n - 2].x - e.poly[n - 1].x), twin: half.length, next: -1 };
    half.push(fwd, bwd);
    verts[e.va].out.push(half.length - 2);
    verts[e.vb].out.push(half.length - 1);
  });
  for (const v of verts) v.out.sort((a, b) => half[a].angle - half[b].angle);
  for (const h of half) { const v = verts[h.to], idx = v.out.indexOf(h.twin); h.next = v.out[(idx - 1 + v.out.length) % v.out.length]; }
  // connected components
  let comp = 0;
  for (let i = 0; i < verts.length; i++) {
    if (verts[i].comp >= 0) continue;
    const stack = [i]; verts[i].comp = comp;
    while (stack.length) { const v = verts[stack.pop()!]; for (const hi of v.out) { const to = half[hi].to; if (verts[to].comp < 0) { verts[to].comp = comp; stack.push(to); } } }
    comp++;
  }
  return { verts, edges, half };
}

function shoelace(poly: XY[]): number {
  let a = 0;
  for (let k = 0; k < poly.length; k++) { const p = poly[k], q = poly[(k + 1) % poly.length]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}

function centroidOf(poly: XY[]): XY {
  let a = 0, cx = 0, cy = 0;
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k], q = poly[(k + 1) % poly.length], w = p.x * q.y - q.x * p.y;
    a += w; cx += (p.x + q.x) * w; cy += (p.y + q.y) * w;
  }
  if (Math.abs(a) < AREA_EPS) return poly[0];
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

function walkLoops(g: ReturnType<typeof buildGraph>): { pos: (Loop & { comp: number })[]; neg: (Loop & { comp: number })[] } {
  const pos: (Loop & { comp: number })[] = [], neg: (Loop & { comp: number })[] = [];
  const visited = new Array(g.half.length).fill(false);
  for (let s = 0; s < g.half.length; s++) {
    if (visited[s]) continue;
    const loop: number[] = [];
    let i = s, guard = 0;
    while (!visited[i] && guard++ <= g.half.length) { visited[i] = true; loop.push(i); i = g.half[i].next; }
    const poly: XY[] = [];
    for (const hi of loop) { const h = g.half[hi], e = g.edges[h.edge]; const pts = h.rev ? e.poly.slice().reverse() : e.poly; for (let k = 0; k < pts.length - 1; k++) poly.push(pts[k]); }
    const area = shoelace(poly);
    if (Math.abs(area) <= AREA_EPS) continue;
    const pcs: Piece[] = loop.map((hi) => { const h = g.half[hi], e = g.edges[h.edge]; return { seg: e.seg, t0: e.t0, t1: e.t1, reversed: h.rev }; });
    const comp = g.verts[g.half[loop[0]].from].comp;
    (area > 0 ? pos : neg).push({ poly, area: Math.abs(area), pieces: pcs, comp });
  }
  return { pos, neg };
}

export function pointInPoly(poly: XY[], p: XY): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function faceContains(face: Face, p: XY): boolean {
  return pointInPoly(face.outer.poly, p) && !face.holes.some((h) => pointInPoly(h.poly, p));
}

function assemble(pos: (Loop & { comp: number })[], neg: (Loop & { comp: number })[]): Face[] {
  const faces = pos.slice().sort((a, b) => b.area - a.area).map((l) => ({ outer: l, holes: [] as Loop[], area: l.area, centroid: centroidOf(l.poly), comp: l.comp }));
  for (const n of neg) {
    const probe = n.poly[0];
    for (let i = faces.length - 1; i >= 0; i--) {
      const f = faces[i];
      if (f.comp === n.comp) continue;
      if (pointInPoly(f.outer.poly, probe)) { f.holes.push({ poly: n.poly, area: n.area, pieces: n.pieces }); break; }
    }
  }
  return faces.map(({ outer, holes, area, centroid }) => ({ outer: { poly: outer.poly, area: outer.area, pieces: outer.pieces }, holes, area, centroid }));
}

const memo = new WeakMap<Doc, Face[]>();
export function computeFaces(doc: Doc): Face[] {
  const hit = memo.get(doc);
  if (hit) return hit;
  let faces: Face[] = [];
  try {
    const segs = collectSegments(doc);
    const { pos, neg } = walkLoops(buildGraph(segs, splitParams(segs)));
    faces = assemble(pos, neg);
  } catch (err) {
    console.error('regions: face computation failed', err);
    faces = [];
  }
  memo.set(doc, faces);
  return faces;
}

// Smallest face containing p, outside its holes. Faces are sorted largest first.
export function faceAt(faces: Face[], p: XY): Face | null {
  for (let i = faces.length - 1; i >= 0; i--) {
    const f = faces[i];
    if (!pointInPoly(f.outer.poly, p)) continue;
    return f.holes.some((h) => pointInPoly(h.poly, p)) ? null : f;
  }
  return null;
}

export function seedFor(face: Face, click: XY): XY {
  return faceContains(face, face.centroid) ? face.centroid : click;
}

function loopPathData(loop: Loop): string {
  const parts: string[] = [];
  loop.pieces.forEach((pc, i) => {
    const s = pc.seg;
    let a: XY, cp: XY | null, b: XY;
    if (s.cp) ({ a, cp, b } = subCurve(s, pc.t0, pc.t1)); else { a = bez(s, pc.t0); b = bez(s, pc.t1); cp = null; }
    if (pc.reversed) [a, b] = [b, a];
    if (i === 0) parts.push(`M${a.x},${a.y}`);
    parts.push(cp ? `Q${cp.x},${cp.y} ${b.x},${b.y}` : `L${b.x},${b.y}`);
  });
  return parts.join(' ') + ' Z';
}

export function facePathData(face: Face): string {
  return [face.outer, ...face.holes].map(loopPathData).join(' ');
}
```

- [ ] **Step 4: Add gated `faces` to `src/state/derived.ts`**

```ts
import { signal, effect } from '@preact/signals';
import { drag } from './ui';
import { computeFaces } from '../engine/regions';
import type { Face } from '../types';

// Faces are recomputed on the next frame after a commit, never while a drag is in progress.
export const faces = signal<Face[]>([]);
const raf: (cb: () => void) => void = typeof requestAnimationFrame === 'function' ? (cb) => { requestAnimationFrame(cb); } : (cb) => cb();
let scheduled = false;
effect(() => {
  const d = doc.value;
  if (drag.value || scheduled) return;
  scheduled = true;
  raf(() => { scheduled = false; faces.value = computeFaces(d === doc.peek() ? d : doc.peek()); });
});
```

Add to `tests/unit/history.test.ts`:

```ts
import { faces } from '../../src/state/derived';
import { drag } from '../../src/state/ui';

test('faces are not recomputed while a drag is set, and catch up when it ends', () => {
  fresh();
  const d = draft();
  const pts = [{ u: 0.25, v: 0.25 }, { u: 0.75, v: 0.25 }, { u: 0.75, v: 0.75 }, { u: 0.25, v: 0.75 }].map((p) => P.addPoint(d, p));
  const path = P.startPath(d, pts[0], { color: '#000', weight: 1 });
  for (const n of pts.slice(1)) P.appendNode(d, path.id, n);
  P.appendNode(d, path.id, pts[0]);
  drag.value = { kind: 'click', target: null, start: { x: 0, y: 0 }, moved: false, pointerId: 1, hitScale: 1 };
  commit(d);
  expect(faces.value).toHaveLength(0);
  drag.value = null;
  expect(faces.value).toHaveLength(9);
});
```

- [ ] **Step 5: Run the tests**

Run: `npm test` → all pass. If the hole test yields 9 faces instead of 18, the inner square's component was not separated (check `comp` labelling); if 27, the negative loops leaked into `pos` (check the sign convention: interior faces come out with positive shoelace area under the `out[(idx − 1)]` next-pointer rule).

- [ ] **Step 6: Commit**

```bash
git add src/engine/regions.ts src/state/derived.ts tests/unit/regions.test.ts tests/unit/history.test.ts
git commit -m "Add planar-arrangement regions with holes, centroid seeds and gated faces

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Freehand fitting, the SVG scene, and the demo document

**Files:**
- Create: `src/engine/freehand.ts`, `tests/unit/freehand.test.ts`, `src/components/Canvas.tsx`, `src/example.ts`
- Modify: `src/state/ui.ts` (add `fitView`), `src/components/App.tsx`, `src/main.tsx`

**Interfaces:**
- `freehand.ts`: `simplify(pts, eps)`, `fitQuadratic(raw, i0, i1, minDeviation?)`, `strokeToPath(raw, opts?) → { points, cps } | null` (world coordinates).
- `ui.ts`: `fitView(lat)` sets `view` so the base cell plus margin fits `viewport`.
- `Canvas.tsx`: `<Canvas />` renders the scene from signals. Exposes nothing else. Task 8 attaches the pointer handlers to its `<svg>` via `attachPointer`.
- `example.ts`: `exampleDoc() → Doc`.

- [ ] **Step 1: Write `tests/unit/freehand.test.ts`**

```ts
import { test, expect } from 'vitest';
import { simplify, fitQuadratic, strokeToPath } from '../../src/engine/freehand';

const line = Array.from({ length: 30 }, (_, i) => ({ x: i * 4, y: 0.3 * Math.sin(i) }));
const arc = Array.from({ length: 21 }, (_, i) => { const t = i / 20, u = 1 - t; return { x: 2 * u * t * 50 + t * t * 100, y: 2 * u * t * 100 }; });

test('simplify collapses a near-straight stroke to its endpoints', () => {
  const s = simplify(line, 5);
  expect(s).toHaveLength(2); expect(s[0]).toBe(line[0]); expect(s[1]).toBe(line[29]);
});

test('fitQuadratic recovers a control point close to the true one and rejects a line', () => {
  const cp = fitQuadratic(arc, 0, arc.length - 1)!;
  expect(Math.abs(cp.x - 50)).toBeLessThan(10); expect(Math.abs(cp.y - 100)).toBeLessThan(10);
  expect(fitQuadratic(line, 0, line.length - 1)).toBe(null);
});

test('strokeToPath rejects a jitter and returns points plus cps otherwise', () => {
  expect(strokeToPath([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }])).toBe(null);
  const out = strokeToPath(arc, { eps: 60 })!;
  expect(out.points).toHaveLength(2); expect(out.cps).toHaveLength(1); expect(out.cps[0]).toBeTruthy();
  expect(strokeToPath(line)!.cps[0]).toBe(null);
});
```

- [ ] **Step 2: Create `src/engine/freehand.ts`**

```ts
import type { XY } from '../types';

export function simplify(pts: XY[], eps: number): XY[] {
  if (pts.length < 3) return pts.slice();
  const a = pts[0], b = pts[pts.length - 1], L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let idx = 0, md = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], d = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L;
    if (d > md) { md = d; idx = i; }
  }
  if (md <= eps) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

export function fitQuadratic(raw: XY[], i0: number, i1: number, minDeviation = 2.5): XY | null {
  const P0 = raw[i0], P2 = raw[i1];
  if (i1 - i0 < 2) return null;
  const cum = [0];
  for (let i = i0 + 1; i <= i1; i++) cum.push(cum[cum.length - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y));
  const L = cum[cum.length - 1] || 1, chord = Math.hypot(P2.x - P0.x, P2.y - P0.y) || 1;
  let nx = 0, ny = 0, den = 0, dev = 0;
  for (let i = i0 + 1; i < i1; i++) {
    const t = cum[i - i0] / L, b0 = (1 - t) ** 2, b1 = 2 * t * (1 - t), b2 = t * t, S = raw[i];
    nx += b1 * (S.x - b0 * P0.x - b2 * P2.x); ny += b1 * (S.y - b0 * P0.y - b2 * P2.y); den += b1 * b1;
    dev = Math.max(dev, Math.abs((P2.x - P0.x) * (P0.y - S.y) - (P0.x - S.x) * (P2.y - P0.y)) / chord);
  }
  if (!den || dev < minDeviation) return null;
  return { x: nx / den, y: ny / den };
}

export function strokeToPath(raw: XY[], { eps = 5, minDeviation = 2.5 } = {}): { points: XY[]; cps: (XY | null)[] } | null {
  if (raw.length < 2) return null;
  const simp = simplify(raw, eps);
  if (simp.length < 2) return null;
  if (simp.length === 2 && Math.hypot(simp[1].x - simp[0].x, simp[1].y - simp[0].y) < 4) return null;
  const idx = simp.map((v) => raw.indexOf(v)), cps: (XY | null)[] = [];
  for (let j = 0; j < simp.length - 1; j++) cps.push(fitQuadratic(raw, idx[j], idx[j + 1], minDeviation));
  return { points: simp.map((p) => ({ x: p.x, y: p.y })), cps };
}
```

- [ ] **Step 3: Add `fitView` to `src/state/ui.ts`**

```ts
import type { Lattice } from '../types';
import { CONFIG } from '../config';

export function fitView(lat: Lattice): void {
  const xs = [0, lat.ax, lat.bx, lat.ax + lat.bx], ys = [0, lat.ay, lat.by, lat.ay + lat.by];
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const { width, height } = viewport.value;
  const zoom = Math.min(CONFIG.ZOOM_MAX, Math.max(CONFIG.ZOOM_MIN, Math.min(width / (w * 1.6), height / (h * 1.6)) || 1));
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  view.value = { zoom, pan: { x: width / 2 - cx * zoom, y: height / 2 - cy * zoom } };
}
```

- [ ] **Step 4: Create `src/example.ts`**

```ts
import { emptyDoc } from './state/doc';
import * as P from './engine/paths';
import type { Doc } from './types';

// A wavy tile boundary cloned through a 180° turn, one fill, and a detail loop above it.
export function exampleDoc(): Doc {
  const d = emptyDoc();
  const style = { color: '#1c1b18', weight: 2 };
  const r2 = P.addElement(d, { kind: 'rotate', u: 0.5, v: 0.5, n: 2 });
  d.newPathOps = [[r2.id]];
  const o = P.addPoint(d, { u: 0, v: 0 });
  const top = P.startPath(d, o, style);
  P.appendNode(d, top.id, P.addPoint(d, { u: 1, v: 0 }));
  P.setControlPointAbs(d, top.id, 0, { u: 0.5, v: 0.3 });
  P.addBinding(d, top.id, [r2.id]);
  const left = P.startPath(d, o, style);
  P.appendNode(d, left.id, P.addPoint(d, { u: 0, v: 1 }));
  P.setControlPointAbs(d, left.id, 0, { u: -0.25, v: 0.5 });
  P.addBinding(d, left.id, [r2.id]);
  const eye = P.startPath(d, P.addPoint(d, { u: 0.375, v: 0.42 }), { color: '#c2255c', weight: 2 }, 'detail');
  P.appendNode(d, eye.id, P.addPoint(d, { u: 0.5, v: 0.42 }));
  P.appendNode(d, eye.id, eye.start);
  P.setControlPointAbs(d, eye.id, 0, { u: 0.44, v: 0.33 });
  P.setControlPointAbs(d, eye.id, 1, { u: 0.44, v: 0.51 });
  P.addFill(d, { u: 0.5, v: 0.62 }, '#c98a12');
  return d;
}
```

- [ ] **Step 5: Create `src/components/Canvas.tsx`**

```tsx
import { useRef } from 'preact/hooks';
import { CONFIG } from '../config';
import { doc } from '../state/doc';
import { layer, tool, selection, hover, drag, pen, cursor, view, prefs, space, fillPreview } from '../state/ui';
import { cloneMatrices, visibleCells, copies, copyMatrix, faces } from '../state/derived';
import { toWorld, nodeUV, windowOffsets, cellPolygon } from '../engine/lattice';
import { IDENTITY, apply, toSvg } from '../engine/transform';
import { getPath, getElement, pathNodes, pathWorld, pathCpsWorld, boundsWorld, nodeWorld } from '../engine/paths';
import { bboxHandles, seedOf } from '../engine/hit';
import { faceAt, facePathData } from '../engine/regions';
import type { XY, Path, Matrix, Cell, HitTarget } from '../types';

const segD = (a: XY, b: XY, cp: XY | null) => (cp ? `M${a.x},${a.y} Q${cp.x},${cp.y} ${b.x},${b.y}` : `M${a.x},${a.y} L${b.x},${b.y}`);
const pathD = (P: XY[], C: (XY | null)[]) => P.slice(1).map((b, j) => segD(P[j], b, C[j])).join(' ');
const isBase = (o: Cell) => o.c === 0 && o.r === 0;
const cellKey = (o: Cell) => `${o.c},${o.r}`;
const sameCopy = (a: { cell: Cell; bindingId: string | null; power: number }, b: typeof a) =>
  a.cell.c === b.cell.c && a.cell.r === b.cell.r && a.bindingId === b.bindingId && a.power === b.power;
const hoverIs = (h: HitTarget | null, kind: HitTarget['kind']) => !!h && h.kind === kind;

// Base cell geometry: every source and clone, at cell (0,0), in world coordinates.
function entriesOf(p: Path): Matrix[] {
  const d = doc.value, cm = cloneMatrices.value;
  return [IDENTITY, ...d.bindings.filter((b) => b.pathId === p.id).flatMap((b) => cm.get(b.id) ?? [])];
}

function CellDefs() {
  const d = doc.value;
  const strokes = (lyr: 'structure' | 'detail') => d.paths.filter((p) => p.layer === lyr).flatMap((p) => {
    const P = pathWorld(d, p), C = pathCpsWorld(d, p);
    return entriesOf(p).map((M, i) => <path key={`${p.id}:${i}`} class="stroke" d={pathD(P.map((q) => apply(M, q)), C.map((c) => c && apply(M, c)))} stroke={p.style.color} stroke-width={p.style.weight} />);
  });
  const fs = faces.value;
  const fills = d.fills.map((f) => ({ f, face: faceAt(fs, toWorld(f, d.lattice)) })).filter((x) => x.face).sort((a, b) => b.face!.area - a.face!.area);
  return (
    <defs>
      <g id="cell-structure">{strokes('structure')}</g>
      <g id="cell-fills">{fills.map(({ f, face }) => <path key={f.id} class="fill" d={facePathData(face!)} fill={f.color} />)}</g>
      <g id="cell-detail">{strokes('detail')}</g>
    </defs>
  );
}

function Uses({ id }: { id: string }) {
  const lat = doc.value.lattice, ghost = prefs.value.ghostOpacity;
  return <g>{visibleCells.value.map((o) => { const t = toWorld({ u: o.c, v: o.r }, lat); return <use key={cellKey(o)} href={`#${id}`} transform={`translate(${t.x} ${t.y})`} opacity={isBase(o) ? 1 : ghost} />; })}</g>;
}

function Grid() {
  const lat = doc.value.lattice, div = prefs.value.gridDivisions, lines = [];
  for (let i = 1; i < div; i++) {
    const t = i / div;
    lines.push(<line key={`u${i}`} class="grid-line" x1={lat.ax * t} y1={lat.ay * t} x2={lat.ax * t + lat.bx} y2={lat.ay * t + lat.by} />);
    lines.push(<line key={`v${i}`} class="grid-line" x1={lat.bx * t} y1={lat.by * t} x2={lat.bx * t + lat.ax} y2={lat.by * t + lat.ay} />);
  }
  return <g>{lines}</g>;
}

function Frames() {
  const lat = doc.value.lattice;
  return <g>{visibleCells.value.map((o) => <polygon key={cellKey(o)} class={isBase(o) ? 'frame base' : 'frame'} points={cellPolygon(o, lat).map((p) => `${p.x},${p.y}`).join(' ')} />)}</g>;
}

function latticeRadius(): number {
  const lat = doc.value.lattice;
  return 1.5 * Math.max(Math.hypot(lat.ax, lat.ay), Math.hypot(lat.bx, lat.by), Math.hypot(lat.ax + lat.bx, lat.ay + lat.by) * 0.6);
}
const mirrorDir = (e: { du: number; dv: number }) => { const d = toWorld({ u: e.du, v: e.dv }, doc.value.lattice), L = Math.hypot(d.x, d.y) || 1; return { x: d.x / L, y: d.y / L }; };

function ElementGhosts() {
  const d = doc.value, z = view.value.zoom, E = 2.4 * latticeRadius();
  return <g>{d.elements.flatMap((e) => visibleCells.value.filter((o) => !isBase(o)).map((o) => {
    const t = toWorld({ u: o.c, v: o.r }, d.lattice), c = toWorld(e, d.lattice);
    if (e.kind === 'rotate') return <circle key={`${e.id}:${cellKey(o)}`} class="el-ghost" cx={c.x + t.x} cy={c.y + t.y} r={6 / z} />;
    if (e.kind === 'mirror') { const dir = mirrorDir(e); return <line key={`${e.id}:${cellKey(o)}`} class="el-ghost" x1={c.x + t.x - E * dir.x} y1={c.y + t.y - E * dir.y} x2={c.x + t.x + E * dir.x} y2={c.y + t.y + E * dir.y} />; }
    return null;
  }))}</g>;
}

// Halos on the selected copy, linked copies, and the hovered segment; fill hover tint.
function Highlights() {
  const d = doc.value, z = view.value.zoom, sel = selection.value, h = hover.value, out = [];
  const haloFor = (p: Path, M: Matrix, opacity: number, key: string) =>
    <path key={key} class="halo" d={pathD(pathWorld(d, p).map((q) => apply(M, q)), pathCpsWorld(d, p).map((c) => c && apply(M, c)))} stroke-width={p.style.weight + 6 / z} opacity={opacity} />;
  if (sel && sel.kind === 'path') {
    const p = getPath(d, sel.id);
    if (p) for (const ci of copies.value) if (ci.pathId === p.id) out.push(haloFor(p, ci.M, sameCopy(ci.copy, sel.copy) ? 0.3 : 0.15, `sel:${cellKey(ci.copy.cell)}:${ci.copy.bindingId}:${ci.copy.power}`));
  } else if (sel && sel.kind === 'element') {
    for (const ci of copies.value) { const b = ci.copy.bindingId && d.bindings.find((x) => x.id === ci.copy.bindingId); const p = b && b.ops.includes(sel.id) ? getPath(d, ci.pathId) : null; if (p) out.push(haloFor(p, ci.M, 0.15, `el:${cellKey(ci.copy.cell)}:${ci.copy.bindingId}:${ci.copy.power}`)); }
  }
  if (h && h.kind === 'segment' && !(sel && sel.kind === 'path' && sel.id === h.pathId && sameCopy(sel.copy, h.copy))) {
    const p = getPath(d, h.pathId);
    if (p) { const M = copyMatrix(h.copy); const P = pathWorld(d, p).map((q) => apply(M, q)), C = pathCpsWorld(d, p).map((c) => c && apply(M, c)); out.push(<path key="hov" class="halo" d={segD(P[h.j], P[h.j + 1], C[h.j])} stroke-width={p.style.weight + 6 / z} opacity={0.12} />); }
  }
  const probe = tool.value === 'fill' && layer.value === 'drawing' ? (fillPreview.value ?? cursor.value) : null;
  if (probe) {
    const face = faceAt(faces.value, seedOf(probe, d.lattice));
    if (face) { const dd = facePathData(face); for (const o of visibleCells.value) { const t = toWorld({ u: o.c, v: o.r }, d.lattice); out.push(<path key={`fh:${cellKey(o)}`} class="fill-hover" d={dd} transform={`translate(${t.x} ${t.y})`} />); } }
  }
  return <g>{out}</g>;
}

function selectedCopy() {
  const sel = selection.value;
  if (!sel || sel.kind !== 'path') return null;
  const p = getPath(doc.value, sel.id);
  return p ? { p, M: copyMatrix(sel.copy), copy: sel.copy } : null;
}

function Guides() {
  const sc = selectedCopy(); if (!sc) return null;
  const d = doc.value, P = pathWorld(d, sc.p).map((q) => apply(sc.M, q)), C = pathCpsWorld(d, sc.p).map((c) => c && apply(sc.M, c));
  return <g>{C.flatMap((c, j) => c ? [<line key={`a${j}`} class="guide" x1={P[j].x} y1={P[j].y} x2={c.x} y2={c.y} />, <line key={`b${j}`} class="guide" x1={c.x} y1={c.y} x2={P[j + 1].x} y2={P[j + 1].y} />] : [])}</g>;
}

function FreehandPreview() {
  const dr = drag.value; if (!dr || dr.kind !== 'free' || dr.raw.length < 2) return null;
  const d = doc.value, st = prefs.value.style, dd = dr.raw.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const ghosts = [];
  for (const o of visibleCells.value) { const t = toWorld({ u: o.c, v: o.r }, d.lattice); for (const [i, M] of [IDENTITY, ...dr.cloneMatrices].entries()) { if (isBase(o) && i === 0) continue; ghosts.push(<path key={`${cellKey(o)}:${i}`} class="free" d={dd} transform={`translate(${t.x} ${t.y}) ${toSvg(M)}`} stroke={st.color} stroke-width={st.weight} opacity={0.3} />); } }
  return <g>{ghosts}<path class="free" d={dd} stroke={st.color} stroke-width={st.weight} opacity={0.9} /></g>;
}

function Marquee() {
  const dr = drag.value; if (!dr || dr.kind !== 'marquee' || !dr.moved) return null;
  return <rect class="marquee" x={Math.min(dr.start.x, dr.cur.x)} y={Math.min(dr.start.y, dr.cur.y)} width={Math.abs(dr.cur.x - dr.start.x)} height={Math.abs(dr.cur.y - dr.start.y)} />;
}

function Rubber() {
  const pn = pen.value, c = cursor.value; if (!pn || !c) return null;
  const p = getPath(doc.value, pn.pathId); if (!p) return null;
  const nodes = pathNodes(p), last = nodeWorld(doc.value, nodes[nodes.length - 1]);
  return <line class="rubber" x1={last.x} y1={last.y} x2={c.x} y2={c.y} />;
}

function BBox() {
  if (layer.value !== 'drawing' || tool.value !== 'select') return null;
  const sc = selectedCopy(); if (!sc) return null;
  const d = doc.value, z = view.value.zoom, dr = drag.value, bd = !!dr && dr.kind === 'bbox', h = hover.value;
  const box = bd && dr.kind === 'bbox' ? dr.box : boundsWorld(d, sc.p, sc.M);
  let corners: XY[] = [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }];
  if (bd && dr.kind === 'bbox' && dr.M) corners = corners.map((c) => apply(dr.M!, c));
  const polys = visibleCells.value.map((o) => { const t = toWorld({ u: o.c, v: o.r }, d.lattice); return <polygon key={cellKey(o)} class={isBase(o) ? 'bbox' : 'bbox ghost'} points={corners.map((c) => `${c.x + t.x},${c.y + t.y}`).join(' ')} />; });
  if (bd) return <g>{polys}</g>;
  const s = 10 / z, cx = (box.x0 + box.x1) / 2, ry = box.y0 - CONFIG.BBOX_ROT_OFFSET / z;
  return <g>{polys}
    {bboxHandles(box).map((hd, i) => <rect key={i} class={h && h.kind === 'bbox' && h.h === i ? 'handle hover' : 'handle'} x={hd.x - s / 2} y={hd.y - s / 2} width={s} height={s} />)}
    <line class="guide" x1={cx} y1={box.y0} x2={cx} y2={ry} /><circle class={hoverIs(h, 'bboxrot') ? 'handle hover' : 'handle'} cx={cx} cy={ry} r={6 / z} />
  </g>;
}

function Diamonds() {
  if (layer.value !== 'drawing' || tool.value !== 'select') return null;
  const sc = selectedCopy(); if (!sc) return null;
  const d = doc.value, z = view.value.zoom, s = CONFIG.HANDLE_PX * 1.4 / z, h = hover.value;
  const P = pathWorld(d, sc.p).map((q) => apply(sc.M, q)), C = pathCpsWorld(d, sc.p).map((c) => c && apply(sc.M, c));
  return <g>{sc.p.segments.map((_, j) => { const c = C[j], m = c ?? { x: (P[j].x + P[j + 1].x) / 2, y: (P[j].y + P[j + 1].y) / 2 }; return <rect key={j} class={h && h.kind === 'diamond' && h.j === j ? 'diamond hover' : 'diamond'} x={m.x - s / 2} y={m.y - s / 2} width={s} height={s} transform={`rotate(45 ${m.x} ${m.y})`} fill={c ? CONFIG.COLORS.accent : CONFIG.COLORS.background} />; })}</g>;
}

function Points() {
  const d = doc.value, z = view.value.zoom, sel = selection.value, h = hover.value, pn = pen.value;
  const showAll = layer.value === 'drawing' && (!!pn || tool.value === 'pen' || tool.value === 'freehand');
  const show = new Set<string>();
  if (sel && sel.kind === 'points') for (const id of sel.ids) show.add(id);
  const penPath = pn ? getPath(d, pn.pathId) : null, selPath = sel && sel.kind === 'path' ? getPath(d, sel.id) : null;
  for (const p of [penPath, selPath]) if (p) for (const n of pathNodes(p)) show.add(n.pointId);
  const penLast = penPath ? pathNodes(penPath).at(-1)! : null;
  const selPts = new Set(sel && sel.kind === 'points' ? sel.ids : []);
  const out = [];
  for (const o of windowOffsets()) for (const pt of d.points) {
    if (!showAll && !show.has(pt.id)) continue;
    const w = toWorld(nodeUV(pt, o), d.lattice);
    const isLast = !!penLast && penLast.pointId === pt.id && penLast.cell.c === o.c && penLast.cell.r === o.r;
    const isHover = !!h && h.kind === 'point' && h.pointId === pt.id && h.cell.c === o.c && h.cell.r === o.r;
    const cls = ['pt', (isLast || selPts.has(pt.id)) && 'sel', isHover && 'hover', !isBase(o) && 'dim'].filter(Boolean).join(' ');
    out.push(<circle key={`${pt.id}:${cellKey(o)}`} class={cls} cx={w.x} cy={w.y} r={(isBase(o) ? CONFIG.HANDLE_PX : CONFIG.HANDLE_PX - 1) / z} />);
  }
  return <g class={layer.value === 'drawing' ? undefined : 'inactive-layer'}>{out}</g>;
}

function CloneAnchors() {
  if (layer.value !== 'drawing') return null;
  const d = doc.value, z = view.value.zoom, sel = selection.value, h = hover.value, s = 10 / z, out = [];
  for (const ci of copies.value) {
    if (!ci.copy.bindingId) continue;
    const selected = !!sel && sel.kind === 'path' && sel.id === ci.pathId && sameCopy(sel.copy, ci.copy);
    if (!selected && tool.value !== 'freehand' && tool.value !== 'pen') continue;
    const p = getPath(d, ci.pathId); if (!p) continue;
    const P = pathWorld(d, p).map((q) => apply(ci.M, q));
    pathNodes(p).forEach((n, i) => {
      const isHover = !!h && h.kind === 'canchor' && h.pointId === n.pointId && sameCopy(h.copy, ci.copy);
      out.push(<rect key={`${ci.pathId}:${cellKey(ci.copy.cell)}:${ci.copy.bindingId}:${ci.copy.power}:${i}`} class={['canchor', selected && 'sel', isHover && 'hover'].filter(Boolean).join(' ')} x={P[i].x - s / 2} y={P[i].y - s / 2} width={s} height={s} rx={2 / z} />);
    });
  }
  return <g>{out}</g>;
}

function Elements() {
  const d = doc.value, z = view.value.zoom, sel = selection.value, h = hover.value, E = 2.4 * latticeRadius();
  const armed = new Set(d.newPathOps.flat());
  const selId = sel && sel.kind === 'element' ? sel.id : null;
  const hovId = h && (h.kind === 'element' || h.kind === 'elrot' || h.kind === 'eltip') ? h.elementId : null;
  return <g class={layer.value === 'construction' ? undefined : 'inactive-layer'}>{d.elements.map((e) => {
    const selected = selId === e.id, c = toWorld(e, d.lattice);
    const mark = ['el-mark', armed.has(e.id) && 'armed', hovId === e.id && 'hover'].filter(Boolean).join(' ');
    if (e.kind === 'rotate') return <g key={e.id}>
      <line class="el-cross" x1={c.x - 14 / z} y1={c.y} x2={c.x + 14 / z} y2={c.y} /><line class="el-cross" x1={c.x} y1={c.y - 14 / z} x2={c.x} y2={c.y + 14 / z} />
      <circle class={mark} cx={c.x} cy={c.y} r={(selected ? 9 : 7) / z} stroke-width={selected ? 2.5 : 1.5} />
      <text class="el-label" x={c.x + 10 / z} y={c.y - 10 / z} font-size={11 / z}>{e.n}</text></g>;
    if (e.kind === 'mirror') {
      const dir = mirrorDir(e), R = CONFIG.ELEMENT_ROT_OFFSET / z;
      return <g key={e.id}>
        <line class="el-line" x1={c.x - E * dir.x} y1={c.y - E * dir.y} x2={c.x + E * dir.x} y2={c.y + E * dir.y} stroke-width={selected ? 2.5 : 1.5} opacity={armed.has(e.id) || selected ? 1 : 0.6} />
        <circle class={mark} cx={c.x} cy={c.y} r={(selected ? 8 : 6) / z} stroke-width={selected ? 2.5 : 1.5} />
        {selected && <circle class={hoverIs(h, 'elrot') ? 'el-knob hover' : 'el-knob'} cx={c.x + R * dir.x} cy={c.y + R * dir.y} r={6 / z} />}</g>;
    }
    const s = 10 / z;
    return <g key={e.id}>
      <line class="el-arrow" x1={0} y1={0} x2={c.x} y2={c.y} opacity={armed.has(e.id) || selected ? 1 : 0.6} />
      <rect class={mark} x={c.x - s / 2} y={c.y - s / 2} width={s} height={s} transform={`rotate(45 ${c.x} ${c.y})`} />
      <text class="el-label" x={c.x + 10 / z} y={c.y - 10 / z} font-size={11 / z}>{fmtFrac(e.u)}, {fmtFrac(e.v)}</text></g>;
  })}</g>;
}

export function fmtFrac(x: number): string {
  if (Math.abs(x) < 1e-9) return '0';
  for (const d of [1, 2, 3, 4, 6, 12]) { const n = Math.round(x * d); if (Math.abs(n / d - x) < 1e-6) return d === 1 ? `${n}` : `${n}/${d}`; }
  return x.toFixed(2);
}

function LatticeHandles() {
  const lat = doc.value.lattice, z = view.value.zoom, h = hover.value;
  return <g class={layer.value === 'construction' ? undefined : 'inactive-layer'}>{([['a', lat.ax, lat.ay], ['b', lat.bx, lat.by]] as const).map(([w, x, y]) => <g key={w}>
    <line class="lat-line" x1={0} y1={0} x2={x} y2={y} />
    <circle class={h && h.kind === 'lat' && h.which === w ? 'lat-handle hover' : 'lat-handle'} cx={x} cy={y} r={7 / z} />
    <text class="lat-label" x={x + 10 / z} y={y - 8 / z} font-size={11 / z}>{w}</text></g>)}</g>;
}

function cursorFor(): string {
  const h = hover.value, t = tool.value;
  if (space.value && pen.value) return 'grab';
  if (layer.value === 'construction') return h ? (h.kind === 'elrot' || h.kind === 'eltip' ? 'grab' : 'move') : 'default';
  if (h && h.kind === 'bbox') return bboxCursor(h.h);
  if (h && (h.kind === 'bboxrot' || h.kind === 'diamond')) return 'grab';
  if (h && (h.kind === 'point' || h.kind === 'segment' || h.kind === 'canchor' || h.kind === 'fill')) return 'pointer';
  return t === 'select' || t === 'fill' ? 'default' : 'crosshair';
}
const bboxCursor = (i: number) => ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize', 'ns-resize', 'ns-resize', 'ew-resize', 'ew-resize'][i];

export function Canvas() {
  const ref = useRef<SVGSVGElement>(null);
  const v = view.value;
  const drawing = layer.value === 'drawing';
  return (
    <svg ref={ref} class="canvas" style={{ cursor: cursorFor() }} data-testid="canvas">
      <CellDefs />
      <g transform={`translate(${v.pan.x} ${v.pan.y}) scale(${v.zoom})`}>
        <Grid /><Frames /><ElementGhosts />
        <g class={drawing ? undefined : 'inactive-layer'}><Uses id="cell-structure" /><Uses id="cell-fills" /><Uses id="cell-detail" /></g>
        <Highlights /><Guides /><FreehandPreview /><Marquee /><Rubber /><BBox /><Diamonds /><Points /><CloneAnchors /><Elements /><LatticeHandles />
      </g>
    </svg>
  );
}
```

- [ ] **Step 6: Wire `App.tsx` and `main.tsx`**

`src/components/App.tsx`:

```tsx
import { useEffect, useRef } from 'preact/hooks';
import { Canvas } from './Canvas';
import { viewport, lastPointerType, fitView } from '../state/ui';
import { doc } from '../state/doc';

export function App() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const measure = () => { const r = el.getBoundingClientRect(); viewport.value = { width: r.width, height: r.height }; };
    measure();
    fitView(doc.value.lattice);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div ref={ref} class="app" data-pointer={lastPointerType.value}><Canvas /><div class="chrome" /></div>;
}
```

`src/main.tsx`:

```tsx
import { render } from 'preact';
import { App } from './components/App';
import { doc } from './state/doc';
import { exampleDoc } from './example';
import './styles.css';

if (new URLSearchParams(location.search).has('example')) doc.value = exampleDoc();
render(<App />, document.getElementById('root')!);
```

- [ ] **Step 7: Run tests, typecheck, and look at the scene**

Run: `npm test` and `npx tsc --noEmit` → pass, clean. Open `http://127.0.0.1:5173/?example`. Expected, with no console errors:
- Dotted frames for the visible cells, the base cell in ink, grid lines inside it.
- A wavy boundary and its 180° clone in every cell; the ochre fill covering the tile region with the red lens drawn above it; the fill and strokes in neighbouring cells at reduced opacity.
- A dimmed violet rotation mark labelled "2" at the cell centre and pink `a` / `b` handles.
- In the DOM, one `<use href="#cell-structure">` per visible cell.

- [ ] **Step 8: Commit**

```bash
git add src/engine/freehand.ts tests/unit/freehand.test.ts src/components src/example.ts src/main.tsx src/state/ui.ts
git commit -m "Render the scene: base cell in defs, use copies, overlays; freehand fitting; demo document

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 8: Actions, pointer core with two-pointer navigation, Select and Pen tools

**Files:**
- Create: `src/actions.ts`, `src/interaction/pointer.ts`, `src/interaction/tools/common.ts`, `src/interaction/tools/select.ts`, `src/interaction/tools/pen.ts`, `src/interaction/tools/freehand.ts` (minimal: Task 10 completes), `src/interaction/tools/fill.ts` (minimal: Task 10 completes), `src/interaction/tools/construct.ts` (minimal: Task 9 completes), `tests/unit/actions.test.ts`
- Modify: `src/components/Canvas.tsx` (attach the pointer handlers)

**Interfaces:**
- `actions.ts` (all return `boolean`, all commit through `mutate`): `mutate(fn)`, `threshold(hitScale?)`, `uvOf(w)`, `worldOf(uv)`, `snapPoint(w, gridOn, skip?, hitScale?)`, `snapDeltaUV(dw, on)`, `setTool`, `setLayer`, `setSublayer`, `toggleSnap`, `toggleHelp`, `setGridDivisions(n)`, `setGhostOpacity(x)`, `undo`, `redo`, `penClickEmpty(w, on, hitScale)`, `penClickNode(node)`, `endPen`, `selectPathAt(pathId, copy)`, `selectPoints(ids)`, `togglePointSelection(id)`, `selectElement(id)`, `selectFill(id)`, `clearSel`, `insertNodeOnSegment(pathId, j, w, copy, on)`, `straightenSegment(pathId, j)`, `deleteSelection`, `deleteHoveredOrSelection`, `setStyle(patch)`, `setFillColor(color)`, `togglePathLayer(pathId)`, `addElement(kind)`, `setRotationOrder(id, n)`, `rotateMirror(id, deg)`, `rotateSelectedElement(deg)`, `setTranslation(id, u, v)`, `isNewPathChain(ops)`, `toggleNewPathChain(ops)`, `toggleOpOnBinding(bindingId, elementId)`, `addChain(pathId)`, `removeBinding(id)`, `deleteElement(id)`, `setLattice(lat)`, `fillAt(w)`, `finishFreehand(drag)`, `zoomAt(screen, factor)`, `panBy(dx, dy)`, `fitToTile()`.
- `common.ts`: `ToolCtx = { snapOn: boolean; hitScale: number; threshold: number }`, `ToolModule = { onDown(target, w, e, ctx); onMove(drag, w, e, ctx); onUp(drag, w, e, ctx) }`, `snapElement(w, on, hitScale) → UV`, `cloneBodyMove(drag, w, ctx)`.
- `pointer.ts`: `attachPointer(svg) → () => void`.
- Every tool starts a drag via `UI.drag.value = { kind, target, start, moved: false, pointerId, hitScale, ... }`. The core sets `moved`, calls `beginGesture()` on the first movement past the threshold, `endGesture()` on release, and republishes the drag object after each `onMove` so components re-render.

- [ ] **Step 1: Create `src/actions.ts`**

```ts
// Every user-level mutation. Chrome and tools call these so they stay in sync. Each returns whether it changed anything.
import { doc, draft, emptyDoc } from './state/doc';
import { commit, undo as hUndo, redo as hRedo } from './state/history';
import * as UI from './state/ui';
import { copyMatrix, faces } from './state/derived';
import * as P from './engine/paths';
import { toWorld, toUV, snapGrid, snapFraction } from './engine/lattice';
import { apply, invert, mirrorAngle, mirrorDirFromAngle } from './engine/transform';
import { snapWorld, projectOnSegment, seedOf, type Anchor } from './engine/hit';
import { faceAt, seedFor } from './engine/regions';
import { strokeToPath } from './engine/freehand';
import { CONFIG } from './config';
import type { Doc, XY, UV, Node, Copy, ElementKind, Lattice, Drag, Style, Tool, Layer, PathLayer } from './types';

export function mutate(fn: (d: Doc) => boolean | void): boolean {
  const d = draft();
  if (fn(d) === false) return false;
  commit(d);
  return true;
}

export const threshold = (hitScale = 1) => (CONFIG.SNAP_PX * hitScale) / UI.view.value.zoom;
export const uvOf = (w: XY): UV => toUV(w, doc.value.lattice);
export const worldOf = (uv: UV): XY => toWorld(uv, doc.value.lattice);
export function snapPoint(w: XY, gridOn: boolean, skip?: (a: Anchor) => boolean, hitScale = 1) {
  return snapWorld(doc.value, w, threshold(hitScale), UI.prefs.value.gridDivisions, skip, gridOn);
}
export function snapDeltaUV(dw: XY, on: boolean): UV {
  const d = uvOf(dw);
  return on ? snapGrid(d, UI.prefs.value.gridDivisions) : d;
}
const baseCopy: Copy = { cell: { c: 0, r: 0 }, bindingId: null, power: 0 };

// --- tools, layers, prefs

export function setTool(t: Tool): boolean {
  if (UI.layer.value !== 'drawing') { UI.layer.value = 'drawing'; if (UI.selection.value?.kind === 'element') UI.selection.value = null; }
  if (UI.tool.value === t) return false;
  endPen();
  UI.tool.value = t;
  if (t === 'freehand' || t === 'fill') UI.selection.value = null;
  UI.fillPreview.value = null;
  return true;
}
export function setLayer(l: Layer): boolean {
  if (UI.layer.value === l) return false;
  endPen();
  UI.layer.value = l;
  const s = UI.selection.value;
  if (s && (l === 'construction') !== (s.kind === 'element')) UI.selection.value = null;
  return true;
}
export function setSublayer(s: PathLayer): boolean { UI.sublayer.value = s; return true; }
export function toggleSnap(): boolean { UI.prefs.value = { ...UI.prefs.value, snap: !UI.prefs.value.snap }; return true; }
export function toggleHelp(): boolean { UI.showHelp.value = !UI.showHelp.value; return true; }
export function setGridDivisions(n: number): boolean { UI.prefs.value = { ...UI.prefs.value, gridDivisions: Math.max(2, Math.min(16, Math.round(n))) }; return true; }
export function setGhostOpacity(x: number): boolean { UI.prefs.value = { ...UI.prefs.value, ghostOpacity: Math.max(0.1, Math.min(1, x)) }; return true; }
export function undo(): boolean { endPen(); return hUndo(); }
export function redo(): boolean { endPen(); return hRedo(); }

// --- pen

function bindNewPath(d: Doc, pathId: string) { for (const ops of d.newPathOps) P.addBinding(d, pathId, ops); }

export function penClickEmpty(w: XY, on: boolean, hitScale = 1): boolean {
  if (UI.selection.value && !UI.pen.value) { UI.selection.value = null; return true; }
  const s = snapPoint(w, on, undefined, hitScale);
  const penNow = UI.pen.value;
  let started: string | null = null;
  const ok = mutate((d) => {
    const node: Node = s.anchor && !s.anchor.bindingId ? { pointId: s.anchor.pointId, cell: s.anchor.cell } : P.addPoint(d, toUV(s, d.lattice));
    if (penNow) { P.appendNode(d, penNow.pathId, node); return; }
    const path = P.startPath(d, node, UI.prefs.value.style, UI.sublayer.value);
    bindNewPath(d, path.id);
    started = path.id;
  });
  if (started) UI.pen.value = { pathId: started };
  return ok;
}

export function penClickNode(node: Node): boolean {
  const penNow = UI.pen.value;
  if (penNow) {
    const path = P.getPath(doc.value, penNow.pathId);
    if (!path) { UI.pen.value = null; return false; }
    const nodes = P.pathNodes(path);
    if (P.sameNode(nodes[nodes.length - 1], node)) { endPen(); return true; }
    return mutate((d) => { P.appendNode(d, penNow.pathId, node); });
  }
  let pathId: string | null = null;
  const ok = mutate((d) => {
    const openId = P.openEndAt(d, node.pointId);
    if (openId) { P.orientToEnd(d, openId, node.pointId, node.cell); pathId = openId; return; }
    const path = P.startPath(d, node, UI.prefs.value.style, UI.sublayer.value);
    bindNewPath(d, path.id);
    pathId = path.id;
  });
  if (pathId) { UI.pen.value = { pathId }; UI.selection.value = null; }
  return ok;
}

export function endPen(): boolean {
  const penNow = UI.pen.value;
  if (!penNow) return false;
  UI.pen.value = null;
  UI.cursor.value = null;
  const path = P.getPath(doc.value, penNow.pathId);
  if (path && path.segments.length === 0) mutate((d) => { P.deletePath(d, penNow.pathId); });
  return true;
}

// --- selection

export function selectPathAt(pathId: string, copy: Copy = baseCopy): boolean { UI.selection.value = { kind: 'path', id: pathId, copy }; return true; }
export function selectPoints(ids: string[]): boolean { const u = [...new Set(ids)]; UI.selection.value = u.length ? { kind: 'points', ids: u } : null; return true; }
export function togglePointSelection(id: string): boolean { const cur = UI.selectedPointIds(); return selectPoints(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]); }
export function selectElement(id: string): boolean { UI.selection.value = { kind: 'element', id }; return true; }
export function selectFill(id: string): boolean { UI.selection.value = { kind: 'fill', id }; return true; }
export function clearSel(): boolean { UI.selection.value = null; return true; }

// --- segments

export function insertNodeOnSegment(pathId: string, j: number, w: XY, copy: Copy, on: boolean): boolean {
  const path = P.getPath(doc.value, pathId);
  if (!path || j < 0 || j >= path.segments.length) return false;
  const M = copyMatrix(copy);
  const src = apply(invert(M), w);
  return mutate((d) => {
    const p = P.getPath(d, pathId)!;
    if (p.segments[j].cp) { P.insertNode(d, pathId, j, null); return; }
    const A = P.nodeWorld(d, P.prevNode(p, j)), B = P.nodeWorld(d, p.segments[j].to);
    let m = toUV(projectOnSegment(A, B, src), d.lattice);
    if (on) m = snapGrid(m, UI.prefs.value.gridDivisions);
    P.insertNode(d, pathId, j, m);
  });
}

export function straightenSegment(pathId: string, j: number): boolean {
  const path = P.getPath(doc.value, pathId);
  if (!path || !path.segments[j]?.cp) return false;
  return mutate((d) => { P.setControlPointAbs(d, pathId, j, null); });
}

// --- delete

export function deleteSelection(): boolean {
  const s = UI.selection.value;
  if (!s) return false;
  const ok = mutate((d) => {
    if (s.kind === 'points') P.deletePoints(d, s.ids);
    else if (s.kind === 'path') { if (s.copy.bindingId) P.removeBinding(d, s.copy.bindingId); else P.deletePath(d, s.id); }
    else if (s.kind === 'element') P.deleteElement(d, s.id);
    else if (s.kind === 'fill') P.removeFill(d, s.id);
  });
  UI.selection.value = null; UI.hover.value = null;
  endPen();
  return ok;
}

export function deleteHoveredOrSelection(): boolean {
  const h = UI.hover.value, s = UI.selection.value;
  if (h && h.kind === 'point' && !(s && s.kind === 'points')) {
    const ok = mutate((d) => { P.deletePoints(d, [h.pointId]); });
    UI.hover.value = null;
    if (s && s.kind === 'path' && !P.getPath(doc.value, s.id)) UI.selection.value = null;
    if (UI.pen.value && !P.getPath(doc.value, UI.pen.value.pathId)) UI.pen.value = null;
    return ok;
  }
  return deleteSelection();
}

// --- style, sublayer

export function setStyle(patch: Partial<Style>): boolean {
  const pid = UI.selectedPathId();
  if (pid) mutate((d) => { const p = P.getPath(d, pid); if (!p) return false; Object.assign(p.style, patch); });
  UI.prefs.value = { ...UI.prefs.value, style: { ...UI.prefs.value.style, ...patch } };
  return true;
}
export function setFillColor(color: string): boolean {
  UI.prefs.value = { ...UI.prefs.value, fillColor: color };
  const s = UI.selection.value;
  if (s && s.kind === 'fill') mutate((d) => { const f = P.getFill(d, s.id); if (!f) return false; f.color = color; });
  return true;
}
export function togglePathLayer(pathId: string): boolean {
  return mutate((d) => { const p = P.getPath(d, pathId); if (!p) return false; p.layer = p.layer === 'detail' ? 'structure' : 'detail'; });
}

// --- elements, bindings, chains

const chainKey = (ops: string[]) => ops.join('>');

export function addElement(kind: ElementKind): boolean {
  const pid = UI.selectedPathId();
  let id: string | null = null;
  const ok = mutate((d) => {
    const spec = kind === 'translate' ? { kind, u: 0.5, v: 0.5 } as const
      : kind === 'mirror' ? { kind, u: 0.5, v: 0.5, du: 0, dv: 1 } as const
      : { kind: 'rotate' as const, u: 0.5, v: 0.5, n: 2 };
    const e = P.addElement(d, spec);
    d.newPathOps.push([e.id]);
    if (pid) P.addBinding(d, pid, [e.id]);
    id = e.id;
  });
  if (id) { endPen(); UI.layer.value = 'construction'; UI.selection.value = { kind: 'element', id }; }
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
export function isNewPathChain(ops: string[]): boolean { const k = chainKey(ops); return doc.value.newPathOps.some((c) => chainKey(c) === k); }
export function toggleNewPathChain(ops: string[]): boolean {
  const k = chainKey(ops);
  return mutate((d) => { const i = d.newPathOps.findIndex((c) => chainKey(c) === k); if (i >= 0) d.newPathOps.splice(i, 1); else d.newPathOps.push(ops.slice()); });
}
export function toggleOpOnBinding(bindingId: string, elementId: string): boolean {
  return mutate((d) => { if (!P.getBinding(d, bindingId) || !P.getElement(d, elementId)) return false; P.toggleOp(d, bindingId, elementId); });
}
export function addChain(pathId: string): boolean { return mutate((d) => { if (!P.getPath(d, pathId)) return false; P.addBinding(d, pathId, []); }); }
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
export function setLattice(lat: Lattice): boolean { return mutate((d) => { d.lattice = { ...lat }; }); }

// --- fills

export function fillAt(w: XY): boolean {
  const fs = faces.value, lat = doc.value.lattice;
  const face = faceAt(fs, seedOf(w, lat));
  if (!face) return false;
  const color = UI.prefs.value.fillColor;
  const existing = doc.value.fills.find((f) => faceAt(fs, toWorld(f, lat)) === face);
  let id: string | null = null;
  const ok = mutate((d) => {
    if (existing) { const f = P.getFill(d, existing.id)!; f.color = color; id = f.id; return; }
    const seed = toUV(seedFor(face, seedOf(w, lat)), lat);
    id = P.addFill(d, seed, color).id;
  });
  if (id) UI.selection.value = { kind: 'fill', id };
  return ok;
}

// --- freehand

export function finishFreehand(dr: Extract<Drag, { kind: 'free' }>): boolean {
  const fit = strokeToPath(dr.raw, { eps: CONFIG.FREEHAND_EPS, minDeviation: CONFIG.FREEHAND_MIN_DEVIATION });
  if (!fit) return false;
  const last = fit.points[fit.points.length - 1];
  const endSnap = snapPoint(last, false, (a) => !!a.bindingId, dr.hitScale);
  let pathId: string | null = null;
  const ok = mutate((d) => {
    const nodes = fit.points.map((v, j) => {
      if (j === 0 && dr.startNode) return dr.startNode;
      if (j === fit.points.length - 1 && endSnap.anchor) return { pointId: endSnap.anchor.pointId, cell: endSnap.anchor.cell };
      return P.addPoint(d, toUV(v, d.lattice));
    });
    const extendId = dr.startNode ? P.openEndAt(d, dr.startNode.pointId) : null;
    let path;
    if (extendId) { path = P.getPath(d, extendId)!; P.orientToEnd(d, extendId, dr.startNode!.pointId, dr.startNode!.cell); }
    else path = P.startPath(d, nodes[0], UI.prefs.value.style, UI.sublayer.value);
    nodes.slice(1).forEach((n, j) => { if (P.appendNode(d, path.id, n) && fit.cps[j]) P.setControlPointWorld(d, path.id, path.segments.length - 1, fit.cps[j]); });
    if (!extendId) bindNewPath(d, path.id);
    if (path.segments.length === 0) { P.deletePath(d, path.id); return false; }
    pathId = path.id;
  });
  if (pathId) UI.selection.value = { kind: 'path', id: pathId, copy: baseCopy };
  return ok;
}

// --- view (never in history)

export function zoomAt(screen: XY, factor: number): boolean {
  const v = UI.view.value;
  const z = Math.min(CONFIG.ZOOM_MAX, Math.max(CONFIG.ZOOM_MIN, v.zoom * factor)), k = z / v.zoom;
  UI.view.value = { zoom: z, pan: { x: screen.x - (screen.x - v.pan.x) * k, y: screen.y - (screen.y - v.pan.y) * k } };
  return true;
}
export function panBy(dx: number, dy: number): boolean { const v = UI.view.value; UI.view.value = { zoom: v.zoom, pan: { x: v.pan.x + dx, y: v.pan.y + dy } }; return true; }
export function fitToTile(): boolean { UI.fitView(doc.value.lattice); return true; }
export function newDocument(): boolean { commit(emptyDoc()); UI.selection.value = null; UI.pen.value = null; return true; }
```

- [ ] **Step 2: Create `src/interaction/tools/common.ts`**

```ts
import { doc } from '../../state/doc';
import * as UI from '../../state/ui';
import * as A from '../../actions';
import * as P from '../../engine/paths';
import { toWorld, toUV, snapFraction } from '../../engine/lattice';
import { snapWorld } from '../../engine/hit';
import type { HitTarget, XY, UV, Drag, DragSpec, Element } from '../../types';

export type ToolCtx = { snapOn: boolean; hitScale: number; threshold: number };
export type ToolModule = {
  onDown(target: HitTarget | null, w: XY, e: PointerEvent, ctx: ToolCtx): void;
  onMove(d: Drag, w: XY, e: PointerEvent, ctx: ToolCtx): void;
  onUp(d: Drag, w: XY, e: PointerEvent, ctx: ToolCtx): void;
};

export function startDrag(e: PointerEvent, target: HitTarget | null, start: XY, hitScale: number, rest: DragSpec): void {
  UI.drag.value = { target, start, moved: false, pointerId: e.pointerId, hitScale, ...rest } as Drag;
}

// Element centres snap to an anchor if one is near, else to the finer of grid and twelfths.
export function snapElement(w: XY, on: boolean, hitScale: number): UV {
  const s = snapWorld(doc.value, w, A.threshold(hitScale), UI.prefs.value.gridDivisions, undefined, false);
  const uv = toUV(s.anchor ? s : w, doc.value.lattice);
  return s.anchor || !on ? uv : snapFraction(uv, UI.prefs.value.gridDivisions, doc.value.lattice);
}
const twelfths = (uv: UV): UV => ({ u: Math.round(uv.u * 12) / 12, v: Math.round(uv.v * 12) / 12 });

// Dragging a clone copy's body moves the first element of its chain so the copy follows the pointer.
export function cloneBodyMove(d: Extract<Drag, { kind: 'body' }>, w: XY, ctx: ToolCtx): void {
  const b = P.getBinding(doc.value, d.copy.bindingId!);
  if (!b || !b.ops.length) return;
  const s0 = d.startEls.find((z) => z.id === b.ops[0]);
  if (!s0) return;
  const dx = w.x - d.start.x, dy = w.y - d.start.y;
  A.mutate((dd) => {
    const first = P.getElement(dd, b.ops[0]);
    if (!first) return false;
    const lat = dd.lattice, c0 = toWorld(s0, lat);
    if (first.kind === 'rotate' && s0.kind === 'rotate') {
      const th = (2 * Math.PI) / first.n, c = Math.cos(th), s = Math.sin(th), det = 2 * (1 - c);
      const ex = ((1 - c) * dx - s * dy) / det, ey = (s * dx + (1 - c) * dy) / det;
      const uv = snapElement({ x: c0.x + ex, y: c0.y + ey }, ctx.snapOn, ctx.hitScale);
      first.u = uv.u; first.v = uv.v;
      return;
    }
    if (first.kind === 'mirror' && s0.kind === 'mirror') {
      const dv = toWorld({ u: s0.du, v: s0.dv }, lat), L = Math.hypot(dv.x, dv.y) || 1, dir = { x: dv.x / L, y: dv.y / L }, nrm = { x: -dir.y, y: dir.x };
      const pe = dx * nrm.x + dy * nrm.y, al = dx * dir.x + dy * dir.y;
      const uv = snapElement({ x: c0.x + (pe / 2) * nrm.x, y: c0.y + (pe / 2) * nrm.y }, ctx.snapOn, ctx.hitScale);
      first.u = uv.u; first.v = uv.v;
      const tId = b.ops.slice(1).find((id) => P.getElement(dd, id)?.kind === 'translate');
      if (tId) {
        const t = P.getElement(dd, tId) as Extract<Element, { kind: 'translate' }>, t0 = d.startEls.find((z) => z.id === tId) as Extract<Element, { kind: 'translate' }>;
        const v0 = toWorld(t0, lat);
        let uv2 = toUV({ x: v0.x + al * dir.x, y: v0.y + al * dir.y }, lat);
        if (ctx.snapOn) uv2 = twelfths(uv2);
        t.u = uv2.u; t.v = uv2.v;
      }
      return;
    }
    if (first.kind === 'translate' && s0.kind === 'translate') {
      let uv = toUV({ x: c0.x + dx, y: c0.y + dy }, lat);
      if (ctx.snapOn) uv = twelfths(uv);
      first.u = uv.u; first.v = uv.v;
    }
  });
}
```

- [ ] **Step 3: Create `src/interaction/tools/select.ts`**

```ts
// Select tool, plus the point / segment / anchor / control-point / bbox drags that Pen reuses.
import { doc } from '../../state/doc';
import * as UI from '../../state/ui';
import * as A from '../../actions';
import * as P from '../../engine/paths';
import { commit } from '../../state/history';
import { copyMatrix } from '../../state/derived';
import { pointsInRect, bboxHandles, scaleFor, scaleMatrix } from '../../engine/hit';
import { toUV } from '../../engine/lattice';
import { apply, invert, compose, rotation } from '../../engine/transform';
import { CONFIG } from '../../config';
import { startDrag, cloneBodyMove, type ToolModule, type ToolCtx } from './common';
import type { HitTarget, XY, Drag, Copy } from '../../types';

const sameCopy = (a: Copy, b: Copy) => a.cell.c === b.cell.c && a.cell.r === b.cell.r && a.bindingId === b.bindingId && a.power === b.power;
const linear = (M: readonly number[], p: XY): XY => ({ x: M[0] * p.x + M[2] * p.y, y: M[1] * p.x + M[3] * p.y });

export function pointDown(t: Extract<HitTarget, { kind: 'point' }>, w: XY, e: PointerEvent, hitScale: number): void {
  const selPts = UI.selectedPointIds();
  if (UI.tool.value === 'select' && selPts.includes(t.pointId) && selPts.length > 1) {
    startDrag(e, t, w, hitScale, { kind: 'pts', ids: selPts.slice(), startPos: P.snapshotPositions(doc.value, selPts) });
    return;
  }
  startDrag(e, t, w, hitScale, { kind: 'pt', pointId: t.pointId, cell: t.cell });
}

function startBBox(t: HitTarget, w: XY, e: PointerEvent, hitScale: number): void {
  const s = UI.selection.value;
  if (!s || s.kind !== 'path') return;
  const path = P.getPath(doc.value, s.id);
  if (!path) return;
  const M = copyMatrix(s.copy), box = P.boundsWorld(doc.value, path, M);
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const h = t.kind === 'bboxrot' ? { x: cx, y: box.y0 - CONFIG.BBOX_ROT_OFFSET / UI.view.value.zoom, ax: cx, ay: cy, cursor: 'grab' } : bboxHandles(box)[(t as Extract<HitTarget, { kind: 'bbox' }>).h];
  startDrag(e, t, w, hitScale, { kind: 'bbox', mode: t.kind === 'bboxrot' ? 'rot' : 'scale', h, box, cx, cy, pathId: s.id, copy: s.copy, startDoc: doc.value, M: null });
}

export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => {
  if (!t) { startDrag(e, null, w, ctx.hitScale, { kind: 'marquee', cur: w, add: e.shiftKey }); if (!e.shiftKey) UI.selection.value = null; return; }
  switch (t.kind) {
    case 'point': return pointDown(t, w, e, ctx.hitScale);
    case 'segment': {
      const path = P.getPath(doc.value, t.pathId); if (!path) return;
      const ids = [...new Set(P.pathNodes(path).map((n) => n.pointId))];
      return startDrag(e, t, w, ctx.hitScale, { kind: 'body', pathId: t.pathId, copy: t.copy, ids, startPos: P.snapshotPositions(doc.value, ids), startEls: doc.value.elements.map((x) => ({ ...x })) });
    }
    case 'canchor': return startDrag(e, t, w, ctx.hitScale, { kind: 'canchor', pathId: t.pathId, pointId: t.pointId, cell: t.cell, copy: t.copy });
    case 'diamond': return startDrag(e, t, w, ctx.hitScale, { kind: 'cp', pathId: t.pathId, j: t.j, copy: t.copy });
    case 'bbox': case 'bboxrot': return startBBox(t, w, e, ctx.hitScale);
    default: return startDrag(e, t, w, ctx.hitScale, { kind: 'click' });
  }
};

export const onMove: ToolModule['onMove'] = (d, w, e, ctx) => {
  switch (d.kind) {
    case 'marquee': d.cur = w; return;
    case 'pt': {
      if (!d.moved) return;
      const s = A.snapPoint(w, ctx.snapOn, (a) => !a.bindingId && a.pointId === d.pointId, ctx.hitScale);
      A.mutate((dd) => { const uv = toUV(s, dd.lattice); P.movePoint(dd, d.pointId, uv.u - d.cell.c, uv.v - d.cell.r); });
      return;
    }
    case 'pts': {
      if (!d.moved) return;
      const dv = A.snapDeltaUV({ x: w.x - d.start.x, y: w.y - d.start.y }, ctx.snapOn);
      A.mutate((dd) => { P.movePointsBy(dd, d.ids, d.startPos, dv.u, dv.v); });
      return;
    }
    case 'body': {
      if (!d.moved) return;
      if (d.copy.bindingId) { cloneBodyMove(d, w, ctx); return; }
      const M = copyMatrix(d.copy);
      const dv = A.snapDeltaUV(linear(invert(M), { x: w.x - d.start.x, y: w.y - d.start.y }), ctx.snapOn);
      A.mutate((dd) => { P.movePointsBy(dd, d.ids, d.startPos, dv.u, dv.v); });
      return;
    }
    case 'canchor': {
      if (!d.moved) return;
      const M = copyMatrix(d.copy);
      const s = A.snapPoint(w, ctx.snapOn, (a) => !a.bindingId && a.pointId === d.pointId, ctx.hitScale);
      const src = apply(invert(M), s);
      A.mutate((dd) => { const uv = toUV(src, dd.lattice); P.movePoint(dd, d.pointId, uv.u - d.cell.c, uv.v - d.cell.r); });
      return;
    }
    case 'cp': {
      if (!d.moved) return;
      const M = copyMatrix(d.copy);
      A.mutate((dd) => { P.setControlPointWorld(dd, d.pathId, d.j, apply(invert(M), w)); });
      return;
    }
    case 'bbox': {
      if (!d.moved) return;
      let T;
      if (d.mode === 'rot') {
        let th = Math.atan2(w.y - d.cy, w.x - d.cx) - Math.atan2(d.h.y - d.cy, d.h.x - d.cx);
        if (ctx.snapOn) th = Math.round(th / (Math.PI / 12)) * (Math.PI / 12);
        T = rotation(th, d.cx, d.cy);
      } else {
        const { sx, sy } = scaleFor(d.h, w, e.shiftKey);
        T = scaleMatrix(d.h.ax, d.h.ay, sx, sy);
      }
      const Mc = copyMatrix(d.copy, d.startDoc);
      const Msrc = compose(invert(Mc), compose(T, Mc));
      const next = structuredClone(d.startDoc);
      P.transformPath(next, d.pathId, Msrc);
      commit(next);
      d.M = T;
      return;
    }
    default:
  }
};

export const onUp: ToolModule['onUp'] = (d, w, e, ctx) => {
  if (d.kind === 'marquee') {
    if (!d.moved) return;
    const r = { x0: Math.min(d.start.x, d.cur.x), x1: Math.max(d.start.x, d.cur.x), y0: Math.min(d.start.y, d.cur.y), y1: Math.max(d.start.y, d.cur.y) };
    A.selectPoints([...(d.add ? UI.selectedPointIds() : []), ...pointsInRect(doc.value, r)]);
    return;
  }
  if (d.moved || !d.target) return;
  const t = d.target, s = UI.selection.value;
  switch (t.kind) {
    case 'point': if (e.shiftKey) A.togglePointSelection(t.pointId); else A.selectPoints([t.pointId]); return;
    case 'segment':
      if (s && s.kind === 'path' && s.id === t.pathId && sameCopy(s.copy, t.copy)) A.insertNodeOnSegment(t.pathId, t.j, w, t.copy, ctx.snapOn);
      else A.selectPathAt(t.pathId, t.copy);
      return;
    case 'canchor': A.selectPathAt(t.pathId, t.copy); return;
    case 'fill': A.selectFill(t.fillId); return;
    default:
  }
};
```

- [ ] **Step 4: Create `src/interaction/tools/pen.ts`**

```ts
import * as UI from '../../state/ui';
import * as A from '../../actions';
import * as select from './select';
import { startDrag, type ToolModule } from './common';

export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => {
  if (t && (t.kind === 'point' || t.kind === 'canchor' || t.kind === 'diamond')) { select.onDown(t, w, e, ctx); return; }
  A.penClickEmpty(w, ctx.snapOn, ctx.hitScale);
  startDrag(e, t, w, ctx.hitScale, { kind: 'click' });
};

export const onMove: ToolModule['onMove'] = (d, w, e, ctx) => { select.onMove(d, w, e, ctx); };

export const onUp: ToolModule['onUp'] = (d) => {
  if (d.moved || !d.target) return;
  if (d.target.kind === 'point') A.penClickNode({ pointId: d.target.pointId, cell: d.target.cell });
  else if (d.target.kind === 'canchor') A.penClickNode({ pointId: d.target.pointId, cell: d.target.cell });
  UI.cursor.value = null;
};
```

- [ ] **Step 5: Create the minimal `freehand.ts`, `fill.ts`, `construct.ts`**

`src/interaction/tools/freehand.ts` (Task 10 completes):

```ts
import { startDrag, type ToolModule } from './common';
export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => { startDrag(e, t, w, ctx.hitScale, { kind: 'click' }); };
export const onMove: ToolModule['onMove'] = () => {};
export const onUp: ToolModule['onUp'] = () => {};
```

`src/interaction/tools/fill.ts` (Task 10 completes):

```ts
import { startDrag, type ToolModule } from './common';
export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => { startDrag(e, t, w, ctx.hitScale, { kind: 'click' }); };
export const onMove: ToolModule['onMove'] = () => {};
export const onUp: ToolModule['onUp'] = () => {};
```

`src/interaction/tools/construct.ts` (Task 9 completes):

```ts
import * as UI from '../../state/ui';
import { startDrag, type ToolModule } from './common';
import type { HitTarget, XY } from '../../types';
export function startMultiDrag(_w: XY, _t: HitTarget | null, _e: PointerEvent): void {}
export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => { startDrag(e, t, w, ctx.hitScale, { kind: 'click' }); if (!t) UI.selection.value = null; };
export const onMove: ToolModule['onMove'] = () => {};
export const onUp: ToolModule['onUp'] = () => {};
```

- [ ] **Step 6: Create `src/interaction/pointer.ts`**

```ts
// One listener set on the SVG. Single pointer → active tool. Two pointers → pan and pinch-zoom; a second
// finger during a drag reverts that drag. Keyboard and wheel live here too.
import { doc } from '../state/doc';
import * as UI from '../state/ui';
import * as A from '../actions';
import { beginGesture, endGesture, abortGesture } from '../state/history';
import { copies, cloneMatrices, faces } from '../state/derived';
import { hitTest, type HitContext } from '../engine/hit';
import { CONFIG } from '../config';
import * as select from './tools/select';
import * as pen from './tools/pen';
import * as freehand from './tools/freehand';
import * as fill from './tools/fill';
import * as construct from './tools/construct';
import type { ToolModule, ToolCtx } from './tools/common';
import type { XY, View, PointerKind } from '../types';

const TOOLS: Record<string, ToolModule> = { select, pen, freehand, fill };
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: XY, b: XY): XY => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function attachPointer(svg: SVGSVGElement): () => void {
  const pointers = new Map<number, XY>();
  let nav: { startMid: XY; startDist: number; startView: View } | null = null;
  let navDead = false;
  let dragTool: ToolModule | null = null;

  const screen = (e: PointerEvent | WheelEvent): XY => { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const world = (e: PointerEvent | WheelEvent): XY => { const s = screen(e), v = UI.view.value; return { x: (s.x - v.pan.x) / v.zoom, y: (s.y - v.pan.y) / v.zoom }; };
  const kindOf = (e: PointerEvent): PointerKind => (e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse');
  const scaleOf = (e: PointerEvent) => (e.pointerType === 'touch' ? CONFIG.TOUCH_HIT_SCALE : 1);
  const ctxOf = (e: PointerEvent): ToolCtx => ({ snapOn: UI.prefs.value.snap !== e.shiftKey, hitScale: scaleOf(e), threshold: A.threshold(scaleOf(e)) });
  const hitCtx = (hitScale: number): HitContext => ({ layer: UI.layer.value, tool: UI.tool.value, selection: UI.selection.value, pen: UI.pen.value, zoom: UI.view.value.zoom, hitScale, copies: copies.value, cloneMatrices: cloneMatrices.value, faces: faces.value });
  const activeTool = (): ToolModule => (UI.layer.value === 'construction' ? construct : TOOLS[UI.tool.value]);

  function onDown(e: PointerEvent) {
    UI.lastPointerType.value = kindOf(e);
    pointers.set(e.pointerId, screen(e));
    if (pointers.size === 2) {
      if (UI.drag.value) { abortGesture(); UI.drag.value = null; UI.fillPreview.value = null; dragTool = null; }
      const [a, b] = [...pointers.values()];
      nav = { startMid: mid(a, b), startDist: Math.max(1, dist(a, b)), startView: UI.view.value };
      navDead = true;
      return;
    }
    if (pointers.size > 2 || navDead || e.button !== 0) return;
    const w = world(e), target = hitTest(doc.value, hitCtx(scaleOf(e)), w);
    let t = activeTool();
    if (UI.space.value && UI.layer.value === 'drawing' && (UI.pen.value || UI.tool.value === 'freehand')) { construct.startMultiDrag(w, target, e); t = construct; }
    else t.onDown(target, w, e, ctxOf(e));
    if (UI.drag.value) { dragTool = t; try { svg.setPointerCapture(e.pointerId); } catch { /* unsupported */ } }
  }

  function onMove(e: PointerEvent) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, screen(e));
    if (nav && pointers.size >= 2) {
      const [a, b] = [...pointers.values()], m = mid(a, b), d = Math.max(1, dist(a, b));
      const z0 = nav.startView.zoom, z = Math.min(CONFIG.ZOOM_MAX, Math.max(CONFIG.ZOOM_MIN, (z0 * d) / nav.startDist));
      const anchor = { x: (nav.startMid.x - nav.startView.pan.x) / z0, y: (nav.startMid.y - nav.startView.pan.y) / z0 };
      UI.view.value = { zoom: z, pan: { x: m.x - anchor.x * z, y: m.y - anchor.y * z } };
      return;
    }
    if (navDead) return;
    const w = world(e);
    UI.cursor.value = w;
    const d = UI.drag.value;
    if (!d) { UI.hover.value = hitTest(doc.value, hitCtx(scaleOf(e)), w); return; }
    if (d.pointerId !== e.pointerId || !dragTool) return;
    if (!d.moved && dist(w, d.start) > CONFIG.DRAG_THRESHOLD_PX / UI.view.value.zoom) { d.moved = true; beginGesture(); }
    dragTool.onMove(d, w, e, ctxOf(e));
    if (UI.drag.value) UI.drag.value = { ...UI.drag.value };   // republish so components see mutated fields
  }

  function onUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (nav) { if (pointers.size < 2) nav = null; if (pointers.size === 0) navDead = false; return; }
    if (pointers.size === 0) navDead = false;
    const d = UI.drag.value;
    if (!d || d.pointerId !== e.pointerId || !dragTool) return;
    const t = dragTool;
    UI.drag.value = null; dragTool = null;
    endGesture();
    t.onUp(d, world(e), e, ctxOf(e));
    UI.hover.value = hitTest(doc.value, hitCtx(scaleOf(e)), world(e));
  }

  function onCancel(e?: PointerEvent) {
    if (e) pointers.delete(e.pointerId); else pointers.clear();
    if (!pointers.size) { nav = null; navDead = false; }
    if (UI.drag.value) { UI.drag.value = null; dragTool = null; endGesture(); UI.fillPreview.value = null; }
  }

  function onDblClick(e: MouseEvent) {
    const w = world(e as unknown as PointerEvent), t = hitTest(doc.value, hitCtx(1), w);
    if (t && t.kind === 'diamond') A.straightenSegment(t.pathId, t.j);
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) A.zoomAt(screen(e), Math.exp(-e.deltaY * 0.01));
    else A.panBy(-e.deltaX, -e.deltaY);
  }

  function onKeyDown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement | null)?.tagName ?? '';
    if (/input|textarea|select/i.test(tag)) return;
    const meta = e.metaKey || e.ctrlKey, k = e.key;
    if (e.code === 'Space') { e.preventDefault(); UI.space.value = true; return; }
    if (k === 'Tab') { e.preventDefault(); A.setLayer(UI.layer.value === 'drawing' ? 'construction' : 'drawing'); return; }
    if (meta && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) A.redo(); else A.undo(); return; }
    if (meta && (k === 'y' || k === 'Y')) { e.preventDefault(); A.redo(); return; }
    if (meta && k === '0') { e.preventDefault(); A.fitToTile(); return; }
    if (meta) return;
    switch (k) {
      case 'Escape': if (UI.pen.value) A.endPen(); else UI.selection.value = null; return;
      case 'Enter': A.endPen(); return;
      case 'Backspace': case 'Delete': e.preventDefault(); A.deleteHoveredOrSelection(); return;
      case '[': A.rotateSelectedElement(-15); return;
      case ']': A.rotateSelectedElement(15); return;
      case '?': A.toggleHelp(); return;
      default:
    }
    switch (k.toLowerCase()) {
      case 'v': A.setTool('select'); break;
      case 'p': A.setTool('pen'); break;
      case 'f': A.setTool(UI.tool.value === 'freehand' ? 'pen' : 'freehand'); break;
      case 'b': A.setTool('fill'); break;
      case 'o': A.addElement('rotate'); break;
      case 'm': A.addElement('mirror'); break;
      case 't': A.addElement('translate'); break;
      case 'g': A.toggleSnap(); break;
      default:
    }
  }
  function onKeyUp(e: KeyboardEvent) { if (e.code === 'Space') UI.space.value = false; }
  const swallow = (e: Event) => e.preventDefault();
  const blur = () => onCancel();

  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onCancel);
  svg.addEventListener('dblclick', onDblClick);
  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('contextmenu', swallow);
  for (const g of ['gesturestart', 'gesturechange', 'gestureend']) svg.addEventListener(g, swallow);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', blur);
  return () => {
    svg.removeEventListener('pointerdown', onDown); svg.removeEventListener('pointermove', onMove); svg.removeEventListener('pointerup', onUp);
    svg.removeEventListener('pointercancel', onCancel); svg.removeEventListener('dblclick', onDblClick); svg.removeEventListener('wheel', onWheel);
    svg.removeEventListener('contextmenu', swallow); for (const g of ['gesturestart', 'gesturechange', 'gestureend']) svg.removeEventListener(g, swallow);
    window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', blur);
  };
}
```

- [ ] **Step 7: Attach the handlers in `Canvas.tsx`**

Add to the imports `import { useEffect } from 'preact/hooks';` and `import { attachPointer } from '../interaction/pointer';`, and inside `Canvas()` before the `return`:

```tsx
  useEffect(() => attachPointer(ref.current!), []);
```

- [ ] **Step 8: Write `tests/unit/actions.test.ts`**

```ts
import { test, expect } from 'vitest';
import { doc, draft, emptyDoc } from '../../src/state/doc';
import * as UI from '../../src/state/ui';
import * as A from '../../src/actions';
import * as P from '../../src/engine/paths';
import { reset, canUndo, commit, beginGesture, endGesture } from '../../src/state/history';
import { faces, copyMatrix } from '../../src/state/derived';
import { apply, invert } from '../../src/engine/transform';
import { CONFIG } from '../../src/config';

function fresh() { reset(); UI.resetUi(); doc.value = emptyDoc(); UI.viewport.value = { width: 800, height: 600 }; UI.prefs.value = { ...UI.prefs.value, snap: false }; }
const W = (u: number, v: number) => ({ x: u * 240, y: v * 240 });

test('pen: empty clicks build a path, clicking the last node ends it, short paths are discarded', () => {
  fresh();
  A.penClickEmpty(W(0.1, 0.1), false); expect(UI.pen.value).toBeTruthy();
  A.penClickEmpty(W(0.4, 0.1), false);
  const path = doc.value.paths[0];
  expect(path.segments).toHaveLength(1);
  A.penClickNode(path.segments[0].to);
  expect(UI.pen.value).toBe(null);
  A.penClickEmpty(W(0.8, 0.8), false); A.endPen();
  expect(doc.value.paths).toHaveLength(1);
  expect(doc.value.points).toHaveLength(2);
});

test('pen: new paths receive newPathOps; clicking an open end resumes and reverses', () => {
  fresh();
  A.addElement('rotate'); expect(UI.layer.value).toBe('construction');
  A.setTool('pen'); expect(UI.layer.value).toBe('drawing');
  A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.4, 0.1), false); A.endPen();
  expect(doc.value.bindings).toHaveLength(1);
  const path = doc.value.paths[0], first = path.start.pointId;
  A.penClickNode(path.start);
  expect(UI.pen.value?.pathId).toBe(path.id);
  expect(doc.value.paths[0].segments[0].to.pointId).toBe(first);
});

test('addElement binds the selected path; deleteElement drops bindings and chains', () => {
  fresh();
  A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.4, 0.1), false); A.endPen();
  A.selectPathAt(doc.value.paths[0].id);
  A.addElement('mirror');
  const el = doc.value.elements[0];
  expect(doc.value.bindings[0].ops).toEqual([el.id]);
  A.deleteElement(el.id);
  expect(doc.value.bindings).toHaveLength(0); expect(doc.value.newPathOps).toHaveLength(0); expect(UI.selection.value).toBe(null);
});

test('fillAt seeds at the centroid, recolours on a second click, and maps neighbour cells to the same region', () => {
  fresh();
  for (const p of [W(0.25, 0.25), W(0.75, 0.25), W(0.75, 0.75), W(0.25, 0.75)]) A.penClickEmpty(p, false);
  A.penClickNode(doc.value.paths[0].start); A.endPen();
  A.setTool('fill');
  expect(faces.value).toHaveLength(9);
  expect(A.fillAt(W(0.05, 0.05))).toBe(false);
  expect(A.fillAt(W(0.3, 0.3))).toBe(true);
  expect(doc.value.fills[0].u).toBeCloseTo(0.5, 6); expect(doc.value.fills[0].v).toBeCloseTo(0.5, 6);
  UI.prefs.value = { ...UI.prefs.value, fillColor: '#123456' };
  A.fillAt(W(0.6, 0.6));
  expect(doc.value.fills).toHaveLength(1); expect(doc.value.fills[0].color).toBe('#123456');
  expect(A.fillAt(W(1.5, 0.5))).toBe(true); expect(doc.value.fills).toHaveLength(1);
});

test('editing through a copy in cell (1,0) and through a clone moves the source', () => {
  fresh();
  A.addElement('rotate'); A.setTool('pen');
  A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.4, 0.1), false); A.endPen();
  const path = doc.value.paths[0], pid = path.start.pointId, b = doc.value.bindings[0];
  // a drag of the point through its copy in cell (1,0): pointer at world (1.2, 0.2) → point becomes (0.2, 0.2)
  A.mutate((d) => { const uv = A.uvOf(W(1.2, 0.2)); P.movePoint(d, pid, uv.u - 1, uv.v - 0); });
  expect(P.getPoint(doc.value, pid)!.u).toBeCloseTo(0.2, 9); expect(P.getPoint(doc.value, pid)!.v).toBeCloseTo(0.2, 9);
  // through the clone: pointer at the clone's image of (0.3, 0.3) → source becomes (0.3, 0.3)
  const M = copyMatrix({ cell: { c: 0, r: 0 }, bindingId: b.id, power: 1 });
  const src = apply(invert(M), apply(M, W(0.3, 0.3)));
  A.mutate((d) => { const uv = A.uvOf(src); P.movePoint(d, pid, uv.u, uv.v); });
  expect(P.getPoint(doc.value, pid)!.u).toBeCloseTo(0.3, 9);
});

test('insertNodeOnSegment through a clone copy maps the click back to the source segment', () => {
  fresh();
  A.addElement('rotate'); A.setTool('pen');
  A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.5, 0.1), false); A.endPen();
  const path = doc.value.paths[0], b = doc.value.bindings[0];
  const copy = { cell: { c: 0, r: 0 }, bindingId: b.id, power: 1 };
  const clickOnClone = apply(copyMatrix(copy), W(0.3, 0.1));
  expect(A.insertNodeOnSegment(path.id, 0, clickOnClone, copy, false)).toBe(true);
  const mid = P.nodeUVAbs(doc.value, doc.value.paths[0].segments[0].to);
  expect(mid.u).toBeCloseTo(0.3, 6); expect(mid.v).toBeCloseTo(0.1, 6);
});

test('finishFreehand creates a bound path and rejects a jitter', () => {
  fresh();
  A.addElement('rotate'); A.setTool('freehand');
  const base = { target: null, start: { x: 0, y: 0 }, moved: true, pointerId: 1, hitScale: 1, kind: 'free' as const, startNode: null, cloneMatrices: [] };
  expect(A.finishFreehand({ ...base, raw: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })).toBe(false);
  const raw = Array.from({ length: 30 }, (_, i) => ({ x: 20 + i * 5, y: 40 + 30 * Math.sin(i / 5) }));
  expect(A.finishFreehand({ ...base, raw })).toBe(true);
  expect(doc.value.paths).toHaveLength(1); expect(doc.value.bindings).toHaveLength(1);
  expect(doc.value.paths[0].segments.length).toBeGreaterThan(0);
});

test('zoomAt keeps the point under the cursor fixed and never enters history', () => {
  fresh();
  UI.view.value = { pan: { x: 100, y: 50 }, zoom: 1 };
  A.zoomAt({ x: 300, y: 200 }, 2);
  expect(UI.view.value.zoom).toBe(2); expect(UI.view.value.pan.x).toBe(300 - (300 - 100) * 2);
  A.zoomAt({ x: 0, y: 0 }, 1000); expect(UI.view.value.zoom).toBe(CONFIG.ZOOM_MAX);
  expect(canUndo()).toBe(false);
});

test('a gesture of many mutate() calls is one undo step', () => {
  fresh();
  A.penClickEmpty(W(0.1, 0.1), false); A.penClickEmpty(W(0.4, 0.1), false); A.endPen();
  const pid = doc.value.paths[0].start.pointId;
  beginGesture();
  for (let i = 1; i <= 5; i++) A.mutate((d) => { P.movePoint(d, pid, 0.1 + i * 0.01, 0.1); });
  endGesture();
  expect(P.getPoint(doc.value, pid)!.u).toBeCloseTo(0.15, 9);
  A.undo();
  expect(P.getPoint(doc.value, pid)!.u).toBeCloseTo(0.1, 9);
});
```

- [ ] **Step 9: Run tests, typecheck, and verify in the browser**

Run: `npm test` and `npx tsc --noEmit` → pass, clean.

Open `http://127.0.0.1:5173/` and check, with no console errors:
1. `O` then `P`. Click four spots: the rubber band follows; the 180° clone appears live; ghosts in every cell. `Enter` ends.
2. Click the first point of that path: it resumes from that end. `Esc`.
3. `V`, click a segment: halo, diamonds, bounding box. Click the same segment again: a node is inserted. Drag a diamond: the segment bends and its clone bends. Double-click the diamond: straight.
4. **Click the ghost in the cell to the right.** The halo appears there, the handles appear there. Drag one of its points: the source and every copy move; the handles stay in the right-hand cell. Click a clone: same at the clone.
5. Drag a clone's body: the rotation centre moves so the clone follows the pointer.
6. Marquee three points, drag them together. Drag a bbox corner: uniform scale; `⇧`-drag: free; drag the knob: rotate, 15° steps.
7. `⌘Z` undoes each gesture as one step; `⇧⌘Z` redoes.
8. Wheel pans; `⌘`+wheel zooms about the cursor; `⌘0` fits.
9. In Chrome DevTools, toggle device emulation with touch, put two fingers down: pan and pinch work; start a one-finger drag on a point, add a second finger: the point snaps back, navigation takes over.
10. Hover a point and press `⌫`: deleted.

- [ ] **Step 10: Commit**

```bash
git add src/actions.ts src/interaction src/components/Canvas.tsx tests/unit/actions.test.ts
git commit -m "Add actions, pointer core with two-pointer navigation, Select and Pen tools

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Construction layer tool

**Files:**
- Modify: `src/interaction/tools/construct.ts` (replace the whole file)

**Interfaces:**
- `startMultiDrag(w, target, e)`, `onDown`, `onMove`, `onUp` for `element`, `elrot`, `eltip`, `lat` and background targets.

- [ ] **Step 1: Replace `src/interaction/tools/construct.ts`**

```ts
// Construction layer: drag elements, rotate mirrors, set translation vectors, drag lattice handles.
import { doc } from '../../state/doc';
import * as UI from '../../state/ui';
import * as A from '../../actions';
import * as P from '../../engine/paths';
import { toUV, isDegenerate } from '../../engine/lattice';
import { mirrorDirFromAngle } from '../../engine/transform';
import { CONFIG } from '../../config';
import { startDrag, snapElement, type ToolModule } from './common';
import type { HitTarget, XY, Element } from '../../types';

export function startMultiDrag(w: XY, t: HitTarget | null, e: PointerEvent): void {
  const d = doc.value, pn = UI.pen.value;
  const ids = pn ? d.bindings.filter((b) => b.pathId === pn.pathId).map((b) => b.ops[0]).filter(Boolean) : d.newPathOps.map((c) => c[0]).filter(Boolean);
  startDrag(e, t, w, e.pointerType === 'touch' ? CONFIG.TOUCH_HIT_SCALE : 1, { kind: 'elmulti', ids: [...new Set(ids)], startEls: d.elements.map((x) => ({ ...x })) });
}

export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => {
  if (!t) { startDrag(e, null, w, ctx.hitScale, { kind: 'click' }); UI.selection.value = null; return; }
  switch (t.kind) {
    case 'element': { const el = P.getElement(doc.value, t.elementId); if (!el) return; startDrag(e, t, w, ctx.hitScale, { kind: 'elc', id: el.id, u0: el.u, v0: el.v }); return; }
    case 'elrot': startDrag(e, t, w, ctx.hitScale, { kind: 'elrot', id: t.elementId }); return;
    case 'eltip': startDrag(e, t, w, ctx.hitScale, { kind: 'eltip', id: t.elementId }); return;
    case 'lat': startDrag(e, t, w, ctx.hitScale, { kind: 'lat', which: t.which }); return;
    default: startDrag(e, t, w, ctx.hitScale, { kind: 'click' });
  }
};

const twelfths = (x: number) => Math.round(x * 12) / 12;

export const onMove: ToolModule['onMove'] = (d, w, e, ctx) => {
  if (!d.moved) return;
  switch (d.kind) {
    case 'elc': {
      const lat = doc.value.lattice, delta = toUV({ x: w.x - d.start.x, y: w.y - d.start.y }, lat);
      const target = { u: d.u0 + delta.u, v: d.v0 + delta.v };
      const uv = snapElement(A.worldOf(target), ctx.snapOn, ctx.hitScale);
      A.mutate((dd) => { const el = P.getElement(dd, d.id); if (!el) return false; el.u = uv.u; el.v = uv.v; });
      return;
    }
    case 'elrot': {
      A.mutate((dd) => {
        const el = P.getElement(dd, d.id); if (!el || el.kind !== 'mirror') return false;
        const c = A.worldOf(el);
        let ang = (Math.atan2(w.y - c.y, w.x - c.x) * 180) / Math.PI;
        if (ctx.snapOn) ang = Math.round(ang / 15) * 15;
        const dir = mirrorDirFromAngle(ang, dd.lattice); el.du = dir.du; el.dv = dir.dv;
      });
      return;
    }
    case 'eltip': {
      A.mutate((dd) => {
        const el = P.getElement(dd, d.id); if (!el || el.kind !== 'translate') return false;
        let { u, v } = toUV(w, dd.lattice);
        if (ctx.snapOn) { u = twelfths(u); v = twelfths(v); }
        el.u = u; el.v = v;
      });
      return;
    }
    case 'lat': {
      let x = w.x, y = w.y;
      if (ctx.snapOn) { const len = Math.max(40, Math.round(Math.hypot(x, y) / 10) * 10), ang = Math.round(Math.atan2(y, x) / (Math.PI / 12)) * (Math.PI / 12); x = len * Math.cos(ang); y = len * Math.sin(ang); }
      const nl = { ...doc.value.lattice };
      if (d.which === 'a') { nl.ax = x; nl.ay = y; } else { nl.bx = x; nl.by = y; }
      if (isDegenerate(nl, CONFIG.MIN_LATTICE_DET)) return;
      A.mutate((dd) => { dd.lattice = nl; });
      return;
    }
    case 'elmulti': {
      const dv = A.snapDeltaUV({ x: w.x - d.start.x, y: w.y - d.start.y }, ctx.snapOn);
      A.mutate((dd) => {
        for (const id of d.ids) {
          const x = P.getElement(dd, id), s = d.startEls.find((z) => z.id === id) as Element | undefined;
          if (!x || !s || x.kind === 'translate') continue;
          x.u = s.u + dv.u; x.v = s.v + dv.v;
        }
      });
      return;
    }
    default:
  }
};

export const onUp: ToolModule['onUp'] = (d) => {
  if (d.moved || !d.target) return;
  if (d.target.kind === 'element' || d.target.kind === 'elrot' || d.target.kind === 'eltip') A.selectElement(d.target.elementId);
};
```

- [ ] **Step 2: Verify in the browser**

On `http://127.0.0.1:5173/`, no console errors:
1. `O`, `M`, `T`: a rotation mark with "2", a dashed mirror along `b` through the cell centre, and an arrow to the half-cell diagonal; each selected as added.
2. Drag the rotation mark: snaps to grid and twelfths; `⇧` frees it.
3. Click the mirror: a knob appears along the line. Drag the knob: rotates in 15° steps. `[` / `]` rotate too.
4. Drag the translation diamond: the tip snaps to twelfths.
5. Drag the pink `a` handle: the cell skews and the whole drawing, elements included, deforms with it. Try to drag `b` onto `a`: the drag stops before the lattice collapses.
6. `Tab` to Drawing, draw a path (cloned through all three chains), `Tab` back, drag the mirror: every clone through it follows.
7. While drawing with the Pen, hold `Space` and drag on empty canvas: the elements that clone the pen path move together.

- [ ] **Step 3: Commit**

```bash
git add src/interaction/tools/construct.ts
git commit -m "Add construction-layer drags for elements and lattice

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 10: Freehand and Fill tools

**Files:**
- Modify: `src/interaction/tools/freehand.ts`, `src/interaction/tools/fill.ts` (replace both)

**Interfaces:**
- Freehand: a `free` drag accumulates `raw` world points from the first press; `cloneMatrices` for the live ghost preview come from the path being extended or from `newPathOps`.
- Fill: a `fillpress` drag sets `UI.fillPreview` while held (the canvas tints the region under it) and calls `fillAt` on release.

- [ ] **Step 1: Replace `src/interaction/tools/freehand.ts`**

```ts
// Freehand: press and drag; the stroke is fitted on release (actions.finishFreehand).
import { doc } from '../../state/doc';
import * as A from '../../actions';
import * as P from '../../engine/paths';
import { orbit } from '../../engine/transform';
import { CONFIG } from '../../config';
import { startDrag, type ToolModule } from './common';
import type { Node, Matrix } from '../../types';

// Ghost the stroke through the extended path's bindings, else through the chains new paths receive.
function previewMatrices(startNode: Node | null): Matrix[] {
  const d = doc.value;
  const extendId = startNode ? P.openEndAt(d, startNode.pointId) : null;
  const chains = extendId ? d.bindings.filter((b) => b.pathId === extendId).map((b) => b.ops) : d.newPathOps;
  return chains.flatMap((ops) => orbit(ops, d.elements, d.lattice, CONFIG.ORBIT_CAP).matrices);
}

export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => {
  let startNode: Node | null = null, start = w;
  if (t && t.kind === 'point') { startNode = { pointId: t.pointId, cell: t.cell }; start = P.nodeWorld(doc.value, startNode); }
  startDrag(e, t, start, ctx.hitScale, { kind: 'free', raw: [{ x: start.x, y: start.y }], startNode, cloneMatrices: previewMatrices(startNode) });
};

export const onMove: ToolModule['onMove'] = (d, w) => {
  if (d.kind !== 'free') return;
  const last = d.raw[d.raw.length - 1];
  if (Math.hypot(w.x - last.x, w.y - last.y) < 1.5) return;
  d.raw.push({ x: w.x, y: w.y });
};

export const onUp: ToolModule['onUp'] = (d) => { if (d.kind === 'free') A.finishFreehand(d); };
```

- [ ] **Step 2: Replace `src/interaction/tools/fill.ts`**

```ts
// Fill: press to preview the region under the pointer, release to seed or recolour it.
import * as UI from '../../state/ui';
import * as A from '../../actions';
import { startDrag, type ToolModule } from './common';

export const onDown: ToolModule['onDown'] = (t, w, e, ctx) => {
  startDrag(e, t, w, ctx.hitScale, { kind: 'fillpress' });
  UI.fillPreview.value = w;
};

export const onMove: ToolModule['onMove'] = (d, w) => { if (d.kind === 'fillpress') UI.fillPreview.value = w; };

export const onUp: ToolModule['onUp'] = (d, w) => {
  UI.fillPreview.value = null;
  if (d.kind === 'fillpress') A.fillAt(w);
};
```

- [ ] **Step 3: Verify in the browser**

On `http://127.0.0.1:5173/`, no console errors:
1. `O`, then `F`. Press and drag a wavy stroke on empty canvas: the live preview shows the stroke plus its 180° ghost and cell ghosts. Release: a fitted path with curved segments, cloned through the rotation.
2. Start a freehand stroke on the open end of that path: on release the path is extended.
3. Draw a closed loop with the Pen (click back on the first point, then `Enter`). Press `B`. Move over the loop: the region tints in every cell. Press inside and, without releasing, move outside: the tint disappears; move back in and release: the region fills with the current colour. Click the fill again with `B`: it recolours to the current colour (change the colour first from the palette once Task 11 lands, or via `prefs` in the console).
4. `V`, click the fill: selected; `⌫` removes it.

- [ ] **Step 4: Commit**

```bash
git add src/interaction/tools/freehand.ts src/interaction/tools/fill.ts
git commit -m "Add Freehand and press-to-preview Fill tools

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Chrome — bars, palette, undo, hint, help with settings

**Files:**
- Create: `src/components/Chrome.tsx`
- Modify: `src/components/App.tsx`

**Interfaces:**
- `<Chrome />` renders the floating panels from signals. Exports `elementLabel(el)` and `chainLabel(ops)` for Task 12's file group and tests. All controls are `<button>`s calling `actions.ts`.

- [ ] **Step 1: Create `src/components/Chrome.tsx`**

```tsx
import type { ComponentChildren } from 'preact';
import { doc } from '../state/doc';
import * as UI from '../state/ui';
import * as A from '../actions';
import { canUndo, canRedo, historyVersion } from '../state/history';
import { cloneMatrices, openElements } from '../state/derived';
import { orbit, mirrorAngle } from '../engine/transform';
import { latticeAngle } from '../engine/lattice';
import { getPath, getBinding, getElement, getFill } from '../engine/paths';
import { CONFIG } from '../config';
import { fmtFrac } from './Canvas';
import type { Element, Binding, Lattice } from '../types';

const SYMBOL = { rotate: '↻', mirror: '⟋', translate: '⇢' } as const;
export function elementLabel(el: Element): string { return `${SYMBOL[el.kind]}${doc.value.elements.indexOf(el) + 1}`; }
export function chainLabel(ops: string[]): string { return ops.map((id) => { const e = getElement(doc.value, id); return e ? elementLabel(e) : '?'; }).join(' → ') || '(empty chain)'; }
const orbitOf = (ops: string[]) => orbit(ops, doc.value.elements, doc.value.lattice, CONFIG.ORBIT_CAP);

type BtnProps = { on?: boolean; cls?: string; kbd?: string; title?: string; disabled?: boolean; onClick: () => void; children: ComponentChildren };
function Btn({ on, cls = '', kbd, title, disabled, onClick, children }: BtnProps) {
  return <button class={`btn ${cls}${on ? ' on' : ''}`} title={title ?? ''} disabled={disabled} onClick={onClick}>{children}{kbd && <> <span class="kbd">{kbd}</span></>}</button>;
}
const Sep = () => <span class="sep" />;
const Label = ({ children }: { children: ComponentChildren }) => <span class="label">{children}</span>;

function latticeFits(n: number, lat: Lattice): boolean {
  const equal = Math.abs(Math.hypot(lat.ax, lat.ay) - Math.hypot(lat.bx, lat.by)) < 1, ang = latticeAngle(lat);
  if (n === 2) return true;
  if (n === 4) return equal && Math.abs(ang - 90) < 1;
  if (n === 3 || n === 6) return equal && (Math.abs(ang - 60) < 1 || Math.abs(ang - 120) < 1);
  return false;
}

function LayerBar() {
  const cons = UI.layer.value === 'construction';
  return <div class="panel">
    <Btn on={!cons} title="Drawing layer: paths, points, fills (Tab)" onClick={() => A.setLayer('drawing')}>✎ Drawing</Btn>
    <Btn on={cons} cls="violet" title="Construction layer: elements and lattice (Tab)" onClick={() => A.setLayer('construction')}>⟋ Construction</Btn>
  </div>;
}

function ToolBar() {
  const t = UI.tool.value, p = UI.prefs.value;
  return <div class="panel">
    <Btn on={t === 'select'} kbd="V" title="Select (V)" onClick={() => A.setTool('select')}>↖ Select</Btn>
    <Btn on={t === 'pen'} kbd="P" title="Pen (P)" onClick={() => A.setTool('pen')}>✎ Pen</Btn>
    <Btn on={t === 'freehand'} kbd="F" title="Freehand (F)" onClick={() => A.setTool('freehand')}>〰 Freehand</Btn>
    <Btn on={t === 'fill'} kbd="B" title="Fill (B)" onClick={() => A.setTool('fill')}>◐ Fill</Btn>
    <Sep />
    <Btn on={UI.sublayer.value === 'structure'} cls="small" title="New paths go below fills" onClick={() => A.setSublayer('structure')}>Structure</Btn>
    <Btn on={UI.sublayer.value === 'detail'} cls="small" title="New paths go above fills" onClick={() => A.setSublayer('detail')}>Detail</Btn>
    <Sep />
    <Btn on={p.snap} cls="small" kbd="G" title="Grid snapping (G); hold Shift to invert" onClick={() => A.toggleSnap()}>⌗ Snap</Btn>
  </div>;
}

function ElementsBar() {
  const d = doc.value, open = openElements.value;
  return <div class="panel bar">
    <Label>Elements</Label>
    <Btn cls="violet" kbd="O" title="Add a rotation (1/n turn). New paths are cloned through it." onClick={() => A.addElement('rotate')}>+ ↻ Rotation</Btn>
    <Btn cls="violet" kbd="M" title="Add a mirror line." onClick={() => A.addElement('mirror')}>+ ⟋ Mirror</Btn>
    <Btn cls="violet" kbd="T" title="Add a translation by a fraction of the lattice." onClick={() => A.addElement('translate')}>+ ⇢ Translate</Btn>
    {d.elements.map((e) => <Btn key={e.id} cls="small violet" on={A.isNewPathChain([e.id])} title={A.isNewPathChain([e.id]) ? 'Applies to new paths · click to select' : 'Click to select'} onClick={() => A.selectElement(e.id)}>{elementLabel(e)}{open.has(e.id) ? ' ⚠' : ''}</Btn>)}
    {d.elements.length > 0 && <Label>filled = applies to new paths</Label>}
    {open.size > 0 && <Label>⚠ an element does not close on this lattice</Label>}
  </div>;
}

function PresetIcon({ p }: { p: Lattice }) {
  const pts = [[0, 0], [p.ax, p.ay], [p.ax + p.bx, p.ay + p.by], [p.bx, p.by]].map(([x, y]) => `${10 + ((x + 120) / 480) * 40},${8 + ((y + 20) / 240) * 22}`).join(' ');
  return <svg width="34" height="22" viewBox="0 0 60 36"><polygon points={pts} fill="none" stroke="currentColor" stroke-width="2" /></svg>;
}

function LatticeBar() {
  const l = doc.value.lattice;
  const isOn = (p: Lattice) => (['ax', 'ay', 'bx', 'by'] as const).every((k) => Math.abs(p[k] - l[k]) < 0.5);
  return <div class="panel bar">
    <Label>▱ Lattice</Label>
    {Object.entries(CONFIG.LATTICE_PRESETS).map(([name, p]) => <Btn key={name} cls="small preset" on={isOn(p)} title={name} onClick={() => A.setLattice(p)}><PresetIcon p={p} />{name}</Btn>)}
    <Label>a {Math.round(Math.hypot(l.ax, l.ay))} · b {Math.round(Math.hypot(l.bx, l.by))} · {Math.round(latticeAngle(l))}° · drag the pink a / b handles</Label>
  </div>;
}

function ChainRow({ b }: { b: Binding }) {
  const d = doc.value, n = orbitOf(b.ops).matrices.length;
  return <>
    <Label>{chainLabel(b.ops)} · {n} clone{n === 1 ? '' : 's'}</Label>
    {d.elements.map((e) => <Btn key={e.id} cls="small violet" on={b.ops.includes(e.id)} title="Toggle this element in the chain (click order = apply order)" onClick={() => A.toggleOpOnBinding(b.id, e.id)}>{elementLabel(e)}</Btn>)}
    <Btn cls="small" on={A.isNewPathChain(b.ops)} title="Apply this chain to new paths" onClick={() => A.toggleNewPathChain(b.ops)}>★</Btn>
    <Btn cls="small" title="Remove this chain" onClick={() => A.removeBinding(b.id)}>✕</Btn>
    <Sep />
  </>;
}

function SelectionBar() {
  const s = UI.selection.value, d = doc.value;
  if (!s || s.kind === 'points') return null;
  let inner: ComponentChildren = null;
  if (s.kind === 'path') {
    const path = getPath(d, s.id); if (!path) return null;
    const b = s.copy.bindingId ? getBinding(d, s.copy.bindingId) : null;
    inner = <>
      <Label>{b ? `Clone of path ${d.paths.indexOf(path) + 1} via ${chainLabel(b.ops)} · power ${s.copy.power}` : `Path ${d.paths.indexOf(path) + 1}`}</Label>
      {b && <Btn cls="small violet" onClick={() => { if (b.ops[0]) { A.selectElement(b.ops[0]); UI.layer.value = 'construction'; } }}>Select its element</Btn>}
      {b && <Btn cls="small outline" onClick={() => A.selectPathAt(path.id)}>Select source path</Btn>}
      {d.bindings.filter((x) => x.pathId === path.id).map((x) => <ChainRow key={x.id} b={x} />)}
      <Btn cls="small outline" title="Start an empty chain; click element chips to fill it" onClick={() => A.addChain(path.id)}>+ chain</Btn>
      <Btn cls="small violet" title="New rotation cloning this path" onClick={() => A.addElement('rotate')}>+ ↻</Btn>
      <Btn cls="small violet" title="New mirror cloning this path" onClick={() => A.addElement('mirror')}>+ ⟋</Btn>
      <Btn cls="small violet" title="New translation cloning this path" onClick={() => A.addElement('translate')}>+ ⇢</Btn>
      <Sep />
      <Btn cls="small outline" title="Structure paths sit below fills, detail paths above" onClick={() => A.togglePathLayer(path.id)}>{path.layer === 'detail' ? 'Above fills' : 'Below fills'}</Btn>
    </>;
  } else if (s.kind === 'element') {
    const el = getElement(d, s.id); if (!el) return null;
    const bound = d.bindings.filter((x) => x.ops.includes(el.id)).length;
    const name = { rotate: 'Rotation', mirror: 'Mirror', translate: 'Translation' }[el.kind];
    inner = <>
      <Label>{name} {elementLabel(el)}</Label>
      <Btn cls="small violet" on={A.isNewPathChain([el.id])} title="Clone every new path through this element" onClick={() => A.toggleNewPathChain([el.id])}>Apply to new paths</Btn>
      <Sep />
      {el.kind === 'rotate' && <>{[2, 3, 4, 6].map((n) => <Btn key={n} cls="small outline" on={el.n === n} title={`${n}-fold rotation`} onClick={() => A.setRotationOrder(el.id, n)}>1/{n}</Btn>)}{!latticeFits(el.n, d.lattice) && <Label>⚠ 1/{el.n} does not tile on this lattice</Label>}</>}
      {el.kind === 'mirror' && <><Btn cls="small outline" title="Rotate −15° ([)" onClick={() => A.rotateMirror(el.id, -15)}>↺</Btn><Btn cls="small outline" title="Rotate +15° (])" onClick={() => A.rotateMirror(el.id, 15)}>↻</Btn><Label>{Math.round(mirrorAngle(el, d.lattice))}°</Label></>}
      {el.kind === 'translate' && <><Label>({fmtFrac(el.u)}, {fmtFrac(el.v)})</Label>{([['½ a', 0.5, 0], ['⅓ a', 1 / 3, 0], ['½ b', 0, 0.5], ['½ a+b', 0.5, 0.5]] as const).map(([t, u, v]) => <Btn key={t} cls="small outline" on={Math.abs(el.u - u) < 1e-9 && Math.abs(el.v - v) < 1e-9} title="Set the translation vector" onClick={() => A.setTranslation(el.id, u, v)}>{t}</Btn>)}</>}
      <Label>{bound ? `· in ${bound} chain${bound > 1 ? 's' : ''}` : '· no paths yet'}</Label>
    </>;
  } else if (s.kind === 'fill') {
    inner = <Label>Fill · pick a colour in the palette</Label>;
  }
  return <div class="panel bar">{inner}<Sep /><Btn cls="small outline" kbd="⌫" onClick={() => A.deleteSelection()}>{s.kind === 'path' && s.copy.bindingId ? 'Unlink' : 'Delete'}</Btn></div>;
}

function Palette() {
  const d = doc.value, p = UI.prefs.value, s = UI.selection.value;
  const fillSel = s && s.kind === 'fill' ? getFill(d, s.id) : null;
  const fillMode = UI.tool.value === 'fill' || !!fillSel;
  const pid = UI.selectedPathId(), path = pid ? getPath(d, pid) : null;
  const sty = path ? path.style : p.style;
  const cur = fillMode ? (fillSel ? fillSel.color : p.fillColor) : sty.color;
  return <div class="panel palette">
    <span class="title">{fillMode ? 'Fill' : path ? 'Path' : 'Stroke'}</span>
    <div class="grid">{CONFIG.SWATCHES.map(([name, c]) => <button key={c} class={`swatch${cur === c ? ' on' : ''}`} title={name} onClick={() => (fillMode ? A.setFillColor(c) : A.setStyle({ color: c }))}><span style={{ background: c }} /></button>)}</div>
    {!fillMode && <><span class="rule" /><div class="row">{CONFIG.WEIGHTS.map((w) => <button key={w} class={`weight${sty.weight === w ? ' on' : ''}`} title={`${w}px`} onClick={() => A.setStyle({ weight: w })}><span style={{ height: `${Math.max(1.5, w)}px`, background: sty.color }} /></button>)}</div></>}
  </div>;
}

function UndoBar() {
  historyVersion.value;
  return <div class="panel">
    <Btn cls="icon" title="Undo (⌘Z)" disabled={!canUndo()} onClick={() => A.undo()}>↶</Btn>
    <Btn cls="icon" title="Redo (⇧⌘Z)" disabled={!canRedo()} onClick={() => A.redo()}>↷</Btn>
  </div>;
}

function hintText(): string {
  const s = UI.selection.value, d = doc.value;
  if (UI.layer.value === 'construction') {
    if (s && s.kind === 'element') {
      const el = getElement(d, s.id);
      if (el?.kind === 'rotate') return 'Rotation: drag to move · pick 1/2, 1/3, 1/4 or 1/6 · clones turn about it';
      if (el?.kind === 'mirror') return 'Mirror: drag to move · knob or [ ] rotates · put a translation after it in a chain for a glide';
      return 'Translation: drag the diamond to set the vector · snaps to twelfths of the lattice';
    }
    return 'Construction layer: add or drag elements and lattice handles · the drawing is locked · Tab to go back';
  }
  switch (UI.tool.value) {
    case 'select':
      if (s && s.kind === 'points') return `${s.ids.length} point${s.ids.length > 1 ? 's' : ''} selected · drag to move together · ⇧-click adds · ⌫ deletes`;
      if (s && s.kind === 'path' && s.copy.bindingId) return 'Clone: drag its body to move its element · drag its anchors to edit the shared shape';
      if (s && s.kind === 'path') return 'Path: click a line to insert a point · drag ◇ to bend · double-click ◇ to straighten · box handles scale and rotate · any copy is editable';
      return 'Select: click a point, line, copy or fill · drag a line to move the path · drag empty space to marquee points';
    case 'freehand': return 'Freehand: press and drag · release to fit curves · start on a point to continue its path';
    case 'fill': return 'Fill: press to preview a closed region · release to colour it · press again to recolour';
    default:
      if (UI.pen.value) return 'Pen: click to add · click a point or clone anchor to connect · click the last point, Esc or ↵ to finish · Space+drag moves the elements';
      if (!d.points.length && !d.elements.length) return 'Add an element (O rotation, M mirror, T translation), then draw — every stroke is cloned through it in every cell';
      return 'Pen: click a point to start or resume a path · click empty space to add a point';
  }
}

function Hint() {
  const d = doc.value, cm = cloneMatrices.value;
  const clones = [...cm.values()].reduce((n, ms) => n + ms.length, 0);
  const pl = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const saved = UI.lastSavedAt.value && Date.now() - UI.lastSavedAt.value < 1500 ? ' · saved' : '';
  return <div class="hint"><span class="text">{hintText()}</span><span class="counts">{pl(d.points.length, 'point')} · {pl(d.paths.length, 'path')} · {pl(d.elements.length, 'element')} · {pl(clones, 'clone')} · {pl(d.fills.length, 'fill')}{saved}</span></div>;
}

const K = ({ k }: { k: string }) => <span class="kbd">{k}</span>;
function Help() {
  const p = UI.prefs.value;
  return <div class="help">
    <span><K k="Tab" /> Drawing ↔ Construction · only the active layer responds to the pointer</span>
    <span><K k="V" /> select · <K k="P" /> pen · <K k="F" /> freehand · <K k="B" /> fill · <K k="G" /> snap (hold <K k="⇧" /> to invert)</span>
    <span><K k="O" /> rotation · <K k="M" /> mirror · <K k="T" /> translation — bound to the selected path, else applied to new paths</span>
    <span class="violet">Elements: drag to move · mirror knob or <K k="[" /> <K k="]" /> rotates · translation diamond sets the vector · a chain applies left to right; a mirror then a half translation is a glide</span>
    <span>Pen: click a point to start or resume · click empty space to add · click the last point, <K k="Esc" /> or <K k="↵" /> to end · <K k="Space" />+drag moves the elements</span>
    <span>Select: click any copy of a line to select its path there, again to insert a point · drag ◇ to bend, double-click to straighten · marquee points · <K k="⇧" /> adds · box handles scale / rotate</span>
    <span>Clone: drag its body to move its element · drag its anchors to edit the shared point</span>
    <span>Fill: press to preview a closed region, release to colour · Structure paths sit below fills, Detail above</span>
    <span>Wheel pans · <K k="⌘" />+wheel zooms · two fingers pan and pinch · <K k="⌘0" /> fits · hover a point + <K k="⌫" /> deletes · <K k="⌘Z" /> undo · <K k="⇧⌘Z" /> redo</span>
    <div class="settings">
      <label>Grid <input type="range" min="2" max="16" step="1" value={p.gridDivisions} onInput={(e) => A.setGridDivisions(+(e.currentTarget as HTMLInputElement).value)} /> {p.gridDivisions}</label>
      <label>Ghosts <input type="range" min="0.1" max="1" step="0.05" value={p.ghostOpacity} onInput={(e) => A.setGhostOpacity(+(e.currentTarget as HTMLInputElement).value)} /></label>
      <Btn cls="small outline" title="Fit the tile (⌘0)" onClick={() => A.fitToTile()}>Reset view</Btn>
    </div>
  </div>;
}

export function TopRight() {
  return <div class="top-right">
    <div style={{ display: 'flex', gap: '8px' }}><Btn cls="icon outline" title="Shortcuts and settings (?)" onClick={() => A.toggleHelp()}>?</Btn></div>
    {UI.showHelp.value && <Help />}
  </div>;
}

export function Chrome() {
  const cons = UI.layer.value === 'construction';
  return <div class="chrome">
    <div class="top-left"><LayerBar />{!cons && <ToolBar />}{cons && !UI.selection.value && <><ElementsBar /><LatticeBar /></>}<SelectionBar /></div>
    <div class="bottom-left">{!cons && <Palette />}<UndoBar /></div>
    <Hint />
    <TopRight />
  </div>;
}
```

- [ ] **Step 2: Mount it in `App.tsx`**

Replace `<div class="chrome" />` with `<Chrome />` and add `import { Chrome } from './Chrome';`.

- [ ] **Step 3: Typecheck and verify in the browser**

Run: `npx tsc --noEmit` → clean. On `http://127.0.0.1:5173/`:
1. Top-left: Drawing / Construction, the tool group with Structure / Detail and Snap; bottom-left the stroke palette and greyed undo/redo; the empty-state hint; counts of zeros; `?` opens the sheet with the Grid and Ghosts sliders and Reset view.
2. Construction: Elements bar and Lattice bar. "+ ↻ Rotation" selects the new element; its bar shows Apply to new paths (on), the 1/n chips and Delete. Pick 1/3: the warning appears on the square lattice. Deselect, choose "Hex / triangle", reselect: no warning.
3. Draw a path, select it: one chain row with the element chip on, ★ on, ✕, "+ chain", the three "+" buttons, "Below fills". "+ chain" then the chip in the new row: a second clone set. ✕: gone.
4. Click a clone copy: "Clone of path 1 via ↻1 · power 1" with "Select its element" and "Select source path", the chain rows, and Unlink.
5. Palette title reads "Path" with a path selected and recolours it. `B`: title "Fill", weights hidden; a swatch sets the fill colour.
6. Move the Grid slider: grid lines change; Ghosts slider: neighbour opacity changes. Undo/redo enable with history; counts update on every change.

- [ ] **Step 4: Commit**

```bash
git add src/components/Chrome.tsx src/components/App.tsx
git commit -m "Add floating chrome: bars, palette, undo, hint, help with settings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 12: Persistence, JSON and SVG export, file group, Playwright flows

**Files:**
- Create: `src/engine/serialize.ts`, `src/state/persist.ts`, `tests/unit/serialize.test.ts`, `tests/e2e/helpers.ts`, `tests/e2e/flows.spec.ts`
- Modify: `src/main.tsx`, `src/components/Chrome.tsx` (file group in `TopRight`)

**Interfaces:**
- `serialize.ts`: `serializeDoc(doc) → string`, `parseDoc(json) → Doc | null`, `ExportMode = { kind: 'tile' } | { kind: 'grid'; rows; cols }`, `exportSvg(doc, mode) → string` (throws on sizes outside 1..64).
- `persist.ts`: `restore() → boolean` (loads document and prefs from localStorage; rejected values are moved to `<key>-rejected`), `startAutosave() → () => void`.
- `main.tsx` exposes `window.__tess` in dev builds for Playwright: `{ doc(), view(), tool(), selection(), prefs(), visibleCells(), toScreen(u, v) }`.

- [ ] **Step 1: Write `tests/unit/serialize.test.ts`**

```ts
import { test, expect } from 'vitest';
import { serializeDoc, parseDoc, exportSvg } from '../../src/engine/serialize';
import { exampleDoc } from '../../src/example';
import { CONFIG } from '../../src/config';

test('JSON round trip preserves the document; foreign or malformed input is refused', () => {
  const d = exampleDoc();
  expect(parseDoc(serializeDoc(d))).toEqual(d);
  expect(parseDoc(JSON.stringify({ ...d, version: 2 }))).toBe(null);
  expect(parseDoc('{"version":1}')).toBe(null);
  expect(parseDoc('not json')).toBe(null);
});

test('tile export is clipped to the cell polygon and draws the 3x3 window', () => {
  const svg = exportSvg(exampleDoc(), { kind: 'tile' });
  expect(svg).toContain('viewBox="0 0 240 240"');
  expect(svg).toContain('<clipPath id="clip"><polygon points="0,0 240,0 240,240 0,240"');
  expect(svg.match(/<use href="#cell-structure"/g)).toHaveLength(9);
  expect(svg).toContain('id="cell-fills"');
  expect(svg).toContain('fill-rule="evenodd"');
});

test('grid export covers the requested cells with a rect clip', () => {
  const three = exportSvg(exampleDoc(), { kind: 'grid', rows: 3, cols: 3 });
  expect(three).toContain('viewBox="0 0 720 720"');
  expect(three.match(/<use href="#cell-fills"/g)).toHaveLength(9);
  const wall = exportSvg(exampleDoc(), { kind: 'grid', rows: 8, cols: 12 });
  expect(wall).toContain('viewBox="0 0 2880 1920"');
  const hex = { ...exampleDoc(), lattice: { ...CONFIG.LATTICE_PRESETS['Hex / triangle'] } };
  expect((exportSvg(hex, { kind: 'grid', rows: 3, cols: 3 }).match(/<use href="#cell-detail"/g) ?? []).length).toBeGreaterThan(9);
  expect(() => exportSvg(exampleDoc(), { kind: 'grid', rows: 65, cols: 1 })).toThrow();
  expect(() => exportSvg(exampleDoc(), { kind: 'grid', rows: 0, cols: 3 })).toThrow();
});
```

- [ ] **Step 2: Create `src/engine/serialize.ts`**

```ts
import { CONFIG } from '../config';
import { windowOffsets, cellPolygon, toUV, toWorld } from './lattice';
import { IDENTITY, apply, orbit } from './transform';
import { pathWorld, pathCpsWorld } from './paths';
import { computeFaces, faceAt, facePathData } from './regions';
import type { Doc, XY, Cell, Lattice, Box } from '../types';

export function serializeDoc(d: Doc): string { return JSON.stringify(d); }

export function parseDoc(json: string): Doc | null {
  try {
    const o = JSON.parse(json);
    if (!o || o.version !== 1 || !o.lattice) return null;
    for (const k of ['points', 'paths', 'elements', 'bindings', 'fills']) if (!Array.isArray(o[k])) return null;
    const l = o.lattice;
    if (![l.ax, l.ay, l.bx, l.by].every((x: unknown) => typeof x === 'number' && Number.isFinite(x))) return null;
    return { version: 1, lattice: { ax: l.ax, ay: l.ay, bx: l.bx, by: l.by }, points: o.points, paths: o.paths, elements: o.elements, bindings: o.bindings, fills: o.fills, newPathOps: Array.isArray(o.newPathOps) ? o.newPathOps : [] };
  } catch { return null; }
}

export type ExportMode = { kind: 'tile' } | { kind: 'grid'; rows: number; cols: number };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const segD = (a: XY, b: XY, cp: XY | null) => (cp ? `M${a.x},${a.y} Q${cp.x},${cp.y} ${b.x},${b.y}` : `M${a.x},${a.y} L${b.x},${b.y}`);
const pathD = (P: XY[], C: (XY | null)[]) => P.slice(1).map((b, j) => segD(P[j], b, C[j])).join(' ');
const bbox = (pts: XY[]): Box => ({ x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) });

function cellDefs(d: Doc): string {
  const strokes = (lyr: 'structure' | 'detail') => d.paths.filter((p) => p.layer === lyr).flatMap((p) => {
    const P = pathWorld(d, p), C = pathCpsWorld(d, p);
    const Ms = [IDENTITY, ...d.bindings.filter((b) => b.pathId === p.id).flatMap((b) => orbit(b.ops, d.elements, d.lattice, CONFIG.ORBIT_CAP).matrices)];
    return Ms.map((M) => `<path d="${pathD(P.map((q) => apply(M, q)), C.map((c) => c && apply(M, c)))}" fill="none" stroke="${esc(p.style.color)}" stroke-width="${p.style.weight}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }).join('');
  const faces = computeFaces(d);
  const fills = d.fills.map((f) => ({ f, face: faceAt(faces, toWorld(f, d.lattice)) })).filter((x) => x.face).sort((a, b) => b.face!.area - a.face!.area)
    .map(({ f, face }) => `<path d="${facePathData(face!)}" fill="${esc(f.color)}" fill-rule="evenodd"/>`).join('');
  return `<g id="cell-structure">${strokes('structure')}</g><g id="cell-fills">${fills}</g><g id="cell-detail">${strokes('detail')}</g>`;
}

// Cells whose parallelogram overlaps the rectangle (touching edges do not count).
function cellsIntersecting(rect: Box, lat: Lattice): Cell[] {
  const corners = [{ x: rect.x0, y: rect.y0 }, { x: rect.x1, y: rect.y0 }, { x: rect.x0, y: rect.y1 }, { x: rect.x1, y: rect.y1 }].map((p) => toUV(p, lat));
  const c0 = Math.floor(Math.min(...corners.map((k) => k.u))) - 1, c1 = Math.floor(Math.max(...corners.map((k) => k.u))) + 1;
  const r0 = Math.floor(Math.min(...corners.map((k) => k.v))) - 1, r1 = Math.floor(Math.max(...corners.map((k) => k.v))) + 1;
  const out: Cell[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const b = bbox(cellPolygon({ c, r }, lat));
    if (b.x1 > rect.x0 + 1e-9 && b.x0 < rect.x1 - 1e-9 && b.y1 > rect.y0 + 1e-9 && b.y0 < rect.y1 - 1e-9) out.push({ c, r });
  }
  return out;
}

export function exportSvg(d: Doc, mode: ExportMode): string {
  const lat = d.lattice;
  let rect: Box, clip: string, cells: Cell[];
  if (mode.kind === 'tile') {
    const poly = cellPolygon({ c: 0, r: 0 }, lat);
    rect = bbox(poly);
    clip = `<polygon points="${poly.map((p) => `${p.x},${p.y}`).join(' ')}"/>`;
    cells = windowOffsets();
  } else {
    const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= CONFIG.MAX_WALLPAPER;
    if (!ok(mode.rows) || !ok(mode.cols)) throw new Error(`rows and columns must be whole numbers from 1 to ${CONFIG.MAX_WALLPAPER}`);
    rect = bbox([{ u: 0, v: 0 }, { u: mode.cols, v: 0 }, { u: 0, v: mode.rows }, { u: mode.cols, v: mode.rows }].map((k) => toWorld(k, lat)));
    clip = `<rect x="${rect.x0}" y="${rect.y0}" width="${rect.x1 - rect.x0}" height="${rect.y1 - rect.y0}"/>`;
    cells = cellsIntersecting(rect, lat);
  }
  const uses = (id: string) => cells.map((o) => { const t = toWorld({ u: o.c, v: o.r }, lat); return `<use href="#${id}" transform="translate(${t.x} ${t.y})"/>`; }).join('');
  const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${rect.x0} ${rect.y0} ${w} ${h}" width="${w}" height="${h}"><defs>${cellDefs(d)}<clipPath id="clip">${clip}</clipPath></defs><g clip-path="url(#clip)">${uses('cell-structure')}${uses('cell-fills')}${uses('cell-detail')}</g></svg>`;
}
```

- [ ] **Step 3: Create `src/state/persist.ts`**

```ts
// Autosave the document and UI prefs to localStorage; restore them on load.
import { effect } from '@preact/signals';
import { CONFIG } from '../config';
import { doc } from './doc';
import * as UI from './ui';
import { parseDoc, serializeDoc } from '../engine/serialize';
import type { Prefs, Tool, PathLayer, View } from '../types';

type StoredPrefs = { prefs: Prefs; tool: Tool; sublayer: PathLayer; view: View };

function reject(key: string, raw: string) {
  try { localStorage.setItem(`${key}-rejected`, raw); localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

export function restore(): boolean {
  let loaded = false;
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE_DOC_KEY);
    if (raw) {
      const d = parseDoc(raw);
      if (d) { doc.value = d; loaded = true; } else { console.warn('stored document rejected'); reject(CONFIG.STORAGE_DOC_KEY, raw); }
    }
    const p = localStorage.getItem(CONFIG.STORAGE_PREFS_KEY);
    if (p) {
      const s = JSON.parse(p) as Partial<StoredPrefs>;
      if (s && s.prefs && typeof s.prefs.gridDivisions === 'number' && s.prefs.style) {
        UI.prefs.value = { ...UI.prefs.value, ...s.prefs };
        if (s.tool && ['select', 'pen', 'freehand', 'fill'].includes(s.tool)) UI.tool.value = s.tool;
        if (s.sublayer === 'structure' || s.sublayer === 'detail') UI.sublayer.value = s.sublayer;
        if (s.view && Number.isFinite(s.view.zoom) && s.view.zoom > 0) UI.view.value = s.view;
      } else reject(CONFIG.STORAGE_PREFS_KEY, p);
    }
  } catch (err) { console.warn('restore failed', err); }
  return loaded;
}

export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopDoc = effect(() => {
    const d = doc.value;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { localStorage.setItem(CONFIG.STORAGE_DOC_KEY, serializeDoc(d)); UI.lastSavedAt.value = Date.now(); } catch { /* quota or private mode */ }
    }, CONFIG.AUTOSAVE_MS);
  });
  const stopPrefs = effect(() => {
    const s: StoredPrefs = { prefs: UI.prefs.value, tool: UI.tool.value, sublayer: UI.sublayer.value, view: UI.view.value };
    try { localStorage.setItem(CONFIG.STORAGE_PREFS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  });
  return () => { stopDoc(); stopPrefs(); clearTimeout(timer); };
}
```

- [ ] **Step 4: Update `src/main.tsx`**

```tsx
import { render } from 'preact';
import { App } from './components/App';
import { doc, emptyDoc } from './state/doc';
import * as UI from './state/ui';
import { visibleCells } from './state/derived';
import { toWorld } from './engine/lattice';
import { restore, startAutosave } from './state/persist';
import { exampleDoc } from './example';
import './styles.css';

const params = new URLSearchParams(location.search);
let restored = false;
if (params.has('example')) doc.value = exampleDoc();
else if (params.has('blank')) doc.value = emptyDoc();
else restored = restore();
UI.viewRestored = restored && !params.has('blank');   // App skips fitView when a view was restored
startAutosave();

if (import.meta.env.DEV) {
  (window as unknown as { __tess: unknown }).__tess = {
    doc: () => doc.value, view: () => UI.view.value, tool: () => UI.tool.value, selection: () => UI.selection.value, prefs: () => UI.prefs.value,
    visibleCells: () => visibleCells.value.length,
    toScreen: (u: number, v: number) => { const w = toWorld({ u, v }, doc.value.lattice), vw = UI.view.value; return { x: w.x * vw.zoom + vw.pan.x, y: w.y * vw.zoom + vw.pan.y }; },
  };
}

render(<App />, document.getElementById('root')!);
```

Add to `src/state/ui.ts`: `export let viewRestored = false;` is not assignable from another module, so make it a signal: `export const viewRestored = signal(false);` and in `main.tsx` write `UI.viewRestored.value = restored && !params.has('blank');`. In `App.tsx`, call `fitView` only when `!viewRestored.value`.

- [ ] **Step 5: Add the file group to `Chrome.tsx`**

Add these imports: `import { useState } from 'preact/hooks';`, `import { exportSvg, serializeDoc, parseDoc } from '../engine/serialize';`, `import { commit } from '../state/history';`, `import { CONFIG } from '../config';` (already there).

Add the component and the popover:

```tsx
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportPopover() {
  const [mode, setMode] = useState<'tile' | 'grid3' | 'wall'>('wall');
  const [rows, setRows] = useState(8);
  const [cols, setCols] = useState(12);
  const [error, setError] = useState('');
  const run = () => {
    try {
      const m = mode === 'tile' ? { kind: 'tile' as const } : mode === 'grid3' ? { kind: 'grid' as const, rows: 3, cols: 3 } : { kind: 'grid' as const, rows, cols };
      download(mode === 'tile' ? 'tile.svg' : `tessellation-${m.kind === 'grid' ? `${m.cols}x${m.rows}` : ''}.svg`, exportSvg(doc.value, m), 'image/svg+xml');
      UI.exportOpen.value = false;
    } catch (err) { setError((err as Error).message); }
  };
  return <div class="popover" data-testid="export-popover">
    <div style={{ display: 'flex', gap: '4px' }}>
      <Btn cls="small" on={mode === 'tile'} onClick={() => setMode('tile')}>Tile</Btn>
      <Btn cls="small" on={mode === 'grid3'} onClick={() => setMode('grid3')}>3×3</Btn>
      <Btn cls="small" on={mode === 'wall'} onClick={() => setMode('wall')}>Wallpaper</Btn>
    </div>
    {mode === 'wall' && <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>Columns <input class="field" type="number" min="1" max={CONFIG.MAX_WALLPAPER} value={cols} onInput={(e) => setCols(+(e.currentTarget as HTMLInputElement).value)} /> Rows <input class="field" type="number" min="1" max={CONFIG.MAX_WALLPAPER} value={rows} onInput={(e) => setRows(+(e.currentTarget as HTMLInputElement).value)} /></label>}
    {error && <Label>⚠ {error}</Label>}
    <Btn cls="outline" onClick={run}>Download SVG</Btn>
  </div>;
}

function FileGroup() {
  const importJson = () => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json' });
    input.onchange = async () => {
      const f = input.files?.[0]; if (!f) return;
      const d = parseDoc(await f.text());
      if (!d) { alert('That file is not a Tessellator document this version understands.'); return; }
      if (doc.value.paths.length && !confirm('Replace the current design?')) return;
      commit(d); UI.selection.value = null; UI.pen.value = null; A.fitToTile();
    };
    input.click();
  };
  return <div class="panel">
    <Btn cls="small outline" on={UI.exportOpen.value} title="Export as SVG" onClick={() => { UI.exportOpen.value = !UI.exportOpen.value; }}>Export SVG</Btn>
    <Btn cls="small outline" title="Download the document as JSON" onClick={() => download('tessellation.json', serializeDoc(doc.value), 'application/json')}>Export JSON</Btn>
    <Btn cls="small outline" title="Load a JSON document" onClick={importJson}>Import JSON</Btn>
    <Btn cls="small outline" title="Start a new design" onClick={() => { if (!doc.value.paths.length || confirm('Discard the current design?')) A.newDocument(); }}>New</Btn>
  </div>;
}
```

Then change `TopRight` to:

```tsx
export function TopRight() {
  return <div class="top-right">
    <div style={{ display: 'flex', gap: '8px' }}><FileGroup /><Btn cls="icon outline" title="Shortcuts and settings (?)" onClick={() => A.toggleHelp()}>?</Btn></div>
    {UI.exportOpen.value && <ExportPopover />}
    {UI.showHelp.value && <Help />}
  </div>;
}
```

- [ ] **Step 6: Create `tests/e2e/helpers.ts`**

```ts
import type { Page } from '@playwright/test';

export async function gotoBlank(page: Page) {
  await page.goto('/?blank');
  await page.waitForSelector('[data-testid="canvas"]');
}
export const screenOf = (page: Page, u: number, v: number) => page.evaluate(([u, v]) => (window as any).__tess.toScreen(u, v) as { x: number; y: number }, [u, v] as const);
export const tess = <T>(page: Page, expr: string) => page.evaluate((e) => { const t = (window as any).__tess; return eval(e); }, expr) as Promise<T>;
export async function clickUV(page: Page, u: number, v: number) { const s = await screenOf(page, u, v); await page.mouse.click(s.x, s.y); }
export async function dragUV(page: Page, u0: number, v0: number, u1: number, v1: number) {
  const a = await screenOf(page, u0, v0), b = await screenOf(page, u1, v1);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2); await page.mouse.move(b.x, b.y); await page.mouse.up();
}
export async function drawTriangle(page: Page) {
  await page.keyboard.press('p');
  for (const [u, v] of [[0.2, 0.2], [0.6, 0.2], [0.6, 0.6]]) await clickUV(page, u, v);
  await page.keyboard.press('Enter');
}
export async function drawSquare(page: Page) {
  await page.keyboard.press('p');
  for (const [u, v] of [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]]) await clickUV(page, u, v);
  await clickUV(page, 0.25, 0.25);
  await page.keyboard.press('Enter');
}
```

- [ ] **Step 7: Create `tests/e2e/flows.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { gotoBlank, screenOf, tess, clickUV, dragUV, drawTriangle, drawSquare } from './helpers';

test('draw and clone: a rotation clones the pen path into every cell', async ({ page }) => {
  await gotoBlank(page);
  await page.keyboard.press('o');
  await drawTriangle(page);
  await expect(page.locator('#cell-structure path')).toHaveCount(2);
  const cells = await tess<number>(page, 't.visibleCells()');
  await expect(page.locator('use[href="#cell-structure"]')).toHaveCount(cells);
});

test('edit a ghost: dragging a point of the copy in the next cell moves the source', async ({ page }) => {
  await gotoBlank(page);
  await drawTriangle(page);
  await page.keyboard.press('v');
  await clickUV(page, 1.4, 0.2);                       // segment of the copy in cell (1,0)
  expect(await tess<number>(page, 't.selection().copy.cell.c')).toBe(1);
  await dragUV(page, 1.2, 0.2, 1.2, 0.35);
  const p = await tess<{ u: number; v: number }>(page, 't.doc().points[0]');
  expect(p.u).toBeCloseTo(0.2, 2); expect(p.v).toBeCloseTo(0.35, 1);
  expect(await tess<number>(page, 't.selection().copy.cell.c')).toBe(1);   // handles stayed where the user is
});

test('fill a region, reload, and the fill and tool are restored', async ({ page }) => {
  await gotoBlank(page);
  await drawSquare(page);
  await page.keyboard.press('b');
  await clickUV(page, 0.5, 0.5);
  await expect(page.locator('#cell-fills path')).toHaveCount(1);
  await page.waitForTimeout(500);                      // autosave debounce
  await page.goto('/');
  await expect(page.locator('#cell-fills path')).toHaveCount(1);
  expect(await tess<string>(page, 't.tool()')).toBe('fill');
});

test('undo restores a dragged point', async ({ page }) => {
  await gotoBlank(page);
  await drawTriangle(page);
  await page.keyboard.press('v');
  await clickUV(page, 0.4, 0.2);
  await dragUV(page, 0.2, 0.2, 0.2, 0.4);
  expect((await tess<{ v: number }>(page, 't.doc().points[0]')).v).toBeCloseTo(0.4, 1);
  await page.keyboard.press('ControlOrMeta+z');
  expect((await tess<{ v: number }>(page, 't.doc().points[0]')).v).toBeCloseTo(0.2, 2);
});

test('wallpaper export downloads an SVG with the expected viewBox and cells', async ({ page }) => {
  await gotoBlank(page);
  await page.keyboard.press('o');
  await drawTriangle(page);
  await page.getByRole('button', { name: 'Export SVG' }).click();
  await page.getByRole('button', { name: 'Wallpaper' }).click();
  await page.locator('[data-testid="export-popover"] input').nth(0).fill('4');
  await page.locator('[data-testid="export-popover"] input').nth(1).fill('3');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download SVG' }).click()]);
  const text = await (await dl.createReadStream())!.toArray().then((chunks) => Buffer.concat(chunks as Buffer[]).toString());
  expect(text).toContain('viewBox="0 0 960 720"');
  expect(text.match(/<use href="#cell-structure"/g)).toHaveLength(12);
});
```

- [ ] **Step 8: Run everything**

Run: `npm test` (serialize tests pass), `npx tsc --noEmit` (clean), `npm run e2e` (five flows pass; the dev server starts automatically). Then open `http://127.0.0.1:5173/`, draw something, reload: it is still there and the hint briefly says "saved" after edits. Export SVG → Tile downloads a 240×240 file that opens in a browser as the single tile clipped to the cell; Wallpaper 12×8 opens as a seamless field.

- [ ] **Step 9: Commit**

```bash
git add src/engine/serialize.ts src/state/persist.ts src/state/ui.ts src/main.tsx src/components/Chrome.tsx src/components/App.tsx tests/unit/serialize.test.ts tests/e2e
git commit -m "Add autosave, JSON import/export, tile/grid/wallpaper SVG export, and Playwright flows

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Touch polish — modifier-free controls, touch sizes, touch flows

**Files:**
- Modify: `src/state/ui.ts` (add `freeScale`, `addToSelection` signals), `src/interaction/tools/select.ts`, `src/actions.ts` (add `straightenPath`), `src/components/Chrome.tsx`, `docs/superpowers/specs/2026-09-27-engine-rebuild-design.md` (one sentence)
- Create: `tests/e2e/touch.spec.ts`

**Interfaces:**
- `UI.freeScale: Signal<boolean>` stands in for `⇧` while scaling; `UI.addToSelection: Signal<boolean>` stands in for `⇧` while marquee-selecting. `actions.straightenPath(pathId)` straightens every curved segment of a path.

- [ ] **Step 1: Add the signals to `src/state/ui.ts`**

```ts
export const freeScale = signal(false);        // touch stand-in for Shift while scaling
export const addToSelection = signal(false);   // touch stand-in for Shift while marquee-selecting
```

Add both to `resetUi()` (`freeScale.value = false; addToSelection.value = false;`).

- [ ] **Step 2: Use them in `src/interaction/tools/select.ts`**

In `onDown`, the marquee branch: replace `add: e.shiftKey` with `add: e.shiftKey || UI.addToSelection.value` and `if (!e.shiftKey)` with `if (!e.shiftKey && !UI.addToSelection.value)`. In `onMove`, the bbox scale branch: `scaleFor(d.h, w, e.shiftKey || UI.freeScale.value)`.

- [ ] **Step 3: Add `straightenPath` to `src/actions.ts`**

```ts
export function straightenPath(pathId: string): boolean {
  const path = P.getPath(doc.value, pathId);
  if (!path || !path.segments.some((s) => s.cp)) return false;
  return mutate((d) => { const p = P.getPath(d, pathId)!; p.segments.forEach((s) => { s.cp = null; }); });
}
```

- [ ] **Step 4: Add the controls to `Chrome.tsx`**

In `ToolBar`, after the Snap button:

```tsx
    {UI.pen.value && <><Sep /><Btn cls="small outline" kbd="↵" title="End the current path (Enter / Esc)" onClick={() => A.endPen()}>End path</Btn></>}
    {t === 'select' && <Btn cls="small" on={UI.addToSelection.value} title="Add to the selection while marquee-selecting (stands in for Shift)" onClick={() => { UI.addToSelection.value = !UI.addToSelection.value; }}>Add</Btn>}
```

In `SelectionBar`, path case, after the "Below fills" button:

```tsx
      {path.segments.some((x) => x.cp) && <Btn cls="small outline" title="Straighten every curved segment (double-click a diamond for one)" onClick={() => A.straightenPath(path.id)}>Straighten</Btn>}
      <Btn cls="small" on={UI.freeScale.value} title="Scale freely from the box corners (stands in for Shift)" onClick={() => { UI.freeScale.value = !UI.freeScale.value; }}>Free</Btn>
```

- [ ] **Step 5: Fix the spec sentence**

In `docs/superpowers/specs/2026-09-27-engine-rebuild-design.md`, under **Touch and pen**, replace "A second pointer landing during a one-pointer drag cancels that drag exactly as `pointercancel` would (the gesture's history entry stays as it was at that moment)." with "A second pointer landing during a one-pointer drag reverts that drag to its pre-gesture state and drops its history entry, so an accidental extra finger never leaves a half-moved point behind."

- [ ] **Step 6: Create `tests/e2e/touch.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { gotoBlank, screenOf, tess, drawTriangle, drawSquare } from './helpers';

type TP = { x: number; y: number; id?: number };
async function touch(page: import('@playwright/test').Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: TP[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  return { send };
}

test('two fingers pan and pinch; the midpoint stays fixed', async ({ page }) => {
  await gotoBlank(page);
  const t = await touch(page);
  const before = await tess<{ zoom: number; pan: { x: number; y: number } }>(page, 't.view()');
  const a = { x: 300, y: 300 }, b = { x: 400, y: 300 };
  await t.send('touchStart', [{ ...a, id: 1 }, { ...b, id: 2 }]);
  await t.send('touchMove', [{ x: 250, y: 300, id: 1 }, { x: 450, y: 300, id: 2 }]);
  await t.send('touchEnd', []);
  const after = await tess<{ zoom: number; pan: { x: number; y: number } }>(page, 't.view()');
  expect(after.zoom).toBeCloseTo(before.zoom * 2, 2);
  const worldAtMidBefore = (350 - before.pan.x) / before.zoom, worldAtMidAfter = (350 - after.pan.x) / after.zoom;
  expect(worldAtMidAfter).toBeCloseTo(worldAtMidBefore, 1);
});

test('a second finger during a drag reverts the drag and takes over navigation', async ({ page }) => {
  await gotoBlank(page);
  await drawTriangle(page);
  await page.keyboard.press('v');
  const s = await screenOf(page, 0.2, 0.2);
  await page.mouse.click((await screenOf(page, 0.4, 0.2)).x, (await screenOf(page, 0.4, 0.2)).y);
  const t = await touch(page);
  await t.send('touchStart', [{ x: s.x, y: s.y, id: 1 }]);
  await t.send('touchMove', [{ x: s.x, y: s.y + 40, id: 1 }]);
  expect((await tess<{ v: number }>(page, 't.doc().points[0]')).v).toBeGreaterThan(0.25);
  await t.send('touchStart', [{ x: s.x, y: s.y + 40, id: 1 }, { x: s.x + 200, y: s.y, id: 2 }]);
  expect((await tess<{ v: number }>(page, 't.doc().points[0]')).v).toBeCloseTo(0.2, 2);
  const before = await tess<{ pan: { x: number } }>(page, 't.view()');
  await t.send('touchMove', [{ x: s.x + 30, y: s.y + 40, id: 1 }, { x: s.x + 230, y: s.y, id: 2 }]);
  const after = await tess<{ pan: { x: number } }>(page, 't.view()');
  expect(after.pan.x).toBeCloseTo(before.pan.x + 30, 0);
  await t.send('touchEnd', []);
});

test('a touch tap reaches a segment at 1.5x the mouse threshold', async ({ page }) => {
  await gotoBlank(page);
  await drawTriangle(page);
  await page.keyboard.press('v');
  const s = await screenOf(page, 0.4, 0.2);
  const t = await touch(page);
  await t.send('touchStart', [{ x: s.x, y: s.y + 10, id: 1 }]);
  await t.send('touchEnd', []);
  expect(await tess<string | null>(page, 't.selection() && t.selection().kind')).toBe('path');
});

test('fill by touch previews on press and commits on release', async ({ page }) => {
  await gotoBlank(page);
  await drawSquare(page);
  await page.keyboard.press('b');
  const s = await screenOf(page, 0.5, 0.5);
  const t = await touch(page);
  await t.send('touchStart', [{ x: s.x, y: s.y, id: 1 }]);
  await expect(page.locator('path.fill-hover')).not.toHaveCount(0);
  await expect(page.locator('#cell-fills path')).toHaveCount(0);
  await t.send('touchEnd', []);
  await expect(page.locator('#cell-fills path')).toHaveCount(1);
});
```

- [ ] **Step 7: Run everything and try it on a tablet if one is handy**

Run: `npm test`, `npx tsc --noEmit`, `npm run e2e` → all pass. In the browser with touch emulation: the buttons grow to 44 px after the first touch; End path appears while drawing; Free and Add toggle; Straighten appears for a curved path.

- [ ] **Step 8: Commit**

```bash
git add src/state/ui.ts src/interaction/tools/select.ts src/actions.ts src/components/Chrome.tsx tests/e2e/touch.spec.ts docs/superpowers/specs/2026-09-27-engine-rebuild-design.md
git commit -m "Touch polish: modifier-free controls, touch hit sizes, two-finger flows

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Rewrite `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (replace the whole file)

- [ ] **Step 1: Replace `CLAUDE.md`**

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based tessellation editor: Preact + `@preact/signals`, TypeScript (strict), Vite. Runtime dependencies are only `preact` and `@preact/signals`. `?example` in the URL loads a demo document; `?blank` starts empty; otherwise the last autosaved document is restored from localStorage.

## Running it

```
npm run dev      # http://127.0.0.1:5173/ with hot reload
npm test         # Vitest: engine, state, actions
npm run e2e      # Playwright flows against the dev server (needs `npx playwright install chromium` once)
npm run build    # tsc --noEmit && vite build → dist/
```

## Design documents

- `docs/superpowers/specs/2026-09-27-engine-rebuild-design.md` is the engine spec and the behavioural reference.
- `docs/superpowers/plans/2026-09-28-engine-rebuild-preact.md` is the implementation plan it was built from.
- The Claude Design project "Tessellation Designer v2 Symmetry" was the original prototype.

## Model (all lattice coordinates)

Everything in the document is in lattice `(u, v)` coordinates; world position is `u·a + v·b` for the lattice vectors in `doc.lattice`. World space exists only at render and hit-test time, so changing the lattice deforms the whole design affinely.

- **Points** are `(u, v)` in the base cell; a path's nodes are `{ pointId, cell }`, so one point can appear in several cells and a path can leave the tile on one edge and continue from the other.
- **Paths** are `{ start, segments: [{ to, cp }] }`. `cp` is a quadratic control point relative to the previous node's cell origin. Closed = last node is the start node in the same cell. `layer` is `structure` (below fills) or `detail` (above).
- **Elements** are the three primitive isometries: `translate {u, v}`, `mirror {u, v, du, dv}` (centre and lattice direction), `rotate {u, v, n}` (1/n turn). There is no glide kind: a glide is a chain `[mirror, translate]`. The lattice is not an element.
- **Bindings** `{ pathId, ops }` are ordered chains. Clones are never stored: `orbit()` in `src/engine/transform.ts` returns the powers of the chain's composite up to the first lattice translation (cap 12, `open` if it never closes). `doc.newPathOps` lists chains every new path receives.
- **Fills** are seed points; `src/engine/regions.ts` builds a planar arrangement of every copy in the 3×3 window and each seed paints the face containing it (faces carry holes; even-odd rendering). Seeds are placed at the face centroid when it lies inside.
- **Copies.** Everything on screen is a `Copy { cell, bindingId, power }` of a path with matrix `cellMatrix ∘ cloneMatrix`. Selection carries the copy the user clicked; handles render there and edits map back through the copy's inverse.

## Architecture

- `src/engine/*` is pure: takes a `Doc` (or a draft) and returns values. Matrices are `[a, b, c, d, e, f]` in SVG order; `compose(A, B)` applies B then A.
- `src/state/doc.ts` holds the committed document in a signal; `draft()` clones it. `src/state/history.ts` commits, records one entry per gesture (`beginGesture` / `endGesture`, `abortGesture` reverts), and undoes by reference. `src/state/derived.ts` has the computeds: clone matrices, visible cells, copies, anchors, and `faces` (recomputed on the next frame after a commit, never while a drag is set). `src/state/persist.ts` autosaves the document and prefs.
- `src/actions.ts` holds every user-level mutation as `mutate(draft => ...)`. Chrome and tools call these.
- `src/interaction/pointer.ts` is one listener set on the SVG: hit-test geometrically (`src/engine/hit.ts`), dispatch to `src/interaction/tools/*` (`onDown/onMove/onUp`), two pointers = pan and pinch (a second finger reverts a drag), thresholds double for touch.
- `src/components/Canvas.tsx` renders the base cell once into `<defs>` (`#cell-structure`, `#cell-fills`, `#cell-detail`) and places `<use>` per visible cell; overlays (halos, handles, points, elements) are drawn at the selected copy. `src/components/Chrome.tsx` is the floating chrome.

## Shortcuts

`Tab` layer · `V` `P` `F` `B` tools · `O` `M` `T` add elements · `[` `]` rotate a mirror · `G` snap · `Esc`/`Enter` end pen · `⌫` delete hovered point or selection · `⌘Z` / `⇧⌘Z` · `⌘0` fit · wheel pans, `⌘`+wheel zooms, two fingers pan and pinch. The `?` sheet in `Chrome.tsx` must stay in sync with `onKeyDown` in `pointer.ts`.

## Known limitations

- Clones are not composed across bindings (no group closure).
- Collinear overlapping edges that are not identical are not split against each other.
- Only the base cell's copies are hit-tested for segments in the visible cells; points are hit in the 3×3 window.
```

- [ ] **Step 2: Final check and commit**

Run: `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run e2e` → all pass.

```bash
git add CLAUDE.md
git commit -m "Rewrite CLAUDE.md for the Preact lattice/element/fill engine

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
