import { render } from 'preact';
import { App } from './components/App';
import { doc, emptyDoc } from './state/doc';
import * as UI from './state/ui';
import { visibleCells } from './state/derived';
import { toWorld } from './engine/lattice';
import { restore, startAutosave } from './state/persist';
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

render(<App />, document.getElementById('root')!);
