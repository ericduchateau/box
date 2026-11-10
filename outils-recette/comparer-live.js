#!/usr/bin/env node
'use strict';
// Octet-identité dépôt <-> live (recette P4, phase 2) : l'export du workflow importé (GET
// /api/v1/workflows/<id>, LECTURE SEULE) doit contenir EXACTEMENT name, nodes, connections, settings de
// l'export construit depuis le dépôt, sérialisés à l'identique (même ordre de clés). Toute autre clé du
// live doit être une métadonnée d'instance connue (liste fermée ; inconnue = ÉCHEC, à examiner, jamais
// ignorée). Le workflow doit être INACTIF et sans données épinglées. Le contenu du live n'est jamais
// affiché (shared contient l'adresse du propriétaire) : seuls les chemins des écarts le sont.
//
// Usage : FONDA_N8N_CLE_RECETTE=… node outils-recette/comparer-live.js <workflowId> <export.json> [--url <instance>]

const fs = require('fs');
const { fetchLectureSeule, cleDEnvironnement, affichable } = require('./lecture-seule.js');

const CLES_CONTENU = Object.freeze(['name', 'nodes', 'connections', 'settings']);
// Métadonnées d'instance DESCRIPTIVES, ignorées (dont updatedAt, versionId, versionCounter, README §21.0).
// Les ÉTATS (active, isArchived, pinData, staticData, activeVersion, activeVersionId) sont CONTRÔLÉS.
const METADONNEES = Object.freeze(['id', 'createdAt', 'updatedAt', 'versionId', 'versionCounter', 'shared', 'tags',
  'meta', 'triggerCount', 'description', 'parentFolder', 'homeProject', 'scopes']);
const ETATS = Object.freeze(['active', 'isArchived', 'pinData', 'staticData', 'activeVersion', 'activeVersionId']);
const vide = (x) => x === undefined || x === null || (typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === 0);

// a = dépôt, b = live. Les chemins affichés ne contiennent QUE des clés du dépôt ; une clé propre au live
// devient un marqueur indexé (jamais son texte), et aucune valeur n'est affichée.
function ecartsProfonds(a, b, chemin = '$', sortie = []) {
  if (sortie.length >= 50) return sortie;
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || (a === null) !== (b === null)) { sortie.push(`${chemin} : type`); return sortie; }
  if (a && typeof a === 'object') {
    const ka = Object.keys(a); const kb = Object.keys(b);
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) sortie.push(`${chemin}.${k} : absent du live`);
      else ecartsProfonds(a[k], b[k], `${chemin}.${k}`, sortie);
    }
    kb.filter((k) => !Object.prototype.hasOwnProperty.call(a, k)).forEach((k, i) => sortie.push(`${chemin}.<clé inconnue n°${i + 1}> : absente du dépôt`));
    if (!sortie.length && ka.join('\u0000') !== kb.join('\u0000')) sortie.push(`${chemin} : ordre des clés`);
  } else if (a !== b) sortie.push(`${chemin} : valeur`);
  return sortie;
}

function comparer(live, texteExport) {
  const depot = JSON.parse(texteExport);
  const ecarts = [];
  if (Object.keys(depot).join(',') !== CLES_CONTENU.join(',')) ecarts.push('export du dépôt : clés ≠ name, nodes, connections, settings');
  if (!live || typeof live !== 'object' || Array.isArray(live)) return { identique: false, ecarts: ['live : objet attendu'] };
  Object.keys(live).filter((k) => !CLES_CONTENU.includes(k) && !METADONNEES.includes(k) && !ETATS.includes(k)).forEach((k, i) => ecarts.push(`live : clé inconnue n°${i + 1} (à examiner)`));
  if (live.active !== false) ecarts.push('live : workflow ACTIF ou état inconnu (attendu : inactif)');
  if (live.isArchived !== undefined && live.isArchived !== false) ecarts.push('live : workflow archivé');
  if (!vide(live.pinData)) ecarts.push('live : données épinglées');
  if (!vide(live.staticData)) ecarts.push('live : staticData non vide');
  if (!vide(live.activeVersion) || !vide(live.activeVersionId)) ecarts.push('live : version active publiée (attendu : aucune)');
  const contenu = Object.fromEntries(CLES_CONTENU.map((k) => [k, live[k]]));
  const strict = JSON.stringify(contenu, null, 2) === JSON.stringify(depot, null, 2);
  if (!strict) ecarts.push(...ecartsProfonds(depot, contenu));
  if (!strict && !ecarts.length) ecarts.push('sérialisation différente');
  return { identique: ecarts.length === 0, ecarts };
}

async function lireLive({ workflowId, url, cle, fetch: f = globalThis.fetch }) {
  if (typeof workflowId !== 'string' || !/^[A-Za-z0-9]+$/.test(workflowId)) throw new Error('workflowId invalide');
  const lecture = fetchLectureSeule({ url, fetch: f });
  const r = await lecture(`${url}/api/v1/workflows/${workflowId}`, { headers: { 'X-N8N-API-KEY': cle, accept: 'application/json' } });
  if (!r.ok) throw new Error(`API n8n (workflow ${workflowId}) : HTTP ${r.status}`);
  return r.json();
}

module.exports = { CLES_CONTENU, METADONNEES, ETATS, comparer, lireLive };

if (require.main === module) {
  const a = process.argv.slice(2);
  const i = a.indexOf('--url');
  const url = i === -1 ? 'https://n8n.srv868991.hstgr.cloud' : a[i + 1];
  (async () => {
    const live = await lireLive({ workflowId: a[0], url, cle: cleDEnvironnement() });
    const r = comparer(live, fs.readFileSync(a[1], 'utf8'));
    process.stdout.write(`${JSON.stringify({ schema: 'comparaison-live/v1', workflowId: a[0], export: a[1], versionId: typeof live.versionId === 'string' && /^[0-9a-f-]{1,64}$/.test(live.versionId) ? live.versionId : null, ...r }, null, 2)}\n`);
    if (!r.identique) process.exitCode = 1;
  })().catch((e) => { process.stderr.write(`comparer-live : ${affichable(e.message, 'erreur (message non affichable)')}\n`); process.exitCode = 1; });
}
