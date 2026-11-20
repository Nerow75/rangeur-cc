'use strict';
/* global cc */

const $ = sel => document.querySelector(sel);
const state = { data: null, filter: 'all', category: '', query: '', seen: new Set(), openMenu: null, bulkOffered: false };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
}

const PLACEHOLDER = '<svg class="placeholder" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" d="M12 2.5 19 12l-7 9.5L5 12z"/><path fill="none" stroke="currentColor" stroke-width="1.5" d="M5 12h14M12 2.5v19"/></svg>';

function relDate(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return "à l'instant";
  if (d < 3600) return `il y a ${Math.floor(d / 60)} min`;
  if (d < 86400) return `il y a ${Math.floor(d / 3600)} h`;
  if (d < 86400 * 7) return `il y a ${Math.floor(d / 86400)} j`;
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function toast(message, { kind = '', image = null } = {}) {
  const t = el('div', { class: 'toast ' + kind }, image ? el('img', { src: image, alt: '' }) : null, el('span', {}, message));
  $('#toasts').append(t);
  setTimeout(() => { t.classList.add('leave'); setTimeout(() => t.remove(), 220); }, 4200);
}

async function run(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
  } catch (e) {
    toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { kind: 'error' });
  }
}

// ------------------------------------------------------------- rendu

async function refresh() {
  state.data = await cc.getState();
  render();
}

function render() {
  const d = state.data;
  if (!d) return;
  renderStatus(d);
  renderBanners(d);
  renderGrid(d);
  if (!$('#settings').hidden) renderSettings(d);
}

function renderStatus(d) {
  const ok = !!d.paths;
  $('#status').classList.toggle('off', !ok);
  $('#statusText').textContent = ok
    ? `Surveille ${d.settings.downloadsIsDefault ? 'tes téléchargements' : '« ' + shortPath(d.settings.downloadsDir) + ' »'} · installe dans ${d.paths.simsDir.split(/[\\/]/).pop().replace(/ /g, ' ')}`
    : 'Dossier du jeu introuvable';
}

