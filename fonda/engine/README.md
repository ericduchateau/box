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

Si l'une des `reponses_acceptees` est elle-même incohérente, le moteur renvoie `carte_invalide` — **jamais `juste`**, quelle que soit la réponse de l'élève. Deux cas détectés :
- la valeur ne parse à rien de fini **et** l'entrée contient un `/` : fraction manifestement ratée — **dénominateur nul** (`"1/0"`), ou **forme non reconnue** (`"/3"`, rien avant le `/`). Un nombre non fini **sans** `/` (notation hors de portée d'un flottant 64 bits) reste couvert par le garde-fou existant (→ `faux` global), ce n'est pas une incohérence de forme de l'attendu ;
- sinon, le reliquat ne respecte pas la **grammaire d'une unité plausible** : un ou plusieurs « tokens » de lettres/symboles d'unité (`°`, `%`, `µ`, `Ω`), chacun pouvant porter un exposant (chiffres, éventuellement précédés de `-`), enchaînables via `/` **ou** point médian `·` pour une **unité composée légitime** (`m/s`, `km/h`, `kg·m²/s²`, `m²·s⁻¹` — `·` est un joineur entre deux tokens, pas un caractère interne : un exposant peut donc porter sur un facteur du milieu, pas seulement sur le dernier). Un reliquat qui ne correspond pas à cette forme — vide avant un `/` (`"1/"`, `"/3"`), commence par un chiffre/point (`".5 cm2"`, résidu d'une fraction décimale tronquée `"1/2,5"`), ou contient un `/` mal placé (`"0,5/1,5"`, `"1/2/"`) — est un **résidu numérique malformé, jamais une unité**, quels que soient les chiffres ou lettres qu'il contient par ailleurs. Si le reliquat RESPECTE cette grammaire mais **contredit l'unité déclarée par la carte** (ex. attendu `"8 kg"` alors que `unite:"cm"`), c'est également `carte_invalide` — une unité composée légitime (`m/s`, `m²·s⁻¹`) n'est en revanche jamais signalée à tort.

Ces deux cas ne valent que pour l'**attendu** (`reponses_acceptees`) — une carte malformée se signale, elle ne doit jamais être validée malgré elle. La **même forme de fraction malformée tapée par l'élève** (`"1/"`, `"1/2/"`, `"/3"`, `"1/0"`, `"1/2,5"`) reste simplement `faux` (jamais `juste`) : la carte, elle, est correcte — ce n'est qu'une saisie élève invalide, pas un problème à remonter en relecture.

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

---

# `evenements.js` — émission d'événements de mesure (T3)

Référence : [`docs/PRD-Box-FONDA.md`](../../docs/PRD-Box-FONDA.md) §3.2, §5.1, §6 ; `AGENTS.md` G2/G3. Construit, verrouille et met **localement** en file les événements de mesure pour `onResultat({ scored: true })` de T2 — **aucun appel réseau** (la collecte n8n est T5). `node --test fonda/engine/evenements.test.js` (33 tests). Révisé une fois suite critique Codex ciblée anonymat/verrou/seconde chance (lecture seule) — voir `AVANCEMENT.md` pour le détail.

## Pourquoi un module séparé de `correction.js`

`correction.js`/`carte-reponse-produite.js` ne connaissent ni `grp`, ni `notion_id`, ni le contexte de session (cf. leur doc) — c'est volontaire, pour rester réutilisables hors Box-FONDA. `evenements.js` est la couche qui ajoute ce contexte et transforme un résultat de carte en événement de mesure anonyme.

## API

```js
const { soumettreTentative } = require('./evenements.js');

soumettreTentative({
  defiId, itemId, setId, notionId, palier, ctx,  // contexte du défi, FOURNI par l'appelant (T4) — jamais deviné
  reussite, scored,                               // issus de onResultat() de T2
  classesAutorisees,                              // contenu de fonda/data/classes.json
  notionIdsConnus,                                // optionnel : ids de fonda/data/referentiel.json, pour une vraie vérification
  stockage,                                        // ex. window.localStorage — INJECTÉ, jamais lu en dur
  maintenant,                                      // () => new Date() — injecté, pour la testabilité
});
// → { emis: true, event } | { emis: false, raison: string }
```

`event` contient **exactement** les 11 champs du schéma §3.2 (`ts, grp, defi_id, notion_id, palier, set_id, item_id, result, ctx, rang_local, dt_jours`), reconstruit champ par champ (jamais par copie de l'entrée — un paramètre étranger passé par erreur, ex. un nom d'élève, ne peut donc jamais fuiter) puis revalidé par `validerEvenement()` de T1 (liste blanche stricte) avant toute mise en file. En cas d'échec, `raison` est un **code générique** — jamais le détail de la valeur fautive (un message d'erreur n'est pas un canal d'évasion pour une donnée qu'on vient de refuser).

## `grp` : exclusivement lu depuis `defi_id` (G2/G3)

`defi_id` a la forme `defi_{annee}-w{semaine}_{grp 3 chiffres}_{notion-slug}` (ex. `defi_2026-w41_601_fractions`) ; `grp` en est **extrait**, jamais saisi par l'élève ni déduit d'un nom/login/IP/historique. Deux échecs distincts :
- `defi_id` ne respecte pas le format (grp absent ou pas 3 chiffres) → `raison: 'defi_id_invalide'` — « pas d'occurrence fabriquée depuis `rang_local` ».
- `defi_id` bien formé mais le grp extrait n'est pas dans `classes.json` (ex. roster désynchronisé) → `raison: 'grp_non_autorise'`.

Dans les deux cas : **mode entraînement, aucune émission** — l'élève révise, rien n'est mesuré.

Ce module **fait confiance** à ce qu'on lui injecte pour `classesAutorisees` (comme pour `stockage`) : il ne relit jamais `fonda/data/classes.json` lui-même. Si l'appelant (T4) y passe une liste qui diverge du vrai fichier, le contrôle reste cohérent avec la liste reçue — ce n'est pas une faille de ce module, c'est un contrat d'intégration à respecter en T4 (voir « Dette documentée » dans `AVANCEMENT.md`).

## `itemId`/`setId`/`notionId` : garde-fou de NATURE, pas de format métier — provenance par champ

Ces trois champs doivent être des identifiants techniques plausibles — chaîne non vide, ≤ 64 caractères, uniquement `[A-Za-z0-9._-]` (ni espace, ni texte libre) — sinon `raison: 'identifiant_invalide'`. Ce contrôle empêche qu'un nom, une phrase ou un commentaire se glisse dans un champ autorisé **par erreur d'appel** ; il ne vérifie PAS que l'id existe réellement dans un référentiel ou un jeu de cartes. Son niveau de protection réelle diffère selon le champ :

- **`notion_id`** : gouverné en amont par `fonda/data/referentiel.json`, verrouillé par le pattern `^(fr|maths)\.[a-z0-9-]+$` de T1 (11 entrées fixes, curées). Si l'appelant source bien `notion_id` depuis le vrai référentiel, la valeur ne peut être que l'une des 11 connues — le garde-fou de nature n'est ici qu'un filet de sécurité. `notionIdsConnus` permet en plus une vérification *sémantique* réelle (optionnelle).
- **`item_id` / `set_id` : garantie d'anonymat déléguée à T6.** Ces ids sont choisis par le système au service du défi, jamais saisis par l'élève. Le garde-fou de nature (charset, ≤ 64) empêche le texte libre/espaces mais ne distingue pas un nom sans espace (ex. `jean-dupont`, syntaxiquement indiscernable d'un id technique kebab-case légitime). **La garantie définitive dépend de la règle de génération de T6** — aucune règle de génération n'existe encore dans ce repo (le PRD §3.6 nomme `card_id` côté relecture, §3.2 nomme `item_id`/`set_id` côté événement, sans jamais relier les deux) ; T1 ne contraint que `notion_id`. Voir la dette documentée, taguée, dans `AVANCEMENT.md`.

## Verrou, historique et file : un seul blob, une seule écriture

| Donnée | Clé dans le blob | Portée | Pourquoi |
|---|---|---|---|
| Verrou (un vote) | `verrous["${JSON.stringify([defi_id, item_id])}"]` | Par **occurrence** (le `defi_id` change à chaque semaine) | Une 2ᵉ soumission du même item dans la même occurrence (rechargement, double-clic, 2 onglets) ne crée jamais de 2ᵉ événement. Un nouveau vote redevient possible à l'occurrence suivante (nouveau `defi_id`). |
| Historique (pour `rang_local`/`dt_jours`) | `historique["${JSON.stringify([set_id, item_id])}"]` → `[{ts, defi_id}, ...]` | Par **item**, à travers les occurrences | Doit survivre au changement de `defi_id` pour que `rang_local` s'incrémente d'une occurrence à l'autre. Résout l'ambiguïté « `item_id` unique seulement à l'intérieur d'un jeu » (critique de cadrage) en élargissant la clé à `(set_id, item_id)`. |
| File d'émission (T5 la videra) | `file` → `[event, ...]` | — | Chaque événement y est gelé (`Object.freeze`) : un réessai d'émission futur (T5) réutilisera le même objet, n'en recréera jamais un second. |

Les trois cohabitent dans **un seul document JSON**, sous **une seule clé localStorage** (`fonda_evt_mesure`), écrit en **un seul `setItem()`**. Choix délibéré après critique Codex : trois clés séparées peuvent se désynchroniser si l'une des trois écritures échoue en cours de route (ex. verrou posé, mais l'écriture de la file lève une exception quota → mesure perdue silencieusement, sans que rien ne le signale). Un seul document, une seule écriture, élimine structurellement ce risque — pas de scénario où le verrou existe sans l'événement correspondant en file.

Les clés composites (`(defi_id, item_id)`, `(set_id, item_id)`) utilisent `JSON.stringify([a, b])`, jamais une concaténation `a + '::' + b` : cette dernière peut faire collisionner deux couples distincts si l'un des id contient lui-même le séparateur.

Vérification PUIS écriture dans le **même bloc synchrone** (pas d'attente entre les deux) : correct pour un double-clic, un double callback ou un rechargement **dans le même onglet** (JS y est mono-thread, rien ne peut s'intercaler). Entre deux onglets réellement distincts (processus séparés), `localStorage` n'offre aucune primitive de comparaison-et-échange atomique — une course très rare reste possible en théorie. **Limite documentée, pas corrigée** (cf. « Limites connues » ci-dessous) : la Web Locks API y remédierait, mais demanderait de rendre asynchrone tout le chemin d'appel depuis `carte-reponse-produite.js` (T2), hors scope T3.

## Seconde chance : aucune trace

`scored !== true` → `raison: 'non_score'`, et **aucune écriture** (ni verrou, ni historique, ni file — le blob `fonda_evt_mesure` n'est même pas lu) : une relance après un « presque » ne doit laisser aucune trace mesurable, conforme à T2 (seule la 1ʳᵉ tentative est scorée).

## `ts` : tronqué à l'heure pleine

`ts` est toujours tronqué (pas arrondi au plus proche : toujours vers le bas) aux minutes/secondes à `00`, en UTC — anti-réidentification par recoupement horaire fin (grp minuscule + horaire précis + item = risque de ré-identification indirecte, relevé par la critique de cadrage). `dt_jours` est calculé en jours entiers écoulés depuis le dernier passage connu de l'historique, **jamais négatif ni `NaN`** : une horloge reculée ou une date future est bornée à `dt_jours: 0` plutôt que rejetée (l'événement reste légitime, seule la mesure de délai est dégradée).

**Cette troncature est appliquée uniquement par `soumettreTentative` (construction), PAS par `validerEvenement()` de T1** (le validateur partagé) : c'est délibéré, pas un oubli. `validerEvenement()` sert aussi à valider `fonda/fixtures/events.sample.json`, dont les horodatages synthétiques ont des minutes arbitraires (`08:12:00`, pas `08:00:00`) — lui imposer la troncature casserait la validation de cette fixture (T1). Un `ts` à la minute/seconde près reste donc *schématiquement* valide pour le validateur générique ; seule la construction T3 garantit la troncature. Verrouillé par un test : voir `evenements.test.js`.

## Robustesse

- **Stockage indisponible, saturé, bloqué, ou JSON syntaxiquement invalide** (`getItem`/`setItem` qui lèvent) → aucune émission, aucune exception (`raison: 'stockage_indisponible'`).
- **Blob de forme incorrecte** (JSON valide mais `verrous`/`historique` pas un objet, `file` pas un tableau — ex. un ancien format, une corruption partielle) → `raison: 'stockage_corrompu'`, **jamais** silencieusement réinitialisé à une table vide (ce qui rouvrirait un vote déjà scellé).
- **Contexte incomplet** (`itemId`/`setId`/`notionId`/`palier` manquants) → aucune émission : ce module ne fabrique jamais un contexte, il le reçoit de l'appelant (T4).
- **`ctx` invalide** (hors `df`/`maison`/`classe`) → aucune émission.
- **Horloge injectée invalide** (`maintenant` absente, non-fonction, ou renvoyant une date invalide) → aucune émission, jamais d'exception.

## Limites connues (hors périmètre ce ticket — signalées, pas corrigées)

- **`item_id`/`set_id` sans garantie de génération amont, `defi_id`/`notion_id` dépendants de T4** : voir « provenance par champ » ci-dessus. Dette documentée et taguée dans `AVANCEMENT.md` (section T6, section T4) — à vérifier explicitement à la revue de ces tickets.
- **Course entre deux onglets réellement distincts** (processus séparés, écriture quasi simultanée) : voir « Verrou » ci-dessus — limite théorique de `localStorage` sans Web Locks API, non traitée pour rester synchrone avec T2.
- **`validerEvenement()` suppose un objet ordinaire** (propriétés énumérables propres reflétant sa vraie forme) : un objet construit de façon adversariale (ex. un `toJSON` hérité ajoutant un champ) pourrait en théorie contourner la liste blanche. `soumettreTentative` ne construit jamais un tel objet (toujours un littéral `{...}` neuf) — ce n'est un risque que pour un appelant externe qui invoquerait `validerEvenement()` directement sur un objet forgé, hors du chemin normal de ce module.
- **Élève utilisant un appareil partagé/prêté** : l'historique et le verrou décrivent l'usage du navigateur, pas celui d'un individu — assumé par le PRD (G2, pas de compte élève).
- **Pas de vérification réseau/collecte ici** : T3 construit et stocke, `emission.js` (T5) vide la file vers le webhook de collecte. Un événement en file peut rester local indéfiniment si `emission.js` n'est jamais appelé ou si `webhookUrl` n'est jamais câblée.

---

# `liens.js` — liens par classe + résolution de défi (T4)

Référence : [`docs/PRD-Box-FONDA.md`](../../docs/PRD-Box-FONDA.md) §3.3, §4, §6 ; `AGENTS.md` G1/G7. Logique pure (zéro DOM, zéro fetch) : génère, pour un défi « notion × niveau » programmé dans `calendar.json`, un lien par classe du niveau — et, à l'inverse, résout le contexte complet d'un `defi_id` ouvert par un élève. `node --test fonda/engine/liens.test.js` (18 tests).

## Un seul format de `defi_id`, une seule regex — jamais deux qui pourraient diverger

`evenements.js::DEFI_ID_PATTERN` (T3) a été étendu (purement additif, 131 tests T1-T3 revérifiés inchangés) pour capturer les 4 segments (`année`, `semaine`, `grp`, `notionSlug`) via `parserDefiId()`, pas seulement le `grp`. `liens.js` réutilise cette MÊME fonction pour générer (`genererDefiId`) et pour résoudre (`resoudreContexteDefi`) — la génération et la résolution ne peuvent donc jamais diverger sur le format, puisqu'elles partagent le même code.

## Génération (page niveau) vs résolution (lien élève)

```js
const { genererLiensNiveau, resoudreContexteDefi } = require('./liens.js');

// Page niveau : décline un lien par classe du niveau, pour chaque entrée programmée
genererLiensNiveau({ niveau: '6e', annee: '2026', semaine: '41', entreesNiveau, classesAutorisees });
// → [{ grp: '601', notionId, palier, setId, defiId }, { grp: '602', ... }, ...]

// Lien élève : grp HÉRITÉ du defi_id, jamais redemandé
resoudreContexteDefi({ defiId, calendrier, classesAutorisees });
// → { valide: true, grp, notionId, palier, setId } | { valide: false }
```

`resoudreContexteDefi` ne retourne `valide: true` que si **tout** correspond à une entrée réelle de `calendar.json` : grp dans `classes.json`, semaine présente dans le calendrier, et une entrée de ce niveau dont le slug de `notion_id` correspond exactement à celui du `defi_id`. Tout le reste (`defi_id` malformé, semaine expirée/absente, faute de frappe dans le slug, grp hors roster, calendrier vide) → `valide: false`, sans exception — c'est le signal pour la page de basculer en mode entraînement.

## `fonda/page/bootstrap.js` — la couche DOM (non testée en Node, smoke-test requis)

Chargé **uniquement** quand `?fonda=1` (injection dynamique depuis `js/app.js::initFonda()`, jamais de `<script>` statique — zéro requête en plus flag OFF, vérifié par `fonda/page/non-regression.test.js`). Fait le fetch des 3 JSON (`classes`, `referentiel`, `calendar`) et le rendu DOM pour deux vues :
- **Page niveau** (`?fonda=1&page=niveau&niveau=6e[&semaine=2026-w41]`) : liste, par classe du niveau, le lien du défi de la semaine + un bouton **Copier** (pas de QR en T4, voir dette ci-dessous).
- **Lien élève** (`?fonda=1&defi=...`) : résout le contexte via `liens.js`. Si invalide → message d'entraînement (testé : `fonda/page/bootstrap.test.js`, 9 cas incluant defi expiré/malformé/hors roster/calendrier vide — jamais d'exception, jamais de page blanche). Si valide → `lancerDefi(contexte)`, le point de branchement vers T2/T3 (voir dette T6 ci-dessous).

