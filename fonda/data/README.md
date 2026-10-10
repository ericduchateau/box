# fonda/data — contrats de données Box-FONDA (T1)

Source de vérité fonctionnelle : [`docs/PRD-Box-FONDA.md`](../../docs/PRD-Box-FONDA.md) §3, §10, §14. Ce fichier documente les schémas **tels qu'implémentés ici** et signale les quelques endroits où le PRD laissait un choix d'enveloppe JSON à trancher — tout est validable par [`fonda/scripts/validate.js`](../scripts/validate.js).

Convention d'id de notion : `{matiere}.{slug}`, `matiere` ∈ `fr` | `maths`, `slug` en kebab-case sans accent. Validé par le pattern `^(fr|maths)\.[a-z0-9-]+$`.

---

## `referentiel.json` — v2, diagnostic évaluations nationales 4e 2026

**Révisé le 2026-10-05** (remplace le seed v1 ci-dessous) : 12 notions issues du diagnostic réel des évaluations nationales 4e 2026 du collège (données agrégées, anonymes), reframées en 4 **axes** transversaux (`Comprendre`, `Représenter`, `Raisonner`, `Exprimer`) plutôt qu'en simple découpage par matière. `version` est passée en chaîne (`"2.0"`) — le validateur accepte les deux formes (chaîne ou entier), pour ne pas casser un futur retour en arrière.

| Champ | Type | Notes |
|---|---|---|
| `id` | string | `{matiere}.{slug}`, unique — inchangé |
| `matiere` | `"français"` \| `"maths"` | inchangé — déterminant le relecteur |
| `relecteur` | `"justine"` \| `"eric"` | **nouveau, obligatoire** — routing explicite, cohérent avec `matiere` (`français`⇔`justine`, `maths`⇔`eric`) : le validateur rejette toute incohérence, pour protéger le routage de relecture (G4) même si `matiere` et `relecteur` sont saisis séparément. |
| `axe` | `"Comprendre"` \| `"Représenter"` \| `"Raisonner"` \| `"Exprimer"` | **nouveau, obligatoire** — remplace `categorie` (v1) comme couche de regroupement, mais porte un sens pédagogique transversal plutôt qu'une simple famille de matière. |
| `libelle` | string | inchangé |
| `paliers` | `["nI","nF"]` | inchangé dans sa valeur, mais désormais validé **strictement égal** à ce tableau exact (plus seulement « non vide ») |
| `palier_amorce` | string (`"nI"` \| `"nF"`) | **changement de type** : v1 en faisait un tableau (`["nI","nF"]` ou `["nI"]`) ; v2 en fait une chaîne unique — un seul palier d'amorce par notion. Doit être présent dans `paliers`. |
| `priorite_initiale` | `"rouge"` \| `"ambre"` \| `"vert"` | **enum changé** : `"gris"` (v1) a disparu, remplacé par `"rouge"` (sévérité la plus forte) ; `"vert"` ajouté (notion déjà satisfaisante au diagnostic). C'est la sévérité du **diagnostic de départ**, pas la couleur live du dispositif (celle-ci viendra de l'usage réel des cartes BOX). |
| `frequence_base_semaines` | int | inchangé |

