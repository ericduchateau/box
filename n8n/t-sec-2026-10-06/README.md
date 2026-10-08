# T-SEC (2026-10-06) — Sécurisation de la publication, procédure d'import/test/bascule

Ticket T-SEC, déclenché par une critique Codex sur la SPEC T6b : 5 correctifs sur des workflows **existants**, livrés en JSON, importés et testés par Éric lui-même — rien n'a été touché dans n8n depuis cette session. `BOX - Rejet Prof` est **strictement inchangé**, aucun fichier ne le concerne.

**Révisé après une critique Codex de confirmation** (sur la 1ʳᵉ version, commit `0ec2522`) qui a trouvé 6 défauts dans cette 1ʳᵉ version elle-même : secret HMAC non réellement configuré (mauvaise version du nœud `Crypto`), câblage cassé du GET `box-select` (deux branches vers un même nœud, sans fusion), `c.numero` non échappé, liens email des copies de TEST pointant vers la **prod**, `responseCode` mal placé (jamais un vrai 404), et une procédure de test incohérente avec le double filet du catalogue. **Tous corrigés.**

**Révisé une 2ᵉ fois après une 2ᵉ critique de confirmation** (commit `77dff11`) qui a validé les 6 points mais trouvé 2 oublis **hors du périmètre initial** des 6 points : la page de succès de l'ancien lien `/box-validate` (jamais retouchée depuis le tout premier commit) interpolait `notion` sans échappement, et les emails HTML (page de relecture + aperçus des 2 générations) interpolaient `notion`/`numero` sans échappement malgré `emailType: "html"`. **Balayage complet refait** sur les 4 workflows qui produisent du HTML (pages ET emails).

