// Journal des identifiants FONDA (CDC relecture §6, C5 v5 / C2 v6 ; migration M2 §4.3).
//
// fonda/data/set_ids-journal.json = { schema, lignes: [{ set_id, transition, le, ref }] },
// journal de transitions EN AJOUT SEUL : aucune ligne n'est jamais modifiée ni
// supprimée ; l'état courant d'un set_id est DÉRIVÉ de sa dernière transition.
//   transitions autorisées : reserve -> publie, reserve -> abandonne, publie -> retire ;
//   la première transition d'un set_id est toujours `reserve` ; jamais de nouvelle
//   `reserve` pour un set_id déjà présent ; chaque `reserve` porte une `ref` UNIQUE.
//
// Autorité : la branche `design`. Une réservation = un commit sur design (via PR)
// AVANT la création du candidat ; le générateur vérifie ensuite, dans le journal de
// design, que la ligne `reserve` de ce set_id porte bien SA ref (sinon arrêt).
//
// FRONTIÈRE avec le chantier 3 (fonda/scripts/verifier-immuabilite.js, à venir) :
// CE module lit et valide UN état du journal (pur). L'enforcement CI sur
// l'historique de confiance — ajout seul (aucune ligne modifiée/supprimée d'une
// version à l'autre), transitions conformes, aucun double `reserve` à travers les
// fusions, journal exigé pour toute première publication (annexe B §17) —
// appartiendra à verifier-immuabilite.js, qui s'appuiera sur ce module ; il n'est pas
// dupliqué ici.

'use strict';

const { SET_ID_PATTERN } = require('./catalogue.js');

const SCHEMA_JOURNAL = 'set-ids-journal/v1';
const TRANSITIONS = Object.freeze(['reserve', 'publie', 'abandonne', 'retire']);
const SUIVANTES = Object.freeze({ reserve: ['publie', 'abandonne'], publie: ['retire'], abandonne: [], retire: [] });
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z)?$/;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{3,127}$/;
const CHAMPS_LIGNE = Object.freeze(['set_id', 'transition', 'le', 'ref']);

// Lecture fail-closed : texte illisible ou JSON invalide -> exception (jamais un
// journal vide implicite).
function lireJournalTexte(texte) {
  let j;
  try { j = JSON.parse(texte); } catch (e) { throw new Error(`journal des set_id illisible (JSON invalide) : ${e.message}`); }
  return j;
}

// Validation d'un état du journal. Renvoie { valide, erreurs, etats: Map(set_id -> état) }.
function validerJournal(journal) {
  const erreurs = [];
  const etats = new Map();
  if (!journal || typeof journal !== 'object' || Array.isArray(journal)
    || Object.keys(journal).sort().join() !== 'lignes,schema' || journal.schema !== SCHEMA_JOURNAL || !Array.isArray(journal.lignes)) {
    return { valide: false, erreurs: [`journal : forme attendue { schema: "${SCHEMA_JOURNAL}", lignes: [...] }`], etats };
  }
  const refs = new Set();
  journal.lignes.forEach((l, i) => {
    const p = `ligne ${i + 1}`;
    if (!l || typeof l !== 'object' || Array.isArray(l)) { erreurs.push(`${p} : non objet`); return; }
    const cles = Object.keys(l);
    if (cles.length !== CHAMPS_LIGNE.length || !CHAMPS_LIGNE.every((k) => cles.includes(k))) { erreurs.push(`${p} : champs attendus exactement ${CHAMPS_LIGNE.join(', ')}`); return; }
    if (typeof l.set_id !== 'string' || !SET_ID_PATTERN.test(l.set_id)) { erreurs.push(`${p} : set_id invalide`); return; }
    if (!TRANSITIONS.includes(l.transition)) { erreurs.push(`${p} : transition inconnue`); return; }
    if (typeof l.le !== 'string' || !DATE_PATTERN.test(l.le)) erreurs.push(`${p} : date « le » invalide`);
    if (typeof l.ref !== 'string' || !REF_PATTERN.test(l.ref)) erreurs.push(`${p} : ref invalide`);
    const avant = etats.get(l.set_id);
    if (l.transition === 'reserve') {
      if (avant !== undefined) { erreurs.push(`${p} : double reserve pour ${l.set_id} (jamais de nouvelle reserve pour un set_id déjà présent)`); return; }
      if (refs.has(l.ref)) erreurs.push(`${p} : ref de réservation déjà utilisée (${l.ref})`);
      refs.add(l.ref);
    } else if (avant === undefined) {
      erreurs.push(`${p} : ${l.transition} sans reserve préalable pour ${l.set_id}`); return;
    } else if (!SUIVANTES[avant].includes(l.transition)) {
      erreurs.push(`${p} : transition ${avant} -> ${l.transition} interdite pour ${l.set_id}`); return;
    }
    etats.set(l.set_id, l.transition);
  });
  return { valide: erreurs.length === 0, erreurs, etats };
}

function etatCourant(journal, setId) {
  const v = validerJournal(journal);
  if (!v.valide) throw new Error(`journal des set_id non conforme : ${v.erreurs.join(' ; ')}`);
  return v.etats.get(setId) || null;
}

