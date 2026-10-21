// Verrou de DÉCLENCHEMENT d'une génération FONDA (plan étape 5, lot 4 ; dette C « réduite,
// pas close », D5 : le garant reste l'abandon du signataire sur doublon). Mac d'Éric seulement.
//
// EXCLUSION : verrou NOYAU (flock BSD) pris par /usr/bin/lockf sur `<set_id>.generation.verrou`
// autour de TOUT le processus de commande (declencher, --etat, --liberer, --reparer). Le noyau
// le libère à la mort du processus (y compris kill -9) : un verrou ORPHELIN est impossible par
// construction, aucune « reprise » n'est donc nécessaire ni permise (relecture Codex du lot 4 :
// la reprise d'un fichier-verrou par PID n'est pas atomique). Deux commandes concurrentes : la
// seconde échoue immédiatement (lockf -t 0, code 75). Chaque fonction exige d'être exécutée
// sous CE verrou (deps.sousVerrou = chemin du verrou, posé par la CLI) et RELIT l'état ensuite.
//
// JOURNAL `<set_id>.generation` : créé une fois, jamais supprimé ni recréé ; ajout seul, une ligne
// JSON terminée par « \n » par événement, écrite EN ENTIER (écritures courtes reprises) puis fsync.
// Deux familles EXCLUSIVES, validées strictement :
//   - TRANSITIONS { v: 1, evt, le, par, … }  evt ∈ envoi | accepte | refuse | inconnu | libere
//   - ADMINISTRATIF { v: 1, admin: 'reparation', le, fragment_ligne, fragment_sha256, motif }
//     (ne change JAMAIS l'état).
// Lecture sur les OCTETS : une ligne illisible (JSON invalide ou UTF-8 invalide) n'est tolérée que
// si une ligne `reparation` ULTÉRIEURE la désigne (index + SHA-256 de ses octets bruts) ; sinon
// « corrompu ». Une fin de fichier sans « \n » = « tronqué ». Rien n'est jamais effacé.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class RefusVerrou extends Error {
  constructor(message, etat = null) { super(message); this.name = 'RefusVerrou'; this.etat = etat; }
}

const EVENEMENTS = ['envoi', 'accepte', 'refuse', 'inconnu', 'libere'];
const TRANSITIONS = Object.freeze({
  null: { envoi: ['declencher'] },
  refuse: { envoi: ['declencher'] },
  libere: { envoi: ['declencher'] },
  envoi: { accepte: ['declencher', 'etat'], refuse: ['declencher'], inconnu: ['declencher'], libere: ['liberer'] },
  inconnu: { accepte: ['etat'], libere: ['liberer'] },
  accepte: {}, // TERMINAL
});
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const chemins = (dossier, setId) => {
  if (!/^set_fonda_[a-z0-9-]+_n[IF]_\d{2}$/.test(setId || '')) throw new RefusVerrou(`set_id invalide : ${setId}`);
  const journal = path.join(dossier, `${setId}.generation`);
  return { journal, verrou: `${journal}.verrou` };
};

// --- Lecture du journal (pure, sur octets) ----------------------------------------------------
function utf8Valide(buf) { return Buffer.from(buf.toString('utf8'), 'utf8').equals(buf); }
function decouper(octets) {
  const lignes = [];
  let debut = 0;
  for (let i = 0; i < octets.length; i += 1) if (octets[i] === 0x0a) { lignes.push(octets.subarray(debut, i)); debut = i + 1; }
  return { lignes, reste: octets.subarray(debut) };
}
function ligneValide(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1) return false;
  const aEvt = 'evt' in o; const aAdmin = 'admin' in o;
  if (aEvt === aAdmin) return false; // familles EXCLUSIVES
  if (typeof o.le !== 'string' || !DATE.test(o.le)) return false;
  if (aEvt) return EVENEMENTS.includes(o.evt) && typeof o.par === 'string';
  return o.admin === 'reparation' && Number.isInteger(o.fragment_ligne) && o.fragment_ligne >= 0 && /^[0-9a-f]{64}$/.test(o.fragment_sha256);
}
// -> { etat, tronque, corrompu, raison, dernier, tentatives, illisibles }
function analyser(octets) {
  const res = { etat: null, tronque: false, corrompu: false, raison: null, dernier: null, tentatives: 0, illisibles: [] };
  if (octets === null || octets.length === 0) return res;
  const { lignes, reste } = decouper(octets);
  if (reste.length) { res.tronque = true; res.raison = 'dernière ligne tronquée (pas de fin de ligne)'; }
  const lues = lignes.map((b, i) => {
    let o = null;
    if (utf8Valide(b)) { try { o = JSON.parse(b.toString('utf8')); } catch { o = null; } }
    return { i, b, o: o !== null && ligneValide(o) ? o : null, brut: o };
  });
  const couverts = new Set();
  for (const l of lues) {
    if (l.o && l.o.admin === 'reparation' && l.o.fragment_ligne < l.i) {
      const cible = lues[l.o.fragment_ligne];
      if (!cible.o && sha256(cible.b) === l.o.fragment_sha256) couverts.add(cible.i);
    }
  }
  let etat = null;
  for (const l of lues) {
    if (!l.o) {
      if (!couverts.has(l.i)) { res.illisibles.push(l.i); res.corrompu = true; res.raison = `ligne ${l.i + 1} illisible ou malformée, non réparée`; }
      continue;
    }
    if (l.o.admin) continue;
    const admis = TRANSITIONS[String(etat)] || {};
    if (!admis[l.o.evt] || !admis[l.o.evt].includes(l.o.par)) { res.corrompu = true; res.raison = `ligne ${l.i + 1} : transition ${etat} -> ${l.o.evt} (par ${l.o.par}) interdite`; continue; }
    etat = l.o.evt;
    res.dernier = l.o;
    if (l.o.evt === 'envoi') res.tentatives += 1;
  }
  res.etat = etat;
  return res;
}

