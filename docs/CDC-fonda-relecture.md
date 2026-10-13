# Cahier des charges — Relecture FONDA `/fonda-select` (Bloc 2, étape 7) — **v3**

> Statut : **v3 rédigée le 2026-10-13** après la re-review Codex de la v2 (bloquants R1–R4, à corriger R5–R9, optionnels). À valider par Éric, puis relecture Codex ciblée, **avant** tout workflow. Workflows livrés en JSON, **inactifs** ; activation sur feu vert explicite. Décisions d'Éric : §15.
>
> **Principe (fail-closed)** : rien n'est publiable sans une **attestation de clôture signée par Éric sur son Mac**. Le script de signature **ne fait confiance à aucun fichier transmis** : il lit l'état réel de n8n par son API (HTTPS authentifié) et ne signe que si (a) aucune exécution de relecture n'est en vol ou indéterminée, (b) les décisions présentes sur Drive et les confirmations réussies de l'historique n8n se **rapprochent exactement**, (c) il existe **exactement une** décision distincte. Sinon : rien à signer, donc rien de publiable.

## 0. Modèle de menace, preuve, frontière CI

- **Couvert** : modification d'un lot ou d'une décision entre Drive et le dépôt ; relecture d'un contenu différent de celui publié ; lien divulgué (expiration, révocation, clôture) ; courses, confirmations en vol, pannes partielles, écritures à issue incertaine ; décision supprimée définitivement, déplacée, purgée ou invisible (détectée par rapprochement avec l'historique) ; lot historique modifié (empreintes figées, R4) ; injection HTML dans la page de relecture.
- **Non couvert, assumé** : un administrateur n8n malveillant peut fabriquer un historique ou modifier les workflows. **L'attestation affirme : « Éric a clôturé ce lot contre l'état rapporté par n8n à cet instant, sur exactement ce contenu. »** Elle n'affirme pas l'identité de la personne qui a cliqué.
- **Infrastructure partagée** avec BOX (instance, compte Google, credentials) : séparation **fonctionnelle**, pas isolation.
- **Frontière CI** : la GitHub Action (`.github/workflows/tests.yml`) ne fait **que de la vérification avec des données publiques** (empreintes figées, liste blanche, signatures à clé publique). Elle ne détient **jamais** la clé privée RSA ni le jeton d'API n8n. Signature et rapprochement n8n sont **locaux**, sur le Mac d'Éric ; GitHub ne vérifie que ce qui est déjà signé.

## 1. Fichiers, contrats et octets canoniques (B7, R6)

Contrats **privés** (Drive `FONDA-Lots`, jamais commités) ; le contrat public `lot-fonda/v1` est **inchangé**.

- **`candidat-fonda/v1`** — `en-attente/<set_id>.json` : `{ schema, lot, relecture }`, `lot` = `lot-fonda/v1` strict non relu ; `relecture = { statut ∈ {"en_attente","clos"}, generation_cle, cle_sha256, cree_le, expire_le, relecteur_attribue, referentiel_version, envois }` où `envois = [{ generation, cle_sha256, envoye_a, envoye_le, expire_le }]` conserve **la provenance de chaque génération** (R9).
- **`decision-fonda/v1`** — `decisions/<set_id>__g<generation>__<nonce>.json` : `{ schema, set_id, generation, nonce, recu_le, coeur, lot_relu, hash_formulaire }` ; `coeur = { action, selection, ecartees, empreinte_relue, empreinte_publiee, version_correcteur }` ; pour `action = "rejeter"` : `selection = []`, `empreinte_publiee = null`, `lot_relu = null`.
- **`cloture-fonda/v1`** : **n'est plus un fichier faisant foi**. C'est la sortie de l'exécution n8n de clôture, lue par le script **via l'API n8n** (§8).

