#!/usr/bin/env node
// Génération réelle de candidates Box-FONDA via l'API Claude (dette T6b).
// Référence : docs/PRD-Box-FONDA.md §9 (Moteur B), §11 (modèle + spec de clarté),
// §12 (routage) ; AVANCEMENT.md section T6a (🔖 DETTE T6b) ; fonda/data/README.md.
//
// CE QUE CE SCRIPT EST : l'appel réseau réel (Sonnet) + le même garde-fou G4 que le
// pilote T6a (fonda/engine/generation.js, réutilisé TEL QUEL — zéro duplication de
// la logique de dépôt) + une VÉRIFICATION ZÉRO TOLÉRANCE de chaque carte contre le
// vrai correcteur (fonda/engine/correction.js) avant toute sortie. Une carte qui ne
// repasse pas le correcteur est REJETÉE, jamais corrigée à la main, jamais marquée
// `_fixture_note` (ça, c'était le fixture technique T6a — ici c'est du contenu réel
// destiné à la relecture, tolérance zéro).
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
// Usage :
//   ANTHROPIC_API_KEY=sk-ant-... node fonda/scripts/generer-lot-fonda.js <notion_id> [<notion_id> ...] [--n=6]
//   Exemple (étape 1bis, calibration) :
//     ANTHROPIC_API_KEY=sk-ant-... node fonda/scripts/generer-lot-fonda.js maths.proportionnalite --n=4
//
// Notions EXCLUES par construction (voir NOTIONS_EXCLUES_FIGURES ci-dessous) : le
// script refuse de les traiter même si leur notion_id est passé en argument — pas
// une consigne de prompt, un refus avant tout appel réseau.
//
// Sortie : un fichier JSON par (notion_id, palier) dans
// fonda/data/lots-fonda-calibration/ (dossier de travail, PAS destiné à être lu par
// l'app ni par n8n en l'état — juste pour la relecture humaine en boucle locale,
// étape 1bis). Rien n'est écrit tant qu'un seul rejet (correcteur ou G4) subsiste
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

const { evaluerReponse } = require('../engine/correction.js');

const ROOT = path.resolve(__dirname, '..');
const REFERENTIEL_PATH = path.join(ROOT, 'data', 'referentiel.json');
const DESTINATAIRES_PATH = path.join(ROOT, 'data', 'destinataires.json');
const SORTIE_DIR = path.join(ROOT, 'data', 'lots-fonda-calibration');

const SOURCE_FONDA_SEED = 'T6b-seed';

// Sonnet fort (G5 : jamais Haiku pour Box-FONDA). Identifiant donné le 2026-10-10 —
// c'est l'identifiant exact du modèle qui exécute cette session (information de
// premier rang, pas une recherche web), PAS le même que 'claude-sonnet-5-5' (rejeté
// par Éric comme invalide lors du réglage précédent). Vérifier qu'il répond
// toujours au moment de l'appel réel ; ces identifiants peuvent changer.
const MODELE = 'claude-sonnet-5';

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

4. DISTRIBUTION DES RÉPONSES (si la carte prend la forme d'un choix A/B/C) — répartis la position de la bonne réponse entre A, B et C sur l'ensemble du lot, jamais toujours la même lettre.

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
    max_tokens: 4096,
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
            resolve(blocTexte ? blocTexte.text : '');
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
function verifierContreCorrecteur(carteBrute) {
  const { statut } = evaluerReponse({
    profil: carteBrute.profil_correction,
    reponseDonnee: carteBrute.reponse,
    reponsesAcceptees: carteBrute.reponses_acceptees,
    unite: carteBrute.unite || null,
    arrondi: null,
  });
  if (statut !== 'juste') {
    return { ok: false, raison: `le correcteur (profil "${carteBrute.profil_correction}") ne valide pas la réponse "${carteBrute.reponse}" contre reponses_acceptees=${JSON.stringify(carteBrute.reponses_acceptees)}${carteBrute.unite ? ` unite="${carteBrute.unite}"` : ''} (statut obtenu : "${statut}")` };
  }
  return { ok: true };
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
  }));
}

