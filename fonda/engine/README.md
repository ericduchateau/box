# fonda/engine — carte « réponse produite » + correction par profil (T2)

Référence : [`docs/PRD-Box-FONDA.md`](../../docs/PRD-Box-FONDA.md) §5, §5.1.

## Fichiers

- **`correction.js`** — moteur de correction pur (zéro DOM, zéro dépendance). Format UMD : `require()`-able en Node (tests, futurs scripts de calcul) et chargeable en `<script>` classique dans le navigateur (pose `window.FondaCorrection`), cohérent avec le style du front BOX existant (pas de bundler).
- **`correction.test.js`** — suite de tests, écrite **avant** l'implémentation (méthode imposée). `node --test fonda/engine/correction.test.js` — zéro dépendance (test runner natif Node ≥ 18).
- **`carte-reponse-produite.js`** — composant vanilla JS (saisie courte → validation → feedback). Charge `window.FondaCorrection`, donc à inclure **après** `correction.js` dans la page. **Développé isolé, non branché à `index.html`** (impact prod nul) — le câblage dans la page existante est T4 ("Mode Box-FONDA"), pas ce ticket.

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

compteCommeReussite('presque', 'numerique'); // → true  (compte juste, PRD §5.1)
compteCommeReussite('presque', 'orthographe'); // → false (compte faux, c'était la cible)
```

## Deux champs ajoutés au schéma de carte, non détaillés par le PRD — **à valider avec Éric**

Le PRD §5.1 mentionne les règles (« unité exigée seulement si la carte le précise », « arrondi toléré uniquement si la carte le mentionne ») mais ne fixe pas le nom des champs qui les portent. Proposition retenue ici, à confirmer :

| Champ | Portée | Défaut | Rôle |
|---|---|---|---|
| `unite` | profil `numerique` | `null` | Si renseigné (ex. `"cm"`), l'unité est exigée dans la réponse ; sinon toute unité fournie est ignorée. |
| `arrondi` | profil `numerique` | `null` | Tolérance absolue autour de la valeur attendue (ex. `0.1`). Sans cette carte, comparaison décimale exacte (hors epsilon flottant `1e-9`). |

Si ces noms ne conviennent pas (ou si le PRD doit être mis à jour en conséquence), c'est un changement localisé à `correction.js` + `correction.test.js`.

## Règle « presque » implémentée

- **sens** et **exact** : jamais de « presque » — en sens, tout ce qui compte est déjà pardonné (accents, pluriel, ponctuation, casse) ; en exact, tout est strict sauf les espaces. Un écart est donc directement « faux ». Conforme à « Levenshtein off par défaut » : aucune tolérance à la faute de frappe n'est ajoutée.
- **orthographe** : « presque » = la réponse matche seulement si on pardonne en plus accents et singulier/pluriel (niveau « sens ») — exactement le cas « attention à l'accent » du PRD.
- **numerique** : « presque » = valeur numérique correcte mais unité manquante/fausse alors qu'elle est exigée par la carte.

## Ce qui n'est PAS testé par ce ticket

`carte-reponse-produite.js` manipule le DOM : non exécutable par le test runner Node natif sans dépendance supplémentaire (jsdom), qu'on n'a pas voulu ajouter (zéro dépendance). La logique qu'il appelle (`evaluerReponse`, `compteCommeReussite`) est, elle, intégralement couverte par `correction.test.js`. Une vérification visuelle/manuelle du composant se fera au câblage réel (T4).
