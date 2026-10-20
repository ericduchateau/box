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

Réglages exacts :
- `EXECUTIONS_DATA_PRUNE=false` : **réglage requis**, il désactive la purge ;
- `EXECUTIONS_DATA_MAX_AGE` et `EXECUTIONS_DATA_PRUNE_MAX_COUNT` deviennent alors sans effet. Les noter quand même.

Clic par clic (Hostinger VPS, n8n en Docker) :
1. `https://hpanel.hostinger.com` → **VPS** → le serveur n8n → **Docker Manager** (ou **Terminal**).
2. Ouvrir le projet n8n → **Environment** / fichier `docker-compose.yml` (ou `.env`) du service `n8n`.
3. Chercher `EXECUTIONS_DATA_PRUNE` :
   - absente → la purge est **ACTIVE** (défaut) : l'ajouter avec la valeur `false` ;
   - présente à `true` → la passer à `false`.
4. **Recréer** le conteneur n8n, **en heures creuses**, car il interrompt brièvement la production BOX. Un simple **Restart** (`docker compose restart`, ou le bouton Restart) **ne recharge PAS** l'environnement modifié : le conteneur repart avec ses anciennes variables.
   - Docker Manager de Hostinger : bouton **Redeploy** (ou « Recreate ») du projet n8n ;
   - Terminal : depuis le dossier du projet (celui qui contient `docker-compose.yml`), lancer `docker compose up -d`, qui recrée les conteneurs dont la configuration a changé.

   Les workflows actifs de production BOX reprennent seuls. Vérifier ensuite qu'un webhook BOX répond (ouvrir le catalogue élève).
5. Contrôler dans le **Terminal** **après** la recréation : `docker exec <conteneur n8n> printenv | grep EXECUTIONS_DATA`. La sortie doit contenir `EXECUTIONS_DATA_PRUNE=false`. Si la valeur n'apparaît pas, le conteneur n'a pas été recréé : refaire l'étape 4, sans jamais se contenter d'un Restart.

> Point à confirmer : le menu exact de hPanel dépend du modèle d'installation choisi chez Hostinger (modèle « n8n » Docker ou installation manuelle). Le nom des variables, lui, est celui de la documentation n8n (« Execution data » dans les variables d'environnement).

## Bloc de CONSIGNATION (à remplir AVANT le premier vrai run)

```
Date de vérification      : ____-__-__
Vérifié par               : ______________________

(a) Workflow vrqgtS5kQMvP9Ok5 — valeurs OBSERVÉES dans Settings
  Save failed production executions     : __________
  Save successful production executions : __________
  Save manual executions                : __________
  Save execution progress               : __________
  Actif ?                               : __________ (attendu : Inactive jusqu'à §20.8)

(b) Instance — valeurs OBSERVÉES (printenv)
  EXECUTIONS_DATA_PRUNE                 : __________ (attendu : false)
  EXECUTIONS_DATA_MAX_AGE               : __________
  EXECUTIONS_DATA_PRUNE_MAX_COUNT       : __________
  Conteneur RECRÉÉ le (pas un restart)  : __________
  Webhooks BOX vérifiés après redémarrage : oui / non

Conclusion (cocher)       : [ ] conforme  [ ] non conforme → pas de vrai run
```
