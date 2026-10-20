// Harnais de validation STRUCTURELLE du workflow « n8n génère » (CDC relecture v8.3,
// §20.14 étape 4). L'artefact relu est l'EXPORT EXACT du workflow live,
// box-fonda-generation-ia.json. Aucun appel réseau : les nœuds Code de l'export sont
// exécutés dans un contexte nu (comme un nœud Code n8n : ni require, ni Buffer, ni
// TextEncoder, ni crypto), les nœuds HTTP sont simulés (fixture), puis l'exécution
// produite est passée au CONTRAT DU SIGNATAIRE (liaison-generation.js + canonique.js).
// Usage : node --test n8n/fonda-generation-ia/workflow.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const RACINE = path.join(__dirname, '..', '..');
const EXPORT = path.join(__dirname, 'box-fonda-generation-ia.json');
const WF = JSON.parse(fs.readFileSync(EXPORT, 'utf8'));
const B = require('./construire-workflow.js');
const L = require('../../fonda/scripts/liaison-generation.js');
const C = require('../../fonda/engine/catalogue.js');
const Canonique = require('../../fonda/engine/canonique.js');
const G = require('../../fonda/scripts/generer-lot-fonda.js');
const Gen = require('../../fonda/engine/generation.js');
const V = require('../../fonda/engine/canonique-vecteurs.json');
const FIXTURE = require('../../fonda/scripts/fixtures/execution-generation.json');

const FX = FIXTURE.workflow_ia;
const N = B.NOEUDS;
const lireOctets = (rel) => fs.readFileSync(path.join(RACINE, rel));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const noeud = (nom) => WF.nodes.find((n) => n.name === nom);
const code = (nom) => noeud(nom).parameters.jsCode;
const REFERENTIEL = lireOctets('fonda/data/referentiel.json').toString('utf8');
const MOTEURS = lireOctets('fonda/engine/moteurs.json').toString('utf8');
const JOURNAL = { schema: 'set-ids-journal/v1', lignes: [{ set_id: FX.set_id, transition: 'reserve', le: '2026-10-20', ref: FX.ref }] };

// Réponse de l'API GitHub « contents » : octets EXACTS en base64 (lignes de 60 + \n).
const contenuGithub = (chemin, texteOuOctets) => {
  const b = Buffer.isBuffer(texteOuOctets) ? texteOuOctets : Buffer.from(texteOuOctets, 'utf8');
  return { type: 'file', encoding: 'base64', path: chemin, size: b.length, sha: 'blob', content: b.toString('base64').replace(/(.{60})/g, '$1\n') + '\n' };
};
const J = 'fonda/data/set_ids-journal.json';
const R = 'fonda/data/referentiel.json';
const MO = 'fonda/engine/moteurs.json';

// --- Simulateur d'exécution n8n (mode webhook, un item par nœud) -----------------------------
// Expression n8n « ={{ … }} » évaluée dans un contexte nu avec $ et $json.
function evaluer(valeur, ctx) {
  if (typeof valeur === 'string' && valeur.startsWith('={{') && valeur.endsWith('}}')) {
    return vm.runInNewContext(`(${valeur.slice(3, -2)})`, { $: ctx.$, $json: ctx.$json });
  }
  if (Array.isArray(valeur)) return valeur.map((v) => evaluer(v, ctx));
  if (valeur && typeof valeur === 'object') return Object.fromEntries(Object.entries(valeur).map(([k, v]) => [k, evaluer(v, ctx)]));
  return valeur;
}
const json = (v) => JSON.parse(JSON.stringify(v));

// reponses : { [nom de nœud HTTP]: (requête évaluée) -> json de réponse }.
async function executer(wf, { corps, reponses, executionId = FX.execution_id, contexteCode = {} }) {
  const sorties = {};
  const runData = {};
  const requetes = {};
  const $ = (nom) => {
    if (!sorties[nom]) throw new Error(`nœud ${nom} non exécuté`);
    return { all: () => sorties[nom], first: () => sorties[nom][0], item: sorties[nom][0] };
  };
  let courant = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  let entree = null;
  while (courant) {
    let items;
    try {
      if (courant.type === 'n8n-nodes-base.webhook') items = [{ json: { headers: {}, params: {}, query: {}, body: corps } }];
      else if (courant.type === 'n8n-nodes-base.code') {
        const $input = { all: () => entree, first: () => entree[0] };
        const fn = vm.runInNewContext(`(async function () {\n${courant.parameters.jsCode}\n})`, { $input, $, $execution: { id: executionId }, ...contexteCode });
        items = json(await fn());
      } else if (courant.type === 'n8n-nodes-base.httpRequest') {
        const requete = evaluer(courant.parameters, { $, $json: entree[0].json });
        requetes[courant.name] = requete;
        if (!reponses[courant.name]) throw new Error(`réponse simulée absente pour ${courant.name}`);
        items = [{ json: json(await reponses[courant.name](requete)) }];
      } else throw new Error(`type de nœud non simulé : ${courant.type}`);
    } catch (e) {
      return { status: 'error', noeudErreur: courant.name, erreur: e.message, runData, requetes, sorties };
    }
    sorties[courant.name] = items;
    runData[courant.name] = [{ data: { main: [items] } }];
    entree = items;
    const suite = wf.connections[courant.name];
    courant = suite ? wf.nodes.find((n) => n.name === suite.main[0][0].node) : null;
  }
  return { status: 'success', runData, requetes, sorties };
}