function shortPath(p) {
  const parts = String(p || '').split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function banner({ kind = '', title, text, actions = [] }) {
  return el('div', { class: 'banner ' + kind },
    el('div', {}, el('strong', {}, title), text ? el('p', {}, text) : null),
    el('div', { class: 'row' }, actions.map(a => el('button', { class: 'btn small ' + (a.primary ? 'primary' : ''), onclick: a.onClick }, a.label))));
}

function renderBanners(d) {
  const box = $('#banners');
  box.replaceChildren();
  if (!d.paths) {
    box.append(banner({
      kind: 'warn', title: 'Je ne trouve pas le dossier des Sims 4.',
      text: "Lance le jeu une fois pour qu'il le crée, ou indique-le à la main (Documents > Electronic Arts > Les Sims 4).",
      actions: [{ label: 'Choisir le dossier', primary: true, onClick: () => run(cc.pickSimsDir) }]
    }));
    return;
  }
  const o = d.modOptions;
  const hasScripts = d.items.some(i => i.hasScript && i.enabled);
  if (o && (!o.modsEnabled || (hasScripts && !o.scriptModsEnabled))) {
    box.append(banner({
      kind: 'warn',
      title: !o.modsEnabled ? 'Le contenu personnalisé est désactivé dans le jeu.' : 'Les mods de script sont désactivés dans le jeu.',
      text: d.gameRunning
        ? 'Ferme le jeu puis clique sur Activer, ou va dans Options du jeu > Autre.'
        : 'Sans ça, ton CC n\'apparaîtra pas. Je peux cocher l\'option pour toi.',
      actions: [{ label: 'Activer', primary: true, onClick: () => run(cc.enableModsInGame, 'Option activée : relance le jeu pour en profiter.') }]
    }));
  }
  if (d.waitingDownloads > 0 && !state.bulkOffered) {
    const n = d.waitingDownloads;
    box.append(banner({
      title: `${n} fichier${n > 1 ? 's' : ''} de CC ${n > 1 ? 'sont' : 'est'} déjà dans tes téléchargements.`,
      text: 'Les archives sans contenu Sims seront laissées en place.',
      actions: [
        { label: 'Les ranger', primary: true, onClick: () => { state.bulkOffered = true; run(cc.processExisting); render(); } },
        { label: 'Plus tard', onClick: () => { state.bulkOffered = true; render(); } }
      ]
    }));
  }
}

function filteredItems(d) {
  const q = state.query.trim().toLowerCase();
  return d.items.filter(i => {
    if (state.filter === 'on' && !i.enabled) return false;
    if (state.filter === 'off' && i.enabled) return false;
    if (state.category && i.category !== state.category) return false;
    if (!q) return true;
    return [i.name, i.creator, i.originalName].some(v => v && v.toLowerCase().includes(q));
  });
}

function renderGrid(d) {
  const items = filteredItems(d);
  const total = d.items.length;
  $('#toolbar').hidden = total === 0;
  $('#empty').hidden = total !== 0;
  const off = d.items.filter(i => !i.enabled).length;
  $('#count').textContent = total ? `${total} CC${off ? ` · ${off} désactivé${off > 1 ? 's' : ''}` : ''}` : '';

  renderCategories(d);
  const grid = $('#grid');
  grid.replaceChildren(...items.map(card));
  if (total && !items.length) grid.append(el('p', { class: 'count' }, 'Aucun résultat.'));
  for (const i of d.items) state.seen.add(i.id);
}

function renderCategories(d) {
  const counts = {};
  for (const i of d.items) if (i.category) counts[i.category] = (counts[i.category] || 0) + 1;
  const cats = Object.keys(counts).sort((x, y) => x.localeCompare(y, 'fr'));
  if (state.category && !counts[state.category]) state.category = '';
  const sel = $('#category');
  sel.hidden = cats.length < 2;
  sel.replaceChildren(el('option', { value: '' }, 'Toutes les catégories'),
    ...cats.map(c => el('option', { value: c, selected: c === state.category }, `${c} (${counts[c]})`)));
}

function card(item) {
  const isNew = state.seen.size > 0 && !state.seen.has(item.id);
  const thumb = el('div', { class: 'thumb' });
  if (item.previewUrl) thumb.append(el('img', { src: item.previewUrl, alt: '', loading: 'lazy', draggable: 'false' }));
  else thumb.insertAdjacentHTML('beforeend', PLACEHOLDER);
  const badges = [];
  if (item.hasScript) badges.push(el('span', { class: 'badge' }, 'Script'));
  if (item.trayFiles && item.trayFiles.length) badges.push(el('span', { class: 'badge' }, item.kind === 'tray' ? 'Lot / Sims' : '+ Lot / Sims'));
  if (badges.length) thumb.append(el('div', { class: 'badges' }, badges));

  const sub = [item.category, item.creator, relDate(item.installedAt)].filter(Boolean).join(' · ');
  const toggle = item.folder
    ? el('label', { class: 'switch' },
        el('input', { type: 'checkbox', checked: item.enabled, 'aria-label': 'Activer dans le jeu', onchange: () => run(() => cc.toggle(item.id)) }),
        item.enabled ? 'Actif' : 'Désactivé')
    : el('span', { class: 'switch' }, 'Dans Tray');

  const menuBtn = el('button', { class: 'btn icon', 'aria-label': 'Plus d\'actions', 'aria-haspopup': 'menu', onclick: e => { e.stopPropagation(); openMenu(menuWrap, item); } });
  menuBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/></svg>';
  const menuWrap = el('div', { class: 'menu-wrap' }, menuBtn);

  return el('article', { class: 'card' + (item.enabled ? '' : ' off') + (isNew ? ' new' : ''), title: item.originalName ? 'Fichier : ' + item.originalName : null },
    thumb,
    el('div', { class: 'card-body' }, el('h3', {}, item.name), el('p', {}, sub)),
    el('div', { class: 'card-foot' }, toggle, menuWrap));
}

function closeMenu() {
  if (state.openMenu) state.openMenu.remove();
  state.openMenu = null;
}

function openMenu(wrap, item) {
  const wasOpen = state.openMenu && state.openMenu.parentNode === wrap;
  closeMenu();
  if (wasOpen) return;
  const menu = el('div', { class: 'menu', role: 'menu', onclick: e => e.stopPropagation() },
    el('button', { role: 'menuitem', disabled: !item.sourceUrl, onclick: () => { closeMenu(); run(() => cc.openSource(item.id)); } }, 'Voir la page du CC'),
    el('button', { role: 'menuitem', disabled: !item.folder, onclick: () => { closeMenu(); run(() => cc.openFolder(item.id)); } }, 'Ouvrir le dossier'),
    el('button', { role: 'menuitem', class: 'danger', onclick: () => askDelete(menu, item) }, 'Supprimer…'));
  wrap.append(menu);
  state.openMenu = menu;
  menu.querySelector('button:not(:disabled)')?.focus();
}

function askDelete(menu, item) {
  menu.replaceChildren(el('div', { class: 'confirm' },
    el('div', {}, `Supprimer « ${item.name} » ? Les fichiers vont dans la corbeille.`),
    el('div', { class: 'row' },
      el('button', { class: 'btn small danger', onclick: () => { closeMenu(); run(() => cc.remove(item.id)); } }, 'Supprimer'),
      el('button', { class: 'btn small', onclick: closeMenu }, 'Annuler'))));
  menu.querySelector('.danger')?.focus();
}

// ------------------------------------------------------------- réglages

function renderSettings(d) {
  const list = $('#simsDirs');
  list.replaceChildren(...d.simsDirs.map(s => el('label', {},
    el('input', { type: 'radio', name: 'sims', checked: d.paths && d.paths.simsDir === s.path, onchange: () => run(() => cc.useSimsDir(s.path), 'Dossier du jeu changé.') }),
    el('span', {}, s.name, s === d.simsDirs[0] ? ' (le plus récent)' : '', el('small', {}, s.path)))));
  if (d.paths && !d.simsDirs.some(s => s.path === d.paths.simsDir)) {
    list.prepend(el('label', {}, el('input', { type: 'radio', name: 'sims', checked: true }), el('span', {}, 'Dossier choisi', el('small', {}, d.paths.simsDir))));
  }
  if (!list.children.length) list.append(el('p', { class: 'path' }, 'Aucun dossier trouvé.'));

  $('#dlPath').textContent = d.settings.downloadsDir;
  for (const box of document.querySelectorAll('[data-s]')) box.checked = !!d.settings[box.dataset.s];

  const act = $('#activity');
  act.replaceChildren(...d.activity.slice(0, 20).map(a => el('li', {},
    el('time', {}, new Date(a.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })),
    el('span', { class: a.status === 'error' ? 'error' : '' }, a.message))));
  if (!d.activity.length) act.append(el('li', { class: 'empty-line' }, 'Rien depuis l\'ouverture de l\'app.'));
  $('#version').textContent = `Rangeur CC ${d.version}`;
}

