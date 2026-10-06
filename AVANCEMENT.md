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

- Branche `feat/fonda-lot1-mode-page`. **Prêt pour fusion — en attente du feu vert explicite d'Éric. T5 non démarré.**

### ☐ T5 — Collecte n8n → Sheet
- But : nouveau workflow d'ingestion des événements, livré en JSON à importer, testé sur copie.
- Impact prod : nul si importé/testé hors live.
- DoD : un POST d'événement arrive au Sheet ; les 9 workflows existants intacts.
- Codex : OUI (casse d'un workflow existant ? fuite de donnée ?).

### ☑ T6a — Moteur de génération imprenable (chaîne + validation, zéro réseau) — fait le 2026-10-06
- **Scinde l'ancien ticket T6** (chaîne + lot pilote de qualité) en T6a (ce ticket : moteur imprenable) + reste (correction.js, vrai lot pilote via API — voir dettes ci-dessous). Déclenché par une critique Codex sur le 1ᵉʳ T6 (commit `0e49a01`) qui a trouvé que le dépôt faisait **confiance** à la candidate entrante pour `statut`/`matiere`/`relecteur`, et que 42/144 réponses de référence du lot pilote étaient incompatibles avec le correcteur T2 réel.
- But : fermer G4 au dépôt (plus de confiance) + les bugs structurels de moteur relevés (#12). **Aucune réécriture éditoriale de contenu.**
- **G4 imprenable** (`fonda/engine/generation.js::deposerEnRelecture`) : `statut` est désormais **FORCÉ à `"attente"`** pour toute candidate déposée (toute valeur entrante écrasée) ; `matiere`/`relecteur` sont **dérivés du référentiel réel** (`notions`, passé en option) via `notion_id` — plus jamais lus/conservés depuis la candidate ; `notion_id` absent du référentiel fourni → rejet (jamais de routage par défaut, échoue fermé si `notions` est omis/vide).
- **Intégrité structurelle (#12)** : gel **profond** (candidate + `reponses_acceptees` — cloné avant gel, jamais la référence reçue : muter le tableau d'origine après coup ne mute plus la candidate déposée) ; unicité `(set_id, item_id)` et cohérence `set_id` ↔ `notion_id` ↔ `palier` vérifiées au dépôt (un doublon ou un id de jeu d'une autre notion/palier est rejeté).
- Tests : `generation.test.js` passe de 27 à **34** (7 nouveaux tests verrouillant exactement les 4 points ci-dessus, dont le cas nommé par Éric : `notion_id:"maths.geometrie"` + `matiere:"français"` déclarée → routée chez **Éric**, pas Justine). Suite complète **222/222** inchangée par ailleurs ; `generer-pilote-t6.js` mis à jour pour passer `notions` au dépôt (sortie identique : 24 jeux, 144 cartes, 72/72).
- **Dette ids (T6) LEVÉE** : `set_id`/`item_id` dérivés uniquement de `(notion_id, palier, séquence)`/index, jamais du texte de la carte — motif vérifiable (`^set_fonda_[a-z0-9-]+_n[IF]_\d{2}$`, `^it\d{2}$`). Voir `fonda/engine/README.md`.
- **Requalification du lot pilote** (`fonda/data/pilote-t6-relecture.json`) : désormais documenté comme **fixture technique** — il exerce la chaîne (ids, schéma, anti-clone, routage), **PAS un échantillon validé de qualité pédagogique**. Raison : rejoué contre le vrai correcteur T2 (`fonda/engine/correction.js`), 42/144 réponses de référence échouent (12 `carte_invalide`, 30 `faux`) — 11 par usage du symbole `€` (hors grammaire des unités), 1 encadrement à deux valeurs en profil `numerique`, 30 par absence d'un champ `unite` sur des cartes dont la réponse porte une unité physique (m, m², km, L, g, min, °C...). **Répartition (a)/(b) produite et remise à Éric pour validation — rien n'a été modifié dans `correction.js` ni dans le contenu des cartes à ce stade.** Défauts éditoriaux relevés par Codex (biais de réponse, amorces clonées, mesure à côté de la compétence) : non corrigés ici, hors scope T6a (jugement de relecture humaine).
- **🔖 DETTE T6b — génération réelle par API via workflow n8n (canal A), sortie en file de relecture, jamais au catalogue ; le vrai lot pilote sera généré puis relu avec Justine/Éric.** Remplace/précise la dette "génération API réelle" notée au 1ᵉʳ T6 — câblage non fait ici (zéro action n8n, AGENTS.md).
- **Écart constaté (relecture) — toujours ouvert, pas une dette T6 au sens strict** : le mécanisme de relecture existant (`BOX - Selection Prof`, n8n) route par email du prof **soumissionnaire** (`prof_email`), pas par relecteur nommé — il n'a ni `statut` ni `relecteur`. `deposerEnRelecture()` produit une structure prête à être câblée, mais ce câblage n'est pas fait ici.
- **Anti-clone : condition nécessaire, pas suffisante** — inchangé, voir `fonda/engine/README.md`.
- Branche `feat/fonda-lot1-generation` (commit suivant `0e49a01`). **Prêt pour critique Codex ciblée uniquement sur le moteur (G4 forcé, routing dérivé, notion inconnue rejetée, gel profond, unicité/cohérence). Pas de merge.**
