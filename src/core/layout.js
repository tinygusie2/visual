// Auto layout and constraints: plain functions on the node tree (no DOM), run by the editor after every change.
//
// Auto layout (frame.layout): the frame places its children in a row or a column.
//   { mode: 'row' | 'column', gap, padding: { t, r, b, l }, justify: 'start' | 'center' | 'end' | 'space-between',
//     align: 'start' | 'center' | 'end' }
// Sizing per layer and axis (widthMode / heightMode): 'fixed', 'hug' (an auto layout frame takes the size of its
// content) or 'fill' (a child of an auto layout frame takes the room that is left). A child with `absolute` is
// left where it is. Children of other frames follow their constraints ({ h, v }) when the frame is resized:
//   h: 'left' | 'right' | 'stretch' | 'center' | 'scale',  v: 'top' | 'bottom' | 'stretch' | 'center' | 'scale'
import { boundsOf } from './document.js';

const r2 = v => Math.round(v * 100) / 100;

export const defaultLayout = (mode = 'column') => ({ mode, gap: 10, padding: { t: 10, r: 10, b: 10, l: 10 }, justify: 'start', align: 'start' });
export const defaultConstraints = () => ({ h: 'left', v: 'top' });

// The children an auto layout frame places (hidden, absolute and floating ones keep their own place).
export const flowChildren = (frame, skip) => frame.children.filter(c => c.visible && !c.absolute && !skip?.has(c.id));
export const inFlow = (node, parent) => !!parent?.layout && !node.absolute;

const axes = row => row
  ? { main: 'w', cross: 'h', pos: 'x', crossPos: 'y', mode: 'widthMode', crossMode: 'heightMode' }
  : { main: 'h', cross: 'w', pos: 'y', crossPos: 'x', mode: 'heightMode', crossMode: 'widthMode' };

// Lays out every auto layout frame in `nodes`, deepest first, so a frame that hugs knows its content's size.
// opts: { fitText(node) (sizes a text layer after its width changed), skip: Set of ids being dragged }
export function applyLayout(nodes, opts = {}) {
  for (const n of nodes) {
    if (!n.children) continue;
    if (n.layout) layoutFrame(n, opts); else applyLayout(n.children, opts);
  }
}

function layoutFrame(f, opts) {
  const L = f.layout, row = L.mode === 'row', a = axes(row), p = L.padding;
  const padStart = row ? p.l : p.t, padEnd = row ? p.r : p.b;
  const crossStart = row ? p.t : p.l, crossEnd = row ? p.b : p.r;
  // Layers being dragged out keep their room (so the frame doesn't shrink under the cursor) but aren't placed.
  const all = flowChildren(f), kids = all.filter(c => !opts.skip?.has(c.id));
  const hugMain = f[a.mode] === 'hug', hugCross = f[a.crossMode] === 'hug';
  // In a frame that hugs, a child can't fill that axis: it keeps its size.
  const fillsMain = c => c[a.mode] === 'fill' && !hugMain;
  const fillsCross = c => c[a.crossMode] === 'fill' && !hugCross;

  // Content first, so hugging frames inside have their size (the ones that fill get theirs below).
  for (const c of f.children) if (c.children && !(all.includes(c) && (fillsMain(c) || fillsCross(c)))) relayout(c, opts);

  const gapsAll = L.gap * Math.max(0, all.length - 1);
  const fixedSum = all.filter(c => !fillsMain(c)).reduce((s, c) => s + c[a.main], 0);
  if (hugMain && all.length) f[a.main] = r2(Math.max(1, padStart + padEnd + fixedSum + gapsAll));
  if (hugCross && all.length) f[a.cross] = r2(Math.max(1, crossStart + crossEnd + Math.max(...all.map(c => c[a.cross]))));

  const inner = f[a.main] - padStart - padEnd, innerCross = f[a.cross] - crossStart - crossEnd;
  const gaps = L.gap * Math.max(0, kids.length - 1);
  const filling = all.filter(fillsMain);
  const share = filling.length ? Math.max(1, (inner - fixedSum - gapsAll) / filling.length) : 0;
  for (const c of kids) {
    const w0 = c.w;
    if (fillsMain(c)) c[a.main] = r2(share);
    if (fillsCross(c)) c[a.cross] = r2(Math.max(1, innerCross));
    if (c.type === 'text' && c.w !== w0) { if (c.sizing === 'auto-width') c.sizing = 'auto-height'; opts.fitText?.(c); }
    if (c.children && (fillsMain(c) || fillsCross(c))) relayout(c, opts);
  }

  const total = kids.reduce((s, c) => s + c[a.main], 0);
  let gap = L.gap, at = padStart;
  if (L.justify === 'space-between' && kids.length > 1 && !hugMain) gap = (inner - total) / (kids.length - 1);
  else if (L.justify === 'center') at += (inner - total - gaps) / 2;
  else if (L.justify === 'end') at += inner - total - gaps;
  for (const c of kids) {
    c[a.pos] = r2(at);
    at += c[a.main] + gap;
    const room = innerCross - c[a.cross];
    c[a.crossPos] = r2(crossStart + (L.align === 'center' ? room / 2 : L.align === 'end' ? room : 0));
  }
}

