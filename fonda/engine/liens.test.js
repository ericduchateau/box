// Suite de tests — liens par classe + résolution de défi, Box-FONDA (T4).
// Référence : docs/PRD-Box-FONDA.md §3.3, §4, §6 ; AGENTS.md G1/G7.
// Écrite AVANT l'implémentation (fonda/engine/liens.js), conformément à la méthode
// imposée. Zéro dépendance : test runner natif Node.
//
// Usage : node --test fonda/engine/liens.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  extraireNotionSlug,
  classesDuNiveau,
  genererDefiId,
  genererLiensNiveau,
  resoudreContexteDefi,
} = require('./liens.js');
const { parserDefiId, extraireGrpDepuisDefiId } = require('./evenements.js');

const CLASSES = require('../data/classes.json');
const REFERENTIEL = require('../data/referentiel.json');

// --- Fixture calendrier synthétique (PRD §3.3) — calendar.json réel est vide tant
// que le Moteur A (Lot 2) n'existe pas ; cette fixture simule une semaine programmée.
const SEMAINE_41 = {
  iso_week: 41,
  du: '2026-10-05',
  au: '2026-10-11',
  entrees: [
    { defi_id: null, notion_id: 'maths.resolution-problemes', matiere: 'maths', palier: 'nI', niveau_cible: '6e', set_id: 'box_fonda_test01' },
    { defi_id: null, notion_id: 'fr.orthographe', matiere: 'français', palier: 'nF', niveau_cible: '5e', set_id: 'box_fonda_test05' },
  ],
};
const CALENDRIER = { version: 1, last_updated: '2026-10-05', semaines: [SEMAINE_41] };

describe('extraireNotionSlug — dérivé du vrai notion_id (référentiel), jamais fabriqué', () => {
  test('extrait la partie après le premier point', () => {
    assert.equal(extraireNotionSlug('maths.resolution-problemes'), 'resolution-problemes');
    assert.equal(extraireNotionSlug('fr.orthographe'), 'orthographe');
  });

  test('tous les notion_id du vrai référentiel produisent un slug non vide', () => {
    for (const n of REFERENTIEL.notions) {
      assert.ok(extraireNotionSlug(n.id), `notion_id="${n.id}"`);
    }
  });

  test('forme invalide -> null, jamais d\'exception', () => {
    assert.equal(extraireNotionSlug('sans-point'), null);
    assert.equal(extraireNotionSlug(''), null);
    assert.equal(extraireNotionSlug(undefined), null);
  });
});

describe('classesDuNiveau — filtre classes.json (liste fermée), jamais une classe hors roster', () => {
  test('niveau 6e -> exactement 601..605, dans le vrai classes.json', () => {
    const classes = classesDuNiveau('6e', CLASSES);
    assert.deepEqual(classes, ['601', '602', '603', '604', '605']);
  });

  test('chaque classe retournée, pour chaque niveau, appartient à CLASSES (classes.json)', () => {
    const CLASSES_SET = new Set(CLASSES);
    for (const niveau of ['6e', '5e', '4e', '3e']) {
      for (const grp of classesDuNiveau(niveau, CLASSES)) {
        assert.ok(CLASSES_SET.has(grp), `grp="${grp}" hors classes.json`);
      }
    }
  });

  test('niveau inconnu -> tableau vide, jamais d\'exception', () => {
    assert.deepEqual(classesDuNiveau('6eme', CLASSES), []);
    assert.deepEqual(classesDuNiveau(undefined, CLASSES), []);
  });
});

describe('genererDefiId — conforme au format imposé, parsable par evenements.js (contrat T3)', () => {
  test('forme exacte', () => {
    assert.equal(
      genererDefiId({ annee: '2026', semaine: '41', grp: '601', notionSlug: 'resolution-problemes' }),
      'defi_2026-w41_601_resolution-problemes',
    );
  });

  test('round-trip : tout defi_id généré est reconnu par parserDefiId/extraireGrpDepuisDefiId de T3', () => {
    const defiId = genererDefiId({ annee: '2026', semaine: '41', grp: '602', notionSlug: 'orthographe' });
    assert.equal(extraireGrpDepuisDefiId(defiId), '602');
    assert.deepEqual(parserDefiId(defiId), { annee: '2026', semaine: '41', grp: '602', notionSlug: 'orthographe' });
  });
});

