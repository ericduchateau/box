# Chantier « secrets hors du dépôt » — Phase 1 : durcir n8n (sur copies de test)

> **Règle absolue** : les copies `test/` sont importées et exécutées en manuel **d'abord**. Les versions `prod/` ne sont importées **qu'avec le feu vert explicite d'Éric**, après des tests concluants. Rien du live n'est modifié par ce dossier. `main` n'est pas touché.

Ce dossier fait partie de la **check-list avant publication** (même famille que la régénération de la clé API Anthropic). Phase 2, plus tard : nettoyage du dépôt (générateur, 16 lots, `destinataires.json`, tests, documentation).

## Ce que corrige la phase 1

| Problème (critique Codex du plan, 2026-10-13) | Correctif | Fichier |
|---|---|---|
| `/box-delete` acceptait un code **absent des deux côtés** (`undefined !== undefined` est faux) | Refus de tout code absent, vide ou mal typé, côté requête **et** côté fichier : 8 à 64 caractères après trim, **sans format imposé** (les anciens `SUP-` + 8 restent valides) | `box-suppression` |
| Un fichier mis à la corbeille garde son code (encore lisible par id) | **Vidage du fichier** (plus de code, de cartes ni d'adresse) **avant** la mise à la corbeille, même motif que T-SEC pour le rejet | `box-suppression` |
| Le code venait du JSON commité (dépôt public) | Code **généré par n8n** (nœud natif `Crypto` / `Generate`, hex, 16 → `SUP-` + 16 hex), le code éventuel du JSON collé est **ignoré** | `box-fonda-generation` |
| Retirer `prof_email` des lots casserait la confirmation de relecture et les questions élèves | **Deux contrats** : lot commité **sans** code ni adresse ; fichier Drive **complété par n8n** (code généré + adresse routée par matière) avant l'upload | `box-fonda-generation` |

**Historique des exécutions n8n : conservé intégralement** (décision Éric, 2026-10-13 — réussites et erreurs, précieux pour diagnostiquer). Aucun réglage de conservation n'est modifié, aucune purge. Les codes présents dans l'historique deviennent inertes avec la régénération des codes (phase 2) et la révocation de `box_7e7tcooh`. Mitigation envisagée pour ne plus faire circuler le code de suppression dans les URLs/HTML de relecture : point 10 (jeton de relecture distinct), chiffré à part.

Les JSON sont **générés** par `build.js` (reproductible) et vérifiés par `secrets.test.js`, qui exécute le **vrai JavaScript** des nœuds Code générés (`node --test n8n/secrets-2026-10-13/secrets.test.js`).

## Contenu

```
build.js                         génère test/ et prod/ depuis les sources
secrets.test.js                  tests (node --test)
sources/box-suppression.live.json   export frais du live (2026-10-13 08:48), identique à celui du 05/10
test/box-fonda-generation-TEST.json  prêt
prod/box-fonda-generation.json       prêt
test/box-suppression-TEST.json       prêt
prod/box-suppression.json            prêt (import seulement avec feu vert)
```

**Aucune coordonnée réelle dans ces JSON.** Les placeholders sont remplacés **dans n8n après import**, jamais dans le dépôt :
`__EMAIL_RELECTEUR_FRANCAIS__`, `__EMAIL_RELECTEUR_MATHS__`, `__EMAIL_TEST__`, `__DOSSIER_DRIVE_TEST__`, `__CATALOGUE_TEST_ID__`. Le workflow FONDA **refuse d'envoyer** tant qu'un placeholder d'adresse reste.

---

## Mode d'emploi (dans cet ordre)

### Étape 0 — Export frais de `/box-delete` (fait)
Dans n8n : ouvrir **BOX - Suppression** → menu ⋯ → **Download** → enregistrer sous `n8n/secrets-2026-10-13/sources/box-suppression.live.json`. Puis `node n8n/secrets-2026-10-13/build.js` et `node --test n8n/secrets-2026-10-13/secrets.test.js` (fait le 2026-10-13). Le build **échoue volontairement** si la structure du live diffère de celle attendue (nœuds ou branche introuvables).

### Étape 1 — Copies de test
Prérequis : le catalogue de test et `/box-select-test` de T-SEC (`n8n/t-sec-2026-10-06/test/`) sont toujours importés ; sinon, les réimporter d'abord.

**`test/box-suppression-TEST.json`** (webhook `/box-delete-test`)
1. Import → remplacer `__CATALOGUE_TEST_ID__` (nœud `Download Catalogue` + URL de `MAJ Catalogue`) par l'id du `catalogue-TEST.json`. Vérifier les credentials. Activer **cette copie seulement** (webhook de test).
2. Préparer dans le catalogue de test une entrée `box_test_supp` pointant vers un fichier de test contenant `"code_suppression": "SUP-TEST1234"`.
3. Envoyer des POST sur `/box-delete-test` et vérifier :
   - `{"set_id":"box_test_supp"}` (code absent) → **403** ;
   - `{"set_id":"box_test_supp","code_suppression":""}` → **403** ;
   - `{"set_id":"box_test_supp","code_suppression":12345678}` → **403** ;
   - mauvais code → **403** ;
   - bon code → **200** ; le fichier est **vidé** (ouvrir la version en corbeille : `cartes: []`, plus de `code_suppression`) puis en corbeille ; l'entrée a disparu du catalogue de test.
4. Bonus : une entrée dont le fichier n'a **pas** de `code_suppression` + requête sans code → **403** (c'était accepté avant).

