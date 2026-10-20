// Verrou de DÉCLENCHEMENT d'une génération FONDA (plan étape 5, lot 4 ; dette C « réduite,
// pas close », D5 : le garant reste l'abandon du signataire sur doublon). Mac d'Éric seulement.
//
// Fichier `<verrous>/<set_id>.generation` : créé UNE fois (O_EXCL), jamais supprimé ni recréé.
// Journal en AJOUT SEUL, une ligne JSON terminée par « \n » par événement, fsync après chaque
// ajout. Deux familles de lignes, jamais confondues :
//   - TRANSITIONS d'état  { v: 1, evt, le, par, … }  evt ∈ envoi | accepte | refuse | inconnu | libere
//   - événements ADMINISTRATIFS { v: 1, admin, le, … } admin ∈ reparation | reprise_orphelin
//     (ils ne changent JAMAIS l'état).
// Une ligne illisible n'est tolérée que si une ligne `reparation` ULTÉRIEURE la désigne
// exactement (`fragment_ligne` = son index, `fragment_sha256` = SHA-256 de ses octets) ;
// sinon le journal est « corrompu » (toute commande refuse, sauf --reparer). Une fin de fichier
// sans « \n » = « tronqué » (idem). Rien n'est jamais effacé.
//
// EXCLUSION COMMUNE : toute commande qui décide ou ajoute (declencher, --etat, --liberer,
// --reparer) acquiert `<set_id>.generation.en-cours` (O_EXCL, { pid, commande, le, jeton })
// puis RELIT l'état ; elle le libère en fin (finally), seulement si c'est bien le sien.
// --reparer acquiert d'abord `<set_id>.generation.reparation` (O_EXCL) : deux réparateurs ne
// coexistent jamais. Un verrou ORPHELIN (pid inexistant) est repris par RENOMMAGE atomique
// (un seul gagnant), avec trace `reprise_orphelin` ; un verrou tenu par un pid vivant -> refus.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class RefusVerrou extends Error {
  constructor(message, etat = null) { super(message); this.name = 'RefusVerrou'; this.etat = etat; }
}

const EVENEMENTS = ['envoi', 'accepte', 'refuse', 'inconnu', 'libere'];
// De (état courant ; null = aucune transition) -> événements admis, et par quelle commande.
const TRANSITIONS = Object.freeze({
  null: { envoi: ['declencher'] },
  refuse: { envoi: ['declencher'] },
  libere: { envoi: ['declencher'] },
  envoi: { accepte: ['declencher', 'etat'], refuse: ['declencher'], inconnu: ['declencher'], libere: ['liberer'] },
  inconnu: { accepte: ['etat'], libere: ['liberer'] },
  accepte: {}, // TERMINAL
});

const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');
const chemins = (dossier, setId) => {
  if (!/^set_fonda_[a-z0-9-]+_n[IF]_\d{2}$/.test(setId || '')) throw new RefusVerrou(`set_id invalide : ${setId}`);
  const base = path.join(dossier, `${setId}.generation`);
  return { journal: base, enCours: `${base}.en-cours`, reparation: `${base}.reparation` };
};

// --- Lecture du journal (pure) ---------------------------------------------------------------
// -> { etat, lignes, tronque, corrompu, raison, dernier, tentatives }
function analyser(texte) {
  const res = { etat: null, tronque: false, corrompu: false, raison: null, dernier: null, tentatives: 0, illisibles: [] };
  if (texte === null || texte === '') return res;
  const segments = texte.split('\n');
  const finale = segments.pop(); // '' si le fichier finit par \n
  if (finale !== '') { res.tronque = true; res.raison = 'dernière ligne tronquée (pas de fin de ligne)'; }
  const lues = segments.map((t, i) => { try { return { i, t, o: JSON.parse(t) }; } catch { return { i, t, o: null }; } });
  const couverts = new Set();
  for (const l of lues) {
    if (l.o && l.o.admin === 'reparation' && Number.isInteger(l.o.fragment_ligne)) {
      const cible = lues[l.o.fragment_ligne];
      if (cible && l.o.fragment_ligne < l.i && !cible.o && sha256(cible.t) === l.o.fragment_sha256) couverts.add(cible.i);
    }
  }
  let etat = null;
  for (const l of lues) {
    if (!l.o) {
      if (!couverts.has(l.i)) { res.illisibles.push(l.i); res.corrompu = true; res.raison = `ligne ${l.i + 1} illisible, non réparée`; }
      continue;
    }
    if (l.o.admin) continue; // administratif : n'affecte jamais l'état
    if (!EVENEMENTS.includes(l.o.evt)) { res.corrompu = true; res.raison = `ligne ${l.i + 1} : événement inconnu`; continue; }
    const admis = TRANSITIONS[String(etat)] || {};
    if (!admis[l.o.evt] || !admis[l.o.evt].includes(l.o.par)) { res.corrompu = true; res.raison = `ligne ${l.i + 1} : transition ${etat} -> ${l.o.evt} (par ${l.o.par}) interdite`; continue; }
    etat = l.o.evt;
    res.dernier = l.o;
    if (l.o.evt === 'envoi') res.tentatives += 1;
  }
  res.etat = etat;
  return res;
}

