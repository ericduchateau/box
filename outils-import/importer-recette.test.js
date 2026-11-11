'use strict';
// Tests de l'outil d'import de recette (ÉCRITURE explicite, P4b option E). Aucun réseau (fetch simulé), aucun
// trousseau réel (exécutable injecté ou remplacé par préchargement). Prouvé, frontière par frontière, y compris en
// NÉGATIF : confirmation, cibles en liste fermée, import CONJOINT Page+Confirmer (un secret lu une fois), appel
// `security` exact, forme du secret, substitution du SEUL fragment, corps POSTÉ = texte substitué, précontrôle de
// doublon paginé jusqu'au bout et fail-closed, POST et relecture vérifiés (inactif, identité, secret relu ==
// envoyé), diagnostics de reprise, aucun secret sur stdout/stderr, erreur au chargement, surface (F1) et modules
// chargés (X1) en listes fermées.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const I = require('./importer-recette.js');
const CL = require('../outils-recette/comparer-live.js');

const RACINE = path.join(__dirname, '..');
const [EMETTRE, CLOTURER, CONFIRMER, PAGE] = CL.REFERENCES;
const CLE = 'cle-import-synthetique-0123456789';
const SECRET = 'ef'.repeat(32);
const lire = (r) => fs.readFileSync(path.join(RACINE, r), 'utf8');
const reponse = (corps, status = 200) => ({ status, json: async () => corps });
const sans = (t, ...x) => x.every((s) => !t.includes(s));
// Faux n8n : enregistre chaque appel ; liste par nom paginée ; POST -> id créé ; GET de l'id -> ce qui a été posté.
function instance({ pages = [[]], postActif = false, getActif = false, alterer = null, panne = null } = {}) {
  const appels = []; const postes = {}; let n = 0;
  const f = async (url, init) => {
    appels.push({ url, init });
    const u = new URL(url);
    if (panne && panne(u, init, appels.length)) return panne(u, init, appels.length)();
    if (init.method === 'GET' && u.pathname === '/api/v1/workflows') {
      const i = Number(u.searchParams.get('cursor') || 0);
      return reponse({ data: pages[i], nextCursor: i + 1 < pages.length ? String(i + 1) : null });
    }
    if (init.method === 'POST' && u.pathname === '/api/v1/workflows') { n += 1; const id = `NouveauWf${n}`; postes[id] = init.body; return reponse({ id, ...JSON.parse(init.body), active: postActif }); }
    const m = u.pathname.match(/^\/api\/v1\/workflows\/(NouveauWf[0-9])$/);
    if (init.method === 'GET' && m && postes[m[1]]) {
      const w = { id: m[1], createdAt: 'x', updatedAt: 'x', versionId: 'v', ...JSON.parse(postes[m[1]]), active: getActif, isArchived: false };
      if (alterer) alterer(w);
      return reponse(w);
    }
    return reponse({}, 404);
  };
  return { f, appels, postes };
}
const vue = (appels) => appels.map((a) => [a.init.method, new URL(a.url).pathname + new URL(a.url).search]);
const nomQ = (nom) => `/api/v1/workflows?name=${encodeURIComponent(nom)}&limit=100`;

