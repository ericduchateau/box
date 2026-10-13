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
const PROFILS = ['sens', 'numerique', 'exact', 'orthographe'];
const TYPES_ATTESTATION = ['manuelle-historique', 'n8n-relecture'];

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
  'set_id', 'notion_id', 'palier', 'fichier', 'item_ids', 'empreinte', 'relecteur', 'attestation',
]);

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
    if (!PROFILS.includes(c.profil_correction)) erreurs.push(`${p} : profil inconnu`);
    if (!Array.isArray(c.reponses_acceptees) || c.reponses_acceptees.length === 0
      || !c.reponses_acceptees.every((r) => estTexte(r) || (typeof r === 'number' && Number.isFinite(r)))) {
      erreurs.push(`${p} : reponses_acceptees invalides`);
    }
    if (c.unite != null && typeof c.unite !== 'string') erreurs.push(`${p} : unite non texte`);
    if (c.arrondi != null && !(Number.isInteger(c.arrondi) && c.arrondi >= 0 && c.arrondi <= 10)) erreurs.push(`${p} : arrondi hors 0..10`);
    if (c.seconde_chance != null && typeof c.seconde_chance !== 'boolean') erreurs.push(`${p} : seconde_chance non booléen`);
  });
  return { valide: erreurs.length === 0, erreurs };
}

// ---------------------------------------------------------------------------
// Attestation (forme). Deux types distincts, jamais confondus :
//  - manuelle-historique : UNIQUEMENT les 8 lots du lot de validation du 11/10,
//    attestation déclarative d'Éric (pas une preuve technique) ;
//  - n8n-relecture : produite par la relecture FONDA (bloc 2) — forme réservée ;
//    sa signature/source de confiance n'est PAS encore spécifiée.
// ---------------------------------------------------------------------------
function validerAttestation(att, entree) {
  const erreurs = [];
  if (!att || typeof att !== 'object') return ['attestation absente'];
  if (!TYPES_ATTESTATION.includes(att.type)) return [`type d'attestation inconnu : ${att.type}`];
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
    if (!e.relecteur || !estTexte(e.relecteur.id) || !estTexte(e.relecteur.nom_affiche)) erreurs.push(`${p} : relecteur incomplet`);
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
  TYPES_ATTESTATION, HISTORIQUES_FIGES, texteEmpreinte, calculerEmpreinte, sha256WebCrypto, validerLot, validerAttestation,
  validerCatalogue, verifierLotContreEntree, trouverEntree, prochainSetId, decomposerSetId, slugDeNotion,
};
}); // fin UMD
