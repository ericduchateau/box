// Tests du verrou « un seul écrivain » de la relecture (CDC §21.12, P5-1).
// Deux niveaux : (1) logique en processus (schéma fermé, machine à états, qualification unique, journal
// d'abord, rattachement par exclusion, réparation, signature, sentinelles) ; (2) PROCESSUS RÉELS sous
// /usr/bin/lockf (concurrence, kill -9 après POST, exclusion globale du journal).
// Chaque constat de la relecture Codex de P5-1 (C1–C8, T-a/b/c) est reproduit par un test nommé.
// Usage : node --test fonda/scripts/verrou-relecture.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const V = require('./verrou-relecture.js');

const A = 'set_fonda_nombres-fractions-relatifs_nI_02';
const B = 'set_fonda_resolution-problemes_nI_02';
const ENFANT = path.join(__dirname, 'fixtures', 'verrou-relecture-enfant.js');
const FICHIER = 'fichierCandidatA0123456789';
const EN_ATTENTE = { fichier_id: FICHIER, version: '7', generation_cle: 1, statut: 'en_attente', clos_le: null };
const CLOS = { ...EN_ATTENTE, version: '9', statut: 'clos', clos_le: '2026-11-10T10:00:00.000Z' };
const REP_EMISSION = { generation_cle: 1, statut: 'en_attente' };

function banc({ init = true } = {}) {
  const verrous = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'relecture-')));
  let t = Date.parse('2026-11-16T10:00:00.000Z');
  let n = 0;
  const deps = {
    verrous, sousVerrou: path.join(verrous, 'relecture.verrou'),
    horloge: () => new Date(t), avancer: (ms) => { t += ms; },
    aleatoire: () => (n += 1).toString(16).padStart(32, '0'),
  };
  if (init) V.initialiser(deps);
  const journal = path.join(verrous, 'relecture.journal');
  return { deps, journal, octets: () => fs.readFileSync(journal), lignes: () => fs.readFileSync(journal, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) };
}
const etatLot = (b, s) => (V.lireEtat(b.deps.verrous).lots[s] || { etat: 'libre' }).etat;
const envoi = (b, s = A, commande = 'emission', candidat = null, preexistantes = []) => V.preparerEnvoi(s, commande, { candidat, preexistantes, listingComplet: true }, b.deps);
const exec = (id, o = {}) => ({ id, set_id: A, workflow: 'emettre', statut: 'success', ...o });
const ajouterLigne = (b, o) => fs.appendFileSync(b.journal, `${JSON.stringify({ v: 1, le: '2026-11-16T10:00:00.000Z', ...o })}\n`);

describe('exclusion et initialisation', () => {
  test('hors du verrou noyau : toute commande refuse, rien n\'est écrit', () => {
    const b = banc({ init: false });
    const hors = { ...b.deps, sousVerrou: undefined };
    assert.throws(() => V.initialiser(hors), /HORS du verrou/);
    assert.equal(fs.existsSync(b.journal), false);
    V.initialiser(b.deps);
    for (const f of [() => envoi({ deps: hors }), () => V.decisionSignature(A, hors), () => V.reparer(hors)]) assert.throws(f, /HORS du verrou/);
  });
  test('init : en-tête unique + témoin de création ; jamais réinitialisé', () => {
    const b = banc();
    assert.deepEqual(b.lignes(), [{ v: 1, type: 'init', le: '2026-11-16T10:00:00.000Z', schema: 'journal-relecture/v1' }]);
    assert.ok(fs.existsSync(`${b.journal}.cree`));
    assert.throws(() => V.initialiser(b.deps), /jamais réinitialisé/);
    fs.unlinkSync(`${b.journal}.cree`);
    assert.throws(() => V.initialiser(b.deps), /journal déjà présent/, 'journal présent : refus même sans témoin');
  });
  test('C5 : journal SUPPRIMÉ après un envoi -> init refusée (témoin de création) ; idem si une copie original-* subsiste', () => {
    const b = banc();
    envoi(b);
    fs.unlinkSync(b.journal);
    assert.throws(() => V.initialiser(b.deps), /a déjà existé ici/);
    assert.throws(() => envoi(b), /inutilisable/);
    const b2 = banc();
    fs.appendFileSync(b2.journal, 'xx');
    V.reparer(b2.deps);
    fs.unlinkSync(b2.journal); fs.unlinkSync(`${b2.journal}.cree`);
    assert.throws(() => V.initialiser(b2.deps), /a déjà existé ici/);
  });
  test('journal ABSENT après init ou VIDE : refus de toute écriture et de toute signature', () => {
    for (const casser of [(b) => fs.unlinkSync(b.journal), (b) => fs.writeFileSync(b.journal, '')]) {
      const b = banc();
      casser(b);
      assert.throws(() => envoi(b), /inutilisable/);
      assert.throws(() => V.decisionSignature(A, b.deps), /inutilisable/);
    }
  });
  test('quiescence : explicite et complète, sinon refus', () => {
    V.exigerQuiescence({ complet: true, enVol: 0 });
    assert.throws(() => V.exigerQuiescence({ complet: true, enVol: 1 }), /en vol/);
    for (const o of [null, {}, { complet: false, enVol: 0 }, { complet: true }, { complet: true, enVol: NaN }]) assert.throws(() => V.exigerQuiescence(o), /incomplète ou invalide/);
  });
  test('chemin canonique : un lien symbolique vers le dossier désigne le même verrou', () => {
    const b = banc();
    const lien = `${b.deps.verrous}-lien`;
    fs.symlinkSync(b.deps.verrous, lien);
    assert.equal(V.chemins(lien).verrou, V.chemins(b.deps.verrous).verrou);
    assert.equal(V.decisionSignature(A, { ...b.deps, verrous: lien }), 'poursuivre');
  });
});

