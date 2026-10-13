# BOX / Box-FONDA — État d'avancement

> Historique détaillé (incidents, tickets T1–T6, relectures Codex, preuves) : `AVANCEMENT-archive.md`.

## Objectif
Box-FONDA : extension « savoirs fondamentaux » de BOX (défis courts, correction par profil, mesure par groupe, fiches générées puis relues par un humain), sans casser BOX. Dépôt AAP CARDIE-SEPIA, échéance **21/10/2026**. Source de vérité : `docs/PRD-Box-FONDA.md` ; règles : `AGENTS.md`.

## État actuel (design = `bc50157`, main intact `7ea4f28`)
- **BOX prod** : 9 workflows n8n actifs, Google Form + Tally opérationnels, relecture carte par carte (`/box-select`), front `https://ericduchateau.github.io/box/` (branche `main`).
- **FONDA sur `design`** (PR #1 à #5 mergées) : thème sombre + switch ; correction par profil ; rendu réel (`lancerDefi` -> `carte-reponse-produite.js`) ; index `?fonda=1&page=entrainement` des **8 lots relus** (4 notions × nI/nF, 48 cartes) ; G4 = liste fermée `LOTS_PUBLIABLES` + `revue_carte_par_carte === true` vérifié au rendu ; pages top-alignées ; écran de suppression BOX inaccessible en FONDA.
- Lots servis **depuis le dépôt** (`fonda/data/lots-fonda-calibration/`), pas depuis Drive. Rien de FONDA publié au catalogue.
- Tests : `node --test` 442/442, 1 skip (test `non-regression` index.html-vs-design en quarantaine). Smoke-test navigateur réel obligatoire avant chaque merge.

## Prochaines étapes
1. **Chantier « secrets hors du dépôt »** (`feat/box-fonda-secrets`). Plan critiqué par Codex le 2026-10-13 (4 bloquants : `/box-delete` accepte un code absent, `prof_email` lu depuis Drive par Selection/Question élève, corbeille ≠ révocation, test « inactif » non isolé). **Phase 1 (durcir n8n, copies de test) produite** dans `n8n/secrets-2026-10-13/` : FONDA-generation prête ; `/box-delete` prêt (généré depuis l'export frais du live, identique au 05/10). Mode d'emploi : README du dossier. Phase 2 = nettoyage du dépôt.
2. **Décider l'affichage des lots FONDA publiés** : un `?set=` FONDA s'affiche aujourd'hui en flip-cards BOX (`loadAndReview` ignore les champs FONDA). Options : exclure les lots FONDA du catalogue ordinaire, ou rediriger leur `?set=` vers le rendu FONDA.
3. Puis publication des 8 lots (upload `box-fonda-generation` + relecture `/box-select`).
4. Moteur A (calendrier) : brancher le `setId` du calendrier dans `lancerDefi()` (aujourd'hui choisi par notion+palier) ; émission réelle des événements (T3/T5) depuis `onResultat`.

## 🔖 Check-list AVANT PUBLICATION / usage élève réel
1. **Régénérer la clé API Anthropic** (a circulé en clair) : scripts locaux + nœud `Claude API` (HTTP, header en clair) de `BOX - Generation Flashcards` ; idéalement passer par un credential n8n.
2. **Secrets commités** : les 16 lots contiennent `code_suppression` + `prof_email` en clair (dépôt public) ; `box-fonda-generation` recopie le code du JSON -> générer le code côté n8n à la publication, retirer les champs des fichiers, test anti-retour. Historique Git inerte dès que les codes publiés sont neufs (`/box-delete` vérifie contre le fichier Drive).
3. **Adresse réelle de la relectrice de français** : dans n8n uniquement, **jamais** dans `fonda/data/destinataires.json` (dépôt public).
4. **Orpheline `box_7e7tcooh`** au catalogue Drive (fichier déjà en corbeille) : la retirer via `/box-delete` (code connu) ou à la main après sauvegarde du catalogue — feu vert Éric requis.
5. **Fidélité du banc de test** : contexte navigateur unique (vm partagé), parcours depuis `App.initFonda()` — à prioriser avant d'élargir FONDA à d'autres notions.
6. **Correcteur tolérant au mot après le nombre** (« 2 bus » noté faux sans `unite` ; avec `unite`, le nombre seul donne « presque, unité oubliée »).

## Autres dettes (non bloquantes)
- Route `?action=delete` (BOX clair) reste publique — normal : seul le code protège.
- Liens Valider/Rejeter anciens = GET (un aperçu de lien peut les déclencher) ; jeton HMAC sans expiration ni lien au contenu relu.
- QR code de la page niveau non fait (lien + copier seulement) ; favicon/lockup complet FONDA absents.
- Test `non-regression.test.js` en quarantaine : comparer à `main` plutôt qu'à `design`.

## Décisions clés (pourquoi)
- `main` = prod, jamais touché ; `design` = intégration ; une branche + une PR par chantier, merge par Éric.
- n8n prod : aucun changement sans validation explicite ; workflows livrés en JSON à importer, testés inactifs.
- Relecteur affiché **lu dans la donnée**, jamais déduit de la matière (badge = affirmation G4).
- Publication FONDA mise en pause tant que l'affichage FONDA d'un lot publié n'est pas réglé.

## Pièges
- Chrome met `css/style.css` en cache : désactiver le cache pour toute preuve visuelle ; figer `Math.random` (sinon deux captures du même état BOX diffèrent).
- Scripts injectés dynamiquement : ordre garanti par `await` séquentiel, preuve de chargement = export sur `window`.
- `fonda/data/calendar.json` a `semaines: []` : « Aucun défi programmé » est l'état réel, pas un bug.
- Profil `orthographe` : ne jamais normaliser accents/pluriels (c'est ce qu'on mesure).
- Le classificateur auto-mode bloque les commandes contenant la clé API : Éric lance lui-même les générations.

_Dernière mise à jour : 2026-10-12 — Claude Code (Opus 5.5)._
