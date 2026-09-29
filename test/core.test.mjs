import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  absolute, cloneWithNewIds, createDocument, createNode, indexPage, isAncestor, parseDocument, reparent, serializeDocument, topLevelOnly
} from '../src/core/document.js';
import { evaluate } from '../src/core/expr.js';
import { fitRect, mapRect, resizeRect, toScreen, toWorld, zoomAt } from '../src/core/geometry.js';
import { History } from '../src/core/history.js';
import { fitTextSize, layoutText } from '../src/core/text.js';

function sample() {
  const doc = createDocument('Test');
  const page = doc.pages[0];
  const card = createNode('frame', { name: 'Card', x: 100, y: 50, w: 300, h: 200 });
  const title = createNode('text', { text: 'Hello', x: 16, y: 16 });
  const inner = createNode('frame', { name: 'Inner', x: 20, y: 60, w: 100, h: 100 });
  const dot = createNode('ellipse', { x: 10, y: 10, w: 20, h: 20 });
  inner.children.push(dot);
  card.children.push(title, inner);
  page.children.push(card);
  return { doc, page, card, title, inner, dot };
}

test('ids are unique, prefixed and survive a save + load', () => {
  const { doc, card, dot } = sample();
  assert.match(card.id, /^node_[0-9a-f]{12}$/);
  assert.notEqual(card.id, dot.id);
  const back = parseDocument(serializeDocument(doc));
  assert.equal(back.pages[0].children[0].id, card.id);
  assert.equal(back.pages[0].children[0].children[1].children[0].id, dot.id);
});

test('parseDocument rejects other files, fills in missing fields and repairs duplicate ids', () => {
  assert.throws(() => parseDocument('nope'), /not a Visual document/);
  assert.throws(() => parseDocument('{"format":"figma"}'), /not a Visual document/);
  assert.throws(() => parseDocument('{"format":"visual","version":99,"pages":[]}'), /newer Visual/);
  const doc = parseDocument(JSON.stringify({ format: 'visual', version: 1, pages: [{ name: 'P', children: [
    { id: 'node_a', type: 'rect', x: 0, y: 0, w: 1, h: 1 }, { id: 'node_a', type: 'text', text: 'x', x: 0, y: 0, w: 1, h: 1 }
  ] }] }));
  const [a, b] = doc.pages[0].children;
  assert.equal(a.fills[0].color, '#d9d9d9');
  assert.equal(b.fontSize, 16);
  assert.notEqual(a.id, b.id);
  assert.throws(() => parseDocument(JSON.stringify({ format: 'visual', version: 1, pages: [{ children: [{ type: 'blob' }] }] })), /Unknown layer type/);
});

test('absolute positions and reparenting keep a layer where it is on screen', () => {
  const { page, card, inner, dot } = sample();
  let index = indexPage(page);
  assert.deepEqual(absolute(index, dot.id), { x: 130, y: 120 });
  assert.ok(isAncestor(index, card.id, dot.id));
  assert.ok(!isAncestor(index, dot.id, card.id));
  reparent(page, index, dot.id, null);
  index = indexPage(page);
  assert.deepEqual({ x: dot.x, y: dot.y }, { x: 130, y: 120 });
  assert.equal(page.children.at(-1), dot);
  assert.equal(inner.children.length, 0);
  reparent(page, index, dot.id, card, 0);
  assert.deepEqual({ x: dot.x, y: dot.y }, { x: 30, y: 70 });
  assert.equal(card.children[0], dot);
});

test('topLevelOnly drops children of selected frames; clones get new ids everywhere', () => {
  const { page, card, title, dot } = sample();
  const index = indexPage(page);
  assert.deepEqual(topLevelOnly(index, [title.id, card.id, dot.id]), [card.id]);
  const copy = cloneWithNewIds(card);
  assert.notEqual(copy.id, card.id);
  assert.notEqual(copy.children[1].children[0].id, dot.id);
  assert.equal(copy.children[0].text, 'Hello');
});

