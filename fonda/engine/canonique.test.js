// Tests de fonda/engine/canonique.js — octets canoniques (CDC relecture §1, §11).
// Le cœur : les VECTEURS FIGÉS de canonique-vecteurs.json (hex UTF-8), générés par
// une voie indépendante. La copie du dépôt ET une copie « nœud Code n8n » (exécutée
// sans module, sans require, sans self, sans TextEncoder/Buffer) doivent les
// reproduire exactement. Usage : node --test fonda/engine/canonique.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const C = require('./canonique.js');
const V = require('./canonique-vecteurs.json');
const SOURCE = fs.readFileSync(path.join(__dirname, 'canonique.js'), 'utf8');

const calculer = (impl, x) => (x.contrat ? impl.hexContrat(x.contrat, x.entree) : impl.hex(x.entree, x.schema));

describe('vecteurs figés — copie du dépôt', () => {
  test('format du fichier de vecteurs', () => {
    assert.equal(V.schema, 'vecteurs-canonique-fonda/v1');
    assert.ok(V.vecteurs.length >= 20);
    assert.equal(new Set(V.vecteurs.map((x) => x.id)).size, V.vecteurs.length, 'id uniques');
  });
  for (const x of V.vecteurs) {
    test(`${x.id} — ${x.description}`, () => {
      assert.equal(calculer(C, x), x.hex);
      assert.equal(Buffer.from(x.texte, 'utf8').toString('hex'), x.hex, 'texte et hex du vecteur cohérents');
      assert.equal(x.contrat ? C.texteContrat(x.contrat, x.entree) : C.texte(x.entree, x.schema), x.texte);
    });
  }
  test('les vecteurs couvrent chaque contrat entièrement défini', () => {
    for (const nom of C.contrats()) assert.ok(V.vecteurs.some((x) => x.contrat === nom), nom);
  });
});

