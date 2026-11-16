// Tests du verrou « un seul écrivain » de la relecture (CDC §21.12, P5-1).
// Deux niveaux : (1) logique en processus (schéma fermé, machine à états, journal d'abord, rattachement
// par exclusion, réparation, signature, sentinelles) ; (2) PROCESSUS RÉELS sous /usr/bin/lockf
// (concurrence, kill -9, exclusion globale du journal).
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

describe('exclusion et initialisation', () => {
  test('hors du verrou noyau : toute commande refuse, rien n\'est écrit', () => {
    const b = banc({ init: false });
    const hors = { ...b.deps, sousVerrou: undefined };
    assert.throws(() => V.initialiser(hors), /HORS du verrou/);
    assert.equal(fs.existsSync(b.journal), false);
    V.initialiser(b.deps);
    for (const f of [() => envoi({ deps: hors }), () => V.decisionSignature(A, hors), () => V.reparer(hors)]) assert.throws(f, /HORS du verrou/);
  });
  test('init : en-tête unique ; jamais réinitialisé', () => {
    const b = banc();
    assert.deepEqual(b.lignes(), [{ v: 1, type: 'init', le: '2026-11-16T10:00:00.000Z', schema: 'journal-relecture/v1' }]);
    assert.throws(() => V.initialiser(b.deps), /jamais réinitialisé/);
  });
  test('journal ABSENT après init (supprimé) ou VIDE : refus de toute écriture et de toute signature', () => {
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
  test('chemin canonique : deux chemins du même dossier (lien symbolique) désignent le même verrou', () => {
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
    assert.deepEqual(l.preexistantes, ['3', '12'], 'triés numériquement, uniques');
    assert.deepEqual(p.attendu, { fichier_id: null, generation_cle: 1, statut: 'en_attente' });
    assert.equal(etatLot(b, A), 'ouverte', 'envoi sans issue = indéterminé (lot ouvert)');
  });
  test('accepte : lot libre ; NON terminal pour le lot (opérations suivantes admises)', () => {
    const b = banc();
    const p1 = envoi(b);
    assert.equal(V.conclure(p1.tentative_id, 'accepte', { reponse: { generation_cle: 1, statut: 'en_attente' } }, b.deps).issue, 'accepte');
    assert.equal(etatLot(b, A), 'libre');
    const p2 = envoi(b, A, 'reemission', EN_ATTENTE);
    assert.deepEqual(p2.attendu, { fichier_id: FICHIER, generation_cle: 2, statut: 'en_attente' });
    V.conclure(p2.tentative_id, 'accepte', { reponse: { generation_cle: 2 } }, b.deps);
    const p3 = envoi(b, A, 'cloture_technique', { ...EN_ATTENTE, generation_cle: 2 });
    V.conclure(p3.tentative_id, 'accepte', { reponse: { statut: 'clos', deja_clos: false } }, b.deps);
    assert.equal(etatLot(b, A), 'libre');
  });
  test('refuse_sans_effet : lot libre ; nouvel envoi permis', () => {
    const b = banc();
    V.conclure(envoi(b).tentative_id, 'refuse_sans_effet', { http: 409 }, b.deps);
    assert.equal(etatLot(b, A), 'libre');
    envoi(b);
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
  test('réponse NON conforme à l\'issue attendue -> indetermine (reponse_non_conforme)', () => {
    for (const reponse of [{ generation_cle: 2 }, { statut: 'clos' }, { deja_clos: true }]) {
      const b = banc();
      const r = V.conclure(envoi(b).tentative_id, 'accepte', { reponse }, b.deps);
      assert.equal(r.issue, 'indetermine');
      assert.equal(b.lignes().at(-1).motif, 'reponse_non_conforme');
      assert.equal(etatLot(b, A), 'ouverte');
    }
  });
  test('tentative déjà conclue, inconnue ou id invalide : refus', () => {
    const b = banc();
    const p = envoi(b);
    V.conclure(p.tentative_id, 'refuse_sans_effet', { http: 400 }, b.deps);
    assert.throws(() => V.conclure(p.tentative_id, 'indetermine', { motif: 'delai' }, b.deps), /déjà conclue/);
    assert.throws(() => V.conclure('f'.repeat(32), 'accepte', { reponse: {} }, b.deps), /inconnue/);
    assert.throws(() => V.conclure('xyz', 'accepte', { reponse: {} }, b.deps), /invalide/);
    assert.throws(() => V.conclure(envoi(b).tentative_id, 'reussi', {}, b.deps), /issue inconnue/);
  });
  test('pré-conditions par commande : refus AVANT toute écriture', () => {
    const cas = [
      ['emission', EN_ATTENTE, /existe déjà/], ['reemission', null, /absent/], ['reemission', CLOS, /non en_attente/],
      ['cloture_technique', { ...EN_ATTENTE, statut: 'abandonne' }, /abandonné/], ['cloture_technique', { ...EN_ATTENTE, version: null }, /incomplet/],
    ];
    for (const [commande, candidat, motif] of cas) {
      const b = banc();
      const avant = b.octets();
      assert.throws(() => envoi(b, A, commande, candidat), motif);
      assert.ok(b.octets().equals(avant), `${commande} : journal inchangé`);
    }
    const b = banc();
    assert.throws(() => envoi(b, A, 'suppression'), /commande inconnue/);
  });
  test('listing des exécutions préexistantes incomplet ou hors schéma : aucun envoi', () => {
    const b = banc();
    assert.throws(() => V.preparerEnvoi(A, 'emission', { candidat: null, preexistantes: [], listingComplet: false }, b.deps), /listing incomplet/);
    assert.throws(() => V.preparerEnvoi(A, 'emission', { candidat: null, preexistantes: ['12a'], listingComplet: true }, b.deps), /hors schéma/);
    assert.equal(b.lignes().length, 1);
  });
  test('clôture technique répétée sur candidat déjà clos : issue attendue = clos (deja_clos admis)', () => {
    const b = banc();
    const p = envoi(b, A, 'cloture_technique', CLOS);
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
  const NOUVEAU = { ...EN_ATTENTE };
  test('listing incomplet : rien n\'est levé, aucune écriture', () => {
    const { b, id } = ouvrir();
    const avant = b.octets();
    assert.equal(diag(b, id, [exec('6')], NOUVEAU, false).leve, false);
    assert.ok(b.octets().equals(avant));
  });
  test('ZÉRO exécution nouvelle (en transit / purgée) : maintenu', () => {
    const { b, id } = ouvrir();
    assert.match(diag(b, id, [exec('5')], NOUVEAU).raison, /aucune exécution nouvelle/);
    assert.equal(etatLot(b, A), 'ouverte');
  });
  test('PLUSIEURS exécutions nouvelles : ambiguïté, maintenu', () => {
    const { b, id } = ouvrir();
    assert.match(diag(b, id, [exec('6'), exec('7')], NOUVEAU).raison, /ambiguïté/);
  });
  test('exécution nouvelle à l\'entrée illisible (set_id inconnu) : comptée candidate, jamais levée', () => {
    const { b, id } = ouvrir();
    assert.match(diag(b, id, [exec('6', { set_id: 'illisible' })], NOUVEAU).raison, /illisible/);
    assert.match(diag(b, id, [exec('6', { set_id: null }), exec('7')], NOUVEAU).raison, /2 exécutions/);
  });
  test('exécution nouvelle encore en vol (running / waiting / inconnu) : maintenu', () => {
    for (const statut of ['running', 'waiting', 'new', undefined]) {
      const { b, id } = ouvrir();
      assert.match(diag(b, id, [exec('6', { statut })], NOUVEAU).raison, /en vol/);
    }
  });
  test('exécutions d\'un AUTRE workflow ou d\'un AUTRE lot : ignorées', () => {
    const { b, id } = ouvrir();
    const r = diag(b, id, [exec('6', { workflow: 'cloturer' }), exec('8', { set_id: B }), exec('9')], NOUVEAU);
    assert.deepEqual([r.leve, r.issue, r.execution_id], [true, 'effet_conforme', '9']);
  });
  test('UNE exécution nouvelle terminale + candidat conforme : effet_conforme, lot libre', () => {
    const { b, id } = ouvrir();
    assert.equal(diag(b, id, [exec('5'), exec('6', { statut: 'error' })], NOUVEAU).issue, 'effet_conforme');
    assert.equal(etatLot(b, A), 'libre');
    assert.equal(V.decisionSignature(A, b.deps), 'poursuivre');
  });
  test('sans_effet : candidat inchangé et exécution non-success ; lot libre', () => {
    const { b, id } = ouvrir('reemission', EN_ATTENTE);
    assert.equal(diag(b, id, [exec('6', { statut: 'error' })], { ...EN_ATTENTE, version: '8' }).issue, 'sans_effet');
    assert.equal(etatLot(b, A), 'libre');
  });
  test('anomalie : success sans effet, ou effet non conforme -> lot BLOQUÉ définitivement, signature = abandon', () => {
    for (const [cand, statut] of [[EN_ATTENTE, 'success'], [{ ...EN_ATTENTE, generation_cle: 3 }, 'error']]) {
      const { b, id } = ouvrir('reemission', EN_ATTENTE);
      assert.equal(diag(b, id, [exec('6', { statut })], cand).issue, 'anomalie');
      assert.equal(etatLot(b, A), 'bloque');
      assert.throws(() => envoi(b, A, 'reemission', EN_ATTENTE), /bloqué définitivement/);
      assert.equal(V.decisionSignature(A, b.deps), 'abandon');
      envoi(b, B); // autres lots : aucun blocage du seul fait de cet état
    }
  });
  test('Codex 3e relecture : clôture répétée, ancienne exécution réussie + état clos, POST en transit -> JAMAIS levé', () => {
    const b = banc();
    const p1 = envoi(b, A, 'cloture_technique', EN_ATTENTE, []);
    V.conclure(p1.tentative_id, 'accepte', { reponse: { statut: 'clos' } }, b.deps);
    const anciennes = [exec('40', { workflow: 'cloturer' })]; // la 1re clôture, désormais préexistante
    const p2 = envoi(b, A, 'cloture_technique', CLOS, ['40']);
    b.deps.avancer(-3600e3); // horloge du Mac décalée d'une heure EN ARRIÈRE : sans effet
    const r = V.diagnostiquer(p2.tentative_id, { executions: anciennes, candidat: CLOS, listingComplet: true }, b.deps);
    assert.equal(r.leve, false);
    assert.equal(V.decisionSignature(A, b.deps), 'refus_temporaire');
  });
  test('diagnostic d\'une tentative déjà résolue ou conclue : refus', () => {
    const { b, id } = ouvrir();
    diag(b, id, [exec('6')], NOUVEAU);
    assert.throws(() => diag(b, id, [exec('6')], NOUVEAU), /non ouverte/);
  });
});

describe('journal : octets, schéma fermé, réparation', () => {
  const L = (o) => `${JSON.stringify({ v: 1, le: '2026-11-16T10:00:00.000Z', ...o })}\n`;
  const INIT = L({ type: 'init', schema: 'journal-relecture/v1' });
  test('clé INCONNUE, type inconnu, valeur hors schéma : ligne illisible -> journal corrompu', () => {
    const t1 = '1'.padStart(32, '0'); // tentative RÉELLE (envoi écrit) : seule la ligne testée est fautive
    for (const ligne of [
      L({ type: 'indetermine', set_id: A, tentative_id: t1, motif: 'delai', note: 'x' }),
      L({ type: 'commentaire' }),
      L({ type: 'indetermine', set_id: A, tentative_id: t1, motif: 'autre' }),
    ]) {
      const b = banc();
      assert.equal(envoi(b).tentative_id, t1);
      const temoin = L({ type: 'indetermine', set_id: A, tentative_id: t1, motif: 'delai' });
      assert.equal(V.analyser(Buffer.concat([b.octets(), Buffer.from(temoin)])).sain, true, 'contrôle : la ligne conforme est admise');
      fs.appendFileSync(b.journal, ligne);
      assert.equal(V.lireEtat(b.deps.verrous).sain, false);
      assert.throws(() => envoi(b, B), /inutilisable/);
    }
  });
  test('en-tête absent, init en double, transition interdite, issue orpheline : corrompu', () => {
    const t1 = '1'.padStart(32, '0');
    const env = L({ type: 'envoi', set_id: A, tentative_id: t1, commande: 'emission', workflow: 'emettre', avant: { fichier_id: null, version: null, generation_cle: null, statut: null, clos_le: null }, preexistantes: [], attendu: { fichier_id: null, generation_cle: 1, statut: 'en_attente' } });
    const acc = L({ type: 'accepte', set_id: A, tentative_id: t1, reponse: { generation_cle: null, statut: null, version: null, deja_clos: null } });
    for (const contenu of [env, INIT + INIT, INIT + env + acc + acc, INIT + acc, INIT + env + env]) {
      assert.equal(V.analyser(Buffer.from(contenu)).sain, false, contenu);
    }
    assert.equal(V.analyser(Buffer.from(INIT + env + acc)).sain, true);
  });
  test('envoi incohérent (attendu falsifié, workflow ≠ commande) : corrompu', () => {
    const avant = { fichier_id: null, version: null, generation_cle: null, statut: null, clos_le: null };
    const base = { type: 'envoi', set_id: A, tentative_id: '1'.padStart(32, '0'), commande: 'emission', workflow: 'emettre', avant, preexistantes: [], attendu: { fichier_id: null, generation_cle: 1, statut: 'en_attente' } };
    assert.equal(V.analyser(Buffer.from(INIT + L({ ...base, attendu: { ...base.attendu, generation_cle: 2 } }))).sain, false);
    assert.equal(V.analyser(Buffer.from(INIT + L({ ...base, workflow: 'cloturer' }))).sain, false);
    assert.equal(V.analyser(Buffer.from(INIT + L({ ...base, preexistantes: ['7', '3'] }))).sain, false, 'préexistantes non triées');
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
    assert.equal(etatLot(b, A), 'bloque');
    assert.equal(V.decisionSignature(A, b.deps), 'abandon');
    // Même un diagnostic « conforme » ultérieur ne débloque pas un lot touché par une portion perdue.
    V.diagnostiquer(p.tentative_id, { executions: [exec('6')], candidat: EN_ATTENTE, listingComplet: true }, b.deps);
    assert.equal(etatLot(b, A), 'bloque');
    envoi(b, B); // un autre lot reste utilisable
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
  });
  test('ligne illisible au MILIEU portant un set_id : lot bloqué ; issue orpheline du même lot tolérée', () => {
    const b = banc();
    const p = envoi(b);
    const lignes = fs.readFileSync(b.journal, 'utf8').split('\n');
    lignes[1] = lignes[1].replace('"type":"envoi"', '"type":"envoi","x":').slice(0, -10); // envoi corrompu
    fs.writeFileSync(b.journal, lignes.join('\n'));
    fs.appendFileSync(b.journal, `${JSON.stringify({ v: 1, type: 'indetermine', le: '2026-11-16T10:00:00.000Z', set_id: A, tentative_id: p.tentative_id, motif: 'delai' })}\n`);
    assert.equal(V.lireEtat(b.deps.verrous).sain, false);
    V.reparer(b.deps);
    assert.equal(V.lireEtat(b.deps.verrous).sain, true);
    assert.equal(etatLot(b, A), 'bloque');
  });
  test('réparation relancée : idempotente ; copie divergente -> refus', () => {
    const b = banc();
    fs.appendFileSync(b.journal, 'xx');
    V.reparer(b.deps);
    const apres = b.octets();
    V.reparer(b.deps);
    assert.equal(V.lireEtat(b.deps.verrous).sain, true);
    const copie = path.join(b.deps.verrous, `relecture.journal.original-${V.sha256(b.octets())}`);
    fs.writeFileSync(copie, 'autre');
    assert.throws(() => V.reparer(b.deps), /divergente/);
    assert.ok(apres.length > 0);
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

describe('confinement : sentinelles (schéma fermé, aucune valeur rejetée répétée)', () => {
  const SENTINELLES = {
    k: 'a1'.repeat(32), adresse: 'sentinelle.relecteur@exemple.invalid', hmac: 'HMACSENTINELLE0123456789abcdef',
    jeton: 'JETONWEBHOOKSENTINELLE42', cleApi: 'CLEAPIN8NSENTINELLE-xyz',
  };
  const toutes = Object.values(SENTINELLES);
  const contient = (texte) => toutes.filter((s) => texte.includes(s));
  test('champs supplémentaires porteurs de secrets : jamais persistés, jamais rendus', () => {
    const b = banc();
    const sorties = [];
    const candidat = { ...EN_ATTENTE, k: SENTINELLES.k, envois: [{ envoye_a: SENTINELLES.adresse }], cle_sha256: SENTINELLES.hmac };
    const p = V.preparerEnvoi(A, 'reemission', { candidat, preexistantes: ['5'], listingComplet: true, jeton: SENTINELLES.jeton }, b.deps);
    sorties.push(p);
    sorties.push(V.conclure(p.tentative_id, 'indetermine', { motif: 'delai', erreur: `401 ${SENTINELLES.cleApi}` }, b.deps));
    const executions = [{ id: '6', set_id: A, workflow: 'emettre', statut: 'error', data: { k: SENTINELLES.k, headers: { 'X-N8N-API-KEY': SENTINELLES.cleApi }, secret: SENTINELLES.hmac } }];
    sorties.push(V.diagnostiquer(p.tentative_id, { executions, candidat: { ...EN_ATTENTE, generation_cle: 2, lien: `?k=${SENTINELLES.k}` }, listingComplet: true }, b.deps));
    sorties.push(V.decisionSignature(A, b.deps), V.lireEtat(b.deps.verrous));
    const p2 = envoi(b, B);
    sorties.push(V.conclure(p2.tentative_id, 'accepte', { reponse: { generation_cle: 1, k: SENTINELLES.k, envoye_a: SENTINELLES.adresse, jeton: SENTINELLES.jeton } }, b.deps));
    assert.deepEqual(contient(b.octets().toString('latin1')), [], 'journal');
    assert.deepEqual(contient(JSON.stringify(sorties)), [], 'sorties');
    assert.deepEqual(fs.readdirSync(b.deps.verrous).flatMap((f) => contient(fs.readFileSync(path.join(b.deps.verrous, f), 'latin1'))), [], 'fichiers du dossier');
  });
  test('secret placé DANS un champ du schéma : refus SANS répéter la valeur', () => {
    const b = banc();
    const essais = [
      () => V.preparerEnvoi(SENTINELLES.jeton, 'emission', { candidat: null, preexistantes: [], listingComplet: true }, b.deps),
      () => V.preparerEnvoi(A, 'reemission', { candidat: { ...EN_ATTENTE, fichier_id: SENTINELLES.adresse }, preexistantes: [], listingComplet: true }, b.deps),
      () => V.preparerEnvoi(A, 'reemission', { candidat: { ...EN_ATTENTE, statut: SENTINELLES.k }, preexistantes: [], listingComplet: true }, b.deps),
      () => V.preparerEnvoi(A, 'emission', { candidat: null, preexistantes: [SENTINELLES.cleApi], listingComplet: true }, b.deps),
      () => V.conclure(envoi(b, B).tentative_id, 'accepte', { reponse: { statut: SENTINELLES.hmac } }, b.deps),
      () => V.attribuerPerte(1, [SENTINELLES.adresse], b.deps),
      () => V.decisionSignature(SENTINELLES.k, b.deps),
    ];
    for (const f of essais) {
      let message = null;
      try { f(); } catch (e) { message = e.message; }
      assert.ok(message, 'refus attendu');
      assert.deepEqual(contient(message), [], message);
    }
    const e = { id: SENTINELLES.cleApi, set_id: A, workflow: 'emettre', statut: 'success' };
    const p = envoi(b, A, 'emission');
    assert.throws(() => V.diagnostiquer(p.tentative_id, { executions: [e], candidat: null, listingComplet: true }, b.deps), (err) => contient(err.message).length === 0);
    assert.deepEqual(contient(b.octets().toString('latin1')), []);
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
  test('portée retenue = verrou UNIQUE : une commande sur un AUTRE lot attend aussi (75) pendant la détention', async () => {
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
  test('kill -9 APRÈS l\'envoi (POST en vol) : verrou libéré ; MÊME lot refusé, AUTRE lot autorisé ; signature = refus temporaire', async () => {
    const b = base();
    const premier = enfant({ action: 'envoi', setId: A, verrous: b.verrous, trace: b.trace, barriere: { pret: b.pret, go: b.go } }, { attendre: false });
    await attendreFichier(b.pret);
    process.kill(premier.pid, 'SIGKILL');
    await new Promise((r) => premier.on('exit', r));
    assert.equal(V.lireEtat(b.verrous).lots[A].etat, 'ouverte', 'envoi sans issue = indéterminé');
    const meme = enfant({ action: 'envoi', setId: A, verrous: b.verrous, trace: b.trace });
    assert.equal(meme.status, 1);
    assert.match(meme.stderr, /diagnostic requis/);
    const signature = enfant({ action: 'signature', setId: A, verrous: b.verrous });
    assert.equal(JSON.parse(signature.stdout).decision, 'refus_temporaire');
    const autre = enfant({ action: 'envoi', setId: B, verrous: b.verrous, trace: b.trace });
    assert.equal(autre.status, 0, autre.stderr);
    assert.equal(posts(b), 1, 'seul B a posté');
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
