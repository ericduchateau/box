// Tests du CLI qui écrit (ecrire-relecture.js, CDC §21.12, P5-2).
// (1) Logique en processus : faux n8n (listes + détails runData), faux Drive, faux webhook en mode
//     onReceived dont les phases (exécution créée, terminée) sont PILOTÉES par `attendre`, faux trousseau.
// (2) A1 : cohérence de generationRetenue avec diagnostic-fonda sur la génération SIMULÉE de l'export audité.
// (3) Processus RÉELS sous /usr/bin/lockf (enfants `node -e`, aucun fichier ajouté) : D1, D2, E1.
// Usage : node --test fonda/scripts/ecrire-relecture.test.js

'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const V = require('./verrou-relecture.js');
const E = require('./ecrire-relecture.js');

const A = 'set_fonda_nombres-fractions-relatifs_nI_02';
const B = 'set_fonda_resolution-problemes_nI_02';
const FICHIER = 'fichierCandidatA0123456789';
const GEN = { journal_commit: 'a'.repeat(40), referentiel_version: `sha256:${'b'.repeat(64)}`, moteur: { version: 'v1', sha256: 'c'.repeat(64) } };
// Sentinelles aux formats réels (k / HMAC / jetons = 64 hex ; clé d'API n8n = JWT ; adresse).
const S = {
  k: 'a1'.repeat(32), hmac: 'b2c3'.repeat(16), jetonEmettre: 'D4E5'.repeat(16), jetonCloturer: 'F6A7'.repeat(16),
  cleApi: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZW50aW5lbGxlIn0.c2VudGluZWxsZQ', adresse: 'sentinelle.relecteur@exemple.invalid',
};
const fuite = (texte) => Object.values(S).filter((s) => texte.includes(s));
const cloner = (o) => (o === null ? null : JSON.parse(JSON.stringify(o)));