// Multipart du dépôt Drive -> { metadonnees, contenu } ; la réponse de Drive écho les métadonnées.
function lireMultipart(requete) {
  const frontiere = /boundary=(.+)$/.exec(requete.rawContentType)[1];
  const parties = requete.body.split(`--${frontiere}`);
  assert.equal(parties.length, 4, 'multipart : deux parties');
  assert.equal(parties[3], '--\r\n');
  const partie = (p) => { const [entete, ...reste] = p.split('\r\n\r\n'); assert.match(entete, /Content-Type: application\/json; charset=UTF-8/); return reste.join('\r\n\r\n').replace(/\r\n$/, ''); };
  return { metadonnees: JSON.parse(partie(parties[1])), contenu: partie(parties[2]) };
}

function reponsesNominales(sur = {}) {
  return {
    [N.commit]: () => ({ sha: FX.journal_commit, commit: { message: 'fixture' } }),
    [N.journal]: () => contenuGithub(J, JSON.stringify(JOURNAL, null, 2) + '\n'),
    [N.referentiel]: () => contenuGithub(R, lireOctets(R)),
    [N.moteurs]: () => contenuGithub(MO, lireOctets(MO)),
    [N.existant]: () => ({ files: [] }),
    [N.ia]: () => FX.reponse_ia,
    [N.deposer]: (r) => { const { metadonnees } = lireMultipart(r); return { id: FX.fichier_drive_id, name: metadonnees.name, parents: metadonnees.parents, properties: metadonnees.properties }; },
    // Relisting après dépôt : exactement le fichier déposé.
    [N.relister]: () => ({ files: [{ id: FX.fichier_drive_id, name: `${FX.set_id}.lot.json`, properties: { fonda_set_id: FX.set_id, fonda_execution_id: FX.execution_id } }] }),
    ...sur,
  };
}
const CORPS = { set_id: FX.set_id, ref: FX.ref };

// Exécution n8n simulée -> exécution brute de l'API publique (includeData), comme le signataire la lit.
const brute = (r, wf = WF) => ({
  id: FX.execution_id, workflowId: wf.id, status: r.status, mode: 'webhook', startedAt: FX.startedAt, stoppedAt: FX.stoppedAt,
  workflowData: wf.pinData === undefined ? {} : { pinData: wf.pinData }, data: { resultData: { runData: r.runData } },
});

