// Verrou « UN SEUL ÉCRIVAIN » du parcours page (pilier 2, CDC §21.12, P5-1) — Mac d'Éric seulement
// (PRÉCONDITION §21.12.1 : plusieurs ordinateurs = hors périmètre). Socle commun du CLI qui écrit
// (ecrire-relecture.js, P5-2) et du CLI qui signe (cloturer-page.js, P5-3).
//
// EXCLUSION (§21.12.3 a) — portée tranchée en P5-1 : UN verrou noyau UNIQUE `relecture.verrou` (tous
// les lots). Il satisfait la garantie « même lot » et donne, du même coup, l'exclusion GLOBALE du
// journal commun (initialisation, réparation, chaque ajout : §21.12.4). Node ouvre le fichier puis fait
// poser le flock BSD sur CE descripteur par `/usr/bin/lockf -s -t 0 3` (mode descripteur, précédent :
// declencher-generation.js) : le verrou appartient à la description de fichier détenue par Node, lockf
// se termine aussitôt, aucun superviseur ; libéré par le noyau à la mort du processus (kill -9 compris).
// Commande concurrente : refus immédiat (code 75). Chemin CANONIQUE (realpath du dossier) commun aux
// deux CLI, indépendant du checkout ; le fichier verrou n'est jamais supprimé ni recréé.
//
// JOURNAL `relecture.journal` (§21.12.4) — « journal d'abord » : la ligne `envoi` (preuves comprises)
// est écrite EN ENTIER puis fsync AVANT le POST. Ajout seul, une ligne JSON par événement, lue sur les
// OCTETS ; rien n'est jamais effacé ni réécrit ; aucune relance automatique. SCHÉMA FERMÉ : chaque type
// a un ensemble EXACT de clés et de types ; toute autre clé = ligne illisible. Il régit UNIQUEMENT ce
// que le journal persiste (§21.12.6) : aucune réponse ni erreur brute, aucun texte libre.
//
// MACHINE À ÉTATS PROPRE À P5 (pas celle de verrou-generation.js) — par TENTATIVE :
//   envoi -> accepte | refuse_sans_effet            (terminaux)
//   envoi -> indetermine                            (non terminal)
//   envoi | indetermine -> resolution(effet_conforme | sans_effet | anomalie)   (diagnostic seul)
// Un `envoi` sans issue enregistrée (mort du CLI) vaut `indetermine`. Par LOT : `libre` (aucune tentative
// ouverte), `ouverte` (refus temporaire), `bloque` (anomalie ou portion perdue : définitif, sortie = abandon
// logique, nouveau set_id). `accepte` n'est pas terminal pour le LOT : d'autres opérations peuvent suivre.
//
// RATTACHEMENT SANS HORLOGE (§21.12.4) : l'`envoi` consigne l'ensemble des exécutions PRÉEXISTANTES du
// workflow visé pour ce set_id (listing complet, sous le verrou) ; le diagnostic exige EXACTEMENT UNE
// exécution absente de cet ensemble. Aucune date ne sert à exclure une exécution (§10).
//
// RÉPARATION : l'original est copié intact avant tout ajout ; les lignes illisibles restent en place et
// sont DÉSIGNÉES par une ligne `reparation` (index + SHA-256) portant les set_id récupérables. Une portion
// perdue BLOQUE les lots qu'elle concerne ; si aucun set_id n'est récupérable, TOUS les lots sont bloqués
// (incident) jusqu'à une ligne `attribution` (Éric désigne les lots concernés). Une réparation ne prouve
// jamais qu'aucune tentative n'a eu lieu.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

class RefusRelecture extends Error {
  constructor(message) { super(message); this.name = 'RefusRelecture'; }
}

const LOCKF = '/usr/bin/lockf';
const OCCUPE = 75; // EX_TEMPFAIL de lockf -t 0
const VERROUS_PAR_DEFAUT = path.join(os.homedir(), 'FONDA-clotures', 'verrous');
const SCHEMA = 'journal-relecture/v1';

