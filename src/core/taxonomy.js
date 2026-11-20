'use strict';
// Arborescence claire des catégories, partagée par la navigation TSR et le rangement.
//
// Pourquoi : depuis fin 2023, TSR range la plupart des nouveautés dans la catégorie
// parente ("sims4-hair-hairstyles", "sims4-shoes"...) ou dans des sous-catégories
// cachées ("clothing-female-elder-everyday"). Ses sous-catégories visibles
// ("Coiffures femme") ne reçoivent plus rien. On reclasse donc chaque CC nous-mêmes,
// à partir de sa catégorie TSR, de son titre, de sa description et de ses mots-clés.

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

const WHO = { f: 'Femme', m: 'Homme', child: 'Enfant', baby: 'Bambin et bébé' };

const ROOM = {
  kitchen: 'Cuisine',
  bath: 'Salle de bain',
  bedroom: 'Chambre',
  kids: "Chambre d'enfant",
  living: 'Salon',
  dining: 'Salle à manger',
  office: 'Bureau',
  outdoor: 'Extérieur et jardin',
  lighting: 'Éclairage',
  decor: 'Déco et divers'
};

/**
 * Rayons proposés dans l'onglet « Trouver du CC ».
 * sources : catégories TSR à parcourir pour tout le rayon (les plus larges, qui reçoivent les nouveautés) ;
 * src     : sources plus ciblées pour un sous-rayon (les listes TSR incluent leurs sous-catégories).
 * Les sous-catégories "hair-hairstyles-female/male" ne reçoivent plus rien depuis 2023 :
 * on les lit en plus de "hair-hairstyles" pour avoir aussi les classiques.
 */
const OBJ = 'objects-furnishing';
const TREE = [
  { name: CAT.hair, sources: ['hair'], subs: [WHO.f, WHO.m, WHO.child, WHO.baby, 'Barbes et moustaches', 'Sourcils'],
    src: { [WHO.f]: ['hair-hairstyles', 'hair-hairstyles-female'], [WHO.m]: ['hair-hairstyles', 'hair-hairstyles-male'], [WHO.child]: ['hair-hairstyles'], [WHO.baby]: ['hair-hairstyles'], 'Barbes et moustaches': ['hair-facial-beards'], Sourcils: ['hair-facial-eyebrows'] } },
  { name: CAT.clothes, sources: ['clothing'], subs: [WHO.f, WHO.m, WHO.child, WHO.baby],
    src: { [WHO.f]: ['clothing-female'], [WHO.m]: ['clothing-male'], [WHO.child]: ['clothing-female-child', 'clothing-male-child'], [WHO.baby]: ['clothing-female-toddler', 'clothing-male-toddler', 'clothing-female-infant', 'clothing-male-infant'] } },
  { name: CAT.shoes, sources: ['shoes'], subs: [WHO.f, WHO.m, WHO.child, WHO.baby],
    src: { [WHO.f]: ['shoes-female', 'shoes'], [WHO.m]: ['shoes-male', 'shoes'] } },
  { name: CAT.accessories, sources: ['accessories'], subs: ['Bijoux', 'Chapeaux et coiffes', 'Lunettes', 'Ongles', 'Tatouages', 'Chaussettes et collants', 'Autres accessoires'] },
  { name: CAT.makeup, sources: ['makeup'], subs: ['Lèvres', 'Yeux', 'Joues', 'Détails de peau', 'Maquillage de costume'] },
  { name: CAT.skin, sources: ['skintones', 'makeup', 'eyecolors'], subs: ['Teints de peau', 'Yeux (lentilles)'],
    src: { 'Teints de peau': ['skintones'], 'Yeux (lentilles)': ['makeup', 'eyecolors'] } },
  { name: CAT.furniture, sources: ['objects'], subs: [ROOM.kitchen, ROOM.bath, ROOM.bedroom, ROOM.kids, ROOM.living, ROOM.dining, ROOM.office, ROOM.outdoor, ROOM.lighting, ROOM.decor],
    src: {
      [ROOM.kitchen]: [OBJ + '-appliances', OBJ + '-surfaces-counters', OBJ + '-surfaces-cabinets', OBJ],
      [ROOM.bath]: [OBJ + '-plumbing', OBJ],
      [ROOM.bedroom]: [OBJ + '-comfort-beds', OBJ + '-storage-dressers', OBJ],
      [ROOM.kids]: [OBJ + '-kids', OBJ],
      [ROOM.living]: [OBJ + '-comfort', OBJ + '-surfaces', OBJ],
      [ROOM.dining]: [OBJ + '-surfaces-diningtables', OBJ + '-comfort-diningchairs', OBJ],
      [ROOM.office]: [OBJ + '-surfaces-desks', OBJ + '-electronics', OBJ],
      [ROOM.outdoor]: [OBJ + '-lighting-outdoor', 'objects'],
      [ROOM.lighting]: [OBJ + '-lighting'],
      [ROOM.decor]: [OBJ + '-decor']
    } },
  { name: CAT.build, sources: ['walls', 'floors', 'objects-buildmode'], subs: ['Murs', 'Sols', 'Portes et fenêtres', 'Toits, escaliers et clôtures'],
    src: { Murs: ['walls'], Sols: ['floors'], 'Portes et fenêtres': ['objects-buildmode'], 'Toits, escaliers et clôtures': ['objects-buildmode'] } },
  { name: CAT.tray, sources: ['lots', 'rooms', 'sims'], subs: ['Maisons', 'Lieux publics', 'Pièces', 'Sims'],
    src: { Maisons: ['lots-residential'], 'Lieux publics': ['lots-community'], 'Pièces': ['rooms'], Sims: ['sims'] } },
  { name: CAT.pets, sources: ['pets'], subs: ['Chats', 'Chiens'] },
  { name: CAT.poses, sources: ['mods-poses', 'mods'], subs: [] },
  { name: CAT.gameplay, sources: ['mods'], subs: ['Carrières', 'Fonds et présets CAS', 'Autres mods'] }
];

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_]+/g, ' ');

