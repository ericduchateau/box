// Tests de fonda/scripts/attestation-signee.js — charge attestation-cloture/v2 (CDC v8.3
// §20.9) : invariants COMMUNS puis PAR SOURCE, chronologies, G5 (modèle épinglé daté).
// Clés RSA 3072 ÉPHÉMÈRES. Usage : node --test fonda/scripts/attestation-signee-v2.test.js
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const Canonique = require('../engine/canonique.js');
const S = require('./attestation-signee.js');

const REGISTRE = require('../engine/moteurs.json');
const REFERENTIEL = require('../data/referentiel.json');
const MOTEUR = { version: 'v1', sha256: REGISTRE[0].sha256 };
const MODELE = 'claude-sonnet-5-5'; // modèle autorisé (sonde §20.8, exécution n8n 279792)
const copie = (o) => JSON.parse(JSON.stringify(o));
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' });
const CLES = S.chargerCles([{ cle_id: 'cle-test', fichier: 'cles/cle-test.pem', sha256_pem: crypto.createHash('sha256').update(PEM).digest('hex'), algorithme: 'RSA-SHA256-PKCS1v15', valide_du: '2026-01-01T00:00:00.000Z', valide_au: '2027-12-31T00:00:00.000Z', revoquee_le: null }], () => PEM);
const signer = (ch) => crypto.sign('sha256', Buffer.from(Canonique.octetsContrat(ch.schema, ch)), { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }).toString('base64');
const E = (c) => `sha256:${c.repeat(64)}`;
const HEX = 'cd'.repeat(32);

// Notion de maths (relecteur eric) pour la saisie locale ; notion de français pour la page.
const NOTION_MATHS = REFERENTIEL.notions.find((n) => n.relecteur === 'eric' && n.id === 'maths.grandeurs-mesures') || REFERENTIEL.notions.find((n) => n.relecteur === 'eric');
const NOTION_FR = REFERENTIEL.notions.find((n) => n.relecteur === 'justine');

function charge(source) {
  const locale = source === 'saisie_locale';
  const n = locale ? NOTION_MATHS : NOTION_FR;
  const slug = n.id.split('.')[1];
  const setId = `set_fonda_${slug}_nI_02`;
  return {
    schema: 'attestation-cloture/v2', set_id: setId, notion_id: n.id, palier: 'nI',
    coeur: { action: 'accepter', selection: ['it01', 'it02'], ecartees: ['it03'], empreinte_relue: E('5'), empreinte_publiee: E('7'), moteur: { ...MOTEUR } },
    sha256_instantane: HEX, code_confirmation: HEX.slice(0, 16),
    confirmation: { mode: locale ? 'auto' : 'reponse_message', par: n.relecteur, recue_par: 'eric', le: '2026-10-20T09:10:00.000Z' },
    fidelite_transmission: { atteste_par: 'eric', le: '2026-10-20T09:11:00.000Z' },
    relecteur_attribue: n.relecteur, relecteur_egal_cloturer: locale,
    provenances: locale ? [] : [{ execution_id: '10', workflow_id: 'wfConf', statut: 'success', demarree_le: '2026-10-19T17:00:00.000Z' }, { execution_id: '2', workflow_id: 'wfConf', statut: 'success', demarree_le: '2026-10-19T17:00:00.000Z' }],
    nb_fichiers_decision: locale ? 1 : 2, referentiel_version: E('4'), moteur: { ...MOTEUR },
    execution_cloture: locale ? null : { execution_id: '20', workflow_id: 'wfClot', statut: 'success', terminee_le: '2026-10-20T08:00:00.000Z' },
    source_decisions: source,
    generation: { execution_id: '501', workflow_id: 'wfGen', statut: 'success', demarree_le: '2026-10-18T07:00:00.000Z', terminee_le: '2026-10-18T07:01:00.000Z', modele: MODELE, empreinte_complete: E('6'), journal_commit: 'c0ffee'.padEnd(40, '0'), listing_debut_le: '2026-10-20T09:00:01.000Z', listing_fin_le: '2026-10-20T09:00:05.000Z' },
    fin_saisie_le: locale ? '2026-10-19T17:00:01.000Z' : null, revoque_le: locale ? null : '2026-10-20T07:59:00.000Z',
    levees: [], incidents_connus: [], cloture_le: '2026-10-20T09:12:00.000Z',
    badge: locale ? { forme: 'relue_par', nom_affiche: 'Éric Duchateau', id: 'eric' } : { forme: 'relue_et_validee', nom_affiche: 'Relectrice de test', id: n.relecteur },
    cle_id: 'cle-test',
  };
}
const entreeDe = (ch) => ({ set_id: ch.set_id, notion_id: ch.notion_id, palier: ch.palier, item_ids: [...ch.coeur.selection], empreinte: ch.coeur.empreinte_publiee, moteur: { ...MOTEUR }, relecteur: ch.badge });
const verifier = (ch, x = {}) => S.verifierAttestationSignee({ type: 'cloture-signee', charge: ch, signature: signer(ch) }, { entree: entreeDe(ch), registre: REGISTRE, referentiel: REFERENTIEL, cles: CLES, modelesAutorises: [MODELE], ...x });

