// Draws a page on a <canvas>: the design in world space, then the editor's overlays (frame names, hover, selection,
// handles, marquee) in screen space. Nothing is drawn with DOM elements, so thousands of layers stay cheap.
import { absoluteRect } from '../core/document.js';
import { fontString, layoutText } from '../core/text.js';

export const SELECT = '#4f8cff';
export const HANDLE_SIZE = 8;

const measureCtx = document.createElement('canvas').getContext('2d');
// measure(node) → string → width, for layoutText / fitTextSize.
export function measurer(node) {
  measureCtx.font = fontString(node);
  measureCtx.letterSpacing = `${node.letterSpacing}px`;
  return s => measureCtx.measureText(s).width;
}

export class Renderer {
  constructor(canvas, editor) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.editor = editor;
    this.queued = false; this.loading = new Set();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  get width() { return this.canvas.clientWidth; }
  get height() { return this.canvas.clientHeight; }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(this.width * dpr));
    this.canvas.height = Math.max(1, Math.round(this.height * dpr));
    this.draw();
  }

  request() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => { this.queued = false; this.draw(); });
  }

  // Fonts that aren't loaded yet draw in a fallback; load them and draw (and size the text) again.
  ensureFont(node) {
    const font = fontString(node);
    if (this.loading.has(font) || document.fonts.check(font)) return;
    this.loading.add(font);
    document.fonts.load(font).then(() => { this.loading.delete(font); this.editor.refitText(); this.request(); }, () => this.loading.delete(font));
  }

  draw() {
    const { ctx, editor } = this;
    const page = editor.page;
    if (!page) return;
    const dpr = window.devicePixelRatio || 1, cam = editor.camera;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = page.background || '#1e1f23';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, -cam.x * dpr * cam.zoom, -cam.y * dpr * cam.zoom);
    for (const node of page.children) this.drawNode(node);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawOverlay();
  }

  drawNode(node) {
    if (!node.visible) return;
    const { ctx } = this;
    ctx.save();
    ctx.translate(node.x, node.y);
    ctx.globalAlpha *= node.opacity;
    ctx.fillStyle = node.fill;
    if (node.type === 'frame' || node.type === 'rect') {
      ctx.beginPath();
      ctx.roundRect(0, 0, node.w, node.h, Math.min(node.radius || 0, node.w / 2, node.h / 2));
      ctx.fill();
      if (node.type === 'frame') {
        if (node.clip) ctx.clip();
        for (const child of node.children) this.drawNode(child);
      }
    } else if (node.type === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(node.w / 2, node.h / 2, node.w / 2, node.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (node.type === 'text' && node.id !== this.editor.editingTextId) {
      this.ensureFont(node);
      const { lines, lineHeight } = layoutText(node, measurer(node));
      ctx.font = fontString(node);
      ctx.letterSpacing = `${node.letterSpacing}px`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = node.align;
      const x = node.align === 'center' ? node.w / 2 : node.align === 'right' ? node.w : 0;
      if (node.sizing === 'fixed') { ctx.beginPath(); ctx.rect(0, 0, node.w, node.h); ctx.clip(); }
      lines.forEach((line, i) => ctx.fillText(line, x, i * lineHeight + lineHeight / 2));
    }
    ctx.restore();
  }

  drawOverlay() {
    const { ctx, editor } = this;
    const index = editor.index, cam = editor.camera;
    const scr = r => ({ x: (r.x - cam.x) * cam.zoom, y: (r.y - cam.y) * cam.zoom, w: r.w * cam.zoom, h: r.h * cam.zoom });
    const selected = new Set(editor.selection);
    ctx.font = '500 11px "Google Sans Flex", system-ui, sans-serif';
    ctx.textBaseline = 'bottom'; ctx.textAlign = 'left'; ctx.letterSpacing = '0px';

    // Names above top-level frames (click them to select the frame).
    for (const node of editor.page.children) {
      if (node.type !== 'frame' || !node.visible) continue;
      const r = scr(node);
      ctx.fillStyle = selected.has(node.id) ? SELECT : node.id === editor.hoverId ? '#c9cbd2' : '#8b8e97';
      ctx.fillText(fitLabel(ctx, node.name, Math.max(r.w, 40)), r.x, r.y - 4);
    }

    const outline = (r, width = 1) => { ctx.lineWidth = width; ctx.strokeStyle = SELECT; ctx.strokeRect(Math.round(r.x) + .5, Math.round(r.y) + .5, Math.round(r.w), Math.round(r.h)); };
    if (editor.hoverId && !selected.has(editor.hoverId) && index.has(editor.hoverId)) {
      const node = index.get(editor.hoverId).node;
      const r = scr(absoluteRect(index, node.id));
      if (node.type === 'ellipse') this.ellipseOutline(r); else outline(r, 1.5);
    }
    const drag = editor.drag;
    for (const id of editor.selection) if (index.has(id)) outline(scr(absoluteRect(index, id)));

    const box = editor.selectionBounds();
    if (box && !editor.editingTextId) {
      const r = scr(box);
      if (editor.selection.length > 1) outline(r);
      if (!drag || drag.kind !== 'pan') {
        ctx.fillStyle = '#fff'; ctx.strokeStyle = SELECT; ctx.lineWidth = 1;
        for (const h of handlePoints(r)) {
          ctx.fillRect(Math.round(h.x - HANDLE_SIZE / 2) + .5, Math.round(h.y - HANDLE_SIZE / 2) + .5, HANDLE_SIZE - 1, HANDLE_SIZE - 1);
          ctx.strokeRect(Math.round(h.x - HANDLE_SIZE / 2) + .5, Math.round(h.y - HANDLE_SIZE / 2) + .5, HANDLE_SIZE - 1, HANDLE_SIZE - 1);
        }
      }
      // Size label under the selection.
      const label = `${round(box.w)} × ${round(box.h)}`;
      ctx.font = '600 11px "Google Sans Flex", system-ui, sans-serif';
      const tw = ctx.measureText(label).width + 12;
      const lx = r.x + r.w / 2 - tw / 2, ly = r.y + r.h + 8;
      ctx.fillStyle = SELECT;
      ctx.beginPath(); ctx.roundRect(lx, ly, tw, 18, 4); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, lx + tw / 2, ly + 9.5);
    }

    if (drag?.kind === 'marquee' && drag.rect) {
      const r = scr(drag.rect);
      ctx.fillStyle = 'rgba(79,140,255,.08)'; ctx.fillRect(r.x, r.y, r.w, r.h);
      outline(r);
    }
  }

  ellipseOutline(r) {
    const { ctx } = this;
    ctx.lineWidth = 1.5; ctx.strokeStyle = SELECT;
    ctx.beginPath(); ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.max(0, r.w / 2), Math.max(0, r.h / 2), 0, 0, Math.PI * 2); ctx.stroke();
  }
}

// Screen positions of the eight resize handles of a screen rectangle, in the order of HANDLES.
export function handlePoints(r) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, R = r.x + r.w, B = r.y + r.h;
  return [
    { id: 'nw', x: r.x, y: r.y }, { id: 'n', x: cx, y: r.y }, { id: 'ne', x: R, y: r.y }, { id: 'e', x: R, y: cy },
    { id: 'se', x: R, y: B }, { id: 's', x: cx, y: B }, { id: 'sw', x: r.x, y: B }, { id: 'w', x: r.x, y: cy }
  ];
}

const round = v => Math.round(v * 100) / 100;
function fitLabel(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}
