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
//   (5) TOCTOU (arbitrage A) : toutes les réponses du listing sont ENREGISTRÉES ; après « J'atteste… »
//       et AVANT le marqueur <set_id>.signature, une DERNIÈRE observation des quatre workflows
//       (génération, Confirmer, Cloturer, Emettre) doit avoir la même EMPREINTE (id, statut,
//       startedAt, stoppedAt) que la première, et le journal doit toujours permettre de poursuivre ;
//       sinon refus temporaire, AVANT le marqueur : aucune signature, lot réessayable. Le signataire
//       refuse de signer si ce contrôle n'a pas eu lieu.
// Affichage (arbitrage B) : refus et textes affichés avec MASQUAGE DÉFENSIF des motifs d'adresse.
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

function analyserArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 1 || typeof argv[0] !== 'string' || !C.SET_ID_PATTERN.test(argv[0])) refuser('usage : cloturer-page.js <set_id> — Mac d\'Éric seulement (un seul Mac) ; aucune signature page avant la phase B et le go d\'Éric', 'precondition');
  return { setId: argv[0] };
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
  const deps = { ...fab.depsCloture({ api: rec.api, signer }), api: rec.api, signer, saisir, afficher, tableRelecteurs: {}, levees: [] };
  const fermer = fab.cloturer || SC.cloturer;
  const r = await fermer(setId, deps);
  if (!controle) refuser('contrôle final non effectué : résultat ignoré', 'local');
  return { set_id: setId, dossier: r.dossierLot };
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

const MESSAGES_PUBLICS = (e, A) => e instanceof SC.Refus || e instanceof V.RefusRelecture || (A && e instanceof A.ErreurAdaptateur);
async function main(argv = process.argv.slice(2), fab = fabrique, verrous = V.VERROUS_PAR_DEFAUT, sortie = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }) {
  let A = null;
  try { A = require('./adaptateurs-production.js'); } catch { A = null; }
  try {
    const { setId } = analyserArguments(argv);
    const tenu = V.prendreVerrou(verrous);
    const base = { verrous, sousVerrou: tenu.chemin };
    const r = await signerPage(setId, base, () => fab());
    sortie.out(masquer(`✓ ${r.set_id} clôturé (signé) : ${r.dossier}\n`));
  } catch (e) {
    sortie.err(`✗ ${MESSAGES_PUBLICS(e, A) ? masquer(e.message) : 'erreur interne (détail non affiché)'}\n`);
    process.exitCode = e && e.code === V.OCCUPE ? V.OCCUPE : 1;
  }
}

module.exports = { WORKFLOWS, QUESTION_FIDELITE, masquer, analyserArguments, empreinte, enregistreur, signerPage, fabrique, main };

if (require.main === module) main();