describe('charge v2 : nominal par source', () => {
  for (const source of ['saisie_locale', 'page_relecture']) {
    test(`${source} : signée, vérifiée`, () => assert.deepEqual(verifier(charge(source)), []));
  }
  test('schéma de charge hors liste fermée -> refus ; octets du contrat désigné par charge.schema', () => {
    const ch = charge('saisie_locale');
    const sig = signer(ch);
    const avec = (schema) => S.verifierAttestationSignee({ type: 'cloture-signee', charge: { ...ch, schema }, signature: sig }, { entree: entreeDe(ch), registre: REGISTRE, referentiel: REFERENTIEL, cles: CLES, modelesAutorises: [MODELE] });
    assert.match(avec('attestation-cloture/v4').join(), /charge.schema/);
    assert.match(avec(undefined).join(), /charge.schema/);
    // Une charge v2 présentée comme v1 : octets v1 impossibles (champs inconnus).
    assert.match(avec('attestation-cloture/v1').join(), /charge :/);
    // Une charge v2 présentée comme v3 (intérim) : octets v3 impossibles (relecture_interim absent).
    assert.match(avec('attestation-cloture/v3').join(), /charge : canonique : relecture_interim : champ manquant/);
  });
  test('signature v2 altérée -> refus', () => {
    const ch = charge('saisie_locale');
    const env = { type: 'cloture-signee', charge: { ...ch, cloture_le: '2026-10-20T09:12:00.001Z' }, signature: signer(ch) };
    assert.match(S.verifierAttestationSignee(env, { entree: entreeDe(ch), registre: REGISTRE, referentiel: REFERENTIEL, cles: CLES, modelesAutorises: [MODELE] }).join(), /signature RSA/);
  });
});

describe('G5 (§20.8) : modèle épinglé (daté, ou sans date en génération ≥ 4.6), sans repli', () => {
  test('liste absente, vide, en double, alias pré-4.6 ou non Sonnet -> v2 non vérifiable', () => {
    for (const modelesAutorises of [undefined, [], ['claude-sonnet-4-5'], [MODELE, MODELE], ['gpt-5-20261001'], ['claude-haiku-5-5']]) {
      assert.match(verifier(charge('saisie_locale'), { modelesAutorises }).join(), /modèles autorisés absente, vide ou non épinglée/, JSON.stringify(modelesAutorises));
    }
  });
  test('modeleEpingle : daté (format inchangé) ou sans date majeure[-mineure] acceptés ; alias pré-4.6 (denylist), autres familles, chaînes quelconques refusés', () => {
    for (const m of ['claude-sonnet-5-5', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-10', 'claude-sonnet-4-10', 'claude-sonnet-12-34', 'claude-sonnet-6-0',
      'claude-sonnet-4-5-20250929', 'claude-sonnet-4-20250514', 'claude-sonnet-5-5-20261001']) assert.equal(S.modeleEpingle(m), true, m);
    for (const m of [...S.ALIAS_PRE_46, 'claude-haiku-5-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001',
      'claude-sonnet-5-05', 'claude-sonnet-05-5', 'claude-sonnet-05', 'claude-sonnet-0-5', 'claude-sonnet-5-5-5', 'claude-sonnet-5-5-latest', 'claude-sonnet-latest',
      'claude-sonnet-5-5 ', ' claude-sonnet-5-5', 'Claude-sonnet-5-5', 'claude-sonnet-', 'claude-sonnet', 'gpt-5', '', 'x', null, undefined, 55, ['claude-sonnet-5-5']]) {
      assert.equal(S.modeleEpingle(m), false, JSON.stringify(m));
    }
    assert.deepEqual([...S.ALIAS_PRE_46].sort(), ['claude-sonnet-3-5', 'claude-sonnet-3-7', 'claude-sonnet-4', 'claude-sonnet-4-0', 'claude-sonnet-4-1', 'claude-sonnet-4-5']);
  });
  test('charge v2 avec claude-sonnet-5-5 (sans date) dans la liste -> vérifiée', () => {
    const ch = charge('saisie_locale'); ch.generation.modele = 'claude-sonnet-5-5';
    assert.deepEqual(verifier(ch, { modelesAutorises: ['claude-sonnet-5-5'] }), []);
  });
  test('modèle de la charge hors liste -> refus', () => {
    const ch = charge('saisie_locale'); ch.generation.modele = 'claude-sonnet-5-5-20260101';
    assert.match(verifier(ch).join(), /∉ modèles autorisés/);
  });
  test('lireModelesAutorises : forme stricte, identifiants Sonnet épinglés seulement', () => {
    assert.deepEqual(S.lireModelesAutorises(JSON.stringify({ schema: 'modeles-autorises/v1', generation_fonda: [MODELE] })), [MODELE]);
    assert.deepEqual(S.lireModelesAutorises(JSON.stringify({ schema: 'modeles-autorises/v1', generation_fonda: [] })), []);
    assert.deepEqual(S.lireModelesAutorises(JSON.stringify({ schema: 'modeles-autorises/v1', generation_fonda: ['claude-sonnet-5-5'] })), ['claude-sonnet-5-5']);
    for (const t of ['{', '{"schema":"modeles-autorises/v1"}', '{"schema":"x","generation_fonda":[]}', '{"schema":"modeles-autorises/v1","generation_fonda":["claude-sonnet-4-5"]}', '{"schema":"modeles-autorises/v1","generation_fonda":["claude-haiku-5-5"]}', '{"schema":"modeles-autorises/v1","generation_fonda":["n importe quoi"]}', '{"schema":"modeles-autorises/v1","generation_fonda":[],"note":"x"}']) {
      assert.throws(() => S.lireModelesAutorises(t), /modeles-autorises\.json/, t);
    }
  });
});

