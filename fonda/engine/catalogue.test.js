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
    const b = copie(LOT); b.cartes[0].set_id = 'set_fonda_comprendre-consigne_nI_92';
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
    ['moteur absent', (c) => { delete c.lots[0].moteur; }],
    ['moteur : champ en trop', (c) => { c.lots[0].moteur.fichier = 'x.js'; }],
    ['moteur : sha256 non hex', (c) => { c.lots[0].moteur.sha256 = 'sha256:' + c.lots[0].moteur.sha256; }],
    ['moteur : version libre', (c) => { c.lots[0].moteur.version = '../v1'; }],
    ['lot historique lié à un autre moteur (M1 figé)', (c) => { c.lots[0].moteur = { version: 'v2', sha256: 'a'.repeat(64) }; }],
    ['badge : forme inconnue', (c) => { c.lots[0].relecteur.forme = 'certifiee'; }],
    ['badge : champ en trop', (c) => { c.lots[0].relecteur.email = 'x'; }],
    ['badge d\'un lot historique modifié (« relue et validée »)', (c) => { c.lots[0].relecteur.forme = 'relue_et_validee'; }],
  ];
  for (const [libelle, modifier] of casInvalides) {
    test(`refusé : ${libelle}`, () => {
      const c = copie(CATALOGUE);
      modifier(c);
      assert.equal(C.validerCatalogue(c, REFERENTIEL).valide, false);
    });
  }
});

describe('M1 — moteur v1 et badge figés des lots historiques (CDC §4.3, §12)', () => {
  test('MOTEUR_HISTORIQUE = ligne v1 de fonda/engine/moteurs.json', () => {
    const v1 = require('./moteurs.json').find((l) => l.version === 'v1');
    assert.deepEqual({ ...C.MOTEUR_HISTORIQUE }, { version: 'v1', sha256: v1.sha256 });
  });
  test('les 8 entrées historiques : moteur v1 figé, badge « Fiche relue par Éric Duchateau »', () => {
    const hist = CATALOGUE.lots.filter((e) => e.attestation.type === 'manuelle-historique');
    assert.equal(hist.length, 8);
    for (const e of hist) {
      assert.deepEqual(e.moteur, { ...C.MOTEUR_HISTORIQUE }, e.set_id);
      assert.deepEqual(e.relecteur, { ...C.BADGE_HISTORIQUE }, e.set_id);
    }
  });
});

describe('cloture-signee (Type 2) : forme et cohérence charge <-> entrée (sans crypto)', () => {
  const entreeType2 = () => {
    const e = copie(CATALOGUE.lots.find((x) => x.set_id === LOT.set_id));
    e.set_id = 'set_fonda_comprendre-consigne_nI_92';
    e.fichier = `lots/${e.set_id}.json`;
    e.relecteur = { forme: 'relue_et_validee', nom_affiche: 'Relectrice de test', id: 'justine' };
    e.attestation = { type: 'cloture-signee', signature: 'QUJD', charge: {
      schema: 'attestation-cloture/v2', set_id: e.set_id, notion_id: e.notion_id, palier: e.palier, relecteur_attribue: 'justine',
      coeur: { selection: [...e.item_ids], empreinte_publiee: e.empreinte, moteur: { ...e.moteur } },
      moteur: { ...e.moteur }, badge: { ...e.relecteur } } };
    return e;
  };
  test('entrée Type 2 cohérente : forme acceptée (la signature est vérifiée en Node)', () => {
    assert.deepEqual(C.validerAttestation(entreeType2().attestation, entreeType2()), []);
  });
  const cas = [
    ['enveloppe sans signature', (e) => { delete e.attestation.signature; }],
    ['champ en trop dans l\'enveloppe', (e) => { e.attestation.extra = 1; }],
    ['empreinte publiée ≠ entrée', (e) => { e.attestation.charge.coeur.empreinte_publiee = 'sha256:' + '0'.repeat(64); }],
    ['sélection ≠ item_ids', (e) => { e.attestation.charge.coeur.selection.reverse(); }],
    ['moteur ≠ entrée', (e) => { e.attestation.charge.moteur = { version: 'v2', sha256: 'a'.repeat(64) }; }],
    ['badge ≠ relecteur de l\'entrée', (e) => { e.attestation.charge.badge.id = 'eric'; }],
    ['set_id ≠ entrée', (e) => { e.attestation.charge.set_id = 'set_fonda_comprendre-consigne_nI_93'; }],
  ];
  for (const [libelle, alterer] of cas) {
    test(`refusé : ${libelle}`, () => {
      const e = entreeType2();
      alterer(e);
      assert.notDeepEqual(C.validerAttestation(e.attestation, e), []);
    });
  }
  test('type réservé n8n-relecture désormais inconnu', () => {
    assert.match(C.validerAttestation({ type: 'n8n-relecture' }, entreeType2()).join(), /inconnu/);
  });
});

