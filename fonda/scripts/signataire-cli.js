// CLI du signataire (plan étape 5, lot 5) — appelée par `signer-cloture.js --<commande>`.
//   --actualiser                     git fetch de design, refspec EXPLICITE (interim.js) : écrit dans .git
//   --initialiser                    registre des incidents (jamais de remise à zéro)
//   --diagnostic [<set_id>]          aucune clé de signature ; écrit dans .git (même fetch
//                                    explicite que --actualiser, CDC r9) et affiche le SHA
//   --saisir <set_id>                décision locale figée (saisirDecisionLocale)
//   --extraire-publication <set_id>  lot-relu.json depuis les pièces SIGNÉES vérifiées
// La clôture `<set_id>` reste dans signer-cloture.js : GARDE MAÎTRESSE en place (lot 7).
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const A = require('./adaptateurs-production.js');
const I = require('./interim.js');

function analyserArguments(argv) {
  const [commande, setId, ...reste] = argv;
  const avecSetId = ['--saisir', '--extraire-publication'];
  const sansSetId = ['--actualiser', '--initialiser'];
  if (reste.length) throw new A.ErreurAdaptateur(`argument en trop : ${reste[0]}`);
  if (avecSetId.includes(commande)) { if (!setId) throw new A.ErreurAdaptateur(`usage : ${commande} <set_id>`); return { commande, setId }; }
  if (sansSetId.includes(commande)) { if (setId) throw new A.ErreurAdaptateur(`${commande} : aucun argument`); return { commande }; }
  if (commande === '--diagnostic') return { commande, setId };
  throw new A.ErreurAdaptateur(`commande inconnue : ${commande}`);
}

// Écriture EXACTE et relançable de lot-relu.json.
function ecrireLotRelu(chemin, texte) {
  const attendu = Buffer.from(texte, 'utf8');
  if (fs.existsSync(chemin)) {
    if (fs.readFileSync(chemin).equals(attendu)) return { ecrit: false, chemin, message: 'déjà extrait, octets identiques : aucune écriture' };
    throw new A.ErreurAdaptateur(`${chemin} existe et DIFFÈRE du lot dérivé des pièces signées : refus (traitement manuel)`);
  }
  A.fsProduction.ecrireExclusif(chemin, texte);
  return { ecrit: true, chemin };
}

async function executer(args, o = {}) {
  if (args.commande === '--actualiser') {
    // Même refspec EXPLICITE que l'intérim : la référence de suivi est mise à jour quelle que
    // soit la configuration remote.origin.fetch.
    const racine = o.racine || path.join(__dirname, '..', '..');
    const git = o.git || ((a) => execFileSync('git', a, { cwd: racine, stdio: ['ignore', 'pipe', 'inherit'] }));
    return { actualise: 'origin/design', sha: I.actualiser(git).sha };
  }
  // Commandes LOCALES : aucun secret réseau requis.
  if (args.commande === '--initialiser') return (o.sources || A.sourcesLocales(o)).initialiser();
  if (args.commande === '--extraire-publication') {
    const l = o.sources || A.sourcesLocales(o);
    const dl = A.dossierDuLot(l.dossier, args.setId);
    const { lot } = await l.verifier(dl, args.setId); // lot DEMANDÉ, chemin canonique, signature complète
    return ecrireLotRelu(path.join(dl, 'lot-relu.json'), `${JSON.stringify(lot, null, 2)}\n`);
  }
  const s = o.sources || A.sourcesLecture(o);
  if (args.commande === '--diagnostic') {
    const D = require('./diagnostic-fonda.js');
    return args.setId ? D.diagnostiquer(args.setId, s) : D.diagnostiquerAcces(s);
  }
  if (args.commande === '--saisir') {
    // saisir/afficher : terminal par défaut (adaptateurs), injectables pour les tests.
    const SC = require('./signer-cloture.js');
    return SC.saisirDecisionLocale(args.setId, await A.dependancesSaisie(args.setId, { ...o, sources: s }));
  }
  throw new A.ErreurAdaptateur(`commande non prise en charge : ${args.commande}`);
}

async function main(argv, o = {}) {
  try {
    const r = await executer(analyserArguments(argv), o);
    console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exitCode = 1;
  }
}

module.exports = { analyserArguments, executer, main, ecrireLotRelu };
