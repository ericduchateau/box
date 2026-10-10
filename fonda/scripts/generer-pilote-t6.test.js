// Suite de tests — lot pilote T6 (fonda/scripts/generer-pilote-t6.js).
// Écrite avant d'exécuter le script en intégration. Zéro dépendance, test runner
// natif Node.
//
// Usage : node --test fonda/scripts/generer-pilote-t6.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { construireLotPilote } = require('./generer-pilote-t6.js');
const { validerCandidate, validerJeu } = require('../engine/generation.js');
const { evaluerReponse } = require('../engine/correction.js');

describe('construireLotPilote — chaîne exercée sur le contenu pilote (en mémoire, sans écriture)', () => {
  test('zéro erreur : les 12 notions du référentiel ont un contenu nI et nF', () => {
    const { erreurs } = construireLotPilote();
    assert.deepEqual(erreurs, []);
  });

  // 24 jeux, 143 cartes (144 - 1 : carte « encadrement 5 et 6 » retirée en T6a,
  // profil numerique incompatible avec deux valeurs — point (b) validé par Éric).
  test('24 jeux (12 notions × 2 paliers), 143 cartes', () => {
    const { manifesteJeux, toutesLesCartes } = construireLotPilote();
    assert.equal(manifesteJeux.length, 24);
    assert.equal(toutesLesCartes.length, 143);
  });

  test('équilibre 6 notions Justine / 6 notions Éric -> 72 Justine / 71 Éric (1 carte maths retirée)', () => {
    const { toutesLesCartes } = construireLotPilote();
    const justine = toutesLesCartes.filter((c) => c.relecteur === 'justine');
    const eric = toutesLesCartes.filter((c) => c.relecteur === 'eric');
    assert.equal(justine.length, 72);
    assert.equal(eric.length, 71);
  });

  test('toutes les cartes passent validerCandidate (notion_id connu du référentiel)', () => {
    const { toutesLesCartes } = construireLotPilote();
    const notionIds = new Set(toutesLesCartes.map((c) => c.notion_id));
    toutesLesCartes.forEach((c) => {
      const r = validerCandidate(c, { notionIdsConnus: notionIds });
      assert.equal(r.valide, true, `${c.set_id}/${c.item_id} : ${r.erreurs && r.erreurs.join(', ')}`);
    });
  });

  // T6a point (c), validé par Éric : les cartes à réponse avec unité physique mais
  // SANS champ `unite` sont un cas connu — "le correcteur a raison, c'est la
  // rédaction qui est incomplète" — marquées `_fixture_note`, PAS corrigées ici.
  // Ce test verrouille le contrat : exactement les cartes notées (ni plus, ni
  // moins) peuvent diverger du correcteur ; toute AUTRE carte doit réellement
  // passer — une régression future sur une carte non notée doit faire échouer ceci.
  test('toutes les cartes NON marquées `_fixture_note` passent réellement le correcteur T2', () => {
    const { toutesLesCartes } = construireLotPilote();
    const nonNotees = toutesLesCartes.filter((c) => !c._fixture_note);
    nonNotees.forEach((c) => {
      const r = evaluerReponse({ profil: c.profil_correction, reponseDonnee: c.reponse, reponsesAcceptees: c.reponses_acceptees });
      assert.equal(r.statut, 'juste', `${c.set_id}/${c.item_id} (${c.reponse}) -> ${r.statut}, inattendu pour une carte non notée`);
    });
  });

  test('exactement 41 cartes sont marquées `_fixture_note: "unite_manquante"`, et toutes échouent réellement pour cette raison (sinon la note est obsolète)', () => {
    const { toutesLesCartes } = construireLotPilote();
    const notees = toutesLesCartes.filter((c) => c._fixture_note === 'unite_manquante');
    assert.equal(notees.length, 41);
    notees.forEach((c) => {
      const r = evaluerReponse({ profil: c.profil_correction, reponseDonnee: c.reponse, reponsesAcceptees: c.reponses_acceptees });
      assert.notEqual(r.statut, 'juste', `${c.set_id}/${c.item_id} passe maintenant le correcteur — retirer sa _fixture_note`);
    });
  });

  test('chaque jeu passe validerJeu (contextes deux-à-deux distincts, anti-clone)', () => {
    const { manifesteJeux, toutesLesCartes } = construireLotPilote();
    manifesteJeux.forEach((jeu) => {
      const cartes = toutesLesCartes.filter((c) => c.set_id === jeu.set_id);
      const r = validerJeu(cartes);
      assert.equal(r.valide, true, `${jeu.set_id} : ${r.erreurs && r.erreurs.join(', ')}`);
    });
  });

  test('toutes les candidates ont statut "attente" et source "T6-pilote" (jamais publiées)', () => {
    const { toutesLesCartes } = construireLotPilote();
    toutesLesCartes.forEach((c) => {
      assert.equal(c.statut, 'attente');
      assert.equal(c.source, 'T6-pilote');
    });
  });

  test('set_id/item_id de toutes les cartes respectent le motif système (Dette T6)', () => {
    const { toutesLesCartes } = construireLotPilote();
    toutesLesCartes.forEach((c) => {
      assert.match(c.set_id, /^set_fonda_[a-z0-9-]+_n[IF]_\d{2}$/);
      assert.match(c.item_id, /^it\d{2}$/);
    });
  });
});

describe('intégration — node fonda/scripts/generer-pilote-t6.js écrit un fichier conforme', () => {
  test('exit code 0, fichier de sortie conforme au manifeste', () => {
    const scriptPath = path.join(__dirname, 'generer-pilote-t6.js');
    let sortie;
    let code = 0;
    try {
      sortie = execFileSync('node', [scriptPath], { encoding: 'utf-8' });
    } catch (err) {
      sortie = err.stdout;
      code = err.status;
    }
    assert.equal(code, 0, sortie);

    const outPath = path.join(__dirname, '..', 'data', 'pilote-t6-relecture.json');
    const data = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    assert.equal(data.total_jeux, 24);
    assert.equal(data.total_cartes, 143);
    assert.equal(data.repartition_relecteur.justine, 72);
    assert.equal(data.repartition_relecteur.eric, 71);
    assert.equal(data.par_relecteur.justine.length, 72);
    assert.equal(data.par_relecteur.eric.length, 71);
    assert.match(data.nature, /FIXTURE TECHNIQUE/);
    data.par_relecteur.justine.concat(data.par_relecteur.eric).forEach((c) => {
      assert.equal(c.statut, 'attente');
    });
  });
});
