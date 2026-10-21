// ESSAI INTÉGRÉ du lot 5 (plan étape 5, C6) — sans franchir le point de non-retour réel.
// Montage isolé :
//   - COPIE EXÉCUTABLE du dépôt (clone git + état de travail) : publier-lot.js et moteurs.js
//     résolvent leurs racines DANS la copie ; vraie histoire git (réservation committée sur
//     design ; origin/design simulé par update-ref) ;
//   - clé ÉPHÉMÈRE RSA-3072 déclarée dans la copie de cles.json, privée chiffrée dans un
//     dossier de clés temporaire ; liste de modèles de test ;
//   - génération : l'EXPORT du workflow audité exécuté par le simulateur (réponses HTTP
//     simulées) ; n8n et Drive servis par des transports simulés à partir de cette exécution.
// Parcours : --initialiser -> --diagnostic -> --saisir -> --diagnostic -> clôture (rattachement
// DE TEST) -> --extraire-publication -> publier-lot --dry-run puis publication dans la copie ->
// extraction relancée APRÈS publication. Puis essais négatifs.
// Usage : node --test fonda/scripts/adaptateurs-integration.test.js

'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const A = require('./adaptateurs-production.js');
const SC = require('./signer-cloture.js');
const CLI = require('./signataire-cli.js');
const { executerGraphe } = require('../../n8n/fonda-generation-ia/simulateur.js');
const B = require('../../n8n/fonda-generation-ia/construire-workflow.js');
const FIXTURE = require('./fixtures/execution-generation.json');

const FX = FIXTURE.workflow_ia;
const SET = FX.set_id;
const N = B.NOEUDS;
const RACINE = path.join(__dirname, '..', '..');
const CLE_ID = 'test-eph';
const PHRASE = 'phrase-de-test';

