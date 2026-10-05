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

  test('2e passe (critique Codex #3) : même un statut "juste" ne compte pas si le profil est invalide', () => {
    assert.equal(compteCommeReussite('juste', 'inconnu'), false);
    assert.equal(compteCommeReussite('juste', undefined), false);
  });
});

// ---------------------------------------------------------------------------
// 2e passe de corrections — critique Codex ciblée (2026-10-05)
// ---------------------------------------------------------------------------

describe('2e passe — unité : sensible à la casse, normalisation symétrique, exposants (#2 #5)', () => {
  test('casse significative : mA et MA sont des unités différentes', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8 mA', reponsesAcceptees: ['8'], unite: 'MA' }), 'faux');
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8 mA', reponsesAcceptees: ['8'], unite: 'mA' }), 'juste');
  });

  test('symétrie : l\'unité EXIGÉE passe par la même canonisation typographique que la saisie', () => {
    // signe moins typographique (−) côté carte, trait d'union ASCII côté élève
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8 m/s-1', reponsesAcceptees: ['8'], unite: 'm/s−1' }), 'juste');
  });

  test('exposants Unicode normalisés vers des chiffres, dans les deux sens', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8 cm²', reponsesAcceptees: ['8'], unite: 'cm2' }), 'juste');
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8 cm2', reponsesAcceptees: ['8'], unite: 'cm²' }), 'juste');
  });
});

describe('2e passe — ponctuation : seulement . ! ? en externe ; -, +, ,, / jamais supprimés (#6)', () => {
  test('virgule interne significative en orthographe (cha,t ne doit plus matcher chat)', () => {
    assert.equal(statut({ profil: 'orthographe', reponseDonnee: 'cha,t', reponsesAcceptees: ['chat'] }), 'faux');
  });

  test('trait d\'union (signe moins) significatif en sens : -4 ne doit plus matcher 4', () => {
    assert.equal(statut({ profil: 'sens', reponseDonnee: '-4', reponsesAcceptees: ['4'] }), 'faux');
  });

  test('virgule significative en sens : 1,5 ne doit plus matcher 15', () => {
    assert.equal(statut({ profil: 'sens', reponseDonnee: '1,5', reponsesAcceptees: ['15'] }), 'faux');
  });

  test('. ! ? restent pardonnés en position externe', () => {
    assert.equal(statut({ profil: 'orthographe', reponseDonnee: 'garçon?', reponsesAcceptees: ['garçon'] }), 'juste');
    assert.equal(statut({ profil: 'sens', reponseDonnee: '!chat!', reponsesAcceptees: ['chat'] }), 'juste');
  });

  test('contrôle du vide EN DERNIER : "!!!" ne doit jamais matcher une reponse_acceptee vide/blanche', () => {
    assert.equal(statut({ profil: 'orthographe', reponseDonnee: '!!!', reponsesAcceptees: [''] }), 'faux');
    assert.equal(statut({ profil: 'sens', reponseDonnee: '???', reponsesAcceptees: ['   '] }), 'faux');
  });
});

describe('2e passe — numérique : tolérance relative (pas de seuil absolu), arrondi borné, garde-fou aberrant (#1 #4)', () => {
  test('deux grands entiers consécutifs sont bien distincts (tolérance relative, pas 1e-9 absolu)', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '1000000001', reponsesAcceptees: ['1000000000'] }), 'faux');
  });

  test('toujours "exacte près de zéro" : 0 et 0.0000000000005 restent distincts', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '0', reponsesAcceptees: ['0.0000000000005'] }), 'faux');
  });

  test('arrondi:2, la cible est 0,33 (depuis 1/3) : 0,3300000001 (bruit décimal réel, pas binaire) reste faux', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '0.3300000001', reponsesAcceptees: ['1/3'], arrondi: 2 }), 'faux');
  });

  test('arrondi hors bornes [0,10] -> repli exact, pas d\'exception, pas de faux "juste"', () => {
    assert.doesNotThrow(() => evaluerReponse({ profil: 'numerique', reponseDonnee: '2.68', reponsesAcceptees: ['2.674999999999'], arrondi: 309 }));
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '2.68', reponsesAcceptees: ['2.674999999999'], arrondi: 309 }), 'faux');
  });

  test('l\'arrondi "demi vers le haut" ne doit pas franchir un seuil réel non lié au bruit binaire', () => {
    // 2.674999999999 est réellement EN DESSOUS de 2.675 (écart ~1e-12, pas du bruit binaire ~1e-16) :
    // arrondi à 2 décimales -> cible 2.67, pas 2.68.
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '2.67', reponsesAcceptees: ['2.674999999999'], arrondi: 2 }), 'juste');
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '2.68', reponsesAcceptees: ['2.674999999999'], arrondi: 2 }), 'faux');
  });

  test('garde-fou : un nombre non fini (ex. 310 chiffres -> Infinity) est toujours faux, jamais d\'exception', () => {
    const nombreEnorme = '9'.repeat(310);
    assert.doesNotThrow(() => evaluerReponse({ profil: 'numerique', reponseDonnee: nombreEnorme, reponsesAcceptees: ['1'] }));
    assert.equal(statut({ profil: 'numerique', reponseDonnee: nombreEnorme, reponsesAcceptees: ['1'] }), 'faux');
    // ... y compris si c'est la réponse ACCEPTÉE qui est aberrante.
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '1', reponsesAcceptees: [nombreEnorme] }), 'faux');
  });
});

