'use strict';
// Lecteur minimal du format .package des Sims 4 (DBPF 2.1), juste assez pour
// extraire une miniature (PNG ou JPEG) embarquée dans le CC.

const fs = require('fs');
const zlib = require('zlib');

// Types de ressources qui contiennent des miniatures, par ordre de préférence.
const THUMB_TYPES = [
  0x3C1AF1F2, // CAS part (vêtements, cheveux...)
  0x5B282D45, // body part
  0x3C2A8647, // objet mode achat / construction
  0x0580A2B4, 0x0580A2B5, 0x0580A2B6, // objets (petite, moyenne, grande)
  0xCD9DE247, 0x9C925813, 0x0D338A3A, // presets, sims, terrains
  0x2F7D0004 // image PNG générique
];
const MAX_IMAGE = 4 * 1024 * 1024;

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  let read = 0;
  while (read < len) {
    const n = fs.readSync(fd, buf, read, len - read, pos + read);
    if (n === 0) break;
    read += n;
  }
  return read === len ? buf : buf.subarray(0, read);
}

function readIndex(fd, fileSize) {
  const h = readAt(fd, 0, 96);
  if (h.length < 96 || h.toString('ascii', 0, 4) !== 'DBPF') throw new Error('Pas un fichier DBPF');
  const major = h.readUInt32LE(4);
  if (major !== 2) throw new Error('Version DBPF non gérée: ' + major);
  const count = h.readUInt32LE(36);
  const indexSize = h.readUInt32LE(44);
  const indexPos = h.readUInt32LE(64) || h.readUInt32LE(40);
  if (!count || !indexPos || indexPos + indexSize > fileSize) return [];

  const idx = readAt(fd, indexPos, indexSize);
  let p = 0;
  const u32 = () => { const v = idx.readUInt32LE(p); p += 4; return v; };
  const u16 = () => { const v = idx.readUInt16LE(p); p += 2; return v; };
  const flags = u32();
  const cType = flags & 1 ? u32() : 0;
  const cGroup = flags & 2 ? u32() : 0;
  const cInstHi = flags & 4 ? u32() : 0;

  const entries = [];
  for (let i = 0; i < count && p < idx.length; i++) {
    const type = flags & 1 ? cType : u32();
    const group = flags & 2 ? cGroup : u32();
    const instHi = flags & 4 ? cInstHi : u32();
    const instLo = u32();
    const offset = u32();
    const rawSize = u32();
    const memSize = u32();
    let compression;
    if (rawSize & 0x80000000) {
      compression = u16();
      u16(); // committed
    } else {
      compression = (rawSize & 0x7fffffff) === memSize ? 0 : 0x5a42;
    }
    entries.push({ type, group, instHi, instLo, offset, size: rawSize & 0x7fffffff, memSize, compression });
  }
  return entries;
}

/** Décompression RefPack (compression "interne" d'EA, 0xFFFF). */
function refpack(src) {
  let p = 0;
  const flags = src[p++];
  if (src[p++] !== 0xfb) throw new Error('RefPack invalide');
  const big = flags & 0x80;
  let outLen = 0;
  for (let i = 0; i < (big ? 4 : 3); i++) outLen = outLen * 256 + src[p++];
  const out = Buffer.alloc(outLen);
  let o = 0;
  while (p < src.length) {
    const cc = src[p++];
    let plain, copy = 0, offset = 0, stop = false;
    if (cc < 0x80) {
      const b1 = src[p++];
      plain = cc & 3;
      copy = ((cc & 0x1c) >> 2) + 3;
      offset = ((cc & 0x60) << 3) + b1 + 1;
    } else if (cc < 0xc0) {
      const b1 = src[p++], b2 = src[p++];
      plain = (b1 & 0xc0) >> 6;
      copy = (cc & 0x3f) + 4;
      offset = ((b1 & 0x3f) << 8) + b2 + 1;
    } else if (cc < 0xe0) {
      const b1 = src[p++], b2 = src[p++], b3 = src[p++];
      plain = cc & 3;
      copy = ((cc & 0x0c) << 6) + b3 + 5;
      offset = ((cc & 0x10) << 12) + (b1 << 8) + b2 + 1;
    } else if (cc < 0xfc) {
      plain = ((cc & 0x1f) << 2) + 4;
    } else {
      plain = cc & 3;
      stop = true;
    }
    for (let i = 0; i < plain && o < outLen; i++) out[o++] = src[p++];
    for (let i = 0; i < copy && o < outLen; i++, o++) out[o] = out[o - offset];
    if (stop || o >= outLen) break;
  }
  return out;
}

function readEntry(fd, e) {
  const raw = readAt(fd, e.offset, e.size);
  switch (e.compression) {
    case 0x0000: return raw;
    case 0x5a42: return zlib.inflateSync(raw);
    case 0xffff: return refpack(raw);
    default: return null; // supprimé / streamable : ignoré
  }
}

function sniffImage(buf) {
  if (!buf || buf.length < 8) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  return null;
}

/**
 * Cherche la meilleure miniature d'un .package.
 * @returns {{ext:'png'|'jpg', data:Buffer}|null}
 */
function extractThumbnail(packagePath) {
  let fd;
  try {
    fd = fs.openSync(packagePath, 'r');
    const { size } = fs.fstatSync(fd);
    const entries = readIndex(fd, size).filter(e =>
      e.memSize > 256 && e.memSize < MAX_IMAGE && e.size > 0 && e.offset + e.size <= size);

    const tryList = list => {
      let best = null;
      for (const e of list) {
        let data;
        try { data = readEntry(fd, e); } catch { continue; }
        const ext = sniffImage(data);
        if (ext && (!best || data.length > best.data.length)) best = { ext, data };
      }
      return best;
    };

    for (const t of THUMB_TYPES) {
      const found = tryList(entries.filter(e => e.type === t).slice(0, 12));
      if (found) return found;
    }
    // Dernier recours : premières ressources de petite taille, au flair.
    return tryList(entries.filter(e => e.memSize < 1024 * 1024).slice(0, 150));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

module.exports = { extractThumbnail, readIndex, refpack, THUMB_TYPES };
