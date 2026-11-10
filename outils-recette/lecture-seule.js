'use strict';
// Transport HTTP en LECTURE SEULE pour la recette P4 (CDC relecture §13, §21.3). Règle : tout ce qui peut
// atteindre l'instance appartient à un ENSEMBLE FERMÉ de connu-bon, jamais une denylist ni une grammaire
// permissive :
//   - instance : liste fermée d'origines HTTPS (INSTANCES) ;
//   - requête : GET sans corps, sans redirection, en-têtes en liste fermée (clé d'API en grammaire bornée,
//     accept = application/json) ;
//   - route : liste fermée (ROUTES), chacune avec sa liste fermée de paramètres de requête (clé, grammaire de
//     valeur, au plus une occurrence, présence obligatoire ou non). Un curseur de pagination renvoyé par le
//     serveur (nextCursor) hors grammaire est donc REFUSÉ avant la requête suivante ;
//   - erreurs : codes d'une liste fermée (ErreurOutil) ; le texte affiché est RECONSTRUIT de composants validés
//     (jamais e.message d'un tiers, jamais un extrait de réponse). Code HTTP : 3 chiffres validés.

const INSTANCES = Object.freeze(['https://n8n.srv868991.hstgr.cloud']);
const ID_WORKFLOW = /^[A-Za-z0-9]{1,40}$/;
const ID_EXECUTION = /^[0-9]{1,20}$/;
const CURSEUR = /^[A-Za-z0-9+/=_-]{1,512}$/;
const CLE_API = /^[A-Za-z0-9._-]{16,4096}$/;

const ROUTES = Object.freeze([
  { nom: 'liste-executions', chemin: /^\/api\/v1\/executions$/, params: {
    workflowId: { re: ID_WORKFLOW, requis: true }, status: { valeurs: ['running', 'waiting'] }, limit: { valeurs: ['250'], requis: true }, cursor: { re: CURSEUR } } },
  { nom: 'detail-execution', chemin: /^\/api\/v1\/executions\/[0-9]{1,20}$/, params: { includeData: { valeurs: ['true'], requis: true } } },
  { nom: 'export-workflow', chemin: /^\/api\/v1\/workflows\/[A-Za-z0-9]{1,40}$/, params: {} },
]);

// Messages : liste FERMÉE, indexée par code.
const MESSAGES = Object.freeze({
  INSTANCE: 'lecture seule : instance hors liste fermée (HTTPS, origine exacte)',
  METHODE: 'lecture seule : méthode refusée (GET seulement)',
  CORPS: 'lecture seule : corps de requête refusé',
  URL: 'lecture seule : URL de requête invalide',
  ORIGINE: 'lecture seule : origine refusée',
  ROUTE: 'lecture seule : route hors liste fermée',
  PARAMETRE: 'lecture seule : paramètre de requête hors liste fermée',
  ENTETES: 'lecture seule : en-têtes hors liste fermée',
  TRANSPORT: 'lecture seule : échec du transport',
  JSON: 'lecture seule : réponse JSON illisible',
  CLE: 'clé d\'API absente ou hors grammaire (variable FONDA_N8N_CLE_RECETTE ; jamais en argument ni dans le dépôt)',
  FETCH: 'lecture seule : fetch absent',
  WORKFLOW_ID: 'workflowId invalide',
  EXECUTION_ID: 'identifiant d\'exécution invalide',
  OPTION_INCONNUE: 'option inconnue',
  OPTION_DOUBLE: 'option en double',
  OPTION_VALEUR: 'valeur d\'option absente',
  POSITIONNELS: 'nombre d\'arguments positionnels incorrect',
  EXPORT_HORS_LISTE: 'export de référence hors liste fermée (4 exports de recette)',
  EXPORT_ILLISIBLE: 'export du dépôt illisible',
  REPONSE: 'réponse de l\'API hors schéma attendu',
  IDENTITE: 'réponse de l\'API : identifiant ≠ identifiant demandé',
  HTTP: 'API n8n : HTTP',
});
class ErreurOutil extends Error {
  constructor(code, http = null) {
    if (!Object.prototype.hasOwnProperty.call(MESSAGES, code)) throw new TypeError('code d\'erreur hors liste fermée');
    super(MESSAGES[code]);
    this.code = code;
    this.http = Number.isInteger(http) && http >= 100 && http <= 599 ? http : null;
  }
}
// Texte affichable : reconstruit du code (liste fermée) ou du seul statut HTTP validé ; sinon marqueur.
function messageSur(e) {
  if (e instanceof ErreurOutil) return e.code === 'HTTP' ? (e.http === null ? 'API n8n : HTTP (statut hors grammaire)' : `API n8n : HTTP ${e.http}`) : MESSAGES[e.code];
  if (e && e.name === 'ErreurAdaptateur' && Number.isInteger(e.statut) && e.statut >= 100 && e.statut <= 599) return `API n8n : HTTP ${e.statut}`; // ErreurAdaptateur (adaptateurs-production.js)
  return 'erreur (message non affichable)';
}

