// Tests de fonda/engine/canonique.js — octets canoniques (CDC relecture §1, §11).
// Le cœur : le BANC PARTAGÉ canonique-vecteurs.json (cas positifs à hex figé,
// générés par une voie indépendante, et cas de refus), rejoué À L'IDENTIQUE par
// chaque copie : celle du dépôt et une copie exécutée en contexte nu (comme un nœud
// Code n8n : sans module, require, self, TextEncoder ni Buffer). Les vecteurs
// détectent les divergences couvertes par leurs cas — pas toutes.
// Usage : node --test fonda/engine/canonique.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const V = require('./canonique-vecteurs.json');
const SOURCE = fs.readFileSync(path.join(__dirname, 'canonique.js'), 'utf8');
const charger = (source, contexte = Object.create(null)) => vm.runInNewContext(`${source}\n;FondaCanonique`, contexte);

const COPIES = {
  depot: require('./canonique.js'),
  'contexte nu (n8n)': charger(SOURCE),
};

const entreeDe = (x) => (x.entree_json !== undefined ? JSON.parse(x.entree_json) : x.entree);
const calculer = (impl, x) => (x.contrat ? impl.hexContrat(x.contrat, entreeDe(x)) : impl.hex(entreeDe(x), x.schema));

describe('banc partagé — format', () => {
  test('fichier de vecteurs bien formé, id uniques, positifs ET refus', () => {
    assert.equal(V.schema, 'vecteurs-canonique-fonda/v1');
    assert.equal(new Set(V.vecteurs.map((x) => x.id)).size, V.vecteurs.length);
    assert.ok(V.vecteurs.filter((x) => !x.refus).length >= 25);
    assert.ok(V.vecteurs.filter((x) => x.refus).length >= 15);
  });
  test('positifs : texte = JSON.stringify natif, hex = UTF-8 du texte (référence indépendante)', () => {
    for (const x of V.vecteurs.filter((v) => !v.refus)) {
      assert.equal(Buffer.from(x.texte, 'utf8').toString('hex'), x.hex, x.id);
    }
  });
});

for (const [nom, C] of Object.entries(COPIES)) {
  describe(`copie ${nom} — banc partagé complet`, () => {
    for (const x of V.vecteurs) {
      test(`${x.id} — ${x.description}`, () => {
        if (x.refus) assert.throws(() => calculer(C, x), /canonique :/);
        else {
          assert.equal(calculer(C, x), x.hex);
          assert.equal(x.contrat ? C.texteContrat(x.contrat, entreeDe(x)) : C.texte(entreeDe(x), x.schema), x.texte);
        }
      });
    }
    test('chaque contrat entièrement défini a au moins un vecteur positif', () => {
      for (const n of C.contrats()) assert.ok(V.vecteurs.some((x) => x.contrat === n && !x.refus), n);
    });
    test('nombres : -0 -> 0 ; décimaux = JSON.stringify ; NaN/Infinity/BigInt refusés', () => {
      assert.equal(C.texte(-0, 'nombre'), '0');
      for (const n of [0.5, -0.5, 1.5e-7, 123.456, 1 / 3, 5e-324, Number.MAX_VALUE, -1e21]) assert.equal(C.texte(n, 'nombre'), JSON.stringify(n));
      for (const n of [Number.NaN, Infinity, -Infinity, 1n]) assert.throws(() => C.texte(n, 'nombre'), /nombre fini/);
    });
    test('UTF-8 = Buffer sur un balayage du BMP et des points hors BMP', () => {
      let s = '';
      for (let i = 0; i < 0x10000; i += 1) if (i < 0xd800 || i > 0xdfff) s += String.fromCharCode(i);
      s += '😀𝄞\u{10ffff}𐀀';
      assert.deepEqual([...C.octets(s, 'chaine')], [...Buffer.from(JSON.stringify(s), 'utf8')]);
    });
  });
}

