#!/usr/bin/env node
'use strict';

// Erreur au CHARGEMENT ou rejet non géré : jamais affichée telle quelle ; message fixe et code 1.
if (require.main === module) {
  const arret = () => { process.stderr.write('importer-recette : erreur (message non affichable)\n'); process.exit(1); };
  process.on('uncaughtException', arret); process.on('unhandledRejection', arret);
}
// OUTIL D'IMPORT DE RECETTE — ÉCRITURE EXPLICITE (P4b, option E). SÉPARÉ de l'oracle (outils-recette/, lecture
// seule) : il CRÉE un workflow sur l'instance. Rôle unique : importer UN des 4 exports de recette, INACTIF, après
// avoir substitué le secret HMAC d'instance dans le TEXTE du JSON (Page et Confirmer seulement).
//
// ENSEMBLES FERMÉS (connu-bon) :
//   - export : un des 4 chemins de recette (comparer-live REFERENCES), jamais un export de production ;
//   - secret : lu dans le TROUSSEAU macOS (service fixe SERVICE_TROUSSEAU), jamais en argument, jamais affiché,
//     jamais écrit ; forme exigée : 64 hexadécimaux minuscules (≠ valeur de remplacement publique) ; Page et
//     Confirmer lisent la MÊME entrée (même secret par construction) ;
//   - substitution : le fragment EXACT `"secret": "A_INJECTER_A_L_IMPORT"`, présent exactement 1 fois (Page,
//     Confirmer) ou 0 fois (Emettre, Cloturer) ; la constante de garde du code (même valeur, échappée) n'est PAS
//     touchée ; le corps POSTÉ est ce TEXTE substitué (aucune re-sérialisation locale) ;
//   - requêtes : instance de la liste fermée ; GET /api/v1/workflows?name=<nom de recette exact> (refus si le nom
//     existe déjà), POST /api/v1/workflows (une fois), GET /api/v1/workflows/<id créé> ; rien d'autre ;
//   - sortie : { schema, export, workflowId, identique, ecarts } (comparer-live, exception limitée aux 2 chemins du
//     secret) ; messages d'erreur d'une liste fermée.
// Confirmation EXPLICITE exigée : --confirmer-ecriture.
//
// Usage (Mac d'Éric) : FONDA_N8N_CLE_IMPORT_RECETTE=… node outils-import/importer-recette.js --confirmer-ecriture n8n/fonda-relecture-page/box-fonda-<k>-relecture.recette.json

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { INSTANCES, ID_WORKFLOW, CLE_API } = require('../outils-recette/lecture-seule.js');
const { REFERENCES, comparer } = require('../outils-recette/comparer-live.js');

const RACINE = path.join(__dirname, '..');
const SECRET_A_INJECTER = 'A_INJECTER_A_L_IMPORT';
const FRAGMENT = `"secret": "${SECRET_A_INJECTER}"`;
const SERVICE_TROUSSEAU = 'fonda-recette-page-hmac';
const AVEC_SECRET = Object.freeze({ [REFERENCES[0]]: false, [REFERENCES[1]]: false, [REFERENCES[2]]: true, [REFERENCES[3]]: true });
const NOMS = Object.freeze(['FONDA RECETTE - Emettre relecture', 'FONDA RECETTE - Cloturer relecture', 'FONDA RECETTE - Confirmer relecture', 'FONDA RECETTE - Page relecture']);

const MESSAGES = Object.freeze({
  CONFIRMATION: 'écriture non confirmée : --confirmer-ecriture exigé',
  ARGUMENTS: 'arguments : --confirmer-ecriture <export de recette> attendus, rien d\'autre',
  EXPORT_HORS_LISTE: 'export hors liste fermée (4 exports de recette)',
  EXPORT_ILLISIBLE: 'export illisible ou hors schéma',
  FRAGMENT: 'fragment de substitution du secret : nombre d\'occurrences inattendu',
  CLE: 'clé d\'API absente ou hors grammaire (variable FONDA_N8N_CLE_IMPORT_RECETTE)',
  TROUSSEAU: 'secret introuvable dans le trousseau (service fonda-recette-page-hmac)',
  SECRET_FORME: 'secret hors forme (64 hexadécimaux minuscules attendus, jamais la valeur de remplacement)',
  NOM_EXISTANT: 'un workflow de ce nom existe déjà sur l\'instance : import refusé (aucun doublon)',
  HTTP: 'API n8n : statut inattendu',
  TRANSPORT: 'échec du transport',
  REPONSE: 'réponse de l\'API hors schéma attendu',
  ACTIF: 'workflow créé ACTIF : à désactiver immédiatement (anomalie)',
});
class ErreurImport extends Error {
  constructor(code) {
    if (!Object.prototype.hasOwnProperty.call(MESSAGES, code)) throw new TypeError('code d\'erreur hors liste fermée');
    super(MESSAGES[code]); this.code = code;
  }
}
const messageSur = (e) => (e instanceof ErreurImport ? MESSAGES[e.code] : 'erreur (message non affichable)');

