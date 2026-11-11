'use strict';
// Tests de l'outil d'import de recette (ÉCRITURE explicite, P4b option E). Aucun réseau (fetch simulé), aucun
// trousseau réel (lecteur injecté). Prouvé : confirmation explicite, export en liste fermée, secret en forme
// stricte et jamais affiché, substitution du SEUL fragment exact, corps POSTÉ = texte substitué (aucune
// re-sérialisation), requêtes en liste fermée, aucun doublon, workflow inactif, identité par comparer-live.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
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
// Faux n8n : enregistre chaque appel ; POST -> id créé ; GET de l'id -> ce qui a été posté (+ métadonnées).
function instance({ existant = false, actif = false, alterer = null } = {}) {
  const appels = []; let poste = null;
  const f = async (url, init) => {
    appels.push({ url, init });
    const u = new URL(url);
    if (init.method === 'GET' && u.pathname === '/api/v1/workflows') return reponse({ data: existant ? [{ id: 'Ancien1', name: u.searchParams.get('name') }] : [], nextCursor: null });
    if (init.method === 'POST' && u.pathname === '/api/v1/workflows') { poste = init.body; return reponse({ id: 'NouveauWf1', ...JSON.parse(init.body), active: false }); }
    if (init.method === 'GET' && u.pathname === '/api/v1/workflows/NouveauWf1') {
      const w = { id: 'NouveauWf1', createdAt: 'x', updatedAt: 'x', versionId: 'v', ...JSON.parse(poste), active: actif, isArchived: false };
      if (alterer) alterer(w);
      return reponse(w);
    }
    return reponse({}, 404);
  };
  return { f, appels, poste: () => poste };
}
const sans = (t, ...x) => x.every((s) => !t.includes(s));

