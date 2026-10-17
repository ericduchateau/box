// Tests des outils d'audit du banc canonique : reconstruction indépendante des
// vecteurs brique 1 et rejeu durci des mutations. Ni canonique.js ni les vecteurs ne
// sont modifiés : tout se passe en mémoire.
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const RACINE = path.join(__dirname, '..', '..');
const SOURCE = fs.readFileSync(path.join(RACINE, 'fonda/engine/canonique.js'), 'utf8');
const VECTEURS = JSON.parse(fs.readFileSync(path.join(RACINE, 'fonda/engine/canonique-vecteurs.json'), 'utf8')).vecteurs;
const SHA_V1 = JSON.parse(fs.readFileSync(path.join(RACINE, 'fonda/engine/moteurs.json'), 'utf8'))[0].sha256;
const AUDIT = path.join(__dirname, 'vecteurs-canonique-brique1.js');
const REJEU = path.join(__dirname, 'rejouer-mutations-canonique.js');
const A = require(AUDIT);
const R = require(REJEU);
const copie = () => JSON.parse(JSON.stringify(VECTEURS));

describe('audit des vecteurs brique 1 (reconstruction sans canonique.js)', () => {
  test('les 43 vecteurs figés sont reconstruits à l\'identique', () => {
    assert.equal(VECTEURS.length - A.NB_V82, 43);
    assert.deepEqual(A.auditer(VECTEURS, SHA_V1), []);
  });
  test('indépendance : l\'outil ne charge pas canonique.js (ni à la lecture du code, ni à l\'exécution)', () => {
    const code = fs.readFileSync(AUDIT, 'utf8').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    assert.doesNotMatch(code, /require\([^)]*canonique[^)-]*\)|FondaCanonique|\bvm\b|readFileSync\([^)]*canonique\.js/);
    // Exécution réelle (require + auditer) avec journal de TOUS les chargements de modules.
    const script = [
      "const Module = require('module'); const vus = []; const orig = Module._load;",
      "Module._load = function (req, ...r) { vus.push(req); return orig.call(this, req, ...r); };",
      `const A = require(${JSON.stringify(AUDIT)});`,
      `const V = JSON.parse(require('fs').readFileSync(${JSON.stringify(path.join(RACINE, 'fonda/engine/canonique-vecteurs.json'))}, 'utf8')).vecteurs;`,
      `const e = A.auditer(V, ${JSON.stringify(SHA_V1)}); if (e.length) throw new Error('écarts');`,
      "process.stdout.write(JSON.stringify(vus.concat(Object.keys(require.cache))));",
    ].join('\n');
    const charges = JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }));
    assert.ok(charges.length > 0);
    for (const c of charges) assert.doesNotMatch(c, /canonique(\.js)?$|^(node:)?vm$/, c);
  });
  test('détecte un attendu altéré, un vecteur retiré et un vecteur ajouté', () => {
    const v = copie(); v[A.NB_V82].hex = v[A.NB_V82].hex.replace(/^7b/, '7c');
    assert.match(A.auditer(v, SHA_V1).join('\n'), /generation-nominale/);
    assert.notDeepEqual(A.auditer(copie().slice(0, -1), SHA_V1), []);
    assert.notDeepEqual(A.auditer([...copie(), { id: 'en-trop' }], SHA_V1), []);
  });
  test('ligne de commande : sortie 0 sur le fichier figé', () => {
    assert.equal(spawnSync(process.execPath, [AUDIT]).status, 0);
  });
});

