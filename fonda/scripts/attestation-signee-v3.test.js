// Tests de la charge attestation-cloture/v3 (relecteur de SECOURS en intérim, CDC r9 §20.6,
// §20.9 ; plan r6, annexe D) dans fonda/scripts/attestation-signee.js : chaque invariant
// (A repris de v2, B remplacés, C nouveaux, D de dépôt) violé SÉPARÉMENT ; v1/v2 jamais
// porteuses du badge de secours ; titulaire falsifié refusé par le vérificateur Node.
// Usage : node --test fonda/scripts/attestation-signee-v3.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const S = require('./attestation-signee.js');
const I = require('./interim.js');
const Canonique = require('../engine/canonique.js');

const V = require('../engine/canonique-vecteurs.json').vecteurs;
const REGISTRE = require('../engine/moteurs.json');
// FIXTURE de test (jamais l'entrée réelle de fonda/data : son retrait ne doit pas casser la CI).
const OCT_INTERIM = fs.readFileSync(path.join(__dirname, 'fixtures/relecture-interim.json'));
const VERSION = `sha256:${crypto.createHash('sha256').update(OCT_INTERIM).digest('hex')}`;
const MODELE = 'claude-sonnet-5-5';
const copie = (o) => JSON.parse(JSON.stringify(o));
const REFERENTIEL = { notions: [{ id: 'fr.comprendre-consigne', relecteur: 'justine' }] };

// Charge v3 conforme : vecteur figé « attestation-v3-interim », modèle épinglé, archive réelle.
function charge() {
  const ch = copie(V.find((x) => x.id === 'attestation-v3-interim').entree);
  ch.generation.modele = MODELE;
  ch.moteur = { version: 'v1', sha256: REGISTRE[0].sha256 };
  ch.coeur.moteur = { ...ch.moteur };
  ch.relecture_interim.source_version = VERSION;
  return ch;
}
const valeur = (ch) => S.invariantsValeur(ch, { modelesAutorises: [MODELE] });
const entreeDe = (ch) => ({ set_id: ch.set_id, notion_id: ch.notion_id, palier: ch.palier, item_ids: [...ch.coeur.selection], empreinte: ch.coeur.empreinte_publiee, moteur: { ...ch.moteur }, relecteur: copie(ch.badge) });
const resoudreInterim = (v) => (v === VERSION ? { ok: true, octets: OCT_INTERIM } : { ok: false, raison: 'introuvable' });
const depot = (ch, sur = {}) => S.invariantsDepot(ch, { entree: entreeDe(ch), registre: REGISTRE, referentiel: REFERENTIEL, resoudreInterim, ...sur });

describe('charge v3 conforme', () => {
  test('invariants de valeur et de dépôt : aucun défaut ; forme canonique v3', () => {
    const ch = charge();
    assert.doesNotThrow(() => Canonique.octetsContrat('attestation-cloture/v3', ch));
    assert.deepEqual(valeur(ch), []);
    assert.deepEqual(depot(ch), []);
  });
  test('signée puis vérifiée de bout en bout (clé éphémère)', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
    const pem = publicKey.export({ type: 'spki', format: 'pem' });
    const cles = S.chargerCles([{ cle_id: 'eric-2026', fichier: 'cles/eric-2026.pem', sha256_pem: crypto.createHash('sha256').update(pem).digest('hex'), algorithme: 'RSA-SHA256-PKCS1v15', valide_du: '2026-01-01T00:00:00.000Z', valide_au: '2027-12-31T00:00:00.000Z', revoquee_le: null }], () => pem);
    const ch = charge();
    const env = { type: 'cloture-signee', charge: ch, signature: crypto.sign('sha256', Buffer.from(Canonique.octetsContrat('attestation-cloture/v3', ch)), { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }).toString('base64') };
    const opts = { entree: entreeDe(ch), registre: REGISTRE, referentiel: REFERENTIEL, cles, modelesAutorises: [MODELE] };
    assert.deepEqual(S.verifierAttestationSignee(env, { ...opts, resoudreInterim }), []);
    assert.match(S.verifierAttestationSignee(env, opts).join(), /résolveur d'archive d'intérim absent/, 'D5 : sans résolveur -> erreur');
    assert.match(S.verifierAttestationSignee(env, { ...opts, resoudreInterim: () => ({ ok: false, raison: 'introuvable' }) }).join(), /archive d'intérim : introuvable/, 'D2');
  });
});

