// Contrats du catalogue FONDA publié (chaîne séparée de BOX, décision Éric 2026-10-13).
// Référence : docs/PRD-Box-FONDA.md §2 bis ; AGENTS.md (Conventions).
//
// Trois contrats, une seule implémentation partagée par le front (bootstrap.js), le
// script de publication (fonda/scripts/publier-lot.js) et le test CI de la chaîne :
//   - catalogue-fonda/v1 : fonda/data/catalogue-fonda.json (lots PUBLIÉS) ;
//   - lot-fonda/v1       : fonda/data/lots/<set_id>.json (liste BLANCHE de champs) ;
//   - empreinte-fonda/v1 : SHA-256 du contenu pédagogique (ce que l'élève voit +
//     ce qui détermine sa note).
//
// Logique PURE : aucun fetch, aucun DOM. Le calcul SHA-256 est INJECTÉ (`sha256Hex`,
// async) : Web Crypto (crypto.subtle) dans le navigateur et en Node.
// Format UMD, comme correction.js : require()-able en Node, window.FondaCatalogue en
// navigateur.

(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FondaCatalogue = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const SCHEMA_CATALOGUE = 'catalogue-fonda/v1';
const SCHEMA_LOT = 'lot-fonda/v1';
const SCHEMA_EMPREINTE = 'empreinte-fonda/v1';

// Motif système existant (fonda/engine/generation.js) : set_fonda_{slug}_{palier}_{NN}.
const SET_ID_PATTERN = /^set_fonda_[a-z0-9-]+_n[IF]_\d{2}$/;
const ITEM_ID_PATTERN = /^it\d{2}$/;
const EMPREINTE_PATTERN = /^sha256:[0-9a-f]{64}$/;
const PALIERS = ['nI', 'nF'];
const TYPES_ATTESTATION = ['manuelle-historique', 'cloture-signee'];

// Listes BLANCHES (contrat lot-fonda/v1) : tout autre champ est refusé, notamment
// id (box_…), prof_email, prof_nom, code_suppression, review_key, review_token.
const CHAMPS_LOT = Object.freeze([
  'schema', 'set_id', 'notion_id', 'palier', 'matiere', 'notion', 'niveau',
  'revue_carte_par_carte', 'nb_cartes', 'date_creation', 'cartes',
]);
const CHAMPS_CARTE = Object.freeze([
  'item_id', 'numero', 'question', 'reponse', 'difficulte', 'palier',
  'profil_correction', 'reponses_acceptees', 'unite', 'arrondi', 'seconde_chance',
  'contexte', 'set_id', 'notion_id',
]);
// Ancrage G4 des 8 lots « manuelle-historique » (critique Codex R4, 2026-10-13) : ces
// lots n'ont pas d'attestation signée, rien d'autre n'ancre leur contenu d'origine.
// Couples set_id -> empreinte FIGÉS à la migration du 2026-10-13 (contenu relu par Éric
// le 2026-10-11 + modification déclarée du 2026-10-12). Toute autre empreinte, ou tout
// autre set_id, est refusé pour ce type : modifier un lot historique impose un nouveau
// set_id et une clôture signée. NE JAMAIS modifier cette table pour « faire passer » un
// lot : c'est précisément ce qu'elle interdit.
const HISTORIQUES_FIGES = Object.freeze({
  'set_fonda_comprendre-consigne_nI_01': 'sha256:3e715f0e44d520de9ee7f01c218cf667551b8a7fff650c357b1f2bb88561e25d',
  'set_fonda_comprendre-consigne_nF_01': 'sha256:936b66da0abaa10b823c05bb13e6649754a9f4ba654986cc296c5cc8f087f6f1',
  'set_fonda_inference-implicite_nI_01': 'sha256:f5d0faddffd8cb28c88b0ddb0b04cde8d9747f0fc72a44b9608beb1fdb4e2e0d',
  'set_fonda_inference-implicite_nF_01': 'sha256:75872849d37d3610cd556f0dfa2e952bf2e425bbb2ab5832b3aedd71d1d4b29b',
  'set_fonda_grandeurs-mesures_nI_01': 'sha256:ac405cf81afba028839eee3aa28bbf3151c6244479c0ddd6d690511c7629f588',
  'set_fonda_grandeurs-mesures_nF_01': 'sha256:efacb0c7953389c1cfdad3044c2767240a54b31f014f0371fc94d3a6db494d98',
  'set_fonda_resolution-problemes_nI_01': 'sha256:184b53a0b80d7931ec19a8ee278f4a7092347ff5f1c7fbc262eef0e986383c10',
  'set_fonda_resolution-problemes_nF_01': 'sha256:53071653f943c8ce20a5a2f0a1da65eb73782a9c71b9db4517b7bf922f42d248',
});

const CHAMPS_ENTREE = Object.freeze([
  'set_id', 'notion_id', 'palier', 'fichier', 'item_ids', 'empreinte', 'moteur', 'relecteur', 'attestation',
]);

// Moteur de correction élève du lot (CDC relecture §4.3) : { version, sha256 } figé
// comme l'empreinte. sha256 = SHA-256 hex des octets de fonda/engine/moteur-correction-
// <version>.js, identique à sa ligne de fonda/engine/moteurs.json (vérifié par la CI ;
// le front refuse toute discordance avant chargement, puis charge avec SRI).
const VERSION_MOTEUR_PATTERN = /^v[1-9][0-9]*$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
// Migration M1 (CDC §4.3, annexe B règle 0) : les 8 lots historiques sont liés au
// moteur v1, consolidation à comportement identique du correcteur sous lequel ils
// ont été relus. Fait partie de leur tuple figé, comme HISTORIQUES_FIGES.
const MOTEUR_HISTORIQUE = Object.freeze({ version: 'v1', sha256: 'ce14c3e497949913a37fd8daf6c57d2f0a96306e08f064bf9231600572ad1753' });

// Badge élève (CDC §12) : même schéma { forme, nom_affiche, id } pour toute entrée ;
// texte construit par le composant à partir de `forme`. Lots historiques : exception
// figée « relue_par » (libellé seulement). CDC r9 (intérim) : « relue_par_secours » =
// { forme, nom_affiche, id, titulaire: { id, nom_affiche } } — le relecteur de secours a
// relu, le titulaire est nommé « en attendant » (jamais présenté comme relecteur) ;
// réservée aux charges attestation-cloture/v3, et seule forme qui porte `titulaire`.
const FORMES_BADGE = Object.freeze(['relue_et_validee', 'relue_par', 'relue_par_secours']);
const FORME_SECOURS = 'relue_par_secours';
const FORMES_PAR_SCHEMA = Object.freeze({
  'attestation-cloture/v1': Object.freeze(['relue_et_validee', 'relue_par']),
  'attestation-cloture/v2': Object.freeze(['relue_et_validee', 'relue_par']),
  'attestation-cloture/v3': Object.freeze([FORME_SECOURS]),
});
const aTitulaire = (x) => Object.prototype.hasOwnProperty.call(x, 'titulaire');
const BADGE_HISTORIQUE = Object.freeze({ forme: 'relue_par', nom_affiche: 'Éric Duchateau', id: 'eric' });

const estTexte = (v) => typeof v === 'string' && v.trim() !== '';
const champsEnTrop = (obj, autorises) => Object.keys(obj).filter((k) => !autorises.includes(k));

// Slug encodé dans set_id = partie après le préfixe de matière du notion_id
// (fr.comprendre-consigne -> comprendre-consigne), même règle que generation.js.
function slugDeNotion(notionId) {
  const i = typeof notionId === 'string' ? notionId.indexOf('.') : -1;
  return i > 0 ? notionId.slice(i + 1) : null;
}

function decomposerSetId(setId) {
  if (typeof setId !== 'string' || !SET_ID_PATTERN.test(setId)) return null;
  const m = setId.match(/^set_fonda_([a-z0-9-]+)_(n[IF])_(\d{2})$/);
  return { slug: m[1], palier: m[2], sequence: Number(m[3]) };
}

// ---------------------------------------------------------------------------
// Empreinte (empreinte-fonda/v1). Couvre tout ce que l'élève voit et tout ce qui
// détermine sa note, dans l'ordre d'affichage (ordre du fichier). EXCLUS, faute
// d'être affichés ou notés : difficulte, numero, contexte (métadonnée de génération
// anti-clone, jamais transmise au composant carte — vérifié le 2026-10-13 :
// adapterCarte ne la passe pas, carte-reponse-produite.js ne la lit pas), et les
// libellés (matiere/notion/niveau, issus du référentiel). Aucune normalisation de
// texte : un seul caractère modifié change l'empreinte.
// ---------------------------------------------------------------------------
function texteEmpreinte(lot) {
  return JSON.stringify({
    schema: SCHEMA_EMPREINTE,
    set_id: lot.set_id,
    notion_id: lot.notion_id,
    palier: lot.palier,
    cartes: lot.cartes.map((c) => ({
      item_id: c.item_id,
      question: c.question,
      reponse: c.reponse,
      profil_correction: c.profil_correction,
      reponses_acceptees: c.reponses_acceptees,
      unite: c.unite ?? null,
      arrondi: c.arrondi ?? null,
      seconde_chance: c.seconde_chance ?? false,
    })),
  });
}

async function calculerEmpreinte(lot, sha256Hex) {
  return 'sha256:' + (await sha256Hex(texteEmpreinte(lot)));
}

// SHA-256 via Web Crypto (navigateur en HTTPS/localhost, Node >= 19). null si absent.
function sha256WebCrypto() {
  const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
  if (!c || !c.subtle || typeof TextEncoder === 'undefined') return null;
  return async (texte) => {
    const buf = await c.subtle.digest('SHA-256', new TextEncoder().encode(texte));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  };
}

// ---------------------------------------------------------------------------
// lot-fonda/v1 : forme + liste blanche (racine ET cartes).
// ---------------------------------------------------------------------------
function validerLot(lot) {
  const erreurs = [];
  if (!lot || typeof lot !== 'object' || Array.isArray(lot)) return { valide: false, erreurs: ['lot absent ou non objet'] };
  const tropRacine = champsEnTrop(lot, CHAMPS_LOT);
  if (tropRacine.length) erreurs.push(`champs non autorisés à la racine : ${tropRacine.join(', ')}`);
  if (lot.schema !== SCHEMA_LOT) erreurs.push(`schema attendu "${SCHEMA_LOT}"`);
  if (!SET_ID_PATTERN.test(lot.set_id || '')) erreurs.push('set_id invalide');
  if (!PALIERS.includes(lot.palier)) erreurs.push('palier invalide');
  if (!estTexte(lot.notion_id)) erreurs.push('notion_id manquant');
  if (lot.revue_carte_par_carte !== true && lot.revue_carte_par_carte !== false) erreurs.push('revue_carte_par_carte doit être un booléen');
  if (!Array.isArray(lot.cartes) || lot.cartes.length === 0) {
    erreurs.push('cartes absentes ou vides');
    return { valide: false, erreurs };
  }
  if (lot.nb_cartes !== lot.cartes.length) erreurs.push('nb_cartes incohérent');
  const vus = new Set();
  lot.cartes.forEach((c, i) => {
    const p = `carte ${i + 1}`;
    if (!c || typeof c !== 'object' || Array.isArray(c)) { erreurs.push(`${p} : non objet`); return; }
    const trop = champsEnTrop(c, CHAMPS_CARTE);
    if (trop.length) erreurs.push(`${p} : champs non autorisés : ${trop.join(', ')}`);
    if (!ITEM_ID_PATTERN.test(c.item_id || '')) erreurs.push(`${p} : item_id invalide`);
    else if (vus.has(c.item_id)) erreurs.push(`${p} : item_id en double (${c.item_id})`);
    vus.add(c.item_id);
    if (c.set_id !== lot.set_id) erreurs.push(`${p} : set_id ≠ celui du lot`);
    if (c.notion_id !== lot.notion_id) erreurs.push(`${p} : notion_id ≠ celui du lot`);
    if (c.palier !== lot.palier) erreurs.push(`${p} : palier ≠ celui du lot`);
    if (!estTexte(c.question)) erreurs.push(`${p} : question vide`);
    // Profils admis et bornes d'arrondi = règles PÉDAGOGIQUES du moteur du lot
    // (CDC §4.2 : moteur.valider) ; ici seulement la forme des champs.
    if (!estTexte(c.profil_correction)) erreurs.push(`${p} : profil_correction non texte`);
    if (!Array.isArray(c.reponses_acceptees) || c.reponses_acceptees.length === 0
      || !c.reponses_acceptees.every((r) => estTexte(r) || (typeof r === 'number' && Number.isFinite(r)))) {
      erreurs.push(`${p} : reponses_acceptees invalides`);
    }
    if (c.unite != null && typeof c.unite !== 'string') erreurs.push(`${p} : unite non texte`);
    if (c.arrondi != null && typeof c.arrondi !== 'number') erreurs.push(`${p} : arrondi non nombre`);
    if (c.seconde_chance != null && typeof c.seconde_chance !== 'boolean') erreurs.push(`${p} : seconde_chance non booléen`);
  });
  return { valide: erreurs.length === 0, erreurs };
}

// ---------------------------------------------------------------------------
// Attestation (forme). Deux types distincts, jamais confondus :
//  - manuelle-historique : UNIQUEMENT les 8 lots du lot de validation du 11/10,
//    attestation déclarative d'Éric (pas une preuve technique) ;
//  - cloture-signee (Type 2, CDC §11) : enveloppe { type, charge, signature } ; ici,
//    seulement la FORME et la cohérence charge <-> entrée (pas de cryptographie : ce
//    fichier est aussi chargé par le front). La SIGNATURE et les invariants de valeur
//    sont vérifiés en Node (fonda/scripts/attestation-signee.js : publication et CI).
// ---------------------------------------------------------------------------
function validerAttestation(att, entree) {
  const erreurs = [];
  if (!att || typeof att !== 'object') return ['attestation absente'];
  if (!TYPES_ATTESTATION.includes(att.type)) return [`type d'attestation inconnu : ${att.type}`];
  if (att.type === 'cloture-signee') {
    const ch = att.charge;
    if (Object.keys(att).sort().join() !== 'charge,signature,type' || !ch || typeof ch !== 'object' || !estTexte(att.signature)) {
      return ['cloture-signee : enveloppe { type, charge, signature } attendue'];
    }
    const meme = (a, b) => JSON.stringify(a) === JSON.stringify(b); // tableaux ordonnés
    const memeMoteur = (a, b) => !!a && !!b && a.version === b.version && a.sha256 === b.sha256;
    const memeTitulaire = (a, b) => (!aTitulaire(a) && !aTitulaire(b))
      || (aTitulaire(a) && aTitulaire(b) && !!a.titulaire && !!b.titulaire && a.titulaire.id === b.titulaire.id && a.titulaire.nom_affiche === b.titulaire.nom_affiche);
    const memeBadge = (a, b) => !!a && !!b && a.forme === b.forme && a.nom_affiche === b.nom_affiche && a.id === b.id && memeTitulaire(a, b);
    // Cohérence version de charge <-> forme du badge <-> titulaire (sans cryptographie) :
    // v1/v2 -> badge sans titulaire, jamais de secours ; v3 -> badge de secours AVEC titulaire.
    const formes = Object.prototype.hasOwnProperty.call(FORMES_PAR_SCHEMA, ch.schema) ? FORMES_PAR_SCHEMA[ch.schema] : null;
    if (!formes) erreurs.push(`cloture-signee : version de charge inconnue (${ch.schema})`);
    else if (!ch.badge || typeof ch.badge !== 'object' || !formes.includes(ch.badge.forme) || aTitulaire(ch.badge) !== (ch.schema === 'attestation-cloture/v3')) {
      erreurs.push(`cloture-signee : badge incompatible avec ${ch.schema} (forme ${ch.badge && ch.badge.forme}${ch.badge && aTitulaire(ch.badge) ? ', titulaire' : ''})`);
    }
    if (ch.set_id !== entree.set_id || ch.notion_id !== entree.notion_id || ch.palier !== entree.palier) erreurs.push('cloture-signee : identité de la charge ≠ entrée');
    if (!ch.coeur || ch.coeur.empreinte_publiee !== entree.empreinte) erreurs.push('cloture-signee : coeur.empreinte_publiee ≠ empreinte de l\'entrée');
    if (!ch.coeur || !meme(ch.coeur.selection, entree.item_ids)) erreurs.push('cloture-signee : coeur.selection ≠ item_ids de l\'entrée');
    if (!memeMoteur(ch.moteur, entree.moteur) || !ch.coeur || !memeMoteur(ch.coeur.moteur, entree.moteur)) erreurs.push('cloture-signee : moteur de la charge ≠ moteur de l\'entrée');
    if (!memeBadge(ch.badge, entree.relecteur)) erreurs.push('cloture-signee : badge ≠ relecteur de l\'entrée');
    return erreurs;
  }
  if (att.empreinte_attestee !== entree.empreinte) erreurs.push('empreinte_attestee ≠ empreinte de l\'entrée');
  if (att.type === 'manuelle-historique') {
    if (!Object.prototype.hasOwnProperty.call(HISTORIQUES_FIGES, entree.set_id)) {
      erreurs.push('manuelle-historique réservée aux 8 lots figés de la migration du 2026-10-13');
    } else if (entree.empreinte !== HISTORIQUES_FIGES[entree.set_id]) {
      erreurs.push('contenu d\'un lot historique modifié : empreinte ≠ empreinte figée (nouveau set_id + clôture signée requis)');
    }
    const r = att.relecture_declaree;
    if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.date || '') || !estTexte(r.relu_par) || !estTexte(r.relecteur_attribue)) {
      erreurs.push('relecture_declaree incomplète (date, relu_par, relecteur_attribue)');
    }
    if (!estTexte(att.atteste_par)) erreurs.push('atteste_par manquant');
    if (!estTexte(att.provenance)) erreurs.push('provenance manquante');
    if (!Array.isArray(att.selection) || JSON.stringify(att.selection) !== JSON.stringify(entree.item_ids)) {
      erreurs.push('selection ≠ item_ids de l\'entrée');
    }
  } else {
    if (!Array.isArray(att.selection) || JSON.stringify(att.selection) !== JSON.stringify(entree.item_ids)) {
      erreurs.push('selection ≠ item_ids de l\'entrée');
    }
  }
  return erreurs;
}

