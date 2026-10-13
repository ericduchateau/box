# Cahier des charges — Relecture FONDA `/fonda-select` (Bloc 2, étape 7) — **v6**

> Statut : **v6 rédigée le 2026-10-13**, modèle **« l'humain garantit, la technique est un filet »** (option B), après la relecture Codex de la v5 (B1–B2, C1–C8, optionnels). À valider par Éric, puis relecture Codex ciblée. **Aucun workflow** avant validation ; workflows en JSON **inactifs**, activation sur feu vert explicite. **Annexe A : rien n'est appliqué sur GitHub sans relecture d'Éric.** **Séquencement du build : §18.** Décisions d'Éric : §19.

## 0. Garantie, filet, limites

**Garantie (humaine, vérifiable par une signature)** : un lot n'est publiable que si la relectrice a confirmé auprès d'Éric **exactement l'instantané figé** (§3) — cartes gardées et écartées, règle de correction, **moteur de correction élève** (version + empreinte) que l'élève exécutera (§4) — et si Éric a signé cet instantané sur son Mac. **Confirmation, signature et comportement exécuté par l'élève forment un seul objet lié** (§3, §4, §11).

**Filet technique** (exécutions n8n, rapprochement historique/Drive, recherches Drive, conflits, empreintes, SRI) : il **bloque** ce qu'il détecte (§10). **Il est non probant.**

> **Limite, noir sur blanc.** Drive + n8n 2.6.3 n'offrent ni écriture atomique, ni journal infalsifiable, ni rétention garantie, ni état d'exécution exhaustivement interrogeable. **Le silence du filet ne prouve pas l'exhaustivité.** FONDA ne revendique **aucune** preuve technique d'exhaustivité ni d'unicité : l'unicité de ce qui est publié repose sur la **confirmation humaine** de l'instantané exact.

**Ce que prouve la signature** : la **déclaration d'Éric** (« la relectrice `<id>` m'a confirmé, par `<mode>`, cet instantané exact, transmis sans retouche ; je l'ai signé »). Pas l'intervention indépendante de la relectrice, ni son examen réel de chaque carte.

**Non couvert, assumé** : administrateur n8n/Drive/GitHub malveillant ; relectrice confirmant sans examiner ; Éric déclarant faussement (racine de confiance).

**Périmètre** : `fonda/page/bootstrap.js` et `fonda/engine/carte-reponse-produite.js` ne servent **qu'au mode FONDA** (`?fonda=1`), **pas encore sur `main`** ; BOX (élèves actuels) n'en dépend pas. **Frontière CI** : vérification publique uniquement ; jamais la clé privée RSA ni le jeton n8n. **Le front ne vérifie pas RSA** : il sert le catalogue mergé, et vérifie l'empreinte du lot et la **SRI du moteur** qu'il charge (§4).

## 1. Contrats privés et octets canoniques

`lot-fonda/v1` public **inchangé**. Contrats privés (Drive `FONDA-Lots`) :
- **`candidat-fonda/v1`** : `{ schema, lot, relecture }` ; `relecture = { statut ∈ {"en_attente","clos","abandonne"}, generation_cle, cle_sha256, cree_le, expire_le, relecteur_attribue, referentiel_version, moteur: { version, sha256 }, envois }`.
- **`decision-fonda/v1`** : `{ schema, set_id, generation, nonce, recu_le, coeur, lot_relu, hash_formulaire }` ; `coeur = { action, selection, ecartees, empreinte_relue, empreinte_publiee, moteur: { version, sha256 } }`.

**Octets canoniques** (`fonda/engine/canonique.js`, recopié dans les nœuds Code, vecteurs fixes) : `JSON.stringify` d'ECMAScript sur une valeur construite dans l'ordre de clés du contrat ; UTF-8 sans BOM, sans espace ni saut de ligne ; nombres finis, forme `Number::toString` ; chaînes sans normalisation Unicode ; tous les champs présents ; aucun champ inconnu. **Portée d'« octet pour octet »** : cœur, instantané, charge signée, **fichier du moteur**. Les fichiers de lot publiés sont liés par leur empreinte pédagogique **et** par le couple moteur figé (§4, annexe B).

## 2. Routage figé à l'émission

Relecteur attribué lu dans `referentiel.json` publié d'après `notion_id` ; `referentiel_version` (SHA-256) retrouvé dans l'historique Git par le script local. `envois[]` trace chaque génération (`envoye_a` = identifiant).