**Retirés du contrat v2** (champs de l'ancien seed, plus validés — peuvent être absents sans erreur) :
- `categorie` → remplacé conceptuellement par `axe` (regroupement pédagogique, pas juste une famille de matière).
- `programme_refs` → abandonné, aucun équivalent v2.
- `eval_nat_domaine` → remplacé par `taux_eval.domaine` (imbriqué, voir ci-dessous), **laissé souple** (non validé par le script).

**Laissés volontairement souples (présents ou non, jamais validés)** : `ordre` (ordre d'affichage), `note` (commentaire libre), `disciplines` (disciplines pouvant prescrire le défi), `micro_competence` (texte libre), `enonce_modele` (énoncés réels des évaluations, **amorces de génération pour T6, jamais à recopier tels quels — varier les contextes est une règle impérative, voir `convention.variete_generation` dans le fichier**), `taux_eval` (diagnostic détaillé : `domaine`, `satisfaisant_college`, `items`).

### Historique — seed v1 (11 notions, PRD §3.1/§14, remplacé)

Le seed v1 partait de la pré-pondération nationale PRD §14 (ratio ambre/gris), avec `categorie`/`programme_refs`/`eval_nat_domaine` et `palier_amorce` en tableau. Il éclatait la ligne groupée PRD §14 *« Proportionnalité · Grandeurs & mesures · Espace & géométrie »* en 3 notions distinctes partageant une `categorie`. Remplacé en v2 par le diagnostic réel du collège — conservé ici comme trace, pas comme contrat actif.

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

Jeu d'événements **synthétiques et anonymes** (aucune donnée réelle d'élève, aucun identifiant individuel). Couvre plusieurs `grp`, `ctx`, paliers, et deux niveaux de `rang_local` (avec `dt_jours: null` au rang 1, conforme au PRD). Sert de fixture pour le validateur et pour les tests du Moteur A (T3).

---

## `classes.json` (T3)

Liste fermée des 20 classes de l'année, format canonique **3 chiffres sans lettre** (ex. `"601"`, pas `"6e1"`). C'est la seule source de vérité pour la validité d'un `grp` — voir [`fonda/engine/evenements.js`](../engine/evenements.js). À remettre à jour chaque rentrée.

## `destinataires.json` (T3, étendu en préparation T6b)

Structure par niveau (`6e`/`5e`/`4e`/`3e`), vide à T3 — **adresses de collègues adultes** (relecture par matière), jamais de donnée élève. Non consommé par le moteur d'événements ; posé en prévision d'un usage ultérieur (notifications de relecture).

**`relecteurs`** (ajouté en préparation de la SPEC T6b, §5) : adresses de **TEST** pour le routage de relecture par matière (indépendant du niveau) — `eric` (adresse réelle d'Éric) et `justine` (adresse de TEST, marquée `_TEST` : **à remplacer par la vraie adresse de Justine avant toute mise en service**, jamais utilisée comme adresse réelle d'envoi).

---

## Validation

```
node fonda/scripts/validate.js
```

Zéro dépendance (Node natif uniquement, pas de `package.json`). Vérifie, pour `referentiel.json` (v2) :
- enveloppe (`version` chaîne ou entier, `last_updated`, `notions` non vide) ;
- unicité et pattern des `id` ;
- `matiere` ∈ {français, maths} et `relecteur` ∈ {justine, eric}, **cohérents entre eux** (français⇔justine, maths⇔eric) ;
- `axe` ∈ {Comprendre, Représenter, Raisonner, Exprimer} ;
- `paliers` strictement égal à `["nI","nF"]` ; `palier_amorce` (chaîne) ∈ {nI, nF} et présent dans `paliers` ;
- `priorite_initiale` ∈ {rouge, ambre, vert} ;
- `frequence_base_semaines` entier positif ;
- **ne valide plus** `categorie`/`programme_refs`/`eval_nat_domaine` (retirés du contrat, voir ci-dessus) ; **ne valide pas** `ordre`/`note`/`disciplines`/`micro_competence`/`enonce_modele`/`taux_eval` (laissés souples).

Et aussi : enveloppe minimale de `calendar.json`/`coverage.json`/`dashboard.json` ; schéma et types de chaque événement de `events.sample.json`, **liste blanche stricte des 11 champs du schéma** (tout champ supplémentaire est rejeté, cf. G3), enums (`palier`, `ctx`, `result`), cohérence `rang_local`/`dt_jours`, et — contrôle déjà présent avant la révision v2, c'est lui qui a détecté la divergence de la fixture au moment du changement de référentiel — que chaque `notion_id` référencé existe bien dans `referentiel.json`.

Code de sortie non nul si une vérification échoue (utilisable en CI plus tard). `fonda/scripts/validate.js` exporte aussi, sans lecture disque (réutilisables/testés dans `validate.test.js`) :
- `validerEvenement(event, notionIds)` (T3) — réutilisé par [`fonda/engine/evenements.js`](../engine/evenements.js) avant toute mise en file ;
- `validerNotion(notion)` — valide une notion isolée contre le schéma v2 ci-dessus ;
- `validerEnveloppeReferentiel(data)` — valide l'enveloppe du référentiel isolément.
