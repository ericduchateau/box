# Cahier des charges — Relecture FONDA `/fonda-select` (Bloc 2, étape 7) — **v4**

> Statut : **v4 rédigée le 2026-10-13**, modèle **« l'humain garantit, la technique est un filet »** (décision Éric, option B), après trois relectures Codex (v1 : B1–B7 ; v2 : R1–R9 ; v3 : B1–B3, C1–C7). À valider par Éric, puis relecture Codex ciblée, **avant** tout workflow. Workflows livrés en JSON, **inactifs** ; activation sur feu vert explicite. Décisions d'Éric : §16.

## 0. Ce que garantit la chaîne — et ce qu'elle ne revendique pas

**Garantie (portée par des humains, rendue vérifiable par une signature)** : un lot n'est publiable que si **la relectrice (ou le relecteur) a confirmé, auprès d'Éric, exactement l'objet de décision signé** (cartes gardées, cartes écartées, règle de correction, empreintes), et si **Éric a signé cet objet sur son Mac**. Ce qui est confirmé est ce qui est signé, **octet pour octet** (§3).

**Le filet technique** (drainage n8n, rapprochement historique/Drive, refus des recherches Drive incomplètes, détection de doublons et de conflits, empreintes) **bloque tout ce qu'il détecte**. Il est **non probant** :

