// Tests de fonda/scripts/interim.js — relecteur de secours en intérim (CDC r9 §20.6 ; plan r6
// §1, §2) : validateur (intrinsèque + calendaire), jour de Paris, autorisation, provenance de
// la saisie, archive des charges v3, observation Git à refspec EXPLICITE (vrai dépôt temporaire).
// Usage : node --test fonda/scripts/interim.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const I = require('./interim.js');

const DATA = path.join(__dirname, '..', 'data');
// FIXTURE de test (jamais l'entrée réelle de fonda/data : son retrait ne doit pas casser la CI).
const OCT_INTERIM = fs.readFileSync(path.join(__dirname, 'fixtures', 'relecture-interim.json'));
const OCT_CAL = fs.readFileSync(path.join(DATA, 'calendar.json'));
const OCT_DEST = fs.readFileSync(path.join(DATA, 'destinataires.json'));
const FICHIER = JSON.parse(OCT_INTERIM.toString('utf8'));
const CAL = JSON.parse(OCT_CAL.toString('utf8'));
const ENTREE = FICHIER.entrees[0];
const SHA = 'd'.repeat(40);
const copie = (o) => JSON.parse(JSON.stringify(o));
const octets = (o) => Buffer.from(`${JSON.stringify(o, null, 2)}\n`);
const obs = (fichier = FICHIER, sur = {}) => ({ sha: SHA, octetsInterim: octets(fichier), octetsCalendrier: OCT_CAL, octetsDestinataires: OCT_DEST, ...sur });
const versionDe = (o) => `sha256:${crypto.createHash('sha256').update(o).digest('hex')}`;

describe('fichier RÉEL fonda/data/relecture-interim.json : conforme quel que soit son contenu (ajout ou retrait d\'entrées)', () => {
  test('valide (intrinsèque + calendaire) ; motifs publics sans détail privé ni financier', () => {
    const reel = JSON.parse(fs.readFileSync(path.join(DATA, 'relecture-interim.json'), 'utf8'));
    assert.deepEqual(I.validerRelectureInterim(reel, { calendrier: CAL }), []);
    for (const e of reel.entrees) assert.doesNotMatch(e.motif, /rémunération|salaire|direction|Leblanc/i);
  });
  test('fixture de test : entrée justine -> eric, P2, du 2026-10-28 au 2026-12-18', () => {
    assert.deepEqual(I.validerRelectureInterim(FICHIER, { calendrier: CAL }), []);
    assert.deepEqual(ENTREE, { relecteur_titulaire: 'justine', relecteur_de_secours: 'eric',
      motif: 'Intérim de relecture du français pour P2, pendant la mise en place du parcours titulaire.', periode: 'P2', du: '2026-10-28', au: '2026-12-18' });
  });
});

describe('validateur (§1) : un défaut par règle', () => {
  const avec = (modif) => { const f = copie(FICHIER); modif(f, f.entrees[0]); return f; };
  const cas = [
    ['schema', (f) => { f.schema = 'relecture-interim/v2'; }, /schema/],
    ['racine : clé en trop', (f) => { f.extra = 1; }, /racine/],
    ['entrees non tableau', (f) => { f.entrees = {}; }, /tableau/],
    ['entrée : clé en trop', (f, e) => { e.note = 'x'; }, /champs exactement/],
    ['entrée : clé manquante', (f, e) => { delete e.motif; }, /champs exactement/],
    ['titulaire inconnu', (f, e) => { e.relecteur_titulaire = 'paul'; }, /titulaire inconnu/],
    ['secours inconnu', (f, e) => { e.relecteur_de_secours = 'paul'; }, /secours inconnu/],
    ['titulaire = secours', (f, e) => { e.relecteur_de_secours = 'justine'; }, /titulaire = secours/],
    ['motif vide', (f, e) => { e.motif = '  '; }, /motif vide/],
    ['periode vide', (f, e) => { e.periode = ''; }, /periode vide/],
    ['date irréelle', (f, e) => { e.au = '2026-02-30'; }, /date civile/],
    ['date mal formée', (f, e) => { e.du = '28/10/2026'; }, /date civile/],
    ['du > au', (f, e) => { e.du = '2026-12-19'; }, /du > au/],
    ['fenêtres chevauchantes (bornes incluses)', (f, e) => { f.entrees.push({ ...e, motif: 'autre', du: '2026-12-18', au: '2026-12-18' }); }, /chevauchantes/],
  ];
  for (const [nom, modif, motif] of cas) {
    test(`intrinsèque : ${nom}`, () => assert.match(I.validerIntrinseque(avec(modif)).join(), motif));
  }
  test('fenêtres disjointes du même titulaire, ou titulaires différents : admis', () => {
    assert.deepEqual(I.validerIntrinseque(avec((f, e) => { f.entrees.push({ ...e, du: '2026-12-19', au: '2026-12-20' }); })), []);
  });
  test('calendaire : période absente du calendrier', () => assert.match(I.validerCalendaire(avec((f, e) => { e.periode = 'P9'; }), CAL).join(), /P9 absente/));
  test('calendaire : au après la fin de la période', () => assert.match(I.validerCalendaire(avec((f, e) => { e.au = '2026-12-19'; }), CAL).join(), /après la fin de P2/));
  test('calendaire : du peut précéder le début de la période (préparer S45)', () => {
    assert.ok(ENTREE.du < CAL.periodes.find((p) => p.id === 'P2').du);
    assert.deepEqual(I.validerCalendaire(FICHIER, CAL), []);
  });
  test('calendrier illisible -> défaut', () => assert.match(I.validerCalendaire(FICHIER, {}).join(), /calendrier illisible/));
});

