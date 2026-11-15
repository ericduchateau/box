#!/usr/bin/env node
'use strict';

// Erreur au CHARGEMENT ou rejet non géré : jamais affichée telle quelle ; message fixe et code 1.
if (require.main === module) {
  const arret = () => { process.stderr.write('importer-recette : erreur (message non affichable)\n'); process.exit(1); };
  process.on('uncaughtException', arret); process.on('unhandledRejection', arret);
}
// OUTIL D'IMPORT (recette, puis production : déploiement phase A) — ÉCRITURE EXPLICITE (P4b, option E). SÉPARÉ de
// l'oracle (outils-recette/, lecture seule) : il CRÉE des workflows sur l'instance, INACTIFS. Cibles (liste fermée),
// PAR ENVIRONNEMENT :
//   - l'export Emettre, ou celui de Cloturer (aucun secret) ;
//   - « page-et-confirmer » (recette) / « page-et-confirmer-production » : Page ET Confirmer en UNE commande, avec UN
//     secret HMAC lu UNE fois dans le trousseau : la même clé signe (Page) et recalcule (Confirmer), par construction.
// ENVIRONNEMENTS ÉTANCHES : une cible ne lit QUE la clé d'import de son environnement (variable dédiée ; celle de
// l'autre environnement présente = refus) et QUE le service de trousseau de son environnement (fonda-recette-* /
// fonda-prod-* ; un service croisé = refus) ; noms de workflows de son environnement seulement.
//
// ENSEMBLES FERMÉS (connu-bon) :
//   - secret : trousseau macOS, service FIXE par environnement, `/usr/bin/security` sans shell, argv fixe ; jamais
//     en argument, jamais affiché ni écrit ; forme : 64 hexadécimaux minuscules (≠ valeur de remplacement). Sa
//     qualité (aléatoire) tient à sa génération : `openssl rand -hex 32` sur le Mac d'Éric ;
//   - substitution : le fragment EXACT `"secret": "A_INJECTER_A_L_IMPORT"`, présent exactement 1 fois (Page,
//     Confirmer) ou 0 (Emettre, Cloturer) ; la constante de garde du code n'est PAS touchée ; corps POSTÉ = TEXTE
//     substitué (aucune re-sérialisation locale) ;
//   - requêtes : instance de la liste fermée ; GET /api/v1/workflows?name=… paginé JUSQU'AU BOUT (éléments et
//     curseurs validés ; recherche incomplète ou malformée = refus) ; POST /api/v1/workflows ; GET du créé ;
//   - vérification : réponse du POST inactive ; GET du créé : même id, inactif, secret relu == secret envoyé
//     (comparé en mémoire, jamais affiché), puis comparer-live (exception limitée aux 2 chemins du secret) ;
//   - erreurs : liste fermée ; après une création, l'étape et les identifiants créés (grammaire stricte) sont
//     restitués pour la reprise. Aucune suppression automatique.
// LIMITE : le précontrôle de doublon n'est pas atomique (deux imports concurrents) ; il repose sur la discipline
// « un seul écrivain » (le Mac d'Éric).
//
// Usage (Mac d'Éric) :
//   FONDA_N8N_CLE_IMPORT_RECETTE=… node outils-import/importer-recette.js --confirmer-ecriture page-et-confirmer
//   FONDA_N8N_CLE_IMPORT_RECETTE=… node outils-import/importer-recette.js --confirmer-ecriture n8n/fonda-relecture-page/box-fonda-emettre-relecture.recette.json
//   FONDA_N8N_CLE_IMPORT_PRODUCTION=… node outils-import/importer-recette.js --confirmer-ecriture n8n/fonda-relecture-page/box-fonda-emettre-relecture.json
//   FONDA_N8N_CLE_IMPORT_PRODUCTION=… node outils-import/importer-recette.js --confirmer-ecriture page-et-confirmer-production

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { INSTANCES, ID_WORKFLOW, CLE_API, CURSEUR } = require('../outils-recette/lecture-seule.js');
const { REFERENCES, comparer } = require('../outils-recette/comparer-live.js');

