// Vérification d'une attestation « Type 2 » (clôture signée) — CDC relecture §11,
// §11 bis, §12, §14. Node seulement (require('crypto') permis : jamais copié dans n8n).
//
// Enveloppe : { type: "cloture-signee", charge, signature } ; signature = base64 d'une
// signature RSA-SHA256 PKCS#1 v1.5 sur les OCTETS CANONIQUES de la charge, au contrat
// désigné par charge.schema ∈ { attestation-cloture/v1, v2, v3 }
// (fonda/engine/canonique.js — la charge ne contient jamais de champ « signature »).
// v1 acceptée telle quelle ; v2 (CDC v8.3 §20.9) : invariants COMMUNS puis PAR SOURCE
// (page_relecture | saisie_locale), liaison de génération, modèle ∈ liste épinglée (G5).
// v3 (CDC r9 §20.6, §20.9) : relecteur de SECOURS en intérim, saisie locale seule ; liste
// explicite d'invariants (invariantsValeurV3) ; archive d'intérim au dépôt (resoudreInterim :
// version -> { ok, octets }, historique de confiance ; exigé pour v3 seulement).
//
// Clés : fonda/data/cles/cles.json = [{ cle_id, fichier, sha256_pem, algorithme,
// valide_du, valide_au, revoquee_le }] ; fichier = « cles/<cle_id>.pem » (SPKI PEM,
// relatif à fonda/data) ; sha256_pem = SHA-256 hex des octets du PEM ; algorithme =
// "RSA-SHA256-PKCS1v15" ; RSA ≥ 3072 bits. Une clé n'est chargée QUE via un cle_id
// déclaré. Recevabilité (§11, §14) : cloture_le ∈ [valide_du, valide_au] (une
// attestation reste recevable après expiration de la clé) ; clé RÉVOQUÉE -> TOUTES ses
// attestations irrecevables.
//
// ORDRE FAIL-CLOSED : forme de l'enveloppe -> clé déclarée, PEM intègre, recevable ->
// SIGNATURE -> invariants de VALEUR (ce que canonique.js ne vérifie pas) -> invariants
// de DÉPÔT (entrée du catalogue, lot publié, registre des moteurs, référentiel).
//
// FRONTIÈRE : ce module vérifie ce qui est vérifiable depuis la charge, le lot publié,
// l'entrée et la clé publique. Relèvent de signer-cloture.js (étape 4b), car
// l'instantané, le candidat et l'API n8n ne sont pas au dépôt :
//   - sha256_instantane égal au SHA-256 de l'instantané réel ;
//   - partition selection/ecartees contre le candidat réel ;
//   - rapprochement exécution n8n <-> lot, épinglage et choix de l'exécution de
//     clôture (la plus récente, égalité -> refus) ;
//   - choix du badge depuis la table des relecteurs VERSIONNÉE au moment de la
//     clôture. Ici, le badge SIGNÉ fait foi : il n'est jamais recalculé depuis la table
//     courante.

'use strict';

const crypto = require('crypto');
const Canonique = require('../engine/canonique.js');
const I = require('./interim.js');

const TYPE = 'cloture-signee';
const ALGORITHME = 'RSA-SHA256-PKCS1v15';
const CHAMPS_CLE = ['cle_id', 'fichier', 'sha256_pem', 'algorithme', 'valide_du', 'valide_au', 'revoquee_le'];
const DATE_SIGNEE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MODES = ['vive_voix', 'reponse_message', 'auto'];
const FORMES_BADGE = ['relue_et_validee', 'relue_par'];
const TYPES_LEVEE = ['recherche_incomplete', 'historique_incomplet'];
const BADGE_AUTO = { forme: 'relue_par', nom_affiche: 'Éric Duchateau', id: 'eric' };
const BADGE_SANS_NOM = { forme: 'relue_par', nom_affiche: 'un professeur', id: null };

// Date d'une charge signée : forme EXACTE de toISOString (UTC, milliseconde, « Z ») et
// date calendaire réelle.
function dateSignee(v) {
  if (typeof v !== 'string' || !DATE_SIGNEE.test(v)) return false;
  const t = Date.parse(v);
  return !Number.isNaN(t) && new Date(t).toISOString() === v;
}
const estTexte = (v) => typeof v === 'string' && v.trim() !== '';
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b); // tableaux ordonnés seulement
// Égalités d'OBJETS indépendantes de l'ordre des clés (les octets canoniques, eux, sont
// reconstruits dans l'ordre du contrat) : champ par champ.
const memeMoteur = (a, b) => !!a && !!b && a.version === b.version && a.sha256 === b.sha256;
// Badge : forme, nom, id ET titulaire (présent des deux côtés et égal, ou absent des deux
// côtés — badge de secours v3).
const aTitulaire = (x) => Object.prototype.hasOwnProperty.call(x, 'titulaire');
const memeTitulaire = (a, b) => (!aTitulaire(a) && !aTitulaire(b))
  || (aTitulaire(a) && aTitulaire(b) && !!a.titulaire && !!b.titulaire && a.titulaire.id === b.titulaire.id && a.titulaire.nom_affiche === b.titulaire.nom_affiche);
