// Adaptateurs de PRODUCTION du signataire et de l'appelant (plan étape 5, lot 5). Ils
// fournissent EXACTEMENT les dépendances que consomment saisirDecisionLocale, cloturer
// (signer-cloture.js) et declencher (verrou-generation.js) ; le cœur probant n'est pas modifié.
//
// Racines injectables (dépôt, dossier de clôture, dossier des clés, URL, transports) : les
// tests branchent des transports simulés, un disque temporaire et une clé ÉPHÉMÈRE.
// SECRETS (jamais dans le dépôt ni dans Dropbox) : ~/.fonda-cles/
//   n8n-signataire.cle         clé d'API n8n (lecture des exécutions)
//   drive-compte-service.json  compte de service Google, drive.readonly, partagé sur FONDA-Lots (D1)
//   portier.jeton              jeton X-FONDA-Token de l'appelant (portier uniquement)
//   eric-2026.priv.pem         clé privée CHIFFRÉE : lue par preparerSignataire SEULEMENT, à l'exécution
//
// Contrats (relectures Codex v1–v4 du plan) :
//   api.listerExecutions({ workflowId, status }) : liste n8n NON filtrée en statut (status=
//     masque new/crashed), filtrée en workflowId, pagination complète (nextCursor), filtre
//     côté client ; erreurs HTTP avec .statut. api.lireExecution(id) : includeData, null sur 404.
//   drive.listerCandidats() / lireLotGenere(setId) : accès au dossier VÉRIFIÉ d'abord, pagination
//     complète, incompleteSearch agrégé (OU), même dossier, trashed = false.
//   journal(commit) -> { surPremierParent, journal } ; referentielArchive(version) -> OCTETS ;
//   moteur = DESCRIPTEUR { version, sha256 } ; config.modelesAutorises = lireModelesAutorises(TEXTE).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const S = require('./attestation-signee.js');
const SC = require('./signer-cloture.js');
const L = require('./liaison-generation.js');
const RA = require('./referentiel-archive.js');
const PL = require('./publier-lot.js');
const J = require('../engine/journal-set-ids.js');
const C = require('../engine/catalogue.js');
const Canonique = require('../engine/canonique.js');

const RACINE_DEPOT = path.join(__dirname, '..', '..');
const WORKFLOW_GENERATION = 'vrqgtS5kQMvP9Ok5';
const DOSSIER_CANDIDATS = '1Ir-iJGZoSk5_FmJ9dnf_PM-NEBZWyn8d';
const URL_N8N = 'https://n8n.srv868991.hstgr.cloud';
const URL_PORTIER = `${URL_N8N}/webhook/box-fonda-generation-ia-portier`;
const CLE_ID = 'eric-2026';
const DOSSIER_CLOTURE = path.join(os.homedir(), 'FONDA-clotures');
const DOSSIER_CLES = path.join(os.homedir(), '.fonda-cles');
const sha256Hex = (b) => crypto.createHash('sha256').update(b).digest('hex');
const shaTexte = async (t) => sha256Hex(Buffer.from(t, 'utf8'));

class ErreurAdaptateur extends Error {
  constructor(message, statut) { super(message); this.name = 'ErreurAdaptateur'; if (statut !== undefined) this.statut = statut; }
}

// --- HTTP -------------------------------------------------------------------------------------
async function reponseOk(r, quoi) {
  if (!r.ok) throw new ErreurAdaptateur(`${quoi} : HTTP ${r.status}`, r.status);
  return r;
}
async function lireJsonHttp(fetchFn, url, init, quoi) { return (await reponseOk(await fetchFn(url, init), quoi)).json(); }

// --- n8n --------------------------------------------------------------------------------------
function apiN8n({ url = URL_N8N, cle, fetch: f = globalThis.fetch }) {
  if (typeof cle !== 'string' || !cle) throw new ErreurAdaptateur('clé d\'API n8n absente');
  const entetes = { 'X-N8N-API-KEY': cle, accept: 'application/json' };
  return {
    async listerExecutions({ workflowId, status }) {
      const tout = [];
      const vus = new Set();
      let curseur = null;
      for (;;) {
        const q = new URLSearchParams({ workflowId, limit: '250' });
        if (curseur) q.set('cursor', curseur);
        const r = await lireJsonHttp(f, `${url}/api/v1/executions?${q}`, { headers: entetes }, 'API n8n (exécutions)');
        if (!r || !Array.isArray(r.data)) throw new ErreurAdaptateur('API n8n : liste d\'exécutions inexploitable');
        for (const x of r.data) tout.push({ id: x.id, workflowId: x.workflowId, status: x.status, startedAt: x.startedAt ?? null, stoppedAt: x.stoppedAt ?? null });
        if (!r.nextCursor) break;
        if (vus.has(r.nextCursor)) throw new ErreurAdaptateur('API n8n : pagination en boucle');
        vus.add(r.nextCursor);
        curseur = r.nextCursor;
      }
      return status ? tout.filter((x) => x.status === status) : tout;
    },
    async lireExecution(id) {
      const r = await f(`${url}/api/v1/executions/${encodeURIComponent(id)}?includeData=true`, { headers: entetes });
      if (r.status === 404) return null;
      return (await reponseOk(r, `API n8n (exécution ${id})`)).json();
    },
  };
}