const RE = Object.freeze({
  setId: /^set_fonda_[a-z0-9-]+_n[IF]_\d{2}$/,
  setIdGlobal: /set_fonda_[a-z0-9-]+_n[IF]_\d{2}/g,
  date: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  tentative: /^[0-9a-f]{32}$/,
  fichier: /^[A-Za-z0-9_-]{10,128}$/,
  version: /^[0-9]{1,20}$/,
  execution: /^[0-9]{1,20}$/,
  sha: /^[0-9a-f]{64}$/,
});
const COMMANDES = Object.freeze({ emission: 'emettre', reemission: 'emettre', cloture_technique: 'cloturer' });
const STATUTS_CANDIDAT = ['en_attente', 'clos', 'abandonne'];
const STATUTS_TERMINAUX = ['success', 'error', 'crashed', 'canceled'];
const MOTIFS_INDETERMINE = ['delai', 'transport', 'reponse_illisible', 'reponse_non_conforme', 'erreur_apres_ecriture', 'ecart_version'];
const ISSUES_RESOLUTION = ['effet_conforme', 'sans_effet', 'anomalie'];

// --- Schéma fermé -----------------------------------------------------------------------------
const estDate = (v) => typeof v === 'string' && RE.date.test(v) && new Date(Date.parse(v)).toISOString() === v;
const entierOuNul = (v) => v === null || (Number.isSafeInteger(v) && v >= 1);
const T = {
  date: estDate,
  setId: (v) => typeof v === 'string' && RE.setId.test(v),
  tentative: (v) => typeof v === 'string' && RE.tentative.test(v),
  commande: (v) => Object.prototype.hasOwnProperty.call(COMMANDES, v),
  workflow: (v) => v === 'emettre' || v === 'cloturer',
  execution: (v) => typeof v === 'string' && RE.execution.test(v),
  executionOuNul: (v) => v === null || (typeof v === 'string' && RE.execution.test(v)),
  statutExecution: (v) => v === null || STATUTS_TERMINAUX.includes(v),
  candidat: (v) => exactes(v, ['fichier_id', 'version', 'generation_cle', 'statut', 'clos_le'])
    && (v.fichier_id === null || (typeof v.fichier_id === 'string' && RE.fichier.test(v.fichier_id)))
    && (v.version === null || (typeof v.version === 'string' && RE.version.test(v.version)))
    && entierOuNul(v.generation_cle) && (v.statut === null || STATUTS_CANDIDAT.includes(v.statut))
    && (v.clos_le === null || estDate(v.clos_le)),
  attendu: (v) => exactes(v, ['fichier_id', 'generation_cle', 'statut'])
    && (v.fichier_id === null || (typeof v.fichier_id === 'string' && RE.fichier.test(v.fichier_id)))
    && Number.isSafeInteger(v.generation_cle) && v.generation_cle >= 1 && STATUTS_CANDIDAT.includes(v.statut),
  ids: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && RE.execution.test(x))
    && v.every((x, i) => i === 0 || BigInt(v[i - 1]) < BigInt(x)), // triés, uniques
  reponse: (v) => exactes(v, ['generation_cle', 'statut', 'version', 'deja_clos'])
    && entierOuNul(v.generation_cle) && (v.statut === null || STATUTS_CANDIDAT.includes(v.statut))
    && (v.version === null || (typeof v.version === 'string' && RE.version.test(v.version)))
    && (v.deja_clos === null || typeof v.deja_clos === 'boolean'),
  http: (v) => v === null || (Number.isInteger(v) && v >= 100 && v <= 599),
  motif: (v) => MOTIFS_INDETERMINE.includes(v),
  issue: (v) => ISSUES_RESOLUTION.includes(v),
  ligne: (v) => Number.isInteger(v) && v >= 0,
  sha: (v) => typeof v === 'string' && RE.sha.test(v),
  setIdsOuNul: (v) => v === null || (Array.isArray(v) && v.length > 0 && v.every((x) => T.setId(x)) && new Set(v).size === v.length),
  setIds: (v) => Array.isArray(v) && v.length > 0 && v.every((x) => T.setId(x)) && new Set(v).size === v.length,
  schema: (v) => v === SCHEMA,
};
const SCHEMAS = Object.freeze({
  init: { le: 'date', schema: 'schema' },
  envoi: { le: 'date', set_id: 'setId', tentative_id: 'tentative', commande: 'commande', workflow: 'workflow', avant: 'candidat', preexistantes: 'ids', attendu: 'attendu' },
  accepte: { le: 'date', set_id: 'setId', tentative_id: 'tentative', reponse: 'reponse' },
  refuse_sans_effet: { le: 'date', set_id: 'setId', tentative_id: 'tentative', http: 'http' },
  indetermine: { le: 'date', set_id: 'setId', tentative_id: 'tentative', motif: 'motif' },
  resolution: { le: 'date', set_id: 'setId', tentative_id: 'tentative', issue: 'issue', execution_id: 'executionOuNul', execution_statut: 'statutExecution', apres: 'candidat' },
  reparation: { le: 'date', ligne: 'ligne', sha256: 'sha', set_ids: 'setIdsOuNul' },
  attribution: { le: 'date', ligne: 'ligne', sha256: 'sha', set_ids: 'setIds' },
});
function exactes(o, cles) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || Object.getPrototypeOf(o) !== Object.prototype) return false;
  const k = Object.keys(o);
  return k.length === cles.length && cles.every((c) => Object.prototype.hasOwnProperty.call(o, c));
}
function ligneValide(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1 || !Object.prototype.hasOwnProperty.call(SCHEMAS, o.type)) return false;
  const s = SCHEMAS[o.type];
  if (!exactes(o, ['v', 'type', ...Object.keys(s)])) return false;
  return Object.entries(s).every(([c, t]) => T[t](o[c]));
}

