# T-SEC (2026-10-06) — Sécurisation de la publication, procédure d'import/test/bascule

Ticket T-SEC, déclenché par une critique Codex sur la SPEC T6b : 5 correctifs sur des workflows **existants**, livrés en JSON, importés et testés par Éric lui-même — rien n'a été touché dans n8n depuis cette session. `BOX - Rejet Prof` est **strictement inchangé**, aucun fichier ne le concerne.

## Les 5 correctifs

1. **`box-validate` refuse les jeux Box-FONDA non relus** : `type === "fonda"` ET `revue_carte_par_carte !== true` → refus. Toute autre combinaison (y compris absence des deux champs = ancien jeu) → publié comme avant. *(`box-validation-prof.json`)*
2. **`revue_carte_par_carte`** : posé à `false` par les deux générations (`box-generation-flashcards.json`, `box-generation-tally.json`) ; posé à `true` **uniquement** par `box-select-confirm` au moment de la publication filtrée. *(4 fichiers)*
3. **Jeton HMAC-SHA256 anti-POST-direct** sur `box-select-confirm` : la page `box-select` calcule un jeton (nœud `Crypto`, action `hmac`) lié à `(file_id, code)` et l'embarque en champ caché ; la confirmation recalcule le même jeton et refuse si absent/différent. *(`box-selection-prof.json`)*
4. **Échappement HTML** de `question`/`reponse`/`difficulte`/`matiere`/`niveau`/`notion` dans la page de relecture `box-select`. *(`box-selection-prof.json`)*
5. **`box-set` vérifie la présence au catalogue** avant de servir une fiche — 404 sinon. *(`box-fiche-api.json`)*

## Fichiers livrés

```
n8n/t-sec-2026-10-06/
  test/   — copies de TEST (webhooks en /…-test, CATALOGUE_TEST_ID, écriture catalogue neutralisée)
  prod/   — versions corrigées des workflows réels (même id, vrai catalogue) — à n'importer qu'après tests concluants
```

| Workflow réel | Correctif(s) | Copie de test |
|---|---|---|
| `BOX - Generation Flashcards` | #2 | `box-generation-flashcards-TEST.json` (déclenchement manuel, trigger Sheets remplacé) |
| `BOX - Generation Tally` | #2 | `box-generation-tally-TEST.json` (webhook `/box-tally-test`) |
| `BOX - Validation Prof` | #1 | `box-validation-prof-TEST.json` (webhook `/box-validate-test`) |
| `BOX - Selection Prof` | #2, #3, #4 | `box-selection-prof-TEST.json` (webhooks `/box-select-test`, `/box-select-confirm-test`) |
| `BOX - Fiche API` | #5 | `box-fiche-api-TEST.json` (webhook `/box-set-test`) |
| `BOX - Rejet Prof` | — | *(aucun fichier, inchangé)* |

## Avant tout import — deux prérequis

1. **Catalogue de test** : déjà fait de ton côté (`catalogue-TEST.json` dupliqué sur Drive). Note son id — tu le colleras dans chaque nœud `Download Catalogue (TEST)` (actuellement `CATALOGUE_TEST_ID`, 3 occurrences : `box-validation-prof-TEST.json`, `box-selection-prof-TEST.json`, `box-fiche-api-TEST.json`).
2. **Credential Crypto de test** : dans n8n, créer une credential de type **Crypto**, nommée par exemple `Box-FONDA secret relecture (TEST)`, avec un secret aléatoire (ex. généré en local avec `openssl rand -hex 32`, jamais tapé ici ni collé nulle part ailleurs que dans ce champ n8n). Attacher **cette même credential** aux deux nœuds `Calculer Token` et `Recalculer Token` de `box-selection-prof-TEST.json` après import (ils référencent actuellement un id `CRYPTO_SECRET_CREDENTIAL_ID_TEST` qui n'existe pas encore chez toi — n8n te demandera de la choisir à l'import ou juste après).

## Procédure de test — ordre et vérifications

**Étape 1 — `box-generation-flashcards-TEST.json`**
Importer. Dans le nœud `Simuler une ligne du Sheet (TEST)`, remplacer `PROF_EMAIL_TEST_A_REMPLACER` (mets ta propre adresse) et `FICHIER_PDF_TEST_ID_A_REMPLACER` (un vrai PDF de test sur ton Drive). Exécuter manuellement (bouton *Execute workflow*).
✅ Vérifier : le fichier JSON déposé sur Drive contient `"revue_carte_par_carte": false` et **pas** de champ `type`. Note son `file_id` (Drive) et son `code_suppression` — tu en as besoin pour l'étape 2.

