#!/usr/bin/env node
// CLI QUI ÉCRIT du parcours page (CDC §21.12, P5-2) — Mac d'Éric seulement (PRÉCONDITION §21.12.1).
// SEUL appelant des webhooks `fonda-emettre` et `fonda-cloturer`. Ne signe RIEN, ne lit JAMAIS la clé
// privée, n'écrit JAMAIS dans Drive ni dans decisions/ (seul Confirmer y écrit).
//
//   node fonda/scripts/ecrire-relecture.js emettre <set_id>           émission (génération retenue exigée)
//   node fonda/scripts/ecrire-relecture.js reemettre <set_id>         réémission (candidat en_attente)
//   node fonda/scripts/ecrire-relecture.js clore-technique <set_id>   clôture technique (statut clos)
//   node fonda/scripts/ecrire-relecture.js diagnostiquer <set_id>     conclut la tentative ouverte du lot
//   node fonda/scripts/ecrire-relecture.js etat | initialiser | reparer
//   node fonda/scripts/ecrire-relecture.js attribuer-perte <ligne> <set_id> [<set_id>…]
//
// Tout s'exécute sous le VERROU NOYAU de la relecture (verrou-relecture.js), pris au démarrage et tenu
// pendant TOUT le processus (code 75 si une autre commande le tient). Séquence d'une écriture :
//   (1) journal sain, lot libre ; (2) QUIESCENCE : observer() sur Emettre ET Cloturer, aucune exécution
//   en vol ; (3) candidat relu (Drive, compte de service drive.readonly) ; (4) corps fermé — émission :
//   journal_commit, referentiel_version et moteur DÉRIVÉS de la génération retenue (arbitrage A1 (a)) ;
//   (5) ids de TOUTES les exécutions du workflow visé = ensemble préexistant (arbitrage A3) ;
//   (6) `envoi` au journal (fsync) AVANT le POST ; (7) UN SEUL POST, jamais relancé :
//     200 (onReceived : « reçu ») -> attente bornée (≤ 150 s) de la nouvelle exécution, puis DIAGNOSTIC ;
//     403 (authentification, sans exécution, vérifié G5) -> refuse_sans_effet ;
//     404 et tout autre code, délai, transport -> indetermine (arbitrage A4 : 404 non vérifié, H3 en phase B).
// Le diagnostic lit, de chaque NOUVELLE exécution, deux chemins seulement : le set_id du corps du
// webhook et la sortie « FONDA Sortie emission | cloture ». Tout le reste du détail (dont `k`, les
// adresses et l'en-tête X-FONDA-Token) est ignoré : jamais conservé, jamais affiché.
// Secrets : jetons des webhooks et clé `fonda-prod-n8n-lecture` lus au TROUSSEAU (arguments fixes, sans
// shell) ; compte de service ~/.fonda-cles/drive-compte-service.json. Aucun n'est affiché.
// Clé n8n : `fonda-prod-n8n-lecture` (GET seulement), DISTINCTE de celle du signataire (§21.12.5).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const V = require('./verrou-relecture.js');
const L = require('./liaison-generation.js');
const SC = require('./signer-cloture.js');
const C = require('../engine/catalogue.js');

const WORKFLOWS = Object.freeze({ emettre: '5iJOTDkaTZq7z0sh', cloturer: 'QrmJY4gguZEx7YoS' });
const NOEUDS = Object.freeze({
  emettre: { webhook: 'Webhook emission', sortie: 'FONDA Sortie emission' },
  cloturer: { webhook: 'Webhook cloture', sortie: 'FONDA Sortie cloture' },
});
const TROUSSEAU = Object.freeze({ emettre: 'fonda-prod-emettre-token', cloturer: 'fonda-prod-cloturer-token', lecture: 'fonda-prod-n8n-lecture' });
const COMMANDES_ECRITURE = Object.freeze({ emettre: 'emission', reemettre: 'reemission', 'clore-technique': 'cloture_technique' });
const EN_VOL = ['new', 'running', 'waiting'];
const TERMINAUX = ['success', 'error', 'crashed', 'canceled'];
const DELAI_POST_MS = 30000;
const ATTENTE_MAX_MS = 150000; // executionTimeout 120 s + marge (arbitrage A2)
const PAS_ATTENTE_MS = 3000;
const SORTIE = Object.freeze({ OK: 0, REFUS: 1, OUVERTE: 2 });