const memeBadge = (a, b) => !!a && !!b && a.forme === b.forme && a.nom_affiche === b.nom_affiche && a.id === b.id && memeTitulaire(a, b);

// PEM de clé PUBLIQUE SPKI strict : un seul bloc « PUBLIC KEY », base64 canonique ;
// tout autre conteneur (PRIVATE KEY, RSA PUBLIC KEY/PKCS#1, ENCRYPTED, certificat) est
// refusé AVANT tout chargement. Une clé privée dans le dépôt public = compromission.
const PEM_SPKI = /^-----BEGIN PUBLIC KEY-----\r?\n((?:[A-Za-z0-9+/=]{1,76}\r?\n)+)-----END PUBLIC KEY-----\r?\n?$/;
function derSpki(pem) {
  if (typeof pem !== 'string' || /PRIVATE/.test(pem)) return null;
  const m = PEM_SPKI.exec(pem);
  if (!m) return null;
  const b64 = m[1].replace(/\r?\n/g, '');
  const der = Buffer.from(b64, 'base64');
  return der.toString('base64') === b64 ? der : null;
}
// Base64 STRICT : une seule écriture admise pour un même contenu (réencodage identique).
function base64Strict(v) {
  if (typeof v !== 'string' || v.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return null;
  const b = Buffer.from(v, 'base64');
  return b.toString('base64') === v ? b : null;
}

// --- Clés -----------------------------------------------------------------------------
// `lirePem(fichier)` -> chaîne (lecture injectée : tests).
function chargerCles(cles, lirePem) {
  if (!Array.isArray(cles)) throw new Error('cles.json : tableau attendu');
  const parId = new Map();
  for (const c of cles) {
    if (!c || typeof c !== 'object' || Object.keys(c).length !== CHAMPS_CLE.length || !CHAMPS_CLE.every((k) => Object.prototype.hasOwnProperty.call(c, k))) {
      throw new Error(`cles.json : champs attendus exactement ${CHAMPS_CLE.join(', ')}`);
    }
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(c.cle_id)) throw new Error(`cles.json : cle_id invalide (${c.cle_id})`);
    if (parId.has(c.cle_id)) throw new Error(`cles.json : cle_id en double (${c.cle_id})`);
    if (c.fichier !== `cles/${c.cle_id}.pem`) throw new Error(`cles.json : ${c.cle_id} : fichier doit valoir cles/${c.cle_id}.pem`);
    if (c.algorithme !== ALGORITHME) throw new Error(`cles.json : ${c.cle_id} : algorithme ${ALGORITHME} attendu`);
    if (!/^[0-9a-f]{64}$/.test(c.sha256_pem)) throw new Error(`cles.json : ${c.cle_id} : sha256_pem invalide`);
    if (!dateSignee(c.valide_du) || !dateSignee(c.valide_au) || c.valide_du > c.valide_au) throw new Error(`cles.json : ${c.cle_id} : période de validité invalide`);
    if (c.revoquee_le !== null && !dateSignee(c.revoquee_le)) throw new Error(`cles.json : ${c.cle_id} : revoquee_le invalide`);
    parId.set(c.cle_id, c);
  }
  // Le PEM n'est lu QUE pour une clé déclarée, à la demande.
  return {
    ids: [...parId.keys()],
    obtenir(cleId) {
      const c = parId.get(cleId);
      if (!c) return { ok: false, raison: `clé « ${cleId} » non déclarée dans cles.json` };
      let pem;
      try { pem = lirePem(c.fichier); } catch { return { ok: false, raison: `${c.fichier} illisible` }; }
      if (crypto.createHash('sha256').update(pem).digest('hex') !== c.sha256_pem) return { ok: false, raison: `${c.fichier} : sha256_pem discordant` };
      const der = derSpki(pem);
      if (!der) return { ok: false, raison: `${c.fichier} : un unique bloc PEM « PUBLIC KEY » (SPKI) attendu — clé privée ou autre format refusé` };
      let cle;
      try { cle = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' }); } catch { return { ok: false, raison: `${c.fichier} : clé publique SPKI illisible` }; }
      if (cle.type !== 'public' || !cle.export({ type: 'spki', format: 'der' }).equals(der)) return { ok: false, raison: `${c.fichier} : contenu SPKI non canonique` };
      const d = cle.asymmetricKeyDetails || {};
      if (cle.asymmetricKeyType !== 'rsa' || !(d.modulusLength >= 3072)) return { ok: false, raison: `${c.cle_id} : clé RSA ≥ 3072 bits attendue` };
      return { ok: true, declaration: c, cle };
    },
  };
}

function recevabilite(declaration, clotureLe) {
  if (declaration.revoquee_le !== null) return `clé ${declaration.cle_id} révoquée le ${declaration.revoquee_le} : toutes ses attestations sont irrecevables (§14)`;
  if (!dateSignee(clotureLe)) return 'cloture_le invalide';
  if (clotureLe < declaration.valide_du || clotureLe > declaration.valide_au) return `cloture_le ${clotureLe} hors de la période de validité de la clé ${declaration.cle_id}`;
  return null;
}

// --- Invariants de VALEUR de la charge (§11, §11 bis ; v2 : §20.9) ---------------------
// Pièces COMMUNES à v1 et v2 (tout ce qui ne porte ni sur provenances, ni sur
// execution_cloture, ni sur revoque_le).
function datesIncidents(ch) {
  const dates = [];
  ch.incidents_connus.forEach((x, i) => {
    dates.push([`incidents_connus[${i}].detecte_le`, x.detecte_le]);
    if (x.resolu_le !== null) dates.push([`incidents_connus[${i}].resolu_le`, x.resolu_le]);
    if (x.periode.debut !== null) dates.push([`incidents_connus[${i}].periode.debut`, x.periode.debut]);
    if (x.periode.fin !== null) dates.push([`incidents_connus[${i}].periode.fin`, x.periode.fin]);
  });
  return dates;
}
function verifierDates(e, dates) {
  for (const [nom, v] of dates) if (!dateSignee(v)) e.push(`${nom} : date ISO UTC à la milliseconde attendue (fuseau Z)`);
}
function invariantsCode(ch, e) {
  if (!/^[0-9a-f]{64}$/.test(ch.sha256_instantane)) e.push('sha256_instantane : 64 hex attendus');
  else if (ch.code_confirmation !== ch.sha256_instantane.slice(0, 16)) e.push('code_confirmation ≠ 16 premiers hex de sha256_instantane');
}
function invariantsCommuns(ch, e) {
  // Confirmation (§5, §11 bis)
  const cf = ch.confirmation;
  if (!MODES.includes(cf.mode)) e.push(`confirmation.mode hors énumération (${cf.mode})`);
  if (cf.par !== ch.relecteur_attribue) e.push('confirmation.par ≠ relecteur_attribue');
  if (cf.recue_par !== 'eric') e.push('confirmation.recue_par ≠ "eric"');
  const auto = cf.mode === 'auto';
  if (auto !== (ch.relecteur_egal_cloturer === true) || auto !== (ch.relecteur_attribue === 'eric')) {
    e.push('mode = "auto" ⇔ relecteur_egal_cloturer ⇔ relecteur_attribue = "eric" : non respecté');
  }
  if (ch.fidelite_transmission.atteste_par !== 'eric') e.push('fidelite_transmission.atteste_par ≠ "eric"');
  invariantsCoeurLeveesIncidents(ch, e);
  // Badge (§11 bis, par priorité)
  const b = ch.badge;
  if (!FORMES_BADGE.includes(b.forme)) e.push(`badge.forme hors énumération (${b.forme})`);
  if (auto && !memeBadge(b, BADGE_AUTO)) e.push('badge : auto-confirmation ⇒ { relue_par, Éric Duchateau, eric }');
  if (!auto) {
    const nomme = b.forme === 'relue_et_validee' && b.id === ch.relecteur_attribue && estTexte(b.nom_affiche);
    if (!nomme && !memeBadge(b, BADGE_SANS_NOM)) e.push('badge incohérent : relue_et_validee au nom du relecteur attribué, ou forme « sans nom »');
  }
  if (!(b.id === null || b.id === ch.relecteur_attribue)) e.push('badge.id ∉ { relecteur_attribue, null }');
}
// Pièces NEUTRES (cœur, nombre de fichiers, levées, incidents) : communes à v1, v2 et v3,
// extraites de invariantsCommuns SANS changement (même ordre, mêmes messages).
function invariantsCoeurLeveesIncidents(ch, e) {
  // Cœur
  const co = ch.coeur;
  if (co.action !== 'accepter') e.push('coeur.action ≠ "accepter"');
  const tous = [...co.selection, ...co.ecartees];
  if (new Set(tous).size !== tous.length) e.push('coeur : selection et ecartees non disjointes ou avec doublon');
  if (co.selection.length === 0) e.push('coeur.selection vide');
  if (!Number.isSafeInteger(ch.nb_fichiers_decision) || ch.nb_fichiers_decision < 1) e.push('nb_fichiers_decision : entier ≥ 1 attendu');
  // Levées : types connus, une au plus par type, ordre du CDC
  const types = ch.levees.map((l) => l.type);
  if (types.some((t) => !TYPES_LEVEE.includes(t))) e.push('levees : type inconnu');
  if (new Set(types).size !== types.length) e.push('levees : type en double');
  if (!egal(types, TYPES_LEVEE.filter((t) => types.includes(t)))) e.push('levees : ordre ≠ recherche_incomplete puis historique_incomplet');
  ch.levees.forEach((l, i) => { if (!estTexte(l.constat)) e.push(`levees[${i}].constat vide`); });
  // Incidents : tous résolus, date + preuve, fin = résolution, id unique et trié
  const incIds = ch.incidents_connus.map((x) => x.id);
  if (new Set(incIds).size !== incIds.length) e.push('incidents_connus : id en double');
  ch.incidents_connus.forEach((x, i) => {
    if (x.statut !== 'resolu') e.push(`incidents_connus[${i}] non résolu : une charge signée n'admet que des incidents résolus`);
    if (x.resolu_le === null || !estTexte(x.preuve_resolution)) e.push(`incidents_connus[${i}] : resolu_le et preuve_resolution requis`);
    if (x.periode.fin !== x.resolu_le) e.push(`incidents_connus[${i}] : periode.fin ≠ resolu_le`);
    const y = ch.incidents_connus[i + 1];
    if (y && !(x.id < y.id)) e.push('incidents_connus : ordre par id (unités de code) non respecté');
  });
}
// Provenances (§11 bis) : ≥ 1, success, execution_id unique, tri (date puis id).
function invariantsProvenances(ch, e) {
  if (ch.provenances.length === 0) e.push('provenances vides');
  const ids = ch.provenances.map((p) => p.execution_id);
  if (new Set(ids).size !== ids.length) e.push('provenances : execution_id en double');
  ch.provenances.forEach((p, i) => {
    if (p.statut !== 'success') e.push(`provenances[${i}].statut ≠ "success"`);
    if (!estTexte(p.execution_id) || !estTexte(p.workflow_id)) e.push(`provenances[${i}] : identifiants vides`);
    const q = ch.provenances[i + 1];
    if (q && !(p.demarree_le < q.demarree_le || (p.demarree_le === q.demarree_le && p.execution_id < q.execution_id))) {
      e.push(`provenances : ordre (demarree_le puis execution_id, par unité de code) non respecté à l'index ${i}`);
    }
  });
}
function invariantsExecutionCloture(ec, e) {
  if (ec.statut !== 'success') e.push('execution_cloture.statut ≠ "success"');
  if (!estTexte(ec.execution_id) || !estTexte(ec.workflow_id)) e.push('execution_cloture : identifiants vides');
}

// v1 (§11 bis) — inchangée.
function invariantsValeurV1(ch) {
  const e = [];
  if (ch.schema !== 'attestation-cloture/v1') e.push('schema ≠ attestation-cloture/v1');
  invariantsCode(ch, e);
  verifierDates(e, [['confirmation.le', ch.confirmation.le], ['fidelite_transmission.le', ch.fidelite_transmission.le],
    ['execution_cloture.terminee_le', ch.execution_cloture.terminee_le], ['revoque_le', ch.revoque_le], ['cloture_le', ch.cloture_le],
    ...ch.provenances.map((p, i) => [`provenances[${i}].demarree_le`, p.demarree_le]), ...datesIncidents(ch)]);
  invariantsCommuns(ch, e);
  invariantsProvenances(ch, e);
  invariantsExecutionCloture(ch.execution_cloture, e);
  return e;
}

// G5 (§20.8) : identifiant Sonnet ÉPINGLÉ (snapshot à poids fixes, jamais un alias
// flottant) ; liste épinglée, identique dans le nœud n8n et ici. Deux formes :
//  - DATÉE (format inchangé) : claude-sonnet-…-AAAAMMJJ ;
//  - SANS DATE, convention Anthropic majeure[-mineure] (claude-sonnet-5, claude-sonnet-5-5) :
//    « every Claude model ID is a pinned snapshot, including the dateless IDs used from the
//    4.6 generation on » (Models overview ; Model IDs and versioning, vérifié le 2026-10-21).
// Aucun seuil de version dans le motif (fragile) : la vraie épingle est la liste curée
// modeles-autorises.json, et le signataire grave le champ model de la RÉPONSE, toujours un
// snapshot épinglé. Filet contre une liste mal remplie : DENYLIST explicite des alias
// sans date ANTÉRIEURS à la 4.6 (pointeurs vers un identifiant daté) — documentée au CDC r8.
const MODELE_DATE = /^claude-sonnet-[a-z0-9-]*\d{8}$/;
const MODELE_SANS_DATE = /^claude-sonnet-[1-9]\d*(?:-(?:0|[1-9]\d*))?$/;
const ALIAS_PRE_46 = Object.freeze(['claude-sonnet-3-5', 'claude-sonnet-3-7', 'claude-sonnet-4', 'claude-sonnet-4-0', 'claude-sonnet-4-1', 'claude-sonnet-4-5']);
function modeleEpingle(m) {
  if (typeof m !== 'string') return false;
  if (MODELE_DATE.test(m)) return true;
  return MODELE_SANS_DATE.test(m) && !ALIAS_PRE_46.includes(m);
}
function modelesValides(liste) {
  return Array.isArray(liste) && liste.length > 0 && liste.every(modeleEpingle) && new Set(liste).size === liste.length;
}
// Lecture stricte de fonda/data/modeles-autorises.json : { schema, generation_fonda: [] }.
function lireModelesAutorises(texte) {
  let o;
  try { o = JSON.parse(texte); } catch { throw new Error('modeles-autorises.json : JSON invalide'); }
  if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).sort().join() !== 'generation_fonda,schema' || o.schema !== 'modeles-autorises/v1'
    || !Array.isArray(o.generation_fonda) || !o.generation_fonda.every(modeleEpingle)) {
    throw new Error('modeles-autorises.json : { schema: "modeles-autorises/v1", generation_fonda: [identifiants Sonnet épinglés] } attendu');
  }
  return o.generation_fonda;
}

