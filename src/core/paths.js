'use strict';
// Détection des dossiers des Sims 4.
// Le nom du dossier dépend de la langue du jeu ("The Sims 4", "Les Sims 4" avec
// des espaces insécables, "Die Sims 4"...), donc on ne l'écrit jamais en dur :
// on cherche dans "Electronic Arts" les sous-dossiers qui ressemblent à un
// dossier utilisateur des Sims 4.

const fs = require('fs');
const path = require('path');
const os = require('os');

const MARKERS = ['Options.ini', 'Mods', 'saves', 'Tray', 'GameVersion.txt'];

const DEFAULT_RESOURCE_CFG = [
  'Priority 500',
  'PackedFile *.package',
  'PackedFile */*.package',
  'PackedFile */*/*.package',
  'PackedFile */*/*/*.package',
  'PackedFile */*/*/*/*.package',
  'PackedFile */*/*/*/*/*.package',
  ''
].join('\r\n');

function mtimeOf(p) {
  try { return fs.statSync(p).mtimeMs; } catch { return 0; }
}

function candidateDocumentDirs(documentsDir) {
  if (process.env.RCC_SANDBOX) return [path.resolve(documentsDir)];
  const home = os.homedir();
  const list = [documentsDir, path.join(home, 'Documents'), path.join(home, 'OneDrive', 'Documents')];
  try {
    for (const name of fs.readdirSync(home)) {
      if (/^OneDrive/i.test(name)) {
        list.push(path.join(home, name, 'Documents'), path.join(home, name, 'Documenti'));
      }
    }
  } catch { /* ignore */ }
  return [...new Set(list.filter(Boolean).map(p => path.resolve(p)))];
}

/**
 * Liste les dossiers utilisateur Sims 4 trouvés, le plus récemment utilisé en premier.
 * @returns {{path:string,name:string,lastUsed:number}[]}
 */
function findSimsUserDirs(documentsDir) {
  const found = new Map();
  for (const docs of candidateDocumentDirs(documentsDir)) {
    const ea = path.join(docs, 'Electronic Arts');
    let entries = [];
    try { entries = fs.readdirSync(ea, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(ea, e.name);
      const hits = MARKERS.filter(m => fs.existsSync(path.join(dir, m))).length;
      if (hits < 2 || !/4/.test(e.name)) continue;
      const lastUsed = Math.max(
        mtimeOf(path.join(dir, 'Options.ini')),
        mtimeOf(path.join(dir, 'Config.log')),
        mtimeOf(path.join(dir, 'saves'))
      );
      found.set(dir.toLowerCase(), { path: dir, name: e.name.replace(/ /g, ' '), lastUsed });
    }
  }
  return [...found.values()].sort((a, b) => b.lastUsed - a.lastUsed);
}

/** Crée le dossier Mods (et un Resource.cfg standard) s'il n'existe pas. */
function ensureModsDir(simsDir) {
  const mods = path.join(simsDir, 'Mods');
  fs.mkdirSync(mods, { recursive: true });
  const cfg = path.join(mods, 'Resource.cfg');
  if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, DEFAULT_RESOURCE_CFG);
  return mods;
}

function layout(simsDir) {
  return {
    simsDir,
    modsDir: path.join(simsDir, 'Mods'),
    trayDir: path.join(simsDir, 'Tray'),
    disabledDir: path.join(simsDir, 'Mods désactivés'),
    optionsIni: path.join(simsDir, 'Options.ini')
  };
}

module.exports = { findSimsUserDirs, ensureModsDir, layout, DEFAULT_RESOURCE_CFG };
