#!/usr/bin/env node
// Outil d'AUDIT des vecteurs figés de l'INTÉRIM (CDC relecture r9 §20.6, §20.9 ; plan r6,
// annexes A et B) : contrats decision-fonda/v2 et attestation-cloture/v3.
//
// Reconstruit, SANS canonique.js, le bloc de vecteurs ajouté à
// fonda/engine/canonique-vecteurs.json par le chantier « relecteur de secours en intérim »,
// puis le compare au fichier figé. Les vecteurs sont repérés par leurs IDENTIFIANTS (jamais
// par un index) : les blocs antérieurs (v8.2, brique 1, élargissement) restent à l'octet près.
// La VÉRITÉ reste le fichier figé : cet outil ne l'écrit JAMAIS.
//
// Méthode indépendante : chaque attendu = JSON.stringify natif d'un objet construit par une
// fonction écrite à la main dans l'ordre des annexes A (charge v3) et B (décision v2), puis
// hex = UTF-8 (Buffer). Aucune entrée n'est lue dans le fichier figé. Le SHA du moteur v1
// vient de moteurs.json.
//
// Usage : node fonda/scripts/vecteurs-canonique-interim.js   (sortie 0 = identiques)

'use strict';
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..', '..');
const FICHIER = path.join(RACINE, 'fonda/engine/canonique-vecteurs.json');