// v2 (§20.9) : invariants COMMUNS, puis invariants PAR SOURCE. execution_cloture n'est
// déréférencé qu'en « page_relecture ».
const SOURCES = ['page_relecture', 'saisie_locale'];
const croissant = (e, nom, suite) => {
  for (let i = 0; i + 1 < suite.length; i += 1) {
    if (!(suite[i][1] <= suite[i + 1][1])) e.push(`chronologie ${nom} : ${suite[i][0]} ≤ ${suite[i + 1][0]} non respecté`);
  }
};
// Pièces de v2 PARTAGÉES avec v3, extraites SANS changement (même ordre, mêmes messages).
function datesV2(ch) {
  const g = ch.generation;
  const datesGeneration = [['generation.demarree_le', g.demarree_le], ['generation.terminee_le', g.terminee_le],
    ['generation.listing_debut_le', g.listing_debut_le], ['generation.listing_fin_le', g.listing_fin_le]];
  const communes = [...datesGeneration, ['confirmation.le', ch.confirmation.le], ['fidelite_transmission.le', ch.fidelite_transmission.le], ['cloture_le', ch.cloture_le]];
  return { datesGeneration, communes };
}
// Liaison de génération (§20.3, §20.8)
function invariantsLiaison(ch, e, modelesAutorises) {
  const g = ch.generation;
  if (g.statut !== 'success') e.push('generation.statut ≠ "success"');
  if (!estTexte(g.execution_id) || !estTexte(g.workflow_id)) e.push('generation : identifiants vides');
  if (!/^sha256:[0-9a-f]{64}$/.test(g.empreinte_complete)) e.push('generation.empreinte_complete : sha256:<64 hex> attendu');
  if (!/^[0-9a-f]{40}$/.test(g.journal_commit)) e.push('generation.journal_commit : 40 hex attendus');
  if (!/^sha256:[0-9a-f]{64}$/.test(ch.referentiel_version)) e.push('referentiel_version : sha256:<64 hex> attendu');
  if (!modelesValides(modelesAutorises)) e.push('liste des modèles autorisés absente, vide ou non épinglée : charge v2 non vérifiable (G5, §20.8)');
  else if (!modelesAutorises.includes(g.modele)) e.push(`generation.modele « ${g.modele} » ∉ modèles autorisés épinglés (G5)`);
}
function chronologieCommune(e, { datesGeneration, communes }) {
  if (communes.every(([, v]) => dateSignee(v))) croissant(e, 'commune', [datesGeneration[0], datesGeneration[1], datesGeneration[2], datesGeneration[3], communes[4], communes[5], communes[6]]);
}
// Saisie locale : structure (avant les règles d'identité) puis chronologie (après).
function structureSaisieLocale(ch, e) {
  if (ch.provenances.length !== 0) e.push('saisie_locale : provenances doit être vide');
  if (ch.execution_cloture !== null) e.push('saisie_locale : execution_cloture doit être null');
  if (ch.revoque_le !== null) e.push('saisie_locale : revoque_le doit être null');
  if (ch.fin_saisie_le === null) e.push('saisie_locale : fin_saisie_le requise (non nulle)');
  else verifierDates(e, [['fin_saisie_le', ch.fin_saisie_le]]);
  if (ch.nb_fichiers_decision !== 1) e.push('saisie_locale : nb_fichiers_decision = 1 attendu');
}
function chronologieSaisieLocale(ch, e) {
  const g = ch.generation;
  const suite = [['generation.terminee_le', g.terminee_le], ['fin_saisie_le', ch.fin_saisie_le], ['listing_debut_le', g.listing_debut_le]];
  if (suite.every(([, v]) => dateSignee(v))) croissant(e, 'saisie locale', suite);
}

