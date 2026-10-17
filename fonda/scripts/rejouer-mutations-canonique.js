#!/usr/bin/env node
// Rejeu de mutations de canonique.js contre le banc figé (canonique-vecteurs.json).
// Outil de CONTRÔLE : il ne modifie aucun fichier (mutants chargés en mémoire, vm).
//
// Garanties (sinon sortie 2 = outil invalide, résultat non probant) :
//   - le code NON muté passe tout le banc (positifs = hex attendu, refus = erreur
//     « canonique : ») ;
//   - chaque mutation modifie réellement le code et le mutant se charge ;
//   - la découverte est complète : autant de mutations nullables que d'usages
//     `nul(...)` dans le code (commentaires exclus).
// Sortie 1 si au moins une mutation SURVIT (banc identique au code non muté).
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

// Liste les mutations : { nom, debut, fin, remplacement } (positions dans le source).
function decouvrir(source, etendu) {
  const mutations = [];
  // Champ nullable : ['nom', nul('type')] ou ['nom', nul(SCHEMA)].
  const reNul = /\['([a-z_]+)', nul\(('([a-z_]+)'|[A-Z_]+)\)\]/g;
  let m;
  while ((m = reNul.exec(source))) {
    const [txt, nom, arg, prim] = m;
    const ligne = ligneDe(source, m.index);
    const variantes = [[`${nom} non nullable`, `['${nom}', ${arg}]`]];
    const autres = prim ? PRIMITIFS.filter((t) => t !== prim) : ['chaine'];
    for (const t of autres) variantes.push([`${nom} -> nul(${t})`, `['${nom}', nul('${t}')]`]);
    for (const [n, remplacement] of variantes) mutations.push({ famille: 'nullable', nom: `ligne ${ligne} : ${n}`, debut: m.index, fin: m.index + txt.length, remplacement });
  }
  if (etendu) {
    const rePrim = /\['([a-z_]+)', '(chaine|nombre|booleen|chaine_ou_nombre)'\]/g;
    while ((m = rePrim.exec(source))) {
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

function rejouer({ source, vecteurs, etendu = false }) {
  const invalide = [];
  const base = echecs(charger(source), vecteurs);
  if (base.length) invalide.push(`code non muté : ${base.length} vecteur(s) en échec (${base.slice(0, 3).map((x) => x.id).join(', ')})`);
  const mutations = decouvrir(source, etendu);
  // Complétude : chaque usage de nul(...) (hors définition) doit avoir été découvert.
  const code = source.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const usages = (code.match(/\bnul\(/g) || []).length;
  const champsNullables = new Set(mutations.filter((x) => x.famille === 'nullable').map((x) => x.debut)).size;
  if (usages !== champsNullables) invalide.push(`découverte incomplète : ${usages} usages de nul(), ${champsNullables} champs nullables mutés`);
  if (mutations.length === 0) invalide.push('aucune mutation découverte');
  const survivantes = [];
  for (const mu of mutations) {
    const mutant = source.slice(0, mu.debut) + mu.remplacement + source.slice(mu.fin);
    if (mutant === source) { invalide.push(`mutation sans effet : ${mu.nom}`); continue; }
    let C;
    try { C = charger(mutant); } catch (e) { invalide.push(`mutant non chargeable : ${mu.nom} (${e.message})`); continue; }
    if (echecs(C, vecteurs).length === 0) survivantes.push(mu.nom);
  }
  return { total: mutations.length, survivantes, invalide };
}

module.exports = { rejouer, decouvrir, echecs };

if (require.main === module) {
  const etendu = process.argv.includes('--etendu');
  const source = fs.readFileSync(path.join(RACINE, 'fonda/engine/canonique.js'), 'utf8');
  const vecteurs = JSON.parse(fs.readFileSync(path.join(RACINE, 'fonda/engine/canonique-vecteurs.json'), 'utf8')).vecteurs;
  const r = rejouer({ source, vecteurs, etendu });
  if (r.invalide.length) {
    for (const e of r.invalide) console.error('✗ OUTIL INVALIDE : ' + e);
    process.exit(2);
  }
  if (r.survivantes.length) {
    for (const s of r.survivantes) console.error('✗ NON DÉTECTÉE : ' + s);
    console.error(`${r.total} mutations, ${r.survivantes.length} survivante(s)`);
    process.exit(1);
  }
  console.log(`✓ ${r.total} mutations${etendu ? ' (étendu)' : ''}, toutes détectées par le banc (${vecteurs.length} vecteurs)`);
}
