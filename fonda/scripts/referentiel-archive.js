// Résolveur de RÉFÉRENTIEL ARCHIVÉ (CDC relecture v8.3 §20.12) — commun au signataire
// (signer-cloture.js), à la publication (publier-lot.js) et à la CI (catalogue.test.js).
//
// Une attestation porte `referentiel_version` = "sha256:" + SHA-256 des OCTETS de
// fonda/data/referentiel.json à la version relue. On la retrouve sur l'HISTORIQUE DE
// CONFIANCE : chaîne du PREMIER PARENT des références données (sommet de confiance :
// `design` ; en CI, la référence du contrôle §17 en plus). Les octets sont ceux du blob
// Git, jamais ceux de la copie de travail ; leur SHA-256 est recalculé ici.
//   - version trouvée -> { ok, octets, referentiel, commit } ;
//   - version mal formée, référence nulle/introuvable, historique incomplet, objet
//     illisible (on ne peut pas exclure qu'il soit la version cherchée), JSON invalide
//     ou structure invalide (objet { notions: [...] } attendu) de la version trouvée,
//     version introuvable -> { ok: false, raison } (REFUS).
// Le relecteur attribué d'une attestation est vérifié contre CETTE version : une
// réattribution ultérieure au référentiel courant n'invalide jamais une attestation
// passée, et une attribution récente ne valide jamais une attestation ancienne.
// Mécanisme GÉNÉRALISÉ au chemin (resoudreFichierArchive) : il résout aussi l'archive
// d'intérim (relecture-interim.json) d'une charge v3 (CDC r9, interim.js).

'use strict';

const crypto = require('crypto');
const M = require('./verifier-moteurs.js');

const CHEMIN = 'fonda/data/referentiel.json';
const MOTIF_VERSION = /^sha256:[0-9a-f]{64}$/;
const versionDe = (octets) => `sha256:${crypto.createHash('sha256').update(octets).digest('hex')}`;

// Résolution GÉNÉRIQUE d'un fichier du dépôt à une version (« sha256:<64 hex> » de ses
// octets) sur l'historique de confiance — même règle pour le référentiel (§20.12) et
// pour l'archive d'intérim (relecture-interim.json). `lire(octets)` -> { ok, valeur } |
// { ok: false, raison } contrôle la version TROUVÉE (une version introuvable n'est
// jamais remplacée par une autre).
function resoudreFichierArchive({ chemin, version, refs, racine = M.RACINE, git = M.executeurGit(racine), lire, libelle = chemin }) {
  if (typeof version !== 'string' || !MOTIF_VERSION.test(version)) return { ok: false, raison: `version de ${chemin} mal formée (sha256:<64 hex> attendu)` };
  if (!Array.isArray(refs) || refs.length === 0) return { ok: false, raison: 'aucune référence de confiance fournie' };
  const { erreurs, valides } = M.controlerRefs([...new Set(refs)], git);
  if (erreurs.length) return { ok: false, raison: `historique de confiance inutilisable : ${erreurs.join(' ; ')}` };
  let blobs;
  try { blobs = M.versionsSurHistorique(git, valides, chemin).get(chemin) || new Map(); } catch (e) { return { ok: false, raison: `historique illisible : ${e.message}` }; }
  for (const [blob, commit] of blobs) {
    let octets;
    try { octets = git(['cat-file', 'blob', blob]); } catch { return { ok: false, raison: `${chemin} : objet ${blob.slice(0, 7)} (en ${commit.slice(0, 7)}) illisible — refus` }; }
    if (versionDe(octets) !== version) continue;
    const l = lire(octets);
    if (!l.ok) return { ok: false, raison: `${chemin} en ${commit.slice(0, 7)} : ${l.raison} — refus` };
    return { ok: true, octets, valeur: l.valeur, commit };
  }
  return { ok: false, raison: `${libelle} ${version.slice(0, 15)}… introuvable sur l'historique de confiance (${valides.join(', ')})` };
}

function lireReferentiel(octets) {
  let referentiel;
  try { referentiel = JSON.parse(octets.toString('utf8')); } catch { return { ok: false, raison: 'JSON invalide' }; }
  if (!referentiel || typeof referentiel !== 'object' || Array.isArray(referentiel) || !Array.isArray(referentiel.notions)) {
    return { ok: false, raison: 'structure invalide ({ notions: [...] } attendu)' };
  }
  return { ok: true, valeur: referentiel };
}

function resoudreReferentiel({ version, refs, racine = M.RACINE, git = M.executeurGit(racine) }) {
  if (typeof version !== 'string' || !MOTIF_VERSION.test(version)) return { ok: false, raison: 'referentiel_version mal formée (sha256:<64 hex> attendu)' };
  const r = resoudreFichierArchive({ chemin: CHEMIN, version, refs, racine, git, lire: lireReferentiel, libelle: 'référentiel' });
  if (!r.ok) return r;
  return { ok: true, octets: r.octets, referentiel: r.valeur, commit: r.commit };
}

// Adaptateur pour signer-cloture.js (deps.referentielArchive) : octets de la version ;
// erreur explicite si elle est introuvable (le signataire recalcule aussi le SHA-256).
function referentielArchiveGit({ refs, racine = M.RACINE, git } = {}) {
  return async (version) => {
    const r = resoudreReferentiel({ version, refs, racine, git: git || M.executeurGit(racine) });
    if (!r.ok) throw new Error(r.raison);
    return r.octets;
  };
}

// Références de confiance par défaut : `design` (autorité) ; en CI, la référence du
// contrôle (FONDA_REF_BASE) en plus, comme verifier-immuabilite.js.
function refsDeConfiance(env = process.env) {
  return [...new Set([env.FONDA_REF_BASE, 'design'].filter(Boolean))];
}

module.exports = { CHEMIN, MOTIF_VERSION, resoudreFichierArchive, resoudreReferentiel, referentielArchiveGit, refsDeConfiance, versionDe };