describe('journal d\'abord et machine à états (par tentative, par lot)', () => {
  test('envoi écrit AVANT le POST, schéma exact, issue attendue propre à la commande', () => {
    const b = banc();
    const p = envoi(b, A, 'emission', null, ['12', '3']);
    const l = b.lignes()[1];
    assert.deepEqual(Object.keys(l), ['v', 'type', 'le', 'set_id', 'tentative_id', 'commande', 'workflow', 'avant', 'preexistantes', 'attendu']);
    assert.equal(l.avant, null, 'absence établie = null');
    assert.deepEqual(l.preexistantes, ['3', '12'], 'triés numériquement, uniques');
    assert.deepEqual(p.attendu, { fichier_id: null, generation_cle: 1, statut: 'en_attente', clos_le: null });
    assert.equal(etatLot(b, A), 'ouverte', 'envoi sans issue = indéterminé (lot ouvert)');
  });
  test('T-b : échec de fsync injecté -> preparerEnvoi lève, AUCUN POST ne part (le POST suit son retour)', () => {
    const b = banc();
    let posts = 0;
    const appelant = (deps) => { V.preparerEnvoi(A, 'emission', { candidat: null, preexistantes: [], listingComplet: true }, deps); posts += 1; };
    assert.throws(() => appelant({ ...b.deps, fsync: () => { throw new Error('EIO'); } }), /EIO/);
    assert.equal(posts, 0);
    assert.notEqual(etatLot(b, A), 'libre', 'ligne écrite sans garantie : le lot reste fermé (prudence)');
  });
  test('accepte : lot libre ; NON terminal pour le lot (opérations suivantes admises)', () => {
    const b = banc();
    assert.equal(V.conclure(envoi(b).tentative_id, 'accepte', { reponse: REP_EMISSION }, b.deps).issue, 'accepte');
    assert.equal(etatLot(b, A), 'libre');
    const p2 = envoi(b, A, 'reemission', EN_ATTENTE);
    assert.deepEqual(p2.attendu, { fichier_id: FICHIER, generation_cle: 2, statut: 'en_attente', clos_le: null });
    assert.equal(V.conclure(p2.tentative_id, 'accepte', { reponse: { generation_cle: 2 } }, b.deps).issue, 'accepte');
    const p3 = envoi(b, A, 'cloture_technique', { ...EN_ATTENTE, generation_cle: 2 });
    assert.equal(V.conclure(p3.tentative_id, 'accepte', { reponse: { statut: 'clos', deja_clos: false } }, b.deps).issue, 'accepte');
    assert.equal(etatLot(b, A), 'libre');
  });
  test('C2 : réponse VIDE, partielle ou non conforme -> indetermine, jamais accepte', () => {
    const cas = [
      ['emission', null, {}, 'reponse_non_conforme'], ['emission', null, { generation_cle: 1 }, 'reponse_non_conforme'],
      ['emission', null, { generation_cle: 2, statut: 'en_attente' }, 'reponse_non_conforme'], ['emission', null, null, 'reponse_illisible'],
      ['emission', null, { generation_cle: 'x' }, 'reponse_illisible'], ['reemission', EN_ATTENTE, {}, 'reponse_non_conforme'],
      ['cloture_technique', EN_ATTENTE, { statut: 'clos' }, 'reponse_non_conforme'], ['cloture_technique', EN_ATTENTE, { statut: 'clos', deja_clos: true }, 'reponse_non_conforme'],
      ['cloture_technique', CLOS, { statut: 'clos', deja_clos: false }, 'reponse_non_conforme'],
    ];
    for (const [commande, cand, reponse, motif] of cas) {
      const b = banc();
      assert.equal(V.conclure(envoi(b, A, commande, cand).tentative_id, 'accepte', { reponse }, b.deps).issue, 'indetermine', JSON.stringify(reponse));
      assert.equal(b.lignes().at(-1).motif, motif);
      assert.equal(V.decisionSignature(A, b.deps), 'refus_temporaire');
    }
  });
  test('C2 : refuse_sans_effet exige 4xx + motif de la liste ; 5xx / absent -> indetermine ; motif hors liste -> refus, rien écrit', () => {
    const b = banc();
    V.conclure(envoi(b).tentative_id, 'refuse_sans_effet', { http: 409, motif_refus: 'version_avant' }, b.deps);
    assert.equal(etatLot(b, A), 'libre');
    for (const donnees of [{ http: 500, motif_refus: 'precondition' }, { http: 302, motif_refus: 'precondition' }, {}, null]) {
      const b2 = banc();
      assert.equal(V.conclure(envoi(b2).tentative_id, 'refuse_sans_effet', donnees, b2.deps).issue, 'indetermine');
      assert.equal(b2.lignes().at(-1).motif, 'erreur_serveur');
    }
    const b3 = banc();
    const p = envoi(b3);
    const avant = b3.octets();
    assert.throws(() => V.conclure(p.tentative_id, 'refuse_sans_effet', { http: 400, motif_refus: 'autre' }, b3.deps), /motif hors liste/);
    assert.ok(b3.octets().equals(avant));
    assert.equal(etatLot(b3, A), 'ouverte');
  });
  for (const motif of ['delai', 'transport', 'reponse_illisible', 'erreur_apres_ecriture', 'ecart_version']) {
    test(`indetermine (${motif}) : MÊME lot refusé, AUTRE lot autorisé ; signature du lot = refus temporaire`, () => {
      const b = banc();
      V.conclure(envoi(b).tentative_id, 'indetermine', { motif }, b.deps);
      assert.throws(() => envoi(b), /diagnostic requis/);
      assert.equal(V.decisionSignature(A, b.deps), 'refus_temporaire');
      envoi(b, B);
      assert.equal(V.decisionSignature(B, b.deps), 'refus_temporaire');
    });
  }
  test('envoi SANS issue (CLI mort) : même lot refusé, autre lot autorisé', () => {
    const b = banc();
    envoi(b);
    assert.throws(() => envoi(b), /diagnostic requis/);
    assert.equal(V.decisionSignature(A, b.deps), 'refus_temporaire');
    envoi(b, B);
  });
  test('tentative déjà conclue, inconnue ou id invalide : refus', () => {
    const b = banc();
    const p = envoi(b);
    V.conclure(p.tentative_id, 'refuse_sans_effet', { http: 400, motif_refus: 'entree_invalide' }, b.deps);
    assert.throws(() => V.conclure(p.tentative_id, 'indetermine', { motif: 'delai' }, b.deps), /déjà conclue/);
    assert.throws(() => V.conclure('f'.repeat(32), 'accepte', { reponse: {} }, b.deps), /inconnue/);
    assert.throws(() => V.conclure('xyz', 'accepte', { reponse: {} }, b.deps), /invalide/);
    assert.throws(() => V.conclure(envoi(b).tentative_id, 'reussi', {}, b.deps), /issue inconnue/);
  });
  test('C3 : pré-conditions par commande ; « absent » = null explicite ; candidat incomplet ou {} -> refus AVANT écriture', () => {
    const cas = [
      ['emission', EN_ATTENTE, /existe déjà/], ['reemission', null, /absent/], ['reemission', CLOS, /non en_attente/],
      ['cloture_technique', { ...EN_ATTENTE, statut: 'abandonne' }, /abandonné/], ['cloture_technique', { ...EN_ATTENTE, version: null }, /incomplet/],
      ['emission', {}, /incomplet/], ['reemission', { ...EN_ATTENTE, clos_le: '2026-11-10T10:00:00.000Z' }, /incomplet/],
      ['cloture_technique', { ...CLOS, clos_le: null }, /incomplet/],
    ];
    for (const [commande, candidat, motif] of cas) {
      const b = banc();
      const avant = b.octets();
      assert.throws(() => envoi(b, A, commande, candidat), motif, `${commande} ${JSON.stringify(candidat)}`);
      assert.ok(b.octets().equals(avant), `${commande} : journal inchangé`);
    }
    const b = banc();
    assert.throws(() => envoi(b, A, 'suppression'), /commande inconnue/);
    assert.throws(() => V.preparerEnvoi(A, 'emission', { preexistantes: [], listingComplet: true }, b.deps), /lecture absente/);
  });
  test('listing des exécutions préexistantes incomplet ou hors schéma : aucun envoi', () => {
    const b = banc();
    assert.throws(() => V.preparerEnvoi(A, 'emission', { candidat: null, preexistantes: [], listingComplet: false }, b.deps), /listing incomplet/);
    assert.throws(() => V.preparerEnvoi(A, 'emission', { candidat: null, preexistantes: ['12a'], listingComplet: true }, b.deps), /hors schéma/);
    assert.equal(b.lignes().length, 1);
  });
  test('clôture technique répétée sur candidat déjà clos : clos_le à conserver, deja_clos exigé', () => {
    const b = banc();
    const p = envoi(b, A, 'cloture_technique', CLOS);
    assert.equal(p.attendu.clos_le, CLOS.clos_le);
    assert.equal(V.conclure(p.tentative_id, 'accepte', { reponse: { statut: 'clos', deja_clos: true } }, b.deps).issue, 'accepte');
  });
});

