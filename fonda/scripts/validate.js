#!/usr/bin/env node
// Validation maison, zéro dépendance, pour les contrats de données Box-FONDA (T1).
// Référence : docs/PRD-Box-FONDA.md §3, §10, §14. Détail des choix d'enveloppe : fonda/data/README.md.
// Usage : node fonda/scripts/validate.js

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const FIXTURES_DIR = path.join(ROOT, 'fixtures');

const ID_PATTERN = /^(fr|maths)\.[a-z0-9-]+$/;
const MATIERES = new Set(['français', 'maths']);
// v2 (référentiel diagnostic évaluations 4e 2026) : "gris" a disparu, remplacé par "rouge".
const PRIORITES = new Set(['rouge', 'ambre', 'vert']);
const PALIERS = new Set(['nI', 'nF']);
const CTX_VALUES = new Set(['df', 'maison', 'classe']);
const RESULT_VALUES = new Set([0, 1]);
// v2 : routing de relecture explicite, une notion par matière unique (G4, AGENTS.md).
const RELECTEURS = new Set(['justine', 'eric']);
const RELECTEUR_ATTENDU = { 'français': 'justine', 'maths': 'eric' };
const AXES = new Set(['Comprendre', 'Représenter', 'Raisonner', 'Exprimer']);

let errors = [];
let checks = 0;

function fail(msg) {
  errors.push(msg);
}

