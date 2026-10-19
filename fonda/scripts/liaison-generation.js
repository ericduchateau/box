// Liaison de génération et réconciliation (CDC relecture v8.3, brique 1) — fonctions
// PURES utilisées par signer-cloture.js. Aucune lecture réseau ou disque ici.
//   §20.2  classement des exécutions du set_id (avant toute exigence de sortie finale) ;
//   §20.3  table normative de rapprochement de l'exécution retenue ;
//   §20.4  projection complète lot-complet-fonda/v1 et empreinte_complete ;
//   §20.5  réconciliation de CHAQUE décision contre le lot source, puis unicité (§10 A) ;
//   §20.13 issues classées par priorité : la première ligne applicable l'emporte.

'use strict';

const crypto = require('crypto');
const C = require('../engine/catalogue.js');
const Canonique = require('../engine/canonique.js');

const NOEUD_ENTREE = 'FONDA Entree generation';
const NOEUD_SORTIE = 'FONDA Sortie generation';
const STATUTS_TERMINAUX = ['success', 'error', 'crashed', 'canceled'];
const STATUTS_EN_VOL = ['new', 'running', 'waiting'];
const DATE_SIGNEE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HEX40 = /^[0-9a-f]{40}$/;
const EMPREINTE = /^sha256:[0-9a-f]{64}$/;
const sha256Hex = (b) => crypto.createHash('sha256').update(b).digest('hex');

// --- Issues (§20.13) ---------------------------------------------------------------------
// Ordre de priorité : 1 incident de chaîne, 2 abandon, 3 refus temporaire, 4 arrêt local.
// « refus » : donnée indisponible hors matrice (exécution purgée, configuration) —
// classé avec les refus temporaires, le message précise si un abandon s'impose.
const PRIORITE = Object.freeze({ incident: 1, abandon: 2, refus: 3, temporaire: 3, local: 4 });
class Constats {
  constructor() { this.liste = []; }
  ajouter(issue, raison) {
    if (!PRIORITE[issue]) throw new Error(`issue inconnue : ${issue}`);
    this.liste.push({ issue, raison });
  }
  // Issue retenue = la plus prioritaire (puis l'ordre de constat) ; null si aucune.
  retenue() {
    if (!this.liste.length) return null;
    return [...this.liste].sort((a, b) => PRIORITE[a.issue] - PRIORITE[b.issue])[0];
  }
}

// --- Extraction d'une exécution n8n (API publique, includeData) -----------------------------
// runData[noeud] = [{ data: { main: [[{ json }]] } }] : EXACTEMENT un run, sortie main[0],
// EXACTEMENT un item ; sinon { ok: false, raison }.
function itemUnique(brute, noeud) {
  const rd = brute && brute.data && brute.data.resultData && brute.data.resultData.runData;
  if (!rd || typeof rd !== 'object') return { ok: false, raison: 'runData absent' };
  const runs = rd[noeud];
  if (!Array.isArray(runs) || runs.length !== 1) return { ok: false, raison: `${noeud} : exactement un run attendu` };
  const main = runs[0] && runs[0].data && runs[0].data.main;
  if (!Array.isArray(main) || !Array.isArray(main[0]) || main[0].length !== 1) return { ok: false, raison: `${noeud} : sortie main[0] à exactement un item attendue` };
  const item = main[0][0];
  if (!item || typeof item.json !== 'object' || item.json === null || Array.isArray(item.json)) return { ok: false, raison: `${noeud} : item sans json objet` };
  return { ok: true, json: item.json };
}

// --- §20.2 Classement des exécutions du set_id -------------------------------------------
// executions : observations normalisées { id, status, startedAt, stoppedAt } du workflow
// épinglé ; details : Map(id -> exécution brute avec données) ; fichiers : listing de
// FONDA-Lots/candidats/ [{ id, nom, modifie_le, properties, proprietesLisibles }].
// Sentinelle : donnée NON OBSERVÉE (lecture en échec, déjà constatée par l'appelant).
// Un contrôle qui en dépend est sauté ; jamais assimilée à une absence.
const INDISPONIBLE = Object.freeze({ indisponible: true });

