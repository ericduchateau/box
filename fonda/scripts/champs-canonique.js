// Classification des champs des contrats canoniques, TENUE À LA MAIN contre le CDC
// relecture (§1, §11, §11 bis v8.2, §20 v8.3) — JAMAIS dérivée des descripteurs de
// fonda/engine/canonique.js. Si canonique.js élargit un champ (nullable, « chaîne ou
// nombre »), cette liste, elle, ne bouge pas : les vecteurs de refus qui en sont tirés
// (vecteurs-canonique-elargissement.js) et la confrontation aux schémas chargés
// (outils-canonique.test.js) échouent. Toute évolution d'un contrat exige donc de
// modifier CE fichier, relu contre le CDC, en plus de canonique.js.
//
// Notation (reprise du §11 bis) : 'chaine', 'nombre', 'booleen', 'chaine_ou_nombre' ;
// O({ ... }) = objet aux clés exactes, dans cet ordre ; T(x) = tableau d'éléments x ;
// N(x) = x | null (clé toujours présente).
'use strict';

const O = (champs) => ({ objet: champs });
const T = (elements) => ({ tableau: elements });
const N = (de) => ({ nullable: de });

// §1, §11 bis : moteur et cœur.
const MOTEUR = O({ version: 'chaine', sha256: 'chaine' });
const COEUR = O({ action: 'chaine', selection: T('chaine'), ecartees: T('chaine'), empreinte_relue: 'chaine', empreinte_publiee: 'chaine', moteur: MOTEUR });

// §11 bis : sous-objets de la charge.
const CONFIRMATION = O({ mode: 'chaine', par: 'chaine', recue_par: 'chaine', le: 'chaine' });
const FIDELITE = O({ atteste_par: 'chaine', le: 'chaine' });
const PROVENANCE = O({ execution_id: 'chaine', workflow_id: 'chaine', statut: 'chaine', demarree_le: 'chaine' });
const EXECUTION_CLOTURE = O({ execution_id: 'chaine', workflow_id: 'chaine', statut: 'chaine', terminee_le: 'chaine' });
const LEVEE = O({ type: 'chaine', constat: 'chaine' });
const INCIDENT = O({ id: 'chaine', nature: 'chaine', detecte_le: 'chaine', statut: 'chaine', resolu_le: N('chaine'), preuve_resolution: N('chaine'), periode: O({ debut: N('chaine'), fin: N('chaine') }) });
const BADGE = O({ forme: 'chaine', nom_affiche: 'chaine', id: N('chaine') });

// §11 bis : récapitulatif.
const CARTE_RECAP = O({ item_id: 'chaine', question: 'chaine', reponse: N('chaine'), profil_correction: 'chaine', reponses_acceptees: T('chaine_ou_nombre'), unite: N('chaine'), arrondi: N('nombre'), seconde_chance: N('booleen') });
const RECAPITULATIF = O({ schema: 'chaine', set_id: 'chaine', notion_id: 'chaine', palier: 'chaine', moteur: MOTEUR, empreinte_relue: 'chaine', empreinte_publiee: 'chaine', cartes_gardees: T(CARTE_RECAP), cartes_ecartees: T(O({ item_id: 'chaine', question: 'chaine' })) });

// §11 bis : charge v1 (revoque_le chaîne, execution_cloture objet : jamais null en v1).
const ATTESTATION_V1 = O({
  schema: 'chaine', set_id: 'chaine', notion_id: 'chaine', palier: 'chaine', coeur: COEUR, sha256_instantane: 'chaine', code_confirmation: 'chaine',
  confirmation: CONFIRMATION, fidelite_transmission: FIDELITE, relecteur_attribue: 'chaine', relecteur_egal_cloturer: 'booleen', provenances: T(PROVENANCE),
  nb_fichiers_decision: 'nombre', referentiel_version: 'chaine', moteur: MOTEUR, execution_cloture: EXECUTION_CLOTURE, revoque_le: 'chaine',
  levees: T(LEVEE), incidents_connus: T(INCIDENT), cloture_le: 'chaine', badge: BADGE, cle_id: 'chaine',
});

// §20.3 : sortie métier de génération (« toutes chaînes sauf moteur »).
const GENERATION = O({
  schema: 'chaine', set_id: 'chaine', ref: 'chaine', notion_id: 'chaine', palier: 'chaine', moteur: MOTEUR, referentiel_version: 'chaine',
  journal_commit: 'chaine', modele: 'chaine', empreinte_pedagogique: 'chaine', empreinte_complete: 'chaine', candidat_fichier_id: 'chaine',
});