// --- Google Drive (compte de service, lecture seule) ----------------------------------------------
function jetonCompteService({ cle, fetch: f = globalThis.fetch, horloge = () => new Date() }) {
  if (!cle || cle.type !== 'service_account' || typeof cle.client_email !== 'string' || typeof cle.private_key !== 'string' || typeof cle.token_uri !== 'string') {
    throw new ErreurAdaptateur('compte de service Drive : JSON « service_account » attendu');
  }
  let cache = null;
  return async () => {
    const t = Math.floor(horloge().getTime() / 1000);
    if (cache && cache.exp - 60 > t) return cache.jeton;
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const signe = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: cle.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly', aud: cle.token_uri, iat: t, exp: t + 3600 })}`;
    const assertion = `${signe}.${crypto.sign('sha256', Buffer.from(signe), cle.private_key).toString('base64url')}`;
    const r = await lireJsonHttp(f, cle.token_uri, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    }, 'Google OAuth (compte de service)');
    if (typeof r.access_token !== 'string') throw new ErreurAdaptateur('Google OAuth : jeton absent');
    cache = { jeton: r.access_token, exp: t + (Number.isInteger(r.expires_in) ? r.expires_in : 3600) };
    return cache.jeton;
  };
}

function driveLecture({ jeton, fetch: f = globalThis.fetch, dossier = DOSSIER_CANDIDATS }) {
  const API = 'https://www.googleapis.com/drive/v3/files';
  const entetes = async () => ({ authorization: `Bearer ${await jeton()}` });
  async function verifierDossier() {
    const d = await lireJsonHttp(f, `${API}/${encodeURIComponent(dossier)}?fields=id,mimeType,trashed`, { headers: await entetes() }, 'Drive (dossier candidats/)');
    if (!d || d.id !== dossier || d.mimeType !== 'application/vnd.google-apps.folder' || d.trashed === true) throw new ErreurAdaptateur('Drive : candidats/ n\'est pas un dossier accessible et non supprimé');
  }
  async function lister(q, champs) {
    const fichiers = [];
    let incomplet = false;
    const vus = new Set();
    let page = null;
    for (;;) {
      const p = new URLSearchParams({ q, fields: champs, pageSize: '1000' });
      if (page) p.set('pageToken', page);
      const r = await lireJsonHttp(f, `${API}?${p}`, { headers: await entetes() }, 'Drive (liste)');
      if (!r || !Array.isArray(r.files)) throw new ErreurAdaptateur('Drive : liste inexploitable');
      if (r.incompleteSearch === true) incomplet = true;
      fichiers.push(...r.files);
      if (!r.nextPageToken) break;
      if (vus.has(r.nextPageToken)) throw new ErreurAdaptateur('Drive : pagination en boucle');
      vus.add(r.nextPageToken);
      page = r.nextPageToken;
    }
    return { incompleteSearch: incomplet, files: fichiers };
  }
  const parent = `'${dossier}' in parents and trashed = false`;
  const setIdSur = (setId) => { if (!C.SET_ID_PATTERN.test(setId || '')) throw new ErreurAdaptateur(`set_id invalide : ${setId}`); return setId; };
  return {
    verifierDossier,
    async listerCandidats() {
      await verifierDossier();
      const r = await lister(parent, 'nextPageToken,incompleteSearch,files(id,name,modifiedTime,properties)');
      return { incompleteSearch: r.incompleteSearch, fichiers: r.files.map((x) => ({ id: x.id, nom: x.name, modifie_le: x.modifiedTime, properties: x.properties || {}, proprietesLisibles: true })) };
    },
    async lireLotGenere(setId) {
      setIdSur(setId);
      await verifierDossier();
      const r = await lister(`${parent} and name = '${setId}.lot.json'`, 'nextPageToken,incompleteSearch,files(id,name,modifiedTime)');
      if (r.incompleteSearch) throw new ErreurAdaptateur('Drive : recherche du lot généré incomplète');
      if (r.files.length === 0) return null;
      if (r.files.length > 1) throw new ErreurAdaptateur(`Drive : ${r.files.length} fichiers « ${setId}.lot.json »`);
      const x = r.files[0];
      const m = await reponseOk(await f(`${API}/${encodeURIComponent(x.id)}?alt=media`, { headers: await entetes() }), 'Drive (contenu du lot)');
      return { id: x.id, nom: x.name, modifie_le: x.modifiedTime, octets: Buffer.from(await m.arrayBuffer()) };
    },
    async candidatsDuSetId(setId) {
      setIdSur(setId);
      await verifierDossier();
      const r = await lister(`${parent} and (name = '${setId}.lot.json' or properties has { key='fonda_set_id' and value='${setId}' })`, 'nextPageToken,incompleteSearch,files(id)');
      if (r.incompleteSearch) throw new ErreurAdaptateur('Drive : recherche des candidats incomplète');
      return r.files.length;
    },
  };
}

