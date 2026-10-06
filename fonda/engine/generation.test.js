// Suite de tests — chaîne de génération assistée + dépôt en file de relecture (T6).
// Écrite AVANT fonda/engine/generation.js (TDD, comme pour T2/T3/T5). Zéro dépendance,
// test runner natif Node.
//
// Usage : node --test fonda/engine/generation.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  genererSetId,
  genererItemId,
  relecteurDepuisMatiere,
  validerCandidate,
  validerJeu,
  deposerEnRelecture,
} = require('./generation.js');

const CANDIDATE_VALIDE = Object.freeze({
  set_id: 'set_fonda_geometrie_nI_01',
  item_id: 'it01',
  notion_id: 'maths.geometrie',
  matiere: 'maths',
  relecteur: 'eric',
  palier: 'nI',
  difficulte: 'facile',
  question: 'Un rectangle mesure 5 cm sur 3 cm. Quelle est son aire ?',
  reponse: '15 cm²',
  profil_correction: 'numerique',
  reponses_acceptees: ['15 cm²', '15'],
  seconde_chance: false,
  statut: 'attente',
  source: 'T6-pilote',
  ts: '2026-10-06T10:00:00.000Z',
  contexte: 'jardin-rectangulaire',
});

describe('genererSetId — motif système ^set_fonda_[a-z0-9-]+_n[IF]_\\d{2}$', () => {
  test('notion_id + palier + séquence -> id conforme', () => {
    assert.equal(genererSetId('maths.geometrie', 'nI', 1), 'set_fonda_geometrie_nI_01');
    assert.equal(genererSetId('fr.comprendre-consigne', 'nF', 12), 'set_fonda_comprendre-consigne_nF_12');
  });

  test('jamais dérivé du texte de la carte : seul (notion_id, palier, séquence) entre en jeu', () => {
    assert.equal(genererSetId('maths.geometrie', 'nI', 1), genererSetId('maths.geometrie', 'nI', 1));
  });

  test('notion_id malformé, palier invalide ou séquence invalide -> null (jamais d\'exception)', () => {
    assert.equal(genererSetId('texte libre', 'nI', 1), null);
    assert.equal(genererSetId('maths.geometrie', 'n0', 1), null);
    assert.equal(genererSetId('maths.geometrie', 'nI', 0), null);
    assert.equal(genererSetId('maths.geometrie', 'nI', 100), null);
    assert.equal(genererSetId(null, 'nI', 1), null);
  });
});

describe('genererItemId — motif système ^it\\d{2}$', () => {
  test('index -> id 2 chiffres', () => {
    assert.equal(genererItemId(1), 'it01');
    assert.equal(genererItemId(8), 'it08');
    assert.equal(genererItemId(12), 'it12');
  });

  test('index invalide -> null', () => {
    assert.equal(genererItemId(0), null);
    assert.equal(genererItemId(100), null);
    assert.equal(genererItemId('1'), null);
    assert.equal(genererItemId(null), null);
  });
});

describe('relecteurDepuisMatiere — routage G4/§12, même table que validate.js', () => {
  test('français -> justine, maths -> eric', () => {
    assert.equal(relecteurDepuisMatiere('français'), 'justine');
    assert.equal(relecteurDepuisMatiere('maths'), 'eric');
  });

  test('matiere inconnue -> null', () => {
    assert.equal(relecteurDepuisMatiere('anglais'), null);
    assert.equal(relecteurDepuisMatiere(undefined), null);
  });
});

