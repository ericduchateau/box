# SPEC — Moteur A (roulement) : contrat

> Contrat du Moteur A, validé par l'architecte et Éric le 2026-11-25. **Complète** le PRD §8 (rôle, fréquences, budget, plafond, déterminisme), le §9 (règle du ⬛) et le §10 (couleurs) ; il **tranche** les valeurs que le PRD laissait « à caler ». En cas d'écart avec le PRD sur ces points, **ce document fait foi** ; pour tout le reste, le PRD tranche.
> État : **consigné, non implémenté.** Implémentation en tests d'abord, relue par Codex, une fois ce contrat figé.

## 1. Entrées, sorties, déclenchement (rappel PRD)

- **Entrées** : événements anonymes (PRD §3.2, modifié au §6 ci-dessous), `calendar.json`, `referentiel.json`, `catalogue-fonda.json`.
- **Sorties** : `calendar.json`, `coverage.json`, `dashboard.json` (PRD §8, étape 5).
- **Déclenchement** : GitHub Action en cron hebdomadaire ; exécutable à la main (PRD §2, §16.1).
- **Déterminisme** : mêmes entrées → mêmes sorties, octet pour octet. A ne crée aucun contenu.
- **Tri des sorties** par unités de code (opérateur `<`, comparaison binaire), jamais `localeCompare`, pour garantir l'identité octet pour octet entre machines. **Exception** : les paliers sont ordonnés **nI puis nF** (ordre pédagogique), et non par unités de code (où `nF` < `nI`).
- **Agrégation interniveau** (amendement du 2026-11-25) : les taux qui pilotent A (couleur, seuil, Δ, cartes) sont calculés **6e à 3e confondus**, **pondérés** (total des réussites / total des réponses), **jamais** en moyenne des taux par niveau. Le niveau reste dans l'événement et nourrit le **tableau de bord**.
- **Jours de classe** : date civile **Europe/Paris** de l'horodatage ; un jour compris dans une période `[du, au]` de `calendar.json` (bornes incluses) est un jour de classe, tout autre jour est un jour de **vacances** : la réponse est ignorée (comptée comme telle). Rejets : un seul motif par réponse, priorité **invalide > futur > vacances** ; le niveau est **validé** (absent ou hors 6e–3e → invalide). Le `notion_id` est **validé** : motif `^(fr|maths)\.[a-z0-9-]+$` (domaine `fr` ou `maths`, slug **minuscule** ; source de vérité : `fonda/data/README.md`, même motif que `evenements.js`) ; non conforme → invalide. Un événement est **lu une seule fois** : seules ses propriétés propres de données comptent ; accesseur, propriété héritée ou accès qui lève → invalide. Pendant les vacances, la période en cours est la **dernière commencée**. `semaines[]` n'entre pas dans ce calcul. **Garantie supposée** : les périodes de `calendar.json` ne se chevauchent pas ; c'est validé en amont (module 7) et le module 1 s'appuie sur cette garantie sans la revérifier. Contrat détaillé : `fonda/engine/agregation.test.js`.

## 2. Seuil de bascule : 25 réponses

- Seuil atteint **à partir de 25 réponses** (`n_reponses >= SEUIL_BASCULE`, soit ≥ 25). Tant qu'une (notion, palier) cumule **moins de 25 réponses** sur la période en cours, elle **garde sa couleur de diagnostic** (`priorite_initiale`, `difficulte.source: "priorite_initiale"`) et aucune bascule de couleur n'a lieu. Le **gris** (PRD §10) ne vaut que pour une notion **sans diagnostic** — aucune des 9 notions programmables aujourd'hui.
- Le même seuil s'applique au ⬛ « épuisement » (PRD §9) : pas d'épuisement tant que `n_reponses` < 25.
- Valeur provisoire, révisable après les premières semaines (PRD §16.3).

## 3. Couleur et tendance

