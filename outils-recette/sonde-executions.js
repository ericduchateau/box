#!/usr/bin/env node
'use strict';
// Sonde d'observation des exécutions n8n, LECTURE SEULE (recette P4, porte G7 « finding 3 » ; §21.4).
// UNE SEULE série d'observations : observer() de signer-cloture.js (running, waiting, puis liste complète,
// aucune réimplémentation) ; les réponses qu'il consomme réellement sont capturées (« brut »), sa fusion aussi.
// Avec --execution <id> : statut, présence de runData et nœuds exécutés, SANS aucune donnée d'exécution.
// CONNU-BON SEULEMENT : identifiants numériques, statuts et modes d'un ensemble fermé, dates ISO strictes,
// noms de nœuds d'une LISTE DE CONFIANCE du dépôt (4 exports de recette + workflow d'attente) ; tout le reste
// devient un marqueur. Le message d'un refus d'observer() n'est JAMAIS affiché : catégorie d'une liste fermée.
// Code de sortie 1 si l'observation est impossible (diagnostic JSON conservé sur la sortie standard).
//
// Usage : FONDA_N8N_CLE_RECETTE=… node outils-recette/sonde-executions.js <workflowId> [--url https://hôte]
//         FONDA_N8N_CLE_RECETTE=… node outils-recette/sonde-executions.js --execution <id> [--url https://hôte]

const fs = require('fs');
const path = require('path');
const { apiN8n } = require('../fonda/scripts/adaptateurs-production.js');
const { observer } = require('../fonda/scripts/signer-cloture.js');
const { fetchLectureSeule, cleDEnvironnement, origineInstance, messageSur } = require('./lecture-seule.js');
const { analyser } = require('./arguments.js');

const URL_DEFAUT = 'https://n8n.srv868991.hstgr.cloud';
const STATUTS = Object.freeze(['new', 'running', 'waiting', 'success', 'error', 'crashed', 'canceled', 'unknown']);
const MODES = Object.freeze(['webhook', 'manual', 'trigger', 'retry', 'integrated', 'cli', 'internal', 'error', 'evaluation']);
// Workflow jetable de la porte G7 (à construire avec EXACTEMENT ces noms de nœuds).
const NOEUDS_ATTENTE = Object.freeze(['Webhook attente', 'Attendre', 'Repondre attente']);
const DOSSIER_EXPORTS = path.join(__dirname, '..', 'n8n', 'fonda-relecture-page');
function nomsDeConfiance() {
  const noms = new Set(NOEUDS_ATTENTE);
  for (const f of fs.readdirSync(DOSSIER_EXPORTS).filter((x) => x.endsWith('.recette.json')).sort()) for (const n of JSON.parse(fs.readFileSync(path.join(DOSSIER_EXPORTS, f), 'utf8')).nodes) noms.add(n.name);
  return noms;
}
// Catégories de refus d'observer() (liste fermée) ; message jamais restitué.
const CATEGORIES = Object.freeze([
  [/sans identifiant exploitable/, 'identifiant inexploitable'], [/hors grammaire/, 'date hors grammaire'], [/workflowId inattendu/, 'workflowId inattendu'],
  [/statut inconnu/, 'statut inconnu'], [/terminée avant d'avoir démarré/, 'chronologie incohérente'], [/observations contradictoires/, 'observations contradictoires'],
  [/deux statuts terminaux/, 'statuts terminaux contradictoires'], [/retour d'un statut terminal/, 'retour à un statut non terminal'],
  [/sans startedAt\/stoppedAt/, 'dates manquantes'], [/pagination en boucle/, 'pagination en boucle'], [/liste d'exécutions inexploitable/, 'liste inexploitable'],
  [/^lecture seule : réponse JSON illisible$/, 'réponse JSON illisible'], [/^lecture seule : échec du transport$/, 'échec du transport'], [/: HTTP [0-9]{3}$/, 'erreur HTTP'],
]);
const categorie = (e) => { const m = e && typeof e.message === 'string' ? e.message : ''; const c = CATEGORIES.find(([re]) => re.test(m)); return c ? c[1] : 'refus non catégorisé'; };

const idSur = (x) => ((typeof x === 'number' && Number.isSafeInteger(x) && x >= 0) || (typeof x === 'string' && /^[0-9]{1,20}$/.test(x)) ? String(x) : '<id hors grammaire>');
const dansListe = (liste, x) => (typeof x === 'string' && liste.includes(x) ? x : '<hors liste>');
const dateSure = (x) => (x == null ? null : typeof x === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$/.test(x) ? x : '<date hors grammaire>');
const verifierWorkflowId = (w) => { if (typeof w !== 'string' || !/^[A-Za-z0-9]{1,40}$/.test(w)) throw new Error('workflowId invalide'); };

async function sonder({ workflowId, url = URL_DEFAUT, cle, fetch: f = globalThis.fetch }) {
  verifierWorkflowId(workflowId);
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

async function sonderExecution({ id, url = URL_DEFAUT, cle, fetch: f = globalThis.fetch, noms = nomsDeConfiance() }) {
  if (typeof id !== 'string' || !/^[0-9]{1,20}$/.test(id)) throw new Error('identifiant d\'exécution invalide');
  const base = origineInstance(url);
  const api = apiN8n({ url: base, cle, fetch: fetchLectureSeule({ url: base, fetch: f }) });
  const e = await api.lireExecution(id);
  if (e === null) return { schema: 'sonde-execution/v1', id, present: false };
  const res = e && e.data && e.data.resultData;
  const runData = res && res.runData && typeof res.runData === 'object' && !Array.isArray(res.runData) ? res.runData : null;
  let hors = 0;
  const nomSur = (n) => (typeof n === 'string' && noms.has(n) ? n : `<nom hors liste n°${(hors += 1)}>`);
  return { schema: 'sonde-execution/v1', id, present: true, workflowId: typeof e.workflowId === 'string' && /^[A-Za-z0-9]{1,40}$/.test(e.workflowId) ? e.workflowId : '<id hors grammaire>',
    status: dansListe(STATUTS, e.status), mode: dansListe(MODES, e.mode), startedAt: dateSure(e.startedAt), stoppedAt: dateSure(e.stoppedAt),
    runData_present: runData !== null,
    noeuds_executes: runData ? Object.keys(runData).sort().map(nomSur) : [],
    erreur_noeud: res && res.error && res.error.node ? nomSur(res.error.node.name) : null };
}

async function principal(argv, { fetch: f = globalThis.fetch, env = process.env } = {}) {
  const { options, positionnels } = analyser(argv, { options: ['--url', '--execution'], positionnels: argv.includes('--execution') ? 0 : 1 });
  const url = origineInstance(options['--url'] || URL_DEFAUT); // HTTPS vérifié AVANT tout
  const cle = cleDEnvironnement('FONDA_N8N_CLE_RECETTE', env);
  if (options['--execution'] !== undefined) return { r: await sonderExecution({ id: options['--execution'], url, cle, fetch: f }), code: 0 };
  const r = await sonder({ workflowId: positionnels[0], url, cle, fetch: f });
  return { r, code: r.refus_observer === null ? 0 : 1 };
}

module.exports = { sonder, sonderExecution, principal, nomsDeConfiance, NOEUDS_ATTENTE, CATEGORIES, URL_DEFAUT };

if (require.main === module) {
  principal(process.argv.slice(2)).then(({ r, code }) => { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); process.exitCode = code; })
    .catch((e) => { process.stderr.write(`sonde : ${messageSur(e)}\n`); process.exitCode = 1; });
}
