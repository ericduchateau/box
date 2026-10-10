// Suite de tests — fonda/scripts/generer-lot-fonda.js (dette T6b, génération réelle).
// Teste UNIQUEMENT les fonctions pures (parsing, vérification correcteur, dérivation
// G4, reformatage box-select) — ZÉRO appel réseau ici, jamais `appellerModeleClaude`
// ni `main()`. La réponse "du modèle" est simulée par des objets écrits à la main,
// jouant exactement le rôle que jouerait un vrai texte de réponse Claude.
//
// Usage : node --test fonda/scripts/generer-lot-fonda.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  estNotionExclue,
  construirePrompt,
  parserReponseModele,
  verifierContreCorrecteur,
  construireCandidats,
  construireFichierBoxSelect,
} = require('./generer-lot-fonda.js');

const NOTION_MATHS = Object.freeze({
  id: 'maths.geometrie',
  matiere: 'maths',
  relecteur: 'eric',
  libelle: 'Comprendre et utiliser les grandeurs géométriques',
  micro_competence: 'Calculer une aire ou un périmètre simple.',
  enonce_modele: ['Exemple PRD'],
  paliers: ['nI', 'nF'],
});

const DESTINATAIRES_TEST = Object.freeze({
  relecteurs: {
    eric: { email: 'duchateauphysiquechimie@gmail.com' },
    justine: { email: 'ericdnews@yahoo.fr', _TEST: 'placeholder' },
  },
});

describe('parserReponseModele', () => {
  test('texte JSON valide avec cartes -> ok', () => {
    const texte = 'Voici le JSON :\n' + JSON.stringify({ cartes: [{ question: 'Q ?', reponse: 'R' }] }) + '\nFin.';
    const r = parserReponseModele(texte);
    assert.equal(r.ok, true);
    assert.equal(r.cartesBrutes.length, 1);
  });

  test('pas de JSON dans le texte -> rejeté', () => {
    const r = parserReponseModele('juste du texte, pas de JSON');
    assert.equal(r.ok, false);
  });

  test('JSON valide mais sans champ "cartes" -> rejeté', () => {
    const r = parserReponseModele(JSON.stringify({ autre_chose: [] }));
    assert.equal(r.ok, false);
  });

  test('JSON malformé -> rejeté sans exception', () => {
    const r = parserReponseModele('{ "cartes": [ incomplet');
    assert.equal(r.ok, false);
  });
});

describe('verifierContreCorrecteur — zéro tolérance', () => {
  test('carte numérique cohérente avec son unité -> acceptée', () => {
    const r = verifierContreCorrecteur({
      profil_correction: 'numerique',
      reponse: '40 m²',
      reponses_acceptees: ['40 m²', '40'],
      unite: 'm²',
    });
    assert.equal(r.ok, true);
  });

  test('carte numérique avec une unité dans la réponse mais SANS le champ "unite" déclaré -> rejetée par le correcteur lui-même', () => {
    // Confirme que la règle 4 du prompt (unité obligatoire) est bien APPLIQUÉE, pas
    // seulement demandée poliment : evaluerNumerique(), unite=null, traite tout
    // reliquat alphabétique dans la réponse comme "aucune unité n'était exigée mais
    // il y en a une -> faux" (voir fonda/engine/correction.js, dernière ligne de
    // evaluerNumerique). Une carte qui oublie "unite" est donc rejetée AVANT même
    // la relecture humaine, pas seulement documentée comme suspecte.
    const r = verifierContreCorrecteur({
      profil_correction: 'numerique',
      reponse: '40 m²',
      reponses_acceptees: ['40 m²'],
      unite: undefined,
    });
    assert.equal(r.ok, false);
  });

  test('carte numérique dont la réponse ne correspond PAS à reponses_acceptees -> rejetée', () => {
    const r = verifierContreCorrecteur({
      profil_correction: 'numerique',
      reponse: '41 m²',
      reponses_acceptees: ['40 m²', '40'],
      unite: 'm²',
    });
    assert.equal(r.ok, false);
    assert.match(r.raison, /ne valide pas/);
  });

  test('carte profil "exact" incohérente (casse/forme différente non listée) -> rejetée', () => {
    const r = verifierContreCorrecteur({
      profil_correction: 'exact',
      reponse: 'B',
      reponses_acceptees: ['A'],
      unite: null,
    });
    assert.equal(r.ok, false);
  });

  test('profil_correction invalide/inconnu -> rejetée (jamais une fausse réussite)', () => {
    const r = verifierContreCorrecteur({
      profil_correction: 'inconnu',
      reponse: 'X',
      reponses_acceptees: ['X'],
      unite: null,
    });
    assert.equal(r.ok, false);
  });
});

