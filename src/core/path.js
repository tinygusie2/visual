// SVG path data without a DOM: parsed into absolute segments that only use M, L, C, Q and Z (arcs become curves,
// H/V/S/T become L/C/Q), so they can be moved, scaled, transformed by a matrix and measured exactly.
//   segment = { c: 'M' | 'L' | 'C' | 'Q' | 'Z', p: [x, y, ...] }  (C: x1 y1 x2 y2 x y, Q: x1 y1 x y)

const COUNTS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

// The numbers and commands of path data, one by one. Arc flags may be written without separators ("a1 1 0 00 1 1").
function scanner(d) {
  let i = 0;
  const skip = () => { while (i < d.length && /[\s,]/.test(d[i])) i++; };
  return {
    command() { skip(); if (i < d.length && /[a-zA-Z]/.test(d[i])) return d[i++]; return null; },
    atNumber() { skip(); return i < d.length && /[-+.\d]/.test(d[i]); },
    number() {
      skip();
      const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(i));
      if (!m) throw new Error(`Bad path data near "${d.slice(i, i + 12)}"`);
      i += m[0].length;
      return Number(m[0]);
    },
    flag() { skip(); const c = d[i++]; if (c !== '0' && c !== '1') throw new Error('Bad arc flag in path data'); return c === '1' ? 1 : 0; },
    done() { skip(); return i >= d.length; }
  };
}

export function parsePath(d) {
  const s = scanner(String(d || ''));
  const out = [];
  let x = 0, y = 0, sx = 0, sy = 0, cmd = null, lastC = null, lastQ = null;
  while (!s.done()) {
    const next = s.command();
    if (next) cmd = next;
    else if (!cmd || !s.atNumber()) throw new Error('Bad path data');
    if (cmd.toUpperCase() === 'Z') { out.push({ c: 'Z', p: [] }); x = sx; y = sy; lastC = lastQ = null; if (!next) break; continue; }
    if (!(cmd.toUpperCase() in COUNTS)) throw new Error(`Unknown path command "${cmd}"`);
    do {
      // Recomputed each time: pairs after an M are lines.
      const up = cmd.toUpperCase(), rel = cmd !== up;
      const ox = rel ? x : 0, oy = rel ? y : 0;
      let seg = null;
      switch (up) {
        case 'M': {
          x = s.number() + ox; y = s.number() + oy; sx = x; sy = y;
          out.push({ c: 'M', p: [x, y] });
          cmd = rel ? 'l' : 'L'; // more pairs after M are lines
          lastC = lastQ = null;
          continue;
        }
        case 'L': x = s.number() + ox; y = s.number() + oy; seg = { c: 'L', p: [x, y] }; break;
        case 'H': x = s.number() + ox; seg = { c: 'L', p: [x, y] }; break;
        case 'V': y = s.number() + oy; seg = { c: 'L', p: [x, y] }; break;
        case 'C': {
          const p = [s.number() + ox, s.number() + oy, s.number() + ox, s.number() + oy, s.number() + ox, s.number() + oy];
          seg = { c: 'C', p }; x = p[4]; y = p[5]; break;
        }
        case 'S': {
          const [x1, y1] = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
          const p = [x1, y1, s.number() + ox, s.number() + oy, s.number() + ox, s.number() + oy];
          seg = { c: 'C', p }; x = p[4]; y = p[5]; break;
        }
        case 'Q': {
          const p = [s.number() + ox, s.number() + oy, s.number() + ox, s.number() + oy];
          seg = { c: 'Q', p }; x = p[2]; y = p[3]; break;
        }
        case 'T': {
          const [x1, y1] = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
          const p = [x1, y1, s.number() + ox, s.number() + oy];
          seg = { c: 'Q', p }; x = p[2]; y = p[3]; break;
        }
        case 'A': {
          const rx = s.number(), ry = s.number(), rot = s.number(), large = s.flag(), sweep = s.flag();
          const ex = s.number() + ox, ey = s.number() + oy;
          out.push(...arcToCurves(x, y, rx, ry, rot, large, sweep, ex, ey));
          x = ex; y = ey; lastC = lastQ = null;
          continue;
        }
      }
      out.push(seg);
      lastC = seg.c === 'C' ? [seg.p[2], seg.p[3]] : null;
      lastQ = seg.c === 'Q' ? [seg.p[0], seg.p[1]] : null;
    } while (s.atNumber());
  }
  return out;
}

// An elliptical arc as cubic curves (SVG spec, appendix F.6), at most a quarter turn each.
function arcToCurves(x1, y1, rx, ry, rotDeg, large, sweep, x2, y2) {
  if ((x1 === x2 && y1 === y2)) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return [{ c: 'L', p: [x2, y2] }];
  const phi = rotDeg * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
  const lambda = xp * xp / (rx * rx) + yp * yp / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = k * rx * yp / ry, cyp = -k * ry * xp / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const step = dt / n, alpha = 4 / 3 * Math.tan(step / 4);
  const point = t => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const deriv = t => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = t1 + i * step, b = a + step;
    const [ax, ay] = point(a), [bx, by] = point(b), [dax, day] = deriv(a), [dbx, dby] = deriv(b);
    out.push({ c: 'C', p: [ax + alpha * dax, ay + alpha * day, bx - alpha * dbx, by - alpha * dby, i === n - 1 ? x2 : bx, i === n - 1 ? y2 : by] });
  }
  return out;
}

