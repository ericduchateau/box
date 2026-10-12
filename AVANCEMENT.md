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
- Branche `feat/fonda-lot1-contrats`, commit `4555b20`. **Fusionné** dans `design` (`ba50763`), branche supprimée.
- Codex : non (pas demandé sur ce ticket).

### ☑ T2 — Carte « réponse produite » + correction par profil — révisé le 2026-10-05, 8 passes de critique Codex, **fusionné**
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

**3e critique Codex** (ciblée, lecture seule, sur unité manquante/fausse + arrondi + normalisation typographique + comptage par défaut) → 0 grave, 2 moyennes + 3 faibles + 1 note lexicale, dont 2 jugées hors du périmètre pré-autorisé (« limites connues ») par Éric lui-même après relecture du retour brut : **micro-passe finale** demandée sur seulement 2 points précis (le reste explicitement acté comme limite connue, documenté au README) :
- nouveau statut `carte_invalide` : un attendu (`reponses_acceptees`) incohérent (unité contradictoire avec la carte, ou fraction malformée du type `0,5/1,5`) ne doit **jamais** rendre `juste` — signalé pour relecture, compté faux.
- normalisation du moins en exposant (`⁻`→`-`) côté unité, dans les deux sens (`m·s⁻¹` ≡ `m·s-1`).
- README : ajout de 4 limites connues supplémentaires (précision >~12 chiffres significatifs, `.5`=`5` en `sens`, espaces autour de `/` dans une unité, variantes lexicales type `cœur`/`coeur`).

10 nouveaux tests (90/90) → commit `e0535e6`.