describe('cas 2 — niveau 6e : exactement 5 liens, un par classe 601..605, defi_id correct chacun', () => {
  test('5 liens, grp couvrant exactement 601..605, aucun doublon', () => {
    const liens = genererLiensNiveau({
      niveau: '6e',
      annee: '2026',
      semaine: '41',
      entreesNiveau: SEMAINE_41.entrees.filter((e) => e.niveau_cible === '6e'),
      classesAutorisees: CLASSES,
    });
    assert.equal(liens.length, 5);
    assert.deepEqual(liens.map((l) => l.grp).sort(), ['601', '602', '603', '604', '605']);
  });

  test('(cas 3) chaque grp produit appartient à classes.json — la liste fermée est respectée par construction', () => {
    const CLASSES_SET = new Set(CLASSES);
    const liens = genererLiensNiveau({
      niveau: '6e', annee: '2026', semaine: '41',
      entreesNiveau: SEMAINE_41.entrees.filter((e) => e.niveau_cible === '6e'),
      classesAutorisees: CLASSES,
    });
    for (const l of liens) assert.ok(CLASSES_SET.has(l.grp));
  });

  test('(cas 4) le defi_id de chaque lien est parsable et son grp/slug correspondent au référentiel', () => {
    const liens = genererLiensNiveau({
      niveau: '6e', annee: '2026', semaine: '41',
      entreesNiveau: SEMAINE_41.entrees.filter((e) => e.niveau_cible === '6e'),
      classesAutorisees: CLASSES,
    });
    for (const l of liens) {
      const parse = parserDefiId(l.defiId);
      assert.ok(parse, `defi_id "${l.defiId}" non parsable`);
      assert.equal(parse.grp, l.grp);
      assert.equal(parse.notionSlug, extraireNotionSlug(l.notionId));
      assert.ok(REFERENTIEL.notions.some((n) => n.id === l.notionId), `notion_id "${l.notionId}" absent du référentiel`);
    }
  });
});

describe('cas 5/6 — résolution d\'un lien de classe : grp hérité, jamais demandé ; contexte invalide -> entraînement', () => {
  test('un lien généré se résout en exactement le même contexte (grp hérité, jamais choisi)', () => {
    const liens = genererLiensNiveau({
      niveau: '6e', annee: '2026', semaine: '41',
      entreesNiveau: SEMAINE_41.entrees.filter((e) => e.niveau_cible === '6e'),
      classesAutorisees: CLASSES,
    });
    const lien = liens.find((l) => l.grp === '603');
    const resolu = resoudreContexteDefi({ defiId: lien.defiId, calendrier: CALENDRIER, classesAutorisees: CLASSES });
    assert.equal(resolu.valide, true);
    assert.equal(resolu.grp, '603'); // hérité du lien, pas demandé
    assert.equal(resolu.notionId, 'maths.resolution-problemes');
    assert.equal(resolu.palier, 'nI');
    assert.equal(resolu.setId, 'box_fonda_test01');
  });

  test('defi_id mal formé -> contexte invalide, mode entraînement', () => {
    const r = resoudreContexteDefi({ defiId: 'nimporte-quoi', calendrier: CALENDRIER, classesAutorisees: CLASSES });
    assert.equal(r.valide, false);
  });

  test('grp bien formé mais hors classes.json -> contexte invalide', () => {
    const r = resoudreContexteDefi({ defiId: 'defi_2026-w41_609_resolution-problemes', calendrier: CALENDRIER, classesAutorisees: CLASSES });
    assert.equal(r.valide, false);
  });

  test('semaine absente du calendrier -> contexte invalide (pas d\'occurrence fabriquée)', () => {
    const r = resoudreContexteDefi({ defiId: 'defi_2026-w52_601_resolution-problemes', calendrier: CALENDRIER, classesAutorisees: CLASSES });
    assert.equal(r.valide, false);
  });

  test('semaine connue mais slug/niveau sans entrée correspondante -> contexte invalide', () => {
    // "601" -> niveau 6e, mais le slug ne correspond à aucune entrée 6e de la semaine 41
    const r = resoudreContexteDefi({ defiId: 'defi_2026-w41_601_slug-inexistant', calendrier: CALENDRIER, classesAutorisees: CLASSES });
    assert.equal(r.valide, false);
  });

  test('calendrier vide (état réel actuel, avant Moteur A) -> toujours contexte invalide, jamais d\'exception', () => {
    const calendrierVide = { version: 1, last_updated: '', semaines: [] };
    assert.doesNotThrow(() => resoudreContexteDefi({ defiId: 'defi_2026-w41_601_resolution-problemes', calendrier: calendrierVide, classesAutorisees: CLASSES }));
    const r = resoudreContexteDefi({ defiId: 'defi_2026-w41_601_resolution-problemes', calendrier: calendrierVide, classesAutorisees: CLASSES });
    assert.equal(r.valide, false);
  });

  test('entrée d\'un AUTRE niveau avec le même slug ne doit pas valider un grp qui n\'est pas du bon niveau', () => {
    // la notion fr.orthographe est programmée pour 5e dans la fixture, pas pour 6e
    const r = resoudreContexteDefi({ defiId: 'defi_2026-w41_601_orthographe', calendrier: CALENDRIER, classesAutorisees: CLASSES });
    assert.equal(r.valide, false);
  });
});