function lireOctets(p) {
  try { return fs.readFileSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
// Écriture COMPLÈTE (les écritures courtes sont reprises jusqu'au dernier octet), puis fsync.
function ecrireTout(fd, buf, ecrire = fs.writeSync) {
  let fait = 0;
  while (fait < buf.length) {
    const n = ecrire(fd, buf, fait, buf.length - fait);
    if (!Number.isInteger(n) || n <= 0) throw new Error('écriture du journal impossible (0 octet écrit)');
    fait += n;
  }
  fs.fsyncSync(fd);
}
function ajouterOctets(p, buf, { creer = false, ecrire } = {}) {
  const fd = fs.openSync(p, creer ? 'wx' : 'a');
  try { ecrireTout(fd, buf, ecrire); } finally { fs.closeSync(fd); }
}
const ligne = (objet) => Buffer.from(`${JSON.stringify({ v: 1, ...objet })}\n`, 'utf8');

// --- Exclusion (verrou noyau tenu par la CLI) ---------------------------------------------------
async function sousVerrou(dossier, setId, fn, deps) {
  const c = chemins(dossier, setId);
  if (deps.sousVerrou !== c.verrou) throw new RefusVerrou(`${setId} : commande exécutée HORS du verrou noyau (lockf ${path.basename(c.verrou)}) — passer par la CLI`);
  return fn(c);
}
function relire(c, setId) {
  const a = analyser(lireOctets(c.journal)); // RELECTURE sous verrou, jamais une observation antérieure
  if (a.tronque || a.corrompu) throw new RefusVerrou(`${setId} : journal du verrou ${a.tronque ? 'tronqué' : 'corrompu'} (${a.raison}) — --reparer`, a.etat);
  return a;
}
function transition(c, a, evt, par, deps, extra = {}) {
  const admis = TRANSITIONS[String(a.etat)] || {};
  if (!admis[evt] || !admis[evt].includes(par)) throw new RefusVerrou(`transition ${a.etat} -> ${evt} (par ${par}) interdite`, a.etat);
  const horloge = deps.horloge || (() => new Date());
  ajouterOctets(c.journal, ligne({ evt, le: horloge().toISOString(), par, ...extra }), { creer: lireOctets(c.journal) === null, ecrire: deps.ecrire });
  a.etat = evt;
}
// Observation : DEUX entiers ≥ 0 explicites, sinon refus (jamais « absence = zéro »).
async function observer(L, setId) {
  const executions = await L.executionsDuSetId(setId);
  const candidats = await L.candidatsDuSetId(setId);
  for (const [nom, v] of [['exécutions', executions], ['candidats', candidats]]) {
    if (!Number.isInteger(v) || v < 0) throw new RefusVerrou(`${setId} : observation des ${nom} indisponible ou invalide (${String(v)}) — rien n'est décidé`);
  }
  return { executions, candidats };
}

const MESSAGE_ETAT = {
  accepte: 'génération déjà ACCEPTÉE pour ce set_id (état terminal) : jamais de second déclenchement',
  envoi: 'envoi précédent SANS résultat (interrompu) : état indéterminé — observer avec --etat',
  inconnu: 'réponse précédente INCONNUE : observer avec --etat, puis --liberer si rien n\'est observé',
};

// --- Commandes -------------------------------------------------------------------------------
// deps : { verrous, sousVerrou, lecture: { reservation(setId, ref) -> { ok, raison }, idsLocaux() ->
//          [set_id], executionsDuSetId(setId) -> entier, candidatsDuSetId(setId) -> entier },
//          envoyer(corps) -> { statut } (lève si transport en échec), horloge?, ecrire? }
async function declencher(setId, ref, deps) {
  return sousVerrou(deps.verrous, setId, async (c) => {
    const L = deps.lecture;
    // (a) Contrôles EN LECTURE, avant toute écriture au journal (C8).
    const r = await L.reservation(setId, ref);
    if (!r || r.ok !== true) throw new RefusVerrou(`réservation : ${(r && r.raison) || 'non vérifiée'}`);
    const ids = await L.idsLocaux();
    if (!Array.isArray(ids)) throw new RefusVerrou('fichiers locaux : lecture invalide');
    if (ids.includes(setId)) throw new RefusVerrou(`${setId} : déjà porté par un fichier local (calibration, lot ou catalogue) — promouvable, pas régénérable`);
    const obs = await observer(L, setId);
    if (obs.executions !== 0) throw new RefusVerrou(`${setId} : ${obs.executions} exécution(s) n8n portent déjà ce set_id`);
    if (obs.candidats !== 0) throw new RefusVerrou(`${setId} : ${obs.candidats} candidat(s) déjà dans candidats/`);
    // (b) État relu sous verrou, un seul envoi.
    const a = relire(c, setId);
    if (a.etat !== null && a.etat !== 'refuse' && a.etat !== 'libere') throw new RefusVerrou(`${setId} : ${MESSAGE_ETAT[a.etat]}`, a.etat);
    transition(c, a, 'envoi', 'declencher', deps, { tentative: a.tentatives + 1 }); // écrit EN ENTIER + fsync AVANT le POST
    let statut;
    try { statut = (await deps.envoyer({ set_id: setId, ref })).statut; } catch { statut = null; }
    const issue = statut === 202 ? 'accepte' : statut === 400 ? 'refuse' : 'inconnu';
    transition(c, a, issue, 'declencher', deps, { statut });
    return { issue, statut, consigne: issue === 'inconnu' ? 'NE PAS renvoyer : observer avec --etat' : null };
  }, deps);
}

async function etat(setId, deps) {
  return sousVerrou(deps.verrous, setId, async (c) => {
    const a = relire(c, setId);
    const obs = await observer(deps.lecture, setId);
    if ((a.etat === 'envoi' || a.etat === 'inconnu') && (obs.executions > 0 || obs.candidats > 0)) transition(c, a, 'accepte', 'etat', deps, { observe: obs });
    return { etat: a.etat, observe: obs };
  }, deps);
}

async function liberer(setId, motif, deps) {
  if (typeof motif !== 'string' || !motif.trim()) throw new RefusVerrou('--liberer : --motif requis');
  const horloge = deps.horloge || (() => new Date());
  const delaiMs = deps.delaiPrudenceMs ?? 15 * 60 * 1000;
  return sousVerrou(deps.verrous, setId, async (c) => {
    const a = relire(c, setId);
    if (a.etat !== 'envoi' && a.etat !== 'inconnu') throw new RefusVerrou(`${setId} : état ${a.etat} — rien à libérer`, a.etat);
    // Hypothèse documentée : horloge civile STABLE. Un événement daté dans le futur est refusé.
    const age = horloge() - new Date(a.dernier.le);
    if (age < 0) throw new RefusVerrou(`${setId} : dernier événement daté dans le futur (horloge incohérente) — traitement manuel`, a.etat);
    if (!(age >= delaiMs)) throw new RefusVerrou(`${setId} : délai de prudence non écoulé (${Math.round(age / 1000)} s < ${delaiMs / 1000} s)`, a.etat);
    const obs = await observer(deps.lecture, setId);
    if (obs.executions !== 0 || obs.candidats !== 0) throw new RefusVerrou(`${setId} : exécution ou candidat observé — utiliser --etat (accepte), jamais --liberer`, a.etat);
    transition(c, a, 'libere', 'liberer', deps, { motif: motif.trim(), observe: obs });
    return { etat: 'libere' };
  }, deps);
}

// --reparer : SOUS LE MÊME VERROU NOYAU (deux réparateurs ne coexistent jamais). Idempotent :
// une interruption à n'importe quelle étape se reprend en relançant la commande.
async function reparer(setId, deps) {
  const horloge = deps.horloge || (() => new Date());
  return sousVerrou(deps.verrous, setId, async (c) => {
    const actions = [];
    let octets = lireOctets(c.journal);
    if (octets && octets.length && octets[octets.length - 1] !== 0x0a) {
      ajouterOctets(c.journal, Buffer.from('\n'), { ecrire: deps.ecrire });
      octets = lireOctets(c.journal);
      actions.push('fin de ligne ajoutée après le fragment tronqué (fragment conservé)');
    }
    const a = analyser(octets);
    const { lignes } = decouper(octets || Buffer.alloc(0));
    for (const i of a.illisibles) {
      ajouterOctets(c.journal, ligne({ admin: 'reparation', le: horloge().toISOString(), fragment_ligne: i, fragment_sha256: sha256(lignes[i]), motif: 'ligne illisible : conservée, ignorée à la lecture' }), { ecrire: deps.ecrire });
      actions.push(`ligne ${i + 1} désignée comme fragment réparé`);
    }
    const apres = analyser(lireOctets(c.journal));
    if (apres.tronque || apres.corrompu) throw new RefusVerrou(`${setId} : journal encore ${apres.tronque ? 'tronqué' : 'corrompu'} après réparation (${apres.raison}) — traitement manuel`);
    return { etat: apres.etat, actions, consigne: apres.etat === 'envoi' || apres.etat === 'inconnu' ? 'état indéterminé : observer avec --etat' : null };
  }, deps);
}

function lireEtat(setId, verrous) { return analyser(lireOctets(chemins(verrous, setId).journal)); }

module.exports = { RefusVerrou, TRANSITIONS, analyser, declencher, etat, liberer, reparer, lireEtat, chemins, sha256, ecrireTout };
