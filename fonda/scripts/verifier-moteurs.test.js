// Tests de fonda/scripts/verifier-moteurs.js (immuabilité des moteurs, CDC annexe B).
// Usage : node --test fonda/scripts/verifier-moteurs.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const V = require('./verifier-moteurs.js');

const REGISTRE = require('../engine/moteurs.json');
const copie = (o) => JSON.parse(JSON.stringify(o));

describe('registre courant — invariants', () => {
  test('moteurs.json conforme : sha256 = octets, sri = base64 de la même empreinte, aucun fichier hors registre', () => {
    assert.deepEqual(V.invariantsRegistre(REGISTRE, V.lireOctetsDisque, V.fichiersMoteursDisque()), []);
  });
  const cas = [
    ['sha256 faux', (r) => { r[0].sha256 = '0'.repeat(64); }],
    ['sri faux', (r) => { r[0].sri = 'sha256-AAAA'; }],
    ['version en double', (r) => { r.push(copie(r[0])); }],
    ['fichier ne correspondant pas à la version', (r) => { r[0].version = 'v7'; }],
    ['champ en trop', (r) => { r[0].note = 'x'; }],
  ];
  for (const [libelle, abimer] of cas) {
    test(`refusé : ${libelle}`, () => {
      const r = copie(REGISTRE);
      abimer(r);
      assert.notDeepEqual(V.invariantsRegistre(r, V.lireOctetsDisque, V.fichiersMoteursDisque()), []);
    });
  }
  test('fichier moteur présent mais absent du registre : refusé', () => {
    assert.match(V.invariantsRegistre([], V.lireOctetsDisque, ['fonda/engine/moteur-correction-v1.js']).join(), /absent du registre/);
  });
});

describe('historique de confiance — ajout seul, fichiers identiques', () => {
  // Dépôt temporaire : une référence où v1 est publié, puis on compare l'état courant.
  function depot() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moteurs-'));
    const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
    g('init', '-q');
    g('config', 'user.email', 't@t');
    g('config', 'user.name', 't');
    fs.mkdirSync(path.join(dir, 'fonda', 'engine'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'fonda/engine/moteur-correction-v1.js'), 'v1');
    fs.writeFileSync(path.join(dir, 'fonda/engine/moteurs.json'), JSON.stringify([{ version: 'v1', fichier: 'fonda/engine/moteur-correction-v1.js', sha256: 'a', sri: 'b' }]));
    g('add', '.');
    g('commit', '-q', '-m', 'v1');
    return { dir, ref: g('rev-parse', 'HEAD').toString().trim() };
  }
  const ligneV1 = { version: 'v1', fichier: 'fonda/engine/moteur-correction-v1.js', sha256: 'a', sri: 'b' };
  const octets = (contenus) => (f) => (contenus[f] === undefined ? null : Buffer.from(contenus[f]));

  test('état identique (+ ajout d\'une v2) : accepté', () => {
    const { dir, ref } = depot();
    const r = V.verifierHistorique([ref], [ligneV1, { version: 'v2' }], octets({ 'fonda/engine/moteur-correction-v1.js': 'v1' }), dir);
    assert.deepEqual(r, []);
  });
  test('moteur v1 modifié d\'un octet : refusé', () => {
    const { dir, ref } = depot();
    assert.match(V.verifierHistorique([ref], [ligneV1], octets({ 'fonda/engine/moteur-correction-v1.js': 'v1 ' }), dir).join(), /modifié/);
  });
  test('moteur v1 supprimé : refusé', () => {
    const { dir, ref } = depot();
    assert.match(V.verifierHistorique([ref], [ligneV1], octets({}), dir).join(), /supprimé/);
  });
  test('ligne du registre modifiée ou retirée : refusé', () => {
    const { dir, ref } = depot();
    const lire = octets({ 'fonda/engine/moteur-correction-v1.js': 'v1' });
    assert.match(V.verifierHistorique([ref], [{ ...ligneV1, sha256: 'c' }], lire, dir).join(), /ajout seul/);
    assert.match(V.verifierHistorique([ref], [], lire, dir).join(), /ajout seul/);
  });
  test('référence nulle, absente ou introuvable : échec explicite', () => {
    const { dir } = depot();
    const lire = octets({});
    assert.match(V.verifierHistorique(['0'.repeat(40)], [], lire, dir).join(), /nulle/);
    assert.match(V.verifierHistorique([undefined], [], lire, dir).join(), /nulle/);
    assert.match(V.verifierHistorique(['deadbeef'], [], lire, dir).join(), /introuvable/);
  });
});