**Étape 2 — `box-validation-prof-TEST.json`**
Importer, coller `CATALOGUE_TEST_ID` dans `Download Catalogue (TEST)`.
Test A (jeu ordinaire) : ouvrir `https://n8n.srv868991.hstgr.cloud/webhook/box-validate-test?file_id=<celui de l'étape 1>&code=<code_suppression>`.
✅ Doit publier normalement (comme avant) — le catalogue de TEST reçoit l'entrée, email de confirmation (de test) reçu.
Test B (jeu FONDA non relu) : éditer à la main le fichier JSON sur Drive, ajouter `"type": "fonda"` (laisser `revue_carte_par_carte: false`), relancer le même lien.
✅ Doit être **refusé** avec le message "Ce jeu Box-FONDA doit être relu carte par carte...".

**Étape 3 — `box-selection-prof-TEST.json`**
Importer, coller `CATALOGUE_TEST_ID` dans `Download Catalogue (TEST)`, attacher la credential Crypto de test aux 2 nœuds `Calculer/Recalculer Token`.
Préparer un fichier de test dont une carte contient volontairement `<script>alert(1)</script>` dans `question` ou `reponse` (ou le fichier de l'étape 1, en modifiant une carte à la main).
Test A (échappement) : ouvrir `GET /box-select-test?file_id=...&code=...` → ✅ le texte `<script>...</script>` doit apparaître **tel quel, affiché comme texte**, jamais exécuté.
Test B (parcours normal) : décocher une carte, soumettre → ✅ publication OK, le fichier filtré sur Drive porte désormais `"revue_carte_par_carte": true`.
Test C (anti-CSRF) : avec `curl`, poster directement sur `/webhook/box-select-confirm-test` (`file_id`, `code`, `cartes[]`) **sans** le champ `token` → ✅ doit être refusé ("Lien expiré ou invalide..."), jamais publié.

**Étape 4 — `box-fiche-api-TEST.json`**
Importer, coller `CATALOGUE_TEST_ID`.
Test A : `GET /box-set-test?file_id=<celui publié à l'étape 3>` → ✅ sert la fiche normalement.
Test B : `GET /box-set-test?file_id=<un file_id jamais publié>` → ✅ 404 "Fiche non publiée ou introuvable."

**Étape 5 — `box-generation-tally-TEST.json`**
Importer. Déclencher manuellement (via *Listen for test event* sur le webhook `/box-tally-test` + un POST de test, ou en épinglant une exécution). Vérifier uniquement que `revue_carte_par_carte: false` est bien posé sur le fichier produit — le reste du flux est inchangé.

## Bascule en prod — seulement après ces 5 étapes concluantes

1. Créer la **vraie** credential Crypto (`Box-FONDA secret relecture`), secret **différent** de celui de test, jamais réutilisé.
2. Pour chacun des 5 workflows réels (sauf `BOX - Rejet Prof`) : **avant de toucher au live**, réexporte-le une dernière fois (sauvegarde fraîche, au cas où) — puis applique le contenu du fichier correspondant dans `prod/` (même `id` de workflow, pensé pour remplacer l'existant, pas pour créer un doublon).
3. Sur `BOX - Selection Prof`, attacher la **vraie** credential Crypto (pas celle de test) aux nœuds `Calculer Token` et `Recalculer Token`.
4. Sur les 3 workflows touchant le catalogue (`box-validation-prof`, `box-selection-prof`, `box-fiche-api`), vérifier que `Download Catalogue` pointe bien sur le **vrai** id (`1AmmMsO3nh4h0GQ0I5XzIqWG_zHA9wopa`) — c'est déjà le cas dans les fichiers `prod/`, aucune substitution à faire ici.
5. Réactiver chaque workflow modifié (il repart avec le même statut `active` qu'avant ta manipulation si tu utilises le remplacement en place ; vérifie-le quand même).
6. Test de fumée en prod, **sans donnée élève** : relancer un vrai lien `box-select` existant (un email déjà reçu par toi) pour un jeu ordinaire récent, confirmer que la publication fonctionne exactement comme avant (règle d'or : aucune différence visible pour un collègue).
7. Les copies `(TEST)` peuvent rester désactivées en l'état (référence) ou être supprimées — ton choix, aucune ne doit rester **active**.

## Rappel garde-fou (AGENTS.md)

Rien de ceci n'a été importé, activé ni modifié dans l'instance n8n par cette session — uniquement des fichiers JSON dans ce dépôt. Toute bascule en prod reste ton geste, après tes propres tests sur les copies `(TEST)`.