// --- Git (historique de confiance : chaîne du premier parent de origin/design) -------------------
const REF_CONFIANCE = 'origin/design';
function journalGit({ git }) {
  return async (commit) => {
    if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) return { surPremierParent: false, journal: null };
    const chaine = new Set(git(['rev-list', '--first-parent', REF_CONFIANCE]).toString('utf8').split('\n').filter(Boolean));
    if (!chaine.has(commit)) return { surPremierParent: false, journal: null };
    return { surPremierParent: true, journal: J.lireJournalTexte(git(['show', `${commit}:fonda/data/set_ids-journal.json`]).toString('utf8')) };
  };
}
function lireADesign(git, rel) { return git(['show', `${REF_CONFIANCE}:${rel}`]); }

// --- Disque (dossier de clôture, hors dépôt, hors Dropbox) --------------------------------------
function ecrireToutSync(fd, buf) {
  let fait = 0;
  while (fait < buf.length) {
    const n = fs.writeSync(fd, buf, fait, buf.length - fait);
    if (!Number.isInteger(n) || n <= 0) throw new ErreurAdaptateur('écriture impossible (0 octet écrit)');
    fait += n;
  }
  fs.fsyncSync(fd);
}
const fsProduction = Object.freeze({
  existe: SC.existeSurDisque,
  lire: (p) => fs.readFileSync(p),
  lister: (d) => fs.readdirSync(d),
  realpath: (p) => fs.realpathSync.native(p),
  ecrireExclusif(p, texte) {
    fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(p, 'wx', 0o600);
    try { ecrireToutSync(fd, Buffer.from(texte, 'utf8')); } finally { fs.closeSync(fd); }
  },
});
function decisionsLocales({ dossier }) {
  return async (setId) => {
    const d = path.join(dossier, setId);
    if (!SC.existeSurDisque(d)) return [];
    return fs.readdirSync(d).sort().map((nom) => ({ nom, octets: fs.readFileSync(path.join(d, nom)) }));
  };
}

