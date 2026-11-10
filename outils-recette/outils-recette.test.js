'use strict';
// Tests des outils de recette P4 : la LECTURE SEULE est prouvée (aucune requête autre qu'un GET sans
// corps, vers l'instance et un chemin de la liste blanche, n'atteint le réseau), la sonde observe comme
// le signataire et ne divulgue aucune donnée d'exécution, le comparateur dépôt <-> live est strict.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const path = require('path');
const LS = require('./lecture-seule.js');
const S = require('./sonde-executions.js');
const CL = require('./comparer-live.js');

const URL_I = 'https://n8n.exemple.test';
const reponse = (corps, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => corps });
// Faux réseau : enregistre CHAQUE appel qui l'atteint ; sémantique n8n 2.6.3 (liste sans status = sans actives).
function reseau(executions, details = {}) {
  const appels = [];
  const f = async (url, init) => {
    appels.push({ url, init });
    const u = new URL(url);
    if (u.pathname === '/api/v1/executions') {
      const st = u.searchParams.get('status');
      const wf = u.searchParams.get('workflowId');
      const d = executions.filter((x) => x.workflowId === wf && (st ? x.status === st : !['running', 'waiting'].includes(x.status)));
      return reponse({ data: d, nextCursor: null });
    }
    const m = u.pathname.match(/^\/api\/v1\/executions\/(\d+)$/);
    if (m) return details[m[1]] ? reponse(details[m[1]]) : reponse({}, 404);
    return reponse({}, 404);
  };
  return { f, appels };
}

describe('lecture seule : prouvée avant le réseau', () => {
  const { f, appels } = reseau([]);
  const g = LS.fetchLectureSeule({ url: URL_I, fetch: f });
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'HEAD', 'OPTIONS']) {
    test(`méthode ${m} refusée, aucun appel réseau`, async () => {
      await assert.rejects(g(`${URL_I}/api/v1/executions`, { method: m }), /méthode/);
    });
  }
  test('corps refusé même en GET ; autre origine, sous-domaine, identifiants dans l\'URL, chemin hors liste refusés', async () => {
    await assert.rejects(g(`${URL_I}/api/v1/executions`, { body: '{}' }), /corps/);
    await assert.rejects(g('https://autre.test/api/v1/executions'), /origine/);
    await assert.rejects(g('https://n8n.exemple.test.evil.test/api/v1/executions'), /origine/);
    await assert.rejects(g('http://n8n.exemple.test/api/v1/executions'), /origine/);
    await assert.rejects(g('/api/v1/executions'), /Invalid URL|URL/);
    await assert.rejects(g('https://u:p@n8n.exemple.test/api/v1/executions'), /identifiants/);
    for (const c of ['/api/v1/workflows/abc/activate', '/api/v1/workflows/abc/deactivate', '/api/v1/executions/12/retry', '/api/v1/executions/12/stop', '/api/v1/credentials', '/webhook/fonda-recette-select', '/api/v1/executions/../workflows', '/api/v1/data-tables/x/rows'])
      await assert.rejects(g(`${URL_I}${c}`), /chemin|hors liste/, c);
    assert.equal(appels.length, 0, 'aucune requête refusée n\'a atteint le réseau');
  });
  test('GET admis : méthode forcée à GET, redirections refusées, en-têtes transmis', async () => {
    await g(`${URL_I}/api/v1/executions?workflowId=a`, { headers: { a: '1' } });
    assert.deepEqual(appels.at(-1).init, { headers: { a: '1' }, method: 'GET', redirect: 'error' });
  });
  test('instance : HTTPS exigé, base sans chemin, requête, fragment ni identifiants', () => {
    for (const u of ['http://n8n.exemple.test', 'https://n8n.exemple.test/api', 'https://n8n.exemple.test/?a=1', 'https://n8n.exemple.test/#x', 'https://u:p@n8n.exemple.test', 'pas une url', 'ftp://n8n.exemple.test'])
      assert.throws(() => LS.fetchLectureSeule({ url: u, fetch: f }), /HTTPS|sans chemin|invalide/, u);
    assert.equal(LS.origineInstance('https://n8n.exemple.test/'), 'https://n8n.exemple.test');
  });
  test('réponse JSON illisible ou transport en échec : message FIXE, aucun extrait du corps', async () => {
    const h = LS.fetchLectureSeule({ url: URL_I, fetch: async () => ({ ok: true, status: 200, json: async () => JSON.parse('SECRET_SYNTHETIQUE{') }) });
    const r = await h(`${URL_I}/api/v1/executions`);
    await assert.rejects(r.json(), (e) => e.message === 'lecture seule : réponse JSON illisible');
    const t = LS.fetchLectureSeule({ url: URL_I, fetch: async () => { throw new Error('SECRET_SYNTHETIQUE'); } });
    await assert.rejects(t(`${URL_I}/api/v1/executions`), (e) => e.message === 'lecture seule : échec du transport');
  });
  test('clé d\'API : environnement seulement, absente ou vide -> erreur', () => {
    assert.throws(() => LS.cleDEnvironnement('X', {}), /absente/);
    assert.throws(() => LS.cleDEnvironnement('X', { X: '  ' }), /absente/);
    assert.equal(LS.cleDEnvironnement('X', { X: ' k ' }), 'k');
  });
});

