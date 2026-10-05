// Suite de tests — moteur de correction Box-FONDA (T2 + corrections suite critique Codex).
// Écrite AVANT l'implémentation (fonda/engine/correction.js), conformément à la méthode imposée.
// Référence : docs/PRD-Box-FONDA.md §5.1 + table de comportement validée par Éric (2026-10-05).
// Zéro dépendance : test runner natif Node (`node --test`).
//
// Usage : node --test fonda/engine/correction.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { evaluerReponse, compteCommeReussite } = require('./correction.js');

function statut(args) {
  return evaluerReponse(args).statut;
}

describe('couche de normalisation (NFC + apostrophes/traits d\'union/espaces typographiques) — tous profils', () => {
  test('ÉCOLE (accent décomposé, NFD) = école (précomposé, NFC) en orthographe → juste, pas presque', () => {
    const decompose = 'ÉCOLE'; // É = E + combining acute accent
    assert.equal(statut({ profil: 'orthographe', reponseDonnee: decompose, reponsesAcceptees: ['école'] }), 'juste');
  });

  test('apostrophe typographique (’) = apostrophe droite (\') en orthographe', () => {
    assert.equal(statut({ profil: 'orthographe', reponseDonnee: 'l’homme', reponsesAcceptees: ["l'homme"] }), 'juste');
  });

  test('trait d\'union typographique (‑) = trait d\'union ASCII (-) en orthographe', () => {
    assert.equal(statut({ profil: 'orthographe', reponseDonnee: 'porte‑monnaie', reponsesAcceptees: ['porte-monnaie'] }), 'juste');
  });

  test('espace insécable = espace normal (profil exact)', () => {
    assert.equal(statut({ profil: 'exact', reponseDonnee: 'un chat', reponsesAcceptees: ['un chat'] }), 'juste');
  });
});

describe('profil "orthographe" — casse, espaces externes, ponctuation de phrase (. , ; !) pardonnés ; apostrophe/trait d\'union/accents SIGNIFICATIFS', () => {
  test('apostrophe manquante = faux (pas presque) — c\'est l\'accord/l\'orthographe qui est testée', () => {
    assert.equal(statut({ profil: 'orthographe', reponseDonnee: 'lhomme', reponsesAcceptees: ["l'homme"] }), 'faux');
  });

  test('réponse identique = juste', () => {
    assert.equal(statut({ profil: 'orthographe', reponseDonnee: 'garçon', reponsesAcceptees: ['garçon'] }), 'juste');
  });

  test('accent manquant = presque (relâché : accents seulement, ni apostrophe ni pluriel)', () => {
    assert.equal(statut({ profil: 'orthographe', reponseDonnee: 'garcon', reponsesAcceptees: ['garçon'] }), 'presque');
  });

  test('pluriel en trop = faux (plus de repli pluriel nulle part, cf. profil sens)', () => {
    assert.equal(statut({ profil: 'orthographe', reponseDonnee: 'garçons', reponsesAcceptees: ['garçon'] }), 'faux');
  });

  test('casse et espaces externes pardonnés', () => {
    assert.equal(statut({ profil: 'orthographe', reponseDonnee: '  GARÇON  ', reponsesAcceptees: ['garçon'] }), 'juste');
  });

  test('ponctuation de phrase pardonnée (. , ; !)', () => {
    assert.equal(statut({ profil: 'orthographe', reponseDonnee: 'garçon.', reponsesAcceptees: ['garçon'] }), 'juste');
  });

  test('réponse sans rapport = faux', () => {
    assert.equal(statut({ profil: 'orthographe', reponseDonnee: 'chien', reponsesAcceptees: ['chat'] }), 'faux');
  });

  test('typo sans rapport à accent/apostrophe = faux, pas presque (Levenshtein off)', () => {
    assert.equal(statut({ profil: 'orthographe', reponseDonnee: 'chta', reponsesAcceptees: ['chat'] }), 'faux');
  });
});

