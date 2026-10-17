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
// Étapes (§9), toutes avant la moindre signature ; tout refus => ZÉRO signature :
//  1. Provenance (API n8n, lecture seule) : exécution de CLÔTURE du workflow épinglé,
//     `success`, rattachée à ce set_id, la plus récente (égalité -> refus) ; une
//     écriture dans decisions/ postérieure à cette clôture -> nouvelle clôture technique.
//  2. Filet (§10) : requêtes explicites status=running ET status=waiting (et liste
//     complète) sur le workflow de confirmation — toute exécution non terminée, de
//     statut inconnu ou non rattachable suspend tout ; sortie `conflit`, exécution
//     error/crashed/canceled du lot, décision consignée absente de Drive, fichier de
//     decisions/ sans exécution, fichier illisible -> blocage ; recherche Drive
//     incomplète sans levée -> refus ; incident OUVERT -> tout est suspendu ; incident
//     dont la période recouvre la fenêtre de candidature -> abandon + nouveau candidat.
//  3. Unicité : exactement UN cœur distinct, d'action « accepter » ; même lot_relu.
//  4. Revérifications : candidat (statut clos, clos_le, moteur, relecteur), filtrage du
//     lot publié, lot-fonda/v1, empreintes relue et publiée, garde-fous via le MOTEUR
//     DU LOT, référentiel ARCHIVÉ (version = SHA-256) et relecteur attribué.
//  5. Instantané figé (§3) : écrit UNE fois (wx) dans le dossier local de clôture (hors
//     dépôt, hors Dropbox) + export.json + récapitulatif ; affichage du cœur et du code
//     (16 premiers hex de sha256_instantane) ; Éric tape le code confirmé ; contrôles
//     §3.4 sur les fichiers RELUS : SHA-256 = export, récapitulatif re-dérivé = stocké
//     (SHA-256 canonique recapitulatif-fonda/v1), cœur/moteur/empreintes issus
//     exclusivement de l'instantané ; fidélité de transmission attestée.
//     Auto-confirmation si relecteur_attribue = "eric" (§5).
//  6. Charge attestation-cloture/v1, signature RSA-SHA256 PKCS#1 v1.5 sur ses octets
//     canoniques, puis REVÉRIFICATION IMMÉDIATE par fonda/scripts/attestation-signee.js
//     (même chemin que la publication) ; enveloppe { type: "cloture-signee", charge,
//     signature } écrite dans le dossier local.
//
// PROVISOIRE (dépend du contrat de rattachement, chantier 5) — choix à confirmer ou
// remplacer avec les workflows, JAMAIS considérés comme des contrats validés :
//   - rapprochement décision <-> exécution par `nonce` ;
//   - forme et sens de `lot_relu` (recopié brut dans l'instantané : à revoir avec son
//     schéma, notamment l'absence de données sensibles) ;
//   - repère « instant du listing » : approché ici par la fin de l'exécution de clôture
//     retenue ; une écriture entre cette fin et le listing réel n'est pas détectée tant
//     que le workflow ne fournit pas ce repère.
//
// SECRETS : la clé privée et le jeton d'API n8n (lecture seule, droits minimaux) vivent
// HORS dépôt et HORS Dropbox ; ils ne sont jamais écrits, journalisés ni affichés.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('../engine/catalogue.js');
const Canonique = require('../engine/canonique.js');
const S = require('./attestation-signee.js');
const { chargerMoteurNode } = require('./moteurs.js');

const RACINE_DEPOT = path.resolve(__dirname, '..', '..');
const STATUTS_TERMINAUX = ['success', 'error', 'crashed', 'canceled'];
const STATUTS_EN_VOL = ['new', 'running', 'waiting'];
const DATE_SOURCE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