describe('diagnostic : rattachement par EXCLUSION, sans horloge', () => {
  const ouvrir = (commande = 'emission', candidat = null, pre = ['5']) => {
    const b = banc();
    const p = envoi(b, A, commande, candidat, pre);
    V.conclure(p.tentative_id, 'indetermine', { motif: 'delai' }, b.deps);
    return { b, id: p.tentative_id };
  };
  const diag = (b, id, executions, candidat, listingComplet = true) => V.diagnostiquer(id, { executions, candidat, listingComplet }, b.deps);
  test('listing incomplet ou candidat non relu : rien n\'est levé, aucune écriture', () => {
    const { b, id } = ouvrir();
    const avant = b.octets();
    assert.equal(diag(b, id, [exec('6')], EN_ATTENTE, false).leve, false);
    assert.equal(V.diagnostiquer(id, { executions: [exec('6')], listingComplet: true }, b.deps).leve, false);
    assert.ok(b.octets().equals(avant));
  });
  test('ZÉRO exécution nouvelle (en transit / purgée) : maintenu', () => {
    const { b, id } = ouvrir();
    assert.match(diag(b, id, [exec('5')], EN_ATTENTE).raison, /aucune exécution nouvelle/);
    assert.equal(etatLot(b, A), 'ouverte');
  });
  test('PLUSIEURS exécutions nouvelles : ambiguïté, maintenu', () => {
    const { b, id } = ouvrir();
    assert.match(diag(b, id, [exec('6'), exec('7')], EN_ATTENTE).raison, /ambiguïté/);
  });
  test('exécution nouvelle à l\'entrée illisible : comptée candidate, jamais levée', () => {
    const { b, id } = ouvrir();
    assert.match(diag(b, id, [exec('6', { set_id: 'illisible' })], EN_ATTENTE).raison, /illisible/);
    assert.match(diag(b, id, [exec('6', { set_id: null }), exec('7')], EN_ATTENTE).raison, /2 exécutions/);
  });
  test('exécution nouvelle en vol ou de statut inconnu (running, waiting, new, absent) : maintenu', () => {
    for (const statut of ['running', 'waiting', 'new', undefined, null]) {
      const { b, id } = ouvrir();
      assert.match(diag(b, id, [exec('6', { statut })], EN_ATTENTE).raison, /en vol/);
    }
  });
  test('exécutions d\'un AUTRE workflow ou d\'un AUTRE lot : ignorées', () => {
    const { b, id } = ouvrir();
    const r = diag(b, id, [exec('6', { workflow: 'cloturer' }), exec('8', { set_id: B }), exec('9')], EN_ATTENTE);
    assert.deepEqual([r.leve, r.issue, r.execution_id], [true, 'effet_conforme', '9']);
  });
  test('UNE exécution nouvelle terminale + candidat conforme : effet_conforme, lot libre', () => {
    const { b, id } = ouvrir();
    assert.equal(diag(b, id, [exec('5'), exec('6', { statut: 'error' })], EN_ATTENTE).issue, 'effet_conforme');
    assert.equal(V.decisionSignature(A, b.deps), 'poursuivre');
  });
  test('sans_effet : candidat inchangé (ou toujours absent) et exécution non-success ; lot libre', () => {
    const r1 = ouvrir('reemission', EN_ATTENTE);
    assert.equal(diag(r1.b, r1.id, [exec('6', { statut: 'error' })], { ...EN_ATTENTE, version: '8' }).issue, 'sans_effet');
    assert.equal(etatLot(r1.b, A), 'libre');
    const r2 = ouvrir();
    assert.equal(diag(r2.b, r2.id, [exec('6', { statut: 'crashed' })], null).issue, 'sans_effet');
  });
  test('C3 : émission + exécution error + candidat {} -> REFUS (incomplet ≠ absent), jamais sans_effet', () => {
    const { b, id } = ouvrir();
    assert.throws(() => diag(b, id, [exec('6', { statut: 'error' })], {}), /incomplet/);
    assert.equal(etatLot(b, A), 'ouverte');
  });
  test('C3 : clôture « clos » sans clos_le ni version -> refus ; clos_le CHANGÉ sur clôture répétée -> anomalie', () => {
    const r1 = ouvrir('cloture_technique', EN_ATTENTE);
    assert.throws(() => diag(r1.b, r1.id, [exec('6', { workflow: 'cloturer' })], { ...EN_ATTENTE, statut: 'clos', clos_le: null, version: null }), /incomplet/);
    const r2 = ouvrir('cloture_technique', CLOS);
    assert.equal(diag(r2.b, r2.id, [exec('6', { workflow: 'cloturer' })], { ...CLOS, clos_le: '2026-11-16T09:00:00.000Z' }).issue, 'anomalie');
    assert.equal(V.decisionSignature(A, r2.b.deps), 'abandon');
  });
  test('anomalie : success sans effet, ou effet non conforme -> lot BLOQUÉ, signature = abandon, autres lots libres', () => {
    for (const [cand, statut] of [[EN_ATTENTE, 'success'], [{ ...EN_ATTENTE, generation_cle: 3 }, 'error'], [null, 'error']]) {
      const { b, id } = ouvrir('reemission', EN_ATTENTE);
      assert.equal(diag(b, id, [exec('6', { statut })], cand).issue, 'anomalie');
      assert.throws(() => envoi(b, A, 'reemission', EN_ATTENTE), /bloqué définitivement/);
      assert.equal(V.decisionSignature(A, b.deps), 'abandon');
      envoi(b, B);
    }
  });
  test('clôture répétée, ancienne exécution réussie + état clos, POST en transit -> JAMAIS levé (horloge sans effet)', () => {
    const b = banc();
    V.conclure(envoi(b, A, 'cloture_technique', EN_ATTENTE, []).tentative_id, 'accepte', { reponse: { statut: 'clos', deja_clos: false } }, b.deps);
    const p2 = envoi(b, A, 'cloture_technique', CLOS, ['40']);
    b.deps.avancer(-3600e3);
    const r = V.diagnostiquer(p2.tentative_id, { executions: [exec('40', { workflow: 'cloturer' })], candidat: CLOS, listingComplet: true }, b.deps);
    assert.equal(r.leve, false);
    assert.equal(V.decisionSignature(A, b.deps), 'refus_temporaire');
  });
  test('diagnostic d\'une tentative déjà résolue : refus', () => {
    const { b, id } = ouvrir();
    diag(b, id, [exec('6')], EN_ATTENTE);
    assert.throws(() => diag(b, id, [exec('6')], EN_ATTENTE), /non ouverte/);
  });
});

