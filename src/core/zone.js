'use strict';
// Windows ajoute à chaque fichier téléchargé un flux NTFS caché "Zone.Identifier"
// qui contient la page d'origine (ReferrerUrl) et l'adresse du fichier (HostUrl).
// Chrome, Edge et Firefox l'écrivent : pas besoin d'extension navigateur.

const fs = require('fs');

function readZoneInfo(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath + ':Zone.Identifier', 'utf8');
  } catch {
    return {};
  }
  const info = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(ReferrerUrl|HostUrl)\s*=\s*(.+?)\s*$/i);
    if (m) info[m[1].toLowerCase() === 'referrerurl' ? 'referrerUrl' : 'hostUrl'] = m[2];
  }
  return info;
}

module.exports = { readZoneInfo };
