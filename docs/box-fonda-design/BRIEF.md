# Brief d'intégration — page BOX-FONDA (thème sombre + logo + switch)

> Pour **Claude Code** (dépôt BOX). Ce brief **complète** `AGENTS.md` et `docs/PRD-Box-FONDA.md` du dépôt — ils priment en cas de doute. Travail en **lecture seule d'abord**, puis **plan validé**, puis implémentation. **Un chantier = une branche = une PR.**

---

## 1. Objectif

Donner à **BOX-FONDA** son identité visuelle propre et la brancher sur le front existant :

1. **Thème sombre « mode fondamentaux »** — BOX reste clair ; BOX-FONDA passe sur un **fond sombre navy**, pour se distinguer tout en gardant exactement la même interface et les mêmes gestes.
2. **Logo + signature BOX-FONDA** — le logo BOX conservé, surmonté de la signature « À FOND / FONDA ! » (le A sur une mini-carte, écho de la carte-O).
3. **Le « switch »** — un bouton qui fait basculer d'un mode à l'autre (clair BOX ↔ sombre FONDA). Argument-clé auprès des collègues : *rien de neuf à apprendre, juste un switch*.

La carte de révision en mode FONDA doit **ressembler au démonstrateur fourni** (`demo-reference.html`) : carte blanche sur navy, correction immédiate **✓ vert / ✗ rouge**, réponse attendue + réponses acceptées + profil de correction.

---

## 2. Contraintes (rappel AGENTS.md — non négociables)

- **Site statique** (GitHub Pages). Pas de backend ajouté. Les pages lisent des **JSON commités**. Seul le webhook n8n de collecte est dynamique — **ne pas y toucher**.
- **Ne pas casser BOX** (mode clair) ni la compat des anciens liens n8n. BOX et FONDA partagent le même socle de pages.
- **G2 — sans compte élève** : la progression reste locale (navigateur). **G3** : le front n'envoie **aucune donnée élève** à une IA (il n'envoie rien du tout à un modèle).
- **G4 — humain dans la boucle** : le front **n'affiche que des fiches déjà validées** (le flag `revue_carte_par_carte` et le refus côté `box-validate` restent la source de vérité ; ne pas contourner).
- **Développer sur fixtures synthétiques anonymes.** Jamais de données élève réelles.
- **Tests d'abord** sur les zones à risque (le rendu de la correction par profil, §5.1 du PRD). `main` ne bouge pas ; livrer en branche + PR.

---

## 3. Identité visuelle — tokens

```css
:root{
  /* Thème FONDA (sombre) */
  --fonda-navy:   #1D2F4A;  /* fond */
  --fonda-navy-2: #17263B;  /* panneaux / cartes de fond */
  --fonda-ink:    #FDFDFD;  /* texte principal */
  --fonda-mut:    #9BAEC9;  /* texte secondaire */
  --fonda-line:   #31496B;  /* filets */
  /* Accents sémantiques (identiques BOX/FONDA) */
  --fonda-green:  #5BAE6C;  /* bonne réponse / A migrant */
  --fonda-amber:  #E0A43B;  /* intermédiaire 50–75 % */
  --fonda-red:    #C8403A;  /* erreur */
  /* Carte de révision */
  --fonda-card:      #FDFDFD;
  --fonda-card-ink:  #20314A;
}
```

- **Polices** : signature/logo en **Poppins** (800) ; UI en **Inter** (déjà un sans neutre, à charger via Google Fonts ou self-host selon ce que fait déjà le dépôt). Ne pas imposer Inter si BOX utilise déjà un autre sans cohérent — dans ce cas, garder le sans du dépôt pour l'UI et Poppins seulement pour la signature.
- **Contraste / accessibilité** : blanc sur navy OK. **Ne jamais coder l'information par la seule couleur** : la correction garde l'icône **✓ / ✗** + le texte (« Bonne réponse » / « Pas tout à fait »), pas seulement le vert/rouge. Viser WCAG AA.
- **Favicon / icône** : décliner une version carrée (le logo réduit ou le monogramme).

Fichiers fournis (dossier `box-fonda-design/`) :
- `box-logo.png` — le logo BOX d'origine, recadré (fond navy). *Idéalement, utiliser une version fond transparent si elle existe dans le dépôt ; sinon celle-ci sur fond navy.*
- `box-fonda-logo.png` — le **lockup complet** (logo + signature), prêt à poser sur fond navy.
- `lockup-reference.html` — le lockup en **HTML/CSS** (source à reprendre, voir §4).
- `demo-reference.html` — le **démonstrateur** de la carte élève (cible visuelle + logique de correction par profil).
- `demo_fr.png`, `demo_ma.png` — captures de la carte (états correction verte / rouge).
- `calendrier.png` — illustration du calendrier roulant (utile pour un futur tableau de bord).

