// Right panel: the properties of the selection, in collapsible sections. The panel is rebuilt when the selection
// changes and only refreshed (values, not elements) while the layers change, so a field being typed in keeps focus.
import { walk } from '../core/document.js';
import { evaluate } from '../core/expr.js';
import { normalizeHex, paintCss, solid, stroke } from '../core/paint.js';
import { closeColorPicker, openColorPicker } from './colorpicker.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { framePresets } from './presets.js';

const typeLabel = { frame: 'Frame', group: 'Group', rect: 'Rectangle', ellipse: 'Ellipse', text: 'Text' };
const weights = [[100, 'Thin'], [200, 'Extra light'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']];
const effectTypes = [['drop-shadow', 'Drop shadow'], ['inner-shadow', 'Inner shadow'], ['layer-blur', 'Layer blur'], ['background-blur', 'Background blur']];
const newEffect = type => type.endsWith('shadow')
  ? { type, x: 0, y: 4, blur: 16, spread: 0, color: '#000000', opacity: type === 'drop-shadow' ? 0.12 : 0.25, visible: true }
  : { type, radius: type === 'layer-blur' ? 4 : 24, visible: true };
const round = v => Math.round(v * 100) / 100;

export function attachProperties(root, editor, { fonts, onExport }) {
  const collapsed = new Set();
  let refreshers = [];
  let signature = '';

  const ids = () => editor.selection;
  const nodes = () => editor.selectedNodes;

  // ---------- building blocks ----------
  function section(title, content, action) {
    const el = document.createElement('section');
    el.className = 'prop-section' + (collapsed.has(title) ? ' collapsed' : '');
    const head = document.createElement('div');
    head.className = 'section-head';
    head.innerHTML = `<button class="ghost toggle">${icon('chevron-down')}<span>${t(title)}</span></button>`;
    head.querySelector('.toggle').addEventListener('click', () => { el.classList.toggle('collapsed'); collapsed[el.classList.contains('collapsed') ? 'add' : 'delete'](title); });
    if (action) head.append(action);
    const body = document.createElement('div');
    body.className = 'section-body';
    body.append(...[content].flat().filter(Boolean));
    el.append(head, body);
    return el;
  }
  const row = (...els) => { const d = document.createElement('div'); d.className = 'prop-row'; d.append(...els.filter(Boolean)); return d; };
  const iconButton = (name, title, onClick, cls = '') => {
    const b = document.createElement('button');
    b.className = `icon ghost ${cls}`; b.title = t(title); b.innerHTML = icon(name);
    b.addEventListener('click', onClick);
    return b;
  };

  // One value over the whole selection: the value, or null when the layers differ ("Mixed").
  const common = get => {
    const values = nodes().map(get);
    return values.length && values.every(v => v === values[0]) ? values[0] : null;
  };
  const same = get => { const v = nodes().map(n => JSON.stringify(get(n))); return v.every(x => x === v[0]); };

  // A number: typed (with sums), or scrubbed by dragging the label. get/set work on one node; scale shows e.g. %.
  function number({ label, title, get, set, min = -Infinity, max = Infinity, scale = 1, step = 1, suffix = '' }) {
    const wrap = document.createElement('label');
    wrap.className = 'num';
    wrap.title = t('Type a sum: 200 + 32, or /2 on the current value. Drag the label to change it.');
    wrap.innerHTML = `<span class="lbl"></span><input type="text" inputmode="decimal"><span class="suffix"></span>`;
    wrap.querySelector('.lbl').textContent = label;
    if (title) wrap.querySelector('.lbl').title = t(title);
    wrap.querySelector('.suffix').textContent = suffix;
    const input = wrap.querySelector('input');
    const clamp = v => Math.min(max, Math.max(min, v));
    const refresh = () => {
      if (document.activeElement === input || !nodes().length) return;
      const v = common(get);
      input.value = v === null ? '' : String(round(v * scale));
      input.placeholder = v === null ? t('Mixed') : '';
    };
    const apply = () => {
      const text = input.value;
      if (!text.trim()) return refresh();
      editor.update(ids(), node => {
        const v = evaluate(text, get(node) * scale);
        return v === null ? null : set(node, clamp(v / scale));
      });
      refresh();
    };
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { apply(); input.select(); }
      if (e.key === 'Escape') { input.blur(); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1) * step;
        editor.update(ids(), node => set(node, clamp(round(get(node) + d / scale))));
        input.value = String(round(common(get) * scale)); input.select();
      }
    });
    input.addEventListener('change', apply);
    input.addEventListener('focus', () => input.select());
    // Scrubbing: drag the label left/right.
    const lbl = wrap.querySelector('.lbl');
    lbl.addEventListener('pointerdown', e => {
      e.preventDefault();
      lbl.setPointerCapture(e.pointerId);
      const x0 = e.clientX, starts = new Map(nodes().map(n => [n.id, get(n)]));
      editor.begin();
      const move = ev => {
        const d = Math.round((ev.clientX - x0) / 2) * step * (ev.shiftKey ? 10 : 1);
        editor.setProps(ids(), node => set(node, clamp(round(starts.get(node.id) + d / scale))));
        refresh();
      };
      const up = () => { lbl.removeEventListener('pointermove', move); lbl.removeEventListener('pointerup', up); editor.commit(); editor.emit({ doc: true }); };
      lbl.addEventListener('pointermove', move);
      lbl.addEventListener('pointerup', up);
    });
    refreshers.push(refresh);
    return wrap;
  }

  // Solid colours used in the document, offered in the picker (until colour variables exist).
  function documentColors() {
    const seen = new Set();
    for (const page of editor.doc.pages) walk(page.children, n => {
      for (const p of n.fills || []) if (p.type === 'solid') seen.add(p.color);
      for (const s of n.strokes || []) seen.add(s.color);
    });
    return [...seen];
  }

  // A swatch that opens the colour picker; changes are live and form one undo step.
  // getPaint() → paint; apply(paint) changes the layers (without an undo step).
  function swatch(getPaint, apply, { gradients = false, opacity = true } = {}) {
    const b = document.createElement('button');
    b.className = 'swatch-btn';
    b.innerHTML = '<span></span>';
    let live = false;
    b.addEventListener('click', () => {
      const paint = getPaint();
      if (!paint) return;
      openColorPicker(b, {
        paint, gradients, opacity, documentColors: documentColors(),
        onChange: p => { if (!live) { live = true; editor.begin(); } apply(p); },
        onClose: () => { if (live) { live = false; editor.commit(); editor.emit({ doc: true }); } }
      });
    });
    const refresh = () => { const p = getPaint(); b.firstChild.style.background = p ? paintCss(p) : ''; b.classList.toggle('mixed', !p); };
    refreshers.push(refresh);
    return b;
  }

  // A hex field for a solid colour; set(hex) makes it one undo step.
  function hexField(get, set) {
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'hex'; input.spellcheck = false;
    const refresh = () => { if (document.activeElement !== input) { const v = get(); input.value = v ? v.slice(1).toUpperCase() : ''; } };
    const apply = () => { const hex = normalizeHex(input.value); if (hex) set(hex); refresh(); };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { apply(); input.select(); } if (e.key === 'Escape') input.blur(); });
    input.addEventListener('change', apply);
    input.addEventListener('focus', () => input.select());
    refreshers.push(refresh);
    return input;
  }

  function segmented(options, get, set) {
    const wrap = document.createElement('div');
    wrap.className = 'segmented';
    const buttons = options.map(o => {
      const b = document.createElement('button');
      b.className = 'icon'; b.title = t(o.title); b.innerHTML = icon(o.icon);
      b.addEventListener('click', () => { editor.update(ids(), node => set(node, o.value)); refresh(); });
      wrap.append(b);
      return b;
    });
    const refresh = () => { const v = common(get); buttons.forEach((b, i) => b.classList.toggle('on', options[i].value === v)); };
    refreshers.push(refresh);
    return wrap;
  }

  function checkbox(label, get, set) {
    const wrap = document.createElement('label');
    wrap.className = 'check';
    wrap.innerHTML = `<input type="checkbox"><span></span>`;
    wrap.querySelector('span').textContent = t(label);
    const input = wrap.querySelector('input');
    input.addEventListener('change', () => editor.update(ids(), node => set(node, input.checked)));
    const refresh = () => { const v = common(get); input.checked = v === true; input.indeterminate = v === null; };
    refreshers.push(refresh);
    return wrap;
  }

  function select(options, get, set) {
    const el = document.createElement('select');
    for (const [value, label] of options) el.add(new Option(label, value));
    el.addEventListener('change', () => editor.update(ids(), node => set(node, el.value)));
    el.addEventListener('keydown', e => e.stopPropagation());
    const refresh = () => { const v = common(get); el.value = v === null ? '' : String(v); if (v === null) el.selectedIndex = -1; };
    refreshers.push(refresh);
    return el;
  }

  function fontInput() {
    const wrap = document.createElement('div');
    wrap.className = 'font-field';
    wrap.innerHTML = `<input type="text" list="font-list" spellcheck="false">`;
    const input = wrap.querySelector('input');
    const apply = () => { const v = input.value.trim(); if (v) editor.update(ids(), { fontFamily: v }); };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') apply(); });
    input.addEventListener('change', apply);
    input.addEventListener('focus', () => { fonts.load(); input.select(); });
    const refresh = () => { if (document.activeElement !== input) { const v = common(n => n.fontFamily); input.value = v ?? ''; input.placeholder = v === null ? t('Mixed') : ''; } };
    refreshers.push(refresh);
    return wrap;
  }

  // ---------- lists: fills, strokes, effects, exports ----------
  // The rows are rebuilt when the list changes shape (added, removed, type changed) and refreshed otherwise.
  // Layers with different lists show "Mixed"; + then replaces them all with one new item.
  function listSection(title, key, { make, rowFor, addLabel = 'Add', stacked = true }) {
    const body = document.createElement('div');
    body.className = 'list';
    let shape = null, localRefreshers = [];
    const setList = (fn, undoStep = true) => {
      const change = n => ({ [key]: fn(structuredClone(n[key])) });
      if (undoStep) editor.update(ids(), change); else editor.setProps(ids(), change);
    };
    const add = iconButton('plus', addLabel, () => {
      const list = same(n => n[key]) ? nodes()[0][key] : [];
      editor.update(ids(), () => ({ [key]: [...structuredClone(list), make(list)] }));
    });
    const refresh = () => {
      if (!nodes().length) return;
      const mixed = !same(n => n[key]);
      const list = mixed ? null : nodes()[0][key];
      const nextShape = mixed ? 'mixed' : list.map(i => i.type || i.align || i.format || '').join('|') + `#${list.length}`;
      if (nextShape !== shape && !body.contains(document.activeElement)) {
        shape = nextShape;
        const before = refreshers;
        refreshers = [];
        body.replaceChildren(...(mixed
          ? [Object.assign(document.createElement('p'), { className: 'hint mixed-hint', textContent: t('Mixed. Click + to replace.') })]
          // Fills, strokes and effects are listed top of the stack first; exports in their own order.
          : (stacked ? [...list.keys()].reverse() : [...list.keys()]).map(i => rowFor(i, setList))));
        localRefreshers = refreshers;
        refreshers = before;
      }
      localRefreshers.forEach(r => r());
    };
    refreshers.push(refresh);
    return section(title, body, add);
  }

  // Eye and minus at the end of each list row.
  const rowTail = (key, i, setList) => {
    const eye = iconButton('eye', 'Hide', () => setList(list => { list[i].visible = !list[i].visible; return list; }), 'row-eye');
    refreshers.push(() => {
      const item = nodes()[0]?.[key]?.[i];
      if (!item) return;
      eye.innerHTML = icon(item.visible === false ? 'eye-off' : 'eye');
      eye.title = t(item.visible === false ? 'Show' : 'Hide');
      eye.closest('.list-item')?.classList.toggle('off', item.visible === false);
    });
    const del = iconButton('minus', 'Remove', () => setList(list => { list.splice(i, 1); return list; }));
    return [eye, del];
  };
  // A number inside list item i of `key`.
  const itemNumber = (key, i, prop, label, opts = {}) => number({
    label, title: opts.title, min: opts.min, max: opts.max, scale: opts.scale, suffix: opts.suffix, step: opts.step,
    get: n => n[key][i][prop], set: (n, v) => ({ [key]: n[key].map((x, j) => j === i ? { ...x, [prop]: v } : x) })
  });
  const itemColor = (key, i) => {
    const get = () => nodes()[0]?.[key]?.[i];
    const sw = swatch(() => { const x = get(); return x && solid(x.color, x.opacity); },
      p => editor.setProps(ids(), n => ({ [key]: n[key].map((x, j) => j === i ? { ...x, color: p.color, opacity: p.opacity } : x) })));
    const hex = hexField(() => get()?.color, hex => editor.update(ids(), n => ({ [key]: n[key].map((x, j) => j === i ? { ...x, color: hex } : x) })));
    return [sw, hex];
  };
  const listItem = (...rows) => { const d = document.createElement('div'); d.className = 'list-item'; d.append(...rows); return d; };

  const fillsSection = () => listSection('Fill', 'fills', {
    addLabel: 'Add fill',
    make: list => solid(list.length ? '#000000' : '#d9d9d9', list.length ? 0.2 : 1),
    rowFor: (i, setList) => {
      const get = () => nodes()[0]?.fills?.[i];
      const sw = swatch(get, p => editor.setProps(ids(), n => ({ fills: n.fills.map((x, j) => j === i ? p : x) })), { gradients: true });
      const label = document.createElement('span');
      label.className = 'paint-label';
      const hex = hexField(() => get()?.color, hex => setList(list => { list[i].color = hex; return list; }));
      refreshers.push(() => {
        const p = get(); if (!p) return;
        const isSolid = p.type === 'solid';
        hex.hidden = !isSolid; label.hidden = isSolid;
        label.textContent = t(p.type === 'linear' ? 'Linear' : 'Radial');
      });
      label.addEventListener('click', () => sw.click());
      const op = itemNumber('fills', i, 'opacity', '', { min: 0, max: 1, scale: 100, suffix: '%' });
      op.classList.add('narrow');
      return listItem(row(sw, hex, label, op, ...rowTail('fills', i, setList)));
    }
  });

  const strokesSection = () => listSection('Stroke', 'strokes', {
    addLabel: 'Add stroke',
    make: () => stroke('#000000', 1),
    rowFor: (i, setList) => {
      const op = itemNumber('strokes', i, 'opacity', '', { min: 0, max: 1, scale: 100, suffix: '%' });
      op.classList.add('narrow');
      const alignSel = document.createElement('select');
      for (const [v, l] of [['inside', 'Inside'], ['center', 'Center'], ['outside', 'Outside']]) alignSel.add(new Option(t(l), v));
      alignSel.addEventListener('change', () => setList(list => { list[i].align = alignSel.value; return list; }));
      alignSel.addEventListener('keydown', e => e.stopPropagation());
      refreshers.push(() => { const s = nodes()[0]?.strokes?.[i]; if (s) alignSel.value = s.align; });
      return listItem(
        row(...itemColor('strokes', i), op, ...rowTail('strokes', i, setList)),
        row(itemNumber('strokes', i, 'width', '≡', { title: 'Stroke width', min: 0 }), alignSel)
      );
    }
  });

  const effectsSection = () => listSection('Effects', 'effects', {
    addLabel: 'Add effect',
    make: () => newEffect('drop-shadow'),
    rowFor: (i, setList) => {
      const typeSel = document.createElement('select');
      for (const [v, l] of effectTypes) typeSel.add(new Option(t(l), v));
      typeSel.addEventListener('change', () => setList(list => { list[i] = { ...newEffect(typeSel.value), visible: list[i].visible }; return list; }));
      typeSel.addEventListener('keydown', e => e.stopPropagation());
      const e = nodes()[0].effects[i];
      typeSel.value = e.type;
      const rows = [row(typeSel, ...rowTail('effects', i, setList))];
      if (e.type.endsWith('shadow')) {
        rows.push(row(itemNumber('effects', i, 'x', 'X'), itemNumber('effects', i, 'y', 'Y')));
        rows.push(row(itemNumber('effects', i, 'blur', 'B', { title: 'Blur', min: 0 }), itemNumber('effects', i, 'spread', 'S', { title: 'Spread' })));
        const op = itemNumber('effects', i, 'opacity', '', { min: 0, max: 1, scale: 100, suffix: '%' });
        op.classList.add('narrow');
        rows.push(row(...itemColor('effects', i), op));
      } else rows.push(row(itemNumber('effects', i, 'radius', 'B', { title: 'Blur', min: 0 })));
      return listItem(...rows);
    }
  });

  const exportSection = () => {
    const button = document.createElement('button');
    button.className = 'export-btn';
    button.addEventListener('click', () => onExport(nodes()));
    refreshers.push(() => {
      const sel = nodes();
      const any = sel.some(n => n.exports.length);
      button.hidden = !any;
      button.textContent = sel.length === 1 ? t('Export {0}', sel[0].name) : t('Export {0} layers', sel.length);
    });
    const s = listSection('Export', 'exports', {
      addLabel: 'Add export', stacked: false,
      make: list => ({ format: 'png', scale: list.length ? Math.min(4, (list.at(-1).scale || 1) + 1) : 1 }),
      rowFor: (i, setList) => {
        const scale = document.createElement('select');
        for (const v of [0.5, 1, 1.5, 2, 3, 4]) scale.add(new Option(`${v}×`, v));
        const format = document.createElement('select');
        for (const v of ['png', 'jpg', 'webp', 'svg']) format.add(new Option(v.toUpperCase(), v));
        scale.addEventListener('change', () => setList(list => { list[i].scale = Number(scale.value); return list; }));
        format.addEventListener('change', () => setList(list => { list[i].format = format.value; return list; }));
        for (const el of [scale, format]) el.addEventListener('keydown', e => e.stopPropagation());
        refreshers.push(() => {
          const x = nodes()[0]?.exports?.[i]; if (!x) return;
          scale.value = String(x.scale); format.value = x.format; scale.disabled = x.format === 'svg';
        });
        return listItem(row(scale, format, iconButton('minus', 'Remove', () => setList(list => { list.splice(i, 1); return list; }))));
      }
    });
    s.querySelector('.section-body').append(button);
    return s;
  };

  function alignSection() {
    const n = nodes().length;
    const single = n === 1 && editor.index.get(ids()[0])?.parent;
    if (n < 2 && !single) return null;
    const b = (name, title, fn, enabled = true) => { const x = iconButton(name, title, fn); x.disabled = !enabled; return x; };
    const bar = document.createElement('div');
    bar.className = 'align-bar';
    bar.append(
      b('al-left', 'Align left', () => editor.align('left')), b('al-hcenter', 'Align horizontal centers', () => editor.align('center')),
      b('al-right', 'Align right', () => editor.align('right')), b('al-top', 'Align top', () => editor.align('top')),
      b('al-vcenter', 'Align vertical centers', () => editor.align('middle')), b('al-bottom', 'Align bottom', () => editor.align('bottom')),
      b('dist-h', 'Distribute horizontally', () => editor.distribute('x'), n >= 3), b('dist-v', 'Distribute vertically', () => editor.distribute('y'), n >= 3),
      b('tidy', 'Tidy up', () => editor.tidyUp(), n >= 2)
    );
    return bar;
  }

  // ---------- the panel per selection ----------
  function presetList(onPick) {
    const wrap = document.createElement('div');
    wrap.className = 'preset-list';
    for (const g of framePresets) {
      const h = document.createElement('h4'); h.textContent = t(g.group); wrap.append(h);
      for (const p of g.items) {
        const b = document.createElement('button');
        b.className = 'preset';
        b.innerHTML = `<span></span><span class="muted">${p.w} × ${p.h}</span>`;
        b.firstElementChild.textContent = p.name;
        b.addEventListener('click', () => onPick(p));
        wrap.append(b);
      }
    }
    return wrap;
  }

  function build() {
    closeColorPicker();
    refreshers = [];
    const sel = nodes();
    const parts = [];
    if (!sel.length) {
      if (editor.tool === 'frame') parts.push(section('Frame presets', presetList(p => editor.addFramePreset(p))));
      const page = editor.page;
      const bg = () => page.background || '#1e1f23';
      const sw = swatch(() => solid(bg()), p => { page.background = p.color; editor.emit({ doc: true }); }, { opacity: false });
      const hex = hexField(bg, v => editor.transact(() => { page.background = v; }));
      parts.push(section('Page', row(sw, hex, Object.assign(document.createElement('span'), { className: 'muted', textContent: t('Background') }))));
    } else {
      const types = new Set(sel.map(n => n.type));
      const only = type => types.size === 1 && types.has(type);
      const head = document.createElement('div');
      head.className = 'prop-title';
      head.textContent = sel.length === 1 ? t(typeLabel[sel[0].type]) : t('{0} layers', sel.length);
      parts.push(head);
      const bar = alignSection();
      if (bar) parts.push(bar);

      if (only('frame')) {
        const presetSelect = document.createElement('select');
        presetSelect.add(new Option(t('Choose…'), ''));
        for (const g of framePresets) {
          const og = document.createElement('optgroup'); og.label = t(g.group);
          for (const p of g.items) og.append(new Option(`${p.name}  ${p.w} × ${p.h}`, `${p.w}x${p.h}`));
          presetSelect.append(og);
        }
        presetSelect.addEventListener('change', () => {
          const [w, h] = presetSelect.value.split('x').map(Number);
          if (w) editor.update(ids(), { w, h });
          presetSelect.value = '';
        });
        presetSelect.addEventListener('keydown', e => e.stopPropagation());
        parts.push(section('Frame', [row(presetSelect), row(checkbox('Clip content', n => n.clip, (n, v) => ({ clip: v })))]));
      }

      parts.push(section('Position', [
        row(number({ label: 'X', get: n => n.x, set: (n, v) => ({ x: v }) }), number({ label: 'Y', get: n => n.y, set: (n, v) => ({ y: v }) })),
        types.has('group') ? null : row(
          number({ label: 'W', min: 1, get: n => n.w, set: (n, v) => ({ w: v, ...(n.type === 'text' && n.sizing === 'auto-width' ? { sizing: 'auto-height' } : {}) }) }),
          number({ label: 'H', min: 1, get: n => n.h, set: (n, v) => ({ h: v, ...(n.type === 'text' ? { sizing: 'fixed' } : {}) }) })
        )
      ]));

      const radius = [...types].every(x => x === 'rect' || x === 'frame');
      parts.push(section('Appearance', row(
        number({ label: '◐', title: 'Opacity', get: n => n.opacity, set: (n, v) => ({ opacity: v }), min: 0, max: 1, scale: 100, suffix: '%' }),
        radius ? number({ label: '◜', title: 'Corner radius', get: n => n.radius, set: (n, v) => ({ radius: v }), min: 0 }) : null
      )));

      if (only('text')) {
        parts.push(section('Typography', [
          row(fontInput()),
          row(select(weights.map(([v, l]) => [v, t(l)]), n => String(n.fontWeight), (n, v) => ({ fontWeight: Number(v) })),
            number({ label: 'Aa', title: 'Size', get: n => n.fontSize, set: (n, v) => ({ fontSize: v }), min: 1 })),
          row(number({ label: '↕', title: 'Line height', get: n => n.lineHeight, set: (n, v) => ({ lineHeight: v }), min: 0.1, scale: 100, suffix: '%' }),
            number({ label: '↔', title: 'Letter spacing', get: n => n.letterSpacing, set: (n, v) => ({ letterSpacing: v }), step: 0.1 })),
          row(segmented([
            { value: 'left', icon: 'align-left', title: 'Align left' }, { value: 'center', icon: 'align-center', title: 'Align center' },
            { value: 'right', icon: 'align-right', title: 'Align right' }
          ], n => n.align, (n, v) => ({ align: v })), segmented([
            { value: 'auto-width', icon: 'auto-width', title: 'Auto width' }, { value: 'auto-height', icon: 'auto-height', title: 'Auto height' },
            { value: 'fixed', icon: 'fixed', title: 'Fixed size' }
          ], n => n.sizing, (n, v) => ({ sizing: v })))
        ]));
      }
      if (!types.has('group')) { parts.push(fillsSection()); parts.push(strokesSection()); }
      parts.push(effectsSection());
      parts.push(exportSection());
    }
    root.replaceChildren(...parts);
    refresh();
  }
  const refresh = () => refreshers.forEach(r => r());

  editor.addEventListener('change', ({ what }) => {
    if (!editor.doc) return;
    const sig = `${editor.pageId}|${editor.tool}|${editor.selection.join(',')}|${editor.selectedNodes.map(n => n.type).join(',')}`;
    if (sig !== signature || what.page) { signature = sig; build(); }
    else if (what.doc) refresh();
  });
}

