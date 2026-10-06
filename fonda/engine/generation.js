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
//   - G4 (humain dans la boucle) : `deposerEnRelecture` ne PUBLIE jamais — il
//     partitionne par `relecteur`, statut imposé par l'appelant (toujours "attente"
//     pour une candidate neuve), jamais écrit au catalogue.
//   - Routage par relecteur (§12, AGENTS.md "Conventions") : `relecteurDepuisMatiere`
//     est l'UNIQUE table matiere -> relecteur, strictement identique à celle de
//     fonda/scripts/validate.js (RELECTEUR_ATTENDU) — ne jamais dupliquer/diverger.
//     `validerCandidate` revérifie la cohérence matiere/relecteur même si l'appelant
//     a renseigné les deux champs séparément (comme pour la notion du référentiel).
//   - Dette T6 (ids) : `set_id`/`item_id` remplacent `card_id` (PRD §3.6) par une
//     paire dérivée UNIQUEMENT de (notion_id, palier, séquence) / (index) — jamais du
//     texte de la carte. Motif vérifiable par regex, pas une convention informelle.
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
 * Dépôt en file de relecture (G4/§12) — partitionne les candidates VALIDES par
 * `relecteur`. Ne publie jamais, ne touche ni le disque ni n8n : retourne une
 * structure pure que l'appelant committe/câble. Ne jette jamais ; une candidate
 * invalide est écartée dans `invalides` (raisons de diagnostic, jamais la valeur
 * fautive), jamais incluse silencieusement dans `parRelecteur`.
 * @param {object[]} candidates
 * @returns {{ parRelecteur: {justine: object[], eric: object[]}, total: number, invalides: {index:number, raisons:string[]}[] }}
 */
function deposerEnRelecture(candidates) {
  const parRelecteur = { justine: [], eric: [] };
  const invalides = [];
  (isArray(candidates) ? candidates : []).forEach((c, i) => {
    const v = validerCandidate(c);
    if (!v.valide) {
      invalides.push({ index: i, raisons: v.erreurs });
      return;
    }
    parRelecteur[c.relecteur].push(Object.freeze({ ...c }));
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
