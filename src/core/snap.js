// Snapping and distances, all in world coordinates on plain rectangles.
// A snap target contributes its left edge, centre and right edge (x) and top, middle and bottom (y).

const xs = r => [r.x, r.x + r.w / 2, r.x + r.w];
const ys = r => [r.y, r.y + r.h / 2, r.y + r.h];

// The smallest correction (within threshold) that makes one of `points` land on one of `lines`; null if none.
function nearest(points, lines, threshold) {
  let best = null;
  for (const p of points) for (const l of lines) {
    const d = l - p;
    if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  }
  return best;
}

// Guides for the lines a box now touches: one per matched value, spanning the box and every target on that line.
function guidesFor(box, targets) {
  const guides = [];
  for (const axis of ['x', 'y']) {
    const own = axis === 'x' ? xs(box) : ys(box);
    for (const v of own) {
      const hits = targets.filter(t => (axis === 'x' ? xs(t) : ys(t)).some(l => Math.abs(l - v) < 0.5));
      if (!hits.length || guides.some(g => g.axis === axis && Math.abs(g.value - v) < 0.5)) continue;
      const all = [box, ...hits];
      const from = Math.min(...all.map(r => axis === 'x' ? r.y : r.x));
      const to = Math.max(...all.map(r => axis === 'x' ? r.y + r.h : r.x + r.w));
      guides.push({ axis, value: v, from, to });
    }
  }
  return guides;
}

// Moving a box: returns the corrected offset and the guides to draw.
export function snapMove(box, targets, threshold) {
  const dx = nearest(xs(box), targets.flatMap(xs), threshold) ?? 0;
  const dy = nearest(ys(box), targets.flatMap(ys), threshold) ?? 0;
  const moved = { ...box, x: box.x + dx, y: box.y + dy };
  return { dx, dy, guides: guidesFor(moved, targets) };
}

// Resizing or drawing: one edge value on one axis. Returns the snapped value (or the value itself).
export function snapValue(value, axis, targets, threshold) {
  const d = nearest([value], targets.flatMap(axis === 'x' ? xs : ys), threshold);
  return d === null ? value : value + d;
}
export const guidesForBox = guidesFor;

// Distance lines from a box to its nearest neighbour on each side (neighbours overlapping it on the other axis),
// or to the inside of its parent frame when there is no neighbour on that side.
export function gaps(box, others, parent = null) {
  const out = [];
  const overlapY = r => r.y < box.y + box.h && r.y + r.h > box.y;
  const overlapX = r => r.x < box.x + box.w && r.x + r.w > box.x;
  const midY = r => (Math.max(box.y, r.y) + Math.min(box.y + box.h, r.y + r.h)) / 2;
  const midX = r => (Math.max(box.x, r.x) + Math.min(box.x + box.w, r.x + r.w)) / 2;
  const pick = (list, dist) => list.map(r => ({ r, d: dist(r) })).filter(e => e.d > 0).sort((a, b) => a.d - b.d)[0];

  const left = pick(others.filter(overlapY), r => box.x - (r.x + r.w));
  const right = pick(others.filter(overlapY), r => r.x - (box.x + box.w));
  const top = pick(others.filter(overlapX), r => box.y - (r.y + r.h));
  const bottom = pick(others.filter(overlapX), r => r.y - (box.y + box.h));
  const cy = box.y + box.h / 2, cx = box.x + box.w / 2;

  // To the parent: its nearest edge on that side, the far one when the box has moved out past the parent.
  const R = box.x + box.w, B = box.y + box.h;
  if (left) out.push({ x1: left.r.x + left.r.w, y1: midY(left.r), x2: box.x, y2: midY(left.r), value: left.d });
  else if (parent && box.x > parent.x) {
    const edge = box.x >= parent.x + parent.w ? parent.x + parent.w : parent.x;
    out.push({ x1: edge, y1: cy, x2: box.x, y2: cy, value: box.x - edge });
  }
  if (right) out.push({ x1: R, y1: midY(right.r), x2: right.r.x, y2: midY(right.r), value: right.d });
  else if (parent && parent.x + parent.w > R) {
    const edge = R <= parent.x ? parent.x : parent.x + parent.w;
    out.push({ x1: R, y1: cy, x2: edge, y2: cy, value: edge - R });
  }
  if (top) out.push({ x1: midX(top.r), y1: top.r.y + top.r.h, x2: midX(top.r), y2: box.y, value: top.d });
  else if (parent && box.y > parent.y) {
    const edge = box.y >= parent.y + parent.h ? parent.y + parent.h : parent.y;
    out.push({ x1: cx, y1: edge, x2: cx, y2: box.y, value: box.y - edge });
  }
  if (bottom) out.push({ x1: midX(bottom.r), y1: B, x2: midX(bottom.r), y2: bottom.r.y, value: bottom.d });
  else if (parent && parent.y + parent.h > B) {
    const edge = B <= parent.y ? parent.y : parent.y + parent.h;
    out.push({ x1: cx, y1: B, x2: cx, y2: edge, value: edge - B });
  }
  return out;
}

