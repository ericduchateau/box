// Tests du CLI qui signe (cloturer-page.js, CDC §21.9, §21.12, P5-3).
// (1) signerPage en processus : VRAI cloturer (signer-cloture.js, intact), VRAI rattacherPage, monde page
//     synthétique (n8n : génération, Confirmer, Cloturer, Emettre ; Drive : lot, candidats, candidat,
//     decisions/), paire RSA SYNTHÉTIQUE, journal d'écriture réel (verrou-relecture.js), sentinelles.
// (2) fabrique de production : fetch, trousseau de fichiers et phrase de passe INJECTÉS (GET seulement,
//     aucune redirection) ; aucune clé réelle n'est lue.
// (3) processus réels sous /usr/bin/lockf : signature <-> écriture (75) et témoin (verrou neutralisé).
// Usage : node --test fonda/scripts/cloturer-page.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const C = require('../engine/catalogue.js');
const S = require('./attestation-signee.js');
const L = require('./liaison-generation.js');
const V = require('./verrou-relecture.js');
const E = require('./ecrire-relecture.js');
const SC = require('./signer-cloture.js');
const P = require('./rattachement-page.js');
const PA = require('./adaptateurs-page.js');
const CP = require('./cloturer-page.js');

const REGISTRE = require('../engine/moteurs.json');
const MOTEUR = { version: 'v1', sha256: REGISTRE[0].sha256 };
const OCTETS_REF = fs.readFileSync(path.join(__dirname, '../data/referentiel.json'));
const REF_VERSION = `sha256:${crypto.createHash('sha256').update(OCTETS_REF).digest('hex')}`;
const FIXTURE = require('./fixtures/execution-generation.json');
const MODELE = FIXTURE.modele;
const COMMIT = 'c0ffee'.padEnd(40, '0');
const copie = (o) => JSON.parse(JSON.stringify(o));
const sha = C.sha256WebCrypto();
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' });
const DECL = { cle_id: 'cle-test', fichier: 'cles/cle-test.pem', sha256_pem: crypto.createHash('sha256').update(PEM).digest('hex'), algorithme: 'RSA-SHA256-PKCS1v15', valide_du: '2026-01-01T00:00:00.000Z', valide_au: '2027-12-31T00:00:00.000Z', revoquee_le: null };
const CLES = S.chargerCles([DECL], () => PEM);

// Sentinelles aux formats réels (k / HMAC / jetons = 64 hex ; clé d'API n8n = JWT ; adresse).
const SEN = {
  k: 'a1'.repeat(32), hmac: 'b2c3'.repeat(16), jetonEmettre: 'D4E5'.repeat(16), jetonCloturer: 'F6A7'.repeat(16),
  cleApi: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZW50aW5lbGxlIn0.c2VudGluZWxsZQ', adresse: 'sentinelle.relecteur@exemple.invalid',
};
const fuite = (texte) => Object.values(SEN).filter((s) => String(texte).includes(s));
const runN = (json) => [{ data: { main: [[{ json }]] } }];
const SENTINELLES_RUN = { 'Generer cle': runN({ k: SEN.k, lien: `?k=${SEN.k}` }), 'Lire adresse relecteur': runN({ adresse: SEN.adresse }), 'Noeud sentinelle': runN({ jeton: SEN.jetonEmettre, cle: SEN.cleApi }) };
const WF_DATA = { pinData: null, nodes: [{ name: 'Jeton', parameters: { secret: SEN.hmac, jeton: SEN.jetonCloturer } }] };
const NA = 'a'.repeat(32); const NB = 'b'.repeat(32);
const T = CP.WORKFLOWS;

function instancier(gabarit, valeurs) {
  let t = JSON.stringify(gabarit);
  for (const [k, v] of Object.entries(valeurs)) t = t.split(`<<${k}>>`).join(v);
  return JSON.parse(t);
}

