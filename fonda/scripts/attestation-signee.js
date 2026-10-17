// Vérification d'une attestation « Type 2 » (clôture signée) — CDC relecture §11,
// §11 bis, §12, §14. Node seulement (require('crypto') permis : jamais copié dans n8n).
//
// Enveloppe : { type: "cloture-signee", charge, signature } ; signature = base64 d'une
// signature RSA-SHA256 PKCS#1 v1.5 sur les OCTETS CANONIQUES de la charge
// (attestation-cloture/v1, fonda/engine/canonique.js — la charge ne contient jamais de
// champ « signature »).
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
const memeBadge = (a, b) => !!a && !!b && a.forme === b.forme && a.nom_affiche === b.nom_affiche && a.id === b.id;

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

// --- Invariants de VALEUR de la charge (§11, §11 bis) ----------------------------------
function invariantsValeur(ch) {
  const e = [];
  if (ch.schema !== 'attestation-cloture/v1') e.push('schema ≠ attestation-cloture/v1');
  if (!/^[0-9a-f]{64}$/.test(ch.sha256_instantane)) e.push('sha256_instantane : 64 hex attendus');
  else if (ch.code_confirmation !== ch.sha256_instantane.slice(0, 16)) e.push('code_confirmation ≠ 16 premiers hex de sha256_instantane');
  const dates = [['confirmation.le', ch.confirmation.le], ['fidelite_transmission.le', ch.fidelite_transmission.le],
    ['execution_cloture.terminee_le', ch.execution_cloture.terminee_le], ['revoque_le', ch.revoque_le], ['cloture_le', ch.cloture_le],
    ...ch.provenances.map((p, i) => [`provenances[${i}].demarree_le`, p.demarree_le])];
  ch.incidents_connus.forEach((x, i) => {
    dates.push([`incidents_connus[${i}].detecte_le`, x.detecte_le]);
    if (x.resolu_le !== null) dates.push([`incidents_connus[${i}].resolu_le`, x.resolu_le]);
    if (x.periode.debut !== null) dates.push([`incidents_connus[${i}].periode.debut`, x.periode.debut]);
    if (x.periode.fin !== null) dates.push([`incidents_connus[${i}].periode.fin`, x.periode.fin]);
  });
  for (const [nom, v] of dates) if (!dateSignee(v)) e.push(`${nom} : date ISO UTC à la milliseconde attendue (fuseau Z)`);
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
  // Cœur
  const co = ch.coeur;
  if (co.action !== 'accepter') e.push('coeur.action ≠ "accepter"');
  const tous = [...co.selection, ...co.ecartees];
  if (new Set(tous).size !== tous.length) e.push('coeur : selection et ecartees non disjointes ou avec doublon');
  if (co.selection.length === 0) e.push('coeur.selection vide');
  // Provenances : ≥ 1, success, execution_id unique, tri (date puis id, unités de code)
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
  if (!Number.isSafeInteger(ch.nb_fichiers_decision) || ch.nb_fichiers_decision < 1) e.push('nb_fichiers_decision : entier ≥ 1 attendu');
  const ec = ch.execution_cloture;
  if (ec.statut !== 'success') e.push('execution_cloture.statut ≠ "success"');
  if (!estTexte(ec.execution_id) || !estTexte(ec.workflow_id)) e.push('execution_cloture : identifiants vides');
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
  // Badge (§11 bis, par priorité)
  const b = ch.badge;
  if (!FORMES_BADGE.includes(b.forme)) e.push(`badge.forme hors énumération (${b.forme})`);
  if (auto && !memeBadge(b, BADGE_AUTO)) e.push('badge : auto-confirmation ⇒ { relue_par, Éric Duchateau, eric }');
  if (!auto) {
    const nomme = b.forme === 'relue_et_validee' && b.id === ch.relecteur_attribue && estTexte(b.nom_affiche);
    if (!nomme && !memeBadge(b, BADGE_SANS_NOM)) e.push('badge incohérent : relue_et_validee au nom du relecteur attribué, ou forme « sans nom »');
  }
  if (!(b.id === null || b.id === ch.relecteur_attribue)) e.push('badge.id ∉ { relecteur_attribue, null }');
  return e;
}

// --- Invariants de DÉPÔT (charge <-> entrée, lot, registre, référentiel) ---------------
function invariantsDepot(ch, { entree, registre, referentiel }) {
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
  return e;
}

// Vérification complète, ordre fail-closed. Renvoie la liste des erreurs (vide = ok).
function verifierAttestationSignee(enveloppe, { entree, registre, referentiel, cles }) {
  if (!enveloppe || typeof enveloppe !== 'object' || Array.isArray(enveloppe)
    || Object.keys(enveloppe).sort().join() !== 'charge,signature,type' || enveloppe.type !== TYPE) {
    return [`enveloppe : { type: "${TYPE}", charge, signature } attendu`];
  }
  const signature = base64Strict(enveloppe.signature);
  if (!signature) return ['signature : base64 strict attendu (une seule écriture admise)'];
  let octets;
  try { octets = Buffer.from(Canonique.octetsContrat('attestation-cloture/v1', enveloppe.charge)); } catch (err) { return [`charge : ${err.message}`]; }
  const ch = enveloppe.charge;
  const k = cles.obtenir(ch.cle_id);
  if (!k.ok) return [k.raison];
  const irrecevable = recevabilite(k.declaration, ch.cloture_le);
  if (irrecevable) return [irrecevable];
  let valide = false;
  try { valide = crypto.verify('sha256', octets, { key: k.cle, padding: crypto.constants.RSA_PKCS1_PADDING }, signature); } catch { valide = false; }
  if (!valide) return ['signature RSA-SHA256 PKCS#1 v1.5 invalide sur les octets canoniques de la charge'];
  const ev = invariantsValeur(ch);
  if (ev.length) return ev;
  return invariantsDepot(ch, { entree, registre, referentiel });
}

module.exports = {
  TYPE, ALGORITHME, chargerCles, recevabilite, invariantsValeur, invariantsDepot, verifierAttestationSignee, dateSignee,
};