describe('sonde-executions : observe comme le signataire (running, waiting, liste), GET seulement', () => {
  const ex = [
    { id: 1, workflowId: 'WfA', status: 'success', startedAt: '2026-11-10T10:00:00.000Z', stoppedAt: '2026-11-10T10:00:01.000Z' },
    { id: 2, workflowId: 'WfA', status: 'waiting', startedAt: '2026-11-10T10:01:00.000Z', stoppedAt: null },
    { id: 3, workflowId: 'WfA', status: 'running', startedAt: '2026-11-10T10:02:00.000Z', stoppedAt: null },
    { id: 4, workflowId: 'Autre', status: 'running', startedAt: '2026-11-10T10:02:00.000Z', stoppedAt: null },
  ];
  test('exécutions EN VOL vues (absentes de la liste sans filtre) ; chaque appel = GET liste blanche', async () => {
    const { f, appels } = reseau(ex);
    const r = await S.sonder({ workflowId: 'WfA', url: URL_I, cle: 'k', fetch: f });
    assert.deepEqual(r.brut.liste.map((x) => x.id), ['1']);
    assert.deepEqual(r.brut.running.map((x) => x.id), ['3']);
    assert.deepEqual(r.brut.waiting.map((x) => x.id), ['2']);
    assert.deepEqual(r.en_vol.sort(), ['2', '3']);
    assert.equal(r.refus_observer, null);
    assert.equal(appels.length, 3, 'UNE seule série : running, waiting, liste (celle consommée par observer())');
    for (const a of appels) { assert.equal(a.init.method, 'GET'); assert.equal(new URL(a.url).pathname, '/api/v1/executions'); assert.equal(a.init.headers['X-N8N-API-KEY'], 'k'); }
  });
  test('observations contradictoires (startedAt différent entre waiting et liste) : refus d\'observer() remonté, jamais masqué', async () => {
    const f = async (url, init) => { const st = new URL(url).searchParams.get('status'); return reponse({ data: st === 'running' ? [] : [{ id: 9, workflowId: 'WfA', status: st === 'waiting' ? 'waiting' : 'success', startedAt: st ? '2026-11-10T10:00:00.000Z' : '2026-11-10T10:05:00.000Z', stoppedAt: st ? null : '2026-11-10T10:06:00.000Z' }], nextCursor: null }); };
    const r = await S.sonder({ workflowId: 'WfA', url: URL_I, cle: 'k', fetch: f });
    assert.equal(r.fusion, null); assert.equal(r.en_vol, null);
    assert.match(r.refus_observer, /contradictoires \(startedAt\)/);
    assert.deepEqual(Object.keys(r.brut).sort(), ['liste', 'running', 'waiting'], 'brut = les réponses consommées par observer(), même en cas de refus');
    assert.equal(r.brut.liste[0].startedAt, '2026-11-10T10:05:00.000Z');
  });
  test('brut et fusion viennent de la MÊME série (une exécution qui change d\'état entre deux appels est cohérente)', async () => {
    let n = 0;
    const f = async (url) => { const st = new URL(url).searchParams.get('status'); n += 1;
      // running vu à l'appel 1, terminé ensuite : une seconde série verrait une autre image.
      const x = { id: 5, workflowId: 'WfA', startedAt: '2026-11-10T10:00:00.000Z' };
      return reponse({ data: st === 'running' && n === 1 ? [{ ...x, status: 'running', stoppedAt: null }] : (!st ? [{ ...x, status: 'success', stoppedAt: '2026-11-10T10:00:09.000Z' }] : []), nextCursor: null }); };
    const r = await S.sonder({ workflowId: 'WfA', url: URL_I, cle: 'k', fetch: f });
    assert.equal(n, 3);
    assert.deepEqual(r.brut.running.map((x) => x.id), ['5']);
    assert.deepEqual(r.fusion, [{ id: '5', status: 'success' }]);
  });
  test('valeurs hors grammaire (statut, dates, message de refus) jamais restituées', async () => {
    const f = async (url) => { const st = new URL(url).searchParams.get('status'); return reponse({ data: st ? [] : [{ id: 6, workflowId: 'WfA', status: 'SECRET {x}', startedAt: 'SECRET_DATE{', stoppedAt: null }], nextCursor: null }); };
    const r = await S.sonder({ workflowId: 'WfA', url: URL_I, cle: 'k', fetch: f });
    assert.equal(JSON.stringify(r).includes('SECRET'), false);
  });
  test('--execution : statut, runData présent, noms de nœuds ; AUCUNE donnée d\'exécution dans la sortie', async () => {
    const secret = 'k-secrete-0123456789abcdef'; const adresse = 'relecteur@exemple.test';
    const { f, appels } = reseau([], { 77: { id: 77, workflowId: 'WfA', status: 'error', mode: 'webhook', startedAt: 'a', stoppedAt: 'b',
      data: { resultData: { runData: { 'FONDA Entree confirmation': [{ data: { main: [[{ json: { k: secret, adresse } }]] } }], Webhook: [], [`noeud ${secret} {}`]: [] }, error: { node: { name: 'Verifier formulaire' }, message: secret } } } } });
    const r = await S.sonderExecution({ id: '77', url: URL_I, cle: 'k', fetch: f });
    assert.deepEqual(r.noeuds_executes, ['FONDA Entree confirmation', 'Webhook', '<nom hors grammaire n°2>']);
    assert.equal(r.runData_present, true); assert.equal(r.erreur_noeud, 'Verifier formulaire');
    const t = JSON.stringify(r); assert.equal(t.includes(secret), false); assert.equal(t.includes(adresse), false);
    assert.deepEqual(appels.map((a) => [a.init.method, new URL(a.url).pathname]), [['GET', '/api/v1/executions/77']]);
    assert.deepEqual(await S.sonderExecution({ id: '78', url: URL_I, cle: 'k', fetch: f }), { schema: 'sonde-execution/v1', id: '78', present: false });
  });
  test('entrées invalides refusées avant le réseau', async () => {
    const { f, appels } = reseau([]);
    await assert.rejects(S.sonder({ workflowId: 'a/../b', url: URL_I, cle: 'k', fetch: f }), /workflowId/);
    await assert.rejects(S.sonderExecution({ id: '1/retry', url: URL_I, cle: 'k', fetch: f }), /identifiant/);
    assert.equal(appels.length, 0);
  });
});

