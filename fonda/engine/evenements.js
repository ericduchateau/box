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
//   - `itemId`/`setId`/`notionId`/`defiId` sont vérifiés dans leur NATURE (chaîne non
//     vide, longueur bornée, caractères limités à [A-Za-z0-9._-] — jamais d'espace ni
//     de texte libre), PAS dans leur FORMAT métier : ce module ne sait pas, et ne doit
//     pas deviner, quels ids sont "réels" au sens du référentiel/des jeux de cartes
//     (T1/T6 le garantissent en amont). Objectif unique ici : empêcher qu'un nom ou un
//     commentaire libre se glisse dans un champ autorisé par erreur d'appel.
//   - La réponse brute/normalisée de l'élève n'est JAMAIS transmise : seul `result`
//     (0 ou 1) l'est, déjà calculé par T2.
//   - `ts` est arrondi (tronqué) à l'heure : jamais la seconde/minute, pour limiter la
//     réidentification par recoupement horaire fin.
//   - Un échec de validation ne renvoie JAMAIS la valeur fautive à l'appelant (juste un
//     code `raison`) : un message d'erreur n'est pas un canal d'évasion pour une donnée
//     qu'on vient de refuser.
//
// Verrou "un vote" + historique + file : un SEUL blob JSON, sous une seule clé de
// stockage (`fonda_evt_mesure`), écrit en un seul `setItem()`. Choix délibéré après
// critique Codex : trois clés séparées (verrou/historique/file) peuvent se désynchroniser
// si l'une des trois écritures échoue (verrou posé mais rien en file = mesure perdue
// silencieusement) — un seul document, une seule écriture, élimine structurellement ce
// risque (pas de transaction partielle possible). Les clés composites (verrou par
// `(defiId, itemId)`, historique par `(setId, itemId)`) utilisent `JSON.stringify([a,
// b])`, jamais une concaténation `a + '::' + b` : un simple "::" dans un id aurait pu
// faire collisionner deux couples distincts.
//
// Vérification PUIS écriture dans un même bloc synchrone (pas d'attente entre les
// deux) : correct pour un double-clic, un double callback ou un rechargement DANS LE
// MÊME onglet (JS y est mono-thread, rien ne peut s'intercaler). Entre deux onglets
// véritablement distincts (processus séparés), `localStorage` n'offre toujours aucune
// primitive de comparaison-et-échange atomique : une course très rare reste possible.
// Limite documentée (voir fonda/engine/README.md), pas corrigée ici — cf. l'esprit G6
// (« protection légère assumée », pas une garantie de sécurité).

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
// distinct du cas "grp bien formé mais absent du roster" (géré séparément). 4 groupes
// capturés (pas seulement le grp) : T4 (fonda/engine/liens.js) doit pouvoir RÉSOUDRE
// un defi_id (retrouver année/semaine/slug) en plus de l'émettre — une seule regex,
// source unique de vérité pour le format, jamais dupliquée ailleurs.
const DEFI_ID_PATTERN = /^defi_(\d{4})-w(\d{1,2})_([0-9]{3})_([a-z0-9-]+)$/;

// Garde-fou de NATURE (pas de format métier) sur un identifiant technique : chaîne
// non vide, bornée en longueur, sans espace ni caractère de texte libre. N'affirme
// jamais que l'id "existe" ou "a du sens" — seulement qu'il ne ressemble pas à du
// texte saisi librement (un nom, une phrase, un commentaire).
const ID_TECHNIQUE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function estIdentifiantPlausible(valeur) {
  return typeof valeur === 'string' && ID_TECHNIQUE_PATTERN.test(valeur);
}

const CLE_MESURE = 'fonda_evt_mesure';

// Décompose un defi_id en ses 4 segments, ou null si la forme ne correspond pas.
// Utilisé par T3 (extraireGrpDepuisDefiId, ci-dessous) ET par T4 (fonda/engine/liens.js,
// qui doit retrouver année/semaine/slug pour résoudre un lien élève) — un seul endroit
// qui connaît le format, jamais deux regex qui pourraient diverger.
function parserDefiId(defiId) {
  if (typeof defiId !== 'string') return null;
  const m = defiId.match(DEFI_ID_PATTERN);
  if (!m) return null;
  return { annee: m[1], semaine: m[2], grp: m[3], notionSlug: m[4] };
}

