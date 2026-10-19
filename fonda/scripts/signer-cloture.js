// Signature LOCALE de clôture d'un lot FONDA (CDC relecture §3, §5, §9, §10, §11,
// §11 bis) — script exécuté sur le Mac d'Éric, jamais en CI ni dans n8n.
//
// ═══ GARDE MAÎTRESSE (fail-closed, §11 bis) ═══════════════════════════════════════
// Ce script REFUSE DE SIGNER tant que le CONTRAT DE RATTACHEMENT d'une exécution n8n
// à un lot (set_id, type de sortie, nonce) n'est pas défini et relu. Ce contrat
// appartient au chantier des workflows (chantier 5) ; en attendant, aucune fonction
// de rattachement n'est fournie en production : `rattachement` absent => REFUS avant
// toute autre opération. Les tests injectent un rattachement « de test » (synthétique)
// — il ne doit JAMAIS servir à une vraie signature. La première vraie signature
// attend le chantier des workflows.
// ═══════════════════════════════════════════════════════════════════════════════════
//
// Charge produite : attestation-cloture/v2 (CDC v8.3 §20.9), deux sources de décisions :
// « page_relecture » (parcours v8.2, page §7, clôture technique §9) et « saisie_locale »
// (§20.6, premier lot : décision figée par saisirDecisionLocale, relecteur « eric »).
// Étapes, toutes avant la moindre signature ; tout refus => ZÉRO signature :
//  1. Lot généré lu AVANT le listing ; LISTING en intervalle [listing_debut_le,
//     listing_fin_le] de TOUTES les sources (exécutions du workflow de génération épinglé
//     — status=running, waiting puis liste complète —, candidats/ avec properties,
//     clôture/confirmations/decisions en page, décisions locales, incidents) ; lot relu
//     APRÈS : identifiant, date et octets identiques, sinon refus temporaire (§20.7).
//  2. Liaison de génération (fonda/scripts/liaison-generation.js) : classement des
//     exécutions du set_id (§20.2), table normative de rapprochement de l'exécution
//     retenue (§20.3), lot source sans null explicite, empreintes pédagogique et
//     complète (§20.4), référentiel ARCHIVÉ de la version de la sortie (§20.12).
//  3. Décisions : page (filet §10 sur les exécutions de confirmation, decisions/ écrites
//     avant la clôture technique ET avant le début du listing) ou saisie locale (une
//     seule décision figée, generation = 0, « saisie-locale ») ; RÉCONCILIATION de chaque
//     décision contre le lot source puis unicité du cœur ET du lot_relu (§20.5, §10 A) ;
//     incidents sur la fenêtre de candidature de la source ([cree_le, clos_le] en page,
//     [generation.demarree_le, fin_saisie_le] en saisie locale).
//  4. Issues CLASSÉES (§20.13) : tous les constats sont réunis — lectures en échec
//     comprises (401/403 -> incident, panne -> refus temporaire), chaque contrôle ne
//     dépendant que de SES données —, ainsi que les garde-fous du moteur et la clé ;
//     la première ligne applicable l'emporte (incident > abandon > refus temporaire >
//     arrêt local). PRÉCONDITIONS hors matrice (garde, configuration, set_id, dossier) :
//     refus « precondition » AVANT toute observation.
//     Clôture ANTÉRIEURE de ce set_id (dossier <set_id>-<code>) : autre code = instantané
//     figé sur d'autres données -> abandon ; même code = REPRISE (instantané, export et
//     récapitulatif relus et vérifiés octet pour octet, jamais réécrits) ; déjà signé ->
//     refus (jamais deux attestations). §3.4 vérifié avant ET après la confirmation.
//  5. Instantané figé (§3) : lot source, cœur, lot_relu, moteur, récapitulatif ; écrit UNE
//     fois (wx) hors dépôt et hors Dropbox ; code (16 premiers hex) calculé APRÈS la
//     décision figée ; confirmation (auto si relecteur = « eric ») ; fidélité ; contrôles
//     §3.4 sur les fichiers RELUS.
//  6. Charge attestation-cloture/v2 (invariants communs et par source, modèle ∈ liste
//     épinglée G5), signature RSA-SHA256 PKCS#1 v1.5, REVÉRIFICATION IMMÉDIATE par
//     fonda/scripts/attestation-signee.js (même chemin que la publication).
//
// PROVISOIRE (dépend du contrat de rattachement, chantier 5) — choix à confirmer avec les
// workflows, JAMAIS considérés comme des contrats validés : rapprochement décision <->
// exécution de confirmation par `nonce` (parcours page) ; adaptateurs API/Drive/journal.

// SECRETS : la clé privée et le jeton d'API n8n (lecture seule, droits minimaux) vivent
// HORS dépôt et HORS Dropbox ; ils ne sont jamais écrits, journalisés ni affichés.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('../engine/catalogue.js');
const Canonique = require('../engine/canonique.js');
const S = require('./attestation-signee.js');
const L = require('./liaison-generation.js');
const { chargerMoteurNode } = require('./moteurs.js');

const RACINE_DEPOT = path.resolve(__dirname, '..', '..');
const STATUTS_TERMINAUX = ['success', 'error', 'crashed', 'canceled'];
const STATUTS_EN_VOL = ['new', 'running', 'waiting'];
const DATE_SOURCE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

// Refus : .issue ∈ { incident, abandon, refus, temporaire, local } (§20.13) ou « precondition »
// (appel invalide : garde, configuration, set_id, dossier — refusé AVANT toute observation,
// hors matrice : aucune issue sur le lot ne peut être établie sans appel valide).
class Refus extends Error { constructor(m, issue = 'refus') { super(m); this.issue = issue; } }
const refuser = (m, issue) => { throw new Refus(m, issue); };
const sha256Hex = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Date de source (§11 bis) : grammaire ISO stricte avec fuseau, date calendaire réelle,
// convertie en UTC milliseconde ; sinon null.
function normaliserDate(v) {
  if (typeof v !== 'string') return null;
  const m = DATE_SOURCE.exec(v);
  if (!m) return null;
  const [an, mo, j, h, mi, s] = m.slice(1, 7).map(Number);
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || s > 59) return null;
  if (j < 1 || j > new Date(Date.UTC(an, mo, 0)).getUTCDate()) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// Le dossier local de clôture ne doit être ni dans le dépôt ni dans Dropbox.
// Contrôle sur le chemin TEXTUEL puis sur le chemin PHYSIQUE (liens symboliques
// résolus sur le plus proche parent existant) : `realpath` injectable (tests).
function verifierDossierLocal(dossier, realpath = (p) => fs.realpathSync.native(p)) {
  if (typeof dossier !== 'string' || !path.isAbsolute(dossier)) refuser('dossier de clôture : chemin absolu requis');
  const interdit = (abs) => {
    const depot = (() => { try { return realpath(RACINE_DEPOT); } catch { return RACINE_DEPOT; } })();
    for (const r of new Set([RACINE_DEPOT, depot])) if (abs === r || abs.startsWith(r + path.sep)) refuser('dossier de clôture DANS le dépôt : interdit');
    if (/dropbox/i.test(abs)) refuser('dossier de clôture dans Dropbox : interdit');
  };
  const abs = path.resolve(dossier);
  interdit(abs);
  let parent = abs;
  const reste = [];
  for (;;) {
    let reel = null;
    try { reel = realpath(parent); } catch { /* inexistant : on remonte */ }
    if (reel) { interdit(path.join(reel, ...reste.reverse())); return; }
    const p = path.dirname(parent);
    if (p === parent) return;
    reste.push(path.basename(parent));
    parent = p;
  }
}

