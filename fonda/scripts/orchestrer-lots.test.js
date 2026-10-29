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
function monde({ etats = {}, verrou = {}, n8n = { generation: true, portier: true }, sur = {} } = {}) {
  const w = { appels: [], affiche: [], journal: [], publies: new Set(), sale: false, modifies: [], nouveau: null, etats: { ...etats }, verrou: { ...verrou } };
  const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
  const js = (o) => ok(JSON.stringify(o));
  w.lancer = (exe, args, opts) => {
    w.appels.push({ exe, args: [...args], humain: opts.humain, opts });
    if (sur.lancer) { const r = sur.lancer(exe, args, opts, w); if (r) return r; }
    if (exe === 'git') {
      const [c] = args;
      if (c === 'status') return ok(args.includes('--untracked-files=no') ? (w.sale ? ' M AVANCEMENT.md\n' : w.modifies.map((f) => ` M ${f}\n`).join('')) : '');
      if (c === 'rev-parse') return { code: 1, stdout: '', stderr: '' };
      if (c === 'show') return ok(JSON.stringify({ lots: [...w.publies].map((set_id) => ({ set_id })) }));
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
    dormir: async () => {}, attenteGenerationMs: 60000, pasAttenteMs: 15000,
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
    assert.deepEqual(cmds(w).slice(0, 10), [
      `signer-cloture.js --diagnostic ${A}`, `declencher-generation.js --etat ${A}`, `declencher-generation.js ${A} ref-a`, `signer-cloture.js --diagnostic ${A}`,
      `signer-cloture.js --saisir ${A}`, `signer-cloture.js --diagnostic ${A}`, `signer-cloture.js ${A}`, `signer-cloture.js --diagnostic ${A}`,
      `signer-cloture.js --extraire-publication ${A}`, `publier-lot.js /clotures/${A}-0123456789abcdef/lot-relu.json /clotures/${A}-0123456789abcdef/attestation.json --dry-run`,
    ]);
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
    assert.doesNotMatch(code, /stdin\.write|\.stdin\b/, 'aucune écriture sur stdin');
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
  test('après signature : signature_interrompue -> STOP, extraction JAMAIS lancée', () => unLotStoppe({ etats: { [A]: 'pret_pour_cloture', [B]: 'pret_pour_saisie' }, sur: { lancer: (exe, args, o, m) => { if (args.length === 2 && args[0] === O.SIGNATAIRE && args[1] === A) { m.etats[A] = 'signature_interrompue'; return { code: 1, stdout: '', stderr: '' }; } return null; } } }, /signature_interrompue/, [`--extraire-publication ${A}`]));
  test('dry-run refusé -> STOP, publication réelle JAMAIS lancée', async () => {
    const w = await unLotStoppe({ etats: { [A]: 'signe', [B]: 'pret_pour_saisie' }, sur: { lancer: (exe, args) => (args[0] === O.PUBLICATION && args.includes('--dry-run') && args[1].includes(A) ? { code: 1, stdout: '', stderr: 'publication refusée : attestation non vérifiée' } : null) } }, /dry-run.*attestation non vérifiée/);
    assert.ok(!w.appels.some((a) => a.args[0] === O.PUBLICATION && a.args[1].includes(A) && !a.args.includes('--dry-run')));
  });
  test('diagnostic illisible ou code ≠ 0 -> STOP', async () => {
    await unLotStoppe({ etats: { [A]: 'pret_pour_saisie', [B]: 'pret_pour_saisie' }, sur: { lancer: (exe, args) => (args[1] === '--diagnostic' && args[2] === A ? { code: 0, stdout: 'pas du json', stderr: '' } : null) } }, /sortie illisible/, [`--saisir ${A}`]);
    await unLotStoppe({ etats: { [A]: 'pret_pour_saisie', [B]: 'pret_pour_saisie' }, sur: { lancer: (exe, args) => (args[1] === '--diagnostic' && args[2] === A ? { code: 1, stdout: '', stderr: '✗ accès' } : null) } }, /code de sortie 1/, [`--saisir ${A}`]);
  });
  test('commit : un fichier suivi inattendu modifié -> STOP, rien de commité pour ce lot', () => unLotStoppe({ etats: { [A]: 'signe', [B]: 'pret_pour_saisie' }, sur: { lancer: (exe, args, o, m) => { if (exe === 'git' && args[0] === 'status' && m.enCours === A && m.modifies.length) return { code: 0, stdout: ' M fonda/data/catalogue-fonda.json\n M fonda/data/set_ids-journal.json\n M fonda/scripts/signer-cloture.js\n', stderr: '' }; return null; } } }, /fichiers suivis modifiés ≠ catalogue \+ journal/));
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
    await assert.rejects(lancer(w), /modifications suivies non commitées/);
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
    const code = fs.readFileSync(path.join(__dirname, 'orchestrer-lots.js'), 'utf8');
    assert.doesNotMatch(code, /['"]gh['"]|pulls|merge/i);
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
