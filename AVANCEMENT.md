# BOX — Journal technique

## Dernière session : 2026-09-04

### État du projet
- 8 workflows n8n actifs (voir liste complète dans `box/CLAUDE.md`)
- Deux voies de soumission prof : Google Form + Tally (coexistence) — **les deux sont opérationnelles**
- Animation cheminée v2 (Tetris + feu d'artifice, handoff Claude Design) intégrée et en prod depuis mai/juin 2026
- Frontend déployé : https://ericduchateau.github.io/box/ — DEMO_MODE: false

### Incident résolu : voie Tally muette depuis sa création
Symptôme : 26 soumissions Tally reçues depuis le 23/04, **0 exécution** du workflow `BOX - Generation Tally` (id `aKRunzvTw7Y3WnTT`) — aucun prof n'avait reçu ses fiches par cette voie.

Deux causes cumulées :
1. Le webhook Tally UI (Integrate → Webhooks) n'avait jamais été configuré → le workflow n8n ne recevait rien.
2. Une fois le webhook branché, le node "Claude API" échouait en 400 : `invalid_request_error - Your credit balance is too low`. La clé Anthropic utilisée (en HTTP Request direct, pas via credential n8n) n'avait plus de crédit.

Résolu :
- Webhook Tally configuré → `https://n8n.srv868991.hstgr.cloud/webhook/box-tally`
- Crédits rechargés sur console.anthropic.com
- Test end-to-end confirmé : soumission → génération → email reçu avec les fiches ✅

### Point de vigilance restant
La clé API Anthropic est en clair dans les paramètres du node HTTP Request "Claude API" (visible dans les exports/logs d'exécution n8n), au lieu de passer par un credential n8n chiffré. À migrer à l'occasion — pas bloquant.

### Décisions techniques (historique)
- Drive update : HTTP Request PATCH (pas node natif)
- specifyBody: "json" + jsonBody (pas "string" + body → double encodage)
- Parsing Tally : `payload = body.body || body` → `payload.data.fields[]`
- DROPDOWN/CHECKBOXES Tally : value = UUIDs → résoudre via `field.options[].{id,text}`
- FILE_UPLOAD Tally : `value[0].url` (avec accessToken dans query string → GET direct suffit)

### Méthode de diagnostic (à réappliquer si la voie Tally redevient muette)
1. `n8n_executions` (list, workflowId `aKRunzvTw7Y3WnTT`) : 0 exécution → webhook cassé côté Tally UI. ≥1 exécution en erreur → voir le détail.
2. `n8n_executions` (get, mode=error) : lire `errorInfo.primaryError` (souvent crédits Anthropic épuisés ou format de payload Tally).
3. Vérifier `fetch_submissions` côté Tally pour confirmer qu'une soumission a bien été reçue avant de chercher côté n8n.
4. Si le MCP n8n est déconnecté : interroger l'API REST directement (`https://n8n.srv868991.hstgr.cloud/api/v1/executions?workflowId=...`, header `X-N8N-API-KEY` = clé de `.mcp.json`).

## Suivi 2026-09-21
- Activité depuis le 04/09 : 34 jeux au catalogue. Nouveaux profs : Mascaut (maths 4ème, 09/09), Delville (SVT 5ème, 10/09), Ralaimiaramanana (éduc. musicale, 10 jeux du 10 au 21/09).
- Aucune soumission Google Form réelle depuis juin ; les erreurs du workflow Google Form (12/09, 16/09) sont des pannes ponctuelles "Service unavailable" du sondage Google Sheets, sans soumission perdue.
- Erreur 21/09 15:12 sur `BOX - Validation Prof` (`Upload Catalogue: JSON parameter needs to be valid JSON`) : un robot d'aperçu de lien (Facebot) a rouvert l'ancien lien de validation de "pH et les ions" (déjà publié). Cause : la branche `already_published` de `MAJ Catalogue` alimente `Upload Catalogue` avec un JSON invalide. Sans conséquence sur les données.
- Point de vigilance : les liens Valider/Rejeter sont des GET → un scanner d'emails ou un aperçu de lien peut les déclencher (validation ou suppression involontaire). À traiter (page de confirmation ou POST) si un incident survient.
- Soumission 17/09 14:04 : email mal saisi (`juliana.ralaaimia@gmail.com`), fiches envoyées à une mauvaise adresse ; renvoyée à 14:07 avec la bonne.

## Session 2026-10-01 — Sélection carte par carte avant publication

### Nouvelle fonctionnalité : BOX - Selection Prof
Demande : un enseignant (Liagre) a signalé un énoncé jugé incorrect dans son lot — besoin de pouvoir relire et écarter des cartes une par une avant publication, plutôt qu'un simple Valider/Rejeter global.

Email impossible à rendre interactif (Gmail/Outlook suppriment `<form>`/JS) → solution : un lien unique "Relire et choisir les cartes" ouvre une page web (servie par n8n) avec une case à cocher par carte + "Tout sélectionner/désélectionner", qui poste la sélection à un second webhook.

**Nouveau workflow : `BOX - Selection Prof` (id `HdDyacN45SPMyZoJ`)**
- `GET /box-select?file_id=...&code=...` → vérifie le code, affiche les cartes avec cases à cocher (formulaire POST, pas de GET destructeur).
- `POST /box-select-confirm` (body: `file_id`, `code`, `cartes[]`) → filtre le fichier JSON aux cartes cochées, republie (Drive + catalogue), envoie l'email de confirmation avec le lien élève. Si 0 carte cochée → traité comme un rejet (fichier supprimé, rien publié).
- Corrige au passage le bug `already_published` de `MAJ Catalogue` (branche dédiée avant l'upload, au lieu de planter dessus).

**Workflows modifiés :**
- `BOX - Generation Tally` et `BOX - Generation Flashcards` : le node "Preparer Email Validation" n'envoie plus 2 boutons (Valider/Rejeter) mais 1 seul lien vers `/box-select`.
- `BOX - Validation Prof` / `BOX - Rejet Prof` conservés inchangés (webhooks `/box-validate`, `/box-reject` toujours actifs) pour que les emails déjà envoyés avec les anciens boutons continuent de fonctionner.

### 3 bugs latents découverts et corrigés pendant les tests (sans rapport avec la demande initiale)
1. **`BOX - Rejet Prof` et `BOX - Suppression`** : le node Google Drive utilisait `operation: "delete"`, qui n'existe plus sur la version actuelle du node (`n8n-nodes-base.googleDrive` v3) → erreur `Cannot read properties of undefined (reading 'execute')`. Corrigé en `resource: "file"` + `operation: "deleteFile"`. **Le bouton "Rejeter" des emails était cassé silencieusement depuis une mise à jour n8n** (jamais déclenché en prod car peu utilisé).
2. **`BOX - Suppression`** : le node "MAJ Catalogue" lisait `{{ $json.updated_catalogue }}`, mais `$json` à cet endroit du flux pointe vers la sortie du node précédent ("Supprimer fichier"), pas vers "Verifier code" → `undefined` → erreur "JSON parameter needs to be valid JSON". Corrigé en `{{ $('Verifier code').item.json.updated_catalogue }}`. **La suppression de fiche par un prof (via son code de suppression) ne fonctionnait probablement jamais.**
3. Confirmé : `Supprimer fichier`/`deleteFile` **met à la corbeille**, ne supprime pas définitivement — un fichier trashed reste techniquement récupérable par son `file_id` via l'API Drive (mais jamais listé au catalogue, donc pas exposé aux élèves). Pas bloquant, juste à savoir.

### Tests effectués (puis nettoyés du catalogue/Drive)
- Génération test → page `/box-select` (5 cartes) → confirmation avec 3/5 cartes cochées → catalogue et fichier Drive correctement filtrés à 3 cartes, email avec mention "2 carte(s) retirée(s)".
- Génération test → confirmation avec 0 carte cochée → fichier mis à la corbeille, rien publié, page "Aucune carte sélectionnée" affichée.
- Nettoyage via `/box-delete` (après correctif du bug n°2).

### À tester en conditions réelles
Attendre une prochaine soumission réelle (Tally ou Google Form) et vérifier que l'email reçu par le prof contient bien le nouveau lien "Relire et choisir les cartes" plutôt que les 2 anciens boutons.

## Session 2026-10-03 — Cadrage Box-FONDA + cartographie initiale

### Objectif
Lancer l'extension **Box-FONDA** (calendrier roulant + mesure de rétention, dépôt AAP CARDIE-SEPIA, échéance 21/10/2026), sans casser BOX existant.

### Fait
- Dépôt de 3 fichiers de cadrage, committés en un commit séparé (`37f9bda`, poussé sur `origin/design`) :
  - `AGENTS.md` (racine du repo `box/`) — garde-fous G1-G7, conventions, moteurs A/B, façon de travailler.
  - `docs/PRD-Box-FONDA.md` — spec fonctionnelle complète (16 sections), source de vérité pour Box-FONDA.
  - `CLAUDE.md` — réduit à `@AGENTS.md` en première ligne (contenu technique existant conservé en dessous).
- Cartographie en lecture seule du repo (code non modifié) ; section "Architecture" de `AGENTS.md` complétée avec les constats réels (voir ce fichier pour le détail) :
  - `box/` est bien la racine du dépôt Git (pas un sous-dossier).
  - Front 100 % statique, zéro build, zéro framework.
  - `catalogue.json` à la racine du repo est **mort** (jamais lu par le front — vérifié) ; le vrai catalogue vient de Drive via webhook.
  - **Correction** : 9 workflows n8n actifs, pas 8 (le PRD/AGENTS.md initial datait d'avant `BOX - Selection Prof`, ajouté le 01/10).
  - Le **Calcul en GitHub Action cron** du PRD (§2) n'existe pas encore (`.github/` absent) — à construire au Lot 2.

### En cours
Rien en code — attente de validation d'Éric avant tout chantier (consigne explicite : pas de code tant que non validé).

### Prochaine étape
Lot 1 (PRD §13), un chantier par branche, à démarrer sur feu vert : mode Box-FONDA sur la page existante, carte "réponse produite", tags `grp`/`ctx`, menu public statique, référentiel seed + génération initiale routée en relecture, collecte événements n8n → Sheet.

### Décisions (et pourquoi)
- Commit des 3 fichiers de cadrage séparé de la cartographie → point de restauration propre avant toute retouche (petits commits vérifiables, cf. façon de travailler `AGENTS.md`).
- `AVANCEMENT.md` continué, pas recréé — il porte l'historique réel de BOX (incident Tally, bugs Drive, Selection Prof) utile pour comprendre le terrain sur lequel Box-FONDA s'ajoute.

### Pièges et points ouverts
- Le dépôt `box/` était sur la branche `design` (pas `main`) au moment du commit ; `design` == `main` en contenu (vérifié en septembre) mais à garder en tête pour la suite des PR du Lot 1.
- Position DPD/DANE académique sur Box-FONDA : hors code, à traiter dans le dossier AAP (PRD §16, point 5).

## Plan Lot 1 — Box-FONDA

Règles de travail (rappel) :
- Branches : `main` (prod, NE PAS toucher) ← `design` (intégration) ← `feat/fonda-lot1-*` (une par ticket).
- Point de restauration : tag de prod posé avant Box-FONDA.
- Chaque ticket = une PR vers `design`. Fusion vers `main` UNIQUEMENT sur feu vert explicite d'Éric.
- Rien hors `/fonda/` et `docs/` sans le signaler. n8n jamais modifié en live (JSON à importer, testé sur copie).
- Ordre impératif : T1 → T2 → T3 → T4 → T5 → T6 (T1 fonde les suivants).
- Critique Codex (lecture seule, avant fusion) : sur T2, T3 et T5 seulement.

### ☑ T1 — Contrats de données (fondation) — fait le 2026-10-05
- But : poser `/fonda/data/referentiel.json` (seed pré-pondéré PRD §14) + schémas vides `calendar/coverage/dashboard` + `/fonda/fixtures/events.sample.json` (anonymes) + script de validation.
- Impact prod : nul (dossier neuf).
- DoD : la validation passe ✅ (`node fonda/scripts/validate.js`, 31 vérifications, testé aussi en cassant volontairement une donnée pour confirmer que le script détecte bien les erreurs) ; rien touché hors `/fonda/` ✅ (`docs/` finalement pas nécessaire, le PRD était déjà en place).
- Décisions prises (feu vert Éric le 2026-10-05) :
  - namespace `/fonda/data/` + `/fonda/fixtures/` + `/fonda/scripts/validate.js` ;
  - id de notion `{fr|maths}.{slug-kebab}` ; 11 notions (éclatement de la ligne groupée PRD §14 "Proportionnalité · Grandeurs & mesures · Espace & géométrie" en 3 notions distinctes, regroupables via le nouveau champ `categorie`) ;
  - validation maison en Node natif, zéro dépendance, pas de `package.json` (cohérent avec la règle racine "pas de npm pour le front").
  - ajout non prévu au schéma minimal du PRD, documenté dans `fonda/data/README.md` : `categorie` (regroupement dashboard) et `palier_amorce` (reprend la colonne "Palier amorce" du tableau PRD §14, distinct de `paliers` qui reste toujours `["nI","nF"]`).
- Branche `feat/fonda-lot1-contrats`, commit `4555b20`, PR vers `design` ouverte (lien ci-dessous). Pas de merge sans feu vert explicite.
- Codex : non (pas demandé sur ce ticket).

### ☑ T2 — Carte « réponse produite » + correction par profil — révisé le 2026-10-05, 2 passes de critique Codex, **3e critique ciblée en attente avant fusion**
- But : composant saisie courte + moteur 4 profils (sens/orthographe/numerique/exact, PRD §5.1). Tests d'abord.
- Impact prod : nul (développé isolé, non branché).
- DoD : suite de tests verte ✅ (`node --test fonda/engine/*.test.js` — **80/80**, écrite/mise à jour avant chaque révision du moteur) ; profils pilotés par les données de carte ✅.
- Fichiers : `fonda/engine/correction.js`, `correction.test.js`, `carte-reponse-produite.js`, `carte-reponse-produite.test.js` (test d'intégration via DOM factice maison, zéro dépendance), `README.md`.

**Historique de la révision (2026-10-05)** :

**Passe 1** — 1ʳᵉ implémentation (31 tests) → critique Codex : 4 graves (apostrophe/trait d'union trop pardonnés en orthographe, unité fausse comptée réussite, arrondi arrondissait les deux côtés au lieu de fixer une cible, risque de double comptage seconde chance) + 7 moyennes + 1 faible. Corrections : couche de normalisation commune (NFC + typographie → ASCII), orthographe strict sur apostrophe/trait d'union/accents (presque = accent manquant seulement), sens sans repli pluriel mécanique (corrige la collision `chaux→chau`), unité manquante→presque/fausse→faux, arrondi = cible arrondie (pas la réponse élève), epsilon relatif, vide toujours faux, `compteCommeReussite` faux par défaut, contrat seconde chance `{tentative, scored}`. 59/59 tests.

**Passe 2** — 2e critique Codex ciblée (lecture seule) sur ces points précis → encore 2 graves + 5 moyennes : tolérance numérique encore trop permissive (`1000000001`≈`1000000000`, `0`≈`0.0000000000005`, `0,33000...01`≈cible arrondie) ; unité fausse acceptée après mise en minuscule (`8 mA` validé pour `MA`) ; comptage par défaut incomplet (profil inconnu + statut `juste` → `true`) ; arrondi décalé par une nudge absolue trop grossière + non borné (`arrondi:309` accepté) ; unités asymétriques/exposants non gérés (`cm²` vs `cm2`, unité exigée non canonisée) ; ponctuation trop permissive créant des collisions (`cha,t`=`chat`, `-4`=`4`, `1,5`=`15`, `!!!` validé contre une réponse acceptée vide) ; feedback affichant l'attendu brut au lieu de la cible réelle.

Corrections passe 2 (tests d'abord, 21 nouveaux tests) :
- Ponctuation pardonnée réduite à `. ! ?` en position **externe uniquement**, plus jamais `-, +, ,, /` (internes ou externes) — comportement sens/orthographe resserré en conséquence (ex. `porte-monnaie`=`portemonnaie` en sens n'est plus pardonné par défaut).
- Contrôle du vide déplacé **après** normalisation (pas sur la saisie brute) : `!!!` ne matche plus une réponse acceptée vide.
- `compteCommeReussite` valide désormais aussi le profil (`PROFILS.has`) avant tout — un profil inconnu ne compte jamais, même avec statut `juste`.
- Unité : comparaison **sensible à la casse**, et l'unité exigée par la carte passe désormais par la même canonisation typographique + normalisation d'exposants (`²³`→`2 3`) que la saisie (symétrie).
- Arrondi : borné à `[0,10]` (hors bornes → repli exact) ; nudge de correction de l'artefact binaire passée d'absolue (`1e-9`) à **relative** (`Number.EPSILON × 8`, quelques ULPs) — corrige le décalage artificiel sur une cible volontairement sous le seuil (`2.674999999999` reste `2.67`, pas `2.68`).
- Comparaison numérique exacte : même passage à une tolérance **relative à l'échelle** (`Number.EPSILON × 8`) sans aucun plancher absolu — **déviation documentée** vs la suggestion initiale de Codex (`≈1e-9×max(|a|,|b|)`) : ce facteur ne suffit pas, il confond deux grands entiers consécutifs à l'échelle `1e9` ; voir `fonda/engine/README.md` pour le détail.
- Garde-fou global : toute valeur non finie (`Infinity`, ex. un nombre de 310 chiffres) traitée comme invalide → faux, jamais d'exception ; profil inconnu → `evaluerReponse` retourne `faux` au lieu de lever une exception (ancien comportement supprimé).
- Nouvelle fonction exportée `calculerCibleAffichee()` : le feedback du composant UI affiche désormais la cible réellement exigée (valeur arrondie + unité si exigée), plus jamais la réponse acceptée brute.
- README : nouvelle section « Limites connues (hors périmètre collège) » — notation scientifique (`1e3`), signe `+` explicite, espaces internes en profil `exact` : identifiées, volontairement non corrigées (arbitrage Éric).

80/80 tests verts. T1 revalidé. Rien touché hors `/fonda/`.

**3e critique Codex, ciblée en lecture seule** sur les points changés en passe 2 (unité manquante vs fausse, arrondi = cible arrondie, normalisation typographique, comptage par défaut) : à lancer — voir section juste en dessous si déjà réalisée au moment de la lecture, sinon pas encore faite.

**Consigne reçue d'Éric pour cette 3e passe** : si elle ne relève plus que des cas listés dans « Limites connues » du README (notation scientifique, nombres non finis, `+8`, formules à espaces en `exact`), ne plus rien corriger — les signaler et acter pour la fusion.

- Branche `feat/fonda-lot1-reponse-produite`. **Pas de PR/fusion tant que la 3e critique n'a pas eu lieu et sans feu vert explicite d'Éric.**

### ☐ T3 — Tags grp/ctx + verrou de vote
- But : émettre les événements avec `grp` (choisi par le prof, jamais un élève) et `ctx` ; un vote par item et par occurrence (verrou local).
- Impact prod : nul tant que non branché à la page.
- DoD : un événement bien formé par réponse, conforme à T1, zéro identifiant élève.
- Codex : OUI (ré-identification possible ?).

### ☐ T4 — Mode Box-FONDA + menu public
- But : toggle/mode SUR la page existante (pas de lien séparé) + page menu lisant `calendar.json`. Inactif par défaut (feature-flag).
- Impact prod : additif, désactivé par défaut.
- DoD : défi lançable en ≤ 2 clics avec choix du groupe ; menu visible sans auth ; BOX ordinaire strictement inchangé.
- Décisions ouvertes : emplacement du toggle ; forme du feature-flag.
- Codex : non.

### ☐ T5 — Collecte n8n → Sheet
- But : nouveau workflow d'ingestion des événements, livré en JSON à importer, testé sur copie.
- Impact prod : nul si importé/testé hors live.
- DoD : un POST d'événement arrive au Sheet ; les 9 workflows existants intacts.
- Codex : OUI (casse d'un workflow existant ? fuite de donnée ?).

### ☐ T6 — Génération initiale équilibrée (seed Moteur B)
- But : 1er lot de candidates équilibré facile/difficile + nI/nF, modèle plus puissant (Sonnet) avec spec de clarté, routage relecture (fr → Justine, maths → Éric).
- Impact prod : nul (rien publié).
- DoD : candidates EN FILE DE RELECTURE, rien publié automatiquement ; énoncés conformes à la spec de clarté (§5.1/§11).
- Décisions ouvertes : volume du premier lot ; répartition par notion.
- Codex : non (relecture humaine = Justine/Éric).
