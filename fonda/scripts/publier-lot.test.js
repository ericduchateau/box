// Tests de fonda/scripts/publier-lot.js — la publication exige un lot relu, sans
// secret, intact par rapport à ce qui a été relu, et une attestation d'un type accepté.
// Usage : node --test fonda/scripts/publier-lot.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../engine/catalogue.js');
const { preparerPublication, TYPES_ACCEPTES_PAR_DEFAUT } = require('./publier-lot.js');

const REFERENTIEL = require('../data/referentiel.json');
const CATALOGUE = require('../data/catalogue-fonda.json');
const sha256Hex = C.sha256WebCrypto();
const copie = (o) => JSON.parse(JSON.stringify(o));

// Nouveau lot (séquence _02) fabriqué à partir d'un lot publié : contenu réel,
// garde-fous du correcteur déjà passés.
const BASE = require('../data/lots/set_fonda_comprendre-consigne_nI_01.json');
function nouveauLot() {
  const l = copie(BASE);
  l.set_id = 'set_fonda_comprendre-consigne_nI_02';
  l.cartes.forEach((c) => { c.set_id = l.set_id; });
  return l;
}
async function attestationN8n(lot, extra = {}) {
  return {
    type: 'n8n-relecture',
    relecteur: { id: 'justine', nom_affiche: 'Justine Leblanc' },
    selection: lot.cartes.map((c) => c.item_id),
    empreinte_relue: await C.calculerEmpreinte(lot, sha256Hex),
    ...extra,
  };
}
const base = (extra) => ({ catalogue: copie(CATALOGUE), referentiel: REFERENTIEL, sha256Hex, ...extra });

describe('publier-lot — refus par défaut tant que la relecture n8n n\'a pas de source de confiance', () => {
  test('aucun type d\'attestation accepté par défaut', () => {
    assert.deepEqual([...TYPES_ACCEPTES_PAR_DEFAUT], []);
  });
  test('attestation n8n-relecture parfaitement cohérente -> REFUSÉE par défaut (bloc 2)', async () => {
    const lot = nouveauLot();
    const r = await preparerPublication(base({ lot, attestation: await attestationN8n(lot) }));
    assert.equal(r.ok, false);
    assert.match(r.erreurs.join(), /non accepté/);
  });
  test('attestation manuelle-historique -> jamais pour un nouveau lot', async () => {
    const lot = nouveauLot();
    const r = await preparerPublication(base({ lot, attestation: { type: 'manuelle-historique' }, typesAcceptes: ['manuelle-historique'] }));
    assert.equal(r.ok, false);
    assert.match(r.erreurs.join(), /réservée/);
  });
  test('sans attestation -> refusé', async () => {
    const r = await preparerPublication(base({ lot: nouveauLot(), attestation: null, typesAcceptes: ['n8n-relecture'] }));
    assert.equal(r.ok, false);
  });
});

describe('publier-lot — contrôles de la chaîne (type n8n-relecture injecté pour le test)', () => {
  const T = { typesAcceptes: ['n8n-relecture'] };

  test('cas nominal : entrée ajoutée, catalogue résultant valide, empreinte attestée = empreinte du fichier', async () => {
    const lot = nouveauLot();
    const r = await preparerPublication(base({ lot, attestation: await attestationN8n(lot), ...T }));
    assert.equal(r.ok, true, JSON.stringify(r.erreurs));
    assert.equal(r.fichier, 'lots/set_fonda_comprendre-consigne_nI_02.json');
    assert.equal(r.catalogue.lots.length, CATALOGUE.lots.length + 1);
    assert.equal(r.entree.empreinte, r.entree.attestation.empreinte_attestee);
    assert.deepEqual(C.validerCatalogue(r.catalogue, REFERENTIEL).valide, true);
  });

  test('contenu modifié APRÈS relecture (empreinte relue ≠) -> refusé', async () => {
    const lot = nouveauLot();
    const att = await attestationN8n(lot);
    lot.cartes[0].question += ' (modifiée)';
    const r = await preparerPublication(base({ lot, attestation: att, ...T }));
    assert.equal(r.ok, false);
    assert.match(r.erreurs.join(), /empreinte relue/);
  });

  test('sélection attestée ≠ cartes du fichier -> refusé', async () => {
    const lot = nouveauLot();
    const r = await preparerPublication(base({ lot, attestation: await attestationN8n(lot, { selection: ['it01'] }), ...T }));
    assert.equal(r.ok, false);
  });

  test('set_id déjà publié -> refusé (immuable)', async () => {
    const lot = copie(BASE);
    const r = await preparerPublication(base({ lot, attestation: await attestationN8n(lot), ...T }));
    assert.equal(r.ok, false);
    assert.match(r.erreurs.join(), /déjà publié/);
  });

  test('fichier déjà présent -> refus d\'écraser', async () => {
    const lot = nouveauLot();
    const r = await preparerPublication(base({ lot, attestation: await attestationN8n(lot), fichierExiste: () => true, ...T }));
    assert.equal(r.ok, false);
    assert.match(r.erreurs.join(), /écraser/);
  });

  for (const [libelle, alterer] of [
    ['non relu', (l) => { l.revue_carte_par_carte = false; }],
    ['secret à la racine (code_suppression)', (l) => { l.code_suppression = 'SUP-AAAA1111'; }],
    ['coordonnée dans une carte (prof_email)', (l) => { l.cartes[0].prof_email = 'x@y.z'; }],
    ['review_token résiduel', (l) => { l.review_token = 'abc'; }],
    ['forme acceptée refusée par le correcteur', (l) => { l.cartes[0].reponses_acceptees.push('25 bus'); l.cartes[0].unite = undefined; delete l.cartes[0].unite; }],
  ]) {
    test(`refusé : ${libelle}`, async () => {
      const lot = nouveauLot();
      alterer(lot);
      const r = await preparerPublication(base({ lot, attestation: await attestationN8n(lot), ...T }));
      assert.equal(r.ok, false);
    });
  }
});
