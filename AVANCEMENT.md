# BOX / Box-FONDA — État d'avancement

> Historique détaillé (incidents, tickets T1–T6, relectures Codex, preuves ; parcours page P1–P4a, #86, #87, terminés) : `AVANCEMENT-archive.md`.

## Objectif
Box-FONDA : extension « savoirs fondamentaux » de BOX (défis courts, correction par profil, mesure par groupe, fiches générées puis relues par un humain), sans casser BOX. Dépôt AAP CARDIE-SEPIA, échéance **21/10/2026**. Source de vérité : `docs/PRD-Box-FONDA.md` ; règles : `AGENTS.md`.

## État actuel (2026-11-24, design = `ce4cf1b`)
- **BOX prod** : 9 workflows n8n actifs, front `https://ericduchateau.github.io/box/` (`main`).
- **FONDA, relecture par la page EN PRODUCTION** (phase B, 2026-11-24) : Emettre, Cloturer, Confirmer, Page **ACTIFS** (versions auditées). Chaîne en saisie locale toujours disponible (#59). Génération `vrqgtS5kQMvP9Ok5` et portier `MkYrdhgTo52nA3av` INACTIFS hors fenêtre.
- **Publiés c4-milieu P2** (calendrier à jour) : maths `proportionnalite_nI_02`, `resolution-problemes_nI_02` ; français `phrase-orthographe_nI_01`, `lexique_nI_02`, `inference-implicite_nI_02`, `sens-mot-inconnu_nI_02`.
- **Exclusions** (#74, n8n redéployé #75) : `fr.changer-representation`, `maths.comprendre-document`, `maths.geometrie`.
- **CDC relecture sur design** (#77) : r8 + r9 consigné (§20.16, à relire par Éric) + r10.9 (§21, parcours page).

## Fait : Moteur A — module 1 (agrégation), branche `fonda/moteur-a-agregation` (2026-11-26)
- **Posé** : `fonda/engine/agregation.js` + **113 tests**, contrat figé puis durci contre mutation (DST, lecture unique de l'événement, tri par unités de code, Map imbriquées, grammaires `notion_id` et `defi_id`, 1b = B : niveau du `defi_id` = métadonnée, `event.niveau` fait foi). SPEC §1-§3, §6-§7 à jour ; témoin amendé (2 chemins, ancre `7343e5ab`). Suite complète Node 22 verte, 3 relectures Codex sans défaut fonctionnel. **Fusionné** (#116).
- **Module 2 (couleur)**, branche `fonda/moteur-a-couleur` (2026-11-27) : `couleur.js` + **32 tests** (frontières 0,75/0,5, pas de bascule sous 25, gris si priorité absente, fail-fast sur référentiel ET agrégation, doublons, hors référentiel compté), SPEC §3 bis, témoin re-tamponné (`5fa85a6d`). Réduction par notion (pire couleur) au module 7. **En attente** : relecture + merge par Éric.

## Prochaines étapes
1. **P4 recette du parcours page : CLOSE** (phases 1–5). Portes **GO** : G6, G3, G4, G5, G2 (filtre exact #95, rejeu), G1 (+1 prouvé, concurrence détectée), G7 (`running` vu en vol ; angle mort `waiting` de l'API n8n 2.6.3 -> garde-fou liste fermée des nœuds #99 ; workflows créés par API/import, jamais par l'éditeur). **Phase 5** : recette démontée (6 workflows, exécutions, Data Table, 4 credentials, Drive `FONDA-RECETTE/`, 2 clés API -> 401, trousseau) ; production prouvée intacte (51/51 workflows identiques, 9 BOX actifs). Google non touché (client OAuth peut-être partagé). P5 livré et G1 tranché (points 1 bis et 2). Preuves : `RECETTE-P4.md` (PR `docs/phase5`).
1 bis. **Déploiement PRODUCTION de la relecture : TERMINÉ.** Phase A (2026-11-15) : import INACTIF identique au dépôt (Emettre `5iJOTDkaTZq7z0sh`, Cloturer `QrmJY4gguZEx7YoS`, Confirmer `W1HAOtjAX3ILZBpX`, Page `nQjoq0UekNNliaMt`). **Phase B (2026-11-22 → 24)** : H3 (404 avant activation) ; activation par l'API, version épinglée (preuve : `versionId` inchangé = `activeVersionId`) ; bout en bout sur `set_fonda_proportionnalite_nI_89` (#109) : génération 281291, émission 281292, confirmation 281294, clôture 281295 (`effet_conforme`), signature locale revérifiée, rien publié ; nettoyage : Drive 404 ×3, courriel supprimé, `abandonne` (#110), clé d'écriture révoquée (401). Go-live : les 4 restent ACTIFS. Preuves et politique de purge : `RECETTE-P4.md`. **Restent** : ligne `justine` (contrôle visuel, puis bascule avec l'accord de la relectrice) ; G1 tranché (2026-11-25) : ordre d'Emettre accepté, workflow non édité, purge immédiate d'un échec à « Preparer candidat », durcissement du CLI écarté (redondant, ou dupliquerait la source de vérité).
2. **P5 livré** : P5-0 (#105), P5-1 (#106), P5-2 (#107), P5-3 `cloturer-page.js` (#108). Reporté : durcissement `process.execPath` (exige d'étendre la liste fermée). Tests sous Node 22.
3. Correctif #76 **prouvé** (phase B : 281291 vu en vol). PR calendrier après chaque publication. — Champ `bande` dans la métadonnée des lots ; bilans de période (P3 avant le 4 janvier).
4. Réglages à confirmer (Éric) : « Allow rebase merging » décoché ; « Do not allow bypassing » ; CODEOWNERS sur `main`. Bloc 3 (prod) : orpheline `box_7e7tcooh`, `feat/box-delete-hardening`, Moteur A + dette `defi_id`, collecte `/box-fonda-events`.

## 🔖 Check-list AVANT PUBLICATION / usage élève réel
0. **Verrou n°1 du go-live Moteur A** : migrer `liens.js` vers `defi_{annee}-w{sem}_{niveau}_{slug}_{palier}`. Tant qu'il émet l'ancien format (`_{grp}_`, sans palier), **tous les liens réels sont rejetés** par l'agrégation (SPEC §6/§7).
1. **Régénérer la clé API Anthropic** (a circulé en clair) : scripts locaux + nœud `Claude API` (HTTP, header en clair) de `BOX - Generation Flashcards` ; idéalement passer par un credential n8n.
2. **Secrets commités** : retirés des 16 lots par le bloc 1 (`feat/box-fonda-lane`), test anti-retour en CI. FONDA n'a plus de code de suppression (chaîne séparée). Restent dans l'historique Git : sans effet pour FONDA ; pour BOX, seule l'orpheline `box_7e7tcooh` est concernée (bloc 3).
3. **Adresse réelle de la relectrice de français** : dans n8n uniquement, **jamais** dans `fonda/data/destinataires.json` (dépôt public).
4. **Orpheline `box_7e7tcooh`** au catalogue Drive (fichier déjà en corbeille) : la retirer via `/box-delete` (code connu) ou à la main après sauvegarde du catalogue — feu vert Éric requis.
5. **Fidélité du banc de test** : contexte navigateur unique (vm partagé), parcours depuis `App.initFonda()` — à prioriser avant d'élargir FONDA à d'autres notions.
6. **Correcteur tolérant au mot après le nombre** (« 2 bus » noté faux sans `unite` ; avec `unite`, le nombre seul donne « presque, unité oubliée »).

## Autres dettes (non bloquantes)
- **Moteur A, dettes de test** (fast-follow, le moteur est correct) : fixture d'adoption à rendre asymétrique (`df ↔ maison`, ex. 4 `maison` / 8 `df`) ; couverture combinatoire de 1b ; échantillon de séparateurs (`#`) ; module 2 : horloge capturée au chargement (`const now = Date.now` à l'import) non détectée — exigerait un chargement sous horloge neutralisée en environnement isolé ; mutation invraisemblable, module sans horloge, déterminisme déjà épinglé. Module 2 : frontières exactes en `nF` (0,75 et 0,5) non échantillonnées — une variante `>` pour `nF` seulement passerait ; mutation invraisemblable, moteur correct en `>=`.
- **Durcissement du générateur de set_id** : `catalogue.js` ne s'arrête qu'à `_99`, alors que la plage réelle va jusqu'à `_89` et que `_90`–`_99` est réservée aux fixtures de test. Le générateur peut donc fabriquer des sets réels dans la plage réservée (`_90`–`_98`) et entrer en collision avec les tests. À durcir pour qu'il s'arrête à `_89`. **Prochains modules** : 2 couleur (à fusionner), 3 fréquence, 4 promotion, 5 composition du menu, 6 ⬛ trou, 7 écriture des sorties.
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

_Dernière mise à jour : 2026-11-27 — Claude Code (Opus 5.5)._