describe('comparer-live : dépôt <-> live strict, métadonnées en liste fermée', () => {
  const texte = fs.readFileSync(path.join(__dirname, '..', 'n8n', 'fonda-relecture-page', 'box-fonda-page-relecture.recette.json'), 'utf8');
  const live = () => ({ updatedAt: 'x', createdAt: 'x', id: 'WfA', ...JSON.parse(texte), active: false, isArchived: false, versionId: 'v', versionCounter: 1, shared: [{ role: 'o', user: { email: 'proprietaire@exemple.test' } }], tags: [], pinData: {}, meta: null, staticData: null, triggerCount: 0 });
  test('import fidèle -> identique (métadonnées d\'instance ignorées)', () => { assert.deepEqual(CL.comparer(live(), texte), { identique: true, ecarts: [] }); });
  test('un paramètre modifié, un nœud ajouté, un réglage changé -> écart localisé', () => {
    const a = live(); a.nodes[0].parameters.path = 'fonda-select'; assert.match(CL.comparer(a, texte).ecarts.join(), /nodes\.0\.parameters\.path : valeur/);
    const d = live(); d.connections.SECRET_SYNTHETIQUE = {}; const e = CL.comparer(d, texte).ecarts;
    assert.deepEqual(e, ['$.connections.<clé inconnue n°1> : absente du dépôt']);
    const b = live(); b.nodes.push({ name: 'X' }); assert.equal(CL.comparer(b, texte).identique, false);
    const c = live(); c.settings.executionTimeout = 999; assert.deepEqual(CL.comparer(c, texte).ecarts, ['$.settings.<clé inconnue n°1> : absente du dépôt']);
    const c2 = live(); c2.settings.executionOrder = 'v0'; assert.deepEqual(CL.comparer(c2, texte).ecarts, ['$.settings.executionOrder : valeur']);
  });
  test('ordre des clés différent -> NON identique (octet-identité, pas seulement égalité profonde)', () => {
    const a = live(); const n = a.nodes[0]; a.nodes[0] = Object.fromEntries(Object.entries(n).reverse());
    assert.deepEqual(CL.comparer(a, texte).ecarts, ['$.nodes.0 : ordre des clés']);
  });
  test('ACTIF, données épinglées, clé inconnue -> échec ; contenu du live jamais restitué', () => {
    const a = live(); a.active = true; assert.match(CL.comparer(a, texte).ecarts.join(), /ACTIF/);
    const a2 = live(); delete a2.active; assert.match(CL.comparer(a2, texte).ecarts.join(), /ACTIF ou état inconnu/);
    const b = live(); b.pinData = { X: [{}] }; assert.match(CL.comparer(b, texte).ecarts.join(), /épinglées/);
    const c = live(); c.SECRET_SYNTHETIQUE = 1; assert.deepEqual(CL.comparer(c, texte).ecarts, ['live : clé inconnue n°1 (à examiner)']);
    assert.equal(JSON.stringify(CL.comparer(c, texte)).includes('proprietaire@'), false);
  });
  test('états contrôlés : archivé, staticData non vide, version active publiée -> échec', () => {
    const a = live(); a.isArchived = true; assert.match(CL.comparer(a, texte).ecarts.join(), /archivé/);
    const b = live(); b.staticData = { global: { x: 1 } }; assert.match(CL.comparer(b, texte).ecarts.join(), /staticData/);
    const c = live(); c.activeVersion = { versionId: 'v' }; assert.match(CL.comparer(c, texte).ecarts.join(), /version active/);
    const d = live(); d.activeVersionId = 'v'; assert.match(CL.comparer(d, texte).ecarts.join(), /version active/);
    const e = live(); e.activeVersion = null; e.activeVersionId = null; e.staticData = {}; assert.equal(CL.comparer(e, texte).identique, true);
  });
  test('lecture du live : GET /api/v1/workflows/<id> seulement', async () => {
    const appels = []; const f = async (url, init) => { appels.push([init.method, new URL(url).pathname]); return reponse(live()); };
    await CL.lireLive({ workflowId: 'WfA', url: URL_I, cle: 'k', fetch: f });
    assert.deepEqual(appels, [['GET', '/api/v1/workflows/WfA']]);
    await assert.rejects(CL.lireLive({ workflowId: 'WfA/activate', url: URL_I, cle: 'k', fetch: f }), /workflowId/);
  });
});

