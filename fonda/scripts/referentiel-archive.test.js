// Tests du résolveur de référentiel archivé (CDC relecture v8.3 §20.12), sur un dépôt Git
// TEMPORAIRE : historique de confiance = chaîne du premier parent ; versions hors de cette
// chaîne (second parent d'une fusion, copie de travail) jamais retenues.
'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const RA = require('./referentiel-archive.js');
const M = require('./verifier-moteurs.js');

let dir;
const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
const ecrireRef = (texte) => { fs.mkdirSync(path.join(dir, 'fonda/data'), { recursive: true }); fs.writeFileSync(path.join(dir, RA.CHEMIN), texte); };
const commit = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
const V = {};
const ref = (relecteur) => `${JSON.stringify({ schema: 'referentiel/v1', notions: [{ id: 'maths.x', relecteur }] }, null, 2)}\n`;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-archive-'));
  git('init', '-q', '-b', 'design');
  git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'test'); git('config', 'commit.gpgsign', 'false');
  ecrireRef(ref('eric')); V.v1 = { texte: ref('eric'), commit: commit('v1') };
  ecrireRef(ref('justine')); V.v2 = { texte: ref('justine'), commit: commit('v2') };
  // Branche latérale : v3 n'existe que sur le SECOND parent de la fusion.
  git('checkout', '-q', '-b', 'cote');
  ecrireRef(ref('tiers')); V.v3 = { texte: ref('tiers'), commit: commit('v3 latérale') };
  ecrireRef(ref('justine')); commit('retour v2');
  git('checkout', '-q', 'design');
  git('merge', '-q', '--no-ff', '-m', 'fusion', 'cote');
  // Version invalide (JSON cassé) sur la chaîne du premier parent.
  ecrireRef('{ cassé'); V.casse = { texte: '{ cassé', commit: commit('json cassé') };
  ecrireRef(ref('justine')); commit('réparé');
  // Copie de travail : version jamais commitée.
  ecrireRef(ref('locale'));
});
after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

const resoudre = (texte, x = {}) => RA.resoudreReferentiel({ version: RA.versionDe(Buffer.from(texte)), refs: ['design'], racine: dir, ...x });

describe('résolveur de référentiel archivé (§20.12)', () => {
  test('versions du premier parent retrouvées : octets du blob, JSON, commit', () => {
    for (const k of ['v1', 'v2']) {
      const r = resoudre(V[k].texte);
      assert.equal(r.ok, true, r.raison);
      assert.equal(r.octets.toString('utf8'), V[k].texte);
      assert.equal(RA.versionDe(r.octets), RA.versionDe(Buffer.from(V[k].texte)));
      assert.equal(typeof r.referentiel.notions[0].relecteur, 'string');
    }
    assert.equal(resoudre(V.v1.texte).commit, V.v1.commit);
  });
  test('version du SECOND parent seulement (branche latérale fusionnée) : introuvable', () => {
    assert.match(resoudre(V.v3.texte).raison, /introuvable sur l'historique de confiance/);
  });
  test('copie de travail jamais commitée : introuvable (les octets viennent de Git, pas du disque)', () => {
    assert.equal(resoudre(ref('locale')).ok, false);
  });
  test('version trouvée mais JSON invalide : refus explicite', () => {
    assert.match(resoudre(V.casse.texte).raison, /JSON invalide/);
  });
  test('version mal formée, références absentes, nulle ou introuvable : refus', () => {
    for (const version of [undefined, null, 'sha256:abc', 'sha256:' + 'G'.repeat(64), 'SHA256:' + 'a'.repeat(64)]) {
      assert.match(RA.resoudreReferentiel({ version, refs: ['design'], racine: dir }).raison, /mal formée/);
    }
    const v = RA.versionDe(Buffer.from(V.v1.texte));
    assert.match(RA.resoudreReferentiel({ version: v, refs: [], racine: dir }).raison, /aucune référence/);
    assert.match(RA.resoudreReferentiel({ version: v, refs: ['0'.repeat(40)], racine: dir }).raison, /référence nulle/);
    assert.match(RA.resoudreReferentiel({ version: v, refs: ['inexistante'], racine: dir }).raison, /référence introuvable/);
  });
  test('historique incomplet (clone superficiel) : refus', () => {
    const vrai = M.executeurGit(dir);
    const superficiel = (args) => (args[0] === 'rev-parse' && args[1] === '--is-shallow-repository' ? Buffer.from('true\n') : vrai(args));
    assert.match(resoudre(V.v1.texte, { git: superficiel }).raison, /historique incomplet/);
  });
  test('objet illisible sur l\'historique : refus (il pourrait être la version cherchée)', () => {
    const vrai = M.executeurGit(dir);
    const illisible = (args) => { if (args[0] === 'cat-file') throw new Error('objet manquant'); return vrai(args); };
    assert.match(resoudre(V.v2.texte, { git: illisible }).raison, /illisible — refus/);
  });
  test('adaptateur du signataire : octets de la version, erreur explicite sinon', async () => {
    const f = RA.referentielArchiveGit({ refs: ['design'], racine: dir });
    assert.equal((await f(RA.versionDe(Buffer.from(V.v2.texte)))).toString('utf8'), V.v2.texte);
    await assert.rejects(f(RA.versionDe(Buffer.from(V.v3.texte))), /introuvable/);
  });
  test('références de confiance : design, plus la référence du contrôle en CI', () => {
    assert.deepEqual(RA.refsDeConfiance({}), ['design']);
    assert.deepEqual(RA.refsDeConfiance({ FONDA_REF_BASE: 'abc123' }), ['abc123', 'design']);
  });
});
