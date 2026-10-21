// Publication d'un lot FONDA relu (chaîne séparée de BOX, PRD §2 bis) : « publier =
// commit ». Ce script prépare le commit — il n'appelle aucun réseau, ne touche ni Drive
// ni n8n. Il écrit, dans cet ordre, fonda/data/lots/<set_id>.json (création exclusive),
// l'entrée de fonda/data/catalogue-fonda.json ET la transition `publie` de
// fonda/data/set_ids-journal.json (CDC relecture v8.3 §20.11), SEULEMENT si :
//   - le lot respecte lot-fonda/v1, porte revue_carte_par_carte: true et repasse les
//     garde-fous du MOTEUR du lot (celui de la charge signée) ;
//   - le journal (état de HEAD) porte ce set_id à l'état `reserve` : la ligne `publie`
//     ajoutée a pour ref la ref de réservation + ":publie" ;
//   - une ATTESTATION « cloture-signee » (Type 2, CDC §11) l'accompagne et passe
//     fonda/scripts/attestation-signee.js, dans l'ordre fail-closed : forme ; clé
//     déclarée dans fonda/data/cles/cles.json, PEM intègre, recevable (période de
//     validité, jamais révoquée — §14) ; SIGNATURE RSA-SHA256 PKCS#1 v1.5 sur les
//     octets canoniques de la charge ; invariants de valeur ; invariants de dépôt —
//     dont le relecteur attribué, contrôlé contre le RÉFÉRENTIEL ARCHIVÉ de la charge
//     (referentiel_version, §20.12 : fonda/scripts/referentiel-archive.js), jamais
//     contre le référentiel courant ;
//   - le set_id n'est pas déjà publié et son fichier n'existe pas (anti-écrasement) ;
//   - le catalogue résultant reste valide contre le référentiel courant.
// « manuelle-historique » (Type 1) reste réservée aux 8 lots de la migration : jamais
// pour un nouveau lot. Aucune signature réelle n'existe tant que signer-cloture.js est
// bloqué par sa garde maîtresse : c'est voulu (fail-closed).
//
// PRÉCONDITIONS (premier lancement, AVANT tout calcul) : aucune modification non
// commitée (copie de travail ni index) sur catalogue-fonda.json et set_ids-journal.json ;
// aucun fichier lots/<set_id>.json (sur disque ou suivi) ; aucun marqueur de publication
// interrompue. Catalogue et journal sont lus À HEAD ; tous les contrôles passent AVANT
// toute écriture. Ce n'est PAS une transaction atomique : juste avant d'écrire, le SHA
// de HEAD (et la date de la ligne `publie`) est consigné dans un marqueur local non
// suivi, `.git/fonda-publication-<set_id>` (hors arbre de travail), retiré quand les
// trois écritures ont abouti. Un VERROU commun (.git/fonda-publication.lock, création
// exclusive) exclut toute publication ou reprise concurrente ; juste avant d'écrire,
// HEAD, index, octets et type des chemins sont revérifiés (refus si quoi que ce soit a
// bougé). Aucun lien symbolique n'est suivi : dossiers réels du dépôt, fichiers
// ordinaires, O_NOFOLLOW. Les octets du disque sont comparés à HEAD indépendamment des
// indicateurs Git (assume-unchanged, skip-worktree).
// HYPOTHÈSE EXPLICITE (procédure humaine, option B) : aucun autre écrivain — éditeur,
// Git, autre outil — ne touche le dépôt pendant une publication ; le verrou n'exclut que
// ce script. La fenêtre résiduelle est RÉDUITE (catalogue et journal comparés puis écrits
// sur le même descripteur : une modification tierce ANTÉRIEURE à cette lecture n'est
// pas écrasée ; entre lecture et écriture, une fenêtre d'appel système subsiste) et DÉTECTÉE
// (contrôle après écriture : chemins réels dans le dépôt, octets attendus, HEAD
// inchangé ; sinon marqueur conservé et traitement manuel). Node n'offre pas openat :
// le remplacement d'un dossier parent par un lien pendant l'écriture est détecté
// après coup, pas empêché.
//
// REPRISE (`--reprendre`, après une panne partielle) : exemptée des préconditions
// ordinaires, mais exige le marqueur et HEAD = SHA consigné (tout commit intervenu
// entre-temps -> refus) ; recalcule tout depuis HEAD et n'accepte que des états
// intermédiaires ATTENDUS :
//   - lots/<set_id>.json : absent, ou NON SUIVI et identique octet pour octet au lot ;
//   - catalogue-fonda.json : identique à HEAD, ou à HEAD + exactement l'entrée attendue ;
//   - set_ids-journal.json : identique à HEAD, ou à HEAD + exactement la ligne attendue ;
//   - index identique à HEAD sur ces chemins (aucune autre modification).
// Sinon refus AVANT toute écriture (traitement manuel par Éric) ; si oui, complète les
// écritures manquantes, rien d'autre. Aucune PR n'est ouverte sur un état partiel.
//
// FRONTIÈRE : ce script vérifie ce qui est vérifiable depuis la charge, le lot publié,
// l'entrée, le journal, le référentiel archivé et la clé publique. Les invariants
// LOCAUX — sha256_instantane égal à l'instantané réel, partition selection/ecartees
// contre le candidat réel, rapprochement exécution n8n <-> lot — relèvent de
// signer-cloture.js.
//
// Usage : node fonda/scripts/publier-lot.js <lot-relu.json> <attestation.json> [--dry-run | --reprendre]
// Ensuite : relire le diff, commit, PR (fonda/data/catalogue.test.js revérifie,
// signatures comprises ; verifier-immuabilite.js contrôle reserve puis publie).

