// Processus ENFANT des tests du verrou de la relecture (fonda/scripts/verrou-relecture.test.js) :
// prend le VERROU NOYAU RÉEL (lockf -s -t 0 3, descripteur tenu par ce processus) puis exécute une
// action décrite par FONDA_TEST_CONF. Action `envoi` : journal d'abord (envoi + fsync), puis un VRAI
// POST HTTP vers `conf.url` (serveur local du test, qui répond 200 « reçu » comme un webhook n8n en
// mode onReceived) ; un 200 ne conclut rien : la tentative reste ouverte jusqu'au diagnostic.
// Barrière facultative : écrit `pret` puis attend le fichier `go` (le parent teste la concurrence ou
// tue ce processus). Sortie : code 0 + JSON ; 75 si le verrou est tenu ailleurs ; 1 sur tout autre refus.
'use strict';

const fs = require('fs');
const http = require('http');
const V = require('../verrou-relecture.js');

const conf = JSON.parse(process.env.FONDA_TEST_CONF);
const attendre = (p) => { const s = new Int32Array(new SharedArrayBuffer(4)); while (!fs.existsSync(p)) Atomics.wait(s, 0, 0, 20); };
const barriere = () => { if (conf.barriere) { fs.writeFileSync(conf.barriere.pret, String(process.pid)); attendre(conf.barriere.go); } };
const poster = (url, corps) => new Promise((resolve, reject) => {
  const req = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', reject);
  req.end(JSON.stringify(corps));
});

(async () => {
  const tenu = V.prendreVerrou(conf.verrous);
  const deps = { verrous: conf.verrous, sousVerrou: tenu.chemin };
  let r;
  if (conf.action === 'init') r = V.initialiser(deps);
  else if (conf.action === 'envoi') {
    const p = V.preparerEnvoi(conf.setId, conf.commande || 'emission', { candidat: conf.candidat ?? null, preexistantes: conf.preexistantes || [], listingComplet: true }, deps);
    const code = conf.url ? await poster(conf.url, { set_id: conf.setId }) : 200;
    if (code === 403 || code === 404) r = V.conclure(p.tentative_id, 'refuse_sans_effet', { http: code }, deps);
    else if (code !== 200) r = V.conclure(p.tentative_id, 'indetermine', { motif: 'erreur_serveur' }, deps);
    else r = { tentative_id: p.tentative_id, http: code }; // 200 = reçu : diagnostic plus tard
    barriere(); // POST parti et accusé : le parent peut tuer ce processus ; l'exécution survit côté serveur
  } else if (conf.action === 'signature') r = { decision: V.decisionSignature(conf.setId, deps) };
  else if (conf.action === 'reparer') { barriere(); r = V.reparer(deps); }
  else if (conf.action === 'tenir') { barriere(); r = { tenu: true }; }
  else throw new V.RefusRelecture('action inconnue');
  process.stdout.write(JSON.stringify(r));
})().catch((e) => {
  process.stderr.write(`✗ ${e.message}\n`);
  process.exitCode = e.code === V.OCCUPE ? V.OCCUPE : 1;
});
