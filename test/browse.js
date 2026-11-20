'use strict';
// Tests de la navigation TSR, hors ligne (fausse page de liste) : node test/browse.js
const assert = require('assert');
const { TsrBrowser, parseListing } = require('../src/core/tsr-browse');
const { classifyTsr } = require('../src/core/taxonomy');

const enc = o => JSON.stringify(o).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const item = (id, slug, title, extra = {}) => `<div class="item-wrapper" data-item="${enc({
  ID: String(id), title, PrimaryCategory: slug, title_urlVersion: 't', creatorName: 'Créa', downloads: String(id * 10),
  publishDate: String(1790000000 + id), hasEarlyAccess: 0, featuredImage: '1',
  images: { 1: { small: { src: `/scaled/1/${id}.jpg` }, details: { src: `/scaled/1/d${id}.jpg` } } }, ...extra
})}"></div>`;

(async () => {
  let n = 0;
  const ok = (name, fn) => Promise.resolve(fn()).then(() => { n++; console.log('  ok  ' + name); });

  await ok('lit une page de liste TSR', () => {
    const [a] = parseListing(item(7, 'sims4-hair-hairstyles', 'MIRA_Kitchen__Toaster.package', { hasEarlyAccess: 1 }));
    assert.strictEqual(a.title, 'MIRA Kitchen Toaster');
    assert.strictEqual(a.image, 'https://www.thesimsresource.com/scaled/1/7.jpg');
    assert.strictEqual(a.url, 'https://www.thesimsresource.com/downloads/details/category/sims4-hair-hairstyles/title/t/id/7/');
    assert.strictEqual(a.earlyAccess, true);
    assert.strictEqual(a.downloads, 70);
  });

  await ok('corrige un objet mal rangé par son créateur', () => {
    assert.deepStrictEqual(classifyTsr({ slug: 'objects-furnishing-surfaces-counters', title: 'Pumpkin Latte Reading Corner - Zig Zag Shelf' }).subs, ['Salon']);
  });

  await ok('filtre par sous-rayon et pagine', async () => {
    const pages = {
      'sims4-hair-hairstyles/': item(1, 'sims4-hair-hairstyles', "Men's short hair") + item(2, 'sims4-hair-hairstyles', 'Long wavy hair', { description: 'Female teen to elder' }),
      'sims4-hair-hairstyles/page/2/': item(3, 'sims4-hair-hairstyles', 'Buzz cut', { keywords: 'male,short' }),
      'sims4-hair-hairstyles-male/': item(4, 'sims4-hair-hairstyles-male', 'Classic quiff')
    };
    const calls = [];
    const fetchImpl = async url => {
      const k = url.replace('https://www.thesimsresource.com/downloads/browse/category/', '');
      calls.push(k);
      return { ok: true, status: 200, text: async () => pages[k] || '' };
    };
    const b = new TsrBrowser({ fetchImpl });
    const r = await b.more({ category: 'Cheveux', sub: 'Homme' });
    assert.deepStrictEqual(r.items.map(i => i.id).sort(), ['1', '3', '4']);
    assert.ok(r.done);
    assert.ok(calls.every(c => !/search/.test(c)), 'jamais de page /search/ (interdite par robots.txt)');
    const before = calls.length;
    const f = await b.more({ category: 'Cheveux', sub: 'Femme', reset: true });
    assert.deepStrictEqual(f.items.map(i => i.id), ['2']);
    assert.ok(calls.length - before <= 3, 'les pages déjà lues viennent du cache');
  });

  console.log(`\n${n} test(s) réussi(s)`);
})().catch(e => { console.error('  FAIL', e); process.exitCode = 1; });
