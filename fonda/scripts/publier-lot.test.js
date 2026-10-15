// Tests de fonda/scripts/publier-lot.js et fonda/scripts/attestation-signee.js —
// publication Type 2 (clôture signée, CDC §11, §11 bis, §12, §14).
// Clés RSA 3072 ÉPHÉMÈRES générées dans le test : jamais une vraie clé.
// Usage : node --test fonda/scripts/publier-lot.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const C = require('../engine/catalogue.js');
const Canonique = require('../engine/canonique.js');
const S = require('./attestation-signee.js');
const { preparerPublication, clesDuDepot } = require('./publier-lot.js');

const REFERENTIEL = require('../data/referentiel.json');
const CATALOGUE = require('../data/catalogue-fonda.json');
const REGISTRE = require('../engine/moteurs.json');
const sha256Hex = C.sha256WebCrypto();
const copie = (o) => JSON.parse(JSON.stringify(o));
const MOTEUR = { version: 'v1', sha256: REGISTRE[0].sha256 };

// --- Clés éphémères --------------------------------------------------------------------
function paire() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
  return { pem: publicKey.export({ type: 'spki', format: 'pem' }), privee: privateKey };
}
const K = paire();
const K2 = paire(); // autre clé (signature par une clé non déclarée)
function declaration(cleId, pem, x = {}) {
  return { cle_id: cleId, fichier: `cles/${cleId}.pem`, sha256_pem: crypto.createHash('sha256').update(pem).digest('hex'), algorithme: 'RSA-SHA256-PKCS1v15', valide_du: '2026-10-01T00:00:00.000Z', valide_au: '2027-10-01T00:00:00.000Z', revoquee_le: null, ...x };
}
function cles(decls, pems) { return S.chargerCles(decls, (f) => { if (!(f in pems)) throw new Error('absent'); return pems[f]; }); }
const CLES = cles([declaration('cle-test', K.pem)], { 'cles/cle-test.pem': K.pem });
const signer = (charge, privee = K.privee) => crypto.sign('sha256', Buffer.from(Canonique.octetsContrat('attestation-cloture/v1', charge)), { key: privee, padding: crypto.constants.RSA_PKCS1_PADDING }).toString('base64');

// --- Lots et charges -----------------------------------------------------------------
function lotDerive(source, setId) {
  const l = copie(require(`../data/lots/${source}.json`));
  l.set_id = setId;
  l.cartes.forEach((c) => { c.set_id = setId; });
  return l;
}
const HEX = 'c3'.repeat(32);
async function chargePour(lot, mode) {
  const auto = mode === 'auto';
  const relecteur = REFERENTIEL.notions.find((n) => n.id === lot.notion_id).relecteur;
  const empreinte = await C.calculerEmpreinte(lot, sha256Hex);
  return {
    schema: 'attestation-cloture/v1', set_id: lot.set_id, notion_id: lot.notion_id, palier: lot.palier,
    coeur: { action: 'accepter', selection: lot.cartes.map((c) => c.item_id), ecartees: ['it99'], empreinte_relue: 'sha256:' + 'e'.repeat(64), empreinte_publiee: empreinte, moteur: { ...MOTEUR } },
    sha256_instantane: HEX, code_confirmation: HEX.slice(0, 16),
    confirmation: { mode, par: relecteur, recue_par: 'eric', le: '2026-10-19T19:00:00.000Z' },
    fidelite_transmission: { atteste_par: 'eric', le: '2026-10-19T19:05:00.000Z' },
    relecteur_attribue: relecteur, relecteur_egal_cloturer: auto,
    provenances: [
      { execution_id: '10', workflow_id: 'wfConfirmation01', statut: 'success', demarree_le: '2026-10-19T17:00:00.000Z' },
      { execution_id: '2', workflow_id: 'wfConfirmation01', statut: 'success', demarree_le: '2026-10-19T17:00:00.000Z' },
    ],
    nb_fichiers_decision: 2, referentiel_version: 'sha256:' + 'f'.repeat(64), moteur: { ...MOTEUR },
    execution_cloture: { execution_id: '20', workflow_id: 'wfCloture0001', statut: 'success', terminee_le: '2026-10-20T08:00:00.000Z' },
    revoque_le: '2026-10-20T07:59:00.000Z', levees: [], incidents_connus: [], cloture_le: '2026-10-20T08:10:00.000Z',
    badge: auto ? { forme: 'relue_par', nom_affiche: 'Éric Duchateau', id: 'eric' } : { forme: 'relue_et_validee', nom_affiche: 'Relectrice de test', id: relecteur },
    cle_id: 'cle-test',
  };
}
const enveloppe = (charge, signature = signer(charge)) => ({ type: 'cloture-signee', charge, signature });
const base = (x) => ({ catalogue: copie(CATALOGUE), referentiel: REFERENTIEL, sha256Hex, cles: CLES, ...x });
const LOT_FR = () => lotDerive('set_fonda_comprendre-consigne_nI_01', 'set_fonda_comprendre-consigne_nI_02');
const LOT_MATHS = () => lotDerive('set_fonda_grandeurs-mesures_nI_01', 'set_fonda_grandeurs-mesures_nI_02');