// --- Monde page synthétique ----------------------------------------------------------------------
async function monde(x = {}) {
  const setId = x.maths ? 'set_fonda_grandeurs-mesures_nI_92' : 'set_fonda_comprendre-consigne_nI_92';
  const lot = copie(require(`../data/lots/${x.maths ? 'set_fonda_grandeurs-mesures_nI_01' : 'set_fonda_comprendre-consigne_nI_01'}.json`));
  lot.set_id = setId; lot.revue_carte_par_carte = false; lot.cartes.forEach((c) => { c.set_id = setId; });
  const ids = lot.cartes.map((c) => c.item_id);
  const empreintes = { pedagogique: await C.calculerEmpreinte(lot, sha), complete: L.empreinteComplete(lot) };
  const garde = new Set(ids.slice(0, -1));
  const publie = { ...lot, revue_carte_par_carte: true, cartes: lot.cartes.filter((c) => garde.has(c.item_id)) };
  publie.nb_cartes = publie.cartes.length;
  const coeur = { action: 'accepter', selection: ids.slice(0, -1), ecartees: ids.slice(-1), empreinte_relue: empreintes.pedagogique, empreinte_publiee: await C.calculerEmpreinte(publie, sha), moteur: { ...MOTEUR } };
  const lotRelu = { set_id: setId, empreinte_complete: empreintes.complete, cartes: ids.map((id) => ({ item_id: id, choix: garde.has(id) ? 'garder' : 'ecarter' })) };
  const ref = `test-2026-10-17:${setId}`;
  const fx = instancier(FIXTURE, { SET_ID: setId, REF: ref, NOTION_ID: lot.notion_id, PALIER: lot.palier, MOTEUR_SHA256: MOTEUR.sha256, REFERENTIEL_VERSION: REF_VERSION, JOURNAL_COMMIT: COMMIT, EMPREINTE_PEDAGOGIQUE: empreintes.pedagogique, EMPREINTE_COMPLETE: empreintes.complete });
  const genDetail = copie(fx.reussie);
  genDetail.data.resultData.runData = { ...genDetail.data.resultData.runData, ...SENTINELLES_RUN };
  const decision = (n) => ({ schema: 'decision-fonda/v1', set_id: setId, generation: 1, nonce: n, recu_le: '2026-10-19T17:00:01.000Z', coeur: copie(coeur), lot_relu: copie(lotRelu), hash_formulaire: 'h' });
  const fichiers = [NA, NB].map((n) => ({ id: `drv-${n.slice(0, 4)}`, nom: `${setId}-${n}.json`, modifie_le: '2026-10-19T17:00:01.500Z', properties: { fonda_set_id: setId, fonda_nonce: n }, contenu: decision(n) }));
  const sortieDecision = (n) => ({ type: 'decision', set_id: setId, nonce: n, generation: 1, decision_fichier_id: `drv-${n.slice(0, 4)}`, decision_sha256: P.empreinteDecision(decision(n)), ecriture: 'creee', motif: null });
  const candidat = { schema: 'candidat-fonda/v1', lot: copie(lot), relecture: { statut: 'clos', generation_cle: 1, cle_sha256: SEN.hmac, cree_le: '2026-10-18T08:00:00.000Z', expire_le: '2026-11-01T08:00:00.000Z', clos_le: '2026-10-20T07:59:00.000Z', relecteur_attribue: x.maths ? 'eric' : 'justine', referentiel_version: REF_VERSION, moteur: { ...MOTEUR }, envois: [{ generation_cle: 1, envoye_a: SEN.adresse, le: '2026-10-18T08:00:01.000Z' }] } };
  const ex = (id, wf, status, debut, fin) => ({ id, workflowId: wf, status, startedAt: debut, stoppedAt: fin });
  const execs = {
    wfGen: [ex(501, 'wfGen', 'success', '2026-10-18T07:00:00.000Z', '2026-10-18T07:01:00.000Z')],
    [T.confirmation]: [ex(10, T.confirmation, 'success', '2026-10-19T17:00:00.000Z', '2026-10-19T17:00:02.000Z'), ex(2, T.confirmation, 'success', '2026-10-19T17:00:00.000Z', '2026-10-19T17:00:03.000Z')],
    [T.cloture]: [ex(20, T.cloture, 'success', '2026-10-20T07:58:00.000Z', '2026-10-20T08:00:00.000Z')],
    [T.emettre]: [ex(7, T.emettre, 'success', '2026-10-18T08:00:00.000Z', '2026-10-18T08:00:02.000Z')],
  };
  const specs = {
    10: ['confirmation', sortieDecision(NA)], 2: ['confirmation', sortieDecision(NB)],
    20: ['cloture', { set_id: setId, clos_le: '2026-10-20T07:59:00.000Z', deja_clos: false, candidat_fichier_id: 'drv-candidat', nb_decisions_listees: 2, incomplete_search: false }],
  };
  const detail = (obs, role, s) => {
    const runData = role === 'cloture'
      ? { 'FONDA Entree cloture': runN({ set_id: s.set_id }), 'FONDA Ecrire candidat clos': runN({}), 'FONDA Sortie cloture': runN({ schema: 'cloture-fonda/v1', ...s }) }
      : { 'FONDA Entree confirmation': runN({ lot: s.set_id, nonce: s.nonce }), 'FONDA Ecrire decision': runN({}), 'FONDA Sortie confirmation': runN({ schema: 'confirmation-fonda/v1', ...s }) };
    return { ...copie(obs), id: String(obs.id), mode: 'webhook', workflowData: copie(WF_DATA), data: { resultData: { runData: { ...runData, ...SENTINELLES_RUN } } } };
  };
  const etat = { signatures: 0, preparations: 0, fabriques: 0, ecrits: new Map(), affiche: '', heure: Date.parse('2026-10-20T09:00:00.000Z'), questions: [], appels: [], lus: [] };
  const api = {
    async listerExecutions({ workflowId, status }) {
      etat.appels.push(`${workflowId}:${status || '*'}`);
      if (etat.panneApi && etat.panneApi(workflowId)) throw new Error(`API indisponible ${SEN.cleApi}`);
      const t = execs[workflowId] || [];
      const r = copie(status ? t.filter((e) => e.status === status) : t.filter((e) => e.status !== 'running')); // n8n 2.6.3
      if (etat.apresLister) etat.apresLister({ workflowId, status }); // entrelacements : effet APRÈS cette réponse
      return r;
    },
    async lireExecution(id) {
      etat.lus.push(String(id));
      if (String(id) === '501') return copie(genDetail);
      const obs = [...execs[T.confirmation], ...execs[T.cloture]].find((e) => String(e.id) === String(id));
      if (obs && specs[id]) return detail(obs, specs[id][0], specs[id][1]);
      return null;
    },
  };
  const lotGenere = { id: 'drv-lot', nom: `${setId}.lot.json`, modifie_le: '2026-10-18T07:00:30.000Z', octets: Buffer.from(`${JSON.stringify(lot, null, 2)}\n`) };
  const dossier = '/tmp/fonda-cloturer-page-test';
  const depsBase = {
    config: { source: 'page_relecture', workflowGeneration: 'wfGen', workflowConfirmation: T.confirmation, workflowCloture: T.cloture, dossier, cleId: 'cle-test', modelesAutorises: [MODELE] },
    drive: {
      lireLotGenere: async () => ({ ...lotGenere, octets: Buffer.from(lotGenere.octets) }),
      listerCandidats: async () => ({ incompleteSearch: false, fichiers: [{ id: 'drv-lot', nom: `${setId}.lot.json`, modifie_le: '2026-10-18T07:00:30.000Z', properties: { fonda_set_id: setId, fonda_execution_id: '501' }, proprietesLisibles: true }] }),
      lireCandidat: async () => PA.avecIdentite(copie(candidat), { id: 'drv-candidat', nom: `${setId}.candidat.json`, modifie_le: '2026-10-20T08:00:00.000Z' }),
      listerDecisions: async () => ({ incompleteSearch: false, fichiers: copie(fichiers) }),
    },
    journal: async (c) => (c === COMMIT ? { surPremierParent: true, journal: { schema: 'set-ids-journal/v1', lignes: [{ set_id: setId, transition: 'reserve', le: '2026-10-17', ref }] } } : { surPremierParent: false, journal: null }),
    incidents: async () => [],
    referentielArchive: async (v) => { if (v !== REF_VERSION) throw new Error('introuvable'); return OCTETS_REF; },
    tableRelecteurs: { justine: `Relectrice ${SEN.adresse}` }, // ignorée : le CLI impose {} (arbitrage C)
    levees: [{ type: 'recherche_incomplete' }], // ignorées : le CLI impose [] (arbitrage D)
    fs: {
      realpath: (p) => p,
      ecrireExclusif(p, t) { if (etat.ecrits.has(p)) throw new Error('existe déjà'); etat.ecrits.set(p, Buffer.from(t, 'utf8')); },
      lire(p) { if (!etat.ecrits.has(p)) throw new Error('absent'); return etat.ecrits.get(p); },
      existe(p) { return etat.ecrits.has(p); },
      lister(d) { const n = new Set(); for (const p of etat.ecrits.keys()) if (p.startsWith(`${d}/`)) n.add(p.slice(d.length + 1).split('/')[0]); return [...n]; },
    },
    cles: CLES, registre: REGISTRE,
    horloge: () => { etat.heure += 1000; return new Date(etat.heure); },
  };
  const verrous = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cloturer-page-')));
  const base = { verrous, sousVerrou: path.join(verrous, 'relecture.verrou') };
  V.initialiser(base);
  const fab = {
    api, workflowGeneration: 'wfGen',
    preparerSignataire: async () => { etat.preparations += 1; return (octets) => { etat.signatures += 1; return crypto.sign('sha256', octets, { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }); }; },
    depsCloture: ({ api: a, signer }) => ({ ...depsBase, api: a, signer, rattachement: P.rattacherPage }),
    saisir: async (q) => {
      etat.questions.push(q);
      if (/Mode/.test(q)) return 'reponse_message';
      if (/Code/.test(q)) return /CODE DE CONFIRMATION : ([0-9a-f]{16})/.exec(etat.affiche)[1];
      if (q === CP.QUESTION_FIDELITE && x.avantFinal) await x.avantFinal(ctx);
      return x.fidelite || 'oui';
    },
    afficher: (t) => { etat.affiche += t; },
  };
  const ctx = { setId, etat, execs, specs, fichiers, candidat, depsBase, fab, base, api, decision, sortieDecision };
  if (x.modifier) await x.modifier(ctx);
  ctx.fabriquer = () => { etat.fabriques += 1; return fab; };
  ctx.signer = () => CP.signerPage(setId, base, ctx.fabriquer);
  ctx.dossier = dossier;
  ctx.marqueur = () => etat.ecrits.has(path.join(dossier, `${setId}.signature`));
  ctx.attestation = () => [...etat.ecrits.keys()].find((p) => p.endsWith('attestation.json'));
  return ctx;
}
const refusSansSignature = async (ctx, motif, issue) => {
  const err = await ctx.signer().then(() => null, (e) => e);
  assert.ok(err, 'refus attendu');
  assert.match(err.message, motif);
  if (issue) assert.equal(err.issue, issue, err.message);
  assert.equal(ctx.etat.signatures, 0, 'aucune signature');
  assert.equal(ctx.marqueur(), false, 'aucun marqueur : lot réessayable');
  assert.equal(ctx.attestation(), undefined);
  return err;
};