function openSettings(open) {
  $('#settings').hidden = !open;
  $('#scrim').hidden = !open;
  if (open) { renderSettings(state.data); $('#btnCloseSettings').focus(); }
}

// ------------------------------------------------------------- événements

$('#btnTsr').onclick = () => run(cc.openTsr);
$('#btnMods').onclick = () => run(cc.openMods);
$('#btnSettings').onclick = () => openSettings(true);
$('#btnCloseSettings').onclick = () => openSettings(false);
$('#scrim').onclick = () => openSettings(false);
$('#btnPickSims').onclick = () => run(cc.pickSimsDir);
$('#btnPickDl').onclick = () => run(cc.pickDownloadsDir);
$('#btnOpenDl').onclick = () => run(cc.openDownloads);
for (const box of document.querySelectorAll('[data-s]')) {
  box.onchange = () => run(async () => { await cc.setSettings({ [box.dataset.s]: box.checked }); await refresh(); });
}
$('#category').onchange = e => { state.category = e.target.value; renderGrid(state.data); };
$('#search').oninput = e => { state.query = e.target.value; renderGrid(state.data); };
for (const b of document.querySelectorAll('#filter button')) {
  b.onclick = () => {
    state.filter = b.dataset.f;
    for (const o of document.querySelectorAll('#filter button')) o.setAttribute('aria-selected', String(o === b));
    renderGrid(state.data);
  };
}
document.addEventListener('click', closeMenu);
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (state.openMenu) closeMenu();
  else if (!$('#settings').hidden) openSettings(false);
});

// Glisser-déposer
let dragDepth = 0;
window.addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; $('#drop').hidden = false; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').hidden = true; } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  $('#drop').hidden = true;
  const files = [...e.dataTransfer.files];
  if (files.length) run(() => cc.importFiles(files));
});

let refreshTimer = null;
cc.onChange(() => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 80); });
cc.onBusy(b => {
  $('#busy').hidden = !b;
  if (b) $('#busyText').textContent = `Installation de ${b.file}…`;
});
cc.onActivity(a => {
  const item = a.itemId && state.data && state.data.items.find(i => i.id === a.itemId);
  if (a.status === 'error') toast(a.message, { kind: 'error' });
  else if (a.status !== 'installed') toast(a.message);
  else setTimeout(() => {
    const fresh = state.data.items.find(i => i.id === a.itemId) || item;
    toast(a.message, { image: fresh && fresh.previewUrl });
  }, 150);
});
window.addEventListener('focus', refresh);

refresh();
