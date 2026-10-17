#!/usr/bin/env node
// Rejeu de mutations de canonique.js contre le banc figé (canonique-vecteurs.json).
// Outil de CONTRÔLE : il ne modifie aucun fichier (mutants chargés en mémoire, vm).
//
// Garanties (sinon sortie 2 = outil invalide, résultat non probant) :
//   - le code NON muté passe tout le banc (positifs = hex attendu, refus = erreur
//     « canonique : ») ;
//   - chaque mutation modifie réellement le code et le mutant se charge ;
//   - la découverte est complète, vérifiée SUR LES SCHÉMAS CHARGÉS (pas sur le texte) :
//     chaque chemin nullable atteignable depuis un contrat perd sa nullabilité sous au
//     moins une mutation découverte, et chaque mutation « non nullable » en retire un.
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

const charger = (source, contexte = Object.create(null)) => vm.runInNewContext(`${source}\n;FondaCanonique`, contexte);
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
// charge des littéraux d'expression régulière ni des gabarits imbriqués : le scanner ne
// fait que PROPOSER des candidats ; la complétude est établie sur les schémas (rejouer).
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
    variantes.forEach(([n, remplacement], k) => mutations.push({ famille: 'nullable', cible: k === 0, nom: `ligne ${ligne} : ${n}`, debut: m.index, fin: m.index + txt.length, remplacement }));
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

// Instrumentation EN MÉMOIRE (canonique.js n'expose pas ses schémas), dans une instance
// réservée à l'extraction : à l'ancre (unique), l'objet CONTRATS est remis à un rappel du
// contexte vm — hors de l'objet exporté, donc non écrasable par lui. Exigences : un seul
// appel du rappel ; mêmes noms que contrats()/contratsIncomplets() ; et PREUVE D'IDENTITÉ
// pour chaque contrat : mettre l'entrée capturée à null fait répondre « forme incomplète »
// à hexContrat (c'est bien l'objet que le code consulte).
const ANCRE = 'contrats: function () {';
function schemasDe(source) {
  if (source.split(ANCRE).length !== 2) throw new Error('ancre d\'instrumentation absente ou multiple');
  const captures = [];
  const contexte = Object.create(null);
  contexte.__captureFonda = (c) => { captures.push(c); return 0; };
  const C = charger(source.replace(ANCRE, '__captureFonda__: __captureFonda(CONTRATS), ' + ANCRE), contexte);
  if (captures.length !== 1 || !captures[0] || typeof captures[0] !== 'object') throw new Error('capture des schémas : un appel unique attendu');
  const contrats = captures[0];
  const noms = Object.keys(contrats);
  const attendus = [...C.contrats(), ...C.contratsIncomplets()];
  if (noms.length !== attendus.length || attendus.some((n) => !noms.includes(n))) throw new Error('capture des schémas : noms ≠ contrats()');
  for (const n of C.contrats()) {
    const sch = contrats[n];
    contrats[n] = null;
    let preuve = false;
    try { C.hexContrat(n, {}); } catch (err) { preuve = /forme incomplète/.test(err.message); }
    contrats[n] = sch;
    if (!preuve) throw new Error('capture des schémas : objet capturé non consulté par hexContrat (' + n + ')');
  }
  return contrats;
}
// Chemins STRUCTURELS des nœuds nullables atteignables depuis les contrats (ex.
// « lot-complet-fonda/v1.cartes[].unite ») : indépendants de la nullabilité des parents,
// pour que retirer celle d'un parent ne fasse pas « disparaître » ses enfants.
function cheminsNullables(contrats) {
  const chemins = new Set();
  const parcourir = (sch, p) => {
    if (typeof sch === 'string' || sch === null || typeof sch !== 'object') return;
    if (sch.type === 'nullable') { chemins.add(p); parcourir(sch.de, p); }
    else if (sch.type === 'objet') for (const [nom, c] of sch.champs) parcourir(c, p + '.' + nom);
    else if (sch.type === 'tableau') parcourir(sch.elements, p + '[]');
  };
  for (const nom of Object.keys(contrats)) parcourir(contrats[nom], nom);
  return chemins;
}

// `supplementaires` : mutations injectées (tests des garde-fous uniquement).
function rejouer({ source, vecteurs, etendu = false, supplementaires = [] }) {
  const invalide = [];
  let base, cheminsBase;
  try { base = echecs(charger(source), vecteurs); cheminsBase = cheminsNullables(schemasDe(source)); } catch (e) {
    return { total: 0, survivantes: [], invalide: [`code non muté non chargeable ou non instrumentable : ${e.message}`] };
  }
  if (base.length) invalide.push(`code non muté : ${base.length} vecteur(s) en échec (${base.slice(0, 3).map((x) => x.id).join(', ')})`);
  const mutations = decouvrir(source, etendu).concat(supplementaires);
  if (mutations.length === 0) invalide.push('aucune mutation découverte');
  // Complétude SÉMANTIQUE (indépendante du scanner) : chaque chemin nullable atteignable
  // doit perdre sa nullabilité sous au moins une mutation « non nullable » découverte,
  // et chacune de ces mutations doit en retirer au moins un (sinon : cible fantôme,
  // p. ex. texte dans une chaîne ou un commentaire mal reconnu).
  const retires = new Set();
  for (const mu of mutations.filter((x) => x.cible)) {
    let apres;
    try { apres = cheminsNullables(schemasDe(source.slice(0, mu.debut) + mu.remplacement + source.slice(mu.fin))); } catch (err) { continue; } // signalé ci-dessous
    const moins = [...cheminsBase].filter((p) => !apres.has(p));
    if (moins.length === 0) invalide.push(`mutation sans cible dans les schémas : ${mu.nom}`);
    for (const p of moins) retires.add(p);
  }
  for (const p of cheminsBase) if (!retires.has(p)) invalide.push(`découverte incomplète : chemin nullable non couvert ${p}`);
  const survivantes = [];
  const executees = {};
  for (const mu of mutations) {
    const mutant = source.slice(0, mu.debut) + mu.remplacement + source.slice(mu.fin);
    if (mutant === source) { invalide.push(`mutation sans effet : ${mu.nom}`); continue; }
    let C;
    try { C = charger(mutant); } catch (err) { invalide.push(`mutant non chargeable : ${mu.nom} (${err.message})`); continue; }
    let n;
    try { n = echecs(C, vecteurs).length; } catch (err) { invalide.push(`mutant inexploitable : ${mu.nom} (${err.message})`); continue; }
    executees[mu.famille] = (executees[mu.famille] || 0) + 1;
    if (n === 0) survivantes.push(mu.nom);
  }
  const familles = {};
  for (const mu of mutations) familles[mu.famille] = (familles[mu.famille] || 0) + 1;
  return { total: mutations.length, survivantes, invalide, chemins: cheminsBase.size, familles, executees };
}

module.exports = { rejouer, decouvrir, echecs, neutraliserCommentaires, cheminsNullables, schemasDe };

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
