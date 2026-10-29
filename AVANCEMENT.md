# BOX / Box-FONDA — État d'avancement

> Historique détaillé (incidents, tickets T1–T6, relectures Codex, preuves) : `AVANCEMENT-archive.md`.

## Objectif
Box-FONDA : extension « savoirs fondamentaux » de BOX (défis courts, correction par profil, mesure par groupe, fiches générées puis relues par un humain), sans casser BOX. Dépôt AAP CARDIE-SEPIA, échéance **21/10/2026**. Source de vérité : `docs/PRD-Box-FONDA.md` ; règles : `AGENTS.md`.

## État actuel (2026-10-28, design = `c215dd0`)
- **BOX prod** : 9 workflows n8n actifs, front `https://ericduchateau.github.io/box/` (`main`).
- **Brique 1, étape 5 : lots 1–8 faits.** Génération `vrqgtS5kQMvP9Ok5` et portier `MkYrdhgTo52nA3av` INACTIFS hors fenêtre ; modèle épinglé `claude-sonnet-5-5` ; clôture signée en saisie locale (relecteur eric). Correctif runtime n8n (#42) ; plage `_90–_99` réservée aux set_id fictifs (#47).
- **Publiés par la chaîne signée** : `set_fonda_nombres-fractions-relatifs_nI_03` (#44) et `set_fonda_grandeurs-mesures_nI_02` (pilote maths 5e/4e, exéc. 279890, #49).
- Calendrier FONDA réel fusionné (#50).
- Fiche français `comprendre-consigne` (relectrice justine) : débloquée par l'intérim ci-dessous une fois fusionné.
- Sondes/copies n8n `ZQASW4PKigh1JaHt`, `4pDA91YG9ssSus3X`, `XrSG2nt5q40SNvf4` : à archiver par Éric (jamais supprimer : preuves).

## En cours : relecteur de secours en intérim (`feat/relecture-interim`, sensible)
- Plan r6 approuvé (6 passes Codex high) ; `relecture-interim.json` (justine → eric, P2, 2026-10-28 → 2026-12-18) ; `interim.js` (autorisation au SHA de design par fetch EXPLICITE, provenance, archive) ; décision v2, instantané v2 (décision embarquée), charge `attestation-cloture/v3`, badge `relue_par_secours` ; vérificateur, catalogue, front, diagnostic à deux axes, export n8n régénéré (génération identique).
- Suite 5603/0 ; non-régression octet pour octet contre c215dd0 (7312 mutations, 1440 v1 + 2025 v2 de forme valide) ; #44 et #49 se revérifient. Codex high du code : 4 passes, verdict final vert (diagnostic : lot signé toujours « signe », problèmes courants à part ; fetch du journal à refspec explicite). PR vers design -> architecte -> Éric. CDC r9 : PR séparée sur la lignée `docs/cdc-r8-modele-epingle`.
- Après fusion seulement, sur go architecte + Éric : resync du workflow n8n de génération en ligne (INACTIF).

## Prochaines étapes
1. Après l'intérim : génération et relecture (secours) des fiches français planifiées de P2 avant leurs semaines ; parcours page de Justine plus tard.
2. Champ `bande` dans la métadonnée des lots (lot séparé) ; bilans de période à rédiger avant chaque génération (P3 avant le 4 janvier).
3. Réglages à confirmer (Éric) : « Allow rebase merging » décoché ; « Do not allow bypassing » ; CODEOWNERS sur `main`. Bloc 3 (prod) : orpheline `box_7e7tcooh`, `feat/box-delete-hardening`, Moteur A + dette `defi_id`, collecte `/box-fonda-events`.

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
- Intérim : l'autorisation se lit TOUJOURS sur design (fetch explicite), jamais dans la copie de travail ; les pièces signées se vérifient par l'archive historique seule. Retirer l'entrée = arrêt des nouvelles opérations, attestations existantes intactes.
- Chrome met `css/style.css` en cache : désactiver le cache pour toute preuve visuelle ; figer `Math.random` (sinon deux captures du même état BOX diffèrent). Scripts injectés dynamiquement : ordre garanti par `await` séquentiel, preuve de chargement = export sur `window`.
- Calendrier : une entrée `planifie` n'a jamais de `set_id` (validateur + CI) ; un retrait de lot doit retirer ses entrées du calendrier dans le même commit.
- Profil `orthographe` : ne jamais normaliser accents/pluriels (c'est ce qu'on mesure).
- Moteur publié **immuable** : toute retouche de `moteur-correction-v1.js` change son SHA-256 → interdit après merge ; nouveau comportement = `v2` + nouveaux `set_id`.
- Le classificateur auto-mode bloque les commandes contenant la clé API : Éric lance lui-même les générations.
- Branches (AGENTS.md) : PR toujours vers `design` (liens `compare/design...<branche>`), fusion en merge commit ; jamais de fast-forward de `design` (casse la chaîne du premier parent).

_Dernière mise à jour : 2026-10-28 — Claude Code (Opus 5.5)._
