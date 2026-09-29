// SVG export of a layer and everything in it. Text stays text (with the font named), shapes stay shapes, so the file
// is editable elsewhere. measure(node) → (string → width) is injected for text line breaking, as in text.js.
// assets (Map or object: id → { mime, data, w, h }) are embedded as data URLs for image fills.
import { gradientLine, imageRect, sortedStops } from './paint.js';
import { parsePath, pathToString, scalePath } from './path.js';
import { layoutText } from './text.js';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = v => +(+v).toFixed(3);

// Extra room around a layer for its shadows and blur, so they aren't cut off in an export.
export function effectMargin(node) {
  let m = 0;
  for (const e of node.effects || []) {
    if (!e.visible) continue;
    if (e.type === 'drop-shadow') m = Math.max(m, Math.abs(e.x) + e.blur + Math.max(0, e.spread), Math.abs(e.y) + e.blur + Math.max(0, e.spread));
    if (e.type === 'layer-blur') m = Math.max(m, e.radius * 2);
  }
  for (const s of node.strokes || []) if (s.visible && s.align !== 'inside') m = Math.max(m, s.align === 'outside' ? s.width : s.width / 2);
  return Math.ceil(m);
}

export function toSvg(node, measure, assets = {}) {
  const asset = id => assets instanceof Map ? assets.get(id) : assets[id];
  let uid = 0;
  const id = p => `${p}${++uid}`;
  const defs = [];
  const margin = effectMargin(node);
  const W = node.w + margin * 2, H = node.h + margin * 2;

  const shapeEl = (n, attrs) => {
    if (n.type === 'vector') {
      let d = '';
      try { d = pathToString(scalePath(parsePath(n.path), n.w / (n.vw || 1), n.h / (n.vh || 1))); } catch {}
      return `<path d="${d}"${n.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : ''}${attrs}/>`;
    }
    if (n.type === 'ellipse') return `<ellipse cx="${num(n.w / 2)}" cy="${num(n.h / 2)}" rx="${num(n.w / 2)}" ry="${num(n.h / 2)}"${attrs}/>`;
    const r = Math.min(n.radius || 0, n.w / 2, n.h / 2);
    return `<rect width="${num(n.w)}" height="${num(n.h)}"${r ? ` rx="${num(r)}"` : ''}${attrs}/>`;
  };

  const paintRef = (p, n) => {
    if (p.type === 'solid') {
      return p.opacity < 1 ? `fill="${p.color}" fill-opacity="${num(p.opacity)}"` : `fill="${p.color}"`;
    }
    const gid = id('g');
    if (p.type === 'image') {
      const a = asset(p.asset);
      if (!a) return 'fill="#c8cad0"';
      const href = `data:${a.mime};base64,${a.data}`;
      if (p.fit === 'tile') {
        const w = a.w * (p.scale || 1), h = a.h * (p.scale || 1);
        defs.push(`<pattern id="${gid}" patternUnits="userSpaceOnUse" width="${num(w)}" height="${num(h)}"><image href="${href}" width="${num(w)}" height="${num(h)}" preserveAspectRatio="none"/></pattern>`);
      } else {
        const r = imageRect(p.fit, a.w, a.h, n.w, n.h);
        defs.push(`<pattern id="${gid}" patternUnits="userSpaceOnUse" width="${num(n.w)}" height="${num(n.h)}"><image href="${href}" x="${num(r.x)}" y="${num(r.y)}" width="${num(r.w)}" height="${num(r.h)}" preserveAspectRatio="none"/></pattern>`);
      }
      return `fill="url(#${gid})"${p.opacity < 1 ? ` fill-opacity="${num(p.opacity)}"` : ''}`;
    }
    const stops = sortedStops(p).map(s => `<stop offset="${num(s.pos)}" stop-color="${s.color}"${s.opacity < 1 ? ` stop-opacity="${num(s.opacity)}"` : ''}/>`).join('');
    if (p.type === 'linear') {
      const l = gradientLine(p.angle, n.w, n.h);
      defs.push(`<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${num(l.x1)}" y1="${num(l.y1)}" x2="${num(l.x2)}" y2="${num(l.y2)}">${stops}</linearGradient>`);
    } else {
      defs.push(`<radialGradient id="${gid}" cx="0.5" cy="0.5" r="0.5">${stops}</radialGradient>`);
    }
    return `fill="url(#${gid})"${p.opacity < 1 ? ` fill-opacity="${num(p.opacity)}"` : ''}`;
  };

  const filterFor = n => {
    const fx = (n.effects || []).filter(e => e.visible && e.type !== 'background-blur');
    if (!fx.length) return '';
    const fid = id('f');
    const parts = [];
    let last = 'SourceGraphic';
    const shadows = [];
    for (const e of fx) {
      if (e.type === 'drop-shadow') {
        const r = id('r');
        parts.push(`<feMorphology in="SourceAlpha" operator="${e.spread < 0 ? 'erode' : 'dilate'}" radius="${num(Math.abs(e.spread))}" result="${r}m"/>`,
          `<feOffset in="${r}m" dx="${num(e.x)}" dy="${num(e.y)}" result="${r}o"/>`,
          `<feGaussianBlur in="${r}o" stdDeviation="${num(e.blur / 2)}" result="${r}b"/>`,
          `<feFlood flood-color="${e.color}" flood-opacity="${num(e.opacity)}"/>`,
          `<feComposite operator="in" in2="${r}b" result="${r}"/>`);
        shadows.push(r);
      }
    }
    if (shadows.length) {
      parts.push(`<feMerge result="withShadows">${shadows.map(s => `<feMergeNode in="${s}"/>`).join('')}<feMergeNode in="SourceGraphic"/></feMerge>`);
      last = 'withShadows';
    }
    for (const e of fx) {
      if (e.type === 'inner-shadow') {
        const r = id('r');
        parts.push(`<feOffset in="SourceAlpha" dx="${num(e.x)}" dy="${num(e.y)}" result="${r}o"/>`,
          `<feGaussianBlur in="${r}o" stdDeviation="${num(e.blur / 2)}" result="${r}b"/>`,
          `<feComposite operator="arithmetic" k2="-1" k3="1" in="${r}b" in2="SourceAlpha" result="${r}i"/>`,
          `<feFlood flood-color="${e.color}" flood-opacity="${num(e.opacity)}"/>`,
          `<feComposite operator="in" in2="${r}i" result="${r}c"/>`,
          `<feMerge result="${r}"><feMergeNode in="${last}"/><feMergeNode in="${r}c"/></feMerge>`);
        last = r;
      }
      if (e.type === 'layer-blur') { const r = id('r'); parts.push(`<feGaussianBlur in="${last}" stdDeviation="${num(e.radius / 2)}" result="${r}"/>`); last = r; }
    }
    defs.push(`<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${parts.join('')}</filter>`);
    return ` filter="url(#${fid})"`;
  };

  const strokesFor = n => (n.strokes || []).filter(s => s.visible && s.width > 0).map(s => {
    const paint = `fill="none" stroke="${s.color}" stroke-width="${num(s.align === 'center' ? s.width : s.width * 2)}"${s.opacity < 1 ? ` stroke-opacity="${num(s.opacity)}"` : ''}`;
    if (n.type === 'text') return '';
    if (s.align === 'center') return shapeEl(n, ` ${paint}`);
    // Inside: clipped to the shape. Outside: masked away from the shape.
    const cid = id(s.align === 'inside' ? 'c' : 'm');
    if (s.align === 'inside') { defs.push(`<clipPath id="${cid}">${shapeEl(n, '')}</clipPath>`); return `<g clip-path="url(#${cid})">${shapeEl(n, ` ${paint}`)}</g>`; }
    const pad = s.width + 1;
    defs.push(`<mask id="${cid}" maskUnits="userSpaceOnUse" x="${-pad}" y="${-pad}" width="${num(n.w + pad * 2)}" height="${num(n.h + pad * 2)}"><rect x="${-pad}" y="${-pad}" width="${num(n.w + pad * 2)}" height="${num(n.h + pad * 2)}" fill="#fff"/>${shapeEl(n, ' fill="#000"')}</mask>`);
    return `<g mask="url(#${cid})">${shapeEl(n, ` ${paint}`)}</g>`;
  }).join('');

  const textEl = (n, paint) => {
    const { lines, lineHeight } = layoutText(n, measure(n));
    const x = n.align === 'center' ? n.w / 2 : n.align === 'right' ? n.w : 0;
    const anchor = n.align === 'center' ? 'middle' : n.align === 'right' ? 'end' : 'start';
    const tspans = lines.map((l, i) => `<tspan x="${num(x)}" y="${num(i * lineHeight + lineHeight / 2)}">${esc(l) || ' '}</tspan>`).join('');
    return `<text font-family="${esc(n.fontFamily)}" font-size="${num(n.fontSize)}" font-weight="${n.fontWeight}"${n.letterSpacing ? ` letter-spacing="${num(n.letterSpacing)}"` : ''} text-anchor="${anchor}" dominant-baseline="central" xml:space="preserve" ${paint}>${tspans}</text>`;
  };

  const el = (n, isRoot = false) => {
    if (!n.visible) return '';
    const pos = isRoot ? `translate(${margin} ${margin})` : `translate(${num(n.x)} ${num(n.y)})`;
    const attrs = `${n.opacity < 1 ? ` opacity="${num(n.opacity)}"` : ''}${filterFor(n)}`;
    const fills = (n.fills || []).filter(p => p.visible);
    let body = '';
    if (n.type === 'text') body = fills.map(p => textEl(n, paintRef(p, n))).join('');
    else if (n.type !== 'group') body = fills.map(p => shapeEl(n, ` ${paintRef(p, n)}`)).join('');
    if (n.children?.length) {
      const kids = n.children.map(c => el(c)).join('');
      if (n.type === 'frame' && n.clip) {
        const cid = id('c');
        defs.push(`<clipPath id="${cid}">${shapeEl(n, '')}</clipPath>`);
        body += `<g clip-path="url(#${cid})">${kids}</g>`;
      } else body += kids;
    }
    body += strokesFor(n);
    return `<g data-name="${esc(n.name)}" data-visual-id="${n.id}" transform="${pos}"${attrs}>${body}</g>`;
  };

  const content = el(node, true);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(W)}" height="${num(H)}" viewBox="0 0 ${num(W)} ${num(H)}" fill="none">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${content}</svg>\n`;
}

