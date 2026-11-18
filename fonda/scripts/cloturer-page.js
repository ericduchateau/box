#!/usr/bin/env node
// CLI QUI SIGNE du parcours page (CDC §21.9, §21.12, P5-3) — Mac d'Éric seulement (PRÉCONDITION §21.12.1).
//
//   node fonda/scripts/cloturer-page.js <set_id>
//
// Point d'entrée de la SIGNATURE page : appelle `cloturer` (signer-cloture.js, INTACT : son main() et
// analyserArgumentsCloture refusent toujours « page_relecture ») avec la production page
// (rattachement-page.js, adaptateurs-page.js). N'appelle AUCUN webhook ; n'écrit ni dans Drive ni dans
// n8n ; écrit et signe UNIQUEMENT en local, dans ~/FONDA-clotures/ (par `cloturer`).
// AUCUNE signature page avant la phase B et le go d'Éric (fonda/scripts/SIGNATAIRE.md).
//
// Séquence, sous le VERROU NOYAU de la relecture (verrou-relecture.js), tenu pendant TOUT le processus
// (confirmation interactive comprise ; code 75 si une autre commande le tient) :
//   (1) journal d'écriture lu sous le verrou (§21.12.4) : tentative ouverte ou indéterminée -> refus
//       temporaire ; lot bloqué (anomalie) -> abandon ; portion perdue non attribuée -> incident ;
//       journal illisible -> refus. AUCUN secret lu avant.
//   (2) QUIESCENCE (§21.12.3 b) : observer() sur Emettre ET Cloturer, aucune exécution en vol.
//   (3) clé de signature préparée (phrase de passe saisie au terminal, jamais affichée) ;
//   (4) `cloturer(set_id)`, source page_relecture, rattachement = rattacherPage, tableRelecteurs = {}
//       (badge générique, arbitrage C), levées = [] (aucune, arbitrage D) ;
//   (5) Contrôle final (arbitrage A ; DÉTECTION AU MIEUX, pas une exclusion — arbitrage P2) : toutes
//       les réponses du listing sont ENREGISTRÉES ; après « J'atteste… » et AVANT le marqueur
//       <set_id>.signature, une DERNIÈRE observation des quatre workflows (génération, Confirmer,
//       Cloturer, Emettre) doit avoir la même EMPREINTE (id, statut, startedAt, stoppedAt) que la
//       première, puis un BALAYAGE final `status=running` des quatre ne doit rien voir, et le journal
//       doit toujours permettre de poursuivre ; sinon refus temporaire, AVANT le marqueur : aucune
//       signature, lot réessayable. Le signataire refuse de signer si ce contrôle n'a pas eu lieu.
//       Fenêtre RÉSIDUELLE assumée (lectures n8n non atomiques) : une exécution qui démarre ET finit
//       entre deux requêtes peut échapper ; sans effet sur l'intégrité (CDC §21.12.4).
// FRONTIÈRE (P1) : toute erreur d'un adaptateur injecté (n8n, Drive, journal, incidents, référentiel)
// repart avec un message CONTRÔLÉ (statut 401/403 conservé) ; tout nom Drive hors grammaire devient
// « [nom non conforme] » ; tout champ ÉNUMÉRÉ lu par l'évaluation (statut du candidat, mode et statut
// d'exécution, type et motif de sortie) hors de son domaine devient « [valeur non conforme] » (il reste
// hors domaine : verdict inchangé) ; un registre des incidents dont un champ textuel porte une adresse ou
// un motif de secret est REFUSÉ (issue incident) avant toute signature — jamais masqué en silence.
// Affichage (arbitrage B) : adresses masquées ; refus affichés avec, EN PLUS, les motifs de secrets
// (64 hexadécimaux non précédés de « sha256: », jetons JWT) masqués (filet).
// Diagnostic (§21.2) : nb_decisions_listees de la clôture retenue et décompte du signataire, affichés
// après la signature, jamais décisifs.
// Transports : n8n (clé n8n-signataire.cle) et Drive (compte de service drive.readonly) en GET seulement,
// AUCUNE redirection suivie.

'use strict';

