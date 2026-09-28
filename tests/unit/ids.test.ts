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