Ce fichier fait du DOM/fetch réel : **non couvert par `node --test`** (pas de navigateur ici) au-delà de ce qui est testé via DOM/fetch factices dans `bootstrap.test.js`. Toute la décision (génération, résolution, format) est dans `liens.js`, testée ; `bootstrap.js` ne fait que l'exécuter et afficher. **À smoke-tester manuellement dans un vrai navigateur avant tout usage réel.**

## Limites connues / dettes tracées (T4)

- **🔖 Pas de QR en T4** : uniquement lien + bouton copier sur la page niveau. QR reporté à un ticket ultérieur dédié (décision Éric : pas de lib vendorée sans revue préalable). Voir `AVANCEMENT.md`.
- **🔖 DETTE T6 — contenu réel des cartes** : `lancerDefi(contexte)` (dans `bootstrap.js`) reçoit un contexte résolu et sûr, mais affiche un message « contenu à venir » au lieu de fetcher un vrai jeu : aucune convention `set_id` → Drive n'existe encore (T6). Quand T6 la définira, remplacer ce message par le fetch + `FondaCarteReponseProduite.montrerCarteReponseProduite(...)`, et dans son `onResultat`, appeler `FondaEvenements.soumettreTentative({...contexte, reussite, scored, ...})` — le contexte est déjà le bon.
- **Pas de CSS dédié** : les classes (`fonda-liens-niveau`, `fonda-lien-classe`, `fonda-message`) ne sont pas stylées dans `css/style.css` — rendu fonctionnel mais brut. Hors périmètre des tests fournis.

