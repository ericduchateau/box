# BOX-FONDA — Collecte des événements (T5)

Workflow n8n **livré inactif**. Il n'a été ni créé, ni importé, ni activé dans l'instance n8n par l'IA — conformément à la règle n8n-production d'`AGENTS.md`. **L'activation est un geste d'Éric**, après les tests ci-dessous.

Ce workflow ne touche à aucun des 9 workflows existants : nouveau chemin de webhook (`/box-fonda-events`, préfixe `/box-…`, aucune collision — vérifié), aucune référence à un fichier Drive, credential ou node des 9 workflows de prod.

## Ce que fait ce workflow

`POST /box-fonda-events` → valide le corps (liste blanche stricte des 11 champs du schéma PRD §3.2, rien d'autre toléré) → ajoute une ligne au Google Sheet BOX-FONDA → répond `{success: true}`. Rien d'autre : pas de tableau de bord, pas de calcul, pas de génération.

**Anonymat (G3)** :
- Le workflow ne lit ni n'écrit jamais l'adresse IP de l'appelant, ne s'en sert pas pour dédoublonner.
- Aucune colonne autre que les 11 champs du schéma, plus **une seule** colonne additionnelle optionnelle : `recu_serveur_ts` (horodatage de réception côté serveur — utile pour détecter un décalage d'horloge client, ce n'est pas une donnée d'élève).
- Les réponses d'erreur ne renvoient jamais les valeurs reçues, seulement des noms de champs/compteurs génériques.
- **Point à vérifier par toi (DPD/DANE)** : par défaut, n8n peut conserver le détail des exécutions (donc le corps de chaque requête, y compris le contenu que ce workflow lui-même ne stocke pas ailleurs) dans ses propres journaux d'exécution. Ce workflow n'a aucun contrôle sur cette rétention — c'est un réglage d'instance n8n (Settings → Workflow executions / Log streaming). À vérifier/ajuster sur ton instance Hostinger avant une collecte réelle à grande échelle ; à mentionner si un DPD/DANE académique est consulté sur Box-FONDA (déjà noté comme hors-code dans `AGENTS.md`/PRD §16).

## Procédure d'import — pas à pas

**1. Créer le Google Sheet BOX-FONDA**
Un nouveau Sheet, avec une feuille nommée `Evenements` et ces 12 en-têtes en ligne 1, dans cet ordre exact :
```
ts | grp | defi_id | notion_id | palier | set_id | item_id | result | ctx | rang_local | dt_jours | recu_serveur_ts
```
(Les 11 premières colonnes = schéma PRD §3.2. La 12ᵉ = horodatage serveur, voir ci-dessus.)

**2. Importer le JSON**
Dans n8n : *Workflows → Add workflow → Import from File* → sélectionner `n8n/fonda-collecte/box-fonda-events.json`. Le workflow importé est **inactif** (`active: false`) — c'est l'état attendu, ne pas l'activer à cette étape.

**3. Renseigner la configuration**
Deux choses à régler dans le workflow importé, chacune marquée `CONFIGURER` dans ses notes :
- Node **Config** : renseigner `sheet_id` (l'ID du Sheet créé à l'étape 1, dans son URL entre `/d/` et `/edit`). C'est le **seul** endroit où l'ID est saisi — le node Google Sheets le relit via une expression (`{{ $('Config').item.json.sheet_id }}`), jamais en dur ailleurs.
- Node **Ajouter ligne Sheet** : attacher un credential Google Sheets OAuth2 (à créer si tu n'en as pas déjà un — distinct du credential Google Drive utilisé par les autres workflows BOX, même si c'est le même compte Google).
- Vérifier aussi `allowedOrigins` sur le node **Webhook POST** et les en-têtes `Access-Control-Allow-Origin` des 3 nodes de réponse : actuellement `https://ericduchateau.github.io` — à ajuster si l'URL réelle de la page diffère.

**4. Tester en exécution manuelle**
Dans n8n, ouvrir le workflow puis *Test workflow* (bouton en haut), avec un événement **factice** envoyé en POST sur l'URL de test du webhook (affichée par n8n pendant le test), par exemple :
```json
{
  "ts": "2026-10-05T10:00:00Z", "grp": "601", "defi_id": "defi_2026-w41_601_fractions",
  "notion_id": "maths.resolution-problemes", "palier": "nI", "set_id": "box_fonda_test01",
  "item_id": "it01", "result": 1, "ctx": "classe", "rang_local": 1, "dt_jours": null
}
```
Vérifier qu'une ligne arrive bien dans le Sheet avec ces 11 valeurs + un `recu_serveur_ts`. Tester aussi un corps invalide (ex. `ctx` erroné, ou un champ en trop comme `"ip":"1.2.3.4"`) pour confirmer qu'**aucune ligne n'est ajoutée** et que la réponse est `400` avec des erreurs génériques.

**5. Activer — seulement ensuite**
Une fois les deux tests de l'étape 4 concluants : activer le workflow dans n8n (bouton *Active*). C'est la seule étape qui rend le webhook réellement joignable depuis la page GitHub Pages.

## Après activation

L'URL réelle du webhook (`https://n8n.srv868991.hstgr.cloud/webhook/box-fonda-events`) doit être transmise à l'émetteur côté navigateur (`fonda/engine/emission.js`, livré en T5) via son paramètre `webhookUrl` — câblage non fait dans ce ticket (voir `fonda/engine/README.md`, section émission : tant qu'aucune URL n'est fournie, l'émetteur reste en mode dégradé, la file locale s'accumule sans bloquer la révision).
