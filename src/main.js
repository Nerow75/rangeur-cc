'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, Notification, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const { Store } = require('./core/store');
const { findSimsUserDirs, ensureModsDir, layout } = require('./core/paths');
const { DownloadWatcher } = require('./core/watcher');
const { installDownload, setEnabled, itemDir, isRelevant } = require('./core/installer');
const { readModOptions, enableMods, isGameRunning } = require('./core/options');

// Mode bac à sable pour le développement : dossiers factices, rien de réel n'est touché.
if (process.env.RCC_SANDBOX) {
  const sb = path.resolve(process.env.RCC_SANDBOX);
  app.setPath('userData', path.join(sb, 'userData'));
  app.setPath('documents', path.join(sb, 'Documents'));
  app.setPath('downloads', path.join(sb, 'Downloads'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const ASSETS = path.join(__dirname, '..', 'assets');
const startHidden = process.argv.includes('--hidden');

let win = null;
let tray = null;
let store;
let watcher = null;
let paths = null;
let quitting = false;
const activity = [];
let queue = Promise.resolve();

// ---------------------------------------------------------------- état

function cacheDir() { return path.join(app.getPath('userData'), 'previews'); }

function resolvePaths() {
  const s = store.settings;
  let simsDir = s.simsDir && fs.existsSync(s.simsDir) ? s.simsDir : null;
  if (!simsDir) {
    const found = findSimsUserDirs(app.getPath('documents'));
    simsDir = found.length ? found[0].path : null;
  }
  paths = simsDir ? layout(simsDir) : null;
  if (paths) ensureModsDir(paths.simsDir);
}

function previewUrl(item) {
  if (!item.preview) return null;
  const p = path.join(cacheDir(), item.preview);
  return fs.existsSync(p) ? pathToFileURL(p).href : null;
}

async function getState() {
  const options = paths ? readModOptions(paths.optionsIni) : null;
  return {
    version: app.getVersion(),
    settings: { ...store.settings, downloadsIsDefault: path.resolve(store.settings.downloadsDir) === path.resolve(app.getPath('downloads')) },
    paths,
    simsDirs: findSimsUserDirs(app.getPath('documents')),
    items: store.items.map(i => ({ ...i, previewUrl: previewUrl(i), hashes: undefined })),
    activity,
    modOptions: options,
    gameRunning: await isGameRunning(),
    waitingDownloads: countWaitingDownloads()
  };
}

function countWaitingDownloads() {
  try {
    return fs.readdirSync(store.settings.downloadsDir).filter(isRelevant).length;
  } catch { return 0; }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function pushActivity(entry) {
  activity.unshift({ ...entry, at: Date.now() });
  activity.length = Math.min(activity.length, 40);
  send('activity', activity[0]);
  send('library:changed');
}

// ---------------------------------------------------------------- installation

function enqueue(file, origin) {
  queue = queue.then(() => processFile(file, origin)).catch(() => {});
  return queue;
}

async function processFile(file, origin) {
  if (!paths) {
    pushActivity({ status: 'error', message: 'Dossier des Sims 4 introuvable : choisis-le dans les réglages.' });
    return;
  }
  send('busy', { file: path.basename(file) });
  try {
    const res = await installDownload(file, {
      paths,
      store,
      cacheDir: cacheDir(),
      settings: store.settings,
      trash: p => shell.trashItem(p).catch(() => {})
    });
    if (res.status === 'ignored' && origin !== 'manual') return;
    pushActivity({ status: res.status, message: res.message, itemId: res.item && res.item.id });
    if (res.status === 'installed') notifyInstalled(res.item);
  } catch (err) {
    pushActivity({ status: 'error', message: `Échec pour ${path.basename(file)} : ${err.message}` });
  } finally {
    store.data.lastScanAt = Date.now();
    store.save();
    send('busy', null);
  }
}

async function notifyInstalled(item) {
  if (!store.settings.notifications || !Notification.isSupported()) return;
  const running = await isGameRunning();
  const icon = item.preview ? nativeImage.createFromPath(path.join(cacheDir(), item.preview)) : undefined;
  const n = new Notification({
    title: 'CC installé',
    body: item.name + (running ? '\nIl apparaîtra au prochain lancement du jeu.' : ''),
    icon: icon && !icon.isEmpty() ? icon.resize({ width: 96 }) : undefined,
    silent: true
  });
  n.on('click', showWindow);
  n.show();
}

function startWatcher() {
  if (watcher) watcher.stop();
  const dir = store.settings.downloadsDir;
  if (!dir || !fs.existsSync(dir)) return;
  watcher = new DownloadWatcher(dir);
  watcher.on('file', f => enqueue(f, 'watch'));
  watcher.on('error', () => setTimeout(startWatcher, 5000));
  watcher.start();
  if (store.data.lastScanAt) watcher.scanSince(store.data.lastScanAt - 5000);
}

// ---------------------------------------------------------------- fenêtre + tray

function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 760,
    minHeight: 560,
    show: false,
    backgroundColor: '#f6f3ee',
    autoHideMenuBar: true,
    title: 'Rangeur CC',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!startHidden) win.show(); });
  if (process.env.RCC_SHOT) {
    // Capture d'écran automatique (développement)
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.RCC_SHOT_JS) await win.webContents.executeJavaScript(process.env.RCC_SHOT_JS);
      await new Promise(r => setTimeout(r, 600));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.RCC_SHOT, img.toPNG());
    }, Number(process.env.RCC_SHOT_DELAY || 2500)));
  }
  win.on('close', e => {
    if (!quitting && store.settings.keepInTray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', e => e.preventDefault());
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, 'tray.png')));
  tray.setToolTip('Rangeur CC : surveille tes téléchargements');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir Rangeur CC', click: showWindow },
    { label: 'Ouvrir le dossier Mods', click: () => paths && shell.openPath(paths.modsDir) },
    { type: 'separator' },
    { label: 'Quitter', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', showWindow);
}

