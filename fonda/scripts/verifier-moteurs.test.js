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
  test('registre modifié sur la chaîne du premier parent (puis rétabli) : détecté', () => {
    const { dir } = depot();
    const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
    const reg = path.join(dir, 'fonda/engine/moteurs.json');
    const original = fs.readFileSync(reg, 'utf8');
    fs.writeFileSync(reg, JSON.stringify([{ ...ligneV1, sri: 'autre' }]));
    g('commit', '-q', '-am', 'registre modifié');
    fs.writeFileSync(reg, original);
    g('commit', '-q', '-am', 'registre rétabli');
    const ref = g('rev-parse', 'HEAD').toString().trim();
    assert.match(V.verifierHistorique([ref], [ligneV1], octets({ 'fonda/engine/moteur-correction-v1.js': 'v1' }), dir).join(), /ajout seul/);
  });
  test('registre historique JSON invalide ou de structure invalide : échec', () => {
    for (const contenu of ['[ pas du json', JSON.stringify({ v1: 1 })]) {
      const { dir } = depot();
      const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
      fs.writeFileSync(path.join(dir, 'fonda/engine/moteurs.json'), contenu);
      g('commit', '-q', '-am', 'abime');
      const ref = g('rev-parse', 'HEAD').toString().trim();
      assert.match(V.verifierHistorique([ref], [ligneV1], octets({ 'fonda/engine/moteur-correction-v1.js': 'v1' }), dir).join(), /illisible|structure invalide/, contenu);
    }
  });
  // Incident du 2026-10-14 (run 38471882811) : une PR révise le moteur v1 en cours de
  // route (plusieurs empreintes intermédiaires) puis est fusionnée par commit de merge.
  // Seul l'état fusionné est publié : les brouillons de la PR ne comptent pas.
  function depotSansMoteur() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moteurs-'));
    const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
    g('init', '-q', '-b', 'design'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
    fs.writeFileSync(path.join(dir, 'README'), 'x');
    g('add', '.'); g('commit', '-q', '-m', 'base');
    return { dir, g };
  }
  function prRevisantLeMoteur(g, dir) {
    g('checkout', '-q', '-b', 'pr');
    fs.mkdirSync(path.join(dir, 'fonda', 'engine'), { recursive: true });
    for (const version of ['brouillon 1', 'brouillon 2', 'v1']) {
      fs.writeFileSync(path.join(dir, 'fonda/engine/moteur-correction-v1.js'), version);
      fs.writeFileSync(path.join(dir, 'fonda/engine/moteurs.json'), JSON.stringify([{ ...ligneV1, sha256: version }]));
      g('add', '.'); g('commit', '-q', '-m', version);
    }
    g('checkout', '-q', 'design');
    g('merge', '-q', '--no-ff', '-m', 'Merge pull request', 'pr');
    return g('rev-parse', 'HEAD').toString().trim();
  }

  test('PR qui révise le moteur en cours de route (brouillons) puis merge : accepté (premier parent)', () => {
    const { dir, g } = depotSansMoteur();
    const base = g('rev-parse', 'HEAD').toString().trim();
    const merge = prRevisantLeMoteur(g, dir);
    const final = [{ ...ligneV1, sha256: 'v1' }];
    // Au push après merge : référence = ancien sommet, design = merge.
    assert.deepEqual(V.verifierHistorique([base, merge], final, octets({ 'fonda/engine/moteur-correction-v1.js': 'v1' }), dir), []);
  });

  test('moteur modifié APRÈS publication, sur la chaîne du premier parent : refusé', () => {
    const { dir, g } = depotSansMoteur();
    prRevisantLeMoteur(g, dir);
    fs.writeFileSync(path.join(dir, 'fonda/engine/moteur-correction-v1.js'), 'v1 retouché');
    g('commit', '-q', '-am', 'retouche du moteur publié');
    const ref = g('rev-parse', 'HEAD').toString().trim();
    const final = [{ ...ligneV1, sha256: 'v1' }];
    assert.match(V.verifierHistorique([ref], final, octets({ 'fonda/engine/moteur-correction-v1.js': 'v1 retouché' }), dir).join(), /modifié/);
    assert.match(V.verifierHistorique([ref], final, octets({ 'fonda/engine/moteur-correction-v1.js': 'v1' }), dir).join(), /modifié/);
  });

  test('moteur publié retouché dans une PR puis mergé : refusé (le merge est sur le premier parent)', () => {
    const { dir, g } = depotSansMoteur();
    prRevisantLeMoteur(g, dir);
    g('checkout', '-q', '-b', 'pr2');
    fs.writeFileSync(path.join(dir, 'fonda/engine/moteur-correction-v1.js'), 'v1 retouché');
    g('commit', '-q', '-am', 'retouche');
    g('checkout', '-q', 'design');
    g('merge', '-q', '--no-ff', '-m', 'Merge pr2', 'pr2');
    const ref = g('rev-parse', 'HEAD').toString().trim();
    assert.match(V.verifierHistorique([ref], [{ ...ligneV1, sha256: 'v1' }], octets({ 'fonda/engine/moteur-correction-v1.js': 'v1 retouché' }), dir).join(), /modifié/);
  });

  test('référence nulle, absente ou introuvable : échec explicite', () => {
    const { dir } = depot();
    const lire = octets({});
    assert.match(V.verifierHistorique(['0'.repeat(40)], [], lire, dir).join(), /nulle/);
    assert.match(V.verifierHistorique([undefined], [], lire, dir).join(), /nulle/);
    assert.match(V.verifierHistorique(['deadbeef'], [], lire, dir).join(), /introuvable/);
  });
});

