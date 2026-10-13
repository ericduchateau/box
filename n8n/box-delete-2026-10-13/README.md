# BOX — Durcissement de `/box-delete` (2026-10-13)

> **Règle absolue** : la copie `test/` est importée et testée **d'abord**. La version `prod/` n'est importée **qu'avec le feu vert explicite d'Éric**. Rien du live n'est modifié par ce dossier. `main` n'est pas touché. Priorité : basse (durcissement BOX, indépendant de FONDA).

Extrait du chantier « secrets hors du dépôt » quand FONDA est devenu une chaîne séparée de BOX (FONDA n'utilise plus `/box-delete`). Le correctif reste utile à **BOX lui-même**.

## Ce qui est corrigé

| Problème (critique Codex, 2026-10-13) | Correctif |
|---|---|
| `/box-delete` acceptait un code **absent des deux côtés** (`undefined !== undefined` est faux) — un fichier sans `code_suppression` était supprimable par une requête sans code | Refus de tout code absent, vide ou mal typé, côté requête **et** côté fichier : 8 à 64 caractères après trim, **sans format imposé** (les anciens `SUP-` + 8 restent valides) |
| Un fichier mis à la corbeille garde son code (encore lisible par id tant qu'il n'est pas purgé) | **Vidage du fichier** (`{id, cartes: [], supprime_le}` — plus de code, de cartes ni d'adresse) **avant** la mise à la corbeille, même motif que T-SEC pour le rejet |

Réglages de conservation des exécutions : **inchangés** (historique complet gardé, décision Éric).

## Contenu

```
build.js                            génère test/ et prod/ depuis l'export live
box-delete.test.js                  tests (node --test) sur le vrai JS du noeud « Verifier code »
sources/box-suppression.live.json   export frais du live (2026-10-13), identique à celui du 05/10
test/box-suppression-TEST.json      copie de test : webhook /box-delete-test, catalogue __CATALOGUE_TEST_ID__
prod/box-suppression.json           même id, même webhook /box-delete (import seulement avec feu vert)
```

Les copies remplies (vrais ids) s'écrivent en `*.local.json`, **jamais versionnés** (`.gitignore`).

## ⚠️ Isolation du test — à régler avant de tester

Le catalogue de test d'octobre (`catalogue-TEST.json`) est une **copie du catalogue de prod du 05/10** : 47 vrais jeux avec leurs vrais `drive_file_id`. La copie `/box-delete-test` appelée avec l'id d'un **vrai** jeu et son **vrai** code mettrait à la corbeille le **vrai fichier**. Avant le test : utiliser un **catalogue de test dédié** ne contenant **que** l'entrée de test (fichier créé pour l'occasion).

## Test (copie de test, une fois l'isolation réglée)

1. Import de la copie remplie, credentials vérifiées (`Google Drive la bonne!` sur les nœuds Drive et HTTP), activation de **cette copie seulement**.
2. Une entrée `box_test_supp` dans le catalogue de test dédié, pointant vers un fichier de test portant `"code_suppression": "SUP-TEST1234"`.
3. `POST /box-delete-test` :
   - code absent, `""`, espaces, `null`, nombre, mauvais code → **403** ;
   - `set_id` inexistant → **404** ;
   - bon code → **200** ; entrée retirée du catalogue de test ; fichier en corbeille **vidé** ;
   - rejeu → **404**.
4. Catalogue de prod inchangé. Désactiver la copie de test.

## Prod (feu vert explicite)

Import de `prod/box-suppression.json` **par-dessus** `BOX - Suppression` (même id, `/box-delete`). Retester un code absent et un mauvais code en prod → 403 ; la suppression d'un jeu existant (ancien code `SUP-` + 8) doit continuer de fonctionner.