// --- Lecture pure, sur octets -----------------------------------------------------------------
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const utf8Valide = (b) => Buffer.from(b.toString('utf8'), 'utf8').equals(b);
function decouper(octets) {
  const lignes = [];
  let debut = 0;
  for (let i = 0; i < octets.length; i += 1) if (octets[i] === 0x0a) { lignes.push(octets.subarray(debut, i)); debut = i + 1; }
  return { lignes, reste: octets.subarray(debut) };
}
const setIdsRecuperables = (b) => {
  const vus = [...new Set(b.toString('latin1').match(RE.setIdGlobal) || [])];
  return vus.length ? vus.sort() : null;
};

// -> { sain, raison, illisibles, lots: { set_id: { etat, ouverte, blocage } }, tentatives, pertesNonAttribuees }
function analyser(octets) {
  const res = { sain: false, raison: null, illisibles: [], tronque: false, lots: {}, tentatives: {}, pertesNonAttribuees: [] };
  if (octets === null) { res.raison = 'journal absent (initialiser une seule fois, sinon traitement manuel)'; return res; }
  if (octets.length === 0) { res.raison = 'journal vide'; return res; }
  const { lignes, reste } = decouper(octets);
  if (reste.length) { res.tronque = true; res.raison = 'dernière ligne tronquée (réparer)'; }
  const lues = lignes.map((b, i) => {
    let o = null;
    if (utf8Valide(b)) { try { o = JSON.parse(b.toString('utf8')); } catch { o = null; } }
    return { i, b, o: o !== null && ligneValide(o) ? o : null };
  });
  // Désignations : une `reparation` (puis éventuellement une `attribution`) ULTÉRIEURE, même SHA-256.
  const pertes = new Map(); // index -> { setIds | null }
  for (const l of lues) {
    if (!l.o || (l.o.type !== 'reparation' && l.o.type !== 'attribution') || l.o.ligne >= l.i) continue;
    const cible = lues[l.o.ligne];
    if (cible.o || sha256(cible.b) !== l.o.sha256) continue;
    if (l.o.type === 'reparation' && !pertes.has(cible.i)) pertes.set(cible.i, { setIds: l.o.set_ids });
    if (l.o.type === 'attribution' && pertes.has(cible.i) && pertes.get(cible.i).setIds === null) pertes.set(cible.i, { setIds: l.o.set_ids, attribuee: true });
  }
  const lot = (s) => (res.lots[s] ||= { etat: 'libre', ouverte: null, blocage: null, tentatives: 0 });
  const corrompre = (raison) => { if (!res.raison || res.tronque) res.raison = raison; res.corrompu = true; };
  const orphelines = [];
  lues.forEach((l) => {
    if (!l.o) {
      if (!pertes.has(l.i)) { res.illisibles.push(l.i); corrompre(`ligne ${l.i + 1} illisible ou hors schéma, non réparée`); }
      return;
    }
    const o = l.o;
    if (l.i === 0 && o.type !== 'init') return corrompre('ligne 1 : en-tête `init` attendu');
    if (o.type === 'init') { if (l.i !== 0) corrompre(`ligne ${l.i + 1} : \`init\` en double`); return; }
    if (o.type === 'reparation' || o.type === 'attribution') return;
    const t = res.tentatives[o.tentative_id];
    if (o.type === 'envoi') {
      const L = lot(o.set_id);
      if (t) return corrompre(`ligne ${l.i + 1} : tentative en double`);
      if (L.etat !== 'libre') return corrompre(`ligne ${l.i + 1} : envoi sur un lot ${L.etat}`);
      if (!attenduCoherent(o.commande, o.workflow, o.avant, o.attendu)) return corrompre(`ligne ${l.i + 1} : envoi incohérent`);
      res.tentatives[o.tentative_id] = { set_id: o.set_id, etat: 'envoi', commande: o.commande, workflow: o.workflow, avant: o.avant, preexistantes: o.preexistantes, attendu: o.attendu };
      L.etat = 'ouverte'; L.ouverte = o.tentative_id; L.tentatives += 1;
      return;
    }
    if (!t) { orphelines.push({ i: l.i, set_id: o.set_id }); return; }
    if (t.set_id !== o.set_id) return corrompre(`ligne ${l.i + 1} : set_id ≠ tentative`);
    const admis = { accepte: ['envoi'], refuse_sans_effet: ['envoi'], indetermine: ['envoi'], resolution: ['envoi', 'indetermine'] }[o.type];
    if (!admis.includes(t.etat)) return corrompre(`ligne ${l.i + 1} : transition ${t.etat} -> ${o.type} interdite`);
    const L = lot(o.set_id);
    t.etat = o.type === 'resolution' ? `resolution:${o.issue}` : o.type;
    if (o.type === 'indetermine') return;
    if (o.type === 'resolution' && o.issue === 'anomalie') { L.etat = 'bloque'; L.blocage = 'anomalie'; L.ouverte = null; return; }
    if (L.etat === 'ouverte' && L.ouverte === o.tentative_id) { L.etat = 'libre'; L.ouverte = null; }
  });
  // Portions perdues : les lots concernés sont BLOQUÉS ; sans set_id récupérable, blocage de TOUS.
  for (const [i, p] of pertes) {
    if (p.setIds === null) { res.pertesNonAttribuees.push(i); continue; }
    for (const s of p.setIds) { const L = lot(s); L.etat = 'bloque'; L.blocage = L.blocage || 'perte'; L.ouverte = null; }
  }
  // Ligne d'issue sans son envoi : tolérée seulement si une perte couvre ce lot (l'envoi est la portion perdue).
  for (const o of orphelines) {
    const couvert = res.pertesNonAttribuees.length > 0 || (res.lots[o.set_id] && res.lots[o.set_id].blocage === 'perte');
    if (!couvert) corrompre(`ligne ${o.i + 1} : issue d'une tentative inconnue`);
  }
  res.sain = !res.tronque && !res.corrompu;
  if (res.sain) res.raison = null;
  return res;
}