---

# `emission.js` — vide la file locale vers le webhook de collecte (T5)

Référence : [`docs/PRD-Box-FONDA.md`](../../docs/PRD-Box-FONDA.md) §2, §3.2 ; `AGENTS.md` G2/G3 + règle n8n-production. `node --test fonda/engine/emission.test.js` (11 tests). Le seul composant réseau de Box-FONDA côté navigateur — tout le reste (T1-T4) est lecture seule / stockage local uniquement.

## API

```js
const { viderFileEvenements } = require('./emission.js');

await viderFileEvenements({
  stockage,     // ex. window.localStorage — INJECTÉ, jamais lu en dur (même contrat que evenements.js)
  webhookUrl,   // URL du workflow n8n (voir n8n/fonda-collecte/) ; absent/vide = mode dégradé, rien ne bloque
  envoyer,      // (url, corps) => Promise<boolean> — INJECTÉ : true = succès CONFIRMÉ par le serveur
});
// → { tentes, envoyes, echecs, invalides }
```

`envoyer` abstrait le réseau (comme `stockage` abstrait `localStorage`) : en prod, ce sera un `fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(corps)})` résolu en `response.ok` — câblage non fait dans ce ticket (T5 livre l'émetteur ; le brancher dans `fonda/page/bootstrap.js` avec la vraie URL du webhook une fois activé par Éric est un pas d'intégration ultérieur, comme la dette T6 de `lancerDefi()`).

