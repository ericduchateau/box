// Moteur de correction Box-FONDA — carte « réponse produite » (T2).
// Référence : docs/PRD-Box-FONDA.md §5.1. Zéro dépendance (Node natif).
//
// Schéma de carte attendu (champs utilisés par ce module, sur-ensemble de PRD §3.6) :
//   profil_correction : "sens" | "orthographe" | "numerique" | "exact"
//   reponses_acceptees : string[]   — formes justes déclarées par le générateur/le relecteur
//   unite  (numerique seulement, optionnel, défaut null) — AJOUT non détaillé par le PRD :
//     si renseignée (ex. "cm"), l'unité est exigée dans la réponse ; sinon toute unité
//     fournie est ignorée. Champ à valider avec Éric (cf. fonda/engine/README.md).
//   arrondi (numerique seulement, optionnel, défaut null) — AJOUT non détaillé par le PRD :
//     entier n = nombre de décimales. Si renseigné, réponse ET valeur attendue sont
//     arrondies à n décimales avant comparaison (ex. arrondi:2, attendu "1/3" →
//     0,33 accepté). null/absent = comparaison décimale exacte (hors epsilon
//     flottant), conforme à « décimaux exacts sauf arrondi mentionné » (PRD §5.1).
//
// Levenshtein (faute de frappe à 1 lettre) : volontairement absent de ce module —
// c'est la décision « OFF par défaut » du PRD §5.1, pas un oubli.

// Format UMD minimal : exploitable via require() en Node (tests, scripts) ET
// via un simple <script> dans le navigateur (pas de bundler sur ce projet —
// cohérent avec js/config.js, js/app.js existants). Pose window.FondaCorrection.
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FondaCorrection = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const PROFILS = new Set(['sens', 'orthographe', 'numerique', 'exact']);

// --- Normalisation texte --------------------------------------------------

