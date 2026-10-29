// Couche Git de fonda/scripts/orchestrer-lots.js sur un VRAI dépôt temporaire + remote local
// (dépôt nu) : commit de EXACTEMENT 3 fichiers, push vérifié, push refusé puis relancé, branche
// divergente, branche ne descendant pas d'origin/design, commit non conforme, interruption
// publication <-> commit (consignes B, jamais d'auto-commit), lot déjà au catalogue de design.
// Les commandes FONDA (diagnostic, signature, publication) sont SIMULÉES ; git est RÉEL.
// Usage : node --test fonda/scripts/orchestrer-lots-git.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const O = require('./orchestrer-lots.js');

const A = 'set_fonda_comprendre-consigne_nI_92';
const B = 'set_fonda_grandeurs-mesures_nI_93';
const BRANCHE = 'publie/test-git';
const CAT = 'fonda/data/catalogue-fonda.json';
const JOU = 'fonda/data/set_ids-journal.json';

function depot() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fonda-orch-git-'));
  const nu = path.join(tmp, 'origin.git');
  const work = path.join(tmp, 'work');
  const g = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  fs.mkdirSync(nu); g(nu, 'init', '-q', '--bare', '-b', 'design');
  fs.mkdirSync(path.join(work, 'fonda', 'data', 'lots'), { recursive: true });
  g(work, 'init', '-q', '-b', 'design');
  g(work, 'config', 'user.email', 'test@exemple.invalid'); g(work, 'config', 'user.name', 'test');
  fs.writeFileSync(path.join(work, CAT), `${JSON.stringify({ schema: 'catalogue-fonda/v1', lots: [] }, null, 2)}\n`);
  fs.writeFileSync(path.join(work, JOU), '{"lignes":[]}\n');
  fs.writeFileSync(path.join(work, 'fonda/data/lots/.gitkeep'), '');
  g(work, 'add', '-A'); g(work, 'commit', '-qm', 'base');
  g(work, 'remote', 'add', 'origin', nu); g(work, 'push', '-q', 'origin', 'design');
  return { tmp, nu, work, g };
}
// Publication SIMULÉE : écrit réellement les 3 fichiers comme publier-lot.js.
function publier(work, setId) {
  fs.writeFileSync(path.join(work, `fonda/data/lots/${setId}.json`), `${JSON.stringify({ set_id: setId })}\n`);
  const cat = JSON.parse(fs.readFileSync(path.join(work, CAT), 'utf8'));
  cat.lots.push({ set_id: setId });
  fs.writeFileSync(path.join(work, CAT), `${JSON.stringify(cat, null, 2)}\n`);
  fs.appendFileSync(path.join(work, JOU), `{"set_id":"${setId}","transition":"publie"}\n`);
}
function deps(d, { etats = {} } = {}) {
  const w = { etats: { ...etats }, affiche: [], appels: [] };
  w.deps = {
    lancer: (exe, args, opts) => {
      w.appels.push([exe, ...args]);
      if (exe === 'git') { const r = spawnSync('git', args, { cwd: d.work, encoding: 'utf8' }); return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }; }
      const [script, ...r] = args;
      const id = r.find((x) => /^set_fonda_/.test(x)) || path.basename(path.dirname(r[0] || '')).replace(/-[0-9a-f]{16}$/, '');
      const js = (o) => ({ code: 0, stdout: JSON.stringify(o), stderr: '' });
      if (r[0] === '--diagnostic') return js({ etat: w.etats[id], detail: 'simulé', applicables: [{ etat: w.etats[id] }] });
      if (r[0] === '--extraire-publication') return js({ ecrit: true, chemin: `/clotures/${id}-0123456789abcdef/lot-relu.json` });
      if (script === O.PUBLICATION && r.includes('--dry-run')) return { code: 0, stdout: `(dry-run) ${id} publiable — rien écrit.\n`, stderr: '' };
      if (script === O.PUBLICATION) { publier(d.work, id); return { code: 0, stdout: `✓ ${id} publié (lot, catalogue, journal) — relire le diff, puis commit + PR.\n`, stderr: '' }; }
      return { code: 99, stdout: '', stderr: 'inattendu' };
    },
    n8nActifs: async () => ({ generation: false, portier: false }), afficher: (t) => w.affiche.push(t), consigner: () => {},
    dormir: async () => {}, maintenant: () => Date.now(), attenteGenerationMs: 1, pasAttenteMs: 1, delaiDiagnosticMs: 60000, terminal: () => ({ stdin: true, stdout: true }),
  };
  return w;
}
const run = (d, w, lots = [A]) => O.orchestrer({ lots: lots.map((setId) => ({ setId, ref: 'r' })), branche: BRANCHE }, w.deps);
const filesDu = (d, c) => d.g(d.work, 'diff-tree', '--no-commit-id', '--name-only', '-r', c).split('\n').filter(Boolean).sort();
const distante = (d) => { try { return d.g(d.nu, 'rev-parse', `refs/heads/${BRANCHE}`).trim(); } catch { return null; } };

