// ESSAI INTÉGRÉ du lot 5 (plan étape 5, C6) — sans franchir le point de non-retour réel.
// Montage isolé :
//   - COPIE EXÉCUTABLE du dépôt : clone git + SEULS les fichiers SUIVIS (git ls-files) de l'état
//     de travail (jamais un fichier non suivi : secrets locaux exclus). TOUS les modules testés
//     (adaptateurs, signataire, CLI, diagnostic, publication, simulateur) sont chargés DEPUIS la
//     copie ; vraie histoire git (réservation committée sur design ; origin/design avancé par
//     update-ref, y compris après la publication committée) ;
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
const FIXTURE = require('./fixtures/execution-generation.json');

const FX = FIXTURE.workflow_ia;
const SET = FX.set_id;
const RACINE = path.join(__dirname, '..', '..');
const CLE_ID = 'test-eph';
const PHRASE = 'phrase-de-test';
const INC_ANCIEN = { id: 'inc-ancien', nature: 'panne de test', detecte_le: '2026-01-01T10:00:00.000Z', statut: 'resolu', resolu_le: '2026-01-02T10:00:00.000Z', preuve_resolution: 'test', periode: { debut: '2026-01-01T09:00:00.000Z', fin: '2026-01-02T10:00:00.000Z' } };

