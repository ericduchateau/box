// Composant « carte réponse produite » — Box-FONDA (T2).
// Vanilla JS, zéro dépendance, zéro framework (cohérent avec le front BOX existant).
// Référence : docs/PRD-Box-FONDA.md §5.
//
// Développé isolé, non branché à index.html (impact prod nul) — le câblage dans la
// page BOX existante est le Lot 1 T4 ("Mode Box-FONDA"), pas ce ticket.
//
// Thème sombre + structure de feedback enrichie (verdict/icône, réponse attendue,
// réponses acceptées, profil, mention relecteur) ajoutés pour coller au
// démonstrateur docs/box-fonda-design/demo-reference.html — voir css/style.css
// (classes .fonda-feedback__*). Purement présentationnel : evaluerReponse() et le
// contrat onResultat ci-dessous sont inchangés.
//
// NON testé par le test runner Node (fonda/engine/correction.test.js) : ce fichier
// manipule le DOM, qui n'existe pas en environnement Node natif sans dépendance
// supplémentaire (jsdom). La logique qu'il appelle (évaluerReponse) est, elle,
// entièrement couverte. Voir fonda/engine/README.md.
//
// Usage (charger correction.js AVANT ce fichier, simple <script> sans bundler —
// cohérent avec js/config.js / js/app.js existants) :
//   <script src="fonda/engine/correction.js"></script>
//   <script src="fonda/engine/carte-reponse-produite.js"></script>
//   <script>
//     FondaCarteReponseProduite.montrerCarteReponseProduite(containerEl, carte, {
//       onResultat(evenement) { ... }
//     });
//   </script>
//
// `carte` attendu : { question, profil_correction, reponses_acceptees, unite?, arrondi?,
//                      seconde_chance?, relecteur? } (sur-ensemble de PRD §3.6).
// `relecteur` (optionnel, ex. "Justine Leblanc") : si fourni, affiche la mention
// "Fiche relue et validée par ... avant publication." ; absent, le bloc n'apparaît
// pas (aucune rupture pour les appels existants qui ne le passent pas).
// `onResultat` reçoit { statut, reussite, tentative, scored } — à charge de l'appelant
// (T3) d'en faire un événement conforme au schéma PRD §3.2 (aucune émission ici : ce
// composant ne connaît ni grp, ni notion_id, ni contexte de session).
// Contrat seconde chance (PRD §5.1 : « on score la 1ère tentative ») : `tentative`
// vaut 1 ou 2, `scored` n'est true QUE pour tentative===1. La 2e tentative (si
// proposée après un "presque") est pédagogique, jamais scorée — à l'appelant (T3)
// de n'émettre un événement de mesure que pour les résultats où scored===true.