// --- Vérification des pièces signées d'un dossier de lot (extraction, témoin) -------------------
const OCTETS_COEUR = (c) => Canonique.hexContrat('coeur-decision-fonda/v1', c);
function dossierDuLot(dossier, setId) {
  const noms = SC.existeSurDisque(dossier) ? fs.readdirSync(dossier).filter((n) => n.startsWith(`${setId}-`) && SC.existeSurDisque(path.join(dossier, n, 'attestation.json'))) : [];
  if (noms.length !== 1) throw new ErreurAdaptateur(`${setId} : ${noms.length} dossier(s) de lot signé(s) (exactement un attendu)`);
  return path.join(dossier, noms[0]);
}
// -> { attestation, instantane, lot, entree } ; lève si quoi que ce soit ne concorde pas.
async function verifierPieces(dossierLot, { cles, registre, modelesAutorises, resoudre }, setIdAttendu = null) {
  const attestation = JSON.parse(fs.readFileSync(path.join(dossierLot, 'attestation.json'), 'utf8'));
  const ch = attestation && attestation.charge;
  if (!ch || typeof ch !== 'object') throw new ErreurAdaptateur('attestation sans charge');
  // Pièces rattachées au lot DEMANDÉ et à leur chemin CANONIQUE <set_id>-<code_confirmation>.
  if (setIdAttendu !== null && ch.set_id !== setIdAttendu) throw new ErreurAdaptateur(`attestation de ${ch.set_id}, pas de ${setIdAttendu}`);
  if (path.basename(dossierLot) !== `${ch.set_id}-${ch.code_confirmation}`) throw new ErreurAdaptateur(`dossier ${path.basename(dossierLot)} ≠ chemin canonique ${ch.set_id}-${ch.code_confirmation}`);
  const octetsInst = fs.readFileSync(path.join(dossierLot, 'instantane.json'));
  if (sha256Hex(octetsInst) !== ch.sha256_instantane) throw new ErreurAdaptateur('SHA-256(instantane.json) ≠ charge.sha256_instantane');
  const inst = JSON.parse(octetsInst.toString('utf8'));
  if (inst.set_id !== ch.set_id) throw new ErreurAdaptateur('instantané : set_id ≠ charge');
  if (OCTETS_COEUR(inst.coeur) !== OCTETS_COEUR(ch.coeur)) throw new ErreurAdaptateur('instantané : cœur ≠ cœur signé');
  if (!inst.moteur || !ch.moteur || inst.moteur.version !== ch.moteur.version || inst.moteur.sha256 !== ch.moteur.sha256) throw new ErreurAdaptateur('instantané : moteur ≠ charge');
  const lot = SC.lotPublie(inst.candidat_lot, inst.coeur);
  const va = await PL.verifierLotEtAttestation({ lot, attestation, referentielArchive: async (v) => resoudre(v), sha256Hex: shaTexte, cles, modelesAutorises, registre });
  if (!va.ok) throw new ErreurAdaptateur(`attestation non vérifiée : ${va.erreurs.join(' ; ')}`);
  return { attestation, instantane: inst, lot, entree: va.entree };
}

