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
// PRÉCONDITION (§21.12.4) : le journal n'est JAMAIS modifié hors de ce module ; restaurer une sauvegarde
// est HORS CONTRAT. Le module détecte un fragment, pas un retour à un état antérieur valide. Filet
// contre l'ACCIDENT seulement (pas une preuve, supprimable à la main) : `initialiser` refuse si le
// témoin `relecture.journal.cree` ou une copie `relecture.journal.original-*` existe.
//
// MACHINE À ÉTATS PROPRE À P5 (pas celle de verrou-generation.js) — par TENTATIVE (arbitrage (A)) :
//   envoi -> refuse_sans_effet          (403 authentification / 404 workflow inactif : AUCUNE exécution)
//   envoi -> indetermine                (délai, transport, autre code)
//   envoi | indetermine -> resolution(effet_conforme | sans_effet | anomalie)   (diagnostic SEUL)
// Les webhooks Emettre et Cloturer répondent en mode `onReceived` : un 200 veut dire « reçu », jamais
// « exécuté ». La tentative reste donc en `envoi` (ouverte) et n'est conclue QUE par le diagnostic, qui
// lit l'exécution rattachée, la SORTIE de son nœud « FONDA Sortie emission » / « FONDA Sortie cloture »
// et le candidat relu. Un `envoi` sans issue (mort du CLI) vaut `indetermine`. Par LOT : `libre`,
// `ouverte` (refus temporaire), `bloque` (anomalie ou portion perdue : définitif, abandon logique).
// QUALIFICATION UNIQUE : l'issue d'une `resolution` est calculée par la MÊME fonction à l'écriture et à
// la RELECTURE ; une ligne dont l'issue ne se recalcule pas depuis ses preuves (avant / attendu /
// statut et sortie de l'exécution / après) rend le journal corrompu.
//
// RATTACHEMENT SANS HORLOGE (§21.12.4) : l'`envoi` consigne l'ensemble des exécutions PRÉEXISTANTES du
// workflow visé pour ce set_id (listing complet, sous le verrou) ; le diagnostic exige EXACTEMENT UNE
// exécution absente de cet ensemble, de statut terminal. Aucune date ne sert à exclure une exécution.
//
// RÉPARATION : l'original est copié intact (fichier temporaire puis renommage atomique) avant tout ajout ;
// les lignes illisibles restent en place et sont DÉSIGNÉES par une ligne `reparation` (index, SHA-256,
// set_id RECALCULÉS depuis le fragment à chaque relecture). RÈGLE DES PERTES (arbitrage P5-1) : un lot
// touché par une portion perdue est BLOQUÉ DÉFINITIVEMENT ; ses lignes ne sont plus vérifiées que pour le
// schéma fermé, la cohérence interne et l'unicité tentative_id -> set_id (leur enchaînement ne peut plus
// rien débloquer) ; les lignes de tous les AUTRES lots restent vérifiées intégralement. Sans set_id
// récupérable, TOUS les lots sont bloqués (incident) jusqu'à une ligne `attribution` (Éric). Une
// réparation ne prouve jamais qu'aucune tentative n'a eu lieu.
//
// PROVENANCE des identifiants (P5-2, P5-3) : `fichier_id`, `version` et ids d'exécution viennent des
// MÉTADONNÉES Drive / n8n, jamais d'un contenu ; la forme d'une clé (64 hexadécimaux) y est refusée.

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
  formeCle: /^[0-9a-fA-F]{64}$/,
  version: /^[0-9]{1,20}$/,
  execution: /^(0|[1-9][0-9]{0,19})$/, // forme décimale CANONIQUE (« 040 » refusé : 040 ≡ 40)
  sha: /^[0-9a-f]{64}$/,
});
const COMMANDES = Object.freeze({ emission: 'emettre', reemission: 'emettre', cloture_technique: 'cloturer' });
const STATUTS_CANDIDAT = ['en_attente', 'clos', 'abandonne'];
const STATUTS_TERMINAUX = ['success', 'error', 'crashed', 'canceled'];
const MOTIFS_INDETERMINE = ['delai', 'transport', 'reponse_illisible', 'erreur_serveur'];
// Refus établis AVANT toute exécution (n8n refuse sans démarrer le workflow) : code HTTP -> motif.
const REFUS_SANS_EXECUTION = Object.freeze({ 403: 'non_autorise', 404: 'workflow_inactif' });
// Sorties RÉELLES des workflows (verbatim : box-fonda-emettre-relecture.json « FONDA Sortie emission »,
// box-fonda-cloturer-relecture.json « FONDA Sortie cloture »). Clés exigées PRÉSENTES ; seules les
// clés persistées sont conservées (relecteur_attribue, nb_decisions_listees, incomplete_search : non).
const SORTIES = Object.freeze({
  emettre: { schema: 'emission-fonda/v1', presentes: ['schema', 'set_id', 'candidat_fichier_id', 'relecteur_attribue', 'generation_cle', 'reemission'], persistees: ['schema', 'set_id', 'candidat_fichier_id', 'generation_cle', 'reemission'] },
  cloturer: { schema: 'cloture-fonda/v1', presentes: ['schema', 'set_id', 'clos_le', 'deja_clos', 'candidat_fichier_id', 'nb_decisions_listees', 'incomplete_search'], persistees: ['schema', 'set_id', 'candidat_fichier_id', 'clos_le', 'deja_clos'] },
});
const ISSUES_RESOLUTION = ['effet_conforme', 'sans_effet', 'anomalie'];

