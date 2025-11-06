// State management with undo/redo support
export class StateManager {
  constructor() {
    this.state = {
      tileSize: { x: 300, y: 300 },
      geometries: [],
      instances: [],
      activeTool: "draw",
      currentDrawing: null,
      pan: { x: 0, y: 0 },
      zoom: 1,
      selectedGeometryId: null,
      selectedPointId: null,
      selectedInstanceId: null,
      dragging: null,
      spacePanning: false,
    };

    // Undo/redo history
    this.history = [];
    this.historyIndex = -1;
    this.maxHistory = 50;
    this.isRestoring = false;

    // ID counter
    this.idCounter = 0;
  }

  // Save current state to history
  saveState() {
    if (this.isRestoring) return;

    // Only save geometry, instances, and selections
    const snapshot = {
      geometries: this.clone(this.state.geometries),
      instances: this.clone(this.state.instances),
      selectedGeometryId: this.state.selectedGeometryId,
      selectedPointId: this.state.selectedPointId,
      selectedInstanceId: this.state.selectedInstanceId,
      currentDrawing: this.state.currentDrawing,
    };

    // Remove any future history if we're not at the end
    this.history = this.history.slice(0, this.historyIndex + 1);

    // Add new snapshot
    this.history.push(snapshot);
    this.historyIndex++;

    // Limit history size
    if (this.history.length > this.maxHistory) {
      this.history.shift();
      this.historyIndex--;
    }
  }

  // Undo to previous state
  undo() {
    if (this.historyIndex <= 0) return false;

    this.historyIndex--;
    this.restoreSnapshot(this.history[this.historyIndex]);
    return true;
  }

  // Redo to next state
  redo() {
    if (this.historyIndex >= this.history.length - 1) return false;

    this.historyIndex++;
    this.restoreSnapshot(this.history[this.historyIndex]);
    return true;
  }

  // Restore a snapshot
  restoreSnapshot(snapshot) {
    this.isRestoring = true;
    this.state.geometries = this.clone(snapshot.geometries);
    this.state.instances = this.clone(snapshot.instances);
    this.state.selectedGeometryId = snapshot.selectedGeometryId;
    this.state.selectedPointId = snapshot.selectedPointId;
    this.state.selectedInstanceId = snapshot.selectedInstanceId;
    this.state.currentDrawing = snapshot.currentDrawing;
    this.isRestoring = false;
  }

  // Check if undo is available
  canUndo() {
    return this.historyIndex > 0;
  }

  // Check if redo is available
  canRedo() {
    return this.historyIndex < this.history.length - 1;
  }

  // Utility: deep clone
  clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // Generate unique ID
  makeId() {
    return "id_" + this.idCounter++;
  }

  // Get state
  getState() {
    return this.state;
  }

  // Update state (for non-geometry changes that don't need history)
  updateState(updates) {
    Object.assign(this.state, updates);
  }
}