// --- Monde simulé : n8n (deux workflows), candidat Drive, webhooks onReceived pilotés ---------------
function monde({ candidat = null, preexistantes = { emettre: [], cloturer: [] }, comportement = 'nominal', http = 200, panne = null } = {}) {
  const w = { candidat: cloner(candidat), execs: { emettre: [], cloturer: [] }, posts: [], prochain: 500, en_attente: [], comportement, http, panne, horloge: Date.parse('2026-11-16T10:00:00.000Z') };
  for (const wf of ['emettre', 'cloturer']) for (const id of preexistantes[wf]) w.execs[wf].push({ id, status: 'success', corps: { set_id: B }, sortie: null });
  const parId = (id) => ['emettre', 'cloturer'].map((wf) => [wf, w.execs[wf].find((e) => e.id === id)]).find(([, e]) => e) || [];
  const brute = (wf, e) => ({
    id: e.id, workflowId: E.WORKFLOWS[wf], status: e.status, mode: 'webhook',
    data: { resultData: { runData: {
      [E.NOEUDS[wf].webhook]: [{ data: { main: [[{ json: { headers: { 'x-fonda-token': wf === 'emettre' ? S.jetonEmettre : S.jetonCloturer }, body: e.corps } }]] } }],
      'Generer cle': [{ data: { main: [[{ json: { k: S.k, lien: `?lot=${e.corps.set_id}&k=${S.k}` } }]] } }],
      'Lire adresse relecteur': [{ data: { main: [[{ json: { adresse: S.adresse } }]] } }],
      ...(e.sortie ? { [E.NOEUDS[wf].sortie]: [{ data: { main: [[{ json: e.sortie }]] } }] } : {}),
    } } },
  });
  w.api = {
    listerExecutions: async ({ workflowId, status }) => {
      const wf = Object.keys(E.WORKFLOWS).find((k) => E.WORKFLOWS[k] === workflowId);
      if (w.panneApi) throw new Error('API indisponible');
      return w.execs[wf].filter((e) => (status ? e.status === status : e.status !== 'running')) // n8n 2.6.3 : sans filtre, seul running est exclu
        .map((e) => ({ id: e.id, workflowId, status: e.status, startedAt: '2026-11-16T10:00:00.000Z', stoppedAt: ['running', 'waiting', 'new'].includes(e.status) ? null : '2026-11-16T10:00:01.000Z' }));
    },
    lireExecution: async (id) => { const [wf, e] = parId(id); return e ? brute(wf, e) : null; },
  };
  w.candidats = { lire: async (s) => (s === A ? cloner(w.candidat) : null), appels: 0 };
  // Comportement des workflows (émission / réémission / clôture) appliqué À LA FIN de l'exécution.
  const effet = (wf, corps) => {
    if (w.comportement === 'refus') return { status: 'error', sortie: null }; // refus propre d'Emettre/Cloturer : rien écrit (A6)
    const c = w.candidat;
    if (wf === 'emettre') {
      if (c === null) w.candidat = { fichier_id: FICHIER, version: '3', generation_cle: 1, statut: 'en_attente', clos_le: null, envois: [{ generation_cle: 1, envoye_a: S.adresse, le: 'x' }], cle_sha256: S.hmac };
      else Object.assign(c, { generation_cle: c.generation_cle + 1, version: String(Number(c.version) + 2) });
      const n = w.candidat;
      return { status: 'success', sortie: { schema: 'emission-fonda/v1', set_id: corps.set_id, candidat_fichier_id: n.fichier_id, relecteur_attribue: 'eric', generation_cle: n.generation_cle, reemission: c !== null } };
    }
    const deja = c.statut === 'clos';
    if (!deja) Object.assign(c, { statut: 'clos', clos_le: '2026-11-16T10:05:00.000Z', version: String(Number(c.version) + 2) });
    return { status: 'success', sortie: { schema: 'cloture-fonda/v1', set_id: corps.set_id, clos_le: c.clos_le, deja_clos: deja, candidat_fichier_id: c.fichier_id, nb_decisions_listees: 0, incomplete_search: false } };
  };
  const poster = (wf) => async (corps) => {
    w.posts.push({ wf, corps: cloner(corps) });
    if (w.panne) return { panne: w.panne };
    if (w.http === 200) w.en_attente.push({ wf, corps, phase: 0 });
    return { http: w.http };
  };
  w.poster = { emettre: poster('emettre'), cloturer: poster('cloturer') };
  // Une « attente » fait avancer chaque exécution d'une phase : créée (running) -> terminée.
  w.attendre = async (ms) => {
    w.horloge += ms;
    for (const p of w.en_attente) {
      if (p.phase === 0) { p.id = String(w.prochain += 1); w.execs[p.wf].push({ id: p.id, status: 'running', corps: p.corps, sortie: null }); p.phase = 1; } else if (p.phase === 1) { const e = w.execs[p.wf].find((x) => x.id === p.id); Object.assign(e, effet(p.wf, p.corps)); p.phase = 2; }
    }
    w.en_attente = w.en_attente.filter((p) => p.phase < 2);
  };
  return w;
}
function banc(w, sur = {}) {
  const verrous = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecrire-')));
  const deps = {
    verrous, sousVerrou: path.join(verrous, 'relecture.verrou'), maintenant: () => w.horloge, attendre: w.attendre, pasMs: 1000,
    api: w.api, candidats: w.candidats, poster: w.poster, deriverGeneration: async () => cloner(GEN), generation: {}, incidents: async () => [], ...sur,
  };
  V.initialiser(deps);
  return { deps, journal: () => fs.readFileSync(path.join(verrous, 'relecture.journal'), 'utf8'), lignes: () => fs.readFileSync(path.join(verrous, 'relecture.journal'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) };
}
const EN_ATTENTE = { fichier_id: FICHIER, version: '7', generation_cle: 1, statut: 'en_attente', clos_le: null, envois: [{ envoye_a: S.adresse }], cle_sha256: S.hmac };
const lot = (b, s = A) => (V.lireEtat(b.deps.verrous).lots[s] || { etat: 'libre' }).etat;

describe('arguments', () => {
  test('commandes et set_id stricts ; options inconnues refusées', () => {
    assert.deepEqual(E.analyserArguments(['emettre', A]), { commande: 'emettre', setId: A });
    assert.deepEqual(E.analyserArguments(['attribuer-perte', '4', A, B]), { commande: 'attribuer-perte', ligne: 4, setIds: [A, B] });
    for (const argv of [['emettre'], ['emettre', 'x'], ['emettre', A, B], ['retry', A], ['etat', A], ['attribuer-perte', '0', A], ['--force', A]]) assert.throws(() => E.analyserArguments(argv), /usage|inconnue/, argv.join(' '));
  });
});

describe('écriture : journal d\'abord, un seul POST, conclusion par le diagnostic (A2)', () => {
  test('émission nominale : quiescence, corps fermé DÉRIVÉ, envoi au journal AVANT le POST, 200 -> attente -> effet_conforme', async () => {
    const w = monde();
    let journalAuPost = null;
    const b = banc(w);
    const poster = { ...w.poster, emettre: async (c) => { journalAuPost = b.journal(); return w.poster.emettre(c); } };
    const r = await E.executer({ commande: 'emettre', setId: A }, { ...b.deps, poster });
    assert.deepEqual(r, { set_id: A, issue: 'effet_conforme', execution_id: '501' });
    assert.deepEqual(w.posts, [{ wf: 'emettre', corps: { set_id: A, ...GEN } }], 'un seul POST, corps exact');
    assert.match(journalAuPost, /"type":"envoi"/, 'envoi écrit AVANT le POST');
    assert.deepEqual(b.lignes().map((l) => l.type), ['init', 'envoi', 'resolution']);
    assert.equal(lot(b), 'libre');
  });
  test('réémission puis clôture technique puis clôture répétée (deja_clos) : chacune conclue effet_conforme', async () => {
    const w = monde({ candidat: EN_ATTENTE });
    const b = banc(w);
    assert.equal((await E.executer({ commande: 'reemettre', setId: A }, b.deps)).issue, 'effet_conforme');
    assert.equal((await E.executer({ commande: 'clore-technique', setId: A }, b.deps)).issue, 'effet_conforme');
    assert.equal((await E.executer({ commande: 'clore-technique', setId: A }, b.deps)).issue, 'effet_conforme');
    assert.deepEqual(w.posts.map((p) => [p.wf, Object.keys(p.corps).sort().join(',')]), [['emettre', 'journal_commit,moteur,referentiel_version,set_id'], ['cloturer', 'set_id'], ['cloturer', 'set_id']]);
  });
  test('A3 : l\'ensemble préexistant consigné = TOUS les ids du workflow visé (autres lots compris)', async () => {
    const w = monde({ preexistantes: { emettre: ['7', '12'], cloturer: ['3'] } });
    const b = banc(w);
    await E.executer({ commande: 'emettre', setId: A }, b.deps);
    assert.deepEqual(b.lignes()[1].preexistantes, ['7', '12']);
  });
  test('A6 : refus propre d\'Emettre (exécution en erreur, candidat inchangé) -> sans_effet, lot LIBRE (pas anomalie)', async () => {
    for (const [commande, candidat] of [['emettre', null], ['reemettre', EN_ATTENTE], ['clore-technique', EN_ATTENTE]]) {
      const w = monde({ candidat, comportement: 'refus' });
      const b = banc(w);
      const avant = cloner(w.candidat);
      assert.equal((await E.executer({ commande, setId: A }, b.deps)).issue, 'sans_effet', commande);
      assert.deepEqual(w.candidat, avant, 'candidat inchangé');
      assert.equal(lot(b), 'libre');
    }
  });
  test('403 -> refuse_sans_effet (lot libre) ; A4 : 404, 500, délai, transport -> indetermine (jamais refuse_sans_effet pour un 404)', async () => {
    const w403 = monde({ http: 403 });
    const b403 = banc(w403);
    assert.equal((await E.executer({ commande: 'emettre', setId: A }, b403.deps)).issue, 'refuse_sans_effet');
    assert.equal(lot(b403), 'libre');
    for (const [o, motif] of [[{ http: 404 }, 'erreur_serveur'], [{ http: 500 }, 'erreur_serveur'], [{ http: 409 }, 'erreur_serveur'], [{ panne: 'delai' }, 'delai'], [{ panne: 'transport' }, 'transport']]) {
      const w = monde(o);
      const b = banc(w);
      const r = await E.executer({ commande: 'emettre', setId: A }, b.deps);
      assert.equal(r.issue, 'indetermine', JSON.stringify(o));
      assert.equal(b.lignes().at(-1).motif, motif);
      assert.equal(w.posts.length, 1, 'aucune relance');
      await assert.rejects(() => E.executer({ commande: 'emettre', setId: A }, b.deps), /tentative non résolue/);
      assert.equal(w.posts.length, 1);
    }
  });
  test('A2 : exécution non terminée dans le délai -> tentative OUVERTE (code 2) ; « diagnostiquer » la conclut ensuite', async () => {
    const w = monde();
    const b = banc(w, { attendre: async (ms) => { w.horloge += ms; } }); // l'exécution n'avance jamais pendant l'attente
    const r = await E.executer({ commande: 'emettre', setId: A }, { ...b.deps, attenteMaxMs: 5000 });
    assert.equal(r.issue, 'ouverte');
    assert.equal(lot(b), 'ouverte');
    await w.attendre(0); await w.attendre(0); // n8n crée puis termine l'exécution
    assert.equal((await E.executer({ commande: 'diagnostiquer', setId: A }, b.deps)).issue, 'effet_conforme');
    assert.equal(lot(b), 'libre');
  });
  test('diagnostiquer sans tentative ouverte : refus ; avec exécution encore en vol : reste ouverte', async () => {
    const w = monde();
    const b = banc(w);
    await assert.rejects(() => E.executer({ commande: 'diagnostiquer', setId: A }, b.deps), /aucune tentative ouverte/);
    const b2 = banc(w, { attendre: async () => {} });
    await E.executer({ commande: 'emettre', setId: A }, { ...b2.deps, attenteMaxMs: 0 });
    await w.attendre(0); // créée, en vol
    assert.equal((await E.executer({ commande: 'diagnostiquer', setId: A }, b2.deps)).issue, 'ouverte');
  });
});

describe('refus AVANT toute écriture et tout POST', () => {
  const refuse = async (w, b, args, motif) => {
    const avant = b.journal();
    await assert.rejects(() => E.executer(args, b.deps), motif);
    assert.equal(b.journal(), avant, 'journal inchangé');
    assert.equal(w.posts.length, 0, 'aucun POST');
  };
  test('quiescence : exécution en vol sur Emettre OU Cloturer, quel que soit le lot -> refus', async () => {
    for (const wf of ['emettre', 'cloturer']) {
      const w = monde();
      w.execs[wf].push({ id: '9', status: 'running', corps: { set_id: B }, sortie: null });
      await refuse(w, banc(w), { commande: 'emettre', setId: A }, /en vol/);
    }
  });
  test('observation n8n impossible -> refus (jamais « absence = zéro »)', async () => {
    const w = monde();
    w.panneApi = true;
    await refuse(w, banc(w), { commande: 'emettre', setId: A }, /observation n8n/);
  });
  test('génération non retenue (A1) -> refus', async () => {
    const w = monde();
    await refuse(w, banc(w, { deriverGeneration: async () => { throw new V.RefusRelecture('génération non retenue (test)'); } }), { commande: 'emettre', setId: A }, /génération non retenue/);
  });
  test('préconditions du verrou : émission avec candidat, réémission sans candidat ou clos, clôture sur abandonné', async () => {
    for (const [commande, candidat, motif] of [['emettre', EN_ATTENTE, /existe déjà/], ['reemettre', null, /absent/], ['reemettre', { ...EN_ATTENTE, statut: 'clos', clos_le: '2026-11-10T10:00:00.000Z' }, /non en_attente/], ['clore-technique', { ...EN_ATTENTE, statut: 'abandonne' }, /abandonné/]]) {
      const w = monde({ candidat });
      await refuse(w, banc(w), { commande, setId: A }, motif);
    }
  });
  test('lot avec tentative ouverte ou bloqué -> refus immédiat', async () => {
    const w = monde({ panne: 'delai' });
    const b = banc(w);
    await E.executer({ commande: 'emettre', setId: A }, b.deps);
    w.posts.length = 0;
    await refuse(w, b, { commande: 'emettre', setId: A }, /tentative non résolue/);
  });
});

describe('lecture du candidat (Drive relecture/, GET seulement)', () => {
  const DOSSIER = 'dossierRelecture0123456789';
  const faux = ({ fichiers = [{ id: FICHIER, name: `${A}.candidat.json`, version: '7' }], incomplet = false, contenu } = {}) => {
    const appels = [];
    const env = contenu || { schema: 'candidat-fonda/v1', lot: { set_id: A }, relecture: { statut: 'en_attente', generation_cle: 1, cle_sha256: S.hmac, clos_le: null, envois: [{ generation_cle: 1, envoye_a: S.adresse, le: 'x' }] } };
    const f = async (url, init) => {
      appels.push({ url, methode: init.method, redirect: init.redirect });
      const rep = (o) => ({ ok: true, status: 200, json: async () => o, arrayBuffer: async () => Buffer.from(JSON.stringify(o)) });
      if (url.includes('?fields=id,mimeType')) return rep({ id: DOSSIER, mimeType: 'application/vnd.google-apps.folder', trashed: false });
      if (url.includes('alt=media')) return rep(env);
      return rep({ incompleteSearch: incomplet, files: fichiers });
    };
    return { lc: E.lectureCandidats({ jeton: async () => 'jeton-oauth', fetch: f, dossier: DOSSIER }), appels };
  };
  test('projection : 5 champs seulement (jamais envois ni cle_sha256), GET seulement, version Drive', async () => {
    const { lc, appels } = faux();
    const c = await lc.lire(A);
    assert.deepEqual(c, { fichier_id: FICHIER, version: '7', generation_cle: 1, statut: 'en_attente', clos_le: null });
    assert.deepEqual(fuite(JSON.stringify(c)), []);
    assert.ok(appels.every((a) => a.methode === 'GET'));
    assert.ok(appels.every((a) => a.redirect === 'error'), 'aucune redirection suivie, même avec un fetch brut');
    assert.ok(appels.some((a) => decodeURIComponent(a.url).includes('files(id,name,version)')));
  });
  test('absence établie (recherche complète, zéro fichier) -> null ; incomplète, doublon, autre lot -> refus', async () => {
    assert.equal(await faux({ fichiers: [] }).lc.lire(A), null);
    await assert.rejects(() => faux({ incomplet: true, fichiers: [] }).lc.lire(A), /incomplète/);
    await assert.rejects(() => faux({ fichiers: [{ id: 'x1234567890' }, { id: 'y1234567890' }] }).lc.lire(A), /plusieurs fichiers/);
    await assert.rejects(() => faux({ contenu: { schema: 'candidat-fonda/v1', lot: { set_id: B }, relecture: {} } }).lc.lire(A), /autre lot/);
  });
  test('champ ABSENT de la relecture -> transmis absent (undefined), refusé ensuite par le verrou (jamais un null inventé)', async () => {
    const c = await faux({ contenu: { schema: 'candidat-fonda/v1', lot: { set_id: A }, relecture: { statut: 'en_attente', generation_cle: 1 } } }).lc.lire(A);
    assert.equal(Object.prototype.hasOwnProperty.call(c, 'clos_le'), false);
    const w = monde();
    const b = banc(w, { candidats: { lire: async () => c } });
    await assert.rejects(() => E.executer({ commande: 'reemettre', setId: A }, b.deps), /incomplet/);
  });
});

describe('webhook et trousseau', () => {
  test('un seul POST : en-tête X-FONDA-Token, corps JSON fermé ; délai -> delai ; erreur réseau -> transport', async () => {
    const vus = [];
    const p = E.webhook({ url: 'http://x/webhook/fonda-emettre', jeton: () => S.jetonEmettre, fetch: async (u, i) => { vus.push(i); return { status: 200 }; } });
    assert.deepEqual(await p({ set_id: A }), { http: 200 });
    assert.equal(vus[0].method, 'POST');
    assert.equal(vus[0].headers['X-FONDA-Token'], S.jetonEmettre);
    assert.equal(vus[0].body, JSON.stringify({ set_id: A }));
    // Faux transport en attente : une minuterie RÉFÉRENCÉE simule la connexion ouverte d'un vrai fetch
    // (la minuterie d'AbortSignal.timeout n'en est pas une : sans elle, Node 22 vide la boucle et annule).
    const lent = E.webhook({ url: 'http://x', jeton: () => 'j', delaiMs: 20, fetch: (u, i) => new Promise((_, rej) => { const connexion = setTimeout(() => {}, 10000); i.signal.addEventListener('abort', () => { clearTimeout(connexion); rej(i.signal.reason); }); }) });
    assert.deepEqual(await lent({}), { panne: 'delai' });
    assert.deepEqual(await E.webhook({ url: 'http://x', jeton: () => 'j', fetch: async () => { throw new TypeError('fetch failed'); } })({}), { panne: 'transport' });
  });
  test('trousseau : /usr/bin/security, arguments FIXES, sans shell ; secret illisible -> refus sans écho', () => {
    const vus = [];
    assert.equal(E.lireTrousseau('fonda-prod-emettre-token', (bin, args, o) => { vus.push([bin, args, o.shell]); return `${S.jetonEmettre}\n`; }), S.jetonEmettre);
    assert.deepEqual(vus, [['/usr/bin/security', ['find-generic-password', '-s', 'fonda-prod-emettre-token', '-w'], undefined]]);
    assert.throws(() => E.lireTrousseau('x', () => { throw new Error(S.jetonEmettre); }), (e) => fuite(e.message).length === 0 && /illisible/.test(e.message));
  });
  test('constantes : workflows de production, clé de LECTURE distincte, jetons par workflow', () => {
    assert.deepEqual(E.WORKFLOWS, { emettre: '5iJOTDkaTZq7z0sh', cloturer: 'QrmJY4gguZEx7YoS' });
    assert.deepEqual(E.TROUSSEAU, { emettre: 'fonda-prod-emettre-token', cloturer: 'fonda-prod-cloturer-token', lecture: 'fonda-prod-n8n-lecture' });
  });
});

describe('confinement : k, adresse, HMAC, jetons, clé d\'API (sentinelles)', () => {
  test('main : une erreur INTERNE (non RefusRelecture) n\'est jamais affichée (son message peut porter un secret)', { skip: !fs.existsSync('/usr/bin/lockf') && 'lockf absent' }, async () => {
    const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecrire-m-')));
    const ecrits = [];
    const orig = process.stderr.write.bind(process.stderr);
    const code = process.exitCode;
    process.stderr.write = (x) => { ecrits.push(String(x)); return true; };
    try { await E.main(['emettre', A], () => { throw new Error(`401 ${S.cleApi} ${S.jetonEmettre}`); }, d); } finally { process.stderr.write = orig; }
    const sortie = process.exitCode; process.exitCode = code;
    assert.equal(sortie, E.SORTIE.REFUS);
    assert.match(ecrits.join(''), /erreur interne \(détail non affiché\)/);
    assert.deepEqual(fuite(ecrits.join('')), []);
  });
  test('parcours complets : aucune sentinelle dans le journal, les résultats, les messages, l\'état', async () => {
    const sorties = [];
    for (const [commande, candidat, o] of [['emettre', null, {}], ['reemettre', EN_ATTENTE, {}], ['clore-technique', EN_ATTENTE, {}], ['emettre', null, { comportement: 'refus' }], ['emettre', null, { http: 404 }]]) {
      const w = monde({ candidat, ...o });
      const b = banc(w);
      try { sorties.push(await E.executer({ commande, setId: A }, b.deps)); } catch (e) { sorties.push(e.message); }
      sorties.push(await E.executer({ commande: 'etat' }, b.deps));
      assert.deepEqual(fuite(b.journal()), [], commande);
      assert.deepEqual(fs.readdirSync(b.deps.verrous).flatMap((f) => fuite(fs.readFileSync(path.join(b.deps.verrous, f), 'latin1'))), []);
    }
    assert.deepEqual(fuite(JSON.stringify(sorties)), []);
  });
  test('nouvellesExecutions : seuls id, set_id (corps du webhook), workflow, statut et sortie sont extraits', async () => {
    const w = monde();
    w.execs.emettre.push({ id: '42', status: 'success', corps: { set_id: A }, sortie: { schema: 'emission-fonda/v1', set_id: A } });
    const { nouvelles } = await E.nouvellesExecutions(w.api, 'emettre', []);
    assert.deepEqual(nouvelles, [{ id: '42', set_id: A, workflow: 'emettre', statut: 'success', sortie: { schema: 'emission-fonda/v1', set_id: A } }]);
    assert.deepEqual(fuite(JSON.stringify(nouvelles)), []);
  });
});


// --- Corrections de la relecture Codex P5-2 (un test par constat) ----------------------------------
const http = require('http');
const serveur = (gestion) => new Promise((ok) => { const sv = http.createServer(gestion); sv.listen(0, '127.0.0.1', () => ok(sv)); });
const fermer = (sv) => new Promise((ok) => sv.close(ok));
describe('constat 1 : aucune redirection n\'est suivie (jeton, clé) ; un 3xx -> indetermine', () => {
  const deuxOrigines = async () => {
    const recus = [];
    const B2 = await serveur((q, r) => { recus.push(q.headers); r.writeHead(403); r.end(); }); // « autre origine » : 403
    const A2 = await serveur((q, r) => { q.resume(); r.writeHead(307, { location: `http://127.0.0.1:${B2.address().port}/vole` }); r.end(); });
    return { recus, url: `http://127.0.0.1:${A2.address().port}/webhook/fonda-emettre`, fin: async () => { await fermer(A2); await fermer(B2); } };
  };
  test('webhook (fetch RÉEL) : 307 rendu tel quel, la seconde origine ne reçoit RIEN (ni jeton, ni 403 qui libérerait le lot)', async () => {
    const o = await deuxOrigines();
    try {
      assert.deepEqual(await E.webhook({ url: o.url, jeton: () => S.jetonEmettre })({ set_id: A }), { http: 307 });
      assert.equal(o.recus.length, 0);
    } finally { await o.fin(); }
  });
  test('lectures (sansRedirection, fetch RÉEL) : redirection = échec, la seconde origine ne reçoit rien', async () => {
    const o = await deuxOrigines();
    try {
      await assert.rejects(() => E.sansRedirection(globalThis.fetch)(o.url, { headers: { 'X-N8N-API-KEY': S.cleApi } }));
      assert.equal(o.recus.length, 0);
    } finally { await o.fin(); }
  });
  test('écriture : réponse 3xx -> indetermine (reponse_illisible), lot NON libéré, aucune relance', async () => {
    for (const code of [301, 302, 307, 308, 0]) {
      const w = monde({ http: code });
      const b = banc(w);
      assert.equal((await E.executer({ commande: 'emettre', setId: A }, b.deps)).issue, 'indetermine', String(code));
      assert.equal(b.lignes().at(-1).motif, 'reponse_illisible');
      assert.notEqual(lot(b), 'libre');
      assert.equal(w.posts.length, 1);
    }
  });
});

describe('constat 2 : incident ouvert = TOUTE écriture suspendue (arbitrage) ; registre illisible -> refus', () => {
  const refuseAvant = async (incidents, motif) => {
    for (const [commande, candidat] of [['emettre', null], ['reemettre', EN_ATTENTE], ['clore-technique', EN_ATTENTE]]) {
      const w = monde({ candidat });
      const b = banc(w, { incidents });
      const avant = b.journal();
      await assert.rejects(() => E.executer({ commande, setId: A }, b.deps), motif, commande);
      assert.equal(b.journal(), avant);
      assert.equal(w.posts.length, 0);
    }
  };
  test('incident ouvert -> refus d\'émettre, de réémettre ET de clore-technique', async () => {
    await refuseAvant(async () => [{ id: 'inc-1', statut: 'resolu' }, { id: 'inc-2', statut: 'ouvert' }], /incident de chaîne ouvert/);
  });
  test('registre illisible, absent ou non tableau -> refus (jamais « aucun incident »)', async () => {
    await refuseAvant(async () => { throw new Error('perdu'); }, /registre des incidents illisible/);
    await refuseAvant(async () => ({}), /registre des incidents illisible/);
  });
  test('incidents tous résolus -> écriture permise', async () => {
    const w = monde();
    const b = banc(w, { incidents: async () => [{ id: 'inc-1', statut: 'resolu' }] });
    assert.equal((await E.executer({ commande: 'emettre', setId: A }, b.deps)).issue, 'effet_conforme');
  });
});

describe('constat 3 : détail d\'exécution confronté au listing (id, workflow, statut)', () => {
  for (const [nom, alterer] of [['id', (x) => ({ ...x, id: '999' })], ['workflow', (x) => ({ ...x, workflowId: E.WORKFLOWS.cloturer })], ['statut', (x) => ({ ...x, status: 'error' })], ['détail absent', () => null],
    ['startedAt (P2-3)', (x) => ({ ...x, startedAt: '2026-11-16T09:00:00.000Z' })], ['date hors grammaire (P2-3)', (x) => ({ ...x, stoppedAt: 'hier' })]]) {
    test(`${nom} contradictoire -> refus, AUCUNE résolution (tentative ouverte)`, async () => {
      const w = monde();
      const b = banc(w);
      const lire = w.api.lireExecution;
      b.deps.api = { ...w.api, lireExecution: async (id) => { const x = await lire(id); return x && x.status === 'success' ? alterer(x) : x; } };
      await assert.rejects(() => E.executer({ commande: 'emettre', setId: A }, b.deps), /détail contradictoire|illisible/);
      assert.equal(lot(b), 'ouverte');
      assert.deepEqual(b.lignes().map((l) => l.type), ['init', 'envoi']);
    });
  }
  test('exécution EN VOL au listing : détail non lu, set_id inconnu (le diagnostic maintient)', async () => {
    const w = monde();
    w.execs.emettre.push({ id: '42', status: 'running', corps: { set_id: A }, sortie: null });
    const lus = [];
    const api = { ...w.api, lireExecution: async (id) => { lus.push(id); return w.api.lireExecution(id); } };
    const { nouvelles, enVol } = await E.nouvellesExecutions(api, 'emettre', []);
    assert.deepEqual(nouvelles, [{ id: '42', set_id: null, workflow: 'emettre', statut: 'running', sortie: undefined }]);
    assert.equal(enVol, true);
    assert.deepEqual(lus, []);
  });
});

describe('constat 4 : messages publics = codes fixes (aucune valeur lue)', () => {
  test('refus de lecture d\'exécution, de Drive, de journal : aucun id, aucun code HTTP, aucune raison brute', async () => {
    const w = monde();
    w.execs.emettre.push({ id: '4242', status: 'success', corps: { set_id: A }, sortie: null });
    const api = { ...w.api, lireExecution: async () => { throw new Error(S.adresse); } };
    await assert.rejects(() => E.nouvellesExecutions(api, 'emettre', []), (e) => e instanceof V.RefusRelecture && !e.message.includes('4242') && fuite(e.message).length === 0);
    const lc = E.lectureCandidats({ jeton: async () => 'j', dossier: 'd1234567890', fetch: async () => ({ ok: false, status: 418 }) });
    await assert.rejects(() => lc.lire(A), (e) => !e.message.includes('418'));
  });
});

describe('constat 6 : attente RÉELLEMENT bornée (budget global, lectures annulées)', () => {
  test('lecture n8n suspendue après le 200 -> rend « ouverte » à l\'échéance, signal d\'annulation levé, journal sans résolution', async () => {
    const w = monde();
    const borne = {};
    let signalVu = null;
    const b = banc(w, { borne, attenteMaxMs: 80 });
    const lister = w.api.listerExecutions;
    b.deps.api = { ...w.api, listerExecutions: async (q) => { if (w.posts.length) { signalVu = borne.signal; return new Promise(() => {}); } return lister(q); } };
    const t0 = Date.now();
    const r = await E.executer({ commande: 'emettre', setId: A }, b.deps);
    assert.equal(r.issue, 'ouverte');
    assert.ok(Date.now() - t0 < 2000, 'borné');
    assert.ok(signalVu && signalVu.aborted, 'requêtes en cours annulées');
    assert.equal(borne.signal, null, 'signal retiré après l\'attente');
    assert.deepEqual(b.lignes().map((l) => l.type), ['init', 'envoi']);
  });
  test('P2-1 frontière : lecture finie APRÈS l\'échéance par un traitement synchrone -> « ouverte », AUCUNE résolution écrite', async () => {
    const w = monde();
    const b = banc(w, { attenteMaxMs: 20, pasMs: 1 }); // horloge virtuelle : l'exécution se termine avant l'échéance virtuelle
    const lire = w.candidats.lire;
    let apres = false;
    b.deps.candidats = { lire: async (s) => { if (w.posts.length) { const t = Date.now(); while (Date.now() - t < 60) { /* traitement synchrone */ } apres = true; } return lire(s); } };
    const r = await E.executer({ commande: 'emettre', setId: A }, b.deps);
    assert.ok(apres, 'la lecture post-200 a bien eu lieu');
    assert.equal(r.issue, 'ouverte');
    assert.deepEqual(b.lignes().map((l) => l.type), ['init', 'envoi']);
    assert.equal(lot(b), 'ouverte');
  });
  test('pause suspendue (attendre ne rend jamais la main) -> échéance quand même', async () => {
    const w = monde();
    const b = banc(w, { attendre: () => new Promise(() => {}), attenteMaxMs: 50 });
    assert.equal((await E.executer({ commande: 'emettre', setId: A }, b.deps)).issue, 'ouverte');
  });
});

describe('constat 7 : fabrique de production (fetch et trousseau injectés)', () => {
  test('clé de LECTURE en GET seulement ; webhook = seul POST, jeton du webhook seul ; aucune redirection suivie', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecrire-prod-'));
    const { privateKey } = require('crypto').generateKeyPairSync('rsa', { modulusLength: 2048 });
    fs.writeFileSync(path.join(tmp, 'drive-compte-service.json'), JSON.stringify({ type: 'service_account', client_email: 'sa@exemple.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth.exemple.invalid/token' }));
    const secrets = { 'fonda-prod-n8n-lecture': S.cleApi, 'fonda-prod-emettre-token': S.jetonEmettre, 'fonda-prod-cloturer-token': S.jetonCloturer };
    const exec = (bin, args) => `${secrets[args[2]]}\n`;
    const appels = [];
    const rep = (o, status = 200) => ({ ok: status < 300, status, json: async () => o, arrayBuffer: async () => Buffer.from(JSON.stringify(o)) });
    const f = async (url, init = {}) => {
      appels.push({ url: String(url), methode: init.method || 'GET', entetes: { ...(init.headers || {}) }, redirect: init.redirect, signal: init.signal });
      if (String(url).startsWith('https://oauth.')) return rep({ access_token: 'jeton-oauth', expires_in: 3600 });
      if (String(url).includes('/api/v1/executions?')) return rep({ data: [] });
      if (String(url).includes('/api/v1/executions/')) return rep({ id: '1' });
      if (String(url).includes('/webhook/')) return { status: 200 };
      if (String(url).includes('fields=id,mimeType')) { const id = decodeURIComponent(String(url).split('/files/')[1].split('?')[0]); return rep({ id, mimeType: 'application/vnd.google-apps.folder', trashed: false }); }
      return rep({ incompleteSearch: false, files: [] });
    };
    const registre = async () => [];
    const d = E.dependancesProduction({ dossierCles: tmp, fetch: f, exec, locales: { incidents: registre } });
    assert.equal(d.incidents, registre, 'registre des incidents transmis à l\'écriture');
    assert.equal(d.generation.incidents, registre, 'et à la génération retenue');
    const ctl = new AbortController();
    d.borne.signal = ctl.signal; // pendant l'attente : toute lecture porte le signal d'échéance
    await d.api.listerExecutions({ workflowId: E.WORKFLOWS.cloturer });
    assert.equal(appels.at(-1).signal, ctl.signal);
    d.borne.signal = null;
    await d.api.listerExecutions({ workflowId: E.WORKFLOWS.emettre });
    await d.api.lireExecution('1');
    assert.equal(await d.candidats.lire(A), null);
    await d.generation.drive.listerCandidats();
    await d.poster.emettre({ set_id: A });
    await d.poster.cloturer({ set_id: A });
    const avecCle = appels.filter((a) => Object.values(a.entetes).includes(S.cleApi));
    assert.ok(avecCle.length >= 2);
    assert.ok(avecCle.every((a) => a.methode === 'GET' && a.url.includes('/api/v1/executions')), 'clé de lecture : GET n8n seulement');
    const posts = appels.filter((a) => a.methode === 'POST' && !a.url.startsWith('https://oauth.'));
    assert.deepEqual(posts.map((a) => [a.url.split('/webhook/')[1], a.entetes['X-FONDA-Token'], a.redirect]), [['fonda-emettre', S.jetonEmettre, 'manual'], ['fonda-cloturer', S.jetonCloturer, 'manual']]);
    assert.ok(appels.filter((a) => !posts.includes(a)).every((a) => a.redirect === 'error'), 'toute lecture : redirect error');
    assert.ok(appels.filter((a) => a.url.includes('googleapis')).every((a) => a.methode === 'GET'), 'Drive : GET seulement');
    assert.ok(!appels.some((a) => Object.values(a.entetes).includes(S.jetonEmettre) && !a.url.includes('/webhook/fonda-emettre')), 'jeton Emettre confiné');
  });
});

