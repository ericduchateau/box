// Tests des contrats catalogue-fonda/v1, lot-fonda/v1, empreinte-fonda/v1
// (fonda/engine/catalogue.js). Usage : node --test fonda/engine/catalogue.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const C = require('./catalogue.js');

const REFERENTIEL = require('../data/referentiel.json');
const CATALOGUE = require('../data/catalogue-fonda.json');
const LOT = require('../data/lots/set_fonda_comprendre-consigne_nI_01.json');
const sha = C.sha256WebCrypto();
const copie = (o) => JSON.parse(JSON.stringify(o));

describe('empreinte-fonda/v1 — couvre ce que l\'élève voit et ce qui le note, rien d\'autre', () => {
  test('stable et au format sha256:<64 hex>', async () => {
    const e = await C.calculerEmpreinte(LOT, sha);
    assert.match(e, /^sha256:[0-9a-f]{64}$/);
    assert.equal(await C.calculerEmpreinte(copie(LOT), sha), e);
  });

  const sensibles = [
    ['question', (l) => { l.cartes[0].question += '.'; }],
    ['reponse', (l) => { l.cartes[0].reponse += ' '; }],
    ['reponses_acceptees (ajout)', (l) => { l.cartes[1].reponses_acceptees.push('x'); }],
    ['profil_correction', (l) => { l.cartes[1].profil_correction = 'sens'; }],
    ['unite', (l) => { l.cartes[0].unite = 'EUR'; }],
    ['arrondi', (l) => { l.cartes[0].arrondi = 2; }],
    ['seconde_chance', (l) => { l.cartes[0].seconde_chance = true; }],
    ['ordre des cartes', (l) => { l.cartes.reverse(); }],
    ['retrait d\'une carte', (l) => { l.cartes.pop(); }],
  ];
  for (const [libelle, modifier] of sensibles) {
    test(`change si ${libelle} change`, async () => {
      const l = copie(LOT);
      modifier(l);
      assert.notEqual(await C.calculerEmpreinte(l, sha), await C.calculerEmpreinte(LOT, sha));
    });
  }

  const neutres = [
    ['difficulte', (l) => { l.cartes[0].difficulte = 'difficile'; }],
    ['numero', (l) => { l.cartes[0].numero = 99; }],
    ['contexte (ni affiché ni noté)', (l) => { l.cartes[0].contexte = 'autre-contexte'; }],
    ['libellés matiere/notion/niveau', (l) => { l.matiere = 'X'; l.notion = 'Y'; l.niveau = 'Z'; }],
  ];
  for (const [libelle, modifier] of neutres) {
    test(`inchangée si seul ${libelle} change`, async () => {
      const l = copie(LOT);
      modifier(l);
      assert.equal(await C.calculerEmpreinte(l, sha), await C.calculerEmpreinte(LOT, sha));
    });
  }
});

describe('lot-fonda/v1 — liste blanche', () => {
  test('les lots publiés sont valides', () => {
    assert.deepEqual(C.validerLot(LOT), { valide: true, erreurs: [] });
  });
  for (const champ of ['id', 'prof_email', 'prof_nom', 'code_suppression', 'review_key', 'review_token', 'relecteur']) {
    test(`racine : champ « ${champ} » refusé`, () => {
      assert.equal(C.validerLot({ ...copie(LOT), [champ]: 'x' }).valide, false);
    });
  }
  test('carte : champ hors liste refusé (prof_email imbriqué)', () => {
    const l = copie(LOT);
    l.cartes[3].prof_email = 'x';
    assert.equal(C.validerLot(l).valide, false);
  });
  test('item_id en double, set_id de carte différent, nb_cartes faux -> refusés', () => {
    const a = copie(LOT); a.cartes[1].item_id = a.cartes[0].item_id;
    const b = copie(LOT); b.cartes[0].set_id = 'set_fonda_comprendre-consigne_nI_02';
    const c = copie(LOT); c.nb_cartes = 3;
    for (const l of [a, b, c]) assert.equal(C.validerLot(l).valide, false);
  });
});

describe('catalogue-fonda/v1 — règles transversales', () => {
  test('le catalogue publié est valide contre le référentiel', () => {
    assert.deepEqual(C.validerCatalogue(CATALOGUE, REFERENTIEL), { valide: true, erreurs: [] });
  });
  const casInvalides = [
    ['set_id en double', (c) => { c.lots.push(copie(c.lots[0])); }],
    ['fichier ≠ lots/<set_id>.json (chemin libre)', (c) => { c.lots[0].fichier = '../referentiel.json'; }],
    ['palier ≠ celui encodé dans set_id', (c) => { c.lots[0].palier = c.lots[0].palier === 'nI' ? 'nF' : 'nI'; }],
    ['notion_id ≠ slug du set_id', (c) => { c.lots[0].notion_id = 'fr.lexique'; }],
    ['relecteur_attribue ≠ référentiel', (c) => { c.lots[0].attestation.relecture_declaree.relecteur_attribue = 'eric'; }],
    ['empreinte_attestee ≠ empreinte', (c) => { c.lots[0].attestation.empreinte_attestee = 'sha256:' + '0'.repeat(64); }],
    ['attestation absente', (c) => { delete c.lots[0].attestation; }],
    ['type d\'attestation inconnu', (c) => { c.lots[0].attestation.type = 'confiance'; }],
    ['sélection ≠ item_ids', (c) => { c.lots[0].attestation.selection = ['it01']; }],
    ['champ hors liste dans l\'entrée', (c) => { c.lots[0].code_suppression = 'x'; }],
    ['schema inconnu', (c) => { c.schema = 'catalogue-fonda/v0'; }],
  ];
  for (const [libelle, modifier] of casInvalides) {
    test(`refusé : ${libelle}`, () => {
      const c = copie(CATALOGUE);
      modifier(c);
      assert.equal(C.validerCatalogue(c, REFERENTIEL).valide, false);
    });
  }
});

