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

  test('feedback : affiche la cible arrondie, pas la fraction brute (critique Codex #7)', () => {
    const { input, bouton, container } = monterCarte({
      question: 'Combien vaut 1/3, arrondi à 2 décimales ?',
      profil_correction: 'numerique',
      reponses_acceptees: ['1/3'],
      arrondi: 2,
    });
    input.value = '1/3'; // la fraction brute, non arrondie : faux, mais on vérifie le MESSAGE affiché
    bouton.__click();
    const feedback = container.children[3];
    assert.ok(feedback.textContent.includes('0,33'), `attendu "0,33" dans le feedback, reçu : "${feedback.textContent}"`);
    assert.ok(!feedback.textContent.includes('1/3'), `la fraction brute ne doit plus apparaître, reçu : "${feedback.textContent}"`);
  });

  test('feedback : affiche l\'unité manquante dans la cible (critique Codex #7)', () => {
    const { input, bouton, container } = monterCarte({
      question: 'Quelle est la longueur ?',
      profil_correction: 'numerique',
      reponses_acceptees: ['8'],
      unite: 'cm',
    });
    input.value = '8'; // valeur correcte, unité omise : presque
    bouton.__click();
    const feedback = container.children[3];
    assert.ok(feedback.textContent.includes('8 cm'), `attendu "8 cm" dans le feedback, reçu : "${feedback.textContent}"`);
  });

  test('carte_invalide (attendu incohérent) : pas de crash, pas de seconde chance, jamais scored en réussite', () => {
    const { input, bouton, resultats, container } = monterCarte({
      question: 'Quelle est la masse ?',
      profil_correction: 'numerique',
      reponses_acceptees: ['8 kg'],
      unite: 'cm',
    });
    input.value = '8 cm';
    bouton.__click();

    assert.equal(resultats.length, 1);
    assert.deepEqual(resultats[0], { statut: 'carte_invalide', reussite: false, tentative: 1, scored: true });
    assert.equal(input.disabled, true, 'pas de seconde chance sur une carte invalide');
    const feedback = container.children[3];
    assert.ok(feedback.textContent.length > 0, 'un message est affiché, pas de crash');
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
