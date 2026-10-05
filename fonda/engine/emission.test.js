// Suite de tests — émission réseau de la file locale, Box-FONDA (T5).
// Référence : docs/PRD-Box-FONDA.md §2, §3.2 ; AGENTS.md G2/G3. Écrite AVANT
// l'implémentation (fonda/engine/emission.js). Zéro dépendance, test runner natif Node.
//
// Usage : node --test fonda/engine/emission.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { viderFileEvenements } = require('./emission.js');
const { soumettreTentative, lireFile, CLE_MESURE } = require('./evenements.js');

const CLASSES = require('../data/classes.json');
const REFERENTIEL = require('../data/referentiel.json');
const NOTION_IDS = new Set(REFERENTIEL.notions.map((n) => n.id));
const UNE_NOTION = REFERENTIEL.notions[0].id;

// --- Stockage factice (zéro dépendance, même style que les tests T3/T4) ----------

function creerStockageFactice() {
  const data = new Map();
  return {
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { data.set(k, String(v)); },
  };
}

const CONTEXTE_BASE = {
  setId: 'box_fonda_test01',
  notionId: UNE_NOTION,
  palier: 'nI',
  ctx: 'classe',
  reussite: true,
  scored: true,
  classesAutorisees: CLASSES,
  notionIdsConnus: NOTION_IDS,
  maintenant: () => new Date('2026-10-05T10:00:00Z'),
};

// Met N événements distincts (defi_id différent à chaque fois -> items distincts
// aussi, pour éviter le verrou T3) dans la file d'un stockage donné.
function remplirFile(stockage, n) {
  for (let i = 0; i < n; i += 1) {
    soumettreTentative({
      ...CONTEXTE_BASE,
      defiId: `defi_2026-w4${i}_601_fractions`,
      itemId: `it0${i}`,
      stockage,
    });
  }
}

describe('cas — file vidée dans l\'ordre, succès -> marqué envoyé (retiré de la file)', () => {
  test('3 événements, tous envoyés avec succès -> file vide, appels dans l\'ordre, résumé correct', async () => {
    const stockage = creerStockageFactice();
    remplirFile(stockage, 3);
    const ordreEnvoye = [];
    const envoyer = async (url, corps) => { ordreEnvoye.push(corps.item_id); return true; };

    const resultat = await viderFileEvenements({ stockage, webhookUrl: 'https://exemple/box-fonda-events', envoyer });

    assert.deepEqual(ordreEnvoye, ['it00', 'it01', 'it02']);
    assert.deepEqual(lireFile(stockage), []);
    assert.deepEqual(resultat, { tentes: 3, envoyes: 3, echecs: 0, invalides: 0 });
  });
});

describe('cas — échec réseau : l\'événement reste en file, pas de perte, pas de doublon', () => {
  test('envoyer() renvoie false -> événement toujours présent dans la file après coup', async () => {
    const stockage = creerStockageFactice();
    remplirFile(stockage, 1);
    const resultat = await viderFileEvenements({ stockage, webhookUrl: 'https://exemple/box-fonda-events', envoyer: async () => false });

    assert.equal(resultat.envoyes, 0);
    assert.equal(resultat.echecs, 1);
    assert.equal(lireFile(stockage).length, 1);
  });

  test('envoyer() qui lève une exception -> traité comme un échec, jamais propagé, événement conservé', async () => {
    const stockage = creerStockageFactice();
    remplirFile(stockage, 1);
    const envoyer = async () => { throw new Error('reseau indisponible'); };

    await assert.doesNotReject(viderFileEvenements({ stockage, webhookUrl: 'https://exemple/box-fonda-events', envoyer }));
    const resultat = await viderFileEvenements({ stockage, webhookUrl: 'https://exemple/box-fonda-events', envoyer });
    assert.equal(resultat.echecs, 1);
    assert.equal(lireFile(stockage).length, 1);
  });

  test('un échec sur un événement n\'empêche pas les suivants d\'être tentés et envoyés', async () => {
    const stockage = creerStockageFactice();
    remplirFile(stockage, 3);
    const envoyer = async (url, corps) => corps.item_id !== 'it00'; // it00 échoue, les autres réussissent

    const resultat = await viderFileEvenements({ stockage, webhookUrl: 'https://exemple/box-fonda-events', envoyer });

    assert.equal(resultat.tentes, 3);
    assert.equal(resultat.envoyes, 2);
    assert.equal(resultat.echecs, 1);
    const restant = lireFile(stockage);
    assert.equal(restant.length, 1);
    assert.equal(restant[0].item_id, 'it00');
  });
});