// --- A1 : cohérence avec diagnostic-fonda sur la génération SIMULÉE de l'export audité -------------
const RACINE = path.join(__dirname, '..', '..');
const FIXTURE = require('./fixtures/execution-generation.json');
// Limite (P3) : diagnostic-fonda (gelé) n'expose que la PREMIÈRE cause d'acces_ko ; l'oracle ne peut donc
// juger que des pannes isolées. Cas combiné : test dédié ci-dessous (le CLI, plus strict, refuse).
describe('A1 : generationRetenue conclut « généré » quand diagnostic-fonda établit le rapprochement sans blocage lié à la génération (pannes isolées)', () => {
  const t = {};
  const SET = FIXTURE.workflow_ia.set_id;
  before(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecrire-integ-'));
    t.copie = path.join(tmp, 'depot'); t.dossier = path.join(tmp, 'clotures');
    execFileSync('git', ['clone', '--quiet', RACINE, t.copie], { stdio: 'ignore' });
    const liste = execFileSync('git', ['ls-files', '-z', '--cached'], { cwd: RACINE }).toString('utf8').split('\0').filter(Boolean);
    for (const rel of liste) { const src = path.join(RACINE, rel); if (fs.existsSync(src) && fs.statSync(src).isFile()) { fs.mkdirSync(path.dirname(path.join(t.copie, rel)), { recursive: true }); fs.copyFileSync(src, path.join(t.copie, rel)); } }
    const g = (...a) => execFileSync('git', a, { cwd: t.copie, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    g('config', 'user.email', 'test@exemple.invalid'); g('config', 'user.name', 'test');
    fs.writeFileSync(path.join(t.copie, 'fonda/data/modeles-autorises.json'), `${JSON.stringify({ schema: 'modeles-autorises/v1', generation_fonda: [FIXTURE.modele] }, null, 2)}\n`);
    const jp = path.join(t.copie, 'fonda/data/set_ids-journal.json');
    const j = JSON.parse(fs.readFileSync(jp, 'utf8')); j.lignes.push({ set_id: SET, transition: 'reserve', le: '2026-10-20', ref: FIXTURE.workflow_ia.ref }); fs.writeFileSync(jp, `${JSON.stringify(j, null, 2)}\n`);
    g('add', '-A'); g('commit', '-qm', 'état testé'); t.commit = g('rev-parse', 'HEAD'); g('update-ref', 'refs/remotes/origin/design', t.commit);
    const charger = (rel) => require(path.join(t.copie, rel));
    t.A = charger('fonda/scripts/adaptateurs-production.js'); t.D = charger('fonda/scripts/diagnostic-fonda.js'); t.E = E; // module testé (dépôt)
    const { executerGraphe } = charger('n8n/fonda-generation-ia/simulateur.js');
    const N = charger('n8n/fonda-generation-ia/construire-workflow.js').NOEUDS;
    const GENWF = JSON.parse(fs.readFileSync(path.join(t.copie, 'n8n/fonda-generation-ia/box-fonda-generation-ia.json'), 'utf8'));
    const auCommit = (rel) => execFileSync('git', ['show', `${t.commit}:${rel}`], { cwd: t.copie });
    const gh = (chemin, o) => ({ type: 'file', encoding: 'base64', path: chemin, size: o.length, sha: 'blob', content: `${o.toString('base64').replace(/(.{60})/g, '$1\n')}\n` });
    const ok = (body) => ({ statusCode: 200, body });
    const lireMultipart = (q) => { const fr = /boundary=(.+)$/.exec(q.rawContentType)[1]; const p = q.body.split(`--${fr}`); const part = (x) => x.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''); return { metadonnees: JSON.parse(part(p[1])), contenu: part(p[2]) }; };
    const r = await executerGraphe(GENWF, { corps: { set_id: SET, ref: FIXTURE.workflow_ia.ref }, executionId: '901', reponses: {
      [N.commit]: () => ok({ sha: t.commit }), [N.journal]: () => ok(gh('fonda/data/set_ids-journal.json', auCommit('fonda/data/set_ids-journal.json'))),
      [N.referentiel]: () => ok(gh('fonda/data/referentiel.json', auCommit('fonda/data/referentiel.json'))), [N.moteurs]: () => ok(gh('fonda/engine/moteurs.json', auCommit('fonda/engine/moteurs.json'))),
      [N.existant]: () => ok({ files: [] }), [N.ia]: () => ok(FIXTURE.workflow_ia.reponse_ia),
      [N.deposer]: (q) => { const { metadonnees } = lireMultipart(q); return ok({ id: 'drv-lot', name: metadonnees.name, parents: metadonnees.parents, properties: metadonnees.properties }); },
      [N.relister]: () => ok({ files: [{ id: 'drv-lot' }] }),
    } });
    assert.equal(r.status, 'success', r.erreur);
    const { metadonnees, contenu } = lireMultipart(r.requetes[N.deposer]);
    // Sentinelles injectées dans d'AUTRES nœuds de l'exécution de génération et dans le lot (non lu au-delà).
    r.runData['Noeud sentinelle'] = [{ data: { main: [[{ json: { k: S.k, adresse: S.adresse, cle: S.cleApi } }]] } }];
    t.lot = Buffer.from(contenu, 'utf8');
    t.execution = { id: '901', workflowId: t.A.WORKFLOW_GENERATION, status: 'success', mode: 'webhook', startedAt: '2026-10-20T07:00:00.000Z', stoppedAt: '2026-10-20T07:01:30.000Z', workflowData: { pinData: {} }, data: { resultData: { runData: r.runData } } };
    t.metadonnees = metadonnees;
    fs.mkdirSync(t.dossier, { recursive: true }); fs.writeFileSync(path.join(t.dossier, '.initialise'), ''); // registre initialisé (incidents injectés par montage)
    const so = JSON.parse(JSON.stringify(r.runData)); t.sortieGeneration = so; // valeurs attendues lues de la sortie de la génération
    t.git = (a) => (a[0] === 'fetch' ? Buffer.alloc(0) : execFileSync('git', a, { cwd: t.copie, stdio: ['ignore', 'pipe', 'ignore'] }));
  });
  const monter = (v = {}) => {
    const ex = v.execution || t.execution;
    const fixes = v.listes || [{ id: '901', workflowId: t.A.WORKFLOW_GENERATION, status: 'success', startedAt: ex.startedAt, stoppedAt: ex.stoppedAt }];
    let appels = 0; let listes = fixes;
    const api = { listerExecutions: async ({ status }) => { listes = v.listesParAppel ? v.listesParAppel(appels++) : fixes; return status ? listes.filter((x) => x.status === status) : listes.filter((x) => x.status !== 'running'); }, lireExecution: async (id) => { const l = listes.find((x) => x.id === id); if (!l) return null; return JSON.parse(JSON.stringify(v.detailSelonListing ? { ...ex, id, status: l.status, startedAt: l.startedAt, stoppedAt: l.stoppedAt } : { ...ex, id })); } };
    let n = 0;
    const lotFichier = () => ({ id: 'drv-lot', nom: t.metadonnees.name, modifie_le: '2026-10-20T07:01:00.000Z', octets: (v.lotLu || ((i) => Buffer.from(t.lot)))(n++) });
    const fichiers = v.sansFichier ? [] : [{ id: 'drv-lot', nom: t.metadonnees.name, modifie_le: '2026-10-20T07:01:00.000Z', properties: t.metadonnees.properties, proprietesLisibles: true }, ...(v.fichiersEnPlus || [])];
    const drive = { verifierDossier: async () => {}, listerCandidats: async () => ({ incompleteSearch: v.incomplet ?? false, fichiers }), lireLotGenere: async () => lotFichier(), candidatsDuSetId: async () => 1 };
    const s = t.A.sourcesLecture({ racine: t.copie, dossier: t.dossier, dossierCles: t.dossier, api, drive, git: t.git });
    s.incidents = async () => { if (v.incidentsPanne) throw new Error('registre perdu'); return JSON.parse(JSON.stringify(v.incidents || [])); }; // MÊME registre des deux côtés
    if (v.referentielFaux) s.referentielArchive = async () => Buffer.from('autre');
    // Appels successifs au référentiel archivé : le 1er sert au contrôle d'empreinte, les suivants au
    // relecteur attribué (même ordre côté diagnostic et côté CLI ; compteur propre à chaque montage).
    if (v.referentielParAppel) { const vrai = s.referentielArchive; let i = 0; s.referentielArchive = async (ver) => v.referentielParAppel(i++, () => vrai(ver)); }
    return s;
  };
  const RAPPROCHE = ['pret_pour_saisie', 'relecteur_non_local'];
  // Oracle (P2-4) : rapprochement établi ET aucun blocage LIÉ À LA GÉNÉRATION. acces_ko ne compte que
  // pour n8n, les candidats Drive et le registre des incidents (le détail affiché est la PREMIÈRE cause :
  // les variantes ne combinent jamais deux causes d'acces_ko). Décisions locales et actualisation git
  // n'y entrent pas : l'émission n'en dépend pas (divergence ASSUMÉE, testée ci-dessous).
  const GENERATION = ['non_initialise', 'incident_ouvert', 'observation_contradictoire', 'generation_en_cours'];
  const accesGeneration = (x) => x.etat === 'acces_ko' && /^(n8n|Drive|registre des incidents)\b/.test(String(x.detail));
  const comparer = async (nom, v, attendu, surDiagnostic = (s) => s) => {
    const s = surDiagnostic(monter(v));
    const d = await t.D.diagnostiquer(SET, s);
    t.dernierDiagnostic = d;
    const diagnostic = d.applicables.some((x) => RAPPROCHE.includes(x.etat)) && !d.applicables.some((x) => GENERATION.includes(x.etat) || accesGeneration(x));
    let cli; let sortie = null;
    try { sortie = await t.E.generationRetenue(SET, monter(v)); cli = true; } catch (e) { cli = false; sortie = e.message; }
    assert.equal(cli, diagnostic, `${nom} : CLI ${cli} ≠ diagnostic ${diagnostic} (${d.applicables.map((x) => x.etat).join(',')})`);
    assert.equal(cli, attendu, `${nom} : attendu ${attendu}`);
    assert.deepEqual(fuite(JSON.stringify(sortie)), [], `${nom} : confinement`);
    return sortie;
  };
  test('nominal : « généré » des deux côtés ; corps = sortie de la génération (journal_commit, referentiel_version, moteur)', async () => {
    const sortie = await comparer('nominal', {}, true);
    // Comparaison EN VALEUR : journal_commit = commit testé ; referentiel_version = empreinte du
    // référentiel À CE COMMIT ; moteur = celui de la sortie de la génération (et du registre).
    const so = t.sortieGeneration[require('./liaison-generation.js').NOEUD_SORTIE];
    const json = so[0].data.main[0][0].json;
    const ref = execFileSync('git', ['show', `${t.commit}:fonda/data/referentiel.json`], { cwd: t.copie });
    assert.deepEqual(sortie, { journal_commit: t.commit, referentiel_version: `sha256:${require('crypto').createHash('sha256').update(ref).digest('hex')}`, moteur: { version: json.moteur.version, sha256: json.moteur.sha256 } });
    assert.equal(json.referentiel_version, sortie.referentiel_version);
    assert.equal(json.journal_commit, t.commit);
  });
  test('variantes : non généré des deux côtés (doublon, lot modifié, lot absent du listing, recherche incomplète, référentiel faux, pinData, aucune génération)', async () => {
    const ex2 = { id: '902', workflowId: t.A.WORKFLOW_GENERATION, status: 'success', startedAt: '2026-10-20T07:00:00.000Z', stoppedAt: '2026-10-20T07:01:30.000Z' };
    const base = { id: '901', workflowId: t.A.WORKFLOW_GENERATION, status: 'success', startedAt: '2026-10-20T07:00:00.000Z', stoppedAt: '2026-10-20T07:01:30.000Z' };
    await comparer('doublon', { listes: [base, ex2] }, false);
    await comparer('lot modifié entre les lectures', { lotLu: (i) => Buffer.from(i === 0 ? t.lot : Buffer.concat([t.lot, Buffer.from(' ')])) }, false);
    await comparer('lot absent du listing', { sansFichier: true }, false);
    await comparer('recherche incomplète', { incomplet: true }, false);
    await comparer('référentiel archivé faux', { referentielFaux: true }, false);
    await comparer('pinData', { execution: { ...t.execution, workflowData: { pinData: { x: [] } } } }, false);
    await comparer('aucune génération', { listes: [] }, false);
    await comparer('relecteur attribué non déterminable (référentiel illisible APRÈS le contrôle)', { referentielParAppel: (i, vrai) => (i === 0 ? vrai() : Promise.reject(new Error('panne'))) }, false);
    await comparer('référentiel faux AU CONTRÔLE seulement (relecteur déterminable)', { referentielParAppel: (i, vrai) => (i === 0 ? Buffer.from('autre') : vrai()) }, false);
  });
  test('constat 2 / 5 : blocages GLOBAUX — génération en cours, observation contradictoire, incident ouvert : non généré des deux côtés', async () => {
    const base = { id: '901', workflowId: t.A.WORKFLOW_GENERATION, status: 'success', startedAt: '2026-10-20T07:00:00.000Z', stoppedAt: '2026-10-20T07:01:30.000Z' };
    const enCours = await comparer('génération en cours (autre exécution en vol)', { listes: [base, { id: '906', workflowId: t.A.WORKFLOW_GENERATION, status: 'running', startedAt: '2026-10-20T08:00:00.000Z', stoppedAt: null }] }, false);
    assert.match(enCours, /generation_en_cours/, 'refusé DÈS la première observation, code exact');
    await comparer('observation contradictoire (détail ≠ listing, autre exécution)', { listes: [base, { ...base, id: '905', startedAt: '2026-10-20T06:00:00.000Z' }] }, false);
    await comparer('observation contradictoire (listing error, détail success : ignorée par le relecteur)', { listes: [base, { ...base, id: '907', status: 'error' }] }, false);
    await comparer('incident ouvert', { incidents: [{ id: 'inc-1', nature: 'test', detecte_le: '2026-10-19T10:00:00.000Z', statut: 'ouvert', resolu_le: null, preuve_resolution: null, periode: { debut: '2026-10-19T10:00:00.000Z', fin: null } }] }, false);
  });
  test('P2-4 divergences ASSUMÉES : décisions locales illisibles, git non actualisé -> diagnostic acces_ko, CLI « généré » (par conception)', async () => {
    await comparer('décisions locales illisibles', {}, true, (s) => { s.decisionsLocales = async () => { throw new Error('illisible'); }; return s; });
    assert.ok(t.dernierDiagnostic.applicables.some((x) => x.etat === 'acces_ko' && /^décisions locales/.test(x.detail)), 'divergence réellement exercée');
    await comparer('git non actualisé', {}, true, (s) => { s.interim = { ...s.interim, actualiser: async () => { throw new Error('hors ligne'); } }; return s; });
    assert.ok(t.dernierDiagnostic.applicables.some((x) => x.etat === 'acces_ko' && /^git/.test(x.detail)), 'divergence réellement exercée');
  });
  test('P3 limite documentée : panne git PUIS panne du registre -> le diagnostic n\'affiche que git ; le CLI refuse (registre)', async () => {
    const v = { incidentsPanne: true };
    const s = monter(v);
    s.interim = { ...s.interim, actualiser: async () => { throw new Error('hors ligne'); } };
    const d = await t.D.diagnostiquer(SET, s);
    assert.ok(d.applicables.some((x) => x.etat === 'acces_ko' && /^git/.test(x.detail)), 'première cause affichée : git (la panne du registre est masquée)');
    await assert.rejects(() => t.E.generationRetenue(SET, monter(v)), /registre des incidents illisible/);
  });
  test('P2-4 : acces_ko LIÉ à la génération (n8n, Drive, registre) -> non généré des deux côtés', async () => {
    const v = { incidentsPanne: true };
    await comparer('registre des incidents en panne', v, false);
  });
  test('P2-2 : DERNIÈRE observation — exécution apparue après la première (en vol, ou terminée ignorée par le relecteur) -> refus', async () => {
    const base = { id: '901', workflowId: t.A.WORKFLOW_GENERATION, status: 'success', startedAt: '2026-10-20T07:00:00.000Z', stoppedAt: '2026-10-20T07:01:30.000Z' };
    const autre = (id) => ({ ...base, id, status: 'error' });
    for (const [nom, avant, apres, seuil] of [
      ['en vol', [base], [base, { id: '908', workflowId: t.A.WORKFLOW_GENERATION, status: 'running', startedAt: '2026-10-20T08:00:00.000Z', stoppedAt: null }]],
      ['ids différents (error)', [base], [base, autre('909')]],
      ['même id repassé en vol', [base, autre('912')], [base, { ...autre('912'), status: 'running', stoppedAt: null }]],
      ['autant d\'ids, mais d\'autres', [base, autre('910')], [base, autre('911')]],
      // ids constants : l'exécution RETENUE change APRÈS l'observation du relecteur (requêtes 4 à 6).
      ['ids constants : retenue success -> error', [base], [{ ...base, status: 'error' }], 6],
      ['ids constants : date changée', [base, autre('914')], [base, { ...autre('914'), stoppedAt: '2026-10-20T07:02:00.000Z' }]],
    ]) {
      const s = monter({ detailSelonListing: true, listesParAppel: (n) => (n < (seuil || 3) ? avant : apres) }); // 3 requêtes = une observation
      await assert.rejects(() => t.E.generationRetenue(SET, s), (e) => /observation_instable/.test(e.message) && fuite(e.message).length === 0, nom);
    }
  });
  test('constat 4 : sentinelle d\'adresse dans un NOM de fichier et dans des PROPERTIES -> refus sans écho', async () => {
    await comparer('adresse dans un nom de fichier', { fichiersEnPlus: [{ id: 'drv-x', nom: `${S.adresse}.lot.json`, modifie_le: '2026-10-20T07:01:00.000Z', properties: null, proprietesLisibles: false }] }, false);
    await comparer('adresse dans des properties', { fichiersEnPlus: [{ id: 'drv-y', nom: `${SET}.lot.json`, modifie_le: '2026-10-20T07:01:00.000Z', properties: { fonda_set_id: SET, fonda_execution_id: S.adresse }, proprietesLisibles: true }] }, false);
  });
});