// --- Registre des incidents + témoin dérivé (option a) --------------------------------------------
// Limite assumée : un incident ouvert puis effacé, JAMAIS cité par une attestation signée,
// reste indétectable. Durcissement futur (option b) : registre versionné en ajout seul + CI.
function lireRegistreStrict(p) {
  let liste;
  try { liste = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { throw new ErreurAdaptateur('registre des incidents : JSON illisible'); }
  if (!Array.isArray(liste)) throw new ErreurAdaptateur('registre des incidents : tableau attendu');
  const ids = new Set();
  for (const i of liste) {
    if (!i || typeof i !== 'object' || Array.isArray(i) || typeof i.id !== 'string' || !i.id) throw new ErreurAdaptateur('registre des incidents : élément sans id');
    if (ids.has(i.id)) throw new ErreurAdaptateur(`registre des incidents : id en double (${i.id})`);
    ids.add(i.id);
    const erreur = incidentMalforme(i);
    if (erreur) throw new ErreurAdaptateur(`registre des incidents : ${i.id} : ${erreur} (format CDC §10 B)`);
  }
  return liste;
}
// Format CDC §10 B, mêmes contraintes que le signataire (signer-cloture.js, incidents) :
// ouvert -> { id, nature, detecte_le, statut: 'ouvert', resolu_le: null, preuve_resolution: null,
// periode: { debut, fin } } ; résolu -> dates normalisables, fin = resolu_le, debut ≤ fin,
// detecte_le ≤ resolu_le, preuve non vide. Renvoie le défaut, ou null.
function incidentMalforme(i) {
  const d = (v) => (v === null ? null : SC.normaliserDate(v));
  const attendues = ['detecte_le', 'id', 'nature', 'periode', 'preuve_resolution', 'resolu_le', 'statut'];
  if (Object.keys(i).sort().join() !== attendues.join()) return `champs attendus exactement ${attendues.join(', ')}`;
  if (typeof i.nature !== 'string' || !i.nature.trim()) return 'nature vide';
  if (!d(i.detecte_le)) return 'detecte_le invalide';
  if (!i.periode || typeof i.periode !== 'object' || Array.isArray(i.periode) || Object.keys(i.periode).sort().join() !== 'debut,fin') return 'periode { debut, fin } attendue';
  if (i.periode.debut !== null && !d(i.periode.debut)) return 'periode.debut invalide';
  if (i.statut === 'ouvert') {
    if (i.resolu_le !== null || i.preuve_resolution !== null || i.periode.fin !== null) return 'incident ouvert : resolu_le, preuve_resolution et periode.fin doivent valoir null';
    return null;
  }
  if (i.statut !== 'resolu') return 'statut ∈ { ouvert, resolu }';
  const resolu = d(i.resolu_le);
  const fin = i.periode.fin === null ? null : d(i.periode.fin);
  const debut = i.periode.debut === null ? null : d(i.periode.debut);
  if (!resolu || !fin || fin !== resolu) return 'résolu : periode.fin = resolu_le exigés';
  if (debut !== null && debut > fin) return 'periode.debut > periode.fin';
  if (d(i.detecte_le) > resolu) return 'detecte_le > resolu_le';
  if (typeof i.preuve_resolution !== 'string' || !i.preuve_resolution.trim()) return 'preuve_resolution vide';
  return null;
}

// Projection COMPLÈTE d'un incident signé, dates normalisées comme le signataire.
function projectionIncident(i) {
  const d = (v) => (v === null || v === undefined ? null : SC.normaliserDate(v));
  return JSON.stringify([i.id, i.nature, d(i.detecte_le), i.statut, d(i.resolu_le), i.preuve_resolution ?? null, d(i.periode && i.periode.debut), d(i.periode && i.periode.fin)]);
}
function temoinIncidents({ dossier, verifier, attestationsCatalogue }) {
  return async (liste) => {
    const cites = new Map();
    const citer = (i, source) => {
      const p = projectionIncident(i);
      if (cites.has(i.id) && cites.get(i.id).p !== p) throw new ErreurAdaptateur(`témoin : incident ${i.id} cité avec des valeurs contradictoires (${cites.get(i.id).source} / ${source})`);
      cites.set(i.id, { p, source });
    };
    // Attestations LOCALES : vérifiées PAR SIGNATURE avant lecture.
    for (const n of SC.existeSurDisque(dossier) ? fs.readdirSync(dossier) : []) {
      const dl = path.join(dossier, n);
      if (!/^set_fonda_[a-z0-9-]+_n[IF]_\d{2}-[0-9a-f]{16}$/.test(n) || !SC.existeSurDisque(path.join(dl, 'attestation.json'))) continue;
      const { attestation } = await verifier(dl); // signature + chemin canonique
      for (const i of attestation.charge.incidents_connus || []) citer(i, `local ${n}`);
    }
    for (const { entree, charge } of await attestationsCatalogue()) for (const i of charge.incidents_connus || []) citer(i, `catalogue ${entree.set_id}`);
    const registre = new Map(liste.map((i) => [i.id, projectionIncident(i)]));
    for (const [id, { p, source }] of cites) {
      if (!registre.has(id)) throw new ErreurAdaptateur(`registre des incidents incomplet : ${id} (cité par ${source}) absent — restauration requise`);
      if (registre.get(id) !== p) throw new ErreurAdaptateur(`registre des incidents modifié : ${id} ≠ version signée (${source}) — restauration requise`);
    }
  };
}
// Attestations du catalogue PUBLIÉ (origin/design) : cloture-signee vérifiées en entier ;
// les 8 « manuelle-historique » (sans charge) ignorées ; tout autre type ou forme -> refus.
function attestationsDuCatalogue({ git, cles, registre, modelesAutorises, resoudre }) {
  return async () => {
    const cat = JSON.parse(lireADesign(git, 'fonda/data/catalogue-fonda.json').toString('utf8'));
    if (!cat || cat.schema !== C.SCHEMA_CATALOGUE || !Array.isArray(cat.lots)) throw new ErreurAdaptateur('catalogue publié : forme catalogue-fonda/v1 attendue');
    const out = [];
    for (const e of cat.lots) {
      const a = e && e.attestation;
      if (a && a.type === 'manuelle-historique') {
        // Seulement les 8 historiques figés, SANS charge (rien à citer).
        if (!Object.prototype.hasOwnProperty.call(C.HISTORIQUES_FIGES, e.set_id) || 'charge' in a) throw new ErreurAdaptateur(`catalogue : ${e.set_id} : « manuelle-historique » hors des 8 lots figés, ou porteuse d'une charge`);
        continue;
      }
      if (!a || a.type !== S.TYPE) throw new ErreurAdaptateur(`catalogue : ${e && e.set_id} : attestation de type inattendu`);
      const es = PL.verifierClotureDuCatalogue(e, { resoudre, cles, registre, modelesAutorises });
      if (es.length) throw new ErreurAdaptateur(`catalogue : ${e.set_id} : attestation non vérifiée (${es.join(' ; ')})`);
      out.push({ entree: e, charge: a.charge });
    }
    return out;
  };
}
function registreIncidents({ dossier, temoin }) {
  const reg = path.join(dossier, 'incidents.json');
  const sentinelle = path.join(dossier, '.initialise');
  return async () => {
    if (!SC.existeSurDisque(sentinelle)) throw new ErreurAdaptateur('registre des incidents non initialisé (--initialiser)');
    if (!SC.existeSurDisque(reg)) throw new ErreurAdaptateur('registre des incidents PERDU (sentinelle présente) — restauration requise');
    const liste = lireRegistreStrict(reg);
    if (temoin) await temoin(liste);
    return liste;
  };
}
// --initialiser : ne remet JAMAIS à zéro.
function tracesDUsage(dossier) {
  if (!SC.existeSurDisque(dossier)) return [];
  const t = [];
  for (const n of fs.readdirSync(dossier)) {
    if (n === 'verrous' && fs.readdirSync(path.join(dossier, n)).length) t.push('verrous/');
    if (n.endsWith('.signature')) t.push(n);
    if (/^set_fonda_/.test(n) && fs.statSync(path.join(dossier, n)).isDirectory()) t.push(`${n}/`);
  }
  return t;
}
function initialiser({ dossier, attestationsCatalogue }) {
  const reg = path.join(dossier, 'incidents.json');
  const sentinelle = path.join(dossier, '.initialise');
  return async () => {
    const s = SC.existeSurDisque(sentinelle);
    const r = SC.existeSurDisque(reg);
    if (s && r) return { initialise: false, message: 'déjà initialisé : aucune écriture' };
    if (s && !r) throw new ErreurAdaptateur('registre des incidents PERDU (sentinelle présente) : jamais recréé — restauration requise');
    if (!s && r) throw new ErreurAdaptateur('initialisation interrompue (registre sans sentinelle) : traitement manuel, on ne présume jamais un registre vide');
    const traces = tracesDUsage(dossier);
    const cites = (await attestationsCatalogue()).filter((x) => (x.charge.incidents_connus || []).length);
    if (traces.length || cites.length) throw new ErreurAdaptateur(`usage antérieur détecté (${[...traces, ...cites.map((x) => `catalogue ${x.entree.set_id}`)].join(', ')}) : restauration requise, jamais d'initialisation automatique`);
    fs.mkdirSync(dossier, { recursive: true, mode: 0o700 });
    fsProduction.ecrireExclusif(reg, '[]\n');
    fsProduction.ecrireExclusif(sentinelle, `${JSON.stringify({ initialise_le: new Date().toISOString() })}\n`);
    return { initialise: true };
  };
}

// --- Clé de signature : préparée AVANT cloturer ----------------------------------------------------
async function lirePhraseTTY(question) {
  const readline = require('readline');
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (r) => { rl.close(); process.stdout.write('\n'); resolve(r); });
    rl.on('SIGINT', () => { rl.close(); resolve(null); });
  });
}
async function preparerSignataire({ dossierCles = DOSSIER_CLES, cleId = CLE_ID, cles, lirePhrase = lirePhraseTTY }) {
  const k = cles.obtenir(cleId);
  if (!k.ok) throw new ErreurAdaptateur(`clé publique ${cleId} : ${k.raison}`);
  const pem = fs.readFileSync(path.join(dossierCles, `${cleId}.priv.pem`));
  const phrase = await lirePhrase(`Phrase de passe de la clé ${cleId} : `);
  if (phrase === null || phrase === undefined) throw new ErreurAdaptateur('saisie annulée : rien n\'est consommé');
  let prive;
  try { prive = crypto.createPrivateKey({ key: pem, passphrase: phrase }); } catch { throw new ErreurAdaptateur('phrase de passe incorrecte ou clé illisible : rien n\'est consommé'); }
  const options = (key) => ({ key, padding: crypto.constants.RSA_PKCS1_PADDING });
  const nonce = crypto.randomBytes(32);
  if (!crypto.verify('sha256', nonce, options(k.cle), crypto.sign('sha256', nonce, options(prive)))) throw new ErreurAdaptateur(`clé privée ≠ clé publique déclarée ${cleId} : rien n'est consommé`);
  return (octets) => crypto.sign('sha256', octets, options(prive)); // SYNCHRONE -> Buffer
}

