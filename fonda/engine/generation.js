// Chaîne de génération assistée + dépôt en file de relecture (T6) — Box-FONDA.
// Référence : docs/PRD-Box-FONDA.md §3.6 (schéma candidate), §5.1 (profils de
// correction), §9 (Moteur B, proposition seulement), §11 (spec de clarté), §12
// (routage humain dans la boucle) ; AGENTS.md G3, G4, G5.
//
// Zéro dépendance : format UMD, comme fonda/engine/evenements.js — require()-able en
// Node (tests, scripts) et chargeable en <script> classique côté navigateur. Ce
// module ne génère AUCUN texte de carte : il fournit la chaîne (ids système, schéma,
// anti-clone, routage) que l'appelant (ici : fonda/scripts/generer-pilote-t6.js)
// utilise pour construire et déposer ses candidates. Le contenu pédagogique du lot
// pilote T6 est rédigé à la main (cf. AVANCEMENT.md) — l'appel API réel à un modèle
// reste une dette ouverte, pas câblée par ce module.
//
// Garde-fous (non négociables) :
//   - G4 (humain dans la boucle), IMPRENABLE au dépôt — révisé après critique Codex
//     (T6a) qui a montré que la 1ʳᵉ version du dépôt faisait CONFIANCE à la candidate
//     entrante pour `statut`/`matiere`/`relecteur`, ce qui les rendait falsifiables en
//     théorie (pas d'exploit réel faute de consommateur, mais une garantie "de
//     confiance" n'est pas une garantie) :
//       * `deposerEnRelecture` FORCE `statut: "attente"` sur CHAQUE candidate
//         déposée — toute valeur entrante (`"validée"`, `"rejetée"`, absente) est
//         ignorée et écrasée. Aucune candidate ne peut entrer pré-validée.
//       * `matiere`/`relecteur` DÉPOSÉS sont DÉRIVÉS du référentiel (`notions`,
//         fourni par l'appelant) via `notion_id` — ce que déclare la candidate pour
//         ces deux champs n'a AUCUNE influence sur le routage final ni sur le
//         contenu déposé (écrasé systématiquement). Nuance exacte (2e critique
//         Codex T6a, point #5) : ces champs déclarés sont encore vérifiés en AMONT,
//         pour la FORME générale de la candidate (cohérence interne, un contrôle de
//         schéma qui a sa valeur seul) — une candidate structurellement invalide
//         est rejetée avant même d'atteindre le référentiel. Mais une fois admise,
//         ils ne pèsent plus : le routage et le contenu déposé viennent QUE du
//         référentiel. Une candidate dont le `notion_id` n'existe pas dans
//         `notions` (absent, dupliqué, ou notion mal formée — matiere/relecteur du
//         RÉFÉRENTIEL lui-même incohérents) est rejetée (`invalides`), jamais
//         déposée avec un routage par défaut ni sur la base de la dernière entrée.
//   - Intégrité structurelle au dépôt (T6a, suite critiques Codex #12 puis #2/#3) :
//       * Gel PROFOND récursif (toute la candidate, à N'IMPORTE QUEL niveau
//         d'imbrication — pas seulement `reponses_acceptees`) : muter après coup
//         N'IMPORTE QUEL champ de l'objet D'ORIGINE passé par l'appelant ne mute
//         plus la candidate déposée (le dépôt clone intégralement avant de geler,
//         jamais la référence reçue, à aucune profondeur).
//       * Unicité `(set_id, item_id)`, cohérence `set_id` ↔ `notion_id` ↔ `palier`,
//         ET unicité `set_id` ↔ notion_id DANS UN MÊME LOT (un 2e notion_id ne peut
//         pas revendiquer un set_id déjà pris par un autre dans ce dépôt) sont
//         vérifiées AU DÉPÔT (pas seulement au schéma d'une candidate isolée).
//   - Routage par relecteur (§12, AGENTS.md "Conventions") : `relecteurDepuisMatiere`
//     est l'UNIQUE table matiere -> relecteur, strictement identique à celle de
//     fonda/scripts/validate.js (RELECTEUR_ATTENDU) — ne jamais dupliquer/diverger.
//     `validerCandidate` revérifie la cohérence matiere/relecteur DÉCLARÉS (un
//     contrôle de forme, pas de confiance — le dépôt, lui, ne fait confiance à
//     aucun des deux champs, voir ci-dessus).
//   - Dette T6 (ids) — LEVÉE : `set_id`/`item_id` remplacent `card_id` (PRD §3.6) par
//     une paire dérivée UNIQUEMENT de (notion_id, palier, séquence) / (index) —
//     jamais du texte de la carte. Motif vérifiable par regex.
//   - Anti-clone (`validerJeu`) : condition NÉCESSAIRE (étiquettes `contexte`
//     deux-à-deux distinctes dans un jeu) mais PAS SUFFISANTE — ne prouve aucune
//     diversité pédagogique réelle du contenu. La variété de fond reste jugée à la
//     relecture humaine (voir fonda/data/README.md). `contexte` est un AJOUT T6,
//     absent du schéma PRD §3.6.
//   - `validerCandidate` ne jette jamais une valeur fautive à l'appelant : seulement
//     un message d'erreur de diagnostic (même esprit que evenements.js/validate.js).