**4e critique Codex, ciblée en lecture seule** UNIQUEMENT sur `carte_invalide` et la normalisation `⁻` (règle d'arrêt : si seulement « limites connues », pas de correction, on acte la fusion) → 2 défauts réels trouvés, **hors limites connues** :
1. **Faux positif (élevé)** : une unité contenant un chiffre et qui correspond bien à la carte (`cm²`/`cm2`, `m·s⁻¹`) était quand même signalée `carte_invalide` — la détection initiale testait « un chiffre dans le reliquat » au lieu de « le reliquat ressemble-t-il à une unité ».
2. **Faux négatif (moyen)** : un reliquat `/` résiduel sans aucun chiffre (`"1/"`, `"1/2/"`) échappait à la détection et validait silencieusement en `juste`.

Corrigé (tests d'abord, 2 nouveaux tests, 92/92) : la détection d'incohérence repose maintenant sur « le reliquat contient-il une lettre (ou `°`/`%`) » — présent et conforme à l'unité déclarée → pas une incohérence (même avec un chiffre) ; absent → toujours incohérent (fraction/forme malformée), qu'il y ait un chiffre ou pas.

**Consigne d'Éric avant la 5e passe** : garder côte à côte les deux tests cœur (unité contradictoire → `carte_invalide` ; unité valide avec chiffre → `juste`), et étendre la table de fractions malformées à l'attendu ET à la saisie élève (`1/`, `1/2/`, `/3`, dénominateur nul `1/0`) — `carte_invalide` si c'est l'attendu, `faux` jamais `juste` si c'est la saisie élève.

**5e critique Codex** (ciblée sur ces deux points) → 1 défaut hors limites connues : une fraction malformée **suivie d'un texte d'unité**, sans `unite` déclarée (`"1/ cm²"`, `"0,5/1,5 cm²"`), échappait encore — le reliquat contenait une lettre donc passait le test, et sans unité déclarée rien ne le comparait. Corrigé : un `/` qui subsiste dans le reliquat est toujours un résidu malformé (une fraction propre comme `3/4` absorbe entièrement son `/` dans la valeur). 93/93 tests, commit `ed7c6de`.

**6e critique Codex** (même points) → 2 nouveaux défauts, le fix précédent ayant été trop large :
1. **Faux positif** : une unité composée légitime contenant elle-même un `/` (`m/s`, `km/h`) était signalée `carte_invalide` — le "tout `/` restant = malformé" ne distinguait pas un `/` d'unité d'un `/` de fraction cassée.
2. **Faux négatif** : une fraction décimale tronquée par le parseur (`"1/2,5"` → seul `1/2` est reconnu comme fraction entière, le reliquat `.5 cm²` commence par un chiffre/point) passait encore, car ce reliquat contenait une lettre et pas de `/`.

Remplacé par une **grammaire explicite** (`RE_UNITE_PLAUSIBLE`) : un reliquat est une unité plausible seulement s'il est une suite de tokens lettres/symboles (`°`, `%`, `µ`, `Ω`), chacun avec exposant optionnel, enchaînés par `/` pour une unité composée. Tout le reste (vide avant `/`, commence par un chiffre/point, `/` mal placé) est malformé. 95/95 tests, commit `6edcdef`.

**7e critique Codex** (même points) → 1 défaut : une unité à 2+ facteurs avec exposant sur un facteur du milieu séparé par un **point médian** (`m²·s⁻¹`, `kg·m²/s²`) était rejetée — le `·` était inclus dans le token lui-même au lieu d'être un joineur, donc bloquait la suite après un exposant. Corrigé : `·` traité comme joineur au même titre que `/`. 96/96 tests, commit `c378924`.

**8e critique Codex** (vérification exhaustive, 180 000+ cas générés : unités à 2-3 facteurs toutes combinaisons `/`/`·`/exposant-à-toute-position, fractions malformées avec séparateurs multiples/signes/espaces/virgule-point mélangés) → **aucune faille, rien au-delà des limites connues du README**. Conforme à la règle d'arrêt fixée par Éric avant la 5e passe — reste à confirmer explicitement le feu vert de fusion.

**État final T2** : 96/96 tests verts, T1 revalidé, rien touché hors `/fonda/`. Branche `feat/fonda-lot1-reponse-produite` (8 commits de révision).

**Fusionné** le 2026-10-05 sur feu vert explicite d'Éric : `git merge --no-ff` dans `design` (pas de `gh`/PR, même méthode que T1), hash de merge `6aa73e8`. `main` non touché (`7ea4f28`, identique au tag `prod-stable-2026-10-05`). Branches `feat/fonda-lot1-contrats` et `feat/fonda-lot1-reponse-produite` supprimées (locale + origin) après fusion.

### ☑ T3 — Émission d'événements : grp/ctx, verrou un-vote, câblage « 1ʳᵉ tentative scorée » — fait le 2026-10-05
- But : construire, verrouiller et mettre **localement** en file (PRD §3.2) un événement de mesure par réponse scorée (T2) ; zéro réseau (la collecte n8n est T5).
- Impact prod : nul (développé isolé, pas de réseau, non branché à `index.html` — câblage = T4).
- DoD : 26 nouveaux tests ✅ (`node --test fonda/engine/evenements.test.js`), suite complète 122/122 ✅, `node fonda/scripts/validate.js` toujours conforme (31 vérifications), rien touché hors `/fonda/` ✅.
- Fichiers : `fonda/data/classes.json` (20 classes, format `"601"`...`"305"`), `fonda/data/destinataires.json` (vide, posé pour plus tard), `fonda/engine/evenements.js`, `evenements.test.js`, `fonda/scripts/validate.js` (étendu, pas réécrit — voir Décisions), READMEs (`fonda/engine/`, `fonda/data/`).

**Étape 0 — cas-limites (Codex, lecture seule)** : table complète demandée avant tout code (anonymat, `grp` prof vs dérivé, verrou multi-scénarios, `rang_local`/`dt_jours` appareil perso vs partagé, seconde chance). Collée brute à Éric, qui a ensuite tranché lui-même les points ouverts (identité d'occurrence, clé du verrou, format `defi_id`) dans le ticket d'implémentation — pas de 2e aller-retour Codex nécessaire à cette étape.

**Décisions prises (ticket d'Éric)** :
- `defi_id` = `defi_{annee}-w{semaine}_{grp 3 chiffres}_{notion-slug}` (ex. `defi_2026-w41_601_fractions`) : `grp` s'en extrait, n'est **jamais** saisi par l'élève (G2/G3).
- Verrou « un vote » scellé sous `${defi_id}::${item_id}` (imposé par le ticket) — scope **par occurrence**.
- Historique (`rang_local`/`dt_jours`) scellé sous `(set_id, item_id)` (ma proposition, confirmée avant codage) — scope **par item, à travers les occurrences** : résout l'ambiguïté « `item_id` unique seulement dans un jeu » relevée à l'étape 0.
- `fonda/scripts/validate.js` **refactoré, pas dupliqué** : extraction de `validateEventFields()` + export `validerEvenement(event, notionIds)` réutilisable sans I/O disque, `main()` gardé derrière `require.main === module` pour ne plus s'exécuter au `require()`. Renforcé en **liste blanche stricte** des 11 champs (avant : blocklist de noms connus `nom`/`email`/... ; un champ inattendu non listé, ex. `uuid`, passait). Vérifié : `node fonda/scripts/validate.js` toujours 31/31 après refactor (T1 non régressé).
- `ts` tronqué (pas arrondi au plus proche) à l'heure pleine UTC — anti-réidentification.
- `dt_jours` : horloge reculée/date future → bornée à `0`, jamais négatif/`NaN` (plutôt que refuser l'émission — l'événement reste légitime, seule la mesure de délai est dégradée).
- Verrou **synchrone** (vérification + écriture sans attente) : correct pour double-clic/rechargement/2 onglets **dans le même onglet**. Entre deux onglets réellement distincts, `localStorage` n'offre pas de comparaison-et-échange atomique — limite théorique documentée au README, PAS corrigée (la Web Locks API y remédierait mais rendrait async tout le chemin depuis `carte-reponse-produite.js` de T2, hors scope). Signalé explicitement à Éric avant codage, pas d'objection.
- Seconde chance (`scored:false`) : **aucune écriture**, pas seulement aucune émission — ni verrou, ni historique touchés, pour ne laisser aucune trace mesurable.

**Critique Codex finale** (lecture seule, ciblée anonymat + verrou + non-émission seconde chance, commit `9c592c2`) → 6 points, dont 3 confirmés comme bugs réels (hors « seconde chance », qui n'a montré aucun défaut) :
1. **Élevée** : un stockage JSON syntaxiquement valide mais de mauvaise forme (`verrous` remplacé par `[]`, etc.) était silencieusement réinitialisé à vide au lieu d'être refusé — rouvrait un vote déjà scellé.
2. **Moyenne** : les 3 écritures (verrou/historique/file, clés séparées) ne formaient pas une transaction — un échec sur la 3ᵉ laissait le verrou posé sans l'événement en file (mesure perdue silencieusement).
3. **Moyenne** : clé composite `a + '::' + b` pouvait collisionner si `a`/`b` contenaient eux-mêmes `::`.
4. **Moyenne** : le retour d'erreur (`erreurs`) recopiait la valeur brute du champ fautif (ex. un `notion_id` invalide) — remonté par `soumettreTentative` sans que rien ne le consomme, mais un canal de fuite inutile.
5. **Moyenne** : `EVENT_FIELDS` (liste blanche) exporté comme `Set` mutable — `Object.freeze()` sur un `Set` ne bloque PAS `.add()`/`.delete()` (ce sont des méthodes sur un slot interne, pas une propriété ; vérifié : `Object.freeze(new Set(...)).add(...)` réussit silencieusement).
6. **Élevée, signalée mais pas un bug de code** : le contenu de `itemId`/`setId`/`notionId`/`defiId` n'était vérifié dans AUCUN format — un nom d'élève y passerait tel quel. Question de scope posée à Éric (T3 vs T1/T6).

**Décision d'Éric sur le point 6** : ni « documenter comme limite » ni « format métier strict ». Garde-fou de **nature**, pas de format : chaîne non vide, ≤ 64 car., `[A-Za-z0-9._-]` uniquement (pas d'espace/texte libre) sur `itemId`/`setId`/`notionId` — bloque un nom/une phrase sans deviner un format sémantique que seuls T1/T6 connaissent. La cohérence référentielle (l'id existe-t-il vraiment ?) reste garantie en amont, documentée comme telle.

**Corrections appliquées** (tests d'abord, 7 nouveaux tests, 33/33) :
- Refonte du stockage : **un seul blob JSON** (`fonda_evt_mesure` = `{verrous, historique, file}`) écrit en **une seule** `setItem()` — élimine structurellement la désynchronisation (point 2) ; une forme de blob incorrecte → `stockage_corrompu`, jamais de réinitialisation silencieuse (point 1).
- Clés composites via `JSON.stringify([a, b])` au lieu de `a + '::' + b` (point 3).
- `soumettreTentative` ne renvoie plus que `{ emis, raison }` — plus de champ `erreurs` (point 4).
- `fonda/scripts/validate.js` : `EVENT_FIELDS` remplacé par `EVENT_FIELDS_LIST`, un **tableau** gelé (`Object.freeze` fonctionne réellement sur un tableau, contrairement à un `Set`) ; le `Set` de travail est reconstruit à chaque appel, jamais partagé muable (point 5).
- Nouvelle fonction `estIdentifiantPlausible()` + `raison: 'identifiant_invalide'` (point 6, décision Éric ci-dessus).
- Limite notée au README (pas corrigée, hypothèse documentée) : `validerEvenement()` suppose un objet ordinaire (propriétés propres énumérables) — un objet forgé avec un `toJSON` hérité pourrait en théorie contourner la liste blanche ; `soumettreTentative` ne construit jamais un tel objet, ce n'est un risque que pour un appel externe direct et adversarial de `validerEvenement()`.

129/129 tests (suite complète T1+T2+T3), `node fonda/scripts/validate.js` toujours 31/31. Rien touché hors `/fonda/`.

**6e critique Codex** (lecture seule, commit `836a7c1`) : lancée en effort "medium" avec consigne large → tuée après 30 min (limite max) sans jamais répondre, aucune sortie exploitable. Relancée en effort **"low"**, consigne resserrée à 3 questions fermées (OUI/NON + 1 ligne), ciblée uniquement anonymat — répond en quelques secondes :
1. Un champ hors schéma ou du texte libre/nom dans `item_id`/`set_id`/`notion_id`/`defi_id` ? → **OUI** : aucun champ supplémentaire ne passe, mais un identifiant sans espace type `jean-dupont` passe le garde-fou de nature (charset).
2. `grp` hors `classes.json` ? → **OUI** si la liste `classesAutorisees` injectée diverge du vrai fichier — le module ne relit jamais `classes.json` lui-même.
3. Réponse brute/feedback/horodatage trop précis peuvent fuiter ? → **NON** par le chemin normal (jamais copiés) ; `ts` est tronqué à la construction mais le validateur générique seul (`validerEvenement`) accepte une précision supérieure — délibéré (sert aussi à valider la fixture T1 aux minutes arbitraires).

**Investigation demandée par Éric avant de qualifier le point 1** : provenance réelle des 4 champs, pas une réponse uniforme.
- `grp` : gouverné par `classes.json` (roster fermé) — risque nul dans ce module, seulement un contrat d'intégration (liste injectée = responsabilité T4).
- `notion_id` : gouverné par le pattern `^(fr|maths)\.[a-z0-9-]+$` de T1 (11 entrées fixes) — garde-fou de nature = filet de sécurité, pas la vraie défense.
- `defi_id` (slug) : dérive du vrai slug de la notion — sûr SI T4 le fait correctement (même frontière de confiance que `grp`).
- `item_id`/`set_id` : **aucune garantie amont**. Vérifié : le PRD §3.6 nomme `card_id` (Moteur B/relecture) et §3.2 nomme `item_id`/`set_id` (événements) sans jamais relier les deux ; aucun algorithme de génération nulle part dans le repo ; T6 (génération initiale) n'existe pas encore.

**Décision d'Éric** : garder le garde-fou de nature tel quel sur `item_id`/`set_id` (ne PAS le durcir — une heuristique anti-nom casserait des ids T6 inconnus aujourd'hui, mauvais compromis). Documenté comme garantie **déléguée à T6**, pas comme risque simplement "assumé" — avec une dette bloquante taguée ci-dessous.

#### 🔖 DETTE T6 — item_id/set_id DOIVENT venir de valeurs système
**T6 DOIT générer `item_id`/`set_id` à partir de valeurs système (index de carte, slug de notion, id de jeu), jamais à partir de texte libre d'origine humaine.** Le garde-fou de nature de T3 (charset `[A-Za-z0-9._-]`, ≤ 64) ne distingue pas un nom sans espace d'un id technique légitime — la garantie d'anonymat réelle sur ces deux champs dépend entièrement de la règle de génération de T6. **À vérifier explicitement à la revue de T6**, avant toute fusion de ce ticket.

#### 🔖 DETTE T4 — defi_id (slug) et notion_id DOIVENT venir du référentiel/calendrier réels
**T4 DOIT dériver le slug du `defi_id` et `notion_id` du vrai référentiel/calendrier (`fonda/data/referentiel.json`, `calendar.json`), jamais d'une valeur ad hoc.** De même, `classesAutorisees` passé à `soumettreTentative` DOIT être le contenu réel de `fonda/data/classes.json`, jamais une liste reconstruite à la main. **À vérifier explicitement à la revue de T4.**

Documentation ajoutée (README `fonda/engine/`) pour les points 2 et 3, avec test verrouillant chacun : `(doc point 2)` prouve que `classesAutorisees` est injecté et non relu ; `(doc point 3)` prouve que `validerEvenement()` seul accepte un `ts` non tronqué (délibéré, pour ne pas casser la fixture T1) alors que `soumettreTentative` tronque toujours.

131/131 tests (suite complète T1+T2+T3), `node fonda/scripts/validate.js` toujours 31/31. Rien touché hors `/fonda/`.

**Fusionné** le 2026-10-05 sur feu vert explicite d'Éric : hash de merge `0086046`. Branche `feat/fonda-lot1-evenements` supprimée (locale + origin) après fusion.

### ☑ T4 — Mode Box-FONDA sur la page existante + liens par classe + page par niveau — fait le 2026-10-05
- But : `?fonda=1` charge le mode FONDA (lecture seule : classes/référentiel/calendrier) ; décline un défi « notion × niveau » en un lien par classe ; page par niveau (lien + copier, par classe) ; résolution d'un lien élève (grp hérité, jamais choisi) ; contexte invalide → entraînement, aucune émission.
- Impact prod : nul si flag absent — **prouvé**, pas supposé (voir DoD).
- DoD :
  - **Non-régression stricte** ✅ : `fonda/page/non-regression.test.js` (12 tests) — la branche `fonda` + son `return` est la toute première instruction de `init()` ; comparaison **directe** avec `git show main:js/app.js` exécuté dans le même harnais (`vm`) : séquence d'appels identique pour `''`, `?set=...`, `?action=delete` ; `index.html` byte-identique à `main` ; zéro `<script>`/`<link>` statique vers `/fonda/`.
  - **Liens par classe** ✅ : `fonda/engine/liens.test.js` (18 tests) — niveau 6e → exactement 5 liens (601..605), chaque `defi_id` parsable et son grp/slug correspondant au vrai référentiel ; `classesDuNiveau` ne retourne jamais un grp hors `classes.json`.
  - **Résolution + entraînement** ✅ : `fonda/page/bootstrap.test.js` (9 tests) — lien valide → contexte résolu sans exception ; `defi_id` expiré/malformé/hors roster/calendrier vide → page non blanche, aucune émission, aucune exception.
  - `node fonda/scripts/validate.js` toujours 31/31. **170/170 tests** (suite complète T1-T4).
- Fichiers : `js/app.js` (2 ajouts purement additifs : branche `fonda` + `initFonda()`, et un export guard no-op en navigateur), `fonda/engine/evenements.js` (étendu : `DEFI_ID_PATTERN` capture 4 groupes au lieu d'1, nouveau `parserDefiId()` exporté — 131 tests T1-T3 revérifiés inchangés), `fonda/engine/liens.js` + `liens.test.js`, `fonda/page/bootstrap.js` + `bootstrap.test.js` + `non-regression.test.js`.

**Avant de coder, confirmé par Éric** : (a) injection via `App.initFonda()` qui crée dynamiquement un `<script>` (zéro tag statique) — validé sans objection ; (b) URLs sur `index.html?fonda=1&...` (cohérent avec `?set=`/`?action=` existants), `&defi=defi_...` pour un lien élève, `&page=niveau&niveau=6e[&semaine=...]` pour la page niveau — validé ; (c) QR — **tranché : pas de lib en T4**, lien + bouton copier seulement.

**Deux tests supplémentaires exigés par Éric avant codage**, tous deux livrés :
1. Non-régression stricte (isolation totale du `return`, comparaison directe avec `main`) — voir DoD ci-dessus.
2. `defi` introuvable (expiré / faute de frappe / semaine passée) → entraînement, aucune émission, aucune exception, pas de page blanche — `bootstrap.test.js`, 6 variantes + calendrier vide.

**Décision d'Éric en cours de route — contenu réel des cartes** : T4 ne fetch PAS de contenu de jeu (pas de convention `set_id`→Drive définie, ça appartient à T6). `lancerDefi(contexte)` existe, reçoit un contexte résolu et sûr, et affiche « contenu à venir » — c'est le point de branchement vers T2/T3 documenté dans `fonda/engine/README.md`.

#### 🔖 DETTE T6 — brancher le contenu réel du jeu sur lancerDefi()
**Quand T6 définira la convention `set_id` → Drive, remplacer le message « contenu à venir » de `lancerDefi()` (`fonda/page/bootstrap.js`) par un vrai fetch du jeu + `FondaCarteReponseProduite.montrerCarteReponseProduite(...)`, et dans son `onResultat`, appeler `FondaEvenements.soumettreTentative({...contexte, reussite, scored, ...})`.** Le contexte (`grp`/`notionId`/`palier`/`setId`) est déjà résolu et sûr — ne manque que le contenu. **À vérifier explicitement à la revue de T6.**

#### 🔖 DETTE QR — lien + copier seulement en T4
**Pas de lib QR vendorée en T4** (décision Éric : zéro npm pour le front, et il voulait voir la proposition avant toute intégration — a tranché pour la reporter). La page niveau n'a qu'un lien + bouton copier. **Ticket ultérieur dédié** quand le besoin réel se confirme (ex. pour Pronote/affichage papier) — proposer alors une lib vendorée minimale (ex. `qrcode-generator`, kazuhikoarase, MIT, zéro dépendance) pour validation avant intégration.

**Critique Codex non-régression** (lecture seule, commit `e2a266f`, angle différent des tickets précédents : plus l'anonymat, mais « les collègues voient-ils une différence ? ») → **aucune régression trouvée**. Vérifié : 20 URLs flag OFF (dont fragments `#fonda=1`, `?` manquant, casse `FONDA=1`, valeurs `0`/`true`/vide/`01`/`1x`/`1 `, paramètres imbriqués) comparées à `main` dans le même harnais vm — appels identiques, zéro injection ; 5 URLs flag ON (dont encodage `%31`, paramètre dupliqué) → injection confirmée. Deux nuances relevées, aucune retenue comme régression :
1. « Même JS exécuté » pas littéralement exact : le test du flag et l'export CommonJS sont évalués en plus, sans aucun effet observable (ni DOM, ni requête) — c'est le « strict minimum » explicitement autorisé par le ticket.
2. `initFonda()` ne revérifie pas elle-même le flag — un appel manuel `App.initFonda()` depuis la console l'activerait. Codex confirme lui-même qu'aucun parcours BOX existant ne fait cet appel : pas un chemin d'exécution réel, juste une garantie théorique « trop forte » pour être exigée.

**Fusionné** le 2026-10-05 sur feu vert explicite d'Éric, vérifié aussi à l'œil en navigateur local (BOX ordinaire inchangé, console propre) : hash de merge `f9d5817`. Branche `feat/fonda-lot1-mode-page` supprimée (locale + origin).

### Intermède — sauvegarde n8n + garde-fou production (avant T5)
Avant de toucher à la collecte réseau : export en lecture seule (`n8n_list_workflows`/`n8n_get_workflow`, MCP n8n) des 9 workflows BOX actifs en prod → `/n8n/backup-2026-10-05/` (un fichier par workflow + README listant rôle/webhook de chacun). **Aucun workflow modifié, activé ni désactivé.** Clé API Anthropic en clair dans 2 workflows (génération) → **redigée** avant commit (repo public GitHub Pages, la committer en clair l'aurait rendue indexable) ; vraie valeur consultable uniquement dans n8n. Commit `6d3f1aa` sur `design`.

Ajout d'un garde-fou permanent dans `AGENTS.md` (section G1-G7) : interdiction de créer/modifier/activer/désactiver un workflow de prod sans validation explicite d'Éric dans la conversation ; tout nouveau workflow a son propre chemin de webhook et ne touche aucun des 9 existants ; testé en exécution manuelle avant activation. Commit `141e26e` sur `design`.

### ☑ T5 — Collecte des événements : webhook n8n + émission depuis la file locale — fait le 2026-10-05
- But : vider la file locale (T3) vers un nouveau workflow n8n `POST /box-fonda-events` qui ajoute une ligne au Sheet BOX-FONDA. Rien d'autre (pas de tableau de bord, pas de calcul, pas de génération).
- Impact prod : nul — workflow livré **inactif**, importé/activé par Éric uniquement ; aucune action n8n faite par l'IA (règle n8n-production).
- DoD :
  - Émetteur navigateur (`fonda/engine/emission.js`, 11 tests) ✅ : file vidée dans l'ordre ; succès → retiré de la file ; échec (réseau, exception, réponse négative) → reste en file, **même objet** renvoyé au réessai (même `ts`) ; un échec n'empêche pas les suivants ; corps strictement limité aux 11 champs (reconstruit champ par champ, jamais par spread — vérifié même avec un événement en file volontairement corrompu avec des champs étrangers) ; `webhookUrl` absente → mode dégradé, aucune tentative, aucune exception, révision jamais bloquée.
  - Workflow n8n (`n8n/fonda-collecte/box-fonda-events.json`, livré inactif) : liste blanche stricte des 11 champs côté serveur aussi (défense en profondeur) ; CORS prévu (node OPTIONS dédié + `allowedOrigins` + en-têtes `Access-Control-Allow-Origin` sur les 3 réponses) ; ID du Sheet référencé via un node `Config` dédié (un seul endroit à éditer), jamais en dur dans le node Google Sheets ; aucune IP écrite ni utilisée pour dédoublonner ; 12ᵉ colonne optionnelle `recu_serveur_ts` (horodatage serveur, explicitement autorisé par le ticket), rien d'autre.
  - `node fonda/scripts/validate.js` toujours 31/31. **184/184 tests** (suite complète T1-T5 après la critique ci-dessous, hors workflow n8n lui-même, non testable en Node).
- Fichiers : `fonda/engine/emission.js` + `emission.test.js`, `fonda/engine/evenements.js` (étendu, purement additif : `lireFile()`/`retirerDeFile()` exportés — 170 tests T1-T4 revérifiés inchangés), `n8n/fonda-collecte/box-fonda-events.json`, `n8n/fonda-collecte/README.md` (procédure d'import pas à pas pour Éric).

**Décisions prises** :
- `evenements.js` étendu plutôt que dupliqué : `emission.js` a besoin de lire/retirer des entrées de la file sans connaître la forme interne du blob `fonda_evt_mesure` — `lireFile()`/`retirerDeFile()` réutilisent `lireMesure()` déjà existant, une seule écriture comme `soumettreTentative`.
- Retrait de la file **par événement, immédiatement après confirmation** (pas en lot à la fin du passage) : minimise la fenêtre où un crash pourrait faire perdre la trace qu'un événement a déjà été confirmé envoyé.
- Identité d'un événement en file = `(defi_id, item_id)` (même clé que le verrou T3, par construction au plus un événement scellé par couple) — pas une égalité profonde de l'objet, robuste si l'appelant reconstruit un événement plutôt que de garder la référence.
- **Limite documentée, pas corrigée** : pas d'exactly-once réseau — si la réponse serveur se perd après un traitement réussi, l'événement est réémis au prochain passage (ligne dupliquée possible dans ce seul scénario, jamais de perte). Nécessiterait un jeton d'idempotence côté serveur, hors scope de ce ticket.
- Workflow n8n : credential Google Sheets laissé vide (type distinct du credential Drive des autres workflows, même si même compte Google) — deviner un ID aurait été une fabrication, pas une configuration.

**Critique Codex** (lecture seule, double angle anonymat + non-régression n8n, commit `88fb7b2`) :
- **Non-régression n8n : aucune collision trouvée.** Comparaison systématique avec les 9 sauvegardes (`n8n/backup-2026-10-05/`) : aucun chemin partagé, aucune référence à leurs IDs de workflow/fichier/dossier/credential. `active: false` confirmé ; aucun import/activation réel possible (Codex n'avait accès qu'aux fichiers, pas au MCP n8n).
- **Anonymat : 1 défaut réel, gravité moyenne** — reproduit avec des données synthétiques : la liste blanche des 11 champs protège les **noms**, pas le **contenu**. Un événement altéré avec `set_id: "IP=192.0.2.10; device=synthetic"` passait la validation (clés présentes, types basiques corrects) aussi bien côté émetteur navigateur que côté workflow n8n ; de même un `ts` précis à la milliseconde (au lieu de tronqué à l'heure) n'était pas rejeté. Chemin d'exploitation : file locale altérée (devtools) ou appel direct au webhook contournant `soumettreTentative`.
- Précision non retenue comme défaut : le Sheet a 12 colonnes (11 + `recu_serveur_ts`) — explicitement pré-autorisé par le ticket, pas une fuite.

**Corrigé** (tests d'abord, 3 nouveaux tests emission.js) :
- `evenements.js::formeEvenementPlausible()` (export additif) : contrôle de FORME au-delà des noms de champs — `grp` 3 chiffres cohérent avec le grp encodé dans `defi_id`, `notion_id` au pattern référentiel, `set_id`/`item_id` sans texte libre (réutilise `estIdentifiantPlausible` déjà en place), `ts` tronqué à l'heure.
- `emission.js` appelle ce contrôle juste avant l'envoi, en plus de `validerEvenement()` — même traitement que les autres événements invalides (`invalides`, jamais envoyé, ne bloque pas les suivants).
- **Même règle dupliquée dans `n8n/fonda-collecte/box-fonda-events.json`** (le Code node ne peut pas `require()` le dépôt) — les trois cas reproduits par Codex (métadonnée dans `set_id`, `ts` non tronqué, `grp` incohérent) revérifiés rejetés après le correctif, cas normal toujours accepté.

184/184 tests (suite complète T1-T5), `node fonda/scripts/validate.js` toujours 31/31.

- Branche `feat/fonda-lot1-collecte`. **Prêt pour fusion — en attente du feu vert explicite d'Éric. T6 non démarré.**

---

### ☑ T-SEC — Sécurisation de la publication (5 correctifs sur workflows n8n existants) — fait le 2026-10-06
- **Déclenché par une critique Codex sur la SPEC T6b** (pas encore codée) qui a trouvé un contournement réel déjà actif en prod : l'ancien lien `/box-validate` (conservé pour compat, voir AGENTS.md) publie un jeu entier en bloc sans aucune notion de relecture carte par carte — un jeu Box-FONDA pourrait donc être publié sans jamais passer par `box-select`, peu importe ce que T6b ajouterait par ailleurs. Quatre autres angles morts trouvés dans le même passage : `box-select-confirm` acceptable en POST direct sans preuve de passage par la page GET (pas de CSRF) ; `question`/`reponse` non échappées dans la page de relecture (injection HTML) ; `box-set` servait n'importe quel fichier Drive sans vérifier sa présence au catalogue (exposition d'une candidate non publiée).
- **Règle d'or explicite d'Éric** : ne rien casser pour les collègues — un prof utilisant BOX ordinaire ne doit voir aucune différence ; en cas de doute, laisser passer comme avant plutôt que refuser un jeu légitime.
- **5 correctifs**, livrés en JSON (`n8n/t-sec-2026-10-06/`), **rien importé/activé/modifié dans n8n** par cette session :
  1. `box-validate` refuse un jeu Box-FONDA (`type === "fonda"`) non relu (`revue_carte_par_carte !== true`) — liste blanche positive, jamais de refus sur une absence de champ ou un ancien jeu.
  2. `revue_carte_par_carte` posé à `false` par les deux générations (BOX ordinaire et FONDA), passé à `true` **uniquement** par `box-select-confirm`.
  3. Jeton HMAC-SHA256 (nœud `Crypto` natif) anti-POST-direct sur `box-select-confirm`, lié à `(file_id, code)`.
  4. Échappement HTML complet (question/réponse/difficulté/matière/niveau/notion/numéro) dans la page de relecture et les pages de succès/rejet.
  5. `box-set` vérifie la présence au catalogue avant de servir une fiche (404 sinon).
- **2 passes de critique Codex sur ce ticket lui-même** (ciblée, en lecture seule, comme pour T6a) :
  - 1ʳᵉ passe (commit `0ec2522`) : a confirmé les 5 correctifs structurellement corrects (aucun contournement du refus `/box-validate`, aucun contournement de `Token valide ?`, contrôle catalogue étanche, isolation TEST du vrai id catalogue parfaite) — **mais** a trouvé 6 défauts dans l'implémentation elle-même : (1) secret HMAC configuré sur un paramètre que le nœud `Crypto` v1 ne lit pas (la credential `crypto` est ignorée en v1) ; (2) câblage cassé du GET `box-select` (deux branches parallèles vers le même nœud sans fusion — aurait cassé la page pour TOUS les jeux, pas seulement FONDA) ; (3) `c.numero` oublié dans l'échappement HTML ; (4) les emails des copies de TEST pointaient vers les webhooks de **prod** ; (5) le README prétendait qu'une entrée apparaissait dans le catalogue de TEST, alors que l'écriture y est volontairement neutralisée (double filet) ; (6) `responseCode: 404` posé au mauvais endroit (`parameters` au lieu de `options`), donc jamais appliqué (vrai code retourné : 200).
  - **Tous corrigés** : `Crypto` passé en `typeVersion: 2` (lit réellement la credential) ; GET `box-select` relinéarisé en chaîne strictement séquentielle (`Calculer Token` → `Download Flashcards` → `Construire page selection`, `fileId` lu par référence croisée `$('Extraire parametres')` plutôt que `$json` pour rester robuste à l'ordre) — **vérifié par simulation locale du flux complet** (binaire + jeton + échappement tous présents dans le HTML produit, y compris pour `numero` et `notion`) ; échappement étendu à `numero` et à `notion` dans les pages de succès/rejet (champ `notion_html` dédié) ; liens email des générations TEST repointés vers `/box-select-test` ; README réécrit pour refléter honnêtement le double filet (plus de promesse d'entrée catalogue persistée en TEST, étape 4 adaptée pour seeder `catalogue-TEST.json` à la main) ; `responseCode` déplacé dans `options`.
  - 2ᵉ passe (confirmation) : **à relancer avant tout import**, sur le commit qui porte ces 6 correctifs.
- **🔖 Dette inscrite, pas traitée** : le jeton HMAC prouve qu'un jeton a été obtenu pour `(file_id, code)` — ni expiration, ni lien au contenu précis des cartes présentées au relecteur. N'atteste pas qu'une relecture humaine a eu lieu sur cette version exacte du fichier, seulement qu'une requête a transité par la page GET. Durcissement de 2ᵉ niveau (expiration, liaison à un hash du contenu) envisageable plus tard si le besoin se confirme.
- `fonda/data/destinataires.json` étendu (section `relecteurs`, adresses de TEST eric/justine) en préparation du routage de relecture T6b — `justine` marquée `_TEST`, à remplacer avant toute mise en service réelle.
- Branche `feat/box-tsec-securisation-publication`, créée depuis `design` (pas depuis `feat/fonda-lot1-generation`, chantier distinct). **Pas de merge — en attente d'une critique de confirmation propre, puis du feu vert d'Éric et de ses propres tests sur les copies `(TEST)`.**

### ☑ T6a — Moteur de génération imprenable (chaîne + validation, zéro réseau) — fait le 2026-10-06
- **Scinde l'ancien ticket T6** (chaîne + lot pilote de qualité) en T6a (ce ticket : moteur imprenable) + reste (correction.js, vrai lot pilote via API — voir dettes ci-dessous). Déclenché par une critique Codex sur le 1ᵉʳ T6 (commit `0e49a01`) qui a trouvé que le dépôt faisait **confiance** à la candidate entrante pour `statut`/`matiere`/`relecteur`, et que 42/144 réponses de référence du lot pilote étaient incompatibles avec le correcteur T2 réel.
- But : fermer G4 au dépôt (plus de confiance) + les bugs structurels de moteur relevés (#12). **Aucune réécriture éditoriale de contenu.**
- **G4 imprenable** (`fonda/engine/generation.js::deposerEnRelecture`) : `statut` est désormais **FORCÉ à `"attente"`** pour toute candidate déposée (toute valeur entrante écrasée) ; `matiere`/`relecteur` sont **dérivés du référentiel réel** (`notions`, passé en option) via `notion_id` — plus jamais lus/conservés depuis la candidate ; `notion_id` absent du référentiel fourni → rejet (jamais de routage par défaut, échoue fermé si `notions` est omis/vide).
- **Intégrité structurelle (#12)** : gel **profond** (candidate + `reponses_acceptees` — cloné avant gel, jamais la référence reçue : muter le tableau d'origine après coup ne mute plus la candidate déposée) ; unicité `(set_id, item_id)` et cohérence `set_id` ↔ `notion_id` ↔ `palier` vérifiées au dépôt (un doublon ou un id de jeu d'une autre notion/palier est rejeté).
- **2ᵉ passe de critique Codex, ciblée sur ce moteur durci lui-même** (commit `ebdcdc3`) : a trouvé que « imprenable » restait excessif — (#1, élevée) une entrée de `notions` incohérente (matiere/relecteur qui ne correspondent pas) ou dupliquée routait encore sur une valeur arbitraire ; (#2) le gel ne portait que sur `reponses_acceptees`, pas sur un champ imbriqué quelconque ; (#3) la cohérence `set_id`↔notion ne comparait que le slug (deux notions de matières différentes partageant un slug pouvaient revendiquer le même `set_id`) ; (#4, risque théorique) un getter/`toJSON` forgé pouvait faire diverger la valeur validée de la valeur déposée ; (#6) les tests ne verrouillaient pas le contrat (`Object.seal` ou un dédoublonnage sur `set_id` seul passaient encore les 34 tests).
- **Tous corrigés** (sauf #5, requalifié en nuance de vocabulaire — voir ci-dessous) : `construireIndexNotions` retire de l'index toute entrée incohérente ou dupliquée (poison, jamais "la dernière entrée gagne") ; gel PROFOND récursif générique (`clonerProfond`/`gelProfond`, tout niveau d'imbrication, remplace le traitement spécial de `reponses_acceptees`) ; garde supplémentaire au dépôt empêchant deux `notion_id` de revendiquer le même `set_id` dans un même lot ; aller-retour JSON unique avant toute lecture de champ (neutralise un getter/`toJSON` à bas coût — risque théorique, le script pilote ne construit que des objets simples) ; 7 nouveaux tests ciblant précisément chacun des points (dont un test `Object.seal` et un test dédoublonnage-sur-set_id-seul, repris tels que Codex les a formulés).
- **3ᵉ passe de critique Codex (confirmation, commit `b58451d`)**, consigne explicite « sois honnête si c'est maintenant solide, ne cherche pas de faille artificielle » : a confirmé les 5 points fermés (vérifié par mutation du code — revenir à `index.set`, `Object.seal`, dédoublonnage sur `set_id` seul, suppression de la garde set_id/notion, ou du gel limité à `reponses_acceptees` fait chuter un test à chaque fois) et trouvé 2 nouveaux défauts réels + 1 limite déjà documentée et acceptée :
  - **(réel, corrigé) `clonerProfond` vulnérable à une clé `__proto__`** (JSON ordinaire, `JSON.parse('{"__proto__":{...}}')`, zéro getter/code) : l'affectation `clone[k] = …` basculait sur le setter exotique `Object.prototype.__proto__` au lieu de créer une propriété propre — le contenu imbriqué échappait à `Object.keys`, donc au gel. **Corrigé** : `Object.defineProperty` à la place (crée toujours une propriété littérale, quel que soit son nom).
  - **(réel, corrigé) `construireIndexNotions` relisait `matiere`/`relecteur` DEUX FOIS** (vérification de cohérence, puis stockage dans l'index) — un getter changeant de valeur entre les deux lectures pouvait router une candidate sur une paire jamais vérifiée. **Corrigé** : même traitement que pour une candidate (aller-retour JSON, une seule lecture figée par entrée de `notions`).
  - **(limite déjà documentée, acceptée telle quelle) la garde set_id↔notion_id et le dédoublonnage (set_id,item_id) sont scopés à UN SEUL appel de `deposerEnRelecture`** — une collision reste possible entre deux appels successifs (le référentiel réel a 12 slugs distincts : ce scénario ne s'y produit pas aujourd'hui). Le contrat (explicitement "dans ce lot") est respecté ; ce n'est pas un bug, juste une portée à garder en tête si une future consolidation combine plusieurs dépôts.
  - 3 trous de couverture de tests identifiés par mutation (gel non-récursif sur un TABLEAU d'objets, aller-retour JSON remplacé par un simple spread, 3ᵉ occurrence d'un id dupliqué) — **4 nouveaux tests ajoutés**, dont un qui verrouille littéralement le scénario que Codex a utilisé pour le démontrer.
- Tests : `generation.test.js` passe de 27 → 34 (1ʳᵉ critique) → 41 (2ᵉ critique) → **45** (3ᵉ critique). Suite complète **247/247** (voir aussi correction.js et le lot pilote ci-dessous).
- **Dette ids (T6) LEVÉE** : `set_id`/`item_id` dérivés uniquement de `(notion_id, palier, séquence)`/index, jamais du texte de la carte — motif vérifiable (`^set_fonda_[a-z0-9-]+_n[IF]_\d{2}$`, `^it\d{2}$`). Voir `fonda/engine/README.md`.
- **Requalification du lot pilote** (`fonda/data/pilote-t6-relecture.json`) : désormais documenté comme **fixture technique** — il exerce la chaîne (ids, schéma, anti-clone, routage), **PAS un échantillon validé de qualité pédagogique**. 42/144 réponses de référence échouaient initialement contre le vrai correcteur T2. **Répartition (a)/(b)/(c) tranchée par Éric** :
  - **(a) 11 cartes `€`** → `correction.js` corrigé : `RE_UNITE_PLAUSIBLE` accepte désormais `\p{Sc}` (catégorie Unicode *Symbol, Currency* — pas une liste en dur), 6 tests ajoutés (`correction.test.js` : 93 tests). `%` déjà géré avant ce changement.
  - **(b) 1 carte retirée** : l'encadrement « 5 et 6 » (deux valeurs, incompatible avec le profil `numerique`) — retirée du fixture, pas réparée. 144 → **143 cartes**, répartition **72 Justine / 71 Éric**.
  - **(c) 41 cartes (30 initiales + les 11 du point a) volontairement NON corrigées**, marquées `_fixture_note: "unite_manquante"` : réponse avec unité physique/monétaire, carte sans champ `unite` — "le correcteur a raison, c'est la rédaction qui est incomplète" (Éric). Verrouillé par 2 nouveaux tests dans `generer-pilote-t6.test.js` (8 → **10 tests**) : exactement ces 41 cartes peuvent diverger du correcteur, toute autre carte DOIT le passer.
  - Défauts éditoriaux relevés par Codex (biais de réponse, amorces clonées, mesure à côté de la compétence) : non corrigés ici, hors scope T6a (jugement de relecture humaine).
- **🔖 DETTE T6b — génération réelle par API via workflow n8n (canal A), sortie en file de relecture, jamais au catalogue ; le vrai lot pilote sera généré puis relu avec Justine/Éric.** Remplace/précise la dette "génération API réelle" notée au 1ᵉʳ T6. **Règle à respecter dès la vraie génération** : toute carte dont la réponse porte une unité DOIT déclarer `unite` — l'absence de cette règle est ce qui a produit les 41 cartes `_fixture_note` ci-dessus. Câblage API/n8n non fait ici (zéro action n8n, AGENTS.md).
- **Écart constaté (relecture) — toujours ouvert, pas une dette T6 au sens strict** : le mécanisme de relecture existant (`BOX - Selection Prof`, n8n) route par email du prof **soumissionnaire** (`prof_email`), pas par relecteur nommé — il n'a ni `statut` ni `relecteur`. `deposerEnRelecture()` produit une structure prête à être câblée, mais ce câblage n'est pas fait ici.
- **Nuance assumée (point #5 de la 2ᵉ critique)** : les champs `matiere`/`relecteur`/`statut` déclarés sur la candidate influencent encore l'ADMISSION (contrôle de forme `validerCandidate`, en amont) même s'ils n'influencent plus jamais le ROUTAGE FINAL ni le CONTENU déposé (entièrement repris du référentiel après admission). Documenté dans `fonda/engine/generation.js`, pas traité comme un bug.
- **Anti-clone : condition nécessaire, pas suffisante** — inchangé, voir `fonda/engine/README.md`.
- Branche `feat/fonda-lot1-generation` (commits `0e49a01` → `ebdcdc3` → `b58451d` → `5925a2d`). **3 passes de critique Codex sur le moteur, toutes closes ou explicitement acceptées comme limite documentée. Fusionné dans `design` le 2026-10-10.**

## T6b — génération réelle (script local + API Claude), en cours (2026-10-10)

- `fonda/scripts/generer-lot-fonda.js` : appel API réel + vérification zéro tolérance contre `correction.js` + dépôt via `deposerEnRelecture` (`fonda/engine/generation.js` réutilisé tel quel). Calibration (étape 1bis, lecture humaine par Éric) menée sur 2 notions, lots conservés dans `fonda/data/lots-fonda-calibration/` :
  - `maths.proportionnalite` — **calibré, validé par Éric** (7/8 cartes, gradation nI/nF OK, unités OK après 2 itérations de prompt).
  - `fr.sens-mot-inconnu` — 8/8, gradation nI/nF tenue (combinaison de deux indices ou repérage d'exception en nF), aucun rejet.
- **Point de vigilance — proportionnalité** : affiner la gradation nF (notion-clé collège, le modèle tend à produire du nF trop proche du nI sur les pourcentages simples). Déjà amélioré par la règle "transfert réel/plusieurs étapes" ajoutée au prompt, mais à surveiller si on régénère un lot de production.
- **Clé API Anthropic** : celle utilisée pour toute la calibration T6b a circulé en clair (message, terminal) — **à régénérer avant la mise en service réelle**. Constat additionnel (lecture du workflow `BOX - Generation Flashcards`, 2026-10-10) : cette même clé est aussi codée en dur en clair dans le nœud `Claude API` (HTTP Request, header `x-api-key`) de ce workflow **déjà en prod** — pas seulement une fuite de conversation. La régénération devra donc couvrir aussi ce nœud, pas seulement les scripts locaux T6b.
- **Étape 2 (workflow n8n `box-fonda-generation`, `n8n/fonda-generation/`) : livrée et testée en réel**, importée inactive (id n8n `ntqEiVLanGxFCVSF`) — upload Drive + email de relecture par matière (routage `matiere`→relecteur, jamais le `prof_email` du JSON collé), nœuds Upload/Email repris à l'identique de `BOX - Generation Flashcards` (escapeHtml post-T-SEC conservé). Test réel avec le lot `fr-sens-mot-inconnu_nI.json` : exécution complète réussie, fichier Drive + email reçus.
- **Étape 3 (relecture réelle via `/box-select`) : validée.** Éric a publié le lot de test (3/4 cartes retenues) ; vérifié après coup que `box-select-confirm` transporte intacts tous les champs FONDA (`type`, `palier`, `profil_correction`, `reponses_acceptees`, `set_id`, `item_id`, `notion_id`) sans les lire ni les altérer.
- **🔖 DETTE mineure — entrée orpheline `box_7e7tcooh` dans le vrai catalogue Drive** (`catalogue.json`, id `1AmmMsO3nh4h0GQ0I5XzIqWG_zHA9wopa`). Son fichier flashcards a été corbeillé (test de chaîne T6b, pas du contenu voulu — à distinguer de `box_175oc72f` "Vitesse du son", qui lui est du contenu réel et reste au catalogue), mais l'entrée du catalogue elle-même n'a volontairement PAS été retirée : réécrire tout le catalogue de prod (50+ entrées, toutes matières/collègues) pour une seule entrée cosmétique orpheline a été jugé disproportionné par Éric (2026-10-10) — un JSON mal formé aurait cassé l'accès aux fiches de tous les collègues, pour un lien qui ne mène déjà plus à rien. **À faire à la prochaine occasion où le catalogue est légitimement modifié** (sauvegarde préalable du fichier avant toute réécriture).

## Chantier design — thème sombre FONDA + logo/signature + switch (2026-10-11)

- **Objectif** : donner à BOX-FONDA son identité visuelle (brief `docs/box-fonda-design/BRIEF.md`, déposé par Éric via Claude Design) avant l'échéance CARDIE-SEPIA (21/10/2026) : thème sombre navy, lockup logo + signature « À FOND / FONDA ! », switch BOX (clair) ↔ FONDA (sombre). Branche dédiée `feat/box-fonda-theme-switch` (depuis `design`).
- **Décision de périmètre (Éric, avant codage)** : chantier **purement visuel**. On habille l'existant (page `?fonda=1` du T4, composant carte-reponse-produite.js du T2) tel qu'il est, y compris le message « contenu à venir » de `lancerDefi()` — **aucune donnée réelle câblée**. Le câblage réel à un vrai catalogue reste un chantier séparé, futur, et sera *purement data* grâce à celui-ci (zéro retouche visuelle à refaire).
- **Fait** :
  - `css/style.css` : bloc additif en fin de fichier (tokens `--fonda-*`, classes `.fonda-lockup`/`.fonda-sign`/`.fonda-switch`/`.fonda-niveau-picker`/`.fonda-feedback__*`...). Zéro token/sélecteur BOX existant modifié — BOX clair intact par construction.
  - `fonda/engine/carte-reponse-produite.js` : le bandeau de feedback (`<p class="fonda-feedback">` texte brut) est devenu une structure riche (verdict + icône ✓/✗, réponse attendue, réponses acceptées, profil, mention relecteur optionnelle via le nouveau champ `carte.relecteur`), pour coller à `docs/box-fonda-design/demo-reference.html`. **Purement additif** : `evaluerReponse()`/le contrat `onResultat` n'ont pas changé. 7 nouveaux tests dans `carte-reponse-produite.test.js` (le DOM factice a dû apprendre à agréger `textContent` depuis les enfants, comme un vrai navigateur — sinon les tests existants sur `feedback.textContent` cassaient).
  - `fonda/page/bootstrap.js` : en-tête `.fonda-header` (lockup + « ← Retour à BOX ») ajouté sur toutes les pages rendues ; le message d'erreur « Niveau manquant » est remplacé par un vrai sélecteur de niveau (`.fonda-niveau-picker`, niveaux dérivés de la semaine courante si elle a des défis, sinon 6e/5e/4e/3e par défaut). Le niveau choisi est persisté (`localStorage.setItem('box_fonda_niveau', ...)`, try/catch). `lancerDefi()`/`renderDefi()` **non touchés** (hors scope assumé).
  - `js/app.js`/`index.html` : bouton `.fonda-switch` dans la navbar BOX (`App.goFonda()`) qui navigue vers `?fonda=1&page=niveau` (+ niveau connu si `localStorage` en a un) — pas un repaint en place, BOX et FONDA restent deux rendus mutuellement exclusifs (`initFonda()` `return`-précoce, inchangé). `initFonda()` pose `document.body.dataset.theme='fonda'`.
  - Un test existant (`non-regression.test.js`, invariant T4 "index.html byte-identique à main") a dû être **remplacé** : cet invariant est volontairement levé par ce chantier (le bouton switch est un ajout visuel permanent et voulu). Remplacé par un invariant plus étroit mais toujours réel : un seul `.fonda-switch`, zéro `fondaRoot` statique, toujours zéro `<script>`/`<link>` statique vers `fonda/`.
  - `fonda/page/preview-carte.html` (nouveau, dev-only, non chargé par l'app) : page de prévisualisation du vrai composant carte (3 fixtures synthétiques anonymes), pour qu'Éric puisse faire les captures BOX clair / FONDA sombre demandées par la brief sans outil de capture automatisé (indisponible dans cet environnement).
  - Suite complète : **296/296 tests verts** (avant relecture Codex — voir plus bas pour l'état après corrections).
- **Piège à ne pas recommettre** : `fonda/data/calendar.json` a `semaines: []` (vide) aujourd'hui — tout rendu FONDA réel affichera honnêtement « Aucun défi programmé cette semaine » même avec le thème posé. C'est l'état réel (avant Moteur A), pas un bug.

### Relecture Codex (effort élevé, lecture seule) — 10 points, tous corrigés (2026-10-11)

PR #1 (`feat/box-fonda-theme-switch` → `design`, commit `5ea01ba`) relue par Codex avant merge (règle n°7 AGENTS.md). 3 bloquants + 7 à corriger, tous vérifiés fondés par reproduction directe avant correction (pas appliqués à l'aveugle). 6 commits séparés par thème, `node --test` vert à chaque étape, **307/307 tests verts** au final.

1. **Bloquant — contrastes AA non conformes** sur la carte claire (verdict vert 3,56:1, libellés 4,04-4,20:1, bordure champ 1,36:1). Corrigé par calcul WCAG : `--fonda-green-d` → `#2E7D46` (4,53:1), libellés → `#45526B` (6,75-7,01:1), bordure → `#8A8A8A` (3,39:1). Vert/rouge vifs des aplats/icônes volontairement inchangés (décision Éric : jamais la couleur seule, icône+texte déjà présents).
2. **Bloquant — « presque » toujours affiché en ✓ vert**, même en profil orthographe où `compteCommeReussite('presque','orthographe')` = `false` (contredit le PRD §5.1). Corrigé : nouveau `data-reussite` (booléen réel) pilote l'icône/couleur, `data-statut` reste pour le texte.
3. **Bloquant — navbar BOX restait visible par-dessus le rendu FONDA sombre**, son logo (`goHome()`) ne nettoyait ni `data-theme` ni `#fondaRoot`. Corrigé : `body[data-theme="fonda"] .navbar{display:none}` + `goHome()` nettoie défensivement les deux.
4. « Aussi acceptées » listait les formes brutes de `reponses_acceptees` même en profil numerique (références de calcul avant arrondi/unité, pas des chaînes littéralement acceptées) — pouvait afficher comme accepté une forme refusée par le correcteur. Corrigé : bloc exclu en profil numerique, « Réponse attendue » reste la source de vérité affichée.
5. **Régression de robustesse** : `reponses_acceptees` malformé (non-tableau) faisait planter le rendu via `.forEach()` avant l'appel à `onResultat()`. Corrigé : `Array.isArray()`, comme `correction.js`.
6. Niveau mémorisé sans retour possible, valeur URL non validée avant persistance. Corrigé : `niveauEstValide()` (niveau par défaut ou réellement programmé cette semaine, jamais une valeur arbitraire) + lien « Changer de niveau ».
7. Poppins chargé sur **toutes** les pages BOX (lien combiné dans `index.html`), pas seulement en mode FONDA. Corrigé : `index.html` revenu au lien Inter seul (identique à `design`) ; Poppins injecté dynamiquement dans `initFonda()`, même motif que le script `bootstrap.js`.
8. **Urgent (traité en premier)** : 2 tests dépendaient implicitement de `new Date()` pour tomber dans la plage de `SEMAINE_41` (05-11/10) — cassaient dès le 12/10. Corrigé : `&semaine=41` explicite, zéro dépendance à l'horloge.
9. Le test de non-régression remplacé au 1ᵉʳ commit protégeait moins que son nom l'indiquait. Resserré : comparaison **ligne à ligne contre `design`**, la seule différence autorisée est l'ajout du bouton `.fonda-switch`.
10. Signature compacte garblée : `"À"+"FOND"+"FOND"+"A"+"!"` sur une seule ligne affichait littéralement "ÀFONDFONDA!" au lieu du wordmark à deux lignes du lockup de référence. Corrigé : structure `l1`/`l2` exacte, dans `bootstrap.js` et `preview-carte.html`.
- **Optionnel appliqué** : plus de mention « Fiche relue et validée par … » sur une carte au statut `carte_invalide` (ce n'est précisément pas une carte validée dans cet état).
- **🔖 DETTE parquée, hors de ce chantier (décision Éric)** :
  - Favicon/monogramme FONDA dédié et lockup complet (accueil) absents — mentionnés dans le brief, pas dans la DoD stricte.
  - `fonda/page/bootstrap.js` utilise `window.FondaLiens`, mais le parcours réel ne charge jamais `fonda/engine/liens.js` (les tests l'injectent artificiellement) — le futur câblage à un vrai catalogue ne sera donc pas *exclusivement* une affaire de données, contrairement à ce qu'on avait supposé en entrant dans ce chantier.
- **Prochaine étape** : Éric ouvre `index.html` et `?fonda=1&page=niveau` localement, fait les captures avant/après (BOX clair / FONDA sombre), puis merge `--no-ff` dans `design`.

## Lot de validation T6b — 4 notions, nI+nF (2026-10-11)

- **Objectif** : éprouver `generer-lot-fonda.js` (T6b) sur un lot plus large que la calibration (4 notions neuves, pas 1-2) avant d'envisager l'industrialisation. Branche `feat/box-fonda-lot1-validation`, depuis `design` à jour (après merge de `feat/box-fonda-t6b-calibration-v2` — voir ci-dessus — et `feat/box-fonda-theme-switch`, déjà mergée via PR #1 sur GitHub pendant ce chantier).
- **Généré par Éric lui-même** (clé API passée en main, pas par Claude Code — le classificateur auto-mode a bloqué la commande contenant la clé en clair ; Éric a lancé la commande dans son propre terminal).
- **Notions** : `fr.comprendre-consigne`, `fr.inference-implicite`, `maths.grandeurs-mesures`, `maths.resolution-problemes` — nI + nF chacune, `--n=6` (défaut du script).
- **Résultat : 46/48 cartes retenues (95,8%)**, 2 rejets, **tous deux vérifiés fondés** (pas un bug) :
  - `maths.grandeurs-mesures/nF` : carte "2 pots" sans champ `unite` déclaré — même catégorie que les cas "sachets/élèves" déjà vus en calibration T6b, correctement filtrée par `correction.js`.
  - `fr.inference-implicite/nF` : champ `reponse` rédigé en phrase complète ("il a un examen important") au lieu d'une forme courte identique à `reponses_acceptees` — violation ponctuelle de la règle 1 (réponse très courte) par le modèle sur cette seule carte.
- **Qualité relue carte par carte par Claude Code (lecture seule, calculs vérifiés à la main sur les 12 cartes `maths.resolution-problemes`/`maths.grandeurs-mesures` nF — zéro erreur)** : les 4 notions montrent une gradation nI/nF nette (nI = application directe, nF = compositions à 2-3 étapes réellement différentes du geste nI). `maths.resolution-problemes` jugé le meilleur lot (0 rejet, problèmes composés solides : remplissage en relais, pourcentage-puis-fraction, promo 3+1, système de points).
- **Fichiers produits** (`fonda/data/lots-fonda-calibration/`) : `fr-comprendre-consigne_nI/nF.json`, `fr-inference-implicite_nI/nF.json`, `maths-grandeurs-mesures_nI/nF.json`, `maths-resolution-problemes_nI/nF.json`. **Candidates uniquement — rien publié, aucun workflow n8n touché** (G4 : relecture humaine carte par carte reste obligatoire avant toute publication réelle).
- Suite de tests : 307/307 (le seul "échec" affiché, `non-regression.test.js` comparant `index.html` à `design`, est un artefact attendu quand on exécute la suite depuis `design` lui-même post-merge — pas une régression réelle, sans lien avec ce chantier).

### Correctif post-relecture — QCM anti-biais de position (2026-10-11)

- **Trouvé par Éric à la relecture carte par carte** (G4 en action) : `fr.comprendre-consigne/nI` carte 5 citait « réponds uniquement à la question **2** » et plaçait la bonne réponse en option **B** — déductible par simple comptage de position, sans lire le contenu.
- **Corrigé** : règle 4 du prompt (`generer-lot-fonda.js`) étendue — un repère ordinal cité dans l'énoncé ne doit jamais correspondre à la position de la bonne réponse. Documenté comme convention (non vérifiable automatiquement) dans `fonda/data/README.md`, pour tout futur lot généré ou écrit à la main. 1 nouveau test.
- **Carte 5 régénérée** (par Éric, clé API en main — commande fournie par Claude Code, script ponctuel non committé) : nouvelle carte (profil `exact`, pas un QCM) — sélectionner le bon champ dans une fiche d'inscription à 8 champs. Passe le correcteur zéro tolérance. Intégrée dans `fr-comprendre-consigne_nI.json` à la place de l'ancienne carte 5 (même `item_id`/`set_id`).
- **Vérifié : aucune autre carte QCM du lot de validation (8 fichiers) ne tombe dans ce piège** — une seule autre carte QCM existe (`fr.inference-implicite/nF` carte 4, « la troisième fois » → réponse B), sans correspondance numérique.
- Suite de tests : 308/309 (même artefact connu, sans lien).

### Auto-correction reponse/reponses_acceptees + carte 6 régénérée (2026-10-11)

- **`autoCorrigerCarte()` ajoutée** (`generer-lot-fonda.js`) : avant rejet définitif, une carte dont la réponse-or échoue à son propre correcteur est testée avec chacune des formes déjà déclarées dans sa propre `reponses_acceptees` à la place de `reponse` — la première qui passe est retenue. **Aucun contenu inventé** (`reponses_acceptees` jamais modifié), invariant conservé (aucune carte dont la réponse-or est rejetée par son propre correcteur n'est émise). Si aucune forme ne passe, rejet inchangé. 5 nouveaux tests.
- **Carte 6 de `fr-inference-implicite_nF.json` (box_hrelpt8q) régénérée** avec cette garantie (par Éric, clé API en main) : « ciel sombre + sortie d'école + fuite de la pluie → après-midi », profil `sens`. Passée directement sans correction nécessaire. **Lot `fr.inference-implicite/nF` de retour à 6/6.**
- Suite de tests : 313/314 (même artefact connu, sans lien).
- **Bilan final du lot de validation T6b** : 48/48 cartes retenues sur les 4 notions (après la correction de la carte 5 biaisée et l'ajout de la carte 6), toutes passées au correcteur zéro tolérance, toujours **candidates uniquement — rien publié, aucun n8n touché** (G4).

### Clôture du lot de validation (2026-10-11)

- **🔖 DETTE — test `non-regression.test.js` mis en quarantaine (`test.skip`)** : « index.html ne diffère de design QUE par l'ajout du bouton .fonda-switch » n'a de sens que depuis une branche feature non encore mergée ; exécuté depuis `design` lui-même (ou toute branche déjà au niveau de `design`, comme ce lot), `index.html` est par construction identique à `design:index.html`, donc l'assertion "+1 ligne" échoue toujours — pas une régression. **À retravailler** : comparer contre `main` (stable) plutôt que `design` (bouge à chaque merge), ou limiter son exécution à la branche `feat/box-fonda-theme-switch` avant un futur merge similaire. `node --test` redevient un vert franc (0 échec, 1 skip) tant que ce test reste en quarantaine.
- **Carte 6 de `maths-grandeurs-mesures_nF.json` (box_za9ei4cr) régénérée** pour revenir à 6/6 : pompe de chantier, débit constant 90 L/min, citerne 5400 L → 1 h (calcul vérifié : 5400/90 = 60 min). Contrainte ponctuelle respectée (esprit "mesurer/convertir", aucune formule géométrique, `unite` déclarée) — passée directement sans correction nécessaire.
- **Lot de validation T6b clos : 48/48 cartes sur les 4 notions (nI+nF), toutes 6/6** (4 notions × 2 paliers × 6 — corrigé après une erreur de calcul signalée par Éric, "54" annoncé à tort par Claude Code ; vérifié par relecture des 8 fichiers : `nb_cartes` = `cartes.length` = 6 partout, numéros 1-6 sans doublon/trou, et confirmé qu'aucune réponse initialement rejetée ne figure dans les fichiers finaux — structurellement garanti : seul `cartesValides` alimente l'écriture, jamais `rejets`). `node --test` : **313/313, 0 échec, 1 skip** (dette ci-dessus).

## Merge du lot de validation dans `design` (2026-10-11)

- **`feat/box-fonda-lot1-validation` mergée dans `design`** (`--no-ff`, commit `09d7b34`), zéro conflit, poussée sur origin. `main` non touché (`7ea4f28...`, vérifié avant et après). `node --test` sur `design` post-merge : **313/313, 0 échec, 1 skip** (dette ci-dessus).
- **🔖 Dettes à solder avant toute bascule élèves réelle** :
  1. **Clé API Anthropic à régénérer** — celle utilisée pour toute la calibration/validation T6b a circulé en clair (messages, terminal) et est aussi codée en dur dans le nœud `Claude API` du workflow n8n `BOX - Generation Flashcards` (prod). Couvrir les deux à la régénération.
  2. **Vraie adresse email de Justine Leblanc** — le routage de relecture français utilise encore l'adresse de TEST (`ericdnews@yahoo.fr`, `fonda/data/destinataires.json`), à remplacer avant mise en service réelle.
  3. **Entrée orpheline `box_7e7tcooh`** dans le vrai catalogue Drive (`catalogue.json`) — fichier flashcards déjà corbeillé (test de chaîne T6b), entrée catalogue jamais retirée (risque jugé disproportionné pour une réécriture isolée, cf. section T6b plus haut) — à retirer à la prochaine occasion où le catalogue est légitimement modifié.

### Publication — EN PAUSE, décision Éric (2026-10-11)

- **Plan de publication proposé par Claude Code (lecture seule + plan, aucune exécution)** : upload Drive via `box-fonda-generation` + relecture réelle `/box-select` pour chacun des 8 fichiers, geste G4 non contourné. Catalogue/n8n/live non touchés à ce stade — plan uniquement, rien exécuté.
- **Décision : publication reportée.** Raison donnée par Éric : publier maintenant afficherait les fiches FONDA en flip-cards ordinaires de BOX (mélangées aux autres matières, sans l'auto-correction par profil) — affichage dégradé et prématuré, puisque `lancerDefi()` (câblage FONDA réel) est toujours un stub. **Le prérequis est le câblage FONDA, pas la publication.**
- **État actuel** : les 8 lots restent prêts, validés, dans `fonda/data/lots-fonda-calibration/` (48 cartes, 6/6 partout). Catalogue Drive non touché, `box_7e7tcooh` laissé tel quel, aucun workflow n8n déclenché.
- **Prochaine étape réelle** : câblage de `lancerDefi()` (`fonda/page/bootstrap.js`) à un vrai fetch + `FondaCarteReponseProduite.montrerCarteReponseProduite()` — chantier distinct, pas encore commencé. **La publication de ce lot reprendra APRÈS**, pour un affichage FONDA correct dès le départ.

## Câblage des fiches FONDA — lancerDefi() (2026-10-11)

- **Objectif** : prérequis identifié avant publication — qu'une fiche validée s'affiche VRAIMENT en mode FONDA (saisie + correction par profil), pas le stub « contenu à venir ». Branche `feat/box-fonda-cablage`, depuis `design`.
- **Décision de périmètre validée par Éric avant codage** (plan court, lecture seule d'abord) :
  - `FondaLiens` : **chargé** (dynamiquement, pas retiré) — `genererLiensNiveau` sert toujours à la vraie liste de liens par classe.
  - **Relecteur affiché : LU depuis la donnée, jamais déduit.** Correction explicite d'Éric sur un plan initial qui proposait une table `matiere -> nom` — rejetée : "le badge est une affirmation de confiance G4, il doit refléter un fait enregistré, pas une déduction, sinon badge mensonger dès qu'un lot sera relu par quelqu'un d'autre." Champ `relecteur` ajouté (additif) aux 8 lots de validation (`"Justine Leblanc"` / `"Éric Duchateau"`, valeurs réelles connues pour CES lots précis) ; repli générique `"un professeur"` si absent, jamais une déduction.
- **Découverte en lecture seule avant codage** : `fonda/engine/liens.js`, `correction.js` et `carte-reponse-produite.js` n'étaient en réalité **jamais chargés dans un vrai navigateur** (seulement injectés en faux globals par les tests) — un vrai `?fonda=1&page=niveau` aurait planté (`FondaLiens is undefined`). Corrigé : `bootstrap.js` les charge lui-même dynamiquement (`chargerScript`, idempotent, ordre garanti par `await` séquentiel — pas besoin de `script.async=false`).
- **Fait** :
  - `lancerDefi(contexte)` fetche un lot commité (`fonda/data/lots-fonda-calibration/`, pas le catalogue Drive — ces lots sont les fixtures de ce chantier), rend les cartes une à une via le composant T2, "Carte suivante →" entre deux, écran de fin en bout de paquet.
  - Nouveau lien **« Voir un défi de démonstration »** sur la page niveau -> `?page=carte&notion=fr.comprendre-consigne&palier=nI` -> construit un contexte synthétique (`grp: null`) et appelle la **MÊME** `lancerDefi()` que le futur flux calendrier réel — data-driven, aucune logique à retoucher pour ajouter d'autres notions/paliers plus tard.
  - `adapterCarte()` (pure, exportée/testée) : traduit une carte du format lot vers la forme attendue par `carte-reponse-produite.js`.
  - **Hors scope explicite** : émission d'événements réels (T3, `evenements.js`/n8n) — `onResultat` ne pilote que la navigation interne, zéro donnée envoyée (G2/G3 intacts, zéro changement de comportement n8n).
  - Harnais de test étendu (`fonda/page/bootstrap.test.js`) : `head`/`querySelector`/`setAttribute` factices, injection des VRAIS modules `correction.js`/`carte-reponse-produite.js` (pas des bouchons), `fetch` factice servant par défaut les VRAIS fichiers lot committés. 10 nouveaux tests, dont un parcours complet "Valider" → "Carte suivante" × 6 jusqu'à l'écran de fin, sur le vrai `fr-comprendre-consigne_nI.json`.
  - Suite complète : **323/323 réels, 1 skip connu (sans lien)**.
- **Piège évité** : les scripts injectés dynamiquement (`document.createElement('script')`) sont asynchrones par défaut même insérés en séquence — l'ordre d'exécution (correction.js avant carte-reponse-produite.js, qui lit `window.FondaCorrection` à l'évaluation du fichier) est garanti ici par `await` séquentiel sur chaque chargement, pas par une supposition sur l'ordre d'insertion DOM.
- **Prochaine étape** : captures (BOX clair inchangé + FONDA avec le vrai défi de démo) à faire par Éric en navigateur, puis PR vers `design`.

## Relecture Codex PR #2 (câblage) — 10 points corrigés, 1 reporté (2026-10-12, Claude Code)

- Relecture Codex (lecture seule, medium) : 3 bloquants + 7 à corriger + 1 optionnel, vérifiés par reproduction avant correction. 9 commits, `node --test` vert à chaque étape : **368/368, 0 échec, 1 skip** (dette connue).
- **G4** : liste fermée `LOTS_PUBLIABLES` (8 lots) + `revue_carte_par_carte === true` vérifié au rendu (défense en profondeur, décision Éric). Les 8 lots relus passent à `true`, les 8 lots de calibration restent `false`. Ferme aussi la traversée de chemin via `palier`.
- **Chargement** : `evenements.js` ajouté au graphe (liens.js en dépend), dépendances chargées avant tout usage de `FondaLiens` ; `chargerScript` à promesse partagée, preuve = export sur `window`. Harnais de test : plus aucun global pré-injecté, scripts évalués en mode navigateur (vm).
- **Écran vide** : `initFonda()` pose « Chargement… » + `onerror` de bootstrap.js ; attente bornée 15 s.
- `adapterCarte` transmet `arrondi`/`seconde_chance` ; lot validé en entier avant la 1re carte ; démo accessible aussi depuis les pages niveau sans défi.
- **Formes acceptées refusées** (« 2 bus », « 40 livres », « 8 victoires ») : variantes retirées. Option `unite` écartée : avec une unité déclarée, le nombre seul est noté **« presque »** (unité oubliée), pas « juste » — l'unité n'est jamais facultative dans le correcteur actuel (vrai aussi pour les 27 formes nombre-seul des 8 lots : réussite en numérique, mais message « unité oubliée »). Garde-fou générateur `verifierFormesAcceptees()` (chaque forme doit compter comme réussite) + test permanent sur les 8 lots.
- **🔖 DETTE Moteur A (Codex #7)** : `lancerDefi()` ignore le `setId` du calendrier (lot choisi par notion+palier). À brancher avec Moteur A — la promesse « aucune retouche nécessaire » était fausse, corrigée dans l'en-tête de `bootstrap.js`.
- **Point ouvert pédagogique** : un élève qui tape « 2 bus » reste noté faux (pas de tolérance de mot après le nombre sans unité déclarée). Option (b) (correcteur tolérant) non retenue pour l'instant.
- **Prochaine étape** : nouvelle relecture Codex, puis merge de la PR #2 dans `design`, puis publication des 8 lots.

### Relecture Codex v2 — 4 points corrigés, 1 reporté (2026-10-12, Claude Code)

- Plus de bloquant (G4 non contournable, aucune régression BOX clair). Corrigés, un commit chacun, avec un test de COMPORTEMENT de leur scénario :
  1. Délai (20 s) + « Retour à BOX » dans `initFonda()`, en amont de bootstrap.js ; signal `window.FondaBootstrapActif`. Tests `js/app.test.js` (horloge pilotée), remplaçant une recherche de chaîne.
  2. `chargerScript` gère l'expiration (10 s/script) : entrée oubliée, callbacks tardifs neutralisés, nouvel essai possible.
  3. Garde-fou générateur : cible après arrondi (`formeSaisissable`), `arrondi` transmis aux candidates/box-select (régression de mon garde-fou v1).
  4. Réponses = texte non vide ou nombre fini ; plantage de correction au clic -> message visible + `onErreur` (additif, rien de scoré).
- **Smoke-test navigateur réel (Chrome headless, serveur local) : OK** — BOX clair intact (aucun script/police FONDA, navbar visible) ; page niveau + lien démo ; démo complète 6/6 (faux ✗, juste ✓, relecteur affiché, « Carte suivante » après Valider, écran de fin) ; lot non relu refusé ; retour BOX propre ; bootstrap.js bloqué -> message + retour BOX. Zéro exception, zéro erreur console.
- Lecture Codex ciblée (points 3-4) : 4 précisions corrigées (réponse-or testée littéralement, filet restreint à la correction, relecteur typé, arrondi borné 0..10).
- `node --test` : **394/394, 0 échec, 1 skip** (dette connue).

### 🔖 À régler AVANT usage élève réel (même rang que la clé API)
1. Clé API Anthropic à régénérer (scripts locaux + nœud n8n `Claude API` de `BOX - Generation Flashcards`).
2. Vraie adresse de la relectrice de français dans `fonda/data/destinataires.json` (adresse de test aujourd'hui).
3. **Fidélité du banc de test (Codex v2 #5)** : un seul contexte navigateur partagé (vm), parcours complet depuis `App.initFonda()`, chargements et horloge pilotables. Aujourd'hui chaque dépendance a son propre contexte vm et bootstrap.js est chargé par `require()` : une collision de globals passerait les tests et casserait en vrai. Cause racine des « vert en test, cassé en navigateur » — **à prioriser avant d'élargir FONDA à d'autres notions**. D'ici là, le smoke-test navigateur réel reste le filet obligatoire avant chaque merge.
4. **Correcteur tolérant au mot après le nombre (point 8, option b)** : « 2 bus » est aujourd'hui noté faux sans unité déclarée ; et avec une unité déclarée, le nombre seul donne « presque, unité oubliée ».
5. Entrée orpheline `box_7e7tcooh` du catalogue Drive (à la prochaine modification légitime du catalogue).

## Index d'entraînement libre — `page=entrainement` (2026-10-12, Claude Code)

- **Objectif** : rendre les 8 lots de `LOTS_PUBLIABLES` atteignables en mode FONDA depuis le dépôt (pas le catalogue Drive), au lieu du seul lien de démo. Branche `feat/box-fonda-index` (depuis `design` après merge PR #2).
- **Constat de cadrage (lecture seule)** : un lot publié sur Drive et ouvert par `?set=` est rendu par l'écran BOX ordinaire (`loadAndReview` -> flip-cards, champs FONDA ignorés) ; le rendu FONDA (`lancerDefi`) ne lit que les fichiers commités. **Publier sur Drive maintenant = flip-cards dégradées** — publication toujours en attente d'une décision (exclure les lots FONDA du catalogue ordinaire, ou rediriger `?set=` FONDA vers le rendu FONDA).
- **Fait** (3 commits) : page `?fonda=1&page=entrainement` — entrées **dérivées** de `LOTS_PUBLIABLES`, libellé/matière/ordre lus dans `referentiel.json` (repli identifiant), groupées par matière ; libellés de palier sobres (`Initial`/`Final`, table `PALIERS_LIBELLES`). Ne lit que `referentiel.json`. Liens vers la route existante `page=carte` (G4 inchangé, vérifié au rendu). Le lien de démo unique est remplacé par « S'entraîner librement — toutes les notions » (sélecteur + pages niveau sans défi) ; « ← Toutes les notions » sur le paquet libre et l'écran de fin (pas sur un défi de classe).
- **Invariant G4 « listé = affichable »** (test) : tout lot de `LOTS_PUBLIABLES` existe, porte `revue_carte_par_carte === true` et est bien formé ; les 8 liens de l'index ouvrent « Carte 1 / N ». Vérifié par mutation.
- `node --test` : **404/404, 0 échec, 1 skip** (dette connue). **Smoke-test navigateur réel OK** : BOX clair intact ; page niveau -> index (8 liens, Français/Maths) ; `maths.resolution-problemes/nF` parcouru 6/6 juste jusqu'à l'écran de fin ; retour à l'index ; zéro erreur.
- **🔖 DETTE layout (non bloquante)** : pages FONDA à contenu court = grand vide navy en haut + barre collée au-dessus du contenu (conteneur centré en `100vh`). Pages concernées : sélecteur/page niveau, messages, paquet de cartes, écran de fin, **et `page=entrainement`** (non aggravé). À top-aligner d'un seul coup.
- **Prochaine étape** : PR `feat/box-fonda-index` -> `design`, merge par Éric. Puis décision sur la publication Drive (voir constat ci-dessus).
