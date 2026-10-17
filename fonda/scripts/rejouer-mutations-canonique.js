#!/usr/bin/env node
// Rejeu de mutations de canonique.js contre le banc figé (canonique-vecteurs.json).
// Outil de CONTRÔLE : il ne modifie aucun fichier (mutants chargés en mémoire, vm).
//
// Garanties (sinon sortie 2 = outil invalide, résultat non probant) :
//   - le code NON muté passe tout le banc (positifs = hex attendu, refus = erreur
//     « canonique : ») ;
//   - chaque mutation modifie réellement le code et le mutant se charge ;
//   - la découverte est complète : chaque appel `nul(...)` du code (commentaires
//     neutralisés, espaces tolérés) tombe dans un champ nullable découvert.
// Sortie 1 si au moins une mutation SURVIT (banc identique au code non muté) ;
// toute autre erreur (lecture, JSON, exception) = sortie 2, jamais 1.
//
// Familles :
//   défaut     : chaque champ nullable rendu non nullable, ou nullable d'un autre type ;
//   --etendu   : en plus, chaque champ primitif non nullable changé de type ou rendu
//                nullable.
// Usage : node fonda/scripts/rejouer-mutations-canonique.js [--etendu]

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RACINE = path.join(__dirname, '..', '..');
const PRIMITIFS = ['chaine', 'nombre', 'booleen', 'chaine_ou_nombre'];

const charger = (source) => vm.runInNewContext(`${source}\n;FondaCanonique`, Object.create(null));
const entreeDe = (x) => (x.entree_json !== undefined ? JSON.parse(x.entree_json) : x.entree);

// Vecteurs dont le résultat diffère de l'attendu figé (vide = banc passé).
function echecs(C, vecteurs) {
  return vecteurs.filter((x) => {
    try {
      const h = x.contrat ? C.hexContrat(x.contrat, entreeDe(x)) : C.hex(entreeDe(x), x.schema);
      return x.refus || h !== x.hex;
    } catch (e) {
      return !x.refus || !/canonique :/.test(e.message);
    }
  });
}

function ligneDe(source, index) { return source.slice(0, index).split('\n').length; }

// Copie du source, MÊME LONGUEUR, où commentaires (// et /* */) sont remplacés par
// des espaces (sauts de ligne conservés) ; chaînes (apostrophe, guillemet, accent grave) respectées. Pas de prise en
// charge des littéraux d'expression régulière : garde-fou dans rejouer() — la copie
// neutralisée doit se comporter exactement comme le source sur tout le banc.
function neutraliserCommentaires(source) {
  const out = source.split('');
  let i = 0;
  const blanc = (a, b) => { for (let k = a; k < b; k += 1) if (out[k] !== '\n') out[k] = ' '; };
  while (i < source.length) {
    const c = source[i];
    if (c === "'" || c === '"' || c === '\x60') {
      i += 1;
      while (i < source.length && source[i] !== c) i += source[i] === '\\' ? 2 : 1;
      i += 1;
    } else if (c === '/' && source[i + 1] === '/') {
      const fin = source.indexOf('\n', i); const f = fin < 0 ? source.length : fin;
      blanc(i, f); i = f;
    } else if (c === '/' && source[i + 1] === '*') {
      const fin = source.indexOf('*/', i + 2); const f = fin < 0 ? source.length : fin + 2;
      blanc(i, f); i = f;
    } else {
      i += 1;
    }
  }
  return out.join('');
}

// Liste les mutations : { famille, nom, debut, fin, remplacement } (positions dans le
// source ; découverte sur la copie neutralisée, espaces tolérés).
function decouvrir(source, etendu) {
  const code = neutraliserCommentaires(source);
  const mutations = [];
  // Champ nullable : ['nom', nul('type')] ou ['nom', nul(SCHEMA)].
  const reNul = /\[\s*'([a-z_]+)'\s*,\s*nul\s*\(\s*('([a-z_]+)'|[A-Z_]+)\s*\)\s*\]/g;
  let m;
  while ((m = reNul.exec(code))) {
    const [txt, nom, arg, prim] = m;
    const ligne = ligneDe(source, m.index);
    const variantes = [[`${nom} non nullable`, `['${nom}', ${arg}]`]];
    const autres = prim ? PRIMITIFS.filter((t) => t !== prim) : ['chaine'];
    for (const t of autres) variantes.push([`${nom} -> nul(${t})`, `['${nom}', nul('${t}')]`]);
    for (const [n, remplacement] of variantes) mutations.push({ famille: 'nullable', nom: `ligne ${ligne} : ${n}`, debut: m.index, fin: m.index + txt.length, remplacement });
  }
  if (etendu) {
    const rePrim = /\[\s*'([a-z_]+)'\s*,\s*'(chaine|nombre|booleen|chaine_ou_nombre)'\s*\]/g;
    while ((m = rePrim.exec(code))) {
      const [txt, nom, prim] = m;
      const ligne = ligneDe(source, m.index);
      const variantes = PRIMITIFS.filter((t) => t !== prim).map((t) => [`${nom} -> ${t}`, `['${nom}', '${t}']`]);
      // Littéral : certains schémas (MOTEUR, COEUR) sont définis avant `nul`.
      variantes.push([`${nom} -> nul(${prim})`, `['${nom}', { type: 'nullable', de: '${prim}' }]`]);
      for (const [n, remplacement] of variantes) mutations.push({ famille: 'primitif', nom: `ligne ${ligne} : ${n}`, debut: m.index, fin: m.index + txt.length, remplacement });
    }
  }
  return mutations;
}