'use strict';

const fs = require('fs');
const path = require('path');
const C = require('../engine/catalogue.js');
const J = require('../engine/journal-set-ids.js');
const { chargerMoteurNode, lireRegistre } = require('./moteurs.js');
const S = require('./attestation-signee.js');
const RA = require('./referentiel-archive.js');
const VM = require('./verifier-moteurs.js');

const DATA = path.join(__dirname, '..', 'data');
const REL_CATALOGUE = 'fonda/data/catalogue-fonda.json';
const REL_JOURNAL = 'fonda/data/set_ids-journal.json';
const REL_REFERENTIEL = 'fonda/data/referentiel.json';
const REL_MODELES = 'fonda/data/modeles-autorises.json';
const texteJson = (o) => `${JSON.stringify(o, null, 2)}\n`;

function clesDuDepot() {
  return S.chargerCles(JSON.parse(fs.readFileSync(path.join(DATA, 'cles', 'cles.json'), 'utf8')), (f) => fs.readFileSync(path.join(DATA, f), 'utf8'));
}

/**
 * Étapes 1 à 3 de la publication, PARTAGÉES avec l'extraction locale du signataire
 * (signataire-cli.js --extraire-publication) : aucune règle n'est recodée ailleurs.
 *   1. référentiel ARCHIVÉ de la charge (§20.12) ;
 *   2. attestation vérifiée EN ENTIER contre l'entrée construite depuis le lot (entreeDepuisLot) ;
 *   3. garde-fous pédagogiques du MOTEUR de la charge authentifiée.
 * Ne consulte AUCUN état de publication (catalogue, journal, fichiers).
 * @returns {Promise<{ok:true, entree}|{ok:false, erreurs:string[]}>}
 */
async function entreeDepuisLot(lot, attestation, sha256Hex) {
  const charge = (attestation && attestation.charge) || {};
  const moteurCharge = charge.moteur || {};
  return {
    set_id: lot.set_id,
    notion_id: lot.notion_id,
    palier: lot.palier,
    fichier: `lots/${lot.set_id}.json`,
    item_ids: lot.cartes.map((c) => c.item_id),
    empreinte: await C.calculerEmpreinte(lot, sha256Hex),
    moteur: { version: moteurCharge.version, sha256: moteurCharge.sha256 },
    relecteur: charge.badge,
    attestation,
  };
}

