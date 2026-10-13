// Publication d'un lot FONDA relu (chaîne séparée de BOX, PRD §2 bis) : « publier =
// commit ». Ce script prépare le commit — il n'appelle aucun réseau, ne touche ni Drive
// ni n8n. Il copie un lot RELU dans fonda/data/lots/<set_id>.json et ajoute son entrée
// à fonda/data/catalogue-fonda.json, SEULEMENT si :
//   - le lot respecte lot-fonda/v1 (liste blanche : aucun secret ni coordonnée),
//     porte revue_carte_par_carte: true et repasse les garde-fous du MOTEUR du lot ;
//   - une ATTESTATION accompagne le lot, d'un type ACCEPTÉ, dont l'empreinte relue est
//     celle du fichier publié et dont la sélection correspond aux cartes du fichier ;
//   - le set_id n'est pas déjà publié et son fichier n'existe pas (anti-écrasement) ;
//   - le catalogue résultant reste valide contre le référentiel.
//
// Types d'attestation acceptés : AUCUN pour l'instant.
//   - « manuelle-historique » est réservée aux 8 lots du 11/10 (migration) : jamais pour
//     un nouveau lot ;
//   - « n8n-relecture » attend sa source de confiance indépendante du fichier (signature,
//     archive Drive), spécifiée et relue au bloc 2. Tant que ce n'est pas fait, la
//     publication est refusée : c'est voulu.
//
// Usage : node fonda/scripts/publier-lot.js <lot-relu.json> <attestation.json> [--dry-run]
// Ensuite : relire le diff, commit, PR (le test CI fonda/data/catalogue.test.js revérifie).

'use strict';

const fs = require('fs');
const path = require('path');
const C = require('../engine/catalogue.js');
const { dernierMoteur, chargerMoteurNode } = require('./moteurs.js');

const DATA = path.join(__dirname, '..', 'data');
const TYPES_ACCEPTES_PAR_DEFAUT = Object.freeze([]);

/**
 * Pure (hors SHA-256 injecté). Ne lit ni n'écrit aucun fichier.
 * @returns {Promise<{ok:true, entree, catalogue, fichier}|{ok:false, erreurs:string[]}>}
 */
