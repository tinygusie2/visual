// Components, instances and colour variables: plain functions on the document (no DOM), run by the editor after
// every change, like auto layout.
//
// A component is a frame with `component: true`, the main copy. An instance is a frame with `instanceOf` (the
// component's id) and `overrides`; its children are a copy of the component's content, made again by syncInstances
// after every change, so they follow the component. Each layer in that copy has `ref`, the id of the layer it copies
// in the component, and the id `<instance id>;<ref>`, so it is the same every time the copy is made (Motion Studio
// ties animations to ids). What was changed in an instance is kept in `overrides`: ref → { prop: value }, with the
// component's own id for the instance itself, and put back on top of each new copy. Where layers sit and how big
// they are comes from the component (with its auto layout and constraints at the instance's size), so that can't be
// overridden. A component that holds instances of other components is brought up to date after those.
//
// Colour variables: doc.variables = [{ id, name, color }]. A solid fill, a stroke or a shadow can be bound to one
// (`variable: id`). Its colour stays filled in, so drawing, export and Motion Studio just read colours, and
// applyVariables writes the variable's colour into it after every change.
import { newId, walk } from './document.js';
import { resizeContent } from './layout.js';

// What belongs to an instance itself (not taken from the component) and what a layer inside one can't override.
const OWN = new Set(['id', 'type', 'name', 'x', 'y', 'w', 'h', 'rotation', 'visible', 'locked', 'constraints', 'widthMode',
  'heightMode', 'absolute', 'exports', 'instanceOf', 'overrides', 'component', 'ref', 'children']);
const FIXED = new Set(['id', 'type', 'ref', 'children', 'x', 'y', 'w', 'h', 'rotation', 'constraints', 'widthMode', 'heightMode',
  'absolute', 'layout', 'sizing', 'path', 'vw', 'vh', 'fillRule', 'instanceOf', 'overrides', 'component', 'exports']);
export const canOverride = (key, isRoot) => !(isRoot ? OWN : FIXED).has(key);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Every component in the document: id → node.
export function componentMap(doc) {
  const map = new Map();
  for (const page of doc.pages) walk(page.children, n => { if (n.component) map.set(n.id, n); });
  return map;
}

// Where a component is: { node, page }.
export function findComponent(doc, id) {
  for (const page of doc.pages) {
    let found = null;
    walk(page.children, n => { if (found) return false; if (n.id === id && n.component) found = n; });
    if (found) return { node: found, page };
  }
  return null;
}

// The outermost instance a layer is part of (not the layer itself), or null. index: indexPage map.
export function ownerInstance(index, id) {
  let owner = null;
  for (let p = index.get(id)?.parent; p; p = index.get(p.id)?.parent) if (p.instanceOf) owner = p;
  return owner;
}

// Does component `id` contain (through instances, at any depth) an instance of `target`, or is it `target`?
export function dependsOn(comps, id, target, seen = new Set()) {
  if (id === target) return true;
  if (seen.has(id)) return false;
  seen.add(id);
  const c = comps.get(id);
  let hit = false;
  if (c) walk(c.children, n => { if (hit) return false; if (n.instanceOf) { hit = dependsOn(comps, n.instanceOf, target, seen); return false; } });
  return hit;
}

// Makes the instance a fresh copy of the component at the instance's size, with its overrides on top.
// fit(textNode) sizes text again after its text or font changed.
export function syncInstance(inst, comp, fit) {
  const copy = structuredClone(comp);
  const rename = (n, src) => {
    n.ref = src.id; n.id = `${inst.id};${src.id}`;
    delete n.component;
    n.children?.forEach((c, i) => rename(c, src.children[i]));
  };
  copy.children.forEach((c, i) => rename(c, comp.children[i]));
  for (const k of Object.keys(copy)) if (!OWN.has(k)) inst[k] = copy[k];
  inst.children = copy.children;

  const overrides = inst.overrides ||= {};
  const apply = (n, key, root) => {
    const o = overrides[key];
    if (!o) return false;
    for (const [k, v] of Object.entries(o)) {
      // A value that is the same as the component's again is no longer an override.
      if (!canOverride(k, root) || same(n[k], v)) { delete o[k]; continue; }
      n[k] = structuredClone(v);
    }
    if (!Object.keys(o).length) delete overrides[key];
    return true;
  };
  apply(inst, comp.id, true);
  // The content follows the instance's size the way it follows a resized frame (constraints); auto layout places
  // it afterwards.
  if ((inst.w !== comp.w || inst.h !== comp.h) && !inst.layout) {
    resizeContent(inst, { ...inst, w: comp.w, h: comp.h, children: structuredClone(inst.children) }, fit);
  }
  walk(inst.children, n => { if (apply(n, n.ref, false) && n.type === 'text') fit?.(n); return true; });
  // Overrides for layers the component no longer has are dropped.
  const refs = new Set([comp.id]);
  walk(inst.children, n => { refs.add(n.ref); });
  for (const key of Object.keys(overrides)) if (!refs.has(key)) delete overrides[key];
}

