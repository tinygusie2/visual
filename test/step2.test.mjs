import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNode, fitGroups, parseDocument } from '../src/core/document.js';
import {
  colorAt, gradient, gradientLine, hexToRgb, hslToRgb, hsvToRgb, normalizeHex, paintCss, rgbToHex, rgbToHsl, rgbToHsv, rgba, solid
} from '../src/core/paint.js';
import { align, distribute, gaps, measureBetween, snapMove, snapValue, tidy } from '../src/core/snap.js';
import { effectMargin, toSvg } from '../src/core/svg.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('colour conversions round-trip', () => {
  assert.equal(normalizeHex('#ABC'), '#aabbcc');
  assert.equal(normalizeHex('12ab34'), '#12ab34');
  assert.equal(normalizeHex('nope'), null);
  for (const hex of ['#6750a4', '#000000', '#ffffff', '#ff0000', '#12ab34']) {
    const rgb = hexToRgb(hex);
    assert.equal(rgbToHex(hsvToRgb(rgbToHsv(rgb))), hex);
    assert.equal(rgbToHex(hslToRgb(rgbToHsl(rgb))), hex);
  }
  assert.deepEqual(rgbToHsl(hexToRgb('#ff0000')), { h: 0, s: 1, l: 0.5 });
  assert.equal(rgba('#ff0000', 0.5), 'rgba(255, 0, 0, 0.5)');
  assert.equal(rgba('#ff0000', 1), '#ff0000');
});