// ---------------------------------------------------------------------------
// 6. Reformatage vers le format box-select (décision T6b point b) — pure,
//    testable. N'ajoute QUE des champs ; ne touche ni box-select, ni
//    box-select-confirm, ni box-set (ils ignorent les champs qu'ils ne lisent
//    pas : palier/profil_correction/reponses_acceptees/unite/contexte/set_id/
//    item_id/notion_id voyagent intacts, lus plus tard par le Moteur A/B, Lot 2).
// ---------------------------------------------------------------------------
function construireFichierBoxSelect({ notion, palier, candidats, destinataires }) {
  const relecteur = candidats[0].relecteur;
  const email = destinataires.relecteurs[relecteur] && destinataires.relecteurs[relecteur].email;
  if (!email) throw new Error(`destinataires.relecteurs.${relecteur}.email manquant`);

  const id = 'box_' + Math.random().toString(36).substring(2, 10);
  const codeSuppression = 'SUP-' + Math.random().toString(36).substring(2, 10).toUpperCase();

  return {
    id,
    matiere: LABEL_MATIERE[notion.matiere] || notion.matiere,
    niveau: `Fondamentaux — ${LABEL_PALIER[palier]}`, // cf. note ouverte : FONDA est indépendant du niveau de classe (AGENTS.md), pas d'équivalent "6e" naturel ici.
    notion: notion.libelle,
    prof_nom: 'Box-FONDA (génération automatique)',
    prof_email: email,
    code_suppression: codeSuppression,
    date_creation: new Date().toISOString().split('T')[0],
    nb_cartes: candidats.length,
    source: 'fonda-seed',
    type: 'fonda',
    revue_carte_par_carte: false,
    cartes: candidats.map((c, i) => ({
      numero: i + 1,
      question: c.question,
      reponse: c.reponse,
      difficulte: c.difficulte,
      // Champs FONDA supplémentaires — box-select/box-select-confirm/box-set les
      // ignorent, ils voyagent intacts jusqu'au Moteur A/B (Lot 2).
      palier: c.palier,
      profil_correction: c.profil_correction,
      reponses_acceptees: c.reponses_acceptees,
      unite: c.unite,
      contexte: c.contexte,
      set_id: c.set_id,
      item_id: c.item_id,
      notion_id: c.notion_id,
    })),
  };
}

// ---------------------------------------------------------------------------
// 7. Orchestration — appelle le réseau (impure), enchaîne les étapes pures.
// ---------------------------------------------------------------------------
async function genererLotPourNotionPalier({ notion, palier, nCartes, contextesAutresPaliers = [] }) {
  const contextesDejaUtilises = [];
  const prompt = construirePrompt({ notion, palier, nCartes, contextesDejaUtilises, contextesAutresPaliers });
  const texteReponse = await appellerModeleClaude(prompt);
  const parse = parserReponseModele(texteReponse);
  if (!parse.ok) return { ok: false, erreur: parse.erreur };

  const rejets = [];
  const cartesValides = [];
  parse.cartesBrutes.forEach((brute, i) => {
    const v = verifierContreCorrecteur(brute);
    if (!v.ok) {
      rejets.push({ index: i, raison: v.raison });
      return;
    }
    cartesValides.push(brute);
  });

  if (cartesValides.length === 0) {
    return { ok: false, erreur: 'aucune carte valide après vérification correcteur', rejets };
  }

  const ts = new Date().toISOString();
  const candidats = construireCandidats({ notion, palier, cartesBrutes: cartesValides, sequence: 1, ts });

  const jeuValide = validerJeu(candidats);
  if (!jeuValide.valide) return { ok: false, erreur: jeuValide.erreurs.join(', '), rejets };

  return { ok: true, candidats, rejets };
}

