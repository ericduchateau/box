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
function classerExecutions({ setId, executions, details, fichiers, constats }) {
  const nomAttendu = `${setId}.lot.json`;
  const concernees = [];
  const tolerees = [];
  for (const x of executions) {
    const brute = details.get(x.id);
    const entree = brute ? itemUnique(brute, NOEUD_ENTREE) : { ok: false, raison: 'données de l\'exécution indisponibles' };
    if (!entree.ok) {
      // Item du déclencheur manquant : exécution non attribuable -> incident (§20.2).
      constats.ajouter('incident', `exécution ${x.id} du workflow de génération : item du déclencheur manquant (${entree.raison}) — non attribuable`);
      continue;
    }
    if (typeof entree.json.set_id !== 'string' || typeof entree.json.ref !== 'string') {
      constats.ajouter('incident', `exécution ${x.id} : déclencheur sans { set_id, ref } exploitable — non attribuable`);
      continue;
    }
    if (entree.json.set_id !== setId) continue;
    concernees.push({ x, entree: entree.json });
  }
  // Fichiers candidats : lien fichier <-> exécution par properties PUBLIQUES (§20.2).
  const parExecution = new Map();
  let duLot = [];
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
  const reussies = [];
  for (const c of concernees) {
    const { x } = c;
    if (!STATUTS_TERMINAUX.includes(x.status)) {
      constats.ajouter('incident', `exécution de génération ${x.id} de ${setId} non terminée (${x.status}) : incident de chaîne`);
    } else if (x.status !== 'success') {
      if ((parExecution.get(x.id) || []).length) constats.ajouter('abandon', `exécution de génération ${x.id} en erreur APRÈS dépôt d'un fichier candidat`);
      else tolerees.push(x.id);
    } else reussies.push(c);
  }
  if (reussies.length !== 1) constats.ajouter('abandon', `${reussies.length} exécution(s) de génération réussie(s) pour ${setId} (exactement une attendue)`);
  if (duLot.length !== 1) constats.ajouter('abandon', `${duLot.length} fichier(s) candidat(s) pour ${setId} (exactement un attendu)`);
  const retenue = reussies.length === 1 ? reussies[0] : null;
  const fichier = duLot.length === 1 ? duLot[0] : null;
  if (retenue && fichier && fichier.properties.fonda_execution_id !== retenue.x.id) {
    constats.ajouter('abandon', `fichier ${fichier.nom} : fonda_execution_id ${fichier.properties.fonda_execution_id} ≠ exécution retenue ${retenue.x.id}`);
  }
  // Fichiers rattachés à une exécution de CE lot qui n'est pas la retenue (doublon) -> abandon.
  for (const c of concernees) {
    if (retenue && c.x.id === retenue.x.id) continue;
    for (const f of parExecution.get(c.x.id) || []) if (f !== fichier) constats.ajouter('abandon', `fichier ${f.nom} rattaché à l'exécution ${c.x.id} de ${setId} (doublon)`);
  }
  return { retenue, fichier, tolerees };
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
  // Extraction (API publique, includeData).
  if (!brute || !brute.workflowData || typeof brute.workflowData !== 'object') {
    constats.ajouter('refus', `exécution ${x.id} : workflowData absent (information indisponible, exécution purgée ?) — refus ; abandon si elle ne reviendra pas`);
    return null;
  }
  const pin = brute.workflowData.pinData;
  if (pin !== undefined && pin !== null && !(typeof pin === 'object' && !Array.isArray(pin) && Object.keys(pin).length === 0)) abandon(`exécution ${x.id} : pinData non vide (données épinglées) — inexploitable`);
  const sortie = itemUnique(brute, NOEUD_SORTIE);
  if (!sortie.ok) { abandon(`exécution ${x.id} : sortie métier inexploitable (${sortie.raison})`); return null; }
  const s = sortie.json;
  try { Canonique.octetsContrat('generation-fonda/v1', s); } catch (e) { abandon(`sortie generation-fonda/v1 non conforme : ${e.message}`); return null; }
  if (s.schema !== 'generation-fonda/v1') abandon('sortie : schema ≠ generation-fonda/v1');
  // set_id, notion_id, palier
  const d = C.decomposerSetId(setId);
  if (s.set_id !== setId || retenue.entree.set_id !== setId) abandon('set_id : sortie = déclencheur = set_id demandé non respecté');
  if (!d || s.palier !== d.palier || s.palier !== lotSource.palier || s.notion_id !== lotSource.notion_id || C.slugDeNotion(s.notion_id) !== d.slug) abandon('notion_id / palier ≠ ceux encodés dans set_id');
  // ref et journal
  if (s.ref !== retenue.entree.ref) abandon('ref : sortie ≠ déclencheur');
  if (typeof s.journal_commit !== 'string' || !HEX40.test(s.journal_commit)) abandon('journal_commit : 40 hex attendus');
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
  // empreintes du lot source LU
  if (s.empreinte_pedagogique !== empreintes.pedagogique) abandon('empreinte_pedagogique ≠ empreinte recalculée du lot source lu');
  if (s.empreinte_complete !== empreintes.complete) abandon('empreinte_complete ≠ empreinte complète recalculée du lot source lu');
  // fichier candidat
  if (!fichier || s.candidat_fichier_id !== fichier.id || fichier.nom !== `${setId}.lot.json`
    || fichier.properties.fonda_execution_id !== x.id || fichier.properties.fonda_set_id !== setId) abandon('candidat_fichier_id ≠ fichier lu (nom, properties)');
  // métadonnées API
  if (brute.workflowId !== workflowId || x.workflowId !== workflowId) abandon('workflow_id ≠ workflow épinglé');
  if (brute.mode !== 'webhook') abandon(`mode d'exécution « ${brute.mode} » ≠ webhook`);
  if (x.status !== 'success') abandon('statut ≠ success');
  if (!x.startedAt || !x.stoppedAt || !DATE_SIGNEE.test(x.startedAt) || !DATE_SIGNEE.test(x.stoppedAt)) abandon('dates de l\'exécution non renseignées ou non normalisées');
  else if (x.startedAt > x.stoppedAt) abandon('demarree_le > terminee_le');
  return s;
}