// `supplementaires` : mutations injectées (tests des garde-fous uniquement).
function rejouer({ source, vecteurs, etendu = false, supplementaires = [] }) {
  const invalide = [];
  let base;
  try { base = echecs(charger(source), vecteurs); } catch (e) {
    return { total: 0, survivantes: [], invalide: [`code non muté non chargeable : ${e.message}`] };
  }
  if (base.length) invalide.push(`code non muté : ${base.length} vecteur(s) en échec (${base.slice(0, 3).map((x) => x.id).join(', ')})`);
  const code = neutraliserCommentaires(source);
  // Garde-fou du scanner : la copie neutralisée doit passer le banc comme le source.
  let neutre;
  try { neutre = echecs(charger(code), vecteurs).length; } catch (e) { neutre = -1; }
  if (neutre !== base.length) invalide.push('neutralisation des commentaires infidèle (le scanner a altéré du code)');
  const mutations = decouvrir(source, etendu).concat(supplementaires);
  // Complétude : CHAQUE appel nul(...) du code (espaces tolérés) doit tomber dans un
  // champ nullable découvert ; positions comparées, pas seulement des effectifs.
  const couverts = mutations.filter((x) => x.famille === 'nullable');
  const reAppel = /\bnul\s*\(/g; let a;
  while ((a = reAppel.exec(code))) {
    if (!couverts.some((x) => x.debut <= a.index && a.index < x.fin)) invalide.push(`découverte incomplète : appel nul() non couvert ligne ${ligneDe(source, a.index)}`);
  }
  if (mutations.length === 0) invalide.push('aucune mutation découverte');
  const survivantes = [];
  for (const mu of mutations) {
    const mutant = source.slice(0, mu.debut) + mu.remplacement + source.slice(mu.fin);
    if (mutant === source) { invalide.push(`mutation sans effet : ${mu.nom}`); continue; }
    let C;
    try { C = charger(mutant); } catch (e) { invalide.push(`mutant non chargeable : ${mu.nom} (${e.message})`); continue; }
    let n;
    try { n = echecs(C, vecteurs).length; } catch (e) { invalide.push(`mutant inexploitable : ${mu.nom} (${e.message})`); continue; }
    if (n === 0) survivantes.push(mu.nom);
  }
  return { total: mutations.length, survivantes, invalide };
}

module.exports = { rejouer, decouvrir, echecs, neutraliserCommentaires };

// Codes de sortie : 0 = toutes détectées ; 1 = au moins une survivante ;
// 2 = outil invalide OU erreur quelconque (lecture, JSON, exception) — jamais 1.
function principal() {
  const etendu = process.argv.includes('--etendu');
  const source = fs.readFileSync(path.join(RACINE, 'fonda/engine/canonique.js'), 'utf8');
  const vecteurs = JSON.parse(fs.readFileSync(path.join(RACINE, 'fonda/engine/canonique-vecteurs.json'), 'utf8')).vecteurs;
  if (!Array.isArray(vecteurs)) throw new Error('vecteurs : tableau attendu');
  const r = rejouer({ source, vecteurs, etendu });
  if (r.invalide.length) {
    for (const e of r.invalide) console.error('✗ OUTIL INVALIDE : ' + e);
    return 2;
  }
  if (r.survivantes.length) {
    for (const x of r.survivantes) console.error('✗ NON DÉTECTÉE : ' + x);
    console.error(`${r.total} mutations, ${r.survivantes.length} survivante(s)`);
    return 1;
  }
  console.log(`✓ ${r.total} mutations${etendu ? ' (étendu)' : ''}, toutes détectées par le banc (${vecteurs.length} vecteurs)`);
  return 0;
}

if (require.main === module) {
  let code;
  try { code = principal(); } catch (e) { console.error('✗ OUTIL INVALIDE : ' + (e && e.message)); code = 2; }
  process.exitCode = code;
}
