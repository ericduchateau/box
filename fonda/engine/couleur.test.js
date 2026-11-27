// Suite de tests — Moteur A, module 2 : couleur par (notion, palier).
// Référence : docs/SPEC-moteur-a.md §2, §3 et §3 bis ; PRD §10. Écrite AVANT l'implémentation
// (fonda/engine/couleur.js), conformément à la méthode imposée (AGENTS.md, « tests d'abord »).
// Zéro dépendance : test runner natif Node. Fixtures synthétiques et anonymes uniquement.
//
// Contrat testé :
//   colorer({ agregation, referentiel }) -> {
//     periode_id,
//     couleurs: [ { notion_id, palier, couleur, source, taux_periode, seuil_atteint } ],
//     ignores: { hors_referentiel },
//   }
//   exports : colorer, SEUIL_VERT (0.75), SEUIL_AMBRE (0.5).
//
// Règles (décisions de l'architecte, 2026-11-27) :
//   - periode_id = agregation.periode_id (passe-plat).
//   - Une couleur pour CHAQUE (notion, palier) du référentiel : notion.id (champ réel de
//     referentiel.json, restitué sous le nom notion_id) × notion.paliers.
//   - Entrée d'agrégation (notion_id, palier) présente ET seuil_atteint :
//       vert si taux_periode >= SEUIL_VERT ; ambre si >= SEUIL_AMBRE ; rouge sinon ;
//       source "stats_cartes".
//   - Sinon (pas d'entrée, ou seuil non atteint) : couleur = notion.priorite_initiale, ou "gris"
//     si absente ; source "priorite_initiale". Pas de bascule sous 25 réponses, quel que soit le taux.
//   - taux_periode = celui de l'entrée (null si pas d'entrée) ; seuil_atteint = celui de l'entrée
//     (false si pas d'entrée).
//   - couleur ∈ {gris, vert, ambre, rouge} UNIQUEMENT (le ⬛ « trou » est le module 6) ;
//     source ∈ {stats_cartes, priorite_initiale}.
//   - ignores.hors_referentiel = nombre d'entrées d'agrégation dont (notion_id, palier) n'est
//     aucun (notion, palier) du référentiel ; elles ne produisent aucune couleur.
//   - Tri : notion_id par UNITÉS DE CODE (opérateur <, jamais localeCompare), puis nI avant nF.
//   - PURE : aucune I/O, aucune horloge, entrées non modifiées ; DÉTERMINISTE octet pour octet
//     quel que soit l'ordre des entrées d'agrégation et des notions.
//   - Entrées de CONFIANCE, fail-fast -> TypeError :
//       référentiel : notions non tableau, notion sans id chaîne, id en double, paliers hors
//         {nI, nF}, vides, creux ou en double, priorite_initiale hors {rouge, ambre, vert}
//         (absente admise -> gris ; "gris" ou "trou" explicites -> TypeError) ;
//       agrégation : entrees non tableau ; entrée non objet ; notion_id non chaîne ou vide ;
//         palier hors {nI, nF} ; seuil_atteint non booléen ; taux_periode ni null ni nombre fini
//         de [0, 1] ; seuil_atteint true avec taux null ; (notion_id, palier) en double.
//     Seule une entrée BIEN FORMÉE absente du référentiel compte dans hors_referentiel.
//
// Usage : node --test fonda/engine/couleur.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { colorer, SEUIL_VERT, SEUIL_AMBRE } = require('./couleur.js');
const { agreger } = require('./agregation.js');

// --- Fixtures ---------------------------------------------------------------

// notion(id) -> priorité 'ambre' ; notion(id, undefined) -> SANS priorite_initiale (le paramètre
// par défaut ne s'applique qu'à un argument omis : on regarde donc le nombre d'arguments).
function notion(id, ...reste) {
  const priorite_initiale = reste.length > 0 ? reste[0] : 'ambre';
  const paliers = reste.length > 1 ? reste[1] : ['nI', 'nF'];
  const n = { id, libelle: `Notion ${id}`, paliers, palier_amorce: 'nI' };
  if (priorite_initiale !== undefined) n.priorite_initiale = priorite_initiale;
  return n;
}