// §20.4 : projection complète.
const CARTE_COMPLETE = O({
  item_id: 'chaine', numero: N('nombre'), question: 'chaine', reponse: N('chaine'), difficulte: N('chaine'), palier: 'chaine', profil_correction: 'chaine',
  reponses_acceptees: T('chaine_ou_nombre'), unite: N('chaine'), arrondi: N('nombre'), seconde_chance: N('booleen'), contexte: N('chaine'),
  set_id: 'chaine', notion_id: 'chaine',
});
const LOT_COMPLET = O({
  schema: 'chaine', set_id: 'chaine', notion_id: 'chaine', palier: 'chaine', matiere: N('chaine'), notion: N('chaine'), niveau: N('chaine'),
  revue_carte_par_carte: 'booleen', nb_cartes: 'nombre', date_creation: N('chaine'), cartes: T(CARTE_COMPLETE),
});

// §20.5 : lot relu ; §1 + §20.6 : décision (generation = nombre, 0 en saisie locale).
const LOT_RELU = O({ set_id: 'chaine', empreinte_complete: 'chaine', cartes: T(O({ item_id: 'chaine', choix: 'chaine' })) });
const DECISION = O({ schema: 'chaine', set_id: 'chaine', generation: 'nombre', nonce: 'chaine', recu_le: 'chaine', coeur: COEUR, lot_relu: LOT_RELU, hash_formulaire: 'chaine' });

// §20.9 : charge v2 (execution_cloture v1 | null ; fin_saisie_le et revoque_le chaîne | null).
const GENERATION_CHARGE = O({
  execution_id: 'chaine', workflow_id: 'chaine', statut: 'chaine', demarree_le: 'chaine', terminee_le: 'chaine', modele: 'chaine',
  empreinte_complete: 'chaine', journal_commit: 'chaine', listing_debut_le: 'chaine', listing_fin_le: 'chaine',
});
const ATTESTATION_V2 = O({
  schema: 'chaine', set_id: 'chaine', notion_id: 'chaine', palier: 'chaine', coeur: COEUR, sha256_instantane: 'chaine', code_confirmation: 'chaine',
  confirmation: CONFIRMATION, fidelite_transmission: FIDELITE, relecteur_attribue: 'chaine', relecteur_egal_cloturer: 'booleen', provenances: T(PROVENANCE),
  nb_fichiers_decision: 'nombre', referentiel_version: 'chaine', moteur: MOTEUR, execution_cloture: N(EXECUTION_CLOTURE), source_decisions: 'chaine',
  generation: GENERATION_CHARGE, fin_saisie_le: N('chaine'), revoque_le: N('chaine'), levees: T(LEVEE), incidents_connus: T(INCIDENT),
  cloture_le: 'chaine', badge: BADGE, cle_id: 'chaine',
});

const CONTRATS = Object.freeze({
  'moteur-fonda/v1': MOTEUR,
  'coeur-decision-fonda/v1': COEUR,
  'recapitulatif-fonda/v1': RECAPITULATIF,
  'attestation-cloture/v1': ATTESTATION_V1,
  'generation-fonda/v1': GENERATION,
  'lot-complet-fonda/v1': LOT_COMPLET,
  'lot_relu-fonda/v1': LOT_RELU,
  'decision-fonda/v1': DECISION,
  'attestation-cloture/v2': ATTESTATION_V2,
});

// Énumère les chemins (ex. « cartes[].unite ») avec leur classe : 'chaine', 'nombre',
// 'booleen', 'chaine_ou_nombre', 'objet', 'tableau', et nullable (booléen à part).
// Un nullable expose aussi son contenu (champs d'un objet nullable, chemin inchangé).
function chemins(forme) {
  const sortie = [];
  const parcourir = (f, chemin, nullable) => {
    if (typeof f === 'string') { sortie.push({ chemin, classe: f, nullable }); return; }
    if (f.nullable !== undefined) { parcourir(f.nullable, chemin, true); return; }
    if (f.objet) {
      if (chemin) sortie.push({ chemin, classe: 'objet', nullable });
      for (const [k, v] of Object.entries(f.objet)) parcourir(v, chemin ? `${chemin}.${k}` : k, false);
      return;
    }
    if (f.tableau !== undefined) {
      sortie.push({ chemin, classe: 'tableau', nullable });
      parcourir(f.tableau, `${chemin}[]`, false);
      return;
    }
    throw new Error(`forme inconnue en ${chemin}`);
  };
  parcourir(forme, '', false);
  return sortie;
}

module.exports = { CONTRATS, chemins };
