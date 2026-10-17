#!/usr/bin/env node
// Outil d'AUDIT des vecteurs figés de la brique 1 (CDC relecture v8.3 §20).
//
// Reconstruit, SANS canonique.js, les 43 vecteurs ajoutés à
// fonda/engine/canonique-vecteurs.json par la PR #18 (index 71 et suivants), puis
// les compare au fichier figé. La VÉRITÉ reste le fichier figé : cet outil ne
// l'écrit JAMAIS ; il sert à rejouer et auditer la méthode de génération.
//
// Méthode indépendante : chaque attendu = JSON.stringify natif d'un objet construit
// par une fonction écrite à la main dans l'ordre du CDC (§11, §20.3, §20.4, §20.5,
// §20.9), puis hex = UTF-8 (Buffer). Entrées lues dans le fichier figé : uniquement
// des ENTRÉES de vecteurs v8.2 (attestation-auto-nominale, recap-nominal), jamais un
// attendu. Le SHA du moteur v1 vient de moteurs.json.
//
// Usage : node fonda/scripts/vecteurs-canonique-brique1.js   (sortie 0 = identiques)

'use strict';
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..', '..');
const FICHIER = path.join(RACINE, 'fonda/engine/canonique-vecteurs.json');
const NB_V82 = 71;

function construire(figes, shaMoteurV1) {
  const sortie = [];
  const hexDe = (t) => Buffer.from(t, 'utf8').toString('hex');
  const entreeFigee = (id) => JSON.parse(JSON.stringify(figes.find((x) => x.id === id).entree));
  const pos = (id, description, contrat, entree, construireTexte) => {
    const texte = JSON.stringify(construireTexte(entree));
    sortie.push({ id, description, contrat, entree, texte, hex: hexDe(texte) });
  };
  const neg = (id, description, contrat, entree) => sortie.push({ id, description, refus: true, contrat, entree });
  const sans = (o, k) => { const c = JSON.parse(JSON.stringify(o)); delete c[k]; return c; };
  const mot = () => ({ version: 'v1', sha256: shaMoteurV1 });
  const E = (c) => 'sha256:' + c.repeat(64);
  const SET = 'set_fonda_nombres-fractions-relatifs_nI_02';
  const NOTION = 'maths.nombres-fractions-relatifs';
  const COMMIT = 'ea8860e' + '0'.repeat(33);
  const SERIALISATION = ' — fixture de SÉRIALISATION, pas un scénario de réconciliation §20.5 (empreintes synthétiques, cartes ≠ lot-complet-nominal)';

  // --- Constructeurs écrits à la main, ordre du CDC --------------------------------
  const moteur = (m) => ({ version: m.version, sha256: m.sha256 });
  const gen = (o) => ({ schema: o.schema, set_id: o.set_id, ref: o.ref, notion_id: o.notion_id, palier: o.palier, moteur: moteur(o.moteur),
    referentiel_version: o.referentiel_version, journal_commit: o.journal_commit, modele: o.modele, empreinte_pedagogique: o.empreinte_pedagogique,
    empreinte_complete: o.empreinte_complete, candidat_fichier_id: o.candidat_fichier_id });
  // §20.4 : la projection exige un null explicite ; les entrées positives le portent déjà.
  const carteC = (c) => ({ item_id: c.item_id, numero: c.numero, question: c.question, reponse: c.reponse, difficulte: c.difficulte, palier: c.palier,
    profil_correction: c.profil_correction, reponses_acceptees: c.reponses_acceptees, unite: c.unite, arrondi: c.arrondi,
    seconde_chance: c.seconde_chance, contexte: c.contexte, set_id: c.set_id, notion_id: c.notion_id });
  const complet = (o) => ({ schema: o.schema, set_id: o.set_id, notion_id: o.notion_id, palier: o.palier, matiere: o.matiere, notion: o.notion,
    niveau: o.niveau, revue_carte_par_carte: o.revue_carte_par_carte, nb_cartes: o.nb_cartes, date_creation: o.date_creation, cartes: o.cartes.map(carteC) });
  const relu = (o) => ({ set_id: o.set_id, empreinte_complete: o.empreinte_complete, cartes: o.cartes.map((c) => ({ item_id: c.item_id, choix: c.choix })) });
  const coeur = (o) => ({ action: o.action, selection: o.selection, ecartees: o.ecartees, empreinte_relue: o.empreinte_relue,
    empreinte_publiee: o.empreinte_publiee, moteur: moteur(o.moteur) });
  const decision = (o) => ({ schema: o.schema, set_id: o.set_id, generation: o.generation, nonce: o.nonce, recu_le: o.recu_le, coeur: coeur(o.coeur),
    lot_relu: relu(o.lot_relu), hash_formulaire: o.hash_formulaire });
  const v2 = (o) => ({ schema: o.schema, set_id: o.set_id, notion_id: o.notion_id, palier: o.palier, coeur: coeur(o.coeur),
    sha256_instantane: o.sha256_instantane, code_confirmation: o.code_confirmation,
    confirmation: { mode: o.confirmation.mode, par: o.confirmation.par, recue_par: o.confirmation.recue_par, le: o.confirmation.le },
    fidelite_transmission: { atteste_par: o.fidelite_transmission.atteste_par, le: o.fidelite_transmission.le },
    relecteur_attribue: o.relecteur_attribue, relecteur_egal_cloturer: o.relecteur_egal_cloturer,
    provenances: o.provenances.map((p) => ({ execution_id: p.execution_id, workflow_id: p.workflow_id, statut: p.statut, demarree_le: p.demarree_le })),
    nb_fichiers_decision: o.nb_fichiers_decision, referentiel_version: o.referentiel_version, moteur: moteur(o.moteur),
    execution_cloture: o.execution_cloture === null ? null : { execution_id: o.execution_cloture.execution_id, workflow_id: o.execution_cloture.workflow_id,
      statut: o.execution_cloture.statut, terminee_le: o.execution_cloture.terminee_le },
    source_decisions: o.source_decisions,
    generation: { execution_id: o.generation.execution_id, workflow_id: o.generation.workflow_id, statut: o.generation.statut,
      demarree_le: o.generation.demarree_le, terminee_le: o.generation.terminee_le, modele: o.generation.modele,
      empreinte_complete: o.generation.empreinte_complete, journal_commit: o.generation.journal_commit,
      listing_debut_le: o.generation.listing_debut_le, listing_fin_le: o.generation.listing_fin_le },
    fin_saisie_le: o.fin_saisie_le, revoque_le: o.revoque_le,
    levees: o.levees.map((l) => ({ type: l.type, constat: l.constat })),
    incidents_connus: o.incidents_connus.map((i) => ({ id: i.id, nature: i.nature, detecte_le: i.detecte_le, statut: i.statut, resolu_le: i.resolu_le,
      preuve_resolution: i.preuve_resolution, periode: { debut: i.periode.debut, fin: i.periode.fin } })),
    cloture_le: o.cloture_le, badge: { forme: o.badge.forme, nom_affiche: o.badge.nom_affiche, id: o.badge.id }, cle_id: o.cle_id });

  // --- generation-fonda/v1 (§20.3) --------------------------------------------------
  const GEN = { schema: 'generation-fonda/v1', set_id: SET, ref: '2026-10-16-a1b2c3d4e5f6', notion_id: NOTION, palier: 'nI', moteur: mot(),
    referentiel_version: E('4'), journal_commit: COMMIT, modele: 'claude-sonnet-x-y', empreinte_pedagogique: E('5'), empreinte_complete: E('6'),
    candidat_fichier_id: '1AbCdEfGhIjKlMnOpQrStUvWxYz' };
  pos('generation-nominale', 'sortie métier de génération (§20.3) : toutes les clés, moteur imbriqué', 'generation-fonda/v1', GEN, gen);
  pos('generation-ordre-entree', 'sortie de génération reçue dans le désordre : mêmes octets que generation-nominale', 'generation-fonda/v1',
    Object.fromEntries(Object.entries(GEN).reverse()), gen);

  // --- lot-complet-fonda/v1 (§20.4) -------------------------------------------------
  const C1 = { item_id: 'it01', numero: 1, question: 'Calculer 7 − (−5).', reponse: '12', difficulte: 'facile', palier: 'nI', profil_correction: 'numerique',
    reponses_acceptees: ['12', 12], unite: null, arrondi: null, seconde_chance: false, contexte: 'calcul-relatifs', set_id: SET, notion_id: NOTION };
  const C2 = { item_id: 'it02', numero: null, question: 'Écrire 3/4 en décimal.', reponse: null, difficulte: null, palier: 'nI', profil_correction: 'numerique',
    reponses_acceptees: ['0,75'], unite: null, arrondi: 2, seconde_chance: null, contexte: null, set_id: SET, notion_id: NOTION };
  const LOTC = { schema: 'lot-complet-fonda/v1', set_id: SET, notion_id: NOTION, palier: 'nI', matiere: 'Mathématiques',
    notion: 'Maîtriser nombres, fractions et relatifs', niveau: null, revue_carte_par_carte: false, nb_cartes: 2,
    date_creation: '2026-10-16T09:00:00.000Z', cartes: [C1, C2] };
  pos('lot-complet-nominal', 'projection complète (§20.4) : carte renseignée et carte aux champs optionnels absents -> null (numero, reponse, difficulte, seconde_chance, contexte) ; niveau null ; contexte couvert',
    'lot-complet-fonda/v1', LOTC, complet);
  pos('lot-complet-contexte-modifie', 'projection : seul contexte change -> octets différents (l\'empreinte pédagogique, elle, ne le couvre pas)',
    'lot-complet-fonda/v1', { ...LOTC, cartes: [{ ...C1, contexte: 'autre-contexte' }, C2] }, complet);

  // --- lot_relu-fonda/v1 (§20.5) et decision-fonda/v1 (§1) ---------------------------
  const RELU = { set_id: SET, empreinte_complete: E('6'), cartes: [{ item_id: 'it01', choix: 'garder' }, { item_id: 'it02', choix: 'ecarter' }, { item_id: 'it03', choix: 'garder' }] };
  pos('lot-relu-nominal', 'état relu (§20.5) : chaque carte une fois, ordre du lot source, garder/ecarter' + SERIALISATION, 'lot_relu-fonda/v1', RELU, relu);
  const COEUR = { action: 'accepter', selection: ['it01', 'it03'], ecartees: ['it02'], empreinte_relue: E('5'), empreinte_publiee: E('7'), moteur: mot() };
  const DEC = { schema: 'decision-fonda/v1', set_id: SET, generation: 0, nonce: 'f3a9c0d1e2b4a5c6', recu_le: '2026-10-16T10:15:00.000Z', coeur: COEUR,
    lot_relu: RELU, hash_formulaire: 'saisie-locale' };
  pos('decision-saisie-locale', 'décision figée par saisie locale (§20.6) : generation 0, hash_formulaire « saisie-locale », lot_relu imbriqué' + SERIALISATION,
    'decision-fonda/v1', DEC, decision);

  // --- attestation-cloture/v2 (§20.9) -----------------------------------------------
  const GENC = { execution_id: '501', workflow_id: 'wfGenerationFonda', statut: 'success', demarree_le: '2026-10-16T09:00:00.000Z',
    terminee_le: '2026-10-16T09:01:30.250Z', modele: 'claude-sonnet-x-y', empreinte_complete: E('6'), journal_commit: COMMIT,
    listing_debut_le: '2026-10-16T10:20:00.000Z', listing_fin_le: '2026-10-16T10:20:04.500Z' };
  const LOCALE = {
    schema: 'attestation-cloture/v2', set_id: SET, notion_id: NOTION, palier: 'nI', coeur: COEUR,
    sha256_instantane: 'cd'.repeat(32), code_confirmation: 'cd'.repeat(8),
    confirmation: { mode: 'auto', par: 'eric', recue_par: 'eric', le: '2026-10-16T10:25:00.000Z' },
    fidelite_transmission: { atteste_par: 'eric', le: '2026-10-16T10:25:30.000Z' },
    relecteur_attribue: 'eric', relecteur_egal_cloturer: true, provenances: [], nb_fichiers_decision: 1,
    referentiel_version: E('4'), moteur: mot(), execution_cloture: null, source_decisions: 'saisie_locale', generation: GENC,
    fin_saisie_le: '2026-10-16T10:15:00.000Z', revoque_le: null, levees: [], incidents_connus: [],
    cloture_le: '2026-10-16T10:26:00.000Z', badge: { forme: 'relue_par', nom_affiche: 'Éric Duchateau', id: 'eric' }, cle_id: 'eric-2026',
  };
  pos('attestation-v2-saisie-locale', 'charge v2, saisie locale (§20.9) : provenances vides, execution_cloture null, revoque_le null, fin_saisie_le renseignée, generation complète',
    'attestation-cloture/v2', LOCALE, v2);
  const PAGE = { ...LOCALE, source_decisions: 'page_relecture', relecteur_attribue: 'eric',
    provenances: [{ execution_id: '10', workflow_id: 'wfConfirmation01', statut: 'success', demarree_le: '2026-10-16T09:30:00.000Z' },
      { execution_id: '2', workflow_id: 'wfConfirmation01', statut: 'success', demarree_le: '2026-10-16T09:30:00.000Z' }],
    nb_fichiers_decision: 2, execution_cloture: { execution_id: '600', workflow_id: 'wfCloture0001', statut: 'success', terminee_le: '2026-10-16T10:10:00.000Z' },
    fin_saisie_le: null, revoque_le: '2026-10-16T10:09:00.000Z' };
  pos('attestation-v2-page-relecture', 'charge v2, parcours page (§20.9) : provenances « 10 » avant « 2 », execution_cloture et revoque_le renseignés, fin_saisie_le null',
    'attestation-cloture/v2', PAGE, v2);

  // --- Refus (premier lot) -----------------------------------------------------------
  neg('refus-v2-execution-cloture-absente', 'charge v2 sans clé execution_cloture (null exigé, jamais absence)', 'attestation-cloture/v2', sans(LOCALE, 'execution_cloture'));
  neg('refus-v2-generation-champ-extra', 'generation avec un champ supplémentaire', 'attestation-cloture/v2', { ...LOCALE, generation: { ...GENC, mode: 'webhook' } });
  neg('refus-v2-source-nombre', 'source_decisions numérique', 'attestation-cloture/v2', { ...LOCALE, source_decisions: 1 });
  neg('refus-v2-charge-v1', 'charge v1 présentée au contrat v2 (champs v2 manquants)', 'attestation-cloture/v2', entreeFigee('attestation-auto-nominale'));
  neg('refus-v1-charge-v2', 'charge v2 présentée au contrat v1 (champs inconnus) : v1 INCHANGÉE', 'attestation-cloture/v1', LOCALE);
  neg('refus-lot-complet-champ-absent', 'projection : carte sans clé contexte (null exigé)', 'lot-complet-fonda/v1', { ...LOTC, cartes: [sans(C1, 'contexte'), C2] });
  neg('refus-lot-complet-null-non-nullable', 'projection : question null', 'lot-complet-fonda/v1', { ...LOTC, cartes: [{ ...C1, question: null }, C2] });
  neg('refus-lot-relu-choix-booleen', 'lot_relu : choix booléen', 'lot_relu-fonda/v1', { ...RELU, cartes: [{ item_id: 'it01', choix: true }] });
  neg('refus-decision-lot-relu-absent', 'décision sans lot_relu', 'decision-fonda/v1', sans(DEC, 'lot_relu'));
  neg('refus-generation-schema-absent', 'sortie de génération sans schema', 'generation-fonda/v1', sans(GEN, 'schema'));

  // --- Deux branches de chaque nullable de la projection (critique Codex r1) ----------
  const INV = { ...LOTC, matiere: null, notion: null, niveau: '5e', revue_carte_par_carte: true, date_creation: null, cartes: [
    { ...C1, question: 'La température passe de −5 °C à 7 °C. De combien augmente-t-elle ?', unite: '°C', arrondi: null },
    { ...C2, question: 'Une baguette mesure 3/4 m. Donner sa longueur en mètres, arrondie au centième.', numero: 2, reponse: '0,75', difficulte: 'difficile',
      reponses_acceptees: ['0,75', 0.75], unite: 'm', arrondi: 2, seconde_chance: true, contexte: 'fractions' }] };
  pos('lot-complet-nullables-inverses', 'projection : l\'autre branche de chaque nullable (matiere/notion/date_creation null, niveau chaîne ; unite chaîne ; carte 2 entièrement renseignée)',
    'lot-complet-fonda/v1', INV, complet);
  for (const [k, v] of [['matiere', 1], ['notion', true], ['niveau', 5], ['date_creation', 0]]) {
    neg(`refus-lot-complet-${k.replace('_', '-')}-type`, `projection : ${k} de mauvais type (${JSON.stringify(v)})`, 'lot-complet-fonda/v1', { ...LOTC, [k]: v });
  }
  for (const [k, v] of [['numero', '1'], ['reponse', 12], ['difficulte', 1], ['unite', 3], ['arrondi', '2'], ['seconde_chance', 'non'], ['contexte', 1]]) {
    neg(`refus-lot-complet-carte-${k.replace('_', '-')}-type`, `projection : carte.${k} de mauvais type (${JSON.stringify(v)})`, 'lot-complet-fonda/v1',
      { ...LOTC, cartes: [{ ...C1, [k]: v }, C2] });
  }
  neg('refus-v2-execution-cloture-chaine', 'charge v2 : execution_cloture chaîne (objet ou null)', 'attestation-cloture/v2', { ...PAGE, execution_cloture: '600' });
  neg('refus-v2-fin-saisie-nombre', 'charge v2 : fin_saisie_le numérique', 'attestation-cloture/v2', { ...LOCALE, fin_saisie_le: 0 });
  neg('refus-v2-revoque-nombre', 'charge v2 : revoque_le numérique', 'attestation-cloture/v2', { ...PAGE, revoque_le: 0 });

  // --- Nullables partagés : incidents, badge (critique Codex r2) ----------------------
  const RESOLU = { id: 'inc-01', nature: 'drive-indisponible', detecte_le: '2026-10-16T08:00:00.000Z', statut: 'resolu', resolu_le: '2026-10-16T08:30:00.000Z',
    preuve_resolution: 'journal-n8n', periode: { debut: '2026-10-16T07:50:00.000Z', fin: '2026-10-16T08:20:00.000Z' } };
  const OUVERT = { id: 'inc-02', nature: 'purge-suspectee', detecte_le: '2026-10-16T09:10:00.000Z', statut: 'ouvert', resolu_le: null, preuve_resolution: null,
    periode: { debut: null, fin: null } };
  const INC = { ...PAGE, levees: [{ type: 'incident-connu', constat: 'sans effet sur le lot' }], incidents_connus: [RESOLU, OUVERT], badge: { ...PAGE.badge, id: null } };
  pos('attestation-v2-incidents-badge-nul', 'charge v2 : levée, incident résolu (nullables renseignés) et incident ouvert (nullables null) ; badge.id null',
    'attestation-cloture/v2', INC, v2);
  neg('refus-lot-complet-notion-nombre', 'projection : notion numérique', 'lot-complet-fonda/v1', { ...LOTC, notion: 3 });
  const incAvec = (k, v) => ({ ...INC, incidents_connus: [{ ...RESOLU, [k]: v }] });
  neg('refus-v2-incident-resolu-le-nombre', 'charge v2 : incident.resolu_le numérique', 'attestation-cloture/v2', incAvec('resolu_le', 1));
  neg('refus-v2-incident-preuve-nombre', 'charge v2 : incident.preuve_resolution numérique', 'attestation-cloture/v2', incAvec('preuve_resolution', 1));
  neg('refus-v2-incident-periode-debut-nombre', 'charge v2 : incident.periode.debut numérique', 'attestation-cloture/v2', incAvec('periode', { debut: 1, fin: null }));
  neg('refus-v2-incident-periode-fin-nombre', 'charge v2 : incident.periode.fin numérique', 'attestation-cloture/v2', incAvec('periode', { debut: null, fin: 1 }));
  neg('refus-v2-badge-id-nombre', 'charge v2 : badge.id numérique', 'attestation-cloture/v2', { ...INC, badge: { ...INC.badge, id: 7 } });

  // --- Récapitulatif v8.2 : trous de type fermés (refus seulement, v1 inchangée) -------
  const R = entreeFigee('recap-nominal');
  for (const [k, v] of [['reponse', 12], ['unite', 3], ['arrondi', '2']]) {
    neg(`refus-recap-${k}-type`, `récapitulatif : carte.${k} de mauvais type (${JSON.stringify(v)}) — couverture ajoutée en brique 1`, 'recapitulatif-fonda/v1',
      { ...R, cartes_gardees: R.cartes_gardees.map((c, i) => (i === 0 ? { ...c, [k]: v } : c)) });
  }
  return sortie;
}