describe('vecteurs figés — copie « nœud Code n8n » (contexte nu)', () => {
  // Contexte vide : ni module, ni require, ni self, ni TextEncoder, ni Buffer.
  const nu = vm.runInNewContext(`${SOURCE}\n;FondaCanonique`, Object.create(null));
  test('le fichier s\'exécute tel quel sans aucune API d\'environnement', () => {
    assert.equal(typeof nu.hexContrat, 'function');
    const code = SOURCE.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n'); // hors commentaires
    assert.doesNotMatch(code, /\brequire\s*\(|TextEncoder|Buffer|crypto|process\.|globalThis/);
  });
  for (const x of V.vecteurs) {
    test(`n8n : ${x.id}`, () => assert.equal(calculer(nu, x), x.hex));
  }
  test('entrée construite dans un AUTRE contexte (objets d\'un autre realm, comme n8n) : mêmes octets', () => {
    const x = V.vecteurs.find((v) => v.id === 'coeur-nominal');
    const entreeEtrangere = vm.runInNewContext(`(${JSON.stringify(x.entree)})`);
    assert.equal(C.hexContrat(x.contrat, entreeEtrangere), x.hex);
  });
});

describe('nombres', () => {
  test('-0 normalisé en 0', () => {
    assert.equal(C.texte(-0, 'nombre'), '0');
    assert.equal(C.texte([-0, 0], { type: 'tableau', elements: 'nombre' }), '[0,0]');
  });
  test('décimaux : forme Number::toString (= JSON.stringify)', () => {
    for (const n of [0.5, -0.5, 1.5e-7, 123.456, 1 / 3, 5e-324, Number.MAX_VALUE, -1e21]) {
      assert.equal(C.texte(n, 'nombre'), JSON.stringify(n), String(n));
    }
  });
  for (const n of [Number.NaN, Infinity, -Infinity]) {
    test(`${n} refusé`, () => assert.throws(() => C.texte(n, 'nombre'), /nombre fini/));
  }
  test('chaîne numérique ou BigInt refusés là où un nombre est attendu', () => {
    assert.throws(() => C.texte('1', 'nombre'), /nombre fini/);
    assert.throws(() => C.texte(1n, 'nombre'), /nombre fini/);
  });
});

describe('chaînes : aucune normalisation Unicode', () => {
  test('« é » précomposé et décomposé donnent des octets DIFFÉRENTS (documenté, voulu)', () => {
    const a = C.hex('é', 'chaine');
    const b = C.hex('é', 'chaine');
    assert.notEqual(a, b);
    assert.equal(a, '22c3a922');
    assert.equal(b, '2265cc8122');
  });
  test('contrôles et échappements identiques à JSON.stringify', () => {
    let tous = '';
    for (let i = 0; i < 0x80; i += 1) tous += String.fromCharCode(i);
    assert.equal(C.texte(tous, 'chaine'), JSON.stringify(tous));
  });
  test('UTF-8 manuel = Buffer sur tout le BMP et des points hors BMP', () => {
    let s = '';
    for (let i = 0; i < 0xffff; i += 97) if (i < 0xd800 || i > 0xdfff) s += String.fromCharCode(i);
    s += '😀𝄞\u{10ffff}';
    assert.deepEqual(C.octets(s, 'chaine'), [...Buffer.from(JSON.stringify(s), 'utf8')]);
  });
  test('pas de BOM, pas d\'espace ni de saut de ligne ajoutés', () => {
    const x = V.vecteurs.find((v) => v.id === 'coeur-nominal');
    const t = C.texteContrat(x.contrat, x.entree);
    assert.ok(!t.startsWith('﻿') && !/[\n\r]/.test(t) && !/[,:] /.test(t));
    assert.notEqual(C.octets('', 'chaine')[0], 0xef);
  });
});

describe('champs : tous présents, aucun inconnu, types stricts (refus explicite)', () => {
  const base = () => JSON.parse(JSON.stringify(V.vecteurs.find((v) => v.id === 'coeur-nominal').entree));
  const N = 'coeur-decision-fonda/v1';
  test('champ manquant', () => {
    const c = base(); delete c.ecartees;
    assert.throws(() => C.hexContrat(N, c), /ecartees : champ manquant/);
  });
  test('champ manquant imbriqué', () => {
    const c = base(); delete c.moteur.sha256;
    assert.throws(() => C.hexContrat(N, c), /moteur\.sha256 : champ manquant/);
  });
  test('champ inconnu (racine et imbriqué)', () => {
    assert.throws(() => C.hexContrat(N, { ...base(), signature: 'x' }), /signature : champ inconnu/);
    const c = base(); c.moteur.fichier = 'x';
    assert.throws(() => C.hexContrat(N, c), /moteur\.fichier : champ inconnu/);
  });
  test('undefined n\'est pas une absence silencieuse', () => {
    assert.throws(() => C.hexContrat(N, { ...base(), action: undefined }), /chaîne attendue/);
  });
  test('types stricts : null, nombre au lieu de chaîne, objet au lieu de tableau, tableau à trous', () => {
    assert.throws(() => C.hexContrat(N, { ...base(), action: null }), /chaîne attendue/);
    assert.throws(() => C.hexContrat(N, { ...base(), empreinte_relue: 1 }), /chaîne attendue/);
    assert.throws(() => C.hexContrat(N, { ...base(), selection: { 0: 'it01' } }), /tableau attendu/);
    // eslint-disable-next-line no-sparse-arrays
    assert.throws(() => C.hexContrat(N, { ...base(), selection: ['it01', , 'it03'] }), /trou/);
    assert.throws(() => C.hexContrat(N, null), /objet attendu/);
    assert.throws(() => C.hexContrat(N, ['x']), /objet attendu/);
  });
  test('booléen strict', () => {
    assert.throws(() => C.texte(1, 'booleen'), /booléen attendu/);
  });
  test('schéma invalide refusé', () => {
    assert.throws(() => C.texte('x', 'inconnu'), /schéma invalide/);
  });
});

describe('contrats à forme incomplète : refus (fail-closed)', () => {
  for (const nom of ['decision-fonda/v1', 'instantane-fonda/v1', 'attestation-cloture/v1']) {
    test(`${nom} refusé tant que ses sous-objets ne sont pas définis au CDC`, () => {
      assert.ok(C.contratsIncomplets().includes(nom));
      assert.throws(() => C.hexContrat(nom, {}), /forme incomplète/);
      assert.throws(() => C.octetsContrat(nom, {}), /forme incomplète/);
      assert.throws(() => C.texteContrat(nom, {}), /forme incomplète/);
    });
  }
  test('contrat inconnu refusé', () => {
    assert.throws(() => C.hexContrat('lot-fonda/v1', {}), /contrat inconnu/);
  });
  test('contrats entièrement définis : exactement moteur et cœur', () => {
    assert.deepEqual(C.contrats().sort(), ['coeur-decision-fonda/v1', 'moteur-fonda/v1']);
  });
});
