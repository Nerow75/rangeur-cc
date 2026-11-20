'use strict';
// Parcourt les listes de The Sims Resource et reclasse chaque CC dans notre arborescence.
//
// On ne lit que les pages de listes autorisées par le robots.txt de TSR
// (/downloads/browse/category/...), une requête à la fois, avec un cache.
// Le téléchargement reste sur le site : on ouvre la fiche dans le navigateur.

const { TREE, classifyTsr } = require('./taxonomy');

const BASE = 'https://www.thesimsresource.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const PAGE_TTL = 10 * 60 * 1000;
const MIN_GAP = 400;      // ms entre deux requêtes vers TSR
const WANT = 24;          // résultats visés par chargement
const MAX_PAGES = 6;      // pages lues au plus par source et par chargement

const decode = s => s
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

/** Extrait les CC d'une page de liste TSR (attribut data-item en JSON de chaque vignette). */
function parseListing(html) {
  const out = [];
  for (const m of html.matchAll(/class="item-wrapper"[^>]*?data-item="([^"]*)"/g)) {
    let o;
    try { o = JSON.parse(decode(m[1])); } catch { continue; }
    if (!o || !o.ID || !o.title) continue;
    const img = o.images && (o.images[o.featuredImage] || o.images[1] || Object.values(o.images)[0]);
    const slug = String(o.PrimaryCategory || (o.Categories && o.Categories[0] && o.Categories[0].Path) || '');
    out.push({
      id: String(o.ID),
      title: decode(String(o.title)).replace(/\.package$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim(),
      creator: o.creatorName || o.creator || null,
      slug,
      description: o.description ? decode(String(o.description)) : '',
      keywords: o.keywords || '',
      image: img && img.small ? BASE + img.small.src : null,
      imageLarge: img && img.details ? BASE + img.details.src : null,
      url: `${BASE}/downloads/details/category/${slug}/title/${o.title_urlVersion || 'cc'}/id/${o.ID}/`,
      downloads: Number(o.downloads) || 0,
      date: Number(o.publishDate) * 1000 || 0,
      earlyAccess: !!Number(o.hasEarlyAccess),
      packs: o.GamePacks || null
    });
  }
  return out;
}

class TsrBrowser {
  constructor({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.fetch = fetchImpl;
    this.now = now;
    this.pages = new Map();     // url -> { at, items }
    this.sessions = new Map();  // clé de recherche -> { next: {source: page}, done: {source: bool}, seen: Set }
    this.lastRequest = 0;
    this.chain = Promise.resolve();
  }

  static tree() {
    return TREE.map(r => ({ name: r.name, subs: r.subs }));
  }

  pageUrl(source, page, order) {
    return `${BASE}/downloads/browse/category/sims4-${source}/` + (order === 'popular' ? 'order/downloads/' : '') + (page > 1 ? `page/${page}/` : '');
  }

  /** Une requête à la fois, espacées de MIN_GAP. */
  getPage(url) {
    const cached = this.pages.get(url);
    if (cached && this.now() - cached.at < PAGE_TTL) return Promise.resolve(cached.items);
    const run = async () => {
      const again = this.pages.get(url);
      if (again && this.now() - again.at < PAGE_TTL) return again.items;
      const wait = this.lastRequest + MIN_GAP - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      this.lastRequest = Date.now();
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 20000);
      try {
        const res = await this.fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8' } });
        if (!res.ok) throw new Error(`TSR a répondu ${res.status}`);
        const items = parseListing(await res.text());
        this.pages.set(url, { at: this.now(), items });
        return items;
      } finally {
        clearTimeout(t);
      }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  /**
   * Charge la suite des résultats d'un rayon / sous-rayon.
   * @param {{category:string, sub?:string|null, order?:'new'|'popular', reset?:boolean}} q
   * @returns {Promise<{items:object[], done:boolean, scanned:number}>}
   */
  async more({ category, sub = null, order = 'new', reset = false }) {
    const rayon = TREE.find(r => r.name === category);
    if (!rayon) throw new Error('Rayon inconnu : ' + category);
    const key = [category, sub || '', order].join('|');
    let s = this.sessions.get(key);
    const sources = (sub && rayon.src && rayon.src[sub]) || rayon.sources;
    if (!s || reset) {
      s = { next: Object.fromEntries(sources.map(x => [x, 1])), done: {}, seen: new Set() };
      this.sessions.set(key, s);
    }
    const found = [];
    let scanned = 0;
    for (let round = 0; round < MAX_PAGES && found.length < WANT; round++) {
      const active = sources.filter(src => !s.done[src]);
      if (!active.length) break;
      for (const src of active) {
        const items = await this.getPage(this.pageUrl(src, s.next[src], order));
        s.next[src]++;
        if (!items.length) { s.done[src] = true; continue; }
        scanned += items.length;
        for (const it of items) {
          if (s.seen.has(it.id)) continue;
          const c = classifyTsr(it);
          if (!c || c.category !== category) continue;
          if (sub && !c.subs.includes(sub)) continue;
          s.seen.add(it.id);
          found.push({ ...it, category: c.category, subs: c.subs, description: undefined, keywords: undefined });
        }
      }
    }
    const sorter = order === 'popular' ? (a, b) => b.downloads - a.downloads : (a, b) => b.date - a.date;
    found.sort(sorter);
    return { items: found, done: sources.every(src => s.done[src]), scanned };
  }
}

module.exports = { TsrBrowser, parseListing };
