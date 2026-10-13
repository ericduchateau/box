# Cahier des charges — Relecture FONDA `/fonda-select` (Bloc 2, étape 7) — **v5**

> Statut : **v5 rédigée le 2026-10-13**, modèle **« l'humain garantit, la technique est un filet »** (option B), après la relecture Codex de la v4 (B1–B3, C1–C8). À valider par Éric, puis relecture Codex ciblée, **avant** tout workflow. Workflows en JSON, **inactifs** ; activation sur feu vert explicite. **Annexe A : rien n'est appliqué sur GitHub avant le retour Codex et la relecture d'Éric.** Décisions d'Éric : §17.

## 0. Garantie, filet, limites

**Garantie (humaine, rendue vérifiable par une signature)** : un lot n'est publiable que si la relectrice a confirmé auprès d'Éric **exactement l'instantané figé** (§3) — cartes gardées et écartées, règle de correction, **version du correcteur que l'élève exécutera** (§4) — et si Éric a signé cet instantané sur son Mac. **Confirmation, signature et correcteur de l'élève forment un seul objet lié** (§3, §4, §11).

**Filet technique** (exécutions n8n, rapprochement historique/Drive, recherches Drive, conflits, empreintes) : il **bloque** ce qu'il détecte (§10). **Il est non probant.**

> **Limite, noir sur blanc.** Drive + n8n 2.6.3 n'offrent ni écriture atomique, ni journal infalsifiable, ni rétention garantie, ni état d'exécution exhaustivement interrogeable (pas de filtre `new`/en file ; écriture Drive réussie mais non consignée possible ; fichiers supprimables ; purge par âge ou par nombre). **Le silence du filet ne prouve pas l'exhaustivité.** FONDA ne revendique **aucune** preuve technique d'exhaustivité ni d'unicité : l'unicité de ce qui est publié repose sur la **confirmation humaine** de l'instantané exact.

**Ce que prouve la signature** : la **déclaration d'Éric** (« la relectrice `<id>` m'a confirmé, par `<mode>`, cet instantané exact, transmis sans retouche ; je l'ai signé »). Elle ne prouve pas indépendamment l'intervention de la relectrice ni qu'elle a réellement examiné chaque carte.

**Non couvert, assumé** : administrateur n8n/Drive malveillant ; relectrice confirmant sans examiner ; Éric déclarant faussement (il est la racine de confiance).

**Infrastructure partagée** avec BOX : séparation **fonctionnelle**. **Frontière CI** : vérification publique uniquement (empreintes, liste blanche, immuabilité, signatures à clé publique) ; jamais la clé privée RSA ni le jeton n8n. **Le front ne vérifie pas RSA** : il sert le catalogue **mergé**, et vérifie l'empreinte et la SRI de ce qu'il charge (§4, §12).

## 1. Contrats privés et octets canoniques

`lot-fonda/v1` public **inchangé**. Contrats privés (Drive `FONDA-Lots`) :
- **`candidat-fonda/v1`** — `en-attente/<set_id>.json` : `{ schema, lot, relecture }` ; `relecture = { statut ∈ {"en_attente","clos","abandonne"}, generation_cle, cle_sha256, cree_le, expire_le, relecteur_attribue, referentiel_version, version_correcteur, envois }`, `envois = [{ generation, cle_sha256, envoye_a, envoye_le, expire_le }]` (`envoye_a` = identifiant, jamais une adresse).
- **`decision-fonda/v1`** — `decisions/<set_id>__g<generation>__<nonce>.json` : `{ schema, set_id, generation, nonce, recu_le, coeur, lot_relu, hash_formulaire }` ; `coeur = { action, selection, ecartees, empreinte_relue, empreinte_publiee, version_correcteur }`.