function stripAccents(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normaliserBase(str) {
  return String(str).trim().toLowerCase().replace(/\s+/g, ' ');
}

function retirerPonctuation(str) {
  return str.replace(/[.,;:!?"'«»()[\]{}\-–—…]/g, '').replace(/\s+/g, ' ').trim();
}

// Repli naïf et documenté : on ignore un -s/-x final sur la chaîne normalisée
// entière (les cartes "sens" portent des réponses courtes — un mot, une courte
// expression — pas des phrases où ce repli mot-à-mot serait nécessaire).
function foldPluriel(str) {
  if (str.length > 1 && /[sx]$/.test(str)) return str.slice(0, -1);
  return str;
}

function normaliserSens(str) {
  return foldPluriel(retirerPonctuation(stripAccents(normaliserBase(str))));
}

function normaliserOrthographe(str) {
  // casse + espaces + ponctuation pardonnés ; accents et singulier/pluriel STRICTS
  return retirerPonctuation(normaliserBase(str));
}

function normaliserExact(str) {
  // seuls les espaces sont pardonnés ; casse et symboles stricts
  return String(str).trim().replace(/\s+/g, ' ');
}

// --- Normalisation numérique -----------------------------------------------

// Sépare un nombre (ou une fraction a/b) d'une unité éventuelle en suffixe.
// "8 cm" -> { valeur: 8, unite: "cm" } ; "6/8" -> { valeur: 0.75, unite: "" } ;
// "4,0" -> { valeur: 4, unite: "" }.
function parseReponseNumerique(brut) {
  const s = String(brut).trim().replace(',', '.');
  const m = s.match(/^(-?\d+(?:\.\d+)?\s*\/\s*-?\d+(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*([^\d\s]*)$/);
  if (!m) return { valeur: NaN, unite: '' };

  const nombrePart = m[1].replace(/\s+/g, '');
  const unite = (m[2] || '').trim().toLowerCase();

  let valeur;
  if (nombrePart.includes('/')) {
    const [a, b] = nombrePart.split('/').map(Number);
    valeur = b !== 0 ? a / b : NaN;
  } else {
    valeur = Number(nombrePart);
  }
  return { valeur, unite };
}

// Compare deux valeurs selon la règle "arrondi" de la carte : arrondi à n
// décimales de part et d'autre (ex. 1/3 et 0,33 matchent à n=2), ou égalité
// exacte (hors epsilon flottant) si arrondi est null.
function valeursCorrespondent(a, b, arrondi) {
  if (arrondi == null) return Math.abs(a - b) <= 1e-9;
  return Number(a.toFixed(arrondi)) === Number(b.toFixed(arrondi));
}

function evaluerNumerique(reponseDonnee, reponsesAcceptees, { unite = null, arrondi = null } = {}) {
  const donnee = parseReponseNumerique(reponseDonnee);
  if (Number.isNaN(donnee.valeur)) return 'faux';

  const valeurCorrecte = reponsesAcceptees
    .map((a) => parseReponseNumerique(a))
    .filter((a) => !Number.isNaN(a.valeur))
    .some((a) => valeursCorrespondent(donnee.valeur, a.valeur, arrondi));

  if (!valeurCorrecte) return 'faux';

  if (unite) {
    const uniteOk = donnee.unite.length > 0 && donnee.unite === String(unite).trim().toLowerCase();
    return uniteOk ? 'juste' : 'presque'; // valeur correcte, unité manquante ou fausse
  }
  return 'juste'; // unité non exigée par la carte : ignorée si fournie
}

// --- Normalisation littérale (sens / orthographe / exact) ------------------

function evaluerLitteral(profil, reponseDonnee, reponsesAcceptees) {
  const accepteesStr = reponsesAcceptees.map(String);

  if (profil === 'exact') {
    const d = normaliserExact(reponseDonnee);
    return accepteesStr.some((a) => normaliserExact(a) === d) ? 'juste' : 'faux';
  }

  if (profil === 'sens') {
    const d = normaliserSens(reponseDonnee);
    return accepteesStr.some((a) => normaliserSens(a) === d) ? 'juste' : 'faux';
  }

  // orthographe
  const dStrict = normaliserOrthographe(reponseDonnee);
  if (accepteesStr.some((a) => normaliserOrthographe(a) === dStrict)) return 'juste';

  // Palier relâché pour détecter le "presque" : niveau "sens" (accents + pluriel
  // pardonnés). Si ça matche à ce niveau-là mais pas au niveau strict, l'écart
  // porte précisément sur ce que ce profil est censé tester (accent/accord).
  const dRelache = normaliserSens(reponseDonnee);
  return accepteesStr.some((a) => normaliserSens(a) === dRelache) ? 'presque' : 'faux';
}

// --- API publique ------------------------------------------------------------

/**
 * Évalue une réponse produite par l'élève contre les formes acceptées d'une carte.
 * @returns {{ statut: 'juste'|'presque'|'faux' }}
 */
function evaluerReponse({ profil, reponseDonnee, reponsesAcceptees, unite = null, arrondi = null }) {
  if (!PROFILS.has(profil)) {
    throw new Error(`profil_correction inconnu: "${profil}" (attendu: ${[...PROFILS].join(' | ')})`);
  }
  const donnee = typeof reponseDonnee === 'string' ? reponseDonnee : '';
  const acceptees = Array.isArray(reponsesAcceptees) ? reponsesAcceptees : [];

  const statut = profil === 'numerique'
    ? evaluerNumerique(donnee, acceptees, { unite, arrondi })
    : evaluerLitteral(profil, donnee, acceptees);

  return { statut };
}

/**
 * Compte un statut pour la MESURE de rétention (PRD §5.1) — distinct de l'affichage
 * élève. "presque" compte juste en sens/numerique, faux en orthographe.
 * (En sens/exact, "presque" n'est de toute façon jamais produit par evaluerReponse.)
 */
function compteCommeReussite(statut, profil) {
  if (statut === 'juste') return true;
  if (statut === 'faux') return false;
  // statut === 'presque'
  return profil !== 'orthographe';
}

return {
  evaluerReponse,
  compteCommeReussite,
  // Usage interne / outillage (non contractuel) — utile pour une prévisualisation
  // live côté UI (T4+) sans dupliquer la logique de normalisation.
  _internal: {
    normaliserSens,
    normaliserOrthographe,
    normaliserExact,
    parseReponseNumerique,
  },
};

}); // fin UMD
