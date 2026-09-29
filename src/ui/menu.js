// A small dropdown menu: items are { label, shortcut, action, disabled } or '-' for a separator.
import { t } from './i18n.js';

let open = null;

export function showMenu(anchor, items, { align = 'left' } = {}) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  for (const item of items) {
    if (item === '-') { menu.append(Object.assign(document.createElement('hr'))); continue; }
    const b = document.createElement('button');
    b.className = 'menu-item';
    b.disabled = !!item.disabled;
    b.innerHTML = `<span></span><kbd></kbd>`;
    b.firstElementChild.textContent = t(item.label);
    b.lastElementChild.textContent = item.shortcut || '';
    b.addEventListener('click', () => { closeMenu(); item.action(); });
    menu.append(b);
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 4}px`;
  menu.style.left = align === 'right' ? `${Math.max(8, r.right - menu.offsetWidth)}px` : `${r.left}px`;
  open = { menu, anchor };
  anchor.classList.add('open');
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  menu.querySelector('.menu-item:not(:disabled)')?.focus();
}

function outside(e) {
  if (open && !open.menu.contains(e.target)) {
    // A click on the button that opened it just closes it.
    if (open.anchor.contains(e.target)) e.stopPropagation();
    closeMenu();
  }
}

export function closeMenu() {
  if (!open) return false;
  open.menu.remove(); open.anchor.classList.remove('open'); open = null;
  document.removeEventListener('pointerdown', outside, true);
  return true;
}

export function menuKeys(e) {
  if (!open) return false;
  if (e.key === 'Escape') { closeMenu(); return true; }
  const items = [...open.menu.querySelectorAll('.menu-item:not(:disabled)')];
  const at = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { items[(at + 1) % items.length]?.focus(); return true; }
  if (e.key === 'ArrowUp') { items[(at - 1 + items.length) % items.length]?.focus(); return true; }
  return false;
}
