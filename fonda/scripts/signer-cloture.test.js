// Tests de fonda/scripts/signer-cloture.js — clôture signée locale (CDC §3, §5, §9-§11).
// Clés RSA 3072 ÉPHÉMÈRES et réponses n8n SYNTHÉTIQUES ; le rattachement exécution <->
// lot est un rattachement « de test » (le vrai contrat appartient au chantier des
// workflows ; sans lui, le script refuse — premier test).
// Usage : node --test fonda/scripts/signer-cloture.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const fsN = require('fs');
const C = require('../engine/catalogue.js');
const S = require('./attestation-signee.js');
const { cloturer, normaliserDate } = require('./signer-cloture.js');
const { preparerPublication } = require('./publier-lot.js');

const REGISTRE = require('../engine/moteurs.json');
const MOTEUR = { version: 'v1', sha256: REGISTRE[0].sha256 };
const OCTETS_REF = fsN.readFileSync(path.join(__dirname, '../data/referentiel.json'));
const REF_VERSION = `sha256:${crypto.createHash('sha256').update(OCTETS_REF).digest('hex')}`;
const REFERENTIEL = JSON.parse(OCTETS_REF.toString('utf8'));
const CATALOGUE = require('../data/catalogue-fonda.json');
const copie = (o) => JSON.parse(JSON.stringify(o));
const sha = C.sha256WebCrypto();

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' });
const CLES = S.chargerCles([{ cle_id: 'cle-test', fichier: 'cles/cle-test.pem', sha256_pem: crypto.createHash('sha256').update(PEM).digest('hex'), algorithme: 'RSA-SHA256-PKCS1v15', valide_du: '2026-01-01T00:00:00.000Z', valide_au: '2027-12-31T00:00:00.000Z', revoquee_le: null }], () => PEM);

function candidatLot(source, setId) {
  const l = copie(require(`../data/lots/${source}.json`));
  l.set_id = setId;
  l.revue_carte_par_carte = false;
  l.cartes.forEach((c) => { c.set_id = setId; });
  return l;
}

