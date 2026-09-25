// Main entry point
import { state, getSelectedSubtile } from './state.js';
import { render } from './render.js';
import { createEventHandlers } from './interaction.js';
import { cloneSelectedSubtile } from './geometry.js';

// Initialize the application
function init() {
  const svg = document.getElementById("canvas");
  const toolbarButtons = Array.from(
    document.querySelectorAll(".tool-button[data-tool]")
  );
  const cloneBtn = document.getElementById("clone-btn");
  const instanceLabel = document.getElementById("instance-label");
  const instanceRot = document.getElementById("instance-rot");
  const instanceMirror = document.getElementById("instance-mirror");

  // Update toolbar button states
  function updateToolButtons() {
    toolbarButtons.forEach((btn) => {
      const tool = btn.getAttribute("data-tool");
      if (tool === state.activeTool) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  // Update instance panel (now shows subtile info)
  function updateInstancePanel() {
    const subtile = getSelectedSubtile();
    if (!subtile) {
      instanceLabel.textContent = "none";
      instanceRot.textContent = "0°";
      instanceMirror.textContent = "–";
      return;
    }
    instanceLabel.textContent = subtile.id;
    instanceRot.textContent = `${Math.round(subtile.rotation)}°`;
    let mirror = [];
    if (subtile.mirrorX) mirror.push("X");
    if (subtile.mirrorY) mirror.push("Y");
    instanceMirror.textContent = mirror.length ? mirror.join("") : "none";
  }

  // Setup toolbar buttons
  toolbarButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeTool = btn.getAttribute("data-tool");
      state.currentDrawing = null; // cancel drawing when switching tools
      updateToolButtons();
      doRender();
    });
  });

  cloneBtn.addEventListener("click", () => {
    cloneSelectedSubtile();
    doRender();
  });

  // Wrapper function to pass updateInstancePanel to render
  function doRender() {
    render(svg, updateInstancePanel);
    updateToolButtons();
  }

  // Center initial view
  function centerInitialView() {
    const containerRect = svg.getBoundingClientRect();
    const cx = containerRect.width / 2;
    const cy = containerRect.height / 2;

    // Center on origin
    state.pan.x = cx;
    state.pan.y = cy;
  }

  function onResize() {
    centerInitialView();
    doRender();
  }

  // Create event handlers
  const handlers = createEventHandlers(svg, doRender);

  // Attach event listeners
  window.addEventListener("resize", onResize);
  svg.addEventListener("pointerdown", handlers.onPointerDown);
  svg.addEventListener("pointermove", handlers.onPointerMove);
  svg.addEventListener("pointerup", handlers.onPointerUp);
  svg.addEventListener("pointercancel", handlers.onPointerUp);
  svg.addEventListener("dblclick", handlers.onDblClick);
  svg.addEventListener("wheel", handlers.onWheel, { passive: false });
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