**Octets canoniques** (empreintes de cœur, `hash_formulaire`, attestation, signature) — implémentation unique `fonda/engine/canonique.js` (Node ; recopiée à l'identique dans les nœuds Code n8n), vecteurs de test fixes :
- Sérialisation **JSON.stringify d'ECMAScript** appliquée à une valeur **construite avec l'ordre de clés du contrat** ; UTF-8 sans BOM ; aucun espace ni saut de ligne.
- **Nombres** : finis seulement (sinon refus) ; représentation **Number::toString d'ECMAScript** (plus courte forme exacte : `0.5` → `0.5`, `1e21` → `1e+21`) ; `-0` → `0`. Décimaux autorisés (réponses numériques de `lot-fonda/v1`).
- **Chaînes** : échappement de `JSON.stringify` bien formé (ECMA-262 : `\"`, `\\`, contrôles en `\uXXXX`, surrogates isolés échappés) ; **aucune normalisation Unicode**.
- **Champs** : **tous présents**, valeur par défaut explicite (`null`, `[]`, `false`) ; aucun champ inconnu.
- `hash_formulaire` = SHA-256 hex du canonique de `[[nom, valeur], …]` des champs reçus, **triés par nom** (ordre des unités de code UTF-16).
- L'**empreinte d'un lot** reste exactement `catalogue.js::texteEmpreinte` (même règles ; test d'égalité).

## 2. Routage figé à l'émission (C8, R9)

- Relecteur attribué lu dans `referentiel.json` publié (Pages), d'après `notion_id` ; inconnu → refus.
- `referentiel_version` = SHA-256 du contenu lu. Le référentiel est **archivé par Git** : le script local retrouve dans l'historique du dépôt le commit dont `fonda/data/referentiel.json` a ce hash, et relit l'attribution ; introuvable → refus.
- `envois[]` enregistre chaque génération (identifiant destinataire, date d'acceptation Gmail). Un envoi accepté ne prouve ni livraison ni lecture.

## 3. Clé de relecture et révocation (C1, B3, R5)

- Crypto v1 « Generate », hex 64 ; seul `cle_sha256` est stocké. **Validité 14 jours.**
- **Seuls les workflows manuels écrivent le candidat** (génération, réémission, clôture), lancés par Éric, jamais en parallèle. Les confirmations ne l'écrivent jamais.
- **Ce que la révocation invalide** (étape C3, §5) : la clé n'est acceptée que si, dans le candidat **téléchargé par cette exécution** (lecture Drive dont le **résultat** est obtenu après le début de l'exécution), `statut === "en_attente"` ET `sha256(k) === cle_sha256` ET `generation_cle === form.generation` ET `maintenant < expire_le`.
- **Sémantique exacte (R5)** : la révocation (`statut = "clos"`) interdit **immédiatement les nouvelles autorisations** (toute exécution dont la lecture du candidat a lieu après l'écriture de révocation). Une confirmation **déjà autorisée** (lecture antérieure) peut encore écrire : elle est **en vol**, et c'est le **drainage prouvé par l'API n8n** (§8.2) — pas un délai — qui garantit qu'aucune n'est plus en vol au moment de signer. Une seconde lecture du candidat juste avant l'écriture C6 réduit la fenêtre (défense en profondeur), sans prétendre la supprimer.
- **Réémission** (manuelle) : seulement si `statut === "en_attente"` ; nouvelle génération ajoutée à `envois`. Les décisions des générations antérieures **restent comptées** : l'unicité porte sur le **lot**, toutes générations confondues.

## 4. Page de relecture (C4–C6, O2)

- Par carte : question, réponse attendue, **profil** avec explication **et exemple concret** de ce qu'il accepte ou refuse (`exact` normalise certains espaces et caractères ; `sens` ne comprend pas une paraphrase), **toutes** les réponses acceptées, `unite`, `arrondi`, `seconde_chance` (ou « non précisé »).
- Choix explicite « Garder / Écarter » par carte, sans défaut ; « Tout rejeter » séparé avec confirmation.
- **« Essayer une réponse »** : vrai correcteur à l'**URL versionnée et conservée** `https://ericduchateau.github.io/box/fonda/engine/correction-v<N>.js`, **SRI épinglée**, `crossorigin="anonymous"` (CORS vérifié en réel) ; `version_correcteur` dans la décision et l'attestation. SRI en échec → champ masqué.
- Données vers le script : un unique `<script type="application/json">` (JSON avec `<`, `>`, `&`, U+2028, U+2029 en `\uXXXX`), lu par `JSON.parse` ; aucune interpolation dans du code ; aucun `onclick` (écouteurs posés par le script à nonce). Reste du HTML : `escapeHtml`, attributs entre guillemets, `encodeURIComponent`.
- CSP : `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-<aléa>' <URL exacte de correction-v<N>.js>; form-action <URL exacte de confirmation>; base-uri 'none'` (+ cadre selon §9.3). L'URL du fichier, pas toute l'origine. La CSP ne remplace jamais l'échappement.

## 5. Confirmation : une seule écriture, idempotente (B1, B4, C9)

**GET `/fonda-select?lot=<set_id>&k=<clé>`** — aucune écriture. Validation regex de `lot` et `k` avant toute recherche ; recherche (§6) ; contrôle (§3) ; empreinte affichée ; `jeton = HMAC-SHA256(secret_formulaire, canonique(["fonda-select/v3", set_id, generation_cle, cle_sha256, empreinte_affichee, expire_page, nonce]))`, `expire_page = min(maintenant + 2 h, expire_le)`, `nonce` = 32 hex aléatoires.

**POST `/fonda-select-confirm`** :
- **C1 syntaxe** (avant Drive) : ≤ 64 Ko en octets reçus (vrai webhook) ; champs exactement `lot, k, generation, empreinte, expire_page, nonce, jeton, action` + `choix_<item_id>` (si `accepter`) **ou** `confirmer_rejet=oui` (si `rejeter`) ; valeur dupliquée → 400 (vrai webhook) ; formats stricts.
- **C2 jeton** : HMAC égal, non expiré ; sinon 403.
- **C3 candidat et clé** : recherche (§6) et contrôle (§3) sur le candidat téléchargé par cette exécution ; sinon 403/409.
- **C4 contenu** : empreinte actuelle du candidat = empreinte du formulaire ; sinon 409.
- **C5 sélection** : chaque `item_id` exactement un choix, aucun inconnu, ≥ 1 gardé pour `accepter`. Lot relu = cartes gardées dans l'ordre, `item_id` d'origine, `revue_carte_par_carte: true`, `lot-fonda/v1`.
- **C5bis** : seconde lecture du candidat ; statut toujours `en_attente` et même génération, sinon 409 (défense en profondeur, §3).
- **C6 écriture unique** : `decisions/<set_id>__g<generation>__<nonce>.json`. Nom existant (rejeu) : relecture ; même `coeur` → même résultat sans écriture ; `coeur` différent → 409. **La sortie de l'exécution consigne** `{ set_id, generation, nonce, coeur_sha256, drive_file_id, resultat_ecriture }` : c'est ce que le rapprochement (§8.3) lit dans l'historique.
- **C7 mail** au relecteur attribué ; son échec n'annule rien.
- Défense de fond : `executionTimeout = 120 s` sur les workflows de relecture (n'est **plus** la barrière de sûreté : §8.2).

## 6. Recherche Drive stricte (C2, R3)

- `set_id` validé par regex avant interpolation ; requête **Advanced Search** `'<id en-attente>' in parents and name = '<set_id>.json' and mimeType = 'application/json' and trashed = false`.
- Projection incluant `nextPageToken` **et `incompleteSearch`** ; **`incompleteSearch = true` → refus** ; pagination complète ; tous les résultats traités ; 0 ou > 1 → refus ; `set_id` interne = nom demandé.
- Aucun `file_id` client. Écritures uniquement dans les dossiers FONDA (ids constants, `driveId` explicite si Drive partagé). Test statique : aucun id ni route BOX, Crypto v1 uniquement.

## 7. Workflow de clôture n8n (manuel)

`FONDA - Cloturer relecture`, lancé par Éric pour un `set_id` :
1. **Révocation** : `relecture.statut = "clos"` (écriture du candidat) ; horodatage `revoque_le` dans la sortie.
2. **Listing** du dossier `decisions/` : **corbeille comprise**, pagination complète, `incompleteSearch` vérifié (si vrai → sortie `listing_incomplet`, rien d'autre), corpus = ce dossier (et son `driveId`) ; **chaque** fichier lu ; sortie = manifeste `[{ drive_file_id, nom, trashed, set_id_interne, generation, nonce, coeur_sha256, lisible }]` pour **tous** les fichiers (pas seulement ceux du lot), plus les octets canoniques du `coeur` et le `lot_relu` de chaque décision du lot.
3. **Rien n'est conclu ici** : la sortie de cette exécution est **une pièce**, lue et vérifiée par le script local (§8). Aucun fichier de clôture ne fait foi.

## 8. Script local de clôture et de signature (R1, R2, R3)

`fonda/scripts/signer-cloture.js` (Node, sur le Mac d'Éric ; aucun secret dans le dépôt). Entrées : `set_id`, id de l'exécution de clôture, `badge` (§11). Le script lit **lui-même** tout ce qu'il vérifie :

1. **Provenance (R2)** : `GET /api/v1/executions/<id>?includeData=true` sur l'instance (HTTPS, jeton n8n local) ; l'exécution doit appartenir au **workflow de clôture épinglé** (id constant), `status = success`, même `set_id`, `revoque_le` présent. Il télécharge aussi le **candidat** directement depuis n8n/Drive via cette même exécution (le candidat est dans la sortie de l'étape 1).
2. **Drainage (R1)** : pour chaque workflow de relecture épinglé (GET et POST), `GET /api/v1/executions?workflowId=…&status=running` puis `status=waiting` (et tout autre statut non terminal exposé par l'API) → **doivent être vides**. Toute exécution du POST **en erreur** depuis `cree_le` dont la dernière étape atteinte est **C5bis ou C6** (écriture à issue incertaine) → **blocage** jusqu'à résolution par Éric (il inspecte Drive et l'exécution ; la résolution `{execution_id, constat}` est inscrite **dans l'attestation signée**). Le contrôle de drainage est fait **avant et après** le rapprochement ; résultats différents → refus.
3. **Rapprochement exhaustif (R3)** :
   - Historique : toutes les exécutions **réussies** du POST depuis `cree_le` pour ce `set_id` → ensemble H des `(nonce, coeur_sha256, drive_file_id)` consignés en C6.
   - Drive : ensemble D du manifeste de clôture pour ce `set_id`.
   - Exiger **H = D** (même `drive_file_id`, même `coeur_sha256`) : une décision disparue (supprimée définitivement, déplacée, purgée, invisible) est dans H mais pas D ; un fichier d'origine inconnue est dans D mais pas H → **refus** dans les deux cas. Tout fichier illisible du dossier → refus.
   - **Rétention** : l'API ne doit pas avoir purgé d'exécutions depuis `cree_le` (vérifier que la plus ancienne exécution conservée du POST est antérieure à `cree_le` ; n8n purge par défaut au-delà d'un âge maximal — réglage `EXECUTIONS_DATA_MAX_AGE` à vérifier sur l'instance, condition §9.5). Sinon → refus.
4. **Unicité** : décisions distinctes = `coeur` canoniques distincts (octet par octet ; nonces, dates, générations, noms ignorés). Exactement **un** cœur, d'action `accepter`. Toutes les enveloppes portant ce cœur doivent avoir le **même `lot_relu` canonique** et être cohérentes (`empreinte(lot_relu) = empreinte_publiee`) ; sinon refus.
5. **Revérifications** : `empreinte_relue` = empreinte du lot candidat ; `lot_relu` = candidat **filtré** par `selection` (ordre, `item_id`) ; `lot-fonda/v1` ; garde-fous du correcteur ; attribution relue dans le référentiel archivé (§2) ; provenance de la **génération de la décision** prise dans `envois[generation]` (R9).
6. **Récapitulatif lisible** affiché à Éric (lot, cartes gardées/écartées, décision, provenance, badge, résolutions) ; signature seulement après confirmation tapée (`oui`).
7. **Attestation** `attestation-cloture/v1` (§10) signée RSA-SHA256 PKCS#1 v1.5, base64, sur ses octets canoniques ; **la signature est immédiatement revérifiée** avec la clé publique de `cles.json`.

**Secrets locaux** (jamais dans le dépôt, Dropbox, chat, workflow) : la clé privée RSA **et** le jeton d'API n8n (Trousseau macOS ou fichiers `chmod 600` hors Dropbox). Le script n'utilise que des **requêtes GET** de l'API n8n ; si l'instance ne permet pas de jeton à droits restreints, le jeton est équivalent administrateur : à protéger comme tel.

## 9. Conditions d'activation — à prouver sur la copie de test

1. **Drainage observable** : l'API de l'instance expose bien `running` / `waiting` pour les workflows de relecture (exécution de test volontairement lente, observée en `running`).
2. **Révocation** : GET ouvert, clôture lancée, soumission ensuite → refus C3/C5bis ; une soumission autorisée avant révocation et écrivant après apparaît dans H et D.
3. **Iframe et en-têtes** : parcours GET → POST → confirmation, rejet, erreurs, en **navigateur réel** (pas `curl -I`), en-têtes réellement servis (proxy, CSP cumulées) ; consigner le résultat.
4. **Limites** : refus immédiat (sans Drive) des requêtes invalides ; aucune relance automatique ; réponses d'erreur explicites avec les mêmes en-têtes.
5. **Rétention** : `EXECUTIONS_DATA_PRUNE` / `EXECUTIONS_DATA_MAX_AGE` de l'instance connus ; la clôture doit avoir lieu **avant** l'horizon de purge (sinon le script refuse, §8.3). Durée de validité de la clé (14 j) ≤ horizon de purge, ou horizon étendu.
6. **Protection de branche GitHub** : règle « Require status checks to pass » (`tests (node --test)`) sur `design` et `main` — réglage du dépôt par Éric. Sans elle, la CI informe mais ne bloque pas.

## 10. Attestation de clôture et vérification (R6, R7)

`attestation-cloture/v1` = `{ schema, set_id, notion_id, palier, action, selection, ecartees, empreinte_relue, empreinte_publiee, version_correcteur, generation_decision, envoi_decision: { envoye_a, envoye_le }, relecteur_attribue, referentiel_version, generation_cloture, execution_cloture, revoque_le, decisions_distinctes, resolutions, cloture_le, badge, cle_id, signature }` (tous champs présents ; `resolutions = []` par défaut).

Vérification par `publier-lot.js` **et** la CI (asynchrone, étape dédiée **avant** utilisation du catalogue ; `validerCatalogue` reste synchrone pour la forme) : `cle_id` déclaré dans `fonda/data/cles/cles.json` = `[{ id, algorithme: "RSA-SHA256/PKCS1v1.5", valide_du, valide_au, revoquee_le }]`, non révoqué, `cloture_le` dans la période ; **jamais** de chemin de clé fourni par l'attestation ; signature valide ; `set_id`/`notion_id`/`palier` = lot publié ; `action = "accepter"` ; `decisions_distinctes = 1` ; `selection` et `ecartees` disjointes, sans doublon ; `selection` = `item_ids` du fichier ; **`empreinte_publiee` = empreinte du fichier publié** (et **non plus** `empreinte_relue`, qui porte sur le candidat : corrige la comparaison actuelle de `publier-lot.js`, R7) ; badge cohérent (§11). Le **front** ne vérifie pas RSA : il fait confiance au catalogue **mergé**, protégé par la CI bloquante (§9.6) ; il continue de vérifier l'empreinte de chaque fichier servi.

## 11. Badge élève ≠ attestation (C7, R9)

- `badge` est **signé** par Éric. Deux formes seulement :
  - `{ nom_affiche: <nom réel>, confirme: true, moyen: <texte non vide>, confirme_le: <date ISO> }` — uniquement si Éric a obtenu une **confirmation humaine directe** de cette personne ;
  - `{ nom_affiche: "un professeur", confirme: false, moyen: null, confirme_le: null }` — exactement.
- Toute autre combinaison → refus (CI et `publier-lot.js`). La CI vérifie aussi `entree.relecteur.nom_affiche === attestation.badge.nom_affiche`. Le badge n'est **jamais** dérivé d'un autre champ.
- Lots historiques : `manuelle-historique`, inchangés et **figés par empreinte** (`HISTORIQUES_FIGES`, R4 — corrigé dans le bloc 1).

## 12. Révocation de la clé de signature (R8)

- **Rotation normale** : nouvelle clé, `valide_au` fixée sur l'ancienne ; les attestations signées pendant sa validité restent recevables.
- **Compromission** : **une seule PR** qui (a) fixe `revoquee_le` sur la clé, **et** (b) pour chaque lot concerné, soit le **retire** (entrée et fichier supprimés : quarantaine), soit remplace son attestation par une **re-signature** avec la nouvelle clé, **à contenu identique** (`empreinte_publiee` inchangée — l'immuabilité porte sur le contenu, pas sur l'attestation ; un remplacement d'attestation qui changerait l'empreinte est refusé). La CI valide l'état final de la PR ; aucun contrôle n'est désactivé. Le site continue de servir l'ancien état jusqu'au merge : la PR de révocation est prioritaire.

## 13. Migration avant toute ouverture (C10, R7) — refus par défaut jusqu'au bout

(1) `canonique.js` + vecteurs (nombres décimaux, chaînes, surrogates) ; (2) `cles.json` + clé publique ; (3) `catalogue.js` : type `cloture-signee`, vérification RSA asynchrone ; (4) `publier-lot.js` : exige l'attestation de clôture, compare `empreinte_publiee` au fichier, badge de l'attestation, supprime l'injection de types sans signature ; (5) CI : vérifie toute entrée `cloture-signee`, refuse tout autre type que `manuelle-historique` figé et `cloture-signee` vérifiée ; **CI GitHub déjà en place** (bloc 1), protection de branche à activer (§9.6) ; (6) `signer-cloture.js` + tests hors ligne (API n8n simulée) ; (7) seulement alors, les workflows (inactifs).

## 14. Tests exigés

1. JS réel des nœuds Code ; `canonique.js` octet par octet (Node ↔ n8n) ; vecteurs fixes.
2. XSS dans chaque champ (`</script>`, U+2028/9, guillemets) ; aucune exécution.
3. Sélection malformée et doublons sur le **vrai** webhook ; corps > 64 Ko.
4. Entrelacements : même nonce même/différent choix ; deux nonces même/différents choix ; soumission après révocation ; soumission autorisée avant révocation écrivant après ; réémission pendant une confirmation ; panne après C6 ; **écriture Drive à issue incertaine** (exécution en erreur après C5bis → blocage) ; **reprise après C3** ; **exécution encore `running`/`waiting`** au moment de signer ; **`incompleteSearch`** ; **décision disparue** (dans H, pas dans D) ; **fichier d'origine inconnue** (dans D, pas dans H) ; **exécutions purgées** ; **ancienne exécution de clôture réutilisée** (révocation antérieure à une décision listée → refus) ; **lot historique modifié** (refusé, R4).
5. Signature : vecteurs ; attestation altérée, clé révoquée ou inconnue, période dépassée, sélection non disjointe, `action = rejeter`, badge incohérent → refus ; re-signature à contenu identique acceptée, à contenu différent refusée.
6. Conditions §9 prouvées sur la copie de test, résultats consignés.

## 15. Décisions d'Éric (2026-10-13)

1. Clé de relecture : **14 jours**.
2. **« Essayer une réponse » en v1** (URL versionnée sur Pages, SRI).
3. **Clôture manuelle obligatoire** ; plus de détection après coup.
4. **Signature locale sur le Mac d'Éric** ; l'attestation affirme « Éric a clôturé ce lot contre l'état rapporté par n8n à cet instant ».
5. **Rapprochement par l'API n8n** depuis le script local (provenance, drainage, rapprochement historique ↔ Drive).
6. Historique des exécutions n8n **conservé partout, sans exception** (aucune clé privée dans n8n ; le rapprochement en a besoin).
7. **GitHub Action bloquante** (vérification publique uniquement) ; protection de branche à activer.
8. Alertes « conflit » : Éric seul.
