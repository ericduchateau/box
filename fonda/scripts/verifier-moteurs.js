// Immuabilité des moteurs de correction élève (CDC relecture annexe B, « autres
// contrôles » ; étape 2) — exécuté par la CI (job « tests (node --test) »).
//
//  1. Invariants du registre courant (aussi couverts par node --test) : versions
//     uniques, fichier = fonda/engine/moteur-correction-<version>.js présent,
//     sha256 = SHA-256 des octets, sri = "sha256-" + base64(même empreinte), et
//     aucun fichier moteur hors registre.
//  2. Historique de confiance = la RÉFÉRENCE (PR : base.sha ; push : before) ET
//     `design` (autorité) : toute ligne ayant jamais figuré dans moteurs.json doit
//     être présente à l'identique (ajout seul), et tout moteur-correction-v<N>.js
//     ayant jamais existé doit être présent et identique octet pour octet.
//     Référence nulle, introuvable ou historique incomplet -> ÉCHEC explicite
//     (jamais de comparaison contre un état vide).
//
//  3. Règle 0 de M1 (CDC annexe B), CONSOMMABLE UNE SEULE FOIS : on parcourt toutes
//     les versions de fonda/data/catalogue-fonda.json de l'historique de confiance.
//     - Si AUCUNE n'a jamais contenu de champ `moteur` : la migration M1 est admise,
//       et elle seule — chaque entrée du catalogue courant doit être un des 8
//       HISTORIQUES_FIGES, à empreinte figée inchangée, liée au moteur v1 du registre.
//     - Sinon (M1 consommée) : tout set_id déjà publié avec un moteur garde EXACTEMENT
//       son tuple (empreinte, moteur.version, moteur.sha256) — couvre le transit
//       design -> main ; un set_id jamais publié avec moteur est REFUSÉ ici (fail-closed)
//       tant que la règle générale n'existe pas.
//
// Frontière avec fonda/scripts/verifier-immuabilite.js (étape 3, à venir) : CE fichier
// ne possède que « moteurs + règle 0 ». La règle générale du tuple (journal des
// set_ids, premières publications, retraits) appartiendra à verifier-immuabilite.js ;
// à sa création, la branche « M1 consommée » ci-dessus lui sera transférée et retirée
// d'ici (pas de double implémentation).
//
// Usage : FONDA_REF_BASE=<sha> node fonda/scripts/verifier-moteurs.js

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const RACINE = path.join(__dirname, '..', '..');
const REGISTRE = 'fonda/engine/moteurs.json';
const CATALOGUE = 'fonda/data/catalogue-fonda.json';
const MOTIF_FICHIER = /^fonda\/engine\/moteur-correction-(v[1-9][0-9]*)\.js$/;

function invariantsRegistre(registre, lireOctets, fichiersMoteurs) {
  const erreurs = [];
  if (!Array.isArray(registre)) return ['moteurs.json n\'est pas un tableau'];
  const vues = new Set();
  for (const l of registre) {
    const p = `moteurs.json[${l && l.version}]`;
    if (!l || Object.keys(l).sort().join() !== 'fichier,sha256,sri,version') { erreurs.push(`${p} : champs attendus { version, fichier, sha256, sri }`); continue; }
    if (vues.has(l.version)) erreurs.push(`${p} : version en double`);
    vues.add(l.version);
    const m = MOTIF_FICHIER.exec(l.fichier);
    if (!m || m[1] !== l.version) { erreurs.push(`${p} : fichier ≠ fonda/engine/moteur-correction-${l.version}.js`); continue; }
    const octets = lireOctets(l.fichier);
    if (!octets) { erreurs.push(`${p} : fichier absent`); continue; }
    const d = crypto.createHash('sha256').update(octets).digest();
    if (l.sha256 !== d.toString('hex')) erreurs.push(`${p} : sha256 ≠ SHA-256 du fichier`);
    if (l.sri !== 'sha256-' + d.toString('base64')) erreurs.push(`${p} : sri ≠ base64 de la même empreinte`);
  }
  for (const f of fichiersMoteurs) {
    if (!registre.some((l) => l && l.fichier === f)) erreurs.push(`${f} : fichier moteur absent du registre`);
  }
  return erreurs;
}