// Brings every instance in the document up to date. Instances inside another instance are part of its copy.
// Returns the ids of instances whose component is missing or that (through others) contain themselves.
export function syncInstances(doc, fit) {
  const comps = componentMap(doc);
  const depth = new Map();
  const depthOf = (id, seen = new Set()) => {
    if (depth.has(id)) return depth.get(id);
    const c = comps.get(id);
    if (!c || seen.has(id)) return Infinity;
    seen.add(id);
    let d = 0;
    walk(c.children, n => { if (n.instanceOf) { d = Math.max(d, depthOf(n.instanceOf, seen) + 1); return false; } });
    seen.delete(id);
    depth.set(id, d);
    return d;
  };
  const list = [];
  for (const page of doc.pages) walk(page.children, n => { if (n.instanceOf) { list.push(n); return false; } });
  list.sort((a, b) => depthOf(a.instanceOf) - depthOf(b.instanceOf));
  const broken = [];
  for (const inst of list) {
    if (Number.isFinite(depthOf(inst.instanceOf))) syncInstance(inst, comps.get(inst.instanceOf), fit);
    else broken.push(inst.id);
  }
  return broken;
}

// Which of `values` a layer in an instance (or the instance itself) takes; overridable ones are remembered in the
// instance's overrides. inst: the instance that owns the copy (see ownerInstance), node: the layer being changed.
export function overrideValues(inst, node, values) {
  const root = node === inst;
  const key = root ? inst.instanceOf : node.ref;
  const taken = {};
  for (const [k, v] of Object.entries(values)) {
    if (!canOverride(k, root)) { if (root) taken[k] = v; continue; }
    taken[k] = v;
    if (!key) continue;
    inst.overrides ||= {};
    inst.overrides[key] = { ...inst.overrides[key], [k]: structuredClone(v) };
  }
  return taken;
}

// How many layer properties an instance changes.
export const overrideCount = inst => Object.values(inst.overrides || {}).reduce((s, o) => s + Object.keys(o).length, 0);

// A new instance of a component (not yet in the document): same look and size, its own id.
export function makeInstance(comp, props = {}) {
  const inst = structuredClone({ ...comp, children: [] });
  delete inst.component; delete inst.ref;
  Object.assign(inst, { id: newId(), instanceOf: comp.id, overrides: {}, exports: [], constraints: { h: 'left', v: 'top' }, absolute: false }, props);
  syncInstance(inst, comp);
  return inst;
}

// An instance becomes an ordinary frame with the content it shows now. Instances nested in it stay instances of
// their own component, with the changes made to them through this instance moved into their own overrides.
export function detachInstance(inst) {
  const overrides = inst.overrides || {};
  delete inst.instanceOf; delete inst.overrides;
  const free = nodes => {
    for (const n of nodes) {
      if (n.instanceOf) {
        const prefix = `${n.ref};`;
        n.overrides = structuredClone(n.overrides || {});
        for (const [key, o] of Object.entries(overrides)) {
          const own = key === n.ref ? n.instanceOf : key.startsWith(prefix) ? key.slice(prefix.length) : null;
          if (own) n.overrides[own] = { ...n.overrides[own], ...structuredClone(o) };
        }
        delete n.ref;
        continue;
      }
      delete n.ref;
      if (n.children) free(n.children);
    }
  };
  free(inst.children);
}

// Turns components in a fresh copy (duplicate, paste) into instances of the originals: there is one main copy.
// copy and original have the same shape; has(id) says whether the original component is in this document.
export function instancify(copy, original, has) {
  if (original.component && has(original.id)) {
    delete copy.component;
    Object.assign(copy, { instanceOf: original.id, overrides: {} });
    return;
  }
  copy.children?.forEach((c, i) => instancify(c, original.children[i], has));
}

// ---------- colour variables ----------
export const colorVariable = (name, color) => ({ id: newId('var'), name, color });

const paintsOf = n => [...(n.fills || []), ...(n.strokes || []), ...(n.effects || [])];

export function applyVariables(doc) {
  const vars = new Map((doc.variables || []).map(v => [v.id, v]));
  if (!vars.size) return;
  for (const page of doc.pages) walk(page.children, n => {
    for (const p of paintsOf(n)) { const v = p.variable && vars.get(p.variable); if (v) p.color = v.color; }
  });
}

// Paints bound to variables that aren't in `keep` lose the binding (their colour stays).
export function unbindVariables(nodes, keep) {
  const unbind = p => { if (p.variable && !keep.has(p.variable)) delete p.variable; };
  walk(nodes, n => {
    paintsOf(n).forEach(unbind);
    for (const o of Object.values(n.overrides || {})) for (const k of ['fills', 'strokes', 'effects']) o[k]?.forEach(unbind);
  });
}

// How many paints use each variable: id → count.
export function variableUsage(doc) {
  const count = new Map();
  for (const page of doc.pages) walk(page.children, n => { for (const p of paintsOf(n)) if (p.variable) count.set(p.variable, (count.get(p.variable) || 0) + 1); });
  return count;
}