// Scénario complet ; `x` modifie n'importe quelle partie.
async function scenario(x = {}) {
  const fr = !x.maths;
  const setId = fr ? 'set_fonda_comprendre-consigne_nI_02' : 'set_fonda_grandeurs-mesures_nI_02';
  const lot = candidatLot(fr ? 'set_fonda_comprendre-consigne_nI_01' : 'set_fonda_grandeurs-mesures_nI_01', setId);
  const ids = lot.cartes.map((c) => c.item_id);
  const coeur = { action: 'accepter', selection: ids.slice(0, -1), ecartees: ids.slice(-1), empreinte_relue: await C.calculerEmpreinte(lot, sha), empreinte_publiee: '', moteur: { ...MOTEUR } };
  const garde = new Set(coeur.selection);
  const publie = { ...lot, revue_carte_par_carte: true, cartes: lot.cartes.filter((c) => garde.has(c.item_id)) };
  publie.nb_cartes = publie.cartes.length;
  coeur.empreinte_publiee = await C.calculerEmpreinte(publie, sha);
  const relecteur = fr ? 'justine' : 'eric';
  const candidat = { schema: 'candidat-fonda/v1', lot, relecture: { statut: 'clos', generation_cle: 1, cle_sha256: 'a'.repeat(64), cree_le: '2026-10-18T08:00:00.000Z', expire_le: '2026-11-01T08:00:00.000Z', clos_le: '2026-10-20T07:59:00.000Z', relecteur_attribue: relecteur, referentiel_version: REF_VERSION, moteur: { ...MOTEUR }, envois: [] } };
  const decision = (nonce) => ({ schema: 'decision-fonda/v1', set_id: setId, generation: 1, nonce, recu_le: '2026-10-19T17:00:01.000Z', coeur: copie(coeur), lot_relu: { item_ids: ids }, hash_formulaire: 'h' });
  const execs = {
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
  const etat = { signatures: 0, ecrits: new Map(), affiche: '', heure: Date.parse('2026-10-20T09:00:00.000Z') };
  const deps = {
    rattachement: (e) => rattachements[e.id] || null,
    api: { async listerExecutions({ workflowId, status }) { const t = execs[workflowId] || []; return copie(status ? t.filter((e) => e.status === status) : t.filter((e) => !['running', 'waiting'].includes(e.status))); } },
    config: { workflowConfirmation: 'wfConf', workflowCloture: 'wfClot', dossier: '/tmp/fonda-cloture-test', cleId: 'cle-test' },
    drive: { lireCandidat: async () => copie(candidat), listerDecisions: async () => ({ incompleteSearch: false, fichiers: copie(fichiers) }) },
    incidents: async () => [],
    referentielArchive: async () => OCTETS_REF,
    tableRelecteurs: { justine: 'Relectrice de test' },
    fs: {
      ecrireExclusif(p, t) { if (etat.ecrits.has(p)) throw new Error('existe déjà'); etat.ecrits.set(p, Buffer.from(t, 'utf8')); },
      lire(p) { if (!etat.ecrits.has(p)) throw new Error('absent'); return etat.ecrits.get(p); },
    },
    signer: (octets) => { etat.signatures += 1; return crypto.sign('sha256', octets, { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }); },
    cles: CLES, registre: REGISTRE,
    horloge: () => { etat.heure += 1000; return new Date(etat.heure); },
    afficher: (t) => { etat.affiche += t; },
    saisir: async (q) => {
      if (/Mode/.test(q)) return x.mode || 'reponse_message';
      if (/Code/.test(q)) return x.code || /CODE DE CONFIRMATION : ([0-9a-f]{16})/.exec(etat.affiche)[1];
      return x.fidelite || 'oui';
    },
    levees: [],
  };
  if (x.modifier) await x.modifier({ deps, execs, rattachements, fichiers, candidat, coeur, decision, etat });
  return { deps, etat, setId, publie };
}

describe('garde maîtresse', () => {
  test('sans contrat de rattachement : refus AVANT toute opération, zéro signature, zéro appel', async () => {
    const { deps, etat, setId } = await scenario();
    let appels = 0;
    deps.api.listerExecutions = async () => { appels += 1; return []; };
    deps.drive.lireCandidat = async () => { appels += 1; return null; };
    delete deps.rattachement;
    await assert.rejects(cloturer(setId, deps), /rattachement.*NON DÉFINI/);
    assert.equal(etat.signatures, 0);
    assert.equal(appels, 0);
  });
});

describe('aller-retour : signer -> attestation-signee vérifie -> publier-lot publie', () => {
  test('tiers (réponse au message) : enveloppe signée, vérifiée, publiable', async () => {
    const { deps, etat, setId, publie } = await scenario();
    const { enveloppe } = await cloturer(setId, deps);
    assert.equal(etat.signatures, 1);
    assert.equal(enveloppe.charge.confirmation.mode, 'reponse_message');
    assert.deepEqual(enveloppe.charge.provenances.map((p) => p.execution_id), ['10', '2']);
    assert.equal(enveloppe.charge.execution_cloture.execution_id, '20');
    assert.equal(enveloppe.charge.revoque_le, '2026-10-20T07:59:00.000Z');
    assert.deepEqual(enveloppe.charge.badge, { forme: 'relue_et_validee', nom_affiche: 'Relectrice de test', id: 'justine' });
    const r = await preparerPublication({ lot: publie, attestation: enveloppe, catalogue: copie(CATALOGUE), referentiel: REFERENTIEL, sha256Hex: sha, cles: CLES });
    assert.equal(r.ok, true, JSON.stringify(r.erreurs));
    assert.ok([...etat.ecrits.keys()].some((p) => p.endsWith('instantane.json')));
    assert.ok([...etat.ecrits.keys()].some((p) => p.endsWith('attestation.json')));
  });
  test('auto-confirmation (relecteur = Éric) : mode auto, badge Éric, publiable', async () => {
    const { deps, setId, publie } = await scenario({ maths: true });
    const { enveloppe } = await cloturer(setId, deps);
    assert.equal(enveloppe.charge.confirmation.mode, 'auto');
    assert.equal(enveloppe.charge.relecteur_egal_cloturer, true);
    const r = await preparerPublication({ lot: publie, attestation: enveloppe, catalogue: copie(CATALOGUE), referentiel: REFERENTIEL, sha256Hex: sha, cles: CLES });
    assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  });
  test('relecteur sans nom dans la table : badge « sans nom »', async () => {
    const { deps, setId } = await scenario({ modifier: ({ deps: d }) => { d.tableRelecteurs = {}; } });
    const { enveloppe } = await cloturer(setId, deps);
    assert.deepEqual(enveloppe.charge.badge, { forme: 'relue_par', nom_affiche: 'un professeur', id: null });
  });
  test('évolution normale : vue en cours (status=running) puis terminée (liste) -> acceptée', async () => {
    const { deps, setId } = await scenario();
    const base = deps.api.listerExecutions;
    deps.api.listerExecutions = async (q) => (q.status === 'running' && q.workflowId === 'wfConf' ? [{ id: 10, workflowId: 'wfConf', status: 'running', startedAt: null, stoppedAt: null }] : base(q));
    const { enveloppe } = await cloturer(setId, deps);
    assert.deepEqual(enveloppe.charge.provenances.map((p) => p.execution_id), ['10', '2']);
  });
  test('contradiction : terminée puis de nouveau en cours -> refus, zéro signature', async () => {
    const { observer } = require('./signer-cloture.js');
    let n = 0;
    const api = { listerExecutions: async () => { n += 1; return [{ id: 7, workflowId: 'w', status: n === 1 ? 'success' : 'running', startedAt: '2026-10-19T17:00:00.000Z', stoppedAt: null }]; } };
    await assert.rejects(observer(api, 'w'), /contradiction/);
  });
  test('contradiction : deux startedAt renseignés différents -> refus', async () => {
    const { observer } = require('./signer-cloture.js');
    let n = 0;
    const api = { listerExecutions: async () => { n += 1; return [{ id: 7, workflowId: 'w', status: 'success', startedAt: n === 1 ? '2026-10-19T17:00:00.000Z' : '2026-10-19T17:00:01.000Z', stoppedAt: '2026-10-19T18:00:00.000Z' }]; } };
    await assert.rejects(observer(api, 'w'), /contradictoires/);
  });
});

describe('chaque refus -> ZÉRO signature', () => {
  const cas = [
    ['exécution de confirmation en cours (status=running)', ({ execs }) => { execs.wfConf.push({ id: 40, workflowId: 'wfConf', status: 'running', startedAt: '2026-10-20T08:30:00.000Z', stoppedAt: null }); }, /non terminée/],
    ['exécution en attente (status=waiting)', ({ execs }) => { execs.wfConf.push({ id: 41, workflowId: 'wfConf', status: 'waiting', startedAt: null, stoppedAt: null }); }, /non terminée/],
    ['statut inconnu', ({ execs }) => { execs.wfConf.push({ id: 42, workflowId: 'wfConf', status: 'mystere', startedAt: '2026-10-19T10:00:00.000Z', stoppedAt: null }); }, /inconnu/],
    ['exécution non rattachable (sans données)', ({ execs }) => { execs.wfConf.push({ id: 43, workflowId: 'wfConf', status: 'success', startedAt: '2026-10-19T10:00:00.000Z', stoppedAt: '2026-10-19T10:00:01.000Z' }); }, /sans données/],
    ['sortie « conflit » du lot', ({ rattachements }) => { rattachements[2] = { ...rattachements[2], type: 'conflit' }; }, /conflit/],
    ['exécution du lot en erreur', ({ execs }) => { execs.wfConf[1].status = 'error'; }, /blocage dur/],
    ['décision consignée absente de Drive', ({ fichiers }) => { fichiers.pop(); }, /absente de Drive/],
    ['fichier de decisions/ sans exécution', ({ fichiers, decision, coeur }) => { fichiers.push({ nom: 'x.json', modifie_le: '2026-10-19T17:10:00.000Z', contenu: { ...decision('n99'), coeur } }); }, /sans exécution/],
    ['fichier de decisions/ illisible', ({ fichiers }) => { fichiers[0].contenu = null; }, /illisible/],
    ['écriture postérieure à la clôture technique', ({ fichiers }) => { fichiers[1].modifie_le = '2026-10-20T08:00:00.001Z'; }, /nouvelle clôture technique/],
    ['recherche Drive incomplète sans levée', ({ deps }) => { const l = deps.drive.listerDecisions; deps.drive.listerDecisions = async (s) => ({ ...(await l(s)), incompleteSearch: true }); }, /incompleteSearch/],
    ['incident ouvert', ({ deps }) => { deps.incidents = async () => [{ id: 'i1', nature: 'x', detecte_le: '2026-10-01T00:00:00.000Z', statut: 'ouvert', resolu_le: null, preuve_resolution: null, periode: { debut: null, fin: null } }]; }, /ouvert/],
    ['incident résolu recouvrant la fenêtre de candidature', ({ deps }) => { deps.incidents = async () => [{ id: 'i1', nature: 'x', detecte_le: '2026-10-18T10:00:00.000Z', statut: 'resolu', resolu_le: '2026-10-19T00:00:00.000Z', preuve_resolution: 'ok', periode: { debut: '2026-10-18T09:00:00.000Z', fin: '2026-10-19T00:00:00.000Z' } }]; }, /recouvre/],
    ['deux cœurs distincts', ({ fichiers }) => { fichiers[1].contenu.coeur.selection = fichiers[1].contenu.coeur.selection.slice(1); }, /cœurs distincts/],
    ['cœurs identiques, lot_relu différents', ({ fichiers }) => { fichiers[1].contenu.lot_relu = { item_ids: [] }; }, /lot_relu/],
    ['action rejeter', ({ fichiers }) => { for (const f of fichiers) f.contenu.coeur.action = 'rejeter'; }, /rien à publier/],
    ['code de confirmation faux', ({ deps }) => { const s = deps.saisir; deps.saisir = async (q) => (/Code/.test(q) ? '0'.repeat(16) : s(q)); }, /code de confirmation/],
    ['fidélité non attestée', ({ deps }) => { const s = deps.saisir; deps.saisir = async (q) => (/atteste/.test(q) ? 'non' : s(q)); }, /fidélité/],
    ['candidat non clos', ({ candidat, deps }) => { candidat.relecture.statut = 'en_attente'; deps.drive.lireCandidat = async () => copie(candidat); }, /clôture technique requise/],
    ['deux clôtures techniques à la même date', ({ execs, rattachements }) => { execs.wfClot.push({ ...execs.wfClot[0], id: 21 }); rattachements[21] = rattachements[20]; }, /même date/],
    ['clôture technique en cours', ({ execs, rattachements }) => { execs.wfClot.push({ id: 22, workflowId: 'wfClot', status: 'running', startedAt: '2026-10-20T08:20:00.000Z', stoppedAt: null }); rattachements[22] = rattachements[20]; }, /en cours/],
    ['aucune clôture technique rattachée', ({ rattachements }) => { delete rattachements[20]; }, /aucune clôture/],
    ['moteur du cœur ≠ candidat', ({ candidat, deps }) => { candidat.relecture.moteur = { version: 'v1', sha256: '0'.repeat(64) }; deps.drive.lireCandidat = async () => copie(candidat); }, /moteur du cœur/],
    ['partition hors ordre du candidat', ({ fichiers }) => { for (const f of fichiers) f.contenu.coeur.selection.reverse(); }, /partition/],
    ['empreinte relue ≠ candidat', ({ fichiers }) => { for (const f of fichiers) f.contenu.coeur.empreinte_relue = 'sha256:' + '0'.repeat(64); }, /empreinte relue/],
    ['référentiel archivé ≠ version', ({ deps }) => { deps.referentielArchive = async () => Buffer.from('{}'); }, /référentiel archivé/],
    ['dossier de clôture dans le dépôt', ({ deps }) => { deps.config.dossier = path.join(__dirname, 'cloture'); }, /DANS le dépôt/],
    ['dossier de clôture dans Dropbox', ({ deps }) => { deps.config.dossier = '/Users/x/Dropbox/cloture'; }, /Dropbox/],
    ['instantané déjà écrit (jamais reconstruit)', ({ deps, etat }) => { const e = deps.fs.ecrireExclusif; deps.fs.ecrireExclusif = (p, t) => { if (p.endsWith('instantane.json')) throw new Error('existe déjà'); return e(p, t); }; void etat; }, /existe déjà/],
    ['instantané altéré sur disque avant signature', ({ deps }) => { const l = deps.fs.lire; deps.fs.lire = (p) => (p.endsWith('instantane.json') ? Buffer.concat([l(p), Buffer.from(' ')]) : l(p)); }, /§3.4 \(a\)/],
  ];
  for (const [libelle, modifier, motif] of cas) {
    test(libelle, async () => {
      const { deps, etat, setId } = await scenario({ modifier });
      await assert.rejects(cloturer(setId, deps), motif);
      assert.equal(etat.signatures, 0, 'aucune signature');
      assert.ok(![...etat.ecrits.keys()].some((p) => p.endsWith('attestation.json')), 'aucune attestation écrite');
    });
  }
});

describe('dates de source (§11 bis)', () => {
  test('grammaire stricte et date calendaire réelle', () => {
    assert.equal(normaliserDate('2026-10-19T19:00:00+02:00'), '2026-10-19T17:00:00.000Z');
    assert.equal(normaliserDate('2026-10-19T17:00:00.123456Z'), '2026-10-19T17:00:00.123Z');
    for (const v of ['2026-10-19T17:00:00', '2026-02-30T00:00:00Z', '2026-10-19 17:00:00Z', 1760000000000, null]) assert.equal(normaliserDate(v), null, String(v));
  });
});