describe('validerCandidate — schéma candidate (PRD §3.6 + §5.1, ids système T6)', () => {
  test('une candidate conforme est valide', () => {
    const r = validerCandidate(CANDIDATE_VALIDE);
    assert.equal(r.valide, true, r.erreurs && r.erreurs.join(', '));
  });

  test('set_id hors motif (texte libre) -> invalide', () => {
    assert.equal(validerCandidate({ ...CANDIDATE_VALIDE, set_id: 'rectangle-de-pierre' }).valide, false);
    assert.equal(validerCandidate({ ...CANDIDATE_VALIDE, set_id: 'set_fonda_geometrie_nI_1' }).valide, false, 'séquence doit être 2 chiffres');
  });

  test('item_id hors motif (texte libre) -> invalide', () => {
    assert.equal(validerCandidate({ ...CANDIDATE_VALIDE, item_id: 'carte-aire-rectangle' }).valide, false);
    assert.equal(validerCandidate({ ...CANDIDATE_VALIDE, item_id: 'it1' }).valide, false, '1 chiffre insuffisant');
  });

  test('notion_id absent du référentiel (si notionIdsConnus fourni) -> invalide', () => {
    const notionIds = new Set(['maths.geometrie']);
    assert.equal(validerCandidate(CANDIDATE_VALIDE, { notionIdsConnus: notionIds }).valide, true);
    assert.equal(
      validerCandidate({ ...CANDIDATE_VALIDE, notion_id: 'maths.inexistante' }, { notionIdsConnus: notionIds }).valide,
      false,
    );
  });

  test('relecteur incohérent avec matiere -> invalide (protège le routage G4)', () => {
    assert.equal(validerCandidate({ ...CANDIDATE_VALIDE, matiere: 'français', relecteur: 'eric' }).valide, false);
    assert.equal(validerCandidate({ ...CANDIDATE_VALIDE, matiere: 'maths', relecteur: 'justine' }).valide, false);
  });

  test('palier hors {nI, nF} -> invalide ("n0" interdit, AGENTS.md)', () => {
    assert.equal(validerCandidate({ ...CANDIDATE_VALIDE, palier: 'n0' }).valide, false);
  });

  test('profil_correction hors {sens, orthographe, numerique, exact} -> invalide', () => {
    assert.equal(validerCandidate({ ...CANDIDATE_VALIDE, profil_correction: 'autre' }).valide, false);
  });

  test('difficulte hors {facile, moyen, difficile} (convention BOX existante) -> invalide', () => {
    assert.equal(validerCandidate({ ...CANDIDATE_VALIDE, difficulte: 'extreme' }).valide, false);
  });

  test('reponses_acceptees doit être un tableau non vide de chaînes', () => {
    assert.equal(validerCandidate({ ...CANDIDATE_VALIDE, reponses_acceptees: [] }).valide, false);
    assert.equal(validerCandidate({ ...CANDIDATE_VALIDE, reponses_acceptees: 'x' }).valide, false);
  });

  test('statut hors {attente, validée, rejetée} -> invalide', () => {
    assert.equal(validerCandidate({ ...CANDIDATE_VALIDE, statut: 'publiée' }).valide, false);
  });

  test('contexte manquant -> invalide (condition nécessaire de l\'anti-clone, voir validerJeu)', () => {
    const { contexte, ...sansContexte } = CANDIDATE_VALIDE;
    assert.equal(validerCandidate(sansContexte).valide, false);
  });

  test('question/reponse manquantes -> invalide', () => {
    assert.equal(validerCandidate({ ...CANDIDATE_VALIDE, question: '' }).valide, false);
    assert.equal(validerCandidate({ ...CANDIDATE_VALIDE, reponse: '' }).valide, false);
  });
});