describe('construireCandidats — dérivation G4 (jamais confiance au contenu modèle)', () => {
  test('set_id/item_id/relecteur dérivés du référentiel, jamais du modèle', () => {
    const cartesBrutes = [
      { question: 'Q1', reponse: 'R1', difficulte: 'facile', profil_correction: 'numerique', reponses_acceptees: ['R1'], contexte: 'ctx-1' },
      { question: 'Q2', reponse: 'R2', difficulte: 'moyen', profil_correction: 'exact', reponses_acceptees: ['R2'], contexte: 'ctx-2' },
    ];
    const candidats = construireCandidats({ notion: NOTION_MATHS, palier: 'nI', cartesBrutes, sequence: 1, ts: '2026-10-10T00:00:00.000Z' });

    assert.equal(candidats.length, 2);
    candidats.forEach((c, i) => {
      assert.equal(c.notion_id, 'maths.geometrie');
      assert.equal(c.matiere, 'maths');
      assert.equal(c.relecteur, 'eric'); // dérivé, pas lu sur une carte brute qui n'a même pas ce champ.
      assert.equal(c.palier, 'nI');
      assert.equal(c.statut, 'attente');
      assert.equal(c.item_id, i === 0 ? 'it01' : 'it02');
      assert.match(c.set_id, /^set_fonda_geometrie_nI_\d{2}$/);
    });
  });

  test('un champ "relecteur" ou "matiere" injecté dans une carte brute (si jamais le modèle en produisait un) est ignoré — la dérivation l\'écrase toujours', () => {
    const cartesBrutes = [
      { question: 'Q1', reponse: 'R1', difficulte: 'facile', profil_correction: 'numerique', reponses_acceptees: ['R1'], contexte: 'ctx-1', relecteur: 'justine', matiere: 'français' },
    ];
    const candidats = construireCandidats({ notion: NOTION_MATHS, palier: 'nI', cartesBrutes, sequence: 1, ts: '2026-10-10T00:00:00.000Z' });
    assert.equal(candidats[0].relecteur, 'eric'); // PAS "justine" — la fonction ne lit même pas ce champ en entrée.
    assert.equal(candidats[0].matiere, 'maths'); // PAS "français".
  });
});

describe('construireFichierBoxSelect — format décision (b)', () => {
  const candidatsExemple = [
    { relecteur: 'eric', palier: 'nI', numero: 1, question: 'Q1 ?', reponse: 'R1', difficulte: 'facile', profil_correction: 'numerique', reponses_acceptees: ['R1'], unite: 'm²', contexte: 'ctx-1', set_id: 'set_fonda_geometrie_nI_01', item_id: 'it01', notion_id: 'maths.geometrie' },
    { relecteur: 'eric', palier: 'nI', numero: 2, question: 'Q2 ?', reponse: 'R2', difficulte: 'moyen', profil_correction: 'exact', reponses_acceptees: ['R2'], contexte: 'ctx-2', set_id: 'set_fonda_geometrie_nI_01', item_id: 'it02', notion_id: 'maths.geometrie' },
  ];

  test('fichier produit a le format box-select (numero/question/reponse/difficulte) + marquage FONDA', () => {
    const fichier = construireFichierBoxSelect({ notion: NOTION_MATHS, palier: 'nI', candidats: candidatsExemple, destinataires: DESTINATAIRES_TEST });

    assert.equal(fichier.type, 'fonda');
    assert.equal(fichier.revue_carte_par_carte, false);
    assert.equal(fichier.nb_cartes, 2);
    assert.equal(fichier.prof_email, 'duchateauphysiquechimie@gmail.com'); // routé via destinataires.relecteurs.eric
    assert.match(fichier.code_suppression, /^SUP-/);
    assert.match(fichier.id, /^box_/);

    fichier.cartes.forEach((c, i) => {
      // Champs lus par box-select/Construire page selection — jamais renommés.
      assert.equal(c.numero, i + 1);
      assert.ok(c.question);
      assert.ok(c.reponse);
      assert.ok(['facile', 'moyen', 'difficile'].includes(c.difficulte));
      // Champs FONDA supplémentaires — transportés, pas lus par box-select, mais présents.
      assert.equal(c.palier, 'nI');
      assert.ok(c.profil_correction);
      assert.ok(Array.isArray(c.reponses_acceptees));
      assert.ok(c.set_id);
      assert.ok(c.item_id);
      assert.equal(c.notion_id, 'maths.geometrie');
    });
  });

  test('routage vers justine pour une notion français', () => {
    const notionFr = { ...NOTION_MATHS, id: 'fr.lexique', matiere: 'français', relecteur: 'justine' };
    const candidatsFr = candidatsExemple.map((c) => ({ ...c, relecteur: 'justine', notion_id: 'fr.lexique' }));
    const fichier = construireFichierBoxSelect({ notion: notionFr, palier: 'nI', candidats: candidatsFr, destinataires: DESTINATAIRES_TEST });
    assert.equal(fichier.prof_email, 'ericdnews@yahoo.fr'); // adresse de TEST de Justine, comme prévu avant mise en service réelle.
  });

  test('destinataires.relecteurs incomplet (email manquant) -> exception explicite, jamais un envoi vers undefined', () => {
    assert.throws(() => {
      construireFichierBoxSelect({ notion: NOTION_MATHS, palier: 'nI', candidats: candidatsExemple, destinataires: { relecteurs: {} } });
    }, /email manquant/);
  });
});

