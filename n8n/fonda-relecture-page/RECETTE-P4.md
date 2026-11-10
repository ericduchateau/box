# Recette P4 du parcours page (CDC relecture §13, §21.4) — sur COPIE, instance réelle

> Protocole relu par l'architecte (2026-11-10). **Aucune opération d'instance avant la relecture de la PR P4a.**
> Éric exécute sur la copie, clic par clic ; Claude fournit commandes et sondes, lit en GET seulement.
> **Production intouchée** : aucun workflow BOX ni de génération ouvert, modifié, activé ou désactivé.

## Décisions de cadrage (architecte, 2026-11-10)
- **Isolation sur l'instance unique** (sous réserve de confirmation d'Éric : pas de staging) : copies « FONDA RECETTE - … », chemins `fonda-recette-*`, dossiers Drive, Data Table et credentials de recette. Construites depuis le dépôt (`construire-relecture.js --profil recette`, exports `*.recette.json`), qui **refuse** tout identifiant de production (construction et harnais §1 bis).
- **Limites assumées** : credential Drive de recette = même compte Google (isolement au niveau des dossiers) ; clé d'API n8n non restreinte, **révoquée à la fin**.
- **HMAC** : repli d'emblée, **Crypto v2 Hmac adossé à un credential `crypto`** (décision de conception de PRODUCTION ; PR P4b, cycle normal constructeur + harnais + mutations). `$env` écarté : il imposerait de recréer le conteneur, donc de redémarrer BOX. Import **par l'API seulement** (l'éditeur de l'instance ne reconnaît pas Crypto v2 : ne jamais ouvrir-enregistrer).
- **G7** : fail-closed ; si NO-GO, la preuve de quiescence sera conçue en P5 (pas avant).
- **Règle des outils** : tout ce qui peut atteindre l'instance ou être affiché appartient à un **ensemble fermé de connu-bon** (instance, routes et paramètres par route dont le curseur, en-têtes, références, noms de nœuds, messages reconstruits) ; jamais une denylist ni une grammaire permissive.
- **Octet-identité des 4 exports de production** contre `origin/design` : **consignée dans chaque PR P4** (SHA-256 + `git diff --stat`), relue par l'architecte (P4a : zéro ; P4b : exactement le diff HMAC de Page et Confirmer, zéro sur Emettre et Cloturer).

## Phase 0 — dépôt seulement (PR P4a, puis P4b)
- P4a : profil de recette + exports `*.recette.json` (octet-identité, scan, isolement, équivalence à la production aux identifiants près) ; `outils-recette/` (transport **GET seulement** prouvé par test, `sonde-executions.js`, `comparer-live.js`) ; ce fichier. **Exports de production inchangés octet pour octet.**
- P4b : jeton par Crypto v2 + credential (Page et Confirmer), secret absent de l'export **et** des données d'exécution.

## Énumération des frontières (exhaustivité prouvable)
Chaque valeur externe, ou qui atteint l'instance, ou qui est affichée, et son contrôle d'**ensemble fermé** (LF = liste fermée ; GS = grammaire stricte ; LC = liste de confiance du dépôt). Toute ligne absente de ce tableau est un défaut.

**Énumération auto-vérifiée** : chaque CLASSE de frontière a un test qui échoue si elle dérive (une frontière nouvelle de la classe fait rougir le test, sans relecture à la main). Le sommaire l'est aussi : un test exige que **chaque ligne du détail figure dans une classe** (« sommaire : chaque ligne … »).