function invariantsValeurV2(ch, { modelesAutorises } = {}) {
  const e = [];
  if (ch.schema !== 'attestation-cloture/v2') e.push('schema ≠ attestation-cloture/v2');
  invariantsCode(ch, e);
  const g = ch.generation;
  const dv = datesV2(ch);
  verifierDates(e, [...dv.communes, ...datesIncidents(ch)]);
  invariantsCommuns(ch, e);
  invariantsLiaison(ch, e, modelesAutorises);
  // Chronologie commune
  chronologieCommune(e, dv);
  // Par source
  if (ch.source_decisions === 'page_relecture') {
    verifierDates(e, ch.provenances.map((p, i) => [`provenances[${i}].demarree_le`, p.demarree_le]));
    invariantsProvenances(ch, e);
    if (ch.execution_cloture === null) e.push('page_relecture : execution_cloture requise (non nulle)');
    else {
      invariantsExecutionCloture(ch.execution_cloture, e);
      verifierDates(e, [['execution_cloture.terminee_le', ch.execution_cloture.terminee_le]]);
    }
    if (ch.revoque_le === null) e.push('page_relecture : revoque_le requis (non nul)');
    else verifierDates(e, [['revoque_le', ch.revoque_le]]);
    if (ch.fin_saisie_le !== null) e.push('page_relecture : fin_saisie_le doit être null');
    const suite = [['generation.terminee_le', g.terminee_le], ['revoque_le', ch.revoque_le], ['execution_cloture.terminee_le', ch.execution_cloture && ch.execution_cloture.terminee_le], ['listing_debut_le', g.listing_debut_le]];
    if (suite.every(([, v]) => dateSignee(v))) croissant(e, 'page', suite);
  } else if (ch.source_decisions === 'saisie_locale') {
    structureSaisieLocale(ch, e);
    if (ch.relecteur_attribue !== 'eric') e.push('saisie_locale : relecteur_attribue = "eric" attendu (§20.6)');
    if (ch.confirmation.mode !== 'auto') e.push('saisie_locale : confirmation.mode = "auto" attendu (§20.6)');
    chronologieSaisieLocale(ch, e);
  } else {
    e.push(`source_decisions hors énumération (${ch.source_decisions}) : ${SOURCES.join(' | ')}`);
  }
  return e;
}