const t = {};
const g = (...a) => execFileSync('git', a, { cwd: t.copie, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
const contenuGithub = (chemin, octets) => ({ type: 'file', encoding: 'base64', path: chemin, size: octets.length, sha: 'blob', content: `${octets.toString('base64').replace(/(.{60})/g, '$1\n')}\n` });
const lireMultipart = (q) => {
  const fr = /boundary=(.+)$/.exec(q.rawContentType)[1];
  const p = q.body.split(`--${fr}`);
  const partie = (x) => x.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
  return { metadonnees: JSON.parse(partie(p[1])), contenu: partie(p[2]) };
};
const envSansRef = () => { const e = { ...process.env }; delete e.FONDA_REF_BASE; return e; };

before(async () => {
  const racineTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fonda-integ-'));
  t.copie = path.join(racineTmp, 'depot');
  t.dossier = path.join(racineTmp, 'clotures');
  t.cles = path.join(racineTmp, 'cles');
  fs.mkdirSync(t.cles, { mode: 0o700 });
  // 1. Copie exécutable : clone + état de travail courant de fonda/ et n8n/.
  execFileSync('git', ['clone', '--quiet', RACINE, t.copie], { stdio: 'ignore' });
  g('checkout', '-q', '-B', 'design');
  g('config', 'user.email', 'test@exemple.invalid'); g('config', 'user.name', 'test');
  for (const d of ['fonda', 'n8n']) fs.cpSync(path.join(RACINE, d), path.join(t.copie, d), { recursive: true, filter: (s) => !s.includes(`${path.sep}.git${path.sep}`) });
  // 2. Clé éphémère, modèles de test, réservation.
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
  fs.writeFileSync(path.join(t.cles, `${CLE_ID}.priv.pem`), privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: PHRASE }));
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  fs.writeFileSync(path.join(t.copie, 'fonda/data/cles', `${CLE_ID}.pem`), pem);
  const cles = JSON.parse(fs.readFileSync(path.join(t.copie, 'fonda/data/cles/cles.json'), 'utf8'));
  cles.push({ cle_id: CLE_ID, fichier: `cles/${CLE_ID}.pem`, sha256_pem: crypto.createHash('sha256').update(pem).digest('hex'), algorithme: 'RSA-SHA256-PKCS1v15', valide_du: '2026-01-01T00:00:00.000Z', valide_au: '2030-01-01T00:00:00.000Z', revoquee_le: null });
  fs.writeFileSync(path.join(t.copie, 'fonda/data/cles/cles.json'), `${JSON.stringify(cles, null, 2)}\n`);
  fs.writeFileSync(path.join(t.copie, 'fonda/data/modeles-autorises.json'), `${JSON.stringify({ schema: 'modeles-autorises/v1', generation_fonda: [FIXTURE.modele] }, null, 2)}\n`);
  const jp = path.join(t.copie, 'fonda/data/set_ids-journal.json');
  const journal = JSON.parse(fs.readFileSync(jp, 'utf8'));
  journal.lignes.push({ set_id: SET, transition: 'reserve', le: '2026-10-20', ref: FX.ref });
  fs.writeFileSync(jp, `${JSON.stringify(journal, null, 2)}\n`);
  g('add', '-A'); g('commit', '-qm', 'état testé + clé éphémère + réservation');
  t.commit = g('rev-parse', 'HEAD');
  g('update-ref', 'refs/remotes/origin/design', t.commit);
  // 3. Génération : l'export du workflow audité, réponses HTTP simulées sur l'état de la copie.
  const GEN = JSON.parse(fs.readFileSync(path.join(t.copie, 'n8n/fonda-generation-ia/box-fonda-generation-ia.json'), 'utf8'));
  const auCommit = (rel) => execFileSync('git', ['show', `${t.commit}:${rel}`], { cwd: t.copie });
  const ok = (body) => ({ statusCode: 200, body });
  const r = await executerGraphe(GEN, { corps: { set_id: SET, ref: FX.ref }, executionId: '901', reponses: {
    [N.commit]: () => ok({ sha: t.commit }),
    [N.journal]: () => ok(contenuGithub('fonda/data/set_ids-journal.json', auCommit('fonda/data/set_ids-journal.json'))),
    [N.referentiel]: () => ok(contenuGithub('fonda/data/referentiel.json', auCommit('fonda/data/referentiel.json'))),
    [N.moteurs]: () => ok(contenuGithub('fonda/engine/moteurs.json', auCommit('fonda/engine/moteurs.json'))),
    [N.existant]: () => ok({ files: [] }),
    [N.ia]: () => ok(FX.reponse_ia),
    [N.deposer]: (q) => { const { metadonnees } = lireMultipart(q); return ok({ id: 'drv-lot', name: metadonnees.name, parents: metadonnees.parents, properties: metadonnees.properties }); },
    [N.relister]: () => ok({ files: [{ id: 'drv-lot' }] }),
  } });
  assert.equal(r.status, 'success', r.erreur);
  const { metadonnees, contenu } = lireMultipart(r.requetes[N.deposer]);
  t.lot = Buffer.from(contenu, 'utf8');
  const execution = { id: '901', workflowId: A.WORKFLOW_GENERATION, status: 'success', mode: 'webhook', startedAt: '2026-10-20T07:00:00.000Z', stoppedAt: '2026-10-20T07:01:30.000Z', workflowData: { pinData: {} }, data: { resultData: { runData: r.runData } } };
  t.api = {
    listerExecutions: async ({ status }) => (status ? [] : [{ id: '901', workflowId: A.WORKFLOW_GENERATION, status: 'success', startedAt: execution.startedAt, stoppedAt: execution.stoppedAt }]),
    lireExecution: async (id) => (id === '901' ? JSON.parse(JSON.stringify(execution)) : null),
  };
  t.drive = {
    verifierDossier: async () => {},
    listerCandidats: async () => ({ incompleteSearch: false, fichiers: [{ id: 'drv-lot', nom: metadonnees.name, modifie_le: '2026-10-20T07:01:00.000Z', properties: metadonnees.properties, proprietesLisibles: true }] }),
    lireLotGenere: async () => ({ id: 'drv-lot', nom: metadonnees.name, modifie_le: '2026-10-20T07:01:00.000Z', octets: Buffer.from(t.lot) }),
    candidatsDuSetId: async () => 1,
  };
  t.sources = () => A.sourcesLecture({ racine: t.copie, dossier: t.dossier, dossierCles: t.cles, api: t.api, drive: t.drive });
});

