// The home screen shown without an open design: new design, open file, recent designs, and the template picker.
import { icon, wink } from './icons.js';
import { t } from './i18n.js';
import { templates } from './presets.js';

export function attachStart(root, { onTemplate, onOpen, onOpenPath }) {
  root.innerHTML = `
    <div class="start-inner">
      <div class="home">
        <div class="brand">${wink(56)}<h1>Visual</h1></div>
        <div class="start-actions">
          <button class="primary big" data-new>${icon('plus')}<span>${t('New design')}</span></button>
          <button class="big" data-open><span>${t('Open file')}</span></button>
        </div>
        <h3>${t('Recent')}</h3>
        <ul class="recents"></ul>
      </div>
      <div class="templates" hidden>
        <div class="templates-head"><button class="ghost" data-back>← ${t('Back')}</button><h2>${t('Choose a starting point')}</h2></div>
        <div class="template-grid"></div>
        <form class="custom-size" hidden>
          <label>${t('Width')}<input name="w" type="number" min="1" max="20000" value="1200" required></label>
          <label>${t('Height')}<input name="h" type="number" min="1" max="20000" value="800" required></label>
          <button class="primary">${t('Create')}</button>
        </form>
      </div>
    </div>`;
  const home = root.querySelector('.home'), picker = root.querySelector('.templates'), grid = root.querySelector('.template-grid');
  const custom = root.querySelector('.custom-size');

  root.querySelector('[data-new]').addEventListener('click', () => { home.hidden = true; picker.hidden = false; custom.hidden = true; grid.querySelector('button')?.focus(); });
  root.querySelector('[data-back]').addEventListener('click', () => { picker.hidden = true; home.hidden = false; });
  root.querySelector('[data-open]').addEventListener('click', onOpen);
  custom.addEventListener('submit', e => {
    e.preventDefault();
    const w = Number(custom.w.value), h = Number(custom.h.value);
    onTemplate({ name: `${w} × ${h}`, w, h });
  });

  for (const tpl of templates) {
    const b = document.createElement('button');
    b.className = 'template';
    const ratio = tpl.w ? tpl.w / tpl.h : 1;
    const pw = ratio >= 1 ? 72 : 72 * ratio, ph = ratio >= 1 ? 72 / ratio : 72;
    b.innerHTML = `<span class="thumb">${tpl.id === 'blank' ? '<span class="dots"></span>' : tpl.id === 'custom' ? icon('plus') : `<span class="shape" style="width:${pw}px;height:${ph}px"></span>`}</span>
      <span class="tname">${t(tpl.name)}</span><span class="tsize muted">${tpl.w ? `${tpl.w} × ${tpl.h}` : tpl.note ? t(tpl.note) : ''}</span>`;
    b.addEventListener('click', () => {
      if (tpl.id === 'custom') { custom.hidden = false; custom.w.focus(); custom.w.select(); return; }
      onTemplate(tpl.w ? { name: t(tpl.name), w: tpl.w, h: tpl.h } : null);
    });
    grid.append(b);
  }

  return {
    async show() {
      picker.hidden = true; home.hidden = false;
      root.hidden = false;
      const list = root.querySelector('.recents');
      const recents = await window.host.recents();
      if (!recents.length) { list.innerHTML = `<li class="muted empty">${t('No recent designs yet')}</li>`; return; }
      list.replaceChildren(...recents.map(r => {
        const li = document.createElement('li');
        li.className = 'recent' + (r.missing ? ' missing' : '');
        li.innerHTML = `<span class="rname"></span><span class="rpath muted"></span><span class="rdate muted"></span>
          <button class="icon ghost row-btn" title="${t('Remove from list')}">${icon('x')}</button>`;
        li.querySelector('.rname').textContent = r.name;
        li.querySelector('.rpath').textContent = r.missing ? t('File not found') : r.path;
        li.querySelector('.rdate').textContent = new Date(r.opened).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
        li.querySelector('button').addEventListener('click', async e => { e.stopPropagation(); await window.host.removeRecent(r.path); this.show(); });
        li.addEventListener('click', () => { if (!r.missing) onOpenPath(r.path); });
        return li;
      }));
    },
    hide() { root.hidden = true; }
  };
}
