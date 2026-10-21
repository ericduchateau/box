#!/usr/bin/env node
// Génération réelle de candidates Box-FONDA via l'API Claude (dette T6b).
// Référence : docs/PRD-Box-FONDA.md §9 (Moteur B), §11 (modèle + spec de clarté),
// §12 (routage) ; AVANCEMENT.md section T6a (🔖 DETTE T6b) ; fonda/data/README.md.
//
// CE QUE CE SCRIPT EST : l'appel réseau réel (Sonnet) + le même garde-fou G4 que le
// pilote T6a (fonda/engine/generation.js, réutilisé TEL QUEL — zéro duplication de
// la logique de dépôt) + une VÉRIFICATION ZÉRO TOLÉRANCE de chaque carte contre le
// vrai correcteur (fonda/engine/correction.js) avant toute sortie. Une carte qui ne
// repasse pas le correcteur est d'abord soumise à autoCorrigerCarte() (2026-10-11) :
// AUCUN contenu n'est inventé, elle est seulement testée avec chacune des formes
// déjà déclarées dans sa propre reponses_acceptees à la place de reponse — si une
// seule fait passer le correcteur, c'est elle qui est retenue (log "✎ auto-corrigée").
// Si aucune ne passe, la carte reste REJETÉE comme avant, jamais corrigée à la main,
// jamais marquée `_fixture_note` (ça, c'était le fixture technique T6a — ici c'est du
// contenu réel destiné à la relecture, tolérance zéro).
//
// CE QUE CE SCRIPT N'EST PAS : pas un appel n8n (zéro action n8n, AGENTS.md), pas
// une publication (statut toujours "attente", rien n'est envoyé par email ni
// déposé sur Drive ICI — ça, c'est le rôle du futur workflow n8n `box-fonda-generation`,
// qui prendra en entrée les fichiers produits par ce script). Pas le Moteur B auto
// sur ⬛ (§9, Lot 2) : déclenchement strictement manuel, un ou plusieurs notion_id
// donnés en argument.
//
// Clé API : lue depuis la variable d'environnement ANTHROPIC_API_KEY — JAMAIS en
// dur dans ce fichier, jamais committée. Absente -> le script s'arrête avant tout
// appel réseau avec un message clair (voir appellerModeleClaude).
//
// Usage — RÉSERVATION EN DEUX TEMPS (journal des identifiants, CDC §6) :
//   1. Réserver (aucun appel réseau) : ajoute au journal LOCAL une ligne « reserve »
//      par palier, avec une ref unique ; puis commit + PR vers design.
//        node fonda/scripts/generer-lot-fonda.js --reserver <notion_id> [<notion_id> ...] [--palier nI|nF]
//   2. Après fusion sur design (git fetch) : générer le candidat d'UN set_id réservé.
//      Le journal lu est celui de origin/design (autorité) ; la ligne « reserve » de
//      ce set_id doit porter EXACTEMENT la ref donnée, sinon arrêt avant tout appel.
//        ANTHROPIC_API_KEY=sk-ant-... node fonda/scripts/generer-lot-fonda.js --set-id=<set_id> --ref=<ref> [--n=6]
//   Tout fichier illisible (journal, lots, catalogue) -> ARRÊT. Séquence 99 atteinte
//   -> ARRÊT explicite, jamais de recyclage.
//
// Notions EXCLUES par construction (voir NOTIONS_EXCLUES_FIGURES ci-dessous) : le
// script refuse de les traiter même si leur notion_id est passé en argument — pas
// une consigne de prompt, un refus avant tout appel réseau.
//
// Sortie : un fichier CANDIDAT par (notion_id, palier), au format lot-fonda/v1
// (fonda/engine/catalogue.js : liste blanche, aucun secret ni coordonnée), nommé
// <set_id>.json dans fonda/data/lots-fonda-calibration/ (dossier de travail, jamais
// lu par l'app). set_id = celui RÉSERVÉ au journal (séquence suivante calculée à la
// réservation sur le journal ET les fichiers existants ; jamais d'écrasement). Il ne
// devient publié qu'après relecture humaine puis fonda/scripts/publier-lot.js
// (chaîne FONDA séparée de BOX, PRD §2 bis). Rien n'est écrit tant qu'un seul rejet (correcteur ou G4) subsiste
// pour CE (notion_id, palier) — même politique stricte que generer-pilote-t6.js.

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const {
  genererSetId,
  genererItemId,
  relecteurDepuisMatiere,
  validerCandidate,
  validerJeu,
  deposerEnRelecture,
} = require('../engine/generation.js');

// Garde-fous du correcteur = outils du MOTEUR élève (CDC relecture §4.2, §4.3) : la
// dernière version enregistrée dans moteurs.json, celle sous laquelle les nouveaux
// lots seront relus et corrigés — le code exact que l'élève exécutera.
const { dernierMoteur, chargerMoteurNode } = require('./moteurs.js');
const MOTEUR_GENERATION = dernierMoteur();
const MOTEUR = chargerMoteurNode(MOTEUR_GENERATION.version, MOTEUR_GENERATION.sha256);
const OUTILS_MOTEUR = MOTEUR.outils;
const { SCHEMA_LOT, validerLot: validerLotFonda, prochainSetId, decomposerSetId, slugDeNotion } = require('../engine/catalogue.js');
const Journal = require('../engine/journal-set-ids.js');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REFERENTIEL_PATH = path.join(ROOT, 'data', 'referentiel.json');
const LOTS_PUBLIES_DIR = path.join(ROOT, 'data', 'lots');
const CATALOGUE_PATH = path.join(ROOT, 'data', 'catalogue-fonda.json');
const SORTIE_DIR = path.join(ROOT, 'data', 'lots-fonda-calibration');
const JOURNAL_PATH = path.join(ROOT, 'data', 'set_ids-journal.json');
const JOURNAL_GIT = 'fonda/data/set_ids-journal.json';
const REF_DESIGN = 'origin/design';