const fs = require('fs');
const path = require('path');
const V = require('./verrou-relecture.js');
const SC = require('./signer-cloture.js');
const C = require('../engine/catalogue.js');
const E = require('./ecrire-relecture.js');

const WORKFLOWS = Object.freeze({ emettre: E.WORKFLOWS.emettre, cloture: E.WORKFLOWS.cloturer, confirmation: 'W1HAOtjAX3ILZBpX' });
// Texte EXACT de la question de fidélité de signer-cloture.js (gelé) : point d'accroche du contrôle final.
const QUESTION_FIDELITE = 'J\'atteste que le récapitulatif confirmé est celui exporté, transmis sans retouche (oui/non) : ';
const EN_VOL = ['new', 'running', 'waiting'];
const ISSUE_JOURNAL = Object.freeze({ refus_temporaire: 'temporaire', abandon: 'abandon', incident: 'incident' });
const MESSAGE_JOURNAL = Object.freeze({
  refus_temporaire: 'journal d\'écriture : tentative non résolue sur ce lot (« ecrire-relecture.js diagnostiquer ») : refus temporaire',
  abandon: 'journal d\'écriture : lot bloqué définitivement (anomalie) : abandon, nouveau set_id',
  incident: 'journal d\'écriture : portion perdue non attribuée : incident de chaîne, toute signature suspendue',
});

const refuser = (m, issue) => { throw new SC.Refus(m, issue); };
// Masquage DÉFENSIF des motifs d'adresse (arbitrage B) ; chemins, ids et empreintes restent lisibles.
const ADRESSE = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const masquer = (t) => String(t).replace(ADRESSE, '[adresse masquée]');
// Motifs de SECRETS (filet, refus seulement) : 64 hex nus (k, HMAC, jetons) et JWT ; « sha256:<64 hex> » lisible.
const HEX64_NU = /(?<![0-9A-Fa-f:])(?<!sha256:)[0-9A-Fa-f]{64}(?![0-9A-Fa-f])/g;
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const masquerRefus = (t) => masquer(t).replace(JWT, '[secret masqué]').replace(HEX64_NU, '[secret masqué]');
const porteSecret = (t) => { const x = String(t); ADRESSE.lastIndex = 0; HEX64_NU.lastIndex = 0; JWT.lastIndex = 0; return new RegExp(ADRESSE.source).test(x) || new RegExp(HEX64_NU.source).test(x) || new RegExp(JWT.source).test(x); };

function analyserArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 1 || typeof argv[0] !== 'string' || !C.SET_ID_PATTERN.test(argv[0])) refuser('usage : cloturer-page.js <set_id> — Mac d\'Éric seulement (un seul Mac) ; aucune signature page avant la phase B et le go d\'Éric', 'precondition');
  return { setId: argv[0] };
}