const RACINE = path.join(__dirname, '..');
const SECRET_A_INJECTER = 'A_INJECTER_A_L_IMPORT';
const FRAGMENT = `"secret": "${SECRET_A_INJECTER}"`;
const SERVICE_TROUSSEAU = 'fonda-recette-page-hmac';
const SERVICE_TROUSSEAU_PRODUCTION = 'fonda-prod-page-hmac';
const CONJOINT = 'page-et-confirmer';
const CONJOINT_PRODUCTION = 'page-et-confirmer-production';
const MAX_PAGES = 20;
// Nœud porteur du secret, par export (null : aucun secret).
const NOEUD_SECRET = Object.freeze({ [REFERENCES[0]]: null, [REFERENCES[1]]: null, [REFERENCES[2]]: 'Recalculer jeton', [REFERENCES[3]]: 'Signer jeton',
  [REFERENCES[4]]: null, [REFERENCES[5]]: null, [REFERENCES[6]]: 'Recalculer jeton', [REFERENCES[7]]: 'Signer jeton' });
const NOMS = Object.freeze(['FONDA RECETTE - Emettre relecture', 'FONDA RECETTE - Cloturer relecture', 'FONDA RECETTE - Confirmer relecture', 'FONDA RECETTE - Page relecture']);
const NOMS_PRODUCTION = Object.freeze(['FONDA - Emettre relecture', 'FONDA - Cloturer relecture', 'FONDA - Confirmer relecture', 'FONDA - Page relecture']);
// Projet n8n ATTENDU par environnement (Gate 0 AUTOMATIQUE, décision de l'architecte 2026-11-15) : relu après CHAQUE
// création ; seul `projectId` du propriétaire est lu, jamais affiché ni le tableau `shared` (adresse du propriétaire).
// Même instance, même propriétaire : valeur identique pour les deux environnements (hors CONFIG des workflows).
const PROJET_ATTENDU = Object.freeze({ recette: 'oz9pBdYxCmm8UQ4l', production: 'oz9pBdYxCmm8UQ4l' });
// Nom EXACT attendu PAR RÉFÉRENCE (pas seulement par environnement).
const NOM_ATTENDU = Object.freeze({ [REFERENCES[0]]: NOMS[0], [REFERENCES[1]]: NOMS[1], [REFERENCES[2]]: NOMS[2], [REFERENCES[3]]: NOMS[3],
  [REFERENCES[4]]: NOMS_PRODUCTION[0], [REFERENCES[5]]: NOMS_PRODUCTION[1], [REFERENCES[6]]: NOMS_PRODUCTION[2], [REFERENCES[7]]: NOMS_PRODUCTION[3] });
// Environnements ÉTANCHES (liste fermée) : préfixe de service, service HMAC, variable de la clé d'import, noms, schéma.
const ENVIRONNEMENTS = Object.freeze({
  recette: Object.freeze({ prefixe: 'fonda-recette-', service: SERVICE_TROUSSEAU, varCle: 'FONDA_N8N_CLE_IMPORT_RECETTE', noms: NOMS, schema: 'import-recette/v1' }),
  production: Object.freeze({ prefixe: 'fonda-prod-', service: SERVICE_TROUSSEAU_PRODUCTION, varCle: 'FONDA_N8N_CLE_IMPORT_PRODUCTION', noms: NOMS_PRODUCTION, schema: 'import-production/v1' }),
});
const CIBLES = Object.freeze({
  [REFERENCES[0]]: { environnement: 'recette', references: [REFERENCES[0]] }, [REFERENCES[1]]: { environnement: 'recette', references: [REFERENCES[1]] },
  [CONJOINT]: { environnement: 'recette', references: [REFERENCES[2], REFERENCES[3]] },
  [REFERENCES[4]]: { environnement: 'production', references: [REFERENCES[4]] }, [REFERENCES[5]]: { environnement: 'production', references: [REFERENCES[5]] },
  [CONJOINT_PRODUCTION]: { environnement: 'production', references: [REFERENCES[6], REFERENCES[7]] },
});
const ETAPES = Object.freeze(['precontrole', 'creation', 'verification']);

