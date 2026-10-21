// Diagnostic HERMÉTIQUE d'un set_id (plan étape 5, lot 5) : lecture seule, aucune écriture
// (ni dépôt, ni .git, ni dossier de clôture), aucune clé de SIGNATURE (seule la clé du compte
// de service Drive et la clé d'API n8n de lecture sont utilisées). N'appelle ni
// preparerSignataire, ni le signataire, ni cloturer : il réutilise les fonctions PURES de
// liaison-generation.js et l'observation de signer-cloture.js. Pas de `git fetch` ici :
// l'actualisation de origin/design est la commande séparée --actualiser.
//
// États rapportés : le PREMIER applicable de la liste ordonnée (anomalies d'abord, puis
// progression du plus avancé au moins avancé) ; les autres applicables sont listés.

'use strict';

const path = require('path');
const crypto = require('crypto');
const SC = require('./signer-cloture.js');
const L = require('./liaison-generation.js');
const C = require('../engine/catalogue.js');

const ORDRE = [
  'non_initialise', 'acces_ko', 'incident_ouvert', 'observation_contradictoire', 'generation_en_cours', 'doublon',
  'signe', 'pret_pour_cloture', 'decision_figee', 'pret_pour_saisie', 'candidat_non_conforme', 'generation_echouee', 'aucune_generation',
];
const EN_VOL = ['new', 'running', 'waiting'];
const sha = async (t) => crypto.createHash('sha256').update(Buffer.from(t, 'utf8')).digest('hex');

async function essayer(f) { try { return { ok: true, v: await f() }; } catch (e) { return { ok: false, e }; } }

