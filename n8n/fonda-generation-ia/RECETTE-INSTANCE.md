# Recette d'instance §20.10 : à faire par Éric AVANT le premier vrai run

Le signataire relit les exécutions du workflow de génération. Une exécution purgée devient une donnée indisponible : la clôture est refusée, voire abandonnée si la donnée ne reviendra pas. Il faut donc que n8n **garde toutes les exécutions** de ce workflow et ne les **purge jamais**.

Constats de l'audit en lecture seule (`n8n_audit_instance` et `n8n_health_check`, 2026-10-20) :
- instance : `https://n8n.srv868991.hstgr.cloud/`, n8n **2.6.3** (37 versions de retard), API publique activée, santé OK ;
- workflow `vrqgtS5kQMvP9Ok5` « BOX - FONDA Generation IA » : inactif ; ses réglages poussés par l'API sont `saveDataSuccessExecution: all`, `saveDataErrorExecution: all`, `saveManualExecutions: true` et `saveExecutionProgress: true` ;
- l'audit **ne peut pas lire** la purge automatique de l'instance (variables d'environnement du conteneur). Il faut la vérifier à la main (point b).

## (a) Par workflow : sauvegarde des exécutions (clic par clic)

1. Ouvrir `https://n8n.srv868991.hstgr.cloud/` et se connecter.
2. **Overview** → **Workflows** → ouvrir **« BOX - FONDA Generation IA »**. Le commutateur **Active / Inactive** doit rester sur **Inactive** : n'y touchez pas.
3. Menu **⋯** en haut à droite → **Settings**.
4. Vérifier :
   - **Save failed production executions** : `Save` ;
   - **Save successful production executions** : `Save` ;
   - **Save manual executions** : `Save` ;
   - **Save execution progress** : `Save` ;
   - **Timeout Workflow** : désactivé.
5. Si une valeur diffère, **ne la corrigez pas ici**. Notez-la dans le bloc ci-dessous et prévenez Claude : on corrige par le dépôt, on reconstruit, on met à jour, on ré-exporte.
6. Fermer avec **Cancel**, sans enregistrer.

## (b) Instance : purge automatique DÉSACTIVÉE

La purge des exécutions d'une instance auto-hébergée se règle par **variables d'environnement**, et non dans l'interface. **Depuis n8n 1.0, la purge est activée par défaut** (exécutions supprimées après 14 jours, ou au-delà de 10 000). Le défaut est donc dangereux pour nous.

**Réglage requis : `EXECUTIONS_DATA_PRUNE=false`.** `EXECUTIONS_DATA_MAX_AGE` et `EXECUTIONS_DATA_PRUNE_MAX_COUNT` deviennent alors sans effet ; on les note quand même.

**Conséquence globale, à assumer :** le réglage vaut pour **toute** l'instance. Les exécutions BOX de production seront donc **aussi** conservées sans limite, et la base comme le disque grossissent. Il faut une **surveillance de capacité** (voir (b5)). On ne réactive pas la purge sans décision écrite d'Éric, car elle rendrait les clôtures FONDA impossibles (exécutions purgées → refus ou abandon).

Toutes les commandes ci-dessous s'exécutent dans le **terminal du VPS** (l'hôte), jamais dans le terminal *du conteneur*. hPanel → **VPS** → le serveur → **Terminal** (ou SSH).

### (b1) Constater d'abord (lecture seule, aucune interruption)
1. Identifier les conteneurs du projet :
   `docker ps --no-trunc --format '{{.ID}}  {{.Names}}  {{.Image}}  {{.Label "com.docker.compose.project"}}  {{.Label "com.docker.compose.service"}}  {{.Label "com.docker.compose.project.working_dir"}}  {{.Label "com.docker.compose.project.config_files"}}  {{.Label "com.docker.compose.project.environment_file"}}'`
   Pour le conteneur n8n, noter : **ID**, **nom**, **projet**, **service**, **dossier de travail**, **fichier(s) Compose** (liste séparée par des virgules, **dans cet ordre**) et **fichier(s) d'environnement** du déploiement (dernier label ; vide = `.env` du dossier par défaut). Noter aussi le **service et le conteneur de la base** (Postgres) s'il y en a un.
   **Si l'un des labels projet, service, dossier ou fichiers est vide : ARRÊT** (installation hors Compose ou inconnue). Prévenir Claude.
