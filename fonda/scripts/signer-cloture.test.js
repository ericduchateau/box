// Tests de fonda/scripts/signer-cloture.js — clôture signée locale, charge
// attestation-cloture/v2 (CDC v8.3 §20 ; §3, §5, §9-§11 v8.2).
// Clés RSA 3072 ÉPHÉMÈRES, réponses n8n et Drive SYNTHÉTIQUES (fixture
// fixtures/execution-generation.json) ; le rattachement exécution <-> lot est « de test »
// (le vrai contrat appartient au chantier des workflows ; sans lui, refus — garde).
// Usage : node --test fonda/scripts/signer-cloture.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const fsN = require('fs');
const C = require('../engine/catalogue.js');
const S = require('./attestation-signee.js');
const L = require('./liaison-generation.js');
const { cloturer, saisirDecisionLocale, normaliserDate, RATTACHEMENT_SAISIE_LOCALE, analyserArgumentsCloture, main: mainCloture } = require('./signer-cloture.js');
const { preparerPublication } = require('./publier-lot.js');

const REGISTRE = require('../engine/moteurs.json');
const MOTEUR = { version: 'v1', sha256: REGISTRE[0].sha256 };
const OCTETS_REF = fsN.readFileSync(path.join(__dirname, '../data/referentiel.json'));
const REF_VERSION = `sha256:${crypto.createHash('sha256').update(OCTETS_REF).digest('hex')}`;
const REFERENTIEL = JSON.parse(OCTETS_REF.toString('utf8'));
const CATALOGUE = require('../data/catalogue-fonda.json');
const FIXTURE = require('./fixtures/execution-generation.json');
const MODELE = FIXTURE.modele; // claude-sonnet-5-5 : modèle autorisé (snapshot sans date ≥ 4.6 ; sonde §20.8, exécution n8n 279792)
const COMMIT = 'c0ffee'.padEnd(40, '0');
const copie = (o) => JSON.parse(JSON.stringify(o));
const sha = C.sha256WebCrypto();

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' });
const DECL = { cle_id: 'cle-test', fichier: 'cles/cle-test.pem', sha256_pem: crypto.createHash('sha256').update(PEM).digest('hex'), algorithme: 'RSA-SHA256-PKCS1v15', valide_du: '2026-01-01T00:00:00.000Z', valide_au: '2027-12-31T00:00:00.000Z', revoquee_le: null };
const CLES = S.chargerCles([DECL], () => PEM);

function lotSource(source, setId) {
  const l = copie(require(`../data/lots/${source}.json`));
  l.set_id = setId;
  l.revue_carte_par_carte = false;
  l.cartes.forEach((c) => { c.set_id = setId; });
  return l;
}
// Substitution des << >> de la fixture.
function instancier(gabarit, valeurs) {
  let t = JSON.stringify(gabarit);
  for (const [k, v] of Object.entries(valeurs)) t = t.split(`<<${k}>>`).join(v);
  return JSON.parse(t);
}

// Scénario complet ; x.source ∈ { page_relecture, saisie_locale } ; x.maths : lot d'Éric.
async function scenario(x = {}) {
  const source = x.source || 'page_relecture';
  const maths = x.maths || source === 'saisie_locale';
  const setId = maths ? 'set_fonda_grandeurs-mesures_nI_02' : 'set_fonda_comprendre-consigne_nI_02';
  const lot = lotSource(maths ? 'set_fonda_grandeurs-mesures_nI_01' : 'set_fonda_comprendre-consigne_nI_01', setId);
  const ref = `test-2026-10-17:${setId}`;
  const ids = lot.cartes.map((c) => c.item_id);
  const empreintes = { pedagogique: await C.calculerEmpreinte(lot, sha), complete: L.empreinteComplete(lot) };
  const garde = new Set(ids.slice(0, -1));
  const publie = { ...lot, revue_carte_par_carte: true, cartes: lot.cartes.filter((c) => garde.has(c.item_id)) };
  publie.nb_cartes = publie.cartes.length;
  const coeur = { action: 'accepter', selection: ids.slice(0, -1), ecartees: ids.slice(-1), empreinte_relue: empreintes.pedagogique, empreinte_publiee: await C.calculerEmpreinte(publie, sha), moteur: { ...MOTEUR } };
  const lotRelu = { set_id: setId, empreinte_complete: empreintes.complete, cartes: ids.map((id) => ({ item_id: id, choix: garde.has(id) ? 'garder' : 'ecarter' })) };
  const valeurs = { SET_ID: setId, REF: ref, NOTION_ID: lot.notion_id, PALIER: lot.palier, MOTEUR_SHA256: MOTEUR.sha256, REFERENTIEL_VERSION: REF_VERSION, JOURNAL_COMMIT: COMMIT, EMPREINTE_PEDAGOGIQUE: empreintes.pedagogique, EMPREINTE_COMPLETE: empreintes.complete };
  const fx = instancier(FIXTURE, valeurs);
  const gen = { 501: fx.reussie };
  const candidats = [{ id: 'drv-lot', nom: `${setId}.lot.json`, modifie_le: '2026-10-18T07:00:30.000Z', properties: { fonda_set_id: setId, fonda_execution_id: '501' }, proprietesLisibles: true }];
  const lotGenere = { id: 'drv-lot', nom: `${setId}.lot.json`, modifie_le: '2026-10-18T07:00:30.000Z', octets: Buffer.from(`${JSON.stringify(lot, null, 2)}\n`) };
  const relecteur = maths ? 'eric' : 'justine';
  const candidat = { schema: 'candidat-fonda/v1', lot: copie(lot), relecture: { statut: 'clos', generation_cle: 1, cle_sha256: 'a'.repeat(64), cree_le: '2026-10-18T08:00:00.000Z', expire_le: '2026-11-01T08:00:00.000Z', clos_le: '2026-10-20T07:59:00.000Z', relecteur_attribue: relecteur, referentiel_version: REF_VERSION, moteur: { ...MOTEUR }, envois: [] } };
  const decision = (nonce) => ({ schema: 'decision-fonda/v1', set_id: setId, generation: 1, nonce, recu_le: '2026-10-19T17:00:01.000Z', coeur: copie(coeur), lot_relu: copie(lotRelu), hash_formulaire: 'h' });
  const decisionLocale = { schema: 'decision-fonda/v1', set_id: setId, generation: 0, nonce: 'f3a9c0d1e2b4a5c6', recu_le: '2026-10-19T17:00:01.000Z', coeur: copie(coeur), lot_relu: copie(lotRelu), hash_formulaire: 'saisie-locale' };
  const execs = {
    wfGen: [{ id: 501, workflowId: 'wfGen', status: 'success', startedAt: '2026-10-18T07:00:00.000Z', stoppedAt: '2026-10-18T07:01:00.000Z' }],
    wfConf: [
      { id: 10, workflowId: 'wfConf', status: 'success', startedAt: '2026-10-19T17:00:00.000Z', stoppedAt: '2026-10-19T17:00:02.000Z' },
      { id: 2, workflowId: 'wfConf', status: 'success', startedAt: '2026-10-19T17:00:00.000Z', stoppedAt: '2026-10-19T17:00:03.000Z' },
      { id: 30, workflowId: 'wfConf', status: 'success', startedAt: '2026-10-19T16:00:00.000Z', stoppedAt: '2026-10-19T16:00:01.000Z' }, // autre lot
    ],
    wfClot: [{ id: 20, workflowId: 'wfClot', status: 'success', startedAt: '2026-10-20T07:58:00.000Z', stoppedAt: '2026-10-20T08:00:00.000Z' }],
  };
  const rattachements = { 10: { set_id: setId, type: 'decision', nonce: 'n10' }, 2: { set_id: setId, type: 'decision', nonce: 'n2' }, 30: { set_id: 'set_fonda_lexique_nI_02', type: 'decision', nonce: 'nx' }, 20: { set_id: setId, type: 'cloture', nonce: null } };
  const fichiers = [
    { nom: `${setId}-n10.json`, modifie_le: '2026-10-19T17:00:01.500Z', contenu: decision('n10') },
    { nom: `${setId}-n2.json`, modifie_le: '2026-10-19T17:00:02.500Z', contenu: decision('n2') },
  ];
  const locales = [{ nom: 'decision.json', octets: Buffer.from(`${JSON.stringify(decisionLocale, null, 2)}\n`) }];
  const journal = { schema: 'set-ids-journal/v1', lignes: [{ set_id: setId, transition: 'reserve', le: '2026-10-17', ref }] };
  const etat = { signatures: 0, ecrits: new Map(), affiche: '', heure: Date.parse('2026-10-20T09:00:00.000Z'), appels: [] };
  const deps = {
    rattachement: (e) => rattachements[e.id] || null,
    api: {
      async listerExecutions({ workflowId, status }) { etat.appels.push(`lister:${workflowId}:${status || '*'}`); const t = execs[workflowId] || []; return copie(status ? t.filter((e) => e.status === status) : t.filter((e) => !['running', 'waiting'].includes(e.status))); },
      async lireExecution(id) { etat.appels.push(`lire:${id}`); return gen[id] ? copie(gen[id]) : null; },
    },
    config: { source, workflowGeneration: 'wfGen', workflowConfirmation: 'wfConf', workflowCloture: 'wfClot', dossier: '/tmp/fonda-cloture-test', cleId: 'cle-test', modelesAutorises: [MODELE] },
    drive: {
      lireLotGenere: async () => { etat.appels.push('lot'); return lotGenere ? { ...lotGenere, octets: Buffer.from(lotGenere.octets) } : null; },
      listerCandidats: async () => { etat.appels.push('candidats'); return { incompleteSearch: false, fichiers: copie(candidats) }; },
      lireCandidat: async () => copie(candidat),
      listerDecisions: async () => ({ incompleteSearch: false, fichiers: copie(fichiers) }),
    },
    journal: async (c) => (c === COMMIT ? { surPremierParent: true, journal: copie(journal) } : { surPremierParent: false, journal: null }),
    decisionsLocales: async () => locales.map((f) => ({ nom: f.nom, octets: Buffer.from(f.octets) })),
    incidents: async () => [],
    referentielArchive: async (v) => { if (v !== REF_VERSION) throw new Error('introuvable'); return OCTETS_REF; },
    tableRelecteurs: { justine: 'Relectrice de test' },
    fs: {
      ecrireExclusif(p, t) { if (etat.ecrits.has(p)) throw new Error('existe déjà'); etat.ecrits.set(p, Buffer.from(t, 'utf8')); },
      lire(p) { if (!etat.ecrits.has(p)) throw new Error('absent'); return etat.ecrits.get(p); },
      existe(p) { return etat.ecrits.has(p); },
      lister(d) { const n = new Set(); for (const p of etat.ecrits.keys()) if (p.startsWith(`${d}/`)) n.add(p.slice(d.length + 1).split('/')[0]); return [...n]; },
    },
    signer: (octets) => { etat.signatures += 1; return crypto.sign('sha256', octets, { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }); },
    cles: CLES, registre: REGISTRE,
    horloge: () => { etat.heure += 1000; etat.appels.push('horloge'); return new Date(etat.heure); },
    afficher: (t) => { etat.affiche += t; },
    saisir: async (q) => {
      if (/Mode/.test(q)) return x.mode || 'reponse_message';
      if (/Code/.test(q)) return x.code || /CODE DE CONFIRMATION : ([0-9a-f]{16})/.exec(etat.affiche)[1];
      return x.fidelite || 'oui';
    },
    levees: [],
  };
  const ctx = { deps, execs, gen, fx, candidats, rattachements, fichiers, locales, journal, candidat, coeur, lotRelu, lot, empreintes, decision, decisionLocale, etat,
    setLotGenere: (v) => { Object.assign(lotGenere, v); }, valeurs };
  if (x.modifier) await x.modifier(ctx);
  return { ...ctx, setId, publie };
}

