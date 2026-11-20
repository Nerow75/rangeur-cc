'use strict';
// Devine la catégorie d'un CC pour le ranger dans Mods/<Catégorie>/<Nom>/.
// 1. la catégorie TSR présente dans l'URL de la fiche (fiable) ;
// 2. sinon, le contenu du .package (types de ressources + nom de la pièce CAS).

const fs = require('fs');
const { readIndex, readEntry } = require('./dbpf');

const CAT = {
  hair: 'Cheveux',
  clothes: 'Vêtements',
  shoes: 'Chaussures',
  accessories: 'Accessoires',
  makeup: 'Maquillage',
  skin: 'Peau et yeux',
  furniture: 'Meubles et objets',
  build: 'Construction',
  poses: 'Poses et animations',
  pets: 'Animaux',
  gameplay: 'Mods de gameplay',
  tray: 'Lots et Sims',
  other: 'Autres'
};

// Ordre important : "makeup-female-eyecolors" doit tomber dans Peau et yeux.
// Mots anglais (TSR, noms EA des pièces CAS) et français (noms de fichiers).
// Le texte est comparé en minuscules et sans accents.
const RULES = [
  [CAT.hair, /hair|beard|mustache|moustache|sideburn|cheveu|coiffure|barbe|frange|chignon|tresse|natte/],
  [CAT.skin, /eyecolou?r|eyes?\b|contacts?|skin|overlay|brow|lash|tattoo|freckle|mole|scar|teeth|peau|yeux|sourcil|\bcils?\b|tatouage|rousseur|\bdents?\b/],
  [CAT.makeup, /makeup|lipstick|lipgloss|lip|eyeshadow|eyeliner|blush|mascara|contour|highlighter|maquillage|rouge a levres?|levres?|\bfard/],
  [CAT.shoes, /shoe|boot|sneaker|heel|sandal|slipper|chaussure|botte|basket|talon|escarpin|chausson/],
  [CAT.accessories, /accessor|jewel|earring|necklace|ring|bracelet|glasses|hat|cap|nail|piercing|sock|tights|glove|bag|watch|headband|bijou|boucles? d.oreilles?|collier|bague|lunette|chapeau|casquette|ongle|\bsac\b|montre|chaussette|collant|\bgants?\b/],
  [CAT.clothes, /cloth|outfit|top|bottom|fullbody|body|dress|pant|skirt|shirt|jacket|coat|sweater|jean|short|swim|sleep|formal|athletic|everyday|party|costume|uniform|\brobes?\b|\bhauts?\b|pantalon|jupe|chemise|veste|manteau|\bpull|tenue|maillot|pyjama|vetement/],
  [CAT.build, /wall|floor|terrain|roof|fence|window|door|stair|pool|column|foundation|\bmurs?\b|\bsols?\b|fenetre|\bportes?\b|\btoits?\b|escalier|piscine|papier peint|carrelage/],
  [CAT.furniture, /object|furnish|decor|bed|seat|sofa|chair|table|surface|lighting|lamp|kitchen|bath|electronic|plumbing|appliance|plant|storage|shelf|rug|curtain|clutter|rooms?\b|meuble|canape|\blits?\b|chaise|fauteuil|lampe|\bdeco|cuisine|salle de bain|chambre|salon|etagere|tapis|rideau|plante/],
  [CAT.poses, /pose|animation/],
  [CAT.pets, /pets?\b|\bcats?\b|\bdogs?\b|horse|chien|\bchats?\b|cheval|animaux/],
  [CAT.gameplay, /mods?\b|gameplay|tuning|trait|career|aspiration|cheat/]
];

function classifyText(text) {
  const t = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [cat, re] of RULES) if (re.test(t)) return cat;
  return null;
}

