// Tests du verrou de déclenchement (plan étape 5, lot 4 ; dette C réduite, D5).
// Deux niveaux : (1) logique en processus (journal, transitions, réparation, écritures courtes,
// octets) ; (2) PROCESSUS RÉELS sous /usr/bin/lockf (concurrence, kill -9, réparateurs).
// Usage : node --test fonda/scripts/verrou-generation.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const V = require('./verrou-generation.js');
const D = require('./declencher-generation.js');

const SET = 'set_fonda_nombres-fractions-relatifs_nI_02';
const REF = '2026-10-20-ref0001';
const ENFANT = path.join(__dirname, 'fixtures', 'verrou-enfant.js');

function banc({ reponses = [202], lecture = {} } = {}) {
  const verrous = fs.mkdtempSync(path.join(os.tmpdir(), 'verrous-'));
  const etat = { envois: [], lectures: [] };
  let t = Date.parse('2026-10-20T10:00:00.000Z');
  const c = V.chemins(verrous, SET);
  const deps = {
    verrous, sousVerrou: c.verrou,
    horloge: () => new Date(t),
    avancer: (ms) => { t += ms; },
    lecture: {
      reservation: async () => { etat.lectures.push('reservation'); return { ok: true }; },
      idsLocaux: async () => { etat.lectures.push('ids'); return ['set_fonda_nombres-fractions-relatifs_nI_01']; },
      executionsDuSetId: async () => { etat.lectures.push('executions'); return 0; },
      candidatsDuSetId: async () => { etat.lectures.push('candidats'); return 0; },
      ...lecture,
    },
    envoyer: async (corps) => {
      etat.envois.push(corps);
      const r = reponses[Math.min(etat.envois.length - 1, reponses.length - 1)];
      if (r instanceof Error) throw r;
      return { statut: r };
    },
  };
  return { deps, etat, c, journal: () => (fs.existsSync(c.journal) ? fs.readFileSync(c.journal) : null) };
}
const lignes = (buf) => buf.toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
const L = (o) => `${JSON.stringify({ v: 1, le: '2026-10-20T10:00:00.000Z', ...o })}\n`;
const L1 = L({ evt: 'envoi', par: 'declencher', tentative: 1 });
const L2 = L({ evt: 'refuse', par: 'declencher', statut: 400 });