describe('rejeu durci des mutations', () => {
  test('défaut (nullables) : toutes détectées, outil valide', () => {
    const r = R.rejouer({ source: SOURCE, vecteurs: VECTEURS });
    assert.deepEqual(r.invalide, []);
    assert.deepEqual(r.survivantes, []);
    assert.ok(r.total >= 90, `${r.total} mutations`);
  });
  test('code non muté en échec sur le banc -> outil INVALIDE', () => {
    const v = copie(); const x = v.find((y) => !y.refus); x.hex = '00';
    assert.match(R.rejouer({ source: SOURCE, vecteurs: v }).invalide.join('\n'), /code non muté/);
  });
  test('découverte tolérante aux espaces : « nul ( » et « ,  nul » restent découverts (90 mutations)', () => {
    const s = SOURCE.replace("['matiere', nul('chaine')]", "[ 'matiere' ,  nul ( 'chaine' ) ]");
    assert.notEqual(s, SOURCE);
    const r = R.rejouer({ source: s, vecteurs: VECTEURS });
    assert.deepEqual(r.invalide, []);
    assert.equal(r.total, R.rejouer({ source: SOURCE, vecteurs: VECTEURS }).total);
  });
  test('appel nul() hors champ découvrable -> outil INVALIDE (découverte incomplète)', () => {
    const s = SOURCE.replace("['matiere', nul('chaine')]", "['matiere', tableau(nul('chaine'))]");
    assert.notEqual(s, SOURCE);
    assert.match(R.rejouer({ source: s, vecteurs: VECTEURS }).invalide.join('\n'), /découverte incomplète/);
  });
  test('complétude sémantique : 28 chemins nullables atteignables, tous couverts', () => {
    const r = R.rejouer({ source: SOURCE, vecteurs: VECTEURS });
    assert.equal(r.chemins, 28);
    assert.deepEqual(r.invalide, []);
  });
  test('commentaires (ligne et bloc indépendant) : exemples ni découverts ni comptés', () => {
    const s = SOURCE.replace('var CONTRATS = {', "// exemple : ['x', nul('chaine')]\n  /* ['y', nul(Z)] */\n  var CONTRATS = {");
    assert.notEqual(s, SOURCE);
    const r = R.rejouer({ source: s, vecteurs: VECTEURS });
    assert.deepEqual(r.invalide, []);
    assert.equal(r.total, R.rejouer({ source: SOURCE, vecteurs: VECTEURS }).total);
  });
  test('scanner trompé (expression régulière, gabarit) : un champ réel masqué -> outil INVALIDE', () => {
    for (const masque of ["['matiere', /[/*]/ && nul('chaine')]", "['matiere', `${'/*'}` && nul('chaine')]"]) {
      const s = SOURCE.replace("['matiere', nul('chaine')]", masque);
      assert.notEqual(s, SOURCE);
      assert.match(R.rejouer({ source: s, vecteurs: VECTEURS }).invalide.join('\n'), /chemin nullable non couvert lot-complet-fonda\/v1\.matiere/, masque);
    }
  });
  test('appel nul() orphelin (hors contrat, même masqué au scanner) : sans effet sur les schémas, outil valide', () => {
    for (const ajout of ["var Q = /[/*]/; nul('chaine'); var Z = /[*/]/;", "var Q = `${`/*`} ${nul('chaine')} ${`*/`}`;", "nul('chaine');"]) {
      const s = SOURCE.replace('var CONTRATS = {', ajout + '\n  var CONTRATS = {');
      assert.deepEqual(R.rejouer({ source: s, vecteurs: VECTEURS }).invalide, [], ajout);
    }
  });
  test('texte nul() dans une chaîne : ni compté ni faux rejet ; texte en forme de champ -> cible fantôme signalée', () => {
    const ok = SOURCE.replace('var CONTRATS = {', 'var Q = "nul(\'chaine\')";\n  var CONTRATS = {');
    assert.deepEqual(R.rejouer({ source: ok, vecteurs: VECTEURS }).invalide, []);
    const fantome = SOURCE.replace('var CONTRATS = {', 'var Q = "[\'x\', nul(\'chaine\')]";\n  var CONTRATS = {');
    assert.match(R.rejouer({ source: fantome, vecteurs: VECTEURS }).invalide.join('\n'), /mutation sans cible dans les schémas : .* x non nullable/);
  });
  test('ancre d\'instrumentation absente ou en double -> outil INVALIDE (diagnostic exact)', () => {
    const absente = SOURCE.replace('contrats: function () {', 'contrats: function() {');
    const double = SOURCE.replace('var CONTRATS = {', '// leurre : contrats: function () {\n  var CONTRATS = {');
    for (const s of [absente, double]) {
      assert.notEqual(s, SOURCE);
      assert.match(R.rejouer({ source: s, vecteurs: VECTEURS }).invalide.join('\n'), /ancre d'instrumentation absente ou multiple/);
    }
  });
  test('chaînes contenant /* et */ : le code entre elles reste analysé (aucun faux rejet)', () => {
    const s = SOURCE.replace('  var LOT_COMPLET = objet([', "  var OUVRE = '/*';\n  var LOT_COMPLET = objet([").replace('  // État relu (§20.5)', "  var FERME = '*/';\n  // État relu (§20.5)");
    assert.equal(s.split("'/*'").length, 2); assert.equal(s.split("'*/'").length, 2);
    const r = R.rejouer({ source: s, vecteurs: VECTEURS });
    assert.deepEqual(r.invalide, []);
    assert.equal(r.total, R.rejouer({ source: SOURCE, vecteurs: VECTEURS }).total);
  });
  test('mutation sans effet -> outil INVALIDE', () => {
    const i = SOURCE.indexOf("['matiere', nul('chaine')]");
    const sup = [{ famille: 'test', nom: 'identique', debut: i, fin: i + 5, remplacement: SOURCE.slice(i, i + 5) }];
    assert.match(R.rejouer({ source: SOURCE, vecteurs: VECTEURS, supplementaires: sup }).invalide.join('\n'), /mutation sans effet : identique/);
  });
  test('mutant non chargeable -> outil INVALIDE, jamais compté comme détecté ni survivant', () => {
    const i = SOURCE.indexOf("['matiere', nul('chaine')]");
    const sup = [{ famille: 'test', nom: 'syntaxe', debut: i, fin: i + 1, remplacement: '[[[' }];
    const r = R.rejouer({ source: SOURCE, vecteurs: VECTEURS, supplementaires: sup });
    assert.match(r.invalide.join('\n'), /mutant non chargeable : syntaxe/);
    assert.ok(!r.survivantes.includes('syntaxe'));
  });
  test('mode étendu : schémas définis avant nul() mutés par littéral (mutants chargeables)', () => {
    const r = R.rejouer({ source: SOURCE, vecteurs: VECTEURS, etendu: true });
    assert.deepEqual(r.invalide, []);
  });
  test('code non muté non chargeable -> outil INVALIDE (pas d\'exception)', () => {
    const r = R.rejouer({ source: SOURCE + '\n}}}', vecteurs: VECTEURS });
    assert.match(r.invalide.join('\n'), /code non muté non chargeable/);
  });
  test('banc affaibli (refus retirés) -> survivantes signalées', () => {
    const r = R.rejouer({ source: SOURCE, vecteurs: VECTEURS.filter((x) => !x.refus) });
    assert.deepEqual(r.invalide, []);
    assert.ok(r.survivantes.length > 0);
  });
  test('ligne de commande : 0 si tout est détecté, 1 si une mutation survit, 2 si l\'outil est invalide', () => {
    assert.equal(spawnSync(process.execPath, [REJEU]).status, 0);
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rejeu-'));
    try {
      const copieOutil = (vecteurs) => {
        fs.mkdirSync(path.join(tmp, 'fonda/engine'), { recursive: true });
        fs.mkdirSync(path.join(tmp, 'fonda/scripts'), { recursive: true });
        fs.copyFileSync(REJEU, path.join(tmp, 'fonda/scripts/rejouer-mutations-canonique.js'));
        fs.writeFileSync(path.join(tmp, 'fonda/engine/canonique.js'), SOURCE);
        fs.writeFileSync(path.join(tmp, 'fonda/engine/canonique-vecteurs.json'), JSON.stringify({ vecteurs }));
        return spawnSync(process.execPath, [path.join(tmp, 'fonda/scripts/rejouer-mutations-canonique.js')]).status;
      };
      assert.equal(copieOutil(VECTEURS.filter((x) => !x.refus)), 1);
      const v = copie(); v.find((y) => !y.refus).hex = '00';
      assert.equal(copieOutil(v), 2);
      fs.writeFileSync(path.join(tmp, 'fonda/engine/canonique-vecteurs.json'), '{ illisible');
      assert.equal(spawnSync(process.execPath, [path.join(tmp, 'fonda/scripts/rejouer-mutations-canonique.js')]).status, 2);
      fs.writeFileSync(path.join(tmp, 'fonda/engine/canonique-vecteurs.json'), JSON.stringify({ vecteurs: VECTEURS }));
      fs.writeFileSync(path.join(tmp, 'fonda/engine/canonique.js'), SOURCE + '\n}}}');
      assert.equal(spawnSync(process.execPath, [path.join(tmp, 'fonda/scripts/rejouer-mutations-canonique.js')]).status, 2);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
