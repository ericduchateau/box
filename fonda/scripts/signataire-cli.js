// CLI du signataire (plan étape 5, lot 5) — appelée par `signer-cloture.js --<commande>`.
//   --actualiser                     git fetch origin design (SEULE commande qui écrit dans .git)
//   --initialiser                    registre des incidents (jamais de remise à zéro)
//   --diagnostic [<set_id>]          lecture seule HERMÉTIQUE (aucune clé de signature)
//   --saisir <set_id>                décision locale figée (saisirDecisionLocale)
//   --extraire-publication <set_id>  lot-relu.json depuis les pièces SIGNÉES vérifiées
// La clôture `<set_id>` reste dans signer-cloture.js : GARDE MAÎTRESSE en place (lot 7).
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const A = require('./adaptateurs-production.js');

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
    execFileSync('git', ['fetch', '--quiet', 'origin', 'design'], { cwd: o.racine || path.join(__dirname, '..', '..'), stdio: 'inherit' });
    return { actualise: 'origin/design' };
  }
  const s = o.sources || A.sourcesLecture(o);
  if (args.commande === '--initialiser') return s.initialiser();
  if (args.commande === '--diagnostic') {
    const D = require('./diagnostic-fonda.js');
    return args.setId ? D.diagnostiquer(args.setId, s) : D.diagnostiquerAcces(s);
  }
  if (args.commande === '--saisir') {
    const SC = require('./signer-cloture.js');
    return SC.saisirDecisionLocale(args.setId, await A.dependancesSaisie(args.setId, { ...o, sources: s }));
  }
  // --extraire-publication : vérification COMPLÈTE des pièces signées, puis dérivation.
  const dl = A.dossierDuLot(s.dossier, args.setId);
  const { lot } = await s.verifier(dl);
  return ecrireLotRelu(path.join(dl, 'lot-relu.json'), `${JSON.stringify(lot, null, 2)}\n`);
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