// --- Frontière (P1) ---------------------------------------------------------------------------------
const SID = C.SET_ID_PATTERN.source.replace(/^\^/, '').replace(/\$$/, '');
const NOMS_CONFORMES = [new RegExp(`^${SID}\\.lot\\.json$`), new RegExp(`^${SID}\\.candidat\\.json$`), new RegExp(`^${SID}-[0-9a-f]{32}\\.json$`)];
const NOM_NON_CONFORME = '[nom non conforme]';
const nomSur = (n) => (typeof n === 'string' && NOMS_CONFORMES.some((r) => r.test(n)) ? n : NOM_NON_CONFORME);
class ErreurFrontiere extends Error { constructor(quoi, e) { super(`${quoi} : lecture en échec (détail non affiché)`); if (e && (e.statut === 401 || e.statut === 403)) this.statut = e.statut; } }
class RefusFrontiere extends SC.Refus {} // refus DÉCIDÉ par la frontière (message fixe) : seul à passer tel quel
const filtrer = (quoi, f) => async (...a) => { try { return await f(...a); } catch (e) { if (e instanceof RefusFrontiere) throw e; throw new ErreurFrontiere(quoi, e); } };
// Domaines (listes blanches) des champs énumérés lus par l'évaluation.
const NON_CONFORME = '[valeur non conforme]';
const STATUTS_EXECUTION = ['success', 'error', 'crashed', 'canceled', 'new', 'running', 'waiting'];
const MODES_N8N = ['webhook', 'manual', 'trigger', 'retry', 'integrated', 'cli', 'internal', 'error', 'evaluation'];
const STATUTS_CANDIDAT = ['en_attente', 'clos', 'abandonne'];
const TYPES_CONFIRMATION = ['decision', 'conflit', 'rejet'];
const MOTIFS_REJET = ['C1', 'C2', 'C3', 'C4', 'C5', 'C5bis'];
const dansDomaine = (o, k, domaine) => { if (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) && !domaine.includes(o[k])) o[k] = NON_CONFORME; };
const SORTIES = ['FONDA Sortie confirmation', 'FONDA Sortie cloture'];
function domaineExecution(brute) {
  if (!brute || typeof brute !== 'object') return brute;
  dansDomaine(brute, 'status', STATUTS_EXECUTION);
  dansDomaine(brute, 'mode', MODES_N8N);
  const rd = brute.data && brute.data.resultData && brute.data.resultData.runData;
  for (const n of SORTIES) {
    for (const run of (rd && Array.isArray(rd[n]) ? rd[n] : [])) {
      for (const sortie of (run && run.data && Array.isArray(run.data.main) ? run.data.main : [])) {
        for (const item of (Array.isArray(sortie) ? sortie : [])) {
          const j = item && item.json;
          if (!j || typeof j !== 'object') continue;
          if (n === SORTIES[0]) { dansDomaine(j, 'type', TYPES_CONFIRMATION); dansDomaine(j, 'motif', [...MOTIFS_REJET, null]); }
        }
      }
    }
  }
  return brute;
}
const textes = (o, acc = []) => { if (typeof o === 'string') acc.push(o); else if (o && typeof o === 'object') for (const v of Object.values(o)) textes(v, acc); return acc; };
const REGISTRE_NON_ADMISSIBLE = 'registre des incidents : contenu non admissible, à corriger';
const avecNom = (x) => (x && typeof x === 'object' && 'nom' in x ? { ...x, nom: nomSur(x.nom) } : x);
// Enveloppe les adaptateurs injectés : messages contrôlés, noms Drive filtrés. N'altère jamais un nom
// conforme ni aucune autre donnée : le verdict de cloturer est inchangé.
function frontiere(d) {
  const drive = d.drive || {};
  const page = (f) => async (setId) => {
    const r = await f(setId);
    if (!r || !Array.isArray(r.fichiers)) return r;
    return {
      ...r,
      fichiers: r.fichiers.map((x) => ({ ...avecNom(x), ...(x && x.erreur ? { erreur: { statut: x.erreur.statut, message: 'lecture en échec (détail non affiché)' } } : {}) })),
      ...(Array.isArray(r.erreurs) ? { erreurs: r.erreurs.map((e) => ({ quoi: 'fichier de decisions/', statut: e && e.statut, message: 'lecture en échec (détail non affiché)' })) } : {}),
    };
  };
  return {
    ...d,
    api: {
      listerExecutions: filtrer('API n8n (liste)', async (q) => { const r = await d.api.listerExecutions(q); if (Array.isArray(r)) for (const x of r) dansDomaine(x, 'status', STATUTS_EXECUTION); return r; }),
      lireExecution: filtrer('API n8n (exécution)', async (id) => domaineExecution(await d.api.lireExecution(id))),
    },
    drive: {
      ...drive,
      lireLotGenere: filtrer('Drive (lot généré)', async (s) => avecNom(await drive.lireLotGenere(s))),
      listerCandidats: filtrer('Drive (candidats/)', async () => { const r = await drive.listerCandidats(); return r && Array.isArray(r.fichiers) ? { ...r, fichiers: r.fichiers.map(avecNom) } : r; }),
      // Enveloppe modifiée EN PLACE (l'identité Drive .drive, non énumérable, est conservée).
      ...(drive.lireCandidat ? { lireCandidat: filtrer('Drive (candidat)', async (s) => { const c = await drive.lireCandidat(s); if (c && typeof c === 'object') dansDomaine(c.relecture, 'statut', STATUTS_CANDIDAT); return c; }) } : {}),
      ...(drive.listerDecisions ? { listerDecisions: filtrer('Drive (decisions/)', page(drive.listerDecisions)) } : {}),
    },
    journal: filtrer('historique de confiance (journal)', (c) => d.journal(c)),
    // Contenu SIGNÉ (incidents_connus) : refusé, jamais masqué, s'il porte une adresse ou un secret présumé.
    incidents: filtrer('registre des incidents', async () => { const r = await d.incidents(); if (textes(r).some(porteSecret)) throw new RefusFrontiere(REGISTRE_NON_ADMISSIBLE, 'incident'); return r; }),
    referentielArchive: filtrer('référentiel archivé', (v) => d.referentielArchive(v)),
  };
}

