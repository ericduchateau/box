#!/usr/bin/env node
'use strict';
// Sonde d'observation des exécutions n8n, LECTURE SEULE (recette P4, porte G7 « finding 3 » ; §21.4).
// UNE SEULE série d'observations : observer() de signer-cloture.js (running, waiting, puis liste complète,
// aucune réimplémentation) ; les réponses qu'il consomme réellement sont capturées (« brut »), sa fusion aussi.
// Avec --execution <id> : statut, présence de runData et nœuds exécutés, SANS aucune donnée d'exécution.
// CONNU-BON SEULEMENT : instance et routes du transport (lecture-seule.js) ; identifiants en grammaire stricte ;
// statuts et modes en listes fermées ; dates ISO strictes ; noms de nœuds d'une LISTE DE CONFIANCE construite
// depuis 4 fichiers NOMMÉS du dépôt + le workflow d'attente ; refus d'observer() -> catégorie d'une liste
// fermée (message jamais affiché) ; erreurs affichées reconstruites (messageSur).
// Codes de sortie (jamais confondus) :
//   0 = observé (liste : observation exploitable ; --execution : exécution PRÉSENTE, schéma et identité vérifiés)
//   1 = INOBSERVABLE (fail-closed : refus d'observer(), réponse hors schéma, identité différente, erreur)
//   2 = observé ABSENT (--execution : HTTP 404, détail purgé §21.4)
//
// Usage : FONDA_N8N_CLE_RECETTE=… node outils-recette/sonde-executions.js <workflowId>
//         FONDA_N8N_CLE_RECETTE=… node outils-recette/sonde-executions.js --execution <id>

const fs = require('fs');
const path = require('path');
const { apiN8n } = require('../fonda/scripts/adaptateurs-production.js');
const { observer } = require('../fonda/scripts/signer-cloture.js');
const { INSTANCES, ErreurOutil, ID_WORKFLOW, ID_EXECUTION, fetchLectureSeule, cleDEnvironnement, origineInstance, messageSur } = require('./lecture-seule.js');
const { analyser } = require('./arguments.js');

const INSTANCE = INSTANCES[0];
const STATUTS = Object.freeze(['new', 'running', 'waiting', 'success', 'error', 'crashed', 'canceled', 'unknown']);
const MODES = Object.freeze(['webhook', 'manual', 'trigger', 'retry', 'integrated', 'cli', 'internal', 'error', 'evaluation']);
// Workflow jetable de la porte G7 (à construire avec EXACTEMENT ces noms de nœuds).
const NOEUDS_ATTENTE = Object.freeze(['Webhook attente', 'Attendre', 'Repondre attente']);
// Sources de la liste de confiance : 4 fichiers NOMMÉS (jamais un glob).
const EXPORTS_RECETTE = Object.freeze(['box-fonda-emettre-relecture.recette.json', 'box-fonda-cloturer-relecture.recette.json',
  'box-fonda-confirmer-relecture.recette.json', 'box-fonda-page-relecture.recette.json'].map((f) => path.join(__dirname, '..', 'n8n', 'fonda-relecture-page', f)));
