// Left sidebar: the pages of the design and the layer tree of the current page. The top of the list is the top of
// the stack (the last child). Selecting here selects on the canvas and the other way round.
import { childrenOf, isAncestor } from '../core/document.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

export function attachLayers(root, editor) {
  root.innerHTML = `
    <section class="pages">
      <div class="panel-head"><h3>${t('Pages')}</h3><button class="icon ghost" data-add-page title="${t('Add page')}">${icon('plus')}</button></div>
      <ul class="page-list"></ul>
    </section>
    <section class="layers">
      <div class="panel-head"><h3>${t('Layers')}</h3></div>
      <ul class="tree" tabindex="-1"></ul>
      <p class="empty hint" hidden>${t('No layers yet. Pick a tool below or press F, R, O or T.')}</p>
    </section>`;
  const pageList = root.querySelector('.page-list'), tree = root.querySelector('.tree'), empty = root.querySelector('.empty');
  const collapsed = new Set();
  let dragIds = null;

  root.querySelector('[data-add-page]').addEventListener('click', () => editor.addPage(t('Page {0}', editor.doc.pages.length + 1)));

  function renderPages() {
    pageList.replaceChildren(...editor.doc.pages.map(page => {
      const li = document.createElement('li');
      li.className = 'page' + (page.id === editor.pageId ? ' active' : '');
      li.innerHTML = `<span class="name"></span>`;
      li.querySelector('.name').textContent = page.name;
      if (editor.doc.pages.length > 1) {
        const del = document.createElement('button');
        del.className = 'icon ghost row-btn'; del.title = t('Delete page'); del.innerHTML = icon('trash');
        del.addEventListener('click', e => { e.stopPropagation(); editor.deletePage(page.id); });
        li.append(del);
      }
      li.addEventListener('click', () => editor.setPage(page.id));
      li.addEventListener('dblclick', () => inlineRename(li.querySelector('.name'), page.name, name => editor.renamePage(page.id, name)));
      return li;
    }));
  }

  function renderTree() {
    const rows = [];
    const selected = new Set(editor.selection);
    // Opening the tree to the selection.
    for (const id of editor.selection) for (let p = editor.index.get(id)?.parent; p; p = editor.index.get(p.id)?.parent) collapsed.delete(p.id);
    const add = (nodes, depth, hiddenParent, lockedParent) => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        const li = document.createElement('li');
        li.className = 'layer' + (selected.has(n.id) ? ' selected' : '') + (!n.visible || hiddenParent ? ' is-hidden' : '') + (n.locked || lockedParent ? ' is-locked' : '');
        li.dataset.id = n.id;
        li.draggable = true;
        li.style.setProperty('--depth', depth);
        const hasKids = n.children?.length > 0;
        li.innerHTML = `
          <span class="twisty">${hasKids ? icon(collapsed.has(n.id) ? 'chevron-right' : 'chevron-down') : ''}</span>
          <span class="type">${icon(n.type)}</span>
          <span class="name"></span>
          <button class="icon ghost row-btn lock${n.locked ? ' on' : ''}" title="${t(n.locked ? 'Unlock' : 'Lock')}">${icon(n.locked ? 'lock' : 'unlock')}</button>
          <button class="icon ghost row-btn eye${!n.visible ? ' on' : ''}" title="${t(n.visible ? 'Hide' : 'Show')}">${icon(n.visible ? 'eye' : 'eye-off')}</button>`;
        li.querySelector('.name').textContent = n.name;
        rows.push(li);
        if (hasKids && !collapsed.has(n.id)) add(n.children, depth + 1, hiddenParent || !n.visible, lockedParent || n.locked);
      }
    };
    add(editor.page.children, 0, false, false);
    tree.replaceChildren(...rows);
    empty.hidden = rows.length > 0;
    tree.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  }

  tree.addEventListener('click', e => {
    const li = e.target.closest('.layer');
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.closest('.twisty')) { collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); return renderTree(); }
    if (e.target.closest('.eye')) return editor.toggle([id], 'visible');
    if (e.target.closest('.lock')) return editor.toggle([id], 'locked');
    if (e.shiftKey) {
      // Shift selects the range between the last selected row and this one.
      const ids = [...tree.querySelectorAll('.layer')].map(r => r.dataset.id);
      const from = ids.indexOf(editor.selection.at(-1)), to = ids.indexOf(id);
      if (from >= 0) return editor.select(ids.slice(Math.min(from, to), Math.max(from, to) + 1), { add: true });
    }
    editor.select([id], { toggle: e.ctrlKey || e.metaKey });
  });
  tree.addEventListener('dblclick', e => {
    const li = e.target.closest('.layer');
    if (!li || e.target.closest('button, .twisty')) return;
    const node = editor.node(li.dataset.id);
    inlineRename(li.querySelector('.name'), node.name, name => editor.rename(node.id, name));
  });
  tree.addEventListener('mouseover', e => {
    const id = e.target.closest('.layer')?.dataset.id || null;
    if (id !== editor.hoverId) { editor.hoverId = id; editor.emit({ hover: true }); }
  });
  tree.addEventListener('mouseleave', () => { editor.hoverId = null; editor.emit({ hover: true }); });

  // ---------- drag and drop: above / below a row, or into a frame (middle of its row) ----------
  const clearMarks = () => tree.querySelectorAll('.drop-before, .drop-after, .drop-into').forEach(r => r.classList.remove('drop-before', 'drop-after', 'drop-into'));
  function zone(li, e) {
    const b = li.getBoundingClientRect(), y = (e.clientY - b.top) / b.height;
    const node = editor.node(li.dataset.id);
    if (node.type === 'frame' && y > 0.3 && y < 0.7) return 'into';
    return y < 0.5 ? 'before' : 'after';
  }
  tree.addEventListener('dragstart', e => {
    const id = e.target.closest('.layer')?.dataset.id;
    if (!id) return;
    if (!editor.selection.includes(id)) editor.select([id]);
    dragIds = [...editor.selection];
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'layers');
  });
  tree.addEventListener('dragover', e => {
    const li = e.target.closest('.layer');
    if (!dragIds || !li) return;
    const target = li.dataset.id;
    if (dragIds.some(id => id === target || isAncestor(editor.index, id, target))) { clearMarks(); return; }
    e.preventDefault();
    clearMarks();
    li.classList.add(`drop-${zone(li, e)}`);
  });
  tree.addEventListener('dragleave', e => { if (!tree.contains(e.relatedTarget)) clearMarks(); });
  tree.addEventListener('drop', e => {
    const li = e.target.closest('.layer');
    clearMarks();
    if (!dragIds || !li) return;
    e.preventDefault();
    const where = zone(li, e), target = editor.index.get(li.dataset.id);
    if (where === 'into') editor.moveLayers(dragIds, target.node, target.node.children.length);
    else {
      // The list shows the top of the stack first: "before" (above) a row means after it in the children array.
      const list = childrenOf(editor.page, target.parent);
      const at = list.indexOf(target.node) + (where === 'before' ? 1 : 0);
      editor.moveLayers(dragIds, target.parent, at);
    }
    dragIds = null;
  });
  tree.addEventListener('dragend', () => { dragIds = null; clearMarks(); });

  editor.addEventListener('change', ({ what }) => {
    if (!editor.doc) return;
    if (what.page || what.file) renderPages();
    if (what.doc || what.selection || what.page) renderTree();
    if (what.hover) tree.querySelectorAll('.layer').forEach(r => r.classList.toggle('hover', r.dataset.id === editor.hoverId));
  });
}

// Replaces a label with an input until Enter / blur (Escape cancels).
export function inlineRename(label, value, done) {
  const input = document.createElement('input');
  input.className = 'rename'; input.value = value;
  label.replaceWith(input);
  input.focus(); input.select();
  let finished = false;
  const end = save => {
    if (finished) return;
    finished = true;
    input.replaceWith(label);
    if (save && input.value.trim() && input.value !== value) done(input.value);
  };
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') end(true);
    if (e.key === 'Escape') end(false);
  });
  input.addEventListener('blur', () => end(true));
  input.addEventListener('click', e => e.stopPropagation());
  input.addEventListener('dblclick', e => e.stopPropagation());
}