describe('annexe D : chaque invariant v3 violé SÉPARÉMENT', () => {
  const cas = [
    // A — repris de v2
    ['A1 code ≠ instantané', (c) => { c.code_confirmation = '0'.repeat(16); }, /code_confirmation/],
    ['A2 date non signée', (c) => { c.confirmation.le = '2026-11-04T16:25:00Z'; }, /confirmation\.le : date ISO/],
    ['A2 fin_saisie_le non signée', (c) => { c.fin_saisie_le = '2026-11-04'; }, /fin_saisie_le : date ISO/],
    ['A3 recue_par ≠ eric', (c) => { c.confirmation.recue_par = 'justine'; }, /recue_par/],
    ['A3 fidélité ≠ eric', (c) => { c.fidelite_transmission.atteste_par = 'justine'; }, /atteste_par/],
    ['A4 action ≠ accepter', (c) => { c.coeur.action = 'rejeter'; }, /coeur\.action/],
    ['A4 sélection vide', (c) => { c.coeur.selection = []; }, /selection vide/],
    ['A4 selection ∩ ecartees', (c) => { c.coeur.ecartees = [...c.coeur.ecartees, c.coeur.selection[0]]; }, /non disjointes/],
    ['A5 levée inconnue', (c) => { c.levees = [{ type: 'autre', constat: 'x' }]; }, /type inconnu/],
    ['A5 levée au constat vide', (c) => { c.levees = [{ type: 'recherche_incomplete', constat: '' }]; }, /constat vide/],
    ['A5 levée au constat d\'espaces', (c) => { c.levees = [{ type: 'recherche_incomplete', constat: '   ' }]; }, /constat vide/],
    ['A5 incident non résolu', (c) => { c.incidents_connus = [{ id: 'i', nature: 'n', detecte_le: '2026-11-04T08:00:00.000Z', statut: 'ouvert', resolu_le: null, preuve_resolution: null, periode: { debut: null, fin: null } }]; }, /non résolu/],
    ['A6 génération non réussie', (c) => { c.generation.statut = 'error'; }, /generation\.statut/],
    ['A6 modèle hors liste', (c) => { c.generation.modele = 'claude-sonnet-4-6'; }, /modèles autorisés/],
    ['A6 journal_commit mal formé', (c) => { c.generation.journal_commit = 'abc'; }, /journal_commit/],
    ['A7 chronologie commune', (c) => { c.cloture_le = '2026-11-04T16:25:10.000Z'; }, /chronologie commune/],
    ['A8 provenances non vides', (c) => { c.provenances = [{ execution_id: '1', workflow_id: 'w', statut: 'success', demarree_le: '2026-11-04T10:00:00.000Z' }]; }, /provenances doit être vide/],
    ['A8 execution_cloture non nulle', (c) => { c.execution_cloture = { execution_id: '1', workflow_id: 'w', statut: 'success', terminee_le: '2026-11-04T10:00:00.000Z' }; }, /execution_cloture doit être null/],
    ['A8 revoque_le non nul', (c) => { c.revoque_le = '2026-11-04T10:00:00.000Z'; }, /revoque_le doit être null/],
    ['A8 nb_fichiers_decision ≠ 1', (c) => { c.nb_fichiers_decision = 2; }, /nb_fichiers_decision = 1/],
    ['A8 chronologie saisie locale', (c) => { c.fin_saisie_le = '2026-11-04T09:01:00.000Z'; }, /chronologie saisie locale/],
    // B — remplacés pour v3
    // B1 : l'aiguillage se fait PAR schema — une charge v3 étiquetée v2 relève des règles v2, qui la refusent.
    ['B1 schema (v3 étiquetée v2 -> règles v2 : refus)', (c) => { c.schema = 'attestation-cloture/v2'; }, /badge\.forme hors énumération \(relue_par_secours\)/],
    ['B2 page_relecture', (c) => { c.source_decisions = 'page_relecture'; }, /saisie locale seule/],
    ['B3 attribué ≠ titulaire', (c) => { c.relecteur_attribue = 'eric'; }, /relecteur_attribue ≠ relecture_interim\.relecteur_titulaire/],
    ['B3 attribué = eric', (c) => { c.relecteur_attribue = 'eric'; c.relecture_interim.relecteur_titulaire = 'eric'; c.badge.titulaire.id = 'eric'; }, /relecteur_attribue = "eric"/],
    ['B4 secours ≠ eric', (c) => { c.relecture_interim.relecteur_de_secours = 'justine'; }, /relecteur_de_secours = "eric" attendu/],
    ['B4 titulaire = secours', (c) => { c.relecture_interim.relecteur_titulaire = 'eric'; c.relecteur_attribue = 'eric'; c.badge.titulaire.id = 'eric'; }, /titulaire = secours/],
    ['B5 mode ≠ auto', (c) => { c.confirmation.mode = 'vive_voix'; }, /confirmation\.mode = "auto"/],
    ['B5 par ≠ secours', (c) => { c.confirmation.par = 'justine'; }, /confirmation\.par ≠ relecteur_de_secours/],
    ['B6 égalité vraie', (c) => { c.relecteur_egal_cloturer = true; }, /relecteur_egal_cloturer = false/],
    ['B7 forme ≠ secours', (c) => { c.badge.forme = 'relue_par'; }, /badge\.forme = "relue_par_secours"/],
    ['B7 badge.id ≠ secours', (c) => { c.badge.id = 'justine'; }, /badge\.id ≠ relecteur_de_secours/],
    ['B7 titulaire.id ≠ titulaire', (c) => { c.badge.titulaire.id = 'eric'; }, /badge\.titulaire\.id/],
    ['B7 nom affiché vide', (c) => { c.badge.titulaire.nom_affiche = ' '; }, /nom_affiche non vides/],
    // C — nouveaux
    ['C1 motif vide', (c) => { c.relecture_interim.motif = ''; }, /relecture_interim\.motif vide/],
    ['C1 date irréelle', (c) => { c.relecture_interim.au = '2026-11-31'; }, /date civile/],
    ['C1 du > au', (c) => { c.relecture_interim.du = '2026-12-19'; }, /du > au/],
    ['C1 source_version mal formée', (c) => { c.relecture_interim.source_version = 'v1'; }, /source_version : sha256/],
    ['C2 fin_saisie_le avant du (Paris)', (c) => { c.relecture_interim.du = '2026-11-05'; }, /fin_saisie_le hors de la fenêtre/],
    ['C2 cloture_le après au (Paris)', (c) => { c.relecture_interim.au = '2026-11-03'; c.relecture_interim.du = '2026-10-28'; }, /hors de la fenêtre/],
  ];
  for (const [nom, alterer, motif] of cas) {
    test(nom, () => {
      const ch = charge();
      alterer(ch);
      assert.match(valeur(ch).join(' | '), motif);
    });
  }
  test('C2 borne de Paris : clôture le 18/12 à 23:30 (Paris) = 22:30Z admise ; 23:30Z (19/12 à Paris) refusée', () => {
    const ch = charge();
    Object.assign(ch, { fin_saisie_le: '2026-12-18T20:00:00.000Z', cloture_le: '2026-12-18T22:30:00.000Z' });
    Object.assign(ch.generation, { demarree_le: '2026-12-18T10:00:00.000Z', terminee_le: '2026-12-18T10:01:00.000Z', listing_debut_le: '2026-12-18T21:00:00.000Z', listing_fin_le: '2026-12-18T21:00:01.000Z' });
    ch.confirmation.le = '2026-12-18T22:00:00.000Z'; ch.fidelite_transmission.le = '2026-12-18T22:10:00.000Z';
    assert.deepEqual(valeur(ch), []);
    ch.cloture_le = '2026-12-18T23:30:00.000Z';
    assert.match(valeur(ch).join(), /cloture_le hors de la fenêtre/);
  });
  test('C3 : aucun calendrier — période absente du calendrier courant sans effet sur la vérification', () => {
    const ch = charge();
    ch.relecture_interim.periode = 'P-historique';
    assert.deepEqual(valeur(ch), [], 'la période n\'est contrôlée qu\'au moment de signer (calendrier du même commit)');
  });
});