// ------------------------------------------------------------- âge et genre

const BABY = /\b(infants?|newborns?|bab(y|ies)|bebes?|nourrissons?|toddlers?|bambins?)\b/;
const CHILD = /\b(child|children|childs|kids?|enfants?|fillette|cf|cm|cu)\b/;
const CHILD_DESC = /\b(for|pour) (kids?|child(ren)?|toddlers?|infants?)\b|\b(child|toddler|infant)( age| version| only|ren only)\b|\b(child|toddler|infant) to\b/;
const UNISEX = /\bunisex\b|\bboth frames?\b|\b(female|feminine) (and|&|\/) (male|masculine)\b|\b(male|masculine) (and|&|\/) (female|feminine)\b|\bfor all genders\b/;
const MALE = /\b(male|males|men|mens|man|masculine|boys?|guys?|homme|hommes|garcons?|masc|beard|ym)\b/;
const FEMALE = /\b(female|females|women|womens|woman|feminine|girls?|lady|ladies|femme|femmes|filles?|fem|yf)\b/;

function ageFrom(slug, strong, weak) {
  if (/(^|-)(infant|baby|toddler)(-|$)/.test(slug)) return WHO.baby;
  if (/(^|-)child(-|$)/.test(slug)) return WHO.child;
  if (BABY.test(strong)) return WHO.baby;
  if (CHILD.test(strong)) return WHO.child;
  const m = weak.match(CHILD_DESC);
  if (m) return /infant|toddler/.test(m[0]) ? WHO.baby : WHO.child;
  return null;
}

/** Femme / Homme / Enfant / Bambin et bébé. Un CC unisexe va dans Femme et Homme. */
function whoFor(slug, strong, weak, fallback = WHO.f) {
  const age = ageFrom(slug, strong, weak);
  if (age) return [age];
  if (/(^|-)female(-|$)/.test(slug)) return [WHO.f];
  if (/(^|-)male(-|$)/.test(slug)) return [WHO.m];
  const all = strong + ' ' + weak;
  if (UNISEX.test(all)) return [WHO.f, WHO.m];
  const m = MALE.test(strong), f = FEMALE.test(strong);
  if (m && !f) return [WHO.m];
  if (f && !m) return [WHO.f];
  if (m && f) return [WHO.f, WHO.m];
  const mw = MALE.test(weak), fw = FEMALE.test(weak);
  if (mw && !fw) return [WHO.m];
  if (fw && !mw) return [WHO.f];
  if (mw && fw) return [WHO.f, WHO.m];
  // Sans indice : sur TSR, la grande majorité du CAS sans précision est féminin.
  return fallback ? [fallback] : [];
}

// ------------------------------------------------------------- pièces

