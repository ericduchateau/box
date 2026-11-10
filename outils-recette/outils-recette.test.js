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
  const live = () => ({ updatedAt: 'x', createdAt: 'x', id: 'WfA', ...JSON.parse(texte), active: false, isArchived: false, versionId: 'v', versionCounter: 1, shared: [{ role: 'o', user: { email: 'proprietaire@exemple.test' } }], tags: [], pinData: {}, meta: null, staticData: null, triggerCount: 0 });
  test('références = liste fermée des 4 exports de recette', () => {
    assert.deepEqual(CL.REFERENCES, ['emettre', 'cloturer', 'confirmer', 'page'].map((k) => `n8n/fonda-relecture-page/box-fonda-${k}-relecture.recette.json`));
  });
  test('import fidèle -> identique', () => { assert.deepEqual(CL.comparer(live(), texte), { identique: true, ecarts: [] }); });
  test('écarts localisés par les seules clés du dépôt ; clé du live -> marqueur', () => {
    const a = live(); a.nodes[0].parameters.path = 'fonda-select'; assert.match(CL.comparer(a, texte).ecarts.join(), /nodes\.0\.parameters\.path : valeur/);
    const b = live(); b.nodes.push({ name: 'X' }); assert.equal(CL.comparer(b, texte).identique, false);
    const c = live(); c.settings.executionTimeout = 999; assert.deepEqual(CL.comparer(c, texte).ecarts, ['$.settings.<clé inconnue n°1> : absente du dépôt']);
    const d = live(); d.connections.SECRET_SYNTHETIQUE = {}; assert.deepEqual(CL.comparer(d, texte).ecarts, ['$.connections.<clé inconnue n°1> : absente du dépôt']);
    const e = live(); e.SECRET_SYNTHETIQUE = 1; assert.deepEqual(CL.comparer(e, texte).ecarts, ['live : clé inconnue n°1 (à examiner)']);
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
    assert.deepEqual(CL.comparer(a, texte).ecarts, ['$.nodes.0 : ordre des clés']);
  });
  test('états typés EXACTS : toute forme autre que la forme inactive attendue -> échec', () => {
    const ok = live(); ok.activeVersion = null; ok.activeVersionId = null; ok.staticData = {}; assert.equal(CL.comparer(ok, texte).identique, true);
    for (const [k, v] of [['active', true], ['active', 0], ['active', undefined], ['isArchived', true], ['isArchived', undefined], ['isArchived', 'false'], ['activeVersion', {}], ['activeVersion', { versionId: 'v' }],
      ['activeVersionId', {}], ['activeVersionId', ''], ['activeVersionId', 'v'], ['staticData', []], ['staticData', { global: { x: 1 } }], ['staticData', Object.create({ x: 1 })], ['pinData', []], ['pinData', { X: [{}] }]]) {
      const x = live(); if (v === undefined) delete x[k]; else x[k] = v;
      assert.equal(CL.comparer(x, texte).identique, false, `${k} = ${JSON.stringify(v)}`);
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