// Empreinte d'une observation fusionnée (SC.observer) : ensemble des (id, statut, startedAt, stoppedAt).
const empreinte = (liste) => liste.map((x) => [String(x.id), x.status, x.startedAt ?? null, x.stoppedAt ?? null].join('|')).sort().join('\n');

// Mandataire d'ENREGISTREMENT : la PREMIÈRE réponse de chaque requête (workflow, statut) est conservée ;
// la première observation est REJOUÉE par SC.observer sur ces réponses (même fusion, déterministe).
function enregistreur(api) {
  const cle = (q) => `${q.workflowId}|${q.status || ''}`;
  const vues = new Map();
  const copie = (x) => JSON.parse(JSON.stringify(x));
  return {
    api: {
      listerExecutions: async (q) => { const r = await api.listerExecutions(q); if (!vues.has(cle(q))) vues.set(cle(q), copie(r)); return r; },
      lireExecution: (id) => api.lireExecution(id),
    },
    premiere: (workflowId) => SC.observer({ listerExecutions: async (q) => { if (!vues.has(cle(q))) throw new Error('requête non observée'); return copie(vues.get(cle(q))); } }, workflowId),
  };
}

function lireJournal(setId, deps) {
  let d;
  try { d = V.decisionSignature(setId, deps); } catch (e) {
    if (e instanceof V.RefusRelecture) refuser('journal d\'écriture inutilisable (absent, illisible ou corrompu) : aucune signature — voir « ecrire-relecture.js etat »', 'precondition');
    throw e;
  }
  if (d === 'poursuivre') return;
  if (!Object.prototype.hasOwnProperty.call(ISSUE_JOURNAL, d)) refuser('journal d\'écriture : décision inconnue — refus', 'incident');
  refuser(MESSAGE_JOURNAL[d], ISSUE_JOURNAL[d]);
}

async function observerOuRefuser(api, workflowId, quoi) {
  try { return await SC.observer(api, workflowId); } catch { return refuser(`observation n8n (${quoi}) impossible ou incomplète : refus temporaire, relancer`, 'temporaire'); }
}

/**
 * Signature page d'un set_id, sous le verrou déjà PRIS par l'appelant.
 * base = { verrous, sousVerrou } ; fabriquer() -> fab (appelé APRÈS le journal), qui fournit :
 *   api, workflowGeneration, preparerSignataire() -> signer, depsCloture({ api, signer }) -> deps de cloturer,
 *   saisir, afficher, [cloturer] (injection de TEST seulement ; production : SC.cloturer).
 */
