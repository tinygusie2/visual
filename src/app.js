// Entry point of the editor page: wires the editor state to the canvas, panels, top bar, tools, shortcuts and files.
import { absolute, absoluteRect, parseDocument, serializeDocument } from './core/document.js';
import { gradient, solid, stroke } from './core/paint.js';
import { attachCanvas } from './editor/canvas.js';
import { Editor } from './editor/editor.js';
import { attachTextEditor } from './editor/textedit.js';
import { exportNode } from './render/export.js';
import { imageMime, makeAsset } from './render/images.js';
import { importSvg } from './editor/svgimport.js';
import { Renderer } from './render/renderer.js';
import { closeColorPicker } from './ui/colorpicker.js';
import { lang, t } from './ui/i18n.js';
import { icon, wink } from './ui/icons.js';
import { attachLayers, inlineRename } from './ui/layers.js';
import { closeMenu, menuKeys, showMenu } from './ui/menu.js';
import { attachProperties } from './ui/properties.js';
import { attachStart } from './ui/start.js';
import { attachAssets } from './ui/assets.js';

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
const canvasApi = attachCanvas(canvas, editor, renderer, {
  onContextMenu: point => showMenu(point, contextMenu()),
  onDropFiles: async (files, at) => importFiles(await Promise.all(files.map(async f => ({ name: f.name, data: await f.arrayBuffer() }))), at),
  // From the assets panel: a component becomes an instance, an image is placed again.
  onDropItem: (item, at) => {
    editor.setTool('move');
    if (item.kind === 'component') editor.createInstance(item.id, at);
    if (item.kind === 'image' && editor.assets.has(item.id)) editor.placeImages([{ id: item.id, ...editor.assets.get(item.id) }], at);
  }
});
attachTextEditor($('#stage'), editor);

// Left sidebar: two tabs, the layers (with the pages) and the assets.
$('#left').innerHTML = `<div class="left-tabs" role="tablist">
  <button role="tab" data-tab="layers" title="${t('Layers')}  (Alt+1)">${t('Layers')}</button>
  <button role="tab" data-tab="assets" title="${t('Assets')}  (Alt+2)">${t('Assets')}</button></div>
  <div class="left-pane" data-pane="layers"></div><div class="left-pane" data-pane="assets" hidden></div>`;
attachLayers($('[data-pane=layers]'), editor);
const assets = attachAssets($('[data-pane=assets]'), editor, { onPlaceImage: a => { editor.setTool('move'); editor.placeImages([a]); } });
function showTab(name) {
  document.querySelectorAll('.left-tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.left-pane').forEach(p => { p.hidden = p.dataset.pane !== name; });
  assets.show(name === 'assets');
  try { localStorage.setItem('visual.leftTab', name); } catch {}
}
document.querySelectorAll('.left-tabs [data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
showTab((() => { try { return localStorage.getItem('visual.leftTab') === 'assets' ? 'assets' : 'layers'; } catch { return 'layers'; } })());
attachProperties($('#right'), editor, { fonts, onExport: nodes => exportLayers(nodes), onPickImage: pickImage });
new ResizeObserver(() => { editor.viewport = { w: canvas.clientWidth, h: canvas.clientHeight }; }).observe(canvas);
editor.viewport = { w: canvas.clientWidth || 1200, h: canvas.clientHeight || 800 };

const tools = [['move', 'Move', 'V'], ['frame', 'Frame', 'F'], ['rect', 'Rectangle', 'R'], ['ellipse', 'Ellipse', 'O'], ['text', 'Text', 'T']];
$('#toolbar').replaceChildren(...tools.map(([id, label, key]) => {
  const b = document.createElement('button');
  b.className = 'icon tool'; b.dataset.tool = id; b.title = `${t(label)}  (${key})`;
  b.innerHTML = icon(id);
  b.addEventListener('click', () => editor.setTool(id));
  return b;
}), Object.assign(document.createElement('span'), { className: 'tool-sep' }), (() => {
  const b = document.createElement('button');
  b.className = 'icon tool'; b.title = `${t('Place image or SVG…')}  (Ctrl+Shift+K)`;
  b.innerHTML = icon('image');
  b.addEventListener('click', () => placeFromDialog());
  return b;
})());

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
    $('#doc-name').classList.toggle('dirty', editor.dirty);
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
  if (answer === 'discard') recovery.clear();
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
    await host.save(path, serializeDocument(editor.doc, editor.assets));
    editor.markSaved(path);
    recovery.clear();
    editor.emit({ doc: false, file: true });
    toast(t('Saved'));
    return true;
  } catch (err) { toast(t('Could not save: {0}', err.message), 'error'); return false; }
}

