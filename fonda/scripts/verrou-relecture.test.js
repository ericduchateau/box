// Tests du verrou « un seul écrivain » de la relecture (CDC §21.12, P5-1, arbitrage (A)).
// Deux niveaux : (1) logique en processus (schéma fermé, machine à états, qualification unique sur la
// SORTIE réelle des workflows, journal d'abord, rattachement par exclusion, réparation, signature,
// sentinelles champ par champ) ; (2) PROCESSUS RÉELS sous /usr/bin/lockf avec un VRAI serveur HTTP local
// (onReceived : 200 « reçu », exécution en retard).
// Chaque constat des relectures Codex de P5-1 est reproduit par un test nommé (C…, R2-…, T-…).
// Usage : node --test fonda/scripts/verrou-relecture.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const V = require('./verrou-relecture.js');

const A = 'set_fonda_nombres-fractions-relatifs_nI_02';
const B = 'set_fonda_resolution-problemes_nI_02';
const ENFANT = path.join(__dirname, 'fixtures', 'verrou-relecture-enfant.js');
const FICHIER = 'fichierCandidatA0123456789';
const AUTRE_FICHIER = 'fichierCandidatZ9876543210';
const PREMIER_CLOS = '2026-11-10T10:00:00.000Z';
const EN_ATTENTE = { fichier_id: FICHIER, version: '7', generation_cle: 1, statut: 'en_attente', clos_le: null };
const CLOS = { ...EN_ATTENTE, version: '9', statut: 'clos', clos_le: PREMIER_CLOS };
// Sorties RÉELLES (verbatim des exports de production) : toutes les clés présentes.
const sortieE = (o = {}) => ({ schema: 'emission-fonda/v1', set_id: A, candidat_fichier_id: FICHIER, relecteur_attribue: 'eric', generation_cle: 1, reemission: false, ...o });
const sortieC = (o = {}) => ({ schema: 'cloture-fonda/v1', set_id: A, clos_le: PREMIER_CLOS, deja_clos: false, candidat_fichier_id: FICHIER, nb_decisions_listees: 0, incomplete_search: false, ...o });

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
const exec = (id, o = {}) => ({ id, set_id: A, workflow: 'emettre', statut: 'success', sortie: sortieE(), ...o });
const execC = (id, o = {}) => exec(id, { workflow: 'cloturer', sortie: sortieC(), ...o });
const diag = (b, id, executions, candidat, listingComplet = true) => V.diagnostiquer(id, { executions, candidat, listingComplet }, b.deps);
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
  test('init : en-tête unique + témoin de création ; jamais réinitialisé (même sans témoin)', () => {
    const b = banc();
    assert.deepEqual(b.lignes(), [{ v: 1, type: 'init', le: '2026-11-16T10:00:00.000Z', schema: 'journal-relecture/v1' }]);
    assert.ok(fs.existsSync(`${b.journal}.cree`));
    assert.throws(() => V.initialiser(b.deps), /jamais réinitialisé/);
    fs.unlinkSync(`${b.journal}.cree`);
    assert.throws(() => V.initialiser(b.deps), /journal déjà présent/);
  });
  test('C5 : journal SUPPRIMÉ après un envoi -> init refusée (témoin) ; idem si une copie original-* subsiste', () => {
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

describe('journal d\'abord et machine à états (A) : un 200 ne conclut rien', () => {
  test('envoi écrit AVANT le POST, schéma exact, issue attendue propre à la commande', () => {
    const b = banc();
    const p = envoi(b, A, 'emission', null, ['12', '3']);
    const l = b.lignes()[1];
    assert.deepEqual(Object.keys(l), ['v', 'type', 'le', 'set_id', 'tentative_id', 'commande', 'workflow', 'avant', 'preexistantes', 'attendu']);
    assert.equal(l.avant, null, 'absence établie = null');
    assert.deepEqual(l.preexistantes, ['3', '12'], 'triés numériquement, uniques');
    assert.deepEqual(p.attendu, { fichier_id: null, generation_cle: 1, statut: 'en_attente', clos_le: null });
    assert.equal(etatLot(b, A), 'ouverte', 'après le POST (200 = reçu), le lot reste ouvert jusqu\'au diagnostic');
  });
  test('T-b : échec de fsync injecté -> preparerEnvoi lève, AUCUN POST ne part (le POST suit son retour)', () => {
    const b = banc();
    let posts = 0;
    const appelant = (deps) => { V.preparerEnvoi(A, 'emission', { candidat: null, preexistantes: [], listingComplet: true }, deps); posts += 1; };
    assert.throws(() => appelant({ ...b.deps, fsync: () => { throw new Error('EIO'); } }), /EIO/);
    assert.equal(posts, 0);
    assert.notEqual(etatLot(b, A), 'libre', 'ligne écrite sans garantie : le lot reste fermé (prudence)');
  });
  test('(A) : un 2xx n\'est pas une issue ; « accepte » n\'existe plus ; seules refuse_sans_effet et indetermine se concluent sans diagnostic', () => {
    const b = banc();
    const p = envoi(b);
    for (const http200 of [200, 201, 204]) assert.throws(() => V.conclure(p.tentative_id, 'refuse_sans_effet', { http: http200 }, b.deps), /reçu, jamais exécuté/);
    assert.throws(() => V.conclure(p.tentative_id, 'accepte', { reponse: sortieE() }, b.deps), /issue inconnue/);
    assert.equal(etatLot(b, A), 'ouverte');
  });
  test('refuse_sans_effet : 403 (authentification) et 404 (workflow inactif) seulement -> lot libre ; tout autre code -> indetermine', () => {
    for (const [code, motif] of [[403, 'non_autorise'], [404, 'workflow_inactif']]) {
      const b = banc();
      assert.equal(V.conclure(envoi(b).tentative_id, 'refuse_sans_effet', { http: code }, b.deps).issue, 'refuse_sans_effet');
      assert.equal(b.lignes().at(-1).motif_refus, motif);
      assert.equal(etatLot(b, A), 'libre');
    }
    for (const donnees of [{ http: 500 }, { http: 400 }, { http: 409 }, { http: 302 }, {}, null]) {
      const b = banc();
      assert.equal(V.conclure(envoi(b).tentative_id, 'refuse_sans_effet', donnees, b.deps).issue, 'indetermine', JSON.stringify(donnees));
      assert.equal(b.lignes().at(-1).motif, 'erreur_serveur');
      assert.equal(V.decisionSignature(A, b.deps), 'refus_temporaire');
    }
  });
  test('refuse_sans_effet forgé (code ≠ motif) -> journal corrompu', () => {
    const b = banc();
    const p = envoi(b);
    ajouterLigne(b, { type: 'refuse_sans_effet', set_id: A, tentative_id: p.tentative_id, http: 403, motif_refus: 'workflow_inactif' });
    assert.equal(V.lireEtat(b.deps.verrous).sain, false);
  });
  for (const motif of ['delai', 'transport', 'reponse_illisible', 'erreur_serveur']) {
    test(`indetermine (${motif}) : MÊME lot refusé, AUTRE lot autorisé ; signature = refus temporaire`, () => {
      const b = banc();
      V.conclure(envoi(b).tentative_id, 'indetermine', { motif }, b.deps);
      assert.throws(() => envoi(b), /diagnostic requis/);
      assert.equal(V.decisionSignature(A, b.deps), 'refus_temporaire');
      envoi(b, B);
    });
  }
  test('tentative déjà conclue, inconnue ou id invalide : refus', () => {
    const b = banc();
    const p = envoi(b);
    V.conclure(p.tentative_id, 'refuse_sans_effet', { http: 403 }, b.deps);
    assert.throws(() => V.conclure(p.tentative_id, 'indetermine', { motif: 'delai' }, b.deps), /déjà conclue/);
    assert.throws(() => V.conclure('f'.repeat(32), 'indetermine', { motif: 'delai' }, b.deps), /inconnue/);
    assert.throws(() => V.conclure('xyz', 'indetermine', { motif: 'delai' }, b.deps), /invalide/);
    assert.throws(() => V.conclure(envoi(b, B).tentative_id, 'indetermine', { motif: 'autre' }, b.deps), /motif/);
  });
  test('C3/R2-5 : pré-conditions ; « absent » = null ; candidat incomplet, {} ou SANS clé clos_le -> refus AVANT écriture', () => {
    const { clos_le: _, ...sansClosLe } = EN_ATTENTE;
    const cas = [
      ['emission', EN_ATTENTE, /existe déjà/], ['reemission', null, /absent/], ['reemission', CLOS, /non en_attente/],
      ['cloture_technique', { ...EN_ATTENTE, statut: 'abandonne' }, /abandonné/], ['cloture_technique', { ...EN_ATTENTE, version: null }, /hors schéma/],
      ['emission', {}, /incomplet/], ['reemission', sansClosLe, /incomplet/], ['reemission', { ...EN_ATTENTE, clos_le: PREMIER_CLOS }, /hors schéma/],
      ['cloture_technique', { ...CLOS, clos_le: null }, /hors schéma/],
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
  test('listing des exécutions préexistantes incomplet, hors schéma ou NON CANONIQUE (R2-4 : « 040 ») : aucun envoi', () => {
    const b = banc();
    assert.throws(() => V.preparerEnvoi(A, 'emission', { candidat: null, preexistantes: [], listingComplet: false }, b.deps), /listing incomplet/);
    for (const id of ['12a', '040', '00', '-1', '']) assert.throws(() => V.preparerEnvoi(A, 'emission', { candidat: null, preexistantes: [id], listingComplet: true }, b.deps), /hors schéma/, id);
    assert.equal(b.lignes().length, 1);
    envoi(b, A, 'emission', null, ['0', '40']);
  });
});

describe('diagnostic (A) : exclusion, SORTIE réelle du workflow, candidat relu', () => {
  const ouvrir = (commande = 'emission', candidat = null, pre = ['5']) => {
    const b = banc();
    const p = envoi(b, A, commande, candidat, pre);
    return { b, id: p.tentative_id };
  };
  test('nominal par commande : sortie + candidat concordants -> effet_conforme, lot libre, signature « poursuivre »', () => {
    const cas = [
      ['emission', null, exec('6'), EN_ATTENTE],
      ['reemission', EN_ATTENTE, exec('6', { sortie: sortieE({ generation_cle: 2, reemission: true }) }), { ...EN_ATTENTE, generation_cle: 2, version: '9' }],
      ['cloture_technique', EN_ATTENTE, execC('6', { sortie: sortieC({ clos_le: '2026-11-16T10:00:00.000Z' }) }), { ...EN_ATTENTE, statut: 'clos', clos_le: '2026-11-16T10:00:00.000Z' }],
      ['cloture_technique', CLOS, execC('6', { sortie: sortieC({ deja_clos: true }) }), CLOS],
    ];
    for (const [commande, avant, e, apres] of cas) {
      const { b, id } = ouvrir(commande, avant);
      assert.equal(diag(b, id, [e], apres).issue, 'effet_conforme', commande);
      assert.equal(V.decisionSignature(A, b.deps), 'poursuivre');
      assert.deepEqual(Object.keys(b.lignes().at(-1).sortie).sort(), commande === 'cloture_technique'
        ? ['candidat_fichier_id', 'clos_le', 'deja_clos', 'schema', 'set_id'] : ['candidat_fichier_id', 'generation_cle', 'reemission', 'schema', 'set_id'], 'clés persistées seulement');
    }
  });
  test('sortie NON conforme (chaque champ, à la lettre) -> anomalie, lot bloqué', () => {
    const E2 = { ...EN_ATTENTE, generation_cle: 2 };
    const cas = [
      ['emission', null, exec('6', { sortie: sortieE({ schema: 'cloture-fonda/v1' }) }), EN_ATTENTE],
      ['emission', null, exec('6', { sortie: sortieE({ set_id: B }) }), EN_ATTENTE],
      ['emission', null, exec('6', { sortie: sortieE({ generation_cle: 2 }) }), EN_ATTENTE],
      ['emission', null, exec('6', { sortie: sortieE({ reemission: true }) }), EN_ATTENTE],
      ['emission', null, exec('6', { sortie: sortieE({ candidat_fichier_id: AUTRE_FICHIER }) }), EN_ATTENTE], // identité : sortie ≠ candidat relu
      ['reemission', EN_ATTENTE, exec('6', { sortie: sortieE({ generation_cle: 2, reemission: false }) }), E2],
      ['reemission', EN_ATTENTE, exec('6', { sortie: sortieE({ generation_cle: 2, reemission: true, candidat_fichier_id: AUTRE_FICHIER }) }), E2],
      ['cloture_technique', EN_ATTENTE, execC('6', { sortie: sortieC({ deja_clos: true }) }), CLOS],
      ['cloture_technique', EN_ATTENTE, execC('6', { sortie: sortieC({ candidat_fichier_id: AUTRE_FICHIER }) }), CLOS],
      ['cloture_technique', EN_ATTENTE, execC('6'), { ...CLOS, clos_le: '2026-11-16T10:00:00.000Z' }], // candidat relu ≠ sortie
      ['emission', null, exec('6', { sortie: (({ relecteur_attribue: _, ...s }) => s)(sortieE()) }), EN_ATTENTE], // clé réelle absente
      ['emission', null, exec('6', { sortie: undefined }), EN_ATTENTE], // success sans sortie
    ];
    for (const [commande, avant, e, apres] of cas) {
      const { b, id } = ouvrir(commande, avant);
      assert.equal(diag(b, id, [e], apres).issue, 'anomalie', `${commande} ${JSON.stringify(e.sortie)}`);
      assert.equal(V.decisionSignature(A, b.deps), 'abandon');
    }
  });
  test('R2-1 : clôture répétée, sortie Cloturer portant un clos_le ≠ le premier -> anomalie (jamais « poursuivre »)', () => {
    const { b, id } = ouvrir('cloture_technique', CLOS);
    const nouveau = '2026-11-16T10:00:00.000Z';
    assert.equal(diag(b, id, [execC('6', { sortie: sortieC({ deja_clos: true, clos_le: nouveau }) })], { ...CLOS, clos_le: nouveau }).issue, 'anomalie');
    assert.equal(V.decisionSignature(A, b.deps), 'abandon');
    const r2 = ouvrir('cloture_technique', CLOS);
    assert.equal(diag(r2.b, r2.id, [execC('6', { sortie: sortieC({ deja_clos: true }) })], { ...CLOS, clos_le: nouveau }).issue, 'anomalie', 'candidat relu changé');
  });
  test('sans_effet : exécution en erreur (pas de sortie) et candidat inchangé ou toujours absent ; lot libre', () => {
    const r1 = ouvrir('reemission', EN_ATTENTE);
    assert.equal(diag(r1.b, r1.id, [exec('6', { statut: 'error', sortie: undefined })], { ...EN_ATTENTE, version: '8' }).issue, 'sans_effet');
    assert.equal(etatLot(r1.b, A), 'libre');
    const r2 = ouvrir();
    assert.equal(diag(r2.b, r2.id, [exec('6', { statut: 'crashed', sortie: undefined })], null).issue, 'sans_effet');
  });
  test('erreur APRÈS écriture (candidat changé) -> anomalie ; success sans effet -> anomalie', () => {
    const r1 = ouvrir('reemission', EN_ATTENTE);
    assert.equal(diag(r1.b, r1.id, [exec('6', { statut: 'error', sortie: undefined })], { ...EN_ATTENTE, generation_cle: 2 }).issue, 'anomalie');
    const r2 = ouvrir('reemission', EN_ATTENTE);
    assert.equal(diag(r2.b, r2.id, [exec('6', { sortie: sortieE({ generation_cle: 2, reemission: true }) })], EN_ATTENTE).issue, 'anomalie');
    assert.throws(() => envoi(r2.b, A, 'reemission', EN_ATTENTE), /bloqué définitivement/);
    envoi(r2.b, B);
  });
  test('listing incomplet ou candidat non relu : rien n\'est levé, aucune écriture', () => {
    const { b, id } = ouvrir();
    const avant = b.octets();
    assert.equal(diag(b, id, [exec('6')], EN_ATTENTE, false).leve, false);
    assert.equal(V.diagnostiquer(id, { executions: [exec('6')], listingComplet: true }, b.deps).leve, false);
    assert.ok(b.octets().equals(avant));
  });
  test('ZÉRO exécution nouvelle : maintenu ; PLUSIEURS : ambiguïté ; entrée illisible : candidate, jamais levée', () => {
    const { b, id } = ouvrir();
    assert.match(diag(b, id, [exec('5')], EN_ATTENTE).raison, /aucune exécution nouvelle/);
    assert.match(diag(b, id, [exec('6'), exec('7')], EN_ATTENTE).raison, /ambiguïté/);
    assert.match(diag(b, id, [exec('6', { set_id: 'illisible' })], EN_ATTENTE).raison, /illisible/);
    assert.match(diag(b, id, [exec('6', { set_id: null }), exec('7')], EN_ATTENTE).raison, /2 exécutions/);
    assert.equal(etatLot(b, A), 'ouverte');
  });
  test('exécution nouvelle en vol ou de statut inconnu : maintenu', () => {
    for (const statut of ['running', 'waiting', 'new', undefined, null]) {
      const { b, id } = ouvrir();
      assert.match(diag(b, id, [exec('6', { statut })], EN_ATTENTE).raison, /en vol/);
    }
  });
  test('exécutions d\'un AUTRE workflow ou d\'un AUTRE lot : ignorées', () => {
    const { b, id } = ouvrir();
    const r = diag(b, id, [execC('6'), exec('8', { set_id: B }), exec('9')], EN_ATTENTE);
    assert.deepEqual([r.leve, r.issue, r.execution_id], [true, 'effet_conforme', '9']);
  });
  test('R2-4 : id d\'exécution non canonique (« 040 » pour 40) -> refus, jamais pris pour une exécution nouvelle', () => {
    const b = banc();
    const p = envoi(b, A, 'cloture_technique', CLOS, ['40']);
    assert.throws(() => diag(b, p.tentative_id, [execC('040', { sortie: sortieC({ deja_clos: true }) })], CLOS), /hors schéma/);
    assert.equal(V.decisionSignature(A, b.deps), 'refus_temporaire');
  });
  test('clôture répétée, ancienne exécution + état clos, POST en transit -> JAMAIS levé (horloge sans effet)', () => {
    const b = banc();
    const p1 = envoi(b, A, 'cloture_technique', EN_ATTENTE, []);
    diag(b, p1.tentative_id, [execC('40', { sortie: sortieC() })], CLOS);
    const p2 = envoi(b, A, 'cloture_technique', CLOS, ['40']);
    b.deps.avancer(-3600e3);
    assert.equal(diag(b, p2.tentative_id, [execC('40')], CLOS).leve, false);
    assert.equal(V.decisionSignature(A, b.deps), 'refus_temporaire');
  });
  test('C3 : candidat {} ou incomplet au diagnostic -> refus, lot toujours ouvert', () => {
    const { b, id } = ouvrir();
    assert.throws(() => diag(b, id, [exec('6', { statut: 'error', sortie: undefined })], {}), /incomplet/);
    assert.equal(etatLot(b, A), 'ouverte');
  });
  test('diagnostic d\'une tentative déjà résolue : refus', () => {
    const { b, id } = ouvrir();
    diag(b, id, [exec('6')], EN_ATTENTE);
    assert.throws(() => diag(b, id, [exec('6')], EN_ATTENTE), /non ouverte/);
  });
});

describe('C1 : qualification UNIQUE — la relecture recalcule chaque résolution depuis ses preuves', () => {
  const t1 = '1'.padStart(32, '0');
  const ouvertA = (commande = 'emission', cand = null, pre = ['5']) => { const b = banc(); envoi(b, A, commande, cand, pre); return b; };
  const RES = { type: 'resolution', set_id: A, tentative_id: t1, issue: 'effet_conforme', execution_id: '6', execution_statut: 'success', sortie: { schema: 'emission-fonda/v1', set_id: A, candidat_fichier_id: FICHIER, generation_cle: 1, reemission: false }, apres: EN_ATTENTE };
  const sain = (b, o) => V.analyser(Buffer.concat([b.octets(), Buffer.from(`${JSON.stringify({ v: 1, le: '2026-11-16T10:00:00.000Z', ...o })}\n`)])).sain;
  test('contrôle : la résolution honnête est admise', () => { assert.equal(sain(ouvertA(), RES), true); });
  for (const [nom, o] of [
    ['exécution PRÉEXISTANTE', { execution_id: '5' }],
    ['statut d\'exécution null', { execution_statut: null }],
    ['statut d\'exécution null, issue pourtant recalculable (anomalie)', { execution_statut: null, issue: 'anomalie', sortie: null }],
    ['candidat absent déclaré conforme', { apres: null }],
    ['sortie forgée (génération 999)', { sortie: { ...RES.sortie, generation_cle: 999 } }],
    ['sortie d\'un autre lot', { sortie: { ...RES.sortie, set_id: B } }],
    ['sortie null déclarée conforme', { sortie: null }],
    ['sortie avec clé en plus', { sortie: { ...RES.sortie, relecteur_attribue: 'eric' } }],
    ['« sans_effet » malgré success', { issue: 'sans_effet', apres: null }],
    ['« effet_conforme » sur exécution en erreur', { execution_statut: 'error' }],
  ]) {
    test(`résolution forgée (${nom}) -> journal corrompu, jamais « poursuivre »`, () => {
      const b = ouvertA();
      assert.equal(sain(b, { ...RES, ...o }), false);
      ajouterLigne(b, { ...RES, ...o });
      assert.throws(() => V.decisionSignature(A, b.deps), /inutilisable/);
    });
  }
});

describe('journal : octets, schéma fermé, réparation', () => {
  const L = (o) => `${JSON.stringify({ v: 1, le: '2026-11-16T10:00:00.000Z', ...o })}\n`;
  const INIT = L({ type: 'init', schema: 'journal-relecture/v1' });
  const t1 = '1'.padStart(32, '0');
  const t2 = '2'.padStart(32, '0');
  const ATT = { fichier_id: null, generation_cle: 1, statut: 'en_attente', clos_le: null };
  const ENV = { type: 'envoi', set_id: A, tentative_id: t1, commande: 'emission', workflow: 'emettre', avant: null, preexistantes: [], attendu: ATT };
  const fragment = (tid, s = A) => `{"v":1,"type":"envoi","le":"2026-11-16T10:00:00.000Z","set_id":"${s}","tentative_id":"${tid}"`;
  const designer = (b, idx, frag, setIds = [A]) => ajouterLigne(b, { type: 'reparation', ligne: idx, sha256: V.sha256(Buffer.from(frag)), set_ids: setIds });
  test('clé INCONNUE, type inconnu (dont l\'ancien « accepte »), valeur hors schéma : ligne illisible -> corrompu', () => {
    for (const ligne of [
      L({ type: 'indetermine', set_id: A, tentative_id: t1, motif: 'delai', note: 'x' }),
      L({ type: 'accepte', set_id: A, tentative_id: t1, reponse: {} }),
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
  test('en-tête absent, init en double, transition interdite, issue orpheline sans perte : corrompu', () => {
    const ind = L({ type: 'indetermine', set_id: A, tentative_id: t1, motif: 'delai' });
    const ref = L({ type: 'refuse_sans_effet', set_id: A, tentative_id: t1, http: 403, motif_refus: 'non_autorise' });
    for (const contenu of [L(ENV), INIT + INIT, INIT + L(ENV) + ref + ind, INIT + ind, INIT + L(ENV) + L(ENV)]) {
      assert.equal(V.analyser(Buffer.from(contenu)).sain, false, contenu);
    }
    assert.equal(V.analyser(Buffer.from(INIT + L(ENV) + ind)).sain, true);
  });
  test('envoi incohérent (attendu falsifié, workflow ≠ commande, préexistantes non triées ou non canoniques, avant {}) : corrompu', () => {
    for (const env of [{ ...ENV, attendu: { ...ATT, generation_cle: 2 } }, { ...ENV, workflow: 'cloturer' }, { ...ENV, preexistantes: ['7', '3'] },
      { ...ENV, preexistantes: ['040'] }, { ...ENV, avant: { fichier_id: null, version: null, generation_cle: null, statut: null, clos_le: null } }]) {
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
    fs.appendFileSync(b.journal, `{"v":1,"type":"indetermine","le":"2026-11-16T10:00:00.000Z","set_id":"${A}","tent`);
    const original = b.octets();
    assert.throws(() => envoi(b, B), /tronquée/);
    assert.throws(() => V.decisionSignature(B, b.deps), /tronquée/);
    const r = V.reparer(b.deps);
    assert.ok(fs.readFileSync(path.join(b.deps.verrous, r.copie)).equals(original), 'original conservé intact');
    assert.ok(b.octets().subarray(0, original.length).equals(original), 'rien d\'effacé ni réécrit');
    assert.equal(V.decisionSignature(A, b.deps), 'abandon');
    diag(b, p.tentative_id, [exec('6')], EN_ATTENTE);
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
  test('C4 : réparation désignant B pour un fragment portant A -> corrompu', () => {
    const b = banc();
    fs.appendFileSync(b.journal, `${fragment(t1)}\n`);
    designer(b, 1, fragment(t1), [B]);
    assert.equal(V.lireEtat(b.deps.verrous).sain, false);
    assert.throws(() => V.decisionSignature(A, b.deps), /inutilisable/);
  });
  test('C4 : en plus d\'une désignation légitime, une réparation sur ligne VALIDE, mauvais SHA, ligne future ou double -> corrompu', () => {
    const shaXX = V.sha256(Buffer.from('xx'));
    const base = () => { const b = banc(); fs.appendFileSync(b.journal, 'xx\n'); ajouterLigne(b, { type: 'reparation', ligne: 1, sha256: shaXX, set_ids: null }); assert.equal(V.lireEtat(b.deps.verrous).sain, true, 'contrôle'); return b; };
    for (const rep of [{ ligne: 0, sha256: V.sha256(Buffer.from(INIT.trim())), set_ids: null }, { ligne: 1, sha256: '0'.repeat(64), set_ids: null }, { ligne: 9, sha256: shaXX, set_ids: null }, { ligne: 1, sha256: shaXX, set_ids: null }]) {
      const b = base();
      ajouterLigne(b, { type: 'reparation', ...rep });
      assert.equal(V.lireEtat(b.deps.verrous).sain, false, JSON.stringify(rep));
    }
    const b2 = banc();
    fs.appendFileSync(b2.journal, 'xx\n');
    ajouterLigne(b2, { type: 'attribution', ligne: 1, sha256: shaXX, set_ids: [A] });
    assert.equal(V.lireEtat(b2.deps.verrous).sain, false, 'attribution sans réparation préalable');
  });
  test('C6 : issue orpheline AVANT le fragment perdu -> corrompu ; APRÈS, identités concordantes -> tolérée (lot bloqué) ; tid différent -> corrompu', () => {
    const orph = { type: 'indetermine', set_id: A, tentative_id: t1, motif: 'delai' };
    const b1 = banc();
    ajouterLigne(b1, orph); fs.appendFileSync(b1.journal, `${fragment(t1)}\n`); designer(b1, 2, fragment(t1));
    assert.equal(V.lireEtat(b1.deps.verrous).sain, false, 'perte postérieure');
    const b2 = banc();
    fs.appendFileSync(b2.journal, `${fragment(t1)}\n`); ajouterLigne(b2, orph); designer(b2, 1, fragment(t1));
    assert.equal(V.lireEtat(b2.deps.verrous).sain, true);
    assert.equal(etatLot(b2, A), 'bloque');
    const b3 = banc();
    fs.appendFileSync(b3.journal, `${fragment(t2)}\n`); ajouterLigne(b3, orph); designer(b3, 1, fragment(t2));
    assert.equal(V.lireEtat(b3.deps.verrous).sain, false, 'tentative_id récupérable discordant');
  });
  test('R2-3 : tentative_id concordant mais set_id CONTRADICTOIRE -> corrompu ; deux issues orphelines incompatibles -> corrompu', () => {
    const b1 = banc();
    fs.appendFileSync(b1.journal, `${fragment(t1, A)}\n`); ajouterLigne(b1, { type: 'indetermine', set_id: B, tentative_id: t1, motif: 'delai' }); designer(b1, 1, fragment(t1, A));
    assert.equal(V.lireEtat(b1.deps.verrous).sain, false);
    const ref = { type: 'refuse_sans_effet', set_id: A, tentative_id: t1, http: 403, motif_refus: 'non_autorise' };
    const b2 = banc();
    fs.appendFileSync(b2.journal, `${fragment(t1)}\n`); ajouterLigne(b2, ref); designer(b2, 1, fragment(t1));
    assert.equal(V.lireEtat(b2.deps.verrous).sain, true, 'contrôle : une orpheline admise');
    ajouterLigne(b2, ref);
    assert.equal(V.lireEtat(b2.deps.verrous).sain, false, 'deux issues orphelines identiques');
    const b3 = banc();
    fs.appendFileSync(b3.journal, `${fragment(t1)}\n`); ajouterLigne(b3, ref); ajouterLigne(b3, { ...ref, set_id: A, type: 'indetermine', motif: 'delai', http: undefined, motif_refus: undefined }); designer(b3, 1, fragment(t1));
    assert.equal(V.lireEtat(b3.deps.verrous).sain, false, 'refuse puis indetermine : transition interdite');
  });
  test('R2-2 : perte ancienne sur A puis opération historique VALIDE sur A -> réparation possible, A bloqué, B utilisable', () => {
    const b = banc();
    fs.appendFileSync(b.journal, `${fragment(t1)}\n`); // envoi de A endommagé
    ajouterLigne(b, { type: 'indetermine', set_id: A, tentative_id: t1, motif: 'delai' }); // son issue, orpheline
    ajouterLigne(b, { type: 'envoi', set_id: A, tentative_id: t2, commande: 'emission', workflow: 'emettre', avant: null, preexistantes: [], attendu: ATT }); // opération historique postérieure
    ajouterLigne(b, { type: 'refuse_sans_effet', set_id: A, tentative_id: t2, http: 404, motif_refus: 'workflow_inactif' });
    const r = V.reparer(b.deps);
    assert.equal(r.pertesNonAttribuees.length, 0);
    assert.equal(V.lireEtat(b.deps.verrous).sain, true);
    assert.equal(V.decisionSignature(A, b.deps), 'abandon');
    assert.equal(V.decisionSignature(B, b.deps), 'poursuivre');
    envoi(b, B);
  });
  test('T-c : copie de l\'original INTERROMPUE -> aucun fichier final partiel ; la relance reprend', () => {
    const b = banc();
    fs.appendFileSync(b.journal, 'xx');
    let appels = 0;
    const panne = { ...b.deps, ecrire: (fd, buf, off, len) => { appels += 1; if (appels === 1) { fs.writeSync(fd, buf, off, 3); throw new Error('coupure'); } return fs.writeSync(fd, buf, off, len); } };
    assert.throws(() => V.reparer(panne), /coupure/);
    assert.deepEqual(fs.readdirSync(b.deps.verrous).filter((f) => /original-[0-9a-f]{64}$/.test(f)), [], 'pas de copie finale partielle');
    assert.ok(V.reparer(b.deps).copie);
    assert.equal(V.lireEtat(b.deps.verrous).sain, true);
  });
  test('réparation relancée : idempotente ; copie divergente -> refus ; journal absent ou vide -> refus', () => {
    const b = banc();
    fs.appendFileSync(b.journal, 'xx');
    V.reparer(b.deps);
    V.reparer(b.deps);
    assert.equal(V.lireEtat(b.deps.verrous).sain, true);
    fs.writeFileSync(path.join(b.deps.verrous, `relecture.journal.original-${V.sha256(b.octets())}`), 'autre');
    assert.throws(() => V.reparer(b.deps), /divergente/);
    const b2 = banc();
    fs.writeFileSync(b2.journal, '');
    assert.throws(() => V.reparer(b2.deps), /absent ou vide/);
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

describe('C8 : confinement — sentinelles CHAMP PAR CHAMP, isolément, dans une entrée par ailleurs valide', () => {
  // Formats réels : k, secret HMAC et jetons de webhook = `openssl rand -hex 32` (64 hex) ; clé d'API n8n = JWT.
  const S = {
    k: 'a1'.repeat(32), hmac: 'b2c3'.repeat(16), jeton: 'D4E5'.repeat(16),
    cleApi: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZW50aW5lbGxlIn0.c2VudGluZWxsZQ', adresse: 'sentinelle.relecteur@exemple.invalid',
  };
  const fuite = (texte) => Object.values(S).filter((s) => texte.includes(s));
  // Chaque injection : f(b, valeur) ; appelée d'abord avec la valeur VALIDE (contrôle : l'entrée est
  // valide hors du champ visé), puis avec chaque sentinelle à la place de CE SEUL champ.
  const ouvert = (b, cmd = 'reemission', avant = EN_ATTENTE) => envoi(b, A, cmd, avant, ['5']).tentative_id;
  const INJ = {
    'set_id (envoi)': [A, (b, v) => V.preparerEnvoi(v, 'emission', { candidat: null, preexistantes: [], listingComplet: true }, b.deps)],
    commande: ['emission', (b, v) => V.preparerEnvoi(A, v, { candidat: null, preexistantes: [], listingComplet: true }, b.deps)],
    'avant.fichier_id': [FICHIER, (b, v) => envoi(b, A, 'reemission', { ...EN_ATTENTE, fichier_id: v })],
    'avant.version': ['7', (b, v) => envoi(b, A, 'reemission', { ...EN_ATTENTE, version: v })],
    'avant.generation_cle': [1, (b, v) => envoi(b, A, 'reemission', { ...EN_ATTENTE, generation_cle: v })],
    'avant.statut': ['en_attente', (b, v) => envoi(b, A, 'reemission', { ...EN_ATTENTE, statut: v })],
    'avant.clos_le': [PREMIER_CLOS, (b, v) => envoi(b, A, 'cloture_technique', { ...CLOS, clos_le: v })],
    preexistantes: ['5', (b, v) => V.preparerEnvoi(A, 'emission', { candidat: null, preexistantes: [v], listingComplet: true }, b.deps)],
    tentative_id: [null, (b, v) => V.conclure(v ?? ouvert(b), 'indetermine', { motif: 'delai' }, b.deps)],
    http: [403, (b, v) => V.conclure(ouvert(b), 'refuse_sans_effet', { http: v }, b.deps)],
    motif: ['delai', (b, v) => V.conclure(ouvert(b), 'indetermine', { motif: v }, b.deps)],
    'execution.id': ['6', (b, v) => diag(b, ouvert(b), [exec(v, { sortie: sortieE({ generation_cle: 2, reemission: true }) })], { ...EN_ATTENTE, generation_cle: 2 })],
    'execution.set_id': [A, (b, v) => diag(b, ouvert(b), [exec('6', { set_id: v, sortie: sortieE({ generation_cle: 2, reemission: true }) })], { ...EN_ATTENTE, generation_cle: 2 })],
    'execution.workflow': ['emettre', (b, v) => diag(b, ouvert(b), [exec('6', { workflow: v, sortie: sortieE({ generation_cle: 2, reemission: true }) })], { ...EN_ATTENTE, generation_cle: 2 })],
    'execution.statut': ['success', (b, v) => diag(b, ouvert(b), [exec('6', { statut: v, sortie: sortieE({ generation_cle: 2, reemission: true }) })], { ...EN_ATTENTE, generation_cle: 2 })],
    ...Object.fromEntries(['schema', 'set_id', 'candidat_fichier_id', 'relecteur_attribue', 'generation_cle', 'reemission'].map((k) => [`sortie.${k}`,
      [sortieE({ generation_cle: 2, reemission: true })[k], (b, v) => diag(b, ouvert(b), [exec('6', { sortie: sortieE({ generation_cle: 2, reemission: true, [k]: v }) })], { ...EN_ATTENTE, generation_cle: 2 })]])),
    ...Object.fromEntries(['clos_le', 'deja_clos', 'nb_decisions_listees', 'incomplete_search'].map((k) => [`sortie_cloture.${k}`,
      [sortieC()[k], (b, v) => diag(b, ouvert(b, 'cloture_technique'), [execC('6', { sortie: sortieC({ [k]: v }) })], CLOS)]])),
    ...Object.fromEntries(['fichier_id', 'version', 'generation_cle', 'statut', 'clos_le'].map((k) => [`apres.${k}`,
      [{ ...EN_ATTENTE, generation_cle: 2 }[k], (b, v) => diag(b, ouvert(b), [exec('6', { sortie: sortieE({ generation_cle: 2, reemission: true }) })], { ...EN_ATTENTE, generation_cle: 2, [k]: v })]])),
    'attribution.set_ids': [A, (b, v) => { fs.appendFileSync(b.journal, 'zz\n'); V.reparer(b.deps); return V.attribuerPerte(2, [v], b.deps); }],
    'signature.set_id': [A, (b, v) => V.decisionSignature(v, b.deps)],
  };
  for (const [champ, [valide, f]] of Object.entries(INJ)) {
    test(`champ ${champ} : contrôle valide, puis chaque sentinelle -> jamais persistée ni répétée`, () => {
      const b0 = banc();
      assert.doesNotThrow(() => f(b0, valide), 'contrôle : entrée valide hors du champ visé');
      for (const [nom, s] of Object.entries(S)) {
        const b = banc();
        let sortie;
        try { sortie = JSON.stringify(f(b, s) ?? null); } catch (e) { sortie = e.message; }
        assert.deepEqual(fuite(sortie), [], `${champ} = ${nom} : sortie ou message`);
        assert.deepEqual(fuite(b.octets().toString('latin1')), [], `${champ} = ${nom} : journal`);
        assert.deepEqual(fs.readdirSync(b.deps.verrous).flatMap((x) => fuite(`${x}\n${fs.readFileSync(path.join(b.deps.verrous, x), 'latin1')}`)), [], `${champ} = ${nom} : fichiers`);
        assert.deepEqual(fuite(JSON.stringify(V.lireEtat(b.deps.verrous))), [], `${champ} = ${nom} : état`);
      }
    });
  }
  test('champs SUPPLÉMENTAIRES porteurs de secrets (enveloppe, exécution, sortie) : jamais persistés', () => {
    const b = banc();
    const candidat = { ...EN_ATTENTE, k: S.k, envois: [{ envoye_a: S.adresse }], cle_sha256: S.hmac };
    const p = V.preparerEnvoi(A, 'reemission', { candidat, preexistantes: ['5'], listingComplet: true, jeton: S.jeton }, b.deps);
    const e = exec('6', { data: { k: S.k, headers: { 'X-N8N-API-KEY': S.cleApi } }, sortie: { ...sortieE({ generation_cle: 2, reemission: true }), lien: `?k=${S.k}`, adresse: S.adresse } });
    const r = diag(b, p.tentative_id, [e], { ...EN_ATTENTE, generation_cle: 2, lien: `?k=${S.k}` });
    assert.equal(r.issue, 'effet_conforme', 'les clés en plus de la sortie réelle sont ignorées, jamais persistées');
    assert.deepEqual(fuite(b.octets().toString('latin1') + JSON.stringify([p, r, V.lireEtat(b.deps.verrous)])), []);
  });
});

// --- Processus RÉELS sous /usr/bin/lockf, VRAI serveur HTTP local ------------------------------
const lockfDisponible = fs.existsSync('/usr/bin/lockf');
// Lancement ASYNCHRONE (la boucle d'événements du test reste libre : le serveur HTTP répond).
function lancer(conf, { detache = false } = {}) {
  const env = { ...process.env, FONDA_TEST_CONF: JSON.stringify(conf) };
  const c = spawn(process.execPath, [ENFANT], { env, detached: detache, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  c.fin = new Promise((r) => c.on('exit', (status) => r({ status, stdout, stderr })));
  return c;
}
const attendreFichier = async (p, ms = 8000) => { const t0 = Date.now(); while (!fs.existsSync(p)) { if (Date.now() - t0 > ms) throw new Error(`attente ${p}`); await new Promise((r) => setTimeout(r, 20)); } };
const tuerGroupe = (c) => { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* déjà mort */ } };
// Webhook simulé en mode onReceived : 200 IMMÉDIAT (« reçu ») ; l'exécution n'apparaît que plus tard.
function serveur() {
  const recus = [];
  const s = http.createServer((req, res) => { let corps = ''; req.on('data', (d) => { corps += d; }); req.on('end', () => { recus.push(JSON.parse(corps)); res.writeHead(200); res.end('{"message":"Workflow was started"}'); }); });
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${s.address().port}/webhook/fonda-emettre`, recus, fermer: () => new Promise((f) => s.close(f)) })));
}

describe('processus réels (lockf + HTTP)', { skip: !lockfDisponible && 'lockf absent (CI Linux) : à rejouer sur le Mac' }, () => {
  const base = async () => {
    const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'relecture-p-')));
    assert.equal((await lancer({ action: 'init', verrous: d }).fin).status, 0);
    return { verrous: d, pret: path.join(d, 'pret'), go: path.join(d, 'go') };
  };
  const sousVerrou = (verrous, fn) => { const t = V.prendreVerrou(verrous); try { return fn({ verrous, sousVerrou: t.chemin }); } finally { fs.closeSync(t.fd); } };

  test('nominal : vrai POST, 200 « reçu » -> tentative OUVERTE ; le diagnostic la conclut ensuite', async () => {
    const b = await base();
    const srv = await serveur();
    try {
      const r = await lancer({ action: 'envoi', setId: A, verrous: b.verrous, url: srv.url }).fin;
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(srv.recus, [{ set_id: A }]);
      assert.equal(V.lireEtat(b.verrous).lots[A].etat, 'ouverte', '200 ne conclut rien');
      const tid = JSON.parse(r.stdout).tentative_id;
      sousVerrou(b.verrous, (deps) => assert.equal(V.diagnostiquer(tid, { executions: [exec('6')], candidat: EN_ATTENTE, listingComplet: true }, deps).issue, 'effet_conforme'));
      assert.equal(V.lireEtat(b.verrous).lots[A].etat, 'libre');
    } finally { await srv.fermer(); }
  });
  test('MÊME lot, deux processus concurrents : le second échoue AUSSITÔT (75), un seul POST reçu', async () => {
    const b = await base();
    const srv = await serveur();
    const premier = lancer({ action: 'envoi', setId: A, verrous: b.verrous, url: srv.url, barriere: { pret: b.pret, go: b.go } }, { detache: true });
    try {
      await attendreFichier(b.pret);
      for (const conf of [{ action: 'envoi', setId: A, url: srv.url }, { action: 'envoi', setId: B, url: srv.url }, { action: 'signature', setId: A }, { action: 'reparer' }, { action: 'init' }]) {
        const second = await lancer({ ...conf, verrous: b.verrous }).fin;
        assert.equal(second.status, V.OCCUPE, `${conf.action} ${conf.setId || ''} : ${second.stderr}`);
        assert.match(second.stderr, /tient le verrou/);
      }
      fs.writeFileSync(b.go, '');
      await premier.fin;
    } finally { tuerGroupe(premier); await srv.fermer(); }
    assert.equal(srv.recus.length, 1);
  });
  test('aucun superviseur : pendant la détention, aucun processus lockf enfant ne survit', async () => {
    const b = await base();
    const premier = lancer({ action: 'tenir', verrous: b.verrous, barriere: { pret: b.pret, go: b.go } }, { detache: true });
    try {
      await attendreFichier(b.pret);
      const ps = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout;
      assert.ok(!ps.split('\n').some((l) => /\/usr\/bin\/lockf/.test(l) && l.trim().split(/\s+/)[1] === String(premier.pid)));
      assert.equal((await lancer({ action: 'signature', setId: A, verrous: b.verrous }).fin).status, V.OCCUPE);
      fs.writeFileSync(b.go, '');
      await premier.fin;
    } finally { tuerGroupe(premier); }
  });
  test('T-a : POST REÇU par un vrai serveur (200 immédiat), kill -9 du CLI, exécution en RETARD : même lot refusé, autre lot autorisé, rattachement après arrivée seulement', async () => {
    const b = await base();
    const srv = await serveur();
    try {
      const premier = lancer({ action: 'envoi', setId: A, preexistantes: ['5'], verrous: b.verrous, url: srv.url, barriere: { pret: b.pret, go: b.go } }, { detache: true });
      await attendreFichier(b.pret);
      assert.deepEqual(srv.recus, [{ set_id: A }], 'la requête de A a été reçue par le serveur');
      process.kill(premier.pid, 'SIGKILL');
      await premier.fin;
      const a = V.lireEtat(b.verrous);
      assert.equal(a.lots[A].etat, 'ouverte');
      const meme = await lancer({ action: 'envoi', setId: A, verrous: b.verrous, url: srv.url }).fin;
      assert.equal(meme.status, 1);
      assert.match(meme.stderr, /diagnostic requis/);
      assert.equal(JSON.parse((await lancer({ action: 'signature', setId: A, verrous: b.verrous }).fin).stdout).decision, 'refus_temporaire');
      const autre = await lancer({ action: 'envoi', setId: B, verrous: b.verrous, url: srv.url }).fin;
      assert.equal(autre.status, 0, autre.stderr);
      assert.deepEqual(srv.recus, [{ set_id: A }, { set_id: B }], 'jamais de second POST de A');
      const tid = a.lots[A].ouverte;
      const executions = [exec('5')]; // l'exécution de A n'est pas encore apparue côté n8n
      sousVerrou(b.verrous, (deps) => assert.equal(V.diagnostiquer(tid, { executions, candidat: null, listingComplet: true }, deps).leve, false));
      executions.push(exec('6', { statut: 'running', sortie: undefined })); // elle démarre, en retard
      sousVerrou(b.verrous, (deps) => assert.equal(V.diagnostiquer(tid, { executions, candidat: null, listingComplet: true }, deps).leve, false));
      executions[1] = exec('6'); // elle se termine
      sousVerrou(b.verrous, (deps) => assert.equal(V.diagnostiquer(tid, { executions, candidat: EN_ATTENTE, listingComplet: true }, deps).issue, 'effet_conforme'));
      assert.equal(V.lireEtat(b.verrous).lots[A].etat, 'libre');
    } finally { await srv.fermer(); }
  });
  test('exclusion GLOBALE du journal : réparation tenue -> tout ajout et toute init échouent (75)', async () => {
    const b = await base();
    fs.appendFileSync(path.join(b.verrous, 'relecture.journal'), 'xx');
    const rep = lancer({ action: 'reparer', verrous: b.verrous, barriere: { pret: b.pret, go: b.go } }, { detache: true });
    try {
      await attendreFichier(b.pret);
      for (const conf of [{ action: 'envoi', setId: B }, { action: 'reparer' }, { action: 'init' }]) assert.equal((await lancer({ ...conf, verrous: b.verrous }).fin).status, V.OCCUPE);
      fs.writeFileSync(b.go, '');
      await rep.fin;
    } finally { tuerGroupe(rep); }
    assert.equal(V.lireEtat(b.verrous).sain, true);
  });
});
