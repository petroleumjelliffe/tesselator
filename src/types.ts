export type UV = { u: number; v: number };
export type XY = { x: number; y: number };
export type Cell = { c: number; r: number };
export type Lattice = { ax: number; ay: number; bx: number; by: number };
export type Matrix = readonly [number, number, number, number, number, number];

export type Node = { pointId: string; cell: Cell; via?: Copy };   // via: the copy this node is seen through (bindingId never null)
export type Segment = { to: Node; cp: UV | null };          // cp relative to the previous node's cell origin
export type Style = { color: string; weight: number };
export type DocLayer = { id: string; name: string };                     // a document layer (the UI mode type below is `Layer`)
export type Path = { id: string; start: Node; segments: Segment[]; style: Style; layerId: string };
export type Point = UV & { id: string };

export type Element =
  | { id: string; kind: 'translate'; u: number; v: number }
  | { id: string; kind: 'mirror'; u: number; v: number; du: number; dv: number }
  | { id: string; kind: 'rotate'; u: number; v: number; n: number };
export type ElementKind = Element['kind'];

export type Binding = { id: string; pathId: string; groups: string[][] };   // ordered groups of ordered element ids
export type Fill = { id: string; u: number; v: number; color: string; layerId: string };

export type Doc = {
  version: 2;
  lattice: Lattice;
  points: Point[];
  paths: Path[];
  elements: Element[];
  bindings: Binding[];
  fills: Fill[];
  layers: DocLayer[];          // bottom to top
  newPathGroups: string[][];   // the groups every new path's binding receives
};

// A rendered copy of a path: the source in a cell, or a clone (binding + clone index, stored as `power`) in a cell.
export type Copy = { cell: Cell; bindingId: string | null; power: number };
export type CopyInfo = { pathId: string; copy: Copy; M: Matrix };

export type Layer = 'drawing' | 'construction';
export type Tool = 'select' | 'pen' | 'freehand' | 'fill';
export type View = { pan: XY; zoom: number };
export type Prefs = { style: Style; fillColor: string; snap: boolean; gridDivisions: number; ghostOpacity: number };

export type Selection =
  | null
  | { kind: 'path'; id: string; copy: Copy }
  | { kind: 'element'; id: string }
  | { kind: 'points'; ids: string[] }
  | { kind: 'fill'; id: string };

// Regions
export type WorldSeg = { a: XY; b: XY; cp: XY | null; source: { pathId: string; copy: Copy; j: number } };
export type Piece = { seg: WorldSeg; t0: number; t1: number; reversed: boolean };
export type Loop = { poly: XY[]; area: number; pieces: Piece[] };
export type Face = { outer: Loop; holes: Loop[]; area: number; centroid: XY };

export type BoxHandle = { x: number; y: number; ax: number; ay: number; cursor: string };
export type Box = { x0: number; y0: number; x1: number; y1: number };

export type HitTarget =
  | { kind: 'bbox'; h: number }
  | { kind: 'bboxrot' }
  | { kind: 'diamond'; pathId: string; j: number; copy: Copy }
  | { kind: 'point'; pointId: string; cell: Cell; via?: Copy }
  | { kind: 'canchor'; pathId: string; pointId: string; cell: Cell; copy: Copy }
  | { kind: 'segment'; pathId: string; j: number; copy: Copy }
  | { kind: 'fill'; fillId: string }
  | { kind: 'face'; face: Face }
  | { kind: 'elrot'; elementId: string }
  | { kind: 'eltip'; elementId: string }
  | { kind: 'element'; elementId: string }
  | { kind: 'lat'; which: 'a' | 'b' };

export type PointerKind = 'mouse' | 'pen' | 'touch';

export type DragBase = { target: HitTarget | null; start: XY; moved: boolean; pointerId: number; hitScale: number };
export type Drag = DragBase & (
  | { kind: 'click' }
  | { kind: 'marquee'; cur: XY; add: boolean }
  | { kind: 'pt'; pointId: string; cell: Cell; via?: Copy; snapTo: { pointId: string; cell: Cell } | null }
  | { kind: 'pts'; ids: string[]; startPos: Record<string, UV> }
  | { kind: 'body'; pathId: string; copy: Copy; ids: string[]; startPos: Record<string, UV>; startEls: Element[] }
  | { kind: 'canchor'; pathId: string; pointId: string; cell: Cell; copy: Copy }
  | { kind: 'cp'; pathId: string; j: number; copy: Copy }
  | { kind: 'bbox'; mode: 'scale' | 'rot'; h: BoxHandle; box: Box; cx: number; cy: number; pathId: string; copy: Copy; startDoc: Doc; M: Matrix | null }
  | { kind: 'free'; raw: XY[]; startNode: Node | null; cloneMatrices: Matrix[] }
  | { kind: 'fillpress' }
  | { kind: 'elc'; id: string; u0: number; v0: number }
  | { kind: 'elrot'; id: string }
  | { kind: 'eltip'; id: string }
  | { kind: 'lat'; which: 'a' | 'b' }
  | { kind: 'elmulti'; ids: string[]; startEls: Element[] }
);

// Omit that distributes over a union, so each Drag variant keeps its own fields.
export type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
export type DragSpec = DistributiveOmit<Drag, keyof DragBase>;