function check(label, fn) {
  checks += 1;
  try {
    fn();
  } catch (e) {
    fail(`${label} : ${e.message}`);
  }
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`JSON invalide dans ${path.relative(ROOT, filePath)} — ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function isString(v) {
  return typeof v === 'string';
}

function isNonEmptyString(v) {
  return isString(v) && v.length > 0;
}

function isArray(v) {
  return Array.isArray(v);
}

function isInt(v) {
  return Number.isInteger(v);
}

// ---------------------------------------------------------------------------
// referentiel.json
// ---------------------------------------------------------------------------

// Enveloppe du référentiel — pas de lecture fichier, réutilisable/testable.
function validateReferentielEnvelopeFields(data) {
  // v2 : version peut être une chaîne ("2.0") — rétro-compatible avec un entier.
  assert(isString(data.version) || isInt(data.version), '"version" doit être une chaîne ou un entier');
  assert(isString(data.last_updated), '"last_updated" doit être une chaîne');
  assert(isArray(data.notions), '"notions" doit être un tableau');
  assert(data.notions.length > 0, '"notions" ne doit pas être vide');
}

/**
 * Valide l'enveloppe du référentiel, sans lecture disque.
 * @returns {{ valide: true } | { valide: false, erreurs: string[] }}
 */
function validerEnveloppeReferentiel(data) {
  try {
    validateReferentielEnvelopeFields(data || {});
    return { valide: true };
  } catch (err) {
    return { valide: false, erreurs: [err.message] };
  }
}

// Une notion isolée — pas de lecture fichier, réutilisable/testable (le doublon d'id
// reste géré à part dans validateReferentiel, qui a seul la vue sur l'ensemble).
// Champs de l'ancien seed (categorie, programme_refs, eval_nat_domaine) RETIRÉS du
// contrat (v2) : categorie -> axe, eval_nat_domaine -> taux_eval.domaine (souple, non
// validé). Champs laissés volontairement souples, non validés : enonce_modele,
// taux_eval, disciplines, micro_competence, ordre, note.
function validateNotionFields(n) {
  assert(isNonEmptyString(n.id), 'id manquant ou vide');
  assert(ID_PATTERN.test(n.id), `id "${n.id}" ne respecte pas le pattern (fr|maths).slug-kebab`);

  assert(MATIERES.has(n.matiere), `matiere "${n.matiere}" invalide (attendu: ${[...MATIERES].join(' | ')})`);
  assert(isNonEmptyString(n.libelle), 'libelle manquant ou vide');

  assert(RELECTEURS.has(n.relecteur), `relecteur "${n.relecteur}" invalide (attendu: ${[...RELECTEURS].join(' | ')})`);
  assert(
    RELECTEUR_ATTENDU[n.matiere] === n.relecteur,
    `relecteur "${n.relecteur}" incohérent avec matiere "${n.matiere}" (attendu: ${RELECTEUR_ATTENDU[n.matiere]})`,
  );

  assert(AXES.has(n.axe), `axe "${n.axe}" invalide (attendu: ${[...AXES].join(' | ')})`);

  assert(
    isArray(n.paliers) && n.paliers.length === 2 && n.paliers[0] === 'nI' && n.paliers[1] === 'nF',
    'paliers doit être exactement ["nI","nF"]',
  );

  assert(PALIERS.has(n.palier_amorce), `palier_amorce "${n.palier_amorce}" invalide (attendu: nI | nF)`);
  assert(n.paliers.includes(n.palier_amorce), `palier_amorce "${n.palier_amorce}" absent de paliers`);

  assert(PRIORITES.has(n.priorite_initiale), `priorite_initiale "${n.priorite_initiale}" invalide (attendu: ${[...PRIORITES].join(' | ')})`);

  assert(isInt(n.frequence_base_semaines) && n.frequence_base_semaines > 0, 'frequence_base_semaines doit être un entier positif');
}

/**
 * Valide UNE notion isolée, sans lecture disque.
 * @returns {{ valide: true } | { valide: false, erreurs: string[] }}
 */
function validerNotion(n) {
  try {
    validateNotionFields(n || {});
    return { valide: true };
  } catch (err) {
    return { valide: false, erreurs: [err.message] };
  }
}

function validateReferentiel() {
  const file = path.join(DATA_DIR, 'referentiel.json');
  const data = readJson(file);

  check('referentiel.json : enveloppe', () => validateReferentielEnvelopeFields(data));

  const seenIds = new Set();
  const notionIds = new Set();

  (data.notions || []).forEach((n, i) => {
    const where = `notions[${i}] (${n && n.id ? n.id : '?'})`;

    check(`referentiel.json : ${where} — champs`, () => {
      assert(!seenIds.has(n.id), `id "${n.id}" en doublon`);
      seenIds.add(n.id);
      notionIds.add(n.id);
      validateNotionFields(n); // id manquant/mal formé : détecté ici (source unique de vérité)
    });
  });

  return notionIds;
}

// ---------------------------------------------------------------------------
// calendar.json / coverage.json / dashboard.json — enveloppes vides T1
// ---------------------------------------------------------------------------

function validateCalendar() {
  const file = path.join(DATA_DIR, 'calendar.json');
  const data = readJson(file);
  check('calendar.json : enveloppe', () => {
    assert(isInt(data.version), '"version" doit être un entier');
    assert(isString(data.last_updated), '"last_updated" doit être une chaîne');
    assert(isArray(data.semaines), '"semaines" doit être un tableau');
  });
}

function validateCoverage() {
  const file = path.join(DATA_DIR, 'coverage.json');
  const data = readJson(file);
  check('coverage.json : enveloppe', () => {
    assert(isInt(data.version), '"version" doit être un entier');
    assert(isString(data.last_updated), '"last_updated" doit être une chaîne');
    assert(isArray(data.notions), '"notions" doit être un tableau');
  });
}

function validateDashboard() {
  const file = path.join(DATA_DIR, 'dashboard.json');
  const data = readJson(file);
  check('dashboard.json : enveloppe', () => {
    assert(isInt(data.version), '"version" doit être un entier');
    assert(isString(data.last_updated), '"last_updated" doit être une chaîne');
    assert(isArray(data.par_groupe), '"par_groupe" doit être un tableau');
    assert(data.agrege_etablissement && typeof data.agrege_etablissement === 'object', '"agrege_etablissement" doit être un objet');
    const adoption = data.agrege_etablissement.adoption || {};
    ['n_profs', 'n_matieres', 'n_jeux', 'n_revisions'].forEach((k) => {
      assert(isInt(adoption[k]), `agrege_etablissement.adoption.${k} doit être un entier`);
    });
    assert(isArray(data.agrege_etablissement.delta_par_notion), '"agrege_etablissement.delta_par_notion" doit être un tableau');
  });
}

// ---------------------------------------------------------------------------
// fixtures/events.sample.json
// ---------------------------------------------------------------------------

// Liste blanche stricte du schéma PRD §3.2 — AUCUN autre champ n'est toléré (G3 : un
// champ supplémentaire, même anodin en apparence — "uuid", "ip", "device" — est une
// fuite potentielle d'identifiant individuel, donc un rejet, pas juste les noms
// explicitement nominatifs).
// Exporté en tableau GELÉ, pas en Set : Object.freeze() sur un Set ne bloque pas
// .add()/.delete() (ce sont des méthodes qui touchent un slot interne, pas une
// propriété — freeze() ne les voit pas). Un tableau figé, lui, lève vraiment sur
// toute tentative de mutation. Le Set de travail est reconstruit à chaque usage à
// partir de cette source gelée, jamais partagé muable.
const EVENT_FIELDS_LIST = Object.freeze([
  'ts', 'grp', 'defi_id', 'notion_id', 'palier', 'set_id', 'item_id',
  'result', 'ctx', 'rang_local', 'dt_jours',
]);

// Validation d'UN événement isolé — pas de lecture fichier, réutilisable (T3 : avant
// mise en file d'un événement construit par fonda/engine/evenements.js).
function validateEventFields(e, notionIds) {
  assert(e && typeof e === 'object' && !Array.isArray(e), 'un événement doit être un objet');

  const champsAutorises = new Set(EVENT_FIELDS_LIST);
  Object.keys(e).forEach((k) => {
    assert(champsAutorises.has(k), `champ "${k}" hors schéma §3.2 (liste blanche stricte)`);
  });

  assert(isNonEmptyString(e.ts), 'ts manquant');
  assert(!Number.isNaN(Date.parse(e.ts)), `ts "${e.ts}" n'est pas une date ISO valide`);

  assert(isNonEmptyString(e.grp), 'grp manquant ou vide');
  assert(isNonEmptyString(e.defi_id), 'defi_id manquant ou vide');

  assert(isNonEmptyString(e.notion_id), 'notion_id manquant ou vide');
  assert(notionIds.has(e.notion_id), `notion_id "${e.notion_id}" absent de referentiel.json`);

  assert(PALIERS.has(e.palier), `palier "${e.palier}" invalide (attendu: nI | nF)`);
  assert(isNonEmptyString(e.set_id), 'set_id manquant ou vide');
  assert(isNonEmptyString(e.item_id), 'item_id manquant ou vide');

  assert(RESULT_VALUES.has(e.result), `result "${e.result}" invalide (attendu: 0 | 1)`);
  assert(CTX_VALUES.has(e.ctx), `ctx "${e.ctx}" invalide (attendu: df | maison | classe)`);

  assert(isInt(e.rang_local) && e.rang_local >= 1, 'rang_local doit être un entier >= 1');
  if (e.rang_local === 1) {
    assert(e.dt_jours === null, 'dt_jours doit être null au rang_local 1 (pas de tentative précédente)');
  } else {
    assert((isInt(e.dt_jours) || typeof e.dt_jours === 'number') && e.dt_jours >= 0, 'dt_jours doit être un nombre >= 0 au-delà du rang_local 1');
  }
}