describe('annexe D : dépôt (D1–D5) et rejets croisés', () => {
  test('D1 : titulaire FALSIFIÉ dans l\'entrée du catalogue -> refus du vérificateur Node', () => {
    const ch = charge();
    for (const t of [{ id: 'justine', nom_affiche: 'Autre Nom' }, { id: 'paul', nom_affiche: 'Justine Leblanc' }]) {
      assert.match(S.invariantsDepot(ch, { entree: { ...entreeDe(ch), relecteur: { ...ch.badge, titulaire: t } }, registre: REGISTRE, referentiel: REFERENTIEL, resoudreInterim }).join(), /badge ≠ relecteur de l'entrée/);
    }
    const sans = { ...entreeDe(ch), relecteur: { forme: ch.badge.forme, nom_affiche: ch.badge.nom_affiche, id: ch.badge.id } };
    assert.match(S.invariantsDepot(ch, { entree: sans, registre: REGISTRE, referentiel: REFERENTIEL, resoudreInterim }).join(), /badge ≠ relecteur de l'entrée/);
  });
  test('D1 : relecteur attribué ≠ référentiel ARCHIVÉ -> refus', () => {
    assert.match(depot(charge(), { referentiel: { notions: [{ id: 'fr.comprendre-consigne', relecteur: 'eric' }] } }).join(), /relecteur_attribue ≠ relecteur du référentiel/);
  });
  for (const k of I.CHAMPS_ENTREE) {
    test(`D4 : bloc signé ≠ entrée de l'archive (${k}) -> refus`, () => {
      const ch = charge();
      ch.relecture_interim[k] = `${ch.relecture_interim[k]}x`;
      assert.match(depot(ch).join(), /exactement une entrée de l'archive/);
    });
  }
  test('D2 : archive à une autre version -> refus ; D3 : archive invalide -> refus', () => {
    const ch = charge();
    assert.match(depot(ch, { resoudreInterim: () => ({ ok: true, octets: Buffer.from('{}') }) }).join(), /≠ source_version/);
    const bad = Buffer.from(JSON.stringify({ schema: 'relecture-interim/v1', entrees: [{ ...JSON.parse(OCT_INTERIM).entrees[0], motif: '' }] }));
    const ch2 = { ...ch, relecture_interim: { ...ch.relecture_interim, source_version: `sha256:${crypto.createHash('sha256').update(bad).digest('hex')}` } };
    assert.match(depot(ch2, { resoudreInterim: () => ({ ok: true, octets: bad }) }).join(), /non conforme/);
  });
  test('rejets croisés : charge v2 portant le badge de secours -> refus (forme canonique v2 ; énumération v1/v2 inchangée)', () => {
    const v2 = copie(V.find((x) => x.id === 'attestation-v2-saisie-locale').entree);
    assert.throws(() => Canonique.octetsContrat('attestation-cloture/v2', { ...v2, badge: { forme: 'relue_par_secours', nom_affiche: 'Éric Duchateau', id: 'eric', titulaire: { id: 'justine', nom_affiche: 'Justine Leblanc' } } }), /titulaire : champ inconnu/);
    assert.match(S.invariantsValeur({ ...v2, badge: { forme: 'relue_par_secours', nom_affiche: 'Éric Duchateau', id: 'eric' } }, { modelesAutorises: [MODELE] }).join(), /badge\.forme hors énumération/);
  });
});