// Publication (§20.11, §20.12) : journal de HEAD + réservation ; référentiel ARCHIVÉ.
const JOURNAL = require('../data/set_ids-journal.json');
async function publication(publie, enveloppe, modelesAutorises = [MODELE]) {
  const journal = { schema: JOURNAL.schema, lignes: [...copie(JOURNAL.lignes), { set_id: publie.set_id, transition: 'reserve', le: '2026-10-17', ref: `test-2026-10-17:${publie.set_id}` }] };
  const referentielArchive = async (v) => (v === enveloppe.charge.referentiel_version && v === REF_VERSION ? { ok: true, referentiel: REFERENTIEL } : { ok: false, raison: 'introuvable' });
  return preparerPublication({ lot: publie, attestation: enveloppe, catalogue: copie(CATALOGUE), referentiel: REFERENTIEL, referentielArchive, journal, le: '2026-10-21T09:00:00.000Z', sha256Hex: sha, cles: CLES, modelesAutorises });
}
const sansSignature = async (sc, motif, issue) => {
  const err = await cloturer(sc.setId, sc.deps).then(() => null, (e) => e);
  assert.ok(err, 'refus attendu');
  assert.match(err.message, motif);
  if (issue) assert.equal(err.issue, issue, err.message);
  assert.equal(sc.etat.signatures, 0, 'aucune signature');
  assert.ok(![...sc.etat.ecrits.keys()].some((p) => p.endsWith('attestation.json')), 'aucune attestation écrite');
  return err;
};

describe('garde maîtresse (lot 7 : levée pour saisie_locale SEULE)', () => {
  test('cloturer sans fonction de rattachement : refus AVANT toute opération, zéro signature, zéro appel (garde INCHANGÉE)', async () => {
    for (const source of ['page_relecture', 'saisie_locale']) {
      const sc = await scenario({ source });
      delete sc.deps.rattachement;
      await assert.rejects(cloturer(sc.setId, sc.deps), (e) => /rattachement.*NON DÉFINI/.test(e.message) && e.issue === 'precondition');
      assert.equal(sc.etat.signatures, 0);
      assert.deepEqual(sc.etat.appels, []);
    }
  });
  test('saisie_locale avec le rattachement « poison » de production : clôture COMPLÈTE (il n\'est jamais appelé)', async () => {
    const sc = await scenario({ source: 'saisie_locale' });
    let appele = 0;
    sc.deps.rattachement = (...a) => { appele += 1; return RATTACHEMENT_SAISIE_LOCALE(...a); };
    const { enveloppe } = await cloturer(sc.setId, sc.deps);
    assert.equal(enveloppe.charge.source_decisions, 'saisie_locale');
    assert.equal(sc.etat.signatures, 1);
    assert.equal(appele, 0, 'jamais consommé en saisie locale');
    assert.equal((await publication(sc.publie, enveloppe)).ok, true);
  });
  test('page_relecture avec le rattachement « poison » : refus precondition, ZÉRO signature', async () => {
    const sc = await scenario();
    sc.deps.rattachement = RATTACHEMENT_SAISIE_LOCALE;
    const err = await sansSignature(sc, /parcours page_relecture non défini/, 'precondition');
    assert.ok(err);
  });
  test('analyserArgumentsCloture : saisie_locale par défaut ; toute autre source, set_id invalide ou arguments en trop -> refus precondition', () => {
    assert.deepEqual(analyserArgumentsCloture(['set_fonda_grandeurs-mesures_nI_02']), { setId: 'set_fonda_grandeurs-mesures_nI_02', source: 'saisie_locale' });
    assert.deepEqual(analyserArgumentsCloture(['set_fonda_grandeurs-mesures_nI_02', '--source', 'saisie_locale']).source, 'saisie_locale');
    for (const argv of [['set_fonda_grandeurs-mesures_nI_02', '--source', 'page_relecture'], ['set_fonda_grandeurs-mesures_nI_02', '--source'], ['set_fonda_grandeurs-mesures_nI_02', '--source', 'n8n'],
      ['pas-un-set-id'], [], ['set_fonda_grandeurs-mesures_nI_02', 'en-trop']]) {
      assert.throws(() => analyserArgumentsCloture(argv), (e) => e.issue === 'precondition', JSON.stringify(argv));
    }
  });
  test('main : page_relecture refusée AVANT la production (ni réseau, ni secret, ni clé) ; saisie_locale -> production appelée', async () => {
    const appels = [];
    const production = async (setId) => { appels.push(setId); return { dossierLot: '/tmp/x' }; };
    const avant = process.exitCode; const err = console.error; const log = console.log; let sortie = '';
    console.error = (m) => { sortie += m; }; console.log = () => {};
    try {
      await mainCloture(['set_fonda_grandeurs-mesures_nI_02', '--source', 'page_relecture'], production);
      assert.equal(process.exitCode, 1);
      assert.deepEqual(appels, []);
      assert.match(sortie, /seule « saisie_locale » est levée/);
      process.exitCode = avant;
      await mainCloture(['set_fonda_grandeurs-mesures_nI_02'], production);
      assert.deepEqual(appels, ['set_fonda_grandeurs-mesures_nI_02']);
    } finally { console.error = err; console.log = log; process.exitCode = avant; }
  });
  test('CLI réelle : page_relecture refusée sans lire aucun secret ; saisie_locale sans secrets -> échec à la lecture du secret, AVANT toute phrase de passe', () => {
    const vide = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'home-vide-'));
    const cli = (...a) => require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'signer-cloture.js'), ...a], { encoding: 'utf8', env: { ...process.env, HOME: vide }, input: '' });
    const page = cli('set_fonda_grandeurs-mesures_nI_02', '--source', 'page_relecture');
    assert.equal(page.status, 1);
    assert.match(page.stderr, /source « page_relecture » refusée/);
    const locale = cli('set_fonda_grandeurs-mesures_nI_02');
    assert.equal(locale.status, 1);
    assert.match(locale.stderr, /secret n8n-signataire\.cle illisible/);
    assert.doesNotMatch(locale.stdout + locale.stderr, /Phrase de passe/);
    assert.deepEqual(require('fs').readdirSync(vide), [], 'rien écrit dans le HOME');
  });
});

describe('aller-retour v2 : signer -> attestation-signee vérifie -> publier-lot publie', () => {
  test('page_relecture, tiers (réponse au message) : charge v2 signée, vérifiée, publiable', async () => {
    const sc = await scenario();
    const { enveloppe } = await cloturer(sc.setId, sc.deps);
    const ch = enveloppe.charge;
    assert.equal(sc.etat.signatures, 1);
    assert.equal(ch.schema, 'attestation-cloture/v2');
    assert.equal(ch.source_decisions, 'page_relecture');
    assert.deepEqual(ch.provenances.map((p) => p.execution_id), ['10', '2']);
    assert.equal(ch.execution_cloture.execution_id, '20');
    assert.equal(ch.revoque_le, '2026-10-20T07:59:00.000Z');
    assert.equal(ch.fin_saisie_le, null);
    assert.equal(ch.generation.execution_id, '501');
    assert.equal(ch.generation.modele, MODELE);
    assert.equal(ch.generation.empreinte_complete, sc.empreintes.complete);
    assert.equal(ch.generation.journal_commit, COMMIT);
    assert.ok(ch.generation.listing_debut_le < ch.generation.listing_fin_le);
    assert.ok(ch.generation.listing_fin_le <= ch.confirmation.le);
    assert.deepEqual(ch.badge, { forme: 'relue_et_validee', nom_affiche: 'Relectrice de test', id: 'justine' });
    const r = await publication(sc.publie, enveloppe);
    assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  });
  // Le parcours nominal utilise désormais claude-sonnet-5-5 (sans date) ; ce scénario garde
  // la forme DATÉE (format historique, toujours recevable) couverte de bout en bout.
  test('modèle DATÉ (format historique) autorisé : clôture complète, modèle gravé, signature vérifiée, publiable', async () => {
    const DATE = 'claude-sonnet-5-5-20261001';
    const sc = await scenario({ source: 'saisie_locale', modifier: (c) => {
      c.gen[501] = JSON.parse(JSON.stringify(c.gen[501]).split(`"${MODELE}"`).join(`"${DATE}"`));
      c.deps.config.modelesAutorises = [DATE];
    } });
    const { enveloppe } = await cloturer(sc.setId, sc.deps);
    assert.equal(sc.etat.signatures, 1);
    assert.equal(enveloppe.charge.generation.modele, DATE);
    const pub = await publication(sc.publie, enveloppe, [DATE]); // signature + invariants + liste (verifierAttestationSignee complet)
    assert.equal(pub.ok, true, JSON.stringify(pub.erreurs));
    assert.equal((await publication(sc.publie, enveloppe, [MODELE])).ok, false, 'hors liste -> non publiable');
  });
  test('page_relecture, auto-confirmation (relecteur = Éric) : publiable', async () => {
    const sc = await scenario({ maths: true });
    const { enveloppe } = await cloturer(sc.setId, sc.deps);
    assert.equal(enveloppe.charge.confirmation.mode, 'auto');
    assert.equal((await publication(sc.publie, enveloppe)).ok, true);
  });
  test('saisie_locale : provenances [], execution_cloture null, revoque_le null, fin_saisie_le = recu_le, relecteur_egal_cloturer true', async () => {
    const sc = await scenario({ source: 'saisie_locale' });
    const { enveloppe } = await cloturer(sc.setId, sc.deps);
    const ch = enveloppe.charge;
    assert.equal(ch.source_decisions, 'saisie_locale');
    assert.deepEqual(ch.provenances, []);
    assert.equal(ch.execution_cloture, null);
    assert.equal(ch.revoque_le, null);
    assert.equal(ch.fin_saisie_le, sc.decisionLocale.recu_le);
    assert.equal(ch.relecteur_egal_cloturer, true);
    assert.equal(ch.confirmation.mode, 'auto');
    assert.equal(ch.nb_fichiers_decision, 1);
    assert.deepEqual(enveloppe.charge.coeur, sc.coeur);
    const r = await publication(sc.publie, enveloppe);
    assert.equal(r.ok, true, JSON.stringify(r.erreurs));
    // L'instantané contient le lot SOURCE et le lot_relu.
    const inst = JSON.parse([...sc.etat.ecrits.entries()].find(([p]) => p.endsWith('instantane.json'))[1].toString('utf8'));
    assert.deepEqual(inst.candidat_lot, sc.lot);
    assert.deepEqual(inst.lot_relu, sc.lotRelu);
  });
  test('listing en INTERVALLE : lot lu AVANT listing_debut et APRÈS listing_fin ; toutes les sources entre les deux', async () => {
    const sc = await scenario({ source: 'saisie_locale' });
    await cloturer(sc.setId, sc.deps);
    const a = sc.etat.appels;
    const iDebut = a.indexOf('horloge');
    const iFin = a.indexOf('horloge', iDebut + 1);
    assert.equal(a[iDebut - 1], 'lot', 'lot lu juste avant le début du listing');
    assert.equal(a[iFin + 1], 'lot', 'lot relu juste après la fin du listing');
    for (const app of ['lister:wfGen:running', 'lister:wfGen:waiting', 'lister:wfGen:*', 'lire:501', 'candidats']) {
      const i = a.indexOf(app);
      assert.ok(i > iDebut && i < iFin, `${app} dans l'intervalle`);
    }
  });
  test('évolution normale : génération vue « running » au listing puis « success » au détail -> fusionnée, signée (§11 bis)', async () => {
    const sc = await scenario({ source: 'saisie_locale' });
    const base = sc.deps.api.listerExecutions;
    sc.deps.api.listerExecutions = async (q) => (q.workflowId === 'wfGen' && q.status === 'running' ? [{ id: 501, workflowId: 'wfGen', status: 'running', startedAt: '2026-10-18T07:00:00.000Z', stoppedAt: null }]
      : q.workflowId === 'wfGen' && !q.status ? [] : base(q));
    const { enveloppe } = await cloturer(sc.setId, sc.deps);
    assert.equal(enveloppe.charge.generation.statut, 'success');
    assert.equal(enveloppe.charge.generation.terminee_le, '2026-10-18T07:01:00.000Z');
  });
  test('panne d\'UN détail : la contradiction d\'un autre détail reste un incident (dépendances par exécution)', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ execs, gen, fx }) => {
      execs.wfGen.push({ id: 498, workflowId: 'wfGen', status: 'error', startedAt: fx.erreur_sans_depot.startedAt, stoppedAt: fx.erreur_sans_depot.stoppedAt });
      gen[498] = fx.erreur_sans_depot; gen[501].status = 'error';
    } });
    const lire = sc.deps.api.lireExecution;
    sc.deps.api.lireExecution = async (id) => { if (id === '498') throw new Error('timeout'); return lire(id); };
    await sansSignature(sc, /statuts terminaux différents/, 'incident');
  });
  test('journal illisible : les autres lignes de la table restent évaluées (modèle interdit -> abandon)', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ gen, deps }) => {
      gen[501].data.resultData.runData['FONDA Sortie generation'][0].data.main[0][0].json.modele = 'claude-sonnet-4-6'; // hors liste autorisée
      deps.journal = async () => { throw new Error('git indisponible'); };
    } });
    await sansSignature(sc, /∉ liste autorisée/, 'abandon');
  });
  test('journal illisible SEUL : refus TEMPORAIRE (jamais un abandon déduit d\'une donnée manquante)', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ deps }) => { deps.journal = async () => { throw new Error('git indisponible'); }; } });
    const err = await sansSignature(sc, /journal.*injoignable/, 'temporaire');
    assert.doesNotMatch(err.message, /\[abandon\]/);
  });
  test('Drive candidats/ illisible : la table reste évaluée (modèle interdit -> abandon)', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ gen, deps }) => {
      gen[501].data.resultData.runData['FONDA Sortie generation'][0].data.main[0][0].json.modele = 'claude-sonnet-4-6'; // hors liste autorisée
      deps.drive.listerCandidats = async () => { throw new Error('Drive 503'); };
    } });
    await sansSignature(sc, /∉ liste autorisée/, 'abandon');
  });
  test('clé absente ET code faux : refus TEMPORAIRE avant toute confirmation', async () => {
    const sc = await scenario({ source: 'saisie_locale', code: '0'.repeat(16), modifier: ({ deps }) => { deps.config.cleId = 'cle-inconnue'; } });
    await sansSignature(sc, /non déclarée/, 'temporaire');
    assert.ok(![...sc.etat.ecrits.keys()].some((p) => p.endsWith('instantane.json')), 'aucun instantané écrit');
  });
  test('instantané altéré ET code faux : §3.4 détecté AVANT la demande du code', async () => {
    const sc = await scenario({ source: 'saisie_locale', code: '0'.repeat(16), modifier: ({ deps }) => { const l = deps.fs.lire; deps.fs.lire = (p) => (p.endsWith('instantane.json') ? Buffer.concat([l(p), Buffer.from(' ')]) : l(p)); } });
    await sansSignature(sc, /§3.4 \(a\)/);
  });
  test('clôture ANTÉRIEURE de ce set_id sur d\'autres données (décision modifiée après un code faux) -> abandon, jamais un second instantané', async () => {
    const sc = await scenario({ source: 'saisie_locale', code: '0'.repeat(16) });
    await assert.rejects(cloturer(sc.setId, sc.deps), /code de confirmation/);
    // Nouvelle décision (autres choix) : l'instantané changerait de code.
    const d = copie(sc.decisionLocale);
    d.lot_relu.cartes[0].choix = 'ecarter'; d.coeur.selection = d.coeur.selection.slice(1); d.coeur.ecartees = [d.lot_relu.cartes[0].item_id, ...d.coeur.ecartees];
    d.coeur.empreinte_publiee = await C.calculerEmpreinte({ ...sc.lot, revue_carte_par_carte: true, nb_cartes: d.coeur.selection.length, cartes: sc.lot.cartes.filter((c) => d.coeur.selection.includes(c.item_id)) }, sha);
    sc.locales[0].octets = Buffer.from(JSON.stringify(d));
    sc.deps.saisir = async (q) => (/Code/.test(q) ? /CODE DE CONFIRMATION : ([0-9a-f]{16})/.exec(sc.etat.affiche).pop() : 'oui');
    const n = sc.etat.ecrits.size;
    await sansSignature(sc, /clôture antérieure .*AUTRES données/, 'abandon');
    assert.equal(sc.etat.ecrits.size, n, 'aucune écriture');
  });
  test('déjà signé pour ce set_id : relance refusée, jamais une seconde attestation', async () => {
    const sc = await scenario({ source: 'saisie_locale' });
    await cloturer(sc.setId, sc.deps);
    sc.etat.affiche = '';
    const err = await cloturer(sc.setId, sc.deps).then(() => null, (e) => e);
    assert.match(err.message, /signature déjà tentée/);
    assert.equal(sc.etat.signatures, 1);
  });
  // pinData « rien d'épinglé » (CDC v8.3 r7, §20.3) : absent, null (workflow créé par l'API n8n) ou {}.
  for (const [libelle, appliquer] of [
    ['absent', (w) => { delete w.pinData; }],
    ['null (API n8n)', (w) => { w.pinData = null; }],
    ['objet vide {}', (w) => { w.pinData = {}; }],
  ]) {
    test(`pinData ${libelle} : accepté, aucun constat pinData, signature`, async () => {
      const sc = await scenario({ modifier: ({ gen }) => appliquer(gen[501].workflowData) });
      const { enveloppe } = await cloturer(sc.setId, sc.deps);
      assert.equal(enveloppe.charge.generation.execution_id, '501');
      assert.ok(!/pinData/.test(sc.etat.affiche), 'aucun constat pinData');
    });
  }
  test('exécution en erreur SANS dépôt : tentative tolérée (fixture « erreur_sans_depot »)', async () => {
    const sc = await scenario({ modifier: ({ execs, gen, fx }) => { execs.wfGen.push({ id: 498, workflowId: 'wfGen', status: 'error', startedAt: fx.erreur_sans_depot.startedAt, stoppedAt: fx.erreur_sans_depot.stoppedAt }); gen[498] = fx.erreur_sans_depot; } });
    const { enveloppe } = await cloturer(sc.setId, sc.deps);
    assert.equal(enveloppe.charge.generation.execution_id, '501');
  });
});