- **Couleur** = **taux de réussite cumulé sur la période** en cours (périodes de `calendar.json`, P1…P5), par (notion, palier), **interniveau** (§1). Seuils PRD §10 : vert ≥ 75 %, ambre 50–75 %, rouge < 50 %.
- **Tendance** = **Δ entre occurrences** (PRD §6) : Δ = taux(occurrence courante) − taux(occurrence précédente) de la même (notion, palier), interniveau, calculé **sur les cartes communes** aux deux occurrences, identifiées par `(set_id, item_id)`. Une occurrence = la semaine du défi lue dans `defi_id` ; seules les **deux plus récentes** servent. Avec deux occurrences, `courante` et `precedente` sont **restreintes aux cartes communes** (sans carte commune : 0 réponse, taux `null`, Δ = `null`, sans remonter à une paire plus ancienne) ; avec une seule, `courante` décrit **toutes** ses réponses, `precedente` = `null`, `items_communs` = 0, Δ = `null` (historique insuffisant, pas une erreur). **Limite assumée** : une réponse est rattachée à la semaine de son défi, pas à sa date ; une réponse **très tardive** peut donc être comparée à une réponse presque simultanée, et le Δ ne mesure pas exactement « l'espacement réel » du PRD §6. L'année du `defi_id` est validée à la **résolution des liens**, pas à l'agrégation (le Δ d'une année sur l'autre reste possible). Affichée, la tendance **ne change pas** la couleur.
- **Validité de l'occurrence** : l'agrégation rejette comme invalide une semaine inexistante dans l'année ISO (ex. 2027-w53) ou un défi dont le lundi est postérieur à la réponse ; elle ne compare pas l'année à `aujourdhui` — l'appartenance à l'année est validée à la résolution des liens.
- **Cartes rouges** : carte `(set_id, item_id)` de la période en cours, taux < 50 % **et au moins 10 réponses** ; en dessous de 10 réponses, la carte est « **insuffisante** ». Règle exacte : `n_reponses >= SEUIL_CARTE` (10) **et** `taux < SEUIL_ROUGE` (0.5), inégalité stricte : 50 % pile n'est pas rouge.
- **Adoption** : décompte des réponses par `ctx` (`df`, `maison`, `classe`), période en cours seulement ; invariant `df + maison + classe = n_reponses`.

## 3 bis. Module 2 — couleur par (notion, palier)

> **Note en avant** : la couleur est calculée **par (notion, palier)**. La réduction **par notion** pour `coverage.json` = **pire couleur des paliers** (rouge > ambre > vert > gris) ; elle est faite au **module 7** (écriture des sorties), pas ici.