function executeurGit(racine) {
  return (args) => execFileSync('git', args, { cwd: racine, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

// Références de confiance utilisables ; toute anomalie = erreur explicite (fail-closed).
function controlerRefs(refs, git) {
  const erreurs = [];
  const valides = [];
  for (const ref of refs) {
    if (!ref || /^0+$/.test(ref)) { erreurs.push(`référence nulle (${ref || 'absente'}) : échec explicite`); continue; }
    try { git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); } catch { erreurs.push(`référence introuvable : ${ref}`); continue; }
    let superficiel = 'false';
    try { superficiel = git(['rev-parse', '--is-shallow-repository']).toString().trim(); } catch { /* git ancien */ }
    if (superficiel === 'true') { erreurs.push('historique incomplet (clone superficiel)'); continue; }
    valides.push(ref);
  }
  return { erreurs, valides };
}

function verifierHistorique(refs, registreCourant, lireOctets, racine = RACINE) {
  const git = executeurGit(racine);
  const { erreurs, valides } = controlerRefs(refs, git);
  for (const ref of valides) {
    const commits = git(['log', '--format=%H', ref, '--', 'fonda/engine/']).toString().split('\n').filter(Boolean);
    for (const c of commits) {
      const fichiers = git(['ls-tree', '-r', '--name-only', c, 'fonda/engine/']).toString().split('\n').filter(Boolean);
      for (const f of fichiers.filter((x) => MOTIF_FICHIER.test(x))) {
        const ancien = git(['show', `${c}:${f}`]);
        const actuel = lireOctets(f);
        if (!actuel) erreurs.push(`${f} (existait en ${c.slice(0, 7)}) : supprimé — un moteur publié ne disparaît jamais`);
        else if (!ancien.equals(actuel)) erreurs.push(`${f} : modifié depuis ${c.slice(0, 7)} — tout changement = nouvelle version`);
      }
      if (fichiers.includes(REGISTRE)) {
        let lignes;
        try { lignes = JSON.parse(git(['show', `${c}:${REGISTRE}`]).toString()); } catch { erreurs.push(`${REGISTRE} illisible en ${c.slice(0, 7)}`); continue; }
        for (const l of Array.isArray(lignes) ? lignes : []) {
          if (!registreCourant.some((x) => JSON.stringify(x) === JSON.stringify(l))) {
            erreurs.push(`${REGISTRE} : ligne ${l && l.version} (en ${c.slice(0, 7)}) retirée ou modifiée — registre en ajout seul`);
          }
        }
      }
    }
  }
  return [...new Set(erreurs)];
}

const tuple = (e) => JSON.stringify([e.empreinte, e.moteur && e.moteur.version, e.moteur && e.moteur.sha256]);

// Règle 0 de M1. `historiques` = { set_id: empreinte figée } (catalogue.js).
function verifierRegle0(refs, catalogueCourant, registreCourant, historiques, racine = RACINE) {
  const git = executeurGit(racine);
  const { erreurs, valides } = controlerRefs(refs, git);
  if (erreurs.length) return erreurs;
  let moteurAExiste = false;
  const publies = new Map(); // set_id -> Set(tuple)
  for (const ref of valides) {
    const commits = git(['log', '--format=%H', ref, '--', CATALOGUE]).toString().split('\n').filter(Boolean);
    for (const c of commits) {
      let cat;
      try { cat = JSON.parse(git(['show', `${c}:${CATALOGUE}`]).toString()); } catch { continue; } // fichier supprimé dans ce commit
      for (const e of (cat && Array.isArray(cat.lots)) ? cat.lots : []) {
        if (!e || !Object.prototype.hasOwnProperty.call(e, 'moteur')) continue;
        moteurAExiste = true;
        if (!publies.has(e.set_id)) publies.set(e.set_id, new Set());
        publies.get(e.set_id).add(tuple(e));
      }
    }
  }
  const lots = catalogueCourant && Array.isArray(catalogueCourant.lots) ? catalogueCourant.lots : [];
  if (!moteurAExiste) {
    const v1 = registreCourant.find((l) => l && l.version === 'v1');
    for (const e of lots) {
      const p = `règle 0 (M1) : ${e && e.set_id}`;
      if (!Object.prototype.hasOwnProperty.call(historiques, e.set_id)) erreurs.push(`${p} — seuls les 8 lots historiques peuvent entrer par M1`);
      else if (e.empreinte !== historiques[e.set_id]) erreurs.push(`${p} — empreinte ≠ empreinte figée`);
      if (!v1 || !e.moteur || e.moteur.version !== 'v1' || e.moteur.sha256 !== v1.sha256) erreurs.push(`${p} — M1 n'admet que le moteur v1 du registre`);
    }
    return erreurs;
  }
  for (const e of lots) {
    const connus = publies.get(e && e.set_id);
    if (!connus) erreurs.push(`${e && e.set_id} : jamais publié avec un moteur dans l'historique de confiance — M1 déjà consommée, première publication refusée ici (règle générale : étape 3)`);
    else if (connus.size !== 1 || !connus.has(tuple(e))) erreurs.push(`${e.set_id} : tuple (empreinte, moteur) ≠ tuple déjà publié — un lot publié est immuable`);
  }
  return erreurs;
}

function lireOctetsDisque(rel) {
  const p = path.join(RACINE, rel);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

function fichiersMoteursDisque() {
  return fs.readdirSync(path.join(RACINE, 'fonda', 'engine'))
    .map((f) => `fonda/engine/${f}`).filter((f) => MOTIF_FICHIER.test(f));
}

function main() {
  const registre = JSON.parse(fs.readFileSync(path.join(RACINE, REGISTRE), 'utf8'));
  const refs = [...new Set([process.env.FONDA_REF_BASE, 'design'])];
  const catalogue = JSON.parse(fs.readFileSync(path.join(RACINE, CATALOGUE), 'utf8'));
  const { HISTORIQUES_FIGES } = require('../engine/catalogue.js');
  const erreurs = [...new Set([
    ...invariantsRegistre(registre, lireOctetsDisque, fichiersMoteursDisque()),
    ...verifierHistorique(refs, registre, lireOctetsDisque),
    ...verifierRegle0(refs, catalogue, registre, HISTORIQUES_FIGES),
  ])];
  if (erreurs.length) {
    console.error('✗ Immuabilité des moteurs :');
    erreurs.forEach((e) => console.error(`  - ${e}`));
    process.exitCode = 1;
    return;
  }
  console.log(`✓ moteurs immuables (${registre.map((l) => l.version).join(', ')}) + règle 0 de M1 — références : ${refs.join(', ')}`);
}

module.exports = { invariantsRegistre, verifierHistorique, verifierRegle0, lireOctetsDisque, fichiersMoteursDisque, MOTIF_FICHIER };

if (require.main === module) main();