describe('publier-lot — Type 2 accepté et vérifié (aller-retour signé)', () => {
  test('charge nominale (relectrice tierce, réponse au message) signée -> publiée ; catalogue valide', async () => {
    const lot = LOT_FR();
    const r = await preparerPublication(base({ lot, attestation: enveloppe(await chargePour(lot, 'reponse_message')) }));
    assert.equal(r.ok, true, JSON.stringify(r.erreurs));
    assert.deepEqual(r.entree.moteur, MOTEUR);
    assert.equal(r.entree.relecteur.forme, 'relue_et_validee');
    assert.deepEqual(C.validerCatalogue(r.catalogue, REFERENTIEL), { valide: true, erreurs: [] });
  });
  test('auto-confirmation (lot de maths, relecteur = Éric) -> publiée, badge « Fiche relue par Éric Duchateau »', async () => {
    const lot = LOT_MATHS();
    const r = await preparerPublication(base({ lot, attestation: enveloppe(await chargePour(lot, 'auto')) }));
    assert.equal(r.ok, true, JSON.stringify(r.erreurs));
    assert.deepEqual(r.entree.relecteur, { forme: 'relue_par', nom_affiche: 'Éric Duchateau', id: 'eric' });
  });
  test('cles.json du dépôt VIDE : aucune publication Type 2 réelle possible avant 4b (fail-closed)', async () => {
    const lot = LOT_FR();
    assert.deepEqual(clesDuDepot().ids, []);
    const r = await preparerPublication(base({ lot, attestation: enveloppe(await chargePour(lot, 'reponse_message')), cles: clesDuDepot() }));
    assert.equal(r.ok, false);
    assert.match(r.erreurs.join(), /non déclarée/);
  });
});

