// Harnais du PORTIER (dette B, plan étape 5 lot 3) : workflow non audité placé devant le
// workflow de génération épinglé. Un corps malformé est rejeté (400) SANS créer d'exécution
// du workflow audité ; un corps valide est transmis EXACTEMENT { set_id, ref } ; toute issue
// incertaine répond 504 (observer, ne jamais renvoyer). Artefact relu : l'EXPORT EXACT du
// live, box-fonda-generation-ia-portier.json. Aucun appel réseau.
// Usage : node --test n8n/fonda-generation-ia/portier.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const B = require('./construire-workflow.js');
const { executerGraphe, evaluer } = require('./simulateur.js');
const L = require('../../fonda/scripts/liaison-generation.js');
const FIXTURE = require('../../fonda/scripts/fixtures/execution-generation.json');

const FX = FIXTURE.workflow_ia;
const P = B.NOEUDS_PORTIER;
const N = B.NOEUDS;
const RACINE = path.join(__dirname, '..', '..');
const PORTIER = JSON.parse(fs.readFileSync(path.join(__dirname, 'box-fonda-generation-ia-portier.json'), 'utf8'));
const GEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'box-fonda-generation-ia.json'), 'utf8'));
const noeud = (wf, nom) => wf.nodes.find((n) => n.name === nom);
const CORPS = { set_id: FX.set_id, ref: FX.ref };

// Réponse du webhook interne : 200 immédiat (onReceived) = génération ACCEPTÉE.
const accepter = () => ({ statusCode: 200, body: { message: 'Workflow was started' } });
const portier = (corps, transmettre = accepter) => executerGraphe(PORTIER, { corps, reponses: { [P.transmettre]: transmettre } });