## Garanties

- **Corps strictement limité aux 11 champs** : reconstruit champ par champ depuis l'événement en file (jamais par spread) — même si l'événement stocké contenait un champ étranger (corruption), il ne peut pas apparaître dans la requête. Revalidé par `validerEvenement()` de T1 juste avant l'envoi (défense en profondeur) ; un événement devenu invalide n'est jamais envoyé mais **ne bloque pas** les suivants (comptabilisé séparément : `invalides`, distinct de `echecs`).
- **Contrôle de FORME, pas seulement de noms de champs** (`evenements.js::formeEvenementPlausible`, ajouté suite critique Codex) : la liste blanche protège les 11 clés, mais ne dit rien sur le *contenu*. Avant envoi, vérifie en plus que `grp` est bien 3 chiffres et cohérent avec le grp encodé dans `defi_id`, que `notion_id` respecte le pattern référentiel, que `set_id`/`item_id` ne contiennent pas de texte libre (ex. une métadonnée glissée comme `"IP=…; device=…"`), et que `ts` est bien tronqué à l'heure — défense contre une file locale altérée (devtools) ou, côté serveur, un appel direct au webhook qui contournerait entièrement `soumettreTentative`. Mêmes règles **dupliquées** dans `n8n/fonda-collecte/box-fonda-events.json` (le Code node ne peut pas `require()` ce fichier) : les deux doivent rester synchronisées si le format `defi_id`/`notion_id` évolue.
- **Retrait de la file UNIQUEMENT sur succès confirmé** (`envoyer` résout à `true`) : un échec réseau, une exception, ou une réponse négative laissent l'événement strictement inchangé en file — le prochain appel renvoie **le même objet** (même `ts`), jamais une reconstruction. Un échec sur un événement n'empêche pas les suivants d'être tentés dans le même passage.
- **Mode dégradé si `webhookUrl` absent** : aucune tentative, aucune exception, la file s'accumule localement — ne bloque jamais la révision de l'élève.
- **Jamais d'exception propagée** (stockage indisponible, JSON corrompu, `envoyer` qui lève) — cohérent avec `evenements.js`.

## Limite documentée : pas d'exactly-once au niveau réseau

Si le serveur reçoit et traite la requête mais que la **réponse** se perd (coupure réseau juste après), le client ne peut pas distinguer ce cas d'un échec réel : l'événement reste en file et sera réémis au prochain passage, ce qui peut produire une **ligne dupliquée côté Sheet** dans ce scénario précis (rare). Ajouter une garantie exactly-once demanderait un jeton d'idempotence consommé côté serveur (n8n) — non demandé par ce ticket, déjà noté comme point ouvert dans l'historique T3 (« Réessai d'émission », `AVANCEMENT.md`). Pas de perte possible dans tous les cas ; une duplication reste possible dans ce seul scénario.

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