describe('signature et clés (ordre fail-closed)', () => {
  test('signature altérée d\'un octet -> refusée', async () => {
    const lot = LOT_FR();
    const ch = await chargePour(lot, 'reponse_message');
    const sig = Buffer.from(signer(ch), 'base64');
    sig[10] ^= 0x01;
    const r = await preparerPublication(base({ lot, attestation: enveloppe(ch, sig.toString('base64')) }));
    assert.match(r.erreurs.join(), /signature RSA-SHA256/);
  });
  test('charge modifiée APRÈS signature (même un champ hors cœur) -> refusée', async () => {
    const lot = LOT_FR();
    const ch = await chargePour(lot, 'reponse_message');
    const sig = signer(ch);
    const r = await preparerPublication(base({ lot, attestation: enveloppe({ ...ch, nb_fichiers_decision: 3 }, sig) }));
    assert.match(r.erreurs.join(), /signature RSA-SHA256/);
  });
  test('signée par une clé NON déclarée sous ce cle_id -> refusée', async () => {
    const lot = LOT_FR();
    const ch = await chargePour(lot, 'reponse_message');
    const r = await preparerPublication(base({ lot, attestation: enveloppe(ch, signer(ch, K2.privee)) }));
    assert.match(r.erreurs.join(), /signature RSA-SHA256/);
  });
  test('cle_id inconnu -> refusé', async () => {
    const lot = LOT_FR();
    const ch = { ...(await chargePour(lot, 'reponse_message')), cle_id: 'cle-inconnue' };
    const r = await preparerPublication(base({ lot, attestation: enveloppe(ch) }));
    assert.match(r.erreurs.join(), /non déclarée/);
  });
  test('clé révoquée -> TOUTES ses attestations irrecevables (même antérieures)', async () => {
    const lot = LOT_FR();
    const ch = await chargePour(lot, 'reponse_message');
    const revoquee = cles([declaration('cle-test', K.pem, { revoquee_le: '2027-01-01T00:00:00.000Z' })], { 'cles/cle-test.pem': K.pem });
    const r = await preparerPublication(base({ lot, attestation: enveloppe(ch), cles: revoquee }));
    assert.match(r.erreurs.join(), /révoquée/);
  });
  test('cloture_le hors période de validité -> refusé ; après expiration mais clôture dans la période -> recevable', async () => {
    const lot = LOT_FR();
    const ch = await chargePour(lot, 'reponse_message');
    const future = cles([declaration('cle-test', K.pem, { valide_du: '2026-11-01T00:00:00.000Z' })], { 'cles/cle-test.pem': K.pem });
    assert.match((await preparerPublication(base({ lot, attestation: enveloppe(ch), cles: future }))).erreurs.join(), /hors de la période/);
    const expiree = cles([declaration('cle-test', K.pem, { valide_au: '2026-10-25T00:00:00.000Z' })], { 'cles/cle-test.pem': K.pem });
    assert.equal((await preparerPublication(base({ lot, attestation: enveloppe(ch), cles: expiree }))).ok, true);
  });
  test('PEM altéré (sha256_pem discordant) ou clé RSA < 3072 bits -> refusés', async () => {
    const lot = LOT_FR();
    const ch = await chargePour(lot, 'reponse_message');
    const altere = S.chargerCles([declaration('cle-test', K.pem)], () => K.pem.replace('A', 'B'));
    assert.match((await preparerPublication(base({ lot, attestation: enveloppe(ch), cles: altere }))).erreurs.join(), /sha256_pem/);
    const petite = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem2048 = petite.publicKey.export({ type: 'spki', format: 'pem' });
    const c2048 = cles([declaration('cle-test', pem2048)], { 'cles/cle-test.pem': pem2048 });
    assert.match((await preparerPublication(base({ lot, attestation: enveloppe(ch, signer(ch, petite.privateKey)), cles: c2048 }))).erreurs.join(), /3072/);
  });
  test('cles.json mal formé -> exception au chargement (jamais une clé implicite)', () => {
    for (const d of [[{ ...declaration('cle-test', K.pem), extra: 1 }], [declaration('cle-test', K.pem), declaration('cle-test', K.pem)],
      [declaration('cle-test', K.pem, { fichier: 'ailleurs.pem' })], [declaration('cle-test', K.pem, { algorithme: 'RSA-PSS' })],
      [declaration('cle-test', K.pem, { valide_du: '2026-10-01' })], {}]) {
      assert.throws(() => S.chargerCles(d, () => K.pem));
    }
  });
  test('enveloppe mal formée ou signature non base64 -> refusée', async () => {
    const lot = LOT_FR();
    const ch = await chargePour(lot, 'reponse_message');
    for (const att of [{ type: 'cloture-signee', charge: ch }, { ...enveloppe(ch), extra: 1 }, { ...enveloppe(ch), signature: 'pas du base64 !' }]) {
      assert.equal((await preparerPublication(base({ lot, attestation: att }))).ok, false);
    }
    const r = await preparerPublication(base({ lot, attestation: enveloppe({ ...ch, signature: 'x' }, 'AAAA') }));
    assert.match(r.erreurs.join(), /signature : champ inconnu/);
  });
});