class Refus extends Error {}
const refuser = (m) => { throw new Refus(m); };
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
async function observer(api, workflowId) {
  const vues = new Map();
  const ajouter = (lot, source) => {
    for (const x of lot || []) {
      if (!x || !((typeof x.id === 'string' && x.id.trim() !== '') || (typeof x.id === 'number' && Number.isSafeInteger(x.id)))) refuser(`exécution sans identifiant exploitable (${source})`);
      const id = String(x.id);
      const n = { id, workflowId: x.workflowId, status: x.status, startedAt: x.startedAt == null ? null : normaliserDate(x.startedAt), stoppedAt: x.stoppedAt == null ? null : normaliserDate(x.stoppedAt), brut: x };
      if (x.startedAt != null && n.startedAt === null) refuser(`exécution ${id} : startedAt hors grammaire (${source})`);
      if (x.stoppedAt != null && n.stoppedAt === null) refuser(`exécution ${id} : stoppedAt hors grammaire (${source})`);
      if (n.workflowId !== workflowId) refuser(`exécution ${id} : workflowId inattendu`);
      const v = vues.get(id);
      if (!v) { vues.set(id, n); continue; }
      // Évolution normale : non terminé -> terminé ; startedAt null -> date.
      if (v.startedAt && n.startedAt && v.startedAt !== n.startedAt) refuser(`exécution ${id} : observations contradictoires (startedAt)`);
      const tv = STATUTS_TERMINAUX.includes(v.status);
      const tn = STATUTS_TERMINAUX.includes(n.status);
      if (tv && tn && v.status !== n.status) refuser(`exécution ${id} : deux statuts terminaux différents`);
      if (tv && !tn) refuser(`exécution ${id} : retour d'un statut terminal à un statut non terminal (contradiction)`);
      vues.set(id, { ...v, ...n, startedAt: n.startedAt || v.startedAt });
    }
  };
  // Requêtes « en vol » D'ABORD, liste complète ENSUITE : une exécution vue en cours
  // puis terminée est une évolution normale ; l'inverse est une contradiction.
  for (const status of ['running', 'waiting']) ajouter(await api.listerExecutions({ workflowId, status }), `status=${status}`);
  ajouter(await api.listerExecutions({ workflowId }), 'liste');
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

// Décision conforme (PROVISOIRE : forme decision-fonda/v1 du §1 ; lot_relu non défini).
function decisionConforme(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
  const cles = ['schema', 'set_id', 'generation', 'nonce', 'recu_le', 'coeur', 'lot_relu', 'hash_formulaire'];
  if (Object.keys(d).length !== cles.length || !cles.every((k) => Object.prototype.hasOwnProperty.call(d, k))) return false;
  if (d.schema !== 'decision-fonda/v1' || !C.SET_ID_PATTERN.test(d.set_id || '') || !Number.isSafeInteger(d.generation)
    || typeof d.nonce !== 'string' || !d.nonce || !normaliserDate(d.recu_le) || typeof d.hash_formulaire !== 'string' || d.lot_relu === undefined) return false;
  try { Canonique.octetsContrat('coeur-decision-fonda/v1', d.coeur); } catch { return false; }
  return true;
}

// Lot publié = candidat filtré sur la sélection, dans l'ordre du candidat.
function lotPublie(candidatLot, coeur) {
  const garde = new Set(coeur.selection);
  const cartes = candidatLot.cartes.filter((c) => garde.has(c.item_id));
  return { ...candidatLot, revue_carte_par_carte: true, nb_cartes: cartes.length, cartes };
}

function choisirBadge(mode, relecteur, tableRelecteurs) {
  if (mode === 'auto') return { forme: 'relue_par', nom_affiche: 'Éric Duchateau', id: 'eric' };
  const nom = tableRelecteurs && Object.prototype.hasOwnProperty.call(tableRelecteurs, relecteur) ? tableRelecteurs[relecteur] : null;
  if (typeof nom === 'string' && nom.trim() !== '') return { forme: 'relue_et_validee', nom_affiche: nom, id: relecteur };
  return { forme: 'relue_par', nom_affiche: 'un professeur', id: null };
}

/**
 * Clôture signée d'un set_id. Toutes les dépendances sont injectées.
 * deps = {
 *   rattachement,            // contrat n8n <-> lot — ABSENT EN PRODUCTION => refus
 *   api,                     // { listerExecutions({ workflowId, status }) }
 *   config: { workflowConfirmation, workflowCloture, dossier, cleId },
 *   drive: { lireCandidat(setId), listerDecisions(setId) -> { incompleteSearch, fichiers: [{ nom, modifie_le, contenu|null }] } },
 *   incidents(),             // [{ id, nature, detecte_le, statut, resolu_le, preuve_resolution, periode }]
 *   referentielArchive(version) -> octets de referentiel.json à cette version (SHA-256 vérifié ici) ;
 *     adaptateur de production : referentiel-archive.js::referentielArchiveGit (§20.12)
 *   tableRelecteurs,         // { id: nom affichable } — version au moment de la clôture
 *   fs,                      // { ecrireExclusif(p, texte), lire(p) -> Buffer, existe(p) -> booléen (lève si inaccessible), realpath? }
 *   signer(octets) -> Buffer // clé privée détenue par l'appelant, jamais exposée ici
 *   cles,                    // clés PUBLIQUES (attestation-signee.chargerCles) pour la revérification
 *   registre,                // moteurs.json
 *   horloge() -> Date,
 *   saisir(question) -> Promise<string>,
 *   afficher(texte),
 *   levees,                  // levées explicites d'Éric (§10 C), [] par défaut
 * }
 * @returns {Promise<{ enveloppe, dossierLot }>} ; lève Refus sinon (aucune signature).
 */
async function cloturer(setId, deps) {
  // ── Garde maîtresse ──
  if (typeof deps.rattachement !== 'function') refuser('contrat de rattachement exécution n8n <-> lot NON DÉFINI (§11 bis) : signature refusée');
  const { config, api, drive, rattachement } = deps;
  if (!C.SET_ID_PATTERN.test(setId || '')) refuser('set_id invalide');
  verifierDossierLocal(config.dossier, deps.fs && deps.fs.realpath);
  const levees = deps.levees || [];

  // ── Candidat ──
  const candidat = await drive.lireCandidat(setId);
  if (!candidat || candidat.schema !== 'candidat-fonda/v1' || !candidat.lot || !candidat.relecture) refuser('candidat illisible ou non conforme');
  const rel = candidat.relecture;
  if (rel.statut !== 'clos') refuser(`candidat au statut « ${rel.statut} » (clôture technique requise)`);
  const revoqueLe = normaliserDate(rel.clos_le);
  if (!revoqueLe) refuser('relecture.clos_le absent ou mal formé');
  const creeLe = normaliserDate(rel.cree_le);
  if (!creeLe) refuser('relecture.cree_le mal formé');
  if (creeLe > revoqueLe) refuser('fenêtre de candidature inversée (cree_le > clos_le)');
  if (candidat.lot.set_id !== setId) refuser('set_id du candidat ≠ set_id demandé');

  // ── 1. Provenance : exécution de clôture ──
  const clotures = (await observer(api, config.workflowCloture))
    .filter((x) => { const r = rattachement(x.brut); return r && r.set_id === setId && r.type === 'cloture'; });
  if (clotures.some((x) => !STATUTS_TERMINAUX.includes(x.status))) refuser('une clôture technique de ce lot est encore en cours');
  for (const x of clotures) if (x.status === 'success' && (!x.stoppedAt || !x.startedAt)) refuser(`clôture ${x.id} : startedAt/stoppedAt manquants pour une exécution terminée`);
  const reussies = clotures.filter((x) => x.status === 'success');
  if (!reussies.length) refuser('aucune clôture technique réussie rattachée à ce lot');
  reussies.sort((a, b) => (a.stoppedAt < b.stoppedAt ? -1 : a.stoppedAt > b.stoppedAt ? 1 : 0));
  const derniere = reussies[reussies.length - 1];
  if (reussies.length > 1 && reussies[reussies.length - 2].stoppedAt === derniere.stoppedAt) refuser('deux clôtures techniques à la même date : aucun départage arbitraire');

  // ── 2. Filet ──
  const confirmations = await observer(api, config.workflowConfirmation);
  for (const x of confirmations) {
    if (STATUTS_EN_VOL.includes(x.status)) refuser(`exécution de confirmation ${x.id} non terminée (${x.status}) : incident de chaîne, clôture suspendue`);
    if (!STATUTS_TERMINAUX.includes(x.status)) refuser(`exécution de confirmation ${x.id} au statut inconnu (${x.status})`);
  }
  const duLot = [];
  for (const x of confirmations) {
    const r = rattachement(x.brut);
    if (!r) refuser(`exécution de confirmation ${x.id} sans données exploitables : incident de chaîne`);
    if (r.set_id !== setId) continue;
    if (r.type === 'conflit') refuser(`sortie « conflit » (exécution ${x.id}) : blocage dur, abandon + nouveau candidat`);
    if (x.status !== 'success') refuser(`exécution de confirmation ${x.id} du lot au statut ${x.status} : blocage dur`);
    if (r.type !== 'decision' || typeof r.nonce !== 'string' || !r.nonce) refuser(`exécution ${x.id} : rattachement de décision incomplet`);
    if (!x.startedAt || !x.stoppedAt) refuser(`exécution ${x.id} : startedAt/stoppedAt manquants pour une exécution terminée`);
    duLot.push({ x, nonce: r.nonce });
  }
  const liste = await drive.listerDecisions(setId);
  if (!liste || !Array.isArray(liste.fichiers)) refuser('listing de decisions/ illisible');
  if (liste.incompleteSearch === true && !levees.some((l) => l.type === 'recherche_incomplete')) refuser('recherche Drive incomplète (incompleteSearch) sans levée explicite');
  const decisions = [];
  for (const f of liste.fichiers) {
    if (!f || f.contenu == null) refuser(`fichier de decisions/ illisible (${f && f.nom}) : incident de chaîne`);
    const d = f.contenu;
    // Conformité vérifiée AVANT de l'attribuer à un autre lot (§10 B) : un fichier non
    // conforme est un incident de chaîne, jamais ignoré.
    if (!decisionConforme(d)) refuser(`fichier de decisions/ non conforme (${f.nom}) : incident de chaîne`);
    if (d.set_id !== setId) continue;
    const modifie = normaliserDate(f.modifie_le);
    if (!modifie) refuser(`${f.nom} : date de modification illisible`);
    if (modifie > derniere.stoppedAt) refuser(`${f.nom} écrit après la clôture technique : nouvelle clôture technique requise`);
    if (!duLot.some((e) => e.nonce === d.nonce)) refuser(`${f.nom} : décision sans exécution correspondante : blocage dur`);
    decisions.push(d);
  }
  for (const e of duLot) if (!decisions.some((d) => d.nonce === e.nonce)) refuser(`décision de l'exécution ${e.x.id} absente de Drive : blocage dur`);
  if (!decisions.length) refuser('aucune décision pour ce lot');
  // Incidents (§10 B)
  const incidents = [];
  for (const i of await deps.incidents()) {
    if (!i || typeof i.id !== 'string' || !i.id || typeof i.nature !== 'string' || !i.periode) refuser('incident illisible : incident de chaîne');
    if (i.statut !== 'resolu') refuser(`incident ${i.id} ouvert : toute clôture signée est suspendue`);
    const detecte = normaliserDate(i.detecte_le);
    const resolu = normaliserDate(i.resolu_le);
    const debut = i.periode.debut === null ? null : normaliserDate(i.periode.debut);
    const fin = normaliserDate(i.periode.fin);
    if (!detecte || !resolu || !fin || (i.periode.debut !== null && !debut)) refuser(`incident ${i.id} : dates mal formées`);
    if (fin !== resolu) refuser(`incident ${i.id} : periode.fin ≠ resolu_le`);
    if (debut !== null && debut > fin) refuser(`incident ${i.id} : période inversée`);
    if (detecte > resolu) refuser(`incident ${i.id} : détecté après sa résolution`);
    if (typeof i.preuve_resolution !== 'string' || !i.preuve_resolution.trim()) refuser(`incident ${i.id} : preuve de résolution absente`);
    // Fenêtre [cree_le, clos_le] ∩ période [debut|−∞, fin] ≠ ∅ (bornes incluses).
    if ((debut === null || debut <= revoqueLe) && fin >= creeLe) refuser(`incident ${i.id} : sa période recouvre la fenêtre de candidature — abandon et nouveau candidat créé après ${fin}`);
    incidents.push({ id: i.id, nature: i.nature, detecte_le: detecte, statut: 'resolu', resolu_le: resolu, preuve_resolution: i.preuve_resolution, periode: { debut, fin } });
  }

  // ── 3. Unicité du cœur ──
  const octetsCoeur = new Set(decisions.map((d) => Buffer.from(Canonique.octetsContrat('coeur-decision-fonda/v1', d.coeur)).toString('hex')));
  if (octetsCoeur.size !== 1) refuser(`${octetsCoeur.size} cœurs distincts : blocage dur`);
  if (new Set(decisions.map((d) => JSON.stringify(d.lot_relu))).size !== 1) refuser('cœurs identiques mais lot_relu différents : blocage dur');
  const coeur = decisions[0].coeur;
  if (coeur.action !== 'accepter') refuser(`action « ${coeur.action} » : rien à publier`);

  // ── 4. Revérifications ──
  const moteur = coeur.moteur;
  if (!rel.moteur || rel.moteur.version !== moteur.version || rel.moteur.sha256 !== moteur.sha256) refuser('moteur du cœur ≠ moteur du candidat');
  const ordreCandidat = candidat.lot.cartes.map((c) => c.item_id);
  const attendu = (ids) => ordreCandidat.filter((id) => ids.includes(id));
  if (JSON.stringify(coeur.selection) !== JSON.stringify(attendu(coeur.selection)) || JSON.stringify(coeur.ecartees) !== JSON.stringify(attendu(coeur.ecartees))
    || coeur.selection.length + coeur.ecartees.length !== ordreCandidat.length || new Set([...coeur.selection, ...coeur.ecartees]).size !== ordreCandidat.length) {
    refuser('selection/ecartees : pas une partition du candidat dans son ordre');
  }
  const sha = C.sha256WebCrypto();
  if ((await C.calculerEmpreinte(candidat.lot, sha)) !== coeur.empreinte_relue) refuser('empreinte relue ≠ empreinte du candidat');
  const publie = lotPublie(candidat.lot, coeur);
  const vl = C.validerLot(publie);
  if (!vl.valide) refuser(`lot publié non conforme : ${vl.erreurs.join(' ; ')}`);
  if ((await C.calculerEmpreinte(publie, sha)) !== coeur.empreinte_publiee) refuser('empreinte publiée ≠ empreinte du lot filtré');
  const m = chargerMoteurNode(moteur.version, moteur.sha256, deps.registre);
  for (const c of publie.cartes) {
    const v = m.valider(c);
    if (!v.valide) refuser(`${c.item_id} refusée par le moteur ${moteur.version}`);
    if (!m.outils.verifierReponseOr(c).ok || !m.outils.verifierFormesAcceptees(c).ok) refuser(`${c.item_id} : garde-fous du moteur non respectés`);
  }
  // Référentiel ARCHIVÉ : octets de referentiel.json à la version figée (§2) ;
  // referentiel_version = "sha256:" + SHA-256 de ces octets.
  if (!/^sha256:[0-9a-f]{64}$/.test(rel.referentiel_version || '')) refuser('referentiel_version mal formée');
  const octetsReferentiel = await deps.referentielArchive(rel.referentiel_version);
  if (!octetsReferentiel || `sha256:${sha256Hex(Buffer.from(octetsReferentiel))}` !== rel.referentiel_version) refuser('référentiel archivé ≠ referentiel_version');
  let referentiel;
  try { referentiel = JSON.parse(Buffer.from(octetsReferentiel).toString('utf8')); } catch { refuser('référentiel archivé illisible'); }
  const notion = (referentiel.notions || []).find((n) => n.id === candidat.lot.notion_id);
  if (!notion) refuser('référentiel archivé illisible ou notion absente');
  if (notion.relecteur !== rel.relecteur_attribue) refuser('relecteur attribué ≠ référentiel archivé');

  // ── 5. Instantané figé + confirmation ──
  const recapitulatif = projeterRecapitulatif(candidat.lot, coeur, moteur);
  const instantane = { schema: 'instantane-fonda/v1', set_id: setId, candidat_lot: candidat.lot, coeur, lot_relu: decisions[0].lot_relu, moteur, recapitulatif };
  const texteInstantane = `${JSON.stringify(instantane, null, 2)}\n`;
  const shaInstantane = sha256Hex(Buffer.from(texteInstantane, 'utf8'));
  const shaRecap = sha256Hex(Buffer.from(Canonique.octetsContrat('recapitulatif-fonda/v1', recapitulatif)));
  const code = shaInstantane.slice(0, 16);
  const dossierLot = path.join(config.dossier, `${setId}-${code}`);
  verifierDossierLocal(dossierLot, deps.fs && deps.fs.realpath); // destination finale, avant toute écriture
  deps.fs.ecrireExclusif(path.join(dossierLot, 'instantane.json'), texteInstantane);
  deps.fs.ecrireExclusif(path.join(dossierLot, 'export.json'), `${JSON.stringify({ sha256_instantane: shaInstantane, sha256_recapitulatif: shaRecap, exporte_le: deps.horloge().toISOString() }, null, 2)}\n`);
  const rendu = rendreRecapitulatif(recapitulatif);
  deps.fs.ecrireExclusif(path.join(dossierLot, `recapitulatif-${setId}-${code}.txt`), `${rendu}\n\n${shaInstantane}\n`);
  deps.afficher(`${rendu}\n\nCODE DE CONFIRMATION : ${code}`);

  const auto = rel.relecteur_attribue === 'eric';
  const mode = auto ? 'auto' : (await deps.saisir('Mode de confirmation (vive_voix | reponse_message) : ')).trim();
  if (auto ? mode !== 'auto' : !['vive_voix', 'reponse_message'].includes(mode)) refuser('mode de confirmation invalide (auto réservé au relecteur Éric ; tiers : vive_voix ou reponse_message)');
  const codeSaisi = (await deps.saisir('Code confirmé (16 hex) : ')).trim();
  if (codeSaisi !== code) refuser('code de confirmation saisi ≠ code de l\'instantané');
  const confirmationLe = deps.horloge().toISOString();
  if ((await deps.saisir('J\'atteste que le récapitulatif confirmé est celui exporté, transmis sans retouche (oui/non) : ')).trim() !== 'oui') refuser('fidélité de transmission non attestée');
  const fideliteLe = deps.horloge().toISOString();

  // Contrôles §3.4 sur les fichiers RELUS (jamais sur les objets en mémoire).
  const relu = deps.fs.lire(path.join(dossierLot, 'instantane.json'));
  const exportRelu = JSON.parse(deps.fs.lire(path.join(dossierLot, 'export.json')).toString('utf8'));
  if (sha256Hex(relu) !== exportRelu.sha256_instantane || exportRelu.sha256_instantane !== shaInstantane) refuser('§3.4 (a) : SHA-256 de instantane.json ≠ export');
  const inst = JSON.parse(relu.toString('utf8'));
  const recapRederive = projeterRecapitulatif(inst.candidat_lot, inst.coeur, inst.moteur);
  const shaRederive = sha256Hex(Buffer.from(Canonique.octetsContrat('recapitulatif-fonda/v1', recapRederive)));
  if (shaRederive !== exportRelu.sha256_recapitulatif || shaRederive !== sha256Hex(Buffer.from(Canonique.octetsContrat('recapitulatif-fonda/v1', inst.recapitulatif)))) {
    refuser('§3.4 (b) : récapitulatif re-dérivé ≠ récapitulatif stocké');
  }

  // ── 6. Charge, signature, revérification ──
  const provenances = duLot.map((e) => ({ execution_id: e.x.id, workflow_id: e.x.workflowId, statut: e.x.status, demarree_le: e.x.startedAt }))
    .sort((a, b) => (a.demarree_le < b.demarree_le ? -1 : a.demarree_le > b.demarree_le ? 1 : a.execution_id < b.execution_id ? -1 : a.execution_id > b.execution_id ? 1 : 0));
  const badge = choisirBadge(mode, rel.relecteur_attribue, deps.tableRelecteurs);
  const charge = {
    schema: 'attestation-cloture/v1', set_id: setId, notion_id: inst.candidat_lot.notion_id, palier: inst.candidat_lot.palier,
    coeur: inst.coeur, sha256_instantane: shaInstantane, code_confirmation: code,
    confirmation: { mode, par: rel.relecteur_attribue, recue_par: 'eric', le: confirmationLe },
    fidelite_transmission: { atteste_par: 'eric', le: fideliteLe },
    relecteur_attribue: rel.relecteur_attribue, relecteur_egal_cloturer: auto,
    provenances, nb_fichiers_decision: decisions.length, referentiel_version: rel.referentiel_version, moteur: inst.moteur,
    execution_cloture: { execution_id: derniere.id, workflow_id: derniere.workflowId, statut: derniere.status, terminee_le: derniere.stoppedAt },
    revoque_le: revoqueLe, levees, incidents_connus: [...incidents].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    cloture_le: deps.horloge().toISOString(), badge, cle_id: config.cleId,
  };
  // AVANT toute signature : forme canonique, clé déclarée et recevable, invariants de
  // valeur et de dépôt — tout refus ici => le signataire n'est jamais appelé.
  let octets;
  try { octets = Buffer.from(Canonique.octetsContrat('attestation-cloture/v1', charge)); } catch (e) { refuser(`charge non conforme : ${e.message}`); }
  const k = deps.cles.obtenir(charge.cle_id);
  if (!k.ok) refuser(k.raison);
  const irrecevable = S.recevabilite(k.declaration, charge.cloture_le);
  if (irrecevable) refuser(irrecevable);
  const entree = { set_id: setId, notion_id: charge.notion_id, palier: charge.palier, item_ids: [...inst.coeur.selection], empreinte: inst.coeur.empreinte_publiee, moteur: { ...inst.moteur }, relecteur: badge };
  const avant = [...S.invariantsValeur(charge), ...S.invariantsDepot(charge, { entree, registre: deps.registre, referentiel })];
  if (avant.length) refuser(`charge refusée avant signature : ${avant.join(' ; ')}`);
  // Signature, puis REVÉRIFICATION IMMÉDIATE complète (même chemin que la publication).
  // Destination de l'attestation vérifiée AVANT signature : `existe(p)` renvoie true
  // (occupée) ou false (absence AVÉRÉE) et LÈVE sur toute autre erreur (accès refusé…)
  // — occupée ou inaccessible = refus sans appel au signataire.
  // Une panne d'E/S APRÈS signature reste possible : l'enveloppe n'est alors pas
  // enregistrée, rien n'est publié, la signature est perdue — aucune conséquence de
  // confiance. Reprise : ARCHIVER (déplacer) le dossier <set_id>-<code> du lot, puis
  // relancer (l'instantané y est écrit une seule fois : une relance dans le même
  // dossier est refusée, c'est voulu).
  const cheminAttestation = path.join(dossierLot, 'attestation.json');
  let occupee;
  try { occupee = deps.fs.existe(cheminAttestation); } catch (e) { refuser(`${cheminAttestation} inaccessible (${e.code || e.message}) : refus`); }
  if (occupee !== false) refuser(`${cheminAttestation} existe déjà (ou état indéterminé) : refus d'écraser`);
  // La revérification utilise la clé publique DÉJÀ validée (jamais relue) : aucun refus
  // possible après signature, hors échec de la vérification cryptographique elle-même.
  const cleFigee = Object.freeze({ obtenir: (id) => (id === charge.cle_id ? k : { ok: false, raison: `clé « ${id} » non figée` }) });
  const enveloppe = { type: S.TYPE, charge, signature: deps.signer(octets).toString('base64') };
  const erreurs = S.verifierAttestationSignee(enveloppe, { entree, registre: deps.registre, referentiel, cles: cleFigee });
  if (erreurs.length) refuser(`revérification immédiate en échec : ${erreurs.join(' ; ')}`);
  deps.fs.ecrireExclusif(cheminAttestation, `${JSON.stringify(enveloppe, null, 2)}\n`);
  return { enveloppe, dossierLot, lotPublie: publie };
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

module.exports = { existeSurDisque, cloturer, Refus, normaliserDate, projeterRecapitulatif, rendreRecapitulatif, decisionConforme, lotPublie, choisirBadge, verifierDossierLocal, observer };

if (require.main === module) main();
