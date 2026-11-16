// Processus ENFANT des tests du verrou de la relecture (fonda/scripts/verrou-relecture.test.js) :
// prend le VERROU NOYAU RÉEL (lockf -s -t 0 3, descripteur tenu par ce processus) puis exécute une
// action décrite par FONDA_TEST_CONF. Barrière facultative : après l'action « avant POST », écrit
// `pret` puis attend le fichier `go` (le parent teste alors la concurrence ou tue ce processus).
// Sortie : code 0 + JSON sur stdout ; 75 si le verrou est tenu ailleurs ; 1 sur tout autre refus.
'use strict';

const fs = require('fs');
const V = require('../verrou-relecture.js');

const conf = JSON.parse(process.env.FONDA_TEST_CONF);
const attendre = (p) => { const s = new Int32Array(new SharedArrayBuffer(4)); while (!fs.existsSync(p)) Atomics.wait(s, 0, 0, 20); };
const barriere = () => { if (conf.barriere) { fs.writeFileSync(conf.barriere.pret, String(process.pid)); attendre(conf.barriere.go); } };

try {
  const tenu = V.prendreVerrou(conf.verrous);
  const deps = { verrous: conf.verrous, sousVerrou: tenu.chemin };
  let r;
  if (conf.action === 'init') r = V.initialiser(deps);
  else if (conf.action === 'envoi') {
    const p = V.preparerEnvoi(conf.setId, conf.commande || 'emission', { candidat: conf.candidat ?? null, preexistantes: conf.preexistantes || [], listingComplet: true }, deps);
    if (conf.trace) fs.appendFileSync(conf.trace, 'POST\n'); // le POST est PARTI (journal d'abord : envoi déjà fsync)
    barriere(); // réponse attendue : le parent peut tuer ce processus, la requête survit côté récepteur
    r = V.conclure(p.tentative_id, 'accepte', { reponse: { generation_cle: 1, statut: 'en_attente' } }, deps);
  } else if (conf.action === 'signature') r = { decision: V.decisionSignature(conf.setId, deps) };
  else if (conf.action === 'reparer') { barriere(); r = V.reparer(deps); }
  else if (conf.action === 'tenir') { barriere(); r = { tenu: true }; }
  else throw new V.RefusRelecture('action inconnue');
  process.stdout.write(JSON.stringify(r));
} catch (e) {
  process.stderr.write(`✗ ${e.message}\n`);
  process.exitCode = e.code === V.OCCUPE ? V.OCCUPE : 1;
}