(function (root) {
'use strict';

const { evaluerReponse, compteCommeReussite, calculerCibleAffichee } = root.FondaCorrection;

// Texte du verdict par statut — l'icône/couleur, elles, sont dérivées de la
// RÉUSSITE RÉELLE (compteCommeReussite), pas du statut seul (relecture Codex #2) :
// "presque" compte juste en sens/numerique mais FAUX en orthographe (PRD §5.1,
// l'accent/le pluriel y est la cible) — l'icône doit refléter cette distinction,
// jamais un ✓ systématique qui contredirait la mesure.
const TEXTES_VERDICT = {
  juste: () => 'Bonne réponse',
  presque: (succes) => (succes ? 'Presque ! (voir ci-dessous)' : 'Pas tout à fait (voir ci-dessous)'),
  faux: () => 'Pas tout à fait',
  carte_invalide: () => 'Carte à vérifier (signalée pour relecture)',
};

const LABELS_PROFIL = {
  sens: 'Profil : sens',
  numerique: 'Profil : numérique',
  exact: 'Profil : exact',
  orthographe: 'Profil : orthographe',
};

/**
 * Monte une carte « réponse produite » dans `container`.
 * @param {HTMLElement} container
 * @param {object} carte
 * @param {{ onResultat?: (r: object) => void }} [options]
 */
function montrerCarteReponseProduite(container, carte, options = {}) {
  const { onResultat } = options;
  // Cible RÉELLEMENT exigée pour le feedback — jamais la 1ère réponse acceptée
  // brute : en numérique, tient compte de l'arrondi et de l'unité (critique Codex #7).
  const cibleAffichee = calculerCibleAffichee({
    profil: carte.profil_correction,
    reponsesAcceptees: carte.reponses_acceptees || [],
    unite: carte.unite ?? null,
    arrondi: carte.arrondi ?? null,
  });

  container.innerHTML = '';
  container.classList.add('fonda-carte-reponse-produite');

  const question = document.createElement('p');
  question.className = 'fonda-question';
  question.textContent = carte.question;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'fonda-reponse-input';
  input.setAttribute('aria-label', 'Votre réponse');
  input.autocomplete = 'off';

  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.textContent = 'Valider';
  bouton.className = 'fonda-valider';

  const feedback = document.createElement('div');
  feedback.className = 'fonda-feedback';
  feedback.setAttribute('role', 'status');

  // Construit le contenu du bandeau de correction — structure cible :
  // docs/box-fonda-design/demo-reference.html (verdict + icône, réponse attendue,
  // réponses acceptées, profil, mention relecteur). Purement présentationnel :
  // ne change ni la logique d'évaluation ni le contrat onResultat ci-dessous.
  function rendreFeedback(statut, reussite) {
    feedback.innerHTML = '';
    feedback.dataset.statut = statut;
    // data-reussite pilote l'icône/couleur (css/style.css) — jamais le statut brut,
    // pour que "presque" en orthographe s'affiche bien comme un échec (voir ci-dessus).
    feedback.dataset.reussite = String(reussite);

    const texteFn = TEXTES_VERDICT[statut] || TEXTES_VERDICT.carte_invalide;

    const ligneVerdict = document.createElement('p');
    ligneVerdict.className = 'fonda-feedback__verdict';
    const mark = document.createElement('span');
    mark.className = 'fonda-feedback__mark';
    mark.textContent = reussite ? '✓' : '✗';
    const texteVerdict = document.createElement('span');
    texteVerdict.textContent = texteFn(reussite);
    ligneVerdict.append(mark, texteVerdict);

    const detail = document.createElement('p');
    detail.className = 'fonda-feedback__detail';
    const lblDetail = document.createElement('span');
    lblDetail.className = 'fonda-feedback__lbl';
    lblDetail.textContent = 'Réponse attendue';
    const valDetail = document.createElement('span');
    valDetail.textContent = cibleAffichee;
    detail.append(lblDetail, document.createElement('br'), valDetail);

    feedback.append(ligneVerdict, detail);

    // "Aussi acceptées" : exclu en profil numerique (relecture Codex #4). En
    // numerique, reponses_acceptees est une liste de RÉFÉRENCES pour le calcul
    // (fractions/valeurs brutes avant arrondi/unité) — pas des chaînes littéralement
    // acceptables telles quelles (ex. "1/3" listé alors que le correcteur exige
    // "0,33" avec arrondi:2 ; ou "9" listé alors qu'il exige "9 km" et ne donnerait
    // que "presque" sans l'unité). "Réponse attendue" (cibleAffichee, ci-dessus) est
    // déjà la forme correcte et unique à afficher pour ce profil. Pour les profils
    // littéraux (sens/exact/orthographe), les formes SONT des chaînes littéralement
    // acceptées, sans post-traitement — la liste reste fiable.
    // Array.isArray : une carte malformée (reponses_acceptees non-tableau) ne doit
    // jamais faire planter le rendu avant que onResultat() soit appelé (relecture
    // Codex #5 — régression constatée avec un .forEach() sur une donnée non-tableau).
    const formesAcceptees = Array.isArray(carte.reponses_acceptees) ? carte.reponses_acceptees : [];
    if (carte.profil_correction !== 'numerique' && formesAcceptees.length > 1) {
      const accept = document.createElement('p');
      accept.className = 'fonda-feedback__accept';
      const lblAccept = document.createElement('span');
      lblAccept.className = 'fonda-feedback__lbl';
      lblAccept.textContent = 'Aussi acceptées';
      accept.append(lblAccept, document.createElement('br'));
      formesAcceptees.forEach((forme) => {
        const code = document.createElement('code');
        code.textContent = forme;
        accept.append(code);
      });
      feedback.append(accept);
    }

    const profil = document.createElement('p');
    profil.className = 'fonda-feedback__profil';
    profil.textContent = LABELS_PROFIL[carte.profil_correction] || '';
    feedback.append(profil);

    // Pas de mention de validation sur une carte signalée incohérente : ce n'est
    // précisément PAS une carte que la relecture a validée dans cet état-là.
    if (carte.relecteur && statut !== 'carte_invalide') {
      const relecteur = document.createElement('p');
      relecteur.className = 'fonda-feedback__relecteur';
      const chk = document.createElement('span');
      chk.className = 'fonda-feedback__chk';
      chk.textContent = '✓';
      const texteRelecteur = document.createElement('span');
      texteRelecteur.textContent = `Fiche relue et validée par ${carte.relecteur} avant publication.`;
      relecteur.append(chk, texteRelecteur);
      feedback.append(relecteur);
    }
  }

  let tentative = 0;

  function soumettre() {
    tentative += 1;

    const { statut } = evaluerReponse({
      profil: carte.profil_correction,
      reponseDonnee: input.value,
      reponsesAcceptees: carte.reponses_acceptees || [],
      unite: carte.unite ?? null,
      arrondi: carte.arrondi ?? null,
    });

    const reussite = compteCommeReussite(statut, carte.profil_correction);
    rendreFeedback(statut, reussite);

    const scored = tentative === 1; // PRD §5.1 : on score la 1ère tentative, jamais la seconde chance
    // Seconde chance : relance immédiate après un "presque", seulement sur la 1ère tentative.
    const proposerSecondeChance = statut === 'presque' && carte.seconde_chance && tentative === 1;

    if (typeof onResultat === 'function') {
      onResultat({ statut, reussite, tentative, scored });
    }

    if (proposerSecondeChance) {
      input.value = '';
      input.focus();
    } else {
      input.disabled = true;
      bouton.disabled = true;
    }
  }

  bouton.addEventListener('click', soumettre);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') soumettre();
  });

  container.append(question, input, bouton, feedback);
  input.focus();
}

root.FondaCarteReponseProduite = { montrerCarteReponseProduite };

})(typeof window !== 'undefined' ? window : this);
