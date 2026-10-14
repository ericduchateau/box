// Tests du journal des identifiants (CDC §6) et du classement M2 (§4.3).
// Usage : node --test fonda/engine/journal-set-ids.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const J = require('./journal-set-ids.js');

const A = 'set_fonda_lexique_nI_01';
const B = 'set_fonda_lexique_nI_02';
const ligne = (set_id, transition, ref = `r-${set_id}-${transition}`) => ({ set_id, transition, le: '2026-10-14', ref });
const journal = (...lignes) => ({ schema: J.SCHEMA_JOURNAL, lignes });

describe('validation et dérivation de l\'état', () => {
  test('transitions autorisées : reserve -> publie -> retire ; reserve -> abandonne', () => {
    const v = J.validerJournal(journal(ligne(A, 'reserve'), ligne(A, 'publie'), ligne(A, 'retire'), ligne(B, 'reserve'), ligne(B, 'abandonne')));
    assert.deepEqual(v.erreurs, []);
    assert.equal(v.etats.get(A), 'retire');
    assert.equal(v.etats.get(B), 'abandonne');
  });
  test('état = dernière transition ; absent -> null', () => {
    const j = journal(ligne(A, 'reserve'));
    assert.equal(J.etatCourant(j, A), 'reserve');
    assert.equal(J.etatCourant(j, B), null);
  });
  const interdits = [
    ['double reserve', [ligne(A, 'reserve', 'r1-aaaa'), ligne(A, 'reserve', 'r2-aaaa')], /double reserve/],
    ['reserve après abandon (jamais réutilisable)', [ligne(A, 'reserve'), ligne(A, 'abandonne'), ligne(A, 'reserve', 'r-autre')], /double reserve/],
    ['publie sans reserve', [ligne(A, 'publie')], /sans reserve/],
    ['abandonne -> publie', [ligne(A, 'reserve'), ligne(A, 'abandonne'), ligne(A, 'publie')], /interdite/],
    ['publie -> abandonne', [ligne(A, 'reserve'), ligne(A, 'publie'), ligne(A, 'abandonne')], /interdite/],
    ['retire -> publie (pas de réintroduction)', [ligne(A, 'reserve'), ligne(A, 'publie'), ligne(A, 'retire'), ligne(A, 'publie')], /interdite/],
    ['ref de réservation réutilisée', [ligne(A, 'reserve', 'meme-ref'), ligne(B, 'reserve', 'meme-ref')], /ref de réservation déjà utilisée/],
    ['transition inconnue', [ligne(A, 'reserve'), { ...ligne(A, 'publie'), transition: 'valide' }], /inconnue/],
    ['set_id non canonique', [{ ...ligne(A, 'reserve'), set_id: '../x' }], /set_id invalide/],
    ['champ en trop', [{ ...ligne(A, 'reserve'), note: 'x' }], /champs attendus/],
    ['champ manquant', [{ set_id: A, transition: 'reserve', le: '2026-10-14' }], /champs attendus/],
    ['date invalide', [{ ...ligne(A, 'reserve'), le: '14/10/2026' }], /date/],
    ['ref vide', [{ ...ligne(A, 'reserve'), ref: '' }], /ref invalide/],
  ];
  for (const [libelle, lignes, motif] of interdits) {
    test(`refusé : ${libelle}`, () => {
      const v = J.validerJournal(journal(...lignes));
      assert.equal(v.valide, false);
      assert.match(v.erreurs.join(), motif);
    });
  }
  test('forme du fichier : schema exact, lignes tableau, rien d\'autre', () => {
    for (const j of [null, [], {}, { schema: 'autre', lignes: [] }, { schema: J.SCHEMA_JOURNAL }, { schema: J.SCHEMA_JOURNAL, lignes: [], extra: 1 }]) {
      assert.equal(J.validerJournal(j).valide, false, JSON.stringify(j));
    }
  });
  test('lecture fail-closed : JSON invalide -> exception (jamais un journal vide)', () => {
    assert.throws(() => J.lireJournalTexte('{ pas du json'), /illisible/);
    assert.throws(() => J.lireJournalTexte(''), /illisible/);
  });
});