// Compare la reconstruction au fichier figé ; renvoie la liste des écarts (vide = identiques).
function auditer(vecteurs, shaMoteurV1) {
  const ecarts = [];
  const figes = vecteurs.slice(NB_V82);
  const construits = construire(vecteurs.slice(0, NB_V82), shaMoteurV1);
  if (figes.length !== construits.length) ecarts.push(`nombre : figé ${figes.length}, reconstruit ${construits.length}`);
  for (let i = 0; i < Math.max(figes.length, construits.length); i += 1) {
    const f = figes[i], c = construits[i];
    if (JSON.stringify(f) !== JSON.stringify(c)) ecarts.push(`index ${NB_V82 + i} : figé ${f ? f.id : '(absent)'} ≠ reconstruit ${c ? c.id : '(absent)'}`);
  }
  return ecarts;
}

module.exports = { construire, auditer, NB_V82 };

if (require.main === module) {
  const vecteurs = JSON.parse(fs.readFileSync(FICHIER, 'utf8')).vecteurs;
  const sha = JSON.parse(fs.readFileSync(path.join(RACINE, 'fonda/engine/moteurs.json'), 'utf8'))[0].sha256;
  const ecarts = auditer(vecteurs, sha);
  if (ecarts.length) {
    for (const e of ecarts) console.error('✗ ' + e);
    process.exit(1);
  }
  console.log(`✓ vecteurs brique 1 : ${vecteurs.length - NB_V82} reconstruits sans canonique.js, identiques au fichier figé`);
}