// --- 1. Structure de l'export ----------------------------------------------------------------
describe('portier : export, structure, jetons', () => {
  test('identité instance, INACTIF, pinData absent/null/{}', () => {
    assert.match(PORTIER.id, /^[A-Za-z0-9]{16}$/);
    assert.equal(PORTIER.active, false);
    assert.equal(PORTIER.name, B.CONFIG.nomPortier);
    assert.ok(PORTIER.pinData == null || (typeof PORTIER.pinData === 'object' && !Array.isArray(PORTIER.pinData) && !Object.keys(PORTIER.pinData).length));
    assert.ok(!('shared' in PORTIER));
    assert.ok(fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8').includes(`workflowId du portier : \`${PORTIER.id}\``), 'workflowId du portier consigné au README');
  });
  test('chaque nœud = reconstruction depuis le dépôt (paramètres, types, versions, credentials, onError)', () => {
    const c = B.construireWorkflowPortier();
    assert.deepEqual(PORTIER.nodes.map((n) => n.name).sort(), c.nodes.map((n) => n.name).sort());
    for (const n of c.nodes) {
      const e = noeud(PORTIER, n.name);
      assert.deepEqual(e.parameters, n.parameters, n.name);
      assert.equal(e.type, n.type);
      assert.equal(e.typeVersion, n.typeVersion);
      assert.deepEqual(e.credentials, n.credentials, n.name);
      assert.equal(e.onError, n.onError, `${n.name} : onError`);
    }
    assert.deepEqual(PORTIER.connections, c.connections);
  });
  test('webhook : POST, chemin dédié, Header Auth « FONDA Portier Token », réponse par nœuds Respond', () => {
    const w = noeud(PORTIER, P.webhook);
    assert.equal(w.parameters.httpMethod, 'POST');
    assert.equal(w.parameters.path, 'box-fonda-generation-ia-portier');
    assert.equal(w.parameters.authentication, 'headerAuth');
    assert.equal(w.parameters.responseMode, 'responseNode');
    assert.deepEqual(w.credentials, { httpHeaderAuth: { id: 'sdVd72oXHCWhIxTd', name: 'FONDA Portier Token' } });
  });
  test('jetons DISTINCTS (F5) : appelant -> portier ≠ portier -> génération ; aucune valeur en clair', () => {
    const t = noeud(PORTIER, P.transmettre);
    assert.deepEqual(t.credentials, { httpHeaderAuth: { id: 'GfnXr5hYrYgC5RwA', name: 'FONDA Webhook Token' } });
    assert.equal(t.parameters.authentication, 'genericCredentialType');
    assert.equal(t.parameters.genericAuthType, 'httpHeaderAuth');
    assert.notEqual(noeud(PORTIER, P.webhook).credentials.httpHeaderAuth.id, t.credentials.httpHeaderAuth.id);
    assert.deepEqual(noeud(GEN, N.webhook).credentials, t.credentials, 'même credential que le webhook de génération');
    const texte = JSON.stringify(PORTIER);
    assert.ok(!/x-fonda-token/i.test(texte), 'aucun en-tête de jeton écrit en dur');
    assert.ok(!/"value"\s*:\s*"[^"]{20,}"/.test(texte));
  });
  test('transmission : URL du webhook de génération, sans nouvel essai, erreurs de transport -> sortie d\'erreur', () => {
    const t = noeud(PORTIER, P.transmettre);
    assert.equal(t.parameters.url, `https://n8n.srv868991.hstgr.cloud/webhook/${noeud(GEN, N.webhook).parameters.path}`);
    assert.equal(t.parameters.method, 'POST');
    assert.notEqual(t.retryOnFail, true);
    assert.equal(t.onError, 'continueErrorOutput');
    assert.deepEqual(t.parameters.options.response.response, { fullResponse: true, neverError: true });
    assert.deepEqual(t.parameters.options.redirect, { redirect: { followRedirects: false } }, 'redirections jamais suivies (suivies par défaut en 4.2)');
    for (const n of PORTIER.nodes.filter((x) => x.name !== P.transmettre)) assert.equal(n.onError, undefined, `${n.name} : onError interdit`);
    assert.ok(PORTIER.nodes.every((n) => n.retryOnFail !== true && n.continueOnFail !== true && n.alwaysOutputData !== true));
  });
  test('aucun nœud désactivé (un IF désactivé laisserait passer un corps malformé vers la génération)', () => {
    assert.ok(PORTIER.nodes.every((n) => n.disabled !== true));
  });
  test('chaque Respond fixe EXPLICITEMENT son code (400, 202, 504 ; 200 par défaut sinon)', () => {
    const codes = Object.fromEntries(PORTIER.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook').map((n) => [n.name, n.parameters.options.responseCode]));
    assert.deepEqual(codes, { [P.refus]: 400, [P.accepte]: 202, [P.inconnu]: 504 });
  });
  test('validation du déclencheur : code IDENTIQUE dans le portier, l\'entrée de génération et le dépôt', () => {
    const bloc = (code) => /\/\/ >>> VALIDATION validerDeclencheur[\s\S]*?\/\/ <<< VALIDATION validerDeclencheur/.exec(code)[0];
    const vPortier = bloc(noeud(PORTIER, P.valider).parameters.jsCode);
    const vEntree = bloc(noeud(GEN, N.entree).parameters.jsCode);
    assert.equal(vPortier, B.VALIDER_DECLENCHEUR);
    assert.equal(vEntree, B.VALIDER_DECLENCHEUR);
  });
  test('webhook de génération en accusé IMMÉDIAT (onReceived, défaut) : jamais lastNode ni responseNode', () => {
    const m = noeud(GEN, N.webhook).parameters.responseMode;
    assert.ok(m === undefined || m === 'onReceived', `responseMode ${m}`);
  });
  test('le harnais de génération interdit toujours tout onError (workflow audité)', () => {
    assert.ok(GEN.nodes.every((n) => n.onError === undefined || n.onError === 'stopWorkflow'));
  });
});

// --- 2. Comportement -----------------------------------------------------------------------
describe('portier : comportement', () => {
  const malformes = [
    ['corps absent', undefined], ['corps tableau', []], ['champ en trop', { ...CORPS, x: 1 }], ['ref manquante', { set_id: FX.set_id }],
    ['set_id invalide', { ...CORPS, set_id: 'set_fonda_X' }], ['ref vide', { ...CORPS, ref: '' }], ['ref trop longue', { ...CORPS, ref: 'r'.repeat(257) }],
    ['set_id non chaîne', { ...CORPS, set_id: 12 }],
  ];
  for (const [nom, corps] of malformes) {
    test(`malformé (${nom}) -> 400, AUCUN appel à la génération`, async () => {
      let appels = 0;
      const r = await portier(corps, () => { appels += 1; return accepter(); });
      assert.equal(r.status, 'success');
      assert.equal(r.reponseWebhook.code, 400);
      assert.equal(typeof r.reponseWebhook.corps.erreur, 'string');
      assert.equal(appels, 0);
      assert.ok(!r.requetes[P.transmettre]);
    });
  }
  test('valide -> corps transmis EXACTEMENT { set_id, ref } -> 200 -> 202 { set_id, ref }', async () => {
    const r = await portier(CORPS);
    assert.deepEqual(JSON.parse(r.requetes[P.transmettre].jsonBody), CORPS);
    assert.deepEqual(Object.keys(JSON.parse(r.requetes[P.transmettre].jsonBody)), ['set_id', 'ref']);
    assert.equal(r.reponseWebhook.code, 202);
    assert.deepEqual(r.reponseWebhook.corps, CORPS);
  });
  const incertains = [
    ['délai dépassé', () => { const e = new Error('timeout of 30000ms exceeded'); e.code = 'ECONNABORTED'; throw e; }],
    ['connexion refusée', () => { const e = new Error('connect ECONNREFUSED'); e.code = 'ECONNREFUSED'; throw e; }],
    ['401 interne (jeton refusé)', () => ({ statusCode: 401, body: 'Authorization data is wrong!' })],
    ['500 interne', () => ({ statusCode: 500, body: { message: 'Error in workflow' } })],
    ['404 (workflow de génération inactif)', () => ({ statusCode: 404, body: { message: 'webhook not registered' } })],
    ['2xx inattendu (204)', () => ({ statusCode: 204, body: '' })],
    ['redirection 307 (jamais suivie)', () => ({ statusCode: 307, headers: { location: 'https://ailleurs.example/accepte' }, body: '' })],
    ['redirection 302 (jamais suivie)', () => ({ statusCode: 302, headers: { location: 'https://ailleurs.example/accepte' }, body: '' })],
  ];
  for (const [nom, rep] of incertains) {
    test(`${nom} -> 504 « observer, ne jamais renvoyer », un seul appel`, async () => {
      let appels = 0;
      const r = await portier(CORPS, (q) => { appels += 1; return rep(q); });
      assert.equal(r.reponseWebhook.code, 504);
      assert.deepEqual(r.reponseWebhook.corps, { etat: 'inconnu', consigne: 'observer, ne jamais renvoyer' });
      assert.equal(appels, 1);
    });
  }
});

describe('portier : échecs internes (limite documentée : 500, état inconnu)', () => {
  const copie = () => JSON.parse(JSON.stringify(PORTIER));
  test('échec AVANT transmission -> 500 du gestionnaire n8n, aucun appel à la génération', async () => {
    const w = copie();
    const v = w.nodes.find((n) => n.name === P.valider);
    v.parameters.jsCode = `throw new Error('panne simulée');\n${v.parameters.jsCode}`;
    let appels = 0;
    const r = await executerGraphe(w, { corps: CORPS, reponses: { [P.transmettre]: () => { appels += 1; return accepter(); } } });
    assert.equal(r.status, 'error');
    assert.equal(r.reponseWebhook.code, 500);
    assert.equal(appels, 0);
  });
  test('échec APRÈS transmission -> 500, génération DÉJÀ lancée : l\'appelant traite 500 comme « inconnu »', async () => {
    const w = copie();
    w.nodes.find((n) => n.name === P.accepte).parameters.responseBody = '={{ (() => { throw new Error("panne simulée"); })() }}';
    let appels = 0;
    const r = await executerGraphe(w, { corps: CORPS, reponses: { [P.transmettre]: () => { appels += 1; return accepter(); } } });
    assert.equal(r.reponseWebhook.code, 500);
    assert.equal(appels, 1, 'la génération a été appelée : un renvoi créerait un doublon');
  });
  test('simulateur fidèle : IF strict lève sur un type inattendu ; nœud désactivé = passage direct', async () => {
    const w = copie();
    w.nodes.find((n) => n.name === P.siValide).disabled = true;
    const r = await executerGraphe(w, { corps: { ...CORPS, x: 1 }, reponses: { [P.transmettre]: accepter } });
    assert.deepEqual(JSON.parse(r.requetes[P.transmettre].jsonBody), {}, 'IF désactivé : le malformé partirait vers la génération (d\'où le test structurel)');
    const r2 = await executerGraphe(PORTIER, { corps: CORPS, reponses: { [P.transmettre]: () => ({ statusCode: '200', body: {} }) } });
    assert.equal(r2.reponseWebhook.code, 500, 'statusCode non numérique : IF strict en échec -> 500');
  });
});

// --- 3. Jusqu'au signataire -------------------------------------------------------------------
// Le webhook interne de génération est exécuté (simulé) avec le corps RÉELLEMENT transmis.
const contenuGithub = (chemin, texte) => {
  const b = Buffer.isBuffer(texte) ? texte : Buffer.from(texte, 'utf8');
  return { type: 'file', encoding: 'base64', path: chemin, size: b.length, sha: 'blob', content: `${b.toString('base64').replace(/(.{60})/g, '$1\n')}\n` };
};
const lire = (rel) => fs.readFileSync(path.join(RACINE, rel));
const reponsesGeneration = (journal) => ({
  [N.commit]: () => ({ statusCode: 200, body: { sha: FX.journal_commit } }),
  [N.journal]: () => ({ statusCode: 200, body: contenuGithub('fonda/data/set_ids-journal.json', JSON.stringify(journal)) }),
  [N.referentiel]: () => ({ statusCode: 200, body: contenuGithub('fonda/data/referentiel.json', lire('fonda/data/referentiel.json')) }),
  [N.moteurs]: () => ({ statusCode: 200, body: contenuGithub('fonda/engine/moteurs.json', lire('fonda/engine/moteurs.json')) }),
  [N.existant]: () => ({ statusCode: 200, body: { files: [] } }),
});

async function bout(corps, journal) {
  const generations = [];
  const r = await portier(corps, async (q) => {
    const g = await executerGraphe(GEN, { corps: JSON.parse(q.jsonBody), reponses: reponsesGeneration(journal), executionId: String(700 + generations.length) });
    generations.push(g);
    return accepter(); // onReceived : 200 avant la fin de la génération
  });
  const brutes = generations.map((g, i) => ({
    id: String(700 + i), workflowId: GEN.id, status: g.status, mode: 'webhook', startedAt: '2026-10-20T07:00:00.000Z', stoppedAt: '2026-10-20T07:00:05.000Z',
    workflowData: {}, data: { resultData: { runData: g.runData } },
  }));
  const constats = new L.Constats();
  const x = brutes.map((b) => ({ id: b.id, workflowId: GEN.id, status: b.status, startedAt: b.startedAt, stoppedAt: b.stoppedAt }));
  const { examinees, complet } = L.examinerExecutions({ executions: x, details: new Map(brutes.map((b) => [b.id, b])), constats, normaliserDate: (d) => d });
  return { r, generations, constats, examinees, complet };
}

const lireMultipart = (requete) => {
  const frontiere = /boundary=(.+)$/.exec(requete.rawContentType)[1];
  const parties = requete.body.split(`--${frontiere}`);
  const partie = (x) => x.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
  return { metadonnees: JSON.parse(partie(parties[1])), contenu: partie(parties[2]) };
};
const reponsesCompletes = (journal) => ({
  ...reponsesGeneration(journal),
  [N.ia]: () => ({ statusCode: 200, body: FX.reponse_ia }),
  [N.deposer]: (q) => { const { metadonnees } = lireMultipart(q); return { statusCode: 200, body: { id: FX.fichier_drive_id, name: metadonnees.name, parents: metadonnees.parents, properties: metadonnees.properties } }; },
  [N.relister]: () => ({ statusCode: 200, body: { files: [{ id: FX.fichier_drive_id, name: `${FX.set_id}.lot.json` }] } }),
});
const versBrute = (g, id) => ({
  id, workflowId: GEN.id, status: g.status, mode: 'webhook', startedAt: '2026-10-20T07:00:00.000Z', stoppedAt: '2026-10-20T07:00:05.000Z',
  workflowData: {}, data: { resultData: { runData: g.runData } },
});

// Accusé du webhook interne SELON SA CONFIGURATION (webhook-helpers n8n 2.6.3) : onReceived ->
// 200 AVANT la fin de la génération ; lastNode/responseNode -> réponse à la fin seulement.
function lancerGeneration(corps, reponses, executionId) {
  const fin = executerGraphe(GEN, { corps, reponses, executionId });
  const m = noeud(GEN, N.webhook).parameters.responseMode;
  const immediat = m === undefined || m === 'onReceived';
  return { fin, accuse: immediat ? Promise.resolve(accepter()) : fin.then(() => accepter()) };
}
// Porte : la génération reste SUSPENDUE (appel IA) jusqu'à ouverture explicite.
function porte() { let ouvrir; const p = new Promise((r) => { ouvrir = r; }); return { p, ouvrir }; }
const delai = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));