describe('C1 : qualification UNIQUE — la relecture recalcule chaque issue depuis ses preuves', () => {
  const t1 = '1'.padStart(32, '0');
  const ouvertA = (commande = 'emission', cand = null, pre = ['5']) => { const b = banc(); envoi(b, A, commande, cand, pre); return b; };
  const corrompu = (b) => { assert.equal(V.lireEtat(b.deps.verrous).sain, false); assert.throws(() => V.decisionSignature(B, b.deps), /inutilisable/); };
  test('accepte forgé (génération 999, statut abandonne) -> journal corrompu, jamais « poursuivre »', () => {
    const b = ouvertA();
    ajouterLigne(b, { type: 'accepte', set_id: A, tentative_id: t1, reponse: { generation_cle: 999, statut: 'abandonne', version: null, deja_clos: null } });
    corrompu(b);
  });
  test('accepte forgé à réponse vide -> corrompu', () => {
    const b = ouvertA();
    ajouterLigne(b, { type: 'accepte', set_id: A, tentative_id: t1, reponse: { generation_cle: null, statut: null, version: null, deja_clos: null } });
    corrompu(b);
  });
  test('résolution sur exécution PRÉEXISTANTE -> corrompu', () => {
    const b = ouvertA();
    ajouterLigne(b, { type: 'resolution', set_id: A, tentative_id: t1, issue: 'effet_conforme', execution_id: '5', execution_statut: 'success', apres: EN_ATTENTE });
    corrompu(b);
  });
  test('résolution à statut d\'exécution null, ou candidat absent déclaré « effet_conforme » -> corrompu', () => {
    const b1 = ouvertA();
    ajouterLigne(b1, { type: 'resolution', set_id: A, tentative_id: t1, issue: 'effet_conforme', execution_id: '6', execution_statut: null, apres: EN_ATTENTE });
    corrompu(b1);
    const b2 = ouvertA();
    ajouterLigne(b2, { type: 'resolution', set_id: A, tentative_id: t1, issue: 'effet_conforme', execution_id: '6', execution_statut: 'success', apres: null });
    corrompu(b2);
  });
  test('résolution « sans_effet » alors que l\'exécution est success -> corrompu ; la ligne honnête est admise', () => {
    const b = ouvertA('reemission', EN_ATTENTE);
    const honnete = { type: 'resolution', set_id: A, tentative_id: t1, issue: 'anomalie', execution_id: '6', execution_statut: 'success', apres: EN_ATTENTE };
    const ligne = (o) => Buffer.from(`${JSON.stringify({ v: 1, le: '2026-11-16T10:00:00.000Z', ...o })}\n`);
    assert.equal(V.analyser(Buffer.concat([b.octets(), ligne(honnete)])).sain, true);
    assert.equal(V.analyser(Buffer.concat([b.octets(), ligne({ ...honnete, issue: 'sans_effet' })])).sain, false);
  });
});