> **Limite écrite noir sur blanc.** Le socle (Google Drive + n8n 2.6.3) n'offre ni écriture atomique, ni journal infalsifiable, ni rétention garantie des exécutions, ni état d'exécution exhaustivement interrogeable (l'API ne filtre pas les exécutions `new`/en file ; une écriture Drive peut réussir sans être consignée ; un fichier peut disparaître ; les exécutions peuvent être purgées par âge ou par nombre). **Le silence du filet ne prouve donc pas l'exhaustivité des décisions.** FONDA ne revendique **aucune** preuve technique d'exhaustivité ni d'unicité. L'unicité de la décision publiée est garantie par la **confirmation humaine** de l'objet exact (§3) ; le filet sert à attraper ce qui est visible (conflit, doublon divergent, écriture incertaine, lien divulgué utilisé), et dans ce cas il **bloque** (§9).

**Non couvert, assumé** : un administrateur n8n ou Drive malveillant ; une relectrice qui confirme un objet sans l'avoir réellement examiné (la confirmation est un engagement humain, pas une preuve de lecture). **L'attestation affirme : « Éric a clôturé ce lot ; la relectrice <id> lui a confirmé, par <mode>, exactement ce cœur de décision ; il a été signé tel quel. »** Pour les lots où Éric est lui-même le relecteur, l'attestation le déclare (§4).

**Infrastructure partagée** avec BOX : séparation **fonctionnelle**, pas isolation. **Frontière CI** : la GitHub Action ne fait **que de la vérification publique** (empreintes, liste blanche, immuabilité, signatures à clé publique) ; elle ne détient jamais la clé privée RSA ni le jeton d'API n8n, qui restent sur le Mac d'Éric.

## 1. Fichiers, contrats, octets canoniques

Contrats **privés** (Drive `FONDA-Lots`, jamais commités) ; `lot-fonda/v1` public **inchangé**.

- **`candidat-fonda/v1`** — `en-attente/<set_id>.json` : `{ schema, lot, relecture }` ; `relecture = { statut ∈ {"en_attente","clos"}, generation_cle, cle_sha256, cree_le, expire_le, relecteur_attribue, referentiel_version, envois }`, `envois = [{ generation, cle_sha256, envoye_a, envoye_le, expire_le }]` (`envoye_a` = **identifiant**, jamais une adresse).
- **`decision-fonda/v1`** — `decisions/<set_id>__g<generation>__<nonce>.json` : `{ schema, set_id, generation, nonce, recu_le, coeur, lot_relu, hash_formulaire }` ; `coeur = { action, selection, ecartees, empreinte_relue, empreinte_publiee, version_correcteur }` ; rejet : `selection = []`, `empreinte_publiee = null`, `lot_relu = null`.

**Octets canoniques** (`fonda/engine/canonique.js`, recopié à l'identique dans les nœuds Code n8n, vecteurs fixes) : `JSON.stringify` d'ECMAScript sur une valeur **construite dans l'ordre de clés du contrat** ; UTF-8 sans BOM ; sans espace ni saut de ligne ; nombres finis seulement, forme `Number::toString` (`0.5` → `0.5`, `-0` → `0`), décimaux autorisés ; chaînes échappées comme `JSON.stringify` bien formé, **sans normalisation Unicode** ; **tous les champs présents** (défauts explicites `null`/`[]`/`false`), aucun champ inconnu. `hash_formulaire` = SHA-256 du canonique de `[[nom, valeur], …]` triés par nom (unités de code UTF-16). L'empreinte d'un lot reste `catalogue.js::texteEmpreinte`.

## 2. Routage figé à l'émission

- Relecteur attribué lu dans `referentiel.json` publié, d'après `notion_id` (inconnu → refus) ; `referentiel_version` = SHA-256 du contenu lu, retrouvé ensuite dans l'**historique Git** par le script local (introuvable → refus).
- `envois[]` trace chaque génération. Un envoi accepté par Gmail ne prouve ni livraison ni lecture.

## 3. Contrat de relecture : confirmation humaine de l'objet exact (cœur de la v4)

1. **Objet présenté** : à la clôture, le script local (§8) affiche **en clair** le **cœur de décision** retenu : liste des cartes **gardées** et **écartées** (question, réponse attendue), **règle de correction** de chaque carte gardée (profil, réponses acceptées, unité, arrondi, seconde chance), `empreinte_relue`, `empreinte_publiee`, et le **code de confirmation** = 16 premiers caractères hex de `SHA-256(canonique(coeur))`, groupés par 4 (ex. `3f2a-91c0-7b44-e8d1`).
2. **Confirmation** : Éric relit ce récapitulatif **avec la relectrice** — de vive voix, ou par message direct en lui envoyant le texte produit par le script (`--exporter-recapitulatif`). La relectrice confirme **cet objet**, en reprenant le **code de confirmation**. Pas de « oui, j'ai relu » détaché du contenu.
3. **Couplage strict** : le script exige qu'Éric **tape le code confirmé** ; il doit être égal au code calculé sur le cœur qui sera signé. Le cœur signé est **exactement** celui dont le code a été confirmé (octet pour octet, via le hash). Toute différence → pas de signature.
4. **Sans confirmation : pas de clôture, pas de signature.** Une relectrice qui ne reconnaît pas la décision (lien divulgué, décision parasite, conflit invisible) arrête la chaîne.
5. **Enregistrement** dans l'attestation : `confirmation = { mode ∈ {"vive_voix","message_direct","auto"}, par: <id relecteur>, recue_par: "eric", le: <date ISO>, code: <code confirmé> }`. Le mode et la date sont **déclarés par Éric** sous sa signature.

## 4. Auto-confirmation (relecteur = clôtureur), nommée honnêtement

- Quand `relecteur_attribue === "eric"` (lots de mathématiques), Éric est à la fois relecteur et clôtureur : `confirmation.mode = "auto"`, `confirmation.par = "eric"`, et l'attestation porte **`relecteur_egal_cloturer: true`**. Le code de confirmation reste exigé (Éric confirme l'objet exact qu'il signe).
- **FONDA ne prétend pas à une double relecture** pour ces lots. Le badge élève est **« Fiche relue par Éric Duchateau »** (pas « relue et validée par… ») : Éric atteste sa propre relecture, rien ne suggère un contrôle à deux personnes. Même formulation pour les 8 lots historiques (relus par Éric seul) — changement de libellé côté front prévu à la migration (§13).

## 5. Clé de relecture, révocation

- Crypto v1 « Generate », hex 64 ; seul `cle_sha256` est stocké ; **validité 14 jours**.
- **Seuls les workflows manuels écrivent le candidat** (génération, réémission, clôture), lancés par Éric ; les confirmations ne l'écrivent jamais.
- Contrôle C3 (§6) : candidat **téléchargé par cette exécution** : `statut === "en_attente"` ET `sha256(k) === cle_sha256` ET `generation_cle === form.generation` ET `maintenant < expire_le`. La **révocation** (`statut = "clos"`) interdit les **nouvelles** autorisations ; une confirmation déjà autorisée peut encore écrire — c'est le **filet** (§9) qui tente de le voir, et la **confirmation humaine** (§3) qui garantit.
- Réémission (manuelle, si `en_attente`) : nouvelle génération ajoutée à `envois`. Les décisions de toutes les générations sont examinées à la clôture.

## 6. Page et confirmation de relecture

**Page (GET `/fonda-select?lot=<set_id>&k=<clé>`, aucune écriture)** : par carte, question, réponse attendue, **profil avec explication et exemple concret**, toutes les réponses acceptées, `unite`, `arrondi`, `seconde_chance` ; choix « Garder / Écarter » sans défaut ; « Tout rejeter » séparé avec confirmation ; **« Essayer une réponse »** avec le vrai correcteur à une **URL versionnée et conservée** (`…/fonda/engine/correction-v<N>.js`), **SRI épinglée**, `crossorigin="anonymous"`, `version_correcteur` portée par la décision. Données vers le script : un `<script type="application/json">` échappé (`<`, `>`, `&`, U+2028/9 en `\uXXXX`), lu par `JSON.parse` ; aucun `onclick`. CSP : `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-<aléa>' <URL exacte du correcteur>; form-action <URL exacte de confirmation>; base-uri 'none'` (+ cadre selon §12.3). Jeton : `HMAC-SHA256(secret, canonique(["fonda-select/v4", set_id, generation_cle, cle_sha256, empreinte_affichee, expire_page, nonce]))`, `expire_page = min(+2 h, expire_le)`.

**Confirmation (POST `/fonda-select-confirm`)** :
- **C1** syntaxe avant Drive : ≤ 64 Ko (octets reçus, vrai webhook) ; champs exactement `lot, k, generation, empreinte, expire_page, nonce, jeton, action` + `choix_<item_id>` (accepter) ou `confirmer_rejet=oui` (rejeter) ; doublons de champ → 400 (vrai webhook).
- **C2** jeton ; **C3** candidat + clé (§5) ; **C4** empreinte actuelle = affichée ; **C5** sélection sémantique (chaque carte exactement un choix, ≥ 1 gardée pour accepter ; lot relu = gardées dans l'ordre, `item_id` d'origine, `lot-fonda/v1`) ; **C5bis** relecture du candidat (filet).
- **C6** écriture de `decisions/<set_id>__g<generation>__<nonce>.json`. **Doublons (C6 Codex)** : avant d'écrire, on cherche **tous** les fichiers de ce nom ; s'ils existent, leurs cœurs sont comparés : tous identiques au cœur soumis → même résultat, pas d'écriture ; un seul différent → 409. Sans écriture conditionnelle Drive, deux POST simultanés de même nonce peuvent créer deux fichiers : c'est **accepté** et traité à la clôture (§9 : cœurs identiques = une seule décision sémantique ; différents = blocage). La sortie de l'exécution consigne `{ set_id, generation, nonce, coeur_sha256, drive_file_id }`.
- **C7** mail de confirmation au relecteur attribué ; son échec n'annule rien.
- Défense de fond : `executionTimeout = 120 s` ; jamais de reprise manuelle d'une exécution de confirmation (§9).

## 7. Recherche Drive stricte

`set_id` validé par regex avant interpolation ; requête **Advanced Search** `'<id en-attente>' in parents and name = '<set_id>.json' and mimeType = 'application/json' and trashed = false` ; projection avec `nextPageToken` **et** `incompleteSearch` ; `incompleteSearch = true` → refus ; pagination complète ; tous les résultats traités ; 0 ou > 1 → refus ; `set_id` interne = nom. Aucun `file_id` client ; écritures uniquement dans les dossiers FONDA ; test statique : aucun id ni route BOX, Crypto v1 uniquement.

## 8. Clôture

**Workflow n8n `FONDA - Cloturer relecture`** (manuel) : (1) révocation `statut = "clos"` ; (2) listing de `decisions/` — corbeille comprise, pagination complète, `incompleteSearch` contrôlé, **chaque** fichier lu — sortie = manifeste de tous les fichiers + cœurs canoniques + `lot_relu` des décisions du lot. Aucun fichier de clôture ne fait foi.

**Script local `fonda/scripts/signer-cloture.js`** (Mac d'Éric ; secrets locaux : clé privée RSA et jeton d'API n8n, hors dépôt et hors Dropbox ; requêtes **GET** uniquement) :
1. **Provenance** : lit l'exécution de clôture par l'API (workflow de clôture épinglé, `status = success`, même `set_id`). Si une confirmation a écrit après le listing, le script refuse et demande **une nouvelle exécution de clôture** (inventaire rafraîchi après drainage) ; une exécution de clôture n'est réutilisable que si elle est la **plus récente** pour ce lot.
2. **Filet** (§9) : toute détection → **arrêt**.
3. **Sélection du cœur** : exactement un cœur distinct d'action `accepter` parmi les décisions du lot (sinon arrêt) ; toutes ses enveloppes ont le même `lot_relu` canonique et `empreinte(lot_relu) = empreinte_publiee`.
4. **Revérifications** : `empreinte_relue` = empreinte du candidat ; `lot_relu` = candidat filtré (ordre, `item_id`) ; `lot-fonda/v1` ; garde-fous du correcteur ; attribution d'après le référentiel archivé.
5. **Confirmation humaine** (§3/§4) : récapitulatif, code, saisie du code confirmé, mode, date.
6. **Signature** de la charge utile (§10), puis **revérification immédiate** avec la clé publique.

## 9. Le filet : ce qu'il regarde, et le sort de chaque détection

Le filet **bloque** dès qu'il voit l'un de ces cas ; **son silence n'est jamais une preuve** (§0).

| Détection | Sort |
|---|---|
| Exécution de confirmation (POST) **non terminée** : `running`, `waiting`, ou tout statut **non terminal ou inconnu** (dont `new`), observée sans filtre de statut (pagination complète) **et** avec les filtres disponibles | **Arrêt.** Relancer la clôture plus tard. |
| Exécution POST **`error`, `crashed` ou `canceled`** depuis la création du candidat, **quelle que soit la dernière étape atteinte** (une écriture Drive a pu réussir sans être consignée) | **Arrêt**, sauf **levée par Éric** : il examine l'exécution et Drive, et inscrit `levees = [{ execution_id, statut, constat }]` dans l'attestation **signée**. Une levée **ne prouve pas** l'absence d'écriture ; elle déclare qu'Éric l'a examinée. La garantie reste la confirmation humaine (§3). |
| Exécution POST **sans données exploitables** (`set_id` absent, données tronquées) dans la fenêtre de recherche | Traitée comme **pertinente** : même sort que la ligne précédente. Une exécution n'est jamais écartée faute de données. |
| Décision consignée par une exécution (toutes statuts confondus) **absente de Drive** | **Arrêt** (décision disparue). |
| Fichier de `decisions/` **sans exécution correspondante** | **Arrêt** (origine inconnue). |
| Fichier **illisible ou non conforme** dans `decisions/` | **Arrêt** ; procédure de **quarantaine** traçable (déplacement manuel par Éric vers `quarantaine/`, noté dans `levees`). |
| Recherche Drive **`incompleteSearch = true`** ou pagination interrompue | **Arrêt.** |
| **≥ 2 cœurs distincts**, ou cœurs identiques avec `lot_relu` différents | **Arrêt** (conflit) ; alerte à Éric seul. Réémission ou rejet. |
| Plusieurs fichiers de **cœur identique** (doublons, même ou plusieurs nonces/générations) | **Pas d'arrêt** : une seule décision sémantique. Toutes leurs provenances sont listées (§10). |
| Plus ancienne exécution POST disponible **postérieure** à la création du candidat, ou réglages de rétention de l'instance inconnus | **Avertissement bloquant** levable par Éric (inscrit dans `levees`) : l'historique peut avoir été purgé ; le filet est alors aveugle. |
| Horloges : les dates servent **à parcourir**, jamais seules à exclure ; fenêtre de recherche élargie de 24 h avant `cree_le` ; toute exécution dont l'appartenance au lot ne peut être exclue est examinée. | — |

## 10. Attestation : charge utile signée, enveloppe, clés (C3)

- **Charge utile** `attestation-cloture/v1` (signée) : `{ schema, set_id, notion_id, palier, coeur, code_confirmation, confirmation, relecteur_attribue, relecteur_egal_cloturer, provenances, referentiel_version, version_correcteur, execution_cloture, revoque_le, levees, cloture_le, badge, cle_id }` ; `provenances = [{ generation, nonce, envoye_a, envoye_le }]` de **toutes** les enveloppes portant le cœur retenu, triées par (`generation`, `nonce`) — `envoye_a` est un identifiant (C7). Tous les champs présents (`levees = []` par défaut).
- **Signature** = RSA-SHA256 PKCS#1 v1.5 sur les **octets canoniques de la charge utile** (qui ne contient pas de champ `signature`). **Enveloppe** publiée dans le catalogue : `attestation = { type: "cloture-signee", charge: <charge utile>, signature: <base64> }`.
- **Clés** : `fonda/data/cles/cles.json` = `[{ cle_id, fichier: "cles/<cle_id>.pub.pem", sha256_pem, algorithme: "RSA-SHA256/PKCS1v1.5", valide_du, valide_au, revoquee_le }]`. Le vérificateur charge la clé **uniquement** via `cle_id` → `fichier` déclaré, contrôle `sha256_pem`, la période et la révocation ; **jamais** de chemin fourni par l'attestation.
- **Vérification** (`publier-lot.js` + CI) : signature ; `schema` et `type` reconnus et liés ; `set_id`/`notion_id`/`palier` = lot publié ; `coeur.action = "accepter"` ; `selection`/`ecartees` disjointes, sans doublon ; `selection` = `item_ids` du fichier ; **`coeur.empreinte_publiee` = empreinte du fichier publié** ; `code_confirmation` = code recalculé sur `coeur` ; `confirmation` cohérente (`mode = "auto"` ⇔ `relecteur_egal_cloturer = true` ⇔ `relecteur_attribue = "eric"`) ; badge cohérent (§11).
- **Vecteurs de test complets** : JSON de charge utile → octets UTF-8 (hex) → signature (clé de test) → vérification ; altération d'un octet → échec.

## 11. Badge élève (trois formes exactes)

| Situation | `badge` (signé) | Texte élève |
|---|---|---|
| Tiers relecteur ayant confirmé (§3) | `{ forme: "relue_et_validee", nom_affiche: <nom>, par: <id> }` | « Fiche relue et validée par <nom> » |
| Auto-confirmation (§4) | `{ forme: "relue_par", nom_affiche: "Éric Duchateau", par: "eric" }` | « Fiche relue par Éric Duchateau » |
| Sans nom | `{ forme: "relue_par", nom_affiche: "un professeur", par: null }` | « Fiche relue par un professeur » |

Toute autre combinaison → refus. L'entrée du catalogue porte `relecteur = { id, nom_affiche, forme }` égal au badge signé (vérifié par la CI) ; le front construit le texte depuis `forme`. Le badge n'est jamais dérivé d'un autre champ.

## 12. Conditions d'activation — à prouver sur la copie de test

1. **Observation des exécutions** : l'API de l'instance retourne bien, sans filtre et avec filtres, les exécutions du POST (dont une exécution lente en cours) ; le jeton a accès aux workflows de relecture (une liste vide due à un défaut d'accès doit être distinguée : contrôle préalable que le workflow est lisible).
2. **Révocation** : GET ouvert, clôture lancée, soumission ensuite → refus C3/C5bis.
3. **Iframe et en-têtes** en navigateur réel (GET → POST → confirmation, rejet, erreurs), en-têtes réellement servis ; résultat consigné.
4. **Limites** : refus immédiat des requêtes invalides ; aucune relance ni reprise manuelle des exécutions de confirmation.
5. **Rétention** : `EXECUTIONS_DATA_PRUNE`, `EXECUTIONS_DATA_MAX_AGE`, `EXECUTIONS_DATA_PRUNE_MAX_COUNT` de l'instance **relevés et consignés** ; la clôture a lieu avant l'horizon connu. (Ce n'est pas une garantie : c'est ce qui permet au filet de voir.)
6. **Réglages GitHub** de l'annexe A appliqués par Éric.

## 13. Migration avant toute ouverture — refus par défaut jusqu'au bout

(1) `canonique.js` + vecteurs ; (2) `cles.json` + clé publique ; (3) `catalogue.js` : type `cloture-signee` (enveloppe), **suppression de la forme `n8n-relecture` acceptée sans signature**, vérification RSA asynchrone dédiée ; (4) `relecteur.forme` dans le catalogue et libellé du front (« relue par » / « relue et validée par »), y compris les 8 lots historiques passés en « relue par Éric Duchateau » (changement de libellé, **pas** de contenu : empreintes figées inchangées) ; (5) `publier-lot.js` : exige l'enveloppe signée, compare `empreinte_publiee` au fichier, badge de l'attestation, plus d'injection de types ; (6) CI : vérification des signatures, **immuabilité contre la base** (C5, annexe B) ; (7) `signer-cloture.js` + tests hors ligne (API n8n et Drive simulés) ; (8) seulement alors, les workflows (inactifs).

## 14. Tests exigés

1. JS réel des nœuds Code ; `canonique.js` octet par octet (Node ↔ n8n) ; vecteurs fixes (décimaux, surrogates).
2. XSS dans chaque champ (`</script>`, U+2028/9, guillemets) ; aucune exécution.
3. Sélection malformée et doublons sur le **vrai** webhook ; corps > 64 Ko.
4. Filet (§9), une ligne = au moins un test : exécution `new`/`running`/`waiting`/statut inconnu ; `error`/`crashed`/`canceled` à toute étape (dont **après** C6) ; exécution sans données ; décision disparue ; fichier d'origine inconnue ; fichier illisible ; `incompleteSearch` ; cœurs divergents ; doublons de cœur identique (non bloquant) ; historique purgé ; écriture postérieure au listing (nouvelle clôture exigée).
5. **Contrat humain** : code tapé différent → pas de signature ; code égal mais cœur modifié entre affichage et signature → pas de signature ; auto-confirmation hors maths → refus ; tiers en mode `auto` → refus.
6. Signature : vecteurs ; altération ; clé révoquée, inconnue, `sha256_pem` différent, période dépassée ; badge incohérent ; `action = rejeter`.
7. CI : modification d'une empreinte publiée → rouge ; réintroduction d'un `set_id` déjà utilisé → rouge ; retrait seul → vert ; re-signature à contenu identique → vert.

## 15. Annexes

### A. Réglages GitHub à appliquer par Éric (liste à relire avant exécution)

1. **Settings → Actions → General** : Actions activées pour le dépôt ; « Workflow permissions » = **Read repository contents** (lecture seule).
2. **Settings → Branches → Add branch protection rule**, motif **`main`** :
   - ☑ *Require a pull request before merging* (approbations requises : 0 si Éric est seul mainteneur ; ☑ *Dismiss stale approvals* sans objet) ;
   - ☑ *Require status checks to pass before merging* → ☑ *Require branches to be up to date* → ajouter le contrôle **`tests (node --test)`** ;
   - ☑ *Do not allow bypassing the above settings* (s'applique aussi aux administrateurs) ;
   - ☐ *Allow force pushes* (désactivé) ; ☐ *Allow deletions* (désactivé).
3. Même règle pour **`design`**.
4. **Settings → Pages** : *Source* = **Deploy from a branch**, branche **`main`**, dossier **`/ (root)`** — à vérifier (c'est la source supposée du site actuel). Ainsi, seul un commit ayant passé la PR et le contrôle requis atteint Pages. *(Alternative plus stricte, à décider plus tard : déploiement Pages par une GitHub Action qui ne publie qu'après `tests` réussi.)*
5. **Contrôle après réglage** : ouvrir une PR de test qui casse volontairement un test → le bouton *Merge* doit être bloqué ; tenter un `git push` direct sur `design` → refusé.

### B. Immuabilité en CI (C5)

Sur PR : comparer `catalogue-fonda.json` de la **branche de base** (`origin/<base>`) à celui de la PR. Sur push vers `design`/`main` : comparer au commit précédent (`github.event.before`). Règles : un `set_id` présent dans la base doit garder **la même empreinte** (retrait autorisé ; remplacement d'attestation autorisé **seulement** à empreinte identique et nouvelle signature valide) ; un `set_id` nouveau ne doit apparaître **dans aucune version antérieure** du catalogue (historique Git du fichier) ni parmi les `set_id` de `lots-fonda-calibration/` — sinon rouge.

## 16. Décisions d'Éric (2026-10-13)

1. Clé de relecture : 14 jours. 2. « Essayer une réponse » en v1 (URL versionnée, SRI). 3. Clôture manuelle obligatoire. 4. Signature locale sur le Mac d'Éric. 5. Historique n8n conservé partout. 6. GitHub Action bloquante, vérification publique uniquement. 7. **Option B : l'humain garantit l'unicité (confirmation de l'objet exact, couplage octet pour octet), la technique est un filet bloquant mais non probant.** 8. **Auto-confirmation des lots de maths déclarée** ; badge « relue par Éric Duchateau », aucune double relecture revendiquée. 9. Alertes de conflit : Éric seul.
