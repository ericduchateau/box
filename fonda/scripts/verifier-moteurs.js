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
// Usage : FONDA_REF_BASE=<sha> node fonda/scripts/verifier-moteurs.js

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const RACINE = path.join(__dirname, '..', '..');
const REGISTRE = 'fonda/engine/moteurs.json';
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

function verifierHistorique(refs, registreCourant, lireOctets, racine = RACINE) {
  const git = (args) => execFileSync('git', args, { cwd: racine, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const erreurs = [];
  for (const ref of refs) {
    if (!ref || /^0+$/.test(ref)) { erreurs.push(`référence nulle (${ref || 'absente'}) : échec explicite`); continue; }
    try { git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); } catch { erreurs.push(`référence introuvable : ${ref}`); continue; }
    try {
      if (git(['rev-parse', '--is-shallow-repository']).toString().trim() === 'true') { erreurs.push('historique incomplet (clone superficiel)'); continue; }
    } catch { /* git ancien : pas d'information, on continue */ }
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
  const erreurs = [
    ...invariantsRegistre(registre, lireOctetsDisque, fichiersMoteursDisque()),
    ...verifierHistorique(refs, registre, lireOctetsDisque),
  ];
  if (erreurs.length) {
    console.error('✗ Immuabilité des moteurs :');
    erreurs.forEach((e) => console.error(`  - ${e}`));
    process.exitCode = 1;
    return;
  }
  console.log(`✓ moteurs immuables (${registre.map((l) => l.version).join(', ')}) — références : ${refs.join(', ')}`);
}

module.exports = { invariantsRegistre, verifierHistorique, lireOctetsDisque, fichiersMoteursDisque, MOTIF_FICHIER };

if (require.main === module) main();
