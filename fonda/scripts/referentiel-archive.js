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
//     de la version trouvée, version introuvable -> { ok: false, raison } (REFUS).
// Le relecteur attribué d'une attestation est vérifié contre CETTE version : une
// réattribution ultérieure au référentiel courant n'invalide jamais une attestation
// passée, et une attribution récente ne valide jamais une attestation ancienne.

'use strict';

const crypto = require('crypto');
const M = require('./verifier-moteurs.js');

const CHEMIN = 'fonda/data/referentiel.json';
const MOTIF_VERSION = /^sha256:[0-9a-f]{64}$/;
const versionDe = (octets) => `sha256:${crypto.createHash('sha256').update(octets).digest('hex')}`;

function resoudreReferentiel({ version, refs, racine = M.RACINE, git = M.executeurGit(racine) }) {
  if (typeof version !== 'string' || !MOTIF_VERSION.test(version)) return { ok: false, raison: 'referentiel_version mal formée (sha256:<64 hex> attendu)' };
  if (!Array.isArray(refs) || refs.length === 0) return { ok: false, raison: 'aucune référence de confiance fournie' };
  const { erreurs, valides } = M.controlerRefs([...new Set(refs)], git);
  if (erreurs.length) return { ok: false, raison: `historique de confiance inutilisable : ${erreurs.join(' ; ')}` };
  let blobs;
  try { blobs = M.versionsSurHistorique(git, valides, CHEMIN).get(CHEMIN) || new Map(); } catch (e) { return { ok: false, raison: `historique illisible : ${e.message}` }; }
  for (const [blob, commit] of blobs) {
    let octets;
    try { octets = git(['cat-file', 'blob', blob]); } catch { return { ok: false, raison: `${CHEMIN} : objet ${blob.slice(0, 7)} (en ${commit.slice(0, 7)}) illisible — refus` }; }
    if (versionDe(octets) !== version) continue;
    let referentiel;
    try { referentiel = JSON.parse(octets.toString('utf8')); } catch { return { ok: false, raison: `${CHEMIN} en ${commit.slice(0, 7)} : JSON invalide — refus` }; }
    return { ok: true, octets, referentiel, commit };
  }
  return { ok: false, raison: `référentiel ${version.slice(0, 15)}… introuvable sur l'historique de confiance (${valides.join(', ')})` };
}

// Adaptateur pour signer-cloture.js (deps.referentielArchive) : octets de la version, ou
// null si introuvable ; le signataire recalcule lui-même le SHA-256 et refuse.
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

module.exports = { CHEMIN, resoudreReferentiel, referentielArchiveGit, refsDeConfiance, versionDe };