function construire(shaMoteurV1) {
  const sortie = [];
  const hexDe = (t) => Buffer.from(t, 'utf8').toString('hex');
  const pos = (id, description, contrat, entree, construireTexte) => {
    const texte = JSON.stringify(construireTexte(entree));
    sortie.push({ id, description, contrat, entree, texte, hex: hexDe(texte) });
  };
  const neg = (id, description, contrat, entree) => sortie.push({ id, description, refus: true, contrat, entree });
  const sans = (o, k) => { const c = JSON.parse(JSON.stringify(o)); delete c[k]; return c; };
  const inverse = (o) => Object.fromEntries(Object.entries(o).reverse());
  const mot = () => ({ version: 'v1', sha256: shaMoteurV1 });
  const E = (c) => 'sha256:' + c.repeat(64);
  const SET = 'set_fonda_comprendre-consigne_nI_02';
  const NOTION = 'fr.comprendre-consigne';
  const COMMIT_JOURNAL = 'ea8860e' + '0'.repeat(33);
  const COMMIT_DESIGN = 'c215dd0' + '3'.repeat(33);
  const SERIALISATION = ' — fixture de SÉRIALISATION (empreintes synthétiques)';

  // --- Constructeurs écrits à la main, ordre des annexes A et B -------------------------
  const moteur = (m) => ({ version: m.version, sha256: m.sha256 });
  const coeur = (o) => ({ action: o.action, selection: o.selection, ecartees: o.ecartees, empreinte_relue: o.empreinte_relue,
    empreinte_publiee: o.empreinte_publiee, moteur: moteur(o.moteur) });
  const relu = (o) => ({ set_id: o.set_id, empreinte_complete: o.empreinte_complete, cartes: o.cartes.map((c) => ({ item_id: c.item_id, choix: c.choix })) });
  const interimDecision = (b) => ({ relecteur_titulaire: b.relecteur_titulaire, relecteur_de_secours: b.relecteur_de_secours, motif: b.motif,
    periode: b.periode, du: b.du, au: b.au, source_version: b.source_version, source_commit: b.source_commit });
  const interimCharge = (b) => ({ relecteur_titulaire: b.relecteur_titulaire, relecteur_de_secours: b.relecteur_de_secours, motif: b.motif,
    periode: b.periode, du: b.du, au: b.au, source_version: b.source_version });
  const decisionV2 = (o) => ({ schema: o.schema, set_id: o.set_id, generation: o.generation, nonce: o.nonce, recu_le: o.recu_le, coeur: coeur(o.coeur),
    lot_relu: relu(o.lot_relu), hash_formulaire: o.hash_formulaire, relecture_interim: interimDecision(o.relecture_interim) });
  const v3 = (o) => ({ schema: o.schema, set_id: o.set_id, notion_id: o.notion_id, palier: o.palier, coeur: coeur(o.coeur),
    sha256_instantane: o.sha256_instantane, code_confirmation: o.code_confirmation,
    confirmation: { mode: o.confirmation.mode, par: o.confirmation.par, recue_par: o.confirmation.recue_par, le: o.confirmation.le },
    fidelite_transmission: { atteste_par: o.fidelite_transmission.atteste_par, le: o.fidelite_transmission.le },
    relecteur_attribue: o.relecteur_attribue, relecteur_egal_cloturer: o.relecteur_egal_cloturer, relecture_interim: interimCharge(o.relecture_interim),
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
    cloture_le: o.cloture_le,
    badge: { forme: o.badge.forme, nom_affiche: o.badge.nom_affiche, id: o.badge.id, titulaire: { id: o.badge.titulaire.id, nom_affiche: o.badge.titulaire.nom_affiche } },
    cle_id: o.cle_id });

  // --- decision-fonda/v2 (annexe B) -------------------------------------------------------
  const RELU = { set_id: SET, empreinte_complete: E('6'), cartes: [{ item_id: 'it01', choix: 'garder' }, { item_id: 'it02', choix: 'ecarter' }, { item_id: 'it03', choix: 'garder' }] };
  const COEUR = { action: 'accepter', selection: ['it01', 'it03'], ecartees: ['it02'], empreinte_relue: E('5'), empreinte_publiee: E('7'), moteur: mot() };
  const BLOC = { relecteur_titulaire: 'justine', relecteur_de_secours: 'eric',
    motif: 'Intérim de relecture du français pour P2, pendant la mise en place du parcours titulaire.', periode: 'P2', du: '2026-10-28', au: '2026-12-18',
    source_version: E('8'), source_commit: COMMIT_DESIGN };
  const DEC = { schema: 'decision-fonda/v2', set_id: SET, generation: 0, nonce: '9a8b7c6d5e4f3a2b', recu_le: '2026-11-04T16:15:00.000Z', coeur: COEUR,
    lot_relu: RELU, hash_formulaire: 'saisie-locale', relecture_interim: BLOC };
  pos('decision-v2-interim', 'décision figée sous INTÉRIM (annexe B) : v1 + relecture_interim (8 chaînes, source_commit en dernier)' + SERIALISATION,
    'decision-fonda/v2', DEC, decisionV2);
  pos('decision-v2-interim-ordre-entree', 'décision v2 reçue dans le désordre (racine et bloc) : mêmes octets que decision-v2-interim', 'decision-fonda/v2',
    { ...inverse(DEC), relecture_interim: inverse(BLOC) }, decisionV2);
  neg('refus-decision-v2-sans-interim', 'décision v2 sans relecture_interim (une décision v1 n\'est pas une v2)', 'decision-fonda/v2', sans(DEC, 'relecture_interim'));
  neg('refus-decision-v1-avec-interim', 'décision portant relecture_interim présentée au contrat v1 : v1 INCHANGÉE (champ inconnu)', 'decision-fonda/v1', DEC);
  neg('refus-decision-v2-interim-sans-commit', 'décision v2 : bloc d\'intérim sans source_commit', 'decision-fonda/v2', { ...DEC, relecture_interim: sans(BLOC, 'source_commit') });

  // --- attestation-cloture/v3 (annexe A) --------------------------------------------------
  const GENC = { execution_id: '701', workflow_id: 'wfGenerationFonda', statut: 'success', demarree_le: '2026-11-04T09:00:00.000Z',
    terminee_le: '2026-11-04T09:01:30.250Z', modele: 'claude-sonnet-x-y', empreinte_complete: E('6'), journal_commit: COMMIT_JOURNAL,
    listing_debut_le: '2026-11-04T16:20:00.000Z', listing_fin_le: '2026-11-04T16:20:04.500Z' };
  const BLOC_CHARGE = sans(BLOC, 'source_commit');
  const BADGE = { forme: 'relue_par_secours', nom_affiche: 'Éric Duchateau', id: 'eric', titulaire: { id: 'justine', nom_affiche: 'Justine Leblanc' } };
  const V3 = {
    schema: 'attestation-cloture/v3', set_id: SET, notion_id: NOTION, palier: 'nI', coeur: COEUR,
    sha256_instantane: 'ef'.repeat(32), code_confirmation: 'ef'.repeat(8),
    confirmation: { mode: 'auto', par: 'eric', recue_par: 'eric', le: '2026-11-04T16:25:00.000Z' },
    fidelite_transmission: { atteste_par: 'eric', le: '2026-11-04T16:25:30.000Z' },
    relecteur_attribue: 'justine', relecteur_egal_cloturer: false, relecture_interim: BLOC_CHARGE,
    provenances: [], nb_fichiers_decision: 1, referentiel_version: E('4'), moteur: mot(), execution_cloture: null, source_decisions: 'saisie_locale',
    generation: GENC, fin_saisie_le: '2026-11-04T16:15:00.000Z', revoque_le: null, levees: [], incidents_connus: [],
    cloture_le: '2026-11-04T16:26:00.000Z', badge: BADGE, cle_id: 'eric-2026',
  };
  pos('attestation-v3-interim', 'charge v3 (annexe A) : relecteur de secours en intérim, saisie locale, égalité fausse, relecture_interim après relecteur_egal_cloturer, fin_saisie_le chaîne, badge de secours avec titulaire',
    'attestation-cloture/v3', V3, v3);
  pos('attestation-v3-ordre-entree', 'charge v3 reçue dans le désordre (racine, bloc et badge) : mêmes octets que attestation-v3-interim', 'attestation-cloture/v3',
    { ...inverse(V3), relecture_interim: inverse(BLOC_CHARGE), badge: inverse(BADGE) }, v3);
  // Base STRUCTURELLE (élargissement : tous les tableaux non vides, objets nullables renseignés) —
  // forme canonique seulement : interdite comme attestation v3 réelle (invariants A8).
  const RESOLU = { id: 'inc-01', nature: 'drive-indisponible', detecte_le: '2026-11-04T08:00:00.000Z', statut: 'resolu', resolu_le: '2026-11-04T08:30:00.000Z',
    preuve_resolution: 'journal-n8n', periode: { debut: '2026-11-04T07:50:00.000Z', fin: '2026-11-04T08:20:00.000Z' } };
  const OUVERT = { id: 'inc-02', nature: 'purge-suspectee', detecte_le: '2026-11-04T09:10:00.000Z', statut: 'ouvert', resolu_le: null, preuve_resolution: null,
    periode: { debut: null, fin: null } };
  const STRUCT = { ...V3, provenances: [{ execution_id: '10', workflow_id: 'wfConfirmation01', statut: 'success', demarree_le: '2026-11-04T15:30:00.000Z' }],
    execution_cloture: { execution_id: '600', workflow_id: 'wfCloture0001', statut: 'success', terminee_le: '2026-11-04T16:10:00.000Z' },
    revoque_le: '2026-11-04T16:09:00.000Z', levees: [{ type: 'recherche_incomplete', constat: 'sans effet sur le lot' }], incidents_connus: [RESOLU, OUVERT] };
  pos('attestation-v3-structure-complete', 'charge v3, base STRUCTURELLE de l\'élargissement : provenances, execution_cloture, revoque_le, levée et incidents (nullables des deux branches) renseignés — forme canonique seulement, interdite comme attestation v3 réelle (invariants A8)',
    'attestation-cloture/v3', STRUCT, v3);
  neg('refus-v3-badge-sans-titulaire', 'charge v3 : badge sans titulaire (badge v2)', 'attestation-cloture/v3', { ...V3, badge: sans(BADGE, 'titulaire') });
  neg('refus-v3-badge-titulaire-champ-extra', 'charge v3 : badge.titulaire avec un champ supplémentaire', 'attestation-cloture/v3', { ...V3, badge: { ...BADGE, titulaire: { ...BADGE.titulaire, relu: true } } });
  neg('refus-v3-badge-id-null', 'charge v3 : badge.id null (non nullable en v3 : le secours est toujours nommé)', 'attestation-cloture/v3', { ...V3, badge: { ...BADGE, id: null } });
  neg('refus-v3-fin-saisie-null', 'charge v3 : fin_saisie_le null (chaîne NON nullable en v3)', 'attestation-cloture/v3', { ...V3, fin_saisie_le: null });
  neg('refus-v3-interim-sans-version', 'charge v3 : relecture_interim sans source_version', 'attestation-cloture/v3', { ...V3, relecture_interim: sans(BLOC_CHARGE, 'source_version') });
  neg('refus-v3-interim-avec-commit', 'charge v3 : relecture_interim portant source_commit (champ de la décision, jamais de la charge)', 'attestation-cloture/v3', { ...V3, relecture_interim: BLOC });
  neg('refus-v3-interim-absent', 'charge v3 sans relecture_interim', 'attestation-cloture/v3', sans(V3, 'relecture_interim'));
  neg('refus-v2-charge-v3', 'charge v3 présentée au contrat v2 : v2 INCHANGÉE (champ inconnu)', 'attestation-cloture/v2', V3);
  neg('refus-v1-charge-v3', 'charge v3 présentée au contrat v1 : v1 INCHANGÉE (champs inconnus)', 'attestation-cloture/v1', V3);
  return sortie;
}

