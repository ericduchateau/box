// Parcours PAGE de la clôture signée (CDC relecture §21, r10.9) — code page NOUVEAU, hors de
// signer-cloture.js (patch figé §21.8 : evaluerPage y est réduite à une délégation vers ce
// module, chargé PARESSEUSEMENT depuis les seules branches page).
//
//   rattacherPage  §21.2 : rattachement exécution n8n <-> lot, résultat DISCRIMINÉ (jamais null),
//                  fusion listing/détail avant extraction, table E1–E12 ;
//   evaluerPage    §10, §21.2 : filet du parcours page, rapprochement SYMÉTRIQUE R1–R6 sur
//                  (lot, nonce, id Drive, empreinte), clôture <-> candidat lu (E12), complétude ;
//   verifierTxt    §21.7 : octets du récapitulatif transmis, avant ET après la confirmation ;
//   rejet total    §21.1 : « Tout rejeter » -> empreinte_publiee = empreinte du lot source.
//
// Fonctions PURES (aucun réseau). Le contrat de retour d'evaluerPage est inchangé :
// { decisions, derniere, duLot: [{ x, nonce }], revoqueLe, fenetre }, `x` et `derniere` étant
// les observations FUSIONNÉES (signées telles quelles dans provenances / execution_cloture).

'use strict';

const crypto = require('crypto');
const C = require('../engine/catalogue.js');
const Canonique = require('../engine/canonique.js');
const L = require('./liaison-generation.js');

// signer-cloture.js requiert ce module paresseusement : la réciproque l'est aussi (cycle).
const SC = () => require('./signer-cloture.js');

const STATUTS_TERMINAUX = ['success', 'error', 'crashed', 'canceled'];
const STATUTS_EN_VOL = ['new', 'running', 'waiting'];
const NONCE = /^[0-9a-f]{32}$/;
const EMPREINTE = /^sha256:[0-9a-f]{64}$/;
const MOTIFS_REJET = ['C1', 'C2', 'C3', 'C4', 'C5', 'C5bis'];

// Contrats de sortie (§21.1) : noms de nœuds et formes EXACTES (clés et types).
const ROLES = {
  confirmation: {
    entree: 'FONDA Entree confirmation', sortie: 'FONDA Sortie confirmation', ecriture: 'FONDA Ecrire decision',
    formeEntree: { lot: ['chaine', null], nonce: ['chaine', null] },
    formeSortie: {
      schema: ['chaine'], type: ['chaine'], set_id: ['chaine', null], nonce: ['chaine', null], generation: ['nombre', null],
      decision_fichier_id: ['chaine', null], decision_sha256: ['chaine', null], ecriture: ['chaine', null], motif: ['chaine', null],
    },
    schema: 'confirmation-fonda/v1', champEntree: 'lot',
  },
  cloture: {
    entree: 'FONDA Entree cloture', sortie: 'FONDA Sortie cloture', ecriture: 'FONDA Ecrire candidat clos',
    formeEntree: { set_id: ['chaine', null] },
    formeSortie: {
      schema: ['chaine'], set_id: ['chaine'], clos_le: ['chaine'], deja_clos: ['booleen'], candidat_fichier_id: ['chaine'],
      nb_decisions_listees: ['nombre'], incomplete_search: ['booleen'],
    },
    schema: 'cloture-fonda/v1', champEntree: 'set_id',
  },
};

const typeDe = (v) => (v === null ? null : typeof v === 'string' ? 'chaine' : (typeof v === 'number' && Number.isFinite(v)) ? 'nombre' : typeof v === 'boolean' ? 'booleen' : '?');
function formeExacte(o, forme) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const cles = Object.keys(o);
  if (cles.length !== Object.keys(forme).length || !cles.every((k) => Object.prototype.hasOwnProperty.call(forme, k))) return false;
  return cles.every((k) => forme[k].includes(typeDe(o[k])));
}
const entierPositif = (v) => Number.isSafeInteger(v) && v >= 1;
const texte = (v) => typeof v === 'string' && v.trim() !== '';