// Fusion du DÉTAIL (includeData, lu après le listing) avec l'observation du listing
// (§11 bis) : évolution normale non terminé -> terminé (l'observation TERMINALE est
// retenue) ; contradictions (identifiant, workflow, deux statuts terminaux différents,
// retour terminal -> non terminal, dates renseignées différentes) -> { contradiction }.
function fusionner(x, brute, normaliserDate) {
  if (String(brute.id) !== x.id) return { contradiction: `identifiant du détail ${brute.id} ≠ ${x.id}` };
  if (brute.workflowId !== x.workflowId) return { contradiction: 'workflowId du détail ≠ listing' };
  // Seuls des états intermédiaires CONNUS évoluent normalement ; un statut inconnu au
  // listing ou au détail n'est jamais « réparé » par la fusion.
  for (const [o, st] of [['listing', x.status], ['détail', brute.status]]) if (!STATUTS_TERMINAUX.includes(st) && !STATUTS_EN_VOL.includes(st)) return { contradiction: `statut inconnu au ${o} (${st})` };
  const tx = STATUTS_TERMINAUX.includes(x.status);
  const tb = STATUTS_TERMINAUX.includes(brute.status);
  if (tx && !tb) return { contradiction: `statut terminal au listing (${x.status}), non terminal au détail (${brute.status})` };
  if (tx && tb && x.status !== brute.status) return { contradiction: `statuts terminaux différents (listing ${x.status}, détail ${brute.status})` };
  const obs = { ...x, status: tb ? brute.status : x.status };
  for (const k of ['startedAt', 'stoppedAt']) {
    const b = brute[k] == null ? null : normaliserDate(brute[k]);
    if (brute[k] != null && b === null) return { contradiction: `${k} du détail hors grammaire` };
    if (x[k] && b && x[k] !== b) return { contradiction: `${k} contradictoire (listing ${x[k]}, détail ${b})` };
    obs[k] = x[k] || b;
  }
  if (STATUTS_TERMINAUX.includes(obs.status) && (!obs.startedAt || !obs.stoppedAt)) return { contradiction: 'exécution terminée sans startedAt/stoppedAt' };
  if (STATUTS_TERMINAUX.includes(obs.status) && obs.stoppedAt < obs.startedAt) return { contradiction: 'exécution terminée avant d\'avoir démarré (chronologie fusionnée)' };
  return { obs };
}

// Examen de CHAQUE exécution du workflow de génération, indépendamment des autres et de
// Drive : fusion détail/listing, incident GLOBAL (non terminée ou statut inconnu, quel
// que soit le lot), déclencheur attribuable. details : Map(id -> brute | INDISPONIBLE).
// Renvoie { examinees: [{ x, entree }] (terminées et attribuables), complet }.
function examinerExecutions({ executions, details, constats, normaliserDate }) {
  const examinees = [];
  let complet = true;
  for (const x0 of executions) {
    const brute = details.get(x0.id);
    let x = x0;
    if (brute && brute !== INDISPONIBLE) {
      const f = fusionner(x0, brute, normaliserDate);
      if (f.contradiction) { constats.ajouter('incident', `exécution ${x0.id} : observations contradictoires (${f.contradiction})`); continue; }
      x = f.obs;
    }
    if (!STATUTS_TERMINAUX.includes(x.status)) {
      constats.ajouter('incident', `exécution de génération ${x.id} non terminée ou de statut inconnu (${x.status}) : incident de chaîne, toute clôture suspendue`);
      continue;
    }
    if (brute === INDISPONIBLE) { complet = false; continue; } // lecture en échec : déjà constatée
    const entree = brute ? itemUnique(brute, NOEUD_ENTREE) : { ok: false, raison: 'données de l\'exécution indisponibles (purgées ?)' };
    if (!entree.ok) { constats.ajouter('incident', `exécution ${x.id} du workflow de génération : item du déclencheur manquant (${entree.raison}) — non attribuable`); continue; }
    if (typeof entree.json.set_id !== 'string' || !C.SET_ID_PATTERN.test(entree.json.set_id) || typeof entree.json.ref !== 'string' || !entree.json.ref) {
      constats.ajouter('incident', `exécution ${x.id} : déclencheur sans { set_id, ref } exploitable — non attribuable`);
      continue;
    }
    examinees.push({ x, entree: entree.json });
  }
  return { examinees, complet };
}