function attenduCoherent(commande, workflow, avant, attendu) {
  if (COMMANDES[commande] !== workflow) return false;
  try { return JSON.stringify(attenduPour(commande, avant)) === JSON.stringify(attendu); } catch { return false; }
}
// Issue attendue PROPRE À LA COMMANDE (§21.12.4) ; refuse les pré-conditions impossibles.
function attenduPour(commande, avant) {
  const absent = avant.fichier_id === null && avant.version === null && avant.generation_cle === null && avant.statut === null && avant.clos_le === null;
  if (commande === 'emission') {
    if (!absent) throw new RefusRelecture('émission : un candidat existe déjà pour ce lot');
    return { fichier_id: null, generation_cle: 1, statut: 'en_attente' };
  }
  if (absent || avant.fichier_id === null || avant.version === null || avant.generation_cle === null || avant.statut === null) throw new RefusRelecture(`${commande} : candidat absent ou incomplet`);
  if (commande === 'reemission') {
    if (avant.statut !== 'en_attente') throw new RefusRelecture('réémission : candidat non en_attente');
    return { fichier_id: avant.fichier_id, generation_cle: avant.generation_cle + 1, statut: 'en_attente' };
  }
  if (avant.statut === 'abandonne') throw new RefusRelecture('clôture technique : candidat abandonné');
  return { fichier_id: avant.fichier_id, generation_cle: avant.generation_cle, statut: 'clos' };
}