---

## 4. Logo + signature (code à reprendre)

La signature est **vectorielle (texte + CSS)**, pas une image — elle reste nette à toute taille. Markup + styles (extrait de `lockup-reference.html`) :

```html
<div class="fonda-lockup">
  <img class="logo" src="<chemin du logo BOX>" alt="BOX">
  <div class="fonda-sign">
    <div class="l1"><span class="trav">À</span><span class="fond">FOND</span></div>
    <div class="l2"><span class="fond">FOND</span><span class="card">A</span><span class="bang">!</span></div>
  </div>
</div>
```

```css
.fonda-lockup{display:flex;flex-direction:column;align-items:center}
.fonda-lockup .logo{width:560px;max-width:70vw;display:block}
.fonda-sign{font-family:'Poppins',sans-serif;font-weight:800;line-height:.98;
  display:flex;flex-direction:column;align-items:center;gap:6px;margin-top:26px}
.fonda-sign .l1,.fonda-sign .l2{font-size:84px;display:flex;align-items:center}
.fonda-sign .l1{gap:.16em}.fonda-sign .l2{gap:.02em}
.fonda-sign .fond{color:var(--fonda-ink)}
.fonda-sign .trav{color:var(--fonda-green)}
.fonda-sign .card{display:inline-flex;align-items:center;justify-content:center;
  background:var(--fonda-ink);color:var(--fonda-navy);border-radius:.17em;
  width:.84em;height:.84em;transform:rotate(-5deg);
  box-shadow:0 10px 22px rgba(0,0,0,.4);margin:0 .03em}
.fonda-sign .bang{color:var(--fonda-green);margin-left:.08em}
```

Pour l'**en-tête de l'appli** (petit format), une version compacte du wordmark « BOX » + « FOND[carte A] ! » suffit (voir l'en-tête de `demo-reference.html`). Prévoir : lockup complet (accueil), wordmark compact (barre d'appli), monogramme (favicon).

---

## 5. Le « switch » (comportement)

- Un **toggle** visible (barre d'appli) : **BOX (clair)** ↔ **Fondamentaux (sombre)**.
- Il applique le **thème** (variables ci-dessus — p. ex. via `data-theme="fonda"` sur `<html>`), **le logo** correspondant, et **l'entrée** correspondante : côté BOX, le catalogue / `?set=…` habituel ; côté FONDA, l'expérience fondamentaux (défis du calendrier roulant, cf. PRD).
- **Persister le choix** en `localStorage` (par navigateur, cf. G2), avec repli propre si indisponible (try/catch). Respecter `prefers-reduced-motion` pour l'éventuelle transition.
- Le switch **ne recharge pas** une appli différente : mêmes pages, mêmes gestes — c'est tout l'argument. Documenter où il s'insère dans le routage existant.

---

## 6. Carte de révision en mode FONDA

Cible = `demo-reference.html`. Points à respecter :
- Carte **blanche sur navy**, question lisible, champ de réponse + « Valider ».
- **Correction immédiate** : bandeau **vert ✓ « Bonne réponse »** ou **rouge ✗ « Pas tout à fait »**, puis **réponse attendue**, **réponses acceptées**, et le **profil de correction** (sens / numérique / exact / orthographe).
- La **logique de correction par carte existe déjà** dans les données FONDA (`profil_correction`, `reponses_acceptees`, `unite`, `palier`, cf. T6b/PRD §5.1) — le front **applique** ce profil, il ne réinvente pas les règles. **Levenshtein off par défaut** ; en profil `orthographe`, **ne pas** normaliser accents/pluriels (c'est la cible de la mesure).
- Rappel discret **« Fiche relue et validée par … avant publication »** (renforce G4).

---

## 7. Definition of done

1. Mode FONDA (sombre) fonctionnel ; **BOX (clair) inchangé** (captures avant/après des deux modes).
2. **Switch** opérationnel, choix persisté, logo qui suit le mode.
3. Carte de révision FONDA conforme au démonstrateur (✓/✗, profils).
4. **Accessibilité** : contrastes AA vérifiés ; information jamais portée par la seule couleur.
5. **Aucune régression** : tests verts ; anciens liens n8n intacts ; aucun secret commité ; aucune donnée élève réelle dans la boucle.
6. `AVANCEMENT.md` tenu à jour (objectif · fait · en cours · prochaine étape · pièges).
7. **PR** avec captures et résumé.

## 8. Relecture Codex (avant merge)

Session **fraîche, lecture seule** : « trouve tous les angles morts » — en particulier **contraste/accessibilité du thème sombre**, cohérence des tokens, et non-régression de BOX clair.