// ---------- autosave for recovery ----------
// A few seconds after a change, the design is written to Visual's recovery folder (never over your own file). If
// Visual or the PC crashes, the start screen offers it back next time.
const recovery = {
  timer: null, docId: null,
  schedule() {
    if (!editor.doc || !editor.dirty) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.write(), 3000);
  },
  async write() {
    this.timer = null;
    if (!editor.doc || !editor.dirty) return;
    this.docId = editor.doc.id;
    try { await host.recoveryWrite(editor.doc.id, { name: editor.doc.name, path: editor.path }, serializeDocument(editor.doc, editor.assets)); } catch {}
  },
  clear() {
    clearTimeout(this.timer); this.timer = null;
    const id = editor.doc?.id || this.docId;
    if (id) host.recoveryRemove(id);
  }
};
editor.addEventListener('change', ({ what }) => { if (what.doc || what.file) recovery.schedule(); });

async function restoreRecovered(meta) {
  if (!(await confirmDiscard())) return;
  try {
    editor.load(parseDocument(await host.recoveryRead(meta.id)), meta.path || null);
    editor.dirty = true; editor.emit({ file: true });
    showEditor();
    toast(t('Restored “{0}”. Save it to keep it.', meta.name));
  } catch (err) { toast(t('Could not open {0}: {1}', meta.name, err.message), 'error'); }
}

// ---------- placing images and SVG ----------
// files: [{ name, data: ArrayBuffer | Uint8Array }] → images become image layers, SVG files editable layers.
async function importFiles(files, at) {
  if (!editor.doc || !files.length) return;
  const images = [];
  for (const f of files) {
    try {
      if (/\.svg$/i.test(f.name)) {
        const frame = importSvg(new TextDecoder().decode(f.data), f.name.replace(/\.svg$/i, ''));
        editor.importNodes([frame], at);
      } else if (imageMime(f.name)) images.push(await makeAsset(f.data, imageMime(f.name), f.name.replace(/\.[^.]+$/, '')));
      else toast(t('{0} is not an image or SVG file', f.name), 'error');
    } catch (err) { toast(t('Could not place {0}: {1}', f.name, err.message), 'error'); }
  }
  if (images.length) editor.placeImages(images, at);
  editor.setTool('move');
}
async function placeFromDialog() {
  if (!editor.doc) return;
  const files = await host.importDialog(t('Place image or SVG…'));
  if (files?.length) importFiles(files);
}
// For an image fill: one picture, chosen in a dialog.
async function pickImage() {
  const files = (await host.importDialog(t('Choose image'))).filter(f => imageMime(f.name));
  if (!files.length) return null;
  try { return await makeAsset(files[0].data, imageMime(files[0].name), files[0].name.replace(/\.[^.]+$/, '')); }
  catch (err) { toast(t('Could not place {0}: {1}', files[0].name, err.message), 'error'); return null; }
}

