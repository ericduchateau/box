'use strict';
// Tests des outils de recette P4. Règle : tout ce qui peut atteindre l'instance, et tout ce qui est affiché,
// appartient à un ENSEMBLE FERMÉ de connu-bon. Prouvé ici, sans aucun réseau (fetch simulé) :
//   - transport : instance, méthode, corps, en-têtes, route ET paramètres de requête PAR ROUTE (dont le curseur
//     renvoyé par le serveur) en listes fermées ; rien d'autre n'atteint le réseau ;
//   - sonde : une seule série d'observations, sorties en ensembles fermés, codes 0 / 1 / 2 jamais confondus ;
//   - comparateur : références en liste fermée, états live typés, écarts sans contenu du live ;
//   - lignes de commande : arguments stricts, messages reconstruits, aucun secret ni extrait sur stdout/stderr.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const path = require('path');
const LS = require('./lecture-seule.js');
const S = require('./sonde-executions.js');
const CL = require('./comparer-live.js');
const AR = require('./arguments.js');

const URL_I = LS.INSTANCES[0];
const CLE = 'cle-de-test-synthetique-0123456789';
const H = { 'X-N8N-API-KEY': CLE, accept: 'application/json' };
const LISTE = `${URL_I}/api/v1/executions?workflowId=WfA&limit=250`;
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
const sans = (t, ...secrets) => secrets.every((x) => !t.includes(x));

describe('transport : ENSEMBLES FERMÉS vérifiés avant le réseau', () => {
  const { f, appels } = reseau([]);
  const g = LS.fetchLectureSeule({ url: URL_I, fetch: f });
  const refuse = async (cible, init, code) => { await assert.rejects(g(cible, init), (e) => e instanceof LS.ErreurOutil && e.code === code, `${cible} ${JSON.stringify(init && init.method)}`); };
  test('instance : liste fermée d\'origines HTTPS exactes', () => {
    for (const u of ['http://n8n.srv868991.hstgr.cloud', 'https://n8n.exemple.test', 'https://n8n.srv868991.hstgr.cloud.evil.test', 'https://n8n.srv868991.hstgr.cloud:8443',
      'https://n8n.srv868991.hstgr.cloud/api', 'https://n8n.srv868991.hstgr.cloud/?a=1', 'https://n8n.srv868991.hstgr.cloud/#x', 'https://u:p@n8n.srv868991.hstgr.cloud', 'pas une url', '']) {
      assert.throws(() => LS.origineInstance(u), (e) => e.code === 'INSTANCE', u);
    }
    assert.equal(LS.origineInstance(`${URL_I}/`), URL_I);
  });
  test('méthodes autres que GET, corps, origine, route : refusés', async () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'get', 'HEAD', 'OPTIONS']) await refuse(LISTE, { method: m, headers: H }, 'METHODE');
    await refuse(LISTE, { body: '{}', headers: H }, 'CORPS');
    await refuse('https://autre.test/api/v1/executions?workflowId=WfA&limit=250', { headers: H }, 'ORIGINE');
    await refuse(`${URL_I.replace('https://', 'https://u:p@')}/api/v1/executions?workflowId=WfA&limit=250`, { headers: H }, 'ORIGINE');
    await refuse('/api/v1/executions', { headers: H }, 'URL');
    for (const c of ['/api/v1/workflows/abc/activate', '/api/v1/workflows/abc/deactivate', '/api/v1/executions/12/retry', '/api/v1/executions/12/stop', '/api/v1/credentials',
      '/webhook/fonda-recette-select', '/api/v1/data-tables/x/rows', '/api/v1/executions/', '/api/v1/executions/1a', '//api/v1/executions', '/api/v1/workflows/a-b'])
      await refuse(`${URL_I}${c}`, { headers: H }, 'ROUTE');
    assert.equal(appels.length, 0);
  });
  test('paramètres de requête PAR ROUTE : clé inconnue, doublon, valeur hors liste/grammaire, obligatoire absent -> refusés', async () => {
    const base = `${URL_I}/api/v1/executions`;
    for (const q of ['workflowId=WfA', 'limit=250', 'workflowId=WfA&limit=100', 'workflowId=WfA&limit=250&status=success', 'workflowId=WfA&limit=250&status=running&status=waiting',
      'workflowId=W-A&limit=250', 'workflowId=WfA&workflowId=WfB&limit=250', 'workflowId=WfA&limit=250&includeData=true', 'workflowId=WfA&limit=250&cursor=',
      'workflowId=WfA&limit=250&cursor=%5Bobject+Object%5D', `workflowId=WfA&limit=250&cursor=${'a'.repeat(513)}`, 'workflowId=WfA&limit=250&cursor=a&cursor=b', 'workflowId=WfA&limit=250&x=1'])
      await refuse(`${base}?${q}`, { headers: H }, 'PARAMETRE');
    for (const q of ['', '?includeData=false', '?includeData=true&includeData=true', '?includeData=true&x=1']) await refuse(`${URL_I}/api/v1/executions/12${q}`, { headers: H }, 'PARAMETRE');
    await refuse(`${URL_I}/api/v1/workflows/WfA?excludePinnedData=true`, { headers: H }, 'PARAMETRE');
    assert.equal(appels.length, 0);
  });
  test('en-têtes : liste fermée (clé en grammaire bornée, accept = application/json)', async () => {
    for (const h of [undefined, {}, { ...H, extra: '1' }, { 'X-N8N-API-KEY': CLE }, { ...H, accept: '*/*' }, { ...H, 'X-N8N-API-KEY': 'courte' }, { ...H, 'X-N8N-API-KEY': `${CLE}\r\nX: y` }])
      await refuse(LISTE, { headers: h }, 'ENTETES');
    assert.equal(appels.length, 0);
  });
  test('requêtes admises : exactement les formes de l\'adaptateur ; méthode GET forcée, redirections refusées, en-têtes reconstruits', async () => {
    for (const u of [LISTE, `${LISTE}&status=running`, `${LISTE}&status=waiting&cursor=eyJpZCI6MTJ9`, `${URL_I}/api/v1/executions/12?includeData=true`, `${URL_I}/api/v1/workflows/WfA`]) await g(u, { headers: H });
    assert.equal(appels.length, 5);
    for (const a of appels) assert.deepEqual(a.init, { headers: H, method: 'GET', redirect: 'error' });
  });
  test('réponse JSON illisible, transport en échec, statut non entier : messages FIXES, aucun extrait', async () => {
    const h = LS.fetchLectureSeule({ url: URL_I, fetch: async () => ({ ok: true, status: 200, json: async () => JSON.parse('SECRET_SYNTHETIQUE{') }) });
    await assert.rejects((await h(LISTE, { headers: H })).json(), (e) => e.code === 'JSON' && sans(e.message, 'SECRET'));
    const t = LS.fetchLectureSeule({ url: URL_I, fetch: async () => { throw new Error('SECRET_SYNTHETIQUE'); } });
    await assert.rejects(t(LISTE, { headers: H }), (e) => e.code === 'TRANSPORT' && sans(e.message, 'SECRET'));
    const s = LS.fetchLectureSeule({ url: URL_I, fetch: async () => ({ ok: true, status: 'SECRET', json: async () => ({}) }) });
    const r = await s(LISTE, { headers: H }); assert.deepEqual([r.ok, r.status], [false, 0]);
  });
  test('messageSur : codes de la liste fermée, HTTP reconstruit des 3 chiffres validés, tout le reste -> marqueur', () => {
    assert.equal(LS.messageSur(new LS.ErreurOutil('JSON')), LS.MESSAGES.JSON);
    assert.equal(LS.messageSur(new LS.ErreurOutil('HTTP', 503)), 'API n8n : HTTP 503');
    assert.equal(LS.messageSur(new LS.ErreurOutil('HTTP', 'SECRET')), 'API n8n : HTTP (statut hors grammaire)');
    const ea = Object.assign(new Error('API n8n SECRET_SYNTHETIQUE: HTTP 500'), { name: 'ErreurAdaptateur', statut: 500 });
    assert.equal(LS.messageSur(ea), 'API n8n : HTTP 500');
    for (const e of [new Error('API n8n SECRET: HTTP 500'), Object.assign(new Error('x'), { name: 'ErreurAdaptateur', statut: 'SECRET' }), null, 'SECRET'])
      assert.equal(LS.messageSur(e), 'erreur (message non affichable)');
    assert.throws(() => new LS.ErreurOutil('INCONNU'), /hors liste fermée/);
  });
  test('clé d\'API : variable d\'environnement seulement, grammaire bornée', () => {
    for (const env of [{}, { FONDA_N8N_CLE_RECETTE: '' }, { FONDA_N8N_CLE_RECETTE: 'courte' }, { FONDA_N8N_CLE_RECETTE: `${CLE} ` }, { FONDA_N8N_CLE_RECETTE: `${CLE}\n` }])
      assert.throws(() => LS.cleDEnvironnement(env), (e) => e.code === 'CLE');
    assert.equal(LS.cleDEnvironnement({ FONDA_N8N_CLE_RECETTE: CLE }), CLE);
  });
});