async function verifierLotEtAttestation({ lot, attestation, referentielArchive, sha256Hex, cles, modelesAutorises, registre = lireRegistre() }) {
  const erreurs = [];
  // 1. Référentiel ARCHIVÉ de la charge (§20.12) : le relecteur attribué est vérifié
  //    contre CETTE version, jamais contre le référentiel courant. Sans résolveur ->
  //    refus (jamais de contrôle du relecteur sauté).
  const charge = attestation.charge || {};
  if (typeof referentielArchive !== 'function') return { ok: false, erreurs: ['résolveur de référentiel archivé absent : refus'] };
  const ra = await referentielArchive(charge.referentiel_version);
  if (!ra || ra.ok !== true || !ra.referentiel || typeof ra.referentiel !== 'object') return { ok: false, erreurs: [`référentiel archivé : ${(ra && ra.raison) || 'introuvable'}`] };

  // 2. Attestation vérifiée EN ENTIER (forme -> clé -> signature -> valeurs -> dépôt)
  //    AVANT toute exécution de code pédagogique : le moteur n'est chargé qu'une fois
  //    la charge authentifiée et son moteur rapproché du registre.
  const entree = await entreeDepuisLot(lot, attestation, sha256Hex);
  const es = S.verifierAttestationSignee(attestation, { entree, registre, referentiel: ra.referentiel, cles, modelesAutorises });
  if (es.length) return { ok: false, erreurs: es };

  // 3. Garde-fous pédagogiques du MOTEUR DU LOT (celui de la charge authentifiée).
  let m;
  try { m = chargerMoteurNode(entree.moteur.version, entree.moteur.sha256); } catch (e) { return { ok: false, erreurs: [`moteur de la charge : ${e.message}`] }; }
  lot.cartes.forEach((c) => {
    const v0 = m.valider(c);
    if (!v0.valide) erreurs.push(`${c.item_id} : carte refusée par le moteur ${entree.moteur.version} (${v0.raisons.join(', ')})`);
    const r1 = m.outils.verifierReponseOr(c);
    if (!r1.ok) erreurs.push(`${c.item_id} : ${r1.raison}`);
    const r2 = m.outils.verifierFormesAcceptees(c);
    if (!r2.ok) erreurs.push(`${c.item_id} : ${r2.raison}`);
  });
  if (erreurs.length) return { ok: false, erreurs };
  return { ok: true, entree };
}

/**
 * Pure (hors SHA-256, clés et résolveur de référentiel injectés). Ne lit ni n'écrit aucun fichier.
 *   referentiel        : référentiel COURANT (validité du catalogue résultant) ;
 *   referentielArchive : (version) -> { ok, referentiel } | { ok: false, raison } (§20.12) ;
 *   journal            : journal des set_id (état de HEAD) ; le : date de la ligne `publie` ;
 *   modelesAutorises   : modèles épinglés (G5) — exigés pour une charge v2 (§20.9).
 * @returns {Promise<{ok:true, entree, catalogue, journal, lignePublie, fichier}|{ok:false, erreurs:string[]}>}
 */