describe('verifierLotContreEntree — le fichier servi est exactement celui attesté', () => {
  const entree = CATALOGUE.lots.find((e) => e.set_id === LOT.set_id);
  test('fichier intact -> valide', async () => {
    assert.deepEqual(await C.verifierLotContreEntree(LOT, entree, sha), { valide: true, erreurs: [] });
  });
  test('une seule réponse acceptée ajoutée -> refusé (empreinte)', async () => {
    const l = copie(LOT); l.cartes[2].reponses_acceptees.push('triche');
    const v = await C.verifierLotContreEntree(l, entree, sha);
    assert.equal(v.valide, false);
    assert.match(v.erreurs.join(), /empreinte/);
  });
  test('drapeau revue à false -> refusé', async () => {
    assert.equal((await C.verifierLotContreEntree({ ...copie(LOT), revue_carte_par_carte: false }, entree, sha)).valide, false);
  });
});

describe('résolution des liens et séquences', () => {
  test('trouverEntree : par set_id ; compat notion/palier = séquence la plus haute ; rien sinon', () => {
    const cat = { lots: [
      { set_id: 'set_fonda_comprendre-consigne_nI_01', notion_id: 'fr.comprendre-consigne', palier: 'nI' },
      { set_id: 'set_fonda_comprendre-consigne_nI_03', notion_id: 'fr.comprendre-consigne', palier: 'nI' },
    ] };
    assert.equal(C.trouverEntree(cat, { setId: 'set_fonda_comprendre-consigne_nI_01' }).set_id, 'set_fonda_comprendre-consigne_nI_01');
    assert.equal(C.trouverEntree(cat, { notionId: 'fr.comprendre-consigne', palier: 'nI' }).set_id, 'set_fonda_comprendre-consigne_nI_03');
    assert.equal(C.trouverEntree(cat, { setId: '../x' }), null);
    assert.equal(C.trouverEntree(cat, {}), null);
  });
  test('prochainSetId : séquence libre suivante, jamais un set_id existant', () => {
    assert.equal(C.prochainSetId('fr.comprendre-consigne', 'nI', ['set_fonda_comprendre-consigne_nI_01', 'set_fonda_comprendre-consigne_nF_04']),
      'set_fonda_comprendre-consigne_nI_02');
    assert.equal(C.prochainSetId('fr.lexique', 'nF', []), 'set_fonda_lexique_nF_01');
    assert.equal(C.prochainSetId('sans-point', 'nI', []), null);
    assert.equal(C.prochainSetId('fr.lexique', 'nX', []), null);
  });
});

describe('R4 — lots « manuelle-historique » ancrés sur leur empreinte figée', () => {
  test('les 8 entrées historiques du catalogue ont exactement leur empreinte figée', () => {
    const hist = CATALOGUE.lots.filter((e) => e.attestation.type === 'manuelle-historique');
    assert.equal(hist.length, 8);
    for (const e of hist) assert.equal(e.empreinte, C.HISTORIQUES_FIGES[e.set_id], e.set_id);
    assert.equal(Object.keys(C.HISTORIQUES_FIGES).length, 8);
  });

  test('scénario Codex : question modifiée + empreintes recalculées dans l\'entrée et l\'attestation -> REFUSÉ', async () => {
    const lot = copie(LOT);
    lot.cartes[0].question += ' (modifiée)';
    const nouvelle = await C.calculerEmpreinte(lot, sha);
    const cat = copie(CATALOGUE);
    const e = cat.lots.find((x) => x.set_id === lot.set_id);
    e.empreinte = nouvelle;
    e.attestation.empreinte_attestee = nouvelle;
    const v = C.validerCatalogue(cat, REFERENTIEL);
    assert.equal(v.valide, false);
    assert.match(v.erreurs.join(), /empreinte figée/);
  });

  test('manuelle-historique sur un set_id hors des 8 -> REFUSÉ', () => {
    const cat = copie(CATALOGUE);
    const e = copie(cat.lots[0]);
    e.set_id = e.set_id.replace(/_01$/, '_02');
    e.fichier = `lots/${e.set_id}.json`;
    cat.lots.push(e);
    assert.match(C.validerCatalogue(cat, REFERENTIEL).erreurs.join(), /réservée aux 8 lots figés/);
  });
});