const REFERENTIEL = {
  version: '2.0',
  notions: [
    notion('maths.proportionnalite', 'rouge'),
    notion('fr.lexique', 'vert'),
  ],
};

// Entrée au format de sortie du module 1 (seuls notion_id, palier, taux_periode et
// seuil_atteint sont lus ; le reste est là pour la fidélité de forme).
function entree({ notion_id = 'maths.proportionnalite', palier = 'nI', n = 30, reussites = 24 } = {}) {
  return {
    notion_id, palier,
    n_reponses: n, n_reussites: reussites,
    taux_periode: n > 0 ? reussites / n : null,
    seuil_atteint: n >= 25,
    delta: { valeur: null, items_communs: 0, courante: { occurrence: '2026-w48', n_reponses: n, taux: n > 0 ? reussites / n : null }, precedente: null },
    cartes_rouges: [], cartes_insuffisantes: [],
    adoption: { df: n, maison: 0, classe: 0 },
  };
}

function agregation(entrees, periode_id = 'P2') {
  return { aujourdhui: '2026-12-04', periode_id, entrees, ignores: { futur: 0, invalide: 0, vacances: 0 } };
}

// Entrée au seuil avec un taux EXACT (n = 10 000 pour représenter 0.7499 et 0.4999).
function auTaux(taux, champs = {}) {
  const n = 10000;
  return { ...entree({ ...champs, n, reussites: Math.round(taux * n) }), taux_periode: taux };
}

const appel = (entrees, referentiel = REFERENTIEL, periode_id) =>
  colorer({ agregation: agregation(entrees, periode_id), referentiel });

function couleur(r, notion_id = 'maths.proportionnalite', palier = 'nI') {
  return r.couleurs.find((c) => c.notion_id === notion_id && c.palier === palier);
}

function geler(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) geler(v);
  }
  return o;
}

// --- Cadre --------------------------------------------------------------------