const t = {};
let A; let SC; let CLI; let D;
const g = (...a) => execFileSync('git', a, { cwd: t.copie, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
const contenuGithub = (chemin, octets) => ({ type: 'file', encoding: 'base64', path: chemin, size: octets.length, sha: 'blob', content: `${octets.toString('base64').replace(/(.{60})/g, '$1\n')}\n` });
const lireMultipart = (q) => {
  const fr = /boundary=(.+)$/.exec(q.rawContentType)[1];
  const p = q.body.split(`--${fr}`);
  const partie = (x) => x.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
  return { metadonnees: JSON.parse(partie(p[1])), contenu: partie(p[2]) };
};
const envSansRef = () => { const e = { ...process.env }; delete e.FONDA_REF_BASE; return e; };
// Copie des SEULS fichiers suivis (index courant) depuis l'état de travail.
function copierSuivis(depuis, vers) {
  const liste = execFileSync('git', ['ls-files', '-z', '--cached'], { cwd: depuis }).toString('utf8').split('\0').filter(Boolean);
  for (const rel of liste) {
    const src = path.join(depuis, rel);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    fs.mkdirSync(path.dirname(path.join(vers, rel)), { recursive: true });
    fs.copyFileSync(src, path.join(vers, rel));
  }
  return liste;
}
const cloneSuivi = (vers) => {
  execFileSync('git', ['clone', '--quiet', RACINE, vers], { stdio: 'ignore' });
  execFileSync('git', ['checkout', '-q', '-B', 'design'], { cwd: vers, stdio: 'ignore' });
  return copierSuivis(RACINE, vers);
};

before(async () => {
  const racineTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fonda-integ-'));
  t.copie = path.join(racineTmp, 'depot');
  t.dossier = path.join(racineTmp, 'clotures');
  t.cles = path.join(racineTmp, 'cles');
  fs.mkdirSync(t.cles, { mode: 0o700 });
  // 1. Copie exécutable (fichiers suivis seulement) ; modules chargés depuis la copie.
  t.suivis = cloneSuivi(t.copie);
  g('config', 'user.email', 'test@exemple.invalid'); g('config', 'user.name', 'test');
  const charger = (rel) => require(path.join(t.copie, rel));
  A = charger('fonda/scripts/adaptateurs-production.js');
  SC = charger('fonda/scripts/signer-cloture.js');
  CLI = charger('fonda/scripts/signataire-cli.js');
  D = charger('fonda/scripts/diagnostic-fonda.js');
  const { executerGraphe } = charger('n8n/fonda-generation-ia/simulateur.js');
  const N = charger('n8n/fonda-generation-ia/construire-workflow.js').NOEUDS;
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
  g('add', '-A'); g('commit', '-qm', 'état testé (fichiers suivis) + clé éphémère + réservation');
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
  t.execution = { id: '901', workflowId: A.WORKFLOW_GENERATION, status: 'success', mode: 'webhook', startedAt: '2026-10-20T07:00:00.000Z', stoppedAt: '2026-10-20T07:01:30.000Z', workflowData: { pinData: {} }, data: { resultData: { runData: r.runData } } };
  t.api = {
    listerExecutions: async ({ status }) => (status ? [] : [{ id: '901', workflowId: A.WORKFLOW_GENERATION, status: 'success', startedAt: t.execution.startedAt, stoppedAt: t.execution.stoppedAt }]),
    lireExecution: async (id) => (id === '901' ? JSON.parse(JSON.stringify(t.execution)) : null),
  };
  t.fichier = { id: 'drv-lot', nom: metadonnees.name, modifie_le: '2026-10-20T07:01:00.000Z', properties: metadonnees.properties, proprietesLisibles: true };
  t.drive = {
    verifierDossier: async () => {},
    listerCandidats: async () => ({ incompleteSearch: false, fichiers: [{ ...t.fichier }] }),
    lireLotGenere: async () => ({ id: 'drv-lot', nom: metadonnees.name, modifie_le: '2026-10-20T07:01:00.000Z', octets: Buffer.from(t.lot) }),
    candidatsDuSetId: async () => 1,
  };
  t.sources = (sur = {}) => ({ ...A.sourcesLecture({ racine: t.copie, dossier: t.dossier, dossierCles: t.cles, api: t.api, drive: t.drive }), ...sur });
});

const diag = async (sur) => CLI.executer({ commande: '--diagnostic', setId: SET }, { sources: t.sources(sur) });
const sansSecret = () => ({ racine: t.copie, dossier: t.dossier, dossierCles: fs.mkdtempSync(path.join(os.tmpdir(), 'fonda-vide-')) });

describe('montage', () => {
  test('aucun fichier NON SUIVI copié (secrets locaux exclus) ; modules chargés depuis la copie', () => {
    assert.ok(t.suivis.length > 50);
    assert.ok(!t.suivis.some((f) => f.startsWith('n8n/secrets')));
    assert.ok(!fs.existsSync(path.join(t.copie, 'n8n/secrets-2026-10-13')));
    const charges = Object.keys(require.cache).filter((f) => /adaptateurs-production\.js$|signer-cloture\.js$|diagnostic-fonda\.js$|publier-lot\.js$/.test(f));
    assert.ok(charges.length >= 4);
    assert.ok(charges.every((f) => fs.realpathSync(f).startsWith(fs.realpathSync(t.copie))), `module chargé hors copie : ${charges.join(' | ')}`);
  });
});

describe('parcours complet (sans non-retour réel)', () => {
  test('--initialiser (sources LOCALES, sans aucun secret réseau) ; registre §10 B : incident ANCIEN', async () => {
    assert.deepEqual(await CLI.executer({ commande: '--initialiser' }, sansSecret()), { initialise: true });
    fs.writeFileSync(path.join(t.dossier, 'incidents.json'), `${JSON.stringify([INC_ANCIEN], null, 2)}\n`);
  });
  test('--diagnostic : pret_pour_saisie', async () => {
    const d = await CLI.executer({ commande: '--diagnostic', setId: SET }, { sources: t.sources() });
    assert.equal(d.etat, 'pret_pour_saisie', JSON.stringify(d.applicables));
  });
  test('--diagnostic : génération réussie SANS candidat, ou candidat SANS génération -> generation_incoherente', async () => {
    assert.equal((await diag({ drive: { ...t.drive, listerCandidats: async () => ({ incompleteSearch: false, fichiers: [] }) } })).etat, 'generation_incoherente');
    assert.equal((await diag({ api: { listerExecutions: async () => [], lireExecution: async () => null } })).etat, 'generation_incoherente');
  });
  test('--diagnostic : recherche Drive incomplète -> acces_ko, jamais prêt', async () => {
    const d = await diag({ drive: { ...t.drive, listerCandidats: async () => ({ incompleteSearch: true, fichiers: [{ ...t.fichier }] }) } });
    assert.equal(d.etat, 'acces_ko');
    assert.ok(!d.applicables.some((x) => x.etat === 'pret_pour_saisie'));
  });
  test('--diagnostic : lot modifié entre les deux lectures -> candidat_non_conforme', async () => {
    let n = 0;
    const d = await diag({ drive: { ...t.drive, lireLotGenere: async () => { n += 1; const o = await t.drive.lireLotGenere(); return n === 1 ? o : { ...o, modifie_le: '2026-10-20T07:02:00.000Z' }; } } });
    assert.equal(d.etat, 'candidat_non_conforme');
  });
  test('--diagnostic : référentiel archivé introuvable -> candidat_non_conforme', async () => {
    assert.equal((await diag({ referentielArchive: async () => { throw new Error('introuvable'); } })).etat, 'candidat_non_conforme');
  });
  test('r2 #1 : lot au JSON invalide (mêmes octets aux deux lectures) -> candidat_non_conforme, jamais prêt', async () => {
    const d = await diag({ drive: { ...t.drive, lireLotGenere: async () => ({ ...(await t.drive.lireLotGenere()), octets: Buffer.from('{ pas du json') }) } });
    assert.equal(d.etat, 'candidat_non_conforme', JSON.stringify(d.applicables));
    assert.match(String(d.detail), /JSON invalide/);
  });
  test('r3 : contenus JSON valides mais « faux » (null, false, 0, "") -> candidat_non_conforme, jamais prêt', async () => {
    for (const texte of ['null', 'false', '0', '""']) {
      const d = await diag({ drive: { ...t.drive, lireLotGenere: async () => ({ ...(await t.drive.lireLotGenere()), octets: Buffer.from(texte) }) } });
      assert.equal(d.etat, 'candidat_non_conforme', `${texte} : ${JSON.stringify(d.applicables)}`);
      assert.ok(!d.applicables.some((x) => /^pret_/.test(x.etat)), texte);
    }
  });
  test('r2 #2 : lot lu d\'un AUTRE fichier que le listé, ou modifié après la génération -> candidat_non_conforme', async () => {
    const autre = await diag({ drive: { ...t.drive, lireLotGenere: async () => ({ ...(await t.drive.lireLotGenere()), id: 'drv-autre', modifie_le: '2026-10-20T09:00:00.000Z' }) } });
    assert.equal(autre.etat, 'candidat_non_conforme');
    assert.match(String(autre.detail), /fichier candidat listé|candidat_fichier_id/);
    const tard = '2026-10-20T09:00:00.000Z';
    const apres = await diag({ drive: { ...t.drive, listerCandidats: async () => ({ incompleteSearch: false, fichiers: [{ ...t.fichier, modifie_le: tard }] }), lireLotGenere: async () => ({ ...(await t.drive.lireLotGenere()), modifie_le: tard }) } });
    assert.equal(apres.etat, 'candidat_non_conforme');
    assert.match(String(apres.detail), /APRÈS la fin/);
    const ecart = await diag({ drive: { ...t.drive, listerCandidats: async () => ({ incompleteSearch: false, fichiers: [{ ...t.fichier, modifie_le: '2026-10-20T07:00:30.000Z' }] }) } });
    assert.equal(ecart.etat, 'candidat_non_conforme');
  });
  test('r2 #3 : relecteur attribué ≠ « eric » (fonction RÉELLE du signataire) -> relecteur_non_local, jamais prêt', async () => {
    const vrai = SC.relecteurDeLaGeneration;
    let appels = 0;
    SC.relecteurDeLaGeneration = async (...a) => { appels += 1; assert.equal(await vrai(...a), 'eric'); return 'justine'; };
    try {
      const d = await diag();
      assert.equal(appels, 1, 'le diagnostic passe par la fonction du signataire');
      assert.equal(d.etat, 'relecteur_non_local');
      assert.ok(!d.applicables.some((x) => /^pret_/.test(x.etat)));
    } finally { SC.relecteurDeLaGeneration = vrai; }
  });
  test('r2 #7 : --saisir interrompue (fin d\'entrée) -> code ≠ 0, AUCUNE décision figée', async () => {
    const avant = process.exitCode; const err = console.error; let msg = '';
    console.error = (m) => { msg += m; };
    let n = 0;
    try {
      await CLI.main(['--saisir', SET], { sources: t.sources(), afficher: () => {}, saisir: async () => { n += 1; if (n === 1) return 'garder'; throw new A.SaisieInterrompue('saisie interrompue (fin d\'entrée) : aucune décision figée'); } });
      assert.equal(process.exitCode, 1);
    } finally { console.error = err; process.exitCode = avant; }
    assert.match(msg, /fin d'entrée/);
    assert.deepEqual(await t.sources().decisionsLocales(SET), []);
  });
  test('--saisir : décision figée ; la fabrique PAR DÉFAUT fournit la saisie au terminal', async () => {
    const parDefaut = await A.dependancesSaisie(SET, { sources: t.sources() });
    assert.equal(parDefaut.saisir, A.saisirTerminal);
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
  test('r2 #4 : deux décisions figées ne différant que par le nonce -> decision_non_conforme', async () => {
    const f = (await t.sources().decisionsLocales(SET))[0];
    const dec = JSON.parse(f.octets.toString('utf8'));
    const d = await diag({ decisionsLocales: async () => [f, { nom: 'decision-2.json', octets: Buffer.from(JSON.stringify({ ...dec, nonce: `${dec.nonce}x` })) }] });
    assert.equal(d.etat, 'decision_non_conforme', JSON.stringify(d.applicables));
    assert.match(String(d.detail), /distinctes/);
  });
  test('décision d\'un AUTRE set_id, empreinte relue discordante, illisible -> decision_non_conforme', async () => {
    const dec = (await t.sources().decisionsLocales(SET)).map((f) => JSON.parse(f.octets.toString('utf8')))[0];
    const avec = (d) => diag({ decisionsLocales: async () => [{ nom: 'decision.json', octets: Buffer.from(typeof d === 'string' ? d : JSON.stringify(d)) }] });
    for (const d of [{ ...dec, set_id: 'set_fonda_lexique_nI_01' }, { ...dec, coeur: { ...dec.coeur, empreinte_relue: `sha256:${'0'.repeat(64)}` } }, '{ illisible']) {
      const r = await avec(d);
      assert.equal(r.etat, 'decision_non_conforme', JSON.stringify(r.applicables));
      assert.ok(!r.applicables.some((x) => x.etat === 'pret_pour_cloture'));
    }
  });
  test('clé : phrase fausse, annulation -> refus AVANT toute clôture, aucun marqueur', async () => {
    const cles = t.sources().cles;
    await assert.rejects(() => A.preparerSignataire({ dossierCles: t.cles, cleId: CLE_ID, cles, lirePhrase: async () => 'fausse' }), /incorrecte/);
    await assert.rejects(() => A.preparerSignataire({ dossierCles: t.cles, cleId: CLE_ID, cles, lirePhrase: async () => null }), /annulée/);
    assert.ok(!fs.existsSync(path.join(t.dossier, `${SET}.signature`)));
  });
  test('clôture de PRODUCTION (cloturerSaisieLocale : deps du lot 5, clé préparée avant, rattachement « poison ») : attestation v2 signée', async () => {
    let affiche = '';
    const r = await SC.cloturerSaisieLocale(SET, {
      sources: t.sources(), cleId: CLE_ID, lirePhrase: async () => PHRASE,
      saisir: async (q) => (/Code/.test(q) ? /CODE DE CONFIRMATION : ([0-9a-f]{16})/.exec(affiche)[1] : 'oui'),
      afficher: (x) => { affiche += x; },
    });
    t.dossierLot = r.dossierLot;
    assert.equal(r.enveloppe.charge.source_decisions, 'saisie_locale');
    assert.deepEqual(r.enveloppe.charge.incidents_connus.map((i) => i.id), ['inc-ancien'], 'incident résolu cité par la charge signée');
    assert.ok(fs.existsSync(path.join(t.dossier, `${SET}.signature`)));
  });
  test('--diagnostic : signe', async () => {
    assert.equal((await CLI.executer({ commande: '--diagnostic', setId: SET }, { sources: t.sources() })).etat, 'signe');
  });
  test('r2 #5 : marqueur .signature SANS pièces vérifiées -> signature_interrompue, jamais signe', async () => {
    const d = await diag({ verifier: async () => { throw new Error('pièces absentes ou invalides'); } });
    assert.equal(d.etat, 'signature_interrompue');
    assert.ok(!d.applicables.some((x) => x.etat === 'signe'));
  });
  test('--extraire-publication (SANS secret réseau) : vérification complète ; relance = succès sans écriture', async () => {
    const o = sansSecret();
    const r1 = await CLI.executer({ commande: '--extraire-publication', setId: SET }, o);
    assert.equal(r1.ecrit, true);
    const lot = JSON.parse(fs.readFileSync(r1.chemin, 'utf8'));
    assert.deepEqual(lot.cartes.map((c) => c.item_id), ['it01', 'it02']);
    assert.equal(lot.revue_carte_par_carte, true);
    assert.equal((await CLI.executer({ commande: '--extraire-publication', setId: SET }, o)).ecrit, false);
  });
  test('publier-lot.js (de la COPIE) : --dry-run, publication, COMMIT, origin/design avancé', () => {
    const args = [path.join(t.copie, 'fonda/scripts/publier-lot.js'), path.join(t.dossierLot, 'lot-relu.json'), path.join(t.dossierLot, 'attestation.json')];
    const sec = spawnSync(process.execPath, [...args, '--dry-run'], { cwd: t.copie, encoding: 'utf8', env: envSansRef() });
    assert.equal(sec.status, 0, sec.stderr + sec.stdout);
    const reel = spawnSync(process.execPath, args, { cwd: t.copie, encoding: 'utf8', env: envSansRef() });
    assert.equal(reel.status, 0, reel.stderr + reel.stdout);
    assert.ok(fs.existsSync(path.join(t.copie, `fonda/data/lots/${SET}.json`)));
    g('add', '-A'); g('commit', '-qm', `publication ${SET}`);
    g('update-ref', 'refs/remotes/origin/design', g('rev-parse', 'HEAD'));
    const cat = JSON.parse(g('show', 'origin/design:fonda/data/catalogue-fonda.json'));
    assert.ok(cat.lots.some((e) => e.set_id === SET && e.attestation.type === 'cloture-signee'));
  });
  test('APRÈS publication committée : extraction relançable ; témoin vérifie la clôture publiée', async () => {
    assert.equal((await CLI.executer({ commande: '--extraire-publication', setId: SET }, sansSecret())).ecrit, false);
    const ac = await t.sources().attestationsCatalogue();
    assert.ok(ac.some((x) => x.entree.set_id === SET), JSON.stringify(ac.map((x) => x.entree && x.entree.set_id)));
    assert.deepEqual((await t.sources().incidents()).map((i) => i.id), ['inc-ancien']);
    assert.equal((await diag()).etat, 'signe');
  });
});

describe('essais négatifs après clôture', () => {
  const copieLot = (nom) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fonda-alt-'));
    const dl = path.join(d, nom || path.basename(t.dossierLot));
    fs.cpSync(t.dossierLot, dl, { recursive: true });
    fs.rmSync(path.join(dl, 'lot-relu.json'), { force: true });
    return { d, dl };
  };
  test('instantané altéré -> extraction refusée (SHA signé)', async () => {
    const { dl } = copieLot();
    const p = path.join(dl, 'instantane.json');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('"it01"', '"it01" '));
    await assert.rejects(() => t.sources().verifier(dl, SET), /sha256_instantane/);
  });
  test('attestation altérée (signature) -> extraction refusée', async () => {
    const { dl } = copieLot();
    const p = path.join(dl, 'attestation.json');
    const a = JSON.parse(fs.readFileSync(p, 'utf8'));
    const sig = Buffer.from(a.signature, 'base64'); sig[10] ^= 1; a.signature = sig.toString('base64');
    fs.writeFileSync(p, JSON.stringify(a));
    await assert.rejects(() => t.sources().verifier(dl, SET), /non vérifiée/);
  });
  test('pièces AUTHENTIQUES dans un dossier mal nommé, ou pour un autre set_id demandé -> refus', async () => {
    const { dl } = copieLot(`${SET}-ffffffffffffffff`);
    await assert.rejects(() => t.sources().verifier(dl, SET), /chemin canonique|dossier/);
    await assert.rejects(() => t.sources().verifier(t.dossierLot, 'set_fonda_lexique_nI_01'), /set_fonda_lexique_nI_01/);
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
      assert.equal((await diag()).etat, 'acces_ko');
    } finally { fs.writeFileSync(p, avant); }
  });
  test('--initialiser après usage : refusé (traces), jamais de remise à zéro', async () => {
    const p = path.join(t.dossier, 'incidents.json');
    fs.renameSync(p, `${p}.bak`); fs.renameSync(path.join(t.dossier, '.initialise'), path.join(t.dossier, '.initialise.bak'));
    try {
      await assert.rejects(() => CLI.executer({ commande: '--initialiser' }, sansSecret()), /usage antérieur/);
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
      d = await D.diagnostiquer(SET, s);
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

describe('lot 4 bis : --palier (réservation réelle dans une copie)', () => {
  test('seul le palier choisi est réservé ; palier absent du référentiel refusé SANS écriture ; journal valide', () => {
    const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fonda-palier-')), 'depot');
    cloneSuivi(d);
    const Journal = require(path.join(d, 'fonda/engine/journal-set-ids.js'));
    const jp = path.join(d, 'fonda/data/set_ids-journal.json');
    const avant = JSON.parse(fs.readFileSync(jp, 'utf8')).lignes.length;
    const cli = (...a) => spawnSync(process.execPath, [path.join(d, 'fonda/scripts/generer-lot-fonda.js'), ...a], { cwd: d, encoding: 'utf8', env: envSansRef() });
    const r = cli('--reserver', 'maths.proportionnalite', '--palier', 'nI');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const j = JSON.parse(fs.readFileSync(jp, 'utf8'));
    const nouvelles = j.lignes.slice(avant);
    assert.equal(nouvelles.length, 1);
    assert.match(nouvelles[0].set_id, /_nI_\d{2}$/);
    assert.equal(Journal.validerJournal(j).valide, true);
    const rp = path.join(d, 'fonda/data/referentiel.json');
    const ref = JSON.parse(fs.readFileSync(rp, 'utf8'));
    ref.notions.find((n) => n.id === 'maths.proportionnalite').paliers = ['nI'];
    fs.writeFileSync(rp, JSON.stringify(ref, null, 2));
    const octets = fs.readFileSync(jp);
    const refus = cli('--reserver', 'maths.proportionnalite', '--palier', 'nF');
    assert.equal(refus.status, 1);
    assert.match(refus.stdout, /non prévu/);
    assert.ok(fs.readFileSync(jp).equals(octets), 'aucune écriture après refus');
  });
});