const refuser = (m) => { throw new V.RefusRelecture(m); };
const ids = (liste) => liste.map((x) => String(x.id));

// --- Arguments ------------------------------------------------------------------------------------
function analyserArguments(argv) {
  const [commande, ...reste] = argv;
  if (Object.prototype.hasOwnProperty.call(COMMANDES_ECRITURE, commande) || commande === 'diagnostiquer') {
    if (reste.length !== 1 || !C.SET_ID_PATTERN.test(reste[0])) refuser(`usage : ecrire-relecture.js ${commande} <set_id>`);
    return { commande, setId: reste[0] };
  }
  if (['etat', 'initialiser', 'reparer'].includes(commande)) {
    if (reste.length) refuser(`usage : ecrire-relecture.js ${commande}`);
    return { commande };
  }
  if (commande === 'attribuer-perte') {
    if (reste.length < 2 || !/^[1-9][0-9]{0,8}$/.test(reste[0]) || !reste.slice(1).every((s) => C.SET_ID_PATTERN.test(s))) refuser('usage : ecrire-relecture.js attribuer-perte <ligne> <set_id> [<set_id>…]');
    return { commande, ligne: Number(reste[0]), setIds: reste.slice(1) };
  }
  return refuser('commande inconnue : emettre | reemettre | clore-technique | diagnostiquer | etat | initialiser | reparer | attribuer-perte');
}

