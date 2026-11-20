'use strict';
// Petite base JSON : réglages + liste du CC installé par l'app.

const fs = require('fs');
const path = require('path');

class Store {
  constructor(file, defaults) {
    this.file = file;
    this.data = { settings: { ...defaults }, items: [], lastScanAt: 0 };
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.data = { ...this.data, ...saved, settings: { ...defaults, ...(saved.settings || {}) } };
    } catch { /* première ouverture */ }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get settings() { return this.data.settings; }
  setSettings(patch) { Object.assign(this.data.settings, patch); this.save(); }

  get items() { return this.data.items; }
  getItem(id) { return this.data.items.find(i => i.id === id); }
  addItem(item) { this.data.items.unshift(item); this.save(); }
  updateItem(id, patch) {
    const it = this.getItem(id);
    if (it) { Object.assign(it, patch); this.save(); }
    return it;
  }
  removeItem(id) { this.data.items = this.data.items.filter(i => i.id !== id); this.save(); }

  hasHash(hash) { return this.data.items.some(i => (i.hashes || []).includes(hash)); }
}

module.exports = { Store };