describe('déclencher : lectures, un seul envoi, issues', () => {
  test('202 -> accepte ; un seul POST de { set_id, ref } ; lectures avant toute écriture', async () => {
    const b = banc();
    const r = await D.executer({ commande: 'declencher', setId: SET, ref: REF }, b.deps);
    assert.equal(r.issue, 'accepte');
    assert.deepEqual(b.etat.envois, [{ set_id: SET, ref: REF }]);
    assert.deepEqual(b.etat.lectures, ['reservation', 'ids', 'executions', 'candidats']);
    assert.deepEqual(lignes(b.journal()).map((l) => [l.evt, l.par]), [['envoi', 'declencher'], ['accepte', 'declencher']]);
  });
  test('hors du verrou noyau : refus (aucune fonction n\'agit sans lockf)', async () => {
    const b = banc();
    await assert.rejects(() => V.declencher(SET, REF, { ...b.deps, sousVerrou: undefined }), /HORS du verrou noyau/);
    assert.equal(b.journal(), null);
  });
  for (const [nom, lecture, motif] of [
    ['réservation absente', { reservation: async () => ({ ok: false, raison: 'aucune réservation' }) }, /réservation/],
    ['set_id porté par un fichier local (C12)', { idsLocaux: async () => [SET] }, /fichier local/],
    ['exécution n8n existante', { executionsDuSetId: async () => 1 }, /exécution/],
    ['candidat Drive existant pour CE set_id', { candidatsDuSetId: async () => 1 }, /candidat/],
    ['observation indisponible (undefined)', { executionsDuSetId: async () => undefined }, /indisponible ou invalide/],
    ['observation invalide (NaN)', { candidatsDuSetId: async () => NaN }, /indisponible ou invalide/],
  ]) {
    test(`refus en LECTURE (${nom}) : journal jamais créé, aucun envoi`, async () => {
      const b = banc({ lecture });
      await assert.rejects(() => V.declencher(SET, REF, b.deps), motif);
      assert.equal(b.journal(), null);
      assert.equal(b.etat.envois.length, 0);
    });
  }
  test('400 -> refuse : nouvel appel autorisé (même fichier, tentative 2)', async () => {
    const b = banc({ reponses: [400, 202] });
    assert.equal((await V.declencher(SET, REF, b.deps)).issue, 'refuse');
    assert.equal((await V.declencher(SET, REF, b.deps)).issue, 'accepte');
    assert.deepEqual(lignes(b.journal()).filter((l) => l.evt === 'envoi').map((l) => l.tentative), [1, 2]);
  });
  for (const [nom, rep] of [['504', 504], ['500', 500], ['erreur réseau', Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' })], ['200 inattendu', 200]]) {
    test(`${nom} -> inconnu, consigne « observer », jamais de nouvel essai`, async () => {
      const b = banc({ reponses: [rep] });
      const r = await V.declencher(SET, REF, b.deps);
      assert.equal(r.issue, 'inconnu');
      assert.match(r.consigne, /NE PAS renvoyer/);
      await assert.rejects(() => V.declencher(SET, REF, b.deps), /INCONNUE/);
      assert.equal(b.etat.envois.length, 1);
    });
  }
  test('accepte est TERMINAL', async () => {
    const b = banc();
    await V.declencher(SET, REF, b.deps);
    await assert.rejects(() => V.declencher(SET, REF, b.deps), /terminal/);
    await assert.rejects(() => V.liberer(SET, 'x', b.deps), /rien à libérer/);
    assert.equal(b.etat.envois.length, 1);
  });
  test('écritures COURTES : chaque ligne est écrite en entier (jamais d\'« accepte » perdu)', async () => {
    const b = banc();
    const courte = (fd, buf, off, len) => fs.writeSync(fd, buf, off, Math.min(len, 3)); // 3 octets au plus par appel
    await V.declencher(SET, REF, { ...b.deps, ecrire: courte });
    assert.deepEqual(lignes(b.journal()).map((l) => l.evt), ['envoi', 'accepte']);
    assert.equal(V.lireEtat(SET, b.deps.verrous).etat, 'accepte');
    assert.throws(() => V.ecrireTout(0, Buffer.from('x'), () => 0), /0 octet/);
  });
});

describe('--etat et --liberer', () => {
  test('ENVOI sans résultat -> --etat sans observation : inchangé ; exécution observée -> accepte', async () => {
    const b = banc();
    fs.writeFileSync(b.c.journal, L1);
    await assert.rejects(() => V.declencher(SET, REF, b.deps), /SANS résultat/);
    assert.equal((await V.etat(SET, b.deps)).etat, 'envoi');
    const vu = { ...b.deps, lecture: { ...b.deps.lecture, executionsDuSetId: async () => 1 } };
    assert.equal((await V.etat(SET, vu)).etat, 'accepte');
  });
  test('INCONNU -> --liberer : motif, délai, deux zéros EXPLICITES ; libere -> envoi', async () => {
    const b = banc({ reponses: [504, 202] });
    await V.declencher(SET, REF, b.deps);
    await assert.rejects(() => V.liberer(SET, '', b.deps), /motif/);
    await assert.rejects(() => V.liberer(SET, 'rien vu', b.deps), /délai de prudence/);
    b.deps.avancer(16 * 60 * 1000);
    for (const v of [undefined, NaN, null, -1, 1.5, { indisponible: true }]) {
      await assert.rejects(() => V.liberer(SET, 'rien vu', { ...b.deps, lecture: { ...b.deps.lecture, candidatsDuSetId: async () => v } }), /indisponible ou invalide/, String(v));
    }
    await assert.rejects(() => V.liberer(SET, 'rien vu', { ...b.deps, lecture: { ...b.deps.lecture, candidatsDuSetId: async () => 1 } }), /jamais --liberer/);
    assert.equal((await V.liberer(SET, 'rien vu après 16 min', b.deps)).etat, 'libere');
    assert.equal((await V.declencher(SET, REF, b.deps)).issue, 'accepte');
    assert.deepEqual(lignes(b.journal()).map((l) => l.evt), ['envoi', 'inconnu', 'libere', 'envoi', 'accepte']);
  });
  test('horloge : dernier événement daté dans le FUTUR -> refus (hypothèse d\'horloge stable)', async () => {
    const b = banc();
    fs.writeFileSync(b.c.journal, L({ evt: 'envoi', par: 'declencher', tentative: 1, le: '2026-10-21T10:00:00.000Z' }));
    await assert.rejects(() => V.liberer(SET, 'x', b.deps), /futur/);
  });
});

describe('lecture stricte du journal', () => {
  test('transitions interdites, familles mélangées, administratif inconnu -> corrompu', () => {
    assert.equal(V.analyser(Buffer.from(L({ evt: 'accepte', par: 'etat' }))).corrompu, true);
    assert.equal(V.analyser(Buffer.from(L1 + L({ evt: 'accepte', par: 'declencher' }) + L({ evt: 'envoi', par: 'declencher' }))).corrompu, true, 'accepte terminal');
    assert.equal(V.analyser(Buffer.from(L1 + L({ admin: 'inconnu', evt: 'accepte', par: 'declencher' }))).corrompu, true, 'ligne mélangeant admin et evt');
    assert.equal(V.analyser(Buffer.from(L1 + L({ admin: 'autre' }))).corrompu, true, 'administratif inconnu');
    assert.equal(V.analyser(Buffer.from(L1 + `${JSON.stringify({ v: 1, evt: 'accepte', par: 'declencher', le: 'hier' })}\n`)).corrompu, true, 'date hors grammaire');
  });
  test('UTF-8 invalide dans une ligne JSON par ailleurs analysable -> illisible (jamais décodée en U+FFFD)', () => {
    const t = Buffer.from(L1 + L({ evt: 'refuse', par: 'declencher', motif: 'Z' }));
    t[t.lastIndexOf(Buffer.from('Z'))] = 0xc3; // octet de tête isolé dans une chaîne
    const a = V.analyser(t);
    assert.equal(a.corrompu, true);
    assert.equal(a.etat, 'envoi', 'la ligne invalide n\'est pas appliquée');
  });
  test('désignation d\'un fragment : seule une ligne ULTÉRIEURE au bon SHA des OCTETS couvre', () => {
    const frag = Buffer.from('{"v":1,"evt":"acc');
    const base = Buffer.concat([Buffer.from(L1), frag, Buffer.from('\n')]);
    const bon = L({ admin: 'reparation', fragment_ligne: 1, fragment_sha256: V.sha256(frag) });
    const mauvais = L({ admin: 'reparation', fragment_ligne: 1, fragment_sha256: '0'.repeat(64) });
    assert.equal(V.analyser(Buffer.concat([base, Buffer.from(bon)])).corrompu, false);
    assert.equal(V.analyser(Buffer.concat([base, Buffer.from(mauvais)])).corrompu, true);
  });
});

describe('--reparer (logique)', () => {
  test('ligne tronquée : toutes les commandes refusent ; réparation : fragment conservé, ignoré, état antérieur', async () => {
    const b = banc();
    fs.writeFileSync(b.c.journal, L1 + L2 + '{"v":1,"evt":"env');
    await assert.rejects(() => V.declencher(SET, REF, b.deps), /tronqué/);
    await assert.rejects(() => V.etat(SET, b.deps), /tronqué/);
    const r = await V.reparer(SET, b.deps);
    assert.equal(r.etat, 'refuse');
    assert.ok(b.journal().includes(Buffer.from('{"v":1,"evt":"env\n')), 'fragment conservé tel quel');
    assert.equal((await V.declencher(SET, REF, b.deps)).issue, 'accepte');
  });
  test('fragment coupé au MILIEU d\'un caractère UTF-8 : empreinte sur les octets bruts ; altération ultérieure détectée', async () => {
    const b = banc();
    const frag = Buffer.concat([Buffer.from('{"v":1,"motif":"é'), Buffer.from([0xc3])]); // octet de tête sans suite
    fs.writeFileSync(b.c.journal, Buffer.concat([Buffer.from(L1 + L2), frag]));
    await V.reparer(SET, b.deps);
    const adm = lignes(Buffer.from(b.journal().toString('latin1').split('\n').filter((_, i) => i !== 2).join('\n'), 'latin1')).find((l) => l.admin);
    assert.equal(adm.fragment_sha256, V.sha256(frag), 'SHA des octets bruts, pas du texte décodé');
    assert.equal(V.lireEtat(SET, b.deps.verrous).corrompu, false);
    const altere = Buffer.from(b.journal()); altere[altere.indexOf(0xc3, L1.length + L2.length + 14)] = 0xc2;
    fs.writeFileSync(b.c.journal, altere);
    assert.equal(V.lireEtat(SET, b.deps.verrous).corrompu, true, 'remplacement C3 -> C2 détecté');
  });
  test('ligne illisible au milieu : --reparer la désigne ; idempotent (relance sans effet)', async () => {
    const b = banc();
    fs.writeFileSync(b.c.journal, L1 + 'XXX\n' + L2);
    const r1 = await V.reparer(SET, b.deps);
    assert.equal(r1.etat, 'refuse');
    const avant = b.journal();
    const r2 = await V.reparer(SET, b.deps);
    assert.deepEqual(r2.actions, []);
    assert.ok(b.journal().equals(avant));
  });
  test('réparation INTERROMPUE après l\'ajout de la fin de ligne : la relance achève', async () => {
    const b = banc();
    fs.writeFileSync(b.c.journal, L1 + L2 + '{"tronq\n'); // fin de ligne ajoutée, désignation non écrite
    const r = await V.reparer(SET, b.deps);
    assert.equal(r.etat, 'refuse');
    assert.equal(V.lireEtat(SET, b.deps.verrous).corrompu, false);
  });
});

// --- Processus RÉELS sous /usr/bin/lockf -----------------------------------------------------
const lockfDisponible = fs.existsSync('/usr/bin/lockf');
function enfant(conf, { attendre = true } = {}) {
  const env = { ...process.env, FONDA_TEST_CONF: JSON.stringify(conf) };
  delete env.FONDA_SOUS_VERROU;
  if (attendre) return spawnSync(process.execPath, [ENFANT], { env, encoding: 'utf8' });
  return spawn(process.execPath, [ENFANT], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
}
const attendreFichier = async (p, ms = 5000) => { const t0 = Date.now(); while (!fs.existsSync(p)) { if (Date.now() - t0 > ms) throw new Error(`attente ${p}`); await new Promise((r) => setTimeout(r, 20)); } };
const tuerGroupe = (c) => { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* déjà mort */ } };

describe('processus réels (lockf)', { skip: !lockfDisponible && 'lockf absent' }, () => {
  const base = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'verrous-p-'));
    return { verrous: d, trace: path.join(d, 'trace'), pret: path.join(d, 'pret'), go: path.join(d, 'go') };
  };
  const posts = (b) => (fs.existsSync(b.trace) ? fs.readFileSync(b.trace, 'utf8').trim().split('\n').length : 0);

  test('nominal : verrou noyau pris PAR le processus de commande, un POST, accepte', () => {
    const b = base();
    const r = enfant({ argv: [SET, REF], verrous: b.verrous, trace: b.trace });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(posts(b), 1);
    assert.equal(V.lireEtat(SET, b.verrous).etat, 'accepte');
  });
  test('deux processus concurrents : le second échoue AUSSITÔT (code 75), un seul POST', async () => {
    const b = base();
    const premier = enfant({ argv: [SET, REF], verrous: b.verrous, trace: b.trace, barriere: { pret: b.pret, go: b.go } }, { attendre: false });
    try {
      await attendreFichier(b.pret);
      for (const argv of [[SET, REF], ['--etat', SET], ['--reparer', SET], ['--liberer', SET, '--motif', 'x']]) {
        const second = enfant({ argv, verrous: b.verrous, trace: b.trace });
        assert.equal(second.status, D.OCCUPE, `${argv.join(' ')} : ${second.stderr}`);
        assert.match(second.stderr, /tient le verrou/);
      }
      fs.writeFileSync(b.go, '');
      await new Promise((r) => premier.on('exit', r));
    } finally { tuerGroupe(premier); }
    assert.equal(posts(b), 1);
    assert.equal(V.lireEtat(SET, b.verrous).etat, 'accepte');
  });
  test('aucun superviseur : pendant la détention, AUCUN processus lockf ne survit (le verrou est tenu par Node lui-même)', async () => {
    const b = base();
    const premier = enfant({ argv: [SET, REF], verrous: b.verrous, trace: b.trace, barriere: { pret: b.pret, go: b.go } }, { attendre: false });
    try {
      await attendreFichier(b.pret);
      const ps = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout;
      assert.ok(!ps.split('\n').some((l) => /\/usr\/bin\/lockf/.test(l) && l.trim().split(/\s+/)[1] === String(premier.pid)), 'aucun lockf enfant vivant');
      assert.equal(enfant({ argv: ['--etat', SET], verrous: b.verrous, trace: b.trace }).status, D.OCCUPE, 'verrou bien tenu');
      fs.writeFileSync(b.go, '');
      await new Promise((r) => premier.on('exit', r));
    } finally { tuerGroupe(premier); }
  });
  test('kill -9 du SEUL processus de commande APRÈS « envoi » : verrou libéré ; ENVOI sans résultat, aucun renvoi', async () => {
    const b = base();
    const premier = enfant({ argv: [SET, REF], verrous: b.verrous, trace: b.trace, barriere: { pret: b.pret, go: b.go } }, { attendre: false });
    await attendreFichier(b.pret);
    process.kill(premier.pid, 'SIGKILL'); // le processus seul, pas son groupe
    await new Promise((r) => premier.on('exit', r));
    assert.equal(V.lireEtat(SET, b.verrous).etat, 'envoi');
    const relance = enfant({ argv: [SET, REF], verrous: b.verrous, trace: b.trace });
    assert.equal(relance.status, 1);
    assert.match(relance.stderr, /SANS résultat/);
    const etat = enfant({ argv: ['--etat', SET], verrous: b.verrous, trace: b.trace, candidats: 1 });
    assert.equal(etat.status, 0, etat.stderr);
    assert.equal(V.lireEtat(SET, b.verrous).etat, 'accepte');
    assert.equal(posts(b), 0, 'aucun POST : le premier a été tué avant');
  });
  test('deux réparateurs : sous le même verrou noyau, le second échoue (75) pendant que le premier tient', async () => {
    const b = base();
    fs.mkdirSync(b.verrous, { recursive: true });
    fs.writeFileSync(V.chemins(b.verrous, SET).journal, L1 + L2 + '{"tronq');
    // Le premier « réparateur » est simulé par un détenteur du verrou noyau.
    const tenant = spawn('/usr/bin/lockf', ['-k', V.chemins(b.verrous, SET).verrou, 'sh', '-c', `touch ${b.pret}; while [ ! -f ${b.go} ]; do sleep 0.05; done`], { detached: true });
    try {
      await attendreFichier(b.pret);
      const second = enfant({ argv: ['--reparer', SET], verrous: b.verrous, trace: b.trace });
      assert.equal(second.status, D.OCCUPE);
      fs.writeFileSync(b.go, '');
      await new Promise((r) => tenant.on('exit', r));
    } finally { tuerGroupe(tenant); }
    const r = enfant({ argv: ['--reparer', SET], verrous: b.verrous, trace: b.trace });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(V.lireEtat(SET, b.verrous).etat, 'refuse');
  });
});