function lireTexte(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function ajouterLigne(p, objet, { creer = false } = {}) {
  const fd = fs.openSync(p, creer ? 'wx' : 'a');
  try { fs.writeSync(fd, `${JSON.stringify({ v: 1, ...objet })}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function ecrireExclusif(p, objet) {
  const fd = fs.openSync(p, 'wx');
  try { fs.writeSync(fd, `${JSON.stringify(objet)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function lireJson(p) { const t = lireTexte(p); if (t === null) return null; try { return JSON.parse(t); } catch { return { illisible: true }; } }

const pidVivantParDefaut = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

// --- Exclusion commune ---------------------------------------------------------------------
function acquerir(p, commande, { pid = process.pid, horloge = () => new Date() } = {}) {
  const jeton = crypto.randomBytes(8).toString('hex');
  try { ecrireExclusif(p, { pid, commande, le: horloge().toISOString(), jeton }); } catch (e) {
    if (e.code === 'EEXIST') return null;
    throw e;
  }
  return jeton;
}
function relacher(p, jeton) {
  const c = lireJson(p);
  if (c && c.jeton === jeton) fs.unlinkSync(p);
}

async function avecExclusion(dossier, setId, commande, fn, opts = {}) {
  const c = chemins(dossier, setId);
  const jeton = acquerir(c.enCours, commande, opts);
  if (!jeton) {
    const tenu = lireJson(c.enCours) || {};
    throw new RefusVerrou(`${setId} : opération « ${tenu.commande || '?'} » en cours ou interrompue (${path.basename(c.enCours)}, pid ${tenu.pid || '?'}) — si le processus n'existe plus : --reparer`);
  }
  try {
    const a = analyser(lireTexte(c.journal)); // RELECTURE après acquisition, jamais avant
    if (a.tronque || a.corrompu) throw new RefusVerrou(`${setId} : journal du verrou ${a.tronque ? 'tronqué' : 'corrompu'} (${a.raison}) — --reparer`, a.etat);
    return await fn({ ...c, analyse: a });
  } finally { relacher(c.enCours, jeton); }
}

// --- Commandes -----------------------------------------------------------------------------
// Ajout d'une transition, contrôlé contre l'état RELU sous exclusion.
function transition(c, analyse, evt, par, horloge, extra = {}) {
  const admis = TRANSITIONS[String(analyse.etat)] || {};
  if (!admis[evt] || !admis[evt].includes(par)) throw new RefusVerrou(`transition ${analyse.etat} -> ${evt} (par ${par}) interdite`, analyse.etat);
  ajouterLigne(c.journal, { evt, le: horloge().toISOString(), par, ...extra }, { creer: analyse.etat === null && lireTexte(c.journal) === null });
  analyse.etat = evt;
}

const MESSAGE_ETAT = {
  accepte: 'génération déjà ACCEPTÉE pour ce set_id (état terminal) : jamais de second déclenchement',
  envoi: 'envoi précédent SANS résultat (interrompu) : état indéterminé — observer avec --etat',
  inconnu: 'réponse précédente INCONNUE : observer avec --etat, puis --liberer si rien n\'est observé',
};

// deps : { verrous, lecture: { reservation(setId, ref) -> { ok, raison }, idsLocaux() -> [set_id],
//          executionsDuSetId(setId) -> n, candidatsDuSetId(setId) -> n }, envoyer(corps) ->
//          { statut } (lève si transport en échec), pid?, horloge? }
async function declencher(setId, ref, deps) {
  const horloge = deps.horloge || (() => new Date());
  const L = deps.lecture;
  // (a) Contrôles EN LECTURE, AVANT tout verrou (C8).
  const r = await L.reservation(setId, ref);
  if (!r || r.ok !== true) throw new RefusVerrou(`réservation : ${(r && r.raison) || 'non vérifiée'}`);
  const ids = await L.idsLocaux();
  if (ids.includes(setId)) throw new RefusVerrou(`${setId} : déjà porté par un fichier local (calibration, lot ou catalogue) — promouvable, pas régénérable`);
  const nx = await L.executionsDuSetId(setId);
  if (nx !== 0) throw new RefusVerrou(`${setId} : ${nx} exécution(s) n8n portent déjà ce set_id`);
  const nc = await L.candidatsDuSetId(setId);
  if (nc !== 0) throw new RefusVerrou(`${setId} : ${nc} candidat(s) déjà dans candidats/`);
  // (b) Verrou, relecture, un seul envoi.
  return avecExclusion(deps.verrous, setId, 'declencher', async (c) => {
    const a = c.analyse;
    if (a.etat !== null && a.etat !== 'refuse' && a.etat !== 'libere') throw new RefusVerrou(`${setId} : ${MESSAGE_ETAT[a.etat]}`, a.etat);
    transition(c, a, 'envoi', 'declencher', horloge, { tentative: a.tentatives + 1 });
    let statut;
    try { statut = (await deps.envoyer({ set_id: setId, ref })).statut; } catch { statut = null; }
    const issue = statut === 202 ? 'accepte' : statut === 400 ? 'refuse' : 'inconnu';
    transition(c, a, issue, 'declencher', horloge, { statut });
    return { issue, statut, consigne: issue === 'inconnu' ? 'NE PAS renvoyer : observer avec --etat' : null };
  }, deps);
}

// Observation sous exclusion : ENVOI sans résultat ou INCONNU + exécution/candidat observé -> accepte.
async function etat(setId, deps) {
  const horloge = deps.horloge || (() => new Date());
  return avecExclusion(deps.verrous, setId, 'etat', async (c) => {
    const a = c.analyse;
    const obs = { executions: await deps.lecture.executionsDuSetId(setId), candidats: await deps.lecture.candidatsDuSetId(setId) };
    if ((a.etat === 'envoi' || a.etat === 'inconnu') && (obs.executions > 0 || obs.candidats > 0)) transition(c, a, 'accepte', 'etat', horloge, { observe: obs });
    return { etat: a.etat, observe: obs };
  }, deps);
}

// Libération CONSIGNÉE : ENVOI sans résultat ou INCONNU, rien observé, délai de prudence écoulé.
async function liberer(setId, motif, deps) {
  const horloge = deps.horloge || (() => new Date());
  const delaiMs = deps.delaiPrudenceMs ?? 15 * 60 * 1000;
  if (typeof motif !== 'string' || !motif.trim()) throw new RefusVerrou('--liberer : --motif requis');
  return avecExclusion(deps.verrous, setId, 'liberer', async (c) => {
    const a = c.analyse;
    if (a.etat !== 'envoi' && a.etat !== 'inconnu') throw new RefusVerrou(`${setId} : état ${a.etat} — rien à libérer`, a.etat);
    const age = horloge() - new Date(a.dernier.le);
    if (!(age >= delaiMs)) throw new RefusVerrou(`${setId} : délai de prudence non écoulé (${Math.round(age / 1000)} s < ${delaiMs / 1000} s)`, a.etat);
    const obs = { executions: await deps.lecture.executionsDuSetId(setId), candidats: await deps.lecture.candidatsDuSetId(setId) };
    if (obs.executions > 0 || obs.candidats > 0) throw new RefusVerrou(`${setId} : exécution ou candidat observé — utiliser --etat (accepte), jamais --liberer`, a.etat);
    transition(c, a, 'libere', 'liberer', horloge, { motif: motif.trim(), observe: obs });
    return { etat: 'libere' };
  }, deps);
}

// Reprise d'un verrou ORPHELIN par renommage atomique (un seul gagnant).
function reprendreOrphelin(p, { estVivant, horloge, pid }) {
  const c = lireJson(p);
  if (c === null) return { repris: false, absent: true };
  if (c && !c.illisible && estVivant(c.pid)) return { repris: false, vivant: c };
  const dest = `${p}.orphelin-${horloge().toISOString().replace(/[:.]/g, '-')}-${pid}`;
  try { fs.renameSync(p, dest); } catch (e) { if (e.code === 'ENOENT') return { repris: false, concurrent: true }; throw e; }
  return { repris: true, ancien: c, trace: path.basename(dest) };
}

async function reparer(setId, deps) {
  const horloge = deps.horloge || (() => new Date());
  const pid = deps.pid || process.pid;
  const estVivant = deps.estVivant || pidVivantParDefaut;
  const c = chemins(deps.verrous, setId);
  // 1. Exclusion des réparateurs (reprise si orpheline : réparation interrompue).
  let jetonR = acquerir(c.reparation, 'reparer', { pid, horloge });
  if (!jetonR) {
    const r = reprendreOrphelin(c.reparation, { estVivant, horloge, pid });
    if (r.vivant) throw new RefusVerrou(`${setId} : une réparation est EN COURS (pid ${r.vivant.pid})`);
    jetonR = acquerir(c.reparation, 'reparer', { pid, horloge });
    if (!jetonR) throw new RefusVerrou(`${setId} : réparation concurrente — réessayer après`);
  }
  const actions = [];
  try {
    // 2. Verrou d'exclusion commun : repris s'il est orphelin, jamais si son pid vit.
    let jetonE = acquerir(c.enCours, 'reparer', { pid, horloge });
    let reprise = null;
    if (!jetonE) {
      const r = reprendreOrphelin(c.enCours, { estVivant, horloge, pid });
      if (r.vivant) throw new RefusVerrou(`${setId} : opération « ${r.vivant.commande} » en cours (pid ${r.vivant.pid}) : pas un orphelin`);
      jetonE = acquerir(c.enCours, 'reparer', { pid, horloge });
      if (!jetonE) throw new RefusVerrou(`${setId} : verrou repris par un autre processus — réessayer après`);
      if (r.repris) reprise = r;
    }
    try {
      // 3. Journal : fin de ligne manquante puis lignes illisibles non couvertes (idempotent).
      let texte = lireTexte(c.journal);
      if (texte !== null && texte !== '' && !texte.endsWith('\n')) {
        const fd = fs.openSync(c.journal, 'a');
        try { fs.writeSync(fd, '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        texte = lireTexte(c.journal);
        actions.push('fin de ligne ajoutée après le fragment tronqué');
      }
      const a = analyser(texte);
      const segments = texte === null ? [] : texte.split('\n').slice(0, -1);
      for (const i of a.illisibles) {
        ajouterLigne(c.journal, { admin: 'reparation', le: horloge().toISOString(), fragment_ligne: i, fragment_sha256: sha256(segments[i]), motif: 'ligne illisible (fragment conservé, ignoré à la lecture)' });
        actions.push(`ligne ${i + 1} désignée comme fragment réparé`);
      }
      if (reprise) {
        if (texte === null) ajouterLigne(c.journal, { admin: 'reprise_orphelin', le: horloge().toISOString(), ancien: reprise.ancien, trace: reprise.trace }, { creer: true });
        else ajouterLigne(c.journal, { admin: 'reprise_orphelin', le: horloge().toISOString(), ancien: reprise.ancien, trace: reprise.trace });
        actions.push(`verrou orphelin repris (${reprise.trace})`);
      }
      const apres = analyser(lireTexte(c.journal));
      if (apres.tronque || apres.corrompu) throw new RefusVerrou(`${setId} : journal encore ${apres.tronque ? 'tronqué' : 'corrompu'} après réparation (${apres.raison}) — traitement manuel`);
      return { etat: apres.etat, actions, consigne: apres.etat === 'envoi' || apres.etat === 'inconnu' ? 'état indéterminé : observer avec --etat' : null };
    } finally { relacher(c.enCours, jetonE); }
  } finally { relacher(c.reparation, jetonR); }
}

function lireEtat(setId, verrous) { const c = chemins(verrous, setId); return analyser(lireTexte(c.journal)); }

module.exports = { RefusVerrou, TRANSITIONS, analyser, declencher, etat, liberer, reparer, lireEtat, chemins, avecExclusion, sha256 };