describe('journal : octets, schéma fermé, réparation', () => {
  const L = (o) => `${JSON.stringify({ v: 1, le: '2026-11-16T10:00:00.000Z', ...o })}\n`;
  const INIT = L({ type: 'init', schema: 'journal-relecture/v1' });
  const t1 = '1'.padStart(32, '0');
  const ATT = { fichier_id: null, generation_cle: 1, statut: 'en_attente', clos_le: null };
  const ENV = { type: 'envoi', set_id: A, tentative_id: t1, commande: 'emission', workflow: 'emettre', avant: null, preexistantes: [], attendu: ATT };
  test('clé INCONNUE, type inconnu, valeur hors schéma : ligne illisible -> journal corrompu', () => {
    for (const ligne of [
      L({ type: 'indetermine', set_id: A, tentative_id: t1, motif: 'delai', note: 'x' }),
      L({ type: 'commentaire' }),
      L({ type: 'indetermine', set_id: A, tentative_id: t1, motif: 'autre' }),
    ]) {
      const b = banc();
      assert.equal(envoi(b).tentative_id, t1);
      assert.equal(V.analyser(Buffer.concat([b.octets(), Buffer.from(L({ type: 'indetermine', set_id: A, tentative_id: t1, motif: 'delai' }))])).sain, true, 'contrôle');
      fs.appendFileSync(b.journal, ligne);
      assert.equal(V.lireEtat(b.deps.verrous).sain, false);
      assert.throws(() => envoi(b, B), /inutilisable/);
    }
  });
  test('en-tête absent, init en double, transition interdite, issue orpheline : corrompu', () => {
    const acc = L({ type: 'accepte', set_id: A, tentative_id: t1, reponse: { generation_cle: 1, statut: 'en_attente', version: null, deja_clos: null } });
    for (const contenu of [L(ENV), INIT + INIT, INIT + L(ENV) + acc + acc, INIT + acc, INIT + L(ENV) + L(ENV)]) {
      assert.equal(V.analyser(Buffer.from(contenu)).sain, false, contenu);
    }
    assert.equal(V.analyser(Buffer.from(INIT + L(ENV) + acc)).sain, true);
  });
  test('envoi incohérent (attendu falsifié, workflow ≠ commande, préexistantes non triées, avant {} au lieu de null) : corrompu', () => {
    for (const env of [{ ...ENV, attendu: { ...ATT, generation_cle: 2 } }, { ...ENV, workflow: 'cloturer' }, { ...ENV, preexistantes: ['7', '3'] },
      { ...ENV, avant: { fichier_id: null, version: null, generation_cle: null, statut: null, clos_le: null } }]) {
      assert.equal(V.analyser(Buffer.from(INIT + L(env))).sain, false, JSON.stringify(env));
    }
  });
  test('C7 : date impossible (mois 13) : ligne ILLISIBLE (aucune exception), réparable', () => {
    const b = banc();
    fs.appendFileSync(b.journal, `${JSON.stringify({ v: 1, type: 'indetermine', le: '2026-13-16T10:00:00.000Z', set_id: A, tentative_id: t1, motif: 'delai' })}\n`);
    const a = V.lireEtat(b.deps.verrous);
    assert.deepEqual([a.sain, a.illisibles], [false, [1]]);
    V.reparer(b.deps);
    assert.equal(etatLot(b, A), 'bloque');
  });
  test('TRONQUÉ : refus total ; réparation = original copié, fin de ligne ajoutée, lot de la portion BLOQUÉ', () => {
    const b = banc();
    const p = envoi(b);
    fs.appendFileSync(b.journal, `{"v":1,"type":"accepte","le":"2026-11-16T10:00:00.000Z","set_id":"${A}","tent`);
    const original = b.octets();
    assert.throws(() => envoi(b, B), /tronquée/);
    assert.throws(() => V.decisionSignature(B, b.deps), /tronquée/);
    const r = V.reparer(b.deps);
    assert.ok(fs.readFileSync(path.join(b.deps.verrous, r.copie)).equals(original), 'original conservé intact');
    assert.ok(b.octets().subarray(0, original.length).equals(original), 'rien d\'effacé ni réécrit');
    assert.equal(V.decisionSignature(A, b.deps), 'abandon');
    V.diagnostiquer(p.tentative_id, { executions: [exec('6')], candidat: EN_ATTENTE, listingComplet: true }, b.deps);
    assert.equal(etatLot(b, A), 'bloque', 'un diagnostic conforme ne débloque pas un lot touché par une perte');
    envoi(b, B);
  });
  test('portion perdue SANS set_id récupérable : TOUS les lots bloqués (incident) jusqu\'à attribution par Éric', () => {
    const b = banc();
    fs.appendFileSync(b.journal, '{"v":1,"type":"env\xff\n');
    V.reparer(b.deps);
    assert.deepEqual(V.lireEtat(b.deps.verrous).pertesNonAttribuees, [1]);
    assert.throws(() => envoi(b, B), /TOUS les lots/);
    assert.equal(V.decisionSignature(B, b.deps), 'incident');
    assert.throws(() => V.attribuerPerte(1, [A], b.deps), /aucune portion/);
    V.attribuerPerte(2, [A], b.deps);
    assert.equal(V.decisionSignature(A, b.deps), 'abandon');
    assert.equal(V.decisionSignature(B, b.deps), 'poursuivre');
    envoi(b, B);
    assert.throws(() => V.attribuerPerte(2, [B], b.deps), /aucune portion/, 'une seule attribution');
  });
  test('C4 : réparation désignant B pour un fragment portant A -> corrompu (A n\'est jamais autorisé à tort)', () => {
    const b = banc();
    fs.appendFileSync(b.journal, `{"v":1,"type":"envoi","le":"2026-11-16T10:00:00.000Z","set_id":"${A}","tentative_id":"${t1}"\n`);
    const frag = b.octets().toString('utf8').trim().split('\n')[1];
    ajouterLigne(b, { type: 'reparation', ligne: 1, sha256: V.sha256(Buffer.from(frag)), set_ids: [B] });
    assert.equal(V.lireEtat(b.deps.verrous).sain, false);
    assert.throws(() => V.decisionSignature(A, b.deps), /inutilisable/);
  });
  test('C4 : réparation visant une ligne VALIDE, mauvais SHA, ligne future, ou désignation double -> corrompu', () => {
    const base = () => { const b = banc(); fs.appendFileSync(b.journal, 'xx\n'); return b; };
    const shaXX = V.sha256(Buffer.from('xx'));
    const cas = [
      { ligne: 0, sha256: V.sha256(Buffer.from(INIT.trim())), set_ids: null },
      { ligne: 1, sha256: '0'.repeat(64), set_ids: null },
      { ligne: 5, sha256: shaXX, set_ids: null },
    ];
    for (const rep of cas) {
      const b = base();
      ajouterLigne(b, { type: 'reparation', ligne: 1, sha256: shaXX, set_ids: null }); // désignation LÉGITIME de « xx »
      assert.equal(V.lireEtat(b.deps.verrous).sain, true, 'contrôle');
      ajouterLigne(b, { type: 'reparation', ...rep }); // puis une désignation incohérente : jamais ignorée
      assert.equal(V.lireEtat(b.deps.verrous).sain, false, JSON.stringify(rep));
    }
    const b = base();
    ajouterLigne(b, { type: 'reparation', ligne: 1, sha256: shaXX, set_ids: null });
    assert.equal(V.lireEtat(b.deps.verrous).sain, true, 'contrôle : désignation unique cohérente admise');
    ajouterLigne(b, { type: 'reparation', ligne: 1, sha256: shaXX, set_ids: null });
    assert.equal(V.lireEtat(b.deps.verrous).sain, false);
    const b2 = base();
    ajouterLigne(b2, { type: 'attribution', ligne: 1, sha256: shaXX, set_ids: [A] });
    assert.equal(V.lireEtat(b2.deps.verrous).sain, false, 'attribution sans réparation préalable');
  });
  test('C6 : issue orpheline AVANT le fragment perdu -> corrompu ; APRÈS, tid concordant -> tolérée (lot bloqué) ; tid différent -> corrompu', () => {
    const orph = { type: 'indetermine', set_id: A, tentative_id: t1, motif: 'delai' };
    const fragment = (tid) => `{"v":1,"type":"envoi","le":"2026-11-16T10:00:00.000Z","set_id":"${A}","tentative_id":"${tid}"`;
    const designer = (b, idx, frag) => ajouterLigne(b, { type: 'reparation', ligne: idx, sha256: V.sha256(Buffer.from(frag)), set_ids: [A] });
    const b1 = banc();
    ajouterLigne(b1, orph); fs.appendFileSync(b1.journal, `${fragment(t1)}\n`); designer(b1, 2, fragment(t1));
    assert.equal(V.lireEtat(b1.deps.verrous).sain, false, 'perte postérieure');
    const b2 = banc();
    fs.appendFileSync(b2.journal, `${fragment(t1)}\n`); ajouterLigne(b2, orph); designer(b2, 1, fragment(t1));
    assert.equal(V.lireEtat(b2.deps.verrous).sain, true);
    assert.equal(etatLot(b2, A), 'bloque');
    const t2 = '2'.padStart(32, '0');
    const b3 = banc();
    fs.appendFileSync(b3.journal, `${fragment(t2)}\n`); ajouterLigne(b3, orph); designer(b3, 1, fragment(t2));
    assert.equal(V.lireEtat(b3.deps.verrous).sain, false, 'tentative_id récupérable discordant');
  });
  test('T-c : copie de l\'original INTERROMPUE -> aucun fichier final partiel ; la relance reprend', () => {
    const b = banc();
    fs.appendFileSync(b.journal, 'xx');
    let appels = 0;
    const panne = { ...b.deps, ecrire: (fd, buf, off, len) => { appels += 1; if (appels === 1) { fs.writeSync(fd, buf, off, 3); throw new Error('coupure'); } return fs.writeSync(fd, buf, off, len); } };
    assert.throws(() => V.reparer(panne), /coupure/);
    assert.deepEqual(fs.readdirSync(b.deps.verrous).filter((f) => /original-[0-9a-f]{64}$/.test(f)), [], 'pas de copie finale partielle');
    const r = V.reparer(b.deps);
    assert.ok(r.copie);
    assert.equal(V.lireEtat(b.deps.verrous).sain, true);
  });
  test('réparation relancée : idempotente ; copie divergente -> refus', () => {
    const b = banc();
    fs.appendFileSync(b.journal, 'xx');
    V.reparer(b.deps);
    V.reparer(b.deps);
    assert.equal(V.lireEtat(b.deps.verrous).sain, true);
    fs.writeFileSync(path.join(b.deps.verrous, `relecture.journal.original-${V.sha256(b.octets())}`), 'autre');
    assert.throws(() => V.reparer(b.deps), /divergente/);
  });
  test('réparation d\'un journal absent ou vide : refus (jamais réinitialisé)', () => {
    const b = banc();
    fs.writeFileSync(b.journal, '');
    assert.throws(() => V.reparer(b.deps), /absent ou vide/);
  });
  test('écritures COURTES reprises jusqu\'au dernier octet ; écriture nulle -> refus', () => {
    const b = banc();
    const morceaux = [];
    envoi({ deps: { ...b.deps, ecrire: (fd, buf, off, len) => { const n = Math.min(3, len); morceaux.push(n); return fs.writeSync(fd, buf, off, n); } } });
    assert.ok(morceaux.length > 10);
    assert.equal(V.lireEtat(b.deps.verrous).sain, true);
    assert.throws(() => envoi({ deps: { ...b.deps, ecrire: () => 0 } }, B), /0 octet/);
  });
});