// ---------------------------------------------------------------------------
// catalogue-fonda/v1 : structure + règles transversales (hors contenu des fichiers).
// referentiel facultatif ici (front) ; exigé par le test CI et publier-lot.js.
// ---------------------------------------------------------------------------
function validerCatalogue(catalogue, referentiel) {
  const erreurs = [];
  if (!catalogue || catalogue.schema !== SCHEMA_CATALOGUE || !Array.isArray(catalogue.lots)) {
    return { valide: false, erreurs: [`catalogue absent ou schema ≠ "${SCHEMA_CATALOGUE}"`] };
  }
  const notions = referentiel && Array.isArray(referentiel.notions)
    ? new Map(referentiel.notions.filter(Boolean).map((n) => [n.id, n])) : null;
  const vus = new Set();
  catalogue.lots.forEach((e, i) => {
    const p = `entrée ${i + 1}${e && e.set_id ? ` (${e.set_id})` : ''}`;
    if (!e || typeof e !== 'object') { erreurs.push(`${p} : non objet`); return; }
    const trop = champsEnTrop(e, CHAMPS_ENTREE);
    if (trop.length) erreurs.push(`${p} : champs non autorisés : ${trop.join(', ')}`);
    const d = decomposerSetId(e.set_id);
    if (!d) { erreurs.push(`${p} : set_id invalide`); return; }
    if (vus.has(e.set_id)) erreurs.push(`${p} : set_id en double`);
    vus.add(e.set_id);
    if (e.palier !== d.palier) erreurs.push(`${p} : palier ≠ celui encodé dans set_id`);
    if (slugDeNotion(e.notion_id) !== d.slug) erreurs.push(`${p} : notion_id ≠ slug encodé dans set_id`);
    if (e.fichier !== `lots/${e.set_id}.json`) erreurs.push(`${p} : fichier doit valoir exactement lots/${e.set_id}.json`);
    if (!Array.isArray(e.item_ids) || e.item_ids.length === 0 || !e.item_ids.every((x) => ITEM_ID_PATTERN.test(x))
      || new Set(e.item_ids).size !== e.item_ids.length) erreurs.push(`${p} : item_ids invalides`);
    if (!EMPREINTE_PATTERN.test(e.empreinte || '')) erreurs.push(`${p} : empreinte invalide`);
    const m = e.moteur;
    if (!m || typeof m !== 'object' || champsEnTrop(m, ['version', 'sha256']).length
      || !VERSION_MOTEUR_PATTERN.test(m.version || '') || !SHA256_HEX_PATTERN.test(m.sha256 || '')) {
      erreurs.push(`${p} : moteur invalide (attendu { version: "v<N>", sha256: <64 hex> })`);
    }
    const r = e.relecteur;
    const secours = !!r && typeof r === 'object' && r.forme === FORME_SECOURS;
    if (!r || typeof r !== 'object' || champsEnTrop(r, secours ? ['forme', 'nom_affiche', 'id', 'titulaire'] : ['forme', 'nom_affiche', 'id']).length
      || !FORMES_BADGE.includes(r.forme) || !estTexte(r.nom_affiche) || !(r.id === null || estTexte(r.id))) {
      erreurs.push(`${p} : relecteur invalide (attendu { forme, nom_affiche, id })`);
    } else if (secours) {
      // Badge de secours : id et titulaire { id, nom_affiche } obligatoires, titulaire ≠ secours.
      const t = r.titulaire;
      if (!estTexte(r.id) || !aTitulaire(r) || !t || typeof t !== 'object' || Array.isArray(t) || Object.keys(t).sort().join() !== 'id,nom_affiche'
        || !estTexte(t.id) || !estTexte(t.nom_affiche) || t.id === r.id) {
        erreurs.push(`${p} : relecteur de secours invalide (attendu { forme, nom_affiche, id, titulaire: { id, nom_affiche } }, titulaire ≠ secours)`);
      }
    }
    if (e.attestation && e.attestation.type === 'manuelle-historique') {
      if (!m || m.version !== MOTEUR_HISTORIQUE.version || m.sha256 !== MOTEUR_HISTORIQUE.sha256) {
        erreurs.push(`${p} : lot historique lié à un autre moteur que v1 figé (M1)`);
      }
      if (!r || r.forme !== BADGE_HISTORIQUE.forme || r.nom_affiche !== BADGE_HISTORIQUE.nom_affiche || r.id !== BADGE_HISTORIQUE.id) erreurs.push(`${p} : badge d'un lot historique ≠ badge figé (M1)`);
    }
    validerAttestation(e.attestation, e).forEach((m) => erreurs.push(`${p} : ${m}`));
    if (notions) {
      const n = notions.get(e.notion_id);
      if (!n) erreurs.push(`${p} : notion_id absent du référentiel`);
      else if (!n.paliers || !n.paliers.includes(e.palier)) erreurs.push(`${p} : palier non prévu par le référentiel`);
      // Le relecteur ATTRIBUÉ vient du référentiel (jamais du libellé de matière).
      if (n && e.attestation && e.attestation.relecture_declaree
        && e.attestation.relecture_declaree.relecteur_attribue !== n.relecteur) {
        erreurs.push(`${p} : relecteur_attribue ≠ relecteur du référentiel (${n.relecteur})`);
      }
      // Clôture signée (Type 2) : le relecteur attribué est vérifié contre le référentiel
      // ARCHIVÉ de la charge (referentiel_version, CDC v8.3 §20.12), par
      // attestation-signee.js à la publication et en CI — JAMAIS contre le référentiel
      // courant ici : une réattribution ultérieure n'invalide pas une attestation passée.
    }
  });
  return { valide: erreurs.length === 0, erreurs };
}