const SOURCE_FONDA_SEED = 'T6b-seed';

// Sonnet fort (G5 : jamais Haiku pour Box-FONDA). Identifiant donné le 2026-10-10 —
// c'est l'identifiant exact du modèle qui exécute cette session (information de
// premier rang, pas une recherche web), PAS le même que 'claude-sonnet-5-5' (rejeté
// par Éric comme invalide lors du réglage précédent). Vérifier qu'il répond
// toujours au moment de l'appel réel ; ces identifiants peuvent changer.
const MODELE = 'claude-sonnet-5';

// 8192 (pas 4096) : laisse de la marge entre le budget de "réflexion" interne du
// modèle et le JSON final. Trouvé en calibration réelle (2026-10-10,
// maths.nombres-fractions-relatifs/nI) : avec 4096, le modèle a parfois épuisé
// tout son budget dans le bloc "thinking" sans jamais produire de bloc "text"
// (stop_reason: "max_tokens", 0 carte) — voir la gestion dédiée dans
// genererLotPourNotionPalier ci-dessous.
const MAX_TOKENS_REPONSE = 8192;

// Notions qui NE PEUVENT PAS être évaluées en texte seul (figures/schémas/cartes
// indispensables à l'item lui-même, pas juste au style de l'énoncé). Vérifié au
// chargement du référentiel, AVANT tout appel réseau — un notion_id de cette liste
// passé en argument est refusé, quelle que soit la consigne du prompt (point 4,
// demande d'Éric : l'exclusion ne doit pas dépendre du bon comportement du modèle).
const NOTIONS_EXCLUES_FIGURES = new Set([
  'maths.geometrie', // items intrinsèquement géométriques (aires/périmètres de figures) — nécessitent de voir la figure, pas seulement de lire un énoncé.
]);

function estNotionExclue(notionId) {
  return NOTIONS_EXCLUES_FIGURES.has(notionId);
}

const LABEL_MATIERE = { 'français': 'Français', 'maths': 'Mathématiques' };
const LABEL_PALIER = { nI: 'Initial (accessible)', nF: 'Final (abouti)' };

