#!/usr/bin/env node
// Construction des workflows n8n du parcours PAGE, P3 (CDC relecture §21.0, §21.1, §21.5, §21.9) :
//   « FONDA - Emettre relecture »  : candidat-fonda/v1 (clé k, seul cle_sha256 stocké) + lien au relecteur ;
//   « FONDA - Cloturer relecture » : clôture technique (statut clos, PREMIER clos_le), sortie OBSERVÉE
//                                    cloture-fonda/v1 consommée par rattachement-page.js (GELÉ, P1).
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
// Usage : node n8n/fonda-relecture-page/construire-relecture.js --emettre | --cloturer > export.json

'use strict';

const crypto = require('crypto');
const C = require('../../fonda/engine/catalogue.js');
const R = require('../../fonda/scripts/rattachement-page.js');
const { OUTILS } = require('../fonda-generation-ia/construire-workflow.js');

// --- Configuration (valeurs de remplacement, renseignées en P4) ------------------------------
const P4 = (nom) => `A_RENSEIGNER_P4_${nom}`;
const CONFIG = Object.freeze({
  nomEmettre: 'FONDA - Emettre relecture',
  nomCloturer: 'FONDA - Cloturer relecture',
  cheminEmettre: P4('CHEMIN_EMETTRE'),
  cheminCloturer: P4('CHEMIN_CLOTURER'),
  depot: 'ericduchateau/box',
  dossierCandidats: '1Ir-iJGZoSk5_FmJ9dnf_PM-NEBZWyn8d', // lot source immuable (génération, §20.4)
  dossierRelecture: P4('DOSSIER_RELECTURE'), // relecture/<set_id>.candidat.json (enveloppe mutable)
  dossierDecisions: P4('DOSSIER_DECISIONS'), // decisions/ (écrit par Confirmer, P2)
  urlN8n: 'https://n8n.srv868991.hstgr.cloud',
  tableRelecteurs: P4('ID_DATA_TABLE_RELECTEURS'), // Data Table : relecteur_attribue -> adresse (jamais dans le dépôt)
  urlPage: P4('URL_PAGE_RELECTURE'), // …/webhook/<chemin> de « FONDA - Page relecture » (P2)
  dureeCleJours: 14,
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
  lire: 'Lire candidat',
  preparer: 'Preparer cloture',
  siDejaClos: 'Deja clos ?',
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
  chercherLot: 'Chercher lot source',
  lireLot: 'Lire lot source',
  existant: 'Chercher candidat existant',
  cle: 'Generer cle',
  preparer: 'Preparer candidat',
  ecrire: 'FONDA Ecrire candidat',
  adresse: 'Lire adresse relecteur',
  courriel: 'Preparer courriel',
  envoyer: 'Envoyer lien',
  sortie: 'FONDA Sortie emission',
});

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