function extraireGrpDepuisDefiId(defiId) {
  const parse = parserDefiId(defiId);
  return parse ? parse.grp : null;
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

// Clé composite non ambiguë : JSON.stringify d'un tableau échappe et délimite chaque
// élément — contrairement à `a + '::' + b`, aucune valeur de a/b ne peut la faire
// collisionner avec un autre couple.
function cleComposite(a, b) {
  return JSON.stringify([a, b]);
}

function formeValide(valeur) {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur);
}

// Lecture défensive du blob unique de mesure. Distingue explicitement "absent"
// (enveloppe neuve) de "présent mais illisible ou mal formé" (→ undefined, jamais
// traité comme une table vide : un stockage corrompu ne doit jamais réautoriser
// silencieusement un vote déjà scellé ou effacer un historique réel).
function lireMesure(stockage) {
  const brut = stockage.getItem(CLE_MESURE);
  if (brut === null || brut === undefined) {
    return { verrous: {}, historique: {}, file: [] };
  }
  let data;
  try {
    data = JSON.parse(brut);
  } catch {
    return undefined;
  }
  if (!formeValide(data)) return undefined;
  if (!formeValide(data.verrous)) return undefined;
  if (!formeValide(data.historique)) return undefined;
  if (!Array.isArray(data.file)) return undefined;
  return data;
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
 * @returns {{ emis:true, event:object } | { emis:false, raison:string }}
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
  // Garde-fou de nature : aucun de ces champs ne doit ressembler à du texte libre
  // (nom, phrase, commentaire). Ne vérifie PAS leur existence réelle dans un
  // référentiel — garanti en amont par T1/T6, pas le rôle de ce module.
  if (!estIdentifiantPlausible(itemId) || !estIdentifiantPlausible(setId) || !estIdentifiantPlausible(notionId)) {
    return { emis: false, raison: 'identifiant_invalide' };
  }

  if (!stockage || typeof stockage.getItem !== 'function' || typeof stockage.setItem !== 'function') {
    return { emis: false, raison: 'stockage_indisponible' };
  }

  let mesure;
  try {
    mesure = lireMesure(stockage);
  } catch {
    return { emis: false, raison: 'stockage_indisponible' };
  }
  if (mesure === undefined) {
    return { emis: false, raison: 'stockage_corrompu' };
  }

  const cleVerrou = cleComposite(defiId, itemId);
  if (mesure.verrous[cleVerrou]) {
    return { emis: false, raison: 'deja_vote' };
  }

  const now = typeof maintenant === 'function' ? maintenant() : undefined;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    return { emis: false, raison: 'horloge_invalide' };
  }
  const ts = tronquerAHeure(now);

  const cleHistorique = cleComposite(setId, itemId);
  const passages = Array.isArray(mesure.historique[cleHistorique]) ? mesure.historique[cleHistorique] : [];

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
    // Jamais le détail (valeur fautive) à l'appelant : seulement un code générique.
    return { emis: false, raison: 'event_invalide' };
  }

  const eventScelle = Object.freeze({ ...event });

  const nouvelleMesure = {
    verrous: { ...mesure.verrous, [cleVerrou]: true },
    historique: { ...mesure.historique, [cleHistorique]: [...passages, { ts: event.ts, defi_id: defiId }] },
    file: [...mesure.file, eventScelle],
  };

  try {
    // Une seule écriture : verrou, historique et file changent d'état ensemble ou pas
    // du tout (pas de scénario où le verrou est posé sans l'événement en file).
    stockage.setItem(CLE_MESURE, JSON.stringify(nouvelleMesure));
  } catch {
    return { emis: false, raison: 'stockage_indisponible' };
  }

  return { emis: true, event: eventScelle };
}

return {
  soumettreTentative,
  extraireGrpDepuisDefiId,
  parserDefiId,
  grpEstAutorise,
  ctxEstValide,
  CLE_MESURE,
};

}); // fin UMD