describe('validerJeu — anti-clone : condition NÉCESSAIRE mais PAS SUFFISANTE de variété', () => {
  test('contextes deux-à-deux distincts -> valide', () => {
    const jeu = [
      { ...CANDIDATE_VALIDE, item_id: 'it01', contexte: 'jardin-rectangulaire' },
      { ...CANDIDATE_VALIDE, item_id: 'it02', contexte: 'salon-a-carreler' },
      { ...CANDIDATE_VALIDE, item_id: 'it03', contexte: 'terrain-de-sport' },
    ];
    assert.equal(validerJeu(jeu).valide, true);
  });

  test('deux cartes au même contexte -> invalide (anti-clone)', () => {
    const jeu = [
      { ...CANDIDATE_VALIDE, item_id: 'it01', contexte: 'jardin-rectangulaire' },
      { ...CANDIDATE_VALIDE, item_id: 'it02', contexte: 'jardin-rectangulaire' },
    ];
    assert.equal(validerJeu(jeu).valide, false);
  });

  test('ne prouve PAS la diversité réelle du contenu : deux questions quasi identiques mais contexte distinct passent', () => {
    const jeu = [
      { ...CANDIDATE_VALIDE, item_id: 'it01', contexte: 'jardin-rectangulaire', question: 'Un rectangle 5x3, aire ?' },
      { ...CANDIDATE_VALIDE, item_id: 'it02', contexte: 'salon-a-carreler', question: 'Un rectangle 5x3, aire ?' },
    ];
    // Documenté comme limite assumée : validerJeu ne lit pas `question`, seulement
    // `contexte`. La vraie diversité pédagogique reste jugée à la relecture humaine.
    assert.equal(validerJeu(jeu).valide, true);
  });

  test('jeu vide ou non-tableau -> invalide, jamais d\'exception', () => {
    assert.equal(validerJeu([]).valide, false);
    assert.equal(validerJeu(null).valide, false);
    assert.equal(validerJeu('x').valide, false);
  });
});

// Fixture référentiel RÉEL (sous-ensemble) — seule source de vérité pour matiere/
// relecteur au dépôt (T6a). Ne PAS lire matiere/relecteur depuis la candidate.
const NOTIONS_FIXTURE = Object.freeze([
  Object.freeze({ id: 'maths.geometrie', matiere: 'maths', relecteur: 'eric' }),
  Object.freeze({ id: 'fr.lexique', matiere: 'français', relecteur: 'justine' }),
]);