// --- Projections : seuls les champs du schéma fermé sont lus ; aucune valeur rejetée n'est répétée.
function projeterCandidat(c) {
  if (c === null) return { fichier_id: null, version: null, generation_cle: null, statut: null, clos_le: null };
  if (!c || typeof c !== 'object') throw new RefusRelecture('candidat : forme invalide');
  const p = { fichier_id: c.fichier_id ?? null, version: c.version ?? null, generation_cle: c.generation_cle ?? null, statut: c.statut ?? null, clos_le: c.clos_le ?? null };
  if (!T.candidat(p)) throw new RefusRelecture('candidat : champ hors schéma (valeur non répétée)');
  return p;
}
function projeterReponse(r) {
  if (!r || typeof r !== 'object') throw new RefusRelecture('réponse : forme invalide');
  const p = { generation_cle: r.generation_cle ?? null, statut: r.statut ?? null, version: r.version ?? null, deja_clos: r.deja_clos ?? null };
  if (!T.reponse(p)) throw new RefusRelecture('réponse : champ hors schéma (valeur non répétée)');
  return p;
}
function projeterExecutions(liste) {
  if (!Array.isArray(liste)) throw new RefusRelecture('exécutions : liste attendue');
  return liste.map((e) => {
    if (!e || typeof e !== 'object' || !T.execution(e.id)) throw new RefusRelecture('exécution : identifiant hors schéma (valeur non répétée)');
    const setId = T.setId(e.set_id) ? e.set_id : null; // entrée illisible -> candidate ambiguë
    const workflow = T.workflow(e.workflow) ? e.workflow : null;
    return { id: e.id, set_id: setId, workflow, statut: typeof e.statut === 'string' ? e.statut : null };
  });
}
const exigerSetId = (s) => { if (!T.setId(s)) throw new RefusRelecture('set_id invalide (valeur non répétée)'); };