async function signerPage(setId, base, fabriquer) {
  if (!C.SET_ID_PATTERN.test(setId || '')) refuser('set_id invalide', 'precondition');
  // (1) journal d'écriture, sous le verrou, AVANT tout secret et toute lecture réseau : la fabrique
  // (fichiers de clés, sources) n'est construite qu'ENSUITE.
  lireJournal(setId, base);
  const fab = fabriquer();
  // (2) quiescence : Emettre ET Cloturer, quel que soit le lot (observations ENREGISTRÉES).
  const rec = enregistreur(fab.api);
  for (const [wf, quoi] of [[WORKFLOWS.emettre, 'Emettre'], [WORKFLOWS.cloture, 'Cloturer']]) {
    const obs = await observerOuRefuser(rec.api, wf, quoi);
    if (obs.some((x) => EN_VOL.includes(x.status))) refuser(`quiescence : exécution en vol sur ${quoi} : refus temporaire, relancer plus tard`, 'temporaire');
  }
  // (3) clé de signature (phrase de passe au terminal).
  const signerReel = await fab.preparerSignataire();
  // (5) contrôle final (TOCTOU), après « J'atteste… » et avant le marqueur.
  const suivis = [fab.workflowGeneration, WORKFLOWS.confirmation, WORKFLOWS.cloture, WORKFLOWS.emettre];
  let controle = false;
  const derniereObservation = async () => {
    for (const wf of suivis) {
      let premiere;
      try { premiere = await rec.premiere(wf); } catch { refuser('contrôle final : première observation indisponible — aucune signature, relancer', 'temporaire'); }
      const derniere = await observerOuRefuser(fab.api, wf, 'contrôle final');
      if (empreinte(premiere) !== empreinte(derniere)) refuser('contrôle final : exécutions n8n apparues ou modifiées depuis le listing — aucune signature, relancer', 'temporaire');
    }
    // Balayage final (P2-i) : une exécution démarrée pendant les observations et encore en cours.
    for (const wf of suivis) {
      let enCours;
      try { enCours = await fab.api.listerExecutions({ workflowId: wf, status: 'running' }); } catch { refuser('contrôle final : balayage impossible — aucune signature, relancer', 'temporaire'); }
      if (!Array.isArray(enCours) || enCours.length) refuser('contrôle final : exécution n8n en cours apparue pendant les observations — aucune signature, relancer', 'temporaire');
    }
    lireJournal(setId, base);
    controle = true;
  };
  const saisir = async (q) => {
    const r = await fab.saisir(q);
    if (q === QUESTION_FIDELITE && typeof r === 'string' && r.trim() === 'oui') await derniereObservation();
    return r;
  };
  const signer = (octets) => {
    if (!controle) refuser('contrôle final (dernière observation) non effectué : signature refusée', 'local');
    return signerReel(octets);
  };
  const afficher = (t) => fab.afficher(masquer(t));
  const brutes = fab.depsCloture({ api: rec.api, signer });
  const deps = frontiere({ ...brutes, api: rec.api });
  // Diagnostic (§21.2) capté SANS nouvelle lecture : clôtures du lot vues par rattacherPage, décisions
  // conformes du lot lues par listerDecisions.
  const clotures = [];
  let decompte = null;
  const rattachement = typeof brutes.rattachement === 'function' ? (detail, c) => {
    const r = brutes.rattachement(detail, c);
    if (r && r.nature === 'cloture' && r.set_id === setId && r.obs) clotures.push(r);
    return r;
  } : brutes.rattachement;
  const lister = deps.drive.listerDecisions;
  if (lister) {
    deps.drive.listerDecisions = async (s) => {
      const r = await lister(s);
      decompte = r && Array.isArray(r.fichiers) ? r.fichiers.filter((f) => f && !f.erreur && f.contenu && SC.decisionConforme(f.contenu) && f.contenu.set_id === setId).length : null;
      return r;
    };
  }
  Object.assign(deps, { signer, saisir, afficher, rattachement, tableRelecteurs: {}, levees: [] });
  const fermer = fab.cloturer || SC.cloturer;
  const r = await fermer(setId, deps);
  if (!controle) refuser('contrôle final non effectué : résultat ignoré', 'local');
  const retenue = clotures.slice().sort((a, b) => (a.obs.stoppedAt < b.obs.stoppedAt ? -1 : a.obs.stoppedAt > b.obs.stoppedAt ? 1 : 0)).pop();
  const diagnostic = { nb_decisions_listees: retenue ? retenue.nb_decisions_listees : null, decompte_signataire: decompte };
  return { set_id: setId, dossier: r.dossierLot, diagnostic };
}

