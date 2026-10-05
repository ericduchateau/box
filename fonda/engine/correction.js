// Moteur de correction Box-FONDA — carte « réponse produite » (T2).
// Référence : docs/PRD-Box-FONDA.md §5.1. Zéro dépendance (Node natif).
// Révisé le 2026-10-05 suite critique Codex (voir AVANCEMENT.md) — arbitrages validés par Éric.
//
// Schéma de carte attendu (champs utilisés par ce module, sur-ensemble de PRD §3.6) :
//   profil_correction : "sens" | "orthographe" | "numerique" | "exact"
//   reponses_acceptees : string[]   — formes justes déclarées par le générateur/le relecteur
//   unite  (numerique seulement, optionnel, défaut null) — AJOUT non détaillé par le PRD :
//     si renseignée (ex. "cm"), l'unité est exigée dans la réponse :
//       - absente                  -> "presque" (valeur correcte, unité oubliée)
//       - présente mais différente -> "faux" (valeur correcte, mais grandeur fausse)
//       - présente et identique    -> "juste"
//     si non renseignée (null), AUCUN reliquat alphabétique n'est toléré dans la
//     réponse : "8" est juste pour attendu "8", mais "8 banane" est faux.
//   arrondi (numerique seulement, optionnel, défaut null) — AJOUT non détaillé par le PRD :
//     entier n >= 0 = nombre de décimales. La CIBLE (valeur attendue) est arrondie à
//     n décimales (demi vers le haut, sans l'artefact binaire de toFixed) ; l'élève
//     doit produire EXACTEMENT cette cible (1/3 avec arrondi:2 -> cible 0,33 ; taper
//     "1/3" ou "0,333" est alors faux, l'arrondi est un exercice, pas une tolérance).
//     Toute valeur invalide (négative, non entière, mauvais type) retombe
//     silencieusement sur la comparaison exacte (pas d'exception).
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

// --- Couche de normalisation commune (AVANT les règles de profil, tous profils) --

// NFC (règle le cas d'un accent saisi en forme décomposée, ex. É = "E" + accent
// combinant, qui sans ça ne matcherait pas visuellement le même É précomposé) +
// variantes typographiques ramenées à leur forme ASCII canonique : apostrophes
// courbes, tirets/tirets demi-cadratin/signe moins, espaces insécables/fines.
function canoniser(str) {
  return String(str)
    .normalize('NFC')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/[     ]/g, ' ');
}

// --- Normalisation texte --------------------------------------------------