describe('cas — réessai : renvoie le même événement figé, jamais un nouveau', () => {
  test('après un échec, le 2e appel envoie un corps strictement identique (même ts) au 1er essai', async () => {
    const stockage = creerStockageFactice();
    remplirFile(stockage, 1);
    const corpsEnvoyes = [];
    const envoyerEchoue = async (url, corps) => { corpsEnvoyes.push(corps); return false; };
    await viderFileEvenements({ stockage, webhookUrl: 'https://exemple/box-fonda-events', envoyer: envoyerEchoue });

    const envoyerReussit = async (url, corps) => { corpsEnvoyes.push(corps); return true; };
    await viderFileEvenements({ stockage, webhookUrl: 'https://exemple/box-fonda-events', envoyer: envoyerReussit });

    assert.equal(corpsEnvoyes.length, 2);
    assert.deepEqual(corpsEnvoyes[0], corpsEnvoyes[1], 'le réessai doit renvoyer EXACTEMENT le même corps, pas un nouveau ts/état');
  });

  test('un 3e appel sur une file déjà vidée ne retente rien (0 tentative, résultat neutre)', async () => {
    const stockage = creerStockageFactice();
    remplirFile(stockage, 1);
    await viderFileEvenements({ stockage, webhookUrl: 'https://exemple/box-fonda-events', envoyer: async () => true });
    const resultat = await viderFileEvenements({ stockage, webhookUrl: 'https://exemple/box-fonda-events', envoyer: async () => true });
    assert.deepEqual(resultat, { tentes: 0, envoyes: 0, echecs: 0, invalides: 0 });
  });
});