// CDC r9 (intérim) : cohérence version de charge <-> forme du badge <-> titulaire, côté front
// (validerCatalogue, SANS cryptographie : une charge v2 porteuse d'un badge de secours est
// refusée ici même si le vérificateur Node n'est pas exécuté).
describe('intérim (CDC r9) : badge de secours au catalogue — rejets croisés sans le vérificateur Node', () => {
  const SECOURS = { forme: 'relue_par_secours', nom_affiche: 'Éric Duchateau', id: 'eric', titulaire: { id: 'justine', nom_affiche: 'Justine Leblanc' } };
  const entree = (schema = 'attestation-cloture/v3', badge = SECOURS, relecteur = badge) => {
    const e = copie(CATALOGUE.lots.find((x) => x.set_id === LOT.set_id));
    e.set_id = 'set_fonda_comprendre-consigne_nI_92';
    e.fichier = `lots/${e.set_id}.json`;
    e.relecteur = copie(relecteur);
    e.attestation = { type: 'cloture-signee', signature: 'QUJD', charge: {
      schema, set_id: e.set_id, notion_id: e.notion_id, palier: e.palier, relecteur_attribue: 'justine',
      coeur: { selection: [...e.item_ids], empreinte_publiee: e.empreinte, moteur: { ...e.moteur } }, moteur: { ...e.moteur }, badge: copie(badge) } };
    return e;
  };
  const valider = (e) => C.validerCatalogue({ ...copie(CATALOGUE), lots: [...copie(CATALOGUE.lots), e] }, REFERENTIEL);
  test('charge v3 + badge de secours (titulaire) = relecteur de l\'entrée -> accepté', () => {
    assert.deepEqual(valider(entree()), { valide: true, erreurs: [] });
    assert.ok(C.FORMES_BADGE.includes('relue_par_secours'));
  });
  test('charge v2 portant un badge de secours -> refus', () => assert.match(valider(entree('attestation-cloture/v2')).erreurs.join(), /badge incompatible avec attestation-cloture\/v2/));
  test('charge v1 portant un badge de secours -> refus', () => assert.match(valider(entree('attestation-cloture/v1')).erreurs.join(), /badge incompatible avec attestation-cloture\/v1/));
  test('charge v3 avec un badge v2 (relue_et_validee) -> refus', () => {
    const b = { forme: 'relue_et_validee', nom_affiche: 'Éric Duchateau', id: 'eric' };
    assert.match(valider(entree('attestation-cloture/v3', b)).erreurs.join(), /badge incompatible avec attestation-cloture\/v3/);
  });
  test('charge v3 avec forme de secours mais SANS titulaire -> refus', () => {
    const b = { forme: 'relue_par_secours', nom_affiche: 'Éric Duchateau', id: 'eric' };
    assert.match(valider(entree('attestation-cloture/v3', b)).erreurs.join(), /incompatible|relecteur de secours invalide/);
  });
  test('version de charge inconnue -> refus', () => assert.match(valider(entree('attestation-cloture/v9')).erreurs.join(), /version de charge inconnue/));
  test('titulaire FALSIFIÉ dans l\'entrée (nom ou id) -> refus (badge ≠ relecteur)', () => {
    for (const t of [{ id: 'justine', nom_affiche: 'Autre' }, { id: 'paul', nom_affiche: 'Justine Leblanc' }]) {
      assert.match(valider(entree('attestation-cloture/v3', SECOURS, { ...SECOURS, titulaire: t })).erreurs.join(), /badge ≠ relecteur de l'entrée/);
    }
  });
  test('entrée : titulaire porté par une autre forme -> refus (champ non autorisé)', () => {
    const r = { forme: 'relue_et_validee', nom_affiche: 'Éric Duchateau', id: 'eric', titulaire: { id: 'justine', nom_affiche: 'Justine Leblanc' } };
    assert.match(valider(entree('attestation-cloture/v2', { forme: 'relue_et_validee', nom_affiche: 'Éric Duchateau', id: 'eric' }, r)).erreurs.join(), /relecteur invalide/);
  });
  test('entrée de secours mal formée (id nul, titulaire = secours, clé en trop) -> refus', () => {
    for (const r of [{ ...SECOURS, id: null }, { ...SECOURS, titulaire: { id: 'eric', nom_affiche: 'Éric Duchateau' } }, { ...SECOURS, titulaire: { ...SECOURS.titulaire, x: 1 } }]) {
      assert.match(valider(entree('attestation-cloture/v3', r, r)).erreurs.join(), /relecteur de secours invalide/);
    }
  });
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
      { set_id: 'set_fonda_comprendre-consigne_nI_93', notion_id: 'fr.comprendre-consigne', palier: 'nI' },
    ] };
    assert.equal(C.trouverEntree(cat, { setId: 'set_fonda_comprendre-consigne_nI_01' }).set_id, 'set_fonda_comprendre-consigne_nI_01');
    assert.equal(C.trouverEntree(cat, { notionId: 'fr.comprendre-consigne', palier: 'nI' }).set_id, 'set_fonda_comprendre-consigne_nI_93');
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

// Relecture Codex étape 2, #2 : profils et bornes d'arrondi déplacés de validerLot
// vers moteur.valider. Preuve que l'admissibilité ne change pas : ancien validerLot
// (a418881, octets historiques) ≡ nouveau validerLot + moteur.valider de chaque carte,
// sur les 8 lots historiques et sur des variantes ciblées.
describe('déplacement des règles pédagogiques vers le moteur : admissibilité identique', () => {
  const { execFileSync } = require('child_process');
  const vm = require('vm');
  const pathM = require('path');
  let ancien = null;
  try {
    const code = execFileSync('git', ['show', 'a418881:fonda/engine/catalogue.js'], { cwd: pathM.join(__dirname, '..', '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const module = { exports: {} };
    vm.runInNewContext(code, { module, exports: module.exports, globalThis: {}, TextEncoder });
    ancien = module.exports;
  } catch { /* historique indisponible */ }
  const { chargerMoteurNode } = require('../scripts/moteurs.js');

  test('les 8 lots historiques et leurs variantes : même verdict avant/après', { skip: !ancien && 'historique git indisponible' }, () => {
    // Les 8 lots HISTORIQUES (figés), seuls concernés par la comparaison avec l'ancien catalogue.js
    // (a418881) : les lots publiés ensuite par clôture signée ne l'ont jamais connu.
    const lots = CATALOGUE.lots.filter((e) => e.attestation.type === 'manuelle-historique').map((e) => require(`../data/${e.fichier}`));
    assert.equal(lots.length, 8);
    const variantes = [
      (c) => c,
      (c) => ({ ...c, profil_correction: 'magie' }),
      (c) => ({ ...c, profil_correction: 7 }),
      (c) => ({ ...c, arrondi: 11 }),
      (c) => ({ ...c, arrondi: -1 }),
      (c) => ({ ...c, arrondi: 1.5 }),
      (c) => ({ ...c, arrondi: 10 }),
      (c) => ({ ...c, arrondi: '2' }),
      (c) => ({ ...c, arrondi: 0 }),
    ];
    let n = 0;
    for (const lot of lots) {
      const e = CATALOGUE.lots.find((x) => x.set_id === lot.set_id);
      const m = chargerMoteurNode(e.moteur.version, e.moteur.sha256);
      for (const v of variantes) {
        for (let i = 0; i < lot.cartes.length; i += 1) {
          const l = copie(lot);
          l.cartes[i] = v(l.cartes[i]);
          const avant = ancien.validerLot(l).valide;
          const apres = C.validerLot(l).valide && l.cartes.every((c) => m.valider(c).valide);
          assert.equal(apres, avant, `${lot.set_id} carte ${i + 1} ${JSON.stringify(v(lot.cartes[i]).arrondi)} ${JSON.stringify(v(lot.cartes[i]).profil_correction)}`);
          n += 1;
        }
      }
      assert.equal(C.validerLot(lot).valide && lot.cartes.every((c) => m.valider(c).valide), true, lot.set_id);
    }
    assert.ok(n >= 400);
  });
});