// v3 (CDC r9 §20.6, §20.9 ; plan r6, annexe D) : relecteur de SECOURS en intérim, saisie
// locale seule. Liste EXPLICITE : A = repris de v2 à l'identique (pièces extraites ci-dessus) ;
// B = remplacés pour v3 seulement ; C = nouveaux. invariantsCommuns n'est PAS appelé : ses
// règles d'identité (par = attribué, auto ⇔ attribué = eric ⇔ égalité, badges v2) sont
// remplacées par B3–B7 ; ses pièces neutres (A4, A5) le sont via invariantsCoeurLeveesIncidents.
function invariantsValeurV3(ch, { modelesAutorises } = {}) {
  const e = [];
  const ri = ch.relecture_interim;
  const cf = ch.confirmation;
  const b = ch.badge;
  if (ch.schema !== 'attestation-cloture/v3') e.push('schema ≠ attestation-cloture/v3'); // B1
  invariantsCode(ch, e); // A1
  const dv = datesV2(ch);
  verifierDates(e, [...dv.communes, ['fin_saisie_le', ch.fin_saisie_le], ...datesIncidents(ch)]); // A2
  if (cf.recue_par !== 'eric') e.push('confirmation.recue_par ≠ "eric"'); // A3
  if (ch.fidelite_transmission.atteste_par !== 'eric') e.push('fidelite_transmission.atteste_par ≠ "eric"');
  invariantsCoeurLeveesIncidents(ch, e); // A4, A5
  invariantsLiaison(ch, e, modelesAutorises); // A6
  chronologieCommune(e, dv); // A7
  if (ch.source_decisions !== 'saisie_locale') e.push('v3 : source_decisions = "saisie_locale" attendu (intérim : saisie locale seule)'); // B2
  structureSaisieLocale(ch, e); // A8
  chronologieSaisieLocale(ch, e);
  // B3, B4
  if (ch.relecteur_attribue !== ri.relecteur_titulaire) e.push('v3 : relecteur_attribue ≠ relecture_interim.relecteur_titulaire');
  if (ch.relecteur_attribue === 'eric') e.push('v3 : relecteur_attribue = "eric" (l\'intérim ne concerne qu\'un autre titulaire)');
  if (ri.relecteur_de_secours !== 'eric') e.push('v3 : relecture_interim.relecteur_de_secours = "eric" attendu');
  if (ri.relecteur_titulaire === ri.relecteur_de_secours) e.push('v3 : titulaire = secours');
  // B5, B6
  if (cf.mode !== 'auto') e.push('v3 : confirmation.mode = "auto" attendu (le secours relit lui-même)');
  if (cf.par !== ri.relecteur_de_secours) e.push('v3 : confirmation.par ≠ relecteur_de_secours');
  if (ch.relecteur_egal_cloturer !== false) e.push('v3 : relecteur_egal_cloturer = false attendu (le relecteur attribué n\'est pas le clôturant)');
  // B7
  if (b.forme !== 'relue_par_secours') e.push(`v3 : badge.forme = "relue_par_secours" attendu (${b.forme})`);
  if (b.id !== ri.relecteur_de_secours) e.push('v3 : badge.id ≠ relecteur_de_secours');
  if (b.titulaire.id !== ri.relecteur_titulaire) e.push('v3 : badge.titulaire.id ≠ relecteur_titulaire');
  if (!estTexte(b.nom_affiche) || !estTexte(b.titulaire.nom_affiche)) e.push('v3 : badge.nom_affiche et badge.titulaire.nom_affiche non vides attendus');
  // C1
  for (const k of ['relecteur_titulaire', 'relecteur_de_secours', 'motif', 'periode', 'du', 'au', 'source_version']) if (!estTexte(ri[k])) e.push(`v3 : relecture_interim.${k} vide`);
  const jours = I.jourCivil(ri.du) && I.jourCivil(ri.au);
  if (!jours) e.push('v3 : relecture_interim.du / au : date civile AAAA-MM-JJ réelle attendue');
  else if (ri.du > ri.au) e.push('v3 : relecture_interim.du > au');
  if (!/^sha256:[0-9a-f]{64}$/.test(ri.source_version)) e.push('v3 : relecture_interim.source_version : sha256:<64 hex> attendu');
  // C2 : fenêtre en heure de Paris (C3 : aucun calendrier dans les invariants de la charge).
  if (jours) {
    for (const [nom, v] of [['fin_saisie_le', ch.fin_saisie_le], ['confirmation.le', cf.le], ['fidelite_transmission.le', ch.fidelite_transmission.le], ['cloture_le', ch.cloture_le]]) {
      const j = dateSignee(v) ? I.jourParis(v) : null;
      if (j === null || j < ri.du || j > ri.au) e.push(`v3 : ${nom} hors de la fenêtre d'intérim [${ri.du}, ${ri.au}] (heure de Paris)`);
    }
  }
  return e;
}