// --- Nœuds HTTP communs ----------------------------------------------------------------------
const PAGINATION_DRIVE = { pagination: {
  paginationMode: 'updateAParameterInEachRequest',
  parameters: { parameters: [{ type: 'qs', name: 'pageToken', value: '={{ $response.body.nextPageToken }}' }] },
  paginationCompleteWhen: 'other',
  completeExpression: '={{ !$response.body.nextPageToken }}',
  limitPagesFetched: true,
  maxRequests: 50,
} };
const drive = (nom, parametres) => ({
  name: nom, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, retryOnFail: false,
  credentials: { googleDriveOAuth2Api: CONFIG.credentialDrive },
  parameters: { authentication: 'predefinedCredentialType', nodeCredentialType: 'googleDriveOAuth2Api', ...parametres },
});
const listing = (nom, q, champs, pagine) => drive(nom, {
  url: 'https://www.googleapis.com/drive/v3/files',
  sendQuery: true,
  queryParameters: { parameters: [{ name: 'q', value: q }, { name: 'fields', value: champs }, { name: 'pageSize', value: '100' }] },
  options: pagine ? { pagination: PAGINATION_DRIVE, timeout: 30000 } : { timeout: 30000 },
});
const contenuDrive = (nom, expressionId) => drive(nom, {
  url: `={{ 'https://www.googleapis.com/drive/v3/files/' + ${expressionId} }}`,
  sendQuery: true, queryParameters: { parameters: [{ name: 'alt', value: 'media' }] },
  options: { timeout: 30000 },
});
const webhook = (nom, chemin, credential, graine) => ({
  name: nom, type: 'n8n-nodes-base.webhook', typeVersion: 2, webhookId: uuid(graine),
  credentials: { httpHeaderAuth: credential },
  parameters: { httpMethod: 'POST', path: chemin, authentication: 'headerAuth', options: {} },
});
const code = (nom, jsCode) => ({ name: nom, type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode } });
const lineaire = (noms) => {
  const c = {};
  for (let i = 0; i < noms.length - 1; i += 1) c[noms[i]] = { main: [[{ node: noms[i + 1], type: 'main', index: 0 }]] };
  return c;
};
const REGLAGES = { executionOrder: 'v1', saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all', saveManualExecutions: true, saveExecutionProgress: true, timezone: 'Europe/Paris' };

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
    UN_ITEM(NOEUDS_CLOTURER.preparer),
    `const setId = unItem(${JSON.stringify(NOEUDS_CLOTURER.valider)}).set_id;
const liste = unItem(${JSON.stringify(NOEUDS_CLOTURER.chercher)});
if (!Array.isArray(liste.files) || liste.nextPageToken || liste.incompleteSearch) throw new Error('recherche du candidat inexploitable ou incomplète');
if (liste.files.length !== 1) throw new Error(liste.files.length + ' candidat(s) « ' + setId + '.candidat.json » : exactement un attendu');
const fichier = liste.files[0];
const c = unItem(${JSON.stringify(NOEUDS_CLOTURER.lire)});
if (!c || c.schema !== 'candidat-fonda/v1' || !c.lot || !c.relecture || c.lot.set_id !== setId) throw new Error('candidat non conforme');
const rel = c.relecture;
let dejaClos;
if (rel.statut === 'clos') {
  if (typeof rel.clos_le !== 'string') throw new Error('candidat clos sans clos_le');
  dejaClos = true;
} else if (rel.statut === 'en_attente') {
  if (rel.clos_le !== null) throw new Error('candidat en_attente avec clos_le');
  dejaClos = false;
} else throw new Error('statut « ' + rel.statut + ' » : clôture impossible');
const nouveau = dejaClos ? null : JSON.stringify({ schema: c.schema, lot: c.lot, relecture: { ...rel, statut: 'clos', clos_le: new Date().toISOString() } }, null, 2) + '\\n';
return [{ json: { set_id: setId, fichier_id: fichier.id, deja_clos: dejaClos, contenu: nouveau } }];`].join('\n\n');
}
function codeSortieCloture() {
  return [ENTETE('sortie OBSERVÉE cloture-fonda/v1 (forme exacte du consommateur gelé, §21.1).'),
    UN_ITEM(NOEUDS_CLOTURER.sortie),
    `const p = unItem(${JSON.stringify(NOEUDS_CLOTURER.preparer)});
const relu = unItem(${JSON.stringify(NOEUDS_CLOTURER.relire)});
if (!relu || !relu.relecture || relu.relecture.statut !== 'clos' || typeof relu.relecture.clos_le !== 'string') throw new Error('candidat relu non clos');
const pagesDec = $(${JSON.stringify(NOEUDS_CLOTURER.decisions)}).all().map((i) => i.json);
let n = 0; let incomplet = false;
for (const pg of pagesDec) {
  if (!pg || !Array.isArray(pg.files)) throw new Error('listing de decisions/ inexploitable');
  if (pg.incompleteSearch === true) incomplet = true;
  n += pg.files.length;
}
if (pagesDec.length && pagesDec[pagesDec.length - 1].nextPageToken) incomplet = true; // pagination non terminée
return [{ json: { schema: 'cloture-fonda/v1', set_id: p.set_id, clos_le: relu.relecture.clos_le, deja_clos: p.deja_clos,
  candidat_fichier_id: p.fichier_id, nb_decisions_listees: n, incomplete_search: incomplet } }];`].join('\n\n');
}
function construireCloturer() {
  const N = NOEUDS_CLOTURER;
  const setIdExpr = `$('${N.valider}').first().json.set_id`;
  const noeuds = [
    webhook(N.webhook, CONFIG.cheminCloturer, CONFIG.credentialCloturer, 'webhook-cloturer'),
    code(N.entree, codeEntreeCloture()),
    code(N.valider, codeValiderCloture()),
    listing(N.chercher, `={{ "'${CONFIG.dossierRelecture}' in parents and trashed = false and name = '" + ${setIdExpr} + ".candidat.json'" }}`, 'nextPageToken,incompleteSearch,files(id,name)', false),
    contenuDrive(N.lire, `$('${N.chercher}').first().json.files[0].id`),
    code(N.preparer, codePreparerCloture()),
    {
      name: N.siDejaClos, type: 'n8n-nodes-base.if', typeVersion: 2.2,
      parameters: { conditions: { options: { caseSensitive: true, typeValidation: 'strict', version: 2 }, combinator: 'and',
        conditions: [{ id: uuid('si-deja-clos'), leftValue: '={{ $json.deja_clos }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }] }, options: {} },
    },
    drive(N.ecrire, {
      method: 'PATCH', url: `={{ 'https://www.googleapis.com/upload/drive/v3/files/' + $json.fichier_id }}`,
      sendQuery: true, queryParameters: { parameters: [{ name: 'uploadType', value: 'media' }] },
      sendBody: true, contentType: 'raw', rawContentType: 'application/json; charset=UTF-8', body: '={{ $json.contenu }}',
      options: { timeout: 30000 },
    }),
    contenuDrive(N.relire, `$('${N.preparer}').first().json.fichier_id`),
    // TOUT le lot dans decisions/, corbeille COMPRISE, pagination complète (§9, §21.1).
    listing(N.decisions, `={{ "'${CONFIG.dossierDecisions}' in parents and (name contains '" + ${setIdExpr} + "-' or properties has { key='fonda_set_id' and value='" + ${setIdExpr} + "' })" }}`, 'nextPageToken,incompleteSearch,files(id,name)', true),
    code(N.sortie, codeSortieCloture()),
  ].map((n, i) => ({ id: uuid(`cloturer:${n.name}`), position: [i * 220, 0], ...n }));
  const connections = lineaire([N.webhook, N.entree, N.valider, N.chercher, N.lire, N.preparer, N.siDejaClos]);
  connections[N.siDejaClos] = { main: [[{ node: N.relire, type: 'main', index: 0 }], [{ node: N.ecrire, type: 'main', index: 0 }]] };
  Object.assign(connections, lineaire([N.ecrire, N.relire, N.decisions, N.sortie]));
  return { name: CONFIG.nomCloturer, nodes: noeuds, connections, settings: REGLAGES };
}

// ═══ ÉMETTRE (non observé ; le candidat fait foi) ═══
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
function codePreparerCandidat() {
  return [ENTETE('candidat-fonda/v1 : relecteur du référentiel ARCHIVÉ, moteur du registre, k -> SEUL cle_sha256 stocké.'),
    UN_ITEM(NOEUDS_EMETTRE.preparer), OUTILS,
    `const CONFIG = ${JSON.stringify({ dossierRelecture: CONFIG.dossierRelecture, dureeCleJours: CONFIG.dureeCleJours })};
const e = unItem(${JSON.stringify(NOEUDS_EMETTRE.entree)});
// Référentiel au commit consigné : octets exacts, SHA-256 = referentiel_version annoncée.
const ref = fichierDepot(${JSON.stringify(NOEUDS_EMETTRE.referentiel)}, 'fonda/data/referentiel.json');
if ('sha256:' + sha256Hex(ref.octets) !== e.referentiel_version) throw new Error('référentiel au commit ≠ referentiel_version annoncée');
const referentiel = JSON.parse(ref.texte);
const slug = e.set_id.replace(/^set_fonda_/, '').replace(/_n[IF]_[0-9]{2}$/, '');
const notions = (referentiel.notions || []).filter((n) => n && typeof n.id === 'string' && n.id.split('.').slice(1).join('.') === slug);
if (notions.length !== 1) throw new Error('notion du set_id introuvable ou ambiguë au référentiel archivé');
const relecteur = notions[0].relecteur;
if (typeof relecteur !== 'string' || !relecteur) throw new Error('relecteur attribué absent au référentiel archivé');
const reg = JSON.parse(fichierDepot(${JSON.stringify(NOEUDS_EMETTRE.moteurs)}, 'fonda/engine/moteurs.json').texte);
const ligne = Array.isArray(reg) ? reg.filter((l) => l && l.version === e.moteur.version) : [];
if (ligne.length !== 1 || ligne[0].sha256 !== e.moteur.sha256) throw new Error('moteur absent du registre au commit consigné');
// Lot source (immuable) et absence de candidat existant (émission initiale seulement).
const lots = unItem(${JSON.stringify(NOEUDS_EMETTRE.chercherLot)});
if (!Array.isArray(lots.files) || lots.files.length !== 1 || lots.nextPageToken || lots.incompleteSearch) throw new Error('lot source introuvable, ambigu ou recherche incomplète');
const lot = unItem(${JSON.stringify(NOEUDS_EMETTRE.lireLot)});
if (!lot || lot.schema !== 'lot-fonda/v1' || lot.set_id !== e.set_id) throw new Error('lot source non conforme');
const existants = unItem(${JSON.stringify(NOEUDS_EMETTRE.existant)});
if (!Array.isArray(existants.files) || existants.nextPageToken || existants.incompleteSearch) throw new Error('recherche du candidat existant inexploitable');
if (existants.files.length !== 0) throw new Error('candidat déjà émis : la réémission (sans décision) est un autre chemin');
const k = unItem(${JSON.stringify(NOEUDS_EMETTRE.cle)}).k;
if (typeof k !== 'string' || !/^[0-9a-f]{64}$/.test(k)) throw new Error('clé k : 64 hex attendus (32 octets)');
const maintenant = new Date();
const creeLe = maintenant.toISOString();
const expireLe = new Date(maintenant.getTime() + CONFIG.dureeCleJours * 86400000).toISOString();
const candidat = { schema: 'candidat-fonda/v1', lot, relecture: {
  statut: 'en_attente', generation_cle: 1, cle_sha256: sha256Hex(octetsUtf8(k)), cree_le: creeLe, expire_le: expireLe, clos_le: null,
  relecteur_attribue: relecteur, referentiel_version: e.referentiel_version, moteur: e.moteur,
  envois: [{ generation_cle: 1, envoye_a: relecteur, le: creeLe }] } };
const contenu = JSON.stringify(candidat, null, 2) + '\\n';
const nom = e.set_id + '.candidat.json';
const metadonnees = { name: nom, parents: [CONFIG.dossierRelecture], mimeType: 'application/json', properties: { fonda_set_id: e.set_id } };
const frontiere = 'fonda-' + sha256Hex(octetsUtf8(contenu)).slice(0, 32);
const corps = '--' + frontiere + '\\r\\nContent-Type: application/json; charset=UTF-8\\r\\n\\r\\n' + JSON.stringify(metadonnees)
  + '\\r\\n--' + frontiere + '\\r\\nContent-Type: application/json; charset=UTF-8\\r\\n\\r\\n' + contenu + '\\r\\n--' + frontiere + '--\\r\\n';
// k ne sort de ce nœud QUE vers le courriel (jamais stocké, jamais en sortie du workflow).
return [{ json: { set_id: e.set_id, relecteur, k, depot: { nom, frontiere, corps } } }];`].join('\n\n');
}
function codeCourriel() {
  return [ENTETE('courriel au relecteur : adresse lue dans la Data Table (clé = relecteur_attribue), lien …?lot=&k=.'),
    UN_ITEM(NOEUDS_EMETTRE.courriel),
    `const CONFIG = ${JSON.stringify({ urlPage: CONFIG.urlPage })};
const p = unItem(${JSON.stringify(NOEUDS_EMETTRE.preparer)});
const ecrit = unItem(${JSON.stringify(NOEUDS_EMETTRE.ecrire)});
if (!ecrit || typeof ecrit.id !== 'string' || ecrit.name !== p.depot.nom) throw new Error('candidat non écrit');
const t = unItem(${JSON.stringify(NOEUDS_EMETTRE.adresse)});
const lignes = Array.isArray(t.data) ? t.data.filter((l) => l && l.relecteur_attribue === p.relecteur) : [];
if (lignes.length !== 1 || typeof lignes[0].adresse !== 'string' || !/^[^@\\s]+@[^@\\s]+$/.test(lignes[0].adresse)) throw new Error('adresse du relecteur introuvable ou ambiguë dans la Data Table');
const lien = CONFIG.urlPage + '?lot=' + encodeURIComponent(p.set_id) + '&k=' + p.k;
const message = ['To: ' + lignes[0].adresse, 'Subject: Relecture FONDA ' + p.set_id, 'Content-Type: text/plain; charset=UTF-8', '',
  'Bonjour,', '', 'Une fiche FONDA est à relire, carte par carte :', lien, '', 'Le lien expire dans 14 jours.'].join('\\r\\n');
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
const ecrit = unItem(${JSON.stringify(NOEUDS_EMETTRE.ecrire)});
const envoi = unItem(${JSON.stringify(NOEUDS_EMETTRE.envoyer)});
if (!envoi || typeof envoi.id !== 'string') throw new Error('courriel non envoyé');
return [{ json: { schema: 'emission-fonda/v1', set_id: p.set_id, candidat_fichier_id: ecrit.id, relecteur_attribue: p.relecteur } }];`].join('\n\n');
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
    listing(N.chercherLot, `={{ "'${CONFIG.dossierCandidats}' in parents and trashed = false and name = '" + ${setIdExpr} + ".lot.json'" }}`, 'nextPageToken,incompleteSearch,files(id,name)', false),
    contenuDrive(N.lireLot, `$('${N.chercherLot}').first().json.files[0].id`),
    listing(N.existant, `={{ "'${CONFIG.dossierRelecture}' in parents and name = '" + ${setIdExpr} + ".candidat.json'" }}`, 'nextPageToken,incompleteSearch,files(id,name)', false),
    // Crypto v1 « Generate » (§6) : 32 octets aléatoires, hex 64 -> champ k.
    { name: N.cle, type: 'n8n-nodes-base.crypto', typeVersion: 1, parameters: { action: 'generate', dataPropertyName: 'k', encodingType: 'hex', stringLength: 64 } },
    code(N.preparer, codePreparerCandidat()),
    drive(N.ecrire, {
      method: 'POST', url: 'https://www.googleapis.com/upload/drive/v3/files',
      sendQuery: true, queryParameters: { parameters: [{ name: 'uploadType', value: 'multipart' }, { name: 'fields', value: 'id,name,parents,properties' }] },
      sendBody: true, contentType: 'raw', rawContentType: '={{ \'multipart/related; boundary=\' + $json.depot.frontiere }}', body: '={{ $json.depot.corps }}',
      options: { timeout: 60000 },
    }),
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
  ].map((n, i) => ({ id: uuid(`emettre:${n.name}`), position: [i * 220, 0], ...n }));
  return { name: CONFIG.nomEmettre, nodes: noeuds, connections: lineaire(noeuds.map((n) => n.name)), settings: REGLAGES };
}

module.exports = { CONFIG, NOEUDS_CLOTURER, NOEUDS_EMETTRE, construireCloturer, construireEmettre };

if (require.main === module) {
  const wf = process.argv.includes('--emettre') ? construireEmettre() : process.argv.includes('--cloturer') ? construireCloturer() : null;
  if (!wf) { process.stderr.write('usage : construire-relecture.js --emettre | --cloturer\n'); process.exitCode = 1; } else process.stdout.write(`${JSON.stringify(wf, null, 2)}\n`);
}