function validateEventsSample(notionIds) {
  const file = path.join(FIXTURES_DIR, 'events.sample.json');
  const data = readJson(file);

  check('events.sample.json : enveloppe', () => {
    assert(isArray(data.events), '"events" doit être un tableau');
    assert(data.events.length > 0, '"events" ne doit pas être vide');
  });

  (data.events || []).forEach((e, i) => {
    const where = `events[${i}]`;
    check(`events.sample.json : ${where}`, () => validateEventFields(e, notionIds));
  });
}

/**
 * Valide UN événement isolé, sans accès disque — pour réutilisation hors de ce script
 * (T3 : juste avant de mettre un événement en file d'émission). `notionIds` peut être
 * un Set ou un tableau d'ids valides (ex. relu depuis referentiel.json).
 * @returns {{ valide: true } | { valide: false, erreurs: string[] }}
 */
function validerEvenement(e, notionIds) {
  const ids = notionIds instanceof Set ? notionIds : new Set(notionIds || []);
  try {
    validateEventFields(e, ids);
    return { valide: true };
  } catch (err) {
    return { valide: false, erreurs: [err.message] };
  }
}

module.exports = { validerEvenement, EVENT_FIELDS_LIST, validerNotion, validerEnveloppeReferentiel };

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

function main() {
  check('fichiers présents', () => {
    [
      'data/referentiel.json',
      'data/calendar.json',
      'data/coverage.json',
      'data/dashboard.json',
      'fixtures/events.sample.json',
    ].forEach((rel) => {
      assert(fs.existsSync(path.join(ROOT, rel)), `fichier manquant : fonda/${rel}`);
    });
  });

  let notionIds = new Set();
  if (errors.length === 0) {
    notionIds = validateReferentiel();
    validateCalendar();
    validateCoverage();
    validateDashboard();
    validateEventsSample(notionIds);
  }

  console.log(`Box-FONDA — validation des contrats de données (T1)`);
  console.log(`${checks} vérification(s) exécutée(s).`);

  if (errors.length > 0) {
    console.log(`\n${errors.length} erreur(s) :\n`);
    errors.forEach((e) => console.log(`  ✗ ${e}`));
    process.exitCode = 1;
  } else {
    console.log('✓ Tout est conforme.');
    process.exitCode = 0;
  }
}

if (require.main === module) {
  main();
}
