// Moteur de correction Box-FONDA — carte « réponse produite » (T2).
// Référence : docs/PRD-Box-FONDA.md §5.1. Zéro dépendance (Node natif).
// Révisé le 2026-10-05 (2 passes suite critiques Codex — voir AVANCEMENT.md).
//
// Schéma de carte attendu (champs utilisés par ce module, sur-ensemble de PRD §3.6) :
//   profil_correction : "sens" | "orthographe" | "numerique" | "exact"
//   reponses_acceptees : string[]   — formes justes déclarées par le générateur/le relecteur
//   unite  (numerique seulement, optionnel, défaut null) — AJOUT non détaillé par le PRD :
//     si renseignée (ex. "cm"), l'unité est exigée, comparaison SENSIBLE À LA CASSE
//     (mA ≠ MA — la casse des préfixes change la grandeur) :
//       - absente                  -> "presque" (valeur correcte, unité oubliée)
//       - présente mais différente -> "faux" (valeur correcte, mais grandeur fausse)
//       - présente et identique    -> "juste"
//     si non renseignée (null), AUCUN reliquat alphabétique n'est toléré dans la
//     réponse : "8" est juste pour attendu "8", mais "8 banane" est faux.
//     L'unité exigée passe par la même canonisation typographique/exposants que la
//     saisie de l'élève (symétrie) : "cm²" et "cm2" sont la même unité, des deux côtés.
//   arrondi (numerique seulement, optionnel, défaut null) — AJOUT non détaillé par le PRD :
//     entier 0 <= n <= 10 = nombre de décimales. La CIBLE (valeur attendue) est
//     arrondie à n décimales (demi vers le haut, sans l'artefact binaire de
//     toFixed/Math.round naïf) ; l'élève doit produire EXACTEMENT cette cible (1/3
//     avec arrondi:2 -> cible 0,33 ; taper "1/3" ou "0,333" est alors faux).
//     Toute valeur invalide (hors [0,10], non entière, mauvais type) retombe
//     silencieusement sur la comparaison exacte (jamais d'exception).
//
// Garde-fou global : une entrée aberrante (nombre non fini, profil inconnu, type
// inattendu) renvoie toujours "faux" — jamais d'exception, jamais "juste" par défaut.
//
// Levenshtein (faute de frappe à 1 lettre) : volontairement absent de ce module —

// DEPUIS LE MOTEUR VERSIONNÉ (CDC relecture §4, migration M1) : ce fichier n'est
// plus qu'une FAÇADE Node. Le corps du correcteur vit, recopié à l'identique, dans
// fonda/engine/moteur-correction-v1.js (fichier immuable, chargé par l'élève avec
// SRI). Les scripts et tests qui font require('./correction.js') éprouvent donc
// exactement le code exécuté par l'élève. Plus chargé dans le navigateur.
'use strict';

if (typeof module === 'object' && module.exports) {
  module.exports = require('./moteur-correction-v1.js').correction;
}