// --- Fabriques par usage ------------------------------------------------------------------------
function lireSecret(dossierCles, nom) {
  try { return fs.readFileSync(path.join(dossierCles, nom), 'utf8').trim(); } catch (e) { throw new ErreurAdaptateur(`secret ${nom} illisible dans ${dossierCles} (${e.code || e.message})`); }
}
// Sources LOCALES (dépôt, git, dossier de clôture) : aucun secret réseau. --initialiser et
// --extraire-publication n'utilisent que celles-ci.
function sourcesLocales(o = {}) {
  const racine = o.racine || RACINE_DEPOT;
  const dossier = o.dossier || DOSSIER_CLOTURE;
  const dossierCles = o.dossierCles || DOSSIER_CLES;
  const git = o.git || ((args) => execFileSync('git', args, { cwd: racine, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));
  const cles = o.cles || S.chargerCles(JSON.parse(fs.readFileSync(path.join(racine, 'fonda/data/cles/cles.json'), 'utf8')), (f) => fs.readFileSync(path.join(racine, 'fonda/data', f), 'utf8'));
  const registre = JSON.parse(fs.readFileSync(path.join(racine, 'fonda/engine/moteurs.json'), 'utf8'));
  const modelesAutorises = S.lireModelesAutorises(fs.readFileSync(path.join(racine, 'fonda/data/modeles-autorises.json'), 'utf8')); // TEXTE du fichier
  const resoudre = (version) => RA.resoudreReferentiel({ version, refs: [REF_CONFIANCE], racine, git });
  const verifier = (dl, setIdAttendu = null) => verifierPieces(dl, { cles, registre, modelesAutorises, resoudre }, setIdAttendu);
  const attestationsCatalogue = attestationsDuCatalogue({ git, cles, registre, modelesAutorises, resoudre });
  return {
    racine, dossier, dossierCles, git, cles, registre, modelesAutorises, resoudre, verifier, attestationsCatalogue,
    workflowGeneration: o.workflowGeneration || WORKFLOW_GENERATION,
    journal: journalGit({ git }),
    referentielArchive: RA.referentielArchiveGit({ refs: [REF_CONFIANCE], racine, git }), // -> OCTETS
    decisionsLocales: decisionsLocales({ dossier }),
    incidents: registreIncidents({ dossier, temoin: temoinIncidents({ dossier, verifier, attestationsCatalogue }) }),
    initialiser: initialiser({ dossier, attestationsCatalogue }),
    fs: o.fs || fsProduction,
    horloge: o.horloge || (() => new Date()),
  };
}
// Sources de LECTURE complètes : locales + n8n + Drive (secrets de ~/.fonda-cles).
function sourcesLecture(o = {}) {
  const l = sourcesLocales(o);
  const api = o.api || apiN8n({ url: o.urlN8n || URL_N8N, cle: lireSecret(l.dossierCles, 'n8n-signataire.cle'), fetch: o.fetch });
  const drive = o.drive || driveLecture({ dossier: o.dossierDrive || DOSSIER_CANDIDATS, jeton: jetonCompteService({ cle: JSON.parse(lireSecret(l.dossierCles, 'drive-compte-service.json')), fetch: o.fetch }), fetch: o.fetch });
  return { ...l, api, drive };
}

// Moteur DESCRIPTEUR de la génération de ce set_id (unique exécution réussie), rapproché du registre.
async function moteurDeLaGeneration(setId, s) {
  const execs = await SC.observer(s.api, s.workflowGeneration);
  const sorties = [];
  for (const x of execs.filter((e) => e.status === 'success')) {
    const b = await s.api.lireExecution(x.id);
    const e = b ? L.itemUnique(b, L.NOEUD_ENTREE) : { ok: false };
    if (!e.ok || e.json.set_id !== setId) continue;
    const so = L.itemUnique(b, L.NOEUD_SORTIE);
    if (!so.ok) throw new ErreurAdaptateur(`exécution ${x.id} : sortie inexploitable`);
    sorties.push(so.json);
  }
  if (sorties.length !== 1) throw new ErreurAdaptateur(`${sorties.length} génération(s) réussie(s) pour ${setId} : moteur non déterminable`);
  const m = sorties[0].moteur;
  const ligne = s.registre.find((l) => l && m && l.version === m.version);
  if (!ligne || ligne.sha256 !== m.sha256) throw new ErreurAdaptateur('moteur de la génération absent du registre moteurs.json');
  return { version: m.version, sha256: m.sha256 };
}

// Saisie au terminal (une ligne par question). Fin d'entrée -> null (refus en amont).
async function saisirTerminal(question) {
  const readline = require('readline');
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let repondu = false;
    rl.question(question, (r) => { repondu = true; rl.close(); resolve(r); });
    rl.on('close', () => { if (!repondu) resolve(''); });
  });
}
const ES_TERMINAL = (o) => ({ horloge: o.horloge, saisir: o.saisir || saisirTerminal, afficher: o.afficher || ((t) => process.stdout.write(`${t}\n`)) });