// Cohérence fichier <-> entrée (identité + empreinte). Async (SHA-256).
async function verifierLotContreEntree(lot, entree, sha256Hex) {
  const erreurs = [...validerLot(lot).erreurs];
  if (lot && lot.revue_carte_par_carte !== true) erreurs.push('revue_carte_par_carte ≠ true');
  if (lot && lot.set_id !== entree.set_id) erreurs.push('set_id du fichier ≠ entrée');
  if (lot && lot.notion_id !== entree.notion_id) erreurs.push('notion_id du fichier ≠ entrée');
  if (lot && lot.palier !== entree.palier) erreurs.push('palier du fichier ≠ entrée');
  if (lot && Array.isArray(lot.cartes) && JSON.stringify(lot.cartes.map((c) => c && c.item_id)) !== JSON.stringify(entree.item_ids)) {
    erreurs.push('item_ids du fichier ≠ entrée');
  }
  if (erreurs.length === 0) {
    const e = await calculerEmpreinte(lot, sha256Hex);
    if (e !== entree.empreinte) erreurs.push('empreinte du fichier ≠ empreinte du catalogue (contenu modifié après attestation)');
  }
  return { valide: erreurs.length === 0, erreurs };
}

// Résolution d'un lien : par set_id, ou (compat anciens liens notion/palier) le lot
// publié de séquence la plus haute pour ce couple. Jamais de chemin libre.
function trouverEntree(catalogue, { setId, notionId, palier } = {}) {
  const lots = (catalogue && Array.isArray(catalogue.lots)) ? catalogue.lots : [];
  if (setId) return lots.find((e) => e.set_id === setId) || null;
  if (notionId && palier) {
    const candidats = lots.filter((e) => e.notion_id === notionId && e.palier === palier);
    candidats.sort((a, b) => decomposerSetId(b.set_id).sequence - decomposerSetId(a.set_id).sequence);
    return candidats[0] || null;
  }
  return null;
}

