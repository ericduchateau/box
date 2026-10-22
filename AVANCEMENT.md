# BOX / Box-FONDA — État d'avancement

> Historique détaillé (incidents, tickets T1–T6, relectures Codex, preuves) : `AVANCEMENT-archive.md`.

## Objectif
Box-FONDA : extension « savoirs fondamentaux » de BOX (défis courts, correction par profil, mesure par groupe, fiches générées puis relues par un humain), sans casser BOX. Dépôt AAP CARDIE-SEPIA, échéance **21/10/2026**. Source de vérité : `docs/PRD-Box-FONDA.md` ; règles : `AGENTS.md`.

## État actuel (design = `9414354`, main = `71299fa` : tout FONDA y est arrivé par l'incident #28, gardé ; réconcilié par #32)
- **BOX prod** : 9 workflows n8n actifs, Google Form + Tally, relecture carte par carte (`/box-select`), front `https://ericduchateau.github.io/box/` (`main`).
- **FONDA sur `design`** : thème sombre, correction par profil, index `?fonda=1&page=entrainement` ; **chaîne séparée (bloc 1, PR #6/#7 mergées)** : `catalogue-fonda.json` + `fonda/data/lots/` (8 lots relus, empreintes figées `HISTORIQUES_FIGES`), CI `tests (node --test)` obligatoire sur `design`/`main`.
- **CDC relecture v8.3 VALIDÉE** (§20 r5, `9b567ee`, branche `feat/box-fonda-relecture`, non mergée) : brique 1 additive (génération, projection complète, lot_relu, décision, charge v2, properties Drive, Sonnet épinglé, purge → refus). Preuve C8 faite.

## Étape 2 : moteur de correction élève (M1) — **mergée** (PR #8, 2026-10-14)
- `fonda/engine/moteur-correction-v1.js` immuable (registre `moteurs.json`, SRI, CI `immuabilite`) ; 8 lots historiques liés au moteur v1 et au badge « relue par Éric Duchateau » (figés dans `catalogue.js`). Détails et preuves : `AVANCEMENT-archive.md`.

## Prochaines étapes
1. **Mergés** : étape 3 (canonique, journal + M2, immuabilité + CODEOWNERS ; `immuabilite` requis sur `design`/`main`) ; 4.0 (CDC v8.2 §11 bis + schémas canoniques, PR #14) ; 4a (PR #15, publication Type 2 vérifiée) ; 4b-code (PR #16, `signer-cloture.js`, garde maîtresse) ; cérémonie de clé `eric-2026` (publique dans `fonda/data/cles/`, privée chiffrée hors dépôt, jamais lue par les agents).
2. **Brique 1 (ordre §20.14)** : étapes 1–4 et dette A mergées (PR #18–#24 ; workflow de génération `vrqgtS5kQMvP9Ok5` INACTIF). **Étape 5** (plan validé, branche `docs/plan-etape5-propre` ; l'ancienne `docs/plan-etape5` contient l'inventaire F3 → suppression distante à décider par Éric) :
   - lots 1–5 mergés : clé FONDA, recette, portier `MkYrdhgTo52nA3av` (#26), dette C (#27), adaptateurs + CLI + diagnostic + `--palier` (#28, arrivé sur main par erreur puis réconcilié par #32) ; `.gitignore` des secrets (`chore/gitignore-secrets`) ;
   - **lot 6 mergé** : sonde §20.8 (`ZQASW4PKigh1JaHt`, inactive, à archiver dans l'UI sans la supprimer : exécutions 279791 = 404 sur l'id daté, 279792 = `model` `claude-sonnet-5-5`) ; règle G5 `modeleEpingle` (daté OU sans date, liste noire des alias pré-4.6, CDC r8 sur `docs/cdc-r8-modele-epingle`) (#29) ; `modeles-autorises.json` = `["claude-sonnet-5-5"]` + génération épinglée dessus, aucun repli (#34) ;
   - **lot 7 mergé** (#36) : garde de `cloturer` INCHANGÉE ; `main()` n'accepte que `saisie_locale` (page refusée avant réseau et clé) ; `cloturerSaisieLocale` se valide elle-même, clé préparée avant, rattachement « poison » ; recette d'ACCÈS du signataire consignée (#35, 2026-10-22 : acces_ok, aucune_generation) ;
   - **GATE LOT 8 (bloquant)** : Bloc de CONSIGNATION de `RECETTE-INSTANCE.md` à remplir par Éric et relire : (a) réglages Save executions observés dans Settings ; (b) `EXECUTIONS_DATA_PRUNE=false` constaté sur le conteneur. Pas de lot 8 avant.
3. **Dette `--etendu` FERMÉE** (PR #21) : 1220 vecteurs de refus d'élargissement (un par type interdit au CDC — null, nombre, chaîne, booléen, objet, tableau — sur chaque chemin de chaque contrat), liste tenue À LA MAIN contre le CDC (`fonda/scripts/champs-canonique.js`, confrontée aux schémas chargés) ; `--etendu` : 506/506 détectées, en CI.
4. Réglages à confirmer (Éric) : « Allow rebase merging » décoché ; « Do not allow bypassing » ; CODEOWNERS sur `main`. — bloc 3 (prod, feu vert) : orpheline `box_7e7tcooh`. `feat/box-delete-hardening` ; Moteur A + dette `defi_id` ; collecte `/box-fonda-events` ; recette `canonique.js` en vrai nœud n8n.

## 🔖 Check-list AVANT PUBLICATION / usage élève réel
1. **Régénérer la clé API Anthropic** (a circulé en clair) : scripts locaux + nœud `Claude API` (HTTP, header en clair) de `BOX - Generation Flashcards` ; idéalement passer par un credential n8n.
2. **Secrets commités** : retirés des 16 lots par le bloc 1 (`feat/box-fonda-lane`), test anti-retour en CI. FONDA n'a plus de code de suppression (chaîne séparée). Restent dans l'historique Git : sans effet pour FONDA ; pour BOX, seule l'orpheline `box_7e7tcooh` est concernée (bloc 3).
3. **Adresse réelle de la relectrice de français** : dans n8n uniquement, **jamais** dans `fonda/data/destinataires.json` (dépôt public).
4. **Orpheline `box_7e7tcooh`** au catalogue Drive (fichier déjà en corbeille) : la retirer via `/box-delete` (code connu) ou à la main après sauvegarde du catalogue — feu vert Éric requis.
5. **Fidélité du banc de test** : contexte navigateur unique (vm partagé), parcours depuis `App.initFonda()` — à prioriser avant d'élargir FONDA à d'autres notions.
6. **Correcteur tolérant au mot après le nombre** (« 2 bus » noté faux sans `unite` ; avec `unite`, le nombre seul donne « presque, unité oubliée »).

## Dettes OBLIGATOIRES avant activation du workflow de génération (étape 5, avant le vrai run §20.8)
- **A — pinData null (API n8n)** [PR `fix/box-fonda-pindata-null` + CDC r7 `caeaf2c` ; Codex « propre pour merge » ; feu vert Claude attendu] : l'API publique crée `pinData: null` (non accepté en écriture) et les exécutions le recopient. `rapprocher` + CDC : absent | null | `{}` acceptés ; objet non vide, tableau, autre type (falsy compris) → abandon. Le contournement par l'éditeur devient inutile après merge.
- **B — appel mal formé (Codex r1 #4)** : correctif CÔTÉ WORKFLOW, pas signataire (le signataire a raison) : le nœud d'entrée émet TOUJOURS `{set_id, ref}` pour tout corps valide ; le malformé est rejeté à la frontière du webhook (4xx) sans exécution auditée non attribuable ; test jusqu'au signataire.
- **C — dépôts concurrents (Codex r1 #5)** : dépôt idempotent ou exclusion mutuelle, reprises réseau incertaines comprises. En l'état : sûr (abandon), atténué par « un appel à la fois par set_id ».

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
- Chrome met `css/style.css` en cache : désactiver le cache pour toute preuve visuelle ; figer `Math.random` (sinon deux captures du même état BOX diffèrent). Scripts injectés dynamiquement : ordre garanti par `await` séquentiel, preuve de chargement = export sur `window`.
- `fonda/data/calendar.json` a `semaines: []` : « Aucun défi programmé » est l'état réel, pas un bug.
- Profil `orthographe` : ne jamais normaliser accents/pluriels (c'est ce qu'on mesure).
- Moteur publié **immuable** : toute retouche de `moteur-correction-v1.js` change son SHA-256 → interdit après merge ; nouveau comportement = `v2` + nouveaux `set_id`.
- Le classificateur auto-mode bloque les commandes contenant la clé API : Éric lance lui-même les générations.
- Branches (AGENTS.md) : PR toujours vers `design` (liens `compare/design...<branche>`), fusion en merge commit ; jamais de fast-forward de `design` (casse la chaîne du premier parent).

_Dernière mise à jour : 2026-10-22 — Claude Code (Opus 5.5)._