describe('arguments et signer-cloture.js intact', () => {
  test('un seul <set_id> strict ; tout le reste refusé', () => {
    assert.deepEqual(CP.analyserArguments(['set_fonda_comprendre-consigne_nI_92']), { setId: 'set_fonda_comprendre-consigne_nI_92' });
    for (const a of [[], ['x'], ['set_fonda_comprendre-consigne_nI_92', '--force'], ['--source', 'page_relecture'], ['set_fonda_comprendre-consigne_nI_92', 'set_fonda_comprendre-consigne_nI_93']]) assert.throws(() => CP.analyserArguments(a), /usage/, a.join(' '));
  });
  test('signer-cloture.js refuse TOUJOURS la page (main et analyserArgumentsCloture intacts)', () => {
    assert.throws(() => SC.analyserArgumentsCloture(['set_fonda_comprendre-consigne_nI_92', '--source', 'page_relecture']), /page_relecture/);
  });
  test('workflows de production : Emettre et Cloturer identiques au CLI qui écrit', () => {
    assert.equal(T.emettre, E.WORKFLOWS.emettre);
    assert.equal(T.cloture, E.WORKFLOWS.cloturer);
    assert.equal(T.confirmation, 'W1HAOtjAX3ILZBpX');
  });
});

describe('signature nominale : vrai cloturer, vrai rattacherPage', () => {
  test('signé une fois ; attestation vérifiée ; badge générique (C) ; aucune levée (D) ; contrôle final fait', async () => {
    const ctx = await monde();
    const r = await ctx.signer();
    assert.equal(ctx.etat.signatures, 1);
    assert.match(r.dossier, /set_fonda_comprendre-consigne_nI_92-[0-9a-f]{16}$/);
    const env = JSON.parse(ctx.etat.ecrits.get(ctx.attestation()).toString('utf8'));
    assert.equal(env.charge.source_decisions, 'page_relecture');
    assert.deepEqual(env.charge.badge, { forme: 'relue_par', nom_affiche: 'un professeur', id: null }, 'tableRelecteurs = {} imposé');
    assert.deepEqual(env.charge.levees, [], 'levées = [] imposées');
    assert.equal(ctx.etat.questions.filter((q) => q === CP.QUESTION_FIDELITE).length, 1, 'question de fidélité posée telle quelle');
    for (const wf of ['wfGen', T.confirmation, T.cloture, T.emettre]) assert.ok(ctx.etat.appels.filter((a) => a === `${wf}:*`).length >= 2, `${wf} : première ET dernière observation`);
  });
  test('ordre : journal et quiescence AVANT la phrase de passe ; Emettre jamais lu en détail', async () => {
    const ctx = await monde();
    const appelsAvant = [];
    const prep = ctx.fab.preparerSignataire;
    ctx.fab.preparerSignataire = async () => { appelsAvant.push(...ctx.etat.appels); return prep(); };
    await ctx.signer();
    assert.deepEqual([...new Set(appelsAvant.map((a) => a.split(':')[0]))].sort(), [T.cloture, T.emettre].sort(), 'seules Emettre et Cloturer observées avant la clé');
    assert.ok(!ctx.etat.lus.includes('7'), 'détail d\'Emettre jamais lu');
  });
});