describe('import de recette : ÉCRITURE explicite, ensembles fermés, secret jamais affiché', () => {
  test('liste fermée : 4 exports de recette, noms de recette ; jamais un export de production', () => {
    assert.deepEqual(I.NOMS, ['FONDA RECETTE - Emettre relecture', 'FONDA RECETTE - Cloturer relecture', 'FONDA RECETTE - Confirmer relecture', 'FONDA RECETTE - Page relecture']);
    assert.equal(I.FRAGMENT, '"secret": "A_INJECTER_A_L_IMPORT"'); assert.equal(I.SERVICE_TROUSSEAU, 'fonda-recette-page-hmac');
    for (const r of ['n8n/fonda-relecture-page/box-fonda-page-relecture.json', `./${PAGE}`, path.join(RACINE, PAGE), 'x.json', null])
      assert.throws(() => I.preparer(r, SECRET), (e) => e.code === 'EXPORT_HORS_LISTE', String(r));
  });
  test('substitution du SEUL fragment exact (Page, Confirmer) ; constante de garde du code INTACTE ; reste octet pour octet', () => {
    for (const r of [PAGE, CONFIRMER]) {
      const avant = lire(r); const { texte } = I.preparer(r, SECRET);
      assert.equal(texte, avant.replace(I.FRAGMENT, `"secret": "${SECRET}"`), r);
      assert.equal(texte.length, avant.length + SECRET.length - 'A_INJECTER_A_L_IMPORT'.length);
      assert.ok(texte.includes('A_INJECTER_A_L_IMPORT'), `${r} : garde publique conservée dans le code`);
    }
    for (const r of [EMETTRE, CLOTURER]) assert.equal(I.preparer(r, null).texte, lire(r), r);
  });
  test('secret : forme stricte (64 hex minuscules) ; valeur de remplacement, absent, court, majuscules, saut de ligne -> refus', () => {
    for (const s of [undefined, null, '', 'A_INJECTER_A_L_IMPORT', 'ef'.repeat(31), 'EF'.repeat(32), `${SECRET}\n`, `${SECRET}0`, 'g'.repeat(64)])
      assert.throws(() => I.preparer(PAGE, s), (e) => e.code === 'SECRET_FORME', String(s));
  });
  test('import nominal : 3 requêtes EXACTES (liste par nom, POST du texte substitué, GET du créé) ; inactif ; identique ; secret absent de la sortie', async () => {
    const n = instance();
    const r = await I.importer({ reference: PAGE, cle: CLE, secret: SECRET, fetch: n.f });
    assert.deepEqual(r, { schema: 'import-recette/v1', export: PAGE, workflowId: 'NouveauWf1', identique: true, ecarts: [] });
    assert.deepEqual(n.appels.map((a) => [a.init.method, new URL(a.url).origin, new URL(a.url).pathname + new URL(a.url).search]), [
      ['GET', 'https://n8n.srv868991.hstgr.cloud', `/api/v1/workflows?name=${encodeURIComponent('FONDA RECETTE - Page relecture')}`],
      ['POST', 'https://n8n.srv868991.hstgr.cloud', '/api/v1/workflows'], ['GET', 'https://n8n.srv868991.hstgr.cloud', '/api/v1/workflows/NouveauWf1']]);
    assert.equal(n.poste(), lire(PAGE).replace(I.FRAGMENT, `"secret": "${SECRET}"`), 'corps POSTÉ = texte substitué, sans re-sérialisation');
    for (const a of n.appels) assert.equal(a.init.redirect, 'error');
    assert.ok(sans(JSON.stringify(r), SECRET));
  });
  test('aucun doublon : nom déjà présent -> refus AVANT tout POST', async () => {
    const n = instance({ existant: true });
    await assert.rejects(I.importer({ reference: PAGE, cle: CLE, secret: SECRET, fetch: n.f }), (e) => e.code === 'NOM_EXISTANT');
    assert.equal(n.appels.filter((a) => a.init.method === 'POST').length, 0);
  });
  test('créé ACTIF -> erreur signalée ; live altéré ailleurs que sur le secret -> NON identique (code 1)', async () => {
    await assert.rejects(I.importer({ reference: PAGE, cle: CLE, secret: SECRET, fetch: instance({ actif: true }).f }), (e) => e.code === 'ACTIF');
    const r = await I.importer({ reference: CONFIRMER, cle: CLE, secret: SECRET, fetch: instance({ alterer: (w) => { delete w.settings.executionTimeout; } }).f });
    assert.equal(r.identique, false); assert.deepEqual(r.ecarts, ['$.settings.executionTimeout : absent du live']);
  });
  test('principal : confirmation explicite, arguments exacts, clé en variable dédiée ; trousseau lu SEULEMENT pour Page et Confirmer', async () => {
    const env = { FONDA_N8N_CLE_IMPORT_RECETTE: CLE };
    let lu = 0; const trousseau = () => { lu += 1; return SECRET; };
    for (const a of [[PAGE], [PAGE, '--force'], ['--confirmer-ecriture'], ['--confirmer-ecriture', PAGE, 'x'], ['--confirmer-ecriture', '--confirmer-ecriture']])
      await assert.rejects(I.principal(a, { env, fetch: instance().f, trousseau }), (e) => ['CONFIRMATION', 'ARGUMENTS', 'EXPORT_HORS_LISTE'].includes(e.code), a.join(' '));
    await assert.rejects(I.principal(['--confirmer-ecriture', PAGE], { env: {}, fetch: instance().f, trousseau }), (e) => e.code === 'CLE');
    assert.equal(lu, 0);
    assert.equal((await I.principal(['--confirmer-ecriture', EMETTRE], { env, fetch: instance().f, trousseau })).code, 0); assert.equal(lu, 0);
    assert.equal((await I.principal(['--confirmer-ecriture', PAGE], { env, fetch: instance().f, trousseau })).code, 0); assert.equal(lu, 1);
  });
  test('ligne de commande : sans confirmation -> code 1, rien sur stdout, aucun réseau ; erreurs en messages fixes', () => {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'importer-recette.js'), PAGE], { env: { ...process.env, FONDA_N8N_CLE_IMPORT_RECETTE: CLE }, encoding: 'utf8' });
    assert.equal(r.status, 1); assert.equal(r.stdout, ''); assert.equal(r.stderr, `importer-recette : ${I.MESSAGES.CONFIRMATION}\n`);
    assert.throws(() => new I.ErreurImport('INCONNU'), /hors liste fermée/);
  });
});
