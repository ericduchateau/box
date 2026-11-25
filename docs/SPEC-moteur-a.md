# SPEC — Moteur A (roulement) : contrat

> Contrat du Moteur A, validé par l'architecte et Éric le 2026-11-25. **Complète** le PRD §8 (rôle, fréquences, budget, plafond, déterminisme), le §9 (règle du ⬛) et le §10 (couleurs) ; il **tranche** les valeurs que le PRD laissait « à caler ». En cas d'écart avec le PRD sur ces points, **ce document fait foi** ; pour tout le reste, le PRD tranche.
> État : **consigné, non implémenté.** Implémentation en tests d'abord, relue par Codex, une fois ce contrat figé.

## 1. Entrées, sorties, déclenchement (rappel PRD)

- **Entrées** : événements anonymes (PRD §3.2, modifié au §6 ci-dessous), `calendar.json`, `referentiel.json`, `catalogue-fonda.json`.
- **Sorties** : `calendar.json`, `coverage.json`, `dashboard.json` (PRD §8, étape 5).
- **Déclenchement** : GitHub Action en cron hebdomadaire ; exécutable à la main (PRD §2, §16.1).
- **Déterminisme** : mêmes entrées → mêmes sorties, octet pour octet. A ne crée aucun contenu.

## 2. Seuil de bascule : 25 réponses

- Tant qu'une (notion, palier) cumule **moins de 25 réponses** sur la période en cours, elle **garde sa couleur de diagnostic** (`priorite_initiale`, `difficulte.source: "priorite_initiale"`) et aucune bascule de couleur n'a lieu. Le **gris** (PRD §10) ne vaut que pour une notion **sans diagnostic** — aucune des 9 notions programmables aujourd'hui.
- Le même seuil s'applique au ⬛ « épuisement » (PRD §9) : pas d'épuisement tant que `n_reponses` < 25.
- Valeur provisoire, révisable après les premières semaines (PRD §16.3).

## 3. Couleur et tendance

- **Couleur** = **taux de réussite cumulé sur la période** en cours (périodes de `calendar.json`, P1…P5), par (niveau, notion, palier). Seuils PRD §10 : vert ≥ 75 %, ambre 50–75 %, rouge < 50 %.
- **Tendance** = **Δ glissant sur 4 semaines** (taux des 4 dernières semaines − taux des 4 semaines précédentes). Affichée, elle **ne change pas** la couleur.

## 4. Paliers : promotion et acquisition

- **Promotion nI → nF** : le palier nI est **vert (≥ 75 %) et stable sur 2 passes** consécutives → A programme le palier nF de la notion.
- **Acquisition** : le palier nF est **vert et stable** (mêmes 2 passes) → la notion est **acquise** ; elle sort du rythme normal (espacement maximal du PRD §8).
- Une « passe » = une occurrence servie de la (notion, palier) au niveau, ayant atteint le seuil du §2.

## 5. Rouge persistante et plancher de couverture

- **Rouge persistante** (déclencheur du ⬛ « épuisement », PRD §9) : **moyenne < 50 % sur 3 périodes servies** (périodes où la notion a effectivement été servie et a atteint le seuil du §2), **et** seuil de tentatives atteint.
- **Plancher de couverture** : une notion **différée ≥ 2 périodes** (due mais non servie, faute de budget) **remonte en priorité** dans le menu suivant, dans la limite du budget (PRD §8).

## 6. Événements et `defi_id` : du groupe au niveau

- L'événement porte **`niveau`** (6e, 5e, 4e, 3e) au lieu de **`grp`** (classe). L'agrégation et le Δ se font par **(niveau, notion, palier)**.
- Format : `defi_id = defi_{annee}-w{sem}_{niveau}_{slug}_{palier}`.
  - Le **palier** entre dans l'identifiant : solde la dette PRD §16.7 (deux lots nI/nF d'une même notion la même semaine ne partagent plus de `defi_id`).
  - L'**année** est **validée** à la résolution : un lien d'une autre année est refusé.
- Le codage exact de `{niveau}` dans l'identifiant (motif de `DEFI_ID_PATTERN`) est fixé au moment des tests.

## 7. Interprétations confirmées et points reportés

- **Confirmé (2026-11-25)** : « stable » = **2 passes vertes consécutives** ; une passe ne compte qu'**au-delà de 25 réponses** ; « acquise » = **espacement maximal**.
- **Reporté à la phase code** : codage de `{niveau}` dans `DEFI_ID_PATTERN` ; résolution des anciens liens (format par groupe, sans palier) pendant la migration ; mise à jour d'`AGENTS.md` (tag `grp`) et du PRD §6 (« comparaison par groupe »).