// Secret : trousseau macOS, appel SANS shell (argv fixe) ; jamais journalisé.
function lireTrousseau() {
  try { return execFileSync('/usr/bin/security', ['find-generic-password', '-s', SERVICE_TROUSSEAU, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\n$/, ''); } catch { throw new ErreurImport('TROUSSEAU'); }
}

// Texte à POSTER : substitution EXACTE du fragment ; vérifications de schéma sur le résultat.
function preparer(reference, secret) {
  if (typeof reference !== 'string' || !Object.prototype.hasOwnProperty.call(AVEC_SECRET, reference)) throw new ErreurImport('EXPORT_HORS_LISTE');
  let texte;
  try { texte = fs.readFileSync(path.join(RACINE, reference), 'utf8'); } catch { throw new ErreurImport('EXPORT_ILLISIBLE'); }
  const n = texte.split(FRAGMENT).length - 1;
  if (n !== (AVEC_SECRET[reference] ? 1 : 0)) throw new ErreurImport('FRAGMENT');
  if (AVEC_SECRET[reference]) {
    if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret)) throw new ErreurImport('SECRET_FORME');
    texte = texte.replace(FRAGMENT, `"secret": "${secret}"`);
  }
  let w;
  try { w = JSON.parse(texte); } catch { throw new ErreurImport('EXPORT_ILLISIBLE'); }
  if (!w || typeof w !== 'object' || Array.isArray(w) || Object.keys(w).join(',') !== 'name,nodes,connections,settings' || !NOMS.includes(w.name) || !Array.isArray(w.nodes)) throw new ErreurImport('EXPORT_ILLISIBLE');
  const hmac = w.nodes.filter((x) => x && x.type === 'n8n-nodes-base.crypto' && x.parameters && x.parameters.action === 'hmac');
  if (hmac.length !== (AVEC_SECRET[reference] ? 1 : 0) || (hmac.length && hmac[0].parameters.secret !== secret)) throw new ErreurImport('FRAGMENT');
  return { texte, nom: w.name };
}

async function importer({ reference, cle, secret, fetch: f = globalThis.fetch }) {
  if (typeof cle !== 'string' || !CLE_API.test(cle)) throw new ErreurImport('CLE');
  const { texte, nom } = preparer(reference, secret);
  const base = INSTANCES[0];
  const appel = async (url, init) => {
    let r;
    try { r = await f(url, { ...init, redirect: 'error' }); } catch { throw new ErreurImport('TRANSPORT'); }
    if (!r || !Number.isInteger(r.status) || r.status < 200 || r.status >= 300) throw new ErreurImport('HTTP');
    let j;
    try { j = await r.json(); } catch { throw new ErreurImport('REPONSE'); }
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new ErreurImport('REPONSE');
    return j;
  };
  const h = { 'X-N8N-API-KEY': cle, accept: 'application/json' };
  // 1. Aucun doublon : le nom de recette (liste fermée) ne doit pas exister.
  const l = await appel(`${base}/api/v1/workflows?name=${encodeURIComponent(nom)}`, { method: 'GET', headers: h });
  if (!Array.isArray(l.data)) throw new ErreurImport('REPONSE');
  if (l.data.some((x) => x && x.name === nom)) throw new ErreurImport('NOM_EXISTANT');
  // 2. Création (INACTIF par défaut côté n8n) : corps = TEXTE substitué, tel quel.
  const cree = await appel(`${base}/api/v1/workflows`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: texte });
  if (typeof cree.id !== 'string' || !ID_WORKFLOW.test(cree.id)) throw new ErreurImport('REPONSE');
  // 3. Relecture du créé et octet-identité (comparer-live : exception limitée aux 2 chemins du secret).
  const live = await appel(`${base}/api/v1/workflows/${cree.id}`, { method: 'GET', headers: h });
  if (live.id !== cree.id) throw new ErreurImport('REPONSE');
  if (live.active !== false) throw new ErreurImport('ACTIF');
  const c = comparer(live, reference);
  return { schema: 'import-recette/v1', export: reference, workflowId: cree.id, identique: c.identique, ecarts: c.ecarts };
}

async function principal(argv, { env = process.env, fetch: f = globalThis.fetch, trousseau = lireTrousseau } = {}) {
  if (!Array.isArray(argv) || argv.length !== 2 || argv.filter((a) => a === '--confirmer-ecriture').length !== 1) {
    throw new ErreurImport(Array.isArray(argv) && argv.includes('--confirmer-ecriture') ? 'ARGUMENTS' : 'CONFIRMATION');
  }
  const reference = argv.find((a) => a !== '--confirmer-ecriture');
  if (!Object.prototype.hasOwnProperty.call(AVEC_SECRET, reference)) throw new ErreurImport('EXPORT_HORS_LISTE');
  const cle = env.FONDA_N8N_CLE_IMPORT_RECETTE;
  if (typeof cle !== 'string' || !CLE_API.test(cle)) throw new ErreurImport('CLE');
  const secret = AVEC_SECRET[reference] ? trousseau() : null;
  const r = await importer({ reference, cle, secret, fetch: f });
  return { r, code: r.identique ? 0 : 1 };
}

module.exports = { SECRET_A_INJECTER, FRAGMENT, SERVICE_TROUSSEAU, NOMS, MESSAGES, ErreurImport, preparer, importer, principal };

if (require.main === module) {
  principal(process.argv.slice(2)).then(({ r, code }) => { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); process.exitCode = code; })
    .catch((e) => { process.stderr.write(`importer-recette : ${messageSur(e)}\n`); process.exitCode = 1; });
}
