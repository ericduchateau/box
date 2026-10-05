// Suite de tests — moteur de correction Box-FONDA (T2).
// Écrite AVANT l'implémentation (fonda/engine/correction.js), conformément à la méthode imposée (AGENTS.md).
// Référence : docs/PRD-Box-FONDA.md §5.1.
// Zéro dépendance : test runner natif Node (`node --test`), require Node >= 18.
//
// Usage : node --test fonda/engine/correction.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { evaluerReponse, compteCommeReussite } = require('./correction.js');

describe('profil "sens" — pardonne casse, espaces, ponctuation, accents, singulier/pluriel ; strict sur rien', () => {
  test('forme numérale et forme en lettres toutes deux déclarées acceptées', () => {
    assert.equal(evaluerReponse({ profil: 'sens', reponseDonnee: 'QUATRE', reponsesAcceptees: ['4', 'quatre'] }).statut, 'juste');
    assert.equal(evaluerReponse({ profil: 'sens', reponseDonnee: '4', reponsesAcceptees: ['4', 'quatre'] }).statut, 'juste');
  });

  test('accents pardonnés', () => {
    assert.equal(evaluerReponse({ profil: 'sens', reponseDonnee: 'garcon', reponsesAcceptees: ['garçon'] }).statut, 'juste');
  });

  test('singulier/pluriel pardonné', () => {
    assert.equal(evaluerReponse({ profil: 'sens', reponseDonnee: 'garçons', reponsesAcceptees: ['garçon'] }).statut, 'juste');
  });

  test('casse et espaces ignorés', () => {
    assert.equal(evaluerReponse({ profil: 'sens', reponseDonnee: '  Garçon  ', reponsesAcceptees: ['garçon'] }).statut, 'juste');
  });

  test('ponctuation ignorée', () => {
    assert.equal(evaluerReponse({ profil: 'sens', reponseDonnee: 'garçon !', reponsesAcceptees: ['garçon'] }).statut, 'juste');
  });

  test('réponse sans rapport = faux (pas de "presque" en sens, Levenshtein off)', () => {
    assert.equal(evaluerReponse({ profil: 'sens', reponseDonnee: 'chta', reponsesAcceptees: ['chat'] }).statut, 'faux');
  });
});

describe('profil "orthographe" — pardonne casse, espaces, ponctuation ; strict sur accents, pluriels, accords', () => {
  test('réponse identique = juste', () => {
    assert.equal(evaluerReponse({ profil: 'orthographe', reponseDonnee: 'garçon', reponsesAcceptees: ['garçon'] }).statut, 'juste');
  });

  test('accent manquant = presque (pas faux sec)', () => {
    assert.equal(evaluerReponse({ profil: 'orthographe', reponseDonnee: 'garcon', reponsesAcceptees: ['garçon'] }).statut, 'presque');
  });

  test('pluriel en trop = presque (c\'est l\'accord qui est testé)', () => {
    assert.equal(evaluerReponse({ profil: 'orthographe', reponseDonnee: 'garçons', reponsesAcceptees: ['garçon'] }).statut, 'presque');
  });

  test('casse et espaces pardonnés', () => {
    assert.equal(evaluerReponse({ profil: 'orthographe', reponseDonnee: '  GARÇON  ', reponsesAcceptees: ['garçon'] }).statut, 'juste');
  });

  test('ponctuation pardonnée', () => {
    assert.equal(evaluerReponse({ profil: 'orthographe', reponseDonnee: 'garçon.', reponsesAcceptees: ['garçon'] }).statut, 'juste');
  });

  test('réponse sans rapport = faux (pas de fuzzy, Levenshtein off)', () => {
    assert.equal(evaluerReponse({ profil: 'orthographe', reponseDonnee: 'chien', reponsesAcceptees: ['chat'] }).statut, 'faux');
  });

  test('typo non liée à accent/pluriel = faux, pas presque (Levenshtein off par défaut)', () => {
    assert.equal(evaluerReponse({ profil: 'orthographe', reponseDonnee: 'chta', reponsesAcceptees: ['chat'] }).statut, 'faux');
  });
});

