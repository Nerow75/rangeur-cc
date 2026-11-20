'use strict';
// Installation d'un téléchargement : .package / .ts4script directement,
// ou archive .zip / .rar / .7z dont on extrait le contenu Sims.
//
// Règles du jeu respectées :
//  - chaque CC va dans Mods/<Catégorie>/<Sous-catégorie>/<Nom du CC>/ (.package : 5 niveaux max)
//  - un mod de script va dans Mods/[Script] <Nom>/ (.ts4script : 1 niveau max)
//  - les fichiers de lots / foyers / pièces vont à plat dans Tray/

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

const { readZoneInfo } = require('./zone');
const { extractThumbnail } = require('./dbpf');
const { fetchPagePreview } = require('./preview');
const { categorizeDetailed } = require('./categorize');

const MOD_EXT = new Set(['.package', '.ts4script']);
const TRAY_EXT = new Set(['.trayitem', '.blueprint', '.bpi', '.hhi', '.sgi', '.householdbinary', '.room', '.rmi']);
const ARCHIVE_EXT = new Set(['.zip', '.rar', '.7z']);
const RELEVANT_EXT = new Set([...MOD_EXT, ...TRAY_EXT, ...ARCHIVE_EXT]);

const extOf = p => path.extname(p).toLowerCase();
const isRelevant = p => RELEVANT_EXT.has(extOf(p));

function sanitizeName(s, max = 60) {
  let out = String(s || '')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (out.length > max) out = out.slice(0, max).trim();
  out = out.replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(out)) out = '_' + out;
  return out || 'CC';
}

function nameFromFile(file) {
  return path.basename(file, path.extname(file))
    .replace(/^(the)?_?sims_?resource[_ -]*/i, '')
    .replace(/^TSR[_ -]+/i, '')
    .replace(/\s*\(\d+\)$/, '') // "fichier (1)" des doublons de navigateur
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'CC';
}

