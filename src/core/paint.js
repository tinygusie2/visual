// Colours and paints. A layer has a list of fills (drawn bottom to top) and a list of strokes:
//   solid     { type: 'solid', color: '#rrggbb', opacity, visible }
//   gradient  { type: 'linear' | 'radial', stops: [{ pos: 0..1, color, opacity }], angle (linear, CSS degrees), opacity, visible }
//   image     { type: 'image', asset: id in the document's assets, fit: 'fill' | 'fit' | 'stretch' | 'tile', scale (tile), opacity, visible }
// Gradients follow CSS: linear-gradient(<angle>deg) with 90° = left → right, radial = radial-gradient(closest-side),
// so the same paint looks the same on the canvas, in SVG and in Motion Studio's HTML.

export const solid = (color = '#d9d9d9', opacity = 1) => ({ type: 'solid', color, opacity, visible: true });
export const gradient = (type = 'linear', stops = [{ pos: 0, color: '#ffffff', opacity: 1 }, { pos: 1, color: '#000000', opacity: 1 }], angle = 180) =>
  ({ type, stops, angle, opacity: 1, visible: true });
export const image = (asset, fit = 'fill') => ({ type: 'image', asset, fit, scale: 1, opacity: 1, visible: true });
export const stroke = (color = '#000000', width = 1) => ({ color, opacity: 1, width, align: 'inside', visible: true });

// ---------- colour conversion ----------
export function normalizeHex(input) {
  let v = String(input).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(v)) v = v.split('').map(c => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : null;
}
export function hexToRgb(hex) {
  const v = parseInt(normalizeHex(hex)?.slice(1) ?? '000000', 16);
  return { r: v >> 16 & 255, g: v >> 8 & 255, b: v & 255 };
}
export const rgbToHex = ({ r, g, b }) => '#' + [r, g, b].map(c => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('');

// h 0–360, s/v/l 0–1
export function rgbToHsv({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}
export function hsvToRgb({ h, s, v }) {
  const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return { r: f(5) * 255, g: f(3) * 255, b: f(1) * 255 };
}
export function rgbToHsl({ r, g, b }) {
  const { h, s: sv, v } = rgbToHsv({ r, g, b });
  const l = v * (1 - sv / 2);
  return { h, s: l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l), l };
}
export function hslToRgb({ h, s, l }) {
  const v = l + s * Math.min(l, 1 - l);
  return hsvToRgb({ h, s: v ? 2 * (1 - l / v) : 0, v });
}

export function rgba(color, opacity = 1) {
  const { r, g, b } = hexToRgb(color);
  return opacity >= 1 ? color : `rgba(${r}, ${g}, ${b}, ${+opacity.toFixed(3)})`;
}

// ---------- gradients ----------
// Start and end of a CSS linear gradient line over a w × h box (local coordinates).
export function gradientLine(angle, w, h) {
  const a = angle * Math.PI / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);
  const len = Math.abs(w * dx) + Math.abs(h * dy);
  const cx = w / 2, cy = h / 2;
  return { x1: cx - dx * len / 2, y1: cy - dy * len / 2, x2: cx + dx * len / 2, y2: cy + dy * len / 2 };
}

export const sortedStops = p => [...p.stops].sort((a, b) => a.pos - b.pos);

// The colour a gradient has at position t (for new stops placed in between).
export function colorAt(p, t) {
  const stops = sortedStops(p);
  if (t <= stops[0].pos) return { color: stops[0].color, opacity: stops[0].opacity };
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    if (t <= b.pos) {
      const k = (t - a.pos) / (b.pos - a.pos || 1);
      const ca = hexToRgb(a.color), cb = hexToRgb(b.color);
      return { color: rgbToHex({ r: ca.r + (cb.r - ca.r) * k, g: ca.g + (cb.g - ca.g) * k, b: ca.b + (cb.b - ca.b) * k }), opacity: a.opacity + (b.opacity - a.opacity) * k };
    }
  }
  const last = stops.at(-1);
  return { color: last.color, opacity: last.opacity };
}

// CSS for a paint (text editor overlay now, Motion Studio later).
export function paintCss(p) {
  if (p.type === 'solid') return rgba(p.color, p.opacity);
  if (p.type === 'image') return '#8b8e97';
  const stops = sortedStops(p).map(s => `${rgba(s.color, s.opacity * p.opacity)} ${+(s.pos * 100).toFixed(2)}%`).join(', ');
  return p.type === 'linear' ? `linear-gradient(${p.angle}deg, ${stops})` : `radial-gradient(closest-side, ${stops})`;
}

// Where an image of iw × ih goes in a w × h box: CSS object-fit cover (fill), contain (fit) or stretch.
export function imageRect(fit, iw, ih, w, h) {
  if (fit === 'stretch' || !iw || !ih) return { x: 0, y: 0, w, h };
  const k = fit === 'fit' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
  return { x: (w - iw * k) / 2, y: (h - ih * k) / 2, w: iw * k, h: ih * k };
}

// The first visible solid colour of a layer (for things that need one colour, like the text cursor).
export function mainColor(node) {
  const f = [...(node.fills || [])].reverse().find(p => p.visible && p.type !== 'image');
  if (!f) return null;
  return f.type === 'solid' ? f.color : sortedStops(f)[0].color;
}