describe('profil "numerique" — virgule=point, espaces, zéros inutiles pardonnés ; strict sur la valeur', () => {
  test('virgule décimale et zéro inutile pardonnés', () => {
    assert.equal(evaluerReponse({ profil: 'numerique', reponseDonnee: '4,0', reponsesAcceptees: ['4'] }).statut, 'juste');
  });

  test('fraction équivalente acceptée (6/8 = 3/4)', () => {
    assert.equal(evaluerReponse({ profil: 'numerique', reponseDonnee: '6/8', reponsesAcceptees: ['3/4'] }).statut, 'juste');
  });

  test('fraction et décimal équivalents', () => {
    assert.equal(evaluerReponse({ profil: 'numerique', reponseDonnee: '0.75', reponsesAcceptees: ['3/4'] }).statut, 'juste');
  });

  test('unité exigée et fournie = juste', () => {
    assert.equal(evaluerReponse({ profil: 'numerique', reponseDonnee: '8 cm', reponsesAcceptees: ['8'], unite: 'cm' }).statut, 'juste');
  });

  test('unité exigée mais manquante = presque (valeur correcte, unité oubliée)', () => {
    assert.equal(evaluerReponse({ profil: 'numerique', reponseDonnee: '8', reponsesAcceptees: ['8'], unite: 'cm' }).statut, 'presque');
  });

  test('unité fournie mais non exigée par la carte = ignorée, juste quand même', () => {
    assert.equal(evaluerReponse({ profil: 'numerique', reponseDonnee: '8 cm', reponsesAcceptees: ['8'], unite: null }).statut, 'juste');
  });

  test('décimaux exacts par défaut (sans arrondi déclaré) = faux si approché', () => {
    assert.equal(evaluerReponse({ profil: 'numerique', reponseDonnee: '3.1', reponsesAcceptees: ['3.14'] }).statut, 'faux');
  });

  test('arrondi toléré uniquement si la carte le précise', () => {
    assert.equal(evaluerReponse({ profil: 'numerique', reponseDonnee: '3.1', reponsesAcceptees: ['3.14'], arrondi: 0.1 }).statut, 'juste');
  });

  test('valeur fausse = faux', () => {
    assert.equal(evaluerReponse({ profil: 'numerique', reponseDonnee: '6', reponsesAcceptees: ['5'] }).statut, 'faux');
  });
});

describe('profil "exact" — pardonne les espaces uniquement ; tout le reste strict', () => {
  test('réponse identique = juste', () => {
    assert.equal(evaluerReponse({ profil: 'exact', reponseDonnee: 'E=mc²', reponsesAcceptees: ['E=mc²'] }).statut, 'juste');
  });

  test('espaces en trop pardonnés', () => {
    assert.equal(evaluerReponse({ profil: 'exact', reponseDonnee: '  E=mc²  ', reponsesAcceptees: ['E=mc²'] }).statut, 'juste');
  });

  test('casse stricte (pas pardonnée, contrairement aux autres profils)', () => {
    assert.equal(evaluerReponse({ profil: 'exact', reponseDonnee: 'e=mc²', reponsesAcceptees: ['E=mc²'] }).statut, 'faux');
  });

  test('date : séparateur différent = faux (symboles stricts)', () => {
    assert.equal(evaluerReponse({ profil: 'exact', reponseDonnee: '12-05-1940', reponsesAcceptees: ['12/05/1940'] }).statut, 'faux');
  });

  test('date identique = juste', () => {
    assert.equal(evaluerReponse({ profil: 'exact', reponseDonnee: '12/05/1940', reponsesAcceptees: ['12/05/1940'] }).statut, 'juste');
  });
});

describe('comptage pour la mesure de rétention (PRD §5.1) — "presque" compte juste en sens/numerique, faux en orthographe', () => {
  test('statut "juste" compte toujours comme une réussite, quel que soit le profil', () => {
    assert.equal(compteCommeReussite('juste', 'sens'), true);
    assert.equal(compteCommeReussite('juste', 'orthographe'), true);
    assert.equal(compteCommeReussite('juste', 'numerique'), true);
    assert.equal(compteCommeReussite('juste', 'exact'), true);
  });

  test('statut "faux" ne compte jamais comme une réussite', () => {
    assert.equal(compteCommeReussite('faux', 'sens'), false);
    assert.equal(compteCommeReussite('faux', 'orthographe'), false);
    assert.equal(compteCommeReussite('faux', 'numerique'), false);
    assert.equal(compteCommeReussite('faux', 'exact'), false);
  });

  test('statut "presque" compte juste en numerique', () => {
    assert.equal(compteCommeReussite('presque', 'numerique'), true);
  });

  test('statut "presque" compte faux en orthographe (l\'accent/l\'accord était la cible)', () => {
    assert.equal(compteCommeReussite('presque', 'orthographe'), false);
  });
});
