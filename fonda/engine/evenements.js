// Émission d'événements Box-FONDA (T3) — construit, verrouille et met en file les
// événements de mesure, sans jamais les envoyer au réseau (la collecte n8n est T5).
// Référence : docs/PRD-Box-FONDA.md §3.2, §5.1, §6 ; AGENTS.md G2 (sans compte élève,
// progression locale), G3 (aucune donnée nominative de mineur).
//
// Zéro dépendance : format UMD, comme fonda/engine/correction.js — require()-able en
// Node (tests, scripts) et chargeable en <script> classique côté navigateur. Ce module
// ne lit JAMAIS localStorage lui-même en dur : le stockage est INJECTÉ en paramètre
// (`stockage`, duck-type { getItem, setItem }), pour rester testable et pour que
// l'appelant (T4) contrôle explicitement quel store est utilisé (window.localStorage
// en prod). De même, `classesAutorisees` (contenu de fonda/data/classes.json) et le
// contexte du défi (defiId/setId/notionId/palier) sont fournis par l'appelant — ce
// module ne les invente ni ne les devine.
//
// Garde-fous G2/G3 (non négociables) :
//   - `grp` est EXCLUSIVEMENT lu depuis `defi_id` (lui-même construit par le prof au
//     lancement du défi, cf. T4) — jamais saisi par l'élève, jamais dérivé d'un nom,
//     d'un identifiant, d'une IP ou d'un historique.
//   - L'événement construit contient EXACTEMENT les 11 champs du schéma §3.2, jamais
//     plus : même si l'appelant passe des paramètres étrangers (ex. un nom d'élève par
//     erreur), ils ne peuvent pas fuiter car l'événement est reconstruit champ par
//     champ, jamais par copie/spread de l'entrée. Revalidé juste avant mise en file
//     par le validateur de T1 (liste blanche stricte).
//   - La réponse brute/normalisée de l'élève n'est JAMAIS transmise : seul `result`
//     (0 ou 1) l'est, déjà calculé par T2.
//   - `ts` est arrondi (tronqué) à l'heure : jamais la seconde/minute, pour limiter la
//     réidentification par recoupement horaire fin.
//
// Verrou "un vote" : scellé sous la clé `${defiId}::${itemId}` — vérification PUIS
// écriture dans un même bloc synchrone (pas d'attente entre les deux), ce qui est
// suffisant pour un double-clic, un double callback ou un rechargement DANS LE MÊME
// onglet (JS y est mono-thread, aucun autre code ne peut s'intercaler). Entre deux
// onglets véritablement distincts (processus séparés), `localStorage` n'offre aucune
// primitive de comparaison-et-échange atomique : une course très rare reste possible.
// Limite documentée (voir fonda/engine/README.md), pas corrigée ici — cf. l'esprit
// G6 (« protection légère assumée », pas une garantie de sécurité).
//
// Historique par item (pour rang_local/dt_jours) : scellé sous `${setId}::${itemId}`,
// DISTINCT de la clé de verrou — doit survivre au changement de `defi_id` d'une
// occurrence à l'autre (le verrou, lui, est scopé par occurrence). Ce choix résout
// l'ambiguïté « item_id unique seulement à l'intérieur d'un jeu » relevée en amont.

