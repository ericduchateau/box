# Cahier des charges — Relecture FONDA `/fonda-select` (Bloc 2, étape 7) — **v2**

> Statut : **v2 rédigée le 2026-10-13** après la critique Codex de la v1 (7 bloquants B1–B7 fondés, 11 points C1–C11, 3 optionnels O1–O3). À valider par Éric, puis relecture Codex ciblée, **avant** tout workflow. Workflows livrés en JSON, **inactifs** ; activation sur feu vert explicite.
> Décisions d'Éric : §13.
>
> **Principe (fail-closed)** : rien n'est publiable sans une **attestation de clôture signée par Éric sur son Mac**. La clôture ne produit une attestation que s'il existe **exactement une décision distincte** sur l'**ensemble** des décisions du lot (corbeille comprise). Absence de clôture = non publiable ; conflit = rien à signer = non publiable. Les confirmations de relecture **n'écrivent jamais au-delà d'un fichier de décision** et ne modifient jamais le candidat.

## 0. Modèle de menace et ce que prouve la chaîne

- **Couvert** : modification d'un lot ou d'une décision entre Drive et le dépôt ; relecture d'un contenu différent de celui publié ; lien de relecture divulgué (expiration, révocation, usage borné par la clôture) ; courses et pannes partielles (aucune ne peut produire une publication) ; injection HTML dans la page de relecture.
- **Non couvert, assumé** : une personne ayant un accès administrateur à n8n ou au Drive peut modifier les workflows ou les décisions **avant** la clôture ; c'est Éric qui, à la clôture, constate l'état et signe. **L'attestation affirme « Éric a clôturé ce lot, sur exactement ce contenu »**, pas « n8n a prouvé l'identité du relecteur ».
- **Infrastructure partagée** avec BOX (instance n8n, compte Google, credentials) : séparation **fonctionnelle**, pas isolation. Une panne d'instance touche les deux.

## 1. Fichiers et contrats (B7, B5)

Trois contrats privés (Drive `FONDA-Lots`, jamais commités) ; le contrat public `lot-fonda/v1` reste **inchangé** (liste blanche intacte) :

- **`candidat-fonda/v1`** — `en-attente/<set_id>.json` : `{ schema, lot, relecture }` où `lot` est un `lot-fonda/v1` **strict** (non relu) et `relecture = { generation_cle, cle_sha256, cree_le, expire_le, statut ∈ {en_attente, clos}, relecteur_attribue, referentiel_version, envoye_a, envoye_le }`.
- **`decision-fonda/v1`** — `decisions/<set_id>__g<generation>__<nonce>.json` : une enveloppe **unique et complète** (B4) `{ schema, set_id, generation_cle, nonce, recu_le, coeur, lot_relu|null, hash_formulaire }` avec `coeur = { action ∈ {accepter, rejeter}, selection[], ecartees[], empreinte_relue, empreinte_publiee|null, version_correcteur }`.
- **`cloture-fonda/v1`** — `clotures/<set_id>__g<generation>.json` : `{ schema, set_id, revoque_le, delai_s, decisions_listees, decisions_distinctes, resultat ∈ {unique, conflit, aucune}, decision: <octets canoniques de la décision unique, base64> | null }`.

**Octets canoniques** (mêmes règles pour l'empreinte, l'égalité de décisions et la signature) : JSON **UTF-8 sans BOM**, **sans espaces ni fin de ligne**, clés **dans l'ordre fixé par le contrat** (jamais un ordre alphabétique implicite), **aucun champ absent** (`null` explicite pour les facultatifs), tableaux dans l'ordre du lot, entiers seulement, chaînes **non normalisées** (aucune transformation Unicode). Une implémentation unique `fonda/engine/canonique.js`, utilisable en Node et recopiée dans les nœuds Code n8n, **testée octet par octet** sur des vecteurs fixes ; l'empreinte reste le texte de `catalogue.js::texteEmpreinte`.

## 2. Routage figé à l'émission (C8)