describe('lignes de commande : stdout et stderr sans extrait de réponse ni secret', () => {
  // fetch simulé par préchargement (aucun réseau) : corps JSON malformé contenant un secret synthétique.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outils-recette-'));
  const pre = path.join(dir, 'faux-fetch.js');
  fs.writeFileSync(pre, "globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => JSON.parse('SECRET_SYNTHETIQUE{') });\n");
  const lancer = (script, args) => spawnSync(process.execPath, ['-r', pre, path.join(__dirname, script), ...args], { env: { ...process.env, FONDA_N8N_CLE_RECETTE: 'CLE_SYNTHETIQUE' }, encoding: 'utf8' });
  for (const [script, args] of [['sonde-executions.js', ['WfA', '--url', URL_I]], ['sonde-executions.js', ['--execution', '12', '--url', URL_I]], ['comparer-live.js', ['WfA', path.join(__dirname, '..', 'n8n', 'fonda-relecture-page', 'box-fonda-page-relecture.recette.json'), '--url', URL_I]]]) {
    test(`${script} ${args[0]} : échec propre, aucun secret ni extrait`, () => {
      const r = lancer(script, args);
      const t = r.stdout + r.stderr;
      assert.equal(t.includes('SECRET_SYNTHETIQUE'), false, t);
      assert.equal(t.includes('CLE_SYNTHETIQUE'), false, t);
      if (script === 'comparer-live.js') { assert.equal(r.status, 1); assert.match(r.stderr, /réponse JSON illisible/); }
    });
  }
  test('URL http refusée par la ligne de commande (clé jamais en clair)', () => {
    const r = lancer('comparer-live.js', ['WfA', 'x.json', '--url', 'http://n8n.exemple.test']);
    assert.equal(r.status, 1); assert.match(r.stderr, /HTTPS exigé/);
  });
});
