// Utility functions

let idCounter = 0;

export function makeId() {
  return "id_" + idCounter++;
}

export function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function createSvgElement(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const key in attrs) {
    if (key === "textContent") {
      el.textContent = attrs[key];
    } else {
      el.setAttribute(key, attrs[key]);
    }
  }
  return el;
}

export function clearSvg(svg) {
  while (svg.firstChild) {
    svg.removeChild(svg.firstChild);
  }
}
