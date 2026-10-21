// Diagnostic HERMÉTIQUE d'un set_id (plan étape 5, lot 5) : lecture seule, aucune écriture
// (ni dépôt, ni .git, ni dossier de clôture), aucune clé de SIGNATURE (seule la clé du compte
// de service Drive et la clé d'API n8n de lecture sont utilisées). N'appelle ni
// preparerSignataire, ni le signataire, ni cloturer : il réutilise les fonctions PURES de
// liaison-generation.js (examen, classement, rapprochement, réconciliation, unicité) et
// l'observation de signer-cloture.js. Pas de `git fetch` : c'est la commande --actualiser.
//
// État rapporté : le PREMIER applicable de la liste ordonnée (anomalies d'abord, puis
// progression du plus avancé au moins avancé) ; les autres applicables sont listés.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SC = require('./signer-cloture.js');
const L = require('./liaison-generation.js');
const C = require('../engine/catalogue.js');

const ANOMALIES = ['non_initialise', 'acces_ko', 'incident_ouvert', 'observation_contradictoire', 'generation_en_cours', 'doublon',
  'signature_interrompue', 'generation_incoherente', 'candidat_non_conforme', 'relecteur_non_local', 'decision_non_conforme'];
const PROGRESSION = ['signe', 'pret_pour_cloture', 'decision_figee', 'pret_pour_saisie', 'generation_echouee', 'aucune_generation'];
const ORDRE = [...ANOMALIES, ...PROGRESSION];
const EN_VOL = ['new', 'running', 'waiting'];
const shaHex = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sha = async (t) => shaHex(Buffer.from(t, 'utf8'));
const lireJson = (b) => { try { return JSON.parse(Buffer.from(b).toString('utf8')); } catch { return undefined; } };

async function essayer(f) { try { return { ok: true, v: await f() }; } catch (e) { return { ok: false, e }; } }