// --- 1-2. Observations n8n (lecture seule) ---------------------------------------------
// api.listerExecutions({ workflowId, status }) -> [{ id, workflowId, status, startedAt, stoppedAt }]
// (pagination complète à la charge de l'adaptateur). rattachement(execution) ->
// { set_id, type: 'decision'|'conflit'|'cloture', nonce } | null (null = non rattachable).
// `suivi` (facultatif) : en cas de panne d'une requête, suivi.vues = observations déjà
// faites (les exécutions en vol déjà vues restent exploitables par l'appelant).
async function observer(api, workflowId, suivi = null) {
  const vues = new Map();
  const ajouter = (lot, source) => {
    for (const x of lot || []) {
      if (!x || !((typeof x.id === 'string' && x.id.trim() !== '') || (typeof x.id === 'number' && Number.isSafeInteger(x.id)))) refuser(`exécution sans identifiant exploitable (${source})`);
      const id = String(x.id);
      const n = { id, workflowId: x.workflowId, status: x.status, startedAt: x.startedAt == null ? null : normaliserDate(x.startedAt), stoppedAt: x.stoppedAt == null ? null : normaliserDate(x.stoppedAt), brut: x };
      if (x.startedAt != null && n.startedAt === null) refuser(`exécution ${id} : startedAt hors grammaire (${source})`);
      if (x.stoppedAt != null && n.stoppedAt === null) refuser(`exécution ${id} : stoppedAt hors grammaire (${source})`);
      if (n.workflowId !== workflowId) refuser(`exécution ${id} : workflowId inattendu`);
      // Chaque observation est validée AVANT toute fusion (aucune anomalie écrasée) :
      // statut connu, chronologie d'une observation terminale.
      if (!STATUTS_TERMINAUX.includes(n.status) && !STATUTS_EN_VOL.includes(n.status)) refuser(`exécution ${id} : statut inconnu (${n.status}) (${source})`);
      if (STATUTS_TERMINAUX.includes(n.status) && n.startedAt && n.stoppedAt && n.stoppedAt < n.startedAt) refuser(`exécution ${id} terminée avant d'avoir démarré (${source}) : incident de chaîne`);
      const v = vues.get(id);
      if (!v) { vues.set(id, n); continue; }
      // Évolution normale : non terminé -> terminé ; startedAt null -> date.
      if (v.startedAt && n.startedAt && v.startedAt !== n.startedAt) refuser(`exécution ${id} : observations contradictoires (startedAt)`);
      if (v.stoppedAt && n.stoppedAt && v.stoppedAt !== n.stoppedAt) refuser(`exécution ${id} : observations contradictoires (stoppedAt)`);
      const tv = STATUTS_TERMINAUX.includes(v.status);
      const tn = STATUTS_TERMINAUX.includes(n.status);
      if (tv && tn && v.status !== n.status) refuser(`exécution ${id} : deux statuts terminaux différents`);
      if (tv && !tn) refuser(`exécution ${id} : retour d'un statut terminal à un statut non terminal (contradiction)`);
      vues.set(id, { ...v, ...n, startedAt: n.startedAt || v.startedAt, stoppedAt: n.stoppedAt || v.stoppedAt });
    }
  };
  // Requêtes « en vol » D'ABORD, liste complète ENSUITE : une exécution vue en cours
  // puis terminée est une évolution normale ; l'inverse est une contradiction.
  const requete = async (q, source) => {
    let r;
    try { r = await api.listerExecutions(q); } catch (e) { if (suivi) suivi.vues = [...vues.values()]; throw e; }
    ajouter(r, source);
  };
  for (const status of ['running', 'waiting']) await requete({ workflowId, status }, `status=${status}`);
  await requete({ workflowId }, 'liste');
  // Toute exécution TERMINALE observée (quel que soit son lot) doit avoir des dates
  // renseignées et cohérentes ; sinon observation inexploitable -> incident de chaîne.
  for (const v of vues.values()) {
    if (STATUTS_TERMINAUX.includes(v.status)) {
      if (!v.startedAt || !v.stoppedAt) refuser(`exécution ${v.id} terminée sans startedAt/stoppedAt : incident de chaîne`);
      if (v.stoppedAt < v.startedAt) refuser(`exécution ${v.id} terminée avant d'avoir démarré : incident de chaîne`);
    }
  }
  return [...vues.values()];
}

// --- Projection du récapitulatif (§11 bis) -------------------------------------------
function projeterRecapitulatif(candidatLot, coeur, moteur) {
  const nul = (v) => (v === undefined ? null : v);
  const garde = new Set(coeur.selection);
  const ecarte = new Set(coeur.ecartees);
  return {
    schema: 'recapitulatif-fonda/v1', set_id: candidatLot.set_id, notion_id: candidatLot.notion_id, palier: candidatLot.palier,
    moteur: { version: moteur.version, sha256: moteur.sha256 },
    empreinte_relue: coeur.empreinte_relue, empreinte_publiee: coeur.empreinte_publiee,
    cartes_gardees: candidatLot.cartes.filter((c) => garde.has(c.item_id)).map((c) => ({
      item_id: c.item_id, question: c.question, reponse: nul(c.reponse), profil_correction: c.profil_correction,
      reponses_acceptees: c.reponses_acceptees, unite: nul(c.unite), arrondi: nul(c.arrondi), seconde_chance: nul(c.seconde_chance),
    })),
    cartes_ecartees: candidatLot.cartes.filter((c) => ecarte.has(c.item_id)).map((c) => ({ item_id: c.item_id, question: c.question })),
  };
}

// Rendu HUMAIN du récapitulatif (§3.3, §11 bis) : affiché pour la confirmation et
// exporté tel quel pour la transmission ; comportements par défaut explicités.
function rendreRecapitulatif(r) {
  const val = (v, defaut) => (v === null ? defaut : String(v));
  const lignes = [
    `Récapitulatif de relecture — ${r.set_id} (${r.notion_id}, palier ${r.palier})`,
    `Moteur de correction : ${r.moteur.version} (${r.moteur.sha256})`,
    `Empreinte relue : ${r.empreinte_relue}`, `Empreinte publiée : ${r.empreinte_publiee}`, '',
    `CARTES GARDÉES (${r.cartes_gardees.length}) :`,
  ];
  r.cartes_gardees.forEach((c, i) => {
    lignes.push(`${i + 1}. [${c.item_id}] ${c.question}`,
      `   Réponse attendue : ${val(c.reponse, '(non renseignée)')}`,
      `   Règle de correction : profil ${c.profil_correction}`,
      `   Réponses acceptées : ${c.reponses_acceptees.map((x) => JSON.stringify(x)).join(' | ')}`,
      `   Unité : ${val(c.unite, 'aucune (par défaut)')} ; arrondi : ${val(c.arrondi, 'aucun (par défaut)')} ; seconde chance : ${c.seconde_chance === null ? 'non (par défaut)' : (c.seconde_chance ? 'oui' : 'non')}`);
  });
  lignes.push('', `CARTES ÉCARTÉES (${r.cartes_ecartees.length}) :`);
  r.cartes_ecartees.forEach((c) => lignes.push(`- [${c.item_id}] ${c.question}`));
  return lignes.join('\n');
}

// Lot publié = lot SOURCE filtré sur la sélection, dans l'ordre du lot source.
function lotPublie(lotSource, coeur) {
  const garde = new Set(coeur.selection);
  const cartes = lotSource.cartes.filter((c) => garde.has(c.item_id));
  return { ...lotSource, revue_carte_par_carte: true, nb_cartes: cartes.length, cartes };
}

function choisirBadge(mode, relecteur, tableRelecteurs) {
  if (mode === 'auto') return { forme: 'relue_par', nom_affiche: 'Éric Duchateau', id: 'eric' };
  const nom = tableRelecteurs && Object.prototype.hasOwnProperty.call(tableRelecteurs, relecteur) ? tableRelecteurs[relecteur] : null;
  if (typeof nom === 'string' && nom.trim() !== '') return { forme: 'relue_et_validee', nom_affiche: nom, id: relecteur };
  return { forme: 'relue_par', nom_affiche: 'un professeur', id: null };
}

// Décision figée conforme à decision-fonda/v1 (forme canonique + valeurs de base).
function decisionConforme(d) {
  try { Canonique.octetsContrat('decision-fonda/v1', d); } catch { return false; }
  return d.schema === 'decision-fonda/v1' && C.SET_ID_PATTERN.test(d.set_id) && Number.isSafeInteger(d.generation) && d.generation >= 0
    && d.nonce.trim() !== '' && S.dateSignee(d.recu_le) && d.hash_formulaire.trim() !== '';
}

const lireJson = (octets) => { try { return JSON.parse(Buffer.from(octets).toString('utf8')); } catch { return undefined; } };
const dossierDecisionLocale = (dossier, setId) => path.join(dossier, setId);
const NOM_DECISION_LOCALE = 'decision.json';

// --- §20.6 Saisie locale : brouillon -> décision figée --------------------------------------
// Le script présente chaque carte du lot généré ; Éric choisit garder/ecarter carte par
// carte (brouillon : rien n'est écrit, tout est corrigeable). La décision est FIGÉE à
// l'écriture exclusive de <dossier>/<set_id>/decision.json (hors dépôt, hors Dropbox),
// avec nonce aléatoire, generation = 0, recu_le = instant de l'écriture,
// hash_formulaire = "saisie-locale". Elle ne se corrige plus (erreur -> abandon).
// N'appelle aucun signataire : la garde maîtresse ne concerne que la signature.
// deps = { config: { dossier, workflowGeneration }, api, drive: { lireLotGenere }, referentielArchive, moteur, registre, fs,
//         horloge, saisir, afficher, aleatoire? }
// Relecteur attribué selon le référentiel ARCHIVÉ désigné par la sortie de l'UNIQUE
// exécution réussie de génération de ce set_id ; toute ambiguïté ou lecture impossible
// -> refus (aucune saisie).
async function relecteurDeLaGeneration(setId, deps) {
  let execs;
  try { execs = await observer(deps.api, deps.config.workflowGeneration); } catch (e) { refuser(`génération illisible (${e.message}) : saisie impossible`); }
  const sorties = [];
  for (const x of execs.filter((e) => e.status === 'success')) {
    const brute = await deps.api.lireExecution(x.id);
    const entree = brute ? L.itemUnique(brute, L.NOEUD_ENTREE) : { ok: false };
    if (!entree.ok || entree.json.set_id !== setId) continue;
    const sortie = L.itemUnique(brute, L.NOEUD_SORTIE);
    if (!sortie.ok) refuser(`exécution ${x.id} : sortie de génération inexploitable — saisie impossible`);
    sorties.push(sortie.json);
  }
  if (sorties.length !== 1) refuser(`${sorties.length} exécution(s) de génération réussie(s) pour ${setId} : relecteur attribué non déterminable — saisie impossible`);
  const v = sorties[0].referentiel_version;
  let octets;
  try { octets = await deps.referentielArchive(v); } catch (e) { refuser(`référentiel archivé ${v} introuvable (${e.message}) — saisie impossible`); }
  if (!octets || `sha256:${sha256Hex(Buffer.from(octets))}` !== v) refuser('référentiel archivé ≠ referentiel_version — saisie impossible');
  const ref = lireJson(octets);
  const n = ref && Array.isArray(ref.notions) ? ref.notions.find((x) => x && x.id === sorties[0].notion_id) : null;
  if (!n) refuser('notion absente du référentiel archivé — saisie impossible');
  return n.relecteur;
}