(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FondaGeneration = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// Même forme que l'id de notion (fonda/scripts/validate.js) : {matiere}.{slug}.
const NOTION_ID_PATTERN = /^(fr|maths)\.([a-z0-9-]+)$/;

// Motifs système (Dette T6) : dérivés uniquement de (notion_id, palier, séquence) ou
// d'un index — jamais du texte de la carte. Vérifiables, pas une convention informelle.
const SET_ID_PATTERN = /^set_fonda_[a-z0-9-]+_n[IF]_\d{2}$/;
const ITEM_ID_PATTERN = /^it\d{2}$/;

const PALIERS = new Set(['nI', 'nF']);
// Convention BOX existante (js/config.js, cartes ordinaires) — pas une invention T6,
// réutilisée pour rester cohérent avec le reste de l'app.
const DIFFICULTES = new Set(['facile', 'moyen', 'difficile']);
const PROFILS_CORRECTION = new Set(['sens', 'orthographe', 'numerique', 'exact']); // PRD §5.1
const STATUTS = new Set(['attente', 'validée', 'rejetée']); // PRD §3.6
const RELECTEURS = new Set(['justine', 'eric']);
// Table UNIQUE matiere -> relecteur — doit rester identique à celle de validate.js.
const RELECTEUR_ATTENDU = { 'français': 'justine', 'maths': 'eric' };

const SOURCE_PILOTE = 'T6-pilote';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function isString(v) {
  return typeof v === 'string';
}

function isNonEmptyString(v) {
  return isString(v) && v.length > 0;
}

function isArray(v) {
  return Array.isArray(v);
}

function extraireSlugNotion(notionId) {
  if (typeof notionId !== 'string') return null;
  const m = notionId.match(NOTION_ID_PATTERN);
  return m ? m[2] : null;
}

// Index notion_id -> {matiere, relecteur} depuis le référentiel RÉEL (fonda/data/
// referentiel.json, `notions`). Seule source de vérité pour le dépôt (T6a) — jamais
// la candidate elle-même. `notions` manquant/vide -> index vide -> toute candidate
// est rejetée (échoue fermé, jamais un routage par défaut).
//
// Révisé après 2e critique Codex (T6a) :
//   - un `id` DUPLIQUÉ dans `notions` n'est plus "la dernière entrée gagne" (routage
//     silencieux sur une valeur arbitraire) : il EMPOISONNE l'entrée (retirée de
//     l'index) — toute candidate référençant cet id est alors rejetée comme notion
//     inconnue, jamais routée sur une valeur ambiguë.
//   - `matiere`/`relecteur` DOIVENT être mutuellement cohérents (même table
//     RELECTEUR_ATTENDU que pour une candidate) — une entrée de référentiel mal
//     formée (`matiere:"maths"` + `relecteur:"justine"`) est elle aussi retirée de
//     l'index, jamais utilisée pour router "tel que déclaré".
function construireIndexNotions(notions) {
  const index = new Map();
  const vus = new Set();
  (isArray(notions) ? notions : []).forEach((n) => {
    if (!n || !isNonEmptyString(n.id)) return;
    if (vus.has(n.id)) {
      index.delete(n.id); // id dupliqué -> empoisonné, jamais "la dernière entrée gagne"
      return;
    }
    vus.add(n.id);
    const matiereValide = n.matiere === 'français' || n.matiere === 'maths';
    const coherent = matiereValide && RELECTEUR_ATTENDU[n.matiere] === n.relecteur;
    if (coherent) {
      index.set(n.id, { matiere: n.matiere, relecteur: n.relecteur });
    }
    // sinon : entrée mal formée, simplement absente de l'index (rejet en aval).
  });
  return index;
}

// Cohérence set_id <-> (notion_id, palier) : le slug ET le palier encodés dans
// set_id doivent correspondre à ceux de la candidate — un id de jeu d'une autre
// notion ou d'un autre palier, recopié par erreur ou forgé, est détecté ici.
// LIMITE CONNUE (signalée par la 2e critique Codex) : la comparaison porte sur le
// SLUG seul (pas le préfixe matiere.) — deux notions de matières différentes qui
// partageraient le même slug pourraient en théorie revendiquer le même set_id. Pas
// un problème avec le référentiel réel (12 slugs tous distincts, vérifié par
// validate.js : unicité des `id` complets) ; `deposerEnRelecture` ajoute en plus une
// garde AU DÉPÔT (un même set_id ne peut être revendiqué que par UN seul notion_id
// dans un même lot, voir ci-dessous) sans reformater l'id système existant (Dette
// T6, déjà committée/testée).
function setIdCoherentAvecNotion(setId, notionId, palier) {
  const slug = extraireSlugNotion(notionId);
  if (!slug || !isNonEmptyString(setId)) return false;
  const attendu = new RegExp(`^set_fonda_${slug}_${palier}_\\d{2}$`);
  return attendu.test(setId);
}

// Clone PROFOND (jamais une référence partagée avec l'appelant, à N'IMPORTE QUEL
// niveau d'imbrication — pas seulement `reponses_acceptees`, cf. 2e critique Codex
// T6a : un champ imbriqué quelconque, ex. `meta.review.ok`, échappait au clonage
// spécial précédent). S'arrête aux primitifs (chaîne, nombre, booléen, null) —
// immuables par nature, rien à cloner/geler.
function clonerProfond(valeur) {
  if (isArray(valeur)) return valeur.map(clonerProfond);
  if (valeur && typeof valeur === 'object') {
    const clone = {};
    Object.keys(valeur).forEach((k) => { clone[k] = clonerProfond(valeur[k]); });
    return clone;
  }
  return valeur;
}

// Gèle récursivement un objet/tableau DÉJÀ CLONÉ (jamais la structure reçue de
// l'appelant — gelCandidate() clone toujours avant d'appeler ceci).
function gelProfond(valeur) {
  if (isArray(valeur)) {
    valeur.forEach(gelProfond);
    return Object.freeze(valeur);
  }
  if (valeur && typeof valeur === 'object') {
    Object.keys(valeur).forEach((k) => gelProfond(valeur[k]));
    return Object.freeze(valeur);
  }
  return valeur;
}

// Gel PROFOND d'une candidate avant dépôt : clone TOUTE la structure (pas seulement
// `reponses_acceptees`) puis gèle le clone — muter après coup N'IMPORTE QUEL champ
// (y compris imbriqué) de l'objet D'ORIGINE passé par l'appelant ne peut plus muter
// la candidate déposée.
function gelCandidate(c) {
  return gelProfond(clonerProfond(c));
}

/**
 * Génère un set_id système : set_fonda_{slug}_{palier}_{séquence sur 2 chiffres}.
 * Jamais dérivé du texte de la carte — uniquement de (notion_id, palier, séquence).
 * @returns {string|null} null si une entrée est invalide (jamais d'exception).
 */
function genererSetId(notionId, palier, sequence) {
  const slug = extraireSlugNotion(notionId);
  if (!slug) return null;
  if (!PALIERS.has(palier)) return null;
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 99) return null;
  const id = `set_fonda_${slug}_${palier}_${String(sequence).padStart(2, '0')}`;
  return SET_ID_PATTERN.test(id) ? id : null;
}