// s : sourcesLecture(...) (adaptateurs-production.js).
async function diagnostiquer(setId, s) {
  if (!C.SET_ID_PATTERN.test(setId || '')) throw new Error(`set_id invalide : ${setId}`);
  const etats = new Map();
  const marquer = (nom, detail = true) => { if (!etats.has(nom)) etats.set(nom, detail); };

  if (!SC.existeSurDisque(path.join(s.dossier, '.initialise'))) marquer('non_initialise');

  // Lot généré lu AVANT les listings (stabilité vérifiée par une seconde lecture APRÈS).
  const lotAvant = await essayer(() => s.drive.lireLotGenere(setId));
  const obs = await essayer(() => SC.observer(s.api, s.workflowGeneration));
  if (!obs.ok) marquer(obs.e instanceof SC.Refus ? 'observation_contradictoire' : 'acces_ko', obs.e instanceof SC.Refus ? obs.e.message : `n8n : ${obs.e.message}`);
  const cand = await essayer(() => s.drive.listerCandidats());
  if (!cand.ok) marquer('acces_ko', `Drive : ${cand.e.message}`);
  else if (cand.v.incompleteSearch !== false) marquer('acces_ko', 'Drive : recherche des candidats incomplète');
  const g = await essayer(() => s.git(['rev-parse', '--verify', 'origin/design^{commit}']));
  if (!g.ok) marquer('acces_ko', 'git : origin/design absent (lancer --actualiser)');
  let incidents = [];
  if (!etats.has('non_initialise')) {
    const inc = await essayer(() => s.incidents());
    if (!inc.ok) marquer('acces_ko', `registre des incidents : ${inc.e.message}`);
    else incidents = inc.v;
  }
  for (const i of incidents) if (i.statut !== 'resolu') marquer('incident_ouvert', i.id);
  const lotApres = await essayer(() => s.drive.lireLotGenere(setId));

  // Exécutions : toute exécution EN VOL du workflow épinglé (attribuée ou non) bloque.
  const execs = obs.ok ? obs.v : [];
  for (const x of execs) if (EN_VOL.includes(x.status)) marquer('generation_en_cours', `exécution ${x.id} (${x.status})`);
  const terminees = execs.filter((x) => !EN_VOL.includes(x.status));
  const details = new Map();
  for (const x of terminees) {
    const r = await essayer(() => s.api.lireExecution(x.id));
    details.set(x.id, r.ok ? r.v : L.INDISPONIBLE);
    if (!r.ok) marquer('acces_ko', `n8n : exécution ${x.id} illisible`);
  }
  const c1 = new L.Constats();
  const { examinees, complet } = L.examinerExecutions({ executions: terminees, details, constats: c1, normaliserDate: SC.normaliserDate });
  for (const c of c1.liste) if (c.issue === 'incident') marquer('observation_contradictoire', c.raison);
  const duLot = examinees.filter((e) => e.entree.set_id === setId);
  const reussies = duLot.filter((e) => e.x.status === 'success');
  const fichiersDuLot = cand.ok ? cand.v.fichiers.filter((f) => f.nom === `${setId}.lot.json` || (f.properties && f.properties.fonda_set_id === setId)) : [];
  if (reussies.length > 1 || fichiersDuLot.length > 1) marquer('doublon', `${reussies.length} génération(s) réussie(s), ${fichiersDuLot.length} candidat(s)`);
  if ((reussies.length && !fichiersDuLot.length) || (fichiersDuLot.length && !reussies.length)) {
    marquer('generation_incoherente', `${reussies.length} génération(s) réussie(s) pour ${fichiersDuLot.length} candidat(s) : incohérence à examiner (jamais « aucune génération »)`);
  }

  // Rapprochement (§20.3) : examen des fichiers, classement, table normative, lot stable,
  // référentiel archivé résolu.
  let pretSaisie = false;
  let generation = null;
  let lot = null;
  let empreintes = null;
  let sortie = null;
  if (reussies.length === 1 && fichiersDuLot.length === 1 && cand.ok && cand.v.incompleteSearch === false && complet) {
    generation = reussies[0];
    const c2 = new L.Constats();
    const vf = L.examinerFichiers({ setId, fichiers: cand.v.fichiers, constats: c2 });
    const { retenue } = L.classerExecutions({ setId, examinees, complet, vueFichiers: vf, constats: c2 });
    const av = lotAvant.ok ? lotAvant.v : null;
    const ap = lotApres.ok ? lotApres.v : null;
    const stable = !!av && !!ap && Buffer.from(av.octets).equals(Buffer.from(ap.octets)) && av.id === ap.id;
    if (!stable) c2.ajouter('abandon', 'lot généré absent, illisible ou modifié pendant l\'observation');
    // Mêmes contrôles d'identité que le signataire (signer-cloture.js, lot source) : dates des
    // deux lectures ET du fichier listé identiques, aucune postérieure à la fin de génération ;
    // fichier lu = fichier listé ; nom exact.
    const fichierVu = vf.fichier || fichiersDuLot[0];
    const dates = [av, ap, fichierVu].filter(Boolean).map((x) => SC.normaliserDate(x.modifie_le));
    if (dates.some((d) => d === null) || new Set(dates).size > 1) c2.ajouter('abandon', 'lot généré : dates de modification illisibles ou différentes entre lectures et listing');
    else if (generation.x.stoppedAt && dates.some((d) => d > generation.x.stoppedAt)) c2.ajouter('abandon', 'lot généré modifié APRÈS la fin de l\'exécution de génération');
    if ([av, ap].some((x) => x && fichierVu && x.id !== fichierVu.id)) c2.ajouter('abandon', 'lot généré lu ≠ fichier candidat listé');
    if ([av, ap].some((x) => x && x.nom !== `${setId}.lot.json`)) c2.ajouter('abandon', `fichier lu : nom ≠ ${setId}.lot.json`);
    lot = stable ? lireJson(av.octets) : null;
    const dec = C.decomposerSetId(setId);
    if (stable && lot === undefined) { c2.ajouter('incident', 'lot généré illisible (JSON invalide)'); lot = null; }
    // Tout contenu décodé est validé, valeurs JSON « fausses » comprises (null, false, 0, "") :
    // comme le signataire, qui valide chaque contenu lu sans condition.
    else if (stable && (!C.validerLot(lot).valide || lot.set_id !== setId || !dec || lot.palier !== dec.palier || C.slugDeNotion(lot.notion_id) !== dec.slug)) { c2.ajouter('abandon', 'lot généré non conforme'); lot = null; }
    if (lot) {
      const nuls = L.nullsExplicites(lot);
      if (nuls.length) c2.ajouter('abandon', `null explicite dans le lot : ${nuls.join(', ')}`);
      empreintes = { pedagogique: await C.calculerEmpreinte(lot, sha), complete: L.empreinteComplete(lot) };
    }
    let jc = L.INDISPONIBLE;
    if (retenue && retenue !== L.INDISPONIBLE) {
      const so = L.itemUnique(details.get(retenue.x.id), L.NOEUD_SORTIE);
      if (so.ok) { const r = await essayer(() => s.journal(so.json.journal_commit)); if (r.ok) jc = r.v; else c2.ajouter('temporaire', 'journal illisible'); }
      sortie = L.rapprocher({ setId, retenue, fichier: vf.fichier, brute: details.get(retenue.x.id), workflowId: s.workflowGeneration, journalCommit: jc, registre: s.registre, modelesAutorises: s.modelesAutorises, lotSource: lot, empreintes, constats: c2 });
    }
    if (sortie && [av, ap].some((x) => x && x.id !== sortie.candidat_fichier_id)) c2.ajouter('abandon', 'fichier lu : identifiant ≠ candidat_fichier_id de la génération');
    if (sortie) {
      const r = await essayer(() => s.referentielArchive(sortie.referentiel_version));
      if (!r.ok || `sha256:${shaHex(Buffer.from(r.v))}` !== sortie.referentiel_version) c2.ajouter('abandon', 'référentiel archivé introuvable ou ≠ referentiel_version');
    }
    if (c2.liste.length === 0 && jc !== L.INDISPONIBLE && sortie) {
      // Relecteur attribué : la fonction RÉELLE de la saisie locale (signer-cloture.js,
      // relecteurDeLaGeneration) ; saisie et clôture locales réservées à « eric » (§20.6).
      const r = await essayer(() => SC.relecteurDeLaGeneration(setId, { api: s.api, config: { workflowGeneration: s.workflowGeneration }, referentielArchive: s.referentielArchive }));
      if (!r.ok) marquer('candidat_non_conforme', `relecteur attribué non déterminable : ${r.e.message}`);
      else if (r.v !== 'eric') marquer('relecteur_non_local', `relecteur attribué « ${r.v} » : saisie et clôture locales réservées à « eric » (§20.6)`);
      else pretSaisie = true;
    } else marquer('candidat_non_conforme', c2.liste.map((c) => `${c.issue} : ${c.raison}`).join(' ; ') || 'rapprochement impossible');
  }
  if (pretSaisie) marquer('pret_pour_saisie');

  // Signé : SEULEMENT si les pièces d'un dossier canonique <set_id>-<code> se vérifient
  // (signature, chemin, instantané) ; le marqueur, écrit AVANT la signature, ne suffit pas.
  if (SC.existeSurDisque(path.join(s.dossier, `${setId}.signature`))) {
    const dossiers = SC.existeSurDisque(s.dossier) ? fs.readdirSync(s.dossier).filter((n) => n.startsWith(`${setId}-`)) : [];
    let verifie = false;
    for (const n of dossiers) if ((await essayer(() => s.verifier(path.join(s.dossier, n), setId))).ok) verifie = true;
    if (verifie) marquer('signe');
    else marquer('signature_interrompue', `marqueur ${setId}.signature sans pièces signées vérifiées : tentative de clôture interrompue (abandon du set_id)`);
  }
  const dl = await essayer(() => s.decisionsLocales(setId));
  if (!dl.ok) marquer('acces_ko', `décisions locales : ${dl.e.message}`);
  const lus = dl.ok ? dl.v.map((f) => lireJson(f.octets)) : [];
  if (lus.length) {
    const defauts = [];
    if (lus.some((d) => d === undefined || !SC.decisionConforme(d))) defauts.push('décision illisible ou non conforme à decision-fonda/v1');
    else {
      for (const d of lus) if (d.set_id !== setId || d.generation !== 0 || d.hash_formulaire !== 'saisie-locale') defauts.push('décision : set_id, generation = 0 ou hash_formulaire « saisie-locale » non respectés');
      // Même règle que le signataire : deux décisions figées aux OCTETS distincts = conflit.
      if (new Set(dl.v.map((f) => Buffer.from(f.octets).toString('hex'))).size > 1) defauts.push('deux décisions figées distinctes pour ce set_id : conflit');
      for (const e of L.unicite(lus)) defauts.push(`unicité : ${e}`);
      if (lot && empreintes) {
        const empreintePubliee = async (gardees) => C.calculerEmpreinte(SC.lotPublie(lot, { selection: gardees }), sha);
        for (const d of lus) for (const e of await L.reconcilier(d, { setId, lotSource: lot, empreintes, empreintePubliee })) defauts.push(`réconciliation : ${e}`);
      }
      if (sortie && lus.some((d) => d.coeur.moteur.version !== sortie.moteur.version || d.coeur.moteur.sha256 !== sortie.moteur.sha256)) defauts.push('coeur.moteur ≠ moteur de la génération');
    }
    if (defauts.length) marquer('decision_non_conforme', defauts.join(' ; '));
    else {
      const d = lus[0];
      const exclusions = [];
      if (d.coeur.action !== 'accepter') exclusions.push('décision « rejeter » : abandon, rien à clôturer');
      if (!pretSaisie || !lot) exclusions.push('génération non rapprochée sans constat');
      for (const n of ANOMALIES) if (etats.has(n)) exclusions.push(`anomalie : ${n}`);
      if (generation) {
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
  }
  if (!duLot.length && !fichiersDuLot.length) marquer('aucune_generation');
  else if (duLot.length && !reussies.length && !fichiersDuLot.length) marquer('generation_echouee');

  const applicables = ORDRE.filter((n) => etats.has(n));
  const etat = applicables[0] || 'generation_incoherente';
  return { set_id: setId, etat, detail: etats.get(etat) ?? 'aucun état déterminé', applicables: applicables.map((n) => ({ etat: n, detail: etats.get(n) })) };
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

module.exports = { diagnostiquer, diagnostiquerAcces, ORDRE, ANOMALIES };
