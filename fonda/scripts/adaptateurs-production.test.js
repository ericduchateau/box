// Tests UNITAIRES des adaptateurs de production (plan étape 5, lot 5) : transports simulés,
// disque temporaire, clés ÉPHÉMÈRES. Aucun réseau. Le parcours complet est dans
// adaptateurs-integration.test.js.
// Usage : node --test fonda/scripts/adaptateurs-production.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const A = require('./adaptateurs-production.js');
const SC = require('./signer-cloture.js');
const G = require('./generer-lot-fonda.js');

const SET = 'set_fonda_proportionnalite_nI_50';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
// fetch simulé : routes = [[RegExp | (url, init) => bool, (url, init) => { status, json?, octets? }]]
function faux(routes) {
  const appels = [];
  const f = async (url, init = {}) => {
    appels.push({ url: String(url), init });
    const r = routes.find(([m]) => (typeof m === 'function' ? m(String(url), init) : m.test(String(url))));
    if (!r) throw new Error(`route non simulée : ${url}`);
    const rep = await r[1](String(url), init);
    const status = rep.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => rep.json, arrayBuffer: async () => (rep.octets || Buffer.alloc(0)) };
  };
  f.appels = appels;
  return f;
}

describe('API n8n', () => {
  test('liste NON filtrée en statut, filtrée en workflowId, pagination complète, filtre côté client', async () => {
    const f = faux([[/executions\?/, (u) => {
      const q = new URL(u).searchParams;
      assert.equal(q.get('workflowId'), 'wf');
      assert.equal(q.has('status'), false, 'jamais status= (masquerait new/crashed)');
      return q.get('cursor') === 'c2'
        ? { json: { data: [{ id: '3', workflowId: 'wf', status: 'crashed', startedAt: 'a', stoppedAt: 'b' }], nextCursor: null } }
        : { json: { data: [{ id: '1', workflowId: 'wf', status: 'new', startedAt: null }, { id: '2', workflowId: 'wf', status: 'running', startedAt: 'a' }], nextCursor: 'c2' } };
    }]]);
    const api = A.apiN8n({ cle: 'k', fetch: f });
    assert.deepEqual((await api.listerExecutions({ workflowId: 'wf' })).map((x) => [x.id, x.status]), [['1', 'new'], ['2', 'running'], ['3', 'crashed']]);
    assert.deepEqual((await api.listerExecutions({ workflowId: 'wf', status: 'running' })).map((x) => x.id), ['2']);
    assert.equal(f.appels[0].init.headers['X-N8N-API-KEY'], 'k');
  });
  test('erreurs HTTP avec .statut (401 -> incident côté signataire) ; curseur en boucle refusé', async () => {
    const api = A.apiN8n({ cle: 'k', fetch: faux([[/executions\?/, () => ({ status: 401 })]]) });
    await assert.rejects(() => api.listerExecutions({ workflowId: 'wf' }), (e) => e.statut === 401);
    const boucle = A.apiN8n({ cle: 'k', fetch: faux([[/executions\?/, () => ({ json: { data: [], nextCursor: 'x' } })]]) });
    await assert.rejects(() => boucle.listerExecutions({ workflowId: 'wf' }), /boucle/);
  });
  test('lireExecution : includeData=true ; 404 -> null ; 500 -> erreur', async () => {
    const f = faux([[/executions\/7\?/, () => ({ json: { id: '7' } })], [/executions\/8\?/, () => ({ status: 404 })], [/executions\/9\?/, () => ({ status: 500 })]]);
    const api = A.apiN8n({ cle: 'k', fetch: f });
    assert.deepEqual(await api.lireExecution('7'), { id: '7' });
    assert.match(f.appels[0].url, /includeData=true/);
    assert.equal(await api.lireExecution('8'), null);
    await assert.rejects(() => api.lireExecution('9'), (e) => e.statut === 500);
  });
});

