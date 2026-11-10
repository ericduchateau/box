# BOX / Box-FONDA — État d'avancement

> Historique détaillé (incidents, tickets T1–T6, relectures Codex, preuves) : `AVANCEMENT-archive.md`.

## Objectif
Box-FONDA : extension « savoirs fondamentaux » de BOX (défis courts, correction par profil, mesure par groupe, fiches générées puis relues par un humain), sans casser BOX. Dépôt AAP CARDIE-SEPIA, échéance **21/10/2026**. Source de vérité : `docs/PRD-Box-FONDA.md` ; règles : `AGENTS.md`.

## État actuel (2026-11-10, design = `e66fe79`)
- **BOX prod** : 9 workflows n8n actifs, front `https://ericduchateau.github.io/box/` (`main`).
- **FONDA, chaîne signée en saisie locale** opérationnelle (orchestrateur #59, intérim). Génération `vrqgtS5kQMvP9Ok5` et portier `MkYrdhgTo52nA3av` INACTIFS hors fenêtre.
- **Publiés c4-milieu P2** (calendrier à jour) : maths `proportionnalite_nI_02`, `resolution-problemes_nI_02` ; français `phrase-orthographe_nI_01`, `lexique_nI_02`, `inference-implicite_nI_02`, `sens-mot-inconnu_nI_02`.
- **Exclusions** (#74, n8n redéployé #75) : `fr.changer-representation`, `maths.comprendre-document`, `maths.geometrie`.
- **CDC relecture sur design** (#77) : r8 + r9 consigné (§20.16, à relire par Éric) + r10.9 (§21, parcours page).

## Fait : parcours page P1 (#78), P3 (`b45d441`), P2 (#83), P4a (#85), #86, #87
- **P1** : `rattachement-page.js` (E1–E12, R1–R6) + `adaptateurs-page.js` ; `signer-cloture.js` = réf. `9b75507` + patch figé (§21.8) ; témoin `temoin-saisie-locale.test.js` + ancre, empreinte `3253c24d` (protection procédurale, relecture d'Éric).
- **P3** : Emettre + Cloturer INACTIFS construits depuis le dépôt (`n8n/fonda-relecture-page/`), faux Drive fidèle, réémission fail-closed, contrôles de version Drive (BigInt).
- **P2** : Page (GET `/fonda-select`, C3 au GET, CSP en meta, SRI sha384 depuis le registre, script sous nonce, profils par version du moteur) + Confirmer (POST `/fonda-select-confirm`, C1–C6 + C5bis ; C7 courriel retiré). Harnais 167 tests : chaîne réelle Emettre → Page → script exécuté (DOM vm) → Confirmer → Cloturer → signataire. Corrige le défaut P3 (recherches par nom exact non paginées). Témoin inchangé.
- **P4a (#85)** : `--profil recette` (exports `*.recette.json`, production octet-identique), `outils-recette/` (transport GET seul, sonde codes 0/1/2, `comparer-live`), `RECETTE-P4.md` (frontières énumérées, auto-vérifiées, instantanés de surface ; code futur tenu par CODEOWNERS + relecture). 7 tours Codex.
- **#86** : Emettre lit la Data Table par le **nœud natif** (plus de clé d'API n8n ni de credential), destinataire validé AVANT toute écriture (grammaire stricte) ; seul Emettre a changé en prod. **#87** : relevés VPS — `EXECUTIONS_DATA_PRUNE=false` (pas de fenêtre de signature), sauvegarde succès/erreur = all, payload 16 Mo, n8n 2.6.3.
- **Doctrine (README « Où vit chaque garantie », §21.5)** : pilier 1 = signataire ; pilier 2 = verrou « un seul écrivain CLI » (P5), contrôle d'intégrité porteur. Les contrôles de version détectent, n'excluent pas. Une exécution observée ne contient que le travail essentiel (son statut porte l'intégrité). `hash_formulaire` = audit rapproché (R1 avant signature), non signé.

## Prochaines étapes
1. **P4 recette, phase 1 en cours** : créés par Éric (interface) les dossiers Drive `FONDA-RECETTE/{lots,relecture,decisions}` et la Data Table `fonda_recette_relecteurs` (projet Personal ; 2 lignes `eric`/`justine` -> adresse de test) ; identifiants hors dépôt. Restent 4 credentials (Drive, Emettre Token, Cloturer Token, Gmail) -> UNE PR `profil-recette.json` + exports recette, `urlMoteurs` = jsDelivr épinglé au HEAD de design (SHA dans la PR). Puis P4b (Crypto v2 Hmac + credential `crypto`, Page et Confirmer), phase 2 (import inactif, `comparer-live`), portes G1–G7 (`RECETTE-P4.md`).
2. **P5** (`cloturer-page.js`, cadrage avant) : **critère de livraison** = verrou CLI mono-écrivain (verrou local + refus si exécution Emettre/Cloturer en cours) + hypothèse « CLI lancé depuis le seul Mac d'Éric », relu au niveau du signataire ; notification (ex-C7) côté CLI ou workflow séparé non observé.
3. Prochain run FONDA : preuve empirique du correctif #76 (`sonde-executions.js vrqgtS5kQMvP9Ok5` pendant la génération, lecture seule) ; PR calendrier après chaque publication.
4. Champ `bande` dans la métadonnée des lots ; bilans de période (P3 avant le 4 janvier).
5. Réglages à confirmer (Éric) : « Allow rebase merging » décoché ; « Do not allow bypassing » ; CODEOWNERS sur `main`. Bloc 3 (prod) : orpheline `box_7e7tcooh`, `feat/box-delete-hardening`, Moteur A + dette `defi_id`, collecte `/box-fonda-events`.

## 🔖 Check-list AVANT PUBLICATION / usage élève réel
1. **Régénérer la clé API Anthropic** (a circulé en clair) : scripts locaux + nœud `Claude API` (HTTP, header en clair) de `BOX - Generation Flashcards` ; idéalement passer par un credential n8n.
2. **Secrets commités** : retirés des 16 lots par le bloc 1 (`feat/box-fonda-lane`), test anti-retour en CI. FONDA n'a plus de code de suppression (chaîne séparée). Restent dans l'historique Git : sans effet pour FONDA ; pour BOX, seule l'orpheline `box_7e7tcooh` est concernée (bloc 3).
3. **Adresse réelle de la relectrice de français** : dans n8n uniquement, **jamais** dans `fonda/data/destinataires.json` (dépôt public).
4. **Orpheline `box_7e7tcooh`** au catalogue Drive (fichier déjà en corbeille) : la retirer via `/box-delete` (code connu) ou à la main après sauvegarde du catalogue — feu vert Éric requis.
5. **Fidélité du banc de test** : contexte navigateur unique (vm partagé), parcours depuis `App.initFonda()` — à prioriser avant d'élargir FONDA à d'autres notions.
6. **Correcteur tolérant au mot après le nombre** (« 2 bus » noté faux sans `unite` ; avec `unite`, le nombre seul donne « presque, unité oubliée »).

## Autres dettes (non bloquantes)
- `?action=delete` public (seul le code protège) ; anciens liens Valider/Rejeter en GET, HMAC sans expiration ; QR code, favicon/lockup FONDA absents ; `non-regression.test.js` en quarantaine (comparer à `main`).

## Décisions clés (pourquoi)
- `main` = prod, jamais touché ; `design` = intégration ; une branche + une PR par chantier, merge par Éric.
- n8n prod : aucun changement sans validation explicite ; workflows livrés en JSON à importer, testés inactifs.
- Relecteur affiché **lu dans la donnée**, jamais déduit de la matière (badge = affirmation G4).
- Publication FONDA : aucun type d'attestation accepté tant que la relecture signée (étape 3) n'existe pas.
- « Carte invalide = échec compté » conservé (filet défensif, n'y revenir que si observé).
- **Historique de confiance = chaîne du premier parent** de la référence et de `design` (états réellement publiés) : les commits intermédiaires d'une PR ne comptent pas, son merge oui. Suppose merge commit ou squash (rebase-merge et push direct exclus). Le CI **détecte** une violation, la **protection de branche l'empêche**. Reporté au CDC §17 + annexe A.

## Pièges
- Parcours page : `signer-cloture.js` ne change QUE par le patch figé (§21.8) ; toute modification du témoin, de l'ancre ou de la liste fermée = décision d'Éric, nouvelle empreinte, ancre et §21.8 mis à jour. En local, `fonda/demo-c8/` est exclu via `.git/info/exclude` (checkout propre exigé par le témoin).
- Intérim : l'autorisation se lit TOUJOURS sur design (fetch explicite), jamais dans la copie de travail ; les pièces signées se vérifient par l'archive historique seule. Retirer l'entrée = arrêt des nouvelles opérations, attestations existantes intactes.
- Chrome met `css/style.css` en cache : désactiver le cache pour toute preuve visuelle ; figer `Math.random` (sinon deux captures du même état BOX diffèrent). Scripts injectés dynamiquement : ordre garanti par `await` séquentiel, preuve de chargement = export sur `window`.
- Calendrier : une entrée `planifie` n'a jamais de `set_id` (validateur + CI) ; un retrait de lot doit retirer ses entrées du calendrier dans le même commit.
- Profil `orthographe` : ne jamais normaliser accents/pluriels (c'est ce qu'on mesure).
- Moteur publié **immuable** : toute retouche de `moteur-correction-v1.js` change son SHA-256 → interdit après merge ; nouveau comportement = `v2` + nouveaux `set_id`.
- n8n 2.6.3 : l'API publique n'expose pas les Data Tables (MCP n8n inutilisable pour elles) : création et lecture dans l'interface ou par le nœud natif.
- Le classificateur auto-mode bloque les commandes contenant la clé API : Éric lance lui-même les générations.
- Branches (AGENTS.md) : PR toujours vers `design` (liens `compare/design...<branche>`), fusion en merge commit ; jamais de fast-forward de `design` (casse la chaîne du premier parent).

_Dernière mise à jour : 2026-11-10 — Claude Code (Opus 5.5)._