/**
 * Génère un item_id système : it{index sur 2 chiffres}. Jamais dérivé du texte.
 * @returns {string|null} null si index invalide (jamais d'exception).
 */
function genererItemId(index) {
  if (!Number.isInteger(index) || index < 1 || index > 99) return null;
  const id = 'it' + String(index).padStart(2, '0');
  return ITEM_ID_PATTERN.test(id) ? id : null;
}

/**
 * Unique table de routage matiere -> relecteur (G4/§12). Même table que
 * fonda/scripts/validate.js (RELECTEUR_ATTENDU) — ne jamais diverger.
 * @returns {string|null} "justine" | "eric" | null si matiere inconnue.
 */
function relecteurDepuisMatiere(matiere) {
  return RELECTEUR_ATTENDU[matiere] || null;
}

// Schéma candidate — PRD §3.6 + §5.1, avec deux adaptations T6 documentées ci-dessus :
// (1) card_id -> paire (set_id, item_id) système ; (2) ajout de `contexte` (anti-clone,
// nécessaire pas suffisant). Champs laissés souples à dessein : AUCUN — ce schéma est
// neuf (pas un contrat existant à assouplir), toutes les clés utiles sont requises.
function validateCandidateFields(c, { notionIdsConnus } = {}) {
  assert(c && typeof c === 'object' && !Array.isArray(c), 'une candidate doit être un objet');

  assert(isNonEmptyString(c.notion_id), 'notion_id manquant ou vide');
  if (notionIdsConnus) {
    const ids = notionIdsConnus instanceof Set ? notionIdsConnus : new Set(notionIdsConnus);
    assert(ids.has(c.notion_id), `notion_id "${c.notion_id}" absent du référentiel`);
  }

  assert(c.matiere === 'français' || c.matiere === 'maths', `matiere "${c.matiere}" invalide (attendu: français | maths)`);
  assert(RELECTEURS.has(c.relecteur), `relecteur "${c.relecteur}" invalide (attendu: justine | eric)`);
  assert(
    RELECTEUR_ATTENDU[c.matiere] === c.relecteur,
    `relecteur "${c.relecteur}" incohérent avec matiere "${c.matiere}" (attendu: ${RELECTEUR_ATTENDU[c.matiere]}) — protège le routage G4`,
  );

  assert(PALIERS.has(c.palier), 'palier invalide (attendu: nI | nF)');
  assert(DIFFICULTES.has(c.difficulte), `difficulte "${c.difficulte}" invalide (attendu: facile | moyen | difficile)`);

  assert(isNonEmptyString(c.question), 'question manquante ou vide');
  assert(isNonEmptyString(c.reponse), 'reponse manquante ou vide');

  assert(PROFILS_CORRECTION.has(c.profil_correction), `profil_correction "${c.profil_correction}" invalide`);
  assert(
    isArray(c.reponses_acceptees) && c.reponses_acceptees.length > 0 && c.reponses_acceptees.every(isNonEmptyString),
    'reponses_acceptees doit être un tableau non vide de chaînes',
  );

  assert(typeof c.seconde_chance === 'boolean', 'seconde_chance doit être un booléen');

  assert(STATUTS.has(c.statut), 'statut invalide (attendu: attente | validée | rejetée)');
  assert(isNonEmptyString(c.source), 'source manquante ou vide');

  assert(isNonEmptyString(c.ts) && !Number.isNaN(Date.parse(c.ts)), 'ts manquant ou non parsable en date');

  // Dette T6 (ids système) : motif vérifiable, jamais une valeur dérivée du texte.
  assert(isNonEmptyString(c.set_id) && SET_ID_PATTERN.test(c.set_id), `set_id "${c.set_id}" ne respecte pas le motif système`);
  assert(isNonEmptyString(c.item_id) && ITEM_ID_PATTERN.test(c.item_id), `item_id "${c.item_id}" ne respecte pas le motif système`);

  // Ajout T6 (absent du PRD §3.6) : condition nécessaire de l'anti-clone, voir validerJeu().
  assert(isNonEmptyString(c.contexte), 'contexte manquant ou vide');
}

