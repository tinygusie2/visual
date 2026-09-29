import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNode, parseDocument, serializeDocument } from '../src/core/document.js';
import { applyLayout, dropIndex, inferLayout, resizeContent } from '../src/core/layout.js';
import { image, imageRect } from '../src/core/paint.js';
import { parsePath, pathBounds, pathToString, transformPath, vectorFromSegments } from '../src/core/path.js';

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const box = n => [n.x, n.y, n.w, n.h];

test('auto layout: a row that hugs its content, with gap and padding', () => {
  const a = createNode('rect', { w: 40, h: 20 }), b = createNode('rect', { w: 60, h: 30 });
  const f = createNode('frame', { w: 10, h: 10, widthMode: 'hug', heightMode: 'hug', children: [a, b],
    layout: { mode: 'row', gap: 8, padding: { t: 4, r: 6, b: 4, l: 6 }, justify: 'start', align: 'center' } });
  applyLayout([f]);
  assert.deepEqual([f.w, f.h], [6 + 40 + 8 + 60 + 6, 4 + 30 + 4]);
  assert.deepEqual(box(a), [6, 9, 40, 20]);
  assert.deepEqual(box(b), [54, 4, 60, 30]);
});

test('auto layout: fill shares the room left, stretch across, space between, hidden and absolute skipped', () => {
  const a = createNode('rect', { w: 50, h: 10 }), b = createNode('rect', { w: 1, h: 10, widthMode: 'fill', heightMode: 'fill' });
  const c = createNode('rect', { w: 50, h: 10 }), hidden = createNode('rect', { visible: false }), free = createNode('rect', { x: 3, y: 3, absolute: true });
  const f = createNode('frame', { w: 300, h: 100, children: [a, b, hidden, c, free],
    layout: { mode: 'column', gap: 10, padding: { t: 0, r: 20, b: 0, l: 20 }, justify: 'start', align: 'start' } });
  applyLayout([f]);
  assert.deepEqual(box(b), [20, 20, 260, 100 - 20 - 20]);
  assert.equal(c.y, 20 + 60 + 10);
  assert.deepEqual([free.x, free.y], [3, 3]);
  f.layout.justify = 'space-between'; b.heightMode = 'fixed'; b.h = 10;
  applyLayout([f]);
  assert.deepEqual([a.y, b.y, c.y], [0, 45, 90]);
});

test('nested: an inner frame that hugs is sized before the outer one places it', () => {
  const t1 = createNode('rect', { w: 30, h: 30 }), t2 = createNode('rect', { w: 30, h: 30 });
  const inner = createNode('frame', { widthMode: 'hug', heightMode: 'hug', children: [t1, t2], layout: { mode: 'row', gap: 0, padding: { t: 0, r: 0, b: 0, l: 0 }, justify: 'start', align: 'start' } });
  const outer = createNode('frame', { widthMode: 'hug', heightMode: 'hug', children: [inner], layout: { mode: 'column', gap: 0, padding: { t: 5, r: 5, b: 5, l: 5 }, justify: 'start', align: 'start' } });
  applyLayout([outer]);
  assert.deepEqual([inner.w, outer.w, outer.h], [60, 70, 40]);
});

test('turning on auto layout reads direction, order, gap and padding from the content', () => {
  const a = createNode('rect', { x: 120, y: 10, w: 50, h: 50 }), b = createNode('rect', { x: 10, y: 10, w: 50, h: 50 });
  const f = createNode('frame', { w: 190, h: 70, children: [a, b] });
  const l = inferLayout(f);
  assert.equal(l.mode, 'row');
  assert.equal(l.gap, 60);
  assert.deepEqual(l.padding, { t: 10, l: 10, r: 20, b: 10 });
  assert.deepEqual(f.children, [b, a], 'order follows the position');
});