describe('import de recette : ÉCRITURE explicite, ensembles fermés, secret jamais affiché', () => {
  test('listes fermées : noms, fragment, service du trousseau, cible conjointe ; jamais un export de production', () => {
    assert.deepEqual(I.NOMS, ['FONDA RECETTE - Emettre relecture', 'FONDA RECETTE - Cloturer relecture', 'FONDA RECETTE - Confirmer relecture', 'FONDA RECETTE - Page relecture']);
    assert.equal(I.FRAGMENT, '"secret": "A_INJECTER_A_L_IMPORT"'); assert.equal(I.SERVICE_TROUSSEAU, 'fonda-recette-page-hmac'); assert.equal(I.CONJOINT, 'page-et-confirmer');
    for (const r of ['n8n/fonda-relecture-page/box-fonda-page-relecture.json', `./${PAGE}`, path.join(RACINE, PAGE), 'x.json', null])
      assert.throws(() => I.preparer(r, SECRET), (e) => e.code === 'CIBLE_HORS_LISTE', String(r));
  });
  test('appel du trousseau : /usr/bin/security, argv EXACT, sans shell ; saut de ligne final retiré ; échec ou sortie non texte -> TROUSSEAU', () => {
    const vus = [];
    assert.equal(I.lireTrousseau((cmd, args, opts) => { vus.push([cmd, args, opts]); return `${SECRET}\n`; }), SECRET);
    assert.deepEqual(vus, [['/usr/bin/security', ['find-generic-password', '-s', 'fonda-recette-page-hmac', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }]]);
    for (const exec of [() => { throw new Error(`SECRET ${SECRET}`); }, () => null, () => Buffer.from(SECRET)]) assert.throws(() => I.lireTrousseau(exec), (e) => e.code === 'TROUSSEAU' && sans(e.message, SECRET));
  });
  test('substitution du SEUL fragment exact (Page, Confirmer) ; garde publique du code INTACTE ; reste octet pour octet', () => {
    for (const r of [PAGE, CONFIRMER]) {
      const avant = lire(r); const { texte } = I.preparer(r, SECRET);
      assert.equal(texte, avant.replace(I.FRAGMENT, `"secret": "${SECRET}"`), r);
      assert.ok(texte.includes('A_INJECTER_A_L_IMPORT'), `${r} : garde publique conservée dans le code`);
    }
    for (const r of [EMETTRE, CLOTURER]) assert.equal(I.preparer(r, null).texte, lire(r), r);
  });
  test('secret : forme stricte (64 hex minuscules) ; valeur de remplacement, absent, court, majuscules, saut de ligne -> refus AVANT le réseau', async () => {
    for (const s of [undefined, null, '', 'A_INJECTER_A_L_IMPORT', 'ef'.repeat(31), 'EF'.repeat(32), `${SECRET}\n`, `${SECRET}0`, 'g'.repeat(64)]) {
      const n = instance();
      await assert.rejects(I.importer({ cible: I.CONJOINT, cle: CLE, secret: s, fetch: n.f }), (e) => e.code === 'SECRET_FORME', String(s));
      assert.equal(n.appels.length, 0);
    }
  });
  test('import CONJOINT nominal : précontrôle des 2 noms, puis POST + GET pour chacun ; même secret dans les 2 corps ; inactifs ; identiques', async () => {
    const n = instance();
    const r = await I.importer({ cible: I.CONJOINT, cle: CLE, secret: SECRET, fetch: n.f });
    assert.deepEqual(r, { schema: 'import-recette/v1', cible: I.CONJOINT, imports: [
      { export: CONFIRMER, workflowId: 'NouveauWf1', identique: true, ecarts: [] }, { export: PAGE, workflowId: 'NouveauWf2', identique: true, ecarts: [] }] });
    assert.deepEqual(vue(n.appels), [['GET', nomQ('FONDA RECETTE - Confirmer relecture')], ['GET', nomQ('FONDA RECETTE - Page relecture')],
      ['POST', '/api/v1/workflows'], ['GET', '/api/v1/workflows/NouveauWf1'], ['POST', '/api/v1/workflows'], ['GET', '/api/v1/workflows/NouveauWf2']]);
    assert.equal(n.postes.NouveauWf1, lire(CONFIRMER).replace(I.FRAGMENT, `"secret": "${SECRET}"`), 'corps POSTÉ = texte substitué');
    assert.equal(n.postes.NouveauWf2, lire(PAGE).replace(I.FRAGMENT, `"secret": "${SECRET}"`));
    for (const a of n.appels) { assert.equal(a.init.redirect, 'error'); assert.equal(new URL(a.url).origin, 'https://n8n.srv868991.hstgr.cloud'); }
    assert.ok(sans(JSON.stringify(r), SECRET));
  });
  test('secret RELU ≠ secret envoyé (instance qui en conserve un autre) -> NON identique, écart fixe, valeur jamais affichée', async () => {
    const autre = 'cd'.repeat(32);
    const n = instance({ alterer: (w) => { for (const x of w.nodes) if (x.type === 'n8n-nodes-base.crypto' && x.parameters.action === 'hmac') x.parameters.secret = autre; } });
    const r = await I.importer({ cible: I.CONJOINT, cle: CLE, secret: SECRET, fetch: n.f });
    for (const x of r.imports) { assert.equal(x.identique, false); assert.deepEqual(x.ecarts, ['secret relu ≠ secret envoyé']); }
    assert.ok(sans(JSON.stringify(r), SECRET, autre));
  });
  test('précontrôle de doublon : homonyme EXACT en page 2 -> refus ; noms voisins (sous-chaîne) tolérés ; aucun POST', async () => {
    const voisin = { id: 'Voisin1', name: 'FONDA RECETTE - Page relecture (copie)' };
    const n = instance({ pages: [[voisin], [{ id: 'Ancien1', name: 'FONDA RECETTE - Confirmer relecture' }]] });
    await assert.rejects(I.importer({ cible: I.CONJOINT, cle: CLE, secret: SECRET, fetch: n.f }), (e) => e.code === 'NOM_EXISTANT' && e.etape === 'precontrole');
    assert.equal(n.appels.filter((a) => a.init.method === 'POST').length, 0);
    assert.deepEqual(vue(n.appels).slice(0, 2), [['GET', nomQ('FONDA RECETTE - Confirmer relecture')], ['GET', `${nomQ('FONDA RECETTE - Confirmer relecture')}&cursor=1`]]);
    const ok = instance({ pages: [[voisin]] });
    assert.equal((await I.importer({ cible: I.CONJOINT, cle: CLE, secret: SECRET, fetch: ok.f })).imports.length, 2);
  });
  test('précontrôle fail-closed : page vide AVEC curseur suivie, élément malformé, curseur hors grammaire ou répété, plafond, erreur HTTP -> refus, aucun POST', async () => {
    const cas = [
      ['page vide avec curseur puis homonyme', { pages: [[], [{ id: 'Ancien1', name: 'FONDA RECETTE - Confirmer relecture' }]] }, 'NOM_EXISTANT'],
      ['élément null', { pages: [[null]] }, 'RECHERCHE_INCOMPLETE'], ['élément sans nom', { pages: [[{ id: 'A1' }]] }, 'RECHERCHE_INCOMPLETE'],
      ['id hors grammaire', { pages: [[{ id: 'a/b', name: 'x' }]] }, 'RECHERCHE_INCOMPLETE'], ['data non tableau', { pages: ['x'] }, 'RECHERCHE_INCOMPLETE'],
      ['plafond de pages', { pages: Array.from({ length: 25 }, () => []) }, 'RECHERCHE_INCOMPLETE'],
    ];
    for (const [nom, o, code] of cas) {
      const n = instance(o);
      await assert.rejects(I.importer({ cible: I.CONJOINT, cle: CLE, secret: SECRET, fetch: n.f }), (e) => e.code === code, nom);
      assert.equal(n.appels.filter((a) => a.init.method === 'POST').length, 0, nom);
    }
    for (const [nom, corps] of [['curseur hors grammaire', { data: [], nextCursor: 'a b' }], ['curseur répété', null], ['HTTP 500', 'http']]) {
      const n = instance({ panne: (u, init, k) => (init.method === 'GET' && u.pathname === '/api/v1/workflows' ? () => (corps === 'http' ? reponse({}, 500) : reponse(corps || { data: [], nextCursor: 'C1' })) : null) });
      await assert.rejects(I.importer({ cible: I.CONJOINT, cle: CLE, secret: SECRET, fetch: n.f }), (e) => e.code === 'RECHERCHE_INCOMPLETE', nom);
      assert.equal(n.appels.filter((a) => a.init.method === 'POST').length, 0, nom);
    }
  });
  test('après création : POST actif, relecture en échec ou identité différente, 2e POST en échec -> diagnostic avec ÉTAPE et ids créés ; aucune suppression', async () => {
    const run = (o) => I.importer({ cible: I.CONJOINT, cle: CLE, secret: SECRET, fetch: instance(o).f });
    await assert.rejects(run({ postActif: true }), (e) => e.code === 'ACTIF' && e.etape === 'creation' && e.crees.join() === 'NouveauWf1');
    await assert.rejects(run({ getActif: true }), (e) => e.code === 'ACTIF' && e.etape === 'verification');
    await assert.rejects(run({ panne: (u, init) => (init.method === 'GET' && u.pathname === '/api/v1/workflows/NouveauWf1' ? () => reponse({}, 500) : null) }),
      (e) => e.code === 'VERIFICATION_ECHOUEE' && e.crees.join() === 'NouveauWf1' && I.messageSur(e) === `${I.MESSAGES.VERIFICATION_ECHOUEE} (étape : verification ; workflows créés : NouveauWf1)`);
    await assert.rejects(run({ alterer: (w) => { w.id = 'AutreWf'; } }), (e) => e.code === 'VERIFICATION_ECHOUEE');
    // Exception PENDANT la comparaison (référence locale illisible à ce moment) : diagnostic de reprise, jamais générique.
    const lireFs = fs.readFileSync; let armer = false;
    fs.readFileSync = function (f, ...r) { if (armer && String(f).endsWith('box-fonda-confirmer-relecture.recette.json')) throw new Error(`SECRET ${SECRET}`); return lireFs.call(this, f, ...r); };
    try {
      await assert.rejects(run({ panne: (u, init) => { if (init.method === 'GET' && u.pathname === '/api/v1/workflows/NouveauWf1') armer = true; return null; } }),
        (e) => e.code === 'VERIFICATION_ECHOUEE' && e.etape === 'verification' && e.crees.join() === 'NouveauWf1' && sans(I.messageSur(e), SECRET));
    } finally { fs.readFileSync = lireFs; }
    let posts = 0;
    const n = instance({ panne: (u, init) => (init.method === 'POST' && (posts += 1) === 2 ? () => { throw new Error(`réseau ${SECRET}`); } : null) });
    await assert.rejects(I.importer({ cible: I.CONJOINT, cle: CLE, secret: SECRET, fetch: n.f }), (e) => e.code === 'CREATION_NON_CONFIRMEE' && e.crees.join() === 'NouveauWf1' && sans(I.messageSur(e), SECRET));
    await assert.rejects(run({ panne: (u, init) => (init.method === 'POST' ? () => reponse({ id: '../x' }) : null) }), (e) => e.code === 'CREATION_NON_CONFIRMEE' && e.crees.length === 0);
    for (const ff of [async () => { throw new Error('x'); }, async () => ({ status: 200, json: async () => JSON.parse('{') }), async () => reponse([])]) {
      await assert.rejects(I.importer({ cible: EMETTRE, cle: CLE, secret: null, fetch: ff }), (e) => ['RECHERCHE_INCOMPLETE'].includes(e.code));
    }
  });
  test('K11 : réglages ajoutés par n8n à la création (callerPolicy, availableInMCP) -> identique ; autre valeur -> NON identique', async () => {
    const ajout = (v) => (w) => { w.settings.callerPolicy = v; w.settings.availableInMCP = false; };
    const ok = await I.importer({ cible: I.CONJOINT, cle: CLE, secret: SECRET, fetch: instance({ alterer: ajout('workflowsFromSameOwner') }).f });
    assert.deepEqual(ok.imports.map((x) => x.identique), [true, true]);
    const ko = await I.importer({ cible: EMETTRE, cle: CLE, secret: null, fetch: instance({ alterer: ajout('any') }).f });
    assert.equal(ko.imports[0].identique, false);
  });
  test('live altéré ailleurs que sur le secret -> NON identique (code 1) ; Emettre et Cloturer : aucun secret lu', async () => {
    const r = await I.importer({ cible: I.CONJOINT, cle: CLE, secret: SECRET, fetch: instance({ alterer: (w) => { delete w.settings.saveManualExecutions; } }).f });
    assert.deepEqual(r.imports.map((x) => x.ecarts), [['$.settings.saveManualExecutions : absent du live'], ['$.settings.saveManualExecutions : absent du live']]);
    for (const c of [EMETTRE, CLOTURER]) assert.equal((await I.importer({ cible: c, cle: CLE, secret: null, fetch: instance().f })).imports[0].identique, true);
  });
  test('principal : confirmation explicite, arguments exacts, cible fermée (Page ou Confirmer SEULS refusés), clé dédiée ; trousseau lu UNE fois, seulement en conjoint', async () => {
    const env = { FONDA_N8N_CLE_IMPORT_RECETTE: CLE };
    let lu = 0; const trousseau = () => { lu += 1; return SECRET; };
    for (const [a, code] of [[[PAGE], 'CONFIRMATION'], [['--confirmer-ecriture'], 'ARGUMENTS'], [['--confirmer-ecriture', PAGE, 'x'], 'ARGUMENTS'], [['--confirmer-ecriture', '--confirmer-ecriture'], 'ARGUMENTS'],
      [['--confirmer-ecriture', PAGE], 'CIBLE_HORS_LISTE'], [['--confirmer-ecriture', CONFIRMER], 'CIBLE_HORS_LISTE'], [['--confirmer-ecriture', 'page'], 'CIBLE_HORS_LISTE']])
      await assert.rejects(I.principal(a, { env, fetch: instance().f, trousseau }), (e) => e.code === code, a.join(' '));
    await assert.rejects(I.principal(['--confirmer-ecriture', I.CONJOINT], { env: {}, fetch: instance().f, trousseau }), (e) => e.code === 'CLE');
    assert.equal(lu, 0);
    assert.equal((await I.principal(['--confirmer-ecriture', EMETTRE], { env, fetch: instance().f, trousseau })).code, 0); assert.equal(lu, 0);
    assert.equal((await I.principal(['--confirmer-ecriture', I.CONJOINT], { env, fetch: instance().f, trousseau })).code, 0); assert.equal(lu, 1);
    assert.throws(() => new I.ErreurImport('INCONNU'), /hors liste fermée/);
    assert.equal(I.messageSur(new Error(SECRET)), 'erreur (message non affichable)');
  });
});