// saisirDecisionLocale (signer-cloture.js:270) : config { dossier, workflowGeneration }, api,
// drive.lireLotGenere, referentielArchive (octets), moteur (descripteur), registre, fs, horloge, saisir, afficher.
async function dependancesSaisie(setId, o = {}) {
  const s = o.sources || sourcesLecture(o);
  return {
    config: { dossier: s.dossier, workflowGeneration: s.workflowGeneration },
    api: s.api, drive: { lireLotGenere: s.drive.lireLotGenere }, referentielArchive: s.referentielArchive,
    moteur: await moteurDeLaGeneration(setId, s), registre: s.registre, fs: s.fs, horloge: s.horloge, ...ES_TERMINAL({ ...o, horloge: s.horloge }),
  };
}

// cloturer (signer-cloture.js:346) en saisie locale. `signer` vient de preparerSignataire, appelé
// AVANT. `rattachement` : fourni par l'appelant (ABSENT en production jusqu'au lot 7 -> garde).
function dependancesCloture(o = {}) {
  const s = o.sources || sourcesLecture(o);
  return {
    rattachement: o.rattachement,
    api: s.api,
    config: { source: 'saisie_locale', workflowGeneration: s.workflowGeneration, dossier: s.dossier, cleId: o.cleId || CLE_ID, modelesAutorises: s.modelesAutorises },
    drive: { lireLotGenere: s.drive.lireLotGenere, listerCandidats: s.drive.listerCandidats },
    journal: s.journal, decisionsLocales: s.decisionsLocales, incidents: s.incidents, referentielArchive: s.referentielArchive,
    tableRelecteurs: {}, fs: s.fs, signer: o.signer, cles: s.cles, registre: s.registre, horloge: s.horloge, levees: [],
    ...ES_TERMINAL({ ...o, horloge: s.horloge }),
  };
}