function nomsDeConfiance() {
  const noms = new Set(NOEUDS_ATTENTE);
  for (const f of EXPORTS_RECETTE) {
    let wf;
    try { wf = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { throw new ErreurOutil('EXPORT_ILLISIBLE'); }
    if (!wf || !Array.isArray(wf.nodes)) throw new ErreurOutil('EXPORT_ILLISIBLE');
    for (const n of wf.nodes) noms.add(n.name);
  }
  return noms;
}
// Catégories de refus d'observer() (liste fermée) ; message jamais restitué.
const CATEGORIES = Object.freeze([
  [/sans identifiant exploitable/, 'identifiant inexploitable'], [/hors grammaire/, 'date hors grammaire'], [/workflowId inattendu/, 'workflowId inattendu'],
  [/statut inconnu/, 'statut inconnu'], [/terminée avant d'avoir démarré/, 'chronologie incohérente'], [/observations contradictoires/, 'observations contradictoires'],
  [/deux statuts terminaux/, 'statuts terminaux contradictoires'], [/retour d'un statut terminal/, 'retour à un statut non terminal'],
  [/sans startedAt\/stoppedAt/, 'dates manquantes'], [/pagination en boucle/, 'pagination en boucle'], [/liste d'exécutions inexploitable/, 'liste inexploitable'],
]);
const CATEGORIES_OUTIL = Object.freeze({ JSON: 'réponse JSON illisible', TRANSPORT: 'échec du transport', PARAMETRE: 'paramètre de requête hors liste fermée (dont curseur)' });
function categorie(e) {
  if (e instanceof ErreurOutil) return CATEGORIES_OUTIL[e.code] || 'erreur de l\'outil';
  if (e && e.name === 'ErreurAdaptateur' && Number.isInteger(e.statut)) return 'erreur HTTP';
  const m = e && typeof e.message === 'string' ? e.message : '';
  const c = CATEGORIES.find(([re]) => re.test(m));
  return c ? c[1] : 'refus non catégorisé';
}

const idSur = (x) => ((typeof x === 'number' && Number.isSafeInteger(x) && x >= 0) || (typeof x === 'string' && ID_EXECUTION.test(x)) ? String(x) : '<id hors grammaire>');
const dansListe = (liste, x) => (typeof x === 'string' && liste.includes(x) ? x : '<hors liste>');
const dateSure = (x) => (x == null ? null : typeof x === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$/.test(x) ? x : '<date hors grammaire>');

async function sonder({ workflowId, url = INSTANCE, cle, fetch: f = globalThis.fetch }) {
  if (typeof workflowId !== 'string' || !ID_WORKFLOW.test(workflowId)) throw new ErreurOutil('WORKFLOW_ID');
  const base = origineInstance(url);
  const api = apiN8n({ url: base, cle, fetch: fetchLectureSeule({ url: base, fetch: f }) });
  const brut = {};
  const capture = { async listerExecutions(q) {
    const r = await api.listerExecutions(q);
    brut[q.status || 'liste'] = r.map((x) => ({ id: idSur(x.id), status: dansListe(STATUTS, x.status), startedAt: dateSure(x.startedAt), stoppedAt: dateSure(x.stoppedAt) }));
    return r;
  } };
  let fusion = null; let refus = null;
  try { fusion = (await observer(capture, workflowId)).map((v) => ({ id: idSur(v.id), status: dansListe(STATUTS, v.status) })); } catch (e) { refus = categorie(e); }
  const enVol = fusion ? fusion.filter((v) => ['new', 'running', 'waiting'].includes(v.status)).map((v) => v.id) : null;
  return { schema: 'sonde-executions/v1', workflowId, observe_le: new Date().toISOString(), brut, fusion, en_vol: enVol, refus_observer: refus };
}

// Détail d'une exécution : { r, code } (0 présent ; 1 inobservable ; 2 absent).
async function sonderExecution({ id, url = INSTANCE, cle, fetch: f = globalThis.fetch, noms = nomsDeConfiance() }) {
  if (typeof id !== 'string' || !ID_EXECUTION.test(id)) throw new ErreurOutil('EXECUTION_ID');
  const base = origineInstance(url);
  const api = apiN8n({ url: base, cle, fetch: fetchLectureSeule({ url: base, fetch: f }) });
  let e;
  try { e = await api.lireExecution(id); } catch (x) { return { r: { schema: 'sonde-execution/v1', id, observation: 'inobservable', cause: categorie(x) }, code: 1 }; }
  if (e === null) return { r: { schema: 'sonde-execution/v1', id, observation: 'absent' }, code: 2 };
  // Schéma (includeData) et identité : sinon INOBSERVABLE (jamais « présent » sur une réponse douteuse).
  const objet = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  if (!objet(e) || !objet(e.data) || !objet(e.data.resultData) || !STATUTS.includes(e.status) || typeof e.workflowId !== 'string' || !ID_WORKFLOW.test(e.workflowId))
    return { r: { schema: 'sonde-execution/v1', id, observation: 'inobservable', cause: 'réponse hors schéma attendu' }, code: 1 };
  if (idSur(e.id) !== id) return { r: { schema: 'sonde-execution/v1', id, observation: 'inobservable', cause: 'identifiant renvoyé ≠ identifiant demandé' }, code: 1 };
  const res = e.data.resultData;
  const runData = objet(res.runData) ? res.runData : null;
  let hors = 0;
  const nomSur = (n) => (typeof n === 'string' && noms.has(n) ? n : `<nom hors liste n°${(hors += 1)}>`);
  return { r: { schema: 'sonde-execution/v1', id, observation: 'present', workflowId: e.workflowId,
    status: e.status, mode: dansListe(MODES, e.mode), startedAt: dateSure(e.startedAt), stoppedAt: dateSure(e.stoppedAt),
    runData_present: runData !== null,
    noeuds_executes: runData ? Object.keys(runData).sort().map(nomSur) : [],
    erreur_noeud: objet(res.error) && objet(res.error.node) ? nomSur(res.error.node.name) : null }, code: 0 };
}

async function principal(argv, { fetch: f = globalThis.fetch, env = process.env } = {}) {
  const avecExecution = argv.includes('--execution');
  const { options, positionnels } = analyser(argv, { options: ['--execution'], positionnels: avecExecution ? 0 : 1 });
  const cle = cleDEnvironnement(env);
  if (avecExecution) return sonderExecution({ id: options['--execution'], cle, fetch: f });
  const r = await sonder({ workflowId: positionnels[0], cle, fetch: f });
  return { r, code: r.refus_observer === null ? 0 : 1 };
}

module.exports = { sonder, sonderExecution, principal, nomsDeConfiance, NOEUDS_ATTENTE, EXPORTS_RECETTE, CATEGORIES, STATUTS, MODES, INSTANCE };

if (require.main === module) {
  principal(process.argv.slice(2)).then(({ r, code }) => { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); process.exitCode = code; })
    .catch((e) => { process.stderr.write(`sonde : ${messageSur(e)}\n`); process.exitCode = 1; });
}