// --- Génération retenue (arbitrage A1 (a)) ---------------------------------------------------------
// MÊME SÉQUENCE que diagnostic-fonda.js (rapprochement §20.3), composée des fonctions PURES exportées
// de liaison-generation.js (la logique reste là). « Généré » = rapprochement établi sans constat et
// relecteur attribué déterminable (diagnostic : pret_pour_saisie ou relecteur_non_local). Sinon refus,
// rien n'est écrit. Lectures confinées : seuls les nœuds d'entrée et de sortie de la génération sont lus.
// s = { api, drive: { listerCandidats, lireLotGenere }, journal(commit), registre, modelesAutorises,
//       referentielArchive(version) -> octets, workflowGeneration }
const shaHex = (b) => crypto.createHash('sha256').update(b).digest('hex');
const lireJson = (b) => { try { return JSON.parse(Buffer.from(b).toString('utf8')); } catch { return undefined; } };
async function lire(f, quoi) { try { return await f(); } catch { return refuser(`génération : ${quoi} illisible — rien n'est écrit`); } }
async function generationRetenue(setId, s) {
  const pasGenere = (m) => refuser(`${setId} : génération non retenue (${m}) — rien n'est écrit`);
  const lotAvant = await lire(() => s.drive.lireLotGenere(setId), 'lot généré');
  const execs = await lire(() => SC.observer(s.api, s.workflowGeneration), 'observation n8n');
  const cand = await lire(() => s.drive.listerCandidats(), 'candidats/');
  if (cand.incompleteSearch !== false) pasGenere('recherche des candidats incomplète');
  const lotApres = await lire(() => s.drive.lireLotGenere(setId), 'lot généré');
  const terminees = execs.filter((x) => !EN_VOL.includes(x.status));
  const details = new Map();
  for (const x of terminees) details.set(x.id, await lire(() => s.api.lireExecution(x.id), `exécution ${x.id}`));
  const c1 = new L.Constats();
  const { examinees, complet } = L.examinerExecutions({ executions: terminees, details, constats: c1, normaliserDate: SC.normaliserDate });
  const reussies = examinees.filter((e) => e.entree.set_id === setId && e.x.status === 'success');
  const fichiersDuLot = cand.fichiers.filter((f) => f.nom === `${setId}.lot.json` || (f.properties && f.properties.fonda_set_id === setId));
  if (!(reussies.length === 1 && fichiersDuLot.length === 1 && complet)) pasGenere(`${reussies.length} génération(s) réussie(s), ${fichiersDuLot.length} lot(s), observation ${complet ? 'complète' : 'incomplète'}`);
  const generation = reussies[0];
  const c2 = new L.Constats();
  const vf = L.examinerFichiers({ setId, fichiers: cand.fichiers, constats: c2 });
  const { retenue } = L.classerExecutions({ setId, examinees, complet, vueFichiers: vf, constats: c2 });
  const av = lotAvant; const ap = lotApres;
  const stable = !!av && !!ap && Buffer.from(av.octets).equals(Buffer.from(ap.octets)) && av.id === ap.id;
  if (!stable) c2.ajouter('abandon', 'lot généré absent, illisible ou modifié pendant l\'observation');
  const fichierVu = vf.fichier || fichiersDuLot[0];
  const dates = [av, ap, fichierVu].filter(Boolean).map((x) => SC.normaliserDate(x.modifie_le));
  if (dates.some((d) => d === null) || new Set(dates).size > 1) c2.ajouter('abandon', 'lot généré : dates différentes entre lectures et listing');
  else if (generation.x.stoppedAt && dates.some((d) => d > generation.x.stoppedAt)) c2.ajouter('abandon', 'lot généré modifié après la génération');
  if ([av, ap].some((x) => x && fichierVu && x.id !== fichierVu.id)) c2.ajouter('abandon', 'lot généré lu ≠ fichier listé');
  if ([av, ap].some((x) => x && x.nom !== `${setId}.lot.json`)) c2.ajouter('abandon', 'nom du lot généré inattendu');
  let lot = stable ? lireJson(av.octets) : null;
  const dec = C.decomposerSetId(setId);
  if (stable && lot === undefined) { c2.ajouter('incident', 'lot généré illisible'); lot = null; } else if (stable && (!C.validerLot(lot).valide || lot.set_id !== setId || !dec || lot.palier !== dec.palier || C.slugDeNotion(lot.notion_id) !== dec.slug)) { c2.ajouter('abandon', 'lot généré non conforme'); lot = null; }
  let empreintes = null;
  if (lot) {
    if (L.nullsExplicites(lot).length) c2.ajouter('abandon', 'null explicite dans le lot');
    empreintes = { pedagogique: await C.calculerEmpreinte(lot, async (t) => shaHex(Buffer.from(t, 'utf8'))), complete: L.empreinteComplete(lot) };
  }
  let jc = L.INDISPONIBLE;
  let sortie = null;
  if (retenue && retenue !== L.INDISPONIBLE) {
    const so = L.itemUnique(details.get(retenue.x.id), L.NOEUD_SORTIE);
    if (so.ok) { try { jc = await s.journal(so.json.journal_commit); } catch { c2.ajouter('temporaire', 'journal illisible (actualiser origin/design)'); } }
    sortie = L.rapprocher({ setId, retenue, fichier: vf.fichier, brute: details.get(retenue.x.id), workflowId: s.workflowGeneration, journalCommit: jc, registre: s.registre, modelesAutorises: s.modelesAutorises, lotSource: lot, empreintes, constats: c2 });
  }
  if (sortie && [av, ap].some((x) => x && x.id !== sortie.candidat_fichier_id)) c2.ajouter('abandon', 'lot lu ≠ candidat_fichier_id de la génération');
  if (sortie) {
    let ok = false;
    try { ok = `sha256:${shaHex(Buffer.from(await s.referentielArchive(sortie.referentiel_version)))}` === sortie.referentiel_version; } catch { ok = false; }
    if (!ok) c2.ajouter('abandon', 'référentiel archivé introuvable ou ≠ referentiel_version');
  }
  if (c2.liste.length || jc === L.INDISPONIBLE || !sortie) pasGenere(c2.liste.map((c) => `${c.issue} : ${c.raison}`).join(' ; ') || 'rapprochement impossible');
  try { await SC.relecteurDeLaGeneration(setId, { api: s.api, config: { workflowGeneration: s.workflowGeneration }, referentielArchive: s.referentielArchive }); } catch { pasGenere('relecteur attribué non déterminable'); }
  return { journal_commit: sortie.journal_commit, referentiel_version: sortie.referentiel_version, moteur: { version: sortie.moteur.version, sha256: sortie.moteur.sha256 } };
}

