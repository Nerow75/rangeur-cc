'use strict';
const zlib = require('zlib');

// PNG 1x1 valide
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
  '1f15c4890000000d49444154789c6360f8cfc0f01f0005000201a5f1f8a90000000049454e44ae426082', 'hex');

/** Fabrique un .package DBPF 2.1 avec une ressource miniature compressée zlib. */
// opts.casName : crée une pièce CAS portant ce nom (ex. "yfHair_Long")
// opts.type    : type de la ressource principale (ex. 0x319e4f1d pour un objet)
function makePackage(seed, opts = {}) {
  const thumb = Buffer.concat([PNG, Buffer.alloc(400, seed)]); // > 256 octets
  let main = Buffer.from('ressource-' + seed);
  if (opts.casName) {
    const name = Buffer.from(opts.casName, 'utf16le').swap16(); // UTF-16 big-endian
    main = Buffer.concat([Buffer.from([0x2e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, name.length]), name, Buffer.alloc(40)]);
  }
  const resources = [
    { type: opts.type ?? 0x034aeecb, data: main, compress: !!opts.casName },
    { type: 0x3c1af1f2, data: thumb, compress: true }
  ];
  const header = Buffer.alloc(96);
  header.write('DBPF', 0, 'ascii');
  header.writeUInt32LE(2, 4); header.writeUInt32LE(1, 8);
  const blobs = [];
  let pos = 96;
  const entries = resources.map(r => {
    const stored = r.compress ? zlib.deflateSync(r.data) : r.data;
    const e = { type: r.type, offset: pos, size: stored.length, mem: r.data.length, comp: r.compress ? 0x5a42 : 0 };
    blobs.push(stored); pos += stored.length;
    return e;
  });
  const index = Buffer.alloc(4 + entries.length * 32);
  let p = 0;
  index.writeUInt32LE(0, p); p += 4;
  for (const e of entries) {
    index.writeUInt32LE(e.type, p); p += 4;
    index.writeUInt32LE(0, p); p += 4;
    index.writeUInt32LE(0, p); p += 4;
    index.writeUInt32LE(seed, p); p += 4;
    index.writeUInt32LE(e.offset, p); p += 4;
    index.writeUInt32LE((e.size | 0x80000000) >>> 0, p); p += 4;
    index.writeUInt32LE(e.mem, p); p += 4;
    index.writeUInt16LE(e.comp, p); p += 2;
    index.writeUInt16LE(1, p); p += 2;
  }
  header.writeUInt32LE(entries.length, 36);
  header.writeUInt32LE(index.length, 44);
  header.writeUInt32LE(3, 60);
  header.writeUInt32LE(pos, 64);
  return Buffer.concat([header, ...blobs, index]);
}

module.exports = { makePackage, PNG };

/** Archive RAR 4 minimale (fichiers stockés sans compression), pour les tests. */
function makeRar(files) {
  const zlib = require('zlib');
  const crc = b => zlib.crc32(b) >>> 0;
  const block = body => { const c = Buffer.alloc(2); c.writeUInt16LE(crc(body) & 0xffff); return Buffer.concat([c, body]); };
  const parts = [Buffer.from('526172211a0700', 'hex')];
  const arc = Buffer.alloc(11); arc[0] = 0x73; arc.writeUInt16LE(0, 1); arc.writeUInt16LE(13, 3);
  parts.push(block(arc));
  for (const [name, data] of files) {
    const n = Buffer.from(name, 'latin1');
    const h = Buffer.alloc(30 + n.length);
    let p = 0;
    h[p++] = 0x74; h.writeUInt16LE(0x8000, p); p += 2; h.writeUInt16LE(32 + n.length, p); p += 2;
    h.writeUInt32LE(data.length, p); p += 4; h.writeUInt32LE(data.length, p); p += 4;
    h[p++] = 2; h.writeUInt32LE(crc(data), p); p += 4; h.writeUInt32LE(0x5a210000, p); p += 4;
    h[p++] = 20; h[p++] = 0x30; h.writeUInt16LE(n.length, p); p += 2; h.writeUInt32LE(0x20, p); p += 4;
    n.copy(h, p);
    parts.push(block(h), data);
  }
  parts.push(Buffer.from('c43d7b00400700', 'hex'));
  return Buffer.concat(parts);
}
module.exports.makeRar = makeRar;