describe('parcours complet (sans non-retour réel)', () => {
  test('--initialiser puis registre : un incident ANCIEN, résolu, hors fenêtre', async () => {
    assert.deepEqual(await CLI.executer({ commande: '--initialiser' }, { sources: t.sources() }), { initialise: true });
    fs.writeFileSync(path.join(t.dossier, 'incidents.json'), `${JSON.stringify([{ id: 'inc-ancien', nature: 'panne de test', detecte_le: '2026-01-01T10:00:00.000Z', statut: 'resolu', resolu_le: '2026-01-02T10:00:00.000Z', preuve_resolution: 'test', periode: { debut: '2026-01-01T09:00:00.000Z', fin: '2026-01-02T10:00:00.000Z' } }], null, 2)}\n`);
  });
  test('--diagnostic : pret_pour_saisie', async () => {
    const d = await CLI.executer({ commande: '--diagnostic', setId: SET }, { sources: t.sources() });
    assert.equal(d.etat, 'pret_pour_saisie', JSON.stringify(d.applicables));
  });
  test('--saisir : décision figée (fabrique de saisie complète)', async () => {
    const reponses = ['garder', 'garder', 'ecarter', 'oui'];
    const r = await CLI.executer({ commande: '--saisir', setId: SET }, { sources: t.sources(), saisir: async () => reponses.shift(), afficher: () => {} });
    assert.equal(r.figee, true);
    assert.deepEqual(r.decision.coeur.selection, ['it01', 'it02']);
  });
  test('--diagnostic : pret_pour_cloture (le plus avancé, avant decision_figee et pret_pour_saisie)', async () => {
    const d = await CLI.executer({ commande: '--diagnostic', setId: SET }, { sources: t.sources() });
    assert.equal(d.etat, 'pret_pour_cloture', JSON.stringify(d.applicables));
    assert.deepEqual(d.applicables.map((x) => x.etat), ['pret_pour_cloture', 'decision_figee', 'pret_pour_saisie']);
  });
  test('pret_pour_cloture EXCLUT : décision « rejeter », incident résolu couvrant la fenêtre, exécution en cours non attribuée', async () => {
    const diag = async (modif) => (await CLI.executer({ commande: '--diagnostic', setId: SET }, { sources: { ...t.sources(), ...modif } }));
    const s0 = t.sources();
    const dec = (await s0.decisionsLocales(SET)).map((f) => JSON.parse(f.octets.toString('utf8')))[0];
    const rejet = { ...dec, coeur: { ...dec.coeur, action: 'rejeter' } };
    const r1 = await diag({ decisionsLocales: async () => [{ nom: 'decision.json', octets: Buffer.from(JSON.stringify(rejet)) }] });
    assert.equal(r1.etat, 'decision_figee');
    assert.match(String(r1.detail), /rejeter/);
    const incCouvrant = { id: 'inc-fenetre', nature: 'n', detecte_le: '2026-10-20T07:30:00.000Z', statut: 'resolu', resolu_le: '2026-10-20T08:00:00.000Z', preuve_resolution: 'p', periode: { debut: '2026-10-20T07:10:00.000Z', fin: '2026-10-20T08:00:00.000Z' } };
    const r2 = await diag({ incidents: async () => [incCouvrant] });
    assert.equal(r2.etat, 'decision_figee');
    assert.match(String(r2.detail), /inc-fenetre/);
    const enVol = { ...t.api, listerExecutions: async (q) => [...await t.api.listerExecutions(q), ...(q.status === 'running' || !q.status ? [{ id: '950', workflowId: A.WORKFLOW_GENERATION, status: 'running', startedAt: '2026-10-21T08:00:00.000Z', stoppedAt: null }] : [])] };
    const r3 = await diag({ api: enVol });
    assert.equal(r3.etat, 'generation_en_cours');
    assert.ok(!r3.applicables.some((x) => x.etat === 'pret_pour_cloture'), 'jamais prêt pour la clôture pendant une exécution en vol');
  });
  test('clé : phrase fausse, annulation -> refus AVANT toute clôture, aucun marqueur', async () => {
    const cles = t.sources().cles;
    await assert.rejects(() => A.preparerSignataire({ dossierCles: t.cles, cleId: CLE_ID, cles, lirePhrase: async () => 'fausse' }), /incorrecte/);
    await assert.rejects(() => A.preparerSignataire({ dossierCles: t.cles, cleId: CLE_ID, cles, lirePhrase: async () => null }), /annulée/);
    assert.ok(!fs.existsSync(path.join(t.dossier, `${SET}.signature`)));
  });
  test('clôture (rattachement DE TEST) : attestation v2 signée et revérifiée', async () => {
    const s = t.sources();
    const signer = await A.preparerSignataire({ dossierCles: t.cles, cleId: CLE_ID, cles: s.cles, lirePhrase: async () => PHRASE });
    let affiche = '';
    const deps = A.dependancesCloture({
      sources: s, signer, cleId: CLE_ID, rattachement: () => null,
      saisir: async (q) => (/Code/.test(q) ? /CODE DE CONFIRMATION : ([0-9a-f]{16})/.exec(affiche)[1] : 'oui'),
      afficher: (x) => { affiche += x; },
    });
    const r = await SC.cloturer(SET, deps);
    t.dossierLot = r.dossierLot;
    assert.equal(r.enveloppe.charge.source_decisions, 'saisie_locale');
    assert.deepEqual(r.enveloppe.charge.incidents_connus.map((i) => i.id), ['inc-ancien'], 'incident résolu cité par la charge signée');
    assert.ok(fs.existsSync(path.join(t.dossier, `${SET}.signature`)));
  });
  test('--diagnostic : signe', async () => {
    assert.equal((await CLI.executer({ commande: '--diagnostic', setId: SET }, { sources: t.sources() })).etat, 'signe');
  });
  test('--extraire-publication : vérification complète, lot-relu.json ; relance = succès sans écriture', async () => {
    const r1 = await CLI.executer({ commande: '--extraire-publication', setId: SET }, { sources: t.sources() });
    assert.equal(r1.ecrit, true);
    const lot = JSON.parse(fs.readFileSync(r1.chemin, 'utf8'));
    assert.deepEqual(lot.cartes.map((c) => c.item_id), ['it01', 'it02']);
    assert.equal(lot.revue_carte_par_carte, true);
    assert.equal((await CLI.executer({ commande: '--extraire-publication', setId: SET }, { sources: t.sources() })).ecrit, false);
  });
  test('publier-lot.js (de la COPIE) : --dry-run puis publication réelle dans la copie', () => {
    const args = [path.join(t.copie, 'fonda/scripts/publier-lot.js'), path.join(t.dossierLot, 'lot-relu.json'), path.join(t.dossierLot, 'attestation.json')];
    const sec = spawnSync(process.execPath, [...args, '--dry-run'], { cwd: t.copie, encoding: 'utf8', env: envSansRef() });
    assert.equal(sec.status, 0, sec.stderr + sec.stdout);
    const reel = spawnSync(process.execPath, args, { cwd: t.copie, encoding: 'utf8', env: envSansRef() });
    assert.equal(reel.status, 0, reel.stderr + reel.stdout);
    assert.ok(fs.existsSync(path.join(t.copie, `fonda/data/lots/${SET}.json`)));
  });
  test('--extraire-publication APRÈS publication : toujours relançable (aucun état de publication consulté)', async () => {
    assert.equal((await CLI.executer({ commande: '--extraire-publication', setId: SET }, { sources: t.sources() })).ecrit, false);
  });
});

