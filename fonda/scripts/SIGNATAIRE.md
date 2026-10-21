# Signataire FONDA : commandes et secrets (plan étape 5, lot 5)

Tout se passe sur le Mac d'Éric. **La garde maîtresse est en place** : `node fonda/scripts/signer-cloture.js <set_id>` refuse toujours de signer, faute de `rattachement`. Elle sera levée au lot 7, pour la seule `saisie_locale`.

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
| `signer-cloture.js <set_id>` | clôture : **refusée** jusqu'au lot 7 (garde) |
| `signer-cloture.js --extraire-publication <set_id>` | vérifie **toutes** les pièces signées, puis écrit `lot-relu.json`. La commande est relançable : si le fichier existe avec les mêmes octets, elle réussit sans écrire ; s'il diffère, elle refuse |
| `declencher-generation.js <set_id> <ref>` (et `--etat`, `--liberer`, `--reparer`) | appelant unique de la génération (lot 4) |

## États du diagnostic

Le diagnostic rapporte le **premier** état applicable dans l'ordre ci-dessous :
- d'abord les anomalies : `non_initialise`, `acces_ko`, `incident_ouvert`, `observation_contradictoire`, `generation_en_cours`, `doublon` ;
- puis l'avancement, du plus avancé au moins avancé : `signe`, `pret_pour_cloture`, `decision_figee`, `pret_pour_saisie`, `candidat_non_conforme`, `generation_echouee`, `aucune_generation`.

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