// --- §20.5 Réconciliation de CHAQUE décision, puis unicité ------------------------------------
// decision : decision-fonda/v1 ; contexte : { setId, lotSource, empreintes: { pedagogique,
// complete }, empreintePubliee(cartesGardees) -> Promise<string> }. Renvoie les erreurs.
async function reconcilier(decision, { setId, lotSource, empreintes, empreintePubliee }) {
  const e = [];
  try { Canonique.octetsContrat('decision-fonda/v1', decision); } catch (err) { return [`décision non conforme à decision-fonda/v1 : ${err.message}`]; }
  const lr = decision.lot_relu;
  const co = decision.coeur;
  if (decision.set_id !== setId || lr.set_id !== setId) e.push('lot_relu.set_id / decision.set_id ≠ set_id');
  if (lr.empreinte_complete !== empreintes.complete) e.push('lot_relu.empreinte_complete ≠ empreinte complète recalculée du lot source');
  const ordre = lotSource.cartes.map((c) => c.item_id);
  const relus = lr.cartes.map((c) => c.item_id);
  if (JSON.stringify(relus) !== JSON.stringify(ordre)) e.push('lot_relu.cartes : item_id ≠ ceux du lot source (même ordre, aucun manquant, doublon ni inconnu)');
  if (lr.cartes.some((c) => c.choix !== 'garder' && c.choix !== 'ecarter')) e.push('lot_relu : choix ∉ { garder, ecarter }');
  const gardees = lr.cartes.filter((c) => c.choix === 'garder').map((c) => c.item_id);
  const ecartees = lr.cartes.filter((c) => c.choix === 'ecarter').map((c) => c.item_id);
  if (JSON.stringify(co.selection) !== JSON.stringify(gardees)) e.push('coeur.selection ≠ cartes « garder » (ordre du lot source)');
  if (JSON.stringify(co.ecartees) !== JSON.stringify(ecartees)) e.push('coeur.ecartees ≠ cartes « ecarter » (ordre du lot source)');
  if (co.empreinte_relue !== empreintes.pedagogique) e.push('coeur.empreinte_relue ≠ empreinte pédagogique du lot source');
  if (co.action === 'accepter' && gardees.length === 0) e.push('action « accepter » sans carte gardée');
  if (co.action === 'accepter' && gardees.length > 0 && co.empreinte_publiee !== await empreintePubliee(gardees)) e.push('coeur.empreinte_publiee ≠ empreinte du lot filtré');
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
  NOEUD_ENTREE, NOEUD_SORTIE, PRIORITE, Constats, itemUnique, classerExecutions, nullsExplicites, projectionComplete, empreinteComplete,
  rapprocher, reconcilier, unicite,
};
