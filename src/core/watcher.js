'use strict';
// Surveille le dossier Téléchargements. Un fichier n'est traité que lorsque le
// navigateur a fini de l'écrire (taille stable + fichier ouvrable en écriture).

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { isRelevant } = require('./installer');

const TEMP_EXT = /\.(crdownload|part|partial|tmp|download|opdownload)$/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));

class DownloadWatcher extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    this.pending = new Set();
    this.watcher = null;
  }

  start() {
    this.stop();
    this.watcher = fs.watch(this.dir, { persistent: true }, (_evt, name) => {
      if (name) this.consider(path.join(this.dir, name.toString()));
    });
    this.watcher.on('error', err => this.emit('error', err));
  }

  stop() {
    if (this.watcher) this.watcher.close();
    this.watcher = null;
  }

  /** Traite les fichiers arrivés pendant que l'app était fermée. */
  scanSince(sinceMs) {
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch { return; }
    for (const n of names) {
      const full = path.join(this.dir, n);
      try {
        const st = fs.statSync(full);
        if (st.isFile() && Math.max(st.mtimeMs, st.birthtimeMs) > sinceMs) this.consider(full);
      } catch { /* ignore */ }
    }
  }

  consider(file) {
    if (TEMP_EXT.test(file) || !isRelevant(file) || this.pending.has(file)) return;
    this.pending.add(file);
    this.waitUntilReady(file)
      .then(ok => { if (ok) this.emit('file', file); })
      .finally(() => this.pending.delete(file));
  }

  async waitUntilReady(file) {
    let last = -1, stable = 0;
    for (let i = 0; i < 600; i++) { // 10 min max
      let st;
      try { st = fs.statSync(file); } catch { return false; } // renommé / supprimé
      if (st.size > 0 && st.size === last) stable++; else stable = 0;
      last = st.size;
      if (stable >= 2) {
        try {
          const fd = fs.openSync(file, 'r+');
          fs.closeSync(fd);
          return true;
        } catch { /* encore verrouillé */ }
      }
      await sleep(1000);
    }
    return false;
  }
}

module.exports = { DownloadWatcher };