async function preparerPublication({ lot, attestation, catalogue, referentiel, referentielArchive, journal, le, fichierExiste = () => false, sha256Hex, cles, modelesAutorises, registre = lireRegistre() }) {
  const erreurs = [];
  const v = C.validerLot(lot);
  if (!v.valide) return { ok: false, erreurs: v.erreurs.map((e) => `lot : ${e}`) };
  if (lot.revue_carte_par_carte !== true) erreurs.push('lot non relu (revue_carte_par_carte ≠ true)');
  if (!attestation || typeof attestation !== 'object') return { ok: false, erreurs: [...erreurs, 'attestation absente'] };
  if (attestation.type === 'manuelle-historique') return { ok: false, erreurs: [...erreurs, 'attestation « manuelle-historique » réservée aux 8 lots de la migration du 2026-10-13'] };
  if (attestation.type !== S.TYPE) return { ok: false, erreurs: [...erreurs, `type d'attestation « ${attestation.type} » non accepté (seul « ${S.TYPE} »)`] };
  if ((catalogue.lots || []).some((e) => e.set_id === lot.set_id)) erreurs.push(`set_id ${lot.set_id} déjà publié : une entrée publiée est immuable (nouvelle version = nouveau set_id + nouvelle relecture)`);
  const fichier = `lots/${lot.set_id}.json`;
  if (fichierExiste(fichier)) erreurs.push(`${fichier} existe déjà : refus d'écraser`);
  if (erreurs.length) return { ok: false, erreurs };

  // 0. Journal (§20.11) : réservation courante, ligne `publie` = ref de réservation + ":publie".
  const vj = J.validerJournal(journal);
  if (!vj.valide) return { ok: false, erreurs: vj.erreurs.map((e) => `journal : ${e}`) };
  if (vj.etats.get(lot.set_id) !== 'reserve') return { ok: false, erreurs: [`journal : ${lot.set_id} à l'état ${vj.etats.get(lot.set_id) || 'absent'} (seul « reserve » est publiable)`] };
  const reserve = journal.lignes.find((l) => l.set_id === lot.set_id && l.transition === 'reserve');
  const lignePublie = { set_id: lot.set_id, transition: 'publie', le, ref: `${reserve.ref}${J.SUFFIXE_PUBLIE}` };
  const nouveauJournal = { schema: journal.schema, lignes: [...journal.lignes, lignePublie] };
  const vj2 = J.validerJournal(nouveauJournal);
  if (!vj2.valide) return { ok: false, erreurs: vj2.erreurs.map((e) => `journal après publie : ${e}`) };

  // 1-3. Lot + attestation vérifiés (fonction PARTAGÉE avec l'extraction locale du signataire).
  const va = await verifierLotEtAttestation({ lot, attestation, referentielArchive, sha256Hex, cles, modelesAutorises, registre });
  if (!va.ok) return { ok: false, erreurs: va.erreurs };
  const { entree } = va;
  if (erreurs.length) return { ok: false, erreurs };
  const nouveau = { ...catalogue, lots: [...catalogue.lots, entree] };
  const vc = C.validerCatalogue(nouveau, referentiel);
  if (!vc.valide) return { ok: false, erreurs: vc.erreurs };
  return { ok: true, entree, catalogue: nouveau, journal: nouveauJournal, lignePublie, fichier };
}

// --- Couche Git / disque (préconditions, verrou, marqueur, reprise) --------------------
class Refus extends Error {}
const refuser = (m) => { throw new Refus(m); };
const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;