for (const [nomCopie, C] of Object.entries(COPIES)) describe(`entrées adverses (${nomCopie}) : jamais de champ ignoré, rien d'exécuté`, () => {
  const M = 'moteur-fonda/v1';
  const base = () => ({ version: 'v1', sha256: 'x' });
  test('getter refusé SANS être exécuté', () => {
    let appels = 0;
    const o = { sha256: 'x' };
    Object.defineProperty(o, 'version', { enumerable: true, get() { appels += 1; return 'v1'; } });
    assert.throws(() => C.hexContrat(M, o), /accesseur/);
    assert.equal(appels, 0);
  });
  test('symbole, propriété non énumérable : refusés', () => {
    assert.throws(() => C.hexContrat(M, { ...base(), [Symbol('s')]: 1 }), /champ inconnu/);
    const o = base();
    Object.defineProperty(o, 'cache', { value: 1, enumerable: false });
    assert.throws(() => C.hexContrat(M, o), /champ inconnu/);
    const p = { sha256: 'x' };
    Object.defineProperty(p, 'version', { value: 'v1', enumerable: false });
    assert.throws(() => C.hexContrat(M, p), /non énumérable/);
  });
  test('champ requis seulement HÉRITÉ : refusé (propriétés propres uniquement)', () => {
    assert.throws(() => C.hexContrat(M, Object.assign(Object.create({ version: 'v1' }), { sha256: 'x' })), /objet de données attendu|champ manquant/);
  });
  test('Map, Date, instance de classe — même avec Symbol.toStringTag « Object » : refusés', () => {
    const m = new Map();
    m.version = 'v1'; m.sha256 = 'x';
    Object.defineProperty(m, Symbol.toStringTag, { value: 'Object' });
    class K { constructor() { this.version = 'v1'; this.sha256 = 'x'; } }
    for (const v of [m, new Date(0), new K()]) assert.throws(() => C.hexContrat(M, v), /objet de données attendu/);
  });
  test('tableau avec propriété supplémentaire ou trou : refusé', () => {
    const c = JSON.parse(JSON.stringify(V.vecteurs.find((x) => x.id === 'coeur-nominal').entree));
    c.selection.secret = 'x';
    assert.throws(() => C.hexContrat('coeur-decision-fonda/v1', c), /tableau/);
    // eslint-disable-next-line no-sparse-arrays
    assert.throws(() => C.texte(['a', , 'c'], { type: 'tableau', elements: 'chaine' }), /trou|tableau/);
  });
  test('admis : objet à prototype nul et objet d\'un autre contexte JS (données ordinaires)', () => {
    const nul = Object.assign(Object.create(null), base());
    const etranger = vm.runInNewContext('({ version: "v1", sha256: "x" })');
    assert.equal(C.texteContrat(M, nul), '{"version":"v1","sha256":"x"}');
    assert.equal(C.texteContrat(M, etranger), '{"version":"v1","sha256":"x"}');
  });
  test('Proxy : valeurs lues une seule fois par descripteur ; sortie calculée sur la copie', () => {
    let lectures = 0;
    const p = new Proxy(base(), { getOwnPropertyDescriptor(t, k) { lectures += 1; return Reflect.getOwnPropertyDescriptor(t, k); } });
    assert.equal(C.texteContrat(M, p), '{"version":"v1","sha256":"x"}');
    assert.equal(lectures, 2);
  });
});

for (const [nomCopie, C] of Object.entries(COPIES)) describe(`schémas génériques adverses (${nomCopie}) : copie validée, seule utilisée`, () => {
  test('getter dans un schéma : refusé, jamais lu deux fois', () => {
    let lectures = 0;
    const schema = { type: 'tableau', get elements() { lectures += 1; return lectures === 1 ? 'chaine' : 'nombre'; } };
    assert.throws(() => C.texte([42], schema), /schéma invalide/);
    assert.equal(lectures, 0);
  });
  test('propriété cachée ou héritée dans un schéma : refusée', () => {
    const cache = { type: 'tableau', elements: 'chaine' };
    Object.defineProperty(cache, 'x', { value: 1, enumerable: false });
    assert.throws(() => C.texte([], cache), /schéma invalide/);
    const herite = Object.assign(Object.create({ type: 'tableau', elements: 'chaine' }), { a: 1, b: 2 });
    assert.throws(() => C.texte([], herite), /schéma invalide/);
    assert.throws(() => C.texte({}, { type: 'objet', champs: [['a', 'chaine', 'extra']] }), /schéma invalide/);
  });
  test('tableaux du schéma : paire non énumérable, de longueur ≠ 2 ou à trou : refusée', () => {
    const paire = () => ['a', 'chaine'];
    const cas = [];
    const p1 = paire(); p1.length = 3; cas.push([p1]); // trou final
    const p2 = paire(); Object.defineProperty(p2, '0', { enumerable: false }); cas.push([p2]);
    const p3 = paire(); Object.defineProperty(p3, '1', { enumerable: false }); cas.push([p3]);
    const champs = [paire()]; Object.defineProperty(champs, '0', { enumerable: false }); cas.push(champs);
    for (const c of cas) assert.throws(() => C.texte({ a: 'x' }, { type: 'objet', champs: c }), /schéma invalide/);
  });
});

