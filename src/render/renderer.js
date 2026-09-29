// Draws a page on the editor <canvas>: the design in world space (draw.js), then the editor's overlays in screen
// space: frame names, hover, selection and handles, snap guides, distances and the selection rectangle.
// Nothing is drawn with DOM elements, so thousands of layers stay cheap.
import { absoluteRect } from '../core/document.js';
import { fontString } from '../core/text.js';
import { drawNode } from './draw.js';
import { readyImage } from './images.js';

export { measurer } from './draw.js';
export const SELECT = '#4f8cff';
export const GUIDE = '#f24e6b';
export const HANDLE_SIZE = 8;

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
    ctx.filter = 'none';
    ctx.fillStyle = page.background || '#1e1f23';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const scale = dpr * cam.zoom;
    ctx.setTransform(scale, 0, 0, scale, -cam.x * scale, -cam.y * scale);
    const env = {
      scale, skipId: editor.editingTextId, backdrop: true, ensureFont: n => this.ensureFont(n),
      image: id => readyImage(id, editor.assets.get(id), () => this.request())
    };
    for (const node of page.children) drawNode(ctx, node, env);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawOverlay();
  }

  drawOverlay() {
    const { ctx, editor } = this;
    const index = editor.index, cam = editor.camera;
    const scr = r => ({ x: (r.x - cam.x) * cam.zoom, y: (r.y - cam.y) * cam.zoom, w: r.w * cam.zoom, h: r.h * cam.zoom });
    const pt = (x, y) => ({ x: (x - cam.x) * cam.zoom, y: (y - cam.y) * cam.zoom });
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

    const outline = (r, width = 1, dash) => {
      ctx.lineWidth = width; ctx.strokeStyle = SELECT; ctx.setLineDash(dash || []);
      ctx.strokeRect(Math.round(r.x) + .5, Math.round(r.y) + .5, Math.round(r.w), Math.round(r.h));
      ctx.setLineDash([]);
    };
    const outlineNode = (id, width) => {
      const node = index.get(id).node, r = scr(absoluteRect(index, id));
      if (node.type === 'ellipse') {
        ctx.lineWidth = width; ctx.strokeStyle = SELECT;
        ctx.beginPath(); ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.max(0, r.w / 2), Math.max(0, r.h / 2), 0, 0, Math.PI * 2); ctx.stroke();
      } else outline(r, width, node.type === 'group' ? [4, 3] : null);
    };
    const drag = editor.drag;
    if (editor.hoverId && !selected.has(editor.hoverId) && index.has(editor.hoverId)) outlineNode(editor.hoverId, 1.5);
    for (const id of editor.selection) if (index.has(id)) outlineNode(id, 1);

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
      if (!editor.measures.length) pill(ctx, `${round(box.w)} × ${round(box.h)}`, r.x + r.w / 2, r.y + r.h + 17, SELECT);
    }

    // Snap guides: thin lines with a small cross at each end.
    ctx.strokeStyle = GUIDE; ctx.lineWidth = 1;
    for (const g of editor.guides) {
      const a = g.axis === 'x' ? pt(g.value, g.from) : pt(g.from, g.value);
      const b = g.axis === 'x' ? pt(g.value, g.to) : pt(g.to, g.value);
      ctx.beginPath();
      if (g.axis === 'x') { const x = Math.round(a.x) + .5; ctx.moveTo(x, a.y); ctx.lineTo(x, b.y); }
      else { const y = Math.round(a.y) + .5; ctx.moveTo(a.x, y); ctx.lineTo(b.x, y); }
      ctx.stroke();
      for (const p of [a, b]) { ctx.beginPath(); ctx.moveTo(p.x - 3, p.y - 3); ctx.lineTo(p.x + 3, p.y + 3); ctx.moveTo(p.x + 3, p.y - 3); ctx.lineTo(p.x - 3, p.y + 3); ctx.stroke(); }
    }
    // Distances: a line between the two edges with the number in the middle.
    for (const m of editor.measures) {
      if (m.value < 0.5) continue;
      const a = pt(m.x1, m.y1), b = pt(m.x2, m.y2);
      ctx.strokeStyle = GUIDE; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(a.x) + .5, Math.round(a.y) + .5); ctx.lineTo(Math.round(b.x) + .5, Math.round(b.y) + .5); ctx.stroke();
      const vertical = Math.abs(a.x - b.x) < 1;
      for (const p of [a, b]) {
        ctx.beginPath();
        if (vertical) { ctx.moveTo(p.x - 3, Math.round(p.y) + .5); ctx.lineTo(p.x + 3, Math.round(p.y) + .5); }
        else { ctx.moveTo(Math.round(p.x) + .5, p.y - 3); ctx.lineTo(Math.round(p.x) + .5, p.y + 3); }
        ctx.stroke();
      }
      pill(ctx, String(round(m.value)), (a.x + b.x) / 2, (a.y + b.y) / 2, GUIDE);
    }

    // Where a layer dragged into an auto layout frame will go.
    if (drag?.dropLine) {
      const a = pt(drag.dropLine.x1, drag.dropLine.y1), b = pt(drag.dropLine.x2, drag.dropLine.y2);
      ctx.strokeStyle = SELECT; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.lineCap = 'butt';
    }

    if (drag?.kind === 'marquee' && drag.rect) {
      const r = scr(drag.rect);
      ctx.fillStyle = 'rgba(79,140,255,.08)'; ctx.fillRect(r.x, r.y, r.w, r.h);
      outline(r);
    }
  }
}

function pill(ctx, label, cx, cy, color) {
  ctx.font = '600 11px "Google Sans Flex", system-ui, sans-serif';
  const w = ctx.measureText(label).width + 10;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(Math.round(cx - w / 2), Math.round(cy - 9), w, 18, 4); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy + .5);
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
}

// Screen positions of the eight resize handles of a screen rectangle.
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
