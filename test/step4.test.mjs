import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocument, createNode, parseDocument, serializeDocument } from '../src/core/document.js';
import {
  applyVariables, colorVariable, dependsOn, componentMap, detachInstance, instancify, makeInstance, overrideCount, overrideValues,
  syncInstances, unbindVariables
} from '../src/core/components.js';
import { solid } from '../src/core/paint.js';

// A button component (a label in a frame) on a page, with room for instances.
function setup() {
  const doc = createDocument('Test');
  const page = doc.pages[0];
  const label = createNode('text', { text: 'Buy', x: 10, y: 5, w: 30, h: 20 });
  const icon = createNode('rect', { x: 70, y: 5, w: 20, h: 20, constraints: { h: 'right', v: 'top' } });
  const button = createNode('frame', { name: 'Button', w: 100, h: 30, component: true, fills: [solid('#0000ff')], children: [label, icon] });
  page.children.push(button);
  return { doc, page, button, label, icon };
}
const fit = n => { n.w = n.text.length * 10; };

test('an instance copies the component, with ids made from its own id and the layer it copies', () => {
  const { doc, page, button, label } = setup();
  const inst = makeInstance(button, { x: 200 });
  page.children.push(inst);
  assert.equal(inst.instanceOf, button.id);
  assert.equal(inst.component, undefined);
  assert.deepEqual(inst.children.map(c => c.ref), [label.id, button.children[1].id]);
  assert.equal(inst.children[0].id, `${inst.id};${label.id}`);
  // The component changes: the instance follows after a sync, with the same ids.
  button.fills = [solid('#ff0000')];
  label.text = 'Pay';
  syncInstances(doc, fit);
  assert.equal(inst.fills[0].color, '#ff0000');
  assert.equal(inst.children[0].text, 'Pay');
  assert.equal(inst.children[0].id, `${inst.id};${label.id}`);
  assert.equal(inst.x, 200, 'its own position stays');
});

test('overrides survive a sync; position and size inside an instance cannot be overridden', () => {
  const { doc, page, button, label } = setup();
  const inst = makeInstance(button);
  page.children.push(inst);
  const child = inst.children[0];
  const taken = overrideValues(inst, child, { text: 'Checkout', x: 99 });
  assert.deepEqual(taken, { text: 'Checkout' });
  Object.assign(child, taken);
  label.fills = [solid('#00ff00')];
  syncInstances(doc, fit);
  assert.equal(inst.children[0].text, 'Checkout', 'the override stays');
  assert.equal(inst.children[0].w, 80, 'text sized again');
  assert.equal(inst.children[0].fills[0].color, '#00ff00', 'the rest follows the component');
  assert.equal(overrideCount(inst), 1);
  // Setting the component's own value again is no override any more.
  overrideValues(inst, inst.children[0], { text: 'Buy' });
  syncInstances(doc, fit);
  assert.equal(overrideCount(inst), 0);
  // The instance itself: fills are an override, its position is its own.
  assert.deepEqual(overrideValues(inst, inst, { fills: [solid('#123456')], x: 5 }), { fills: [solid('#123456')], x: 5 });
  assert.deepEqual(Object.keys(inst.overrides), [button.id]);
});

test('a resized instance places its content by the constraints', () => {
  const { doc, page, button } = setup();
  const inst = makeInstance(button, { w: 200 });
  page.children.push(inst);
  syncInstances(doc, fit);
  assert.equal(inst.children[1].x, 170, 'the icon pinned right moves with the right edge');
  assert.equal(inst.children[0].x, 10);
});

test('nested: a card with a button instance; card instances follow both components', () => {
  const { doc, page, button, label } = setup();
  const inner = makeInstance(button, { x: 10, y: 40 });
  const card = createNode('frame', { name: 'Card', x: 0, y: 100, w: 200, h: 100, component: true, children: [inner] });
  page.children.push(card);
  const cardInst = makeInstance(card, { x: 300 });
  page.children.push(cardInst);
  syncInstances(doc, fit);
  const nestedLabel = cardInst.children[0].children[0];
  assert.equal(nestedLabel.id, `${cardInst.id};${inner.id};${label.id}`);
  // An override made through the card instance on the button's label.
  Object.assign(nestedLabel, overrideValues(cardInst, nestedLabel, { text: 'Go' }));
  button.fills = [solid('#abcdef')];
  syncInstances(doc, fit);
  assert.equal(cardInst.children[0].fills[0].color, '#abcdef', 'the button change reaches the card instance');
  assert.equal(cardInst.children[0].children[0].text, 'Go');
  // Detaching the card instance keeps the button an instance, with the override moved into it.
  detachInstance(cardInst);
  syncInstances(doc, fit);
  const button2 = cardInst.children[0];
  assert.equal(cardInst.instanceOf, undefined);
  assert.equal(button2.instanceOf, button.id);
  assert.equal(button2.children[0].text, 'Go');
  assert.equal(button2.children[0].id, nestedLabel.id, 'ids stay the same');
  // A component can't contain itself.
  const comps = componentMap(doc);
  assert.ok(dependsOn(comps, card.id, button.id));
  assert.ok(!dependsOn(comps, button.id, card.id));
});

test('an instance whose component (through others) contains itself is left alone', () => {
  const { doc, page, button } = setup();
  const loop = makeInstance(button);
  button.children.push(loop);
  assert.deepEqual(syncInstances(doc, fit), [loop.id]);
  page.children.push(makeInstance(button));
  assert.equal(syncInstances(doc, fit).length, 2);
});

test('duplicates of a component become instances of it', () => {
  const { button } = setup();
  const frame = createNode('frame', { children: [button] });
  const copy = structuredClone(frame);
  instancify(copy, frame, id => id === button.id);
  assert.equal(copy.children[0].instanceOf, button.id);
  assert.equal(copy.children[0].component, undefined);
  const other = structuredClone(frame);
  instancify(other, frame, () => false);
  assert.equal(other.children[0].component, true, 'a component from another design stays one');
});

test('colour variables: bound paints take the colour, unbinding keeps it, all saved', () => {
  const { doc, page, button } = setup();
  const brand = colorVariable('Brand/Primary', '#ff5500');
  doc.variables.push(brand);
  button.fills = [{ ...solid('#000000'), variable: brand.id }];
  button.strokes = [{ color: '#000000', opacity: 1, width: 1, align: 'inside', visible: true, variable: brand.id }];
  applyVariables(doc);
  assert.equal(button.fills[0].color, '#ff5500');
  assert.equal(button.strokes[0].color, '#ff5500');
  const back = parseDocument(serializeDocument(doc));
  assert.equal(back.version, 4);
  assert.deepEqual(back.variables, [brand]);
  assert.equal(back.pages[0].children[0].fills[0].variable, brand.id);
  unbindVariables(page.children, new Set());
  assert.equal(button.fills[0].variable, undefined);
  assert.equal(button.fills[0].color, '#ff5500');
  const old = parseDocument(JSON.stringify({ format: 'visual', version: 3, pages: [{ id: 'p', name: 'P', children: [] }] }));
  assert.deepEqual(old.variables, []);
});
