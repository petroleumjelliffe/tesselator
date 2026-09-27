// Rendering logic: clears the SVG and rebuilds it from state on every call
import { state, getGeometryById, getSubtileById } from './state.js';
import { createSvgElement, clearSvg } from './utils.js';
import { CONFIG } from './config.js';
import { calculateBaseTileBounds, segmentCount, getSegmentHandle } from './geometry.js';
import { subtileTransformString, subtileLocalToWorld } from './transform.js';

// Generate SVG path data from geometry points and segments
export function generatePathData(geom) {
  if (geom.points.length === 0) return '';
  if (geom.points.length === 1) {
    const p = geom.points[0];
    return `M ${p.x},${p.y}`;
  }

  const numPoints = geom.points.length;
  const numSegments = geom.closed ? numPoints : numPoints - 1;
  let pathData = `M ${geom.points[0].x},${geom.points[0].y}`;

  for (let i = 0; i < numSegments; i++) {
    const p2 = geom.points[(i + 1) % numPoints];
    const segment = geom.segments[i];

    if (!segment || segment.type === 'line') {
      pathData += ` L ${p2.x},${p2.y}`;
    } else if (segment.type === 'bezier' && segment.cp) {
      pathData += ` Q ${segment.cp.x},${segment.cp.y} ${p2.x},${p2.y}`;
    }
  }

  return pathData;
}

export function render(svg, afterRender) {
  clearSvg(svg);

  const rootGroup = createSvgElement("g", {
    transform: `translate(${state.pan.x},${state.pan.y}) scale(${state.zoom})`,
  });
  svg.appendChild(rootGroup);

  const baseTile = calculateBaseTileBounds();
  const hasContent = state.subtiles.length > 0;

  // Layer 1: 3x3 repeat (frames + ghosted copies of everything)
  if (state.showTilingGrid && hasContent) {
    renderTilingFrames(rootGroup, baseTile);
    renderGhostCopies(rootGroup, baseTile);
  } else if (state.subtiles.length > 1) {
    rootGroup.appendChild(createSvgElement("rect", {
      x: baseTile.x,
      y: baseTile.y,
      width: baseTile.width,
      height: baseTile.height,
      class: "base-outline",
    }));
  }

  // Layer 2: subtiles and their content
  renderSubtiles(rootGroup);

  // Layer 3: pen rubber band
  renderRubberBand(rootGroup);

  if (afterRender) afterRender();
}

function renderTilingFrames(layer, baseTile) {
  const { width: w, height: h, x: originX, y: originY } = baseTile;
  for (let row = -1; row <= 1; row++) {
    for (let col = -1; col <= 1; col++) {
      const isBase = row === 0 && col === 0;
      layer.appendChild(createSvgElement("rect", {
        x: originX + col * w,
        y: originY + row * h,
        width: w,
        height: h,
        class: isBase ? "frame base" : "frame",
      }));
    }
  }
}

function renderGhostCopies(layer, baseTile) {
  for (let row = -1; row <= 1; row++) {
    for (let col = -1; col <= 1; col++) {
      if (row === 0 && col === 0) continue;
      const ghost = createSvgElement("g", {
        class: "ghost",
        transform: `translate(${col * baseTile.width},${row * baseTile.height})`,
      });
      layer.appendChild(ghost);
      state.subtiles.forEach((subtile) => {
        const geom = getGeometryById(subtile.geometryId);
        if (!geom || geom.points.length < 2) return;
        const g = createSvgElement("g", { transform: subtileTransformString(subtile) });
        g.appendChild(createSvgElement("path", { d: generatePathData(geom), class: "path" }));
        ghost.appendChild(g);
      });
    }
  }
}