describe('diagnostic de comptage (§21.2) et badge', () => {
  test('nominal : nb_decisions_listees de la clôture retenue = décompte du signataire (2, 2), sans nouvelle lecture', async () => {
    const ctx = await monde();
    const r = await ctx.signer();
    assert.deepEqual(r.diagnostic, { nb_decisions_listees: 2, decompte_signataire: 2 });
  });
  test('décision et clôture d\'un AUTRE lot : ni comptée ni retenue pour le diagnostic', async () => {
    const autre = 'set_fonda_resolution-problemes_nI_92';
    const ctx = await monde({ modifier: ({ execs, specs, depsBase, decision }) => {
      execs[T.cloture].push({ id: 26, workflowId: T.cloture, status: 'success', startedAt: '2026-10-20T08:20:00.000Z', stoppedAt: '2026-10-20T08:21:00.000Z' });
      specs[26] = ['cloture', { set_id: autre, clos_le: '2026-10-20T08:19:00.000Z', deja_clos: false, candidat_fichier_id: 'drv-autre', nb_decisions_listees: 9, incomplete_search: false }];
      const base = depsBase.drive.listerDecisions;
      depsBase.drive.listerDecisions = async () => { const r = await base(); r.fichiers.push({ id: 'drv-autre-d', nom: `${autre}-${'c'.repeat(32)}.json`, modifie_le: '2026-10-19T17:00:01.500Z', properties: { fonda_set_id: autre, fonda_nonce: 'c'.repeat(32) }, contenu: { ...decision('c'.repeat(32)), set_id: autre } }); return r; };
    } });
    const r = await ctx.signer();
    assert.deepEqual(r.diagnostic, { nb_decisions_listees: 2, decompte_signataire: 2 });
  });
  test('décomptes différents (Cloturer : 1) -> signé quand même (jamais décisif), diagnostic rendu', async () => {
    const ctx = await monde({ modifier: ({ specs }) => { specs[20][1].nb_decisions_listees = 1; } });
    const r = await ctx.signer();
    assert.equal(ctx.etat.signatures, 1);
    assert.deepEqual(r.diagnostic, { nb_decisions_listees: 1, decompte_signataire: 2 });
  });
  test('clôture répétée : la PLUS RÉCENTE fournit nb_decisions_listees', async () => {
    const ctx = await monde({ modifier: ({ execs, specs }) => {
      execs[T.cloture].push({ id: 24, workflowId: T.cloture, status: 'success', startedAt: '2026-10-20T08:10:00.000Z', stoppedAt: '2026-10-20T08:11:00.000Z' });
      specs[24] = ['cloture', { ...specs[20][1], deja_clos: true, nb_decisions_listees: 3 }];
    } });
    assert.equal((await ctx.signer()).diagnostic.nb_decisions_listees, 3);
  });
  test('badge : lot d\'Éric en confirmation AUTOMATIQUE -> « Éric Duchateau » (tiers : générique, test nominal)', async () => {
    const ctx = await monde({ maths: true });
    await ctx.signer();
    const env = JSON.parse(ctx.etat.ecrits.get(ctx.attestation()).toString('utf8'));
    assert.deepEqual(env.charge.badge, { forme: 'relue_par', nom_affiche: 'Éric Duchateau', id: 'eric' });
    assert.equal(env.charge.confirmation.mode, 'auto');
    assert.ok(!ctx.etat.questions.some((q) => /Mode/.test(q)), 'aucun mode demandé en auto');
  });
});

