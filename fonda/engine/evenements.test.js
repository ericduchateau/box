// Suite de tests — émission d'événements Box-FONDA (T3).
// Référence : docs/PRD-Box-FONDA.md §3.2, §5.1, §6 ; AGENTS.md G2/G3.
// Écrite à partir de la table de cas-limites validée par Éric, AVANT l'implémentation
// (fonda/engine/evenements.js). Zéro dépendance, test runner natif Node.
//
// Usage : node --test fonda/engine/evenements.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  soumettreTentative,
  extraireGrpDepuisDefiId,
  grpEstAutorise,
  ctxEstValide,
  CLE_VERROUS,
  CLE_HISTORIQUE,
  CLE_FILE,
} = require('./evenements.js');

const CLASSES = require('../data/classes.json');
const REFERENTIEL = require('../data/referentiel.json');
const NOTION_IDS = new Set(REFERENTIEL.notions.map((n) => n.id));
const UNE_NOTION = REFERENTIEL.notions[0].id;

// --- Stockage factice (zéro dépendance, pas de vrai localStorage) ----------------

function creerStockageFactice() {
  const data = new Map();
  return {
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { data.set(k, String(v)); },
    removeItem(k) { data.delete(k); },
    _brut: data, // accès direct pour les assertions de test
  };
}

function creerStockageIndisponible() {
  return {
    getItem() { throw new Error('SecurityError: stockage bloqué'); },
    setItem() { throw new Error('SecurityError: stockage bloqué'); },
  };
}

const CONTEXTE_BASE = {
  defiId: 'defi_2026-w41_601_fractions',
  itemId: 'it01',
  setId: 'box_fonda_test01',
  notionId: UNE_NOTION,
  palier: 'nI',
  ctx: 'classe',
  reussite: true,
  scored: true,
  classesAutorisees: CLASSES,
  notionIdsConnus: NOTION_IDS,
};

function soumettre(overrides = {}, stockage = creerStockageFactice(), maintenant = () => new Date('2026-10-05T10:23:41Z')) {
  return soumettreTentative({ ...CONTEXTE_BASE, ...overrides, stockage, maintenant });
}

describe('cas 1 — soumission admissible : event conforme, rang_local 1, dt_jours null, ts arrondi à l\'heure', () => {
  test('grp lu depuis defi_id, result=1, conforme au validateur T1', () => {
    const r = soumettre();
    assert.equal(r.emis, true);
    assert.equal(r.event.grp, '601');
    assert.equal(r.event.result, 1);
    assert.equal(r.event.rang_local, 1);
    assert.equal(r.event.dt_jours, null);
  });

  test('ts arrondi à l\'heure : minutes/secondes/ms à 00', () => {
    const r = soumettre();
    const d = new Date(r.event.ts);
    assert.equal(d.getUTCMinutes(), 0);
    assert.equal(d.getUTCSeconds(), 0);
    assert.equal(d.getUTCMilliseconds(), 0);
  });

  test('result=0 quand la réponse n\'est pas réussie', () => {
    const r = soumettre({ reussite: false });
    assert.equal(r.event.result, 0);
  });

  test('l\'événement contient EXACTEMENT les 11 champs du schéma, rien d\'autre', () => {
    const r = soumettre();
    assert.deepEqual(
      Object.keys(r.event).sort(),
      ['ctx', 'defi_id', 'dt_jours', 'grp', 'item_id', 'notion_id', 'palier', 'rang_local', 'result', 'set_id', 'ts'].sort(),
    );
  });
});

describe('cas 2/13 — un vote par (defi_id, item_id) : rechargement / double-clic / deux onglets sur le même store', () => {
  test('2e soumission identique (même defi_id, même item_id) -> aucun 2e event', () => {
    const stockage = creerStockageFactice();
    const r1 = soumettre({}, stockage);
    const r2 = soumettre({}, stockage);
    assert.equal(r1.emis, true);
    assert.equal(r2.emis, false);
    assert.equal(r2.raison, 'deja_vote');
    const file = JSON.parse(stockage.getItem(CLE_FILE));
    assert.equal(file.length, 1);
  });

  test('deux "onglets" (deux appels successifs sur le MÊME store partagé) -> un seul event', () => {
    const stockagePartage = creerStockageFactice();
    const onglet1 = soumettre({}, stockagePartage);
    const onglet2 = soumettre({}, stockagePartage);
    assert.equal([onglet1.emis, onglet2.emis].filter(Boolean).length, 1);
    const file = JSON.parse(stockagePartage.getItem(CLE_FILE));
    assert.equal(file.length, 1);
  });
});

