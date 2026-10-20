# BOX - FONDA Generation IA (« n8n génère »)

CDC relecture v8.3, §20.14 étape 4. Le workflow est **complet**, **créé INACTIF** dans l'instance et **jamais exécuté pour de vrai** avant la recette §20.8. À cette recette : régénérer la clé Anthropic, capturer le vrai champ `model` d'un appel, remplir `fonda/data/modeles-autorises.json` (vide jusque-là), puis relire et merger.

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
| 10 | Appel Sonnet | HTTP `api.anthropic.com/v1/messages`, credential `anthropicApi` par id (`YnhTnSOc1u7S99Q7`), modèle **épinglé** `claude-sonnet-5-5-20261001` (à confirmer §20.8), sans nouvel essai ni repli |
| 11 | Construire lot | `modele` = champ `model` **de la réponse** (≠ épinglé → arrêt) ; même chaîne que le générateur local (tri par le correcteur, candidates, `deposerEnRelecture`, `construireLotFonda`) ; aucun null explicite ; empreintes ; corps multipart |
| 12 | Deposer candidat | Drive `candidats/<set_id>.lot.json`, `properties` publiques `{ fonda_set_id, fonda_execution_id }` posées à la création, sans nouvel essai |
| 13 | **FONDA Sortie generation** | `generation-fonda/v1` : tous les champs relus par `rapprocher` |

**G3 (liste blanche).** Le prompt est construit **uniquement** depuis `{ id, libelle, matiere, axe, micro_competence, enonce_modele }`, le palier et les règles du dépôt (`construirePrompt`), à la version `referentiel_version`. En sont exclus `taux_eval`, `priorite_initiale`, `frequence_base_semaines`, et toute donnée de cours, de mail, de classe ou d'élève. Aucun contexte tiré d'autres lots n'est transmis, contrairement au script local : le CDC n'inscrit pas cette donnée dans la liste blanche. Le harnais le prouve en injectant des marqueurs dans le référentiel : aucun n'apparaît dans la requête.

**Présupposé.** La génération exige une **réservation journalisée** pour `(set_id, ref)` sur `design` (`generer-lot-fonda.js --reserver`, puis PR). Sans elle, l'exécution s'arrête avant l'appel au modèle. La fixture du harnais simule cette réservation (journal synthétique).

**Nœuds HTTP : format de réponse « autodetect » partout.** Dans n8n 2.6.3 (`HttpRequestV3`), « text » appliqué à un corps JSON le parse puis le **re-sérialise**, ce qui change les octets et fausserait `referentiel_version`. De son côté, « json » associé à un corps brut (`raw`, dépôt multipart) renvoie un **flux non lu**. Seul l'autodetect lit le flux et décode selon le `Content-Type`. Relecture Codex r1, vérifiée dans le source n8n.

**Appelant (étape 5).** Il envoie l'en-tête `X-FONDA-Token` (jeton lu hors dépôt), valide `{ set_id, ref }` **avant** l'envoi et n'envoie **qu'un appel à la fois par set_id**. Deux risques résiduels sont acceptés et documentés (décision d'Éric du 2026-10-20, relecture Codex r1, points 4 et 5) :
- un appel authentifié mais mal formé crée une exécution en erreur sans déclencheur exploitable ; le signataire la classe « incident » et suspend les clôtures, ce qui reste fail-closed ;
- deux appels simultanés pour un même set_id peuvent déposer deux fichiers, car Drive n'impose pas l'unicité ; le signataire abandonne et il faut une nouvelle réservation. Jamais de signature erronée.

**Limites d'exploitation (relecture Codex r2).**
- *Cadence* : chaque génération fait 4 appels REST GitHub non authentifiés, alors que la limite est de 60 par heure et par IP, partagée avec les autres usages de l'instance. L'appelant de l'étape 5 lance donc **au plus 10 générations par heure** (consigne de prudence, pas un seuil exact). Si GitHub refuse pour dépassement de quota, l'exécution s'arrête avant l'appel au modèle : refus sûr, aucun dépôt.
- *Taille* : l'API contents ne renvoie le contenu base64 que **jusqu'à 1 Mo**. Le journal grossit à chaque réservation : 4,6 Ko le 2026-10-20. Le harnais échoue en CI dès qu'un fichier lu dépasse 900 Ko, et il faudra alors passer à l'API `git/blobs`. Au-delà de 1 Mo, le workflow refuse (`encoding ≠ base64`) : refus sûr.
- *Jeton* : le nœud webhook enregistre les en-têtes de la requête, dont `X-FONDA-Token`, dans les données d'exécution conservées (§20.10). Ces données restent sur l'instance, qui n'est accessible qu'à Éric et à l'API. On ne les exporte jamais. Si elles devaient sortir de l'instance, il faudrait régénérer le jeton. Un jeton révélé ne permet jamais de publier ni de signer. Il permet en revanche de déclencher des générations sur une réservation publique, de consommer le quota GitHub et les crédits Sonnet, de provoquer des exécutions en erreur classées « incident » qui bloquent les clôtures, ou des générations concurrentes qui mènent à un abandon. En cas de doute, le régénérer.

**Erreurs.** Une erreur **avant** le dépôt ne laisse aucun fichier. Une erreur **après** le dépôt (réponse Drive incohérente) laisse un fichier rattaché à une exécution en erreur : le signataire abandonne (§20.2). Il n'y a pas de branche d'erreur ni de `continueOnFail`, par choix : tout échec arrête la chaîne.

## Validation (rapport joint à la PR)

- `validate_node` (webhook, Appel Sonnet, Deposer candidat, lectures raw) : 0 erreur. La seule alerte, qui recommande `onError: continueRegularOutput` sur le webhook, est écartée volontairement : fail-closed.
- `n8n_validate_workflow vrqgtS5kQMvP9Ok5` : 13 nœuds, 12 connexions valides, 13 expressions validées. Les **2 « erreurs » sont des faux positifs** (« Array items must be objects with json property » sur Preparer generation et Construire lot), comme les 2 avertissements (« Dynamic require() »). Tous viennent de l'analyse statique du **code des modules embarqués** (`return ['…']` de `validerAttestation`, `require('./catalogue.js')` résolu par `requis`) et non de la sortie des nœuds. Le harnais prouve que chaque nœud Code renvoie `[{ json }]` et s'exécute sans `require`, `Buffer`, `TextEncoder` ni `crypto`.

## Dette ouverte : pinData `null` (API n8n)

Un workflow créé par l'API publique a `pinData: null`, que l'API refuse de modifier, et chaque exécution recopie cette valeur. Or le signataire n'admet que « absent ou objet vide ». Correctif provisoire (décision d'Éric, 2026-10-20) : un enregistrement depuis l'éditeur, sans activation, normalise `pinData` à `{}`, puis on ré-exporte. **Avant la recette §20.8**, une PR séparée durcira `liaison-generation.rapprocher` et le CDC : seront acceptables `pinData` absent, `null` ou `{}` ; seront refusés un objet non vide, un tableau ou tout autre type.

## Recette d'instance (§20.10)

Voir `RECETTE-INSTANCE.md`, que vous remplissez avant le premier vrai run.
