#!/usr/bin/env node
// Appelant UNIQUE de la génération FONDA (plan étape 5, lot 4) — Mac d'Éric, seul détenteur
// du jeton du PORTIER (jamais du webhook de génération). Logique : verrou-generation.js.
//
//   node fonda/scripts/declencher-generation.js <set_id> <ref>            un seul POST au portier
//   node fonda/scripts/declencher-generation.js --etat <set_id>           observer (accepte si vu)
//   node fonda/scripts/declencher-generation.js --liberer <set_id> --motif "<texte>"
//   node fonda/scripts/declencher-generation.js --reparer <set_id>        verrou orphelin / ligne tronquée
//
// Jamais de nouvel essai automatique : 202 -> accepte ; 400 -> refuse (nouvel appel possible) ;
// toute autre issue (504, 500, délai, rupture) -> inconnu : OBSERVER, ne jamais renvoyer.
// Les adaptateurs de PRODUCTION (lecture n8n/Drive/git, envoi au portier, jeton) relèvent du
// lot 5 : tant qu'ils ne sont pas livrés, la CLI refuse avant toute lecture.

'use strict';

const os = require('os');
const path = require('path');
const V = require('./verrou-generation.js');

const VERROUS_PAR_DEFAUT = path.join(os.homedir(), 'FONDA-clotures', 'verrous');

function analyserArguments(argv) {
  const a = [...argv];
  const opt = (nom) => { const i = a.indexOf(nom); if (i < 0) return undefined; const v = a[i + 1]; a.splice(i, 2); return v; };
  const motif = opt('--motif');
  const commande = ['--etat', '--liberer', '--reparer'].find((c) => a.includes(c)) || 'declencher';
  if (commande !== 'declencher') a.splice(a.indexOf(commande), 1);
  if (a.some((x) => x.startsWith('--'))) throw new V.RefusVerrou(`option inconnue : ${a.find((x) => x.startsWith('--'))}`);
  if (commande === 'declencher' && a.length !== 2) throw new V.RefusVerrou('usage : declencher-generation.js <set_id> <ref>');
  if (commande !== 'declencher' && a.length !== 1) throw new V.RefusVerrou(`usage : declencher-generation.js ${commande} <set_id>`);
  if (motif !== undefined && commande !== '--liberer') throw new V.RefusVerrou('--motif : seulement avec --liberer');
  return { commande, setId: a[0], ref: a[1], motif };
}

async function executer({ commande, setId, ref, motif }, deps) {
  if (commande === 'declencher') return V.declencher(setId, ref, deps);
  if (commande === '--etat') return V.etat(setId, deps);
  if (commande === '--liberer') return V.liberer(setId, motif, deps);
  return V.reparer(setId, deps);
}

// Fabrique de production : livrée au lot 5 (adaptateurs-production.js).
function dependancesProduction() {
  throw new V.RefusVerrou('adaptateurs de production non livrés (plan étape 5, lot 5) : aucun déclenchement possible');
}

async function main(argv = process.argv.slice(2), fabrique = dependancesProduction) {
  try {
    const args = analyserArguments(argv);
    const deps = { verrous: VERROUS_PAR_DEFAUT, ...fabrique(args) };
    const r = await executer(args, deps);
    console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exitCode = 1;
  }
}

module.exports = { analyserArguments, executer, main, VERROUS_PAR_DEFAUT };

if (require.main === module) main();