describe('confinement : sentinelles k, adresse, HMAC, jetons, clé d\'API dans TOUTES les sources', () => {
  test('signature nominale : aucune sentinelle dans les fichiers écrits, l\'affichage, le résultat, le journal', async () => {
    const ctx = await monde();
    const r = await ctx.signer();
    for (const [p, o] of ctx.etat.ecrits) assert.deepEqual(fuite(o.toString('utf8')), [], p);
    assert.deepEqual(fuite(ctx.etat.affiche), []);
    assert.deepEqual(fuite(JSON.stringify(r)), []);
    for (const f of fs.readdirSync(ctx.base.verrous)) assert.deepEqual(fuite(fs.readFileSync(path.join(ctx.base.verrous, f), 'latin1')), [], f);
  });
  test('masquage défensif (B) : motif d\'adresse masqué ; chemins, ids et empreintes 64-hex intacts', () => {
    const t = `fichier ${SEN.adresse}.json ; exécution 42 ; sha256:${'ab'.repeat(32)} ; ${'cd'.repeat(32)} ; /Users/x/FONDA-clotures/set-1`;
    const m = CP.masquer(t);
    assert.ok(!m.includes(SEN.adresse) && m.includes('[adresse masquée]'));
    for (const garde of ['exécution 42', `sha256:${'ab'.repeat(32)}`, 'cd'.repeat(32), '/Users/x/FONDA-clotures/set-1']) assert.ok(m.includes(garde), garde);
  });
  test('affichage pendant la confirmation masqué (B)', async () => {
    const ctx = await monde();
    const fab = ctx.fab;
    const prep = fab.depsCloture;
    fab.depsCloture = (a) => ({ ...prep(a) });
    const orig = SC.cloturer;
    await CP.signerPage(ctx.setId, ctx.base, () => ({ ...fab, cloturer: async (s, d) => { d.afficher(`relecteur ${SEN.adresse}`); return orig(s, d); } }));
    assert.ok(!ctx.etat.affiche.includes(SEN.adresse) && ctx.etat.affiche.includes('[adresse masquée]'));
  });
  test('nom de fichier decisions/ portant une adresse : refus, message brut porteur -> masqué par main', async () => {
    const ctx = await monde({ modifier: ({ depsBase, fichiers }) => {
      const base = depsBase.drive.listerDecisions;
      depsBase.drive.listerDecisions = async () => { const r = await base(); r.fichiers.push({ id: 'drv-x', nom: `${SEN.adresse}.json`, modifie_le: '2026-10-19T17:00:01.500Z', properties: {}, contenu: { illisible: true } }); return r; };
      void fichiers;
    } });
    const err = await refusSansSignature(ctx, /non conforme/);
    assert.ok(err.message.includes(CP.NOM_NON_CONFORME), 'nom hors grammaire remplacé à la frontière');
    assert.deepEqual(fuite(err.message), []);
  });
  test('P1 (reproduction Codex) : erreur de lecture portant une clé d\'API, encapsulée par cloturer -> message contrôlé', async () => {
    const ctx = await monde({ modifier: ({ depsBase }) => { depsBase.drive.listerDecisions = async () => { throw new Error(`HTTP 500 ${SEN.cleApi} ${SEN.jetonCloturer}`); }; } });
    const err = await refusSansSignature(ctx, /decisions\/\) : lecture en échec \(détail non affiché\)/, 'temporaire');
    assert.deepEqual(fuite(err.message), []);
  });
  test('P1 (reproduction Codex) : fichier decisions/ nommé <k>.json -> « [nom non conforme] », k jamais affichée', async () => {
    const ctx = await monde({ modifier: ({ depsBase }) => {
      const base = depsBase.drive.listerDecisions;
      depsBase.drive.listerDecisions = async () => { const r = await base(); r.fichiers.push({ id: 'drv-k', nom: `${SEN.k}.json`, modifie_le: '2026-10-19T17:00:01.500Z', properties: {}, contenu: { illisible: true } }); return r; };
    } });
    const err = await refusSansSignature(ctx, /non conforme/);
    assert.ok(err.message.includes(CP.NOM_NON_CONFORME));
    assert.deepEqual(fuite(err.message), []);
  });
  test('P1 : erreurs de TOUS les adaptateurs injectés contrôlées ; statut 401/403 conservé (incident)', async () => {
    const pannes = {
      'API n8n (exécution)': ({ api }) => { api.lireExecution = async () => { throw Object.assign(new Error(`403 ${SEN.cleApi}`), { statut: 403 }); }; },
      'Drive (lot généré)': ({ depsBase }) => { depsBase.drive.lireLotGenere = async () => { throw new Error(SEN.k); }; },
      'Drive (candidats/)': ({ depsBase }) => { depsBase.drive.listerCandidats = async () => { throw new Error(SEN.adresse); }; },
      'Drive (candidat)': ({ depsBase }) => { depsBase.drive.lireCandidat = async () => { throw new Error(SEN.hmac); }; },
      'historique de confiance (journal)': ({ depsBase }) => { depsBase.journal = async () => { throw new Error(SEN.jetonEmettre); }; },
      'registre des incidents': ({ depsBase }) => { depsBase.incidents = async () => { throw new Error(SEN.cleApi); }; },
    };
    for (const [quoi, panne] of Object.entries(pannes)) {
      const ctx = await monde({ modifier: panne });
      const err = await ctx.signer().then(() => null, (e) => e);
      assert.ok(err, quoi);
      assert.equal(ctx.etat.signatures, 0, quoi);
      assert.deepEqual(fuite(err.message), [], quoi);
      if (quoi === 'API n8n (exécution)') assert.equal(err.issue, 'incident', 'accès insuffisant 403 conservé à travers la frontière');
    }
    const ctx = await monde({ modifier: ({ depsBase }) => { depsBase.referentielArchive = async () => { throw new Error(SEN.k); }; } });
    const err = await ctx.signer().then(() => null, (e) => e);
    assert.deepEqual(fuite(err.message), [], 'référentiel archivé');
    const c2 = await monde({ modifier: ({ api }) => { api.lireExecution = async () => { throw new Error(`HTTP 500 ${SEN.cleApi}`); }; } });
    const e2 = await refusSansSignature(c2, /lecture en échec \(détail non affiché\)/, 'temporaire');
    assert.deepEqual(fuite(e2.message), [], 'lecture d\'exécution (panne non 403)');
  });
  test('P1 : erreurs PARTIELLES de decisions/ (fichier non lu) -> messages contrôlés', async () => {
    const ctx = await monde({ modifier: ({ depsBase }) => {
      const base = depsBase.drive.listerDecisions;
      depsBase.drive.listerDecisions = async () => { const r = await base(); r.fichiers.push({ id: 'drv-e', nom: `${SEN.k}.json`, modifie_le: '2026-10-19T17:00:01.500Z', properties: {}, contenu: null, erreur: { statut: 500, message: SEN.cleApi } }); r.erreurs = [{ quoi: `décision ${SEN.k}.json`, statut: 500, message: `HTTP 500 ${SEN.cleApi}` }]; r.complet = false; return r; };
    } });
    const err = await refusSansSignature(ctx, /lecture partielle/, 'temporaire');
    assert.deepEqual(fuite(err.message), []);
  });
  test('P1 : noms Drive CONFORMES inchangés (lot, candidat, décision) ; un nom hors grammaire remplacé', () => {
    const d = 'set_fonda_comprendre-consigne_nI_92';
    for (const n of [`${d}.lot.json`, `${d}.candidat.json`, `${d}-${'0f'.repeat(16)}.json`]) assert.equal(CP.nomSur(n), n);
    for (const n of [`${SEN.k}.json`, `${SEN.adresse}.json`, `${d}-n10.json`, `${d}.lot.json.bak`, null, 42]) assert.equal(CP.nomSur(n), CP.NOM_NON_CONFORME, String(n));
  });
});

