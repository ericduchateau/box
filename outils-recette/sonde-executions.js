#!/usr/bin/env node
'use strict';
// Sonde d'observation des exécutions n8n, LECTURE SEULE (recette P4, porte G7 « finding 3 » ; §21.4).
// UNE SEULE série d'observations : observer() de signer-cloture.js (running, waiting, puis liste complète,
// aucune réimplémentation) ; les réponses qu'il consomme réellement sont capturées et affichées (« brut »),
// sa fusion aussi. Avec --execution <id> : statut, présence de runData et noms des nœuds exécutés, SANS aucune
// donnée d'exécution (k, adresses, contenus jamais affichés ; noms hors grammaire remplacés par un marqueur).
//
// Usage : FONDA_N8N_CLE_RECETTE=… node outils-recette/sonde-executions.js <workflowId> [--execution <id>] [--url <instance>]

const { apiN8n } = require('../fonda/scripts/adaptateurs-production.js');
const { observer } = require('../fonda/scripts/signer-cloture.js');
const { fetchLectureSeule, cleDEnvironnement, affichable } = require('./lecture-seule.js');

// Nom de nœud affichable : grammaire des noms de nos workflows, sinon marqueur indexé.
const NOM_NOEUD = /^[A-Za-z0-9 ?'()._-]{1,64}$/;
const nomSur = (n, i) => (typeof n === 'string' && NOM_NOEUD.test(n) ? n : `<nom hors grammaire n°${i}>`);
const idSur = (x) => (typeof x === 'number' || (typeof x === 'string' && /^[0-9]{1,20}$/.test(x)) ? String(x) : '<id hors grammaire>');
const statutSur = (x) => (typeof x === 'string' && /^[a-z]{1,20}$/.test(x) ? x : '<statut hors grammaire>');
const dateSure = (x) => (x == null ? null : typeof x === 'string' && /^[0-9T:.+Z-]{10,40}$/.test(x) ? x : '<date hors grammaire>');

const URL_DEFAUT = 'https://n8n.srv868991.hstgr.cloud';

async function sonder({ workflowId, url = URL_DEFAUT, cle, fetch: f = globalThis.fetch }) {
  if (typeof workflowId !== 'string' || !/^[A-Za-z0-9]+$/.test(workflowId)) throw new Error('workflowId invalide');
  const api = apiN8n({ url, cle, fetch: fetchLectureSeule({ url, fetch: f }) });
  // Capture des réponses CONSOMMÉES par observer() (même série que la fusion).
  const brut = {};
  const capture = { async listerExecutions(q) {
    const r = await api.listerExecutions(q);
    brut[q.status || 'liste'] = r.map((x) => ({ id: idSur(x.id), status: statutSur(x.status), startedAt: dateSure(x.startedAt), stoppedAt: dateSure(x.stoppedAt) }));
    return r;
  } };
  let fusion; let refus = null;
  try { fusion = (await observer(capture, workflowId)).map((v) => ({ id: idSur(v.id), status: statutSur(v.status) })); } catch (e) { refus = affichable(e.message, 'refus d\'observer() (message non affichable)'); }
  const enVol = fusion ? fusion.filter((v) => ['new', 'running', 'waiting'].includes(v.status)).map((v) => v.id) : null;
  return { schema: 'sonde-executions/v1', workflowId, observe_le: new Date().toISOString(), brut, fusion: fusion ?? null, en_vol: enVol, refus_observer: refus };
}

async function sonderExecution({ id, url = URL_DEFAUT, cle, fetch: f = globalThis.fetch }) {
  if (typeof id !== 'string' || !/^[0-9]+$/.test(id)) throw new Error('identifiant d\'exécution invalide');
  const api = apiN8n({ url, cle, fetch: fetchLectureSeule({ url, fetch: f }) });
  const e = await api.lireExecution(id);
  if (e === null) return { schema: 'sonde-execution/v1', id, present: false };
  const runData = e && e.data && e.data.resultData ? e.data.resultData.runData : undefined;
  const erreur = e && e.data && e.data.resultData ? e.data.resultData.error : undefined;
  return { schema: 'sonde-execution/v1', id, present: true, workflowId: typeof e.workflowId === 'string' && /^[A-Za-z0-9]{1,40}$/.test(e.workflowId) ? e.workflowId : '<id hors grammaire>',
    status: statutSur(e.status), mode: statutSur(e.mode), startedAt: dateSure(e.startedAt), stoppedAt: dateSure(e.stoppedAt),
    runData_present: !!runData && typeof runData === 'object',
    noeuds_executes: runData && typeof runData === 'object' ? Object.keys(runData).sort().map(nomSur) : [],
    erreur_noeud: erreur && erreur.node ? nomSur(erreur.node.name, 0) : null };
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
  })().catch((e) => { process.stderr.write(`sonde : ${affichable(e.message, 'erreur (message non affichable)')}\n`); process.exitCode = 1; });
}
