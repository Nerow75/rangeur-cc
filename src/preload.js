'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);
const on = (ch, cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(ch, fn);
  return () => ipcRenderer.removeListener(ch, fn);
};

contextBridge.exposeInMainWorld('cc', {
  getState: () => invoke('state:get'),
  toggle: id => invoke('item:toggle', id),
  remove: id => invoke('item:delete', id),
  openFolder: id => invoke('item:openFolder', id),
  openSource: id => invoke('item:openSource', id),
  openMods: () => invoke('open:mods'),
  openDownloads: () => invoke('open:downloads'),
  openTsr: () => invoke('open:tsr'),
  setSettings: patch => invoke('settings:set', patch),
  useSimsDir: dir => invoke('settings:useSimsDir', dir),
  pickSimsDir: () => invoke('settings:pickSimsDir'),
  pickDownloadsDir: () => invoke('settings:pickDownloadsDir'),
  enableModsInGame: () => invoke('mods:enableInGame'),
  importFiles: files => invoke('import:files', files.map(f => webUtils.getPathForFile(f))),
  processExisting: () => invoke('downloads:processExisting'),
  onChange: cb => on('library:changed', cb),
  onActivity: cb => on('activity', cb),
  onBusy: cb => on('busy', cb)
});
