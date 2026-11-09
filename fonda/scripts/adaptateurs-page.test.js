// Tests des adaptateurs du parcours PAGE (CDC relecture §21.3, §21.8) : pré-lecture des détails
// dans le listing borné, lireCandidat (identité Drive non énumérable), listerDecisions (corbeille
// comprise, pagination, incompleteSearch agrégé). Aucun appel réseau réel (fetch simulé).
// Usage : node --test fonda/scripts/adaptateurs-page.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const L = require('./liaison-generation.js');
const A = require('./adaptateurs-page.js');

describe('preLireDetails (§21.3)', () => {
  test('détails des exécutions TERMINALES seulement ; panne -> INDISPONIBLE ; introuvable -> null ; partielles examinées', async () => {
    const lus = [];
    const api = { lireExecution: async (id) => { lus.push(id); if (id === '3') throw new Error('panne'); return id === '4' ? null : { id }; } };
    const lire = async (quoi, f) => { try { return { ok: true, v: await f() }; } catch { return { ok: false }; } };
    const clotures = { ok: true, v: [{ id: '1', status: 'success' }, { id: '2', status: 'running' }] };
    const confirmations = { ok: false, partiel: [{ id: '3', status: 'error' }, { id: '4', status: 'success' }, { id: '5', status: 'waiting' }] };
    await A.preLireDetails({ api, lire, clotures, confirmations });
    assert.deepEqual(lus, ['1', '3', '4']);
    assert.deepEqual([...clotures.details.entries()], [['1', { id: '1' }]]);
    assert.equal(confirmations.details.get('3'), L.INDISPONIBLE);
    assert.equal(confirmations.details.get('4'), null);
    assert.equal(confirmations.details.has('5'), false);
  });
});