describe('§20.2–20.3 liaison de génération : chaque violation -> refus classé, ZÉRO signature', () => {
  const autreExec = (fxCle, id, status) => ({ execs, gen, fx }) => { execs.wfGen.push({ id, workflowId: 'wfGen', status, startedAt: fx[fxCle].startedAt, stoppedAt: fx[fxCle].stoppedAt }); gen[id] = fx[fxCle]; };
  const sortie = (f) => ({ gen }) => { f(gen[501].data.resultData.runData['FONDA Sortie generation'][0].data.main[0][0].json); };
  const cas = [
    ['erreur APRÈS dépôt (fixture)', (ctx) => { autreExec('erreur_apres_depot', 499, 'error')(ctx); ctx.candidats.push(ctx.fx.erreur_apres_depot.fichier_depose); }, /erreur APRÈS dépôt/, 'abandon'],
    ['doublon : deux exécutions réussies (fixture)', autreExec('doublon', 502, 'success'), /2 exécution\(s\) de génération réussie/, 'abandon'],
    ['pinData non vide (fixture)', ({ gen, fx }) => { gen[501].workflowData.pinData = fx.pinData; }, /pinData ni absent, ni null, ni objet vide/, 'abandon'],
    ['pinData non vide { unNoeud: [...] }', ({ gen }) => { gen[501].workflowData.pinData = { unNoeud: [{ json: {} }] }; }, /pinData ni absent, ni null, ni objet vide/, 'abandon'],
    ['pinData tableau []', ({ gen }) => { gen[501].workflowData.pinData = []; }, /pinData ni absent, ni null, ni objet vide/, 'abandon'],
    ['pinData chaîne « x »', ({ gen }) => { gen[501].workflowData.pinData = 'x'; }, /pinData ni absent, ni null, ni objet vide/, 'abandon'],
    ['pinData nombre 1', ({ gen }) => { gen[501].workflowData.pinData = 1; }, /pinData ni absent, ni null, ni objet vide/, 'abandon'],
    ['pinData booléen true', ({ gen }) => { gen[501].workflowData.pinData = true; }, /pinData ni absent, ni null, ni objet vide/, 'abandon'],
    // Valeurs « falsy » : refusées aussi (garde contre une régression vers `!pin`).
    ['pinData chaîne vide', ({ gen }) => { gen[501].workflowData.pinData = ''; }, /pinData ni absent, ni null, ni objet vide/, 'abandon'],
    ['pinData nombre 0', ({ gen }) => { gen[501].workflowData.pinData = 0; }, /pinData ni absent, ni null, ni objet vide/, 'abandon'],
    ['pinData booléen false', ({ gen }) => { gen[501].workflowData.pinData = false; }, /pinData ni absent, ni null, ni objet vide/, 'abandon'],
    ['exécution de génération non terminée (running)', ({ execs, gen, fx }) => { execs.wfGen.push({ id: 503, workflowId: 'wfGen', status: 'running', startedAt: '2026-10-20T08:30:00.000Z', stoppedAt: null }); gen[503] = { ...fx.doublon, id: 503, status: 'running', startedAt: '2026-10-20T08:30:00.000Z', stoppedAt: null }; }, /non terminée/, 'incident'],
    ['item du déclencheur manquant', ({ execs, gen }) => { execs.wfGen.push({ id: 504, workflowId: 'wfGen', status: 'error', startedAt: '2026-10-18T06:00:00.000Z', stoppedAt: '2026-10-18T06:00:01.000Z' }); gen[504] = { id: 504, workflowId: 'wfGen', status: 'error', mode: 'webhook', startedAt: '2026-10-18T06:00:00.000Z', stoppedAt: '2026-10-18T06:00:01.000Z', data: { resultData: { runData: {} } }, workflowData: {} }; }, /item du déclencheur manquant/, 'incident'],
    ['exécution sans données (purgée)', ({ execs }) => { execs.wfGen.push({ id: 505, workflowId: 'wfGen', status: 'error', startedAt: '2026-10-18T06:00:00.000Z', stoppedAt: '2026-10-18T06:00:01.000Z' }); }, /item du déclencheur manquant/, 'incident'],
    ['workflowData absent (information indisponible)', ({ gen }) => { delete gen[501].workflowData; }, /workflowData absent/, 'refus'],
    ['fichier candidats/ sans properties', ({ candidats }) => { candidats.push({ id: 'drv-x', nom: 'autre.lot.json', modifie_le: '2026-10-18T07:00:00.000Z', properties: null, proprietesLisibles: true }); }, /properties absentes/, 'abandon'],
    ['properties illisibles', ({ candidats }) => { candidats[0].proprietesLisibles = false; }, /properties absentes ou illisibles/, 'abandon'],
    ['fichier mal nommé portant ce set_id', ({ candidats, setIdCourant }) => { void setIdCourant; candidats[0].nom = 'mauvais-nom.lot.json'; }, /nom et fonda_set_id discordants/, 'abandon'],
    ['fichier rattaché à une autre exécution', ({ candidats }) => { candidats[0].properties.fonda_execution_id = '777'; }, /≠ exécution retenue/, 'abandon'],
    ['aucun fichier candidat', ({ candidats }) => { candidats.length = 0; }, /0 fichier\(s\) candidat/, 'abandon'],
    ['set_id de la sortie ≠ demandé', sortie((s) => { s.set_id = 'set_fonda_lexique_nI_02'; }), /set_id/, 'abandon'],
    ['ref de la sortie ≠ déclencheur', sortie((s) => { s.ref = 'autre-ref-1234'; }), /ref/, 'abandon'],
    ['journal_commit hors premier parent de design', sortie((s) => { s.journal_commit = 'f'.repeat(40); }), /hors de la chaîne du premier parent/, 'abandon'],
    ['réservation absente du journal au commit', ({ journal }) => { journal.lignes[0].ref = 'autre-ref-1234'; }, /réservation de ce set_id avec cette ref/, 'abandon'],
    ['set_id déjà publié au commit consigné', ({ journal, valeurs }) => { journal.lignes.push({ set_id: valeurs.SET_ID, transition: 'publie', le: '2026-10-17', ref: `${valeurs.REF}:publie` }); }, /état « reserve »/, 'abandon'],
    ['moteur ≠ registre', sortie((s) => { s.moteur.sha256 = '0'.repeat(64); }), /registre/, 'abandon'],
    ['modèle hors liste épinglée (alias, autre version)', sortie((s) => { s.modele = 'claude-sonnet-4-6'; }), /∉ liste autorisée épinglée/, 'abandon'],
    ['empreinte pédagogique ≠ lot lu', sortie((s) => { s.empreinte_pedagogique = `sha256:${'0'.repeat(64)}`; }), /empreinte_pedagogique/, 'abandon'],
    ['empreinte complète ≠ lot lu', sortie((s) => { s.empreinte_complete = `sha256:${'0'.repeat(64)}`; }), /empreinte_complete/, 'abandon'],
    ['candidat_fichier_id ≠ fichier lu', sortie((s) => { s.candidat_fichier_id = 'drv-autre'; }), /candidat_fichier_id/, 'abandon'],
    ['mode d\'exécution ≠ webhook', ({ gen }) => { gen[501].mode = 'manual'; }, /≠ webhook/, 'abandon'],
    ['sortie non conforme à generation-fonda/v1', sortie((s) => { delete s.modele; }), /generation-fonda\/v1 non conforme/, 'abandon'],
    ['deux items en sortie', ({ gen }) => { const m = gen[501].data.resultData.runData['FONDA Sortie generation'][0].data.main[0]; m.push(m[0]); }, /exactement un item/, 'abandon'],
    ['referentiel_version introuvable', sortie((s) => { s.referentiel_version = `sha256:${'1'.repeat(64)}`; }), /introuvable sur l'historique/, 'abandon'],
    ['lot source avec null explicite', ({ lot, setLotGenere }) => { const l = copie(lot); l.cartes[0].unite = null; setLotGenere({ octets: Buffer.from(JSON.stringify(l)) }); }, /null explicite|non conforme/, 'abandon'],
    ['lot source illisible', ({ setLotGenere }) => { setLotGenere({ octets: Buffer.from('{ cassé') }); }, /illisible/, 'incident'],
    ['lot modifié APRÈS la fin de la génération', ({ setLotGenere, candidats }) => { setLotGenere({ modifie_le: '2026-10-18T07:02:00.000Z' }); candidats[0].modifie_le = '2026-10-18T07:02:00.000Z'; }, /modifié APRÈS/, 'abandon'],
    ['lot instable pendant le listing', ({ deps }) => { let n = 0; const f = deps.drive.lireLotGenere; deps.drive.lireLotGenere = async (s) => { n += 1; const r = await f(s); if (n === 2) r.modifie_le = '2026-10-18T07:00:31.000Z'; return r; }; }, /instable/, 'temporaire'],
    ['API injoignable', ({ deps }) => { deps.api.lireExecution = async () => { throw new Error('ECONNREFUSED'); }; }, /injoignable/, 'temporaire'],
    ['détail n8n : statut terminal ≠ listing', ({ gen }) => { gen[501].status = 'error'; }, /observations contradictoires.*statuts terminaux différents/, 'incident'],
    ['détail n8n : autre identifiant', ({ gen }) => { gen[501].id = 777; }, /observations contradictoires.*identifiant du détail/, 'incident'],
    ['détail n8n : startedAt contradictoire', ({ gen }) => { gen[501].startedAt = '2026-10-18T06:59:00.000Z'; }, /startedAt contradictoire/, 'incident'],
    ['génération en cours d\'un AUTRE lot (incident global)', ({ execs, gen, fx }) => { execs.wfGen.push({ id: 506, workflowId: 'wfGen', status: 'running', startedAt: '2026-10-20T08:30:00.000Z', stoppedAt: null }); gen[506] = copie({ ...fx.doublon, id: 506, status: 'running', startedAt: '2026-10-20T08:30:00.000Z', stoppedAt: null }); gen[506].data.resultData.runData['FONDA Entree generation'][0].data.main[0][0].json.set_id = 'set_fonda_lexique_nI_02'; }, /non terminée ou de statut inconnu/, 'incident'],
    ['déclencheur au set_id vide (non attribuable)', ({ execs, gen, fx }) => { execs.wfGen.push({ id: 507, workflowId: 'wfGen', status: 'error', startedAt: fx.erreur_sans_depot.startedAt, stoppedAt: fx.erreur_sans_depot.stoppedAt }); gen[507] = copie({ ...fx.erreur_sans_depot, id: 507 }); gen[507].data.resultData.runData['FONDA Entree generation'][0].data.main[0][0].json.set_id = ''; }, /non attribuable/, 'incident'],
    ['second fichier rattaché à l\'exécution retenue (autre nom, autre set_id)', ({ candidats }) => { candidats.push({ id: 'drv-autre', nom: 'set_fonda_lexique_nI_02.lot.json', modifie_le: '2026-10-18T07:00:40.000Z', properties: { fonda_set_id: 'set_fonda_lexique_nI_02', fonda_execution_id: '501' }, proprietesLisibles: true }); }, /exécution retenue 501 : 2 fichier/, 'abandon'],
    ['workflowData tableau', ({ gen }) => { gen[501].workflowData = []; }, /workflowData absent/, 'refus'],
    ['date du listing postérieure à la génération (lectures stables)', ({ candidats }) => { candidats[0].modifie_le = '2026-10-18T07:05:00.000Z'; }, /modifié APRÈS/, 'abandon'],
    ['accès API insuffisant (403)', ({ deps }) => { deps.api.lireExecution = async () => { const e = new Error('Forbidden'); e.statut = 403; throw e; }; }, /accès insuffisant \(403\)/, 'incident'],
    ['génération active PUIS panne Drive : l\'incident l\'emporte', ({ execs, gen, fx, deps }) => { execs.wfGen.push({ id: 503, workflowId: 'wfGen', status: 'running', startedAt: '2026-10-20T08:30:00.000Z', stoppedAt: null }); gen[503] = { ...fx.doublon, id: 503, status: 'running', startedAt: '2026-10-20T08:30:00.000Z', stoppedAt: null }; deps.drive.listerCandidats = async () => { throw new Error('Drive 503'); }; }, /non terminée/, 'incident'],
  ];
  for (const [libelle, modifier, motif, issue] of cas) {
    test(libelle, async () => sansSignature(await scenario({ source: 'saisie_locale', modifier }), motif, issue));
  }
  test('priorité §20.13 : incident ET abandon simultanés -> l\'incident l\'emporte (les autres constats sont cités)', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: (ctx) => {
      ctx.execs.wfGen.push({ id: 503, workflowId: 'wfGen', status: 'running', startedAt: '2026-10-20T08:30:00.000Z', stoppedAt: null });
      ctx.gen[503] = { ...ctx.fx.doublon, id: 503, status: 'running', startedAt: '2026-10-20T08:30:00.000Z', stoppedAt: null };
      ctx.gen[501].mode = 'manual';
    } });
    const err = await sansSignature(sc, /non terminée/, 'incident');
    assert.match(err.message, /autres constats : .*\[abandon\].*webhook/);
  });
  test('table normative : la sortie conforme passe ; chaque champ altéré est constaté (abandon)', async () => {
    const sc = await scenario({ source: 'saisie_locale' });
    const brute = sc.gen[501];
    const x = { id: '501', workflowId: 'wfGen', status: 'success', startedAt: brute.startedAt, stoppedAt: brute.stoppedAt };
    const base = { setId: sc.setId, retenue: { x, entree: { set_id: sc.setId, ref: sc.valeurs.REF } }, fichier: sc.candidats[0], workflowId: 'wfGen',
      journalCommit: { surPremierParent: true, journal: sc.journal }, registre: REGISTRE, modelesAutorises: [MODELE], lotSource: sc.lot, empreintes: sc.empreintes };
    const ok = new L.Constats();
    assert.ok(L.rapprocher({ ...base, brute, constats: ok }));
    assert.deepEqual(ok.liste, []);
  });
});