// --- Lecture du candidat (Drive relecture/, compte de service drive.readonly) -----------------------
// -> null (ABSENCE établie : recherche complète, zéro fichier) | { fichier_id, version, generation_cle,
// statut, clos_le } (champs copiés tels quels ; le schéma fermé du verrou les valide). Seuls ces champs
// sortent : jamais `envois` (adresses) ni `cle_sha256`.
function lectureCandidats({ jeton, fetch: f = globalThis.fetch, dossier }) {
  const API = 'https://www.googleapis.com/drive/v3/files';
  const get = async (url, quoi) => {
    const r = await f(url, { method: 'GET', headers: { authorization: `Bearer ${await jeton()}` } });
    if (!r.ok) refuser(`${quoi} : HTTP ${r.status}`);
    return r;
  };
  return {
    async lire(setId) {
      if (!C.SET_ID_PATTERN.test(setId)) refuser('set_id invalide');
      const d = await (await get(`${API}/${encodeURIComponent(dossier)}?fields=id,mimeType,trashed`, 'Drive (relecture/)')).json();
      if (!d || d.id !== dossier || d.mimeType !== 'application/vnd.google-apps.folder' || d.trashed === true) refuser('Drive : relecture/ inaccessible');
      const fichiers = []; let incomplet = false; let page = null; const vus = new Set();
      for (;;) {
        const p = new URLSearchParams({ q: `'${dossier}' in parents and trashed = false and name = '${setId}.candidat.json'`, fields: 'nextPageToken,incompleteSearch,files(id,name,version)', pageSize: '100' });
        if (page) p.set('pageToken', page);
        const r = await (await get(`${API}?${p}`, 'Drive (liste)')).json();
        if (!r || !Array.isArray(r.files)) refuser('Drive : liste inexploitable');
        if (r.incompleteSearch === true) incomplet = true;
        fichiers.push(...r.files);
        if (!r.nextPageToken) break;
        if (vus.has(r.nextPageToken)) refuser('Drive : pagination en boucle');
        vus.add(r.nextPageToken); page = r.nextPageToken;
      }
      if (incomplet) refuser('Drive : recherche du candidat incomplète');
      if (fichiers.length === 0) return null;
      if (fichiers.length > 1) refuser(`Drive : ${fichiers.length} fichiers candidat pour ce lot`);
      const x = fichiers[0];
      const env = lireJson(Buffer.from(await (await get(`${API}/${encodeURIComponent(x.id)}?alt=media`, 'Drive (candidat)')).arrayBuffer()));
      if (!env || env.schema !== 'candidat-fonda/v1' || !env.relecture || typeof env.relecture !== 'object' || !env.lot || env.lot.set_id !== setId) refuser('candidat illisible ou d\'un autre lot');
      const r = env.relecture;
      // Champ ABSENT de la relecture -> clé ABSENTE (le verrou refuse un candidat incomplet ; jamais un null inventé).
      const c = { fichier_id: x.id, version: x.version };
      for (const k of ['generation_cle', 'statut', 'clos_le']) if (Object.prototype.hasOwnProperty.call(r, k)) c[k] = r[k];
      return c;
    },
  };
}

// --- Webhook (un seul POST, jamais relancé) ---------------------------------------------------------
// -> { http } ou { panne: 'delai' | 'transport' }. Le corps de la réponse n'est jamais lu (onReceived).
function webhook({ url, jeton, fetch: f = globalThis.fetch, delaiMs = DELAI_POST_MS }) {
  return async (corps) => {
    try {
      const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', 'X-FONDA-Token': jeton() }, body: JSON.stringify(corps), signal: AbortSignal.timeout(delaiMs) });
      return { http: r.status };
    } catch (e) { return { panne: e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'delai' : 'transport' }; }
  };
}

// --- Observation ------------------------------------------------------------------------------------
async function observerWorkflow(api, wf) {
  try { return await SC.observer(api, WORKFLOWS[wf]); } catch { return refuser(`observation n8n (${wf}) impossible ou incomplète — rien n'est décidé`); }
}
// Exécutions NOUVELLES (hors ensemble préexistant), réduites à { id, set_id, workflow, statut, sortie }.
async function nouvellesExecutions(api, wf, preexistantes) {
  const pre = new Set(preexistantes);
  const obs = await observerWorkflow(api, wf);
  const sorties = [];
  for (const x of obs.filter((e) => !pre.has(String(e.id)))) {
    let brute = null;
    try { brute = await api.lireExecution(x.id); } catch { return refuser(`exécution ${x.id} illisible — rien n'est décidé`); }
    const w = L.itemUnique(brute, NOEUDS[wf].webhook);
    const corps = w.ok && w.json.body && typeof w.json.body === 'object' ? w.json.body : null;
    const so = L.itemUnique(brute, NOEUDS[wf].sortie);
    sorties.push({ id: String(x.id), set_id: corps && typeof corps.set_id === 'string' ? corps.set_id : null, workflow: wf, statut: x.status, sortie: so.ok ? so.json : undefined });
  }
  return { nouvelles: sorties, enVol: obs.some((x) => EN_VOL.includes(x.status) && !pre.has(String(x.id))) };
}

