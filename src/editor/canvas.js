// Mouse and trackpad on the canvas: select, drag, resize, draw new layers, pan and zoom. Every drag is one undo step.
import { absolute, absoluteRect, boundsOf, childrenOf, reparent, topLevelOnly } from '../core/document.js';
import { mapRect, rectFromPoints, resizeRect, toWorld } from '../core/geometry.js';
import { gaps, guidesForBox, measureBetween, snapMove, snapValue } from '../core/snap.js';
import { HANDLE_SIZE, handlePoints } from '../render/renderer.js';

const DRAG_START = 3; // px on screen before a press becomes a drag
const cursors = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
const defaultSize = { frame: 100, rect: 100, ellipse: 100 };
const SNAP = 6; // px on screen

// What a layer inside `parent` (null = the page) snaps to: the other layers next to it, and the frames around it.
function snapContext(editor, parent, exclude) {
  const index = editor.index;
  const skip = new Set(exclude);
  const siblings = childrenOf(editor.page, parent).filter(n => n.visible && !skip.has(n.id)).map(n => absoluteRect(index, n.id));
  const around = [];
  for (let p = parent; p; p = index.get(p.id)?.parent) around.push(absoluteRect(index, p.id));
  return { siblings, parentRect: around[0] || null, targets: [...siblings, ...around] };
}

// Scales everything inside a group along with it (a frame's content keeps its size; constraints come later).
function scaleChildren(target, source, sx, sy) {
  target.children?.forEach((c, i) => {
    const o = source.children[i];
    Object.assign(c, { x: +(o.x * sx).toFixed(2), y: +(o.y * sy).toFixed(2), w: Math.max(1, +(o.w * sx).toFixed(2)), h: Math.max(1, +(o.h * sy).toFixed(2)) });
    if (c.type === 'text') c.sizing = 'fixed';
    if (c.children) scaleChildren(c, o, sx, sy);
  });
}