// --- Schéma fermé -----------------------------------------------------------------------------
const estDate = (v) => {
  if (typeof v !== 'string' || !RE.date.test(v)) return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && new Date(t).toISOString() === v; // validateur TOTAL (jamais d'exception)
};
const estFichier = (v) => typeof v === 'string' && RE.fichier.test(v) && !RE.formeCle.test(v);
function exactes(o, cles) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || Object.getPrototypeOf(o) !== Object.prototype) return false;
  const k = Object.keys(o);
  return k.length === cles.length && cles.every((c) => Object.prototype.hasOwnProperty.call(o, c));
}
// Candidat COMPLET ; l'absence établie s'écrit `null` (jamais un objet vide).
const estCandidat = (v) => exactes(v, ['fichier_id', 'version', 'generation_cle', 'statut', 'clos_le'])
  && estFichier(v.fichier_id) && typeof v.version === 'string' && RE.version.test(v.version)
  && Number.isSafeInteger(v.generation_cle) && v.generation_cle >= 1 && STATUTS_CANDIDAT.includes(v.statut)
  && (v.statut === 'clos' ? estDate(v.clos_le) : v.statut === 'en_attente' ? v.clos_le === null : (v.clos_le === null || estDate(v.clos_le)));
// Sortie persistée (forme exacte, selon le schéma).
const estSortie = (v) => {
  if (!v || typeof v !== 'object') return false;
  if (v.schema === SORTIES.emettre.schema) return exactes(v, SORTIES.emettre.persistees) && RE.setId.test(v.set_id) && estFichier(v.candidat_fichier_id)
    && Number.isSafeInteger(v.generation_cle) && v.generation_cle >= 1 && typeof v.reemission === 'boolean';
  if (v.schema === SORTIES.cloturer.schema) return exactes(v, SORTIES.cloturer.persistees) && RE.setId.test(v.set_id) && estFichier(v.candidat_fichier_id)
    && estDate(v.clos_le) && typeof v.deja_clos === 'boolean';
  return false;
};
const T = {
  date: estDate,
  setId: (v) => typeof v === 'string' && RE.setId.test(v),
  tentative: (v) => typeof v === 'string' && RE.tentative.test(v),
  commande: (v) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(COMMANDES, v),
  workflow: (v) => v === 'emettre' || v === 'cloturer',
  execution: (v) => typeof v === 'string' && RE.execution.test(v),
  statutExecution: (v) => STATUTS_TERMINAUX.includes(v),
  candidatOuNul: (v) => v === null || estCandidat(v),
  attendu: (v) => exactes(v, ['fichier_id', 'generation_cle', 'statut', 'clos_le'])
    && (v.fichier_id === null || estFichier(v.fichier_id))
    && Number.isSafeInteger(v.generation_cle) && v.generation_cle >= 1 && STATUTS_CANDIDAT.includes(v.statut)
    && (v.clos_le === null || estDate(v.clos_le)),
  ids: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && RE.execution.test(x))
    && v.every((x, i) => i === 0 || BigInt(v[i - 1]) < BigInt(x)), // triés, uniques
  sortieOuNul: (v) => v === null || estSortie(v),
  httpRefus: (v) => Number.isInteger(v) && Object.prototype.hasOwnProperty.call(REFUS_SANS_EXECUTION, v), // entier STRICT ([403] refusé)
  motif: (v) => MOTIFS_INDETERMINE.includes(v),
  motifRefus: (v) => Object.values(REFUS_SANS_EXECUTION).includes(v),
  issue: (v) => ISSUES_RESOLUTION.includes(v),
  ligne: (v) => Number.isInteger(v) && v >= 0,
  sha: (v) => typeof v === 'string' && RE.sha.test(v),
  setIdsOuNul: (v) => v === null || (Array.isArray(v) && v.length > 0 && v.every((x) => T.setId(x)) && v.every((x, i) => i === 0 || v[i - 1] < x)),
  setIds: (v) => Array.isArray(v) && v.length > 0 && v.every((x) => T.setId(x)) && v.every((x, i) => i === 0 || v[i - 1] < x),
  schema: (v) => v === SCHEMA,
};
const SCHEMAS = Object.freeze({
  init: { le: 'date', schema: 'schema' },
  envoi: { le: 'date', set_id: 'setId', tentative_id: 'tentative', commande: 'commande', workflow: 'workflow', avant: 'candidatOuNul', preexistantes: 'ids', attendu: 'attendu' },
  refuse_sans_effet: { le: 'date', set_id: 'setId', tentative_id: 'tentative', http: 'httpRefus', motif_refus: 'motifRefus' },
  indetermine: { le: 'date', set_id: 'setId', tentative_id: 'tentative', motif: 'motif' },
  resolution: { le: 'date', set_id: 'setId', tentative_id: 'tentative', issue: 'issue', execution_id: 'execution', execution_statut: 'statutExecution', sortie: 'sortieOuNul', apres: 'candidatOuNul' },
  reparation: { le: 'date', ligne: 'ligne', sha256: 'sha', set_ids: 'setIdsOuNul' },
  attribution: { le: 'date', ligne: 'ligne', sha256: 'sha', set_ids: 'setIds' },
});
function ligneValide(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1 || typeof o.type !== 'string' || !Object.prototype.hasOwnProperty.call(SCHEMAS, o.type)) return false;
  const s = SCHEMAS[o.type];
  if (!exactes(o, ['v', 'type', ...Object.keys(s)])) return false;
  if (o.type === 'refuse_sans_effet' && REFUS_SANS_EXECUTION[o.http] !== o.motif_refus) return false;
  return Object.entries(s).every(([c, t]) => T[t](o[c]));
}