describe('jour civil Europe/Paris (bornes en heure de Paris)', () => {
  for (const [iso, jour] of [
    ['2026-10-27T22:59:59.999Z', '2026-10-27'], ['2026-10-27T23:00:00.000Z', '2026-10-28'], ['2026-10-27T23:30:00.000Z', '2026-10-28'],
    ['2026-12-18T22:59:59.999Z', '2026-12-18'], ['2026-12-18T23:00:00.000Z', '2026-12-19'],
    ['2026-07-01T21:59:59.000Z', '2026-07-01'], ['2026-07-01T22:00:00.000Z', '2026-07-02'], // heure d'été (UTC+2)
  ]) test(`${iso} -> ${jour}`, () => assert.equal(I.jourParis(iso), jour));
  test('instant invalide -> null', () => { assert.equal(I.jourParis('pas une date'), null); assert.equal(I.jourParis(undefined), null); });
});

describe('autorisation d\'une nouvelle opération (§2)', () => {
  test('dans la fenêtre : entrée, présentation (badge exact, noms de destinataires.json), version, SHA', () => {
    const a = I.autoriser('justine', '2026-11-05', obs());
    assert.equal(a.ok, true, a.raison);
    assert.deepEqual(a.entree, ENTREE);
    assert.equal(a.source_version, versionDe(octets(FICHIER)));
    assert.equal(a.sha, SHA);
    assert.deepEqual(a.presentation.badge, { forme: 'relue_par_secours', nom_affiche: 'Éric Duchateau', id: 'eric', titulaire: { id: 'justine', nom_affiche: 'Justine Leblanc' } });
    assert.match(I.textePresentation(a.presentation, a.sha), /Titulaire : Justine Leblanc.*secours : Éric Duchateau[\s\S]*du 2026-10-28 au 2026-12-18[\s\S]*dddd/);
  });
  for (const jour of ['2026-10-28', '2026-12-18']) test(`borne incluse ${jour} -> autorisé`, () => assert.equal(I.autoriser('justine', jour, obs()).ok, true));
  for (const jour of ['2026-10-27', '2026-12-19']) test(`hors fenêtre ${jour} -> refus`, () => assert.match(I.autoriser('justine', jour, obs()).raison, /0 entrée/));
  test('autre titulaire (eric) -> refus', () => assert.match(I.autoriser('eric', '2026-11-05', obs()).raison, /0 entrée/));
  test('secours ≠ eric -> refus', () => {
    const f = copie(FICHIER); f.entrees = [{ ...ENTREE, relecteur_titulaire: 'eric', relecteur_de_secours: 'justine' }];
    assert.match(I.autoriser('eric', '2026-11-05', obs(f)).raison, /seul « eric »/);
  });
  test('fichier invalide sur une AUTRE entrée -> refus (validation complète AVANT sélection)', () => {
    const f = copie(FICHIER); f.entrees.push({ ...ENTREE, relecteur_titulaire: 'eric', relecteur_de_secours: 'eric', du: '2027-01-04', au: '2027-01-05' });
    assert.match(I.autoriser('justine', '2026-11-05', obs(f)).raison, /non conforme.*titulaire = secours/);
  });
  test('deux entrées applicables le même jour -> refus (chevauchement)', () => {
    const f = copie(FICHIER); f.entrees.push({ ...ENTREE, motif: 'doublon' });
    assert.match(I.autoriser('justine', '2026-11-05', obs(f)).raison, /chevauchantes/);
  });
  test('entrée hors calendrier de l\'observation -> refus', () => {
    const cal = copie(CAL); cal.periodes = cal.periodes.filter((p) => p.id !== 'P2');
    assert.match(I.autoriser('justine', '2026-11-05', obs(FICHIER, { octetsCalendrier: octets(cal) })).raison, /P2 absente/);
  });
  test('nom absent de destinataires.json au SHA -> refus', () => {
    const d = JSON.parse(OCT_DEST.toString('utf8')); delete d.relecteurs.justine;
    assert.match(I.autoriser('justine', '2026-11-05', obs(FICHIER, { octetsDestinataires: octets(d) })).raison, /nom_affiche/);
  });
  test('JSON invalide, SHA invalide, jour invalide -> refus', () => {
    assert.match(I.autoriser('justine', '2026-11-05', obs(FICHIER, { octetsInterim: Buffer.from('{') })).raison, /JSON invalide/);
    assert.match(I.autoriser('justine', '2026-11-05', obs(FICHIER, { sha: 'abc' })).raison, /observation/);
    assert.match(I.autoriser('justine', null, obs()).raison, /jour invalide/);
    assert.equal(I.autoriser('justine', '2026-11-05', null).ok, false);
  });
});

