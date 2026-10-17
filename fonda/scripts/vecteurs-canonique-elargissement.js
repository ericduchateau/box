#!/usr/bin/env node
// Vecteurs de REFUS d'élargissement (dette `rejouer-mutations-canonique.js --etendu`) :
// le banc échoue désormais si un champ est AFFAIBLI dans canonique.js.
//
// Source de la LISTE : fonda/scripts/champs-canonique.js, tenue à la main contre le CDC
// (jamais dérivée de canonique.js). Pour chaque contrat, une BASE = l'entrée d'un
// vecteur POSITIF déjà figé (validité prouvée par ses octets attendus), dont tous les
// tableaux ont au moins un élément ; puis, pour chaque chemin :
//   - champ NON nullable (primitif, objet, tableau, élément de tableau) -> valeur null ;
//   - chaîne seule -> nombre (1) ; nombre seul -> chaîne ("1").
// Ces vecteurs n'ont pas d'octets attendus. La vérité reste canonique-vecteurs.json :
// cet outil ne l'écrit jamais ; il reconstruit les vecteurs et les compare au fichier
// figé (index 114 et suivants, après les 71 v8.2 et les 43 de la brique 1).
//
// Usage : node fonda/scripts/vecteurs-canonique-elargissement.js   (sortie 0 = identiques)

'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./champs-canonique.js');

const RACINE = path.join(__dirname, '..', '..');
const FICHIER = path.join(RACINE, 'fonda/engine/canonique-vecteurs.json');
const NB_AVANT = 114;

// Base de chaque contrat : vecteur positif figé (tableaux non vides).
const BASES = Object.freeze({
  'moteur-fonda/v1': 'moteur-v1',
  'coeur-decision-fonda/v1': 'coeur-nominal',
  'recapitulatif-fonda/v1': 'recap-nominal',
  'attestation-cloture/v1': 'attestation-tiers-levees-incidents',
  'generation-fonda/v1': 'generation-nominale',
  'lot-complet-fonda/v1': 'lot-complet-nominal',
  'lot_relu-fonda/v1': 'lot-relu-nominal',
  'decision-fonda/v1': 'decision-saisie-locale',
  'attestation-cloture/v2': 'attestation-v2-incidents-badge-nul',
});

// Remplace la valeur au chemin (« a.b[].c » : premier élément de chaque tableau).
// Chemin introuvable, tableau vide ou intermédiaire null -> exception (base inadaptée).
function remplacer(entree, chemin, valeur) {
  const copie = JSON.parse(JSON.stringify(entree));
  const jetons = chemin.split('.');
  let parent = null;
  let cle = null;
  let courant = { racine: copie };
  let suivant = 'racine';
  for (const j of jetons) {
    const tableau = j.endsWith('[]');
    const nom = tableau ? j.slice(0, -2) : j;
    if (courant[suivant] === null || typeof courant[suivant] !== 'object' || !Object.prototype.hasOwnProperty.call(courant[suivant], nom)) throw new Error(`base : ${chemin} introuvable (${nom})`);
    parent = courant[suivant]; cle = nom;
    if (tableau) {
      if (!Array.isArray(parent[nom]) || parent[nom].length === 0) throw new Error(`base : ${chemin} — tableau ${nom} vide ou absent`);
      parent = parent[nom]; cle = 0;
    }
    courant = parent; suivant = cle;
  }
  parent[cle] = valeur;
  return copie;
}

function construire(figes) {
  const sortie = [];
  for (const [contrat, forme] of Object.entries(H.CONTRATS)) {
    const vb = figes.find((x) => x.id === BASES[contrat]);
    if (!vb || vb.refus || vb.contrat !== contrat) throw new Error(`base ${BASES[contrat]} : vecteur positif du contrat ${contrat} attendu`);
    const base = vb.entree;
    const court = contrat.replace(/-fonda\/v1$|\/v/g, (m) => (m === '/v' ? '-v' : ''));
    for (const { chemin, classe, nullable } of H.chemins(forme)) {
      if (nullable) continue;
      const cas = [['null', null]];
      if (classe === 'chaine') cas.push(['nombre', 1]);
      if (classe === 'nombre') cas.push(['chaine', '1']);
      for (const [suffixe, valeur] of cas) {
        sortie.push({
          id: `refus-larg-${court}-${chemin}-${suffixe}`,
          description: `élargissement : ${contrat} ${chemin} = ${JSON.stringify(valeur)} (${classe} non nullable au CDC)`,
          refus: true,
          contrat,
          entree: remplacer(base, chemin, valeur),
        });
      }
    }
  }
  return sortie;
}

function auditer(vecteurs) {
  const ecarts = [];
  const figes = vecteurs.slice(NB_AVANT);
  const construits = construire(vecteurs.slice(0, NB_AVANT));
  if (figes.length !== construits.length) ecarts.push(`nombre : figé ${figes.length}, reconstruit ${construits.length}`);
  for (let i = 0; i < Math.max(figes.length, construits.length); i += 1) {
    const f = figes[i], c = construits[i];
    if (JSON.stringify(f) !== JSON.stringify(c)) ecarts.push(`index ${NB_AVANT + i} : figé ${f ? f.id : '(absent)'} ≠ reconstruit ${c ? c.id : '(absent)'}`);
  }
  return ecarts;
}

module.exports = { construire, auditer, remplacer, BASES, NB_AVANT };

if (require.main === module) {
  const vecteurs = JSON.parse(fs.readFileSync(FICHIER, 'utf8')).vecteurs;
  const ecarts = auditer(vecteurs);
  if (ecarts.length) {
    for (const e of ecarts.slice(0, 20)) console.error('✗ ' + e);
    process.exit(1);
  }
  console.log(`✓ vecteurs d'élargissement : ${vecteurs.length - NB_AVANT} reconstruits depuis la liste du CDC, identiques au fichier figé`);
}
