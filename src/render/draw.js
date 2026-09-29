// Draws layers on a 2D canvas context. The editor canvas and PNG/JPEG/WebP export both use this, so what you export
// is what you see. The context's transform maps world units to device pixels; env.scale says how many device pixels
// one world unit is (shadow and blur sizes are in device pixels on a canvas).
//   env = { scale, skipId (text being typed), backdrop (background blur may sample the canvas), ensureFont(node),
//           image(assetId) → a decoded image or null while it loads }
import { gradientLine, imageRect, rgba, sortedStops } from '../core/paint.js';
import { fontString, layoutText } from '../core/text.js';

const measureCtx = document.createElement('canvas').getContext('2d');
// measure(node) → string → width, for layoutText / fitTextSize / SVG export.
export function measurer(node) {
  measureCtx.font = fontString(node);
  measureCtx.letterSpacing = `${node.letterSpacing}px`;
  return s => measureCtx.measureText(s).width;
}

// Shadows are drawn by painting the shape far off-canvas and letting only its shadow fall in place, so the shadow
// doesn't depend on the fill (a see-through fill still casts a full shadow, as in other design tools).
const FAR = 50000; // device px

// Vector paths are parsed once per path string and stretched to the layer's size when drawn.
const pathCache = new Map();
function vectorPath(n) {
  let base = pathCache.get(n.path);
  if (!base) {
    try { base = new Path2D(n.path); } catch { base = new Path2D(); }
    if (pathCache.size > 4000) pathCache.clear();
    pathCache.set(n.path, base);
  }
  const p = new Path2D();
  p.addPath(base, new DOMMatrix([n.w / (n.vw || 1), 0, 0, n.h / (n.vh || 1), 0, 0]));
  return p;
}
const rule = n => n.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';

export function shapePath(n, grow = 0) {
  if (n.type === 'vector') return vectorPath(n);
  const p = new Path2D();
  if (n.type === 'ellipse') p.ellipse(n.w / 2, n.h / 2, Math.max(0, n.w / 2 + grow), Math.max(0, n.h / 2 + grow), 0, 0, Math.PI * 2);
  else p.roundRect(-grow, -grow, Math.max(0, n.w + grow * 2), Math.max(0, n.h + grow * 2), Math.max(0, Math.min(n.radius || 0, n.w / 2, n.h / 2) + (n.radius ? grow : 0)));
  return p;
}

function paintStyle(ctx, p, n) {
  if (p.type === 'solid') return rgba(p.color, p.opacity);
  const stops = sortedStops(p);
  let g;
  if (p.type === 'linear') {
    const l = gradientLine(p.angle, n.w, n.h);
    g = ctx.createLinearGradient(l.x1, l.y1, l.x2, l.y2);
  } else g = ctx.createRadialGradient(n.w / 2, n.h / 2, 0, n.w / 2, n.h / 2, Math.max(n.w, n.h) / 2);
  for (const s of stops) g.addColorStop(Math.min(1, Math.max(0, s.pos)), rgba(s.color, s.opacity * p.opacity));
  return g;
}

function fillPath(ctx, n, path, env) {
  for (const p of n.fills) {
    if (!p.visible) continue;
    if (p.type === 'image') {
      const img = env.image?.(p.asset);
      ctx.save();
      ctx.clip(path, rule(n));
      ctx.globalAlpha *= p.opacity;
      if (!img) { ctx.fillStyle = '#c8cad0'; ctx.fill(path, rule(n)); } // while it loads, or when the image is missing
      else if (p.fit === 'tile') {
        const pattern = ctx.createPattern(img, 'repeat');
        pattern.setTransform(new DOMMatrix().scale(p.scale || 1));
        ctx.fillStyle = pattern;
        ctx.fill(path, rule(n));
      } else {
        const r = imageRect(p.fit, img.naturalWidth, img.naturalHeight, n.w, n.h);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, r.x, r.y, r.w, r.h);
      }
      ctx.restore();
    } else if (p.type === 'radial') {
      // radial-gradient(closest-side): a circle gradient squeezed into the box.
      ctx.save();
      ctx.clip(path, rule(n));
      ctx.translate(n.w / 2, n.h / 2);
      ctx.scale(Math.max(n.w / 2, 1e-6), Math.max(n.h / 2, 1e-6));
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      for (const s of sortedStops(p)) g.addColorStop(Math.min(1, Math.max(0, s.pos)), rgba(s.color, s.opacity * p.opacity));
      ctx.fillStyle = g;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    } else {
      ctx.fillStyle = paintStyle(ctx, p, n);
      ctx.fill(path, rule(n));
    }
  }
}

function withShadow(ctx, e, env, draw) {
  ctx.save();
  const far = FAR / env.scale;
  ctx.shadowColor = rgba(e.color, e.opacity);
  ctx.shadowBlur = e.blur * env.scale;
  ctx.shadowOffsetX = FAR + e.x * env.scale;
  ctx.shadowOffsetY = e.y * env.scale;
  ctx.translate(-far, 0);
  ctx.fillStyle = '#000';
  draw();
  ctx.restore();
}

function dropShadows(ctx, n, env, textLines) {
  for (const e of n.effects) {
    if (!e.visible || e.type !== 'drop-shadow') continue;
    withShadow(ctx, e, env, () => textLines ? textLines(true) : ctx.fill(shapePath(n, e.spread || 0), rule(n)));
  }
}

