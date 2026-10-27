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
// calendar.json — v2 (calendrier FONDA réel : vacances zone B, périodes, bandes)
// ---------------------------------------------------------------------------

// Bandes : source unique fonda/engine/liens.js (BANDES). Notions exclues (figures
// indispensables) : source unique fonda/scripts/generer-lot-fonda.js. Chargés à la
// demande : liens.js -> evenements.js -> ce fichier (dépendance circulaire au chargement).
function sourcesCalendrier() {
  return {
    BANDES: require('../engine/liens.js').BANDES,
    NOTIONS_EXCLUES_FIGURES: require('./generer-lot-fonda.js').NOTIONS_EXCLUES_FIGURES,
  };
}

const STATUTS_ENTREE = new Set(['publie', 'planifie']);
// « nouvelle » (notion pas encore mesurée) n'aura de sens qu'avec source stats_cartes :
// à ajouter ici le jour où les statistiques agrégées existent, pas avant.
const DIFFICULTES = new Set(['rouge', 'ambre', 'vert']);
const SOURCES_DIFFICULTE = new Set(['priorite_initiale', 'stats_cartes']);
const CHAMPS_ENTREE = new Set(['notion_id', 'matiere', 'palier', 'bande', 'difficulte', 'statut', 'set_id']);
const PERIODE_ID = /^P[1-9]$/;
const JOUR_MS = 86400000;

