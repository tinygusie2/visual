// Left sidebar, second tab: what a design reuses. Components (click one to add an instance in the middle of the
// view, or drag it onto the canvas), colour variables (click one to use it as the fill of the selection, the swatch
// edits its colour everywhere it is used, double-click the name to rename it; a "/" in the name groups them) and the
// images in the design (click or drag to place one again).
import { variableUsage } from '../core/components.js';
import { usedAssets } from '../core/document.js';
import { mainColor, normalizeHex, solid } from '../core/paint.js';
import { renderCanvas } from '../render/export.js';
import { assetUrl } from '../render/images.js';
import { openColorPicker } from './colorpicker.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { inlineRename } from './layers.js';

export const ITEM = 'application/x-visual-item';

export function attachAssets(root, editor, { onPlaceImage }) {
  root.innerHTML = `
    <label class="asset-search">${icon('search')}<input type="text" spellcheck="false"></label>
    <div class="asset-scroll">
      <section class="asset-group" data-group="components">
        <div class="panel-head"><h3>${t('Components')}</h3><span class="count"></span></div>
        <div class="comp-grid"></div>
        <p class="hint empty">${t('Select a frame and press Ctrl+Alt+K to make it a component.')}</p>
      </section>
      <section class="asset-group" data-group="variables">
        <div class="panel-head"><h3>${t('Colour variables')}</h3><button class="icon ghost" data-add-var title="${t('New colour variable')}">${icon('plus')}</button></div>
        <div class="var-list"></div>
        <p class="hint empty">${t('No colour variables yet. Click + or save a colour in the colour picker.')}</p>
      </section>
      <section class="asset-group" data-group="images">
        <div class="panel-head"><h3>${t('Images')}</h3><span class="count"></span></div>
        <div class="img-grid"></div>
        <p class="hint empty">${t('Images you place show up here.')}</p>
      </section>
    </div>`;
  const $ = s => root.querySelector(s);
  const search = $('.asset-search input');
  search.placeholder = t('Search assets');
  search.addEventListener('input', () => render());
  search.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { search.value = ''; render(); search.blur(); } });
  let visible = false, timer = null, picking = false;
  const thumbs = new Map(); // component id → { key, url }
  const matches = name => name.toLowerCase().includes(search.value.trim().toLowerCase());
  const drag = (el, item) => {
    el.draggable = true;
    el.addEventListener('dragstart', e => { e.dataTransfer.setData(ITEM, JSON.stringify(item)); e.dataTransfer.effectAllowed = 'copy'; });
  };

  // ---------- components ----------
  function thumbnail(node, img) {
    const key = JSON.stringify(node);
    const cached = thumbs.get(node.id);
    if (cached?.key === key) { img.src = cached.url; return; }
    if (cached) img.src = cached.url;
    const scale = Math.min(2, 150 / Math.max(node.w, node.h, 1));
    renderCanvas(node, scale, { assets: editor.assets }).then(canvas => {
      const url = canvas.toDataURL('image/png');
      thumbs.set(node.id, { key, url });
      if (img.isConnected) img.src = url;
    }, () => {});
  }
  function renderComponents() {
    const list = editor.components().filter(c => matches(c.node.name));
    $('[data-group=components] .count').textContent = list.length || '';
    $('[data-group=components] .empty').hidden = list.length > 0 || !!search.value;
    $('.comp-grid').replaceChildren(...list.map(({ node, page }) => {
      const tile = document.createElement('div');
      tile.className = 'comp-tile'; tile.dataset.id = node.id;
      tile.title = t('Click to add an instance, or drag it onto the canvas');
      tile.innerHTML = `<span class="thumb"><img alt=""></span><span class="cname"></span><span class="cpage"></span>`;
      tile.querySelector('.cname').textContent = node.name;
      tile.querySelector('.cpage').textContent = page.name;
      const go = document.createElement('button');
      go.className = 'icon ghost go'; go.title = t('Main component'); go.innerHTML = icon('go-to');
      go.addEventListener('click', e => { e.stopPropagation(); editor.setPage(page.id); editor.select([node.id]); editor.zoomToRect(editor.selectionBounds(), 1); });
      tile.append(go);
      tile.addEventListener('click', () => { editor.setTool('move'); editor.createInstance(node.id); });
      drag(tile, { kind: 'component', id: node.id });
      thumbnail(node, tile.querySelector('img'));
      return tile;
    }));
  }

  // ---------- colour variables ----------
  function variableRow(v, uses) {
    const row = document.createElement('div');
    row.className = 'var-row'; row.dataset.id = v.id;
    row.title = t('Click to use as the fill of the selection');
    const sw = document.createElement('button');
    sw.className = 'swatch-btn'; sw.innerHTML = '<span></span>'; sw.title = t('Edit colour');
    sw.firstChild.style.background = v.color;
    let live = false;
    sw.addEventListener('click', e => {
      e.stopPropagation();
      picking = true;
      openColorPicker(sw, {
        paint: solid(v.color), gradients: false, opacity: false,
        onChange: p => { if (!live) { live = true; editor.begin(); } editor.setVariable(v.id, { color: p.color }); sw.firstChild.style.background = p.color; },
        onClose: () => { picking = false; if (live) { live = false; editor.commit(); editor.emit({ doc: true, variables: true }); } else render(); }
      });
    });
    const name = document.createElement('span');
    name.className = 'vname'; name.textContent = v.name.split('/').pop().trim() || v.name;
    name.addEventListener('dblclick', e => { e.stopPropagation(); inlineRename(name, v.name, n => editor.updateVariable(v.id, { name: n.trim() })); });
    const hex = document.createElement('input');
    hex.type = 'text'; hex.className = 'hex'; hex.spellcheck = false; hex.value = v.color.slice(1).toUpperCase();
    hex.addEventListener('click', e => e.stopPropagation());
    hex.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') hex.blur(); if (e.key === 'Escape') { hex.value = v.color.slice(1).toUpperCase(); hex.blur(); } });
    hex.addEventListener('change', () => { const c = normalizeHex(hex.value); if (c) editor.updateVariable(v.id, { color: c }); else hex.value = v.color.slice(1).toUpperCase(); });
    const count = document.createElement('span');
    count.className = 'uses'; count.textContent = uses ? `${uses}×` : '';
    count.title = t('Used {0} times', uses || 0);
    const del = document.createElement('button');
    del.className = 'icon ghost row-btn'; del.title = t('Delete variable'); del.innerHTML = icon('trash');
    del.addEventListener('click', e => { e.stopPropagation(); editor.deleteVariable(v.id); });
    row.append(sw, name, count, hex, del);
    row.addEventListener('click', () => { if (editor.selection.length) editor.useVariableAsFill(v.id); });
    return row;
  }
  function renderVariables() {
    // Not while a name or code is being typed, or a colour picked (the picker stays next to its swatch).
    if ($('.var-list').contains(document.activeElement) || picking) return;
    const uses = variableUsage(editor.doc);
    const vars = editor.doc.variables.filter(v => matches(v.name));
    $('[data-group=variables] .empty').hidden = vars.length > 0 || !!search.value;
    // Grouped by what comes before the last "/" (Brand/Primary, Brand/Accent → Brand).
    const groups = new Map();
    for (const v of vars) {
      const g = v.name.includes('/') ? v.name.slice(0, v.name.lastIndexOf('/')).trim() : '';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(v);
    }
    const els = [];
    for (const [g, list] of groups) {
      if (g) els.push(Object.assign(document.createElement('h4'), { className: 'var-group', textContent: g }));
      els.push(...list.map(v => variableRow(v, uses.get(v.id))));
    }
    $('.var-list').replaceChildren(...els);
  }
  $('[data-add-var]').addEventListener('click', () => {
    const color = editor.selectedNodes.map(mainColor).find(Boolean) || '#5b8cff';
    const v = editor.addVariable(color, t('Colour {0}', editor.doc.variables.length + 1));
    render();
    const name = root.querySelector(`.var-row[data-id="${v.id}"] .vname`);
    if (name) inlineRename(name, v.name, n => editor.updateVariable(v.id, { name: n.trim() }));
  });

  // ---------- images ----------
  function renderImages() {
    const ids = [...usedAssets(editor.doc)].filter(id => editor.assets.has(id) && matches(editor.assets.get(id).name || ''));
    $('[data-group=images] .count').textContent = ids.length || '';
    $('[data-group=images] .empty').hidden = ids.length > 0 || !!search.value;
    $('.img-grid').replaceChildren(...ids.map(id => {
      const a = editor.assets.get(id);
      const tile = document.createElement('button');
      tile.className = 'img-tile'; tile.title = `${a.name || ''}  ${a.w} × ${a.h}`;
      tile.style.backgroundImage = `url("${assetUrl(a)}")`;
      tile.addEventListener('click', () => onPlaceImage({ id, ...a }));
      drag(tile, { kind: 'image', id });
      return tile;
    }));
  }

  function render() {
    clearTimeout(timer); timer = null;
    if (!visible || !editor.doc) return;
    renderComponents(); renderVariables(); renderImages();
  }
  editor.addEventListener('change', ({ what }) => {
    if (!visible || !editor.doc || !(what.doc || what.page || what.variables || what.file)) return;
    // Soon after, not on every step of a drag.
    clearTimeout(timer);
    timer = setTimeout(render, what.variables ? 0 : 150);
  });

  return {
    show(on) { visible = on; if (on) render(); },
    render
  };
}