function innerShadows(ctx, n, path, env) {
  for (const e of n.effects) {
    if (!e.visible || e.type !== 'inner-shadow') continue;
    ctx.save();
    ctx.clip(path, rule(n));
    // A ring around the shape (big rectangle with the shape cut out) whose shadow falls inward.
    const ring = new Path2D();
    const pad = (Math.abs(e.x) + Math.abs(e.y) + e.blur * 2 + 10);
    ring.rect(-pad - n.w, -pad - n.h, n.w * 3 + pad * 2, n.h * 3 + pad * 2);
    ring.addPath(shapePath(n, -(e.spread || 0)));
    const far = FAR / env.scale;
    ctx.shadowColor = rgba(e.color, e.opacity);
    ctx.shadowBlur = e.blur * env.scale;
    ctx.shadowOffsetX = FAR + e.x * env.scale;
    ctx.shadowOffsetY = e.y * env.scale;
    ctx.translate(-far, 0);
    ctx.fillStyle = '#000';
    ctx.fill(ring, 'evenodd');
    ctx.restore();
  }
}

// Frosted glass: what is already drawn behind the shape, blurred, inside the shape.
function backgroundBlur(ctx, n, path, env) {
  const e = n.effects.find(x => x.visible && x.type === 'background-blur');
  if (!e || !env.backdrop || e.radius <= 0) return;
  ctx.save();
  ctx.clip(path, rule(n));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.filter = `blur(${e.radius / 2 * env.scale}px)`;
  ctx.drawImage(ctx.canvas, 0, 0);
  ctx.restore();
}

function strokePath(ctx, n, path) {
  for (const s of n.strokes) {
    if (!s.visible || s.width <= 0) continue;
    ctx.save();
    ctx.strokeStyle = rgba(s.color, s.opacity);
    ctx.lineJoin = 'miter';
    if (s.align === 'center') ctx.lineWidth = s.width;
    else {
      ctx.lineWidth = s.width * 2;
      if (s.align === 'inside') ctx.clip(path, rule(n));
      else {
        const outside = new Path2D();
        const big = s.width * 4 + 10;
        outside.rect(-big, -big, n.w + big * 2, n.h + big * 2);
        outside.addPath(path);
        ctx.clip(outside, 'evenodd');
      }
    }
    ctx.stroke(path);
    ctx.restore();
  }
}

function drawText(ctx, n, env) {
  env.ensureFont?.(n);
  const { lines, lineHeight } = layoutText(n, measurer(n));
  ctx.font = fontString(n);
  ctx.letterSpacing = `${n.letterSpacing}px`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = n.align;
  const x = n.align === 'center' ? n.w / 2 : n.align === 'right' ? n.w : 0;
  if (n.sizing === 'fixed') { ctx.beginPath(); ctx.rect(0, 0, n.w, n.h); ctx.clip(); }
  const each = fn => lines.forEach((line, i) => fn(line, x, i * lineHeight + lineHeight / 2));
  dropShadows(ctx, n, env, () => each((l, lx, ly) => ctx.fillText(l, lx, ly)));
  for (const p of n.fills) {
    if (!p.visible) continue;
    ctx.fillStyle = paintStyle(ctx, p, n);
    each((l, lx, ly) => ctx.fillText(l, lx, ly));
  }
  for (const s of n.strokes) {
    if (!s.visible || s.width <= 0) continue;
    ctx.strokeStyle = rgba(s.color, s.opacity);
    ctx.lineWidth = s.width;
    ctx.lineJoin = 'round';
    each((l, lx, ly) => ctx.strokeText(l, lx, ly));
  }
}

export function drawNode(ctx, n, env) {
  if (!n.visible) return;
  ctx.save();
  ctx.translate(n.x, n.y);
  ctx.globalAlpha *= n.opacity;
  const blur = n.effects.find(e => e.visible && e.type === 'layer-blur');
  if (blur && blur.radius > 0) ctx.filter = `blur(${blur.radius / 2 * env.scale}px)`;

  if (n.type === 'group') {
    for (const c of n.children) drawNode(ctx, c, env);
  } else if (n.type === 'text') {
    if (n.id !== env.skipId) drawText(ctx, n, env);
  } else {
    const path = shapePath(n);
    dropShadows(ctx, n, env);
    backgroundBlur(ctx, n, path, env);
    fillPath(ctx, n, path, env);
    innerShadows(ctx, n, path, env);
    if (n.type === 'frame' && n.children.length) {
      ctx.save();
      if (n.clip) ctx.clip(path, rule(n));
      for (const c of n.children) drawNode(ctx, c, env);
      ctx.restore();
    }
    strokePath(ctx, n, path);
  }
  ctx.restore();
}

// Hit test for vectors (their box can be much bigger than the shape, or a line only 1 px high): inside the filled
// shape, or within `tolerance` of its outline. x, y are relative to the layer.
const hitCtx = document.createElement('canvas').getContext('2d');
export function hitVector(n, x, y, tolerance) {
  const path = shapePath(n);
  if (n.fills.some(p => p.visible) && hitCtx.isPointInPath(path, x, y, rule(n))) return true;
  const stroke = Math.max(0, ...n.strokes.filter(s => s.visible).map(s => s.width));
  hitCtx.lineWidth = stroke + tolerance * 2;
  return hitCtx.isPointInStroke(path, x, y);
}
