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
const { cloturer, saisirDecisionLocale, normaliserDate, RATTACHEMENT_SAISIE_LOCALE, analyserArgumentsCloture, cloturerSaisieLocale, main: mainCloture } = require('./signer-cloture.js');
const { preparerPublication } = require('./publier-lot.js');
const P = require('./rattachement-page.js');
const P_ADAPT = require('./adaptateurs-page.js');

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
  const setId = maths ? 'set_fonda_grandeurs-mesures_nI_92' : 'set_fonda_comprendre-consigne_nI_92';
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
  const rattachements = { 10: { set_id: setId, type: 'decision', nonce: 'n10' }, 2: { set_id: setId, type: 'decision', nonce: 'n2' }, 30: { set_id: 'set_fonda_lexique_nI_92', type: 'decision', nonce: 'nx' }, 20: { set_id: setId, type: 'cloture', nonce: null } };
  const fichiers = [
    { id: 'drv-n10', nom: `${setId}-n10.json`, modifie_le: '2026-10-19T17:00:01.500Z', properties: { fonda_set_id: setId, fonda_nonce: 'n10' }, contenu: decision('n10') },
    { id: 'drv-n2', nom: `${setId}-n2.json`, modifie_le: '2026-10-19T17:00:02.500Z', properties: { fonda_set_id: setId, fonda_nonce: 'n2' }, contenu: decision('n2') },
  ];
  // Parcours page (CDC §21, r10.9) : rattachement de TEST au contrat discriminé de rattacherPage,
  // traduit depuis la table historique `rattachements` (les cas l'altèrent comme avant). Les
  // empreintes consignées par les exécutions sont celles des décisions À LA CONSTRUCTION : une
  // altération ultérieure d'un fichier est donc une substitution observée (R1).
  const horsListing = []; // exécutions observées par un listing simulé à part (pannes partielles)
  const consignees = new Map(fichiers.map((k) => [k.contenu.nonce, P.empreinteDecision(k.contenu)]));
  const ID_CANDIDAT = 'drv-candidat';
  const anomalie = (motif) => ({ nature: 'anomalie', niveau: 'incident', set_id: null, motif });
  const rattacherTest = (detail, ctxR) => {
    // Appel à UN argument = ancien contrat (code de référence c215dd0 des tests de non-régression).
    if (ctxR === undefined) return rattachements[detail.id] || null;
    const { role, observation: x } = ctxR;
    if (detail === L.INDISPONIBLE) return { nature: 'indisponible' };
    if (detail == null) return anomalie('détail introuvable ou purgé');
    const fu = L.fusionner(x, detail, normaliserDate);
    if (fu.contradiction) return anomalie(fu.contradiction);
    const r = rattachements[x.id];
    if (!r) return anomalie('sans données exploitables');
    const obs = fu.obs;
    if (obs.status !== 'success') return { nature: 'erreur', set_id: r.set_id, obs };
    if (role === 'cloture') {
      if (r.type !== 'cloture') return anomalie('non attribuable');
      return { nature: 'cloture', set_id: r.set_id, clos_le: normaliserDate(candidat.relecture.clos_le), deja_clos: false, candidat_fichier_id: ID_CANDIDAT, nb_decisions_listees: fichiers.length, incomplete_search: false, obs };
    }
    if (r.type === 'conflit') return { nature: 'conflit', set_id: r.set_id, nonce: r.nonce, generation: 1, decision_fichier_id: `drv-${r.nonce}`, decision_sha256: `sha256:${'0'.repeat(64)}`, obs };
    if (r.type !== 'decision') return anomalie('type inattendu');
    return { nature: 'decision', set_id: r.set_id, nonce: r.nonce, generation: 1, decision_fichier_id: `drv-${r.nonce}`, decision_sha256: consignees.get(r.nonce) || `sha256:${'1'.repeat(64)}`, ecriture: 'creee', obs };
  };
  const locales = [{ nom: 'decision.json', octets: Buffer.from(`${JSON.stringify(decisionLocale, null, 2)}\n`) }];
  const journal = { schema: 'set-ids-journal/v1', lignes: [{ set_id: setId, transition: 'reserve', le: '2026-10-17', ref }] };
  const etat = { signatures: 0, ecrits: new Map(), affiche: '', heure: Date.parse('2026-10-20T09:00:00.000Z'), appels: [] };
  const deps = {
    rattachement: rattacherTest,
    api: {
      async listerExecutions({ workflowId, status }) { etat.appels.push(`lister:${workflowId}:${status || '*'}`); const t = execs[workflowId] || []; return copie(status ? t.filter((e) => e.status === status) : t.filter((e) => !['running', 'waiting'].includes(e.status))); },
      async lireExecution(id) {
        etat.appels.push(`lire:${id}`);
        if (gen[id]) return copie(gen[id]);
        // Détail d'une exécution de confirmation/clôture : métadonnées du listing + données minimales.
        const x = [...(execs.wfConf || []), ...(execs.wfClot || []), ...horsListing].find((e) => String(e.id) === String(id));
        return x ? { ...copie(x), mode: 'webhook', workflowData: { pinData: null }, data: { resultData: { runData: {} } } } : null;
      },
    },
    config: { source, workflowGeneration: 'wfGen', workflowConfirmation: 'wfConf', workflowCloture: 'wfClot', dossier: '/tmp/fonda-cloture-test', cleId: 'cle-test', modelesAutorises: [MODELE] },
    drive: {
      lireLotGenere: async () => { etat.appels.push('lot'); return lotGenere ? { ...lotGenere, octets: Buffer.from(lotGenere.octets) } : null; },
      listerCandidats: async () => { etat.appels.push('candidats'); return { incompleteSearch: false, fichiers: copie(candidats) }; },
      lireCandidat: async () => P_ADAPT.avecIdentite(copie(candidat), { id: ID_CANDIDAT, nom: `${setId}.candidat.json`, modifie_le: '2026-10-20T08:00:00.000Z' }),
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
  const ctx = { horsListing, deps, execs, gen, fx, candidats, rattachements, fichiers, locales, journal, candidat, coeur, lotRelu, lot, empreintes, decision, decisionLocale, etat,
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
  test('page_relecture avec le rattachement « poison » : refus precondition, ZÉRO signature', async () => {
    const sc = await scenario();
    sc.deps.rattachement = RATTACHEMENT_SAISIE_LOCALE;
    const err = await sansSignature(sc, /parcours page_relecture non défini/, 'precondition');
    assert.ok(err);
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
  test('page_relecture, auto-confirmation (relecteur = Éric) : publiable', async () => {
    const sc = await scenario({ maths: true });
    const { enveloppe } = await cloturer(sc.setId, sc.deps);
    assert.equal(enveloppe.charge.confirmation.mode, 'auto');
    assert.equal((await publication(sc.publie, enveloppe)).ok, true);
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
    ['set_id de la sortie ≠ demandé', sortie((s) => { s.set_id = 'set_fonda_lexique_nI_92'; }), /set_id/, 'abandon'],
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
    ['génération en cours d\'un AUTRE lot (incident global)', ({ execs, gen, fx }) => { execs.wfGen.push({ id: 506, workflowId: 'wfGen', status: 'running', startedAt: '2026-10-20T08:30:00.000Z', stoppedAt: null }); gen[506] = copie({ ...fx.doublon, id: 506, status: 'running', startedAt: '2026-10-20T08:30:00.000Z', stoppedAt: null }); gen[506].data.resultData.runData['FONDA Entree generation'][0].data.main[0][0].json.set_id = 'set_fonda_lexique_nI_92'; }, /non terminée ou de statut inconnu/, 'incident'],
    ['déclencheur au set_id vide (non attribuable)', ({ execs, gen, fx }) => { execs.wfGen.push({ id: 507, workflowId: 'wfGen', status: 'error', startedAt: fx.erreur_sans_depot.startedAt, stoppedAt: fx.erreur_sans_depot.stoppedAt }); gen[507] = copie({ ...fx.erreur_sans_depot, id: 507 }); gen[507].data.resultData.runData['FONDA Entree generation'][0].data.main[0][0].json.set_id = ''; }, /non attribuable/, 'incident'],
    ['second fichier rattaché à l\'exécution retenue (autre nom, autre set_id)', ({ candidats }) => { candidats.push({ id: 'drv-autre', nom: 'set_fonda_lexique_nI_92.lot.json', modifie_le: '2026-10-18T07:00:40.000Z', properties: { fonda_set_id: 'set_fonda_lexique_nI_92', fonda_execution_id: '501' }, proprietesLisibles: true }); }, /exécution retenue 501 : 2 fichier/, 'abandon'],
    ['workflowData tableau', ({ gen }) => { gen[501].workflowData = []; }, /workflowData absent/, 'refus'],
    ['date du listing postérieure à la génération (lectures stables)', ({ candidats }) => { candidats[0].modifie_le = '2026-10-18T07:05:00.000Z'; }, /modifié APRÈS/, 'abandon'],
    ['accès API insuffisant (403)', ({ deps }) => { deps.api.lireExecution = async () => { const e = new Error('Forbidden'); e.statut = 403; throw e; }; }, /accès insuffisant \(403\)/, 'incident'],
    ['génération active PUIS panne Drive : l\'incident l\'emporte', ({ execs, gen, fx, deps }) => { execs.wfGen.push({ id: 503, workflowId: 'wfGen', status: 'running', startedAt: '2026-10-20T08:30:00.000Z', stoppedAt: null }); gen[503] = { ...fx.doublon, id: 503, status: 'running', startedAt: '2026-10-20T08:30:00.000Z', stoppedAt: null }; deps.drive.listerCandidats = async () => { throw new Error('Drive 503'); }; }, /non terminée/, 'incident'],
  ];
});

describe('§20.5 réconciliation de lot_relu et unicité : chaque violation -> abandon', () => {
  const surLocale = (f) => ({ locales, decisionLocale }) => { const d = copie(decisionLocale); f(d); locales[0].octets = Buffer.from(JSON.stringify(d)); };
  const cas = [
    ['lot_relu.empreinte_complete ≠ lot source', surLocale((d) => { d.lot_relu.empreinte_complete = `sha256:${'0'.repeat(64)}`; }), /lot_relu.empreinte_complete/],
    ['lot_relu.set_id ≠ set_id', surLocale((d) => { d.lot_relu.set_id = 'set_fonda_lexique_nI_92'; }), /lot_relu.set_id/],
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
});

describe('configuration G5 et sources', () => {
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
});

describe('reprise sur l\'instantané EXISTANT (§20.13) et saisie locale (critique Codex r1)', () => {
});

describe('critique Codex r3 : double attestation, fusion, observations partielles, antécédents', () => {
  // Déplacement simulé du dossier du lot (archivage) : ses fichiers quittent le dossier de clôture.
  const archiver = (sc) => { for (const p of [...sc.etat.ecrits.keys()]) if (/set_fonda_[^/]+-[0-9a-f]{16}\//.test(p)) { sc.etat.ecrits.set(p.replace('/tmp/fonda-cloture-test/', '/tmp/archives/'), sc.etat.ecrits.get(p)); sc.etat.ecrits.delete(p); } };
  test('deux cœurs distincts, lecture du lot en panne -> abandon (unicité indépendante du lot)', async () => {
    const sc = await scenario({ modifier: ({ fichiers }) => { const d = fichiers[1].contenu; d.coeur.selection = d.coeur.selection.slice(1); } });
    sc.deps.drive.lireLotGenere = async () => { throw new Error('Drive 503'); };
    await sansSignature(sc, /cœurs distincts/, 'abandon');
  });
});

describe('critique Codex r4 : observateur, lectures partielles du lot', () => {
});

describe('critique Codex r5 : contenus multiples du lot, examen non exhaustif', () => {
  for (const source of ['page_relecture']) {
    test(`${source} : seconde lecture CONFORME mais modifiée -> abandon (empreinte), prioritaire sur l'instabilité`, async () => {
      const sc = await scenario({ source });
      let n = 0; const l = sc.deps.drive.lireLotGenere;
      sc.deps.drive.lireLotGenere = async (x) => { n += 1; const r = await l(x); if (n === 2) { const lot = JSON.parse(r.octets.toString('utf8')); lot.cartes[0].question += ' (modifiée)'; r.octets = Buffer.from(JSON.stringify(lot)); } return r; };
      await sansSignature(sc, /seconde lecture du lot : empreinte/, 'abandon');
    });
  }
});

describe('critique Codex r6 : génération observée malgré un examen non exhaustif', () => {
  const panne498 = (sc) => { const lire = sc.deps.api.lireExecution; sc.deps.api.lireExecution = async (id) => { if (id === '498') throw new Error('503'); return lire(id); }; };
  const avec498 = ({ execs, gen, fx }) => { execs.wfGen.push({ id: 498, workflowId: 'wfGen', status: 'error', startedAt: fx.erreur_sans_depot.startedAt, stoppedAt: fx.erreur_sans_depot.stoppedAt }); gen[498] = fx.erreur_sans_depot; };
  for (const source of ['page_relecture']) {
    test(`${source} : lot modifié après la génération + détail d'une autre exécution en panne -> abandon`, async () => {
      const sc = await scenario({ source, modifier: (ctx) => { avec498(ctx); ctx.setLotGenere({ modifie_le: '2026-10-18T07:02:00.000Z' }); ctx.candidats[0].modifie_le = '2026-10-18T07:02:00.000Z'; } });
      panne498(sc);
      await sansSignature(sc, /modifié APRÈS/, 'abandon');
    });
  }
});

describe('critique Codex r7 : dates du listing Drive sans lecture du contenu', () => {
  for (const source of ['page_relecture']) {
    test(`${source} : listing daté APRÈS la génération, deux lectures du lot en panne -> abandon`, async () => {
      const sc = await scenario({ source, modifier: ({ candidats, deps }) => { candidats[0].modifie_le = '2026-10-18T07:02:00.000Z'; deps.drive.lireLotGenere = async () => { throw new Error('Drive 503'); }; } });
      await sansSignature(sc, /modifié APRÈS/, 'abandon');
    });
  }
});

describe('audit préventif : contrôles sans lot source lu (empreintes de la génération)', () => {
  test('page : lot de l\'enveloppe ≠ génération, lectures du lot en panne -> abandon', async () => {
    const sc = await scenario({ modifier: ({ candidat, deps }) => { candidat.lot.cartes[0].question += ' (modifiée)'; deps.drive.lireLotGenere = async () => { throw new Error('Drive 503'); }; } });
    await sansSignature(sc, /≠ lot généré/, 'abandon');
  });
});

describe('critique Codex r8 : identité du fichier effectivement lu', () => {
});

describe('§20.13 amendement r6 : règle d\'observation incomplète', () => {
});

describe('critique Codex r9 : garde-fou 1 — contrôles intrinsèques des décisions sans référence', () => {
  const pannes = (deps) => { deps.drive.lireLotGenere = async () => { throw new Error('Drive 503'); }; deps.api.lireExecution = async () => { throw new Error('503'); }; };
  for (const [libelle, f, motif] of [
    ['lot_relu.set_id ≠ set_id', (d) => { d.lot_relu.set_id = 'set_fonda_lexique_nI_92'; }, /lot_relu.set_id/],
    ['choix interdit', (d) => { d.lot_relu.cartes[0].choix = 'peut-etre'; }, /choix ∉/],
    ['selection incohérente avec les « garder »', (d) => { d.coeur.selection = d.coeur.selection.slice(1); }, /coeur.selection ≠ cartes « garder »/],
  ]) {
    test(`page : ${libelle}, lot ET génération illisibles -> abandon`, async () => {
      const sc = await scenario({ modifier: ({ fichiers, deps }) => { for (const x of fichiers) f(x.contenu); pannes(deps); } });
      await sansSignature(sc, motif, 'abandon');
    });
  }
});

describe('garde-fou 1 (§20.13 r6) : contrôles déterminables malgré une lecture en panne', () => {
  const pannes = (deps) => { deps.drive.lireLotGenere = async () => { throw new Error('Drive 503'); }; deps.api.lireExecution = async () => { throw new Error('503'); }; };
  test('page : moteur du candidat ≠ moteur du cœur -> abandon', async () => {
    const sc = await scenario({ modifier: ({ candidat, deps }) => { candidat.relecture.moteur = { version: 'v1', sha256: '0'.repeat(64) }; pannes(deps); } });
    await sansSignature(sc, /moteur du candidat ≠ moteur du cœur/, 'abandon');
  });
  test('page : relecteur du candidat ≠ son référentiel archivé déclaré -> abandon', async () => {
    const sc = await scenario({ modifier: ({ candidat, deps }) => { candidat.relecture.relecteur_attribue = 'eric'; pannes(deps); } });
    await sansSignature(sc, /son référentiel archivé/, 'abandon');
  });
});

describe('critique Codex r10 : observations partielles exploitées, moteur du candidat', () => {
  const pannePartielle = (sc, wf, renvoi) => { sc.horsListing.push(...renvoi); const base = sc.deps.api.listerExecutions; sc.deps.api.listerExecutions = async (q) => { if (q.workflowId === wf && q.status === 'waiting') return renvoi; if (q.workflowId === wf && !q.status) throw new Error('timeout'); return base(q); }; };
  test('confirmation « conflit » reçue avant une panne du listing -> abandon (pas temporaire)', async () => {
    const sc = await scenario({ modifier: ({ rattachements }) => { rattachements[99] = { set_id: 'set_fonda_comprendre-consigne_nI_92', type: 'conflit', nonce: 'n99' }; } });
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
});

// ═══ CDC r9 (plan r6) : relecteur de SECOURS en intérim — saisie S1/S2, clôture C1–C3, charge v3 ═══
// Lot de FRANÇAIS (relecteur attribué « justine » dans le référentiel archivé) en saisie locale ;
// autorisation = fonda/data/relecture-interim.json observé sur design (observation SIMULÉE, SHA
// figé) ; archive historique simulée (aCommit). Pour CHAQUE refus : signataire jamais appelé.
const I = require('./interim.js');
const SC2 = require('./signer-cloture.js');
// FIXTURE de test (jamais l'entrée réelle de fonda/data : son retrait ne doit pas casser la CI).
const FICHIER_INTERIM = require('./fixtures/relecture-interim.json');
const OCT_CAL = fsN.readFileSync(path.join(__dirname, '../data/calendar.json'));
const OCT_DEST = fsN.readFileSync(path.join(__dirname, '../data/destinataires.json'));
const SHA_DESIGN = 'd'.repeat(40);
const octetsJson = (o) => Buffer.from(`${JSON.stringify(o, null, 2)}\n`);
const versionInterim = (f) => `sha256:${crypto.createHash('sha256').update(octetsJson(f)).digest('hex')}`;
const BADGE_SECOURS = { forme: 'relue_par_secours', nom_affiche: 'Éric Duchateau', id: 'eric', titulaire: { id: 'justine', nom_affiche: 'Justine Leblanc' } };

// x.observer(etatI, n) : observation n (1, 2, …) ; défaut = état courant de etatI.
async function scenarioInterim(x = {}) {
  const sc = await scenario({ source: 'page_relecture' }); // lot de français (justine)
  sc.deps.config.source = 'saisie_locale';
  sc.etat.heure = Date.parse(x.heure || '2026-11-05T09:00:00.000Z');
  const fichier = copie(FICHIER_INTERIM);
  const etatI = { fichier, destinataires: JSON.parse(OCT_DEST.toString('utf8')), sha: SHA_DESIGN, n: 0, historique: new Map() };
  const observation = () => ({ sha: etatI.sha, octetsInterim: octetsJson(etatI.fichier), octetsCalendrier: OCT_CAL, octetsDestinataires: octetsJson(etatI.destinataires) });
  etatI.historique.set(SHA_DESIGN, { octetsInterim: octetsJson(fichier), octetsCalendrier: OCT_CAL });
  sc.deps.interim = {
    observer: async () => { etatI.n += 1; if (x.observer) x.observer(etatI, etatI.n); if (etatI.panne) throw new Error('git fetch : réseau'); return observation(); },
    aCommit: (c) => (etatI.historique.has(c) ? { surPremierParent: true, ...etatI.historique.get(c) } : { surPremierParent: false }),
  };
  const decisionV2 = { schema: 'decision-fonda/v2', set_id: sc.setId, generation: 0, nonce: 'f3a9c0d1e2b4a5c6', recu_le: x.recuLe || '2026-11-04T17:00:01.000Z',
    coeur: copie(sc.coeur), lot_relu: copie(sc.lotRelu), hash_formulaire: 'saisie-locale', relecture_interim: I.blocDecision(fichier.entrees[0], versionInterim(fichier), SHA_DESIGN) };
  const locales = [{ nom: 'decision.json', octets: octetsJson(decisionV2) }];
  sc.deps.decisionsLocales = async () => locales.map((f) => ({ nom: f.nom, octets: Buffer.from(f.octets) }));
  const resoudreInterim = (v) => {
    for (const [, h] of etatI.historique) if (`sha256:${crypto.createHash('sha256').update(h.octetsInterim).digest('hex')}` === v) return { ok: true, octets: h.octetsInterim };
    return { ok: false, raison: 'introuvable' };
  };
  const out = { ...sc, etatI, decisionV2, locales, resoudreInterim };
  if (x.modifier) await x.modifier(out);
  return out;
}
const marqueurEcrit = (sc) => [...sc.etat.ecrits.keys()].some((p) => p.endsWith('.signature'));

describe('intérim (CDC r9) : clôture en saisie locale d\'une notion routée « justine »', () => {
  test('décision v2 injectée dans le parcours PAGE -> refus (v1 seule admissible), zéro signature', async () => {
    const sc = await scenario();
    sc.fichiers[0].contenu = { ...sc.fichiers[0].contenu, schema: 'decision-fonda/v2', relecture_interim: I.blocDecision(FICHIER_INTERIM.entrees[0], versionInterim(FICHIER_INTERIM), SHA_DESIGN) };
    await sansSignature(sc, /non conforme/);
    assert.equal(SC2.admissible(true, 'justine', 'decision-fonda/v2'), false);
  });
});

describe('intérim (CDC r9) : saisie locale S1/S2 d\'une notion routée « justine »', () => {
  const depsSaisie = async (x = {}) => {
    const sc = await scenarioInterim(x);
    const reponses = [...sc.lotRelu.cartes.map((c) => c.choix), 'oui'];
    return { sc, deps: { ...sc.deps, moteur: { ...MOTEUR }, aleatoire: () => 'nonce-test-0002', saisir: async () => reponses.shift() } };
  };
});

// ═══ Non-régression v1/v2 contre le code d'AVANT l'intérim (design c215dd0, extrait par git archive) ═══
describe('non-régression : parcours v1/v2 et vérificateur IDENTIQUES au code d\'avant l\'intérim (c215dd0)', () => {
  const AVANT = 'c215dd035ed865e7c66ff8e139ac42419d201b19';
  const racine = path.join(__dirname, '..', '..');
  const dir = fsN.mkdtempSync(path.join(require('os').tmpdir(), 'fonda-avant-interim-'));
  require('child_process').execFileSync('sh', ['-c', `git archive ${AVANT} fonda | tar -x -C "${dir}"`], { cwd: racine });
  const ANCIEN_SC = require(path.join(dir, 'fonda/scripts/signer-cloture.js'));
  const ANCIEN_S = require(path.join(dir, 'fonda/scripts/attestation-signee.js'));
  const hexEcrits = (sc) => [...sc.etat.ecrits.entries()].map(([p, o]) => [p, o.toString('hex')]).sort();
  for (const [nom, x] of [['saisie locale (eric, auto)', { source: 'saisie_locale' }], ['page (tiers, réponse au message)', {}], ['page (eric, auto)', { maths: true }]]) {
    test(`clôture ${nom} : charge, signature, instantané v1, export et récapitulatif identiques OCTET POUR OCTET`, async () => {
      const a = await scenario(x);
      const b = await scenario(x);
      const ra = await ANCIEN_SC.cloturer(a.setId, a.deps);
      const rb = await cloturer(b.setId, b.deps);
      assert.deepEqual(rb.enveloppe, ra.enveloppe);
      assert.deepEqual(hexEcrits(b), hexEcrits(a));
      assert.match([...b.etat.ecrits.entries()].find(([p]) => p.endsWith('instantane.json'))[1].toString('utf8'), /"schema": "instantane-fonda\/v1"/);
    });
  }
  test('vérificateur : invariantsValeur / invariantsDepot / verifierAttestationSignee IDENTIQUES sur des centaines de charges v1/v2 MUTÉES', async () => {
    const valeurs = [null, '', ' ', 'x', 0, -1, 1.5, true, false, {}, [], 'auto', 'vive_voix', 'eric', 'justine', 'saisie_locale', 'page_relecture', '2026-10-20T09:00:00.000Z',
      '2026-10-20T09:00:00Z', 'relue_par', 'relue_et_validee', 'relue_par_secours', 'un professeur', 'attestation-cloture/v1', 'attestation-cloture/v2', `sha256:${'a'.repeat(64)}`];
    const charges = [];
    for (const x of [{ source: 'saisie_locale' }, {}, { maths: true }]) {
      const sc = await scenario(x);
      charges.push({ ch: (await cloturer(sc.setId, sc.deps)).enveloppe.charge, sc });
    }
    // VRAIES charges v1 : vecteurs positifs figés (auto, tiers avec levées/incidents, badge sans
    // nom), clé de test substituée pour être resignées.
    const VEC = require('../engine/canonique-vecteurs.json').vecteurs;
    for (const id of ['attestation-auto-nominale', 'attestation-tiers-levees-incidents', 'attestation-badge-sans-nom']) {
      charges.push({ ch: { ...copie(VEC.find((v) => v.id === id).entree), cle_id: 'cle-test' } });
    }
    assert.deepEqual(charges.map((c) => c.ch.schema), ['attestation-cloture/v2', 'attestation-cloture/v2', 'attestation-cloture/v2', 'attestation-cloture/v1', 'attestation-cloture/v1', 'attestation-cloture/v1']);
    const sous = ['confirmation', 'fidelite_transmission', 'generation', 'badge', 'coeur', 'execution_cloture'];
    const mutants = [];
    for (const { ch } of charges) {
      for (const k of Object.keys(ch)) for (const v of valeurs) mutants.push({ ...copie(ch), [k]: copie(v) });
      for (const s of sous) if (ch[s]) for (const k of Object.keys(ch[s])) for (const v of valeurs) mutants.push({ ...copie(ch), [s]: { ...copie(ch[s]), [k]: copie(v) } });
      mutants.push({ ...copie(ch), badge: { ...ch.badge, titulaire: { id: 'justine', nom_affiche: 'Justine Leblanc' } } });
    }
    const issue = (f) => { try { return { r: f() }; } catch (e) { return { e: e.message }; } };
    const n = { 'attestation-cloture/v1': 0, 'attestation-cloture/v2': 0 };
    for (const m of mutants) {
      if (m.schema === 'attestation-cloture/v3') continue; // liste fermée ÉTENDUE (v3) : hors comparaison
      const opts = { modelesAutorises: [MODELE] };
      const entree = { set_id: m.set_id, notion_id: m.notion_id, palier: m.palier, item_ids: m.coeur && m.coeur.selection, empreinte: m.coeur && m.coeur.empreinte_publiee, moteur: m.moteur, relecteur: m.badge };
      // Invariants comparés sur les charges que le vérificateur ÉVALUE réellement (forme
      // canonique valide pour leur schéma) ; la vérification complète, elle, sur TOUTES.
      if (issue(() => require('../engine/canonique.js').octetsContrat(m.schema, m)).r) {
        assert.deepEqual(issue(() => S.invariantsValeur(m, opts)), issue(() => ANCIEN_S.invariantsValeur(m, opts)), JSON.stringify(m).slice(0, 200));
        assert.deepEqual(issue(() => S.invariantsDepot(m, { entree, registre: REGISTRE, referentiel: REFERENTIEL })), issue(() => ANCIEN_S.invariantsDepot(m, { entree, registre: REGISTRE, referentiel: REFERENTIEL })));
        n[m.schema] += 1;
      }
      let env;
      try { env = { type: 'cloture-signee', charge: m, signature: crypto.sign('sha256', Buffer.from(require('../engine/canonique.js').octetsContrat(m.schema, m)), { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }).toString('base64') }; } catch { env = { type: 'cloture-signee', charge: m, signature: 'QUJD' }; }
      // Seul écart admis : le libellé de la liste FERMÉE des schémas, étendue à v3.
      const neuf = S.verifierAttestationSignee(env, { entree, registre: REGISTRE, referentiel: REFERENTIEL, cles: CLES, ...opts }).map((x) => x.replace(' | attestation-cloture/v3 attendu', ' attendu'));
      assert.deepEqual(neuf, ANCIEN_S.verifierAttestationSignee(env, { entree, registre: REGISTRE, referentiel: REFERENTIEL, cles: CLES, ...opts }));
    }
    // Comptes SÉPARÉS des charges de forme canonique valide, comparées invariant par invariant.
    assert.ok(mutants.length > 7000, `${mutants.length} charges mutées vérifiées`);
    assert.ok(n['attestation-cloture/v1'] > 1000, `${n['attestation-cloture/v1']} charges v1 de forme valide`);
    assert.ok(n['attestation-cloture/v2'] > 1500, `${n['attestation-cloture/v2']} charges v2 de forme valide`);
  });
});

// ═══ Pièces SIGNÉES d'une charge v3 : verifierPieces (extraction, diagnostic axe I, témoin) ═══
describe('intérim (CDC r9) : pièces signées v3 — liaison complète, jamais plus laxiste que le signataire', () => {
  const A = require('./adaptateurs-production.js');
  const CLI = require('./signataire-cli.js');
  const D = require('./diagnostic-fonda.js');
  const Canon = require('../engine/canonique.js');
  const os = require('os');
  const signer = (ch) => crypto.sign('sha256', Buffer.from(Canon.octetsContrat(ch.schema, ch)), { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }).toString('base64');
  const shaDec = (d) => `sha256:${crypto.createHash('sha256').update(Buffer.from(Canon.octetsContrat('decision-fonda/v2', d))).digest('hex')}`;
  let base; // { sc, inst, charge, dossier }
  const monter = async () => {
    if (base) return base;
    const sc = await scenarioInterim();
    const { enveloppe } = await cloturer(sc.setId, sc.deps);
    const inst = JSON.parse([...sc.etat.ecrits.entries()].find(([p]) => p.endsWith('instantane.json'))[1].toString('utf8'));
    base = { sc, inst, charge: enveloppe.charge, enveloppe };
    return base;
  };
  // Écrit un dossier de lot COHÉRENT avec la charge (chemin canonique, sha256_instantane, code), resigné.
  const ecrire = (dossier, inst, charge) => {
    const texte = `${JSON.stringify(inst, null, 2)}\n`;
    const shaI = crypto.createHash('sha256').update(Buffer.from(texte, 'utf8')).digest('hex');
    const ch = { ...charge, sha256_instantane: shaI, code_confirmation: shaI.slice(0, 16) };
    const dl = path.join(dossier, `${ch.set_id}-${ch.code_confirmation}`);
    fsN.mkdirSync(dl, { recursive: true });
    fsN.writeFileSync(path.join(dl, 'instantane.json'), texte);
    fsN.writeFileSync(path.join(dl, 'attestation.json'), `${JSON.stringify({ type: 'cloture-signee', charge: ch, signature: signer(ch) }, null, 2)}\n`);
    fsN.writeFileSync(path.join(dossier, `${ch.set_id}.signature`), '{}\n');
    return dl;
  };
  const deps = (b) => ({ cles: CLES, registre: REGISTRE, modelesAutorises: [MODELE], resoudre: () => ({ ok: true, referentiel: REFERENTIEL }), resoudreInterim: b.sc.resoudreInterim, aCommit: b.sc.deps.interim.aCommit });
  const verifier = (b, dl) => A.verifierPieces(dl, deps(b), b.sc.setId);
  const tmp = () => fsN.mkdtempSync(path.join(os.tmpdir(), 'fonda-pieces-v3-'));

  const avecDecision = (inst, modifier) => { const i = copie(inst); modifier(i.decision); i.decision_sha256 = shaDec(i.decision); i.relecture_interim = copie(i.decision.relecture_interim); return i; };
  const cas = [
    ['set_id (décision)', (i) => avecDecision(i, (d) => { d.set_id = 'set_fonda_comprendre-consigne_nI_93'; d.lot_relu.set_id = d.set_id; }), null, /set_id décision \/ instantané \/ charge/],
    ['cœur (décision)', (i) => avecDecision(i, (d) => { d.coeur.empreinte_relue = `sha256:${'0'.repeat(64)}`; }), null, /cœur de la décision/],
    ['lot_relu (décision)', (i) => avecDecision(i, (d) => { d.lot_relu.cartes[0].choix = d.lot_relu.cartes[0].choix === 'garder' ? 'ecarter' : 'garder'; }), null, /lot_relu de la décision/],
    ['decision_sha256', (i) => ({ ...copie(i), decision_sha256: `sha256:${'0'.repeat(64)}` }), null, /decision_sha256/],
    ...I.CHAMPS_DECISION.map((k) => [`bloc d'intérim de l'instantané (${k} seul)`, (i) => { const j = copie(i); j.relecture_interim[k] = k === 'source_commit' ? 'e'.repeat(40) : k === 'source_version' ? `sha256:${'1'.repeat(64)}` : `${j.relecture_interim[k]}x`; return j; }, null, /bloc d'intérim ≠ bloc de la décision/]),
    ['décision non réconciliable avec candidat_lot', (i) => { const j = avecDecision(i, (d) => { d.lot_relu.empreinte_complete = `sha256:${'2'.repeat(64)}`; }); j.lot_relu = copie(j.decision.lot_relu); return j; }, null, /non réconciliable/],
    ['provenance : commit de la décision hors chaîne', (i) => avecDecision(i, (d) => { d.relecture_interim.source_commit = 'e'.repeat(40); }), null, /hors de la chaîne de confiance/],
    ['champs métier instantané ≠ charge', (i) => i, (c) => ({ ...c, relecture_interim: { ...c.relecture_interim, motif: 'Autre.' } }), /champs métier de l'intérim ≠ charge/],
    ['recu_le ≠ fin_saisie_le', (i) => i, (c) => ({ ...c, fin_saisie_le: '2026-11-04T17:00:02.000Z' }), /recu_le ≠ charge\.fin_saisie_le/],
    ['charge v3 avec instantané v1', (i) => ({ ...copie(i), schema: 'instantane-fonda/v1' }), null, /v3 ⇔ instantane-fonda\/v2/],
  ];
  // Sources minimales du diagnostic : seules les pièces locales sont lisibles ; le fichier
  // d'intérim de la TÊTE est absent (observer en échec) — l'axe I ne doit pas en dépendre.
  const sourcesDiagnostic = (dossier, v, observer = async () => { throw new Error('fonda/data/relecture-interim.json absent de la tête'); }) => {
    const ko = async () => { throw new Error('hors ligne'); };
    return { dossier, verifier: v, interim: { actualiser: async () => ({ sha: SHA_DESIGN }), observer }, aCommit: () => ({ surPremierParent: false }),
      drive: { lireLotGenere: ko, listerCandidats: ko }, api: { listerExecutions: ko, lireExecution: ko }, workflowGeneration: 'wf', incidents: async () => [],
      decisionsLocales: async () => [], horloge: () => new Date('2027-01-10T10:00:00.000Z') };
  };
});

// ═══ Diagnostic COMPLET sur des pièces RÉELLEMENT signées (rapprochement, relecteur, autorisation) ═══
// Lot SIGNÉ (tous lots) : reste « signe », jamais « pret_pour_cloture » ; décision locale abîmée
// après signature -> problemes_courants, jamais une anomalie qui masquerait « signe ».
describe('diagnostic : lot signé (eric/v1 ET intérim/v3) — « signe » conservé, problèmes courants à part', () => {
  const A = require('./adaptateurs-production.js');
  const D = require('./diagnostic-fonda.js');
  const os = require('os');
  // Écrit les pièces produites par cloturer (fs simulé) dans un VRAI dossier, initialisé.
  const deposer = (sc) => {
    const dossier = fsN.mkdtempSync(path.join(os.tmpdir(), 'fonda-diag-signe-'));
    for (const [p, o] of sc.etat.ecrits) {
      const cible = path.join(dossier, path.relative('/tmp/fonda-cloture-test', p));
      fsN.mkdirSync(path.dirname(cible), { recursive: true });
      fsN.writeFileSync(cible, o);
    }
    fsN.writeFileSync(path.join(dossier, '.initialise'), '{}\n');
    return dossier;
  };
  const sources = (sc, dossier, { decisions, horloge, observer }) => ({
    dossier,
    verifier: (dl, setId) => A.verifierPieces(dl, { cles: CLES, registre: REGISTRE, modelesAutorises: [MODELE], resoudre: () => ({ ok: true, referentiel: REFERENTIEL }),
      resoudreInterim: sc.resoudreInterim, aCommit: sc.deps.interim ? sc.deps.interim.aCommit : () => ({ surPremierParent: false }) }, setId),
    interim: { actualiser: async () => ({ sha: SHA_DESIGN }), observer }, aCommit: sc.deps.interim ? sc.deps.interim.aCommit : () => ({ surPremierParent: false }),
    drive: sc.deps.drive, api: sc.deps.api, workflowGeneration: 'wfGen', journal: sc.deps.journal, referentielArchive: sc.deps.referentielArchive,
    registre: REGISTRE, modelesAutorises: [MODELE], incidents: async () => [], decisionsLocales: async () => decisions.map((o) => ({ nom: 'decision.json', octets: o })), horloge,
  });
  const etats = (d) => d.applicables.map((x) => x.etat);

});

// ═══ Bout en bout avec le VRAI rattacherPage (correction P1, cause racine) ═══
// Détails d'exécution n8n RÉALISTES (nœuds d'entrée, d'écriture et de sortie du §21.1), nonces
// 32 hex, fichiers et sorties fixés INDÉPENDAMMENT : aucune fabrication de résultat métier.
const NA = 'a'.repeat(32); const NB = 'b'.repeat(32); const NC = 'c'.repeat(32);
const runN = (json) => [{ data: { main: [[{ json }]] } }];
function detailReel(x, role, s, { entree, ecrit = true } = {}) {
  const runData = role === 'cloture'
    ? { 'FONDA Entree cloture': runN(entree || { set_id: s.set_id }), ...(ecrit ? { 'FONDA Ecrire candidat clos': runN({}) } : {}), 'FONDA Sortie cloture': runN({ schema: 'cloture-fonda/v1', ...s }) }
    : { 'FONDA Entree confirmation': runN(entree || { lot: s.set_id, nonce: s.nonce }), ...(ecrit ? { 'FONDA Ecrire decision': runN({}) } : {}), 'FONDA Sortie confirmation': runN({ schema: 'confirmation-fonda/v1', ...s }) };
  return { ...copie(x), id: String(x.id), mode: 'webhook', workflowData: { pinData: null }, data: { resultData: { runData } } };
}
async function scenarioReel(x = {}) {
  return scenario({ ...x, modifier: async (ctx) => {
    const { setId } = await (async () => ({ setId: ctx.candidat.lot.set_id }))();
    const gen = x.generation || 1;
    ctx.candidat.relecture.generation_cle = gen;
    const dec = (n) => ({ ...ctx.decision(n), generation: gen });
    ctx.fichiers.length = 0;
    for (const n of [NA, NB]) ctx.fichiers.push({ id: `drv-${n.slice(0, 4)}`, nom: `${setId}-${n}.json`, modifie_le: '2026-10-19T17:00:01.500Z', properties: { fonda_set_id: setId, fonda_nonce: n }, contenu: dec(n) });
    const sortieDecision = (n, o = {}) => ({ type: 'decision', set_id: setId, nonce: n, generation: gen, decision_fichier_id: `drv-${n.slice(0, 4)}`, decision_sha256: P.empreinteDecision(dec(n)), ecriture: 'creee', motif: null, ...o });
    const specs = {
      10: ['confirmation', sortieDecision(NA)], 2: ['confirmation', sortieDecision(NB)],
      30: ['confirmation', { type: 'decision', set_id: 'set_fonda_lexique_nI_92', nonce: NC, generation: 1, decision_fichier_id: 'drv-autre', decision_sha256: `sha256:${'9'.repeat(64)}`, ecriture: 'creee', motif: null }],
      20: ['cloture', { set_id: setId, clos_le: '2026-10-20T07:59:00.000Z', deja_clos: false, candidat_fichier_id: 'drv-candidat', nb_decisions_listees: 2, incomplete_search: false }],
    };
    const options = {};
    ctx.reel = { specs, options, setId, sortieDecision, dec };
    if (x.reel) await x.reel(ctx);
    ctx.deps.rattachement = P.rattacherPage;
    const base = ctx.deps.api.lireExecution;
    ctx.deps.api.lireExecution = async (id) => {
      const sp = specs[id];
      if (!sp) return base(id);
      const obs = [...ctx.execs.wfConf, ...ctx.execs.wfClot].find((e) => String(e.id) === String(id));
      return detailReel(obs, sp[0], sp[1], options[id] || {});
    };
    if (x.modifier) await x.modifier(ctx);
  } });
}
const signe = async (sc) => { const r = await cloturer(sc.setId, sc.deps); assert.equal(sc.etat.signatures, 1); return r; };

describe('bout en bout : vrai rattacherPage, sorties et fichiers indépendants (correction P1)', () => {
  test('nominal (tiers, réponse au message) : signé', async () => { await signe(await scenarioReel()); });
  test('POINT 0 VERROUILLÉ : sortie nonce B mais decision_sha256 et id du fichier nonce A -> abandon, zéro signature', async () => {
    // Cas exact de la relecture : UN seul fichier (nonce A), désigné correctement par l'exécution 10 ;
    // l'exécution 2 rapporte le nonce B (entrée cohérente) avec l'id et l'empreinte du fichier A.
    // L'ancien rapprochement (id + empreinte) signait ; le tuple complet abandonne.
    const sc = await scenarioReel({ modifier: ({ fichiers, reel }) => {
      fichiers.splice(1);
      reel.specs[2] = ['confirmation', reel.sortieDecision(NB, { decision_fichier_id: `drv-${NA.slice(0, 4)}`, decision_sha256: P.empreinteDecision(reel.dec(NA)) })];
    } });
    await sansSignature(sc, /substituée/, 'abandon');
  });
  test('rejet C1 supplémentaire (lot illisible) : inoffensif -> signé', async () => {
    await signe(await scenarioReel({ modifier: ({ execs, reel }) => {
      execs.wfConf.push({ id: 41, workflowId: 'wfConf', status: 'success', startedAt: '2026-10-19T16:30:00.000Z', stoppedAt: '2026-10-19T16:30:01.000Z' });
      reel.specs[41] = ['confirmation', { type: 'rejet', set_id: null, nonce: null, generation: null, decision_fichier_id: null, decision_sha256: null, ecriture: null, motif: 'C1' }];
      reel.options[41] = { entree: { lot: null, nonce: null }, ecrit: false };
    } }));
  });
  test('arrêt au timeout (canceled) d\'une confirmation du lot, entrée lisible -> abandon', async () => {
    const sc = await scenarioReel({ modifier: ({ execs, reel }) => {
      execs.wfConf.push({ id: 42, workflowId: 'wfConf', status: 'canceled', startedAt: '2026-10-19T16:40:00.000Z', stoppedAt: '2026-10-19T16:42:00.000Z' });
      reel.specs[42] = ['confirmation', reel.sortieDecision(NC)];
    } });
    await sansSignature(sc, /blocage dur/, 'abandon');
  });
  test('clôture répétée (deja_clos, même clos_le) : la plus récente retenue -> signé', async () => {
    await signe(await scenarioReel({ modifier: ({ execs, reel }) => {
      execs.wfClot.push({ id: 24, workflowId: 'wfClot', status: 'success', startedAt: '2026-10-20T08:10:00.000Z', stoppedAt: '2026-10-20T08:11:00.000Z' });
      reel.specs[24] = ['cloture', { ...reel.specs[20][1], deja_clos: true }];
      reel.options[24] = { ecrit: false };
    } }));
  });
  test('réémission en génération 2, entièrement cohérente -> signé', async () => { await signe(await scenarioReel({ generation: 2 })); });
  test('item 2 : deux clôtures du lot aux clos_le et candidat_fichier_id divergents, candidat en PANNE -> abandon, zéro signature', async () => {
    const sc = await scenarioReel({ modifier: ({ execs, reel, deps }) => {
      execs.wfClot.push({ id: 25, workflowId: 'wfClot', status: 'success', startedAt: '2026-10-20T08:10:00.000Z', stoppedAt: '2026-10-20T08:11:00.000Z' });
      reel.specs[25] = ['cloture', { ...reel.specs[20][1], clos_le: '2026-10-20T08:09:00.000Z', candidat_fichier_id: 'drv-autre-candidat' }];
      deps.drive.lireCandidat = async () => { throw new Error('Drive injoignable'); };
    } });
    await sansSignature(sc, /contradictoires entre elles/, 'abandon');
  });
  test('candidat « abandonne » -> abandon, zéro signature', async () => {
    await sansSignature(await scenarioReel({ modifier: ({ candidat }) => { candidat.relecture.statut = 'abandonne'; } }), /abandonne/, 'abandon');
  });
  test('candidat « en_attente » (clos_le null) -> refus temporaire, pas d\'incident', async () => {
    await sansSignature(await scenarioReel({ modifier: ({ candidat }) => { candidat.relecture.statut = 'en_attente'; candidat.relecture.clos_le = null; } }), /en_attente/, 'temporaire');
  });
});