describe('invariants COMMUNS (toute source)', () => {
  const cas = [
    ['generation.statut ≠ success', (c) => { c.generation.statut = 'error'; }, /generation.statut/],
    ['generation : identifiant vide', (c) => { c.generation.execution_id = ' '; }, /generation : identifiants vides/],
    ['empreinte_complete mal formée', (c) => { c.generation.empreinte_complete = 'sha256:abc'; }, /empreinte_complete/],
    ['journal_commit mal formé', (c) => { c.generation.journal_commit = 'abc'; }, /journal_commit/],
    ['referentiel_version mal formée', (c) => { c.referentiel_version = 'v4'; }, /referentiel_version/],
    ['date de génération non signée', (c) => { c.generation.demarree_le = '2026-10-18T07:00:00Z'; }, /generation.demarree_le : date ISO/],
    ['chronologie : terminee_le < demarree_le', (c) => { c.generation.terminee_le = '2026-10-18T06:59:59.000Z'; }, /chronologie commune/],
    ['chronologie : listing commencé avant la fin de la génération', (c) => { c.generation.listing_debut_le = '2026-10-18T07:00:30.000Z'; }, /chronologie/],
    ['chronologie : listing_fin_le < listing_debut_le', (c) => { c.generation.listing_fin_le = '2026-10-20T09:00:00.000Z'; }, /chronologie commune/],
    ['chronologie : confirmation avant la fin du listing', (c) => { c.confirmation.le = '2026-10-20T09:00:02.000Z'; }, /chronologie commune/],
    ['chronologie : clôture avant la fidélité', (c) => { c.cloture_le = '2026-10-20T09:10:30.000Z'; }, /chronologie commune/],
    ['code de confirmation faux', (c) => { c.code_confirmation = '0'.repeat(16); }, /code_confirmation/],
    ['coeur.action ≠ accepter', (c) => { c.coeur.action = 'rejeter'; }, /coeur.action/],
    ['incident non résolu', (c) => { c.incidents_connus = [{ id: 'i', nature: 'x', detecte_le: '2026-10-01T00:00:00.000Z', statut: 'ouvert', resolu_le: null, preuve_resolution: null, periode: { debut: null, fin: null } }]; }, /non résolu/],
    ['levée inconnue', (c) => { c.levees = [{ type: 'autre', constat: 'x' }]; }, /type inconnu/],
    ['nb_fichiers_decision < 1', (c) => { c.nb_fichiers_decision = 0; }, /nb_fichiers_decision/],
  ];
  for (const source of ['saisie_locale', 'page_relecture']) {
    for (const [libelle, f, motif] of cas) {
      test(`${source} : ${libelle}`, () => { const c = charge(source); f(c); assert.match(verifier(c).join(' | '), motif); });
    }
  }
  test('source_decisions hors énumération', () => { const c = charge('page_relecture'); c.source_decisions = 'n8n'; assert.match(verifier(c).join(), /source_decisions hors énumération/); });
});

