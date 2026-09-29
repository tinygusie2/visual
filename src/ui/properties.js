// Right panel: the properties of the selection, in collapsible sections. The panel is rebuilt when the selection
// changes and only refreshed (values, not elements) while the layers change, so a field being typed in keeps focus.
import { evaluate } from '../core/expr.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { framePresets } from './presets.js';

const typeLabel = { frame: 'Frame', rect: 'Rectangle', ellipse: 'Ellipse', text: 'Text' };
const weights = [[100, 'Thin'], [200, 'Extra light'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']];
const round = v => Math.round(v * 100) / 100;

export function attachProperties(root, editor, { fonts }) {
  const collapsed = new Set();
  let refreshers = [];
  let signature = '';

  const ids = () => editor.selection;
  const nodes = () => editor.selectedNodes;

  // ---------- building blocks ----------
  function section(title, ...content) {
    const el = document.createElement('section');
    el.className = 'prop-section' + (collapsed.has(title) ? ' collapsed' : '');
    const head = document.createElement('button');
    head.className = 'section-head';
    head.innerHTML = `${icon('chevron-down')}<span>${t(title)}</span>`;
    head.addEventListener('click', () => { el.classList.toggle('collapsed'); collapsed[el.classList.contains('collapsed') ? 'add' : 'delete'](title); });
    const body = document.createElement('div');
    body.className = 'section-body';
    body.append(...content.filter(Boolean));
    el.append(head, body);
    return el;
  }
  const row = (...els) => { const d = document.createElement('div'); d.className = 'prop-row'; d.append(...els.filter(Boolean)); return d; };

  // One value over the whole selection: the value, or null when the layers differ ("Mixed").
  const common = get => {
    const values = nodes().map(get);
    return values.length && values.every(v => v === values[0]) ? values[0] : null;
  };

  // A number: typed (with sums), or scrubbed by dragging the label. get/set work on one node; scale shows e.g. %.
  function number({ label, title, get, set, min = -Infinity, max = Infinity, scale = 1, step = 1, suffix = '', width }) {
    const wrap = document.createElement('label');
    wrap.className = 'num';
    if (width) wrap.style.flex = width;
    wrap.title = t('Type a sum: 200 + 32, or /2 on the current value. Drag the label to change it.');
    wrap.innerHTML = `<span class="lbl"></span><input type="text" inputmode="decimal"><span class="suffix"></span>`;
    wrap.querySelector('.lbl').textContent = label;
    if (title) wrap.querySelector('.lbl').title = t(title);
    wrap.querySelector('.suffix').textContent = suffix;
    const input = wrap.querySelector('input');
    const clamp = v => Math.min(max, Math.max(min, v));
    const refresh = () => {
      if (document.activeElement === input) return;
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

  // A color: swatch (system picker, live while dragging, one undo step) + hex field.
  function color({ get, set, label }) {
    const wrap = document.createElement('div');
    wrap.className = 'color-field';
    wrap.innerHTML = `<span class="swatch"><input type="color"></span><input type="text" class="hex" spellcheck="false"><span class="lbl muted"></span>`;
    const picker = wrap.querySelector('input[type=color]'), hex = wrap.querySelector('.hex'), swatch = wrap.querySelector('.swatch');
    if (label) wrap.querySelector('.lbl').textContent = label;
    let live = false;
    const refresh = () => {
      const v = get();
      swatch.style.background = v || 'repeating-conic-gradient(#555 0 25%, #333 0 50%) 0 0 / 8px 8px';
      if (document.activeElement !== hex) { hex.value = v ? v.replace('#', '').toUpperCase() : ''; hex.placeholder = v ? '' : t('Mixed'); }
      if (v && !live) picker.value = v;
    };
    picker.addEventListener('input', () => {
      if (!live) { live = true; editor.begin(); }
      set(picker.value, false);
      refresh();
    });
    picker.addEventListener('change', () => { if (live) { live = false; editor.commit(); editor.emit({ doc: true }); } });
    const applyHex = () => {
      let v = hex.value.trim().replace(/^#/, '');
      if (/^[0-9a-f]{3}$/i.test(v)) v = v.split('').map(c => c + c).join('');
      if (/^[0-9a-f]{6}$/i.test(v)) set(`#${v.toLowerCase()}`, true);
      refresh();
    };
    hex.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { applyHex(); hex.select(); } if (e.key === 'Escape') hex.blur(); });
    hex.addEventListener('change', applyHex);
    hex.addEventListener('focus', () => hex.select());
    refreshers.push(refresh);
    return wrap;
  }
  const nodeColor = key => color({
    get: () => common(n => n[key]),
    set: (v, undoStep) => undoStep ? editor.update(ids(), { [key]: v }) : editor.setProps(ids(), { [key]: v })
  });

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
    refreshers = [];
    const sel = nodes();
    const parts = [];
    if (!sel.length) {
      if (editor.tool === 'frame') parts.push(section('Frame presets', presetList(p => editor.addFramePreset(p))));
      const page = editor.page;
      parts.push(section('Page', row(color({
        get: () => page.background || '#1e1f23',
        set: (v, undoStep) => { if (undoStep) editor.transact(() => { page.background = v; }); else { page.background = v; editor.emit({ doc: true }); } },
        label: t('Background')
      }))));
    } else {
      const types = new Set(sel.map(n => n.type));
      const only = type => types.size === 1 && types.has(type);
      const head = document.createElement('div');
      head.className = 'prop-title';
      head.textContent = sel.length === 1 ? t(typeLabel[sel[0].type]) : t('{0} layers', sel.length);
      parts.push(head);

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
        parts.push(section('Frame', row(presetSelect), row(checkbox('Clip content', n => n.clip, (n, v) => ({ clip: v })))));
      }

      parts.push(section('Position',
        row(number({ label: 'X', get: n => n.x, set: (n, v) => ({ x: v }) }), number({ label: 'Y', get: n => n.y, set: (n, v) => ({ y: v }) })),
        row(
          number({ label: 'W', min: 1, get: n => n.w, set: (n, v) => ({ w: v, ...(n.type === 'text' && n.sizing === 'auto-width' ? { sizing: 'auto-height' } : {}) }) }),
          number({ label: 'H', min: 1, get: n => n.h, set: (n, v) => ({ h: v, ...(n.type === 'text' ? { sizing: 'fixed' } : {}) }) })
        )));

      const radius = [...types].every(t => t === 'rect' || t === 'frame');
      parts.push(section('Appearance', row(
        number({ label: '◐', title: 'Opacity', get: n => n.opacity, set: (n, v) => ({ opacity: v }), min: 0, max: 1, scale: 100, suffix: '%' }),
        radius ? number({ label: '◜', title: 'Corner radius', get: n => n.radius, set: (n, v) => ({ radius: v }), min: 0 }) : null
      )));
      parts.push(section('Fill', row(nodeColor('fill'))));

      if (only('text')) {
        parts.push(section('Typography',
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
        ));
      }
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
