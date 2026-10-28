// Relecteur de SECOURS en intérim (CDC relecture r9 §20.6, §20.9 v3 ; plan r6 validé) :
// « eric » peut saisir et clôturer en saisie locale une notion routée vers un autre
// relecteur (titulaire), UNIQUEMENT via une entrée de fonda/data/relecture-interim.json
// lue sur design. Le référentiel n'est PAS modifié : le titulaire reste le relecteur
// attribué ; le badge dit honnêtement qui a relu (relue_par_secours, titulaire nommé).
//
// Deux usages, jamais confondus :
//   - AUTORISER une nouvelle opération (saisie S1/S2, clôture C1–C3, axe II du diagnostic) :
//     observer() = fetch EXPLICITE de design puis lecture, AU MÊME SHA figé, de
//     relecture-interim.json, calendar.json et destinataires.json (jamais la copie de
//     travail) ; validation COMPLÈTE (intrinsèque + calendaire) AVANT sélection ; une
//     seule entrée applicable au jour (Europe/Paris) ;
//   - VÉRIFIER des pièces déjà signées : archive HISTORIQUE seule (source_version /
//     source_commit sur la chaîne du premier parent), validation INTRINSÈQUE ; jamais le
//     calendrier courant, jamais le fichier de la tête.
// LIMITES ASSUMÉES (documentées, SIGNATAIRE.md) : un fetch OBSERVE l'état distant, il ne
// verrouille pas design (fenêtre résiduelle non atomique entre la dernière observation et
// l'appel au signataire) ; on ne prouve pas cryptographiquement que S2 a été exécuté.

'use strict';

const crypto = require('crypto');
const RA = require('./referentiel-archive.js');

const SCHEMA = 'relecture-interim/v1';
const CHEMIN = 'fonda/data/relecture-interim.json';
const CHEMIN_CALENDRIER = 'fonda/data/calendar.json';
const CHEMIN_DESTINATAIRES = 'fonda/data/destinataires.json';
const REF_DISTANTE = 'refs/remotes/origin/design';
// Refspec EXPLICITE : la référence de suivi est mise à jour quelle que soit la
// configuration remote.origin.fetch (jamais de poursuite sur une référence préexistante).
const REFSPEC = '+refs/heads/design:refs/remotes/origin/design';
const RELECTEURS = Object.freeze(['eric', 'justine']);
const SECOURS_ADMIS = 'eric';
const FORME_SECOURS = 'relue_par_secours';
const CHAMPS_ENTREE = Object.freeze(['relecteur_titulaire', 'relecteur_de_secours', 'motif', 'periode', 'du', 'au']);
const CHAMPS_CHARGE = Object.freeze([...CHAMPS_ENTREE, 'source_version']);
const CHAMPS_DECISION = Object.freeze([...CHAMPS_CHARGE, 'source_commit']);
const MOTIF_JOUR = /^\d{4}-\d{2}-\d{2}$/;
const MOTIF_COMMIT = /^[0-9a-f]{40}$/;

const estTexte = (v) => typeof v === 'string' && v.trim() !== '';
const clesExactes = (o, cles) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join() === [...cles].sort().join();
const versionDe = (octets) => `sha256:${crypto.createHash('sha256').update(octets).digest('hex')}`;