function origineInstance(url) {
  let u;
  try { u = new URL(String(url)); } catch { throw new ErreurOutil('INSTANCE'); }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '') || !INSTANCES.includes(u.origin)) throw new ErreurOutil('INSTANCE');
  return u.origin;
}
function verifierParametres(route, recherche) {
  const vus = new Set();
  for (const [cle, valeur] of recherche) {
    const spec = Object.prototype.hasOwnProperty.call(route.params, cle) ? route.params[cle] : null;
    if (!spec || vus.has(cle)) throw new ErreurOutil('PARAMETRE');
    if (spec.valeurs ? !spec.valeurs.includes(valeur) : !spec.re.test(valeur)) throw new ErreurOutil('PARAMETRE');
    vus.add(cle);
  }
  for (const [cle, spec] of Object.entries(route.params)) if (spec.requis && !vus.has(cle)) throw new ErreurOutil('PARAMETRE');
}
function verifierEntetes(h) {
  if (!h || typeof h !== 'object' || Array.isArray(h)) throw new ErreurOutil('ENTETES');
  const cles = Object.keys(h).sort();
  if (cles.join(',') !== 'X-N8N-API-KEY,accept' || typeof h['X-N8N-API-KEY'] !== 'string' || !CLE_API.test(h['X-N8N-API-KEY']) || h.accept !== 'application/json') throw new ErreurOutil('ENTETES');
  return { 'X-N8N-API-KEY': h['X-N8N-API-KEY'], accept: 'application/json' };
}
// Réponse réduite à ok, status (entier) et json() ; json() illisible -> message FIXE. Réponse 2xx TYPÉE PAR
// ROUTE : un objet simple pour les trois routes (un corps JSON null, tableau ou nombre est REPONSE : il ne doit
// jamais se confondre avec le null qu'un adaptateur renvoie pour un 404) ; route « liste » : data tableau, et
// curseur renvoyé (nextCursor) absent, nul, ou chaîne de la grammaire CURSEUR, avant que l'adaptateur ne le
// convertisse en chaîne pour la requête suivante (un tableau ['a'] deviendrait 'a').
function reponseSure(r, route) {
  const status = r && Number.isInteger(r.status) ? r.status : 0;
  return { ok: status >= 200 && status < 300, status, json: async () => {
    let j;
    try { j = await r.json(); } catch { throw new ErreurOutil('JSON'); }
    if (status < 200 || status >= 300) return j;
    if (j === null || typeof j !== 'object' || Array.isArray(j)) throw new ErreurOutil('REPONSE');
    if (route.nom === 'liste-executions') {
      if (!Array.isArray(j.data)) throw new ErreurOutil('REPONSE');
      if (!(j.nextCursor === undefined || j.nextCursor === null || (typeof j.nextCursor === 'string' && CURSEUR.test(j.nextCursor)))) throw new ErreurOutil('PARAMETRE');
    }
    return j;
  } };
}

function fetchLectureSeule({ url, fetch: f = globalThis.fetch }) {
  const origine = origineInstance(url);
  if (typeof f !== 'function') throw new ErreurOutil('FETCH');
  return async (cible, init = {}) => {
    let u;
    try { u = new URL(String(cible)); } catch { throw new ErreurOutil('URL'); }
    if (String(init.method || 'GET').toUpperCase() !== 'GET' || (init.method !== undefined && init.method !== 'GET')) throw new ErreurOutil('METHODE');
    if (init.body !== undefined && init.body !== null) throw new ErreurOutil('CORPS');
    if (u.origin !== origine || u.username || u.password || u.hash) throw new ErreurOutil('ORIGINE');
    const route = ROUTES.find((r) => r.chemin.test(u.pathname));
    if (!route) throw new ErreurOutil('ROUTE');
    verifierParametres(route, u.searchParams);
    const entetes = verifierEntetes(init.headers);
    let r;
    try { r = await f(u.href, { headers: entetes, method: 'GET', redirect: 'error' }); } catch { throw new ErreurOutil('TRANSPORT'); }
    return reponseSure(r, route);
  };
}

function cleDEnvironnement(env = process.env) {
  const c = env.FONDA_N8N_CLE_RECETTE;
  if (typeof c !== 'string' || !CLE_API.test(c)) throw new ErreurOutil('CLE');
  return c;
}

module.exports = { INSTANCES, ROUTES, MESSAGES, ErreurOutil, ID_WORKFLOW, ID_EXECUTION, CURSEUR, CLE_API, origineInstance, fetchLectureSeule, cleDEnvironnement, messageSur };
