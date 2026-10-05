# fonda/engine — carte « réponse produite » + correction par profil (T2)

Référence : [`docs/PRD-Box-FONDA.md`](../../docs/PRD-Box-FONDA.md) §5, §5.1.

Révisé le 2026-10-05, **trois passes** suite critiques Codex successives (lecture seule) : 4 failles graves + 7 moyennes sur la 1ʳᵉ version, 2 graves + 5 moyennes sur la 2ᵉ, puis 2 moyennes + 3 faibles (dont le lexical cœur/coeur) sur une 3ᵉ critique ciblée qui a clos le ticket. Les arbitrages ci-dessous sont ceux validés par Éric après ces trois passes — voir `AVANCEMENT.md` pour l'historique complet.

## Fichiers

- **`correction.js`** — moteur de correction pur (zéro DOM, zéro dépendance). Format UMD : `require()`-able en Node (tests, futurs scripts de calcul) et chargeable en `<script>` classique dans le navigateur (pose `window.FondaCorrection`), cohérent avec le style du front BOX existant (pas de bundler).
- **`correction.test.js`** — suite de tests (80 cas), écrite **avant** chaque révision du moteur. `node --test fonda/engine/correction.test.js`.
- **`carte-reponse-produite.js`** — composant vanilla JS (saisie courte → validation → feedback). Charge `window.FondaCorrection`, donc à inclure **après** `correction.js` dans la page. **Développé isolé, non branché à `index.html`** (impact prod nul) — le câblage dans la page existante est T4.
- **`carte-reponse-produite.test.js`** — test d'intégration du contrat seconde chance (`tentative`/`scored`) et du feedback affiché, avec un DOM factice minimal maison (zéro dépendance, pas de jsdom).

Tout lancer : `node --test fonda/engine/*.test.js`.

## Couche de normalisation commune (avant toute règle de profil, tous profils)

1. **NFC** — règle le cas d'un accent saisi en forme décomposée (`É` = `E` + accent combinant) qui, sans ça, ne matcherait pas visuellement le même `É` précomposé.
2. **Apostrophes, traits d'union et espaces typographiques → forme ASCII canonique** : `’`→`'`, `‑`/`–`/`—`/`−`→`-`, espaces insécables/fines→espace normal.

Ensuite seulement s'appliquent les règles propres à chaque profil.

## API de `correction.js`

```js
const { evaluerReponse, compteCommeReussite, calculerCibleAffichee } = require('./correction.js');

evaluerReponse({
  profil: 'numerique',            // 'sens' | 'orthographe' | 'numerique' | 'exact'
  reponseDonnee: '8 cm',
  reponsesAcceptees: ['8'],
  unite: 'cm',                    // optionnel, numerique seulement
  arrondi: null,                  // optionnel, numerique seulement, entier 0-10
});
// → { statut: 'juste' | 'presque' | 'faux' | 'carte_invalide' }

compteCommeReussite('presque', 'numerique');   // → true  (compte juste)
compteCommeReussite('presque', 'orthographe'); // → false (compte faux, c'était la cible)
compteCommeReussite('juste', 'profil-inconnu');// → false (profil invalide : jamais de réussite)

