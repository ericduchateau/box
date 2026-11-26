// Suite de tests — Moteur A, module 1 : agrégation des événements (contrat r3).
// Référence : docs/SPEC-moteur-a.md §1-§3 et §6 (amendés le 2026-11-25) ; PRD §3.2, §3.5, §3.6,
// §6, §8 (étape 1), §10. Écrite AVANT l'implémentation (fonda/engine/agregation.js), conformément
// à la méthode imposée (AGENTS.md, « tests d'abord »). Zéro dépendance : test runner natif Node.
// Fixtures synthétiques et anonymes uniquement.
//
// Contrat testé :
//   agreger({ evenements, calendrier, aujourdhui }) -> {
//     aujourdhui, periode_id,
//     entrees: [ {
//       notion_id, palier,
//       n_reponses, n_reussites, taux_periode, seuil_atteint,
//       delta: { valeur, items_communs, courante, precedente },
//       cartes_rouges: [ { set_id, item_id, n_reponses, taux } ],
//       cartes_insuffisantes: [ { set_id, item_id, n_reponses, taux } ],
//       adoption: { df, maison, classe },
//     } ],
//     ignores: { futur, invalide, vacances },
//   }
//   exports : agreger, SEUIL_BASCULE (25), SEUIL_CARTE (10), SEUIL_ROUGE (0.5).
//
// Règles (décisions de l'architecte, 2026-11-25) :
//   - PURE : aucune I/O, aucune horloge (aujourdhui "AAAA-MM-JJ" injecté, date de Paris), entrées
//     non modifiées ; DÉTERMINISTE octet pour octet (JSON.stringify) quel que soit l'ordre des
//     événements ; entrées triées par notion_id puis palier (nI avant nF) ; cartes triées par
//     set_id puis item_id. Chaînes comparées par UNITÉS DE CODE (opérateur < : 'B' < 'b',
//     'it10' < 'it9') ; localeCompare INTERDIT (l'ordre dépendrait de la machine).
//   - Paramètres : aujourdhui illisible ou date impossible, calendrier sans `periodes` ou avec
//     `periodes: []` -> TypeError (entrées du moteur, pas des données).
//   - INTERNIVEAU pondéré : total des réussites / total des réponses, 6e à 3e confondus. Le niveau
//     n'est pas restitué ici (tableau de bord), mais il est VALIDÉ : absent ou hors
//     {6e, 5e, 4e, 3e} -> invalide.
//   - notion_id VALIDÉ : /^(fr|maths)\.[a-z0-9-]+$/ (slug minuscule, comme evenements.js) ;
//     non conforme -> invalide.
//   - Événement LU UNE SEULE FOIS : seules ses propriétés propres de données comptent ;
//     accesseur, propriété héritée ou piège (Proxy qui lève) -> invalide, sans interrompre le lot.
//   - JOUR = date civile Europe/Paris de ts (ts ISO 8601 avec fuseau explicite : Z ou ±hh:mm).
//     Jour de classe = jour compris dans une période [du, au] (bornes incluses) ; semaines[]
//     n'est PAS lu. Hors période = vacances.
//   - REJETS, un seul motif par événement, priorité invalide > futur > vacances :
//       invalide : forme (voir la liste en fin de fichier) ;
//       futur    : jour > aujourdhui ;
//       vacances : jour hors de toute période.
//     Une réponse valide d'une période PASSÉE n'est pas un rejet : elle sert au Δ.
//   - Période en cours = période contenant aujourdhui ; pendant les vacances, la dernière
//     commencée (quel que soit l'ordre du tableau) ; avant toute période : null.
//   - taux_periode, n_reponses, adoption et cartes : période en cours seulement.
//     Invariant : df + maison + classe = n_reponses. seuil_atteint = n_reponses >= 25.
//   - OCCURRENCE = semaine du défi lue dans defi_id ("defi_AAAA-wSS_{niveau}_{slug}_{palier}",
//     niveau ∈ {6e, 5e, 4e, 3e}), libellée "AAAA-wSS". Le niveau du defi_id est une MÉTADONNÉE :
//     event.niveau fait foi, un désaccord n'invalide pas (décision 1b = B, 2026-11-26).
//     defi_id invalide si : segment niveau hors {6e, 5e, 4e, 3e}, semaine absente de l'année ISO (ex. 2027-w53),
//     lundi de cette semaine postérieur au jour de la réponse, ou suffixe contredisant
//     notion_id / palier. L'année n'est PAS comparée à aujourdhui (le Δ d'une année sur
//     l'autre reste possible ; la validation d'année est celle de la résolution des liens).
//   - Δ (PRD §6) : occurrences de la (notion, palier) triées par (année, semaine) ; seules les
//     DEUX plus récentes servent. Cartes communes = (set_id, item_id) présentes dans les deux.
//       * occurrence unique : courante = toutes ses réponses, precedente = null, valeur = null ;
//       * deux occurrences : courante et precedente restreintes aux cartes communes ;
//         valeur = taux(courante) − taux(precedente) ; aucune carte commune -> n_reponses 0,
//         taux null des deux côtés, valeur = null (pas de recherche d'une paire plus ancienne).
//   - Cartes (set_id, item_id) : rouge = (n_reponses >= SEUIL_CARTE) ET (taux < SEUIL_ROUGE),
//     inégalité stricte (50 % pile n'est PAS rouge) ; moins de 10 réponses = « insuffisante »,
//     quel que soit le taux.
//   - Pas de déduplication serveur (verrou local côté appareil, PRD §6).
//
// Usage : node --test fonda/engine/agregation.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { agreger, SEUIL_BASCULE, SEUIL_CARTE, SEUIL_ROUGE } = require('./agregation.js');

// --- Fixtures ---------------------------------------------------------------

// P1 en heure d'été (UTC+2), P2 en heure d'hiver (UTC+1). semaines[] volontairement vide.
const CALENDRIER = {
  periodes: [
    { id: 'P1', libelle: 'Rentrée → Toussaint', du: '2026-09-01', au: '2026-10-16', bandes: {} },
    { id: 'P2', libelle: 'Toussaint → Noël', du: '2026-11-02', au: '2026-12-18', bandes: {} },
  ],
  semaines: [],
};

const AUJOURDHUI = '2026-12-04'; // vendredi, P2
const NOTION = 'maths.proportionnalite';
const W45 = { semaine: 45, ts: '2026-11-03T10:00:00Z' };
const W41 = { semaine: 41, ts: '2026-10-06T10:00:00Z' };

function slug(notionId) { return String(notionId).split('.').slice(1).join('.'); }

// Événement au format cible (SPEC §6). `semaine` = semaine du défi (occurrence).
function ev({
  notion_id = NOTION, palier = 'nI', lot = '02', set_id, item_id = 'it01', result = 1,
  ctx = 'df', ts = '2026-11-24T10:00:00Z', niveau = '4e', semaine = 48, annee = 2026,
} = {}) {
  return {
    ts, niveau,
    defi_id: `defi_${annee}-w${semaine}_${niveau}_${slug(notion_id)}_${palier}`,
    notion_id, palier,
    set_id: set_id || `set_fonda_${slug(notion_id)}_${palier}_${lot}`,
    item_id, result, ctx, rang_local: 1, dt_jours: 0,
  };
}