describe('invariants PAR SOURCE', () => {
  const page = [
    ['provenances vides', (c) => { c.provenances = []; }, /provenances vides/],
    ['provenance non success', (c) => { c.provenances[0].statut = 'error'; }, /provenances\[0\].statut/],
    ['provenances hors ordre', (c) => { c.provenances.reverse(); }, /ordre/],
    ['execution_cloture null (jamais déréférencée sans erreur)', (c) => { c.execution_cloture = null; }, /execution_cloture requise/],
    ['execution_cloture non success', (c) => { c.execution_cloture.statut = 'error'; }, /execution_cloture.statut/],
    ['revoque_le null', (c) => { c.revoque_le = null; }, /revoque_le requis/],
    ['fin_saisie_le renseignée', (c) => { c.fin_saisie_le = '2026-10-19T17:00:01.000Z'; }, /fin_saisie_le doit être null/],
    ['chronologie page : revoque_le > execution_cloture.terminee_le', (c) => { c.revoque_le = '2026-10-20T08:00:01.000Z'; }, /chronologie page/],
    ['chronologie page : clôture technique après le début du listing', (c) => { c.execution_cloture.terminee_le = '2026-10-20T09:00:02.000Z'; }, /chronologie page/],
    ['chronologie page : revoque_le avant la fin de la génération', (c) => { c.revoque_le = '2026-10-18T07:00:30.000Z'; }, /chronologie page/],
  ];
  for (const [libelle, f, motif] of page) test(`page_relecture : ${libelle}`, () => { const c = charge('page_relecture'); f(c); assert.match(verifier(c).join(' | '), motif); });
  const locale = [
    ['provenances non vides', (c) => { c.provenances = [{ execution_id: '10', workflow_id: 'w', statut: 'success', demarree_le: '2026-10-19T17:00:00.000Z' }]; }, /provenances doit être vide/],
    ['execution_cloture non nulle', (c) => { c.execution_cloture = { execution_id: '20', workflow_id: 'w', statut: 'success', terminee_le: '2026-10-20T08:00:00.000Z' }; }, /execution_cloture doit être null/],
    ['revoque_le non nul', (c) => { c.revoque_le = '2026-10-20T07:59:00.000Z'; }, /revoque_le doit être null/],
    ['fin_saisie_le nulle', (c) => { c.fin_saisie_le = null; }, /fin_saisie_le requise/],
    ['nb_fichiers_decision = 2', (c) => { c.nb_fichiers_decision = 2; }, /nb_fichiers_decision = 1/],
    ['relecteur ≠ eric', (c) => { c.relecteur_attribue = 'justine'; c.confirmation.par = 'justine'; }, /relecteur_attribue = "eric"/],
    ['mode ≠ auto', (c) => { c.confirmation.mode = 'vive_voix'; }, /confirmation.mode = "auto"/],
    ['relecteur_egal_cloturer false', (c) => { c.relecteur_egal_cloturer = false; }, /relecteur_egal_cloturer/],
    ['chronologie locale : saisie avant la fin de la génération', (c) => { c.fin_saisie_le = '2026-10-18T07:00:30.000Z'; }, /chronologie saisie locale/],
    ['chronologie locale : saisie après le début du listing', (c) => { c.fin_saisie_le = '2026-10-20T09:00:02.000Z'; }, /chronologie saisie locale/],
  ];
  for (const [libelle, f, motif] of locale) test(`saisie_locale : ${libelle}`, () => { const c = charge('saisie_locale'); f(c); assert.match(verifier(c).join(' | '), motif); });
});

describe('v1 inchangée', () => {
  test('invariantsValeur aiguille v1 vers les invariants v1 (sans liste de modèles)', () => {
    const v = require('../engine/canonique-vecteurs.json').vecteurs.find((x) => x.id === 'attestation-auto-nominale').entree;
    // Mêmes erreurs qu'avant la v2 : la forme v1 n'exige ni génération ni modèle.
    assert.ok(!S.invariantsValeur(v).some((e) => /modèle|generation|source_decisions/.test(e)));
  });
});