// Compare la reconstruction au fichier figé (repérage par identifiants) ; renvoie les écarts.
function auditer(vecteurs, shaMoteurV1) {
  const ecarts = [];
  const construits = construire(shaMoteurV1);
  const ids = new Set(construits.map((x) => x.id));
  const figes = vecteurs.filter((x) => ids.has(x.id));
  if (figes.length !== construits.length) ecarts.push(`nombre : figé ${figes.length}, reconstruit ${construits.length}`);
  for (let i = 0; i < Math.max(figes.length, construits.length); i += 1) {
    const f = figes[i], c = construits[i];
    if (JSON.stringify(f) !== JSON.stringify(c)) ecarts.push(`${c ? c.id : '(absent)'} : figé ≠ reconstruit`);
  }
  return ecarts;
}

module.exports = { construire, auditer };

if (require.main === module) {
  const vecteurs = JSON.parse(fs.readFileSync(FICHIER, 'utf8')).vecteurs;
  const sha = JSON.parse(fs.readFileSync(path.join(RACINE, 'fonda/engine/moteurs.json'), 'utf8'))[0].sha256;
  const ecarts = auditer(vecteurs, sha);
  if (ecarts.length) {
    for (const e of ecarts) console.error('✗ ' + e);
    process.exit(1);
  }
  console.log(`✓ vecteurs de l'intérim : ${construire(sha).length} reconstruits sans canonique.js, identiques au fichier figé`);
}
