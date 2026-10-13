// Composant « carte réponse produite » — Box-FONDA (T2).
// Vanilla JS, zéro dépendance, zéro framework (cohérent avec le front BOX existant).
// Référence : docs/PRD-Box-FONDA.md §5 ; CDC relecture §4.2 (moteur versionné).
//
// PUREMENT PRÉSENTATIONNEL (CDC §4.2) : toute décision pédagogique (évaluation,
// verdict, icône, cible, formes affichées, badge visible ou non, tentative comptée,
// seconde chance, verrouillage, fin de carte) est prise par le MOTEUR injecté
// (fonda/engine/moteur-correction-v<N>.js). Ce fichier affiche la carte préparée
// puis le `resultat` tel quel ; le seul aiguillage est le gabarit dicté par
// `resultat.gabarit`. Aucun global lu.
//
// Usage :
//   const moteur = (await obtenirMoteur(version, sha256));   // bootstrap.js
//   FondaCarteReponseProduite.montrerCarteReponseProduite(containerEl, {
//     moteur,
//     carte: moteur.preparerCarte(carteDuLot),
//     badge: { forme: 'relue_par', nom_affiche: 'Éric Duchateau' },  // optionnel
//     onResultat(resultat) { ... },
//   });
//
// `badge` (optionnel, = entree.relecteur du catalogue) : texte construit à partir de
// `forme` (CDC §12) — « relue_et_validee » -> « Fiche relue et validée par X »,
// sinon « Fiche relue par X ». Affiché seulement si resultat.afficher_badge_relecture.
// `onResultat(resultat)` : appelé une fois par soumission, APRÈS l'affichage et le
// verrouillage (E2), avec l'objet gelé du moteur ; une exception y est interceptée
// et journalisée sans rien changer à l'affichage (E3). Plus d'onErreur : l'issue
// « erreur » passe par resultat (E4). Émetteur futur : n'émettre que si resultat.compte.

(function (root) {
'use strict';

const TEXTES_BADGE = {
  relue_et_validee: (nom) => `Fiche relue et validée par ${nom}`,
  relue_par: (nom) => `Fiche relue par ${nom}`,
};

function texteBadge(badge) {
  if (!badge || typeof badge.nom_affiche !== 'string' || badge.nom_affiche.trim() === '') return '';
  return (TEXTES_BADGE[badge.forme] || TEXTES_BADGE.relue_par)(badge.nom_affiche.trim());
}

/**
 * Monte une carte « réponse produite » dans `container`.
 * @param {HTMLElement} container
 * @param {{ moteur: object, carte: object, badge?: object, onResultat?: (r: object) => void }} options
 */
function montrerCarteReponseProduite(container, { moteur, carte, badge, onResultat } = {}) {
  if (!moteur || typeof moteur.soumettre !== 'function' || !carte) throw new Error('carte-reponse-produite : moteur et carte requis');
  let etat = moteur.demarrer(carte);
  const libelleBadge = texteBadge(badge);

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

  // Gabarit « erreur » : message seul (structure inchangée depuis l'ancien onErreur).
  function rendreErreur(r) {
    feedback.innerHTML = '';
    delete feedback.dataset.reussite;
    feedback.textContent = r.verdict.texte;
    feedback.dataset.statut = r.issue;
  }

  // Gabarit « correction » — structure cible docs/box-fonda-design/demo-reference.html
  // (verdict + icône, réponse attendue, réponses acceptées, profil, badge). Toutes les
  // valeurs viennent de `r` ; data-reussite pilote l'icône/couleur (css/style.css).
  function rendreCorrection(r) {
    feedback.innerHTML = '';
    feedback.dataset.statut = r.issue;
    feedback.dataset.reussite = String(r.reussite);

    const ligneVerdict = document.createElement('p');
    ligneVerdict.className = 'fonda-feedback__verdict';
    const mark = document.createElement('span');
    mark.className = 'fonda-feedback__mark';
    mark.textContent = r.verdict.icone === 'succes' ? '✓' : '✗';
    const texteVerdict = document.createElement('span');
    texteVerdict.textContent = r.verdict.texte;
    ligneVerdict.append(mark, texteVerdict);

    const detail = document.createElement('p');
    detail.className = 'fonda-feedback__detail';
    const lblDetail = document.createElement('span');
    lblDetail.className = 'fonda-feedback__lbl';
    lblDetail.textContent = 'Réponse attendue';
    const valDetail = document.createElement('span');
    valDetail.textContent = r.cible_affichee;
    detail.append(lblDetail, document.createElement('br'), valDetail);

    feedback.append(ligneVerdict, detail);

    if (r.formes_affichees.length > 0) {
      const accept = document.createElement('p');
      accept.className = 'fonda-feedback__accept';
      const lblAccept = document.createElement('span');
      lblAccept.className = 'fonda-feedback__lbl';
      lblAccept.textContent = 'Aussi acceptées';
      accept.append(lblAccept, document.createElement('br'));
      r.formes_affichees.forEach((forme) => {
        const code = document.createElement('code');
        code.textContent = forme;
        accept.append(code);
      });
      feedback.append(accept);
    }

    const profil = document.createElement('p');
    profil.className = 'fonda-feedback__profil';
    profil.textContent = r.profil_libelle;
    feedback.append(profil);

    if (libelleBadge && r.afficher_badge_relecture) {
      const relecteur = document.createElement('p');
      relecteur.className = 'fonda-feedback__relecteur';
      const chk = document.createElement('span');
      chk.className = 'fonda-feedback__chk';
      chk.textContent = '✓';
      const texteRelecteur = document.createElement('span');
      texteRelecteur.textContent = libelleBadge;
      relecteur.append(chk, texteRelecteur);
      feedback.append(relecteur);
    }
  }

  function soumettre() {
    if (etat.terminee) return;
    const sortie = moteur.soumettre(etat, input.value);
    etat = sortie.etat;
    const r = sortie.resultat;

    if (r.gabarit === 'erreur') rendreErreur(r); else rendreCorrection(r);

    if (r.verrouillee) {
      input.disabled = true;
      bouton.disabled = true;
    } else {
      input.value = '';
      input.focus();
    }

    if (typeof onResultat === 'function') {
      try { onResultat(r); } catch (e) {
        if (typeof console !== 'undefined' && console.error) console.error('carte-reponse-produite : exception dans onResultat', e);
      }
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