// Premier passage : la pièce est nommée. Second passage : l'objet la trahit.
const ROOM_NAMED = [
  [ROOM.kids, /\b(nursery|kids? ?room|children'?s room|chambre d.enfant|kids?|toddlers?|infants?|bab(y|ies)|crib|bebe)\b/],
  [ROOM.bath, /\b(bath ?rooms?|salle de bains?|toilettes?|restroom|powder room)\b/],
  [ROOM.kitchen, /\b(kitchens?|cuisines?)\b/],
  [ROOM.dining, /\b(dining|salle a manger)\b/],
  [ROOM.bedroom, /\b(bed ?rooms?|chambres?)\b/],
  [ROOM.living, /\b(living ?rooms?|lounge|salons?|sejour|reading (corner|nook)|coin lecture)\b/],
  [ROOM.office, /\b(offices?|study|bureau)\b/],
  [ROOM.outdoor, /\b(outdoors?|gardens?|patio|terrace|backyard|yard|pool ?side|jardin|exterieur|balcon(y|ies)?)\b/]
];
const ROOM_OBJECTS = [
  [ROOM.kids, /\b(toys?|cribs?|bassinet|playmat|high ?chair|changing table|jouets?|berceau)\b/],
  [ROOM.bath, /\b(bath ?tubs?|tubs?|showers?|toilets?|wc|vanit(y|ies)|towels?|soaps?|toothbrush\w*|toothpaste|lotion|shampoo|hair ?spray|perfume|bath|douche|baignoire|lavabo|serviettes?|savon)\b/],
  [ROOM.kitchen, /\b(fridges?|refrigerators?|stoves?|ovens?|cooktops?|range hood|hoods?|microwaves?|toasters?|kettles?|coffee ?makers?|espresso|blenders?|counters?|countertops?|spices?|utensils?|cutlery|cutting board|dish(es)?|plates?|bowls?|mugs?|frigo|plan de travail|vaisselle|epices?)\b/],
  [ROOM.dining, /\b(dining (tables?|chairs?)|sideboards?|buffets?)\b/],
  [ROOM.bedroom, /\b(beds?|bunk ?beds?|nightstands?|night stands?|bedside|wardrobes?|dressers?|closets?|pillows?|blankets?|mattress(es)?|duvet|armoire|commode|oreillers?|table de chevet)\b/],
  [ROOM.living, /\b(sofas?|couch(es)?|loveseats?|armchairs?|coffee tables?|tvs?|televisions?|fireplaces?|canapes?|fauteuils?|cheminees?|table basse)\b/],
  [ROOM.office, /\b(desks?|computers?|laptops?|office chairs?|bookcases?|bookshelf|bookshelves|filing|ordinateurs?|bibliotheques?)\b/],
  [ROOM.outdoor, /\b(planters?|bbq|barbecue|grills?|parasols?|hammocks?|sun ?loungers?|loungers?|fences?|trees?|bushes|shrubs?|hedges?|pergola|gazebo|swings?|transats?|haies?|arbres?)\b/],
  [ROOM.lighting, /\b(lamps?|lights?|lighting|chandeliers?|sconces?|pendants?|lanterns?|lampes?|lustres?|appliques?|luminaires?)\b/]
];
const ROOM_BY_SLUG = [
  [/furnishing-kids/, ROOM.kids],
  [/plumbing/, ROOM.bath],
  [/appliances|surfaces-counters|surfaces-cabinets/, ROOM.kitchen],
  [/diningtables|diningchairs/, ROOM.dining],
  [/comfort-beds|storage-dressers/, ROOM.bedroom],
  [/sofasloveseats|livingchairs|loungechairs|coffeetables|endtables|electronics-tvs|electronics-audio|entertainment|buildmode-fireplaces/, ROOM.living],
  [/surfaces-desks|electronics-computers|storage-bookshelves/, ROOM.office],
  [/lighting-outdoor|buildmode-plantstrees|buildmode-fencesgates/, ROOM.outdoor],
  [/lighting/, ROOM.lighting]
];

function roomFor(slug, strong, weak) {
  for (const [room, re] of ROOM_NAMED) if (re.test(strong)) return room;
  for (const [room, re] of ROOM_OBJECTS) if (re.test(strong)) return room;
  for (const [re, room] of ROOM_BY_SLUG) if (re.test(slug)) return room;
  for (const [room, re] of ROOM_NAMED) if (re.test(weak)) return room;
  return ROOM.decor;
}

// ------------------------------------------------------------- autres sous-rayons

function accessoryFor(slug, text) {
  const t = slug + ' ' + text;
  if (/tattoo|tatouage/.test(t)) return 'Tatouages';
  if (/nails?\b|ongles?/.test(t)) return 'Ongles';
  if (/glasses|sunglasses|lunettes/.test(t)) return 'Lunettes';
  if (/socks|leggings|tights|stockings|chaussettes|collants?/.test(t)) return 'Chaussettes et collants';
  if (/hats?\b|caps?\b|beanie|headband|headwrap|hijab|shayla|turban|crown|tiara|veil|hair ?(accessor|clip|bow|pin)|chapeaux?|casquettes?|bonnets?|couronne|voile|serre-tete/.test(t)) return 'Chapeaux et coiffes';
  if (/earrings?|necklaces?|chokers?|rings?\b|bracelets?|piercings?|jewel|pendants?|anklets?|boucles? d.oreilles?|colliers?|bagues?|bijoux/.test(t)) return 'Bijoux';
  return 'Autres accessoires';
}

function makeupFor(slug, text) {
  const t = slug + ' ' + text;
  if (/costume/.test(t)) return 'Maquillage de costume';
  if (/skindetail|freckle|mole|wrinkle|scar|blemish|birthmark|taches?|rousseur|grain de beaute|rides?/.test(t)) return 'Détails de peau';
  if (/lipstick|lip ?gloss|lip ?liner|lips?\b|levres?|rouge a levre/.test(t)) return 'Lèvres';
  if (/blush|contour|highlighter|bronzer|joues?/.test(t)) return 'Joues';
  if (/eyeshadow|eyeliner|mascara|lash|fard|paupieres?|eye/.test(t)) return 'Yeux';
  return 'Lèvres';
}

// ------------------------------------------------------------- classement

/**
 * Classe un CC.
 * @param {{slug?:string, title?:string, description?:string, keywords?:string}} info
 *   slug : catégorie TSR sans le préfixe "sims4-" ("hair-hairstyles", "objects-furnishing-comfort-beds"...)
 * @returns {{category:string, subs:string[]}|null}  null si la catégorie TSR ne dit rien
 */
function classifyTsr({ slug = '', title = '', description = '', keywords = '' }) {
  slug = String(slug).toLowerCase().replace(/^sims4-?/, '');
  const strong = norm(title + ' ' + String(keywords).replace(/,/g, ' '));
  const weak = norm(description);
  const s = slug.replace(/^sets-/, '');

  if (/^hair-facial-eyebrows/.test(s)) return { category: CAT.hair, subs: ['Sourcils'] };
  if (/^hair-facial/.test(s)) return { category: CAT.hair, subs: ['Barbes et moustaches'] };
  if (/^hair/.test(s)) {
    if (/\b(beards?|mustaches?|moustaches?|goatee|stubble|barbe)\b/.test(strong)) return { category: CAT.hair, subs: ['Barbes et moustaches'] };
    if (/\b(eyebrows?|brows?|sourcils?)\b/.test(strong)) return { category: CAT.hair, subs: ['Sourcils'] };
    return { category: CAT.hair, subs: whoFor(s, strong, weak) };
  }
  if (/^clothing/.test(s)) return { category: CAT.clothes, subs: whoFor(s, strong, weak) };
  if (/^shoes/.test(s)) return { category: CAT.shoes, subs: whoFor(s, strong, weak) };
  if (/^accessories/.test(s)) return { category: CAT.accessories, subs: [accessoryFor(s, strong)] };
  if (/eyecolors/.test(s)) return { category: CAT.skin, subs: ['Yeux (lentilles)'] };
  if (/^skintones/.test(s)) return { category: CAT.skin, subs: ['Teints de peau'] };
  if (/^makeup/.test(s)) {
    if (/\b(eye ?colou?rs?|contacts?|lenses|lentilles|eyes)\b/.test(strong) && !/shadow|liner|lash|mascara/.test(strong)) return { category: CAT.skin, subs: ['Yeux (lentilles)'] };
    return { category: CAT.makeup, subs: [makeupFor(s, strong)] };
  }
  if (/^walls/.test(s)) return { category: CAT.build, subs: ['Murs'] };
  if (/^(floors|terrainpaint)/.test(s)) return { category: CAT.build, subs: ['Sols'] };
  if (/^wallsfloors/.test(s)) return { category: CAT.build, subs: [/\bfloors?|sols?\b/.test(strong) ? 'Sols' : 'Murs'] };
  if (/^(objects|objectrecolors)-buildmode-(doors|windows|arches)/.test(s)) return { category: CAT.build, subs: ['Portes et fenêtres'] };
  if (/^(objects|objectrecolors)-buildmode-(roofs|stairsrailings|columns|fencesgates)/.test(s)) return { category: CAT.build, subs: ['Toits, escaliers et clôtures'] };
  if (/^(objects|objectrecolors)/.test(s)) {
    if (/^(objects|objectrecolors)-buildmode$/.test(s)) {
      if (/\b(doors?|windows?|arch(es|way)?|portes?|fenetres?)\b/.test(strong)) return { category: CAT.build, subs: ['Portes et fenêtres'] };
      if (/\b(roofs?|stairs?|railings?|columns?|fences?|gates?|toits?|escaliers?)\b/.test(strong)) return { category: CAT.build, subs: ['Toits, escaliers et clôtures'] };
    }
    if (/^(objects|objectrecolors)-furnishing-pets/.test(s)) return { category: CAT.pets, subs: [/\bdogs?|chiens?\b/.test(strong) ? 'Chiens' : 'Chats'] };
    return { category: CAT.furniture, subs: [roomFor(s, strong, weak)] };
  }
  if (/^lots-residential/.test(s)) return { category: CAT.tray, subs: ['Maisons'] };
  if (/^lots-(community|dormatory)/.test(s)) return { category: CAT.tray, subs: ['Lieux publics'] };
  if (/^lots/.test(s)) return { category: CAT.tray, subs: [/\b(residential|house|home|maison|villa|cottage|apartment)\b/.test(strong) ? 'Maisons' : 'Lieux publics'] };
  if (/^rooms/.test(s)) return { category: CAT.tray, subs: ['Pièces'] };
  if (/^sims/.test(s)) return { category: CAT.tray, subs: ['Sims'] };
  if (/^pets/.test(s)) {
    if (/dogs/.test(s) || (/\b(dogs?|puppy|chiens?)\b/.test(strong) && !/\b(cats?|kitten|chats?)\b/.test(strong))) return { category: CAT.pets, subs: ['Chiens'] };
    return { category: CAT.pets, subs: ['Chats'] };
  }
  if (/^mods-poses/.test(s) || (/^mods/.test(s) && /\b(poses?|animations?)\b/.test(strong))) return { category: CAT.poses, subs: [] };
  if (/^mods-careers/.test(s)) return { category: CAT.gameplay, subs: ['Carrières'] };
  if (/^mods-cas/.test(s)) return { category: CAT.gameplay, subs: ['Fonds et présets CAS'] };
  if (/^mods/.test(s)) {
    if (/\b(presets?|cas backgrounds?|background)\b/.test(strong)) return { category: CAT.gameplay, subs: ['Fonds et présets CAS'] };
    if (/\b(careers?|metiers?)\b/.test(strong)) return { category: CAT.gameplay, subs: ['Carrières'] };
    return { category: CAT.gameplay, subs: ['Autres mods'] };
  }
  return null;
}

/**
 * Sous-rayon d'un CC dont on connaît déjà la catégorie mais pas la fiche TSR
 * (nom du fichier, nom de la pièce CAS "yfHair_..." ou "ymTop_...").
 */
function subFor(category, text, casText = '') {
  const t = norm(text + ' ' + casText);
  // Préfixe EA des pièces CAS : âge (y/a/e/t = ado à senior, c = enfant, p = bambin, i = bébé) + genre (f/m/u)
  const ea = String(casText).match(/\b([yaetcpi])([fmu]) [A-Z]/);
  const eaWho = ea && (ea[1] === 'c' ? WHO.child : 'pi'.includes(ea[1]) ? WHO.baby : ea[2] === 'm' ? WHO.m : ea[2] === 'f' ? WHO.f : null);
  switch (category) {
    case CAT.hair:
      if (/\b(beards?|mustaches?|moustaches?|goatee|barbe)\b/.test(t)) return 'Barbes et moustaches';
      if (/\b(eyebrows?|sourcils?)\b/.test(t)) return 'Sourcils';
      // fallthrough
    case CAT.clothes:
    case CAT.shoes: {
      if (eaWho) return eaWho;
      const w = whoFor('', t, '', null);
      return w.length === 1 ? w[0] : null;
    }
    case CAT.accessories: { const a = accessoryFor('', t); return a === 'Autres accessoires' ? null : a; }
    case CAT.makeup: return makeupFor('', t);
    case CAT.furniture: { const r = roomFor('', t, ''); return r === ROOM.decor ? null : r; }
    case CAT.pets: return /\b(dogs?|chiens?)\b/.test(t) ? 'Chiens' : /\b(cats?|chats?)\b/.test(t) ? 'Chats' : null;
    default: return null;
  }
}

module.exports = { CAT, WHO, ROOM, TREE, classifyTsr, subFor, norm };