test('drop position in an auto layout frame', () => {
  const a = createNode('rect', { w: 40, h: 20 }), b = createNode('rect', { w: 40, h: 20 });
  const f = createNode('frame', { w: 200, h: 40, children: [a, b], layout: { mode: 'row', gap: 10, padding: { t: 10, r: 10, b: 10, l: 10 }, justify: 'start', align: 'start' } });
  applyLayout([f]);
  assert.equal(dropIndex(f, { x: 100, y: 0 }, { x: 115, y: 20 }).index, 0);
  assert.equal(dropIndex(f, { x: 100, y: 0 }, { x: 170, y: 20 }).index, 1);
  assert.equal(dropIndex(f, { x: 100, y: 0 }, { x: 290, y: 20 }).index, 2);
  assert.equal(dropIndex(f, { x: 100, y: 0 }, { x: 290, y: 20 }, [a.id]).index, 1, 'without the layer being moved');
});

test('constraints when a frame is resized', () => {
  const right = createNode('rect', { x: 150, y: 10, w: 40, h: 20, constraints: { h: 'right', v: 'top' } });
  const wide = createNode('rect', { x: 10, y: 10, w: 180, h: 20, constraints: { h: 'stretch', v: 'bottom' } });
  const mid = createNode('rect', { x: 80, y: 40, w: 40, h: 20, constraints: { h: 'center', v: 'scale' } });
  const f = createNode('frame', { w: 200, h: 100, children: [right, wide, mid] });
  const before = structuredClone(f);
  f.w = 300; f.h = 200;
  resizeContent(f, before);
  assert.deepEqual(box(right), [250, 10, 40, 20]);
  assert.deepEqual(box(wide), [10, 110, 280, 20]);
  assert.deepEqual(box(mid), [130, 80, 40, 40]);
});

test('paths: relative commands, arcs, curves, bounds, transform', () => {
  const segs = parsePath('m10 10 h20 v20 H10 z M0 0 l5 5 5-5');
  assert.equal(pathToString(segs), 'M10 10L30 10L30 30L10 30ZM0 0L5 5L10 0');
  const circle = parsePath('M0 50 A50 50 0 1 0 100 50 A50 50 0 1 0 0 50Z');
  const b = pathBounds(circle);
  close(b.x, 0); close(b.y, 0); close(b.w, 100, 0.2); close(b.h, 100, 0.2);
  const curve = pathBounds(parsePath('M0 0C0 100 100 100 100 0'));
  close(curve.h, 75);
  assert.equal(parsePath('a1 1 0 00 1 1').length, 1, 'arc flags without spaces');
  const moved = pathBounds(transformPath(parsePath('M0 0L10 0L10 10'), { a: 2, b: 0, c: 0, d: 2, e: 5, f: 5 }));
  assert.deepEqual([moved.x, moved.y, moved.w, moved.h], [5, 5, 20, 20]);
  const v = vectorFromSegments(parsePath('M20 30L40 30'));
  assert.deepEqual([v.x, v.y, v.w, v.h], [20, 29.5, 20, 1]);
  assert.throws(() => parsePath('M0 0 X 1'));
});

test('image paints: fit rectangles, and only used images are saved', () => {
  assert.deepEqual(imageRect('fill', 200, 100, 100, 100), { x: -50, y: 0, w: 200, h: 100 });
  assert.deepEqual(imageRect('fit', 200, 100, 100, 100), { x: 0, y: 25, w: 100, h: 50 });
  const doc = parseDocument(JSON.stringify({ format: 'visual', version: 2, pages: [{ id: 'p', name: 'P', children: [
    { id: 'node_1', type: 'rect', x: 0, y: 0, w: 10, h: 10, fills: [image('img_a')] }] }] }));
  const text = serializeDocument(doc, new Map([['img_a', { mime: 'image/png', data: 'AAA', w: 1, h: 1 }], ['img_b', { mime: 'image/png', data: 'BBB', w: 1, h: 1 }]]));
  const back = JSON.parse(text);
  assert.deepEqual(Object.keys(back.assets), ['img_a']);
  assert.equal(back.version, 3);
  assert.deepEqual(back.pages[0].children[0].constraints, { h: 'left', v: 'top' });
});