describe('règle 0 de M1 — consommable une seule fois (CDC annexe B)', () => {
  const SHA_V1 = 'a'.repeat(64);
  const REG = [{ version: 'v1', fichier: 'fonda/engine/moteur-correction-v1.js', sha256: SHA_V1, sri: 'x' }];
  const HIST = { set_a: 'sha256:aa', set_b: 'sha256:bb' };
  const entree = (set_id, empreinte, moteur) => ({ set_id, empreinte, ...(moteur ? { moteur } : {}) });
  const M1 = { version: 'v1', sha256: SHA_V1 };

  // Dépôt temporaire dont l'historique contient les catalogues successifs donnés.
  function historique(catalogues) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'regle0-'));
    const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
    g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
    fs.mkdirSync(path.join(dir, 'fonda', 'data'), { recursive: true });
    catalogues.forEach((cat, i) => {
      fs.writeFileSync(path.join(dir, 'fonda/data/catalogue-fonda.json'), JSON.stringify(cat));
      g('add', '.'); g('commit', '-q', '-m', `c${i}`);
    });
    return { dir, ref: g('rev-parse', 'HEAD').toString().trim() };
  }
  const sansMoteur = { lots: [entree('set_a', 'sha256:aa'), entree('set_b', 'sha256:bb')] };
  const avecM1 = { lots: [entree('set_a', 'sha256:aa', M1), entree('set_b', 'sha256:bb', M1)] };

  test('aucun moteur dans l\'historique : M1 sur les lots historiques, empreintes figées, v1 -> accepté', () => {
    const { dir, ref } = historique([sansMoteur]);
    assert.deepEqual(V.verifierRegle0([ref], avecM1, REG, HIST, dir), []);
  });
  test('aucun moteur dans l\'historique : lot hors historiques, empreinte modifiée ou autre moteur -> refusé', () => {
    const { dir, ref } = historique([sansMoteur]);
    assert.match(V.verifierRegle0([ref], { lots: [...avecM1.lots, entree('set_c', 'sha256:cc', M1)] }, REG, HIST, dir).join(), /seuls les 8 lots historiques/);
    assert.match(V.verifierRegle0([ref], { lots: [entree('set_a', 'sha256:zz', M1)] }, REG, HIST, dir).join(), /empreinte figée/);
    assert.match(V.verifierRegle0([ref], { lots: [entree('set_a', 'sha256:aa', { version: 'v2', sha256: SHA_V1 })] }, REG, HIST, dir).join(), /moteur v1/);
    assert.match(V.verifierRegle0([ref], { lots: [entree('set_a', 'sha256:aa', { version: 'v1', sha256: 'b'.repeat(64) })] }, REG, HIST, dir).join(), /moteur v1/);
  });
  test('M1 déjà publiée : tuple identique accepté (transit design -> main)', () => {
    const { dir, ref } = historique([sansMoteur, avecM1]);
    assert.deepEqual(V.verifierRegle0([ref], avecM1, REG, HIST, dir), []);
  });
  test('M1 déjà publiée : moteur ou empreinte changés -> refusé (M1 non rejouable)', () => {
    const { dir, ref } = historique([sansMoteur, avecM1]);
    const autre = { lots: [entree('set_a', 'sha256:aa', { version: 'v1', sha256: 'b'.repeat(64) }), avecM1.lots[1]] };
    assert.match(V.verifierRegle0([ref], autre, REG, HIST, dir).join(), /tuple/);
  });
  test('catalogue vidé APRÈS M1 : la règle 0 ne se réarme pas (rejeu avec un autre moteur refusé)', () => {
    const { dir, ref } = historique([sansMoteur, avecM1, { lots: [] }]);
    const rejeu = { lots: [entree('set_a', 'sha256:aa', { version: 'v1', sha256: 'c'.repeat(64) })] };
    assert.match(V.verifierRegle0([ref], rejeu, [{ ...REG[0], sha256: 'c'.repeat(64) }], HIST, dir).join(), /tuple/);
  });
  test('M1 consommée : set_id jamais publié avec moteur -> refusé (fail-closed jusqu\'à l\'étape 3)', () => {
    const { dir, ref } = historique([sansMoteur, avecM1]);
    assert.match(V.verifierRegle0([ref], { lots: [...avecM1.lots, entree('set_c', 'sha256:cc', M1)] }, REG, HIST, dir).join(), /jamais publié/);
  });
  test('M1 publiée puis fusion reprenant un ancien catalogue SANS moteur : M1 reste consommée', () => {
    const { dir } = historique([sansMoteur, avecM1]); // M1 sur la chaîne du premier parent
    const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
    const m1 = g('rev-parse', 'HEAD').toString().trim();
    g('checkout', '-q', '-b', 'ancien', 'HEAD~1');
    fs.writeFileSync(path.join(dir, 'autre.txt'), 'x'); g('add', '.'); g('commit', '-q', '-m', 'ancien');
    g('checkout', '-q', '-'); // retour sur la branche principale (sommet = M1)
    assert.equal(g('rev-parse', 'HEAD').toString().trim(), m1);
    g('merge', '-q', '--no-ff', '--no-commit', 'ancien');
    fs.writeFileSync(path.join(dir, 'fonda/data/catalogue-fonda.json'), JSON.stringify(sansMoteur)); // reprend l'ancien catalogue
    g('add', '.'); g('commit', '-q', '-m', 'fusion reprenant l\'ancien catalogue');
    const ref = g('rev-parse', 'HEAD').toString().trim();
    const regC = [{ ...REG[0], sha256: 'c'.repeat(64) }];
    const rejeu = { lots: [entree('set_a', 'sha256:aa', { version: 'v1', sha256: 'c'.repeat(64) })] };
    assert.match(V.verifierRegle0([ref], rejeu, regC, HIST, dir).join(), /tuple/);
  });
  test('M1 seulement sur une branche de PR jamais fusionnée telle quelle : brouillons ignorés, M1 finale acceptée', () => {
    const { dir } = historique([sansMoteur]);
    const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
    const base = g('rev-parse', 'HEAD').toString().trim();
    g('checkout', '-q', '-b', 'pr');
    const brouillon = { lots: [entree('set_a', 'sha256:aa', { version: 'v1', sha256: 'b'.repeat(64) }), entree('set_b', 'sha256:bb', { version: 'v1', sha256: 'b'.repeat(64) })] };
    fs.writeFileSync(path.join(dir, 'fonda/data/catalogue-fonda.json'), JSON.stringify(brouillon)); g('commit', '-q', '-am', 'M1 brouillon');
    fs.writeFileSync(path.join(dir, 'fonda/data/catalogue-fonda.json'), JSON.stringify(avecM1)); g('commit', '-q', '-am', 'M1 finale');
    g('checkout', '-q', '-');
    g('merge', '-q', '--no-ff', '-m', 'Merge pull request', 'pr');
    const merge = g('rev-parse', 'HEAD').toString().trim();
    assert.deepEqual(V.verifierRegle0([base, merge], avecM1, REG, HIST, dir), []);
  });
  test('catalogue historique illisible (JSON invalide) ou de structure invalide : échec, jamais assimilé à une absence', () => {
    for (const contenu of ['{ pas du json', JSON.stringify({ lots: 3 }), 'null']) {
      const { dir } = historique([sansMoteur]);
      const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
      fs.writeFileSync(path.join(dir, 'fonda/data/catalogue-fonda.json'), contenu);
      g('commit', '-q', '-am', 'abime');
      const ref = g('rev-parse', 'HEAD').toString().trim();
      assert.match(V.verifierRegle0([ref], avecM1, REG, HIST, dir).join(), /illisible|structure invalide/, contenu);
    }
  });
  test('référence nulle ou introuvable -> échec explicite', () => {
    const { dir } = historique([sansMoteur]);
    assert.match(V.verifierRegle0(['0'.repeat(40)], avecM1, REG, HIST, dir).join(), /nulle/);
    assert.match(V.verifierRegle0(['deadbeef'], avecM1, REG, HIST, dir).join(), /introuvable/);
  });
});

