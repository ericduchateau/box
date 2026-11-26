// Moteur A, module 1 — agrégation des événements (fonction PURE, déterministe).
// Contrat : fonda/engine/agregation.test.js ; docs/SPEC-moteur-a.md §1-§3 et §6.
// Aucune I/O, aucune horloge : `aujourdhui` (date de Paris, "AAAA-MM-JJ") est injecté.
// Zéro dépendance.

'use strict';

const SEUIL_BASCULE = 25;
const SEUIL_CARTE = 10;
const SEUIL_ROUGE = 0.5;

const CTX = ['df', 'maison', 'classe'];
const PALIERS = ['nI', 'nF'];
const NIVEAUX = new Set(['6e', '5e', '4e', '3e']);
// Source de vérité : fonda/data/README.md (convention d'id de notion) ; même motif que
// NOTION_ID_PATTERN de fonda/engine/evenements.js (non exporté). À garder identiques.
const NOTION_ID_PATTERN = /^(fr|maths)\.[a-z0-9-]+$/;
const CHAMPS = ['ts', 'niveau', 'defi_id', 'notion_id', 'palier', 'set_id', 'item_id', 'result', 'ctx'];
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:Z|([+-])(\d{2}):(\d{2}))$/;
// Grammaire cible du defi_id (SPEC §6). Le segment niveau est une MÉTADONNÉE : il doit être un
// token réel, mais event.niveau fait foi (décision 1b = B : un désaccord n'invalide pas).
// DETTE (SPEC §6) : liens.js (genererDefiId) émet encore l'ancien format {grp} sans palier ; ces
// liens sont rejetés ici tant que le générateur n'a pas migré.
const DEFI = /^defi_(\d{4})-w(\d{1,2})_(6e|5e|4e|3e)_([a-z0-9-]+)_(nI|nF)$/;
const MS_JOUR = 86400000;

// Comparaison par UNITÉS DE CODE (opérateur <), jamais localeCompare.
function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

function taux(n, reussites) { return n > 0 ? reussites / n : null; }

// --- Calendrier civil (arithmétique pure, sans Date) ------------------------------

function bissextile(a) { return a % 4 === 0 && (a % 100 !== 0 || a % 400 === 0); }