**Révisé une 3ᵉ fois après une critique de confirmation ciblée uniquement sur l'échappement** (commit `1e720f6`) qui a trouvé 3 défauts supplémentaires, découverts par une recherche exhaustive incluant les expressions n8n `{{ }}` (pas seulement les template literals JS) : (1) `nb_cartes` dans `box-validation-prof.json` n'était pas *garanti* numérique (`flashcards.nb_cartes || flashcards.cartes.length` laisse passer une chaîne si le champ existe et n'est pas vide) — corrigé en forçant via `Number.isFinite`/`Array.isArray` à la source, plutôt qu'en échappant un nombre (ce qui n'aurait pas de sens) ; (2) les deux générations acceptaient `cartes` comme un objet non-tableau avec une fausse propriété `length` (`cartes.length === 0` ne rejette pas `{length: "<script>"}`) — corrigé par un vrai `Array.isArray(parsed.cartes)` ; (3) les emails d'erreur (`Email Erreur`, `Email Erreur Generation`, hors du périmètre JS puisqu'ils utilisent des expressions n8n `{{ }}` dans `parameters.message`) interpolaient `notion`/`matiere`/`error` bruts — corrigé en ajoutant des champs `_html` pré-échappés en amont (même principe que `notion_html`) et en pointant les expressions vers ces champs. **Tous corrigés et revérifiés par exécution locale.** Rien n'a été importé entre les versions.

## Les 5 correctifs

1. **`box-validate` refuse les jeux Box-FONDA non relus** : `type === "fonda"` ET `revue_carte_par_carte !== true` → refus. Toute autre combinaison (y compris absence des deux champs = ancien jeu) → publié comme avant. *(`box-validation-prof.json`)*
2. **`revue_carte_par_carte`** : posé à `false` par les deux générations (`box-generation-flashcards.json`, `box-generation-tally.json`) ; posé à `true` **uniquement** par `box-select-confirm` au moment de la publication filtrée. *(4 fichiers)*
3. **Jeton anti-POST-direct** sur `box-select-confirm` : la page `box-select` génère un jeton aléatoire et l'embarque en champ caché ; la confirmation refuse si le jeton reçu diffère de celui stocké. *(`box-selection-prof.json`)*

   **Historique des révisions de ce correctif (toutes sur la copie TEST, jamais sur la prod)** :
   - *v1* : nœud `Crypto` v2 (HMAC-SHA256) + credential de type `crypto`. Abandonné : ce type de credential n'existe pas comme type créable dans n8n (confirmé côté UI ET API — `getSchema` renvoie `NOT_FOUND` pour `crypto`/`cryptoApi`).
   - *v2* : nœud Code natif, `require('crypto').createHmac(...)`, secret en dur dans le code. Abandonné : l'instance d'Éric (n8n 2.6.3 self-hosted) interdit `require('crypto')` dans un nœud Code (`NODE_FUNCTION_ALLOW_BUILTIN` non configuré, et il ne voulait pas toucher la config serveur).
   - *v3 (actuelle)* : **jeton aléatoire opaque, pas de HMAC, pas de secret du tout.** Au GET, le nœud natif `Crypto` (action **`Generate`** — n'exige aucune credential, contrairement à `hmac`/`sign`/`encrypt`/`decrypt`) tire 32 octets aléatoires (`stringLength: 64` en encodage hex — n8n fait `randomBytes(stringLength).toString('hex').slice(0, stringLength)`, donc `stringLength` doit être le nombre de **caractères hex voulus**, pas d'octets : 64 ⇒ 64 caractères hex ⇒ 32 octets réels). Ce jeton est **écrit dans le fichier flashcards sur Drive** (`review_token`, nouveau champ) avant de construire la page, et embarqué dans le formulaire caché. La confirmation relit le fichier et compare le jeton reçu à `review_token` par égalité stricte — puis le retire de l'objet republié. Aucun secret stocké nulle part, donc plus de problème de credential, de sandbox JS, ni de risque de fuite Git d'un secret (la section "Secret HMAC" ci-dessous est devenue obsolète, conservée pour archive).
   - **Effet de bord accepté** : chaque chargement de la page `box-select` réécrit le fichier avec un nouveau jeton — recharger la page ou l'ouvrir dans un 2ᵉ onglet invalide l'onglet précédent (soumission refusée avec "Lien expiré ou invalide..."). Acceptable en test. À surveiller en prod : gênant si un prof ouvre plusieurs fois son lien avant de valider — pas bloquant, mais un inconfort à améliorer plus tard (ex. tolérer les N derniers jetons au lieu d'un seul).
   - **Fuite corrigée** : `review_token` est désormais retiré par `box-fiche-api` (`Parse et nettoyer`) avant de servir une fiche via `/box-set`, exactement comme `prof_email`/`code_suppression` — sinon un jeton resté par erreur dans un fichier publié aurait été exposé publiquement. Corrigé dans `box-fiche-api-TEST.json` **et** `prod/box-fiche-api.json` (fichier seulement, prod n8n non touchée).
   - **Rejet rendu terminal (2026-10-07, critique Codex)** : décocher toutes les cartes et soumettre vidait l'objet en mémoire mais la mise à la corbeille (`Supprimer fichier`) ne vide pas le contenu du fichier — tant qu'il n'est pas purgé définitivement par Drive, il restait techniquement rejouable avec le même code+jeton. Nouveau nœud `Vider fichier avant suppression` (PATCH, même motif que `Upload Flashcards Filtrees`) qui écrase le contenu (`cartes:[]`, pas de `review_token`, déjà ce que produit `Verifier et filtrer`) **avant** la mise à la corbeille.
   - **`Cache-Control: no-store` ajouté** (2026-10-07, critique Codex) sur `Repondre Page Selection` — la page contient `code` et `review_token` en clair, pas de raison de laisser un cache la conserver.
   - **Dette acceptée, non corrigée (critique Codex du 2026-10-07)** : deux angles morts de concurrence restent possibles — (1) deux POST concurrents sur le même fichier peuvent tous deux passer la vérification du jeton avant que le premier ne le consomme (pas de verrou/transaction) ; (2) un GET concurrent à un POST peut réécrire tout le contenu du fichier à partir d'un état lu avant la publication, ressuscitant des cartes pourtant écartées. Les deux exigent de connaître déjà `file_id`+`code`+un jeton valide (donc le prof lui-même avec deux onglets, pas un visiteur anonyme), et n'ont pas de conséquence au-delà d'un jeu de fiches mal filtré pour ce cas précis — acceptés tels quels, pas de correctif prévu pour l'instant.
4. **Échappement HTML complet** — tout champ texte libre (`question`/`reponse`/`difficulte`/`matiere`/`niveau`/`notion`/`numero`), **dans toutes les pages ET tous les emails HTML**, pas seulement la page de relecture : `box-select` (page + confirmation), l'ancien `/box-validate` (page de succès), et les aperçus email des 2 workflows de génération. Balayage complet, voir tableau dédié ci-dessous. *(4 fichiers)*
5. **`box-set` vérifie la présence au catalogue** avant de servir une fiche — vrai `404` (`options.responseCode`, pas un paramètre de 1er niveau ignoré) sinon. *(`box-fiche-api.json`)* — **Ajout (2026-10-07)** : `Parse et nettoyer` retire aussi `review_token` avant de servir une fiche (même traitement que `prof_email`/`code_suppression`), pour que le jeton anti-CSRF du correctif #3 (v3) ne puisse jamais fuiter publiquement via `/box-set`. Corrigé dans `box-fiche-api-TEST.json` et `prod/box-fiche-api.json` (fichier seulement, live prod non touchée).

**🔖 Dette inscrite, pas traitée ici** : le jeton HMAC prouve qu'un jeton a été obtenu pour `(file_id, code)` — il n'est ni daté (pas d'expiration), ni lié au contenu précis des cartes présentées. Il n'atteste donc pas qu'une relecture humaine a effectivement eu lieu sur cette version exacte du fichier, seulement qu'une requête a transité par la page GET. Durcissement de 2e niveau (expiration, liaison à un hash du contenu) à envisager plus tard si le besoin se confirme.

## Balayage complet de l'échappement HTML (pages + emails)

Même fonction `escapeHtml()` (dupliquée dans chaque nœud, les nœuds n8n ne partagent pas de scope) partout — aucune variante. Tout point d'interpolation `${…}` dans un template HTML, sur les 4 workflows qui en produisent, listé et classé : **échappé**, ou **sûr** (nombre calculé par notre propre code, jamais du texte issu du formulaire/de la génération/du fichier Drive).

| Fichier / nœud | Champ interpolé | Statut |
|---|---|---|
| `box-validation-prof.json` → `Verifier code` | `nb_cartes` | **corrigé** : `Number.isFinite(...)` / `Array.isArray(...).length` — garanti numérique à la source, jamais une chaîne lue telle quelle |
| `box-validation-prof.json` → `Preparer Email Confirmation` | `notion` (×2), `matiere`, `niveau` | échappé |
| ″ | `nb_cartes` | sûr (nombre, garanti par `Verifier code`) |
| ″ | `studentUrl` (dérivé de `data.id`, généré par notre code, format fermé) | échappé (uniformité) |
| `box-validation-prof.json` → `Preparer Page Succes` | `notion` | échappé |
| ″ | `nb_cartes` | sûr (nombre, garanti par `Verifier code`) |
| ″ | `studentUrl` | échappé (uniformité) |
| `box-selection-prof.json` → `Construire page selection` (page de relecture) | `numero`, `difficulte`, `question`, `reponse`, `matiere`, `niveau`, `notion`, `file_id`, `code`, `token` | échappé |
| ″ | `diffColor(difficulte)` | sûr (fonction qui ne renvoie que l'un de 3 littéraux hex fixes) |
| ″ | `cardsHtml` | sûr (string déjà composée d'éléments eux-mêmes échappés ci-dessus) |
| `box-selection-prof.json` → `Preparer Email Confirmation` | `notion` (×2), `matiere`, `niveau` | échappé |
| ″ | `nb_cartes`, `removed_count` | sûr (nombres) |
| ″ | `removedLine` | sûr (composée uniquement d'un nombre) |
| ″ | `studentUrl` | échappé (uniformité) |
| `box-selection-prof.json` → `Preparer Page Succes` | `notion_html` | déjà échappé (calculé dans `Verifier et filtrer`) |
| ″ | `nb_cartes`, `removed_count` | sûr (nombres) |
| ″ | `studentUrl` | échappé (uniformité) |
| `box-generation-flashcards.json`/`tally.json` → `Parser reponse Claude` | `cartes` (réponse du modèle) | **corrigé** : `Array.isArray(parsed.cartes)` — un objet forgé `{length: "<script>"}` ne passe plus le test `cartes.length === 0`, qui ne vérifiait pas le TYPE |
| `box-generation-flashcards.json`/`tally.json` → `Preparer Email Validation` | `numero`, `question`, `reponse`, `difficulte.toUpperCase()`, `matiere`, `niveau`, `notion`, `id`, `code` | échappé |
| ″ | `diff` (sélecteur de couleur) | sûr (même motif que `diffColor`, 3 littéraux hex fixes) |
| ″ | `cartes.length`, `cartes.length - maxPreview` | sûr (nombres, garanti par le `Array.isArray` ci-dessus) |
| ″ | `cartesHtml` | sûr (composée d'éléments déjà échappés) |
| ″ | `selectUrl` (dérivé de `driveFileId`, format Drive, et `code` déjà `encodeURIComponent`-é) | échappé (uniformité) |
| `box-generation-flashcards.json`/`tally.json` → `Email Erreur` (expression n8n `{{ }}`, pas un template JS) | `notion` | **corrigé** → `notion_html` (calculé dans `Valider entree`/`Parser Tally`) |
| `box-generation-flashcards.json`/`tally.json` → `Email Erreur Generation` (expression n8n `{{ }}`) | `notion`, `matiere`, `error` | **corrigé** → `notion_html`/`matiere_html`/`error_html` (calculés dans `Parser reponse Claude`, propagés via `...prevData`) |

**Chaque ligne vérifiée par exécution locale** (harnais Node, charge `<img src=x onerror=alert(1)>` injectée dans chaque champ texte, y compris les deux défauts de type ci-dessus avec une charge logée dans `nb_cartes`/`cartes.length`) : aucune des 8 sorties (2 pages + 6 emails, incluant les 2 emails d'erreur) ne laisse la charge brute survivre dans le HTML produit.

## Fichiers livrés

```
n8n/t-sec-2026-10-06/
  test/   — copies de TEST (webhooks en /…-test, CATALOGUE_TEST_ID, écriture catalogue neutralisée)
  prod/   — versions corrigées des workflows réels (même id, vrai catalogue) — à n'importer qu'après tests concluants
```

| Workflow réel | Correctif(s) | Copie de test |
|---|---|---|
| `BOX - Generation Flashcards` | #2, #4 (lien email + échappement aperçu) | `box-generation-flashcards-TEST.json` (déclenchement manuel, trigger Sheets remplacé) |
| `BOX - Generation Tally` | #2, #4 (lien email + échappement aperçu) | `box-generation-tally-TEST.json` (webhook `/box-tally-test`) |
| `BOX - Validation Prof` | #1, #4 (échappement page de succès) | `box-validation-prof-TEST.json` (webhook `/box-validate-test`) |
| `BOX - Selection Prof` | #2, #3, #4 | `box-selection-prof-TEST.json` (webhooks `/box-select-test`, `/box-select-confirm-test`) |
| `BOX - Fiche API` | #5 | `box-fiche-api-TEST.json` (webhook `/box-set-test`) |
| `BOX - Rejet Prof` | — | *(aucun fichier, inchangé)* |

## Avant tout import — deux prérequis

1. **Catalogue de test** : déjà fait de ton côté (`catalogue-TEST.json` dupliqué sur Drive). Note son id — tu le colleras dans chaque nœud `Download Catalogue (TEST)` (`CATALOGUE_TEST_ID`, 3 occurrences : `box-validation-prof-TEST.json`, `box-selection-prof-TEST.json`, `box-fiche-api-TEST.json`).
2. **Rien à faire ici.** Le jeton anti-CSRF (v3, voir correctif #3) est généré automatiquement à chaque chargement de `box-select` — aucun secret à créer ni à coller nulle part.

## ⚠️ Secret HMAC — règle Git (OBSOLÈTE, conservé pour archive)

**Cette section ne s'applique plus.** Elle documentait le montage v2 (nœud Code + `require('crypto')` + secret en dur), abandonné parce que l'instance d'Éric interdit `require('crypto')` dans un nœud Code (voir le correctif #3 révisé ci-dessus). Le montage v3 (jeton aléatoire via `Crypto`/`Generate`) ne stocke **aucun secret statique nulle part** — rien à redacter, rien à committer par erreur. Texte original conservé ci-dessous pour traçabilité :

> Le nœud `Crypto` + credential dédiée a été abandonné (type de credential introuvable sur l'instance réelle d'Éric). Le secret HMAC vivait en clair, collé à la main dans le code des nœuds Code `Calculer Token`/`Recalculer Token` — directement dans l'UI n8n, jamais dans ce dépôt. Les fichiers `test/box-selection-prof-TEST.json` ne devaient jamais contenir que le placeholder `COLLER_ICI_LE_SECRET_BOX_SELECT_TEST`, jamais la vraie valeur, avec la même discipline de redaction que la clé API Anthropic en cas de ré-export.

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
Importer, coller `CATALOGUE_TEST_ID` dans `Download Catalogue (TEST)`. Rien à configurer pour le jeton (v3, généré automatiquement).
Préparer un fichier de test dont une carte contient volontairement `question: "<script>alert(1)</script>"` et `numero: "1\"><img src=x onerror=alert(1)>"` (ou le fichier de l'étape 1, modifié à la main).
Test A (échappement) : ouvrir `GET /box-select-test?file_id=...&code=...` → ✅ le HTML source doit contenir `&lt;script&gt;` (jamais `<script>` brut) et le numéro doit apparaître comme texte inoffensif, jamais casser l'attribut `value="..."`. Vérifier aussi que le fichier Drive a bien été réécrit avec un nouveau champ `review_token` (64 caractères hex).
Test B (parcours normal) : décocher une carte, soumettre → ✅ le workflow se termine normalement (page de succès) ; le fichier **filtré** sur Drive (`Upload Flashcards Filtrees`, pas le catalogue) porte désormais `"revue_carte_par_carte": true` et **n'a plus** de champ `review_token` — celui-ci est bien écrit pour de vrai, seul le catalogue est neutralisé.
Test C (anti-CSRF) : avec `curl`, poster directement sur `/webhook/box-select-confirm-test` (`file_id`, `code`, `cartes[]`) **sans** le champ `token` → ✅ doit être refusé ("Lien expiré ou invalide..."), jamais publié.
Test D (double ouverture) : ouvrir `GET /box-select-test` deux fois (ou recharger la page) sans soumettre, puis essayer de soumettre le formulaire du **premier** chargement → ✅ doit être refusé ("Lien expiré ou invalide...") — chaque GET réécrit `review_token`, donc seul le dernier chargement a un jeton valide. Effet de bord connu et accepté, voir correctif #3.
Test E (fuite via /box-set) : une fois le fichier filtré de l'étape B publié au catalogue de test (à la main, cf. étape 4), vérifier que `GET /box-set-test?file_id=...` ne renvoie **jamais** de champ `review_token` dans le JSON.

**Étape 4 — `box-fiche-api-TEST.json`**
Importer, coller `CATALOGUE_TEST_ID` dans `Download Catalogue (TEST)`. Comme `catalogue-TEST.json` reste vide (étapes précédentes neutralisées), **ajoute toi-même une entrée à la main** dans `catalogue-TEST.json` sur Drive : `{ "drive_file_id": "<file_id du fichier filtré de l'étape 3>", ... }` (les autres champs importent peu pour ce test).
Test A : `GET /box-set-test?file_id=<ce même file_id>` → ✅ sert la fiche normalement (code 200).
Test B : `GET /box-set-test?file_id=<un file_id qui n'est pas dans catalogue-TEST.json>` → ✅ vrai code HTTP **404**, corps `{"error":"Fiche non publiee ou introuvable."}`.

**Étape 5 — `box-generation-tally-TEST.json`**
Importer. Déclencher manuellement (via *Listen for test event* sur le webhook `/box-tally-test` + un POST de test, ou en épinglant une exécution).
✅ Vérifier que `revue_carte_par_carte: false` est bien posé sur le fichier produit, et que l'email contient un lien vers `/box-select-test` (pas `/box-select`).

## Bascule en prod — seulement après ces 5 étapes concluantes

1. Rien à générer (v3 du correctif #3 : jeton automatique, pas de secret).
2. Pour chacun des 5 workflows réels (sauf `BOX - Rejet Prof`) : **avant de toucher au live**, réexporte-le une dernière fois (sauvegarde fraîche, au cas où) — puis applique le contenu du fichier correspondant dans `prod/` (même `id` de workflow, pensé pour remplacer l'existant, pas pour créer un doublon). Le fichier `prod/box-selection-prof.json` devra d'abord être mis à jour avec le même mécanisme de jeton aléatoire que `test/box-selection-prof-TEST.json` (le correctif #3 ci-dessus, v3) — **pas fait encore, prod non touchée pour l'instant.**
3. Rien à configurer sur `BOX - Selection Prof` pour le jeton — juste vérifier après bascule que le mécanisme fonctionne sur un cas réel (étapes A/B/D de la procédure de test, transposées en prod).
4. Sur les 3 workflows touchant le catalogue (`box-validation-prof`, `box-selection-prof`, `box-fiche-api`), vérifier que `Download Catalogue` pointe bien sur le **vrai** id (`1AmmMsO3nh4h0GQ0I5XzIqWG_zHA9wopa`) — c'est déjà le cas dans les fichiers `prod/`, aucune substitution à faire ici.
5. Réactiver chaque workflow modifié (il repart avec le même statut `active` qu'avant ta manipulation si tu utilises le remplacement en place ; vérifie-le quand même).
6. Test de fumée en prod, **sans donnée élève** : relancer un vrai lien `box-select` existant (un email déjà reçu par toi) pour un jeu ordinaire récent, confirmer que la publication fonctionne exactement comme avant (règle d'or : aucune différence visible pour un collègue).
7. Les copies `(TEST)` peuvent rester désactivées en l'état (référence) ou être supprimées — ton choix, aucune ne doit rester **active**.

## Rappel garde-fou (AGENTS.md)

Rien de ceci n'a été importé, activé ni modifié dans l'instance n8n par cette session — uniquement des fichiers JSON dans ce dépôt. Toute bascule en prod reste ton geste, après tes propres tests sur les copies `(TEST)`.