test('gradients follow CSS: angle, colour between stops, css output', () => {
  const down = gradientLine(180, 100, 50);
  assert.deepEqual([down.x1, down.y1, down.x2, down.y2].map(v => Math.round(v * 1000) / 1000 + 0), [50, 0, 50, 50]);
  const right = gradientLine(90, 100, 50);
  close(right.x1, 0); close(right.x2, 100); close(right.y1, 25);
  const g = gradient('linear', [{ pos: 0, color: '#000000', opacity: 1 }, { pos: 1, color: '#ffffff', opacity: 0 }], 90);
  assert.deepEqual(colorAt(g, 0.5), { color: '#808080', opacity: 0.5 });
  assert.equal(paintCss(g), 'linear-gradient(90deg, #000000 0%, rgba(255, 255, 255, 0) 100%)');
  assert.match(paintCss({ ...g, type: 'radial' }), /^radial-gradient\(closest-side, /);
});

test('version 1 files get fills, strokes, effects and exports', () => {
  const doc = parseDocument(JSON.stringify({ format: 'visual', version: 1, pages: [{ id: 'page_1', name: 'P', children: [
    { id: 'node_1', type: 'rect', x: 0, y: 0, w: 10, h: 10, fill: '#123456' }
  ] }] }));
  const n = doc.pages[0].children[0];
  assert.deepEqual(n.fills, [solid('#123456')]);
  assert.equal(n.fill, undefined);
  assert.deepEqual([n.strokes, n.effects, n.exports], [[], [], []]);
  assert.equal(doc.version, 4);
});

test('groups take the size of their content without moving anything', () => {
  const a = createNode('rect', { x: 10, y: 20, w: 30, h: 30 });
  const b = createNode('rect', { x: 60, y: 0, w: 10, h: 10 });
  const g = createNode('group', { x: 100, y: 100, w: 1, h: 1, children: [a, b] });
  const empty = createNode('group', { children: [] });
  const list = [g, empty];
  fitGroups(list);
  assert.equal(list.length, 1, 'empty group removed');
  assert.deepEqual([g.x, g.y, g.w, g.h], [110, 100, 60, 50]);
  assert.deepEqual([a.x + g.x, a.y + g.y, b.x + g.x, b.y + g.y], [110, 120, 160, 100]);
});

test('snapping: nearest edge or centre within the threshold, guides along the line', () => {
  const targets = [{ x: 0, y: 0, w: 100, h: 100 }];
  const r = snapMove({ x: 103, y: 300, w: 50, h: 50 }, targets, 5);
  assert.deepEqual([r.dx, r.dy], [-3, 0]);
  assert.deepEqual(r.guides, [{ axis: 'x', value: 100, from: 0, to: 350 }]);
  const c = snapMove({ x: 26, y: 200, w: 50, h: 10 }, targets, 5); // centre 51 → 50
  assert.equal(c.dx, -1);
  assert.equal(snapMove({ x: 120, y: 120, w: 5, h: 5 }, targets, 5).guides.length, 0);
  assert.equal(snapValue(98, 'x', targets, 5), 100);
  assert.equal(snapValue(90, 'x', targets, 5), 90);
});

test('distances to neighbours and to the parent frame, also from outside it', () => {
  const parent = { x: 0, y: 0, w: 400, h: 400 };
  const box = { x: 100, y: 100, w: 50, h: 50 };
  const left = { x: 20, y: 110, w: 40, h: 10 };
  const d = gaps(box, [left], parent);
  assert.deepEqual(d.map(m => m.value), [40, 250, 100, 250]);
  const outside = gaps({ x: 450, y: 100, w: 50, h: 50 }, [], parent);
  assert.equal(outside[0].value, 50, 'measured from the parent’s right edge');
  assert.deepEqual(measureBetween({ x: 0, y: 0, w: 10, h: 10 }, { x: 30, y: 0, w: 10, h: 10 }).map(m => m.value), [20]);
  assert.deepEqual(measureBetween(box, parent).map(m => m.value), [100, 250, 100, 250]);
});

test('align, distribute and tidy up', () => {
  const rects = [{ x: 0, y: 0, w: 10, h: 10 }, { x: 50, y: 30, w: 20, h: 20 }];
  const box = { x: 0, y: 0, w: 70, h: 50 };
  assert.deepEqual(align(rects, box, 'right'), [{ x: 60, y: 0 }, { x: 50, y: 30 }]);
  assert.deepEqual(align(rects, box, 'middle'), [{ x: 0, y: 20 }, { x: 50, y: 15 }]);
  const three = [{ x: 0, y: 0, w: 10, h: 10 }, { x: 15, y: 0, w: 10, h: 10 }, { x: 90, y: 0, w: 10, h: 10 }];
  assert.deepEqual(distribute(three, 'x').map(p => p.x), [0, 45, 90]);
  assert.deepEqual(tidy([{ x: 0, y: 5, w: 10, h: 10 }, { x: 100, y: 0, w: 10, h: 10 }, { x: 30, y: 8, w: 10, h: 10 }]),
    [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 0 }]);
});

test('SVG export keeps layers, ids, text, gradients, strokes and shadows', () => {
  const measure = () => s => s.length * 8;
  const card = createNode('frame', {
    name: 'Card & co', w: 200, h: 100, radius: 12, fills: [gradient('linear')],
    strokes: [{ color: '#ff0000', opacity: 1, width: 2, align: 'outside', visible: true }],
    effects: [{ type: 'drop-shadow', x: 0, y: 4, blur: 16, spread: 0, color: '#000000', opacity: 0.2, visible: true }]
  });
  const label = createNode('text', { text: 'Hi <you>', x: 16, y: 16, fills: [solid('#ffffff')] });
  const hidden = createNode('rect', { visible: false });
  card.children.push(label, hidden);
  const svg = toSvg(card, measure);
  assert.equal(effectMargin(card), 20);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="240" height="140"/);
  assert.ok(svg.includes(`data-visual-id="${card.id}"`) && svg.includes(`data-visual-id="${label.id}"`));
  assert.ok(!svg.includes(hidden.id), 'hidden layers are left out');
  assert.ok(svg.includes('data-name="Card &amp; co"'));
  assert.ok(svg.includes('Hi &lt;you&gt;'));
  assert.ok(svg.includes('<linearGradient') && svg.includes('<mask') && svg.includes('feGaussianBlur') && svg.includes('rx="12"'));
});