describe('sonde : une seule série, sorties en ensembles fermés, codes 0 / 1 / 2', () => {
  const ex = [
    { id: 1, workflowId: 'WfA', status: 'success', startedAt: '2026-11-10T10:00:00.000Z', stoppedAt: '2026-11-10T10:00:01.000Z' },
    { id: 2, workflowId: 'WfA', status: 'waiting', startedAt: '2026-11-10T10:01:00.000Z', stoppedAt: null },
    { id: 3, workflowId: 'WfA', status: 'running', startedAt: '2026-11-10T10:02:00.000Z', stoppedAt: null },
    { id: 4, workflowId: 'Autre', status: 'running', startedAt: '2026-11-10T10:02:00.000Z', stoppedAt: null },
  ];
  test('exécutions EN VOL vues ; 3 appels exactement (running, waiting, liste), tous conformes au transport', async () => {
    const { f, appels } = reseau(ex);
    const r = await S.sonder({ workflowId: 'WfA', cle: CLE, fetch: f });
    assert.deepEqual([r.brut.liste.map((x) => x.id), r.brut.running.map((x) => x.id), r.brut.waiting.map((x) => x.id)], [['1'], ['3'], ['2']]);
    assert.deepEqual(r.en_vol.sort(), ['2', '3']);
    assert.equal(r.refus_observer, null);
    assert.equal(appels.length, 3);
    for (const a of appels) { assert.equal(a.init.method, 'GET'); assert.equal(new URL(a.url).pathname, '/api/v1/executions'); }
  });
  test('origine normalisée : https://hôte/ accepté, 3 appels sans double barre', async () => {
    const { f, appels } = reseau([]);
    const r = await S.sonder({ workflowId: 'WfA', url: `${URL_I}/`, cle: CLE, fetch: f });
    assert.equal(r.refus_observer, null); assert.equal(appels.length, 3);
  });
  test('curseur renvoyé par le serveur HORS GRAMMAIRE : refusé avant la requête suivante (catégorie fixe)', async () => {
    for (const curseur of [{ secret: 'SYNTHETIQUE' }, 'a b', 'x'.repeat(513), ['a']]) {
      const appels = [];
      const f = async (url) => { appels.push(url); return reponse({ data: [], nextCursor: curseur }); };
      const r = await S.sonder({ workflowId: 'WfA', cle: CLE, fetch: f });
      assert.equal(appels.length, 1, JSON.stringify(curseur));
      assert.equal(r.refus_observer, 'paramètre de requête hors liste fermée (dont curseur)');
      assert.ok(sans(JSON.stringify(r), 'SYNTHETIQUE'));
    }
  });
  test('curseur conforme : suivi (pagination réelle)', async () => {
    const appels = [];
    const f = async (url) => { appels.push(url); const c = new URL(url).searchParams.get('cursor'); return reponse({ data: [], nextCursor: c ? null : 'eyJwYWdlIjoyfQ==' }); };
    const r = await S.sonder({ workflowId: 'WfA', cle: CLE, fetch: f });
    assert.equal(r.refus_observer, null); assert.equal(appels.length, 6);
  });
  test('brut et fusion viennent de la MÊME série', async () => {
    let n = 0;
    const f = async (url) => { const st = new URL(url).searchParams.get('status'); n += 1;
      const x = { id: 5, workflowId: 'WfA', startedAt: '2026-11-10T10:00:00.000Z' };
      return reponse({ data: st === 'running' && n === 1 ? [{ ...x, status: 'running', stoppedAt: null }] : (!st ? [{ ...x, status: 'success', stoppedAt: '2026-11-10T10:00:09.000Z' }] : []), nextCursor: null }); };
    const r = await S.sonder({ workflowId: 'WfA', cle: CLE, fetch: f });
    assert.equal(n, 3); assert.deepEqual(r.brut.running.map((x) => x.id), ['5']); assert.deepEqual(r.fusion, [{ id: '5', status: 'success' }]);
  });
  test('refus d\'observer() : catégorie de la liste fermée pour chaque cas ; message JAMAIS restitué', async () => {
    const cas = [[{ id: '', workflowId: 'WfA', status: 'success' }, 'identifiant inexploitable'], [{ id: 1, workflowId: 'Autre', status: 'success', startedAt: '2026-11-10T10:00:00.000Z', stoppedAt: '2026-11-10T10:00:01.000Z' }, 'workflowId inattendu'],
      [{ id: 1, workflowId: 'WfA', status: 'SECRET_STATUT' }, 'statut inconnu'], [{ id: 1, workflowId: 'WfA', status: 'success', startedAt: 'SECRET_DATE', stoppedAt: null }, 'date hors grammaire'],
      [{ id: 1, workflowId: 'WfA', status: 'success', startedAt: '2026-11-10T10:00:01.000Z', stoppedAt: '2026-11-10T10:00:00.000Z' }, 'chronologie incohérente'], [{ id: 1, workflowId: 'WfA', status: 'success', startedAt: null, stoppedAt: null }, 'dates manquantes']];
    for (const [x, attendu] of cas) {
      const f = async (url) => reponse({ data: new URL(url).searchParams.get('status') ? [] : [x], nextCursor: null });
      const r = await S.sonder({ workflowId: 'WfA', cle: CLE, fetch: f });
      assert.equal(r.refus_observer, attendu, JSON.stringify(x)); assert.ok(sans(JSON.stringify(r), 'SECRET'));
    }
    for (const corps of ['SECRET', null, [], 3, { data: 'x' }, { data: {} }]) assert.equal((await S.sonder({ workflowId: 'WfA', cle: CLE, fetch: async () => reponse(corps) })).refus_observer, 'réponse hors schéma attendu', JSON.stringify(corps));
    assert.equal((await S.sonder({ workflowId: 'WfA', cle: CLE, fetch: async () => reponse({}, 503) })).refus_observer, 'erreur HTTP');
    assert.equal((await S.sonder({ workflowId: 'WfA', cle: CLE, fetch: async () => ({ ok: true, status: 200, json: async () => JSON.parse('SECRET{') }) })).refus_observer, 'réponse JSON illisible');
  });
  test('observations contradictoires (startedAt) : catégorie, brut conservé', async () => {
    const f = async (url) => { const st = new URL(url).searchParams.get('status'); return reponse({ data: st === 'running' ? [] : [{ id: 9, workflowId: 'WfA', status: st === 'waiting' ? 'waiting' : 'success', startedAt: st ? '2026-11-10T10:00:00.000Z' : '2026-11-10T10:05:00.000Z', stoppedAt: st ? null : '2026-11-10T10:06:00.000Z' }], nextCursor: null }); };
    const r = await S.sonder({ workflowId: 'WfA', cle: CLE, fetch: f });
    assert.equal(r.refus_observer, 'observations contradictoires'); assert.equal(r.fusion, null); assert.deepEqual(Object.keys(r.brut).sort(), ['liste', 'running', 'waiting']);
  });
  test('ids, statuts, dates hors ensemble fermé : marqueurs (idSur, listes fermées)', async () => {
    const f = async (url) => { const st = new URL(url).searchParams.get('status'); return reponse({ data: st === 'running' ? [{ id: 'SECRET_ID', workflowId: 'WfA', status: 'running', startedAt: '2026-11-10T10:00:00.000Z', stoppedAt: null }] : [], nextCursor: null }); };
    const r = await S.sonder({ workflowId: 'WfA', cle: CLE, fetch: f });
    assert.deepEqual(r.brut.running, [{ id: '<id hors grammaire>', status: 'running', startedAt: '2026-11-10T10:00:00.000Z', stoppedAt: null }]);
    assert.ok(sans(JSON.stringify(r), 'SECRET'));
  });
  test('liste de confiance = noms EXACTS des 4 exports de recette NOMMÉS + workflow d\'attente', () => {
    assert.deepEqual(S.EXPORTS_RECETTE.map((f) => path.basename(f)), ['box-fonda-emettre-relecture.recette.json', 'box-fonda-cloturer-relecture.recette.json', 'box-fonda-confirmer-relecture.recette.json', 'box-fonda-page-relecture.recette.json']);
    const attendu = new Set(S.NOEUDS_ATTENTE);
    for (const f of S.EXPORTS_RECETTE) for (const n of JSON.parse(fs.readFileSync(f, 'utf8')).nodes) attendu.add(n.name);
    assert.deepEqual([...S.nomsDeConfiance()].sort(), [...attendu].sort());
    assert.equal(S.nomsDeConfiance().has('Webhook'), false);
    // Jamais un glob : la construction de la liste ne liste AUCUN répertoire.
    const lister = fs.readdirSync; fs.readdirSync = () => { throw new Error('glob interdit'); };
    try { assert.doesNotThrow(() => S.nomsDeConfiance()); } finally { fs.readdirSync = lister; }
  });
  const det = (x) => ({ id: 77, workflowId: 'WfA', status: 'error', mode: 'webhook', startedAt: '2026-11-10T10:00:00.000Z', stoppedAt: '2026-11-10T10:00:01.000Z',
    data: { resultData: { runData: { 'FONDA Entree confirmation': [{ data: { main: [[{ json: { k: 'SECRET_K', adresse: 'relecteur@exemple.test' } }]] } }], Webhook: [], 'SECRET_NOEUD deadbeef': [] }, error: { node: { name: 'Verifier formulaire' }, message: 'SECRET_MSG' } } }, ...x });
  test('--execution PRÉSENTE (code 0) : schéma et identité vérifiés ; noms hors liste de confiance -> marqueurs ; aucune donnée', async () => {
    const { f, appels } = reseau([], { 77: det({}) });
    const { r, code } = await S.sonderExecution({ id: '77', cle: CLE, fetch: f });
    assert.equal(code, 0); assert.equal(r.observation, 'present');
    assert.deepEqual(r.noeuds_executes, ['FONDA Entree confirmation', '<nom hors liste n°1>', '<nom hors liste n°2>']);
    assert.equal(r.erreur_noeud, 'Verifier formulaire');
    assert.ok(sans(JSON.stringify(r), 'SECRET', 'relecteur@', 'deadbeef'));
    assert.deepEqual(appels.map((a) => [a.init.method, new URL(a.url).pathname + new URL(a.url).search]), [['GET', '/api/v1/executions/77?includeData=true']]);
  });
  test('--execution ABSENTE (HTTP 404) : code 2, jamais confondu avec 1', async () => {
    const { f } = reseau([], {});
    assert.deepEqual(await S.sonderExecution({ id: '78', cle: CLE, fetch: f }), { r: { schema: 'sonde-execution/v1', id: '78', observation: 'absent' }, code: 2 });
  });
  test('--execution : HTTP 200 dont le corps est null, tableau, nombre, chaîne -> INOBSERVABLE (code 1), JAMAIS absent (code 2)', async () => {
    for (const corps of [null, [], [det({})], 3, 'SECRET', true]) {
      const { r, code } = await S.sonderExecution({ id: '77', cle: CLE, fetch: async () => reponse(corps) });
      assert.equal(code, 1, JSON.stringify(corps)); assert.equal(r.observation, 'inobservable'); assert.equal(r.cause, 'réponse hors schéma attendu'); assert.ok(sans(JSON.stringify(r), 'SECRET'));
    }
  });
  test('dates : forme ISO UTC ET date réelle (aller-retour) ; impossibles -> marqueur ; même fonction en liste et en détail', async () => {
    for (const x of ['2026-11-10T10:00:00Z', '2026-11-10T10:00:00.1Z', '2026-11-10T10:00:00.12Z', '2026-11-10T10:00:00.123Z', '2024-02-29T23:59:59.999Z', null]) assert.equal(S.dateSure(x), x, String(x));
    for (const x of ['2026-99-99T99:99:99Z', '2026-13-01T00:00:00Z', '2026-00-10T00:00:00Z', '2026-04-31T00:00:00Z', '2026-02-29T00:00:00Z', '2026-11-10T24:00:00Z',
      '2026-11-10T10:60:00Z', '2026-11-10T10:00:60Z', '2026-11-10T10:00:00+01:00', '2026-11-10 10:00:00Z', '2026-11-10T10:00:00.1234Z', 1731232800000, {}])
      assert.equal(S.dateSure(x), '<date hors grammaire>', String(x));
    const f = async (url) => reponse({ data: new URL(url).searchParams.get('status') === 'running' ? [{ id: 3, workflowId: 'WfA', status: 'running', startedAt: '2026-02-29T00:00:00Z', stoppedAt: null }] : [], nextCursor: null });
    assert.equal((await S.sonder({ workflowId: 'WfA', cle: CLE, fetch: f })).brut.running[0].startedAt, '<date hors grammaire>');
    const { r } = await S.sonderExecution({ id: '77', cle: CLE, fetch: async () => reponse(det({ startedAt: '2026-99-99T99:99:99Z' })) });
    assert.equal(r.startedAt, '<date hors grammaire>');
  });
  test('--execution INOBSERVABLE : schéma absent, identité différente, statut hors liste, HTTP 500, JSON illisible -> code 1', async () => {
    for (const corps of [{}, det({ id: 76 }), det({ id: '77x' }), det({ status: 'SECRET' }), det({ data: null }), det({ data: {} }), det({ workflowId: 'W-A' }), []]) {
      const { r, code } = await S.sonderExecution({ id: '77', cle: CLE, fetch: async () => reponse(corps) });
      assert.equal(code, 1, JSON.stringify(corps).slice(0, 60)); assert.equal(r.observation, 'inobservable'); assert.ok(sans(JSON.stringify(r), 'SECRET'));
    }
    for (const h of [async () => reponse({}, 500), async () => ({ ok: true, status: 200, json: async () => JSON.parse('SECRET{') })]) {
      const { r, code } = await S.sonderExecution({ id: '77', cle: CLE, fetch: h }); assert.equal(code, 1); assert.ok(sans(JSON.stringify(r), 'SECRET'));
    }
  });
  test('entrées invalides refusées avant le réseau', async () => {
    const { f, appels } = reseau([]);
    await assert.rejects(S.sonder({ workflowId: 'a/../b', cle: CLE, fetch: f }), (e) => e.code === 'WORKFLOW_ID');
    await assert.rejects(S.sonderExecution({ id: '1/retry', cle: CLE, fetch: f }), (e) => e.code === 'EXECUTION_ID');
    await assert.rejects(S.sonder({ workflowId: 'WfA', url: 'https://n8n.exemple.test', cle: CLE, fetch: f }), (e) => e.code === 'INSTANCE');
    assert.equal(appels.length, 0);
  });
});