- À la génération, le relecteur attribué est lu dans `referentiel.json` publié (Pages), d'après `notion_id`. `notion_id` inconnu → refus.
- Sont **figés dans le candidat** : `relecteur_attribue`, `referentiel_version` (SHA-256 du référentiel lu), `envoye_a` (identifiant, jamais l'adresse), `envoye_le` (horloge n8n après acceptation par Gmail). Un changement ultérieur du référentiel ne réécrit rien ; clôture et publication comparent au **référentiel figé** et signalent un écart.
- Adresses : uniquement dans n8n. Un envoi accepté par Gmail ne prouve ni la livraison ni la lecture.

## 3. Clé de relecture et révocation (C1, B3, pivot 2)

- Génération : Crypto v1 « Generate », hex, 64 caractères. Le candidat ne garde que `cle_sha256`. **Validité 14 jours.**
- **Écrivains du candidat** : uniquement les workflows **manuels** (génération, réémission, clôture), lancés par Éric, jamais en parallèle. **Les confirmations ne l'écrivent jamais** → ni mise à jour concurrente, ni retour d'un ancien bloc `relecture` (B3).
- **Contrôle exact invalidé par la révocation** — dans la confirmation (§5, étape C3), la clé n'est acceptée que si, sur le candidat **relu à cet instant** : `relecture.statut === "en_attente"` **ET** `sha256(k) === relecture.cle_sha256` **ET** `relecture.generation_cle === form.generation` **ET** `maintenant < relecture.expire_le`. La **révocation** (étape 1 de la clôture) écrit `statut = "clos"` ; la **réémission** change `generation_cle` et `cle_sha256` : dans les deux cas, ce contrôle échoue immédiatement pour l'ancien lien.
- **Réémission** (`FONDA - Reemettre cle`, manuel) : seulement si `statut === "en_attente"` ; incrémente `generation_cle`, nouvelle clé, nouveau mail. Les décisions des générations précédentes **restent comptées** à la clôture (O3 : l'unicité porte sur le **lot**, toutes générations confondues).
- Historique n8n (conservé, décision Éric) : la clé y figure (URL). Après la clôture, elle ne peut plus rien produire ; avant, au pire une décision supplémentaire → conflit → rien de signé.

## 4. Page de relecture (C4–C6, O2)

- Par carte : question, réponse attendue, **profil** avec une explication **et un exemple concret** de ce qu'il accepte et refuse (O2 : `exact` normalise certains espaces et caractères ; `sens` ne comprend pas une paraphrase libre), **toutes** les réponses acceptées, `unite`, `arrondi`, `seconde_chance` (ou « non précisé »).
- **Choix explicite** « Garder / Écarter » par carte, sans défaut. Bouton séparé « Tout rejeter » avec confirmation.
- **« Essayer une réponse »** (décision Éric) : exécute le vrai correcteur à une **URL versionnée et conservée** `https://ericduchateau.github.io/box/fonda/engine/correction-v<N>.js` (jamais le fichier courant), **SRI épinglée**, `crossorigin="anonymous"` (CORS de Pages vérifié en réel). `version_correcteur` est portée par la décision et l'attestation (C4). Si la SRI échoue : champ masqué, relecture toujours possible. Aucune requête réseau depuis le script.
- **Transport des données vers le script** (C6) : un unique `<script type="application/json" id="donnees">` dont le JSON a `<`, `>`, `&`, U+2028, U+2029 échappés en `\uXXXX`, lu par `JSON.parse` ; **aucune** interpolation de données dans du code ; **aucun** `onclick` : écouteurs posés par le script à nonce. Reste du HTML : `escapeHtml`, attributs entre guillemets, URL par `encodeURIComponent`.
- **CSP** (C5) : `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-<aléa>' https://ericduchateau.github.io/box/fonda/engine/correction-v<N>.js; form-action <URL exacte de confirmation>; base-uri 'none'` (+ `frame-ancestors` selon le résultat de §8.3). On autorise **l'URL du fichier**, pas toute l'origine. La CSP ne remplace jamais l'échappement.

## 5. Confirmation : une seule écriture, idempotente par construction (B1, B4, C9)

**GET `/fonda-select?lot=<set_id>&k=<clé>`** — **aucune écriture**. Validation syntaxique stricte de `lot` (`^set_fonda_[a-z0-9-]+_n[IF]_\d{2}$`) et `k` (`^[0-9a-f]{64}$`) **avant** toute recherche ; recherche du candidat (§6) ; contrôle de clé (§3) ; empreinte affichée ; jeton de formulaire :
`jeton = HMAC-SHA256(secret_formulaire, canonique(["fonda-select/v2", set_id, generation_cle, cle_sha256, empreinte_affichee, expire_page, nonce]))` (C1 : tuple sans ambiguïté, domaine d'usage, génération et clé liés) ; `expire_page = min(maintenant + 2 h, expire_le)` ; `nonce` aléatoire (Crypto Generate, 32 hex). Le jeton empêche une soumission aveugle ; il **ne prouve pas** que les cartes ont été lues.

**POST `/fonda-select-confirm`**, dans cet ordre :
- **C1 — syntaxe**, avant tout accès Drive : corps ≤ 64 Ko **en octets reçus** (vérifié sur le **vrai** webhook) ; champs autorisés exactement : `lot, k, generation, empreinte, expire_page, nonce, jeton, action`, plus `choix_<item_id>` (si `action=accepter`) **ou** `confirmer_rejet=oui` (si `action=rejeter`) ; toute valeur **dupliquée** (ex. `choix_it01` deux fois) = 400 (vérifié sur le vrai webhook) ; formats stricts (`^it\d{2}$`, `garder|ecarter`).
- **C2 — jeton** : HMAC recalculé égal, `expire_page` non dépassé ; sinon 403.
- **C3 — candidat et clé** : recherche (§6) puis contrôle §3 sur le candidat **relu maintenant** ; sinon 403/409.
- **C4 — contenu** : empreinte du candidat actuel `===` `empreinte` du formulaire ; sinon 409 « le lot a changé, rouvrir le lien ».
- **C5 — sémantique de la sélection** : chaque `item_id` du candidat a **exactement un** choix, aucun inconnu, au moins une carte gardée pour `accepter`. Lot relu = cartes gardées **dans l'ordre**, `item_id` d'origine, `revue_carte_par_carte: true`, conforme `lot-fonda/v1`.
- **C6 — écriture unique** : `decisions/<set_id>__g<generation>__<nonce>.json` (enveloppe complète §1). **Aucune autre écriture.** Si un fichier de ce nom existe déjà (rejeu, double clic, réessai) : relecture ; **même `coeur` canonique** → même résultat, aucune écriture ; **`coeur` différent** → 409 « décision déjà enregistrée, différente » (ni écrasement, ni faux succès). Deux homonymes créés en concurrence sont sans effet sur la sûreté : la clôture compare des **contenus** (§7).
- **C7 — mail de confirmation** au relecteur attribué ; son échec n'annule rien.
- **Timeout** : `executionTimeout = 120 s` (T_max) sur les workflows de relecture — **condition d'activation** (§8.1).

## 6. Recherche Drive stricte (C2)

- `set_id` validé par regex **avant** toute interpolation. Requête **Advanced Search** (jamais la recherche par nom partielle du nœud) : `'<id en-attente>' in parents and name = '<set_id>.json' and mimeType = 'application/json' and trashed = false`.
- **Tous** les résultats traités (pas de `limit: 1`, pas de `.first()`), pagination suivie jusqu'à absence de `nextPageToken` ; recherche incomplète ou en erreur → refus. 0 ou > 1 résultat → « lot introuvable ou ambigu ». Le `set_id` **interne** du fichier doit être égal au nom demandé.
- Aucun `file_id` client n'est jamais utilisé. Écritures uniquement dans les dossiers FONDA (ids constants). Test statique : aucun id ni route BOX dans les JSON FONDA ; Crypto v1 uniquement.

## 7. Clôture (B2 — pivots 1 et 3)

Workflow **manuel** `FONDA - Cloturer relecture`, lancé par Éric pour un `set_id` :

1. **Révocation** : écrit `relecture.statut = "clos"` dans le candidat. Toute confirmation dont le contrôle C3 a lieu **après** cette écriture échoue (§3).
2. **Délai** : nœud Wait, `D = 10 min`, supérieur à `T_max` (120 s) avec marge. Toute confirmation ayant passé C3 **avant** la révocation a terminé (ou a été coupée) avant la fin de `D` — **à condition que `T_max` soit effectivement appliqué** (§8.1).
3. **Listing exhaustif** du dossier `decisions/` : **corbeille comprise** (aucun filtre `trashed`), pagination complète, `supportsAllDrives`/`includeItemsFromAllDrives` si le dossier est un jour placé dans un Drive partagé ; **chaque** fichier est lu et retenu si son `set_id` **interne** est celui du lot, quel que soit son nom. Un fichier illisible ou non conforme dans `decisions/` → `resultat = conflit` (fail-closed).
4. **Décisions distinctes** : deux décisions sont **identiques** si leurs `coeur` canoniques (§1) sont **égaux octet par octet** — nonces, horodatages, générations et noms de fichiers ignorés. Toutes générations comptées. On ne compte **jamais** des fichiers.
5. **Résultat** : exactement un `coeur` distinct → `unique` : écrit `clotures/<set_id>__g<generation>.json` avec les **octets canoniques** de cette décision ; ≥ 2 → `conflit` ; 0 → `aucune` : la clôture est écrite **sans** décision et une **alerte part à Éric seul**. Rien de signable dans ces deux cas.

## 8. Conditions d'activation — à prouver sur la copie de test (pivot 1)

1. **Timeout réellement appliqué** : `executionTimeout = 120` (a) accepté et conservé par l'instance (plafond `EXECUTIONS_TIMEOUT_MAX`) ; (b) une exécution rendue lente exprès (Wait 200 s **avant** l'écriture de décision) est **coupée** et **n'écrit pas**. Si l'instance applique un arrêt « en fin de nœud », mesurer la durée maximale réelle d'une exécution de confirmation et fixer `D` ≥ 5 × cette durée. **Sans cette preuve, la clôture n'est pas sûre : pas d'activation.**
2. **Révocation effective** : ouvrir une page (GET), lancer la clôture, soumettre pendant le délai → **refus**, aucune décision créée.
3. **Iframe et en-têtes** (C3) : `Respond to Webhook` peut envelopper le HTML dans une iframe sandboxée ; vérifier en **navigateur réel** (pas `curl -I`, qui ne fait qu'un HEAD) le parcours GET → POST → confirmation, le rejet et les pages d'erreur, avec les en-têtes **réellement servis** (proxy compris, CSP éventuellement cumulées). Ajuster `frame-ancestors` / `X-Frame-Options` à ce qui fonctionne ; consigner le résultat.
4. **Limites** (C11) : refus immédiat, sans accès Drive, de toute requête syntaxiquement invalide ; aucune relance automatique ; erreurs Drive/Gmail → page d'erreur générique servie par un nœud de réponse explicite (y compris sur la branche d'erreur), avec les mêmes en-têtes.

## 9. Signature locale de clôture (B6 — signature sur le Mac d'Éric)

- **Clé** : paire RSA 3072 bits générée **localement** par Éric (commande `openssl` fournie), **clé privée hors dépôt et hors n8n** (Trousseau macOS, ou fichier `chmod 600` **hors** du dossier Dropbox), jamais collée dans un chat, un commit ou un workflow. Clé publique commitée `fonda/data/cles/<id>.pub.pem`, déclarée dans `fonda/data/cles/cles.json` = `[{ id, algorithme: "RSA-SHA256/PKCS1v1.5", valide_du, valide_au|null, revoquee_le|null }]`.
- **Script local** `fonda/scripts/signer-cloture.js` (Node `crypto`, aucun réseau), à partir de l'enveloppe `candidat-fonda/v1`, du fichier `cloture-fonda/v1` et de la décision unique téléchargés depuis Drive. Il **revérifie tout** : `resultat = unique` ; décision = octets de la clôture ; `empreinte_relue` = empreinte du lot candidat ; lot relu = candidat **filtré** par la sélection (ordre, `item_id`) ; `lot-fonda/v1` ; garde-fous du correcteur ; référentiel figé. Puis il signe l'**attestation de clôture** :
  `attestation-cloture/v1 = { schema, set_id, notion_id, palier, action, selection, ecartees, empreinte_relue, empreinte_publiee, version_correcteur, relecteur_attribue, envoye_a, envoye_le, referentiel_version, generation_cle, decisions_distinctes, cloture_le, badge, cle_id }` → `signature` = RSA-SHA256 PKCS#1 v1.5, base64, sur ses **octets canoniques** (§1).
- **Vérification** (`publier-lot.js` et CI) : `cle_id` déclaré dans `cles.json`, **non révoqué**, `cloture_le` dans sa période de validité ; **jamais** de chemin de clé fourni par l'attestation ; signature valide ; `schema` reconnu ; `set_id`/`notion_id`/`palier` signés = lot publié ; `action = accepter` ; `decisions_distinctes = 1` ; `selection` et `ecartees` disjointes, sans doublon ; `selection` = `item_ids` du fichier publié ; `empreinte_publiee` = empreinte du fichier ; `badge` = badge de l'entrée (§10).
- **Limite assumée** : la CI ne revoit pas le candidat complet (il contient des cartes écartées, non publiées). La vérification du **filtrage** est faite par le script d'Éric au moment de signer : Éric est la racine de confiance, c'est exactement ce que l'attestation affirme.
- **Rotation / compromission** : rotation = nouvelle clé, `valide_au` fixée sur l'ancienne ; compromission = `revoquee_le` fixée → **toutes** les attestations de cette clé deviennent irrecevables (la CI échoue) et les lots concernés sont reclôturés. `cloture_le` est déclaratif (horloge du Mac), pas un horodatage indépendant.

## 10. Badge élève ≠ attestation (C7)

| | Badge élève (`relecteur.nom_affiche` de l'entrée) | Attestation de clôture signée |
|---|---|---|
| Affirme | une **responsabilité éditoriale nommée** | « Éric a clôturé ce lot : décision unique reçue via le lien envoyé à `<id>` le `<date>`, sur exactement ce contenu » |
| N'affirme pas | — | l'**identité** de la personne qui a cliqué |
| Fixé par | le champ `badge`, **signé par Éric** | le script local |

- Badge **nominatif** (« … validée par Justine Leblanc ») **uniquement** si Éric a obtenu une **confirmation humaine directe** de cette personne : `badge = { nom_affiche, confirme: true, moyen, confirme_le }`. Sinon `badge = { nom_affiche: "un professeur", confirme: false }`. La saisie d'un nom n'est pas une preuve : c'est l'engagement signé d'Éric.
- La CI vérifie `entree.relecteur.nom_affiche === attestation.badge.nom_affiche`. **Corrige le code actuel**, qui dérive le badge de `attestation.relecteur` (C7).
- Lots historiques (`manuelle-historique`) : inchangés.

## 11. Migration des contrats avant toute ouverture (C10)

Ordre imposé, refus par défaut conservé jusqu'au bout : (1) `canonique.js` + vecteurs de test ; (2) `cles.json` + clé publique ; (3) `catalogue.js` : type `cloture-signee` (remplace la forme réservée `n8n-relecture`), vérification RSA ; (4) `publier-lot.js` : exige l'attestation de clôture, prend le badge dans l'attestation, supprime l'injection de types sans signature ; (5) CI : vérifie toute entrée `cloture-signee`, refuse tout autre type que `manuelle-historique` (liste close) et `cloture-signee` vérifiée ; (6) seulement alors, les workflows (inactifs).

## 12. Tests exigés

1. JS réel de chaque nœud Code ; `canonique.js` identique octet par octet entre Node et les nœuds n8n ; vecteurs fixes (empreinte, cœur, attestation).
2. XSS : charges dans **chaque** champ, y compris `</script>`, U+2028/U+2029, guillemets dans le JSON embarqué ; aucune exécution.
3. Sélection : `1abc`, `it1`, espaces, doublons (vrai webhook), champs inconnus, `confirmer_rejet` mal placé, corps > 64 Ko (vrai webhook).
4. **Entrelacements** (O1), barrières simulées entre chaque étape : même nonce même choix (idempotent) ; même nonce choix différents (409) ; deux nonces choix identiques (1 distinct) ; deux nonces choix différents (conflit, rien de signé) ; confirmation après révocation (refusée en C3) ; confirmation ayant passé C3 juste avant la révocation et écrivant pendant le délai (comptée) ; réémission pendant une confirmation ; panne juste après C6 (décision complète, vue par la clôture) ; fichier corrompu dans `decisions/` (conflit) ; décision mise en corbeille (comptée).
5. Signature : vecteurs ; attestation altérée d'un octet, clé révoquée, `cle_id` inconnu, `cloture_le` hors période, `selection`/`ecartees` non disjointes, `action = rejeter` → refus ; `publier-lot.js` et CI.
6. Conditions §8 prouvées sur la copie de test, résultats consignés.

## 13. Décisions d'Éric (2026-10-13)

1. Clé de relecture : **14 jours**.
2. **« Essayer une réponse » en v1**, `correction.js` depuis Pages uniquement (URL versionnée, SRI).
3. **Clôture manuelle obligatoire** à la place de la détection après coup.
4. **Signature locale sur le Mac d'Éric** (clé privée jamais dans n8n) — recommandation retenue ; **à confirmer explicitement par Éric**, car elle fixe le sens de l'attestation : « Éric a clôturé ce lot ».
5. Alertes « conflit » / « aucune décision » : **Éric seul**.
6. Historique des exécutions n8n conservé intégralement : aucune exception nécessaire (plus aucune clé privée dans n8n).