function joursDansMois(a, m) { return [31, bissextile(a) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }

function dateValide(a, m, j) { return m >= 1 && m <= 12 && j >= 1 && j <= joursDansMois(a, m); }

// Jours depuis le 1970-01-01 (algorithme « days from civil »).
function joursDepuisEpoque(a, m, j) {
  const y = m <= 2 ? a - 1 : a;
  const ere = Math.floor(y / 400);
  const ae = y - ere * 400;
  const ja = Math.floor((153 * ((m + 9) % 12) + 2) / 5) + j - 1;
  return ere * 146097 + ae * 365 + Math.floor(ae / 4) - Math.floor(ae / 100) + ja - 719468;
}

function texteDate(a, m, j) {
  return `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
}

function dateDepuisJours(z0) {
  const z = z0 + 719468;
  const ere = Math.floor(z / 146097);
  const je = z - ere * 146097;
  const ae = Math.floor((je - Math.floor(je / 1460) + Math.floor(je / 36524) - Math.floor(je / 146096)) / 365);
  const ja = je - (365 * ae + Math.floor(ae / 4) - Math.floor(ae / 100));
  const mp = Math.floor((5 * ja + 2) / 153);
  const j = ja - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return texteDate(ae + ere * 400 + (m <= 2 ? 1 : 0), m, j);
}

// Lundi de la semaine ISO 1 de l'année a (en jours depuis l'époque).
function lundiSemaine1(a) {
  const j4 = joursDepuisEpoque(a, 1, 4);
  return j4 - (((j4 % 7) + 10) % 7); // 1970-01-01 = jeudi
}

// Lundi ("AAAA-MM-JJ") de la semaine ISO s de l'année a, ou null si elle n'existe pas.
function lundiIso(a, s) {
  const debut = lundiSemaine1(a);
  const nbSemaines = (lundiSemaine1(a + 1) - debut) / 7;
  if (s < 1 || s > nbSemaines) return null;
  return dateDepuisJours(debut + 7 * (s - 1));
}

function estDate(s) {
  const r = typeof s === 'string' ? DATE.exec(s) : null;
  return r !== null && dateValide(+r[1], +r[2], +r[3]);
}

// --- Date civile Europe/Paris -------------------------------------------------------

// Assemblée à partir des COMPOSANTES numériques (formatToParts), jamais du texte
// d'affichage régional, dont le format n'est pas garanti.
const PARIS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Paris', year: 'numeric', month: 'numeric', day: 'numeric', numberingSystem: 'latn',
});

function jourParisDepuisMs(ms) {
  const c = {};
  for (const p of PARIS.formatToParts(new Date(ms))) c[p.type] = p.value;
  const a = Number(c.year);
  const m = Number(c.month);
  const j = Number(c.day);
  if (!Number.isInteger(a) || !Number.isInteger(m) || !Number.isInteger(j) || !dateValide(a, m, j)) return null;
  return texteDate(a, m, j);
}

// ts ISO 8601 strict, fuseau explicite (Z ou ±hh:mm), fraction de seconde de longueur
// quelconque -> date civile de Paris, ou null.
function jourParis(ts) {
  const r = typeof ts === 'string' ? TS.exec(ts) : null;
  if (r === null) return null;
  const [a, mo, j, h, mi] = [+r[1], +r[2], +r[3], +r[4], +r[5]];
  const s = r[6] === undefined ? 0 : +r[6];
  if (!dateValide(a, mo, j) || h > 23 || mi > 59 || s > 59) return null;
  let decalage = 0;
  if (r[8] !== undefined) {
    const [dh, dm] = [+r[9], +r[10]];
    if (dh > 23 || dm > 59) return null;
    decalage = (r[8] === '+' ? 1 : -1) * (dh * 60 + dm) * 60000;
  }
  const fraction = r[7] === undefined ? 0 : Number(r[7].slice(0, 3).padEnd(3, '0'));
  const ms = joursDepuisEpoque(a, mo, j) * MS_JOUR + ((h * 60 + mi) * 60 + s) * 1000 + fraction - decalage;
  return jourParisDepuisMs(ms);
}

// --- Lecture d'un événement ---------------------------------------------------------

// Copie des champs utiles : propriétés PROPRES et de DONNÉES seulement (ni accesseur, ni
// héritage), lues UNE seule fois. Tout piège (getter, Proxy qui lève) -> null (invalide).
function copier(brut) {
  if (brut === null || typeof brut !== 'object') return null;
  try {
    const e = {};
    for (const k of CHAMPS) {
      const d = Object.getOwnPropertyDescriptor(brut, k);
      if (d === undefined || !('value' in d)) return null;
      e[k] = d.value;
    }
    return e;
  } catch {
    return null;
  }
}

function nonVide(v) { return typeof v === 'string' && v.length > 0; }

// Événement normalisé, ou null s'il est invalide (forme).
function lire(brut) {
  const e = copier(brut);
  if (e === null) return null;
  if (e.result !== 0 && e.result !== 1) return null;
  if (!CTX.includes(e.ctx) || !PALIERS.includes(e.palier)) return null;
  if (typeof e.niveau !== 'string' || !NIVEAUX.has(e.niveau)) return null;
  if (typeof e.notion_id !== 'string' || !NOTION_ID_PATTERN.test(e.notion_id)) return null;
  if (!nonVide(e.set_id) || !nonVide(e.item_id)) return null;
  const jour = jourParis(e.ts);
  if (jour === null) return null;
  const d = typeof e.defi_id === 'string' ? DEFI.exec(e.defi_id) : null;
  if (d === null) return null;
  const annee = +d[1];
  const semaine = +d[2];
  const lundi = lundiIso(annee, semaine);
  if (lundi === null || lundi > jour) return null;
  if (d[4] !== e.notion_id.slice(e.notion_id.indexOf('.') + 1) || d[5] !== e.palier) return null;
  return {
    jour, annee, semaine, notion_id: e.notion_id, palier: e.palier,
    set_id: e.set_id, item_id: e.item_id, result: e.result, ctx: e.ctx,
  };
}

// --- Cartes : Map IMBRIQUÉES set_id -> item_id (aucune clé concaténée) ---------------

function indexerCartes(liste) {
  const parSet = new Map();
  for (const x of liste) {
    if (!parSet.has(x.set_id)) parSet.set(x.set_id, new Map());
    const parItem = parSet.get(x.set_id);
    if (!parItem.has(x.item_id)) parItem.set(x.item_id, { n: 0, reussites: 0 });
    const s = parItem.get(x.item_id);
    s.n += 1;
    s.reussites += x.result;
  }
  return parSet;
}

function cartesTriees(index) {
  const out = [];
  for (const set_id of [...index.keys()].sort(cmp)) {
    const parItem = index.get(set_id);
    for (const item_id of [...parItem.keys()].sort(cmp)) {
      const s = parItem.get(item_id);
      out.push({ set_id, item_id, n_reponses: s.n, taux: taux(s.n, s.reussites) });
    }
  }
  return out;
}

// --- Δ entre occurrences -------------------------------------------------------------

function libelleOccurrence(annee, semaine) { return `${String(annee).padStart(4, '0')}-w${String(semaine).padStart(2, '0')}`; }

function resume(occurrence, n, reussites) { return { occurrence, n_reponses: n, taux: taux(n, reussites) }; }

function calculerDelta(liste) {
  const parOcc = new Map(); // clé numérique annee*100 + semaine
  for (const x of liste) {
    const k = x.annee * 100 + x.semaine;
    if (!parOcc.has(k)) parOcc.set(k, []);
    parOcc.get(k).push(x);
  }
  const cles = [...parOcc.keys()].sort((a, b) => a - b);
  const kc = cles[cles.length - 1];
  const libelle = (k) => libelleOccurrence(Math.floor(k / 100), k % 100);
  const courante = parOcc.get(kc);
  if (cles.length === 1) {
    const r = courante.reduce((t, x) => t + x.result, 0);
    return { valeur: null, items_communs: 0, courante: resume(libelle(kc), courante.length, r), precedente: null };
  }
  const kp = cles[cles.length - 2];
  const ic = indexerCartes(courante);
  const ip = indexerCartes(parOcc.get(kp));
  let communs = 0;
  const c = { n: 0, reussites: 0 };
  const p = { n: 0, reussites: 0 };
  for (const [set_id, parItemC] of ic) {
    const parItemP = ip.get(set_id);
    if (parItemP === undefined) continue;
    for (const [item_id, sc] of parItemC) {
      const sp = parItemP.get(item_id);
      if (sp === undefined) continue;
      communs += 1;
      c.n += sc.n; c.reussites += sc.reussites;
      p.n += sp.n; p.reussites += sp.reussites;
    }
  }
  const rc = resume(libelle(kc), c.n, c.reussites);
  const rp = resume(libelle(kp), p.n, p.reussites);
  const valeur = rc.taux === null || rp.taux === null ? null : rc.taux - rp.taux;
  return { valeur, items_communs: communs, courante: rc, precedente: rp };
}

// --- Paramètres ------------------------------------------------------------------------

function lirePeriodes(calendrier) {
  const periodes = calendrier && typeof calendrier === 'object' ? calendrier.periodes : undefined;
  if (!Array.isArray(periodes) || periodes.length === 0) throw new TypeError('calendrier.periodes : tableau non vide attendu');
  return periodes.map((p) => {
    if (!p || typeof p !== 'object' || !nonVide(p.id) || !estDate(p.du) || !estDate(p.au) || p.au < p.du) {
      throw new TypeError('calendrier.periodes : période { id, du, au } invalide');
    }
    return { id: p.id, du: p.du, au: p.au };
  });
}

// Période en cours = dernière commencée (du <= aujourdhui), quel que soit l'ordre du tableau.
function periodeEnCours(periodes, aujourdhui) {
  const commencees = periodes.filter((p) => p.du <= aujourdhui).sort((a, b) => cmp(a.du, b.du) || cmp(a.id, b.id));
  return commencees.length ? commencees[commencees.length - 1] : null;
}

// --- Agrégation ------------------------------------------------------------------------

function agreger({ evenements, calendrier, aujourdhui } = {}) {
  if (!estDate(aujourdhui)) throw new TypeError('aujourdhui : date "AAAA-MM-JJ" valide attendue');
  if (!Array.isArray(evenements)) throw new TypeError('evenements : tableau attendu');
  const periodes = lirePeriodes(calendrier);
  const enCours = periodeEnCours(periodes, aujourdhui);

  const ignores = { futur: 0, invalide: 0, vacances: 0 };
  const groupes = new Map(); // notion_id -> palier -> événements valides
  for (const brut of evenements) {
    const x = lire(brut);
    if (x === null) { ignores.invalide += 1; continue; }
    if (x.jour > aujourdhui) { ignores.futur += 1; continue; }
    if (!periodes.some((p) => p.du <= x.jour && x.jour <= p.au)) { ignores.vacances += 1; continue; }
    if (!groupes.has(x.notion_id)) groupes.set(x.notion_id, new Map());
    const parPalier = groupes.get(x.notion_id);
    if (!parPalier.has(x.palier)) parPalier.set(x.palier, []);
    parPalier.get(x.palier).push(x);
  }

  const entrees = [];
  for (const notion_id of [...groupes.keys()].sort(cmp)) {
    const parPalier = groupes.get(notion_id);
    for (const palier of PALIERS) {
      const liste = parPalier.get(palier);
      if (liste === undefined) continue;
      const periode = enCours === null ? [] : liste.filter((x) => enCours.du <= x.jour && x.jour <= enCours.au);
      const n = periode.length;
      const reussites = periode.reduce((t, x) => t + x.result, 0);
      const adoption = { df: 0, maison: 0, classe: 0 };
      for (const x of periode) adoption[x.ctx] += 1;
      const cartes = cartesTriees(indexerCartes(periode));
      entrees.push({
        notion_id,
        palier,
        n_reponses: n,
        n_reussites: reussites,
        taux_periode: taux(n, reussites),
        seuil_atteint: n >= SEUIL_BASCULE,
        delta: calculerDelta(liste),
        cartes_rouges: cartes.filter((c) => c.n_reponses >= SEUIL_CARTE && c.taux < SEUIL_ROUGE),
        cartes_insuffisantes: cartes.filter((c) => c.n_reponses < SEUIL_CARTE),
        adoption,
      });
    }
  }

  return { aujourdhui, periode_id: enCours === null ? null : enCours.id, entrees, ignores };
}

module.exports = { agreger, SEUIL_BASCULE, SEUIL_CARTE, SEUIL_ROUGE };
