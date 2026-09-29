// Entry point of the editor page: wires the editor state to the canvas, panels, top bar, tools, shortcuts and files.
import { parseDocument, serializeDocument } from './core/document.js';
import { gradient, solid, stroke } from './core/paint.js';
import { attachCanvas } from './editor/canvas.js';
import { Editor } from './editor/editor.js';
import { attachTextEditor } from './editor/textedit.js';
import { exportNode } from './render/export.js';
import { Renderer } from './render/renderer.js';
import { closeColorPicker } from './ui/colorpicker.js';
import { lang, t } from './ui/i18n.js';
import { icon, wink } from './ui/icons.js';
import { attachLayers, inlineRename } from './ui/layers.js';
import { closeMenu, menuKeys, showMenu } from './ui/menu.js';
import { attachProperties } from './ui/properties.js';
import { attachStart } from './ui/start.js';

document.documentElement.lang = lang;
const $ = s => document.querySelector(s);
const host = window.host;
const editor = new Editor();

// ---------- fonts: the ones installed on this PC, loaded the first time the font field is used ----------
const fonts = {
  loaded: false,
  async load() {
    if (this.loaded) return;
    this.loaded = true;
    let families = ['Google Sans Flex', 'Arial', 'Segoe UI', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Tahoma', 'Trebuchet MS'];
    try { families = [...new Set(['Google Sans Flex', ...(await window.queryLocalFonts()).map(f => f.family)])]; } catch {}
    $('#font-list').replaceChildren(...families.map(f => new Option(f)));
  }
};

// ---------- layout ----------
$('#logo').innerHTML = wink(20);
const canvas = $('#canvas');
const renderer = new Renderer(canvas, editor);
const canvasApi = attachCanvas(canvas, editor, renderer, { onContextMenu: point => showMenu(point, contextMenu()) });
attachTextEditor($('#stage'), editor);
attachLayers($('#left'), editor);
attachProperties($('#right'), editor, { fonts, onExport: nodes => exportLayers(nodes) });
new ResizeObserver(() => { editor.viewport = { w: canvas.clientWidth, h: canvas.clientHeight }; }).observe(canvas);
editor.viewport = { w: canvas.clientWidth || 1200, h: canvas.clientHeight || 800 };

const tools = [['move', 'Move', 'V'], ['frame', 'Frame', 'F'], ['rect', 'Rectangle', 'R'], ['ellipse', 'Ellipse', 'O'], ['text', 'Text', 'T']];
$('#toolbar').replaceChildren(...tools.map(([id, label, key]) => {
  const b = document.createElement('button');
  b.className = 'icon tool'; b.dataset.tool = id; b.title = `${t(label)}  (${key})`;
  b.innerHTML = icon(id);
  b.addEventListener('click', () => editor.setTool(id));
  return b;
}));

editor.addEventListener('change', ({ what }) => {
  renderer.request();
  if (what.tool) {
    document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === editor.tool));
    canvasApi.refreshCursor();
  }
  if (what.camera || what.doc || what.file) $('#zoom').textContent = `${Math.round(editor.camera.zoom * 100)}%`;
  if (what.file || what.doc) {
    $('#doc-name').textContent = editor.doc?.name || '';
    $('#dirty').hidden = !editor.dirty;
    document.title = editor.doc ? `${editor.dirty ? '• ' : ''}${editor.doc.name} · Visual` : 'Visual';
  }
});