/**
 * Valide UNE candidate isolée, sans effet de bord.
 * @param {object} candidate
 * @param {{notionIdsConnus?: Set<string>|string[]}} [options]
 * @returns {{ valide: true } | { valide: false, erreurs: string[] }}
 */
function validerCandidate(candidate, options) {
  try {
    validateCandidateFields(candidate || {}, options || {});
    return { valide: true };
  } catch (err) {
    return { valide: false, erreurs: [err.message] };
  }
}

/**
 * Anti-clone : vérifie que les `contexte` d'un jeu de cartes sont deux-à-deux
 * distincts. Condition NÉCESSAIRE, PAS SUFFISANTE — ne lit ni `question` ni
 * `enonce_modele` : deux questions presque identiques avec des contextes distincts
 * passent ce contrôle. La diversité pédagogique réelle reste jugée à la relecture
 * humaine (voir fonda/data/README.md).
 * @returns {{ valide: true } | { valide: false, erreurs: string[] }}
 */
function validerJeu(cartes) {
  try {
    assert(isArray(cartes) && cartes.length > 0, 'un jeu doit être un tableau non vide de candidates');
    const contextes = new Set();
    cartes.forEach((c, i) => {
      assert(c && isNonEmptyString(c.contexte), `cartes[${i}] : contexte manquant ou vide`);
      assert(!contextes.has(c.contexte), `cartes[${i}] : contexte "${c.contexte}" dupliqué dans le jeu (anti-clone)`);
      contextes.add(c.contexte);
    });
    return { valide: true };
  } catch (err) {
    return { valide: false, erreurs: [err.message] };
  }
}

