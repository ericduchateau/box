// Moteur de correction Box-FONDA — carte « réponse produite » (T2).
// Référence : docs/PRD-Box-FONDA.md §5.1. Zéro dépendance (Node natif).
// Révisé le 2026-10-05 (2 passes suite critiques Codex — voir AVANCEMENT.md).
//
// Schéma de carte attendu (champs utilisés par ce module, sur-ensemble de PRD §3.6) :
//   profil_correction : "sens" | "orthographe" | "numerique" | "exact"
//   reponses_acceptees : string[]   — formes justes déclarées par le générateur/le relecteur
//   unite  (numerique seulement, optionnel, défaut null) — AJOUT non détaillé par le PRD :
//     si renseignée (ex. "cm"), l'unité est exigée, comparaison SENSIBLE À LA CASSE
//     (mA ≠ MA — la casse des préfixes change la grandeur) :
//       - absente                  -> "presque" (valeur correcte, unité oubliée)
//       - présente mais différente -> "faux" (valeur correcte, mais grandeur fausse)
//       - présente et identique    -> "juste"
//     si non renseignée (null), AUCUN reliquat alphabétique n'est toléré dans la
//     réponse : "8" est juste pour attendu "8", mais "8 banane" est faux.
//     L'unité exigée passe par la même canonisation typographique/exposants que la
//     saisie de l'élève (symétrie) : "cm²" et "cm2" sont la même unité, des deux côtés.
//   arrondi (numerique seulement, optionnel, défaut null) — AJOUT non détaillé par le PRD :
//     entier 0 <= n <= 10 = nombre de décimales. La CIBLE (valeur attendue) est
//     arrondie à n décimales (demi vers le haut, sans l'artefact binaire de
//     toFixed/Math.round naïf) ; l'élève doit produire EXACTEMENT cette cible (1/3
//     avec arrondi:2 -> cible 0,33 ; taper "1/3" ou "0,333" est alors faux).
//     Toute valeur invalide (hors [0,10], non entière, mauvais type) retombe
//     silencieusement sur la comparaison exacte (jamais d'exception).
//
// Garde-fou global : une entrée aberrante (nombre non fini, profil inconnu, type
// inattendu) renvoie toujours "faux" — jamais d'exception, jamais "juste" par défaut.
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

// Tolérance relative "quelques ULPs" : absorbe UNIQUEMENT le bruit de représentation
// binaire des flottants (~Number.EPSILON, de l'ordre de 2.2e-16 relatif), jamais un
// écart décimal réel. Utilisée à la fois pour l'égalité numérique et pour la nudge
// d'arrondi "demi vers le haut". Volontairement beaucoup plus petite que le 1e-9
// initialement envisagé : à l'échelle de grands nombres (~1e9), une tolérance
// relative de 1e-9 vaut ~1 unité et confondrait deux entiers consécutifs distincts
// (1000000000 vs 1000000001) — ce que l'échelle ULP évite.
const EPSILON_RELATIF = Number.EPSILON * 8;

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

// Ponctuation pardonnée : UNIQUEMENT . ! ? et UNIQUEMENT en position externe
// (début/fin de la réponse). -, +, ,, / ne sont JAMAIS supprimés, ni en interne ni
// en externe : ce sont des caractères significatifs (un signe moins, une virgule
// décimale mal placée, une fraction... autant d'erreurs réelles à ne pas effacer).
function retirerPonctuationFinale(str) {
  return str.replace(/^[.!?]+|[.!?]+$/g, '').trim();
}