describe('C8 : confinement — sentinelles dans CHAQUE champ autorisé, formats réels des secrets', () => {
  // Formats réels : k, secret HMAC et jetons de webhook = `openssl rand -hex 32` (64 hex) ; clé d'API n8n = JWT.
  const S = {
    k: 'a1'.repeat(32), hmac: 'b2c3'.repeat(16), jeton: 'D4E5'.repeat(16),
    cleApi: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZW50aW5lbGxlIn0.c2VudGluZWxsZQ', adresse: 'sentinelle.relecteur@exemple.invalid',
  };
  const toutes = Object.values(S);
  const fuite = (texte) => toutes.filter((s) => texte.includes(s));
  const essayer = (f) => { try { return { ok: f() }; } catch (e) { return { err: e.message }; } };
  test('chaque sentinelle injectée dans chaque champ persistable : refusée sans écho, ou jamais persistée', () => {
    for (const s of toutes) {
      const b = banc();
      const sorties = [];
      const champs = [
        () => V.preparerEnvoi(s, 'emission', { candidat: null, preexistantes: [], listingComplet: true }, b.deps),
        () => envoi(b, A, 'reemission', { ...EN_ATTENTE, fichier_id: s }),
        () => envoi(b, A, 'reemission', { ...EN_ATTENTE, version: s }),
        () => envoi(b, A, 'reemission', { ...EN_ATTENTE, statut: s }),
        () => envoi(b, A, 'cloture_technique', { ...CLOS, clos_le: s }),
        () => envoi(b, A, 'reemission', { ...EN_ATTENTE, generation_cle: s }),
        () => V.preparerEnvoi(A, 'emission', { candidat: null, preexistantes: [s], listingComplet: true }, b.deps),
        () => V.preparerEnvoi(A, s, { candidat: null, preexistantes: [], listingComplet: true }, b.deps),
        () => V.conclure(s, 'accepte', { reponse: REP_EMISSION }, b.deps),
        () => V.attribuerPerte(1, [s], b.deps),
        () => V.decisionSignature(s, b.deps),
      ];
      for (const f of champs) sorties.push(essayer(f));
      const p = envoi(b, B);
      sorties.push(essayer(() => V.conclure(p.tentative_id, 'accepte', { reponse: { ...REP_EMISSION, version: s, statut: s } }, b.deps)));
      const p2 = envoi(b, A, 'reemission', EN_ATTENTE, ['5']);
      sorties.push(essayer(() => V.conclure(p2.tentative_id, 'refuse_sans_effet', { http: 409, motif_refus: s }, b.deps)));
      sorties.push(essayer(() => V.conclure(p2.tentative_id, 'indetermine', { motif: s }, b.deps)));
      V.conclure(p2.tentative_id, 'indetermine', { motif: 'delai' }, b.deps);
      sorties.push(essayer(() => V.diagnostiquer(p2.tentative_id, { executions: [exec(s)], candidat: EN_ATTENTE, listingComplet: true }, b.deps)));
      sorties.push(essayer(() => V.diagnostiquer(p2.tentative_id, { executions: [exec('6', { set_id: s, workflow: s, statut: s })], candidat: EN_ATTENTE, listingComplet: true }, b.deps)));
      sorties.push(essayer(() => V.diagnostiquer(p2.tentative_id, { executions: [exec('7', { statut: 'error' })], candidat: { ...EN_ATTENTE, fichier_id: s }, listingComplet: true }, b.deps)));
      sorties.push(V.lireEtat(b.deps.verrous));
      assert.deepEqual(fuite(b.octets().toString('latin1')), [], `journal (${s})`);
      assert.deepEqual(fuite(JSON.stringify(sorties)), [], `sorties et messages (${s})`);
      assert.deepEqual(fs.readdirSync(b.deps.verrous).flatMap((f) => fuite(`${f}\n${fs.readFileSync(path.join(b.deps.verrous, f), 'latin1')}`)), [], `fichiers (${s})`);
    }
  });
  test('champs supplémentaires porteurs de secrets (enveloppe, réponse, exécution) : jamais persistés, jamais rendus', () => {
    const b = banc();
    const sorties = [];
    const candidat = { ...EN_ATTENTE, k: S.k, envois: [{ envoye_a: S.adresse }], cle_sha256: S.hmac };
    const p = V.preparerEnvoi(A, 'reemission', { candidat, preexistantes: ['5'], listingComplet: true, jeton: S.jeton }, b.deps);
    sorties.push(p, V.conclure(p.tentative_id, 'indetermine', { motif: 'delai', erreur: `401 ${S.cleApi}` }, b.deps));
    const executions = [{ id: '6', set_id: A, workflow: 'emettre', statut: 'error', data: { k: S.k, headers: { 'X-N8N-API-KEY': S.cleApi }, secret: S.hmac } }];
    sorties.push(V.diagnostiquer(p.tentative_id, { executions, candidat: { ...EN_ATTENTE, generation_cle: 2, lien: `?k=${S.k}` }, listingComplet: true }, b.deps));
    sorties.push(V.decisionSignature(A, b.deps), V.lireEtat(b.deps.verrous));
    const p2 = envoi(b, B);
    sorties.push(V.conclure(p2.tentative_id, 'accepte', { reponse: { ...REP_EMISSION, k: S.k, envoye_a: S.adresse, jeton: S.jeton } }, b.deps));
    assert.deepEqual(fuite(b.octets().toString('latin1')), [], 'journal');
    assert.deepEqual(fuite(JSON.stringify(sorties)), [], 'sorties');
  });
});

