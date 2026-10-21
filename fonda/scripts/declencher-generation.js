#!/usr/bin/env node
// Appelant UNIQUE de la génération FONDA (plan étape 5, lot 4) — Mac d'Éric, seul détenteur
// du jeton du PORTIER (jamais du webhook de génération). Logique : verrou-generation.js.
//
//   node fonda/scripts/declencher-generation.js <set_id> <ref>            un seul POST au portier
//   node fonda/scripts/declencher-generation.js --etat <set_id>           observer (accepte si vu)
//   node fonda/scripts/declencher-generation.js --liberer <set_id> --motif "<texte>"
//   node fonda/scripts/declencher-generation.js --reparer <set_id>        ligne tronquée / illisible
//
// Toute commande s'exécute sous le VERROU NOYAU de son set_id : la CLI se relance elle-même sous
// `/usr/bin/lockf -s -t 0 -k <verrous>/<set_id>.generation.verrou` (libéré par le noyau à la mort
// du processus ; une commande concurrente échoue aussitôt, code 75).
// Jamais de nouvel essai automatique : 202 -> accepte ; 400 -> refuse (nouvel appel possible) ;
// toute autre issue (504, 500, délai, rupture) -> inconnu : OBSERVER, ne jamais renvoyer.
// Adaptateurs de PRODUCTION (lecture n8n/Drive/git, envoi au portier, jeton) : lot 5 — d'ici
// là, la CLI refuse avant toute lecture.

'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const V = require('./verrou-generation.js');

const VERROUS_PAR_DEFAUT = path.join(os.homedir(), 'FONDA-clotures', 'verrous');
const LOCKF = '/usr/bin/lockf';
const OCCUPE = 75; // EX_TEMPFAIL de lockf -t 0

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
  throw new V.RefusVerrou('adaptateurs de production non livrés (plan étape 5, lot 5) : aucune commande possible');
}

// Relance sous verrou noyau ; renvoie le code de sortie à propager, ou null si DÉJÀ sous verrou.
function relancerSousVerrou(argv, verrous, setId, { lockf = LOCKF, script = process.argv[1] } = {}) { // script = point d'entrée réel (CLI ou harnais)
  const { verrou } = V.chemins(verrous, setId);
  if (process.env.FONDA_SOUS_VERROU === verrou) return null;
  fs.mkdirSync(verrous, { recursive: true });
  const r = spawnSync(lockf, ['-s', '-t', '0', '-k', verrou, process.execPath, script, ...argv], { stdio: 'inherit', env: { ...process.env, FONDA_SOUS_VERROU: verrou } });
  if (r.status === OCCUPE) console.error(`✗ ${setId} : une autre commande tient le verrou (opération en cours) — réessayer après`);
  return r.status === null ? 1 : r.status;
}

async function main(argv = process.argv.slice(2), fabrique = dependancesProduction, verrous = VERROUS_PAR_DEFAUT) {
  try {
    const args = analyserArguments(argv);
    const code = relancerSousVerrou(argv, verrous, args.setId);
    if (code !== null) { process.exitCode = code; return; }
    const deps = { verrous, sousVerrou: process.env.FONDA_SOUS_VERROU, ...fabrique(args) };
    console.log(JSON.stringify(await executer(args, deps), null, 2));
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exitCode = 1;
  }
}

module.exports = { analyserArguments, executer, main, relancerSousVerrou, VERROUS_PAR_DEFAUT, OCCUPE };

if (require.main === module) main();
