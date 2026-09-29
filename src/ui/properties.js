// Right panel: the properties of the selection, in collapsible sections. The panel is rebuilt when the selection
// changes and only refreshed (values, not elements) while the layers change, so a field being typed in keeps focus.
import { ownerInstance } from '../core/components.js';
import { absoluteRect, walk } from '../core/document.js';
import { evaluate } from '../core/expr.js';
import { normalizeHex, paintCss, solid, stroke } from '../core/paint.js';
import { inFlow } from '../core/layout.js';
import { assetUrl } from '../render/images.js';
import { closeColorPicker, openColorPicker } from './colorpicker.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { framePresets } from './presets.js';

const typeLabel = { frame: 'Frame', group: 'Group', rect: 'Rectangle', ellipse: 'Ellipse', text: 'Text', vector: 'Vector' };
const weights = [[100, 'Thin'], [200, 'Extra light'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']];
const effectTypes = [['drop-shadow', 'Drop shadow'], ['inner-shadow', 'Inner shadow'], ['layer-blur', 'Layer blur'], ['background-blur', 'Background blur']];
const newEffect = type => type.endsWith('shadow')
  ? { type, x: 0, y: 4, blur: 16, spread: 0, color: '#000000', opacity: type === 'drop-shadow' ? 0.12 : 0.25, visible: true }
  : { type, radius: type === 'layer-blur' ? 4 : 24, visible: true };
const round = v => Math.round(v * 100) / 100;

export function attachProperties(root, editor, { fonts, onExport, onPickImage }) {
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
  const textButton = (name, label, onClick) => {
    const b = document.createElement('button');
    b.className = 'text-btn'; b.innerHTML = `${icon(name)}<span></span>`;
    b.lastChild.textContent = t(label);
    b.addEventListener('click', onClick);
    return b;
  };
  const hint = text => Object.assign(document.createElement('p'), { className: 'hint mixed-hint', textContent: text });

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
  function swatch(getPaint, apply, { gradients = false, opacity = true, variables = true } = {}) {
    const b = document.createElement('button');
    b.className = 'swatch-btn';
    b.innerHTML = '<span></span>';
    let live = false;
    b.addEventListener('click', async () => {
      const paint = getPaint();
      if (!paint) return;
      if (paint.type === 'image') { const asset = await onPickImage?.(); if (asset) { editor.assets.set(asset.id, asset); editor.update(ids(), n => ({ fills: n.fills.map(f => f === paintOf(n, paint) ? { ...f, asset: asset.id } : f) })); } return; }
      const start = () => { if (!live) { live = true; editor.begin(); } };
      openColorPicker(b, {
        paint, gradients, opacity, documentColors: documentColors(),
        variables: variables ? editor.doc.variables : null,
        onCreateVariable: hex => { start(); return editor.addVariableLive(hex, t('Colour {0}', editor.doc.variables.length + 1)); },
        onChange: p => { start(); apply(p); },
        onClose: () => { if (live) { live = false; editor.commit(); editor.emit({ doc: true }); } }
      });
    });
    const refresh = () => {
      const p = getPaint();
      const a = p?.type === 'image' && editor.assets.get(p.asset);
      b.firstChild.style.background = a ? `center / cover no-repeat url("${assetUrl(a)}")` : p ? paintCss(p) : '';
      b.classList.toggle('mixed', !p);
    };
    refreshers.push(refresh);
    return b;
  }

  // The same fill in another layer of the selection (same place in the list).
  const paintOf = (n, p) => n.fills[nodes()[0].fills.indexOf(p)];

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

  // A colour bound to a variable shows the variable's name instead of the hex code; the link button unbinds it.
  function varChip(get, unbind, open) {
    const chip = document.createElement('div');
    chip.className = 'var-chip';
    chip.innerHTML = `${icon('variable')}<span class="var-name"></span>`;
    chip.title = t('Colour variable');
    chip.addEventListener('click', e => { if (!e.target.closest('button')) open(); });
    chip.append(iconButton('unlink', 'Detach variable', unbind));
    refreshers.push(() => {
      const v = get()?.variable && editor.variable(get().variable);
      chip.hidden = !v;
      if (v) chip.querySelector('.var-name').textContent = v.name;
    });
    return chip;
  }
  const bound = p => !!(p?.variable && editor.variable(p.variable));

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
  const withColor = (x, p) => { const y = { ...x, color: p.color, opacity: p.opacity }; if (p.variable) y.variable = p.variable; else delete y.variable; return y; };
  const itemColor = (key, i) => {
    const get = () => nodes()[0]?.[key]?.[i];
    const sw = swatch(() => { const x = get(); return x && { ...solid(x.color, x.opacity), ...(x.variable ? { variable: x.variable } : {}) }; },
      p => editor.setProps(ids(), n => ({ [key]: n[key].map((x, j) => j === i ? withColor(x, p) : x) })));
    const hex = hexField(() => get()?.color, hex => editor.update(ids(), n => ({ [key]: n[key].map((x, j) => j === i ? withColor(x, { color: hex, opacity: x.opacity }) : x) })));
    const chip = varChip(get, () => editor.update(ids(), n => ({ [key]: n[key].map((x, j) => j === i ? withColor(x, { color: x.color, opacity: x.opacity }) : x) })), () => sw.click());
    refreshers.push(() => { hex.hidden = bound(get()); });
    return [sw, hex, chip];
  };
  const listItem = (...rows) => { const d = document.createElement('div'); d.className = 'list-item'; d.append(...rows); return d; };

  const fillsSection = () => {
    const s = fillsList();
    const pick = iconButton('image', 'Add image', async () => { const a = await onPickImage?.(); if (a) editor.setImageFill(a); });
    s.querySelector('.section-head').insertBefore(pick, s.querySelector('.section-head').lastChild);
    return s;
  };
  const fillsList = () => listSection('Fill', 'fills', {
    addLabel: 'Add fill',
    make: list => solid(list.length ? '#000000' : '#d9d9d9', list.length ? 0.2 : 1),
    rowFor: (i, setList) => {
      const get = () => nodes()[0]?.fills?.[i];
      const sw = swatch(get, p => editor.setProps(ids(), n => ({ fills: n.fills.map((x, j) => j === i ? p : x) })), { gradients: true });
      const label = document.createElement('span');
      label.className = 'paint-label';
      const hex = hexField(() => get()?.color, hex => setList(list => { list[i].color = hex; delete list[i].variable; return list; }));
      const chip = varChip(get, () => setList(list => { delete list[i].variable; return list; }), () => sw.click());
      const fit = document.createElement('select');
      for (const [v, l] of [['fill', 'Fill'], ['fit', 'Fit'], ['stretch', 'Stretch'], ['tile', 'Tile']]) fit.add(new Option(t(l), v));
      fit.addEventListener('change', () => setList(list => { list[i].fit = fit.value; return list; }));
      fit.addEventListener('keydown', e => e.stopPropagation());
      refreshers.push(() => {
        const p = get(); if (!p) return;
        hex.hidden = p.type !== 'solid' || bound(p); fit.hidden = p.type !== 'image'; label.hidden = p.type === 'solid' || p.type === 'image';
        if (p.type === 'image') fit.value = p.fit;
        label.textContent = t(p.type === 'linear' ? 'Linear' : 'Radial');
      });
      label.addEventListener('click', () => sw.click());
      const op = itemNumber('fills', i, 'opacity', '', { min: 0, max: 1, scale: 100, suffix: '%' });
      op.classList.add('narrow');
      return listItem(row(sw, hex, chip, label, fit, op, ...rowTail('fills', i, setList)));
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

  // ---------- auto layout, sizing, constraints ----------
  function layoutSection() {
    const frames = nodes();
    const has = frames.every(n => n.layout);
    if (frames.some(n => n.instanceOf) && !has) return null;
    const action = frames.some(n => n.instanceOf) ? null : has
      ? iconButton('minus', 'Remove auto layout', () => editor.removeAutoLayout())
      : iconButton('plus', 'Add auto layout', () => editor.addAutoLayout());
    if (!has) return section('Auto layout', frames.some(n => n.layout) ? Object.assign(document.createElement('p'), { className: 'hint mixed-hint', textContent: t('Mixed') }) : null, action);
    const lnum = (label, title, get, set, opts = {}) => number({ label, title, min: 0, ...opts, get: n => get(n.layout), set: (n, v) => ({ layout: { ...n.layout, ...set(n.layout, v) } }) });
    const dir = segmented([
      { value: 'row', icon: 'dir-row', title: 'Horizontal' }, { value: 'column', icon: 'dir-column', title: 'Vertical' }
    ], n => n.layout.mode, (n, v) => ({ layout: { ...n.layout, mode: v } }));
    const gap = lnum('⇹', 'Gap between layers', l => l.gap, (l, v) => ({ gap: v }), { min: -10000 });
    const padH = lnum('↔', 'Padding left and right', l => l.padding.l === l.padding.r ? l.padding.l : NaN, (l, v) => ({ padding: { ...l.padding, l: v, r: v } }));
    const padV = lnum('↕', 'Padding top and bottom', l => l.padding.t === l.padding.b ? l.padding.t : NaN, (l, v) => ({ padding: { ...l.padding, t: v, b: v } }));
    // Nine dots: where the content sits in the frame (along and across the direction).
    const grid = document.createElement('div');
    grid.className = 'align-grid';
    grid.title = t('Alignment');
    const order = ['start', 'center', 'end'];
    const cells = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      const c = document.createElement('button');
      c.className = 'cell';
      c.addEventListener('click', () => editor.setLayout(l => {
        const [main, cross] = l.mode === 'row' ? [order[x], order[y]] : [order[y], order[x]];
        return { justify: l.justify === 'space-between' ? 'space-between' : main, align: cross };
      }));
      cells.push({ c, x, y });
      grid.append(c);
    }
    refreshers.push(() => {
      const l = nodes()[0]?.layout; if (!l) return;
      const main = order.indexOf(l.justify), cross = order.indexOf(l.align);
      for (const { c, x, y } of cells) {
        const [mx, cy] = l.mode === 'row' ? [x, y] : [y, x];
        c.classList.toggle('on', (l.justify === 'space-between' || mx === main) && cy === cross);
      }
    });
    const between = checkbox('Space between', n => n.layout.justify === 'space-between', (n, v) => ({ layout: { ...n.layout, justify: v ? 'space-between' : 'start' } }));
    return section('Auto layout', [row(dir, gap), row(padH, padV), row(grid, between)], action);
  }

  // Fixed / Hug / Fill for width and height, where they make sense.
  function sizingRow() {
    const sel = nodes();
    const parents = sel.map(n => editor.index.get(n.id)?.parent);
    const canFill = sel.every((n, i) => inFlow(n, parents[i]));
    const canHug = sel.every(n => n.layout);
    if (!canFill && !canHug) return null;
    const opts = [['fixed', t('Fixed')], ...(canHug ? [['hug', t('Hug')]] : []), ...(canFill ? [['fill', t('Fill')]] : [])];
    const pick = (axis, label) => {
      const key = axis === 'w' ? 'widthMode' : 'heightMode';
      const el = select(opts, n => n[key], (n, v) => ({ [key]: v, ...(n.type === 'text' && axis === 'w' && v !== 'fixed' && n.sizing === 'auto-width' ? { sizing: 'auto-height' } : {}) }));
      const wrap = document.createElement('label');
      wrap.className = 'mode-pick';
      wrap.append(Object.assign(document.createElement('span'), { className: 'lbl', textContent: label }), el);
      return wrap;
    };
    return row(pick('w', 'W'), pick('h', 'H'));
  }

  function constraintsSection() {
    const sel = nodes();
    const ok = sel.every(n => { const p = editor.index.get(n.id)?.parent; return p?.type === 'frame' && !inFlow(n, p); });
    if (!ok) return null;
    const h = select([['left', t('Left')], ['right', t('Right')], ['stretch', t('Left and right')], ['center', t('Center')], ['scale', t('Scale')]],
      n => n.constraints.h, (n, v) => ({ constraints: { ...n.constraints, h: v } }));
    const v = select([['top', t('Top')], ['bottom', t('Bottom')], ['stretch', t('Top and bottom')], ['center', t('Center')], ['scale', t('Scale')]],
      n => n.constraints.v, (n, x) => ({ constraints: { ...n.constraints, v: x } }));
    return section('Constraints', [row(Object.assign(document.createElement('span'), { className: 'muted cap', textContent: '↔' }), h),
      row(Object.assign(document.createElement('span'), { className: 'muted cap', textContent: '↕' }), v)]);
  }

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

  // ---------- components and instances ----------
  function componentSection(n) {
    const count = hint('');
    refreshers.push(() => { const k = editor.instancesOf(n.id).length; count.textContent = t(k === 1 ? '{0} instance on this page' : '{0} instances on this page', k); });
    const add = textButton('instance', 'Create instance', () => {
      const r = absoluteRect(editor.index, n.id);
      editor.createInstance(n.id, { x: r.x + r.w + 40, y: r.y }, { center: false });
    });
    const pick = textButton('component', 'Select instances', () => editor.select(editor.instancesOf(n.id)));
    refreshers.push(() => { pick.disabled = !editor.instancesOf(n.id).length; });
    return section('Component', [row(add, pick), count]);
  }

  function instanceSection(n) {
    const owner = ownerInstance(editor.index, n.id);
    const reset = textButton('reset', 'Reset', () => editor.resetOverrides([n.id]));
    reset.title = t('Reset changes');
    refreshers.push(() => {
      const k = editor.overridesOf(n.id).length;
      reset.disabled = !k;
      reset.lastChild.textContent = k ? `${t('Reset')} (${k})` : t('No changes');
    });
    if (owner) {
      // A layer inside an instance (or an instance nested in one).
      return section('Instance', [hint(t('Part of instance “{0}”. Position and size come from the main component.', owner.name)),
        row(reset, iconButton('go-to', 'Go to main component', () => editor.goToComponent(n.id)))]);
    }
    const comps = editor.components();
    const swap = document.createElement('select');
    for (const c of comps) swap.add(new Option(c.node.name, c.node.id));
    const missing = !comps.some(c => c.node.id === n.instanceOf);
    if (missing) swap.add(new Option(t('Main component is missing'), n.instanceOf));
    swap.value = n.instanceOf;
    swap.title = t('Swap for another component');
    swap.addEventListener('change', () => editor.swapInstance(n.id, swap.value));
    swap.addEventListener('keydown', e => e.stopPropagation());
    const go = iconButton('go-to', 'Go to main component', () => editor.goToComponent(n.id));
    go.disabled = missing;
    const detach = textButton('detach', 'Detach', () => editor.detachInstances());
    detach.title = t('Detach instance') + '  (Ctrl+Alt+B)';
    const kind = document.createElement('span');
    kind.className = 'cap kind-icon'; kind.innerHTML = icon('instance');
    return section('Instance', [row(kind, swap, go), row(detach, reset)]);
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
      const sw = swatch(() => solid(bg()), p => { page.background = p.color; editor.emit({ doc: true }); }, { opacity: false, variables: false });
      const hex = hexField(bg, v => editor.transact(() => { page.background = v; }));
      parts.push(section('Page', row(sw, hex, Object.assign(document.createElement('span'), { className: 'muted', textContent: t('Background') }))));
    } else {
      const types = new Set(sel.map(n => n.type));
      const only = type => types.size === 1 && types.has(type);
      const one = sel.length === 1 ? sel[0] : null;
      const inInstance = sel.some(n => ownerInstance(editor.index, n.id));
      const head = document.createElement('div');
      head.className = 'prop-title' + (one?.component || one?.instanceOf || inInstance ? ' kind-component' : '');
      const kind = one ? (one.component ? 'component' : one.instanceOf ? 'instance' : one.layout ? 'auto-layout' : one.type) : 'group';
      head.innerHTML = icon(kind);
      head.append(one ? t(one.component ? 'Component' : one.instanceOf ? 'Instance' : one.layout ? 'Auto layout' : typeLabel[one.type]) : t('{0} layers', sel.length));
      parts.push(head);
      const bar = inInstance ? null : alignSection();
      if (bar) parts.push(bar);
      if (one?.component) parts.push(componentSection(one));
      if (one && (one.instanceOf || inInstance)) parts.push(instanceSection(one));

      if (only('frame') && inInstance) parts.push(section('Frame', row(checkbox('Clip content', n => n.clip, (n, v) => ({ clip: v })))));
      else if (only('frame')) {
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

      if (!inInstance) parts.push(section('Position', [
        row(number({ label: 'X', get: n => n.x, set: (n, v) => ({ x: v }) }), number({ label: 'Y', get: n => n.y, set: (n, v) => ({ y: v }) })),
        types.has('group') ? null : row(
          number({ label: 'W', min: 1, get: n => n.w, set: (n, v) => ({ w: v, widthMode: 'fixed', ...(n.type === 'text' && n.sizing === 'auto-width' ? { sizing: 'auto-height' } : {}) }) }),
          number({ label: 'H', min: 1, get: n => n.h, set: (n, v) => ({ h: v, heightMode: 'fixed', ...(n.type === 'text' ? { sizing: 'fixed' } : {}) }) })
        ),
        types.has('group') ? null : sizingRow(),
        sel.every(n => editor.index.get(n.id)?.parent?.layout)
          ? row(checkbox('Ignore auto layout', n => !!n.absolute, (n, v) => ({ absolute: v }))) : null
      ]));
      const lay = only('frame') && !inInstance ? layoutSection() : null;
      if (lay) parts.push(lay);
      const cons = inInstance ? null : constraintsSection();
      if (cons) parts.push(cons);

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
          ], n => n.align, (n, v) => ({ align: v })), inInstance ? null : segmented([
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
    // Rebuilt when what the panel shows changes: other layers, or auto layout switched on or off (here or around).
    const shape = n => `${n.type}${n.layout ? ':L' : ''}${editor.index.get(n.id)?.parent?.layout ? ':P' : ''}${n.component ? ':C' : ''}${n.instanceOf ? `:I${n.instanceOf}` : ''}`;
    const sig = `${editor.pageId}|${editor.tool}|${editor.selection.join(',')}|${editor.selectedNodes.map(shape).join(',')}`;
    if (sig !== signature || what.page) { signature = sig; build(); }
    else if (what.doc) refresh();
  });
}

