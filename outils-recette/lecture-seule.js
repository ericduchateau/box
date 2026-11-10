'use strict';
// Transport HTTP en LECTURE SEULE pour la recette P4 (CDC relecture §13, §21.3) : toute requête qui
// n'est pas un GET sans corps, vers l'origine de l'instance et un chemin de la liste blanche, est
// REFUSÉE avant d'atteindre le réseau. Les redirections sont refusées (redirect: 'error').
// Aucun secret n'est journalisé : la clé d'API n'est lue que dans l'environnement et passée en en-tête.
// L'instance est en HTTPS (clé jamais en clair). Le corps d'une réponse n'apparaît JAMAIS dans un message
// d'erreur : une réponse JSON illisible donne un diagnostic FIXE (aucun extrait).

const CHEMINS_N8N = Object.freeze([
  /^\/api\/v1\/executions$/, // liste (workflowId, status, cursor, limit)
  /^\/api\/v1\/executions\/[0-9]+$/, // détail (includeData)
  /^\/api\/v1\/workflows\/[A-Za-z0-9]+$/, // export du workflow (comparaison dépôt <-> live)
]);

// Base de l'instance : https://hôte[:port] sans chemin, requête, fragment ni identifiants.
function origineInstance(url) {
  let u;
  try { u = new URL(String(url)); } catch { throw new Error('lecture seule : URL de l\'instance invalide'); }
  if (u.protocol !== 'https:') throw new Error('lecture seule : HTTPS exigé pour l\'instance');
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) throw new Error('lecture seule : URL de l\'instance = https://hôte, sans chemin ni paramètres');
  return u.origin;
}
// Réponse réduite à ok, status et json() ; json() illisible -> message FIXE (jamais d'extrait du corps).
function reponseSure(r) {
  return { ok: r.ok, status: r.status, json: async () => { try { return await r.json(); } catch { throw new Error('lecture seule : réponse JSON illisible'); } } };
}

function fetchLectureSeule({ url, fetch: f = globalThis.fetch, chemins = CHEMINS_N8N }) {
  const origine = origineInstance(url);
  if (typeof f !== 'function') throw new Error('lecture seule : fetch absent');
  return async (cible, init = {}) => {
    const u = new URL(String(cible));
    const methode = String(init.method || 'GET').toUpperCase();
    if (methode !== 'GET') throw new Error(`lecture seule : méthode ${methode} refusée`);
    if (init.body !== undefined && init.body !== null) throw new Error('lecture seule : corps de requête refusé');
    if (u.origin !== origine) throw new Error(`lecture seule : origine ${u.origin} refusée`);
    if (u.username || u.password) throw new Error('lecture seule : identifiants dans l\'URL refusés');
    if (!chemins.some((re) => re.test(u.pathname))) throw new Error(`lecture seule : chemin ${u.pathname} hors liste blanche`);
    let r;
    try { r = await f(u.href, { headers: init.headers, method: 'GET', redirect: 'error' }); } catch { throw new Error('lecture seule : échec du transport'); }
    return reponseSure(r);
  };
}

function cleDEnvironnement(nom = 'FONDA_N8N_CLE_RECETTE', env = process.env) {
  const c = env[nom];
  if (typeof c !== 'string' || c.trim() === '') throw new Error(`clé d'API absente : variable ${nom} (jamais en argument ni dans le dépôt)`);
  return c.trim();
}

// Messages d'erreur PROPRES aux outils (ensemble fermé) : seuls affichables tels quels ; tout autre
// message (venu d'un module tiers ou du réseau) est remplacé par un marqueur fixe.
const MESSAGES_SURS = new Set(['lecture seule : réponse JSON illisible', 'lecture seule : échec du transport', 'lecture seule : HTTPS exigé pour l\'instance',
  'lecture seule : URL de l\'instance invalide', 'lecture seule : URL de l\'instance = https://hôte, sans chemin ni paramètres', 'workflowId invalide', 'identifiant d\'exécution invalide',
  'option inconnue', 'option en double', 'valeur d\'option absente', '1 argument(s) positionnel(s) attendu(s)', '2 argument(s) positionnel(s) attendu(s)', '0 argument(s) positionnel(s) attendu(s)',
  'utiliser soit <workflowId>, soit --execution <id>', 'export du dépôt illisible']);
const messageSur = (e) => (e && MESSAGES_SURS.has(e.message) ? e.message : (e && /^(API n8n|lecture seule)[^:]*: HTTP [0-9]{3}$/.test(e.message) ? e.message.replace(/\(.*\)/, '').replace(/ +/g, ' ') : 'erreur (message non affichable)'));

module.exports = { CHEMINS_N8N, origineInstance, fetchLectureSeule, cleDEnvironnement, messageSur };