describe('import de recette : ligne de commande, chargement, surface (F1) et modules (X1)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-recette-'));
  const pre = path.join(dir, 'faux.js');
  // Faux réseau ET faux `security` par préchargement (child_process.execFileSync remplacé AVANT le chargement).
  fs.writeFileSync(pre, `const cp = require('child_process'); cp.execFileSync = (cmd, args) => { if (process.env.TROUSSEAU === 'panne') throw new Error('SECRET_SYNTHETIQUE'); return process.env.SECRET_TEST + '\\n'; };
const postes = {}; let n = 0;
globalThis.fetch = async (url, init) => { const u = new URL(url); const r = (c, s = 200) => ({ status: s, json: async () => c });
  if (process.env.MODE === 'panne-get' && init.method === 'GET' && u.pathname !== '/api/v1/workflows') return r({}, 500);
  if (init.method === 'GET' && u.pathname === '/api/v1/workflows') return r({ data: [], nextCursor: null });
  if (init.method === 'POST') { n += 1; postes['Wf' + n] = init.body; return r({ id: 'Wf' + n, ...JSON.parse(init.body), active: false }); }
  const id = u.pathname.split('/').pop(); return r({ id, ...JSON.parse(postes[id]), active: false, isArchived: false }); };\n`);
  const lancer = (args, env = {}) => spawnSync(process.execPath, ['-r', pre, path.join(__dirname, 'importer-recette.js'), ...args], { env: { ...process.env, FONDA_N8N_CLE_IMPORT_RECETTE: CLE, SECRET_TEST: SECRET, ...env }, encoding: 'utf8' });
  test('CLI : conjoint nominal -> code 0, sortie sans secret ; panne de relecture -> code 1, diagnostic avec ids ; trousseau en panne -> message fixe ; jamais le secret', () => {
    const ok = lancer(['--confirmer-ecriture', I.CONJOINT]);
    assert.equal(ok.status, 0, ok.stderr); assert.deepEqual(JSON.parse(ok.stdout).imports.map((x) => x.identique), [true, true]); assert.ok(sans(ok.stdout + ok.stderr, SECRET));
    const pg = lancer(['--confirmer-ecriture', I.CONJOINT], { MODE: 'panne-get' });
    assert.equal(pg.status, 1); assert.equal(pg.stdout, ''); assert.equal(pg.stderr, `importer-recette : ${I.MESSAGES.VERIFICATION_ECHOUEE} (étape : verification ; workflows créés : Wf1)\n`);
    const tr = lancer(['--confirmer-ecriture', I.CONJOINT], { TROUSSEAU: 'panne' });
    assert.equal(tr.status, 1); assert.equal(tr.stderr, `importer-recette : ${I.MESSAGES.TROUSSEAU}\n`); assert.ok(sans(tr.stdout + tr.stderr, 'SECRET_SYNTHETIQUE', SECRET));
    const sc = lancer([PAGE]); assert.equal(sc.status, 1); assert.equal(sc.stdout, ''); assert.equal(sc.stderr, `importer-recette : ${I.MESSAGES.CONFIRMATION}\n`);
  });
  test('erreur au CHARGEMENT d\'une dépendance : message fixe, code 1, aucun extrait', () => {
    const p = path.join(dir, 'chargement.js');
    fs.writeFileSync(p, `const M = require('module'); const req = M.prototype.require;
M.prototype.require = function (id) { if (String(id).includes(process.env.CIBLE)) throw new Error('SECRET_SYNTHETIQUE /chemin/prive'); return req.apply(this, arguments); };\n`);
    for (const cible of ['comparer-live', 'lecture-seule']) {
      const r = spawnSync(process.execPath, ['-r', p, path.join(__dirname, 'importer-recette.js'), '--confirmer-ecriture', I.CONJOINT], { env: { ...process.env, CIBLE: cible }, encoding: 'utf8' });
      assert.equal(r.status, 1, cible); assert.equal(r.stdout, ''); assert.equal(r.stderr, 'importer-recette : erreur (message non affichable)\n', cible);
    }
  });
  const signature = (f) => { const t = f.toString(); if (/^class\b/.test(t)) return '<classe>'; const i = t.indexOf('('); let d = 0; let j = i;
    for (; j < t.length; j += 1) { if (t[j] === '(') d += 1; else if (t[j] === ')') { d -= 1; if (!d) break; } } return t.slice(i + 1, j).replace(/\s+/g, ' ').trim(); };
  test('F1 : exports et signatures = LISTE FERMÉE', () => {
    const attendu = { CONJOINT: 'string', ErreurImport: '<classe>', FRAGMENT: 'string', MESSAGES: 'object', NOMS: 'object', SECRET_A_INJECTER: 'string', SERVICE_TROUSSEAU: 'string',
      importer: '{ cible, cle, secret, fetch: f = globalThis.fetch }', lireTrousseau: 'exec = execFileSync', messageSur: 'e', preparer: 'reference, secret',
      principal: 'argv, { env = process.env, fetch: f = globalThis.fetch, trousseau = lireTrousseau } = {}' };
    assert.deepEqual(Object.keys(I).sort(), Object.keys(attendu).sort());
    for (const [k, v] of Object.entries(I)) assert.equal(typeof v === 'function' ? signature(v) : typeof v, attendu[k], k);
    assert.deepEqual(Object.keys(I.MESSAGES), ['CONFIRMATION', 'ARGUMENTS', 'CIBLE_HORS_LISTE', 'EXPORT_ILLISIBLE', 'FRAGMENT', 'CLE', 'TROUSSEAU', 'SECRET_FORME', 'NOM_EXISTANT',
      'RECHERCHE_INCOMPLETE', 'TRANSPORT', 'HTTP', 'REPONSE', 'CREATION_NON_CONFIRMEE', 'VERIFICATION_ECHOUEE', 'ACTIF']);
  });
  test('X1 : modules chargés par l\'import conjoint, TRACÉS (Module._load) = LISTE FERMÉE', () => {
    const trace = path.join(dir, 'trace.js'); const sortie = path.join(dir, 'modules.json');
    fs.writeFileSync(trace, `const M = require('module'); const fs = require('fs'); const path = require('path'); const vus = new Set(); const orig = M._load;
M._load = function (req, parent, isMain) { const r = orig.apply(this, arguments);
  try { if (M.isBuiltin(req)) vus.add('node:' + req.replace(/^node:/, '')); else vus.add(path.relative(process.env.RACINE, M._resolveFilename(req, parent, isMain))); } catch { vus.add('<non résolu>'); }
  return r; };
process.on('exit', () => fs.writeFileSync(process.env.TRACE, JSON.stringify([...vus].sort())));\n`);
    const r = spawnSync(process.execPath, ['-r', trace, '-r', pre, path.join(__dirname, 'importer-recette.js'), '--confirmer-ecriture', I.CONJOINT],
      { cwd: RACINE, env: { ...process.env, RACINE, TRACE: sortie, FONDA_N8N_CLE_IMPORT_RECETTE: CLE, SECRET_TEST: SECRET }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const vus = JSON.parse(fs.readFileSync(sortie, 'utf8')).filter((x) => !(x.startsWith('..') && x.endsWith('/faux.js')));
    assert.deepEqual(vus, ['node:child_process', 'node:fs', 'node:path', 'outils-import/importer-recette.js', 'outils-recette/arguments.js', 'outils-recette/comparer-live.js', 'outils-recette/lecture-seule.js']);
  });
});