// n événements, dont les `reussites` premiers justes.
function serie(n, reussites, champs = {}) {
  return Array.from({ length: n }, (_, i) => ev({ ...champs, result: i < reussites ? 1 : 0 }));
}

function geler(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) geler(v);
  }
  return o;
}

function entree(resultat, notion_id = NOTION, palier = 'nI') {
  return resultat.entrees.find((e) => e.notion_id === notion_id && e.palier === palier);
}

const appel = (evenements, aujourdhui = AUJOURDHUI, calendrier = CALENDRIER) =>
  agreger({ evenements, calendrier, aujourdhui });

const AUCUN_IGNORE = { futur: 0, invalide: 0, vacances: 0 };
const SET = 'set_fonda_proportionnalite_nI_02';

// --- Cadre --------------------------------------------------------------------

describe('agregation — cadre', () => {
  test('seuils exportés : bascule = 25 (SPEC §2), carte = 10, rouge = 0.5 (SPEC §3)', () => {
    assert.equal(SEUIL_BASCULE, 25);
    assert.equal(SEUIL_CARTE, 10);
    assert.equal(SEUIL_ROUGE, 0.5);
  });

  test('zéro événement -> aucune entrée, période résolue, ignores à zéro', () => {
    assert.deepEqual(appel([]), { aujourdhui: AUJOURDHUI, periode_id: 'P2', entrees: [], ignores: AUCUN_IGNORE });
  });

  test('forme : clés exactes, dans cet ordre (sérialisation stable)', () => {
    const r = appel(serie(3, 2));
    assert.deepEqual(Object.keys(r), ['aujourdhui', 'periode_id', 'entrees', 'ignores']);
    assert.deepEqual(Object.keys(r.ignores), ['futur', 'invalide', 'vacances']);
    const e = entree(r);
    assert.deepEqual(Object.keys(e), [
      'notion_id', 'palier', 'n_reponses', 'n_reussites', 'taux_periode', 'seuil_atteint',
      'delta', 'cartes_rouges', 'cartes_insuffisantes', 'adoption',
    ]);
    assert.deepEqual(Object.keys(e.delta), ['valeur', 'items_communs', 'courante', 'precedente']);
    assert.deepEqual(Object.keys(e.delta.courante), ['occurrence', 'n_reponses', 'taux']);
    assert.deepEqual(Object.keys(e.adoption), ['df', 'maison', 'classe']);
    assert.deepEqual(Object.keys(e.cartes_insuffisantes[0]), ['set_id', 'item_id', 'n_reponses', 'taux']);
  });

  test('pureté : entrées NON gelées inchangées (champ supplémentaire, comparaison profonde)', () => {
    const evts = serie(30, 20).map((e, i) => ({ ...e, extra: { rang: i, liste: [1, 2] } }));
    const cal = JSON.parse(JSON.stringify(CALENDRIER));
    cal.periodes.reverse(); // [P2, P1] : un tri EN PLACE serait détecté
    const avant = structuredClone({ evts, cal });
    appel(evts, AUJOURDHUI, cal);
    assert.deepEqual({ evts, cal }, avant);
  });

  test('pureté : entrées gelées acceptées et inchangées ; appels répétés identiques', () => {
    const evts = serie(30, 20);
    const avant = JSON.stringify({ evts, CALENDRIER });
    geler(evts); geler(CALENDRIER);
    const r1 = JSON.stringify(appel(evts));
    appel(serie(5, 0, { notion_id: 'fr.lexique' })); // appel intercalé différent
    const r2 = JSON.stringify(appel(evts));
    assert.equal(r1, r2);
    assert.equal(JSON.stringify({ evts, CALENDRIER }), avant);
  });

  test('aucune horloge : Date.now neutralisé, résultat identique', () => {
    const evts = serie(12, 7);
    const attendu = JSON.stringify(appel(evts));
    const original = Date.now;
    Date.now = () => { throw new Error('horloge lue'); };
    try { assert.equal(JSON.stringify(appel(evts)), attendu); } finally { Date.now = original; }
  });

  test('déterminisme octet pour octet : l\'ordre des événements ne change rien', () => {
    const evts = [
      ...serie(12, 2, { item_id: 'it02' }),
      ...serie(12, 3, { item_id: 'it01' }),
      ...serie(3, 0, { item_id: 'it05' }),
      ...serie(8, 2, { palier: 'nF', ctx: 'maison' }),
      ...serie(6, 6, { notion_id: 'fr.lexique', ctx: 'classe' }),
      ...serie(10, 4, { ...W45, item_id: 'it02' }),
      { ...ev(), result: 9 }, ev({ ts: '2026-12-25T10:00:00Z' }), ev({ ts: '2026-10-28T10:00:00Z', semaine: 44 }),
      // >= 2 cartes insuffisantes, dont une collision d'item_id entre deux lots (même it07).
      ...serie(3, 1, { notion_id: 'maths.fractions', lot: '02', item_id: 'it07' }),
      ...serie(4, 0, { notion_id: 'maths.fractions', lot: '01', item_id: 'it07' }),
      ...serie(2, 2, { notion_id: 'maths.fractions', lot: '01', item_id: 'it03' }),
    ];
    const inverse = [...evts].reverse();
    const melange = evts.map((e, i) => [((i * 7919) % evts.length), e]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    const ref = JSON.stringify(appel(evts));
    // Garde : la fixture produit bien les ex-æquo d'item_id visés.
    assert.deepEqual(entree(appel(evts), 'maths.fractions').cartes_insuffisantes.map((c) => [c.set_id.slice(-2), c.item_id]),
      [['01', 'it03'], ['01', 'it07'], ['02', 'it07']]);
    assert.equal(JSON.stringify(appel(inverse)), ref);
    assert.equal(JSON.stringify(appel(melange)), ref);
  });

  test('entrées triées par notion_id puis palier (nI avant nF)', () => {
    const r = appel([
      ev({ notion_id: 'maths.proportionnalite', palier: 'nF' }),
      ev({ notion_id: 'fr.lexique', palier: 'nI' }),
      ev({ notion_id: 'maths.proportionnalite', palier: 'nI' }),
    ]);
    assert.deepEqual(r.entrees.map((e) => [e.notion_id, e.palier]), [
      ['fr.lexique', 'nI'], ['maths.proportionnalite', 'nI'], ['maths.proportionnalite', 'nF'],
    ]);
  });

  test('tri des entrées par unités de code : \'maths.a-b\' avant \'maths.a0\' (\'-\' < \'0\' ; pas localeCompare)', () => {
    const r = appel([ev({ notion_id: 'maths.a0' }), ev({ notion_id: 'maths.a-b' })]);
    assert.deepEqual(r.entrees.map((e) => e.notion_id), ['maths.a-b', 'maths.a0']);
  });

  test('paliers séparés : nI et nF d\'une même notion donnent deux entrées', () => {
    const r = appel([...serie(10, 10), ...serie(10, 0, { palier: 'nF' })]);
    assert.equal(entree(r, NOTION, 'nI').taux_periode, 1);
    assert.equal(entree(r, NOTION, 'nF').taux_periode, 0);
  });

  test('aucune déduplication serveur : des événements identiques comptent tous', () => {
    const un = ev();
    assert.equal(entree(appel([un, { ...un }, { ...un }])).n_reponses, 3);
  });

  test('paramètres invalides : TypeError', () => {
    assert.throws(() => appel([], 'hier'), TypeError);
    assert.throws(() => appel([], '2026-02-30'), TypeError);
    assert.throws(() => appel([], AUJOURDHUI, { semaines: [] }), TypeError);
    assert.throws(() => appel([], AUJOURDHUI, { periodes: [], semaines: [] }), TypeError);
  });
});

// --- Taux de période et seuil ---------------------------------------------------

describe('agregation — taux de période et seuil (SPEC §2, §3)', () => {
  test('< 25 réponses : taux calculé, seuil_atteint = false', () => {
    const e = entree(appel(serie(24, 18)));
    assert.equal(e.n_reponses, 24);
    assert.equal(e.n_reussites, 18);
    assert.equal(e.taux_periode, 18 / 24);
    assert.equal(e.seuil_atteint, false);
  });

  test('= 25 réponses : seuil_atteint = true', () => {
    const e = entree(appel(serie(25, 10)));
    assert.equal(e.n_reponses, 25);
    assert.equal(e.taux_periode, 10 / 25);
    assert.equal(e.seuil_atteint, true);
  });

  test('> 25 réponses : seuil_atteint reste true', () => {
    assert.equal(entree(appel(serie(26, 26))).seuil_atteint, true);
  });

  test('la période se choisit par la date de RÉPONSE, l\'occurrence par la semaine du DÉFI', () => {
    const e = entree(appel(serie(10, 0, { semaine: 41, ts: '2026-11-24T10:00:00Z', ctx: 'maison' }))); // défi P1, répondu en P2
    assert.equal(e.n_reponses, 10);
    assert.deepEqual(e.adoption, { df: 0, maison: 10, classe: 0 });
    assert.deepEqual(e.cartes_rouges, [{ set_id: SET, item_id: 'it01', n_reponses: 10, taux: 0 }]);
    assert.equal(e.delta.courante.occurrence, '2026-w41');
  });

  test('cumul de la PÉRIODE en cours : les réponses de P1 ne comptent pas', () => {
    const e = entree(appel([...serie(10, 0, W41), ...serie(10, 10)]));
    assert.equal(e.n_reponses, 10);
    assert.equal(e.taux_periode, 1);
  });

  test('notion servie seulement hors période en cours : entrée présente, compteurs à zéro, pas un rejet', () => {
    const r = appel(serie(10, 5, W41));
    const e = entree(r);
    assert.deepEqual(r.ignores, AUCUN_IGNORE);
    assert.equal(e.n_reponses, 0);
    assert.equal(e.n_reussites, 0);
    assert.equal(e.taux_periode, null);
    assert.equal(e.seuil_atteint, false);
    assert.deepEqual(e.adoption, { df: 0, maison: 0, classe: 0 });
    assert.deepEqual(e.cartes_rouges, []);
    assert.deepEqual(e.cartes_insuffisantes, []);
    assert.deepEqual(e.delta.courante, { occurrence: '2026-w41', n_reponses: 10, taux: 5 / 10 });
  });

  test('aujourdhui pendant les vacances : période en cours = dernière commencée', () => {
    const r = appel(serie(10, 7, { ts: '2026-10-14T10:00:00Z', semaine: 42 }), '2026-10-25');
    assert.equal(r.periode_id, 'P1');
    assert.equal(entree(r).taux_periode, 7 / 10);
  });

  test('dernière commencée, même si les périodes sont dans le désordre', () => {
    const desordre = { periodes: [CALENDRIER.periodes[1], CALENDRIER.periodes[0]], semaines: [] };
    assert.equal(appel([], '2026-10-25', desordre).periode_id, 'P1');
    assert.equal(appel([], '2026-12-20', desordre).periode_id, 'P2');
  });

  test('vacances après la dernière période : période en cours = la dernière, réponses = vacances', () => {
    const r = appel(serie(3, 3, { ts: '2027-01-05T10:00:00Z', annee: 2027, semaine: 1 }), '2027-01-10');
    assert.equal(r.periode_id, 'P2');
    assert.deepEqual(r.ignores, { futur: 0, invalide: 0, vacances: 3 });
  });

  test('aujourdhui avant toute période : periode_id = null', () => {
    assert.equal(appel([], '2026-08-25').periode_id, null);
  });
});

// --- Interniveau ---------------------------------------------------------------

describe('agregation — interniveau pondéré (6e à 3e confondus)', () => {
  test('plusieurs niveaux : UNE entrée, taux = total réussites / total réponses', () => {
    const r = appel([...serie(20, 20, { niveau: '6e' }), ...serie(10, 0, { niveau: '3e' })]);
    assert.equal(r.entrees.length, 1);
    const e = entree(r);
    assert.equal(e.n_reponses, 30);
    assert.equal(e.taux_periode, 20 / 30);
    assert.notEqual(e.taux_periode, 0.5); // jamais la moyenne des taux par niveau
  });

  test('le niveau n\'apparaît pas dans la sortie', () => {
    const e = entree(appel([ev({ niveau: '5e' }), ev({ niveau: '3e' })]));
    assert.equal(e.n_reponses, 2);
    assert.equal(JSON.stringify(e).includes('niveau'), false);
  });

  test('le seuil de 25 se compte tous niveaux confondus', () => {
    const e = entree(appel([...serie(13, 13, { niveau: '6e' }), ...serie(12, 12, { niveau: '4e' })]));
    assert.equal(e.n_reponses, 25);
    assert.equal(e.seuil_atteint, true);
  });

  test('une carte répartie sur deux niveaux (6 + 4 réponses fausses) : UNE carte rouge à 10 réponses', () => {
    const e = entree(appel([...serie(6, 0, { niveau: '6e' }), ...serie(4, 0, { niveau: '5e' })]));
    assert.deepEqual(e.cartes_rouges, [{ set_id: SET, item_id: 'it01', n_reponses: 10, taux: 0 }]);
    assert.deepEqual(e.cartes_insuffisantes, []);
  });
});

// --- Fuseau et bornes ------------------------------------------------------------

describe('agregation — jour Europe/Paris et bornes (vacances, futur)', () => {
  test('jour même (hiver) : 23 h à Paris compte ; minuit le lendemain = futur', () => {
    const r = appel([
      ev({ ts: '2026-12-04T22:00:00Z' }), // 23 h Paris, vendredi 4
      ev({ ts: '2026-12-04T23:00:00Z' }), // 0 h Paris, samedi 5
    ]);
    assert.equal(entree(r).n_reponses, 1);
    assert.deepEqual(r.ignores, { futur: 1, invalide: 0, vacances: 0 });
  });

  test('jour même (été) en fin de période : 23 h compte ; minuit = futur (et non vacances)', () => {
    const r = appel([
      ev({ ts: '2026-10-16T21:00:00Z', semaine: 42 }), // ven. 16 oct., 23 h Paris
      ev({ ts: '2026-10-16T22:00:00Z', semaine: 42 }), // sam. 17 oct., 0 h Paris : futur ET vacances
    ], '2026-10-16');
    assert.equal(entree(r).n_reponses, 1);
    assert.deepEqual(r.ignores, { futur: 1, invalide: 0, vacances: 0 });
  });

  test('dimanche → lundi de rentrée (hiver) : dimanche 23 h = vacances, lundi 0 h = P2', () => {
    const r = appel([
      ev({ ts: '2026-11-01T22:00:00Z', semaine: 44 }), // dim. 1er nov., 23 h Paris
      ev({ ts: '2026-11-01T23:00:00Z', semaine: 45 }), // lun. 2 nov., 0 h Paris (1er jour de P2)
    ]);
    assert.equal(entree(r).n_reponses, 1);
    assert.equal(r.ignores.vacances, 1);
  });

  test('fin de période (été) : vendredi 16 oct. 23 h compte, samedi 0 h = vacances', () => {
    const r = appel([
      ev({ ts: '2026-10-16T21:00:00Z', semaine: 42 }),
      ev({ ts: '2026-10-16T22:00:00Z', semaine: 42 }),
    ], '2026-10-25');
    assert.equal(entree(r).n_reponses, 1);
    assert.deepEqual(r.ignores, { futur: 0, invalide: 0, vacances: 1 });
  });

  test('même instant écrit en Z, +01:00 ou +02:00 : même jour', () => {
    const r = appel([
      ev({ ts: '2026-12-04T22:00:00Z' }),
      ev({ ts: '2026-12-04T23:00:00+01:00' }),
      ev({ ts: '2026-12-05T00:00:00+02:00' }),
      ev({ ts: '2026-12-05T00:00:00+01:00' }), // = 23 h Z : samedi 0 h Paris -> futur
      ev({ ts: '2026-12-04T16:00:00-05:00' }), // = 21 h Z : 22 h Paris -> compte
      ev({ ts: '2026-12-04T18:00:00-05:00' }), // = 23 h Z : samedi 0 h Paris -> futur
    ]);
    assert.equal(entree(r).n_reponses, 4);
    assert.equal(r.ignores.futur, 2);
  });

  // Périodes couvrant les deux changements d'heure de 2026 (dim. 29 mars, dim. 25 octobre).
  const CAL_HEURE = { periodes: [
    { id: 'PA', du: '2026-03-02', au: '2026-04-03', bandes: {} },
    { id: 'PB', du: '2026-10-19', au: '2026-10-30', bandes: {} },
  ], semaines: [] };

  test('passage à l\'heure d\'été (dim. 29/03/2026) : 21 h 30 Z = 23 h 30 Paris compte ; 22 h 30 Z = lundi 0 h 30 = futur', () => {
    const r = appel([
      ev({ semaine: 13, ts: '2026-03-29T21:30:00Z' }),
      ev({ semaine: 13, ts: '2026-03-29T22:30:00Z' }),
    ], '2026-03-29', CAL_HEURE);
    assert.equal(entree(r).n_reponses, 1);
    assert.deepEqual(r.ignores, { futur: 1, invalide: 0, vacances: 0 });
  });

  test('passage à l\'heure d\'hiver (dim. 25/10/2026) : 22 h 30 Z = 23 h 30 Paris compte ; 23 h 30 Z = lundi 0 h 30 = futur', () => {
    const r = appel([
      ev({ semaine: 43, ts: '2026-10-25T22:30:00Z' }),
      ev({ semaine: 43, ts: '2026-10-25T23:30:00Z' }),
    ], '2026-10-25', CAL_HEURE);
    assert.equal(entree(r).n_reponses, 1);
    assert.deepEqual(r.ignores, { futur: 1, invalide: 0, vacances: 0 });
  });

  test('veille des changements d\'heure : sam. 28/03 22 h 30 Z = 23 h 30 Paris (UTC+1) ; sam. 24/10 22 h 30 Z = dim. 0 h 30 (UTC+2)', () => {
    const mars = appel([
      ev({ semaine: 13, ts: '2026-03-28T22:30:00Z' }), // sam. 23 h 30 : compte
      ev({ semaine: 13, ts: '2026-03-28T23:30:00Z' }), // dim. 0 h 30 : futur
    ], '2026-03-28', CAL_HEURE);
    assert.equal(entree(mars).n_reponses, 1);
    assert.deepEqual(mars.ignores, { futur: 1, invalide: 0, vacances: 0 });
    const octobre = appel([
      ev({ semaine: 43, ts: '2026-10-24T21:30:00Z' }), // sam. 23 h 30 : compte
      ev({ semaine: 43, ts: '2026-10-24T22:30:00Z' }), // dim. 0 h 30 : futur
    ], '2026-10-24', CAL_HEURE);
    assert.equal(entree(octobre).n_reponses, 1);
    assert.deepEqual(octobre.ignores, { futur: 1, invalide: 0, vacances: 0 });
  });

  test('dimanche soir de changement d\'heure avant le lundi ISO du défi : dim. 23 h 30 = invalide, lun. 0 h 30 = valide', () => {
    const ete = appel([
      ev({ semaine: 14, ts: '2026-03-29T21:30:00Z' }), // dim. 29/03, 23 h 30 Paris (UTC+2)
      ev({ semaine: 14, ts: '2026-03-29T22:30:00Z' }), // lun. 30/03, 0 h 30 Paris
    ], '2026-04-03', CAL_HEURE);
    assert.equal(entree(ete).n_reponses, 1);
    assert.deepEqual(ete.ignores, { futur: 0, invalide: 1, vacances: 0 });
    const hiver = appel([
      ev({ semaine: 44, ts: '2026-10-25T22:30:00Z' }), // dim. 25/10, 23 h 30 Paris (UTC+1)
      ev({ semaine: 44, ts: '2026-10-25T23:30:00Z' }), // lun. 26/10, 0 h 30 Paris
    ], '2026-10-30', CAL_HEURE);
    assert.equal(entree(hiver).n_reponses, 1);
    assert.deepEqual(hiver.ignores, { futur: 0, invalide: 1, vacances: 0 });
  });

  test('week-end À L\'INTÉRIEUR d\'une période : jour de classe (compte)', () => {
    assert.equal(entree(appel(serie(4, 4, { ts: '2026-11-21T15:00:00Z', semaine: 47 }))).n_reponses, 4);
  });

  test('réponses pendant les vacances : ignorées partout (taux, Δ, adoption, cartes)', () => {
    const r = appel([...serie(10, 0, { ts: '2026-10-28T10:00:00Z', semaine: 44 }), ...serie(10, 10)]);
    const e = entree(r);
    assert.deepEqual(r.ignores, { futur: 0, invalide: 0, vacances: 10 });
    assert.equal(e.n_reponses, 10);
    assert.equal(e.taux_periode, 1);
    assert.equal(e.delta.precedente, null);
    assert.deepEqual(e.adoption, { df: 10, maison: 0, classe: 0 });
    assert.deepEqual(e.cartes_rouges, []);
    assert.deepEqual(e.cartes_insuffisantes, []);
  });

  test('réponses datées après aujourdhui : ignorées, motif « futur », aucune entrée créée', () => {
    const r = appel(serie(3, 3, { ts: '2026-12-08T10:00:00Z', semaine: 50 }));
    assert.deepEqual(r.ignores, { futur: 3, invalide: 0, vacances: 0 });
    assert.deepEqual(r.entrees, []);
  });

  test('semaines[] n\'est pas lu : un calendrier aux semaines incohérentes ne change rien', () => {
    const autre = { ...CALENDRIER, semaines: [{ iso_week: 1, du: '2027-01-04', au: '2027-01-08', periode_id: 'P9', entrees: [] }] };
    const evts = serie(10, 6);
    assert.equal(JSON.stringify(appel(evts, AUJOURDHUI, autre)), JSON.stringify(appel(evts)));
  });
});

// --- Rejets : priorité -------------------------------------------------------------

describe('agregation — rejets : un seul motif, priorité invalide > futur > vacances', () => {
  test('invalide ET futur -> invalide', () => {
    assert.deepEqual(appel([{ ...ev({ ts: '2026-12-08T10:00:00Z', semaine: 50 }), result: 2 }]).ignores, { futur: 0, invalide: 1, vacances: 0 });
  });
  test('invalide ET vacances -> invalide', () => {
    assert.deepEqual(appel([{ ...ev({ ts: '2026-10-28T10:00:00Z', semaine: 44 }), ctx: 'x' }]).ignores, { futur: 0, invalide: 1, vacances: 0 });
  });
  test('futur ET vacances (après aujourdhui, pendant Noël) -> futur', () => {
    assert.deepEqual(appel([ev({ ts: '2026-12-25T10:00:00Z', semaine: 52 })]).ignores, { futur: 1, invalide: 0, vacances: 0 });
  });
});

// --- Δ par occurrence ------------------------------------------------------------

describe('agregation — Δ entre occurrences, sur les cartes communes (PRD §6)', () => {
  test('deux occurrences (w45 puis w48), mêmes cartes : Δ = taux courant − taux précédent', () => {
    const d = entree(appel([...serie(10, 4, W45), ...serie(10, 8)])).delta;
    assert.deepEqual(d, {
      valeur: 8 / 10 - 4 / 10, items_communs: 1,
      courante: { occurrence: '2026-w48', n_reponses: 10, taux: 8 / 10 },
      precedente: { occurrence: '2026-w45', n_reponses: 10, taux: 4 / 10 },
    });
  });

  test('Δ négatif et Δ nul', () => {
    const neg = entree(appel([...serie(10, 9, W45), ...serie(10, 3)])).delta;
    assert.equal(neg.valeur, 3 / 10 - 9 / 10);
    assert.ok(neg.valeur < 0);
    assert.equal(entree(appel([...serie(10, 6, W45), ...serie(5, 3)])).delta.valeur, 0);
  });

  test('seules les cartes COMMUNES comptent (courante et precedente restreintes)', () => {
    const d = entree(appel([
      ...serie(10, 0, { ...W45, item_id: 'it01' }), // seulement en w45
      ...serie(10, 5, { ...W45, item_id: 'it02' }),
      ...serie(10, 9, { item_id: 'it02' }),
      ...serie(10, 10, { item_id: 'it03' }), // seulement en w48
    ])).delta;
    assert.deepEqual(d, {
      valeur: 9 / 10 - 5 / 10, items_communs: 1,
      courante: { occurrence: '2026-w48', n_reponses: 10, taux: 9 / 10 },
      precedente: { occurrence: '2026-w45', n_reponses: 10, taux: 5 / 10 },
    });
  });

  test('cartes communes à effectifs inégaux : taux pondéré (et non moyenne des cartes)', () => {
    const d = entree(appel([
      ...serie(10, 5, { ...W45, item_id: 'it01' }),
      ...serie(2, 2, { ...W45, item_id: 'it02' }),
      ...serie(4, 4, { item_id: 'it01' }),
      ...serie(16, 0, { item_id: 'it02' }),
    ])).delta;
    assert.deepEqual(d, {
      valeur: 4 / 20 - 7 / 12, items_communs: 2,
      courante: { occurrence: '2026-w48', n_reponses: 20, taux: 4 / 20 },
      precedente: { occurrence: '2026-w45', n_reponses: 12, taux: 7 / 12 },
    });
  });

  test('même item_id dans deux lots différents : aucune carte commune -> Δ null, compteurs à 0', () => {
    const d = entree(appel([...serie(10, 4, { ...W45, lot: '01' }), ...serie(10, 8, { lot: '02' })])).delta;
    assert.deepEqual(d, {
      valeur: null, items_communs: 0,
      courante: { occurrence: '2026-w48', n_reponses: 0, taux: null },
      precedente: { occurrence: '2026-w45', n_reponses: 0, taux: null },
    });
  });

  test('une seule occurrence : courante = toutes ses réponses, precedente = null, Δ = null', () => {
    const d = entree(appel([...serie(10, 8, { item_id: 'it01' }), ...serie(5, 0, { item_id: 'it02' })])).delta;
    assert.deepEqual(d, {
      valeur: null, items_communs: 0,
      courante: { occurrence: '2026-w48', n_reponses: 15, taux: 8 / 15 }, precedente: null,
    });
  });

  test('trois occurrences : seules les deux plus récentes servent', () => {
    const d = entree(appel([...serie(10, 0, W41), ...serie(10, 5, W45), ...serie(10, 7)])).delta;
    assert.equal(d.precedente.occurrence, '2026-w45');
    assert.equal(d.valeur, 7 / 10 - 5 / 10);
  });

  test('trois occurrences, les deux dernières sans carte commune : null, sans remonter à la 1re', () => {
    const d = entree(appel([
      ...serie(10, 2, { ...W41, item_id: 'it01' }),
      ...serie(10, 5, { ...W45, item_id: 'it02' }),
      ...serie(10, 9, { item_id: 'it01' }),
    ])).delta;
    assert.equal(d.valeur, null);
    assert.equal(d.items_communs, 0);
    assert.equal(d.precedente.occurrence, '2026-w45');
  });

  test('l\'occurrence précédente peut appartenir à une période antérieure (P1)', () => {
    const d = entree(appel([...serie(10, 2, W41), ...serie(10, 6)])).delta;
    assert.equal(d.precedente.occurrence, '2026-w41');
    assert.equal(d.valeur, 6 / 10 - 2 / 10);
  });

  test('réponse tardive : rattachée à la semaine du DÉFI, même si elle arrive après le défi courant', () => {
    const d = entree(appel([
      ...serie(10, 4, { semaine: 45, ts: '2026-11-27T10:00:00Z' }), // défi w45, répondu le 27/11
      ...serie(10, 8, { semaine: 48, ts: '2026-11-24T10:00:00Z' }), // défi w48, répondu le 24/11
    ])).delta;
    assert.equal(d.courante.occurrence, '2026-w48');
    assert.equal(d.precedente.occurrence, '2026-w45');
    assert.equal(d.valeur, 8 / 10 - 4 / 10);
  });

  test('interniveau dans le Δ, effectifs inégaux dans les deux occurrences', () => {
    const d = entree(appel([
      ...serie(12, 12, { ...W45, niveau: '6e' }),
      ...serie(4, 0, { ...W45, niveau: '3e' }), // précédente : 12/16 (moyenne des niveaux : 0,5)
      ...serie(3, 0, { niveau: '5e' }),
      ...serie(9, 9, { niveau: '4e' }), // courante : 9/12 (moyenne des niveaux : 0,5)
    ])).delta;
    assert.deepEqual(d.precedente, { occurrence: '2026-w45', n_reponses: 16, taux: 12 / 16 });
    assert.deepEqual(d.courante, { occurrence: '2026-w48', n_reponses: 12, taux: 9 / 12 });
    assert.equal(d.valeur, 9 / 12 - 12 / 16);
  });

  test('plusieurs notions et paliers : Δ calculés séparément', () => {
    const r = appel([
      ...serie(10, 2, W45), ...serie(10, 6),
      ...serie(10, 9, { ...W45, palier: 'nF' }), ...serie(10, 1, { palier: 'nF' }),
      ...serie(10, 5, { notion_id: 'fr.lexique' }),
    ]);
    assert.equal(entree(r).delta.valeur, 6 / 10 - 2 / 10);
    assert.equal(entree(r, NOTION, 'nF').delta.valeur, 1 / 10 - 9 / 10);
    assert.equal(entree(r, 'fr.lexique').delta.precedente, null);
  });

  test('tri numérique des semaines : w2 avant w10 (même année)', () => {
    const cal = { periodes: [{ id: 'P3', du: '2026-01-05', au: '2026-03-20', bandes: {} }], semaines: [] };
    const d = entree(appel([
      ...serie(10, 3, { semaine: 2, ts: '2026-01-06T10:00:00Z' }),
      ...serie(10, 9, { semaine: 10, ts: '2026-03-03T10:00:00Z' }),
    ], '2026-03-20', cal)).delta;
    assert.equal(d.precedente.occurrence, '2026-w02');
    assert.equal(d.courante.occurrence, '2026-w10');
    assert.equal(d.valeur, 9 / 10 - 3 / 10);
  });

  test('ordre année puis semaine : 2026-w51 avant 2027-w02', () => {
    const cal = { periodes: [...CALENDRIER.periodes, { id: 'P3', du: '2027-01-04', au: '2027-02-19', bandes: {} }], semaines: [] };
    const d = entree(appel([
      ...serie(10, 3, { annee: 2026, semaine: 51, ts: '2026-12-15T10:00:00Z' }),
      ...serie(10, 9, { annee: 2027, semaine: 2, ts: '2027-01-12T10:00:00Z' }),
    ], '2027-01-15', cal)).delta;
    assert.equal(d.precedente.occurrence, '2026-w51');
    assert.equal(d.courante.occurrence, '2027-w02');
    assert.equal(d.valeur, 9 / 10 - 3 / 10);
  });
});

// --- Cartes ----------------------------------------------------------------------

describe('agregation — cartes rouges et insuffisantes, clé (set_id, item_id)', () => {
  test('rouge = taux < 50 % avec ≥ 10 réponses ; 50 % pile : ni rouge ni insuffisante', () => {
    const e = entree(appel([
      ...serie(10, 9, { item_id: 'it03' }),
      ...serie(10, 2, { item_id: 'it01' }),
      ...serie(10, 5, { item_id: 'it02' }),
    ]));
    assert.deepEqual(e.cartes_rouges, [{ set_id: SET, item_id: 'it01', n_reponses: 10, taux: 2 / 10 }]);
    assert.deepEqual(e.cartes_insuffisantes, []);
  });

  test('moins de 10 réponses : « insuffisante », jamais rouge, quel que soit le taux', () => {
    const e = entree(appel([...serie(9, 0, { item_id: 'it01' }), ...serie(3, 3, { item_id: 'it02' })]));
    assert.deepEqual(e.cartes_rouges, []);
    assert.deepEqual(e.cartes_insuffisantes, [
      { set_id: SET, item_id: 'it01', n_reponses: 9, taux: 0 },
      { set_id: SET, item_id: 'it02', n_reponses: 3, taux: 1 },
    ]);
  });

  test('encadrement du seuil rouge : 4/10 et 9/20 rouges, 10/20 (50 % pile) non rouge', () => {
    assert.deepEqual(entree(appel(serie(10, 4))).cartes_rouges, [{ set_id: SET, item_id: 'it01', n_reponses: 10, taux: 4 / 10 }]);
    assert.deepEqual(entree(appel(serie(20, 9))).cartes_rouges, [{ set_id: SET, item_id: 'it01', n_reponses: 20, taux: 9 / 20 }]);
    const pile = entree(appel(serie(20, 10)));
    assert.deepEqual(pile.cartes_rouges, []);
    assert.deepEqual(pile.cartes_insuffisantes, []);
  });

  test('11 réponses toutes fausses : rouge', () => {
    assert.deepEqual(entree(appel(serie(11, 0))).cartes_rouges, [{ set_id: SET, item_id: 'it01', n_reponses: 11, taux: 0 }]);
  });

  test('tri des cartes insuffisantes par set_id puis item_id (entrée en ordre inverse)', () => {
    const e = entree(appel([
      ...serie(2, 0, { lot: '02', item_id: 'it02' }),
      ...serie(2, 0, { lot: '02', item_id: 'it01' }),
      ...serie(2, 0, { lot: '01', item_id: 'it09' }),
    ]));
    assert.deepEqual(e.cartes_insuffisantes.map((c) => [c.set_id.slice(-2), c.item_id]), [['01', 'it09'], ['02', 'it01'], ['02', 'it02']]);
  });

  test('collision : même item_id dans deux lots -> deux cartes distinctes', () => {
    const e = entree(appel([...serie(10, 10, { lot: '02' }), ...serie(10, 0, { lot: '01' })]));
    assert.deepEqual(e.cartes_rouges, [{ set_id: 'set_fonda_proportionnalite_nI_01', item_id: 'it01', n_reponses: 10, taux: 0 }]);
  });

  test('tri des cartes par set_id puis item_id', () => {
    const e = entree(appel([
      ...serie(10, 0, { lot: '02', item_id: 'it02' }),
      ...serie(10, 0, { lot: '02', item_id: 'it01' }),
      ...serie(10, 0, { lot: '01', item_id: 'it09' }),
    ]));
    assert.deepEqual(e.cartes_rouges.map((c) => [c.set_id.slice(-2), c.item_id]), [['01', 'it09'], ['02', 'it01'], ['02', 'it02']]);
  });

  // 'a1' discrimine localeCompare (qui le classerait premier) ; It1/it10/it9 discrimine le tri numérique.
  test('tri des cartes par unités de code : [\'It1\', \'a1\', \'it10\', \'it9\'] (pas localeCompare, pas numérique)', () => {
    const ids = ['it9', 'a1', 'it10', 'It1'];
    const e = entree(appel([
      ...ids.flatMap((item_id) => serie(10, 0, { item_id })), // rouges
      ...ids.flatMap((item_id) => serie(2, 0, { lot: '01', item_id })), // insuffisantes
    ]));
    assert.deepEqual(e.cartes_rouges.map((c) => c.item_id), ['It1', 'a1', 'it10', 'it9']);
    assert.deepEqual(e.cartes_insuffisantes.map((c) => c.item_id), ['It1', 'a1', 'it10', 'it9']);
  });

  test('tri des cartes par unités de code, axe set_id : lots \'B\' avant \'a\' (pas localeCompare)', () => {
    const e = entree(appel([
      ...['a', 'B', 'A2', 'A10'].flatMap((set_id) => serie(10, 0, { set_id })), // rouges
      ...['a', 'B', 'A2', 'A10'].flatMap((set_id) => serie(2, 0, { set_id, item_id: 'it02' })), // insuffisantes
    ]));
    // 'B' avant 'a' : pas localeCompare ; 'A10' avant 'A2' : pas de tri naturel.
    assert.deepEqual(e.cartes_rouges.map((c) => c.set_id), ['A10', 'A2', 'B', 'a']);
    assert.deepEqual(e.cartes_insuffisantes.map((c) => c.set_id), ['A10', 'A2', 'B', 'a']);
  });

  test('cartes d\'une autre période : absentes', () => {
    const e = entree(appel(serie(10, 0, W41)));
    assert.deepEqual(e.cartes_rouges, []);
    assert.deepEqual(e.cartes_insuffisantes, []);
  });
});

// --- Adoption --------------------------------------------------------------------

describe('agregation — adoption par contexte (nombre de réponses)', () => {
  test('répartition par ctx sur la période, zéros explicites, invariant de somme', () => {
    const e = entree(appel([
      ...serie(5, 5, { ctx: 'df' }),
      ...serie(2, 1, { ctx: 'maison' }),
      ...serie(3, 0, { ctx: 'classe' }),
      ...serie(4, 4, { ...W41, ctx: 'classe' }), // P1 : hors période en cours
    ]));
    assert.deepEqual(e.adoption, { df: 5, maison: 2, classe: 3 });
    assert.equal(e.adoption.df + e.adoption.maison + e.adoption.classe, e.n_reponses);
  });
});

// --- Événements invalides ----------------------------------------------------------

describe('agregation — événements invalides (motif « invalide »)', () => {
  const sans = (cle) => { const e = ev(); delete e[cle]; return e; };
  const cas = [
    ['événement null', null],
    ['événement non objet', 'texte'],
    ['result = 2', { ...ev(), result: 2 }],
    ['result = "1"', { ...ev(), result: '1' }],
    ['result = true', { ...ev(), result: true }],
    ['result null', { ...ev(), result: null }],
    ['ctx inconnu', { ...ev(), ctx: 'cantine' }],
    ['palier inconnu', { ...ev(), palier: 'n0' }],
    ['ts illisible', { ...ev(), ts: 'hier' }],
    // Défi w2 (lundi 5 janv.) : si la date était normalisée en 2 mars, la réponse serait « vacances ».
    ['ts impossible (30 février)', ev({ semaine: 2, ts: '2026-02-30T10:00:00Z' })],
    ['ts sans fuseau', { ...ev(), ts: '2026-11-24T10:00:00' }],
    ['notion_id absent', sans('notion_id')],
    ['notion_id vide', { ...ev(), notion_id: '' }],
    ['notion_id non chaîne', { ...ev(), notion_id: 42 }],
    ['notion_id avec une majuscule', ev({ notion_id: 'maths.Proportionnalite' })],
    ['notion_id de domaine inconnu', ev({ notion_id: 'svt.cellule' })],
    ['notion_id sans slug', { ...ev(), notion_id: 'maths.' }],
    ['set_id absent', sans('set_id')],
    ['item_id vide', { ...ev(), item_id: '' }],
    ['niveau absent', sans('niveau')],
    ['niveau hors 6e-3e', { ...ev(), niveau: '2nde' }],
    ['niveau au format classe', { ...ev(), niveau: '601' }],
    ['defi_id absent', sans('defi_id')],
    ['defi_id sans semaine lisible', { ...ev(), defi_id: 'defi_2026_4e_proportionnalite_nI' }],
    ['defi_id semaine 0', { ...ev(), defi_id: 'defi_2026-w0_4e_proportionnalite_nI' }],
    ['defi_id semaine 54', { ...ev(), defi_id: 'defi_2026-w54_4e_proportionnalite_nI' }],
    // Réponse APRÈS le lundi nominal de 2027-w53 (3 janv. 2028) : si w53 était accepté, ce serait « futur ».
    ['defi_id 2027-w53 (année ISO à 52 semaines)', ev({ annee: 2027, semaine: 53, ts: '2028-01-05T10:00:00Z' })],
    ['défi postérieur à la réponse (w49 répondu le 24/11)', ev({ semaine: 49 })],
    ['défi postérieur d\'une heure (w49 répondu dim. 29/11, 23 h Paris)', ev({ semaine: 49, ts: '2026-11-29T22:00:00Z' })],
    ['defi_id au segment niveau au format classe (ancien {grp})', { ...ev(), defi_id: 'defi_2026-w48_401_proportionnalite_nI' }],
    ['defi_id au préfixe quelconque à la place du niveau', { ...ev(), defi_id: 'defi_2026-w48_nimporte_quoi_proportionnalite_nI' }],
    ['defi_id sans segment niveau', { ...ev(), defi_id: 'defi_2026-w48_proportionnalite_nI' }],
    // Liste FERMÉE {6e, 5e, 4e, 3e}, et non le motif « chiffre + e » (event.niveau reste valide : 4e).
    ['defi_id au segment niveau 7e (hors liste fermée)', { ...ev(), defi_id: 'defi_2026-w48_7e_proportionnalite_nI' }],
    ['defi_id au segment niveau 2e (hors liste fermée)', { ...ev(), defi_id: 'defi_2026-w48_2e_proportionnalite_nI' }],
    // Semaine sur 1 ou 2 chiffres, et non \d{1,3}.
    ['defi_id semaine sur 3 chiffres (w048)', { ...ev(), defi_id: 'defi_2026-w048_4e_proportionnalite_nI' }],
    ['defi_id dont le slug contredit notion_id', { ...ev(), defi_id: 'defi_2026-w48_4e_fractions_nI' }],
    ['defi_id dont le palier contredit palier', { ...ev(), defi_id: 'defi_2026-w48_4e_proportionnalite_nF' }],
  ];
  for (const [nom, mauvais] of cas) {
    test(`${nom} : ignoré, sans polluer taux, Δ, cartes ni adoption`, () => {
      const r = appel([mauvais, ...serie(10, 10)]);
      assert.deepEqual(r.ignores, { futur: 0, invalide: 1, vacances: 0 });
      assert.equal(r.entrees.length, 1);
      const e = entree(r);
      assert.equal(e.n_reponses, 10);
      assert.equal(e.taux_periode, 1);
      assert.deepEqual(e.adoption, { df: 10, maison: 0, classe: 0 });
      assert.deepEqual(e.delta.courante, { occurrence: '2026-w48', n_reponses: 10, taux: 1 });
      assert.equal(e.delta.precedente, null);
      assert.deepEqual(e.cartes_rouges, []);
      assert.deepEqual(e.cartes_insuffisantes, []);
    });
  }

  test('1b = B : seul le niveau du defi_id change (3e au lieu de 4e) -> sortie COMPLÈTE identique (result 1 et 0)', () => {
    for (const result of [1, 0]) {
      const courantes = (niveauDefi) => Array.from({ length: 12 }, (_, i) => ({
        ...ev({ niveau: '4e', result, item_id: i < 6 ? 'it01' : 'it02', ctx: i % 2 ? 'maison' : 'df' }),
        defi_id: `defi_2026-w48_${niveauDefi}_proportionnalite_nI`,
      }));
      const precedente = serie(10, 5, W45); // occurrence précédente : verrouille le Δ
      const concordant = appel([...precedente, ...courantes('4e')]);
      const discordant = appel([...precedente, ...courantes('3e')]);
      assert.deepEqual(discordant, concordant, `result ${result}`);
      // Garde : la fixture n'est pas triviale. w45 est aussi en P2 (10 + 12 réponses) ; le Δ ne garde
      // que la carte commune it01 (6 réponses courantes contre 10 précédentes).
      const e = entree(concordant);
      assert.equal(e.n_reponses, 22);
      assert.equal(e.n_reussites, 5 + 12 * result);
      assert.deepEqual(e.delta.courante, { occurrence: '2026-w48', n_reponses: 6, taux: result });
      assert.equal(e.delta.items_communs, 1);
    }
  });

  test('défi répondu dès le lundi 0 h de sa semaine (heure de Paris) : valide', () => {
    const r = appel([ev({ semaine: 49, ts: '2026-11-29T23:00:00Z' })]); // lun. 30 nov., 0 h Paris
    assert.deepEqual(r.ignores, AUCUN_IGNORE);
  });

  test('2026-w53 existe (année ISO à 53 semaines) : pas invalide (ici : vacances de Noël)', () => {
    const r = appel([
      ev({ annee: 2026, semaine: 53, ts: '2026-12-29T10:00:00Z' }),
      ev({ annee: 2026, semaine: 53, ts: '2027-01-02T10:00:00Z' }), // répondu début janvier 2027
    ], '2027-01-10');
    assert.deepEqual(r.ignores, { futur: 0, invalide: 0, vacances: 2 });
  });

  test('lot entièrement invalide : aucune entrée', () => {
    const r = appel([{ ...ev(), result: 'x' }, { ...ev(), ctx: '' }]);
    assert.deepEqual(r.entrees, []);
    assert.equal(r.ignores.invalide, 2);
  });
});

// --- Non-régression (relecture Codex du 2026-11-26) ---------------------------------

describe('agregation — non-régression', () => {
  test('cartes : les séparateurs testés (\\0 | / : ~) ne confondent pas deux couples (set_id, item_id)', () => {
    for (const sep of ['\u0000', '|', '/', ':', '~']) {
      const e = entree(appel([
        ...serie(10, 0, { set_id: `A${sep}B`, item_id: 'C' }),
        ...serie(10, 10, { set_id: 'A', item_id: `B${sep}C` }),
      ]));
      assert.deepEqual(e.cartes_rouges, [{ set_id: `A${sep}B`, item_id: 'C', n_reponses: 10, taux: 0 }], `séparateur ${JSON.stringify(sep)}`);
    }
  });

  test('Δ : les séparateurs testés (\\0 | / : ~) ne créent pas de carte commune entre deux occurrences', () => {
    for (const sep of ['\u0000', '|', '/', ':', '~']) {
      const d = entree(appel([
        ev({ ...W45, set_id: `A${sep}B`, item_id: 'C', result: 0 }),
        ev({ set_id: 'A', item_id: `B${sep}C`, result: 1 }),
      ])).delta;
      assert.deepEqual(d, {
        valeur: null, items_communs: 0,
        courante: { occurrence: '2026-w48', n_reponses: 0, taux: null },
        precedente: { occurrence: '2026-w45', n_reponses: 0, taux: null },
      }, `séparateur ${JSON.stringify(sep)}`);
    }
  });

  test('date de Paris : jamais lue dans le texte d\'affichage (format() neutralisé, résultat identique)', () => {
    const evts = [
      ev({ ts: '2026-12-04T22:00:00Z' }), ev({ ts: '2026-12-04T23:00:00Z' }), // 23 h / 0 h Paris
      ev({ ts: '2026-10-16T21:00:00Z', semaine: 42 }), ev({ ts: '2026-11-01T23:00:00Z', semaine: 45 }),
    ];
    const attendu = JSON.stringify(appel(evts));
    // `format` est un ACCESSEUR du prototype : on remplace son descripteur, puis on le restaure.
    const proto = Intl.DateTimeFormat.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, 'format');
    Object.defineProperty(proto, 'format', { configurable: true, get() { return () => '04/12/2026'; } });
    try { assert.equal(JSON.stringify(appel(evts)), attendu); } finally { Object.defineProperty(proto, 'format', original); }
  });

  test('événement lu une seule fois : un accès par champ ; accesseurs (9 champs) jamais appelés ; héritage ou Proxy qui lève -> invalide', () => {
    const CHAMPS = ['ts', 'niveau', 'defi_id', 'notion_id', 'palier', 'set_id', 'item_id', 'result', 'ctx'];
    // Proxy qui rend le descripteur au 1er accès d'un champ et LÈVE au 2e (descripteur ou lecture).
    const acces = new Map();
    const compter = (k) => {
      const n = (acces.get(k) || 0) + 1;
      acces.set(k, n);
      if (n > 1) throw new Error(`2e accès à ${String(k)}`);
    };
    const unAcces = new Proxy(ev(), {
      getOwnPropertyDescriptor(t, k) { compter(k); return Reflect.getOwnPropertyDescriptor(t, k); },
      get(t, k, rec) { compter(k); return Reflect.get(t, k, rec); },
    });
    // Un accesseur instrumenté sur CHACUN des neuf champs : rejet, et zéro invocation.
    let lectures = 0;
    const accesseurs = CHAMPS.map((k) => {
      const e = ev();
      const valeur = e[k];
      Object.defineProperty(e, k, { enumerable: true, get() { lectures += 1; return valeur; } });
      return e;
    });
    const herite = Object.create(ev());
    const piege = new Proxy(ev(), { get() { throw new Error('piège'); }, getOwnPropertyDescriptor() { throw new Error('piège'); } });
    const r = appel([unAcces, ...accesseurs, herite, piege, ...serie(10, 10)]);
    assert.deepEqual(r.ignores, { futur: 0, invalide: CHAMPS.length + 2, vacances: 0 });
    const e = entree(r);
    assert.equal(e.n_reponses, 11); // l'événement lu une seule fois est ACCEPTÉ
    assert.equal(e.n_reussites, 11);
    for (const k of CHAMPS) assert.equal(acces.get(k), 1, `champ ${k} : ${acces.get(k)} accès`);
    assert.equal(lectures, 0); // aucun accesseur rejeté n'est jamais appelé
  });

  test('horodatage : fraction de seconde de longueur quelconque acceptée', () => {
    const r = appel([
      ev({ ts: '2026-11-24T10:00:00.5Z' }),
      ev({ ts: '2026-11-24T10:00:00.123Z' }),
      ev({ ts: '2026-11-24T10:00:00.123456789+01:00' }),
    ]);
    assert.deepEqual(r.ignores, AUCUN_IGNORE);
    assert.equal(entree(r).n_reponses, 3);
  });
});