function stripAccents(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normaliserBase(str) {
  return canoniser(str).trim().toLowerCase().replace(/\s+/g, ' ');
}

// Ponctuation "large" (profil sens) : inclut apostrophe et trait d'union, qui n'ont
// pas de valeur sémantique propre pour ce profil (seul le sens compte).
function retirerPonctuationLarge(str) {
  return str.replace(/[.,;:!?"'«»()[\]{}\-–—…]/g, '').replace(/\s+/g, ' ').trim();
}

// Ponctuation "de phrase" (profil orthographe) : UNIQUEMENT . , ; ! — apostrophe et
// trait d'union sont volontairement exclus, car significatifs en orthographe.
function retirerPonctuationPhrase(str) {
  return str.replace(/[.,;!]/g, '').replace(/\s+/g, ' ').trim();
}

function normaliserSens(str) {
  return retirerPonctuationLarge(stripAccents(normaliserBase(str)));
}

// Strict : casse + espaces externes + ponctuation de phrase pardonnés ;
// apostrophe, trait d'union et accents SIGNIFICATIFS.
function normaliserOrthographeStrict(str) {
  return retirerPonctuationPhrase(normaliserBase(str));
}

// Relâché (sert uniquement à détecter le "presque") : en plus du strict, pardonne
// les accents. N'ajoute RIEN d'autre (ni apostrophe, ni pluriel) — un écart qui ne
// porte que sur l'accent est un "presque" ; tout le reste reste "faux".
function normaliserOrthographeRelache(str) {
  return stripAccents(normaliserOrthographeStrict(str));
}

function normaliserExact(str) {
  // seuls les espaces sont pardonnés (+ canonisation Unicode) ; casse et symboles stricts
  return canoniser(str).trim().replace(/\s+/g, ' ');
}

// --- Normalisation numérique -----------------------------------------------

// Sépare un nombre (ou une fraction entier/entier) d'une unité éventuelle en
// suffixe, et colle les espaces (séparateur de milliers, y compris insécable déjà
// ramené à un espace normal par canoniser()) entre chiffres.
// "8 cm" -> { valeur: 8, unite: "cm" } ; "8 cm2" -> { valeur: 8, unite: "cm2" } ;
// "6/8" -> { valeur: 0.75, unite: "" } ; "1 000" -> { valeur: 1000, unite: "" }.
function parseReponseNumerique(brut) {
  let s = canoniser(brut).trim().replace(',', '.');
  s = s.replace(/(\d)\s+(?=\d)/g, '$1'); // séparateur de milliers
  // Fraction : UNIQUEMENT entier/entier (6/8 = 3/4). Toute autre forme avec "/"
  // (décimaux, etc.) n'est pas traitée comme une fraction — restriction volontaire.
  const m = s.match(/^(-?\d+\s*\/\s*-?\d+|-?\d+(?:\.\d+)?)\s*(.*)$/);
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

// Arrondi "demi vers le haut" à n décimales, avec une nudge pour absorber l'erreur
// de représentation binaire habituelle (ex. 2.675 est en réalité stocké en mémoire
// comme 2.67499999999999982... : Math.round/toFixed naïfs arrondiraient donc à
// 2.67 au lieu de 2.68). La nudge (1e-9) est très supérieure au bruit binaire réel
// (~1e-15 à cette échelle) mais bien plus petite que n'importe quel écart décimal
// significatif à l'échelle d'une réponse de carte.
function arrondirDemiVersHaut(valeur, decimales) {
  const facteur = Math.pow(10, decimales);
  const nudge = valeur >= 0 ? 1e-9 : -1e-9;
  return Math.round(valeur * facteur + nudge) / facteur;
}

function arrondiValide(arrondi) {
  return Number.isInteger(arrondi) && arrondi >= 0;
}

// Égalité "binaire" : absorbe uniquement le bruit de représentation flottante
// (division, etc.), jamais un écart décimal réel. Tolérance relative à l'échelle
// des valeurs comparées, avec un plancher bas pour ne pas confondre des nombres
// réellement distincts proches de zéro (ex. 0 et 0.0000000009 doivent rester faux).
function valeursEgalesBinaire(a, b) {
  const diff = Math.abs(a - b);
  if (diff === 0) return true;
  const echelle = Math.max(Math.abs(a), Math.abs(b));
  return diff <= Math.max(echelle * 1e-9, 1e-12);
}

function evaluerNumerique(reponseDonnee, reponsesAcceptees, { unite = null, arrondi = null } = {}) {
  const donnee = parseReponseNumerique(reponseDonnee);
  if (Number.isNaN(donnee.valeur)) return 'faux';

  const arrondiEffectif = arrondiValide(arrondi) ? arrondi : null;

  const valeurCorrecte = reponsesAcceptees
    .map((a) => parseReponseNumerique(a))
    .filter((a) => !Number.isNaN(a.valeur))
    .some((a) => {
      const cible = arrondiEffectif != null ? arrondirDemiVersHaut(a.valeur, arrondiEffectif) : a.valeur;
      return valeursEgalesBinaire(donnee.valeur, cible);
    });

  if (!valeurCorrecte) return 'faux';

  if (unite) {
    if (!donnee.unite) return 'presque'; // valeur correcte, unité oubliée
    return donnee.unite === String(unite).trim().toLowerCase() ? 'juste' : 'faux'; // unité fausse = faux net
  }
  // Unité non exigée : aucun reliquat alphabétique toléré.
  return donnee.unite ? 'faux' : 'juste';
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
  const dStrict = normaliserOrthographeStrict(reponseDonnee);
  if (accepteesStr.some((a) => normaliserOrthographeStrict(a) === dStrict)) return 'juste';

  // Palier relâché (accents uniquement) pour détecter le "presque" : si ça matche
  // une fois l'accent pardonné mais pas en strict, l'écart porte précisément sur
  // ce que ce profil est censé tester.
  const dRelache = normaliserOrthographeRelache(reponseDonnee);
  return accepteesStr.some((a) => normaliserOrthographeRelache(a) === dRelache) ? 'presque' : 'faux';
}

// --- API publique ------------------------------------------------------------

/**
 * Évalue une réponse produite par l'élève contre les formes acceptées d'une carte.
 * Une réponse vide (ou uniquement des espaces) est toujours "faux", quel que soit
 * le contenu de reponsesAcceptees (carte malformée incluse).
 * @returns {{ statut: 'juste'|'presque'|'faux' }}
 */
function evaluerReponse({ profil, reponseDonnee, reponsesAcceptees, unite = null, arrondi = null }) {
  if (!PROFILS.has(profil)) {
    throw new Error(`profil_correction inconnu: "${profil}" (attendu: ${[...PROFILS].join(' | ')})`);
  }
  const donnee = typeof reponseDonnee === 'string' ? reponseDonnee : '';
  const acceptees = Array.isArray(reponsesAcceptees) ? reponsesAcceptees : [];

  if (donnee.trim().length === 0) {
    return { statut: 'faux' };
  }

  const statut = profil === 'numerique'
    ? evaluerNumerique(donnee, acceptees, { unite, arrondi })
    : evaluerLitteral(profil, donnee, acceptees);

  return { statut };
}

/**
 * Compte un statut pour la MESURE de rétention (PRD §5.1) — distinct de l'affichage
 * élève. "presque" compte juste UNIQUEMENT en sens et numerique ; faux partout
 * ailleurs (orthographe, exact, profil ou statut inconnu) — défaut sûr : jamais de
 * réussite silencieuse sur une donnée malformée.
 */
function compteCommeReussite(statut, profil) {
  if (statut === 'juste') return true;
  if (statut === 'presque') return profil === 'sens' || profil === 'numerique';
  return false; // 'faux', undefined, ou tout statut inconnu
}

return {
  evaluerReponse,
  compteCommeReussite,
  // Usage interne / outillage (non contractuel) — utile pour une prévisualisation
  // live côté UI (T4+) sans dupliquer la logique de normalisation.
  _internal: {
    canoniser,
    normaliserSens,
    normaliserOrthographeStrict,
    normaliserOrthographeRelache,
    normaliserExact,
    parseReponseNumerique,
    arrondirDemiVersHaut,
  },
};

}); // fin UMD