// ─── §21.2 rattacherPage ───────────────────────────────────────────────────────────────────
// detail ∈ { exécution avec données, L.INDISPONIBLE (lecture en échec), null (introuvable) } ;
// observation = élément de listing NORMALISÉ (observer de signer-cloture.js).
function rattacherPage(detail, { role, workflowId, observation }) {
  const R = ROLES[role];
  if (!R) throw new Error(`rattacherPage : rôle « ${role} » inconnu`);
  const id = observation && observation.id;
  const anomalie = (niveau, motif, setId = null) => ({ nature: 'anomalie', niveau, set_id: setId, motif });
  // E1
  if (detail === L.INDISPONIBLE) return { nature: 'indisponible' };
  if (detail == null) return anomalie('incident', `exécution ${id} : détail introuvable ou purgé (lot indéterminable)`);
  // E2 : fusion AVANT extraction, puis workflow et mode
  const f = L.fusionner(observation, detail, SC().normaliserDate);
  if (f.contradiction) return anomalie('incident', `exécution ${id} : ${f.contradiction}`);
  const obs = f.obs;
  if (detail.workflowId !== workflowId || obs.workflowId !== workflowId) return anomalie('incident', `exécution ${id} : workflow ≠ workflow épinglé`);
  if (detail.mode !== 'webhook') return anomalie('incident', `exécution ${id} : mode « ${detail.mode} » ≠ webhook`);
  // E3 : workflowData exigé, puis SON pinData
  const wd = detail.workflowData;
  if (!wd || typeof wd !== 'object' || Array.isArray(wd)) return anomalie('incident', `exécution ${id} : workflowData absent ou non objet (information indisponible)`);
  const pin = wd.pinData;
  if (!(pin === undefined || pin === null || (typeof pin === 'object' && !Array.isArray(pin) && Object.keys(pin).length === 0))) return anomalie('incident', `exécution ${id} : données épinglées (pinData) — sortie non probante`);
  const entree = L.itemUnique(detail, R.entree);
  const entreeOk = entree.ok && formeExacte(entree.json, R.formeEntree);
  // E4 : statut terminal ≠ success
  if (obs.status !== 'success') {
    const v = entreeOk ? entree.json[R.champEntree] : null;
    if (typeof v !== 'string' || !C.SET_ID_PATTERN.test(v)) return anomalie('incident', `exécution ${id} (${obs.status}) : entrée illisible ou lot invalide`);
    return { nature: 'erreur', set_id: v, obs };
  }
  // E5 : entrée et sortie, forme exacte
  const sortie = L.itemUnique(detail, R.sortie);
  if (!entreeOk) return anomalie('incident', `exécution ${id} : entrée « ${R.entree} » inexploitable`);
  if (!sortie.ok || !formeExacte(sortie.json, R.formeSortie) || sortie.json.schema !== R.schema) return anomalie('incident', `exécution ${id} : sortie « ${R.sortie} » non conforme à ${R.schema}`);
  const e = entree.json; const s = sortie.json;
  const runData = detail.data.resultData.runData;
  const aEcrit = Object.prototype.hasOwnProperty.call(runData, R.ecriture);
  if (role === 'cloture') {
    if (s.set_id !== e.set_id || !C.SET_ID_PATTERN.test(s.set_id)) return anomalie('incident', `exécution ${id} : set_id de sortie ≠ entrée ou invalide`); // E6, E8
    const closLe = SC().normaliserDate(s.clos_le);
    if (!closLe || !texte(s.candidat_fichier_id) || !Number.isSafeInteger(s.nb_decisions_listees) || s.nb_decisions_listees < 0) return anomalie('abandon', `exécution ${id} : sortie de clôture incohérente (E12)`, s.set_id);
    return { nature: 'cloture', set_id: s.set_id, clos_le: closLe, deja_clos: s.deja_clos, candidat_fichier_id: s.candidat_fichier_id, nb_decisions_listees: s.nb_decisions_listees, incomplete_search: s.incomplete_search, obs };
  }
  // Confirmation — E7
  if (!['decision', 'conflit', 'rejet'].includes(s.type)) return anomalie('incident', `exécution ${id} : type « ${s.type} » inconnu`);
  // E6 par type
  if (s.type === 'rejet') {
    const nuls = s.set_id === null && s.nonce === null;
    const egaux = s.set_id !== null && s.nonce !== null && s.set_id === e.lot && s.nonce === e.nonce;
    if (!nuls && !egaux) return anomalie('incident', `exécution ${id} : rejet incohérent avec son entrée (E6)`);
  } else if (s.set_id === null || s.nonce === null || s.set_id !== e.lot || s.nonce !== e.nonce) {
    return anomalie('incident', `exécution ${id} : lot ou nonce de sortie ≠ entrée (E6)`);
  }
  // E8, E9
  if (s.set_id !== null && !C.SET_ID_PATTERN.test(s.set_id)) return anomalie('incident', `exécution ${id} : set_id invalide (E8)`);
  if (s.nonce !== null && !NONCE.test(s.nonce)) return anomalie('incident', `exécution ${id} : nonce invalide (E9)`);
  if (s.type === 'rejet') {
    if (aEcrit) return anomalie('incident', `exécution ${id} : rejet ayant exécuté « ${R.ecriture} » (E10)`);
    if (!MOTIFS_REJET.includes(s.motif) || s.generation !== null || s.decision_fichier_id !== null || s.decision_sha256 !== null || s.ecriture !== null) return anomalie('incident', `exécution ${id} : rejet de forme invalide`);
    return { nature: 'rejet', set_id: s.set_id, motif: s.motif, obs };
  }
  if (s.type === 'conflit') {
    if (!entierPositif(s.generation) || !texte(s.decision_fichier_id) || !EMPREINTE.test(s.decision_sha256 || '') || s.ecriture !== null || s.motif !== null || aEcrit) return anomalie('abandon', `exécution ${id} : sortie « conflit » incohérente`, s.set_id);
    return { nature: 'conflit', set_id: s.set_id, nonce: s.nonce, generation: s.generation, decision_fichier_id: s.decision_fichier_id, decision_sha256: s.decision_sha256, obs };
  }
  // decision — E11
  if (!texte(s.decision_fichier_id) || !EMPREINTE.test(s.decision_sha256 || '') || !['creee', 'existante'].includes(s.ecriture)
    || !entierPositif(s.generation) || s.motif !== null || aEcrit !== (s.ecriture === 'creee')) return anomalie('abandon', `exécution ${id} : sortie « decision » incohérente (E11)`, s.set_id);
  return { nature: 'decision', set_id: s.set_id, nonce: s.nonce, generation: s.generation, decision_fichier_id: s.decision_fichier_id, decision_sha256: s.decision_sha256, ecriture: s.ecriture, obs };
}

