// The editor's state (document, page, selection, camera, tool) and every action that changes it. The canvas and
// the panels only call these methods and listen for 'change'; they never edit the document on their own, so every
// change goes through the undo history.
import {
  absolute, absoluteRect, boundsOf, childrenOf, cloneWithNewIds, createDocument, createNode, createPage, detach, indexPage,
  isAncestor, reparent, topLevelOnly, walk
} from '../core/document.js';
import { fitRect, pointInEllipse, pointInRect, zoomAt } from '../core/geometry.js';
import { History } from '../core/history.js';
import { fitTextSize } from '../core/text.js';
import { measurer } from '../render/renderer.js';

export class Editor extends EventTarget {
  constructor() {
    super();
    this.history = new History();
    this.doc = null; this.path = null; this.dirty = false;
    this.pageId = null; this.selection = [];
    this.cameras = {};           // pageId → { x, y, zoom }
    this.tool = 'move';
    this.hoverId = null; this.editingTextId = null; this.drag = null;
    this.clipboard = null;
    this._index = null;
    this.viewport = { w: 1200, h: 800 };
  }

  // ---------- document ----------
  load(doc, path = null) {
    this.doc = doc; this.path = path; this.dirty = false;
    this.pageId = doc.pages[0].id; this.selection = []; this.cameras = {};
    this.history.clear(); this.editingTextId = null; this.hoverId = null; this.tool = 'move';
    this._index = null;
    this.refitText();
    this.zoomToFit(false);
    this.emit({ doc: true, selection: true, file: true, page: true });
  }

  newDocument(name, frame, pageName) {
    const doc = createDocument(name);
    if (pageName) doc.pages[0].name = pageName;
    if (frame) doc.pages[0].children.push(createNode('frame', { x: 0, y: 0, ...frame }));
    this.load(doc);
  }

  get page() { return this.doc?.pages.find(p => p.id === this.pageId) || null; }
  get index() { return this._index ||= indexPage(this.page); }
  get camera() { return this.cameras[this.pageId] ||= { x: -200, y: -150, zoom: 1 }; }
  set camera(c) { this.cameras[this.pageId] = c; this.emit({ camera: true }); }
  node(id) { return this.index.get(id)?.node || null; }
  get selectedNodes() { return this.selection.map(id => this.node(id)).filter(Boolean); }

  // What changed: doc, selection, camera, tool, page, file (path/dirty). Panels redraw what they need.
  emit(what) {
    if (what.doc) this._index = null;
    this.dispatchEvent(Object.assign(new Event('change'), { what }));
  }

  // ---------- history ----------
  state() { return { doc: this.doc, selection: this.selection, pageId: this.pageId }; }
  begin() { this.history.begin(this.state()); }
  commit() {
    if (this.history.commit(this.state())) { this.dirty = true; this.emit({ file: true }); }
  }
  // One undo step around fn.
  transact(fn) {
    this.begin();
    try { fn(); } finally { this._index = null; this.commit(); this.emit({ doc: true, selection: true }); }
  }
  undo() { this.restore(this.history.undo(this.state())); }
  redo() { this.restore(this.history.redo(this.state())); }
  restore(s) {
    if (!s) return;
    this.stopEditingText(false);
    this.doc = s.doc; this.pageId = this.doc.pages.some(p => p.id === s.pageId) ? s.pageId : this.doc.pages[0].id;
    this._index = null;
    this.selection = s.selection.filter(id => this.index.has(id));
    this.dirty = true;
    this.emit({ doc: true, selection: true, page: true, file: true });
  }
  markSaved(path) { this.path = path; this.dirty = false; this.emit({ file: true }); }

  // ---------- selection ----------
  select(ids, { add = false, toggle = false } = {}) {
    const index = this.index;
    let next = add || toggle ? [...this.selection] : [];
    for (const id of ids) {
      if (!index.has(id)) continue;
      const at = next.indexOf(id);
      if (toggle && at >= 0) { next.splice(at, 1); continue; }
      if (at >= 0) continue;
      // A layer and its own parent can't both be selected: the one added last wins.
      next = next.filter(o => !isAncestor(index, o, id) && !isAncestor(index, id, o));
      next.push(id);
    }
    if (same(next, this.selection)) return;
    this.selection = next;
    this.emit({ selection: true });
  }
  clearSelection() { this.select([]); }