// --- Calendrier v2 : bandes de niveaux et entrées planifiées (sans set_id) ---------
const {
  BANDES, niveauxDeLaBande, bandeDuNiveau, classesDeLaBande, entreeConcerneNiveau, entreeALien,
} = require('./liens.js');

const SEMAINE_45_V2 = {
  iso_week: 45,
  du: '2026-11-02',
  au: '2026-11-06',
  periode_id: 'P2',
  entrees: [
    { notion_id: 'maths.grandeurs-mesures', matiere: 'maths', palier: 'nI', bande: 'c4-milieu', statut: 'publie', set_id: 'set_fonda_grandeurs-mesures_nI_02', difficulte: { valeur: 'rouge', source: 'priorite_initiale' } },
    { notion_id: 'fr.comprendre-consigne', matiere: 'français', palier: 'nI', bande: 'c4-milieu', statut: 'planifie', difficulte: { valeur: 'rouge', source: 'priorite_initiale' } },
  ],
};
const CALENDRIER_V2 = { version: 2, semaines: [SEMAINE_45_V2] };

describe('bandes — c3 = 6e, c4-milieu = 5e + 4e, c4-fin = 3e (classes déduites de classes.json)', () => {
  test('correspondance bande <-> classes conforme au découpage validé', () => {
    assert.deepEqual(classesDeLaBande('c3', CLASSES), ['601', '602', '603', '604', '605']);
    assert.deepEqual(classesDeLaBande('c4-milieu', CLASSES), ['401', '402', '403', '404', '405', '501', '502', '503', '504', '505']);
    assert.deepEqual(classesDeLaBande('c4-fin', CLASSES), ['301', '302', '303', '304', '305']);
    assert.deepEqual(classesDeLaBande('inconnue', CLASSES), []);
  });

  test('garde : chaque classe de classes.json appartient à UNE ET UNE SEULE bande', () => {
    for (const grp of CLASSES) {
      const bandes = Object.keys(BANDES).filter((b) => classesDeLaBande(b, CLASSES).includes(grp));
      assert.equal(bandes.length, 1, `classe ${grp} : ${bandes.length} bande(s)`);
    }
  });

  test('bandeDuNiveau / niveauxDeLaBande, et BANDES gelé', () => {
    assert.equal(bandeDuNiveau('5e'), 'c4-milieu');
    assert.equal(bandeDuNiveau('4e'), 'c4-milieu');
    assert.equal(bandeDuNiveau('6e'), 'c3');
    assert.equal(bandeDuNiveau('3e'), 'c4-fin');
    assert.equal(bandeDuNiveau('2nde'), null);
    assert.deepEqual(niveauxDeLaBande('c4-milieu'), ['5e', '4e']);
    assert.deepEqual(niveauxDeLaBande('__proto__'), []);
    assert.ok(Object.isFrozen(BANDES) && Object.isFrozen(BANDES['c4-milieu']));
  });

  test('entreeConcerneNiveau : bande (v2) ou niveau_cible (v1, conservé)', () => {
    const e = SEMAINE_45_V2.entrees[0];
    assert.equal(entreeConcerneNiveau(e, '5e'), true);
    assert.equal(entreeConcerneNiveau(e, '4e'), true);
    assert.equal(entreeConcerneNiveau(e, '6e'), false);
    assert.equal(entreeConcerneNiveau(SEMAINE_41.entrees[0], '6e'), true);
    assert.equal(entreeConcerneNiveau(null, '6e'), false);
  });
});