describe('§20.5 réconciliation de lot_relu et unicité : chaque violation -> abandon', () => {
  const surLocale = (f) => ({ locales, decisionLocale }) => { const d = copie(decisionLocale); f(d); locales[0].octets = Buffer.from(JSON.stringify(d)); };
  const cas = [
    ['lot_relu.empreinte_complete ≠ lot source', surLocale((d) => { d.lot_relu.empreinte_complete = `sha256:${'0'.repeat(64)}`; }), /lot_relu.empreinte_complete/],
    ['lot_relu.set_id ≠ set_id', surLocale((d) => { d.lot_relu.set_id = 'set_fonda_lexique_nI_02'; }), /lot_relu.set_id/],
    ['carte manquante dans lot_relu', surLocale((d) => { d.lot_relu.cartes.pop(); }), /item_id ≠ ceux du lot source/],
    ['ordre des cartes ≠ lot source', surLocale((d) => { d.lot_relu.cartes.reverse(); }), /item_id ≠ ceux du lot source/],
    ['carte en double', surLocale((d) => { d.lot_relu.cartes[1] = { ...d.lot_relu.cartes[0] }; }), /item_id ≠ ceux du lot source/],
    ['choix hors énumération', surLocale((d) => { d.lot_relu.cartes[0].choix = 'peut-etre'; }), /choix ∉/],
    ['selection ≠ cartes « garder »', surLocale((d) => { d.coeur.selection = d.coeur.selection.slice(1); d.coeur.ecartees = [d.lot_relu.cartes[0].item_id, ...d.coeur.ecartees]; }), /coeur.selection ≠ cartes « garder »/],
    ['empreinte relue ≠ empreinte pédagogique du lot source', surLocale((d) => { d.coeur.empreinte_relue = `sha256:${'0'.repeat(64)}`; }), /empreinte_relue/],
    ['empreinte publiée ≠ lot filtré', surLocale((d) => { d.coeur.empreinte_publiee = `sha256:${'0'.repeat(64)}`; }), /empreinte_publiee/],
    ['accepter sans carte gardée', surLocale((d) => { d.lot_relu.cartes.forEach((c) => { c.choix = 'ecarter'; }); d.coeur.ecartees = d.lot_relu.cartes.map((c) => c.item_id); d.coeur.selection = []; }), /sans carte gardée/],
    ['action rejeter', surLocale((d) => { d.coeur.action = 'rejeter'; }), /rien à publier/],
  ];
  for (const [libelle, modifier, motif] of cas) {
    test(`saisie locale : ${libelle}`, async () => sansSignature(await scenario({ source: 'saisie_locale', modifier }), motif, 'abandon'));
  }
  test('page : lot_relu différents entre deux décisions (cœurs identiques) -> unicité', async () => {
    const sc = await scenario({ modifier: ({ fichiers }) => { fichiers[1].contenu.lot_relu.cartes[0].choix = 'ecarter'; } });
    await sansSignature(sc, /lot_relu distincts|cartes « garder »/, 'abandon');
  });
  test('page : deux cœurs distincts -> unicité', async () => {
    const sc = await scenario({ modifier: ({ fichiers }) => { const d = fichiers[1].contenu; d.coeur.selection = d.coeur.selection.slice(1); d.coeur.ecartees = [d.lot_relu.cartes[0].item_id, ...d.coeur.ecartees]; d.lot_relu.cartes[0].choix = 'ecarter'; } });
    await sansSignature(sc, /cœurs distincts/, 'abandon');
  });
});