// Fichiers candidats/ examinés SEULS (indépendamment des exécutions) : properties
// publiques lisibles et bien formées, nom et fonda_set_id concordants, exactement un
// fichier pour le set_id. Renvoie { parExecution, fichier } (fichier : null si 0 ou >1).
function examinerFichiers({ setId, fichiers, constats }) {
  const nomAttendu = `${setId}.lot.json`;
  const parExecution = new Map();
  const duLot = [];
  for (const f of fichiers) {
    if (!f || f.proprietesLisibles !== true || !f.properties || typeof f.properties !== 'object') {
      constats.ajouter('abandon', `fichier candidats/ ${f && f.nom} : properties absentes ou illisibles (≠ absence de dépôt)`);
      continue;
    }
    const p = f.properties;
    if (typeof p.fonda_set_id !== 'string' || !C.SET_ID_PATTERN.test(p.fonda_set_id) || typeof p.fonda_execution_id !== 'string' || !p.fonda_execution_id) {
      constats.ajouter('abandon', `fichier candidats/ ${f.nom} : properties fonda_set_id / fonda_execution_id malformées`);
      continue;
    }
    if (!parExecution.has(p.fonda_execution_id)) parExecution.set(p.fonda_execution_id, []);
    parExecution.get(p.fonda_execution_id).push(f);
    if (f.nom === nomAttendu || p.fonda_set_id === setId) {
      if (f.nom !== nomAttendu || p.fonda_set_id !== setId) constats.ajouter('abandon', `fichier candidats/ ${f.nom} : nom et fonda_set_id discordants pour ${setId}`);
      duLot.push(f);
    }
  }
  if (duLot.length !== 1) constats.ajouter('abandon', `${duLot.length} fichier(s) candidat(s) pour ${setId} (exactement un attendu)`);
  return { parExecution, fichier: duLot.length === 1 ? duLot[0] : null };
}

// §20.2 Classement des exécutions du set_id. Sur des exécutions examinées ; les
// conclusions de NOMBRE (« exactement une réussie ») exigent un examen complet ; celles
// sur les fichiers exigent le listing de candidats/ (fichiers ≠ INDISPONIBLE).
// Renvoie { retenue, fichier } : null = absent ; INDISPONIBLE = non déterminable.
function classerExecutions({ setId, examinees, complet, vueFichiers, constats }) {
  const concernees = examinees.filter((c) => c.entree.set_id === setId);
  const reussies = concernees.filter((c) => c.x.status === 'success');
  let retenue = INDISPONIBLE;
  if (complet) {
    if (reussies.length !== 1) constats.ajouter('abandon', `${reussies.length} exécution(s) de génération réussie(s) pour ${setId} (exactement une attendue)`);
    retenue = reussies.length === 1 ? reussies[0] : null;
  } else if (reussies.length > 1) constats.ajouter('abandon', `${reussies.length} exécutions de génération réussies pour ${setId} (exactement une attendue)`);
  // Candidate : l'unique exécution réussie OBSERVÉE — sa table §20.3 est évaluée même si
  // l'examen n'est pas exhaustif ; « exactement une » n'est conclu que sur examen complet.
  const candidate = reussies.length === 1 ? reussies[0] : null;
  if (vueFichiers === INDISPONIBLE) return { retenue, candidate, fichier: INDISPONIBLE };
  const { parExecution, fichier } = vueFichiers;
  for (const c of concernees) {
    if (c.x.status !== 'success' && (parExecution.get(c.x.id) || []).length) constats.ajouter('abandon', `exécution de génération ${c.x.id} en erreur APRÈS dépôt d'un fichier candidat`);
  }
  if (retenue && retenue !== INDISPONIBLE) {
    // Rattachement INVERSE : l'exécution retenue a exactement UN fichier, le lot.
    const lies = parExecution.get(retenue.x.id) || [];
    if (lies.length !== 1 || (fichier && lies[0] !== fichier)) constats.ajouter('abandon', `exécution retenue ${retenue.x.id} : ${lies.length} fichier(s) candidats/ rattaché(s) (exactement le lot attendu)`);
    if (fichier && fichier.properties.fonda_execution_id !== retenue.x.id) constats.ajouter('abandon', `fichier ${fichier.nom} : fonda_execution_id ${fichier.properties.fonda_execution_id} ≠ exécution retenue ${retenue.x.id}`);
  }
  // Fichiers rattachés à une exécution de CE lot qui n'est pas la retenue (doublon).
  for (const c of concernees) {
    if (retenue && retenue !== INDISPONIBLE && c.x.id === retenue.x.id) continue;
    for (const f of parExecution.get(c.x.id) || []) if (f !== fichier) constats.ajouter('abandon', `fichier ${f.nom} rattaché à l'exécution ${c.x.id} de ${setId} (doublon)`);
  }
  return { retenue, candidate, fichier };
}

