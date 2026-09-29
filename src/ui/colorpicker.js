// The colour picker: a popover next to the properties panel. It edits a paint (solid, linear or radial gradient):
// colour field + hue + opacity, HEX / RGB / HSL, eyedropper, the document's colour variables, colours used in the
// document and recent colours. A solid colour can be bound to a variable (click it; changing the colour by hand
// unbinds it) or saved as a new one (+). For gradients a bar with the stops sits on top: click the bar to add a stop,
// drag to move, Delete to remove.
import {
  colorAt, gradient, hexToRgb, hslToRgb, hsvToRgb, normalizeHex, paintCss, rgbToHex, rgbToHsl, rgbToHsv, rgba, solid, sortedStops
} from '../core/paint.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

let current = null;

const RECENT_KEY = 'visual.recentColors';
function recentColors() { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } }
function rememberColor(hex) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([hex, ...recentColors().filter(c => c !== hex)].slice(0, 16))); } catch {}
}

export function closeColorPicker() { current?.close(); }
export const colorPickerOpen = () => !!current;

// options: { paint, gradients (allow gradient types), opacity (show opacity), documentColors: [...hex],
//   variables: [{ id, name, color }] (omit to leave them out), onCreateVariable(hex) → variable, onChange(paint), onClose() }
export function openColorPicker(anchor, options) {
  closeColorPicker();
  let paint = structuredClone(options.paint);
  let stopIndex = 0;
  let mode = 'hex';
  const withOpacity = options.opacity !== false;

  const el = document.createElement('div');
  el.className = 'picker';
  el.innerHTML = `
    <div class="picker-tabs" ${options.gradients ? '' : 'hidden'}>
      <button data-type="solid">${t('Solid')}</button><button data-type="linear">${t('Linear')}</button><button data-type="radial">${t('Radial')}</button>
      <span class="spacer"></span><button class="icon ghost close" title="${t('Close')}">${icon('x')}</button>
    </div>
    <div class="grad" hidden>
      <div class="grad-bar"><div class="grad-fill"></div></div>
      <div class="grad-row"><label class="angle">${t('Angle')}<input type="text" inputmode="decimal"><span>°</span></label>
        <button class="icon ghost flip" title="${t('Reverse')}">⇄</button><button class="icon ghost del-stop" title="${t('Remove stop')}">${icon('minus')}</button></div>
    </div>
    <div class="sv"><div class="sv-white"></div><div class="sv-black"></div><div class="knob"></div></div>
    <div class="sliders">
      <button class="icon ghost eyedrop" title="${t('Pick a colour from the screen')}" ${window.EyeDropper ? '' : 'hidden'}>${icon('eyedropper')}</button>
      <div class="bars"><div class="hue"><div class="knob"></div></div><div class="alpha" ${withOpacity ? '' : 'hidden'}><div class="alpha-fill"></div><div class="knob"></div></div></div>
    </div>
    <div class="fields">
      <select class="mode"><option value="hex">Hex</option><option value="rgb">RGB</option><option value="hsl">HSL</option></select>
      <div class="vals"></div>
      <label class="op" ${withOpacity ? '' : 'hidden'}><input type="text" inputmode="decimal"><span>%</span></label>
    </div>
    <div class="swatches var-colors" ${options.variables ? '' : 'hidden'}><h4><span>${t('Colour variables')}</span>
      <button class="icon ghost add-var" title="${t('Save as colour variable')}">${icon('plus')}</button></h4><div class="row"></div></div>
    <div class="swatches doc-colors"><h4>${t('Document colours')}</h4><div class="row"></div></div>
    <div class="swatches recent-colors"><h4>${t('Recent colours')}</h4><div class="row"></div></div>`;
  document.body.append(el);
  const $ = s => el.querySelector(s);

  // ---------- the colour being edited: the paint itself (solid) or the selected stop ----------
  const target = () => paint.type === 'solid' ? paint : sortedStops(paint)[stopIndex];
  let hsv = rgbToHsv(hexToRgb(target().color));

  const emit = () => { options.onChange(structuredClone(paint)); };
  function setColor(hex, { keepHsv = false } = {}) {
    target().color = hex;
    delete target().variable;
    if (!keepHsv) hsv = rgbToHsv(hexToRgb(hex));
    emit(); render();
  }
  const setFromHsv = () => setColor(rgbToHex(hsvToRgb(hsv)), { keepHsv: true });

  function render() {
    const tg = target();
    el.querySelectorAll('.picker-tabs [data-type]').forEach(b => b.classList.toggle('on', b.dataset.type === paint.type));
    const isGrad = paint.type !== 'solid';
    $('.grad').hidden = !isGrad;
    if (isGrad) {
      $('.grad-fill').style.background = paintCss({ ...paint, type: 'linear', angle: 90, opacity: 1 });
      const bar = $('.grad-bar');
      bar.querySelectorAll('.stop').forEach(s => s.remove());
      sortedStops(paint).forEach((s, i) => {
        const d = document.createElement('div');
        d.className = 'stop' + (i === stopIndex ? ' on' : '');
        d.style.left = `${s.pos * 100}%`;
        d.style.setProperty('--c', rgba(s.color, s.opacity));
        d.addEventListener('pointerdown', e => dragStop(e, s));
        bar.append(d);
      });
      $('.angle').hidden = paint.type !== 'linear';
      if (document.activeElement !== $('.angle input')) $('.angle input').value = String(Math.round(paint.angle));
      $('.del-stop').disabled = paint.stops.length <= 2;
    }
    const hueHex = rgbToHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));
    $('.sv').style.background = hueHex;
    Object.assign($('.sv .knob').style, { left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: tg.color });
    $('.hue .knob').style.left = `${hsv.h / 360 * 100}%`;
    $('.alpha-fill').style.background = `linear-gradient(90deg, transparent, ${tg.color})`;
    $('.alpha .knob').style.left = `${tg.opacity * 100}%`;
    el.querySelectorAll('.var-colors .sw').forEach(b => b.classList.toggle('on', b.dataset.id === tg.variable));
    $('.add-var').hidden = paint.type !== 'solid' || !options.onCreateVariable;
    renderFields();
  }

  function renderFields() {
    const tg = target(), vals = $('.vals');
    if (!vals.contains(document.activeElement)) {
      const rgb = hexToRgb(tg.color), hsl = rgbToHsl(rgb);
      const values = mode === 'hex' ? [tg.color.slice(1).toUpperCase()]
        : mode === 'rgb' ? [rgb.r, rgb.g, rgb.b]
        : [Math.round(hsl.h), Math.round(hsl.s * 100), Math.round(hsl.l * 100)];
      if (vals.children.length !== values.length) {
        vals.replaceChildren(...values.map(() => { const i = document.createElement('input'); i.type = 'text'; i.spellcheck = false; i.addEventListener('change', applyFields); i.addEventListener('keydown', fieldKeys); return i; }));
      }
      values.forEach((v, i) => { vals.children[i].value = String(v); });
    }
    if (document.activeElement !== $('.op input')) $('.op input').value = String(Math.round(tg.opacity * 100));
  }
  function applyFields() {
    const v = [...$('.vals').children].map(i => i.value.trim());
    let hex = null;
    if (mode === 'hex') hex = normalizeHex(v[0]);
    else {
      const n = v.map(Number);
      if (n.every(Number.isFinite)) hex = mode === 'rgb' ? rgbToHex({ r: n[0], g: n[1], b: n[2] })
        : rgbToHex(hslToRgb({ h: n[0], s: Math.min(100, Math.max(0, n[1])) / 100, l: Math.min(100, Math.max(0, n[2])) / 100 }));
    }
    if (hex) setColor(hex); else renderFields();
  }
  function fieldKeys(e) {
    e.stopPropagation();
    if (e.key === 'Enter') { e.target.blur(); applyFields(); }
    if (e.key === 'Escape') close();
  }

  // ---------- dragging in the colour field and on the bars ----------
  function track(elm, e, fn) {
    e.preventDefault();
    const r = elm.getBoundingClientRect();
    const at = ev => fn(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
    at(e);
    const move = ev => at(ev);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  $('.sv').addEventListener('pointerdown', e => track($('.sv'), e, (x, y) => { hsv.s = x; hsv.v = 1 - y; setFromHsv(); }));
  $('.hue').addEventListener('pointerdown', e => track($('.hue'), e, x => { hsv.h = x * 360; setFromHsv(); }));
  $('.alpha').addEventListener('pointerdown', e => track($('.alpha'), e, x => { target().opacity = Math.round(x * 100) / 100; emit(); render(); }));

  function dragStop(e, stop) {
    e.stopPropagation();
    stopIndex = sortedStops(paint).indexOf(stop);
    hsv = rgbToHsv(hexToRgb(stop.color));
    render();
    track($('.grad-bar'), e, x => { stop.pos = Math.round(x * 1000) / 1000; stopIndex = sortedStops(paint).indexOf(stop); emit(); render(); });
  }
  $('.grad-bar').addEventListener('pointerdown', e => {
    if (e.target.classList.contains('stop')) return;
    const r = $('.grad-bar').getBoundingClientRect();
    const pos = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const stop = { pos, ...colorAt(paint, pos) };
    paint.stops.push(stop);
    stopIndex = sortedStops(paint).indexOf(stop);
    hsv = rgbToHsv(hexToRgb(stop.color));
    emit(); render();
  });
  const removeStop = () => {
    if (paint.type === 'solid' || paint.stops.length <= 2) return;
    const s = sortedStops(paint)[stopIndex];
    paint.stops = paint.stops.filter(x => x !== s);
    stopIndex = Math.max(0, stopIndex - 1);
    hsv = rgbToHsv(hexToRgb(target().color));
    emit(); render();
  };
  $('.del-stop').addEventListener('click', removeStop);
  $('.flip').addEventListener('click', () => { paint.stops.forEach(s => { s.pos = 1 - s.pos; }); stopIndex = paint.stops.length - 1 - stopIndex; emit(); render(); });
  const angle = $('.angle input');
  angle.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') angle.blur(); });
  angle.addEventListener('change', () => { const v = Number(angle.value); if (Number.isFinite(v)) { paint.angle = ((v % 360) + 360) % 360; emit(); } render(); });

  // ---------- type tabs, mode, opacity, eyedropper, swatches ----------
  el.querySelectorAll('.picker-tabs [data-type]').forEach(b => b.addEventListener('click', () => {
    const type = b.dataset.type;
    if (type === paint.type) return;
    const was = target();
    if (type === 'solid') paint = { ...solid(was.color, was.opacity), visible: paint.visible };
    else if (paint.type === 'solid') paint = { ...gradient(type, [{ pos: 0, color: was.color, opacity: was.opacity }, { pos: 1, color: was.color, opacity: 0 }]), visible: paint.visible };
    else paint.type = type;
    stopIndex = 0;
    hsv = rgbToHsv(hexToRgb(target().color));
    emit(); render();
  }));
  $('.mode').addEventListener('change', e => { mode = e.target.value; $('.vals').replaceChildren(); renderFields(); });
  $('.mode').addEventListener('keydown', e => e.stopPropagation());
  const op = $('.op input');
  op.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') op.blur(); });
  op.addEventListener('change', () => { const v = Number(op.value); if (Number.isFinite(v)) { target().opacity = Math.min(100, Math.max(0, v)) / 100; emit(); } render(); });
  $('.eyedrop').addEventListener('click', async () => {
    try { const { sRGBHex } = await new window.EyeDropper().open(); const hex = normalizeHex(sRGBHex); if (hex) setColor(hex); } catch {}
  });
  $('.close').addEventListener('click', () => close());
  const swatchRow = (sel, colors) => {
    const row = $(`${sel} .row`);
    $(sel).hidden = !colors.length;
    row.replaceChildren(...colors.map(c => {
      const b = document.createElement('button');
      b.className = 'sw'; b.style.background = c; b.title = c.toUpperCase();
      b.addEventListener('click', () => setColor(c));
      return b;
    }));
  };
  swatchRow('.doc-colors', (options.documentColors || []).slice(0, 18));
  // Variables: a solid colour is bound to the one clicked, a gradient stop just takes its colour.
  const varRow = () => {
    const vars = options.variables || [];
    $('.var-colors .row').replaceChildren(...vars.map(v => {
      const b = document.createElement('button');
      b.className = 'sw'; b.style.background = v.color; b.title = `${v.name}  ${v.color.toUpperCase()}`; b.dataset.id = v.id;
      b.addEventListener('click', () => {
        if (paint.type !== 'solid') return setColor(v.color);
        paint.color = v.color; paint.variable = v.id;
        hsv = rgbToHsv(hexToRgb(v.color));
        emit(); render();
      });
      return b;
    }));
  };
  varRow();
  $('.add-var').addEventListener('click', () => {
    const v = options.onCreateVariable?.(paint.color);
    if (!v) return;
    options.variables = [...(options.variables || []).filter(x => x.id !== v.id), v];
    varRow();
    paint.variable = v.id;
    emit(); render();
  });
  swatchRow('.recent-colors', recentColors());

  el.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !/INPUT|SELECT/.test(document.activeElement.tagName)) { e.stopPropagation(); removeStop(); }
  });
  el.tabIndex = -1;

  // ---------- placing and closing ----------
  const r = anchor.getBoundingClientRect();
  el.style.top = `${Math.max(48, Math.min(r.top - 20, window.innerHeight - el.offsetHeight - 12))}px`;
  el.style.left = `${Math.max(8, r.left - el.offsetWidth - 16)}px`;
  const outside = e => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  function close() {
    if (current !== api) return;
    current = null;
    document.removeEventListener('pointerdown', outside, true);
    el.remove();
    const tg = target();
    if (tg) rememberColor(tg.color);
    options.onClose?.();
  }
  const api = { close, el };
  current = api;
  render();
  el.focus();
  return api;
}