// --- Fichiers ----------------------------------------------------------------------------------
function chemins(dossier) {
  let d;
  try { d = fs.realpathSync(dossier); } catch { throw new RefusRelecture('dossier des verrous introuvable'); }
  return { dossier: d, verrou: path.join(d, 'relecture.verrou'), journal: path.join(d, 'relecture.journal') };
}
function lireOctets(p) {
  try { return fs.readFileSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function ecrireTout(fd, buf, ecrire = fs.writeSync) {
  let fait = 0;
  while (fait < buf.length) {
    const n = ecrire(fd, buf, fait, buf.length - fait);
    if (!Number.isInteger(n) || n <= 0) throw new RefusRelecture('écriture du journal impossible (0 octet écrit)');
    fait += n;
  }
  fs.fsyncSync(fd);
}
function ajouterOctets(p, buf, { creer = false, ecrire } = {}) {
  const fd = fs.openSync(p, creer ? 'wx' : 'a', 0o600);
  try { ecrireTout(fd, buf, ecrire); } finally { fs.closeSync(fd); }
  if (creer) { const d = fs.openSync(path.dirname(p), 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); } }
}
function serialiser(type, champs) {
  const o = { v: 1, type, ...champs };
  if (!ligneValide(o)) throw new RefusRelecture(`ligne ${type} hors schéma : rien n'est écrit`);
  return Buffer.from(`${JSON.stringify(o)}\n`, 'utf8');
}

// --- Exclusion ----------------------------------------------------------------------------------
// Verrou pris PAR CE PROCESSUS pour toute sa durée (descripteur jamais fermé : la fin du processus
// le libère). -> { chemin, fd } ; RefusRelecture (code OCCUPE) si tenu ailleurs.
function prendreVerrou(dossier = VERROUS_PAR_DEFAUT, { lockf = LOCKF } = {}) {
  fs.mkdirSync(dossier, { recursive: true, mode: 0o700 });
  const c = chemins(dossier);
  const fd = fs.openSync(c.verrou, 'a', 0o600);
  const r = spawnSync(lockf, ['-s', '-t', '0', '3'], { stdio: ['ignore', 'ignore', 'inherit', fd] });
  if (r.status === 0) return { chemin: c.verrou, fd };
  fs.closeSync(fd);
  const e = new RefusRelecture(r.status === OCCUPE ? 'une autre commande tient le verrou de la relecture — réessayer après' : `verrou noyau impossible (lockf : ${r.error ? r.error.code : `code ${r.status}`})`);
  e.code = r.status === OCCUPE ? OCCUPE : 1;
  throw e;
}
function sousVerrou(deps, fn) {
  const c = chemins(deps.verrous);
  if (deps.sousVerrou !== c.verrou) throw new RefusRelecture('commande exécutée HORS du verrou noyau de la relecture');
  return fn(c);
}
function relireSain(c) {
  const a = analyser(lireOctets(c.journal)); // RELECTURE sous verrou, jamais une observation antérieure
  if (!a.sain) throw new RefusRelecture(`journal de la relecture inutilisable : ${a.raison} — aucune écriture ni signature`);
  return a;
}
const maintenant = (deps) => (deps.horloge || (() => new Date()))().toISOString();
const exigerLotLibre = (a, setId) => {
  if (a.pertesNonAttribuees.length) throw new RefusRelecture('portion perdue du journal sans lot attribué : TOUS les lots sont bloqués (incident)');
  const L = a.lots[setId];
  if (L && L.etat === 'ouverte') throw new RefusRelecture(`${setId} : tentative non résolue — diagnostic requis, jamais de nouvel envoi`);
  if (L && L.etat === 'bloque') throw new RefusRelecture(`${setId} : lot bloqué définitivement (${L.blocage}) — abandon logique, nouveau set_id`);
};

// Quiescence (§21.12.3 b) : observation EXPLICITE et complète, sinon refus (jamais « absence = zéro »).
function exigerQuiescence(obs) {
  if (!obs || obs.complet !== true || !Number.isInteger(obs.enVol) || obs.enVol < 0) throw new RefusRelecture('quiescence : observation incomplète ou invalide — rien n\'est décidé');
  if (obs.enVol !== 0) throw new RefusRelecture(`quiescence : ${obs.enVol} exécution(s) Emettre/Cloturer en vol`);
}

// --- Commandes (toutes sous le verrou) -----------------------------------------------------------
function initialiser(deps) {
  return sousVerrou(deps, (c) => {
    if (lireOctets(c.journal) !== null) throw new RefusRelecture('journal déjà présent : jamais réinitialisé');
    ajouterOctets(c.journal, serialiser('init', { le: maintenant(deps), schema: SCHEMA }), { creer: true, ecrire: deps.ecrire });
    return { initialise: true };
  });
}

// Journal d'abord : écrit `envoi` (fsync) AVANT le POST et rend le tentative_id.
// donnees = { candidat (objet lu ou null), preexistantes: [ids], listingComplet: true }
function preparerEnvoi(setId, commande, donnees, deps) {
  exigerSetId(setId);
  if (!T.commande(commande)) throw new RefusRelecture('commande inconnue');
  return sousVerrou(deps, (c) => {
    const a = relireSain(c);
    exigerLotLibre(a, setId);
    if (!donnees || donnees.listingComplet !== true) throw new RefusRelecture('exécutions préexistantes : listing incomplet — aucun envoi');
    if (!Array.isArray(donnees.preexistantes) || !donnees.preexistantes.every((x) => T.execution(x))) throw new RefusRelecture('exécutions préexistantes : identifiants hors schéma');
    const preexistantes = [...new Set(donnees.preexistantes)].sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1));
    const avant = projeterCandidat(donnees.candidat);
    const attendu = attenduPour(commande, avant);
    const tentativeId = (deps.aleatoire || (() => crypto.randomBytes(16).toString('hex')))();
    ajouterOctets(c.journal, serialiser('envoi', { le: maintenant(deps), set_id: setId, tentative_id: tentativeId, commande, workflow: COMMANDES[commande], avant, preexistantes, attendu }), { ecrire: deps.ecrire });
    return { tentative_id: tentativeId, attendu };
  });
}

