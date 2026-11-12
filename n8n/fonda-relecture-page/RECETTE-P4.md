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
| K10 | comparateur | **secret HMAC d'instance (P4b)** | réponse n8n | SEULE divergence admise : paramètre `secret` du nœud Crypto hmac nommé (« Signer jeton » Page, « Recalculer jeton » Confirmer), 64 hex, ≠ valeur de remplacement ; ramené à la valeur de remplacement dans une copie, jamais affiché ; aucune exception pour Emettre, Cloturer ni ailleurs | « P4b : secret HMAC — SEULE divergence admise » |
| K11 | comparateur | **réglages ajoutés par n8n à la création** (constat phase 2) | réponse n8n | LF `REGLAGES_AJOUTES_PAR_N8N` = `callerPolicy: "workflowsFromSameOwner"`, `availableInMCP: false` : admis SEULEMENT en fin de `settings`, après les clés du dépôt, dans cet ordre, valeurs EXACTES ; retirés d'une copie avant la comparaison stricte ; toute autre valeur (dont `callerPolicy: "any"`), position, ordre, clé supplémentaire, ou présence dans l'export = écart. **Limite** : la garantie porte sur l'objet après parsing ; l'API n8n ne renvoie que des objets sérialisés, sans doublon ; pas de détection avant parsing, pour ne pas élargir la surface du transport lecture seule | « K11 : réglages ajoutés par n8n », « K11 EXHAUSTIF » (127 placements, seuls les 4 légitimes), instantané littéral (« sonde et comparateur : listes fermées ») |
| X1 | tous | **modules chargés (directement ou transitivement)** | dépôt et Node | **tracés** par `Module._load` à l'exécution de chaque commande et comparés à une **liste fermée explicite** (constructeur, 2 profils ; sonde, liste et détail ; comparateur, comparaison complète jusqu'au code 0 avec un faux live conforme) ; tout module nouveau fait échouer ; aucun module hors dépôt hors Node | « X1 (constructeur) … TRACÉS », « X1 : modules chargés par la sonde », « … par le comparateur » |
| F1 | tous | **paramètres et exports des fonctions exportées** (appelant JavaScript) | appelant | exports et signature de chaque fonction en **liste fermée** ; chaque paramètre fermé : `url` -> T1 ; `cle` -> T5/T6 ; `env` -> T6 ; `fetch` -> toujours enveloppé par le transport (T2–T10) ; `argv` -> C1/C2, S1, K1 ; `option`/`profil`/`brutRecette` -> C1–C8 ; `live` -> K5/K6 ; `reference` -> K3 (élément de `REFERENCES`, aucun texte ni objet de l'appelant) ; liste de confiance : **aucun** paramètre (S3) | « F1 (constructeur) », « F1 : exports et paramètres … », « F1 : la liste de confiance n'est remplaçable par AUCUN paramètre », « F1 : comparer() n'accepte qu'un ÉLÉMENT de REFERENCES » |

### Outil d'import (ÉCRITURE explicite, P4b) — hors oracle, hors témoin
`outils-import/importer-recette.js` (CODEOWNERS) : seul outil qui écrit sur l'instance ; l'oracle (`outils-recette/`) reste en lecture seule.

| Frontière | Contrôle (ensemble fermé) | Test (`outils-import/importer-recette.test.js`) |
|---|---|---|
| confirmation | `--confirmer-ecriture` exigé, arguments exacts | « principal : confirmation explicite », « ligne de commande » |
| export | 4 exports de recette (REFERENCES), noms de recette exacts ; jamais la production | « liste fermée » |
| secret | trousseau macOS, `/usr/bin/security` sans shell, argv exact ; lu UNE fois (import conjoint Page+Confirmer) ; 64 hex minuscules ; relu == envoyé (en mémoire) ; jamais affiché | « appel du trousseau », « secret : forme stricte », « secret RELU ≠ envoyé », « CLI » |
| substitution | fragment EXACT unique (Page, Confirmer), 0 (Emettre, Cloturer) ; garde du code intacte ; corps POSTÉ = texte substitué | « substitution du SEUL fragment exact », « import nominal » |
| requêtes | GET liste par nom paginé jusqu'au bout (éléments, curseurs validés ; incomplet ou malformé = refus), POST, GET du créé ; instance fermée ; `redirect: error` | « import CONJOINT nominal », « précontrôle de doublon », « précontrôle fail-closed » |
| sortie et reprise | `import-recette/v1` (comparer-live) ; POST ou relecture actifs -> erreur ; après création : étape + ids créés (grammaire stricte) | « après création », « CLI » |
| chargement, surface, modules | erreur au chargement = message fixe ; exports et signatures (F1) et modules tracés (X1) en listes fermées | « erreur au CHARGEMENT », « F1 », « X1 » |

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
