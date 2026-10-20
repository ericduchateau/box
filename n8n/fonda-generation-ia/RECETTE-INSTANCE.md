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
1. Identifier le conteneur n8n et son projet Compose :
   `docker ps --format '{{.Names}}  {{.Image}}  {{.Label "com.docker.compose.project"}}  {{.Label "com.docker.compose.project.working_dir"}}  {{.Label "com.docker.compose.project.config_files"}}'`
   Noter : **nom du conteneur**, **image (avec sa version)**, **projet**, **dossier de travail**, **fichier(s) Compose**.
2. Lire la valeur effective : `docker exec <conteneur n8n> printenv EXECUTIONS_DATA_PRUNE`.
   - Résultat **exactement `false`** → **déjà conforme** : **aucune recréation**. Passer directement à la consignation (« déjà conforme, recréation inutile »).
   - Autre valeur, ou rien → continuer.
3. Vérifier où vivent les données n8n : `docker inspect <conteneur n8n> --format '{{json .Mounts}}'`. Un **volume** ou un **dossier monté** doit contenir `/home/node/.n8n`, et la base Postgres doit être dans son propre volume si elle est utilisée. **Si les données ne sont pas sur un volume : ARRÊT**, ne rien recréer, prévenir Claude (la recréation effacerait les données).

### (b2) Préparer (sans interruption)
1. **Sauvegarde restaurable** : un instantané du VPS dans hPanel (**Snapshots / Backups**) **et** un export des workflows, déjà disponible : `n8n/backup-2026-10-05/` du dépôt, à rafraîchir si besoin. Noter l'heure de l'instantané.
2. Dans le **fichier Compose noté en (b1)**, sous le service n8n, bloc **`environment:`**, ajouter :
   ```yaml
       environment:
         - EXECUTIONS_DATA_PRUNE=false
   ```
   (ou `EXECUTIONS_DATA_PRUNE: "false"` si le bloc est en forme clé: valeur). **Écrire la variable dans un `.env` ne suffit pas** : il ne l'injecte dans le conteneur que si le Compose la référence (`env_file:` ou `${EXECUTIONS_DATA_PRUNE}` sous `environment:`).
3. **Vérifier que SEULE cette variable change** :
   `docker compose -p <projet> -f <fichier(s) Compose> config | grep -n EXECUTIONS_DATA_PRUNE`
   La ligne doit apparaître. Ne **pas** modifier l'image, les volumes ni les ports. Ne lancer **aucun** `pull`.
4. **Avant l'arrêt** : dans n8n, menu **Executions**, vérifier qu'**aucune exécution BOX n'est en cours** (`Running`). En cas d'exécution en cours, attendre sa fin.

### (b3) Recréer (heures creuses, interruption de quelques secondes à une minute)
Un **Restart** (bouton, ou `docker compose restart`) **ne recharge pas** l'environnement. Dans hPanel, le bouton **Update** du projet n8n peut **aussi mettre à jour l'image**, ce qui n'est pas ce que l'on veut : **ne pas l'utiliser** pour cette opération.

Depuis le terminal du VPS, en ciblant **le seul service n8n** avec le **même** projet et les **mêmes** fichiers Compose :

`docker compose -p <projet> -f <fichier(s) Compose> up -d --no-deps <service n8n>`

`--no-deps` évite de recréer les autres services (Postgres…). Compose ne recrée que si la configuration effective a changé.

### (b4) Contrôler
1. `docker ps` : noter le **nouvel identifiant** du conteneur n8n (il doit différer de celui d'avant) et **la même image** qu'en (b1).
2. `docker exec <conteneur n8n> printenv EXECUTIONS_DATA_PRUNE` → **exactement `false`**.
   - **Sinon : recette NON CONFORME.** Ne pas recréer à nouveau à l'aveugle. Vérifier la cible (bon conteneur ?) et la configuration effective (`docker compose … config`) avant toute nouvelle tentative, avec Claude.
3. **Production BOX** :
   - les 9 workflows BOX attendus sont toujours **Active** (n8n → Workflows) ;
   - le menu Executions ne montre aucune erreur nouvelle depuis le redémarrage ;
   - le catalogue élève répond réellement (ouvrir `https://ericduchateau.github.io/box/`) ;
   - si possible, une fiche s'ouvre (`/box-set`).
4. **En cas d'échec d'un contrôle BOX** : retirer la ligne ajoutée, puis recréer avec la même commande (retour à l'état antérieur). Si l'échec persiste, **restaurer l'instantané** de (b2).

### (b5) Surveillance de capacité (responsable : Éric)
- Une fois par mois : `df -h` (disque du VPS) et la taille du volume de données n8n (`docker system df -v`, ligne du volume n8n). On consigne la date et les valeurs dans le carnet d'exploitation.
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

(b) Instance
  Projet Compose / service n8n          : __________ / __________
  Fichier(s) Compose                    : __________
  Données sur volume (b1.3) ?           : oui / non (non → ARRÊT)
  printenv AVANT                        : __________
  [ ] déjà conforme (false) — recréation inutile
  Instantané VPS (heure)                : __________
  Conteneur : id AVANT → id APRÈS        : __________ → __________
  Image AVANT = image APRÈS              : __________ (identique ? oui / non)
  Recréé le (heure, fuseau)             : __________ (commande up -d --no-deps, pas Restart ni Update)
  printenv APRÈS                        : __________ (attendu : exactement false)
  EXECUTIONS_DATA_MAX_AGE / PRUNE_MAX_COUNT : __________ / __________
  Contrôles BOX après recréation        : 9 workflows actifs oui/non ; pas d'erreur nouvelle oui/non ; catalogue répond oui/non

Conclusion (cocher)       : [ ] conforme  [ ] non conforme → pas de vrai run
```
