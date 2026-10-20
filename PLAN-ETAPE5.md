# Plan — Étape 5 (brique 1) : du workflow inactif à la première attestation signée

**Version 4 (option a pour I4)**, 2026-10-20, Claude Code. Elle intègre :
- la contre-passe Codex de la v3 (B1–B2, I1–I5, M1), avec laquelle la relecture Claude est en accord ;
- les relectures de la v1 : Claude (F1–F6) et Codex (C1–C16) ;
- la contre-passe Codex de la v2 (V1–V12), avec laquelle la relecture Claude est en accord ;
- les décisions D1–D6 actées par Éric.

**Aucun code ni aucune activation avant le « go » de Claude sur cette v3.** La garde maîtresse reste en place jusqu'au lot 7.

Légende : **R** = réversible, **NR** = non-retour, **CC** = Claude Code, **É** = Éric. Relecture de chaque PR : Codex en lecture seule, puis Claude.

## 0. État de départ (lecture seule, 2026-10-20)
- `design` = `a98d31a`. Étape 4 (PR #23) et dette A (PR #24, CDC r7) mergées. Workflow `vrqgtS5kQMvP9Ok5` inactif, webhook en Header Auth (`GfnXr5hYrYgC5RwA`).
- Topologie des clés Anthropic de l'instance : relevée en lecture seule (inventaire F3), consignée dans une **note locale hors dépôt** (dépôt public). La credential « Anthropic FONDA » (`YnhTnSOc1u7S99Q7`) est **dédiée** à FONDA.
- Journal : `nombres-fractions-relatifs_nI_01` et `_nF_01` à l'état `reserve`, avec calibrations locales. Prochain numéro libre : `_02`.
- API n8n : le filtre `status=` refuse `new` et `crashed`.
- `modeles-autorises.json` vide : la précondition G5 bloque toute signature.
- Signataire, vérifié dans le code :
  - `rattachement` n'est consommé que par `evaluerPage` ;
  - `signer(octets)` est **synchrone** et appelé **après** le marqueur (`signer-cloture.js:775`) ;
  - `cloturer` renvoie `lotPublie` en mémoire ;
  - `saisirDecisionLocale` lit `deps.moteur.version` et `deps.moteur.sha256` (`:287–313`) ;
  - `publier-lot.js` exige `<lot-relu.json> <attestation.json>` et exporte `preparerPublication` (vérification complète d'un lot et de son attestation, `publier-lot.js:100–160`) ;
  - « Tout écarter » (action `rejeter`) conduit à l'abandon, **sans attestation** (`signer-cloture.js:570` ; CDC §11 invariant `coeur.action = "accepter"` ; matrice §20.13, issue 2).

---

## Lot 1 — Clés Anthropic (É ; CC prépare les JSON de production) — FONDA R, révocation NR
1. **Inventaire (F3)** : CC liste, en lecture seule, **tous** les workflows de l'instance et leurs usages d'Anthropic, sans afficher de clé. **Le résultat reste dans une note locale hors dépôt**. Éric complète hors n8n : scripts, autres machines, `.env`. On ne passe à la suite que si la liste est close.
2. Console Anthropic (**D2**) : un **workspace FONDA séparé**, avec un **plafond de dépense**. Une clé « FONDA » dans ce workspace, une clé « BOX prod » dans le workspace existant.
3. **FONDA (R)** : coller la clé dans « Anthropic FONDA ».
4. **Production (D3, go explicite d'Éric pour l'import)** : CC prépare les JSON de Flashcards **et** Tally. Ils passent sur une credential `anthropicApi` « Anthropic BOX prod ». Codex puis Claude les relisent **avant** l'import, qui se fait en **heures creuses**.
5. **Test de chaque voie (C15)** : une génération Flashcards réelle et une génération Tally réelle, chacune identifiée par un id d'exécution `success`.
6. **Révocation** de l'ancienne clé (**NR**), seulement après le point 5.

## Lot 2 — Recette §20.10 (É ; CC corrige la recette) — R
- PR de documentation (C10) : **recréer** le conteneur (`docker compose up -d`, ou « Redeploy » chez Hostinger), puisque `restart` ne recharge pas l'environnement. Contrôle par `printenv | grep EXECUTIONS_DATA`, en heures creuses, puis vérification des webhooks BOX.
- Éric remplit le bloc de consignation : (a) réglages du workflow, (b) `EXECUTIONS_DATA_PRUNE=false` observé. Le bloc est committé avec le lot 7 et constitue un **prérequis bloquant** du lot 8.

## Lot 3 — Dette B : portier non audité (CC, PR dédiée) — R
- **Workflow « BOX - FONDA Generation IA (portier) »**, créé inactif :
  1. Webhook `POST /box-fonda-generation-ia-portier`, Header Auth avec la credential **distincte** « FONDA Portier Token » (créée par Éric, F5), `responseMode: responseNode`.
  2. Code « Valider corps » : **ne lève jamais d'exception**. Il renvoie `{ valide, erreur?, set_id?, ref? }` par `validerDeclencheur(corps)`, une fonction pure unique injectée par `construire-workflow.js` dans le portier **et** dans « FONDA Entree generation » (égalité prouvée par le harnais).
  3. IF `valide` faux → Respond **400** : `respondWith: json`, **`options.responseCode: 400`** explicite, corps `{ erreur }`.
  4. IF `valide` vrai → HTTP POST vers `/webhook/box-fonda-generation-ia` :
     - **corps construit explicitement** (B2) : `jsonBody = ={{ JSON.stringify({ set_id: $('Valider corps').first().json.set_id, ref: $('Valider corps').first().json.ref }) }}`. Ce sont ces deux champs exactement, jamais `$json`. Le proxy n8n n'expose pas les champs métier directement : `$('X').set_id` vaudrait `undefined`, d'où un corps `{}` ;
     - garde-fou : le harnais évalue cette expression et vérifie un corps **strictement égal** à `{ set_id, ref }` en chaînes non vides. Le nœud « Valider corps » n'émet `valide: true` qu'avec ces deux chaînes non vides ;
     - credential `GfnXr5hYrYgC5RwA` par id, `retryOnFail: false`, timeout 30 s ;
     - `options.response.response.fullResponse: true` (expose `statusCode`) et **`neverError: true`** (tout statut HTTP sort par la sortie principale), confirmés dans `HttpRequestV3` 2.6.3 ;
     - **sortie d'erreur** activée (`onError: continueErrorOutput`) pour les pannes de transport (délai dépassé, connexion refusée), **connectée** au Respond 504.
  5. IF `statusCode` **= 200** → Respond **202** : `options.responseCode: 202` explicite, corps `{ set_id, ref }` lu par `$('Valider corps').first().json`.
  6. Tout le reste → Respond **504** (`options.responseCode: 504` explicite) `{ etat: 'inconnu', consigne: 'observer, ne jamais renvoyer' }` : statut ≠ 200 (401, 500, 2xx inattendu…), sortie d'erreur (délai dépassé, connexion refusée). Sans `responseCode`, Respond renverrait 200 par défaut : le harnais vérifie la présence explicite du code sur **chaque** Respond.
- **F6** : 202 signifie « génération **acceptée** » (le webhook interne répond dès réception), pas « terminée ».
- **Jetons (F5)** : le jeton du webhook de génération n'existe que dans `GfnXr5hYrYgC5RwA` ; celui de l'appelant n'existe que dans « FONDA Portier Token » et `~/.fonda-cles/`. Le harnais vérifie qu'aucun jeton n'apparaît en clair dans les deux exports.
- « FONDA Entree generation » appelle `validerDeclencheur`. Un corps valide émet **toujours** `{ set_id, ref }`.
- **Tests** (harnais multi-workflow, jusqu'au signataire) :
  1. corps malformé → 400, aucune exécution du workflow épinglé, aucun incident ;
  2. corps transmis **exactement** `{ set_id, ref }` ;
  3. valide sans réservation → exécution en erreur attribuable sans dépôt, jamais d'incident. Tolérée dans un scénario complet ; isolée, elle vaut abandon faute de réussite, comme voulu ;
  4. délai dépassé → 504 ;
  5. connexion refusée → 504 ;
  6. 401 interne → 504 ;
  7. 500 interne → 504 ;
  8. 2xx autre que 200 → 504 ;
  9. aucun POST après un 400 ;
  10. égalité du code de validation ;
  11. `onError` n'apparaît **que** sur le nœud HTTP du portier. Le harnais de la génération continue d'interdire tout `onError`.
- Live : portier créé inactif, génération mise à jour (inactive), **les deux** exports exacts committés, `workflowId` du portier consigné.

## Lot 4 — Dette C (D5 : RÉDUITE, PAS CLOSE — acceptée ; garant = abandon du signataire sur doublon) — CC, PR dédiée — R
Aucune primitive atomique : ni création conditionnelle Drive, ni verrou n8n par workflow ; la limite de concurrence n8n est globale. Un « Retry » manuel dans n8n contourne tout verrou côté Mac.

1. **Appelant unique** `fonda/scripts/declencher-generation.js <set_id> <ref>` (Mac d'Éric, seul détenteur du jeton du portier).
   - **(a) Contrôles en lecture, AVANT le verrou** :
     - réservation `(set_id, ref)` à l'état `reserve` sur `origin/design` (fetch explicite au préalable) ;
     - aucun fichier local ne porte ce set_id : `setIdsExistants(null)` (calibrations, lots, catalogue), **pas** le journal, qui contient la réservation elle-même (C12) ;
     - aucune exécution du workflow épinglé ne porte ce set_id (liste n8n complète, item d'entrée lu) ;
     - **aucun candidat pour CE set_id** dans `candidats/`, par nom **ou** par `properties.fonda_set_id` (V7).
   - **(b) Verrou O_EXCL** `~/FONDA-clotures/verrous/<set_id>.generation`. Il est **créé une seule fois et jamais supprimé ni recréé** par le script. Son contenu est un **journal en ajout seul**, une ligne JSON par événement (`{ evt, le, tentative }`), écrite avec `fsync`. La première ligne est `{evt:'envoi'}`.
   - **(c) Un seul POST.**
   - **(d) Réponse :**
     - 202 → ligne `accepte` ;
     - 400 → ligne `refuse` (aucune exécution auditée créée) ;
     - 504, 5xx, délai dépassé ou erreur réseau → ligne `inconnu`.
   - **Seul un 400 explicite du validateur autorise `refuse`** (V3). Toute autre réponse inattendue vaut `inconnu`.
2. **Automate du verrou (V4, I3)**. Fichier `verrous/<set_id>.generation` : créé une seule fois en O_EXCL, jamais supprimé ni recréé. C'est un **journal en ajout seul**, une ligne JSON terminée par `\n` par événement, avec `fsync` après chaque ajout.
   - **Exclusion commune** : **toute** commande qui lit pour décider ou qui ajoute un événement (`declencher`, `--etat`, `--liberer`, `--reparer`) acquiert d'abord le verrou éphémère `verrous/<set_id>.generation.en-cours` (O_EXCL, contenu `{ pid, commande, le }`). Elle **relit** ensuite l'état **après** l'acquisition, jamais avant : une observation antérieure est jetée. Elle libère le verrou en fin de commande, dans un `finally`.
   - **`.en-cours` déjà présent** : refus « opération en cours ou interrompue ». S'il est orphelin, son `pid` n'existe plus sur la machine : seul `--reparer <set_id>` peut le retirer, en consignant une ligne `{evt:'reparation', motif:'en-cours orphelin'}`.
   - **État courant** = dernier événement **complet**. Transitions autorisées :

     | De | Événement | Vers | Qui |
     |---|---|---|---|
     | (création) | `envoi` | ENVOI | `declencher` |
     | ENVOI | `accepte` / `refuse` / `inconnu` | ACCEPTE / REFUSE / INCONNU | `declencher` (réponse) |
     | REFUSE | `envoi` | ENVOI | `declencher` (nouvelle tentative) |
     | ENVOI (sans résultat) ou INCONNU | `accepte` | ACCEPTE | `--etat`, si une exécution ou un candidat est observé |
     | ENVOI (sans résultat) ou INCONNU | `libere` | LIBERE | `--liberer --motif`, si `--etat` n'observe ni exécution ni candidat après le délai de prudence |
     | LIBERE | `envoi` | ENVOI | `declencher` |
     | **ACCEPTE** | — | **terminal** | aucune transition ; tout déclenchement est refusé |

   - **Ligne tronquée** : le fichier ne finit pas par `\n`, ou la dernière ligne est illisible. **Toute** commande refuse, sauf `--reparer`. Celle-ci, sous l'exclusion commune, **complète** la ligne par `\n` puis ajoute `{evt:'reparation', ligne_tronquee:'<base64 du fragment>'}`. L'état redevient le dernier événement complet **antérieur**. Si c'était `envoi`, on se retrouve dans le cas « ENVOI sans résultat », donc `--etat` obligatoire. Aucune donnée n'est jamais effacée.
   - **Tests** (unitaires et essai intégré) :
     - deux processus concurrents sur REFUSE : un seul envoie, l'autre relit ACCEPTE ou ENVOI et refuse ;
     - chaque transition interdite est refusée, en particulier ACCEPTE → tout ;
     - ENVOI sans résultat ;
     - INCONNU → `accepte` ; INCONNU → `libere` → `envoi` ;
     - `.en-cours` orphelin et `--reparer` ;
     - ligne tronquée, puis `--reparer`, puis état antérieur ;
     - fichier sans `\n` final.
3. **Restrictions d'exploitation** (README et recette) :
   - jamais de « Retry » ni d'« Execute » manuel sur le portier ou la génération ;
   - `retryOnFail` faux partout (harnais) ;
   - workflows actifs **uniquement** pendant une fenêtre de génération.
4. **Détection côté workflow** : nœud « Verifier unicite » **entre** « Deposer candidat » et « FONDA Sortie generation » (F2, V9).
   - Il reliste `candidats/` pour ce set_id, par nom **ou** propriété, avec pagination complète et `incompleteSearch` agrégé.
   - Cas :
     - exactement 1 fichier, dont l'id est celui du dépôt → succès ;
     - 0 fichier (incohérence) → erreur ;
     - plus d'un fichier → erreur « doublon détecté » ;
     - recherche incomplète → erreur.
   - **Sortie** : il **réémet à l'identique la réponse de « Deposer candidat »** (`{ id, name, parents, properties }`), et « FONDA Sortie generation » lit désormais **`$('Deposer candidat')`** par son nom. Double garantie : le harnais teste cette liaison.
   - **Re-preuve du harnais de l'étape 4** : ensemble des nœuds, chaîne linéaire, `generation-fonda/v1`, empreintes et `rapprocher` inchangés ; ré-export.
5. **Statut** : la dette est **réduite, pas close** (D5 acquise). Une erreur après dépôt ou un doublon conduit à l'abandon par le signataire, jamais à une signature erronée.

## Lot 4 bis — `--reserver --palier` (CC, petite PR, D4) — R
- `generer-lot-fonda.js --reserver <notion_id> [--palier nI|nF]` : sans `--palier`, comportement inchangé ; avec, seul ce palier est réservé (refus s'il n'est pas prévu par le référentiel).
- **Le parseur consomme la valeur de `--palier`** : aujourd'hui, tout argument sans `--` est traité comme une notion, `:594` (V11).
- **Tests CLI** :
  - valeur absente ;
  - valeur inconnue ;
  - option en double ;
  - `--palier` hors `--reserver` ;
  - aucun palier supplémentaire réservé ;
  - aucune écriture après un refus ;
  - journal validé.

## Lot 5 — Adaptateurs de production et CLI du signataire (CC, PR dédiée) — R, garde en place
Fichier `fonda/scripts/adaptateurs-production.js`. Ses **racines sont injectables** : dépôt, dossier de clôture, `~/.fonda-cles`, URL n8n, dossier Drive. Il expose **des fabriques par usage (I5)**, chacune ne construisant que ce que sa commande consomme et testée par ses types de retour :
- `sourcesLecture(options)` : `api`, `drive`, `journal`, `referentiel`, `registre`, `incidents`, `dossier`. Elle sert à `--diagnostic`, `--etat`, l'appelant et toutes les autres. **Ni moteur, ni clé de signature.**
- `dependancesSaisie(setId, options)` = sources + `moteur` (résolu depuis la génération de **ce** set_id) + `fs`, `saisir`, `afficher`, `horloge`, `aleatoire`.
- `dependancesCloture(setId, options)` = saisie + `signer` (de `preparerSignataire`) + `cles` + `config` complet + `referentielArchive` + `tableRelecteurs`, `levees`.
- `verificationPieces(options)` : pour `--extraire-publication` (voir plus bas).

**Contrats** :
- **`api.listerExecutions({ workflowId, status })`** (F1) : liste n8n **non filtrée** en `status`, filtrée en `workflowId` ; pagination complète (`nextCursor`) ; filtrage `status` côté client. Erreurs avec `.statut`.
- **`api.lireExecution(id)`** : `?includeData=true`, `null` sur 404.
- **Drive** (D1 : compte de service `drive.readonly`, partagé uniquement sur `FONDA-Lots` ; V7) :
  - accès vérifié par `files.get(<candidats>)` (dossier, non supprimé), sinon erreur (403 → `.statut` 403) ;
  - `listerCandidats()` :
    - `q = "'<candidats>' in parents and trashed = false"` ;
    - `fields = nextPageToken, incompleteSearch, files(id, name, modifiedTime, properties)` ;
    - pagination complète, **`incompleteSearch` = OU logique de toutes les pages** ;
    - renvoie `{ incompleteSearch, fichiers: [{ id, nom, modifie_le, properties, proprietesLisibles }] }` ;
  - `lireLotGenere(setId)` : même dossier, `trashed = false`, `name = '<set_id>.lot.json'`, paginée. Recherche incomplète → erreur ; 0 fichier → `null` ; plus d'un → erreur ; sinon `alt=media` et retour `{ id, nom, modifie_le, octets }`.
- **`journal(commit)` → `{ surPremierParent, journal }`** :
  - `surPremierParent` = `commit ∈ git rev-list --first-parent origin/design` ;
  - `journal` = `JSON.parse(git show <commit>:fonda/data/set_ids-journal.json)` ;
  - **aucun `git fetch`** ici : il relève de `--actualiser`.
- **`referentielArchive`** (consommé par `cloturer`) = `referentielArchiveGit({ refs: ['origin/design'] })`, qui renvoie des **octets**.
- **`registre`** = `moteurs.json`.
- **`moteur`** (saisie et clôture seulement) = descripteur **`{ version, sha256 }`**, égal au `moteur` de la sortie de génération de ce set_id **et** présent dans `registre` avec le même `sha256`.
- **`cles = { obtenir(cleId) }`**, construit sur `cles.json` et les PEM publics.
- **`config`** (clôture) :

  ```
  { source: 'saisie_locale',
    workflowGeneration: 'vrqgtS5kQMvP9Ok5',              // vérifié contre l'export
    dossier: path.join(os.homedir(), 'FONDA-clotures'),
    cleId: 'eric-2026',
    modelesAutorises: lireModelesAutorises(fs.readFileSync(<repo>/fonda/data/modeles-autorises.json, 'utf8')) }
  ```

  **B1** : `modelesAutorises` est **dans `config`**, puisque `cloturer` lit `deps.config.modelesAutorises` (`signer-cloture.js:352`), et `lireModelesAutorises` reçoit le **texte**. Test : une fabrique qui le placerait ailleurs est refusée en précondition.
- **Registre des incidents (I4, option a)** : `<dossier>/incidents.json` et sentinelle `<dossier>/.initialise`.
  - **Lecture stricte** : tableau JSON, éléments objets au format §10 B, `id` chaîne non vide **unique**. Toute autre forme est une erreur, jamais `[]`. Sentinelle absente ou registre absent après sentinelle → erreur.
  - **Témoin dérivé** : à **chaque** lecture, `incidents()` calcule l'ensemble **T** des `id` cités dans `charge.incidents_connus` de **toutes** les attestations signées connues :
    - toutes les `attestation.json` des dossiers de lot locaux (`<dossier>/*-*/attestation.json`) ;
    - toutes les attestations du **catalogue publié** (`fonda/data/catalogue-fonda.json` à `origin/design`).

    Si un `id` de T est absent du registre, ou s'il y figure avec un contenu (`nature`, `periode`, `resolu_le`) différent de celui cité, c'est une **erreur**, « registre des incidents incomplet ou modifié : restauration requise ». Le signataire refuse alors : incident de chaîne.
  - **`--initialiser`** :

    | Sentinelle | Registre | Traces d'usage¹ | Action |
    |---|---|---|---|
    | absente | absent | **aucune** | crée le registre `[]` (`wx` + `fsync`), puis la sentinelle (`wx`) |
    | absente | absent | **présentes** | **refus** : usage antérieur, restauration requise (jamais d'initialisation automatique) |
    | absente | présent | — | refus : initialisation interrompue, traitement manuel |
    | présente | absent | — | refus : registre perdu |
    | présente | présent | — | « déjà initialisé », aucune écriture |

    ¹ Traces d'usage : un fichier sous `<dossier>/verrous/`, un `<dossier>/*.signature`, un dossier `<dossier>/<set_id>/` ou `<dossier>/<set_id>-<code>/`, ou toute attestation du catalogue publié citant un incident.
  - **Limite documentée** : un incident ouvert puis effacé du registre, **jamais cité** par une attestation signée, reste indétectable. C'est la limite assumée de l'option (a).
  - **Durcissement FUTUR (option b, non bloquant)** : registre versionné en ajout seul dans le dépôt (`fonda/data/incidents.json`), contrôlé par la CI `immuabilite`. PR séparée touchant le cœur probant (signataire et CDC §10 B), avec relecture Codex puis Claude.
- **`signer`** (C2) : `preparerSignataire({ racineCles })`, appelé **AVANT** `cloturer`.
  1. phrase de passe saisie par Éric ;
  2. `crypto.createPrivateKey({ key, passphrase })` sur `~/.fonda-cles/eric-2026.priv.pem` (jamais lu par les agents) ;
  3. vérification de la paire (nonce signé RSA-SHA256 PKCS#1 v1.5, vérifié par `fonda/data/cles/eric-2026.pem`) ;
  4. renvoi d'un `signer(octets) → Buffer` **synchrone**.

  Toute erreur ou annulation survient avant `cloturer`, sans rien consommer.
- **CLI** (`main()`, parsing explicite ; chaque commande n'appelle que **sa** fabrique) :
  - `--actualiser` : `git fetch origin design`, seule écriture dans `.git` ;
  - `--initialiser` ;
  - `--diagnostic [<set_id>]` ;
  - `--saisir <set_id>` ;
  - `<set_id>` : clôture, refusée par la garde jusqu'au lot 7 ;
  - `--extraire-publication <set_id>`.
- **`--diagnostic` (F4, V6, I5)** : `sourcesLecture` seulement.
  - Il n'importe ni `preparerSignataire`, ni `signer`, ni `cloturer`, et ne lit pas la clé de **signature**. Aucune écriture (espions sur `fs` et `child_process`).
  - Il **réutilise les fonctions pures du signataire** (`observer`, `examinerExecutions`, `examinerFichiers`, `classerExecutions`, `rapprocher`) sur ses lectures, sans les recoder.
  - **États, dans l'ordre de priorité** (le premier applicable est rapporté, les autres sont listés) :
    1. `acces_ko:<source>` (n8n, Drive, git, registre ou témoin d'incidents) ;
    2. `non_initialise` ;
    3. `incident_ouvert:<id>` (registre) ;
    4. `observation_contradictoire` (`fusionner` ou `observer` en contradiction) ;
    5. `generation_en_cours` (`new`, `running` ou `waiting` pour ce set_id ; `new` vient de la liste non filtrée) : observation, **pas** un incident durable ;
    6. `doublon` (plus d'une exécution réussie ou plus d'un candidat) : abandon prévisible ;
    7. `generation_echouee` (seulement des exécutions en erreur) ;
    8. `aucune_generation` (aucune exécution, aucun candidat : cas de `_nI_01`, **pas** un incident) ;
    9. `candidat_non_conforme` (`rapprocher` constate un abandon) ;
    10. `pret_pour_saisie` (exactement une exécution `success`, exactement un candidat, `rapprocher` sans constat, modèle ∈ liste) ;
    11. `decision_figee` (décision locale présente et conforme) ;
    12. `pret_pour_cloture` (`decision_figee`, **aucun** marqueur `.signature`, **aucun** incident ouvert, témoin d'incidents conforme, lot généré lisible et stable entre deux lectures, référentiel archivé résolu) ;
    13. `signe` (`.signature` présent ; avec ou sans `attestation.json` : sans, traitement manuel).

    Sans `<set_id>` : les seuls accès, et le registre.
- **`--extraire-publication <set_id>`** (V2, I1, I2), via `verificationPieces` :
  1. lit `<dossier>/<set_id>-<code>/attestation.json` et `instantane.json` (code donné par `charge.code_confirmation`) ;
  2. **`SHA-256(octets de instantane.json) === charge.sha256_instantane`** ;
  3. identités : `instantane.set_id = charge.set_id` ; `instantane.coeur` canoniquement égal (`coeur-decision-fonda/v1`) à `charge.coeur` ; `instantane.moteur = charge.moteur` ;
  4. `lot = lotPublie(instantane.candidat_lot, instantane.coeur)` ;
  5. **entrée construite par une fonction PARTAGÉE, extraite et exportée de `publier-lot.js`** (`entreeDepuisLot(lot, attestation, { fichier, sha256Hex })`, factorisation des lignes 131–143 actuelles, sans changement de comportement ; `preparerPublication` l'utilise aussi) ;
  6. **référentiel par l'adaptateur `resoudreReferentiel({ version: charge.referentiel_version, refs: ['origin/design'] })`**, qui renvoie `{ ok, referentiel }` ;
  7. **`verifierAttestationSignee(attestation, { entree, registre, referentiel, cles, modelesAutorises })`**, le vérificateur complet ;
  8. garde-fous du moteur de la charge : `chargerMoteurNode(charge.moteur.version, charge.moteur.sha256, registre)`, puis `valider`, `verifierReponseOr` et `verifierFormesAcceptees` sur chaque carte ;
  9. `lot-relu.json` : absent → `wx` + `fsync` ; présent aux octets exacts → succès sans écriture ; différent → refus.

  **Aucun état de publication n'est consulté** (catalogue, journal, existence de `lots/<set_id>.json`) : l'extraction reste relançable **après** publication.
- **Essai intégré** (C6, V8). **Copie exécutable** du dépôt dans un répertoire temporaire, pour que `publier-lot.js` et `moteurs.js` résolvent leurs racines **dans la copie**, avec :
  - une vraie histoire git (commit initial, puis réservation sur `design`, `origin/design` = dépôt nu local) ;
  - un `journal_commit` = commit de réservation ;
  - une clé éphémère déclarée dans la copie de `cles.json` ;
  - un `modeles-autorises.json` de test ;
  - des transports n8n et Drive simulés, à partir de la fixture de l'étape 4.

  **Parcours nominal** :
  1. `--initialiser` ;
  2. `--diagnostic` (`aucune_generation`, puis `pret_pour_saisie`) ;
  3. `--saisir`, puis `--diagnostic` (`pret_pour_cloture`) ;
  4. clôture, avec un rattachement **de test** ;
  5. `--extraire-publication` ;
  6. `publier-lot.js --dry-run`, puis publication dans la copie (commit) ;
  7. **`--extraire-publication` de nouveau APRÈS publication** : succès sans écriture (I2).

  **Essais négatifs** :
  - phrase de passe fausse ; paire de clés fausse ; annulation avant le marqueur ;
  - instantané altéré ; attestation altérée ; `lot-relu.json` différent ;
  - registre réécrit à `[]` après une clôture citant un incident, donc **témoin en échec** ;
  - les 5 lignes de `--initialiser`, dont l'initialisation refusée en présence de traces ;
  - tous les tests de l'automate du verrou (lot 4.2) ;
  - `page_relecture` refusée avant réseau et clé ;
  - `--diagnostic` sans écriture ;
  - **`config` sans `modelesAutorises`, donc refus en précondition (B1)**.

## Lot 6 — Recette §20.8 : modèle (É exécute, CC prépare) — R
Dépend du lot 1.
- Sonde **sur copie** « BOX - FONDA Sonde modele » : créée inactive, déclencheur manuel, credential FONDA, aucune donnée G3.
  1. `GET /v1/models` ;
  2. `POST /v1/messages` avec le `model` épinglé, `max_tokens` 16, message « Réponds uniquement : OK. ».
- **Branches (C11)** :
  - (a) 200 avec le `model` épinglé, satisfaisant `MODELE_DATE` → PR qui remplit `modeles-autorises.json` (preuve : id d'exécution, date) et retire « à confirmer » ;
  - (b) 200 avec un autre `model` → décision de Claude et Éric sur un identifiant daté admissible, nouvelle sonde avec cet identifiant exact, puis reconstruction (PR, live, ré-export) ;
  - (c) 4xx `not_found` → même chemin que (b), à partir de la liste.
- La sonde est ensuite archivée, avec l'accord d'Éric.

## Lot 7 — Levée de la garde (CC, PR dédiée, DERNIÈRE) — R par revert tant que rien n'est signé
- `main()` passe `rattachement = () => { throw new Refus('parcours page_relecture non défini', 'precondition'); }` **uniquement** pour `source: 'saisie_locale'`. `page_relecture` reste refusée **dans `main()`**, avant réseau et clé.
- Le commentaire « GARDE MAÎTRESSE » est réécrit.
- **Conditions de merge** :
  - lots 2 à 6 mergés ;
  - recette §20.10 consignée et committée ;
  - essai intégré vert ;
  - **`--actualiser` puis `--diagnostic` réels, après `--initialiser` réel** : résultats attendus `acces_ok` et `aucune_generation` pour `_nI_01` (V6). L'initialisation est déplacée **ici**, avant le lot 8.

## Lot 8 — Premier cycle réel (runbook ; É exécute, CC observe en lecture)
**États durables et issues autorisées** (C8, V4) :

| Étape | Effet durable | Issues autorisées |
|---|---|---|
| Verrou `.generation` créé | le set_id ne se déclenche plus que selon l'automate du lot 4.2 | `refuse` → nouvelle tentative ; indéterminé → `--etat`, puis `accepte` ou `--liberer` consigné |
| **⚑ B1 : candidat déposé sur Drive** (dès le dépôt, **avant** le `success`) | set_id non régénérable | signature, ou `abandonne` au journal (PR) |
| Erreur APRÈS dépôt (doublon, « Verifier unicite », réponse Drive) | abandon obligé | `abandonne` + nouveau set_id |
| Décision figée (`--saisir`, « oui ») | non corrigeable | clôture, ou `abandonne` |
| « Tout écarter » (action `rejeter`) | **aucune attestation** : abandon constaté (`signer-cloture.js:570` ; CDC §11 `coeur.action = "accepter"`) | issue 2 de la matrice §20.13 (CDC r7, l.365) : `abandonne` (PR) + nouveau set_id |
| Instantané, export et récapitulatif écrits (avant confirmation) | reprise sur l'instantané existant, jamais reconstruit | reprise ; panne entre les 3 écritures → traitement manuel (vérifier les 3 fichiers) ou abandon |
| **⚑ B2 : marqueur `.signature`** (juste avant `signer()`) | jamais de seconde signature | attestation écrite et revérifiée → extraire et publier ; marqueur sans attestation → traitement manuel, puis `abandonne` |
| Publication interrompue | `.git/fonda-publication.lock` peut subsister après un arrêt brutal | `--reprendre` (même HEAD) ; verrou résiduel : vérifier qu'aucun processus ne tourne, puis retrait manuel (`publier-lot.js:263–274`) |

1. `git checkout design && git pull`. Puis `node fonda/scripts/generer-lot-fonda.js --reserver maths.nombres-fractions-relatifs --palier nI` (D4), qui réserve seulement `_nI_02`. PR, merge, `git pull`. Noter la `ref`.
2. `signer-cloture.js --actualiser` ; `--diagnostic set_fonda_nombres-fractions-relatifs_nI_02` → `aucune_generation`.
3. Activer le portier et la génération (R).
4. `declencher-generation.js …_nI_02 <ref>` → 202. Puis `--diagnostic` jusqu'à `pret_pour_saisie`. **⚑ B1 dès le dépôt.**
5. Désactiver les deux workflows (R).
6. `signer-cloture.js --saisir …_nI_02`, puis « oui ».
7. `signer-cloture.js …_nI_02` : phrase de passe et paire vérifiées **avant**, évaluation, instantané, confirmation automatique, code. **⚑ B2.** Revérification automatique.
8. `signer-cloture.js --extraire-publication …_nI_02` → `lot-relu.json`.
9. **Publication** :
   1. `git checkout design && git pull`, HEAD propre ;
   2. `publier-lot.js <dossierLot>/lot-relu.json <dossierLot>/attestation.json --dry-run`, puis la même commande sans `--dry-run` ;
   3. ne jamais committer un état partiel ; en cas de panne, `--reprendre` ;
   4. branche, commit, PR ; CI `tests` **et** `immuabilite` vertes ; merge par Éric.
10. **Archivage (D6 a, V10)** : copie **manuelle** consignée vers `FONDA-Lots/archive/<set_id>/`.
    - **Source 1**, `<dossier>/<set_id>/` : `decision.json`.
    - **Source 2**, `<dossier>/<set_id>-<code>/` : `instantane.json`, **`export.json`**, **`recapitulatif-<set_id>-<code>.txt`** (nom exact, `signer-cloture.js:694`), `attestation.json`, `lot-relu.json`.
    - **Trace du marqueur** : copie de `<dossier>/<set_id>.signature`, et du verrou `verrous/<set_id>.generation` (journal des tentatives).
    - **Vérification** : SHA-256 de chaque fichier source = SHA-256 de la copie téléchargée, consigné dans `archive/<set_id>/MANIFESTE.txt` (fichier, octets, sha256, copié le, par).

## Décisions ACTÉES (Éric, 2026-10-20)
- **D1** — Drive du signataire : compte de service en lecture seule (`drive.readonly`), partagé uniquement sur `FONDA-Lots`, clé dans `~/.fonda-cles/`.
- **D2** — Workspace Anthropic FONDA séparé, avec plafond de dépense (lot 1.2).
- **D3** — Production BOX : credential `anthropicApi` « Anthropic BOX prod » (lot 1.4).
- **D4** — `--palier` (lot 4 bis) : réserver seulement `_nI_02`.
- **D5** — Dette C **réduite, pas close**, acceptée ; garant = abandon du signataire sur doublon (lot 4).
- **D6** — (a) Copie manuelle consignée vers `FONDA-Lots/archive/<set_id>/` pour le premier cycle (lot 8.10). L'adaptateur Drive reste en lecture seule.

## Traçabilité
- **v1, Claude** :
  - F1 → lot 5, `listerExecutions` ;
  - F2 → lot 4.4 ;
  - F3 → lot 1.1, 1.4–1.6 ;
  - F4 → lot 5, `--diagnostic` ;
  - F5 → lot 3, jetons ;
  - F6 → lot 3.4–3.6.
- **v1, Codex** :
  - C1 → lot 5, fabrique et contrats ;
  - C2 → lot 5, `signer` ;
  - C3 → lot 5, CLI et `--extraire-publication` ;
  - C4 → lot 4 (D5) ;
  - C5 → lot 3 ;
  - C6 → lot 5, essai intégré ;
  - C7 → lot 5, Drive ;
  - C8 → lot 4.1–4.2 et table du lot 8 ;
  - C9 → lot 5, registre ;
  - C10 → lot 2 ;
  - C11 → lot 6 ;
  - C12 → lot 4.1 (a) ;
  - C13 → lot 8.1, 8.9 ;
  - C14 → lot 8.10 ;
  - C15 → lot 1.5 ;
  - C16 → lot 5, `journal`.
- **v2, Codex** :
  - V1 (moteur, `journal`, `lireModelesAutorises`) → lot 5 ;
  - V2 (extraction authentifiée) → lot 5, `--extraire-publication` ;
  - V3 (portier : corps, statut, 504) → lot 3.4–3.6 et tests 1–11 ;
  - V4 (automate du verrou, B1, verrou `.git`) → lot 4.2 et table du lot 8 ;
  - V5 (`--initialiser`, registre strict) → lot 5, registre ;
  - V6 (diagnostic hermétique, résultats typés, `--actualiser`, initialisation au lot 7) → lots 5 et 7 ;
  - V7 (Drive : accès, `incompleteSearch`, même dossier, « pour ce set_id ») → lots 5 et 4.1 (a) ;
  - V8 (essai intégré isolé et négatifs) → lot 5 ;
  - V9 (« Verifier unicite » préserve la réponse de dépôt) → lot 4.4 ;
  - V10 (archive complète, deux sources, marqueur, manifeste) → lot 8.10 ;
  - V11 (`--palier`, parsing) → lot 4 bis ;
  - V12 (décisions harmonisées) → lots 1, 4 et section « Décisions ACTÉES ».
- **v3, Codex** :
  - B1 (`config.modelesAutorises`) → lot 5, `config` + test ;
  - B2 (expression `.first().json`, corps exact, `responseCode`) → lot 3.3–3.6 ;
  - I1/I2 (extraction sans `preparerPublication`, fonction partagée `entreeDepuisLot`, `resoudreReferentiel`, relançable après publication) → lot 5, `--extraire-publication` + essai intégré n° 7 ;
  - I3 (exclusion commune, relecture après acquisition, `libere` → `envoi`, `accepte` terminal, `--reparer`) → lot 4.2 ;
  - I4, option a (témoin dérivé, `--initialiser` refusé si traces, limite, option b future) → lot 5, registre ;
  - I5 (fabriques par commande, états et priorités du diagnostic, `pret_pour_cloture`) → lot 5 ;
  - M1 (nom du récapitulatif) → lot 8.10.

## Statut et critères d'acceptation (décision Claude, 2026-10-20)
**Plan VALIDÉ au niveau architectural** : architecture, séquencement, D1–D6, bascules B1 et B2. On ne fait pas de v5 du document. L'implémentation se fait **lot par lot**, chaque PR étant relue par Codex puis Claude et couverte par des tests. La garde maîtresse reste en place jusqu'au lot 7.

La contre-passe Codex de la v4 donne les **critères d'acceptation testés** suivants, à vérifier dans la PR du lot concerné :

- **Lot 5, fabriques complètes** :
  - `dependancesSaisie` fournit `config` (dont `dossier` et `workflowGeneration`) et `referentielArchive` (`signer-cloture.js:247–285`) ;
  - une fabrique fournit `decisionsLocales` (`cloturer`, `:410`) ;
  - chaque fabrique construit EXACTEMENT ce que `cloturer` et `saisirDecisionLocale` consomment, avec un test par type.
- **Lot 5, diagnostic** :
  - les anomalies passent d'abord, puis les états de progression du plus avancé au moins avancé : `signe` > `pret_pour_cloture` / `decision_figee` > `pret_pour_saisie` ;
  - `non_initialise` passe avant `acces_ko:registre` ;
  - `pret_pour_cloture` EXCLUT une décision `rejeter` (`:570`), un incident résolu dont la période couvre la fenêtre (`:629–635`) et une exécution en cours non attribuée (`liaison-generation.js:95–117`), en exploitant les constats des fonctions réutilisées.
- **Lot 5, témoin d'incidents (option a)** :
  - la comparaison porte sur la **projection complète** (`id`, `nature`, `detecte_le`, `statut`, `resolu_le`, `preuve_resolution`, `periode`) ;
  - les dates sont normalisées comme le fait le signataire (`+02:00` → `Z` en millisecondes), indépendamment de l'ordre des clés ;
  - les attestations LOCALES sont **vérifiées par signature** avant d'être lues ;
  - au catalogue, les 8 attestations `manuelle-historique` (sans `charge`) sont distinguées d'une `cloture-signee` malformée, qui est refusée ;
  - une `Error` ordinaire de `incidents()` donne un **refus temporaire** et non un incident de chaîne, sauf si elle porte un `.statut` explicite ;
  - tests : preuve modifiée, date équivalente, valeurs contradictoires entre attestations.
- **Lot 4, `--reparer`** :
  - prise en main d'un `.en-cours` orphelin quand O_EXCL échoue ;
  - exclusion de deux réparateurs concurrents ;
  - séparation des événements administratifs et des transitions d'état ;
  - un format qui permet d'ignorer exactement le fragment réparé ;
  - tests : interruption pendant la réparation, deux réparateurs.
- **Lot 5, `entreeDepuisLot`** : fonction asynchrone, empreinte réellement calculée, ordre « vérification complète de l'attestation → chargement du moteur » conservé.
- **Lot 8.10 (M1)** : archive `recapitulatif-<set_id>-<code>.txt`.

## Décision Claude du 2026-10-20 : FONDA DÉCOUPLÉ du nettoyage des clés BOX
- **Lot 1 pour FONDA = un seul geste** : une clé FONDA dédiée (workspace séparé et plafond, D2), posée dans « Anthropic FONDA » (`YnhTnSOc1u7S99Q7`). **Fait** (Éric, 2026-10-20). La révocation des autres clés **sort du chemin critique FONDA**.
- Le **chantier sécurité des autres projets** (BOX, IAZIMUT, autres workflows) est cadré à part. Son inventaire et sa carte d'exposition restent **hors dépôt** (dépôt public).
- Les lots 2 (recette §20.10) et 3 (portier) ne dépendent pas des clés : ils peuvent avancer.
