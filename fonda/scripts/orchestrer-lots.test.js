// Tests de fonda/scripts/orchestrer-lots.js — orchestrateur de validation multi-lots.
// Monde SIMULÉ (exécuteur injectable) : aucune vraie commande, aucune vraie signature, aucun
// réseau. Vérifie : séquence, gardes franchies seulement au diagnostic vert, fail-closed (STOP
// du lot, lot suivant), actes humains lancés avec stdin HÉRITÉ et jamais fournis, aucun
// --liberer/--reparer automatique, un commit de 3 fichiers par lot, plafond = branche poussée
// + URL compare (jamais de PR ni de fusion), relance sans dommage.
// Usage : node --test fonda/scripts/orchestrer-lots.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const O = require('./orchestrer-lots.js');

const A = 'set_fonda_comprendre-consigne_nI_92';
const B = 'set_fonda_grandeurs-mesures_nI_93';

// Monde simulé : un état de diagnostic par lot, qui avance UNIQUEMENT par les commandes.
function monde({ etats = {}, verrou = {}, n8n = { generation: true, portier: true }, sur = {}, design = [], terminal = { stdin: true, stdout: true } } = {}) {
  const w = { horloge: 0, appels: [], affiche: [], journal: [], publies: new Set(), sale: false, modifies: [], nouveau: null, etats: { ...etats }, verrou: { ...verrou }, distante: false, pousses: 0 };
  const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
  const js = (o) => ok(JSON.stringify(o));
  w.lancer = (exe, args, opts) => {
    w.appels.push({ exe, args: [...args], humain: opts.humain, opts });
    if (sur.lancer) { const r = sur.lancer(exe, args, opts, w); if (r) return r; }
    if (exe === 'git') {
      const [c] = args;
      if (c === 'status') return ok(args.includes('--untracked-files=no') ? (w.sale ? ' M AVANCEMENT.md\n' : w.modifies.map((f) => ` M ${f}\n`).join('')) : '');
      if (c === 'rev-parse') return args.includes('--verify') ? { code: 1, stdout: '', stderr: '' } : ok(`${w.distante ? 'abc' : 'zzz'}\n`);
      if (c === 'ls-remote') return ok(w.distante ? 'abc\trefs/heads/publie/test-batch\n' : '');
      if (c === 'merge-base' || c === 'rev-list' || c === 'diff-tree') return ok('');
      if (c === 'push') { w.pousses += 1; if (w.pushKo) return { code: 1, stdout: '', stderr: 'réseau' }; w.distante = true; return ok(); }
      if (c === 'show') return ok(JSON.stringify({ lots: (args[1].startsWith('refs/remotes/origin/design') ? design : [...w.publies]).map((set_id) => ({ set_id })) }));
      if (c === 'ls-files') return ok(w.nouveau ? `${w.nouveau}\n` : '');
      if (c === 'add') return ok();
      if (c === 'diff') return ok(w.modifies.concat(w.nouveau ? [w.nouveau] : []).join('\n'));
      if (c === 'commit') { w.dernierCommit = args; w.modifies = []; w.publies.add(w.enCours); w.nouveau = null; return ok(); }
      return ok();
    }
    const [script, ...r] = args;
    const id = r.find((x) => /^set_fonda_/.test(x));
    w.enCours = id;
    if (script === O.SIGNATAIRE && r[0] === '--diagnostic') return js({ set_id: id, etat: w.etats[id], detail: 'simulé', applicables: [{ etat: w.etats[id] }] });
    if (script === O.DECLENCHEUR && r[0] === '--etat') return js({ etat: w.verrou[id] ?? null, observe: { executions: 0, candidats: 0 } });
    if (script === O.DECLENCHEUR) { w.etats[id] = 'pret_pour_saisie'; return js({ issue: 'accepte', statut: 202, consigne: null }); }
    if (script === O.SIGNATAIRE && r[0] === '--saisir') { w.etats[id] = 'pret_pour_cloture'; return { code: 0, stdout: '', stderr: '' }; }
    if (script === O.SIGNATAIRE && r[0] === '--extraire-publication') return js({ ecrit: true, chemin: `/clotures/${id}-0123456789abcdef/lot-relu.json` });
    if (script === O.SIGNATAIRE && r.length === 1) { w.etats[id] = 'signe'; return { code: 0, stdout: '', stderr: '' }; }
    if (script === O.PUBLICATION && r.includes('--dry-run')) return ok(`(dry-run) ${w.enCours = path.basename(path.dirname(r[0])).replace(/-[0-9a-f]{16}$/, '')} publiable — rien écrit.\n`);
    if (script === O.PUBLICATION) {
      const s = path.basename(path.dirname(r[0])).replace(/-[0-9a-f]{16}$/, '');
      w.enCours = s; w.modifies = ['fonda/data/catalogue-fonda.json', 'fonda/data/set_ids-journal.json']; w.nouveau = `fonda/data/lots/${s}.json`;
      return ok(`✓ ${s} publié (lot, catalogue, journal) — relire le diff, puis commit + PR.\n`);
    }
    return { code: 99, stdout: '', stderr: `commande inconnue ${script}` };
  };
  w.deps = {
    lancer: w.lancer, n8nActifs: async () => (n8n instanceof Error ? Promise.reject(n8n) : n8n), afficher: (t) => w.affiche.push(t), consigner: (e) => w.journal.push(e),
    // Horloge simulée : seule l'attente (ou un diagnostic lent simulé) la fait avancer.
    dormir: async (ms) => { w.horloge += ms; }, maintenant: () => w.horloge, attenteGenerationMs: 60000, pasAttenteMs: 15000, delaiDiagnosticMs: 120000, terminal: () => terminal,
  };
  return w;
}
const lancer = (w, lots = [{ setId: A, ref: 'ref-a' }]) => O.orchestrer({ lots, branche: 'publie/test-batch' }, w.deps);
const cmds = (w) => w.appels.filter((a) => a.exe !== 'git').map((a) => [path.basename(a.args[0]), ...a.args.slice(1)].join(' '));
const humains = (w) => w.appels.filter((a) => a.humain);

