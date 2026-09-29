// Export of one layer (with everything in it) to PNG, JPEG, WebP or SVG, at 1×–4× or any scale.
import { walk } from '../core/document.js';
import { effectMargin, toSvg } from '../core/svg.js';
import { fontString } from '../core/text.js';
import { drawNode, measurer } from './draw.js';
import { loadImage } from './images.js';

export const FORMATS = ['png', 'jpg', 'webp', 'svg'];
const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

async function fontsReady(node) {
  const fonts = new Set();
  walk([node], n => { if (n.type === 'text') fonts.add(fontString(n)); });
  await Promise.all([...fonts].map(f => document.fonts.load(f).catch(() => {})));
}

// Decodes the images a layer uses; returns env.image for drawNode.
async function imagesReady(node, assets) {
  const get = id => assets instanceof Map ? assets.get(id) : assets?.[id];
  const ids = new Set();
  walk([node], n => { for (const p of n.fills || []) if (p.type === 'image' && p.visible) ids.add(p.asset); });
  const images = new Map();
  await Promise.all([...ids].map(async id => { const e = loadImage(id, get(id)); if (e) images.set(id, await e.ready); }));
  return id => images.get(id) || null;
}

// The layer drawn on its own canvas. Its position on the page doesn't matter; its shadows get room around it.
export async function renderCanvas(node, scale = 1, { background = null, assets = null } = {}) {
  await fontsReady(node);
  const image = await imagesReady(node, assets);
  const m = effectMargin(node);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((node.w + m * 2) * scale));
  canvas.height = Math.max(1, Math.round((node.h + m * 2) * scale));
  const ctx = canvas.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.setTransform(scale, 0, 0, scale, (m - node.x) * scale, (m - node.y) * scale);
  drawNode(ctx, node, { scale, backdrop: false, image });
  return canvas;
}

// → { name, data } with data an ArrayBuffer (images) or a string (SVG).
export async function exportNode(node, { format = 'png', scale = 1, assets = null } = {}) {
  const suffix = format === 'svg' || scale === 1 ? '' : `@${scale}x`;
  const name = `${safeName(node.name)}${suffix}.${format}`;
  if (format === 'svg') { await fontsReady(node); return { name, data: toSvg(node, measurer, assets || {}) }; }
  // JPEG has no transparency: white behind it.
  const canvas = await renderCanvas(node, scale, { background: format === 'jpg' ? '#ffffff' : null, assets });
  const blob = await new Promise(r => canvas.toBlob(r, mime[format], 0.92));
  return { name, data: await blob.arrayBuffer() };
}

export const safeName = s => String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim() || 'Layer';