// ---------- files ----------
function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`; el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 2200);
}

function showEditor() { start.hide(); document.body.classList.add('has-doc'); editor.setTool('move'); requestAnimationFrame(() => { editor.viewport = { w: canvas.clientWidth, h: canvas.clientHeight }; editor.zoomToFit(); }); }

// Asks about unsaved changes; resolves false when the user cancels.
async function confirmDiscard() {
  if (!editor.doc || !editor.dirty) return true;
  editor.stopEditingText();
  const answer = await host.confirmUnsaved({
    message: t('Save changes to “{0}”?', editor.doc.name), detail: t('Your changes are lost if you don’t save them.'),
    buttons: [t('Save'), t('Don’t save'), t('Cancel')]
  });
  if (answer === 'save') return save();
  return answer === 'discard';
}

async function newFromTemplate(frame) {
  if (!(await confirmDiscard())) return;
  editor.newDocument(t('Untitled'), frame, t('Page {0}', 1));
  showEditor();
}

async function openPath(path) {
  if (!(await confirmDiscard())) return;
  try { const { text } = await host.read(path); editor.load(parseDocument(text), path); showEditor(); }
  catch (err) { toast(t('Could not open {0}: {1}', path, err.message), 'error'); }
}
async function openDialog() {
  if (!(await confirmDiscard())) return;
  try {
    const file = await host.openDialog();
    if (file) { editor.load(parseDocument(file.text), file.path); showEditor(); }
  } catch (err) { toast(t('Could not open {0}: {1}', '', err.message), 'error'); }
}

async function save(as = false) {
  if (!editor.doc) return false;
  editor.stopEditingText();
  let path = editor.path;
  if (!path || as) path = await host.saveDialog(editor.doc.name);
  if (!path) return false;
  try {
    // A design saved for the first time takes its file name as its name.
    const fileName = path.split(/[\\/]/).pop().replace(/\.visual$/i, '');
    if (!editor.path || as) editor.doc.name = fileName;
    await host.save(path, serializeDocument(editor.doc));
    editor.markSaved(path);
    editor.emit({ doc: false, file: true });
    toast(t('Saved'));
    return true;
  } catch (err) { toast(t('Could not save: {0}', err.message), 'error'); return false; }
}

// ---------- export and copy as ----------
// Every export setting of every layer; a layer without settings exports as PNG 1×. One folder for all files.
async function exportLayers(nodes = editor.selectedNodes, folder) {
  if (!nodes.length) return null;
  try {
    const files = [];
    for (const node of nodes) for (const e of node.exports.length ? node.exports : [{ format: 'png', scale: 1 }]) files.push(await exportNode(node, e));
    const done = await host.exportFiles(files, t('Export to folder'), folder);
    if (done && !folder) toast(t('Exported {0} files to {1}', done.names.length, done.folder));
    return done;
  } catch (err) { toast(t('Export failed: {0}', err.message), 'error'); return null; }
}

async function copyAs(format) {
  const [node] = editor.selectedNodes;
  if (!node) return;
  const file = await exportNode(node, { format, scale: format === 'png' ? 2 : 1 });
  if (format === 'svg') await host.copyText(file.data); else await host.copyImage(file.data);
  toast(t(format === 'svg' ? 'Copied as SVG' : 'Copied as PNG'));
}

function contextMenu() {
  const sel = editor.selectedNodes, has = sel.length > 0;
  const allHidden = has && sel.every(n => !n.visible), allLocked = has && sel.every(n => n.locked);
  return [
    { label: 'Copy', shortcut: 'Ctrl+C', action: () => editor.copy(), disabled: !has },
    { label: 'Paste', shortcut: 'Ctrl+V', action: () => editor.paste(), disabled: !editor.clipboard },
    { label: 'Duplicate', shortcut: 'Ctrl+D', action: () => editor.duplicateSelection(), disabled: !has },
    '-',
    { label: 'Group selection', shortcut: 'Ctrl+G', action: () => editor.wrap('group'), disabled: !has },
    { label: 'Frame selection', shortcut: 'Ctrl+Alt+G', action: () => editor.wrap('frame'), disabled: !has },
    { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', action: () => editor.unwrap(), disabled: !sel.some(n => n.children) },
    '-',
    { label: 'Bring to front', shortcut: 'Ctrl+Shift+]', action: () => editor.arrange(Infinity), disabled: !has },
    { label: 'Bring forward', shortcut: 'Ctrl+]', action: () => editor.arrange(1), disabled: !has },
    { label: 'Send backward', shortcut: 'Ctrl+[', action: () => editor.arrange(-1), disabled: !has },
    { label: 'Send to back', shortcut: 'Ctrl+Shift+[', action: () => editor.arrange(-Infinity), disabled: !has },
    '-',
    { label: allHidden ? 'Show' : 'Hide', shortcut: 'Ctrl+Shift+H', action: () => editor.toggle(editor.selection, 'visible'), disabled: !has },
    { label: allLocked ? 'Unlock' : 'Lock', shortcut: 'Ctrl+Shift+L', action: () => editor.toggle(editor.selection, 'locked'), disabled: !has },
    '-',
    { label: 'Copy as PNG', shortcut: 'Ctrl+Shift+C', action: () => copyAs('png'), disabled: sel.length !== 1 },
    { label: 'Copy as SVG', action: () => copyAs('svg'), disabled: sel.length !== 1 },
    { label: 'Export…', shortcut: 'Ctrl+Shift+E', action: () => exportLayers(), disabled: !has },
    '-',
    { label: 'Delete', shortcut: 'Del', action: () => editor.deleteSelection(), disabled: !has }
  ];
}

async function closeDesign() {
  if (!(await confirmDiscard())) return;
  editor.doc = null; editor.path = null; editor.dirty = false;
  document.body.classList.remove('has-doc');
  document.title = 'Visual';
  start.show();
}

host.onRequestClose(async () => { if (await confirmDiscard()) host.closeWindow(); });
host.onOpenPath(path => openPath(path));

const start = attachStart($('#start'), { onTemplate: newFromTemplate, onOpen: openDialog, onOpenPath: openPath });

// ---------- top bar ----------
const appMenu = () => [
  { label: 'New', shortcut: 'Ctrl+N', action: () => closeDesign() },
  { label: 'Open…', shortcut: 'Ctrl+O', action: openDialog },
  '-',
  { label: 'Save', shortcut: 'Ctrl+S', action: () => save(), disabled: !editor.doc },
  { label: 'Save as…', shortcut: 'Ctrl+Shift+S', action: () => save(true), disabled: !editor.doc },
  { label: 'Show in folder', action: () => host.showInFolder(editor.path), disabled: !editor.path },
  { label: 'Close design', action: closeDesign, disabled: !editor.doc },
  { label: 'Export…', shortcut: 'Ctrl+Shift+E', action: () => exportLayers(), disabled: !editor.selection.length },
  '-',
  { label: 'Undo', shortcut: 'Ctrl+Z', action: () => editor.undo(), disabled: !editor.history.canUndo },
  { label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: () => editor.redo(), disabled: !editor.history.canRedo },
  '-',
  { label: 'Keyboard shortcuts', shortcut: 'Ctrl+/', action: () => $('#shortcuts').showModal() },
  { label: 'Full screen', shortcut: 'F11', action: () => host.window('fullscreen') },
  { label: 'Developer tools', action: () => host.window('devtools') },
  '-',
  { label: 'Quit', action: () => window.close() }
];
$('#logo').addEventListener('click', e => showMenu(e.currentTarget, appMenu()));
$('#doc-name').addEventListener('click', e => inlineRename(e.currentTarget, editor.doc.name, name => editor.renameDocument(name)));
$('#doc-name').title = t('Rename design');
$('#dirty').title = t('Unsaved changes');
$('#zoom').addEventListener('click', e => showMenu(e.currentTarget, [
  { label: 'Zoom in', shortcut: 'Ctrl++', action: () => editor.zoomBy(2) },
  { label: 'Zoom out', shortcut: 'Ctrl+-', action: () => editor.zoomBy(0.5) },
  { label: 'Zoom to 100%', shortcut: 'Shift+0', action: () => editor.zoomTo(1) },
  { label: 'Zoom to fit', shortcut: 'Shift+1', action: () => editor.zoomToFit() },
  { label: 'Zoom to selection', shortcut: 'Shift+2', action: () => editor.zoomToSelection(), disabled: !editor.selection.length }
], { align: 'right' }));

// ---------- keyboard ----------
const typing = el => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
window.addEventListener('keydown', e => {
  if (menuKeys(e)) { e.preventDefault(); return; }
  const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  // File shortcuts work everywhere, also on the start screen.
  if (ctrl && k === 'o') { e.preventDefault(); return openDialog(); }
  if (ctrl && k === 'n') { e.preventDefault(); return closeDesign(); }
  if (ctrl && k === 's') { e.preventDefault(); return save(e.shiftKey); }
  if (ctrl && k === '/') { e.preventDefault(); return $('#shortcuts').open ? $('#shortcuts').close() : $('#shortcuts').showModal(); }
  if (!editor.doc || typing(document.activeElement) || $('#shortcuts').open) return;
  if (e.key === 'Escape' && document.querySelector('.picker')) { closeColorPicker(); return; }

  if (e.key === ' ') { e.preventDefault(); canvasApi.setSpace(true); return; }
  const handled = () => e.preventDefault();
  if (ctrl) {
    if (k === 'z' && !e.shiftKey) return handled(), editor.undo();
    if ((k === 'z' && e.shiftKey) || k === 'y') return handled(), editor.redo();
    if (k === 'd') return handled(), editor.duplicateSelection({ x: 0, y: 0 });
    if (k === 'g') return handled(), e.shiftKey ? editor.unwrap() : editor.wrap(e.altKey ? 'frame' : 'group');
    if (e.shiftKey && k === 'e') return handled(), exportLayers();
    if (e.shiftKey && k === 'c') return handled(), copyAs('png');
    if (k === 'a') return handled(), editor.selectAll();
    if (k === 'c') return handled(), editor.copy();
    if (k === 'x') return handled(), editor.cut();
    if (k === 'v') return handled(), editor.paste();
    if (e.key === ']') return handled(), editor.arrange(e.shiftKey ? Infinity : 1);
    if (e.key === '[') return handled(), editor.arrange(e.shiftKey ? -Infinity : -1);
    if (k === '=' || k === '+') return handled(), editor.zoomBy(2);
    if (k === '-') return handled(), editor.zoomBy(0.5);
    if (k === '0') return handled(), editor.zoomTo(1);
    if (e.shiftKey && k === 'h') return handled(), editor.toggle(editor.selection, 'visible');
    if (e.shiftKey && k === 'l') return handled(), editor.toggle(editor.selection, 'locked');
    return;
  }
  if (e.shiftKey && e.code === 'Digit0') return handled(), editor.zoomTo(1);
  if (e.shiftKey && e.code === 'Digit1') return handled(), editor.zoomToFit();
  if (e.shiftKey && e.code === 'Digit2') return handled(), editor.zoomToSelection();
  // Alt + A/D/W/S/H/V: align left/right/top/bottom, horizontal/vertical centres (as in other design tools).
  const alignKeys = { KeyA: 'left', KeyD: 'right', KeyW: 'top', KeyS: 'bottom', KeyH: 'center', KeyV: 'middle' };
  if (e.altKey && alignKeys[e.code]) return handled(), editor.align(alignKeys[e.code]);
  if (e.altKey && e.shiftKey && e.code === 'KeyT') return handled(), editor.tidyUp();
  const toolKeys = { v: 'move', f: 'frame', r: 'rect', o: 'ellipse', t: 'text' };
  if (toolKeys[k] && !e.altKey) return handled(), editor.setTool(toolKeys[k]);
  if (e.key === 'Escape') {
    if (closeMenu()) return;
    if (editor.tool !== 'move') return editor.setTool('move');
    return editor.selectParent();
  }
  if (e.key === 'Enter') {
    const [n] = editor.selectedNodes;
    if (n?.type === 'text' && editor.selection.length === 1) return handled(), editor.startEditingText(n.id);
    return handled(), editor.selectChildren();
  }
  if (e.key === 'Delete' || e.key === 'Backspace') return handled(), editor.deleteSelection();
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[e.key]) { const [x, y] = arrows[e.key], s = e.shiftKey ? 10 : 1; return handled(), editor.nudge(x * s, y * s); }
});
window.addEventListener('keyup', e => { if (e.key === ' ') canvasApi.setSpace(false); });
window.addEventListener('blur', () => canvasApi.setSpace(false));

// ---------- shortcuts dialog ----------
const shortcutGroups = [
  ['Tools', [['V', 'Move'], ['F', 'Frame'], ['R', 'Rectangle'], ['O', 'Ellipse'], ['T', 'Text']]],
  ['Canvas', [['Space + drag, middle mouse or scroll', 'Pan'], ['Ctrl + scroll', 'Zoom'], ['Shift+1 / Shift+2 / Shift+0', 'Zoom to fit'],
    ['Shift', 'Keep proportions while resizing'], ['Alt', 'Resize from the center'], ['Alt + drag', 'Duplicate while dragging'], ['Ctrl + click', 'Select the deepest layer']]],
  ['Editing', [['Ctrl+Z / Ctrl+Shift+Z', 'Undo'], ['Ctrl+D', 'Duplicate'], ['Del', 'Delete'], ['Ctrl+A', 'Select all'], ['← ↑ → ↓', 'Nudge (Shift = 10 px)'],
    ['Ctrl+C / Ctrl+V', 'Copy / paste'], ['Ctrl+] / Ctrl+[', 'Bring forward / send backward'], ['Esc', 'Select parent'], ['Enter', 'Select the layer inside / edit text'],
    ['Ctrl+Shift+H / L', 'Hide / lock'], ['Ctrl+G / Ctrl+Shift+G', 'Group / ungroup'], ['Ctrl+Alt+G', 'Frame selection'],
    ['Alt+A D W S H V', 'Align'], ['Ctrl + drag', 'Place without snapping'], ['Alt + hover', 'Measure distances'],
    ['Ctrl+Shift+E', 'Export…'], ['Ctrl+Shift+C', 'Copy as PNG']]]
];
$('#shortcuts').innerHTML = `<h2>${t('Keyboard shortcuts')}</h2><div class="shortcut-cols">${shortcutGroups.map(([title, rows]) =>
  `<div><h3>${t(title)}</h3><dl>${rows.map(([keys, what]) => `<dt>${t(keys)}</dt><dd>${t(what)}</dd>`).join('')}</dl></div>`).join('')}</div>
  <form method="dialog"><button class="primary">${t('Close')}</button></form>`;

// ---------- start ----------
(async () => {
  const pending = await host.pendingOpen();
  if (pending) openPath(pending); else start.show();
})();

// Self check used by `--smoke-test`: draws through the same code paths as the mouse and saves + reopens a file.
window.__visual = {
  editor,
  async smoke(path) {
    const checks = {};
    editor.newDocument('Smoke', { name: 'Phone', w: 390, h: 844 });
    showEditor();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    editor.zoomToFit();
    const frame = editor.page.children[0];
    const cam = editor.camera;
    const at = (x, y) => { const b = canvas.getBoundingClientRect(); return { clientX: b.left + (x - cam.x) * cam.zoom, clientY: b.top + (y - cam.y) * cam.zoom }; };
    const fire = (type, p, extra = {}) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, buttons: 1, ...p, ...extra }));
    const drag = (a, b, extra) => { fire('pointerdown', at(...a), extra); fire('pointermove', at((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), extra); fire('pointermove', at(...b), extra); fire('pointerup', at(...b), extra); };

    editor.setTool('rect'); drag([24, 120], [366, 320]);
    const card = frame.children[0];
    checks.drewRectInFrame = card?.type === 'rect' && card.w === 342 && card.h === 200 && card.x === 24;
    editor.update([card.id], { fills: [solid('#6750a4')], radius: 24 });
    editor.setTool('ellipse'); drag([48, 150], [96, 198], { shiftKey: true });
    checks.drewCircle = frame.children[1]?.type === 'ellipse' && frame.children[1].w === frame.children[1].h;
    editor.update([frame.children[1].id], { fills: [solid('#ffffff')] });
    editor.transact(() => {
      const heading = editor.addNode('text', { x: 24, y: 48, text: 'Good morning', fontSize: 32, fontWeight: 700, fills: [solid('#1c1b1f')] }, frame);
      const sub = editor.addNode('text', { x: 24, y: 344, w: 342, sizing: 'auto-height', text: 'Continue where you left off: three subjects are waiting for you today.', fontSize: 16, fills: [solid('#49454f')] }, frame);
      editor.selection = [heading.id, sub.id];
    });
    checks.textFits = frame.children[2].w > 100 && frame.children[3].h > 20;
    // Move the card by dragging it (clicks inside a frame pick its direct child).
    editor.setTool('move'); editor.clearSelection();
    drag([200, 300], [200, 320], { ctrlKey: true }); // Ctrl: no snapping
    checks.moved = card.y === 140 && editor.selection[0] === card.id;
    editor.undo();
    // Undo restores a copy of the document, so look the card up again.
    checks.undoMove = editor.page.children[0].children[0].y === 120;
    editor.redo();
    const cardId = editor.page.children[0].children[0].id;
    const node = id => editor.node(id);

    // Resize with the bottom-right handle.
    editor.select([cardId]);
    let r = node(cardId);
    drag([r.x + frame.x + r.w, r.y + frame.y + r.h], [r.x + frame.x + r.w + 20, r.y + frame.y + r.h + 10], { ctrlKey: true });
    checks.resized = node(cardId).w === 362 && node(cardId).h === 210;

    // Selection rectangle from the empty canvas over the card.
    editor.clearSelection();
    drag([-60, 250], [100, 260]);
    checks.marquee = editor.selection.includes(cardId);

    // A sum in the W field: "/2".
    editor.select([cardId]);
    await new Promise(r => setTimeout(r));
    const wField = [...document.querySelectorAll('#right .num')].find(f => f.querySelector('.lbl').textContent === 'W').querySelector('input');
    wField.value = '/2'; wField.dispatchEvent(new Event('change'));
    checks.expression = node(cardId).w === 181;

    // Typing in a text layer (double-click), then undo.
    const headingId = editor.page.children[0].children[2].id;
    editor.select([headingId]);
    canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, ...at(40, 60) }));
    const area = document.querySelector('.text-edit');
    area.value = 'Hi there'; area.dispatchEvent(new Event('input'));
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    checks.typed = !editor.editingTextId && node(headingId).text === 'Hi there' && node(headingId).name === 'Hi there' && area.hidden;
    editor.undo();
    checks.undoTyping = node(headingId).text === 'Good morning';

    // Out of the frame onto the page via the layer tree's move.
    const dotId = editor.page.children[0].children[1].id;
    editor.moveLayers([dotId], null, editor.page.children.length);
    checks.reparented = editor.index.get(dotId).parent === null && editor.page.children.at(-1).id === dotId;
    editor.undo();

    // ---------- step 2: snapping, groups, alignment, paints, effects, export ----------
    // Dragging the card to 1 px from the frame's edge snaps it onto the edge.
    editor.clearSelection();
    drag([100, 250], [77, 250]);
    checks.snapped = node(cardId).x === 0;
    editor.undo();

    const dot = editor.page.children[0].children[1];
    editor.select([cardId, dot.id]);
    editor.wrap('group');
    const group = editor.selectedNodes[0];
    checks.grouped = group?.type === 'group' && group.children.length === 2 && group.x === 24 && group.w === 181;
    editor.unwrap();
    checks.ungrouped = editor.page.children[0].children.every(n => n.type !== 'group') && editor.selection.length === 2;

    editor.select([cardId, headingId]);
    editor.align('right');
    checks.aligned = node(cardId).x + node(cardId).w === node(headingId).x + node(headingId).w;
    editor.undo();

    // The colour picker turns the card's fill into a gradient.
    editor.select([cardId]);
    await new Promise(r => setTimeout(r));
    document.querySelector('#right .swatch-btn').click();
    document.querySelector('.picker [data-type="linear"]').click();
    closeColorPicker();
    checks.pickerGradient = node(cardId).fills[0].type === 'linear' && editor.history.canUndo;
    editor.update([cardId], { fills: [gradient('linear', [{ pos: 0, color: '#ffffff', opacity: 1 }, { pos: 1, color: '#000000', opacity: 1 }], 180)],
      strokes: [stroke('#ff0000', 2)], effects: [{ type: 'drop-shadow', x: 0, y: 8, blur: 24, spread: 0, color: '#000000', opacity: 0.3, visible: true }] });
    const { renderCanvas } = await import('./render/export.js');
    const pic = await renderCanvas(node(cardId), 1);
    const px = (x, y) => [...pic.getContext('2d').getImageData(x, y, 1, 1).data];
    const m = (pic.width - node(cardId).w) / 2; // room for the shadow
    const top = px(m + 90, m + 20), bottom = px(m + 90, m + 190), edge = px(m + 90, m + 0.5);
    checks.gradientDrawn = top[0] > 200 && bottom[0] < 60;
    checks.strokeDrawn = edge[0] > 200 && edge[1] < 80;
    const svg = await exportNode(node(cardId), { format: 'svg' });
    checks.svg = svg.data.includes('<linearGradient') && svg.data.includes(`data-visual-id="${cardId}"`) && svg.data.includes('feGaussianBlur');
    editor.update([cardId], { exports: [{ format: 'png', scale: 2 }, { format: 'svg', scale: 1 }] });
    const exported = await exportLayers([node(cardId)], path.replace(/\.visual$/i, '-export'));
    checks.exported = exported?.names.join(',') === 'Rectangle@2x.png,Rectangle.svg';

    const ids = JSON.stringify(editor.page.children[0].children.map(n => n.id));
    editor.select([editor.page.children[0].children[0].id]);
    const saved = await host.save(path, serializeDocument(editor.doc));
    const back = parseDocument((await host.read(saved)).text);
    checks.idsSurviveSave = JSON.stringify(back.pages[0].children[0].children.map(n => n.id)) === ids;
    checks.layers = document.querySelectorAll('#left .layer').length;
    checks.props = document.querySelectorAll('#right .prop-section').length;
    // Leave the window mid-drag with the colour picker open, so a screenshot shows guides, distances and the picker.
    const ellipseId = editor.page.children[0].children[1].id;
    // Frosted glass on the circle and an inner shadow on the card, to see them in the screenshot.
    editor.update([ellipseId], { fills: [solid('#ffffff', 0.25)], strokes: [stroke('#ffffff', 1)], effects: [{ type: 'background-blur', radius: 16, visible: true }] });
    editor.update([cardId], { effects: [...node(cardId).effects, { type: 'inner-shadow', x: 0, y: 6, blur: 12, spread: 0, color: '#ff00aa', opacity: 0.8, visible: true }] });
    try { renderer.draw(); checks.effectsDraw = true; } catch { checks.effectsDraw = false; }
    // Background blur: over the card's right edge, the dark card bleeds into the white just outside it.
    editor.update([ellipseId], { x: 181, y: 280 });
    const sample = () => {
      renderer.draw();
      const dpr = window.devicePixelRatio || 1, c = editor.camera;
      const x = Math.round((node(cardId).x + node(cardId).w + 4 - c.x) * c.zoom * dpr), y = Math.round((304 - c.y) * c.zoom * dpr);
      return canvas.getContext('2d').getImageData(x, y, 1, 1).data[0];
    };
    const blurred = sample();
    editor.update([ellipseId], n => ({ effects: n.effects.map(e => ({ ...e, visible: false })) }));
    const sharp = sample();
    checks.backgroundBlur = sharp > 200 && blurred < sharp - 10; // the card's own shadow already greys the white a little
    editor.undo(); editor.undo();
    editor.select([ellipseId]);
    fire('pointerdown', at(72, 174), { pointerId: 7 }); // not the mouse's id, so the real cursor can't take over
    fire('pointermove', at(150, 178), { pointerId: 7 });
    fire('pointermove', at(163, 180), { pointerId: 7 });
    await new Promise(r => setTimeout(r, 50));
    document.querySelector('#right .swatch-btn').click();
    return { ok: Object.values(checks).every(Boolean), checks, lang };
  }
};