describe('cas 3 — seconde chance (scored:false) : aucune émission, aucune écriture, rang_local inchangé', () => {
  test('scored:false -> emis:false, raison non_score, storage totalement intact', () => {
    const stockage = creerStockageFactice();
    const r = soumettre({ scored: false }, stockage);
    assert.equal(r.emis, false);
    assert.equal(r.raison, 'non_score');
    assert.equal(stockage.getItem(CLE_VERROUS), null);
    assert.equal(stockage.getItem(CLE_HISTORIQUE), null);
    assert.equal(stockage.getItem(CLE_FILE), null);
  });

  test('1re tentative scorée, puis "seconde chance" sur le même item -> rang_local de la tentative suivante reste 2, pas 3', () => {
    const stockage = creerStockageFactice();
    soumettre({}, stockage); // 1re tentative, scored
    soumettre({ scored: false, reussite: true }, stockage); // seconde chance, ignorée
    const suivante = soumettre(
      { defiId: 'defi_2026-w42_601_fractions' }, // occurrence suivante
      stockage,
      () => new Date('2026-10-12T10:00:00Z'),
    );
    assert.equal(suivante.event.rang_local, 2);
  });
});

describe('cas 4 — même item, occurrence suivante (autre defi_id) : nouvel event, rang_local 2, dt_jours > 0', () => {
  test('rang_local incrémente, dt_jours = jours écoulés entier >= 0', () => {
    const stockage = creerStockageFactice();
    soumettre({}, stockage, () => new Date('2026-10-05T10:00:00Z'));
    const r2 = soumettre(
      { defiId: 'defi_2026-w42_601_fractions' },
      stockage,
      () => new Date('2026-10-12T14:00:00Z'),
    );
    assert.equal(r2.emis, true);
    assert.equal(r2.event.rang_local, 2);
    assert.equal(r2.event.dt_jours, 7);
    assert.equal(Number.isInteger(r2.event.dt_jours), true);
  });
});

describe('cas 5 — grp hors classes.json : aucun event (entraînement)', () => {
  test('grpEstAutorise rejette "6e4", "604 " (espace), "abc" ; accepte "601"', () => {
    assert.equal(grpEstAutorise('6e4', CLASSES), false);
    assert.equal(grpEstAutorise('604 ', CLASSES), false);
    assert.equal(grpEstAutorise('abc', CLASSES), false);
    assert.equal(grpEstAutorise('601', CLASSES), true);
  });

  test('defi_id bien formé mais grp absent du roster (ex. "609") -> aucun event', () => {
    const r = soumettre({ defiId: 'defi_2026-w41_609_fractions' });
    assert.equal(r.emis, false);
    assert.equal(r.raison, 'grp_non_autorise');
  });
});

describe('cas 6 — ctx : seuls df/maison/classe émettent', () => {
  test('ctx="autre" -> aucun event', () => {
    const r = soumettre({ ctx: 'autre' });
    assert.equal(r.emis, false);
    assert.equal(r.raison, 'contexte_invalide');
  });

  test('ctxEstValide couvre exactement df/maison/classe', () => {
    assert.equal(ctxEstValide('df'), true);
    assert.equal(ctxEstValide('maison'), true);
    assert.equal(ctxEstValide('classe'), true);
    assert.equal(ctxEstValide('autre'), false);
    assert.equal(ctxEstValide(undefined), false);
  });
});

describe('cas 7 — liste blanche stricte : un champ hors schéma est toujours rejeté', () => {
  const { validerEvenement } = require('../scripts/validate.js');

  test('un champ nominatif ou technique (eleve, nom, ip, uuid, email) rend l\'événement invalide', () => {
    const base = soumettre().event;
    for (const champ of ['eleve', 'nom', 'ip', 'uuid', 'email']) {
      const corrompu = { ...base, [champ]: 'x' };
      const v = validerEvenement(corrompu, NOTION_IDS);
      assert.equal(v.valide, false, `champ "${champ}" aurait dû être rejeté`);
    }
  });

  test('un paramètre étranger passé à soumettreTentative (ex. nomEleve) ne fuite jamais dans l\'event construit', () => {
    const r = soumettre({ nomEleve: 'Dupont' });
    assert.equal('nomEleve' in r.event, false);
  });
});

describe('cas 8 — defi_id inconnu / absent / malformé : aucun event, pas d\'occurrence fabriquée', () => {
  test('defi_id absent, vide, ou ne respectant pas le format', () => {
    for (const defiId of [undefined, null, '', 'nimporte-quoi', 'defi_2026-w41_fractions']) {
      const r = soumettre({ defiId });
      assert.equal(r.emis, false);
      assert.equal(r.raison, 'defi_id_invalide', `defiId=${JSON.stringify(defiId)}`);
    }
  });

  test('extraireGrpDepuisDefiId retourne null sur une forme invalide, le grp sinon', () => {
    assert.equal(extraireGrpDepuisDefiId('defi_2026-w41_601_fractions'), '601');
    assert.equal(extraireGrpDepuisDefiId('defi_2026-w41_6e4_fractions'), null);
    assert.equal(extraireGrpDepuisDefiId(''), null);
    assert.equal(extraireGrpDepuisDefiId(undefined), null);
  });
});

