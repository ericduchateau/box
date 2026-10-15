// Publication d'un lot FONDA relu (chaîne séparée de BOX, PRD §2 bis) : « publier =
// commit ». Ce script prépare le commit — il n'appelle aucun réseau, ne touche ni Drive
// ni n8n. Il copie un lot RELU dans fonda/data/lots/<set_id>.json et ajoute son entrée
// à fonda/data/catalogue-fonda.json, SEULEMENT si :
//   - le lot respecte lot-fonda/v1, porte revue_carte_par_carte: true et repasse les
//     garde-fous du MOTEUR du lot (celui de la charge signée) ;
//   - une ATTESTATION « cloture-signee » (Type 2, CDC §11) l'accompagne et passe
//     fonda/scripts/attestation-signee.js, dans l'ordre fail-closed : forme ; clé
//     déclarée dans fonda/data/cles/cles.json, PEM intègre, recevable (période de
//     validité, jamais révoquée — §14) ; SIGNATURE RSA-SHA256 PKCS#1 v1.5 sur les
//     octets canoniques de la charge ; invariants de valeur ; invariants de dépôt ;
//   - le set_id n'est pas déjà publié et son fichier n'existe pas (anti-écrasement) ;
//   - le catalogue résultant reste valide contre le référentiel.
// « manuelle-historique » (Type 1) reste réservée aux 8 lots de la migration : jamais
// pour un nouveau lot. Tant que cles.json est vide (avant l'étape 4b), AUCUNE
// publication Type 2 réelle n'est possible : c'est voulu (fail-closed).
//
// FRONTIÈRE : ce script vérifie ce qui est vérifiable depuis la charge, le lot publié,
// l'entrée et la clé publique. Les invariants LOCAUX — sha256_instantane égal à
// l'instantané réel, partition selection/ecartees contre le candidat réel,
// rapprochement exécution n8n <-> lot — relèvent de signer-cloture.js (4b).
//
// Usage : node fonda/scripts/publier-lot.js <lot-relu.json> <attestation.json> [--dry-run]
// Ensuite : relire le diff, commit, PR (fonda/data/catalogue.test.js revérifie,
// signatures comprises).

'use strict';

const fs = require('fs');
const path = require('path');
const C = require('../engine/catalogue.js');
const { chargerMoteurNode, lireRegistre } = require('./moteurs.js');
const S = require('./attestation-signee.js');

const DATA = path.join(__dirname, '..', 'data');

function clesDuDepot() {
  return S.chargerCles(JSON.parse(fs.readFileSync(path.join(DATA, 'cles', 'cles.json'), 'utf8')), (f) => fs.readFileSync(path.join(DATA, f), 'utf8'));
}

/**
 * Pure (hors SHA-256 et clés injectés). Ne lit ni n'écrit aucun fichier.
 * @returns {Promise<{ok:true, entree, catalogue, fichier}|{ok:false, erreurs:string[]}>}
 */
async function preparerPublication({ lot, attestation, catalogue, referentiel, fichierExiste = () => false, sha256Hex, cles, registre = lireRegistre() }) {
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

  // 1. Attestation vérifiée EN ENTIER (forme -> clé -> signature -> valeurs -> dépôt)
  //    AVANT toute exécution de code pédagogique : le moteur n'est chargé qu'une fois
  //    la charge authentifiée et son moteur rapproché du registre.
  const charge = attestation.charge || {};
  const empreinte = await C.calculerEmpreinte(lot, sha256Hex);
  const moteurCharge = charge.moteur || {};
  const entree = {
    set_id: lot.set_id,
    notion_id: lot.notion_id,
    palier: lot.palier,
    fichier,
    item_ids: lot.cartes.map((c) => c.item_id),
    empreinte,
    moteur: { version: moteurCharge.version, sha256: moteurCharge.sha256 },
    relecteur: charge.badge,
    attestation,
  };
  const es = S.verifierAttestationSignee(attestation, { entree, registre, referentiel, cles });
  if (es.length) return { ok: false, erreurs: es };

  // 2. Garde-fous pédagogiques du MOTEUR DU LOT (celui de la charge authentifiée).
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
    cles: clesDuDepot(),
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

module.exports = { preparerPublication, clesDuDepot };

if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