describe('comparateur : références fermées, états typés, écarts sans contenu du live', () => {
  const REF = CL.REFERENCES[3];
  const texte = fs.readFileSync(path.join(__dirname, '..', REF), 'utf8');
  // Live conforme : secret d'instance INJECTÉ (64 hex synthétiques) dans « Signer jeton » (P4b), seule divergence admise.
  const SECRET_TEST = 'ab'.repeat(32);
  const injecte = (w) => { w.nodes.find((n) => n.name === 'Signer jeton').parameters.secret = SECRET_TEST; return w; };
  const live = () => ({ updatedAt: 'x', createdAt: 'x', id: 'WfA', ...injecte(JSON.parse(texte)), active: false, isArchived: false, versionId: 'v', versionCounter: 1, shared: [{ role: 'o', user: { email: 'proprietaire@exemple.test' } }], tags: [], pinData: {}, meta: null, staticData: null, triggerCount: 0 });
  test('références = liste fermée des 4 exports de recette', () => {
    assert.deepEqual(CL.REFERENCES, ['emettre', 'cloturer', 'confirmer', 'page'].map((k) => `n8n/fonda-relecture-page/box-fonda-${k}-relecture.recette.json`));
  });
  test('import fidèle -> identique', () => { assert.deepEqual(CL.comparer(live(), REF), { identique: true, ecarts: [] }); });
  test('écarts localisés par les seules clés du dépôt ; clé du live -> marqueur', () => {
    const a = live(); a.nodes[0].parameters.path = 'fonda-select'; assert.match(CL.comparer(a, REF).ecarts.join(), /nodes\.0\.parameters\.path : valeur/);
    const b = live(); b.nodes.push({ name: 'X' }); assert.equal(CL.comparer(b, REF).identique, false);
    const c = live(); c.settings.executionTimeout = 999; assert.deepEqual(CL.comparer(c, REF).ecarts, ['$.settings.<clé inconnue n°1> : absente du dépôt']);
    const d = live(); d.connections.SECRET_SYNTHETIQUE = {}; assert.deepEqual(CL.comparer(d, REF).ecarts, ['$.connections.<clé inconnue n°1> : absente du dépôt']);
    const e = live(); e.SECRET_SYNTHETIQUE = 1; assert.deepEqual(CL.comparer(e, REF).ecarts, ['live : clé inconnue n°1 (à examiner)']);
  });
  test('F1 : comparer() n\'accepte qu\'un ÉLÉMENT de REFERENCES (aucun texte ni objet de l\'appelant)', () => {
    const libre = JSON.stringify({ name: 'x', nodes: [{ SECRET_APPELANT: 1 }], connections: {}, settings: {} });
    for (const x of [libre, JSON.parse(libre), texte, `./${REF}`, path.join(__dirname, '..', REF), 'n8n/fonda-relecture-page/box-fonda-page-relecture.json', null, undefined, 3, [REF]])
      assert.throws(() => CL.comparer(live(), x), (e) => e instanceof LS.ErreurOutil && e.code === 'EXPORT_HORS_LISTE', String(x).slice(0, 40));
    for (const ref of CL.REFERENCES) assert.equal(typeof CL.comparer(live(), ref).identique, 'boolean', ref);
  });
  test('P4b : secret HMAC — SEULE divergence admise, sur les 2 chemins EXACTS ; non injecté, hors forme -> écart ; valeur JAMAIS affichée ; tout le reste strict', () => {
    assert.deepEqual(CL.comparer(live(), REF), { identique: true, ecarts: [] });
    const nonInjecte = live(); nonInjecte.nodes.find((n) => n.name === 'Signer jeton').parameters.secret = 'A_INJECTER_A_L_IMPORT';
    assert.deepEqual(CL.comparer(nonInjecte, REF).ecarts, ['live : secret HMAC NON injecté (valeur de remplacement publique)']);
    for (const s of ['AB'.repeat(32), 'ab'.repeat(31), 'SECRET_SYNTHETIQUE', 12, null, `${'ab'.repeat(32)}\n`]) {
      const x = live(); x.nodes.find((n) => n.name === 'Signer jeton').parameters.secret = s;
      const r = CL.comparer(x, REF); assert.deepEqual(r.ecarts, ['live : secret HMAC hors forme (64 hexadécimaux attendus)'], String(s)); assert.ok(sans(JSON.stringify(r), 'SECRET', 'ABAB'));
    }
    const autre = live(); autre.nodes.find((n) => n.name === 'Signer jeton').parameters.encoding = 'base64'; // tout autre champ du nœud reste strict
    assert.equal(CL.comparer(autre, REF).identique, false);
    const ailleurs = live(); ailleurs.nodes.find((n) => n.name === 'Construire page').parameters.secret = SECRET_TEST; // même clé ailleurs : refusée
    assert.equal(CL.comparer(ailleurs, REF).identique, false);
    assert.ok(sans(JSON.stringify(CL.comparer(live(), REF)), SECRET_TEST));
    // Confirmer : « Recalculer jeton » ; Emettre et Cloturer : AUCUNE exception (un secret quelconque y est un écart).
    const tc = fs.readFileSync(path.join(__dirname, '..', CL.REFERENCES[2]), 'utf8');
    const lc = { id: 'WfA', ...JSON.parse(tc), active: false, isArchived: false }; lc.nodes.find((n) => n.name === 'Recalculer jeton').parameters.secret = SECRET_TEST;
    assert.deepEqual(CL.comparer(lc, CL.REFERENCES[2]), { identique: true, ecarts: [] });
    const lp = { ...lc }; assert.equal(CL.comparer(lp, CL.REFERENCES[3]).identique, false);
    const te = fs.readFileSync(path.join(__dirname, '..', CL.REFERENCES[0]), 'utf8');
    const le = { id: 'WfA', ...JSON.parse(te), active: false, isArchived: false }; le.nodes[0].parameters.secret = SECRET_TEST;
    assert.equal(CL.comparer(le, CL.REFERENCES[0]).identique, false);
  });
  test('versionId affiché seulement en grammaire stricte (hexadécimal et tirets), sinon null', async () => {
    const env = { FONDA_N8N_CLE_RECETTE: CLE };
    for (const [v, attendu] of [['2881d35a-1b2c-4d3e-8f90-0123456789ab', '2881d35a-1b2c-4d3e-8f90-0123456789ab'], ['SECRET', null], ['v', null], [12, null], ['a'.repeat(65), null], [undefined, null]]) {
      const x = live(); if (v === undefined) delete x.versionId; else x.versionId = v;
      const { r } = await CL.principal(['WfA', REF], { fetch: async () => reponse(x), env });
      assert.equal(r.versionId, attendu, String(v));
    }
  });
  test('ordre des clés différent -> NON identique', () => {
    const a = live(); a.nodes[0] = Object.fromEntries(Object.entries(a.nodes[0]).reverse());
    assert.deepEqual(CL.comparer(a, REF).ecarts, ['$.nodes.0 : ordre des clés']);
  });
  test('états typés EXACTS : toute forme autre que la forme inactive attendue -> échec', () => {
    const ok = live(); ok.activeVersion = null; ok.activeVersionId = null; ok.staticData = {}; assert.equal(CL.comparer(ok, REF).identique, true);
    for (const [k, v] of [['active', true], ['active', 0], ['active', undefined], ['isArchived', true], ['isArchived', undefined], ['isArchived', 'false'], ['activeVersion', {}], ['activeVersion', { versionId: 'v' }],
      ['activeVersionId', {}], ['activeVersionId', ''], ['activeVersionId', 'v'], ['staticData', []], ['staticData', { global: { x: 1 } }], ['staticData', Object.create({ x: 1 })], ['pinData', []], ['pinData', { X: [{}] }]]) {
      const x = live(); if (v === undefined) delete x[k]; else x[k] = v;
      assert.equal(CL.comparer(x, REF).identique, false, `${k} = ${JSON.stringify(v)}`);
    }
  });
  test('lecture du live : GET /api/v1/workflows/<id> seul ; réponse non objet -> erreur codée', async () => {
    const appels = []; const f = async (url, init) => { appels.push([init.method, new URL(url).pathname, new URL(url).search]); return reponse(live()); };
    await CL.lireLive({ workflowId: 'WfA', url: URL_I, cle: CLE, fetch: f });
    assert.deepEqual(appels, [['GET', '/api/v1/workflows/WfA', '']]);
    await assert.rejects(CL.lireLive({ workflowId: 'WfA/activate', url: URL_I, cle: CLE, fetch: f }), (e) => e.code === 'WORKFLOW_ID');
    await assert.rejects(CL.lireLive({ workflowId: 'WfA', url: URL_I, cle: CLE, fetch: async () => reponse([]) }), (e) => e.code === 'REPONSE');
    await assert.rejects(CL.lireLive({ workflowId: 'WfA', url: URL_I, cle: CLE, fetch: async () => reponse({}, 403) }), (e) => e.code === 'HTTP' && e.http === 403);
    // Identité : réponse pour un AUTRE workflow (contenu conforme) -> IDENTITE, jamais un faux GO.
    for (const id of ['AutreWorkflow', undefined, 12, 'wfa', 'WfA ', ''])
      await assert.rejects(CL.lireLive({ workflowId: 'WfA', url: URL_I, cle: CLE, fetch: async () => reponse({ ...live(), id }) }), (e) => e.code === 'IDENTITE', String(id));
  });
  test('principal : référence hors liste fermée refusée AVANT toute lecture ou requête ; nom affiché depuis la liste', async () => {
    const appels = []; const f = async (url) => { appels.push(url); return reponse(live()); };
    const env = { FONDA_N8N_CLE_RECETTE: CLE };
    for (const x of ['SECRET_SYNTHETIQUE.json', path.join(__dirname, '..', REF), `./${REF}`, 'n8n/fonda-relecture-page/box-fonda-page-relecture.json', `${REF}/`])
      await assert.rejects(CL.principal(['WfA', x], { fetch: f, env }), (e) => e.code === 'EXPORT_HORS_LISTE', x);
    assert.equal(appels.length, 0);
    const { r, code } = await CL.principal(['WfA', REF], { fetch: f, env });
    assert.equal(code, 0); assert.equal(r.export, REF); assert.equal(r.identique, true);
    await assert.rejects(CL.principal(['WfA', REF], { fetch: async () => reponse({ ...live(), id: 'AutreWorkflow' }), env }), (e) => e.code === 'IDENTITE');
  });
});

