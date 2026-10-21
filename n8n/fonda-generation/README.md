# BOX-FONDA — Generation (distribution d'un lot calibré)

Workflow n8n livré **inactif**, à importer manuellement. Il ne touche **aucun** workflow de production existant et n'appelle **jamais** l'API Claude (le travail de génération + validation est déjà fait en amont par `fonda/scripts/generer-lot-fonda.js`, en local).

## Ce que fait ce workflow (et seulement ça)

1. Tu colles le JSON d'un lot déjà généré et validé (ex. `fonda/data/lots-fonda-calibration/maths-proportionnalite_nI.json`).
2. Le workflow dépose ce fichier sur Google Drive (même dossier `BOX-Flashcards` que les autres jeux de fiches).
3. Il envoie un email de relecture au bon relecteur, avec aperçu des cartes et lien `/box-select` — exactement le même mécanisme de relecture carte par carte que pour BOX ordinaire (G4).

Aucune carte n'est créée, modifiée ou validée automatiquement ici. Rien n'est publié sans passer par `/box-select` (relecture humaine).

## Import

1. Dans n8n, **Workflows → Import from File**, sélectionner `box-fonda-generation.json`.
2. Le workflow s'importe **inactif** — le laisser ainsi (déclenchement manuel uniquement, pas de webhook).
3. Vérifier que les 2 credentials existantes sont bien reconnues à l'import (sinon les réassigner manuellement, elles existent déjà dans ton instance n8n) :
   - `Google Drive la bonne!` (nœud "Upload Flashcards")
   - `Gmail n8n iazimut2026` (nœud "Email Validation")

## Utilisation (à chaque lot à distribuer)

1. Génère un lot en local : `ANTHROPIC_API_KEY=... node fonda/scripts/generer-lot-fonda.js <notion_id> --n=6`
2. Ouvre le fichier produit dans `fonda/data/lots-fonda-calibration/` (ou le futur dossier de production), copie **tout son contenu**.
3. Dans n8n, ouvre le workflow, double-clique le nœud **"Coller lot FONDA"**, remplace le contenu du champ `lot_json` par le JSON copié (le contenu par défaut `_INSTRUCTION` est un placeholder, il doit disparaître entièrement).
4. Clique **"Test workflow"** (déclenchement manuel) en haut à gauche.
5. Vérifie :
   - Sur Google Drive, dossier `BOX-Flashcards` : un nouveau fichier `{id}.json` est apparu.
   - Dans la boîte mail du relecteur routé (voir ci-dessous), un email "BOX-FONDA - Fiches ... à valider" est arrivé, avec le lien de relecture.
6. Le relecteur (toi ou Justine) clique le lien, relit carte par carte via `/box-select`, comme pour BOX ordinaire.

## Routage du relecteur — important

Le nœud **"Preparer fichier et destinataire"** route l'email **uniquement d'après le champ `matiere`** du JSON collé (`français` → Justine, `maths`/`mathématiques` → Éric), **jamais** d'après un champ `prof_email` qui serait présent dans le JSON. C'est volontaire : même si le fichier produit par le script a déjà la bonne adresse, on ne fait pas confiance à un JSON collé à la main — un copier-coller partiel ou une édition manuelle ne pourrait jamais rediriger l'email vers une adresse inattendue.

**Adresse Justine actuelle : `ericdnews@yahoo.fr` (adresse de TEST).** C'est volontaire tant que le dispositif n'est pas en service réel — voir `fonda/data/destinataires.json` et `AVANCEMENT.md` (section T6b). Pour passer en production réelle, remplacer le literal dans le nœud "Preparer fichier et destinataire" (fonction `routerEmail`) par la vraie adresse de Justine.

## Sécurité — injection HTML

Le nœud "Preparer Email Validation" échappe (`escapeHtml`) tous les champs du lot avant de les insérer dans l'email (question, réponse, numéro, matière, niveau, notion, id, code de suppression) — repris à l'identique de la version post-T-SEC du workflow `BOX - Generation Flashcards`. C'est particulièrement important ici : les cartes viennent d'un modèle, donc potentiellement de texte non maîtrisé.

## Ce que ce workflow n'est PAS

- Pas un remplaçant du script local — il ne génère ni ne valide aucune carte, il ne fait que déposer et notifier.
- Pas un déclenchement automatique — aucun webhook, aucun cron. Chaque lot est distribué à la main, un à la fois.
- Pas une modification de `BOX - Generation Flashcards` ni d'aucun autre workflow prod — fichier séparé, jamais importé par-dessus un workflow existant.