// Empreinte canonique d'une décision (R1, R3) : SHA-256 des octets canoniques du contrat.
function empreinteDecision(d) {
  return `sha256:${crypto.createHash('sha256').update(Buffer.from(Canonique.octetsContrat('decision-fonda/v1', d))).digest('hex')}`;
}

// Détail d'une observation : table posée par adaptateurs-page.preLireDetails (§21.3).
function detailDe(groupe, x) {
  const d = groupe && groupe.details;
  return d instanceof Map && d.has(x.id) ? d.get(x.id) : L.INDISPONIBLE;
}

// ─── §10, §21.2 evaluerPage ────────────────────────────────────────────────────────────────
function evaluerPage({ setId, candidatEnv, clotures, confirmations, listeDecisions, rattachement, levees, constats, sortie, relecteur, empreintes, listingDebut, registre }) {
  const { normaliserDate, decisionConforme } = SC();
  const leve = (type) => (levees || []).some((l) => l.type === type);
  let revoqueLe = null; let creeLe = null; let derniere = null; let generationCle = null; let idCandidat = null;
  // ── Candidat (enveloppe candidat-fonda/v1 + identité Drive .drive, §21.8) ──
  if (candidatEnv.ok) {
    const c = candidatEnv.v;
    if (!c || c.schema !== 'candidat-fonda/v1' || !c.lot || !c.relecture) constats.ajouter('incident', 'candidat (enveloppe de relecture) illisible ou non conforme');
    else {
      const rel = c.relecture;
      // Identité Drive lue AVANT toute copie (une copie la perd).
      if (!c.drive || !texte(c.drive.id)) constats.ajouter('incident', 'candidat : identité Drive (.drive) absente — lecture non conforme à §21.8');
      else idCandidat = c.drive.id;
      if (rel.statut !== 'clos') constats.ajouter('temporaire', `candidat au statut « ${rel.statut} » (clôture technique requise)`);
      revoqueLe = normaliserDate(rel.clos_le);
      creeLe = normaliserDate(rel.cree_le);
      if (!revoqueLe || !creeLe) constats.ajouter('incident', 'relecture.clos_le / cree_le absent ou mal formé');
      else if (creeLe > revoqueLe) constats.ajouter('incident', 'fenêtre de candidature inversée (cree_le > clos_le)');
      if (entierPositif(rel.generation_cle)) generationCle = rel.generation_cle;
      else constats.ajouter('incident', 'relecture.generation_cle absent ou invalide');
      if (c.lot.set_id !== setId) constats.ajouter('abandon', 'set_id du candidat ≠ set_id demandé');
      const regC = rel.moteur ? (registre || []).find((l) => l && l.version === rel.moteur.version) : null;
      if (!regC || regC.sha256 !== rel.moteur.sha256) constats.ajouter('abandon', 'moteur du candidat absent du registre moteurs.json');
      const completeRef = empreintes ? empreintes.complete : (sortie ? sortie.empreinte_complete : null);
      const projection = { schema: c.schema, lot: c.lot, relecture: c.relecture }; // contenu traité par projection explicite
      try { if (completeRef && L.empreinteComplete(projection.lot) !== completeRef) constats.ajouter('abandon', 'lot de l\'enveloppe de relecture ≠ lot généré'); } catch { constats.ajouter('abandon', 'lot de l\'enveloppe de relecture non projetable'); }
      if (sortie && rel.referentiel_version !== sortie.referentiel_version) constats.ajouter('abandon', 'referentiel_version du candidat ≠ génération');
      if (relecteur !== null && rel.relecteur_attribue !== relecteur) constats.ajouter('abandon', 'relecteur attribué du candidat ≠ référentiel archivé');
      if (sortie && (!rel.moteur || rel.moteur.version !== sortie.moteur.version || rel.moteur.sha256 !== sortie.moteur.sha256)) constats.ajouter('abandon', 'moteur du candidat ≠ moteur de la génération');
    }
  }
  // ── 1. Exécutions de clôture : TOUTES examinées (même partielles) ──
  {
    const duLotClot = [];
    let indisponibles = 0;
    for (const x of clotures.ok ? clotures.v : (clotures.partiel || [])) {
      if (!STATUTS_TERMINAUX.includes(x.status)) { constats.ajouter('incident', `exécution de clôture ${x.id} non terminée ou de statut inconnu (${x.status}) : une clôture technique est encore en cours`); continue; }
      const r = rattachement(detailDe(clotures, x), { role: 'cloture', workflowId: x.workflowId, observation: x });
      if (r.nature === 'indisponible') { indisponibles += 1; continue; }
      if (r.nature === 'anomalie') {
        if (r.niveau === 'abandon' && r.set_id === setId) constats.ajouter('abandon', `exécution de clôture ${x.id} : ${r.motif}`);
        else if (r.niveau !== 'abandon') constats.ajouter('incident', `exécution de clôture ${x.id} non attribuable à un lot (${r.motif})`);
        continue;
      }
      if (r.nature === 'erreur') { if (r.set_id === setId) constats.ajouter('abandon', `exécution de clôture ${x.id} du lot au statut ${x.status} : blocage dur`); continue; }
      if (r.nature !== 'cloture') { constats.ajouter('incident', `exécution de clôture ${x.id} non attribuable à un lot`); continue; }
      if (r.set_id === setId) duLotClot.push(r);
    }
    if (indisponibles) constats.ajouter('temporaire', `${indisponibles} détail(s) d'exécution de clôture non lu(s) : relancer`);
    const reussies = !clotures.ok ? null : duLotClot.slice().sort((a, b) => (a.obs.stoppedAt < b.obs.stoppedAt ? -1 : a.obs.stoppedAt > b.obs.stoppedAt ? 1 : 0));
    if (reussies === null) { /* listing en échec : déjà constaté */ } else if (!reussies.length) constats.ajouter('temporaire', 'aucune clôture technique réussie rattachée à ce lot');
    else {
      const r = reussies[reussies.length - 1];
      derniere = r.obs;
      if (reussies.length > 1 && reussies[reussies.length - 2].obs.stoppedAt === derniere.stoppedAt) constats.ajouter('abandon', 'deux clôtures techniques à la même date : aucun départage arbitraire');
      // E12 : clôture <-> candidat LU
      if (idCandidat !== null && r.candidat_fichier_id !== idCandidat) constats.ajouter('abandon', 'clôture retenue : candidat_fichier_id ≠ identité Drive du candidat lu');
      if (revoqueLe !== null) for (const k of reussies) if (k.clos_le !== revoqueLe) constats.ajouter('abandon', `clôture ${k.obs.id} : clos_le ≠ relecture.clos_le du candidat`);
      if (r.incomplete_search && !leve('recherche_incomplete')) constats.ajouter('temporaire', 'clôture technique : recherche Drive incomplète sans levée explicite (§10 C)');
    }
  }
  // ── 2. Filet sur les confirmations ──
  const duLot = [];
  let confIndisponibles = 0;
  {
    for (const x of confirmations.ok ? confirmations.v : (confirmations.partiel || [])) {
      if (STATUTS_EN_VOL.includes(x.status)) { constats.ajouter('incident', `exécution de confirmation ${x.id} non terminée (${x.status})`); continue; }
      if (!STATUTS_TERMINAUX.includes(x.status)) { constats.ajouter('incident', `exécution de confirmation ${x.id} au statut inconnu (${x.status})`); continue; }
      const r = rattachement(detailDe(confirmations, x), { role: 'confirmation', workflowId: x.workflowId, observation: x });
      if (r.nature === 'indisponible') { confIndisponibles += 1; continue; }
      if (r.nature === 'anomalie') {
        if (r.niveau === 'abandon' && r.set_id === setId) constats.ajouter('abandon', `exécution de confirmation ${x.id} : ${r.motif}`);
        else if (r.niveau !== 'abandon') constats.ajouter('incident', `exécution de confirmation ${x.id} : ${r.motif}`);
        continue;
      }
      if (r.nature === 'rejet') continue; // inoffensif (E10 vérifié)
      if (r.set_id !== setId) continue;
      if (r.nature === 'erreur') { constats.ajouter('abandon', `exécution de confirmation ${x.id} du lot au statut ${x.status} : blocage dur`); continue; }
      if (r.nature === 'conflit') { constats.ajouter('abandon', `sortie « conflit » (exécution ${x.id}) : blocage dur`); continue; }
      if (r.nature !== 'decision') { constats.ajouter('incident', `exécution ${x.id} : rattachement de décision incomplet`); continue; }
      if (generationCle !== null && r.generation !== generationCle) constats.ajouter('abandon', `exécution ${x.id} : generation ${r.generation} ≠ generation_cle ${generationCle} du candidat (R6)`);
      duLot.push({ x: r.obs, nonce: r.nonce, fichierId: r.decision_fichier_id, empreinte: r.decision_sha256, ecriture: r.ecriture });
    }
    if (confIndisponibles) constats.ajouter('temporaire', `${confIndisponibles} détail(s) d'exécution de confirmation non lu(s) : relancer`);
    // R3 : resoumissions d'un même nonce strictement identiques, au plus une création
    const parNonce = new Map();
    for (const e of duLot) { if (!parNonce.has(e.nonce)) parNonce.set(e.nonce, []); parNonce.get(e.nonce).push(e); }
    for (const [n, es] of parNonce) {
      if (new Set(es.map((e) => `${e.fichierId}|${e.empreinte}`)).size > 1 || es.filter((e) => e.ecriture === 'creee').length > 1) constats.ajouter('abandon', `nonce ${n} : resoumissions non identiques (R3)`);
    }
  }
  const examenConfirmationsComplet = confirmations.ok && confIndisponibles === 0;
  // ── 3. Décisions sur Drive : rapprochement SYMÉTRIQUE (R1, R2) ──
  const decisions = [];
  if (listeDecisions.ok) {
    const liste = listeDecisions.v;
    if (!liste || !Array.isArray(liste.fichiers)) constats.ajouter('incident', 'listing de decisions/ illisible');
    else {
      const listingComplet = liste.incompleteSearch !== true; // une levée ne rend JAMAIS un listing complet
      if (liste.incompleteSearch === true && !leve('recherche_incomplete')) constats.ajouter('temporaire', 'recherche Drive incomplète (decisions/) sans levée explicite');
      const duLotFichiers = [];
      for (const f of liste.fichiers) {
        if (!f || f.contenu == null) { constats.ajouter('incident', `fichier de decisions/ illisible (${f && f.nom})`); continue; }
        const d = f.contenu;
        if (!decisionConforme(d)) { constats.ajouter('incident', `fichier de decisions/ non conforme (${f.nom})`); continue; }
        if (d.set_id !== setId) continue;
        const empreinte = empreinteDecision(d);
        duLotFichiers.push({ f, d, empreinte });
        if (f.nom !== `${setId}-${d.nonce}.json`) constats.ajouter('abandon', `${f.nom} : nom ≠ <set_id>-<nonce>.json`);
        const p = f.properties || {};
        if (p.fonda_set_id !== d.set_id || p.fonda_nonce !== d.nonce) constats.ajouter('abandon', `${f.nom} : properties fonda_set_id/fonda_nonce absentes ou ≠ contenu`);
        if (generationCle !== null && d.generation !== generationCle) constats.ajouter('abandon', `${f.nom} : generation ${d.generation} ≠ generation_cle ${generationCle} (R6)`);
        if (d.coeur && d.coeur.action === 'rejeter' && d.coeur.empreinte_publiee !== d.coeur.empreinte_relue) constats.ajouter('abandon', `${f.nom} : « Tout rejeter » sans l'empreinte du lot source en empreinte_publiee (§21.1)`);
        const modifie = normaliserDate(f.modifie_le);
        if (!modifie) constats.ajouter('incident', `${f.nom} : date de modification illisible`);
        else if ((derniere && modifie > derniere.stoppedAt) || modifie > listingDebut) constats.ajouter('temporaire', `${f.nom} écrit après la clôture technique ou pendant le listing : nouvelle clôture technique requise`);
        decisions.push(d);
      }
      // R1 : chaque tuple consigné a SON fichier (même id ET même empreinte)
      for (const e of duLot) {
        const memeId = duLotFichiers.find((k) => k.f.id === e.fichierId);
        if (memeId && memeId.empreinte === e.empreinte) continue;
        if (memeId || duLotFichiers.some((k) => k.d.nonce === e.nonce)) constats.ajouter('abandon', `décision de l'exécution ${e.x.id} substituée sur Drive (identifiant ou empreinte ≠ consignés) : blocage dur`);
        else if (listingComplet) constats.ajouter('abandon', `décision de l'exécution ${e.x.id} absente de Drive : blocage dur`);
        else constats.ajouter('temporaire', `décision de l'exécution ${e.x.id} non trouvée dans un listing incomplet : relancer (absence non établie)`);
      }
      // R2 : chaque fichier est désigné par une exécution, PAR SON IDENTIFIANT
      for (const k of duLotFichiers) {
        if (duLot.some((e) => e.fichierId === k.f.id)) continue;
        if (examenConfirmationsComplet) constats.ajouter('abandon', `${k.f.nom} : décision sans exécution correspondante : blocage dur`);
        else constats.ajouter('temporaire', `${k.f.nom} : provenance non établie (examen des confirmations incomplet) : relancer`);
      }
      if (!decisions.length) constats.ajouter('temporaire', 'aucune décision pour ce lot');
    }
  }
  return { decisions, derniere, duLot: duLot.map((e) => ({ x: e.x, nonce: e.nonce })), revoqueLe, fenetre: creeLe && revoqueLe && creeLe <= revoqueLe ? { debut: creeLe, fin: revoqueLe } : null };
}

// ─── §21.7 verifierTxt ─────────────────────────────────────────────────────────────────────
// Octets du récapitulatif transmis relus et comparés, avant ET après la confirmation.
function verifierTxt(fs, chemin, attendu) {
  const { Refus } = SC();
  let lu;
  try { lu = fs.lire(chemin); } catch (e) { throw new Refus(`${chemin} illisible (${e.message}) : relancer, nouvelle confirmation`, 'local'); }
  if (!Buffer.from(lu).equals(Buffer.from(attendu, 'utf8'))) throw new Refus(`${chemin} : octets du récapitulatif transmis ≠ attendus (§21.7) : relancer, nouvelle confirmation`, 'local');
}

module.exports = { rattacherPage, evaluerPage, verifierTxt, empreinteDecision, ROLES, NONCE };
