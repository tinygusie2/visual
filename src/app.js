// Entry point of the editor page: wires the editor state to the canvas, panels, top bar, tools, shortcuts and files.
import { parseDocument, serializeDocument } from './core/document.js';
import { attachCanvas } from './editor/canvas.js';
import { Editor } from './editor/editor.js';
import { attachTextEditor } from './editor/textedit.js';
import { Renderer } from './render/renderer.js';
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
const canvasApi = attachCanvas(canvas, editor, renderer);
attachTextEditor($('#stage'), editor);
attachLayers($('#left'), editor);
attachProperties($('#right'), editor, { fonts });
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

  if (e.key === ' ') { e.preventDefault(); canvasApi.setSpace(true); return; }
  const handled = () => e.preventDefault();
  if (ctrl) {
    if (k === 'z' && !e.shiftKey) return handled(), editor.undo();
    if ((k === 'z' && e.shiftKey) || k === 'y') return handled(), editor.redo();
    if (k === 'd') return handled(), editor.duplicateSelection({ x: 0, y: 0 });
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
    ['Ctrl+Shift+H / L', 'Hide / lock']]]
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
    editor.update([card.id], { fill: '#6750a4', radius: 24 });
    editor.setTool('ellipse'); drag([48, 150], [96, 198], { shiftKey: true });
    checks.drewCircle = frame.children[1]?.type === 'ellipse' && frame.children[1].w === frame.children[1].h;
    editor.update([frame.children[1].id], { fill: '#ffffff' });
    editor.transact(() => {
      const heading = editor.addNode('text', { x: 24, y: 48, text: 'Good morning', fontSize: 32, fontWeight: 700, fill: '#1c1b1f' }, frame);
      const sub = editor.addNode('text', { x: 24, y: 344, w: 342, sizing: 'auto-height', text: 'Continue where you left off: three subjects are waiting for you today.', fontSize: 16, fill: '#49454f' }, frame);
      editor.selection = [heading.id, sub.id];
    });
    checks.textFits = frame.children[2].w > 100 && frame.children[3].h > 20;
    // Move the card by dragging it (clicks inside a frame pick its direct child).
    editor.setTool('move'); editor.clearSelection();
    drag([200, 300], [200, 320]);
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
    drag([r.x + frame.x + r.w, r.y + frame.y + r.h], [r.x + frame.x + r.w + 20, r.y + frame.y + r.h + 10]);
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

    const ids =JSON.stringify(editor.page.children[0].children.map(n => n.id));
    editor.select([editor.page.children[0].children[0].id]);
    const saved = await host.save(path, serializeDocument(editor.doc));
    const back = parseDocument((await host.read(saved)).text);
    checks.idsSurviveSave = JSON.stringify(back.pages[0].children[0].children.map(n => n.id)) === ids;
    checks.layers = document.querySelectorAll('#left .layer').length;
    checks.props = document.querySelectorAll('#right .prop-section').length;
    return { ok: Object.values(checks).every(Boolean), checks, lang };
  }
};