describe('§20.6 saisie locale : décisions figées', () => {
  for (const [libelle, modifier, motif, issue] of [
    ['aucune décision figée', ({ locales }) => { locales.length = 0; }, /aucune décision figée/, 'local'],
    ['deux décisions figées distinctes', ({ locales, decisionLocale }) => { const d = copie(decisionLocale); d.nonce = 'autre-nonce-1234'; locales.push({ nom: 'decision-2.json', octets: Buffer.from(JSON.stringify(d)) }); }, /deux décisions figées distinctes/, 'abandon'],
    ['generation ≠ 0', ({ locales, decisionLocale }) => { locales[0].octets = Buffer.from(JSON.stringify({ ...decisionLocale, generation: 1 })); }, /generation = 0/, 'abandon'],
    ['hash_formulaire ≠ saisie-locale', ({ locales, decisionLocale }) => { locales[0].octets = Buffer.from(JSON.stringify({ ...decisionLocale, hash_formulaire: 'h' })); }, /saisie-locale/, 'abandon'],
    ['décision illisible', ({ locales }) => { locales[0].octets = Buffer.from('{ cassé'); }, /illisible/, 'incident'],
    ['incident recouvrant la fenêtre locale [demarree_le, fin_saisie_le]', ({ deps }) => { deps.incidents = async () => [{ id: 'i1', nature: 'x', detecte_le: '2026-10-19T10:00:00.000Z', statut: 'resolu', resolu_le: '2026-10-19T12:00:00.000Z', preuve_resolution: 'ok', periode: { debut: '2026-10-19T09:00:00.000Z', fin: '2026-10-19T12:00:00.000Z' } }]; }, /recouvre/, 'abandon'],
    ['incident ouvert', ({ deps }) => { deps.incidents = async () => [{ id: 'i1', nature: 'x', detecte_le: '2026-10-01T00:00:00.000Z', statut: 'ouvert', resolu_le: null, preuve_resolution: null, periode: { debut: null, fin: null } }]; }, /ouvert/, 'incident'],
    ['code de confirmation faux', ({ deps }) => { const s = deps.saisir; deps.saisir = async (q) => (/Code/.test(q) ? '0'.repeat(16) : s(q)); }, /code de confirmation/, 'local'],
    ['fidélité non attestée', ({ deps }) => { const s = deps.saisir; deps.saisir = async (q) => (/atteste/.test(q) ? 'non' : s(q)); }, /fidélité/, 'local'],
  ]) {
    test(libelle, async () => sansSignature(await scenario({ source: 'saisie_locale', modifier }), motif, issue));
  }
  test('saisie locale réservée au relecteur « eric » : lot de français -> refus', async () => {
    const sc = await scenario({ source: 'saisie_locale' });
    // Lot de français (relecteur justine) en saisie locale.
    const fr = await scenario({ source: 'page_relecture' });
    sc.deps.config.source = 'saisie_locale';
    Object.assign(fr.deps.config, { source: 'saisie_locale' });
    fr.deps.decisionsLocales = async () => [{ nom: 'decision.json', octets: Buffer.from(JSON.stringify({ ...fr.decision('n'), generation: 0, hash_formulaire: 'saisie-locale' })) }];
    await sansSignature(fr, /réservée au relecteur « eric »/, 'refus');
  });
  test('saisirDecisionLocale : brouillon carte par carte, re-demande sur saisie invalide, écriture EXCLUSIVE, decision réconciliable', async () => {
    const sc = await scenario({ source: 'saisie_locale' });
    const reponses = ['peut-etre', ...sc.lotRelu.cartes.map((c) => c.choix), 'oui'];
    const deps = { ...sc.deps, moteur: { ...MOTEUR }, referentiel: REFERENTIEL, aleatoire: () => 'nonce-test-0001', saisir: async () => reponses.shift() };
    const r = await saisirDecisionLocale(sc.setId, deps);
    assert.equal(r.figee, true);
    assert.equal(r.chemin, path.join('/tmp/fonda-cloture-test', sc.setId, 'decision.json'));
    assert.deepEqual(r.decision.lot_relu, sc.lotRelu);
    assert.deepEqual(r.decision.coeur, sc.coeur);
    assert.equal(r.decision.generation, 0);
    assert.equal(r.decision.hash_formulaire, 'saisie-locale');
    assert.match(sc.etat.affiche, /garder ou ecarter/);
    // La décision écrite permet la clôture signée.
    sc.locales[0].octets = sc.etat.ecrits.get(r.chemin);
    const { enveloppe } = await cloturer(sc.setId, sc.deps);
    assert.equal(enveloppe.charge.fin_saisie_le, r.decision.recu_le);
    // Seconde saisie : refusée (décision figée jamais réécrite).
    await assert.rejects(saisirDecisionLocale(sc.setId, { ...deps, saisir: async () => 'garder' }), /existe déjà/);
  });
  test('saisirDecisionLocale : brouillon non figé -> rien n\'est écrit', async () => {
    const sc = await scenario({ source: 'saisie_locale' });
    const reponses = [...sc.lotRelu.cartes.map((c) => c.choix), 'non'];
    const r = await saisirDecisionLocale(sc.setId, { ...sc.deps, moteur: { ...MOTEUR }, referentiel: REFERENTIEL, saisir: async () => reponses.shift() });
    assert.equal(r.figee, false);
    assert.equal(sc.etat.ecrits.size, 0);
  });
  test('saisirDecisionLocale : dossier dans le dépôt ou Dropbox, moteur hors registre -> refus', async () => {
    const sc = await scenario({ source: 'saisie_locale' });
    await assert.rejects(saisirDecisionLocale(sc.setId, { ...sc.deps, moteur: { ...MOTEUR }, referentiel: REFERENTIEL, config: { dossier: path.join(__dirname, 'x') } }), /DANS le dépôt/);
    await assert.rejects(saisirDecisionLocale(sc.setId, { ...sc.deps, moteur: { ...MOTEUR }, referentiel: REFERENTIEL, config: { dossier: '/Users/x/Dropbox/c' } }), /Dropbox/);
    await assert.rejects(saisirDecisionLocale(sc.setId, { ...sc.deps, referentiel: REFERENTIEL, moteur: { version: 'v1', sha256: '0'.repeat(64) } }), /registre/);
  });
});

describe('configuration G5 et sources', () => {
  for (const [libelle, f, motif] of [
    ['liste des modèles vide', (c) => { c.modelesAutorises = []; }, /G5/],
    ['alias pré-4.6 (non épinglé) dans la liste', (c) => { c.modelesAutorises = ['claude-sonnet-4-5']; }, /G5/],
    ['source inconnue', (c) => { c.source = 'n8n'; }, /config.source/],
    ['workflow de génération non épinglé', (c) => { c.workflowGeneration = ''; }, /workflow de génération/],
  ]) {
    test(libelle, async () => {
      const sc = await scenario({ source: 'saisie_locale' });
      f(sc.deps.config);
      await sansSignature(sc, motif);
      assert.deepEqual(sc.etat.appels, [], 'aucun appel réseau');
    });
  }
});

describe('parcours page (v8.2) : chaque refus -> ZÉRO signature', () => {
  const inc = (o) => ({ id: 'i1', nature: 'x', detecte_le: '2026-10-01T00:00:00.000Z', statut: 'resolu', resolu_le: '2026-10-02T00:00:00.000Z', preuve_resolution: 'ok', periode: { debut: null, fin: '2026-10-02T00:00:00.000Z' }, ...o });
  const cas = [
    ['exécution de confirmation en cours (status=running)', ({ execs }) => { execs.wfConf.push({ id: 40, workflowId: 'wfConf', status: 'running', startedAt: '2026-10-20T08:30:00.000Z', stoppedAt: null }); }, /non terminée/, 'incident'],
    ['statut inconnu', ({ execs }) => { execs.wfConf.push({ id: 42, workflowId: 'wfConf', status: 'mystere', startedAt: '2026-10-19T10:00:00.000Z', stoppedAt: null }); }, /inconnu/, 'incident'],
    ['exécution non rattachable', ({ execs }) => { execs.wfConf.push({ id: 43, workflowId: 'wfConf', status: 'success', startedAt: '2026-10-19T10:00:00.000Z', stoppedAt: '2026-10-19T10:00:01.000Z' }); }, /sans données exploitables/, 'incident'],
    ['sortie « conflit »', ({ rattachements }) => { rattachements[2] = { ...rattachements[2], type: 'conflit' }; }, /conflit/, 'abandon'],
    ['exécution du lot en erreur', ({ execs }) => { execs.wfConf[1].status = 'error'; }, /blocage dur/, 'abandon'],
    ['décision consignée absente de Drive', ({ fichiers }) => { fichiers.pop(); }, /absente de Drive/, 'abandon'],
    ['fichier de decisions/ sans exécution', ({ fichiers, decision }) => { fichiers.push({ nom: 'x.json', modifie_le: '2026-10-19T17:10:00.000Z', contenu: decision('n99') }); }, /sans exécution/, 'abandon'],
    ['fichier de decisions/ illisible', ({ fichiers }) => { fichiers[0].contenu = null; }, /illisible/, 'incident'],
    ['fichier de decisions/ non conforme', ({ fichiers }) => { fichiers.push({ nom: 'b.json', modifie_le: '2026-10-19T10:00:00.000Z', contenu: { schema: 'inconnu' } }); }, /non conforme/, 'incident'],
    ['écriture postérieure à la clôture technique', ({ fichiers }) => { fichiers[1].modifie_le = '2026-10-20T08:00:00.001Z'; }, /nouvelle clôture technique/, 'temporaire'],
    ['recherche Drive incomplète sans levée', ({ deps }) => { const l = deps.drive.listerDecisions; deps.drive.listerDecisions = async (s) => ({ ...(await l(s)), incompleteSearch: true }); }, /incomplète/, 'temporaire'],
    ['incident ouvert', ({ deps }) => { deps.incidents = async () => [inc({ statut: 'ouvert', resolu_le: null, preuve_resolution: null, periode: { debut: null, fin: null } })]; }, /ouvert/, 'incident'],
    ['incident recouvrant [cree_le, clos_le]', ({ deps }) => { deps.incidents = async () => [inc({ detecte_le: '2026-10-18T10:00:00.000Z', resolu_le: '2026-10-19T00:00:00.000Z', periode: { debut: '2026-10-18T09:00:00.000Z', fin: '2026-10-19T00:00:00.000Z' } })]; }, /recouvre/, 'abandon'],
    ['incident : fin ≠ résolution', ({ deps }) => { deps.incidents = async () => [inc({ periode: { debut: null, fin: '2026-10-03T00:00:00.000Z' } })]; }, /non conformes/, 'incident'],
    ['candidat non clos', ({ candidat }) => { candidat.relecture.statut = 'en_attente'; }, /clôture technique requise/, 'temporaire'],
    ['fenêtre de candidature inversée', ({ candidat }) => { candidat.relecture.cree_le = '2026-10-21T00:00:00.000Z'; }, /inversée/, 'incident'],
    ['deux clôtures techniques à la même date', ({ execs, rattachements }) => { execs.wfClot.push({ ...execs.wfClot[0], id: 21 }); rattachements[21] = rattachements[20]; }, /même date/, 'abandon'],
    ['clôture technique en cours', ({ execs, rattachements }) => { execs.wfClot.push({ id: 22, workflowId: 'wfClot', status: 'running', startedAt: '2026-10-20T08:20:00.000Z', stoppedAt: null }); rattachements[22] = rattachements[20]; }, /encore en cours/, 'incident'],
    ['aucune clôture technique', ({ execs }) => { execs.wfClot.length = 0; }, /aucune clôture/, 'temporaire'],
    ['exécution de clôture NON ATTRIBUABLE (même terminée)', ({ rattachements }) => { delete rattachements[20]; }, /non attribuable/, 'incident'],
    ['exécution de clôture en cours non attribuable (autre lot ?) : incident global', ({ execs }) => { execs.wfClot.push({ id: 23, workflowId: 'wfClot', status: 'running', startedAt: '2026-10-20T08:20:00.000Z', stoppedAt: null }); }, /non terminée ou de statut inconnu/, 'incident'],
    ['moteur du candidat ≠ génération', ({ candidat }) => { candidat.relecture.moteur = { version: 'v1', sha256: '0'.repeat(64) }; }, /moteur du candidat/, 'abandon'],
    ['referentiel_version du candidat ≠ génération', ({ candidat }) => { candidat.relecture.referentiel_version = `sha256:${'2'.repeat(64)}`; }, /referentiel_version du candidat/, 'abandon'],
    ['relecteur du candidat ≠ référentiel archivé', ({ candidat }) => { candidat.relecture.relecteur_attribue = 'eric'; }, /relecteur attribué du candidat/, 'abandon'],
    ['lot de l\'enveloppe ≠ lot généré', ({ candidat }) => { candidat.lot.cartes[0].question += ' (modifiée)'; }, /≠ lot généré/, 'abandon'],
    ['exécution d\'un AUTRE lot sans dates (observation inexploitable)', ({ execs }) => { execs.wfConf[2].startedAt = null; execs.wfConf[2].stoppedAt = null; }, /sans startedAt\/stoppedAt/, 'incident'],
    ['exécution sans identifiant', ({ execs }) => { execs.wfConf.push({ workflowId: 'wfConf', status: 'success', startedAt: '2026-10-19T10:00:00.000Z', stoppedAt: '2026-10-19T10:00:01.000Z' }); }, /identifiant/, 'incident'],
    ['candidat non clos ET confirmation en cours : l\'incident l\'emporte', ({ candidat, execs }) => { candidat.relecture.statut = 'en_attente'; execs.wfConf.push({ id: 40, workflowId: 'wfConf', status: 'running', startedAt: '2026-10-20T08:30:00.000Z', stoppedAt: null }); }, /non terminée/, 'incident'],
    ['aucune clôture réussie ET décision illisible : l\'incident l\'emporte', ({ rattachements, fichiers }) => { delete rattachements[20]; fichiers[0].contenu = null; }, /illisible/, 'incident'],
    ['décision tardive ORPHELINE : abandon (pas seulement temporaire)', ({ fichiers, decision }) => { fichiers.push({ nom: 'tard.json', modifie_le: '2026-10-20T08:30:00.000Z', contenu: decision('n77') }); }, /sans exécution correspondante/, 'abandon'],
    ['décision tardive au cœur distinct : abandon (unicité)', ({ fichiers }) => { const d = fichiers[1].contenu; d.coeur.selection = d.coeur.selection.slice(1); d.coeur.ecartees = [d.lot_relu.cartes[0].item_id, ...d.coeur.ecartees]; d.lot_relu.cartes[0].choix = 'ecarter'; fichiers[1].modifie_le = '2026-10-20T08:30:00.000Z'; }, /cœurs distincts/, 'abandon'],
  ];
  for (const [libelle, modifier, motif, issue] of cas) {
    test(libelle, async () => sansSignature(await scenario({ modifier }), motif, issue));
  }
  const refusAvantSignature = [
    ['tiers choisissant « auto »', { mode: 'auto' }, /mode de confirmation invalide/],
    ['cle_id non déclaré', { modifier: ({ deps }) => { deps.config.cleId = 'cle-inconnue'; } }, /non déclarée/],
    ['clé révoquée', { modifier: ({ deps }) => { deps.cles = S.chargerCles([{ ...DECL, revoquee_le: '2026-12-01T00:00:00.000Z' }], () => PEM); } }, /révoquée/],
    ['levée à constat vide', { modifier: ({ deps }) => { deps.levees = [{ type: 'recherche_incomplete', constat: ' ' }]; } }, /avant signature/],
    ['dossier de clôture dans le dépôt', { modifier: ({ deps }) => { deps.config.dossier = path.join(__dirname, 'cloture'); } }, /DANS le dépôt/],
    ['dossier de clôture dans Dropbox', { modifier: ({ deps }) => { deps.config.dossier = '/Users/x/Dropbox/cloture'; } }, /Dropbox/],
    ['sous-dossier final lien vers le dépôt', { modifier: ({ deps }) => { deps.fs.realpath = (p) => (/set_fonda_/.test(p) ? path.join(__dirname, 'x') : p); } }, /DANS le dépôt/],
    ['instantané déjà écrit (jamais reconstruit)', { modifier: ({ deps }) => { const e = deps.fs.ecrireExclusif; deps.fs.ecrireExclusif = (p, t) => { if (p.endsWith('instantane.json')) throw new Error('existe déjà'); return e(p, t); }; } }, /existe déjà/],
    ['instantané altéré sur disque avant signature', { modifier: ({ deps }) => { const l = deps.fs.lire; deps.fs.lire = (p) => (p.endsWith('instantane.json') ? Buffer.concat([l(p), Buffer.from(' ')]) : l(p)); } }, /§3.4 \(a\)/],
    ['attestation.json déjà présent', { modifier: ({ deps }) => { const e = deps.fs.existe; deps.fs.existe = (p) => (p.endsWith('attestation.json') ? true : e(p)); } }, /déjà signé/],
    ['attestation.json inaccessible (EACCES)', { modifier: ({ deps }) => { const e = deps.fs.existe; deps.fs.existe = (p) => { if (p.endsWith('attestation.json')) { const x = new Error('accès refusé'); x.code = 'EACCES'; throw x; } return e(p); }; } }, /inaccessible/],
    ['existe() indéterminé', { modifier: ({ deps }) => { const e = deps.fs.existe; deps.fs.existe = (p) => (p.endsWith('attestation.json') ? undefined : e(p)); } }, /indéterminé/],
  ];
  for (const [libelle, x, motif] of refusAvantSignature) {
    test(`refus SANS appel au signataire : ${libelle}`, async () => sansSignature(await scenario(x), motif));
  }
  test('PEM valide au premier chargement puis illisible : la revérification n\'est pas affectée (clé figée)', async () => {
    let n = 0;
    const sc = await scenario({ modifier: ({ deps }) => { deps.cles = S.chargerCles([DECL], () => { n += 1; if (n > 1) throw new Error('illisible'); return PEM; }); } });
    await cloturer(sc.setId, sc.deps);
    assert.equal(sc.etat.signatures, 1);
    assert.equal(n, 1);
  });
  test('incidents hors fenêtre : acceptés, dates normalisées dans la charge', async () => {
    const avant = inc({ detecte_le: '2026-10-01T02:00:00+02:00', resolu_le: '2026-10-02T02:00:00+02:00', periode: { debut: null, fin: '2026-10-02T02:00:00+02:00' } });
    const apres = inc({ id: 'i2', detecte_le: '2026-10-20T08:00:00.000Z', resolu_le: '2026-10-20T08:30:00.000Z', periode: { debut: '2026-10-20T07:59:00.001Z', fin: '2026-10-20T08:30:00.000Z' } });
    const sc = await scenario({ modifier: ({ deps }) => { deps.incidents = async () => [apres, avant]; } });
    const { enveloppe } = await cloturer(sc.setId, sc.deps);
    assert.deepEqual(enveloppe.charge.incidents_connus.map((i) => i.id), ['i1', 'i2']);
    assert.equal(enveloppe.charge.incidents_connus[0].resolu_le, '2026-10-02T00:00:00.000Z');
  });
  test('clos_le avec décalage horaire : normalisé (revoque_le en UTC)', async () => {
    const sc = await scenario({ modifier: ({ candidat }) => { candidat.relecture.clos_le = '2026-10-20T09:59:00+02:00'; } });
    const { enveloppe } = await cloturer(sc.setId, sc.deps);
    assert.equal(enveloppe.charge.revoque_le, '2026-10-20T07:59:00.000Z');
  });
  test('rendu HUMAIN affiché et exporté : questions, réponses, règles, comportements par défaut', async () => {
    const sc = await scenario({ maths: true });
    await cloturer(sc.setId, sc.deps);
    const premiere = require('../data/lots/set_fonda_grandeurs-mesures_nI_01.json').cartes[0];
    assert.ok(sc.etat.affiche.includes(premiere.question));
    assert.match(sc.etat.affiche, /seconde chance : non \(par défaut\)/);
    const txt = [...sc.etat.ecrits.entries()].find(([p]) => p.endsWith('.txt'))[1].toString('utf8');
    assert.match(txt.trim().split('\n').pop(), /^[0-9a-f]{64}$/);
  });
  test('évolution normale : vue en cours puis terminée -> acceptée ; contradictions -> refus', async () => {
    const sc = await scenario();
    const base = sc.deps.api.listerExecutions;
    sc.deps.api.listerExecutions = async (q) => (q.status === 'running' && q.workflowId === 'wfConf' ? [{ id: 10, workflowId: 'wfConf', status: 'running', startedAt: null, stoppedAt: null }] : base(q));
    assert.deepEqual((await cloturer(sc.setId, sc.deps)).enveloppe.charge.provenances.map((p) => p.execution_id), ['10', '2']);
    const { observer } = require('./signer-cloture.js');
    let n = 0;
    await assert.rejects(observer({ listerExecutions: async () => { n += 1; return [{ id: 7, workflowId: 'w', status: n === 1 ? 'success' : 'running', startedAt: '2026-10-19T17:00:00.000Z', stoppedAt: null }]; } }, 'w'), /contradiction/);
  });
});

