// Processus ENFANT des tests du verrou (fonda/scripts/verrou-generation.test.js) : exécute la
// CLI réelle (relance sous /usr/bin/lockf comprise) avec des dépendances SIMULÉES décrites par
// FONDA_TEST_CONF. Barrière facultative : après l'écriture d'« envoi », écrit `pret` puis attend
// le fichier `go` (le parent peut alors tester la concurrence ou tuer le processus).
'use strict';

const fs = require('fs');
const D = require('../declencher-generation.js');

const conf = JSON.parse(process.env.FONDA_TEST_CONF);
const attendre = (p) => { const s = new Int32Array(new SharedArrayBuffer(4)); while (!fs.existsSync(p)) Atomics.wait(s, 0, 0, 20); };
const fabrique = () => ({
  horloge: () => new Date(conf.maintenant || Date.now()),
  delaiPrudenceMs: conf.delaiPrudenceMs,
  lecture: {
    reservation: async () => ({ ok: conf.reservationOk !== false, raison: 'absente' }),
    idsLocaux: async () => conf.idsLocaux || [],
    executionsDuSetId: async () => conf.executions ?? 0,
    candidatsDuSetId: async () => conf.candidats ?? 0,
  },
  envoyer: async () => {
    if (conf.barriere) { fs.writeFileSync(conf.barriere.pret, String(process.pid)); attendre(conf.barriere.go); }
    fs.appendFileSync(conf.trace, 'POST\n');
    if (conf.statut === 'erreur') throw new Error('ECONNRESET');
    return { statut: conf.statut ?? 202 };
  },
});
D.main(conf.argv, fabrique, conf.verrous);