// Sens uniquement : l'apostrophe n'a pas de valeur sémantique pour ce profil
// (seul le sens compte), contrairement à orthographe où elle est significative.
function retirerApostrophes(str) {
  return str.replace(/'/g, '');
}

function normaliserSens(str) {
  return retirerPonctuationFinale(retirerApostrophes(stripAccents(normaliserBase(str))));
}

// Strict : casse + espaces externes + ponctuation finale . ! ? pardonnés ;
// apostrophe, trait d'union, virgule/+//, et accents SIGNIFICATIFS.
function normaliserOrthographeStrict(str) {
  return retirerPonctuationFinale(normaliserBase(str));
}

// Relâché (sert uniquement à détecter le "presque") : en plus du strict, pardonne
// les accents. N'ajoute RIEN d'autre — un écart qui ne porte que sur l'accent est
// un "presque" ; tout le reste reste "faux".
function normaliserOrthographeRelache(str) {
  return stripAccents(normaliserOrthographeStrict(str));
}

function normaliserExact(str) {
  // seuls les espaces sont pardonnés (+ canonisation Unicode) ; casse et symboles stricts
  return canoniser(str).trim().replace(/\s+/g, ' ');
}

// --- Normalisation numérique -----------------------------------------------

// Exposants Unicode -> chiffres ASCII (cm² -> cm2). Scopé à l'usage numérique
// (unités) : ne touche pas normaliserExact, qui doit rester strict sur les symboles.
function normaliserExposants(str) {
  const table = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
  return str.replace(/[⁰¹²³⁴-⁹]/g, (c) => table[c]);
}

// Sépare un nombre (ou une fraction entier/entier) d'une unité éventuelle en
// suffixe, et colle les espaces (séparateur de milliers, y compris insécable déjà
// ramené à un espace normal par canoniser()) entre chiffres. Unité : exposants
// normalisés, casse CONSERVÉE (la comparaison d'unité est sensible à la casse).
// "8 cm" -> { valeur: 8, unite: "cm" } ; "8 cm²" -> { valeur: 8, unite: "cm2" } ;
// "6/8" -> { valeur: 0.75, unite: "" } ; "1 000" -> { valeur: 1000, unite: "" }.
// Toute valeur non finie (nombre à centaines de chiffres -> Infinity) est traitée
// comme invalide (NaN), jamais acceptée.
function parseReponseNumerique(brut) {
  let s = canoniser(brut).trim().replace(',', '.');
  s = s.replace(/(\d)\s+(?=\d)/g, '$1'); // séparateur de milliers
  // Fraction : UNIQUEMENT entier/entier (6/8 = 3/4). Toute autre forme avec "/"
  // (décimaux, etc.) n'est pas traitée comme une fraction — restriction volontaire.
  const m = s.match(/^(-?\d+\s*\/\s*-?\d+|-?\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return { valeur: NaN, unite: '' };

  const nombrePart = m[1].replace(/\s+/g, '');
  const unite = normaliserExposants((m[2] || '').trim());

  let valeur;
  if (nombrePart.includes('/')) {
    const [a, b] = nombrePart.split('/').map(Number);
    valeur = b !== 0 ? a / b : NaN;
  } else {
    valeur = Number(nombrePart);
  }
  if (!Number.isFinite(valeur)) valeur = NaN; // garde-fou : Infinity/-Infinity jamais acceptés
  return { valeur, unite };
}

// Arrondi "demi vers le haut" à n décimales, avec une nudge RELATIVE (pas absolue)
// pour absorber l'erreur de représentation binaire habituelle (ex. 2.675 est en
// réalité stocké en mémoire comme 2.67499999999999982... : un arrondi naïf
// arrondirait donc à 2.67 au lieu de 2.68). La nudge est mise à l'échelle de la
// valeur (quelques ULPs, ~1e-15 relatif) : assez grande pour corriger ce bruit
// binaire réel, bien trop petite pour faire franchir un seuil décimal volontaire
// (ex. 2.674999999999, dont l'écart à 2.675 est ~1e-12, DOIT rester arrondi à 2.67).
function arrondirDemiVersHaut(valeur, decimales) {
  const facteur = Math.pow(10, decimales);
  const nudge = Math.abs(valeur) * EPSILON_RELATIF * facteur;
  const signe = valeur >= 0 ? 1 : -1;
  return Math.round(valeur * facteur + signe * nudge) / facteur;
}

function arrondiValide(arrondi) {
  return Number.isInteger(arrondi) && arrondi >= 0 && arrondi <= 10;
}

// Égalité "binaire" : absorbe uniquement le bruit de représentation flottante
// (division, etc.), jamais un écart décimal réel — y compris près de zéro (pas de
// plancher de tolérance absolu : 0 et 0.0000000000005 doivent rester distincts).
function valeursEgalesBinaire(a, b) {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const echelle = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= echelle * EPSILON_RELATIF;
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
    // Symétrie : l'unité EXIGÉE passe par la même canonisation/normalisation
    // d'exposants que la saisie de l'élève. Casse CONSERVÉE des deux côtés.
    const uniteAttendue = normaliserExposants(canoniser(String(unite)).trim());
    if (!donnee.unite) return 'presque'; // valeur correcte, unité oubliée
    return donnee.unite === uniteAttendue ? 'juste' : 'faux'; // unité fausse = faux net
  }
  // Unité non exigée : aucun reliquat alphabétique toléré.
  return donnee.unite ? 'faux' : 'juste';
}

// --- Normalisation littérale (sens / orthographe / exact) ------------------

function evaluerLitteral(profil, reponseDonnee, reponsesAcceptees) {
  const accepteesStr = reponsesAcceptees.map(String);

  if (profil === 'exact') {
    const d = normaliserExact(reponseDonnee);
    if (d === '') return 'faux'; // contrôle du vide en dernier, après normalisation
    return accepteesStr.some((a) => normaliserExact(a) === d) ? 'juste' : 'faux';
  }

  if (profil === 'sens') {
    const d = normaliserSens(reponseDonnee);
    if (d === '') return 'faux';
    return accepteesStr.some((a) => normaliserSens(a) === d) ? 'juste' : 'faux';
  }

  // orthographe
  const dStrict = normaliserOrthographeStrict(reponseDonnee);
  if (dStrict === '') return 'faux'; // contrôle du vide en dernier, après normalisation
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
 * Une réponse qui se normalise en chaîne vide (vide, espaces, ou purement
 * ponctuation pardonnée comme "!!!") est toujours "faux", quel que soit le contenu
 * de reponsesAcceptees (carte malformée incluse). Profil inconnu -> "faux", jamais
 * d'exception.
 * @returns {{ statut: 'juste'|'presque'|'faux' }}
 */
function evaluerReponse({ profil, reponseDonnee, reponsesAcceptees, unite = null, arrondi = null }) {
  if (!PROFILS.has(profil)) {
    return { statut: 'faux' };
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
 * élève. Un profil inconnu/undefined ne compte JAMAIS, même pour un statut "juste"
 * (une donnée malformée ne doit jamais produire une réussite silencieuse). Sinon,
 * "presque" compte juste UNIQUEMENT en sens et numerique ; faux partout ailleurs.
 */
function compteCommeReussite(statut, profil) {
  if (!PROFILS.has(profil)) return false;
  if (statut === 'juste') return true;
  if (statut === 'presque') return profil === 'sens' || profil === 'numerique';
  return false; // 'faux', undefined, ou tout statut inconnu
}

// Formatage simple d'un nombre pour affichage, cohérent avec la saisie attendue
// côté app (virgule décimale).
function formaterNombreFr(valeur) {
  return String(valeur).replace('.', ',');
}

/**
 * Calcule la cible réellement exigée, pour l'affichage pédagogique (feedback) —
 * jamais la première réponse acceptée brute telle quelle en numérique : si un
 * arrondi est défini, affiche la valeur APRÈS arrondi ; si une unité est exigée,
 * l'affiche accolée. Pour les profils littéraux, retourne simplement la première
 * forme acceptée (rien à recalculer).
 */
function calculerCibleAffichee({ profil, reponsesAcceptees, unite = null, arrondi = null }) {
  const acceptees = Array.isArray(reponsesAcceptees) ? reponsesAcceptees : [];
  const premiere = acceptees[0] !== undefined ? String(acceptees[0]) : '';
  if (profil !== 'numerique') return premiere;

  const parse = parseReponseNumerique(premiere);
  if (Number.isNaN(parse.valeur)) return premiere; // repli : rien de mieux à afficher

  const arrondiEffectif = arrondiValide(arrondi) ? arrondi : null;
  const valeurCible = arrondiEffectif != null ? arrondirDemiVersHaut(parse.valeur, arrondiEffectif) : parse.valeur;
  const valeurTexte = formaterNombreFr(valeurCible);
  return unite ? `${valeurTexte} ${unite}` : valeurTexte;
}

return {
  evaluerReponse,
  compteCommeReussite,
  calculerCibleAffichee,
  // Usage interne / outillage (non contractuel) — utile pour une prévisualisation
  // live côté UI (T4+) sans dupliquer la logique de normalisation.
  _internal: {
    canoniser,
    normaliserSens,
    normaliserOrthographeStrict,
    normaliserOrthographeRelache,
    normaliserExact,
    normaliserExposants,
    parseReponseNumerique,
    arrondirDemiVersHaut,
  },
};

}); // fin UMD
