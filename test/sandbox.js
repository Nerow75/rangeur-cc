'use strict';
// Prépare un bac à sable pour lancer l'app sans toucher aux vrais dossiers.
//   node test/sandbox.js init <dir>
//   node test/sandbox.js drop <dir>   (simule des téléchargements TSR)
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { makePackage } = require('./fixtures');

const [cmd, dirArg] = process.argv.slice(2);
const dir = path.resolve(dirArg);
const sims = path.join(dir, 'Documents', 'Electronic Arts', 'Les\u00a0Sims\u00a04');
const dl = path.join(dir, 'Downloads');
const zone = (f, ref) => fs.writeFileSync(f + ':Zone.Identifier', `[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=${ref}\r\n`);

if (cmd === 'init') {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(sims, 'saves'), { recursive: true });
  fs.mkdirSync(dl, { recursive: true });
  fs.writeFileSync(path.join(sims, 'Options.ini'), '[options]\r\nmodsdisabled = 0\r\n\r\nscriptmodsenabled = 0\r\n');
} else if (cmd === 'drop') {
  const items = [1798232, 1798240, 1798233, 1798235];
  items.forEach((id, i) => {
    const f = path.join(dl, `TSR_item_${id}.package`);
    fs.writeFileSync(f, makePackage(10 + i));
    zone(f, `https://www.thesimsresource.com/downloads/download/itemId/${id}/`);
  });
  const zip = new AdmZip();
  zip.addFile('Pack/mod.ts4script', Buffer.from('script'));
  zip.addFile('Pack/mod.package', makePackage(30));
  const z = path.join(dl, 'Super_mod_de_gameplay.zip');
  zip.writeZip(z);
  zone(z, 'https://www.thesimsresource.com/downloads/download/itemId/1798238/');
  const plain = path.join(dl, 'cheveux_boucles_sans_source.package');
  fs.writeFileSync(plain, makePackage(40));
}