function relayout(n, opts) { if (n.layout) layoutFrame(n, opts); else applyLayout(n.children, opts); }

// ---------- adding auto layout to a frame that already has content ----------
// Direction, order, gap and padding are read from where the layers are now, so turning it on moves little.
export function inferLayout(frame) {
  const kids = frame.children.filter(c => c.visible);
  if (!kids.length) return defaultLayout();
  const box = boundsOf(kids);
  const spanX = box.w - Math.max(...kids.map(c => c.w)), spanY = box.h - Math.max(...kids.map(c => c.h));
  const row = kids.length > 1 && spanX > spanY;
  const a = axes(row);
  const sorted = [...kids].sort((m, n) => m[a.pos] - n[a.pos]);
  const between = sorted.slice(1).map((c, i) => c[a.pos] - (sorted[i][a.pos] + sorted[i][a.main]));
  const gap = between.length ? Math.max(0, Math.round(between.reduce((s, g) => s + g, 0) / between.length)) : 10;
  const pad = v => Math.max(0, Math.round(v));
  // Stacking order follows the flow (hidden layers stay where they were in the list).
  const hidden = frame.children.filter(c => !c.visible);
  frame.children = [...sorted, ...hidden];
  return {
    mode: row ? 'row' : 'column', gap, justify: 'start', align: 'start',
    padding: { t: pad(box.y), l: pad(box.x), r: pad(frame.w - box.x - box.w), b: pad(frame.h - box.y - box.h) }
  };
}

// Where a layer dropped at world point `p` goes in an auto layout frame (at `origin` on the page): the index among
// the flow children not being moved, and a line to show it.
export function dropIndex(frame, origin, p, moving = []) {
  const row = frame.layout.mode === 'row', a = axes(row);
  const rest = frame.children.filter(c => !moving.includes(c.id));
  const flow = rest.filter(c => c.visible && !c.absolute);
  const local = row ? p.x - origin.x : p.y - origin.y;
  let before = flow.find(c => local < c[a.pos] + c[a.main] / 2);
  const index = before ? rest.indexOf(before) : rest.length;
  const pad = frame.layout.padding;
  const crossA = row ? pad.t : pad.l, crossB = (row ? frame.h - pad.b : frame.w - pad.r);
  let at;
  if (before) {
    const prev = flow[flow.indexOf(before) - 1];
    at = prev ? (prev[a.pos] + prev[a.main] + before[a.pos]) / 2 : before[a.pos] - Math.min(frame.layout.gap, row ? pad.l : pad.t) / 2;
  } else {
    const last = flow.at(-1);
    at = last ? last[a.pos] + last[a.main] + Math.min(frame.layout.gap, row ? pad.r : pad.b) / 2 : (row ? pad.l : pad.t);
  }
  const line = row
    ? { x1: origin.x + at, y1: origin.y + crossA, x2: origin.x + at, y2: origin.y + crossB }
    : { x1: origin.x + crossA, y1: origin.y + at, x2: origin.x + crossB, y2: origin.y + at };
  return { index, line };
}

// ---------- constraints ----------
function follow(mode, pos, size, before, after) {
  const d = after - before;
  switch (mode) {
    case 'right': case 'bottom': return [pos + d, size];
    case 'stretch': return [pos, Math.max(1, size + d)];
    case 'center': return [pos + d / 2, size];
    case 'scale': { const k = before ? after / before : 1; return [pos * k, Math.max(1, size * k)]; }
    default: return [pos, size];
  }
}

// After a layer changed size (`before` is a copy from before the change), what is inside follows: a group scales its
// content, a frame without auto layout moves and sizes its children by their constraints (auto layout frames are
// placed by applyLayout instead). Goes on into children whose size changed.
export function resizeContent(node, before, fitText) {
  if (!node.children || !before?.children) return;
  if (node.layout) return;
  const group = node.type === 'group';
  const sx = before.w ? node.w / before.w : 1, sy = before.h ? node.h / before.h : 1;
  node.children.forEach((c, i) => {
    const o = before.children[i];
    if (!o || o.id !== c.id) return;
    let x, y, w, h;
    if (group) [x, y, w, h] = [o.x * sx, o.y * sy, Math.max(1, o.w * sx), Math.max(1, o.h * sy)];
    else {
      const k = c.constraints || defaultConstraints();
      [x, w] = follow(k.h, o.x, o.w, before.w, node.w);
      [y, h] = follow(k.v, o.y, o.h, before.h, node.h);
    }
    Object.assign(c, { x: r2(x), y: r2(y), w: r2(w), h: r2(h) });
    if (c.type === 'text' && (c.w !== o.w || c.h !== o.h)) {
      c.sizing = c.h !== o.h ? 'fixed' : c.sizing === 'auto-width' ? 'auto-height' : c.sizing;
      fitText?.(c);
    }
    if (c.children && (c.w !== o.w || c.h !== o.h)) resizeContent(c, o, fitText);
  });
}