async function saisirDecisionLocale(setId, deps) {
  if (!C.SET_ID_PATTERN.test(setId || '')) refuser('set_id invalide');
  verifierDossierLocal(deps.config.dossier, deps.fs && deps.fs.realpath);
  const dossier = dossierDecisionLocale(deps.config.dossier, setId);
  verifierDossierLocal(dossier, deps.fs && deps.fs.realpath);
  const chemin = path.join(dossier, NOM_DECISION_LOCALE);
  let occupee;
  try { occupee = deps.fs.existe(chemin); } catch (e) { refuser(`${chemin} inaccessible (${e.code || e.message})`); }
  if (occupee !== false) refuser(`${chemin} existe déjà : une décision figée ne se réécrit jamais (erreur -> abandon du set_id)`, 'local');
  const lu = await deps.drive.lireLotGenere(setId);
  const lot = lu ? lireJson(lu.octets) : undefined;
  if (!lot || !C.validerLot(lot).valide || lot.set_id !== setId) refuser('lot généré illisible ou non conforme', 'local');
  // §20.6 : Éric ne saisit JAMAIS les décisions d'un autre relecteur — vérifié AVANT toute
  // saisie, contre le référentiel ARCHIVÉ de la génération (sortie de l'unique exécution
  // réussie de ce set_id), comme à la clôture (§20.12).
  const relecteur = await relecteurDeLaGeneration(setId, deps);
  if (relecteur !== 'eric') refuser(`saisie locale réservée au relecteur « eric » (relecteur attribué : ${relecteur}) — §20.6`, 'refus');
  const moteur = deps.moteur;
  const reg = (deps.registre || []).find((l) => l && moteur && l.version === moteur.version);
  if (!reg || reg.sha256 !== moteur.sha256) refuser('moteur ≠ registre moteurs.json');
  const cartes = [];
  for (const [i, c] of lot.cartes.entries()) {
    deps.afficher([`Carte ${i + 1}/${lot.cartes.length} [${c.item_id}] ${c.question}`, `  Réponse attendue : ${c.reponse === undefined ? '(non renseignée)' : c.reponse}`,
      `  Profil : ${c.profil_correction} ; réponses acceptées : ${c.reponses_acceptees.map((x) => JSON.stringify(x)).join(' | ')}`,
      `  Unité : ${c.unite === undefined ? 'aucune (par défaut)' : c.unite} ; arrondi : ${c.arrondi === undefined ? 'aucun (par défaut)' : c.arrondi} ; seconde chance : ${c.seconde_chance === undefined ? 'non (par défaut)' : (c.seconde_chance ? 'oui' : 'non')}`,
      `  Contexte : ${c.contexte === undefined ? '(aucun)' : c.contexte}`].join('\n'));
    let choix;
    for (;;) {
      choix = (await deps.saisir('garder / ecarter : ')).trim();
      if (choix === 'garder' || choix === 'ecarter') break;
      deps.afficher('Réponse attendue : garder ou ecarter.');
    }
    cartes.push({ item_id: c.item_id, choix });
  }
  const gardees = cartes.filter((c) => c.choix === 'garder').map((c) => c.item_id);
  const ecartees = cartes.filter((c) => c.choix === 'ecarter').map((c) => c.item_id);
  deps.afficher(`Brouillon : ${gardees.length} gardée(s) [${gardees.join(', ')}], ${ecartees.length} écartée(s) [${ecartees.join(', ')}].`);
  if ((await deps.saisir('Figer cette décision (oui/non) ? Elle ne pourra plus être corrigée : ')).trim() !== 'oui') return { figee: false };
  const sha = C.sha256WebCrypto();
  const filtre = { ...lot, revue_carte_par_carte: true, nb_cartes: gardees.length, cartes: lot.cartes.filter((c) => gardees.includes(c.item_id)) };
  const coeur = {
    action: gardees.length ? 'accepter' : 'rejeter', selection: gardees, ecartees,
    empreinte_relue: await C.calculerEmpreinte(lot, sha), empreinte_publiee: gardees.length ? await C.calculerEmpreinte(filtre, sha) : await C.calculerEmpreinte(lot, sha),
    moteur: { version: moteur.version, sha256: moteur.sha256 },
  };
  const aleatoire = deps.aleatoire || (() => crypto.randomBytes(16).toString('hex'));
  const decision = {
    schema: 'decision-fonda/v1', set_id: setId, generation: 0, nonce: aleatoire(), recu_le: deps.horloge().toISOString(), coeur,
    lot_relu: { set_id: setId, empreinte_complete: L.empreinteComplete(lot), cartes }, hash_formulaire: 'saisie-locale',
  };
  if (!decisionConforme(decision)) refuser('décision construite non conforme (bug)');
  deps.fs.ecrireExclusif(chemin, `${JSON.stringify(decision, null, 2)}\n`);
  return { figee: true, chemin, decision };
}

/**
 * Clôture signée d'un set_id — charge attestation-cloture/v2 (CDC v8.3 §20.9).
 * deps = {
 *   rattachement,            // contrat n8n <-> lot — ABSENT EN PRODUCTION => refus (garde maîtresse)
 *   api,                     // { listerExecutions({ workflowId, status }), lireExecution(id) -> exécution avec données | null }
 *   config: { source: 'page_relecture'|'saisie_locale', workflowGeneration, workflowConfirmation, workflowCloture,
 *             dossier, cleId, modelesAutorises },
 *   drive: { lireLotGenere(setId) -> { id, nom, modifie_le, octets } | null,
 *            listerCandidats() -> { incompleteSearch, fichiers: [{ id, nom, modifie_le, properties, proprietesLisibles }] },
 *            lireCandidat(setId), listerDecisions(setId) },          // page_relecture seulement
 *   journal(commit) -> { surPremierParent, journal },               // historique de confiance de design
 *   decisionsLocales(setId) -> [{ nom, octets }],                  // saisie_locale : fichiers de <dossier>/<set_id>/
 *   incidents(), referentielArchive(version) -> octets, tableRelecteurs, fs, signer, cles, registre,
 *   horloge(), saisir(question), afficher(texte), levees,
 * }
 * Ordre : garde ; lot généré lu AVANT le listing ; LISTING en intervalle [listing_debut_le,
 * listing_fin_le] (toutes sources) ; lot relu APRÈS (stabilité observée) ; évaluation
 * COMPLÈTE avec constats classés (§20.13 : incident > abandon > refus temporaire > arrêt
 * local) ; puis seulement instantané, confirmation, charge v2, signature.
 * @returns {Promise<{ enveloppe, dossierLot, lotPublie }>} ; lève Refus (avec .issue) sinon.
 */