test('number fields: arithmetic and operations on the current value', () => {
  assert.equal(evaluate('200 + 32'), 232);
  assert.equal(evaluate('/2', 400), 200);
  assert.equal(evaluate('*1.5', 10), 15);
  assert.equal(evaluate('+16', 4), 20);
  assert.equal(evaluate('-10', 50), -10);
  assert.equal(evaluate('(10 + 2) * 3'), 36);
  assert.equal(evaluate('12,5'), 12.5);
  assert.equal(evaluate('2 +'), null);
  assert.equal(evaluate('alert(1)'), null);
  assert.equal(evaluate('1/0'), null);
  assert.equal(evaluate(''), null);
});

test('camera: world ↔ screen, zooming keeps the point under the cursor, fit', () => {
  const cam = { x: 100, y: 50, zoom: 2 };
  assert.deepEqual(toWorld(cam, toScreen(cam, { x: 7, y: 9 })), { x: 7, y: 9 });
  const at = { x: 300, y: 200 };
  const before = toWorld(cam, at);
  const z = zoomAt(cam, at, 5);
  const after = toWorld(z, at);
  assert.ok(Math.abs(after.x - before.x) < 1e-9 && Math.abs(after.y - before.y) < 1e-9);
  assert.equal(zoomAt(cam, at, 1000).zoom, 32);
  assert.equal(zoomAt(cam, at, 0.0001).zoom, 0.05);
  const fit = fitRect({ x: 0, y: 0, w: 390, h: 844 }, 1000, 800);
  assert.ok(fit.zoom < 1 && fit.zoom > 0.7);
});

test('resize handles, Shift keeps the ratio, Alt resizes from the center', () => {
  const r = { x: 0, y: 0, w: 100, h: 50 };
  assert.deepEqual(resizeRect(r, 'se', 20, 10), { x: 0, y: 0, w: 120, h: 60 });
  assert.deepEqual(resizeRect(r, 'nw', 20, 10), { x: 20, y: 10, w: 80, h: 40 });
  assert.deepEqual(resizeRect(r, 'e', 100, 0, { keepRatio: true }), { x: 0, y: -25, w: 200, h: 100 });
  assert.deepEqual(resizeRect(r, 'se', 100, 0, { keepRatio: true }), { x: 0, y: 0, w: 200, h: 100 });
  assert.deepEqual(resizeRect(r, 'e', 10, 0, { fromCenter: true }), { x: -10, y: 0, w: 120, h: 50 });
  assert.deepEqual(resizeRect(r, 'w', 500, 0), { x: 99, y: 0, w: 1, h: 50 });
  assert.deepEqual(mapRect({ x: 50, y: 0, w: 50, h: 50 }, r, { x: 0, y: 0, w: 200, h: 100 }), { x: 100, y: 0, w: 100, h: 100 });
});

test('history: one step per action, redo cleared by a new change, no-op steps dropped', () => {
  const h = new History();
  let doc = { v: 1 };
  h.begin({ doc, selection: [] });
  doc.v = 2; doc.v = 3; // many changes during one drag
  assert.ok(h.commit({ doc, selection: ['a'] }));
  h.begin({ doc }); assert.equal(h.commit({ doc }), false);
  const back = h.undo({ doc, selection: ['a'] });
  assert.deepEqual(back.doc, { v: 1 });
  assert.deepEqual(h.redo({ doc: back.doc, selection: [] }).doc, { v: 3 });
  h.undo({ doc: { v: 3 } });
  h.begin({ doc: { v: 1 } }); assert.ok(h.commit({ doc: { v: 9 } }));
  assert.equal(h.canRedo, false);
});

test('text layout: auto width, wrapping at the box width, long words, empty lines', () => {
  const measure = s => s.length * 10; // 10 px per character
  const node = createNode('text', { text: 'Hello world\n\nagain', fontSize: 10, lineHeight: 1.5, sizing: 'auto-width' });
  assert.deepEqual(fitTextSize(node, measure), { w: 110, h: 45 });
  node.sizing = 'auto-height'; node.w = 60;
  assert.deepEqual(layoutText(node, measure).lines, ['Hello', 'world', '', 'again']);
  assert.deepEqual(fitTextSize(node, measure), { w: 60, h: 60 });
  node.text = 'abcdefghij'; node.w = 40;
  assert.deepEqual(layoutText(node, measure).lines, ['abcd', 'efgh', 'ij']);
});