describe('couleur — cadre', () => {
  test('seuils exportés : vert = 0.75, ambre = 0.5 (PRD §10)', () => {
    assert.equal(SEUIL_VERT, 0.75);
    assert.equal(SEUIL_AMBRE, 0.5);
  });

  test('forme : clés exactes, dans cet ordre (sérialisation stable)', () => {
    const r = appel([entree()]);
    assert.deepEqual(Object.keys(r), ['periode_id', 'couleurs', 'ignores']);
    assert.deepEqual(Object.keys(r.ignores), ['hors_referentiel']);
    assert.deepEqual(Object.keys(r.couleurs[0]), ['notion_id', 'palier', 'couleur', 'source', 'taux_periode', 'seuil_atteint']);
  });

  test('periode_id passe-plat (y compris null)', () => {
    assert.equal(appel([], REFERENTIEL, 'P3').periode_id, 'P3');
    assert.equal(appel([], REFERENTIEL, null).periode_id, null);
  });

  test('aucune entrée : une couleur par (notion, palier) du référentiel, toutes en priorite_initiale', () => {
    assert.deepEqual(appel([]), {
      periode_id: 'P2',
      couleurs: [
        { notion_id: 'fr.lexique', palier: 'nI', couleur: 'vert', source: 'priorite_initiale', taux_periode: null, seuil_atteint: false },
        { notion_id: 'fr.lexique', palier: 'nF', couleur: 'vert', source: 'priorite_initiale', taux_periode: null, seuil_atteint: false },
        { notion_id: 'maths.proportionnalite', palier: 'nI', couleur: 'rouge', source: 'priorite_initiale', taux_periode: null, seuil_atteint: false },
        { notion_id: 'maths.proportionnalite', palier: 'nF', couleur: 'rouge', source: 'priorite_initiale', taux_periode: null, seuil_atteint: false },
      ],
      ignores: { hors_referentiel: 0 },
    });
  });

  test('pureté : entrées gelées acceptées et inchangées ; entrées non gelées inchangées', () => {
    const entrees = [entree(), entree({ palier: 'nF', n: 10, reussites: 1 }), entree({ notion_id: 'svt.cellule' })];
    const ref = JSON.parse(JSON.stringify(REFERENTIEL));
    ref.notions.reverse();
    const agr = agregation(entrees);
    const avant = structuredClone({ agr, ref });
    const r1 = JSON.stringify(colorer({ agregation: agr, referentiel: ref }));
    assert.deepEqual({ agr, ref }, avant); // non gelées : aucune écriture, aucun tri en place
    geler(agr); geler(ref);
    assert.equal(JSON.stringify(colorer({ agregation: agr, referentiel: ref })), r1);
  });

  test('aucune horloge : Date.now() et new Date() neutralisés, résultat identique', () => {
    const entrees = [entree(), entree({ notion_id: 'fr.lexique', n: 40, reussites: 10 })];
    const attendu = JSON.stringify(appel(entrees));
    const DateOrigine = globalThis.Date;
    const lue = () => { throw new Error('horloge lue'); };
    globalThis.Date = new Proxy(DateOrigine, {
      construct: lue, apply: lue,
      get(t, k, r) { return k === 'now' ? lue : Reflect.get(t, k, r); },
    });
    try { assert.equal(JSON.stringify(appel(entrees)), attendu); } finally { globalThis.Date = DateOrigine; }
  });

  test('déterminisme octet pour octet : ordre des entrées et des notions sans effet', () => {
    const entrees = [
      entree(), entree({ palier: 'nF', n: 26, reussites: 13 }),
      entree({ notion_id: 'fr.lexique', n: 12, reussites: 12 }), entree({ notion_id: 'svt.cellule' }),
    ];
    const refInverse = { ...REFERENTIEL, notions: [...REFERENTIEL.notions].reverse() };
    const ref = JSON.stringify(appel(entrees));
    assert.equal(JSON.stringify(appel([...entrees].reverse())), ref);
    assert.equal(JSON.stringify(appel(entrees, refInverse)), ref);
  });

  test('tri : notion_id par unités de code (\'fr.b\' < \'fr.b-c\' < \'fr.b0\' < \'maths.a\'), puis nI avant nF', () => {
    const ref = { notions: [notion('maths.a'), notion('fr.b0'), notion('fr.b-c', 'ambre', ['nF', 'nI']), notion('fr.b')] };
    assert.deepEqual(appel([], ref).couleurs.map((c) => [c.notion_id, c.palier]), [
      ['fr.b', 'nI'], ['fr.b', 'nF'], ['fr.b-c', 'nI'], ['fr.b-c', 'nF'],
      ['fr.b0', 'nI'], ['fr.b0', 'nF'], ['maths.a', 'nI'], ['maths.a', 'nF'],
    ]);
  });

  test('référentiel invalide : TypeError', () => {
    const ok = agregation([]);
    assert.throws(() => colorer({ agregation: { periode_id: 'P2' }, referentiel: REFERENTIEL }), TypeError);
    assert.throws(() => colorer({ agregation: ok, referentiel: {} }), TypeError);
    assert.throws(() => colorer({ agregation: ok, referentiel: { notions: [{ paliers: ['nI'] }] } }), TypeError);
    assert.throws(() => colorer({ agregation: ok, referentiel: { notions: [notion('fr.a', 'ambre', ['n0'])] } }), TypeError);
    assert.throws(() => colorer({ agregation: ok, referentiel: { notions: [notion('fr.a', 'ambre', [])] } }), TypeError);
    assert.throws(() => colorer({ agregation: ok, referentiel: { notions: [notion('fr.a', 'ambre', ['nI', 'nI'])] } }), TypeError);
    assert.throws(() => colorer({ agregation: ok, referentiel: { notions: [notion('fr.a'), notion('fr.a')] } }), TypeError);
    assert.throws(() => colorer({ agregation: ok, referentiel: { notions: [notion('fr.a', 'gris')] } }), TypeError);
    assert.throws(() => colorer({ agregation: ok, referentiel: { notions: [notion('fr.a', 'trou')] } }), TypeError);
    assert.throws(() => colorer({ agregation: ok, referentiel: { notions: [notion('fr.a', 'ambre', new Array(1))] } }), TypeError); // paliers creux
    assert.throws(() => colorer({ agregation: ok, referentiel: { notions: [notion('fr.a', 'ambre', ['nI', , 'nF'])] } }), TypeError); // eslint-disable-line no-sparse-arrays
  });

  test('agrégation invalide : TypeError (fail-fast, symétrique du référentiel)', () => {
    const sans = (cle) => { const e = entree(); delete e[cle]; return e; };
    const cas = [
      ['entree null', null],
      ['entree non objet', 42],
      ['entree vide', {}],
      ['notion_id vide', { ...entree(), notion_id: '' }],
      ['notion_id non chaîne', { ...entree(), notion_id: 42 }],
      ['palier n0 (malformé, pas « hors référentiel »)', { ...entree(), palier: 'n0' }],
      ['seuil_atteint = 1', { ...entree(), seuil_atteint: 1 }],
      ['seuil_atteint = "true"', { ...entree(), seuil_atteint: 'true' }],
      ['seuil_atteint absent', sans('seuil_atteint')],
      ['taux_periode = "0.8"', { ...entree(), taux_periode: '0.8' }],
      ['taux_periode = NaN', { ...entree(), taux_periode: NaN }],
      ['taux_periode = Infinity', { ...entree(), taux_periode: Infinity }],
      ['taux_periode = -1', { ...entree(), taux_periode: -1 }],
      ['taux_periode = 2', { ...entree(), taux_periode: 2 }],
      ['taux_periode absent', sans('taux_periode')],
      ['seuil atteint avec taux null', { ...entree(), taux_periode: null, seuil_atteint: true }],
      // Taux malformé SOUS le seuil : lève aussi (sous le seuil, seuls null ou [0, 1] sont valides).
      ['sous le seuil, taux = -0.1', { ...entree({ n: 10 }), taux_periode: -0.1 }],
      ['sous le seuil, taux = 1.5', { ...entree({ n: 10 }), taux_periode: 1.5 }],
      ['sous le seuil, taux = "0.8"', { ...entree({ n: 10 }), taux_periode: '0.8' }],
      ['sous le seuil, taux = NaN', { ...entree({ n: 10 }), taux_periode: NaN }],
      ['sous le seuil, taux absent', (() => { const e = entree({ n: 10 }); delete e.taux_periode; return e; })()],
    ];
    for (const [nom, e] of cas.filter(([n]) => n.startsWith('sous le seuil'))) assert.equal(e.seuil_atteint, false, `garde : ${nom}`);
    for (const [nom, mauvaise] of cas) {
      assert.throws(() => appel([mauvaise, entree({ notion_id: 'fr.lexique' })]), TypeError, nom);
    }
    // Malformée ET hors référentiel : lève (n'est pas comptée).
    assert.throws(() => appel([{ ...entree({ notion_id: 'svt.cellule' }), seuil_atteint: 'oui' }]), TypeError);
    // Doublon (notion_id, palier) : lève, quel que soit l'ordre (Map.set écrasait).
    const a = auTaux(0.8);
    const b = auTaux(0.1);
    assert.throws(() => appel([a, b]), TypeError);
    assert.throws(() => appel([b, a]), TypeError);
    assert.throws(() => appel([entree({ notion_id: 'svt.cellule' }), entree({ notion_id: 'svt.cellule' })]), TypeError);
    // Doublon nF : notion connue, puis hors référentiel.
    assert.throws(() => appel([entree({ palier: 'nF' }), entree({ palier: 'nF', n: 10, reussites: 2 })]), TypeError);
    assert.throws(() => appel([entree({ notion_id: 'svt.cellule', palier: 'nF' }), entree({ notion_id: 'svt.cellule', palier: 'nF' })]), TypeError);
  });
});