// Environnement injectable (tests : dépôt Git temporaire). Écritures et lectures sans
// suivre de lien symbolique (O_NOFOLLOW) ; la création exclusive (wx) n'en suit jamais.
function environnement(racine = VM.RACINE) {
  const git = VM.executeurGit(racine);
  const abs = (rel) => path.join(racine, rel);
  return {
    racine,
    git,
    head: () => git(['rev-parse', '--verify', 'HEAD^{commit}']).toString().trim(),
    gitDir: () => git(['rev-parse', '--absolute-git-dir']).toString().trim(),
    aHead: (rel) => { try { return git(['show', `HEAD:${rel}`]); } catch { refuser(`${rel} illisible à HEAD`); } return null; },
    suivi: (rel) => git(['ls-files', '--', rel]).toString().trim() !== '',
    aHeadExiste: (rel) => git(['ls-tree', 'HEAD', '--', rel]).toString().trim() !== '',
    modifie: (rels) => git(['status', '--porcelain', '--', ...rels]).toString().trim() !== '',
    indexDiffere: (rels) => { try { git(['diff', '--cached', '--quiet', 'HEAD', '--', ...rels]); return false; } catch { return true; } },
    // Type d'entrée par lstat (un lien, même cassé, est « lien ») ; seule l'absence
    // AVÉRÉE (ENOENT) vaut « absent », toute autre erreur est levée.
    type: (p) => {
      let st;
      try { st = fs.lstatSync(p); } catch (err) { if (err && err.code === 'ENOENT') return 'absent'; throw err; }
      if (st.isSymbolicLink()) return 'lien';
      if (st.isFile()) return 'fichier';
      return st.isDirectory() ? 'dossier' : 'autre';
    },
    reel: (p) => fs.realpathSync(p),
    lire: (p) => { const fd = fs.openSync(p, fs.constants.O_RDONLY | O_NOFOLLOW); try { return fs.readFileSync(fd); } finally { fs.closeSync(fd); } },
    ecrireExclusif: (p, x) => fs.writeFileSync(p, x, { flag: 'wx' }),
    // Écrit SEULEMENT si le contenu lu par le même descripteur vaut `avant` (sinon
    // exception, fichier intact) : réduit la fenêtre contrôle -> écriture à l'appel système.
    ecrireSiInchange: (p, avant, apres) => {
      const fd = fs.openSync(p, fs.constants.O_RDWR | O_NOFOLLOW);
      try {
        if (!fs.readFileSync(fd).equals(avant)) refuser(`${path.relative(racine, p)} modifié juste avant l'écriture (écrivain concurrent ?) — rien écrit sur ce fichier ; traitement manuel`);
        fs.ftruncateSync(fd, 0);
        fs.writeSync(fd, apres, 0, apres.length, 0);
      } finally { fs.closeSync(fd); }
    },
    supprimer: (p) => fs.unlinkSync(p),
    abs,
  };
}

// JSON de HEAD, exigé au format canonique du dépôt (JSON.stringify(_, null, 2) + "\n") :
// sinon l'écriture changerait plus que l'ajout attendu.
function jsonDeHead(env, rel) {
  const octets = env.aHead(rel);
  let o;
  try { o = JSON.parse(octets.toString('utf8')); } catch { refuser(`${rel} à HEAD : JSON invalide`); }
  if (texteJson(o) !== octets.toString('utf8')) refuser(`${rel} à HEAD : format non canonique (JSON.stringify indenté de 2 + saut de ligne attendu)`);
  return { objet: o, octets };
}

// Chemins de publication RÉELS : dossiers fonda/, fonda/data/, fonda/data/lots/ = vrais
// dossiers situés dans le dépôt (aucun lien) ; catalogue et journal = fichiers
// ordinaires ; lot = absent ou fichier ordinaire. Sinon refus (aucune écriture hors dépôt).
function verifierChemins(env, relLot) {
  const racineReelle = env.reel(env.racine);
  for (const rel of ['fonda', 'fonda/data', 'fonda/data/lots']) {
    if (env.type(env.abs(rel)) !== 'dossier' || env.reel(env.abs(rel)) !== path.join(racineReelle, rel)) refuser(`${rel} : dossier réel du dépôt attendu (lien symbolique ou chemin détourné refusé)`);
  }
  for (const rel of [REL_CATALOGUE, REL_JOURNAL]) if (env.type(env.abs(rel)) !== 'fichier') refuser(`${rel} : fichier ordinaire attendu (lien symbolique refusé)`);
  const t = env.type(env.abs(relLot));
  if (t !== 'absent' && t !== 'fichier') refuser(`${relLot} : ${t} — fichier ordinaire ou absence attendus`);
  return t;
}

// Photographie de l'état des chemins de publication (pour revérifier juste avant d'écrire).
function photographier(env, relLot) {
  const tLot = env.type(env.abs(relLot));
  return JSON.stringify({
    head: env.head(),
    index: env.indexDiffere([REL_CATALOGUE, REL_JOURNAL, relLot]),
    catalogue: env.lire(env.abs(REL_CATALOGUE)).toString('base64'),
    journal: env.lire(env.abs(REL_JOURNAL)).toString('base64'),
    lot: tLot === 'fichier' ? env.lire(env.abs(relLot)).toString('base64') : tLot,
  });
}