for (const [nomCopie, C] of Object.entries(COPIES)) describe(`frontière d'entrée (${nomCopie}) : données JSON ordinaires`, () => {
  const M = 'moteur-fonda/v1';
  test('prototype personnalisé (même à parent nul) : refusé', () => {
    const proto = Object.create(null);
    assert.throws(() => C.hexContrat(M, Object.assign(Object.create(proto), { version: 'v1', sha256: 'x' })), /objet de données attendu/);
  });
  test('Map ramenée à prototype nul (emplacements internes) : refusée', () => {
    const m = new Map([['secret', 42]]);
    Object.setPrototypeOf(m, null);
    m.version = 'v1'; m.sha256 = 'x';
    assert.throws(() => C.hexContrat(M, m), /objet de données attendu/);
    const d = new Date(0);
    Object.setPrototypeOf(d, null);
    assert.throws(() => C.hexContrat(M, Object.assign(d, { version: 'v1', sha256: 'x' })), /objet de données attendu/);
  });
  test('tableaux : 40 000 éléments sérialisés à l\'identique (contrôle linéaire à la lecture du code ; aucune assertion de durée)', () => {
    const t = Array.from({ length: 40000 }, (_, i) => `it${i}`);
    assert.equal(C.texte(t, { type: 'tableau', elements: 'chaine' }), JSON.stringify(t));
  });
});

// --- Étape 4.0 : null, « chaîne ou nombre », contrats acceptés / refusés ------------
for (const [nomCopie, C] of Object.entries(COPIES)) describe(`étape 4.0 (${nomCopie}) : nullable, chaîne ou nombre, contrats`, () => {
  const N = { type: 'objet', champs: [['a', { type: 'nullable', de: 'chaine' }]] };
  test('nullable : null explicite accepté ; absence et undefined refusés (jamais assimilés à null)', () => {
    assert.equal(C.texte({ a: null }, N), '{"a":null}');
    assert.equal(C.texte({ a: 'x' }, N), '{"a":"x"}');
    assert.throws(() => C.texte({}, N), /champ manquant/);
    assert.throws(() => C.texte({ a: undefined }, N), /chaîne attendue/);
    assert.throws(() => C.texte({ a: 1 }, N), /chaîne attendue/);
  });
  test('chaîne ou nombre : types conservés (4 ≠ « 4 »), -0 -> 0, booléen/null/NaN refusés', () => {
    const T = { type: 'tableau', elements: 'chaine_ou_nombre' };
    assert.equal(C.texte([4, '4', -0, 0.5], T), '[4,"4",0,0.5]');
    for (const v of [true, null, Number.NaN, Infinity, {}]) assert.throws(() => C.texte([v], T), /chaîne ou nombre/);
  });
  test('schéma nullable : clés exactes, pas d\'imbrication', () => {
    assert.throws(() => C.texte(null, { type: 'nullable' }), /schéma invalide/);
    assert.throws(() => C.texte(null, { type: 'nullable', de: { type: 'nullable', de: 'chaine' } }), /nullable imbriqué/);
    assert.throws(() => C.texte(null, { type: 'nullable', de: 'inconnu' }), /schéma invalide/);
  });
  test('contrats acceptés : moteur, cœur, récapitulatif, charge signée ; decision et instantané REFUSÉS (lot_relu non défini)', () => {
    assert.deepEqual([...C.contrats()].sort(), ['attestation-cloture/v1', 'coeur-decision-fonda/v1', 'moteur-fonda/v1', 'recapitulatif-fonda/v1']);
    assert.deepEqual([...C.contratsIncomplets()].sort(), ['decision-fonda/v1', 'instantane-fonda/v1']);
    for (const n of ['decision-fonda/v1', 'instantane-fonda/v1']) assert.throws(() => C.hexContrat(n, {}), /forme incomplète/);
  });
  test('charge : jamais de champ signature ; ordre de sortie = ordre du §11 quel que soit l\'ordre reçu', () => {
    const x = V.vecteurs.find((v) => v.id === 'attestation-auto-nominale');
    const inverse = Object.fromEntries(Object.entries(x.entree).reverse());
    assert.equal(C.hexContrat('attestation-cloture/v1', inverse), x.hex);
    assert.throws(() => C.hexContrat('attestation-cloture/v1', { ...x.entree, signature: 's' }), /signature : champ inconnu/);
    const cles = Object.keys(JSON.parse(C.texteContrat('attestation-cloture/v1', x.entree)));
    assert.deepEqual(cles, ['schema', 'set_id', 'notion_id', 'palier', 'coeur', 'sha256_instantane', 'code_confirmation', 'confirmation',
      'fidelite_transmission', 'relecteur_attribue', 'relecteur_egal_cloturer', 'provenances', 'nb_fichiers_decision', 'referentiel_version',
      'moteur', 'execution_cloture', 'revoque_le', 'levees', 'incidents_connus', 'cloture_le', 'badge', 'cle_id']);
  });
});