// --- Continuité du premier parent, modes d'intégration, fail-closed ---------------
// Contrat : intégration par merge commit ou squash ; le filet DÉTECTE une violation
// (échec), la protection de branche l'EMPÊCHE.
describe('continuité et modes d\'intégration (CDC annexe B, contrat premier parent)', () => {
  const ligne = (contenu) => ({ version: 'v1', fichier: 'fonda/engine/moteur-correction-v1.js', sha256: contenu, sri: 'x' });
  function depotDesign() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'continuite-'));
    const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    g('init', '-q', '-b', 'design'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
    fs.mkdirSync(path.join(dir, 'fonda', 'engine'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'fonda', 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'README'), 'x');
    g('add', '.'); g('commit', '-q', '-m', 'base');
    return { dir, g };
  }
  const ecrire = (dir, rel, contenu) => fs.writeFileSync(path.join(dir, rel), contenu);
  function brouillonsSurPr(dir, g) {
    g('checkout', '-q', '-b', 'pr');
    for (const v of ['brouillon 1', 'v1']) {
      ecrire(dir, 'fonda/engine/moteur-correction-v1.js', v);
      ecrire(dir, 'fonda/engine/moteurs.json', JSON.stringify([ligne(v)]));
      g('add', '.'); g('commit', '-q', '-m', v);
    }
    g('checkout', '-q', 'design');
  }
  const octets = (contenus) => (f) => (contenus[f] === undefined ? null : Buffer.from(contenus[f]));
  const lire = octets({ 'fonda/engine/moteur-correction-v1.js': 'v1' });

  test('merge commit normal : continuité OK, historique OK (pas de faux positif)', () => {
    const { dir, g } = depotDesign();
    const avant = g('rev-parse', 'HEAD');
    brouillonsSurPr(dir, g);
    g('merge', '-q', '--no-ff', '-m', 'Merge pull request', 'pr');
    assert.deepEqual(V.verifierContinuite(avant, 'HEAD', dir), []);
    assert.deepEqual(V.verifierHistorique([avant, 'HEAD'], [ligne('v1')], lire, dir), []);
  });

  test('squash normal : continuité OK, historique OK (pas de faux positif)', () => {
    const { dir, g } = depotDesign();
    const avant = g('rev-parse', 'HEAD');
    brouillonsSurPr(dir, g);
    g('merge', '-q', '--squash', 'pr'); g('commit', '-q', '-m', 'squash');
    assert.deepEqual(V.verifierContinuite(avant, 'HEAD', dir), []);
    assert.deepEqual(V.verifierHistorique([avant, 'HEAD'], [ligne('v1')], lire, dir), []);
  });

  test('parents inversés puis fast-forward : refus dès le PREMIER contrôle (push qui avance design)', () => {
    const { dir, g } = depotDesign();
    const avantM1 = g('rev-parse', 'HEAD');
    ecrire(dir, 'fonda/data/catalogue-fonda.json', JSON.stringify({ lots: [{ set_id: 'set_a', empreinte: 'sha256:aa', moteur: { version: 'v1', sha256: 'a'.repeat(64) } }] }));
    g('add', '.'); g('commit', '-q', '-m', 'M1');
    const P = g('rev-parse', 'HEAD');
    g('checkout', '-q', '-b', 'ancien', avantM1);
    ecrire(dir, 'autre.txt', 'x'); g('add', '.'); g('commit', '-q', '-m', 'ancien');
    g('merge', '-q', '--no-edit', '-s', 'ours', 'design'); // premier parent = ancien, second = P
    g('checkout', '-q', 'design');
    g('merge', '-q', '--ff-only', 'ancien'); // design avance par fast-forward sur M
    const M = g('rev-parse', 'HEAD');
    // 1er contrôle (push : before = P, HEAD = M) : la continuité est rompue -> échec.
    assert.match(V.verifierContinuite(P, M, dir).join(), /continuité rompue/);
    // Ce que ce filet NE fait pas : au contrôle suivant (base = design = M), P est
    // hors chaîne et la règle 0 se réarmerait — d'où l'échec au 1er contrôle ET la
    // protection de branche (pas de push direct, pas de contournement).
    assert.deepEqual(V.verifierContinuite(M, M, dir), []);
  });

  test('rebase-merge avec brouillons du moteur sur la chaîne du premier parent : refus', () => {
    const { dir, g } = depotDesign();
    const avant = g('rev-parse', 'HEAD');
    brouillonsSurPr(dir, g);
    g('merge', '-q', '--ff-only', 'pr'); // équivalent linéaire d'un rebase-merge
    assert.deepEqual(V.verifierContinuite(avant, 'HEAD', dir), [], 'la continuité seule ne voit rien…');
    assert.match(V.verifierHistorique([avant, 'HEAD'], [ligne('v1')], lire, dir).join(), /modifié/, '…mais les brouillons publiés sont refusés');
  });

  test('clone superficiel : refus (continuité, historique, règle 0)', () => {
    const { dir, g } = depotDesign();
    ecrire(dir, 'y', '1'); g('add', '.'); g('commit', '-q', '-m', 'y');
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'superficiel-'));
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${dir}`, clone], { stdio: 'ignore' });
    const tete = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: clone }).toString().trim();
    assert.match(V.verifierContinuite(tete, 'HEAD', clone).join(), /clone superficiel/);
    assert.match(V.verifierHistorique([tete], [], lire, clone).join(), /clone superficiel/);
    assert.match(V.verifierRegle0([tete], { lots: [] }, [], {}, clone).join(), /clone superficiel/);
  });

  test('détection de clone superficiel en échec ou réponse inattendue : refus (jamais ignorée)', () => {
    const { dir, g } = depotDesign();
    const tete = g('rev-parse', 'HEAD');
    const vraiGit = execFileSync('which', ['git']).toString().trim();
    for (const [nom, action] of [['echec', 'exit 1'], ['inattendu', 'echo peut-etre; exit 0']]) {
      const bin = fs.mkdtempSync(path.join(os.tmpdir(), `git-${nom}-`));
      fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = "--is-shallow-repository" ] && { ${action}; }; done\nexec "${vraiGit}" "$@"\n`, { mode: 0o755 });
      const PATH = process.env.PATH;
      process.env.PATH = `${bin}:${PATH}`;
      try {
        for (const r of [V.verifierContinuite(tete, 'HEAD', dir), V.verifierHistorique([tete], [], () => null, dir), V.verifierRegle0([tete], { lots: [] }, [], {}, dir)]) {
          assert.match(r.join(), /historique est complet|clone superficiel/, nom);
        }
      } finally { process.env.PATH = PATH; }
    }
  });

  test('objet Git supprimé (illisible) : refus, jamais assimilé à une absence', () => {
    const { dir, g } = depotDesign();
    ecrire(dir, 'fonda/engine/moteur-correction-v1.js', 'v1');
    ecrire(dir, 'fonda/engine/moteurs.json', JSON.stringify([ligne('v1')]));
    ecrire(dir, 'fonda/data/catalogue-fonda.json', JSON.stringify({ lots: [] }));
    g('add', '.'); g('commit', '-q', '-m', 'v1');
    const supprimer = (rel) => {
      const blob = g('rev-parse', `HEAD:${rel}`);
      fs.rmSync(path.join(dir, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
    };
    supprimer('fonda/engine/moteur-correction-v1.js');
    supprimer('fonda/data/catalogue-fonda.json');
    assert.match(V.verifierHistorique(['HEAD'], [ligne('v1')], lire, dir).join(), /illisible/);
    assert.match(V.verifierRegle0(['HEAD'], { lots: [] }, [ligne('v1')], {}, dir).join(), /illisible/);
  });

  // Mutation-test PERMANENT : le même vérificateur SANS --first-parent doit échouer
  // sur le scénario de l'incident (brouillons de PR mergée) et sur les brouillons de M1.
  test('mutation : sans --first-parent, l\'incident et les brouillons de M1 sont (faussement) refusés', () => {
    const source = fs.readFileSync(path.join(__dirname, 'verifier-moteurs.js'), 'utf8');
    const mutant = source.replace("git(['rev-list', '--first-parent', ref])", "git(['rev-list', ref])");
    assert.notEqual(mutant, source, 'point de mutation introuvable');
    const fichier = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mutant-')), 'verifier-moteurs.js');
    fs.writeFileSync(fichier, mutant);
    const Mut = require(fichier);
    const { dir, g } = depotDesign();
    const avant = g('rev-parse', 'HEAD');
    brouillonsSurPr(dir, g);
    g('merge', '-q', '--no-ff', '-m', 'Merge pull request', 'pr');
    assert.deepEqual(V.verifierHistorique([avant, 'HEAD'], [ligne('v1')], lire, dir), [], 'vérificateur réel : accepté');
    assert.match(Mut.verifierHistorique([avant, 'HEAD'], [ligne('v1')], lire, dir).join(), /modifié/, 'mutant : faux refus attendu');
    // Brouillons de M1 dans une PR
    const d2 = depotDesign();
    const base2 = d2.g('rev-parse', 'HEAD');
    ecrire(d2.dir, 'fonda/data/catalogue-fonda.json', JSON.stringify({ lots: [] })); d2.g('add', '.'); d2.g('commit', '-q', '-m', 'catalogue');
    d2.g('checkout', '-q', '-b', 'pr');
    const cat = (sha) => JSON.stringify({ lots: [{ set_id: 'set_a', empreinte: 'sha256:aa', moteur: { version: 'v1', sha256: sha } }] });
    ecrire(d2.dir, 'fonda/data/catalogue-fonda.json', cat('b'.repeat(64))); d2.g('commit', '-q', '-am', 'M1 brouillon');
    ecrire(d2.dir, 'fonda/data/catalogue-fonda.json', cat('a'.repeat(64))); d2.g('commit', '-q', '-am', 'M1 finale');
    d2.g('checkout', '-q', 'design');
    d2.g('merge', '-q', '--no-ff', '-m', 'Merge', 'pr');
    const courant = JSON.parse(cat('a'.repeat(64)));
    const reg = [{ ...ligne('x'), sha256: 'a'.repeat(64) }];
    assert.deepEqual(V.verifierRegle0([base2, 'HEAD'], courant, reg, { set_a: 'sha256:aa' }, d2.dir), []);
    assert.match(Mut.verifierRegle0([base2, 'HEAD'], courant, reg, { set_a: 'sha256:aa' }, d2.dir).join(), /tuple/);
  });
});