// --- Processus RÉELS sous /usr/bin/lockf : D1, D2, E1 -------------------------------------------
// Chaque enfant est `node -e <script>` (aucun fichier ajouté) : il construit un monde simulé PARTAGÉ
// sur disque (état JSON) et appelle main() ; le POST s'arrête sur une barrière (fichier `go`).
const lockf = fs.existsSync('/usr/bin/lockf');
const ENFANT = `
const fs = require('fs'); const E = require(${JSON.stringify(path.join(__dirname, 'ecrire-relecture.js'))});
const c = JSON.parse(process.env.CONF); const lireE = () => JSON.parse(fs.readFileSync(c.etat, 'utf8')); const ecrireE = (x) => fs.writeFileSync(c.etat, JSON.stringify(x));
const attendre = (p) => { const s = new Int32Array(new SharedArrayBuffer(4)); while (!fs.existsSync(p)) Atomics.wait(s, 0, 0, 20); };
const WF = E.WORKFLOWS;
const api = { listerExecutions: async ({ workflowId, status }) => { const wf = Object.keys(WF).find((k) => WF[k] === workflowId); return lireE().execs[wf].filter((e) => (status ? e.status === status : e.status !== 'running')).map((e) => ({ id: e.id, workflowId, status: e.status, startedAt: '2026-11-16T10:00:00.000Z', stoppedAt: e.status === 'running' ? null : '2026-11-16T10:00:01.000Z' })); },
  lireExecution: async (id) => { for (const wf of Object.keys(WF)) { const e = lireE().execs[wf].find((x) => x.id === id); if (e) return { id, workflowId: WF[wf], status: e.status, data: { resultData: { runData: { [E.NOEUDS[wf].webhook]: [{ data: { main: [[{ json: { body: e.corps } }]] } }], ...(e.sortie ? { [E.NOEUDS[wf].sortie]: [{ data: { main: [[{ json: e.sortie }]] } }] } : {}) } } } }; } return null; } };
// Barrière : PENDANT le POST (D1, D2, témoin) ou APRÈS le 200, à la première lecture qui suit (E1).
const barriere = () => { fs.writeFileSync(c.pret, String(process.pid)); attendre(c.go); };
let poste = false;
const poster = (wf) => async (corps) => { fs.appendFileSync(c.posts, JSON.stringify({ wf, corps }) + '\\n'); poste = true; if (!c.apres200) barriere(); return { http: 200 }; };
const lister = api.listerExecutions; api.listerExecutions = async (q) => { if (poste && c.apres200) barriere(); return lister(q); };
const fabrique = () => ({ api, incidents: async () => [], candidats: { lire: async () => lireE().candidat }, poster: { emettre: poster('emettre'), cloturer: poster('cloturer') }, deriverGeneration: async () => (${JSON.stringify(GEN)}), generation: {}, attenteMaxMs: c.apres200 ? 60000 : 0 });
E.main(c.argv, fabrique, c.verrous);
`;
function lancer(conf, { detache = false } = {}) {
  const ch = spawn(process.execPath, ['-e', ENFANT], { env: { ...process.env, CONF: JSON.stringify(conf) }, detached: detache, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  ch.stdout.on('data', (d) => { stdout += d; }); ch.stderr.on('data', (d) => { stderr += d; });
  ch.fin = new Promise((r) => ch.on('exit', (status) => r({ status, stdout, stderr })));
  return ch;
}
const attendreFichier = async (p, ms = 8000) => { const t0 = Date.now(); while (!fs.existsSync(p)) { if (Date.now() - t0 > ms) throw new Error(`attente ${p}`); await new Promise((r) => setTimeout(r, 20)); } };
describe('processus réels (lockf) : D1, D2 et E1 refusés par le verrou', { skip: !lockf && 'lockf absent (CI Linux) : à rejouer sur le Mac' }, () => {
  const base = (candidat) => {
    const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecrire-p-')));
    const c = { verrous: d, etat: path.join(d, 'etat.json'), posts: path.join(d, 'posts'), pret: path.join(d, 'pret'), go: path.join(d, 'go') };
    fs.writeFileSync(c.etat, JSON.stringify({ candidat, execs: { emettre: [], cloturer: [] } }));
    const t = V.prendreVerrou(d); V.initialiser({ verrous: d, sousVerrou: t.chemin }); fs.closeSync(t.fd);
    return c;
  };
  const nbPosts = (c) => (fs.existsSync(c.posts) ? fs.readFileSync(c.posts, 'utf8').trim().split('\n').length : 0);
  const CAND = { fichier_id: FICHIER, version: '7', generation_cle: 2, statut: 'en_attente', clos_le: null };
  for (const [nom, second] of [['D2 : deux réémissions concurrentes', ['reemettre', A]], ['D1 : clôture technique pendant une réémission', ['clore-technique', A]], ['autre lot pendant la détention (verrou unique)', ['emettre', B]]]) {
    test(`${nom} : la seconde commande échoue AUSSITÔT (75), un seul POST`, async () => {
      const c = base(CAND);
      const premier = lancer({ ...c, argv: ['reemettre', A] }, { detache: true });
      try {
        await attendreFichier(c.pret);
        const r = await lancer({ ...c, argv: second }).fin;
        assert.equal(r.status, V.OCCUPE, r.stderr);
        fs.writeFileSync(c.go, '');
        await premier.fin;
      } finally { try { process.kill(-premier.pid, 'SIGKILL'); } catch { /* fini */ } }
      assert.equal(nbPosts(c), 1);
    });
  }
  test('TÉMOIN D1/D2 : verrou NEUTRALISÉ (un dossier de verrou par commande) -> les DEUX POST partent (le test détecte l\'absence du verrou)', async () => {
    const c = base(CAND);
    const c2 = base(CAND);
    const premier = lancer({ ...c, argv: ['reemettre', A] }, { detache: true });
    let second;
    try {
      await attendreFichier(c.pret);
      second = lancer({ ...c, verrous: c2.verrous, argv: ['clore-technique', A] }, { detache: true }); // même monde, autre verrou
      const t0 = Date.now();
      while (nbPosts(c) < 2 && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 20));
      assert.equal(nbPosts(c), 2, 'sans verrou commun, la concurrence n\'est pas exclue');
      fs.writeFileSync(c.go, '');
      await premier.fin; await second.fin;
    } finally { for (const p of [premier, second]) { try { process.kill(-p.pid, 'SIGKILL'); } catch { /* fini */ } } }
  });
  test('E1 : réémission A partie, 200 REÇU, puis CLI tué ; une seconde réémission est refusée (tentative ouverte) ; seule une conclusion la débloque', async () => {
    const c = base(CAND);
    const premier = lancer({ ...c, apres200: true, argv: ['reemettre', A] }, { detache: true });
    await attendreFichier(c.pret); // barrière APRÈS le 200 (première lecture de l'attente)
    assert.equal(nbPosts(c), 1);
    assert.equal(V.lireEtat(c.verrous).lots[A].etat, 'ouverte', '200 reçu : tentative ouverte, rien de conclu');
    process.kill(premier.pid, 'SIGKILL');
    await premier.fin;
    const r = await lancer({ ...c, argv: ['reemettre', A] }).fin;
    assert.equal(r.status, E.SORTIE.REFUS);
    assert.match(r.stderr, /tentative non résolue/);
    assert.equal(nbPosts(c), 1, 'la clé de A ne peut pas être écrasée par une seconde réémission');
    const d = await lancer({ ...c, argv: ['diagnostiquer', A] }).fin; // l'exécution de A n'est pas encore apparue
    assert.equal(d.status, E.SORTIE.OUVERTE, d.stderr);
    const etat = JSON.parse(fs.readFileSync(c.etat, 'utf8')); // n8n exécute enfin la réémission de A
    etat.execs.emettre.push({ id: '700', status: 'success', corps: { set_id: A, ...GEN }, sortie: { schema: 'emission-fonda/v1', set_id: A, candidat_fichier_id: FICHIER, relecteur_attribue: 'eric', generation_cle: 3, reemission: true } });
    etat.candidat = { ...CAND, generation_cle: 3, version: '9' };
    fs.writeFileSync(c.etat, JSON.stringify(etat));
    const d2 = await lancer({ ...c, argv: ['diagnostiquer', A] }).fin;
    assert.equal(d2.status, 0, d2.stderr);
    assert.equal(JSON.parse(d2.stdout).issue, 'effet_conforme');
  });
});
