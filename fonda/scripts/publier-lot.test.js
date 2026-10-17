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
// Journal de HEAD + réservations des set_id de test (§20.11 : seul « reserve » est publiable).
const JOURNAL = require('../data/set_ids-journal.json');
const RESERVES = ['set_fonda_comprendre-consigne_nI_02', 'set_fonda_grandeurs-mesures_nI_02'];
const journalTest = (ids = RESERVES) => ({ schema: JOURNAL.schema, lignes: [...copie(JOURNAL.lignes), ...ids.map((id) => ({ set_id: id, transition: 'reserve', le: '2026-10-17', ref: `test-2026-10-17:${id}` }))] });
// Référentiel ARCHIVÉ (§20.12) : par défaut, la version de la charge résout le référentiel du dépôt.
const archive = (ref = REFERENTIEL) => async () => ({ ok: true, referentiel: ref });
const base = (x) => ({ catalogue: copie(CATALOGUE), referentiel: REFERENTIEL, referentielArchive: archive(), journal: journalTest(), le: '2026-10-21T09:00:00.000Z', sha256Hex, cles: CLES, ...x });
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
  test('clés du dépôt (seule eric-2026, publique) : une charge signée par une clé éphémère est refusée', async () => {
    const lot = LOT_FR();
    assert.deepEqual(clesDuDepot().ids, ['eric-2026']);
    // cle_id non déclaré dans le dépôt
    const r1 = await preparerPublication(base({ lot, attestation: enveloppe(await chargePour(lot, 'reponse_message')), cles: clesDuDepot() }));
    assert.equal(r1.ok, false);
    assert.match(r1.erreurs.join(), /non déclarée/);
    // cle_id « eric-2026 » usurpé, signé par une autre clé : signature invalide
    const ch = { ...(await chargePour(lot, 'reponse_message')), cle_id: 'eric-2026' };
    const r2 = await preparerPublication(base({ lot, attestation: enveloppe(ch), cles: clesDuDepot() }));
    assert.equal(r2.ok, false);
    assert.match(r2.erreurs.join(), /signature RSA-SHA256/);
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

describe('correctifs de relecture : PEM strict, base64 strict, ordre, égalités de champs', () => {
  const chargeFr = async () => { const lot = LOT_FR(); return { lot, ch: await chargePour(lot, 'reponse_message') }; };
  test('PEM : clé PRIVÉE (PKCS#8), clé publique PKCS#1, deux blocs, texte parasite -> refusés avant tout chargement', async () => {
    const { lot, ch } = await chargeFr();
    const privee = K.privee.export({ type: 'pkcs8', format: 'pem' });
    const pkcs1 = crypto.createPublicKey(K.pem).export({ type: 'pkcs1', format: 'pem' });
    for (const pem of [privee, pkcs1, K.pem + K.pem, `commentaire\n${K.pem}`]) {
      const c = cles([declaration('cle-test', pem)], { 'cles/cle-test.pem': pem });
      const r = await preparerPublication(base({ lot, attestation: enveloppe(ch), cles: c }));
      assert.match(r.erreurs.join(), /PUBLIC KEY|SPKI/, pem.slice(0, 40));
    }
  });
  test('base64 non canonique (« = » ou « A » ajouté, espaces) -> refusé', async () => {
    const { lot, ch } = await chargeFr();
    const sig = signer(ch);
    for (const s of [`${sig}=`, `${sig}A`, ` ${sig}`, sig.replace(/=+$/, '')]) {
      if (s === sig) continue;
      const r = await preparerPublication(base({ lot, attestation: enveloppe(ch, s) }));
      assert.equal(r.ok, false, JSON.stringify(s.slice(-4)));
    }
  });
  test('ordre : enveloppe invalide avec moteur inconnu -> refus de l\'ENVELOPPE, moteur jamais chargé', async () => {
    const { lot, ch } = await chargeFr();
    const r = await preparerPublication(base({ lot, attestation: { type: 'cloture-signee', charge: { ...ch, moteur: { version: 'v9', sha256: '0'.repeat(64) } }, signature: '!' } }));
    assert.match(r.erreurs.join(), /signature : base64 strict/);
  });
  test('objets aux clés réordonnées (moteur, badge) : même charge canonique, acceptée', async () => {
    const { lot, ch } = await chargeFr();
    const sig = signer(ch);
    const reordonnee = { ...ch, moteur: { sha256: ch.moteur.sha256, version: ch.moteur.version }, badge: { id: ch.badge.id, nom_affiche: ch.badge.nom_affiche, forme: ch.badge.forme } };
    const r = await preparerPublication(base({ lot, attestation: enveloppe(reordonnee, sig) }));
    assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  });
});

describe('recevabilité : bornes et temporalité (aucune dépendance à la date du jour)', () => {
  const avecCle = async (decl, cloture) => {
    const lot = LOT_FR();
    const ch = { ...(await chargePour(lot, 'reponse_message')), cloture_le: cloture };
    return preparerPublication(base({ lot, attestation: enveloppe(ch), cles: cles([declaration('cle-test', K.pem, decl)], { 'cles/cle-test.pem': K.pem }) }));
  };
  test('cloture_le = valide_du et = valide_au : recevables ; période réduite à un instant : recevable', async () => {
    assert.equal((await avecCle({ valide_du: '2026-10-20T08:10:00.000Z' }, '2026-10-20T08:10:00.000Z')).ok, true);
    assert.equal((await avecCle({ valide_au: '2026-10-20T08:10:00.000Z' }, '2026-10-20T08:10:00.000Z')).ok, true);
    assert.equal((await avecCle({ valide_du: '2026-10-20T08:10:00.000Z', valide_au: '2026-10-20T08:10:00.000Z' }, '2026-10-20T08:10:00.000Z')).ok, true);
  });
  test('cloture_le 1 ms après valide_au -> refusé', async () => {
    assert.match((await avecCle({ valide_au: '2026-10-20T08:09:59.999Z' }, '2026-10-20T08:10:00.000Z')).erreurs.join(), /hors de la période/);
  });
  test('clé EXPIRÉE depuis longtemps (période entièrement passée) : attestation de la période toujours recevable', async () => {
    const r = await avecCle({ valide_du: '2025-01-01T00:00:00.000Z', valide_au: '2025-02-01T00:00:00.000Z' }, '2025-01-15T12:00:00.000Z');
    assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  });
  test('révocation datée dans le futur : irrecevable dès maintenant (§14)', async () => {
    assert.match((await avecCle({ revoquee_le: '2030-01-01T00:00:00.000Z' }, '2026-10-20T08:10:00.000Z')).erreurs.join(), /révoquée/);
  });
});

describe('chemins nominaux et doublons', () => {
  test('vive_voix et badge « sans nom » : acceptés', async () => {
    const lot = LOT_FR();
    const ch = await chargePour(lot, 'vive_voix');
    ch.badge = { forme: 'relue_par', nom_affiche: 'un professeur', id: null };
    const r = await preparerPublication(base({ lot, attestation: enveloppe(ch) }));
    assert.equal(r.ok, true, JSON.stringify(r.erreurs));
    assert.equal(r.entree.relecteur.id, null);
  });
  const inc = (id) => ({ id, nature: 'x', detecte_le: '2026-10-01T00:00:00.000Z', statut: 'resolu', resolu_le: '2026-10-02T00:00:00.000Z', preuve_resolution: 'ok', periode: { debut: null, fin: '2026-10-02T00:00:00.000Z' } });
  for (const [libelle, alterer, motif] of [
    ['provenance en double', (c) => { c.provenances = [c.provenances[0], { ...c.provenances[0] }]; }, /double/],
    ['incident en double', (c) => { c.incidents_connus = [inc('i1'), inc('i1')]; }, /double/],
    ['levée en double', (c) => { c.levees = [{ type: 'recherche_incomplete', constat: 'a' }, { type: 'recherche_incomplete', constat: 'b' }]; }, /double/],
  ]) {
    test(`refusé : ${libelle}`, async () => {
      const lot = LOT_FR();
      const ch = await chargePour(lot, 'reponse_message');
      alterer(ch);
      assert.match((await preparerPublication(base({ lot, attestation: enveloppe(ch) }))).erreurs.join(' | '), motif);
    });
  }
});

// --- CDC v8.3 §20.11 : journal (transition publie) — cœur pur ---------------------------
describe('journal : seul « reserve » est publiable ; ligne publie = ref de réservation + ":publie"', () => {
  test('nominal : ligne publie ajoutée (ref, date), journal résultant conforme, état publie', async () => {
    const lot = LOT_FR();
    const r = await preparerPublication(base({ lot, attestation: enveloppe(await chargePour(lot, 'reponse_message')) }));
    assert.equal(r.ok, true, JSON.stringify(r.erreurs));
    assert.deepEqual(r.lignePublie, { set_id: lot.set_id, transition: 'publie', le: '2026-10-21T09:00:00.000Z', ref: `test-2026-10-17:${lot.set_id}:publie` });
    assert.deepEqual(r.journal.lignes.slice(0, -1), journalTest().lignes);
    const J = require('../engine/journal-set-ids.js');
    assert.equal(J.etatCourant(r.journal, lot.set_id), 'publie');
  });
  for (const [libelle, journal, motif] of [
    ['set_id absent du journal', () => journalTest([]), /état absent/],
    ['déjà publié au journal', () => { const j = journalTest(); j.lignes.push({ set_id: RESERVES[0], transition: 'publie', le: '2026-10-18', ref: `x:${RESERVES[0]}:publie` }); return j; }, /état publie/],
    ['abandonné', () => { const j = journalTest(); j.lignes.push({ set_id: RESERVES[0], transition: 'abandonne', le: '2026-10-18', ref: `x:${RESERVES[0]}:abandonne` }); return j; }, /état abandonne/],
    ['journal non conforme', () => ({ schema: 'autre', lignes: [] }), /journal :/],
    ['journal absent', () => undefined, /journal :/],
  ]) {
    test(`refusé : ${libelle}`, async () => {
      const lot = LOT_FR();
      const r = await preparerPublication(base({ lot, attestation: enveloppe(await chargePour(lot, 'reponse_message')), journal: journal() }));
      assert.equal(r.ok, false);
      assert.match(r.erreurs.join(' | '), motif);
    });
  }
  test('date de la ligne publie invalide -> refus (journal après publie non conforme)', async () => {
    const lot = LOT_FR();
    const r = await preparerPublication(base({ lot, attestation: enveloppe(await chargePour(lot, 'reponse_message')), le: undefined }));
    assert.match(r.erreurs.join(' | '), /journal après publie/);
  });
  test('ref de réservation de 120 caractères : « :publie » reste valide (127)', async () => {
    const lot = LOT_FR();
    const ref = 'r' + 'x'.repeat(119);
    const j = journalTest([]); j.lignes.push({ set_id: lot.set_id, transition: 'reserve', le: '2026-10-17', ref });
    const r = await preparerPublication(base({ lot, attestation: enveloppe(await chargePour(lot, 'reponse_message')), journal: j }));
    assert.equal(r.ok, true, JSON.stringify(r.erreurs));
    assert.equal(r.lignePublie.ref.length, 127);
  });
});

// --- CDC v8.3 §20.12 : référentiel ARCHIVÉ — cœur pur --------------------------------------
describe('référentiel archivé : le relecteur attribué est vérifié contre la version de la charge', () => {
  const avecRelecteur = (notionId, relecteur) => ({ ...copie(REFERENTIEL), notions: REFERENTIEL.notions.map((n) => (n.id === notionId ? { ...n, relecteur } : n)) });
  test('le résolveur reçoit referentiel_version de la charge', async () => {
    const lot = LOT_FR();
    const ch = await chargePour(lot, 'reponse_message');
    const vus = [];
    const r = await preparerPublication(base({ lot, attestation: enveloppe(ch), referentielArchive: async (v) => { vus.push(v); return { ok: true, referentiel: REFERENTIEL }; } }));
    assert.equal(r.ok, true, JSON.stringify(r.erreurs));
    assert.deepEqual(vus, [ch.referentiel_version]);
  });
  test('résolveur absent, version introuvable ou réponse invalide -> refus (jamais de contrôle du relecteur sauté)', async () => {
    const lot = LOT_FR();
    const att = enveloppe(await chargePour(lot, 'reponse_message'));
    assert.match((await preparerPublication(base({ lot, attestation: att, referentielArchive: undefined }))).erreurs.join(), /résolveur de référentiel archivé absent/);
    assert.match((await preparerPublication(base({ lot, attestation: att, referentielArchive: async () => ({ ok: false, raison: 'introuvable sur l\'historique' }) }))).erreurs.join(), /référentiel archivé : introuvable sur l'historique/);
    for (const rep of [null, {}, { ok: true }, { ok: true, referentiel: null }, { ok: 'oui', referentiel: REFERENTIEL }]) {
      assert.equal((await preparerPublication(base({ lot, attestation: att, referentielArchive: async () => rep }))).ok, false, JSON.stringify(rep));
    }
  });
  test('relecteur différent dans la version ARCHIVÉE -> refus, même si le référentiel courant concorde', async () => {
    const lot = LOT_FR();
    const r = await preparerPublication(base({ lot, attestation: enveloppe(await chargePour(lot, 'reponse_message')), referentielArchive: archive(avecRelecteur(lot.notion_id, 'eric')) }));
    assert.match(r.erreurs.join(), /relecteur_attribue ≠ relecteur du référentiel/);
  });
  test('réattribution ULTÉRIEURE au référentiel courant : n\'invalide pas l\'attestation (version archivée concordante)', async () => {
    const lot = LOT_FR();
    // Catalogue sans les lots historiques (Type 1) de cette notion : eux n'ont pas de
    // referentiel_version et restent contrôlés contre le référentiel courant (hors §20.12).
    const catalogue = { ...copie(CATALOGUE), lots: CATALOGUE.lots.filter((e) => e.notion_id !== lot.notion_id) };
    const r = await preparerPublication(base({ lot, catalogue, attestation: enveloppe(await chargePour(lot, 'reponse_message')), referentiel: avecRelecteur(lot.notion_id, 'eric') }));
    assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  });
});

// --- CDC v8.3 §20.11 : couche Git (préconditions, marqueur, reprise) — dépôt temporaire ----
describe('publier : préconditions, écritures, marqueur et --reprendre (dépôt Git temporaire)', () => {
  const fsN = require('fs');
  const os = require('os');
  const pathN = require('path');
  const { execFileSync } = require('child_process');
  const { publier, environnement } = require('./publier-lot.js');
  const texteJson = (o) => `${JSON.stringify(o, null, 2)}\n`;
  const REL = { cat: 'fonda/data/catalogue-fonda.json', jou: 'fonda/data/set_ids-journal.json', ref: 'fonda/data/referentiel.json' };

  async function depot({ journal = journalTest() } = {}) {
    const dir = fsN.mkdtempSync(pathN.join(os.tmpdir(), 'publier-'));
    const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    git('init', '-q', '-b', 'design');
    git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'test'); git('config', 'commit.gpgsign', 'false');
    fsN.mkdirSync(pathN.join(dir, 'fonda/data/lots'), { recursive: true });
    fsN.writeFileSync(pathN.join(dir, 'fonda/data/lots/.gitkeep'), '');
    fsN.writeFileSync(pathN.join(dir, REL.cat), texteJson(CATALOGUE));
    fsN.writeFileSync(pathN.join(dir, REL.jou), texteJson(journal));
    fsN.writeFileSync(pathN.join(dir, REL.ref), texteJson(REFERENTIEL));
    git('add', '-A'); git('commit', '-q', '-m', 'base');
    const ext = fsN.mkdtempSync(pathN.join(os.tmpdir(), 'publier-entrees-'));
    const lot = LOT_FR();
    const cheminLot = pathN.join(ext, 'lot.json');
    const cheminAttestation = pathN.join(ext, 'attestation.json');
    fsN.writeFileSync(cheminLot, texteJson(lot));
    fsN.writeFileSync(cheminAttestation, texteJson(enveloppe(await chargePour(lot, 'reponse_message'))));
    const dependances = { horloge: () => new Date('2026-10-21T09:00:00.000Z'), referentielArchive: archive(), sha256Hex, cles: CLES };
    const marqueur = pathN.join(dir, '.git', `fonda-publication-${lot.set_id}`);
    const lire = (rel) => fsN.readFileSync(pathN.join(dir, rel));
    const nettoyer = () => { fsN.rmSync(dir, { recursive: true, force: true }); fsN.rmSync(ext, { recursive: true, force: true }); };
    return { dir, git, lot, cheminLot, cheminAttestation, dependances, marqueur, lire, nettoyer, relLot: `fonda/data/lots/${lot.set_id}.json` };
  }

  test('nominal : lot (octets d\'entrée), catalogue + entrée, journal + publie ; marqueur retiré ; seuls ces chemins changent', async () => {
    const d = await depot();
    try {
      const r = await publier({ cheminLot: d.cheminLot, cheminAttestation: d.cheminAttestation, env: environnement(d.dir), dependances: d.dependances });
      assert.deepEqual(r.ecrits, [d.relLot, REL.cat, REL.jou]);
      assert.ok(d.lire(d.relLot).equals(fsN.readFileSync(d.cheminLot)));
      const cat = JSON.parse(d.lire(REL.cat));
      assert.equal(cat.lots.length, CATALOGUE.lots.length + 1);
      assert.equal(cat.lots.at(-1).set_id, d.lot.set_id);
      const jou = JSON.parse(d.lire(REL.jou));
      assert.deepEqual(jou.lignes.at(-1), { set_id: d.lot.set_id, transition: 'publie', le: '2026-10-21T09:00:00.000Z', ref: `test-2026-10-17:${d.lot.set_id}:publie` });
      assert.equal(d.lire(REL.cat).toString(), texteJson(cat));
      assert.equal(fsN.existsSync(d.marqueur), false);
      assert.deepEqual(d.git('status', '--porcelain').split('\n').map((l) => l.trim()).sort(), [`M ${REL.cat}`, `M ${REL.jou}`, `?? ${d.relLot}`].sort());
    } finally { d.nettoyer(); }
  });
  test('dry-run : contrôles complets, rien écrit, aucun marqueur', async () => {
    const d = await depot();
    try {
      await publier({ cheminLot: d.cheminLot, cheminAttestation: d.cheminAttestation, mode: 'dry-run', env: environnement(d.dir), dependances: d.dependances });
      assert.equal(d.git('status', '--porcelain'), '');
      assert.equal(fsN.existsSync(d.marqueur), false);
    } finally { d.nettoyer(); }
  });
  for (const [libelle, preparer, motif] of [
    ['catalogue modifié non commité', (d) => fsN.appendFileSync(pathN.join(d.dir, REL.cat), ' '), /modifications non commitées/],
    ['journal modifié non commité', (d) => fsN.appendFileSync(pathN.join(d.dir, REL.jou), ' '), /modifications non commitées/],
    ['modification indexée puis annulée sur disque', (d) => { const p = pathN.join(d.dir, REL.cat); const t = fsN.readFileSync(p); fsN.appendFileSync(p, ' '); d.git('add', REL.cat); fsN.writeFileSync(p, t); }, /modifications non commitées/],
    ['fichier du lot présent sur disque', (d) => fsN.writeFileSync(pathN.join(d.dir, d.relLot), '{}'), /existe déjà/],
    ['marqueur d\'une publication interrompue', (d) => fsN.writeFileSync(d.marqueur, '{}'), /utiliser --reprendre/],
  ]) {
    test(`précondition : ${libelle} -> refus AVANT tout calcul et toute écriture`, async () => {
      const d = await depot();
      try {
        preparer(d);
        const avant = d.git('status', '--porcelain');
        const appels = [];
        const dep = { ...d.dependances, referentielArchive: async (v) => { appels.push(v); return { ok: true, referentiel: REFERENTIEL }; } };
        await assert.rejects(publier({ cheminLot: d.cheminLot, cheminAttestation: d.cheminAttestation, env: environnement(d.dir), dependances: dep }), motif);
        assert.equal(appels.length, 0, 'aucun calcul');
        assert.equal(d.git('status', '--porcelain'), avant);
      } finally { d.nettoyer(); }
    });
  }
  test('contrôle refusé (journal sans réservation) : aucune écriture, aucun marqueur', async () => {
    const d = await depot({ journal: journalTest([]) });
    try {
      await assert.rejects(publier({ cheminLot: d.cheminLot, cheminAttestation: d.cheminAttestation, env: environnement(d.dir), dependances: d.dependances }), /seul « reserve » est publiable/);
      assert.equal(d.git('status', '--porcelain'), '');
      assert.equal(fsN.existsSync(d.marqueur), false);
    } finally { d.nettoyer(); }
  });
  test('HEAD au format non canonique -> refus (l\'écriture changerait plus que l\'ajout)', async () => {
    const d = await depot();
    try {
      fsN.writeFileSync(pathN.join(d.dir, REL.cat), JSON.stringify(CATALOGUE));
      d.git('commit', '-q', '-am', 'compact');
      await assert.rejects(publier({ cheminLot: d.cheminLot, cheminAttestation: d.cheminAttestation, env: environnement(d.dir), dependances: d.dependances }), /format non canonique/);
      assert.equal(d.git('status', '--porcelain'), '');
    } finally { d.nettoyer(); }
  });

  // Panne sur : le catalogue (lot déjà écrit) ; le journal (lot + catalogue écrits) ; le
  // lot lui-même (rien d'écrit hors marqueur).
  for (const [panne, completes] of [
    ['catalogue-fonda.json', () => [REL.cat, REL.jou]],
    ['set_ids-journal.json', () => [REL.jou]],
    ['.json', (d0) => [d0.relLot, REL.cat, REL.jou]],
  ]) {
    test(`panne pendant l'écriture (${panne}) : marqueur conservé ; --reprendre complète exactement le reste`, async () => {
      const d = await depot();
      try {
        const env = environnement(d.dir);
        // Panne sur le PREMIER chemin se terminant par le suffixe, hors marqueur.
        let fait = false;
        const envPanne = { ...env,
          ecrire: (p, x) => { if (!fait && p.endsWith(panne)) { fait = true; throw new Error('panne simulée'); } return env.ecrire(p, x); },
          ecrireExclusif: (p, x) => { if (!fait && p.endsWith(panne) && !p.includes('fonda-publication-')) { fait = true; throw new Error('panne simulée'); } return env.ecrireExclusif(p, x); } };
        await assert.rejects(publier({ cheminLot: d.cheminLot, cheminAttestation: d.cheminAttestation, env: envPanne, dependances: d.dependances }), /panne simulée/);
        assert.equal(fsN.existsSync(d.marqueur), true, 'marqueur conservé');
        const r = await publier({ cheminLot: d.cheminLot, cheminAttestation: d.cheminAttestation, mode: 'reprendre', env, dependances: { ...d.dependances, horloge: () => new Date('2030-01-01T00:00:00.000Z') } });
        assert.deepEqual(r.ecrits, completes(d));
        assert.equal(fsN.existsSync(d.marqueur), false);
        // État final identique à une publication sans panne (date du marqueur, pas de l'horloge).
        const ref = await depot();
        try {
          await publier({ cheminLot: d.cheminLot, cheminAttestation: d.cheminAttestation, env: environnement(ref.dir), dependances: d.dependances });
          for (const rel of [REL.cat, REL.jou]) assert.ok(d.lire(rel).equals(ref.lire(rel)), rel);
          assert.ok(d.lire(d.relLot).equals(fsN.readFileSync(d.cheminLot)));
        } finally { ref.nettoyer(); }
      } finally { d.nettoyer(); }
    });
  }
  test('--reprendre après publication complète (marqueur restauré) : rien à compléter', async () => {
    const d = await depot();
    try {
      const env = environnement(d.dir);
      await publier({ cheminLot: d.cheminLot, cheminAttestation: d.cheminAttestation, env, dependances: d.dependances });
      fsN.writeFileSync(d.marqueur, texteJson({ set_id: d.lot.set_id, head: d.git('rev-parse', 'HEAD'), le: '2026-10-21T09:00:00.000Z' }));
      const r = await publier({ cheminLot: d.cheminLot, cheminAttestation: d.cheminAttestation, mode: 'reprendre', env, dependances: d.dependances });
      assert.deepEqual(r.ecrits, []);
      assert.match(r.message, /rien à compléter/);
    } finally { d.nettoyer(); }
  });

  // Refus de reprise : vérifiés AVANT toute écriture (état du disque inchangé).
  async function apresPanneJournal() {
    const d = await depot();
    const env = environnement(d.dir);
    const envPanne = { ...env, ecrire: (p, x) => { if (p.endsWith('set_ids-journal.json')) throw new Error('panne simulée'); return env.ecrire(p, x); } };
    await assert.rejects(publier({ cheminLot: d.cheminLot, cheminAttestation: d.cheminAttestation, env: envPanne, dependances: d.dependances }), /panne simulée/);
    return { d, env };
  }
  for (const [libelle, alterer, motif] of [
    ['sans marqueur', (d) => fsN.unlinkSync(d.marqueur), /aucun marqueur/],
    ['marqueur illisible', (d) => fsN.writeFileSync(d.marqueur, '{ cassé'), /marqueur illisible/],
    ['marqueur d\'un autre set_id', (d) => { const m = JSON.parse(fsN.readFileSync(d.marqueur)); m.set_id = 'set_fonda_autre_nI_01'; fsN.writeFileSync(d.marqueur, JSON.stringify(m)); }, /marqueur mal formé/],
    ['commit intervenu entre-temps (même sur un autre fichier)', (d) => { fsN.writeFileSync(pathN.join(d.dir, 'autre.txt'), 'x'); d.git('add', 'autre.txt'); d.git('commit', '-q', '-m', 'autre'); }, /≠ SHA consigné/],
    ['catalogue modifié au-delà de l\'entrée attendue', (d) => fsN.appendFileSync(pathN.join(d.dir, REL.cat), ' '), /ni HEAD ni HEAD \+ l'ajout attendu/],
    ['journal modifié autrement', (d) => fsN.writeFileSync(pathN.join(d.dir, REL.jou), texteJson({ ...journalTest(), lignes: journalTest().lignes.slice(0, -1) })), /ni HEAD ni HEAD \+ l'ajout attendu/],
    ['fichier du lot ≠ lot à publier', (d) => fsN.appendFileSync(pathN.join(d.dir, d.relLot), ' '), /≠ lot à publier/],
    ['fichier du lot suivi par Git', (d) => d.git('add', d.relLot), /index ≠ HEAD|suivi par Git/],
    ['modification indexée sur le catalogue', (d) => d.git('add', REL.cat), /index ≠ HEAD/],
  ]) {
    test(`--reprendre refusé : ${libelle} — avant toute écriture`, async () => {
      const { d, env } = await apresPanneJournal();
      try {
        alterer(d);
        const instantane = () => [d.relLot, REL.cat, REL.jou].map((rel) => (fsN.existsSync(pathN.join(d.dir, rel)) ? d.lire(rel).toString('base64') : null));
        const avant = instantane();
        await assert.rejects(publier({ cheminLot: d.cheminLot, cheminAttestation: d.cheminAttestation, mode: 'reprendre', env, dependances: d.dependances }), motif);
        assert.deepEqual(instantane(), avant);
      } finally { d.nettoyer(); }
    });
  }
  test('--reprendre revérifie tout : attestation devenue irrecevable (clé absente) -> refus, rien écrit', async () => {
    const { d, env } = await apresPanneJournal();
    try {
      const avant = d.lire(REL.jou);
      const dep = { ...d.dependances, cles: cles([], {}) };
      await assert.rejects(publier({ cheminLot: d.cheminLot, cheminAttestation: d.cheminAttestation, mode: 'reprendre', env, dependances: dep }), /publication refusée/);
      assert.ok(d.lire(REL.jou).equals(avant));
    } finally { d.nettoyer(); }
  });
});