// Aiguillage par schéma (liste FERMÉE). v1 acceptée telle quelle ; v2 exige la liste
// des modèles autorisés.
function invariantsValeur(ch, options = {}) {
  if (ch && ch.schema === 'attestation-cloture/v3') return invariantsValeurV3(ch, options);
  if (ch && ch.schema === 'attestation-cloture/v2') return invariantsValeurV2(ch, options);
  return invariantsValeurV1(ch);
}

// --- Invariants de DÉPÔT (charge <-> entrée, lot, registre, référentiel) ---------------
function invariantsDepot(ch, { entree, registre, referentiel, resoudreInterim }) {
  const e = [];
  for (const k of ['set_id', 'notion_id', 'palier']) if (ch[k] !== entree[k]) e.push(`charge.${k} ≠ entrée`);
  if (!memeMoteur(ch.coeur.moteur, ch.moteur) || !memeMoteur(ch.moteur, entree.moteur)) e.push('coeur.moteur = moteur = entree.moteur : non respecté');
  const ligne = (registre || []).find((l) => l && l.version === ch.moteur.version);
  if (!ligne || ligne.sha256 !== ch.moteur.sha256) e.push('moteur.sha256 ≠ registre[moteur.version].sha256');
  if (!egal(ch.coeur.selection, entree.item_ids)) e.push('coeur.selection ≠ item_ids du fichier publié (même ordre)');
  if (ch.coeur.empreinte_publiee !== entree.empreinte) e.push('coeur.empreinte_publiee ≠ empreinte du fichier publié');
  if (!memeBadge(ch.badge, entree.relecteur)) e.push('badge ≠ relecteur de l\'entrée (§12)');
  // Fail-closed : sans référentiel exploitable, le relecteur n'est pas vérifiable -> erreur
  // (jamais un contrôle sauté ; le référentiel est l'ARCHIVÉ de la charge, §20.12).
  if (!referentiel || typeof referentiel !== 'object' || !Array.isArray(referentiel.notions)) {
    e.push('référentiel absent ou mal formé : relecteur_attribue non vérifiable (§2, §20.12)');
  } else {
    const n = referentiel.notions.find((x) => x && x.id === ch.notion_id);
    if (!n || n.relecteur !== ch.relecteur_attribue) e.push('relecteur_attribue ≠ relecteur du référentiel (§2)');
  }
  // v3 (D2–D5) : archive d'intérim résolue pour source_version sur l'historique de
  // confiance (jamais le fichier courant ni le calendrier) ; sans résolveur -> erreur.
  if (ch.schema === 'attestation-cloture/v3') {
    if (typeof resoudreInterim !== 'function') e.push('résolveur d\'archive d\'intérim absent : relecture_interim non vérifiable (fail-closed)');
    else {
      let r;
      try { r = resoudreInterim(ch.relecture_interim.source_version); } catch (err) { r = { ok: false, raison: err.message }; }
      if (!r || r.ok !== true) e.push(`archive d'intérim : ${(r && r.raison) || 'introuvable'}`);
      else e.push(...I.verifierArchive(ch.relecture_interim, r.octets));
    }
  }
  return e;
}

