'use strict';
// Analyse STRICTE des lignes de commande des outils de recette : options d'un ENSEMBLE FERMÉ, chacune au
// plus une fois et avec sa valeur ; positionnels en nombre exact ; tout le reste -> erreur (jamais un défaut
// silencieux). Erreurs = codes de la liste fermée (ErreurOutil) ; l'argument reçu n'est jamais cité.
const { ErreurOutil } = require('./lecture-seule.js');

function analyser(argv, { options = [], positionnels = 0 }) {
  const o = Object.create(null); const p = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (typeof a === 'string' && a.startsWith('--')) {
      if (!options.includes(a)) throw new ErreurOutil('OPTION_INCONNUE');
      if (Object.prototype.hasOwnProperty.call(o, a)) throw new ErreurOutil('OPTION_DOUBLE');
      const v = argv[i + 1];
      if (typeof v !== 'string' || v === '' || v.startsWith('--')) throw new ErreurOutil('OPTION_VALEUR');
      o[a] = v; i += 1;
    } else p.push(a);
  }
  if (p.length !== positionnels) throw new ErreurOutil('POSITIONNELS');
  return { options: o, positionnels: p };
}
module.exports = { analyser };