// --- §20.4 Projection complète et empreinte_complete --------------------------------------
// Lot source : jamais de null explicite (champ optionnel absent ou non nul).
function nullsExplicites(lot) {
  const e = [];
  for (const k of Object.keys(lot)) if (lot[k] === null) e.push(k);
  (lot.cartes || []).forEach((c, i) => { for (const k of Object.keys(c || {})) if (c[k] === null) e.push(`cartes[${i}].${k}`); });
  return e;
}
function projectionComplete(lot) {
  const nul = (v) => (v === undefined ? null : v);
  return {
    schema: 'lot-complet-fonda/v1', set_id: lot.set_id, notion_id: lot.notion_id, palier: lot.palier,
    matiere: nul(lot.matiere), notion: nul(lot.notion), niveau: nul(lot.niveau),
    revue_carte_par_carte: lot.revue_carte_par_carte, nb_cartes: lot.nb_cartes, date_creation: nul(lot.date_creation),
    cartes: lot.cartes.map((c) => ({
    item_id: c.item_id, numero: nul(c.numero), question: c.question, reponse: nul(c.reponse), difficulte: nul(c.difficulte), palier: c.palier,
    profil_correction: c.profil_correction, reponses_acceptees: c.reponses_acceptees, unite: nul(c.unite), arrondi: nul(c.arrondi),
      seconde_chance: nul(c.seconde_chance), contexte: nul(c.contexte), set_id: c.set_id, notion_id: c.notion_id,
    })),
  };
}
function empreinteComplete(lot) {
  return `sha256:${sha256Hex(Buffer.from(Canonique.octetsContrat('lot-complet-fonda/v1', projectionComplete(lot))))}`;
}

