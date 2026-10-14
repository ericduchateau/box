// Immuabilité des lots publiés en CI (CDC relecture annexe B §17, §6, §15) — job
// `immuabilite`. Filet NON PROBANT (option B) : la garantie reste la relecture
// humaine d'Éric ; ce contrôle DÉTECTE (CI rouge), il n'EMPÊCHE pas (la prévention est
// la protection de branche).
//
// RÉFÉRENCE : PR -> github.event.pull_request.base.sha ; push -> github.event.before
// (variable FONDA_REF_BASE). Nulle, introuvable, historique incomplet -> ÉCHEC
// explicite ; jamais de comparaison à vide. HISTORIQUE DE CONFIANCE = chaîne du
// PREMIER PARENT de la référence ET de `design` (autorité), avec CONTINUITÉ (la
// référence est sur la chaîne du premier parent de HEAD). Hypothèse : intégration par
// merge commit ou squash (rebase-merge et push direct exclus, annexe A).
//
// TUPLE d'identité d'un lot publié : set_id -> (empreinte, moteur.version, moteur.sha256).
// Registre des tuples = toutes les entrées de toutes les versions du catalogue de
// l'historique de confiance. RÈGLE UNIQUE, pour chaque entrée du catalogue courant :
//   - set_id déjà publié (présent dans une version de l'historique) -> tuple IDENTIQUE
//     à son unique tuple publié avec moteur (lot inchangé, transit design -> main,
//     remplacement d'attestation à contenu et moteur identiques) ;
//   - RÈGLE 0 / M1 (consommable une seule fois) : si AUCUNE version de l'historique
//     n'a jamais contenu de champ `moteur`, un lot historique figé (HISTORIQUES_FIGES)
//     peut recevoir moteur v1 du registre à empreinte figée inchangée ; dès qu'un champ
//     `moteur` a existé, la règle 0 ne s'applique plus (un catalogue vidé ne la
//     réarme pas) ;
//   - sinon (première publication) -> le journal contient `reserve` puis `publie`
//     (état courant publie), sans `abandonne` ni `retire` ; présence antérieure en
//     calibration autorisée (promotion du candidat réservé) ;
//   - REFUSÉ dans tous les cas : changement de tuple ; set_id dont le journal contient
//     `abandonne` ou `retire` ; set_id absent du journal.
//   - RETRAIT : set_id présent au catalogue de la référence et absent du catalogue
//     courant -> une transition `retire` AJOUTÉE dans cette PR (absente du journal de
//     la référence), sinon refus.
// AUTRES CONTRÔLES : journal en AJOUT SEUL (toute version de l'historique de confiance
// est un préfixe exact du journal courant), transitions conformes et aucun double
// `reserve` (fonda/engine/journal-set-ids.js) ; MOTEURS (registre en ajout seul,
// fichiers identiques, SHA-256 = registre = SRI) rejoués par les fonctions de
// fonda/scripts/verifier-moteurs.js — une seule implémentation.
//
// FRONTIÈRE : verifier-moteurs.js possède les moteurs et les primitives Git ; CE
// fichier possède la règle du tuple, la règle 0 de M1, le journal et les retraits.
//
// Usage : FONDA_REF_BASE=<sha> node fonda/scripts/verifier-immuabilite.js

'use strict';

const fs = require('fs');
const path = require('path');
const M = require('./verifier-moteurs.js');
const J = require('../engine/journal-set-ids.js');

const CATALOGUE = 'fonda/data/catalogue-fonda.json';
const JOURNAL = 'fonda/data/set_ids-journal.json';
const REGISTRE = 'fonda/engine/moteurs.json';

const aMoteur = (e) => !!e && Object.prototype.hasOwnProperty.call(e, 'moteur');
const tuple = (e) => JSON.stringify([e.empreinte, aMoteur(e) && e.moteur ? e.moteur.version : null, aMoteur(e) && e.moteur ? e.moteur.sha256 : null]);