// --- 1. Structure de l'export ------------------------------------------------------------------
describe('export : structure, inactif, sans pinData', () => {
  test('identité instance, INACTIF, nom', () => {
    assert.equal(typeof WF.id, 'string');
    assert.match(WF.id, /^[A-Za-z0-9]{16}$/);
    assert.equal(WF.active, false);
    assert.equal(WF.name, B.CONFIG.nom);
    assert.ok(!('shared' in WF), 'export sans « shared » (adresse du propriétaire)');
    assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/.test(fs.readFileSync(EXPORT, 'utf8')), 'aucune adresse e-mail dans l\'export (dépôt public)');
    assert.ok(fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8').includes(`workflowId de l'instance : \`${WF.id}\``), 'workflowId consigné au README');
  });
  test('pinData absent ou objet vide', () => {
    assert.ok(WF.pinData === undefined || (WF.pinData && typeof WF.pinData === 'object' && !Array.isArray(WF.pinData) && Object.keys(WF.pinData).length === 0));
  });
  test('noms de nœuds EXACTS, uniques, chaîne linéaire depuis le webhook', () => {
    const attendus = Object.values(N);
    assert.deepEqual(WF.nodes.map((n) => n.name).sort(), [...attendus].sort());
    assert.ok(noeud('FONDA Entree generation') && noeud('FONDA Sortie generation'));
    assert.equal(L.NOEUD_ENTREE, 'FONDA Entree generation');
    assert.equal(L.NOEUD_SORTIE, 'FONDA Sortie generation');
    for (let i = 0; i < attendus.length - 1; i += 1) {
      assert.deepEqual(WF.connections[attendus[i]], { main: [[{ node: attendus[i + 1], type: 'main', index: 0 }]] }, attendus[i]);
    }
    assert.deepEqual(Object.keys(WF.connections).sort(), attendus.slice(0, -1).sort());
    assert.ok(WF.nodes.every((n) => !n.disabled), 'aucun nœud désactivé');
  });
  test('déclenchement WEBHOOK unique (POST, chemin dédié), aucun cron ni autre déclencheur', () => {
    const declencheurs = WF.nodes.filter((n) => /trigger|webhook|cron|schedule/i.test(n.type));
    assert.deepEqual(declencheurs.map((n) => n.name), [N.webhook]);
    const w = noeud(N.webhook);
    assert.equal(w.parameters.httpMethod, 'POST');
    assert.equal(w.parameters.path, 'box-fonda-generation-ia');
    assert.equal(w.parameters.authentication, 'headerAuth', 'webhook protégé par Header Auth');
    assert.deepEqual(Object.keys(w.credentials), ['httpHeaderAuth']);
    assert.match(w.credentials.httpHeaderAuth.id, /^[A-Za-z0-9]{16}$/, 'credential référencée par id');
    assert.equal(w.credentials.httpHeaderAuth.name, 'FONDA Webhook Token');
    assert.ok(!/X-FONDA-Token"\s*:\s*"|"value"\s*:\s*"[^"]{20,}"/.test(JSON.stringify(w)), 'aucune valeur de jeton dans le nœud');
    assert.ok(!/^box-(catalogue|set|question|delete|tally|validate|reject|select)/.test(w.parameters.path), 'jamais une route BOX');
  });
  test('arrêt sur erreur : aucun onError/continueOnFail/alwaysOutputData, aucun nouvel essai', () => {
    for (const n of WF.nodes) {
      assert.ok(n.onError === undefined || n.onError === 'stopWorkflow', `${n.name} : onError`);
      assert.notEqual(n.continueOnFail, true, `${n.name} : continueOnFail`);
      assert.notEqual(n.alwaysOutputData, true, `${n.name} : alwaysOutputData`);
      assert.notEqual(n.retryOnFail, true, `${n.name} : retryOnFail`);
    }
    assert.equal(WF.settings.errorWorkflow, undefined);
  });
  test('HTTP : format de réponse « autodetect » partout (n8n 2.6.3 : « text » re-sérialise, « json »+raw renvoie un flux non lu)', () => {
    for (const n of WF.nodes.filter((x) => x.type === 'n8n-nodes-base.httpRequest')) {
      assert.equal(n.typeVersion, 4.2, n.name);
      assert.equal(n.parameters.options.response, undefined, `${n.name} : options.response`);
    }
  });
  test('plafond de l\'API contents (1 Mo) : fichiers lus par le workflow sous 900 Ko (alerte précoce en CI)', () => {
    for (const f of [J, R, MO]) assert.ok(lireOctets(f).length < 900 * 1024, `${f} approche 1 Mo : passer à l'API git/blobs avant`);
  });
  test('fichiers du dépôt lus par l\'API contents AU commit consigné (octets exacts)', () => {
    for (const [nom, chemin] of [[N.journal, J], [N.referentiel, R], [N.moteurs, MO]]) {
      assert.equal(noeud(nom).parameters.url, `={{ 'https://api.github.com/repos/ericduchateau/box/contents/${chemin}?ref=' + $('${N.fixer}').first().json.journal_commit }}`);
    }
  });
  test('§20.10 (a) : exécutions réussies, en erreur ET manuelles conservées', () => {
    assert.equal(WF.settings.saveDataSuccessExecution, 'all');
    assert.equal(WF.settings.saveDataErrorExecution, 'all');
    assert.equal(WF.settings.saveManualExecutions, true);
  });
  test('nœud IA ENTIÈREMENT configuré : Sonnet épinglé, credential par id, aucun repli ni nouvel essai', () => {
    const ia = WF.nodes.filter((n) => /anthropic|openai|lmChat|langchain/i.test(n.type) || JSON.stringify(n.credentials || {}).includes('anthropic'));
    assert.deepEqual(ia.map((n) => n.name), [N.ia], 'un seul nœud IA');
    const n = noeud(N.ia);
    assert.equal(n.parameters.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(n.parameters.method, 'POST');
    assert.equal(n.parameters.nodeCredentialType, 'anthropicApi');
    assert.deepEqual(n.credentials, { anthropicApi: { id: 'YnhTnSOc1u7S99Q7', name: 'Anthropic FONDA' } });
    assert.notEqual(n.retryOnFail, true);
    assert.equal(n.parameters.jsonBody, '={{ JSON.stringify($json.requete) }}');
    assert.equal(B.CONFIG.modele, FIXTURE.modele);
    assert.match(code(N.preparer), new RegExp(`"modele": "${B.CONFIG.modele}"`));
    assert.ok(!/haiku/i.test(JSON.stringify(WF)), 'G5 : jamais Haiku');
  });
  test('dépôt Drive : un seul appel, sans nouvel essai, credential Drive par id', () => {
    const n = noeud(N.deposer);
    assert.notEqual(n.retryOnFail, true);
    assert.equal(n.parameters.url, 'https://www.googleapis.com/upload/drive/v3/files');
    assert.deepEqual(n.credentials, { googleDriveOAuth2Api: { id: 'cukxQDNwWIqOAK02', name: 'Google Drive la bonne!' } });
    assert.deepEqual(noeud(N.existant).credentials, n.credentials);
  });
});