// Pour le feedback pédagogique : la cible RÉELLEMENT exigée, pas l'attendu brut.
calculerCibleAffichee({ profil: 'numerique', reponsesAcceptees: ['1/3'], arrondi: 2 }); // → "0,33"
calculerCibleAffichee({ profil: 'numerique', reponsesAcceptees: ['8'], unite: 'cm' });  // → "8 cm"
```

## Règles par profil

### orthographe
Pardonne : casse, espaces externes, **ponctuation finale uniquement** (`. ! ?`, en position externe — début/fin de la réponse).
Strict sur : accents, apostrophe, trait d'union, virgule/plus/slash, pluriels/accords. `lhomme` ≠ `l'homme` → **faux** (pas presque). `cha,t` ≠ `chat` → **faux** (la virgule interne n'est plus pardonnée, cf. « Ponctuation » ci-dessous).
« Presque » : déclenché **uniquement** par un accent manquant (palier relâché = strict + accents pardonnés, rien d'autre).

### sens
Pardonne : casse, espaces, apostrophe (dédié à ce profil), accents, ponctuation finale `. ! ?` en position externe.
**Plus aucun repli automatique sur le pluriel**, et **`-`, `+`, `,`, `/` ne sont plus jamais pardonnés** (même en interne) : `-4` ≠ `4`, `1,5` ≠ `15`. Une variante (pluriel, trait d'union composé, etc.) doit être déclarée explicitement dans `reponses_acceptees[]` si elle doit être acceptée.

### Ponctuation — règle commune (sens + orthographe)
Seuls `. ! ?` sont pardonnés, et **uniquement en position externe** (début/fin de la chaîne). `-`, `+`, `,`, `/` sont **toujours significatifs**, où qu'ils soient. Conséquence assumée : une leniency précédente (ex. `porte-monnaie` = `portemonnaie` en sens) a disparu — à déclarer dans `reponses_acceptees[]` si besoin.

### numerique — unité
| Réponse | Unité carte | Résultat |
|---|---|---|
| valeur correcte, unité absente | exigée (`unite: "cm"`) | `presque` |
| valeur correcte, unité différente (`8 kg` pour `unite:"cm"`) | exigée | **`faux`** |
| valeur correcte, unité correcte, **même casse** | exigée | `juste` |
| valeur correcte, unité correcte, **casse différente** (`8 mA` pour `unite:"MA"`) | exigée | **`faux`** (la casse des préfixes change la grandeur) |
| valeur correcte, **rien d'autre** | non exigée (`unite: null`) | `juste` |
| valeur correcte, **reliquat alphabétique** (`8 banane`) | non exigée | **`faux`** |

La comparaison d'unité est **sensible à la casse** et **symétrique** : l'unité exigée par la carte passe par la même canonisation typographique (apostrophes/tirets/espaces) que la saisie de l'élève, et les exposants Unicode sont normalisés en chiffres des deux côtés (`cm²` ≡ `cm2`, dans un sens comme dans l'autre), **y compris le moins en exposant** (`⁻` → `-`, donc `m·s⁻¹` ≡ `m·s-1`, quel que soit le côté qui utilise la forme exposant).

### numerique — `carte_invalide` : attendu incohérent (problème d'auteur, pas de l'élève)

Si l'une des `reponses_acceptees` est elle-même incohérente, le moteur renvoie `carte_invalide` — **jamais `juste`**, quelle que soit la réponse de l'élève. Trois cas détectés :
- la valeur ne parse à rien de fini **et** l'entrée contient un `/` : fraction manifestement ratée — **dénominateur nul** (`"1/0"`), ou **forme non reconnue** (`"/3"`, rien avant le `/`). Un nombre non fini **sans** `/` (notation hors de portée d'un flottant 64 bits) reste couvert par le garde-fou existant (→ `faux` global), ce n'est pas une incohérence de forme de l'attendu ;
- le reliquat d'une entrée **ne ressemble pas à une unité** (aucune lettre, ni `°`/`%` — ex. `"0,5/1,5"` ou `"1/2/"` : fraction non entier/entier ou slash résiduel, cf. règle « entier/entier uniquement » ci-dessous — le reliquat `/1,5` ou `/` n'est pas une unité). Un reliquat **avec un chiffre mais aussi des lettres** (`cm2`, `m·s⁻¹`) reste une unité légitime, pas une incohérence ;
- le reliquat ressemble à une unité (il contient une lettre) mais **contredit l'unité déclarée par la carte** (ex. attendu `"8 kg"` alors que `unite:"cm"`).

Ces trois cas ne valent que pour l'**attendu** (`reponses_acceptees`) — une carte malformée se signale, elle ne doit jamais être validée malgré elle. La **même forme de fraction malformée tapée par l'élève** (`"1/"`, `"1/2/"`, `"/3"`, `"1/0"`) reste simplement `faux` (jamais `juste`) : la carte, elle, est correcte — ce n'est qu'une saisie élève invalide, pas un problème à remonter en relecture.

`carte_invalide` compte toujours `faux` pour la mesure (`compteCommeReussite`) et n'est jamais compté réussite, quel que soit le profil. Objectif : remonter une carte malformée en relecture plutôt que de valider silencieusement une réponse sur la base d'un attendu erroné.

### numerique — arrondi
`arrondi: n` (entier **0 à 10 inclus** — hors bornes, repli silencieux sur comparaison exacte) arrondit la **cible** (valeur attendue) à `n` décimales — demi vers le haut, avec une correction **relative** (quelques ULPs, pas un seuil absolu) de l'artefact binaire habituel de `toFixed`/`Math.round` (ex. `2.675` est en réalité stocké comme `2.67499999999999982...` en IEEE754 ; un arrondi naïf donnerait `2.67` au lieu de `2.68`). Cette correction est volontairement minuscule : un écart réellement différent du seuil (ex. `2.674999999999`, dont l'écart à `2.675` est ~1e-12, bien supérieur au bruit binaire ~1e-16) **n'est pas** artificiellement poussé au-dessus — sa cible arrondie reste `2.67`.