describe('2e passe — profil/statut inconnu : garde-fou "jamais d\'exception"', () => {
  test('profil inconnu -> faux, sans lever d\'exception (plus de throw)', () => {
    assert.doesNotThrow(() => evaluerReponse({ profil: 'inconnu', reponseDonnee: 'x', reponsesAcceptees: ['x'] }));
    assert.equal(statut({ profil: 'inconnu', reponseDonnee: 'x', reponsesAcceptees: ['x'] }), 'faux');
  });
});

describe('2e passe — feedback : la cible affichée est celle réellement exigée (#7)', () => {
  const { calculerCibleAffichee } = require('./correction.js');

  test('numerique + arrondi : affiche la valeur arrondie, pas la fraction brute', () => {
    assert.equal(calculerCibleAffichee({ profil: 'numerique', reponsesAcceptees: ['1/3'], arrondi: 2 }), '0,33');
  });

  test('numerique + unité exigée : l\'unité apparaît dans la cible affichée', () => {
    assert.equal(calculerCibleAffichee({ profil: 'numerique', reponsesAcceptees: ['8'], unite: 'cm' }), '8 cm');
  });

  test('profil littéral : simplement la première réponse acceptée', () => {
    assert.equal(calculerCibleAffichee({ profil: 'orthographe', reponsesAcceptees: ['garçon'] }), 'garçon');
  });
});

// ---------------------------------------------------------------------------
// Micro-passe finale — critique Codex ciblée (2026-10-05, 3e passe)
// ---------------------------------------------------------------------------

