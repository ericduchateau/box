'use strict';
// Transport HTTP en LECTURE SEULE pour la recette P4 (CDC relecture §13, §21.3) : toute requête qui
// n'est pas un GET sans corps, vers l'origine de l'instance et un chemin de la liste blanche, est
// REFUSÉE avant d'atteindre le réseau. Les redirections sont refusées (redirect: 'error').
// Aucun secret n'est journalisé : la clé d'API n'est lue que dans l'environnement et passée en en-tête.

const CHEMINS_N8N = Object.freeze([
  /^\/api\/v1\/executions$/, // liste (workflowId, status, cursor, limit)
  /^\/api\/v1\/executions\/[0-9]+$/, // détail (includeData)
  /^\/api\/v1\/workflows\/[A-Za-z0-9]+$/, // export du workflow (comparaison dépôt <-> live)
]);

function fetchLectureSeule({ url, fetch: f = globalThis.fetch, chemins = CHEMINS_N8N }) {
  const origine = new URL(url).origin;
  if (typeof f !== 'function') throw new Error('lecture seule : fetch absent');
  return async (cible, init = {}) => {
    const u = new URL(String(cible));
    const methode = String(init.method || 'GET').toUpperCase();
    if (methode !== 'GET') throw new Error(`lecture seule : méthode ${methode} refusée`);
    if (init.body !== undefined && init.body !== null) throw new Error('lecture seule : corps de requête refusé');
    if (u.origin !== origine) throw new Error(`lecture seule : origine ${u.origin} refusée`);
    if (u.username || u.password) throw new Error('lecture seule : identifiants dans l\'URL refusés');
    if (!chemins.some((re) => re.test(u.pathname))) throw new Error(`lecture seule : chemin ${u.pathname} hors liste blanche`);
    return f(u.href, { headers: init.headers, method: 'GET', redirect: 'error' });
  };
}

function cleDEnvironnement(nom = 'FONDA_N8N_CLE_RECETTE', env = process.env) {
  const c = env[nom];
  if (typeof c !== 'string' || c.trim() === '') throw new Error(`clé d'API absente : variable ${nom} (jamais en argument ni dans le dépôt)`);
  return c.trim();
}

module.exports = { CHEMINS_N8N, fetchLectureSeule, cleDEnvironnement };
