// Suite de tests — démarrage du mode FONDA depuis BOX (js/app.js::initFonda / init).
// Relecture Codex PR #2 v2, #1 : le délai et le retour BOX doivent exister EN AMONT
// de bootstrap.js, qui peut ne jamais charger. Tests de COMPORTEMENT (exécution réelle
// de App.initFonda() sur un DOM factice, horloge pilotée), pas de recherche de chaîne.
//
// Usage : node --test js/app.test.js

'use strict';

const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

function element(tag) {
  return {
    tagName: tag, id: '', className: '', href: '', src: '', rel: '', dataset: {},
    children: [], _text: '',
    get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text; },
    set textContent(v) { this._text = v; this.children = []; },
    append(...n) { this.children.push(...n); },
    appendChild(n) { this.children.push(n); return n; },
  };
}

let scripts;
let body;

beforeEach(() => {
  scripts = [];
  body = element('body');
  const head = element('head');
  head.appendChild = (n) => { if (n.tagName === 'script') scripts.push(n); head.children.push(n); return n; };
  global.document = { body, head, createElement: element, addEventListener() {}, getElementById: () => null };
  global.window = { location: { pathname: '/box/index.html', search: '?fonda=1&page=niveau' } };
  mock.timers.enable({ apis: ['setTimeout'] });
});

afterEach(() => {
  mock.timers.reset();
  delete global.document;
  delete global.window;
});

function chargerApp() {
  delete require.cache[require.resolve('./app.js')];
  return require('./app.js');
}

const racine = () => body.children.find((c) => c.id === 'fondaRoot');
const lienRetour = () => racine().children.find((c) => c.textContent === '← Retour à BOX');

describe('App.initFonda — bootstrap.js qui ne charge jamais / échoue', () => {
  test('« Chargement… » ET lien « Retour à BOX » présents IMMÉDIATEMENT, avant toute réponse du script', () => {
    chargerApp().initFonda();
    assert.ok(racine(), '#fondaRoot absent');
    assert.match(racine().textContent, /Chargement…/);
    assert.ok(lienRetour(), 'lien retour absent pendant l\'attente');
    assert.equal(lienRetour().href, '/box/index.html');
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].src, 'fonda/page/bootstrap.js?v=3');
  });

  test('requête pendante (ni onload ni onerror) : message d\'indisponibilité au délai, lien retour toujours là', () => {
    const App = chargerApp();
    App.initFonda();
    mock.timers.tick(App.DELAI_BOOTSTRAP_MS - 1);
    assert.match(racine().textContent, /Chargement…/);
    mock.timers.tick(1);
    assert.match(racine().textContent, /indisponible/);
    assert.ok(lienRetour());
  });

  test('erreur réseau (onerror) : message immédiat', () => {
    chargerApp().initFonda();
    scripts[0].onerror();
    assert.match(racine().textContent, /indisponible/);
    assert.ok(lienRetour());
  });

  test('erreur d\'évaluation (onload SANS signal de prise en charge) : message immédiat', () => {
    chargerApp().initFonda();
    scripts[0].onload();
    assert.match(racine().textContent, /indisponible/);
  });

  test('bootstrap.js a pris la main (signal posé) : ni onload ni le délai n\'écrasent son rendu', () => {
    const App = chargerApp();
    App.initFonda();
    window.FondaBootstrapActif = true;
    scripts[0].onload();
    mock.timers.tick(App.DELAI_BOOTSTRAP_MS);
    assert.doesNotMatch(racine().textContent, /indisponible/);
  });
});

describe('BOX clair (sans ?fonda=1) : aucun chargement FONDA', () => {
  test('App.init() sans le flag : zéro <script>, zéro #fondaRoot, thème inchangé', () => {
    window.location.search = '';
    const App = chargerApp();
    App.initKeyboard = () => {};
    App.initTouch = () => {};
    App.loadCatalogue = () => {};
    document.getElementById = () => null;
    App.init();
    assert.equal(scripts.length, 0);
    assert.equal(racine(), undefined);
    assert.equal(body.dataset.theme, undefined);
  });
});

// --- Isolation de l'écran BOX de suppression en mode FONDA (feat/box-fonda-isolation)

describe('écran de suppression : jamais rendu en mode FONDA, inchangé en BOX clair', () => {
  function ecrans() {
    const els = {};
    for (const nom of ['Menu', 'Review', 'Done', 'Delete', 'Error']) els[nom] = { style: { display: 'none' } };
    document.getElementById = (id) => (id.startsWith('screen') ? els[id.slice(6)] : null);
    return els;
  }

  test('?fonda=1&action=delete : mode FONDA lancé, screenDelete jamais affiché', () => {
    window.location.search = '?fonda=1&action=delete';
    const els = ecrans();
    const App = chargerApp();
    App.init();
    assert.equal(body.dataset.theme, 'fonda');
    assert.equal(els.Delete.style.display, 'none');
    assert.ok(racine(), 'FONDA doit avoir démarré');
  });

  test('thème FONDA : showScreen(\'delete\') (lien du footer, appel direct) ne fait rien, aucun écran masqué ni affiché', () => {
    const els = ecrans();
    els.Menu.style.display = 'block';
    const App = chargerApp();
    body.dataset.theme = 'fonda';
    App.showScreen('delete');
    assert.equal(els.Delete.style.display, 'none');
    assert.equal(els.Menu.style.display, 'block', 'rien d\'autre ne doit bouger');
  });

  test('BOX clair : ?action=delete affiche screenDelete (route admin normale inchangée)', () => {
    window.location.search = '?action=delete';
    const els = ecrans();
    const App = chargerApp();
    App.init();
    assert.equal(els.Delete.style.display, 'block');
  });

  test('BOX clair : showScreen(\'delete\') (lien « Administration ») affiche screenDelete et masque les autres', () => {
    const els = ecrans();
    els.Menu.style.display = 'block';
    const App = chargerApp();
    App.showScreen('delete');
    assert.equal(els.Delete.style.display, 'block');
    assert.equal(els.Menu.style.display, 'none');
  });
});
