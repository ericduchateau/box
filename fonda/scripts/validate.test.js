// Suite de tests — validateur de contrats de données Box-FONDA (fonda/scripts/validate.js).
// Écrite AVANT l'adaptation au schéma v2 du référentiel (diagnostic évaluations 4e 2026),
// comme demandé : « c'est le validateur qui s'aligne, pas le référentiel ». Zéro
// dépendance, test runner natif Node.
//
// Usage : node --test fonda/scripts/validate.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { validerNotion, validerEnveloppeReferentiel, validerEvenement } = require('./validate.js');

const NOTION_VALIDE = {
  id: 'fr.comprendre-consigne',
  matiere: 'français',
  relecteur: 'justine',
  axe: 'Comprendre',
  libelle: 'Comprendre une consigne et sélectionner l\'information utile',
  paliers: ['nI', 'nF'],
  palier_amorce: 'nI',
  priorite_initiale: 'rouge',
  frequence_base_semaines: 4,
};

describe('validerNotion — schéma v2 du référentiel (diagnostic évaluations 4e 2026)', () => {
  test('une notion conforme au schéma v2 est valide', () => {
    const r = validerNotion(NOTION_VALIDE);
    assert.equal(r.valide, true, r.erreurs && r.erreurs.join(', '));
  });

  test('palier_amorce est désormais une CHAÎNE (pas un tableau) ∈ {nI, nF}', () => {
    assert.equal(validerNotion({ ...NOTION_VALIDE, palier_amorce: 'nF' }).valide, true);
    assert.equal(validerNotion({ ...NOTION_VALIDE, palier_amorce: ['nI'] }).valide, false, 'un tableau doit être rejeté');
    assert.equal(validerNotion({ ...NOTION_VALIDE, palier_amorce: 'n0' }).valide, false, '"n0" interdit (convention AGENTS.md)');
  });

  test('palier_amorce doit être présent dans paliers', () => {
    assert.equal(validerNotion({ ...NOTION_VALIDE, paliers: ['nI', 'nF'], palier_amorce: 'nF' }).valide, true);
  });

  test('priorite_initiale ∈ {rouge, ambre, vert} ; "gris" (ancien seed) n\'existe plus', () => {
    for (const p of ['rouge', 'ambre', 'vert']) {
      assert.equal(validerNotion({ ...NOTION_VALIDE, priorite_initiale: p }).valide, true, p);
    }
    assert.equal(validerNotion({ ...NOTION_VALIDE, priorite_initiale: 'gris' }).valide, false);
  });

  test('categorie / programme_refs / eval_nat_domaine (ancien seed) ne sont plus requis', () => {
    assert.equal('categorie' in NOTION_VALIDE, false);
    assert.equal('programme_refs' in NOTION_VALIDE, false);
    assert.equal('eval_nat_domaine' in NOTION_VALIDE, false);
    assert.equal(validerNotion(NOTION_VALIDE).valide, true);
  });

  test('id : motif ^(fr|maths)\\.[a-z0-9-]+$ (inchangé)', () => {
    assert.equal(validerNotion({ ...NOTION_VALIDE, id: 'fr.ok-slug' }).valide, true);
    assert.equal(validerNotion({ ...NOTION_VALIDE, id: 'FR.majuscule' }).valide, false);
    assert.equal(validerNotion({ ...NOTION_VALIDE, id: 'svt.hors-matiere' }).valide, false);
  });

  test('matiere ∈ {français, maths} (inchangé)', () => {
    assert.equal(validerNotion({ ...NOTION_VALIDE, matiere: 'anglais' }).valide, false);
  });

  test('relecteur ∈ {justine, eric}, et cohérent avec matiere (français⇔justine, maths⇔eric)', () => {
    assert.equal(validerNotion({ ...NOTION_VALIDE, matiere: 'français', relecteur: 'justine' }).valide, true);
    assert.equal(validerNotion({ ...NOTION_VALIDE, matiere: 'maths', relecteur: 'eric', id: 'maths.ok' }).valide, true);
    assert.equal(validerNotion({ ...NOTION_VALIDE, matiere: 'français', relecteur: 'eric' }).valide, false, 'français doit router vers justine');
    assert.equal(validerNotion({ ...NOTION_VALIDE, matiere: 'maths', relecteur: 'justine', id: 'maths.ok' }).valide, false, 'maths doit router vers eric');
    assert.equal(validerNotion({ ...NOTION_VALIDE, relecteur: 'quelquun-dautre' }).valide, false);
  });

  test('axe ∈ {Comprendre, Représenter, Raisonner, Exprimer}', () => {
    for (const axe of ['Comprendre', 'Représenter', 'Raisonner', 'Exprimer']) {
      assert.equal(validerNotion({ ...NOTION_VALIDE, axe }).valide, true, axe);
    }
    assert.equal(validerNotion({ ...NOTION_VALIDE, axe: 'Mémoriser' }).valide, false);
  });

  test('paliers doit être exactement ["nI","nF"], dans cet ordre', () => {
    assert.equal(validerNotion({ ...NOTION_VALIDE, paliers: ['nI', 'nF'] }).valide, true);
    assert.equal(validerNotion({ ...NOTION_VALIDE, paliers: ['nF', 'nI'] }).valide, false);
    assert.equal(validerNotion({ ...NOTION_VALIDE, paliers: ['nI'] }).valide, false);
  });

  test('champs laissés souples (ordre, note, disciplines, micro_competence, enonce_modele, taux_eval) : présents ou absents, aucun impact', () => {
    assert.equal(validerNotion(NOTION_VALIDE).valide, true); // tous absents
    assert.equal(validerNotion({
      ...NOTION_VALIDE,
      ordre: 1,
      note: 'une note libre',
      disciplines: ['toutes'],
      micro_competence: 'texte libre',
      enonce_modele: ['énoncé 1', 'énoncé 2'],
      taux_eval: { domaine: 'x', satisfaisant_college: 27.3, items: [40.4] },
    }).valide, true); // tous présents, types variés
  });

  test('frequence_base_semaines : entier positif (inchangé)', () => {
    assert.equal(validerNotion({ ...NOTION_VALIDE, frequence_base_semaines: 0 }).valide, false);
    assert.equal(validerNotion({ ...NOTION_VALIDE, frequence_base_semaines: -1 }).valide, false);
  });
});

