// Typing in a text layer: a transparent <textarea> placed exactly over the layer, styled like it at the current zoom.
// The canvas skips drawing that layer meanwhile. Escape or clicking elsewhere finishes; an empty text is removed.
import { absolute } from '../core/document.js';

export function attachTextEditor(host, editor) {
  const area = document.createElement('textarea');
  area.className = 'text-edit';
  area.spellcheck = false;
  area.hidden = true;
  host.append(area);
  let id = null;

  function place() {
    const node = id && editor.node(id);
    if (!node) return;
    const cam = editor.camera, z = cam.zoom, abs = absolute(editor.index, id);
    Object.assign(area.style, {
      left: `${(abs.x - cam.x) * z}px`, top: `${(abs.y - cam.y) * z}px`,
      width: node.sizing === 'auto-width' ? `${Math.max(node.w, 2) * z + 4}px` : `${node.w * z}px`,
      height: `${Math.max(node.h, node.fontSize * node.lineHeight) * z}px`,
      font: `${node.fontWeight} ${node.fontSize * z}px "${node.fontFamily}", system-ui, sans-serif`,
      lineHeight: `${node.fontSize * node.lineHeight * z}px`, letterSpacing: `${node.letterSpacing * z}px`,
      textAlign: node.align, color: node.fill, opacity: node.opacity,
      whiteSpace: node.sizing === 'auto-width' ? 'pre' : 'pre-wrap'
    });
  }

  area.addEventListener('input', () => { editor.setProps([id], { text: area.value }); place(); });
  area.addEventListener('keydown', e => {
    e.stopPropagation(); // typing is not a shortcut
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); editor.stopEditingText(); }
  });
  area.addEventListener('blur', () => { if (id && editor.editingTextId === id) editor.stopEditingText(); });

  editor.addEventListener('change', ({ what }) => {
    if (what.editing) {
      const next = editor.editingTextId;
      if (next && next !== id) {
        id = next;
        area.value = editor.node(id).text;
        area.hidden = false;
        place();
        area.focus(); area.select();
      } else if (!next && id) {
        id = null; area.hidden = true;
      }
    } else if (id && (what.camera || what.doc)) place();
  });
}