// s : sourcesLecture(...) (adaptateurs-production.js).
async function diagnostiquer(setId, s) {
  if (!C.SET_ID_PATTERN.test(setId || '')) throw new Error(`set_id invalide : ${setId}`);
  const etats = new Map(); // nom -> détail
  const marquer = (nom, detail = true) => { if (!etats.has(nom)) etats.set(nom, detail); };

  // Initialisation (avant tout accès au registre).
  if (!SC.existeSurDisque(path.join(s.dossier, '.initialise'))) marquer('non_initialise');

  // Accès.
  const obs = await essayer(() => SC.observer(s.api, s.workflowGeneration));
  if (!obs.ok) marquer(obs.e instanceof SC.Refus ? 'observation_contradictoire' : 'acces_ko', obs.e instanceof SC.Refus ? obs.e.message : `n8n : ${obs.e.message}`);
  const cand = await essayer(() => s.drive.listerCandidats());
  if (!cand.ok) marquer('acces_ko', `Drive : ${cand.e.message}`);
  const g = await essayer(() => s.git(['rev-parse', '--verify', 'origin/design^{commit}']));
  if (!g.ok) marquer('acces_ko', 'git : origin/design absent (lancer --actualiser)');
  let incidents = [];
  if (!etats.has('non_initialise')) {
    const inc = await essayer(() => s.incidents());
    if (!inc.ok) marquer('acces_ko', `registre des incidents : ${inc.e.message}`);
    else incidents = inc.v;
  }
  for (const i of incidents) if (i.statut !== 'resolu') marquer('incident_ouvert', i.id);

  // Exécutions : toute exécution EN VOL du workflow épinglé (attribuée ou non) bloque.
  const execs = obs.ok ? obs.v : [];
  for (const x of execs) if (EN_VOL.includes(x.status)) marquer('generation_en_cours', `exécution ${x.id} (${x.status})`);
  const details = new Map();
  for (const x of execs) if (!EN_VOL.includes(x.status)) {
    const r = await essayer(() => s.api.lireExecution(x.id));
    details.set(x.id, r.ok ? r.v : L.INDISPONIBLE);
    if (!r.ok) marquer('acces_ko', `n8n : exécution ${x.id} illisible`);
  }
  const constats = new L.Constats();
  const { examinees, complet } = L.examinerExecutions({ executions: execs.filter((x) => !EN_VOL.includes(x.status)), details, constats, normaliserDate: SC.normaliserDate });
  for (const c of constats.liste) if (c.issue === 'incident') marquer('observation_contradictoire', c.raison);
  const duLot = examinees.filter((e) => e.entree.set_id === setId);
  const reussies = duLot.filter((e) => e.x.status === 'success');
  const fichiersDuLot = cand.ok ? cand.v.fichiers.filter((f) => f.nom === `${setId}.lot.json` || (f.properties && f.properties.fonda_set_id === setId)) : [];
  if (reussies.length > 1 || fichiersDuLot.length > 1) marquer('doublon', `${reussies.length} génération(s) réussie(s), ${fichiersDuLot.length} candidat(s)`);

  // Progression.
  if (SC.existeSurDisque(path.join(s.dossier, `${setId}.signature`))) marquer('signe');
  let pretSaisie = false;
  let generation = null;
  if (reussies.length === 1 && fichiersDuLot.length === 1 && cand.ok && complet) {
    generation = reussies[0];
    const c2 = new L.Constats();
    const vf = L.examinerFichiers({ setId, fichiers: cand.v.fichiers, constats: c2 });
    const { retenue } = L.classerExecutions({ setId, examinees, complet, vueFichiers: vf, constats: c2 });
    const lu = await essayer(() => s.drive.lireLotGenere(setId));
    let lot = null;
    try { lot = lu.ok && lu.v ? JSON.parse(lu.v.octets.toString('utf8')) : null; } catch { lot = null; }
    const empreintes = lot && C.validerLot(lot).valide ? { pedagogique: await C.calculerEmpreinte(lot, sha), complete: L.empreinteComplete(lot) } : null;
    if (!empreintes) c2.ajouter('abandon', 'lot généré illisible ou non conforme');
    const sortie = retenue && retenue !== L.INDISPONIBLE
      ? L.itemUnique(details.get(retenue.x.id), L.NOEUD_SORTIE) : { ok: false };
    let jc = L.INDISPONIBLE;
    if (sortie.ok) { const r = await essayer(() => s.journal(sortie.json.journal_commit)); if (r.ok) jc = r.v; }
    if (retenue && retenue !== L.INDISPONIBLE) {
      L.rapprocher({ setId, retenue, fichier: vf.fichier, brute: details.get(retenue.x.id), workflowId: s.workflowGeneration, journalCommit: jc, registre: s.registre, modelesAutorises: s.modelesAutorises, lotSource: lot, empreintes, constats: c2 });
    }
    if (c2.liste.length === 0 && jc !== L.INDISPONIBLE) pretSaisie = true;
    else marquer('candidat_non_conforme', c2.liste.map((c) => `${c.issue} : ${c.raison}`).join(' ; ') || 'journal illisible');
  }
  if (pretSaisie) marquer('pret_pour_saisie');

  // Décision figée et aptitude à la clôture.
  const dl = await essayer(() => s.decisionsLocales(setId));
  if (!dl.ok) marquer('acces_ko', `décisions locales : ${dl.e.message}`);
  const decisions = dl.ok ? dl.v.map((f) => { try { return JSON.parse(f.octets.toString('utf8')); } catch { return null; } }) : [];
  if (decisions.length) {
    const d = decisions[0];
    const exclusions = [];
    if (decisions.length > 1 || decisions.some((x) => !x || !SC.decisionConforme(x))) exclusions.push('décision illisible, non conforme ou multiple');
    else if (d.coeur.action !== 'accepter') exclusions.push('décision « rejeter » : abandon, rien à clôturer');
    if (!pretSaisie) exclusions.push('génération non rapprochée sans constat');
    // Toute anomalie déjà constatée (exécution en vol, attribuée ou non, incident ouvert,
    // observation contradictoire, doublon, accès) interdit l'aptitude à la clôture.
    for (const n of ORDRE.slice(0, ORDRE.indexOf('signe'))) if (etats.has(n)) exclusions.push(`anomalie : ${n}`);
    if (generation && d && d.recu_le) {
      const fenetre = { debut: generation.x.startedAt, fin: SC.normaliserDate(d.recu_le) };
      for (const i of incidents) {
        if (i.statut !== 'resolu') continue;
        const debut = i.periode && i.periode.debut ? SC.normaliserDate(i.periode.debut) : null;
        const fin = i.periode && i.periode.fin ? SC.normaliserDate(i.periode.fin) : null;
        if (fin && (debut === null || debut <= fenetre.fin) && fin >= fenetre.debut) exclusions.push(`incident ${i.id} couvrant la fenêtre de candidature : abandon`);
      }
    }
    if (exclusions.length === 0) marquer('pret_pour_cloture');
    marquer('decision_figee', exclusions.length ? exclusions.join(' ; ') : true);
  }
  if (!duLot.length && !fichiersDuLot.length) marquer('aucune_generation');
  else if (duLot.length && !reussies.length) marquer('generation_echouee');

  const applicables = ORDRE.filter((n) => etats.has(n));
  const etat = applicables[0] || 'aucune_generation';
  return { set_id: setId, etat, detail: etats.get(etat) ?? null, applicables: applicables.map((n) => ({ etat: n, detail: etats.get(n) })) };
}

// Diagnostic sans set_id : accès seulement.
async function diagnostiquerAcces(s) {
  const r = {};
  r.initialise = SC.existeSurDisque(path.join(s.dossier, '.initialise'));
  r.n8n = (await essayer(() => s.api.listerExecutions({ workflowId: s.workflowGeneration }))).ok;
  r.drive = (await essayer(() => s.drive.verifierDossier())).ok;
  r.git = (await essayer(() => s.git(['rev-parse', '--verify', 'origin/design^{commit}']))).ok;
  r.registre = r.initialise ? (await essayer(() => s.incidents())).ok : false;
  return r;
}

module.exports = { diagnostiquer, diagnostiquerAcces, ORDRE };