describe('portier -> génération -> signataire', () => {
  const sansReservation = { schema: 'set-ids-journal/v1', lignes: [] };
  test('malformé : aucune exécution du workflow audité, aucun constat', async () => {
    const { r, generations, constats } = await bout({ ...CORPS, x: 1 }, sansReservation);
    assert.equal(r.reponseWebhook.code, 400);
    assert.equal(generations.length, 0);
    assert.deepEqual(constats.liste, []);
  });
  test('valide SANS réservation : exécution en erreur ATTRIBUABLE, sans dépôt, jamais d\'incident', async () => {
    const { r, generations, constats, examinees, complet } = await bout(CORPS, sansReservation);
    assert.equal(r.reponseWebhook.code, 202);
    assert.equal(generations.length, 1);
    assert.equal(generations[0].status, 'error');
    assert.equal(generations[0].noeudErreur, N.preparer);
    assert.ok(!generations[0].requetes[N.ia] && !generations[0].requetes[N.deposer]);
    assert.deepEqual(constats.liste.filter((c) => c.issue === 'incident'), []);
    assert.deepEqual(examinees.map((e) => e.entree), [CORPS]);
    // Isolée, elle laisse 0 génération réussie : abandon du set_id (comportement voulu), pas un incident.
    const c2 = new L.Constats();
    L.classerExecutions({ setId: FX.set_id, examinees, complet, vueFichiers: L.INDISPONIBLE, constats: c2 });
    assert.ok(c2.liste.every((c) => c.issue === 'abandon'));
  });
  const avecReservation = { schema: 'set-ids-journal/v1', lignes: [{ set_id: FX.set_id, transition: 'reserve', le: '2026-10-20', ref: FX.ref }] };
  test('202 renvoyé PENDANT que la génération est encore suspendue (accusé immédiat), dépôt ensuite', async () => {
    const pt = porte();
    const reps = { ...reponsesCompletes(avecReservation), [N.ia]: async () => { await pt.p; return { statusCode: 200, body: FX.reponse_ia }; } };
    let gen = null;
    const r = await Promise.race([
      portier(CORPS, async (q) => { gen = lancerGeneration(JSON.parse(q.jsonBody), reps, '709'); return gen.accuse; }),
      delai(500, 'BLOQUÉ'),
    ]);
    assert.notEqual(r, 'BLOQUÉ', 'le portier attend la fin de la génération : accusé non immédiat');
    assert.equal(r.reponseWebhook.code, 202);
    let fini = false; gen.fin.then(() => { fini = true; });
    await delai(10);
    assert.equal(fini, false, 'la génération est encore en cours au moment du 202');
    pt.ouvrir();
    const g = await gen.fin;
    assert.equal(g.status, 'success', g.erreur);
    assert.ok(g.requetes[N.deposer], 'dépôt APRÈS le 202');
  });
  test('génération lancée puis réponse PERDUE -> 504 « inconnu » ; la génération dépose PLUS TARD (ne jamais renvoyer)', async () => {
    const pt = porte();
    const reps = { ...reponsesCompletes(avecReservation), [N.ia]: async () => { await pt.p; return { statusCode: 200, body: FX.reponse_ia }; } };
    let gen = null;
    const r = await portier(CORPS, async (q) => {
      gen = lancerGeneration(JSON.parse(q.jsonBody), reps, '710');
      const e = new Error('socket hang up'); e.code = 'ECONNRESET'; throw e;
    });
    assert.equal(r.reponseWebhook.code, 504);
    pt.ouvrir();
    const g = await gen.fin;
    assert.equal(g.status, 'success', g.erreur);
    assert.ok(g.requetes[N.deposer], 'candidat déposé APRÈS la réponse perdue');
  });
  test('relisting paginé simulé : la PREMIÈRE page est prise en compte (doublon en page 1 -> erreur)', async () => {
    let n = 0;
    const reps = { ...reponsesCompletes(avecReservation), [N.relister]: (q) => {
      n += 1;
      return q.pagination && q.pagination.pageToken
        ? { statusCode: 200, body: { files: [{ id: FX.fichier_drive_id }] } }
        : { statusCode: 200, body: { files: [{ id: FX.fichier_drive_id }, { id: 'drv-autre' }], nextPageToken: 'p2' } };
    } };
    const g = await executerGraphe(GEN, { corps: CORPS, reponses: reps, executionId: '730' });
    assert.equal(g.status, 'error');
    assert.equal(g.noeudErreur, N.unicite);
    assert.match(g.erreur, /doublon/);
    assert.equal(n, 2, 'exactement deux appels (pas de première réponse jetée)');
  });
  test('tentative en erreur attribuable PUIS réussite : le signataire retient la réussite, la tentative est tolérée', async () => {
    const g1 = await executerGraphe(GEN, { corps: CORPS, reponses: reponsesGeneration({ schema: 'set-ids-journal/v1', lignes: [] }), executionId: '720' });
    const g2 = await executerGraphe(GEN, { corps: CORPS, reponses: reponsesCompletes(avecReservation), executionId: '721' });
    assert.equal(g1.status, 'error');
    assert.equal(g2.status, 'success', g2.erreur);
    const brutes = [versBrute(g1, '720'), versBrute(g2, '721')];
    brutes[0].stoppedAt = '2026-10-20T06:59:00.000Z'; brutes[0].startedAt = '2026-10-20T06:58:00.000Z';
    const constats = new L.Constats();
    const x = brutes.map((b) => ({ id: b.id, workflowId: GEN.id, status: b.status, startedAt: b.startedAt, stoppedAt: b.stoppedAt }));
    const { examinees, complet } = L.examinerExecutions({ executions: x, details: new Map(brutes.map((b) => [b.id, b])), constats, normaliserDate: (d) => d });
    const { metadonnees } = lireMultipart(g2.requetes[N.deposer]);
    const fichier = { id: FX.fichier_drive_id, nom: metadonnees.name, modifie_le: '2026-10-20T07:00:04.000Z', properties: metadonnees.properties, proprietesLisibles: true };
    const vueFichiers = L.examinerFichiers({ setId: FX.set_id, fichiers: [fichier], constats });
    const { retenue } = L.classerExecutions({ setId: FX.set_id, examinees, complet, vueFichiers, constats });
    assert.deepEqual(constats.liste, []);
    assert.equal(retenue.x.id, '721');
  });
});

// Garde-fou du simulateur lui-même : un Respond sans responseCode répondrait 200.
test('simulateur : Respond sans code explicite = 200 (n8n 2.6.3)', async () => {
  const wf = {
    nodes: [{ name: 'W', type: 'n8n-nodes-base.webhook', parameters: {} }, { name: 'R', type: 'n8n-nodes-base.respondToWebhook', parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify({ a: 1 }) }}', options: {} } }],
    connections: { W: { main: [[{ node: 'R', type: 'main', index: 0 }]] } },
  };
  const r = await executerGraphe(wf, { corps: {} });
  assert.equal(r.reponseWebhook.code, 200);
  assert.equal(evaluer('={{ 1 + 1 }}', {}), 2);
});