// Issue d'une tentative en `envoi`. issue ∈ accepte (donnees.reponse) | refuse_sans_effet (donnees.http)
// | indetermine (donnees.motif). Une réponse non conforme à l'issue attendue devient `indetermine`.
function conclure(tentativeId, issue, donnees, deps) {
  if (!T.tentative(tentativeId)) throw new RefusRelecture('tentative_id invalide');
  return sousVerrou(deps, (c) => {
    const a = relireSain(c);
    const t = a.tentatives[tentativeId];
    if (!t) throw new RefusRelecture('tentative inconnue');
    if (t.etat !== 'envoi') throw new RefusRelecture(`tentative déjà conclue (${t.etat})`);
    const base = { le: maintenant(deps), set_id: t.set_id, tentative_id: tentativeId };
    let type; let champs;
    if (issue === 'accepte') {
      const r = projeterReponse(donnees && donnees.reponse);
      const conforme = (r.generation_cle === null || r.generation_cle === t.attendu.generation_cle) && (r.statut === null || r.statut === t.attendu.statut)
        && (r.deja_clos === null || t.commande === 'cloture_technique');
      if (conforme) { type = 'accepte'; champs = { ...base, reponse: r }; } else { type = 'indetermine'; champs = { ...base, motif: 'reponse_non_conforme' }; }
    } else if (issue === 'refuse_sans_effet') {
      const http = donnees ? donnees.http ?? null : null;
      if (!T.http(http)) throw new RefusRelecture('code HTTP hors schéma');
      type = 'refuse_sans_effet'; champs = { ...base, http };
    } else if (issue === 'indetermine') {
      if (!T.motif(donnees && donnees.motif)) throw new RefusRelecture('motif d\'indétermination inconnu');
      type = 'indetermine'; champs = { ...base, motif: donnees.motif };
    } else throw new RefusRelecture('issue inconnue');
    ajouterOctets(c.journal, serialiser(type, champs), { ecrire: deps.ecrire });
    return { issue: type };
  });
}

// Diagnostic (seule levée d'une tentative ouverte) : rattachement par EXCLUSION, sans horloge.
// donnees = { executions: [{ id, set_id, workflow, statut }], listingComplet: true, candidat }
function diagnostiquer(tentativeId, donnees, deps) {
  if (!T.tentative(tentativeId)) throw new RefusRelecture('tentative_id invalide');
  return sousVerrou(deps, (c) => {
    const a = relireSain(c);
    const t = a.tentatives[tentativeId];
    if (!t) throw new RefusRelecture('tentative inconnue');
    if (t.etat !== 'envoi' && t.etat !== 'indetermine') throw new RefusRelecture(`tentative non ouverte (${t.etat})`);
    const maintenir = (raison) => ({ leve: false, raison });
    if (!donnees || donnees.listingComplet !== true) return maintenir('listing incomplet');
    const pre = new Set(t.preexistantes);
    const nouvelles = projeterExecutions(donnees.executions)
      .filter((e) => (e.workflow === t.workflow || e.workflow === null) && (e.set_id === t.set_id || e.set_id === null) && !pre.has(e.id));
    if (nouvelles.length === 0) return maintenir('aucune exécution nouvelle (en transit, purgée ou jamais arrivée)');
    if (nouvelles.length > 1) return maintenir(`${nouvelles.length} exécutions nouvelles : ambiguïté`);
    const e = nouvelles[0];
    if (e.set_id === null || e.workflow === null) return maintenir('exécution nouvelle illisible : ambiguïté');
    if (!STATUTS_TERMINAUX.includes(e.statut)) return maintenir('exécution nouvelle encore en vol ou de statut inconnu');
    const apres = projeterCandidat(donnees.candidat);
    const A = t.attendu; const V = t.avant;
    const conforme = apres.statut === A.statut && apres.generation_cle === A.generation_cle
      && (A.fichier_id === null ? apres.fichier_id !== null : apres.fichier_id === A.fichier_id);
    const inchange = apres.fichier_id === V.fichier_id && apres.generation_cle === V.generation_cle && apres.statut === V.statut && apres.clos_le === V.clos_le;
    const issue = conforme ? 'effet_conforme' : (inchange && e.statut !== 'success') ? 'sans_effet' : 'anomalie';
    ajouterOctets(c.journal, serialiser('resolution', { le: maintenant(deps), set_id: t.set_id, tentative_id: tentativeId, issue, execution_id: e.id, execution_statut: e.statut, apres }), { ecrire: deps.ecrire });
    return { leve: true, issue, execution_id: e.id };
  });
}