describe('estNotionExclue — périmètre figures géré en amont, pas seulement par le prompt', () => {
  test('maths.geometrie est exclue', () => {
    assert.equal(estNotionExclue('maths.geometrie'), true);
  });

  test('une notion ordinaire (texte seul) n\'est pas exclue', () => {
    assert.equal(estNotionExclue('maths.proportionnalite'), false);
    assert.equal(estNotionExclue('fr.lexique'), false);
  });
});

describe('construirePrompt — points de vigilance (règle 1 réponse courte, règle 8 micro-compétence)', () => {
  const args = {
    notion: NOTION_MATHS,
    palier: 'nI',
    nCartes: 4,
    contextesDejaUtilises: [],
  };

  test('la règle "réponse courte" est bien la règle 1 (la plus visible), pas noyée en bas', () => {
    const prompt = construirePrompt(args);
    const indexRegle1 = prompt.indexOf('1. RÉPONSE TRÈS COURTE OBLIGATOIRE');
    const indexRegle2 = prompt.indexOf('2. ÉNONCÉ DÉTERMINÉ');
    assert.ok(indexRegle1 > -1, 'règle 1 "réponse courte" absente ou mal numérotée');
    assert.ok(indexRegle1 < indexRegle2, 'la règle réponse courte doit précéder les autres règles numérotées');
  });

  test('la règle 8 (mobiliser réellement la micro-compétence) est présente avec l\'exemple du défaut "changer de représentation"', () => {
    const prompt = construirePrompt(args);
    assert.match(prompt, /MOBILISER LA MICRO-COMPÉTENCE/);
    assert.match(prompt, /changer de représentation/);
  });

  test('MODELE est un identifiant Sonnet renseigné, distinct de "claude-sonnet-5-5" (rejeté comme invalide)', () => {
    const { MODELE } = require('./generer-lot-fonda.js');
    assert.match(MODELE, /^claude-sonnet-/);
    assert.notEqual(MODELE, 'claude-sonnet-5-5');
  });

  test('la définition du palier nF interdit explicitement la simple application directe (gradation nI/nF, retour de calibration)', () => {
    const prompt = construirePrompt({ ...args, palier: 'nF' });
    assert.match(prompt, /JAMAIS une simple application directe/);
    assert.match(prompt, /même geste qu.une carte nI/);
  });

  test('la règle "unité obligatoire" interdit explicitement le mélange d\'unités dans reponses_acceptees (retour de calibration : "600 mL" rejeté quand unite="L")', () => {
    const prompt = construirePrompt(args);
    assert.match(prompt, /UNIQUE/);
    assert.match(prompt, /une seule unité par carte/);
    assert.match(prompt, /0,6 L.*600 mL/);
  });

  test('contextesAutresPaliers (contextes déjà utilisés dans l\'autre palier nI/nF) apparaissent dans l\'interdiction de réutilisation', () => {
    const prompt = construirePrompt({ ...args, contextesAutresPaliers: ['recette-riz-portions', 'carnet-billets-concert'] });
    assert.match(prompt, /recette-riz-portions/);
    assert.match(prompt, /carnet-billets-concert/);
    assert.match(prompt, /dans ce lot ET dans l'autre palier/);
  });
});
