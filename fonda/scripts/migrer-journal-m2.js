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
// FAIL-CLOSED : historique parcouru = TOUS les commits accessibles (git rev-list
// --all, toutes branches et références distantes : sur-inclusif, voulu) ; les
// identifiants sont extraits par scan TEXTUEL de chaque version (tout identifiant
// canonique mentionné compte, même hors champ set_id) ; une version illisible, un
// clone superficiel ou une incohérence actuelle -> ARRÊT, aucun fichier écrit.
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

function idsHistorique(racine = RACINE) {
  const git = (a) => execFileSync('git', a, { cwd: racine, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  if (git(['rev-parse', '--is-shallow-repository']).trim() !== 'false') throw new Error('M2 : historique incomplet (clone superficiel ou indéterminable) — arrêt');
  const ids = new Set();
  const vus = new Set();
  const commits = git(['rev-list', '--all']).split('\n').filter(Boolean);
  if (!commits.length) throw new Error('M2 : aucun commit — arrêt');
  for (const c of commits) {
    for (const ligne of git(['ls-tree', '-r', c, '--', ...CHEMINS]).split('\n').filter(Boolean)) {
      const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(ligne);
      if (!m) throw new Error(`M2 : entrée ls-tree inattendue en ${c.slice(0, 7)} — arrêt`);
      (m[2].match(RE_ID) || []).forEach((id) => ids.add(id));
      if (vus.has(m[1])) continue;
      vus.add(m[1]);
      const texte = git(['cat-file', 'blob', m[1]]);
      if (m[2].endsWith('.json')) {
        try { JSON.parse(texte); } catch { throw new Error(`M2 : ${m[2]} illisible en ${c.slice(0, 7)} (histoire indéterminée) — arrêt`); }
      }
      (texte.match(RE_ID) || []).forEach((id) => ids.add(id));
    }
  }
  return { ids: [...ids], commits: commits.length, versions: vus.size };
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
  if (fs.existsSync(JOURNAL)) throw new Error('set_ids-journal.json existe déjà : M2 déjà faite (consommable une seule fois)');
  const actuels = idsActuels();
  const h = idsHistorique();
  const lignes = J.classerM2({ ...actuels, historiqueIds: h.ids, le: DATE_M2, prefixeRef: `m2-${DATE_M2}` });
  const journal = { schema: J.SCHEMA_JOURNAL, lignes };
  const v = J.validerJournal(journal);
  if (!v.valide) throw new Error(v.erreurs.join(' ; '));
  const bilan = {};
  for (const e of v.etats.values()) bilan[e] = (bilan[e] || 0) + 1;
  console.log(`historique : ${h.commits} commits, ${h.versions} versions de fichiers ; ${v.etats.size} set_id ; états : ${JSON.stringify(bilan)}`);
  if (process.argv.includes('--dry-run')) { console.log('(dry-run) rien écrit.'); return; }
  fs.writeFileSync(JOURNAL, JSON.stringify(journal, null, 2) + '\n', { flag: 'wx' });
  console.log('✓ fonda/data/set_ids-journal.json créé — relire le diff, puis commit + PR.');
}

module.exports = { idsHistorique, idsActuels };

if (require.main === module) {
  try { main(); } catch (e) { console.error(`✗ ${e.message}`); process.exitCode = 1; }
}
