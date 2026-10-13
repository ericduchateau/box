# BOX / Box-FONDA — État d'avancement

> Historique détaillé (incidents, tickets T1–T6, relectures Codex, preuves) : `AVANCEMENT-archive.md`.

## Objectif
Box-FONDA : extension « savoirs fondamentaux » de BOX (défis courts, correction par profil, mesure par groupe, fiches générées puis relues par un humain), sans casser BOX. Dépôt AAP CARDIE-SEPIA, échéance **21/10/2026**. Source de vérité : `docs/PRD-Box-FONDA.md` ; règles : `AGENTS.md`.

## État actuel (design = `bc50157`, main intact `7ea4f28`)
- **BOX prod** : 9 workflows n8n actifs, Google Form + Tally opérationnels, relecture carte par carte (`/box-select`), front `https://ericduchateau.github.io/box/` (branche `main`).
- **FONDA sur `design`** (PR #1 à #5 mergées) : thème sombre + switch ; correction par profil ; rendu réel (`lancerDefi` -> `carte-reponse-produite.js`) ; index `?fonda=1&page=entrainement` des **8 lots relus** (4 notions × nI/nF, 48 cartes) ; G4 = liste fermée `LOTS_PUBLIABLES` + `revue_carte_par_carte === true` vérifié au rendu ; pages top-alignées ; écran de suppression BOX inaccessible en FONDA.
- Lots servis **depuis le dépôt** (`fonda/data/lots-fonda-calibration/`), pas depuis Drive. Rien de FONDA publié au catalogue.
- Tests : `node --test` 408/408, 1 skip (test `non-regression` index.html-vs-design en quarantaine). Smoke-test navigateur réel obligatoire avant chaque merge.

## Prochaines étapes
1. **Chaîne FONDA séparée de BOX** (décision 2026-10-13, PRD §2 bis) — branche `feat/box-fonda-lane`.
   - **Bloc 1 (dépôt seul) : fait, PR à relire** — contrats `catalogue-fonda/v1` / `lot-fonda/v1` / `empreinte-fonda/v1` (`fonda/engine/catalogue.js`) ; 8 lots relus migrés vers `fonda/data/lots/<set_id>.json` + `catalogue-fonda.json` (attestation `manuelle-historique` : relu par Éric le 11/10, modif. du 12/10 déclarée pour resolution-problemes) ; secrets retirés des 16 lots ; générateur sans secret, séquence libre ; front re-sourcé (empreinte vérifiée, compat anciens liens, `?v=2`) ; `publier-lot.js` (aucun type d'attestation accepté tant que le bloc 2 n'existe pas) ; test CI de la chaîne. Navigateur réel OK, BOX clair 0 pixel de différence, falsification en vol refusée.
   - **Bloc 2 (relecture n8n dédiée)** : cahier des charges `docs/CDC-fonda-relecture.md` **v8.1** (branche `feat/box-fonda-relecture`), modèle « l'humain garantit, la technique est un filet non probant » : confirmation par la relectrice de l'instantané exact (code ↔ SHA-256), signature RSA **locale** sur le Mac d'Éric, clôture manuelle, moteur de correction élève versionné (SRI) lié de bout en bout, immuabilité CI par tuple (empreinte, moteur), CODEOWNERS. 8 relectures Codex. **Preuve C8 faite** (2026-10-13 : SRI/CORS/mécanisme d'export OK sur l'instance ; n8n remplace l'en-tête CSP → CSP en `<meta>`). Crypto v1 « Sign » vérifié sur l'instance. **Prochaine étape : étape 2 = chantier/PR isolé « moteur de correction élève » (M1), après go d'Éric.**
   - **Bloc 3 (prod, feu vert)** : retrait de l'orpheline `box_7e7tcooh` du catalogue BOX.
2. `feat/box-delete-hardening` (PR BOX séparée, basse priorité) : durcissement `/box-delete`. Le catalogue de test d'octobre contient 47 vrais jeux : utiliser un catalogue de test dédié avant de tester.
3. Moteur A + **dette `defi_id`** (PRD §16.7) ; collecte `/box-fonda-events` = chantier identifié, non câblé.

## 🔖 Check-list AVANT PUBLICATION / usage élève réel
1. **Régénérer la clé API Anthropic** (a circulé en clair) : scripts locaux + nœud `Claude API` (HTTP, header en clair) de `BOX - Generation Flashcards` ; idéalement passer par un credential n8n.
2. **Secrets commités** : retirés des 16 lots par le bloc 1 (`feat/box-fonda-lane`), test anti-retour en CI. FONDA n'a plus de code de suppression (chaîne séparée). Restent dans l'historique Git : sans effet pour FONDA ; pour BOX, seule l'orpheline `box_7e7tcooh` est concernée (bloc 3).
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

_Dernière mise à jour : 2026-10-13 — Claude Code (Opus 5.5)._