// Versions (contenus JSON) d'un fichier sur l'historique de confiance. Objet illisible
// ou JSON invalide -> exception (jamais assimilé à une absence).
function versionsJson(git, refs, chemin) {
  const versions = M.versionsSurHistorique(git, refs, chemin).get(chemin) || new Map();
  const out = [];
  for (const [blob, commit] of versions) {
    let texte;
    try { texte = git(['cat-file', 'blob', blob]).toString('utf8'); } catch { throw new Error(`${chemin} : objet ${blob.slice(0, 7)} (en ${commit.slice(0, 7)}) illisible`); }
    try { out.push({ commit, contenu: JSON.parse(texte) }); } catch { throw new Error(`${chemin} illisible en ${commit.slice(0, 7)} (JSON invalide)`); }
  }
  return out;
}

// Contenu JSON d'un fichier à une référence ; null si le fichier y est ABSENT (constat
// par ls-tree) ; exception s'il est illisible.
function jsonALaRef(git, ref, chemin) {
  const ls = git(['ls-tree', ref, '--', chemin]).toString().trim();
  if (!ls) return null;
  let texte;
  try { texte = git(['show', `${ref}:${chemin}`]).toString('utf8'); } catch { throw new Error(`${chemin} illisible à ${ref}`); }
  try { return JSON.parse(texte); } catch { throw new Error(`${chemin} à ${ref} : JSON invalide`); }
}

// Cœur pur : décision sur des données déjà lues (testable sans Git).
//   historiqueCatalogues : contenus de toutes les versions du catalogue (confiance)
//   historiqueJournaux   : contenus de toutes les versions du journal (confiance)
function decider({ catalogueCourant, journalCourant, catalogueRef, journalRef, historiqueCatalogues, historiqueJournaux, registre, historiques }) {
  const erreurs = [];
  // Journal : forme, transitions, double reserve (état courant).
  const vj = J.validerJournal(journalCourant);
  if (!vj.valide) return vj.erreurs.map((e) => `journal : ${e}`);
  // Journal en ajout seul : chaque version de confiance est un préfixe exact.
  const courantes = journalCourant.lignes.map((l) => JSON.stringify(l));
  for (const v of historiqueJournaux) {
    const lignes = (v && Array.isArray(v.lignes)) ? v.lignes : null;
    if (!lignes || v.schema !== journalCourant.schema) { erreurs.push('journal : une version de l\'historique de confiance est de forme invalide'); continue; }
    if (lignes.length > courantes.length || lignes.some((l, i) => JSON.stringify(l) !== courantes[i])) {
      erreurs.push('journal : ligne modifiée, supprimée ou réordonnée par rapport à une version publiée (ajout seul)');
    }
  }
  // Registre des tuples publiés.
  let moteurAExiste = false;
  const publies = new Map(); // set_id -> { avecMoteur: Set(tuple), sansMoteur: Set(tuple) }
  for (const cat of historiqueCatalogues) {
    if (!cat || !Array.isArray(cat.lots)) { erreurs.push('catalogue : une version de l\'historique de confiance est de forme invalide'); continue; }
    for (const e of cat.lots) {
      if (!e || typeof e.set_id !== 'string') { erreurs.push('catalogue : entrée historique sans set_id'); continue; }
      if (!publies.has(e.set_id)) publies.set(e.set_id, { avecMoteur: new Set(), sansMoteur: new Set() });
      if (aMoteur(e)) { moteurAExiste = true; publies.get(e.set_id).avecMoteur.add(tuple(e)); } else publies.get(e.set_id).sansMoteur.add(tuple(e));
    }
  }
  if (erreurs.length) return erreurs;
  const v1 = (registre || []).find((l) => l && l.version === 'v1');
  const lignesDe = (id) => journalCourant.lignes.filter((l) => l.set_id === id).map((l) => l.transition);
  const lots = (catalogueCourant && Array.isArray(catalogueCourant.lots)) ? catalogueCourant.lots : null;
  if (!lots) return ['catalogue courant : forme invalide'];
  for (const e of lots) {
    const id = e && e.set_id;
    const p = `${id}`;
    const transitions = lignesDe(id);
    if (!transitions.length) { erreurs.push(`${p} : absent du journal des set_id`); continue; }
    if (transitions.includes('abandonne') || transitions.includes('retire')) { erreurs.push(`${p} : journal contient ${transitions.includes('retire') ? 'retire' : 'abandonne'} — jamais réutilisable`); continue; }
    if (vj.etats.get(id) !== 'publie') { erreurs.push(`${p} : état journal ${vj.etats.get(id)} (attendu publie)`); continue; }
    const connu = publies.get(id);
    if (connu) {
      if (connu.avecMoteur.size > 0) {
        if (connu.avecMoteur.size !== 1 || !connu.avecMoteur.has(tuple(e))) erreurs.push(`${p} : tuple (empreinte, moteur) ≠ tuple publié — un lot publié est immuable`);
        continue;
      }
      // Publié seulement avant M1 : seule la règle 0 peut l'admettre.
      const regle0 = !moteurAExiste && Object.prototype.hasOwnProperty.call(historiques, id)
        && e.empreinte === historiques[id] && aMoteur(e) && e.moteur && v1
        && e.moteur.version === 'v1' && e.moteur.sha256 === v1.sha256;
      if (!regle0) erreurs.push(`${p} : publié avant M1 ; ${moteurAExiste ? 'M1 déjà consommée — tuple non publié refusé' : 'règle 0 : seuls les lots historiques figés, empreinte figée, moteur v1 du registre'}`);
      continue;
    }
    // Première publication : reserve puis publie (déjà garanti par l'état publie + transitions conformes).
    if (transitions[0] !== 'reserve' || !transitions.includes('publie')) erreurs.push(`${p} : première publication sans reserve puis publie`);
  }
  // Retraits.
  const courantsIds = new Set(lots.map((e) => e && e.set_id));
  const retiresRef = new Set(((journalRef && Array.isArray(journalRef.lignes)) ? journalRef.lignes : []).filter((l) => l.transition === 'retire').map((l) => l.set_id));
  for (const e of (catalogueRef && Array.isArray(catalogueRef.lots)) ? catalogueRef.lots : []) {
    if (!e || courantsIds.has(e.set_id)) continue;
    if (vj.etats.get(e.set_id) !== 'retire' || retiresRef.has(e.set_id)) erreurs.push(`${e.set_id} : retiré du catalogue sans transition « retire » ajoutée dans cette PR`);
  }
  return erreurs;
}

