# AGENTS.md — Projet BOX / Box-FONDA

> Règles **de ce dépôt**, pour Claude Code et Codex. Elles **complètent** les règles globales (`~/.codex/AGENTS.md`), elles ne les remplacent pas.
> **Source de vérité fonctionnelle : `docs/PRD-Box-FONDA.md`.** En cas de doute, le PRD tranche. Si le code existant diverge du PRD, **le signaler** au lieu d'improviser.

---

## Le projet

**BOX** — un prof dépose un PDF de cours → génération de flashcards question/réponse → révision en ligne par répétition espacée, **sans compte élève**.
**Box-FONDA** — extension « savoirs fondamentaux » (littératie / numératie) : calendrier roulant de défis courts, mesure de rétention **par groupe**, tableau de bord, et génération assistée de fiches **validée par un humain**.

Contexte : dépôt à l'AAP **CARDIE-SEPIA 2026-2027** (échéance **21/10/2026**), thème savoirs fondamentaux. Box-FONDA est une extension **de BOX**, pas d'IA-zimut.

---

## Architecture (ne pas casser l'existant)

- **Front** : site **statique** (GitHub Pages). Pas de backend. Les pages lisent des **JSON commités**.
- **Collecte** (seul composant dynamique) : **webhook n8n → Google Sheet / Drive**.
- **Calcul** : **GitHub Action en cron hebdomadaire** (script du dépôt) ; exécutable aussi à la main.
- **Dépôt prof** : **Tally** + **Google Form** (deux voies parallèles — couvrir avec/sans compte Google).
- **Stockage fiches** : Google Drive. Catalogue public via `?set=...`.
- **8 workflows n8n** existants (génération ×2, catalogue, fiche, suppression, question, sélection + anciens liens validation/rejet **conservés pour compat**) → **ne pas les casser**.

---

## Garde-fous NON négociables (G1–G7)

- **G1 — Autonomie vs IA-zimut.** Aucune dépendance aux photos ou au pipeline d'IA-zimut. Les indicateurs ne viennent que des événements d'usage de BOX.
- **G2 — Sans compte élève.** La progression individuelle reste **locale** (navigateur). Aucune auth élève.
- **G3 — Aucune donnée nominative de mineur envoyée au modèle.** Les données d'élèves sont des données nominatives de mineurs : elles ne doivent **jamais** transiter vers une IA qui n'est pas un sous-traitant validé par l'EN. Génération de fiches **à partir du cours + référentiel uniquement**. Toutes les analyses sont **agrégées et anonymes**.
- **G4 — Humain dans la boucle.** Le moteur de génération (B) **propose**, il ne publie **jamais**. Relecture **carte par carte**, **routée par matière** (voir Conventions).
- **G5 — Séparation des modèles.** **Haiku** = BOX ordinaire (PDF → fiches). **Modèle plus puissant (Sonnet)** = génération fondamentaux (clarté des énoncés critique). **Ne pas intervertir.**
- **G6 — Protection légère assumée.** Tableau de bord = mot de passe (filtre le tout-venant, pas un curieux déterminé). L'archive réelle = **copie Drive**. Ne jamais présenter le dashboard comme « sécurisé ».
- **G7 — Hébergement statique.** Pas de backend applicatif ; seul le webhook de collecte est dynamique.

---

## Conventions

- **Paliers** : `nI` (Initial) / `nF` (Final) — difficulté *dans* une notion, indépendante du niveau de classe. **Jamais "n0".**
- **Tags d'événement** : `grp` (groupe choisi par le **prof** au lancement, **jamais** un élève) ; `ctx` ∈ {`df`, `maison`, `classe`}.
- **Couleurs de notion** : `gris` (non évaluée) · `vert` (≥ 75 %) · `ambre` (50–75 %) · `rouge` (< 50 %) · `trou`/⬛ (notion due sans fiche exploitable).
- **Fichiers de données** : `referentiel.json`, `calendar.json`, `coverage.json`, `dashboard.json` ; événements = lignes du Sheet (schéma PRD §3.2) ; file de relecture (PRD §3.6). Respecter les schémas du PRD.
- **Routage relecture** : `matière = français` → **Justine** ; `matière = mathématiques` → **Éric**.
- **Correction auto** (carte « réponse produite ») : **profil par carte** ∈ {`sens`, `orthographe`, `numerique`, `exact`} + `reponses_acceptees[]` déclarées par le générateur. **Levenshtein off** par défaut. Maths : fraction équivalente **acceptée**, unité **exigée seulement si la carte le précise**, décimaux **exacts** sauf arrondi mentionné. État « presque » et seconde chance : voir PRD §5.1.

---

## Les deux moteurs

- **Moteur A — Roulement** : **déterministe**, planifie le menu, met à jour couleurs/fréquences/couverture. **Ne crée aucun contenu.**
- **Moteur B — Élaboration** : **propose seulement**, se déclenche sur ⬛, dépose des **candidates** en file de relecture. Règle du trou : une fiche **non essayée** par les élèves **n'est pas** « épuisée » (pas de ⬛ « épuisement » sous le seuil de tentatives). Génération initiale : **ratio équilibré facile/difficile** et nI/nF.

---

## Façon de travailler (pour l'agent)

1. **Explorer en lecture seule d'abord.** Puis tenir **`AVANCEMENT.md`** à jour : objectif · fait · en cours · prochaine étape · décisions · pièges. (Sert aussi au relais Codex quand un quota est épuisé.)
2. **Plan avant code.** Produire plan + liste de fichiers + **contrats de données JSON**, les **valider contre le PRD**, *avant* d'implémenter.
3. **Un chantier = une branche = une PR.** *Definition of done* = critères d'acceptation du PRD (§15 + ceux du chantier). Suivre l'ordre des lots — **Lot 1 d'abord**.
4. **Incréments petits et vérifiables.** Committer souvent. Pour les zones à bugs (correction §5.1, mesure de rétention §6), **écrire les tests d'abord**.
5. **n8n** : produire les workflows **en JSON à importer**. **Ne pas modifier le live.** Tester sur une copie.
6. **Données** : développer sur des **fixtures synthétiques anonymes**. **Jamais** de données Pronote / élève réelles dans la boucle.
7. **Critique** (si demandée) : session **fraîche**, **lecture seule**, consigne « trouve tous les angles morts et failles ».

---

## Pièges connus (à ne pas commettre)

- Transformer Box-FONDA en annexe d'IA-zimut (**interdit**, cf. G1).
- Publier une fiche sans validation humaine (cf. G4).
- Normaliser accents / pluriels en profil `orthographe` — **c'est la cible de la mesure**, pas du bruit.
- Imposer une tolérance de correction **globale** : elle est **par carte**.
- Casser la compat des anciens liens n8n (validation/rejet).