// --- Couleur depuis les statistiques -------------------------------------------

describe('couleur — depuis taux_periode quand le seuil est atteint (source stats_cartes)', () => {
  test('frontières strictes : 0.75 vert ; 0.7499 et 0.7499999999999999 ambre ; 0.50 ambre ; 0.4999 et 0.49999999999999994 rouge', () => {
    for (const [taux, attendu] of [
      [0.75, 'vert'], [0.7499, 'ambre'], [0.7499999999999999, 'ambre'],
      [0.5, 'ambre'], [0.4999, 'rouge'], [0.49999999999999994, 'rouge'],
    ]) {
      const c = couleur(appel([auTaux(taux)]));
      assert.deepEqual(
        { couleur: c.couleur, source: c.source, taux_periode: c.taux_periode, seuil_atteint: c.seuil_atteint },
        { couleur: attendu, source: 'stats_cartes', taux_periode: taux, seuil_atteint: true },
        `taux ${taux}`,
      );
    }
  });

  test('extrêmes : 1 vert, 0 rouge', () => {
    assert.equal(couleur(appel([entree({ n: 25, reussites: 25 })])).couleur, 'vert');
    assert.equal(couleur(appel([entree({ n: 25, reussites: 0 })])).couleur, 'rouge');
  });

  test('la couleur des stats remplace la priorité initiale (rouge au diagnostic, vert mesuré)', () => {
    const c = couleur(appel([entree({ n: 40, reussites: 36 })]));
    assert.deepEqual(c, { notion_id: 'maths.proportionnalite', palier: 'nI', couleur: 'vert', source: 'stats_cartes', taux_periode: 36 / 40, seuil_atteint: true });
  });

  test('nF seuil atteint à 0.8 : vert EXACT (le seuil ne privilégie pas nI)', () => {
    assert.deepEqual(couleur(appel([entree({ palier: 'nF', n: 30, reussites: 24 })]), 'maths.proportionnalite', 'nF'), {
      notion_id: 'maths.proportionnalite', palier: 'nF', couleur: 'vert', source: 'stats_cartes', taux_periode: 0.8, seuil_atteint: true,
    });
  });

  test('nF seuil atteint à 0.6 -> ambre EXACT ; à 0.25 -> rouge EXACT', () => {
    assert.deepEqual(couleur(appel([entree({ palier: 'nF', n: 30, reussites: 18 })]), 'maths.proportionnalite', 'nF'), {
      notion_id: 'maths.proportionnalite', palier: 'nF', couleur: 'ambre', source: 'stats_cartes', taux_periode: 0.6, seuil_atteint: true,
    });
    assert.deepEqual(couleur(appel([entree({ palier: 'nF', n: 40, reussites: 10 })]), 'maths.proportionnalite', 'nF'), {
      notion_id: 'maths.proportionnalite', palier: 'nF', couleur: 'rouge', source: 'stats_cartes', taux_periode: 0.25, seuil_atteint: true,
    });
  });

  test('dégradation : notion verte au diagnostic mesurée à 0.6 -> ambre EXACT', () => {
    assert.deepEqual(couleur(appel([entree({ notion_id: 'fr.lexique', n: 30, reussites: 18 })]), 'fr.lexique'), {
      notion_id: 'fr.lexique', palier: 'nI', couleur: 'ambre', source: 'stats_cartes', taux_periode: 0.6, seuil_atteint: true,
    });
  });

  test('dégradation : notion verte au diagnostic mesurée à 0.25 -> rouge EXACT', () => {
    assert.deepEqual(couleur(appel([entree({ notion_id: 'fr.lexique', n: 40, reussites: 10 })]), 'fr.lexique'), {
      notion_id: 'fr.lexique', palier: 'nI', couleur: 'rouge', source: 'stats_cartes', taux_periode: 0.25, seuil_atteint: true,
    });
  });

  test('paliers indépendants : nI vert mesuré, nF sans entrée garde sa priorité', () => {
    const r = appel([entree({ n: 30, reussites: 30 })]);
    assert.equal(couleur(r, 'maths.proportionnalite', 'nI').couleur, 'vert');
    assert.deepEqual(couleur(r, 'maths.proportionnalite', 'nF'), {
      notion_id: 'maths.proportionnalite', palier: 'nF', couleur: 'rouge', source: 'priorite_initiale', taux_periode: null, seuil_atteint: false,
    });
  });
});