// ---------------------------------------------------------------------------
// 1. Le prompt — règles §11 + ratés du pilote T6a + périmètre. Montré à Éric
//    avant tout usage réel (ticket T6b, étape 1). Pas de texte caché ailleurs :
//    ce qui est envoyé au modèle est EXACTEMENT ce qui suit.
// ---------------------------------------------------------------------------
function construirePrompt({ notion, palier, nCartes, contextesDejaUtilises, contextesAutresPaliers = [] }) {
  const paliers = {
    nI: 'nI (Initial) : application DIRECTE de la notion — un seul geste, la règle ou la formule s\'applique sans détour sur les données telles qu\'elles sont données. Reste exigeant (jamais trivial), mais sans transfert ni étape cachée.',
    nF: 'nF (Final) : TRANSFERT RÉEL ou PLUSIEURS ÉTAPES — JAMAIS une simple application directe comme en nI. La carte doit exiger soit de combiner deux idées, soit de repérer une structure cachée, soit un contexte inhabituel qui empêche le réflexe mécanique. RÈGLE DE CONTRÔLE OBLIGATOIRE : si une carte nF se résout par exactement le même geste qu\'une carte nI, elle est mal calibrée — reformule-la avant de la proposer. Exemple de contraste (illustratif, pas un contenu à copier) : nI applique la règle directement sur la donnée fournie ; nF demande d\'abord de déduire une information intermédiaire, ou de reconnaître que la notion s\'applique dans une situation déguisée (vocabulaire différent, donnée superflue, contexte inhabituel) avant de pouvoir appliquer la règle.',
  };

  const contextesInterdits = [...contextesDejaUtilises, ...contextesAutresPaliers];
  const exclusionContextes = contextesInterdits.length > 0
    ? `Contextes déjà utilisés pour cette notion (dans ce lot ET dans l'autre palier nI/nF), à NE PAS réutiliser et à ne pas reformuler à peine différemment : ${contextesInterdits.join(', ')}.`
    : 'Aucun contexte déjà utilisé pour cette notion (première génération, aucun palier précédent).';

  return `Tu es un concepteur de fiches d'évaluation des savoirs fondamentaux pour des élèves de collège français (dispositif Box-FONDA, savoirs fondamentaux transversaux — indépendant du niveau de classe précis).

NOTION CIBLÉE
- Identifiant : ${notion.id}
- Intitulé : ${notion.libelle}
- Micro-compétence évaluée : ${notion.micro_competence}
- Exemple de type d'énoncé déjà rencontré dans les évaluations nationales (AMORCE D'INSPIRATION — ne jamais copier ni paraphraser à peine, juste pour calibrer le niveau de difficulté réel) : ${notion.enonce_modele.join(' / ')}

PALIER DEMANDÉ POUR CETTE GÉNÉRATION : ${palier} — ${paliers[palier]}
Toutes les cartes demandées ici doivent être de ce palier, pas l'autre.

NOMBRE DE CARTES DEMANDÉ : ${nCartes}

RÈGLES NON NÉGOCIABLES (une carte qui enfreint une seule de ces règles est inutilisable, elle sera rejetée automatiquement avant toute relecture humaine) :

1. RÉPONSE TRÈS COURTE OBLIGATOIRE — un mot, un nombre, ou une lettre de QCM. JAMAIS une phrase. Si tu sens que ta réponse dépasse 3-4 mots, c'est que la question est mal calibrée : reformule-la pour qu'elle appelle une réponse courte.

2. ÉNONCÉ DÉTERMINÉ — la question doit avoir UNE SEULE réponse correcte possible, sans ambiguïté d'interprétation. Si un énoncé pourrait raisonnablement admettre deux réponses différentes selon le contexte, il est invalide.

3. PAS DE CLONE — chaque carte doit avoir un contexte concret différent des autres cartes de CE lot (changement de situation, de nombres, de personnages, de domaine). ${exclusionContextes} N'utilise jamais deux fois la même structure de phrase avec juste un nombre ou un nom changé.

4. DISTRIBUTION DES RÉPONSES (si la carte prend la forme d'un choix A/B/C) — répartis la position de la bonne réponse entre A, B et C sur l'ensemble du lot, jamais toujours la même lettre. ANTI-BIAIS DE POSITION : la lettre de la bonne réponse ne doit JAMAIS être déductible de l'énoncé. En particulier, si la consigne/l'énoncé cite un repère ordinal ("la question 2", "le 3e", "ligne B"...), la bonne réponse ne doit PAS se trouver à la position correspondante (ex. "question 2" → la bonne réponse ne doit pas être l'option B) — mélange l'ordre des options en conséquence.

5. UNITÉ OBLIGATOIRE ET UNIQUE — si la réponse est un nombre qui représente une grandeur physique ou monétaire (longueur, aire, volume, masse, durée, somme d'argent, vitesse...), la réponse DOIT porter son unité explicitement (ex. "40 m²", "9 €", pas juste "40" ou "9"), ET tu dois déclarer cette unité séparément dans le champ "unite" du JSON de sortie (ex. "m²", "€"). Une carte avec une grandeur physique/monétaire SANS le champ "unite" rempli sera automatiquement rejetée. DE PLUS, dans "reponses_acceptees", TOUTES les formes doivent être dans CETTE MÊME unité — jamais une unité différente, même équivalente. Autorisé : la même valeur avec et sans unité (ex. ["400 km", "400"]). INTERDIT : une forme dans une autre unité (ex. ["0,6 L", "600 mL"] ou ["12 min", "12 minutes"] si "minutes" diffère de l'unité déclarée "min") — une seule unité par carte, exactement celle du champ "unite". Une carte qui mélange les unités dans "reponses_acceptees" sera automatiquement rejetée.

6. LA DIFFICULTÉ PORTE SUR LA NOTION, JAMAIS SUR LA CONSIGNE — vocabulaire accessible à un collégien, pas de double négation, pas de tournure piège, pas de charge de lecture inutile (énoncé bref, contexte minimal). Si l'élève échoue, ça doit être parce qu'il ne maîtrise pas la notion — jamais parce qu'il n'a pas compris ce qu'on lui demandait.

7. PÉRIMÈTRE — AUCUNE carte ne doit faire référence à une figure, un graphique, un schéma ou une image ("regarde le graphique ci-dessous", "sur la figure...") : cette application ne peut afficher aucune image, seulement du texte. Un TABLEAU DE DONNÉES EN TEXTE (ex. "lundi 12°C, mardi 15°C, mercredi 9°C") est en revanche tout à fait acceptable — décris les données en mots ou en texte tabulaire simple, jamais en référence à un visuel qui n'existe pas.

8. LA CARTE DOIT RÉELLEMENT MOBILISER LA MICRO-COMPÉTENCE VISÉE, PAS LA CONTOURNER — ne donne jamais dans l'énoncé l'information que la carte est censée faire extraire ou transformer. Exemple de défaut à éviter (trouvé sur un lot précédent, notion "changer de représentation") : une carte qui écrit en toutes lettres "mercredi fait le plus froid" dans l'énoncé puis demande "quel jour fait le plus froid ?" ne teste RIEN — l'élève répète l'information, il ne la transforme pas. Pour cette notion précise, il faut DEUX registres réels et distincts (ex. un tableau de données brutes dans l'énoncé + une question qui exige de lire/comparer/transformer ces données pour répondre, sans que la réponse soit déjà écrite ailleurs dans l'énoncé).

PROFIL DE CORRECTION — choisis pour chaque carte le profil qui correspond le mieux à la nature de la réponse attendue, parmi EXACTEMENT ces 4 valeurs :
- "numerique" : la réponse est un nombre (avec ou sans unité).
- "exact" : la réponse est une lettre de QCM, un mot-clé technique, une date, ou toute chaîne qui doit être rendue AU CARACTÈRE PRÈS (pas de tolérance orthographique).
- "sens" : la réponse est un mot ou une courte expression où seul le SENS compte (synonymes/reformulations acceptés) — PAS pour évaluer l'orthographe.
- "orthographe" : la réponse est un mot/une forme conjuguée où l'ORTHOGRAPHE EXACTE est ce qui est évalué.

RÉPONSES ACCEPTÉES — fournis toujours au moins une forme dans "reponses_acceptees" ; si plusieurs formulations/orthographes sont réellement équivalentes (ex. "40 m²" et "40"), liste-les toutes.

QCM (lettre + mot entier) — PIÈGE À ÉVITER : si "reponses_acceptees" contient à la fois la lettre ("A") ET le mot entier de l'option choisie ("terrifié"), le profil "exact" rendrait ce mot sensible à l'orthographe au caractère près — un piège parasite si la notion testée n'est pas l'orthographe (ex. lexique, sens d'un mot). Dans ce cas précis, deux choix possibles : (a) ne mets QUE la lettre dans "reponses_acceptees" (pas le mot), ou (b) si tu veux aussi accepter le mot entier, choisis le profil "sens" pour cette carte (jamais "exact").

FORMAT DE SORTIE — réponds UNIQUEMENT avec un JSON valide, sans texte avant ni après, exactement cette forme :
{
  "cartes": [
    {
      "contexte": "slug-court-unique-decrivant-la-situation",
      "question": "...",
      "reponse": "...",
      "difficulte": "facile" | "moyen" | "difficile",
      "profil_correction": "numerique" | "exact" | "sens" | "orthographe",
      "reponses_acceptees": ["..."],
      "unite": "..." (UNIQUEMENT si la réponse porte une grandeur physique/monétaire, omettre sinon)
    }
  ]
}`;
}

