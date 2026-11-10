#!/usr/bin/env node
'use strict';
// Sonde d'observation des exécutions n8n, LECTURE SEULE (recette P4, porte G7 « finding 3 » ; §21.4).
// Interroge exactement comme le signataire : running, waiting, puis liste complète, fusionnées par
// observer() de signer-cloture.js (aucune réimplémentation). Avec --execution <id> : statut, présence de
// runData et noms des nœuds exécutés, SANS aucune donnée d'exécution (k, adresses, contenus jamais affichés).
//
// Usage : FONDA_N8N_CLE_RECETTE=… node outils-recette/sonde-executions.js <workflowId> [--execution <id>] [--url <instance>]

const { apiN8n } = require('../fonda/scripts/adaptateurs-production.js');
const { observer } = require('../fonda/scripts/signer-cloture.js');
const { fetchLectureSeule, cleDEnvironnement } = require('./lecture-seule.js');

const URL_DEFAUT = 'https://n8n.srv868991.hstgr.cloud';

async function sonder({ workflowId, url = URL_DEFAUT, cle, fetch: f = globalThis.fetch }) {
  if (typeof workflowId !== 'string' || !/^[A-Za-z0-9]+$/.test(workflowId)) throw new Error('workflowId invalide');
  const api = apiN8n({ url, cle, fetch: fetchLectureSeule({ url, fetch: f }) });
  const brut = {};
  for (const status of ['running', 'waiting', null]) {
    brut[status || 'liste'] = (await api.listerExecutions(status ? { workflowId, status } : { workflowId })).map((x) => ({ id: String(x.id), status: x.status, startedAt: x.startedAt, stoppedAt: x.stoppedAt }));
  }
  // Fusion par le code du signataire (mêmes refus) ; une contradiction remonte telle quelle.
  let fusion; let refus = null;
  try { fusion = (await observer(api, workflowId)).map((v) => ({ id: v.id, status: v.status })); } catch (e) { refus = e.message; }
  const enVol = fusion ? fusion.filter((v) => ['new', 'running', 'waiting'].includes(v.status)).map((v) => v.id) : null;
  return { schema: 'sonde-executions/v1', workflowId, observe_le: new Date().toISOString(), brut, fusion: fusion ?? null, en_vol: enVol, refus_observer: refus };
}

async function sonderExecution({ id, url = URL_DEFAUT, cle, fetch: f = globalThis.fetch }) {
  if (typeof id !== 'string' || !/^[0-9]+$/.test(id)) throw new Error('identifiant d\'exécution invalide');
  const api = apiN8n({ url, cle, fetch: fetchLectureSeule({ url, fetch: f }) });
  const e = await api.lireExecution(id);
  if (e === null) return { schema: 'sonde-execution/v1', id, present: false };
  const runData = e && e.data && e.data.resultData ? e.data.resultData.runData : undefined;
  return { schema: 'sonde-execution/v1', id, present: true, workflowId: e.workflowId, status: e.status, mode: e.mode,
    startedAt: e.startedAt ?? null, stoppedAt: e.stoppedAt ?? null, runData_present: !!runData && typeof runData === 'object',
    noeuds_executes: runData && typeof runData === 'object' ? Object.keys(runData).sort() : [],
    erreur_noeud: e && e.data && e.data.resultData && e.data.resultData.error ? (e.data.resultData.error.node && e.data.resultData.error.node.name) || null : null };
}

module.exports = { sonder, sonderExecution, URL_DEFAUT };

if (require.main === module) {
  const a = process.argv.slice(2);
  const opt = (n) => { const i = a.indexOf(n); return i === -1 ? undefined : a[i + 1]; };
  const url = opt('--url') || URL_DEFAUT;
  (async () => {
    const cle = cleDEnvironnement();
    const r = opt('--execution') ? await sonderExecution({ id: opt('--execution'), url, cle }) : await sonder({ workflowId: a[0], url, cle });
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  })().catch((e) => { process.stderr.write(`sonde : ${e.message}\n`); process.exitCode = 1; });
}