describe('outils disque et dates', () => {
  test('existeSurDisque : seule l\'absence avérée (ENOENT) vaut false ; lien cassé = existant', () => {
    const { existeSurDisque } = require('./signer-cloture.js');
    const tmp = fsN.mkdtempSync(path.join(require('os').tmpdir(), 'cloture-existe-'));
    assert.equal(existeSurDisque(path.join(tmp, 'absent.json')), false);
    fsN.writeFileSync(path.join(tmp, 'la.json'), '{}');
    assert.equal(existeSurDisque(path.join(tmp, 'la.json')), true);
    assert.throws(() => existeSurDisque(path.join(tmp, 'la.json', 'sous')), (e) => e.code === 'ENOTDIR');
    fsN.symlinkSync(path.join(tmp, 'cible-inexistante'), path.join(tmp, 'lien-casse.json'));
    assert.equal(existeSurDisque(path.join(tmp, 'lien-casse.json')), true);
  });
  test('dossier de clôture via un LIEN SYMBOLIQUE vers le dépôt : refusé', () => {
    const { verifierDossierLocal } = require('./signer-cloture.js');
    const tmp = fsN.mkdtempSync(path.join(require('os').tmpdir(), 'cloture-lien-'));
    const lien = path.join(tmp, 'clotures');
    fsN.symlinkSync(__dirname, lien);
    assert.throws(() => verifierDossierLocal(path.join(lien, 'lot')), /DANS le dépôt/);
    assert.doesNotThrow(() => verifierDossierLocal(path.join(tmp, 'vrai-dossier', 'lot')));
  });
  test('dates de source : grammaire stricte et date calendaire réelle', () => {
    assert.equal(normaliserDate('2026-10-19T19:00:00+02:00'), '2026-10-19T17:00:00.000Z');
    assert.equal(normaliserDate('2026-10-19T17:00:00.123456Z'), '2026-10-19T17:00:00.123Z');
    for (const v of ['2026-10-19T17:00:00', '2026-02-30T00:00:00Z', '2026-10-19 17:00:00Z', 1760000000000, null]) assert.equal(normaliserDate(v), null, String(v));
  });
});