// --- §20.3 Table normative de rapprochement -------------------------------------------------
// Toutes les violations sont des ABANDONS, sauf mention. `journal` : { surPremierParent,
// journal } au commit consigné (lu par l'appelant sur l'historique de confiance de design).
function rapprocher({ setId, retenue, fichier, brute, workflowId, journalCommit, registre, modelesAutorises, lotSource, empreintes, constats }) {
  const abandon = (m) => constats.ajouter('abandon', m);
  const x = retenue.x;
  // Métadonnées API d'abord : contrôlables même si une autre pièce manque.
  if (!brute || brute.workflowId !== workflowId || x.workflowId !== workflowId) abandon('workflow_id ≠ workflow épinglé');
  if (brute && brute.mode !== 'webhook') abandon(`mode d'exécution « ${brute.mode} » ≠ webhook`);
  if (x.status !== 'success') abandon('statut ≠ success');
  if (!x.startedAt || !x.stoppedAt || !DATE_SIGNEE.test(x.startedAt) || !DATE_SIGNEE.test(x.stoppedAt)) abandon('dates de l\'exécution non renseignées ou non normalisées');
  else if (x.startedAt > x.stoppedAt) abandon('demarree_le > terminee_le');
  // Extraction (API publique, includeData) : workflowData absent ne saute QUE pinData.
  if (!brute || !brute.workflowData || typeof brute.workflowData !== 'object' || Array.isArray(brute.workflowData)) {
    constats.ajouter('refus', `exécution ${x.id} : workflowData absent (information indisponible, exécution purgée ?) — refus ; abandon si elle ne reviendra pas`);
  } else {
    const pin = brute.workflowData.pinData;
    // pinData : ABSENT ou objet VIDE seulement (null, tableau, objet non vide -> inexploitable).
    if (pin !== undefined && !(pin !== null && typeof pin === 'object' && !Array.isArray(pin) && Object.keys(pin).length === 0)) abandon(`exécution ${x.id} : pinData ni absent ni objet vide — inexploitable`);
  }
  if (!brute) return null;
  const sortie = itemUnique(brute, NOEUD_SORTIE);
  if (!sortie.ok) { abandon(`exécution ${x.id} : sortie métier inexploitable (${sortie.raison})`); return null; }
  const s = sortie.json;
  try { Canonique.octetsContrat('generation-fonda/v1', s); } catch (e) { abandon(`sortie generation-fonda/v1 non conforme : ${e.message}`); return null; }
  if (s.schema !== 'generation-fonda/v1') abandon('sortie : schema ≠ generation-fonda/v1');
  // set_id, notion_id, palier
  const d = C.decomposerSetId(setId);
  if (s.set_id !== setId || retenue.entree.set_id !== setId) abandon('set_id : sortie = déclencheur = set_id demandé non respecté');
  if (!d || s.palier !== d.palier || C.slugDeNotion(s.notion_id) !== d.slug) abandon('notion_id / palier ≠ ceux encodés dans set_id');
  if (lotSource && (s.palier !== lotSource.palier || s.notion_id !== lotSource.notion_id)) abandon('notion_id / palier ≠ ceux du lot source');
  // ref et journal
  if (s.ref !== retenue.entree.ref) abandon('ref : sortie ≠ déclencheur');
  if (typeof s.journal_commit !== 'string' || !HEX40.test(s.journal_commit)) abandon('journal_commit : 40 hex attendus');
  else if (journalCommit === INDISPONIBLE) { /* lecture du journal en échec : constatée par l'appelant */ }
  else if (!journalCommit || journalCommit.surPremierParent !== true) abandon(`journal_commit ${s.journal_commit.slice(0, 7)} hors de la chaîne du premier parent de design`);
  else {
    const j = journalCommit.journal;
    const ligne = j && Array.isArray(j.lignes) ? j.lignes.find((l) => l.set_id === setId && l.transition === 'reserve') : null;
    const etat = j && Array.isArray(j.lignes) ? j.lignes.filter((l) => l.set_id === setId).map((l) => l.transition).pop() : undefined;
    if (!ligne || ligne.ref !== s.ref || etat !== 'reserve') abandon('journal au commit consigné : réservation de ce set_id avec cette ref, état « reserve », non trouvée');
  }
  // moteur (registre)
  const ligneReg = (registre || []).find((l) => l && l.version === s.moteur.version);
  if (!ligneReg || ligneReg.sha256 !== s.moteur.sha256) abandon('moteur de la sortie ≠ registre moteurs.json');
  // referentiel_version (forme ; égalité à la charge et résolution : appelant)
  if (!EMPREINTE.test(s.referentiel_version)) abandon('referentiel_version : sha256:<64 hex> attendu');
  // modèle (G5) : champ model de la RÉPONSE, liste épinglée, aucun repli
  if (!Array.isArray(modelesAutorises) || !modelesAutorises.includes(s.modele)) abandon(`modele « ${s.modele} » ∉ liste autorisée épinglée (G5)`);
  // empreintes du lot source LU (si le lot a pu être lu et validé)
  if (empreintes) {
    if (s.empreinte_pedagogique !== empreintes.pedagogique) abandon('empreinte_pedagogique ≠ empreinte recalculée du lot source lu');
    if (s.empreinte_complete !== empreintes.complete) abandon('empreinte_complete ≠ empreinte complète recalculée du lot source lu');
  }
  // fichier candidat
  if (fichier !== INDISPONIBLE && (!fichier || s.candidat_fichier_id !== fichier.id || fichier.nom !== `${setId}.lot.json`
    || fichier.properties.fonda_execution_id !== x.id || fichier.properties.fonda_set_id !== setId)) abandon('candidat_fichier_id ≠ fichier lu (nom, properties)');
  return s;
}

