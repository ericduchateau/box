#!/usr/bin/env node
// Construction des workflows n8n du parcours PAGE, P3 (CDC relecture §21.0, §21.1, §21.5, §21.9) :
//   « FONDA - Emettre relecture »  : candidat-fonda/v1 (clé k, seul cle_sha256 stocké) + lien au relecteur ;
//                                    émission initiale OU réémission (statut en_attente ET decisions/
//                                    du lot PROUVÉ vide), §21.5 ;
//   « FONDA - Cloturer relecture » : clôture technique (statut clos, PREMIER clos_le), sortie OBSERVÉE
//                                    cloture-fonda/v1 consommée par rattachement-page.js (GELÉ, P1) ;
//   « FONDA - Confirmer relecture » (P2) : POST du relecteur, C1–C7, decisions/<set_id>-<nonce>.json,
//                                    sortie OBSERVÉE confirmation-fonda/v1 (ROLES.confirmation, GELÉ).
// Le CONSOMMATEUR est gelé : les noms de nœuds et la forme de sortie sont ceux que rattachement-page.js
// exige (ROLES.cloture) ; ce constructeur s'y CONFORME, il ne redéfinit rien.
//
// Les workflows sont livrés en JSON dans le dépôt, INACTIFS, jamais édités dans l'interface, jamais
// « Execute »/« Retry » ; rien n'est créé sur l'instance avant P4 (recette sur copie, go d'Éric). En
// P2/P3, l'octet-identité est INTERNE : export commité == construction depuis le dépôt (harnais).
//
// Identifiants de l'instance (dossiers Drive, NOMS/ids de credentials, chemins webhook, table de
// relecteurs) : valeurs de REMPLACEMENT nommées « A_RENSEIGNER_P4_… », renseignées en P4. Les SECRETS
// (jetons, valeurs de credentials, clé HMAC) et les ADRESSES ne sont jamais dans le dépôt : credentials
// n8n référencés par id, adresse lue à l'exécution dans une Data Table (clé = relecteur_attribue).
//
// Usage : node n8n/fonda-relecture-page/construire-relecture.js --emettre | --cloturer | --confirmer > export.json

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const C = require('../../fonda/engine/catalogue.js');
const R = require('../../fonda/scripts/rattachement-page.js');
const L = require('../../fonda/scripts/liaison-generation.js');
const SC = require('../../fonda/scripts/signer-cloture.js');
const { OUTILS } = require('../fonda-generation-ia/construire-workflow.js');

const RACINE = path.join(__dirname, '..', '..');

// --- Configuration (valeurs de remplacement, renseignées en P4) ------------------------------
const P4 = (nom) => `A_RENSEIGNER_P4_${nom}`;
const CONFIG = Object.freeze({
  nomEmettre: 'FONDA - Emettre relecture',
  nomCloturer: 'FONDA - Cloturer relecture',
  nomConfirmer: 'FONDA - Confirmer relecture',
  cheminEmettre: P4('CHEMIN_EMETTRE'),
  cheminCloturer: P4('CHEMIN_CLOTURER'),
  cheminConfirmer: 'fonda-select-confirm', // §21.0 : POST public (relecteur), protégé par k + jeton, jamais une route BOX
  depot: 'ericduchateau/box',
  dossierCandidats: '1Ir-iJGZoSk5_FmJ9dnf_PM-NEBZWyn8d', // lot source immuable (génération, §20.4)
  dossierRelecture: P4('DOSSIER_RELECTURE'), // relecture/<set_id>.candidat.json (enveloppe mutable)
  dossierDecisions: P4('DOSSIER_DECISIONS'), // decisions/ (écrit par Confirmer, P2)
  urlN8n: 'https://n8n.srv868991.hstgr.cloud',
  tableRelecteurs: P4('ID_DATA_TABLE_RELECTEURS'), // Data Table : relecteur_attribue -> adresse (jamais dans le dépôt)
  urlPage: P4('URL_PAGE_RELECTURE'), // …/webhook/<chemin> de « FONDA - Page relecture » (P2)
  dureeCleJours: 14,
  maxPagesDrive: 50, // plafond de pagination : atteint = ERREUR d'exécution (jamais « complet ») ; pageSize est un MAXIMUM, Drive peut rendre moins
  // Credentials : RÉFÉRENCES (id, nom) seulement ; aucune valeur dans le dépôt.
  credentialDrive: { id: 'cukxQDNwWIqOAK02', name: 'Google Drive la bonne!' },
  credentialEmettre: { id: P4('CREDENTIAL_EMETTRE'), name: 'FONDA Emettre Token' },
  credentialCloturer: { id: P4('CREDENTIAL_CLOTURER'), name: 'FONDA Cloturer Token' },
  credentialApiN8n: { id: P4('CREDENTIAL_API_N8N'), name: 'FONDA API n8n (lecture Data Table)' },
  credentialGmail: { id: P4('CREDENTIAL_GMAIL'), name: 'FONDA Gmail relecture' },
});

// Noms de nœuds : ceux du consommateur gelé pour la clôture (ROLES.cloture).
const NOEUDS_CLOTURER = Object.freeze({
  webhook: 'Webhook cloture',
  entree: R.ROLES.cloture.entree, // FONDA Entree cloture
  valider: 'Valider cloture',
  chercher: 'Chercher candidat',
  verifierListe: 'Verifier recherche candidat',
  lire: 'Lire candidat',
  preparer: 'Preparer cloture',
  siDejaClos: 'Deja clos ?',
  relireVersion: 'Relire version cloture',
  verifierVersion: 'Verifier version cloture',
  ecrire: R.ROLES.cloture.ecriture, // FONDA Ecrire candidat clos
  relire: 'Relire candidat',
  decisions: 'Lister decisions',
  sortie: R.ROLES.cloture.sortie, // FONDA Sortie cloture
});
const NOEUDS_EMETTRE = Object.freeze({
  webhook: 'Webhook emission',
  entree: 'FONDA Entree emission',
  referentiel: 'Lire referentiel',
  moteurs: 'Lire moteurs',
  journal: 'Lire journal',
  chercherLot: 'Chercher lot source',
  verifierLot: 'Verifier recherche lot',
  lireLot: 'Lire lot source',
  existant: 'Chercher candidat existant',
  decisions: 'Lister decisions',
  analyser: 'Analyser emission',
  siReemission: 'Reemission ?',
  lireExistant: 'Lire candidat existant',
  cle: 'Generer cle',
  preparer: 'Preparer candidat',
  siReecrire: 'Reecrire ?',
  relireVersion: 'Relire version candidat',
  verifierVersion: 'Verifier version candidat',
  ecrire: 'FONDA Ecrire candidat',
  reecrire: 'FONDA Reecrire candidat',
  relister: 'Relister decisions',
  verifier: 'Verifier ecriture',
  adresse: 'Lire adresse relecteur',
  courriel: 'Preparer courriel',
  envoyer: 'Envoyer lien',
  sortie: 'FONDA Sortie emission',
});

// Modules du moteur embarqués (copie EXACTE, vérifiée par le harnais).
const MODULES = Object.freeze({ catalogue: 'fonda/engine/catalogue.js', journal: 'fonda/engine/journal-set-ids.js', canonique: 'fonda/engine/canonique.js' });

const uuid = (graine) => {
  const h = crypto.createHash('sha256').update(`fonda-relecture-page:${graine}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const ENTETE = (role) => [
  `// FONDA — ${role}`,
  '// GÉNÉRÉ par n8n/fonda-relecture-page/construire-relecture.js : ne pas éditer dans',
  '// l\'interface (le harnais compare ce code, octet pour octet, à celui du dépôt).',
].join('\n');
const UN_ITEM = (noeud) => `function unItem(nom) {
  const items = nom === null ? $input.all() : $(nom).all();
  if (!Array.isArray(items) || items.length !== 1 || !items[0] || typeof items[0].json !== 'object' || items[0].json === null) {
    throw new Error('${noeud} : exactement un item attendu de ' + (nom === null ? 'l\\'entrée' : nom));
  }
  return items[0].json;
}`;
const SET_ID = `const SET_ID_PATTERN = new RegExp(${JSON.stringify(C.SET_ID_PATTERN.source)}, ${JSON.stringify(C.SET_ID_PATTERN.flags)});`;
// Date ISO CANONIQUE (forme écrite par ce producteur : toISOString), contrôlée avant toute sortie réussie.
const DATE_ISO = `function dateIso(v) {
  return typeof v === 'string' && /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(Date.parse(v)).toISOString() === v;
}`;
// Version Drive (chaîne int64 monotone) : comparée en BigInt, jamais en Number. « après == avant + 1 » est
// une détection AU MIEUX (sémantique d'incrément à vérifier en P4). Les contrôles de version DÉTECTENT les
// modifications visibles au moment du contrôle ; ils n'excluent PAS les écritures concurrentes : seul le
// verrou mono-écrivain du CLI (P5) le fait (README « Où vit chaque garantie », E1).
const VERSION = `function versionSuivante(v) {
  if (typeof v !== 'string' || !/^[0-9]+$/.test(v)) throw new Error('version Drive illisible');
  return String(BigInt(v) + 1n);
}`;
// Agrégation d'un listing PAGINÉ (un item par page, n8n) : distingue la recherche déclarée incomplète
// par Drive (incompleteSearch, sur N'IMPORTE QUELLE page) du PLAFOND de pagination atteint (dernière
// page lue portant encore un jeton). Les deux interdisent de conclure « complet ».
const AGREGER = `function agregerPages(nom) {
  const pages = $(nom).all().map((i) => i.json);
  if (!pages.length) throw new Error(nom + ' : aucune page');
  const fichiers = []; let incompleteSearch = false;
  for (const pg of pages) {
    if (!pg || !Array.isArray(pg.files)) throw new Error(nom + ' : page de listing inexploitable');
    if (pg.incompleteSearch === true) incompleteSearch = true;
    fichiers.push(...pg.files);
  }
  const plafond = Boolean(pages[pages.length - 1].nextPageToken);
  return { fichiers, incompleteSearch, plafond, complet: !incompleteSearch && !plafond };
}`;

// Copie EXACTE d'un module UMD (même schéma que fonda-generation-ia : `self` neutre, require restreint).
const lireSource = (rel) => fs.readFileSync(path.join(RACINE, rel), 'utf8');
const sha256Fichier = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(RACINE, rel))).digest('hex');
function blocModule(cle) {
  const rel = MODULES[cle];
  const src = lireSource(rel);
  if (!src.endsWith('\n')) throw new Error(`${rel} : fin de ligne finale attendue`);
  return [
    `// >>> MODULE ${rel} (copie exacte, sha256=${sha256Fichier(rel)})`,
    `const M_${cle} = { exports: {} };`,
    `(function (module, exports, require, self) {\n${src}})(M_${cle}, M_${cle}.exports, requis, {});`,
    `// <<< MODULE ${rel}`,
  ].join('\n');
}
// Copie EXACTE d'une fonction du dépôt (fn.toString(), vérifiée par le harnais).
function blocFonction(fichier, nom, fn) {
  if (typeof fn !== 'function') throw new Error(`${fichier} : ${nom} non exportée`);
  return `// >>> FONCTION ${fichier} ${nom} (copie exacte)\n${fn.toString()}\n// <<< FONCTION ${nom}`;
}
const REQUIS = [
  '// require des modules embarqués uniquement (aucun module Node).',
  'function requis(nom) {',
  '  if (nom === \'./catalogue.js\' && typeof M_catalogue !== \'undefined\') return M_catalogue.exports;',
  '  throw new Error(\'module non embarqué : \' + nom);',
  '}',
].join('\n');

