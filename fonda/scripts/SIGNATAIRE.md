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
| `signer-cloture.js --actualiser` | `git fetch --quiet origin +refs/heads/design:refs/remotes/origin/design` (refspec **explicite**, indépendante de `remote.origin.fetch`) ; affiche le SHA |
| `signer-cloture.js --initialiser` | crée le registre `incidents.json` (`[]`) et la sentinelle `.initialise`. **Jamais de remise à zéro** ; refus en cas de traces d'usage |
| `signer-cloture.js --diagnostic [<set_id>]` | sans clé de signature ; état typé (tableau ci-dessous). **Écrit dans `.git`** (même fetch explicite que `--actualiser`, CDC r9) et affiche le SHA consulté ; rien d'autre n'est écrit |
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
- relecteur attribué autre que « eric » (fonction `relecteurDeLaGeneration` du signataire) **sans intérim applicable aujourd'hui** → `relecteur_non_local` (jamais pour un lot déjà signé : voir « Intérim ») ;
- décision illisible, d'un autre `set_id`, dont l'empreinte relue ne correspond pas au lot, ou deux décisions aux octets distincts → `decision_non_conforme` ;
- `signe` exige que les pièces d'un dossier `<set_id>-<code>` se vérifient ; le marqueur `.signature` seul (écrit avant la signature) → `signature_interrompue`.
- lot **signé** (pièces vérifiées, tous lots) : il reste `signe` et n'est **jamais** `pret_pour_cloture` ; une décision locale abîmée **ou illisible** après la signature, ou l'échec de l'actualisation de `design`, est rapporté dans `problemes_courants`, jamais comme `decision_non_conforme` ni `acces_ko` (les autres causes d'`acces_ko` — n8n, Drive, registre des incidents — restent des anomalies).

`--saisir` : une fin d'entrée au terminal (Ctrl-D) arrête la saisie sur un refus (code ≠ 0), sans figer de décision.

`--initialiser` et `--extraire-publication` n'utilisent que les sources **locales** (dépôt, git, dossier de clôture) : ils ne lisent aucun secret réseau. L'extraction exige que l'attestation porte le `set_id` demandé et que le dossier s'appelle exactement `<set_id>-<code_confirmation>`.

`pret_pour_cloture` suppose toutes ces conditions :
- une décision figée conforme, d'action `accepter` ;
- une génération rapprochée sans constat ;
- **aucune** anomalie, en particulier aucune exécution en vol, même non attribuée ;
- aucun incident résolu dont la période couvre la fenêtre de candidature (de la génération à `recu_le`).

## Intérim : relecteur de secours (CDC r9 §20.6, §20.9 v3)

