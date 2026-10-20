// Tests du verrou de déclenchement (plan étape 5, lot 4 ; dette C réduite, D5).
// Usage : node --test fonda/scripts/verrou-generation.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const V = require('./verrou-generation.js');
const D = require('./declencher-generation.js');

const SET = 'set_fonda_nombres-fractions-relatifs_nI_02';
const REF = '2026-10-20-ref0001';
const PID_MORT = 999999;

function banc({ reponses = [202], lecture = {}, horloge } = {}) {
  const verrous = fs.mkdtempSync(path.join(os.tmpdir(), 'verrous-'));
  const etat = { envois: [], lectures: [] };
  let t = Date.parse('2026-10-20T10:00:00.000Z');
  const deps = {
    verrous,
    horloge: horloge || (() => new Date(t)),
    avancer: (ms) => { t += ms; },
    estVivant: (pid) => pid === process.pid,
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
  const c = V.chemins(verrous, SET);
  return { deps, etat, c, journal: () => (fs.existsSync(c.journal) ? fs.readFileSync(c.journal, 'utf8') : null) };
}
const lignes = (t) => t.trim().split('\n').map((l) => JSON.parse(l));

describe('déclencher : ordre, un seul envoi, issues', () => {
  test('202 -> accepte ; un seul POST de { set_id, ref } ; lectures AVANT le verrou', async () => {
    const b = banc();
    const r = await D.executer({ commande: 'declencher', setId: SET, ref: REF }, b.deps);
    assert.equal(r.issue, 'accepte');
    assert.deepEqual(b.etat.envois, [{ set_id: SET, ref: REF }]);
    assert.deepEqual(b.etat.lectures, ['reservation', 'ids', 'executions', 'candidats']);
    assert.deepEqual(lignes(b.journal()).map((l) => [l.evt, l.par]), [['envoi', 'declencher'], ['accepte', 'declencher']]);
    assert.ok(!fs.existsSync(b.c.enCours), 'verrou d\'exclusion relâché');
  });
  for (const [nom, lecture, motif] of [
    ['réservation absente', { reservation: async () => ({ ok: false, raison: 'aucune réservation' }) }, /réservation/],
    ['set_id porté par un fichier local (C12)', { idsLocaux: async () => [SET] }, /fichier local/],
    ['exécution n8n existante', { executionsDuSetId: async () => 1 }, /exécution/],
    ['candidat Drive existant pour CE set_id', { candidatsDuSetId: async () => 1 }, /candidat/],
  ]) {
    test(`refus en LECTURE (${nom}) : aucun verrou créé, aucun envoi`, async () => {
      const b = banc({ lecture });
      await assert.rejects(() => V.declencher(SET, REF, b.deps), motif);
      assert.equal(b.journal(), null);
      assert.ok(!fs.existsSync(b.c.enCours));
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
      assert.equal(b.etat.envois.length, 1);
      await assert.rejects(() => V.declencher(SET, REF, b.deps), /INCONNUE/);
      assert.equal(b.etat.envois.length, 1);
    });
  }
  test('accepte est TERMINAL : tout nouveau déclenchement refusé', async () => {
    const b = banc();
    await V.declencher(SET, REF, b.deps);
    await assert.rejects(() => V.declencher(SET, REF, b.deps), /terminal/);
    await assert.rejects(() => V.liberer(SET, 'x', b.deps), /rien à libérer/);
    assert.equal(b.etat.envois.length, 1);
  });
});

describe('exclusion commune et relecture après acquisition', () => {
  test('verrou tenu (pid vivant) : declencher, --etat et --liberer refusent', async () => {
    const b = banc();
    fs.writeFileSync(b.c.enCours, JSON.stringify({ pid: process.pid, commande: 'declencher', le: 'x', jeton: 'j' }));
    for (const f of [() => V.declencher(SET, REF, b.deps), () => V.etat(SET, b.deps), () => V.liberer(SET, 'm', b.deps)]) await assert.rejects(f, /en cours ou interrompue/);
    assert.equal(b.etat.envois.length, 0);
  });
  test('concurrence : l\'état est relu APRÈS acquisition (un concurrent qui a accepté entre-temps bloque l\'envoi)', async () => {
    const b = banc();
    const lecture = { ...b.deps.lecture, candidatsDuSetId: async () => { await V.declencher(SET, REF, { ...banc().deps, verrous: b.deps.verrous }); return 0; } };
    await assert.rejects(() => V.declencher(SET, REF, { ...b.deps, lecture }), /ACCEPTÉE/);
    assert.equal(b.etat.envois.length, 0, 'le second appelant n\'a rien envoyé');
  });
  test('deux déclenchements simultanés : un seul envoi', async () => {
    const b = banc({ reponses: [202] });
    const lents = { ...b.deps, envoyer: async (c) => { await new Promise((r) => setTimeout(r, 20)); return b.deps.envoyer(c); } };
    const r = await Promise.allSettled([V.declencher(SET, REF, lents), V.declencher(SET, REF, lents)]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(b.etat.envois.length, 1);
  });
});

describe('--etat et --liberer', () => {
  test('ENVOI sans résultat -> --etat sans observation : inchangé ; avec exécution observée -> accepte', async () => {
    const b = banc({ reponses: [new Error('crash')] });
    // Simule un arrêt APRÈS l'envoi (aucune ligne de résultat).
    fs.mkdirSync(b.deps.verrous, { recursive: true });
    fs.writeFileSync(b.c.journal, `${JSON.stringify({ v: 1, evt: 'envoi', le: '2026-10-20T10:00:00.000Z', par: 'declencher', tentative: 1 })}\n`);
    await assert.rejects(() => V.declencher(SET, REF, b.deps), /SANS résultat/);
    assert.equal((await V.etat(SET, b.deps)).etat, 'envoi');
    const vu = { ...b.deps, lecture: { ...b.deps.lecture, executionsDuSetId: async () => 1 } };
    assert.equal((await V.etat(SET, vu)).etat, 'accepte');
    assert.equal(V.lireEtat(SET, b.deps.verrous).etat, 'accepte');
  });
  test('INCONNU -> --liberer : motif requis, délai de prudence, rien observé ; puis libere -> envoi autorisé', async () => {
    const b = banc({ reponses: [504, 202] });
    await V.declencher(SET, REF, b.deps);
    await assert.rejects(() => V.liberer(SET, '', b.deps), /motif/);
    await assert.rejects(() => V.liberer(SET, 'rien vu', b.deps), /délai de prudence/);
    b.deps.avancer(16 * 60 * 1000);
    const vu = { ...b.deps, lecture: { ...b.deps.lecture, candidatsDuSetId: async () => 1 } };
    await assert.rejects(() => V.liberer(SET, 'rien vu', vu), /jamais --liberer/);
    assert.equal((await V.liberer(SET, 'rien vu après 16 min', b.deps)).etat, 'libere');
    assert.equal((await V.declencher(SET, REF, b.deps)).issue, 'accepte');
    assert.deepEqual(lignes(b.journal()).map((l) => l.evt), ['envoi', 'inconnu', 'libere', 'envoi', 'accepte']);
  });
  test('transitions interdites détectées à la lecture (journal falsifié)', () => {
    const a = V.analyser(`${JSON.stringify({ v: 1, evt: 'accepte', par: 'etat', le: 'x' })}\n`);
    assert.equal(a.corrompu, true);
    const b2 = V.analyser([{ evt: 'envoi', par: 'declencher' }, { evt: 'accepte', par: 'declencher' }, { evt: 'envoi', par: 'declencher' }].map((o) => JSON.stringify({ v: 1, le: 'x', ...o })).join('\n') + '\n');
    assert.equal(b2.corrompu, true, 'accepte terminal');
  });
});

describe('--reparer', () => {
  const ecrire = (b, texte) => { fs.writeFileSync(b.c.journal, texte); };
  const L1 = `${JSON.stringify({ v: 1, evt: 'envoi', le: '2026-10-20T10:00:00.000Z', par: 'declencher', tentative: 1 })}\n`;
  const L2 = `${JSON.stringify({ v: 1, evt: 'refuse', le: '2026-10-20T10:00:01.000Z', par: 'declencher', statut: 400 })}\n`;
  test('dernière ligne tronquée : toute commande refuse ; --reparer conserve le fragment, l\'ignore, état antérieur', async () => {
    const b = banc();
    ecrire(b, L1 + L2 + '{"v":1,"evt":"env');
    await assert.rejects(() => V.declencher(SET, REF, b.deps), /tronqué/);
    await assert.rejects(() => V.etat(SET, b.deps), /tronqué/);
    const r = await V.reparer(SET, b.deps);
    assert.equal(r.etat, 'refuse');
    const t = b.journal();
    assert.ok(t.includes('{"v":1,"evt":"env\n'), 'fragment conservé tel quel, rien effacé');
    const adm = lignes(t.split('\n').filter((l, i) => i !== 2).join('\n') + '\n').filter((l) => l.admin);
    assert.equal(adm[0].admin, 'reparation');
    assert.equal(adm[0].fragment_ligne, 2);
    assert.equal(adm[0].fragment_sha256, V.sha256('{"v":1,"evt":"env'));
    assert.equal(V.lireEtat(SET, b.deps.verrous).etat, 'refuse');
    assert.equal((await V.declencher(SET, REF, b.deps)).issue, 'accepte', 'après réparation, REFUSE -> envoi permis');
  });
  test('fichier sans « \\n » final après une ligne valide : traité comme tronqué puis réparé', async () => {
    const b = banc();
    ecrire(b, L1.trimEnd());
    await assert.rejects(() => V.etat(SET, b.deps), /tronqué/);
    const r = await V.reparer(SET, b.deps);
    assert.equal(r.etat, 'envoi', 'ligne JSON complète à qui ne manquait que la fin de ligne : récupérée telle quelle');
    assert.match(r.consigne, /--etat/, 'ENVOI sans résultat : observer');
  });
  test('ligne illisible au milieu, NON réparée -> corrompu ; une désignation au mauvais sha ne couvre pas', () => {
    const t = L1 + 'XXX\n' + `${JSON.stringify({ v: 1, admin: 'reparation', le: 'x', fragment_ligne: 1, fragment_sha256: '0'.repeat(64) })}\n`;
    assert.equal(V.analyser(t).corrompu, true);
  });
  test('.en-cours ORPHELIN (pid mort) : les commandes refusent ; --reparer le reprend (trace), puis tout repart', async () => {
    const b = banc();
    ecrire(b, L1 + L2);
    fs.writeFileSync(b.c.enCours, JSON.stringify({ pid: PID_MORT, commande: 'declencher', le: 'x', jeton: 'j' }));
    await assert.rejects(() => V.declencher(SET, REF, b.deps), /--reparer/);
    const r = await V.reparer(SET, b.deps);
    assert.ok(r.actions.some((x) => /orphelin repris/.test(x)));
    assert.ok(!fs.existsSync(b.c.enCours));
    assert.ok(fs.readdirSync(b.deps.verrous).some((f) => f.includes('.en-cours.orphelin-')), 'trace conservée');
    assert.equal(lignes(b.journal()).filter((l) => l.admin === 'reprise_orphelin').length, 1);
    assert.equal(V.lireEtat(SET, b.deps.verrous).etat, 'refuse', 'administratif : état inchangé');
  });
  test('.en-cours tenu par un pid VIVANT : --reparer refuse (pas un orphelin)', async () => {
    const b = banc();
    ecrire(b, L1 + L2);
    fs.writeFileSync(b.c.enCours, JSON.stringify({ pid: process.pid, commande: 'declencher', le: 'x', jeton: 'j' }));
    await assert.rejects(() => V.reparer(SET, b.deps), /pas un orphelin/);
    assert.ok(fs.existsSync(b.c.enCours));
  });
  test('deux réparateurs : le second refuse tant que le premier (pid vivant) tient la réparation', async () => {
    const b = banc();
    ecrire(b, L1 + L2);
    fs.writeFileSync(b.c.reparation, JSON.stringify({ pid: process.pid, commande: 'reparer', le: 'x', jeton: 'j' }));
    await assert.rejects(() => V.reparer(SET, b.deps), /réparation est EN COURS/);
  });
  test('deux réparateurs simultanés : un seul agit', async () => {
    const b = banc();
    ecrire(b, L1 + L2 + '{"tronq');
    const r = await Promise.allSettled([V.reparer(SET, b.deps), V.reparer(SET, b.deps)]);
    assert.ok(r.filter((x) => x.status === 'fulfilled').length >= 1);
    assert.equal(lignes(b.journal().split('\n').filter((l) => l !== '{"tronq').join('\n') + '\n').filter((l) => l.admin === 'reparation').length, 1, 'une seule désignation du fragment');
  });
  test('réparation INTERROMPUE (pid mort, fin de ligne déjà ajoutée, sans désignation) : reprise et achèvement', async () => {
    const b = banc();
    ecrire(b, L1 + L2 + '{"tronq\n'); // la 1re réparation a ajouté \n puis s'est arrêtée
    fs.writeFileSync(b.c.reparation, JSON.stringify({ pid: PID_MORT, commande: 'reparer', le: 'x', jeton: 'j' }));
    fs.writeFileSync(b.c.enCours, JSON.stringify({ pid: PID_MORT, commande: 'reparer', le: 'x', jeton: 'j' }));
    const r = await V.reparer(SET, b.deps);
    assert.equal(r.etat, 'refuse');
    assert.ok(fs.readdirSync(b.deps.verrous).some((f) => f.includes('.reparation.orphelin-')));
    assert.equal(V.lireEtat(SET, b.deps.verrous).corrompu, false);
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
  test('sans adaptateurs de production (lot 5) : refus avant toute lecture', async () => {
    const err = []; const ce = console.error; console.error = (m) => err.push(m);
    try { await D.main([SET, REF]); } finally { console.error = ce; }
    assert.match(err.join('\n'), /lot 5/);
    process.exitCode = 0;
  });
});
