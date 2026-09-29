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
