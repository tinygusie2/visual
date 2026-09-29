// SVG import: an SVG file becomes editable layers. The browser does the hard part: the SVG is put in the page
// (hidden) so every element's final transform (getCTM) and styles (getComputedStyle, which also resolves CSS and
// inherited attributes) can be read. Rectangles, circles and ellipses that are not rotated stay rectangles and
// ellipses; everything else becomes a vector path. Text stays text. Scripts and event handlers are removed first.
import { createNode } from '../core/document.js';
import { gradient, normalizeHex, rgbToHex, solid, stroke } from '../core/paint.js';
import { ellipsePath, parsePath, polyPath, rectPath, transformPath, vectorFromSegments } from '../core/path.js';

const r2 = v => Math.round(v * 100) / 100;

function sanitize(root) {
  root.querySelectorAll('script, foreignObject, iframe').forEach(e => e.remove());
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || (/href$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
    }
  }
}

// 'rgb(1, 2, 3)' / 'rgba(1, 2, 3, 0.5)' / '#abc' → { color, opacity } or null for none.
function parseColor(v) {
  if (!v || v === 'none' || v === 'transparent') return null;
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/.exec(v);
  if (m) {
    let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4]);
    return { color: rgbToHex({ r: +m[1], g: +m[2], b: +m[3] }), opacity: a };
  }
  const hex = normalizeHex(v);
  return hex ? { color: hex, opacity: 1 } : null;
}

// A linear or radial gradient element (with stops possibly inherited through href) as a paint.
function gradientPaint(svg, id, opacity) {
  let el = svg.querySelector(`#${CSS.escape(id)}`);
  if (!el) return null;
  const type = el.tagName.toLowerCase().includes('radial') ? 'radial' : 'linear';
  let stopsEl = el;
  for (let i = 0; i < 5 && !stopsEl.querySelector('stop'); i++) {
    const ref = (stopsEl.getAttribute('href') || stopsEl.getAttribute('xlink:href') || '').replace(/^#/, '');
    const next = ref && svg.querySelector(`#${CSS.escape(ref)}`);
    if (!next) break;
    stopsEl = next;
  }
  const stops = [...stopsEl.querySelectorAll('stop')].map(s => {
    const cs = getComputedStyle(s);
    const c = parseColor(cs.stopColor) || { color: '#000000', opacity: 1 };
    const off = s.getAttribute('offset') || '0';
    const pos = off.endsWith('%') ? parseFloat(off) / 100 : parseFloat(off);
    return { pos: Math.min(1, Math.max(0, pos || 0)), color: c.color, opacity: c.opacity * (parseFloat(cs.stopOpacity) || (cs.stopOpacity === '0' ? 0 : 1)) };
  });
  if (stops.length < 2) return stops.length ? solid(stops[0].color, stops[0].opacity * opacity) : null;
  let angle = 180;
  if (type === 'linear') {
    const num = (a, d) => { const v = el.getAttribute(a); return v == null ? d : v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v); };
    const dx = num('x2', 1) - num('x1', 0), dy = num('y2', 0) - num('y1', 0);
    angle = ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360;
  }
  return { ...gradient(type, stops, Math.round(angle)), opacity };
}

function paintFrom(svg, value, opacity) {
  const url = /url\(["']?#([^"')]+)["']?\)/.exec(value || '');
  if (url) return gradientPaint(svg, url[1], opacity);
  const c = parseColor(value);
  return c ? solid(c.color, r2(c.opacity * opacity)) : null;
}

// Segments of a shape element in its own coordinates.
function segmentsOf(el) {
  const n = a => parseFloat(el.getAttribute(a)) || 0;
  switch (el.tagName.toLowerCase()) {
    case 'path': return parsePath(el.getAttribute('d'));
    case 'rect': {
      let rx = el.getAttribute('rx'), ry = el.getAttribute('ry');
      rx = rx == null ? parseFloat(ry) || 0 : parseFloat(rx); ry = ry == null ? rx : parseFloat(ry);
      return rectPath(n('x'), n('y'), n('width'), n('height'), rx, ry);
    }
    case 'circle': return ellipsePath(n('cx'), n('cy'), n('r'), n('r'));
    case 'ellipse': return ellipsePath(n('cx'), n('cy'), n('rx'), n('ry'));
    case 'line': return polyPath([n('x1'), n('y1'), n('x2'), n('y2')], false);
    case 'polyline': case 'polygon': {
      const pts = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
      return polyPath(pts, el.tagName.toLowerCase() === 'polygon');
    }
  }
  return [];
}

const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const SKIP = new Set(['defs', 'clippath', 'mask', 'symbol', 'style', 'title', 'desc', 'metadata', 'lineargradient', 'radialgradient', 'pattern', 'filter', 'marker']);