// Alt + hover: distances between the selection `a` and another layer `b`. Inside it: to its four edges.
export function measureBetween(a, b) {
  const inside = a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
  if (inside) return gaps(a, [], b);
  const out = [];
  const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
  if (b.x + b.w <= a.x) out.push({ x1: b.x + b.w, y1: cy, x2: a.x, y2: cy, value: a.x - b.x - b.w });
  if (b.x >= a.x + a.w) out.push({ x1: a.x + a.w, y1: cy, x2: b.x, y2: cy, value: b.x - a.x - a.w });
  if (b.y + b.h <= a.y) out.push({ x1: cx, y1: b.y + b.h, x2: cx, y2: a.y, value: a.y - b.y - b.h });
  if (b.y >= a.y + a.h) out.push({ x1: cx, y1: a.y + a.h, x2: cx, y2: b.y, value: b.y - a.y - a.h });
  return out;
}

// ---------- alignment ----------
// New positions (absolute x/y per rect, in the same order) for align left/center/right/top/middle/bottom
// against `box` (the selection, or the parent frame for a single layer).
export function align(rects, box, how) {
  return rects.map(r => {
    switch (how) {
      case 'left': return { x: box.x, y: r.y };
      case 'center': return { x: box.x + (box.w - r.w) / 2, y: r.y };
      case 'right': return { x: box.x + box.w - r.w, y: r.y };
      case 'top': return { x: r.x, y: box.y };
      case 'middle': return { x: r.x, y: box.y + (box.h - r.h) / 2 };
      case 'bottom': return { x: r.x, y: box.y + box.h - r.h };
      default: return { x: r.x, y: r.y };
    }
  });
}

// Equal gaps between the layers along one axis, keeping the first and last where they are.
export function distribute(rects, axis) {
  const pos = axis === 'x' ? 'x' : 'y', size = axis === 'x' ? 'w' : 'h';
  const order = rects.map((r, i) => ({ r, i })).sort((a, b) => a.r[pos] - b.r[pos]);
  const first = order[0].r, last = order.at(-1).r;
  const total = last[pos] + last[size] - first[pos];
  const gap = (total - rects.reduce((s, r) => s + r[size], 0)) / (rects.length - 1);
  const out = rects.map(r => ({ x: r.x, y: r.y }));
  let at = first[pos];
  for (const { r, i } of order) { out[i][pos] = at; at += r[size] + gap; }
  return out;
}

// Tidy up: in the direction the layers mostly run, the average gap between all of them, lined up on the first.
export function tidy(rects) {
  const spanX = Math.max(...rects.map(r => r.x + r.w)) - Math.min(...rects.map(r => r.x));
  const spanY = Math.max(...rects.map(r => r.y + r.h)) - Math.min(...rects.map(r => r.y));
  const axis = spanX >= spanY ? 'x' : 'y';
  const out = distribute(rects, axis);
  const other = axis === 'x' ? 'y' : 'x';
  const line = Math.min(...rects.map(r => r[other]));
  return out.map(p => ({ ...p, [other]: line }));
}
