// Bootstrap du mode Box-FONDA (T4) — chargé UNIQUEMENT quand ?fonda=1 (voir
// js/app.js::initFonda(), qui l'injecte dynamiquement : zéro <script> statique, donc
// zéro requête quand le flag est absent). Lecture seule des données déjà posées
// (classes.json, referentiel.json, calendar.json) — n'écrit jamais rien dans ces
// fichiers. Référence : docs/PRD-Box-FONDA.md §4, §6 ; AGENTS.md G1/G7.
//
// Ce fichier est volontairement MINCE : toute la logique métier (génération de liens,
// résolution d'un defi_id) vit dans fonda/engine/liens.js, pur et testé (18 tests,
// node --test fonda/engine/liens.test.js). Ici, uniquement du fetch + du rendu DOM,
// couverts par fonda/page/bootstrap.test.js sur un DOM factice (scripts réellement
// évalués en mode navigateur) ; rendu visuel réel à smoke-tester en navigateur.
//
// Chaîne FONDA séparée de BOX (2026-10-13, PRD §2 bis) : tout ce que l'élève lit est
// du JSON COMMITÉ servi par Pages — fonda/data/catalogue-fonda.json (lots publiés,
// contrat catalogue-fonda/v1) et fonda/data/lots/<set_id>.json (lot-fonda/v1). Aucune
// lecture de Drive ni de webhook. lancerDefi() résout le lot par set_id (lien d'index,
// calendrier) ou, pour les anciens liens, par (notion, palier) via le catalogue ; il
// rend les cartes via fonda/engine/carte-reponse-produite.js (T2). Émission
// d'événements réels (T3/T5, /box-fonda-events) : chantier identifié, hors de ce
// fichier — onResultat ne pilote que la navigation interne (G2/G3).
// Dette identifiée (avec Moteur A) : deux lots nI/nF d'une même notion, même semaine,
// même classe, ont le même defi_id ; l'année du defi_id n'est pas vérifiée.
//
// G4 : seuls les lots du catalogue sont atteignables, ET seulement si leur fichier
// porte revue_carte_par_carte: true, respecte la liste blanche et a l'EMPREINTE
// SHA-256 attestée dans le catalogue (vérifiée ici avant tout affichage).

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

  // Chargement dynamique IDEMPOTENT d'un <script> — même motif que
  // js/app.js::initFonda() pour bootstrap.js lui-même (zéro <script> statique tant
  // qu'inutile). Relecture Codex PR #2 (#3) — la preuve de chargement est l'EXPORT
  // attendu sur window, jamais la simple présence d'une balise :
  //   - export déjà présent -> résolu immédiatement ;
  //   - chargement en cours -> la MÊME promesse est partagée (appels concurrents :
  //     personne ne résout avant onload) ;
  //   - onerror, ou onload sans l'export attendu -> rejet, et la promesse est
  //     oubliée pour qu'un appel ultérieur retente réellement (nouvelle balise).
  //   - délai dépassé (relecture Codex PR #2 v2, #2) -> rejet, entrée oubliée,
  //     balise retirée et callbacks tardifs neutralisés : un nouvel appel retente
  //     vraiment, au lieu de recevoir pour toujours la même promesse pendante.
  const DELAI_SCRIPT_MS = 10000;
  const chargementsEnCours = new Map();
  function chargerScript(src, nomExport, delaiMs = DELAI_SCRIPT_MS) {
    if (window[nomExport]) return Promise.resolve();
    if (chargementsEnCours.has(src)) return chargementsEnCours.get(src);
    const promesse = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      let regle = false;
      const minuteur = setTimeout(() => {
        terminer(() => reject(new Error(`fonda: délai dépassé pour ${src}`)));
        s.onload = null;
        s.onerror = null;
        if (typeof s.remove === 'function') s.remove();
      }, delaiMs);
      function terminer(action) {
        if (regle) return; // callback tardif après expiration (ou l'inverse) : ignoré
        regle = true;
        clearTimeout(minuteur);
        action();
      }
      s.src = src;
      s.onload = () => terminer(() => {
        if (window[nomExport]) resolve();
        else reject(new Error(`fonda: ${src} chargé sans exposer ${nomExport}`));
      });
      s.onerror = () => terminer(() => reject(new Error('fonda: chargement impossible de ' + src)));
      document.head.appendChild(s);
    }).catch((err) => { chargementsEnCours.delete(src); throw err; });
    chargementsEnCours.set(src, promesse);
    return promesse;
  }

  // Graphe COMPLET des dépendances navigateur (relecture Codex PR #2, #2) :
  //   evenements.js (parserDefiId/grpEstAutorise, fonctions pures — son chargement
  //   n'émet rien : l'émission réelle exige un appel explicite, absent ici) -> liens.js
  //   (capture FondaEvenements À L'ÉVALUATION) ; correction.js -> carte-reponse-
  //   produite.js (lit FondaCorrection À L'ÉVALUATION). await séquentiel, pas
  //   Promise.all, pour garantir cet ordre. Appelée en tête de demarrer(), AVANT tout
  //   usage de FondaLiens (page niveau, lien défi) — plus seulement dans lancerDefi().
  // ?v=2 (chaîne FONDA séparée, 2026-10-13) : invalide les copies en cache de la
  // version qui lisait lots-fonda-calibration/ (fichiers déplacés vers lots/).
  async function chargerDependancesFonda() {
    await chargerScript('fonda/engine/catalogue.js?v=2', 'FondaCatalogue');
    await chargerScript('fonda/engine/evenements.js?v=2', 'FondaEvenements');
    await chargerScript('fonda/engine/liens.js?v=2', 'FondaLiens');
    await chargerScript('fonda/engine/correction.js?v=2', 'FondaCorrection');
    await chargerScript('fonda/engine/carte-reponse-produite.js?v=2', 'FondaCarteReponseProduite');
  }

  // En-tête commun (lockup logo+signature + retour BOX) — thème sombre, posé par
  // css/style.css (.fonda-lockup/.fonda-sign/.fonda-header__back). Chantier visuel
  // uniquement (docs/box-fonda-design/BRIEF.md) : navigation plein-rechargement,
  // pas de repaint en place — cohérent avec App.goFonda() côté BOX.
  function construireHeader() {
    const header = document.createElement('div');
    header.className = 'fonda-header';

    const lockup = document.createElement('div');
    lockup.className = 'fonda-lockup fonda-lockup--compact';
    const logo = document.createElement('img');
    logo.className = 'fonda-lockup__logo';
    logo.src = 'img/box-logo.png';
    logo.alt = 'BOX';
    // Deux lignes, structure EXACTE du lockup de référence (relecture Codex #10) :
    // l1 "À FOND", l2 "FOND[A]!" — jamais fusionnées sur une seule ligne.
    const sign = document.createElement('span');
    sign.className = 'fonda-sign';

    const l1 = document.createElement('span');
    l1.className = 'l1';
    const trav = document.createElement('span');
    trav.className = 'trav';
    trav.textContent = 'À';
    const fond1 = document.createElement('span');
    fond1.className = 'fond';
    fond1.textContent = 'FOND';
    l1.append(trav, fond1);

    const l2 = document.createElement('span');
    l2.className = 'l2';
    const fond2 = document.createElement('span');
    fond2.className = 'fond';
    fond2.textContent = 'FOND';
    const card = document.createElement('span');
    card.className = 'card';
    card.textContent = 'A';
    const bang = document.createElement('span');
    bang.className = 'bang';
    bang.textContent = '!';
    l2.append(fond2, card, bang);

    sign.append(l1, l2);
    lockup.append(logo, sign);

    const retour = document.createElement('a');
    retour.className = 'fonda-header__back';
    retour.href = window.location.pathname;
    retour.textContent = '← Retour à BOX';

    header.append(lockup, retour);
    return header;
  }

  function afficherMessage(root, texte) {
    root.innerHTML = '';
    root.appendChild(construireHeader());
    const p = document.createElement('p');
    p.className = 'fonda-message';
    p.textContent = texte;
    root.appendChild(p);
  }

  const NIVEAUX_DEFAUT = ['6e', '5e', '4e', '3e'];

  // Un niveau n'est valide que s'il figure dans les 4 niveaux par défaut OU dans les
  // défis réellement programmés cette semaine — jamais une valeur URL arbitraire
  // (relecture Codex #6 : une valeur invalide ne doit jamais être persistée ni
  // utilisée pour chercher des défis).
  function niveauEstValide(niveau, semaineEntry) {
    if (NIVEAUX_DEFAUT.includes(niveau)) return true;
    return !!(semaineEntry && Array.isArray(semaineEntry.entrees)
      && semaineEntry.entrees.some((e) => e && e.niveau_cible === niveau));
  }

  // Lien de sortie du "niveau mémorisé" (relecture Codex #6) : sans lui, une fois un
  // niveau choisi, rien ne permettait d'en choisir un autre (revenir à BOX puis
  // recliquer le switch ramenait directement au même niveau, via localStorage).
  function construireLienChangerNiveau(semaineParam) {
    const lien = document.createElement('a');
    lien.className = 'fonda-header__back';
    const params = new URLSearchParams();
    params.set('fonda', '1');
    params.set('page', 'niveau');
    if (semaineParam) params.set('semaine', semaineParam);
    lien.href = `${window.location.pathname}?${params.toString()}`;
    lien.textContent = 'Changer de niveau';
    return lien;
  }

  // Sélecteur de niveau — remplace l'ancien message d'erreur "Niveau manquant" :
  // le switch BOX->FONDA (App.goFonda()) atterrit ici tant qu'aucun niveau n'a
  // encore été choisi (localStorage vide). Niveaux proposés dérivés de la semaine
  // courante si elle a des défis programmés, sinon les 4 niveaux par défaut.
  function rendreSelecteurNiveau(root, { semaineEntry, semaineParam } = {}) {
    root.innerHTML = '';
    root.appendChild(construireHeader());

    const niveaux = semaineEntry && Array.isArray(semaineEntry.entrees) && semaineEntry.entrees.length > 0
      ? Array.from(new Set(semaineEntry.entrees.map((e) => e && e.niveau_cible).filter(Boolean)))
      : NIVEAUX_DEFAUT;

    const bloc = document.createElement('div');
    bloc.className = 'fonda-niveau-picker';

    const titre = document.createElement('p');
    titre.className = 'fonda-niveau-picker__titre';
    titre.textContent = 'Quel niveau ?';
    bloc.appendChild(titre);

    const grille = document.createElement('div');
    grille.className = 'fonda-niveau-picker__grille';
    const base = window.location.pathname;
    niveaux.forEach((niveau) => {
      const lien = document.createElement('a');
      lien.className = 'fonda-niveau-picker__bouton';
      lien.textContent = niveau;
      const params = new URLSearchParams();
      params.set('fonda', '1');
      params.set('page', 'niveau');
      params.set('niveau', niveau);
      if (semaineParam) params.set('semaine', semaineParam);
      lien.href = `${base}?${params.toString()}`;
      grille.appendChild(lien);
    });
    bloc.appendChild(grille);

    root.appendChild(bloc);
    root.appendChild(construireLienIndex());
  }

  // Lien vers l'index d'entraînement libre (page=entrainement, chantier
  // feat/box-fonda-index — remplace l'ancien lien vers UN SEUL paquet de démo) — sur
  // le sélecteur ET sur les pages niveau sans défi programmé (relecture Codex PR #2,
  // #11 : sinon, une fois un niveau mémorisé, le switch BOX->FONDA n'y menait plus
  // jamais tant que le calendrier est vide).
  function construireLienIndex(texte = 'S\'entraîner librement — toutes les notions') {
    const lien = document.createElement('a');
    lien.className = 'fonda-header__back';
    const params = new URLSearchParams();
    params.set('fonda', '1');
    params.set('page', 'entrainement');
    lien.href = `${window.location.pathname}?${params.toString()}`;
    lien.textContent = texte;
    return lien;
  }

  // Attente BORNÉE (relecture Codex PR #2, #5) : une dépendance ou un fetch qui ne
  // répond jamais ne doit pas laisser l'élève devant un « Chargement… » éternel —
  // passé ce délai, la promesse est rejetée et le .catch appelant affiche un message.
  const DELAI_CHARGEMENT_MS = 15000;
  function avecDelai(promesse, ms) {
    let minuteur;
    const delai = new Promise((_, reject) => {
      minuteur = setTimeout(() => reject(new Error('fonda: délai de chargement dépassé')), ms);
    });
    return Promise.race([promesse, delai]).finally(() => clearTimeout(minuteur));
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
    const semaineParam = param('semaine');
    const semaineEntry = semaineParam
      ? trouverSemaineParNumero(calendrier, semaineParam.replace(/^.*?w/i, ''))
      : semaineCourante(calendrier, new Date());

    // Pas de niveau connu, ou valeur invalide (relecture Codex #6) : sélecteur
    // (remplace l'ancien message d'erreur), pas une impasse — c'est la cible du
    // switch BOX->FONDA tant que localStorage est vide ou contient une valeur
    // qui ne correspond plus à rien.
    if (!niveau || !niveauEstValide(niveau, semaineEntry)) { rendreSelecteurNiveau(root, { semaineEntry, semaineParam }); return; }

    // Niveau choisi (et validé ci-dessus) : on le retient (persistance du choix,
    // brief §5) pour que le switch BOX->FONDA y revienne directement la prochaine
    // fois. Jamais une valeur non validée (cf. niveauEstValide ci-dessus).
    try { localStorage.setItem('box_fonda_niveau', niveau); } catch { /* repli silencieux, G2 */ }

    if (!semaineEntry) {
      afficherMessage(root, 'Aucun défi programmé cette semaine.');
      root.appendChild(construireLienChangerNiveau(semaineParam));
      root.appendChild(construireLienIndex());
      return;
    }

    const entreesNiveau = (semaineEntry.entrees || []).filter((e) => e && e.niveau_cible === niveau);
    if (entreesNiveau.length === 0) {
      afficherMessage(root, `Aucun défi programmé pour ${niveau} cette semaine.`);
      root.appendChild(construireLienChangerNiveau(semaineParam));
      root.appendChild(construireLienIndex());
      return;
    }

    const annee = String(new Date(semaineEntry.du + 'T00:00:00').getFullYear());
    const liens = window.FondaLiens.genererLiensNiveau({
      niveau, annee, semaine: String(semaineEntry.iso_week),
      entreesNiveau, classesAutorisees: classes,
    });

    root.innerHTML = '';
    root.appendChild(construireHeader());
    root.appendChild(construireLienChangerNiveau(semaineParam));
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

  // G4 — LISTE FERMÉE = fonda/data/catalogue-fonda.json (contrat catalogue-fonda/v1,
  // fonda/engine/catalogue.js), commité et relu en PR : seuls les lots qui y figurent
  // sont atteignables, ni par lien ni par URL bricolée (les lots non relus de
  // lots-fonda-calibration/ n'y sont jamais). Aucune lecture de Drive ni de webhook.
  const CHEMIN_CATALOGUE = 'fonda/data/catalogue-fonda.json';

  async function chargerCatalogue() {
    const catalogue = await chargerJSON(CHEMIN_CATALOGUE);
    const v = window.FondaCatalogue.validerCatalogue(catalogue);
    if (!v.valide) throw new Error('fonda: catalogue non conforme');
    return catalogue;
  }

  // Chemin du fichier d'un lot PUBLIÉ. Pure, testable. null pour toute entrée absente
  // ou non conforme ; le chemin vient de l'entrée (fichier = exactement
  // lots/<set_id>.json, vérifié ici ET par validerCatalogue) — jamais d'interpolation
  // d'un paramètre d'URL.
  function cheminLot(entree) {
    if (!entree || typeof entree.set_id !== 'string' || entree.fichier !== `lots/${entree.set_id}.json`) return null;
    return `fonda/data/${entree.fichier}`;
  }

  // Défense en profondeur G4 (décision Éric) : la liste fermée ci-dessus ferme l'accès
  // par URL, mais la VRAIE barrière est le drapeau de relecture lu dans la donnée au
  // moment du rendu — un lot retombé à false (ou sans drapeau) n'est jamais affiché,
  // même s'il figure dans la liste. Le nom du relecteur ne tient jamais lieu de statut.
  function lotEstPubliable(lot) {
    return !!lot && lot.revue_carte_par_carte === true;
  }

  // Validation STRUCTURELLE du lot ENTIER avant la première carte (relecture Codex
  // PR #2, #9) : une carte malformée en milieu de paquet ne doit jamais casser une
  // transition "Carte suivante" hors de toute chaîne de promesses. Tout ou rien.
  const PROFILS_CONNUS = ['sens', 'numerique', 'exact', 'orthographe'];
  function lotEstBienForme(lot) {
    return !!lot && Array.isArray(lot.cartes) && lot.cartes.length > 0
      && lot.cartes.every((c) => !!c && typeof c === 'object'
        && typeof c.question === 'string' && c.question.trim() !== ''
        && PROFILS_CONNUS.includes(c.profil_correction)
        && Array.isArray(c.reponses_acceptees) && c.reponses_acceptees.length > 0
        // Relecture Codex PR #2 v2, #4 : chaque réponse = texte non vide ou nombre
        // fini (un objet sans toString plantait au clic sur « Valider ») ; types des
        // paramètres optionnels vérifiés aussi.
        && c.reponses_acceptees.every((r) => (typeof r === 'string' && r.trim() !== '')
          || (typeof r === 'number' && Number.isFinite(r)))
        && (c.unite == null || typeof c.unite === 'string')
        // Bornes IDENTIQUES à correction.js::arrondiValide (0..10) : au-delà, le
        // correcteur ignorerait l'arrondi en silence (règle pédagogique changée).
        && (c.arrondi == null || (Number.isInteger(c.arrondi) && c.arrondi >= 0 && c.arrondi <= 10))
        && (c.seconde_chance == null || typeof c.seconde_chance === 'boolean'));
  }

  // Adapte une carte (lot-fonda/v1) vers la forme attendue par
  // FondaCarteReponseProduite.montrerCarteReponseProduite(). Pure, testable.
  //
  // "relecteur" : lu UNIQUEMENT dans l'entrée ATTESTÉE du catalogue
  // (entree.relecteur.nom_affiche) — jamais dans le fichier du lot, jamais déduit de la
  // matière. Le badge « relue et validée par X » est une affirmation de confiance G4
  // montrée à l'élève : elle reflète l'attestation. Repli générique SANS nom si absent.
  function adapterCarte(carteBrute, entree) {
    return {
      question: carteBrute.question,
      profil_correction: carteBrute.profil_correction,
      reponses_acceptees: carteBrute.reponses_acceptees,
      unite: carteBrute.unite,
      // Paramètres pédagogiques lus par carte-reponse-produite.js (relecture Codex
      // PR #2, #6) — les perdre ici changeait silencieusement la correction.
      arrondi: carteBrute.arrondi,
      seconde_chance: carteBrute.seconde_chance,
      relecteur: (entree && entree.relecteur && typeof entree.relecteur.nom_affiche === 'string'
        && entree.relecteur.nom_affiche.trim()) || 'un professeur',
    };
  }

  // Rendu d'un paquet de cartes, une à la fois, via le composant T2 — "Carte
  // suivante" après chaque résultat, écran de fin en bout de paquet. `contexte.grp`
  // optionnel (présent pour un vrai défi de classe résolu par calendrier, absent
  // pour un paquet d'entraînement libre).
  function rendrePaquetCartes(root, lot, contexte, entree) {
    root.innerHTML = '';
    root.appendChild(construireHeader());

    // Entraînement libre (pas de grp) : retour vers l'index des notions.
    const libre = !(contexte && contexte.grp);
    if (libre) root.appendChild(construireLienIndex('← Toutes les notions'));

    const titre = document.createElement('h2');
    titre.textContent = libre ? lot.notion : `Défi ${lot.notion} — classe ${contexte.grp}`;
    root.appendChild(titre);

    const compteur = document.createElement('p');
    compteur.className = 'fonda-message';
    root.appendChild(compteur);

    const carteHost = document.createElement('div');
    root.appendChild(carteHost);

    const suivant = document.createElement('button');
    suivant.type = 'button';
    suivant.className = 'fonda-valider fonda-carte-suivante';
    suivant.textContent = 'Carte suivante →';
    suivant.style.display = 'none';
    root.appendChild(suivant);

    let index = 0;

    function afficherFin() {
      root.innerHTML = '';
      root.appendChild(construireHeader());
      const fin = document.createElement('p');
      fin.className = 'fonda-message';
      fin.textContent = `Paquet terminé — ${lot.cartes.length} carte(s) vue(s).`;
      root.appendChild(fin);
      if (libre) root.appendChild(construireLienIndex('← Toutes les notions'));
    }

    function afficherCarteCourante() {
      if (index >= lot.cartes.length) { afficherFin(); return; }
      compteur.textContent = `Carte ${index + 1} / ${lot.cartes.length}`;
      suivant.style.display = 'none';
      const carteAdaptee = adapterCarte(lot.cartes[index], entree);
      window.FondaCarteReponseProduite.montrerCarteReponseProduite(carteHost, carteAdaptee, {
        // Navigation interne uniquement — AUCUN événement émis (T3/evenements.js,
        // hors scope de ce chantier, cf. en-tête de fichier). G2/G3 intacts.
        onResultat() { suivant.style.display = ''; },
        // Correction impossible (message déjà affiché par le composant) : on laisse
        // l'élève avancer plutôt que de le bloquer sur cette carte.
        onErreur() { suivant.style.display = ''; },
      });
    }

    // Transitions protégées : même après validation du lot, une exception de rendu
    // (hors chaîne de promesses) se traduit par un message visible, jamais par une
    // ancienne carte figée avec un compteur avancé.
    function afficherCarteProtegee() {
      try { afficherCarteCourante(); } catch {
        afficherMessage(root, 'Impossible d\'afficher cette carte — réessaie plus tard.');
      }
    }

    suivant.addEventListener('click', () => { index += 1; afficherCarteProtegee(); });
    afficherCarteProtegee();
  }

  // Point de branchement T2 (carte-reponse-produite.js). Le contexte est déjà résolu
  // et sûr quand il vient du calendrier (grp/notion_id/palier viennent du vrai
  // calendrier, cf. renderDefi) ; pour un paquet d'entraînement libre, renderPageCarte()
  // construit un contexte synthétique SANS grp. Échecs de chargement (dépendances ou
  // fetch du lot) gérés visiblement, jamais une page blanche ni une exception muette.
  async function preparerLot(contexte) {
    await chargerDependancesFonda();
    const catalogue = await chargerCatalogue();
    // set_id d'abord (lien d'index, calendrier) ; compat des anciens liens
    // notion/palier : le lot publié de séquence la plus haute pour ce couple.
    const entree = window.FondaCatalogue.trouverEntree(catalogue, contexte);
    const chemin = cheminLot(entree);
    if (!chemin) return { indisponible: true };
    const lot = await chargerJSON(chemin);
    if (!lotEstPubliable(lot) || !lotEstBienForme(lot)) return { indisponible: true };
    // Le fichier servi doit être EXACTEMENT celui attesté : identité + liste blanche +
    // empreinte SHA-256 recalculée ici (Web Crypto). Sans Web Crypto : refus.
    const sha = window.FondaCatalogue.sha256WebCrypto();
    if (!sha) return { indisponible: true };
    const v = await window.FondaCatalogue.verifierLotContreEntree(lot, entree, sha);
    if (!v.valide) return { indisponible: true };
    return { lot, entree };
  }

  function lancerDefi(contexte) {
    const root = racineFonda();
    avecDelai(preparerLot(contexte), DELAI_CHARGEMENT_MS)
      .then((r) => {
        if (r.indisponible) { afficherMessage(root, 'Ce défi n\'est pas disponible.'); return; }
        rendrePaquetCartes(root, r.lot, contexte, r.entree);
      })
      .catch(() => {
        afficherMessage(root, 'Impossible de charger ce défi pour le moment — réessaie plus tard.');
      });
  }

  // --- Index d'entraînement libre --------------------------------------------------
  // Une entrée par lot PUBLIÉ de catalogue-fonda.json — DÉRIVÉE, jamais une seconde
  // liste. Indépendant du niveau de classe (le palier nI/nF est la difficulté DANS la
  // notion, cf. AGENTS.md). Chaque lien mène à page=carte&set=<set_id> -> lancerDefi() :
  // G4 + empreinte restent vérifiés au rendu, l'index ne fait qu'afficher des liens.

  // Libellés d'affichage des paliers — volontairement sobres (décision Éric) ;
  // formulation à affiner ici seulement, aucune logique n'en dépend.
  const PALIERS_LIBELLES = Object.freeze({ nI: 'Initial', nF: 'Final' });
  const ORDRE_PALIERS = { nI: 0, nF: 1 };

  // Pure, testable. Une ligne par notion (libellé/matière/ordre du référentiel, repli
  // sur l'identifiant), un lien par lot publié. Plusieurs lots publiés pour un même
  // couple notion × palier : tous listés, numérotés (Initial 1, Initial 2…).
  function construireEntreesIndex(catalogue, referentiel) {
    const notions = referentiel && Array.isArray(referentiel.notions) ? referentiel.notions : [];
    const parId = new Map(notions.filter(Boolean).map((n) => [n.id, n]));
    const lots = catalogue && Array.isArray(catalogue.lots) ? catalogue.lots : [];
    const parNotion = new Map();
    lots.forEach((e, rang) => {
      if (!parNotion.has(e.notion_id)) parNotion.set(e.notion_id, { rang, lots: [] });
      parNotion.get(e.notion_id).lots.push(e);
    });
    return [...parNotion.entries()]
      .map(([notionId, { rang, lots: lotsNotion }]) => {
        const n = parId.get(notionId) || {};
        const tries = lotsNotion.slice().sort((a, b) => (ORDRE_PALIERS[a.palier] - ORDRE_PALIERS[b.palier]) || a.set_id.localeCompare(b.set_id));
        const nbParPalier = (p) => tries.filter((e) => e.palier === p).length;
        const compteur = {};
        return {
          notionId,
          libelle: typeof n.libelle === 'string' && n.libelle ? n.libelle : notionId,
          matiere: typeof n.matiere === 'string' ? n.matiere : '',
          ordre: Number.isFinite(n.ordre) ? n.ordre : Infinity,
          rang,
          paliers: tries.map((e) => {
            compteur[e.palier] = (compteur[e.palier] || 0) + 1;
            const base = PALIERS_LIBELLES[e.palier] || e.palier;
            return { palier: e.palier, setId: e.set_id, libelle: nbParPalier(e.palier) > 1 ? `${base} ${compteur[e.palier]}` : base };
          }),
        };
      })
      .sort((a, b) => (a.ordre - b.ordre) || (a.rang - b.rang));
  }

  function hrefLot(setId) {
    const params = new URLSearchParams();
    params.set('fonda', '1');
    params.set('page', 'carte');
    params.set('set', setId);
    return `${window.location.pathname}?${params.toString()}`;
  }

  function renderPageEntrainement(referentiel, catalogue) {
    const root = racineFonda();
    root.innerHTML = '';
    root.appendChild(construireHeader());

    const titre = document.createElement('h2');
    titre.textContent = 'S\'entraîner sur les fondamentaux';
    root.appendChild(titre);

    // Regroupement par matière, dans l'ordre d'apparition après tri par `ordre`.
    const groupes = [];
    construireEntreesIndex(catalogue, referentiel).forEach((entree) => {
      let g = groupes.find((x) => x.matiere === entree.matiere);
      if (!g) { g = { matiere: entree.matiere, entrees: [] }; groupes.push(g); }
      g.entrees.push(entree);
    });

    groupes.forEach((g) => {
      if (g.matiere) {
        const h = document.createElement('h3');
        h.textContent = g.matiere.charAt(0).toUpperCase() + g.matiere.slice(1);
        root.appendChild(h);
      }
      const liste = document.createElement('ul');
      liste.className = 'fonda-liens-niveau fonda-index';
      g.entrees.forEach((entree) => {
        const li = document.createElement('li');
        li.className = 'fonda-lien-classe';
        const label = document.createElement('span');
        label.className = 'fonda-lien-classe__url';
        label.textContent = entree.libelle;
        li.appendChild(label);
        entree.paliers.forEach(({ setId, libelle }) => {
          const a = document.createElement('a');
          a.className = 'fonda-header__back fonda-index__lot';
          a.href = hrefLot(setId);
          a.textContent = libelle;
          li.appendChild(a);
        });
        liste.appendChild(li);
      });
      root.appendChild(liste);
    });
  }

  // --- Paquet d'entraînement libre (index page=entrainement -> page=carte) ---------

  function renderPageCarte() {
    const setId = param('set');
    if (setId) { lancerDefi({ grp: null, setId }); return; }
    // Compat des anciens liens page=carte&notion=…&palier=… : résolus par le catalogue.
    const notionId = param('notion');
    const palier = param('palier');
    if (!notionId || !palier) {
      afficherMessage(racineFonda(), 'Entraînement : lot manquant dans le lien.');
      return;
    }
    lancerDefi({ grp: null, notionId, palier });
  }

  async function demarrer() {
    // page=carte (paquet d'entraînement libre) : AUCUN besoin de classes/referentiel/
    // calendrier (court-circuite le Promise.all ci-dessous, qui ne sert qu'aux
    // chemins liés au calendrier/classes).
    if (param('page') === 'carte') { renderPageCarte(); return; }

    // page=entrainement (index des lots publiés) : le catalogue (indispensable, validé
    // par catalogue.js — seul script moteur chargé ici) + referentiel.json (libellés,
    // facultatif). Ni lot, ni classes, ni calendrier. Catalogue indisponible ou non
    // conforme -> message visible ; référentiel indisponible -> liste sur identifiants.
    if (param('page') === 'entrainement') {
      const catalogue = await avecDelai(
        chargerScript('fonda/engine/catalogue.js?v=2', 'FondaCatalogue').then(chargerCatalogue),
        DELAI_CHARGEMENT_MS,
      ).catch(() => null);
      if (!catalogue) { afficherMessage(racineFonda(), 'Entraînement indisponible pour le moment — réessaie plus tard.'); return; }
      const referentiel = await avecDelai(chargerJSON('fonda/data/referentiel.json'), DELAI_CHARGEMENT_MS)
        .catch(() => null);
      renderPageEntrainement(referentiel, catalogue);
      return;
    }

    // Dépendances AVANT tout usage de window.FondaLiens (page niveau avec défis,
    // lien de défi) — échec -> .catch de demarrer(), message visible.
    const [classes, referentiel, calendrier] = await avecDelai(
      chargerDependancesFonda().then(() => Promise.all([
        chargerJSON('fonda/data/classes.json'),
        chargerJSON('fonda/data/referentiel.json'),
        chargerJSON('fonda/data/calendar.json'),
      ])),
      DELAI_CHARGEMENT_MS,
    );

    if (param('page') === 'niveau') {
      renderPageNiveau({ classes, calendrier, referentiel });
    } else if (param('defi')) {
      renderDefi({ classes, calendrier, referentiel });
    } else {
      afficherMessage(racineFonda(), 'Mode Box-FONDA : ouvre un lien de défi ou ajoute ?page=niveau&niveau=6e.');
    }
  }

  // Fonctions pures exportées pour les tests Node (même motif que js/app.js) — le
  // reste (rendu DOM, fetch) n'est pas exporté, non testable en Node sans navigateur.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      cheminLot, adapterCarte, lotEstPubliable, chargerScript, avecDelai, lotEstBienForme,
      construireEntreesIndex, PALIERS_LIBELLES, hrefLot,
    };
  }

  demarrer().catch(() => afficherMessage(racineFonda(), 'Entraînement libre — données indisponibles pour le moment.'));

  // Prise en charge signalée à js/app.js::initFonda() (relecture Codex PR #2 v2, #1) :
  // posé en DERNIER, donc seulement si toute l'évaluation synchrone a réussi — à
  // partir d'ici, ce sont les délais et messages de ce fichier qui s'appliquent.
  window.FondaBootstrapActif = true;
})();