describe('couche Git RÉELLE de l\'orchestrateur', () => {
  test('nominal : 2 lots -> 2 commits de EXACTEMENT 3 fichiers, branche poussée et VÉRIFIÉE (distante = HEAD), ok', async () => {
    const d = depot();
    const w = deps(d, { etats: { [A]: 'signe', [B]: 'signe' } });
    const r = await run(d, w, [A, B]);
    assert.equal(r.ok, true, w.affiche.join('\n'));
    assert.equal(r.pousse, true);
    const commits = d.g(d.work, 'rev-list', `refs/remotes/origin/design..refs/heads/${BRANCHE}`).split('\n').filter(Boolean).reverse();
    assert.equal(commits.length, 2);
    assert.deepEqual(filesDu(d, commits[0]), [CAT, `fonda/data/lots/${A}.json`, JOU].sort());
    assert.deepEqual(filesDu(d, commits[1]), [CAT, `fonda/data/lots/${B}.json`, JOU].sort());
    assert.equal(distante(d), d.g(d.work, 'rev-parse', 'HEAD').trim());
    assert.equal(d.g(d.work, 'status', '--porcelain', '--untracked-files=no').trim(), '');
    assert.equal(d.g(d.nu, 'rev-parse', 'refs/heads/design').trim(), d.g(d.work, 'rev-parse', 'refs/remotes/origin/design').trim(), 'design distant jamais poussé');
  });

  test('push REFUSÉ (hook du remote) -> STOP du batch, commit local conservé ; relance -> lot déjà publié, push RETENTÉ et vérifié, ok', async () => {
    const d = depot();
    const drapeau = path.join(d.tmp, 'refuser');
    fs.writeFileSync(drapeau, '1');
    const hook = path.join(d.nu, 'hooks', 'pre-receive');
    fs.writeFileSync(hook, `#!/bin/sh\nif [ -f "${drapeau}" ]; then echo "refusé par le test" >&2; exit 1; fi\nexit 0\n`, { mode: 0o755 });
    const w1 = deps(d, { etats: { [A]: 'signe' } });
    const r1 = await run(d, w1);
    assert.equal(r1.ok, false);
    assert.equal(r1.resultats[0].issue, 'stoppe_batch');
    assert.equal(r1.pousse, false);
    assert.equal(distante(d), null, 'rien sur le remote');
    assert.deepEqual(filesDu(d, 'HEAD'), [CAT, `fonda/data/lots/${A}.json`, JOU].sort(), 'commit local conservé');
    assert.doesNotMatch(w1.affiche.join('\n'), /Branche poussée/);
    fs.unlinkSync(drapeau);
    const w2 = deps(d, { etats: { [A]: 'signe' } });
    const r2 = await run(d, w2);
    assert.deepEqual(r2.resultats.map((x) => x.issue), ['deja_publie']);
    assert.equal(r2.pousse, true);
    assert.equal(r2.ok, true);
    assert.equal(distante(d), d.g(d.work, 'rev-parse', 'HEAD').trim());
    assert.match(w2.affiche.join('\n'), /Branche poussée \(vérifiée contre origin\/publie\/test-git\)/);
    assert.ok(!w2.appels.some((a) => a[0] !== 'git'), 'relance : aucune commande FONDA pour le lot déjà publié');
  });

  test('branche locale DIVERGENTE de sa distante -> STOP du batch AVANT toute commande FONDA', async () => {
    const d = depot();
    const w0 = deps(d, { etats: { [A]: 'signe' } });
    assert.equal((await run(d, w0)).ok, true);
    // Réécriture locale : le commit poussé est remplacé par un autre (même forme, autre contenu).
    d.g(d.work, 'reset', '-q', '--hard', 'refs/remotes/origin/design');
    publier(d.work, B); d.g(d.work, 'add', '-A'); d.g(d.work, 'commit', '-qm', 'autre');
    const w = deps(d, { etats: { [A]: 'signe' } });
    const r = await run(d, w);
    assert.equal(r.ok, false);
    assert.match(w.affiche.join('\n'), /BATCH ARRÊTÉ AVANT TOUT LOT — branche : publie\/test-git locale DIVERGE/);
    assert.ok(!w.appels.some((a) => a[0] !== 'git'));
  });

  test('commit NON conforme sur la branche (hors 3 fichiers) -> STOP du batch avant tout lot', async () => {
    const d = depot();
    d.g(d.work, 'switch', '-q', '-c', BRANCHE);
    fs.writeFileSync(path.join(d.work, 'README.md'), 'x\n'); d.g(d.work, 'add', '-A'); d.g(d.work, 'commit', '-qm', 'intrus');
    d.g(d.work, 'switch', '-q', 'design');
    const w = deps(d, { etats: { [A]: 'signe' } });
    const r = await run(d, w);
    assert.equal(r.ok, false);
    assert.match(w.affiche.join('\n'), /branche : commit [0-9a-f]{7} non conforme \(README\.md\)/);
    assert.ok(!w.appels.some((a) => a[0] !== 'git'));
  });

  test('branche ne descendant pas d\'origin/design (design a avancé) -> STOP du batch, jamais de fusion ni rebase', async () => {
    const d = depot();
    d.g(d.work, 'switch', '-q', '-c', BRANCHE);
    d.g(d.work, 'switch', '-q', 'design');
    fs.writeFileSync(path.join(d.work, 'AUTRE.md'), 'design avance\n'); d.g(d.work, 'add', '-A'); d.g(d.work, 'commit', '-qm', 'design avance'); d.g(d.work, 'push', '-q', 'origin', 'design');
    const w = deps(d, { etats: { [A]: 'signe' } });
    const r = await run(d, w);
    assert.equal(r.ok, false);
    assert.match(w.affiche.join('\n'), /ne descend pas d'origin\/design/);
    assert.ok(!w.appels.some((a) => a[0] === 'git' && ['merge', 'rebase', 'reset'].includes(a[1])));
  });

  // Consigne B d'annulation EXÉCUTÉE telle qu'affichée : l'arbre redevient propre.
  const annuler = (d, texte) => {
    const cmd = /3b\. OU annuler \(indexé ou non\) : (.+)$/m.exec(texte)[1];
    execFileSync('sh', ['-c', cmd], { cwd: d.work });
    assert.equal(d.g(d.work, 'status', '--porcelain', '--untracked-files=all', '--', 'fonda').trim(), '', 'annulation : arbre propre');
  };
  for (const [nom, indexer] of [['AVANT git add (lot non suivi)', false], ['APRÈS git add (3 fichiers indexés)', true]]) {
    test(`interruption publication <-> commit, ${nom} -> STOP du batch, consignes B PRÉCISES, rien commité ; l'annulation affichée remet l'arbre propre`, async () => {
      const d = depot();
      publier(d.work, A);
      if (indexer) d.g(d.work, 'add', '--', `fonda/data/lots/${A}.json`, CAT, JOU);
      const avant = d.g(d.work, 'rev-parse', 'HEAD').trim();
      const w = deps(d, { etats: { [A]: 'signe' } });
      const r = await run(d, w);
      assert.equal(r.ok, false);
      const t = w.affiche.join('\n');
      assert.match(t, /publication locale NON commitée/);
      assert.match(t, /git diff && git diff --cached/);
      assert.match(t, new RegExp(`git add -- fonda/data/lots/${A}\\.json fonda/data/catalogue-fonda\\.json fonda/data/set_ids-journal\\.json && git commit -m "FONDA : publication de ${A}"`));
      assert.equal(d.g(d.work, 'rev-parse', 'HEAD').trim(), avant, 'jamais d\'auto-commit');
      assert.ok(!w.appels.some((a) => a[0] !== 'git'));
      annuler(d, t);
    });
  }

  test('commit REFUSÉ après git add (hook pre-commit) -> STOP du batch ; relance : publication indexée reconnue, consignes B, annulation effective', async () => {
    const d = depot();
    const hook = path.join(d.work, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\necho "commit refusé par le test" >&2\nexit 1\n', { mode: 0o755 });
    const w1 = deps(d, { etats: { [A]: 'signe' } });
    const r1 = await run(d, w1);
    assert.equal(r1.resultats[0].issue, 'stoppe_batch');
    assert.match(r1.resultats[0].raison, /commit[\s\S]*git restore --staged --worktree/);
    assert.match(d.g(d.work, 'status', '--porcelain'), new RegExp(`A  fonda/data/lots/${A}\\.json`), 'lot resté indexé');
    fs.unlinkSync(hook);
    const w2 = deps(d, { etats: { [A]: 'signe' } });
    const r2 = await run(d, w2);
    assert.equal(r2.ok, false);
    const t = w2.affiche.join('\n');
    assert.match(t, new RegExp(`BATCH ARRÊTÉ AVANT TOUT LOT — démarrage : publication locale NON commitée[\\s\\S]*fonda/data/lots/${A}\\.json`));
    annuler(d, t);
  });

  test('push refusé sur le lot B APRÈS le push de A -> STOP du batch, AUCUN push ultérieur (pas de re-push automatique) ; remote reste sur A', async () => {
    const d = depot();
    const w0 = deps(d, { etats: { [A]: 'signe' } });
    assert.equal((await run(d, w0)).ok, true);
    const surA = distante(d);
    fs.writeFileSync(path.join(d.nu, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const w = deps(d, { etats: { [B]: 'signe' } });
    const r = await run(d, w, [B]);
    assert.equal(r.resultats[0].issue, 'stoppe_batch');
    assert.equal(w.appels.filter((a) => a[0] === 'git' && a[1] === 'push').length, 1, 'une seule tentative, aucune après le STOP du batch');
    assert.equal(distante(d), surA);
    assert.equal(r.url, null);
    assert.doesNotMatch(w.affiche.join('\n'), /Branche poussée/);
  });

  test('origin/design AVANCE pendant un diagnostic (actualisation) -> conformité recontrôlée : STOP du batch AVANT la publication réelle, rien écrit', async () => {
    const d = depot();
    const autre = path.join(d.tmp, 'autre');
    d.g(d.tmp, 'clone', '-q', '-b', 'design', d.nu, autre);
    d.g(autre, 'config', 'user.email', 't@e.invalid'); d.g(autre, 'config', 'user.name', 't');
    const w = deps(d, { etats: { [A]: 'signe' } });
    let n = 0;
    const lancerOrig = w.deps.lancer;
    w.deps.lancer = (exe, args, o) => {
      if (exe !== 'git' && args[1] === '--diagnostic' && (n += 1) === 2) {
        fs.writeFileSync(path.join(autre, 'AUTRE.md'), 'design avance\n'); d.g(autre, 'add', '-A'); d.g(autre, 'commit', '-qm', 'design avance'); d.g(autre, 'push', '-q', 'origin', 'design');
        d.g(d.work, 'fetch', '-q', 'origin', '+refs/heads/design:refs/remotes/origin/design'); // ce que fait l'actualisation du diagnostic
      }
      return lancerOrig(exe, args, o);
    };
    const r = await run(d, w);
    assert.equal(r.resultats[0].issue, 'stoppe_batch');
    assert.match(r.resultats[0].raison, /ne descend pas d'origin\/design/);
    assert.ok(!w.appels.some((a) => a[0] !== 'git' && a.includes(O.PUBLICATION) && !a.includes('--dry-run')), 'publication réelle jamais lancée');
    assert.equal(d.g(d.work, 'status', '--porcelain', '--untracked-files=all', '--', 'fonda').trim(), '');
  });

  test('lot déjà au catalogue d\'origin/design -> STOP du lot (aucune commande FONDA pour lui), lot suivant publié', async () => {
    const d = depot();
    publier(d.work, A); d.g(d.work, 'add', '-A'); d.g(d.work, 'commit', '-qm', 'A publié sur design'); d.g(d.work, 'push', '-q', 'origin', 'design');
    const w = deps(d, { etats: { [A]: 'signe', [B]: 'signe' } });
    const r = await run(d, w, [A, B]);
    assert.deepEqual(r.resultats.map((x) => x.issue), ['stoppe', 'publie']);
    assert.match(r.resultats[0].raison, /déjà au catalogue d'origin\/design/);
    assert.ok(!w.appels.some((a) => a[0] !== 'git' && a.join(' ').includes(A)));
    assert.equal(r.ok, false, 'un lot stoppé -> code ≠ 0');
  });

  test('hook pre-commit AJOUTANT un fichier au commit -> commit OBTENU revérifié : STOP du batch, AUCUN push, consignes manuelles (jamais de reset auto)', async () => {
    const d = depot();
    fs.writeFileSync(path.join(d.work, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho intrus > README.md && git add README.md\n', { mode: 0o755 });
    const w = deps(d, { etats: { [A]: 'signe' } });
    const r = await run(d, w);
    assert.equal(r.resultats[0].issue, 'stoppe_batch');
    assert.match(r.resultats[0].raison, /non conforme \(README\.md, /);
    assert.match(r.resultats[0].raison, /git show --stat HEAD[\s\S]*git reset --soft HEAD~1[\s\S]*publication locale NON commitée/);
    assert.deepEqual(filesDu(d, 'HEAD'), ['README.md', CAT, `fonda/data/lots/${A}.json`, JOU].sort(), 'le hook a bien modifié le commit');
    assert.equal(w.appels.filter((a) => a[0] === 'git' && a[1] === 'push').length, 0, 'aucun push');
    assert.equal(distante(d), null);
    assert.ok(!w.appels.some((a) => a[0] === 'git' && ['reset', 'revert'].includes(a[1])), 'jamais de reset/revert auto');
    assert.equal(w.appels.filter((a) => a[0] === 'git' && a[1] === 'commit').length, 1, 'un seul commit');
    assert.equal(r.ok, false);
  });

  test('branche DISTANTE qui diverge EN COURS de traitement -> recontrôle avec la distante REFETCHÉE : STOP du batch avant la publication réelle, rien écrit ni poussé', async () => {
    const d = depot();
    assert.equal((await run(d, deps(d, { etats: { [A]: 'signe' } }))).ok, true);
    const autre = path.join(d.tmp, 'autre');
    d.g(d.tmp, 'clone', '-q', '-b', BRANCHE, d.nu, autre);
    d.g(autre, 'config', 'user.email', 't@e.invalid'); d.g(autre, 'config', 'user.name', 't');
    const w = deps(d, { etats: { [B]: 'signe' } });
    let n = 0;
    const lancerOrig = w.deps.lancer;
    w.deps.lancer = (exe, args, o) => {
      if (exe !== 'git' && args[1] === '--diagnostic' && (n += 1) === 2) {
        const C = 'set_fonda_grandeurs-mesures_nI_94';
        publier(autre, C); d.g(autre, 'add', '-A'); d.g(autre, 'commit', '-qm', 'publication concurrente'); d.g(autre, 'push', '-q', 'origin', BRANCHE);
      }
      return lancerOrig(exe, args, o);
    };
    const avant = distante(d);
    const r = await run(d, w, [B]);
    assert.equal(r.resultats[0].issue, 'stoppe_batch');
    assert.match(r.resultats[0].raison, /locale DIVERGE de origin\/publie\/test-git/);
    assert.ok(!w.appels.some((a) => a[0] !== 'git' && a.includes(O.PUBLICATION) && !a.includes('--dry-run')), 'publication réelle jamais lancée');
    assert.equal(w.appels.filter((a) => a[0] === 'git' && a[1] === 'push').length, 0);
    assert.notEqual(distante(d), avant, 'la distante a bien bougé (concurrent)');
    assert.equal(d.g(d.work, 'status', '--porcelain', '--untracked-files=all', '--', 'fonda').trim(), '');
  });

  test('branche contenant un commit de FUSION (commits latéraux conformes) -> STOP du batch avant tout lot', async () => {
    const d = depot();
    d.g(d.work, 'switch', '-q', '-c', BRANCHE);
    d.g(d.work, 'switch', '-q', '-c', 'lateral', 'design');
    publier(d.work, B); d.g(d.work, 'add', '-A'); d.g(d.work, 'commit', '-qm', 'publication latérale');
    d.g(d.work, 'switch', '-q', BRANCHE);
    d.g(d.work, 'merge', '-q', '--no-ff', '-m', 'fusion', 'lateral');
    d.g(d.work, 'switch', '-q', 'design');
    const w = deps(d, { etats: { [A]: 'signe' } });
    const r = await run(d, w);
    assert.equal(r.ok, false);
    assert.match(w.affiche.join('\n'), /BATCH ARRÊTÉ AVANT TOUT LOT — branche : publie\/test-git contient un commit de fusion/);
    assert.ok(!w.appels.some((a) => a[0] !== 'git'), 'aucune commande FONDA');
    assert.equal(w.appels.filter((a) => a[0] === 'git' && a[1] === 'push').length, 0);
  });

  test('CE4 : A commité non poussé ; à la relance, le diagnostic de B fait avancer design puis renvoie incident_ouvert -> push final RECONTRÔLÉ contre le design COURANT : STOP du batch, 0 push', async () => {
    const d = depot();
    const hook = path.join(d.nu, 'hooks', 'pre-receive');
    fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const r1 = await run(d, deps(d, { etats: { [A]: 'signe' } }));
    assert.equal(r1.resultats[0].issue, 'stoppe_batch', 'push de A refusé');
    fs.unlinkSync(hook); // un push serait désormais ACCEPTÉ : seul le recontrôle peut l'empêcher
    const autre = path.join(d.tmp, 'autre');
    d.g(d.tmp, 'clone', '-q', '-b', 'design', d.nu, autre);
    d.g(autre, 'config', 'user.email', 't@e.invalid'); d.g(autre, 'config', 'user.name', 't');
    const w = deps(d, { etats: { [B]: 'incident_ouvert' } });
    const lancerOrig = w.deps.lancer;
    w.deps.lancer = (exe, args, o) => {
      if (exe !== 'git' && args[1] === '--diagnostic' && args[2] === B) {
        // design avance sur le remote ; PAS de fetch local ici : le recontrôle doit le faire lui-même.
        fs.writeFileSync(path.join(autre, 'AUTRE.md'), 'design avance\n'); d.g(autre, 'add', '-A'); d.g(autre, 'commit', '-qm', 'design avance'); d.g(autre, 'push', '-q', 'origin', 'design');
      }
      return lancerOrig(exe, args, o);
    };
    const r = await run(d, w, [A, B]);
    assert.deepEqual(r.resultats.map((x) => x.issue), ['deja_publie', 'stoppe']);
    assert.match(r.resultats[1].raison, /incident_ouvert/);
    assert.equal(w.appels.filter((a) => a[0] === 'git' && a[1] === 'push').length, 0, '0 push');
    assert.equal(distante(d), null, 'distante inchangée (jamais créée)');
    const t = w.affiche.join('\n');
    assert.match(t, /BATCH ARRÊTÉ AU PUSH FINAL — branche : publie\/test-git ne descend pas d'origin\/design/);
    assert.match(t, /BATCH ARRÊTÉ : branche : .*ne descend pas d'origin\/design/);
    assert.doesNotMatch(t, /Branche poussée/);
    assert.equal(r.url, null);
    assert.equal(r.pousse, false);
    assert.equal(r.ok, false);
  });

  test('CE5 : design AVANCE sur le remote PENDANT le commit (hook) -> push RECONTRÔLÉ à neuf : STOP du batch, 0 push, distante inchangée, résumé = état RÉEL du distant', async () => {
    const d = depot();
    assert.equal((await run(d, deps(d, { etats: { [A]: 'signe' } }))).ok, true, 'A poussé');
    const surA = distante(d);
    const autre = path.join(d.tmp, 'autre');
    d.g(d.tmp, 'clone', '-q', '-b', 'design', d.nu, autre);
    d.g(autre, 'config', 'user.email', 't@e.invalid'); d.g(autre, 'config', 'user.name', 't');
    // Environnement git du commit en cours neutralisé (env -i) : le hook agit sur un AUTRE clone.
    fs.writeFileSync(path.join(d.work, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\nenv -i PATH="$PATH" HOME="$HOME" sh -c 'cd "${autre}" && echo avance >> AUTRE.md && git add -A && git commit -qm "design avance" && git push -q origin design'\n`, { mode: 0o755 });
    const w = deps(d, { etats: { [B]: 'signe' } });
    const r = await run(d, w, [B]);
    assert.equal(r.resultats[0].issue, 'stoppe_batch');
    assert.match(r.resultats[0].raison, /^push : branche : publie\/test-git ne descend pas d'origin\/design[\s\S]*AUCUN push, commit LOCAL conservé/);
    assert.notEqual(d.g(d.nu, 'rev-parse', 'refs/heads/design').trim(), d.g(d.work, 'rev-parse', `${surA}`).trim());
    assert.equal(w.appels.filter((a) => a[0] === 'git' && a[1] === 'push').length, 0, '0 push');
    assert.equal(distante(d), surA, 'distante inchangée (reste sur A)');
    assert.deepEqual(filesDu(d, 'HEAD'), [CAT, `fonda/data/lots/${B}.json`, JOU].sort(), 'commit local de B conservé');
    const t = w.affiche.join('\n');
    assert.match(t, new RegExp(`Distant : origin/publie/test-git = ${surA.slice(0, 7)} \\(lots poussés : ${A}\\) — aucun nouveau push dans ce lancement`));
    assert.doesNotMatch(t, /rien n'est poussé|Branche poussée/);
    assert.equal(r.url, null);
    assert.equal(r.ok, false);
  });
});