// --- Priorité initiale -------------------------------------------------------------

describe('couleur — priorité initiale (pas d\'entrée, ou seuil non atteint)', () => {
  test('seuil non atteint : TOUJOURS priorite_initiale, même à 100 % (pas de bascule sous 25)', () => {
    const c = couleur(appel([entree({ n: 24, reussites: 24 })]));
    assert.deepEqual(c, { notion_id: 'maths.proportionnalite', palier: 'nI', couleur: 'rouge', source: 'priorite_initiale', taux_periode: 1, seuil_atteint: false });
  });

  test('seuil non atteint à 0 % : priorite_initiale (vert au diagnostic reste vert)', () => {
    const c = couleur(appel([entree({ notion_id: 'fr.lexique', n: 10, reussites: 0 })]), 'fr.lexique');
    assert.equal(c.couleur, 'vert');
    assert.equal(c.source, 'priorite_initiale');
    assert.equal(c.taux_periode, 0);
  });

  test('entrée sans réponse sur la période (taux null) : priorite_initiale, taux_periode null', () => {
    const c = couleur(appel([entree({ n: 0, reussites: 0 })]));
    assert.deepEqual(c, { notion_id: 'maths.proportionnalite', palier: 'nI', couleur: 'rouge', source: 'priorite_initiale', taux_periode: null, seuil_atteint: false });
  });

  test('palier du référentiel absent de l\'agrégation : priorite_initiale, taux_periode null', () => {
    const c = couleur(appel([entree({ notion_id: 'fr.lexique' })]), 'maths.proportionnalite', 'nF');
    assert.deepEqual(c, { notion_id: 'maths.proportionnalite', palier: 'nF', couleur: 'rouge', source: 'priorite_initiale', taux_periode: null, seuil_atteint: false });
  });

  test('notion sans priorite_initiale : « gris », source priorite_initiale', () => {
    const ref = { notions: [notion('fr.nouvelle', undefined)] };
    assert.deepEqual(appel([entree({ notion_id: 'fr.nouvelle', n: 5, reussites: 5 })], ref).couleurs, [
      { notion_id: 'fr.nouvelle', palier: 'nI', couleur: 'gris', source: 'priorite_initiale', taux_periode: 1, seuil_atteint: false },
      { notion_id: 'fr.nouvelle', palier: 'nF', couleur: 'gris', source: 'priorite_initiale', taux_periode: null, seuil_atteint: false },
    ]);
  });

  test('notion sans priorite_initiale mais seuil atteint : couleur des stats', () => {
    const ref = { notions: [notion('fr.nouvelle', undefined)] };
    assert.equal(couleur(appel([entree({ notion_id: 'fr.nouvelle', n: 30, reussites: 15 })], ref), 'fr.nouvelle').couleur, 'ambre');
  });

  test('chaque priorite_initiale admise est recopiée telle quelle', () => {
    for (const p of ['rouge', 'ambre', 'vert']) {
      assert.equal(couleur(appel([], { notions: [notion('fr.a', p)] }), 'fr.a').couleur, p);
    }
  });

  test('notion à un seul palier : une seule couleur', () => {
    const r = appel([], { notions: [notion('fr.a', 'ambre', ['nF'])] });
    assert.deepEqual(r.couleurs.map((c) => [c.notion_id, c.palier]), [['fr.a', 'nF']]);
  });
});