function applyLoginItem() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!store.settings.openAtLogin, args: ['--hidden'] });
}

// ---------------------------------------------------------------- IPC

function findItem(id) {
  const it = store.getItem(id);
  if (!it) throw new Error('CC introuvable');
  return it;
}

ipcMain.handle('state:get', () => getState());

ipcMain.handle('item:toggle', (_e, id) => {
  const it = findItem(id);
  const folder = setEnabled(it, !it.enabled, paths);
  store.updateItem(id, { enabled: !it.enabled, folder });
  send('library:changed');
});

ipcMain.handle('item:delete', async (_e, id) => {
  const it = findItem(id);
  const dir = itemDir(it, paths);
  if (dir && fs.existsSync(dir)) await shell.trashItem(dir);
  for (const t of it.trayFiles || []) {
    const p = path.join(paths.trayDir, t);
    if (fs.existsSync(p)) await shell.trashItem(p).catch(() => {});
  }
  if (it.preview) fs.rmSync(path.join(cacheDir(), it.preview), { force: true });
  store.removeItem(id);
  pushActivity({ status: 'deleted', message: `Supprimé (dans la corbeille) : ${it.name}` });
});

ipcMain.handle('item:openFolder', (_e, id) => {
  const dir = itemDir(findItem(id), paths);
  if (dir) shell.openPath(dir);
});

ipcMain.handle('item:openSource', (_e, id) => {
  const url = findItem(id).sourceUrl;
  if (url && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

ipcMain.handle('open:mods', () => paths && shell.openPath(paths.modsDir));
ipcMain.handle('open:downloads', () => shell.openPath(store.settings.downloadsDir));
ipcMain.handle('open:tsr', () => shell.openExternal('https://www.thesimsresource.com/downloads/browse/category/sims4/'));

ipcMain.handle('settings:set', (_e, patch) => {
  const allowed = ['removeAfterInstall', 'notifications', 'openAtLogin', 'keepInTray'];
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)).map(([k, v]) => [k, !!v]));
  store.setSettings(clean);
  applyLoginItem();
});

ipcMain.handle('settings:useSimsDir', (_e, dir) => {
  if (!findSimsUserDirs(app.getPath('documents')).some(d => d.path === dir)) throw new Error('Dossier inconnu');
  store.setSettings({ simsDir: dir });
  resolvePaths();
  send('library:changed');
});

ipcMain.handle('settings:pickSimsDir', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Dossier des Sims 4 (celui qui contient Mods, saves, Tray...)', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return;
  store.setSettings({ simsDir: r.filePaths[0] });
  resolvePaths();
  send('library:changed');
});

ipcMain.handle('settings:pickDownloadsDir', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Dossier où ton navigateur enregistre les téléchargements', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return;
  store.setSettings({ downloadsDir: r.filePaths[0] });
  startWatcher();
  send('library:changed');
});

ipcMain.handle('mods:enableInGame', async () => {
  if (await isGameRunning()) throw new Error('Ferme le jeu d\'abord : il réécrit ses options en quittant.');
  enableMods(paths.optionsIni);
  send('library:changed');
});

ipcMain.handle('import:files', async (_e, files) => {
  const list = (Array.isArray(files) ? files : []).filter(f => typeof f === 'string' && fs.existsSync(f));
  for (const f of list) enqueue(f, 'manual');
  await queue;
  return list.length;
});

ipcMain.handle('downloads:processExisting', async () => {
  const dir = store.settings.downloadsDir;
  const files = fs.readdirSync(dir).filter(isRelevant).map(n => path.join(dir, n));
  for (const f of files) enqueue(f, 'bulk');
  await queue;
  return files.length;
});

// ---------------------------------------------------------------- démarrage

app.on('second-instance', showWindow);

app.whenReady().then(() => {
  store = new Store(path.join(app.getPath('userData'), 'library.json'), {
    simsDir: null,
    downloadsDir: app.getPath('downloads'),
    removeAfterInstall: true,
    notifications: true,
    openAtLogin: true,
    keepInTray: true
  });
  const firstRun = !store.data.lastScanAt;
  if (firstRun) { store.data.lastScanAt = Date.now(); store.save(); }
  app.setAppUserModelId('fr.rangeurcc.app');
  resolvePaths();
  applyLoginItem();
  createTray();
  createWindow();
  startWatcher();
  setInterval(() => { store.data.lastScanAt = Date.now(); store.save(); }, 60000);
});

app.on('before-quit', () => {
  quitting = true;
  if (store) { store.data.lastScanAt = Date.now(); store.save(); }
});
app.on('window-all-closed', () => {
  if (!store || !store.settings.keepInTray) app.quit();
});