describe('invariants de valeur (ce que canonique.js ne vérifie pas) — charge correctement signée', () => {
  const cas = [
    ['mode hors énumération', (c) => { c.confirmation.mode = 'telephone'; }, /mode hors énumération/],
    ['date sans millisecondes', (c) => { c.fidelite_transmission.le = '2026-10-19T19:05:00Z'; }, /date ISO UTC/],
    ['cloture_le mal formée (refusée dès la recevabilité)', (c) => { c.cloture_le = '2026-10-20T08:10:00Z'; }, /cloture_le invalide/],
    ['date avec décalage horaire', (c) => { c.confirmation.le = '2026-10-19T21:00:00.000+02:00'; }, /date ISO UTC/],
    ['date impossible', (c) => { c.revoque_le = '2026-02-30T00:00:00.000Z'; }, /date ISO UTC/],
    ['provenances mal triées (tri numérique)', (c) => { c.provenances.reverse(); }, /ordre/],
    ['provenance statut ≠ success', (c) => { c.provenances[0].statut = 'error'; }, /statut ≠ "success"/],
    ['execution_cloture statut ≠ success', (c) => { c.execution_cloture.statut = 'crashed'; }, /execution_cloture.statut/],
    ['provenances vides', (c) => { c.provenances = []; }, /provenances vides/],
    ['badge.forme hors énumération', (c) => { c.badge.forme = 'certifiee'; }, /badge.forme/],
    ['badge au nom d\'une autre personne', (c) => { c.badge.id = 'eric'; }, /badge/],
    ['auto sans relecteur = Éric', (c) => { c.confirmation.mode = 'auto'; }, /auto/],
    ['confirmation.par ≠ relecteur', (c) => { c.confirmation.par = 'eric'; }, /confirmation.par/],
    ['recue_par ≠ eric', (c) => { c.confirmation.recue_par = 'justine'; }, /recue_par/],
    ['fidélité attestée par un autre', (c) => { c.fidelite_transmission.atteste_par = 'justine'; }, /atteste_par/],
    ['code de confirmation ≠ 16 premiers hex', (c) => { c.code_confirmation = '0'.repeat(16); }, /code_confirmation/],
    ['action ≠ accepter', (c) => { c.coeur.action = 'rejeter'; }, /action/],
    ['sélection et écartées non disjointes', (c) => { c.coeur.ecartees = [c.coeur.selection[0]]; }, /disjointes/],
    ['nb_fichiers_decision non entier', (c) => { c.nb_fichiers_decision = 1.5; }, /entier/],
    ['incident non résolu', (c) => { c.incidents_connus = [{ id: 'i1', nature: 'x', detecte_le: '2026-10-01T00:00:00.000Z', statut: 'ouvert', resolu_le: null, preuve_resolution: null, periode: { debut: null, fin: null } }]; }, /non résolu/],
    ['incident résolu sans preuve', (c) => { c.incidents_connus = [{ id: 'i1', nature: 'x', detecte_le: '2026-10-01T00:00:00.000Z', statut: 'resolu', resolu_le: '2026-10-02T00:00:00.000Z', preuve_resolution: ' ', periode: { debut: null, fin: '2026-10-02T00:00:00.000Z' } }]; }, /preuve/],
    ['incident : fin ≠ résolution', (c) => { c.incidents_connus = [{ id: 'i1', nature: 'x', detecte_le: '2026-10-01T00:00:00.000Z', statut: 'resolu', resolu_le: '2026-10-02T00:00:00.000Z', preuve_resolution: 'ok', periode: { debut: null, fin: '2026-10-03T00:00:00.000Z' } }]; }, /periode.fin/],
    ['levées dans le désordre', (c) => { c.levees = [{ type: 'historique_incomplet', constat: 'a' }, { type: 'recherche_incomplete', constat: 'b' }]; }, /levees : ordre/],
  ];
  for (const [libelle, alterer, motif] of cas) {
    test(`refusé : ${libelle}`, async () => {
      const lot = LOT_FR();
      const ch = await chargePour(lot, 'reponse_message');
      alterer(ch);
      const r = await preparerPublication(base({ lot, attestation: enveloppe(ch) })); // re-signée : seule la valeur est fausse
      assert.equal(r.ok, false);
      assert.match(r.erreurs.join(' | '), motif);
    });
  }
});

