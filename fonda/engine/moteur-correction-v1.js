// Moteur de correction élève FONDA — version v1 (CDC relecture §4, migration M1).
// FICHIER IMMUABLE une fois publié (registre fonda/engine/moteurs.json, SRI, CI) :
// toute évolution de comportement = nouveau fichier moteur-correction-v<N+1>.js,
// nouveau set_id et nouvelle relecture pour les lots concernés.
//
// Contient TOUTE la décision pédagogique observable par l'élève :
//   - évaluation (corps de fonda/engine/correction.js, commit a418881, recopié À
//     L'IDENTIQUE dans fabriqueCorrection() ci-dessous ; correction.js n'est plus
//     qu'une façade Node qui réexporte ce corps) ;
//   - adaptation de la carte (unité, arrondi, seconde chance), cible affichée,
//     formes affichées, libellé du profil ;
//   - verdict, icône, visibilité du badge de relecture ;
//   - séquence des tentatives : tentative comptée, seconde chance, verrouillage,
//     fin de carte (E1 : « Carte suivante » seulement si carte_terminee).
// Le composant carte-reponse-produite.js ne fait qu'AFFICHER le résultat.
//
// Comportement identique au code antérieur, à l'exception des écarts volontaires
// E1–E4 (CDC §4.2) : E1 navigation (carte_terminee), E2 onResultat après verrouillage,
// E3 exception de callback interceptée, E4 issue « erreur » dans le résultat au lieu
// d'onErreur. Table des issues : juste/presque/faux/carte_invalide comptées en 1re
// tentative (carte_invalide = échec compté, inchangé), erreur jamais comptée.
//
// Chargement : Node (require) -> module.exports ; navigateur (<script> avec SRI) ->
// enregistrement sous sa version dans le registre global NON RÉASSIGNABLE
// self.FondaMoteurs (seul effet de bord). Aucun DOM, aucun réseau.

