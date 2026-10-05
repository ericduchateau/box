# fonda/data — contrats de données Box-FONDA (T1)

Source de vérité fonctionnelle : [`docs/PRD-Box-FONDA.md`](../../docs/PRD-Box-FONDA.md) §3, §10, §14. Ce fichier documente les schémas **tels qu'implémentés ici** et signale les quelques endroits où le PRD laissait un choix d'enveloppe JSON à trancher — tout est validable par [`fonda/scripts/validate.js`](../scripts/validate.js).

Convention d'id de notion : `{matiere}.{slug}`, `matiere` ∈ `fr` | `maths`, `slug` en kebab-case sans accent. Validé par le pattern `^(fr|maths)\.[a-z0-9-]+$`.

---

## `referentiel.json` — PRD §3.1 + §14

11 notions seed (ratio ambre/gris conforme à la pré-pondération PRD §14). Chaque notion :

| Champ | Type | Notes |
|---|---|---|
| `id` | string | `{matiere}.{slug}`, unique |
| `matiere` | `"français"` \| `"maths"` | valeur lisible (PRD §3.2), distincte du préfixe `id` qui reste en ASCII |
| `categorie` | string | **ajout non prévu tel quel dans le schéma minimal du PRD**, demandé explicitement pour pouvoir regrouper au dashboard sans perdre l'info de famille — voir « Éclatement des notions groupées » ci-dessous |
| `libelle` | string | nom affichable |
| `programme_refs` | string[] | **vide par défaut** — aucune référence officielle au programme n'est inventée ici ; à compléter par Éric/Justine |
| `eval_nat_domaine` | string | domaine DEPP tel que nommé au PRD §14 |
| `paliers` | `["nI","nF"]` | toujours les deux, conforme au schéma §3.1 |
| `palier_amorce` | string[] | **ajout** — reprend la colonne « Palier amorce » du tableau PRD §14 (`["nI","nF"]` pour les notions ambre, `["nI"]` seul pour les notions grises). Ne remplace pas `paliers` : précise seulement par quel palier le Moteur B doit commencer le seed. |
| `priorite_initiale` | `"gris"` \| `"ambre"` | couleur de départ, PRD §3.1 |
| `frequence_base_semaines` | int | `4` par défaut (PRD §8) |

### Éclatement des notions groupées

Le tableau PRD §14 liste *« Proportionnalité · Grandeurs & mesures · Espace & géométrie »* sur une seule ligne (grise). Ici, éclaté en 3 notions distinctes pour être pilotables individuellement par le calendrier/dashboard (décision validée par Éric) :

- `maths.proportionnalite` → `categorie: "grandeurs-mesures"`
- `maths.grandeurs-mesures` → `categorie: "grandeurs-mesures"`
- `maths.espace-geometrie` → `categorie: "espace-geometrie"` (famille à part)

La `categorie` permet de recomposer le regroupement d'origine au dashboard (`GROUP BY categorie`) sans perdre la granularité de `id`.

---

## `calendar.json` — PRD §3.3

Enveloppe choisie : `{ version, last_updated, semaines: [] }`, où chaque élément de `semaines` suit exactement la forme `semaine` du PRD (`iso_week, du, au, entrees[]`). Vide à T1 — rempli par le Moteur A (Lot 2).

## `coverage.json` — PRD §3.4

Enveloppe choisie : `{ version, last_updated, notions: [] }`, où chaque élément de `notions` suit la forme du PRD (`notion_id, a_des_fiches, n_fiches, derniere_passation, couleur, statut, n_reponses_cumulees`). Vide à T1.

## `dashboard.json` — PRD §3.5

Enveloppe choisie :
```
{ version, last_updated,
  par_groupe: [],              // éléments { grp, notion_id, occurrences[], delta, couleur, cartes_rouges[] }
  agrege_etablissement: {
    adoption: { n_profs, n_matieres, n_jeux, n_revisions },
    delta_par_notion: []
  }
}
```
Vide à T1 — rempli par le Moteur A / tableau de bord (Lot 2).

---

## `fonda/fixtures/events.sample.json` — PRD §3.2

Jeu d'événements **synthétiques et anonymes** (aucune donnée réelle d'élève, aucun identifiant individuel). Couvre plusieurs `grp`, `ctx`, paliers, et deux niveaux de `rang_local` (avec `dt_jours: null` au rang 1, conforme au PRD). Sert de fixture pour le validateur et pour les tests futurs du Moteur A (T3+).

---

## Validation

```
node fonda/scripts/validate.js
```

Zéro dépendance (Node natif uniquement, pas de `package.json`). Vérifie :
- JSON bien formé pour les 5 fichiers (`referentiel`, `calendar`, `coverage`, `dashboard`, `events.sample`) ;
- schéma et types de chaque notion de `referentiel.json`, unicité des `id`, pattern d'id, enums (`matiere`, `priorite_initiale`, `paliers`, `palier_amorce`) ;
- enveloppe minimale de `calendar.json` / `coverage.json` / `dashboard.json` ;
- schéma et types de chaque événement de la fixture, enums (`palier`, `ctx`, `result`), cohérence `rang_local`/`dt_jours`, et que chaque `notion_id` référencé existe bien dans `referentiel.json`.

Code de sortie non nul si une vérification échoue (utilisable en CI plus tard).