describe('invariants de dépôt — charge correctement signée', () => {
  const cas = [
    ['moteur de la charge ≠ registre', (c) => { c.moteur = { version: 'v1', sha256: '0'.repeat(64) }; c.coeur.moteur = { ...c.moteur }; }, /moteur/],
    ['coeur.moteur ≠ moteur', (c) => { c.coeur.moteur = { version: 'v2', sha256: MOTEUR.sha256 }; }, /coeur.moteur/],
    ['selection ≠ item_ids du fichier', (c) => { c.coeur.selection = [...c.coeur.selection].reverse(); }, /selection/],
    ['empreinte publiée ≠ fichier', (c) => { c.coeur.empreinte_publiee = 'sha256:' + '0'.repeat(64); }, /empreinte_publiee/],
    ['set_id ≠ lot', (c) => { c.set_id = 'set_fonda_comprendre-consigne_nI_09'; }, /set_id/],
    ['relecteur attribué ≠ référentiel', (c) => { c.relecteur_attribue = 'autre'; c.confirmation.par = 'autre'; c.badge.id = 'autre'; }, /référentiel/],
  ];
  for (const [libelle, alterer, motif] of cas) {
    test(`refusé : ${libelle}`, async () => {
      const lot = LOT_FR();
      const ch = await chargePour(lot, 'reponse_message');
      alterer(ch);
      const r = await preparerPublication(base({ lot, attestation: enveloppe(ch) }));
      assert.equal(r.ok, false);
      assert.match(r.erreurs.join(' | '), motif);
    });
  }
});

describe('chaîne de publication (inchangée)', () => {
  test('manuelle-historique : jamais pour un nouveau lot', async () => {
    const r = await preparerPublication(base({ lot: LOT_FR(), attestation: { type: 'manuelle-historique' } }));
    assert.match(r.erreurs.join(), /réservée/);
  });
  test('type inconnu ou absent -> refusé', async () => {
    assert.equal((await preparerPublication(base({ lot: LOT_FR(), attestation: { type: 'n8n-relecture' } }))).ok, false);
    assert.equal((await preparerPublication(base({ lot: LOT_FR(), attestation: null }))).ok, false);
  });
  test('Type 1 historique toujours accepté au catalogue (les 8 lots)', () => {
    assert.deepEqual(C.validerCatalogue(CATALOGUE, REFERENTIEL), { valide: true, erreurs: [] });
  });
  test('set_id déjà publié, fichier déjà présent -> refus', async () => {
    const lot = lotDerive('set_fonda_comprendre-consigne_nI_01', 'set_fonda_comprendre-consigne_nI_01');
    assert.match((await preparerPublication(base({ lot, attestation: enveloppe(await chargePour(lot, 'reponse_message')) }))).erreurs.join(), /déjà publié/);
    const l2 = LOT_FR();
    assert.match((await preparerPublication(base({ lot: l2, attestation: enveloppe(await chargePour(l2, 'reponse_message')), fichierExiste: () => true }))).erreurs.join(), /écraser/);
  });
  for (const [libelle, alterer] of [
    ['non relu', (l) => { l.revue_carte_par_carte = false; }],
    ['secret à la racine (code_suppression)', (l) => { l.code_suppression = 'SUP-AAAA1111'; }],
    ['coordonnée dans une carte (prof_email)', (l) => { l.cartes[0].prof_email = 'x@y.z'; }],
    ['forme acceptée refusée par le moteur', (l) => { l.cartes[0].reponses_acceptees.push('25 bus'); delete l.cartes[0].unite; }],
  ]) {
    test(`refusé : ${libelle}`, async () => {
      const lot = LOT_FR();
      alterer(lot);
      const r = await preparerPublication(base({ lot, attestation: enveloppe(await chargePour(lot, 'reponse_message')) }));
      assert.equal(r.ok, false);
    });
  }
});
