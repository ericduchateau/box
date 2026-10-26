# Signataire FONDA : commandes et secrets (plan étape 5, lot 5)

Tout se passe sur le Mac d'Éric. **La garde maîtresse est levée au lot 7, pour la seule `saisie_locale`** :
- `node fonda/scripts/signer-cloture.js <set_id>` clôture en saisie locale. La clé est préparée **avant** la clôture : phrase de passe saisie au terminal.
- Toute autre source (`--source page_relecture`, etc.) est refusée **avant** tout appel réseau et toute lecture de secret ou de clé.
- La garde de `cloturer` est **inchangée** : sans fonction `rattachement`, elle refuse.
  - En production, `main()` fournit `RATTACHEMENT_SAISIE_LOCALE`.
  - Cette fonction n'est jamais consommée en saisie locale ; si elle l'était (parcours page), elle refuserait (`precondition`).
  - Le contrat de rattachement du parcours page n'est toujours pas défini.

## Secrets (`~/.fonda-cles/`, jamais dans le dépôt ni dans Dropbox)

| Fichier | Rôle |
|---|---|
| `n8n-signataire.cle` | clé d'API n8n dédiée, utilisée en lecture des exécutions |
| `drive-compte-service.json` | compte de service Google, portée `drive.readonly`, partagé **uniquement** sur `FONDA-Lots` (D1) |
| `portier.jeton` | jeton `X-FONDA-Token` de l'appelant (portier), pour `declencher-generation.js` |
| `eric-2026.priv.pem` | clé privée **chiffrée**. Elle est lue seulement par `preparerSignataire`, au moment de signer, après saisie de la phrase de passe. Un agent ne la lit jamais. |

Dossier de clôture : `~/FONDA-clotures/` (hors dépôt, hors Dropbox).

## Commandes

| Commande | Effet |
|---|---|
| `signer-cloture.js --actualiser` | `git fetch origin design`. C'est la **seule** commande qui écrit dans `.git` |
| `signer-cloture.js --initialiser` | crée le registre `incidents.json` (`[]`) et la sentinelle `.initialise`. **Jamais de remise à zéro** ; refus en cas de traces d'usage |
| `signer-cloture.js --diagnostic [<set_id>]` | lecture seule **hermétique**, sans clé de signature ; état typé (tableau ci-dessous) |
| `signer-cloture.js --saisir <set_id>` | décision locale figée (`saisirDecisionLocale`) |
| `signer-cloture.js <set_id>` | clôture en **saisie locale** (lot 7) : clé préparée avant, puis `cloturer` ; `--source page_relecture` refusée avant réseau et clé |
| `signer-cloture.js --extraire-publication <set_id>` | vérifie **toutes** les pièces signées, puis écrit `lot-relu.json`. La commande est relançable : si le fichier existe avec les mêmes octets, elle réussit sans écrire ; s'il diffère, elle refuse |
| `declencher-generation.js <set_id> <ref>` (et `--etat`, `--liberer`, `--reparer`) | appelant unique de la génération (lot 4) |

## États du diagnostic

Le diagnostic rapporte le **premier** état applicable dans l'ordre ci-dessous :
- d'abord les anomalies : `non_initialise`, `acces_ko`, `incident_ouvert`, `observation_contradictoire`, `generation_en_cours`, `doublon`, `signature_interrompue`, `generation_incoherente`, `candidat_non_conforme`, `relecteur_non_local`, `decision_non_conforme` ;
- puis l'avancement, du plus avancé au moins avancé : `signe`, `pret_pour_cloture`, `decision_figee`, `pret_pour_saisie`, `generation_echouee`, `aucune_generation`.

Précisions :
- recherche Drive incomplète (`incompleteSearch`) → `acces_ko` ;
- génération réussie sans candidat, ou candidat sans génération → `generation_incoherente` (jamais `aucune_generation`, réservé au cas où il n'y a ni l'une ni l'autre) ;
- le lot est lu deux fois (octets, id, date de modification) : s'il change entre les deux → `candidat_non_conforme` ; idem si le référentiel archivé ne se résout pas ;
- lot au JSON invalide, lu dans un autre fichier que celui listé, ou daté après la fin de génération → `candidat_non_conforme` (mêmes contrôles que le signataire) ;
- relecteur attribué autre que « eric » (fonction `relecteurDeLaGeneration` du signataire) → `relecteur_non_local` ;
- décision illisible, d'un autre `set_id`, dont l'empreinte relue ne correspond pas au lot, ou deux décisions aux octets distincts → `decision_non_conforme` ;
- `signe` exige que les pièces d'un dossier `<set_id>-<code>` se vérifient ; le marqueur `.signature` seul (écrit avant la signature) → `signature_interrompue`.

`--saisir` : une fin d'entrée au terminal (Ctrl-D) arrête la saisie sur un refus (code ≠ 0), sans figer de décision.

`--initialiser` et `--extraire-publication` n'utilisent que les sources **locales** (dépôt, git, dossier de clôture) : ils ne lisent aucun secret réseau. L'extraction exige que l'attestation porte le `set_id` demandé et que le dossier s'appelle exactement `<set_id>-<code_confirmation>`.

`pret_pour_cloture` suppose toutes ces conditions :
- une décision figée conforme, d'action `accepter` ;
- une génération rapprochée sans constat ;
- **aucune** anomalie, en particulier aucune exécution en vol, même non attribuée ;
- aucun incident résolu dont la période couvre la fenêtre de candidature (de la génération à `recu_le`).

## Registre des incidents : témoin dérivé (option a)

Le registre doit contenir **au moins** tous les incidents cités dans `charge.incidents_connus` par les attestations signées :
- locales, chacune vérifiée **par signature** avant d'être lue ;
- publiées au catalogue (`cloture-signee` vérifiées ; les 8 `manuelle-historique` n'ont pas de charge).

La comparaison porte sur la projection complète de l'incident. Les dates sont normalisées comme le fait le signataire.

**Limite assumée** : un incident ouvert puis effacé, qu'aucune attestation n'a jamais cité, reste indétectable. Durcissement futur (option b) : registre versionné en ajout seul dans le dépôt, avec contrôle CI d'immuabilité.
