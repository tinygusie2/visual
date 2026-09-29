// Number fields accept arithmetic: "200 + 32" → 232, and starting with an operator works on the current value:
// "/2" on 400 → 200, "*1.5", "+16". A leading minus is a negative number ("-10"), as in other design tools.
// No eval: a small parser for + - * / and parentheses.

export function evaluate(input, current) {
  let s = String(input).trim().replace(/,/g, '.');
  if (!s) return null;
  if (/^[*/+]/.test(s)) {
    if (current == null || !Number.isFinite(current)) return null;
    s = `(${current})${s}`;
  }
  const tokens = s.match(/\d*\.?\d+(?:e[+-]?\d+)?|[-+*/()]|\S/gi);
  let pos = 0;
  const peek = () => tokens[pos];
  const take = () => tokens[pos++];
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') v = take() === '+' ? v + term() : v - term();
    return v;
  }
  function term() {
    let v = factor();
    while (peek() === '*' || peek() === '/') v = take() === '*' ? v * factor() : v / factor();
    return v;
  }
  function factor() {
    const t = take();
    if (t === '-') return -factor();
    if (t === '+') return factor();
    if (t === '(') { const v = expr(); if (take() !== ')') throw new Error('")" expected'); return v; }
    const n = Number(t);
    if (t === undefined || !Number.isFinite(n)) throw new Error(`Unexpected "${t ?? 'end'}"`);
    return n;
  }
  try {
    const v = expr();
    return pos === tokens.length && Number.isFinite(v) ? v : null;
  } catch { return null; }
}