(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../scripts/validate.js').validerEvenement);
  } else {
    root.FondaEvenements = factory(root.FondaValidate && root.FondaValidate.validerEvenement);
  }
})(typeof self !== 'undefined' ? self : this, function (validerEvenement) {
'use strict';

const CTX_VALUES = new Set(['df', 'maison', 'classe']);

// defi_{annee}-w{semaine}_{grp 3 chiffres}_{notion-slug} — ex. defi_2026-w41_601_fractions.
// Le grp est TOUJOURS exactement 3 chiffres (format canonique de classes.json) : une
// forme "6e4" ou "abc" ne matche pas ce pattern et rend le defi_id lui-même invalide,
// distinct du cas "grp bien formé mais absent du roster" (géré séparément).
const DEFI_ID_PATTERN = /^defi_\d{4}-w\d{1,2}_([0-9]{3})_[a-z0-9-]+$/;

const CLE_VERROUS = 'fonda_evt_verrous';
const CLE_HISTORIQUE = 'fonda_evt_historique';
const CLE_FILE = 'fonda_evt_file';

function extraireGrpDepuisDefiId(defiId) {
  if (typeof defiId !== 'string') return null;
  const m = defiId.match(DEFI_ID_PATTERN);
  return m ? m[1] : null;
}

function grpEstAutorise(grp, classesAutorisees) {
  const classes = classesAutorisees instanceof Set ? classesAutorisees : new Set(classesAutorisees || []);
  return typeof grp === 'string' && classes.has(grp);
}

function ctxEstValide(ctx) {
  return CTX_VALUES.has(ctx);
}

// Tronque (pas d'arrondi au plus proche : toujours vers le bas) à l'heure UTC pleine.
function tronquerAHeure(date) {
  const d = new Date(date.getTime());
  d.setUTCMinutes(0, 0, 0);
  return d;
}

// Lecture défensive d'un blob JSON de stockage. Distingue explicitement "absent"
// (renvoie `parDefaut`) de "corrompu" (renvoie `undefined` — jamais confondus : un
// JSON corrompu ne doit jamais être silencieusement traité comme une table vide, ce
// qui romprait le verrou ou l'historique existants).
function lireJSON(stockage, cle, parDefaut) {
  const brut = stockage.getItem(cle);
  if (brut === null || brut === undefined) return parDefaut;
  try {
    return JSON.parse(brut);
  } catch {
    return undefined;
  }
}

/**
 * Construit, verrouille et met en file (localement — AUCUN réseau) un événement de
 * mesure Box-FONDA pour une tentative, si et seulement si elle est éligible.
 *
 * @param {object} p
 * @param {string} p.defiId - identité du défi, encode le grp (ex. "defi_2026-w41_601_fractions")
 * @param {string} p.itemId - identité de la carte, portée du verrou avec defiId
 * @param {string} p.setId - identité du jeu, portée de l'historique avec itemId
 * @param {string} p.notionId - fourni par l'appelant, jamais deviné
 * @param {string} p.palier - "nI" | "nF", fourni par l'appelant
 * @param {string} p.ctx - "df" | "maison" | "classe"
 * @param {boolean} p.reussite - résultat scoré (T2 : compteCommeReussite(...))
 * @param {boolean} p.scored - T2 : true UNIQUEMENT pour la 1ère tentative
 * @param {Set<string>|string[]} p.classesAutorisees - contenu de fonda/data/classes.json
 * @param {Set<string>|string[]} [p.notionIdsConnus] - notion_id valides (referentiel.json) ; si omis, la vérification contre le référentiel est un no-op
 * @param {{getItem:Function,setItem:Function}} p.stockage - ex. window.localStorage, injecté (jamais lu en dur)
 * @param {() => Date} p.maintenant - horloge injectée (testabilité)
 * @returns {{ emis:true, event:object } | { emis:false, raison:string, erreurs?:string[] }}
 */
function soumettreTentative({
  defiId, itemId, setId, notionId, palier, ctx,
  reussite, scored,
  classesAutorisees,
  notionIdsConnus,
  stockage,
  maintenant,
}) {
  // Seconde chance (PRD §5.1) : aucune émission, AUCUNE écriture (ni verrou, ni
  // historique, ni file) — elle ne doit laisser aucune trace mesurable.
  if (scored !== true) {
    return { emis: false, raison: 'non_score' };
  }

  if (!ctxEstValide(ctx)) {
    return { emis: false, raison: 'contexte_invalide' };
  }

  const grp = extraireGrpDepuisDefiId(defiId);
  if (grp === null) {
    return { emis: false, raison: 'defi_id_invalide' };
  }
  if (!grpEstAutorise(grp, classesAutorisees)) {
    return { emis: false, raison: 'grp_non_autorise' };
  }

  if (!itemId || !setId || !notionId || !palier) {
    return { emis: false, raison: 'contexte_incomplet' };
  }

  if (!stockage || typeof stockage.getItem !== 'function' || typeof stockage.setItem !== 'function') {
    return { emis: false, raison: 'stockage_indisponible' };
  }

  let verrous;
  let historique;
  let file;
  try {
    verrous = lireJSON(stockage, CLE_VERROUS, {});
    historique = lireJSON(stockage, CLE_HISTORIQUE, {});
    file = lireJSON(stockage, CLE_FILE, []);
  } catch {
    return { emis: false, raison: 'stockage_indisponible' };
  }
  if (verrous === undefined || historique === undefined || file === undefined) {
    return { emis: false, raison: 'stockage_corrompu' };
  }
  if (typeof verrous !== 'object' || verrous === null || Array.isArray(verrous)) verrous = {};
  if (typeof historique !== 'object' || historique === null || Array.isArray(historique)) historique = {};
  if (!Array.isArray(file)) file = [];

  const cleVerrou = `${defiId}::${itemId}`;
  if (verrous[cleVerrou]) {
    return { emis: false, raison: 'deja_vote' };
  }

  const now = typeof maintenant === 'function' ? maintenant() : undefined;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    return { emis: false, raison: 'horloge_invalide' };
  }
  const ts = tronquerAHeure(now);

  const cleHistorique = `${setId}::${itemId}`;
  const passages = Array.isArray(historique[cleHistorique]) ? historique[cleHistorique] : [];

  const rangLocal = passages.length + 1;
  let dtJours = null;
  if (passages.length > 0) {
    const dernier = passages[passages.length - 1];
    const dernierTs = dernier && typeof dernier.ts === 'string' ? new Date(dernier.ts) : null;
    if (!dernierTs || Number.isNaN(dernierTs.getTime())) {
      return { emis: false, raison: 'historique_corrompu' };
    }
    const diffMs = ts.getTime() - dernierTs.getTime();
    // Horloge reculée / date future par rapport au dernier passage connu : on borne à
    // 0 plutôt que d'envoyer un délai négatif (jamais de NaN non plus, par construction).
    dtJours = Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
  }

  const event = {
    ts: ts.toISOString(),
    grp,
    defi_id: defiId,
    notion_id: notionId,
    palier,
    set_id: setId,
    item_id: itemId,
    result: reussite ? 1 : 0,
    ctx,
    rang_local: rangLocal,
    dt_jours: dtJours,
  };

  const validation = validerEvenement(event, notionIdsConnus !== undefined ? notionIdsConnus : [notionId]);
  if (!validation.valide) {
    return { emis: false, raison: 'event_invalide', erreurs: validation.erreurs };
  }

  const eventScelle = Object.freeze({ ...event });

  verrous[cleVerrou] = true;
  historique[cleHistorique] = [...passages, { ts: event.ts, defi_id: defiId }];

  try {
    stockage.setItem(CLE_VERROUS, JSON.stringify(verrous));
    stockage.setItem(CLE_HISTORIQUE, JSON.stringify(historique));
    stockage.setItem(CLE_FILE, JSON.stringify([...file, eventScelle]));
  } catch {
    return { emis: false, raison: 'stockage_indisponible' };
  }

  return { emis: true, event: eventScelle };
}

return {
  soumettreTentative,
  extraireGrpDepuisDefiId,
  grpEstAutorise,
  ctxEstValide,
  CLE_VERROUS,
  CLE_HISTORIQUE,
  CLE_FILE,
};

}); // fin UMD