describe('entrée planifiée (sans set_id) : jamais de lien, jamais de défi résolu', () => {
  test('entreeALien : vrai seulement avec un set_id non vide', () => {
    assert.equal(entreeALien(SEMAINE_45_V2.entrees[0]), true);
    assert.equal(entreeALien(SEMAINE_45_V2.entrees[1]), false);
    assert.equal(entreeALien({ set_id: '' }), false);
    assert.equal(entreeALien(SEMAINE_41.entrees[0]), true, 'entrée v1 sans statut : acceptée');
  });

  test('défense en profondeur : statut « planifie » refusé même avec un set_id (donnée contradictoire)', () => {
    const contradictoire = { ...SEMAINE_45_V2.entrees[0], statut: 'planifie' };
    assert.equal(entreeALien(contradictoire), false);
    const cal = { version: 2, semaines: [{ ...SEMAINE_45_V2, entrees: [contradictoire] }] };
    assert.equal(resoudreContexteDefi({ defiId: 'defi_2026-w45_402_grandeurs-mesures', calendrier: cal, classesAutorisees: CLASSES }).valide, false);
    assert.equal(genererLiensNiveau({ niveau: '4e', annee: '2026', semaine: '45', entreesNiveau: [contradictoire], classesAutorisees: CLASSES }).length, 0);
  });

  test('genererLiensNiveau ignore l\'entrée planifiée : liens pour la seule fiche publiée, 5 classes de 5e', () => {
    const liens = genererLiensNiveau({
      niveau: '5e', annee: '2026', semaine: '45',
      entreesNiveau: SEMAINE_45_V2.entrees.filter((e) => entreeConcerneNiveau(e, '5e')),
      classesAutorisees: CLASSES,
    });
    assert.equal(liens.length, 5);
    assert.ok(liens.every((l) => l.setId === 'set_fonda_grandeurs-mesures_nI_02'));
  });

  test('resoudreContexteDefi : 4e résolue par la bande ; l\'entrée planifiée reste invalide', () => {
    const ok = resoudreContexteDefi({ defiId: 'defi_2026-w45_402_grandeurs-mesures', calendrier: CALENDRIER_V2, classesAutorisees: CLASSES });
    assert.deepEqual(ok, { valide: true, grp: '402', notionId: 'maths.grandeurs-mesures', palier: 'nI', setId: 'set_fonda_grandeurs-mesures_nI_02' });
    const planifiee = resoudreContexteDefi({ defiId: 'defi_2026-w45_402_comprendre-consigne', calendrier: CALENDRIER_V2, classesAutorisees: CLASSES });
    assert.equal(planifiee.valide, false);
    const autreBande = resoudreContexteDefi({ defiId: 'defi_2026-w45_601_grandeurs-mesures', calendrier: CALENDRIER_V2, classesAutorisees: CLASSES });
    assert.equal(autreBande.valide, false);
  });
});