// --- Qualification UNIQUE (écriture ET relecture) -----------------------------------------------
// Issue attendue PROPRE À LA COMMANDE ; refuse les pré-conditions impossibles.
function attenduPour(commande, avant) {
  if (commande === 'emission') {
    if (avant !== null) throw new RefusRelecture('émission : un candidat existe déjà pour ce lot');
    return { fichier_id: null, generation_cle: 1, statut: 'en_attente', clos_le: null };
  }
  if (avant === null) throw new RefusRelecture(`${commande} : candidat absent`);
  if (commande === 'reemission') {
    if (avant.statut !== 'en_attente') throw new RefusRelecture('réémission : candidat non en_attente');
    return { fichier_id: avant.fichier_id, generation_cle: avant.generation_cle + 1, statut: 'en_attente', clos_le: null };
  }
  if (avant.statut === 'abandonne') throw new RefusRelecture('clôture technique : candidat abandonné');
  // Clôture : statut clos ; `clos_le` écrit UNE fois (21.5) -> inchangé si déjà clos.
  return { fichier_id: avant.fichier_id, generation_cle: avant.generation_cle, statut: 'clos', clos_le: avant.statut === 'clos' ? avant.clos_le : null };
}
function attenduCoherent(commande, workflow, avant, attendu) {
  if (COMMANDES[commande] !== workflow) return false;
  try { return JSON.stringify(attenduPour(commande, avant)) === JSON.stringify(attendu); } catch { return false; }
}
// Sortie de l'exécution conforme à l'issue attendue (arbitrage : à la lettre).
function sortieConforme(t, s) {
  const A = t.attendu;
  if (s === null || s.set_id !== t.set_id) return false;
  if (t.commande === 'emission') return s.schema === SORTIES.emettre.schema && s.generation_cle === 1 && s.reemission === false;
  if (t.commande === 'reemission') return s.schema === SORTIES.emettre.schema && s.generation_cle === A.generation_cle && s.reemission === true && s.candidat_fichier_id === A.fichier_id;
  return s.schema === SORTIES.cloturer.schema && s.candidat_fichier_id === A.fichier_id && s.deja_clos === (A.clos_le !== null)
    && (A.clos_le === null || s.clos_le === A.clos_le);
}
// Issue d'un diagnostic, recalculée à l'identique à la relecture. Concordance exécution (success) +
// sortie + candidat relu -> effet_conforme ; exécution non-success + candidat inchangé -> sans_effet ;
// tout autre cas -> anomalie. Identité physique vérifiée deux fois (sortie ET candidat relu).
function qualifier(t, executionStatut, sortie, apres) {
  const A = t.attendu; const V = t.avant;
  const conforme = executionStatut === 'success' && sortieConforme(t, sortie) && apres !== null
    && apres.statut === A.statut && apres.generation_cle === A.generation_cle && apres.fichier_id === sortie.candidat_fichier_id
    && (A.fichier_id === null || apres.fichier_id === A.fichier_id)
    && (A.statut !== 'clos' || apres.clos_le === sortie.clos_le);
  if (conforme) return 'effet_conforme';
  const inchange = V === null ? apres === null
    : apres !== null && apres.fichier_id === V.fichier_id && apres.generation_cle === V.generation_cle && apres.statut === V.statut && apres.clos_le === V.clos_le;
  return inchange && executionStatut !== 'success' ? 'sans_effet' : 'anomalie';
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

// -> { sain, raison, illisibles, tronque, lots: { set_id: { etat, ouverte, blocage } }, tentatives, pertesNonAttribuees }
function analyser(octets) {
  const res = { sain: false, raison: null, illisibles: [], tronque: false, corrompu: false, lots: {}, tentatives: {}, pertesNonAttribuees: [] };
  if (octets === null) { res.raison = 'journal absent'; return res; }
  if (octets.length === 0) { res.raison = 'journal vide'; return res; }
  const { lignes, reste } = decouper(octets);
  if (reste.length) { res.tronque = true; res.raison = 'dernière ligne tronquée (réparer)'; }
  const lues = lignes.map((b, i) => {
    let o = null;
    if (utf8Valide(b)) { try { o = JSON.parse(b.toString('utf8')); } catch { o = null; } }
    return { i, b, o: o !== null && ligneValide(o) ? o : null };
  });
  const corrompre = (raison) => { if (!res.corrompu) res.raison = raison; res.corrompu = true; };
  // Désignations : chaque référence administrative est VÉRIFIÉE (ligne antérieure, illisible, même
  // SHA-256, set_id recalculés depuis le fragment, une seule désignation) ; sinon journal corrompu.
  const pertes = new Map(); // index -> { setIds, attribuee }
  for (const l of lues) {
    if (!l.o || (l.o.type !== 'reparation' && l.o.type !== 'attribution')) continue;
    const cible = l.o.ligne < l.i ? lues[l.o.ligne] : null;
    if (!cible || cible.o || sha256(cible.b) !== l.o.sha256) { corrompre(`ligne ${l.i + 1} : désignation administrative incohérente`); continue; }
    const p = pertes.get(cible.i);
    if (l.o.type === 'reparation') {
      if (p) { corrompre(`ligne ${l.i + 1} : portion désignée deux fois`); continue; }
      if (JSON.stringify(l.o.set_ids) !== JSON.stringify(setIdsRecuperables(cible.b))) { corrompre(`ligne ${l.i + 1} : set_id désignés ≠ fragment`); continue; }
      pertes.set(cible.i, { setIds: l.o.set_ids, attribuee: false });
    } else {
      if (!p || p.setIds !== null || p.attribuee) { corrompre(`ligne ${l.i + 1} : attribution sans portion perdue non attribuée`); continue; }
      pertes.set(cible.i, { ...p, setIds: l.o.set_ids, attribuee: true });
    }
  }
  const lot = (s) => (res.lots[s] ||= { etat: 'libre', ouverte: null, blocage: null, tentatives: 0 });
  const TRANS = { refuse_sans_effet: ['envoi'], indetermine: ['envoi'], resolution: ['envoi', 'indetermine'] };
  // Lots touchés par une portion perdue ; une perte sans set_id (ni attribution) les touche TOUS.
  const perdus = new Set();
  let tousPerdus = false;
  for (const [i, p] of pertes) {
    if (p.setIds === null) { res.pertesNonAttribuees.push(i); tousPerdus = true; } else p.setIds.forEach((s) => perdus.add(s));
  }
  const estPerdu = (s) => tousPerdus || perdus.has(s);
  const proprietaire = new Map(); // tentative_id -> set_id : UNICITÉ GLOBALE (tous les lots)
  lues.forEach((l) => {
    if (!l.o) {
      if (!pertes.has(l.i)) { res.illisibles.push(l.i); corrompre(`ligne ${l.i + 1} illisible ou hors schéma, non réparée`); }
      return;
    }
    const o = l.o;
    if (l.i === 0 && o.type !== 'init') return corrompre('ligne 1 : en-tête `init` attendu');
    if (o.type === 'init') { if (l.i !== 0) corrompre(`ligne ${l.i + 1} : \`init\` en double`); return; }
    if (o.type === 'reparation' || o.type === 'attribution') return;
    // Invariants PARTOUT (lots perdus compris) : unicité tentative_id -> set_id, cohérence interne.
    const s0 = proprietaire.get(o.tentative_id);
    if (s0 !== undefined && s0 !== o.set_id) return corrompre(`ligne ${l.i + 1} : tentative_id déjà porté par un autre lot`);
    proprietaire.set(o.tentative_id, o.set_id);
    if (o.type === 'resolution' && o.sortie !== null && o.sortie.set_id !== o.set_id) return corrompre(`ligne ${l.i + 1} : sortie d'un autre lot`);
    if (o.type === 'envoi' && !attenduCoherent(o.commande, o.workflow, o.avant, o.attendu)) return corrompre(`ligne ${l.i + 1} : envoi incohérent`);
    // Lot touché par une perte : bloqué définitivement, enchaînement non vérifié.
    if (estPerdu(o.set_id)) { lot(o.set_id); return; }
    const t = res.tentatives[o.tentative_id];
    if (o.type === 'envoi') {
      const L = lot(o.set_id);
      if (t) return corrompre(`ligne ${l.i + 1} : tentative en double`);
      if (L.etat !== 'libre') return corrompre(`ligne ${l.i + 1} : envoi sur un lot ${L.etat}`);
      res.tentatives[o.tentative_id] = { set_id: o.set_id, etat: 'envoi', commande: o.commande, workflow: o.workflow, avant: o.avant, preexistantes: o.preexistantes, attendu: o.attendu };
      L.etat = 'ouverte'; L.ouverte = o.tentative_id; L.tentatives += 1;
      return;
    }
    if (!t) return corrompre(`ligne ${l.i + 1} : issue d'une tentative inconnue (aucune perte ne couvre ce lot)`);
    if (!TRANS[o.type].includes(t.etat)) return corrompre(`ligne ${l.i + 1} : transition ${t.etat} -> ${o.type} interdite`);
    if (o.type === 'resolution' && (t.preexistantes.includes(o.execution_id) || qualifier(t, o.execution_statut, o.sortie, o.apres) !== o.issue)) return corrompre(`ligne ${l.i + 1} : résolution non conforme à ses preuves`);
    const L = lot(o.set_id);
    t.etat = o.type === 'resolution' ? `resolution:${o.issue}` : o.type;
    if (o.type === 'indetermine') return;
    if (o.type === 'resolution' && o.issue === 'anomalie') { L.etat = 'bloque'; L.blocage = 'anomalie'; L.ouverte = null; return; }
    if (L.etat === 'ouverte' && L.ouverte === o.tentative_id) { L.etat = 'libre'; L.ouverte = null; }
  });
  // Lots perdus : BLOQUÉS (définitif). Une perte non attribuée bloque tout (decisionSignature : incident).
  for (const s of perdus) { const L = lot(s); L.etat = 'bloque'; L.blocage = L.blocage === 'anomalie' ? 'anomalie' : 'perte'; L.ouverte = null; }
  if (tousPerdus) for (const L of Object.values(res.lots)) { L.etat = 'bloque'; L.blocage = L.blocage || 'perte'; L.ouverte = null; }
  res.sain = !res.tronque && !res.corrompu;
  if (res.sain) res.raison = null;
  return res;
}

// --- Projections : seuls les champs du schéma fermé sont lus, chacun PRÉSENT (jamais un null inventé) ;
// aucune valeur rejetée n'est répétée.
const possede = (o, c) => Object.prototype.hasOwnProperty.call(o, c);
function projeterCandidat(c) {
  if (c === null) return null; // ABSENCE établie (listing complet de l'appelant)
  const cles = ['fichier_id', 'version', 'generation_cle', 'statut', 'clos_le'];
  if (!c || typeof c !== 'object' || !cles.every((k) => possede(c, k))) throw new RefusRelecture('candidat incomplet (champ absent) : l\'absence du candidat s\'écrit null');
  const p = Object.fromEntries(cles.map((k) => [k, c[k]]));
  if (!estCandidat(p)) throw new RefusRelecture('candidat hors schéma (valeur non répétée)');
  return p;
}
// Sortie du nœud « FONDA Sortie … » : null si absente (exécution en erreur), d'un autre lot, ou non
// conforme au schéma réel du workflow (clé manquante, type faux) — une telle sortie ne prouve rien.
function projeterSortie(workflow, setId, s) {
  const d = SORTIES[workflow];
  if (!s || typeof s !== 'object' || s.schema !== d.schema || !d.presentes.every((k) => possede(s, k))) return null;
  if (s.set_id !== setId) return null; // sortie d'un AUTRE lot : ne prouve rien pour celui-ci (jamais persistée)
  // Champs NON persistés, validés EN MÉMOIRE (valeur aberrante -> sortie nulle -> anomalie).
  if (workflow === 'emettre' && !(typeof s.relecteur_attribue === 'string' && s.relecteur_attribue.length > 0)) return null;
  if (workflow === 'cloturer' && !(Number.isSafeInteger(s.nb_decisions_listees) && s.nb_decisions_listees >= 0 && typeof s.incomplete_search === 'boolean')) return null;
  const p = Object.fromEntries(d.persistees.map((k) => [k, s[k]]));
  return estSortie(p) ? p : null;
}
function projeterExecutions(liste) {
  if (!Array.isArray(liste)) throw new RefusRelecture('exécutions : liste attendue');
  return liste.map((e) => {
    if (!e || typeof e !== 'object' || !T.execution(e.id)) throw new RefusRelecture('exécution : identifiant hors schéma (valeur non répétée)');
    return { id: e.id, set_id: T.setId(e.set_id) ? e.set_id : null, workflow: T.workflow(e.workflow) ? e.workflow : null, statut: T.statutExecution(e.statut) ? e.statut : null, sortie: e.sortie };
  });
}
const exigerSetId = (s) => { if (!T.setId(s)) throw new RefusRelecture('set_id invalide (valeur non répétée)'); };

// --- Fichiers ----------------------------------------------------------------------------------
function chemins(dossier) {
  let d;
  try { d = fs.realpathSync(dossier); } catch { throw new RefusRelecture('dossier des verrous introuvable'); }
  const journal = path.join(d, 'relecture.journal');
  return { dossier: d, verrou: path.join(d, 'relecture.verrou'), journal, temoin: `${journal}.cree` };
}
function lireOctets(p) {
  try { return fs.readFileSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function ecrireTout(fd, buf, { ecrire = fs.writeSync, fsync = fs.fsyncSync } = {}) {
  let fait = 0;
  while (fait < buf.length) {
    const n = ecrire(fd, buf, fait, buf.length - fait);
    if (!Number.isInteger(n) || n <= 0) throw new RefusRelecture('écriture du journal impossible (0 octet écrit)');
    fait += n;
  }
  fsync(fd);
}
const syncDossier = (d) => { const fd = fs.openSync(d, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
function ajouterOctets(p, buf, deps, { creer = false } = {}) {
  const fd = fs.openSync(p, creer ? 'wx' : 'a', 0o600);
  try { ecrireTout(fd, buf, deps); } finally { fs.closeSync(fd); }
  if (creer) syncDossier(path.dirname(p));
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
    const traces = fs.readdirSync(c.dossier).filter((f) => f === path.basename(c.temoin) || f.startsWith('relecture.journal.original-'));
    if (traces.length) throw new RefusRelecture('un journal a déjà existé ici (témoin de création ou copie d\'original) : jamais réinitialisé — traitement manuel (filet anti-accident, pas une preuve)');
    const le = maintenant(deps);
    ajouterOctets(c.journal, serialiser('init', { le, schema: SCHEMA }), deps, { creer: true });
    ajouterOctets(c.temoin, Buffer.from(`${le}\n`), deps, { creer: true });
    return { initialise: true };
  });
}

// Journal d'abord : écrit `envoi` (fsync) AVANT le POST et rend le tentative_id. Le POST n'a lieu
// qu'APRÈS le retour de cette fonction : toute erreur (écriture, fsync) l'empêche.
// donnees = { candidat (objet complet, ou null = absence établie), preexistantes: [ids], listingComplet: true }
function preparerEnvoi(setId, commande, donnees, deps) {
  exigerSetId(setId);
  if (!T.commande(commande)) throw new RefusRelecture('commande inconnue');
  return sousVerrou(deps, (c) => {
    const a = relireSain(c);
    exigerLotLibre(a, setId);
    if (!donnees || donnees.listingComplet !== true) throw new RefusRelecture('exécutions préexistantes : listing incomplet — aucun envoi');
    if (!Array.isArray(donnees.preexistantes) || !donnees.preexistantes.every((x) => T.execution(x))) throw new RefusRelecture('exécutions préexistantes : identifiants hors schéma');
    if (!Object.prototype.hasOwnProperty.call(donnees, 'candidat')) throw new RefusRelecture('candidat : lecture absente (null = absence établie)');
    const preexistantes = [...new Set(donnees.preexistantes)].sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1));
    const avant = projeterCandidat(donnees.candidat);
    const attendu = attenduPour(commande, avant);
    const tentativeId = (deps.aleatoire || (() => crypto.randomBytes(16).toString('hex')))();
    ajouterOctets(c.journal, serialiser('envoi', { le: maintenant(deps), set_id: setId, tentative_id: tentativeId, commande, workflow: COMMANDES[commande], avant, preexistantes, attendu }), deps);
    return { tentative_id: tentativeId, attendu };
  });
}

// Issue d'une tentative en `envoi` SANS diagnostic (aucune exécution à lire) :
//   refuse_sans_effet (donnees.http = 403 authentification | 404 workflow inactif : n8n refuse AVANT de
//   démarrer le workflow) — tout autre code -> indetermine (erreur_serveur) ; un 200 n'est PAS une
//   issue (onReceived : « reçu ») : refus, la tentative reste en envoi jusqu'au diagnostic.
//   indetermine (donnees.motif : délai, transport…)
function conclure(tentativeId, issue, donnees, deps) {
  if (!T.tentative(tentativeId)) throw new RefusRelecture('tentative_id invalide');
  return sousVerrou(deps, (c) => {
    const a = relireSain(c);
    const t = a.tentatives[tentativeId];
    if (!t) throw new RefusRelecture('tentative inconnue');
    if (t.etat !== 'envoi') throw new RefusRelecture(`tentative déjà conclue (${t.etat})`);
    const base = { le: maintenant(deps), set_id: t.set_id, tentative_id: tentativeId };
    let type; let champs;
    if (issue === 'refuse_sans_effet') {
      const http = donnees ? donnees.http : undefined;
      if (Number.isInteger(http) && http >= 200 && http <= 299) throw new RefusRelecture('HTTP 2xx = reçu, jamais exécuté : pas une issue — diagnostic après l\'exécution');
      if (T.httpRefus(http)) [type, champs] = ['refuse_sans_effet', { ...base, http, motif_refus: REFUS_SANS_EXECUTION[http] }];
      else [type, champs] = ['indetermine', { ...base, motif: 'erreur_serveur' }];
    } else if (issue === 'indetermine') {
      if (!T.motif(donnees && donnees.motif)) throw new RefusRelecture('motif d\'indétermination inconnu');
      [type, champs] = ['indetermine', { ...base, motif: donnees.motif }];
    } else throw new RefusRelecture('issue inconnue (une exécution ne se conclut que par le diagnostic)');
    ajouterOctets(c.journal, serialiser(type, champs), deps);
    return { issue: type };
  });
}

// Diagnostic (SEULE conclusion d'une exécution) : rattachement par EXCLUSION, sans horloge.
// donnees = { executions: [{ id, set_id, workflow, statut, sortie }], listingComplet: true, candidat (complet | null) }
// `sortie` = sortie du nœud « FONDA Sortie emission » / « FONDA Sortie cloture » de l'exécution (ou absente).
function diagnostiquer(tentativeId, donnees, deps) {
  if (!T.tentative(tentativeId)) throw new RefusRelecture('tentative_id invalide');
  return sousVerrou(deps, (c) => {
    const a = relireSain(c);
    const t = a.tentatives[tentativeId];
    if (!t) throw new RefusRelecture('tentative inconnue');
    if (t.etat !== 'envoi' && t.etat !== 'indetermine') throw new RefusRelecture(`tentative non ouverte (${t.etat})`);
    const maintenir = (raison) => ({ leve: false, raison });
    if (!donnees || donnees.listingComplet !== true) return maintenir('listing incomplet');
    if (!possede(donnees, 'candidat')) return maintenir('candidat non relu');
    const pre = new Set(t.preexistantes);
    const nouvelles = projeterExecutions(donnees.executions)
      .filter((e) => (e.workflow === t.workflow || e.workflow === null) && (e.set_id === t.set_id || e.set_id === null) && !pre.has(e.id));
    if (nouvelles.length === 0) return maintenir('aucune exécution nouvelle (en transit, purgée ou jamais arrivée)');
    if (nouvelles.length > 1) return maintenir(`${nouvelles.length} exécutions nouvelles : ambiguïté`);
    const e = nouvelles[0];
    if (e.set_id === null || e.workflow === null) return maintenir('exécution nouvelle illisible : ambiguïté');
    if (e.statut === null) return maintenir('exécution nouvelle encore en vol ou de statut inconnu');
    const apres = projeterCandidat(donnees.candidat);
    const sortie = projeterSortie(t.workflow, t.set_id, e.sortie);
    const issue = qualifier(t, e.statut, sortie, apres);
    ajouterOctets(c.journal, serialiser('resolution', { le: maintenant(deps), set_id: t.set_id, tentative_id: tentativeId, issue, execution_id: e.id, execution_statut: e.statut, sortie, apres }), deps);
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

// Copie de l'original : fichier temporaire, fsync, puis renommage ATOMIQUE (une copie interrompue
// ne laisse jamais de fichier final partiel ; la relance reprend).
function copierOriginal(c, octets, deps) {
  const copie = `${c.journal}.original-${sha256(octets)}`;
  const existante = lireOctets(copie);
  if (existante !== null) {
    if (!existante.equals(octets)) throw new RefusRelecture('copie de l\'original divergente — traitement manuel');
    return copie;
  }
  const temp = `${copie}.tmp`;
  const fd = fs.openSync(temp, 'w', 0o600);
  try { ecrireTout(fd, octets, deps); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, copie);
  syncDossier(c.dossier);
  return copie;
}

// Réparation administrative (sous le verrou) : original copié intact, rien d'effacé.
function reparer(deps) {
  return sousVerrou(deps, (c) => {
    let octets = lireOctets(c.journal);
    if (octets === null || octets.length === 0) throw new RefusRelecture('journal absent ou vide : rien à réparer — traitement manuel (jamais réinitialisé)');
    const copie = copierOriginal(c, octets, deps);
    const actions = [];
    if (octets[octets.length - 1] !== 0x0a) {
      ajouterOctets(c.journal, Buffer.from('\n'), deps);
      octets = lireOctets(c.journal);
      actions.push('fin de ligne ajoutée après le fragment tronqué (fragment conservé)');
    }
    const a = analyser(octets);
    const { lignes } = decouper(octets);
    for (const i of a.illisibles) {
      const setIds = setIdsRecuperables(lignes[i]);
      ajouterOctets(c.journal, serialiser('reparation', { le: maintenant(deps), ligne: i, sha256: sha256(lignes[i]), set_ids: setIds }), deps);
      actions.push(setIds ? `ligne ${i + 1} : portion perdue, lots bloqués : ${setIds.join(', ')}` : `ligne ${i + 1} : portion perdue SANS set_id récupérable — tous les lots bloqués jusqu'à attribution`);
    }
    const apres = analyser(lireOctets(c.journal));
    if (!apres.sain) throw new RefusRelecture(`journal encore inutilisable après réparation : ${apres.raison} — traitement manuel`);
    return { actions, copie: path.basename(copie), pertesNonAttribuees: apres.pertesNonAttribuees.map((i) => i + 1) };
  });
}

// Attribution d'une portion perdue sans set_id récupérable aux lots qu'elle a pu concerner (Éric).
function attribuerPerte(numeroLigne, setIds, deps) {
  if (!Array.isArray(setIds) || !setIds.every((s) => T.setId(s))) throw new RefusRelecture('set_ids invalides (valeurs non répétées)');
  const tries = [...new Set(setIds)].sort();
  if (!T.setIds(tries)) throw new RefusRelecture('set_ids invalides (valeurs non répétées)');
  return sousVerrou(deps, (c) => {
    const octets = lireOctets(c.journal);
    const a = analyser(octets);
    const i = numeroLigne - 1;
    if (!a.sain || !a.pertesNonAttribuees.includes(i)) throw new RefusRelecture('aucune portion perdue non attribuée à cette ligne');
    const { lignes } = decouper(octets);
    ajouterOctets(c.journal, serialiser('attribution', { le: maintenant(deps), ligne: i, sha256: sha256(lignes[i]), set_ids: tries }), deps);
    return { bloques: tries };
  });
}

function lireEtat(verrous) { return analyser(lireOctets(chemins(verrous).journal)); }

module.exports = {
  RefusRelecture, OCCUPE, VERROUS_PAR_DEFAUT, SCHEMA, SCHEMAS, COMMANDES, SORTIES, REFUS_SANS_EXECUTION,
  analyser, ligneValide, attenduPour, sortieConforme, qualifier, chemins, prendreVerrou, exigerQuiescence,
  initialiser, preparerEnvoi, conclure, diagnostiquer, decisionSignature, reparer, attribuerPerte, lireEtat, sha256,
};