// declencher (verrou-generation.js) : lectures + envoi au PORTIER (jeton de l'appelant).
function dependancesDeclenchement(o = {}) {
  const s = o.sources || sourcesLecture(o);
  const f = o.fetch || globalThis.fetch;
  const idsLocaux = o.idsLocaux || (() => require('./generer-lot-fonda.js').setIdsExistants(null, {
    dirs: [path.join(s.racine, 'fonda/data/lots-fonda-calibration'), path.join(s.racine, 'fonda/data/lots')], cataloguePath: path.join(s.racine, 'fonda/data/catalogue-fonda.json'),
  }));
  return {
    lecture: {
      async reservation(setId, ref) {
        const j = J.lireJournalTexte(lireADesign(s.git, 'fonda/data/set_ids-journal.json').toString('utf8'));
        return J.verifierReservation(j, setId, ref);
      },
      idsLocaux: async () => idsLocaux(),
      async executionsDuSetId(setId) {
        let n = 0;
        for (const x of await SC.observer(s.api, s.workflowGeneration)) {
          const b = await s.api.lireExecution(x.id);
          const e = b ? L.itemUnique(b, L.NOEUD_ENTREE) : { ok: false };
          if (!e.ok) throw new ErreurAdaptateur(`exécution ${x.id} non attribuable (déclencheur illisible) : observer avant tout déclenchement`);
          if (e.json.set_id === setId) n += 1;
        }
        return n;
      },
      candidatsDuSetId: (setId) => s.drive.candidatsDuSetId(setId),
    },
    async envoyer(corps) {
      const jeton = o.jetonPortier || lireSecret(s.dossierCles, 'portier.jeton');
      const r = await f(o.urlPortier || URL_PORTIER, {
        method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', 'X-FONDA-Token': jeton },
        body: JSON.stringify({ set_id: corps.set_id, ref: corps.ref }), signal: AbortSignal.timeout(60000),
      });
      return { statut: r.status };
    },
    horloge: s.horloge,
  };
}

module.exports = {
  incidentMalforme, saisirTerminal, sourcesLocales,
  ErreurAdaptateur, apiN8n, jetonCompteService, driveLecture, journalGit, fsProduction, decisionsLocales, verifierPieces, dossierDuLot,
  lireRegistreStrict, projectionIncident, temoinIncidents, attestationsDuCatalogue, registreIncidents, initialiser, tracesDUsage,
  preparerSignataire, sourcesLecture, moteurDeLaGeneration, dependancesSaisie, dependancesCloture, dependancesDeclenchement,
  WORKFLOW_GENERATION, DOSSIER_CANDIDATS, URL_PORTIER, CLE_ID, DOSSIER_CLOTURE, DOSSIER_CLES, REF_CONFIANCE,
};
