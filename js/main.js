// Main entry point: wires the floating UI to state and drives rendering
import { state, getSelectedSubtile, getSelectedGeometry } from './state.js';
import { render } from './render.js';
import { createEventHandlers } from './interaction.js';
import * as actions from './actions.js';
import { canUndo, canRedo } from './history.js';
import { calculateBaseTileBounds } from './geometry.js';

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function init() {
  const $ = (id) => document.getElementById(id);
  const app = $("app");
  const svg = $("canvas");
  const toolButtons = Array.from(document.querySelectorAll(".tool-button[data-tool]"));
  const selectionBar = $("selection-bar");
  const hintEl = $("hint");
  const countsEl = $("counts");
  const exampleBtn = $("example-btn");
  const undoBtn = $("undo-btn");
  const redoBtn = $("redo-btn");
  const tileBtn = $("tile-btn");
  const tileLabel = $("tile-label");
  const tilePanel = $("tile-panel");
  const tilingToggle = $("tiling-toggle");
  const snapToggle = $("snap-toggle");
  const baseSizeEl = $("base-size");
  const helpBtn = $("help-btn");
  const helpPanel = $("help-panel");

  const ui = { showTilePanel: false, showHelp: false };

  function doRender() {
    render(svg, updateChrome);
  }

  // ---- selection bar ----
  function selectionBarHtml() {
    const subtile = getSelectedSubtile();
    const geom = getSelectedGeometry();

    if (state.activeTool === "transform" && subtile) {
      const index = state.subtiles.indexOf(subtile) + 1;
      const linked = state.subtiles.filter((s) => s.geometryId === subtile.geometryId).length - 1;
      const label = `Tile ${index}${linked ? ` · ${plural(linked, "linked clone")}` : ""}`;
      return `
        <span class="sel-label">${label}</span>
        <button class="btn primary" data-action="clone" title="Clone linked (C)">⧉ Clone linked <kbd>C</kbd></button>
        <button class="btn icon" data-action="rotL" title="Rotate −90° ([)">↺</button>
        <button class="btn icon" data-action="rotR" title="Rotate +90° (])">↻</button>
        <span class="readout">${Math.round(subtile.rotation)}°</span>
        <span class="divider"></span>
        <button class="btn icon${subtile.mirrorX ? " on" : ""}" data-action="mirX" title="Mirror horizontally (X)">↔ X</button>
        <button class="btn icon${subtile.mirrorY ? " on" : ""}" data-action="mirY" title="Mirror vertically (Y)">↕ Y</button>
        <span class="divider"></span>
        <button class="btn quiet" data-action="delete" title="Delete tile (⌫)">Delete <kbd>⌫</kbd></button>`;
    }

    if (state.activeTool === "edit" && geom) {
      const shapeIndex = state.geometries.indexOf(geom) + 1;
      const tiles = state.subtiles.filter((s) => s.geometryId === geom.id).length;
      const shapeLabel = `Shape ${shapeIndex}${tiles > 1 ? ` · ${plural(tiles, "tile")}` : ""}`;

      if (state.selectedSegmentIndex !== null) {
        const seg = geom.segments[state.selectedSegmentIndex];
        const isCurve = seg && seg.type === "bezier";
        return `
          <span class="sel-label">${shapeLabel} · segment ${state.selectedSegmentIndex + 1}</span>
          <button class="btn primary" data-action="curve" title="Toggle curve (C)">${isCurve ? "— Straighten" : "⌒ Make curve"} <kbd>C</kbd></button>
          <span class="readout">click the line again to insert a point</span>
          <span class="divider"></span>
          <button class="btn quiet" data-action="delete" title="Delete shape (⌫)">Delete shape <kbd>⌫</kbd></button>`;
      }

      if (state.selectedPointId) {
        const pointIndex = geom.points.findIndex((p) => p.id === state.selectedPointId) + 1;
        return `
          <span class="sel-label">${shapeLabel} · point ${pointIndex} of ${geom.points.length}</span>
          <button class="btn quiet" data-action="delete" title="Delete point (⌫)">Delete point <kbd>⌫</kbd></button>`;
      }

      return `
        <span class="sel-label">${shapeLabel}</span>
        <button class="btn quiet" data-action="delete" title="Delete shape (⌫)">Delete shape <kbd>⌫</kbd></button>`;
    }

    return "";
  }

  function runAction(name) {
    switch (name) {
      case "clone": return actions.cloneSelection();
      case "rotL": return actions.rotateSelection(-1);
      case "rotR": return actions.rotateSelection(1);
      case "mirX": return actions.mirrorSelection("mirrorX");
      case "mirY": return actions.mirrorSelection("mirrorY");
      case "curve": return actions.toggleSelectedSegmentCurve();
      case "delete": return actions.deleteSelection();
      default: return false;
    }
  }

  // ---- hint text ----
  function hintText() {
    const tool = state.activeTool;
    const empty = state.subtiles.length === 0;
    if (tool === "draw") {
      if (state.currentDrawing) {
        return "Pen: click to add points · click the first point to close the shape · double-click, Esc or ↵ to finish";
      }
      if (empty) return "Click anywhere to start a tile and place its first point";
      return "Pen: click empty space to start a new tile · switch to Select (V) to move or clone tiles";
    }
    if (tool === "edit") {
      if (state.selectedSegmentIndex !== null) return "Segment selected · drag ◇ to bend · C toggles curve · click the line again to insert a point";
      if (state.selectedPointId) return "Drag the point to move it · edits show in every linked clone · ⌫ deletes it";
      return "Edit: drag a point to move it · click a line to select it · hover a line to see its handles";
    }
    if (getSelectedSubtile()) {
      return "Tile selected · drag to move · C clones it linked · [ ] rotate · X Y mirror · ⌫ deletes";
    }
    if (empty) return "Nothing to select yet · switch to Pen (P) to draw a tile";
    return "Select: click a tile to select it · drag to move · Space+drag pans · scroll zooms";
  }

  // ---- chrome update (runs after every render) ----
  function updateChrome() {
    app.dataset.tool = state.activeTool;
    app.classList.toggle("panning", state.spacePanning);

    toolButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === state.activeTool);
    });

    const html = selectionBarHtml();
    selectionBar.hidden = !html;
    selectionBar.innerHTML = html;

    hintEl.textContent = hintText();
    exampleBtn.hidden = !(state.subtiles.length === 0 && state.activeTool === "draw");

    const points = state.geometries.reduce((n, g) => n + g.points.length, 0);
    countsEl.textContent = `${plural(state.subtiles.length, "tile")} · ${plural(state.geometries.length, "shape")} · ${plural(points, "point")}`;

    undoBtn.disabled = !canUndo();
    redoBtn.disabled = !canRedo();

    const base = calculateBaseTileBounds();
    const sizeText = `${Math.round(base.width)} × ${Math.round(base.height)}`;
    tileLabel.textContent = sizeText;
    baseSizeEl.textContent = sizeText;
    tilingToggle.textContent = state.showTilingGrid ? "On" : "Off";
    tilingToggle.classList.toggle("on", state.showTilingGrid);
    snapToggle.textContent = state.gridSnapping ? "On" : "Off";
    snapToggle.classList.toggle("on", state.gridSnapping);
    tilePanel.hidden = !ui.showTilePanel;
    helpPanel.hidden = !ui.showHelp;
    tileBtn.classList.toggle("on", ui.showTilePanel);
    helpBtn.classList.toggle("on", ui.showHelp);
  }

  // ---- UI events ----
  toolButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      actions.setTool(btn.dataset.tool);
      btn.blur();
      doRender();
    });
  });

  selectionBar.addEventListener("click", (evt) => {
    const btn = evt.target.closest("[data-action]");
    if (!btn) return;
    runAction(btn.dataset.action);
    btn.blur();
    doRender();
  });

  undoBtn.addEventListener("click", () => { actions.undo(); undoBtn.blur(); doRender(); });
  redoBtn.addEventListener("click", () => { actions.redo(); redoBtn.blur(); doRender(); });

  tileBtn.addEventListener("click", () => {
    ui.showTilePanel = !ui.showTilePanel;
    if (ui.showTilePanel) ui.showHelp = false;
    tileBtn.blur();
    updateChrome();
  });
  helpBtn.addEventListener("click", () => {
    ui.showHelp = !ui.showHelp;
    if (ui.showHelp) ui.showTilePanel = false;
    helpBtn.blur();
    updateChrome();
  });
  tilingToggle.addEventListener("click", () => { actions.toggleTiling(); tilingToggle.blur(); doRender(); });
  snapToggle.addEventListener("click", () => { actions.toggleSnap(); snapToggle.blur(); doRender(); });
  exampleBtn.addEventListener("click", () => { actions.loadExampleScene(); exampleBtn.blur(); doRender(); });

  // ---- viewport ----
  function centerInitialView() {
    const rect = svg.getBoundingClientRect();
    state.pan.x = rect.width / 2;
    state.pan.y = rect.height / 2;
  }

  function onResize() {
    centerInitialView();
    doRender();
  }

  // ---- canvas events ----
  const handlers = createEventHandlers(svg, doRender);

  window.addEventListener("resize", onResize);
  svg.addEventListener("pointerdown", handlers.onPointerDown);
  svg.addEventListener("pointermove", handlers.onPointerMove);
  svg.addEventListener("pointerup", handlers.onPointerUp);
  svg.addEventListener("pointercancel", handlers.onPointerUp);
  svg.addEventListener("dblclick", handlers.onDblClick);
  svg.addEventListener("wheel", handlers.onWheel, { passive: false });
  svg.addEventListener("contextmenu", (evt) => evt.preventDefault());
  window.addEventListener("keydown", handlers.onKeyDown);
  window.addEventListener("keyup", handlers.onKeyUp);

  // Initial layout/paint
  setTimeout(() => {
    centerInitialView();
    doRender();
  }, 0);
}

// Start the app when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