2. **Identité réelle de l'image** (le texte de la colonne IMAGE ne suffit pas) : `docker inspect <ID n8n> --format '{{.Image}}'`, qui donne un `sha256:…`. Noter cette valeur : c'est **ImageID AVANT**.
3. Lire la valeur effective : `docker exec <ID n8n> printenv EXECUTIONS_DATA_PRUNE`.
   - Résultat **exactement `false`** → **déjà conforme**, **aucune recréation**. Faire quand même le point 4 (persistance), puis consigner (« déjà conforme ») ; les champs de recréation deviennent « sans objet ».
   - Autre valeur, ou rien → continuer.
4. **Persistance** : `docker inspect <ID n8n> --format '{{json .Mounts}}'`, et de même pour le conteneur de la base s'il existe.
   - n8n : un montage (volume **ou** dossier de l'hôte) dont la `Destination` est `/home/node/.n8n` ;
   - base : un montage dont la `Destination` est son dossier de données (Postgres : `/var/lib/postgresql/data`).
   **Si un de ces montages manque : ARRÊT**, ne rien recréer (la recréation effacerait les données), prévenir Claude.

### (b2) Préparer (sans interruption)
Toutes les commandes Compose passent par une **fonction shell** qui reprend **exactement** le contexte du déploiement. Elle est définie une fois, dans le terminal du VPS, avec les valeurs notées en (b1), entre guillemets, un `-f` par fichier dans l'ordre, et un `--env-file` par fichier d'environnement noté. Si ce label est vide, on n'en met pas : le `.env` du dossier est alors lu automatiquement.

```sh
dc() { docker compose -p "<projet>" --project-directory "<dossier>" \
  -f "<fichier1>" [-f "<fichier2>" …] [--env-file "<env1>" …] "$@"; }
type dc   # vérifier que la fonction est bien définie
```

0. **Prouver que ce contexte reconstruit la PRODUCTION**, avant toute édition (sinon **ARRÊT** : un contexte différent pourrait changer autre chose, par exemple un mot de passe de base, sans que le diff le montre) :
   - **environnement comparé DANS LES DEUX SENS** (service n8n) :
     - (i) **reconstruit → production** : `dc config <service n8n>`, section `environment`. **Chaque** variable listée doit avoir **exactement la même valeur** dans `docker exec <ID n8n> printenv` ;
     - (ii) **production → reconstruit** : chaque variable de `docker exec <ID n8n> printenv` doit **soit** figurer dans cette section avec la même valeur, **soit** être une variable **par défaut de l'image exacte**, avec la même valeur. Ces variables par défaut s'obtiennent par `docker image inspect <ImageID AVANT> --format '{{json .Config.Env}}'`. Exceptions admises, propres à Docker : `HOSTNAME`, `HOME`, `PATH` (si elle est égale à celle de l'image).
     - **Une seule variable de production absente du résultat reconstruit (et qui n'est pas un défaut de l'image) → ARRÊT** : un `env_file` modifié ou manquant, ou une variable venue du shell, serait perdu à la recréation.
   - **montages et ports** : `docker inspect <ID n8n> --format '{{json .Mounts}} {{json .HostConfig.PortBindings}}'`, à comparer aux sections `volumes` et `ports` de `dc config <service n8n>` ;
   - même vérification **dans les deux sens** pour le service de la base (`dc config <service base>`, `docker exec <ID base> printenv`, défauts de son image, puis `docker inspect` pour les montages et les ports) ;
   - **contrôle complémentaire** : `dc config` ne doit afficher **aucun avertissement** « variable is not set ». Ce contrôle ne suffit pas : une variable transmise sous la forme `- VARIABLE` (sans valeur), absente du shell, ne déclenche aucun avertissement. C'est le sens (ii) ci-dessus qui la détecte.

   Toute différence : **ARRÊT**, rien n'est modifié, prévenir Claude. Ces sorties contiennent des secrets : ne pas les copier ailleurs.
1. **Sauvegardes** :
   - (i) **copie exacte** de chaque fichier Compose (et du `.env` s'il existe) avant édition : `cp -p <fichier> <fichier>.avant-prune-AAAAMMJJ` ;
   - (ii) **instantané du VPS** dans hPanel (Snapshots / Backups), heure notée. C'est un **recours ultime avec perte possible** : le restaurer effacerait toutes les écritures (BOX comprises) faites depuis sa prise. Ce n'est pas un retour arrière ordinaire.
2. **Configuration résolue AVANT** (fichier local, jamais publié : elle contient des secrets) : `dc config > /root/compose-avant.yml`.
3. **Éditer** le fichier Compose : sous le service n8n, bloc `environment:`,
   - si `EXECUTIONS_DATA_PRUNE` **n'existe pas** → **ajouter** `- EXECUTIONS_DATA_PRUNE=false` (ou `EXECUTIONS_DATA_PRUNE: "false"` en forme clé: valeur) ;
   - si elle **existe** → **remplacer sa valeur** par `false` et **noter la valeur initiale**.

   Une variable écrite dans le `.env` ne suffit pas : elle n'entre dans le conteneur que si le Compose la référence (`env_file:` ou `${…}` sous `environment:`).
4. **Démontrer que SEULE cette variable change** : `dc config > /root/compose-apres.yml && diff -u /root/compose-avant.yml /root/compose-apres.yml`.
   Le diff doit contenir **une seule** modification, **dans le bloc du service n8n**, sur `EXECUTIONS_DATA_PRUNE`, avec la valeur `"false"`. Toute autre ligne différente : **ARRÊT**, restaurer la copie (i), prévenir Claude.
5. **Image figée** : `dc config --images` doit citer pour n8n la même référence que la colonne IMAGE de (b1), et `docker image inspect <cette référence> --format '{{.Id}}'` doit être **égal à ImageID AVANT**. Sinon (le tag local désigne désormais une autre image) : **ARRÊT**.
6. **Avant l'arrêt** : n8n → menu **Executions** : aucune exécution BOX `Running`. Sinon, attendre.

### (b3) Recréer (heures creuses, quelques secondes à une minute d'interruption)
Un **Restart** (bouton, ou `docker compose restart`) **ne recharge pas** l'environnement. Le bouton **Update** de hPanel peut **mettre à jour l'image** : **ne pas l'utiliser**.

`dc up -d --no-deps --no-build --pull never <service n8n>`

- `--no-deps` : la base et les autres services ne sont pas recréés.
- `--pull never --no-build` : aucun téléchargement ni aucune construction d'image (cela empêche un changement d'image mais ne le prouve pas : d'où le contrôle (b4.1)).

### (b4) Contrôler
1. `docker ps --no-trunc` : **nouvel ID** du conteneur n8n (≠ ID AVANT). Puis `docker inspect <nouvel ID> --format '{{.Image}}'` = **ImageID AVANT** (identité réelle).
2. `docker exec <nouvel ID> printenv EXECUTIONS_DATA_PRUNE` → **exactement `false`**.
   - **Sinon : recette NON CONFORME.** Ne pas recréer à nouveau à l'aveugle : vérifier la cible et `dc config` avec Claude.
3. **Production BOX** :
   - les 9 workflows BOX attendus sont **Active** ;
   - le menu Executions ne montre aucune erreur nouvelle depuis la recréation ;
   - le catalogue élève répond réellement (`https://ericduchateau.github.io/box/`) ;
   - si possible, une fiche s'ouvre.
4. **Retour arrière exact** en cas d'échec d'un contrôle BOX :
   1. restaurer la **copie exacte** (b2.1-i) du ou des fichiers Compose (`cp -p <fichier>.avant-prune-AAAAMMJJ <fichier>`) ;
   2. vérifier que `dc config` est identique à `/root/compose-avant.yml` ;
   3. recréer avec la même commande (b3) ;
   4. vérifier que `printenv` donne la **valeur initiale**.

   Seulement si l'échec persiste : **instantané VPS** (recours avec perte possible, voir b2.1-ii), décidé par Éric.
5. Supprimer ensuite `/root/compose-avant.yml` et `/root/compose-apres.yml` (secrets), en gardant les copies `.avant-prune-*` jusqu'à la consignation.

### (b5) Surveillance de capacité (responsable : Éric)
- Une fois par mois, avec date et valeurs consignées dans le carnet d'exploitation :
  - `df -h` (disque du VPS) ;
  - la **taille réelle des données**, selon le stockage identifié en (b1.4) : `du -sh <Source>` pour chaque dossier de l'hôte monté (n8n et base), ou `du -sh $(docker volume inspect <volume> --format '{{.Mountpoint}}')` pour chaque volume nommé.
- Seuil d'alerte : disque occupé au-delà de 80 %. On décide alors **par écrit** (Éric, puis Claude) d'un archivage ou d'une purge **ciblée** sur les seuls workflows non FONDA, jamais d'une purge globale.

> Point à confirmer : les menus exacts de hPanel dépendent du modèle d'installation choisi chez Hostinger. Les commandes Docker, elles, sont standard.

## (c) Règles d'exploitation (dette C, à respecter à chaque fenêtre de génération)
- **Jamais** de bouton « Retry » ni « Execute workflow » sur « BOX - FONDA Generation IA » ou sur son portier : une relance contourne le verrou de l'appelant et peut créer un doublon (le lot serait alors abandonné).
- Les deux workflows ne sont **actifs que pendant la fenêtre** de génération : les activer juste avant `declencher-generation.js`, puis les désactiver après le dépôt observé.
- Réponse « inconnu » (504, 500, délai dépassé) : **ne jamais renvoyer**. Lancer `declencher-generation.js --etat <set_id>`, puis `--liberer --motif` seulement si rien n'est observé après le délai de prudence.

## Recette d'ACCÈS du signataire (lot 7 du plan étape 5) — consignée

Faite par Éric sur son Mac le **2026-10-22**, contre l'instance réelle, avec les commandes en lecture seule du signataire (`fonda/scripts/SIGNATAIRE.md`).

| Commande | Résultat | Attendu |
|---|---|---|
| `node fonda/scripts/signer-cloture.js --diagnostic` | `{ initialise: true, n8n: true, drive: true, git: true, registre: true }` | tout à `true` (**acces_ok**) |
| `node fonda/scripts/signer-cloture.js --diagnostic set_fonda_nombres-fractions-relatifs_nI_01` | `{ etat: "aucune_generation", detail: true }` | `aucune_generation` |

Secrets en place dans `~/.fonda-cles/` (hors dépôt, jamais affichés) :
- `n8n-signataire.cle` : clé d'API n8n, utilisée en lecture ;
- `drive-compte-service.json` : compte de service **dédié** au signataire, portée `drive.readonly`, partagé en **lecteur** sur le dossier candidats (`1Ir-iJGZoSk5_FmJ9dnf_PM-NEBZWyn8d`).

Cette recette prouve l'**accès** du signataire (n8n, Drive, git, registre des incidents initialisé). Elle **ne remplace pas** le bloc ci-dessous, qui consigne la **conservation des exécutions** : réglages du workflow (a) et purge automatique désactivée (b).

## Bloc de CONSIGNATION (à remplir AVANT le premier vrai run)

```
Date de vérification (avec fuseau) : (a) 2026-10-22 (Europe/Paris, heure non relevée) ; (b) 2026-10-22 ~14:17 (Europe/Paris, vacances : aucun usage BOX)
Vérifié par                        : (a) Éric (observation seule, rien modifié) ; (b) Éric, sur le VPS srv868991

(a) Workflow vrqgtS5kQMvP9Ok5 — valeurs OBSERVÉES dans Settings          [CONSIGNÉ, conforme]
  Save failed production executions     : Save   (= saveDataErrorExecution: all)
  Save successful production executions : Save   (= saveDataSuccessExecution: all)
  Save manual executions                : Save   (= saveManualExecutions: true)
  Save execution progress               : Save   (= saveExecutionProgress: true)
  Actif ?                               : Inactive (attendu : Inactive jusqu'à la fenêtre du lot 8)

(b) Instance — identification (b1)                                       [CONSIGNÉ]
  Projet / service n8n / service base   : root / n8n / aucun (SQLite sur le volume n8n)
  Dossier de travail                    : /root
  Fichier(s) Compose (ordre)            : /root/docker-compose.yml
  Fichier(s) d'environnement            : .env par défaut (auto-chargé)
  Contexte = production (b2.0) ?        : oui — aucune variable injectée hors Compose (N8N_HOST/PORT/PROTOCOL,
                                          NODE_ENV, WEBHOOK_URL, GENERIC_TIMEZONE + défauts Docker) ;
                                          N8N_ENCRYPTION_KEY absente de l'environnement (clé sur le volume)
  ID conteneur n8n AVANT                : a35b5a6c…
  ImageID AVANT (sha256)                : sha256:5fd65c3d…c22e12
  printenv AVANT                        : vide (variable non définie → purge ACTIVE par défaut : NON conforme)
  Montage /home/node/.n8n (b1.4)        : volume → n8n_data
  Montage données base (b1.4)           : sans base (SQLite sur le volume n8n_data)

  [ ] DÉJÀ CONFORME (printenv AVANT = false) → recréation inutile ; champs ci-dessous : « sans objet »
      → non : recréation effectuée (ci-dessous)

(b) Instance — recréation (b2 à b4)                                      [CONSIGNÉ]
  Modification                          : ajout de « - EXECUTIONS_DATA_PRUNE=false » au service n8n
                                          de /root/docker-compose.yml
  Valeur initiale si variable existante : absente
  Copies exactes .avant-prune-*         : docker-compose.yml.avant-prune-20261022 + .env.avant-prune-20261022
  Instantané VPS (heure)                : snapshot hPanel pris avant l'opération (heure non relevée)
  diff compose-avant / apres : 1 seule ligne (service n8n) ? oui — diff -U0 de « docker compose config »
                                          avant/après = un seul ajout EXECUTIONS_DATA_PRUNE: "false"
  Image figée (b2.5) ImageID identique ? oui — « config --images » = docker.n8n.io/n8nio/n8n, sha256:5fd65c3d…c22e12
  Recréé le (heure, fuseau)             : 2026-10-22 ~14:17 Europe/Paris (up -d --no-deps --no-build --pull never n8n)
  ID conteneur n8n APRÈS                : d9d9106c… (≠ AVANT : oui)
  ImageID APRÈS = AVANT                 : oui (sha256:5fd65c3d…c22e12)
  printenv APRÈS                        : false
  EXECUTIONS_DATA_MAX_AGE / PRUNE_MAX_COUNT : sans objet / sans objet (purge désactivée)
  Contrôles BOX : 9 actifs oui (Published / Active) ; pas d'erreur nouvelle oui (n8n OK, aucune exécution
                  pendant l'opération ; workflows FONDA inactifs) ; catalogue répond : oui (site élève : toutes les fiches s'affichent, 2026-10-22)
  Retour arrière effectué ?             : non

(b5) Capacité au moment de l'opération  : 12,8 % de 47 Go (purge désactivée pour TOUTE l'instance :
                                          surveillance mensuelle selon (b5))

Conclusion (cocher)       : [x] conforme  [ ] non conforme → pas de vrai run
```