export function attachCanvas(canvas, editor, renderer, { onContextMenu } = {}) {
  const local = e => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  const world = p => toWorld(editor.camera, p);
  let spaceDown = false;

  const handleAt = screen => {
    if (editor.tool !== 'move' || !editor.selection.length || editor.editingTextId) return null;
    const box = editor.selectionBounds();
    if (!box) return null;
    const cam = editor.camera;
    const r = { x: (box.x - cam.x) * cam.zoom, y: (box.y - cam.y) * cam.zoom, w: box.w * cam.zoom, h: box.h * cam.zoom };
    const reach = HANDLE_SIZE / 2 + 3;
    // Small layers: only the corners, so the layer itself stays grabbable.
    const points = handlePoints(r).filter(h => (r.w > 24 && r.h > 24) || h.id.length === 2);
    return points.find(h => Math.abs(h.x - screen.x) <= reach && Math.abs(h.y - screen.y) <= reach)?.id || null;
  };

  function setCursor(screen) {
    if (editor.drag?.kind === 'pan') return (canvas.style.cursor = 'grabbing');
    if (spaceDown) return (canvas.style.cursor = 'grab');
    if (editor.tool === 'text') return (canvas.style.cursor = 'text');
    if (editor.tool !== 'move') return (canvas.style.cursor = 'crosshair');
    const h = screen && handleAt(screen);
    canvas.style.cursor = h ? cursors[h] : 'default';
  }

  canvas.addEventListener('pointerdown', e => {
    if (!editor.page) return;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    const screen = local(e), at = world(screen);
    if (editor.editingTextId) editor.stopEditingText();

    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      editor.drag = { kind: 'pan', startScreen: screen, cam: { ...editor.camera } };
      return setCursor(screen);
    }
    if (e.button !== 0) return;

    if (editor.tool !== 'move') {
      const parent = editor.frameAt(at);
      const snap = snapContext(editor, parent, []);
      const th = SNAP / editor.camera.zoom;
      const start = e.ctrlKey ? at : { x: snapValue(at.x, 'x', snap.targets, th), y: snapValue(at.y, 'y', snap.targets, th) };
      editor.drag = { kind: 'create', type: editor.tool, startScreen: screen, start, parent, node: null, snap };
      return;
    }

    const handle = handleAt(screen);
    if (handle) {
      const index = editor.index;
      const ids = topLevelOnly(index, editor.selection);
      editor.drag = {
        kind: 'resize', handle, startScreen: screen, start: at, box: editor.selectionBounds(), started: false,
        items: ids.map(id => ({
          id, abs: absoluteRect(index, id), origin: index.get(id).parent ? absolute(index, index.get(id).parent.id) : { x: 0, y: 0 },
          start: index.get(id).node.type === 'group' ? structuredClone(index.get(id).node) : null
        })),
        snap: snapContext(editor, index.get(ids[0]).parent, ids)
      };
      return;
    }

    const add = e.shiftKey;
    let id = editor.frameLabelAt(screen) || editor.pick(at, { deep: e.ctrlKey || e.metaKey });
    const box = editor.selectionBounds();
    const inSelection = editor.selection.length > 1 && box && at.x >= box.x && at.x <= box.x + box.w && at.y >= box.y && at.y <= box.y + box.h;
    if (inSelection && (!id || editor.selection.includes(id)) && !add) {
      editor.drag = { kind: 'move', startScreen: screen, start: at, clicked: id, moved: false, alt: e.altKey };
      return;
    }
    if (id) {
      if (add) editor.select([id], { toggle: true });
      else if (!editor.selection.includes(id)) editor.select([id]);
      editor.drag = { kind: 'move', startScreen: screen, start: at, clicked: null, moved: false, alt: e.altKey };
      return;
    }
    if (!add) editor.clearSelection();
    editor.drag = { kind: 'marquee', startScreen: screen, start: at, base: add ? [...editor.selection] : [], rect: null };
  });

  canvas.addEventListener('pointermove', e => {
    const screen = local(e), at = world(screen);
    const drag = editor.drag;
    if (!drag) {
      const hover = editor.tool === 'move' && !spaceDown ? (editor.frameLabelAt(screen) || editor.pick(at, { deep: e.ctrlKey || e.metaKey })) : null;
      if (hover !== editor.hoverId) { editor.hoverId = hover; renderer.request(); }
      // Alt + hover: how far the selection is from the layer under the cursor.
      const box = e.altKey && hover && !editor.selection.includes(hover) ? editor.selectionBounds() : null;
      const measures = box ? measureBetween(box, absoluteRect(editor.index, hover)) : [];
      if (measures.length || editor.measures.length) { editor.measures = measures; renderer.request(); }
      return setCursor(screen);
    }
    const far = Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y) >= DRAG_START;
    let dx = at.x - (drag.start?.x ?? 0), dy = at.y - (drag.start?.y ?? 0);

    if (drag.kind === 'pan') {
      const cam = drag.cam;
      editor.camera = { ...cam, x: cam.x - (screen.x - drag.startScreen.x) / cam.zoom, y: cam.y - (screen.y - drag.startScreen.y) / cam.zoom };
      return;
    }

    if (drag.kind === 'move') {
      if (!drag.moved) {
        if (!far) return;
        editor.begin();
        // Alt + drag leaves the originals where they are and moves copies.
        if (drag.alt) editor.duplicateSelection({ x: 0, y: 0 }, { transaction: false });
        drag.ids = topLevelOnly(editor.index, editor.selection);
        drag.starts = drag.ids.map(id => { const n = editor.node(id); return { x: n.x, y: n.y }; });
        drag.box = boundsOf(drag.ids.map(id => absoluteRect(editor.index, id)));
        drag.snap = snapContext(editor, editor.index.get(drag.ids[0]).parent, drag.ids);
        drag.moved = true; editor.hoverId = null;
      }
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      // Snapping to the layers around (hold Ctrl to place freely), and the distances to them.
      editor.guides = [];
      if (!(e.ctrlKey || e.metaKey)) {
        const snapped = snapMove({ ...drag.box, x: drag.box.x + dx, y: drag.box.y + dy }, drag.snap.targets, SNAP / editor.camera.zoom);
        if (!e.shiftKey || dx) dx += snapped.dx;
        if (!e.shiftKey || dy) dy += snapped.dy;
        editor.guides = snapped.guides;
      }
      const moved = { ...drag.box, x: Math.round(drag.box.x + dx), y: Math.round(drag.box.y + dy) };
      editor.measures = gaps(moved, drag.snap.siblings, drag.snap.parentRect);
      drag.ids.forEach((id, i) => { const n = editor.node(id); n.x = Math.round(drag.starts[i].x + dx); n.y = Math.round(drag.starts[i].y + dy); });
      drag.last = at;
      editor.emit({ doc: true });
      return;
    }

    if (drag.kind === 'resize') {
      if (!drag.started) { if (!far) return; editor.begin(); drag.started = true; }
      // The edges being dragged snap to the layers around.
      const b = drag.box, h = drag.handle, th = SNAP / editor.camera.zoom, targets = drag.snap.targets;
      if (!(e.ctrlKey || e.metaKey)) {
        if (h.includes('e')) dx = snapValue(b.x + b.w + dx, 'x', targets, th) - b.x - b.w;
        if (h.includes('w')) dx = snapValue(b.x + dx, 'x', targets, th) - b.x;
        if (h.includes('s')) dy = snapValue(b.y + b.h + dy, 'y', targets, th) - b.y - b.h;
        if (h.includes('n')) dy = snapValue(b.y + dy, 'y', targets, th) - b.y;
      }
      const next = resizeRect(drag.box, drag.handle, dx, dy, { keepRatio: e.shiftKey, fromCenter: e.altKey });
      editor.guides = e.ctrlKey || e.metaKey ? [] : guidesForBox(next, targets);
      const sideOnly = drag.handle.length === 1 && (drag.handle === 'e' || drag.handle === 'w');
      for (const item of drag.items) {
        const r = drag.items.length === 1 ? next : mapRect(item.abs, drag.box, next);
        const n = editor.node(item.id);
        Object.assign(n, { x: Math.round(r.x - item.origin.x), y: Math.round(r.y - item.origin.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) });
        if (n.type === 'text') { n.sizing = sideOnly && drag.items.length === 1 ? 'auto-height' : 'fixed'; editor.fit(n); }
        if (item.start) scaleChildren(n, item.start, n.w / item.start.w, n.h / item.start.h);
      }
      editor.emit({ doc: true });
      return;
    }

    if (drag.kind === 'create') {
      if (!drag.node) {
        if (!far) return;
        editor.begin();
        const props = drag.type === 'text' ? { sizing: 'auto-height' } : {};
        drag.node = editor.addNode(drag.type, { x: Math.round(drag.start.x), y: Math.round(drag.start.y), w: 1, h: 1, ...props }, drag.parent);
        editor.selection = [drag.node.id];
        editor.emit({ selection: true });
      }
      let a = drag.start, b = at;
      if (!(e.ctrlKey || e.metaKey)) {
        const th = SNAP / editor.camera.zoom;
        b = { x: snapValue(b.x, 'x', drag.snap.targets, th), y: snapValue(b.y, 'y', drag.snap.targets, th) };
      }
      if (e.shiftKey) {
        const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        b = { x: a.x + Math.sign(b.x - a.x || 1) * side, y: a.y + Math.sign(b.y - a.y || 1) * side };
      }
      if (e.altKey) a = { x: 2 * a.x - b.x, y: 2 * a.y - b.y };
      const r = rectFromPoints(a, b);
      const origin = drag.parent ? absolute(editor.index, drag.parent.id) : { x: 0, y: 0 };
      Object.assign(drag.node, { x: Math.round(r.x - origin.x), y: Math.round(r.y - origin.y), w: Math.max(1, Math.round(r.w)) });
      if (drag.type === 'text') editor.fit(drag.node); else drag.node.h = Math.max(1, Math.round(r.h));
      editor.emit({ doc: true });
      return;
    }

    if (drag.kind === 'marquee') {
      if (!far && !drag.rect) return;
      drag.rect = rectFromPoints(drag.start, at);
      const hits = marqueeHits(editor, drag.rect);
      editor.select([...drag.base, ...hits.filter(id => !drag.base.includes(id))]);
      renderer.request();
    }
  });

  const finish = e => {
    const drag = editor.drag;
    if (!drag) return;
    editor.drag = null;
    editor.guides = []; editor.measures = [];
    const screen = local(e), at = world(screen);

    if (drag.kind === 'move') {
      if (drag.moved) {
        // Dropped over another frame (or out of its own): the layers move into it, staying where they are.
        const target = editor.frameAt(drag.last || at, drag.ids);
        // Layers inside a group stay in it (take them out in the layers panel or with Ctrl+Shift+G).
        for (const id of drag.ids) {
          const parent = editor.index.get(id)?.parent || null;
          if (parent?.type === 'group') continue;
          if ((parent?.id ?? null) !== (target?.id ?? null)) { reparent(editor.page, editor.index, id, target); editor.emit({ doc: true }); }
        }
        editor.commit();
        editor.emit({ doc: true, selection: true });
      } else if (drag.clicked) editor.select([drag.clicked]);
    } else if (drag.kind === 'resize') {
      if (drag.started) { editor.commit(); editor.emit({ doc: true }); }
    } else if (drag.kind === 'create') {
      if (!drag.node) {
        // A click without dragging: a layer of a default size at that spot (text: an empty text to type in).
        editor.begin();
        const size = defaultSize[drag.type];
        const props = drag.type === 'text'
          ? { x: Math.round(drag.start.x), y: Math.round(drag.start.y - 10), sizing: 'auto-width' }
          : { x: Math.round(drag.start.x), y: Math.round(drag.start.y), w: size, h: size };
        drag.node = editor.addNode(drag.type, props, drag.parent);
        editor.selection = [drag.node.id];
      }
      editor.setTool('move');
      if (drag.type === 'text') editor.startEditingText(drag.node.id);
      else { editor.commit(); editor.emit({ doc: true, selection: true }); }
    }
    renderer.request();
    setCursor(screen);
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('pointerleave', () => { if (!editor.drag && editor.hoverId) { editor.hoverId = null; renderer.request(); } });

  canvas.addEventListener('dblclick', e => {
    if (editor.tool !== 'move') return;
    const at = world(local(e));
    const [sel] = editor.selectedNodes;
    if (sel?.type === 'text') return editor.startEditingText(sel.id);
    // Double-click goes one level deeper into the selected layer.
    const path = editor.hitPath(at);
    const i = path.findIndex(n => n.id === sel?.id);
    const next = i >= 0 ? path[i + 1] : path.at(-1);
    if (next) { editor.select([next.id]); if (next.type === 'text' && i >= 0 && i === path.length - 2) editor.startEditingText(next.id); }
  });

  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (editor.tool !== 'move' || !onContextMenu) return;
    const screen = local(e);
    const id = editor.frameLabelAt(screen) || editor.pick(world(screen), { deep: e.ctrlKey });
    if (id && !editor.selection.includes(id)) editor.select([id]);
    onContextMenu({ x: e.clientX, y: e.clientY });
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const screen = local(e);
    if (e.ctrlKey || e.metaKey) {
      // Mouse wheel steps and trackpad pinches (which arrive as Ctrl + wheel) both zoom around the cursor.
      editor.zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), screen);
    } else {
      const cam = editor.camera, k = e.deltaMode === 1 ? 20 : 1;
      const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k, dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
      editor.camera = { ...cam, x: cam.x + dx / cam.zoom, y: cam.y + dy / cam.zoom };
    }
  }, { passive: false });

  return {
    setSpace(down) { if (spaceDown !== down) { spaceDown = down; setCursor(null); } },
    get spaceDown() { return spaceDown; },
    refreshCursor: () => setCursor(null)
  };
}

// Layers touched by the selection rectangle: top-level layers, and inside top-level frames their direct children
// (dragging over a frame's content selects the content, not the frame, unless the frame is entirely inside).
function marqueeHits(editor, rect) {
  const index = editor.index;
  const hits = [];
  const touches = r => r.x < rect.x + rect.w && r.x + r.w > rect.x && r.y < rect.y + rect.h && r.y + r.h > rect.y;
  const inside = r => r.x >= rect.x && r.y >= rect.y && r.x + r.w <= rect.x + rect.w && r.y + r.h <= rect.y + rect.h;
  for (const n of editor.page.children) {
    if (!n.visible || n.locked) continue;
    const r = absoluteRect(index, n.id);
    if (n.type === 'frame' && n.children.length && !inside(r)) {
      for (const c of n.children) if (c.visible && !c.locked && touches(absoluteRect(index, c.id))) hits.push(c.id);
    } else if (touches(r)) hits.push(n.id);
  }
  return hits;
}