describe('séquence nominale (monde simulé, aucune vraie signature)', () => {
  test('2 lots de zéro : génération, saisie, signature, extraction, dry-run puis réel, UN commit de 3 fichiers par lot, branche poussée, URL compare', async () => {
    const w = monde({ etats: { [A]: 'aucune_generation', [B]: 'aucune_generation' } });
    const r = await lancer(w, [{ setId: A, ref: 'ref-a' }, { setId: B, ref: 'ref-b' }]);
    assert.deepEqual(r.resultats.map((x) => [x.setId, x.issue]), [[A, 'publie'], [B, 'publie']]);
    const dl = `/clotures/${A}-0123456789abcdef`;
    assert.deepEqual(cmds(w).slice(0, 15), [
      `signer-cloture.js --diagnostic ${A}`, `declencher-generation.js --etat ${A}`, `declencher-generation.js ${A} ref-a`, `signer-cloture.js --diagnostic ${A}`,
      `signer-cloture.js --saisir ${A}`, `signer-cloture.js --diagnostic ${A}`, `signer-cloture.js ${A}`, `signer-cloture.js --diagnostic ${A}`,
      `signer-cloture.js --diagnostic ${A}`, `signer-cloture.js --extraire-publication ${A}`, `publier-lot.js ${dl}/lot-relu.json ${dl}/attestation.json --dry-run`,
      `signer-cloture.js --diagnostic ${A}`, `publier-lot.js ${dl}/lot-relu.json ${dl}/attestation.json`, `signer-cloture.js --diagnostic ${A}`,
      `signer-cloture.js --diagnostic ${B}`,
    ], 'diagnostic avant extraction, avant publication réelle, avant commit');
    const commits = w.appels.filter((a) => a.exe === 'git' && a.args[0] === 'commit');
    assert.equal(commits.length, 2);
    const adds = w.appels.filter((a) => a.exe === 'git' && a.args[0] === 'add').map((a) => a.args.slice(2));
    assert.deepEqual(adds, [O.FICHIERS_PUBLICATION(A), O.FICHIERS_PUBLICATION(B)]);
    assert.ok(w.appels.some((a) => a.exe === 'git' && a.args[0] === 'push' && a.args.includes('refs/heads/publie/test-batch:refs/heads/publie/test-batch')));
    assert.equal(r.url, 'https://github.com/ericduchateau/box/compare/design...publie/test-batch');
    assert.match(w.affiche.join('\n'), /PR à OUVRIR À LA MAIN \(jamais fusionnée ici\)[\s\S]*Titre : FONDA : publication de 2 lot\(s\)/);
    assert.match(w.affiche.join('\n'), /n8n toujours ACTIFS .* pense à les désactiver/);
  });
});