describe('lignes de commande : arguments stricts, codes de sortie, aucun secret ni extrait', () => {
  // fetch simulé par préchargement (aucun réseau). MODE choisit la réponse.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outils-recette-'));
  const pre = path.join(dir, 'faux-fetch.js');
  fs.writeFileSync(pre, `globalThis.fetch = async (url) => {
  const m = process.env.MODE;
  if (m === 'malforme') return { ok: true, status: 200, json: async () => JSON.parse('SECRET_SYNTHETIQUE{') };
  if (m === '404') return { ok: false, status: 404, json: async () => ({}) };
  if (m === 'present') return { ok: true, status: 200, json: async () => ({ id: 12, workflowId: 'WfA', status: 'success', mode: 'webhook', data: { resultData: { runData: {} } } }) };
  return { ok: true, status: 200, json: async () => ({ data: [], nextCursor: null }) };
};\n`);
  const lancer = (script, args, mode = 'malforme', cle = 'CLE_SYNTHETIQUE_0123456789') => spawnSync(process.execPath, ['-r', pre, path.join(__dirname, script), ...args], { env: { ...process.env, FONDA_N8N_CLE_RECETTE: cle, MODE: mode }, encoding: 'utf8' });
  test('sonde : liste observée -> 0 ; observation impossible -> 1 (diagnostic JSON conservé)', () => {
    assert.equal(lancer('sonde-executions.js', ['WfA'], 'vide').status, 0);
    const r = lancer('sonde-executions.js', ['WfA']);
    assert.equal(r.status, 1); assert.equal(JSON.parse(r.stdout).refus_observer, 'réponse JSON illisible');
  });
  test('sonde --execution : présente -> 0 ; absente (404) -> 2 ; inobservable -> 1', () => {
    assert.equal(lancer('sonde-executions.js', ['--execution', '12'], 'present').status, 0);
    const a = lancer('sonde-executions.js', ['--execution', '12'], '404'); assert.equal(a.status, 2); assert.equal(JSON.parse(a.stdout).observation, 'absent');
    const b = lancer('sonde-executions.js', ['--execution', '12']); assert.equal(b.status, 1); assert.equal(JSON.parse(b.stdout).observation, 'inobservable');
  });
  test('aucun secret, clé ni extrait sur stdout/stderr, dans aucun mode', () => {
    for (const [script, args] of [['sonde-executions.js', ['WfA']], ['sonde-executions.js', ['--execution', '12']], ['comparer-live.js', ['WfA', CL.REFERENCES[3]]]])
      for (const mode of ['malforme', '404', 'present', 'vide']) {
        const r = lancer(script, args, mode); assert.ok(sans(r.stdout + r.stderr, 'SECRET_SYNTHETIQUE', 'CLE_SYNTHETIQUE'), `${script} ${mode}`);
      }
    const c = lancer('comparer-live.js', ['WfA', CL.REFERENCES[3]]); assert.equal(c.status, 1); assert.match(c.stderr, /réponse JSON illisible/);
  });
  test('arguments stricts (3 commandes) : inconnu, valeur absente, doublon, positionnels faux, --url retiré -> code 1, rien sur stdout', () => {
    for (const a of [['WfA', '--url', URL_I], ['WfA', '--execution'], ['--execution', '12', 'WfA'], ['--execution', '12', '--execution', '13'], ['WfA', '--inconnue', 'x'], [], ['WfA', 'WfB'], ['--execution', '--x']]) {
      const r = lancer('sonde-executions.js', a); assert.equal(r.status, 1, a.join(' ')); assert.equal(r.stdout, '', a.join(' '));
    }
    for (const a of [['WfA'], ['WfA', CL.REFERENCES[0], 'y'], ['WfA', CL.REFERENCES[0], '--url', URL_I], ['WfA', 'x.json']]) {
      const r = lancer('comparer-live.js', a); assert.equal(r.status, 1, a.join(' ')); assert.equal(r.stdout, '', a.join(' '));
    }
    for (const a of [['--a', 'x', '--a', 'y'], ['--b', 'x'], ['--a'], ['--a', '']]) assert.throws(() => AR.analyser(a, { options: ['--a'], positionnels: 0 }), (e) => e instanceof LS.ErreurOutil);
    assert.deepEqual(AR.analyser(['p', '--a', 'x'], { options: ['--a'], positionnels: 1 }).positionnels, ['p']);
  });
  test('erreur au CHARGEMENT d\'une dépendance (avant toute protection) : message fixe, code 1, aucun extrait (2 outils)', () => {
    const p = path.join(dir, 'chargement.js');
    fs.writeFileSync(p, `const M = require('module'); const req = M.prototype.require;
M.prototype.require = function (id) { if (process.env.CIBLE && String(id).includes(process.env.CIBLE)) throw new Error('SECRET_SYNTHETIQUE /chemin/prive'); return req.apply(this, arguments); };\n`);
    for (const [script, cible, nom] of [['sonde-executions.js', 'signer-cloture', 'sonde'], ['sonde-executions.js', 'lecture-seule', 'sonde'], ['comparer-live.js', 'arguments', 'comparer-live'], ['comparer-live.js', 'lecture-seule', 'comparer-live']]) {
      const r = spawnSync(process.execPath, ['-r', p, path.join(__dirname, script), 'WfA', CL.REFERENCES[0]], { env: { ...process.env, CIBLE: cible, FONDA_N8N_CLE_RECETTE: CLE }, encoding: 'utf8' });
      assert.equal(r.status, 1, `${script} ${cible}`); assert.equal(r.stdout, ''); assert.equal(r.stderr, `${nom} : erreur (message non affichable)\n`, `${script} ${cible}`);
    }
  });
  test('sources de fichiers illisibles ou hors schéma : référence du comparateur, sources de noms de la sonde -> message fixe, code 1', () => {
    const p = path.join(dir, 'lecture.js');
    fs.writeFileSync(p, `const fs = require('fs'); const lire = fs.readFileSync;
fs.readFileSync = function (f, ...r) { if (process.env.CIBLE && String(f).endsWith(process.env.CIBLE)) { if (process.env.FORME === 'vide') return '{}'; throw new Error('SECRET_SYNTHETIQUE'); } return lire.call(this, f, ...r); };\n`);
    const l = (script, args, cible, forme) => spawnSync(process.execPath, ['-r', pre, '-r', p, path.join(__dirname, script), ...args], { env: { ...process.env, CIBLE: cible, FORME: forme || '', FONDA_N8N_CLE_RECETTE: CLE, MODE: 'present' }, encoding: 'utf8' });
    for (const forme of ['erreur', 'vide']) {
      const a = l('sonde-executions.js', ['--execution', '12'], 'box-fonda-page-relecture.recette.json', forme);
      assert.equal(a.status, 1, forme); assert.equal(a.stderr, `sonde : ${LS.MESSAGES.EXPORT_ILLISIBLE}\n`, forme); assert.ok(sans(a.stdout + a.stderr, 'SECRET'));
    }
    const b = l('comparer-live.js', ['WfA', CL.REFERENCES[3]], 'box-fonda-page-relecture.recette.json', 'erreur');
    assert.equal(b.status, 1); assert.equal(b.stderr, `comparer-live : ${LS.MESSAGES.EXPORT_ILLISIBLE}\n`); assert.ok(sans(b.stdout + b.stderr, 'SECRET'));
  });
  test('clé hors grammaire refusée avant toute requête (message de la liste fermée)', () => {
    const r = lancer('sonde-executions.js', ['WfA'], 'vide', 'courte'); assert.equal(r.status, 1); assert.match(r.stderr, /clé d'API absente ou hors grammaire/);
  });
});

// ── Énumération AUTO-VÉRIFIÉE : chaque classe de frontière a un test qui échoue si elle dérive ──
// Signature (texte des paramètres) d'une fonction exportée ; « <classe> » pour une classe.
function signature(f) {
  const t = f.toString(); if (/^class\b/.test(t)) return '<classe>';
  const i = t.indexOf('('); let d = 0; let j = i;
  for (; j < t.length; j += 1) { if (t[j] === '(') d += 1; else if (t[j] === ')') { d -= 1; if (!d) break; } }
  return t.slice(i + 1, j).replace(/\s+/g, ' ').trim();
}
// F1 : exports et paramètres des fonctions exportées en LISTE FERMÉE (énumération, ligne F1 de RECETTE-P4.md).
const SURFACE_OUTILS = Object.freeze({
  './lecture-seule.js': { CLE_API: 'object', CURSEUR: 'object', ErreurOutil: '<classe>', ID_EXECUTION: 'object', ID_WORKFLOW: 'object', INSTANCES: 'object', MESSAGES: 'object', ROUTES: 'object',
    cleDEnvironnement: 'env = process.env', fetchLectureSeule: '{ url, fetch: f = globalThis.fetch }', messageSur: 'e', origineInstance: 'url' },
  './sonde-executions.js': { CATEGORIES: 'object', EXPORTS_RECETTE: 'object', INSTANCE: 'string', MODES: 'object', NOEUDS_ATTENTE: 'object', STATUTS: 'object',
    dateSure: 'x', nomsDeConfiance: '', principal: 'argv, { fetch: f = globalThis.fetch, env = process.env } = {}',
    sonder: '{ workflowId, url = INSTANCE, cle, fetch: f = globalThis.fetch }', sonderExecution: '{ id, url = INSTANCE, cle, fetch: f = globalThis.fetch }' },
  './comparer-live.js': { CLES_CONTENU: 'object', ETATS: 'object', METADONNEES: 'object', REFERENCES: 'object',
    comparer: 'live, reference', lireLive: '{ workflowId, url, cle, fetch: f = globalThis.fetch }', principal: 'argv, { fetch: f = globalThis.fetch, env = process.env } = {}' },
  './arguments.js': { analyser: 'argv, { options = [], positionnels = 0 }' },
});
// X1 : modules chargés par chaque commande, TRACÉS (Module._load) et comparés à une LISTE FERMÉE.
const NOYAU_SIGNATAIRE = ['fonda/engine/canonique.js', 'fonda/engine/catalogue.js', 'fonda/engine/journal-set-ids.js', 'fonda/scripts/adaptateurs-production.js', 'fonda/scripts/attestation-signee.js',
  'fonda/scripts/interim.js', 'fonda/scripts/liaison-generation.js', 'fonda/scripts/moteurs.js', 'fonda/scripts/publier-lot.js', 'fonda/scripts/referentiel-archive.js', 'fonda/scripts/signer-cloture.js',
  'fonda/scripts/verifier-moteurs.js', 'node:child_process', 'node:crypto', 'node:fs', 'node:os', 'node:path', 'node:vm'];
const MODULES_ATTENDUS = Object.freeze({
  sonde: [...NOYAU_SIGNATAIRE, 'outils-recette/arguments.js', 'outils-recette/lecture-seule.js', 'outils-recette/sonde-executions.js'].sort(),
  comparateur: ['node:fs', 'node:path', 'outils-recette/arguments.js', 'outils-recette/comparer-live.js', 'outils-recette/lecture-seule.js'].sort(),
});
describe('énumération auto-vérifiée : F1 (surface exportée), X1 (modules chargés), K8 (référence typée)', () => {
  test('F1 : exports et paramètres de chaque fonction exportée = LISTE FERMÉE (tout paramètre nouveau fait échouer)', () => {
    for (const [m, attendu] of Object.entries(SURFACE_OUTILS)) {
      const x = require(m);
      assert.deepEqual(Object.keys(x).sort(), Object.keys(attendu).sort(), `${m} : exports`);
      for (const [k, v] of Object.entries(x)) assert.equal(typeof v === 'function' ? signature(v) : typeof v, attendu[k], `${m} : ${k}`);
    }
  });
  test('F1 : la liste de confiance n\'est remplaçable par AUCUN paramètre (noms retiré)', async () => {
    const corps = { id: 77, workflowId: 'WfA', status: 'success', mode: 'webhook', data: { resultData: { runData: { HORS_DEPOT_SYNTHETIQUE: [] } } } };
    const { r, code } = await S.sonderExecution({ id: '77', cle: CLE, fetch: async () => reponse(corps), noms: new Set(['HORS_DEPOT_SYNTHETIQUE']) });
    assert.equal(code, 0); assert.deepEqual(r.noeuds_executes, ['<nom hors liste n°1>']);
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-'));
  const trace = path.join(dir, 'trace.js'); const faux = path.join(dir, 'faux-fetch.js');
  fs.writeFileSync(trace, `const M = require('module'); const fs = require('fs'); const path = require('path');
const vus = new Set(); const orig = M._load;
M._load = function (req, parent, isMain) { const r = orig.apply(this, arguments);
  try { if (M.isBuiltin(req)) vus.add('node:' + req.replace(/^node:/, '')); else vus.add(path.relative(process.env.RACINE, M._resolveFilename(req, parent, isMain))); } catch { vus.add('<non résolu>'); }
  return r; };
process.on('exit', () => fs.writeFileSync(process.env.TRACE, JSON.stringify([...vus].sort())));\n`);
  fs.writeFileSync(faux, `globalThis.fetch = async (url) => { const u = new URL(url);
  if (u.pathname.startsWith('/api/v1/executions/')) return { ok: true, status: 200, json: async () => ({ id: 12, workflowId: 'WfA', status: 'success', mode: 'webhook', data: { resultData: { runData: {} } } }) };
  if (u.pathname.startsWith('/api/v1/workflows/')) return { ok: true, status: 200, json: async () => { const w = { id: 'WfA', ...JSON.parse(require('fs').readFileSync(process.env.REF, 'utf8')), active: false, isArchived: false }; for (const n of w.nodes) if (n.type === 'n8n-nodes-base.crypto' && n.parameters.action === 'hmac') n.parameters.secret = 'cd'.repeat(32); return w; } };
  return { ok: true, status: 200, json: async () => ({ data: [], nextCursor: null }) }; };\n`);
  const RACINE = path.join(__dirname, '..');
  const tracer = (script, args) => {
    const sortie = path.join(dir, `t-${Math.random().toString(36).slice(2)}.json`);
    const r = spawnSync(process.execPath, ['-r', trace, '-r', faux, path.join(__dirname, script), ...args], { cwd: RACINE,
      env: { ...process.env, RACINE, TRACE: sortie, REF: path.join(RACINE, CL.REFERENCES[3]), FONDA_N8N_CLE_RECETTE: CLE }, encoding: 'utf8' });
    // Seul le faux réseau du test (hors dépôt) est retiré ; tout autre fichier hors dépôt resterait et ferait échouer.
    const vus = JSON.parse(fs.readFileSync(sortie, 'utf8')).filter((x) => !(x.startsWith('..') && x.endsWith('/faux-fetch.js')));
    return { r, vus };
  };
  test('X1 : modules chargés par la sonde (liste et détail), tracés = LISTE FERMÉE', () => {
    for (const args of [['WfA'], ['--execution', '12']]) {
      const { r, vus } = tracer('sonde-executions.js', args);
      assert.equal(r.status, 0, args.join(' ')); assert.deepEqual(vus, MODULES_ATTENDUS.sonde, args.join(' '));
    }
  });
  test('X1 : modules chargés par le comparateur (comparaison complète), tracés = LISTE FERMÉE', () => {
    const { r, vus } = tracer('comparer-live.js', ['WfA', CL.REFERENCES[3]]);
    // Faux live CONFORME (bon id, inactif) : lecture, identité, comparaison et sortie parcourues jusqu'au code 0.
    assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, '');
    assert.deepEqual(JSON.parse(r.stdout), { schema: 'comparaison-live/v1', workflowId: 'WfA', export: CL.REFERENCES[3], versionId: null, identique: true, ecarts: [] });
    assert.deepEqual(vus, MODULES_ATTENDUS.comparateur);
  });
  test('K8 : référence dont le JSON n\'est pas un objet (null, [], 3) -> EXPORT_ILLISIBLE, code 1 (même typage que S3)', () => {
    const p = path.join(dir, 'ref.js');
    fs.writeFileSync(p, `const fs = require('fs'); const lire = fs.readFileSync;
fs.readFileSync = function (f, ...r) { if (String(f).endsWith('box-fonda-page-relecture.recette.json')) return process.env.CORPS; return lire.call(this, f, ...r); };\n`);
    for (const corps of ['null', '[]', '3', '"SECRET"']) {
      const r = spawnSync(process.execPath, ['-r', faux, '-r', p, path.join(__dirname, 'comparer-live.js'), 'WfA', CL.REFERENCES[3]], { env: { ...process.env, CORPS: corps, FONDA_N8N_CLE_RECETTE: CLE, REF: '/nonexistant' }, encoding: 'utf8' });
      assert.equal(r.status, 1, corps); assert.equal(r.stdout, ''); assert.equal(r.stderr, `comparer-live : ${LS.MESSAGES.EXPORT_ILLISIBLE}\n`, corps);
    }
  });
});

// ── Instantanés de surface : chaque LISTE FERMÉE est recopiée ICI littéralement et comparée au code ; élargir
// une liste oblige à modifier ce test (extension visible en relecture). Formes EXACTES des sorties (S8, K9). ──
describe('instantanés de surface : listes fermées recopiées, formes exactes des sorties (S8, K9)', () => {
  const rx = (r) => r.source;
  test('transport : instance, grammaires, routes ET paramètres par route, codes d\'erreur = instantané littéral', () => {
    assert.deepEqual(LS.INSTANCES, ['https://n8n.srv868991.hstgr.cloud']);
    assert.deepEqual([LS.ID_WORKFLOW, LS.ID_EXECUTION, LS.CURSEUR, LS.CLE_API].map(rx), [/^[A-Za-z0-9]{1,40}$/, /^[0-9]{1,20}$/, /^[A-Za-z0-9+/=_-]{1,512}$/, /^[A-Za-z0-9._-]{16,4096}$/].map(rx));
    const route = (r) => ({ nom: r.nom, chemin: r.chemin.source, params: Object.fromEntries(Object.entries(r.params).map(([k, s]) => [k, { ...(s.re ? { re: s.re.source } : { valeurs: s.valeurs }), requis: s.requis === true }])) });
    assert.deepEqual(LS.ROUTES.map(route), [
      { nom: 'liste-executions', chemin: rx(/^\/api\/v1\/executions$/), params: { workflowId: { re: rx(/^[A-Za-z0-9]{1,40}$/), requis: true },
        status: { valeurs: ['running', 'waiting'], requis: false }, limit: { valeurs: ['250'], requis: true }, cursor: { re: rx(/^[A-Za-z0-9+/=_-]{1,512}$/), requis: false } } },
      { nom: 'detail-execution', chemin: rx(/^\/api\/v1\/executions\/[0-9]{1,20}$/), params: { includeData: { valeurs: ['true'], requis: true } } },
      { nom: 'export-workflow', chemin: rx(/^\/api\/v1\/workflows\/[A-Za-z0-9]{1,40}$/), params: {} },
    ]);
    for (const r of LS.ROUTES) for (const s of Object.values(r.params)) assert.deepEqual(Object.keys(s).filter((k) => !['re', 'valeurs', 'requis'].includes(k)), [], r.nom);
    assert.deepEqual(Object.keys(LS.MESSAGES), ['INSTANCE', 'METHODE', 'CORPS', 'URL', 'ORIGINE', 'ROUTE', 'PARAMETRE', 'ENTETES', 'TRANSPORT', 'JSON', 'CLE', 'FETCH', 'WORKFLOW_ID',
      'EXECUTION_ID', 'OPTION_INCONNUE', 'OPTION_DOUBLE', 'OPTION_VALEUR', 'POSITIONNELS', 'EXPORT_HORS_LISTE', 'EXPORT_ILLISIBLE', 'REPONSE', 'IDENTITE', 'HTTP']);
  });
  test('sonde et comparateur : listes fermées = instantané littéral', () => {
    assert.deepEqual(S.STATUTS, ['new', 'running', 'waiting', 'success', 'error', 'crashed', 'canceled', 'unknown']);
    assert.deepEqual(S.MODES, ['webhook', 'manual', 'trigger', 'retry', 'integrated', 'cli', 'internal', 'error', 'evaluation']);
    assert.deepEqual(S.NOEUDS_ATTENTE, ['Webhook attente', 'Attendre', 'Repondre attente']);
    assert.equal(S.INSTANCE, LS.INSTANCES[0]);
    assert.deepEqual(S.CATEGORIES.map(([r, l]) => [r.source, l]), [['sans identifiant exploitable', 'identifiant inexploitable'], ['hors grammaire', 'date hors grammaire'],
      ['workflowId inattendu', 'workflowId inattendu'], ['statut inconnu', 'statut inconnu'], ['terminée avant d\'avoir démarré', 'chronologie incohérente'],
      ['observations contradictoires', 'observations contradictoires'], ['deux statuts terminaux', 'statuts terminaux contradictoires'], ['retour d\'un statut terminal', 'retour à un statut non terminal'],
      [rx(/sans startedAt\/stoppedAt/), 'dates manquantes'], ['pagination en boucle', 'pagination en boucle'], ['liste d\'exécutions inexploitable', 'liste inexploitable']]);
    assert.deepEqual(CL.CLES_CONTENU, ['name', 'nodes', 'connections', 'settings']);
    assert.deepEqual(CL.METADONNEES, ['id', 'createdAt', 'updatedAt', 'versionId', 'versionCounter', 'shared', 'tags', 'meta', 'triggerCount', 'description', 'parentFolder', 'homeProject', 'scopes']);
    assert.deepEqual(CL.ETATS, ['active', 'isArchived', 'pinData', 'staticData', 'activeVersion', 'activeVersionId']);
  });
  test('options de ligne de commande : spécification REÇUE par analyser() (espionnée) = instantané littéral, pour chaque commande', async () => {
    const vues = []; const orig = AR.analyser;
    const recharger = () => { for (const m of ['./sonde-executions.js', './comparer-live.js']) delete require.cache[require.resolve(m)]; };
    AR.analyser = (argv, spec) => { vues.push(JSON.parse(JSON.stringify(spec))); return orig(argv, spec); };
    try {
      recharger();
      const S2 = require('./sonde-executions.js'); const CL2 = require('./comparer-live.js');
      const env = { FONDA_N8N_CLE_RECETTE: CLE };
      await S2.principal(['WfA'], { fetch: async () => reponse({ data: [], nextCursor: null }), env });
      await S2.principal(['--execution', '12'], { fetch: async () => reponse({}, 404), env });
      await CL2.principal(['WfA', CL.REFERENCES[3]], { fetch: async () => reponse({}, 404), env }).catch(() => {});
    } finally { AR.analyser = orig; recharger(); }
    assert.deepEqual(vues, [{ options: ['--execution'], positionnels: 1 }, { options: ['--execution'], positionnels: 0 }, { options: [], positionnels: 2 }]);
  });
  const env = { FONDA_N8N_CLE_RECETTE: CLE, nouveau: 'SECRET_ENV' };
  const SONDE_LISTE = ['schema', 'workflowId', 'observe_le', 'brut', 'fusion', 'en_vol', 'refus_observer'];
  test('S8 : forme EXACTE de chaque sortie de la sonde (liste observée, liste refusée, présent, absent, inobservable)', async () => {
    const ex = [{ id: 1, workflowId: 'WfA', status: 'success', startedAt: '2026-11-10T10:00:00.000Z', stoppedAt: '2026-11-10T10:00:01.000Z' },
      { id: 2, workflowId: 'WfA', status: 'running', startedAt: '2026-11-10T10:01:00.000Z', stoppedAt: null }];
    const a = await S.principal(['WfA'], { fetch: reseau(ex).f, env });
    assert.deepEqual(Object.keys(a), ['r', 'code']); assert.equal(a.code, 0);
    assert.deepEqual(Object.keys(a.r), SONDE_LISTE);
    assert.deepEqual({ ...a.r, observe_le: '<horloge>' }, { schema: 'sonde-executions/v1', workflowId: 'WfA', observe_le: '<horloge>',
      brut: { running: [{ id: '2', status: 'running', startedAt: '2026-11-10T10:01:00.000Z', stoppedAt: null }], waiting: [], liste: [{ id: '1', status: 'success', startedAt: '2026-11-10T10:00:00.000Z', stoppedAt: '2026-11-10T10:00:01.000Z' }] },
      fusion: a.r.fusion, en_vol: ['2'], refus_observer: null });
    assert.deepEqual([...a.r.fusion].sort((x, y) => x.id.localeCompare(y.id)), [{ id: '1', status: 'success' }, { id: '2', status: 'running' }]);
    assert.equal(S.dateSure(a.r.observe_le), a.r.observe_le);
    const b = await S.principal(['WfA'], { fetch: async () => reponse(null), env });
    assert.deepEqual({ ...b, r: { ...b.r, observe_le: '<horloge>' } }, { r: { schema: 'sonde-executions/v1', workflowId: 'WfA', observe_le: '<horloge>', brut: {}, fusion: null, en_vol: null, refus_observer: 'réponse hors schéma attendu' }, code: 1 });
    const corps = { id: 12, workflowId: 'WfA', status: 'success', mode: 'webhook', startedAt: '2026-11-10T10:00:00.000Z', stoppedAt: null, data: { resultData: { runData: { Attendre: [] } } } };
    assert.deepEqual(await S.principal(['--execution', '12'], { fetch: async () => reponse(corps), env }), { r: { schema: 'sonde-execution/v1', id: '12', observation: 'present', workflowId: 'WfA',
      status: 'success', mode: 'webhook', startedAt: '2026-11-10T10:00:00.000Z', stoppedAt: null, runData_present: true, noeuds_executes: ['Attendre'], erreur_noeud: null }, code: 0 });
    assert.deepEqual(await S.principal(['--execution', '12'], { fetch: async () => reponse({}, 404), env }), { r: { schema: 'sonde-execution/v1', id: '12', observation: 'absent' }, code: 2 });
    assert.deepEqual(await S.principal(['--execution', '12'], { fetch: async () => reponse({}, 500), env }), { r: { schema: 'sonde-execution/v1', id: '12', observation: 'inobservable', cause: 'erreur HTTP' }, code: 1 });
    assert.deepEqual(await S.principal(['--execution', '12'], { fetch: async () => reponse({ ...corps, id: 13 }), env }), { r: { schema: 'sonde-execution/v1', id: '12', observation: 'inobservable', cause: 'identifiant renvoyé ≠ identifiant demandé' }, code: 1 });
  });
  test('K9 : forme EXACTE de la sortie du comparateur (principal et comparer)', async () => {
    const texte = fs.readFileSync(path.join(__dirname, '..', CL.REFERENCES[0]), 'utf8');
    const live = { id: 'WfA', ...JSON.parse(texte), active: false, isArchived: false, versionId: '2881d35a' };
    assert.deepEqual(await CL.principal(['WfA', CL.REFERENCES[0]], { fetch: async () => reponse(live), env }),
      { r: { schema: 'comparaison-live/v1', workflowId: 'WfA', export: CL.REFERENCES[0], versionId: '2881d35a', identique: true, ecarts: [] }, code: 0 });
    assert.deepEqual(await CL.principal(['WfA', CL.REFERENCES[0]], { fetch: async () => reponse({ ...live, active: true }), env }),
      { r: { schema: 'comparaison-live/v1', workflowId: 'WfA', export: CL.REFERENCES[0], versionId: '2881d35a', identique: false, ecarts: ['live : workflow ACTIF ou état inconnu (attendu : active = false)'] }, code: 1 });
    assert.deepEqual(Object.keys(CL.comparer(live, CL.REFERENCES[0])), ['identique', 'ecarts']);
    assert.deepEqual(CL.comparer(null, CL.REFERENCES[0]), { identique: false, ecarts: ['live : objet attendu'] });
  });
});

describe('énumération : le SOMMAIRE est auto-vérifié', () => {
  test('sommaire : chaque ligne du détail (C*, T*, S*, K*, X*, F*) figure dans au moins une classe de la table « Classe -> test de dérive »', () => {
    const t = fs.readFileSync(path.join(__dirname, '..', 'n8n', 'fonda-relecture-page', 'RECETTE-P4.md'), 'utf8');
    const i = t.indexOf('| Classe | Test de dérive |'); assert.ok(i > 0, 'table des classes absente');
    const classes = t.slice(i, t.indexOf('\n\n', i));
    const lignes = [...t.matchAll(/^\| ([CTSKXF][0-9]+) \|/gm)].map((m) => m[1]);
    assert.ok(lignes.length >= 40, 'détail des frontières absent ou tronqué');
    const couvertes = new Set();
    for (const [, l, a, b] of classes.matchAll(/([CTSKXF])([0-9]+)(?:[–-]\1?([0-9]+))?/g)) {
      if (b) for (let k = Number(a); k <= Number(b); k += 1) couvertes.add(`${l}${k}`); else couvertes.add(`${l}${a}`);
    }
    assert.deepEqual(lignes.filter((l) => !couvertes.has(l)), [], 'lignes du détail hors de toute classe');
    assert.equal(new Set(lignes).size, lignes.length, 'identifiant de ligne en double');
  });
});