describe('micro-passe finale — carte_invalide : attendu (reponsesAcceptees) incohérent, jamais "juste" (numerique)', () => {
  // Les deux cas ci-dessous sont le cœur du garde-fou : une unité CONTRADICTOIRE
  // doit toujours être signalée, une unité valide contenant simplement un chiffre
  // (cm², m·s⁻¹) ne doit jamais l'être. Gardés côte à côte pour qu'une régression
  // sur l'un ne passe pas inaperçue en corrigeant l'autre (cf. critique Codex #1).
  test('unité CONTRADICTOIRE (8 kg attendu, unite:"cm") -> carte_invalide, y compris si la réponse élève suit la carte (8 cm)', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8 kg', reponsesAcceptees: ['8 kg'], unite: 'cm' }), 'carte_invalide');
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8 cm', reponsesAcceptees: ['8 kg'], unite: 'cm' }), 'carte_invalide');
  });

  test('unité VALIDE contenant un chiffre et qui correspond à la carte (cm², cm2, m·s⁻¹) -> jamais carte_invalide', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8 cm²', reponsesAcceptees: ['8 cm²'], unite: 'cm²' }), 'juste');
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8 cm2', reponsesAcceptees: ['8 cm2'], unite: 'cm²' }), 'juste');
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8 m·s-1', reponsesAcceptees: ['8 m·s⁻¹'], unite: 'm·s-1' }), 'juste');
  });

  test('table des fractions malformées dans l\'ATTENDU (reponsesAcceptees) -> toujours carte_invalide, jamais juste', () => {
    for (const attendu of ['1/', '1/2/', '/3', '1/0', '0,5/1,5']) {
      const resultat = statut({ profil: 'numerique', reponseDonnee: '1', reponsesAcceptees: [attendu] });
      assert.equal(resultat, 'carte_invalide', `attendu="${attendu}" -> reçu "${resultat}"`);
    }
  });

  test('la MÊME table de fractions malformées côté SAISIE ÉLÈVE (reponseDonnee) -> toujours faux, jamais juste (la carte, elle, est correcte)', () => {
    for (const saisie of ['1/', '1/2/', '/3', '1/0', '0,5/1,5']) {
      const resultat = statut({ profil: 'numerique', reponseDonnee: saisie, reponsesAcceptees: ['1'] });
      assert.equal(resultat, 'faux', `saisie="${saisie}" -> reçu "${resultat}"`);
    }
  });

  test('(5e critique Codex) fraction malformée SUIVIE d\'un texte d\'unité, sans unite déclarée : le "/" résiduel reste malformé même si la suite ressemble à une unité', () => {
    for (const attendu of ['1/ cm²', '1/2/ cm²', '1 / -2 / cm²', '0,5 / 1,5 cm²', '1//2 cm²']) {
      const resultat = statut({ profil: 'numerique', reponseDonnee: '1', reponsesAcceptees: [attendu] });
      assert.equal(resultat, 'carte_invalide', `attendu="${attendu}" -> reçu "${resultat}"`);
    }
  });

  test('non-régression : une fraction PROPRE suivie d\'une unité reste valide (le "/" est entièrement absorbé dans la valeur)', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '0,75 cm', reponsesAcceptees: ['3/4 cm'], unite: 'cm' }), 'juste');
  });

  test('(6e critique Codex, faux positif) une unité COMPOSÉE légitime contenant un "/" (m/s, km/h) n\'est pas une incohérence', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '0,75 m/s', reponsesAcceptees: ['3/4 m/s'], unite: 'm/s' }), 'juste');
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8 km/h', reponsesAcceptees: ['8 km/h'], unite: 'km/h' }), 'juste');
  });

  test('(7e critique Codex, faux positif) une unité composée avec exposant sur un facteur du milieu (m²·s⁻¹, kg·m²/s²) n\'est pas une incohérence', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8 m²·s⁻¹', reponsesAcceptees: ['8 m²·s⁻¹'], unite: 'm²·s⁻¹' }), 'juste');
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8 m⁻¹·s⁻¹', reponsesAcceptees: ['8 m⁻¹·s⁻¹'], unite: 'm⁻¹·s⁻¹' }), 'juste');
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8 kg·m²/s²', reponsesAcceptees: ['8 kg·m²/s²'], unite: 'kg·m²/s²' }), 'juste');
  });

  test('(6e critique Codex, faux négatif) une fraction décimale tronquée par le parseur (1/2,5) laisse un résidu malformé -> carte_invalide', () => {
    for (const attendu of ['1/2,5 cm²', '1 / -2,5 cm²', '1/2.5 m·s⁻¹']) {
      const resultat = statut({ profil: 'numerique', reponseDonnee: '0,5', reponsesAcceptees: [attendu] });
      assert.equal(resultat, 'carte_invalide', `attendu="${attendu}" -> reçu "${resultat}"`);
    }
  });

  test('carte_invalide ne compte jamais comme une réussite', () => {
    assert.equal(compteCommeReussite('carte_invalide', 'numerique'), false);
  });

  test('non-régression : attendu cohérent (unité correcte, pas de reliquat) -> comportement inchangé', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8 cm', reponsesAcceptees: ['8'], unite: 'cm' }), 'juste');
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8', reponsesAcceptees: ['8'], unite: 'cm' }), 'presque');
  });

  test('un nombre non fini en reponsesAcceptees (sans "/") reste "faux" (garde-fou existant, pas carte_invalide)', () => {
    const nombreEnorme = '9'.repeat(310);
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '1', reponsesAcceptees: [nombreEnorme] }), 'faux');
  });
});

describe('micro-passe finale — normalisation du moins en exposant ⁻→- côté unité (m·s⁻¹ = m·s-1)', () => {
  test('unité élève en ASCII (-1), unité carte en exposant (⁻¹)', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8 m/s-1', reponsesAcceptees: ['8'], unite: 'm/s⁻¹' }), 'juste');
  });

  test('unité élève en exposant (⁻¹), unité carte en ASCII (-1)', () => {
    assert.equal(statut({ profil: 'numerique', reponseDonnee: '8 m/s⁻¹', reponsesAcceptees: ['8'], unite: 'm/s-1' }), 'juste');
  });
});

describe('micro-passe finale — feedback : affichage à la précision de arrondi (pas de résidu binaire)', () => {
  const { calculerCibleAffichee } = require('./correction.js');

  test('la cible affichée respecte exactement n décimales (toFixed, pas String brut)', () => {
    assert.equal(calculerCibleAffichee({ profil: 'numerique', reponsesAcceptees: ['1/3'], arrondi: 2 }), '0,33');
    assert.equal(calculerCibleAffichee({ profil: 'numerique', reponsesAcceptees: ['2.675'], arrondi: 2 }), '2,68');
  });
});
