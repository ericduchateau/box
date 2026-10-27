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

// --- calendar.json v2 -------------------------------------------------------------
const { validerCalendrier } = require('./validate.js');
const REFERENTIEL = require('../data/referentiel.json');
const CATALOGUE = require('../data/catalogue-fonda.json');
const CALENDRIER_REEL = require('../data/calendar.json');

function calendrierMinimal() {
  return {
    version: 2,
    last_updated: '2026-10-27',
    annee_scolaire: '2026-2027',
    zone: 'B',
    source_vacances: 'source officielle',
    vacances: [{ libelle: 'Vacances de la Toussaint', du: '2026-10-17', au: '2026-11-01', reprise: '2026-11-02' }],
    periodes: [{ id: 'P2', libelle: 'Toussaint → Noël', du: '2026-11-02', au: '2026-12-18', bandes: { 'c4-milieu': { genere: false, bilan: '', justification: '' } } }],
    semaines: [{
      iso_week: 45, du: '2026-11-02', au: '2026-11-06', periode_id: 'P2',
      entrees: [
        { notion_id: 'maths.grandeurs-mesures', matiere: 'maths', palier: 'nI', bande: 'c4-milieu', difficulte: { valeur: 'rouge', source: 'priorite_initiale' }, statut: 'publie', set_id: 'set_fonda_grandeurs-mesures_nI_02' },
        { notion_id: 'fr.comprendre-consigne', matiere: 'français', palier: 'nI', bande: 'c4-milieu', difficulte: { valeur: 'rouge', source: 'priorite_initiale' }, statut: 'planifie' },
      ],
    }],
  };
}
const valider = (cal) => validerCalendrier(cal, { referentiel: REFERENTIEL, catalogue: CATALOGUE });
function refuse(modifier, motif) {
  const cal = calendrierMinimal();
  modifier(cal);
  const r = valider(cal);
  assert.equal(r.valide, false, `attendu refusé : ${motif}`);
  assert.ok(r.erreurs.some((e) => motif.test(e)), `motif ${motif} absent de : ${r.erreurs.join(' | ')}`);
}

