// Rendering logic
import { state, getGeometryById } from './state.js';
import { createSvgElement, clearSvg } from './utils.js';
import { CONFIG } from './config.js';

// Generate SVG path data from geometry points and segments
function generatePathData(geom) {
  if (geom.points.length === 0) return '';
  if (geom.points.length === 1) {
    // Single point, just move to it
    const p = geom.points[0];
    return `M ${p.x},${p.y}`;
  }

  let pathData = '';
  const numPoints = geom.points.length;
  const numSegments = geom.closed ? numPoints : numPoints - 1;

  // Start at first point
  pathData = `M ${geom.points[0].x},${geom.points[0].y}`;

  // Draw each segment
  for (let i = 0; i < numSegments; i++) {
    const p2 = geom.points[(i + 1) % numPoints];
    const segment = geom.segments[i];

    if (!segment || segment.type === 'line') {
      // Line segment
      pathData += ` L ${p2.x},${p2.y}`;
    } else if (segment.type === 'bezier' && segment.cp) {
      // Quadratic bezier segment
      pathData += ` Q ${segment.cp.x},${segment.cp.y} ${p2.x},${p2.y}`;
    }
  }

  return pathData;
}

export function render(svg, updateInstancePanel) {
  clearSvg(svg);

  const w = state.tileSize.x;
  const h = state.tileSize.y;

  // Root transform for pan/zoom
  const rootGroup = createSvgElement("g", {
    transform: `translate(${state.pan.x},${state.pan.y}) scale(${state.zoom})`,
  });
  svg.appendChild(rootGroup);

  // Layer 1: grid (all tiles)
  const gridLayer = createSvgElement("g", {});
  rootGroup.appendChild(gridLayer);

  renderGrid(gridLayer, w, h);

  // Layer 2: geometry (paths + points) on top of grids
  const contentLayer = createSvgElement("g", {});
  rootGroup.appendChild(contentLayer);

  renderContent(contentLayer, w, h);

  // Overlay status text (below bottom row)
  const overlay = createSvgElement("text", {
    x: -w,
    y: h * 2 + 24,
    class: "overlay-text",
    textContent: `Tool: ${state.activeTool.toUpperCase()} | Zoom: ${state.zoom.toFixed(
      2
    )} | Grid Snap: ${state.gridSnapping ? 'ON' : 'OFF'} | Geometries: ${state.geometries.length} | Instances: ${
      state.instances.length
    }`,
  });
  rootGroup.appendChild(overlay);

  if (updateInstancePanel) {
    updateInstancePanel();
  }
}

function renderGrid(gridLayer, w, h) {
  for (let row = -1; row <= 1; row++) {
    for (let col = -1; col <= 1; col++) {
      const tileGroup = createSvgElement("g", {
        transform: `translate(${col * w},${row * h})`,
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
          y2: h,
          class: "grid-inner",
        });
        tileGroup.appendChild(hline);
      }
    }
  }
}

function renderContent(contentLayer, w, h) {
  for (let row = -1; row <= 1; row++) {
    for (let col = -1; col <= 1; col++) {
      const tileGroup = createSvgElement("g", {
        transform: `translate(${col * w},${row * h})`,
      });
      contentLayer.appendChild(tileGroup);

      state.instances.forEach((inst) => {
        const geom = getGeometryById(inst.geometryId);
        if (!geom) return;

        const sx = inst.transform.mirrorX ? -1 : 1;
        const sy = inst.transform.mirrorY ? -1 : 1;
        const gInst = createSvgElement("g", {
          transform: `translate(${inst.transform.tx},${inst.transform.ty}) rotate(${inst.transform.rotation}) scale(${sx},${sy})`,
        });
        tileGroup.appendChild(gInst);

        // Path
        if (geom.points.length >= 2) {
          const pathData = generatePathData(geom);
          let pathClass = "path";
          if (inst.id === state.selectedInstanceId) {
            pathClass += " instance-selected";
          } else if (geom.id === state.selectedGeometryId) {
            pathClass += " geometry-selected";
          }

          const pathEl = createSvgElement("path", {
            d: pathData,
            class: pathClass,
          });
          gInst.appendChild(pathEl);
        }

        // Points (always draw, even if there's only one)
        geom.points.forEach((p) => {
          const isSelected =
            geom.id === state.selectedGeometryId &&
            p.id === state.selectedPointId;
          const circle = createSvgElement("circle", {
            cx: p.x,
            cy: p.y,
            r: CONFIG.POINT_RADIUS / state.zoom,
            class: "point-handle" + (isSelected ? " selected" : ""),
          });
          gInst.appendChild(circle);
        });

        // Control points (show when segment is selected or geometry is selected in edit mode)
        if (geom.id === state.selectedGeometryId && state.activeTool === 'edit') {
          geom.segments.forEach((segment, idx) => {
            if (segment.type === 'bezier' && segment.cp) {
              const p1 = geom.points[idx];
              const p2 = geom.points[(idx + 1) % geom.points.length];

              // Draw line from p1 to control point
              const line1 = createSvgElement("line", {
                x1: p1.x,
                y1: p1.y,
                x2: segment.cp.x,
                y2: segment.cp.y,
                stroke: "#6b7280",
                "stroke-width": 1 / state.zoom,
                "stroke-dasharray": `${4 / state.zoom},${4 / state.zoom}`,
              });
              gInst.appendChild(line1);

              // Draw line from control point to p2
              const line2 = createSvgElement("line", {
                x1: segment.cp.x,
                y1: segment.cp.y,
                x2: p2.x,
                y2: p2.y,
                stroke: "#6b7280",
                "stroke-width": 1 / state.zoom,
                "stroke-dasharray": `${4 / state.zoom},${4 / state.zoom}`,
              });
              gInst.appendChild(line2);

              // Draw control point handle
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
              gInst.appendChild(cpCircle);
            }
          });
        }
      });
    }
  }
}