// ---------------------------------------------------------------------------
// 2. L'appel réseau réel — ISOLÉ du reste (jamais appelé par les tests). Lit la
//    clé dans ANTHROPIC_API_KEY, jamais ailleurs.
// ---------------------------------------------------------------------------
function appellerModeleClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY absente de l\'environnement — définis-la avant de lancer ce script (jamais en dur dans le code).');
  }

  const requestBody = JSON.stringify({
    model: MODELE,
    max_tokens: MAX_TOKENS_REPONSE,
    messages: [{ role: 'user', content: prompt }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(requestBody),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`API Claude : HTTP ${res.statusCode} — ${data}`));
            return;
          }
          try {
            const parsed = JSON.parse(data);
            // Sonnet renvoie plusieurs blocs de contenu (ex. "thinking" PUIS "text") —
            // jamais supposer que content[0] est le texte. Trouvé en calibration réelle
            // (1er appel T6b, 2026-10-10) : content[0].type === 'thinking' n'a pas de
            // champ .text, ce qui résolvait silencieusement vers undefined.
            const blocTexte = (Array.isArray(parsed.content) ? parsed.content : []).find((b) => b && b.type === 'text');
            resolve({ texte: blocTexte ? blocTexte.text : '', stopReason: parsed.stop_reason });
          } catch (e) {
            reject(new Error(`Réponse API non parsable : ${e.message}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// 3. Parsing de la réponse modèle — pure, testable sans réseau.
// ---------------------------------------------------------------------------
function parserReponseModele(texte) {
  const m = typeof texte === 'string' ? texte.match(/\{[\s\S]*\}/) : null;
  if (!m) return { ok: false, erreur: 'pas de JSON dans la réponse' };
  let parsed;
  try {
    parsed = JSON.parse(m[0]);
  } catch (e) {
    return { ok: false, erreur: `JSON invalide : ${e.message}` };
  }
  if (!Array.isArray(parsed.cartes)) return { ok: false, erreur: 'champ "cartes" absent ou non tableau' };
  return { ok: true, cartesBrutes: parsed.cartes };
}

// ---------------------------------------------------------------------------
// 4. Vérification ZÉRO TOLÉRANCE contre le vrai correcteur — pure, testable.
//    Une carte dont la propre réponse ne passe pas son propre correcteur est
//    rejetée. Jamais "presque" : on exige le statut 'juste' strictement (pas
//    compteCommeReussite, qui tolère aussi 'presque' en sens/numerique — ici on
//    vérifie la cohérence interne de la carte, pas une saisie élève approximative).
// ---------------------------------------------------------------------------
// Forme SAISISSABLE d'une référence (relecture Codex PR #2 v2, #3). En numérique
// avec arrondi, une forme de reponses_acceptees est une RÉFÉRENCE de calcul ("1/3"),
// pas ce qu'un élève tape : on teste sa cible arrondie ("0,33"), en conservant son
// propre reliquat d'unité tel quel — "2 bus" sans unite déclarée reste donc
// détecté ("2,00 bus" -> faux). Sans arrondi : forme littérale, inchangée.
const { formeSaisissable } = OUTILS_MOTEUR;

// La réponse-or, elle, est testée LITTÉRALEMENT (relecture Codex ciblée) : c'est ce
// que voit le relecteur et ce qu'un élève taperait — "0,334" pour un arrondi à 2
// décimales doit être rejetée, pas ramenée à "0,33". Seules les formes de
// reponses_acceptees (références de calcul) passent par formeSaisissable.
const verifierContreCorrecteur = OUTILS_MOTEUR.verifierReponseOr;

// ---------------------------------------------------------------------------
// 4ter. Garde-fou des FORMES ACCEPTÉES (relecture Codex PR #2, #8) — extension de
//    verifierContreCorrecteur, qui ne testait que la réponse-or. Cas réel : "2 bus",
//    "40 livres", "8 victoires" figuraient dans reponses_acceptees (donc affichées à
//    l'élève comme acceptées) alors que le correcteur les note "faux" (reliquat
//    alphabétique sans unite déclarée). Chaque forme déclarée doit donc COMPTER
//    COMME RÉUSSITE pour son propre correcteur (compteCommeReussite) : on tolère ici
//    "presque" là où le profil le compte comme réussi — c'est le cas voulu d'une
//    forme nombre-seul quand la carte déclare une unite (unité oubliée = presque,
//    réussite en numérique) — mais jamais "faux" ni "carte_invalide".
// ---------------------------------------------------------------------------
const { verifierFormesAcceptees } = OUTILS_MOTEUR;

// ---------------------------------------------------------------------------
// 4bis. Auto-correction d'une carte dont le champ "reponse" ne passe pas son
//    propre correcteur — AVANT rejet définitif. Pure, testable, zéro appel
//    réseau. Ne confond PAS avec le fixture T6a (`_fixture_note`) ni avec un
//    assouplissement du zéro-tolérance : on ne change jamais reponses_acceptees,
//    on ne fabrique jamais de contenu nouveau — on choisit, PARMI les formes que
//    le modèle a lui-même déjà déclarées dans reponses_acceptees, celle qui fait
//    passer la carte. Cas réel qui a motivé cette fonction (lot de validation
//    2026-10-11) :
//      - "2 pots" (reponse) vs reponses_acceptees=["2 pots","2"], unite non
//        déclarée -> le correcteur refuse "2 pots" (reliquat alphabétique non
//        exigé) mais accepte "2" -> reponse corrigée en "2".
//      - "il a un examen important" (reponse, une phrase) vs
//        reponses_acceptees=["un examen important", ...] (profil sens) -> le
//        correcteur refuse la phrase complète mais accepte la forme courte déjà
//        listée -> reponse corrigée en "un examen important".
//    Si AUCUNE forme de reponses_acceptees ne fait passer la carte (ex. reponses_
//    acceptees lui-même incohérent, cf. detecterIncoherenceAttendu), rien n'est
//    inventé : la carte reste rejetée exactement comme avant cette fonction.
function autoCorrigerCarte(carteBrute) {
  if (verifierContreCorrecteur(carteBrute).ok) {
    return { carte: carteBrute, corrigee: false };
  }

  const formes = Array.isArray(carteBrute.reponses_acceptees) ? carteBrute.reponses_acceptees : [];
  for (const forme of formes) {
    if (forme === carteBrute.reponse) continue; // déjà la valeur testée ci-dessus, a échoué
    const candidate = { ...carteBrute, reponse: forme };
    if (verifierContreCorrecteur(candidate).ok) {
      return { carte: candidate, corrigee: true, ancienneReponse: carteBrute.reponse };
    }
  }
  return { carte: carteBrute, corrigee: false };
}

// ---------------------------------------------------------------------------
// 4quater. Tri des cartes brutes — pure, testable (extrait de
//    genererLotPourNotionPalier pour que la chaîne complète auto-correction ->
//    réponse-or -> formes acceptées soit couverte sans appel réseau).
// ---------------------------------------------------------------------------
function trierCartesBrutes(cartesBrutes) {
  const rejets = [];
  const corrections = [];
  const cartesValides = [];
  cartesBrutes.forEach((brute, i) => {
    const { carte, corrigee, ancienneReponse } = autoCorrigerCarte(brute);
    const v = verifierContreCorrecteur(carte);
    if (!v.ok) {
      rejets.push({ index: i, raison: v.raison });
      return;
    }
    const vf = verifierFormesAcceptees(carte);
    if (!vf.ok) {
      rejets.push({ index: i, raison: vf.raison });
      return;
    }
    if (corrigee) corrections.push({ index: i, ancienneReponse, nouvelleReponse: carte.reponse });
    cartesValides.push(carte);
  });
  return { cartesValides, rejets, corrections };
}

// ---------------------------------------------------------------------------
// 5. Construction des candidates G4 (dérivation, jamais confiance au modèle) —
//    pure, testable. Réutilise generation.js tel quel pour tout ce qui est
//    système (set_id/item_id/relecteur/statut) — cette fonction ne fait QUE
//    assembler les champs, la validation réelle vient de generation.js.
// ---------------------------------------------------------------------------
function construireCandidats({ notion, palier, cartesBrutes, sequence, ts }) {
  const relecteur = relecteurDepuisMatiere(notion.matiere);
  const setId = genererSetId(notion.id, palier, sequence);
  return cartesBrutes.map((brute, i) => ({
    set_id: setId,
    item_id: genererItemId(i + 1),
    notion_id: notion.id,
    matiere: notion.matiere,
    relecteur,
    palier,
    difficulte: brute.difficulte,
    question: brute.question,
    reponse: brute.reponse,
    profil_correction: brute.profil_correction,
    reponses_acceptees: brute.reponses_acceptees,
    seconde_chance: false,
    statut: 'attente', // sera re-forcé par deposerEnRelecture — ceinture et bretelles.
    source: SOURCE_FONDA_SEED,
    ts,
    contexte: brute.contexte,
    unite: brute.unite || undefined,
    // Transmis tel quel : la carte a été vérifiée AVEC cet arrondi (relecture Codex
    // PR #2 v2, #3) — le perdre changerait la correction publiée.
    arrondi: brute.arrondi ?? undefined,
  }));
}

// ---------------------------------------------------------------------------
// 6. Fichier candidat au format lot-fonda/v1 (chaîne FONDA séparée de BOX, contrat
//    fonda/engine/catalogue.js) — pure, testable. Liste BLANCHE de champs : AUCUN
//    secret ni coordonnée (plus de id box_…, prof_email, code_suppression : ceux de
//    la chaîne BOX n'ont plus cours). Toujours revue_carte_par_carte: false — seule
//    la relecture humaine (puis publier-lot.js) mène au catalogue.
// ---------------------------------------------------------------------------
function construireLotFonda({ notion, palier, candidats }) {
  const setIds = [...new Set(candidats.map((c) => c.set_id))];
  if (setIds.length !== 1) throw new Error('candidats de set_id différents dans un même lot');
  const lot = {
    schema: SCHEMA_LOT,
    set_id: setIds[0],
    notion_id: notion.id,
    palier,
    matiere: LABEL_MATIERE[notion.matiere] || notion.matiere,
    notion: notion.libelle,
    niveau: `Fondamentaux — ${LABEL_PALIER[palier]}`, // FONDA est indépendant du niveau de classe (AGENTS.md).
    revue_carte_par_carte: false,
    nb_cartes: candidats.length,
    date_creation: new Date().toISOString().split('T')[0],
    cartes: candidats.map((c, i) => {
      const carte = {
        item_id: c.item_id,
        numero: i + 1,
        question: c.question,
        reponse: c.reponse,
        difficulte: c.difficulte,
        palier: c.palier,
        profil_correction: c.profil_correction,
        reponses_acceptees: c.reponses_acceptees,
        contexte: c.contexte,
        set_id: c.set_id,
        notion_id: c.notion_id,
      };
      if (c.unite != null) carte.unite = c.unite;
      if (c.arrondi != null) carte.arrondi = c.arrondi;
      return carte;
    }),
  };
  const v = validerLotFonda(lot);
  if (!v.valide) throw new Error(`lot non conforme à lot-fonda/v1 : ${v.erreurs.join(' ; ')}`);
  // Règles pédagogiques (profils, bornes d'arrondi) : celles du moteur des nouveaux lots.
  const refus = lot.cartes.map((c) => [c.item_id, MOTEUR.valider(c)]).filter(([, r]) => !r.valide);
  if (refus.length) throw new Error(`cartes refusées par le moteur ${MOTEUR.version} : ${refus.map(([id, r]) => `${id} (${r.raisons.join(', ')})`).join(' ; ')}`);
  return lot;
}

// set_id déjà pris (journal, publiés, en attente de relecture, non relus) : la
// séquence suivante est calculée dessus — jamais d'écrasement ni de recyclage.
// FAIL-CLOSED : tout fichier illisible (lot, catalogue) -> exception, jamais ignoré.
function setIdsExistants(journal, { dirs = [SORTIE_DIR, LOTS_PUBLIES_DIR], cataloguePath = CATALOGUE_PATH } = {}) {
  const ids = new Set(journal ? journal.lignes.map((l) => l.set_id) : []);
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      let l;
      try { l = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { throw new Error(`${path.relative(ROOT, path.join(dir, f))} illisible — arrêt (${e.message})`); }
      if (!l || typeof l.set_id !== 'string') throw new Error(`${path.relative(ROOT, path.join(dir, f))} sans set_id — arrêt`);
      ids.add(l.set_id);
    }
  }
  if (fs.existsSync(cataloguePath)) {
    let cat;
    try { cat = JSON.parse(fs.readFileSync(cataloguePath, 'utf8')); } catch (e) { throw new Error(`catalogue-fonda.json illisible — arrêt (${e.message})`); }
    for (const e of cat.lots || []) ids.add(e.set_id);
  }
  return [...ids];
}

function lireJournalLocal() {
  let texte;
  try { texte = fs.readFileSync(JOURNAL_PATH, 'utf8'); } catch (e) { throw new Error(`journal des set_id illisible (${path.relative(ROOT, JOURNAL_PATH)}) — arrêt`); }
  const j = Journal.lireJournalTexte(texte);
  const v = Journal.validerJournal(j);
  if (!v.valide) throw new Error(`journal des set_id non conforme — arrêt : ${v.erreurs.join(' ; ')}`);
  return j;
}

// Journal de l'AUTORITÉ (design), lu via git — jamais la copie locale. L'actualisation
// (git fetch origin design) est OBLIGATOIRE et doit réussir ; le journal est lu sur
// le SHA ainsi fixé (affiché). Ne prétend pas à une transaction distribuée : réduit
// la fenêtre d'une référence périmée, sans la supprimer.
function lireJournalDesign() {
  const git = (a) => execFileSync('git', a, { cwd: path.join(ROOT, '..'), stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  try { git(['fetch', '--quiet', 'origin', 'design']); } catch { throw new Error('actualisation de origin/design impossible (réseau ?) — arrêt, aucun appel API'); }
  let sha;
  let texte;
  try {
    sha = git(['rev-parse', '--verify', 'origin/design^{commit}']).trim();
    texte = git(['show', `${sha}:${JOURNAL_GIT}`]);
  } catch {
    throw new Error('journal introuvable sur origin/design (la réservation est-elle fusionnée ?) — arrêt');
  }
  return { sha, journal: Journal.lireJournalTexte(texte) };
}

// Pur — décision AVANT tout appel API et toute écriture :
//   - réservation présente dans le journal de design, avec EXACTEMENT cette ref, état
//     courant « reserve » ;
//   - journal local conforme et NON contradictoire pour ce set_id (même état, même
//     ligne de réservation) ;
//   - aucun fichier candidat ou publié ne porte déjà ce set_id, QUEL QUE SOIT son nom
//     de fichier : une calibration réservée est PROMOUVABLE, pas régénérable.
function verifierAvantGeneration({ journalDesign, journalLocal, setId, ref, idsFichiers }) {
  const r = Journal.verifierReservation(journalDesign, setId, ref);
  if (!r.ok) return r;
  const vl = Journal.validerJournal(journalLocal);
  if (!vl.valide) return { ok: false, raison: `journal local non conforme : ${vl.erreurs.join(' ; ')}` };
  const locale = journalLocal.lignes.find((l) => l.set_id === setId && l.transition === 'reserve');
  if (vl.etats.get(setId) !== 'reserve' || !locale || locale.ref !== ref) {
    return { ok: false, raison: `${setId} : journal local contradictoire avec design (état local ${vl.etats.get(setId) || 'absent'}) — synchroniser avant de générer` };
  }
  if (idsFichiers.includes(setId)) {
    return { ok: false, raison: `${setId} : déjà porté par un fichier candidat ou publié — une calibration réservée est promouvable, pas régénérable` };
  }
  return { ok: true };
}

// Pur : prochain set_id d'un (notion, palier) ; séquence 99 atteinte -> exception.
function prochainSetIdReserve(notionId, palier, existants) {
  const id = prochainSetId(notionId, palier, existants);
  if (!id) throw new Error(`${notionId}/${palier} : plus de séquence libre (99 atteinte) ou notion/palier invalide — arrêt, jamais de recyclage`);
  return id;
}

function nouvelleRef(le) {
  return `${le}-${require('crypto').randomBytes(6).toString('hex')}`;
}

// Pur : la notion et le palier encodés dans un set_id réservé, contre le référentiel.
function notionDuSetId(setId, referentiel) {
  const d = decomposerSetId(setId);
  if (!d) throw new Error(`set_id invalide : ${setId}`);
  const notions = referentiel.notions.filter((n) => slugDeNotion(n.id) === d.slug);
  if (notions.length !== 1) throw new Error(`${setId} : notion du référentiel introuvable ou ambiguë pour le slug ${d.slug}`);
  if (!notions[0].paliers.includes(d.palier)) throw new Error(`${setId} : palier ${d.palier} non prévu pour ${notions[0].id}`);
  return { notion: notions[0], palier: d.palier, sequence: d.sequence };
}

// Contextes déjà utilisés par l'AUTRE palier de la même notion (lots publiés et de
// calibration) : point 2 (pas de réutilisation de contexte entre nI et nF), désormais
// appliqué d'une exécution à l'autre puisqu'on génère un palier à la fois.
function contextesAutrePalier(notion, palier) {
  const out = [];
  for (const dir of [SORTIE_DIR, LOTS_PUBLIES_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const l = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (l.notion_id === notion.id && l.palier !== palier) for (const c of l.cartes || []) if (c.contexte) out.push(c.contexte);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 7. Orchestration — appelle le réseau (impure), enchaîne les étapes pures.
// ---------------------------------------------------------------------------
async function genererLotPourNotionPalier({ notion, palier, nCartes, contextesAutresPaliers = [], sequence = 1 }) {
  const contextesDejaUtilises = [];
  const prompt = construirePrompt({ notion, palier, nCartes, contextesDejaUtilises, contextesAutresPaliers });
  const { texte: texteReponse, stopReason } = await appellerModeleClaude(prompt);

  // Signalé distinctement du cas générique "pas de JSON" : ici le modèle n'a
  // produit AUCUN texte (budget "thinking" épuisé avant la réponse finale),
  // pas un texte malformé — le diagnostic doit pointer vers max_tokens, pas
  // vers un problème de format de sortie.
  if (!texteReponse && stopReason === 'max_tokens') {
    return {
      ok: false,
      erreur: `le modèle a épuisé son budget de réflexion (max_tokens=${MAX_TOKENS_REPONSE}) avant de produire une réponse — 0 carte générée. Revoir le prompt/référentiel pour cette notion, ou augmenter MAX_TOKENS_REPONSE.`,
    };
  }

  const parse = parserReponseModele(texteReponse);
  if (!parse.ok) return { ok: false, erreur: parse.erreur };

  const { cartesValides, rejets, corrections } = trierCartesBrutes(parse.cartesBrutes);

  if (cartesValides.length === 0) {
    return { ok: false, erreur: 'aucune carte valide après vérification correcteur', rejets, corrections };
  }

  const ts = new Date().toISOString();
  const candidats = construireCandidats({ notion, palier, cartesBrutes: cartesValides, sequence, ts });

  const jeuValide = validerJeu(candidats);
  if (!jeuValide.valide) return { ok: false, erreur: jeuValide.erreurs.join(', '), rejets, corrections };

  return { ok: true, candidats, rejets, corrections };
}

// Arguments de la CLI (pur, testé) : --palier CONSOMME sa valeur (lot 4 bis, D4).
function analyserArgumentsCli(argv) {
  const args = [...argv];
  let palier;
  const i = args.indexOf('--palier');
  if (i >= 0) {
    palier = args[i + 1];
    if (palier === undefined || palier.startsWith('--')) throw new Error('--palier : valeur nI ou nF attendue');
    if (palier !== 'nI' && palier !== 'nF') throw new Error(`--palier : « ${palier} » inconnu (nI ou nF)`);
    args.splice(i, 2);
    if (args.includes('--palier')) throw new Error('--palier : option en double');
    if (!args.includes('--reserver')) throw new Error('--palier : seulement avec --reserver');
  }
  return { args, palier };
}

async function main() {
  let args;
  let palierDemande;
  try { ({ args, palier: palierDemande } = analyserArgumentsCli(process.argv.slice(2))); } catch (e) { console.log(`Réservation refusée : ${e.message}`); process.exitCode = 1; return; }
  const nArg = args.find((a) => a.startsWith('--n='));
  const nCartes = nArg ? parseInt(nArg.slice(4), 10) : 6;
  const setIdArg = (args.find((a) => a.startsWith('--set-id=')) || '').slice(9);
  const refArg = (args.find((a) => a.startsWith('--ref=')) || '').slice(6);
  const reserver = args.includes('--reserver');
  const notionIdsDemandes = args.filter((a) => !a.startsWith('--'));

  if (!reserver && !setIdArg) {
    console.log('Usage :\n  node fonda/scripts/generer-lot-fonda.js --reserver <notion_id> [<notion_id> ...] [--palier nI|nF]\n  ANTHROPIC_API_KEY=... node fonda/scripts/generer-lot-fonda.js --set-id=<set_id> --ref=<ref> [--n=6]');
    process.exitCode = 1;
    return;
  }

  const referentiel = JSON.parse(fs.readFileSync(REFERENTIEL_PATH, 'utf-8'));
  const notionIdsConnus = new Set(referentiel.notions.map((n) => n.id));

  if (reserver) {
    // 1. RÉSERVATION : aucun appel réseau ; ajout au journal local, à committer.
    const manquants = notionIdsDemandes.filter((id) => !notionIdsConnus.has(id));
    const exclues = notionIdsDemandes.filter(estNotionExclue);
    if (!notionIdsDemandes.length || manquants.length || exclues.length) {
      console.log(`Réservation refusée : ${!notionIdsDemandes.length ? 'aucune notion' : ''}${manquants.length ? `notion_id inconnu(s) : ${manquants.join(', ')} ` : ''}${exclues.length ? `notion(s) exclue(s) : ${exclues.join(', ')}` : ''}`);
      process.exitCode = 1;
      return;
    }
    const journal = lireJournalLocal();
    const le = new Date().toISOString().slice(0, 10);
    const nouvelles = [];
    for (const notion of referentiel.notions.filter((n) => notionIdsDemandes.includes(n.id))) {
      if (palierDemande && !notion.paliers.includes(palierDemande)) { console.log(`Réservation refusée : palier ${palierDemande} non prévu pour ${notion.id}`); process.exitCode = 1; return; }
      for (const palier of notion.paliers.filter((p) => !palierDemande || p === palierDemande)) {
        const courant = { schema: journal.schema, lignes: [...journal.lignes, ...nouvelles] };
        const id = prochainSetIdReserve(notion.id, palier, setIdsExistants(courant));
        nouvelles.push(Journal.ligneReservation(courant, id, le, nouvelleRef(le)));
      }
    }
    const final = { schema: journal.schema, lignes: [...journal.lignes, ...nouvelles] };
    const v = Journal.validerJournal(final);
    if (!v.valide) throw new Error(v.erreurs.join(' ; '));
    fs.writeFileSync(JOURNAL_PATH, JSON.stringify(final, null, 2) + '\n');
    nouvelles.forEach((l) => console.log(`  ✓ réservé ${l.set_id}  ref=${l.ref}`));
    console.log('Commit + PR vers design ; après fusion : --set-id=<set_id> --ref=<ref>.');
    return;
  }

  // 2. GÉNÉRATION d'un set_id réservé.
  const r = await genererReserve({ setId: setIdArg, ref: refArg, nCartes, referentiel });
  if (!r.ok) process.exitCode = 1;
}

// Génération d'UN set_id réservé — séquence complète, dépendances injectables
// (tests : git, fichiers et API simulés). ORDRE : journal de design (fetch) ->
// vérification pure -> exclusions -> AUCUN appel API avant que tout soit vérifié.
// Toute exception ou tout refus avant l'appel -> { ok: false }, zéro appel API.
async function genererReserve({ setId, ref, nCartes, referentiel }, deps = {}) {
  const d = {
    lireJournalDesign, lireJournalLocal, setIdsExistants, generer: genererLotPourNotionPalier,
    contextes: contextesAutrePalier, existe: fs.existsSync, ecrire: (p, t) => fs.writeFileSync(p, t, { flag: 'wx' }),
    preparer: (dir) => fs.mkdirSync(dir, { recursive: true }),
    log: (m) => console.log(m), sortieDir: SORTIE_DIR, ...deps,
  };
  const arret = (m) => { d.log(`✗ ${m} — arrêt, aucun appel API`); return { ok: false, raison: m }; };
  let verification;
  try {
    const { sha, journal: journalDesign } = d.lireJournalDesign();
    d.log(`journal de référence : origin/design @ ${sha.slice(0, 12)}`);
    verification = verifierAvantGeneration({
      journalDesign, journalLocal: d.lireJournalLocal(), setId, ref,
      idsFichiers: d.setIdsExistants(null), // fail-closed : tout fichier illisible arrête ici
    });
  } catch (e) { return arret(e.message); }
  if (!verification.ok) return arret(verification.raison);
  let cible;
  try { cible = notionDuSetId(setId, referentiel); } catch (e) { return arret(e.message); }
  const { notion, palier, sequence } = cible;
  if (estNotionExclue(notion.id)) return arret(`${notion.id} exclue de la génération automatique`);
  const notionIdsConnus = new Set(referentiel.notions.map((n) => n.id));
  const sortiePath = path.join(d.sortieDir, `${setId}.json`);
  if (d.existe(sortiePath)) return arret(`${path.relative(ROOT, sortiePath)} existe déjà — refus d'écraser`);
  try { d.preparer(d.sortieDir); } catch (e) { return arret(`dossier de sortie impossible à préparer : ${e.message}`); } // AVANT l'appel API

  d.log(`\n=== ${setId} (${notion.id} / ${palier}, ${nCartes} cartes demandées) ===`);
  const resultat = await d.generer({ notion, palier, nCartes, contextesAutresPaliers: d.contextes(notion, palier), sequence });
  if (!resultat.ok) {
    d.log(`  ✗ ${resultat.erreur}`);
    (resultat.rejets || []).forEach((x) => d.log(`    - carte ${x.index} rejetée : ${x.raison}`));
    return { ok: false, raison: resultat.erreur };
  }
  (resultat.rejets || []).forEach((x) => d.log(`  ⚠ carte ${x.index} rejetée par le correcteur : ${x.raison}`));
  (resultat.corrections || []).forEach((c) => d.log(`  ✎ carte ${c.index} auto-corrigée : reponse "${c.ancienneReponse}" -> "${c.nouvelleReponse}"`));
  for (let i = 0; i < resultat.candidats.length; i++) {
    const v = validerCandidate(resultat.candidats[i], { notionIdsConnus });
    if (!v.valide) { d.log(`  ✗ rejeté par validerCandidate : carte ${i} : ${v.erreurs.join(', ')}`); return { ok: false }; }
  }
  const depot = deposerEnRelecture(resultat.candidats, { notions: referentiel.notions });
  if (depot.invalides.length > 0) {
    d.log(`  ✗ deposerEnRelecture a écarté ${depot.invalides.length} carte(s) — rien n'est écrit :`);
    depot.invalides.forEach((inv) => d.log(`    - index ${inv.index} : ${inv.raisons.join(', ')}`));
    return { ok: false };
  }
  const relecteur = relecteurDepuisMatiere(notion.matiere);
  const candidatsDeposes = depot.parRelecteur[relecteur];
  const fichier = construireLotFonda({ notion, palier, candidats: candidatsDeposes });
  if (fichier.set_id !== setId) return { ok: false, raison: `set_id produit ${fichier.set_id} ≠ set_id réservé ${setId}` };
  d.ecrire(sortiePath, JSON.stringify(fichier, null, 2) + '\n');
  d.log(`  ✓ ${candidatsDeposes.length}/${nCartes} cartes retenues → ${path.relative(ROOT, sortiePath)} (candidat, NON relu)`);
  d.log(`    Relecteur attribué (référentiel) : ${relecteur}`);
  return { ok: true, fichier };
}

module.exports = {
  analyserArgumentsCli,
  estNotionExclue,
  NOTIONS_EXCLUES_FIGURES,
  construirePrompt,
  parserReponseModele,
  verifierContreCorrecteur,
  verifierFormesAcceptees,
  formeSaisissable,
  trierCartesBrutes,
  autoCorrigerCarte,
  construireCandidats,
  construireLotFonda,
  genererLotPourNotionPalier,
  appellerModeleClaude,
  MODELE,
  SOURCE_FONDA_SEED,
  prochainSetIdReserve,
  notionDuSetId,
  setIdsExistants,
  verifierAvantGeneration,
  genererReserve,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(`✗ ${err && err.message ? err.message : err}`);
    process.exitCode = 1;
  });
}
