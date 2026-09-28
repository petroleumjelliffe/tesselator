import { render } from 'preact';
import { App } from './components/App';
import { doc, emptyDoc } from './state/doc';
import * as UI from './state/ui';
import { visibleCells } from './state/derived';
import { toWorld } from './engine/lattice';
import { restore, startAutosave, rejectStoredDoc } from './state/persist';
import { exampleDoc } from './example';
import './styles.css';

const params = new URLSearchParams(location.search);
let restored = false;
if (params.has('example')) doc.value = exampleDoc();
else if (params.has('blank')) doc.value = emptyDoc();
else restored = restore();
UI.viewRestored.value = restored && !params.has('blank');   // App skips fitView when a view was restored
startAutosave();

if (import.meta.env.DEV) {
  (window as unknown as { __tess: unknown }).__tess = {
    doc: () => doc.value, view: () => UI.view.value, tool: () => UI.tool.value, selection: () => UI.selection.value, prefs: () => UI.prefs.value,
    visibleCells: () => visibleCells.value.length,
    toScreen: (u: number, v: number) => { const w = toWorld({ u, v }, doc.value.lattice), vw = UI.view.value; return { x: w.x * vw.zoom + vw.pan.x, y: w.y * vw.zoom + vw.pan.y }; },
  };
}

const root = document.getElementById('root')!;
try { render(<App />, root); }
catch (err) {
  // A restored document that parses but cannot be rendered must never brick the app on every reload.
  if (!restored) throw err;
  console.warn('rendering the stored document failed; starting empty', err);
  rejectStoredDoc();
  doc.value = emptyDoc(); UI.viewRestored.value = false;
  const fresh = document.createElement('div'); fresh.id = 'root'; root.replaceWith(fresh);   // no partial Preact tree to diff against
  render(<App />, fresh);
}