describe('actes humains : jamais automatisés ni fournis', () => {
  test('SEULES --saisir et la signature sont lancées en mode humain ; toutes les autres en mode mécanique', async () => {
    const w = monde({ etats: { [A]: 'aucune_generation' } });
    await lancer(w);
    assert.deepEqual(humains(w).map((a) => a.args.slice(1).join(' ')), [`--saisir ${A}`, A]);
    assert.ok(w.appels.filter((a) => !a.humain).every((a) => !(a.args.slice(1).join(' ') === A) && !a.args.includes('--saisir')));
  });
  test('production : humain -> stdio HÉRITÉ (chaîne « inherit », aucun pipe, aucune entrée) ; mécanique -> stdin FERMÉ (« ignore »)', () => {
    const vus = [];
    const spawn = (exe, args, opts) => { vus.push({ exe, args, opts }); return { status: 0, stdout: '', stderr: '' }; };
    O.lancerProduction(process.execPath, [O.SIGNATAIRE, '--saisir', A], { humain: true }, spawn);
    O.lancerProduction(process.execPath, [O.SIGNATAIRE, A], { humain: true }, spawn);
    O.lancerProduction(process.execPath, [O.SIGNATAIRE, '--diagnostic', A], { humain: false }, spawn);
    for (const v of vus.slice(0, 2)) {
      assert.equal(v.opts.stdio, 'inherit', 'stdin hérité du VRAI terminal');
      assert.ok(!('input' in v.opts), 'aucune entrée fournie');
    }
    assert.equal(vus[2].opts.stdio[0], 'ignore', 'commande mécanique : stdin fermé');
    assert.ok(!('input' in vus[2].opts));
    assert.ok(Object.isFrozen(O.OPTIONS_HUMAIN) && Object.isFrozen(O.OPTIONS_MECANIQUE));
  });
  test('le code source ne fournit JAMAIS d\'entrée à un processus enfant ni ne lit/stocke de passphrase', () => {
    const code = fs.readFileSync(path.join(__dirname, 'orchestrer-lots.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.doesNotMatch(code, /\binput\s*:/, 'aucune option input');
    assert.doesNotMatch(code, /stdin\.(write|pipe|end)|stdin\s*:\s*['"]pipe/, 'aucune écriture sur stdin (seul isTTY est LU)');
    // (Les bandeaux affichés peuvent NOMMER la passphrase ; le code ne la manipule jamais.)
    assert.doesNotMatch(code, /\bpassphrase\s*[:=(]|\.priv\.pem|readline|lirePhrase|preparerSignataire|createPrivateKey/i);
    assert.doesNotMatch(code, /require\(['"]\.\/(signer-cloture|attestation-signee|publier-lot|interim|referentiel-archive)\.js['"]\)/, 'aucun chargement du cœur probant : commandes seulement');
  });
});

describe('fail-closed : STOP du lot (consigné), lot suivant', () => {
  const unLotStoppe = async (opts, motif, interdit = []) => {
    const w = monde(opts);
    const r = await lancer(w, [{ setId: A, ref: 'ref-a' }, { setId: B, ref: 'ref-b' }]);
    assert.equal(r.resultats[0].issue, 'stoppe');
    assert.match(r.resultats[0].raison, motif);
    for (const x of interdit) assert.ok(!cmds(w).some((c) => c.includes(x)), `jamais : ${x}`);
    assert.equal(r.resultats[1].issue, 'publie', 'le lot suivant est traité');
    assert.ok(w.journal.some((e) => e.evt === 'stop' && e.set_id === A));
    return w;
  };
  test('anomalie au diagnostic initial (relecteur_non_local) -> STOP, rien d\'autre', () => unLotStoppe({ etats: { [A]: 'relecteur_non_local', [B]: 'pret_pour_saisie' } }, /relecteur_non_local/, [`--saisir ${A}`, `declencher-generation.js ${A}`]));
  test('état inconnu -> STOP', () => unLotStoppe({ etats: { [A]: 'etat_jamais_vu', [B]: 'pret_pour_saisie' } }, /etat_jamais_vu/, [`--saisir ${A}`]));
  for (const v of ['envoi', 'inconnu']) {
    test(`verrou de génération « ${v} » (lot en vol) -> STOP, JAMAIS de déclenchement ni --liberer/--reparer`, async () => {
      const w = await unLotStoppe({ etats: { [A]: 'aucune_generation', [B]: 'pret_pour_saisie' }, verrou: { [A]: v } }, /EN VOL ou indéterminé/, [`declencher-generation.js ${A} ref-a`]);
      assert.ok(!cmds(w).some((c) => /--liberer|--reparer/.test(c)));
    });
  }
  test('workflows n8n inactifs -> STOP avant tout envoi (jamais d\'activation)', () => unLotStoppe({ etats: { [A]: 'aucune_generation', [B]: 'pret_pour_saisie' }, n8n: { generation: true, portier: false } }, /INACTIFS/, [`declencher-generation.js ${A} ref-a`]));
  test('activité n8n non vérifiable -> STOP', () => unLotStoppe({ etats: { [A]: 'aucune_generation', [B]: 'pret_pour_saisie' }, n8n: new Error('HTTP 403') }, /non vérifiable/, [`declencher-generation.js ${A} ref-a`]));
  test('déclenchement « inconnu » (504) -> STOP, jamais de renvoi', async () => {
    const w = await unLotStoppe({ etats: { [A]: 'aucune_generation', [B]: 'pret_pour_saisie' }, sur: { lancer: (exe, args) => (args[0] === O.DECLENCHEUR && args.length === 3 && args[1] === A ? { code: 0, stdout: JSON.stringify({ issue: 'inconnu', statut: 504, consigne: 'NE PAS renvoyer' }), stderr: '' } : null) } }, /issue « inconnu »/);
    assert.equal(cmds(w).filter((c) => c === `declencher-generation.js ${A} ref-a`).length, 1);
  });
  test('génération jamais prête (délai) -> STOP après un nombre BORNÉ de relevés', async () => {
    const w = await unLotStoppe({ etats: { [A]: 'aucune_generation', [B]: 'pret_pour_saisie' }, sur: { lancer: (exe, args, o, m) => { if (args[0] === O.DECLENCHEUR && args.length === 3 && args[1] === A) { m.etats[A] = 'generation_en_cours'; return { code: 0, stdout: JSON.stringify({ issue: 'accepte', statut: 202 }), stderr: '' }; } return null; } } }, /délai d'attente écoulé/);
    assert.equal(cmds(w).filter((c) => c === `signer-cloture.js --diagnostic ${A}`).length, 1 + 4, '1 initial + 60 s / 15 s relevés');
  });
  test('après saisie, décision figée mais pas prête -> STOP, signature JAMAIS lancée', () => unLotStoppe({ etats: { [A]: 'pret_pour_saisie', [B]: 'pret_pour_saisie' }, sur: { lancer: (exe, args, o, m) => { if (args[1] === '--saisir' && args[2] === A) { m.etats[A] = 'decision_figee'; return { code: 0, stdout: '', stderr: '' }; } return null; } } }, /decision_figee/, [`signer-cloture.js ${A}`]));
  test('après signature (code 0) : signature_interrompue -> STOP, extraction JAMAIS lancée', () => unLotStoppe({ etats: { [A]: 'pret_pour_cloture', [B]: 'pret_pour_saisie' }, sur: { lancer: (exe, args, o, m) => { if (args.length === 2 && args[0] === O.SIGNATAIRE && args[1] === A) { m.etats[A] = 'signature_interrompue'; return { code: 0, stdout: '', stderr: '' }; } return null; } } }, /signature_interrompue/, [`--extraire-publication ${A}`]));
  test('dry-run refusé -> STOP, publication réelle JAMAIS lancée', async () => {
    const w = await unLotStoppe({ etats: { [A]: 'signe', [B]: 'pret_pour_saisie' }, sur: { lancer: (exe, args) => (args[0] === O.PUBLICATION && args.includes('--dry-run') && args[1].includes(A) ? { code: 1, stdout: '', stderr: 'publication refusée : attestation non vérifiée' } : null) } }, /dry-run.*attestation non vérifiée/);
    assert.ok(!w.appels.some((a) => a.args[0] === O.PUBLICATION && a.args[1].includes(A) && !a.args.includes('--dry-run')));
  });
  test('diagnostic illisible ou code ≠ 0 -> STOP', async () => {
    await unLotStoppe({ etats: { [A]: 'pret_pour_saisie', [B]: 'pret_pour_saisie' }, sur: { lancer: (exe, args) => (args[1] === '--diagnostic' && args[2] === A ? { code: 0, stdout: 'pas du json', stderr: '' } : null) } }, /sortie illisible/, [`--saisir ${A}`]);
    await unLotStoppe({ etats: { [A]: 'pret_pour_saisie', [B]: 'pret_pour_saisie' }, sur: { lancer: (exe, args) => (args[1] === '--diagnostic' && args[2] === A ? { code: 1, stdout: '', stderr: '✗ accès' } : null) } }, /code de sortie 1/, [`--saisir ${A}`]);
  });
  test('commit : un fichier suivi inattendu modifié -> STOP du BATCH (arbre incertain), consignes B, rien commité, lot suivant NON traité', async () => {
    const w = monde({ etats: { [A]: 'signe', [B]: 'pret_pour_saisie' }, sur: { lancer: (exe, args, o, m) => { if (exe === 'git' && args[0] === 'status' && m.enCours === A && m.modifies.length) return { code: 0, stdout: ' M fonda/data/catalogue-fonda.json\n M fonda/data/set_ids-journal.json\n M fonda/scripts/signer-cloture.js\n', stderr: '' }; return null; } } });
    const r = await lancer(w, [{ setId: A, ref: 'ref-a' }, { setId: B, ref: 'ref-b' }]);
    assert.deepEqual(r.resultats.map((x) => x.issue), ['stoppe_batch', 'non_traite']);
    assert.match(r.resultats[0].raison, /fichiers suivis modifiés ≠ catalogue \+ journal[\s\S]*git add -- fonda\/data\/lots\/set_fonda_comprendre-consigne_nI_92\.json[\s\S]*git restore --/);
    assert.ok(!w.appels.some((a) => a.exe === 'git' && a.args[0] === 'commit'));
    assert.equal(r.ok, false);
  });
});

describe('relance et branche', () => {
  test('relance : lot déjà publié sur la branche -> sauté ; lot signé -> extraction directe ; lot prêt pour clôture -> signature seule', async () => {
    const w = monde({ etats: { [A]: 'pret_pour_cloture', [B]: 'signe' } });
    w.publies.add('set_fonda_lexique_nI_94');
    const r = await lancer(w, [{ setId: 'set_fonda_lexique_nI_94', ref: 'x' }, { setId: A, ref: 'ref-a' }, { setId: B, ref: 'ref-b' }]);
    assert.deepEqual(r.resultats.map((x) => x.issue), ['deja_publie', 'publie', 'publie']);
    assert.ok(!cmds(w).some((c) => c.includes('set_fonda_lexique_nI_94')), 'lot déjà publié : aucune commande');
    assert.deepEqual(humains(w).map((a) => a.args.slice(1).join(' ')), [A], 'seule la signature de A ; B déjà signé');
    assert.ok(!cmds(w).some((c) => /declencher-generation/.test(c)), 'jamais de génération pour un lot déjà avancé');
  });
  test('branche : jamais main/design ; arbre suivi modifié -> arrêt AVANT toute commande', async () => {
    assert.throws(() => O.analyserArguments(['--lots', 'x', '--branche', 'main']), /publie\/<nom>/);
    assert.throws(() => O.analyserArguments(['--lots', 'x', '--branche', 'design']), /publie\/<nom>/);
    await assert.rejects(O.orchestrer({ lots: [{ setId: A, ref: 'r' }], branche: 'main' }, monde().deps), /branche refusée/);
    const w = monde({ etats: { [A]: 'pret_pour_saisie' } });
    w.sale = true;
    const r = await lancer(w);
    assert.equal(r.ok, false);
    assert.match(w.affiche.join('\n'), /BATCH ARRÊTÉ AVANT TOUT LOT — démarrage : modifications suivies non commitées/);
    assert.deepEqual(cmds(w), []);
  });
  test('liste des lots : format strict, doublons refusés', () => {
    assert.deepEqual(O.lireListe(`# batch\n${A} ref-a\n\n${B} ref-b\n`), [{ setId: A, ref: 'ref-a' }, { setId: B, ref: 'ref-b' }]);
    assert.throws(() => O.lireListe(`${A}\n`), /<set_id> <ref>/);
    assert.throws(() => O.lireListe(`${A} r\n${A} r\n`), /en double/);
    assert.throws(() => O.lireListe('\n# rien\n'), /vide/);
  });
  test('plafond : aucune commande gh, aucune fusion, aucun push vers main ou design', async () => {
    const w = monde({ etats: { [A]: 'aucune_generation' } });
    await lancer(w);
    assert.ok(!w.appels.some((a) => a.exe === 'gh'));
    assert.ok(!w.appels.some((a) => a.exe === 'git' && ['merge', 'rebase', 'reset'].includes(a.args[0])));
    for (const p of w.appels.filter((a) => a.exe === 'git' && a.args[0] === 'push')) assert.ok(!p.args.some((x) => /:refs\/heads\/(main|design)$/.test(x)));
    for (const p of w.appels.filter((a) => a.exe === 'git' && a.args[0] === 'push')) assert.ok(!p.args.some((x) => /^--force|^\+/.test(x)), 'push SIMPLE, jamais forcé');
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'orchestrer-lots.js'), 'utf8'), /--force|force-with-lease/, 'aucun push forcé dans le code');
    const code = fs.readFileSync(path.join(__dirname, 'orchestrer-lots.js'), 'utf8');
    assert.doesNotMatch(code, /['"]gh['"]|pulls|['"](merge|rebase|reset)['"]/i, 'jamais git merge/rebase/reset ni gh');
  });
});

// TRIPWIRE « cœur probant intouché » : empreintes SHA-256 des fichiers probants à l'arrivée de
// l'orchestrateur (= origin/design c23aaaa). L'orchestrateur n'en modifie AUCUN ; toute
// évolution FUTURE de l'un d'eux doit mettre à jour cette liste EXPLICITEMENT (signal de relecture).
describe('cœur probant intouché par l\'orchestrateur (octet pour octet)', () => {
  const EMPREINTES = [
    ['fonda/scripts/signer-cloture.js', '7d12a4d56e4ddb8e8fd21e65b266916cbbff1998d7302975cad9ffedd972956a'],
    ['fonda/scripts/attestation-signee.js', '7a922e12e1171425b78dcde92dd85132e6586e5238b72fb11d7cd0230a0d0e47'],
    ['fonda/engine/canonique.js', 'e0f3a60c808cfe465ac002e071f57ccd7372bc9e27aad04bce4d23f0534f581f'],
    ['fonda/engine/catalogue.js', '6bae6d615c441421954c31db1608ff437fcfe779f98cdcc7c2319342242b7a95'],
    ['fonda/scripts/interim.js', 'bb08e04b84e07b532e5a7c78787e53063f4206fa72701f05327ef9d1897f3bd8'],
    ['fonda/scripts/publier-lot.js', 'a3d2301b41ed1324e233ab03c8eaeb084c8a90fe6ca593fd1b545e813bffb307'],
    ['fonda/scripts/referentiel-archive.js', '5d38f1b09427e7aa85ff30ee542f0d11a6ad9f8f7f59d25612214538a3a960d8'],
  ];
  for (const [fichier, sha] of EMPREINTES) {
    test(`${fichier} : empreinte inchangée`, () => {
      assert.equal(require('crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', '..', fichier))).digest('hex'), sha);
    });
  }
  test('RATTACHEMENT_SAISIE_LOCALE et la garde maîtresse présents à l\'identique', () => {
    const src = fs.readFileSync(path.join(__dirname, 'signer-cloture.js'), 'utf8');
    assert.ok(src.includes("if (typeof deps.rattachement !== 'function') refuser('contrat de rattachement exécution n8n <-> lot NON DÉFINI (§11 bis) : signature refusée', 'precondition');"));
    assert.ok(src.includes("const RATTACHEMENT_SAISIE_LOCALE = () => refuser('parcours page_relecture non défini : rattachement exécution n8n <-> lot absent (seule la saisie_locale est levée, lot 7)', 'precondition');"));
  });
});

describe('corrections après relecture Codex (9 points)', () => {
  test('1. échec de --saisir (code ≠ 0) -> STOP du lot même si le diagnostic suivant serait vert ; signature jamais lancée', async () => {
    const w = monde({ etats: { [A]: 'pret_pour_saisie' }, sur: { lancer: (exe, args, o, m) => (args[1] === '--saisir' ? (m.etats[A] = 'pret_pour_cloture', { code: 1, stdout: '', stderr: '' }) : null) } });
    const r = await lancer(w);
    assert.match(r.resultats[0].raison, /--saisir a échoué \(code 1\)/);
    assert.ok(!humains(w).some((a) => a.args.length === 2));
    assert.equal(r.ok, false);
  });
  test('1. échec de la signature (code ≠ 0) -> STOP du lot même si « signe » ; extraction jamais lancée', async () => {
    const w = monde({ etats: { [A]: 'pret_pour_cloture' }, sur: { lancer: (exe, args, o, m) => (args.length === 2 && args[0] === O.SIGNATAIRE && args[1] === A ? (m.etats[A] = 'signe', { code: 1, stdout: '', stderr: '' }) : null) } });
    const r = await lancer(w);
    assert.match(r.resultats[0].raison, /signer-cloture\.js a échoué \(code 1\)/);
    assert.ok(!cmds(w).some((c) => c.includes('--extraire-publication')));
  });
  test('2/A. generation_incoherente pendant l\'attente -> STOP (jamais tolérée), même si prête ensuite', async () => {
    let n = 0;
    const w = monde({ etats: { [A]: 'aucune_generation' }, sur: { lancer: (exe, args, o, m) => { if (args[0] === O.DECLENCHEUR && args[1] !== '--etat') { m.etats[A] = 'generation_incoherente'; return { code: 0, stdout: JSON.stringify({ issue: 'accepte', statut: 202 }), stderr: '' }; } if (args[1] === '--diagnostic' && m.etats[A] === 'generation_incoherente') { n += 1; if (n > 1) m.etats[A] = 'pret_pour_saisie'; } return null; } } });
    const r = await lancer(w);
    assert.match(r.resultats[0].raison, /generation_incoherente/);
    assert.ok(!cmds(w).some((c) => c.includes('--saisir')));
  });
  test('2/A. attente tolérée SEULEMENT après acceptation : verrou « refuse » -> nouvel envoi, mais issue ≠ 202 -> STOP sans attente', async () => {
    const w = monde({ etats: { [A]: 'aucune_generation' }, sur: { lancer: (exe, args) => (args[0] === O.DECLENCHEUR && args[1] !== '--etat' ? { code: 0, stdout: JSON.stringify({ issue: 'refuse', statut: 400 }), stderr: '' } : null) } });
    const r = await lancer(w);
    assert.match(r.resultats[0].raison, /issue « refuse » \(HTTP 400\)/);
    assert.equal(cmds(w).filter((c) => c.includes('--diagnostic')).length, 1, 'aucun relevé d\'attente');
  });
  test('3. stdin OU stdout non relié à un terminal -> refus de démarrer, AUCUNE commande', async () => {
    for (const terminal of [{ stdin: false, stdout: true }, { stdin: true, stdout: false }, null]) {
      const w = monde({ etats: { [A]: 'pret_pour_saisie' }, terminal });
      await assert.rejects(lancer(w), /non reliée à un terminal/);
      assert.deepEqual(w.appels, []);
    }
  });
  test('4. diagnostic REFAIT avant extraction, avant publication réelle et avant commit ; anomalie apparue -> STOP', async () => {
    const w1 = monde({ etats: { [A]: 'signe' }, sur: { lancer: (exe, args, o, m) => { if (args[1] === '--extraire-publication') m.etats[A] = 'incident_ouvert'; return null; } } });
    const r1 = await lancer(w1);
    assert.match(r1.resultats[0].raison, /avant publication : état « incident_ouvert »/);
    assert.ok(!w1.appels.some((a) => a.args[0] === O.PUBLICATION && !a.args.includes('--dry-run')), 'publication réelle jamais lancée');
    const w2 = monde({ etats: { [A]: 'signe' }, sur: { lancer: (exe, args, o, m) => { if (args[0] === O.PUBLICATION && !args.includes('--dry-run')) m.etats[A] = 'incident_ouvert'; return null; } } });
    const r2 = await lancer(w2);
    assert.equal(r2.resultats[0].issue, 'stoppe_batch', 'après publication : arbre modifié -> STOP du batch');
    assert.match(r2.resultats[0].raison, /avant commit : état « incident_ouvert »[\s\S]*git restore --/);
    assert.ok(!w2.appels.some((a) => a.exe === 'git' && a.args[0] === 'commit'));
  });
  test('5. lot déjà au catalogue d\'origin/design -> STOP du lot, aucune commande pour lui ; lot suivant traité', async () => {
    const w = monde({ etats: { [A]: 'signe', [B]: 'signe' }, design: [A] });
    const r = await lancer(w, [{ setId: A, ref: 'a' }, { setId: B, ref: 'b' }]);
    assert.equal(r.resultats[0].issue, 'stoppe');
    assert.match(r.resultats[0].raison, /déjà au catalogue d'origin\/design/);
    assert.ok(!cmds(w).some((c) => c.includes(A)));
    assert.equal(r.resultats[1].issue, 'publie');
  });
  test('6. push en échec -> STOP du batch (commit local conservé) ; résumé SANS « poussée » ni URL', async () => {
    const w = monde({ etats: { [A]: 'signe' } });
    w.pushKo = true;
    const r = await lancer(w);
    assert.equal(r.resultats[0].issue, 'stoppe_batch');
    assert.equal(r.url, null);
    assert.equal(r.pousse, false);
    assert.doesNotMatch(w.affiche.join('\n'), /Branche poussée/);
    assert.match(w.affiche.join('\n'), /commit LOCAL conservé ; relancer l'orchestrateur : le push sera retenté et vérifié/);
  });
  test('9. code de sortie : ok=false dès qu\'un lot est stoppé ; ok=true seulement si tout est publié ET poussé', async () => {
    assert.equal((await lancer(monde({ etats: { [A]: 'signe' } }))).ok, true);
    assert.equal((await lancer(monde({ etats: { [A]: 'relecteur_non_local' } }))).ok, false);
  });
});

describe('A strict : attente tolérée SEULEMENT après un 202 reçu par CE run', () => {
  test('verrou déjà « accepte » au départ (provenance non prouvée) + generation_en_cours -> STOP, aucune attente', async () => {
    const w = monde({ etats: { [A]: 'aucune_generation' }, verrou: { [A]: 'accepte' }, sur: { lancer: (exe, args, o, m) => { if (args[1] === '--diagnostic' && m.vu) m.etats[A] = 'generation_en_cours'; if (args[1] === '--diagnostic') m.vu = true; return null; } } });
    const r = await lancer(w);
    assert.match(r.resultats[0].raison, /état « generation_en_cours » après génération acceptée — /);
    assert.equal(cmds(w).filter((c) => c.includes('--diagnostic')).length, 2, 'aucun relevé supplémentaire');
    assert.ok(!cmds(w).some((c) => c === `declencher-generation.js ${A} ref-a`), 'jamais de nouvel envoi');
  });
  test('verrou déjà « accepte » + génération prête -> poursuite normale (pret_pour_saisie exigé tout de suite)', async () => {
    const w = monde({ etats: { [A]: 'aucune_generation' }, verrou: { [A]: 'accepte' }, sur: { lancer: (exe, args, o, m) => { if (args[1] === '--diagnostic' && m.vu && m.etats[A] === 'aucune_generation') m.etats[A] = 'pret_pour_saisie'; if (args[1] === '--diagnostic') m.vu = true; return null; } } });
    const r = await lancer(w);
    assert.equal(r.resultats[0].issue, 'publie');
  });
});

describe('A en temps réel : échéance et délai de processus des diagnostics', () => {
  test('A. diagnostic LENT (horloge) : échéance dépassée -> STOP « délai d\'attente écoulé », même si le lot devient prêt ensuite ; saisie jamais lancée', async () => {
    // Budget 60 s ; chaque diagnostic d'attente dure 50 s : le 2e se termine à 115 s, « prêt », mais trop tard.
    let attente = 0;
    const w = monde({ etats: { [A]: 'aucune_generation' }, sur: { lancer: (exe, args, o, m) => {
      if (args[0] === O.DECLENCHEUR && args.length === 3 && args[1] === A) { m.etats[A] = 'generation_en_cours'; return { code: 0, stdout: JSON.stringify({ issue: 'accepte', statut: 202 }), stderr: '' }; }
      if (args[1] === '--diagnostic' && m.etats[A] !== 'aucune_generation') { m.horloge += 50000; if ((attente += 1) === 2) m.etats[A] = 'pret_pour_saisie'; }
      return null;
    } } });
    const r = await lancer(w);
    assert.equal(r.resultats[0].issue, 'stoppe');
    assert.match(r.resultats[0].raison, /délai d'attente écoulé \(60000 ms, état « pret_pour_saisie »\)/);
    assert.equal(attente, 2, 'aucun relevé après l\'échéance');
    assert.ok(!cmds(w).some((c) => c.includes('--saisir')));
    assert.equal(cmds(w).filter((c) => c === `declencher-generation.js ${A} ref-a`).length, 1, 'jamais de renvoi');
    assert.equal(r.ok, false);
  });
  test('A. délai de processus : TOUS les diagnostics en ont un ; publier-lot, extraction, génération et actes humains JAMAIS', async () => {
    const w = monde({ etats: { [A]: 'aucune_generation' } });
    await lancer(w);
    const fonda = w.appels.filter((a) => a.exe !== 'git');
    for (const a of fonda) {
      if (a.args[1] === '--diagnostic') assert.equal(a.opts.delaiMs, 120000, 'diagnostic borné');
      else assert.equal(a.opts.delaiMs, undefined, `jamais de délai : ${path.basename(a.args[0])} ${a.args.slice(1).join(' ')}`);
    }
    assert.ok(fonda.some((a) => a.args[0] === O.PUBLICATION && !a.args.includes('--dry-run')), 'publication réelle vue');
    const vus = [];
    const spawn = (exe, args, opts) => { vus.push(opts); return { status: null, error: Object.assign(new Error('t'), { code: 'ETIMEDOUT' }), stdout: '', stderr: '' }; };
    const r = O.lancerProduction(process.execPath, [O.SIGNATAIRE, '--diagnostic', A], { humain: false, delaiMs: 120000 }, spawn);
    assert.equal(vus[0].timeout, 120000);
    assert.equal(vus[0].stdio[0], 'ignore', 'stdin toujours fermé');
    assert.deepEqual([r.code, /délai de 120000 ms dépassé/.test(r.stderr)], [1, true]);
    O.lancerProduction(process.execPath, [O.PUBLICATION, 'x', 'y'], { humain: false }, spawn);
    O.lancerProduction(process.execPath, [O.SIGNATAIRE, A], { humain: true }, spawn);
    assert.ok(!('timeout' in vus[1]) && !('timeout' in vus[2]), 'publication et actes humains : aucun délai');
  });
});
