// Simulateur d'exécution n8n pour les harnais (aucun réseau). Exécute un workflow EXPORTÉ :
// nœuds Code dans un contexte nu (ni require, ni Buffer, ni crypto), nœuds HTTP simulés,
// IF (sous-ensemble des opérateurs utilisés), Respond to Webhook, sortie d'erreur
// (onError: continueErrorOutput). Sémantique reproduite de n8n 2.6.3 sur ces points :
//   - HTTP : `neverError` -> tout statut sort par la sortie principale ; sinon statut >= 400
//     = erreur ; `fullResponse` -> { statusCode, headers, body } ; erreur de transport =
//     exception (sortie d'erreur si continueErrorOutput, sinon échec de l'exécution) ;
//   - Respond : code `options.responseCode`, 200 par défaut (absence = 200).

'use strict';

const vm = require('vm');

const json = (v) => JSON.parse(JSON.stringify(v));

// Expression n8n « ={{ … }} » évaluée dans un contexte nu avec $ et $json.
function evaluer(valeur, ctx) {
  if (typeof valeur === 'string' && valeur.startsWith('={{') && valeur.endsWith('}}')) {
    return vm.runInNewContext(`(${valeur.slice(3, -2)})`, { $: ctx.$, $json: ctx.$json });
  }
  if (Array.isArray(valeur)) return valeur.map((v) => evaluer(v, ctx));
  if (valeur && typeof valeur === 'object') return Object.fromEntries(Object.entries(valeur).map(([k, v]) => [k, evaluer(v, ctx)]));
  return valeur;
}

// IF v2 : sous-ensemble utilisé (booléen « true », nombre « equals »), validation stricte.
function conditionVraie(c, ctx) {
  const g = evaluer(c.leftValue, ctx);
  const op = c.operator || {};
  if (op.type === 'boolean' && op.operation === 'true') return g === true;
  if (op.type === 'number' && op.operation === 'equals') return typeof g === 'number' && g === c.rightValue;
  throw new Error(`opérateur IF non simulé : ${JSON.stringify(op)}`);
}

// reponses : { [nom de nœud HTTP]: async (requête évaluée) -> { statusCode, body } | lève }.
async function executerGraphe(wf, { corps, entetes = {}, reponses = {}, executionId = '601', contexteCode = {} }) {
  const sorties = {};
  const runData = {};
  const requetes = {};
  let reponseWebhook = null;
  const $ = (nom) => {
    if (!sorties[nom]) throw new Error(`nœud ${nom} non exécuté`);
    return { all: () => sorties[nom], first: () => sorties[nom][0], item: sorties[nom][0] };
  };
  const parNom = new Map(wf.nodes.map((n) => [n.name, n]));
  const depart = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  const file = [[depart.name, null]];
  while (file.length) {
    const [nom, entree] = file.shift();
    const n = parNom.get(nom);
    let parSortie; // tableau indexé par sortie : items ou null
    try {
      if (n.type === 'n8n-nodes-base.webhook') parSortie = [[{ json: { headers: entetes, params: {}, query: {}, body: corps } }]];
      else if (n.type === 'n8n-nodes-base.code') {
        const $input = { all: () => entree, first: () => entree[0] };
        const fn = vm.runInNewContext(`(async function () {\n${n.parameters.jsCode}\n})`, { $input, $, $execution: { id: executionId }, ...contexteCode });
        parSortie = [json(await fn())];
      } else if (n.type === 'n8n-nodes-base.if') {
        const ctx = { $, $json: entree[0].json };
        const vrai = n.parameters.conditions.conditions.every((c) => conditionVraie(c, ctx));
        parSortie = vrai ? [entree, null] : [null, entree];
      } else if (n.type === 'n8n-nodes-base.respondToWebhook') {
        if (reponseWebhook) throw new Error('second Respond to Webhook');
        const ctx = { $, $json: entree[0].json };
        const code = (n.parameters.options && n.parameters.options.responseCode) || 200;
        reponseWebhook = { code, corps: JSON.parse(evaluer(n.parameters.responseBody, ctx)), noeud: n.name };
        parSortie = [entree];
      } else if (n.type === 'n8n-nodes-base.httpRequest') {
        const requete = evaluer(n.parameters, { $, $json: entree[0].json });
        requetes[n.name] = requete;
        const opt = (n.parameters.options && n.parameters.options.response && n.parameters.options.response.response) || {};
        let rep;
        try {
          if (!reponses[n.name]) throw new Error(`réponse simulée absente pour ${n.name}`);
          rep = await reponses[n.name](requete);
          if (!opt.neverError && rep.statusCode >= 400) throw new Error(`HTTP ${rep.statusCode}`);
        } catch (e) {
          if (n.onError === 'continueErrorOutput') { parSortie = [null, [{ json: { error: { message: e.message } } }]]; rep = null; } else throw e;
        }
        if (rep) parSortie = [[{ json: json(opt.fullResponse ? { statusCode: rep.statusCode, headers: {}, body: rep.body } : rep.body) }], null];
      } else throw new Error(`type de nœud non simulé : ${n.type}`);
    } catch (e) {
      return { status: 'error', noeudErreur: n.name, erreur: e.message, runData, requetes, sorties, reponseWebhook };
    }
    const principale = parSortie.find((x) => x) || [];
    sorties[n.name] = principale;
    runData[n.name] = [{ data: { main: parSortie.map((x) => x || []) } }];
    const conn = (wf.connections[n.name] || {}).main || [];
    parSortie.forEach((items, i) => { if (items) for (const c of conn[i] || []) file.push([c.node, items]); });
  }
  return { status: 'success', runData, requetes, sorties, reponseWebhook };
}

module.exports = { executerGraphe, evaluer };
