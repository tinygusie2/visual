// Small line icons (16 × 16, currentColor), inline so the app works offline and without an icon font.
const paths = {
  move: '<path d="M3.5 2.5l9 4.2-3.9 1.2-1.4 3.8z"/>',
  frame: '<path d="M5 2v12M11 2v12M2 5h12M2 11h12"/>',
  rect: '<rect x="2.5" y="3.5" width="11" height="9" rx="1"/>',
  ellipse: '<circle cx="8" cy="8" r="5.5"/>',
  text: '<path d="M3 3.5h10M8 3.5v9.5M6 13h4"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>',
  eye: '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  'eye-off': '<path d="M2 2l12 12M6.3 4c.5-.2 1.1-.3 1.7-.3 4.1 0 6.5 4.3 6.5 4.3s-.6 1.1-1.7 2.2M10.5 11.9c-.8.4-1.6.6-2.5.6-4.1 0-6.5-4.5-6.5-4.5s.8-1.5 2.2-2.8"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>',
  unlock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 014.9-.6"/>',
  'chevron-down': '<path d="M4.5 6.5L8 10l3.5-3.5"/>',
  'chevron-right': '<path d="M6.5 4.5L10 8l-3.5 3.5"/>',
  'align-left': '<path d="M2.5 4h11M2.5 8h7M2.5 12h9"/>',
  'align-center': '<path d="M2.5 4h11M4.5 8h7M3.5 12h9"/>',
  'align-right': '<path d="M2.5 4h11M6.5 8h7M4.5 12h9"/>',
  'auto-width': '<path d="M2 8h12M4.5 5.5L2 8l2.5 2.5M11.5 5.5L14 8l-2.5 2.5"/>',
  'auto-height': '<path d="M8 2v12M5.5 4.5L8 2l2.5 2.5M5.5 11.5L8 14l2.5-2.5"/>',
  fixed: '<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M5.5 8h5"/>',
  'clip': '<rect x="2.5" y="2.5" width="11" height="11" rx="1" stroke-dasharray="2 2"/>',
  minus: '<path d="M3 8h10"/>',
  x: '<path d="M4 4l8 8M12 4l-8 8"/>'
};

export function icon(name) {
  return `<svg class="ico" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}

// The wink: the only piece of branding in the interface (title bar, start screen, app icon).
export function wink(size = 20) {
  return `<svg class="wink" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="23" cy="27" r="5.5" fill="currentColor"/>
    <path d="M36 27.5q6.5-6 13 0" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M21 40q11 9 22 0" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/>
  </svg>`;
}
