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
   `docker ps --no-trunc --format '{{.ID}}  {{.Names}}  {{.Image}}  {{.Label "com.docker.compose.project"}}  {{.Label "com.docker.compose.service"}}  {{.Label "com.docker.compose.project.working_dir"}}  {{.Label "com.docker.compose.project.config_files"}}'`
   Pour le conteneur n8n, noter : **ID**, **nom**, **projet**, **service**, **dossier de travail** et **fichier(s) Compose** (liste séparée par des virgules, **dans cet ordre**). Noter aussi le **service et le conteneur de la base** (Postgres) s'il y en a un.
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
Toutes les commandes Compose se lancent **depuis le dossier de travail noté**, avec **un `-f` par fichier, dans l'ordre noté**. Abréviation utilisée ensuite :
`DC = docker compose -p <projet> --project-directory <dossier> -f <fichier1> [-f <fichier2> …]`
(Si un `.env` existe dans ce dossier, il est relu automatiquement : ne pas le déplacer.)

1. **Sauvegardes** :
   - (i) **copie exacte** de chaque fichier Compose (et du `.env` s'il existe) avant édition : `cp -p <fichier> <fichier>.avant-prune-AAAAMMJJ` ;
   - (ii) **instantané du VPS** dans hPanel (Snapshots / Backups), heure notée. C'est un **recours ultime avec perte possible** : le restaurer effacerait toutes les écritures (BOX comprises) faites depuis sa prise. Ce n'est pas un retour arrière ordinaire.
2. **Configuration résolue AVANT** (fichier local, jamais publié : elle contient des secrets) : `$DC config > /root/compose-avant.yml`.
3. **Éditer** le fichier Compose : sous le service n8n, bloc `environment:`,
   - si `EXECUTIONS_DATA_PRUNE` **n'existe pas** → **ajouter** `- EXECUTIONS_DATA_PRUNE=false` (ou `EXECUTIONS_DATA_PRUNE: "false"` en forme clé: valeur) ;
   - si elle **existe** → **remplacer sa valeur** par `false` et **noter la valeur initiale**.

   Une variable écrite dans le `.env` ne suffit pas : elle n'entre dans le conteneur que si le Compose la référence (`env_file:` ou `${…}` sous `environment:`).
4. **Démontrer que SEULE cette variable change** : `$DC config > /root/compose-apres.yml && diff -u /root/compose-avant.yml /root/compose-apres.yml`.
   Le diff doit contenir **une seule** modification, **dans le bloc du service n8n**, sur `EXECUTIONS_DATA_PRUNE`, avec la valeur `"false"`. Toute autre ligne différente : **ARRÊT**, restaurer la copie (i), prévenir Claude.
5. **Image figée** : `$DC config --images` doit citer pour n8n la même référence que la colonne IMAGE de (b1), et `docker image inspect <cette référence> --format '{{.Id}}'` doit être **égal à ImageID AVANT**. Sinon (le tag local désigne désormais une autre image) : **ARRÊT**.
6. **Avant l'arrêt** : n8n → menu **Executions** : aucune exécution BOX `Running`. Sinon, attendre.

### (b3) Recréer (heures creuses, quelques secondes à une minute d'interruption)
Un **Restart** (bouton, ou `docker compose restart`) **ne recharge pas** l'environnement. Le bouton **Update** de hPanel peut **mettre à jour l'image** : **ne pas l'utiliser**.

`$DC up -d --no-deps --no-build --pull never <service n8n>`

- `--no-deps` : la base et les autres services ne sont pas recréés.
- `--pull never --no-build` : aucun téléchargement ni aucune construction d'image (cela empêche un changement d'image mais ne le prouve pas : d'où le contrôle (b4.1)).

### (b4) Contrôler
1. `docker ps --no-trunc` : **nouvel ID** du conteneur n8n (≠ ID AVANT). Puis `docker inspect <nouvel ID> --format '{{.Image}}'` = **ImageID AVANT** (identité réelle).
2. `docker exec <nouvel ID> printenv EXECUTIONS_DATA_PRUNE` → **exactement `false`**.
   - **Sinon : recette NON CONFORME.** Ne pas recréer à nouveau à l'aveugle : vérifier la cible et `$DC config` avec Claude.
3. **Production BOX** :
   - les 9 workflows BOX attendus sont **Active** ;
   - le menu Executions ne montre aucune erreur nouvelle depuis la recréation ;
   - le catalogue élève répond réellement (`https://ericduchateau.github.io/box/`) ;
   - si possible, une fiche s'ouvre.
4. **Retour arrière exact** en cas d'échec d'un contrôle BOX :
   1. restaurer la **copie exacte** (b2.1-i) du ou des fichiers Compose (`cp -p <fichier>.avant-prune-AAAAMMJJ <fichier>`) ;
   2. vérifier que `$DC config` est identique à `/root/compose-avant.yml` ;
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

## Bloc de CONSIGNATION (à remplir AVANT le premier vrai run)

```
Date de vérification (avec fuseau) : ____-__-__ __:__ (Europe/Paris)
Vérifié par                        : ______________________

(a) Workflow vrqgtS5kQMvP9Ok5 — valeurs OBSERVÉES dans Settings
  Save failed production executions     : __________
  Save successful production executions : __________
  Save manual executions                : __________
  Save execution progress               : __________
  Actif ?                               : __________ (attendu : Inactive jusqu'à §20.8)

(b) Instance — identification (b1)
  Projet / service n8n / service base   : __________ / __________ / __________
  Dossier de travail                    : __________
  Fichier(s) Compose (ordre)            : __________
  ID conteneur n8n AVANT                : __________
  ImageID AVANT (sha256)                : __________
  printenv AVANT                        : __________
  Montage /home/node/.n8n (b1.4)        : volume / dossier hôte → __________
  Montage données base (b1.4)           : volume / dossier hôte / sans base → __________

  [ ] DÉJÀ CONFORME (printenv AVANT = false) → recréation inutile ; champs ci-dessous : « sans objet »

(b) Instance — recréation (b2 à b4)       [sans objet si déjà conforme]
  Valeur initiale si variable existante : __________ (ou « absente »)
  Copies exactes .avant-prune-*         : __________
  Instantané VPS (heure)                : __________
  diff compose-avant / apres : 1 seule ligne (service n8n) ? oui / non
  Image figée (b2.5) ImageID identique ? oui / non
  Recréé le (heure, fuseau)             : __________ (up -d --no-deps --no-build --pull never)
  ID conteneur n8n APRÈS                : __________ (≠ AVANT ?)
  ImageID APRÈS = AVANT                 : oui / non
  printenv APRÈS                        : __________ (attendu : exactement false)
  EXECUTIONS_DATA_MAX_AGE / PRUNE_MAX_COUNT : __________ / __________
  Contrôles BOX : 9 actifs oui/non ; pas d'erreur nouvelle oui/non ; catalogue répond oui/non
  Retour arrière effectué ?             : non / oui (préciser)

Conclusion (cocher)       : [ ] conforme  [ ] non conforme → pas de vrai run
```
