// The .visual document: pages that each hold a tree of nodes. Every node has an id that never changes, not when it
// is moved, renamed, restyled or saved, so Motion Studio can later tie animations to it.
// Positions are relative to the parent frame (or to the page for top-level nodes); rotation is stored but not yet
// editable on the canvas.
//
// This module is plain data + functions (no DOM), so it runs in the editor and in node tests alike.
import { solid } from './paint.js';

export const FORMAT = 'visual';
export const FORMAT_VERSION = 2;

export function newId(prefix = 'node') {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `${prefix}_${[...bytes].map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

// fills/strokes: see paint.js. effects: { type: 'drop-shadow' | 'inner-shadow', x, y, blur, spread, color, opacity,
// visible } or { type: 'layer-blur' | 'background-blur', radius, visible }. exports: { format: png|jpg|webp|svg, scale }.
const base = () => ({ rotation: 0, opacity: 1, visible: true, locked: false, fills: [], strokes: [], effects: [], exports: [] });

export const defaults = {
  frame: { ...base(), fills: [solid('#ffffff')], radius: 0, clip: true, children: [] },
  group: { ...base(), children: [] },
  rect: { ...base(), fills: [solid('#d9d9d9')], radius: 0 },
  ellipse: { ...base(), fills: [solid('#d9d9d9')] },
  text: {
    ...base(), fills: [solid('#000000')], text: '', fontFamily: 'Google Sans Flex', fontSize: 16, fontWeight: 400,
    lineHeight: 1.2, letterSpacing: 0, align: 'left', sizing: 'auto-width'
  }
};

// Containers hold children: a frame is a real box (size, fill, clipping), a group only keeps layers together and is
// always exactly as big as its content.
export const isContainer = n => n.type === 'frame' || n.type === 'group';

const typeNames = { frame: 'Frame', group: 'Group', rect: 'Rectangle', ellipse: 'Ellipse', text: 'Text' };

export function createNode(type, props = {}) {
  if (!defaults[type]) throw new Error(`Unknown node type: ${type}`);
  const node = { id: newId(), type, name: typeNames[type], x: 0, y: 0, w: 100, h: 100, ...structuredClone(defaults[type]), ...props };
  if (type === 'text' && !props.name) node.name = (node.text || 'Text').split('\n')[0].slice(0, 40) || 'Text';
  return node;
}

// Older files: version 1 had one colour in `fill`.
function migrate(node) {
  if (typeof node.fill === 'string') { node.fills = [solid(node.fill)]; delete node.fill; }
}

export function createPage(name = 'Page 1') {
  return { id: newId('page'), name, children: [] };
}

export function createDocument(name = 'Untitled') {
  const now = new Date().toISOString();
  return { format: FORMAT, version: FORMAT_VERSION, id: newId('doc'), name, created: now, modified: now, pages: [createPage()] };
}

// Checks and completes a document read from disk; throws on something that is not a .visual file.
export function parseDocument(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { throw new Error('This file is not a Visual document (no valid JSON).'); }
  if (doc?.format !== FORMAT || !Array.isArray(doc.pages)) throw new Error('This file is not a Visual document.');
  if (doc.version > FORMAT_VERSION) throw new Error(`This document was made with a newer Visual (format ${doc.version}). Update Visual to open it.`);
  if (!doc.pages.length) doc.pages.push(createPage());
  const seen = new Set();
  const fix = node => {
    const d = defaults[node.type];
    if (!d) throw new Error(`Unknown layer type "${node.type}" in this document.`);
    migrate(node);
    for (const [k, v] of Object.entries(d)) if (node[k] === undefined) node[k] = structuredClone(v);
    if (!node.id || seen.has(node.id)) node.id = newId();
    seen.add(node.id);
    node.children?.forEach(fix);
  };
  for (const page of doc.pages) { page.id ||= newId('page'); page.children ||= []; page.children.forEach(fix); }
  doc.version = FORMAT_VERSION;
  return doc;
}

export function serializeDocument(doc) {
  return JSON.stringify({ ...doc, modified: new Date().toISOString() }, null, 1);
}

// ---------- tree ----------

// Walks a page depth first: fn(node, parent, index, depth). parent is null for top-level nodes.
export function walk(nodes, fn, parent = null, depth = 0) {
  nodes.forEach((node, i) => {
    if (fn(node, parent, i, depth) === false) return;
    if (node.children) walk(node.children, fn, node, depth + 1);
  });
}

// id → { node, parent } for one page; rebuilt after every change (cheap next to drawing).
export function indexPage(page) {
  const map = new Map();
  walk(page.children, (node, parent) => { map.set(node.id, { node, parent }); });
  return map;
}

export const childrenOf = (page, parent) => parent ? parent.children : page.children;

// Absolute position of a node on the page.
export function absolute(index, id) {
  let x = 0, y = 0;
  for (let e = index.get(id); e; e = e.parent && index.get(e.parent.id)) { x += e.node.x; y += e.node.y; }
  return { x, y };
}

export function absoluteRect(index, id) {
  const { node } = index.get(id);
  const { x, y } = absolute(index, id);
  return { x, y, w: node.w, h: node.h };
}

export function isAncestor(index, ancestorId, id) {
  for (let e = index.get(id)?.parent; e; e = index.get(e.id)?.parent) if (e.id === ancestorId) return true;
  return false;
}

// Removes the node from wherever it is; returns { parent, index } of where it was.
export function detach(page, index, id) {
  const { parent } = index.get(id);
  const list = childrenOf(page, parent);
  const at = list.findIndex(n => n.id === id);
  list.splice(at, 1);
  return { parent, index: at };
}

// Puts node into parent (null = the page) at position `at` (default: on top), keeping where it is on screen.
export function reparent(page, index, id, parent, at) {
  const { node } = index.get(id);
  const abs = absolute(index, id);
  detach(page, index, id);
  const origin = parent ? absolute(index, parent.id) : { x: 0, y: 0 };
  node.x = abs.x - origin.x; node.y = abs.y - origin.y;
  const list = childrenOf(page, parent);
  list.splice(at ?? list.length, 0, node);
}

// A deep copy with new ids everywhere (duplicate, paste).
export function cloneWithNewIds(node) {
  const copy = structuredClone(node);
  const renew = n => { n.id = newId(); n.children?.forEach(renew); };
  renew(copy);
  return copy;
}

// Keeps only the topmost of the selected ids: a child inside a selected frame moves with the frame anyway.
export function topLevelOnly(index, ids) {
  return ids.filter(id => index.has(id) && !ids.some(other => other !== id && isAncestor(index, other, id)));
}

export function boundsOf(rects) {
  if (!rects.length) return null;
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
  const r = Math.max(...rects.map(r => r.x + r.w)), b = Math.max(...rects.map(r => r.y + r.h));
  return { x, y, w: r - x, h: b - y };
}

// Groups are always exactly the size of their content: after layers inside moved or changed, the group takes their
// bounds again and the children are shifted so nothing moves on screen. An empty group disappears.
export function fitGroups(nodes) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (!n.children) continue;
    fitGroups(n.children);
    if (n.type !== 'group') continue;
    if (!n.children.length) { nodes.splice(i, 1); continue; }
    const box = boundsOf(n.children);
    if (box.x || box.y) for (const c of n.children) { c.x -= box.x; c.y -= box.y; }
    n.x += box.x; n.y += box.y; n.w = box.w; n.h = box.h;
  }
}