describe('profil "sens" — pardonne casse, espaces, ponctuation (dont apostrophe/trait d\'union), accents ; AUCUN repli pluriel', () => {
  test('forme numérale et forme en lettres toutes deux déclarées acceptées', () => {
    assert.equal(statut({ profil: 'sens', reponseDonnee: 'QUATRE', reponsesAcceptees: ['4', 'quatre'] }), 'juste');
  });

  test('accents pardonnés', () => {
    assert.equal(statut({ profil: 'sens', reponseDonnee: 'garcon', reponsesAcceptees: ['garçon'] }), 'juste');
  });

  test('apostrophe/trait d\'union ignorés', () => {
    assert.equal(statut({ profil: 'sens', reponseDonnee: 'lhomme', reponsesAcceptees: ["l'homme"] }), 'juste');
  });

  test('casse et espaces ignorés', () => {
    assert.equal(statut({ profil: 'sens', reponseDonnee: '  Garçon  ', reponsesAcceptees: ['garçon'] }), 'juste');
  });

  test('ponctuation ignorée', () => {
    assert.equal(statut({ profil: 'sens', reponseDonnee: 'garçon !', reponsesAcceptees: ['garçon'] }), 'juste');
  });

  test('pluriel irrégulier NON pardonné par défaut (chevaux vs cheval) — il faut le déclarer dans reponses_acceptees', () => {
    assert.equal(statut({ profil: 'sens', reponseDonnee: 'chevaux', reponsesAcceptees: ['cheval'] }), 'faux');
  });

  test('...mais marche si explicitement déclaré', () => {
    assert.equal(statut({ profil: 'sens', reponseDonnee: 'chevaux', reponsesAcceptees: ['cheval', 'chevaux'] }), 'juste');
  });

  test('pas de collision mécanique chaux -> chau (ancien bug du repli -s/-x, supprimé)', () => {
    assert.equal(statut({ profil: 'sens', reponseDonnee: 'chau', reponsesAcceptees: ['chaux'] }), 'faux');
  });

  test('réponse sans rapport = faux (pas de "presque" en sens, Levenshtein off)', () => {
    assert.equal(statut({ profil: 'sens', reponseDonnee: 'chta', reponsesAcceptees: ['chat'] }), 'faux');
  });
});

describe('profil "numerique" — unité (manquante vs fausse)', () => {
  test('unité fausse (valeur correcte, mauvaise unité) = faux, pas presque', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8 kg', reponsesAcceptees: ['8'], unite: 'cm' }), 'faux');
  });

  test('unité manquante (valeur correcte, unité omise) = presque', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8', reponsesAcceptees: ['8'], unite: 'cm' }), 'presque');
  });

  test('unité exigée et fournie correctement = juste', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8 cm', reponsesAcceptees: ['8'], unite: 'cm' }), 'juste');
  });

  test('unité avec chiffre (cm2) reconnue et exigible', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8 cm2', reponsesAcceptees: ['8'], unite: 'cm2' }), 'juste');
  });

  test('unité NON exigée par la carte : tout reliquat alphabétique = faux (plus d\'unité "ignorée")', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8 banane', reponsesAcceptees: ['8'] }), 'faux');
  });

  test('unité NON exigée, réponse propre (juste le nombre) = juste', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8', reponsesAcceptees: ['8'] }), 'juste');
  });
});

describe('profil "numerique" — arrondi (on arrondit la CIBLE/attendu, pas la réponse de l\'élève)', () => {
  test('1/3 avec arrondi:2 -> cible 0,33 ; répondre 0,33 = juste', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '0,33', reponsesAcceptees: ['1/3'], arrondi: 2 }), 'juste');
  });

  test('...mais répondre la fraction exacte 1/3 (non arrondie) = faux : l\'élève doit produire la cible arrondie', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '1/3', reponsesAcceptees: ['1/3'], arrondi: 2 }), 'faux');
  });

  test('3,09 pour cible 3,14 arrondie à 1 décimale (= 3,1) = faux', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '3,09', reponsesAcceptees: ['3,14'], arrondi: 1 }), 'faux');
  });

  test('3,1 pour cible 3,14 arrondie à 1 décimale (= 3,1) = juste', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '3,1', reponsesAcceptees: ['3,14'], arrondi: 1 }), 'juste');
  });

  test('2,68 pour cible 2,675 arrondie à 2 décimales (demi vers le haut = 2,68, sans l\'artefact toFixed qui donnerait 2,67)', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '2,68', reponsesAcceptees: ['2,675'], arrondi: 2 }), 'juste');
  });

  test('arrondi invalide (nombre négatif) -> repli sur comparaison exacte, sans exception', () => {
    assert.doesNotThrow(() => evaluerReponse({ profil: 'numerique', reponseDonnee: '1,4', reponsesAcceptees: ['1'], arrondi: -1 }));
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '1,4', reponsesAcceptees: ['1'], arrondi: -1 }), 'faux');
  });

  test('arrondi invalide (mauvais type) -> repli sur comparaison exacte, sans exception', () => {
    assert.doesNotThrow(() => evaluerReponse({ profil: 'numerique', reponseDonnee: '1,4', reponsesAcceptees: ['1'], arrondi: 'foo' }));
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '1,4', reponsesAcceptees: ['1'], arrondi: 'foo' }), 'faux');
  });

  test('arrondi invalide (non entier) -> repli sur comparaison exacte, sans exception', () => {
    assert.doesNotThrow(() => evaluerReponse({ profil: 'numerique', reponseDonnee: '1,4', reponsesAcceptees: ['1'], arrondi: 1.5 }));
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '1,4', reponsesAcceptees: ['1'], arrondi: 1.5 }), 'faux');
  });
});