// Date civile AAAA-MM-JJ RÉELLE (aller-retour calendaire).
function jourCivil(v) {
  if (typeof v !== 'string' || !MOTIF_JOUR.test(v)) return false;
  const [a, m, j] = v.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j;
}
// Jour civil Europe/Paris d'un instant ISO (fonction unique, partagée signataire/vérification).
function jourParis(iso) {
  const t = Date.parse(iso);
  if (typeof iso !== 'string' || Number.isNaN(t)) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function lireJson(octets) {
  try { return { ok: true, valeur: JSON.parse(Buffer.from(octets).toString('utf8')) }; } catch { return { ok: false, raison: 'JSON invalide' }; }
}

// Validation INTRINSÈQUE (sans calendrier) : liste des défauts, vide = conforme.
function validerIntrinseque(f) {
  if (!clesExactes(f, ['schema', 'entrees'])) return ['racine : { schema, entrees } exactement attendu'];
  const e = [];
  if (f.schema !== SCHEMA) e.push(`schema ≠ ${SCHEMA}`);
  if (!Array.isArray(f.entrees)) return [...e, 'entrees : tableau attendu'];
  f.entrees.forEach((x, i) => {
    const p = `entrees[${i}]`;
    if (!clesExactes(x, CHAMPS_ENTREE)) { e.push(`${p} : champs exactement ${CHAMPS_ENTREE.join(', ')}`); return; }
    if (!RELECTEURS.includes(x.relecteur_titulaire)) e.push(`${p} : relecteur_titulaire inconnu`);
    if (!RELECTEURS.includes(x.relecteur_de_secours)) e.push(`${p} : relecteur_de_secours inconnu`);
    if (x.relecteur_titulaire === x.relecteur_de_secours) e.push(`${p} : titulaire = secours`);
    if (!estTexte(x.motif)) e.push(`${p} : motif vide`);
    if (!estTexte(x.periode)) e.push(`${p} : periode vide`);
    if (!jourCivil(x.du) || !jourCivil(x.au)) e.push(`${p} : du / au : date civile AAAA-MM-JJ réelle attendue`);
    else if (x.du > x.au) e.push(`${p} : du > au`);
  });
  if (e.length) return e;
  // Aucun chevauchement de fenêtres (bornes INCLUSIVES) pour un même titulaire.
  f.entrees.forEach((a, i) => f.entrees.forEach((b, j) => {
    if (j > i && a.relecteur_titulaire === b.relecteur_titulaire && a.du <= b.au && b.du <= a.au) e.push(`entrees[${i}] et entrees[${j}] : fenêtres chevauchantes pour ${a.relecteur_titulaire}`);
  }));
  return e;
}
// Validation CALENDAIRE (au moment d'autoriser, calendrier lu au MÊME commit) : période
// existante, au ≤ fin de la période (du peut précéder son début).
function validerCalendaire(f, calendrier) {
  const periodes = calendrier && Array.isArray(calendrier.periodes) ? calendrier.periodes : null;
  if (!periodes) return ['calendrier illisible : periodes absentes'];
  const e = [];
  f.entrees.forEach((x, i) => {
    const p = periodes.find((q) => q && q.id === x.periode);
    if (!p) e.push(`entrees[${i}] : période ${x.periode} absente du calendrier`);
    else if (!jourCivil(p.au) || x.au > p.au) e.push(`entrees[${i}] : au (${x.au}) après la fin de ${x.periode} (${p.au})`);
  });
  return e;
}
function validerRelectureInterim(f, { calendrier } = {}) {
  const e = validerIntrinseque(f);
  if (e.length || calendrier === undefined) return e;
  return validerCalendaire(f, calendrier);
}

const memeEntree = (a, b) => !!a && !!b && CHAMPS_ENTREE.every((k) => a[k] === b[k]);
const entreeDe = (bloc) => Object.fromEntries(CHAMPS_ENTREE.map((k) => [k, bloc[k]]));
// Entrées couvrant `jour` pour `titulaire` (fichier déjà validé).
const applicables = (f, titulaire, jour) => f.entrees.filter((x) => x.relecteur_titulaire === titulaire && x.du <= jour && jour <= x.au);

// Présentation (ce qui sera signé, affiché AVANT confirmation) : badge exact, motif, fenêtre.
function presentation(entree, destinataires) {
  const nom = (id) => {
    const r = destinataires && destinataires.relecteurs && Object.prototype.hasOwnProperty.call(destinataires.relecteurs, id) ? destinataires.relecteurs[id] : null;
    return r && estTexte(r.nom_affiche) ? r.nom_affiche : null;
  };
  const secours = nom(entree.relecteur_de_secours);
  const titulaire = nom(entree.relecteur_titulaire);
  if (!secours || !titulaire) return { ok: false, raison: 'destinataires.json : nom_affiche du secours ou du titulaire absent au SHA observé' };
  return {
    ok: true,
    presentation: {
      badge: { forme: FORME_SECOURS, nom_affiche: secours, id: entree.relecteur_de_secours, titulaire: { id: entree.relecteur_titulaire, nom_affiche: titulaire } },
      motif: entree.motif, periode: entree.periode, du: entree.du, au: entree.au,
    },
  };
}
const memePresentation = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const textePresentation = (p, sha) => [
  'INTÉRIM DE RELECTURE (fonda/data/relecture-interim.json, design) :',
  `  Titulaire : ${p.badge.titulaire.nom_affiche} (${p.badge.titulaire.id}) — relecteur de secours : ${p.badge.nom_affiche} (${p.badge.id})`,
  `  Motif : ${p.motif}`, `  Fenêtre : ${p.periode}, du ${p.du} au ${p.au} (heure de Paris, bornes incluses)`,
  `  Badge signé : « ${p.badge.forme} » ${p.badge.nom_affiche}, en attendant ${p.badge.titulaire.nom_affiche}`,
  `  Version observée : origin/design ${sha}`,
].join('\n');

// AUTORISATION d'une nouvelle opération pour `relecteur` (attribué, ≠ eric) au jour `jour`
// (Europe/Paris), sur une OBSERVATION { sha, octetsInterim, octetsCalendrier, octetsDestinataires }.
function autoriser(relecteur, jour, obs) {
  const refus = (raison) => ({ ok: false, raison });
  if (!obs || !MOTIF_COMMIT.test(obs.sha || '')) return refus('observation de design absente ou invalide');
  const f = lireJson(obs.octetsInterim);
  if (!f.ok) return refus(`${CHEMIN} : JSON invalide`);
  const cal = lireJson(obs.octetsCalendrier);
  if (!cal.ok) return refus(`${CHEMIN_CALENDRIER} : JSON invalide`);
  const e = validerRelectureInterim(f.valeur, { calendrier: cal.valeur });
  if (e.length) return refus(`${CHEMIN} non conforme : ${e.join(' ; ')}`);
  if (!jourCivil(jour)) return refus('jour invalide');
  const a = applicables(f.valeur, relecteur, jour);
  if (a.length !== 1) return refus(`${a.length} entrée(s) d'intérim applicable(s) au ${jour} pour « ${relecteur} » (exactement une attendue)`);
  const entree = a[0];
  if (entree.relecteur_de_secours !== SECOURS_ADMIS) return refus(`relecteur de secours « ${entree.relecteur_de_secours} » : seul « ${SECOURS_ADMIS} » signe en saisie locale`);
  const d = lireJson(obs.octetsDestinataires);
  if (!d.ok) return refus(`${CHEMIN_DESTINATAIRES} : JSON invalide`);
  const pr = presentation(entree, d.valeur);
  if (!pr.ok) return refus(pr.raison);
  return { ok: true, entree: entreeDe(entree), presentation: pr.presentation, source_version: versionDe(obs.octetsInterim), sha: obs.sha };
}

const blocCharge = (entree, sourceVersion) => ({ ...entreeDe(entree), source_version: sourceVersion });
const blocDecision = (entree, sourceVersion, sourceCommit) => ({ ...blocCharge(entree, sourceVersion), source_commit: sourceCommit });

// PROVENANCE de la preuve enregistrée à la saisie (bloc de decision-fonda/v2) :
// aCommit(commit) -> { surPremierParent, octetsInterim, octetsCalendrier } (archive
// historique seule). Prouve que l'état revendiqué POUVAIT autoriser la saisie au jour de
// recu_le — pas que S2 a été exécuté (limite assumée).
function prouverProvenance(bloc, recuLe, aCommit) {
  const refus = (raison) => ({ ok: false, raison: `provenance de la saisie : ${raison}` });
  if (!clesExactes(bloc, CHAMPS_DECISION)) return refus(`bloc d'intérim : champs exactement ${CHAMPS_DECISION.join(', ')}`);
  if (!MOTIF_COMMIT.test(bloc.source_commit || '')) return refus('source_commit : 40 hex attendus');
  if (!RA.MOTIF_VERSION.test(bloc.source_version || '')) return refus('source_version : sha256:<64 hex> attendu');
  let c;
  try { c = aCommit(bloc.source_commit); } catch (e) { return refus(`commit ${bloc.source_commit.slice(0, 7)} illisible (${e.message})`); }
  if (!c || c.surPremierParent !== true) return refus(`commit ${bloc.source_commit.slice(0, 7)} hors de la chaîne de confiance (premier parent de design)`);
  if (versionDe(c.octetsInterim) !== bloc.source_version) return refus(`empreinte de ${CHEMIN} au commit ≠ source_version`);
  const f = lireJson(c.octetsInterim);
  const cal = lireJson(c.octetsCalendrier);
  if (!f.ok || !cal.ok) return refus('fichier d\'intérim ou calendrier du commit illisible');
  const e = validerRelectureInterim(f.valeur, { calendrier: cal.valeur });
  if (e.length) return refus(`fichier d'intérim du commit non conforme : ${e.join(' ; ')}`);
  const jour = jourParis(recuLe);
  const a = jour ? applicables(f.valeur, bloc.relecteur_titulaire, jour) : [];
  if (a.length !== 1 || !memeEntree(a[0], bloc)) return refus(`aucune entrée unique, identique au bloc, applicable au ${jour} dans le fichier du commit`);
  return { ok: true };
}

// ARCHIVE d'une charge v3 (invariants de dépôt D2–D4) : octets résolus pour
// source_version ; validation INTRINSÈQUE ; le bloc signé (sans source_version) est
// EXACTEMENT une entrée de l'archive. Renvoie les défauts.
function verifierArchive(bloc, octets) {
  if (!octets) return ['archive d\'intérim absente'];
  if (versionDe(octets) !== bloc.source_version) return ['archive d\'intérim : sha256 des octets ≠ source_version'];
  const f = lireJson(octets);
  if (!f.ok) return ['archive d\'intérim : JSON invalide'];
  const e = validerIntrinseque(f.valeur);
  if (e.length) return [`archive d'intérim non conforme : ${e.join(' ; ')}`];
  const n = f.valeur.entrees.filter((x) => memeEntree(x, bloc)).length;
  if (n !== 1) return [`relecture_interim ≠ exactement une entrée de l'archive (${n} trouvée(s))`];
  return [];
}

// --- Adaptateur Git (exécuteur injectable : args -> Buffer) -----------------------------------
function actualiser(git) {
  git(['fetch', '--quiet', 'origin', REFSPEC]);
  const sha = git(['rev-parse', '--verify', '--quiet', `${REF_DISTANTE}^{commit}`]).toString('utf8').trim();
  if (!MOTIF_COMMIT.test(sha)) throw new Error(`${REF_DISTANTE} : commit introuvable après actualisation`);
  return { sha };
}
function observer(git) {
  const { sha } = actualiser(git);
  const lire = (chemin) => git(['show', `${sha}:${chemin}`]);
  return { sha, octetsInterim: lire(CHEMIN), octetsCalendrier: lire(CHEMIN_CALENDRIER), octetsDestinataires: lire(CHEMIN_DESTINATAIRES) };
}
// Lecture d'un commit pour la PROVENANCE : sur la chaîne du premier parent d'une des refs.
function aCommitGit({ git, refs }) {
  return (commit) => {
    if (!MOTIF_COMMIT.test(commit || '')) return { surPremierParent: false };
    const chaine = new Set();
    for (const r of refs) git(['rev-list', '--first-parent', r]).toString('utf8').split('\n').filter(Boolean).forEach((c) => chaine.add(c));
    if (!chaine.has(commit)) return { surPremierParent: false };
    return { surPremierParent: true, octetsInterim: git(['show', `${commit}:${CHEMIN}`]), octetsCalendrier: git(['show', `${commit}:${CHEMIN_CALENDRIER}`]) };
  };
}
// Résolveur SYNCHRONE d'archive (vérification des charges v3) : version -> { ok, octets } | { ok: false, raison }.
function resoudreInterimGit({ refs, racine, git }) {
  return (version) => RA.resoudreFichierArchive({ chemin: CHEMIN, version, refs, racine, git, lire: (o) => ({ ok: true, valeur: o }), libelle: 'archive d\'intérim' });
}

module.exports = {
  SCHEMA, CHEMIN, CHEMIN_CALENDRIER, CHEMIN_DESTINATAIRES, REF_DISTANTE, REFSPEC, RELECTEURS, SECOURS_ADMIS, FORME_SECOURS,
  CHAMPS_ENTREE, CHAMPS_CHARGE, CHAMPS_DECISION,
  jourCivil, jourParis, versionDe, validerIntrinseque, validerCalendaire, validerRelectureInterim, memeEntree, entreeDe, applicables,
  presentation, memePresentation, textePresentation, autoriser, blocCharge, blocDecision, prouverProvenance, verifierArchive,
  actualiser, observer, aCommitGit, resoudreInterimGit,
};
