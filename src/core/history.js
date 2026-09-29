// Undo/redo by snapshots of the whole document. One step per user action: a drag of two seconds is one step,
// because the editor calls begin() when it starts and commit() when it ends, however many changes happen in between.
export class History {
  constructor(limit = 200) { this.limit = limit; this.undoStack = []; this.redoStack = []; this.pending = null; }

  // state = { doc, selection } before a change.
  begin(state) { if (!this.pending) this.pending = snapshot(state); }

  // Closes the step begun with begin(); a step that changed nothing is dropped.
  commit(state) {
    if (!this.pending) return false;
    const before = this.pending; this.pending = null;
    if (before.json === JSON.stringify(state.doc)) return false;
    this.undoStack.push(before);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    return true;
  }

  cancel() { const p = this.pending; this.pending = null; return p && restore(p); }

  // Returns the state to show, or null when there is nothing to undo.
  undo(current) {
    if (this.pending) this.commit(current);
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push(snapshot(current));
    return restore(prev);
  }

  redo(current) {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(snapshot(current));
    return restore(next);
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  clear() { this.undoStack = []; this.redoStack = []; this.pending = null; }
}

const snapshot = ({ doc, selection = [], pageId }) => ({ json: JSON.stringify(doc), selection: [...selection], pageId });
const restore = s => ({ doc: JSON.parse(s.json), selection: s.selection, pageId: s.pageId });