describe('CLI', () => {
  test('arguments : commandes, --motif réservé à --liberer, options inconnues refusées', () => {
    assert.deepEqual(D.analyserArguments([SET, REF]), { commande: 'declencher', setId: SET, ref: REF, motif: undefined });
    assert.deepEqual(D.analyserArguments(['--liberer', SET, '--motif', 'rien vu']), { commande: '--liberer', setId: SET, ref: undefined, motif: 'rien vu' });
    assert.throws(() => D.analyserArguments(['--etat', SET, '--motif', 'x']), /seulement avec --liberer/);
    assert.throws(() => D.analyserArguments([SET]), /usage/);
    assert.throws(() => D.analyserArguments(['--retry', SET]), /option inconnue/);
  });
  test('production sans secrets (~/.fonda-cles vide) : refus AVANT toute lecture réseau, rien écrit au journal', { skip: !lockfDisponible && 'lockf absent' }, () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'verrous-c-'));
    const r = spawnSync(process.execPath, [path.join(__dirname, 'declencher-generation.js'), SET, REF], { encoding: 'utf8', env: { ...process.env, HOME: d } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /secret n8n-signataire\.cle illisible/);
    assert.ok(!fs.existsSync(path.join(d, 'FONDA-clotures', 'verrous', `${SET}.generation`)), 'journal jamais créé');
  });
});
