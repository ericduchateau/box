// Bootstrap du mode Box-FONDA (T4) — chargé UNIQUEMENT quand ?fonda=1 (voir
// js/app.js::initFonda(), qui l'injecte dynamiquement : zéro <script> statique, donc
// zéro requête quand le flag est absent). Lecture seule des données déjà posées
// (classes.json, referentiel.json, calendar.json) — n'écrit jamais rien dans ces
// fichiers. Référence : docs/PRD-Box-FONDA.md §4, §6 ; AGENTS.md G1/G7.
//
// Ce fichier est volontairement MINCE : toute la logique métier (génération de liens,
// résolution d'un defi_id) vit dans fonda/engine/liens.js, pur et testé (18 tests,
// node --test fonda/engine/liens.test.js). Ici, uniquement du fetch + du rendu DOM —
// non testable en Node sans navigateur, donc NON COUVERT par la suite automatisée.
// À smoke-tester manuellement avant tout usage réel (voir fonda/engine/README.md).
//
// Portée T4 (décision Éric) : le contenu réel des cartes d'un défi dépend de T6
// (génération), qui n'existe pas encore — ce fichier résout le contexte d'un défi et
// expose le point de branchement vers T2 (carte-reponse-produite.js) et T3
// (evenements.js), mais n'essaie PAS de fetcher un vrai jeu de cartes. Quand T6
// existera, remplacer le message "contenu à venir" de lancerDefi() par un vrai fetch
// + FondaCarteReponseProduite.montrerCarteReponseProduite(...) — le reste (résolution
// de contexte, émission d'événement) est déjà le bon branchement.

(function () {
  'use strict';

  function param(nom) {
    return new URLSearchParams(window.location.search).get(nom);
  }

  function racineFonda() {
    let el = document.getElementById('fondaRoot');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fondaRoot';
      document.body.appendChild(el);
    }
    return el;
  }

  function afficherMessage(root, texte) {
    root.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'fonda-message';
    p.textContent = texte;
    root.appendChild(p);
  }

  async function chargerJSON(chemin) {
    const resp = await fetch(chemin);
    if (!resp.ok) throw new Error('fonda: lecture impossible de ' + chemin);
    return resp.json();
  }

  // Semaine du calendrier dont [du, au] couvre aujourd'hui. Lecture seule, aucune
  // écriture, aucune fabrication d'occurrence si rien ne correspond.
  function semaineCourante(calendrier, maintenant) {
    const semaines = Array.isArray(calendrier.semaines) ? calendrier.semaines : [];
    return semaines.find((s) => {
      const du = new Date(s.du + 'T00:00:00');
      const au = new Date(s.au + 'T23:59:59');
      return maintenant >= du && maintenant <= au;
    }) || null;
  }

  function trouverSemaineParNumero(calendrier, numero) {
    const semaines = Array.isArray(calendrier.semaines) ? calendrier.semaines : [];
    return semaines.find((s) => Number(s.iso_week) === Number(numero)) || null;
  }

  // --- Page par niveau : un lien par classe, par défi programmé cette semaine -------

  function renderPageNiveau({ classes, calendrier }) {
    const root = racineFonda();
    const niveau = param('niveau');
    if (!niveau) { afficherMessage(root, 'Niveau manquant (?niveau=6e, 5e, 4e ou 3e).'); return; }

    const semaineParam = param('semaine');
    const semaineEntry = semaineParam
      ? trouverSemaineParNumero(calendrier, semaineParam.replace(/^.*?w/i, ''))
      : semaineCourante(calendrier, new Date());

    if (!semaineEntry) { afficherMessage(root, 'Aucun défi programmé cette semaine.'); return; }

    const entreesNiveau = (semaineEntry.entrees || []).filter((e) => e && e.niveau_cible === niveau);
    if (entreesNiveau.length === 0) { afficherMessage(root, `Aucun défi programmé pour ${niveau} cette semaine.`); return; }

    const annee = String(new Date(semaineEntry.du + 'T00:00:00').getFullYear());
    const liens = window.FondaLiens.genererLiensNiveau({
      niveau, annee, semaine: String(semaineEntry.iso_week),
      entreesNiveau, classesAutorisees: classes,
    });

    root.innerHTML = '';
    const titre = document.createElement('h2');
    titre.textContent = `Défis ${niveau} — semaine ${semaineEntry.iso_week}`;
    root.appendChild(titre);

    const liste = document.createElement('ul');
    liste.className = 'fonda-liens-niveau';
    const base = window.location.origin + window.location.pathname;
    liens.forEach((lien) => {
      const url = `${base}?fonda=1&defi=${encodeURIComponent(lien.defiId)}`;
      const li = document.createElement('li');
      li.className = 'fonda-lien-classe';

      const label = document.createElement('span');
      label.className = 'fonda-lien-classe__grp';
      label.textContent = lien.grp;

      const lienEl = document.createElement('a');
      lienEl.href = url;
      lienEl.textContent = url;
      lienEl.className = 'fonda-lien-classe__url';

      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.textContent = 'Copier';
      bouton.addEventListener('click', () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(() => {
            bouton.textContent = 'Copié !';
            setTimeout(() => { bouton.textContent = 'Copier'; }, 1500);
          });
        }
      });

      li.append(label, lienEl, bouton);
      liste.appendChild(li);
    });
    root.appendChild(liste);
  }

  // --- Lien élève : résout le contexte, grp hérité, jamais demandé ------------------

  function renderDefi({ classes, calendrier }) {
    const root = racineFonda();
    const defiId = param('defi');
    const resolu = window.FondaLiens.resoudreContexteDefi({ defiId, calendrier, classesAutorisees: classes });

    if (!resolu.valide) {
      // Contexte invalide (defi_id inconnu, grp hors roster, semaine/entrée
      // introuvable) -> mode entraînement : on ne fabrique rien, aucun événement.
      afficherMessage(root, 'Entraînement libre — ce lien ne correspond à aucun défi programmé.');
      return;
    }

    lancerDefi(resolu);
  }

  // Point de branchement T2 (carte-reponse-produite.js) + T3 (evenements.js). Le
  // contexte est déjà résolu et sûr (grp/notion_id/palier/set_id viennent du vrai
  // calendrier) ; il ne manque QUE le contenu réel de la carte (T6). Quand T6 existera,
  // remplacer afficherMessage(...) ci-dessous par un fetch du jeu + un appel à
  // FondaCarteReponseProduite.montrerCarteReponseProduite(...), et dans son onResultat,
  // appeler FondaEvenements.soumettreTentative({ ...contexte, reussite, scored, ... })
  // exactement comme documenté dans fonda/engine/README.md.
  function lancerDefi(contexte) {
    const root = racineFonda();
    afficherMessage(
      root,
      `Défi prêt pour la classe ${contexte.grp} (${contexte.notionId}) — contenu à venir.`,
    );
  }

  async function demarrer() {
    const [classes, referentiel, calendrier] = await Promise.all([
      chargerJSON('fonda/data/classes.json'),
      chargerJSON('fonda/data/referentiel.json'),
      chargerJSON('fonda/data/calendar.json'),
    ]);

    if (param('page') === 'niveau') {
      renderPageNiveau({ classes, calendrier, referentiel });
    } else if (param('defi')) {
      renderDefi({ classes, calendrier, referentiel });
    } else {
      afficherMessage(racineFonda(), 'Mode Box-FONDA : ouvre un lien de défi ou ajoute ?page=niveau&niveau=6e.');
    }
  }

  demarrer().catch(() => afficherMessage(racineFonda(), 'Entraînement libre — données indisponibles pour le moment.'));
})();
