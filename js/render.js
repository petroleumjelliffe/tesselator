// Rendering logic
import { state, getGeometryById } from './state.js';
import { createSvgElement, clearSvg } from './utils.js';
import { CONFIG } from './config.js';
import { calculateBaseTileBounds } from './geometry.js';

// Generate SVG path data from geometry points and segments
function generatePathData(geom) {
  if (geom.points.length === 0) return '';
  if (geom.points.length === 1) {
    const p = geom.points[0];
    return `M ${p.x},${p.y}`;
  }

  let pathData = '';
  const numPoints = geom.points.length;
  const numSegments = geom.closed ? numPoints : numPoints - 1;

  pathData = `M ${geom.points[0].x},${geom.points[0].y}`;

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

export function render(svg, updateInstancePanel) {
  clearSvg(svg);

  const rootGroup = createSvgElement("g", {
    transform: `translate(${state.pan.x},${state.pan.y}) scale(${state.zoom})`,
  });
  svg.appendChild(rootGroup);

  // Calculate base tile bounds
  const baseTile = calculateBaseTileBounds();

  // Layer 1: Optional 3x3 tiling grid
  if (state.showTilingGrid) {
    const gridLayer = createSvgElement("g", {});
    rootGroup.appendChild(gridLayer);
    renderTilingGrid(gridLayer, baseTile);
  }

  // Layer 2: Subtiles and their content
  const contentLayer = createSvgElement("g", {});
  rootGroup.appendChild(contentLayer);
  renderSubtiles(contentLayer);

  // Layer 3: Base tile outline (for reference)
  if (state.subtiles.length > 0) {
    const baseTileOutline = createSvgElement("rect", {
      x: baseTile.x,
      y: baseTile.y,
      width: baseTile.width,
      height: baseTile.height,
      class: "base-tile-outline",
    });
    contentLayer.appendChild(baseTileOutline);
  }

  // Overlay status text
  const overlay = createSvgElement("text", {
    x: baseTile.x,
    y: baseTile.y + baseTile.height + 24,
    class: "overlay-text",
    textContent: `Tool: ${state.activeTool.toUpperCase()} | Zoom: ${state.zoom.toFixed(
      2
    )} | Grid Snap: ${state.gridSnapping ? 'ON' : 'OFF'} | Tiling Grid: ${state.showTilingGrid ? 'ON' : 'OFF'} | Subtiles: ${state.subtiles.length}`,
  });
  rootGroup.appendChild(overlay);

  if (updateInstancePanel) {
    updateInstancePanel();
  }
}

function renderTilingGrid(gridLayer, baseTile) {
  const w = baseTile.width;
  const h = baseTile.height;
  const originX = baseTile.x;
  const originY = baseTile.y;

  for (let row = -1; row <= 1; row++) {
    for (let col = -1; col <= 1; col++) {
      const tileGroup = createSvgElement("g", {
        transform: `translate(${originX + col * w},${originY + row * h})`,
      });
      gridLayer.appendChild(tileGroup);

      const rectClasses = ["grid-rect"];
      if (row === 0 && col === 0) rectClasses.push("base");

      const tileRect = createSvgElement("rect", {
        x: 0,
        y: 0,
        width: w,
        height: h,
        class: rectClasses.join(" "),
      });
      tileGroup.appendChild(tileRect);

      // Grid lines
      const stepX = w / CONFIG.GRID_DIVISIONS;
      const stepY = h / CONFIG.GRID_DIVISIONS;
      for (let i = 1; i < CONFIG.GRID_DIVISIONS; i++) {
        const x = stepX * i;
        const vline = createSvgElement("line", {
          x1: x,
          y1: 0,
          x2: x,
          y2: h,
          class: "grid-inner",
        });
        tileGroup.appendChild(vline);
      }
      for (let j = 1; j < CONFIG.GRID_DIVISIONS; j++) {
        const y = stepY * j;
        const hline = createSvgElement("line", {
          x1: 0,
          y1: y,
          x2: w,
          y2: y,
          class: "grid-inner",
        });
        tileGroup.appendChild(hline);
      }
    }
  }
}

function renderSubtiles(contentLayer) {
  state.subtiles.forEach((subtile) => {
    const geom = getGeometryById(subtile.geometryId);
    if (!geom) return;

    // Subtile group at its world position
    const subtileGroup = createSvgElement("g", {
      transform: `translate(${subtile.x},${subtile.y})`,
    });
    contentLayer.appendChild(subtileGroup);

    // Subtile outline
    const isSelected = subtile.id === state.selectedSubtileId;
    const subtileRect = createSvgElement("rect", {
      x: 0,
      y: 0,
      width: subtile.width,
      height: subtile.height,
      class: isSelected ? "subtile-selected" : "subtile",
    });
    subtileGroup.appendChild(subtileRect);

    // Geometry path
    if (geom.points.length >= 2) {
      const pathData = generatePathData(geom);
      let pathClass = "path";
      if (geom.id === state.selectedGeometryId) {
        pathClass += " geometry-selected";
      }

      const pathEl = createSvgElement("path", {
        d: pathData,
        class: pathClass,
      });
      subtileGroup.appendChild(pathEl);
    }

    // Points
    geom.points.forEach((p) => {
      const isPointSelected =
        geom.id === state.selectedGeometryId &&
        p.id === state.selectedPointId;
      const circle = createSvgElement("circle", {
        cx: p.x,
        cy: p.y,
        r: CONFIG.POINT_RADIUS / state.zoom,
        class: "point-handle" + (isPointSelected ? " selected" : ""),
      });
      subtileGroup.appendChild(circle);
    });

    // Control points (in edit mode)
    if (geom.id === state.selectedGeometryId && state.activeTool === 'edit') {
      geom.segments.forEach((segment, idx) => {
        if (segment.type === 'bezier' && segment.cp) {
          const p1 = geom.points[idx];
          const p2 = geom.points[(idx + 1) % geom.points.length];

          // Guide lines
          const line1 = createSvgElement("line", {
            x1: p1.x,
            y1: p1.y,
            x2: segment.cp.x,
            y2: segment.cp.y,
            stroke: "#6b7280",
            "stroke-width": 1 / state.zoom,
            "stroke-dasharray": `${4 / state.zoom},${4 / state.zoom}`,
          });
          subtileGroup.appendChild(line1);

          const line2 = createSvgElement("line", {
            x1: segment.cp.x,
            y1: segment.cp.y,
            x2: p2.x,
            y2: p2.y,
            stroke: "#6b7280",
            "stroke-width": 1 / state.zoom,
            "stroke-dasharray": `${4 / state.zoom},${4 / state.zoom}`,
          });
          subtileGroup.appendChild(line2);

          // Control point handle
          const isControlSelected = state.selectedSegmentIndex === idx;
          const cpCircle = createSvgElement("circle", {
            cx: segment.cp.x,
            cy: segment.cp.y,
            r: CONFIG.CONTROL_POINT_RADIUS / state.zoom,
            fill: isControlSelected ? "#f97316" : "#9ca3af",
            stroke: "#0f172a",
            "stroke-width": 1 / state.zoom,
            cursor: "pointer",
          });
          subtileGroup.appendChild(cpCircle);
        }
      });
    }
  });
}
