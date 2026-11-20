'use strict';
// Tests du circuit d'installation sans Electron : node test/run.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const assert = require('assert');
const { execFileSync } = require('child_process');

const { installDownload, setEnabled, itemDir } = require('../src/core/installer');
const { extractThumbnail } = require('../src/core/dbpf');
const { findSimsUserDirs, ensureModsDir, layout } = require('../src/core/paths');
const { readZoneInfo } = require('../src/core/zone');
const { readModOptions, enableMods } = require('../src/core/options');
const { Store } = require('../src/core/store');
const { tsrItemId, candidatePages } = require('../src/core/preview');
const { categoryFromUrl, categoryFromPackage, categorize } = require('../src/core/categorize');

const { makePackage, makeRar, PNG } = require('./fixtures');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n       ')); process.exitCode = 1; }
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-test-'));
  const docs = path.join(root, 'Documents');
  const simsDir = path.join(docs, 'Electronic Arts', 'Les Sims 4'); // espaces insécables comme le vrai
  fs.mkdirSync(path.join(simsDir, 'saves'), { recursive: true });
  fs.writeFileSync(path.join(simsDir, 'Options.ini'), '[options]\r\nmodsdisabled = 1\r\n\r\nscriptmodsenabled = 0\r\n');
  const sims3 = path.join(docs, 'Electronic Arts', 'Les Sims 3');
  fs.mkdirSync(path.join(sims3, 'saves'), { recursive: true }); fs.mkdirSync(path.join(sims3, 'Mods'));
  const dl = path.join(root, 'Downloads'); fs.mkdirSync(dl);

  const paths = layout(simsDir);
  const store = new Store(path.join(root, 'app', 'library.json'), { removeAfterInstall: true });
  const trashed = [];
  const ctx = {
    paths, store, cacheDir: path.join(root, 'app', 'previews'), settings: store.settings,
    trash: async p => { trashed.push(p); fs.rmSync(p, { force: true }); },
    fetchPreview: async zone => zone.referrerUrl && /1798232/.test(zone.referrerUrl)
      ? { pageUrl: 'https://www.thesimsresource.com/members/DOLilac/downloads/details/category/sims4-clothing-female-elder-everyday/title/x/id/1798232/', name: 'Rebel Heart Set', creator: 'DOLilac', image: { ext: 'jpg', data: Buffer.alloc(2000, 1) } }
      : null
  };

  console.log('Rangeur CC : tests');

  await test('détecte le dossier Sims 4 (espaces insécables), ignore les Sims 3', () => {
    const found = findSimsUserDirs(docs).filter(d => d.path.startsWith(root));
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].path, simsDir);
    assert.strictEqual(found[0].name, 'Les Sims 4');
    ensureModsDir(simsDir);
    assert.ok(fs.readFileSync(path.join(paths.modsDir, 'Resource.cfg'), 'utf8').includes('*/*/*/*/*.package'));
  });

  await test('lit et corrige les options mods du jeu', () => {
    assert.deepStrictEqual(readModOptions(paths.optionsIni), { modsEnabled: false, scriptModsEnabled: false });
    enableMods(paths.optionsIni);
    assert.deepStrictEqual(readModOptions(paths.optionsIni), { modsEnabled: true, scriptModsEnabled: true });
    assert.ok(fs.existsSync(paths.optionsIni + '.rangeurcc.bak'));
  });

  await test('extrait la miniature d\'un .package', () => {
    const f = path.join(root, 't.package'); fs.writeFileSync(f, makePackage(7));
    const t = extractThumbnail(f);
    assert.strictEqual(t.ext, 'png');
    assert.ok(t.data.subarray(0, 8).equals(PNG.subarray(0, 8)));
  });

  await test('reconnaît les URL TSR', () => {
    assert.strictEqual(tsrItemId('https://www.thesimsresource.com/downloads/download/itemId/1798232/'), '1798232');
    assert.strictEqual(tsrItemId('https://www.thesimsresource.com/members/X/downloads/details/category/a/title/b/id/1798240/'), '1798240');
    assert.deepStrictEqual(candidatePages({ referrerUrl: 'https://www.thesimsresource.com/downloads/download/itemId/55555/' }), ['https://www.thesimsresource.com/downloads/55555']);
  });

  let pkgItem;
  await test('installe un .package TSR avec la page d\'origine (Zone.Identifier)', async () => {
    const f = path.join(dl, 'TSR_rebel_heart_bottom.package');
    fs.writeFileSync(f, makePackage(1));
    fs.writeFileSync(f + ':Zone.Identifier', '[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://www.thesimsresource.com/downloads/download/itemId/1798232/\r\nHostUrl=https://cdn.example/f.package\r\n');
    assert.ok(readZoneInfo(f).referrerUrl.includes('1798232'));
    const r = await installDownload(f, ctx);
    assert.strictEqual(r.status, 'installed', r.message);
    pkgItem = r.item;
    assert.strictEqual(pkgItem.name, 'Rebel Heart Set');
    assert.strictEqual(pkgItem.creator, 'DOLilac');
    assert.ok(fs.existsSync(path.join(paths.modsDir, 'Vêtements', 'Rebel Heart Set', 'TSR_rebel_heart_bottom.package')));
    assert.ok(!fs.existsSync(f), 'le fichier a quitté Téléchargements');
    assert.ok(pkgItem.preview.endsWith('.jpg'));
    assert.strictEqual(pkgItem.category, 'Vêtements');
  });

  await test('refuse un doublon', async () => {
    const f = path.join(dl, 'TSR_rebel_heart_bottom (1).package');
    fs.writeFileSync(f, makePackage(1));
    const r = await installDownload(f, ctx);
    assert.strictEqual(r.status, 'duplicate');
    assert.strictEqual(store.items.length, 1);
  });

  await test('installe un .zip (package + script + Tray + archive imbriquée), sans aperçu web', async () => {
    const AdmZip = require('adm-zip');
    const inner = new AdmZip(); inner.addFile('deep/inner.package', makePackage(3));
    const zip = new AdmZip();
    zip.addFile('Mon Set/part1.package', makePackage(2));
    zip.addFile('Mon Set/scripts/mod.ts4script', Buffer.from('PK-fake-script'));
    zip.addFile('Mon Set/Lot/0x00000000123.trayitem', Buffer.from('tray'));
    zip.addFile('Mon Set/readme.txt', Buffer.from('hello'));
    zip.addFile('__MACOSX/Mon Set/._part1.package', Buffer.from('junk'));
    zip.addFile('../../evil.package', makePackage(9));
    zip.addFile('bundle.zip', inner.toBuffer());
    const f = path.join(dl, 'Mon_super_set.zip'); zip.writeZip(f);
    const r = await installDownload(f, ctx);
    assert.strictEqual(r.status, 'installed', r.message);
    const dir = path.join(paths.modsDir, '[Script] Mon super set'); // 1 seul niveau pour le script
    const files = fs.readdirSync(dir).sort();
    assert.deepStrictEqual(files, ['evil.package', 'inner.package', 'mod.ts4script', 'part1.package']);
    assert.ok(fs.existsSync(path.join(paths.trayDir, '0x00000000123.trayitem')));
    assert.ok(!fs.existsSync(path.join(root, 'evil.package')) && !fs.existsSync(path.join(docs, 'evil.package')));
    assert.ok(r.item.hasScript);
    assert.ok(r.item.preview.endsWith('.png'), 'miniature tirée du .package');
    assert.ok(trashed.includes(f));
  });

  await test('installe un .7z', async () => {
    const src = path.join(root, '7src'); fs.mkdirSync(path.join(src, 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(src, 'a', 'b', 'hair.package'), makePackage(4, { casName: 'yfHair_EP01_LongWavy' }));
    const f = path.join(dl, 'Coiffure.7z');
    execFileSync(require('7zip-bin').path7za, ['a', f, path.join(src, '*'), '-r'], { stdio: 'ignore' });
    const r = await installDownload(f, ctx);
    assert.strictEqual(r.status, 'installed', r.message);
    assert.ok(fs.existsSync(path.join(paths.modsDir, 'Cheveux', 'Coiffure', 'hair.package')));
  });

  await test('installe un .rar', async () => {
    const f = path.join(dl, 'Robe_soiree.rar');
    fs.writeFileSync(f, makeRar([['Robe/robe.package', makePackage(5)], ['Robe\\sous\\robe2.package', makePackage(6)], ['Robe/lisez-moi.txt', Buffer.from('x')]]));
    const r = await installDownload(f, ctx);
    assert.strictEqual(r.status, 'installed', r.message);
    assert.deepStrictEqual(fs.readdirSync(path.join(paths.modsDir, 'Vêtements', 'Robe soiree')), ['robe.package', 'robe2.package']);
  });

  await test('devine la catégorie (URL TSR, contenu du .package, nom)', () => {
    const tsr = slug => categoryFromUrl(`https://www.thesimsresource.com/members/A/downloads/details/category/sims4-${slug}/title/x/id/1/`);
    assert.strictEqual(tsr('hair-hairstyles'), 'Cheveux');
    assert.strictEqual(tsr('hair-facial-beards'), 'Cheveux');
    assert.strictEqual(tsr('makeup-female-lipstick'), 'Maquillage');
    assert.strictEqual(tsr('makeup-female-eyecolors'), 'Peau et yeux');
    assert.strictEqual(tsr('skintones'), 'Peau et yeux');
    assert.strictEqual(tsr('accessories-female-earrings'), 'Accessoires');
    assert.strictEqual(tsr('shoes'), 'Chaussures');
    assert.strictEqual(tsr('clothing-female-elder-everyday'), 'Vêtements');
    assert.strictEqual(tsr('objects'), 'Meubles et objets');
    assert.strictEqual(tsr('objectrecolors-furnishing-comfort-beds'), 'Meubles et objets');
    assert.strictEqual(tsr('sets-objects-adultbedroom'), 'Meubles et objets');
    assert.strictEqual(tsr('sets-makeup'), 'Maquillage');
    assert.strictEqual(tsr('floors'), 'Construction');
    assert.strictEqual(tsr('walls'), 'Construction');
    assert.strictEqual(tsr('terrainpaint'), 'Construction');
    assert.strictEqual(tsr('lots-residential'), 'Lots et Sims');
    assert.strictEqual(tsr('pets'), 'Animaux');
    assert.strictEqual(tsr('mods'), 'Mods de gameplay');
    const pkg = (n, o) => { const f = path.join(root, n); fs.writeFileSync(f, makePackage(60, o)); return f; };
    assert.strictEqual(categoryFromPackage(pkg('a.package', { casName: 'yfLipstick_Matte' })), 'Maquillage');
    assert.strictEqual(categoryFromPackage(pkg('a2.package', { casName: 'yfHair_EP01_LongWavy' })), 'Cheveux');
    assert.strictEqual(categoryFromPackage(pkg('b.package', { casName: 'ymShoes_Boots' })), 'Chaussures');
    assert.strictEqual(categoryFromPackage(pkg('c.package', { casName: 'yuEyebrows_Soft' })), 'Peau et yeux');
    assert.strictEqual(categoryFromPackage(pkg('d.package', { casName: 'yfTop_Crop' })), 'Vêtements');
    assert.strictEqual(categoryFromPackage(pkg('e.package', { type: 0x319e4f1d })), 'Meubles et objets');
    assert.strictEqual(categorize({ packages: [], name: 'Canapé sofa moderne' }), 'Meubles et objets');
    assert.strictEqual(categorize({ packages: [], name: 'truc' }), 'Autres');
    assert.strictEqual(categorize({ urls: ['https://www.thesimsresource.com/members/A/downloads/details/category/sims4-lots-residential/title/x/id/1/'], packages: [pkg('l.package')], name: 'Villa' }), 'Lots et Sims');
    assert.strictEqual(categorize({ packages: [pkg('f.package')], name: 'cheveux bouclés sans source' }), 'Cheveux');
    assert.strictEqual(categorize({ packages: [pkg('g.package')], name: 'Robe de soirée' }), 'Vêtements');
    assert.strictEqual(categorize({ packages: [pkg('h.package')], name: 'xyz' }), 'Vêtements');
    assert.strictEqual(categorize({ packages: [], name: "Boucles d'oreilles dorées" }), 'Accessoires');
    assert.strictEqual(categorize({ packages: [], name: 'Canapé moderne' }), 'Meubles et objets');
  });

  await test('sans tri par catégorie, tout va à la racine de Mods', async () => {
    const f = path.join(dl, 'Sans_tri.package'); fs.writeFileSync(f, makePackage(70));
    const r = await installDownload(f, { ...ctx, settings: { ...ctx.settings, sortByCategory: false } });
    assert.ok(fs.existsSync(path.join(paths.modsDir, 'Sans tri', 'Sans_tri.package')));
    store.removeItem(r.item.id);
  });

  await test('ignore une archive sans contenu Sims', async () => {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(); zip.addFile('photo.jpg', Buffer.alloc(10));
    const f = path.join(dl, 'vacances.zip'); zip.writeZip(f);
    const r = await installDownload(f, ctx);
    assert.strictEqual(r.status, 'ignored');
    assert.ok(fs.existsSync(f), 'le fichier reste en place');
  });

  await test('désactive puis réactive un CC', () => {
    const it = store.getItem(pkgItem.id);
    let folder = setEnabled(it, false, paths);
    store.updateItem(it.id, { enabled: false, folder });
    assert.strictEqual(folder, path.join('Vêtements', 'Rebel Heart Set'));
    assert.ok(fs.existsSync(path.join(paths.disabledDir, 'Vêtements', 'Rebel Heart Set', 'TSR_rebel_heart_bottom.package')));
    assert.ok(!fs.existsSync(path.join(paths.modsDir, folder)));
    folder = setEnabled(it, true, paths);
    store.updateItem(it.id, { enabled: true, folder });
    assert.ok(fs.existsSync(path.join(itemDir(it, paths), 'TSR_rebel_heart_bottom.package')));
  });

  await test('la bibliothèque est persistée', () => {
    const again = new Store(path.join(root, 'app', 'library.json'), {});
    assert.strictEqual(again.items.length, 4);
  });

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} test(s) réussi(s)` + (process.exitCode ? ', avec des échecs' : ''));
})();