describe('journal d\'écriture lu sous le verrou AVANT tout secret (§21.12.4)', () => {
  const CAND = { fichier_id: 'drv-candidat', version: '7', generation_cle: 1, statut: 'clos', clos_le: '2026-10-20T07:59:00.000Z' };
  const aucunSecret = (ctx) => { assert.equal(ctx.etat.fabriques, 0, 'fabrique (clés) jamais construite'); assert.equal(ctx.etat.preparations, 0); assert.deepEqual(ctx.etat.appels, []); };
  test('tentative ouverte (indéterminée) sur le lot -> refus temporaire', async () => {
    const ctx = await monde();
    V.preparerEnvoi(ctx.setId, 'cloture_technique', { candidat: CAND, preexistantes: [], listingComplet: true }, ctx.base);
    await refusSansSignature(ctx, /tentative non résolue/, 'temporaire');
    aucunSecret(ctx);
  });
  test('lot bloqué (anomalie rattachée) -> abandon', async () => {
    const ctx = await monde();
    const p = V.preparerEnvoi(ctx.setId, 'cloture_technique', { candidat: CAND, preexistantes: [], listingComplet: true }, ctx.base);
    const r = V.diagnostiquer(p.tentative_id, { executions: [{ id: '900', set_id: ctx.setId, workflow: 'cloturer', statut: 'success', sortie: null }], listingComplet: true, candidat: CAND }, ctx.base);
    assert.equal(r.issue, 'anomalie');
    await refusSansSignature(ctx, /bloqué définitivement/, 'abandon');
    aucunSecret(ctx);
  });
  test('tentative d\'un AUTRE lot : sans effet sur ce lot (signé)', async () => {
    const ctx = await monde();
    V.preparerEnvoi('set_fonda_resolution-problemes_nI_02', 'cloture_technique', { candidat: CAND, preexistantes: [], listingComplet: true }, ctx.base);
    await ctx.signer();
    assert.equal(ctx.etat.signatures, 1);
  });
  test('journal absent ou corrompu -> refus (fail-closed)', async () => {
    const ctx = await monde();
    fs.appendFileSync(path.join(ctx.base.verrous, 'relecture.journal'), '{"type":"envoi"}\n');
    await refusSansSignature(ctx, /journal d'écriture inutilisable/, 'precondition');
    aucunSecret(ctx);
    const ctx2 = await monde();
    fs.renameSync(path.join(ctx2.base.verrous, 'relecture.journal'), path.join(ctx2.base.verrous, 'ailleurs'));
    await refusSansSignature(ctx2, /journal d'écriture inutilisable/, 'precondition');
  });
  test('décisions du verrou -> issues : refus_temporaire/temporaire, abandon/abandon, incident/incident', async () => {
    for (const [d, issue] of [['refus_temporaire', 'temporaire'], ['abandon', 'abandon'], ['incident', 'incident']]) {
      const ctx = await monde();
      const orig = V.decisionSignature;
      V.decisionSignature = () => d;
      try { await refusSansSignature(ctx, /journal d'écriture/, issue); } finally { V.decisionSignature = orig; }
      aucunSecret(ctx);
    }
  });
});

describe('quiescence (§21.12.3 b) : Emettre ET Cloturer, quel que soit le lot', () => {
  for (const [nom, wf] of [['Emettre', T.emettre], ['Cloturer', T.cloture]]) {
    test(`exécution en vol sur ${nom} (autre lot) -> refus temporaire, phrase jamais demandée`, async () => {
      const ctx = await monde({ modifier: ({ execs }) => { execs[wf].push({ id: 99, workflowId: wf, status: 'running', startedAt: '2026-10-20T08:59:00.000Z', stoppedAt: null }); } });
      await refusSansSignature(ctx, /quiescence/, 'temporaire');
      assert.equal(ctx.etat.preparations, 0);
    });
  }
  test('observation impossible -> refus temporaire (jamais « zéro exécution ») ; message sans la clé d\'API', async () => {
    const ctx = await monde();
    ctx.etat.panneApi = (wf) => wf === T.emettre;
    const err = await refusSansSignature(ctx, /observation n8n/, 'temporaire');
    assert.deepEqual(fuite(err.message), []);
  });
});

describe('TOCTOU (arbitrage A) : dernière observation après « J\'atteste », avant le marqueur', () => {
  const cas = [
    ['confirmation APPARUE (relecteur, hors verrou)', ({ execs }) => { execs[T.confirmation].push({ id: 11, workflowId: T.confirmation, status: 'success', startedAt: '2026-10-20T09:00:30.000Z', stoppedAt: '2026-10-20T09:00:31.000Z' }); }],
    ['génération en vol apparue', ({ execs }) => { execs.wfGen.push({ id: 502, workflowId: 'wfGen', status: 'running', startedAt: '2026-10-20T09:00:30.000Z', stoppedAt: null }); }],
    ['statut modifié à ids constants (génération success -> error)', ({ execs }) => { execs.wfGen[0].status = 'error'; }],
    ['date modifiée à ids constants (clôture)', ({ execs }) => { execs[T.cloture][0].stoppedAt = '2026-10-20T08:00:05.000Z'; }],
    ['Emettre : exécution apparue', ({ execs }) => { execs[T.emettre].push({ id: 8, workflowId: T.emettre, status: 'success', startedAt: '2026-10-20T09:00:30.000Z', stoppedAt: '2026-10-20T09:00:31.000Z' }); }],
  ];
  for (const [nom, changer] of cas) {
    test(`${nom} -> refus temporaire, AUCUNE signature, AUCUN marqueur`, async () => {
      const ctx = await monde({ avantFinal: changer });
      await refusSansSignature(ctx, /contrôle final/, 'temporaire');
      assert.equal(ctx.etat.preparations, 1, 'la phrase avait été saisie : rien n\'est consommé');
    });
  }
  test('P2 (entrelacement Codex) : Confirmer démarre APRÈS la requête running, AVANT waiting, et reste en cours -> balayage final : refus', async () => {
    const ctx = await monde({ avantFinal: ({ etat, execs }) => {
      etat.apresLister = ({ workflowId, status }) => {
        if (workflowId === T.confirmation && status === 'running' && !execs[T.confirmation].some((e) => e.id === 12)) execs[T.confirmation].push({ id: 12, workflowId: T.confirmation, status: 'running', startedAt: '2026-10-20T09:00:40.000Z', stoppedAt: null });
      };
    } });
    await refusSansSignature(ctx, /balayage|en cours apparue/, 'temporaire');
  });
  test('P2 (entrelacement Codex) : génération démarrée APRÈS sa dernière observation, pendant celle de Confirmer -> balayage final : refus', async () => {
    const ctx = await monde({ avantFinal: ({ etat, execs }) => {
      etat.apresLister = ({ workflowId }) => {
        if (workflowId === T.confirmation && !execs.wfGen.some((e) => e.id === 503)) execs.wfGen.push({ id: 503, workflowId: 'wfGen', status: 'running', startedAt: '2026-10-20T09:00:40.000Z', stoppedAt: null });
      };
    } });
    await refusSansSignature(ctx, /en cours apparue/, 'temporaire');
  });
  test('P2 : balayage final impossible -> refus, aucun marqueur', async () => {
    const ctx = await monde({ avantFinal: ({ etat }) => { let n = 0; etat.panneApi = () => (n += 1) > 12; } });
    await refusSansSignature(ctx, /contrôle final/, 'temporaire');
  });
  test('dernière observation en panne -> refus temporaire, aucun marqueur', async () => {
    const ctx = await monde({ avantFinal: ({ etat }) => { etat.panneApi = () => true; } });
    await refusSansSignature(ctx, /contrôle final/, 'temporaire');
  });
  test('journal modifié pendant la confirmation (tentative ouverte sur le lot) -> refus, aucun marqueur', async () => {
    const ctx = await monde({ avantFinal: ({ setId, base }) => { V.preparerEnvoi(setId, 'cloture_technique', { candidat: { fichier_id: 'drv-candidat', version: '7', generation_cle: 1, statut: 'clos', clos_le: '2026-10-20T07:59:00.000Z' }, preexistantes: [], listingComplet: true }, base); } });
    await refusSansSignature(ctx, /tentative non résolue/, 'temporaire');
  });
  test('fidélité NON attestée : cloturer refuse, aucune dernière observation', async () => {
    const ctx = await monde({ fidelite: 'non' });
    const n = () => ctx.etat.appels.length;
    let avant = null;
    const s = ctx.fab.saisir;
    ctx.fab.saisir = async (q) => { const r = await s(q); if (q === CP.QUESTION_FIDELITE) avant = n(); return r; };
    await refusSansSignature(ctx, /fidélité/, 'local');
    assert.equal(n(), avant, 'aucune observation après la réponse « non »');
  });
  test('question de fidélité JAMAIS posée (cloturer qui signerait sans elle) -> signataire refuse, rien signé', async () => {
    const ctx = await monde();
    const err = await CP.signerPage(ctx.setId, ctx.base, () => ({ ...ctx.fab, cloturer: async (s, d) => { d.signer(Buffer.from('x')); return { dossierLot: '/x' }; } })).then(() => null, (e) => e);
    assert.match(err.message, /contrôle final .*non effectué/);
    assert.equal(ctx.etat.signatures, 0);
  });
  test('Cloturer modifié ENTRE la quiescence et le listing (clôture répétée acceptable) : la référence reste la PREMIÈRE observation -> refus', async () => {
    const ctx = await monde();
    const prep = ctx.fab.preparerSignataire;
    ctx.fab.preparerSignataire = async () => {
      ctx.execs[T.cloture].push({ id: 24, workflowId: T.cloture, status: 'success', startedAt: '2026-10-20T08:10:00.000Z', stoppedAt: '2026-10-20T08:11:00.000Z' });
      ctx.specs[24] = ['cloture', { ...ctx.specs[20][1], deja_clos: true }];
      return prep();
    };
    await refusSansSignature(ctx, /contrôle final/, 'temporaire');
  });
  test('cloturer qui rendrait un résultat SANS contrôle final ni signature -> résultat ignoré (refus)', async () => {
    const ctx = await monde();
    const err = await CP.signerPage(ctx.setId, ctx.base, () => ({ ...ctx.fab, cloturer: async () => ({ dossierLot: '/x' }) })).then(() => null, (e) => e);
    assert.match(err.message, /résultat ignoré/);
  });
  test('texte de la question ÉPINGLÉ : présent tel quel, une seule fois, dans signer-cloture.js', () => {
    const src = fs.readFileSync(path.join(__dirname, 'signer-cloture.js'), 'utf8');
    const litteral = `'${CP.QUESTION_FIDELITE.replace(/'/g, "\\'")}'`;
    assert.equal(src.split(litteral).length, 2, 'question de fidélité modifiée ou dupliquée : le point d\'accroche du contrôle final est perdu');
  });
});

describe('fabrique de production : transports injectés, GET seulement, aucune redirection', () => {
  test('clé du signataire en GET n8n seulement ; Drive en GET ; toute requête en redirect « error » ; phrase injectée', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cloturer-page-cles-'));
    const sa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    fs.writeFileSync(path.join(tmp, 'drive-compte-service.json'), JSON.stringify({ type: 'service_account', client_email: 'sa@exemple.invalid', private_key: sa.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth.exemple.invalid/token' }));
    fs.writeFileSync(path.join(tmp, 'n8n-signataire.cle'), `${SEN.cleApi}\n`);
    fs.writeFileSync(path.join(tmp, 'cle-test.priv.pem'), privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'phrase-de-test' }));
    const appels = [];
    const rep = (o, status = 200) => ({ ok: status < 300, status, json: async () => o, arrayBuffer: async () => Buffer.from(JSON.stringify(o)) });
    const f = async (url, init = {}) => {
      const u = String(url);
      appels.push({ url: u, methode: init.method || 'GET', entetes: { ...(init.headers || {}) }, redirect: init.redirect });
      if (u.startsWith('https://oauth.')) return rep({ access_token: 'jeton-oauth', expires_in: 3600 });
      if (u.includes('/api/v1/executions?')) return rep({ data: [] });
      if (u.includes('/api/v1/executions/')) return rep({ id: '1' });
      if (u.includes('fields=id,mimeType')) { const id = decodeURIComponent(u.split('/files/')[1].split('?')[0]); return rep({ id, mimeType: 'application/vnd.google-apps.folder', trashed: false }); }
      return rep({ incompleteSearch: false, files: [] });
    };
    const fab = CP.fabrique({ fetch: f, dossierCles: tmp, cles: CLES, cleId: 'cle-test', lirePhrase: async () => 'phrase-de-test', dossier: path.join(tmp, 'clotures') });
    await fab.api.listerExecutions({ workflowId: T.confirmation });
    await fab.api.lireExecution('1');
    const signer = await fab.preparerSignataire();
    assert.ok(crypto.verify('sha256', Buffer.from('x'), { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, signer(Buffer.from('x'))), 'clé synthétique utilisée');
    const d = fab.depsCloture({ api: fab.api, signer });
    assert.equal(d.config.source, 'page_relecture');
    assert.equal(d.config.workflowConfirmation, T.confirmation);
    assert.equal(d.config.workflowCloture, T.cloture);
    assert.equal(d.rattachement, P.rattacherPage);
    assert.equal(await d.drive.lireCandidat('set_fonda_comprendre-consigne_nI_92'), null);
    await d.drive.listerDecisions('set_fonda_comprendre-consigne_nI_92');
    await d.drive.listerCandidats();
    const avecCle = appels.filter((a) => Object.values(a.entetes).includes(SEN.cleApi));
    assert.ok(avecCle.length >= 2);
    assert.ok(avecCle.every((a) => a.methode === 'GET' && a.url.includes('/api/v1/executions')), 'clé du signataire : GET n8n seulement');
    assert.ok(appels.every((a) => a.redirect === 'error'), 'aucune redirection suivie');
    assert.ok(appels.filter((a) => a.methode !== 'GET').every((a) => a.url.startsWith('https://oauth.')), 'seul le jeton OAuth est un POST');
    assert.ok(!appels.some((a) => /\/webhook\//.test(a.url)), 'aucun webhook');
  });
});

// --- Processus RÉELS sous /usr/bin/lockf ----------------------------------------------------------
const lockf = fs.existsSync('/usr/bin/lockf');
const SIGNATAIRE = `
const fs = require('fs'); const CP = require(${JSON.stringify(path.join(__dirname, 'cloturer-page.js'))});
const c = JSON.parse(process.env.CONF);
const attendre = (p) => { const s = new Int32Array(new SharedArrayBuffer(4)); while (!fs.existsSync(p)) Atomics.wait(s, 0, 0, 20); };
const api = { listerExecutions: async () => [], lireExecution: async () => null };
const fab = () => ({ api, workflowGeneration: 'wfGen', preparerSignataire: async () => () => Buffer.alloc(0), depsCloture: () => ({}), saisir: async () => '', afficher: () => {},
  cloturer: async () => { fs.writeFileSync(c.pret, String(process.pid)); attendre(c.go); throw new (require(${JSON.stringify(path.join(__dirname, 'signer-cloture.js'))}).Refus)('fin du test', 'local'); } });
CP.main(c.argv, fab, c.verrous);
`;
const ECRIVAIN = `
const E = require(${JSON.stringify(path.join(__dirname, 'ecrire-relecture.js'))});
const c = JSON.parse(process.env.CONF);
E.main(c.argv, () => { throw new Error('non utilisé'); }, c.verrous);
`;
function lancer(script, conf) {
  const ch = spawn(process.execPath, ['-e', script], { env: { ...process.env, CONF: JSON.stringify(conf) }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  ch.stdout.on('data', (d) => { stdout += d; }); ch.stderr.on('data', (d) => { stderr += d; });
  ch.fin = new Promise((r) => ch.on('exit', (status) => r({ status, stdout, stderr })));
  return ch;
}
const attendreFichier = async (p, ms = 8000) => { const t0 = Date.now(); while (!fs.existsSync(p)) { if (Date.now() - t0 > ms) throw new Error(`attente ${p}`); await new Promise((r) => setTimeout(r, 20)); } };
const dossierVerrou = () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cloturer-page-p-')));
  const t = V.prendreVerrou(d); V.initialiser({ verrous: d, sousVerrou: t.chemin }); fs.closeSync(t.fd);
  return d;
};
describe('processus réels (lockf) : signature <-> écriture exclues par le verrou', { skip: !lockf && 'lockf absent (CI Linux) : à rejouer sur le Mac' }, () => {
  const SET = 'set_fonda_comprendre-consigne_nI_92';
  test('signature en cours (confirmation) : une écriture échoue AUSSITÔT (75)', async () => {
    const d = dossierVerrou();
    const c = { verrous: d, pret: path.join(d, 'pret'), go: path.join(d, 'go'), argv: [SET] };
    const sig = lancer(SIGNATAIRE, c);
    try {
      await attendreFichier(c.pret);
      const r = await lancer(ECRIVAIN, { verrous: d, argv: ['etat'] }).fin;
      assert.equal(r.status, V.OCCUPE, r.stderr);
      fs.writeFileSync(c.go, '');
      const s = await sig.fin;
      assert.equal(s.status, 1);
      assert.match(s.stderr, /fin du test/);
    } finally { try { process.kill(-sig.pid, 'SIGKILL'); } catch { /* fini */ } }
  });
  test('écriture en cours : la signature échoue AUSSITÔT (75), sans rien lire', async () => {
    const d = dossierVerrou();
    const tenu = V.prendreVerrou(d); // un écrivain (autre processus en production) tient le verrou
    try {
      const r = await lancer(SIGNATAIRE, { verrous: d, pret: path.join(d, 'pret'), go: path.join(d, 'go'), argv: [SET] }).fin;
      assert.equal(r.status, V.OCCUPE, r.stderr);
      assert.equal(fs.existsSync(path.join(d, 'pret')), false, 'cloturer jamais atteint');
    } finally { fs.closeSync(tenu.fd); }
  });
  test('TÉMOIN : verrou NEUTRALISÉ (dossiers distincts) -> l\'écriture passerait pendant la signature', async () => {
    const d1 = dossierVerrou(); const d2 = dossierVerrou();
    const c = { verrous: d1, pret: path.join(d1, 'pret'), go: path.join(d1, 'go'), argv: [SET] };
    const sig = lancer(SIGNATAIRE, c);
    try {
      await attendreFichier(c.pret);
      const r = await lancer(ECRIVAIN, { verrous: d2, argv: ['etat'] }).fin;
      assert.equal(r.status, 0, 'sans verrou commun, rien n\'exclut l\'écriture');
      fs.writeFileSync(c.go, '');
      await sig.fin;
    } finally { try { process.kill(-sig.pid, 'SIGKILL'); } catch { /* fini */ } }
  });
  test('main : refus affiché MASQUÉ (adresse), code 1', async () => {
    const d = dossierVerrou();
    const ecrits = [];
    const code = process.exitCode;
    await CP.main([SET], () => ({ api: { listerExecutions: async () => [], lireExecution: async () => null }, workflowGeneration: 'wfGen', preparerSignataire: async () => () => Buffer.alloc(0), depsCloture: () => ({}), saisir: async () => '', afficher: () => {}, cloturer: async () => { throw new SC.Refus(`fichier ${SEN.adresse}.json non conforme`, 'incident'); } }), d, { out: (t) => ecrits.push(t), err: (t) => ecrits.push(t) });
    const sortie = process.exitCode; process.exitCode = code;
    assert.equal(sortie, 1);
    assert.match(ecrits.join(''), /fichier \[adresse masquée\] non conforme/);
    assert.deepEqual(fuite(ecrits.join('')), []);
  });
  test('main : signature réelle -> diagnostic affiché ; avertissement si les décomptes diffèrent', async () => {
    for (const [nb, avert] of [[2, false], [1, true]]) {
      const ctx = await monde({ modifier: ({ specs }) => { specs[20][1].nb_decisions_listees = nb; } });
      const t = V.prendreVerrou(ctx.base.verrous); fs.closeSync(t.fd); // le verrou réel existe (lockf)
      const ecrits = [];
      const code = process.exitCode;
      await CP.main([ctx.setId], () => ctx.fab, ctx.base.verrous, { out: (x) => ecrits.push(x), err: (x) => ecrits.push(x) });
      process.exitCode = code;
      const o = ecrits.join('');
      assert.match(o, /clôturé \(signé\)/, o);
      assert.match(o, new RegExp(`listées par Cloturer = ${nb} ; décisions conformes du lot vues par le signataire = 2`));
      assert.equal(/décomptes différents/.test(o), avert);
      assert.deepEqual(fuite(o), []);
    }
  });
  test('main : erreur interne jamais affichée (son message peut porter un secret)', async () => {
    const d = dossierVerrou();
    const ecrits = [];
    const code = process.exitCode;
    await CP.main([SET], () => { throw new Error(`401 ${SEN.cleApi}`); }, d, { out: (t) => ecrits.push(t), err: (t) => ecrits.push(t) });
    process.exitCode = code;
    assert.match(ecrits.join(''), /erreur interne \(détail non affiché\)/);
    assert.deepEqual(fuite(ecrits.join('')), []);
  });
});
