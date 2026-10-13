// Migration ponctuelle (2026-10-13) vers les contrats lot-fonda/v1 + catalogue-fonda/v1
// (chaîne FONDA séparée de BOX). Conservé pour traçabilité ; idempotent (refuse de
// tourner si la migration est déjà faite).
//
//  - 8 lots RELUS (lot de validation T6b, 2026-10-11) -> fonda/data/lots/<set_id>.json
//    + une entrée chacun dans fonda/data/catalogue-fonda.json, attestation
//    « manuelle-historique » (déclarative : relu par Éric le 11/10, attesté par Éric) ;
//  - 8 lots NON relus : restent dans lots-fonda-calibration/, au même format, avec
//    revue_carte_par_carte: false, jamais référencés par le catalogue ;
//  - tous : liste BLANCHE de champs (plus de id box_…, prof_email, prof_nom,
//    code_suppression, relecteur, source, type) et set_id porté à la racine.
//
// Usage : node fonda/scripts/migrer-lots-v1.js

'use strict';

const fs = require('fs');
const path = require('path');
const C = require('../engine/catalogue.js');

const DATA = path.join(__dirname, '..', 'data');
const CALIB = path.join(DATA, 'lots-fonda-calibration');
const LOTS = path.join(DATA, 'lots');
const CATALOGUE = path.join(DATA, 'catalogue-fonda.json');
const DATE_ATTESTATION = '2026-10-13';

// Les 8 lots relus du lot de validation (ex-LOTS_PUBLIABLES de bootstrap.js).
const RELUS = [
  'fr-comprendre-consigne_nI', 'fr-comprendre-consigne_nF',
  'fr-inference-implicite_nI', 'fr-inference-implicite_nF',
  'maths-grandeurs-mesures_nI', 'maths-grandeurs-mesures_nF',
  'maths-resolution-problemes_nI', 'maths-resolution-problemes_nF',
];

// Modifications pédagogiques POSTÉRIEURES à la relecture du 11/10, vérifiées par
// comparaison avec l'état du merge 09d7b34 (clôture du lot de validation).
const MODIFS_POSTERIEURES = {
  'maths-resolution-problemes_nI': 'it05 : forme « 2 bus » retirée de reponses_acceptees',
  'maths-resolution-problemes_nF': 'it02 : forme « 40 livres » retirée ; it05 : forme « 8 victoires » retirée (reponses_acceptees)',
};

function versV1(ancien) {
  const setIds = [...new Set(ancien.cartes.map((c) => c.set_id))];
  if (setIds.length !== 1) throw new Error(`set_id non unique dans le lot ${ancien.id}`);
  const lot = {
    schema: C.SCHEMA_LOT,
    set_id: setIds[0],
    notion_id: ancien.cartes[0].notion_id,
    palier: ancien.cartes[0].palier,
    matiere: ancien.matiere,
    notion: ancien.notion,
    niveau: ancien.niveau,
    revue_carte_par_carte: ancien.revue_carte_par_carte === true,
    nb_cartes: ancien.cartes.length,
    date_creation: ancien.date_creation,
    cartes: ancien.cartes.map((c) => Object.fromEntries(C.CHAMPS_CARTE.filter((k) => k in c).map((k) => [k, c[k]]))),
  };
  const v = C.validerLot(lot);
  if (!v.valide) throw new Error(`${lot.set_id} : ${v.erreurs.join(' ; ')}`);
  return lot;
}

function provenance(nom) {
  const base = 'Lot de validation T6b, relu carte par carte par Éric le 2026-10-11 (AVANCEMENT-archive.md, sections « Lot de validation T6b » à « Clôture du lot de validation »). Attestation déclarative d\'Éric lors de la migration vers la chaîne FONDA séparée — ce n\'est pas une preuve technique. Empreinte calculée sur le contenu au jour de la migration.';
  const m = MODIFS_POSTERIEURES[nom];
  return m ? `${base} Modification pédagogique POSTÉRIEURE à la relecture, approuvée par Éric le 2026-10-12 (formes déclarées acceptées mais refusées par le correcteur) : ${m}.` : base;
}

async function main() {
  if (fs.existsSync(CATALOGUE)) throw new Error('catalogue-fonda.json existe déjà : migration déjà faite');
  const sha = C.sha256WebCrypto();
  const referentiel = JSON.parse(fs.readFileSync(path.join(DATA, 'referentiel.json'), 'utf8'));
  fs.mkdirSync(LOTS, { recursive: true });

  const entrees = [];
  for (const f of fs.readdirSync(CALIB).filter((x) => x.endsWith('.json')).sort()) {
    const nom = f.replace(/\.json$/, '');
    const lot = versV1(JSON.parse(fs.readFileSync(path.join(CALIB, f), 'utf8')));
    if (!RELUS.includes(nom)) {
      if (lot.revue_carte_par_carte) throw new Error(`${nom} marqué relu mais hors liste des relus`);
      fs.writeFileSync(path.join(CALIB, f), JSON.stringify(lot, null, 2) + '\n');
      continue;
    }
    if (!lot.revue_carte_par_carte) throw new Error(`${nom} attendu relu`);
    const notion = referentiel.notions.find((n) => n.id === lot.notion_id);
    const empreinte = await C.calculerEmpreinte(lot, sha);
    const itemIds = lot.cartes.map((c) => c.item_id);
    entrees.push({
      set_id: lot.set_id,
      notion_id: lot.notion_id,
      palier: lot.palier,
      fichier: `lots/${lot.set_id}.json`,
      item_ids: itemIds,
      empreinte,
      relecteur: { id: 'eric', nom_affiche: 'Éric Duchateau' },
      attestation: {
        type: 'manuelle-historique',
        relecture_declaree: { date: '2026-10-11', relu_par: 'eric', relecteur_attribue: notion.relecteur },
        atteste_par: 'eric',
        attestation_le: DATE_ATTESTATION,
        selection: itemIds,
        provenance: provenance(nom),
        empreinte_attestee: empreinte,
      },
    });
    fs.writeFileSync(path.join(LOTS, `${lot.set_id}.json`), JSON.stringify(lot, null, 2) + '\n');
    fs.unlinkSync(path.join(CALIB, f));
  }
  const ordre = new Map(referentiel.notions.map((n) => [n.id, n.ordre]));
  entrees.sort((a, b) => (ordre.get(a.notion_id) - ordre.get(b.notion_id)) || a.set_id.localeCompare(b.set_id));
  const catalogue = { schema: C.SCHEMA_CATALOGUE, lots: entrees };
  const v = C.validerCatalogue(catalogue, referentiel);
  if (!v.valide) throw new Error(v.erreurs.join(' ; '));
  fs.writeFileSync(CATALOGUE, JSON.stringify(catalogue, null, 2) + '\n');
  console.log(`migré : ${entrees.length} lots publiés, ${fs.readdirSync(CALIB).length} lots de calibration nettoyés`);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