// --- Nœuds HTTP communs ----------------------------------------------------------------------
const PAGINATION_DRIVE = { pagination: {
  paginationMode: 'updateAParameterInEachRequest',
  parameters: { parameters: [{ type: 'qs', name: 'pageToken', value: '={{ $response.body.nextPageToken }}' }] },
  paginationCompleteWhen: 'other',
  completeExpression: '={{ !$response.body.nextPageToken }}',
  limitPagesFetched: true,
  maxRequests: CONFIG.maxPagesDrive,
} };
const drive = (nom, parametres) => ({
  name: nom, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, retryOnFail: false,
  credentials: { googleDriveOAuth2Api: CONFIG.credentialDrive },
  parameters: { authentication: 'predefinedCredentialType', nodeCredentialType: 'googleDriveOAuth2Api', ...parametres },
});
const listing = (nom, q, champs, pagine) => drive(nom, {
  url: 'https://www.googleapis.com/drive/v3/files',
  sendQuery: true,
  queryParameters: { parameters: [{ name: 'q', value: q }, { name: 'fields', value: champs }, { name: 'pageSize', value: pagine ? '1000' : '100' }] },
  options: pagine ? { pagination: PAGINATION_DRIVE, timeout: 30000 } : { timeout: 30000 },
});
const contenuDrive = (nom, expressionId) => drive(nom, {
  url: `={{ 'https://www.googleapis.com/drive/v3/files/' + ${expressionId} }}`,
  sendQuery: true, queryParameters: { parameters: [{ name: 'alt', value: 'media' }] },
  options: { timeout: 30000 },
});
const reecritureDrive = (nom, expressionId, expressionContenu) => drive(nom, {
  method: 'PATCH', url: `={{ 'https://www.googleapis.com/upload/drive/v3/files/' + ${expressionId} }}`,
  sendQuery: true, queryParameters: { parameters: [{ name: 'uploadType', value: 'media' }, { name: 'fields', value: 'id,name,version' }] },
  sendBody: true, contentType: 'raw', rawContentType: 'application/json; charset=UTF-8', body: `={{ ${expressionContenu} }}`,
  options: { timeout: 30000 },
});
const metaVersion = (nom, expressionId) => drive(nom, {
  url: `={{ 'https://www.googleapis.com/drive/v3/files/' + ${expressionId} }}`,
  sendQuery: true, queryParameters: { parameters: [{ name: 'fields', value: 'id,version,trashed' }] }, options: { timeout: 30000 },
});
// TOUT le lot dans decisions/ : nom <set_id>-… OU propriété fonda_set_id, corbeille COMPRISE (§9, §21.1).
const qDecisions = (setIdExpr) => `={{ "'${CONFIG.dossierDecisions}' in parents and (name contains '" + ${setIdExpr} + "-' or properties has { key='fonda_set_id' and value='" + ${setIdExpr} + "' })" }}`;
const CHAMPS_LISTE = 'nextPageToken,incompleteSearch,files(id,name)';
const webhook = (nom, chemin, credential, graine) => ({
  name: nom, type: 'n8n-nodes-base.webhook', typeVersion: 2, webhookId: uuid(graine),
  credentials: { httpHeaderAuth: credential },
  parameters: { httpMethod: 'POST', path: chemin, authentication: 'headerAuth', options: {} },
});
const code = (nom, jsCode) => ({ name: nom, type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode } });
// IF v2 STRICT sur un booléen du flux : un type inattendu LÈVE (jamais « faux » par défaut).
const siBooleen = (nom, champ, graine) => ({
  name: nom, type: 'n8n-nodes-base.if', typeVersion: 2.2,
  parameters: { conditions: { options: { caseSensitive: true, typeValidation: 'strict', version: 2 }, combinator: 'and',
    conditions: [{ id: uuid(graine), leftValue: `={{ $json.${champ} }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }] }, options: {} },
});
const lien = (vers) => [{ node: vers, type: 'main', index: 0 }];
const lineaire = (noms) => {
  const c = {};
  for (let i = 0; i < noms.length - 1; i += 1) c[noms[i]] = { main: [lien(noms[i + 1])] };
  return c;
};
const positionner = (prefixe) => (n, i) => ({ id: uuid(`${prefixe}:${n.name}`), position: [i * 220, 0], ...n });
const REGLAGES = { executionOrder: 'v1', saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all', saveManualExecutions: true, saveExecutionProgress: true, timezone: 'Europe/Paris' };

// Recherche d'UN fichier par nom exact : vérifiée AVANT toute lecture de contenu (message explicite).
// avecVersion : la version Drive est relevée ICI, AVANT la lecture du contenu (une écriture intercalée
// ne peut que la faire paraître périmée : détection prudente).
function codeVerifierRecherche(noeud, recherche, quoi, avecVersion = false) {
  return [ENTETE(`recherche ${quoi} : exactement un fichier, recherche complète, avant lecture.`), UN_ITEM(noeud),
    `const liste = unItem(${JSON.stringify(recherche)});
if (!Array.isArray(liste.files) || liste.nextPageToken || liste.incompleteSearch) throw new Error('recherche ${quoi} inexploitable ou incomplète');
if (liste.files.length !== 1 || typeof liste.files[0].id !== 'string') throw new Error(liste.files.length + ' fichier(s) pour ${quoi} : exactement un attendu');
${avecVersion ? `if (typeof liste.files[0].version !== 'string' || !/^[0-9]+$/.test(liste.files[0].version)) throw new Error('${quoi} : version Drive illisible');
return [{ json: { fichier_id: liste.files[0].id, version: liste.files[0].version } }];` : 'return [{ json: { fichier_id: liste.files[0].id } }];'}`].join('\n\n');
}

// ═══ CLÔTURER (sortie observée cloture-fonda/v1) ═══
function codeEntreeCloture() {
  // Ne fait que COPIER le champ nommé (chaîne ≤ 128, sinon null) : ne lève JAMAIS (§21.1).
  return [
    ENTETE('entrée de clôture : { set_id } copié tel quel (chaîne ≤ 128, sinon null), sans validation.'),
    `const items = $input.all();
const corps = items.length === 1 && items[0] && items[0].json ? items[0].json.body : undefined;
const v = corps && typeof corps === 'object' && !Array.isArray(corps) ? corps.set_id : undefined;
return [{ json: { set_id: typeof v === 'string' && v.length <= 128 ? v : null } }];`,
  ].join('\n\n');
}
function codeValiderCloture() {
  return [ENTETE('validation de l\'entrée de clôture (une erreur rend l\'exécution « error », attribuée au lot si lisible).'),
    SET_ID, UN_ITEM(NOEUDS_CLOTURER.valider),
    `const e = unItem(${JSON.stringify(NOEUDS_CLOTURER.entree)});
if (typeof e.set_id !== 'string' || !SET_ID_PATTERN.test(e.set_id)) throw new Error('set_id invalide');
return [{ json: { set_id: e.set_id } }];`].join('\n\n');
}
function codePreparerCloture() {
  return [ENTETE('candidat lu : en_attente -> clos (PREMIER clos_le) ; clos -> déjà clos (rien réécrit) ; sinon refus.'),
    UN_ITEM(NOEUDS_CLOTURER.preparer), DATE_ISO,
    `const setId = unItem(${JSON.stringify(NOEUDS_CLOTURER.valider)}).set_id;
const fichier = unItem(${JSON.stringify(NOEUDS_CLOTURER.verifierListe)});
const c = unItem(${JSON.stringify(NOEUDS_CLOTURER.lire)});
if (!c || c.schema !== 'candidat-fonda/v1' || !c.lot || !c.relecture || c.lot.set_id !== setId) throw new Error('candidat non conforme');
const rel = c.relecture;
if (!Number.isSafeInteger(rel.generation_cle) || rel.generation_cle < 1 || typeof rel.cle_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(rel.cle_sha256)) throw new Error('candidat : generation_cle ou cle_sha256 invalide');
let dejaClos; let closLe;
if (rel.statut === 'clos') {
  // Format VALIDÉ avant toute sortie réussie, jamais réécrit (premier clos_le).
  if (!dateIso(rel.clos_le)) throw new Error('candidat clos : clos_le absent ou mal formé (jamais réécrit)');
  dejaClos = true; closLe = rel.clos_le;
} else if (rel.statut === 'en_attente') {
  if (rel.clos_le !== null) throw new Error('candidat en_attente avec clos_le');
  dejaClos = false; closLe = new Date().toISOString();
} else throw new Error('statut « ' + rel.statut + ' » : clôture impossible');
const nouveau = dejaClos ? null : JSON.stringify({ schema: c.schema, lot: c.lot, relecture: { ...rel, statut: 'clos', clos_le: closLe } }, null, 2) + '\\n';
// version (relevée AVANT la lecture), generation_cle et cle_sha256 LUS : contrôlés avant et après l'écriture.
return [{ json: { set_id: setId, fichier_id: fichier.fichier_id, version: fichier.version, generation_cle: rel.generation_cle, cle_sha256: rel.cle_sha256, deja_clos: dejaClos, clos_le: closLe, contenu: nouveau } }];`].join('\n\n');
}
// D1 : la clôture ne réécrit QUE l'enveloppe qu'elle a lue. Juste avant l'écriture, la version Drive doit être
// celle relevée avant la lecture ; sinon (réémission intercalée, etc.) ERREUR d'exécution -> E4 -> abandon au
// signataire. Une écriture d'un état périmé effacerait une génération plus récente (clé révoquée rétablie).
function codeVerifierVersionCloture() {
  return [ENTETE('clôture : candidat INCHANGÉ depuis sa lecture (version Drive identique, hors corbeille) avant réécriture.'),
    UN_ITEM(NOEUDS_CLOTURER.verifierVersion),
    `const p = unItem(${JSON.stringify(NOEUDS_CLOTURER.preparer)});
const m = unItem(${JSON.stringify(NOEUDS_CLOTURER.relireVersion)});
if (!m || m.id !== p.fichier_id || m.trashed !== false || m.version !== p.version) throw new Error('clôture : candidat modifié depuis sa lecture (course détectée : version ' + (m && m.version) + ' ≠ ' + p.version + ') : rien réécrit');
return [{ json: { fichier_id: p.fichier_id, contenu: p.contenu } }];`].join('\n\n');
}
function codeSortieCloture() {
  return [ENTETE('sortie OBSERVÉE cloture-fonda/v1 (forme exacte du consommateur gelé, §21.1).'),
    UN_ITEM(NOEUDS_CLOTURER.sortie), DATE_ISO, AGREGER, VERSION,
    `const p = unItem(${JSON.stringify(NOEUDS_CLOTURER.preparer)});
if (!p.deja_clos) {
  // Détection AU MIEUX d'une écriture glissée entre le contrôle de version et la nôtre (version après ≠ avant + 1).
  const w = unItem(${JSON.stringify(NOEUDS_CLOTURER.ecrire)});
  if (!w || w.id !== p.fichier_id || w.version !== versionSuivante(p.version)) throw new Error('clôture : écriture concurrente détectée (version ' + (w && w.version) + ' ≠ ' + versionSuivante(p.version) + ')');
}
const relu = unItem(${JSON.stringify(NOEUDS_CLOTURER.relire)});
if (!relu || relu.schema !== 'candidat-fonda/v1' || !relu.lot || relu.lot.set_id !== p.set_id || !relu.relecture || relu.relecture.statut !== 'clos') throw new Error('candidat relu non clos');
if (!dateIso(relu.relecture.clos_le) || relu.relecture.clos_le !== p.clos_le) throw new Error('candidat relu : clos_le mal formé ou ≠ clos_le préparé');
if (relu.relecture.generation_cle !== p.generation_cle || relu.relecture.cle_sha256 !== p.cle_sha256) throw new Error('candidat relu : generation_cle ou cle_sha256 ≠ candidat lu (course détectée)');
const d = agregerPages(${JSON.stringify(NOEUDS_CLOTURER.decisions)});
// Plafond atteint = pagination NON terminée : aucune sortie (§21.1 exige une pagination complète) -> exécution en erreur.
if (d.plafond) throw new Error('decisions/ : pagination interrompue au plafond de ${CONFIG.maxPagesDrive} pages : clôture impossible');
return [{ json: { schema: 'cloture-fonda/v1', set_id: p.set_id, clos_le: relu.relecture.clos_le, deja_clos: p.deja_clos,
  candidat_fichier_id: p.fichier_id, nb_decisions_listees: d.fichiers.length, incomplete_search: d.incompleteSearch } }];`].join('\n\n');
}
function construireCloturer() {
  const N = NOEUDS_CLOTURER;
  const setIdExpr = `$('${N.valider}').first().json.set_id`;
  const noeuds = [
    webhook(N.webhook, CONFIG.cheminCloturer, CONFIG.credentialCloturer, 'webhook-cloturer'),
    code(N.entree, codeEntreeCloture()),
    code(N.valider, codeValiderCloture()),
    listing(N.chercher, `={{ "'${CONFIG.dossierRelecture}' in parents and trashed = false and name = '" + ${setIdExpr} + ".candidat.json'" }}`, 'nextPageToken,incompleteSearch,files(id,name,version)', false),
    code(N.verifierListe, codeVerifierRecherche(N.verifierListe, N.chercher, 'du candidat', true)),
    contenuDrive(N.lire, `$('${N.verifierListe}').first().json.fichier_id`),
    code(N.preparer, codePreparerCloture()),
    siBooleen(N.siDejaClos, 'deja_clos', 'si-deja-clos'),
    metaVersion(N.relireVersion, `$('${N.preparer}').first().json.fichier_id`),
    code(N.verifierVersion, codeVerifierVersionCloture()),
    reecritureDrive(N.ecrire, '$json.fichier_id', '$json.contenu'),
    contenuDrive(N.relire, `$('${N.preparer}').first().json.fichier_id`),
    listing(N.decisions, qDecisions(setIdExpr), CHAMPS_LISTE, true),
    code(N.sortie, codeSortieCloture()),
  ].map(positionner('cloturer'));
  const connections = lineaire([N.webhook, N.entree, N.valider, N.chercher, N.verifierListe, N.lire, N.preparer, N.siDejaClos]);
  connections[N.siDejaClos] = { main: [lien(N.relire), lien(N.relireVersion)] };
  Object.assign(connections, lineaire([N.relireVersion, N.verifierVersion, N.ecrire, N.relire, N.decisions, N.sortie]));
  return { name: CONFIG.nomCloturer, nodes: noeuds, connections, settings: REGLAGES };
}

// ═══ ÉMETTRE (non observé ; le candidat fait foi) ═══
// Pré-conditions §21.5 vérifiées ICI : référentiel et moteur au commit consigné, réservation au journal
// au même commit (dernière transition « reserve »), lot source COMPLET (validerLot), candidat et
// decisions/ du lot. La correspondance avec l'exécution de génération RETENUE (§20.2) reste à la charge
// du CLI d'Éric (diagnostic « généré » avant l'appel) : ce workflow ne lit pas l'API des exécutions.
function codeEntreeEmission() {
  return [ENTETE('entrée d\'émission : { set_id, journal_commit, referentiel_version, moteur } (CLI d\'Éric, après diagnostic « généré »).'),
    SET_ID, UN_ITEM(NOEUDS_EMETTRE.entree),
    `const b = unItem(null).body;
if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).sort().join(',') !== 'journal_commit,moteur,referentiel_version,set_id') throw new Error('corps : exactement { set_id, journal_commit, referentiel_version, moteur }');
if (typeof b.set_id !== 'string' || !SET_ID_PATTERN.test(b.set_id)) throw new Error('set_id invalide');
if (typeof b.journal_commit !== 'string' || !/^[0-9a-f]{40}$/.test(b.journal_commit)) throw new Error('journal_commit invalide');
if (typeof b.referentiel_version !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(b.referentiel_version)) throw new Error('referentiel_version invalide');
const m = b.moteur;
if (!m || typeof m !== 'object' || typeof m.version !== 'string' || typeof m.sha256 !== 'string' || Object.keys(m).sort().join(',') !== 'sha256,version') throw new Error('moteur invalide');
return [{ json: { set_id: b.set_id, journal_commit: b.journal_commit, referentiel_version: b.referentiel_version, moteur: { version: m.version, sha256: m.sha256 } } }];`].join('\n\n');
}
function codeAnalyserEmission() {
  return [ENTETE('pré-conditions §21.5 : référentiel, moteur, réservation au journal, lot source complet ; candidat existant et decisions/ PROUVÉ vide.'),
    UN_ITEM(NOEUDS_EMETTRE.analyser), OUTILS, REQUIS, blocModule('catalogue'), blocModule('journal'), AGREGER,
    `const { validerLot, decomposerSetId, slugDeNotion } = M_catalogue.exports;
const Journal = M_journal.exports;
const e = unItem(${JSON.stringify(NOEUDS_EMETTRE.entree)});
// 1. Référentiel au commit consigné : octets exacts, SHA-256 = referentiel_version annoncée.
const ref = fichierDepot(${JSON.stringify(NOEUDS_EMETTRE.referentiel)}, 'fonda/data/referentiel.json');
if ('sha256:' + sha256Hex(ref.octets) !== e.referentiel_version) throw new Error('référentiel au commit ≠ referentiel_version annoncée');
const referentiel = JSON.parse(ref.texte);
// 2. Moteur annoncé présent au registre du même commit.
const reg = JSON.parse(fichierDepot(${JSON.stringify(NOEUDS_EMETTRE.moteurs)}, 'fonda/engine/moteurs.json').texte);
const ligneReg = Array.isArray(reg) ? reg.filter((l) => l && l.version === e.moteur.version) : [];
if (ligneReg.length !== 1 || ligneReg[0].sha256 !== e.moteur.sha256) throw new Error('moteur absent du registre au commit consigné');
// 3. Réservation au journal du même commit : ligne « reserve » ET dernière transition « reserve ».
const journal = Journal.lireJournalTexte(fichierDepot(${JSON.stringify(NOEUDS_EMETTRE.journal)}, 'fonda/data/set_ids-journal.json').texte);
const vj = Journal.validerJournal(journal);
if (!vj.valide) throw new Error('journal au commit consigné non conforme');
if (!journal.lignes.some((l) => l.set_id === e.set_id && l.transition === 'reserve') || vj.etats.get(e.set_id) !== 'reserve') throw new Error('journal au commit consigné : ' + e.set_id + ' non réservé ou état ≠ « reserve »');
// 4. Lot source : exactement un fichier, lot-fonda/v1 COMPLET (validerLot), set_id / notion / palier cohérents.
unItem(${JSON.stringify(NOEUDS_EMETTRE.verifierLot)});
const lot = unItem(${JSON.stringify(NOEUDS_EMETTRE.lireLot)});
const vl = validerLot(lot);
if (!vl.valide) throw new Error('lot source non conforme : ' + vl.erreurs.slice(0, 3).join(' ; '));
const dec = decomposerSetId(e.set_id);
if (lot.set_id !== e.set_id || !dec || lot.palier !== dec.palier || slugDeNotion(lot.notion_id) !== dec.slug) throw new Error('lot source : set_id, notion ou palier ≠ set_id demandé');
// 5. Relecteur de la notion du lot dans le référentiel ARCHIVÉ (§20.12).
const notions = (referentiel.notions || []).filter((n) => n && n.id === lot.notion_id);
if (notions.length !== 1 || typeof notions[0].relecteur !== 'string' || !notions[0].relecteur) throw new Error('notion du lot absente, ambiguë ou sans relecteur au référentiel archivé');
const relecteur = notions[0].relecteur;
// 6. Candidat existant (corbeille comprise) et decisions/ du lot : PROUVÉ vide, sinon refus (fail-closed).
const ex = unItem(${JSON.stringify(NOEUDS_EMETTRE.existant)});
if (!Array.isArray(ex.files) || ex.nextPageToken || ex.incompleteSearch) throw new Error('recherche du candidat existant inexploitable ou incomplète');
if (ex.files.length > 1) throw new Error(ex.files.length + ' candidats existants : refus');
if (ex.files.length === 1 && ex.files[0].trashed !== false) throw new Error('candidat existant à la corbeille : refus');
const d = agregerPages(${JSON.stringify(NOEUDS_EMETTRE.decisions)});
if (d.plafond) throw new Error('decisions/ : pagination interrompue au plafond de ${CONFIG.maxPagesDrive} pages : absence de décision NON prouvée, refus');
if (d.incompleteSearch) throw new Error('decisions/ : recherche Drive incomplète (incompleteSearch) : absence de décision NON prouvée, refus');
if (d.fichiers.length) throw new Error('decisions/ : ' + d.fichiers.length + ' décision(s) du lot : ni émission ni réémission (abandon et nouveau set_id, §21.5)');
const reemission = ex.files.length === 1;
if (reemission && (typeof ex.files[0].version !== 'string' || !/^[0-9]+$/.test(ex.files[0].version))) throw new Error('candidat existant : version Drive illisible');
return [{ json: { set_id: e.set_id, relecteur, reemission, fichier_id: reemission ? ex.files[0].id : null, version: reemission ? ex.files[0].version : null } }];`].join('\n\n');
}
function codePreparerCandidat() {
  return [ENTETE('candidat-fonda/v1 (émission : generation_cle 1 ; réémission : en_attente -> en_attente, generation_cle + 1) ; k -> SEUL cle_sha256 stocké.'),
    UN_ITEM(NOEUDS_EMETTRE.preparer), OUTILS, DATE_ISO, REQUIS, blocModule('catalogue'), blocModule('canonique'),
    blocFonction('fonda/scripts/liaison-generation.js', 'projectionComplete', L.projectionComplete),
    `const Canonique = M_canonique.exports;
// empreinte_complete (§20.4) : même calcul que liaison-generation.empreinteComplete.
const empreinteComplete = (x) => 'sha256:' + sha256Hex(Canonique.octetsContrat('lot-complet-fonda/v1', projectionComplete(x)));
const CONFIG = ${JSON.stringify({ dossierRelecture: CONFIG.dossierRelecture, dureeCleJours: CONFIG.dureeCleJours })};
const e = unItem(${JSON.stringify(NOEUDS_EMETTRE.entree)});
const a = unItem(${JSON.stringify(NOEUDS_EMETTRE.analyser)});
const lot = unItem(${JSON.stringify(NOEUDS_EMETTRE.lireLot)});
const k = unItem(null).k;
if (typeof k !== 'string' || !/^[0-9a-f]{64}$/.test(k)) throw new Error('clé k : 64 hex attendus (32 octets)');
const cleSha = sha256Hex(octetsUtf8(k));
const maintenant = new Date();
const le = maintenant.toISOString();
const expireLe = new Date(maintenant.getTime() + CONFIG.dureeCleJours * 86400000).toISOString(); // borné : maintenant + 14 j
let relecture;
if (a.reemission !== true) {
  relecture = { statut: 'en_attente', generation_cle: 1, cle_sha256: cleSha, cree_le: le, expire_le: expireLe, clos_le: null,
    relecteur_attribue: a.relecteur, referentiel_version: e.referentiel_version, moteur: e.moteur, envois: [] };
} else {
  // Réémission (§21.5) : seulement depuis en_attente, provenance INCHANGÉE, nouvelle clé.
  // L'enveloppe ENTIÈRE est validée AVANT toute modification (forme exacte, dates, envois, entier sûr).
  const c = unItem(${JSON.stringify(NOEUDS_EMETTRE.lireExistant)});
  const r = c && c.relecture;
  const CLES = 'cle_sha256,clos_le,cree_le,envois,expire_le,generation_cle,moteur,referentiel_version,relecteur_attribue,statut';
  if (!c || typeof c !== 'object' || Object.keys(c).sort().join(',') !== 'lot,relecture,schema' || c.schema !== 'candidat-fonda/v1' || !c.lot || !r || typeof r !== 'object' || Object.keys(r).sort().join(',') !== CLES) throw new Error('candidat existant non conforme (forme exacte candidat-fonda/v1)');
  if (r.statut !== 'en_attente' || r.clos_le !== null) throw new Error('réémission refusée : statut « ' + r.statut + ' » (seul en_attente, clos_le null)');
  if (!Number.isSafeInteger(r.generation_cle) || r.generation_cle < 1 || !Number.isSafeInteger(r.generation_cle + 1) || r.generation_cle + 1 > Number.MAX_SAFE_INTEGER - 1) throw new Error('candidat existant : generation_cle invalide ou non incrémentable');
  if (typeof r.cle_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(r.cle_sha256)) throw new Error('candidat existant : cle_sha256 invalide');
  if (!dateIso(r.cree_le) || !dateIso(r.expire_le) || r.cree_le > r.expire_le) throw new Error('candidat existant : cree_le / expire_le invalides');
  if (!Array.isArray(r.envois) || !r.envois.length || !r.envois.every((x) => x && typeof x === 'object' && Object.keys(x).sort().join(',') === 'envoye_a,generation_cle,le'
    && Number.isSafeInteger(x.generation_cle) && x.generation_cle >= 1 && x.generation_cle <= r.generation_cle && typeof x.envoye_a === 'string' && x.envoye_a !== '' && dateIso(x.le))) throw new Error('candidat existant : envois invalides');
  // D3 : lot du candidat COMPLET et conforme (schema, liste blanche), EN PLUS de l'empreinte (projection).
  const vlc = M_catalogue.exports.validerLot(c.lot);
  if (!vlc.valide) throw new Error('candidat existant : lot non conforme : ' + vlc.erreurs.slice(0, 3).join(' ; '));
  if (empreinteComplete(c.lot) !== empreinteComplete(lot)) throw new Error('candidat existant : lot ≠ lot source (empreinte_complete, §21.5)');
  if (r.relecteur_attribue !== a.relecteur || r.referentiel_version !== e.referentiel_version || !r.moteur || typeof r.moteur !== 'object' || Object.keys(r.moteur).sort().join(',') !== 'sha256,version' || r.moteur.version !== e.moteur.version || r.moteur.sha256 !== e.moteur.sha256) throw new Error('réémission refusée : provenance (relecteur, référentiel, moteur) ≠ candidat existant');
  if (r.cle_sha256 === cleSha) throw new Error('réémission : nouvelle clé identique à l\\'ancienne');
  relecture = { ...r, statut: 'en_attente', generation_cle: r.generation_cle + 1, cle_sha256: cleSha, expire_le: expireLe, clos_le: null, envois: r.envois.slice() };
}
// D3 : invariants temporels du RÉSULTAT (une date future lue ne produit jamais expire_le ≤ cree_le).
if (!dateIso(relecture.cree_le) || Date.parse(relecture.cree_le) > maintenant.getTime() || !(Date.parse(relecture.cree_le) < Date.parse(relecture.expire_le))) throw new Error('candidat : cree_le futur ou expire_le ≤ cree_le : refus');
// envois : CHAQUE tentative est consignée AVANT l'envoi (une panne de courriel laisse la trace).
relecture.envois.push({ generation_cle: relecture.generation_cle, envoye_a: a.relecteur, le });
const candidat = { schema: 'candidat-fonda/v1', lot, relecture };
const contenu = JSON.stringify(candidat, null, 2) + '\\n';
const nom = e.set_id + '.candidat.json';
const metadonnees = { name: nom, parents: [CONFIG.dossierRelecture], mimeType: 'application/json', properties: { fonda_set_id: e.set_id } };
const frontiere = 'fonda-' + sha256Hex(octetsUtf8(contenu)).slice(0, 32);
const corps = '--' + frontiere + '\\r\\nContent-Type: application/json; charset=UTF-8\\r\\n\\r\\n' + JSON.stringify(metadonnees)
  + '\\r\\n--' + frontiere + '\\r\\nContent-Type: application/json; charset=UTF-8\\r\\n\\r\\n' + contenu + '\\r\\n--' + frontiere + '--\\r\\n';
// k ne sort de ce nœud QUE vers le courriel (jamais stocké, jamais en sortie du workflow).
return [{ json: { set_id: e.set_id, relecteur: a.relecteur, reemission: a.reemission === true, fichier_id: a.fichier_id, version: a.version, generation_cle: relecture.generation_cle, k,
  depot: { nom, frontiere, corps, contenu } } }];`].join('\n\n');
}
// D2 (README « Où vit chaque garantie ») : juste avant la réécriture, la version Drive du candidat doit être
// celle relevée à l'analyse (avant la lecture du contenu). Détecte une écriture DÉJÀ visible à ce moment ;
// une écriture concurrente postérieure au contrôle n'est pas exclue (E1) : seul le verrou CLI (P5) l'exclut.
function codeVerifierVersion() {
  return [ENTETE('réémission : candidat INCHANGÉ depuis l\'analyse (version Drive identique, hors corbeille) avant réécriture.'),
    UN_ITEM(NOEUDS_EMETTRE.verifierVersion),
    `const p = unItem(${JSON.stringify(NOEUDS_EMETTRE.preparer)});
const m = unItem(${JSON.stringify(NOEUDS_EMETTRE.relireVersion)});
if (!m || m.id !== p.fichier_id || m.trashed !== false || m.version !== p.version) throw new Error('réémission : candidat modifié depuis l\\'analyse (course détectée : version ' + (m && m.version) + ' ≠ ' + p.version + ') : refus, rien réécrit');
return [{ json: { fichier_id: p.fichier_id } }];`].join('\n\n');
}
function codeVerifierEcriture() {
  return [ENTETE('écriture constatée (création : nom attendu ; réémission : même fichier) ; decisions/ RELISTÉ après écriture : toujours prouvé vide.'),
    UN_ITEM(NOEUDS_EMETTRE.verifier), AGREGER, VERSION,
    `const p = unItem(${JSON.stringify(NOEUDS_EMETTRE.preparer)});
const r = unItem(p.reemission ? ${JSON.stringify(NOEUDS_EMETTRE.reecrire)} : ${JSON.stringify(NOEUDS_EMETTRE.ecrire)});
if (!r || typeof r.id !== 'string' || !r.id || r.name !== p.depot.nom) throw new Error('candidat non écrit');
if (p.reemission && r.id !== p.fichier_id) throw new Error('réémission : fichier réécrit ≠ candidat existant');
// D2 : détection AU MIEUX d'une écriture glissée entre le contrôle de version et la nôtre (version après ≠ avant + 1).
if (p.reemission && r.version !== versionSuivante(p.version)) throw new Error('réémission : écriture concurrente détectée (version ' + r.version + ' ≠ ' + versionSuivante(p.version) + ') : aucun courriel');
const d = agregerPages(${JSON.stringify(NOEUDS_EMETTRE.relister)});
if (!d.complet || d.fichiers.length) throw new Error('decisions/ après écriture : ' + (d.complet ? d.fichiers.length + ' décision(s) apparue(s)' : 'listing non prouvé complet') + ' (course détectée) : aucun courriel ; abandon et nouveau set_id si une décision existe');
return [{ json: { candidat_fichier_id: r.id } }];`].join('\n\n');
}
function codeCourriel() {
  return [ENTETE('courriel au relecteur : adresse lue dans la Data Table (clé = relecteur_attribue), lien …?lot=&k=.'),
    UN_ITEM(NOEUDS_EMETTRE.courriel),
    `const CONFIG = ${JSON.stringify({ urlPage: CONFIG.urlPage, dureeCleJours: CONFIG.dureeCleJours })};
const p = unItem(${JSON.stringify(NOEUDS_EMETTRE.preparer)});
unItem(${JSON.stringify(NOEUDS_EMETTRE.verifier)});
const t = unItem(${JSON.stringify(NOEUDS_EMETTRE.adresse)});
const lignes = Array.isArray(t.data) ? t.data.filter((l) => l && l.relecteur_attribue === p.relecteur) : [];
if (lignes.length !== 1 || typeof lignes[0].adresse !== 'string' || !/^[^@\\s]+@[^@\\s]+$/.test(lignes[0].adresse)) throw new Error('adresse du relecteur introuvable ou ambiguë dans la Data Table');
const lien = CONFIG.urlPage + '?lot=' + encodeURIComponent(p.set_id) + '&k=' + p.k;
const message = ['To: ' + lignes[0].adresse, 'Subject: Relecture FONDA ' + p.set_id, 'Content-Type: text/plain; charset=UTF-8', '',
  'Bonjour,', '', 'Une fiche FONDA est à relire, carte par carte :', lien, '',
  'Le lien expire dans ' + CONFIG.dureeCleJours + ' jours.' + (p.reemission ? ' Il remplace le lien envoyé précédemment, désormais inactif.' : '')].join('\\r\\n');
// base64url d'UTF-8, sans Buffer (nœud Code n8n).
const o = []; for (const ch of message) { const c = ch.codePointAt(0); if (c < 0x80) o.push(c); else if (c < 0x800) o.push(0xc0 | (c >> 6), 0x80 | (c & 63)); else if (c < 0x10000) o.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); else o.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
let raw = '';
for (let i = 0; i < o.length; i += 3) { const n = (o[i] << 16) | ((o[i + 1] || 0) << 8) | (o[i + 2] || 0); raw += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < o.length ? A[(n >> 6) & 63] : '') + (i + 2 < o.length ? A[n & 63] : ''); }
return [{ json: { raw } }];`].join('\n\n');
}
function codeSortieEmission() {
  return [ENTETE('sortie d\'émission (non observée) : jamais k, jamais d\'adresse.'), UN_ITEM(NOEUDS_EMETTRE.sortie),
    `const p = unItem(${JSON.stringify(NOEUDS_EMETTRE.preparer)});
const ecrit = unItem(${JSON.stringify(NOEUDS_EMETTRE.verifier)});
const envoi = unItem(${JSON.stringify(NOEUDS_EMETTRE.envoyer)});
if (!envoi || typeof envoi.id !== 'string') throw new Error('courriel non envoyé');
return [{ json: { schema: 'emission-fonda/v1', set_id: p.set_id, candidat_fichier_id: ecrit.candidat_fichier_id, relecteur_attribue: p.relecteur,
  generation_cle: p.generation_cle, reemission: p.reemission } }];`].join('\n\n');
}
function construireEmettre() {
  const N = NOEUDS_EMETTRE;
  const contents = (nom, fichier) => ({
    name: nom, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, retryOnFail: false,
    parameters: {
      url: `={{ 'https://api.github.com/repos/${CONFIG.depot}/contents/${fichier}?ref=' + $('${N.entree}').first().json.journal_commit }}`,
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }, { name: 'User-Agent', value: 'box-fonda-relecture' }] },
      options: { timeout: 30000 },
    },
  });
  const setIdExpr = `$('${N.entree}').first().json.set_id`;
  const noeuds = [
    webhook(N.webhook, CONFIG.cheminEmettre, CONFIG.credentialEmettre, 'webhook-emettre'),
    code(N.entree, codeEntreeEmission()),
    contents(N.referentiel, 'fonda/data/referentiel.json'),
    contents(N.moteurs, 'fonda/engine/moteurs.json'),
    contents(N.journal, 'fonda/data/set_ids-journal.json'),
    listing(N.chercherLot, `={{ "'${CONFIG.dossierCandidats}' in parents and trashed = false and name = '" + ${setIdExpr} + ".lot.json'" }}`, CHAMPS_LISTE, false),
    code(N.verifierLot, codeVerifierRecherche(N.verifierLot, N.chercherLot, 'du lot source')),
    contenuDrive(N.lireLot, `$('${N.verifierLot}').first().json.fichier_id`),
    // Corbeille COMPRISE : un candidat à la corbeille bloque (refus), jamais ignoré.
    listing(N.existant, `={{ "'${CONFIG.dossierRelecture}' in parents and name = '" + ${setIdExpr} + ".candidat.json'" }}`, 'nextPageToken,incompleteSearch,files(id,name,trashed,version)', false),
    listing(N.decisions, qDecisions(setIdExpr), CHAMPS_LISTE, true),
    code(N.analyser, codeAnalyserEmission()),
    siBooleen(N.siReemission, 'reemission', 'si-reemission'),
    contenuDrive(N.lireExistant, `$('${N.analyser}').first().json.fichier_id`),
    // Crypto v1 « Generate » (§6) : 32 octets aléatoires, hex 64 -> champ k.
    { name: N.cle, type: 'n8n-nodes-base.crypto', typeVersion: 1, parameters: { action: 'generate', dataPropertyName: 'k', encodingType: 'hex', stringLength: 64 } },
    code(N.preparer, codePreparerCandidat()),
    siBooleen(N.siReecrire, 'reemission', 'si-reecrire'),
    metaVersion(N.relireVersion, `$('${N.preparer}').first().json.fichier_id`),
    code(N.verifierVersion, codeVerifierVersion()),
    drive(N.ecrire, {
      method: 'POST', url: 'https://www.googleapis.com/upload/drive/v3/files',
      sendQuery: true, queryParameters: { parameters: [{ name: 'uploadType', value: 'multipart' }, { name: 'fields', value: 'id,name,parents,properties' }] },
      sendBody: true, contentType: 'raw', rawContentType: '={{ \'multipart/related; boundary=\' + $json.depot.frontiere }}', body: '={{ $json.depot.corps }}',
      options: { timeout: 60000 },
    }),
    reecritureDrive(N.reecrire, `$('${N.preparer}').first().json.fichier_id`, `$('${N.preparer}').first().json.depot.contenu`),
    listing(N.relister, qDecisions(setIdExpr), CHAMPS_LISTE, true),
    code(N.verifier, codeVerifierEcriture()),
    {
      name: N.adresse, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, retryOnFail: false,
      credentials: { httpHeaderAuth: CONFIG.credentialApiN8n },
      parameters: { url: `${CONFIG.urlN8n}/api/v1/data-tables/${CONFIG.tableRelecteurs}/rows`, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', options: { timeout: 30000 } },
    },
    code(N.courriel, codeCourriel()),
    {
      name: N.envoyer, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, retryOnFail: false,
      credentials: { gmailOAuth2: CONFIG.credentialGmail },
      parameters: {
        method: 'POST', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'gmailOAuth2',
        sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ raw: $json.raw }) }}', options: { timeout: 30000 },
      },
    },
    code(N.sortie, codeSortieEmission()),
  ].map(positionner('emettre'));
  const connections = lineaire([N.webhook, N.entree, N.referentiel, N.moteurs, N.journal, N.chercherLot, N.verifierLot, N.lireLot, N.existant, N.decisions, N.analyser, N.siReemission]);
  connections[N.siReemission] = { main: [lien(N.lireExistant), lien(N.cle)] };
  Object.assign(connections, lineaire([N.lireExistant, N.cle, N.preparer, N.siReecrire]));
  connections[N.siReecrire] = { main: [lien(N.relireVersion), lien(N.ecrire)] };
  Object.assign(connections, lineaire([N.relireVersion, N.verifierVersion, N.reecrire, N.relister]), lineaire([N.ecrire, N.relister]), lineaire([N.relister, N.verifier, N.adresse, N.courriel, N.envoyer, N.sortie]));
  return { name: CONFIG.nomEmettre, nodes: noeuds, connections, settings: REGLAGES };
}

// ═══ COMMUN PAGE / CONFIRMER (P2) : jeton (§21.6) et hash_formulaire (§21.1) ═══
// SOURCE UNIQUE, embarquée telle quelle dans les nœuds Code de la Page ET de Confirmer (avec OUTILS :
// octetsUtf8, sha256Hex), et chargée par le harnais (chargerCommun) pour les vecteurs.
// « Octets canoniques » d'un TABLEAU à schéma FIXE : chaque élément est VALIDÉ (type, entier sûr, paires de
// choix), puis sérialisé par JSON.stringify (aucun objet : aucun ordre de clés en jeu ; chaînes sans
// normalisation, comme canonique.js §1), UTF-8. hash_formulaire = empreinte d'AUDIT signée (dans la décision
// decision-fonda/v1, donc inaltérable une fois signée) : calculée ici, vérifiée par le harnais seul ; aucune
// re-dérivation aval (expire_page n'est pas dans la décision) — README « Où vit chaque garantie ».
const COMMUN_PAGE = `function tableauCanonique(schema, valeurs) {
  if (!Array.isArray(valeurs) || valeurs.length !== schema.length) throw new Error('tableau canonique : longueur ≠ schéma');
  const conforme = (s, v) => (s === 'chaine' ? typeof v === 'string'
    : s === 'entier' ? Number.isSafeInteger(v) && v >= 0
      : s === 'choix' ? Array.isArray(v) && v.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && p[0] !== '' && (p[1] === 'garder' || p[1] === 'ecarter'))
        : false);
  for (let i = 0; i < schema.length; i += 1) if (!conforme(schema[i], valeurs[i])) throw new Error('tableau canonique : élément ' + i + ' ≠ ' + schema[i]);
  return octetsUtf8(JSON.stringify(valeurs.map((v, i) => (schema[i] === 'choix' ? v.map((p) => [p[0], p[1]]) : v))));
}
const SCHEMA_JETON = ['chaine', 'chaine', 'entier', 'chaine', 'chaine', 'chaine', 'chaine', 'chaine', 'chaine'];
const SCHEMA_FORMULAIRE = ['chaine', 'chaine', 'entier', 'chaine', 'chaine', 'chaine', 'chaine', 'chaine', 'chaine', 'choix'];
function hexVersOctets(h) {
  const o = [];
  for (let i = 0; i < h.length; i += 2) o.push(parseInt(h.slice(i, i + 2), 16));
  return o;
}
// HMAC-SHA256 (RFC 2104), JavaScript pur (aucun module crypto dans un nœud Code n8n).
function hmacSha256Hex(cle, message) {
  let k = cle.length > 64 ? hexVersOctets(sha256Hex(cle)) : cle.slice();
  while (k.length < 64) k.push(0);
  const interne = sha256Hex(k.map((x) => x ^ 0x36).concat(message));
  return sha256Hex(k.map((x) => x ^ 0x5c).concat(hexVersOctets(interne)));
}
// Jeton §21.6 : HMAC-SHA256(secret, canonique(["fonda-select/v7", set_id, generation_cle, cle_sha256,
// empreinte_affichee, moteur.version, moteur.sha256, expire_page, nonce])). Secret : variable d'environnement
// de l'instance (jamais dans l'export) ; absent ou court -> ERREUR (configuration), jamais un jeton faible.
function jetonPage(secret, j) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('secret HMAC de la page absent ou trop court (configuration de l\\'instance)');
  return hmacSha256Hex(octetsUtf8(secret), tableauCanonique(SCHEMA_JETON, ['fonda-select/v7', j.set_id, j.generation_cle, j.cle_sha256, j.empreinte, j.moteur_version, j.moteur_sha256, j.expire_page, j.nonce]));
}
// hash_formulaire §21.1 : choix = [[item_id, "garder"|"ecarter"], …] dans l'ORDRE DU CANDIDAT ([] pour « tout
// rejeter ») ; k et jeton EXCLUS (secrets).
function hashFormulaire(f) {
  return 'sha256:' + sha256Hex(tableauCanonique(SCHEMA_FORMULAIRE, ['fonda-select-form/v1', f.lot, f.generation, f.empreinte, f.moteur_version, f.moteur_sha256, f.expire_page, f.nonce, f.action, f.choix]));
}
function egalConstant(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i += 1) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}`;
// Chargement pour le harnais : MÊME texte que les nœuds, évalué avec OUTILS dans un contexte nu.
function chargerCommun() {
  // eslint-disable-next-line global-require
  return require('vm').runInNewContext(`${OUTILS}\n${COMMUN_PAGE}\n({ tableauCanonique, hmacSha256Hex, jetonPage, hashFormulaire, egalConstant, octetsUtf8, sha256Hex })`, {});
}
const CODES_HTTP = Object.freeze({ decision: 200, conflit: 409, C1: 400, C2: 403, C3: 410, C4: 410, C5: 400, C5bis: 410 });
const CHAMPS_FORMULAIRE = Object.freeze(['lot', 'k', 'generation', 'empreinte', 'moteur_version', 'moteur_sha256', 'expire_page', 'nonce', 'jeton', 'action']);
const TAILLE_MAX_POST = 65536;

// ═══ CONFIRMER (sortie observée confirmation-fonda/v1, consommateur gelé ROLES.confirmation) ═══
// Déclenché par le RELECTEUR (non fiable, hors verrou P5) : tout ce qu'il provoque seul est fermé par le
// pilier 1 (signataire). C1 (syntaxe, avant Drive) -> C2 (jeton sur les valeurs POSTÉES : authenticité) ->
// C3 (candidat COURANT : statut, clé, génération, expirations, moteur : fraîcheur, 410) -> C4 (empreinte
// affichée = actuelle) -> C5 (sélection) -> C6 (même nom : cœur identique -> « existante » relue ; cœur
// différent -> « conflit », 409 ; sinon) C5bis (candidat RELU juste avant l'écriture) -> écriture -> C7.
// Tout REJET est une exécution « success » (sortie rejet, rien écrit) ; une panne (Drive, configuration)
// est une ERREUR d'exécution (E4 : abandon au signataire si le lot est lisible) — jamais « réussi ».
const NOEUDS_CONFIRMER = Object.freeze({
  webhook: 'Webhook confirmation',
  entree: R.ROLES.confirmation.entree, // FONDA Entree confirmation
  formulaire: 'Verifier formulaire',
  siFormulaire: 'Formulaire valide ?',
  chercher: 'Chercher candidat',
  verifierListe: 'Verifier recherche candidat',
  siCandidat: 'Candidat trouve ?',
  lire: 'Lire candidat',
  controler: 'Controler candidat',
  siDecision: 'Decision construite ?',
  chercherDecision: 'Chercher decision',
  analyserDecision: 'Analyser decision existante',
  siExistante: 'Decision existante ?',
  lireDecision: 'Lire decision existante',
  comparer: 'Comparer decision',
  relire: 'Relire candidat',
  verifierRelecture: 'Verifier relecture candidat',
  siRelecture: 'Relecture conforme ?',
  ecrire: R.ROLES.confirmation.ecriture, // FONDA Ecrire decision
  verifierEcriture: 'Verifier ecriture decision',
  sortie: R.ROLES.confirmation.sortie, // FONDA Sortie confirmation
  reponse: 'Preparer reponse',
  repondre: 'Repondre confirmation',
  siNotifier: 'Notifier ?',
  adresse: 'Lire adresse cloturer',
  courriel: 'Preparer notification',
  siEnvoyer: 'Adresse trouvee ?',
  envoyer: 'Envoyer notification',
});
const DEJA_REJET = `const rejet = (motif, apresC2) => [{ json: { poursuivre: false, resultat: { type: 'rejet', motif, set_id: apresC2 ? f.lot : null, nonce: apresC2 ? f.nonce : null } } }];`;

function codeEntreeConfirmation() {
  // Ne fait que COPIER les champs nommés (chaîne ≤ 128, sinon null) : ne lève JAMAIS (§21.1). Jamais k, jeton ni choix.
  return [
    ENTETE('entrée de confirmation : { lot, nonce } copiés tels quels (chaîne ≤ 128, sinon null), sans validation.'),
    `const items = $input.all();
const corps = items.length === 1 && items[0] && items[0].json ? items[0].json.body : undefined;
const champ = (n) => { const v = corps && typeof corps === 'object' && !Array.isArray(corps) ? corps[n] : undefined; return typeof v === 'string' && v.length <= 128 ? v : null; };
return [{ json: { lot: champ('lot'), nonce: champ('nonce') } }];`,
  ].join('\n\n');
}
function codeVerifierFormulaire() {
  return [ENTETE('C1 (syntaxe, avant Drive : taille, champs EXACTS, doublons) puis C2 (jeton HMAC recalculé sur les valeurs POSTÉES).'),
    UN_ITEM(NOEUDS_CONFIRMER.formulaire), SET_ID, DATE_ISO, OUTILS, COMMUN_PAGE,
    `const CHAMPS = ${JSON.stringify(CHAMPS_FORMULAIRE)};
const w = unItem(${JSON.stringify(NOEUDS_CONFIRMER.webhook)});
const b = w.body; const h = w.headers && typeof w.headers === 'object' ? w.headers : {};
const f = { lot: null, nonce: null };
${DEJA_REJET}
const a = (o, c) => Object.prototype.hasOwnProperty.call(o, c);
// C1 — taille : octets annoncés (content-length) ET somme des champs reçus, chacun ≤ ${TAILLE_MAX_POST}.
const lg = h['content-length'];
if (typeof lg !== 'string' || !/^[0-9]{1,7}$/.test(lg) || Number(lg) > ${TAILLE_MAX_POST}) return rejet('C1', false);
if (!b || typeof b !== 'object' || Array.isArray(b)) return rejet('C1', false);
const cles = Object.keys(b);
// Doublon (même champ deux fois) : n8n le livre en TABLEAU -> non-chaîne -> refus.
if (!cles.every((c) => typeof b[c] === 'string')) return rejet('C1', false);
if (cles.reduce((t, c) => t + c.length + b[c].length, 0) > ${TAILLE_MAX_POST}) return rejet('C1', false);
if (!CHAMPS.every((c) => a(b, c))) return rejet('C1', false);
const autres = cles.filter((c) => !CHAMPS.includes(c));
let choix;
if (b.action === 'accepter') {
  if (!autres.length || !autres.every((c) => /^choix_it[0-9]{2}$/.test(c) && (b[c] === 'garder' || b[c] === 'ecarter'))) return rejet('C1', false);
  choix = autres.map((c) => [c.slice(6), b[c]]);
} else if (b.action === 'rejeter') {
  if (autres.length !== 1 || autres[0] !== 'confirmer_rejet' || b.confirmer_rejet !== 'oui') return rejet('C1', false);
  choix = [];
} else return rejet('C1', false);
if (!SET_ID_PATTERN.test(b.lot) || !/^[0-9a-f]{64}$/.test(b.k) || !/^[1-9][0-9]{0,14}$/.test(b.generation) || !/^sha256:[0-9a-f]{64}$/.test(b.empreinte)
  || !/^[A-Za-z0-9._-]{1,64}$/.test(b.moteur_version) || !/^[0-9a-f]{64}$/.test(b.moteur_sha256) || !dateIso(b.expire_page)
  || !/^[0-9a-f]{32}$/.test(b.nonce) || !/^[0-9a-f]{64}$/.test(b.jeton)) return rejet('C1', false);
// C2 — authenticité du formulaire : jeton recalculé sur les valeurs POSTÉES (cle_sha256 = SHA-256 de k reçue).
// La FRAÎCHEUR (clé révoquée, génération, expiration) est C3, contre le candidat COURANT (§21.10).
const cleSha = sha256Hex(octetsUtf8(b.k));
const generation = Number(b.generation);
const attendu = jetonPage($env.FONDA_PAGE_HMAC, { set_id: b.lot, generation_cle: generation, cle_sha256: cleSha, empreinte: b.empreinte,
  moteur_version: b.moteur_version, moteur_sha256: b.moteur_sha256, expire_page: b.expire_page, nonce: b.nonce });
if (!egalConstant(attendu, b.jeton)) return rejet('C2', false);
return [{ json: { poursuivre: true, resultat: null, lot: b.lot, nonce: b.nonce, generation, empreinte: b.empreinte, moteur_version: b.moteur_version,
  moteur_sha256: b.moteur_sha256, expire_page: b.expire_page, action: b.action, choix, cle_sha256: cleSha } }];`].join('\n\n');
}
function codeVerifierRechercheConfirmation() {
  return [ENTETE('candidat : recherche COMPLÈTE exigée (sinon erreur) ; 0 ou plusieurs fichiers -> rejet C3 (410).'),
    UN_ITEM(NOEUDS_CONFIRMER.verifierListe),
    `const f = unItem(${JSON.stringify(NOEUDS_CONFIRMER.formulaire)});
${DEJA_REJET}
const liste = unItem(${JSON.stringify(NOEUDS_CONFIRMER.chercher)});
if (!Array.isArray(liste.files) || liste.nextPageToken || liste.incompleteSearch) throw new Error('recherche du candidat inexploitable ou incomplète');
if (liste.files.length !== 1 || typeof liste.files[0].id !== 'string') return rejet('C3', true);
return [{ json: { poursuivre: true, resultat: null, fichier_id: liste.files[0].id } }];`].join('\n\n');
}
// Contrôles de FRAÎCHEUR d'un candidat lu (C3 au premier passage, C5bis à la relecture) : MÊME texte.
const CANDIDAT_COURANT = `function candidatCourant(c, f, maintenant) {
  if (!c || typeof c !== 'object' || c.schema !== 'candidat-fonda/v1' || !c.lot || typeof c.lot !== 'object' || c.lot.set_id !== f.lot || !c.relecture || typeof c.relecture !== 'object') return false;
  const r = c.relecture;
  if (r.statut !== 'en_attente' || r.clos_le !== null) return false; // clos (clôture technique) ou abandonné : clé révoquée
  if (r.cle_sha256 !== f.cle_sha256 || r.generation_cle !== f.generation) return false; // clé ou génération ≠ courante
  if (!dateIso(r.expire_le) || !(maintenant < Date.parse(r.expire_le)) || !(maintenant < Date.parse(f.expire_page)) || Date.parse(f.expire_page) > Date.parse(r.expire_le)) return false;
  return Boolean(r.moteur) && r.moteur.version === f.moteur_version && r.moteur.sha256 === f.moteur_sha256;
}`;
function codeControlerCandidat() {
  return [ENTETE('C3 (candidat courant), C4 (empreinte affichée = actuelle), C5 (sélection) ; décision decision-fonda/v1 construite (ordre du candidat).'),
    UN_ITEM(NOEUDS_CONFIRMER.controler), DATE_ISO, OUTILS, COMMUN_PAGE, CANDIDAT_COURANT, REQUIS, blocModule('catalogue'), blocModule('canonique'),
    blocFonction('fonda/scripts/liaison-generation.js', 'projectionComplete', L.projectionComplete),
    blocFonction('fonda/scripts/signer-cloture.js', 'lotPublie', SC.lotPublie),
    `const { validerLot, calculerEmpreinte } = M_catalogue.exports;
const Canonique = M_canonique.exports;
const CONFIG = ${JSON.stringify({ dossierDecisions: CONFIG.dossierDecisions })};
const empreinteComplete = (x) => 'sha256:' + sha256Hex(Canonique.octetsContrat('lot-complet-fonda/v1', projectionComplete(x)));
const sha = (t) => sha256Hex(octetsUtf8(t));
const f = unItem(${JSON.stringify(NOEUDS_CONFIRMER.formulaire)});
const fichier = unItem(${JSON.stringify(NOEUDS_CONFIRMER.verifierListe)});
const c = unItem(${JSON.stringify(NOEUDS_CONFIRMER.lire)});
${DEJA_REJET}
// C3 — fraîcheur contre le candidat COURANT, lot conforme.
if (!candidatCourant(c, f, Date.now()) || !validerLot(c.lot).valide) return rejet('C3', true);
// C4 — empreinte pédagogique actuelle = affichée.
const empreinte = await calculerEmpreinte(c.lot, sha);
if (empreinte !== f.empreinte) return rejet('C4', true);
// C5 — un choix par carte, exactement (accepter, au moins une carte gardée) ; « tout rejeter » : toutes écartées.
const ids = c.lot.cartes.map((x) => x.item_id);
let choix;
if (f.action === 'accepter') {
  const postes = f.choix.map((p) => p[0]);
  if (postes.length !== ids.length || new Set(postes).size !== postes.length || !ids.every((id) => postes.includes(id))) return rejet('C5', true);
  choix = ids.map((id) => [id, f.choix.find((p) => p[0] === id)[1]]);
  if (!choix.some((p) => p[1] === 'garder')) return rejet('C5', true);
} else choix = ids.map((id) => [id, 'ecarter']);
const selection = choix.filter((p) => p[1] === 'garder').map((p) => p[0]);
const ecartees = choix.filter((p) => p[1] === 'ecarter').map((p) => p[0]);
const rel = c.relecture;
// §21.1 : empreinte_publiee = lot FILTRÉ (accepter) ; = lot SOURCE (« tout rejeter »).
const coeur = { action: f.action, selection, ecartees, empreinte_relue: empreinte,
  empreinte_publiee: f.action === 'accepter' ? await calculerEmpreinte(lotPublie(c.lot, { selection }), sha) : empreinte,
  moteur: { version: rel.moteur.version, sha256: rel.moteur.sha256 } };
const hash = hashFormulaire({ lot: f.lot, generation: f.generation, empreinte: f.empreinte, moteur_version: f.moteur_version, moteur_sha256: f.moteur_sha256,
  expire_page: f.expire_page, nonce: f.nonce, action: f.action, choix: f.action === 'accepter' ? choix : [] }); // §21.1 : [] pour « tout rejeter »
const decision = { schema: 'decision-fonda/v1', set_id: f.lot, generation: rel.generation_cle, nonce: f.nonce, recu_le: new Date().toISOString(), coeur,
  lot_relu: { set_id: f.lot, empreinte_complete: empreinteComplete(c.lot), cartes: choix.map((p) => ({ item_id: p[0], choix: p[1] })) }, hash_formulaire: hash };
const decisionSha = 'sha256:' + sha256Hex(Canonique.octetsContrat('decision-fonda/v1', decision));
const contenu = JSON.stringify(decision, null, 2) + '\\n';
const nom = f.lot + '-' + f.nonce + '.json';
const metadonnees = { name: nom, parents: [CONFIG.dossierDecisions], mimeType: 'application/json', properties: { fonda_set_id: f.lot, fonda_nonce: f.nonce } };
const frontiere = 'fonda-' + sha256Hex(octetsUtf8(contenu)).slice(0, 32);
const corps = '--' + frontiere + '\\r\\nContent-Type: application/json; charset=UTF-8\\r\\n\\r\\n' + JSON.stringify(metadonnees)
  + '\\r\\n--' + frontiere + '\\r\\nContent-Type: application/json; charset=UTF-8\\r\\n\\r\\n' + contenu + '\\r\\n--' + frontiere + '--\\r\\n';
return [{ json: { poursuivre: true, resultat: null, candidat_fichier_id: fichier.fichier_id, generation: rel.generation_cle, decision, decision_sha256: decisionSha,
  depot: { nom, frontiere, corps } } }];`].join('\n\n');
}
function codeAnalyserDecision() {
  return [ENTETE('C6 : fichiers de MÊME NOM dans decisions/ (corbeille comprise), recherche complète ; 0 -> écrire, 1 -> relire, plusieurs -> erreur.'),
    UN_ITEM(NOEUDS_CONFIRMER.analyserDecision),
    `const liste = unItem(${JSON.stringify(NOEUDS_CONFIRMER.chercherDecision)});
if (!Array.isArray(liste.files) || liste.nextPageToken || liste.incompleteSearch) throw new Error('decisions/ : recherche du nom inexploitable ou incomplète (absence non prouvée)');
if (liste.files.length > 1) throw new Error(liste.files.length + ' décisions de même nom : état anormal');
const existante = liste.files.length === 1;
if (existante && typeof liste.files[0].id !== 'string') throw new Error('decisions/ : identifiant illisible');
return [{ json: { existante, fichier_id: existante ? liste.files[0].id : null } }];`].join('\n\n');
}
function codeComparerDecision() {
  return [ENTETE('C6 : même nom ; même lot, nonce, génération et CŒUR (octets canoniques) -> « existante » (décision RELUE, jamais reconstruite) ; sinon « conflit ».'),
    UN_ITEM(NOEUDS_CONFIRMER.comparer), OUTILS, REQUIS, blocModule('canonique'),
    `const Canonique = M_canonique.exports;
const p = unItem(${JSON.stringify(NOEUDS_CONFIRMER.controler)});
const a = unItem(${JSON.stringify(NOEUDS_CONFIRMER.analyserDecision)});
const ex = unItem(${JSON.stringify(NOEUDS_CONFIRMER.lireDecision)});
const memesOctets = (x, y) => x.length === y.length && x.every((o, i) => o === y[i]);
let shaExistante = null; let identique = false;
try {
  shaExistante = 'sha256:' + sha256Hex(Canonique.octetsContrat('decision-fonda/v1', ex));
  identique = ex.set_id === p.decision.set_id && ex.nonce === p.decision.nonce && ex.generation === p.decision.generation
    && memesOctets(Canonique.octetsContrat('coeur-decision-fonda/v1', ex.coeur), Canonique.octetsContrat('coeur-decision-fonda/v1', p.decision.coeur));
} catch (e) { identique = false; } // fichier existant non conforme : jamais « même résultat »
const base = { set_id: p.decision.set_id, nonce: p.decision.nonce, generation: p.generation, decision_fichier_id: a.fichier_id };
return [{ json: { resultat: identique ? { type: 'decision', ...base, decision_sha256: shaExistante, ecriture: 'existante' } : { type: 'conflit', ...base, decision_sha256: p.decision_sha256 } } }];`].join('\n\n');
}
function codeVerifierRelecture() {
  return [ENTETE('C5bis : candidat RELU juste avant l\'écriture, toujours courant (même clé, génération, en_attente, non expiré) ; sinon rejet, rien écrit.'),
    UN_ITEM(NOEUDS_CONFIRMER.verifierRelecture), DATE_ISO, CANDIDAT_COURANT,
    `const f = unItem(${JSON.stringify(NOEUDS_CONFIRMER.formulaire)});
${DEJA_REJET}
if (!candidatCourant(unItem(${JSON.stringify(NOEUDS_CONFIRMER.relire)}), f, Date.now())) return rejet('C5bis', true);
return [{ json: { poursuivre: true, resultat: null } }];`].join('\n\n');
}
function codeVerifierEcritureDecision() {
  return [ENTETE('écriture constatée : identifiant, nom, dossier et propriétés attendus ; decision_sha256 = décision ÉCRITE.'),
    UN_ITEM(NOEUDS_CONFIRMER.verifierEcriture),
    `const CONFIG = ${JSON.stringify({ dossierDecisions: CONFIG.dossierDecisions })};
const p = unItem(${JSON.stringify(NOEUDS_CONFIRMER.controler)});
const r = unItem(${JSON.stringify(NOEUDS_CONFIRMER.ecrire)});
const d = p.decision;
if (!r || typeof r.id !== 'string' || !r.id || r.name !== p.depot.nom || !Array.isArray(r.parents) || r.parents.length !== 1 || r.parents[0] !== CONFIG.dossierDecisions
  || !r.properties || r.properties.fonda_set_id !== d.set_id || r.properties.fonda_nonce !== d.nonce) throw new Error('décision non écrite ou écrite ailleurs');
return [{ json: { resultat: { type: 'decision', set_id: d.set_id, nonce: d.nonce, generation: p.generation, decision_fichier_id: r.id, decision_sha256: p.decision_sha256, ecriture: 'creee' } } }];`].join('\n\n');
}
function codeSortieConfirmation() {
  return [ENTETE('sortie OBSERVÉE confirmation-fonda/v1 (forme exacte du consommateur gelé, §21.1) ; jamais k, jeton ni choix.'),
    UN_ITEM(NOEUDS_CONFIRMER.sortie),
    `const MOTIFS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C5bis'];
const e = unItem(${JSON.stringify(NOEUDS_CONFIRMER.entree)});
const x = unItem(null).resultat;
if (!x || typeof x !== 'object') throw new Error('résultat de confirmation absent');
const s = { schema: 'confirmation-fonda/v1', type: x.type, set_id: null, nonce: null, generation: null, decision_fichier_id: null, decision_sha256: null, ecriture: null, motif: null };
if (x.type === 'rejet') {
  if (!MOTIFS.includes(x.motif)) throw new Error('motif de rejet inconnu');
  if (x.set_id !== null || x.nonce !== null) {
    if (x.set_id !== e.lot || x.nonce !== e.nonce) throw new Error('rejet : lot ou nonce ≠ entrée');
    s.set_id = x.set_id; s.nonce = x.nonce;
  }
  s.motif = x.motif;
} else if (x.type === 'decision' || x.type === 'conflit') {
  if (x.set_id !== e.lot || x.nonce !== e.nonce || !Number.isSafeInteger(x.generation) || x.generation < 1 || typeof x.decision_fichier_id !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(x.decision_sha256)) throw new Error('sortie ' + x.type + ' incohérente');
  Object.assign(s, { set_id: x.set_id, nonce: x.nonce, generation: x.generation, decision_fichier_id: x.decision_fichier_id, decision_sha256: x.decision_sha256 });
  if (x.type === 'decision') {
    if (x.ecriture !== 'creee' && x.ecriture !== 'existante') throw new Error('écriture inconnue');
    s.ecriture = x.ecriture;
  }
} else throw new Error('type de confirmation inconnu');
return [{ json: s }];`].join('\n\n');
}
function codePreparerReponse() {
  return [ENTETE('réponse HTTP au relecteur : code (§21.1 : 200, 409, 400/403/410) et page sans donnée du lot.'),
    UN_ITEM(NOEUDS_CONFIRMER.reponse),
    `const CODES = ${JSON.stringify(CODES_HTTP)};
const s = unItem(${JSON.stringify(NOEUDS_CONFIRMER.sortie)});
const code = s.type === 'rejet' ? CODES[s.motif] : CODES[s.type];
const messages = {
  decision: 'Votre relecture est enregistrée. Merci ! Vous pouvez fermer cette page.',
  conflit: 'Une autre réponse a déjà été enregistrée pour ce formulaire : rien n\\'a été modifié. Prévenez Éric Duchateau.',
  C1: 'Formulaire incomplet ou mal formé : rien n\\'a été enregistré. Rouvrez le lien reçu par courriel.',
  C2: 'Formulaire non reconnu : rien n\\'a été enregistré. Rouvrez le lien reçu par courriel.',
  C3: 'Ce lien n\\'est plus valable (relecture close, lien remplacé ou expiré) : rien n\\'a été enregistré.',
  C4: 'Le lot a changé depuis l\\'affichage : rien n\\'a été enregistré. Rouvrez le lien reçu par courriel.',
  C5: 'Chaque carte doit avoir un choix (ou utilisez « Tout rejeter ») : rien n\\'a été enregistré.',
  C5bis: 'Ce lien vient d\\'être remplacé ou clos : rien n\\'a été enregistré.',
};
const texte = messages[s.type === 'rejet' ? s.motif : s.type];
const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<meta http-equiv="Content-Security-Policy" content="default-src \\'none\\'; style-src \\'unsafe-inline\\'; base-uri \\'none\\'; form-action \\'none\\'">'
  + '<title>Relecture FONDA</title></head><body style="font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem"><p>' + texte + '</p></body></html>';
return [{ json: { code, html, notifier: s.type === 'decision' && s.ecriture === 'creee' } }];`].join('\n\n');
}
// C7 : notification à Éric (clôtureur) d'une décision CRÉÉE. NON BLOQUANTE : la réponse est déjà envoyée,
// chaque nœud du courriel est en « continueErrorOutput » et ce code ne lève jamais (une panne de courriel
// ne doit pas rendre « error » une confirmation écrite : E4 abandonnerait le lot).
function codePreparerNotification() {
  return [ENTETE('C7 : courriel de notification à Éric (adresse lue dans la Data Table, clé « eric ») ; ne lève jamais.'),
    `let sortie = { envoyer: false, raw: null };
try {
  const s = $(${JSON.stringify(NOEUDS_CONFIRMER.sortie)}).first().json;
  const t = $input.first().json;
  const lignes = Array.isArray(t.data) ? t.data.filter((l) => l && l.relecteur_attribue === 'eric') : [];
  if (lignes.length === 1 && typeof lignes[0].adresse === 'string' && /^[^@\\s]+@[^@\\s]+$/.test(lignes[0].adresse)) {
    const message = ['To: ' + lignes[0].adresse, 'Subject: Relecture FONDA ' + s.set_id + ' : décision reçue', 'Content-Type: text/plain; charset=UTF-8', '',
      'Une décision de relecture a été enregistrée pour ' + s.set_id + ' (génération ' + s.generation + ').', 'Clôture technique et signature : CLI local.'].join('\\r\\n');
    const o = []; for (const ch of message) { const c = ch.codePointAt(0); if (c < 0x80) o.push(c); else if (c < 0x800) o.push(0xc0 | (c >> 6), 0x80 | (c & 63)); else if (c < 0x10000) o.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); else o.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let raw = '';
    for (let i = 0; i < o.length; i += 3) { const n = (o[i] << 16) | ((o[i + 1] || 0) << 8) | (o[i + 2] || 0); raw += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < o.length ? A[(n >> 6) & 63] : '') + (i + 2 < o.length ? A[n & 63] : ''); }
    sortie = { envoyer: true, raw };
  }
} catch (e) { sortie = { envoyer: false, raw: null }; }
return [{ json: sortie }];`].join('\n\n');
}
function construireConfirmer() {
  const N = NOEUDS_CONFIRMER;
  const lotExpr = `$('${N.formulaire}').first().json.lot`;
  const nonceExpr = `$('${N.formulaire}').first().json.nonce`;
  const sansErreur = (n) => ({ ...n, onError: 'continueErrorOutput' });
  const noeuds = [
    { name: N.webhook, type: 'n8n-nodes-base.webhook', typeVersion: 2, webhookId: uuid('webhook-confirmer'),
      parameters: { httpMethod: 'POST', path: CONFIG.cheminConfirmer, responseMode: 'responseNode', options: {} } },
    code(N.entree, codeEntreeConfirmation()),
    code(N.formulaire, codeVerifierFormulaire()),
    siBooleen(N.siFormulaire, 'poursuivre', 'si-formulaire'),
    listing(N.chercher, `={{ "'${CONFIG.dossierRelecture}' in parents and trashed = false and name = '" + ${lotExpr} + ".candidat.json'" }}`, CHAMPS_LISTE, false),
    code(N.verifierListe, codeVerifierRechercheConfirmation()),
    siBooleen(N.siCandidat, 'poursuivre', 'si-candidat'),
    contenuDrive(N.lire, `$('${N.verifierListe}').first().json.fichier_id`),
    code(N.controler, codeControlerCandidat()),
    siBooleen(N.siDecision, 'poursuivre', 'si-decision'),
    // Corbeille COMPRISE : un fichier de même nom à la corbeille existe toujours (C6).
    listing(N.chercherDecision, `={{ "'${CONFIG.dossierDecisions}' in parents and name = '" + ${lotExpr} + "-" + ${nonceExpr} + ".json'" }}`, CHAMPS_LISTE, false),
    code(N.analyserDecision, codeAnalyserDecision()),
    siBooleen(N.siExistante, 'existante', 'si-existante'),
    contenuDrive(N.lireDecision, `$('${N.analyserDecision}').first().json.fichier_id`),
    code(N.comparer, codeComparerDecision()),
    contenuDrive(N.relire, `$('${N.verifierListe}').first().json.fichier_id`),
    code(N.verifierRelecture, codeVerifierRelecture()),
    siBooleen(N.siRelecture, 'poursuivre', 'si-relecture'),
    drive(N.ecrire, {
      method: 'POST', url: 'https://www.googleapis.com/upload/drive/v3/files',
      sendQuery: true, queryParameters: { parameters: [{ name: 'uploadType', value: 'multipart' }, { name: 'fields', value: 'id,name,parents,properties' }] },
      sendBody: true, contentType: 'raw', rawContentType: `={{ 'multipart/related; boundary=' + $('${N.controler}').first().json.depot.frontiere }}`, body: `={{ $('${N.controler}').first().json.depot.corps }}`,
      options: { timeout: 60000 },
    }),
    code(N.verifierEcriture, codeVerifierEcritureDecision()),
    code(N.sortie, codeSortieConfirmation()),
    code(N.reponse, codePreparerReponse()),
    { name: N.repondre, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1,
      parameters: { respondWith: 'text', responseBody: '={{ $json.html }}', options: { responseCode: '={{ $json.code }}',
        responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }, { name: 'Referrer-Policy', value: 'no-referrer' }] } } } },
    siBooleen(N.siNotifier, 'notifier', 'si-notifier'),
    sansErreur({ name: N.adresse, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, retryOnFail: false,
      credentials: { httpHeaderAuth: CONFIG.credentialApiN8n },
      parameters: { url: `${CONFIG.urlN8n}/api/v1/data-tables/${CONFIG.tableRelecteurs}/rows`, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', options: { timeout: 30000 } } }),
    code(N.courriel, codePreparerNotification()),
    siBooleen(N.siEnvoyer, 'envoyer', 'si-envoyer'),
    sansErreur({ name: N.envoyer, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, retryOnFail: false,
      credentials: { gmailOAuth2: CONFIG.credentialGmail },
      parameters: { method: 'POST', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', authentication: 'predefinedCredentialType', nodeCredentialType: 'gmailOAuth2',
        sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ raw: $json.raw }) }}', options: { timeout: 30000 } } }),
  ].map(positionner('confirmer'));
  const connections = lineaire([N.webhook, N.entree, N.formulaire, N.siFormulaire]);
  connections[N.siFormulaire] = { main: [lien(N.chercher), lien(N.sortie)] };
  Object.assign(connections, lineaire([N.chercher, N.verifierListe, N.siCandidat]));
  connections[N.siCandidat] = { main: [lien(N.lire), lien(N.sortie)] };
  Object.assign(connections, lineaire([N.lire, N.controler, N.siDecision]));
  connections[N.siDecision] = { main: [lien(N.chercherDecision), lien(N.sortie)] };
  Object.assign(connections, lineaire([N.chercherDecision, N.analyserDecision, N.siExistante]));
  connections[N.siExistante] = { main: [lien(N.lireDecision), lien(N.relire)] };
  Object.assign(connections, lineaire([N.lireDecision, N.comparer, N.sortie]), lineaire([N.relire, N.verifierRelecture, N.siRelecture]));
  connections[N.siRelecture] = { main: [lien(N.ecrire), lien(N.sortie)] };
  Object.assign(connections, lineaire([N.ecrire, N.verifierEcriture, N.sortie]), lineaire([N.sortie, N.reponse, N.repondre, N.siNotifier]));
  connections[N.siNotifier] = { main: [lien(N.adresse), []] };
  Object.assign(connections, lineaire([N.adresse, N.courriel, N.siEnvoyer]));
  connections[N.siEnvoyer] = { main: [lien(N.envoyer), []] };
  return { name: CONFIG.nomConfirmer, nodes: noeuds, connections, settings: { ...REGLAGES, executionTimeout: 120 } };
}

module.exports = { CONFIG, MODULES, NOEUDS_CLOTURER, NOEUDS_EMETTRE, NOEUDS_CONFIRMER, CODES_HTTP, CHAMPS_FORMULAIRE, COMMUN_PAGE, chargerCommun,
  construireCloturer, construireEmettre, construireConfirmer };

const CONSTRUCTEURS = { '--emettre': construireEmettre, '--cloturer': construireCloturer, '--confirmer': construireConfirmer };
if (require.main === module) {
  const option = Object.keys(CONSTRUCTEURS).find((o) => process.argv.includes(o));
  if (!option) { process.stderr.write(`usage : construire-relecture.js ${Object.keys(CONSTRUCTEURS).join(' | ')}\n`); process.exitCode = 1; } else process.stdout.write(`${JSON.stringify(CONSTRUCTEURS[option](), null, 2)}\n`);
}