- **Signature** : `colorer({ agregation, referentiel }) → { periode_id, couleurs, ignores }` ; exports `colorer`, `SEUIL_VERT = 0.75`, `SEUIL_AMBRE = 0.5`. `periode_id` = celui de l'agrégation (passe-plat).
- **Une couleur par (notion, palier) du référentiel** : `notion.id` (restitué sous le nom `notion_id`) × `notion.paliers`. Chaque élément : `{ notion_id, palier, couleur, source, taux_periode, seuil_atteint }`.
- **Seuil atteint** (entrée d'agrégation présente et `seuil_atteint`, §2) : couleur depuis `taux_periode` — **vert** si `>= SEUIL_VERT`, **ambre** si `>= SEUIL_AMBRE`, **rouge** sinon ; `source: "stats_cartes"`. Frontières : 0,75 → vert ; 0,5 → ambre.
- **Sinon** (pas d'entrée, ou seuil non atteint) : couleur = `priorite_initiale` de la notion, ou **gris** si absente ; `source: "priorite_initiale"`. Pas de bascule sous 25 réponses, quel que soit le taux. `taux_periode` = celui de l'entrée (`null` sans entrée) ; `seuil_atteint` = celui de l'entrée (`false` sans entrée).
- **Domaine** : `couleur` ∈ {`gris`, `vert`, `ambre`, `rouge`} uniquement (le ⬛ « trou » relève du module 6) ; `source` ∈ {`stats_cartes`, `priorite_initiale`}.
- **Hors référentiel** : une entrée d'agrégation dont (notion_id, palier) n'est aucun (notion, palier) du référentiel est ignorée et comptée dans `ignores.hors_referentiel`.
- **Tri** : `notion_id` par unités de code (§1), puis **nI avant nF**. Fonction pure, déterministe octet pour octet. Contrat détaillé : `fonda/engine/couleur.test.js`.
- **Entrées : asymétrie délibérée.** Le module 1 est **tolérant** (événements non fiables : filet, rejets comptés dans `ignores`) ; le module 2 est **fail-fast** (entrées de confiance : sortie du module 1 et `referentiel.json` curé) → `TypeError`. **Référentiel** : `notions` non tableau, notion sans `id`, `id` en double, paliers hors {nI, nF}, vides, creux ou en double, `priorite_initiale` invalide. **Éléments d'agrégation** : `entrees` non tableau ; entrée non objet ; `notion_id` non chaîne ou vide ; `palier` hors {nI, nF} ; `seuil_atteint` non booléen strict ; `taux_periode` ni `null` ni nombre fini de [0, 1] ; `seuil_atteint: true` avec `taux_periode: null` ; (notion_id, palier) en **double** (en choisir un dépendrait de l'ordre). Une entrée **malformée** lève ; seule une entrée **bien formée** absente du référentiel compte dans `ignores.hors_referentiel`. **Règle du gris** : `priorite_initiale` **absente** → gris ; `"gris"` ou `"trou"` **explicites** → `TypeError` (ni l'un ni l'autre n'est une priorité de diagnostic).
- **Notions exclues de la génération** : colorées comme les autres (priorité initiale) ; l'exclusion relève de la génération, le ⬛ (dont le trou des notions sans fiche) du module 6. Le moteur ne consulte pas la liste d'exclusion.

## 4. Paliers : promotion et acquisition

- **Promotion nI → nF** : le palier nI est **vert (≥ 75 %) et stable sur 2 passes** consécutives → A programme le palier nF de la notion.
- **Acquisition** : le palier nF est **vert et stable** (mêmes 2 passes) → la notion est **acquise** ; elle sort du rythme normal (espacement maximal du PRD §8).
- Une « passe » = une occurrence servie de la (notion, palier), **interniveau** (§1), ayant atteint le seuil du §2.

## 5. Rouge persistante et plancher de couverture

- **Rouge persistante** (déclencheur du ⬛ « épuisement », PRD §9) : **moyenne < 50 % sur 3 périodes servies** (périodes où la notion a effectivement été servie et a atteint le seuil du §2), **et** seuil de tentatives atteint.
- **Plancher de couverture** : une notion **différée ≥ 2 périodes** (due mais non servie, faute de budget) **remonte en priorité** dans le menu suivant, dans la limite du budget (PRD §8).

## 6. Événements et `defi_id` : du groupe au niveau

- L'événement porte **`niveau`** (6e, 5e, 4e, 3e) au lieu de **`grp`** (classe). La couleur, le seuil et le Δ se calculent par **(notion, palier), interniveau** (§1) ; le niveau sert au **tableau de bord**.
- Format : `defi_id = defi_{annee}-w{sem}_{niveau}_{slug}_{palier}`.
  - Le **palier** entre dans l'identifiant : solde la dette PRD §16.7 (deux lots nI/nF d'une même notion la même semaine ne partagent plus de `defi_id`).
  - L'**année** est **validée** à la résolution : un lien d'une autre année est refusé.
- **Grammaire cible (figée le 2026-11-26)** : `^defi_(\d{4})-w(\d{1,2})_(6e|5e|4e|3e)_([a-z0-9-]+)_(nI|nF)$` — année sur 4 chiffres, semaine ISO existante dans cette année, niveau ∈ {`6e`, `5e`, `4e`, `3e`}, slug du `notion_id`, palier.
  - Le segment niveau est une **métadonnée** : il doit être un token réel (sinon → invalide), mais c'est le champ `niveau` de l'événement qui fait foi. **Décision 1b = B (Éric, 2026-11-26)** : un désaccord entre le niveau du `defi_id` et celui de l'événement **n'invalide pas** la réponse, qui est comptée.
  - **Dette — migration du générateur** : `fonda/engine/liens.js` (`genererDefiId`) et `evenements.js` (`DEFI_ID_PATTERN`) émettent et valident encore l'**ancien** format `defi_{annee}-w{sem}_{grp}_{slug}` (classe sur 3 chiffres, sans palier). Ces liens sont **rejetés comme invalides** par l'agrégation tant que le générateur n'a pas migré vers la grammaire cible.

## 7. Interprétations confirmées et points reportés

- **Confirmé (2026-11-25)** : « stable » = **2 passes vertes consécutives** ; une passe ne compte qu'**à partir de 25 réponses (≥ 25, §2)** ; « acquise » = **espacement maximal**.
- **Reporté à la phase code** : migration du générateur (`liens.js`, `DEFI_ID_PATTERN` d'`evenements.js`) vers la grammaire cible du §6 ; résolution des anciens liens (format par groupe, sans palier) pendant la migration ; mise à jour d'`AGENTS.md` (tag `grp`) et du PRD §6 (« comparaison par groupe »).
