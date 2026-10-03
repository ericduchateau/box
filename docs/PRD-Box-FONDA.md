# PRD — Box-FONDA
### Extension « fondamentaux » de BOX : calendrier roulant, mesure de rétention et génération assistée de fiches

> Document de cadrage pour Claude Code. Il décrit **quoi** construire et **sous quelles contraintes**, pas le code.
> Projet : dépôt BOX à l'AAP CARDIE-SEPIA 2026-2027 — thème *savoirs fondamentaux (littératie & numératie)*. Échéance dossier : **21 octobre 2026**.

---

## 0. Objectif

Ajouter à BOX une brique « fondamentaux » (**Box-FONDA**) qui :
1. fait tourner un **calendrier roulant** de défis courts sur les notions fondamentales (français / maths) ;
2. **mesure la progression de la rétention** par groupe, sans compte ni donnée nominative ;
3. **tient à jour** un tableau de bord (couleurs, cartes rouges, couverture du programme) ;
4. **propose automatiquement** de nouvelles fiches là où il en manque, toujours soumises à **validation humaine**.

Box-FONDA est une **extension de BOX, pas d'IA-zimut**. Sa mesure naît de ses *propres* données d'usage.

---

## 1. Principes & garde-fous (non négociables)

- **G1 — Autonomie vis-à-vis d'IA-zimut.** Aucune dépendance aux photos/pipeline d'IA-zimut. Les indicateurs proviennent uniquement des événements d'usage de BOX.
- **G2 — Sans compte élève.** La progression individuelle reste **locale** (navigateur). Aucune authentification élève.
- **G3 — Aucune donnée nominative de mineur envoyée au modèle.** La génération de fiches se fait **à partir du contenu de cours et du référentiel**, jamais à partir de travaux ou de données d'élèves. Les analyses sont **agrégées et anonymes** (pas de nom, pas d'identifiant serveur reliant un élève).
- **G4 — Humain dans la boucle.** Le moteur de génération **propose**, il ne publie jamais. Toute fiche passe par une relecture **carte par carte**, **routée par matière** (voir §12).
- **G5 — Séparation des modèles.** BOX ordinaire (dépôt PDF → fiches) reste sur **Haiku**. La génération « fondamentaux » (où la clarté de l'énoncé est critique) passe sur un **modèle plus puissant** (voir §11).
- **G6 — Protection légère assumée.** Le tableau de bord est protégé par mot de passe (filtre le tout-venant, pas un curieux déterminé) ; la **copie Drive** est l'archive durable. Ne jamais présenter le dashboard comme « sécurisé ».
- **G7 — Hébergement statique.** Les pages (révision, menu, dashboard) sont servies en statique (Git Pages) et lisent des fichiers JSON commités. Le seul composant dynamique est la **collecte** (webhook).

> À vérifier hors périmètre technique : position du **DPD / DANE académique** sur le dispositif. À traiter dans le dossier, pas dans le code.

---

## 2. Architecture (trois temps)

| Temps | Rôle | Techno (hypothèse, modifiable) |
|---|---|---|
| **Collecter** | encaisser les réponses élèves, écrire les événements | webhook **n8n** → **Google Sheet / Drive** (unique point d'écriture) |
| **Calculer** | lire événements + calendrier, mettre à jour tableaux/couleurs, faire tourner les moteurs A & B, committer les JSON | **script périodique** (hypothèse : **GitHub Action en cron hebdomadaire**) — exécutable aussi à la main via Claude Code |
| **Afficher** | révision, menu public, dashboard | pages **statiques** lisant `*.json` commités |

**Hypothèses à confirmer par Éric** (posées pour ne pas bloquer la rédaction) :
- Déclencheur du calcul = GitHub Action cron hebdo (défaut). Alternative : lancement manuel par Claude Code.
- Collecteur = n8n → Sheet (cohérent avec les 8 workflows existants).

---

## 3. Modèle de données

### 3.1 `referentiel.json` (ossature, amorçable maintenant)
```
notion = {
  id, matiere ("français"|"maths"), categorie, libelle,
  programme_refs[], eval_nat_domaine,
  paliers: ["nI","nF"],              // Initial / Final — difficulté DANS la notion, indép. du niveau de classe
  priorite_initiale,                 // couleur de départ : "gris" | "ambre"
  frequence_base_semaines            // défaut 4
}
```

### 3.2 Événements (lignes dans le Sheet, exportées en JSON) — **anonymes**
```
event = {
  ts,                 // horodatage
  grp,                // ex. "6A" — choisi par le prof au lancement, PAS un élève
  defi_id, notion_id, palier ("nI"|"nF"), set_id, item_id,
  result,             // 0/1 (réponse auto-corrigée)
  ctx,                // "df" | "maison" | "classe"
  rang_local,         // rang de tentative de l'item, calculé CÔTÉ NAVIGATEUR
  dt_jours            // jours écoulés depuis la tentative locale précédente
}
```
> `rang_local` et `dt_jours` sont posés par l'appareil (qui connaît déjà l'historique local). Le serveur ne reçoit jamais d'identité : seulement « 2ᵉ tentative, 9 j après ». Fiable sur mobile perso, **bruité sur poste partagé** → observable d'appoint, à présenter comme tel.

### 3.3 `calendar.json` (le « menu » public)
```
semaine = {
  iso_week, du, au,
  entrees: [ { defi_id, notion_id, matiere, palier, niveau_cible, set_id } ]
}
```

### 3.4 `coverage.json` (état par notion)
```
{ notion_id, a_des_fiches (bool), n_fiches, derniere_passation,
  couleur ("gris"|"vert"|"ambre"|"rouge"|"trou"), statut, n_reponses_cumulees }
```

### 3.5 `dashboard.json`
```
par (grp, notion): occurrences[ {date, rang, taux_reussite, n_reponses} ],
                    delta, couleur, cartes_rouges[]
+ agrégat établissement: adoption (profs, matières, jeux, révisions), Δ par notion/classe
```

### 3.6 File de relecture
```
candidate = { card_id, notion_id, matiere, palier, difficulte,
              question, reponse,
              profil_correction ("sens"|"orthographe"|"numerique"|"exact"),  // voir §5.1
              reponses_acceptees[],        // formes justes déclarées par le générateur
              seconde_chance (bool),       // défaut false
              relecteur ("justine"|"eric"),
              statut ("attente"|"validée"|"rejetée"), source ("B-auto"|"seed"), ts }
```

---

## 4. Chantier 1 — Page Box-FONDA (actionnable en 1 clic)

- **Pas de lien supplémentaire** : Box-FONDA est un **mode** de la page BOX existante (toggle/onglet), pas une nouvelle URL.
- Depuis la page existante, le prof lance **en 1 clic** le défi du menu de la semaine, puis **choisit son groupe dans une liste** (→ pose le tag `grp`). Aucun compte, aucune clé.
- **Menu public** : une vue calendrier lisible par tous (« Cette semaine — 6ᵉ : fractions (nI) · accord sujet-verbe (nF) »), avec lien/QR par défi. C'est la vitrine du dispositif.

**Acceptation** : depuis la page BOX, en ≤ 2 clics, un prof lance un défi du menu pour un groupe donné ; le menu de la semaine est visible publiquement sans authentification.

---

## 5. Chantier 2 — Carte « réponse produite »

- L'élève **produit** sa réponse (la tape / la dit) avant de retourner la carte → récupération active + micro-production écrite (littératie).
- **Réponses exigibles très courtes** (un mot / un nombre / QCM) — condition pour (a) ne pas décrocher des élèves fragiles, (b) permettre la **correction automatique** sans intervention du prof.
- Résultat auto-évalué → alimente `result` (0/1) de l'événement.

**Acceptation** : une carte « réponse produite » accepte une saisie courte, la corrige automatiquement selon son **profil de correction** (§5.1), émet un événement `result`, et conserve l'allure d'une session BOX (feedback immédiat, animation de fin).

### 5.1 Correction automatique — profil **par carte** (pas de réglage global)

Ce qu'on tolère dépend de **ce que la carte évalue** : en compréhension/lexique/problèmes, un accent ou un pluriel oublié est du bruit ; en orthographe/accords, c'est **la réponse elle-même**. Chaque carte porte donc un `profil_correction`, **proposé par le modèle générateur et validé en relecture** (reste dans la boucle humaine).

| Profil | Notions visées | Pardonne | **Strict sur** |
|---|---|---|---|
| **sens** | compréhension, lexique (sens), problèmes à réponse en mots | casse, espaces, ponctuation, **accents, singulier/pluriel** | rien (on teste l'idée) |
| **orthographe** | orthographe, accords, grammaire de phrase | casse, espaces, ponctuation | **accents, pluriels, accords** (c'est l'objet) |
| **numerique** | maths à réponse chiffrée | virgule = point, espaces, zéros inutiles | la valeur (règles maths ci-dessous) |
| **exact** | symboles, formules, dates | espaces | tout le reste |

- **Réponses acceptées déclarées** (`reponses_acceptees[]`) : le générateur liste les formes justes (« quatre » / « 4 » ; « 3/4 » / « 0,75 ») et ce qu'il ne faut **pas** normaliser. Préféré à un *fuzzy matching* aveugle.
- **Faute de frappe (Levenshtein 1)** sur mots longs en profil *sens* : **OFF par défaut** (décision Éric).
- **Règles maths** (profil *numerique*, défaut Éric) : fraction **équivalente acceptée** (6/8 = 3/4) ; **unité exigée seulement si la carte le précise** ; décimaux **exacts**, arrondi toléré **uniquement si la carte le mentionne**.
- **État « presque »** (confort élève, sans fausser la mesure) : au lieu d'un *faux* sec, afficher « Presque ! attention à l'accent → *réponse* ». Dans les stats, « presque » compte **juste** en profils *sens/numerique*, **faux** en profil *orthographe* (l'accent/le pluriel était la cible).
- **Seconde chance** (`seconde_chance`, défaut false, activable par notion) : relance immédiate après un « presque », mais **on score la 1ʳᵉ tentative** pour la mesure de rétention.

---

## 6. Chantier 3 — Mesure de rétention par calendrier roulant

Remplace tout bouton manuel « avant/après » : **la phase n'est plus pilotée à la main**, elle est **déduite du calendrier**.

- Chaque notion **réapparaît** dans le menu (~toutes les 4 semaines par défaut). Ces réapparitions programmées **sont** l'espacement et fournissent les points de mesure.
- Le script **étiquette** chaque réponse par `(notion, palier, rang d'occurrence, semaines écoulées, grp)` à partir de l'horodatage et du calendrier.
- **Comparaison par groupe** (choix d'Éric — pas de code individuel) : on compare deux **instantanés agrégés** du même groupe sur les mêmes items, à deux occurrences. `Δ = taux(occurrence N+1) − taux(occurrence N)`.
- **Anti double-comptage** : un appareil = **un vote par item et par occurrence** (verrou local).
- **Fréquence libre** : aucune cadence rigide imposée ; l'analyse se fait après coup sur les événements datés (succès en fonction de l'espacement réel).

**Limites à écrire dans le dossier** : groupe supposé ~constant entre deux occurrences → mesure *de groupe*, pas individuelle ; confondu avec le reste de l'enseignement → **classe témoin** recommandée pour isoler l'effet ; petits effectifs → tendance, pas statistique.

**Acceptation** : pour un (grp, notion) passé ≥ 2 fois, le système calcule un Δ entre occurrences et le date ; aucune donnée ne relie deux occurrences à un même élève.

---

## 7. Chantier 4 — Tableau de bord indicateurs

- Accessible **en 1 clic** depuis la page, **derrière mot de passe**, **copié automatiquement sur le Drive** à chaque mise à jour.
- Contenu : par (grp, notion) → courbe des occurrences, Δ, couleur, **cartes rouges** récurrentes ; par matière/niveau → taux, couverture.
- **Vue porteur (Éric)** : agrégat de tous les profs (adoption, Δ par notion/classe, cartes rouges globales) = l'**indicateur d'échelle établissement** réclamé par l'AAP.

**Acceptation** : un clic + mot de passe ouvre le dashboard à jour ; une copie horodatée est déposée sur le Drive à chaque passe de calcul.

---

## 8. Moteur A — Roulement (déterministe, autonome)

**Rôle** : planifie, **n'invente rien**. Tourne à chaque passe (hebdo).

À chaque exécution :
1. agrège les événements → taux par (grp, notion, palier), Δ par occurrence, cartes rouges, adoption ;
2. met à jour les **couleurs** (§10) et les **fréquences** ;
3. **compose le menu** des semaines suivantes dans la limite du budget, pour couvrir progressivement le programme / le diagnostic initial ;
4. lève un drapeau **⬛ (trou)** quand une notion **due** n'a pas de fiche exploitable (voir §9 pour la définition exacte) ;
5. commit `calendar.json`, `dashboard.json`, `coverage.json`.

**Fréquences différenciées, avec plafonds :**
- intervalle de base **4 semaines** ;
- 🔴 rouge → resserre **4 → 2 → 1**, **plancher = 1 fois/semaine** (anti sur-drill) ;
- 🟢 vert → desserre **4 → 6 → 8** ;
- **budget de menu fixe** : ~4-5 défis / niveau de classe / semaine ;
- **plafond** ~3 notions « boostées » par matière simultanément ; si tout est rouge, **prioriser dans le budget** au lieu de tout accélérer.

**Acceptation** : A est **déterministe** (mêmes entrées → même menu), ne crée aucun contenu, respecte budget et plancher.

---

## 9. Moteur B — Élaboration de fiches (proposition seulement)

**Rôle** : **crée** du contenu nouveau, uniquement en **candidates** soumises à relecture. **Subordonné à A.**

**Déclenchement = auto, sur ⬛**, avec la règle de trou précisée par Éric :
- **Trou structurel** : notion due + **zéro fiche** au catalogue → ⬛ immédiat → B propose.
- **Trou par épuisement** : notion **rouge persistante** *et* dont les fiches existantes ont **réellement été essayées** par les élèves (seuil de tentatives atteint) → ⬛ → B propose.
  - **Garde-fou** : une fiche **non essayée** ne compte pas comme échouée. On ne déclare pas un épuisement sur du contenu non testé. (Pas de ⬛ « par épuisement » tant que `n_reponses` < seuil.)

Chaîne : A lève ⬛ → B génère des candidates → **dépôt dans la file de relecture** (routée §12) → validation carte par carte → entrée au catalogue → A peut programmer la notion.

**Génération initiale (seed, à faire d'emblée)** : produire un premier lot couvrant le référentiel avec un **ratio équitable facile/difficile** — ne pas sur-représenter les notions difficiles ; équilibrer aussi les paliers **nI/nF**. Toutes les candidates seed passent par la relecture.

**Acceptation** : B n'écrit jamais directement au catalogue ; toute candidate a un `relecteur` et un `statut` ; aucune ⬛ « épuisement » n'est levée sous le seuil de tentatives.

---

## 10. Code couleur des notions

| Couleur | Sens | Effet |
|---|---|---|
| ⚪ gris | pas encore évaluée | entre au rythme de la couverture |
| 🟢 vert | maîtrisée (taux ≥ **75 %**) | on **espace** |
| 🟡 ambre | fragile (**50–75 %**) | fréquence normale |
| 🔴 rouge | en difficulté (**< 50 %**) | fréquence **augmentée** (→ A) |
| ⬛ trou | notion due sans fiche exploitable | **manque de contenu** (→ B) |

- **Couleur de notion** → pilote la **fréquence**. **Cartes rouges** (items précis qui échouent) → candidates à **reformulation/remplacement** par B.
- Seuils **provisoires**, à réajuster après les premières semaines.

---

## 11. Modèles IA & spécification de clarté

- **BOX ordinaire** (dépôt PDF → fiches) : **Haiku** (inchangé).
- **Box-FONDA / Moteur B** (génération fondamentaux) : **modèle plus puissant** (p. ex. Sonnet), parce que **l'énoncé ne doit jamais ajouter à la difficulté**.

**Spécification de clarté des énoncés (fondamentaux)** — contrainte de génération et critère de relecture :
- une seule question, un seul attendu ; **réponse très courte** (un mot / un nombre / QCM) ;
- vocabulaire accessible au niveau visé ; pas de double négation, pas de tournure piège ;
- pas de charge de lecture inutile (énoncé bref, contexte minimal) ;
- la difficulté doit porter sur **la notion**, jamais sur **la compréhension de la consigne** ;
- palier explicite : **nI** = version accessible / amorce ; **nF** = version aboutie / transfert simple.

---

## 12. Validation & routage (humain dans la boucle)

- Même mécanisme que la relecture BOX actuelle : **page de relecture envoyée par email, validation question par question**, publication des seules cartes retenues.
- **Routage par le champ `matière`** :
  - `matière = français` → **Justine**
  - `matière = mathématiques` → **Éric**
- Chaque relecteur ne voit que ses candidates. Rien n'entre au catalogue sans feu vert carte par carte (G4).

---

## 13. Séquençage (plan d'action)

- **Lot 0 — déjà là, à formaliser** : relecture carte par carte, catalogue public, question élève→prof, double voie Tally/Google Form.
- **Lot 1 — d'ici le 21/10 (tenable)** : mode Box-FONDA sur la page existante (§4), carte « réponse produite » (§5), tags `grp` + `ctx`, **menu public statique**, **référentiel seed** (§3.1/§10) + **génération initiale équilibrée** routée en relecture (§9), collecte événements n8n → Sheet.
- **Lot 2 — 2026-2027 (cœur de l'expérimentation)** : tableau de bord agrégé + Δ occurrences (§6/§7), Moteur A (roulement/couleurs/fréquences, §8), Moteur B auto sur ⬛ (§9), `coverage.json`, export Drive, GitHub Action cron.
- **Lot 3 — pluriannuel** : numératie robuste, **classe témoin**, essaimage inter-établissements, adossement recherche.

---

## 14. Référentiel amorcé — priorités issues des données (DEPP, évaluations nationales 2025)

Constats retenus (DEPP, début de 6e 2025 ; convergents du CP à la 6e) :
- **Maths — priorité n°1 : la résolution de problèmes.** Compétence la moins réussie **et** plus gros écart hors-EP / REP-REP+. Point de bascule pour un public REP+.
- **Maths — n°2 : nombres décimaux & fractions** (les différentes écritures d'un même nombre : décimale, fractions décimales, fractions, en lettres) ; **calcul / automatismes**.
- **Français — priorités : compréhension** (gradient social le plus fort ; beaucoup d'élèves décodent plus qu'ils ne comprennent), **grammaire de phrase** (constituants, classes de mots, accord sujet-verbe), **orthographe**, **lexique** ; **fluence** à surveiller.

**Pré-pondération de départ** (couleur initiale) :

| Matière | Notion | Palier amorce | Départ |
|---|---|---|---|
| Maths | Résolution de problèmes | nI/nF | 🟡 ambre |
| Maths | Décimaux & fractions (écritures d'un nombre) | nI/nF | 🟡 ambre |
| Maths | Calcul & automatismes | nI/nF | 🟡 ambre |
| Maths | Proportionnalité · Grandeurs & mesures · Espace & géométrie | nI | ⚪ gris |
| Français | Compréhension (écrit/oral) | nI/nF | 🟡 ambre |
| Français | Grammaire de phrase | nI/nF | 🟡 ambre |
| Français | Orthographe (accords, lexicale) | nI/nF | 🟡 ambre |
| Français | Lexique / vocabulaire | nI/nF | 🟡 ambre |
| Français | Fluence / décodage | nI | ⚪ gris |

> Les points chauds démarrent en ambre (fréquence pleine d'emblée) ; le reste entre au fil de la couverture. La **génération initiale** reste **équilibrée facile/difficile** malgré ces priorités (§9).

---

## 15. Critères d'acceptation transverses

- Aucune donnée nominative d'élève n'atteint le modèle ni le serveur (vérifiable sur le schéma d'événements).
- Box-FONDA ne lit aucune source IA-zimut.
- Les pages fonctionnent en statique (Git) ; seule la collecte est dynamique.
- Toute fiche publiée a transité par une validation humaine routée par matière.
- BOX ordinaire tourne sur Haiku ; la génération fondamentaux sur le modèle plus puissant.
- Le dashboard s'ouvre en 1 clic + mot de passe et se copie sur le Drive à chaque passe.

---

## 16. Décisions & points ouverts

**Tranchés (Éric) :**
1. ✅ Déclencheur du calcul : **GitHub Action cron hebdomadaire**.
2. ✅ Collecteur : **n8n → Google Sheet**.
3. ✅ Seuils : valeurs par défaut du PRD (75/50 %, base 4 semaines, plancher 1/sem., budget 4-5/niveau/sem.), **à réviser après les premières semaines**.
4. ✅ Correction auto « réponse produite » : **profil par carte** (§5.1), Levenshtein **off**, règles maths (fraction équivalente acceptée, unité si précisée, décimaux exacts), états « presque » et seconde chance.

**Restant :**
5. Position **DPD / DANE** académique (hors code, pour le dossier).
6. Seuil exact de tentatives déclenchant un ⬛ « épuisement » (§9) — à caler une fois les premiers volumes connus.