// Lecture par le CLI qui signe (§21.12.4), sous le verrou, avant `cloturer`.
// -> 'poursuivre' | 'refus_temporaire' | 'abandon' | 'incident'
function decisionSignature(setId, deps) {
  exigerSetId(setId);
  return sousVerrou(deps, (c) => {
    const a = relireSain(c);
    if (a.pertesNonAttribuees.length) return 'incident';
    const L = a.lots[setId];
    if (!L || L.etat === 'libre') return 'poursuivre';
    return L.etat === 'ouverte' ? 'refus_temporaire' : 'abandon';
  });
}

// Réparation administrative (sous le verrou) : original copié intact, rien d'effacé.
function reparer(deps) {
  return sousVerrou(deps, (c) => {
    let octets = lireOctets(c.journal);
    if (octets === null || octets.length === 0) throw new RefusRelecture('journal absent ou vide : rien à réparer — traitement manuel (jamais réinitialisé)');
    const copie = `${c.journal}.original-${sha256(octets)}`;
    const existante = lireOctets(copie);
    if (existante === null) ajouterOctets(copie, octets, { creer: true, ecrire: deps.ecrire });
    else if (!existante.equals(octets)) throw new RefusRelecture('copie de l\'original divergente — traitement manuel');
    const actions = [];
    if (octets[octets.length - 1] !== 0x0a) {
      ajouterOctets(c.journal, Buffer.from('\n'), { ecrire: deps.ecrire });
      octets = lireOctets(c.journal);
      actions.push('fin de ligne ajoutée après le fragment tronqué (fragment conservé)');
    }
    const a = analyser(octets);
    const { lignes } = decouper(octets);
    for (const i of a.illisibles) {
      const setIds = setIdsRecuperables(lignes[i]);
      ajouterOctets(c.journal, serialiser('reparation', { le: maintenant(deps), ligne: i, sha256: sha256(lignes[i]), set_ids: setIds }), { ecrire: deps.ecrire });
      actions.push(setIds ? `ligne ${i + 1} : portion perdue, lots bloqués : ${setIds.join(', ')}` : `ligne ${i + 1} : portion perdue SANS set_id récupérable — tous les lots bloqués jusqu'à attribution`);
    }
    const apres = analyser(lireOctets(c.journal));
    if (!apres.sain) throw new RefusRelecture(`journal encore inutilisable après réparation : ${apres.raison} — traitement manuel`);
    return { actions, copie: path.basename(copie), pertesNonAttribuees: apres.pertesNonAttribuees.map((i) => i + 1) };
  });
}

// Attribution d'une portion perdue sans set_id récupérable aux lots qu'elle a pu concerner (Éric).
function attribuerPerte(numeroLigne, setIds, deps) {
  if (!T.setIds(setIds)) throw new RefusRelecture('set_ids invalides (valeurs non répétées)');
  return sousVerrou(deps, (c) => {
    const octets = lireOctets(c.journal);
    const a = analyser(octets);
    const i = numeroLigne - 1;
    if (!a.sain || !a.pertesNonAttribuees.includes(i)) throw new RefusRelecture('aucune portion perdue non attribuée à cette ligne');
    const { lignes } = decouper(octets);
    ajouterOctets(c.journal, serialiser('attribution', { le: maintenant(deps), ligne: i, sha256: sha256(lignes[i]), set_ids: [...setIds].sort() }), { ecrire: deps.ecrire });
    return { bloques: [...setIds].sort() };
  });
}

function lireEtat(verrous) { return analyser(lireOctets(chemins(verrous).journal)); }

module.exports = {
  RefusRelecture, OCCUPE, VERROUS_PAR_DEFAUT, SCHEMA, SCHEMAS, COMMANDES,
  analyser, ligneValide, attenduPour, chemins, prendreVerrou, exigerQuiescence,
  initialiser, preparerEnvoi, conclure, diagnostiquer, decisionSignature, reparer, attribuerPerte, lireEtat, sha256,
};