/**
 * Dépôt en file de relecture (G4/§12), IMPRENABLE (T6a) — partitionne les
 * candidates VALIDES par `relecteur`. Ne publie JAMAIS, ne touche ni le disque ni
 * n8n : retourne une structure pure que l'appelant committe/câble.
 *
 * Protections appliquées AU DÉPÔT (pas seulement au schéma d'une candidate
 * isolée) — aucune ne fait confiance à la candidate entrante :
 *   1. `statut` est FORCÉ à `"attente"` pour toute candidate déposée — toute
 *      valeur entrante est écrasée.
 *   2. `matiere`/`relecteur` sont DÉRIVÉS de `notions` (référentiel réel) via
 *      `notion_id` — jamais lus depuis la candidate. `notion_id` absent de
 *      `notions` -> rejet.
 *   3. `set_id` doit cohérer avec `(notion_id, palier)` -> sinon rejet.
 *   4. `(set_id, item_id)` doit être unique dans le lot déposé -> le doublon
 *      (pas le premier) est rejeté.
 * Ne jette jamais ; une candidate invalide/rejetée est écartée dans `invalides`
 * (raisons de diagnostic, jamais la valeur fautive), jamais incluse
 * silencieusement dans `parRelecteur`.
 *
 * @param {object[]} candidates
 * @param {{notions: object[]}} options - `notions` = `referentiel.json.notions` (ou équivalent) ; omis/vide -> tout est rejeté.
 * @returns {{ parRelecteur: {justine: object[], eric: object[]}, total: number, invalides: {index:number, raisons:string[]}[] }}
 */