**`test/box-fonda-generation-TEST.json`** (déclenchement manuel)
1. Import → remplacer `__DOSSIER_DRIVE_TEST__` (nœud `Upload Flashcards`) par un dossier Drive de test, et `__EMAIL_TEST__` (nœud `Preparer fichier et destinataire`) par ta propre adresse. Laisser inactif.
2. Coller un lot (ex. `fr-comprendre-consigne_nI.json`, **même avec** son ancien code : il doit être ignoré) → *Test workflow*.
3. Vérifier : le fichier Drive de test contient `code_suppression` = `SUP-` + 16 caractères hex **différent** de celui du JSON collé, et `prof_email` = l'adresse de test ; le mail `[TEST]` contient **ce même code** et un lien `/box-select-test`.
4. Optionnel : ouvrir le lien `/box-select-test` → la relecture fonctionne (catalogue de test).

### Étape 2 — Prod (UNIQUEMENT avec feu vert explicite d'Éric)
- `prod/box-suppression.json` : import **par-dessus** `BOX - Suppression` (même id, même webhook `/box-delete`). Retester un mauvais code et un code absent en prod → 403. La suppression d'un jeu BOX existant (ancien code `SUP-` + 8) doit continuer de fonctionner.
- `prod/box-fonda-generation.json` : import (reste **inactif**), remplacer `__EMAIL_RELECTEUR_FRANCAIS__` et `__EMAIL_RELECTEUR_MATHS__` dans n8n. Aucune distribution réelle avant la fin de la check-list avant publication.
- Supprimer ensuite les copies `(TEST secrets 2026-10-13)` de n8n.

## Ce que la phase 1 ne fait PAS (phases suivantes)
- Nettoyage du dépôt : générateur sans code ni adresse, retrait des champs des 16 lots, `destinataires.json` sans adresses, test anti-retour étendu aux scripts, à la documentation et aux exports n8n.
- Régénération + révocation de la clé Anthropic (**Flashcards ET Tally** utilisent `x-api-key`).
- Inventaire et révocation des codes déjà sortis (dont `box_7e7tcooh`).
- Option : séparer jeton de relecture et code de suppression (aujourd'hui, un lien de relecture divulgué donne aussi le pouvoir de supprimer).