// 'AAAA-MM-JJ' -> jours depuis l'époque (UTC), ou NaN si la date n'existe pas.
function jourIso(v) {
  if (!isString(v) || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return NaN;
  const t = Date.UTC(Number(v.slice(0, 4)), Number(v.slice(5, 7)) - 1, Number(v.slice(8, 10)));
  return new Date(t).toISOString().slice(0, 10) === v ? t / JOUR_MS : NaN;
}

function semaineIso(jour) {
  const d = new Date(jour * JOUR_MS);
  const jeudi = jour + 3 - ((d.getUTCDay() + 6) % 7);
  const an = new Date(jeudi * JOUR_MS).getUTCFullYear();
  return 1 + Math.floor((jeudi - Date.UTC(an, 0, 1) / JOUR_MS) / 7);
}

function intervalle(o, ou) {
  const du = jourIso(o && o.du);
  const au = jourIso(o && o.au);
  assert(!Number.isNaN(du), `${ou} : "du" doit être une date AAAA-MM-JJ valide`);
  assert(!Number.isNaN(au), `${ou} : "au" doit être une date AAAA-MM-JJ valide`);
  assert(du <= au, `${ou} : "du" postérieur à "au"`);
  return [du, au];
}

const seChevauchent = (a, b) => a[0] <= b[1] && b[0] <= a[1];

/**
 * Valide calendar.json v2 contre le référentiel et le catalogue PUBLIÉ, sans disque.
 * Contrainte dure : une entrée ne pointe un set_id QUE s'il est publié au catalogue
 * (même notion, même palier) ; une entrée planifiée n'a pas de set_id.
 * @returns {{ valide: true } | { valide: false, erreurs: string[] }}
 */
function validerCalendrier(cal, { referentiel, catalogue } = {}) {
  const { BANDES, NOTIONS_EXCLUES_FIGURES } = sourcesCalendrier();
  const erreurs = [];
  const verifier = (fn) => { try { fn(); } catch (e) { erreurs.push(e.message); } };
  const notions = new Map(((referentiel && referentiel.notions) || []).map((n) => [n.id, n]));
  const publies = new Map(((catalogue && catalogue.lots) || []).map((l) => [l.set_id, l]));
  const c = cal || {};

  verifier(() => {
    assert(c.version === 2, '"version" doit valoir 2');
    assert(isString(c.last_updated), '"last_updated" doit être une chaîne');
    assert(isString(c.annee_scolaire) && /^\d{4}-\d{4}$/.test(c.annee_scolaire), '"annee_scolaire" attendu AAAA-AAAA');
    assert(Number(c.annee_scolaire.slice(5)) === Number(c.annee_scolaire.slice(0, 4)) + 1, `"annee_scolaire" ${c.annee_scolaire} : années non consécutives`);
    assert(c.zone === 'B', `"zone" "${c.zone}" : le collège (Lille) est en zone B`);
    assert(isNonEmptyString(c.source_vacances), '"source_vacances" manquante (dates officielles citées)');
    ['vacances', 'periodes', 'semaines'].forEach((k) => assert(isArray(c[k]), `"${k}" doit être un tableau`));
  });
  if (erreurs.length) return { valide: false, erreurs };

  // L'année scolaire AAAA-BBBB encadre toutes les dates : du 15 août AAAA au 31 juillet
  // BBBB. Seules les vacances d'été — identifiées par leur DÉBUT (à partir du 1er juin
  // BBBB) — ont leur fin et leur reprise (la rentrée suivante, du 15 août au 30 septembre
  // BBBB) hors de l'année ; toutes les autres reprennent dans l'année, sur une période.
  const debutAnnee = jourIso(`${c.annee_scolaire.slice(0, 4)}-08-15`);
  const finAnnee = jourIso(`${c.annee_scolaire.slice(5)}-07-31`);
  const rentreeSuivante = jourIso(`${c.annee_scolaire.slice(5)}-08-15`);
  const debutEte = jourIso(`${c.annee_scolaire.slice(5)}-06-01`);
  const estEte = (v) => jourIso(v.du) >= debutEte;
  const limiteEte = jourIso(`${c.annee_scolaire.slice(5)}-09-30`);
  const dansAnnee = (jour, ou) => assert(jour >= debutAnnee && jour <= finAnnee, `${ou} hors de l'année scolaire ${c.annee_scolaire}`);

  const vacances = [];
  c.vacances.forEach((v, i) => verifier(() => {
    const ou = `vacances[${i}]`;
    assert(isNonEmptyString(v.libelle), `${ou} : libelle manquant`);
    const iv = intervalle(v, ou);
    const reprise = jourIso(v.reprise);
    assert(!Number.isNaN(reprise) && reprise > iv[1], `${ou} : "reprise" doit être une date après "au"`);
    dansAnnee(iv[0], `${ou} : début`);
    if (estEte(v)) {
      assert(reprise >= rentreeSuivante && reprise <= limiteEte, `${ou} : reprise hors de la rentrée suivante (15 août – 30 septembre)`);
    } else {
      dansAnnee(iv[1], `${ou} : fin`);
      dansAnnee(reprise, `${ou} : reprise`);
    }
    vacances.forEach((w) => assert(!seChevauchent(iv, w.iv), `${ou} chevauche ${w.libelle}`));
    vacances.push({ libelle: v.libelle, iv });
  }));

  const periodes = new Map();
  c.periodes.forEach((p, i) => verifier(() => {
    const ou = `periodes[${i}] (${p && p.id})`;
    assert(PERIODE_ID.test(p.id || ''), `${ou} : id attendu P1..P9`);
    assert(!periodes.has(p.id), `${ou} : id en doublon`);
    assert(isNonEmptyString(p.libelle), `${ou} : libelle manquant`);
    const iv = intervalle(p, ou);
    dansAnnee(iv[0], `${ou} : début`);
    dansAnnee(iv[1], `${ou} : fin`);
    periodes.forEach((q, id) => assert(!seChevauchent(iv, q.iv), `${ou} chevauche ${id}`));
    vacances.forEach((v) => assert(!seChevauchent(iv, v.iv), `${ou} chevauche ${v.libelle}`));
    assert(p.bandes && typeof p.bandes === 'object' && !isArray(p.bandes), `${ou} : "bandes" doit être un objet`);
    Object.entries(p.bandes).forEach(([b, etat]) => {
      assert(Object.prototype.hasOwnProperty.call(BANDES, b), `${ou} : bande "${b}" inconnue`);
      assert(etat && typeof etat.genere === 'boolean', `${ou}.${b} : "genere" doit être un booléen`);
      assert(isString(etat.bilan) && isString(etat.justification), `${ou}.${b} : "bilan" et "justification" doivent être des chaînes`);
      if (etat.genere) assert(etat.bilan.trim().length > 0, `${ou}.${b} : période générée sans bilan`);
    });
    periodes.set(p.id, { iv, bandes: p.bandes, entrees: [] });
  }));

  const semainesVues = new Set();
  c.semaines.forEach((s, i) => verifier(() => {
    const ou = `semaines[${i}] (S${s && s.iso_week})`;
    assert(isInt(s.iso_week) && s.iso_week >= 1 && s.iso_week <= 53, `${ou} : iso_week invalide`);
    assert(!semainesVues.has(s.iso_week), `${ou} : iso_week en doublon`);
    semainesVues.add(s.iso_week);
    const iv = intervalle(s, ou);
    assert(new Date(iv[0] * JOUR_MS).getUTCDay() === 1, `${ou} : "du" doit être un lundi`);
    // Semaine de classe pleine, du lundi au vendredi. Une semaine légitimement tronquée
    // (férié en bord de période) devra faire l'objet d'une exception documentée ici.
    assert(iv[1] - iv[0] === 4, `${ou} : "au" doit être le vendredi (du + 4 jours)`);
    assert(semaineIso(iv[0]) === s.iso_week, `${ou} : "du" n'est pas dans la semaine ISO ${s.iso_week}`);
    const periode = periodes.get(s.periode_id);
    assert(periode, `${ou} : periode_id "${s.periode_id}" inconnu`);
    assert(iv[0] >= periode.iv[0] && iv[1] <= periode.iv[1], `${ou} : hors de sa période ${s.periode_id}`);
    vacances.forEach((v) => assert(!seChevauchent(iv, v.iv), `${ou} : semaine de cours pendant ${v.libelle}`));
    assert(isArray(s.entrees), `${ou} : "entrees" doit être un tableau`);

    const matieresParBande = new Set();
    s.entrees.forEach((e, j) => {
      const oe = `${ou}.entrees[${j}]`;
      assert(e && typeof e === 'object' && !isArray(e), `${oe} : objet attendu`);
      Object.keys(e).forEach((k) => assert(CHAMPS_ENTREE.has(k), `${oe} : champ "${k}" hors schéma`));
      const n = notions.get(e.notion_id);
      assert(n, `${oe} : notion_id "${e.notion_id}" absent du référentiel`);
      assert(!NOTIONS_EXCLUES_FIGURES.has(e.notion_id), `${oe} : notion "${e.notion_id}" exclue (figures)`);
      assert(e.matiere === n.matiere, `${oe} : matiere "${e.matiere}" ≠ référentiel (${n.matiere})`);
      assert(PALIERS.has(e.palier), `${oe} : palier "${e.palier}" invalide`);
      assert(Object.prototype.hasOwnProperty.call(BANDES, e.bande), `${oe} : bande "${e.bande}" invalide`);
      const d = e.difficulte || {};
      assert(DIFFICULTES.has(d.valeur), `${oe} : difficulte.valeur "${d.valeur}" invalide`);
      assert(SOURCES_DIFFICULTE.has(d.source), `${oe} : difficulte.source "${d.source}" invalide`);
      if (d.source === 'priorite_initiale') {
        assert(d.valeur === n.priorite_initiale, `${oe} : difficulte ${d.valeur} ≠ priorite_initiale ${n.priorite_initiale}`);
      }
      assert(STATUTS_ENTREE.has(e.statut), `${oe} : statut "${e.statut}" invalide`);
      if (e.statut === 'planifie') {
        assert(!('set_id' in e), `${oe} : une entrée planifiée n'a pas de set_id`);
      } else {
        const lot = publies.get(e.set_id);
        assert(lot, `${oe} : set_id "${e.set_id}" non publié au catalogue`);
        assert(lot.notion_id === e.notion_id && lot.palier === e.palier,
          `${oe} : set_id "${e.set_id}" publié pour ${lot.notion_id}/${lot.palier}, pas ${e.notion_id}/${e.palier}`);
      }
      const cle = `${e.bande}|${e.matiere}`;
      assert(!matieresParBande.has(cle), `${oe} : deux entrées ${e.matiere} pour la bande ${e.bande} la même semaine`);
      matieresParBande.add(cle);
      periode.entrees.push(e);
    });
  }));

  // Continuité : chaque reprise ouvre une période. Seule exception, explicite : la reprise
  // des vacances d'été, qui est la rentrée de l'année suivante (>= 15 août BBBB).
  c.vacances.forEach((v, i) => verifier(() => {
    const reprise = jourIso(v.reprise);
    if (Number.isNaN(reprise) || estEte(v)) return;
    assert([...periodes.values()].some((p) => p.iv[0] === reprise),
      `vacances[${i}] (${v.libelle}) : la reprise ${v.reprise} n'est le début d'aucune période`);
  }));

  periodes.forEach((p, id) => verifier(() => {
    Object.entries(p.bandes).forEach(([b, etat]) => {
      if (!etat.genere) return;
      const entrees = p.entrees.filter((e) => e.bande === b);
      assert(entrees.length > 0 && entrees.every((e) => e.statut === 'publie'),
        `${id}.${b} : "genere" exige que toutes les entrées de la période soient publiées`);
    });
  }));

  return erreurs.length ? { valide: false, erreurs } : { valide: true };
}

function validateCalendar() {
  const data = readJson(path.join(DATA_DIR, 'calendar.json'));
  const referentiel = readJson(path.join(DATA_DIR, 'referentiel.json'));
  const catalogue = readJson(path.join(DATA_DIR, 'catalogue-fonda.json'));
  const r = validerCalendrier(data, { referentiel, catalogue });
  check('calendar.json : schéma v2, référentiel et catalogue publié', () => {
    assert(r.valide, (r.erreurs || []).join(' ; '));
  });
}

// ---------------------------------------------------------------------------
// coverage.json / dashboard.json — enveloppes vides T1
// ---------------------------------------------------------------------------

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

module.exports = { validerEvenement, EVENT_FIELDS_LIST, validerNotion, validerEnveloppeReferentiel, validerCalendrier };

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