// --- Hors référentiel ----------------------------------------------------------------

describe('couleur — entrées hors référentiel', () => {
  test('notion inconnue : ignorée, comptée, aucune couleur produite', () => {
    const r = appel([entree({ notion_id: 'svt.cellule' }), entree()]);
    assert.equal(r.ignores.hors_referentiel, 1);
    assert.equal(r.couleurs.some((c) => c.notion_id === 'svt.cellule'), false);
    assert.equal(r.couleurs.length, 4);
  });

  test('deux entrées hors référentiel : hors_referentiel === 2', () => {
    const r = appel([entree({ notion_id: 'svt.cellule' }), entree({ notion_id: 'svt.cellule', palier: 'nF' }), entree()]);
    assert.equal(r.ignores.hors_referentiel, 2);
  });

  test('trois entrées distinctes hors référentiel : hors_referentiel === 3', () => {
    const r = appel([
      entree({ notion_id: 'svt.cellule' }), entree({ notion_id: 'svt.cellule', palier: 'nF' }),
      entree({ notion_id: 'hg.carte' }), entree(),
    ]);
    assert.equal(r.ignores.hors_referentiel, 3);
  });

  test('notion connue, palier absent du référentiel : ignorée et comptée', () => {
    const ref = { notions: [notion('fr.a', 'ambre', ['nI'])] };
    const r = appel([entree({ notion_id: 'fr.a', palier: 'nF' }), entree({ notion_id: 'fr.a', palier: 'nI', n: 30, reussites: 30 })], ref);
    assert.equal(r.ignores.hors_referentiel, 1);
    assert.deepEqual(r.couleurs.map((c) => [c.palier, c.couleur]), [['nI', 'vert']]);
  });
});