**L'élève doit produire exactement cette cible** — ce n'est pas une tolérance qui pardonne son imprécision, c'est un exercice d'arrondi : `1/3` avec `arrondi:2` → cible `0,33` ; répondre `0,333` ou la fraction `1/3` elle-même est **faux**. Le **feedback affiché** montre toujours cette cible calculée (avec l'unité si exigée), jamais la réponse acceptée brute.

### numerique — comparaison exacte (sans `arrondi`)
Tolérance **relative à l'échelle des valeurs comparées** (`≈ Number.EPSILON × quelques unités`, pas un seuil absolu fixe) : absorbe uniquement le bruit réel de représentation binaire, jamais un écart décimal significatif — **y compris pour de grands nombres** (`1000000001` ≠ `1000000000`) et **y compris près de zéro** (`0` ≠ `0.0000000000005`, aucun plancher de tolérance qui confondrait deux valeurs réellement distinctes).

> **Déviation documentée** : la critique Codex suggérait une tolérance relative `≈1e-9×max(|a|,|b|)`. Ce facteur a été testé et **ne suffit pas** : à l'échelle `1e9`, il donne une tolérance absolue de `~1`, qui confond justement deux grands entiers consécutifs (`1000000001`/`1000000000`) — l'un des deux cas que la correction devait précisément résoudre. Le facteur retenu (`Number.EPSILON × 8`, soit ~1.8e-15 relatif) résout les deux cas simultanément.

Fractions : **entier/entier uniquement** (`6/8` = `3/4`). Toute autre forme contenant `/` (ex. `0,5/1,5`) n'est pas traitée comme une fraction. Séparateur de milliers en espace (normal ou insécable) accepté : `1 000` = `1000`.

### exact
Inchangé : seuls les espaces sont pardonnés (après la couche de normalisation commune — donc une apostrophe/un tiret typographique y est désormais traité comme son équivalent ASCII, ce qui n'est pas une tolérance « exact » mais une correction d'encodage).

## Robustesse / garde-fous

- **Contrôle du vide EN DERNIER** : après normalisation complète (pas sur la saisie brute), une réponse qui se réduit à une chaîne vide (vide, espaces, ou purement de la ponctuation pardonnée comme `!!!`) est toujours `faux` — même si `reponses_acceptees` contient elle-même une entrée vide/blanche.
- **`compteCommeReussite`** : `false` pour tout **statut OU profil** inconnu/`undefined`/`null` — même un statut `juste` ne compte pas si le profil est invalide. Jamais de réussite silencieuse sur une erreur d'intégration.
- **Nombres non finis** : un nombre dont la conversion donne `Infinity`/`-Infinity` (ex. un nombre de centaines de chiffres) est traité comme invalide (`NaN`), côté réponse de l'élève **et** côté réponse acceptée. Toujours `faux`, jamais d'exception.
- **Profil inconnu** : `evaluerReponse` retourne `{ statut: 'faux' }` au lieu de lever une exception (changement : la 1ʳᵉ version de T2 levait une erreur ici).

## Contrat seconde chance (`carte-reponse-produite.js`)

`onResultat` reçoit `{ statut, reussite, tentative, scored }`. `scored` n'est `true` que pour `tentative === 1` (PRD §5.1 : « on score la 1ère tentative »). La seconde chance (relance immédiate, uniquement après un `presque`, si `carte.seconde_chance` est vrai) est pédagogique et n'est **jamais** scorée. À charge de l'appelant (T3) de ne construire un événement de mesure (PRD §3.2) que pour les résultats où `scored === true`.

## Limites connues (hors périmètre collège — signalées, pas corrigées)

Relevées par les 2ᵉ et 3ᵉ critiques Codex, volontairement laissées telles quelles (arbitrage Éric : hors du périmètre réaliste d'une réponse saisie par un collégien) :

- **Notation scientifique** (`1e3`) : non reconnue comme nombre — le `e3` est traité comme un reliquat (unité), donc interprété silencieusement comme `1`. Un collégien ne tape pas en notation scientifique.
- **Signe `+` explicite** (`+8`) : rejeté pour l'attendu `8` (le parseur n'accepte qu'un signe `-` optionnel, pas `+`).
- **Formules avec espaces internes en profil `exact`** (`E = mc²` vs `E=mc²`) : rejetées — `exact` est volontairement strict sur tout sauf les espaces de bordure/redondants, pas sur l'espacement interne d'une formule.
- **Précision au-delà de ~12 chiffres significatifs** (flottants 64 bits) : à cette échelle, la tolérance relative `Number.EPSILON × 8` peut encore absorber un écart réellement présent dans la saisie (ex. `0,3300000000000001` accepté pour une cible `0,33`), et l'arrondi « demi vers le haut » peut en théorie franchir un seuil sur un cas aussi extrême. Un collégien ne tape pas 15 décimales.
- **`.5` accepté pour `5` en profil `sens`** : le point initial n'est pas retiré (seule la ponctuation finale `. ! ?` l'est) ; cas marginal, pas une vraie confusion pédagogique.
- **Graphies d'unité avec espaces autour de `/`** (ex. `8 m / s` pour l'unité `m/s`) : rejetées — les espaces internes à l'unité ne sont pas normalisés (seuls les exposants et le moins en exposant le sont).
- **Variantes lexicales** (ex. `cœur`/`coeur`, ligature vs lettres séparées) : non gérées par le moteur (ni accent, ni ponctuation, ni typographie) — à déclarer explicitement dans `reponses_acceptees[]` si la variante doit être acceptée.
- ~~Nombres non finis~~ — **corrigé** (voir « Robustesse » ci-dessus).
- ~~Attendu incohérent (unité contradictoire, fraction malformée)~~ — **corrigé** : voir `carte_invalide` ci-dessus.
- ~~Moins en exposant (`⁻`) non normalisé~~ — **corrigé** : voir « numerique — unité » ci-dessus.