function fauxDrive(routes) {
  const appels = [];
  const f = async (url, init) => {
    appels.push({ url: decodeURIComponent(url.replace(/\+/g, ' ')), init });
    for (const [re, rep] of routes) if (re.test(decodeURIComponent(url.replace(/\+/g, ' ')))) {
      const r = typeof rep === 'function' ? rep(url) : rep;
      return { ok: (r.status || 200) < 300, status: r.status || 200, json: async () => r.json, arrayBuffer: async () => Buffer.from(r.texte || '') };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  f.appels = appels;
  return f;
}
const DOSSIER = (id) => [new RegExp(`files/${id}\\?fields`), { json: { id, mimeType: 'application/vnd.google-apps.folder', trashed: false } }];
const SET = 'set_fonda_comprendre-consigne_nI_92';

describe('lecturePage : lireCandidat et listerDecisions (§21.8)', () => {
  test('lireCandidat : enveloppe + identité Drive NON énumérable (absente de JSON et des copies)', async () => {
    const f = fauxDrive([DOSSIER('rel'), [/files\?q=/, { json: { files: [{ id: 'drv-c', name: `${SET}.candidat.json`, modifiedTime: '2026-10-20T08:00:00.000Z' }] } }], [/files\/drv-c\?alt=media/, { texte: '{"schema":"candidat-fonda/v1","lot":{},"relecture":{}}' }]]);
    const d = A.lecturePage({ jeton: async () => 't', fetch: f, dossierRelecture: 'rel', dossierDecisions: 'dec' });
    const env = await d.lireCandidat(SET);
    assert.equal(env.schema, 'candidat-fonda/v1');
    assert.deepEqual(env.drive, { id: 'drv-c', nom: `${SET}.candidat.json`, modifie_le: '2026-10-20T08:00:00.000Z' });
    assert.ok(!Object.keys(env).includes('drive'));
    assert.equal({ ...env }.drive, undefined);
    assert.ok(f.appels.some((a) => /trashed = false and name = 'set_fonda_comprendre-consigne_nI_92\.candidat\.json'/.test(a.url)));
  });
  test('lireCandidat : absent -> null ; deux fichiers ou recherche incomplète -> erreur ; set_id invalide -> erreur avant tout appel', async () => {
    const lect = (files, extra = {}) => A.lecturePage({ jeton: async () => 't', fetch: fauxDrive([DOSSIER('rel'), [/files\?q=/, { json: { files, ...extra } }]]), dossierRelecture: 'rel', dossierDecisions: 'dec' });
    assert.equal(await lect([]).lireCandidat(SET), null);
    await assert.rejects(lect([{ id: 'a' }, { id: 'b' }]).lireCandidat(SET), /2 fichiers/);
    await assert.rejects(lect([], { incompleteSearch: true }).lireCandidat(SET), /incomplète/);
    await assert.rejects(lect([]).lireCandidat("x' or 1=1"), /set_id invalide/);
  });
  test('listerDecisions : TOUT decisions/ (corbeille comprise), pagination, incompleteSearch agrégé, contenu lu (illisible -> null)', async () => {
    const f = fauxDrive([
      DOSSIER('dec'),
      [/pageToken=p2/, { json: { files: [{ id: 'f2', name: 'b.json', modifiedTime: 'm2', trashed: true }], incompleteSearch: true } }],
      [/files\?q=/, { json: { files: [{ id: 'f1', name: 'a.json', modifiedTime: 'm1', properties: { fonda_set_id: SET } }], nextPageToken: 'p2' } }],
      [/files\/f1\?alt=media/, { texte: '{"set_id":"x"}' }],
      [/files\/f2\?alt=media/, { texte: '{ cassé' }],
    ]);
    const r = await A.lecturePage({ jeton: async () => 't', fetch: f, dossierRelecture: 'rel', dossierDecisions: 'dec' }).listerDecisions(SET);
    assert.equal(r.incompleteSearch, true);
    assert.deepEqual(r.fichiers.map((x) => [x.id, x.nom, x.corbeille, x.contenu]), [['f1', 'a.json', false, { set_id: 'x' }], ['f2', 'b.json', true, null]]);
    const q = f.appels.find((a) => /files\?q=/.test(a.url)).url;
    assert.ok(!/trashed/.test(q.split('fields=')[0]), 'corbeille comprise (aucun filtre trashed)');
  });
  test('listerDecisions : une panne n\'efface pas ce qui a été lu (fichier illisible conservé, 503 rendu à part, listing non complet)', async () => {
    const f = fauxDrive([
      DOSSIER('dec'),
      [/files\?q=/, { json: { files: [{ id: 'f1', name: 'a.json', modifiedTime: 'm1' }, { id: 'f2', name: 'b.json', modifiedTime: 'm2' }] } }],
      [/files\/f1\?alt=media/, { texte: '{ cassé' }],
      [/files\/f2\?alt=media/, { status: 503 }],
    ]);
    const r = await A.lecturePage({ jeton: async () => 't', fetch: f, dossierRelecture: 'rel', dossierDecisions: 'dec' }).listerDecisions(SET);
    assert.equal(r.complet, false);
    assert.deepEqual(r.fichiers.map((x) => [x.id, x.contenu, x.erreur && x.erreur.statut]), [['f1', null, undefined], ['f2', null, 503]]);
    assert.deepEqual(r.erreurs.map((e) => [e.quoi, e.statut]), [['décision b.json', 503]]);
  });
  test('listerDecisions : pagination interrompue -> pages déjà lues conservées, erreur « liste », recherche incomplète', async () => {
    const f = fauxDrive([
      DOSSIER('dec'),
      [/pageToken=p2/, { status: 500 }],
      [/files\?q=/, { json: { files: [{ id: 'f1', name: 'a.json', modifiedTime: 'm1' }], nextPageToken: 'p2' } }],
      [/files\/f1\?alt=media/, { texte: '{"set_id":"x"}' }],
    ]);
    const r = await A.lecturePage({ jeton: async () => 't', fetch: f, dossierRelecture: 'rel', dossierDecisions: 'dec' }).listerDecisions(SET);
    assert.equal(r.complet, false); assert.equal(r.incompleteSearch, true);
    assert.deepEqual(r.fichiers.map((x) => x.id), ['f1']);
    assert.deepEqual(r.erreurs.map((e) => [e.quoi, e.statut]), [['liste', 500]]);
  });
  for (const [nom, page2] of [['liste inexploitable', { json: { pas: 'de files' } }], ['pagination en boucle', { json: { files: [], nextPageToken: 'p2' } }]]) {
    test(`listerDecisions : ${nom} en page 2 -> pages déjà lues CONSERVÉES et lues, erreur « liste »`, async () => {
      const f = fauxDrive([
        DOSSIER('dec'),
        [/pageToken=p2/, page2],
        [/files\?q=/, { json: { files: [{ id: 'f1', name: 'a.json', modifiedTime: 'm1' }], nextPageToken: 'p2' } }],
        [/files\/f1\?alt=media/, { texte: '{"set_id":"x"}' }],
      ]);
      const r = await A.lecturePage({ jeton: async () => 't', fetch: f, dossierRelecture: 'rel', dossierDecisions: 'dec' }).listerDecisions(SET);
      assert.equal(r.complet, false); assert.equal(r.incompleteSearch, true);
      assert.deepEqual(r.fichiers.map((x) => [x.id, x.contenu]), [['f1', { set_id: 'x' }]]);
      assert.deepEqual(r.erreurs.map((e) => e.quoi), ['liste']);
    });
  }
  test('erreur HTTP : .statut conservé (401/403 -> incident côté signataire)', async () => {
    const d = A.lecturePage({ jeton: async () => 't', fetch: fauxDrive([[/files\/dec\?fields/, { status: 403 }]]), dossierRelecture: 'rel', dossierDecisions: 'dec' });
    await assert.rejects(d.listerDecisions(SET), (e) => e.statut === 403);
  });
});
