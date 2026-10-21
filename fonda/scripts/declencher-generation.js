#!/usr/bin/env node
// Appelant UNIQUE de la génération FONDA (plan étape 5, lot 4) — Mac d'Éric, seul détenteur
// du jeton du PORTIER (jamais du webhook de génération). Logique : verrou-generation.js.
//
//   node fonda/scripts/declencher-generation.js <set_id> <ref>            un seul POST au portier
//   node fonda/scripts/declencher-generation.js --etat <set_id>           observer (accepte si vu)
//   node fonda/scripts/declencher-generation.js --liberer <set_id> --motif "<texte>"
//   node fonda/scripts/declencher-generation.js --reparer <set_id>        ligne tronquée / illisible
//
// Toute commande s'exécute sous le VERROU NOYAU de son set_id, TENU PAR CE PROCESSUS : Node ouvre
// `<verrous>/<set_id>.generation.verrou` puis fait poser le flock BSD sur CE descripteur par
// `/usr/bin/lockf -s -t 0 3` (mode descripteur). Le verrou appartient à la description de fichier
// ouverte détenue par Node (lockf se termine aussitôt) : libéré par le noyau à la mort de Node,
// y compris kill -9 ; jamais tenu par un superviseur séparé (relecture Codex du lot 4, r2).
// Une commande concurrente échoue aussitôt (code 75).
// Jamais de nouvel essai automatique : 202 -> accepte ; 400 -> refuse (nouvel appel possible) ;
// toute autre issue (504, 500, délai, rupture) -> inconnu : OBSERVER, ne jamais renvoyer.
// Adaptateurs de PRODUCTION (lecture n8n/Drive/git, envoi au portier, jeton) :
// adaptateurs-production.js (lot 5).

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

// Fabrique de production (lot 5) : lectures n8n/Drive/git et envoi au PORTIER (jeton de
// l'appelant lu dans ~/.fonda-cles/portier.jeton, jamais affiché).
function dependancesProduction() {
  return require('./adaptateurs-production.js').dependancesDeclenchement();
}

// Verrou noyau pris PAR CE PROCESSUS pour toute sa durée (descripteur volontairement jamais
// fermé : la fin du processus le libère). -> { chemin, fd } ; RefusVerrou si occupé.
function prendreVerrou(verrous, setId, { lockf = LOCKF } = {}) {
  const { verrou } = V.chemins(verrous, setId);
  fs.mkdirSync(verrous, { recursive: true });
  const fd = fs.openSync(verrou, 'a');
  const r = spawnSync(lockf, ['-s', '-t', '0', '3'], { stdio: ['ignore', 'ignore', 'inherit', fd] });
  if (r.status === 0) return { chemin: verrou, fd };
  fs.closeSync(fd);
  if (r.status === OCCUPE) throw new V.RefusVerrou(`${setId} : une autre commande tient le verrou (opération en cours) — réessayer après`);
  throw new V.RefusVerrou(`${setId} : verrou noyau impossible (lockf : ${r.error ? r.error.message : `code ${r.status}`})`);
}

async function main(argv = process.argv.slice(2), fabrique = dependancesProduction, verrous = VERROUS_PAR_DEFAUT) {
  try {
    const args = analyserArguments(argv);
    const tenu = prendreVerrou(verrous, args.setId);
    const deps = { verrous, sousVerrou: tenu.chemin, ...fabrique(args) };
    console.log(JSON.stringify(await executer(args, deps), null, 2));
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exitCode = /tient le verrou/.test(e.message) ? OCCUPE : 1;
  }
}

module.exports = { analyserArguments, executer, main, prendreVerrou, VERROUS_PAR_DEFAUT, OCCUPE };

if (require.main === module) main();
