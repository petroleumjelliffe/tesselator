import { computed, signal, effect } from '@preact/signals';
import { CONFIG } from '../config';
import { doc } from './doc';
import { view, viewport, drag } from './ui';
import { visibleOffsets } from '../engine/lattice';
import { cellMatrix, compose, ownClones } from '../engine/transform';
import { anchorsWorld } from '../engine/hit';
import { computeFaces } from '../engine/regions';
import type { Matrix, Cell, Copy, CopyInfo, Doc, Face } from '../types';

export const cloneMatrices = computed(() => {
  const d = doc.value, m = new Map<string, Matrix[]>();
  for (const b of d.bindings) m.set(b.id, ownClones(b.ops, d.elements, d.lattice, CONFIG.ORBIT_CAP).matrices);
  return m;
});

export const openElements = computed(() => {
  const d = doc.value;
  return new Set(d.elements.filter((e) => ownClones([e.id], d.elements, d.lattice, CONFIG.ORBIT_CAP).open).map((e) => e.id));
});

export const visibleCells = computed<Cell[]>(() =>
  visibleOffsets(view.value, doc.value.lattice, viewport.value.width, viewport.value.height, CONFIG.VISIBLE_CELL_RADIUS));

export function copyMatrix(copy: Copy, d: Doc = doc.value, cm: Map<string, Matrix[]> = cloneMatrices.value): Matrix {
  const Mo = cellMatrix(copy.cell, d.lattice);
  if (!copy.bindingId) return Mo;
  const M = (cm.get(copy.bindingId) ?? [])[copy.power - 1];
  return M ? compose(Mo, M) : Mo;
}

// Every rendered copy in the visible cells: the source and each clone of every path.
export const copies = computed<CopyInfo[]>(() => {
  const d = doc.value, cm = cloneMatrices.value, out: CopyInfo[] = [];
  for (const cell of visibleCells.value) {
    const Mo = cellMatrix(cell, d.lattice);
    for (const p of d.paths) {
      out.push({ pathId: p.id, copy: { cell, bindingId: null, power: 0 }, M: Mo });
      for (const b of d.bindings) {
        if (b.pathId !== p.id) continue;
        (cm.get(b.id) ?? []).forEach((M, k) => out.push({ pathId: p.id, copy: { cell, bindingId: b.id, power: k + 1 }, M: compose(Mo, M) }));
      }
    }
  }
  return out;
});

export const anchors = computed(() => anchorsWorld(doc.value));

// Faces are recomputed on the next frame after a commit, never while a drag is in progress.
export const faces = signal<Face[]>([]);
const raf: (cb: () => void) => void = typeof requestAnimationFrame === 'function' ? (cb) => { requestAnimationFrame(cb); } : (cb) => cb();
let scheduled = false;
effect(() => {
  doc.value;
  if (drag.value || scheduled) return;
  scheduled = true;
  raf(() => { scheduled = false; faces.value = computeFaces(doc.peek()); });
});
