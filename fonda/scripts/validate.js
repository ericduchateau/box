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
const PRIORITES = new Set(['gris', 'ambre']);
const PALIERS = new Set(['nI', 'nF']);
const CTX_VALUES = new Set(['df', 'maison', 'classe']);
const RESULT_VALUES = new Set([0, 1]);

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

function isStringArray(v) {
  return isArray(v) && v.every(isString);
}

function isInt(v) {
  return Number.isInteger(v);
}

// ---------------------------------------------------------------------------
// referentiel.json
// ---------------------------------------------------------------------------

function validateReferentiel() {
  const file = path.join(DATA_DIR, 'referentiel.json');
  const data = readJson(file);

  check('referentiel.json : enveloppe', () => {
    assert(isInt(data.version), '"version" doit être un entier');
    assert(isString(data.last_updated), '"last_updated" doit être une chaîne');
    assert(isArray(data.notions), '"notions" doit être un tableau');
    assert(data.notions.length > 0, '"notions" ne doit pas être vide');
  });

  const seenIds = new Set();
  const notionIds = new Set();

  (data.notions || []).forEach((n, i) => {
    const where = `notions[${i}] (${n && n.id ? n.id : '?'})`;

    check(`referentiel.json : ${where} — champs`, () => {
      assert(isNonEmptyString(n.id), 'id manquant ou vide');
      assert(ID_PATTERN.test(n.id), `id "${n.id}" ne respecte pas le pattern (fr|maths).slug-kebab`);
      assert(!seenIds.has(n.id), `id "${n.id}" en doublon`);
      seenIds.add(n.id);
      notionIds.add(n.id);

      assert(MATIERES.has(n.matiere), `matiere "${n.matiere}" invalide (attendu: ${[...MATIERES].join(' | ')})`);
      assert(isNonEmptyString(n.categorie), 'categorie manquante ou vide');
      assert(isNonEmptyString(n.libelle), 'libelle manquant ou vide');
      assert(isStringArray(n.programme_refs), 'programme_refs doit être un tableau de chaînes');
      assert(isNonEmptyString(n.eval_nat_domaine), 'eval_nat_domaine manquant ou vide');

      assert(isArray(n.paliers) && n.paliers.length > 0, 'paliers doit être un tableau non vide');
      n.paliers.forEach((p) => assert(PALIERS.has(p), `palier "${p}" invalide (attendu: nI | nF)`));

      assert(isArray(n.palier_amorce) && n.palier_amorce.length > 0, 'palier_amorce doit être un tableau non vide');
      n.palier_amorce.forEach((p) => assert(PALIERS.has(p), `palier_amorce "${p}" invalide (attendu: nI | nF)`));
      n.palier_amorce.forEach((p) => assert(n.paliers.includes(p), `palier_amorce "${p}" absent de paliers`));

      assert(PRIORITES.has(n.priorite_initiale), `priorite_initiale "${n.priorite_initiale}" invalide (attendu: gris | ambre)`);

      assert(isInt(n.frequence_base_semaines) && n.frequence_base_semaines > 0, 'frequence_base_semaines doit être un entier positif');
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
const EVENT_FIELDS = new Set([
  'ts', 'grp', 'defi_id', 'notion_id', 'palier', 'set_id', 'item_id',
  'result', 'ctx', 'rang_local', 'dt_jours',
]);

// Validation d'UN événement isolé — pas de lecture fichier, réutilisable (T3 : avant
// mise en file d'un événement construit par fonda/engine/evenements.js).
function validateEventFields(e, notionIds) {
  assert(e && typeof e === 'object' && !Array.isArray(e), 'un événement doit être un objet');

  Object.keys(e).forEach((k) => {
    assert(EVENT_FIELDS.has(k), `champ "${k}" hors schéma §3.2 (liste blanche stricte)`);
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

module.exports = { validerEvenement, EVENT_FIELDS };

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