async function cloturer(setId, deps) {
  // ── Garde maîtresse ──
  if (typeof deps.rattachement !== 'function') refuser('contrat de rattachement exécution n8n <-> lot NON DÉFINI (§11 bis) : signature refusée', 'precondition');
  const { config, api, drive, rattachement } = deps;
  if (!C.SET_ID_PATTERN.test(setId || '')) refuser('set_id invalide', 'precondition');
  if (!S.SOURCES.includes(config.source)) refuser(`config.source : ${S.SOURCES.join(' | ')} attendu`, 'precondition');
  if (!S.modelesValides(config.modelesAutorises)) refuser('config.modelesAutorises : liste épinglée d\'identifiants Sonnet DATÉS requise (G5, §20.8) — aucun repli', 'precondition');
  if (typeof config.workflowGeneration !== 'string' || !config.workflowGeneration) refuser('config.workflowGeneration : workflow de génération épinglé requis', 'precondition');
  verifierDossierLocal(config.dossier, deps.fs && deps.fs.realpath);
  const page = config.source === 'page_relecture';
  const levees = deps.levees || [];
  const constats = new L.Constats();
  // Lectures : un échec n'interrompt PAS l'évaluation ; il devient un constat (accès
  // insuffisant 401/403 -> incident ; panne -> refus temporaire) et les évaluations qui
  // dépendent de la donnée manquante sont sautées (aucune issue déduite d'un manque).
  // Lectures en échec : l'observation est INCOMPLÈTE (règle §20.13, amendement r6).
  const lecturesEnEchec = [];
  const enEchec = (quoi, e) => {
    lecturesEnEchec.push(quoi);
    if (e && (e.statut === 401 || e.statut === 403)) constats.ajouter('incident', `${quoi} : accès insuffisant (${e.statut}) — incident de chaîne`);
    else constats.ajouter('temporaire', `${quoi} injoignable ou en erreur (${e && e.message}) : relancer`);
  };
  const lire = async (quoi, f) => {
    try { return { ok: true, v: await f() }; } catch (e) { if (e instanceof Refus) throw e; enEchec(quoi, e); return { ok: false }; }
  };
  const observerSur = async (quoi, workflowId) => {
    const suivi = {};
    try { return { ok: true, v: await observer(api, workflowId, suivi) }; } catch (e) {
      if (e instanceof Refus) constats.ajouter('incident', `${quoi} : observations contradictoires ou inexploitables (${e.message})`);
      else enEchec(`${quoi} (API n8n)`, e);
      // Exécutions en vol DÉJÀ observées avant la panne : incident (jamais perdu).
      for (const v of suivi.vues || []) {
        if (!STATUTS_TERMINAUX.includes(v.status)) constats.ajouter('incident', `${quoi} : exécution ${v.id} non terminée ou de statut inconnu (${v.status}), observée avant la panne`);
        else if (!v.startedAt || !v.stoppedAt || v.stoppedAt < v.startedAt) constats.ajouter('incident', `${quoi} : exécution ${v.id} terminée sans dates cohérentes, observée avant la panne`);
      }
      return { ok: false };
    }
  };

  // ── Lot généré : lu AVANT le listing ──
  const lotAvant = await lire('Drive (lot généré)', () => drive.lireLotGenere(setId));

  // ── LISTING en intervalle (§20.7) : toutes les sources ──
  const listingDebut = deps.horloge().toISOString();
  const gen = await observerSur('workflow de génération', config.workflowGeneration);
  const details = new Map();
  if (gen.ok) {
    for (const x of gen.v) {
      const r = await lire(`API n8n (exécution ${x.id})`, () => api.lireExecution(x.id));
      details.set(x.id, r.ok ? r.v : L.INDISPONIBLE);
    }
  }
  const cand = await lire('Drive (candidats/)', () => drive.listerCandidats());
  let candidatEnv = { ok: false }; let clotures = { ok: false }; let confirmations = { ok: false }; let listeDecisions = { ok: false }; let locales = { ok: false };
  if (page) {
    candidatEnv = await lire('Drive (candidat)', () => drive.lireCandidat(setId));
    const cl = await observerSur('workflow de clôture', config.workflowCloture);
    clotures = cl; // TOUTES les observations : non attribuables et en vol examinées (evaluerPage)
    confirmations = await observerSur('workflow de confirmation', config.workflowConfirmation);
    listeDecisions = await lire('Drive (decisions/)', () => drive.listerDecisions(setId));
  } else {
    locales = await lire('dossier local (décisions)', () => deps.decisionsLocales(setId));
  }
  const inc = await lire('incidents', () => deps.incidents());
  const listingFin = deps.horloge().toISOString();
  // ── Lot généré : relu APRÈS le listing (stabilité observée, pas un verrou) ──
  const lotApres = await lire('Drive (lot généré)', () => drive.lireLotGenere(setId));

  // ═══ Évaluation complète : constats classés, aucune écriture ═══
  let fichiersCandidats = null;
  if (cand.ok) {
    if (!cand.v || !Array.isArray(cand.v.fichiers)) constats.ajouter('incident', 'listing de candidats/ illisible');
    else {
      fichiersCandidats = cand.v.fichiers;
      if (cand.v.incompleteSearch === true && !levees.some((l) => l.type === 'recherche_incomplete')) constats.ajouter('temporaire', 'recherche Drive incomplète (candidats/) sans levée explicite');
    }
  }
  // §20.2 : examen de chaque exécution (fusion détail/listing, incident GLOBAL, déclencheur)
  // dès que le listing est disponible ; classement selon les données observées.
  // Fichiers candidats/ examinés SEULS dès que leur listing est lu (indépendant de n8n).
  const vueFichiers = fichiersCandidats ? L.examinerFichiers({ setId, fichiers: fichiersCandidats, constats }) : L.INDISPONIBLE;
  let retenue = null; let candidate = null; let fichier = vueFichiers === L.INDISPONIBLE ? L.INDISPONIBLE : vueFichiers.fichier;
  if (gen.ok) {
    const ex = L.examinerExecutions({ executions: gen.v, details, constats, normaliserDate });
    const r = L.classerExecutions({ setId, examinees: ex.examinees, complet: ex.complet, vueFichiers, constats });
    retenue = r.retenue === L.INDISPONIBLE ? null : r.retenue;
    candidate = r.candidate;
    fichier = r.fichier;
  }
  const fichierVu = fichier && fichier !== L.INDISPONIBLE ? fichier : null;
  // Génération OBSERVÉE (retenue, sinon l'unique réussie vue) : sert à TOUS les contrôles
  // qui n'exigent pas l'exhaustivité ; la signature, elle, exige `retenue` (examen complet).
  const generationObservee = retenue || candidate;
  // Lot source (§20.4, §20.7)
  let lotSource = null;
  const lotsConformes = []; // contenus conformes DISTINCTS lus (tous comparés à la génération)
  // CONTENU contrôlé sur toute lecture disponible (avant et/ou après) ; STABILITÉ prouvée
  // seulement si les deux lectures existent (une lecture en panne est déjà constatée
  // « temporaire » : la signature reste impossible, mais les anomalies observées sont
  // classées à leur rang).
  const av = lotAvant.ok ? lotAvant.v : undefined;
  const ap = lotApres.ok ? lotApres.v : undefined;
  if (av === null || ap === null) constats.ajouter('abandon', `lot généré ${setId}.lot.json absent`);
  const lus = [av, ap].filter(Boolean);
  // DATES de modification : toutes les observations disponibles (lectures ET listing de
  // candidats/), indépendamment de la lecture du contenu.
  const datesLot = [...lus.map((x) => x.modifie_le), ...(fichierVu ? [fichierVu.modifie_le] : [])].map((dt) => normaliserDate(dt));
  if (datesLot.length) {
    if (new Set(datesLot).size > 1) constats.ajouter('temporaire', 'lot généré instable pendant le listing (dates de modification différentes entre lectures et listing) : relancer la clôture');
    if (datesLot.some((dt) => dt === null)) constats.ajouter('incident', 'lot généré : date de modification illisible');
    else if (generationObservee && generationObservee.x.stoppedAt && datesLot.some((dt) => dt > generationObservee.x.stoppedAt)) constats.ajouter('abandon', 'lot généré modifié APRÈS la fin de l\'exécution de génération');
  }
  if (lus.length) {
    if (av && ap && (av.id !== ap.id || !Buffer.from(av.octets).equals(Buffer.from(ap.octets)))) {
      constats.ajouter('temporaire', 'lot généré instable pendant le listing (identifiant ou contenu différents entre les deux lectures) : relancer la clôture');
    }
    if (fichierVu && lus.some((x) => x.id !== fichierVu.id)) constats.ajouter('abandon', 'lot généré lu ≠ fichier candidat retenu');
    // Identité de CHAQUE fichier effectivement lu : nom exact (indépendant du listing).
    if (lus.some((x) => x.nom !== `${setId}.lot.json`)) constats.ajouter('abandon', `fichier lu : nom ≠ ${setId}.lot.json`);
    // Chaque contenu DISTINCT lu est contrôlé ; le premier conforme sert aux comparaisons.
    const vus = new Set();
    for (const x of lus) {
      const cle = Buffer.from(x.octets).toString('hex');
      if (vus.has(cle)) continue;
      vus.add(cle);
      const lot = lireJson(x.octets);
      if (lot === undefined) { constats.ajouter('incident', 'lot généré illisible (JSON invalide) : incident de chaîne'); continue; }
      const v = C.validerLot(lot);
      const nuls = v.valide ? L.nullsExplicites(lot) : [];
      if (!v.valide) constats.ajouter('abandon', `lot généré non conforme à lot-fonda/v1 : ${v.erreurs.join(' ; ')}`);
      else if (nuls.length) constats.ajouter('abandon', `lot généré : null explicite interdit (${nuls.join(', ')})`);
      else if (lot.set_id !== setId) constats.ajouter('abandon', 'lot généré : set_id ≠ set_id demandé');
      else if (!C.decomposerSetId(setId) || lot.palier !== C.decomposerSetId(setId).palier || C.slugDeNotion(lot.notion_id) !== C.decomposerSetId(setId).slug) constats.ajouter('abandon', 'lot généré : palier / notion ≠ ceux encodés dans set_id');
      else { lotsConformes.push(lot); if (!lotSource) lotSource = lot; }
    }
  }
  const sha = C.sha256WebCrypto();
  const empreintes = lotSource ? { pedagogique: await C.calculerEmpreinte(lotSource, sha), complete: L.empreinteComplete(lotSource) } : null;
  // §20.3 rapprochement
  let sortie = null;
  const generationEvaluee = generationObservee;
  if (generationEvaluee) {
    const brute = details.get(generationEvaluee.x.id);
    const s0 = brute ? L.itemUnique(brute, L.NOEUD_SORTIE) : { ok: false };
    const commit = s0.ok && typeof s0.json.journal_commit === 'string' && /^[0-9a-f]{40}$/.test(s0.json.journal_commit) ? s0.json.journal_commit : null;
    const jc = commit ? await lire('historique de confiance (journal)', () => deps.journal(commit)) : { ok: true, v: null };
    sortie = L.rapprocher({ setId, retenue: generationEvaluee, fichier, brute: brute === L.INDISPONIBLE ? null : brute, workflowId: config.workflowGeneration, journalCommit: jc.ok ? jc.v : L.INDISPONIBLE, registre: deps.registre, modelesAutorises: config.modelesAutorises, lotSource, empreintes, constats });
  }
  // Identité du fichier lu contre la SORTIE de génération (indépendant du listing Drive).
  if (sortie && lus.some((x) => x.id !== sortie.candidat_fichier_id)) constats.ajouter('abandon', 'fichier lu : identifiant ≠ candidat_fichier_id de la génération');
  // CHAQUE contenu conforme lu (pas seulement le premier) comparé aux empreintes de la
  // génération : une discordance constatée est un abandon, prioritaire sur l'instabilité.
  if (sortie) {
    for (const lot of lotsConformes.slice(1)) {
      if (await C.calculerEmpreinte(lot, sha) !== sortie.empreinte_pedagogique) constats.ajouter('abandon', 'seconde lecture du lot : empreinte_pedagogique ≠ génération');
      if (L.empreinteComplete(lot) !== sortie.empreinte_complete) constats.ajouter('abandon', 'seconde lecture du lot : empreinte_complete ≠ génération');
    }
  }
  // Référentiel ARCHIVÉ de la version de la sortie (§20.12) et relecteur attribué.
  let referentiel = null; let relecteur = null;
  if (sortie && /^sha256:[0-9a-f]{64}$/.test(sortie.referentiel_version)) {
    let octets = null;
    try { octets = await deps.referentielArchive(sortie.referentiel_version); } catch (e) { constats.ajouter('abandon', `referentiel_version introuvable sur l'historique de confiance (${e.message})`); }
    if (octets) {
      if (`sha256:${sha256Hex(Buffer.from(octets))}` !== sortie.referentiel_version) constats.ajouter('abandon', 'référentiel archivé ≠ referentiel_version');
      else {
        referentiel = lireJson(octets);
        const n = referentiel && Array.isArray(referentiel.notions) ? referentiel.notions.find((x) => x && x.id === sortie.notion_id) : null;
        if (!n) constats.ajouter('abandon', 'notion absente du référentiel archivé');
        else relecteur = n.relecteur;
      }
    }
  }

  // Parcours page, référentiel non résolu par la génération : relecteur du candidat
  // contrôlé contre SON référentiel archivé déclaré (garde-fou 1).
  if (page && relecteur === null && candidatEnv.ok && candidatEnv.v && candidatEnv.v.relecture && candidatEnv.v.lot) {
    const rel = candidatEnv.v.relecture;
    let oct = null;
    try { oct = /^sha256:[0-9a-f]{64}$/.test(rel.referentiel_version || '') ? await deps.referentielArchive(rel.referentiel_version) : null; } catch { oct = null; }
    const ref = oct && `sha256:${sha256Hex(Buffer.from(oct))}` === rel.referentiel_version ? lireJson(oct) : null;
    const n = ref && Array.isArray(ref.notions) ? ref.notions.find((x) => x && x.id === candidatEnv.v.lot.notion_id) : null;
    if (n && n.relecteur !== rel.relecteur_attribue) constats.ajouter('abandon', 'relecteur attribué du candidat ≠ son référentiel archivé');
  }
  // ── Décisions ──
  const decisions = [];
  let fenetre = null; // fenêtre de candidature (§10 B ; §20.6 en saisie locale)
  let derniere = null; let duLot = []; let revoqueLe = null; let finSaisie = null;
  if (page) {
    const ev = evaluerPage({ setId, candidatEnv, clotures, confirmations, listeDecisions, rattachement, levees, constats, sortie, relecteur, empreintes, listingDebut });
    decisions.push(...ev.decisions); ({ derniere, duLot, revoqueLe, fenetre } = ev);
  } else {
    if (relecteur !== null && relecteur !== 'eric') constats.ajouter('refus', `saisie locale réservée au relecteur « eric » (relecteur attribué : ${relecteur}) — §20.6`);
    if (locales.ok) {
      const lus = (locales.v || []).map((f) => ({ nom: f.nom, d: lireJson(f.octets), octets: Buffer.from(f.octets) }));
      if (!lus.length) constats.ajouter('local', `aucune décision figée dans ${dossierDecisionLocale(config.dossier, setId)} : lancer la saisie locale`);
      for (const f of lus) if (f.d === undefined) constats.ajouter('incident', `décision locale ${f.nom} illisible`);
      const conformes = lus.filter((f) => f.d !== undefined);
      if (new Set(conformes.map((f) => f.octets.toString('hex'))).size > 1) constats.ajouter('abandon', 'deux décisions figées distinctes pour ce set_id : conflit');
      for (const f of conformes) {
        const d = f.d;
        if (!decisionConforme(d)) { constats.ajouter('abandon', `décision figée ${f.nom} non conforme à decision-fonda/v1`); continue; }
        if (d.set_id !== setId || d.generation !== 0 || d.hash_formulaire !== 'saisie-locale') { constats.ajouter('abandon', `décision figée ${f.nom} : set_id, generation = 0 ou hash_formulaire = « saisie-locale » non respectés`); continue; }
        decisions.push(d);
      }
      if (decisions.length) {
        finSaisie = decisions[0].recu_le;
        if (generationObservee && generationObservee.x.startedAt) fenetre = { debut: generationObservee.x.startedAt, fin: finSaisie };
      }
    }
  }
  // §20.5 réconciliation de CHAQUE décision (tardives comprises), puis unicité
  if (decisions.length) {
    // Unicité (§10 A) : indépendante du lot ; réconciliation : exige le lot source.
    for (const err of L.unicite(decisions)) constats.ajouter('abandon', `unicité (§10 A) : ${err}`);
    // Empreintes de référence : celles du lot lu, sinon celles de la sortie de génération.
    const reference = empreintes || (sortie ? { pedagogique: sortie.empreinte_pedagogique, complete: sortie.empreinte_complete } : null);
    // Contrôles INTRINSÈQUES toujours faits ; comparaisons d'empreintes si une référence existe.
    const empreintePubliee = async (gardees) => C.calculerEmpreinte(lotPublie(lotSource, { selection: gardees }), sha);
    for (const d of decisions) for (const err of await L.reconcilier(d, { setId, lotSource, empreintes: reference, empreintePubliee })) constats.ajouter('abandon', `réconciliation : ${err}`);
    const co = decisions[0].coeur;
    if (co.action !== 'accepter') constats.ajouter('abandon', `action « ${co.action} » : rien à publier`);
    // Garde-fou 1 (§20.13 r6) : déterminables sur leurs propres données.
    const reg = (deps.registre || []).find((l) => l && l.version === co.moteur.version);
    if (!reg || reg.sha256 !== co.moteur.sha256) constats.ajouter('abandon', 'coeur.moteur absent du registre moteurs.json');
    if (page && candidatEnv.ok && candidatEnv.v && candidatEnv.v.relecture) {
      const rel = candidatEnv.v.relecture;
      if (!rel.moteur || rel.moteur.version !== co.moteur.version || rel.moteur.sha256 !== co.moteur.sha256) constats.ajouter('abandon', 'moteur du candidat ≠ moteur du cœur');
    }
    if (sortie && (co.moteur.version !== sortie.moteur.version || co.moteur.sha256 !== sortie.moteur.sha256)) constats.ajouter('abandon', 'coeur.moteur ≠ moteur de la génération');
  }
  // Lot publié et garde-fous du MOTEUR, clé déclarée et recevable : évalués AVANT la
  // tranche (matrice §20.13), revérifiés ensuite.
  let publie = null;
  if (lotSource && decisions.length && decisions[0].coeur.action === 'accepter') {
    const co = decisions[0].coeur;
    publie = lotPublie(lotSource, co);
    const vl = C.validerLot(publie);
    if (!vl.valide) constats.ajouter('abandon', `lot publié non conforme : ${vl.erreurs.join(' ; ')}`);
    let m = null;
    try { m = chargerMoteurNode(co.moteur.version, co.moteur.sha256, deps.registre); } catch (e) { constats.ajouter('abandon', `moteur du cœur non chargeable : ${e.message}`); }
    if (m) {
      for (const c of publie.cartes) {
        if (!m.valider(c).valide) constats.ajouter('abandon', `${c.item_id} refusée par le moteur ${co.moteur.version}`);
        else if (!m.outils.verifierReponseOr(c).ok || !m.outils.verifierFormesAcceptees(c).ok) constats.ajouter('abandon', `${c.item_id} : garde-fous du moteur non respectés`);
      }
    }
  }
  const k0 = deps.cles.obtenir(config.cleId);
  if (!k0.ok) constats.ajouter('temporaire', k0.raison);
  else { const irr = S.recevabilite(k0.declaration, new Date(Date.parse(listingFin)).toISOString()); if (irr) constats.ajouter('temporaire', irr); }
  // Antécédents LOCAUX de ce set_id, AVANT la tranche : marqueur de signature (une
  // signature a déjà été tentée -> jamais une seconde) ; clôture antérieure dont
  // l'instantané diffère de celui que ces données produiraient -> abandon.
  const marqueurSignature = path.join(config.dossier, `${setId}.signature`);
  let dejaSigne;
  try { dejaSigne = deps.fs.existe(marqueurSignature); } catch (e) { dejaSigne = undefined; enEchec(`${marqueurSignature}`, e); }
  if (dejaSigne !== false && dejaSigne !== undefined) constats.ajouter('local', `signature déjà tentée pour ${setId} (${marqueurSignature}) : jamais une seconde — traitement manuel`);
  let codeAttendu = null;
  if (lotSource && decisions.length) {
    const co = decisions[0].coeur;
    const inst0 = { schema: 'instantane-fonda/v1', set_id: setId, candidat_lot: lotSource, coeur: co, lot_relu: decisions[0].lot_relu, moteur: co.moteur, recapitulatif: projeterRecapitulatif(lotSource, co, co.moteur) };
    codeAttendu = sha256Hex(Buffer.from(`${JSON.stringify(inst0, null, 2)}\n`, 'utf8')).slice(0, 16);
  }
  let entreesDossier = null;
  try { entreesDossier = deps.fs.lister(config.dossier); } catch (e) { enEchec(`dossier de clôture ${config.dossier}`, e); }
  const anterieures = (entreesDossier || []).filter((nom) => nom.startsWith(`${setId}-`));
  if (anterieures.length > 1) constats.ajouter('abandon', `${anterieures.length} clôtures antérieures aux instantanés distincts pour ${setId} : données modifiées après un figement — abandon du set_id`);
  for (const nom of entreesDossier || []) {
    if (nom.startsWith(`${setId}-`) && codeAttendu && nom !== `${setId}-${codeAttendu}`) constats.ajouter('abandon', `clôture antérieure ${nom} : instantané figé sur d'AUTRES données (décision ou lot modifiés) — abandon du set_id`);
  }
  // Incidents (§10 B) : fenêtre de candidature de la source
  const incidents = [];
  for (const i of (inc.ok ? inc.v : null) || []) {
    if (!i || typeof i.id !== 'string' || !i.id || typeof i.nature !== 'string' || !i.periode) { constats.ajouter('incident', 'incident illisible'); continue; }
    if (i.statut !== 'resolu') { constats.ajouter('incident', `incident ${i.id} ouvert : toute clôture signée est suspendue`); continue; }
    const detecte = normaliserDate(i.detecte_le);
    const resolu = normaliserDate(i.resolu_le);
    const debut = i.periode.debut === null ? null : normaliserDate(i.periode.debut);
    const fin = normaliserDate(i.periode.fin);
    if (!detecte || !resolu || !fin || (i.periode.debut !== null && !debut) || fin !== resolu || (debut !== null && debut > fin) || detecte > resolu
      || typeof i.preuve_resolution !== 'string' || !i.preuve_resolution.trim()) { constats.ajouter('incident', `incident ${i.id} : dates ou preuve de résolution non conformes`); continue; }
    // Fenêtre complète, ou borne seule connue (fin_saisie_le) : un incident qui CONTIENT la
    // borne recouvre nécessairement la fenêtre (garde-fou 1).
    const contientFin = !fenetre && finSaisie && (debut === null || debut <= finSaisie) && fin >= finSaisie;
    if (contientFin || (fenetre && (debut === null || debut <= fenetre.fin) && fin >= fenetre.debut)) { constats.ajouter('abandon', `incident ${i.id} : sa période recouvre la fenêtre de candidature — abandon et nouveau set_id`); continue; }
    incidents.push({ id: i.id, nature: i.nature, detecte_le: detecte, statut: 'resolu', resolu_le: resolu, preuve_resolution: i.preuve_resolution, periode: { debut, fin } });
  }
  // RÈGLE D'OBSERVATION INCOMPLÈTE (§20.13, amendement r6) : une lecture en panne ->
  // AU MINIMUM un refus temporaire, jamais de signature. Garde-fou 1 : un contrôle
  // déterminable sur SES PROPRES données complètes garde son niveau fin (incident ou
  // abandon établi). Les autres anomalies observées sont listées « à confirmer » : leur
  // issue définitive n'est tranchée qu'à la RELANCE, sur observation complète.
  // Garde-fou 2 : indisponible transitoire -> refus temporaire ; absence définitive
  // (fichier absent, exécution purgée sans retour) -> abandon (§20.13 inchangé).
  const tranche = constats.retenue();
  if (tranche) {
    const autres = constats.liste.filter((c) => c !== tranche).map((c) => `[${c.issue}] ${c.raison}`);
    if (lecturesEnEchec.length && (tranche.issue === 'temporaire' || tranche.issue === 'local' || tranche.issue === 'refus')) {
      const panne = (c) => lecturesEnEchec.some((q) => c.raison.startsWith(q));
      const pannes = constats.liste.filter(panne).map((c) => c.raison);
      const aConfirmer = constats.liste.filter((c) => !panne(c)).map((c) => `[${c.issue}] ${c.raison}`);
      refuser(`observation incomplète (lectures en échec : ${pannes.join(' ; ')}) : refus temporaire, relancer — anomalies observées, à confirmer sur observation complète : ${aConfirmer.length ? aConfirmer.join(' ; ') : 'aucune'}`, 'temporaire');
    }
    const incomplete = lecturesEnEchec.length ? ` [observation incomplète : ${lecturesEnEchec.join(', ')}]` : '';
    refuser(`${tranche.raison}${incomplete}${autres.length ? ` (autres constats : ${autres.join(' ; ')})` : ''}`, tranche.issue);
  }
  // Invariants de complétude (toute donnée manquante a produit un constat ci-dessus).
  if (!retenue || !lotSource || !sortie || !decisions.length || relecteur === null || (page && (!derniere || !revoqueLe))) refuser('évaluation incomplète sans constat (bug) : refus');

  // ═══ Instantané figé + confirmation (§3 ; code calculé APRÈS la décision figée) ═══
  const coeur = decisions[0].coeur;
  const moteur = coeur.moteur;
  publie = lotPublie(lotSource, coeur);
  const vl = C.validerLot(publie);
  if (!vl.valide) refuser(`lot publié non conforme : ${vl.erreurs.join(' ; ')}`, 'abandon');
  const m = chargerMoteurNode(moteur.version, moteur.sha256, deps.registre);
  for (const c of publie.cartes) {
    if (!m.valider(c).valide) refuser(`${c.item_id} refusée par le moteur ${moteur.version}`, 'abandon');
    if (!m.outils.verifierReponseOr(c).ok || !m.outils.verifierFormesAcceptees(c).ok) refuser(`${c.item_id} : garde-fous du moteur non respectés`, 'abandon');
  }
  const recapitulatif = projeterRecapitulatif(lotSource, coeur, moteur);
  const instantane = { schema: 'instantane-fonda/v1', set_id: setId, candidat_lot: lotSource, coeur, lot_relu: decisions[0].lot_relu, moteur, recapitulatif };
  const texteInstantane = `${JSON.stringify(instantane, null, 2)}\n`;
  const shaInstantane = sha256Hex(Buffer.from(texteInstantane, 'utf8'));
  const shaRecap = sha256Hex(Buffer.from(Canonique.octetsContrat('recapitulatif-fonda/v1', recapitulatif)));
  const code = shaInstantane.slice(0, 16);
  const dossierLot = path.join(config.dossier, `${setId}-${code}`);
  verifierDossierLocal(dossierLot, deps.fs && deps.fs.realpath); // destination finale, avant toute écriture
  // Clôture ANTÉRIEURE de ce set_id (recherche par set_id, pas par code) : un dossier
  // <set_id>-<autre code> = instantané figé sur d'autres données -> abandon ; un dossier
  // déjà signé -> refus (jamais deux attestations pour un set_id).
  let entrees;
  try { entrees = deps.fs.lister(config.dossier); } catch (e) { refuser(`${config.dossier} illisible (${e.code || e.message}) : refus`); }
  for (const nom of entrees || []) {
    if (!nom.startsWith(`${setId}-`)) continue;
    if (nom !== `${setId}-${code}`) refuser(`clôture antérieure ${nom} : instantané figé sur d'AUTRES données (décision ou lot modifiés) — abandon du set_id`, 'abandon');
  }
  let signe;
  try { signe = deps.fs.existe(path.join(dossierLot, 'attestation.json')); } catch (e) { refuser(`attestation.json inaccessible (${e.code || e.message}) : refus`); }
  if (signe !== false) refuser(`${dossierLot} : déjà signé ou état indéterminé — jamais deux attestations pour un set_id`, 'local');
  // Instantané écrit UNE fois. S'il existe déjà (reprise après code faux ou fidélité non
  // attestée, §20.13) : relu et vérifié OCTET POUR OCTET, jamais reconstruit ni réécrit.
  const cheminInst = path.join(dossierLot, 'instantane.json');
  const cheminExport = path.join(dossierLot, 'export.json');
  const cheminRecap = path.join(dossierLot, `recapitulatif-${setId}-${code}.txt`);
  const rendu = rendreRecapitulatif(recapitulatif);
  let dejaLa;
  try { dejaLa = deps.fs.existe(cheminInst); } catch (e) { refuser(`${cheminInst} inaccessible (${e.code || e.message}) : refus`); }
  if (dejaLa === true) {
    let ok = false;
    try {
      const exp = JSON.parse(deps.fs.lire(cheminExport).toString('utf8'));
      ok = deps.fs.lire(cheminInst).equals(Buffer.from(texteInstantane, 'utf8')) && exp.sha256_instantane === shaInstantane && exp.sha256_recapitulatif === shaRecap
        && deps.fs.lire(cheminRecap).equals(Buffer.from(`${rendu}\n\n${shaInstantane}\n`, 'utf8'));
    } catch { ok = false; }
    if (!ok) refuser(`reprise : l'instantané existant de ${dossierLot} ne correspond pas aux données relues — traitement manuel (archiver le dossier)`, 'local');
    deps.afficher('Reprise de la confirmation sur l\'instantané EXISTANT (relu et vérifié, non reconstruit).\n');
  } else if (dejaLa === false) {
    deps.fs.ecrireExclusif(cheminInst, texteInstantane);
    deps.fs.ecrireExclusif(cheminExport, `${JSON.stringify({ sha256_instantane: shaInstantane, sha256_recapitulatif: shaRecap, exporte_le: deps.horloge().toISOString() }, null, 2)}\n`);
    deps.fs.ecrireExclusif(cheminRecap, `${rendu}\n\n${shaInstantane}\n`);
  } else refuser(`${cheminInst} : état indéterminé — refus`);
  // §3.4 sur les fichiers RELUS, AVANT la confirmation (puis de nouveau après).
  const verifier34 = () => {
    const relu = deps.fs.lire(cheminInst);
    const exportRelu = JSON.parse(deps.fs.lire(cheminExport).toString('utf8'));
    if (sha256Hex(relu) !== exportRelu.sha256_instantane || exportRelu.sha256_instantane !== shaInstantane) refuser('§3.4 (a) : SHA-256 de instantane.json ≠ export');
    const lu = JSON.parse(relu.toString('utf8'));
    const shaRederive = sha256Hex(Buffer.from(Canonique.octetsContrat('recapitulatif-fonda/v1', projeterRecapitulatif(lu.candidat_lot, lu.coeur, lu.moteur))));
    if (shaRederive !== exportRelu.sha256_recapitulatif || shaRederive !== sha256Hex(Buffer.from(Canonique.octetsContrat('recapitulatif-fonda/v1', lu.recapitulatif)))) refuser('§3.4 (b) : récapitulatif re-dérivé ≠ récapitulatif stocké');
    return lu;
  };
  verifier34();
  deps.afficher(`${rendu}\n\nCODE DE CONFIRMATION : ${code}`);

  const auto = relecteur === 'eric';
  if (!page && !auto) refuser('saisie locale : relecteur attribué ≠ « eric »'); // déjà constaté ; défense en profondeur
  const mode = auto ? 'auto' : (await deps.saisir('Mode de confirmation (vive_voix | reponse_message) : ')).trim();
  if (auto ? mode !== 'auto' : !['vive_voix', 'reponse_message'].includes(mode)) refuser('mode de confirmation invalide (auto réservé au relecteur Éric ; tiers : vive_voix ou reponse_message)', 'local');
  const codeSaisi = (await deps.saisir('Code confirmé (16 hex) : ')).trim();
  if (codeSaisi !== code) refuser('code de confirmation saisi ≠ code de l\'instantané : reprendre la confirmation sur l\'instantané existant (jamais reconstruit)', 'local');
  const confirmationLe = deps.horloge().toISOString();
  if ((await deps.saisir('J\'atteste que le récapitulatif confirmé est celui exporté, transmis sans retouche (oui/non) : ')).trim() !== 'oui') refuser('fidélité de transmission non attestée : reprendre sur l\'instantané existant', 'local');
  const fideliteLe = deps.horloge().toISOString();

  // Contrôles §3.4 de nouveau sur les fichiers RELUS après la confirmation (jamais sur
  // les objets en mémoire).
  const inst = verifier34();
  if (L.empreinteComplete(inst.candidat_lot) !== sortie.empreinte_complete) refuser('instantané : empreinte complète du lot source ≠ génération');

  // ═══ Charge v2, signature, revérification ═══
  const badge = choisirBadge(mode, relecteur, deps.tableRelecteurs);
  const x = retenue.x;
  const charge = {
    schema: 'attestation-cloture/v2', set_id: setId, notion_id: inst.candidat_lot.notion_id, palier: inst.candidat_lot.palier,
    coeur: inst.coeur, sha256_instantane: shaInstantane, code_confirmation: code,
    confirmation: { mode, par: relecteur, recue_par: 'eric', le: confirmationLe },
    fidelite_transmission: { atteste_par: 'eric', le: fideliteLe },
    relecteur_attribue: relecteur, relecteur_egal_cloturer: auto,
    provenances: page ? duLot.map((e) => ({ execution_id: e.x.id, workflow_id: e.x.workflowId, statut: e.x.status, demarree_le: e.x.startedAt }))
      .sort((a, b) => (a.demarree_le < b.demarree_le ? -1 : a.demarree_le > b.demarree_le ? 1 : a.execution_id < b.execution_id ? -1 : a.execution_id > b.execution_id ? 1 : 0)) : [],
    nb_fichiers_decision: decisions.length, referentiel_version: sortie.referentiel_version, moteur: inst.moteur,
    execution_cloture: page ? { execution_id: derniere.id, workflow_id: derniere.workflowId, statut: derniere.status, terminee_le: derniere.stoppedAt } : null,
    source_decisions: config.source,
    generation: {
      execution_id: x.id, workflow_id: x.workflowId, statut: x.status, demarree_le: x.startedAt, terminee_le: x.stoppedAt, modele: sortie.modele,
      empreinte_complete: sortie.empreinte_complete, journal_commit: sortie.journal_commit, listing_debut_le: listingDebut, listing_fin_le: listingFin,
    },
    fin_saisie_le: page ? null : finSaisie, revoque_le: page ? revoqueLe : null,
    levees, incidents_connus: [...incidents].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    cloture_le: deps.horloge().toISOString(), badge, cle_id: config.cleId,
  };
  // AVANT toute signature : forme canonique, clé déclarée et recevable, invariants de
  // valeur (communs + par source) et de dépôt — tout refus ici => signataire jamais appelé.
  let octets;
  try { octets = Buffer.from(Canonique.octetsContrat('attestation-cloture/v2', charge)); } catch (e) { refuser(`charge non conforme : ${e.message}`); }
  // Clé validée UNE fois (avant la tranche) puis figée : jamais relue.
  const k = k0;
  if (!k.ok || charge.cle_id !== config.cleId) refuser(k.raison || 'cle_id ≠ configuration', 'temporaire');
  const irrecevable = S.recevabilite(k.declaration, charge.cloture_le);
  if (irrecevable) refuser(irrecevable, 'temporaire');
  const entree = { set_id: setId, notion_id: charge.notion_id, palier: charge.palier, item_ids: [...inst.coeur.selection], empreinte: inst.coeur.empreinte_publiee, moteur: { ...inst.moteur }, relecteur: badge };
  const opts = { modelesAutorises: config.modelesAutorises };
  const avant = [...S.invariantsValeur(charge, opts), ...S.invariantsDepot(charge, { entree, registre: deps.registre, referentiel })];
  if (avant.length) refuser(`charge refusée avant signature : ${avant.join(' ; ')}`);
  // Destination vérifiée AVANT signature (occupée ou inaccessible = refus sans signature).
  // Panne APRÈS signature (vérification ou écriture) : NE PAS relancer — le marqueur
  // <set_id>.signature l'interdit. Traitement MANUEL : si attestation.json est complet et
  // vérifié, il est utilisable ; sinon abandon du set_id (jamais deux attestations).
  const cheminAttestation = path.join(dossierLot, 'attestation.json');
  let occupee;
  try { occupee = deps.fs.existe(cheminAttestation); } catch (e) { refuser(`${cheminAttestation} inaccessible (${e.code || e.message}) : refus`); }
  if (occupee !== false) refuser(`${cheminAttestation} existe déjà (ou état indéterminé) : refus d'écraser`);
  const cleFigee = Object.freeze({ obtenir: (id) => (id === charge.cle_id ? k : { ok: false, raison: `clé « ${id} » non figée` }) });
  // Marqueur DURABLE, écrit (exclusif) AVANT l'appel au signataire et jamais retiré :
  // toute nouvelle signature de ce set_id est refusée, même si le dossier est déplacé.
  try { deps.fs.ecrireExclusif(marqueurSignature, `${JSON.stringify({ set_id: setId, code, dossier: dossierLot, le: deps.horloge().toISOString() }, null, 2)}\n`); } catch (e) {
    refuser(`${marqueurSignature} : ${e.message} — une signature a peut-être déjà été tentée : traitement manuel`, 'local');
  }
  const enveloppe = { type: S.TYPE, charge, signature: deps.signer(octets).toString('base64') };
  const erreurs = S.verifierAttestationSignee(enveloppe, { entree, registre: deps.registre, referentiel, cles: cleFigee, ...opts });
  if (erreurs.length) refuser(`revérification immédiate en échec : ${erreurs.join(' ; ')}`);
  deps.fs.ecrireExclusif(cheminAttestation, `${JSON.stringify(enveloppe, null, 2)}\n`);
  return { enveloppe, dossierLot, lotPublie: publie };
}