// Contrôle APRÈS écriture (détection, option B) : chemins réels toujours dans le dépôt,
// octets écrits = attendus, HEAD inchangé. Sinon refus : le marqueur est CONSERVÉ.
function controlerApres(env, { head, relLot, attendu }) {
  // Dossiers réels du dépôt et fichiers ordinaires (un parent devenu lien est vu ici).
  try { verifierChemins(env, relLot); } catch (err) { refuser(`contrôle après écriture : ${err.message} — marqueur conservé, traitement manuel`); }
  for (const [rel, octets] of [[relLot, attendu.lot], [REL_CATALOGUE, attendu.catalogue], [REL_JOURNAL, attendu.journal]]) {
    if (!env.lire(env.abs(rel)).equals(octets)) refuser(`contrôle après écriture : ${rel} ≠ contenu attendu (écrivain concurrent ?) — marqueur conservé, traitement manuel`);
  }
  if (env.head() !== head) refuser('contrôle après écriture : HEAD a changé pendant la publication — marqueur conservé, traitement manuel');
}

const cheminMarqueur = (env, setId) => path.join(env.gitDir(), `fonda-publication-${setId}`);
const cheminVerrou = (env) => path.join(env.gitDir(), 'fonda-publication.lock');

async function publier({ cheminLot, cheminAttestation, mode = 'publier', env = environnement(), dependances }) {
  // Verrou COMMUN (catalogue et journal sont partagés entre set_id) : une seule
  // publication ou reprise à la fois. Créé de façon exclusive, libéré dans tous les cas
  // où ce processus l'a pris ; présent au départ -> refus (arrêt brutal antérieur :
  // vérifier l'état, puis le supprimer à la main).
  let verrou = null;
  if (mode !== 'dry-run') {
    const v = cheminVerrou(env);
    try { env.ecrireExclusif(v, `${process.pid}
`); } catch (err) {
      if (err && err.code === 'EEXIST') refuser(`verrou ${path.basename(v)} présent : une autre publication est en cours ou s'est arrêtée brutalement — vérifier l'état, puis supprimer le verrou à la main`);
      throw err;
    }
    verrou = v;
  }
  try {
    return await publierSousVerrou({ cheminLot, cheminAttestation, mode, env, dependances });
  } finally {
    if (verrou) env.supprimer(verrou);
  }
}