## 3. Instantané figé et confirmation humaine (B1 v4, C3)

1. **Instantané** `instantane-fonda/v1 = { schema, set_id, candidat_lot, coeur, lot_relu, moteur: { version, sha256 }, recapitulatif }` ; `recapitulatif` = **projection déterministe** de `candidat_lot` + `coeur` + `moteur` (cartes gardées/écartées, règle de correction de chaque carte gardée, version du moteur, empreintes). `sha256_instantane` = SHA-256 complet ; **code de confirmation** = 16 premiers hex (repère humain seulement).
2. **Enregistrement unique** au moment de la construction : `instantane.json` + `export.json = { sha256_instantane, sha256_recapitulatif, exporte_le }` dans le dossier local de clôture (hors dépôt, hors Dropbox). Affichage, export et signature dérivent de cet instantané ; il n'est **jamais reconstruit**.
3. **Transmission sans retouche** : export en fichier joint `recapitulatif-<set_id>-<code>.txt` (récapitulatif + `sha256_instantane` en dernière ligne), envoyé tel quel ; la relectrice **répond à ce message** en citant le code. Vive voix : lecture commune de l'affichage du script.
4. **Contrôles obligatoires avant signature** (C3) : (a) SHA-256 recalculé de `instantane.json` = `export.json.sha256_instantane` ; (b) `recapitulatif` = projection déterministe recalculée de l'instantané, et son SHA-256 = `export.json.sha256_recapitulatif` ; (c) `coeur`, `moteur` et empreintes de la charge **proviennent exclusivement** de l'instantané ; (d) Éric tape le code confirmé (= code de l'instantané) et atteste la fidélité de transmission. Le code n'authentifie ni personne ni message.
5. **Clôture technique ≠ clôture signée** : la *clôture technique* (révocation de la clé, §9) précède la confirmation ; **sans confirmation, pas de clôture signée** et donc rien de publiable.

## 4. Moteur de correction élève versionné (B1, B2)

**Constat** : aujourd'hui, le comportement de correction est **éparpillé** — `correction.js` (évaluation), `bootstrap.js::adapterCarte` (transmet `unite`, `arrondi`, `seconde_chance`), `carte-reponse-produite.js` (seconde chance, tentative comptée `scored`, capture des fonctions du correcteur à l'évaluation), et le chargeur (« chargé dès que l'export existe »). Signer `correction.js` seul laisserait fuir le reste.

**Moteur** `fonda/engine/moteur-correction-v<N>.js` : **un seul fichier**, sans effet de bord global, qui **expose une fabrique** `creerMoteur()` renvoyant `{ version, adapterCarte(carteLot), evaluer(carteAdaptee, reponse), compteCommeReussite, proposerSecondeChance(statut, carte, tentative), estTentativeComptee(tentative) }`. Il contient **toute** la règle de correction et de tentative. `carte-reponse-produite.js` devient **purement présentationnel** : il reçoit l'instance du moteur **en paramètre** (`montrerCarteReponseProduite(conteneur, carte, { moteur, onResultat })`) et ne capture plus rien au chargement.

**Registre** `fonda/engine/moteurs.json` = `[{ version: "v<N>", fichier, sha256, sri }]` ; **invariant** : `sha256 = SHA-256(octets du fichier)` **et** `sri = "sha256-" + base64(même empreinte)` — une seule empreinte, aucune alternative. Fichiers **immuables** et **jamais supprimés** une fois publiés (annexe B).

**Liaison de bout en bout** : `moteur = { version, sha256 }` fixé **dans le candidat** à la génération → page de relecture (charge ce fichier, `integrity` = SRI du registre, `crossorigin="anonymous"`) → **jeton HMAC** et **champ POST obligatoire** comparé au candidat (§7) → **cœur** → **instantané** → **charge signée** (`moteur_sha256 = registre.sha256`) → **entrée du catalogue** (`moteur`).

**Front élève** : (1) résoudre le catalogue et **l'entrée du lot avant tout chargement de moteur** ; (2) charger `moteur-correction-v<N>.js` de **la version de l'entrée**, avec `integrity` (SRI du registre) et `crossOrigin` posés **avant insertion** ; (3) vérifier que l'instance obtenue déclare cette `version` ; (4) la **passer explicitement** au composant. **Fin** de « chargé dès que l'export existe » : un moteur est identifié par `(version, sha256)` ; deux lots de versions différentes dans la même session obtiennent chacun **leur** instance (le registre des instances est indexé par version). Version inconnue, SRI en échec ou version déclarée différente → « pas disponible ».

**Même moteur pour la relecture et pour l'élève** : la page de relecture appelle `creerMoteur()` du **même fichier** pour « Essayer une réponse » (adaptation + évaluation + seconde chance), donc **la relectrice éprouve exactement le comportement que l'élève recevra**.

**Version figée par lot publié (B2)** : pour un `set_id` publié, le couple `moteur = { version, sha256 }` est **figé** comme l'empreinte pédagogique (annexe B). Changer de comportement ⇒ **nouveau `set_id` et nouvelle relecture**. Une rotation de signature conserve ce couple.

**Lots historiques** : moteur `v1` = consolidation **à comportement identique** du code actuel (vérifiée par les tests existants rejoués sur le moteur) ; `moteur_essaye: false` (leur relecture n'a pas utilisé « Essayer une réponse »). La table `HISTORIQUES_FIGES` fige aussi leur moteur `v1`.

## 5. Auto-confirmation (relecteur = clôtureur)

Règle **par identité** : `relecteur_attribue === "eric"` ⇒ `confirmation.mode = "auto"`, `par = "eric"`, `relecteur_egal_cloturer = true` ; code et instantané exigés. **Aucune double relecture revendiquée** ; badge « Fiche relue par Éric Duchateau ».

## 6. Clé, statuts, identifiants (C4 v4, C5)

- Clé : Crypto v1 « Generate », hex 64 ; seul `cle_sha256` stocké ; **14 jours**. Seuls les workflows manuels écrivent le candidat (génération, réémission, clôture technique, abandon), jamais en parallèle.
- Contrôle C3 (§7) : candidat téléchargé par l'exécution : `statut === "en_attente"`, `sha256(k)`, génération, expiration, **`moteur` = celui du formulaire**.
- **Statuts** : `en_attente → clos` ; `en_attente → en_attente` (réémission) ; `en_attente | clos → abandonne`. Après un **blocage dur propre au lot** (§10), seule issue : **abandon** + **nouveau candidat** avec **nouveau `set_id`** (cartes reprises, `set_id` réécrit dans chaque carte, `item_id` conservés, empreintes recalculées, **relecture entièrement refaite**).
- **Réservation durable des identifiants (C5)** : registre **commité** `fonda/data/set_ids-reserves.json` = liste append-only `[{ set_id, reserve_le, statut ∈ {"candidat","publie","abandonne","calibration"} }]`. **Toute** voie de génération ou de reprise prend la séquence libre suivante **dans ce registre** (jamais seulement les fichiers présents) et l'y inscrit **avant** de créer le candidat ; la CI refuse toute suppression ou modification d'une entrée du registre et tout `set_id` publié absent du registre. Séquence `99` atteinte → **arrêt explicite**, jamais de recyclage. `generer-lot-fonda.js` est migré pour lire ce registre (et ne plus ignorer les fichiers illisibles : un fichier illisible → arrêt).

## 7. Page et confirmation de relecture

**GET** (aucune écriture) : par carte, question, réponse attendue, profil avec explication et exemple, toutes les réponses acceptées, `unite`, `arrondi`, `seconde_chance` ; choix « Garder / Écarter » sans défaut ; « Tout rejeter » séparé ; « Essayer une réponse » via le **moteur** du candidat (SRI, CORS). Données via `<script type="application/json">` échappé ; aucun `onclick`. CSP : `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-<aléa>' <URL exacte du moteur>; form-action <URL exacte de confirmation>; base-uri 'none'` — **ajustée selon la preuve C8** (§13.0). Jeton : `HMAC-SHA256(secret, canonique(["fonda-select/v6", set_id, generation_cle, cle_sha256, empreinte_affichee, moteur.version, moteur.sha256, expire_page, nonce]))`.

**POST** : **C1** syntaxe avant Drive (≤ 64 Ko octets reçus ; champs exactement `lot, k, generation, empreinte, moteur_version, moteur_sha256, expire_page, nonce, jeton, action` + `choix_<item_id>` ou `confirmer_rejet=oui` ; doublons → 400) ; **C2** jeton ; **C3** candidat + clé + moteur ; **C4** empreinte actuelle = affichée ; **C5** sélection ; **C5bis** relecture du candidat ; **C6** recherche de tous les fichiers de même nom : cœurs identiques → même résultat ; **cœur différent → sortie `{ type: "conflit", … }` consignée puis 409** ; sinon écriture et sortie `{ type: "decision", … }` ; **C7** mail. `executionTimeout = 120 s` ; jamais de reprise manuelle d'une confirmation.

## 8. Recherche Drive stricte

`set_id` validé avant interpolation ; Advanced Search restreinte au dossier ; `nextPageToken` et `incompleteSearch` ; pagination complète ; tous les résultats traités ; 0 ou > 1 → refus ; `set_id` interne = nom. Aucun `file_id` client ; écritures uniquement dans les dossiers FONDA ; test statique : aucun id ni route BOX, Crypto v1 uniquement.

## 9. Clôture

**Workflow `FONDA - Cloturer relecture`** (manuel) = **clôture technique** : révocation (`clos`) ; listing de `decisions/` (corbeille comprise, pagination, `incompleteSearch`, chaque fichier lu) ; sortie = manifeste. Aucun fichier de clôture ne fait foi.

**Script local `fonda/scripts/signer-cloture.js`** (Mac d'Éric ; secrets locaux hors dépôt et hors Dropbox ; GET uniquement) : (1) provenance de l'exécution de clôture par l'API (workflow épinglé, `success`, même `set_id`, **la plus récente** ; écriture postérieure au listing → nouvelle clôture technique) ; (2) filet (§10) ; (3) un seul cœur distinct d'action `accepter`, enveloppes cohérentes ; (4) revérifications (candidat, filtrage, `lot-fonda/v1`, garde-fous du correcteur **via le moteur `v<N>`**, référentiel archivé) ; (5) instantané figé + confirmation (§3, §5) ; (6) **clôture signée** (§11) et revérification immédiate.

## 10. Le filet : portée et sort de chaque détection (C1 v4, C4)

**Ordre** : toutes les détections sont évaluées ; **un seul blocage dur suffit** ; une levée ne neutralise jamais un autre blocage ; le silence n'est jamais une preuve.

**A. Blocages durs propres au lot** (attribuables à ce `set_id`) — **non levables** ; issue : **abandon + nouveau candidat** (§6) :
- sortie `conflit` dans une exécution de ce lot, **quel que soit son statut** ;
- ≥ 2 cœurs distincts, ou cœurs identiques avec `lot_relu` différents ;
- décision de ce lot consignée par une exécution mais **absente de Drive** ;
- fichier de `decisions/` dont le `set_id` interne est ce lot **sans exécution correspondante** ;
- exécution de confirmation de ce lot **`error`/`crashed`/`canceled`**.

**B. Incidents de chaîne** (non attribuables à un lot) — **non levables** ; ils **suspendent toute clôture signée**, pour tous les lots, jusqu'à traitement par Éric ; l'abandon d'un lot **ne les résout pas** :
- exécution de confirmation **non terminée** ou **au statut inconnu** (dont `new`), observée avec et sans filtre, pagination complète ;
- exécution **sans données exploitables** (lot indéterminable) ;
- fichier **illisible ou non conforme** dans `decisions/` (lot indéterminable) ;
- jeton n8n sans accès aux workflows de relecture.
**Traitement d'un incident de chaîne** : Éric l'examine, puis (fichier) le **met en quarantaine** (`quarantaine/`, entrée dans `incidents/<date>.json` avec localisation d'origine, constat, lots potentiellement concernés) ; (exécution) l'inscrit dans `incidents/` avec son identifiant. Un incident **inscrit** n'est plus re-signalé à chaque clôture, **mais il reste listé dans toute attestation signée ultérieure** (`incidents_connus`), et **tout lot dont la fenêtre de candidature recouvre l'incident** ne peut être clôturé qu'après **abandon et nouveau candidat** postérieur à l'incident. Aucun incident n'est jamais effacé du constat.

**C. Levées — uniquement deux, par Éric, signées, non probantes, confirmation humaine toujours exigée** :
- recherche Drive **`incompleteSearch = true`** persistante → `levees += { type: "recherche_incomplete", constat }` ;
- historique **peut-être purgé** → `levees += { type: "historique_incomplet", constat }`.

**Non bloquant** : plusieurs fichiers de **cœur identique**. **Horloges** : les dates servent à parcourir (fenêtre élargie de 24 h), jamais seules à exclure.

## 11. Attestation : charge signée, enveloppe, clés

- **Charge** `attestation-cloture/v1` : `{ schema, set_id, notion_id, palier, coeur, sha256_instantane, code_confirmation, confirmation, fidelite_transmission, relecteur_attribue, relecteur_egal_cloturer, provenances, nb_fichiers_decision, referentiel_version, moteur: { version, sha256 }, execution_cloture, revoque_le, levees, incidents_connus, cloture_le, badge, cle_id }`.
- **Invariants** (script ; `publier-lot.js` et CI pour ce qui est public) : `code_confirmation` = code(`sha256_instantane`) (`sha256_instantane` vérifiable **localement** seulement) ; `coeur.moteur = moteur = entree.moteur` et `moteur.sha256 = registre[moteur.version].sha256` ; `confirmation.par = relecteur_attribue`, `recue_par = "eric"` ; `mode = "auto"` ⇔ `relecteur_egal_cloturer` ⇔ `relecteur_attribue = "eric"` ; badge = relecteur de l'entrée (§12) ; `selection`/`ecartees` disjointes, sans doublon, **partition du candidat** (locale) ; `selection = item_ids` du fichier ; `coeur.empreinte_publiee` = empreinte du fichier ; `coeur.action = "accepter"`.
- **Signature** RSA-SHA256 PKCS#1 v1.5 sur les octets canoniques de la **charge** (sans champ `signature`) ; **enveloppe** `attestation = { type: "cloture-signee", charge, signature }`.
- **Clés** : `fonda/data/cles/cles.json` = `[{ cle_id (unique), fichier (SPKI PEM), sha256_pem, algorithme, valide_du, valide_au, revoquee_le }]` ; chargement uniquement via `cle_id` déclaré ; **recevabilité** : `cloture_le ∈ [valide_du, valide_au]` (reste recevable après expiration) ; clé **révoquée** → toutes ses attestations irrecevables (§14).
- **Vecteurs de test** complets (charge → octets → signature → vérification ; altération → échec).

## 12. Badge élève

| Situation | `badge` signé | `entree.relecteur` | Texte |
|---|---|---|---|
| Tiers ayant confirmé | `{ forme: "relue_et_validee", nom_affiche, id }` | identique | « Fiche relue et validée par <nom> » |
| Auto-confirmation | `{ forme: "relue_par", nom_affiche: "Éric Duchateau", id: "eric" }` | identique | « Fiche relue par Éric Duchateau » |
| Sans nom | `{ forme: "relue_par", nom_affiche: "un professeur", id: null }` | identique | « Fiche relue par un professeur » |

**Même schéma** pour `badge` et `entree.relecteur` (`{ forme, nom_affiche, id }`), égalité stricte vérifiée par la CI. Lots historiques : exception figée `{ forme: "relue_par", nom_affiche: "Éric Duchateau", id: "eric" }` (libellé seulement). Le texte est construit par le composant à partir de `forme` (aujourd'hui en dur « relue et validée »).

## 13. Conditions d'activation — à prouver sur la copie de test

0. **C8 en premier (avant tout remaniement du front)** : sur l'instance 2.6.3, une page servie par `Respond to Webhook` (donc enveloppée dans l'iframe sandboxée de n8n) charge un script **depuis GitHub Pages** avec `integrity` + `crossorigin="anonymous"` : (a) le script s'exécute avec la bonne SRI ; (b) il est **refusé** avec une SRI fausse ; (c) les en-têtes CORS de Pages le permettent ; (d) la CSP effective (enveloppe n8n + la nôtre + proxy) laisse passer exactement ce qu'il faut ; (e) le formulaire POST fonctionne depuis l'iframe. **Si un point échoue**, la liaison du moteur côté relecture est revue (par exemple moteur servi inline dans la page avec son empreinte vérifiée côté n8n, ou page de relecture servie depuis Pages) **avant** de toucher au front élève.
1. Observation des exécutions par l'API (avec et sans filtre ; accès du jeton vérifié).
2. Révocation : GET ouvert, clôture technique, soumission → refus.
3. Parcours complet en navigateur réel (GET → POST → confirmation, rejet, erreurs, conflit 409).
4. Limites : refus immédiat des requêtes invalides ; ni relance ni reprise manuelle.
5. Rétention relevée (`EXECUTIONS_DATA_PRUNE`, `…_MAX_AGE`, `…_PRUNE_MAX_COUNT`).
6. Front : chargement du moteur de la version de l'entrée avec `integrity` ; SRI en échec → « pas disponible » ; deux lots de versions différentes dans une même session → deux instances.
7. Annexe A appliquée par Éric après relecture, recette comprise.

## 14. Révocation de la clé de signature

Rotation : nouvelle clé, `valide_au` sur l'ancienne. Compromission : **une seule PR** qui fixe `revoquee_le` et, pour chaque lot concerné, soit le retire, soit le **reclôture** (instantané et confirmation refaits) à **empreinte et moteur identiques**. La CI valide l'état final contre la base (annexe B).

## 15. Fichiers de confiance et mainteneur unique (C1, C2)

- **Liste** : `.github/workflows/**` ; `fonda/engine/catalogue.js` (dont `HISTORIQUES_FIGES`) ; `fonda/engine/canonique.js` ; `fonda/engine/moteurs.json` et `fonda/engine/moteur-correction-v*.js` ; `fonda/engine/carte-reponse-produite.js` ; `fonda/page/bootstrap.js` ; `fonda/scripts/publier-lot.js` ; `fonda/scripts/signer-cloture.js` ; `fonda/scripts/verifier-immuabilite.js` ; `fonda/scripts/generer-lot-fonda.js` (tant que ses validations sont importées par `publier-lot.js`) ; `fonda/data/cles/**` ; `fonda/data/set_ids-reserves.json` ; `fonda/data/catalogue-fonda.json` ; les tests de ces fichiers.
- **Garantie humaine, dite explicitement** : Éric est **mainteneur unique** ; pour ces fichiers, **sa relecture en PR est la garantie** ; **aucun mécanisme ne s'y substitue**. Protéger la branche ne protège pas la valeur du contrôle (une PR peut modifier le contrôle lui-même) : **risque assumé**, couvert uniquement par cette relecture.
- **Marqueur (filet, non probant)** : job `fichiers-de-confiance` déclenché par **`pull_request_target`**. **Depuis décembre 2025, GitHub exécute la définition de ce workflow présente sur la branche par défaut (`main`)**, quelle que soit la branche cible : le marqueur doit donc être **installé sur `main`** pour exister. Une PR qui modifie ou supprime ce workflow **ne change pas la définition exécutée pour sa propre analyse** ; une fois fusionnée dans `main`, elle change les exécutions **suivantes** (la protection ne vaut que pour l'exécution courante). Contraintes : **aucun checkout** et **aucune exécution** de code de la PR ; lecture de la liste des fichiers par l'API GitHub, **paginée**, renommages compris (ancien et nouveau nom), avertissement explicite si la liste est tronquée (plafond de l'API) ; **aucun nom de fichier interpolé dans du shell** (traitement en JavaScript via `actions/github-script`, données passées en variables) ; permissions minimales (`pull-requests: read`). Sortie : annotation et résumé « ⚠️ FICHIER DE CONFIANCE MODIFIÉ : … ». Il ne bloque pas.

## 16. Annexe A — Réglages GitHub (corrigés, **non appliqués**)

1. **Settings → Actions → General** : Actions autorisées ; **Workflow permissions** = **« Read repository contents and packages permissions »**.
2. **Settings → Branches → « Add classic branch protection rule »**, motif **`main`** : ☑ **Require a pull request before merging** (« **Require approvals** » **laissé décoché** : mainteneur unique, une PR est imposée mais **aucune approbation n'est enregistrée par GitHub**) ; ☑ **Require status checks to pass before merging** → ☑ **Require branches to be up to date before merging** → contrôles requis **`tests (node --test)`** et **`immuabilite`**, source **GitHub Actions** ; ☑ **Do not allow bypassing the above settings** ; ☐ Allow force pushes ; ☐ Allow deletions.
3. Même règle pour **`design`**.
4. **Rulesets** : non utilisés (s'il en existe : activation et exceptions vérifiées).
5. **Settings → Pages** : **Deploy from a branch**, **`main`**, **`/ (root)`** — à vérifier.
6. **Ordre** : (a) fusionner d'abord la PR qui **installe** les jobs `immuabilite` et `fichiers-de-confiance` (ce dernier **sur `main`**) ; (b) attendre qu'ils aient **tourné au moins une fois** (sinon ils ne sont pas sélectionnables) ; (c) seulement alors les déclarer requis.
7. **Recette** : vérifier quelle règle s'applique **effectivement** à chaque branche (les règles classiques ne se cumulent pas : un seul motif par branche) ; PR cassant `node --test` → *Merge* bloqué ; PR violant l'**immuabilité** (empreinte d'un lot publié modifiée) → *Merge* bloqué ; PR touchant `fonda/engine/catalogue.js` → marqueur visible ; **PR modifiant le marqueur lui-même** → le marqueur courant (version de `main`) le signale ; `git push` direct sur **`design` et sur `main`** → refusé.

## 17. Annexe B — Immuabilité en CI (C6)

Script `fonda/scripts/verifier-immuabilite.js` + job **`immuabilite`** :
- **Référence** : sur `pull_request`, `github.event.pull_request.base.sha` ; sur `push`, `github.event.before`. Référence **nulle, introuvable, ou historique incomplet → échec explicite** ; jamais de comparaison contre un état vide. Historique de confiance = historique **de la référence**.
- **Règles** : (1) un `set_id` du catalogue de la référence garde **la même empreinte et le même moteur** (retrait autorisé ; remplacement d'attestation seulement à empreinte et moteur identiques, nouvelle clôture valide) ; (2) un `set_id` nouveau doit être dans `set_ids-reserves.json` et n'avoir figuré dans **aucune** version antérieure du catalogue ni de la calibration ; (3) `set_ids-reserves.json` est **append-only** ; (4) `moteurs.json` est **append-only** ; tout fichier `moteur-correction-v<N>.js` ayant **jamais** existé dans l'historique de confiance doit être **présent et identique** (aucune suppression, aucune réintroduction avec d'autres octets) ; (5) l'invariant SHA-256 = registre = SRI est revérifié.
- Le checkout d'une PR teste le **résultat de fusion simulé** : il est comparé à la référence de base.

## 18. Séquencement du build (décision Éric)

1. **Preuve C8 d'abord** (§13.0), sur la copie de test, avec un script de démonstration jetable (pas le moteur). **Aucun remaniement de `bootstrap.js` tant que C8 n'est pas tranché.** Si C8 échoue : adapter la liaison côté relecture, mettre à jour ce CDC, puis seulement continuer.
2. **Chantier/PR « moteur de correction élève »**, **isolé** des workflows de relecture : consolidation en `moteur-correction-v1.js` (comportement identique, prouvé par les tests existants rejoués), registre `moteurs.json`, injection explicite dans `carte-reponse-produite.js`, chargement par version + SRI dans `bootstrap.js`, `entree.moteur` + `forme` du badge dans le catalogue, immuabilité CI des moteurs. Vérifié par la suite de tests **et** en navigateur réel (rendu, parcours complet, BOX clair intact au pixel près). **Point de merge propre** avant d'empiler le reste.
3. Ensuite seulement : `canonique.js`, clés, `set_ids-reserves.json`, `publier-lot.js`, `verifier-immuabilite.js` complet, marqueur, `signer-cloture.js` ; puis les workflows (inactifs) ; puis les conditions §13 sur la copie de test.

## 19. Décisions d'Éric (2026-10-13)

1. Clé 14 j. 2. « Essayer une réponse » en v1. 3. Clôture manuelle obligatoire. 4. Signature locale. 5. Historique n8n conservé partout. 6. CI de vérification publique. 7. Option B : l'humain garantit, la technique est un filet non probant. 8. Auto-confirmation déclarée, badge « relue par ». 9. Instantané figé unique, transmission sans retouche attestée. 10. **Moteur de correction élève versionné de bout en bout** (correcteur + adaptation + seconde chance + tentative comptée), injecté explicitement, identique relecture/élève. 11. **Moteur figé par lot publié** ; tout changement de comportement ⇒ nouveau `set_id` + nouvelle relecture. 12. Levées limitées à deux cas ; blocages durs propres au lot ⇒ abandon ; incidents de chaîne suspendent tout. 13. Mainteneur unique ; marqueur `pull_request_target` sur `main`. 14. **Séquencement : C8 prouvé d'abord ; moteur = chantier/PR isolé avant la signature/clôture.** 15. Alertes : Éric seul.