describe('réservation et vérification avant création du candidat', () => {
  test('verifierReservation : ok seulement si reserve courante portant EXACTEMENT la ref', () => {
    const j = journal(ligne(A, 'reserve', 'ma-ref-1234'));
    assert.deepEqual(J.verifierReservation(j, A, 'ma-ref-1234'), { ok: true });
    assert.match(J.verifierReservation(j, A, 'autre-ref').raison, /porte la ref/);
    assert.match(J.verifierReservation(j, B, 'ma-ref-1234').raison, /aucune réservation/);
    const pub = journal(ligne(A, 'reserve', 'ma-ref-1234'), ligne(A, 'publie'));
    assert.match(J.verifierReservation(pub, A, 'ma-ref-1234').raison, /état courant publie/);
    assert.match(J.verifierReservation({ schema: 'x' }, A, 'ma-ref-1234').raison, /non conforme/);
  });
  test('ligneReservation : refuse un set_id déjà présent (quel que soit son état)', () => {
    const j = journal(ligne(A, 'reserve'), ligne(A, 'abandonne'));
    assert.throws(() => J.ligneReservation(j, A, '2026-10-14', 'nouvelle-ref'), /déjà présent/);
    assert.deepEqual(J.ligneReservation(j, B, '2026-10-14', 'nouvelle-ref'), { set_id: B, transition: 'reserve', le: '2026-10-14', ref: 'nouvelle-ref' });
    assert.throws(() => J.ligneReservation(journal(ligne(A, 'reserve', 'deja-prise')), B, '2026-10-14', 'deja-prise'), /ref de réservation déjà utilisée/);
  });
  test('coherenceAvecDepot : catalogue = publiés ; calibration réservée ou abandonnée', () => {
    const j = journal(ligne(A, 'reserve'), ligne(A, 'publie'), ligne(B, 'reserve'));
    assert.deepEqual(J.coherenceAvecDepot(j, { catalogueIds: [A], calibrationIds: [B] }), []);
    assert.match(J.coherenceAvecDepot(j, { catalogueIds: [], calibrationIds: [B] }).join(), /absent du catalogue/);
    assert.match(J.coherenceAvecDepot(j, { catalogueIds: [A, B], calibrationIds: [] }).join(), /attendu publie/);
    assert.match(J.coherenceAvecDepot(j, { catalogueIds: [A], calibrationIds: [B, 'set_fonda_lexique_nF_09'] }).join(), /absent/);
  });
});

describe('classement M2 (fail-closed)', () => {
  const P = 'set_fonda_comprendre-consigne_nI_01';
  const base = { le: '2026-10-14', prefixeRef: 'm2-2026-10-14' };
  test('publié -> reserve+publie ; calibration -> reserve ; disparu de l\'historique -> reserve+abandonne', () => {
    const lignes = J.classerM2({ ...base, catalogueIds: [P], lotsIds: [P], calibrationIds: [A], historiqueIds: [P, A, B] });
    const v = J.validerJournal(journal(...lignes));
    assert.deepEqual(v.erreurs, []);
    assert.deepEqual(Object.fromEntries(v.etats), { [P]: 'publie', [A]: 'reserve', [B]: 'abandonne' });
  });
  const incoherences = [
    ['catalogue sans fichier lots/', { catalogueIds: [P], lotsIds: [], calibrationIds: [], historiqueIds: [] }, /sans fichier/],
    ['fichier lots/ hors catalogue', { catalogueIds: [], lotsIds: [P], calibrationIds: [], historiqueIds: [] }, /hors catalogue/],
    ['publié ET en calibration', { catalogueIds: [P], lotsIds: [P], calibrationIds: [P], historiqueIds: [] }, /publié et en calibration/],
    ['identifiant non canonique', { catalogueIds: [], lotsIds: [], calibrationIds: [], historiqueIds: ['set_fonda_x'] }, /non canonique/],
    ['calibration en double', { catalogueIds: [], lotsIds: [], calibrationIds: [A, A], historiqueIds: [] }, /double/],
  ];
  for (const [libelle, entrees, motif] of incoherences) {
    test(`arrêt (jamais de classement deviné) : ${libelle}`, () => {
      assert.throws(() => J.classerM2({ ...base, ...entrees }), motif);
    });
  }
});

describe('M2 — historique Git (scan sur-inclusif, fail-closed)', () => {
  const { idsHistorique } = require('../scripts/migrer-journal-m2.js');
  function depot() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm2-'));
    const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
    fs.mkdirSync(path.join(dir, 'fonda/data/lots-fonda-calibration'), { recursive: true });
    return { dir, g };
  }
  const ecrire = (dir, rel, contenu) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), contenu); };
  test('identifiant disparu (fichier supprimé, ou branche non fusionnée) : retrouvé dans l\'historique', () => {
    const { dir, g } = depot();
    ecrire(dir, 'fonda/data/lots-fonda-calibration/x.json', JSON.stringify({ set_id: A }));
    g('add', '.'); g('commit', '-q', '-m', 'a');
    g('rm', '-q', 'fonda/data/lots-fonda-calibration/x.json'); g('commit', '-q', '-m', 'suppr');
    g('checkout', '-q', '-b', 'brouillon');
    ecrire(dir, 'fonda/data/lots-fonda-calibration/y.json', JSON.stringify({ note: `mention de ${B}` }));
    g('add', '.'); g('commit', '-q', '-m', 'b');
    g('checkout', '-q', '-');
    assert.deepEqual(idsHistorique(dir).ids.sort(), [A, B]);
  });
  test('version JSON illisible dans l\'historique : arrêt (histoire indéterminée)', () => {
    const { dir, g } = depot();
    ecrire(dir, 'fonda/data/lots-fonda-calibration/x.json', '{ cassé');
    g('add', '.'); g('commit', '-q', '-m', 'casse');
    assert.throws(() => idsHistorique(dir), /illisible/);
  });
  test('clone superficiel : arrêt', () => {
    const { dir, g } = depot();
    ecrire(dir, 'fonda/data/lots-fonda-calibration/x.json', '{}'); g('add', '.'); g('commit', '-q', '-m', '1');
    ecrire(dir, 'fonda/data/lots-fonda-calibration/x.json', '{"a":1}'); g('commit', '-q', '-am', '2');
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'm2-sup-'));
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${dir}`, clone], { stdio: 'ignore' });
    assert.throws(() => idsHistorique(clone), /superficiel/);
  });
});