describe('essais négatifs après clôture', () => {
  const copieLot = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fonda-alt-'));
    const dl = path.join(d, path.basename(t.dossierLot));
    fs.cpSync(t.dossierLot, dl, { recursive: true });
    fs.rmSync(path.join(dl, 'lot-relu.json'), { force: true });
    return { d, dl };
  };
  test('instantané altéré -> extraction refusée (SHA signé)', async () => {
    const { dl } = copieLot();
    const p = path.join(dl, 'instantane.json');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('"it01"', '"it01" '));
    await assert.rejects(() => t.sources().verifier(dl), /sha256_instantane/);
  });
  test('attestation altérée (signature) -> extraction refusée', async () => {
    const { dl } = copieLot();
    const p = path.join(dl, 'attestation.json');
    const a = JSON.parse(fs.readFileSync(p, 'utf8'));
    const sig = Buffer.from(a.signature, 'base64'); sig[10] ^= 1; a.signature = sig.toString('base64');
    fs.writeFileSync(p, JSON.stringify(a));
    await assert.rejects(() => t.sources().verifier(dl), /non vérifiée/);
  });
  test('lot-relu.json existant et DIFFÉRENT -> refus', () => {
    const p = path.join(t.dossierLot, 'lot-relu.json');
    const avant = fs.readFileSync(p);
    assert.throws(() => CLI.ecrireLotRelu(p, `${avant.toString('utf8')} `), /DIFFÈRE/);
    assert.ok(fs.readFileSync(p).equals(avant));
  });
  test('registre réinitialisé à [] après une clôture citant un incident -> témoin en échec (restauration requise)', async () => {
    const p = path.join(t.dossier, 'incidents.json');
    const avant = fs.readFileSync(p);
    try {
      fs.writeFileSync(p, '[]\n');
      await assert.rejects(() => t.sources().incidents(), /incomplet.*inc-ancien/);
      assert.equal((await CLI.executer({ commande: '--diagnostic', setId: SET }, { sources: t.sources() })).etat, 'acces_ko');
    } finally { fs.writeFileSync(p, avant); }
  });
  test('--initialiser après usage : refusé (traces), jamais de remise à zéro', async () => {
    const p = path.join(t.dossier, 'incidents.json');
    fs.renameSync(p, `${p}.bak`); fs.renameSync(path.join(t.dossier, '.initialise'), path.join(t.dossier, '.initialise.bak'));
    try {
      await assert.rejects(() => CLI.executer({ commande: '--initialiser' }, { sources: t.sources() }), /usage antérieur/);
      assert.ok(!fs.existsSync(p));
    } finally { fs.renameSync(`${p}.bak`, p); fs.renameSync(path.join(t.dossier, '.initialise.bak'), path.join(t.dossier, '.initialise')); }
  });
});