describe('deposerEnRelecture — routage par relecteur (G4/§12), IMPRENABLE (T6a), jamais d\'exception', () => {
  test('partitionne les candidates valides par relecteur (dérivé du référentiel)', () => {
    const justineCard = {
      ...CANDIDATE_VALIDE,
      set_id: 'set_fonda_lexique_nI_01',
      notion_id: 'fr.lexique',
      matiere: 'français',
      relecteur: 'justine',
      item_id: 'it02',
    };
    const r = deposerEnRelecture([CANDIDATE_VALIDE, justineCard], { notions: NOTIONS_FIXTURE });
    assert.equal(r.total, 2);
    assert.equal(r.parRelecteur.eric.length, 1);
    assert.equal(r.parRelecteur.justine.length, 1);
    assert.equal(r.invalides.length, 0);
  });

  test('une candidate invalide est écartée dans invalides, jamais incluse silencieusement', () => {
    const invalide = { ...CANDIDATE_VALIDE, set_id: 'texte-libre' };
    const r = deposerEnRelecture([CANDIDATE_VALIDE, invalide], { notions: NOTIONS_FIXTURE });
    assert.equal(r.total, 1);
    assert.equal(r.invalides.length, 1);
    assert.equal(r.invalides[0].index, 1);
  });

  test('entrée non-tableau ou vide -> jamais d\'exception, résultat vide', () => {
    assert.deepEqual(deposerEnRelecture(null, { notions: NOTIONS_FIXTURE }).parRelecteur, { justine: [], eric: [] });
    assert.equal(deposerEnRelecture(undefined, { notions: NOTIONS_FIXTURE }).total, 0);
    assert.equal(deposerEnRelecture([], { notions: NOTIONS_FIXTURE }).total, 0);
  });

  test('`notions` absent/vide -> tout est rejeté (échoue fermé, jamais de routage par défaut)', () => {
    const r1 = deposerEnRelecture([CANDIDATE_VALIDE]);
    assert.equal(r1.total, 0);
    assert.equal(r1.invalides.length, 1);
    const r2 = deposerEnRelecture([CANDIDATE_VALIDE], { notions: [] });
    assert.equal(r2.total, 0);
  });

  test('G4 — statut entrant "validée" (ou "rejetée") est FORCÉ à "attente" au dépôt', () => {
    const preValidee = { ...CANDIDATE_VALIDE, statut: 'validée' };
    const r = deposerEnRelecture([preValidee], { notions: NOTIONS_FIXTURE });
    assert.equal(r.total, 1);
    assert.equal(r.parRelecteur.eric[0].statut, 'attente');

    const preRejetee = { ...CANDIDATE_VALIDE, statut: 'rejetée' };
    const r2 = deposerEnRelecture([preRejetee], { notions: NOTIONS_FIXTURE });
    assert.equal(r2.parRelecteur.eric[0].statut, 'attente');
  });

  test('G4 — matiere/relecteur sont DÉRIVÉS du référentiel via notion_id, jamais lus depuis la candidate', () => {
    // Candidate interne cohérente (français/justine) mais FORGÉE sur une notion maths.
    const forgee = { ...CANDIDATE_VALIDE, matiere: 'français', relecteur: 'justine' };
    const r = deposerEnRelecture([forgee], { notions: NOTIONS_FIXTURE });
    assert.equal(r.total, 1);
    // Routée chez Éric (référentiel), PAS Justine (déclaration de la candidate ignorée).
    assert.equal(r.parRelecteur.eric.length, 1);
    assert.equal(r.parRelecteur.justine.length, 0);
    assert.equal(r.parRelecteur.eric[0].matiere, 'maths');
    assert.equal(r.parRelecteur.eric[0].relecteur, 'eric');
  });

  test('G4 — notion_id absent du référentiel fourni -> rejet (jamais de routage par défaut)', () => {
    const inconnue = { ...CANDIDATE_VALIDE, notion_id: 'maths.inexistante', set_id: 'set_fonda_inexistante_nI_01' };
    const r = deposerEnRelecture([inconnue], { notions: NOTIONS_FIXTURE });
    assert.equal(r.total, 0);
    assert.equal(r.invalides.length, 1);
  });

  test('set_id incohérent avec notion_id/palier -> rejet', () => {
    const paliersIncoherents = { ...CANDIDATE_VALIDE, set_id: 'set_fonda_geometrie_nF_01' }; // palier déclaré nI
    const r1 = deposerEnRelecture([paliersIncoherents], { notions: NOTIONS_FIXTURE });
    assert.equal(r1.total, 0);

    const autreNotion = { ...CANDIDATE_VALIDE, set_id: 'set_fonda_lexique_nI_01' }; // notion déclarée maths.geometrie
    const r2 = deposerEnRelecture([autreNotion], { notions: NOTIONS_FIXTURE });
    assert.equal(r2.total, 0);
  });

  test('unicité (set_id, item_id) dans le lot déposé — le doublon (pas le premier) est rejeté', () => {
    const doublon = { ...CANDIDATE_VALIDE }; // même set_id/item_id que CANDIDATE_VALIDE
    const r = deposerEnRelecture([CANDIDATE_VALIDE, doublon], { notions: NOTIONS_FIXTURE });
    assert.equal(r.total, 1);
    assert.equal(r.invalides.length, 1);
    assert.equal(r.invalides[0].index, 1);
  });

  test('les candidates déposées sont gelées en PROFONDEUR (candidate + reponses_acceptees)', () => {
    const r = deposerEnRelecture([CANDIDATE_VALIDE], { notions: NOTIONS_FIXTURE });
    assert.throws(() => { r.parRelecteur.eric[0].question = 'autre chose'; }, /read.only|frozen|Cannot assign/i);
    assert.throws(() => { r.parRelecteur.eric[0].reponses_acceptees.push('autre'); }, /read.only|frozen|Cannot add|not extensible/i);
  });

  test('muter le tableau reponses_acceptees D\'ORIGINE (passé par l\'appelant) ne mute PAS la candidate déposée', () => {
    const original = { ...CANDIDATE_VALIDE, reponses_acceptees: ['15 cm²', '15'] };
    const r = deposerEnRelecture([original], { notions: NOTIONS_FIXTURE });
    original.reponses_acceptees.push('valeur ajoutée après coup');
    assert.deepEqual(r.parRelecteur.eric[0].reponses_acceptees, ['15 cm²', '15']);
  });
});
