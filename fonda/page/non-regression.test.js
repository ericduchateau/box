// Non-régression de BOX ordinaire — Box-FONDA (T4).
// Règle n°1 du ticket, au-dessus de tout : flag OFF (pas de ?fonda=1), la page doit se
// comporter EXACTEMENT comme avant T4 — même JS exécuté, zéro élément FONDA ajouté,
// zéro requête en plus. Ce fichier le prouve, il ne le suppose pas.
//
// Usage : node --test fonda/page/non-regression.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const APP_JS_PATH = path.join(REPO_ROOT, 'js', 'app.js');
const INDEX_HTML_PATH = path.join(REPO_ROOT, 'index.html');

// --- DOM factice minimal (zéro dépendance, même style que carte-reponse-produite.test.js) --

function creerElementFactice(tag) {
  return {
    tagName: tag,
    src: '',
    className: '',
    _listeners: {},
    children: [],
    classList: { add() {}, remove() {} },
    dataset: {},
    attributes: {},
    style: {},
    addEventListener(evt, fn) { (this._listeners[evt] = this._listeners[evt] || []).push(fn); },
    appendChild(node) { this.children.push(node); return node; },
    appendTo(parent) { parent.appendChild(this); },
  };
}

function creerDocumentFactice() {
  const head = creerElementFactice('head');
  const body = creerElementFactice('body');
  return {
    head, body,
    createElement: (tag) => creerElementFactice(tag),
    getElementById: () => null, // aucun #chimneyHost dans ce DOM factice -> branche ignorée, comme en prod sans le nœud
    addEventListener() {}, // on appelle App.init() directement, jamais via un vrai événement DOMContentLoaded
  };
}

function chargerAppAvecFlag(search) {
  const doc = creerDocumentFactice();
  global.document = doc;
  global.window = { location: { search } };
  delete require.cache[require.resolve(APP_JS_PATH)];
  const App = require(APP_JS_PATH);
  return { App, document: doc };
}

describe('non-régression — flag OFF : exactement le comportement d\'avant T4', () => {
  test('aucun script FONDA n\'est injecté dans <head>', () => {
    const { App, document } = chargerAppAvecFlag('');
    // Neutralise les méthodes internes pour isoler l'assertion qui nous intéresse
    // (pas de vrai catalogue/chimney à charger dans ce DOM factice).
    App.initKeyboard = () => {};
    App.initTouch = () => {};
    App.loadCatalogue = () => {};
    App.init();
    assert.equal(document.head.children.length, 0, 'aucun <script> ne doit être ajouté à <head> quand le flag est absent');
  });

  test('initFonda() n\'est jamais appelée quand ?fonda n\'est pas "1"', () => {
    for (const search of ['', '?set=abc', '?action=delete', '?fonda=0', '?fonda=true', '?fonda=']) {
      const { App } = chargerAppAvecFlag(search);
      let appele = false;
      App.initFonda = () => { appele = true; };
      App.initKeyboard = () => {};
      App.initTouch = () => {};
      App.loadCatalogue = () => {};
      App.loadAndReview = () => {};
      App.showScreen = () => {};
      App.init();
      assert.equal(appele, false, `search="${search}" n'aurait jamais dû déclencher initFonda()`);
    }
  });

  test('le chemin d\'init normal (sans paramètre) exécute exactement la même séquence qu\'avant : initKeyboard, initTouch, loadCatalogue', () => {
    const { App } = chargerAppAvecFlag('');
    const appels = [];
    App.initKeyboard = () => appels.push('initKeyboard');
    App.initTouch = () => appels.push('initTouch');
    App.loadCatalogue = () => appels.push('loadCatalogue');
    App.loadAndReview = () => appels.push('loadAndReview');
    App.init();
    assert.deepEqual(appels, ['initKeyboard', 'initTouch', 'loadCatalogue']);
  });

  test('?set=xxx (sans fonda) continue de fonctionner exactement comme avant : loadAndReview, pas loadCatalogue', () => {
    const { App } = chargerAppAvecFlag('?set=box_test01');
    const appels = [];
    App.initKeyboard = () => appels.push('initKeyboard');
    App.initTouch = () => appels.push('initTouch');
    App.loadCatalogue = () => appels.push('loadCatalogue');
    App.loadAndReview = (id) => appels.push('loadAndReview:' + id);
    App.init();
    assert.deepEqual(appels, ['initKeyboard', 'initTouch', 'loadAndReview:box_test01']);
  });

  test('?action=delete (sans fonda) continue de fonctionner exactement comme avant : showScreen seul, rien d\'autre', () => {
    const { App } = chargerAppAvecFlag('?action=delete');
    const appels = [];
    App.showScreen = (s) => appels.push('showScreen:' + s);
    App.initKeyboard = () => appels.push('initKeyboard');
    App.loadCatalogue = () => appels.push('loadCatalogue');
    App.init();
    assert.deepEqual(appels, ['showScreen:delete']);
  });
});

describe('non-régression — flag ON : le chemin normal n\'est JAMAIS exécuté, un seul script est injecté', () => {
  test('?fonda=1 déclenche initFonda() et RIEN du chemin normal', () => {
    const { App, document } = chargerAppAvecFlag('?fonda=1');
    const appels = [];
    App.initKeyboard = () => appels.push('initKeyboard');
    App.initTouch = () => appels.push('initTouch');
    App.loadCatalogue = () => appels.push('loadCatalogue');
    App.loadAndReview = () => appels.push('loadAndReview');
    App.showScreen = () => appels.push('showScreen');
    App.init();
    assert.deepEqual(appels, [], 'aucune fonction du chemin normal ne doit être appelée');
    assert.equal(document.head.children.length, 1);
    assert.equal(document.head.children[0].tagName, 'script');
    assert.ok(document.head.children[0].src.startsWith('fonda/'), 'le script injecté doit venir de /fonda/');
  });
});