describe('provenance de la saisie (preuve figée, archive historique seule)', () => {
  const bloc = I.blocDecision(ENTREE, versionDe(OCT_INTERIM), SHA);
  const aCommit = (sur = {}) => (c) => (c === SHA ? { surPremierParent: true, octetsInterim: OCT_INTERIM, octetsCalendrier: OCT_CAL, ...sur } : { surPremierParent: false });
  test('commit de confiance, empreinte, fichier valide, entrée unique identique au jour de recu_le -> OK', () => {
    assert.deepEqual(I.prouverProvenance(bloc, '2026-11-04T16:15:00.000Z', aCommit()), { ok: true });
  });
  test('borne de Paris : 2026-10-27T23:30Z (= 28/10 00:30 à Paris) OK ; 2026-10-27T22:30Z (27/10) refus', () => {
    assert.equal(I.prouverProvenance(bloc, '2026-10-27T23:30:00.000Z', aCommit()).ok, true);
    assert.match(I.prouverProvenance(bloc, '2026-10-27T22:30:00.000Z', aCommit()).raison, /au 2026-10-27/);
  });
  test('commit hors de la chaîne de confiance -> refus', () => assert.match(I.prouverProvenance({ ...bloc, source_commit: 'e'.repeat(40) }, '2026-11-04T16:15:00.000Z', aCommit()).raison, /hors de la chaîne/));
  test('empreinte du fichier au commit ≠ source_version -> refus', () => assert.match(I.prouverProvenance({ ...bloc, source_version: `sha256:${'0'.repeat(64)}` }, '2026-11-04T16:15:00.000Z', aCommit()).raison, /≠ source_version/));
  test('fichier historique invalide (chevauchement) -> refus, même si l\'entrée visée y figure', () => {
    const f = copie(FICHIER); f.entrees.push({ ...ENTREE, motif: 'autre' });
    const o = octets(f);
    assert.match(I.prouverProvenance({ ...bloc, source_version: versionDe(o) }, '2026-11-04T16:15:00.000Z', aCommit({ octetsInterim: o })).raison, /non conforme/);
  });
  test('période absente du calendrier DE CE COMMIT -> refus', () => {
    const cal = copie(CAL); cal.periodes = [];
    assert.match(I.prouverProvenance(bloc, '2026-11-04T16:15:00.000Z', aCommit({ octetsCalendrier: octets(cal) })).raison, /P2 absente/);
  });
  for (const k of I.CHAMPS_ENTREE) {
    test(`bloc ≠ entrée du fichier (${k}) -> refus`, () => {
      const autre = { ...bloc, [k]: k === 'du' ? '2026-10-29' : k === 'au' ? '2026-12-17' : `${bloc[k]}-x` };
      assert.equal(I.prouverProvenance(autre, '2026-11-04T16:15:00.000Z', aCommit()).ok, false);
    });
  }
  test('bloc mal formé (champ en trop, commit ou version mal formés) -> refus', () => {
    assert.match(I.prouverProvenance({ ...bloc, x: 1 }, '2026-11-04T16:15:00.000Z', aCommit()).raison, /champs exactement/);
    assert.match(I.prouverProvenance({ ...bloc, source_commit: 'abc' }, '2026-11-04T16:15:00.000Z', aCommit()).raison, /40 hex/);
    assert.match(I.prouverProvenance({ ...bloc, source_version: 'v1' }, '2026-11-04T16:15:00.000Z', aCommit()).raison, /sha256/);
  });
});