// --- Commandes --------------------------------------------------------------------------------------
async function diagnostiquer(setId, deps) {
  const a = V.lireEtat(deps.verrous);
  if (!a.sain) refuser(`journal de la relecture inutilisable : ${a.raison}`);
  const L0 = a.lots[setId];
  if (!L0 || L0.etat !== 'ouverte') refuser(`${setId} : aucune tentative ouverte à diagnostiquer`);
  const t = a.tentatives[L0.ouverte];
  const { nouvelles } = await nouvellesExecutions(deps.api, t.workflow, t.preexistantes);
  const candidat = await deps.candidats.lire(setId);
  const r = V.diagnostiquer(L0.ouverte, { executions: nouvelles, listingComplet: true, candidat }, deps);
  return r.leve ? { set_id: setId, issue: r.issue, execution_id: r.execution_id } : { set_id: setId, issue: 'ouverte', raison: r.raison };
}

async function attendreEtDiagnostiquer(setId, wf, preexistantes, deps) {
  const fin = deps.maintenant() + (deps.attenteMaxMs ?? ATTENTE_MAX_MS);
  for (;;) {
    const { nouvelles, enVol } = await nouvellesExecutions(deps.api, wf, preexistantes);
    const duLot = nouvelles.filter((e) => e.set_id === setId || e.set_id === null);
    if (duLot.length && !enVol && duLot.every((e) => TERMINAUX.includes(e.statut))) return diagnostiquer(setId, deps);
    if (deps.maintenant() >= fin) return { set_id: setId, issue: 'ouverte', raison: 'exécution non terminée dans le délai : relancer « diagnostiquer »' };
    await deps.attendre(deps.pasMs ?? PAS_ATTENTE_MS);
  }
}

async function ecrire(commande, setId, deps) {
  const cmd = COMMANDES_ECRITURE[commande];
  const wf = V.COMMANDES[cmd];
  // (1) journal sain, lot libre (relu à nouveau par preparerEnvoi, sous le même verrou).
  const a = V.lireEtat(deps.verrous);
  if (!a.sain) refuser(`journal de la relecture inutilisable : ${a.raison}`);
  if (a.pertesNonAttribuees.length) refuser('portion perdue sans lot attribué : tous les lots sont bloqués');
  const L0 = a.lots[setId];
  if (L0 && L0.etat !== 'libre') refuser(`${setId} : lot ${L0.etat === 'ouverte' ? 'avec une tentative non résolue — « diagnostiquer »' : 'bloqué définitivement — abandon logique'}`);
  // (2) quiescence : Emettre ET Cloturer, quel que soit le lot.
  const obs = {};
  for (const w of ['emettre', 'cloturer']) {
    obs[w] = await observerWorkflow(deps.api, w);
    V.exigerQuiescence({ complet: true, enVol: obs[w].filter((x) => EN_VOL.includes(x.status)).length });
  }
  // (3) candidat relu ; (4) corps fermé.
  const candidat = await deps.candidats.lire(setId);
  const deriver = deps.deriverGeneration || generationRetenue; // injectable (tests) ; production : generationRetenue
  const corps = cmd === 'cloture_technique' ? { set_id: setId } : { set_id: setId, ...await deriver(setId, deps.generation) };
  // (5) ensemble préexistant = TOUS les ids du workflow visé (A3) ; (6) journal d'abord.
  const preexistantes = ids(obs[wf]);
  const p = V.preparerEnvoi(setId, cmd, { candidat, preexistantes, listingComplet: true }, deps);
  // (7) UN SEUL POST.
  const r = await deps.poster[wf](corps);
  if (r.http === 403) return { set_id: setId, issue: V.conclure(p.tentative_id, 'refuse_sans_effet', { http: 403 }, deps).issue };
  if (r.http === 200) return attendreEtDiagnostiquer(setId, wf, preexistantes, deps);
  const motif = r.panne === 'delai' ? 'delai' : r.panne === 'transport' ? 'transport' : 'erreur_serveur'; // 404 compris (A4)
  return { set_id: setId, issue: V.conclure(p.tentative_id, 'indetermine', { motif }, deps).issue, consigne: 'tentative indéterminée : « diagnostiquer » ; jamais de nouvel envoi' };
}

