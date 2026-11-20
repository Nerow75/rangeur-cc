'use strict';
// Lecture / correction des réglages "Activer le contenu personnalisé et les mods"
// dans Options.ini. Le jeu réécrit ce fichier en quittant : on ne le modifie
// donc que lorsque le jeu est fermé.

const fs = require('fs');
const { execFile } = require('child_process');

function readModOptions(optionsIni) {
  let txt;
  try { txt = fs.readFileSync(optionsIni, 'utf8'); } catch { return null; }
  const get = key => {
    const m = txt.match(new RegExp('^\\s*' + key + '\\s*=\\s*(\\d+)', 'mi'));
    return m ? Number(m[1]) : null;
  };
  const modsDisabled = get('modsdisabled');
  const scriptMods = get('scriptmodsenabled');
  return {
    modsEnabled: modsDisabled !== 1,
    scriptModsEnabled: scriptMods === 1
  };
}

function enableMods(optionsIni) {
  let txt = fs.readFileSync(optionsIni, 'utf8');
  const set = (key, val) => {
    const re = new RegExp('^(\\s*' + key + '\\s*=\\s*)\\d+', 'mi');
    if (re.test(txt)) txt = txt.replace(re, '$1' + val);
    else txt = txt.replace(/\[options\]\s*\r?\n/i, m => m + key + ' = ' + val + '\r\n\r\n');
  };
  set('modsdisabled', 0);
  set('scriptmodsenabled', 1);
  fs.copyFileSync(optionsIni, optionsIni + '.rangeurcc.bak');
  fs.writeFileSync(optionsIni, txt);
}

function isGameRunning() {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve(false);
    execFile('tasklist', ['/FI', 'IMAGENAME eq TS4_x64.exe', '/NH'], { windowsHide: true }, (err, out) => {
      resolve(!err && /TS4_x64\.exe/i.test(out || ''));
    });
  });
}

module.exports = { readModOptions, enableMods, isGameRunning };
