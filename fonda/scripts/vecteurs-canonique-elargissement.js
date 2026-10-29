#!/usr/bin/env node
// Vecteurs de REFUS d'élargissement (dette `rejouer-mutations-canonique.js --etendu`) :
// le banc échoue désormais si un champ est AFFAIBLI dans canonique.js.
//
// Source de la LISTE : fonda/scripts/champs-canonique.js, tenue à la main contre le CDC
// (jamais dérivée de canonique.js). Pour chaque contrat, une BASE = l'entrée d'un
// vecteur POSITIF déjà figé (validité prouvée par ses octets attendus), dont tous les
// tableaux ont au moins un élément ; puis, pour CHAQUE chemin (primitif, objet,
// tableau, élément de tableau, champ d'un objet nullable), un refus par TYPE INTERDIT
// au CDC parmi : null, nombre (1), chaîne ("1"), booléen (true), objet ({}), tableau
// ([]). Types admis : la classe du chemin (chaîne ou nombre : les deux), plus null s'il
// est nullable. Aucun type interdit n'est laissé sans vecteur, même quand un
// sous-schéma est partagé entre contrats (garantie champ par champ, contrat par contrat).
// Ces vecteurs n'ont pas d'octets attendus. La vérité reste canonique-vecteurs.json :
// cet outil ne l'écrit jamais ; il reconstruit les vecteurs et les compare au fichier
// figé. Repérage par IDENTIFIANT STABLE (préfixe « refus-larg- »), jamais par index : le
// premier bloc (index 114 à 1333, après les 71 v8.2 et les 43 de la brique 1) reste à
// l'octet près ; les contrats de l'intérim (decision-fonda/v2, attestation-cloture/v3, CDC
// r9) ajoutent leurs vecteurs APRÈS le bloc d'intérim (vecteurs-canonique-interim.js).
//
// Usage : node fonda/scripts/vecteurs-canonique-elargissement.js   (sortie 0 = identiques)

'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./champs-canonique.js');

const RACINE = path.join(__dirname, '..', '..');
const FICHIER = path.join(RACINE, 'fonda/engine/canonique-vecteurs.json');
const NB_AVANT = 114; // début du PREMIER bloc d'élargissement (historique, inchangé)
const PREFIXE = 'refus-larg-';
const estElargissement = (x) => typeof x.id === 'string' && x.id.startsWith(PREFIXE);

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
  'decision-fonda/v2': 'decision-v2-interim',
  'attestation-cloture/v3': 'attestation-v3-structure-complete',
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

// Valeurs d'essai par type ; types admis par classe (d'après la liste du CDC).
const ESSAIS = Object.freeze([['null', null], ['nombre', 1], ['chaine', '1'], ['booleen', true], ['objet', {}], ['tableau', []]]);
const ADMIS = Object.freeze({ chaine: ['chaine'], nombre: ['nombre'], booleen: ['booleen'], chaine_ou_nombre: ['chaine', 'nombre'], objet: ['objet'], tableau: ['tableau'] });
function typesInterdits(classe, nullable) {
  const admis = ADMIS[classe];
  if (!admis) throw new Error(`classe inconnue : ${classe}`);
  return ESSAIS.filter(([t]) => !admis.includes(t) && !(nullable && t === 'null'));
}

function construire(figes) {
  const sortie = [];
  for (const [contrat, forme] of Object.entries(H.CONTRATS)) {
    const vb = figes.find((x) => x.id === BASES[contrat]);
    if (!vb || vb.refus || vb.contrat !== contrat) throw new Error(`base ${BASES[contrat]} : vecteur positif du contrat ${contrat} attendu`);
    const base = vb.entree;
    const court = contrat.replace(/-fonda\/v1$|\/v/g, (m) => (m === '/v' ? '-v' : ''));
    for (const { chemin, classe, nullable } of H.chemins(forme)) {
      for (const [suffixe, valeur] of typesInterdits(classe, nullable)) {
        sortie.push({
          id: `refus-larg-${court}-${chemin}-${suffixe}`,
          description: `élargissement : ${contrat} ${chemin} = ${JSON.stringify(valeur)} (${classe}${nullable ? ' | null' : ''} au CDC)`,
          refus: true,
          contrat,
          entree: remplacer(base, chemin, valeur),
        });
      }
    }
  }
  return sortie;
}

// Vecteurs d'élargissement du fichier (par identifiant) ; bases = tous les AUTRES vecteurs.
const elargissements = (vecteurs) => vecteurs.filter(estElargissement);
function auditer(vecteurs) {
  const ecarts = [];
  const figes = elargissements(vecteurs);
  const construits = construire(vecteurs.filter((x) => !estElargissement(x)));
  if (figes.length !== construits.length) ecarts.push(`nombre : figé ${figes.length}, reconstruit ${construits.length}`);
  for (let i = 0; i < Math.max(figes.length, construits.length); i += 1) {
    const f = figes[i], c = construits[i];
    if (JSON.stringify(f) !== JSON.stringify(c)) ecarts.push(`élargissement n° ${i} : figé ${f ? f.id : '(absent)'} ≠ reconstruit ${c ? c.id : '(absent)'}`);
  }
  return ecarts;
}

module.exports = { construire, auditer, remplacer, typesInterdits, elargissements, estElargissement, BASES, NB_AVANT, PREFIXE };

if (require.main === module) {
  const vecteurs = JSON.parse(fs.readFileSync(FICHIER, 'utf8')).vecteurs;
  const ecarts = auditer(vecteurs);
  if (ecarts.length) {
    for (const e of ecarts.slice(0, 20)) console.error('✗ ' + e);
    process.exit(1);
  }
  console.log(`✓ vecteurs d'élargissement : ${elargissements(vecteurs).length} reconstruits depuis la liste du CDC, identiques au fichier figé`);
}