async function main() {
  const args = process.argv.slice(2);
  const nArg = args.find((a) => a.startsWith('--n='));
  const nCartes = nArg ? parseInt(nArg.slice(4), 10) : 6;
  const notionIdsDemandes = args.filter((a) => !a.startsWith('--'));

  if (notionIdsDemandes.length === 0) {
    console.log('Usage : node fonda/scripts/generer-lot-fonda.js <notion_id> [<notion_id> ...] [--n=6]');
    process.exitCode = 1;
    return;
  }

  const referentiel = JSON.parse(fs.readFileSync(REFERENTIEL_PATH, 'utf-8'));
  const destinataires = JSON.parse(fs.readFileSync(DESTINATAIRES_PATH, 'utf-8'));
  const notionIdsConnus = new Set(referentiel.notions.map((n) => n.id));

  const notions = referentiel.notions.filter((n) => notionIdsDemandes.includes(n.id));
  const manquants = notionIdsDemandes.filter((id) => !notionIdsConnus.has(id));
  if (manquants.length > 0) {
    console.log(`notion_id inconnu(s) du référentiel : ${manquants.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  // Exclusion figures (point 4, demande d'Éric) : vérifiée ICI, avant tout appel
  // réseau — un refus explicite, jamais un simple espoir que le prompt suffise.
  const exclues = notionIdsDemandes.filter(estNotionExclue);
  if (exclues.length > 0) {
    console.log(`Notion(s) exclue(s) de la génération automatique (figures/schémas requis, pas évaluables en texte seul) : ${exclues.join(', ')}`);
    console.log('Aucun appel API effectué. Retire ces notion_id de la commande pour lancer les autres.');
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(SORTIE_DIR, { recursive: true });

  for (const notion of notions) {
    const contextesParPalier = {}; // point 2 : interdire la réutilisation de contexte entre nI et nF.

    for (const palier of notion.paliers) {
      const contextesAutresPaliers = Object.keys(contextesParPalier)
        .filter((p) => p !== palier)
        .flatMap((p) => contextesParPalier[p]);

      console.log(`\n=== ${notion.id} / ${palier} (${nCartes} cartes demandées) ===`);
      const resultat = await genererLotPourNotionPalier({ notion, palier, nCartes, contextesAutresPaliers });

      if (!resultat.ok) {
        console.log(`  ✗ ${resultat.erreur}`);
        (resultat.rejets || []).forEach((r) => console.log(`    - carte ${r.index} rejetée : ${r.raison}`));
        continue;
      }

      (resultat.rejets || []).forEach((r) => console.log(`  ⚠ carte ${r.index} rejetée par le correcteur : ${r.raison}`));

      // Validation G4 complète (le vrai garde-fou — generation.js, pas dupliqué ici).
      candidatsAvecValidationForme:
      {
        let erreurForme = null;
        for (let i = 0; i < resultat.candidats.length; i++) {
          const v = validerCandidate(resultat.candidats[i], { notionIdsConnus });
          if (!v.valide) { erreurForme = `carte ${i} : ${v.erreurs.join(', ')}`; break; }
        }
        if (erreurForme) {
          console.log(`  ✗ rejeté par validerCandidate : ${erreurForme}`);
          continue;
        }
      }

      const depot = deposerEnRelecture(resultat.candidats, { notions: referentiel.notions });
      if (depot.invalides.length > 0) {
        console.log(`  ✗ deposerEnRelecture a écarté ${depot.invalides.length} carte(s) — rien n'est écrit pour ce palier :`);
        depot.invalides.forEach((inv) => console.log(`    - index ${inv.index} : ${inv.raisons.join(', ')}`));
        continue;
      }

      const relecteur = relecteurDepuisMatiere(notion.matiere);
      const candidatsDeposes = depot.parRelecteur[relecteur];
      contextesParPalier[palier] = candidatsDeposes.map((c) => c.contexte);
      const fichier = construireFichierBoxSelect({ notion, palier, candidats: candidatsDeposes, destinataires });

      const nomFichier = `${notion.id.replace(/\./g, '-')}_${palier}.json`;
      const sortiePath = path.join(SORTIE_DIR, nomFichier);
      fs.writeFileSync(sortiePath, JSON.stringify(fichier, null, 2) + '\n');

      console.log(`  ✓ ${candidatsDeposes.length}/${nCartes} cartes retenues → ${path.relative(ROOT, sortiePath)}`);
      console.log(`    Relecteur : ${relecteur} (${fichier.prof_email})`);
    }
  }
}

module.exports = {
  estNotionExclue,
  NOTIONS_EXCLUES_FIGURES,
  construirePrompt,
  parserReponseModele,
  verifierContreCorrecteur,
  construireCandidats,
  construireFichierBoxSelect,
  genererLotPourNotionPalier,
  appellerModeleClaude,
  MODELE,
  SOURCE_FONDA_SEED,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
