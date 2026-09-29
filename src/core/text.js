// Text layout shared by drawing and sizing: splits a text node into lines the way the canvas will draw them.
// measure(string) → width in px for the node's font; injected so this runs without a DOM in tests.

export const fontString = n => `${n.fontWeight} ${n.fontSize}px "${n.fontFamily}", system-ui, sans-serif`;
export const lineHeightPx = n => n.fontSize * n.lineHeight;

export function layoutText(node, measure) {
  const wrapAt = node.sizing === 'auto-width' ? Infinity : node.w;
  const lines = [];
  for (const paragraph of String(node.text).split('\n')) {
    if (wrapAt === Infinity) { lines.push(paragraph); continue; }
    let line = '';
    for (const word of paragraph.split(/(?<=\s)/)) {
      const tryLine = line + word;
      if (line && measure(tryLine.trimEnd()) > wrapAt) { lines.push(line.trimEnd()); line = word.trimStart(); }
      else line = tryLine;
      // A single word wider than the box breaks by character.
      while (measure(line.trimEnd()) > wrapAt && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut)) > wrapAt) cut--;
        lines.push(line.slice(0, cut)); line = line.slice(cut);
      }
    }
    lines.push(line.trimEnd());
  }
  const widths = lines.map(l => measure(l));
  return { lines, widths, width: Math.max(0, ...widths), lineHeight: lineHeightPx(node) };
}

// The size the node gets from its sizing mode: auto width → both from the text, auto height → height from the text.
export function fitTextSize(node, measure) {
  const { lines, width, lineHeight } = layoutText(node, measure);
  const h = Math.max(1, Math.round(lines.length * lineHeight * 100) / 100);
  if (node.sizing === 'auto-width') return { w: Math.max(1, Math.ceil(width)), h };
  if (node.sizing === 'auto-height') return { w: node.w, h };
  return { w: node.w, h: node.h };
}