async function publierSousVerrou({ cheminLot, cheminAttestation, mode, env, dependances }) {
  const texteLot = fs.readFileSync(cheminLot);
  let lot;
  try { lot = JSON.parse(texteLot.toString('utf8')); } catch { refuser(`${cheminLot} : JSON invalide`); }
  if (!lot || typeof lot.set_id !== 'string' || !C.SET_ID_PATTERN.test(lot.set_id)) refuser('lot : set_id canonique attendu');
  let attestation;
  try { attestation = JSON.parse(fs.readFileSync(cheminAttestation, 'utf8')); } catch { refuser(`${cheminAttestation} : JSON invalide`); }
  const setId = lot.set_id;
  const relLot = `fonda/data/lots/${setId}.json`;
  const marqueur = cheminMarqueur(env, setId);
  const head = env.head();
  const tMarqueur = env.type(marqueur);
  if (tMarqueur !== 'absent' && tMarqueur !== 'fichier') refuser(`marqueur ${path.basename(marqueur)} : ${tMarqueur} — traitement manuel`);
  const tLot = verifierChemins(env, relLot);
  let le;

  if (mode === 'reprendre') {
    if (tMarqueur === 'absent') refuser(`--reprendre : aucun marqueur ${path.basename(marqueur)} (aucune publication interrompue de ${setId})`);
    let mq;
    try { mq = JSON.parse(env.lire(marqueur).toString('utf8')); } catch { refuser('--reprendre : marqueur illisible — traitement manuel'); }
    if (!mq || mq.set_id !== setId || typeof mq.le !== 'string' || typeof mq.head !== 'string') refuser('--reprendre : marqueur mal formé — traitement manuel');
    if (mq.head !== head) refuser(`--reprendre : HEAD ${head.slice(0, 7)} ≠ SHA consigné ${mq.head.slice(0, 7)} (commit intervenu entre-temps) — traitement manuel`);
    le = mq.le;
  } else {
    // Préconditions ordinaires, AVANT tout calcul.
    if (tMarqueur !== 'absent') refuser(`publication interrompue de ${setId} (marqueur présent) : utiliser --reprendre, ou traitement manuel`);
    if (env.modifie([REL_CATALOGUE, REL_JOURNAL]) || env.indexDiffere([REL_CATALOGUE, REL_JOURNAL])) refuser('modifications non commitées sur catalogue-fonda.json ou set_ids-journal.json : refus (rien n\'est calculé)');
    // Octets RÉELS du disque = HEAD, indépendamment des indicateurs Git (assume-unchanged,
    // skip-worktree peuvent masquer une modification à git status).
    for (const rel of [REL_CATALOGUE, REL_JOURNAL]) if (!env.lire(env.abs(rel)).equals(env.aHead(rel))) refuser(`${rel} : contenu sur disque ≠ HEAD (modification masquée à Git ?) — refus (rien n'est calculé)`);
    if (tLot !== 'absent' || env.suivi(relLot) || env.aHeadExiste(relLot)) refuser(`${relLot} existe déjà : refus d'écraser`);
    le = dependances.horloge().toISOString();
  }
  const photo = photographier(env, relLot);

  const cat = jsonDeHead(env, REL_CATALOGUE);
  const jou = jsonDeHead(env, REL_JOURNAL);
  const r = await preparerPublication({
    lot, attestation, catalogue: cat.objet, journal: jou.objet, le,
    referentiel: JSON.parse(env.aHead(REL_REFERENTIEL).toString('utf8')),
    referentielArchive: dependances.referentielArchive,
    fichierExiste: (f) => env.aHeadExiste(`fonda/data/${f}`),
    sha256Hex: dependances.sha256Hex, cles: dependances.cles,
    modelesAutorises: S.lireModelesAutorises(env.aHead(REL_MODELES).toString('utf8')),
  });
  if (!r.ok) refuser(`publication refusée :\n  - ${r.erreurs.join('\n  - ')}`);
  const attendu = { lot: texteLot, catalogue: Buffer.from(texteJson(r.catalogue)), journal: Buffer.from(texteJson(r.journal)) };

  if (mode === 'dry-run') return { setId, ecrits: [], message: `(dry-run) ${setId} publiable — rien écrit.` };

  // Rien n'a bougé pendant le calcul (HEAD, index, octets, type des chemins) ; sinon
  // refus AVANT toute écriture — une modification faite entre-temps est préservée.
  const reverifier = () => {
    verifierChemins(env, relLot);
    if (photographier(env, relLot) !== photo) refuser('état du dépôt modifié pendant les contrôles (HEAD, index ou fichiers de publication) — refus, rien écrit');
  };

  if (mode === 'reprendre') {
    // États intermédiaires attendus, tous vérifiés AVANT toute écriture.
    const etat = {};
    if (env.indexDiffere([REL_CATALOGUE, REL_JOURNAL, relLot])) refuser('--reprendre : index ≠ HEAD sur les chemins de publication — traitement manuel');
    if (env.suivi(relLot)) refuser(`--reprendre : ${relLot} est suivi par Git — traitement manuel`);
    if (tLot === 'fichier') {
      if (!env.lire(env.abs(relLot)).equals(attendu.lot)) refuser(`--reprendre : ${relLot} présent mais ≠ lot à publier — traitement manuel`);
      etat.lot = true;
    } else etat.lot = false;
    for (const [cle, rel, h] of [['catalogue', REL_CATALOGUE, cat.octets], ['journal', REL_JOURNAL, jou.octets]]) {
      const disque = env.lire(env.abs(rel));
      if (disque.equals(h)) etat[cle] = false;
      else if (disque.equals(attendu[cle])) etat[cle] = true;
      else refuser(`--reprendre : ${rel} n'est ni HEAD ni HEAD + l'ajout attendu — traitement manuel`);
    }
    reverifier();
    const ecrits = [];
    if (!etat.lot) { env.ecrireExclusif(env.abs(relLot), attendu.lot); ecrits.push(relLot); }
    if (!etat.catalogue) { env.ecrireSiInchange(env.abs(REL_CATALOGUE), cat.octets, attendu.catalogue); ecrits.push(REL_CATALOGUE); }
    if (!etat.journal) { env.ecrireSiInchange(env.abs(REL_JOURNAL), jou.octets, attendu.journal); ecrits.push(REL_JOURNAL); }
    controlerApres(env, { head, relLot, attendu });
    env.supprimer(marqueur);
    return { setId, ecrits, message: `✓ reprise de ${setId} : ${ecrits.length ? `complété ${ecrits.join(', ')}` : 'rien à compléter'} — relire le diff, puis commit + PR.` };
  }

  // Premier lancement : marqueur (SHA de HEAD + date de la ligne publie), puis écritures.
  reverifier();
  env.ecrireExclusif(marqueur, texteJson({ set_id: setId, head, le }));
  env.ecrireExclusif(env.abs(relLot), attendu.lot);
  env.ecrireSiInchange(env.abs(REL_CATALOGUE), cat.octets, attendu.catalogue);
  env.ecrireSiInchange(env.abs(REL_JOURNAL), jou.octets, attendu.journal);
  controlerApres(env, { head, relLot, attendu });
  env.supprimer(marqueur);
  return { setId, ecrits: [relLot, REL_CATALOGUE, REL_JOURNAL], message: `✓ ${setId} publié (lot, catalogue, journal) — relire le diff, puis commit + PR.` };
}