describe('non-régression — index.html : zéro référence statique à /fonda/ (zéro requête en plus si le flag est absent)', () => {
  test('aucun <script src="fonda/...> ni <link href="fonda/..."> dans le HTML statique', () => {
    const html = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');
    assert.doesNotMatch(html, /<script[^>]+src=["']\.?\/?fonda\//i, 'un <script> statique vers /fonda/ créerait une requête même flag OFF');
    assert.doesNotMatch(html, /<link[^>]+href=["']\.?\/?fonda\//i, 'un <link> statique vers /fonda/ créerait une requête même flag OFF');
  });

  test('les 3 scripts existants (chimney, config, app) sont inchangés en nombre — aucun script statique ajouté', () => {
    const html = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');
    const scripts = html.match(/<script\s+src=/g) || [];
    assert.equal(scripts.length, 3, `attendu exactement 3 <script src=...> statiques (chimney/config/app), trouvé ${scripts.length}`);
  });

  test('index.html est BYTE-IDENTIQUE à main (comparaison git directe, pas une supposition)', () => {
    const htmlMain = execFileSync('git', ['show', 'main:index.html'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    const htmlActuel = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');
    assert.equal(htmlActuel, htmlMain);
  });
});

// --- Exécute init() sur une source app.js donnée (texte), via vm (pas require()) ---
// pour pouvoir faire tourner aussi bien le app.js ACTUEL que celui de `main` (qui n'a
// pas le module.exports ajouté pour les tests) dans le MÊME harnais, et comparer
// objectivement leur comportement plutôt que de le supposer identique.
const vm = require('node:vm');

function executerInitViaVM(sourceJS, search) {
  const appels = [];
  const docFactice = {
    createElement: () => ({ src: '', classList: { add() {}, remove() {} }, addEventListener() {}, appendChild() {} }),
    head: { children: [], appendChild(n) { this.children.push(n); } },
    getElementById: () => null,
    addEventListener() {}, // on appelle App.init() nous-mêmes, jamais via un vrai DOMContentLoaded
  };
  const sandbox = { document: docFactice, window: { location: { search } }, URLSearchParams, console };
  vm.createContext(sandbox);
  new vm.Script(sourceJS + '\nglobalThis.__App = (typeof App !== "undefined") ? App : undefined;').runInContext(sandbox);
  const App = sandbox.__App;
  assert.ok(App, 'App introuvable dans la source exécutée');

  const espionne = (nom) => (...args) => appels.push(args.length ? `${nom}:${args[0]}` : nom);
  App.initKeyboard = espionne('initKeyboard');
  App.initTouch = espionne('initTouch');
  App.loadCatalogue = espionne('loadCatalogue');
  App.loadAndReview = espionne('loadAndReview');
  App.showScreen = espionne('showScreen');
  if (typeof App.initFonda === 'function') App.initFonda = espionne('initFonda');
  App.init();
  return { appels, head: docFactice.head };
}

describe('non-régression STRICTE — isolation totale des deux chemins (return après initFonda), comparaison directe avec main', () => {
  test('la branche fonda est la TOUTE PREMIÈRE instruction APRÈS la lecture des params, avec son "return" — rien ne peut s\'exécuter avant ou malgré elle', () => {
    const source = fs.readFileSync(APP_JS_PATH, 'utf-8');
    const corps = source.slice(source.indexOf('init() {'));
    const lignes = corps.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
    assert.match(lignes[1], /^const params = new URLSearchParams\(window\.location\.search\);$/, 'ligne 1 attendue inchangée (lecture des params)');
    assert.equal(lignes[2], "if (params.get('fonda') === '1') { this.initFonda(); return; }", 'la branche fonda+return doit être la toute première vérification, avant même "action=delete"');
  });

  test('comparaison directe avec main : séquence d\'appels IDENTIQUE pour tout usage BOX normal (aucun ?fonda)', () => {
    const sourceMain = execFileSync('git', ['show', 'main:js/app.js'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    const sourceActuelle = fs.readFileSync(APP_JS_PATH, 'utf-8');

    for (const search of ['', '?set=box_test01', '?action=delete']) {
      const resultatMain = executerInitViaVM(sourceMain, search);
      const resultatActuel = executerInitViaVM(sourceActuelle, search);
      assert.deepEqual(resultatActuel.appels, resultatMain.appels, `search="${search}" : séquence d'appels différente de main`);
      assert.equal(resultatActuel.head.children.length, resultatMain.head.children.length, `search="${search}" : nombre de <script> injectés différent de main`);
    }
  });

  test('main ne connaît même pas ?fonda=1 : la comparaison ne vaut QUE pour les usages BOX normaux, jamais pour le mode FONDA lui-même', () => {
    const sourceMain = execFileSync('git', ['show', 'main:js/app.js'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    const resultatMain = executerInitViaVM(sourceMain, '?fonda=1');
    // Sur main, "fonda" n'est reconnu par aucune branche -> tombe dans le chemin
    // normal (loadCatalogue), par définition puisque le mode FONDA n'existe pas là.
    assert.deepEqual(resultatMain.appels, ['initKeyboard', 'initTouch', 'loadCatalogue']);
  });
});