function verifier({ refBase, racine = M.RACINE, lire = (rel) => fs.readFileSync(path.join(racine, rel), 'utf8') }) {
  const git = M.executeurGit(racine);
  const refs = [...new Set([refBase, 'design'])];
  const { erreurs, valides } = M.controlerRefs(refs, git);
  if (erreurs.length) return erreurs;
  const sortie = [...M.verifierContinuite(refBase, 'HEAD', racine)];
  let donnees;
  try {
    const lireJson = (rel) => { try { return JSON.parse(lire(rel)); } catch (e) { throw new Error(`${rel} (copie courante) illisible`); } };
    donnees = {
      catalogueCourant: lireJson(CATALOGUE),
      journalCourant: lireJson(JOURNAL),
      registre: lireJson(REGISTRE),
      catalogueRef: jsonALaRef(git, refBase, CATALOGUE),
      journalRef: jsonALaRef(git, refBase, JOURNAL),
      historiqueCatalogues: versionsJson(git, valides, CATALOGUE).map((v) => v.contenu),
      historiqueJournaux: versionsJson(git, valides, JOURNAL).map((v) => v.contenu),
      historiques: require('../engine/catalogue.js').HISTORIQUES_FIGES,
    };
  } catch (e) { return [...sortie, `lecture impossible — échec : ${e.message}`]; }
  return [...sortie, ...decider(donnees)];
}

function main() {
  const refBase = process.env.FONDA_REF_BASE;
  const registre = JSON.parse(fs.readFileSync(path.join(M.RACINE, REGISTRE), 'utf8'));
  const refs = [...new Set([refBase, 'design'])];
  const erreurs = [...new Set([
    ...M.invariantsRegistre(registre, M.lireOctetsDisque, M.fichiersMoteursDisque()),
    ...M.verifierHistorique(refs, registre, M.lireOctetsDisque),
    ...verifier({ refBase }),
  ])];
  if (erreurs.length) {
    console.error('✗ Immuabilité (annexe B) :');
    erreurs.forEach((e) => console.error(`  - ${e}`));
    process.exitCode = 1;
    return;
  }
  console.log(`✓ immuabilité : tuples, règle 0, journal, retraits, moteurs, continuité — références : ${refs.join(', ')}`);
}

module.exports = { decider, verifier, versionsJson, jsonALaRef, tuple };

if (require.main === module) main();