const MESSAGES = Object.freeze({
  CONFIRMATION: 'écriture non confirmée : --confirmer-ecriture exigé',
  ARGUMENTS: 'arguments : --confirmer-ecriture <cible> attendus, rien d\'autre',
  CIBLE_HORS_LISTE: 'cible hors liste fermée (export Emettre, export Cloturer, page-et-confirmer ou page-et-confirmer-production)',
  EXPORT_ILLISIBLE: 'export illisible ou hors schéma',
  FRAGMENT: 'fragment de substitution du secret : nombre d\'occurrences inattendu',
  CLE: 'clé d\'API absente ou hors grammaire (variable FONDA_N8N_CLE_IMPORT_RECETTE ou FONDA_N8N_CLE_IMPORT_PRODUCTION, selon la cible)',
  TROUSSEAU: 'secret introuvable dans le trousseau (service HMAC de l\'environnement de la cible)',
  SECRET_FORME: 'secret hors forme (64 hexadécimaux minuscules attendus, jamais la valeur de remplacement)',
  NOM_EXISTANT: 'un workflow de ce nom existe déjà sur l\'instance : import refusé (aucun doublon)',
  RECHERCHE_INCOMPLETE: 'précontrôle de doublon incomplet ou malformé : import refusé',
  TRANSPORT: 'échec du transport',
  HTTP: 'API n8n : statut inattendu',
  REPONSE: 'réponse de l\'API hors schéma attendu',
  CREATION_NON_CONFIRMEE: 'création NON CONFIRMÉE (réponse du POST absente ou hors schéma) : vérifier l\'instance avant toute relance',
  VERIFICATION_ECHOUEE: 'workflow CRÉÉ mais vérification impossible (relecture en échec ou identité différente)',
  ACTIF: 'workflow créé ACTIF : à désactiver immédiatement (anomalie)',
  SERVICE_CROISE: 'service de trousseau d\'un autre environnement ou hors liste : refus (environnements étanches)',
  CLE_ENVIRONNEMENT: 'clé d\'import de l\'AUTRE environnement aussi présente : refus (une seule variable de clé à la fois)',
  PROJET: 'workflow créé HORS du projet attendu (Gate 0) : arrêt, aucune autre création ; vérifier l\'instance avant toute relance',
  ECART: 'import conjoint arrêté au premier écart (aucune autre création) : workflow créé NON identique au dépôt',
});
class ErreurImport extends Error {
  constructor(code, { etape = null, crees = [], ecarts = [] } = {}) {
    if (!Object.prototype.hasOwnProperty.call(MESSAGES, code)) throw new TypeError('code d\'erreur hors liste fermée');
    super(MESSAGES[code]);
    this.code = code;
    this.etape = ETAPES.includes(etape) ? etape : null;
    this.crees = Array.isArray(crees) ? crees.filter((x) => typeof x === 'string' && ID_WORKFLOW.test(x)) : [];
    // Écarts de comparer-live : chemins de CLÉS DU DÉPÔT et textes fixes seulement (jamais une valeur du live).
    this.ecarts = Array.isArray(ecarts) ? ecarts.filter((x) => typeof x === 'string' && x.length <= 300).slice(0, 50) : [];
  }
}
// Texte affichable : reconstruit (code, étape de la liste fermée, identifiants en grammaire stricte), sinon marqueur.
function messageSur(e) {
  if (!(e instanceof ErreurImport)) return 'erreur (message non affichable)';
  const suite = [e.etape ? `étape : ${e.etape}` : null, e.crees.length ? `workflows créés : ${e.crees.join(', ')}` : null, e.ecarts.length ? `écarts : ${e.ecarts.join(' | ')}` : null].filter(Boolean);
  return suite.length ? `${MESSAGES[e.code]} (${suite.join(' ; ')})` : MESSAGES[e.code];
}