**Instantanés de surface** : chaque liste fermée déclarée (instance, grammaires, routes et paramètres par route, codes d'erreur, statuts, modes, catégories, nœuds d'attente, clés de contenu, métadonnées et états du comparateur, `CLES_RECETTE` et grammaires du profil, constructeurs, spécification d'options reçue par `analyser()` pour chaque commande) est **recopiée littéralement** dans un test et comparée au code : élargir une liste oblige à modifier le test, donc l'extension est visible en relecture (« instantanés de surface … », « instantané de surface (constructeur) »).

**Limite assumée (arbitrage de l'architecte, 7e tour)** : toutes les frontières déclarées sont gardées mécaniquement ; une frontière ajoutée par du code futur est rattrapée par la relecture et la visibilité des extensions de liste, non par un test exhaustif de tous les futurs (logiquement impossible). Le résidu est tenu procéduralement : CODEOWNERS (`/outils-recette/`, `/n8n/fonda-relecture-page/` : constructeur, profil de recette, exports) + relecture de chaque PR, instantanés qui rendent toute extension visible.

| Classe | Test de dérive |
|---|---|
| Arguments de ligne de commande (C1, C2, S1, S2, K1, K2) | analyse stricte : option inconnue, valeur absente, doublon, positionnels -> erreur (3 commandes) ; identifiants `workflowId` / exécution en grammaire stricte, refusés avant toute requête |
| Valeurs du profil (C3–C9) | clés = `CLES_RECETTE` exactement ; grammaire fermée par champ ; injections et identifiants de production refusés |
| Paramètres et exports des fonctions exportées (F1) | exports et signatures comparés à une liste fermée ; `comparer()` n'accepte qu'un élément de `REFERENCES` |
| Modules chargés (X1) | modules tracés à l'exécution comparés à une liste fermée |
| Routes, paramètres, en-têtes, instance (T1–T6) | toute requête hors liste fermée refusée avant le réseau (aucun appel enregistré) |
| Champs de réponse réinjectés ou affichés (T7, T8, T10, S4, S5, K4–K6, K9) | réponses hors forme (curseur, statut non entier, JSON illisible, corps non objet, dates, identité, états, versionId) -> refus ou marqueur |
| Fichiers lus (C3, C10, C11, C15, S3, K3, K8) | listes explicites ; lecture, JSON ou schéma en échec -> message fixe ; inventaire = `git ls-files` ; registre et fichiers moteur : sha256 = registre, modules embarqués = copie exacte (sections 1 et 12 du harnais) |
| Références d'instance des exports (C8, C12) | ensemble fermé contrôlé par le harnais, indépendamment du profil ; profil entièrement renseigné testé |
| Chemins d'erreur, dont le chargement (C13, C14, T9, S7, K7) | erreurs tierces et de chargement injectées -> message fixe, aucun extrait |
| Sorties et codes de sortie (C13, S6, S8, K6, K9) | formes EXACTES (ensemble et ordre des clés) de chaque sortie comparées à un littéral du test ; codes 0/1/2 de la sonde distingués |

| # | Outil | Frontière | Source | Contrôle | Où (test) |
|---|---|---|---|---|---|
| C1 | constructeur | argument : constructeur | argv | LF `CONSTRUCTEURS` (propriétés propres, prototype nul), un seul | `analyserArguments` (§1 bis « ligne de commande STRICTE », « avecProfil INTERNE ») |
| C2 | constructeur | argument : `--profil` | argv | LF {production, recette}, une fois, valeur présente | idem |
| C3 | constructeur | fichier lu : profil | `profil-recette.json` (chemin fixe) | JSON illisible -> message fixe ; clés = LF `CLES_RECETTE` ; `profil` = « recette » | `configRecette` (« profil refusé », « messages de la liste fermée ») |
| C4 | constructeur | valeur profil : noms de workflows | profil | GS fermée `FONDA RECETTE - <Mot> relecture` | « INJECTION composite » |
| C5 | constructeur | valeur profil : chemins webhook | profil | GS `fonda-recette-[a-z]+(-[a-z]+){0,3}` | idem |
| C6 | constructeur | valeur profil : dossiers Drive, Data Table | profil | GS `[A-Za-z0-9_-]{10,80}` ou `A_RENSEIGNER_RECETTE_[A-Z0-9_]+` ; `A_RENSEIGNER_P4_*` refusé | idem, « autres workflows » |
| C7 | constructeur | valeur profil : credentials (id, nom) | profil | id GS `[A-Za-z0-9]{8,32}` ou remplacement de recette ; nom GS `FONDA RECETTE …` ; forme `{ id, name }` exacte | idem |
| C8 | constructeur | valeur profil : `urlMoteurs` | profil | LF de bases : GitHub Pages exacte, jsDelivr `@<sha 40 hex>` exacte, ou remplacement de recette ; contrôlée AUSSI par le harnais avec sa propre liste | « INJECTION composite », « profil ENTIÈREMENT renseigné » |
| C9 | constructeur | valeur profil : identifiant de production réutilisé | profil × inventaire | disjonction stricte + jetons ; valeur jamais citée | « autres workflows du dépôt refusés » |
| C10 | constructeur | fichiers lus : inventaire de production | dépôt | LF explicite `EXPORTS_PRODUCTION_INVENTAIRE` (= `git ls-files` hors recette) ; illisible -> message fixe | « inventaire : LISTE EXPLICITE », « messages de la liste fermée » (export illisible) |
| C15 | constructeur | **schéma des exports de l'inventaire** (source de la protection) | dépôt | objet avec `nodes` tableau d'objets, sinon `ErreurConstruction` à message fixe (jamais ignoré en silence) | « messages de la liste fermée » (`{}`, `[]`, `nodes: {}`, `nodes: [null]`) |
| C11 | constructeur | fichiers lus : registre et fichiers moteur, modules embarqués | dépôt (fichiers de confiance) | sha256 = registre ; copie exacte vérifiée | sections 1, 12 du harnais |
| C12 | constructeur | sortie : export de recette | construction | références d'instance ⊆ ensemble fermé (URL, dossiers des requêtes, CONFIG embarqués, credentials, chemins, noms) ; inventaire de production absent ; uuid disjoints | `verifierReferencesRecette`, « TOUS les uuid » |
| C13 | constructeur | stdout / stderr / code | CLI | stdout = export ; stderr = `ErreurConstruction` (constantes + champ ∈ `CLES_RECETTE`) sinon marqueur ; code 0/1 | « messages de la liste fermée » |
| C14 | constructeur | erreur au CHARGEMENT | dépendances | gestionnaire précoce : marqueur fixe, code 1 | idem (cas `moteurs.json`) |
| T1 | transport | instance | appelant | LF `INSTANCES` (1 origine HTTPS exacte) | « instance : liste fermée » |
| T2 | transport | méthode, corps, redirection | appelant | GET seul, corps refusé, `redirect: 'error'` | « méthodes autres que GET » |
| T3 | transport | route | appelant | LF `ROUTES` (3) | idem |
| T4 | transport | paramètres de requête | appelant | LF par route (clé, valeur LF/GS, ≤ 1 fois, obligatoires) | « paramètres de requête PAR ROUTE » |
| T5 | transport | en-têtes | appelant | LF {`X-N8N-API-KEY`, `accept`}, clé GS, accept exact ; reconstruits | « en-têtes : liste fermée » |
| T6 | transport | clé d'API | env `FONDA_N8N_CLE_RECETTE` | GS `[A-Za-z0-9._-]{16,4096}` | « clé d'API » |
| T7 | transport | **champ de réponse réinjecté : `nextCursor`** | réponse n8n | typé dans la réponse (absent, nul ou chaîne GS `CURSEUR`), puis T4 sur la requête suivante | « curseur … HORS GRAMMAIRE », « curseur conforme » |
| T8 | transport | statut, JSON de réponse | réponse n8n | statut entier ; JSON illisible -> message fixe | « réponse JSON illisible » |
| T9 | transport | messages d'erreur | tous | `ErreurOutil` (LF de codes) ; HTTP reconstruit des 3 chiffres validés ; sinon marqueur | « messageSur » |
| T10 | transport | **corps de réponse 2xx, typé par route** | réponse n8n | objet simple pour les 3 routes (null, tableau, nombre -> `REPONSE`, jamais confondu avec le null d'un 404) ; liste : `data` tableau | « HTTP 200 dont le corps est null… », « refus d'observer() » |
| S1 | sonde | arguments | argv | `analyser` : LF {`--execution`}, positionnels 0 ou 1 exacts | « arguments stricts (3 commandes) » |
| S2 | sonde | `workflowId`, id d'exécution | argv | GS `ID_WORKFLOW`, `ID_EXECUTION` | « entrées invalides » |
| S3 | sonde | fichiers lus : liste de confiance | dépôt | 4 fichiers NOMMÉS (aucun glob) + nœuds d'attente ; illisible ou sans `nodes` tableau -> `EXPORT_ILLISIBLE`, code 1 | « liste de confiance = noms EXACTS », « sources de fichiers illisibles » |
| S4 | sonde | champs de réponse affichés (liste) | réponse n8n | id GS, statut LF, dates = forme ISO UTC ET date réelle (aller-retour `Date` identique) ; refus d'`observer()` -> catégorie LF | « refus d'observer() », « ids, statuts, dates », « dates : … aller-retour » |
| S5 | sonde | champs de réponse (détail) | réponse n8n | **identité** (id renvoyé = demandé), schéma `includeData`, statut LF, mode LF, workflowId GS, `startedAt`/`stoppedAt` (même `dateSure`), noms LC ; corps non objet -> T10, code 1 | « --execution INOBSERVABLE », « PRÉSENTE », « HTTP 200 … null », « dates » |
| S6 | sonde | codes de sortie | — | 0 présent ; 1 inobservable ; 2 absent (404) ; jamais confondus | « --execution … 0 / 2 / 1 » |
| S7 | sonde | stderr, erreur au CHARGEMENT | — | `messageSur` ; gestionnaire précoce (marqueur, code 1) | « erreur au CHARGEMENT » |
| S8 | sonde | **champs de sortie construits** | sonde | `schema` : constante ; `workflowId`/`id` : argument validé (S2) ; `observe_le` : horloge locale ; clés de `brut` : LF {running, waiting, liste} ; `fusion`/`en_vol` : dérivés de valeurs déjà filtrées (S4) ; `refus_observer`/`cause` : LF de catégories ou constantes ; `observation` : LF {present, absent, inobservable} ; `runData_present` : booléen dérivé ; `<nom hors liste n°k>` : compteur local ; **ensemble exact des clés** de chaque sortie (liste observée, liste refusée, présent, absent, inobservable) | « S8 : forme EXACTE de chaque sortie de la sonde » (variable d'environnement en trop sans effet) |
| K1 | comparateur | arguments | argv | `analyser` : aucune option, 2 positionnels exacts | « arguments stricts » |
| K2 | comparateur | `workflowId` | argv | GS `ID_WORKFLOW` | « lecture du live » |
| K3 | comparateur | fichier lu : référence | argv, appelant JavaScript | LF `REFERENCES` (4 chemins exacts, relatifs au dépôt), pour la ligne de commande ET pour `comparer()` (lu en interne) ; nom affiché depuis la liste | « principal : référence hors liste fermée » |
| K4 | comparateur | **champ de réponse : `id`** | réponse n8n | **identité** `live.id === workflowId` (GS), sinon `IDENTITE`, code 1 | « lecture du live » (test négatif) |
| K5 | comparateur | clés et états du live | réponse n8n | contenu = 4 clés ; métadonnées LF ; états typés exacts ; clé inconnue -> marqueur | « états typés EXACTS », « écarts localisés » |
| K6 | comparateur | sortie | — | écarts = chemins de clés du DÉPÔT + marqueurs ; `versionId` GS ; aucune valeur du live ; code 0/1 | idem |
| K7 | comparateur | stderr, erreur au CHARGEMENT | — | `messageSur` ; gestionnaire précoce | « erreur au CHARGEMENT » |
| K8 | comparateur | fichier de référence illisible ou non objet | dépôt | `EXPORT_ILLISIBLE`, code 1 : lecture en échec, JSON invalide, ou JSON qui n'est pas un objet simple (`null`, tableau, nombre, chaîne ; même typage que S3) ; objet aux clés ≠ name/nodes/connections/settings -> écart « clés ≠ » | « sources de fichiers illisibles », « K8 : référence dont le JSON n'est pas un objet » |
| K9 | comparateur | **champs de sortie construits** | comparateur | `schema` : constante ; `workflowId` : argument validé (K2) ; `export` : élément de LF (K3) ; `versionId` : GS hexadécimal/tirets sinon null ; `identique` : booléen dérivé ; `ecarts` : K6 ; **ensemble exact des clés** (`principal()` et `comparer()`) | « versionId affiché seulement en grammaire stricte », « K9 : forme EXACTE de la sortie du comparateur » |
| X1 | tous | **modules chargés (directement ou transitivement)** | dépôt et Node | **tracés** par `Module._load` à l'exécution de chaque commande et comparés à une **liste fermée explicite** (constructeur, 2 profils ; sonde, liste et détail ; comparateur, comparaison complète jusqu'au code 0 avec un faux live conforme) ; tout module nouveau fait échouer ; aucun module hors dépôt hors Node | « X1 (constructeur) … TRACÉS », « X1 : modules chargés par la sonde », « … par le comparateur » |
| F1 | tous | **paramètres et exports des fonctions exportées** (appelant JavaScript) | appelant | exports et signature de chaque fonction en **liste fermée** ; chaque paramètre fermé : `url` -> T1 ; `cle` -> T5/T6 ; `env` -> T6 ; `fetch` -> toujours enveloppé par le transport (T2–T10) ; `argv` -> C1/C2, S1, K1 ; `option`/`profil`/`brutRecette` -> C1–C8 ; `live` -> K5/K6 ; `reference` -> K3 (élément de `REFERENCES`, aucun texte ni objet de l'appelant) ; liste de confiance : **aucun** paramètre (S3) | « F1 (constructeur) », « F1 : exports et paramètres … », « F1 : la liste de confiance n'est remplaçable par AUCUN paramètre », « F1 : comparer() n'accepte qu'un ÉLÉMENT de REFERENCES » |

## Constats d'Éric (2026-11-10) et contrainte opérationnelle
- **Instance unique** (`n8n.srv868991.hstgr.cloud`, 2.6.3), pas de staging : isolement par dossiers, Data Table, credentials et noms « FONDA RECETTE », comme prévu.
- **Purge des exécutions : réglage par défaut, jamais modifié** (`EXECUTIONS_DATA_PRUNE` non fixé ; en 2.6.3 la purge est active par défaut, de l'ordre de 14 jours, à confirmer en phase 1). **Assumé** : les exécutions s'effacent. Ce n'est pas un blocage : l'exécution absente est déjà traitée (sonde code 2, §21.4, refus de signer).
- **Fenêtre de signature (contrainte opérationnelle)** : un lot doit être **clôturé et signé avant la purge** de ses exécutions (génération, confirmation, clôture). Au-delà, le signataire refuse (exécution indisponible) : **abandon**, sûr mais le lot est perdu. La phase 1 lit les valeurs exactes (`EXECUTIONS_DATA_PRUNE`, `EXECUTIONS_DATA_MAX_AGE`, `EXECUTIONS_DATA_PRUNE_MAX_COUNT`) et consigne la fenêtre ici. **À reverser en P5** : le CLI avertit quand la fenêtre approche.

## Phase 1 — constats et préparation (Éric, aucune activation)
1. **Terminal du VPS, lecture seule** : `docker exec <ID n8n> printenv` filtré sur `N8N_BLOCK_ENV_ACCESS_IN_NODE`, `EXECUTIONS_DATA_PRUNE`, `EXECUTIONS_DATA_MAX_AGE`, `EXECUTIONS_DATA_PRUNE_MAX_COUNT`, `N8N_PAYLOAD_SIZE_MAX` ; version n8n. Consigner (trace §13.5) ; aucune modification.
2. **Drive** : dossier `FONDA-RECETTE` avec `lots/`, `relecture/`, `decisions/`.
3. **Data Table** `fonda_recette_relecteurs` : une ligne par relecteur du lot de recette, **adresse de test d'Éric** uniquement.
4. **Credentials** (noms imposés par `profil-recette.json`) : `FONDA RECETTE Drive`, `… Emettre Token`, `… Cloturer Token`, `… API n8n (lecture Data Table)`, `… Gmail relecture`, et (P4b) le credential `crypto` du HMAC de recette (secret ≥ 32 caractères, propre à la recette).
5. Éric transmet **les identifiants seulement** (jamais un secret) -> petite PR qui renseigne `profil-recette.json` et régénère les exports.
6. **Lot de recette** : un `set_id` **réservé au journal d'un commit ANCIEN** (aujourd'hui publié), passé en `journal_commit` ; aucune écriture au journal. Lot source synthétique conforme à `validerLot`, déposé dans `lots/` de recette. Aucune donnée d'élève.

## Phase 2 — import INACTIF et octet-identité live
- Import des 4 copies par l'API (go explicite d'Éric), **inactives**.
- `FONDA_N8N_CLE_RECETTE=… node outils-recette/comparer-live.js <id> n8n/fonda-relecture-page/box-fonda-<k>-relecture.recette.json` (référence : un des 4 chemins exacts) : GO = code 0, `identique: true` (métadonnées descriptives ignorées ; états typés exacts : `active === false`, `isArchived === false`, version active nulle ; clé inconnue = échec à examiner). Sinon (code 1) ARRÊT.
- **Première comparaison réelle = fixture** (expurgée) : si l'ordre des clés ou la présence d'`isArchived` diffèrent de l'hypothèse, NO-GO et analyse avant toute décision.

## Phase 3 — portes (une fenêtre d'activation par porte, annoncée par l'architecte)
| Porte | Épreuve | GO | Repli (NO-GO) |
|---|---|---|---|
| G1 version +1 (conditionne P5) | ≥ 6 écritures du candidat (émission, réémission, clôture, deux écritures dans la même seconde) ; versions avant/après lues dans les exécutions | après = avant + 1 à chaque PATCH | contrôle avant écriture conservé, après = informatif, verrou CLI porteur |
| G2 `name contains` | `decisions/` : conformes + leurres (`…_01`/`…_011`, préfixe, tirets, soulignés) ; C6 et listing de Cloturer | toute décision conforme (`fonda_set_id`) retrouvée ; leurres écartés | requête par propriété seule |
| G3 Data Table | émission réelle | adresse lue à l'exécution ; courriel reçu à l'adresse de test ; absente de l'export ; URL de l'API relevée | nœud Data Table natif si disponible, sinon arbitrage |
| G4 HMAC (Crypto v2 + credential) | GET Page jeton juste/faux ; POST Confirmer | comportements du harnais ; secret absent de l'export et des exécutions | — (mécanisme déjà le repli) : arbitrage |
| G5 codes, en-têtes, doublons | `curl` : clé/jeton faux, candidat clos, conflit, `content-type` faux, corps trop grand, champ manquant, `lot[]` et `nonce` en double | 403/410/409/400 conformes ; `content-type`/`content-length` présents ; C1 sur la forme RÉELLE des doublons | Raw Body + analyse maison (doublons conservés), taille sur le corps brut |
| G6 moteurs / SRI | sha384 des octets réels à l'URL publique ; Page en navigateur réel | égalité au registre ; aucune violation CSP ; SRI acceptée ; POST reçu | autre hôte public CORS (jsDelivr) |
| G7 finding 3 | workflow jetable « FONDA RECETTE - Attente » (nœuds `Webhook attente` -> `Attendre` 60 s -> `Repondre attente`) ; `sonde-executions.js <id>` pendant l'attente | code 0 ; `running`/`waiting` vus pendant, `success` après | preuve de quiescence conçue en P5 |

**Codes de la sonde** (jamais confondus) : **0** = observé (liste exploitable ; `--execution` : exécution PRÉSENTE, schéma et identité vérifiés) ; **1** = INOBSERVABLE (fail-closed : refus d'`observer()`, réponse hors schéma, identité différente, erreur) ; **2** = observé ABSENT (`--execution` : HTTP 404, détail purgé §21.4, traité comme tel). La grille de preuves consigne le code.

Compléments : §21.4 (corps malformé, au-delà de `N8N_PAYLOAD_SIZE_MAX`, arrêt avant le nœud d'entrée, timeout : statut, `runData`, `rattacherPage` rejoué en local via `sonde-executions.js --execution <id>`, code 0/1/2 consigné) ; §13.2 révocation (GET ouvert, clôture technique, soumission -> 410) ; §13.3 parcours navigateur (confirmation, rejet, « Tout rejeter », 409) ; §13.4 ni relance ni reprise.

## Phase 4 — boucle
NO-GO -> repli pré-décidé -> petite PR de suivi -> `comparer-live.js` -> porte rejouée. Fini quand toutes les portes sont vertes.

## Phase 5 — fin
Copies désactivées ; credentials de recette révoqués (clé API comprise) ; sort des copies et dossiers décidé par Éric (aucune suppression sans son accord) ; résultats consignés ci-dessous.

## Preuves (expurgées : jamais `k`, adresse, secret, jeton)
Format par épreuve : `date heure | opérateur | workflow (id) | exécutions (ids) | code de sortie de l'outil (0/1/2) | extrait JSON expurgé | GO/NO-GO`.

### Journal des activations
| Fenêtre | Workflow | Activé à | Désactivé à | Annoncée par |
|---|---|---|---|---|

### Résultats
_(vide : aucune opération d'instance à ce jour)_