  selectionBounds() {
    const index = this.index;
    return boundsOf(this.selection.filter(id => index.has(id)).map(id => absoluteRect(index, id)));
  }

  selectAll() {
    // Ctrl+A selects the siblings of the current selection, or everything at the top of the page.
    const first = this.index.get(this.selection[0]);
    const list = first ? childrenOf(this.page, first.parent) : this.page.children;
    this.select(list.filter(n => n.visible && !n.locked).map(n => n.id));
  }

  selectParent() {
    const e = this.index.get(this.selection[0]);
    if (e?.parent) this.select([e.parent.id]); else this.clearSelection();
  }

  selectChildren() {
    const kids = this.selectedNodes.flatMap(n => n.children || []).filter(n => n.visible && !n.locked);
    if (kids.length) this.select(kids.map(n => n.id));
  }

  // ---------- hit testing ----------
  // The chain of layers under a world point, from the top-level layer down to the deepest one.
  hitPath(p) {
    const search = (nodes, ox, oy) => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (!n.visible) continue;
        const r = { x: ox + n.x, y: oy + n.y, w: n.w, h: n.h };
        const inside = n.type === 'ellipse' ? pointInEllipse(p, r) : pointInRect(p, r);
        if (n.children && (!n.clip || inside)) {
          const sub = search(n.children, r.x, r.y);
          if (sub) return n.locked ? null : [n, ...sub];
        }
        if (inside && !n.locked) return [n];
      }
      return null;
    };
    return search(this.page.children, 0, 0) || [];
  }

  // Which layer a click selects. Like other design tools: a click inside a top-level frame picks its direct child
  // (a card, not the text inside the card); once something is selected, clicks stay at that level; Ctrl picks the
  // deepest layer. An empty spot of a frame that has content starts a selection rectangle instead (returns null).
  pick(p, { deep = false } = {}) {
    const path = this.hitPath(p);
    if (!path.length) return null;
    if (deep) return path.at(-1).id;
    const index = this.index, sel = new Set(this.selection);
    for (let i = path.length - 1; i >= 0; i--) if (sel.has(path[i].id)) return path[i].id;
    for (let i = 0; i < path.length - 1; i++) {
      if (this.selection.some(id => index.get(id)?.parent?.id === path[i].id)) return path[i + 1].id;
    }
    const top = path[0];
    if (top.type === 'frame' && top.children.length) return path[1]?.id ?? null;
    return top.id;
  }

  // The topmost frame (not one of `exclude` or inside them) that contains the world point: where dropped layers go.
  frameAt(p, exclude = []) {
    const index = this.index;
    const skip = id => exclude.includes(id) || exclude.some(e => isAncestor(index, e, id));
    let found = null;
    const search = (nodes, ox, oy) => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (n.type !== 'frame' || !n.visible || skip(n.id)) continue;
        const r = { x: ox + n.x, y: oy + n.y, w: n.w, h: n.h };
        if (pointInRect(p, r)) { found = n; search(n.children, r.x, r.y); return; }
      }
    };
    search(this.page.children, 0, 0);
    return found;
  }

  // Frame names above top-level frames are click targets too.
  frameLabelAt(screen) {
    const cam = this.camera;
    for (let i = this.page.children.length - 1; i >= 0; i--) {
      const n = this.page.children[i];
      if (n.type !== 'frame' || !n.visible || n.locked) continue;
      const x = (n.x - cam.x) * cam.zoom, y = (n.y - cam.y) * cam.zoom;
      if (screen.x >= x && screen.x <= x + Math.max(n.w * cam.zoom, 60) && screen.y >= y - 18 && screen.y <= y) return n.id;
    }
    return null;
  }

  // ---------- creating and changing layers ----------
  // Adds a layer at world position (x, y) inside `parent` (a frame node or null); returns it.
  addNode(type, props, parent = null) {
    const node = createNode(type, props);
    if (parent) {
      const origin = absolute(this.index, parent.id);
      node.x -= origin.x; node.y -= origin.y;
    }
    childrenOf(this.page, parent).push(node);
    this._index = null;
    if (type === 'text') this.fit(node);
    return node;
  }

  // Changes properties of layers: patch is an object or a function (node) → object. Text is resized to fit.
  setProps(ids, patch) {
    for (const id of ids) {
      const node = this.node(id);
      if (!node) continue;
      const values = typeof patch === 'function' ? patch(node) : patch;
      if (!values) continue;
      if (node.type === 'text' && 'text' in values && node.name === textName(node.text)) node.name = textName(values.text);
      Object.assign(node, values);
      if (node.type === 'text') this.fit(node);
    }
    this.emit({ doc: true });
  }
  // setProps as its own undo step (for the panels).
  update(ids, patch) { this.transact(() => this.setProps(ids, patch)); }

  fit(node) { Object.assign(node, fitTextSize(node, measurer(node))); }
  refitText() {
    if (!this.doc) return;
    for (const page of this.doc.pages) walk(page.children, n => { if (n.type === 'text') this.fit(n); });
    this._index = null;
  }

  deleteSelection() {
    if (!this.selection.length) return;
    this.transact(() => {
      for (const id of topLevelOnly(this.index, this.selection)) { detach(this.page, this.index, id); this._index = null; }
      this.selection = [];
    });
  }

  // Copies of the selection right above the originals, offset by `offset`; the copies become the selection.
  duplicateSelection(offset = { x: 0, y: 0 }, { transaction = true } = {}) {
    const run = () => {
      const index = this.index;
      const copies = topLevelOnly(index, this.selection).map(id => {
        const { node, parent } = index.get(id);
        const copy = cloneWithNewIds(node);
        copy.x += offset.x; copy.y += offset.y;
        const list = childrenOf(this.page, parent);
        list.splice(list.indexOf(node) + 1, 0, copy);
        return copy.id;
      });
      this._index = null;
      this.selection = copies;
    };
    if (transaction) this.transact(run); else run();
  }

  nudge(dx, dy) {
    const ids = topLevelOnly(this.index, this.selection);
    if (!ids.length) return;
    this.transact(() => { for (const id of ids) { const n = this.node(id); n.x += dx; n.y += dy; } });
  }

  // Moves layers in the tree: into `parent` (null = page) at position `at` of its children (the end is on top).
  moveLayers(ids, parent, at) {
    const index = this.index;
    ids = topLevelOnly(index, ids).filter(id => !parent || (id !== parent.id && !isAncestor(index, id, parent.id)));
    if (!ids.length) return;
    this.transact(() => {
      const list = childrenOf(this.page, parent);
      const nodes = ids.map(id => this.node(id));
      // Positions shift when layers above `at` in the same list are taken out first.
      const before = nodes.filter(n => list.indexOf(n) >= 0 && list.indexOf(n) < at).length;
      let pos = at - before;
      for (const id of ids) {
        reparent(this.page, this.index, id, parent, pos++);
        this._index = null;
      }
      this.selection = ids;
    });
  }

  // Bring forward (+1) / send backward (-1), or to the front / back (±Infinity).
  arrange(step) {
    const index = this.index;
    const ids = topLevelOnly(index, this.selection);
    if (!ids.length) return;
    this.transact(() => {
      const moving = step > 0 ? [...ids].reverse() : ids;
      for (const id of moving) {
        const { node, parent } = this.index.get(id);
        const list = childrenOf(this.page, parent);
        const from = list.indexOf(node);
        const to = Math.max(0, Math.min(list.length - 1, from + (Number.isFinite(step) ? step : step > 0 ? list.length : -list.length)));
        list.splice(from, 1); list.splice(to, 0, node);
      }
      this._index = null;
    });
  }

  toggle(ids, key) {
    const nodes = ids.map(id => this.node(id)).filter(Boolean);
    const value = !nodes.every(n => n[key]);
    this.update(ids, { [key]: value });
    if (key === 'locked' && value || key === 'visible' && !value) this.select(this.selection.filter(id => !ids.includes(id)));
  }

  rename(id, name) { if (name.trim()) this.update([id], { name: name.trim() }); }

  // ---------- clipboard (inside Visual for now) ----------
  copy() {
    const index = this.index;
    const ids = topLevelOnly(index, this.selection);
    if (!ids.length) return false;
    this.clipboard = ids.map(id => ({ node: structuredClone(index.get(id).node), abs: absolute(index, id) }));
    return true;
  }
  cut() { if (this.copy()) this.deleteSelection(); }
  paste() {
    if (!this.clipboard?.length) return;
    this.transact(() => {
      // Into the selected frame if there is one, otherwise next to the originals (or on the page).
      const target = this.selectedNodes.length === 1 && this.selectedNodes[0].type === 'frame' ? this.selectedNodes[0] : null;
      const origin = target ? absolute(this.index, target.id) : { x: 0, y: 0 };
      const ids = [];
      for (const { node, abs } of this.clipboard) {
        const copy = cloneWithNewIds(node);
        copy.x = abs.x - origin.x + (target ? 0 : 20); copy.y = abs.y - origin.y + (target ? 0 : 20);
        childrenOf(this.page, target).push(copy);
        ids.push(copy.id);
      }
      this.clipboard = this.clipboard.map(c => ({ ...c, abs: { x: c.abs.x + (target ? 0 : 20), y: c.abs.y + (target ? 0 : 20) } }));
      this._index = null;
      this.selection = ids;
    });
  }

  // ---------- text editing ----------
  startEditingText(id) {
    if (this.node(id)?.type !== 'text') return;
    this.begin();
    this.editingTextId = id; this.select([id]);
    this.emit({ editing: true });
  }
  stopEditingText(commit = true) {
    const id = this.editingTextId;
    if (!id) return;
    this.editingTextId = null;
    const node = this.node(id);
    // An empty text layer disappears, as in other editors.
    if (node && !node.text.trim()) { detach(this.page, this.index, id); this._index = null; this.selection = this.selection.filter(s => s !== id); }
    if (commit) this.commit(); else this.history.cancel();
    this.emit({ doc: true, selection: true, editing: true });
  }

  // ---------- pages ----------
  setPage(id) {
    if (id === this.pageId || !this.doc.pages.some(p => p.id === id)) return;
    this.stopEditingText();
    this.pageId = id; this.selection = []; this._index = null;
    if (!this.cameras[id]) this.zoomToFit(false);
    this.emit({ page: true, selection: true, doc: true });
  }
  addPage(name) {
    const page = createPage(name);
    this.transact(() => { this.doc.pages.push(page); });
    this.setPage(page.id);
  }
  deletePage(id) {
    if (this.doc.pages.length < 2) return;
    this.transact(() => {
      this.doc.pages = this.doc.pages.filter(p => p.id !== id);
      if (this.pageId === id) { this.pageId = this.doc.pages[0].id; this.selection = []; }
    });
    this.emit({ page: true });
  }
  renamePage(id, name) {
    if (!name.trim()) return;
    this.transact(() => { this.doc.pages.find(p => p.id === id).name = name.trim(); });
    this.emit({ page: true });
  }
  renameDocument(name) {
    if (!name.trim() || name.trim() === this.doc.name) return;
    this.transact(() => { this.doc.name = name.trim(); });
  }

  // ---------- tools and camera ----------
  setTool(tool) {
    if (this.tool === tool) return;
    this.stopEditingText();
    this.tool = tool;
    this.emit({ tool: true });
  }

  zoomBy(factor, at = { x: this.viewport.w / 2, y: this.viewport.h / 2 }) { this.camera = zoomAt(this.camera, at, this.camera.zoom * factor); }
  zoomTo(zoom) { this.camera = zoomAt(this.camera, { x: this.viewport.w / 2, y: this.viewport.h / 2 }, zoom); }
  zoomToRect(rect, maxZoom = 1) { if (rect) this.camera = fitRect(rect, this.viewport.w, this.viewport.h, { maxZoom }); }
  zoomToFit(emit = true) {
    const page = this.page;
    const box = boundsOf(page.children.filter(n => n.visible));
    const cam = box ? fitRect(box, this.viewport.w, this.viewport.h) : { x: -this.viewport.w / 2, y: -this.viewport.h / 2, zoom: 1 };
    if (emit) this.camera = cam; else this.cameras[this.pageId] = cam;
  }
  zoomToSelection() { this.zoomToRect(this.selectionBounds(), 4); }

  // Where a new frame from the presets goes: right of everything on the page.
  freeSpot() {
    const box = boundsOf(this.page.children);
    return box ? { x: Math.round(box.x + box.w + 100), y: Math.round(box.y) } : { x: 0, y: 0 };
  }
  addFramePreset(preset) {
    let node;
    this.transact(() => {
      node = this.addNode('frame', { name: preset.name, w: preset.w, h: preset.h, ...this.freeSpot() });
      this.selection = [node.id];
    });
    this.setTool('move');
    this.zoomToRect(absoluteRect(this.index, node.id));
  }
}

export const textName = text => (String(text).split('\n')[0].trim().slice(0, 40)) || 'Text';
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
