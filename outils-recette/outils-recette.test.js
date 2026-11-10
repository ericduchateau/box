'use strict';
// Tests des outils de recette P4 : la LECTURE SEULE est prouvée (aucune requête autre qu'un GET sans
// corps, vers l'instance et un chemin de la liste blanche, n'atteint le réseau), la sonde observe comme
// le signataire et ne divulgue aucune donnée d'exécution, le comparateur dépôt <-> live est strict.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
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
    await assert.rejects(g('https://u:p@n8n.exemple.test/api/v1/executions'), /identifiants/);
    for (const c of ['/api/v1/workflows/abc/activate', '/api/v1/workflows/abc/deactivate', '/api/v1/executions/12/retry', '/api/v1/executions/12/stop', '/api/v1/credentials', '/webhook/fonda-recette-select', '/api/v1/executions/../workflows', '/api/v1/data-tables/x/rows'])
      await assert.rejects(g(`${URL_I}${c}`), /chemin|hors liste/, c);
    assert.equal(appels.length, 0, 'aucune requête refusée n\'a atteint le réseau');
  });
  test('GET admis : méthode forcée à GET, redirections refusées, en-têtes transmis', async () => {
    await g(`${URL_I}/api/v1/executions?workflowId=a`, { headers: { a: '1' } });
    assert.deepEqual(appels.at(-1).init, { headers: { a: '1' }, method: 'GET', redirect: 'error' });
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
    assert.ok(appels.length >= 6);
    for (const a of appels) { assert.equal(a.init.method, 'GET'); assert.equal(new URL(a.url).pathname, '/api/v1/executions'); assert.equal(a.init.headers['X-N8N-API-KEY'], 'k'); }
  });
  test('observations contradictoires (startedAt différent entre waiting et liste) : refus d\'observer() remonté, jamais masqué', async () => {
    const f = async (url, init) => { const st = new URL(url).searchParams.get('status'); return reponse({ data: st === 'running' ? [] : [{ id: 9, workflowId: 'WfA', status: st === 'waiting' ? 'waiting' : 'success', startedAt: st ? '2026-11-10T10:00:00.000Z' : '2026-11-10T10:05:00.000Z', stoppedAt: st ? null : '2026-11-10T10:06:00.000Z' }], nextCursor: null }); };
    const r = await S.sonder({ workflowId: 'WfA', url: URL_I, cle: 'k', fetch: f });
    assert.equal(r.fusion, null); assert.equal(r.en_vol, null);
    assert.match(r.refus_observer, /contradictoires \(startedAt\)/);
  });
  test('--execution : statut, runData présent, noms de nœuds ; AUCUNE donnée d\'exécution dans la sortie', async () => {
    const secret = 'k-secrete-0123456789abcdef'; const adresse = 'relecteur@exemple.test';
    const { f, appels } = reseau([], { 77: { id: 77, workflowId: 'WfA', status: 'error', mode: 'webhook', startedAt: 'a', stoppedAt: 'b',
      data: { resultData: { runData: { 'FONDA Entree confirmation': [{ data: { main: [[{ json: { k: secret, adresse } }]] } }], Webhook: [] }, error: { node: { name: 'Verifier formulaire' }, message: secret } } } } });
    const r = await S.sonderExecution({ id: '77', url: URL_I, cle: 'k', fetch: f });
    assert.deepEqual(r.noeuds_executes, ['FONDA Entree confirmation', 'Webhook']);
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
    const b = live(); b.nodes.push({ name: 'X' }); assert.equal(CL.comparer(b, texte).identique, false);
    const c = live(); c.settings.executionTimeout = 999; assert.match(CL.comparer(c, texte).ecarts.join(), /settings\.executionTimeout/);
  });
  test('ordre des clés différent -> NON identique (octet-identité, pas seulement égalité profonde)', () => {
    const a = live(); const n = a.nodes[0]; a.nodes[0] = Object.fromEntries(Object.entries(n).reverse());
    assert.deepEqual(CL.comparer(a, texte).ecarts, ['$.nodes.0 : ordre des clés']);
  });
  test('ACTIF, données épinglées, clé inconnue -> échec ; contenu du live jamais restitué', () => {
    const a = live(); a.active = true; assert.match(CL.comparer(a, texte).ecarts.join(), /ACTIF/);
    const b = live(); b.pinData = { X: [{}] }; assert.match(CL.comparer(b, texte).ecarts.join(), /épinglées/);
    const c = live(); c.nouveauChamp = 1; assert.match(CL.comparer(c, texte).ecarts.join(), /clé inconnue « nouveauChamp »/);
    assert.equal(JSON.stringify(CL.comparer(c, texte)).includes('proprietaire@'), false);
  });
  test('lecture du live : GET /api/v1/workflows/<id> seulement', async () => {
    const appels = []; const f = async (url, init) => { appels.push([init.method, new URL(url).pathname]); return reponse(live()); };
    await CL.lireLive({ workflowId: 'WfA', url: URL_I, cle: 'k', fetch: f });
    assert.deepEqual(appels, [['GET', '/api/v1/workflows/WfA']]);
    await assert.rejects(CL.lireLive({ workflowId: 'WfA/activate', url: URL_I, cle: 'k', fetch: f }), /workflowId/);
  });
});
