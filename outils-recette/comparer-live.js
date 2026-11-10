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
const path = require('path');
const { fetchLectureSeule, cleDEnvironnement, origineInstance, messageSur } = require('./lecture-seule.js');
const { analyser } = require('./arguments.js');

const CLES_CONTENU = Object.freeze(['name', 'nodes', 'connections', 'settings']);
// Métadonnées d'instance DESCRIPTIVES, ignorées (dont updatedAt, versionId, versionCounter, README §21.0).
// Les ÉTATS (active, isArchived, pinData, staticData, activeVersion, activeVersionId) sont CONTRÔLÉS.
const METADONNEES = Object.freeze(['id', 'createdAt', 'updatedAt', 'versionId', 'versionCounter', 'shared', 'tags',
  'meta', 'triggerCount', 'description', 'parentFolder', 'homeProject', 'scopes']);
const ETATS = Object.freeze(['active', 'isArchived', 'pinData', 'staticData', 'activeVersion', 'activeVersionId']);
// Types EXACTS (connu-bon) : nul ou absent, ou objet simple vide.
const nulOuAbsent = (x) => x === undefined || x === null;
const vide = (x) => nulOuAbsent(x) || (typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype && Object.keys(x).length === 0);

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
  if (live.active !== false) ecarts.push('live : workflow ACTIF ou état inconnu (attendu : active = false)');
  if (live.isArchived !== false) ecarts.push('live : archivé ou état inconnu (attendu : isArchived = false)');
  if (!vide(live.pinData)) ecarts.push('live : données épinglées');
  if (!vide(live.staticData)) ecarts.push('live : staticData non vide');
  if (!nulOuAbsent(live.activeVersion) || !nulOuAbsent(live.activeVersionId)) ecarts.push('live : version active publiée ou état inconnu (attendu : nulle)');
  const contenu = Object.fromEntries(CLES_CONTENU.map((k) => [k, live[k]]));
  const strict = JSON.stringify(contenu, null, 2) === JSON.stringify(depot, null, 2);
  if (!strict) ecarts.push(...ecartsProfonds(depot, contenu));
  if (!strict && !ecarts.length) ecarts.push('sérialisation différente');
  return { identique: ecarts.length === 0, ecarts };
}

async function lireLive({ workflowId, url, cle, fetch: f = globalThis.fetch }) {
  if (typeof workflowId !== 'string' || !/^[A-Za-z0-9]{1,40}$/.test(workflowId)) throw new Error('workflowId invalide');
  const base = origineInstance(url);
  const lecture = fetchLectureSeule({ url: base, fetch: f });
  const r = await lecture(`${base}/api/v1/workflows/${workflowId}`, { headers: { 'X-N8N-API-KEY': cle, accept: 'application/json' } });
  if (!r.ok) throw new Error(`API n8n : HTTP ${Number.isInteger(r.status) ? r.status : 0}`);
  return r.json();
}

async function principal(argv, { fetch: f = globalThis.fetch, env = process.env } = {}) {
  const { options, positionnels } = analyser(argv, { options: ['--url'], positionnels: 2 });
  const [workflowId, fichier] = positionnels;
  const url = origineInstance(options['--url'] || 'https://n8n.srv868991.hstgr.cloud'); // HTTPS vérifié AVANT tout
  const cle = cleDEnvironnement('FONDA_N8N_CLE_RECETTE', env);
  let texte;
  try { texte = fs.readFileSync(fichier, 'utf8'); JSON.parse(texte); } catch { throw new Error('export du dépôt illisible'); }
  const live = await lireLive({ workflowId, url, cle, fetch: f });
  const r = comparer(live, texte);
  return { r: { schema: 'comparaison-live/v1', workflowId, export: path.basename(fichier), versionId: typeof live.versionId === 'string' && /^[0-9a-f-]{1,64}$/.test(live.versionId) ? live.versionId : null, ...r }, code: r.identique ? 0 : 1 };
}

module.exports = { CLES_CONTENU, METADONNEES, ETATS, comparer, lireLive, principal };

if (require.main === module) {
  principal(process.argv.slice(2)).then(({ r, code }) => { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); process.exitCode = code; })
    .catch((e) => { process.stderr.write(`comparer-live : ${messageSur(e)}\n`); process.exitCode = 1; });
}
