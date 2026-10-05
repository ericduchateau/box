# fonda/engine — carte « réponse produite » + correction par profil (T2)

Référence : [`docs/PRD-Box-FONDA.md`](../../docs/PRD-Box-FONDA.md) §5, §5.1.

Révisé le 2026-10-05 suite critique Codex (4 failles graves + 7 moyennes relevées sur la première version). Les arbitrages ci-dessous sont ceux validés par Éric après cette critique — voir `AVANCEMENT.md` pour l'historique complet.

## Fichiers

- **`correction.js`** — moteur de correction pur (zéro DOM, zéro dépendance). Format UMD : `require()`-able en Node (tests, futurs scripts de calcul) et chargeable en `<script>` classique dans le navigateur (pose `window.FondaCorrection`), cohérent avec le style du front BOX existant (pas de bundler).
- **`correction.test.js`** — suite de tests (59 cas), écrite **avant** chaque révision du moteur. `node --test fonda/engine/correction.test.js`.
- **`carte-reponse-produite.js`** — composant vanilla JS (saisie courte → validation → feedback). Charge `window.FondaCorrection`, donc à inclure **après** `correction.js` dans la page. **Développé isolé, non branché à `index.html`** (impact prod nul) — le câblage dans la page existante est T4.
- **`carte-reponse-produite.test.js`** — test d'intégration du contrat seconde chance (`tentative`/`scored`), avec un DOM factice minimal maison (zéro dépendance, pas de jsdom).

Tout lancer : `node --test fonda/engine/*.test.js`.

## Couche de normalisation commune (avant toute règle de profil, tous profils)

1. **NFC** — règle le cas d'un accent saisi en forme décomposée (`É` = `E` + accent combinant) qui, sans ça, ne matcherait pas visuellement le même `É` précomposé.
2. **Apostrophes, traits d'union et espaces typographiques → forme ASCII canonique** : `’`→`'`, `‑`/`–`/`—`/`−`→`-`, espaces insécables/fines→espace normal.

Ensuite seulement s'appliquent les règles propres à chaque profil.

## API de `correction.js`

```js
const { evaluerReponse, compteCommeReussite } = require('./correction.js');

evaluerReponse({
  profil: 'numerique',            // 'sens' | 'orthographe' | 'numerique' | 'exact'
  reponseDonnee: '8 cm',
  reponsesAcceptees: ['8'],
  unite: 'cm',                    // optionnel, numerique seulement
  arrondi: null,                  // optionnel, numerique seulement
});
// → { statut: 'juste' | 'presque' | 'faux' }

compteCommeReussite('presque', 'numerique');   // → true  (compte juste)
compteCommeReussite('presque', 'orthographe'); // → false (compte faux, c'était la cible)
compteCommeReussite(undefined, 'numerique');   // → false (défaut sûr, jamais de réussite silencieuse)
```

## Règles par profil (arbitrages validés le 2026-10-05)

### orthographe
Pardonne : casse, espaces externes, **ponctuation de phrase uniquement** (`. , ; !`).
Strict sur : **accents, apostrophe, trait d'union, pluriels/accords**. `lhomme` ≠ `l'homme` → **faux** (pas presque — l'apostrophe est significative).
« Presque » : déclenché **uniquement** par un accent manquant (palier relâché = strict + accents pardonnés, rien d'autre). Un pluriel en trop, une apostrophe absente → faux net, pas presque.

### sens
Pardonne : casse, espaces, ponctuation (y compris apostrophe/trait d'union), accents.
**Plus aucun repli automatique sur le pluriel** (l'ancien repli mécanique `-s/-x` créait une collision — `chaux` devenait `chau` et matchait n'importe quoi finissant par `chau`). Un pluriel/variante doit être déclaré explicitement dans `reponses_acceptees[]` s'il doit être accepté (`["cheval", "chevaux"]`).

### numerique — unité
| Réponse | Unité carte | Résultat |
|---|---|---|
| valeur correcte, unité absente | exigée (`unite: "cm"`) | `presque` |
| valeur correcte, unité différente (`8 kg`) | exigée (`unite: "cm"`) | **`faux`** (pas presque — la grandeur est fausse) |
| valeur correcte, unité correcte | exigée | `juste` |
| valeur correcte, **rien d'autre** | non exigée (`unite: null`) | `juste` |
| valeur correcte, **reliquat alphabétique** (`8 banane`) | non exigée | **`faux`** (changement : avant T2-révisé, c'était ignoré/juste) |

Les unités avec chiffre (`cm2`, `m3`) sont reconnues et peuvent être exigées.

### numerique — arrondi
`arrondi: n` (entier ≥ 0) arrondit la **cible** (valeur attendue) à `n` décimales — demi vers le haut, avec une correction de l'artefact binaire habituel de `toFixed`/`Math.round` (ex. `2.675` est en réalité stocké comme `2.67499999999999982...` en IEEE754 ; un arrondi naïf donnerait `2.67` au lieu de `2.68`). **L'élève doit produire exactement cette cible** — ce n'est pas une tolérance qui pardonne son imprécision, c'est un exercice d'arrondi : `1/3` avec `arrondi:2` → cible `0,33` ; répondre `0,333` ou la fraction `1/3` elle-même est **faux**.

`arrondi` invalide (négatif, non entier, mauvais type) → repli silencieux sur comparaison exacte, jamais d'exception.

### numerique — comparaison exacte (sans `arrondi`)
Égalité à une tolérance **relative** à l'échelle des valeurs comparées (jamais un seuil absolu fixe) : absorbe le bruit de représentation binaire réel (~1e-15 à l'échelle d'une carte) sans jamais confondre deux valeurs réellement différentes, même proches de zéro (`0` ≠ `0.0000000009`).
Fractions : **entier/entier uniquement** (`6/8` = `3/4`). Toute autre forme contenant `/` (ex. `0,5/1,5`) n'est pas traitée comme une fraction.
Séparateur de milliers en espace (normal ou insécable) accepté : `1 000` = `1000`.

### exact
Inchangé : seuls les espaces sont pardonnés (après la couche de normalisation commune — donc une apostrophe/un tiret typographique y est désormais traité comme son équivalent ASCII, ce qui n'est pas une tolérance « exact » mais une correction d'encodage).

## Robustesse

- **Réponse vide** (ou uniquement des espaces) : toujours `faux`, même si `reponses_acceptees` contient une entrée vide ou blanche (carte malformée).
- **`compteCommeReussite`** : `false` par défaut pour tout statut inconnu/`undefined`/profil inconnu — jamais de réussite silencieuse sur une erreur d'intégration.

## Contrat seconde chance (`carte-reponse-produite.js`)

`onResultat` reçoit `{ statut, reussite, tentative, scored }`. `scored` n'est `true` que pour `tentative === 1` (PRD §5.1 : « on score la 1ère tentative »). La seconde chance (relance immédiate, uniquement après un `presque`, si `carte.seconde_chance` est vrai) est pédagogique et n'est **jamais** scorée. À charge de l'appelant (T3) de ne construire un événement de mesure (PRD §3.2) que pour les résultats où `scored === true`.

## Ce qui n'est pas couvert ici

L'émission réelle des événements au flux (`grp`, `notion_id`, verrou un-vote/occurrence) est hors scope T2 — c'est T3.
