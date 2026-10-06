# T-SEC (2026-10-06) — Sécurisation de la publication, procédure d'import/test/bascule

Ticket T-SEC, déclenché par une critique Codex sur la SPEC T6b : 5 correctifs sur des workflows **existants**, livrés en JSON, importés et testés par Éric lui-même — rien n'a été touché dans n8n depuis cette session. `BOX - Rejet Prof` est **strictement inchangé**, aucun fichier ne le concerne.

**Révisé après une critique Codex de confirmation** (sur la 1ʳᵉ version, commit `0ec2522`) qui a trouvé 6 défauts dans cette 1ʳᵉ version elle-même : secret HMAC non réellement configuré (mauvaise version du nœud `Crypto`), câblage cassé du GET `box-select` (deux branches vers un même nœud, sans fusion), `c.numero` non échappé, liens email des copies de TEST pointant vers la **prod**, `responseCode` mal placé (jamais un vrai 404), et une procédure de test incohérente avec le double filet du catalogue. **Tous corrigés dans cette version.** Rien n'a été importé entre les deux versions.

## Les 5 correctifs

1. **`box-validate` refuse les jeux Box-FONDA non relus** : `type === "fonda"` ET `revue_carte_par_carte !== true` → refus. Toute autre combinaison (y compris absence des deux champs = ancien jeu) → publié comme avant. *(`box-validation-prof.json`)*
2. **`revue_carte_par_carte`** : posé à `false` par les deux générations (`box-generation-flashcards.json`, `box-generation-tally.json`) ; posé à `true` **uniquement** par `box-select-confirm` au moment de la publication filtrée. *(4 fichiers)*
3. **Jeton HMAC-SHA256 anti-POST-direct** sur `box-select-confirm` : la page `box-select` calcule un jeton (nœud `Crypto` **v2** — c'est la version qui lit réellement le secret depuis la credential `crypto`, v1 ignore cette credential) lié à `(file_id, code)` et l'embarque en champ caché ; la confirmation recalcule le même jeton et refuse si absent/différent. Calcul placé en **chaîne strictement séquentielle** avant le téléchargement Drive (pas deux branches parallèles sans fusion). *(`box-selection-prof.json`)*
4. **Échappement HTML** de `question`/`reponse`/`difficulte`/`matiere`/`niveau`/`notion`/**`numero`** dans la page de relecture `box-select`, et de `notion` dans les pages de succès/rejet après confirmation. *(`box-selection-prof.json`)*
5. **`box-set` vérifie la présence au catalogue** avant de servir une fiche — vrai `404` (`options.responseCode`, pas un paramètre de 1er niveau ignoré) sinon. *(`box-fiche-api.json`)*

**🔖 Dette inscrite, pas traitée ici** : le jeton HMAC prouve qu'un jeton a été obtenu pour `(file_id, code)` — il n'est ni daté (pas d'expiration), ni lié au contenu précis des cartes présentées. Il n'atteste donc pas qu'une relecture humaine a effectivement eu lieu sur cette version exacte du fichier, seulement qu'une requête a transité par la page GET. Durcissement de 2e niveau (expiration, liaison à un hash du contenu) à envisager plus tard si le besoin se confirme.

## Fichiers livrés

```
n8n/t-sec-2026-10-06/
  test/   — copies de TEST (webhooks en /…-test, CATALOGUE_TEST_ID, écriture catalogue neutralisée)
  prod/   — versions corrigées des workflows réels (même id, vrai catalogue) — à n'importer qu'après tests concluants
```

| Workflow réel | Correctif(s) | Copie de test |
|---|---|---|
| `BOX - Generation Flashcards` | #2, #4 (lien email) | `box-generation-flashcards-TEST.json` (déclenchement manuel, trigger Sheets remplacé) |
| `BOX - Generation Tally` | #2, #4 (lien email) | `box-generation-tally-TEST.json` (webhook `/box-tally-test`) |
| `BOX - Validation Prof` | #1 | `box-validation-prof-TEST.json` (webhook `/box-validate-test`) |
| `BOX - Selection Prof` | #2, #3, #4 | `box-selection-prof-TEST.json` (webhooks `/box-select-test`, `/box-select-confirm-test`) |
| `BOX - Fiche API` | #5 | `box-fiche-api-TEST.json` (webhook `/box-set-test`) |
| `BOX - Rejet Prof` | — | *(aucun fichier, inchangé)* |

## Avant tout import — deux prérequis

1. **Catalogue de test** : déjà fait de ton côté (`catalogue-TEST.json` dupliqué sur Drive). Note son id — tu le colleras dans chaque nœud `Download Catalogue (TEST)` (`CATALOGUE_TEST_ID`, 3 occurrences : `box-validation-prof-TEST.json`, `box-selection-prof-TEST.json`, `box-fiche-api-TEST.json`).
2. **Credential Crypto de test** : dans n8n, créer une credential de type **Crypto**, nommée par exemple `Box-FONDA secret relecture (TEST)`, avec un secret aléatoire (ex. généré en local avec `openssl rand -hex 32`, jamais tapé ici ni collé nulle part ailleurs que dans ce champ n8n). Attacher **cette même credential** aux deux nœuds `Calculer Token` et `Recalculer Token` de `box-selection-prof-TEST.json` après import (ils référencent actuellement un id `CRYPTO_SECRET_CREDENTIAL_ID_TEST` qui n'existe pas encore chez toi — n8n te demandera de la choisir à l'import ou juste après).

## ⚠️ Le catalogue de TEST n'est JAMAIS réellement écrit (double filet voulu)

Dans les 3 copies de TEST qui touchent le catalogue, le nœud qui écrirait réellement (`Upload Catalogue`) est **remplacé** par un nœud qui se contente de logger le payload et de passer la main — par sécurité, même si `CATALOGUE_TEST_ID` était collé de travers, aucune écriture ne peut jamais toucher le vrai catalogue. **Conséquence directe : `catalogue-TEST.json` ne contiendra jamais une entrée "publiée" pendant tes tests**, quel que soit le nombre de fois où tu valides/confirmes un jeu de test. Les vérifications ci-dessous sont construites autour de ce fait, pas autour d'une fausse promesse de persistance.

## Procédure de test — ordre et vérifications

**Étape 1 — `box-generation-flashcards-TEST.json`**
Importer. Dans le nœud `Simuler une ligne du Sheet (TEST)`, remplacer `PROF_EMAIL_TEST_A_REMPLACER` (mets ta propre adresse) et `FICHIER_PDF_TEST_ID_A_REMPLACER` (un vrai PDF de test sur ton Drive). Exécuter manuellement (bouton *Execute workflow*).
✅ Vérifier : le fichier JSON déposé sur Drive contient `"revue_carte_par_carte": false` et **pas** de champ `type`. L'email reçu contient un lien vers `/box-select-test` (**pas** `/box-select`). Note le `file_id` (Drive) et le `code_suppression` — tu en as besoin pour l'étape 2.

**Étape 2 — `box-validation-prof-TEST.json`**
Importer, coller `CATALOGUE_TEST_ID` dans `Download Catalogue (TEST)`.
Test A (jeu ordinaire) : ouvrir `https://n8n.srv868991.hstgr.cloud/webhook/box-validate-test?file_id=<celui de l'étape 1>&code=<code_suppression>`.
✅ Doit se terminer **sans erreur** (page de succès, email de confirmation de test) — c'est le passage de la vérification `Verifier code` qui compte ici, **pas** une vraie entrée persistée au catalogue (voir l'avertissement ci-dessus).
Test B (jeu FONDA non relu) : éditer à la main le fichier JSON sur Drive, ajouter `"type": "fonda"` (laisser `revue_carte_par_carte: false`), relancer le même lien.
✅ Doit être **refusé** avec le message "Ce jeu Box-FONDA doit être relu carte par carte...".

**Étape 3 — `box-selection-prof-TEST.json`**
Importer, coller `CATALOGUE_TEST_ID` dans `Download Catalogue (TEST)`, attacher la credential Crypto de TEST aux 2 nœuds `Calculer Token` et `Recalculer Token`.
Préparer un fichier de test dont une carte contient volontairement `question: "<script>alert(1)</script>"` et `numero: "1\"><img src=x onerror=alert(1)>"` (ou le fichier de l'étape 1, modifié à la main).
Test A (échappement) : ouvrir `GET /box-select-test?file_id=...&code=...` → ✅ le HTML source doit contenir `&lt;script&gt;` (jamais `<script>` brut) et le numéro doit apparaître comme texte inoffensif, jamais casser l'attribut `value="..."`.
Test B (parcours normal) : décocher une carte, soumettre → ✅ le workflow se termine normalement (page de succès) ; le fichier **filtré** sur Drive (`Upload Flashcards Filtrees`, pas le catalogue) porte désormais `"revue_carte_par_carte": true` — celui-ci est bien écrit pour de vrai, seul le catalogue est neutralisé.
Test C (anti-CSRF) : avec `curl`, poster directement sur `/webhook/box-select-confirm-test` (`file_id`, `code`, `cartes[]`) **sans** le champ `token` → ✅ doit être refusé ("Lien expiré ou invalide..."), jamais publié.

**Étape 4 — `box-fiche-api-TEST.json`**
Importer, coller `CATALOGUE_TEST_ID` dans `Download Catalogue (TEST)`. Comme `catalogue-TEST.json` reste vide (étapes précédentes neutralisées), **ajoute toi-même une entrée à la main** dans `catalogue-TEST.json` sur Drive : `{ "drive_file_id": "<file_id du fichier filtré de l'étape 3>", ... }` (les autres champs importent peu pour ce test).
Test A : `GET /box-set-test?file_id=<ce même file_id>` → ✅ sert la fiche normalement (code 200).
Test B : `GET /box-set-test?file_id=<un file_id qui n'est pas dans catalogue-TEST.json>` → ✅ vrai code HTTP **404**, corps `{"error":"Fiche non publiee ou introuvable."}`.

**Étape 5 — `box-generation-tally-TEST.json`**
Importer. Déclencher manuellement (via *Listen for test event* sur le webhook `/box-tally-test` + un POST de test, ou en épinglant une exécution).
✅ Vérifier que `revue_carte_par_carte: false` est bien posé sur le fichier produit, et que l'email contient un lien vers `/box-select-test` (pas `/box-select`).

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