(function (racine) {
'use strict';

var VERSION = 'v1';

// --- Corps du correcteur : octets EXACTS de correction.js @ a418881, entre
// « 'use strict'; » et « }); // fin UMD » (non réindentés : prouvé par test brut) ---
function fabriqueCorrection() {
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
  const table = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };
  return str.replace(/[⁰¹²³⁴-⁹⁻]/g, (c) => table[c]);
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

// Grammaire d'une unité plausible : un ou plusieurs "tokens" de lettres (tout
// alphabet), symboles MONÉTAIRES (\p{Sc} — €, $, £, ¥... catégorie Unicode "Symbol,
// Currency", pas une liste en dur : élargit automatiquement à toute devise de cette
// catégorie, ex. 8e critique Codex/T6a : les réponses en € d'un lot de cartes
// maths échouaient à tort en carte_invalide) et symboles d'unité courants (°, %, µ,
// Ω), chaque token pouvant porter un exposant (chiffres, éventuellement précédés
// d'un "-" déjà ASCII depuis l'exposant Unicode — ex. "cm2", "s-1"), le tout pouvant
// s'enchaîner via "/" ou "·" pour une unité COMPOSÉE légitime ("m/s", "km/h",
// "kg·m2/s2", "m2·s-1" — le point médian est un JOINEUR entre deux tokens, pas un
// caractère interne : un exposant peut donc porter sur un facteur du milieu, pas
// seulement sur le dernier). Un "/" ou un "·" qui ne relie pas deux tokens propres
// (ex. ".5 cm2" résidu d'une fraction "1/2,5" tronquée, ou "/1,5") ne correspond pas
// à cette grammaire — c'est un résidu numérique malformé, jamais une unité, quels
// que soient les chiffres ou lettres qu'il contient par ailleurs.
const RE_UNITE_PLAUSIBLE = /^[\p{L}\p{Sc}°%µΩ]+(?:-?\d+)?(?:[·/][\p{L}\p{Sc}°%µΩ]+(?:-?\d+)?)*$/u;

// Détecte un ATTENDU (reponsesAcceptees) incohérent — problème d'auteur de la carte,
// indépendant de ce que tape l'élève. Trois cas, jamais "juste" :
// (1) la valeur ne parse à RIEN DE FINI (NaN) ET l'entrée contient un "/" : une
//     fraction manifestement ratée (dénominateur nul "1/0", forme non reconnue "/3")
//     plutôt qu'un simple nombre aberrant. Un nombre non fini SANS "/" (ex. un nombre
//     à 310 chiffres -> Infinity) reste couvert par le garde-fou existant (-> "faux"
//     global), ce n'est pas une incohérence de forme de l'attendu ;
// (2) le reliquat d'une entrée parsée ne respecte PAS la grammaire d'une unité
//     plausible (ci-dessus) — résidu de fraction malformée (vide, commence par un
//     chiffre/point, "/" mal placé...), même suivi d'un texte qui ressemble à une
//     unité (ex. "1/ cm²", "1/2,5 cm²") ;
// (3) le reliquat RESPECTE la grammaire (c'est une unité plausible, composée ou non)
//     mais CONTREDIT l'unité déclarée par la carte (ex. "8 kg" alors que la carte
//     exige "cm").
function detecterIncoherenceAttendu(reponsesAcceptees, unite) {
  const uniteAttendue = unite ? normaliserExposants(canoniser(String(unite)).trim()) : null;
  return reponsesAcceptees.some((a) => {
    const brut = String(a);
    const parsed = parseReponseNumerique(brut);
    if (Number.isNaN(parsed.valeur)) return brut.includes('/');
    const suffixe = parsed.unite;
    if (!suffixe) return false;
    if (!RE_UNITE_PLAUSIBLE.test(suffixe)) return true;
    return uniteAttendue != null && suffixe !== uniteAttendue;
  });
}

function evaluerNumerique(reponseDonnee, reponsesAcceptees, { unite = null, arrondi = null } = {}) {
  if (detecterIncoherenceAttendu(reponsesAcceptees, unite)) return 'carte_invalide';

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
  // Si un arrondi est défini, on formate à PRÉCISÉMENT n décimales (toFixed) plutôt
  // que d'afficher le String() brut du flottant : évite un résidu binaire visible à
  // l'écran (ex. ...0000000017) sans toucher au calcul lui-même, déjà correct.
  const valeurTexte = arrondiEffectif != null
    ? valeurCible.toFixed(arrondiEffectif).replace('.', ',')
    : formaterNombreFr(valeurCible);
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

}

// --- Couche moteur ------------------------------------------------------------
var PROFILS_CONNUS = ['sens', 'numerique', 'exact', 'orthographe'];

var TEXTES_VERDICT = {
  juste: function () { return 'Bonne réponse'; },
  presque: function (succes) { return succes ? 'Presque ! (voir ci-dessous)' : 'Pas tout à fait (voir ci-dessous)'; },
  faux: function () { return 'Pas tout à fait'; },
  carte_invalide: function () { return 'Carte à vérifier (signalée pour relecture)'; },
};
var TEXTE_ERREUR = 'Impossible de corriger cette réponse — passe à la carte suivante.';

var LABELS_PROFIL = {
  sens: 'Profil : sens',
  numerique: 'Profil : numérique',
  exact: 'Profil : exact',
  orthographe: 'Profil : orthographe',
};

function estTexte(v) { return typeof v === 'string' && v.trim() !== ''; }

function creerMoteur() {
  var C = fabriqueCorrection();

  // Validations pédagogiques d'une carte de lot (exactement celles qu'appliquait
  // bootstrap.js::lotEstBienForme). Une carte invalide rend le lot indisponible.
  function valider(c) {
    var raisons = [];
    if (!c || typeof c !== 'object') return { valide: false, issue_si_invalide: 'indisponible', raisons: ['carte non objet'] };
    if (!estTexte(c.question)) raisons.push('question vide');
    if (PROFILS_CONNUS.indexOf(c.profil_correction) === -1) raisons.push('profil inconnu');
    if (!Array.isArray(c.reponses_acceptees) || c.reponses_acceptees.length === 0
      || !c.reponses_acceptees.every(function (r) { return estTexte(r) || (typeof r === 'number' && Number.isFinite(r)); })) {
      raisons.push('reponses_acceptees invalides');
    }
    if (c.unite != null && typeof c.unite !== 'string') raisons.push('unite non texte');
    if (c.arrondi != null && !(Number.isInteger(c.arrondi) && c.arrondi >= 0 && c.arrondi <= 10)) raisons.push('arrondi hors 0..10');
    if (c.seconde_chance != null && typeof c.seconde_chance !== 'boolean') raisons.push('seconde_chance non booléen');
    // Carte invalide = lot entier indisponible pour l'élève (comportement antérieur
    // de bootstrap.js::lotEstBienForme). Les contrôles de cohérence réponse-or /
    // formes (outillage) sont dans `outils` : ils ne changent pas l'issue élève.
    return { valide: raisons.length === 0, issue_si_invalide: 'indisponible', raisons: raisons };
  }

  // Adaptation (ex-bootstrap.js::adapterCarte) + données d'affichage préparées.
  // La cible est PRÉPARÉE ici mais n'est montrée qu'après soumission (feedback).
  function preparerCarte(c) {
    // Mêmes entrées que l'ancien composant (`|| []`, `?? null`, seconde_chance
    // évaluée en vérité) : une carte malformée est corrigée exactement comme avant.
    var acceptees = c.reponses_acceptees || [];
    var unite = c.unite == null ? null : c.unite;
    var arrondi = c.arrondi == null ? null : c.arrondi;
    var formes = Array.isArray(c.reponses_acceptees) ? c.reponses_acceptees : [];
    return Object.freeze({
      question: c.question,
      profil: c.profil_correction,
      reponses_acceptees: Array.isArray(acceptees) ? Object.freeze(acceptees.slice()) : acceptees,
      unite: unite,
      arrondi: arrondi,
      seconde_chance: !!c.seconde_chance,
      cible_affichee: C.calculerCibleAffichee({ profil: c.profil_correction, reponsesAcceptees: acceptees, unite: unite, arrondi: arrondi }),
      // « Aussi acceptées » : jamais en numérique (références de calcul), et seulement
      // s'il y a plus d'une forme (comportement antérieur inchangé).
      formes_affichees: Object.freeze(c.profil_correction !== 'numerique' && formes.length > 1 ? formes.slice() : []),
      profil_libelle: LABELS_PROFIL[c.profil_correction] || '',
    });
  }

  function demarrer(carte) {
    return Object.freeze({ carte: carte, tentative: 0, terminee: false });
  }

  function construireResultat(carte, tentative, issue, reussite) {
    var erreur = issue === 'erreur';
    var secondeChance = !erreur && issue === 'presque' && carte.seconde_chance && tentative === 1;
    var texte = erreur ? TEXTE_ERREUR : (TEXTES_VERDICT[issue] || TEXTES_VERDICT.carte_invalide)(reussite);
    var resultat = Object.freeze({
      issue: issue,
      reussite: reussite,
      gabarit: erreur ? 'erreur' : 'correction',
      verdict: Object.freeze({ texte: texte, icone: erreur ? 'alerte' : (reussite ? 'succes' : 'echec') }),
      cible_affichee: carte.cible_affichee,
      formes_affichees: carte.formes_affichees,
      profil_libelle: carte.profil_libelle,
      afficher_badge_relecture: issue !== 'carte_invalide' && !erreur,
      tentative: tentative,
      // PRD §5.1 : seule la 1re tentative est scorée ; une erreur technique jamais.
      compte: !erreur && tentative === 1,
      seconde_chance_ouverte: secondeChance,
      verrouillee: !secondeChance,
      carte_terminee: !secondeChance,
    });
    return { etat: Object.freeze({ carte: carte, tentative: tentative, terminee: !secondeChance }), resultat: resultat };
  }

  function soumettre(etat, saisie) {
    if (!etat || etat.terminee) throw new Error('carte déjà terminée');
    var carte = etat.carte;
    var issue;
    var reussite;
    try {
      issue = C.evaluerReponse({
        profil: carte.profil,
        reponseDonnee: saisie,
        reponsesAcceptees: carte.reponses_acceptees,
        unite: carte.unite,
        arrondi: carte.arrondi,
      }).statut;
      reussite = C.compteCommeReussite(issue, carte.profil);
    } catch (e) {
      issue = 'erreur';
      reussite = false;
    }
    return construireResultat(carte, etat.tentative + 1, issue, reussite);
  }

  // Exception technique HORS du moteur (frontière DOM : lecture de la saisie, rendu)
  // signalée par l'interface : l'issue « erreur » reste décidée ici (jamais comptée,
  // carte verrouillée et terminée, badge masqué) — même sort qu'une exception
  // pendant l'évaluation, comme dans l'ancien composant.
  function echec(etat) {
    if (!etat || etat.terminee) throw new Error('carte déjà terminée');
    return construireResultat(etat.carte, etat.tentative + 1, 'erreur', false);
  }

  // --- Outils de validation (générateur, publication, CI) — même sémantique que
  // les anciennes fonctions de fonda/scripts/generer-lot-fonda.js. ---------------
  function formeSaisissable(carteBrute, forme) {
    var brut = String(forme);
    if (carteBrute.profil_correction !== 'numerique' || carteBrute.arrondi == null) return brut;
    var parse = C._internal.parseReponseNumerique(brut);
    if (Number.isNaN(parse.valeur)) return brut;
    var cible = C.calculerCibleAffichee({ profil: 'numerique', reponsesAcceptees: [brut], unite: null, arrondi: carteBrute.arrondi });
    return parse.unite ? cible + ' ' + parse.unite : cible;
  }
  function verifierReponseOr(carteBrute) {
    var statut = C.evaluerReponse({
      profil: carteBrute.profil_correction,
      reponseDonnee: carteBrute.reponse,
      reponsesAcceptees: carteBrute.reponses_acceptees,
      unite: carteBrute.unite || null,
      arrondi: carteBrute.arrondi == null ? null : carteBrute.arrondi,
    }).statut;
    if (statut !== 'juste') {
      return { ok: false, raison: 'le correcteur (profil "' + carteBrute.profil_correction + '") ne valide pas la réponse "' + carteBrute.reponse + '" contre reponses_acceptees=' + JSON.stringify(carteBrute.reponses_acceptees) + (carteBrute.unite ? ' unite="' + carteBrute.unite + '"' : '') + ' (statut obtenu : "' + statut + '")' };
    }
    return { ok: true };
  }
  function verifierFormesAcceptees(carteBrute) {
    var formes = Array.isArray(carteBrute.reponses_acceptees) ? carteBrute.reponses_acceptees : [];
    var refusees = formes.filter(function (forme) {
      var statut = C.evaluerReponse({
        profil: carteBrute.profil_correction,
        reponseDonnee: formeSaisissable(carteBrute, forme),
        reponsesAcceptees: formes,
        unite: carteBrute.unite || null,
        arrondi: carteBrute.arrondi == null ? null : carteBrute.arrondi,
      }).statut;
      return !C.compteCommeReussite(statut, carteBrute.profil_correction);
    });
    if (refusees.length > 0) {
      return { ok: false, raison: 'forme(s) déclarée(s) acceptée(s) mais refusée(s) par le correcteur (profil "' + carteBrute.profil_correction + '"' + (carteBrute.unite ? ', unite="' + carteBrute.unite + '"' : '') + ') : ' + JSON.stringify(refusees) };
    }
    return { ok: true };
  }

  return Object.freeze({
    version: VERSION,
    valider: valider,
    preparerCarte: preparerCarte,
    demarrer: demarrer,
    soumettre: soumettre,
    echec: echec,
    outils: Object.freeze({ verifierReponseOr: verifierReponseOr, verifierFormesAcceptees: verifierFormesAcceptees, formeSaisissable: formeSaisissable }),
  });
}

// --- Export -------------------------------------------------------------------
if (typeof module === 'object' && module.exports) {
  module.exports = Object.freeze({ version: VERSION, creerMoteur: creerMoteur, correction: fabriqueCorrection() });
  return;
}

// Navigateur : registre global NON RÉASSIGNABLE (CDC §4.1). Ni le registre ni une
// version déjà enregistrée ne peuvent être remplacés.
var d = Object.getOwnPropertyDescriptor(racine, 'FondaMoteurs');
if (!d) {
  Object.defineProperty(racine, 'FondaMoteurs', { value: Object.create(null), writable: false, configurable: false, enumerable: false });
} else if (d.writable || d.configurable || !d.value || Object.getPrototypeOf(d.value) !== null) {
  throw new Error('registre FondaMoteurs incompatible');
}
var R = racine.FondaMoteurs;
if (!Object.prototype.hasOwnProperty.call(R, VERSION)) {
  Object.defineProperty(R, VERSION, { value: Object.freeze({ version: VERSION, creerMoteur: creerMoteur }), writable: false, configurable: false, enumerable: true });
}
})(typeof self !== 'undefined' ? self : this);