// --- Domaine des valeurs ----------------------------------------------------------------

describe('couleur — domaine des valeurs', () => {
  test('couleur ∈ {gris, vert, ambre, rouge} et source ∈ {stats_cartes, priorite_initiale}, jamais de ⬛', () => {
    const ref = { notions: [notion('fr.a', 'rouge'), notion('fr.b', 'vert'), notion('fr.c', undefined), notion('maths.d', 'ambre')] };
    const entrees = [
      entree({ notion_id: 'fr.a', n: 30, reussites: 30 }), entree({ notion_id: 'fr.b', n: 30, reussites: 0 }),
      entree({ notion_id: 'fr.c', palier: 'nF', n: 30, reussites: 20 }), entree({ notion_id: 'maths.d', n: 3, reussites: 0 }),
    ];
    for (const c of appel(entrees, ref).couleurs) {
      assert.ok(['gris', 'vert', 'ambre', 'rouge'].includes(c.couleur), c.couleur);
      assert.ok(['stats_cartes', 'priorite_initiale'].includes(c.source), c.source);
    }
  });
});

// --- Intégration avec le module 1 ----------------------------------------------------------

describe('couleur — intégration : sortie réelle d\'agreger()', () => {
  test('agreger -> colorer : 25 réponses à 80 % = vert mesuré ; 24 réponses = priorité initiale', () => {
    const CAL = { periodes: [{ id: 'P2', du: '2026-11-02', au: '2026-12-18' }], semaines: [] };
    const ev = (palier, result) => ({
      ts: '2026-11-24T10:00:00Z', niveau: '4e', defi_id: `defi_2026-w48_4e_proportionnalite_${palier}`,
      notion_id: 'maths.proportionnalite', palier, set_id: `set_fonda_proportionnalite_${palier}_02`,
      item_id: 'it01', result, ctx: 'df', rang_local: 1, dt_jours: 0,
    });
    const evenements = [
      ...Array.from({ length: 25 }, (_, i) => ev('nI', i < 20 ? 1 : 0)),
      ...Array.from({ length: 24 }, () => ev('nF', 1)),
    ];
    const agr = agreger({ evenements, calendrier: CAL, aujourdhui: '2026-12-04' });
    const r = colorer({ agregation: agr, referentiel: REFERENTIEL });
    assert.deepEqual(couleur(r, 'maths.proportionnalite', 'nI'), {
      notion_id: 'maths.proportionnalite', palier: 'nI', couleur: 'vert', source: 'stats_cartes', taux_periode: 20 / 25, seuil_atteint: true,
    });
    assert.deepEqual(couleur(r, 'maths.proportionnalite', 'nF'), {
      notion_id: 'maths.proportionnalite', palier: 'nF', couleur: 'rouge', source: 'priorite_initiale', taux_periode: 1, seuil_atteint: false,
    });
  });
});