export function importSvg(text, name = 'SVG') {
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  const src = parsed.documentElement;
  if (!src || src.tagName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) throw new Error('This is not a valid SVG file.');
  sanitize(src);

  // The size it has as a picture: width/height, else its viewBox.
  const vb = (src.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  const len = a => { const v = src.getAttribute(a); return v && !v.endsWith('%') ? parseFloat(v) : NaN; };
  const W = len('width') || (hasVb ? vb[2] : 300), H = len('height') || (hasVb ? vb[3] : 150);

  const host = document.createElement('div');
  // Off screen, not visibility:hidden: that would be inherited and read as hidden on every element.
  host.style.cssText = 'position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none';
  const svg = document.importNode(src, true);
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  host.append(svg);
  document.body.append(host);
  try {
    const kids = convertChildren(svg, svg);
    return createNode('frame', { name, w: r2(W), h: r2(H), fills: [], clip: true, children: kids });
  } finally { host.remove(); }
}

function convertChildren(svg, parent) {
  const out = [];
  for (const el of parent.children) {
    const node = convert(svg, el);
    if (node) out.push(node);
  }
  return out;
}

function convert(svg, el) {
  const tag = el.tagName.toLowerCase();
  if (SKIP.has(tag)) return null;
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return null;
  const opacity = parseFloat(cs.opacity);
  const base = { opacity: Number.isFinite(opacity) ? opacity : 1, name: el.getAttribute('id') || el.getAttribute('inkscape:label') || undefined };
  if (!base.name) delete base.name;

  if (tag === 'g' || tag === 'a' || tag === 'switch') {
    const children = convertChildren(svg, el);
    if (!children.length) return null;
    if (children.length === 1 && base.opacity === 1) return children[0];
    // Group positions: children are in page coordinates, so the group starts at 0,0 and fits itself around them.
    return createNode('group', { ...base, x: 0, y: 0, w: 1, h: 1, children });
  }
  if (tag === 'text') return textNode(el, cs, base);
  if (!SHAPES.has(tag)) return null;

  const m = el.getCTM() || new DOMMatrix();
  const fill = paintFrom(svg, cs.fill, parseFloat(cs.fillOpacity) || (cs.fillOpacity === '0' ? 0 : 1));
  const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
  const strokePaint = parseColor(cs.stroke);
  const strokeWidth = parseFloat(cs.strokeWidth) || 0;
  const strokes = strokePaint && strokeWidth > 0
    ? [{ ...stroke(strokePaint.color, r2(strokeWidth * scale)), opacity: r2(strokePaint.opacity * (parseFloat(cs.strokeOpacity) || (cs.strokeOpacity === '0' ? 0 : 1))), align: 'center' }]
    : [];
  const fills = fill && tag !== 'line' ? [fill] : [];
  const style = { ...base, fills, strokes };

  // Not rotated or skewed: rectangles and ellipses stay what they are.
  const straight = Math.abs(m.b) < 1e-9 && Math.abs(m.c) < 1e-9 && m.a > 0 && m.d > 0;
  const n = a => parseFloat(el.getAttribute(a)) || 0;
  const evenCorners = !el.getAttribute('ry') || el.getAttribute('ry') === el.getAttribute('rx');
  if (straight && tag === 'rect' && evenCorners && Math.abs(m.a - m.d) < 1e-9) {
    return createNode('rect', { ...style, x: r2(m.e + n('x') * m.a), y: r2(m.f + n('y') * m.d), w: r2(n('width') * m.a), h: r2(n('height') * m.d), radius: r2(n('rx') * m.a) });
  }
  if (straight && (tag === 'circle' || tag === 'ellipse')) {
    const rx = tag === 'circle' ? n('r') : n('rx'), ry = tag === 'circle' ? n('r') : n('ry');
    return createNode('ellipse', { ...style, x: r2(m.e + (n('cx') - rx) * m.a), y: r2(m.f + (n('cy') - ry) * m.d), w: r2(rx * 2 * m.a), h: r2(ry * 2 * m.d) });
  }
  let segs;
  try { segs = segmentsOf(el); } catch { return null; }
  if (!segs.length) return null;
  const v = vectorFromSegments(transformPath(segs, m));
  return createNode('vector', { ...style, ...v, fillRule: cs.fillRule === 'evenodd' ? 'evenodd' : 'nonzero' });
}

function textNode(el, cs, base) {
  const text = el.querySelectorAll('tspan').length
    ? [...el.querySelectorAll('tspan')].map(t => t.textContent).join('\n')
    : el.textContent;
  if (!text.trim()) return null;
  const box = el.getBBox(), m = el.getCTM() || new DOMMatrix();
  const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
  const fill = parseColor(cs.fill) || { color: '#000000', opacity: 1 };
  const family = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim() || 'Google Sans Flex';
  return createNode('text', {
    ...base, text: text.trim(), fontFamily: family, fontSize: r2(parseFloat(cs.fontSize) * scale), fontWeight: Number(cs.fontWeight) || 400,
    x: r2(m.a * box.x + m.c * box.y + m.e), y: r2(m.b * box.x + m.d * box.y + m.f), sizing: 'auto-width',
    fills: [solid(fill.color, fill.opacity)]
  });
}
