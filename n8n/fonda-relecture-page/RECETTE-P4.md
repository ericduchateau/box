# Recette P4 du parcours page (CDC relecture §13, §21.4) — sur COPIE, instance réelle

> Protocole relu par l'architecte (2026-11-10). **Aucune opération d'instance avant la relecture de la PR P4a.**
> Éric exécute sur la copie, clic par clic ; Claude fournit commandes et sondes, lit en GET seulement.
> **Production intouchée** : aucun workflow BOX ni de génération ouvert, modifié, activé ou désactivé.

## Décisions de cadrage (architecte, 2026-11-10)
- **Isolation sur l'instance unique** (sous réserve de confirmation d'Éric : pas de staging) : copies « FONDA RECETTE - … », chemins `fonda-recette-*`, dossiers Drive, Data Table et credentials de recette. Construites depuis le dépôt (`construire-relecture.js --profil recette`, exports `*.recette.json`), qui **refuse** tout identifiant de production (construction et harnais §1 bis).
- **Limites assumées** : credential Drive de recette = même compte Google (isolement au niveau des dossiers) ; clé d'API n8n non restreinte, **révoquée à la fin**.
- **HMAC (révisé 2026-11-11, P4b)** : Crypto v2 + credential est **absent de n8n 2.6.3** (sources du tag, confirmé par Codex) et `$env` y est bloqué par défaut. **Option E** : nœud **Crypto v1 hmac**, secret en paramètre, valeur de remplacement dans le dépôt, injecté à l'import par l'outil **séparé** `outils-import/importer-recette.js` (écriture explicite) ; critère de confidentialité **révisé** (CDC §21.6, README). Import **par l'API seulement** (POST du texte substitué ; ni import ni enregistrement depuis l'interface : l'éditeur re-sérialise).
- **G7** : fail-closed ; si NO-GO, la preuve de quiescence sera conçue en P5 (pas avant).
- **Règle des outils** : tout ce qui peut atteindre l'instance ou être affiché appartient à un **ensemble fermé de connu-bon** (instance, routes et paramètres par route dont le curseur, en-têtes, références, noms de nœuds, messages reconstruits) ; jamais une denylist ni une grammaire permissive.
- **Octet-identité des 4 exports de production** contre `origin/design` : **consignée dans chaque PR P4** (SHA-256 + `git diff --stat`), relue par l'architecte (P4a : zéro ; P4b : exactement le diff HMAC de Page et Confirmer, zéro sur Emettre et Cloturer).