// Étanchéité : un environnement ne lit QUE son propre service (préfixe de l'environnement, jamais celui d'un autre,
// et seulement le service HMAC de la liste fermée).
function verifierService(environnement, service) {
  const e = Object.prototype.hasOwnProperty.call(ENVIRONNEMENTS, environnement) ? ENVIRONNEMENTS[environnement] : null;
  const autres = Object.entries(ENVIRONNEMENTS).filter(([k]) => k !== environnement).map(([, x]) => x.prefixe);
  if (!e || typeof service !== 'string' || service !== e.service || !service.startsWith(e.prefixe) || autres.some((p) => service.startsWith(p))) throw new ErreurImport('SERVICE_CROISE');
}
// Secret : trousseau macOS, SANS shell (argv fixe) ; sortie : la valeur et un saut de ligne final retiré.
function lireTrousseau(exec = execFileSync, environnement = 'recette') {
  if (typeof environnement !== 'string' || !Object.prototype.hasOwnProperty.call(ENVIRONNEMENTS, environnement)) throw new ErreurImport('TROUSSEAU');
  const service = ENVIRONNEMENTS[environnement].service;
  verifierService(environnement, service);
  let v;
  try { v = exec('/usr/bin/security', ['find-generic-password', '-s', service, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { throw new ErreurImport('TROUSSEAU'); }
  if (typeof v !== 'string') throw new ErreurImport('TROUSSEAU');
  return v.replace(/\n$/, '');
}

// Texte à POSTER : substitution EXACTE du fragment ; vérifications de schéma sur le résultat.
function preparer(reference, secret) {
  if (typeof reference !== 'string' || !Object.prototype.hasOwnProperty.call(NOEUD_SECRET, reference)) throw new ErreurImport('CIBLE_HORS_LISTE');
  const porteur = NOEUD_SECRET[reference];
  let texte;
  try { texte = fs.readFileSync(path.join(RACINE, reference), 'utf8'); } catch { throw new ErreurImport('EXPORT_ILLISIBLE'); }
  if (texte.split(FRAGMENT).length - 1 !== (porteur ? 1 : 0)) throw new ErreurImport('FRAGMENT');
  if (porteur) {
    if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret)) throw new ErreurImport('SECRET_FORME');
    texte = texte.replace(FRAGMENT, `"secret": "${secret}"`);
  }
  let w;
  try { w = JSON.parse(texte); } catch { throw new ErreurImport('EXPORT_ILLISIBLE'); }
  if (!w || typeof w !== 'object' || Array.isArray(w) || Object.keys(w).join(',') !== 'name,nodes,connections,settings' || w.name !== NOM_ATTENDU[reference] || !Array.isArray(w.nodes)) throw new ErreurImport('EXPORT_ILLISIBLE');
  const hmac = w.nodes.filter((x) => x && x.type === 'n8n-nodes-base.crypto' && x.parameters && x.parameters.action === 'hmac');
  if (hmac.length !== (porteur ? 1 : 0) || (porteur && (hmac[0].name !== porteur || hmac[0].parameters.secret !== secret))) throw new ErreurImport('FRAGMENT');
  return { texte, nom: w.name };
}

function client({ cle, fetch: f }) {
  const base = INSTANCES[0];
  const h = { 'X-N8N-API-KEY': cle, accept: 'application/json' };
  return async (chemin, { methode = 'GET', corps } = {}) => {
    let r;
    try { r = await f(`${base}${chemin}`, { method: methode, headers: corps === undefined ? h : { ...h, 'content-type': 'application/json' }, ...(corps === undefined ? {} : { body: corps }), redirect: 'error' }); } catch { throw new ErreurImport('TRANSPORT'); }
    if (!r || !Number.isInteger(r.status) || r.status < 200 || r.status >= 300) throw new ErreurImport('HTTP');
    let j;
    try { j = await r.json(); } catch { throw new ErreurImport('REPONSE'); }
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new ErreurImport('REPONSE');
    return j;
  };
}

// Précontrôle : TOUTES les pages de la recherche par nom (sous-chaîne côté n8n) ; homonyme exact = refus ;
// élément ou curseur malformé, ou plafond atteint = recherche incomplète = refus (fail-closed).
async function nomAbsent(appel, nom) {
  let curseur = null;
  for (let p = 0; p < MAX_PAGES; p += 1) {
    let page;
    try { page = await appel(`/api/v1/workflows?name=${encodeURIComponent(nom)}&limit=100${curseur ? `&cursor=${encodeURIComponent(curseur)}` : ''}`); } catch { throw new ErreurImport('RECHERCHE_INCOMPLETE', { etape: 'precontrole' }); }
    if (!Array.isArray(page.data) || !page.data.every((x) => x && typeof x === 'object' && !Array.isArray(x) && typeof x.name === 'string' && typeof x.id === 'string' && ID_WORKFLOW.test(x.id))) throw new ErreurImport('RECHERCHE_INCOMPLETE', { etape: 'precontrole' });
    if (page.data.some((x) => x.name === nom)) throw new ErreurImport('NOM_EXISTANT', { etape: 'precontrole' });
    const c = page.nextCursor;
    if (c === undefined || c === null) return;
    if (typeof c !== 'string' || !CURSEUR.test(c) || c === curseur) throw new ErreurImport('RECHERCHE_INCOMPLETE', { etape: 'precontrole' });
    curseur = c;
  }
  throw new ErreurImport('RECHERCHE_INCOMPLETE', { etape: 'precontrole' });
}

async function importer({ cible, cle, secret, fetch: f = globalThis.fetch }) {
  if (typeof cle !== 'string' || !CLE_API.test(cle)) throw new ErreurImport('CLE');
  if (typeof cible !== 'string' || !Object.prototype.hasOwnProperty.call(CIBLES, cible)) throw new ErreurImport('CIBLE_HORS_LISTE');
  const lots = CIBLES[cible].references.map((reference) => ({ reference, ...preparer(reference, secret) })); // tout est vérifié AVANT le réseau
  const appel = client({ cle, fetch: f });
  for (const l of lots) await nomAbsent(appel, l.nom);
  const crees = []; const imports = [];
  for (const l of lots) {
    let cree;
    try { cree = await appel('/api/v1/workflows', { methode: 'POST', corps: l.texte }); } catch { throw new ErreurImport('CREATION_NON_CONFIRMEE', { etape: 'creation', crees }); }
    if (typeof cree.id !== 'string' || !ID_WORKFLOW.test(cree.id)) throw new ErreurImport('CREATION_NON_CONFIRMEE', { etape: 'creation', crees });
    crees.push(cree.id);
    if (cree.active !== false) throw new ErreurImport('ACTIF', { etape: 'creation', crees });
    // TOUTE la vérification après création (relecture, identité, état, comparaison) : toute exception devient un
    // diagnostic fermé qui restitue l'étape et les ids créés (jamais un message générique sans reprise possible).
    let resultat;
    try {
      const live = await appel(`/api/v1/workflows/${cree.id}`);
      if (live.id !== cree.id) throw new ErreurImport('VERIFICATION_ECHOUEE');
      if (live.active !== false) throw new ErreurImport('ACTIF');
      // Gate 0 : UN SEUL propriétaire, dans le projet attendu de l'environnement (seul projectId est lu).
      const proprietaires = Array.isArray(live.shared) ? live.shared.filter((x) => x && typeof x === 'object' && x.role === 'workflow:owner') : [];
      if (proprietaires.length !== 1 || typeof proprietaires[0].projectId !== 'string' || !ID_WORKFLOW.test(proprietaires[0].projectId)
        || proprietaires[0].projectId !== PROJET_ATTENDU[CIBLES[cible].environnement]) throw new ErreurImport('PROJET');
      const c = comparer(live, l.reference);
      const ecarts = [...c.ecarts];
      const porteur = NOEUD_SECRET[l.reference];
      if (porteur) {
        const n = Array.isArray(live.nodes) ? live.nodes.filter((x) => x && x.name === porteur) : [];
        if (n.length !== 1 || !n[0].parameters || n[0].parameters.secret !== secret) ecarts.push('secret relu ≠ secret envoyé'); // comparé en mémoire, jamais affiché
      }
      resultat = { export: l.reference, workflowId: cree.id, identique: ecarts.length === 0, ecarts };
    } catch (e) {
      throw new ErreurImport(e instanceof ErreurImport && ['ACTIF', 'PROJET'].includes(e.code) ? e.code : 'VERIFICATION_ECHOUEE', { etape: 'verification', crees });
    }
    // Import conjoint : arrêt au PREMIER écart (aucune autre création), écarts conservés dans le diagnostic.
    if (lots.length > 1 && !resultat.identique) throw new ErreurImport('ECART', { etape: 'verification', crees, ecarts: resultat.ecarts });
    imports.push(resultat);
  }
  return { schema: ENVIRONNEMENTS[CIBLES[cible].environnement].schema, cible, imports };
}

// Lecture du trousseau PAR ENVIRONNEMENT, exécutable fixe (jamais l'environnement passé à la place de l'exécutable).
const trousseauDe = (environnement) => lireTrousseau(execFileSync, environnement);
async function principal(argv, { env = process.env, fetch: f = globalThis.fetch, trousseau = trousseauDe } = {}) {
  if (!Array.isArray(argv) || !argv.includes('--confirmer-ecriture')) throw new ErreurImport('CONFIRMATION');
  if (argv.length !== 2 || argv.filter((a) => a === '--confirmer-ecriture').length !== 1) throw new ErreurImport('ARGUMENTS');
  const cible = argv.find((a) => a !== '--confirmer-ecriture');
  if (!Object.prototype.hasOwnProperty.call(CIBLES, cible)) throw new ErreurImport('CIBLE_HORS_LISTE');
  const environnement = CIBLES[cible].environnement; const E = ENVIRONNEMENTS[environnement];
  // Étanchéité D'ABORD : la variable de clé de l'AUTRE environnement ne doit pas être présente, même vide.
  if (Object.entries(ENVIRONNEMENTS).some(([k, x]) => k !== environnement && env[x.varCle] !== undefined)) throw new ErreurImport('CLE_ENVIRONNEMENT');
  const cle = env[E.varCle];
  if (typeof cle !== 'string' || !CLE_API.test(cle)) throw new ErreurImport('CLE');
  const secret = cible === CONJOINT || cible === CONJOINT_PRODUCTION ? trousseau(environnement) : null; // lu UNE fois, pour Page ET Confirmer
  const r = await importer({ cible, cle, secret, fetch: f });
  return { r, code: r.imports.every((x) => x.identique) ? 0 : 1 };
}

module.exports = { SECRET_A_INJECTER, FRAGMENT, SERVICE_TROUSSEAU, SERVICE_TROUSSEAU_PRODUCTION, CONJOINT, CONJOINT_PRODUCTION, NOMS, NOMS_PRODUCTION, PROJET_ATTENDU, MESSAGES, ErreurImport, messageSur, verifierService, lireTrousseau, preparer, importer, principal };

if (require.main === module) {
  principal(process.argv.slice(2)).then(({ r, code }) => { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); process.exitCode = code; })
    .catch((e) => { process.stderr.write(`importer-recette : ${messageSur(e)}\n`); process.exitCode = 1; });
}
