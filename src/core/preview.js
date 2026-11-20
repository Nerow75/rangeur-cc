'use strict';
// Récupère le titre et l'image d'aperçu de la page d'où vient le téléchargement
// (balises og:title / og:image), avec un traitement spécial pour The Sims Resource.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function tsrItemId(...urls) {
  for (const u of urls) {
    if (!u || !/thesimsresource\.com/i.test(u)) continue;
    const m = u.match(/(?:itemId|\/id)\/(\d{4,})/i) || u.match(/\/downloads\/(\d{4,})/i);
    if (m) return m[1];
  }
  return null;
}

/** Pages à essayer, dans l'ordre, pour trouver l'aperçu. */
function candidatePages({ referrerUrl, hostUrl }) {
  const pages = [];
  const id = tsrItemId(referrerUrl, hostUrl);
  if (id) {
    if (referrerUrl && /\/details\//i.test(referrerUrl)) pages.push(referrerUrl);
    // Redirige vers la fiche complète : /members/<créateur>/downloads/details/.../id/<id>/
    pages.push(`https://www.thesimsresource.com/downloads/${id}`);
  } else if (referrerUrl && /^https?:/i.test(referrerUrl)) {
    pages.push(referrerUrl);
  }
  return [...new Set(pages)];
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function meta(html, prop) {
  const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=(["'])(.*?)\\1`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=(["'])(.*?)\\1[^>]*(?:property|name)=["']${prop}["']`, 'i');
  const m = html.match(re1) || html.match(re2);
  return m && m[2] ? decodeEntities(m[2]).trim() : null;
}

function cleanTitle(t) {
  if (!t) return null;
  return t
    .replace(/\s*[|\-–]\s*The Sims Resource.*$/i, '')
    .replace(/^The Sims Resource\s*[|\-–:]\s*/i, '')
    .replace(/^Sims\s*4\s*[-–:]\s*/i, '')
    .trim() || null;
}

function splitCreator(title) {
  if (!title) return { name: null, creator: null };
  const m = title.match(/^(.*\S)\s+(?:by|par)\s+(\S.*)$/i);
  return m ? { name: m[1], creator: m[2] } : { name: title, creator: null };
}

async function fetchWithTimeout(url, opts = {}, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8', ...(opts.headers || {}) } });
  } finally {
    clearTimeout(t);
  }
}

/**
 * @returns {Promise<{pageUrl:string,name:string|null,creator:string|null,image:{ext:string,data:Buffer}|null}|null>}
 */
async function fetchPagePreview(zone) {
  for (const url of candidatePages(zone)) {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) continue;
      const html = await res.text();
      const rawTitle = meta(html, 'og:title') || (html.match(/<title>([^<]+)<\/title>/i) || [])[1];
      const finalUrl = res.url || url;
      let { name, creator } = splitCreator(cleanTitle(rawTitle && decodeEntities(rawTitle)));
      // TSR : og:title = "Créateur's Nom de l'objet", et le créateur est dans l'URL.
      const member = finalUrl.match(/thesimsresource\.com\/(?:members|artists)\/([^/]+)\//i);
      if (member) {
        creator = decodeURIComponent(member[1]);
        const prefix = new RegExp('^' + creator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "['’]s\\s+", 'i');
        if (name) name = name.replace(prefix, '').trim();
      }
      const imgUrl = meta(html, 'og:image') || meta(html, 'twitter:image');
      let image = null;
      if (imgUrl) {
        try {
          const abs = new URL(imgUrl, res.url || url).toString();
          const ir = await fetchWithTimeout(abs, { headers: { Referer: res.url || url } });
          const type = ir.headers.get('content-type') || '';
          if (ir.ok && /^image\//i.test(type)) {
            const data = Buffer.from(await ir.arrayBuffer());
            const ext = /png/i.test(type) ? 'png' : /webp/i.test(type) ? 'webp' : /gif/i.test(type) ? 'gif' : 'jpg';
            if (data.length > 500) image = { ext, data };
          }
        } catch { /* pas d'image */ }
      }
      const description = meta(html, 'og:description') || meta(html, 'description');
      if (name || image) return { pageUrl: res.url || url, name, creator, image, description };
    } catch { /* page suivante */ }
  }
  return null;
}

module.exports = { fetchPagePreview, candidatePages, tsrItemId, cleanTitle, splitCreator };