// Vérification complète, ordre fail-closed. Renvoie la liste des erreurs (vide = ok).
const CONTRATS_CHARGE = Object.freeze(['attestation-cloture/v1', 'attestation-cloture/v2', 'attestation-cloture/v3']);
function verifierAttestationSignee(enveloppe, { entree, registre, referentiel, cles, modelesAutorises, resoudreInterim }) {
  if (!enveloppe || typeof enveloppe !== 'object' || Array.isArray(enveloppe)
    || Object.keys(enveloppe).sort().join() !== 'charge,signature,type' || enveloppe.type !== TYPE) {
    return [`enveloppe : { type: "${TYPE}", charge, signature } attendu`];
  }
  const signature = base64Strict(enveloppe.signature);
  if (!signature) return ['signature : base64 strict attendu (une seule écriture admise)'];
  let octets;
  const schema = enveloppe.charge && typeof enveloppe.charge === 'object' ? enveloppe.charge.schema : undefined;
  if (!CONTRATS_CHARGE.includes(schema)) return [`charge.schema : ${CONTRATS_CHARGE.join(' | ')} attendu`];
  try { octets = Buffer.from(Canonique.octetsContrat(schema, enveloppe.charge)); } catch (err) { return [`charge : ${err.message}`]; }
  const ch = enveloppe.charge;
  const k = cles.obtenir(ch.cle_id);
  if (!k.ok) return [k.raison];
  const irrecevable = recevabilite(k.declaration, ch.cloture_le);
  if (irrecevable) return [irrecevable];
  let valide = false;
  try { valide = crypto.verify('sha256', octets, { key: k.cle, padding: crypto.constants.RSA_PKCS1_PADDING }, signature); } catch { valide = false; }
  if (!valide) return ['signature RSA-SHA256 PKCS#1 v1.5 invalide sur les octets canoniques de la charge'];
  const ev = invariantsValeur(ch, { modelesAutorises });
  if (ev.length) return ev;
  return invariantsDepot(ch, { entree, registre, referentiel, resoudreInterim });
}

module.exports = {
  TYPE, ALGORITHME, CONTRATS_CHARGE, SOURCES, chargerCles, recevabilite, invariantsValeur, invariantsDepot, verifierAttestationSignee, dateSignee,
  lireModelesAutorises, modelesValides, modeleEpingle, ALIAS_PRE_46,
};