describe('reprise sur l\'instantané EXISTANT (§20.13) et saisie locale (critique Codex r1)', () => {
  for (const [libelle, champ] of [['code faux', 'Code'], ['fidélité non attestée', 'atteste']]) {
    test(`${libelle} puis relance : reprise sur l'instantané relu et vérifié, jamais réécrit -> signature`, async () => {
      const sc = await scenario({ source: 'saisie_locale' });
      const saisir = sc.deps.saisir;
      sc.deps.saisir = async (q) => (new RegExp(champ).test(q) ? (champ === 'Code' ? '0'.repeat(16) : 'non') : saisir(q));
      await assert.rejects(cloturer(sc.setId, sc.deps), /code de confirmation|fidélité/);
      const avant = new Map(sc.etat.ecrits);
      sc.deps.saisir = saisir;
      sc.etat.affiche = '';
      const { enveloppe } = await cloturer(sc.setId, sc.deps);
      assert.equal(sc.etat.signatures, 1);
      assert.match(sc.etat.affiche, /Reprise de la confirmation sur l'instantané EXISTANT/);
      for (const [p, o] of avant) assert.ok(sc.etat.ecrits.get(p).equals(o), `${p} inchangé`);
      assert.equal(enveloppe.charge.sha256_instantane, crypto.createHash('sha256').update(avant.get([...avant.keys()].find((p) => p.endsWith('instantane.json')))).digest('hex'));
    });
  }
  test('reprise : instantané existant altéré -> refus (traitement manuel), zéro signature', async () => {
    const sc = await scenario({ source: 'saisie_locale' });
    const saisir = sc.deps.saisir;
    sc.deps.saisir = async (q) => (/Code/.test(q) ? '0'.repeat(16) : saisir(q));
    await assert.rejects(cloturer(sc.setId, sc.deps), /code de confirmation/);
    const p = [...sc.etat.ecrits.keys()].find((k) => k.endsWith('instantane.json'));
    sc.etat.ecrits.set(p, Buffer.concat([sc.etat.ecrits.get(p), Buffer.from(' ')]));
    sc.deps.saisir = saisir;
    await sansSignature(sc, /ne correspond pas/, 'local');
  });
  test('saisirDecisionLocale : lot attribué à un autre relecteur -> refus AVANT toute saisie, rien écrit', async () => {
    const sc = await scenario({ source: 'page_relecture' }); // lot de français (justine)
    let questions = 0;
    const deps = { ...sc.deps, moteur: { ...MOTEUR }, referentiel: REFERENTIEL, saisir: async () => { questions += 1; return 'garder'; } };
    await assert.rejects(saisirDecisionLocale(sc.setId, deps), /réservée au relecteur « eric »/);
    assert.equal(questions, 0);
    assert.equal(sc.etat.ecrits.size, 0);
    // Génération illisible ou ambiguë : relecteur non déterminable -> aucune saisie.
    const sl = await scenario({ source: 'saisie_locale' });
    let q2 = 0;
    await assert.rejects(saisirDecisionLocale(sl.setId, { ...sl.deps, moteur: { ...MOTEUR }, saisir: async () => { q2 += 1; return 'garder'; }, api: { ...sl.deps.api, lireExecution: async () => null } }), /saisie impossible/);
    assert.equal(q2, 0);
  });
  test('saisirDecisionLocale : rendu AVANT le choix — unité, arrondi, seconde chance, contexte', async () => {
    const sc = await scenario({ source: 'saisie_locale' });
    const reponses = [...sc.lotRelu.cartes.map((c) => c.choix), 'non'];
    await saisirDecisionLocale(sc.setId, { ...sc.deps, moteur: { ...MOTEUR }, referentiel: REFERENTIEL, saisir: async () => reponses.shift() });
    assert.match(sc.etat.affiche, /Unité : .* ; arrondi : .* ; seconde chance : /);
    assert.match(sc.etat.affiche, /Contexte : /);
  });
});

describe('critique Codex r3 : double attestation, fusion, observations partielles, antécédents', () => {
  // Déplacement simulé du dossier du lot (archivage) : ses fichiers quittent le dossier de clôture.
  const archiver = (sc) => { for (const p of [...sc.etat.ecrits.keys()]) if (/set_fonda_[^/]+-[0-9a-f]{16}\//.test(p)) { sc.etat.ecrits.set(p.replace('/tmp/fonda-cloture-test/', '/tmp/archives/'), sc.etat.ecrits.get(p)); sc.etat.ecrits.delete(p); } };
  test('signé puis dossier ARCHIVÉ : relance refusée par le marqueur durable (jamais deux attestations)', async () => {
    const sc = await scenario({ source: 'saisie_locale' });
    await cloturer(sc.setId, sc.deps);
    archiver(sc);
    sc.etat.affiche = '';
    await assert.rejects(cloturer(sc.setId, sc.deps), /signature déjà tentée/);
    assert.equal(sc.etat.signatures, 1);
  });
  test('panne d\'écriture APRÈS signature puis archivage : relance refusée (traitement manuel)', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ deps }) => { const e = deps.fs.ecrireExclusif; deps.fs.ecrireExclusif = (p, t) => { if (p.endsWith('attestation.json')) { e(p, t); throw new Error('EIO'); } return e(p, t); }; } });
    await assert.rejects(cloturer(sc.setId, sc.deps), /EIO/);
    archiver(sc);
    sc.etat.affiche = '';
    const err = await cloturer(sc.setId, sc.deps).then(() => null, (x) => x);
    assert.match(err.message, /signature déjà tentée/);
    assert.equal(sc.etat.signatures, 1);
  });
  test('marqueur écrit AVANT l\'appel au signataire', async () => {
    const sc = await scenario({ source: 'saisie_locale' });
    let marqueurAvant = null;
    const signer = sc.deps.signer;
    sc.deps.signer = (o) => { marqueurAvant = sc.etat.ecrits.has(`/tmp/fonda-cloture-test/${sc.setId}.signature`); return signer(o); };
    await cloturer(sc.setId, sc.deps);
    assert.equal(marqueurAvant, true);
  });
  for (const [libelle, listing, detail] of [
    ['statut INCONNU au listing puis success au détail (autre lot)', { status: 'mystere', startedAt: '2026-10-18T05:00:00.000Z', stoppedAt: null }, { status: 'success', startedAt: '2026-10-18T05:00:00.000Z', stoppedAt: '2026-10-18T05:01:00.000Z' }],
    ['running au listing puis success avec stoppedAt < startedAt (autre lot)', { status: 'running', startedAt: '2026-10-18T05:00:00.000Z', stoppedAt: null }, { status: 'success', startedAt: '2026-10-18T05:00:00.000Z', stoppedAt: '2026-10-18T04:59:00.000Z' }],
  ]) {
    test(`fusion : ${libelle} -> incident, zéro signature`, async () => {
      const sc = await scenario({ source: 'saisie_locale', modifier: ({ execs, gen, fx }) => {
        execs.wfGen.push({ id: 508, workflowId: 'wfGen', ...listing });
        gen[508] = copie({ ...fx.erreur_sans_depot, id: 508, ...detail });
        gen[508].data.resultData.runData['FONDA Entree generation'][0].data.main[0][0].json.set_id = 'set_fonda_lexique_nI_02';
      } });
      // La requête status=running ne renvoie que les « running » ; « mystere » n'apparaît qu'à la liste complète.
      await sansSignature(sc, /statut inconnu|non terminée|avant d'avoir démarré/, 'incident');
    });
  }
  test('« running » observé puis panne de la liste complète -> incident (pas seulement temporaire)', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ execs }) => { execs.wfGen.push({ id: 509, workflowId: 'wfGen', status: 'running', startedAt: '2026-10-20T08:30:00.000Z', stoppedAt: null }); } });
    const base = sc.deps.api.listerExecutions;
    sc.deps.api.listerExecutions = async (q) => { if (q.workflowId === 'wfGen' && !q.status) throw new Error('timeout'); return base(q); };
    await sansSignature(sc, /observée avant la panne/, 'incident');
  });
  test('lot illisible à la première lecture, seconde lecture en panne -> incident', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ setLotGenere }) => { setLotGenere({ octets: Buffer.from('{ cassé') }); } });
    let n = 0; const l = sc.deps.drive.lireLotGenere;
    sc.deps.drive.lireLotGenere = async (x) => { n += 1; if (n === 2) throw new Error('Drive 503'); return l(x); };
    await sansSignature(sc, /illisible/, 'incident');
  });
  test('deux fichiers candidats, listing de génération en panne -> abandon', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ candidats, valeurs }) => { candidats.push({ ...candidats[0], id: 'drv-2', properties: { fonda_set_id: valeurs.SET_ID, fonda_execution_id: '600' } }); } });
    const base = sc.deps.api.listerExecutions;
    sc.deps.api.listerExecutions = async (q) => { if (q.workflowId === 'wfGen') throw new Error('timeout'); return base(q); };
    await sansSignature(sc, /2 fichier\(s\) candidat/, 'abandon');
  });
  test('deux cœurs distincts, lecture du lot en panne -> abandon (unicité indépendante du lot)', async () => {
    const sc = await scenario({ modifier: ({ fichiers }) => { const d = fichiers[1].contenu; d.coeur.selection = d.coeur.selection.slice(1); } });
    sc.deps.drive.lireLotGenere = async () => { throw new Error('Drive 503'); };
    await sansSignature(sc, /cœurs distincts/, 'abandon');
  });
  test('clôture antérieure sur d\'autres données ET clé absente -> abandon (antécédents évalués avant la tranche)', async () => {
    const sc = await scenario({ source: 'saisie_locale', code: '0'.repeat(16) });
    await assert.rejects(cloturer(sc.setId, sc.deps), /code de confirmation/);
    const d = copie(sc.decisionLocale);
    d.lot_relu.cartes[0].choix = 'ecarter'; d.coeur.selection = d.coeur.selection.slice(1); d.coeur.ecartees = [d.lot_relu.cartes[0].item_id, ...d.coeur.ecartees];
    d.coeur.empreinte_publiee = await C.calculerEmpreinte({ ...sc.lot, revue_carte_par_carte: true, nb_cartes: d.coeur.selection.length, cartes: sc.lot.cartes.filter((c) => d.coeur.selection.includes(c.item_id)) }, sha);
    sc.locales[0].octets = Buffer.from(JSON.stringify(d));
    sc.deps.config.cleId = 'cle-inconnue';
    await sansSignature(sc, /clôture antérieure/, 'abandon');
  });
});

describe('critique Codex r4 : observateur, lectures partielles du lot', () => {
  for (const [libelle, premiere, motif] of [
    ['statut inconnu dans une première observation', { status: 'mystere', startedAt: '2026-10-18T05:00:00.000Z', stoppedAt: null }, /statut inconnu/],
    ['stoppedAt différent entre deux observations', { status: 'success', startedAt: '2026-10-18T05:00:00.000Z', stoppedAt: '2026-10-18T05:02:00.000Z' }, /contradictoires \(stoppedAt\)/],
    ['chronologie inversée dans une observation', { status: 'success', startedAt: '2026-10-18T05:00:00.000Z', stoppedAt: '2026-10-18T04:00:00.000Z' }, /avant d'avoir démarré/],
  ]) {
    test(`observateur : ${libelle}, écrasée par une observation valide -> incident, zéro signature`, async () => {
      const sc = await scenario({ source: 'saisie_locale' });
      const base = sc.deps.api.listerExecutions;
      const valide = { id: 510, workflowId: 'wfGen', status: 'success', startedAt: '2026-10-18T05:00:00.000Z', stoppedAt: '2026-10-18T05:01:00.000Z' };
      sc.deps.api.listerExecutions = async (q) => (q.workflowId === 'wfGen' && !q.status ? [...(await base(q)), { id: 510, workflowId: 'wfGen', ...premiere }, valide] : base(q));
      await sansSignature(sc, motif, 'incident');
    });
  }
  test('première lecture du lot en panne, seconde illisible -> incident', async () => {
    const sc = await scenario({ source: 'saisie_locale' });
    let n = 0; const l = sc.deps.drive.lireLotGenere;
    sc.deps.drive.lireLotGenere = async (x) => { n += 1; if (n === 1) throw new Error('Drive 503'); const r = await l(x); r.octets = Buffer.from('{ cassé'); return r; };
    await sansSignature(sc, /illisible/, 'incident');
  });
  test('lot à empreinte discordante lu, seconde lecture en panne -> abandon (contenu contrôlé sans preuve de stabilité)', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ lot, setLotGenere }) => { const l = copie(lot); l.cartes[0].question += ' (modifiée)'; setLotGenere({ octets: Buffer.from(JSON.stringify(l)) }); } });
    let n = 0; const l = sc.deps.drive.lireLotGenere;
    sc.deps.drive.lireLotGenere = async (x) => { n += 1; if (n === 2) throw new Error('Drive 503'); return l(x); };
    await sansSignature(sc, /empreinte/, 'abandon');
  });
});

describe('critique Codex r5 : contenus multiples du lot, examen non exhaustif', () => {
  for (const source of ['saisie_locale', 'page_relecture']) {
    test(`${source} : seconde lecture CONFORME mais modifiée -> abandon (empreinte), prioritaire sur l'instabilité`, async () => {
      const sc = await scenario({ source });
      let n = 0; const l = sc.deps.drive.lireLotGenere;
      sc.deps.drive.lireLotGenere = async (x) => { n += 1; const r = await l(x); if (n === 2) { const lot = JSON.parse(r.octets.toString('utf8')); lot.cartes[0].question += ' (modifiée)'; r.octets = Buffer.from(JSON.stringify(lot)); } return r; };
      await sansSignature(sc, /seconde lecture du lot : empreinte/, 'abandon');
    });
  }
  test('détail d\'une AUTRE exécution en panne : la génération du lot reste contrôlée (mode manual -> abandon)', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ execs, gen, fx }) => {
      execs.wfGen.push({ id: 498, workflowId: 'wfGen', status: 'error', startedAt: fx.erreur_sans_depot.startedAt, stoppedAt: fx.erreur_sans_depot.stoppedAt });
      gen[498] = fx.erreur_sans_depot; gen[501].mode = 'manual';
    } });
    const lire = sc.deps.api.lireExecution;
    sc.deps.api.lireExecution = async (id) => { if (id === '498') throw new Error('503'); return lire(id); };
    await sansSignature(sc, /≠ webhook/, 'abandon');
  });
  test('workflowData absent ET mode manual : l\'abandon (mode) l\'emporte sur le refus (données indisponibles)', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ gen }) => { delete gen[501].workflowData; gen[501].mode = 'manual'; } });
    await sansSignature(sc, /≠ webhook/, 'abandon');
  });
  test('workflowData absent ET modèle interdit dans la sortie : la table reste évaluée -> abandon', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ gen }) => { delete gen[501].workflowData; gen[501].data.resultData.runData['FONDA Sortie generation'][0].data.main[0][0].json.modele = 'claude-sonnet-4-6'; } });
    await sansSignature(sc, /∉ liste autorisée/, 'abandon');
  });
  test('examen non exhaustif, génération du lot conforme : jamais de signature (refus temporaire)', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ execs, gen, fx }) => { execs.wfGen.push({ id: 498, workflowId: 'wfGen', status: 'error', startedAt: fx.erreur_sans_depot.startedAt, stoppedAt: fx.erreur_sans_depot.stoppedAt }); gen[498] = fx.erreur_sans_depot; } });
    const lire = sc.deps.api.lireExecution;
    sc.deps.api.lireExecution = async (id) => { if (id === '498') throw new Error('503'); return lire(id); };
    await sansSignature(sc, /injoignable/, 'temporaire');
  });
});

describe('critique Codex r6 : génération observée malgré un examen non exhaustif', () => {
  const panne498 = (sc) => { const lire = sc.deps.api.lireExecution; sc.deps.api.lireExecution = async (id) => { if (id === '498') throw new Error('503'); return lire(id); }; };
  const avec498 = ({ execs, gen, fx }) => { execs.wfGen.push({ id: 498, workflowId: 'wfGen', status: 'error', startedAt: fx.erreur_sans_depot.startedAt, stoppedAt: fx.erreur_sans_depot.stoppedAt }); gen[498] = fx.erreur_sans_depot; };
  for (const source of ['saisie_locale', 'page_relecture']) {
    test(`${source} : lot modifié après la génération + détail d'une autre exécution en panne -> abandon`, async () => {
      const sc = await scenario({ source, modifier: (ctx) => { avec498(ctx); ctx.setLotGenere({ modifie_le: '2026-10-18T07:02:00.000Z' }); ctx.candidats[0].modifie_le = '2026-10-18T07:02:00.000Z'; } });
      panne498(sc);
      await sansSignature(sc, /modifié APRÈS/, 'abandon');
    });
  }
  test('saisie locale : incident recouvrant la fenêtre + détail d\'une autre exécution en panne -> abandon', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: (ctx) => { avec498(ctx); ctx.deps.incidents = async () => [{ id: 'i1', nature: 'x', detecte_le: '2026-10-19T10:00:00.000Z', statut: 'resolu', resolu_le: '2026-10-19T12:00:00.000Z', preuve_resolution: 'ok', periode: { debut: '2026-10-19T09:00:00.000Z', fin: '2026-10-19T12:00:00.000Z' } }]; } });
    panne498(sc);
    await sansSignature(sc, /recouvre/, 'abandon');
  });
});