describe('profil "numerique" — comparaison exacte (sans arrondi) et fractions', () => {
  test('deux valeurs réellement distinctes = faux, même très proches de zéro (l\'epsilon n\'efface pas une vraie différence)', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '0', reponsesAcceptees: ['0.0000000009'] }), 'faux');
  });

  test('zéro inutile et virgule décimale pardonnés', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '4,0', reponsesAcceptees: ['4'] }), 'juste');
  });

  test('0,30 = 0,3 (non-régression)', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '0,30', reponsesAcceptees: ['0,3'] }), 'juste');
  });

  test('séparateur de milliers en espace insécable = sans espace', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '1 000', reponsesAcceptees: ['1000'] }), 'juste');
  });

  test('fraction entier/entier équivalente acceptée (6/8 = 3/4)', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '6/8', reponsesAcceptees: ['3/4'] }), 'juste');
  });

  test('fraction et décimal équivalents', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '0.75', reponsesAcceptees: ['3/4'] }), 'juste');
  });

  test('forme non entier/entier avec "/" n\'est pas traitée comme une fraction (restriction volontaire)', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '0,5/1,5', reponsesAcceptees: ['1/3'] }), 'faux');
  });

  test('valeur fausse = faux', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '6', reponsesAcceptees: ['5'] }), 'faux');
  });
});

describe('profil "exact" — pardonne les espaces uniquement ; tout le reste strict', () => {
  test('réponse identique = juste', () => {
    assert.equal(statut({ profil: 'exact', reponseDonnee: 'E=mc²', reponsesAcceptees: ['E=mc²'] }), 'juste');
  });

  test('espaces en trop pardonnés', () => {
    assert.equal(statut({ profil: 'exact', reponseDonnee: '  E=mc²  ', reponsesAcceptees: ['E=mc²'] }), 'juste');
  });

  test('casse stricte (pas pardonnée, contrairement aux autres profils)', () => {
    assert.equal(statut({ profil: 'exact', reponseDonnee: 'e=mc²', reponsesAcceptees: ['E=mc²'] }), 'faux');
  });

  test('date : séparateur différent = faux (symboles stricts)', () => {
    assert.equal(statut({ profil: 'exact', reponseDonnee: '12-05-1940', reponsesAcceptees: ['12/05/1940'] }), 'faux');
  });

  test('date identique = juste', () => {
    assert.equal(statut({ profil: 'exact', reponseDonnee: '12/05/1940', reponsesAcceptees: ['12/05/1940'] }), 'juste');
  });
});

describe('robustesse — réponses vides et cartes malformées', () => {
  test('réponse vide = toujours faux, même si reponses_acceptees contient une entrée vide/espaces', () => {
    assert.equal(statut({ profil: 'sens', reponseDonnee: '', reponsesAcceptees: ['', '   '] }), 'faux');
    assert.equal(statut({ profil: 'orthographe', reponseDonnee: '   ', reponsesAcceptees: [''] }), 'faux');
    assert.equal(statut({ profil: 'exact', reponseDonnee: '', reponsesAcceptees: [''] }), 'faux');
  });
});

describe('comptage pour la mesure de rétention (PRD §5.1) — robustesse par défaut', () => {
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

  test('"presque" compte juste UNIQUEMENT en sens et numerique', () => {
    assert.equal(compteCommeReussite('presque', 'sens'), true);
    assert.equal(compteCommeReussite('presque', 'numerique'), true);
  });

  test('"presque" compte faux en orthographe et en exact', () => {
    assert.equal(compteCommeReussite('presque', 'orthographe'), false);
    assert.equal(compteCommeReussite('presque', 'exact'), false);
  });

  test('statut inconnu ou undefined -> faux par défaut (pas de réussite silencieuse)', () => {
    assert.equal(compteCommeReussite(undefined, 'numerique'), false);
    assert.equal(compteCommeReussite('inconnu', 'numerique'), false);
    assert.equal(compteCommeReussite('presque', 'profil-inconnu'), false);
  });
});