describe('cas 9 — stockage local indisponible : aucun event, révision possible (pas d\'exception)', () => {
  test('getItem/setItem qui lèvent -> emis:false, raison stockage_indisponible, pas d\'exception', () => {
    const stockage = creerStockageIndisponible();
    assert.doesNotThrow(() => soumettre({}, stockage));
    const r = soumettre({}, stockage);
    assert.equal(r.emis, false);
    assert.equal(r.raison, 'stockage_indisponible');
  });

  test('stockage absent (null/undefined) -> aucun event, pas d\'exception', () => {
    assert.doesNotThrow(() => soumettreTentative({ ...CONTEXTE_BASE, stockage: null, maintenant: () => new Date() }));
    const r = soumettreTentative({ ...CONTEXTE_BASE, stockage: null, maintenant: () => new Date() });
    assert.equal(r.emis, false);
    assert.equal(r.raison, 'stockage_indisponible');
  });

  test('JSON corrompu dans le store -> aucun event, pas d\'exception (doute = pas d\'émission)', () => {
    const stockage = creerStockageFactice();
    stockage.setItem(CLE_VERROUS, '{ pas du json valide');
    assert.doesNotThrow(() => soumettre({}, stockage));
    const r = soumettre({}, stockage);
    assert.equal(r.emis, false);
    assert.equal(r.raison, 'stockage_corrompu');
  });
});

describe('cas 10 — l\'event déjà émis est immuable : pas de 2e vote, pas de mutation rétroactive', () => {
  test('un 2e appel sur le même (defi_id, item_id) ne modifie pas l\'event déjà en file', () => {
    const stockage = creerStockageFactice();
    const r1 = soumettre({ reussite: true }, stockage);
    soumettre({ reussite: false }, stockage); // tentative de "changer" le résultat -> ignorée
    const file = JSON.parse(stockage.getItem(CLE_FILE));
    assert.equal(file.length, 1);
    assert.equal(file[0].result, r1.event.result);
    assert.equal(file[0].grp, r1.event.grp);
  });
});

describe('cas 11 — horloge reculée / date future : dt_jours jamais négatif ni NaN', () => {
  test('horloge reculée par rapport à l\'historique -> dt_jours borné à 0, jamais négatif', () => {
    const stockage = creerStockageFactice();
    soumettre({}, stockage, () => new Date('2026-10-12T10:00:00Z'));
    const r2 = soumettre(
      { defiId: 'defi_2026-w40_601_fractions' },
      stockage,
      () => new Date('2026-10-05T10:00:00Z'), // "avant" le passage précédent
    );
    assert.equal(r2.emis, true);
    assert.equal(r2.event.dt_jours, 0);
    assert.equal(Number.isNaN(r2.event.dt_jours), false);
  });

  test('maintenant() invalide (pas une Date, ou Date invalide) -> aucun event, pas d\'exception', () => {
    for (const mauvaiseDate of [() => 'pas une date', () => new Date('invalide'), null]) {
      const r = soumettre({}, creerStockageFactice(), mauvaiseDate);
      assert.equal(r.emis, false, `maintenant=${String(mauvaiseDate)}`);
    }
    // undefined explicite (pas juste omis) contourne le paramètre par défaut du
    // helper soumettre() -> appel direct au moteur pour bien tester ce cas précis.
    assert.doesNotThrow(() => soumettreTentative({ ...CONTEXTE_BASE, stockage: creerStockageFactice(), maintenant: undefined }));
    const r = soumettreTentative({ ...CONTEXTE_BASE, stockage: creerStockageFactice(), maintenant: undefined });
    assert.equal(r.emis, false);
    assert.equal(r.raison, 'horloge_invalide');
  });
});

describe('cas 14 — immuabilité de l\'objet en file (prêt pour une reprise T5 sans duplication)', () => {
  test('l\'event retourné est gelé (Object.freeze)', () => {
    const r = soumettre();
    assert.equal(Object.isFrozen(r.event), true);
    assert.throws(() => { r.event.result = 0; }, TypeError);
  });

  test('la file stockée correspond exactement à l\'event retourné', () => {
    const stockage = creerStockageFactice();
    const r = soumettre({}, stockage);
    const file = JSON.parse(stockage.getItem(CLE_FILE));
    assert.deepEqual(file[0], r.event);
  });
});

describe('garde-fou — contexte incomplet (item/set/notion/palier non fournis par l\'appelant)', () => {
  test('un champ de contexte manquant -> aucun event, jamais inventé', () => {
    for (const champ of ['itemId', 'setId', 'notionId', 'palier']) {
      const r = soumettre({ [champ]: undefined });
      assert.equal(r.emis, false, `champ manquant : ${champ}`);
    }
  });
});
