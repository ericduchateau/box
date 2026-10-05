// Composant « carte réponse produite » — Box-FONDA (T2).
// Vanilla JS, zéro dépendance, zéro framework (cohérent avec le front BOX existant).
// Référence : docs/PRD-Box-FONDA.md §5.
//
// Développé isolé, non branché à index.html (impact prod nul) — le câblage dans la
// page BOX existante est le Lot 1 T4 ("Mode Box-FONDA"), pas ce ticket.
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
//                      seconde_chance? } (sur-ensemble de PRD §3.6).
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

const MESSAGES = {
  juste: () => '✅ Juste !',
  faux: (bonneReponse) => `❌ Faux — réponse attendue : ${bonneReponse}`,
  presque: (bonneReponse) => `🟡 Presque ! → ${bonneReponse}`,
  // Carte signalée par le moteur comme incohérente (attendu malformé/contradictoire) —
  // jamais "juste", pas de seconde chance, à remonter en relecture (pas une erreur élève).
  carte_invalide: () => '⚠️ Carte à vérifier (signalée pour relecture)',
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

  const feedback = document.createElement('p');
  feedback.className = 'fonda-feedback';
  feedback.setAttribute('role', 'status');

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

    feedback.textContent = MESSAGES[statut](cibleAffichee);
    feedback.dataset.statut = statut;

    const reussite = compteCommeReussite(statut, carte.profil_correction);
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