describe('archive d\'une charge v3 (D2–D4) : bloc signé = EXACTEMENT une entrée', () => {
  const bloc = I.blocCharge(ENTREE, versionDe(OCT_INTERIM));
  test('archive conforme -> aucun défaut', () => assert.deepEqual(I.verifierArchive(bloc, OCT_INTERIM), []));
  test('archive absente / empreinte ≠ / JSON invalide -> défaut', () => {
    assert.match(I.verifierArchive(bloc, null).join(), /absente/);
    assert.match(I.verifierArchive(bloc, Buffer.from('{}')).join(), /≠ source_version/);
    const bad = Buffer.from('{'); assert.match(I.verifierArchive({ ...bloc, source_version: versionDe(bad) }, bad).join(), /JSON invalide/);
  });
  for (const k of I.CHAMPS_ENTREE) {
    test(`bloc ≠ entrée de l'archive (${k}) -> défaut`, () => assert.match(I.verifierArchive({ ...bloc, [k]: `${bloc[k]}x` }, OCT_INTERIM).join(), /exactement une entrée/));
  }
  test('archive intrinsèquement invalide -> défaut (sans calendrier)', () => {
    const f = copie(FICHIER); f.entrees[0].motif = '';
    const o = octets(f);
    assert.match(I.verifierArchive({ ...bloc, source_version: versionDe(o) }, o).join(), /non conforme/);
  });
});

describe('observation Git : refspec EXPLICITE, SHA figé, jamais une référence seulement préexistante', () => {
  test('commandes exactes ; lecture des trois fichiers AU MÊME SHA', () => {
    const appels = [];
    const git = (a) => { appels.push(a.join(' ')); if (a[0] === 'rev-parse') return Buffer.from(`${SHA}\n`); if (a[0] === 'show') return Buffer.from(a[1]); return Buffer.alloc(0); };
    const o = I.observer(git);
    assert.deepEqual(appels, ['fetch --quiet origin +refs/heads/design:refs/remotes/origin/design', 'rev-parse --verify --quiet refs/remotes/origin/design^{commit}',
      `show ${SHA}:fonda/data/relecture-interim.json`, `show ${SHA}:fonda/data/calendar.json`, `show ${SHA}:fonda/data/destinataires.json`]);
    assert.equal(o.sha, SHA);
  });
  test('fetch en échec -> exception (aucune lecture de la référence préexistante)', () => {
    const appels = [];
    const git = (a) => { appels.push(a[0]); if (a[0] === 'fetch') throw new Error('réseau'); return Buffer.from(SHA); };
    assert.throws(() => I.observer(git), /réseau/);
    assert.deepEqual(appels, ['fetch']);
  });
  test('référence non résolue en commit -> exception', () => {
    assert.throws(() => I.actualiser((a) => (a[0] === 'rev-parse' ? Buffer.from('pas-un-sha\n') : Buffer.alloc(0))), /commit introuvable/);
  });
  test('VRAI dépôt : remote.origin.fetch limité à une AUTRE branche et ancienne réf locale contenant encore l\'intérim -> l\'état distant (intérim retiré) est observé', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fonda-interim-git-'));
    const g = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    const distant = path.join(tmp, 'distant');
    fs.mkdirSync(path.join(distant, 'fonda', 'data'), { recursive: true });
    g(distant, 'init', '-q', '-b', 'design');
    g(distant, 'config', 'user.email', 'test@exemple.invalid'); g(distant, 'config', 'user.name', 'test');
    for (const [n, o] of [['calendar.json', OCT_CAL], ['destinataires.json', OCT_DEST], ['relecture-interim.json', OCT_INTERIM]]) fs.writeFileSync(path.join(distant, 'fonda', 'data', n), o);
    g(distant, 'add', '-A'); g(distant, 'commit', '-qm', 'avec intérim');
    g(distant, 'branch', 'autre');
    const local = path.join(tmp, 'local');
    g(tmp, 'clone', '-q', distant, local);
    const ancien = g(local, 'rev-parse', 'refs/remotes/origin/design').toString().trim();
    // Retrait de l'entrée sur design distant ; mapping de fetch local réduit à une autre branche.
    fs.writeFileSync(path.join(distant, 'fonda', 'data', 'relecture-interim.json'), octets({ schema: 'relecture-interim/v1', entrees: [] }));
    g(distant, 'commit', '-qam', 'retrait');
    const nouveau = g(distant, 'rev-parse', 'HEAD').toString().trim();
    g(local, 'config', 'remote.origin.fetch', '+refs/heads/autre:refs/remotes/origin/autre');
    g(local, 'fetch', '-q', 'origin');
    assert.equal(g(local, 'rev-parse', 'refs/remotes/origin/design').toString().trim(), ancien, 'un fetch ordinaire laisse l\'ancienne référence');
    const o = I.observer((a) => g(local, ...a));
    assert.equal(o.sha, nouveau);
    assert.deepEqual(JSON.parse(o.octetsInterim.toString('utf8')).entrees, []);
    assert.match(I.autoriser('justine', '2026-11-05', o).raison, /0 entrée/);
  });
});