// Séquence libre suivante pour (notion, palier) : jamais d'écrasement d'un set_id
// déjà publié ni d'un set_id déjà utilisé ailleurs (ex. lots non relus).
function prochainSetId(notionId, palier, setIdsExistants) {
  const slug = slugDeNotion(notionId);
  if (!slug || !PALIERS.includes(palier)) return null;
  let max = 0;
  for (const s of setIdsExistants || []) {
    const d = decomposerSetId(s);
    if (d && d.slug === slug && d.palier === palier) max = Math.max(max, d.sequence);
  }
  if (max >= 99) return null;
  return `set_fonda_${slug}_${palier}_${String(max + 1).padStart(2, '0')}`;
}

return {
  SCHEMA_CATALOGUE, SCHEMA_LOT, SCHEMA_EMPREINTE, SET_ID_PATTERN, CHAMPS_LOT, CHAMPS_CARTE, CHAMPS_ENTREE,
  TYPES_ATTESTATION, HISTORIQUES_FIGES, MOTEUR_HISTORIQUE, BADGE_HISTORIQUE, FORMES_BADGE, FORME_SECOURS, FORMES_PAR_SCHEMA, texteEmpreinte, calculerEmpreinte, sha256WebCrypto, validerLot, validerAttestation,
  validerCatalogue, verifierLotContreEntree, trouverEntree, prochainSetId, decomposerSetId, slugDeNotion,
};
}); // fin UMD