// --- 2. Code embarqué = dépôt, octet pour octet ---------------------------------------------------
describe('code embarqué : identique au dépôt', () => {
  const construit = B.construireWorkflow();
  test('chaque nœud = celui construit depuis le dépôt (paramètres, types, versions, credentials)', () => {
    for (const n of construit.nodes) {
      const e = noeud(n.name);
      assert.deepEqual(e.parameters, n.parameters, `${n.name} : paramètres`);
      assert.equal(e.type, n.type);
      assert.equal(e.typeVersion, n.typeVersion);
      assert.deepEqual(e.credentials, n.credentials, `${n.name} : credentials`);
    }
  });
  test('modules embarqués = fichiers du dépôt (octets)', () => {
    const vus = new Set();
    for (const n of WF.nodes.filter((x) => x.parameters.jsCode)) {
      const re = /\/\/ >>> MODULE (\S+) \(copie exacte, sha256=([0-9a-f]{64})\)\nconst M_(\w+) = \{ exports: \{\} \};\n\(function \(module, exports, require, self\) \{\n([\s\S]*?)\}\)\(M_\3, M_\3\.exports, requis, \{\}\);\n\/\/ <<< MODULE \1/g;
      for (const m of n.parameters.jsCode.matchAll(re)) {
        const fichier = lireOctets(m[1]);
        assert.equal(m[4], fichier.toString('utf8'), `${n.name} : ${m[1]}`);
        assert.equal(m[2], sha(fichier));
        vus.add(m[1]);
      }
    }
    assert.deepEqual([...vus].sort(), Object.values(B.MODULES).sort());
  });
  test('fonctions copiées = celles du dépôt (toString)', () => {
    const sources = { 'fonda/scripts/generer-lot-fonda.js': G, 'fonda/scripts/moteurs.js': require('../../fonda/scripts/moteurs.js'), 'fonda/scripts/liaison-generation.js': L };
    let n = 0;
    for (const x of WF.nodes.filter((y) => y.parameters.jsCode)) {
      for (const m of x.parameters.jsCode.matchAll(/\/\/ >>> FONCTION (\S+) (\w+) \(copie exacte\)\n([\s\S]*?)\n\/\/ <<< FONCTION \2/g)) {
        assert.equal(m[3], sources[m[1]][m[2]].toString(), m[2]);
        n += 1;
      }
    }
    assert.equal(n, 11);
  });
  test('moteur embarqué = dernier moteur du registre (version, sha256)', () => {
    const reg = JSON.parse(MOTEURS);
    const dernier = require('../../fonda/scripts/moteurs.js').dernierMoteur(reg);
    for (const nom of [N.preparer, N.construire]) assert.match(code(nom), new RegExp(`"sha256": "${dernier.sha256}"`));
    assert.equal(sha(lireOctets(B.MODULES.moteur)), dernier.sha256);
  });
  test('base64 et UTF-8 strict en JavaScript pur = Buffer ; séquences invalides refusées', () => {
    const o = vm.runInNewContext(`${B.OUTILS}\n;({ octetsBase64, texteUtf8 })`, {});
    for (const t of ['', 'a', 'ab', 'abc', 'é😀𝄞\u{10ffff}', REFERENTIEL]) {
      const b = Buffer.from(t, 'utf8');
      const d = o.octetsBase64(b.toString('base64').replace(/(.{60})/g, '$1\n'));
      assert.deepEqual([...d], [...b]);
      assert.equal(o.texteUtf8(d), t);
    }
    for (const mauvais of [[0x80], [0xc0, 0x80], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xc3]]) assert.throws(() => o.texteUtf8(mauvais), /UTF-(8|16)/, JSON.stringify(mauvais));
    for (const mauvais of ['abc', 'a$==', '====', 'YR==', 'YWJ=', 'Y=Q=']) assert.throws(() => o.octetsBase64(mauvais), /base64/, mauvais);
  });
  test('SHA-256 en JavaScript pur = node:crypto (longueurs limites, UTF-8 hors BMP)', () => {
    const outils = vm.runInNewContext(`${B.OUTILS}\n;({ octetsUtf8, sha256Hex })`, {});
    for (const t of ['', 'a', 'abc', 'é😀𝄞', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(1000), REFERENTIEL]) {
      assert.equal(outils.sha256Hex(outils.octetsUtf8(t)), sha(Buffer.from(t, 'utf8')), `longueur ${t.length}`);
    }
  });
  test('copie embarquée de canonique.js : banc partagé complet rejoué dans le nœud (contexte nu)', () => {
    const m = /(const M_canonique = [\s\S]*?\/\/ <<< MODULE fonda\/engine\/canonique\.js)/.exec(code(N.construire));
    const K = vm.runInNewContext(`function requis(n) { throw new Error(n); }\n${m[1]}\n;M_canonique.exports`, {});
    const entreeDe = (x) => (x.entree_json !== undefined ? JSON.parse(x.entree_json) : x.entree);
    for (const x of V.vecteurs) {
      const calc = () => (x.contrat ? K.hexContrat(x.contrat, entreeDe(x)) : K.hex(entreeDe(x), x.schema));
      if (x.refus) assert.throws(calc, /canonique :/, x.id);
      else assert.equal(calc(), x.hex, x.id);
    }
  });
});