describe('Drive (compte de service, lecture seule)', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const cle = { type: 'service_account', client_email: 'sa@x.iam', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.example/token' };
  const DOSSIER = 'dossier-cand';
  const jeton = () => async () => 'jeton';
  const dossierOk = [/files\/dossier-cand\?/, () => ({ json: { id: DOSSIER, mimeType: 'application/vnd.google-apps.folder', trashed: false } })];
  test('jeton : JWT RS256 signé, portée drive.readonly SEULE, mis en cache', async () => {
    let n = 0;
    const f = faux([[/oauth2/, (u, init) => {
      n += 1;
      const assertion = new URLSearchParams(init.body).get('assertion').split('.');
      const corps = JSON.parse(Buffer.from(assertion[1], 'base64url'));
      assert.equal(corps.scope, 'https://www.googleapis.com/auth/drive.readonly');
      assert.ok(crypto.verify('sha256', Buffer.from(`${assertion[0]}.${assertion[1]}`), publicKey, Buffer.from(assertion[2], 'base64url')));
      return { json: { access_token: 't', expires_in: 3600 } };
    }]]);
    const j = A.jetonCompteService({ cle, fetch: f });
    assert.equal(await j(), 't');
    assert.equal(await j(), 't');
    assert.equal(n, 1);
    assert.throws(() => A.jetonCompteService({ cle: { type: 'user' } }), /service_account/);
  });
  test('dossier inaccessible (403/404) ou non dossier -> ERREUR, jamais liste vide', async () => {
    for (const [st, j] of [[403, null], [404, null], [200, { id: DOSSIER, mimeType: 'text/plain' }], [200, { id: DOSSIER, mimeType: 'application/vnd.google-apps.folder', trashed: true }]]) {
      const d = A.driveLecture({ jeton: jeton(), dossier: DOSSIER, fetch: faux([[/files\/dossier-cand\?/, () => ({ status: st, json: j })]]) });
      await assert.rejects(() => d.listerCandidats(), (e) => (st === 200 ? /accessible/.test(e.message) : e.statut === st));
    }
  });
  test('listerCandidats : pagination complète, incompleteSearch = OU de toutes les pages, même dossier, trashed = false', async () => {
    const f = faux([dossierOk, [/files\?/, (u) => {
      const q = new URL(u).searchParams;
      assert.equal(q.get('q'), `'${DOSSIER}' in parents and trashed = false`);
      assert.match(q.get('fields'), /incompleteSearch/);
      return q.get('pageToken') ? { json: { files: [{ id: 'b', name: 'y', modifiedTime: 't2' }], incompleteSearch: true } } : { json: { files: [{ id: 'a', name: 'x', modifiedTime: 't1', properties: { k: 'v' } }], nextPageToken: 'p2' } };
    }]]);
    const r = await A.driveLecture({ jeton: jeton(), dossier: DOSSIER, fetch: f }).listerCandidats();
    assert.equal(r.incompleteSearch, true, 'signalé en page 2 seulement');
    const f1 = faux([dossierOk, [/files\?/, (u) => (new URL(u).searchParams.get('pageToken') ? { json: { files: [], incompleteSearch: false } } : { json: { files: [], nextPageToken: 'p2', incompleteSearch: true } })]]);
    assert.equal((await A.driveLecture({ jeton: jeton(), dossier: DOSSIER, fetch: f1 }).listerCandidats()).incompleteSearch, true, 'signalé en page 1 seulement : jamais effacé par une page suivante');
    assert.deepEqual(r.fichiers.map((x) => [x.id, x.properties]), [['a', { k: 'v' }], ['b', {}]]);
    assert.ok(r.fichiers.every((x) => x.proprietesLisibles === true));
  });
  test('lireLotGenere : 0 -> null ; > 1 -> erreur ; recherche incomplète -> erreur ; contenu en octets', async () => {
    const avec = (files, extra = {}) => A.driveLecture({ jeton: jeton(), dossier: DOSSIER, fetch: faux([dossierOk, [/files\?/, (u) => {
      assert.match(new URL(u).searchParams.get('q'), new RegExp(`name = '${SET}\\.lot\\.json'`));
      return { json: { files, ...extra } };
    }], [/alt=media/, () => ({ octets: Buffer.from('{"x":1}') })]]) });
    assert.equal(await avec([]).lireLotGenere(SET), null);
    await assert.rejects(() => avec([{ id: 'a' }, { id: 'b' }]).lireLotGenere(SET), /2 fichiers/);
    await assert.rejects(() => avec([{ id: 'a' }], { incompleteSearch: true }).lireLotGenere(SET), /incomplète/);
    const lu = await avec([{ id: 'a', name: `${SET}.lot.json`, modifiedTime: 't' }]).lireLotGenere(SET);
    assert.ok(Buffer.isBuffer(lu.octets));
    assert.deepEqual({ ...lu, octets: lu.octets.toString() }, { id: 'a', nom: `${SET}.lot.json`, modifie_le: 't', octets: '{"x":1}' });
    await assert.rejects(() => avec([]).lireLotGenere("x' or 1=1"), /set_id invalide/);
  });
  test('candidatsDuSetId : nom OU propriété ; incomplet -> erreur', async () => {
    const f = faux([dossierOk, [/files\?/, (u) => {
      assert.match(new URL(u).searchParams.get('q'), /properties has \{ key='fonda_set_id'/);
      return { json: { files: [{ id: 'a' }] } };
    }]]);
    assert.equal(await A.driveLecture({ jeton: jeton(), dossier: DOSSIER, fetch: f }).candidatsDuSetId(SET), 1);
  });
});

describe('journal (git : chaîne du premier parent de origin/design)', () => {
  test('-> { surPremierParent, journal } ; second parent d\'un merge et commit invalide -> hors chaîne', async () => {
    const d = tmp('git-');
    const g = (...a) => execFileSync('git', a, { cwd: d, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    g('init', '-q', '-b', 'design');
    g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
    fs.mkdirSync(path.join(d, 'fonda/data'), { recursive: true });
    const ecrire = (lignes) => fs.writeFileSync(path.join(d, 'fonda/data/set_ids-journal.json'), JSON.stringify({ schema: 'set-ids-journal/v1', lignes }));
    ecrire([]); g('add', '.'); g('commit', '-qm', 'a');
    g('checkout', '-qb', 'branche');
    ecrire([{ set_id: SET, transition: 'reserve', le: '2026-10-20', ref: 'r0001' }]); g('commit', '-qam', 'b');
    const horsChaine = g('rev-parse', 'HEAD');
    g('checkout', '-q', 'design'); g('merge', '-q', '--no-ff', '-m', 'm', 'branche');
    const fusion = g('rev-parse', 'HEAD');
    g('update-ref', 'refs/remotes/origin/design', fusion);
    const j = A.journalGit({ git: (a) => execFileSync('git', a, { cwd: d, stdio: ['ignore', 'pipe', 'ignore'] }) });
    const r = await j(fusion);
    assert.equal(r.surPremierParent, true);
    assert.equal(r.journal.lignes[0].set_id, SET);
    assert.deepEqual(await j(horsChaine), { surPremierParent: false, journal: null });
    assert.deepEqual(await j('zz'), { surPremierParent: false, journal: null });
  });
});

describe('disque et registre des incidents', () => {
  test('ecrireExclusif : crée les dossiers, refuse d\'écraser', () => {
    const d = tmp('fs-');
    const p = path.join(d, 'a', 'b', 'x.json');
    A.fsProduction.ecrireExclusif(p, 'un');
    assert.equal(fs.readFileSync(p, 'utf8'), 'un');
    assert.throws(() => A.fsProduction.ecrireExclusif(p, 'deux'), /EEXIST/);
  });
  test('lecture STRICTE : tableau d\'objets à id uniques, sinon erreur (jamais [])', () => {
    const d = tmp('reg-');
    const p = path.join(d, 'incidents.json');
    for (const t of ['null', '{}', '[1]', '[{"id":""}]', '[{"id":"a"},{"id":"a"}]', 'x']) { fs.writeFileSync(p, t); assert.throws(() => A.lireRegistreStrict(p), /registre/, t); }
    const ok = { id: 'a', nature: 'n', detecte_le: '2026-01-01T10:00:00.000Z', statut: 'resolu', resolu_le: '2026-01-02T10:00:00.000Z', preuve_resolution: 'p', periode: { debut: null, fin: '2026-01-02T10:00:00.000Z' } };
    const ouvert = { ...ok, id: 'b', statut: 'ouvert', resolu_le: null, preuve_resolution: null, periode: { debut: '2026-01-01T09:00:00.000Z', fin: null } };
    fs.writeFileSync(p, JSON.stringify([ok, ouvert]));
    assert.deepEqual(A.lireRegistreStrict(p).map((i) => i.id), ['a', 'b']);
  });
  test('registre : format CDC §10 B exigé (clés exactes, ouvert/résolu cohérents, dates ordonnées)', () => {
    const p = path.join(tmp('reg-'), 'incidents.json');
    const ok = { id: 'a', nature: 'n', detecte_le: '2026-01-01T10:00:00.000Z', statut: 'resolu', resolu_le: '2026-01-02T10:00:00.000Z', preuve_resolution: 'p', periode: { debut: '2026-01-01T09:00:00.000Z', fin: '2026-01-02T10:00:00.000Z' } };
    const sans = (k) => { const o = { ...ok }; delete o[k]; return o; };
    const mauvais = [
      { id: 'a' }, sans('nature'), { ...ok, en_trop: 1 }, { ...ok, nature: ' ' }, { ...ok, detecte_le: 'hier' },
      { ...ok, statut: 'clos' }, { ...ok, periode: { debut: null } }, { ...ok, periode: { ...ok.periode, fin: '2026-01-03T10:00:00.000Z' } },
      { ...ok, periode: { debut: '2026-01-03T00:00:00.000Z', fin: ok.resolu_le } }, { ...ok, detecte_le: '2026-01-03T00:00:00.000Z' }, { ...ok, preuve_resolution: '' },
      { ...ok, statut: 'ouvert' }, { ...ok, statut: 'ouvert', resolu_le: null, preuve_resolution: null },
    ];
    for (const m of mauvais) { fs.writeFileSync(p, JSON.stringify([m])); assert.throws(() => A.lireRegistreStrict(p), /§10 B|sans id/, JSON.stringify(m)); }
    assert.equal(A.incidentMalforme(ok), null);
  });
  test('incidents() : non initialisé, registre perdu -> erreurs ORDINAIRES (refus temporaire côté signataire, pas d\'incident)', async () => {
    const d = tmp('reg-');
    const inc = A.registreIncidents({ dossier: d });
    await assert.rejects(inc, (e) => /non initialisé/.test(e.message) && e.statut === undefined);
    fs.writeFileSync(path.join(d, '.initialise'), '{}');
    await assert.rejects(inc, (e) => /PERDU/.test(e.message) && e.statut === undefined);
  });
  test('--initialiser : 4 combinaisons, jamais de remise à zéro, refus si traces d\'usage ou incidents cités au catalogue', async () => {
    const vide = async () => [];
    const d = tmp('init-');
    assert.deepEqual(await A.initialiser({ dossier: d, attestationsCatalogue: vide })(), { initialise: true });
    assert.equal(fs.readFileSync(path.join(d, 'incidents.json'), 'utf8'), '[]\n');
    fs.writeFileSync(path.join(d, 'incidents.json'), '[{"id":"i1"}]');
    assert.equal((await A.initialiser({ dossier: d, attestationsCatalogue: vide })()).initialise, false);
    assert.equal(fs.readFileSync(path.join(d, 'incidents.json'), 'utf8'), '[{"id":"i1"}]', 'jamais remis à zéro');
    fs.unlinkSync(path.join(d, 'incidents.json'));
    await assert.rejects(A.initialiser({ dossier: d, attestationsCatalogue: vide }), /PERDU/);
    const d2 = tmp('init-'); fs.writeFileSync(path.join(d2, 'incidents.json'), '[]');
    await assert.rejects(A.initialiser({ dossier: d2, attestationsCatalogue: vide }), /interrompue/);
    for (const trace of [`${SET}.signature`, `${SET}`, 'verrous/x']) {
      const d3 = tmp('init-');
      const p = path.join(d3, trace);
      if (trace === SET) fs.mkdirSync(p); else { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ''); }
      await assert.rejects(A.initialiser({ dossier: d3, attestationsCatalogue: vide }), /usage antérieur/, trace);
      assert.ok(!fs.existsSync(path.join(d3, 'incidents.json')));
    }
    const d4 = tmp('init-');
    await assert.rejects(A.initialiser({ dossier: d4, attestationsCatalogue: async () => [{ entree: { set_id: 'x' }, charge: { incidents_connus: [{ id: 'i' }] } }] }), /catalogue x/);
  });
});

describe('témoin d\'incidents (option a)', () => {
  const I = (o = {}) => ({ id: 'inc1', nature: 'panne', detecte_le: '2026-01-01T10:00:00.000Z', statut: 'resolu', resolu_le: '2026-01-02T10:00:00.000Z', preuve_resolution: 'p', periode: { debut: null, fin: '2026-01-02T10:00:00.000Z' }, ...o });
  const avecCat = (incs) => async () => [{ entree: { set_id: 'c1' }, charge: { incidents_connus: incs } }];
  const d = tmp('tem-');
  test('sur-ensemble exigé, projection COMPLÈTE, dates normalisées (+02:00 = Z), ordre des clés indifférent', async () => {
    const t = A.temoinIncidents({ dossier: d, verifier: null, attestationsCatalogue: avecCat([I()]) });
    await t([I({ detecte_le: '2026-01-01T12:00:00.000+02:00' })]); // même instant
    const inverse = Object.fromEntries(Object.entries(I()).reverse());
    await t([inverse]);
    await assert.rejects(() => t([]), /incomplet/);
    await assert.rejects(() => t([I({ preuve_resolution: 'autre' })]), /modifié/);
    await assert.rejects(() => t([I({ statut: 'ouvert' })]), /modifié/);
    await assert.rejects(() => t([I({ detecte_le: '2026-01-01T10:00:01.000Z' })]), /modifié/);
  });
  test('valeurs contradictoires d\'un même incident entre attestations -> erreur', async () => {
    const t = A.temoinIncidents({ dossier: d, verifier: null, attestationsCatalogue: async () => [{ entree: { set_id: 'a' }, charge: { incidents_connus: [I()] } }, { entree: { set_id: 'b' }, charge: { incidents_connus: [I({ nature: 'autre' })] } }] });
    await assert.rejects(() => t([I()]), /contradictoires/);
  });
  test('attestations LOCALES lues seulement après vérification PAR SIGNATURE', async () => {
    const dl = tmp('tem-');
    const lot = path.join(dl, `${SET}-0123456789abcdef`);
    fs.mkdirSync(lot); fs.writeFileSync(path.join(lot, 'attestation.json'), '{}');
    let verifie = 0;
    const t = A.temoinIncidents({ dossier: dl, verifier: async () => { verifie += 1; throw new Error('signature invalide'); }, attestationsCatalogue: async () => [] });
    await assert.rejects(() => t([]), /signature invalide/);
    assert.equal(verifie, 1);
  });
  test('catalogue : 8 « manuelle-historique » ignorées ; cloture-signee malformée REFUSÉE ; autre type refusé', async () => {
    const racine = path.join(__dirname, '..', '..');
    const git = (a) => execFileSync('git', a, { cwd: racine, stdio: ['ignore', 'pipe', 'ignore'] });
    const s = A.sourcesLecture({ api: {}, drive: {}, dossier: d, racine, git });
    const reel = JSON.parse(git(['show', 'origin/design:fonda/data/catalogue-fonda.json']).toString('utf8'));
    // le catalogue publié contient désormais les clôtures signées ; attestationsCatalogue() doit
    // retourner EXACTEMENT ces clôtures (vérifiées en entier), les 8 « manuelle-historique » ignorées.
    const cloturesSignees = reel.lots.filter((l) => l.attestation && l.attestation.type === 'cloture-signee').map((l) => l.set_id).sort();
    assert.deepEqual((await s.attestationsCatalogue()).map((x) => x.entree.set_id).sort(), cloturesSignees, 'attestationsCatalogue() = exactement les clotures signees publiees du catalogue');
    const avec = (cat) => A.attestationsDuCatalogue({ git: (a) => (a[0] === 'show' && /catalogue-fonda/.test(a[1]) ? Buffer.from(JSON.stringify(cat)) : git(a)), cles: s.cles, registre: s.registre, modelesAutorises: s.modelesAutorises, resoudre: s.resoudre });
    const modif = (f) => { const c = JSON.parse(JSON.stringify(reel)); f(c.lots[0]); return c; };
    const cas = [
      [{}, /forme catalogue-fonda\/v1/], [{ lots: [] }, /forme/], [{ schema: 'catalogue-fonda/v1', lots: {} }, /forme/],
      // historique réduit au type, ou valeur figée altérée : refusé par le validateur RÉEL du catalogue
      [{ ...reel, lots: [{ set_id: reel.lots[0].set_id, attestation: { type: 'manuelle-historique' } }] }, /non conforme/],
      [modif((e) => { e.empreinte = `sha256:${'0'.repeat(64)}`; }), /non conforme/],
      [modif((e) => { e.moteur = { version: 'v1', sha256: '0'.repeat(64) }; }), /non conforme/],
      [modif((e) => { e.relecteur = { forme: 'relue_par', nom_affiche: 'Autre', id: 'autre' }; }), /non conforme/],
      [modif((e) => { e.attestation.charge = { incidents_connus: [{ id: 'i' }] }; }), /non conforme|porteuse d'une charge/],
      [modif((e) => { e.attestation = { type: 'cloture-signee', charge: {}, signature: 'x' }; }), /non conforme|non vérifiée/],
      [modif((e) => { e.attestation = { type: 'autre' }; }), /non conforme|type inattendu/],
    ];
    for (const [cat, motif] of cas) await assert.rejects(avec(cat), motif, JSON.stringify(cat).slice(0, 200));
    assert.deepEqual((await avec(reel)()).map((x) => x.entree.set_id).sort(), cloturesSignees, 'catalogue réel : clôtures signées acceptées et vérifiées en entier');
  });
});

describe('clé de signature : préparée AVANT la clôture', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
  const autre = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
  const dc = tmp('cles-');
  fs.writeFileSync(path.join(dc, 'test.priv.pem'), privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'bonne' }));
  const cles = (pub) => ({ obtenir: (id) => (id === 'test' ? { ok: true, cle: pub, declaration: {} } : { ok: false, raison: 'inconnue' }) });
  test('bonne phrase, paire concordante -> signer(octets) SYNCHRONE -> Buffer vérifiable', async () => {
    const signer = await A.preparerSignataire({ dossierCles: dc, cleId: 'test', cles: cles(publicKey), lirePhrase: async () => 'bonne' });
    const sig = signer(Buffer.from('charge'));
    assert.ok(Buffer.isBuffer(sig));
    assert.ok(crypto.verify('sha256', Buffer.from('charge'), { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, sig));
  });
  for (const [nom, o, motif] of [
    ['phrase fausse', { cles: cles(publicKey), lirePhrase: async () => 'mauvaise' }, /phrase de passe incorrecte/],
    ['annulation', { cles: cles(publicKey), lirePhrase: async () => null }, /annulée/],
    ['paire fausse (clé publique déclarée différente)', { cles: cles(autre.publicKey), lirePhrase: async () => 'bonne' }, /≠ clé publique déclarée/],
    ['clé non déclarée', { cles: cles(publicKey), cleId: 'inconnue', lirePhrase: async () => 'bonne' }, /inconnue/],
  ]) {
    test(`${nom} : refus, rien n'est consommé`, async () => {
      await assert.rejects(() => A.preparerSignataire({ dossierCles: dc, cleId: 'test', ...o }), motif);
    });
  }
});

describe('fabriques : EXACTEMENT ce que consomment saisie et clôture', () => {
  const racine = path.join(__dirname, '..', '..');
  const s = A.sourcesLecture({ api: { listerExecutions: async () => [], lireExecution: async () => null }, drive: { lireLotGenere: async () => null, listerCandidats: async () => ({ incompleteSearch: false, fichiers: [] }) }, dossier: tmp('fab-'), racine });
  test('sources : modelesAutorises = lireModelesAutorises(TEXTE) (tableau) ; registre = moteurs.json', () => {
    assert.ok(Array.isArray(s.modelesAutorises));
    assert.deepEqual(s.registre, JSON.parse(fs.readFileSync(path.join(racine, 'fonda/engine/moteurs.json'), 'utf8')));
  });
  test('referentielArchive -> OCTETS (version du référentiel courant de design)', async () => {
    let version;
    try { version = `sha256:${crypto.createHash('sha256').update(execFileSync('git', ['show', 'origin/design:fonda/data/referentiel.json'], { cwd: racine })).digest('hex')}`; } catch { return; }
    const o = await s.referentielArchive(version);
    assert.ok(Buffer.isBuffer(o));
  });
  test('clôture : toutes les clés lues par cloturer, config complète (modelesAutorises DANS config), rattachement ABSENT par défaut', () => {
    const d = A.dependancesCloture({ sources: s, signer: () => Buffer.alloc(0) });
    assert.deepEqual(Object.keys(d).sort(), ['afficher', 'api', 'cles', 'config', 'decisionsLocales', 'drive', 'fs', 'horloge', 'incidents', 'journal', 'levees', 'rattachement', 'referentielArchive', 'registre', 'saisir', 'signer', 'tableRelecteurs'].sort());
    assert.equal(d.rattachement, undefined, 'garde maîtresse : aucun rattachement fourni en production');
    assert.deepEqual(Object.keys(d.config).sort(), ['cleId', 'dossier', 'modelesAutorises', 'source', 'workflowGeneration']);
    assert.equal(d.config.source, 'saisie_locale');
    assert.ok(Array.isArray(d.config.modelesAutorises));
    assert.deepEqual(Object.keys(d.drive).sort(), ['lireLotGenere', 'listerCandidats']);
    for (const f of ['journal', 'decisionsLocales', 'incidents', 'referentielArchive', 'horloge']) assert.equal(typeof d[f], 'function', f);
    for (const f of ['existe', 'lire', 'lister', 'ecrireExclusif', 'realpath']) assert.equal(typeof d.fs[f], 'function', `fs.${f}`);
    assert.equal(typeof d.cles.obtenir, 'function');
  });
  test('saisie : config { dossier, workflowGeneration }, referentielArchive, moteur DESCRIPTEUR rapproché de la génération', async () => {
    const reg = s.registre[0];
    const exec = (sortie) => ({ data: { resultData: { runData: { 'FONDA Entree generation': [{ data: { main: [[{ json: { set_id: SET, ref: 'r' } }]] } }], 'FONDA Sortie generation': [{ data: { main: [[{ json: sortie }]] } }] } } } });
    const api = { listerExecutions: async ({ status }) => (status ? [] : [{ id: '1', workflowId: 'vrqgtS5kQMvP9Ok5', status: 'success', startedAt: '2026-10-20T07:00:00.000Z', stoppedAt: '2026-10-20T07:01:00.000Z' }]), lireExecution: async () => exec({ moteur: { version: reg.version, sha256: reg.sha256 } }) };
    const d = await A.dependancesSaisie(SET, { sources: { ...s, api } });
    assert.deepEqual(Object.keys(d).sort(), ['afficher', 'api', 'config', 'drive', 'fs', 'horloge', 'moteur', 'referentielArchive', 'registre', 'saisir'].sort());
    assert.deepEqual(d.config, { dossier: s.dossier, workflowGeneration: 'vrqgtS5kQMvP9Ok5' });
    assert.deepEqual(d.moteur, { version: reg.version, sha256: reg.sha256 }, 'descripteur, pas une instance');
    assert.equal(typeof d.referentielArchive, 'function');
    const api2 = { ...api, lireExecution: async () => exec({ moteur: { version: reg.version, sha256: '0'.repeat(64) } }) };
    await assert.rejects(() => A.dependancesSaisie(SET, { sources: { ...s, api: api2 } }), /registre/);
  });
});

describe('sources : options injectables et séparation des secrets', () => {
  const racine = path.join(__dirname, '..', '..');
  test('urlN8n et dossierDrive injectables : les requêtes partent vers les cibles données', async () => {
    const dc = tmp('cles-');
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    fs.writeFileSync(path.join(dc, 'n8n-signataire.cle'), 'cle-test\n');
    fs.writeFileSync(path.join(dc, 'drive-compte-service.json'), JSON.stringify({ type: 'service_account', client_email: 'sa@x.iam', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.example/token' }));
    const f = faux([
      [/oauth2/, () => ({ json: { access_token: 't', expires_in: 3600 } })],
      [/^https:\/\/n8n\.test\.invalid\//, () => ({ json: { data: [], nextCursor: null } })],
      [/files\/autre-dossier\?/, () => ({ json: { id: 'autre-dossier', mimeType: 'application/vnd.google-apps.folder', trashed: false } })],
      [/files\?/, () => ({ json: { files: [] } })],
    ]);
    const s = A.sourcesLecture({ racine, dossier: tmp('clo-'), dossierCles: dc, fetch: f, urlN8n: 'https://n8n.test.invalid', dossierDrive: 'autre-dossier' });
    await s.api.listerExecutions({ workflowId: A.WORKFLOW_GENERATION });
    await s.drive.listerCandidats();
    assert.ok(f.appels.some((a) => a.url.startsWith('https://n8n.test.invalid/')));
    assert.ok(f.appels.some((a) => /'autre-dossier' in parents/.test(decodeURIComponent(a.url.replace(/\+/g, ' ')))));
    assert.ok(!f.appels.some((a) => /srv868991|1Ir-iJGZ/.test(a.url)), 'aucune cible de production');
  });
  test('sourcesLocales : aucun secret réseau lu ; sourcesLecture : secret absent -> erreur explicite', () => {
    const vide = tmp('cles-');
    const l = A.sourcesLocales({ racine, dossier: tmp('clo-'), dossierCles: vide });
    assert.equal(l.api, undefined);
    assert.equal(l.drive, undefined);
    assert.throws(() => A.sourcesLecture({ racine, dossier: tmp('clo-'), dossierCles: vide }), /n8n-signataire\.cle illisible/);
  });
});

describe('saisie au terminal (r2 #7)', () => {
  test('fin d\'entrée -> REFUS explicite (SaisieInterrompue), jamais une chaîne vide ; réponse normale transmise', async () => {
    const { Readable, PassThrough } = require('stream');
    await assert.rejects(A.saisirTerminal('garder / ecarter : ', { entree: Readable.from([]), sortie: new PassThrough() }), (e) => e instanceof A.SaisieInterrompue && /fin d'entrée/.test(e.message));
    assert.equal(await A.saisirTerminal('q : ', { entree: Readable.from(['garder\n']), sortie: new PassThrough() }), 'garder');
  });
});

describe('lot 4 bis : --palier', () => {
  test('consomme sa valeur ; absente, inconnue, en double ou hors --reserver -> refus', () => {
    assert.deepEqual(G.analyserArgumentsCli(['--reserver', 'maths.proportionnalite', '--palier', 'nI']), { args: ['--reserver', 'maths.proportionnalite'], palier: 'nI' });
    assert.deepEqual(G.analyserArgumentsCli(['--reserver', 'maths.proportionnalite']), { args: ['--reserver', 'maths.proportionnalite'], palier: undefined });
    assert.throws(() => G.analyserArgumentsCli(['--reserver', 'x', '--palier']), /valeur/);
    assert.throws(() => G.analyserArgumentsCli(['--reserver', 'x', '--palier', '--autre']), /valeur/);
    assert.throws(() => G.analyserArgumentsCli(['--reserver', 'x', '--palier', 'n0']), /inconnu/);
    assert.throws(() => G.analyserArgumentsCli(['--reserver', 'x', '--palier', 'nI', '--palier', 'nF']), /double/);
    assert.throws(() => G.analyserArgumentsCli(['--set-id=x', '--palier', 'nI']), /--reserver/);
  });
});

test('signataire : la clôture <set_id> reste REFUSÉE par la garde (rattachement undefined), avant toute lecture', async () => {
  const appels = [];
  const espion = new Proxy({}, { get: (_, k) => { appels.push(k); return () => { throw new Error('appel interdit'); }; } });
  await assert.rejects(() => SC.cloturer(SET, { rattachement: undefined, api: espion, drive: espion, fs: espion, signer: espion, config: { source: 'page_relecture' } }), /NON DÉFINI/);
  assert.deepEqual(appels, [], 'aucun réseau, aucun disque, aucune clé avant le refus');
});