## Phase 0 — dépôt seulement (PR P4a, puis P4b)
- P4a : profil de recette + exports `*.recette.json` (octet-identité, scan, isolement, équivalence à la production aux identifiants près) ; `outils-recette/` (transport **GET seulement** prouvé par test, `sonde-executions.js`, `comparer-live.js`) ; ce fichier. **Exports de production inchangés octet pour octet.**
- P4b : jeton par Crypto v1 hmac (Page et Confirmer), secret absent du dépôt et de la page ; présent dans la base, l'historique et les instantanés d'exécution (critère révisé).

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
| Champs de réponse réinjectés ou affichés (T7, T8, T10, S4, S5, K4–K6, K9, K10, K11) | réponses hors forme (curseur, statut non entier, JSON illisible, corps non objet, dates, identité, états, versionId) -> refus ou marqueur |
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
| S5 | sonde | champs de réponse (détail) | réponse n8n | **identité** (id renvoyé = demandé), schéma `includeData`, statut LF, mode LF, workflowId GS, `startedAt`/`stoppedAt` (même `dateSure`), noms LC ; `erreur_noeud` ∈ {nom LC, `<erreur_noeud hors liste>`, `<erreur_noeud incohérent>`, null} : source 1 `error.node.name`, sinon source 2 = l'UNIQUE nœud en erreur de `runData` (nœuds Code du task runner), aucun ou plusieurs -> null ; nom ≠ `lastNodeExecuted` (absent compris) -> incohérent ; corps non objet -> T10, code 1 | « --execution INOBSERVABLE », « PRÉSENTE », « HTTP 200 … null », « dates », « erreur_noeud » (×5), « ANTI-FUITE » |
| S6 | sonde | codes de sortie | — | 0 présent ; 1 inobservable ; 2 absent (404) ; jamais confondus | « --execution … 0 / 2 / 1 » |
| S7 | sonde | stderr, erreur au CHARGEMENT | — | `messageSur` ; gestionnaire précoce (marqueur, code 1) | « erreur au CHARGEMENT » |
| S8 | sonde | **champs de sortie construits** | sonde | `schema` : constante ; `workflowId`/`id` : argument validé (S2) ; `observe_le` : horloge locale ; clés de `brut` : LF {running, waiting, liste} ; `fusion`/`en_vol` : dérivés de valeurs déjà filtrées (S4) ; `refus_observer`/`cause` : LF de catégories ou constantes ; `observation` : LF {present, absent, inobservable} ; `runData_present` : booléen dérivé ; `<nom hors liste n°k>` : compteur local ; **ensemble exact des clés** de chaque sortie (liste observée, liste refusée, présent, absent, inobservable) | « S8 : forme EXACTE de chaque sortie de la sonde » (variable d'environnement en trop sans effet) |
| K1 | comparateur | arguments | argv | `analyser` : aucune option, 2 positionnels exacts | « arguments stricts » |
| K2 | comparateur | `workflowId` | argv | GS `ID_WORKFLOW` | « lecture du live » |
| K3 | comparateur | fichier lu : référence | argv, appelant JavaScript | LF `REFERENCES` (8 chemins exacts, relatifs au dépôt : 4 de recette puis 4 de production, déploiement phase A ; secret admis sur les 2 nœuds Crypto de chaque environnement), pour la ligne de commande ET pour `comparer()` (lu en interne) ; nom affiché depuis la liste | « principal : référence hors liste fermée » |
| K4 | comparateur | **champ de réponse : `id`** | réponse n8n | **identité** `live.id === workflowId` (GS), sinon `IDENTITE`, code 1 | « lecture du live » (test négatif) |
| K5 | comparateur | clés et états du live | réponse n8n | contenu = 4 clés ; métadonnées LF ; états typés exacts ; clé inconnue -> marqueur | « états typés EXACTS », « écarts localisés » |
| K6 | comparateur | sortie | — | écarts = chemins de clés du DÉPÔT + marqueurs ; `versionId` GS ; aucune valeur du live ; code 0/1 | idem |
| K7 | comparateur | stderr, erreur au CHARGEMENT | — | `messageSur` ; gestionnaire précoce | « erreur au CHARGEMENT » |
| K8 | comparateur | fichier de référence illisible ou non objet | dépôt | `EXPORT_ILLISIBLE`, code 1 : lecture en échec, JSON invalide, ou JSON qui n'est pas un objet simple (`null`, tableau, nombre, chaîne ; même typage que S3) ; objet aux clés ≠ name/nodes/connections/settings -> écart « clés ≠ » | « sources de fichiers illisibles », « K8 : référence dont le JSON n'est pas un objet » |
| K9 | comparateur | **champs de sortie construits** | comparateur | `schema` : constante ; `workflowId` : argument validé (K2) ; `export` : élément de LF (K3) ; `versionId` : GS hexadécimal/tirets sinon null ; `identique` : booléen dérivé ; `ecarts` : K6 ; **ensemble exact des clés** (`principal()` et `comparer()`) | « versionId affiché seulement en grammaire stricte », « K9 : forme EXACTE de la sortie du comparateur » |
| K10 | comparateur | **secret HMAC d'instance (P4b)** | réponse n8n | SEULE divergence admise : paramètre `secret` du nœud Crypto hmac nommé (« Signer jeton » Page, « Recalculer jeton » Confirmer), 64 hex, ≠ valeur de remplacement ; ramené à la valeur de remplacement dans une copie, jamais affiché ; aucune exception pour Emettre, Cloturer ni ailleurs | « P4b : secret HMAC — SEULE divergence admise » |
| K11 | comparateur | **réglages ajoutés par n8n à la création** (constat phase 2) | réponse n8n | LF `REGLAGES_AJOUTES_PAR_N8N` = `callerPolicy: "workflowsFromSameOwner"`, `availableInMCP: false` : admis SEULEMENT en fin de `settings`, après les clés du dépôt, dans cet ordre, valeurs EXACTES ; retirés d'une copie avant la comparaison stricte ; toute autre valeur (dont `callerPolicy: "any"`), position, ordre, clé supplémentaire, ou présence dans l'export = écart. **Limite** : la garantie porte sur l'objet après parsing ; l'API n8n ne renvoie que des objets sérialisés, sans doublon ; pas de détection avant parsing, pour ne pas élargir la surface du transport lecture seule | « K11 : réglages ajoutés par n8n », « K11 EXHAUSTIF » (127 placements, seuls les 4 légitimes), instantané littéral (« sonde et comparateur : listes fermées ») |
| X1 | tous | **modules chargés (directement ou transitivement)** | dépôt et Node | **tracés** par `Module._load` à l'exécution de chaque commande et comparés à une **liste fermée explicite** (constructeur, 2 profils ; sonde, liste et détail ; comparateur, comparaison complète jusqu'au code 0 avec un faux live conforme) ; tout module nouveau fait échouer ; aucun module hors dépôt hors Node | « X1 (constructeur) … TRACÉS », « X1 : modules chargés par la sonde », « … par le comparateur » |
| F1 | tous | **paramètres et exports des fonctions exportées** (appelant JavaScript) | appelant | exports et signature de chaque fonction en **liste fermée** ; chaque paramètre fermé : `url` -> T1 ; `cle` -> T5/T6 ; `env` -> T6 ; `fetch` -> toujours enveloppé par le transport (T2–T10) ; `argv` -> C1/C2, S1, K1 ; `option`/`profil`/`brutRecette` -> C1–C8 ; `live` -> K5/K6 ; `reference` -> K3 (élément de `REFERENCES`, aucun texte ni objet de l'appelant) ; liste de confiance : **aucun** paramètre (S3) | « F1 (constructeur) », « F1 : exports et paramètres … », « F1 : la liste de confiance n'est remplaçable par AUCUN paramètre », « F1 : comparer() n'accepte qu'un ÉLÉMENT de REFERENCES » |

### Outil d'import (ÉCRITURE explicite, P4b) — hors oracle, hors témoin
`outils-import/importer-recette.js` (CODEOWNERS) : seul outil qui écrit sur l'instance ; l'oracle (`outils-recette/`) reste en lecture seule.

| Frontière | Contrôle (ensemble fermé) | Test (`outils-import/importer-recette.test.js`) |
|---|---|---|
| confirmation | `--confirmer-ecriture` exigé, arguments exacts | « principal : confirmation explicite », « ligne de commande » |
| export | par environnement (déploiement phase A) : 4 exports de recette ou 4 de production (REFERENCES), noms EXACTS de l'environnement de la cible ; cibles conjointes `page-et-confirmer` / `page-et-confirmer-production` | « liste fermée », « listes fermées de production », « import CONJOINT de production » |
| étanchéité des environnements | clé d'import : variable de l'environnement de la cible SEULE (`FONDA_N8N_CLE_IMPORT_RECETTE` / `_PRODUCTION` ; celle de l'autre présente = refus `CLE_ENVIRONNEMENT`) ; trousseau : service HMAC de l'environnement SEUL (`fonda-recette-page-hmac` / `fonda-prod-page-hmac` ; service croisé ou hors liste = refus `SERVICE_CROISE`) | « trousseau : un environnement ne lit QUE ses services », « principal : cible de production », « CLI PRODUCTION » |
| secret | trousseau macOS, `/usr/bin/security` sans shell, argv exact ; lu UNE fois (import conjoint Page+Confirmer) ; 64 hex minuscules ; relu == envoyé (en mémoire) ; jamais affiché | « appel du trousseau », « secret : forme stricte », « secret RELU ≠ envoyé », « CLI » |
| substitution | fragment EXACT unique (Page, Confirmer), 0 (Emettre, Cloturer) ; garde du code intacte ; corps POSTÉ = texte substitué | « substitution du SEUL fragment exact », « import nominal » |
| requêtes | GET liste par nom paginé jusqu'au bout (éléments, curseurs validés ; incomplet ou malformé = refus), POST, GET du créé ; instance fermée ; `redirect: error` | « import CONJOINT nominal », « précontrôle de doublon », « précontrôle fail-closed » |
| Gate 0 (projet) | AUTOMATIQUE (décision de l'architecte, 2026-11-15) : après CHAQUE création, relecture GET ; UN SEUL propriétaire (`role: workflow:owner`) dont `projectId` = `PROJET_ATTENDU[environnement]` (`oz9pBdYxCmm8UQ4l` pour les deux) ; sinon `PROJET`, arrêt immédiat, ids créés restitués. Seul `projectId` est lu ; `shared` et l'adresse du propriétaire ne sont jamais émis (comparer-live inchangé : `shared` reste une métadonnée ignorée, jamais affichée) | « Gate 0 AUTOMATIQUE » |
| nom par référence ; ordre des refus ; import conjoint | nom EXACT attendu PAR RÉFÉRENCE (`NOM_ATTENDU`) ; `CLE_ENVIRONNEMENT` (variable de l'autre environnement présente, même vide) PRIME sur `CLE` ; import conjoint ARRÊTÉ au premier écart (`ECART`, aucun second POST, écarts conservés dans le diagnostic) ; faux serveur des tests exigeant `X-N8N-API-KEY` | « nom EXACT par référence », « principal : cible de production », « secret RELU ≠ envoyé », « clé d'API : le faux serveur EXIGE la bonne clé » |
| sortie et reprise | `import-recette/v1` ou `import-production/v1` (comparer-live) ; POST ou relecture actifs -> erreur ; après création : étape + ids créés (grammaire stricte) | « après création », « CLI » |
| chargement, surface, modules | erreur au chargement = message fixe ; exports et signatures (F1) et modules tracés (X1) en listes fermées | « erreur au CHARGEMENT », « F1 », « X1 » |

**Compatibilité de la recette (PR2)** : fonctionnelle, pas à l'octet sur la sortie d'erreur. Les textes `CIBLE_HORS_LISTE`, `CLE` et `TROUSSEAU` ont changé (ils couvrent les deux environnements) ; les sorties nominales et le schéma `import-recette/v1` sont inchangés. **Limite résiduelle acceptée** : l'étanchéité porte sur le CHOIX des sources (variable de clé et service de trousseau de l'environnement de la cible), pas sur les VALEURS : une valeur de recette copiée à la main sous un service ou une variable de production n'est pas détectable. Couvert par la discipline (secrets distincts générés par `openssl rand -hex 32` ; services de recette détruits en phase 5). **Limite cosmétique connue** : la troncature d'un écart à 300 caractères peut couper une paire UTF-16 (par exemple un emoji placé à la limite) ; affichage seulement, verdict (« identique ») et confinement non touchés ; n'arrive pas avec les entrées actuelles (chemins de clés du dépôt, noms de nœuds). Pas de correction prévue.

## Constats d'Éric (2026-11-10)
- **Instance unique** (`n8n.srv868991.hstgr.cloud`, 2.6.3), pas de staging : isolement par dossiers, Data Table, credentials et noms « FONDA RECETTE », comme prévu.
- **Purge des exécutions : DÉSACTIVÉE** (relevé du 2026-11-10, ci-dessous) : `EXECUTIONS_DATA_PRUNE = false`, vérifié à la source dans le conteneur. Les exécutions sont **conservées**. L'hypothèse antérieure « purge par défaut, assumée » est **retirée**.
- **Fenêtre de signature : sans objet** (`EXECUTIONS_DATA_PRUNE = false`). Le cas « exécution absente » reste traité (sonde code 2, §21.4, refus de signer) pour le cas où ce réglage changerait ; rien à reverser en P5 à ce titre.

### Relevés phase 1 (2026-11-10, VPS, lecture seule, Éric ; rien modifié) — trace §13.5
| Variable / fait | Valeur relevée | Conséquence |
|---|---|---|
| `EXECUTIONS_DATA_PRUNE` | `false` (vérifié à la source, conteneur n8n) | exécutions conservées ; pas de fenêtre de signature |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | non fixé (défaut) | défaut 2.x = **bloqué** (`$env` lève une erreur) : le `$env` de P2 aurait échoué fermé ; P4b le retire (Crypto v1 hmac) |
| `N8N_PAYLOAD_SIZE_MAX` | non fixé : défaut 16 Mo | borne du test §21.4 « corps trop grand » : > 16 Mo |
| version n8n | 2.6.3 | — |

## Phase 1 — constats et préparation (Éric, aucune activation)
1. ~~Terminal du VPS, lecture seule~~ **FAIT le 2026-11-10** : relevés consignés ci-dessus (trace §13.5) ; aucune modification.
2. **Drive** : dossier `FONDA-RECETTE` avec `lots/`, `relecture/`, `decisions/`.
3. **Data Table** `fonda_recette_relecteurs`, créée dans le **MÊME PROJET n8n** que les 4 workflows importés (une Data Table est limitée à son projet) ; table **dédiée**, non modifiée pendant une émission. Colonnes **exactes**, type **texte** : `relecteur_attribue`, `adresse`. Deux lignes (décision de l'architecte) : `eric` et `justine`, toutes deux -> **adresse de test d'Éric**. Consigner : projet, colonnes et types, identifiant de la table.
4. **Credentials** (noms imposés par `profil-recette.json`) : `FONDA RECETTE Drive`, `… Emettre Token`, `… Cloturer Token`, `… Gmail relecture` (plus de credential « API n8n » : la Data Table est lue par le nœud natif). **Secret HMAC de page (P4b, option E)** : PAS de credential ; secret de recette généré par Éric (`openssl rand -hex 32`), rangé au trousseau macOS (service `fonda-recette-page-hmac`), distinct de la production et des 2 jetons, injecté à l'import par `outils-import/importer-recette.js`.
5. Éric transmet **les identifiants seulement** (jamais un secret) -> petite PR qui renseigne `profil-recette.json` et régénère les exports.
6. **Lot de recette** : un `set_id` **réservé au journal d'un commit ANCIEN** (aujourd'hui publié), passé en `journal_commit` ; aucune écriture au journal. Lot source synthétique conforme à `validerLot`, déposé dans `lots/` de recette. Aucune donnée d'élève.

## Procédure opératoire de phase 2 (validée par l'architecte, 2026-11-11)
Faits vérifiés dans les sources `n8n@2.6.3` : (1) les **scopes de clé d'API** ne s'appliquent que sous licence (`isApiKeyScopesEnabled`) ; sans elle, middleware vide : **toute clé a les droits de son propriétaire** (« lecture seule » = par usage : nos outils ne font que des GET) ; (2) le **POST** public crée **toujours** dans le projet personnel du propriétaire de la clé (`getPersonalProjectForUserOrFail`), aucun `projectId` lu.

**Prérequis (Éric, Mac)** — P1 secret HMAC : `S=$(openssl rand -hex 32); security add-generic-password -s fonda-recette-page-hmac -a fonda -w "$S"; unset S` (sans `-U` : échoue s'il existe) ; contrôle sans affichage : `security find-generic-password -s fonda-recette-page-hmac -w | wc -c` = 65. P2 (juste avant l'import) : 2 clés d'API créées **sous le compte d'Éric** (Settings > n8n API), étiquette et expiration courte : « FONDA RECETTE import » (écriture, outil d'import seul) et « FONDA RECETTE lecture » (sonde, comparer-live), rangées au trousseau (`fonda-recette-n8n-import`, `fonda-recette-n8n-lecture`), révoquées en phase 5. P3 : les outils lisent `process.env` seulement (aucun `.env`, jamais en argument) ; export à la volée par commande : `FONDA_N8N_CLE_IMPORT_RECETTE="$(security find-generic-password -s fonda-recette-n8n-import -w)" node …` (idem `FONDA_N8N_CLE_RECETTE`). P4 : lot de recette (phase 1, point 6), validé par l'architecte avant tout dépôt.

**Import** (go explicite de l'architecte à CHAQUE commande) : Emettre -> **Gate 0** -> Cloturer -> `page-et-confirmer`. **Gate 0** : « FONDA RECETTE - Emettre relecture » visible dans Overview > **Personal** (`oz9pBdYxCmm8UQ4l`), lecture seule ; sinon ARRÊT, repli (a) PRIORITAIRE : recréer la clé d'import sous le compte propriétaire de `oz9p…` ; (b) `PUT /api/v1/workflows/{id}/transfer` seulement si (a) impossible (nouvelle route d'écriture : petite PR). Annonce avant (« import de <cible>, inactif, aucune activation ») et après (ids, code, Gate 0 -> grille des preuves).

**Portes** : `comparer-live` **AVANT** chaque porte ; ordre **G6 -> G3 -> G4 -> G5 -> G2 -> G1 -> G7** ; activation/désactivation par l'interrupteur de l'interface (jamais d'édition ni d'enregistrement), heures au journal des activations ; appels Emettre/Cloturer par `curl` avec `X-FONDA-Token` lu au trousseau ; `k`, lien, adresse, secret et jetons ne sont jamais communiqués à une IA ; données : lot synthétique, Data Table (`eric`, `justine` -> adresse de test), dossiers `FONDA-RECETTE/` seulement. **Fixture** : `activeVersion`/`activeVersionId` relevés après G3 (1re activation : en 2.x, activer = publier) ; traitement dans comparer-live décidé alors par l'architecte. **G3 cas (c)** (table inexistante via copie jetable) : **non retenu**. G6 hors ligne (sha384/sha256 des octets jsDelivr épinglés vs registre) + volet navigateur pendant G4. G7 : workflow jetable « FONDA RECETTE - Attente » créé à la main (hors régime d'octet-identité ; noms de nœuds dans la liste de confiance de la sonde).

## Phase 2 — import INACTIF et octet-identité live
- Import des 4 copies (go explicite d'Éric), **inactives**, par l'outil séparé (3 commandes) : `FONDA_N8N_CLE_IMPORT_RECETTE=… node outils-import/importer-recette.js --confirmer-ecriture <cible>` avec `<cible>` = l'export de recette Emettre, celui de Cloturer, puis `page-et-confirmer` (Page ET Confirmer ensemble : secret HMAC de recette lu UNE fois dans le trousseau, service `fonda-recette-page-hmac`, généré par Éric `openssl rand -hex 32`, distinct de la production et des 2 jetons ; même clé pour les deux par construction). Précontrôle de doublon paginé jusqu'au bout (non atomique : discipline « un seul écrivain », le Mac d'Éric) ; POST du texte substitué ; relecture : inactif, identité, secret relu == envoyé, comparer-live. Après une création, toute erreur restitue l'étape et les ids créés (aucune suppression automatique).
- **Fixture à constater (pas une décision)** : n8n supprime `executionTimeout` égal au défaut de l'instance lors d'une **mise à jour** (`PUT`, `removeDefaultValues`) ; le **POST** public de création utilisé ici suit un autre chemin, où cette suppression n'est pas établie. Si le champ disparaît réellement à l'import, comparer-live rend `$.settings.executionTimeout : absent du live` (code 1) : refus strict maintenu, analyse avant toute décision. Ne jamais corriger par `PUT` ni depuis l'interface.
- **Fixture CONSTATÉE (2026-11-11, import d'Emettre `McD7qTGQHeov0nmT`)** : l'outil d'import a rendu `identique: false`, code 1, avec 2 écarts dans `$.settings` seulement : n8n 2.6.3 ajoute à la création `callerPolicy: "workflowsFromSameOwner"` et `availableInMCP: false` en fin de `settings` (aussi présents sur un autre workflow créé par l'API, `4pDA91YG9ssSus3X`). Caractérisés, puis tolérés EXACTEMENT par comparer-live (K11). `name`, `nodes`, `connections` identiques ; Gate 0 constaté (`shared.projectId = oz9pBdYxCmm8UQ4l`, `personal`). Le workflow est conservé et revérifié par comparer-live étendu (code 0 attendu).
- **Secret** : comparer-live admet la SEULE divergence du paramètre `secret` des 2 nœuds Crypto (64 hex, jamais la valeur de remplacement, jamais affiché) ; identité stricte partout ailleurs.
- `FONDA_N8N_CLE_RECETTE=… node outils-recette/comparer-live.js <id> n8n/fonda-relecture-page/box-fonda-<k>-relecture.recette.json` (référence : un des 4 chemins exacts) : GO = code 0, `identique: true` (métadonnées descriptives ignorées ; états typés exacts : `active === false`, `isArchived === false`, version active nulle ; clé inconnue = échec à examiner). Sinon (code 1) ARRÊT.
- **Première comparaison réelle = fixture** (expurgée) : si l'ordre des clés ou la présence d'`isArchived` diffèrent de l'hypothèse, NO-GO et analyse avant toute décision.

## Phase 3 — portes (une fenêtre d'activation par porte, annoncée par l'architecte)
| Porte | Épreuve | GO | Repli (NO-GO) |
|---|---|---|---|
| G1 version +1 (conditionne P5) | ≥ 6 écritures du candidat (émission, réémission, clôture, deux écritures dans la même seconde) ; versions avant/après lues dans les exécutions | après = avant + 1 à chaque PATCH | contrôle avant écriture conservé, après = informatif, verrou CLI porteur |
| G2 `name contains` | `decisions/` : conformes + leurres (`…_01`/`…_011`, préfixe, tirets, soulignés) ; C6 et listing de Cloturer | toute décision conforme (`fonda_set_id`) retrouvée ; leurres écartés | requête par propriété seule |
| G3 Data Table (nœud natif, décision 2026-11-10) | émission réelle ; puis, sur le VRAI nœud (le harnais le remplace par un nœud Code) : table vide, relecteur absent, doublon, adresse hors grammaire, table inexistante ou hors projet | nominal : adresse lue à l'exécution, courriel reçu à l'adresse de test, absente de l'export, import accepté en `typeVersion` 1 (comparer-live) ; chaque cas négatif : exécution en ERREUR au nœud Data Table ou « Valider destinataire », **aucune écriture** du candidat, **aucun courriel** | arbitrage (le repli « API + clé » est écarté : clé non restreinte) |
| G4 HMAC (Crypto v1, secret injecté) | sur le VRAI nœud, secret réel injecté : (1) bout en bout : GET Page (Page signe) -> POST Confirmer (recalcule) -> C2 passe ; jeton faux ou valeur modifiée -> C2 403 ; (2) IF : rejet C1 -> « Syntaxe valide ? » branche faux, Crypto NON exécuté, réponse 400 ; page indisponible -> « Page disponible ? » branche faux, Crypto NON exécuté, 410 (relevé dans l'exécution, lecture seule) | comportements du harnais ; secret absent des exports COMMITTÉS et de la page ; présence dans les instantanés d'exécution = critère révisé assumé. Portée : le contournement et les gardes couvrent les pannes et incohérences DÉTECTABLES de Crypto ; l'exactitude du HMAC repose sur le nœud Crypto natif (source 2.6.3 vérifiée) et sur l'épreuve G4 en recette | — (mécanisme déjà le repli) : arbitrage |
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
| G3 (Data Table, nœud natif) | Emettre `McD7qTGQHeov0nmT` (seul) | heure au journal d'Éric | heure au journal d'Éric | architecte |
| G4 (HMAC, Crypto v1) + G6 navigateur | Page `RcplBgiyLl5oF26K` puis Confirmer `Yp1hKYuYdICZ84KM` (Emettre inactif) | heure au journal d'Éric | heure au journal d'Éric (ordre inverse) | architecte |
| G5 (codes, en-têtes, doublons) | Page, Confirmer, Emettre, Cloturer | heure au journal d'Éric | heure au journal d'Éric (ordre inverse) | architecte |
| G2 (`name contains`, leurres) | Emettre `McD7qTGQHeov0nmT` (seul) | heure au journal d'Éric (1er appel 2026-11-13 13:32 Paris) | heure au journal d'Éric (après le contrôle final de 15:23 ; inactif constaté par GET) | architecte |
| G2 rejeu (filtre exact, #95) | Emettre `Goe8Tt63lNI99meP` (seul, réimporté) | heure au journal d'Éric (1er appel 2026-11-14 17:56 Paris) | heure au journal d'Éric (avant le contrôle final de 18:24 ; inactif constaté par GET) | architecte |
| G1 (version +1, cycle émission/réémission/refus/clôture) | Emettre `Goe8Tt63lNI99meP` (E1–E6, E9), Cloturer `E2tWxiMuX8St1H0B` (E7–E9) ; Page et Confirmer inactifs | heure au journal d'Éric (E1 2026-11-14 19:37 Paris) | heure au journal d'Éric (après E9 de 20:26 ; ordre inverse ; inactifs constatés par GET) | architecte |
| G7 (sonde, exécutions en vol) | jetable « FONDA RECETTE - Attente » `cQl2Z7xQKVSMgcyG` (seul) ; les 6 copies inactives | heure au journal d'Éric (2026-11-14) | heure au journal d'Éric ; jetable puis supprimé (404 constaté par GET) | architecte |

### Résultats
Phase 2 — import inactif et octet-identité (2026-11-11 ; opérateur : Éric ; heures exactes au journal d'Éric ; aucune activation). Extraits expurgés : jamais `k`, adresse, secret, jeton.

| Date | Opérateur | Épreuve | Workflow (id) | Outil, code | Extrait expurgé | Verdict |
|---|---|---|---|---|---|---|
| 2026-11-11 | Éric | Import Emettre (1re tentative) | Emettre `McD7qTGQHeov0nmT` | importer-recette, **code 1** | `identique: false` ; 2 écarts `$.settings` (réglages ajoutés par n8n : `callerPolicy`, `availableInMCP`) ; `name`/`nodes`/`connections` identiques | fixture K11 (caractérisée, tolérée exactement, PR #91) ; workflow CONSERVÉ |
| 2026-11-11 | Éric | Gate 0 | Emettre `McD7qTGQHeov0nmT` | interface + GET lecture seule | `shared.projectId = oz9pBdYxCmm8UQ4l`, type `personal` | **GO** |
| 2026-11-11 | Éric | comparer-live (après K11) | Emettre `McD7qTGQHeov0nmT` | comparer-live, **code 0** | `identique: true`, `ecarts: []` | **GO** |
| 2026-11-11 | Éric | Import Cloturer | Cloturer `WQ2fDu56h6bGJ88B` | importer-recette, **code 0** | `identique: true`, inactif | **GO** |
| 2026-11-11 | Éric | Import `page-et-confirmer` (secret lu une fois) | Confirmer `Yp1hKYuYdICZ84KM`, Page `RcplBgiyLl5oF26K` | importer-recette, **code 0** | 2 imports `identique: true`, inactifs, secret relu == envoyé | **GO** |
| 2026-11-11 | Éric | comparer-live ×4 | Emettre, Cloturer, Confirmer, Page (ids ci-dessus) | comparer-live, **code 0** ×4 | `identique: true`, `ecarts: []` ; `executionTimeout: 120` de Confirmer PRÉSERVÉ par le POST (fixture non déclenchée) | **GO** |
| 2026-11-11 | Éric | G6 hors ligne | — (jsDelivr `@e66fe79…`, `moteur-correction-v1.js`) | curl + shasum + openssl | SHA-256 `ce14c3e4…` = registre ; sha384 `mUn/uhV5…` = attendu | **GO** (volet navigateur : pendant G4) |

Phase 3 — porte G3 (Data Table, nœud natif ; fenêtre d'Emettre seul ; opérateur : Éric ; dates 2026-11-11 et 2026-11-12, heures exactes et ids d'exécution au journal d'Éric). Ordre : cas (b) d'abord, (a) en dernier. Extraits expurgés : jamais `k`, adresse, jeton.

| Date | Opérateur | Épreuve | Workflow (id) | Outil, code | Extrait expurgé | Verdict |
|---|---|---|---|---|---|---|
| 2026-11-11 | Éric | comparer-live avant la porte | Emettre `McD7qTGQHeov0nmT` | comparer-live, **code 0** | `identique: true` | **GO** |
| 2026-11-11/12 | Éric | G3 b1 table vide | Emettre | curl + sonde, **code 0** | `status: error` au nœud « Valider destinataire » (lu dans `runData`, voir trou de la sonde) ; rien écrit dans `relecture/` ; aucun courriel | **GO** (rejet avant écriture) |
| 2026-11-11/12 | Éric | G3 b2 relecteur absent | Emettre | curl + sonde, **code 0** | `status: error`, « Valider destinataire » ; rien écrit ; aucun courriel | **GO** |
| 2026-11-11/12 | Éric | G3 b3 doublon (redéfini : 2 lignes `eric`, 2 adresses de test différentes) | Emettre | curl + sonde, **code 0** | `status: error`, « Valider destinataire » ; rien écrit ; aucun courriel | **GO** |
| 2026-11-11/12 | Éric | G3 b4 adresse hors grammaire (valeur synthétique) | Emettre | curl + sonde, **code 0** | `status: error`, « Valider destinataire » ; rien écrit ; courriel jamais tenté | **GO** |
| 2026-11-12 | Éric | G3 (a) nominal | Emettre | curl + sonde, **code 0** | `status: success` ; candidat `set_fonda_proportionnalite_nI_02.candidat.json` créé ; courriel reçu à l'adresse de test (adresse lue à l'exécution, absente de l'export) | **GO** ; candidat et lien CONSERVÉS pour G4 |
| 2026-11-12 | Éric | comparer-live après désactivation (relevé de la fixture `activeVersion`) | Emettre `McD7qTGQHeov0nmT` | comparer-live, **code 0** | `identique: true` après activer/désactiver | **GO** ; fixture `activeVersion` NON déclenchée |

Trouvailles de G3 (consignées, aucune valeur sensible) :
- **Credential Gmail à autoriser** : 1re version de b3 INVALIDE comme cas de test (au plus une ligne valait exactement `eric` : « Valider destinataire » a passé), exécution en échec à « Envoyer lien » (« Unable to sign without access token »), candidat orphelin écrit ; credential « FONDA RECETTE Gmail relecture » autorisé par Éric dans l'interface.
- **API Gmail activée** dans le projet Google Cloud du client OAuth (`923455870405`) : essai suivant en HTTP 403 `accessNotConfigured` / `SERVICE_DISABLED` ; activation par Éric, puis (a) GO. Aucun changement de dépôt.
- **Règle « candidat à la corbeille -> refus » GARDÉE** : Emettre refuse d'émettre tant qu'un candidat du même nom est à la corbeille ; suppression DÉFINITIVE exigée avant de rejouer (décision de l'architecte : comportement voulu, inchangé).
- **Arête « candidat écrit avant envoi confirmé »** : chaque échec d'envoi laisse un candidat orphelin dont la clé est perdue (README : « envoi non confirmé, candidat déjà écrit ») ; comportement par conception. Orphelins de G3 supprimés définitivement par Éric avant le cas (a) final.
- **Trou de la sonde (`erreur_noeud`)** : `sonde-executions.js` lit `resultData.error.node`, absent pour les erreurs des nœuds Code (task runner) -> `erreur_noeud: null` alors que l'exécution est en erreur. Nœud en erreur établi par `runData` (preuve indépendante). Correctif (lecture dans `runData`, `lastNodeExecuted` en contrôle de cohérence, tests et mutations) : petite PR **avant G5**. Sans effet sur G4 (les rejets de Page et Confirmer sont des exécutions `success`).
- **Fixture `activeVersion` NON déclenchée** : comparer-live rend code 0 après un cycle activer/désactiver (publication propre à n8n 2.x) ; aucun traitement à ajouter à comparer-live.

Phase 3 — porte G4 (HMAC, vrai nœud Crypto v1, secret injecté) et volet navigateur de G6 (fenêtre Page + Confirmer ; Emettre inactif ; opérateur : Éric ; 2026-11-12 ; heures exactes et ids d'exécution au journal d'Éric, sauf 280695). Ordre : 2a, 2a′, 2b, 1b, puis 1a + G6. Extraits expurgés : jamais `k`, lien, adresse, jeton, contenu du lot.

| Date | Opérateur | Épreuve | Workflow (id) | Outil, code | Extrait expurgé | Verdict |
|---|---|---|---|---|---|---|
| 2026-11-12 | Éric | G4 2a Page, `k` fausse (aléatoire) : branche fausse de « Page disponible ? » | Page (exécution 280695) | curl + sonde, **code 0** | `http=410` ; `success` ; « Preparer jeton » -> « Page disponible ? » -> « Construire page » -> « Repondre page » ; **« Signer jeton » absent** (aucun jeton calculé) ; corps = page indisponible FIXE, **586 octets, SHA-256 `9dd20bd1…`** = valeur attendue (calculée depuis l'export, comparée par Éric sans affichage) : aucune donnée du lot | **GO** (Crypto contourné, aucune fuite) |
| 2026-11-12 | Éric | G4 2a′ Page, requête mal formée (`k` absente) : branche fausse de « Requete valide ? » | Page | curl + sonde, **code 0** | `http=400` ; « Page indisponible » ; ni « Chercher candidat » ni « Signer jeton » | **GO** |
| 2026-11-12 | Éric | G4 2b Confirmer, C1 (`content-type` JSON) : branche fausse de « Syntaxe valide ? » | Confirmer | curl + sonde, **code 0** | `http=400` ; « Controler syntaxe formulaire » ; **« Recalculer jeton » absent** | **GO** (Crypto contourné) |
| 2026-11-12 | Éric | G4 1b C2 : jeton faux ; valeur modifiée (vrai jeton, empreinte changée) | Page + Confirmer | script 1b (ci-dessous) + sonde, **code 0** | `jeton faux http=403`, `valeur modifiée http=403` ; « Recalculer jeton » et « Verifier formulaire » présents, **« Chercher candidat » absent** ; rien dans `decisions/` | **GO** |
| 2026-11-12 | Éric | G4 1a bout en bout + G6 navigateur | Page + Confirmer | Chrome (Console, Réseau) + sonde, **code 0** | page 200, cartes affichées, moteur chargé depuis jsDelivr, **SRI acceptée** ; **aucune violation CSP ni SRI** de la page ; soumission : C2 accepte -> « FONDA Ecrire decision » -> décision écrite dans `decisions/` | **GO** (G4 et G6 navigateur) |
| 2026-11-12 | Éric | comparer-live après désactivation | Page, Confirmer | comparer-live, **code 0** ×2 | `identique: true` (fixture `activeVersion` non déclenchée) | **GO** |

**Correction du graphe de la Page (feuille G4) :** le rejet APRÈS lecture du candidat (C3 au GET, dont une `k` fausse) ne passe PAS par le nœud « Page indisponible ». La branche fausse de « Page disponible ? » mène directement à « Construire page », dont la garde initiale (`if (p.disponible !== true) return indisponible();`) renvoie `{ code: 410, html: <page fixe> }` avant tout usage du candidat, des nonces ou de `k`. Le nœud « Page indisponible » ne sert qu'aux rejets AMONT (« Requete valide ? » faux -> 400 ; « Candidat trouve ? » faux -> 410). Les deux nœuds produisent la même page fixe (même gabarit, message constant, CSP `default-src 'none'`, aucun script ni formulaire). Les instantanés d'exécution de « Lire candidat » et des nonces contiennent le candidat côté n8n seulement (critère révisé assumé), jamais la réponse HTTP.

**État laissé pour la suite** : une décision dans `decisions/` ; candidat `set_fonda_proportionnalite_nI_02` toujours `en_attente` (entrées de G5 — soumission différente -> 409 — et de G2). Rejouer 1a exigera une réémission (G1).

**Script 1b** (usage unique, NON versionné, consigné verbatim sur décision de l'architecte ; sûr par construction : `action=accepter` avec un seul choix `choix_it99`, carte inexistante, si bien que si C2 cédait à tort, C5 rejetterait en 400 SANS rien écrire ; le lien passe par le presse-papiers sur l'entrée standard, jamais en argument ni à l'écran ; seuls les codes HTTP sont affichés) :
```sh
pbpaste | node -e '
const u = new URL(require("fs").readFileSync(0, "utf8").trim());
if (u.origin !== "https://n8n.srv868991.hstgr.cloud" || u.pathname !== "/webhook/fonda-recette-select") { console.log("lien inattendu"); process.exit(1); }
(async () => {
  const p = await fetch(u, { redirect: "error" }); const html = await p.text();
  const m = html.match(/<script type="application\/json" id="donnees">([\s\S]*?)<\/script>/);
  if (p.status !== 200 || !m) { console.log("page http=" + p.status); process.exit(1); }
  const ch = JSON.parse(m[1]).formulaire.champs;
  const bascule = (h) => h.slice(0, -1) + (h.endsWith("0") ? "1" : "0");
  const cas = { "jeton faux": { ...ch, jeton: bascule(ch.jeton) }, "valeur modifiée": { ...ch, empreinte: bascule(ch.empreinte) } };
  for (const [nom, c] of Object.entries(cas)) {
    const r = await fetch(u.origin + "/webhook/fonda-recette-select-confirm", { method: "POST", redirect: "error",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...c, action: "accepter", choix_it99: "garder" }) });
    console.log(nom + " http=" + r.status);
  }
})();'; pbcopy < /dev/null
```

Phase 3 — porte G5 (codes, en-têtes, doublons, conflit/idempotence ; fenêtre Page + Confirmer + Emettre + Cloturer ; opérateur : Éric ; 2026-11-13 ; heures exactes au journal d'Éric). Ordre : A1, A2, B, C. **Octet-identité des 4 tenue AVANT (pré-vol) et APRÈS (clôture)** : comparer-live **code 0** ×4, versionIds inchangés (Emettre `372ff051`, Cloturer `aede6651`, Page `ed6ef116`, Confirmer `ecc77684`). Extraits expurgés : jamais `k`, lien, adresse, jeton ; nonces tronqués.

| Date | Opérateur | Épreuve | Workflow (id) | Outil, code | Extrait expurgé | Verdict |
|---|---|---|---|---|---|---|
| 2026-11-13 | Éric | comparer-live pré-vol et clôture | les 4 | comparer-live, **code 0** ×4 (avant) et ×4 (après) | `identique: true` ; versionIds inchangés | **GO** |
| 2026-11-13 | Éric | G5 A1 Emettre, jeton d'en-tête faux (aléatoire), corps `{}` | Emettre `McD7qTGQHeov0nmT` | curl + sonde, **code 0** | `http=403`, corps « Authorization data is wrong! » (authentification du webhook n8n), `www-authenticate: Basic realm="Webhook"`, `x-content-type-options`/`x-xss-protection` présents ; **AUCUNE exécution** (dernier id 280666 inchangé, `en_vol: []`) | **GO** |
| 2026-11-13 | Éric | G5 A2 Cloturer, jeton d'en-tête faux, corps `{}` | Cloturer `WQ2fDu56h6bGJ88B` | curl + sonde, **code 0** | `http=403` « Authorization data is wrong! » ; Cloturer toujours **sans aucune exécution** (liste `[]`) | **GO** |
| 2026-11-13 | Éric | G5 B Confirmer, C1 avant Crypto (6 cas, tous avec `choix_it99`) : content-type faux, champ manquant (`empreinte`), `lot` en double, `nonce` en double, corps > 64 Kio | Confirmer (exécutions 280762–280766) | script G5 `MODE=c1` + sonde, **code 0** | 5 × `http=400`, `content-type` et `content-length` présents ; 5 exécutions `success`, 9/9 nœuds, `erreur_noeud: null` ; « Recalculer jeton » (Crypto) et « Controler candidat » (C5) **jamais exécutés** | **GO** |
| 2026-11-13 | Éric | G5 B cas 6 : corps > 16 Mo | Confirmer | script G5 `MODE=c1` | `http=500` à l'entrée de n8n ; **AUCUNE exécution** (pas de 6e id) : le corps démesuré n'atteint jamais le workflow, aucune écriture | **GO** (500 au lieu de 413 : comportement d'entrée de l'instance, sans incidence) |
| 2026-11-13 | Éric | G5 C conflit / idempotence : nonce frais (`570041aa…`), CHOIX = choix exacts de G4 (`it01=garder,it02=garder,it03=ecarter`) | Confirmer (exécutions 280768, 280769, 280770) | script G5 `MODE=409` + sonde, **code 0** | P1 `http=200` « créée » ; P2 (un choix inversé, même nonce) `http=409` ; P3 (rejeu de P1) `http=200` « existante » ; `content-type` et `content-length` présents partout ; 3 exécutions `success`, `erreur_noeud: null` | **GO** |

Détail de G5 (lectures en `preview` seulement : structure et types, aucune valeur lue) :
- **A1, A2** : le rejet d'authentification est produit par n8n hors de tout nœud de réponse (chaîne brute) : **pas** de `content-type`/`content-length`, attendu (cadre n8n). Le critère « `content-type` et `content-length` présents » vaut pour B et C, pas pour A1/A2. 401 ou 403 valaient GO (décision de l'architecte).
- **B, parcours des 5 rejets** : Webhook confirmation -> FONDA Entree confirmation -> Controler syntaxe formulaire -> Syntaxe valide ? (faux) -> Verifier formulaire -> Formulaire valide ? (faux) -> FONDA Sortie confirmation -> Preparer reponse (C1 -> 400) -> Repondre confirmation. Rejet purement C1 ; `choix_it99` jamais sollicité.
- **Doublons = TABLEAUX, constaté sur l'instance 2.6.3** : `body.lot` (280764) et `body.nonce` (280765) livrés en tableau ; l'entrée les ramène à `null` ; rejet C1. **Repli « Raw Body » inutile.** 280762 : `body` livré en chaîne (non analysé, content-type faux) ; 280763 : `body` sans `empreinte`.
- **C, tronc commun (14 nœuds)** : C1 puis C2 (« Recalculer jeton », « Verifier formulaire ») ; Chercher candidat, Verifier recherche candidat, Candidat trouve ? (vrai), Lire candidat, Controler candidat (C3–C5) ; Decision construite ? (vrai), Chercher decision, Analyser decision existante, Decision existante ?. Divergence à « Decision existante ? » :
  - **P1** (24 nœuds, branche fausse) : Relire candidat, Verifier relecture candidat, Relecture conforme ? (C5bis), **FONDA Ecrire decision**, **Verifier ecriture decision** -> 1 écriture ; le 200 « créée » vient de « Verifier ecriture decision » (constate identifiant, nom, dossier `decisions/`, propriétés `fonda_set_id`/`fonda_nonce`).
  - **P2** (21 nœuds, branche vraie) : Lire decision existante, **Comparer decision** -> conflit (cœur différent, comparaison canonique octet par octet), résultat SANS clé `ecriture` (`ecriture: null` en sortie) -> 409. **Aucune écriture** (ni « FONDA Ecrire decision » ni « Relire candidat »).
  - **P3** (21 nœuds, branche vraie) : Lire decision existante, **Comparer decision** -> même lot, nonce, génération et cœur -> `ecriture: 'existante'` (`decision_sha256` du fichier RELU, jamais reconstruit) -> 200. **Aucune réécriture.**
  - Les deux 200 se distinguent par le nœud producteur : « Verifier ecriture decision » (créée) vs « Comparer decision » (existante) ; « FONDA Ecrire decision » n'apparaît que dans P1. Sortie commune : FONDA Sortie confirmation -> Preparer reponse (`CODES[type]`) -> Repondre confirmation.

**État laissé pour G2 et G1** : 2 fichiers dans `decisions/` (G4, nonce `39948493…` ; P1, nonce `570041aa…`), **même cœur** (accepter / gardées `[it01, it02]` / écartée `[it03]`) -> `L.unicite` tenue ; `hash_formulaire` diffère (dépend du nonce, hors cœur). Candidat `set_fonda_proportionnalite_nI_02` toujours `en_attente`.

**Confinement** : lien (`k`), jeton, adresse jamais transmis à une IA ; le script lit le lien sur l'entrée standard et n'affiche que nom du cas, code HTTP et présence des en-têtes ; Claude Code n'a fait que des GET en `preview` (structure et types). Les instantanés d'exécution contiennent le corps posté (`k`, nonce, jeton), le candidat et la décision, côté n8n seulement (critère révisé déjà assumé).

**Script G5** (`g5-confirmer.js`, usage unique, NON versionné, consigné verbatim sur décision de l'architecte ; SHA-256 `43fcdf45496c7c3e6f546a6ecfa4c5ceb2d21ea8d1d67d390cea22d92aaa2849`, 4024 octets ; usage : `pbpaste | MODE=c1 node g5-confirmer.js; pbcopy < /dev/null`, puis `pbpaste | MODE=409 CHOIX='itNN=…,…' node g5-confirmer.js; pbcopy < /dev/null`) :
```js
// G5 — usage unique, NON versionné. Lien de relecture lu sur l'ENTRÉE STANDARD (presse-papiers), jamais en argument ni à l'écran.
// MODE=c1  : rejets avant Crypto (content-type faux, champ manquant, lot/nonce en double, corps > 64 Kio, corps > 16 Mo).
// MODE=409 : CHOIX='it01=garder,it02=ecarter,…' (choix EXACTS de la décision G4) : P1 -> 200 créée ; P2 (un choix inversé) -> 409 ; P3 = P1 -> 200 existante.
// Affiche seulement : nom du cas, code HTTP, présence (oui/NON) de content-type et content-length.
const ORIG = 'https://n8n.srv868991.hstgr.cloud';
const u = new URL(require('fs').readFileSync(0, 'utf8').trim());
if (u.origin !== ORIG || u.pathname !== '/webhook/fonda-recette-select') { console.log('lien inattendu'); process.exit(1); }
const CONF = ORIG + '/webhook/fonda-recette-select-confirm';
const MODE = process.env.MODE;
if (MODE !== 'c1' && MODE !== '409') { console.log('MODE = c1 ou 409'); process.exit(1); }
const corps = (champs, extra = []) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(champs)) p.append(k, v); for (const [k, v] of extra) p.append(k, v); return p.toString(); };
const post = async (nom, body, ct = 'application/x-www-form-urlencoded') => {
  let r;
  try { r = await fetch(CONF, { method: 'POST', redirect: 'error', headers: { 'content-type': ct }, body }); await r.arrayBuffer(); }
  catch { console.log(`${nom} : connexion interrompue par le serveur (aucun code HTTP)`); return null; }
  console.log(`${nom} http=${r.status} content-type=${r.headers.has('content-type') ? 'oui' : 'NON'} content-length=${r.headers.has('content-length') ? 'oui' : 'NON'}`);
  return r.status;
};
(async () => {
  const p = await fetch(u, { redirect: 'error' }); const html = await p.text();
  const m = html.match(/<script type="application\/json" id="donnees">([\s\S]*?)<\/script>/);
  if (p.status !== 200 || !m) { console.log('page http=' + p.status); process.exit(1); }
  const d = JSON.parse(m[1]); const ch = d.formulaire.champs; const ids = d.cartes.map((c) => c.item_id);
  if (MODE === 'c1') {
    // choix_it99 (carte inexistante) : si un cas passait C1 à tort, C5 rejetterait en 400 SANS écrire ; la sonde départage (« Recalculer jeton » absent attendu).
    const base = { ...ch, action: 'accepter', choix_it99: 'garder' };
    const { empreinte, ...sansEmpreinte } = base;
    await post('content-type faux', corps(base), 'text/plain');
    await post('champ manquant', corps(sansEmpreinte));
    await post('lot en double', corps(base, [['lot', ch.lot]]));
    await post('nonce en double', corps(base, [['nonce', ch.nonce]]));
    await post('corps > 64 Kio', corps(base, [['bourrage', 'a'.repeat(70000)]]));
    await post('corps > 16 Mo', corps(base, [['bourrage', 'a'.repeat(17 * 1024 * 1024)]]));
    return;
  }
  const choix = (process.env.CHOIX || '').split(',').filter(Boolean).map((x) => x.split('='));
  if (choix.length !== ids.length || new Set(choix.map((c) => c[0])).size !== ids.length || !choix.every(([i, v]) => ids.includes(i) && (v === 'garder' || v === 'ecarter')) || !choix.some((c) => c[1] === 'garder')) {
    console.log('CHOIX invalide ; item_id attendus : ' + ids.join(',')); process.exit(1);
  }
  const champsChoix = (cx) => Object.fromEntries(cx.map(([i, v]) => ['choix_' + i, v]));
  const k = choix.findIndex((c) => c[1] === 'ecarter'); const j = k >= 0 ? k : 0; // inverse un « ecarter » (sinon le 1er « garder ») : au moins une carte gardée
  const autre = choix.map(([i, v], n) => [i, n === j ? (v === 'garder' ? 'ecarter' : 'garder') : v]);
  if (!autre.some((c) => c[1] === 'garder')) { console.log('inversion impossible'); process.exit(1); }
  const p1 = corps({ ...ch, action: 'accepter', ...champsChoix(choix) });
  if (await post('P1 mêmes choix que G4', p1) !== 200) { console.log('ARRÊT : P1 ≠ 200'); process.exit(1); }
  await post('P2 même nonce, choix différents', corps({ ...ch, action: 'accepter', ...champsChoix(autre) }));
  await post('P3 rejeu exact de P1', p1);
})();
```

Phase 3 — porte G2 (`name contains` : conformes + leurres ; fenêtre d'Emettre SEUL ; opérateur : Éric ; 2026-11-13 ; heures exactes au journal d'Éric). **Banc** : Emettre appelé avec le corps et le jeton valides ; avec ≥ 1 décision du lot, « Analyser emission » lève `decisions/ : N décision(s) du lot : ni émission ni réémission` AVANT la Data Table, toute écriture et tout courriel : **N = nombre de fichiers rendus par la requête `qDecisions`** (« Lister decisions »), lu dans `error.description` (le `message` n8n est tronqué après les deux-points). Leurres : fichiers `{}` sans propriété, déposés par Éric dans `FONDA-RECETTE/decisions/` **un par un, cumulativement**, ~2 min d'attente avant chaque appel. Extraits expurgés : jamais `k`, jeton, adresse.

**Pré-vol** : jeton d'en-tête d'Emettre **remplacé** (aucune entrée de trousseau n'avait été prévue en phase 1) : nouvelle valeur générée par Éric directement au trousseau (service `fonda-recette-emettre-token`, `openssl rand -hex 32`), collée dans le credential « FONDA RECETTE Emettre Token » (nom d'en-tête inchangé) ; workflow non ouvert. Cloturer : jeton non remplacé (plus tard si besoin). Exécution manuelle avec données épinglées **écartée** (édition du workflow et « Execute » interdits). Référence sonde : dernier id 280666.

**Couverture de Cloturer** : les 3 nœuds `qDecisions` (Emettre « Lister decisions » et « Relister decisions », Cloturer « Lister decisions ») ont des paramètres identiques **au nom du nœud source du `set_id` près** (`$('FONDA Entree emission')` / `$('Valider cloture')`) : même `httpRequest` v4.2, même requête, mêmes options (corbeille, pagination, champs). Emettre×2 identiques à l'octet (SHA-256 des paramètres `2625c790…`) ; Cloturer `00d1ac74…`, une seule ligne diffère. Prouver le gabarit sur Emettre couvre Cloturer pour un même `set_id` validé. C6 de Confirmer (`name = '<lot>-<nonce>.json'`, nom exact) : hors sujet de sur-correspondance, 0 et 1 fichier déjà prouvés en G5.

| Étape | Fichier ajouté (cumulatif) | Exécution | N | Nouveau nom compté (lecture des noms) | Verdict |
|---|---|---|---|---|---|
| 0 | aucun (G4 + P1) | 280798 | **2** | — | **GO** (référence) |
| T+ | `S-ffffffffffffffffffffffffffffffff.json` (nom conforme, sans propriété) | 280799, 280800 | **3** | T+ | **GO** (témoin positif ; déjà compté à 280799) |
| T🗑 | T+ mis à la corbeille | 280801 | **3** | — | **GO** (corbeille comprise, voulu §9/§21.1) |
| L1 | `set_fonda_proportionnalite_nI_021-leurre.json` | 280802 | 3 | — (absent aussi à 280803–280810) | **GO** |
| L2 | `x-set_fonda_proportionnalite_nI_02-leurre.json` | 280803 | **4** | L2 | **NO-GO** (sur-correspondance) |
| L3 | `set_fonda_proportionnalite_nI_02_leurre.json` | 280804 | **5** | L3 | **NO-GO** |
| L4 | `set_fonda_proportionnalite_nI_02leurre.json` | 280806 | **6** | L4 | **NO-GO** |
| L5 | `set-fonda-proportionnalite-nI-02-leurre.json` | 280807 | **7** | L5 | **NO-GO** |
| L6 | `set_fonda_proportionnalite_nF_02-leurre.json` (autre palier) | 280808 | 7 | — | **GO** (pas de collision entre `set_id`) |
| L7 | `SET_FONDA_PROPORTIONNALITE_NI_02-leurre.json` | 280809 | **8** | L7 | **NO-GO** (casse ignorée) |
| Contrôle final | T+ puis L1–L7 **supprimés définitivement** par Éric | 280810 | **2** | noms : G4 `…-39948493….json`, P1 `…-570041aa….json` seulement | **GO** (état de départ rétabli, corbeille comprise) |
| Clôture | Emettre désactivé | — | — | — | comparer-live **code 0** (`identique: true`, versionId `372ff051` inchangé) ; `active=false` ; `en_vol: []`, dernier id 280810 |

(S = `set_fonda_proportionnalite_nI_02`. 280805 n'est pas une exécution d'Emettre : ids communs à l'instance.)

**Toutes les exécutions** (12 : 280798–280804, 280806–280810) : sonde `--execution` **code 0**, `status: error`, `mode: webhook`, **`erreur_noeud: « Analyser emission »`** (correctif #92 confirmé en conditions réelles, forme task-runner), 11 nœuds exécutés (Webhook emission … Lister decisions, Analyser emission) ; **jamais** « Relister decisions », « Lire adresse relecteur », « Generer cle », écriture ni « Envoyer lien » ; aucun courriel. Un appel de L7 n'a produit aucune exécution (relancé ensuite : 280809). Recoupement : `upstreamContext` (mode `error`, 0 échantillon) donne `files._length` = N à chaque fois.

**Modèle observé de `name contains` dans Drive** (interprétation des 9 cas, non documentée par Google) :
- les séparateurs `_` et `-`, et la frontière chiffre↔lettre (`02leurre`), sont **équivalents** : découpage en mots, ponctuation de la requête ignorée ;
- la suite de mots de `<set_id>-` est cherchée **n'importe où** dans le nom (préfixe `x-` compté) ;
- **casse ignorée** ;
- le **dernier mot doit être entier** (`02` ne prend pas `021`) ; **aucune collision entre `set_id` distincts** observée (L1, L6 au vert).

**Sens des sur-correspondances (aucun filtrage par nom exact dans n8n après la requête)** : Emettre -> **faux refus** avant toute écriture (lot bloqué, sens sûr) ; Cloturer -> `nb_decisions_listees` gonflé, diagnostic seulement (§21.2) ; signataire -> filtre sur le `set_id` du contenu puis nom exact et propriétés : fichier non conforme = incident, abandon (sens sûr). Défaut caractérisé : **NO-GO de G2 sur le critère « leurres écartés »** ; correctif décidé par l'architecte : filtre exact (PR séparée), puis réimport de recette et G2 rejouée.

**Limite** : un leurre NON compté ne prouve rien que s'il était indexé au moment de l'appel. Délai d'indexation calibré sur T+ (compté ≤ ~2 min après dépôt) ; L1 reste absent à 280803–280809 (jusqu'à > 1 h après dépôt), L6 seulement à 280808–280809 (~30 min).

**Lectures de Claude Code** : GET seuls. Message d'erreur en mode `error`, 0 échantillon, sans chemin ni pile complète ; sonde. **Noms de « Lister decisions »** (autorisation de l'architecte, d'abord pour 280803 puis permanente pour G2) : exécution complète téléchargée par GET, filtrée EN LOCAL, seul le champ `name` affiché (280803 par une commande ponctuelle de même logique, ensuite par `g2-noms.sh` ci-dessous). Les exécutions d'Emettre arrêtées à « Analyser emission » ne contiennent ni `k` (« Generer cle » non exécuté), ni adresse (« Lire adresse relecteur » non exécuté).

**Script `g2-noms.sh`** (usage unique, NON versionné, consigné verbatim ; SHA-256 `0a1d22e92c58def94af1b7d858aabc26fe352bdd45872a02489c4cc125cfaeea`, 802 octets ; usage : `bash g2-noms.sh <id d'exécution>`) :
```bash
# G2 : affiche UNIQUEMENT les champs name de la sortie de « Lister decisions » (Emettre). GET seul.
id="$1"
curl -sS -H "X-N8N-API-KEY: $(security find-generic-password -s fonda-recette-n8n-lecture -w)" "https://n8n.srv868991.hstgr.cloud/api/v1/executions/$id?includeData=true" | node -e '
const d=JSON.parse(require("fs").readFileSync(0,"utf8"));
if (d.workflowId!=="McD7qTGQHeov0nmT") { console.log("workflow inattendu"); process.exit(1); }
const r=d.data.resultData.runData["Lister decisions"]||[];
const noms=[]; for (const t of r) for (const br of (t.data&&t.data.main)||[]) for (const it of br||[]) for (const f of (it.json.files||[])) noms.push(f.name);
console.log("exécution '"$id"' : nœud exécuté "+r.length+" fois, "+noms.length+" noms"); noms.sort().forEach(n=>console.log("  "+n));'
```

**État laissé pour G1** : `decisions/` = 2 fichiers (G4, P1), corbeille vide pour le lot ; candidat `set_fonda_proportionnalite_nI_02` toujours `en_attente` ; Emettre refusera toujours ce lot (décisions présentes) : G1 exigera un nouveau `set_id`.

Phase 3 — **rejeu de G2 après le correctif « filtre exact »** (#95 ; 2026-11-14 ; opérateur : Éric ; heures exactes au journal d'Éric). **Correctif** : la requête Drive large (`qDecisions`) est inchangée ; seuls COMPTENT les fichiers au nom EXACT `<set_id>-[0-9a-f]{32}.json` OU portant `properties.fonda_set_id === set_id` (`decisionsDuLot`, identique dans Emettre « Analyser emission », « Verifier ecriture » et la sortie de Cloturer) ; plafond et `incompleteSearch` restent calculés sur les pages BRUTES (refus par défaut).

**Réimport** (option « renommer + réimporter », décision de l'architecte) : copies d'avant correctif renommées par Éric dans l'interface, **inactives, conservées** : Emettre `McD7qTGQHeov0nmT` et Cloturer `WQ2fDu56h6bGJ88B` -> « … (avant G2) ». Exports recette corrigés importés par `importer-recette.js --confirmer-ecriture` (aucun secret HMAC : 0 fragment dans ces 2 exports ; aucun jeton d'en-tête requis : seule la définition est postée ; les credentials existants sont référencés par id). Les anciennes et nouvelles copies partagent chemin de webhook et `webhookId` : **ne jamais activer une copie « (avant G2) »**.

| Date | Opérateur | Épreuve | Workflow (id) | Outil, code | Extrait expurgé | Verdict |
|---|---|---|---|---|---|---|
| 2026-11-14 | Éric | Import Emettre corrigé | Emettre `Goe8Tt63lNI99meP` | importer-recette ; puis comparer-live (Claude Code), **code 0** | `identique: true`, `ecarts: []`, versionId `51ddd073…` ; inactif | **GO** |
| 2026-11-14 | Éric | Import Cloturer corrigé | Cloturer `E2tWxiMuX8St1H0B` | importer-recette ; puis comparer-live (Claude Code), **code 0** | `identique: true`, `ecarts: []`, versionId `ab3bae07…` ; inactif | **GO** |
| 2026-11-14 | Claude Code | Gate 0 + homonymes | les 4 copies Emettre/Cloturer | GET (liste, 57 workflows, 1 page ; détail) | un SEUL homonyme exact par nom (les nouvelles) ; anciennes renommées « (avant G2) » ; les 4 `active=false`, `activeVersionId=null`, `shared.projectId = oz9pBdYxCmm8UQ4l` (`personal`, owner) ; Page et Confirmer inchangés | **GO** |

**Copies de recette en vigueur** (remplacent `McD7…` et `WQ2f…` dans toutes les commandes) : Emettre `Goe8Tt63lNI99meP`, Cloturer `E2tWxiMuX8St1H0B`, Confirmer `Yp1hKYuYdICZ84KM`, Page `RcplBgiyLl5oF26K`.
```sh
FONDA_N8N_CLE_RECETTE="$(security find-generic-password -s fonda-recette-n8n-lecture -w)" node outils-recette/sonde-executions.js Goe8Tt63lNI99meP
FONDA_N8N_CLE_RECETTE="$(security find-generic-password -s fonda-recette-n8n-lecture -w)" node outils-recette/comparer-live.js Goe8Tt63lNI99meP n8n/fonda-relecture-page/box-fonda-emettre-relecture.recette.json
FONDA_N8N_CLE_RECETTE="$(security find-generic-password -s fonda-recette-n8n-lecture -w)" node outils-recette/comparer-live.js E2tWxiMuX8St1H0B n8n/fonda-relecture-page/box-fonda-cloturer-relecture.recette.json
```
(`g2-noms.sh` ci-dessus reste consigné verbatim pour la G2 d'origine : il refuse tout autre workflow que `McD7…`.)

| Étape | Fichiers de test présents (en plus de G4 + P1) | Exécution | Noms bruts rendus par « Lister decisions » | N (filtré) | Verdict |
|---|---|---|---|---|---|
| R0 | aucun | 280850 | 2 : G4 `…-39948493….json`, P1 `…-570041aa….json` | **2** | **GO** (référence) |
| R1 | T+ `S-ffffffffffffffffffffffffffffffff.json` (nom exact, sans propriété) | 280852 | 3 : T+, P1, G4 | **3** | **GO** (T+ RETENU par son nom exact) |
| R2 | T+ + L2 `x-S-leurre.json`, L3 `S_leurre.json`, L5 `set-fonda-proportionnalite-nI-02-leurre.json`, L7 `SET_FONDA_PROPORTIONNALITE_NI_02-leurre.json` | 280853 | **7** : L3, L7, L2, L5, T+, P1, G4 | **3** | **GO** : Drive sur-correspond toujours (7 bruts), le filtre écarte les 4 leurres |
| Contrôle final | les 5 fichiers de test **supprimés définitivement** par Éric | 280854, 280855 (même curl envoyé deux fois, 4 s d'écart) | 2 : P1, G4 | **2** | **GO** (état de départ rétabli) |
| Clôture | Emettre désactivé | — | — | — | comparer-live **code 0** (`identique: true`, versionId `51ddd073…`) ; `active=false`, `activeVersionId=null` |

(S = `set_fonda_proportionnalite_nI_02`. 280851 n'est pas une exécution d'Emettre : ids communs à l'instance.)

**Toutes les exécutions** (5 : 280850, 280852–280855) : `status: error`, `mode: webhook`, dernier nœud = nœud en erreur = **« Analyser emission »**, message `decisions/ : N décision(s) du lot : ni émission ni réémission` ; une page, `incompleteSearch=false`, sans `nextPageToken`. **Preuve réelle** : en R2, la requête large rend 7 fichiers et N filtré reste 3 : `decisionsDuLot` contient la sur-correspondance de `name contains` caractérisée en G2 ; le témoin positif T+ (nom exact, sans propriété) reste compté.

**Lectures de Claude Code** : GET seuls ; 280850 en mode `error`, 0 échantillon ; noms (autorisation permanente de l'architecte) : exécution complète téléchargée par GET avec la clé de lecture et filtrée EN LOCAL, seuls les champs `name` de « Lister decisions » affichés (jamais `properties` ni autre donnée de nœud).

**Chaîne de validation du correctif** : architecte (décision « filtre exact », 2026-11-13) ; Claude Code (tests du filtre et du faux Drive aligné sur le modèle G2 ; mutations du filtre : 19 jouées, **18 tuées**, la survivante `includes` au lieu de `startsWith` étant équivalente ; harnais 225/225, suite 6134/6135 dont 1 ignoré) ; **Codex** (critique croisée en lecture seule, effort élevé, 2026-11-13 : **favorable**, 2 réserves mineures de tests, traitées en `7a1396a`) ; **rejeu sur l'instance** (2026-11-14, ci-dessus). G2 : **GO**.

**État laissé pour G1** : inchangé (`decisions/` = G4 + P1 ; candidat `en_attente`) : G1 exigera un nouveau `set_id`.

Phase 3 — **porte G1** (version Drive +1 à chaque réécriture ; cycle émission / réémission / refus / clôture ; 2026-11-14 ; opérateur : Éric ; heures exactes au journal d'Éric). Extraits expurgés : jamais `k`, lien, adresse, jeton.

**Banc** :
- **`set_id` de test** : `set_fonda_resolution-problemes_nI_02` (maths, relecteur `eric` -> adresse de test), **`journal_commit` = `ae1ae903a3ec2d49b01d495ad28d9ebedcc56059`** (« réservation set_fonda_resolution-problemes_nI_02 » : dernière transition `reserve` à ce commit, publication à `ce6b615`) ; même schéma que G3. Aucune écriture au journal. `proportionnalite_nI_02` (2 décisions) reste refusé par Emettre.
- **Corps d'appel** `corps-emettre-g1.json` (308 octets, SHA-256 `f398ac7cc90e18e09757ef790abf0bbe6234f32ba04fdd777c484d1223af5ced`) : `{ set_id, journal_commit, referentiel_version: sha256:c7db61c6…97b4, moteur: { v1, ce14c3e4…1753 } }`. **Lot source** `set_fonda_resolution-problemes_nI_02.lot.json` (3272 octets, SHA-256 `f3d254d23ed75534673923419a9f5d0f13a6c7eddb7c439a09f0e585800f5ddc`) = copie à l'octet du lot publié du dépôt (`lot-fonda/v1`, 5 cartes, contenu public), déposé par Éric dans `FONDA-RECETTE/lots/`. Préparés hors dépôt par Claude Code ; contrôles 0–5 d'« Analyser emission » rejoués en local au commit consigné (corps, référentiel, moteur au registre, réservation, `validerLot` + cohérence set_id/notion/palier, relecteur `eric`) : tous verts.
- **Jeton de Cloturer remplacé** avant la fenêtre (même procédure qu'Emettre) : trousseau `fonda-recette-cloturer-token`, collé dans le credential « FONDA RECETTE Cloturer Token » ; workflow non ouvert. En-tête passé à curl par `-H @<(printf 'X-FONDA-Token: %s\n' "$(security find-generic-password -s <service> -w)")` (absent de la liste des processus).
- **Pré-vol** (GET) : comparer-live **code 0** ×2 ; sonde code 0 ×2, `en_vol: []` ; dernières exécutions 280855 (Emettre), aucune (Cloturer) ; les 6 copies inactives. Un premier appel E1 n'a créé **aucune** exécution (sonde : rien en vol, rien listé ; cause côté appel, non consignée) ; l'appel suivant a donné 280858.

| Cas | Action | Exécution | Statut, nœud | `generation_cle` / `reemission` / `deja_clos` | Version avant -> relue -> après | Courriel |
|---|---|---|---|---|---|---|
| E1 | émission | 280858 | **success** | 1 / `false` | création (le POST ne demande pas `version`) | **oui (1)** |
| E2 | réémission | 280859 | **success** | 2 / `true` | 2 -> 2 -> **3** | **oui (2)** |
| E3 | réémission | 280860 | **success** | 3 / `true` | 4 -> 4 -> **5** | **oui (3)** |
| E4a | paire simultanée (`curl & curl`) | 280862 | **success** (PATCH à 18:50:49.001 UTC) | 4 / `true` | 6 -> 6 -> **7** | **oui (4)** |
| E4b | paire simultanée | 280861 | **error** à « Verifier ecriture » : « écriture concurrente détectée (version **9 ≠ 7**) : aucun courriel » | — (visait aussi la génération 4) | 6 -> 6 -> **9** ; « FONDA Reecrire candidat » **success** à 18:50:49.074 (écriture ABOUTIE) | **non** |
| E5 | candidat **à la corbeille** (Éric) | 280863 | **error** à « Analyser emission » : « candidat existant à la corbeille : refus » | — | 11 (lue) ; aucune écriture | non |
| E6 | **restauration** (Éric) puis réémission | 280864 | **success** | 5 / `true` | **12** -> 12 -> **13** | **oui (5)** |
| E7 | **Cloturer** | 280865 (Cloturer) | **success**, `cloture-fonda/v1` (7 clés) | `deja_clos: false` ; statut relu **`clos`** | 14 -> 14 -> **15** (+1 vérifié par la sortie) | — (aucun nœud de courriel) |
| E8 | Cloturer à nouveau | 280866 (Cloturer) | **success**, `cloture-fonda/v1` | **`deja_clos: true`** | 16 (lue) ; « Relire version cloture », « Verifier version cloture », « FONDA Ecrire candidat clos » **absents** | — |
| E9 | Emettre après clôture | 280867 | **error** à « **Preparer candidat** » : « réémission refusée : statut « clos » (seul en_attente, clos_le null) » | — | 16 (lue) ; aucune écriture | non |

(280856, 280857 : autres workflows ; ids communs à l'instance. Emettre : 8 exécutions G1 ; Cloturer : 2.)

**Verdict** : **GO**.
- **+1 avec un seul écrivain** : E2, E3, E4a, E6 (Emettre) et E7 (Cloturer) en `success` ; « Verifier ecriture » / la sortie de Cloturer lèvent au moindre écart, donc chaque `success` PROUVE après = relue + 1 ; valeurs lues concordantes.
- **Concurrence détectée** (E4) : les deux exécutions passent le contrôle avant écriture (6 = 6), écrivent à 73 ms d'intervalle ; la seconde voit **+3** (9 ≠ 7) et s'arrête sans courriel. Son écriture a **abouti** : le contrôle après écriture **détecte**, il n'annule rien (D2/E1, README « Où vit chaque garantie ») ; le candidat portait alors une `k` envoyée à personne (lien de E4a mort), rétablie par E6. Prévention : verrou CLI mono-écrivain (P5).
- **Refus avant écriture** : corbeille (E5), candidat clos (E9) ; **clôture** (E7) et **idempotence** (E8, aucune réécriture).
- 9 écritures du candidat au total (création, 6 PATCH dont la concurrente, corbeille et restauration par Éric) ; **5 courriels**, tous reçus à l'adresse de test, supprimés par Éric.

**Trouvaille 1 — révision tardive de Drive** (constat ; mécanisme exact non documenté par Google) : chaque écriture par un workflow (création ou PATCH) fait avancer la version de **+2** : la réponse de l'écriture rend avant + 1, puis une révision supplémentaire suit **en moins de 73 ms** (E4 : 7 rendu par 280862, 9 rendu par 280861 73 ms plus tard). Mise à la corbeille et restauration par Éric : **+1** chacune (9 -> [10] -> 11 -> 12). Création : E2 relit 2. **Conséquence** : avec un seul écrivain, la révision supplémentaire a eu lieu avant l'appel suivant (secondes plus tard) et le contrôle interne (relue juste avant écriture, après = relue + 1) est **exact** ; avec deux écrivains, l'écart est amplifié (+3 au lieu de +1), donc détecté. Risque résiduel : fausse alarme si une écriture suivait la précédente de moins de ~0,1 s (seulement avec deux écrivains, déjà exclus par P5). Aucun changement de code.

**Trouvaille 2 — contrôle de statut tardif (E9)** : « Analyser emission » n'examine pas le statut du candidat existant (unique, hors corbeille, `decisions/` vide -> branche réémission) ; c'est « Preparer candidat » qui refuse un candidat non `en_attente`. Avant ce refus, l'exécution a fait tourner « Lire adresse relecteur », « Valider destinataire » et **« Generer cle »** : une `k` a été **générée** (jamais écrite ni envoyée) et l'adresse de test lue, **dans les données de l'exécution** (instantané côté n8n, comme toute émission ; critère révisé assumé). Sans effet sur l'intégrité (rien d'écrit, `k` inutilisable). **Piste** (décision de l'architecte) : contrôler le statut (`en_attente`, `clos_le` null) **avant** « Generer cle » (par exemple dans une étape dédiée après « Lire candidat existant »), pour qu'un refus prévisible n'ait aucune `k` dans ses données.

**Confinement** : `k`, liens, adresse et jetons jamais communiqués à l'IA ; Éric a géré les courriels sans coller de lien. Lectures de Claude Code : **GET seuls** (clé de lecture), exécution complète téléchargée puis **filtrée en local** ; affichés seulement : statut, nœud en erreur et message, présence/horaire/statut des nœuds, et les champs **`version`** (« Chercher candidat existant », « Relire version candidat », « FONDA Reecrire candidat » ; Cloturer : « Chercher candidat », « Relire version cloture », « FONDA Ecrire candidat clos »), **`generation_cle`**, **`reemission`** (sortie d'Emettre), **`deja_clos`**, `schema` (sortie de Cloturer), **`statut`** (seul champ lu dans « Relire candidat », E7) ; autorisations de l'architecte, étendues en cours de porte. Jamais le contenu de « Generer cle », « Envoyer lien », « Lire adresse relecteur ».

**Script `g1-paire.js`** (usage pendant G1, NON versionné, consigné verbatim ; SHA-256 `e045844dc2cfb97bb8c8f75fc3c5372157369de43bea407556bea577854b6189`, 2070 octets ; usage : `FONDA_N8N_CLE_RECETTE="$(security find-generic-password -s fonda-recette-n8n-lecture -w)" node g1-paire.js <id>…` ; E4–E6, E9). E3 : `g1-lire.js` (SHA-256 `891622b8feb1a677bbff3e6d15ca306fa56f8456c76dd72fe26dd4872c0dcff2`, même filtrage, sélection de la dernière exécution) ; E1, E2, E7, E8 : commandes ponctuelles de même logique (Cloturer : mêmes champs, nœuds de Cloturer).
```js
// G1 E4 : GET seul ; statut, présence et horaires des nœuds, champs version / generation_cle / reemission, message d'erreur.
(async () => {
  const h = { headers: { 'X-N8N-API-KEY': process.env.FONDA_N8N_CLE_RECETTE, accept: 'application/json' }, redirect: 'error' };
  for (const id of process.argv.slice(2)) {
    const j = await (await fetch('https://n8n.srv868991.hstgr.cloud/api/v1/executions/' + id + '?includeData=true', h)).json();
    if (j.workflowId !== 'Goe8Tt63lNI99meP') { console.log(id, 'workflow inattendu'); continue; }
    const rd = j.data.resultData;
    console.log('\n== exec', id, j.status, j.mode, j.startedAt, '->', j.stoppedAt, 'lastNode=' + rd.lastNodeExecuted);
    if (rd.error) console.log('erreur : description=' + JSON.stringify(rd.error.description) + ' message=' + JSON.stringify(rd.error.message));
    const items = (n) => (rd.runData[n] || []).flatMap((r) => (r.data && r.data.main && r.data.main[0]) || []);
    const t = (n) => rd.runData[n] ? new Date(rd.runData[n][0].startTime).toISOString().slice(11, 23) + ' ' + rd.runData[n].map((r) => r.executionStatus).join(',') : 'ABSENT';
    for (const n of ['Chercher candidat existant', 'Analyser emission', 'Relire version candidat', 'Verifier version candidat', 'FONDA Ecrire candidat', 'FONDA Reecrire candidat', 'Relister decisions', 'Verifier ecriture', 'Envoyer lien', 'FONDA Sortie emission']) console.log('  ' + n.padEnd(28) + t(n));
    console.log('  version avant (Chercher) :', JSON.stringify(items('Chercher candidat existant').flatMap((it) => (it.json.files || []).map((f) => f.version))),
      '| relue (Relire version candidat) :', JSON.stringify(items('Relire version candidat').map((it) => it.json.version)),
      '| après (Reecrire) :', JSON.stringify(items('FONDA Reecrire candidat').map((it) => it.json.version)));
    const s = items('FONDA Sortie emission')[0];
    if (s) console.log('  Sortie : generation_cle=' + s.json.generation_cle, 'reemission=' + s.json.reemission);
  }
})().catch((e) => { console.log('ERREUR', String(e)); process.exit(1); });
```

**Clôture** : Cloturer puis Emettre désactivés ; candidat et lot de test **supprimés définitivement** par Éric, 5 courriels supprimés. GET : comparer-live **code 0** ×2 (`identique: true`, versionId `51ddd073…` et `ab3bae07…` inchangés) ; sonde code 0 ×2, `en_vol: []` (dernières : 280867 Emettre, 280866 Cloturer) ; les 6 copies `active=false`.

**État laissé pour G7** : `decisions/` = G4 + P1 (lot `proportionnalite_nI_02`, inchangé) ; `relecture/` sans candidat `resolution-problemes_nI_02` ; aucun workflow actif.

Phase 3 — **porte G7** (« finding 3 » : la sonde voit-elle une exécution EN VOL ? ; 2026-11-14 ; opérateur : Éric ; heures exactes au journal d'Éric). Extraits expurgés ; aucune donnée réelle (jetable synthétique, réponse fixe « fin »).

**Banc** : workflow jetable « FONDA RECETTE - Attente », 3 nœuds aux noms EXACTS de la liste de confiance de la sonde (`Webhook attente` -> `Attendre` -> `Repondre attente`) ; webhook POST `fonda-recette-attente`, `headerAuth` sur le credential « FONDA RECETTE Emettre Token » (jeton au trousseau, en-tête passé par `-H @<(…)`), `responseMode: responseNode` ; Wait v1.1 de `{{ $json.query.duree === '120' ? 120 : 60 }}` s ; réponse texte fixe, 200. Définition préparée par Claude Code (JSON hors dépôt, 2101 octets, SHA-256 `1dd537e70f8ce8789e3191dfd142fb2b6b69c64846c2ff0044598f94ce0c2e84`, validateur n8n-mcp : 0 erreur) ; hors régime d'octet-identité (vérification GET : nom, nœuds, chemin, credential, inactif, Personal). Appels : `curl --max-time 180 … ?duree=60|120 &`.

**Trouvaille 1 — ids non alphanumériques inobservables** : la 1re création, par **l'éditeur** (« Import from file »), a donné l'id `1fS2ptvPcfmpcCaTL-ioV` (21 caractères, avec `-`) ; la sonde l'a refusé (`workflowId invalide`, **code 1**) : `sonde-executions.js` et `comparer-live.js` valident les ids par `ID_WORKFLOW = /^[A-Za-z0-9]{1,40}$/` (`outils-recette/lecture-seule.js`). Le jetable a été **recréé par l'API** (POST `/api/v1/workflows`, clé d'import, même fichier) : `cQl2Z7xQKVSMgcyG` (16 alphanumériques), accepté (code 0) ; la copie de l'éditeur, archivée, n'a jamais été activée. **Discipline** : les workflows FONDA (recette et production) sont créés par l'API ou l'outil d'import, **jamais par l'éditeur** ; un id hors grammaire rend le workflow inobservable (sonde et comparer-live refusent : sens sûr, fail-closed). Outils inchangés.

| Cas | Action | Exécution | Observé (sondes horodatées) | Verdict |
|---|---|---|---|---|
| Pré-vol | W inactif | — | sonde code 0, tout vide ; comparer-live des 4 copies en vigueur **code 0** | GO |
| G7-T0 témoin | W actif, aucun appel | — | sonde **code 0**, `running: []`, `waiting: []`, `liste: []`, `en_vol: []` | **GO** (témoin négatif) |
| G7-T1 | `?duree=60` | 280869 | **pendant** l'attente : id dans `brut.running`, **`en_vol: [280869]`**, code 0 ; **après** : `success`, `en_vol: []` | **GO** (critère principal) |
| G7-T2 | `?duree=120` | 280870 (startedAt 20:26:11, stoppedAt 20:28:11, 120 s, `success`) | **invisible** aux sondes de +30 s et +90 s : ni `running`, ni `waiting`, ni `liste` ; `en_vol: []` | constat (repli validé : pas un NO-GO) |

(Relevés de la fenêtre transmis par l'architecte. Les exécutions ont disparu avec le jetable : 280869 et 280870 rendent **404** après suppression, comme les 2 workflows.)

**Trouvaille 2 — angle mort `waiting` (cause établie dans les sources de n8n `2.6.3`, tag `n8n@2.6.3`, lecture publique)** :
- `packages/cli/src/public-api/v1/handlers/executions/executions.handler.ts` (`getExecutions`, l. 117–132) : les ids présents en mémoire dans `ActiveExecutions` sont **exclus** du résultat (`excludedExecutionsIds`) **sauf** pour `status=running` (« for backward compatibility `running` executions are always excluded unless the user explicitly filters by `running` status ») ;
- `packages/cli/src/active-executions.ts` (l. 134–148) : une exécution passée en `waiting` **reste** dans `ActiveExecutions` (seule une exécution non `waiting` en est retirée), pour sa reprise ;
- donc une attente ≥ 65 s (déchargée en base, statut `waiting`) est exclue de `status=waiting` ET de la liste complète, et absente de `status=running` (filtre sur le statut en base) : **invisible aux trois requêtes d'`observer()`**. Une attente < 65 s reste `running` et est vue (T1). Le statut `waiting` de 280870 pendant l'attente est **déduit** (sources + seuil), non observé.
- `GET /executions/{id}` (`getExecution`) n'exclut rien : `sonde --execution <id>` verrait `waiting`, mais l'id n'est **pas découvrable** par la liste. Aucune requête de l'API publique ne ferme l'angle mort (contournements écartés : sondage des ids séquentiels communs à l'instance ; API interne `/rest` à session).

**Portée P5** : `observer()` (partagé par la sonde et le signataire) ne voit pas une exécution `waiting` encore en mémoire ; la preuve de quiescence ne vaut que pour des workflows **sans nœud capable d'attendre**. Les 4 workflows FONDA (Emettre 27 nœuds, Cloturer 14, Page 15, Confirmer 26 ; exports de production et de recette) n'ont **aucun** nœud `wait`, `form` ni opération `sendAndWait` (vérifié ; `respondToWebhook` de Page et Confirmer répond sans attente) : ils ne peuvent pas entrer en `waiting`, en vol = `new`/`running`, vus par `status=running`. Garde-fou statique proposé dans une PR de tests séparée (aucun nœud d'attente dans les 4 exports).

**Verdict G7** : **GO** selon le repli validé par l'architecte (T0 vide ; T1 vu en vol puis `success` ; `waiting` jamais vu = constat, cause établie, portée P5 bornée).

**Clôture** : W désactivé puis `cQl2Z7xQKVSMgcyG` et `1fS2ptvPcfmpcCaTL-ioV` **supprimés par l'API** (Éric). GET (Claude Code) : les 2 workflows et les exécutions 280869, 280870 rendent **404** ; comparer-live **code 0** ×4 (Emettre `Goe8…`, Cloturer `E2tW…`, Confirmer `Yp1h…`, Page `Rcpl…`), `active=false` ×4 ; sonde code 0 ×4, `en_vol: []`.

**Phase 3 terminée** : G6, G3, G4, G5, G2 (rejeu), G1, G7 au vert. Suite : phase 5 (désactivation constatée, révocation des credentials et clés de recette, sort des copies et des dossiers décidé par Éric).

Phase 5 — **démontage de l'environnement de recette** (2026-11-14/15 ; écritures : Éric ; lectures GET : Claude Code ; feuille validée par l'architecte). Aucune valeur de clé, jeton, secret ni adresse communiquée à l'IA ; aucun contenu Drive lu.

**Inventaire et partage** (preuve : recensement GET des credentials et Data Tables référencés par les 57 workflows de l'instance ; lecture des 4 exports de production du dépôt) — tout était **propre à la recette** :
- workflows : Emettre `Goe8Tt63lNI99meP`, Cloturer `E2tWxiMuX8St1H0B`, Confirmer `Yp1hKYuYdICZ84KM`, Page `RcplBgiyLl5oF26K`, et les copies « (avant G2) » `McD7qTGQHeov0nmT`, `WQ2fDu56h6bGJ88B` (jetables G7 déjà supprimés) ;
- credentials : `oNP2I7TyfU1uDIyo` (Emettre Token), `AzsWdsfTUbhhUENY` (Cloturer Token), `rIQA9xF9tYcrhEb1` (Drive), `I8NVi8hVrF6TRNIn` (Gmail) : référencés par les seules copies de recette ; **la production est distincte** (exports de production : Drive `cukxQDNwWIqOAK02`, jetons, Gmail et Data Table encore `A_RENSEIGNER_P4_…`, secret HMAC `A_INJECTER_A_L_IMPORT`) ; les workflows de relecture de production n'existent pas sur l'instance ;
- Data Table `hh5uTRuoKi5FwEiM` (`fonda_recette_relecteurs`, adresse de test) : copies Emettre seules ;
- clés d'API « FONDA RECETTE import » et « FONDA RECETTE lecture » ; trousseau : `fonda-recette-n8n-import`, `-n8n-lecture`, `-emettre-token`, `-cloturer-token`, `-page-hmac` ;
- Drive `FONDA-RECETTE/` (`lots/`, `relecture/` avec le candidat `proportionnalite_nI_02`, `decisions/` avec G4 et P1).
Hors recette, intouchés : Génération IA `vrqgtS5kQMvP9Ok5` et portier `MkYrdhgTo52nA3av` (inactifs, credentials propres), les 9 workflows BOX.

| Étape | Opérateur | Action | Preuve (GET, Claude Code) |
|---|---|---|---|
| 1 | Claude Code | **photo avant** : 57 workflows (`id`, `name`, `active`, `isArchived`, `updatedAt`, `versionId`, `activeVersionId`), hors dépôt | `photo-avant.json`, SHA-256 `b2d6e08d5ec5575bbaa414d6cccf7126afffef4e37df2eab46afa600d5510dbb` ; 20 actifs dont les 9 BOX |
| 2 | Éric | suppression des 6 workflows de recette (API) | **404** ×6 ; exécutions **purgées** avec eux : 404 sur 280858, 280865, 280867, 280850 (`Goe8`/`E2tW`), 280798, 280810 (`McD7`), 280695 (`Rcpl`) ; 51 workflows restants |
| 3–4 | Éric | suppression de la Data Table et des 4 credentials (interface) | recensement des 51 workflows : **aucune** référence aux 4 credentials ni à la Data Table. Absence dans les listes : **constat visuel d'Éric** (l'API publique 2.6.3 n'expose ni la liste des credentials, HTTP 405, ni les Data Tables) |
| 5 | Éric | suppression définitive de `FONDA-RECETTE/` (lots, relecture, decisions G4 + P1), archive zip gardée **hors dépôt** | — (aucun contenu Drive lu) |
| 8 | Claude Code | **photo après** et comparaison, AVANT révocation | `photo-apres.json`, SHA-256 `78ee308de9fc1b2acb6e2b29269566aef6d75e912c6ba786e9a6409721ee0c1d` : **51 / 51 identiques** à la photo avant, aucun nouveau, **9 BOX actifs**, **6 recette 404** |
| 9 | Éric | révocation des 2 clés d'API (import, puis lecture) | GET avec chaque ancienne clé : **401** ×2 |
| 10 | Éric | suppression des 5 entrées `fonda-recette-*` du trousseau ; nettoyage de `~/g1-recette/`, `~/g7-recette/` | trousseau : **0** service `fonda-recette-*` (noms seuls) |
| 11 | Claude Code | élagage des worktrees `wt-g4`, `wt-p2`, `wt-p3` (dossiers déjà absents : `git worktree prune`) | `git worktree list` : dépôt principal seul |

**Arbitrages de l'architecte** : `FONDA-RECETTE/` supprimé en totalité (décisions G4, P1 comprises) ; exécutions purgées par la suppression des workflows (elles contenaient `k`, liens, adresse de test) ; **autorisations Google non touchées** (client OAuth `923455870405` potentiellement partagé avec la production : un retrait côté Google vaudrait pour tout le client) ; API Gmail laissée activée ; fichiers de recette du dépôt **gardés** (`profil-recette.json`, `*.recette.json` : le harnais §1 bis en dépend) — leurs identifiants (workflows, credentials, dossiers, Data Table) sont désormais **sans objet**.

**Phase 5 terminée. Recette P4 du parcours page close** : phases 1 à 5, portes G6, G3, G4, G5, G2 (rejeu après #95), G1, G7 **GO** ; correctifs issus de la recette : #92 (sonde `erreur_noeud`), #95 (filtre exact des décisions), #99 (garde-fou « liste fermée des nœuds ») ; restent hors P4 : P5 (CLI, verrou mono-écrivain, quiescence bornée aux workflows sans nœud d'attente) et l'arbitrage G1 « statut contrôlé avant Generer cle ».

## Déploiement en PRODUCTION — phase A (import INACTIF), 2026-11-15

Plan validé par l'architecte (AVANCEMENT, point 1 bis) : phase A = prérequis, profil de production, outillage, import **inactif** ; **aucune activation avant la livraison de P5** (CLI et verrou un seul écrivain, pilier 2). Écritures : Éric ; lectures GET et préparation du dépôt : Claude Code. Aucune adresse, aucun secret dans ce document (identifiants seulement).

**Prérequis créés par Éric** :
- dossiers Drive de production `relecture/` (`1mg7zEZTL6QAnPP--P85lLLihxw-06zDn`) et `decisions/` (`1lh1szMhSjHOyJT_8x11MWR64jvW_VwpT`), à côté de `candidats/` (`1Ir-iJGZoSk5_FmJ9dnf_PM-NEBZWyn8d`), partagés en lecture avec le compte de service du signataire (portée `drive.readonly`) ;
- Data Table `fonda_relecteurs` `gv0fISOeK11ra4Pt`, projet Personal `oz9pBdYxCmm8UQ4l`, colonnes texte `relecteur_attribue` et `adresse`, 2 lignes (`eric`, `justine`) pointant pour l'instant vers la même adresse de contrôle d'Éric (la ligne `justine` sera basculée plus tard, avec l'accord de la relectrice) ; structure constatée visuellement par Éric (l'API publique 2.6.3 n'expose pas les Data Tables ; aucune ligne lue par l'IA) ; le nœud « Valider destinataire » refuse toute table mal formée avant écriture (G3) ;
- credentials : « FONDA Emettre Token » `KyK6EImkoOHA2DQM` et « FONDA Cloturer Token » `apmlvipahDlRLGfD` (Header Auth, en-tête `X-FONDA-Token`), « FONDA Gmail relecture » `XbxKMkx6RK1kfUhO` (gmailOAuth2 ; expéditeur = compte Google autorisé) ; Drive : `cukxQDNwWIqOAK02` réutilisé (isolement par dossiers) ;
- secrets générés par `openssl rand -hex 32`, rangés au trousseau sous `fonda-prod-emettre-token`, `fonda-prod-cloturer-token`, `fonda-prod-page-hmac` ; clé d'API de lecture `fonda-prod-n8n-lecture` (expirante, réutilisée par P5) ; clé d'import `fonda-prod-n8n-import` (courte, révoquée ci-dessous).

**Dépôt** : PR1 « profil de production » (#101 : `CONFIG_PRODUCTION` renseignée, garde inverse, `urlMoteurs` figée sur le commit G6 `e66fe79…`, verrou de l'ensemble des clés de `CONFIG`) et PR2 « outillage de production » (#103 : import et comparer-live étendus, environnements étanches, Gate 0 automatique, nom exact par référence, arrêt au premier écart, écarts bornés) fusionnées dans `design` ; chacune relue par Codex (lecture seule) jusqu'à confirmation favorable.

**Import** (Éric, `outils-import/importer-recette.js`, clé d'import de production en variable dédiée, variable de recette absente ; HMAC lu une fois par l'outil dans `fonda-prod-page-hmac`) : Emettre, puis Cloturer, puis `page-et-confirmer-production` ; chaque commande `import-production/v1`, `identique: true`, **code 0** ; Gate 0 automatique passé à chaque création.

| Workflow | id | versionId | comparer-live |
|---|---|---|---|
| FONDA - Emettre relecture | `5iJOTDkaTZq7z0sh` | `dce56ccb-d3c1-4e32-bc08-a1493855b8f3` | **code 0**, `identique: true` |
| FONDA - Cloturer relecture | `QrmJY4gguZEx7YoS` | `12b3789d-a2d6-472a-ab17-da0b68974243` | **code 0**, `identique: true` |
| FONDA - Confirmer relecture | `W1HAOtjAX3ILZBpX` | `337812fd-6eea-4c8d-84c1-7f32f352d517` | **code 0**, `identique: true` (secret HMAC injecté, K11) |
| FONDA - Page relecture | `nQjoq0UekNNliaMt` | `70c84ddd-4b3b-4e21-9743-4952336d48f5` | **code 0**, `identique: true` (secret HMAC injecté, K11) |

**Vérification GET** (Claude Code, clé de lecture de production ; `shared` et adresses jamais émis, seuls le rôle du propriétaire et l'égalité du `projectId` évalués) : les 4 **inactifs** (`active=false`, `isArchived=false`, aucune version publiée) ; un seul propriétaire, projet `oz9pBdYxCmm8UQ4l` (`personal`) ; **un seul homonyme exact** par nom ; chemins de webhook `fonda-emettre` (POST), `fonda-cloturer` (POST), `fonda-select` (GET), `fonda-select-confirm` (POST) présents **une seule fois**, chacun dans son workflow, **aucune collision** (dont `/box-…`) ; **les 9 workflows BOX actifs identiques** à la photo de référence `~/phase5-recette/photo-apres.json` (SHA-256 `78ee308de9fc1b2acb6e2b29269566aef6d75e912c6ba786e9a6409721ee0c1d` ; `name`, `active`, `isArchived`, `updatedAt`, `versionId`, `activeVersionId`) ; seuls les 4 nouveaux workflows sont apparus, aucun disparu (51 + 4 = 55).

**Clé d'import révoquée** (Éric) : GET avec l'ancienne clé -> **401** ; témoin avec la clé de lecture -> **200** ; entrée `fonda-prod-n8n-import` **supprimée** du trousseau (vérifiée par les noms de service seuls : restent `fonda-prod-emettre-token`, `fonda-prod-cloturer-token`, `fonda-prod-page-hmac`, `fonda-prod-n8n-lecture`).

**Phase A terminée.** **Phase B à faire APRÈS la livraison de P5** : activation (Page et Confirmer, puis Cloturer, puis Emettre), test de bout en bout (`resolution-problemes_nI_02` @ `ae1ae90`, relecteur `eric`) puis suppression définitive du lot, du candidat et de la décision de test, politique de purge des exécutions (`k`, adresses) à fixer, durée de la clé de lecture à caler.

## Déploiement en PRODUCTION — phase B (activation et bout en bout), 2026-11-22 → 2026-11-24

Après la livraison de P5 (P5-3 `cloturer-page.js`, #108). Chaque geste en écriture a reçu un feu vert explicite de l'architecte. **Écritures : Éric** (clé d'écriture de production `fonda-prod-n8n-ecriture`, courte, révoquée en fin de phase). **Lectures GET et vérifications locales : Claude Code** (clé de lecture). Aucun `k`, jeton, secret ni adresse dans ce document ; aucune valeur transmise à l'IA.

**Lot de test** : `set_fonda_proportionnalite_nI_89`, et non `resolution-problemes_nI_02` comme prévu en phase A. Ce lot est déjà signé, et les CLI exigent une génération réelle retenue. Il faut donc un `set_id` neuf. `_90–_99` est réservé aux fixtures (`fonda/data/catalogue.test.js`). Réservation commitée par #109 (ref `2026-11-22-199bc7e52938`).

**Activation par l'API** : `POST /api/v1/workflows/<id>/activate` avec `{"versionId": …}` épinglé sur la version importée et auditée (désactivation : `…/deactivate`). Preuve d'octet-identité d'un workflow **actif** : `versionId` inchangé et `activeVersionId == versionId`. comparer-live exige un workflow inactif, d'où cette preuve, acceptée par l'architecte.

| Étape | Opérateur | Geste | Preuve |
|---|---|---|---|
| H3 (pré-vol) | Claude Code | `curl` POST `/fonda-emettre` **avant** activation | **404**, aucune exécution créée (la CLI classe ce 404 en `indetermine`, code inchangé) |
| Génération | Éric | portier `MkYrdhgTo52nA3av` et génération `vrqgtS5kQMvP9Ok5` activés (version épinglée) | exécutions **281290** (portier) et **281291** (génération) : candidat produit. **Correctif #76 prouvé** : `sonde-executions.js vrqgtS5kQMvP9Ok5` voit 281291 **en vol** sur 6 observations successives, puis `success` |
| Retour à l'état inactif | Éric | portier et génération **désactivés** après le test | GET : `active=false`, `versionId` inchangés (`5a51ef8d…`, `2881d35a…`), identiques aux exports du dépôt |
| Activation relecture | Éric | Page et Confirmer, puis Cloturer, puis Emettre | GET ×4 : `active=true`, `versionId` inchangé, `activeVersionId == versionId`, un seul homonyme, 0 collision de webhook |
| Émission | Éric (CLI) | Emettre | **`effet_conforme`**, exécution **281292** ; courriel réel reçu par Éric ; `k` resté privé (jamais transmis à l'IA) |
| Relecture | Éric | page `/fonda-select` puis Confirmer | ouverture de la page : exécution **281293** (workflow Page `nQjoq0UekNNliaMt`, `webhook`, `success` ; métadonnées GET seules) ; Confirmer : exécution **281294**, décision écrite (`generation 1`, écriture `creee`) |
| Clôture technique | Éric (CLI) | `cloturer-page.js` | **`effet_conforme`**, exécution **281295** ; Cloturer : `deja_clos=false`, candidat version **2 → 4**, `nb_decisions_listees=1` |
| Signature (locale) | Éric | signataire | `attestation.json` revérifiée par Claude Code (`verifierPieces`) : type `attestation-signee`, `source_decisions` = `page_relecture`, badge « Éric Duchateau » ; marqueur `set_fonda_proportionnalite_nI_89.signature` → `a3e26dd7409a4304` ; diagnostic **1/1** ; aucun motif interdit dans les pièces. **Rien publié** |

**Décision go-live (architecte)** : les 4 workflows de relecture **restent ACTIFS**. Génération et portier restent **inactifs** hors fenêtre de génération.

**Vérifications finales** (GET, Claude Code, 2026-11-24) :

| Workflow | id | état | versionId (= activeVersionId si actif) |
|---|---|---|---|
| FONDA - Emettre relecture | `5iJOTDkaTZq7z0sh` | actif | `dce56ccb-d3c1-4e32-bc08-a1493855b8f3` |
| FONDA - Cloturer relecture | `QrmJY4gguZEx7YoS` | actif | `12b3789d-a2d6-472a-ab17-da0b68974243` |
| FONDA - Confirmer relecture | `W1HAOtjAX3ILZBpX` | actif | `337812fd-6eea-4c8d-84c1-7f32f352d517` |
| FONDA - Page relecture | `nQjoq0UekNNliaMt` | actif | `70c84ddd-4b3b-4e21-9743-4952336d48f5` |
| BOX - FONDA Generation IA (portier) | `MkYrdhgTo52nA3av` | inactif | `5a51ef8d-01a1-417a-850c-c315ac44bcd9` |
| BOX - FONDA Generation IA | `vrqgtS5kQMvP9Ok5` | inactif | `2881d35a-04b1-4084-bf1e-c6701916e953` |

Résultats :
- 57 workflows sur l'instance, dont 25 actifs ;
- chemins FONDA actifs : chacun une seule fois (`fonda-emettre`, `fonda-cloturer`, `fonda-select`, `fonda-select-confirm`), 0 collision ;
- **9 BOX identiques** à `~/phase5-recette/photo-apres.json` ;
- journal `set_ids` valide ;
- `fonda/data/catalogue-fonda.json` inchangé (SHA-256 `52a7ae599e8d864c0b1f6af1f64b839a70765800f846c33b940e8406dfd4012b`) ;
- `main` inchangé (`d0ac6ca`).

**Nettoyage** (écritures : Éric ; contrôles : Claude Code) :
- **Drive** : les 3 fichiers de test (lot, candidat, décision) sont supprimés : GET **404 ×3**. Les dossiers de production `candidats/`, `relecture/` et `decisions/` sont intacts : les 9 lots antérieurs de `candidats/` n'ont pas été touchés, et `relecture/` et `decisions/` sont vides.
- **Courriel de test** : supprimé par Éric.
- **`set_id`** : `set_fonda_proportionnalite_nI_89` est passé à **`abandonne`**, avec la ref `2026-11-22-199bc7e52938:abandonne`. Le commit `4cefa62` a été fusionné par #110. Tests 198/198, témoin et ancre 22/22, sous Node 22. Les pièces locales de signature restent dans `~/FONDA-clotures/` (hors dépôt).
- **Clé d'écriture** : « FONDA PROD activation » (`fonda-prod-n8n-ecriture`) est révoquée. Un GET avec l'ancienne clé rend **401**, et la clé de lecture rend toujours **200**. L'entrée est supprimée du trousseau ; d'après les noms de service seuls, il reste `fonda-prod-emettre-token`, `fonda-prod-cloturer-token`, `fonda-prod-page-hmac` et `fonda-prod-n8n-lecture`.

**Politique de purge des exécutions** (validée par l'architecte). Les exécutions peuvent contenir `k`, des liens ou des adresses. La purge est **manuelle**, car l'auto-purge est désactivée (`EXECUTIONS_DATA_PRUNE=false`).

| Exécutions | Règle de purge |
|---|---|
| Page | au-delà de **14 jours** |
| Emettre, Confirmer, Cloturer et génération | seulement pour les lots **terminaux** (`publie` ou `abandonne`) |
| Non attribuables à un lot | seulement si **aucun** lot n'est en cours |

Lot de test `nI_89` (abandonné) : **Purge faite (Éric, 2026-11-25) : 281290 (portier), 281291, 281292, 281293, 281294, 281295 ; GET 404 ×6, aucune autre exécution touchée.** 281293 (Page) a été purgée sans attendre les 14 jours, puisque le lot était abandonné (test).

**Phase B terminée.** La relecture par la page est **en production**. Restent :
- la ligne `justine` de la Data Table, qui pointe encore vers l'adresse de contrôle d'Éric. Contrôle visuel par Éric, puis bascule avec l'accord de la relectrice ;
- le durcissement `process.execPath`, reporté parce qu'il exige d'étendre la liste fermée.