// m = { a, b, c, d, e, f } like DOMMatrix: x' = a x + c y + e, y' = b x + d y + f.
export function transformPath(segs, m) {
  return segs.map(s => {
    const p = [];
    for (let i = 0; i < s.p.length; i += 2) p.push(m.a * s.p[i] + m.c * s.p[i + 1] + m.e, m.b * s.p[i] + m.d * s.p[i + 1] + m.f);
    return { c: s.c, p };
  });
}
export const scalePath = (segs, sx, sy, dx = 0, dy = 0) => transformPath(segs, { a: sx, b: 0, c: 0, d: sy, e: dx, f: dy });

// The exact bounding box (curve extremes included, control points not).
export function pathBounds(segs) {
  const xs = [], ys = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  const add = (px, py) => { xs.push(px); ys.push(py); };
  const roots = (a, b, c) => {
    // a t² + b t + c = 0 in (0, 1)
    if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b];
    const disc = b * b - 4 * a * c;
    if (disc < 0) return [];
    const q = Math.sqrt(disc);
    return [(-b + q) / (2 * a), (-b - q) / (2 * a)];
  };
  for (const s of segs) {
    const p = s.p;
    if (s.c === 'M') { x = sx = p[0]; y = sy = p[1]; add(x, y); continue; }
    if (s.c === 'Z') { x = sx; y = sy; continue; }
    if (s.c === 'L') { add(p[0], p[1]); x = p[0]; y = p[1]; continue; }
    if (s.c === 'Q') {
      const at = (t, a, b, c) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;
      for (const [a, b, c, list] of [[x, p[0], p[2], 'x'], [y, p[1], p[3], 'y']]) {
        const den = a - 2 * b + c;
        if (Math.abs(den) > 1e-12) { const t = (a - b) / den; if (t > 0 && t < 1) (list === 'x' ? xs : ys).push(at(t, a, b, c)); }
      }
      add(p[2], p[3]); x = p[2]; y = p[3]; continue;
    }
    if (s.c === 'C') {
      const at = (t, a, b, c, d) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; };
      for (const [a, b, c, d, list] of [[x, p[0], p[2], p[4], xs], [y, p[1], p[3], p[5], ys]]) {
        for (const t of roots(-a + 3 * b - 3 * c + d, 2 * (a - 2 * b + c), b - a)) if (t > 0 && t < 1) list.push(at(t, a, b, c, d));
      }
      add(p[4], p[5]); x = p[4]; y = p[5];
    }
  }
  if (!xs.length) return { x: 0, y: 0, w: 0, h: 0 };
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

const n3 = v => { const r = Math.round(v * 1000) / 1000; return Object.is(r, -0) ? '0' : String(r); };
export const pathToString = segs => segs.map(s => s.c + (s.p.length ? s.p.map(n3).join(' ') : '')).join('');

// A path of simple shapes (SVG import of shapes that are rotated or skewed, and outlines of rounded rectangles).
export function rectPath(x, y, w, h, rx = 0, ry = rx) {
  rx = Math.min(Math.abs(rx), w / 2); ry = Math.min(Math.abs(ry), h / 2);
  if (!rx || !ry) return [{ c: 'M', p: [x, y] }, { c: 'L', p: [x + w, y] }, { c: 'L', p: [x + w, y + h] }, { c: 'L', p: [x, y + h] }, { c: 'Z', p: [] }];
  const k = 0.5522847498;
  return [
    { c: 'M', p: [x + rx, y] }, { c: 'L', p: [x + w - rx, y] },
    { c: 'C', p: [x + w - rx + rx * k, y, x + w, y + ry - ry * k, x + w, y + ry] }, { c: 'L', p: [x + w, y + h - ry] },
    { c: 'C', p: [x + w, y + h - ry + ry * k, x + w - rx + rx * k, y + h, x + w - rx, y + h] }, { c: 'L', p: [x + rx, y + h] },
    { c: 'C', p: [x + rx - rx * k, y + h, x, y + h - ry + ry * k, x, y + h - ry] }, { c: 'L', p: [x, y + ry] },
    { c: 'C', p: [x, y + ry - ry * k, x + rx - rx * k, y, x + rx, y] }, { c: 'Z', p: [] }
  ];
}
export function ellipsePath(cx, cy, rx, ry) {
  const k = 0.5522847498;
  return [
    { c: 'M', p: [cx + rx, cy] },
    { c: 'C', p: [cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry] },
    { c: 'C', p: [cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy] },
    { c: 'C', p: [cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry] },
    { c: 'C', p: [cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy] },
    { c: 'Z', p: [] }
  ];
}
export function polyPath(points, close) {
  const out = [];
  for (let i = 0; i + 1 < points.length; i += 2) out.push({ c: i ? 'L' : 'M', p: [points[i], points[i + 1]] });
  if (close && out.length) out.push({ c: 'Z', p: [] });
  return out;
}

// A vector layer from segments in page (or parent) coordinates: its box, and the path moved into that box.
export function vectorFromSegments(segs) {
  const b = pathBounds(segs);
  const w = Math.max(b.w, 1), h = Math.max(b.h, 1);
  // A straight line has no height (or width): keep it centred in a box of 1.
  const dx = -b.x + (b.w < 1 ? (1 - b.w) / 2 : 0), dy = -b.y + (b.h < 1 ? (1 - b.h) / 2 : 0);
  return { x: b.x - (b.w < 1 ? (1 - b.w) / 2 : 0), y: b.y - (b.h < 1 ? (1 - b.h) / 2 : 0), w, h, vw: w, vh: h, path: pathToString(scalePath(segs, 1, 1, dx, dy)) };
}
