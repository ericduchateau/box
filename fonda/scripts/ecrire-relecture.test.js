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
      return w.execs[wf].filter((e) => (status ? e.status === status : !['running', 'waiting'].includes(e.status)))
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
    api: w.api, candidats: w.candidats, poster: w.poster, deriverGeneration: async () => cloner(GEN), generation: {}, ...sur,
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
      appels.push({ url, methode: init.method });
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
    assert.ok(appels.some((a) => decodeURIComponent(a.url).includes('files(id,name,version)')));
  });
  test('absence établie (recherche complète, zéro fichier) -> null ; incomplète, doublon, autre lot -> refus', async () => {
    assert.equal(await faux({ fichiers: [] }).lc.lire(A), null);
    await assert.rejects(() => faux({ incomplet: true, fichiers: [] }).lc.lire(A), /incomplète/);
    await assert.rejects(() => faux({ fichiers: [{ id: 'x1234567890' }, { id: 'y1234567890' }] }).lc.lire(A), /2 fichiers/);
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
    const lent = E.webhook({ url: 'http://x', jeton: () => 'j', delaiMs: 20, fetch: (u, i) => new Promise((_, rej) => i.signal.addEventListener('abort', () => rej(i.signal.reason))) });
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

// --- A1 : cohérence avec diagnostic-fonda sur la génération SIMULÉE de l'export audité -------------
const RACINE = path.join(__dirname, '..', '..');
const FIXTURE = require('./fixtures/execution-generation.json');
describe('A1 : generationRetenue conclut « généré » EXACTEMENT quand diagnostic-fonda établit le rapprochement', () => {
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
    t.git = (a) => (a[0] === 'fetch' ? Buffer.alloc(0) : execFileSync('git', a, { cwd: t.copie, stdio: ['ignore', 'pipe', 'ignore'] }));
  });
  const monter = (v = {}) => {
    const ex = v.execution || t.execution;
    const listes = v.listes || [{ id: '901', workflowId: t.A.WORKFLOW_GENERATION, status: 'success', startedAt: ex.startedAt, stoppedAt: ex.stoppedAt }];
    const api = { listerExecutions: async ({ status }) => (status ? listes.filter((x) => x.status === status) : listes.filter((x) => !['running', 'waiting'].includes(x.status))), lireExecution: async (id) => (listes.some((x) => x.id === id) ? JSON.parse(JSON.stringify({ ...ex, id })) : null) };
    let n = 0;
    const lotFichier = () => ({ id: 'drv-lot', nom: t.metadonnees.name, modifie_le: '2026-10-20T07:01:00.000Z', octets: (v.lotLu || ((i) => Buffer.from(t.lot)))(n++) });
    const drive = { verifierDossier: async () => {}, listerCandidats: async () => ({ incompleteSearch: v.incomplet ?? false, fichiers: v.sansFichier ? [] : [{ id: 'drv-lot', nom: t.metadonnees.name, modifie_le: '2026-10-20T07:01:00.000Z', properties: t.metadonnees.properties, proprietesLisibles: true }] }), lireLotGenere: async () => lotFichier(), candidatsDuSetId: async () => 1 };
    const s = t.A.sourcesLecture({ racine: t.copie, dossier: t.dossier, dossierCles: t.dossier, api, drive, git: t.git });
    if (v.referentielFaux) s.referentielArchive = async () => Buffer.from('autre');
    // Appels successifs au référentiel archivé : le 1er sert au contrôle d'empreinte, les suivants au
    // relecteur attribué (même ordre côté diagnostic et côté CLI ; compteur propre à chaque montage).
    if (v.referentielParAppel) { const vrai = s.referentielArchive; let i = 0; s.referentielArchive = async (ver) => v.referentielParAppel(i++, () => vrai(ver)); }
    return s;
  };
  const RAPPROCHE = ['pret_pour_saisie', 'relecteur_non_local'];
  const comparer = async (nom, v, attendu) => {
    const s = monter(v);
    const d = await t.D.diagnostiquer(SET, s);
    const diagnostic = d.applicables.some((x) => RAPPROCHE.includes(x.etat));
    let cli; let sortie = null;
    try { sortie = await t.E.generationRetenue(SET, monter(v)); cli = true; } catch (e) { cli = false; sortie = e.message; }
    assert.equal(cli, diagnostic, `${nom} : CLI ${cli} ≠ diagnostic ${diagnostic} (${d.applicables.map((x) => x.etat).join(',')})`);
    assert.equal(cli, attendu, `${nom} : attendu ${attendu}`);
    assert.deepEqual(fuite(JSON.stringify(sortie)), [], `${nom} : confinement`);
    return sortie;
  };
  test('nominal : « généré » des deux côtés ; corps = sortie de la génération (journal_commit, referentiel_version, moteur)', async () => {
    const sortie = await comparer('nominal', {}, true);
    assert.deepEqual(Object.keys(sortie).sort(), ['journal_commit', 'moteur', 'referentiel_version']);
    assert.equal(sortie.journal_commit, t.commit);
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
const api = { listerExecutions: async ({ workflowId, status }) => { const wf = Object.keys(WF).find((k) => WF[k] === workflowId); return lireE().execs[wf].filter((e) => (status ? e.status === status : !['running','waiting'].includes(e.status))).map((e) => ({ id: e.id, workflowId, status: e.status, startedAt: '2026-11-16T10:00:00.000Z', stoppedAt: e.status === 'running' ? null : '2026-11-16T10:00:01.000Z' })); },
  lireExecution: async (id) => { for (const wf of Object.keys(WF)) { const e = lireE().execs[wf].find((x) => x.id === id); if (e) return { id, workflowId: WF[wf], status: e.status, data: { resultData: { runData: { [E.NOEUDS[wf].webhook]: [{ data: { main: [[{ json: { body: e.corps } }]] } }], ...(e.sortie ? { [E.NOEUDS[wf].sortie]: [{ data: { main: [[{ json: e.sortie }]] } }] } : {}) } } } }; } return null; } };
const poster = (wf) => async (corps) => { fs.appendFileSync(c.posts, JSON.stringify({ wf, corps }) + '\\n'); fs.writeFileSync(c.pret, String(process.pid)); attendre(c.go); return { http: 200 }; };
const fabrique = () => ({ api, candidats: { lire: async () => lireE().candidat }, poster: { emettre: poster('emettre'), cloturer: poster('cloturer') }, deriverGeneration: async () => (${JSON.stringify(GEN)}), generation: {}, attenteMaxMs: 0 });
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
  test('E1 : réémission A partie (200) puis CLI tué ; une seconde réémission est refusée (tentative ouverte) ; seule une conclusion la débloque', async () => {
    const c = base(CAND);
    const premier = lancer({ ...c, argv: ['reemettre', A] }, { detache: true });
    await attendreFichier(c.pret);
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
