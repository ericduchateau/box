// Migration M2 « journal des identifiants » (CDC relecture §4.3, §6) — ponctuelle,
// conservée pour traçabilité. Refuse de tourner si le journal existe déjà.
//
// Amorce fonda/data/set_ids-journal.json pour CHAQUE set_id déjà utilisé :
// catalogue, fonda/data/lots/, fonda/data/lots-fonda-calibration/ ET historique Git
// de ces fichiers. Classement (fonda/engine/journal-set-ids.js::classerM2) :
//   publiés -> reserve + publie ; calibration présente -> reserve (promouvable) ;
//   disparu de l'historique sans publication, ou d'histoire indéterminée -> reserve +
//   abandonne (jamais réutilisable, jamais promouvable).
//
// Classement par OBSERVATIONS par identifiant (pas un simple ensemble) : présence au
// catalogue / dans lots/ / en calibration (chemins) et contenus pédagogiques
// distincts, sur TOUTES les versions examinées — voir classerM2 : seule une histoire
// DÉTERMINÉE (calibration, un chemin, un contenu, jamais publiée) reste « reserve ».
//
// FAIL-CLOSED — PÉRIMÈTRE EXACT : les trois chemins ci-dessous, sur tous les commits
// accessibles depuis les références LOCALES au moment de l'exécution (git rev-list
// --all : branches, références distantes RÉCUPÉRÉES, refs/stash ; liste imprimée).
// Identifiants extraits par scan TEXTUEL et par parcours des valeurs et clés JSON
// DÉCODÉES (un identifiant écrit avec des échappements \uXXXX est trouvé). Une
// version illisible, un clone superficiel ou une incohérence actuelle -> ARRÊT.
// HORS PÉRIMÈTRE (constat humain, option B) : candidats existant seulement sur Drive,
// références distantes non récupérées, commits accessibles seulement par reflog ou
// anciennes entrées de stash, fichiers hors de ces chemins. Une branche locale de
// plus ne peut qu'AJOUTER des abandons (sur-inclusif) ou arrêter la migration.
//
// Usage : git fetch --all && node fonda/scripts/migrer-journal-m2.js [--dry-run]

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const J = require('../engine/journal-set-ids.js');

const RACINE = path.join(__dirname, '..', '..');
const DATA = path.join(RACINE, 'fonda', 'data');
const JOURNAL = path.join(DATA, 'set_ids-journal.json');
const CHEMINS = ['fonda/data/catalogue-fonda.json', 'fonda/data/lots', 'fonda/data/lots-fonda-calibration'];
const RE_ID = /set_fonda_[a-z0-9-]+_n[IF]_\d{2}/g;
const DATE_M2 = '2026-10-14';

function idsDansJson(valeur, sortie) {
  if (typeof valeur === 'string') { (valeur.match(RE_ID) || []).forEach((id) => sortie.add(id)); return; }
  if (Array.isArray(valeur)) { valeur.forEach((v) => idsDansJson(v, sortie)); return; }
  if (valeur && typeof valeur === 'object') {
    for (const [k, v] of Object.entries(valeur)) { (k.match(RE_ID) || []).forEach((id) => sortie.add(id)); idsDansJson(v, sortie); }
  }
}

