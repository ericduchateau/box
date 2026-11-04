// Adaptateurs du parcours PAGE (CDC relecture §21.3, §21.8) — code page NOUVEAU, hors de
// adaptateurs-production.js (identique à l'octet). Chargé paresseusement depuis la seule
// branche page de signer-cloture.js (patch figé P1).
//
//   preLireDetails  §21.3 : détails (includeData) des exécutions TERMINALES de clôture et de
//                   confirmation, lus DANS l'intervalle du listing ; table id -> brute |
//                   INDISPONIBLE | null posée sur clotures.details / confirmations.details ;
//   lecturePage     §21.8 : lireCandidat (enveloppe candidat-fonda/v1 + identité Drive en
//                   propriété NON énumérable .drive) et listerDecisions (decisions/, corbeille
//                   comprise, pagination complète, incompleteSearch agrégé, chaque fichier lu).
// Aucun secret n'est journalisé ni affiché ; la clé k éventuellement présente dans les données
// d'exécution n'est jamais extraite (rattachement-page.js ne lit que les champs du §21.1).

'use strict';

const C = require('../engine/catalogue.js');
const L = require('./liaison-generation.js');

const STATUTS_TERMINAUX = ['success', 'error', 'crashed', 'canceled'];

// `lire(quoi, f)` : lecteur de cloturer (une panne devient un constat, jamais une absence).
async function preLireDetails({ api, lire, clotures, confirmations }) {
  for (const [quoi, groupe] of [['clôture', clotures], ['confirmation', confirmations]]) {
    const details = new Map();
    for (const x of groupe.ok ? groupe.v : (groupe.partiel || [])) {
      if (!STATUTS_TERMINAUX.includes(x.status) || details.has(x.id)) continue; // en vol : incident, examiné ailleurs
      const r = await lire(`API n8n (exécution de ${quoi} ${x.id})`, () => api.lireExecution(x.id));
      details.set(x.id, r.ok ? (r.v == null ? null : r.v) : L.INDISPONIBLE);
    }
    groupe.details = details;
  }
}

// Identité Drive posée HORS du contenu : non énumérable, ignorée par JSON.stringify, REFUSÉE par
// canonique.js (Reflect.ownKeys) et PERDUE par toute copie — à lire avant toute copie (§21.8).
function avecIdentite(enveloppe, drive) {
  Object.defineProperty(enveloppe, 'drive', { value: Object.freeze({ ...drive }), enumerable: false, writable: false, configurable: false });
  return enveloppe;
}

// Client Drive minimal (lecture seule). `jeton()` -> jeton d'accès ; dossiers épinglés en config.
function lecturePage({ jeton, fetch: f = globalThis.fetch, dossierRelecture, dossierDecisions }) {
  const API = 'https://www.googleapis.com/drive/v3/files';
  const entetes = async () => ({ authorization: `Bearer ${await jeton()}` });
  const http = async (url, quoi) => {
    const r = await f(url, { headers: await entetes() });
    if (!r.ok) { const e = new Error(`${quoi} : HTTP ${r.status}`); e.statut = r.status; throw e; }
    return r;
  };
  async function verifierDossier(id, quoi) {
    const d = await (await http(`${API}/${encodeURIComponent(id)}?fields=id,mimeType,trashed`, `Drive (${quoi})`)).json();
    if (!d || d.id !== id || d.mimeType !== 'application/vnd.google-apps.folder' || d.trashed === true) throw new Error(`Drive : ${quoi} n'est pas un dossier accessible et non supprimé`);
  }
  async function lister(q, champs) {
    const fichiers = []; let incomplet = false; const vus = new Set(); let page = null;
    for (;;) {
      const p = new URLSearchParams({ q, fields: champs, pageSize: '1000' });
      if (page) p.set('pageToken', page);
      const r = await (await http(`${API}?${p}`, 'Drive (liste)')).json();
      if (!r || !Array.isArray(r.files)) throw new Error('Drive : liste inexploitable');
      if (r.incompleteSearch === true) incomplet = true;
      fichiers.push(...r.files);
      if (!r.nextPageToken) break;
      if (vus.has(r.nextPageToken)) throw new Error('Drive : pagination en boucle');
      vus.add(r.nextPageToken); page = r.nextPageToken;
    }
    return { incompleteSearch: incomplet, files: fichiers };
  }
  const contenu = async (id, quoi) => {
    const octets = Buffer.from(await (await http(`${API}/${encodeURIComponent(id)}?alt=media`, quoi)).arrayBuffer());
    try { return JSON.parse(octets.toString('utf8')); } catch { return null; }
  };
  const setIdSur = (setId) => { if (!C.SET_ID_PATTERN.test(setId || '')) throw new Error(`set_id invalide : ${setId}`); return setId; };
  return {
    async lireCandidat(setId) {
      setIdSur(setId);
      await verifierDossier(dossierRelecture, 'relecture/');
      const r = await lister(`'${dossierRelecture}' in parents and trashed = false and name = '${setId}.candidat.json'`, 'nextPageToken,incompleteSearch,files(id,name,modifiedTime)');
      if (r.incompleteSearch) throw new Error('Drive : recherche du candidat incomplète');
      if (r.files.length === 0) return null;
      if (r.files.length > 1) throw new Error(`Drive : ${r.files.length} fichiers « ${setId}.candidat.json »`);
      const x = r.files[0];
      const env = await contenu(x.id, 'Drive (contenu du candidat)');
      if (!env || typeof env !== 'object' || Array.isArray(env)) return null;
      return avecIdentite(env, { id: x.id, nom: x.name, modifie_le: x.modifiedTime });
    },
    // TOUT decisions/ (corbeille comprise) : un fichier d'un autre lot ou illisible reste examiné (§10 B).
    async listerDecisions(setId) {
      setIdSur(setId);
      await verifierDossier(dossierDecisions, 'decisions/');
      const r = await lister(`'${dossierDecisions}' in parents`, 'nextPageToken,incompleteSearch,files(id,name,modifiedTime,properties,trashed)');
      const fichiers = [];
      for (const x of r.files) fichiers.push({ id: x.id, nom: x.name, modifie_le: x.modifiedTime, properties: x.properties || {}, corbeille: x.trashed === true, contenu: await contenu(x.id, `Drive (décision ${x.name})`) });
      return { incompleteSearch: r.incompleteSearch, fichiers };
    },
  };
}

module.exports = { preLireDetails, avecIdentite, lecturePage };