// `undefined` n'existe pas en JSON : le banc partagé ne peut pas l'exprimer. Ce
// contrôle est donc vérifié ici, directement, sur la copie et sur un mutant.
test('mutation hors banc : nullable acceptant undefined — détectée par le test direct', () => {
  const N = { type: 'objet', champs: [['a', { type: 'nullable', de: 'chaine' }]] };
  const mutant = SOURCE.replace('return valeur === null ? null : copier(valeur, schema.de, chemin);', 'return valeur == null ? null : copier(valeur, schema.de, chemin);');
  assert.notEqual(mutant, SOURCE);
  assert.equal(charger(mutant).texte({ a: undefined }, N), '{"a":null}', 'le mutant accepte');
  for (const C of Object.values(COPIES)) assert.throws(() => C.texte({ a: undefined }, N), /chaîne attendue/);
});

describe('portabilité : export final et absence d\'API d\'environnement', () => {
  test('aucune API d\'environnement dans le code (hors commentaires)', () => {
    const code = SOURCE.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    assert.doesNotMatch(code, /\brequire\s*\(|TextEncoder|Buffer|crypto|process\.|globalThis/);
  });
  test('contextes variés : self nul, self objet, module sans exports — chargement sans erreur', () => {
    for (const ctx of [{ self: null }, { self: {} }, { module: {} }, { module: null }, { module: { exports: {} } }]) {
      const C = charger(SOURCE, ctx);
      assert.equal(C.texteContrat('moteur-fonda/v1', { version: 'v1', sha256: 'x' }), '{"version":"v1","sha256":"x"}');
    }
    const s = {};
    charger(SOURCE, { self: s });
    assert.equal(typeof s.FondaCanonique.hexContrat, 'function');
  });
});

// Mutations de recopie : le banc partagé doit détecter une copie dérivée.
describe('mutations de copie détectées par le banc partagé', () => {
  const mutations = [
    ['seuil UTF-8 0x800 -> 0x1000', (s) => s.replace('c < 0x800', 'c < 0x1000')],
    ['contrôle des champs inconnus supprimé', (s) => s.replace("if (typeof cle !== 'string' || connus[cle] !== true) {", 'if (false) {')],
    ['contrôle des nombres finis supprimé', (s) => s.replace("if (typeof valeur !== 'number' || !isFinite(valeur))", 'if (false)')],
    ['ordre des champs inversé', (s) => s.replace('for (var j = 0; j < schema.champs.length; j += 1) {', 'for (var j = schema.champs.length - 1; j >= 0; j -= 1) {')],
    ['noms de champ interdits non vérifiés', (s) => s.replace("if (CLE_ENTIERE.test(nom) || nom === '__proto__')", 'if (false)')],
    ['champs en double non vérifiés', (s) => s.replace('if (vus[nom]) throw', 'if (false) throw')],
    ['chaîne ou nombre : booléen accepté', (s) => s.replace("throw erreur(chemin, 'chaîne ou nombre fini attendu');", 'return valeur;')],
    ['nullable imbriqué non refusé', (s) => s.replace("if (de && de.type === 'nullable') throw", 'if (false) throw')],
    ['tableaux triés (tri par défaut : chaînes par unité de code)', (s) => s.replace('      return sortie;\n    }\n    // objet', '      return sortie.sort();\n    }\n    // objet')],
    ['tableaux triés numériquement quand c\'est possible', (s) => s.replace('      return sortie;\n    }\n    // objet', '      return sortie.sort(function (x, y) { return (+x.execution_id || 0) - (+y.execution_id || 0) || 0; });\n    }\n    // objet')],
    ['charge : ordre de deux champs inversé', (s) => s.replace("['relecteur_attribue', 'chaine'], ['relecteur_egal_cloturer', 'booleen'],", "['relecteur_egal_cloturer', 'booleen'], ['relecteur_attribue', 'chaine'],")],
  ];
  for (const [nom, muter] of mutations) {
    test(nom, () => {
      const mutant = muter(SOURCE);
      assert.notEqual(mutant, SOURCE, 'point de mutation introuvable');
      const C = charger(mutant);
      // Même exigence que le banc normal : un refus doit être une erreur « canonique : ».
      const echecs = V.vecteurs.filter((x) => {
        try { const h = calculer(C, x); return x.refus || h !== x.hex; } catch (e) { return !x.refus || !/canonique :/.test(e.message); }
      });
      assert.ok(echecs.length > 0, 'le banc partagé n\'a rien détecté');
    });
  }
});