// --- Production -------------------------------------------------------------------------------------
// Transports injectables (tests) : `fetch`, `lirePhrase`, dossiers et sources. Lectures : redirection
// INTERDITE ; clés : n8n-signataire.cle (GET n8n), compte de service drive.readonly (GET Drive).
function fabrique({ fetch: f = globalThis.fetch, lirePhrase, dossierCles, sources: s0, cleId, ...o } = {}) {
  const A = require('./adaptateurs-production.js');
  const AP = require('./adaptateurs-page.js');
  const P = require('./rattachement-page.js');
  const CONFIG = require('../../n8n/fonda-relecture-page/construire-relecture.js').CONFIG;
  const lecture = E.sansRedirection(f);
  const sources = s0 || A.sourcesLecture({ ...o, dossierCles, fetch: lecture });
  let cle;
  try { cle = JSON.parse(fs.readFileSync(path.join(sources.dossierCles, 'drive-compte-service.json'), 'utf8')); } catch { refuser('compte de service Drive illisible', 'precondition'); }
  const jeton = A.jetonCompteService({ cle, fetch: lecture });
  const page = AP.lecturePage({ jeton, fetch: lecture, dossierRelecture: CONFIG.dossierRelecture, dossierDecisions: CONFIG.dossierDecisions });
  const terminal = A.dependancesCloture({ sources, rattachement: P.rattacherPage, cleId });
  return {
    api: sources.api,
    workflowGeneration: sources.workflowGeneration,
    preparerSignataire: () => A.preparerSignataire({ dossierCles: sources.dossierCles, cleId: cleId || A.CLE_ID, cles: sources.cles, lirePhrase }),
    depsCloture: ({ api, signer }) => {
      const d = A.dependancesCloture({ sources, signer, rattachement: P.rattacherPage, cleId });
      return {
        ...d, api,
        config: { ...d.config, source: 'page_relecture', workflowConfirmation: WORKFLOWS.confirmation, workflowCloture: WORKFLOWS.cloture },
        drive: { ...d.drive, lireCandidat: page.lireCandidat, listerDecisions: page.listerDecisions },
      };
    },
    saisir: terminal.saisir,
    afficher: terminal.afficher,
  };
}

// ErreurAdaptateur affichée : seulement celles levées AVANT cloturer (clés, phrase), aux messages fixes ;
// les lectures pendant cloturer passent par la frontière (messages contrôlés).
const MESSAGES_PUBLICS = (e, A) => e instanceof SC.Refus || e instanceof V.RefusRelecture || e instanceof ErreurFrontiere || (A && e instanceof A.ErreurAdaptateur);
async function main(argv = process.argv.slice(2), fab = fabrique, verrous = V.VERROUS_PAR_DEFAUT, sortie = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }) {
  let A = null;
  try { A = require('./adaptateurs-production.js'); } catch { A = null; }
  try {
    const { setId } = analyserArguments(argv);
    const tenu = V.prendreVerrou(verrous);
    const base = { verrous, sousVerrou: tenu.chemin };
    const r = await signerPage(setId, base, () => fab());
    sortie.out(masquer(`✓ ${r.set_id} clôturé (signé) : ${r.dossier}\n`));
    const dg = r.diagnostic || {};
    sortie.out(`Diagnostic (jamais décisif) : décisions listées par Cloturer = ${dg.nb_decisions_listees ?? 'inconnu'} ; décisions conformes du lot vues par le signataire = ${dg.decompte_signataire ?? 'inconnu'}\n`);
    if (dg.nb_decisions_listees !== dg.decompte_signataire) sortie.out('⚠ décomptes différents : à examiner (decisions/ peut avoir changé depuis la clôture technique) — la signature reste fondée sur ce que le signataire a observé\n');
  } catch (e) {
    sortie.err(`✗ ${MESSAGES_PUBLICS(e, A) ? masquerRefus(e.message) : 'erreur interne (détail non affiché)'}\n`);
    process.exitCode = e && e.code === V.OCCUPE ? V.OCCUPE : 1;
  }
}

module.exports = { WORKFLOWS, QUESTION_FIDELITE, NOM_NON_CONFORME, NON_CONFORME, REGISTRE_NON_ADMISSIBLE, masquer, masquerRefus, porteSecret, nomSur, frontiere, analyserArguments, empreinte, enregistreur, signerPage, fabrique, main };

if (require.main === module) main();
