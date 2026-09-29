import { signal } from '@preact/signals';
import { CONFIG } from '../config';
import { makeId } from '../ids';
import type { Doc } from '../types';

export function emptyDoc(): Doc {
  return { version: 2, lattice: { ...CONFIG.LATTICE_PRESETS.Square }, points: [], paths: [], elements: [], bindings: [], fills: [], layers: [{ id: makeId('layer'), name: 'Layer 1' }], newPathGroups: [] };
}

// The committed document. Never mutated: actions draft(), mutate the draft, and commit() it (history.ts).
export const doc = signal<Doc>(emptyDoc());

export function draft(): Doc { return structuredClone(doc.value); }