`fonda/data/relecture-interim.json` (sur `design`) autorise « eric » à saisir et clôturer en saisie locale une notion routée vers un autre relecteur (le **titulaire**, qui reste le relecteur attribué : le référentiel n'est pas modifié). Une entrée = `{ relecteur_titulaire, relecteur_de_secours, motif, periode, du, au }`, bornes incluses, en heure de Paris ; `au` ≤ fin de la période du calendrier.

- **Autorisation** (nouvelles opérations seulement) : à chaque contrôle, `git fetch` explicite puis lecture, **au même SHA figé**, de `relecture-interim.json`, `calendar.json` et `destinataires.json` (jamais la copie de travail) ; validation **complète** du fichier ; **une seule** entrée applicable.
- **Saisie** (`--saisir`) : contrôle S1 avant la première carte (la présentation — titulaire, secours, motif, fenêtre, SHA — s'affiche), S2 juste avant l'écriture ; la décision `decision-fonda/v2` porte la preuve observée (entrée, `source_version`, `source_commit`).
- **Clôture** : provenance de la preuve (commit sur la chaîne de confiance, empreinte, fichier **valide** à ce commit, entrée unique au jour de `recu_le`) ; C1 ; C2 avant le récapitulatif (le badge exact est affiché puis figé) ; C3 après le code et la fidélité, avant le marqueur — tout changement de l'entrée ou des noms arrête (`local` : relancer, nouvelle confirmation). `cloture_le` doit tomber dans la fenêtre (minuit compris).
- **Charge `attestation-cloture/v3`** : mode `auto` par le secours, `relecteur_egal_cloturer` **false**, bloc `relecture_interim`, badge `relue_par_secours` avec le titulaire (« Fiche relue par Éric Duchateau — relecteur de secours (relecture de français, en attendant Justine Leblanc) »). L'instantané `instantane-fonda/v2` **embarque la décision complète** (et son empreinte) : toute substitution change le code de confirmation.
- **Vérification des pièces signées** (extraction, témoin, diagnostic `signe`) : **archive historique seule**, jamais le fichier de la tête ni le calendrier courant ; liaison complète décision ↔ instantané ↔ charge ↔ génération.
- **Réversibilité** : retirer l'entrée sur `design` interdit toute nouvelle saisie ou clôture ; le retrait ne touche pas aux attestations existantes (toujours vérifiables via `source_version` dans l'historique de confiance).
- **Diagnostic** : deux axes séparés — validité des pièces signées (toujours reconnue) ; autorisation de nouvelles opérations (`autorisation_interim`, rapportée à part). `pret_pour_cloture` exige aussi l'intérim applicable **aujourd'hui**.

**Limites assumées** (telles quelles) :
- un fetch **observe** l'état distant, il ne **verrouille** pas `design` : il subsiste une fenêtre résiduelle, non atomique, entre la dernière observation (C3) et l'appel au signataire ;
- on ne prouve pas cryptographiquement que S2 a été exécuté (la provenance prouve que l'état revendiqué **pouvait** autoriser la saisie).

## Orchestrateur multi-lots (`orchestrer-lots.js`)

`node fonda/scripts/orchestrer-lots.js --lots <fichier> --branche publie/<nom>` (une ligne « `<set_id> <ref>` » par lot, réservations déjà fusionnées sur `design`). Il enchaîne, lot par lot, les commandes EXISTANTES et ne s'arrête qu'aux deux actes humains :
1. génération : `declencher-generation.js --etat`, puis un seul déclenchement si rien n'est en vol — workflows n8n vérifiés **actifs** (jamais (dés)activés par l'orchestrateur) ; verrou « envoi »/« inconnu » → STOP (jamais de `--liberer`/`--reparer` automatique) ;
2. `--diagnostic` → `pret_pour_saisie` ; **acte humain** : `--saisir` lancé avec ton terminal (stdin hérité) ;
3. `--diagnostic` → `pret_pour_cloture` ; **acte humain** : `signer-cloture.js <set_id>` (ta passphrase, dans ton terminal ; l'orchestrateur ne la voit ni ne la fournit) ;
4. `--diagnostic` → `signe` ; `--extraire-publication` ; `publier-lot.js --dry-run` puis réel ;
5. un commit par lot (exactement lot + catalogue + journal) sur la branche de batch, poussée.

- **Terminal exigé** : refus de démarrer si stdin ou stdout n'est pas un terminal.
- **Diagnostic vert à chaque garde**, refait avant extraction, avant publication réelle et avant commit ; pendant l'attente d'une génération acceptée (202), seuls `aucune_generation` et `generation_en_cours` sont tolérés, dans un délai borné en temps réel (10 min) ; chaque diagnostic est arrêté au bout de 2 min (jamais `publier-lot.js` ni les actes humains).
- **STOP du lot** (lot sauté, arbre propre, batch continue) : échec de `--saisir` ou de la signature (code ≠ 0), anomalie à une garde, lot déjà au catalogue d'`origin/design`.
- **STOP du batch** (tout s'arrête) : publication locale non commitée (consignes précises : diff à examiner, 3 fichiers attendus, commande de commit OU d'annulation — jamais d'auto-commit), commit ou push refusé, branche divergente (`origin/design` et la distante refetchées à chaque recontrôle, y compris juste avant le push final), ne descendant pas d'`origin/design` ou portant un commit non conforme — y compris le commit qu'on vient de créer, revérifié avant tout push (un hook peut l'avoir modifié : consignes manuelles, jamais de reset automatique).
- Journal : `~/FONDA-clotures/orchestrations/<branche>.jsonl` ; résumé final ; code de sortie ≠ 0 dès qu'un lot est stoppé. Relançable : l'état est relu par `--diagnostic` et les étapes faites sont sautées ; « poussée » n'est annoncé qu'après vérification contre la branche distante (re-push si besoin). **Plafond** : branche poussée + URL compare et titre/description affichés — l'ouverture de la PR et la fusion restent des gestes humains ; jamais de push sur `main`/`design`. Rappel en fin de run si n8n a été sollicité : penser à désactiver les workflows.

## Registre des incidents : témoin dérivé (option a)

Le registre doit contenir **au moins** tous les incidents cités dans `charge.incidents_connus` par les attestations signées :
- locales, chacune vérifiée **par signature** avant d'être lue ;
- publiées au catalogue (`cloture-signee` vérifiées ; les 8 `manuelle-historique` n'ont pas de charge).

La comparaison porte sur la projection complète de l'incident. Les dates sont normalisées comme le fait le signataire.

**Limite assumée** : un incident ouvert puis effacé, qu'aucune attestation n'a jamais cité, reste indétectable. Durcissement futur (option b) : registre versionné en ajout seul dans le dépôt, avec contrôle CI d'immuabilité.
