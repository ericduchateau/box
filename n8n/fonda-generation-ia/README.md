# BOX - FONDA Generation IA (« n8n génère »)

CDC relecture v8.3, §20.14 étape 4. Le workflow est **complet**, **créé INACTIF** dans l'instance et **jamais exécuté pour de vrai** avant la recette §20.8. À cette recette : régénérer la clé Anthropic, capturer le vrai champ `model` d'un appel, remplir `fonda/data/modeles-autorises.json` (vide jusque-là), puis relire et merger.

- **Portier (dette B, plan étape 5, lot 3)** : workflow NON audité « BOX - FONDA Generation IA (portier) », créé INACTIF. workflowId du portier : `MkYrdhgTo52nA3av`. L'appelant n'appelle **que** le portier (`POST /webhook/box-fonda-generation-ia-portier`, en-tête `X-FONDA-Token` = credential « FONDA Portier Token » `sdVd72oXHCWhIxTd`). Le portier :
  - valide `{ set_id, ref }` par `validerDeclencheur`, code identique à celui de l'entrée de génération ;
  - répond **400** sur un corps malformé, **sans appeler** la génération : aucune exécution auditée n'est créée ;
  - sinon transmet **exactement** `{ set_id, ref }` au webhook de génération, avec la credential `GfnXr5hYrYgC5RwA` (jeton distinct, F5), sans nouvel essai ;
  - répond **202** si la génération a **accepté** l'appel (200 immédiat, `onReceived`). C'est une acceptation, pas une fin de génération ;
  - répond **504** `{ etat: 'inconnu' }` dans tous les autres cas : délai dépassé, connexion refusée, 401, 404, 500, 2xx inattendu, ou **3xx** (les redirections ne sont **jamais suivies** : `followRedirects: false`, alors qu'elles le sont par défaut en 4.2). Consigne : **observer, ne jamais renvoyer** ;
  - **limite** : si le portier lui-même échoue avant tout Respond, n8n répond **500** « Error in workflow ». Avant la transmission, rien n'est lancé ; après, la génération peut déjà tourner. **L'appelant traite donc 500, une rupture de connexion ou un délai dépassé comme « inconnu »** (verrou du lot 4) et n'envoie jamais de nouvelle requête automatiquement.
  - **Vérification AVANT activation** (Éric, consignée avec la recette) :
    - les deux credentials (« FONDA Portier Token » `sdVd72oXHCWhIxTd` et « FONDA Webhook Token » `GfnXr5hYrYgC5RwA`) contiennent des **valeurs différentes**, générées séparément. Le harnais ne compare que les identifiants ; il ne voit pas les valeurs ;
    - sur une copie, ou pendant la première fenêtre active, un appel **direct** au webhook de génération avec le jeton du portier reçoit **403/401** : la frontière interne refuse le jeton de l'appelant.

  Harnais : `portier.test.js`, simulateur `simulateur.js`.
- **Dette C : RÉDUITE, PAS CLOSE (D5)** (plan étape 5, lot 4). Ni Drive ni n8n n'offrent de création atomique. Le **garant** reste l'abandon du signataire sur doublon. Les dispositifs en place :
  - **appelant unique** `fonda/scripts/declencher-generation.js` (logique dans `verrou-generation.js`) :
    - chaque commande s'exécute sous le **verrou noyau** de son set_id, **tenu par le processus Node lui-même** (`lockf` en mode descripteur, sans superviseur séparé), libéré par le noyau même après un `kill -9`. Un verrou orphelin est impossible, et une commande concurrente échoue aussitôt (code 75) ;
    - contrôles en lecture **avant toute écriture** : réservation, aucun fichier local (`setIdsExistants`), aucune exécution n8n, aucun candidat **pour ce set_id**. Les observations sont des entiers explicites, sinon refus ;
    - journal en ajout seul, écrit **en entier** puis `fsync`, lu **sur les octets**. États : `envoi`, `accepte` (terminal), `refuse`, `inconnu`, `libere` ; les événements administratifs (`reparation`) sont séparés ;
    - **un seul POST**, jamais de nouvel essai. `--etat` observe ; `--liberer --motif` libère après le délai de prudence (horloge supposée stable ; un événement daté dans le futur est refusé) ; `--reparer` complète une ligne tronquée et désigne le fragment par son index et le SHA-256 de ses octets bruts, sans rien effacer ;
    - les adaptateurs de production arrivent au lot 5 ;
  - **côté workflow audité** : « Relister candidat » (**pagination complète** : `pageToken`, 50 pages au plus) puis « Verifier unicite » **après** le dépôt. Toutes les pages sont agrégées, et `incompleteSearch` sur une page quelconque fait refuser. Il faut exactement un fichier pour ce set_id, celui déposé ; sinon erreur visible. La réponse du dépôt est réémise, et « FONDA Sortie generation » la lit **par son nom**.
- **Restrictions d'exploitation (obligatoires)** :
  - **jamais** de « Retry » ni d'« Execute » manuel sur le portier ou la génération ;
  - `retryOnFail` faux partout (vérifié par les harnais) ;
  - portier et génération **actifs uniquement pendant une fenêtre de génération**, désactivés ensuite.
- **workflowId de l'instance : `vrqgtS5kQMvP9Ok5`.** C'est l'identifiant à épingler dans `config.workflowGeneration` à l'étape 5.
- Artefact relu : `box-fonda-generation-ia.json`, **export exact** du live (`GET /api/v1/workflows/vrqgtS5kQMvP9Ok5`, identique à `n8n_get_workflow`), indenté à 2 espaces. On retire **un seul** champ, `shared` : ce sont les métadonnées du propriétaire, qui contiennent son adresse e-mail, interdite dans le dépôt public. Après toute modification live, ré-exporter et committer : le diff git doit refléter l'état réel.
- Le JSON est **construit** par `construire-workflow.js` à partir du dépôt. Les nœuds Code embarquent, à l'identique, `catalogue.js`, `journal-set-ids.js`, `generation.js`, `moteur-correction-v1.js` et `canonique.js`, ainsi que les fonctions pures de `generer-lot-fonda.js`, `moteurs.js` et `liaison-generation.js`. **Ne jamais éditer les nœuds Code dans l'interface** : on modifie le dépôt, on reconstruit, on met à jour le live, on ré-exporte.
- Le harnais `workflow.test.js` (`node --test`) vérifie que l'export correspond octet pour octet à la reconstruction depuis le dépôt. Il exécute aussi l'export sur une fixture : déclencheur et réponses HTTP simulés, **aucun appel réel**. Il passe enfin la sortie au contrat du signataire (`liaison-generation.rapprocher` et `canonique.js`).

## Chaîne (13 nœuds, linéaire, échec = arrêt)

| # | Nœud | Rôle |
|---|------|------|
| 1 | Webhook generation | `POST /webhook/box-fonda-generation-ia`, corps `{ "set_id", "ref" }` (déclenchement `mode = webhook`). **Header Auth** : en-tête `X-FONDA-Token`, credential « FONDA Webhook Token » référencée par id ; sans jeton valide, n8n refuse l'appel avant toute exécution |
| 2 | **FONDA Entree generation** | `item.json = { set_id, ref }` exactement (motif `SET_ID_PATTERN`, `ref` non vide) |
| 3–4 | Lire commit design, Fixer commit | `journal_commit` = tête de `design` (40 hex) au moment de l'exécution |
| 5–7 | Lire journal, referentiel, moteurs | API GitHub `contents/<chemin>?ref=<journal_commit>` (dépôt public) : **octets exacts** du blob en base64, décodés et hachés en JS pur |
| 8 | Chercher candidat existant | Drive `candidats/` : aucun fichier de ce nom ni de `fonda_set_id`, sinon arrêt |
| 9 | Preparer generation | réservation `(set_id, ref)` à l'état `reserve` au commit consigné ; notion exclue → arrêt ; `referentiel_version` = SHA-256 des octets lus ; moteur = dernier du registre = moteur embarqué ; requête **G3** |
| 10 | Appel Sonnet | HTTP `api.anthropic.com/v1/messages`, credential `anthropicApi` par id (`YnhTnSOc1u7S99Q7`), modèle **épinglé** `claude-sonnet-5-5` (snapshot sans date ≥ 4.6, CDC r8 ; confirmé par la sonde §20.8 : exécution n8n `279792` du 2026-10-21, champ `model` de la réponse = `claude-sonnet-5-5`), sans nouvel essai ni repli |
| 11 | Construire lot | `modele` = champ `model` **de la réponse** (≠ épinglé → arrêt) ; même chaîne que le générateur local (tri par le correcteur, candidates, `deposerEnRelecture`, `construireLotFonda`) ; aucun null explicite ; empreintes ; corps multipart |
| 12 | Deposer candidat | Drive `candidats/<set_id>.lot.json`, `properties` publiques `{ fonda_set_id, fonda_execution_id }` posées à la création, sans nouvel essai |
| 13 | **FONDA Sortie generation** | `generation-fonda/v1` : tous les champs relus par `rapprocher` |

**G3 (liste blanche).** Le prompt est construit **uniquement** depuis `{ id, libelle, matiere, axe, micro_competence, enonce_modele }`, le palier et les règles du dépôt (`construirePrompt`), à la version `referentiel_version`. En sont exclus `taux_eval`, `priorite_initiale`, `frequence_base_semaines`, et toute donnée de cours, de mail, de classe ou d'élève. Aucun contexte tiré d'autres lots n'est transmis, contrairement au script local : le CDC n'inscrit pas cette donnée dans la liste blanche. Le harnais le prouve en injectant des marqueurs dans le référentiel : aucun n'apparaît dans la requête.

**Présupposé.** La génération exige une **réservation journalisée** pour `(set_id, ref)` sur `design` (`generer-lot-fonda.js --reserver`, puis PR). Sans elle, l'exécution s'arrête avant l'appel au modèle. La fixture du harnais simule cette réservation (journal synthétique).

**Nœuds HTTP : format de réponse « autodetect » partout.** Dans n8n 2.6.3 (`HttpRequestV3`), « text » appliqué à un corps JSON le parse puis le **re-sérialise**, ce qui change les octets et fausserait `referentiel_version`. De son côté, « json » associé à un corps brut (`raw`, dépôt multipart) renvoie un **flux non lu**. Seul l'autodetect lit le flux et décode selon le `Content-Type`. Relecture Codex r1, vérifiée dans le source n8n.

**Appelant (étape 5).** Il envoie l'en-tête `X-FONDA-Token` (jeton lu hors dépôt), valide `{ set_id, ref }` **avant** l'envoi et n'envoie **qu'un appel à la fois par set_id**. Deux défauts sont **reportés** parce que le workflow reste inactif. Ce sont des **dettes obligatoires avant activation** (étape 5), suivies dans `AVANCEMENT.md` (relecture Codex r1, points 4 et 5 ; décision de la relecture Claude du 2026-10-20) :
- **Dette B** : un appel authentifié mais mal formé crée une exécution en erreur sans déclencheur exploitable, que le signataire classe à juste titre comme « incident ». Correctif **côté workflow** : le nœud d'entrée émet toujours `{ set_id, ref }` pour un corps valide, et un corps malformé est rejeté à la frontière du webhook (4xx) sans laisser d'exécution auditée non attribuable.
- **Dette C** : deux appels simultanés pour un même set_id peuvent déposer deux fichiers, car Drive n'impose pas l'unicité ; le signataire abandonne. Correctif : dépôt idempotent ou exclusion mutuelle, reprises réseau incertaines comprises.

Dans les deux cas, l'échec reste du côté sûr : jamais de signature erronée.

**Erreurs.** Une erreur **avant** le dépôt ne laisse aucun fichier. Une erreur **après** le dépôt (réponse Drive incohérente) laisse un fichier rattaché à une exécution en erreur : le signataire abandonne (§20.2). Il n'y a pas de branche d'erreur ni de `continueOnFail`, par choix : tout échec arrête la chaîne.

## Validation (rapport joint à la PR)

- `validate_node` (webhook, Appel Sonnet, Deposer candidat, lectures raw) : 0 erreur. La seule alerte, qui recommande `onError: continueRegularOutput` sur le webhook, est écartée volontairement : fail-closed.
- `n8n_validate_workflow vrqgtS5kQMvP9Ok5` : 13 nœuds, 12 connexions valides, 13 expressions validées. Les **2 « erreurs » sont des faux positifs** (« Array items must be objects with json property » sur Preparer generation et Construire lot), comme les 2 avertissements (« Dynamic require() »). Tous viennent de l'analyse statique du **code des modules embarqués** (`return ['…']` de `validerAttestation`, `require('./catalogue.js')` résolu par `requis`) et non de la sortie des nœuds. Le harnais prouve que chaque nœud Code renvoie `[{ json }]` et s'exécute sans `require`, `Buffer`, `TextEncoder` ni `crypto`.

## pinData `null` (API n8n) : dette A soldée

L'API publique n8n crée les workflows avec `pinData: null`, champ qu'elle n'accepte pas en écriture (`additionalProperties: false`), et chaque exécution recopie cette valeur. Depuis la PR de la dette A (CDC v8.3 r7), `liaison-generation.rapprocher` traite `pinData` **absent, `null` ou `{}`** comme « rien d'épinglé ». Un objet non vide, un tableau ou tout autre type reste inexploitable. L'enregistrement depuis l'éditeur, contournement de l'étape 4 qui a normalisé le live à `{}`, n'est donc plus nécessaire. L'export livré reste soumis au harnais : `pinData` absent ou `{}`.

## Recette d'instance (§20.10)

Voir `RECETTE-INSTANCE.md`, que vous remplissez avant le premier vrai run.