describe('validerCalendrier — calendar.json v2 (bandes, entrées planifiées, catalogue publié)', () => {
  test('le calendrier minimal conforme est valide', () => {
    assert.deepEqual(valider(calendrierMinimal()), { valide: true });
  });

  test('le VRAI calendar.json est valide contre le vrai référentiel et le vrai catalogue', () => {
    assert.deepEqual(valider(CALENDRIER_REEL), { valide: true });
  });

  test('contrainte dure : set_id non publié, ou publié pour une autre notion/palier -> refus', () => {
    refuse((c) => { c.semaines[0].entrees[0].set_id = 'set_fonda_grandeurs-mesures_nI_91'; }, /non publié au catalogue/);
    refuse((c) => { c.semaines[0].entrees[0].set_id = 'set_fonda_nombres-fractions-relatifs_nI_03'; }, /publié pour maths\.nombres-fractions-relatifs/);
    refuse((c) => { c.semaines[0].entrees[0].palier = 'nF'; }, /publié pour maths\.grandeurs-mesures\/nI/);
    refuse((c) => { delete c.semaines[0].entrees[0].set_id; }, /non publié au catalogue/);
  });

  test('entrée planifiée : aucun set_id, même publié', () => {
    refuse((c) => { c.semaines[0].entrees[1].set_id = 'set_fonda_comprendre-consigne_nI_01'; }, /planifiée n'a pas de set_id/);
  });

  test('enums, champs hors schéma, notion inconnue ou exclue, matière incohérente', () => {
    refuse((c) => { c.semaines[0].entrees[0].bande = 'c5'; }, /bande "c5" invalide/);
    refuse((c) => { c.semaines[0].entrees[0].statut = 'valide'; }, /statut "valide" invalide/);
    refuse((c) => { c.semaines[0].entrees[0].palier = 'n0'; }, /palier "n0" invalide/);
    refuse((c) => { c.semaines[0].entrees[0].niveau_cible = '5e'; }, /champ "niveau_cible" hors schéma/);
    refuse((c) => { c.semaines[0].entrees[1].notion_id = 'fr.inexistante'; }, /absent du référentiel/);
    refuse((c) => { Object.assign(c.semaines[0].entrees[0], { notion_id: 'maths.geometrie', statut: 'planifie' }); delete c.semaines[0].entrees[0].set_id; }, /exclue \(figures\)/);
    refuse((c) => { c.semaines[0].entrees[1].matiere = 'maths'; }, /matiere "maths" ≠ référentiel/);
  });

  test('difficulté : valeur/source dans l\'enum ; source priorite_initiale = valeur du référentiel', () => {
    refuse((c) => { c.semaines[0].entrees[0].difficulte.valeur = 'nouvelle'; }, /difficulte\.valeur "nouvelle" invalide/);
    refuse((c) => { c.semaines[0].entrees[0].difficulte.source = 'intuition'; }, /difficulte\.source "intuition" invalide/);
    refuse((c) => { c.semaines[0].entrees[0].difficulte.valeur = 'vert'; }, /≠ priorite_initiale rouge/);
    const cal = calendrierMinimal();
    cal.semaines[0].entrees[0].difficulte = { valeur: 'vert', source: 'stats_cartes' };
    assert.deepEqual(valider(cal), { valide: true }, 'source stats_cartes : la couleur peut s\'écarter du diagnostic');
  });

  test('au plus une fiche par matière et par bande dans une semaine', () => {
    refuse((c) => {
      c.semaines[0].entrees.push({ notion_id: 'maths.proportionnalite', matiere: 'maths', palier: 'nI', bande: 'c4-milieu', difficulte: { valeur: 'ambre', source: 'priorite_initiale' }, statut: 'planifie' });
    }, /deux entrées maths pour la bande c4-milieu/);
    const cal = calendrierMinimal();
    cal.semaines[0].entrees.push({ notion_id: 'maths.proportionnalite', matiere: 'maths', palier: 'nI', bande: 'c3', difficulte: { valeur: 'ambre', source: 'priorite_initiale' }, statut: 'planifie' });
    assert.deepEqual(valider(cal), { valide: true }, 'une autre bande peut avoir sa propre fiche maths');
  });

  test('dates : semaine ISO cohérente, lundi, incluse dans sa période, jamais pendant les vacances', () => {
    refuse((c) => { c.semaines[0].iso_week = 46; }, /pas dans la semaine ISO 46/);
    refuse((c) => { c.semaines[0].du = '2026-11-03'; }, /doit être un lundi/);
    refuse((c) => { c.semaines[0].au = '2026-11-31'; }, /date AAAA-MM-JJ valide/);
    refuse((c) => { c.semaines[0].periode_id = 'P3'; }, /periode_id "P3" inconnu/);
    refuse((c) => { Object.assign(c.semaines[0], { iso_week: 44, du: '2026-10-26', au: '2026-10-30' }); }, /hors de sa période|pendant Vacances/);
    refuse((c) => { c.periodes[0].du = '2026-10-30'; }, /chevauche Vacances de la Toussaint/);
    refuse((c) => { c.vacances[0].reprise = '2026-11-01'; }, /"reprise" doit être une date après "au"/);
    refuse((c) => { c.semaines.push({ ...c.semaines[0], entrees: [] }); }, /iso_week en doublon/);
  });

  test('genere : exige un bilan et toutes les entrées de la période publiées', () => {
    refuse((c) => { c.periodes[0].bandes['c4-milieu'].genere = true; }, /période générée sans bilan/);
    refuse((c) => { Object.assign(c.periodes[0].bandes['c4-milieu'], { genere: true, bilan: 'Bilan.' }); }, /"genere" exige que toutes les entrées/);
    const cal = calendrierMinimal();
    Object.assign(cal.periodes[0].bandes['c4-milieu'], { genere: true, bilan: 'Bilan.' });
    cal.semaines[0].entrees.pop();
    assert.deepEqual(valider(cal), { valide: true });
    refuse((c) => { c.periodes[0].bandes.c9 = { genere: false, bilan: '', justification: '' }; }, /bande "c9" inconnue/);
  });

  test('cohérence calendaire : zone B, années consécutives encadrant les dates, semaine lun→ven, reprise = début de période', () => {
    refuse((c) => { c.zone = 'A'; }, /"zone" "A"/);
    refuse((c) => { c.annee_scolaire = '2040-2001'; }, /années non consécutives/);
    refuse((c) => { c.annee_scolaire = '2027-2028'; }, /hors de l'année scolaire 2027-2028/);
    refuse((c) => { c.semaines[0].au = '2026-11-02'; }, /"au" doit être le vendredi/);
    refuse((c) => { c.semaines[0].au = '2026-11-08'; }, /"au" doit être le vendredi/);
    refuse((c) => { c.vacances[0].reprise = '2026-11-09'; }, /la reprise 2026-11-09 n'est le début d'aucune période/);
    const ete = calendrierMinimal();
    ete.vacances.push({ libelle: "Vacances d'été", du: '2027-07-03', au: '2027-09-01', reprise: '2027-09-02' });
    assert.deepEqual(valider(ete), { valide: true }, 'la reprise de septembre n\'ouvre aucune période de cette année');
  });

  test('reprises : exception estivale explicite (rentrée suivante), fins et reprises bornées', () => {
    const reel = () => JSON.parse(JSON.stringify(CALENDRIER_REEL));
    const motif = (cal, re) => { const r = valider(cal); assert.equal(r.valide, false); assert.ok(r.erreurs.some((e) => re.test(e)), r.erreurs.join(' | ')); };
    const toussaint = reel(); toussaint.vacances[0].reprise = '2099-11-02';
    motif(toussaint, /reprise hors de l'année scolaire/);
    const ete = reel(); Object.assign(ete.vacances[4], { au: '2099-09-01', reprise: '2099-09-02' });
    motif(ete, /reprise hors de la rentrée suivante/);
    const sansP5 = reel(); sansP5.periodes = sansP5.periodes.filter((p) => p.id !== 'P5');
    motif(sansP5, /reprise 2027-05-03 n'est le début d'aucune période/);
    const toussaintSept = reel(); toussaintSept.vacances[0].reprise = '2027-09-02';
    motif(toussaintSept, /hors de l'année scolaire/);
    const printempsSept = reel(); printempsSept.vacances[3].reprise = '2027-09-02';
    printempsSept.periodes = printempsSept.periodes.filter((p) => p.id !== 'P5');
    assert.equal(valider(printempsSept).valide, false, 'l\'exception estivale ne vaut que pour les vacances d\'été');
    const finNoel = reel(); finNoel.vacances[1].au = '2027-08-20';
    assert.equal(valider(finNoel).valide, false, 'fin de vacances (hors été) au-delà de l\'année : refusée');
  });

  test('enveloppe : version 2 obligatoire, source des vacances citée', () => {
    refuse((c) => { c.version = 1; }, /"version" doit valoir 2/);
    refuse((c) => { delete c.source_vacances; }, /source_vacances/);
    assert.equal(validerCalendrier(null, {}).valide, false);
  });
});
