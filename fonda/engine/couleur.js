// Moteur A, module 2 — couleur par (notion, palier) (fonction PURE, déterministe).
// Contrat : fonda/engine/couleur.test.js ; docs/SPEC-moteur-a.md §2, §3, §3 bis.
// Entrées de CONFIANCE (sortie du module 1 + referentiel.json curé) : fail-fast, TypeError sur
// toute forme inattendue (à l'inverse du module 1, tolérant envers des événements non fiables).
// Zéro dépendance.

'use strict';

const SEUIL_VERT = 0.75;
const SEUIL_AMBRE = 0.5;

const PALIERS = ['nI', 'nF'];
const PRIORITES = new Set(['rouge', 'ambre', 'vert']);

// Comparaison par UNITÉS DE CODE (opérateur <), jamais localeCompare.
function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

function couleurDepuisTaux(taux) {
  if (taux >= SEUIL_VERT) return 'vert';
  if (taux >= SEUIL_AMBRE) return 'ambre';
  return 'rouge';
}

// (notion, palier) du référentiel, validés : Map notion_id -> { priorite, paliers: Set }.
function lireReferentiel(referentiel) {
  const notions = referentiel && typeof referentiel === 'object' ? referentiel.notions : undefined;
  if (!Array.isArray(notions)) throw new TypeError('referentiel.notions : tableau attendu');
  const index = new Map();
  for (const n of notions) {
    if (!n || typeof n !== 'object' || typeof n.id !== 'string' || n.id.length === 0) {
      throw new TypeError('referentiel.notions : notion sans id');
    }
    if (index.has(n.id)) throw new TypeError(`referentiel.notions : notion ${n.id} en double`);
    const { paliers } = n;
    let paliersValides = Array.isArray(paliers) && paliers.length > 0;
    // Boucle indexée (et non every(), qui saute les trous d'un tableau creux).
    for (let i = 0; paliersValides && i < paliers.length; i += 1) {
      paliersValides = Object.prototype.hasOwnProperty.call(paliers, i) && PALIERS.includes(paliers[i]);
    }
    if (!paliersValides || new Set(paliers).size !== paliers.length) {
      throw new TypeError(`referentiel.notions : paliers invalides pour ${n.id}`);
    }
    // Absente -> gris ; toute valeur présente doit être une priorité de diagnostic.
    if (n.priorite_initiale !== undefined && !PRIORITES.has(n.priorite_initiale)) {
      throw new TypeError(`referentiel.notions : priorite_initiale invalide pour ${n.id}`);
    }
    index.set(n.id, { priorite: n.priorite_initiale === undefined ? 'gris' : n.priorite_initiale, paliers: new Set(paliers) });
  }
  return index;
}

function tauxValide(t) { return typeof t === 'number' && Number.isFinite(t) && t >= 0 && t <= 1; }

// Entrée d'agrégation (sortie du module 1), validée : forme, seuil booléen, taux null ou dans
// [0, 1], jamais null quand le seuil est atteint. Toute autre forme -> TypeError.
function validerEntree(e) {
  if (e === null || typeof e !== 'object') throw new TypeError('agregation.entrees : entrée non objet');
  if (typeof e.notion_id !== 'string' || e.notion_id.length === 0) throw new TypeError('agregation.entrees : notion_id invalide');
  if (!PALIERS.includes(e.palier)) throw new TypeError(`agregation.entrees : palier invalide pour ${e.notion_id}`);
  if (typeof e.seuil_atteint !== 'boolean') throw new TypeError(`agregation.entrees : seuil_atteint non booléen pour ${e.notion_id}`);
  if (!(e.taux_periode === null || tauxValide(e.taux_periode))) throw new TypeError(`agregation.entrees : taux_periode invalide pour ${e.notion_id}`);
  if (e.seuil_atteint && e.taux_periode === null) throw new TypeError(`agregation.entrees : seuil atteint sans taux pour ${e.notion_id}`);
  return e;
}

function colorer({ agregation, referentiel } = {}) {
  const entrees = agregation && typeof agregation === 'object' ? agregation.entrees : undefined;
  if (!Array.isArray(entrees)) throw new TypeError('agregation.entrees : tableau attendu');
  const notions = lireReferentiel(referentiel);

  // Entrées d'agrégation validées puis indexées par Map imbriquées notion_id -> palier. Un doublon
  // (notion_id, palier) lève : en choisir un dépendrait de l'ordre des entrées.
  const parNotion = new Map();
  let horsReferentiel = 0;
  for (const brute of entrees) {
    const e = validerEntree(brute);
    if (!parNotion.has(e.notion_id)) parNotion.set(e.notion_id, new Map());
    const parPalier = parNotion.get(e.notion_id);
    if (parPalier.has(e.palier)) throw new TypeError(`agregation.entrees : (${e.notion_id}, ${e.palier}) en double`);
    parPalier.set(e.palier, e);
    const n = notions.get(e.notion_id);
    if (n === undefined || !n.paliers.has(e.palier)) horsReferentiel += 1;
  }

  const couleurs = [];
  for (const notion_id of [...notions.keys()].sort(cmp)) {
    const n = notions.get(notion_id);
    for (const palier of PALIERS) {
      if (!n.paliers.has(palier)) continue;
      const e = parNotion.has(notion_id) ? parNotion.get(notion_id).get(palier) : undefined;
      const seuil = e !== undefined && e.seuil_atteint;
      couleurs.push({
        notion_id,
        palier,
        couleur: seuil ? couleurDepuisTaux(e.taux_periode) : n.priorite,
        source: seuil ? 'stats_cartes' : 'priorite_initiale',
        taux_periode: e === undefined ? null : e.taux_periode,
        seuil_atteint: seuil,
      });
    }
  }

  return { periode_id: agregation.periode_id, couleurs, ignores: { hors_referentiel: horsReferentiel } };
}

module.exports = { colorer, SEUIL_VERT, SEUIL_AMBRE };