// Observations par identifiant sur l'historique (voir en-tête pour le périmètre).
function observerHistorique(racine = RACINE) {
  const git = (a) => execFileSync('git', a, { cwd: racine, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  if (git(['rev-parse', '--is-shallow-repository']).trim() !== 'false') throw new Error('M2 : historique incomplet (clone superficiel ou indéterminable) — arrêt');
  const refs = git(['for-each-ref', '--format=%(refname)']).split('\n').filter(Boolean);
  const commits = git(['rev-list', '--all']).split('\n').filter(Boolean);
  if (!commits.length) throw new Error('M2 : aucun commit — arrêt');
  const observations = new Map();
  const obs = (id) => {
    if (!observations.has(id)) observations.set(id, { auCatalogue: false, dansLots: false, cheminsCalibration: new Set(), contenus: new Set() });
    return observations.get(id);
  };
  const vus = new Set();
  for (const c of commits) {
    for (const ligne of git(['ls-tree', '-r', c, '--', ...CHEMINS]).split('\n').filter(Boolean)) {
      const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(ligne);
      if (!m) throw new Error(`M2 : entrée ls-tree inattendue en ${c.slice(0, 7)} — arrêt`);
      const [, blob, chemin] = m;
      if (vus.has(`${blob}\t${chemin}`)) continue;
      vus.add(`${blob}\t${chemin}`);
      const texte = git(['cat-file', 'blob', blob]);
      const ids = new Set([...(chemin.match(new RegExp(RE_ID, 'g')) || []), ...(texte.match(RE_ID) || [])]);
      let j = null;
      if (chemin.endsWith('.json')) {
        try { j = JSON.parse(texte); } catch { throw new Error(`M2 : ${chemin} illisible en ${c.slice(0, 7)} (histoire indéterminée) — arrêt`); }
        idsDansJson(j, ids);
      }
      for (const id of ids) obs(id); // toute mention compte (au pire : abandonne)
      if (chemin === 'fonda/data/catalogue-fonda.json') {
        for (const e of (j && Array.isArray(j.lots)) ? j.lots : []) if (e && typeof e.set_id === 'string') obs(e.set_id).auCatalogue = true;
        continue;
      }
      const dansLots = chemin.startsWith('fonda/data/lots/');
      // Contenu pédagogique par identifiant porteur (champ set_id des cartes ou du lot).
      const parId = new Map();
      for (const carte of (j && Array.isArray(j.cartes)) ? j.cartes : []) {
        const id = (carte && carte.set_id) || (j && j.set_id);
        if (typeof id !== 'string') continue;
        if (!parId.has(id)) parId.set(id, []);
        parId.get(id).push(J.projectionCarte(carte || {}));
      }
      for (const id of ids) {
        const o = obs(id);
        if (dansLots) o.dansLots = true;
        else o.cheminsCalibration.add(chemin);
        o.contenus.add(JSON.stringify(parId.get(id) || ['(mention sans cartes)']));
      }
    }
  }
  return { observations, refs, commits: commits.length, versions: vus.size };
}

// Compatibilité : liste des identifiants observés.
function idsHistorique(racine = RACINE) {
  const h = observerHistorique(racine);
  return { ids: [...h.observations.keys()], commits: h.commits, versions: h.versions, refs: h.refs };
}

function idsActuels() {
  const lire = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
  const catalogueIds = lire(path.join(DATA, 'catalogue-fonda.json')).lots.map((e) => e.set_id);
  const lotsIds = fs.readdirSync(path.join(DATA, 'lots')).filter((f) => f.endsWith('.json')).map((f) => {
    const l = lire(path.join(DATA, 'lots', f));
    if (`${l.set_id}.json` !== f) throw new Error(`M2 : lots/${f} porte le set_id ${l.set_id} — arrêt`);
    return l.set_id;
  });
  const calibrationIds = fs.readdirSync(path.join(DATA, 'lots-fonda-calibration')).filter((f) => f.endsWith('.json')).map((f) => {
    const l = lire(path.join(DATA, 'lots-fonda-calibration', f));
    const ids = new Set([l.set_id, ...(l.cartes || []).map((c) => c.set_id)]);
    if (ids.size !== 1 || !l.set_id) throw new Error(`M2 : calibration ${f} sans set_id unique — arrêt`);
    return l.set_id;
  });
  return { catalogueIds, lotsIds, calibrationIds };
}

function main() {
  if (fs.existsSync(JOURNAL) && !process.argv.includes('--comparer')) throw new Error('set_ids-journal.json existe déjà : M2 déjà faite (consommable une seule fois) ; --comparer pour recalculer sans écrire');
  const actuels = idsActuels();
  const h = observerHistorique();
  const C = require('../engine/catalogue.js');
  const catalogue = JSON.parse(fs.readFileSync(path.join(DATA, 'catalogue-fonda.json'), 'utf8'));
  const empreintesActuelles = Object.fromEntries(catalogue.lots.map((e) => [e.set_id, e.empreinte]));
  const lignes = J.classerM2({ ...actuels, observations: h.observations, historiques: C.HISTORIQUES_FIGES, empreintesActuelles, le: DATE_M2, prefixeRef: `m2-${DATE_M2}` });
  const journal = { schema: J.SCHEMA_JOURNAL, lignes };
  const v = J.validerJournal(journal);
  if (!v.valide) throw new Error(v.erreurs.join(' ; '));
  const bilan = {};
  for (const e of v.etats.values()) bilan[e] = (bilan[e] || 0) + 1;
  console.log(`références examinées (${h.refs.length}) : ${h.refs.join(', ')}`);
  console.log(`historique : ${h.commits} commits, ${h.versions} versions de fichiers ; ${v.etats.size} set_id ; états : ${JSON.stringify(bilan)}`);
  if (process.argv.includes('--comparer')) {
    const existant = fs.readFileSync(JOURNAL, 'utf8');
    console.log(existant === JSON.stringify(journal, null, 2) + '\n' ? '✓ identique au journal existant' : '✗ DIFFÉRENT du journal existant');
    return;
  }
  if (process.argv.includes('--dry-run')) { console.log('(dry-run) rien écrit.'); return; }
  fs.writeFileSync(JOURNAL, JSON.stringify(journal, null, 2) + '\n', { flag: 'wx' });
  console.log('✓ fonda/data/set_ids-journal.json créé — relire le diff, puis commit + PR.');
}

module.exports = { observerHistorique, idsHistorique, idsActuels, idsDansJson };

if (require.main === module) {
  try { main(); } catch (e) { console.error(`✗ ${e.message}`); process.exitCode = 1; }
}