// ---------- system clipboard: layers between windows and designs, images and SVG from other apps ----------
window.addEventListener('copy', e => {
  if (!editor.doc || typing(document.activeElement)) return;
  if (!editor.copy()) return;
  e.preventDefault();
  const payload = JSON.stringify(editor.clipboardPayload());
  e.clipboardData.setData('text/plain', payload);
});
window.addEventListener('cut', e => {
  if (!editor.doc || typing(document.activeElement) || !editor.selection.length) return;
  e.preventDefault();
  editor.copy();
  e.clipboardData.setData('text/plain', JSON.stringify(editor.clipboardPayload()));
  editor.deleteSelection();
});
window.addEventListener('paste', async e => {
  if (!editor.doc || typing(document.activeElement)) return;
  e.preventDefault();
  const files = [...e.clipboardData.files];
  const text = e.clipboardData.getData('text/plain');
  if (text.startsWith('{"format":"visual-layers"')) {
    try { editor.takeClipboard(JSON.parse(text)); } catch {}
    return editor.paste();
  }
  if (files.length) {
    const data = await Promise.all(files.map(async f => ({ name: f.name || `Pasted image.${(f.type.split('/')[1] || 'png')}`, data: await f.arrayBuffer() })));
    return importFiles(data);
  }
  if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)) return importFiles([{ name: 'Pasted SVG.svg', data: new TextEncoder().encode(text) }]);
  editor.paste();
});

// ---------- export and copy as ----------
// Every export setting of every layer; a layer without settings exports as PNG 1×. One folder for all files.
async function exportLayers(nodes = editor.selectedNodes, folder) {
  if (!nodes.length) return null;
  try {
    const files = [];
    for (const node of nodes) for (const e of node.exports.length ? node.exports : [{ format: 'png', scale: 1 }]) files.push(await exportNode(node, { ...e, assets: editor.assets }));
    const done = await host.exportFiles(files, t('Export to folder'), folder);
    if (done && !folder) toast(t('Exported {0} files to {1}', done.names.length, done.folder));
    return done;
  } catch (err) { toast(t('Export failed: {0}', err.message), 'error'); return null; }
}

async function copyAs(format) {
  const [node] = editor.selectedNodes;
  if (!node) return;
  const file = await exportNode(node, { format, scale: format === 'png' ? 2 : 1, assets: editor.assets });
  if (format === 'svg') await host.copyText(file.data); else await host.copyImage(file.data);
  toast(t(format === 'svg' ? 'Copied as SVG' : 'Copied as PNG'));
}