// --- §20.5 Réconciliation de CHAQUE décision, puis unicité ------------------------------------
// decision : decision-fonda/v1 ; contexte : { setId, lotSource (null si non lu), empreintes:
// { pedagogique, complete } (du lot lu, sinon de la sortie de génération ; null si aucune —
// les contrôles INTRINSÈQUES de la décision sont faits quand même, garde-fou 1 §20.13 r6),
// empreintePubliee(cartesGardees) -> Promise<string> }. Renvoie les erreurs.
async function reconcilier(decision, { setId, lotSource, empreintes, empreintePubliee }) {
  const e = [];
  try { Canonique.octetsContrat('decision-fonda/v1', decision); } catch (err) { return [`décision non conforme à decision-fonda/v1 : ${err.message}`]; }
  const lr = decision.lot_relu;
  const co = decision.coeur;
  if (decision.set_id !== setId || lr.set_id !== setId) e.push('lot_relu.set_id / decision.set_id ≠ set_id');
  if (empreintes && lr.empreinte_complete !== empreintes.complete) e.push('lot_relu.empreinte_complete ≠ empreinte complète recalculée du lot source');
  const relus = lr.cartes.map((c) => c.item_id);
  // Sans lot source lu (lecture en panne, déjà constatée), les contrôles qui n'en dépendent
  // pas restent faits : empreintes de la génération, choix, cohérence interne.
  if (new Set(relus).size !== relus.length) e.push('lot_relu.cartes : item_id en double');
  const ordre = lotSource ? lotSource.cartes.map((c) => c.item_id) : null;
  if (ordre && JSON.stringify(relus) !== JSON.stringify(ordre)) e.push('lot_relu.cartes : item_id ≠ ceux du lot source (même ordre, aucun manquant, doublon ni inconnu)');
  if (lr.cartes.some((c) => c.choix !== 'garder' && c.choix !== 'ecarter')) e.push('lot_relu : choix ∉ { garder, ecarter }');
  const gardees = lr.cartes.filter((c) => c.choix === 'garder').map((c) => c.item_id);
  const ecartees = lr.cartes.filter((c) => c.choix === 'ecarter').map((c) => c.item_id);
  if (JSON.stringify(co.selection) !== JSON.stringify(gardees)) e.push('coeur.selection ≠ cartes « garder » (ordre du lot source)');
  if (JSON.stringify(co.ecartees) !== JSON.stringify(ecartees)) e.push('coeur.ecartees ≠ cartes « ecarter » (ordre du lot source)');
  if (empreintes && co.empreinte_relue !== empreintes.pedagogique) e.push('coeur.empreinte_relue ≠ empreinte pédagogique du lot source');
  if (co.action === 'accepter' && gardees.length === 0) e.push('action « accepter » sans carte gardée');
  if (lotSource && co.action === 'accepter' && gardees.length > 0 && co.empreinte_publiee !== await empreintePubliee(gardees)) e.push('coeur.empreinte_publiee ≠ empreinte du lot filtré');
  return e;
}
// Unicité (§10 A) : même cœur ET même lot_relu (octets canoniques).
function unicite(decisions) {
  const coeurs = new Set(decisions.map((d) => Buffer.from(Canonique.octetsContrat('coeur-decision-fonda/v1', d.coeur)).toString('hex')));
  const relus = new Set(decisions.map((d) => Buffer.from(Canonique.octetsContrat('lot_relu-fonda/v1', d.lot_relu)).toString('hex')));
  const e = [];
  if (coeurs.size !== 1) e.push(`${coeurs.size} cœurs distincts`);
  if (relus.size !== 1) e.push(`${relus.size} lot_relu distincts`);
  return e;
}

module.exports = {
  INDISPONIBLE, STATUTS_EN_VOL, fusionner, examinerExecutions, examinerFichiers, NOEUD_ENTREE, NOEUD_SORTIE, PRIORITE, Constats, itemUnique, classerExecutions, nullsExplicites, projectionComplete, empreinteComplete,
  rapprocher, reconcilier, unicite,
};