// `moteur` ({ version, sha256 }) : moteur sous lequel le lot a été relu ; par défaut
// la dernière version enregistrée. (Étape 3 : il viendra de l'instantané signé.)
async function preparerPublication({ lot, attestation, catalogue, referentiel, fichierExiste = () => false, typesAcceptes = TYPES_ACCEPTES_PAR_DEFAUT, sha256Hex, moteur = dernierMoteur() }) {
  const erreurs = [];
  const v = C.validerLot(lot);
  if (!v.valide) return { ok: false, erreurs: v.erreurs.map((e) => `lot : ${e}`) };
  if (lot.revue_carte_par_carte !== true) erreurs.push('lot non relu (revue_carte_par_carte ≠ true)');
  let m;
  try { m = chargerMoteurNode(moteur.version, moteur.sha256); } catch (e) { return { ok: false, erreurs: [`moteur : ${e.message}`] }; }
  lot.cartes.forEach((c) => {
    const v0 = m.valider(c);
    if (!v0.valide) erreurs.push(`${c.item_id} : carte refusée par le moteur ${moteur.version} (${v0.raisons.join(', ')})`);
    const r1 = m.outils.verifierReponseOr(c);
    if (!r1.ok) erreurs.push(`${c.item_id} : ${r1.raison}`);
    const r2 = m.outils.verifierFormesAcceptees(c);
    if (!r2.ok) erreurs.push(`${c.item_id} : ${r2.raison}`);
  });

  if (!attestation || typeof attestation !== 'object') erreurs.push('attestation absente');
  else if (attestation.type === 'manuelle-historique') erreurs.push('attestation « manuelle-historique » réservée aux 8 lots de la migration du 2026-10-13');
  else if (!typesAcceptes.includes(attestation.type)) erreurs.push(`type d'attestation « ${attestation.type} » non accepté (source de confiance de la relecture n8n non encore spécifiée — bloc 2)`);

  if ((catalogue.lots || []).some((e) => e.set_id === lot.set_id)) erreurs.push(`set_id ${lot.set_id} déjà publié : une entrée publiée est immuable (nouvelle version = nouveau set_id + nouvelle relecture)`);
  const fichier = `lots/${lot.set_id}.json`;
  if (fichierExiste(fichier)) erreurs.push(`${fichier} existe déjà : refus d'écraser`);
  if (erreurs.length) return { ok: false, erreurs };

  const empreinte = await C.calculerEmpreinte(lot, sha256Hex);
  const itemIds = lot.cartes.map((c) => c.item_id);
  if (attestation.empreinte_relue !== empreinte) erreurs.push('empreinte relue ≠ empreinte du fichier (contenu modifié après relecture)');
  if (JSON.stringify(attestation.selection) !== JSON.stringify(itemIds)) erreurs.push('sélection attestée ≠ cartes du fichier');
  const notion = (referentiel.notions || []).find((n) => n.id === lot.notion_id);
  if (!notion) erreurs.push('notion_id absent du référentiel');
  if (erreurs.length) return { ok: false, erreurs };

  // Badge (CDC §12) : tiers ayant confirmé -> « relue_et_validee ». Les formes
  // « relue_par » (auto-confirmation, sans nom) viendront de la charge signée (étape 3).
  const r = attestation.relecteur;
  const relecteur = (r && r.id && r.nom_affiche) ? { forme: 'relue_et_validee', nom_affiche: r.nom_affiche, id: r.id } : null;
  const entree = {
    set_id: lot.set_id,
    notion_id: lot.notion_id,
    palier: lot.palier,
    fichier,
    item_ids: itemIds,
    empreinte,
    moteur: { version: moteur.version, sha256: moteur.sha256 },
    relecteur,
    attestation: { ...attestation, empreinte_attestee: empreinte },
  };
  const nouveau = { ...catalogue, lots: [...catalogue.lots, entree] };
  const vc = C.validerCatalogue(nouveau, referentiel);
  if (!vc.valide) return { ok: false, erreurs: vc.erreurs };
  return { ok: true, entree, catalogue: nouveau, fichier };
}

async function main() {
  const [cheminLot, cheminAttestation] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const dryRun = process.argv.includes('--dry-run');
  if (!cheminLot || !cheminAttestation) {
    console.error('Usage : node fonda/scripts/publier-lot.js <lot-relu.json> <attestation.json> [--dry-run]');
    process.exitCode = 1;
    return;
  }
  const lire = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
  const catalogue = lire(path.join(DATA, 'catalogue-fonda.json'));
  const r = await preparerPublication({
    lot: lire(cheminLot),
    attestation: lire(cheminAttestation),
    catalogue,
    referentiel: lire(path.join(DATA, 'referentiel.json')),
    fichierExiste: (f) => fs.existsSync(path.join(DATA, f)),
    sha256Hex: C.sha256WebCrypto(),
  });
  if (!r.ok) {
    console.error('✗ Publication refusée :');
    r.erreurs.forEach((e) => console.error(`  - ${e}`));
    process.exitCode = 1;
    return;
  }
  if (dryRun) { console.log(`✓ (dry-run) ${r.entree.set_id} publiable — rien écrit.`); return; }
  fs.writeFileSync(path.join(DATA, r.fichier), fs.readFileSync(cheminLot, 'utf8'), { flag: 'wx' });
  fs.writeFileSync(path.join(DATA, 'catalogue-fonda.json'), JSON.stringify(r.catalogue, null, 2) + '\n');
  console.log(`✓ ${r.entree.set_id} ajouté — relire le diff, puis commit + PR.`);
}

module.exports = { preparerPublication, TYPES_ACCEPTES_PAR_DEFAUT };

if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