// --- Processus RÉELS sous /usr/bin/lockf -----------------------------------------------------
const lockfDisponible = fs.existsSync('/usr/bin/lockf');
function enfant(conf, { attendre = true } = {}) {
  const env = { ...process.env, FONDA_TEST_CONF: JSON.stringify(conf) };
  if (attendre) return spawnSync(process.execPath, [ENFANT], { env, encoding: 'utf8' });
  return spawn(process.execPath, [ENFANT], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
}
const attendreFichier = async (p, ms = 5000) => { const t0 = Date.now(); while (!fs.existsSync(p)) { if (Date.now() - t0 > ms) throw new Error(`attente ${p}`); await new Promise((r) => setTimeout(r, 20)); } };
const tuerGroupe = (c) => { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* déjà mort */ } };

describe('processus réels (lockf)', { skip: !lockfDisponible && 'lockf absent (CI Linux) : à rejouer sur le Mac' }, () => {
  const base = () => {
    const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'relecture-p-')));
    const r = { verrous: d, trace: path.join(d, 'trace'), pret: path.join(d, 'pret'), go: path.join(d, 'go') };
    assert.equal(enfant({ action: 'init', verrous: d }).status, 0);
    return r;
  };
  const posts = (b) => (fs.existsSync(b.trace) ? fs.readFileSync(b.trace, 'utf8').trim().split('\n').length : 0);

  test('nominal : verrou pris PAR le processus, envoi puis accepte, lot libre', () => {
    const b = base();
    const r = enfant({ action: 'envoi', setId: A, verrous: b.verrous, trace: b.trace });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(posts(b), 1);
    assert.equal(V.lireEtat(b.verrous).lots[A].etat, 'libre');
  });
  test('MÊME lot, deux processus concurrents : le second échoue AUSSITÔT (75), un seul POST', async () => {
    const b = base();
    const premier = enfant({ action: 'envoi', setId: A, verrous: b.verrous, trace: b.trace, barriere: { pret: b.pret, go: b.go } }, { attendre: false });
    try {
      await attendreFichier(b.pret);
      for (const conf of [{ action: 'envoi', setId: A }, { action: 'signature', setId: A }, { action: 'reparer' }, { action: 'init' }]) {
        const second = enfant({ ...conf, verrous: b.verrous, trace: b.trace });
        assert.equal(second.status, V.OCCUPE, `${conf.action} : ${second.stderr}`);
        assert.match(second.stderr, /tient le verrou/);
      }
      fs.writeFileSync(b.go, '');
      await new Promise((r) => premier.on('exit', r));
    } finally { tuerGroupe(premier); }
    assert.equal(posts(b), 1);
  });
  test('portée retenue = verrou UNIQUE : une commande sur un AUTRE lot échoue aussi (75) pendant la détention', async () => {
    const b = base();
    const premier = enfant({ action: 'envoi', setId: A, verrous: b.verrous, trace: b.trace, barriere: { pret: b.pret, go: b.go } }, { attendre: false });
    try {
      await attendreFichier(b.pret);
      assert.equal(enfant({ action: 'envoi', setId: B, verrous: b.verrous, trace: b.trace }).status, V.OCCUPE);
      fs.writeFileSync(b.go, '');
      await new Promise((r) => premier.on('exit', r));
    } finally { tuerGroupe(premier); }
  });
  test('aucun superviseur : pendant la détention, aucun processus lockf enfant ne survit', async () => {
    const b = base();
    const premier = enfant({ action: 'tenir', verrous: b.verrous, barriere: { pret: b.pret, go: b.go } }, { attendre: false });
    try {
      await attendreFichier(b.pret);
      const ps = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout;
      assert.ok(!ps.split('\n').some((l) => /\/usr\/bin\/lockf/.test(l) && l.trim().split(/\s+/)[1] === String(premier.pid)));
      assert.equal(enfant({ action: 'signature', setId: A, verrous: b.verrous }).status, V.OCCUPE);
      fs.writeFileSync(b.go, '');
      await new Promise((r) => premier.on('exit', r));
    } finally { tuerGroupe(premier); }
  });
  test('T-a : kill -9 APRÈS le POST parti : verrou libéré ; même lot refusé, autre lot autorisé ; arrivée tardive rattachée par le diagnostic', async () => {
    const b = base();
    const premier = enfant({ action: 'envoi', setId: A, preexistantes: ['5'], verrous: b.verrous, trace: b.trace, barriere: { pret: b.pret, go: b.go } }, { attendre: false });
    await attendreFichier(b.pret);
    assert.equal(posts(b), 1, 'le POST de A est parti avant la mort');
    process.kill(premier.pid, 'SIGKILL');
    await new Promise((r) => premier.on('exit', r));
    const a = V.lireEtat(b.verrous);
    assert.equal(a.lots[A].etat, 'ouverte', 'envoi sans issue = indéterminé');
    const meme = enfant({ action: 'envoi', setId: A, verrous: b.verrous, trace: b.trace });
    assert.equal(meme.status, 1);
    assert.match(meme.stderr, /diagnostic requis/);
    assert.equal(JSON.parse(enfant({ action: 'signature', setId: A, verrous: b.verrous }).stdout).decision, 'refus_temporaire');
    const autre = enfant({ action: 'envoi', setId: B, verrous: b.verrous, trace: b.trace });
    assert.equal(autre.status, 0, autre.stderr);
    assert.equal(posts(b), 2, 'A (parti) puis B ; jamais de second POST de A');
    // La requête de A arrive plus tard côté n8n : seul le diagnostic, sous le verrou, la rattache.
    const tenu = V.prendreVerrou(b.verrous);
    try {
      const deps = { verrous: b.verrous, sousVerrou: tenu.chemin };
      const tid = a.lots[A].ouverte;
      assert.equal(V.diagnostiquer(tid, { executions: [exec('5')], candidat: null, listingComplet: true }, deps).leve, false, 'pas encore arrivée');
      assert.equal(V.diagnostiquer(tid, { executions: [exec('5'), exec('6')], candidat: EN_ATTENTE, listingComplet: true }, deps).issue, 'effet_conforme');
    } finally { fs.closeSync(tenu.fd); }
  });
  test('exclusion GLOBALE du journal : réparation tenue -> tout ajout et toute init échouent (75)', async () => {
    const b = base();
    fs.appendFileSync(path.join(b.verrous, 'relecture.journal'), 'xx');
    const rep = enfant({ action: 'reparer', verrous: b.verrous, barriere: { pret: b.pret, go: b.go } }, { attendre: false });
    try {
      await attendreFichier(b.pret);
      for (const conf of [{ action: 'envoi', setId: B }, { action: 'reparer' }, { action: 'init' }]) assert.equal(enfant({ ...conf, verrous: b.verrous, trace: b.trace }).status, V.OCCUPE);
      fs.writeFileSync(b.go, '');
      await new Promise((r) => rep.on('exit', r));
    } finally { tuerGroupe(rep); }
    assert.equal(V.lireEtat(b.verrous).sain, true);
  });
});