**Octets canoniques** (`fonda/engine/canonique.js`, recopié à l'identique dans les nœuds Code, vecteurs fixes) : `JSON.stringify` d'ECMAScript sur une valeur construite dans l'**ordre de clés du contrat** ; UTF-8 sans BOM, sans espace ni saut de ligne ; nombres finis, forme `Number::toString` (`0.5`, `-0` → `0`) ; chaînes échappées comme `JSON.stringify` bien formé, **sans normalisation Unicode** ; tous les champs présents (défauts `null`/`[]`/`false`) ; aucun champ inconnu. **Portée de « octet pour octet »** : le **cœur**, l'**instantané** et la **charge signée** ; les fichiers de lot publiés sont, eux, liés par leur **empreinte pédagogique** (`catalogue.js::texteEmpreinte`), pas par tous leurs octets JSON (C8).

## 2. Routage figé à l'émission

Relecteur attribué lu dans `referentiel.json` publié d'après `notion_id` (inconnu → refus). `referentiel_version` = SHA-256 du contenu lu, retrouvé dans l'historique Git par le script local (introuvable → refus). `envois[]` trace chaque génération ; un envoi accepté ne prouve ni livraison ni lecture.

## 3. Instantané figé et confirmation humaine (B1, C2)

1. **Instantané** : à la clôture, le script local construit **un seul** objet `instantane-fonda/v1 = { schema, set_id, candidat_lot, coeur, lot_relu, version_correcteur, correcteur_sha256, recapitulatif }` où `recapitulatif` est un **texte déterministe** généré depuis `candidat_lot` + `coeur` + `version_correcteur` (cartes gardées et écartées avec question et réponse attendue ; pour chaque carte gardée : profil, réponses acceptées, unité, arrondi, seconde chance ; version du correcteur ; empreintes). Il calcule `sha256_instantane` = SHA-256 **complet** de ses octets canoniques, et le **code de confirmation** = 16 premiers hex groupés par 4 (repère humain **seulement** ; n'authentifie ni personne ni message).
2. **Affichage, export, signature dérivent de cet instantané unique**, enregistré localement (`~/…/fonda-clotures/<set_id>/instantane.json`, hors dépôt, hors Dropbox) au moment de sa construction ; il n'est **jamais reconstruit** ensuite.
3. **Transmission sans retouche** : pour la confirmation par message, le script **exporte le récapitulatif en fichier** (`recapitulatif-<set_id>-<code>.txt`, contenu = `recapitulatif` + le `sha256_instantane` complet en dernière ligne). Éric l'envoie **en pièce jointe, tel quel**, et la relectrice **répond à ce message** en citant le code. Pour la confirmation de vive voix, Éric et la relectrice lisent **l'affichage du script**.
4. **Signature** : le script relit l'instantané enregistré, recalcule `sha256_instantane`, exige qu'Éric **tape le code confirmé** (égal au code de cet instantané) et qu'il **atteste la fidélité de transmission** (« transmis sans retouche ; réponse rattachée à ce message »). La comparaison qui fait foi est celle des **octets et du SHA-256 complet** de l'instantané enregistré, pas le code.
5. **Sans confirmation : pas de clôture, pas de signature.** Une relectrice qui ne reconnaît pas l'instantané arrête la chaîne.
6. **Trace locale** (non probante, utile en cas d'erreur) : le fichier exporté et la réponse de la relectrice sont conservés dans le dossier local de clôture.

## 4. Correcteur immuable, lié de bout en bout (B2)

- **Registre** `fonda/engine/correcteurs.json` = `[{ version: "v<N>", fichier: "fonda/engine/correction-v<N>.js", sha256, sri }]`. Un fichier de correcteur versionné est **immuable** une fois publié (CI, annexe B). L'actuel `correction.js` devient `correction-v1.js` (copie à l'identique) à la migration.
- **Liaison** : `version_correcteur` est fixée **dans le candidat** à la génération ; la page de relecture charge **ce** fichier (URL versionnée, SRI du registre) pour « Essayer une réponse » ; elle figure dans le **jeton HMAC** et dans un **champ POST obligatoire** comparé au candidat (§7) ; elle est dans le **cœur**, l'**instantané**, la **charge signée** et l'**entrée du catalogue**.
- **Front élève** : pour un lot, `bootstrap.js` charge **le correcteur de la version de l'entrée** (`correction-v<N>.js`, attribut `integrity` = SRI du registre), **jamais** un `correction.js?v=…` qui dérive. Version inconnue ou SRI en échec → lot « pas disponible ». Ainsi **la relectrice a essayé exactement le comportement que l'élève reçoit**.
- **Lots historiques** : `version_correcteur = "v1"` déclarée à la migration ; **leur relecture du 11/10 n'a pas utilisé « Essayer une réponse »** — l'entrée le mentionne (`correcteur_essaye: false`).

## 5. Auto-confirmation (relecteur = clôtureur)

Règle **par identité** (pas par matière) : quand `relecteur_attribue === "eric"`, `confirmation.mode = "auto"`, `confirmation.par = "eric"`, `relecteur_egal_cloturer = true`. Le code et l'instantané restent exigés. **FONDA ne revendique pas de double relecture** : badge « Fiche relue par Éric Duchateau » (§12).

## 6. Clé de relecture, statuts du candidat (C4)

- Crypto v1 « Generate », hex 64 ; seul `cle_sha256` est stocké ; **validité 14 jours**.
- **Seuls les workflows manuels écrivent le candidat** (génération, réémission, clôture, abandon), lancés par Éric, jamais en parallèle ; les confirmations ne l'écrivent jamais.
- Contrôle C3 (§7) sur le candidat téléchargé par l'exécution : `statut === "en_attente"`, `sha256(k) === cle_sha256`, `generation_cle === form.generation`, `maintenant < expire_le`. La révocation (`clos`) interdit les **nouvelles** autorisations.
- **Statuts** : `en_attente → clos` (clôture) ; `en_attente → en_attente` (réémission, nouvelle génération) ; `en_attente | clos → abandonne` (abandon). **Après un blocage dur (§10), la seule issue est l'abandon** : workflow manuel `FONDA - Abandonner candidat` (statut `abandonne`, raison, fichiers en quarantaine listés dans `abandons/<set_id>.json`) puis **nouveau candidat** avec un **nouveau `set_id`** (séquence suivante, cartes et `item_id` repris). Jamais de réémission d'un candidat `clos`.

## 7. Page et confirmation de relecture

**GET** (aucune écriture) : par carte, question, réponse attendue, profil avec **explication et exemple concret**, toutes les réponses acceptées, `unite`, `arrondi`, `seconde_chance` ; choix « Garder / Écarter » sans défaut ; « Tout rejeter » séparé ; « Essayer une réponse » avec `correction-v<N>.js` (SRI du registre, `crossorigin="anonymous"`). Données vers le script : `<script type="application/json">` échappé (`<`, `>`, `&`, U+2028/9), `JSON.parse`, aucun `onclick`. CSP : `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-<aléa>' <URL exacte du correcteur>; form-action <URL exacte de confirmation>; base-uri 'none'` (+ cadre selon §13.3). Jeton : `HMAC-SHA256(secret, canonique(["fonda-select/v5", set_id, generation_cle, cle_sha256, empreinte_affichee, version_correcteur, expire_page, nonce]))`.

**POST** :
- **C1** syntaxe avant Drive : ≤ 64 Ko (octets reçus, vrai webhook) ; champs exactement `lot, k, generation, empreinte, version_correcteur, expire_page, nonce, jeton, action` + `choix_<item_id>` (accepter) ou `confirmer_rejet=oui` (rejeter) ; doublons de champ → 400.
- **C2** jeton ; **C3** candidat + clé (§6) et `version_correcteur` = celle du candidat ; **C4** empreinte actuelle = affichée ; **C5** sélection sémantique ; **C5bis** relecture du candidat.
- **C6** avant d'écrire, recherche de **tous** les fichiers de même nom : cœurs tous identiques → même résultat, pas d'écriture ; **un cœur différent → sortie structurée `{ type: "conflit", set_id, nonce, coeur_sha256_existant, coeur_sha256_soumis }` consignée dans l'exécution, puis réponse 409** (B3). Sinon écriture, et sortie `{ type: "decision", set_id, generation, nonce, coeur_sha256, drive_file_id }`.
- **C7** mail au relecteur attribué ; son échec n'annule rien. Défense de fond : `executionTimeout = 120 s` ; **jamais** de reprise manuelle d'une exécution de confirmation.

## 8. Recherche Drive stricte

`set_id` validé par regex avant interpolation ; Advanced Search `'<id en-attente>' in parents and name = '<set_id>.json' and mimeType = 'application/json' and trashed = false` ; projection avec `nextPageToken` et `incompleteSearch` ; pagination complète ; tous les résultats traités ; 0 ou > 1 → refus ; `set_id` interne = nom. Aucun `file_id` client ; écritures uniquement dans les dossiers FONDA ; test statique : aucun id ni route BOX, Crypto v1 uniquement.

## 9. Clôture

**Workflow `FONDA - Cloturer relecture`** (manuel) : révocation (`clos`) ; listing de `decisions/` (corbeille comprise, pagination complète, `incompleteSearch` relevé, chaque fichier lu) ; sortie = manifeste de tous les fichiers + cœurs canoniques + `lot_relu`. Aucun fichier de clôture ne fait foi.

**Script local `fonda/scripts/signer-cloture.js`** (Mac d'Éric ; secrets locaux : clé privée RSA et jeton n8n, hors dépôt et hors Dropbox ; requêtes **GET** uniquement) : (1) provenance de l'exécution de clôture par l'API (workflow épinglé, `success`, même `set_id`, **la plus récente** pour ce lot ; si une écriture est postérieure au listing → nouvelle clôture exigée) ; (2) filet (§10) ; (3) un seul cœur distinct d'action `accepter`, enveloppes cohérentes (même `lot_relu`, `empreinte(lot_relu) = empreinte_publiee`) ; (4) revérifications (empreinte relue = candidat ; lot relu = candidat filtré ; `lot-fonda/v1` ; garde-fous du correcteur `v<N>` ; référentiel archivé) ; (5) **instantané figé** et **confirmation** (§3, §5) ; (6) signature (§11) et revérification immédiate.

## 10. Le filet : sort de chaque détection (C1)

**Ordre** : on évalue **toutes** les détections ; **un seul blocage dur suffit** à arrêter ; une levée ne neutralise **jamais** un autre blocage ; le silence n'est jamais une preuve (§0).

**Blocages durs — non levables, issue unique : abandon + nouveau candidat (§6)**

| Détection |
|---|
| Exécution de confirmation **non terminée** ou **au statut inconnu** (dont `new`, `running`, `waiting`), observée avec et sans filtre, pagination complète |
| Exécution de confirmation **`error`, `crashed`, `canceled`**, à quelque étape que ce soit |
| Exécution **sans données exploitables** dans la fenêtre de recherche (jamais écartée faute de données) |
| **Sortie `conflit`** dans une exécution, **quel que soit son statut terminal** (B3) |
| **≥ 2 cœurs distincts**, ou cœurs identiques avec `lot_relu` différents |
| Décision consignée par une exécution **absente de Drive** (disparue) |
| Fichier de `decisions/` **sans exécution correspondante** (origine inconnue) |
| Fichier **illisible ou non conforme** dans `decisions/` (mis en quarantaine, tracé dans `abandons/`) |
| Jeton n8n sans accès aux workflows de relecture (liste vide non interprétable) |

**Blocages levables — uniquement ces deux, par Éric, signés, non probants, confirmation humaine toujours exigée**

| Détection | Levée |
|---|---|
| Recherche Drive **`incompleteSearch = true`** (après nouvelles tentatives) | `levees += { type: "recherche_incomplete", constat }` |
| Historique **peut-être purgé** (plus ancienne exécution disponible postérieure au candidat, ou réglages de rétention inconnus) | `levees += { type: "historique_incomplet", constat }` |

**Non bloquant** : plusieurs fichiers de **cœur identique** (une seule décision sémantique, §11 provenances). **Horloges** : les dates servent à parcourir (fenêtre élargie de 24 h avant `cree_le`), jamais seules à exclure.

## 11. Attestation : charge signée, enveloppe, clés (C3, C5)

- **Charge** `attestation-cloture/v1` : `{ schema, set_id, notion_id, palier, coeur, sha256_instantane, code_confirmation, confirmation, fidelite_transmission, relecteur_attribue, relecteur_egal_cloturer, provenances, nb_fichiers_decision, referentiel_version, version_correcteur, correcteur_sha256, execution_cloture, revoque_le, levees, cloture_le, badge, cle_id }`.
  - `confirmation = { mode ∈ {"vive_voix","message_direct","auto"}, par, recue_par: "eric", le }` ; `fidelite_transmission = { sans_retouche: true, reponse_rattachee: true }` (mode `message_direct`), `null` sinon.
  - `provenances` = **décision sémantique** : liste **dédupliquée** des `(generation, nonce, envoye_a, envoye_le)` portant le cœur retenu, triée ; `nb_fichiers_decision` = nombre de **fichiers physiques** correspondants (le détail fichier/exécution reste dans la trace locale de clôture, non publié) (C5).
- **Invariants vérifiés** (script, `publier-lot.js`, CI) : `code_confirmation` = code(`sha256_instantane`) ; `sha256_instantane` lui-même n'est **vérifiable que localement** (l'instantané contient des cartes écartées, non publiées) : le script le recalcule sur l'instantané enregistré avant de signer, la CI ne peut que contrôler sa forme ; `coeur.version_correcteur = version_correcteur = entree.version_correcteur` et `correcteur_sha256 = registre[version].sha256` ; `confirmation.par = relecteur_attribue` ; `mode = "auto"` ⇔ `relecteur_egal_cloturer` ⇔ `relecteur_attribue = "eric"` ; `badge.par = entree.relecteur.id`, `badge.nom_affiche = entree.relecteur.nom_affiche`, `badge.forme = entree.relecteur.forme` ; `selection` et `ecartees` disjointes, sans doublon, **partition des cartes du candidat** (vérifiée localement) ; `selection = item_ids` du fichier publié ; `coeur.empreinte_publiee` = empreinte du fichier publié ; `coeur.action = "accepter"`.
- **Signature** : RSA-SHA256 PKCS#1 v1.5 sur les octets canoniques de la **charge** (sans champ `signature`). **Enveloppe** dans le catalogue : `attestation = { type: "cloture-signee", charge, signature }`.
- **Clés** : `fonda/data/cles/cles.json` = `[{ cle_id (unique), fichier: "cles/<cle_id>.pub.pem" (SPKI PEM), sha256_pem, algorithme: "RSA-SHA256/PKCS1v1.5", valide_du, valide_au, revoquee_le }]`. Chargement **uniquement** via `cle_id` déclaré, `sha256_pem` contrôlé. **Recevabilité** : `cloture_le ∈ [valide_du, valide_au]` (une attestation signée pendant la validité **reste recevable après expiration** de la clé) ; clé **révoquée** → **toutes** ses attestations deviennent irrecevables (procédure §14).
- **Vecteurs de test** : charge → octets UTF-8 (hex) → signature (clé de test) → vérification ; altération d'un octet → échec.

## 12. Badge élève (C8)

| Situation | `badge` signé = `entree.relecteur` | Texte élève |
|---|---|---|
| Tiers relecteur ayant confirmé | `{ forme: "relue_et_validee", nom_affiche: <nom>, par: <id> }` | « Fiche relue et validée par <nom> » |
| Auto-confirmation (§5) | `{ forme: "relue_par", nom_affiche: "Éric Duchateau", par: "eric" }` | « Fiche relue par Éric Duchateau » |
| Sans nom | `{ forme: "relue_par", nom_affiche: "un professeur", par: null }` | « Fiche relue par un professeur » |

Toute autre combinaison → refus. **Lots historiques** (`manuelle-historique`, pas de badge signé) : exception figée : `entree.relecteur` doit valoir exactement `{ id: "eric", nom_affiche: "Éric Duchateau", forme: "relue_par" }` (changement de **libellé** seulement ; empreintes figées inchangées). Le libellé traverse tout le front : `bootstrap.js` → `adapterCarte` (transmet `forme` + `nom_affiche`) → `carte-reponse-produite.js` (qui affiche aujourd'hui en dur « relue et validée ») → texte selon `forme`.

## 13. Conditions d'activation — à prouver sur la copie de test

1. **Observation des exécutions** : l'API retourne, avec et sans filtre, les exécutions du POST (dont une lente en cours) ; contrôle préalable que le jeton lit bien les workflows de relecture.
2. **Révocation** : GET ouvert, clôture, soumission ensuite → refus.
3. **Iframe et en-têtes** en navigateur réel (GET → POST → confirmation, rejet, erreurs, conflit 409), en-têtes réellement servis ; consigné.
4. **Limites** : refus immédiat des requêtes invalides ; ni relance ni reprise manuelle des confirmations.
5. **Rétention** : `EXECUTIONS_DATA_PRUNE`, `EXECUTIONS_DATA_MAX_AGE`, `EXECUTIONS_DATA_PRUNE_MAX_COUNT` relevés et consignés (ce qui permet au filet de voir, pas une garantie).
6. **Correcteur** : le front charge bien `correction-v<N>.js` avec `integrity`, la SRI échoue si le fichier change.
7. **Annexe A** appliquée par Éric après relecture.

## 14. Révocation de la clé de signature

Rotation : nouvelle clé, `valide_au` fixée sur l'ancienne. Compromission : **une seule PR** qui fixe `revoquee_le` et, pour chaque lot concerné, soit le **retire** (quarantaine), soit remplace son attestation par une **nouvelle clôture** (instantané et confirmation **refaits**, pas une simple re-signature de l'ancienne charge suspecte), à **empreinte publiée identique**. La CI valide l'état final contre la base (annexe B).

## 15. Fichiers de confiance et mainteneur unique (C7)

- **Fichiers de confiance** : `.github/workflows/**` ; `fonda/engine/catalogue.js` (dont `HISTORIQUES_FIGES`) ; `fonda/engine/canonique.js` ; `fonda/engine/correcteurs.json` et `fonda/engine/correction-v*.js` ; `fonda/scripts/publier-lot.js` ; `fonda/scripts/verifier-immuabilite.js` ; `fonda/data/cles/**` ; `fonda/data/catalogue.test.js` et les tests des vérificateurs.
- **Garantie humaine, dite explicitement** : Éric est **mainteneur unique**. Pour ces fichiers, **sa relecture en PR est la garantie** ; **aucun mécanisme ne s'y substitue**. Protéger la branche ne protège pas la **valeur** du contrôle : une PR peut modifier le contrôle lui-même (remplacer `node --test`, changer à la fois vérificateurs et clés). C'est un **risque assumé**, couvert uniquement par cette relecture.
- **Marqueur (filet, non probant)** : un job `fichiers-de-confiance`, déclenché par **`pull_request_target`** (il s'exécute avec la définition de workflow de la **branche de base**, donc une PR ne peut pas le supprimer d'elle-même), **sans exécuter le code de la PR** (lecture seule de la liste des fichiers modifiés via l'API GitHub), publie un avertissement visible et un résumé « ⚠️ FICHIER DE CONFIANCE MODIFIÉ : … » dès qu'un fichier de la liste est touché. Il ne bloque pas : il dirige l'œil d'Éric.

## 16. Migration — refus par défaut jusqu'au bout (C8)

(1) `canonique.js` + vecteurs ; (2) `correcteurs.json` + `correction-v1.js` (copie) + chargement versionné et SRI dans le front ; (3) `cles.json` + clé publique ; (4) `catalogue.js` : type `cloture-signee` (enveloppe), **suppression de la forme `n8n-relecture` non signée**, `version_correcteur` et `relecteur.forme` dans l'entrée, exception figée des historiques ; (5) front : badge par `forme` à travers `bootstrap.js` → `adapterCarte` → `carte-reponse-produite.js` ; (6) `publier-lot.js` : exige l'enveloppe signée, **écrit l'instantané validé** (jamais une relecture du fichier source après validation), compare `empreinte_publiee` au fichier, badge de l'attestation ; (7) `verifier-immuabilite.js` + job CI (annexe B) et job `fichiers-de-confiance` ; (8) `signer-cloture.js` + tests hors ligne (API n8n et Drive simulés) ; (9) seulement alors, les workflows (inactifs).

## 17. Décisions d'Éric (2026-10-13)

1. Clé 14 j. 2. « Essayer une réponse » en v1. 3. Clôture manuelle obligatoire. 4. Signature locale sur le Mac d'Éric. 5. Historique n8n conservé partout. 6. GitHub Action, vérification publique uniquement. 7. Option B : l'humain garantit, la technique est un filet non probant. 8. Auto-confirmation déclarée (par identité `eric`), badge « relue par ». 9. **Instantané figé unique** (affichage, export, signature) ; transmission sans retouche attestée. 10. **Correcteur immuable lié de bout en bout**, y compris au front élève. 11. **Levées limitées à deux cas** (recherche incomplète, historique incomplet) ; tout signal d'intégrité réel = blocage dur → abandon + nouveau candidat. 12. **Mainteneur unique** : relecture d'Éric = garantie des fichiers de confiance, marqueur CI non probant. 13. Alertes : Éric seul.

## Annexe A — Réglages GitHub (corrigés, **non appliqués** ; relecture d'Éric avant exécution)

1. **Settings → Actions → General** : Actions autorisées pour le dépôt ; **Workflow permissions** = **« Read repository contents and packages permissions »** (c'est un défaut : un workflow peut demander davantage dans son fichier ; les nôtres déclarent `permissions: contents: read`).
2. **Settings → Branches → « Add classic branch protection rule »**, motif **`main`** :
   - ☑ **Require a pull request before merging** — **« Require approvals » laissé décoché** (mainteneur unique, §15) ;
   - ☑ **Require status checks to pass before merging** → ☑ **Require branches to be up to date before merging** → contrôles requis : **`tests (node --test)`** et **`immuabilite`** (annexe B), source attendue **GitHub Actions** ;
   - ☑ **Do not allow bypassing the above settings** (vaut pour les administrateurs ; n'empêche pas un administrateur de **modifier ensuite la règle** — risque assumé, §15) ;
   - ☐ Allow force pushes ; ☐ Allow deletions.
3. Même règle pour **`design`**.
4. **Rulesets** : non utilisés. S'il en existe, vérifier leur activation et leurs exceptions de contournement (ils se cumulent avec les règles classiques).
5. **Settings → Pages** : *Build and deployment → Source* = **Deploy from a branch**, branche **`main`**, dossier **`/ (root)`** — à vérifier (source supposée du site). Ce mode publie tout commit de `main` sans attendre des tests lancés **après** la fusion ; c'est acceptable parce que `main` n'accepte que des PR dont les contrôles requis sont passés. *(Option plus stricte, à décider plus tard : déploiement Pages par une Action dépendant de `tests` et publiant l'artefact du même commit.)*
6. **Contrôle après réglage** : PR de test qui casse un test → *Merge* bloqué ; PR touchant `fonda/engine/catalogue.js` → marqueur « fichier de confiance modifié » visible ; `git push` direct sur `design` → refusé.

## Annexe B — Immuabilité en CI (C6)

Script `fonda/scripts/verifier-immuabilite.js` + job **`immuabilite`** :
- **Référence de confiance** : sur `pull_request`, le SHA **`github.event.pull_request.base.sha`** ; sur `push`, **`github.event.before`**. L'historique antérieur de confiance = l'historique **de cette référence** (jamais l'historique de la tête de la PR : un lot ajouté au premier commit d'une PR ne doit pas être refusé au second).
- **Règles** : un `set_id` présent dans le catalogue de la référence garde la **même empreinte** (retrait autorisé ; remplacement d'attestation autorisé seulement à empreinte identique, nouvelle clôture valide) ; un `set_id` **nouveau** ne doit figurer dans **aucune** version du catalogue de l'historique de référence, **ni** parmi les `set_id` de `lots-fonda-calibration/` de cet historique (empêche le recyclage d'un identifiant retiré ou de calibration) ; un fichier `correction-v<N>.js` existant dans la référence est **inchangé** (octets) et le registre ne réattribue jamais une version.
- Le checkout d'une PR teste le **résultat de fusion simulé** : la comparaison se fait entre ce résultat et la référence de base.