function contextMenu() {
  const sel = editor.selectedNodes, has = sel.length > 0;
  const allHidden = has && sel.every(n => !n.visible), allLocked = has && sel.every(n => n.locked);
  const one = sel.length === 1 ? sel[0] : null;
  const inInstance = one && editor.movable([one.id]).length === 0;
  const instance = one && (one.instanceOf || inInstance);
  return [
    ...(instance ? [
      { label: 'Go to main component', action: () => editor.goToComponent(one.id) },
      { label: 'Reset changes', action: () => editor.resetOverrides([one.id]), disabled: !editor.overridesOf(one.id).length },
      ...(one.instanceOf && !inInstance ? [{ label: 'Detach instance', shortcut: 'Ctrl+Alt+B', action: () => editor.detachInstances() }] : []),
      '-'
    ] : []),
    { label: 'Copy', shortcut: 'Ctrl+C', action: () => editor.copy(), disabled: !has },
    { label: 'Paste', shortcut: 'Ctrl+V', action: () => editor.paste(), disabled: !editor.clipboard },
    { label: 'Duplicate', shortcut: 'Ctrl+D', action: () => editor.duplicateSelection(), disabled: !has },
    '-',
    { label: 'Group selection', shortcut: 'Ctrl+G', action: () => editor.wrap('group'), disabled: !has },
    { label: 'Frame selection', shortcut: 'Ctrl+Alt+G', action: () => editor.wrap('frame'), disabled: !has },
    { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', action: () => editor.unwrap(), disabled: !sel.some(n => n.children) },
    { label: 'Create component', shortcut: 'Ctrl+Alt+K', action: () => editor.createComponent(), disabled: !has || !!inInstance || !!one?.component },
    sel.length === 1 && sel[0].layout
      ? { label: 'Remove auto layout', shortcut: 'Alt+Shift+A', action: () => editor.removeAutoLayout() }
      : { label: 'Add auto layout', shortcut: 'Shift+A', action: () => editor.addAutoLayout(), disabled: !has },
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
  editor.doc = null; editor.path = null; editor.dirty = false; editor.assets = new Map();
  document.body.classList.remove('has-doc');
  document.title = 'Visual';
  start.show();
}

host.onRequestClose(async () => { if (await confirmDiscard()) host.closeWindow(); });
host.onOpenPath(path => openPath(path));

const start = attachStart($('#start'), { onTemplate: newFromTemplate, onOpen: openDialog, onOpenPath: openPath, onRecover: restoreRecovered });

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
  { label: 'Place image or SVG…', shortcut: 'Ctrl+Shift+K', action: placeFromDialog, disabled: !editor.doc },
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
    if (e.altKey && k === 'k') return handled(), editor.createComponent();
    if (e.altKey && k === 'b') return handled(), editor.detachInstances();
    if (e.shiftKey && k === 'k') return handled(), placeFromDialog();
    // Ctrl+C / X / V: handled by the copy, cut and paste events (system clipboard).
    if (k === 'c' || k === 'x' || k === 'v') return;
    if (e.key === ']') return handled(), editor.arrange(e.shiftKey ? Infinity : 1);
    if (e.key === '[') return handled(), editor.arrange(e.shiftKey ? -Infinity : -1);
    if (k === '=' || k === '+') return handled(), editor.zoomBy(2);
    if (k === '-') return handled(), editor.zoomBy(0.5);
    if (k === '0') return handled(), editor.zoomTo(1);
    if (e.shiftKey && k === 'h') return handled(), editor.toggle(editor.selection, 'visible');
    if (e.shiftKey && k === 'l') return handled(), editor.toggle(editor.selection, 'locked');
    return;
  }
  if (e.altKey && e.code === 'Digit1') return handled(), showTab('layers');
  if (e.altKey && e.code === 'Digit2') return handled(), showTab('assets');
  if (e.shiftKey && e.code === 'Digit0') return handled(), editor.zoomTo(1);
  if (e.shiftKey && e.code === 'Digit1') return handled(), editor.zoomToFit();
  if (e.shiftKey && e.code === 'Digit2') return handled(), editor.zoomToSelection();
  // Alt + A/D/W/S/H/V: align left/right/top/bottom, horizontal/vertical centres (as in other design tools).
  const alignKeys = { KeyA: 'left', KeyD: 'right', KeyW: 'top', KeyS: 'bottom', KeyH: 'center', KeyV: 'middle' };
  if (e.altKey && alignKeys[e.code]) return handled(), editor.align(alignKeys[e.code]);
  if (e.altKey && e.shiftKey && e.code === 'KeyT') return handled(), editor.tidyUp();
  if (e.shiftKey && e.code === 'KeyA') return handled(), e.altKey ? editor.removeAutoLayout() : editor.addAutoLayout();
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
    ['Ctrl+Shift+E', 'Export…'], ['Ctrl+Shift+C', 'Copy as PNG'], ['Shift+A / Alt+Shift+A', 'Add / remove auto layout'],
    ['Ctrl+Shift+K', 'Place image or SVG…']]],
  ['Components', [['Ctrl+Alt+K', 'Create component'], ['Ctrl+Alt+B', 'Detach instance'], ['Ctrl+D / Alt + drag', 'Duplicate a component: a new instance'],
    ['Double-click', 'Go into an instance'], ['Alt+1 / Alt+2', 'Layers / assets']]]
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
  editor, showTab,
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

    // ---------- step 3: auto layout, constraints, images, SVG import, clipboard, recovery ----------
    const firstPage = editor.pageId;
    editor.addPage('Step 3');
    editor.zoomTo(1);
    const c = editor.viewCenter();
    editor.transact(() => {
      const a = editor.addNode('rect', { name: 'A', x: c.x - 150, y: c.y, w: 80, h: 60 });
      const b = editor.addNode('rect', { name: 'B', x: c.x - 40, y: c.y, w: 80, h: 60 });
      const d = editor.addNode('rect', { name: 'C', x: c.x + 70, y: c.y, w: 80, h: 60 });
      editor.selection = [a.id, b.id, d.id];
    });
    editor.addAutoLayout();
    const list = editor.selectedNodes[0];
    checks.autoLayout = list?.layout?.mode === 'row' && list.layout.gap === 30 && list.widthMode === 'hug' && list.w === 300 && list.children.map(n => n.name).join('') === 'ABC';
    // Drag A past C: it moves to the end, the others close up.
    const L = () => editor.node(list.id);
    const abs = n => absolute(editor.index, n.id);
    const cam3 = editor.camera;
    const at3 = (x, y) => { const b = canvas.getBoundingClientRect(); return { clientX: b.left + (x - cam3.x) * cam3.zoom, clientY: b.top + (y - cam3.y) * cam3.zoom }; };
    const fire3 = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 3, button: 0, buttons: 1, ...at3(x, y) }));
    editor.clearSelection();
    const pa = abs(L().children[0]);
    fire3('pointerdown', pa.x + 40, pa.y + 30); fire3('pointermove', pa.x + 120, pa.y + 30); fire3('pointermove', pa.x + 290, pa.y + 30);
    checks.dropLine = !!editor.drag?.dropLine && editor.floating.size === 1;
    fire3('pointerup', pa.x + 290, pa.y + 30);
    checks.reordered = L().children.map(n => n.name).join('') === 'BCA' && L().children[0].x === 0 && editor.floating.size === 0;
    editor.update([L().children[1].id], { widthMode: 'fill' });
    editor.update([list.id], { w: 400, widthMode: 'fixed' });
    checks.fill = L().children[1].w === 180 && L().children[2].x === 320;
    editor.undo(); editor.undo();
    // Constraints: a layer pinned right stays 10 px from the right edge.
    const box3 = editor.addNode('frame', { name: 'Box', x: c.x - 100, y: c.y + 120, w: 200, h: 100 });
    editor.transact(() => { editor.addNode('rect', { name: 'Pin', x: c.x + 50, y: c.y + 130, w: 40, h: 20, constraints: { h: 'right', v: 'top' } }, editor.node(box3.id)); });
    editor.update([box3.id], { w: 300 });
    const pin = editor.node(box3.id).children[0];
    checks.constraints = pin.x + pin.w === 290;

    // An SVG: a rectangle, a rotated square (becomes a path), a circle, a line and text.
    const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 60 40">
      <rect x="2" y="2" width="20" height="10" rx="2" fill="#ff0000"/><rect x="30" y="4" width="8" height="8" fill="#00ff00" transform="rotate(45 34 8)"/>
      <circle cx="10" cy="28" r="6" fill="#0000ff" stroke="#000" stroke-width="1"/><path d="M30 30 h20" stroke="#333" stroke-width="2"/>
      <text x="40" y="36" font-size="6" fill="#123456">Hi</text><script>alert(1)</script></svg>`;
    await importFiles([{ name: 'shapes.svg', data: new TextEncoder().encode(svgText) }], { x: c.x, y: c.y + 320 });
    const svgFrame = editor.selectedNodes[0];
    const kinds = svgFrame?.children.map(n => n.type).join(',');
    checks.svgImport = svgFrame?.w === 120 && kinds === 'rect,vector,ellipse,vector,text' && svgFrame.children[0].w === 40 && svgFrame.children[0].radius === 4
      && svgFrame.children[2].strokes[0].width === 2 && svgFrame.children[4].text === 'Hi';

    // An image: a 40 × 20 PNG made here, placed, drawn and exported.
    const png = document.createElement('canvas'); png.width = 40; png.height = 20;
    const pctx = png.getContext('2d'); pctx.fillStyle = '#ff0000'; pctx.fillRect(0, 0, 20, 20); pctx.fillStyle = '#0000ff'; pctx.fillRect(20, 0, 20, 20);
    const pngData = await (await new Promise(r => png.toBlob(r, 'image/png'))).arrayBuffer();
    await importFiles([{ name: 'photo.png', data: pngData }], { x: c.x + 250, y: c.y + 320 });
    const pic3 = editor.selectedNodes[0];
    checks.imagePlaced = pic3?.fills[0]?.type === 'image' && pic3.w === 40 && editor.assets.has(pic3.fills[0].asset);
    const drawn = await renderCanvas(pic3, 1, { assets: editor.assets });
    const px3 = (x, y) => [...drawn.getContext('2d').getImageData(x, y, 1, 1).data];
    checks.imageDrawn = px3(5, 10)[0] > 200 && px3(35, 10)[2] > 200;

    // Copy and paste through the system clipboard format (as between two windows).
    editor.select([pic3.id]); editor.copy();
    const payload = JSON.parse(JSON.stringify(editor.clipboardPayload()));
    editor.clipboard = null;
    editor.takeClipboard(payload); editor.paste();
    checks.clipboard = editor.selectedNodes[0]?.fills[0]?.asset === pic3.fills[0].asset && editor.selectedNodes[0].id !== pic3.id;

    // Recovery: written after a change, readable, gone after it is cleared.
    await recovery.write();
    const rec = parseDocument(await host.recoveryRead(editor.doc.id));
    checks.recovery = rec.pages.length === editor.doc.pages.length && Object.keys(rec.assets).length === 1;
    const step3Page = editor.pageId;

    // ---------- step 4: components, instances, overrides, colour variables, assets panel ----------
    editor.addPage('Step 4');
    editor.zoomTo(1);
    const step4Page = editor.pageId;
    const c4 = editor.viewCenter();
    const tick = () => new Promise(r => setTimeout(r));
    editor.transact(() => {
      const bg = editor.addNode('rect', { name: 'Background', x: c4.x - 260, y: c4.y - 160, w: 120, h: 40, radius: 20, fills: [solid('#5b8cff')], constraints: { h: 'stretch', v: 'top' } });
      const label = editor.addNode('text', { name: 'Label', x: c4.x - 240, y: c4.y - 150, text: 'Buy now', fontSize: 16, fontWeight: 600, fills: [solid('#ffffff')] });
      editor.selection = [bg.id, label.id];
    });
    const btn = editor.createComponent();
    editor.rename(btn.id, 'Button');
    const [bgId, labelId] = btn.children.map(n => n.id);
    checks.componentMade = btn.component === true && btn.children.length === 2 && editor.components().length === 1;
    editor.select([btn.id]);
    editor.duplicateSelection({ x: 0, y: 80 });
    const instId = editor.selection[0];
    const I = () => editor.node(instId);
    checks.duplicateIsInstance = I()?.instanceOf === btn.id && I().children[1].id === `${instId};${labelId}` && I().y === editor.node(btn.id).y + 80;
    editor.update([bgId], { fills: [solid('#ff3366')] });
    checks.instanceFollows = I().children[0].fills[0].color === '#ff3366';
    // Typing in the instance's label is an override; the component's later changes to other properties still come in.
    const instLabelId = `${instId};${labelId}`;
    editor.startEditingText(instLabelId);
    const area4 = document.querySelector('.text-edit');
    area4.value = 'Sold out'; area4.dispatchEvent(new Event('input'));
    area4.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    editor.update([labelId], { text: 'Buy today', fontSize: 18 });
    const IL = () => editor.node(instLabelId);
    checks.overrideKept = IL().text === 'Sold out' && IL().fontSize === 18 && editor.node(labelId).text === 'Buy today' && editor.overridesOf(instLabelId).length === 1;
    // Layers inside an instance don't move; a click picks the instance as a whole and drags it.
    const lx = IL().x;
    editor.select([instLabelId]); editor.nudge(10, 0);
    checks.childFixed = IL().x === lx;
    editor.clearSelection();
    const at4 = (x, y) => { const b = canvas.getBoundingClientRect(), cam = editor.camera; return { clientX: b.left + (x - cam.x) * cam.zoom, clientY: b.top + (y - cam.y) * cam.zoom }; };
    // Ctrl while moving (no snapping), not on the press (that would pick the deepest layer).
    const fire4 = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 4, button: 0, buttons: 1, ctrlKey: type !== 'pointerdown', ...at4(x, y) }));
    const ir = absoluteRect(editor.index, instId);
    fire4('pointerdown', ir.x + 60, ir.y + 5); fire4('pointermove', ir.x + 80, ir.y + 5); fire4('pointermove', ir.x + 100, ir.y + 5); fire4('pointerup', ir.x + 100, ir.y + 5);
    checks.instancePicked = editor.selection[0] === instId && I().x === ir.x + 40;
    // Wider instance: the background stretches (its constraint), the component stays as it is.
    editor.update([instId], { w: 200 });
    checks.instanceResized = I().children[0].w === 200 && editor.node(bgId).w === 120;
    editor.resetOverrides([instId]);
    checks.reset = IL().text === 'Buy today';
    editor.undo();

    // Colour variables: bound in the assets panel and in the colour picker, changed in one place.
    const brand = editor.addVariable('#12b886', 'Brand/Primary');
    editor.select([bgId]); editor.useVariableAsFill(brand.id);
    checks.variableBound = editor.node(bgId).fills[0].variable === brand.id && I().children[0].fills[0].color === '#12b886';
    editor.updateVariable(brand.id, { color: '#f59f00' });
    checks.variableChanged = editor.node(bgId).fills[0].color === '#f59f00' && I().children[0].fills[0].color === '#f59f00';
    let dot4;
    editor.transact(() => { dot4 = editor.addNode('ellipse', { x: c4.x + 200, y: c4.y - 160, w: 40, h: 40 }); editor.selection = [dot4.id]; });
    await tick();
    document.querySelector('#right .swatch-btn').click();
    document.querySelector('.picker .var-colors .sw').click();
    closeColorPicker();
    await tick();
    checks.pickerVariable = editor.node(dot4.id).fills[0].variable === brand.id && !!document.querySelector('#right .var-chip:not([hidden])');

    // The assets panel: the component and the variable are listed; clicking the component adds an instance.
    showTab('assets');
    checks.assetsPanel = document.querySelectorAll('.comp-tile').length === 1 && document.querySelectorAll('.var-row').length === 1 && document.querySelectorAll('.img-tile').length === 1;
    document.querySelector('.comp-tile').click();
    const tileInst = editor.selectedNodes[0];
    checks.tileInstance = tileInst?.instanceOf === btn.id;
    // Nested: a card component around that instance; card instances follow the button component too.
    editor.update([tileInst.id], { x: tileInst.x + 10 });
    const cardComp = editor.createComponent();
    editor.rename(cardComp.id, 'Card');
    editor.update([cardComp.id], { fills: [solid('#ffffff')], w: cardComp.w + 40, h: cardComp.h + 40 });
    editor.select([cardComp.id]); editor.duplicateSelection({ x: 260, y: 0 });
    const cardInstId = editor.selection[0];
    editor.update([bgId], { radius: 6 });
    checks.nested = editor.node(cardInstId)?.children[0]?.children[0]?.radius === 6;
    checks.noCycles = !editor.canHold(editor.node(btn.id), [editor.node(cardInstId)]);
    editor.select([cardInstId]); editor.detachInstances();
    checks.detached = !editor.node(cardInstId).instanceOf && editor.node(cardInstId).children[0].instanceOf === btn.id;
    editor.undo();
    showTab('layers');
    editor.setPage(firstPage);

    const ids = JSON.stringify(editor.page.children[0].children.map(n => n.id));
    editor.select([editor.page.children[0].children[0].id]);
    const saved = await host.save(path, serializeDocument(editor.doc, editor.assets));
    const back = parseDocument((await host.read(saved)).text);
    checks.idsSurviveSave = JSON.stringify(back.pages[0].children[0].children.map(n => n.id)) === ids;
    checks.assetsSurviveSave = Object.keys(back.assets).length === 1 && back.pages.find(pg => pg.id === step3Page).children.length === 5;
    const saved4 = JSON.stringify(back.pages.find(pg => pg.id === step4Page));
    checks.componentsSurviveSave = back.variables.length === 1 && saved4.includes(`"instanceOf":"${btn.id}"`) && saved4.includes('Sold out') && saved4.includes(`"variable":"${brand.id}"`);
    recovery.clear();
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