describe('validerEnveloppeReferentiel — version accepte désormais une chaîne', () => {
  test('version en chaîne (ex. "2.0") -> valide', () => {
    const r = validerEnveloppeReferentiel({ version: '2.0', last_updated: '2026-10-05', notions: [NOTION_VALIDE] });
    assert.equal(r.valide, true, r.erreurs && r.erreurs.join(', '));
  });

  test('version en entier -> toujours valide (rétro-compatible)', () => {
    assert.equal(validerEnveloppeReferentiel({ version: 1, last_updated: '2026-10-05', notions: [NOTION_VALIDE] }).valide, true);
  });

  test('notions vide -> invalide (inchangé)', () => {
    assert.equal(validerEnveloppeReferentiel({ version: '2.0', last_updated: '', notions: [] }).valide, false);
  });
});

describe('garde-fou déjà présent avant ce ticket — notion_id d\'un événement doit exister dans referentiel.json', () => {
  test('notion_id absent du référentiel -> invalide (c\'est ce contrôle qui a détecté la divergence de la fixture)', () => {
    const notionIds = new Set(['fr.comprendre-consigne']);
    const event = {
      ts: '2026-10-05T10:00:00Z', grp: '601', defi_id: 'd', notion_id: 'maths.inexistante',
      palier: 'nI', set_id: 's', item_id: 'i', result: 1, ctx: 'classe', rang_local: 1, dt_jours: null,
    };
    assert.equal(validerEvenement(event, notionIds).valide, false);
  });
});

describe('intégration — node fonda/scripts/validate.js sur les vraies données (référentiel v2 + fixture retargetée)', () => {
  test('exit code 0, zéro erreur', () => {
    const scriptPath = path.join(__dirname, 'validate.js');
    let sortie;
    let code = 0;
    try {
      sortie = execFileSync('node', [scriptPath], { encoding: 'utf-8' });
    } catch (err) {
      sortie = err.stdout;
      code = err.status;
    }
    assert.equal(code, 0, sortie);
    assert.match(sortie, /Tout est conforme/);
  });
});
