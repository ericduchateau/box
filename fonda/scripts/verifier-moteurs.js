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
//     Historique de confiance = CHAÎNE DU PREMIER PARENT de chaque référence
//     (git rev-list --first-parent) : les états successifs réellement publiés sur la
//     branche. Les commits intermédiaires d'une PR fusionnée (brouillons, révisions
//     avant relecture) n'en font pas partie ; son commit de merge, si. Parcours sans
//     filtrage par chemin (aucun état publié n'est sauté) ; tout objet illisible ou
//     JSON invalide -> ÉCHEC (seule l'absence avérée du fichier dans un commit est
//     ignorée). Appliqué identiquement aux moteurs et au catalogue (règle 0).
//     HYPOTHÈSE du contrat : intégration à `design`/`main` par MERGE COMMIT ou SQUASH
//     uniquement (rebase-merge et push direct exclus — réglages GitHub, CDC annexe A).
//     Un rebase-merge placerait les brouillons d'une PR sur le premier parent ; un
//     fast-forward vers un merge aux parents inversés ferait sortir des états publiés
//     de la chaîne.
//  2 bis. CONTINUITÉ : la référence doit figurer sur la chaîne du premier parent de
//     HEAD (PR : le merge simulé a base.sha pour premier parent ; push : l'ancien
//     sommet est premier-parent-ancêtre du nouveau). Sinon ÉCHEC explicite.
//     Le filet DÉTECTE une violation (CI rouge, au plus tard au push qui avance la
//     branche) ; il ne l'EMPÊCHE pas — la prévention est la protection de branche.
//
// FRONTIÈRE (étape 3, chantier 3) : CE fichier ne possède que les MOTEURS — invariants
// du registre (1), historique des fichiers moteurs et du registre (2), continuité
// (2 bis) — et les primitives Git partagées (références, premier parent, versions).
// La RÈGLE 0 DE M1 et toute la règle du TUPLE des lots publiés (catalogue, journal
// des set_id, premières publications, retraits) appartiennent à
// fonda/scripts/verifier-immuabilite.js, qui RÉUTILISE ces fonctions (une seule
// implémentation) et rejoue aussi les contrôles moteurs dans le job `immuabilite`.
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
    let superficiel;
    try { superficiel = git(['rev-parse', '--is-shallow-repository']).toString().trim(); } catch { superficiel = null; }
    if (superficiel !== 'false') { erreurs.push(superficiel === 'true' ? 'historique incomplet (clone superficiel)' : 'impossible de vérifier que l\'historique est complet — échec'); continue; }
    valides.push(ref);
  }
  return { erreurs, valides };
}

// Continuité (2 bis) : `ref` doit être sur la chaîne du premier parent de `head`.
function verifierContinuite(ref, head = 'HEAD', racine = RACINE) {
  const git = executeurGit(racine);
  const { erreurs, valides } = controlerRefs([ref], git);
  if (!valides.length) return erreurs;
  let tete;
  let base;
  try {
    tete = git(['rev-parse', '--verify', '--quiet', `${head}^{commit}`]).toString().trim();
    base = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).toString().trim();
  } catch { return [`continuité : ${head} introuvable — échec`]; }
  let chaine;
  try { chaine = git(['rev-list', '--first-parent', tete]).toString().split('\n'); } catch { return ['continuité : historique illisible — échec']; }
  if (!chaine.includes(base)) {
    return [`continuité rompue : la référence ${base.slice(0, 7)} n'est pas sur la chaîne du premier parent de ${tete.slice(0, 7)} (merge aux parents inversés, fast-forward ou réécriture) — échec`];
  }
  return [];
}

// Versions (blobs distincts) d'un ensemble de chemins sur la chaîne du PREMIER PARENT
// de chaque référence (états publiés), sans filtrage par chemin. Renvoie
// { chemin -> Map(blob -> commit) } ; une erreur Git (autre qu'absence) est remontée.
function versionsSurHistorique(git, refs, prefixe) {
  const versions = new Map();
  const commits = new Set();
  for (const ref of refs) git(['rev-list', '--first-parent', ref]).toString().split('\n').filter(Boolean).forEach((c) => commits.add(c));
  for (const c of commits) {
    // ls-tree : sortie vide = chemin absent de ce commit (seul cas ignoré).
    for (const ligne of git(['ls-tree', '-r', c, '--', prefixe]).toString().split('\n').filter(Boolean)) {
      const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(ligne);
      if (!m) throw new Error(`entrée ls-tree inattendue en ${c.slice(0, 7)} : ${ligne}`);
      if (!versions.has(m[2])) versions.set(m[2], new Map());
      if (!versions.get(m[2]).has(m[1])) versions.get(m[2]).set(m[1], c);
    }
  }
  return versions;
}

function verifierHistorique(refs, registreCourant, lireOctets, racine = RACINE) {
  const git = executeurGit(racine);
  const { erreurs, valides } = controlerRefs(refs, git);
  if (!valides.length) return erreurs;
  let versions;
  try { versions = versionsSurHistorique(git, valides, 'fonda/engine/'); } catch (e) { return [...erreurs, `historique illisible : ${e.message}`]; }
  for (const [f, blobs] of versions) {
    const moteur = MOTIF_FICHIER.test(f);
    if (!moteur && f !== REGISTRE) continue;
    for (const [blob, c] of blobs) {
      let ancien;
      try { ancien = git(['cat-file', 'blob', blob]); } catch { erreurs.push(`${f} : objet ${blob.slice(0, 7)} (en ${c.slice(0, 7)}) illisible — échec`); continue; }
      if (moteur) {
        const actuel = lireOctets(f);
        if (!actuel) erreurs.push(`${f} (existait en ${c.slice(0, 7)}) : supprimé — un moteur publié ne disparaît jamais`);
        else if (!ancien.equals(actuel)) erreurs.push(`${f} : modifié depuis ${c.slice(0, 7)} — tout changement = nouvelle version`);
        continue;
      }
      let lignes;
      try { lignes = JSON.parse(ancien.toString('utf8')); } catch { erreurs.push(`${REGISTRE} illisible en ${c.slice(0, 7)} — échec`); continue; }
      if (!Array.isArray(lignes)) { erreurs.push(`${REGISTRE} en ${c.slice(0, 7)} : structure invalide — échec`); continue; }
      for (const l of lignes) {
        if (!registreCourant.some((x) => JSON.stringify(x) === JSON.stringify(l))) {
          erreurs.push(`${REGISTRE} : ligne ${l && l.version} (en ${c.slice(0, 7)}) retirée ou modifiée — registre en ajout seul`);
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
  const erreurs = [...new Set([
    ...invariantsRegistre(registre, lireOctetsDisque, fichiersMoteursDisque()),
    ...verifierContinuite(process.env.FONDA_REF_BASE),
    ...verifierHistorique(refs, registre, lireOctetsDisque),
  ])];
  if (erreurs.length) {
    console.error('✗ Immuabilité des moteurs :');
    erreurs.forEach((e) => console.error(`  - ${e}`));
    process.exitCode = 1;
    return;
  }
  console.log(`✓ moteurs immuables (${registre.map((l) => l.version).join(', ')}) + continuité — références : ${refs.join(', ')}`);
}

module.exports = {
  invariantsRegistre, verifierContinuite, verifierHistorique, lireOctetsDisque, fichiersMoteursDisque, MOTIF_FICHIER,
  // Primitives Git partagées avec verifier-immuabilite.js :
  executeurGit, controlerRefs, versionsSurHistorique, RACINE,
};

if (require.main === module) main();