/** Catégorie à partir d'une URL de fiche TSR (".../category/sims4-hair-hairstyles/..."). */
function categoryFromUrl(...urls) {
  for (const u of urls) {
    const m = u && u.match(/thesimsresource\.com\/.*?category\/sims4-([a-z0-9-]+)/i);
    if (!m) continue;
    const slug = m[1].toLowerCase();
    if (/^(lots|rooms|sims)\b/.test(slug)) return CAT.tray;
    if (/^pets\b/.test(slug)) return CAT.pets;
    if (/^mods\b/.test(slug)) return CAT.gameplay;
    if (/^(objects|objectrecolors)\b/.test(slug) && !/wall|floor|terrain|roof/.test(slug)) return CAT.furniture;
    const c = classifyText(slug.replace(/-/g, ' '));
    if (c) return c;
  }
  return null;
}

// Types de ressources Sims 4
const T = {
  CASP: 0x034aeecb,
  COBJ: 0x319e4f1d,
  OBJD: 0xc0db5ae7,
  CLIP: 0x6b20c4f3,
  TUNING: [0x0333406c, 0x62e94d38, 0x545ac67a, 0x03b33ddf, 0x6017e896, 0xe882d22f, 0xcb5fddc7],
  WALL_FLOOR: [0xd5f0f921, 0xb4f762c9, 0xb0311d0f, 0xf1edbd86, 0x9a20cd1c]
};

/** Lit le début d'une pièce CAS pour récupérer son nom ("yfHair_...", "ymTop_..."). */
function casPartNames(fd, entries, max = 4) {
  const names = [];
  for (const e of entries.filter(x => x.type === T.CASP).slice(0, max)) {
    let data;
    try { data = readEntry(fd, e); } catch { continue; }
    if (!data || data.length < 20) continue;
    // Nom en UTF-16 big-endian juste après l'en-tête (12 octets) et sa longueur
    // (1 ou 2 octets) : on lit avec les deux alignements et on garde les lettres.
    for (const start of [13, 14]) {
      const slice = data.subarray(start, Math.min(data.length, start + 256));
      let s = '';
      for (let i = 0; i + 1 < slice.length; i += 2) {
        const code = (slice[i] << 8) | slice[i + 1];
        s += code >= 32 && code < 127 ? String.fromCharCode(code) : ' ';
      }
      names.push(s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' '));
    }
  }
  return names;
}

// Pièce CAS sans indice dans son nom : le nom du CC tranchera.
const WEAK_CAS = 'cas-inconnu';

function categoryFromPackage(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const entries = readIndex(fd, fs.fstatSync(fd).size);
    const types = new Set(entries.map(e => e.type));
    if (types.has(T.CASP)) {
      const fromName = classifyText(casPartNames(fd, entries).join(' '));
      return fromName && fromName !== CAT.gameplay ? fromName : WEAK_CAS;
    }
    if (T.WALL_FLOOR.some(t => types.has(t))) return CAT.build;
    if (types.has(T.COBJ) || types.has(T.OBJD)) return CAT.furniture;
    if (types.has(T.CLIP)) return CAT.poses;
    if (T.TUNING.some(t => types.has(t))) return CAT.gameplay;
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * @param {{urls:string[], packages:string[], hasScript:boolean, trayOnly:boolean, name?:string}} info
 */
function categorize({ urls = [], packages = [], hasScript = false, trayOnly = false, name = '' }) {
  if (trayOnly) return CAT.tray;
  if (hasScript) return CAT.gameplay;
  // Un lot ou un foyer TSR peut contenir son propre CC : il reste groupé avec le lot.
  const fromUrl = categoryFromUrl(...urls);
  if (fromUrl) return fromUrl;
  const votes = {};
  for (const p of packages.slice(0, 8)) {
    const c = categoryFromPackage(p);
    if (c) votes[c] = (votes[c] || 0) + 1;
  }
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  const fromName = classifyText(name);
  if (best && best[0] !== WEAK_CAS) return best[0];
  // Pièce CAS sans indice : le nom du CC tranche, sinon c'est le plus souvent un vêtement.
  if (best) return fromName && fromName !== CAT.gameplay ? fromName : CAT.clothes;
  return fromName || CAT.other;
}

module.exports = { categorize, categoryFromUrl, categoryFromPackage, classifyText, CAT, WEAK_CAS };