function renderSubtiles(layer) {
  const z = state.zoom;
  const tool = state.activeTool;

  state.subtiles.forEach((subtile) => {
    const geom = getGeometryById(subtile.geometryId);
    if (!geom) return;

    const group = createSvgElement("g", { transform: subtileTransformString(subtile) });
    layer.appendChild(group);

    const isSelected = subtile.id === state.selectedSubtileId;
    const isLinked = !isSelected && geom.id === state.selectedGeometryId;

    // Container box
    group.appendChild(createSvgElement("rect", {
      x: 0,
      y: 0,
      width: subtile.width,
      height: subtile.height,
      class: isSelected ? "subtile sel" : "subtile",
    }));

    // Snap grid, only where it matters
    const gridTile = tool === "draw" ? subtile.id === state.currentDrawing : tool === "edit" && isSelected;
    if (state.gridSnapping && gridTile) {
      renderSnapGrid(group, subtile);
    }

    // Shape outline
    if (geom.points.length >= 2) {
      const d = generatePathData(geom);
      let pathClass = "path";
      if (isSelected) pathClass += " sel";
      else if (isLinked) pathClass += " link";
      group.appendChild(createSvgElement("path", { d, class: pathClass }));
      if (tool === "edit") {
        group.appendChild(createSvgElement("path", { d, class: "path-hit" }));
      }
    }

    // Points
    const showPoints = tool === "edit" || (tool === "draw" && subtile.id === state.currentDrawing);
    if (showPoints) {
      const dim = tool === "edit" && geom.id !== state.selectedGeometryId;
      geom.points.forEach((p) => {
        const isPointSelected =
          isSelected && geom.id === state.selectedGeometryId && p.id === state.selectedPointId;
        let cls = "pt";
        if (isPointSelected) cls += " sel";
        if (dim) cls += " dim";
        group.appendChild(createSvgElement("circle", {
          cx: p.x,
          cy: p.y,
          r: (dim ? CONFIG.POINT_RADIUS_DIM : CONFIG.POINT_RADIUS) / z,
          class: cls,
        }));
      });
    }

    // Segment handles (edit mode, selected tile only)
    if (tool === "edit" && isSelected && geom.id === state.selectedGeometryId) {
      renderSegmentHandles(group, geom);
    }
  });
}

function renderSnapGrid(group, subtile) {
  const stepX = subtile.width / CONFIG.GRID_DIVISIONS;
  const stepY = subtile.height / CONFIG.GRID_DIVISIONS;
  for (let i = 1; i < CONFIG.GRID_DIVISIONS; i++) {
    group.appendChild(createSvgElement("line", {
      x1: stepX * i, y1: 0, x2: stepX * i, y2: subtile.height, class: "grid-inner",
    }));
    group.appendChild(createSvgElement("line", {
      x1: 0, y1: stepY * i, x2: subtile.width, y2: stepY * i, class: "grid-inner",
    }));
  }
}

function renderSegmentHandles(group, geom) {
  const z = state.zoom;
  const size = CONFIG.CONTROL_HANDLE_SIZE / z;
  const n = segmentCount(geom);

  for (let idx = 0; idx < n; idx++) {
    const seg = geom.segments[idx];
    const isCurve = seg.type === "bezier" && !!seg.cp;
    const h = getSegmentHandle(geom, idx);

    if (isCurve) {
      const p1 = geom.points[idx];
      const p2 = geom.points[(idx + 1) % geom.points.length];
      group.appendChild(createSvgElement("line", {
        x1: p1.x, y1: p1.y, x2: h.x, y2: h.y, class: "cp-guide",
      }));
      group.appendChild(createSvgElement("line", {
        x1: h.x, y1: h.y, x2: p2.x, y2: p2.y, class: "cp-guide",
      }));
    }

    let cls = "cp";
    if (isCurve) cls += " curve";
    if (state.selectedSegmentIndex === idx) cls += " sel";
    group.appendChild(createSvgElement("rect", {
      x: h.x - size / 2,
      y: h.y - size / 2,
      width: size,
      height: size,
      transform: `rotate(45 ${h.x} ${h.y})`,
      class: cls,
    }));
  }
}

function renderRubberBand(layer) {
  if (state.activeTool !== "draw" || !state.currentDrawing || !state.cursorWorld) return;
  const subtile = getSubtileById(state.currentDrawing);
  const geom = subtile && getGeometryById(subtile.geometryId);
  if (!geom || geom.points.length === 0) return;
  const last = subtileLocalToWorld(geom.points[geom.points.length - 1], subtile);
  layer.appendChild(createSvgElement("line", {
    x1: last.x, y1: last.y, x2: state.cursorWorld.x, y2: state.cursorWorld.y, class: "rubber",
  }));
}