describe('--diagnostic hermétique', () => {
  test('aucune écriture (fs, child_process) et aucune lecture de clé de SIGNATURE', async () => {
    const ecritures = [];
    const lectures = [];
    const origine = {};
    for (const f of ['writeFileSync', 'appendFileSync', 'openSync', 'mkdirSync', 'renameSync', 'unlinkSync', 'rmSync', 'copyFileSync']) {
      origine[f] = fs[f];
      fs[f] = function espion(p, ...r) {
        if (f !== 'openSync' || /[wa+x]/.test(String(r[0] || 'r'))) ecritures.push(`${f} ${p}`);
        if (String(p).endsWith('.priv.pem')) lectures.push(String(p));
        return origine[f].call(this, p, ...r);
      };
    }
    const rf = fs.readFileSync;
    fs.readFileSync = function espion(p, ...r) { if (String(p).endsWith('.priv.pem')) lectures.push(String(p)); return rf.call(this, p, ...r); };
    const gitArgs = [];
    const git = (a) => { gitArgs.push(a.join(' ')); return execFileSync('git', a, { cwd: t.copie, stdio: ['ignore', 'pipe', 'ignore'] }); };
    let d;
    try {
      const s = A.sourcesLecture({ racine: t.copie, dossier: t.dossier, dossierCles: t.cles, api: t.api, drive: t.drive, git });
      d = await require('./diagnostic-fonda.js').diagnostiquer(SET, s);
    } finally {
      for (const f of Object.keys(origine)) fs[f] = origine[f];
      fs.readFileSync = rf;
    }
    assert.equal(d.etat, 'signe', 'le diagnostic a réellement tourné');
    assert.ok(gitArgs.length > 0, 'git réellement observé');
    assert.ok(gitArgs.every((x) => /^(rev-parse|rev-list|show|cat-file|log|ls-tree)\b/.test(x)), `commande git non lecture : ${gitArgs.join(' | ')}`);
    assert.deepEqual(ecritures, []);
    assert.deepEqual(lectures, []);
  });
});