function uniquePath(dir, name, isFile) {
  const ext = isFile ? path.extname(name) : '';
  const base = isFile ? name.slice(0, name.length - ext.length) : name;
  let candidate = path.join(dir, name);
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`);
  return candidate;
}

function sha1(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

function moveFile(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
}

function sevenZipPath() {
  const p = require('7zip-bin').path7za;
  return p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
}

/** Extrait à plat les fichiers utiles d'une archive dans outDir. Renvoie leurs chemins. */
async function extractArchive(archive, outDir, depth = 0) {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  const wanted = name => {
    const e = extOf(name);
    return MOD_EXT.has(e) || TRAY_EXT.has(e) || (ARCHIVE_EXT.has(e) && depth < 1);
  };
  const write = (name, data) => {
    const dest = uniquePath(outDir, sanitizeName(path.basename(name.replace(/\\/g, '/')), 120), true);
    fs.writeFileSync(dest, data);
    written.push(dest);
  };

  const ext = extOf(archive);
  if (ext === '.zip') {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(archive);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !wanted(entry.entryName) || /__MACOSX/i.test(entry.entryName)) continue;
      write(entry.entryName, entry.getData());
    }
  } else if (ext === '.rar') {
    const { createExtractorFromData } = require('node-unrar-js');
    const data = fs.readFileSync(archive);
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const extractor = await createExtractorFromData({ data: buf });
    const { files } = extractor.extract({ files: h => !h.flags.directory && wanted(h.name) });
    for (const f of files) if (f.extraction) write(f.fileHeader.name, Buffer.from(f.extraction));
  } else if (ext === '.7z') {
    const tmp = fs.mkdtempSync(path.join(outDir, '7z-'));
    await new Promise((resolve, reject) => {
      execFile(sevenZipPath(), ['e', archive, '-o' + tmp, '-y', '-r', '-bd'], { windowsHide: true }, err => err ? reject(err) : resolve());
    });
    for (const f of fs.readdirSync(tmp)) {
      const full = path.join(tmp, f);
      if (fs.statSync(full).isFile() && wanted(f)) {
        const dest = uniquePath(outDir, sanitizeName(f, 120), true);
        fs.renameSync(full, dest);
        written.push(dest);
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // Archives dans l'archive (un niveau)
  const result = [];
  for (const f of written) {
    if (ARCHIVE_EXT.has(extOf(f))) {
      try { result.push(...await extractArchive(f, path.join(outDir, 'sub-' + path.basename(f)), depth + 1)); } catch { /* ignorée */ }
    } else {
      result.push(f);
    }
  }
  return result;
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise(r => setTimeout(() => r(null), ms))]);
}

/**
 * @param {string} filePath  fichier téléchargé
 * @param {object} ctx { paths, store, cacheDir, trash(p):Promise, settings, fetchPreview? }
 * @returns {Promise<{status:'installed'|'duplicate'|'ignored', item?:object, message:string}>}
 */
async function installDownload(filePath, ctx) {
  const ext = extOf(filePath);
  if (!RELEVANT_EXT.has(ext)) return { status: 'ignored', message: 'Type de fichier non concerné' };

  const { paths, store, cacheDir } = ctx;
  const zone = readZoneInfo(filePath);
  const previewPromise = (ctx.fetchPreview ?? fetchPagePreview)(zone).catch(() => null);

  let tmpDir = null;
  let files;
  const isArchive = ARCHIVE_EXT.has(ext);
  if (isArchive) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rangeur-cc-'));
    files = await extractArchive(filePath, tmpDir);
  } else {
    files = [filePath];
  }

  try {
    const modFiles = files.filter(f => MOD_EXT.has(extOf(f)));
    const trayFiles = files.filter(f => TRAY_EXT.has(extOf(f)));
    if (!modFiles.length && !trayFiles.length) {
      return { status: 'ignored', message: 'Aucun contenu Sims 4 dans ' + path.basename(filePath) };
    }

    const hashes = modFiles.map(sha1);
    if (hashes.length && hashes.every(h => store.hasHash(h))) {
      if (ctx.settings.removeAfterInstall) await ctx.trash(filePath);
      const dup = store.items.find(i => (i.hashes || []).includes(hashes[0]));
      return { status: 'duplicate', item: dup, message: `Déjà installé : ${dup ? dup.name : path.basename(filePath)}` };
    }

    const preview = await withTimeout(previewPromise, 12000);
    const name = (preview && preview.name) || nameFromFile(filePath);
    const id = crypto.randomUUID();

    const hasScript = modFiles.some(f => extOf(f) === '.ts4script');
    const { category, sub: subcategory } = categorizeDetailed({
      urls: [preview && preview.pageUrl, zone.referrerUrl, zone.hostUrl],
      packages: modFiles.filter(f => extOf(f) === '.package'),
      hasScript,
      trayOnly: !modFiles.length,
      name,
      description: (preview && preview.description) || ''
    });

    // Fichiers de mods -> Mods/<Catégorie>/<Sous-catégorie>/<Nom>/
    // Exception : un .ts4script ne doit pas être à plus d'un niveau de Mods,
    // donc les mods de script vont dans Mods/[Script] <Nom>/.
    let folder = null;
    const installed = [];
    if (modFiles.length) {
      const sort = ctx.settings.sortByCategory !== false;
      const parent = sort && !hasScript
        ? path.join(paths.modsDir, category, ...(subcategory ? [sanitizeName(subcategory)] : []))
        : paths.modsDir;
      const dirName = sanitizeName(sort && hasScript ? `[Script] ${name}` : name);
      fs.mkdirSync(parent, { recursive: true });
      const dir = uniquePath(parent, dirName, false);
      fs.mkdirSync(dir);
      folder = path.relative(paths.modsDir, dir);
      for (const f of modFiles) {
        const dest = uniquePath(dir, sanitizeName(path.basename(f), 120), true);
        moveFile(f, dest);
        installed.push(path.basename(dest));
      }
    }

    // Lots / foyers -> Tray/ (à plat, c'est obligatoire)
    const trayInstalled = [];
    if (trayFiles.length) {
      fs.mkdirSync(paths.trayDir, { recursive: true });
      for (const f of trayFiles) {
        const dest = path.join(paths.trayDir, path.basename(f));
        if (fs.existsSync(dest)) continue;
        moveFile(f, dest);
        trayInstalled.push(path.basename(dest));
      }
    }

    if (isArchive && ctx.settings.removeAfterInstall) await ctx.trash(filePath);

    // Aperçu : image de la page en priorité, sinon miniature du .package
    let previewFile = null;
    fs.mkdirSync(cacheDir, { recursive: true });
    if (preview && preview.image) {
      previewFile = `${id}.${preview.image.ext}`;
      fs.writeFileSync(path.join(cacheDir, previewFile), preview.image.data);
    } else if (folder) {
      for (const f of installed.filter(n => n.toLowerCase().endsWith('.package'))) {
        const thumb = extractThumbnail(path.join(paths.modsDir, folder, f));
        if (thumb) {
          previewFile = `${id}.${thumb.ext}`;
          fs.writeFileSync(path.join(cacheDir, previewFile), thumb.data);
          break;
        }
      }
    }

    const item = {
      id,
      name,
      creator: (preview && preview.creator) || null,
      folder,
      enabled: true,
      files: installed,
      trayFiles: trayInstalled,
      hashes,
      hasScript,
      category,
      subcategory: subcategory || null,
      kind: modFiles.length ? 'mod' : 'tray',
      sourceUrl: (preview && preview.pageUrl) || zone.referrerUrl || null,
      preview: previewFile,
      originalName: path.basename(filePath),
      installedAt: Date.now()
    };
    store.addItem(item);
    return { status: 'installed', item, message: `Installé : ${name}` };
  } finally {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Active / désactive : déplace le dossier entre Mods et "Mods désactivés". */
// La structure Catégorie/Nom est conservée des deux côtés.
function setEnabled(item, enabled, paths) {
  if (!item.folder || item.enabled === enabled) return item.folder;
  const fromBase = enabled ? paths.disabledDir : paths.modsDir;
  const toBase = enabled ? paths.modsDir : paths.disabledDir;
  const from = path.join(fromBase, item.folder);
  const toParent = path.join(toBase, path.dirname(item.folder));
  fs.mkdirSync(toParent, { recursive: true });
  const to = uniquePath(toParent, path.basename(item.folder), false);
  fs.renameSync(from, to);
  removeIfEmpty(path.dirname(from), fromBase);
  return path.relative(toBase, to);
}

/** Supprime les dossiers de catégorie devenus vides, en remontant (jamais Mods lui-même). */
function removeIfEmpty(dir, base) {
  const root = path.resolve(base);
  let d = path.resolve(dir);
  while (d !== root && d.startsWith(root + path.sep)) {
    try { if (fs.readdirSync(d).length) return; fs.rmdirSync(d); } catch { return; }
    d = path.dirname(d);
  }
}

function itemDir(item, paths) {
  if (!item.folder) return null;
  return path.join(item.enabled ? paths.modsDir : paths.disabledDir, item.folder);
}

module.exports = {
  installDownload, setEnabled, itemDir, removeIfEmpty, isRelevant, extractArchive,
  sanitizeName, nameFromFile, MOD_EXT, TRAY_EXT, ARCHIVE_EXT
};