function evaluerPage({ setId, candidatEnv, clotures, confirmations, listeDecisions, rattachement, levees, constats, sortie, relecteur, empreintes, listingDebut }) {
  // Parcours PAGE (v8.2 §7, §9, §10) : chaque partie est évaluée dès que sa donnée est
  // disponible, sans retour anticipé ; une décision tardive reste réconciliée et
  // rapprochée (un blocage dur n'est jamais masqué par une date).
  let revoqueLe = null; let creeLe = null; let derniere = null;
  if (candidatEnv.ok) {
    const c = candidatEnv.v;
    if (!c || c.schema !== 'candidat-fonda/v1' || !c.lot || !c.relecture) constats.ajouter('incident', 'candidat (enveloppe de relecture) illisible ou non conforme');
    else {
      const rel = c.relecture;
      if (rel.statut !== 'clos') constats.ajouter('temporaire', `candidat au statut « ${rel.statut} » (clôture technique requise)`);
      revoqueLe = normaliserDate(rel.clos_le);
      creeLe = normaliserDate(rel.cree_le);
      if (!revoqueLe || !creeLe) constats.ajouter('incident', 'relecture.clos_le / cree_le absent ou mal formé');
      else if (creeLe > revoqueLe) constats.ajouter('incident', 'fenêtre de candidature inversée (cree_le > clos_le)');
      if (c.lot.set_id !== setId) constats.ajouter('abandon', 'set_id du candidat ≠ set_id demandé');
      const completeRef = empreintes ? empreintes.complete : (sortie ? sortie.empreinte_complete : null);
      try { if (completeRef && L.empreinteComplete(c.lot) !== completeRef) constats.ajouter('abandon', 'lot de l\'enveloppe de relecture ≠ lot généré'); } catch { constats.ajouter('abandon', 'lot de l\'enveloppe de relecture non projetable'); }
      if (sortie && rel.referentiel_version !== sortie.referentiel_version) constats.ajouter('abandon', 'referentiel_version du candidat ≠ génération');
      if (relecteur !== null && rel.relecteur_attribue !== relecteur) constats.ajouter('abandon', 'relecteur attribué du candidat ≠ référentiel archivé');
      if (sortie && (!rel.moteur || rel.moteur.version !== sortie.moteur.version || rel.moteur.sha256 !== sortie.moteur.sha256)) constats.ajouter('abandon', 'moteur du candidat ≠ moteur de la génération');
    }
  }
  // 1. Exécution de clôture
  if (clotures.ok) {
    // TOUTES les exécutions du workflow de clôture : en vol ou de statut inconnu (quel que
    // soit le lot), ou non attribuables -> incident (§20.13 priorité 1).
    const duLotClot = [];
    for (const x of clotures.v) {
      if (!STATUTS_TERMINAUX.includes(x.status)) { constats.ajouter('incident', `exécution de clôture ${x.id} non terminée ou de statut inconnu (${x.status}) : une clôture technique est encore en cours`); continue; }
      const r = rattachement(x.brut);
      if (!r || typeof r.set_id !== 'string' || r.type !== 'cloture') { constats.ajouter('incident', `exécution de clôture ${x.id} non attribuable à un lot`); continue; }
      if (r.set_id === setId) duLotClot.push(x);
    }
    const reussies = duLotClot.filter((x) => x.status === 'success' && x.stoppedAt && x.startedAt)
      .sort((a, b) => (a.stoppedAt < b.stoppedAt ? -1 : a.stoppedAt > b.stoppedAt ? 1 : 0));
    if (!reussies.length) constats.ajouter('temporaire', 'aucune clôture technique réussie rattachée à ce lot');
    else {
      derniere = reussies[reussies.length - 1];
      if (reussies.length > 1 && reussies[reussies.length - 2].stoppedAt === derniere.stoppedAt) constats.ajouter('abandon', 'deux clôtures techniques à la même date : aucun départage arbitraire');
    }
  }
  // 2. Filet sur les confirmations
  const duLot = [];
  if (confirmations.ok) {
    for (const x of confirmations.v) {
      if (STATUTS_EN_VOL.includes(x.status)) { constats.ajouter('incident', `exécution de confirmation ${x.id} non terminée (${x.status})`); continue; }
      if (!STATUTS_TERMINAUX.includes(x.status)) { constats.ajouter('incident', `exécution de confirmation ${x.id} au statut inconnu (${x.status})`); continue; }
      const r = rattachement(x.brut);
      if (!r) { constats.ajouter('incident', `exécution de confirmation ${x.id} sans données exploitables`); continue; }
      if (r.set_id !== setId) continue;
      if (r.type === 'conflit') { constats.ajouter('abandon', `sortie « conflit » (exécution ${x.id}) : blocage dur`); continue; }
      if (x.status !== 'success') { constats.ajouter('abandon', `exécution de confirmation ${x.id} du lot au statut ${x.status} : blocage dur`); continue; }
      if (r.type !== 'decision' || typeof r.nonce !== 'string' || !r.nonce || !x.startedAt || !x.stoppedAt) { constats.ajouter('incident', `exécution ${x.id} : rattachement de décision incomplet`); continue; }
      duLot.push({ x, nonce: r.nonce });
    }
  }
  // 3. Décisions sur Drive
  const decisions = [];
  if (listeDecisions.ok) {
    const liste = listeDecisions.v;
    if (!liste || !Array.isArray(liste.fichiers)) constats.ajouter('incident', 'listing de decisions/ illisible');
    else {
      if (liste.incompleteSearch === true && !levees.some((l) => l.type === 'recherche_incomplete')) constats.ajouter('temporaire', 'recherche Drive incomplète (decisions/) sans levée explicite');
      const presentes = new Set();
      for (const f of liste.fichiers) {
        if (!f || f.contenu == null) { constats.ajouter('incident', `fichier de decisions/ illisible (${f && f.nom})`); continue; }
        const d = f.contenu;
        if (!decisionConforme(d)) { constats.ajouter('incident', `fichier de decisions/ non conforme (${f.nom})`); continue; }
        if (d.set_id !== setId) continue;
        presentes.add(d.nonce);
        const modifie = normaliserDate(f.modifie_le);
        if (!modifie) constats.ajouter('incident', `${f.nom} : date de modification illisible`);
        // Écriture postérieure à la clôture technique ou au début du listing (§20.7) :
        // nouvelle clôture technique requise — la décision reste réconciliée et rapprochée.
        else if ((derniere && modifie > derniere.stoppedAt) || modifie > listingDebut) constats.ajouter('temporaire', `${f.nom} écrit après la clôture technique ou pendant le listing : nouvelle clôture technique requise`);
        if (confirmations.ok && !duLot.some((e) => e.nonce === d.nonce)) constats.ajouter('abandon', `${f.nom} : décision sans exécution correspondante : blocage dur`);
        decisions.push(d);
      }
      if (confirmations.ok) for (const e of duLot) if (!presentes.has(e.nonce)) constats.ajouter('abandon', `décision de l'exécution ${e.x.id} absente de Drive : blocage dur`);
      if (!decisions.length) constats.ajouter('temporaire', 'aucune décision pour ce lot');
    }
  }
  return { decisions, derniere, duLot, revoqueLe, fenetre: creeLe && revoqueLe && creeLe <= revoqueLe ? { debut: creeLe, fin: revoqueLe } : null };
}

// CLI : la garde maîtresse s'applique avant toute lecture de secret ou appel réseau.
async function main() {
  const setId = process.argv[2];
  try {
    await cloturer(setId, { rattachement: undefined });
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exitCode = 1;
  }
}

// Adaptateur disque de production pour `existe` : seule l'absence AVÉRÉE (ENOENT)
// vaut false ; toute autre erreur est levée (jamais assimilée à une absence).
// lstat (et non stat) : un LIEN SYMBOLIQUE, même cassé, est une entrée existante —
// l'écriture exclusive le refuserait après signature.
function existeSurDisque(p) {
  try { fs.lstatSync(p); return true; } catch (e) { if (e && e.code === 'ENOENT') return false; throw e; }
}

module.exports = {
  existeSurDisque, cloturer, saisirDecisionLocale, Refus, normaliserDate, projeterRecapitulatif, rendreRecapitulatif, decisionConforme, lotPublie,
  choisirBadge, verifierDossierLocal, observer, evaluerPage, relecteurDeLaGeneration, NOM_DECISION_LOCALE,
};

if (require.main === module) main();