function deposerEnRelecture(candidates, options) {
  const { notions } = options || {};
  const indexNotions = construireIndexNotions(notions);
  const parRelecteur = { justine: [], eric: [] };
  const invalides = [];
  const dejaDeposes = new Set();
  // set_id -> notion_id déjà admis sous cet id, DANS CE LOT (3e critique Codex T6a,
  // point #3) : la cohérence set_id<->notion/palier ne compare que le slug, pas le
  // préfixe matiere. — deux notion_id distincts pourraient en théorie partager un
  // même set_id si leurs slugs coïncident. Cette garde empêche qu'un 2e notion_id
  // revendique un set_id déjà pris par un autre dans le même dépôt (le 2e est
  // rejeté, le 1er reste déposé — même politique que le doublon (set_id,item_id)).
  const setIdVuPourNotion = new Map();

  (isArray(candidates) ? candidates : []).forEach((brut, i) => {
    // Aller-retour JSON AVANT toute lecture de champ (4e critique Codex T6a, point
    // #4) : un objet forgé avec un getter/toJSON pourrait, par simple relecture
    // d'un champ (le spread `{...c}` du dépôt relit TOUT après coup), répondre une
    // valeur DIFFÉRENTE de celle vue par `validerCandidate` — deux chemins
    // confirmés par la critique (notion/id changés après coup, statut sérialisé
    // différent de celui gelé en mémoire). Un round-trip JSON, fait UNE SEULE FOIS
    // ici, fige une snapshot plate — chaque champ n'est plus lu qu'une fois, la
    // même valeur sert à la validation ET au dépôt, aucune divergence possible.
    // Risque théorique (nécessite un objet JS avec du code, pas un JSON.parse
    // ordinaire) — le script pilote ne construit que des objets simples.
    let c;
    try {
      c = JSON.parse(JSON.stringify(brut));
    } catch {
      invalides.push({ index: i, raisons: ['candidate non sérialisable en JSON'] });
      return;
    }

    const forme = validerCandidate(c);
    if (!forme.valide) {
      invalides.push({ index: i, raisons: forme.erreurs });
      return;
    }

    // Référentiel = SEULE source de vérité pour matiere/relecteur (jamais la
    // candidate) : `indexNotions` ne contient déjà plus aucune entrée malformée
    // (relecteur incohérent, matiere invalide) ni aucun id dupliqué empoisonné
    // (voir construireIndexNotions) — `!ref` couvre donc les trois cas d'un coup.
    const ref = indexNotions.get(c.notion_id);
    if (!ref) {
      invalides.push({ index: i, raisons: [`notion_id "${c.notion_id}" absent du référentiel fourni, ou notion mal formée/dupliquée`] });
      return;
    }

    if (!setIdCoherentAvecNotion(c.set_id, c.notion_id, c.palier)) {
      invalides.push({ index: i, raisons: ['set_id incohérent avec notion_id/palier'] });
      return;
    }

    const notionDejaLieeASetId = setIdVuPourNotion.get(c.set_id);
    if (notionDejaLieeASetId !== undefined && notionDejaLieeASetId !== c.notion_id) {
      invalides.push({ index: i, raisons: [`set_id "${c.set_id}" déjà revendiqué par la notion "${notionDejaLieeASetId}" dans ce lot`] });
      return;
    }
    setIdVuPourNotion.set(c.set_id, c.notion_id);

    const cleUnicite = JSON.stringify([c.set_id, c.item_id]);
    if (dejaDeposes.has(cleUnicite)) {
      invalides.push({ index: i, raisons: [`(set_id, item_id) déjà déposé dans ce lot`] });
      return;
    }
    dejaDeposes.add(cleUnicite);

    const depose = gelCandidate({
      ...c,
      matiere: ref.matiere,
      relecteur: ref.relecteur,
      statut: 'attente',
    });
    parRelecteur[ref.relecteur].push(depose);
  });

  return {
    parRelecteur,
    total: parRelecteur.justine.length + parRelecteur.eric.length,
    invalides,
  };
}

return {
  genererSetId,
  genererItemId,
  relecteurDepuisMatiere,
  validerCandidate,
  validerJeu,
  deposerEnRelecture,
  SET_ID_PATTERN,
  ITEM_ID_PATTERN,
  DIFFICULTES,
  PROFILS_CORRECTION,
  STATUTS,
  SOURCE_PILOTE,
};

}); // fin UMD
