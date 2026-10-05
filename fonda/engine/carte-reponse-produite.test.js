// Test d'intégration — composant « carte réponse produite » (T2, contrat seconde chance).
// Verrouille UNE règle : tentative/scored (PRD §5.1 — on score la 1ère tentative,
// jamais la seconde chance). Ne teste pas le rendu visuel (pas de vrai navigateur,
// zéro dépendance — pas de jsdom) : un DOM factice minimal, juste suffisant pour
// piloter le composant, sert de double de test.
//
// Usage : node --test fonda/engine/carte-reponse-produite.test.js

'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// --- DOM factice minimal (zéro dépendance) ---------------------------------

function creerElementFactice(tag) {
  const el = {
    tagName: tag,
    _listeners: {},
    children: [],
    classList: { add() {}, remove() {} },
    dataset: {},
    attributes: {},
    value: '',
    disabled: false,
    textContent: '',
    innerHTML: '',
    autocomplete: '',
    type: '',
    className: '',
    setAttribute(k, v) { this.attributes[k] = v; },
    addEventListener(evt, fn) { (this._listeners[evt] = this._listeners[evt] || []).push(fn); },
    append(...nodes) { this.children.push(...nodes); },
    focus() {},
    // Aides de test (pas de vraie API DOM) :
    __click() { (this._listeners.click || []).forEach((fn) => fn({})); },
    __keydown(key) { (this._listeners.keydown || []).forEach((fn) => fn({ key })); },
  };
  return el;
}

const documentFactice = { createElement: (tag) => creerElementFactice(tag) };

// Le module carte-reponse-produite.js lit `document` et `window.FondaCorrection`
// en globals (cohérent avec le chargement <script> classique du front BOX, sans
// bundler). On les pose avant de charger le module sous test.
global.document = documentFactice;
global.window = global.window || {};
global.window.FondaCorrection = require('./correction.js');

// Le fichier sous test n'exporte rien via module.exports (format <script> classique,
// pose window.FondaCarteReponseProduite) : on le require() pour son effet de bord,
// puis on récupère la fonction sur le global window qu'on vient de poser.
delete require.cache[require.resolve('./carte-reponse-produite.js')];
require('./carte-reponse-produite.js');
const { montrerCarteReponseProduite } = global.window.FondaCarteReponseProduite;

function monterCarte(carte) {
  const container = creerElementFactice('div');
  const resultats = [];
  montrerCarteReponseProduite(container, carte, {
    onResultat: (r) => resultats.push(r),
  });
  const [, input, bouton] = container.children; // question, input, bouton, feedback
  return { container, input, bouton, resultats };
}

describe('carte-reponse-produite — contrat seconde chance (tentative/scored)', () => {
  test('réponse juste du premier coup : un seul résultat, tentative 1, scored true', () => {
    const { input, bouton, resultats } = monterCarte({
      question: 'Capitale de la France ?',
      profil_correction: 'orthographe',
      reponses_acceptees: ['Paris'],
      seconde_chance: true,
    });
    input.value = 'Paris';
    bouton.__click();

    assert.equal(resultats.length, 1);
    assert.deepEqual(resultats[0], { statut: 'juste', reussite: true, tentative: 1, scored: true });
    assert.equal(input.disabled, true, 'input verrouillé après un résultat définitif');
  });

  test('"presque" avec seconde_chance:true -> 2 résultats, seule la 1ère tentative est scored', () => {
    const { input, bouton, resultats } = monterCarte({
      question: 'Écris "garçon".',
      profil_correction: 'orthographe',
      reponses_acceptees: ['garçon'],
      seconde_chance: true,
    });

    input.value = 'garcon'; // accent manquant -> presque
    bouton.__click();
    assert.equal(resultats.length, 1);
    assert.deepEqual(resultats[0], { statut: 'presque', reussite: false, tentative: 1, scored: true });
    assert.equal(input.disabled, false, 'seconde chance proposée : input toujours actif');
    assert.equal(input.value, '', 'le champ est vidé pour la relance');

    input.value = 'garçon'; // 2e tentative, corrigée
    bouton.__click();
    assert.equal(resultats.length, 2);
    assert.deepEqual(resultats[1], { statut: 'juste', reussite: true, tentative: 2, scored: false });
    assert.equal(input.disabled, true, 'verrouillé après la 2e tentative');
  });

  test('"presque" sans seconde_chance (ou seconde_chance:false) -> pas de relance, un seul résultat scored', () => {
    const { input, bouton, resultats } = monterCarte({
      question: 'Écris "garçon".',
      profil_correction: 'orthographe',
      reponses_acceptees: ['garçon'],
      seconde_chance: false,
    });
    input.value = 'garcon';
    bouton.__click();

    assert.equal(resultats.length, 1);
    assert.deepEqual(resultats[0], { statut: 'presque', reussite: false, tentative: 1, scored: true });
    assert.equal(input.disabled, true, 'pas de seconde chance : verrouillé dès la 1ère tentative');
  });

  test('"faux" avec seconde_chance:true -> pas de relance (seconde chance réservée au "presque")', () => {
    const { input, bouton, resultats } = monterCarte({
      question: 'Capitale de la France ?',
      profil_correction: 'orthographe',
      reponses_acceptees: ['Paris'],
      seconde_chance: true,
    });
    input.value = 'Lyon';
    bouton.__click();

    assert.equal(resultats.length, 1);
    assert.deepEqual(resultats[0], { statut: 'faux', reussite: false, tentative: 1, scored: true });
    assert.equal(input.disabled, true);
  });

  test('validation au clavier (Entrée) déclenche le même contrat', () => {
    const { input, resultats } = monterCarte({
      question: 'Capitale de la France ?',
      profil_correction: 'orthographe',
      reponses_acceptees: ['Paris'],
    });
    input.value = 'Paris';
    input.__keydown('Enter');

    assert.equal(resultats.length, 1);
    assert.deepEqual(resultats[0], { statut: 'juste', reussite: true, tentative: 1, scored: true });
  });
});