// Réservation à vérifier AVANT la création d'un candidat : la dernière transition
// est `reserve` et la ligne `reserve` porte exactement la ref attendue.
function verifierReservation(journal, setId, ref) {
  const v = validerJournal(journal);
  if (!v.valide) return { ok: false, raison: `journal non conforme : ${v.erreurs.join(' ; ')}` };
  const ligne = journal.lignes.find((l) => l.set_id === setId && l.transition === 'reserve');
  if (!ligne) return { ok: false, raison: `${setId} : aucune réservation dans le journal de référence` };
  if (ligne.ref !== ref) return { ok: false, raison: `${setId} : la réservation porte la ref ${ligne.ref}, pas ${ref}` };
  if (v.etats.get(setId) !== 'reserve') return { ok: false, raison: `${setId} : état courant ${v.etats.get(setId)} (seul « reserve » permet de créer un candidat)` };
  return { ok: true };
}

// Ligne de réservation à AJOUTER (pure) : ne vérifie que l'absence du set_id.
function ligneReservation(journal, setId, le, ref) {
  const v = validerJournal(journal);
  if (!v.valide) throw new Error(`journal non conforme : ${v.erreurs.join(' ; ')}`);
  if (v.etats.has(setId)) throw new Error(`${setId} déjà présent dans le journal (état ${v.etats.get(setId)}) : jamais de nouvelle reserve`);
  const ligne = { set_id: setId, transition: 'reserve', le, ref };
  const essai = validerJournal({ schema: journal.schema, lignes: [...journal.lignes, ligne] });
  if (!essai.valide) throw new Error(essai.erreurs.join(' ; '));
  return ligne;
}

// Cohérence d'UN état du dépôt (pas d'historique) : catalogue <-> journal.
//   - toute entrée du catalogue est « publie » ; tout « publie » est au catalogue ;
//   - tout lot de calibration présent est au journal, ni publié ni retiré.
function coherenceAvecDepot(journal, { catalogueIds, calibrationIds }) {
  const v = validerJournal(journal);
  if (!v.valide) return v.erreurs;
  const erreurs = [];
  for (const id of catalogueIds) if (v.etats.get(id) !== 'publie') erreurs.push(`${id} : au catalogue mais état journal ${v.etats.get(id) || 'absent'} (attendu publie)`);
  for (const [id, e] of v.etats) if (e === 'publie' && !catalogueIds.includes(id)) erreurs.push(`${id} : publié au journal mais absent du catalogue`);
  for (const id of calibrationIds) {
    const e = v.etats.get(id);
    if (e !== 'reserve' && e !== 'abandonne') erreurs.push(`${id} : lot de calibration avec état journal ${e || 'absent'} (attendu reserve ou abandonne)`);
  }
  return erreurs;
}

// Classement M2 (pur, fail-closed). Entrées : identifiants ACTUELS (catalogue,
// fichiers de lots/, fichiers de calibration) et identifiants vus dans l'HISTORIQUE
// Git de ces fichiers (scan textuel, sur-inclusif). Sortie : lignes du journal.
//   - publié = au catalogue ET fichier lots/<set_id>.json présent -> reserve + publie ;
//   - lot de calibration présent (non publié) -> reserve (promouvable) ;
//   - tout autre identifiant vu dans l'historique -> reserve + abandonne ;
//   - incohérence actuelle (catalogue sans fichier, fichier sans catalogue, publié ET
//     en calibration, identifiant non canonique) -> EXCEPTION : M2 s'arrête, décision
//     humaine requise (jamais de classement deviné).
function classerM2({ catalogueIds, lotsIds, calibrationIds, historiqueIds, le, prefixeRef }) {
  const tous = new Set([...catalogueIds, ...lotsIds, ...calibrationIds, ...historiqueIds]);
  for (const id of tous) if (!SET_ID_PATTERN.test(id)) throw new Error(`M2 : identifiant non canonique « ${id} » — arrêt`);
  for (const id of catalogueIds) if (!lotsIds.includes(id)) throw new Error(`M2 : ${id} au catalogue sans fichier lots/ — arrêt`);
  for (const id of lotsIds) if (!catalogueIds.includes(id)) throw new Error(`M2 : ${id} a un fichier lots/ hors catalogue — arrêt`);
  for (const id of calibrationIds) if (catalogueIds.includes(id)) throw new Error(`M2 : ${id} à la fois publié et en calibration — arrêt`);
  if (new Set(calibrationIds).size !== calibrationIds.length) throw new Error('M2 : set_id de calibration en double — arrêt');
  const lignes = [];
  const reserve = (id) => lignes.push({ set_id: id, transition: 'reserve', le, ref: `${prefixeRef}:${id}` });
  for (const id of [...tous].sort()) {
    reserve(id);
    if (catalogueIds.includes(id)) lignes.push({ set_id: id, transition: 'publie', le, ref: `${prefixeRef}:${id}:publie` });
    else if (!calibrationIds.includes(id)) lignes.push({ set_id: id, transition: 'abandonne', le, ref: `${prefixeRef}:${id}:abandonne` });
  }
  return lignes;
}

module.exports = {
  SCHEMA_JOURNAL, TRANSITIONS, lireJournalTexte, validerJournal, etatCourant, verifierReservation,
  ligneReservation, coherenceAvecDepot, classerM2,
};