function etat(deps) {
  const a = V.lireEtat(deps.verrous);
  return { sain: a.sain, raison: a.raison, pertes_non_attribuees: a.pertesNonAttribuees.map((i) => i + 1), lots: Object.fromEntries(Object.entries(a.lots).map(([s, l]) => [s, l.etat === 'bloque' ? `bloque (${l.blocage})` : l.etat])) };
}

async function executer(args, deps) {
  switch (args.commande) {
    case 'emettre': case 'reemettre': case 'clore-technique': return ecrire(args.commande, args.setId, deps);
    case 'diagnostiquer': return diagnostiquer(args.setId, deps);
    case 'etat': return etat(deps);
    case 'initialiser': return V.initialiser(deps);
    case 'reparer': return V.reparer(deps);
    case 'attribuer-perte': return V.attribuerPerte(args.ligne, args.setIds, deps);
    default: return refuser('commande inconnue');
  }
}

// --- Production -------------------------------------------------------------------------------------
function lireTrousseau(service, exec = execFileSync) {
  let v;
  try { v = exec('/usr/bin/security', ['find-generic-password', '-s', service, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { v = null; }
  if (typeof v !== 'string' || !v.trim()) refuser(`trousseau : secret « ${service} » illisible`);
  return v.replace(/\n$/, '');
}
function dependancesProduction({ dossierCles = path.join(os.homedir(), '.fonda-cles') } = {}) {
  const A = require('./adaptateurs-production.js');
  const CONFIG = require('../../n8n/fonda-relecture-page/construire-relecture.js').CONFIG;
  const api = A.apiN8n({ url: CONFIG.urlN8n, cle: lireTrousseau(TROUSSEAU.lecture) });
  let cle;
  try { cle = JSON.parse(fs.readFileSync(path.join(dossierCles, 'drive-compte-service.json'), 'utf8')); } catch { refuser('compte de service Drive illisible'); }
  const jeton = A.jetonCompteService({ cle });
  const locales = A.sourcesLocales({});
  return {
    api,
    candidats: lectureCandidats({ jeton, dossier: CONFIG.dossierRelecture }),
    generation: { api, drive: A.driveLecture({ jeton, dossier: CONFIG.dossierCandidats }), journal: locales.journal, registre: locales.registre, modelesAutorises: locales.modelesAutorises, referentielArchive: locales.referentielArchive, workflowGeneration: locales.workflowGeneration },
    poster: {
      emettre: webhook({ url: `${CONFIG.urlN8n}/webhook/${CONFIG.cheminEmettre}`, jeton: () => lireTrousseau(TROUSSEAU.emettre) }),
      cloturer: webhook({ url: `${CONFIG.urlN8n}/webhook/${CONFIG.cheminCloturer}`, jeton: () => lireTrousseau(TROUSSEAU.cloturer) }),
    },
  };
}

async function main(argv = process.argv.slice(2), fabrique = dependancesProduction, verrous = V.VERROUS_PAR_DEFAUT) {
  try {
    const args = analyserArguments(argv);
    const tenu = V.prendreVerrou(verrous);
    const base = { verrous, sousVerrou: tenu.chemin, maintenant: () => Date.now(), attendre: (ms) => new Promise((r) => setTimeout(r, ms)) };
    const deps = ['etat', 'initialiser', 'reparer', 'attribuer-perte'].includes(args.commande) ? base : { ...base, ...fabrique(args) };
    const r = await executer(args, deps);
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
    if (r && r.issue === 'ouverte') process.exitCode = SORTIE.OUVERTE;
    if (r && (r.issue === 'indetermine' || r.issue === 'anomalie')) process.exitCode = SORTIE.REFUS;
  } catch (e) {
    process.stderr.write(`✗ ${e instanceof V.RefusRelecture ? e.message : 'erreur interne (détail non affiché)'}\n`);
    process.exitCode = e && e.code === V.OCCUPE ? V.OCCUPE : SORTIE.REFUS;
  }
}

module.exports = { WORKFLOWS, NOEUDS, TROUSSEAU, COMMANDES_ECRITURE, SORTIE, analyserArguments, generationRetenue, lectureCandidats, webhook, nouvellesExecutions, diagnostiquer, ecrire, executer, lireTrousseau, dependancesProduction, main };

if (require.main === module) main();