describe('critique Codex r7 : dates du listing Drive sans lecture du contenu', () => {
  for (const source of ['saisie_locale', 'page_relecture']) {
    test(`${source} : listing daté APRÈS la génération, deux lectures du lot en panne -> abandon`, async () => {
      const sc = await scenario({ source, modifier: ({ candidats, deps }) => { candidats[0].modifie_le = '2026-10-18T07:02:00.000Z'; deps.drive.lireLotGenere = async () => { throw new Error('Drive 503'); }; } });
      await sansSignature(sc, /modifié APRÈS/, 'abandon');
    });
  }
  test('date illisible au listing, lectures en panne -> incident', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ candidats, deps }) => { candidats[0].modifie_le = 'hier'; deps.drive.lireLotGenere = async () => { throw new Error('Drive 503'); }; } });
    await sansSignature(sc, /date de modification illisible/, 'incident');
  });
});

describe('audit préventif : contrôles sans lot source lu (empreintes de la génération)', () => {
  test('lot illisible (lectures en panne) : lot_relu à empreinte_complete fausse -> abandon (réconcilié sur la sortie)', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ locales, decisionLocale, deps }) => {
      const d = copie(decisionLocale); d.lot_relu.empreinte_complete = `sha256:${'0'.repeat(64)}`; locales[0].octets = Buffer.from(JSON.stringify(d));
      deps.drive.lireLotGenere = async () => { throw new Error('Drive 503'); };
    } });
    await sansSignature(sc, /lot_relu.empreinte_complete/, 'abandon');
  });
  test('page : lot de l\'enveloppe ≠ génération, lectures du lot en panne -> abandon', async () => {
    const sc = await scenario({ modifier: ({ candidat, deps }) => { candidat.lot.cartes[0].question += ' (modifiée)'; deps.drive.lireLotGenere = async () => { throw new Error('Drive 503'); }; } });
    await sansSignature(sc, /≠ lot généré/, 'abandon');
  });
});

describe('critique Codex r8 : identité du fichier effectivement lu', () => {
  test('les deux lectures renvoient un AUTRE nom (listing inchangé) -> abandon, zéro signature', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ setLotGenere }) => { setLotGenere({ nom: 'autre.lot.json' }); } });
    await sansSignature(sc, /nom ≠/, 'abandon');
  });
  test('identifiant lu ≠ candidat_fichier_id, listing Drive indisponible -> abandon', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ setLotGenere, deps }) => { setLotGenere({ id: 'drv-autre' }); deps.drive.listerCandidats = async () => { throw new Error('Drive 503'); }; } });
    await sansSignature(sc, /candidat_fichier_id de la génération/, 'abandon');
  });
  test('lot nF sous un set_id nI, génération indisponible -> abandon', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ lot, setLotGenere, deps }) => { const l = copie(lot); l.palier = 'nF'; l.cartes.forEach((c) => { c.palier = 'nF'; }); setLotGenere({ octets: Buffer.from(JSON.stringify(l)) }); deps.api.lireExecution = async () => { throw new Error('503'); }; } });
    await sansSignature(sc, /palier \/ notion|non conforme/, 'abandon');
  });
});

describe('§20.13 amendement r6 : règle d\'observation incomplète', () => {
  test('(a) lecture en panne + anomalie déterminable sur ses propres données -> l\'issue FINE se déclenche (abandon)', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ gen, deps }) => {
      gen[501].data.resultData.runData['FONDA Sortie generation'][0].data.main[0][0].json.modele = 'claude-sonnet-4-6'; // hors liste autorisée
      deps.drive.listerCandidats = async () => { throw new Error('Drive 503'); };
    } });
    const err = await sansSignature(sc, /∉ liste autorisée/, 'abandon');
    assert.match(err.message, /observation incomplète : Drive \(candidats\/\)/);
  });
  test('(b) lecture en panne sans autre signal -> refus temporaire, anomalies « à confirmer » listées', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ deps, locales }) => { locales.length = 0; deps.drive.listerCandidats = async () => { throw new Error('Drive 503'); }; } });
    const err = await sansSignature(sc, /observation incomplète \(lectures en échec : Drive \(candidats\/\) injoignable.*\) : refus temporaire, relancer/, 'temporaire');
    assert.match(err.message, /à confirmer sur observation complète : \[local\] aucune décision figée/);
  });
  test('(b bis) lecture en panne, aucun autre constat -> refus temporaire, « aucune » anomalie à confirmer', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ deps }) => { deps.incidents = async () => { throw new Error('incidents injoignables'); }; } });
    await sansSignature(sc, /à confirmer sur observation complète : aucune/, 'temporaire');
  });
  test('(c) absence DÉFINITIVE du lot généré (fichier absent) -> abandon', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ deps }) => { deps.drive.lireLotGenere = async () => null; } });
    await sansSignature(sc, /absent/, 'abandon');
  });
});

describe('critique Codex r9 : garde-fou 1 — contrôles intrinsèques des décisions sans référence', () => {
  const pannes = (deps) => { deps.drive.lireLotGenere = async () => { throw new Error('Drive 503'); }; deps.api.lireExecution = async () => { throw new Error('503'); }; };
  for (const [libelle, f, motif] of [
    ['lot_relu.set_id ≠ set_id', (d) => { d.lot_relu.set_id = 'set_fonda_lexique_nI_02'; }, /lot_relu.set_id/],
    ['choix interdit', (d) => { d.lot_relu.cartes[0].choix = 'peut-etre'; }, /choix ∉/],
    ['selection incohérente avec les « garder »', (d) => { d.coeur.selection = d.coeur.selection.slice(1); }, /coeur.selection ≠ cartes « garder »/],
  ]) {
    test(`saisie locale : ${libelle}, lot ET génération illisibles -> abandon (pas « temporaire »)`, async () => {
      const sc = await scenario({ source: 'saisie_locale', modifier: ({ locales, decisionLocale, deps }) => { const d = copie(decisionLocale); f(d); locales[0].octets = Buffer.from(JSON.stringify(d)); pannes(deps); } });
      await sansSignature(sc, motif, 'abandon');
    });
    test(`page : ${libelle}, lot ET génération illisibles -> abandon`, async () => {
      const sc = await scenario({ modifier: ({ fichiers, deps }) => { for (const x of fichiers) f(x.contenu); pannes(deps); } });
      await sansSignature(sc, motif, 'abandon');
    });
  }
});

describe('garde-fou 1 (§20.13 r6) : contrôles déterminables malgré une lecture en panne', () => {
  const pannes = (deps) => { deps.drive.lireLotGenere = async () => { throw new Error('Drive 503'); }; deps.api.lireExecution = async () => { throw new Error('503'); }; };
  test('moteur du cœur hors registre -> abandon', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ locales, decisionLocale, deps }) => { const d = copie(decisionLocale); d.coeur.moteur = { version: 'v999', sha256: '0'.repeat(64) }; locales[0].octets = Buffer.from(JSON.stringify(d)); pannes(deps); } });
    await sansSignature(sc, /absent du registre/, 'abandon');
  });
  test('page : moteur du candidat ≠ moteur du cœur -> abandon', async () => {
    const sc = await scenario({ modifier: ({ candidat, deps }) => { candidat.relecture.moteur = { version: 'v1', sha256: '0'.repeat(64) }; pannes(deps); } });
    await sansSignature(sc, /moteur du candidat ≠ moteur du cœur/, 'abandon');
  });
  test('page : relecteur du candidat ≠ son référentiel archivé déclaré -> abandon', async () => {
    const sc = await scenario({ modifier: ({ candidat, deps }) => { candidat.relecture.relecteur_attribue = 'eric'; pannes(deps); } });
    await sansSignature(sc, /son référentiel archivé/, 'abandon');
  });
  test('deux clôtures antérieures aux codes distincts -> abandon', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ deps }) => { pannes(deps); deps.fs.lister = () => [`set_fonda_grandeurs-mesures_nI_02-${'a'.repeat(16)}`, `set_fonda_grandeurs-mesures_nI_02-${'b'.repeat(16)}`]; } });
    await sansSignature(sc, /2 clôtures antérieures/, 'abandon');
  });
  test('incident contenant fin_saisie_le (génération illisible) -> abandon', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ deps }) => { pannes(deps); deps.incidents = async () => [{ id: 'i1', nature: 'x', detecte_le: '2026-10-19T16:00:00.000Z', statut: 'resolu', resolu_le: '2026-10-19T18:00:00.000Z', preuve_resolution: 'ok', periode: { debut: '2026-10-19T16:00:00.000Z', fin: '2026-10-19T18:00:00.000Z' } }]; } });
    await sansSignature(sc, /recouvre/, 'abandon');
  });
  test('observation terminale sans dates reçue avant une panne -> incident', async () => {
    const sc = await scenario({ source: 'saisie_locale' });
    const base = sc.deps.api.listerExecutions;
    sc.deps.api.listerExecutions = async (q) => { if (q.workflowId === 'wfGen' && q.status === 'waiting') return [{ id: 511, workflowId: 'wfGen', status: 'success', startedAt: null, stoppedAt: null }]; if (q.workflowId === 'wfGen' && !q.status) throw new Error('timeout'); return base(q); };
    await sansSignature(sc, /terminée sans dates cohérentes/, 'incident');
  });
});

describe('critique Codex r10 : observations partielles exploitées, moteur du candidat', () => {
  const pannePartielle = (sc, wf, renvoi) => { const base = sc.deps.api.listerExecutions; sc.deps.api.listerExecutions = async (q) => { if (q.workflowId === wf && q.status === 'waiting') return renvoi; if (q.workflowId === wf && !q.status) throw new Error('timeout'); return base(q); }; };
  test('confirmation « conflit » reçue avant une panne du listing -> abandon (pas temporaire)', async () => {
    const sc = await scenario({ modifier: ({ rattachements }) => { rattachements[99] = { set_id: 'set_fonda_comprendre-consigne_nI_02', type: 'conflit', nonce: 'n99' }; } });
    pannePartielle(sc, 'wfConf', [{ id: 99, workflowId: 'wfConf', status: 'success', startedAt: '2026-10-19T17:10:00.000Z', stoppedAt: '2026-10-19T17:10:01.000Z' }]);
    await sansSignature(sc, /conflit/, 'abandon');
  });
  test('confirmation non attribuable reçue avant une panne du listing -> incident', async () => {
    const sc = await scenario();
    pannePartielle(sc, 'wfConf', [{ id: 98, workflowId: 'wfConf', status: 'success', startedAt: '2026-10-19T17:10:00.000Z', stoppedAt: '2026-10-19T17:10:01.000Z' }]);
    await sansSignature(sc, /sans données exploitables/, 'incident');
  });
  test('page : moteur du candidat hors registre, génération et décisions en panne -> abandon', async () => {
    const sc = await scenario({ modifier: ({ candidat, deps }) => { candidat.relecture.moteur = { version: 'v1', sha256: '0'.repeat(64) }; deps.api.lireExecution = async () => { throw new Error('503'); }; deps.drive.listerDecisions = async () => { throw new Error('Drive 503'); }; } });
    await sansSignature(sc, /moteur du candidat absent du registre/, 'abandon');
  });
  test('génération : observation partielle exploitée (mode manual) malgré la panne de la liste complète -> abandon', async () => {
    const sc = await scenario({ source: 'saisie_locale', modifier: ({ gen }) => { gen[501].mode = 'manual'; } });
    pannePartielle(sc, 'wfGen', [{ id: 501, workflowId: 'wfGen', status: 'success', startedAt: '2026-10-18T07:00:00.000Z', stoppedAt: '2026-10-18T07:01:00.000Z' }]);
    await sansSignature(sc, /≠ webhook/, 'abandon');
  });
});