// --- 3. Exécution-fixture -> contrat du signataire -----------------------------------------------
describe('exécution-fixture : conforme au contrat du signataire', async () => {
  const r = await executer(WF, { corps: CORPS, reponses: reponsesNominales() });
  const { metadonnees, contenu } = lireMultipart(r.requetes[N.deposer]);
  const lot = JSON.parse(contenu);
  const sortie = r.status === 'success' ? r.runData[N.sortie][0].data.main[0][0].json : null;

  test('succès de bout en bout', () => assert.equal(r.status, 'success', r.erreur));
  test('déclencheur : item.json = { set_id, ref } exactement', () => {
    assert.deepEqual(r.runData[N.entree][0].data.main[0][0].json, CORPS);
  });
  test('sortie generation-fonda/v1 canonique, champs exacts', () => {
    assert.doesNotThrow(() => Canonique.octetsContrat('generation-fonda/v1', sortie));
    assert.equal(sortie.schema, 'generation-fonda/v1');
    assert.equal(sortie.set_id, FX.set_id);
    assert.equal(sortie.ref, FX.ref);
    assert.equal(sortie.journal_commit, FX.journal_commit);
    assert.deepEqual(sortie.moteur, require('../../fonda/scripts/moteurs.js').dernierMoteur(JSON.parse(MOTEURS)));
    assert.equal(sortie.referentiel_version, `sha256:${sha(lireOctets('fonda/data/referentiel.json'))}`);
    assert.equal(sortie.candidat_fichier_id, FX.fichier_drive_id);
    const d = C.decomposerSetId(FX.set_id);
    assert.equal(sortie.palier, d.palier);
    assert.equal(C.slugDeNotion(sortie.notion_id), d.slug);
  });
  test('modele = champ model LU DANS LA RÉPONSE IA', () => {
    assert.equal(sortie.modele, FX.reponse_ia.model);
  });
  test('dépôt candidats/<set_id>.lot.json : properties PUBLIQUES { fonda_set_id, fonda_execution_id }', () => {
    assert.equal(r.requetes[N.deposer].method, 'POST');
    assert.deepEqual(r.requetes[N.deposer].queryParameters.parameters.find((p) => p.name === 'uploadType'), { name: 'uploadType', value: 'multipart' });
    assert.deepEqual(metadonnees, {
      name: `${FX.set_id}.lot.json`, mimeType: 'application/json', parents: [B.CONFIG.dossierCandidats],
      properties: { fonda_set_id: FX.set_id, fonda_execution_id: FX.execution_id },
    });
    assert.ok(!('appProperties' in metadonnees));
  });
  test('lot conforme lot-fonda/v1, sans null explicite, carte fausse écartée', () => {
    assert.deepEqual(C.validerLot(lot), { valide: true, erreurs: [] });
    assert.deepEqual(L.nullsExplicites(lot), []);
    assert.equal(lot.revue_carte_par_carte, false);
    assert.deepEqual(lot.cartes.map((c) => c.item_id), ['it01', 'it02', 'it03']);
  });
  test('lot = celui du générateur local sur la même réponse (même chaîne de fonctions)', () => {
    const referentiel = JSON.parse(REFERENTIEL);
    const notion = referentiel.notions.find((n) => n.id === 'maths.proportionnalite');
    const texte = FX.reponse_ia.content.find((b) => b.type === 'text').text;
    const { cartesValides } = G.trierCartesBrutes(G.parserReponseModele(texte).cartesBrutes);
    const candidats = G.construireCandidats({ notion, palier: 'nI', cartesBrutes: cartesValides, sequence: 50, ts: '2026-10-20T07:00:30.000Z' });
    const depot = Gen.deposerEnRelecture(candidats, { notions: referentiel.notions });
    const attendu = G.construireLotFonda({ notion, palier: 'nI', candidats: depot.parRelecteur.eric });
    assert.match(lot.date_creation, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual({ ...lot, date_creation: 'x' }, json({ ...attendu, date_creation: 'x' }));
    assert.equal(contenu, JSON.stringify(lot, null, 2) + '\n');
  });
  test('empreintes de la sortie = recalculées par le signataire sur le lot déposé', async () => {
    const shaTexte = async (t) => sha(Buffer.from(t, 'utf8'));
    assert.equal(sortie.empreinte_pedagogique, await C.calculerEmpreinte(lot, shaTexte));
    assert.equal(sortie.empreinte_complete, L.empreinteComplete(lot));
  });
  test('contrat du signataire : examen, classement, rapprochement §20.3 sans aucun constat', async () => {
    const b = brute(r);
    const constats = new L.Constats();
    const x = { id: b.id, workflowId: WF.id, status: 'success', startedAt: FX.startedAt, stoppedAt: FX.stoppedAt };
    const { examinees, complet } = L.examinerExecutions({ executions: [x], details: new Map([[x.id, b]]), constats, normaliserDate: (d) => d });
    const fichier = { id: FX.fichier_drive_id, nom: metadonnees.name, modifie_le: FX.stoppedAt, properties: metadonnees.properties, proprietesLisibles: true };
    const vueFichiers = L.examinerFichiers({ setId: FX.set_id, fichiers: [fichier], constats });
    const { retenue } = L.classerExecutions({ setId: FX.set_id, examinees, complet, vueFichiers, constats });
    const s = L.rapprocher({
      setId: FX.set_id, retenue, fichier: vueFichiers.fichier, brute: b, workflowId: WF.id,
      journalCommit: { surPremierParent: true, journal: JOURNAL }, registre: JSON.parse(MOTEURS), modelesAutorises: [FIXTURE.modele],
      lotSource: lot, empreintes: { pedagogique: await C.calculerEmpreinte(lot, async (t) => sha(Buffer.from(t, 'utf8'))), complete: L.empreinteComplete(lot) }, constats,
    });
    assert.deepEqual(constats.liste, []);
    assert.deepEqual(s, sortie);
  });
  test('le signataire refuse un modèle hors liste autorisée (liste vide jusqu\'à §20.8)', async () => {
    const b = brute(r);
    const constats = new L.Constats();
    const x = { id: b.id, workflowId: WF.id, status: 'success', startedAt: FX.startedAt, stoppedAt: FX.stoppedAt };
    const { examinees, complet } = L.examinerExecutions({ executions: [x], details: new Map([[x.id, b]]), constats, normaliserDate: (d) => d });
    const vueFichiers = L.examinerFichiers({ setId: FX.set_id, fichiers: [{ id: FX.fichier_drive_id, nom: metadonnees.name, properties: metadonnees.properties, proprietesLisibles: true }], constats });
    const { retenue } = L.classerExecutions({ setId: FX.set_id, examinees, complet, vueFichiers, constats });
    L.rapprocher({ setId: FX.set_id, retenue, fichier: vueFichiers.fichier, brute: b, workflowId: WF.id, journalCommit: { surPremierParent: true, journal: JOURNAL }, registre: JSON.parse(MOTEURS), modelesAutorises: require('../../fonda/data/modeles-autorises.json').generation_fonda, lotSource: lot, empreintes: null, constats });
    assert.ok(constats.liste.some((c) => /liste autorisée/.test(c.raison)));
  });
  test('pinData non vide dans l\'export -> le signataire abandonne (garde-fou du contrat)', async () => {
    const b = brute(r, { ...WF, pinData: FIXTURE.pinData });
    const constats = new L.Constats();
    L.rapprocher({ setId: FX.set_id, retenue: { x: { id: b.id, workflowId: WF.id, status: 'success', startedAt: FX.startedAt, stoppedAt: FX.stoppedAt }, entree: CORPS }, fichier: L.INDISPONIBLE, brute: b, workflowId: WF.id, journalCommit: L.INDISPONIBLE, registre: JSON.parse(MOTEURS), modelesAutorises: [FIXTURE.modele], lotSource: null, empreintes: null, constats });
    assert.ok(constats.liste.some((c) => /pinData/.test(c.raison)));
  });
});

// --- 4. G3 : liste blanche du prompt ----------------------------------------------------------
describe('G3 : prompt construit UNIQUEMENT depuis la liste blanche', async () => {
  const PROJECTION = ['id', 'libelle', 'matiere', 'axe', 'micro_competence', 'enonce_modele'];
  const referentiel = JSON.parse(REFERENTIEL);
  // Référentiel piégé : toute donnée hors liste blanche porte un marqueur ; il ne doit
  // JAMAIS atteindre la requête envoyée au modèle.
  const piege = json(referentiel);
  const n = piege.notions.find((x) => x.id === 'maths.proportionnalite');
  n.taux_eval = { domaine: 'CANARI-TAUX', satisfaisant_college: 11.11, items: [99.99] };
  n.priorite_initiale = 'CANARI-PRIORITE';
  n.frequence_base_semaines = 777;
  n.classe = 'CANARI-CLASSE'; n.eleves = ['CANARI-ELEVE']; n.cours = 'CANARI-COURS'; n.mail = 'canari@exemple.invalid';
  const texteP = JSON.stringify(piege, null, 2) + '\n';
  const r = await executer(WF, { corps: CORPS, reponses: reponsesNominales({ [N.referentiel]: () => contenuGithub(R, texteP) }) });
  const requete = JSON.parse(r.requetes[N.ia].jsonBody);

  test('requête = { model, max_tokens, messages[1] } seulement', () => {
    assert.deepEqual(Object.keys(requete).sort(), ['max_tokens', 'messages', 'model']);
    assert.equal(requete.model, B.CONFIG.modele);
    assert.equal(requete.messages.length, 1);
    assert.deepEqual(Object.keys(requete.messages[0]).sort(), ['content', 'role']);
  });
  test('aucune donnée hors liste blanche dans la requête (marqueurs absents)', () => {
    const t = r.requetes[N.ia].jsonBody;
    for (const c of ['CANARI', '11.11', '99.99', '777', 'canari@']) assert.ok(!t.includes(c), c);
  });
  test('prompt = construirePrompt du dépôt sur la projection G3, sans contexte d\'autres lots', () => {
    const proj = Object.fromEntries(PROJECTION.map((k) => [k, n[k]]));
    const attendu = G.construirePrompt({ notion: proj, palier: 'nI', nCartes: B.CONFIG.nCartes, contextesDejaUtilises: [], contextesAutresPaliers: [] });
    assert.equal(requete.messages[0].content, attendu);
    assert.deepEqual(Object.keys(r.sorties[N.preparer][0].json.notion), PROJECTION);
  });
  test('referentiel_version = sha256 des octets lus au commit consigné', () => {
    assert.equal(r.sorties[N.preparer][0].json.referentiel_version, `sha256:${sha(Buffer.from(texteP, 'utf8'))}`);
  });
});

// --- 5. Refus : jamais de dépôt, souvent jamais d'appel au modèle -------------------------------
describe('refus avant dépôt (aucun fichier candidat)', () => {
  const cas = [
    ['corps avec champ en trop', { corps: { ...CORPS, x: 1 } }, N.entree],
    ['set_id invalide', { corps: { ...CORPS, set_id: 'set_fonda_X' } }, N.entree],
    ['ref vide', { corps: { ...CORPS, ref: '' } }, N.entree],
    ['commit design mal formé', { reponses: { [N.commit]: () => ({ sha: 'abc' }) } }, N.fixer],
    ['réservation absente', { reponses: { [N.journal]: () => contenuGithub(J, JSON.stringify({ schema: 'set-ids-journal/v1', lignes: [] })) } }, N.preparer],
    ['autre ref réservée', { corps: { ...CORPS, ref: '2026-10-20-autre0001' } }, N.preparer],
    ['set_id déjà publié', { reponses: { [N.journal]: () => contenuGithub(J, JSON.stringify({ schema: 'set-ids-journal/v1', lignes: [...JOURNAL.lignes, { set_id: FX.set_id, transition: 'publie', le: '2026-10-20', ref: `${FX.ref}:publie` }] })) } }, N.preparer],
    ['candidat déjà déposé', { reponses: { [N.existant]: () => ({ files: [{ id: 'z', name: `${FX.set_id}.lot.json` }] }) } }, N.preparer],
    ['listing paginé', { reponses: { [N.existant]: () => ({ files: [], nextPageToken: 't' }) } }, N.preparer],
    ['fichier > 1 Mo (contents sans base64)', { reponses: { [N.referentiel]: () => ({ ...contenuGithub(R, lireOctets(R)), encoding: 'none', content: '' }) } }, N.preparer],
    ['taille incohérente', { reponses: { [N.referentiel]: () => ({ ...contenuGithub(R, lireOctets(R)), size: 1 }) } }, N.preparer],
    ['autre chemin renvoyé', { reponses: { [N.referentiel]: () => contenuGithub('fonda/data/autre.json', lireOctets(R)) } }, N.preparer],
    ['moteur du registre ≠ moteur embarqué', { reponses: { [N.moteurs]: () => contenuGithub(MO, JSON.stringify([{ version: 'v1', sha256: '0'.repeat(64) }])) } }, N.preparer],
    ['modèle de la réponse ≠ épinglé (aucun repli)', { reponses: { [N.ia]: () => ({ ...FX.reponse_ia, model: 'claude-sonnet-5-5-20990101' }) } }, N.construire],
    ['modèle absent de la réponse', { reponses: { [N.ia]: () => { const x = { ...FX.reponse_ia }; delete x.model; return x; } } }, N.construire],
    ['max_tokens sans texte', { reponses: { [N.ia]: () => ({ ...FX.reponse_ia, content: [{ type: 'thinking', thinking: '…' }], stop_reason: 'max_tokens' }) } }, N.construire],
    ['aucune carte valide', { reponses: { [N.ia]: () => ({ ...FX.reponse_ia, content: [{ type: 'text', text: '{"cartes":[]}' }] }) } }, N.construire],
    ['notion exclue (géométrie)', { corps: { set_id: 'set_fonda_geometrie_nI_50', ref: FX.ref }, reponses: { [N.journal]: () => contenuGithub(J, JSON.stringify({ schema: 'set-ids-journal/v1', lignes: [{ set_id: 'set_fonda_geometrie_nI_50', transition: 'reserve', le: '2026-10-20', ref: FX.ref }] })) } }, N.preparer],
  ];
  for (const [nom, { corps = CORPS, reponses = {} }, attendu] of cas) {
    test(nom, async () => {
      const r = await executer(WF, { corps, reponses: reponsesNominales(reponses) });
      assert.equal(r.status, 'error');
      assert.equal(r.noeudErreur, attendu, r.erreur);
      assert.ok(!r.requetes[N.deposer], 'aucun dépôt');
      if (attendu !== N.construire) assert.ok(!r.requetes[N.ia], 'aucun appel au modèle');
    });
  }
  test('réponse Drive incohérente après dépôt -> erreur (le signataire verra une erreur APRÈS dépôt)', async () => {
    const r = await executer(WF, { corps: CORPS, reponses: reponsesNominales({ [N.deposer]: () => ({ id: 'drv-lot', name: `${FX.set_id}.lot.json`, parents: [B.CONFIG.dossierCandidats], properties: { fonda_set_id: FX.set_id } }) }) });
    assert.equal(r.status, 'error');
    assert.equal(r.noeudErreur, N.sortie);
  });
  test('« Verifier unicite » : réémet À L\'IDENTIQUE la réponse du dépôt ; la sortie lit le dépôt PAR SON NOM', async () => {
    const r = await executer(WF, { corps: CORPS, reponses: reponsesNominales() });
    assert.equal(r.status, 'success', r.erreur);
    assert.deepEqual(r.sorties[N.unicite], r.sorties[N.deposer]);
    assert.match(noeud(N.sortie).parameters.jsCode, new RegExp(`unItem\\(${JSON.stringify(N.deposer).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
  });
  const apresDepot = [
    ['doublon : 2 fichiers pour ce set_id', { files: [{ id: FX.fichier_drive_id }, { id: 'drv-autre' }] }, /doublon détecté/],
    ['zéro fichier après un dépôt réussi', { files: [] }, /aucun fichier/],
    ['plusieurs pages (nextPageToken)', { files: [{ id: FX.fichier_drive_id }], nextPageToken: 't' }, /plusieurs pages/],
    ['recherche incomplète', { files: [{ id: FX.fichier_drive_id }], incompleteSearch: true }, /incomplète/],
    ['fichier trouvé ≠ fichier déposé', { files: [{ id: 'drv-autre' }] }, /n'est pas celui déposé/],
    ['réponse inexploitable', { erreur: 'x' }, /inexploitable/],
  ];
  for (const [nom, listing, motif] of apresDepot) {
    test(`après dépôt — ${nom} -> erreur APRÈS dépôt (abandon côté signataire), jamais de sortie`, async () => {
      const r = await executer(WF, { corps: CORPS, reponses: reponsesNominales({ [N.relister]: () => listing }) });
      assert.equal(r.status, 'error');
      assert.equal(r.noeudErreur, N.unicite);
      assert.match(r.erreur, motif);
      assert.ok(r.requetes[N.deposer], 'le dépôt a eu lieu');
      assert.ok(!r.sorties[N.sortie]);
    });
  }
  test('relisting : même requête que la recherche avant dépôt (nom OU propriété), avec incompleteSearch', () => {
    const a = noeud(N.existant).parameters.queryParameters.parameters;
    const b = noeud(N.relister).parameters.queryParameters.parameters;
    assert.equal(b.find((x) => x.name === 'q').value, a.find((x) => x.name === 'q').value);
    assert.equal(b.find((x) => x.name === 'fields').value, 'nextPageToken,incompleteSearch,files(id,name,properties)');
    assert.notEqual(noeud(N.relister).retryOnFail, true);
  });
  test('code des nœuds sans Buffer, TextEncoder, crypto ni require réel (contexte nu)', async () => {
    const r = await executer(WF, { corps: CORPS, reponses: reponsesNominales(), contexteCode: {} });
    assert.equal(r.status, 'success', r.erreur);
    for (const x of WF.nodes.filter((y) => y.parameters.jsCode)) assert.ok(!/\brequire\(['"](?!\.\/catalogue\.js)/.test(x.parameters.jsCode.replace(/\/\/ >>> MODULE[\s\S]*?\/\/ <<< MODULE \S+/g, '')), x.name);
  });
});
