import { test, expect } from 'vitest';
import { serializeDoc, parseDoc, exportSvg } from '../../src/engine/serialize';
import { exampleDoc } from '../../src/example';
import { CONFIG } from '../../src/config';

test('JSON round trip preserves the document; foreign or malformed input is refused', () => {
  const d = exampleDoc();
  expect(parseDoc(serializeDoc(d))).toEqual(d);
  expect(parseDoc(JSON.stringify({ ...d, version: 3 }))).toBe(null);
  expect(parseDoc('{"version":1}')).toBe(null);
  expect(parseDoc('not json')).toBe(null);
});

test('tile export is clipped to the cell polygon and draws the 3x3 window', () => {
  const svg = exportSvg(exampleDoc(), { kind: 'tile' });
  expect(svg).toContain('viewBox="0 0 240 240"');
  expect(svg).toContain('<clipPath id="clip"><polygon points="0,0 240,0 240,240 0,240"');
  expect(svg.match(/<use href="#cell-layer-/g)).toHaveLength(18);   // two layers × 9 cells
  expect(svg).toContain('id="cell-layer-');
  expect(svg).toContain('fill-rule="evenodd"');
});

test('a point missing id is refused', () => {
  const d = exampleDoc();
  const bad = { ...d, points: d.points.map((p, i) => (i === 0 ? { u: p.u, v: p.v } : p)) };
  expect(parseDoc(JSON.stringify(bad))).toBe(null);
});

test('a segment with a non-numeric control point is refused', () => {
  const d = exampleDoc();
  const bad = {
    ...d,
    paths: d.paths.map((p, i) => (i === 0 ? { ...p, segments: p.segments.map((s, j) => (j === 0 ? { ...s, cp: { u: 'x', v: 0 } } : s)) } : p)),
  };
  expect(parseDoc(JSON.stringify(bad))).toBe(null);
});

test('the example document still round trips after entity validation', () => {
  const d = exampleDoc();
  expect(parseDoc(serializeDoc(d))).toEqual(d);
});

test('grid export covers the requested cells with a rect clip', () => {
  const three = exportSvg(exampleDoc(), { kind: 'grid', rows: 3, cols: 3 });
  expect(three).toContain('viewBox="0 0 720 720"');
  expect(three.match(/<use href="#cell-layer-/g)).toHaveLength(18);
  const wall = exportSvg(exampleDoc(), { kind: 'grid', rows: 8, cols: 12 });
  expect(wall).toContain('viewBox="0 0 2880 1920"');
  const hex = { ...exampleDoc(), lattice: { ...CONFIG.LATTICE_PRESETS['Hex / triangle'] } };
  expect((exportSvg(hex, { kind: 'grid', rows: 3, cols: 3 }).match(/<use href="#cell-layer-/g) ?? []).length).toBeGreaterThan(18);
  expect(() => exportSvg(exampleDoc(), { kind: 'grid', rows: 65, cols: 1 })).toThrow();
  expect(() => exportSvg(exampleDoc(), { kind: 'grid', rows: 0, cols: 3 })).toThrow();
});

test('a node whose pointId is not in points is refused', () => {
  const d = exampleDoc();
  const bad = { ...d, paths: d.paths.map((p, i) => (i === 0 ? { ...p, start: { ...p.start, pointId: 'pt_missing' } } : p)) };
  expect(parseDoc(JSON.stringify(bad))).toBe(null);
  const bad2 = { ...d, paths: d.paths.map((p, i) => (i === 0 ? { ...p, segments: p.segments.map((s, j) => (j === 0 ? { ...s, to: { ...s.to, pointId: 'pt_missing' } } : s)) } : p)) };
  expect(parseDoc(JSON.stringify(bad2))).toBe(null);
});

test('a binding whose pathId is not in paths is refused', () => {
  const d = exampleDoc();
  expect(d.bindings.length).toBeGreaterThan(0);
  const bad = { ...d, bindings: d.bindings.map((b, i) => (i === 0 ? { ...b, pathId: 'path_missing' } : b)) };
  expect(parseDoc(JSON.stringify(bad))).toBe(null);
});

test('export writes one group per layer in document order, fills before strokes inside a layer', () => {
  const d = exampleDoc();
  const svg = exportSvg(d, { kind: 'tile' });
  const ids = [...svg.matchAll(/<g id="cell-layer-([^"]+)">/g)].map((m) => m[1]);
  expect(ids).toEqual(d.layers.map((l) => l.id));
  const outline = svg.slice(svg.indexOf(`<g id="cell-layer-${d.layers[0].id}">`), svg.indexOf(`<g id="cell-layer-${d.layers[1].id}">`));
  const fillAt = outline.indexOf('fill-rule="evenodd"');
  expect(fillAt).toBeGreaterThanOrEqual(0);
  expect(fillAt).toBeLessThan(outline.indexOf('stroke-linecap'));
});

test('exported colours are escaped so a hostile colour string cannot break the SVG', () => {
  const d = exampleDoc();
  const hostile = { ...d, paths: d.paths.map((p, i) => (i === 0 ? { ...p, style: { ...p.style, color: '"><script>' } } : p)) };
  const svg = exportSvg(hostile, { kind: 'tile' });
  expect(svg).not.toContain('<script>');
  expect(svg).toContain('&quot;&gt;&lt;script&gt;');
});