// Contrôle CI d'une entrée « cloture-signee » du catalogue (catalogue.test.js) : même
// vérification que la publication, contre le RÉFÉRENTIEL ARCHIVÉ de la charge (§20.12).
function verifierClotureDuCatalogue(e, { resoudre, cles, registre, modelesAutorises }) {
  const charge = e && e.attestation && e.attestation.charge;
  const ra = resoudre(charge && charge.referentiel_version);
  if (!ra || ra.ok !== true || !ra.referentiel) return [`référentiel archivé : ${(ra && ra.raison) || 'introuvable'}`];
  return S.verifierAttestationSignee(e.attestation, { entree: e, registre, referentiel: ra.referentiel, cles, modelesAutorises });
}

async function main() {
  const args = process.argv.slice(2);
  const [cheminLot, cheminAttestation] = args.filter((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const reprendre = args.includes('--reprendre');
  if (!cheminLot || !cheminAttestation || (dryRun && reprendre)) {
    console.error('Usage : node fonda/scripts/publier-lot.js <lot-relu.json> <attestation.json> [--dry-run | --reprendre]');
    process.exitCode = 1;
    return;
  }
  const env = environnement();
  const refs = RA.refsDeConfiance();
  try {
    const r = await publier({
      cheminLot, cheminAttestation, mode: reprendre ? 'reprendre' : (dryRun ? 'dry-run' : 'publier'), env,
      dependances: {
        horloge: () => new Date(),
        referentielArchive: (version) => RA.resoudreReferentiel({ version, refs, racine: env.racine, git: env.git }),
        sha256Hex: C.sha256WebCrypto(),
        cles: clesDuDepot(),
      },
    });
    console.log(r.message);
  } catch (e) {
    console.error(e instanceof Refus ? `✗ ${e.message}` : `✗ erreur : ${e.message}`);
    process.exitCode = 1;
  }
}

module.exports = { preparerPublication, verifierLotEtAttestation, entreeDepuisLot, clesDuDepot, publier, environnement, verifierClotureDuCatalogue, Refus };

if (require.main === module) main();
