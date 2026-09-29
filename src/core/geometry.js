// Camera and rectangle math for the canvas. screen = (world - camera) * zoom.

export const MIN_ZOOM = 0.05, MAX_ZOOM = 32;
export const clampZoom = z => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export const toWorld = (cam, p) => ({ x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y });
export const toScreen = (cam, p) => ({ x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom });

// Zooms so the world point under the screen point `at` stays under it.
export function zoomAt(cam, at, zoom) {
  zoom = clampZoom(zoom);
  const w = toWorld(cam, at);
  return { zoom, x: w.x - at.x / zoom, y: w.y - at.y / zoom };
}

// Fits a world rectangle in a viewport of vw × vh with some margin; never zooms in past 100% unless asked.
export function fitRect(rect, vw, vh, { margin = 64, maxZoom = 1 } = {}) {
  const zoom = clampZoom(Math.min((vw - margin * 2) / Math.max(rect.w, 1), (vh - margin * 2) / Math.max(rect.h, 1), maxZoom));
  return { zoom, x: rect.x + rect.w / 2 - vw / 2 / zoom, y: rect.y + rect.h / 2 - vh / 2 / zoom };
}

export const pointInRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
export function pointInEllipse(p, r) {
  const rx = r.w / 2, ry = r.h / 2;
  if (rx <= 0 || ry <= 0) return false;
  const dx = (p.x - r.x - rx) / rx, dy = (p.y - r.y - ry) / ry;
  return dx * dx + dy * dy <= 1;
}
export const intersects = (a, b) => a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
export const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

// A rectangle from two corner points (any order).
export function rectFromPoints(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

// The rectangle after dragging `handle` (n, ne, e, … as compass points) by dx/dy.
// keepRatio (Shift) keeps the width/height ratio, fromCenter (Alt) resizes around the middle.
export function resizeRect(rect, handle, dx, dy, { keepRatio = false, fromCenter = false, min = 1 } = {}) {
  const hasW = handle.includes('w'), hasE = handle.includes('e'), hasN = handle.includes('n'), hasS = handle.includes('s');
  const k = fromCenter ? 2 : 1;
  let w = rect.w + (hasE ? dx * k : hasW ? -dx * k : 0);
  let h = rect.h + (hasS ? dy * k : hasN ? -dy * k : 0);
  if (keepRatio && rect.w > 0 && rect.h > 0) {
    const ratio = rect.w / rect.h;
    if ((hasE || hasW) && (hasN || hasS)) {
      // Corner: follow whichever side moved relatively more.
      if (Math.abs(w / rect.w - 1) > Math.abs(h / rect.h - 1)) h = w / ratio; else w = h * ratio;
    } else if (hasE || hasW) h = w / ratio;
    else w = h * ratio;
  }
  w = Math.max(min, w); h = Math.max(min, h);
  let x, y;
  if (fromCenter) { x = rect.x + (rect.w - w) / 2; y = rect.y + (rect.h - h) / 2; }
  else {
    x = hasW ? rect.x + rect.w - w : (keepRatio && !hasE && (hasN || hasS)) ? rect.x + (rect.w - w) / 2 : rect.x;
    y = hasN ? rect.y + rect.h - h : (keepRatio && !hasS && (hasE || hasW)) ? rect.y + (rect.h - h) / 2 : rect.y;
  }
  return { x, y, w, h };
}

// Where `r` lands when the box `from` is stretched into `to` (resizing several layers at once).
export function mapRect(r, from, to) {
  const sx = from.w ? to.w / from.w : 1, sy = from.h ? to.h / from.h : 1;
  return { x: to.x + (r.x - from.x) * sx, y: to.y + (r.y - from.y) * sy, w: r.w * sx, h: r.h * sy };
}