describe('cas — corps limité STRICTEMENT aux 11 champs du schéma, rien d\'autre, même si la file en contient davantage', () => {
  test('un événement en file avec des champs étrangers (ex. corruption, champ en trop) -> le corps envoyé n\'a que les 11 clés', async () => {
    const stockage = creerStockageFactice();
    remplirFile(stockage, 1);
    // Simule une file corrompue/enrichie par erreur (pas via soumettreTentative, qui ne
    // le permettrait pas) : écrit directement un événement avec un champ étranger.
    const mesure = JSON.parse(stockage.getItem(CLE_MESURE));
    mesure.file[0] = { ...mesure.file[0], uuid_fantome: 'ne-doit-jamais-partir', ip: '1.2.3.4' };
    stockage.setItem(CLE_MESURE, JSON.stringify(mesure));

    let corpsRecu = null;
    const envoyer = async (url, corps) => { corpsRecu = corps; return true; };
    await viderFileEvenements({ stockage, webhookUrl: 'https://exemple/box-fonda-events', envoyer });

    assert.ok(corpsRecu, 'un envoi devait avoir lieu');
    assert.deepEqual(
      Object.keys(corpsRecu).sort(),
      ['ctx', 'defi_id', 'dt_jours', 'grp', 'item_id', 'notion_id', 'palier', 'rang_local', 'result', 'set_id', 'ts'].sort(),
    );
    assert.equal('uuid_fantome' in corpsRecu, false);
    assert.equal('ip' in corpsRecu, false);
  });

  test('un événement devenu invalide (hors schéma après corruption) n\'est jamais envoyé, mais ne bloque pas la file', async () => {
    const stockage = creerStockageFactice();
    remplirFile(stockage, 2);
    const mesure = JSON.parse(stockage.getItem(CLE_MESURE));
    mesure.file[0].ctx = 'contexte-invalide'; // casse l'enum ctx -> validerEvenement doit rejeter
    stockage.setItem(CLE_MESURE, JSON.stringify(mesure));

    let appels = 0;
    const envoyer = async () => { appels += 1; return true; };
    const resultat = await viderFileEvenements({ stockage, webhookUrl: 'https://exemple/box-fonda-events', envoyer });

    assert.equal(resultat.invalides, 1);
    assert.equal(resultat.envoyes, 1);
    assert.equal(appels, 1); // seul le 2e event (valide) a été réellement envoyé
  });

  test('(critique Codex) contrôle de FORME au-delà des noms de champs : métadonnée/texte libre glissé dans un champ autorisé -> jamais envoyé', async () => {
    const stockage = creerStockageFactice();
    remplirFile(stockage, 1);
    const mesure = JSON.parse(stockage.getItem(CLE_MESURE));
    mesure.file[0].set_id = 'IP=192.0.2.10; device=synthetic'; // texte libre dans un champ autorisé
    stockage.setItem(CLE_MESURE, JSON.stringify(mesure));

    let appele = false;
    const envoyer = async () => { appele = true; return true; };
    const resultat = await viderFileEvenements({ stockage, webhookUrl: 'https://exemple/box-fonda-events', envoyer });

    assert.equal(appele, false, 'un set_id contenant du texte libre ne doit jamais partir sur le réseau');
    assert.equal(resultat.invalides, 1);
    assert.equal(resultat.envoyes, 0);
  });

  test('(critique Codex) ts non tronqué à l\'heure (événement falsifié) -> jamais envoyé', async () => {
    const stockage = creerStockageFactice();
    remplirFile(stockage, 1);
    const mesure = JSON.parse(stockage.getItem(CLE_MESURE));
    mesure.file[0].ts = '2026-10-05T10:23:45.678Z'; // précision à la seconde/ms, jamais produite par T3
    stockage.setItem(CLE_MESURE, JSON.stringify(mesure));

    let appele = false;
    const envoyer = async () => { appele = true; return true; };
    const resultat = await viderFileEvenements({ stockage, webhookUrl: 'https://exemple/box-fonda-events', envoyer });

    assert.equal(appele, false, 'un ts non tronqué à l\'heure ne doit jamais partir sur le réseau (anti-réidentification)');
    assert.equal(resultat.invalides, 1);
  });

  test('(critique Codex) grp incohérent avec le defi_id (falsifié) -> jamais envoyé', async () => {
    const stockage = creerStockageFactice();
    remplirFile(stockage, 1);
    const mesure = JSON.parse(stockage.getItem(CLE_MESURE));
    mesure.file[0].grp = '999'; // ne correspond plus au grp encodé dans defi_id
    stockage.setItem(CLE_MESURE, JSON.stringify(mesure));

    const resultat = await viderFileEvenements({ stockage, webhookUrl: 'https://exemple/box-fonda-events', envoyer: async () => true });
    assert.equal(resultat.invalides, 1);
    assert.equal(resultat.envoyes, 0);
  });
});

describe('cas — URL de webhook non configurée : mode dégradé, ne bloque jamais la révision', () => {
  test('webhookUrl absent/vide -> aucune tentative, aucune exception, file intacte', async () => {
    const stockage = creerStockageFactice();
    remplirFile(stockage, 2);
    let appele = false;
    const envoyer = async () => { appele = true; return true; };

    for (const webhookUrl of [undefined, null, '']) {
      const resultat = await viderFileEvenements({ stockage, webhookUrl, envoyer });
      assert.deepEqual(resultat, { tentes: 0, envoyes: 0, echecs: 0, invalides: 0 });
    }
    assert.equal(appele, false);
    assert.equal(lireFile(stockage).length, 2);
  });
});

describe('garde-fou — stockage indisponible/corrompu : jamais d\'exception', () => {
  test('stockage qui lève -> résultat neutre, pas d\'exception', async () => {
    const stockageCasse = { getItem() { throw new Error('bloqué'); }, setItem() { throw new Error('bloqué'); } };
    await assert.doesNotReject(viderFileEvenements({ stockage: stockageCasse, webhookUrl: 'https://exemple/box-fonda-events', envoyer: async () => true }));
    const resultat = await viderFileEvenements({ stockage: stockageCasse, webhookUrl: 'https://exemple/box-fonda-events', envoyer: async () => true });
    assert.deepEqual(resultat, { tentes: 0, envoyes: 0, echecs: 0, invalides: 0 });
  });

  test('blob de mesure corrompu (JSON invalide) -> résultat neutre, pas d\'exception', async () => {
    const stockage = creerStockageFactice();
    stockage.setItem(CLE_MESURE, '{ pas du json valide');
    await assert.doesNotReject(viderFileEvenements({ stockage, webhookUrl: 'https://exemple/box-fonda-events', envoyer: async () => true }));
  });
});
