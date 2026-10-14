# BOX / Box-FONDA — État d'avancement

> Historique détaillé (incidents, tickets T1–T6, relectures Codex, preuves) : `AVANCEMENT-archive.md`.

## Objectif
Box-FONDA : extension « savoirs fondamentaux » de BOX (défis courts, correction par profil, mesure par groupe, fiches générées puis relues par un humain), sans casser BOX. Dépôt AAP CARDIE-SEPIA, échéance **21/10/2026**. Source de vérité : `docs/PRD-Box-FONDA.md` ; règles : `AGENTS.md`.

## État actuel (design = `1a1af9f`, main intact `7ea4f28`)
- **BOX prod** : 9 workflows n8n actifs, Google Form + Tally, relecture carte par carte (`/box-select`), front `https://ericduchateau.github.io/box/` (`main`).
- **FONDA sur `design`** : thème sombre, correction par profil, index `?fonda=1&page=entrainement` ; **chaîne séparée (bloc 1, PR #6/#7 mergées)** : `catalogue-fonda.json` + `fonda/data/lots/` (8 lots relus, empreintes figées `HISTORIQUES_FIGES`), CI `tests (node --test)` obligatoire sur `design`/`main`.
- **CDC relecture v8.1** : `docs/CDC-fonda-relecture.md` (branche `feat/box-fonda-relecture`, non mergée). Preuve C8 faite (SRI/CORS/export OK ; CSP en `<meta>`).

## Étape 2 : moteur de correction élève (M1) — **mergée** (PR #8, `1a1af9f`, 2026-10-14)
- `fonda/engine/moteur-correction-v1.js` : corps du correcteur = **octets bruts** de a418881 (test sans normalisation) + couche moteur (`creerMoteur()` : valider, preparerCarte, demarrer, soumettre, echec → résultat pédagogique complet, outils). Registre global `FondaMoteurs` non réassignable. `correction.js` = façade Node.
- `moteurs.json` (sha256 + SRI) ; `bootstrap.js::obtenirMoteur` (concordance registre avant tout chargement, cache par clé, SRI, origine connue, `instance.version`) ; entrée résolue avant chargement ; échec → « pas disponible ».
- `carte-reponse-produite.js` purement présentationnel `{ moteur, carte, badge, onResultat }` ; E1–E4 appliqués, tests révisés marqués « RÉVISÉ Ex ».
- **M1** : `moteur: { version: "v1", sha256 }` + badge `{ forme: "relue_par", nom_affiche: "Éric Duchateau", id: "eric" }` sur les 8 entrées historiques, empreintes inchangées ; figés dans `catalogue.js` (`MOTEUR_HISTORIQUE`, `BADGE_HISTORIQUE`).
- Générateur / publication / CI valident avec **le moteur du lot** ; profils et bornes d'arrondi sortis de `validerLot` (seulement `moteur.valider`). CI `verifier-moteurs.js` : moteurs immuables + **règle 0 de M1** (consommable une fois ; branche « M1 consommée » à transférer à `verifier-immuabilite.js` en étape 3).
- Critique Codex (6 points) corrigée : règle 0, règles pédagogiques hors catalogue, frontière DOM → `moteur.echec`, purge du cache sur tout échec, octets bruts, différentiel sur le vrai composant a418881. Re-review Codex : 5/6 corrigés, point 1 complété (parcours sans simplification d’historique, lecture illisible = échec) ; 2e re-review ciblée : « propre pour merge ».
- Preuves : `node --test` 598/598 (1 skip) ; différentiels ancien/nouveau (correcteur et composant a418881 réellement exécutés, frontières d'exception comprises ; mutations détectées) ; navigateur réel (Chrome 155) : 8 lots parcourus, SRI altérée bloquée ; BOX clair 0 pixel de différence vs design.
- Changement visible voulu (CDC §12) : badge « Fiche relue par Éric Duchateau » (avant : « Fiche relue et validée par … avant publication. »).

## Prochaines étapes
1. **En cours** : `fix/ci-immuabilite-first-parent` → `design`. Le push post-merge de la PR #8 a mis l'étape « Immuabilité des moteurs » en échec (run 38471882811) : `rev-list` sans `--first-parent` voyait les brouillons de la PR (autre empreinte du moteur v1). Correctif : historique de confiance = chaîne du premier parent. Relecture Codex + Éric avant merge.
2. Puis **point d'étape avec Éric** avant étape 3 (canonique, clés, journal set_ids, signature/clôture, CODEOWNERS, workflows inactifs — activation sur go explicite).
3. Bloc 3 (prod, feu vert) : retrait de l'orpheline `box_7e7tcooh` du catalogue BOX.
4. `feat/box-delete-hardening` (basse priorité) ; Moteur A + dette `defi_id` ; collecte `/box-fonda-events`.

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
- Publication FONDA : aucun type d'attestation accepté tant que la relecture signée (étape 3) n'existe pas.
- « Carte invalide = échec compté » conservé (filet défensif, n'y revenir que si observé).
- **Historique de confiance = chaîne du premier parent** de la référence et de `design` (états réellement publiés) : les commits intermédiaires d'une PR ne comptent pas, son merge oui. À reporter dans le CDC §17.

## Pièges
- Chrome met `css/style.css` en cache : désactiver le cache pour toute preuve visuelle ; figer `Math.random` (sinon deux captures du même état BOX diffèrent).
- Scripts injectés dynamiquement : ordre garanti par `await` séquentiel, preuve de chargement = export sur `window`.
- `fonda/data/calendar.json` a `semaines: []` : « Aucun défi programmé » est l'état réel, pas un bug.
- Profil `orthographe` : ne jamais normaliser accents/pluriels (c'est ce qu'on mesure).
- Moteur publié **immuable** : toute retouche de `moteur-correction-v1.js` change son SHA-256 → interdit après merge ; nouveau comportement = `v2` + nouveaux `set_id`.
- Le classificateur auto-mode bloque les commandes contenant la clé API : Éric lance lui-même les générations.

_Dernière mise à jour : 2026-10-14 — Claude Code (Opus 5.5)._
