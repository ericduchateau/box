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

  // Insère UNE balise <script> (integrity + crossorigin posés AVANT insertion quand
  // demandé) ; résout à onload, rejette sur onerror ou délai (balise retirée,
  // callbacks tardifs neutralisés).
  function insererScript(src, { integrite = null, delaiMs = DELAI_SCRIPT_MS } = {}) {
    return new Promise((resolve, reject) => {
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
      if (integrite) {
        s.integrity = integrite;
        s.crossOrigin = 'anonymous';
      }
      s.src = src;
      s.onload = () => terminer(resolve);
      s.onerror = () => terminer(() => reject(new Error('fonda: chargement impossible de ' + src)));
      document.head.appendChild(s);
    });
  }

  function chargerScript(src, nomExport, delaiMs = DELAI_SCRIPT_MS) {
    if (window[nomExport]) return Promise.resolve();
    if (chargementsEnCours.has(src)) return chargementsEnCours.get(src);
    const promesse = insererScript(src, { delaiMs })
      .then(() => {
        if (!window[nomExport]) throw new Error(`fonda: ${src} chargé sans exposer ${nomExport}`);
      })
      .catch((err) => { chargementsEnCours.delete(src); throw err; });
    chargementsEnCours.set(src, promesse);
    return promesse;
  }

  // --- Moteur de correction élève versionné (CDC relecture §4.1, §4.3) ------------
  // obtenirMoteur(version, sha256) :
  //   1. AVANT tout chargement, et pour CHAQUE demande (y compris deux premières
  //      demandes simultanées) : concordance avec fonda/engine/moteurs.json — une
  //      version ne correspond qu'à UNE empreinte ; sinon refus, aucune balise ;
  //   2. une seule promesse partagée par clé version:sha256, oubliée en cas d'échec
  //      (une nouvelle demande recharge réellement) ;
  //   3. <script> avec SRI = "sha256-" + base64(cette empreinte) ;
  //   4. origine connue : une version déjà présente dans FondaMoteurs sans avoir été
  //      chargée par CE chargeur sous cette SRI -> refus ;
  //   5. instance = FondaMoteurs[version].creerMoteur() ; instance.version === version.
  const CHEMIN_REGISTRE_MOTEURS = 'fonda/engine/moteurs.json';
  const VERSION_MOTEUR_RE = /^v[1-9][0-9]*$/;
  const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
  const moteursEnCours = new Map(); // cle -> promesse
  const moteursChargesSousSri = new Set(); // cles dont la balise SRI a été chargée par ce chargeur
  let registreMoteurs = null;

  function chargerRegistreMoteurs() {
    if (!registreMoteurs) {
      registreMoteurs = chargerJSON(CHEMIN_REGISTRE_MOTEURS).catch((e) => { registreMoteurs = null; throw e; });
    }
    return registreMoteurs;
  }

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function sriDepuisHex(hex) {
    const o = [];
    for (let i = 0; i < hex.length; i += 2) o.push(parseInt(hex.slice(i, i + 2), 16));
    let out = '';
    for (let i = 0; i < o.length; i += 3) {
      const n = (o[i] << 16) | ((o[i + 1] || 0) << 8) | (o[i + 2] || 0);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
        + (i + 1 < o.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < o.length ? B64[n & 63] : '=');
    }
    return 'sha256-' + out;
  }

  function registreGlobal() {
    const d = Object.getOwnPropertyDescriptor(window, 'FondaMoteurs');
    if (!d) return null;
    if (d.writable || d.configurable || !d.value || Object.getPrototypeOf(d.value) !== null) throw new Error('fonda: registre FondaMoteurs incompatible');
    return d.value;
  }

  async function obtenirMoteur(version, sha256) {
    if (!VERSION_MOTEUR_RE.test(version || '') || !SHA256_HEX_RE.test(sha256 || '')) throw new Error('fonda: moteur demandé invalide');
    const registre = await chargerRegistreMoteurs();
    const ligne = Array.isArray(registre) ? registre.filter((l) => l && l.version === version) : [];
    if (ligne.length !== 1 || ligne[0].sha256 !== sha256 || ligne[0].sri !== sriDepuisHex(sha256)
      || ligne[0].fichier !== `fonda/engine/moteur-correction-${version}.js`) {
      throw new Error(`fonda: moteur ${version} inconnu ou empreinte discordante`);
    }
    const cle = `${version}:${sha256}`;
    if (!moteursEnCours.has(cle)) {
      const r = registreGlobal();
      if (r && Object.prototype.hasOwnProperty.call(r, version) && !moteursChargesSousSri.has(cle)) {
        throw new Error(`fonda: moteur ${version} déjà présent sans avoir été chargé sous cette SRI`);
      }
      // La promesse mise en cache couvre TOUT le chargement : balise SRI, puis export
      // présent dans le registre. Tout échec purge la clé (une nouvelle demande
      // recharge réellement, nouvelle balise).
      const promesse = insererScript(ligne[0].fichier, { integrite: ligne[0].sri })
        .then(() => {
          moteursChargesSousSri.add(cle);
          const reg = registreGlobal();
          const fabrique = reg && Object.prototype.hasOwnProperty.call(reg, version) ? reg[version] : null;
          if (!fabrique || typeof fabrique.creerMoteur !== 'function') throw new Error(`fonda: moteur ${version} chargé sans exposer FondaMoteurs.${version}`);
          return fabrique;
        })
        .catch((err) => { if (moteursEnCours.get(cle) === promesse) moteursEnCours.delete(cle); throw err; });
      moteursEnCours.set(cle, promesse);
    }
    const enCours = moteursEnCours.get(cle);
    const fabrique = await enCours;
    let instance;
    try {
      instance = fabrique.creerMoteur();
      if (!instance || instance.version !== version) throw new Error(`fonda: instance.version ≠ ${version}`);
    } catch (err) {
      if (moteursEnCours.get(cle) === enCours) moteursEnCours.delete(cle);
      throw err;
    }
    return instance;
  }

  // Graphe COMPLET des dépendances navigateur (relecture Codex PR #2, #2) :
  //   evenements.js (parserDefiId/grpEstAutorise, fonctions pures — son chargement
  //   n'émet rien : l'émission réelle exige un appel explicite, absent ici) -> liens.js
  //   (capture FondaEvenements À L'ÉVALUATION) ; carte-reponse-produite.js (purement
  //   présentationnel, ne lit aucun global : le moteur est chargé à part, par version
  //   et SRI, une fois l'entrée du lot résolue). await séquentiel, pas Promise.all. Appelée en tête de demarrer(), AVANT tout
  //   usage de FondaLiens (page niveau, lien défi) — plus seulement dans lancerDefi().
  // ?v=4 (intérim, CDC r9 : badge « relue_par_secours » au catalogue et sur la carte) ; ?v=3
  // (moteur versionné, M1) : invalide les copies en cache — l'ancien catalogue.js
  // refuserait le champ « moteur » des entrées.
  async function chargerDependancesFonda() {
    await chargerScript('fonda/engine/catalogue.js?v=4', 'FondaCatalogue');
    await chargerScript('fonda/engine/evenements.js?v=3', 'FondaEvenements');
    await chargerScript(CHEMIN_LIENS, 'FondaLiens');
    await chargerScript('fonda/engine/carte-reponse-produite.js?v=4', 'FondaCarteReponseProduite');
  }

  // ?v=4 (calendrier v2 : bandes, entrées planifiées sans lien) : invalide l'ancien
  // liens.js en cache, qui fabriquerait un lien pour une entrée sans set_id.
  const CHEMIN_LIENS = 'fonda/engine/liens.js?v=4';

  // Accueil « Notions de la semaine » et page calendrier : ni carte ni moteur.
  async function chargerDependancesCalendrier() {
    await chargerScript('fonda/engine/catalogue.js?v=4', 'FondaCatalogue');
    await chargerScript('fonda/engine/evenements.js?v=3', 'FondaEvenements');
    await chargerScript(CHEMIN_LIENS, 'FondaLiens');
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
  // `accueil: true` : porte de l'accueil « Notions de la semaine » (liens ?fonda=1&niveau=…)
  // au lieu de la page niveau ; toujours les 4 niveaux par défaut.
  function rendreSelecteurNiveau(root, { semaineEntry, semaineParam, accueil = false } = {}) {
    root.innerHTML = '';
    root.appendChild(construireHeader());

    // Calendrier v2 : une entrée de bande (sans niveau_cible) vaut pour chacun de ses niveaux.
    const niveauxProgrammes = !accueil && semaineEntry && Array.isArray(semaineEntry.entrees)
      ? Array.from(new Set(semaineEntry.entrees.flatMap((e) => {
        if (!e) return [];
        if (e.niveau_cible) return [e.niveau_cible];
        return window.FondaLiens ? window.FondaLiens.niveauxDeLaBande(e.bande) : [];
      })))
      : [];
    const niveaux = niveauxProgrammes.length > 0 ? niveauxProgrammes : NIVEAUX_DEFAUT;

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
      if (!accueil) params.set('page', 'niveau');
      params.set('niveau', niveau);
      if (semaineParam && !accueil) params.set('semaine', semaineParam);
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

  // `options` transmis à fetch : { cache: 'no-cache' } pour les données qui changent
  // à chaque publication (calendrier, catalogue) — une fiche publiée s'affiche aussitôt.
  async function chargerJSON(chemin, options) {
    const resp = options ? await fetch(chemin, options) : await fetch(chemin);
    if (!resp.ok) throw new Error('fonda: lecture impossible de ' + chemin);
    return resp.json();
  }

  // Semaine du calendrier qui couvre aujourd'hui : MÊME règle que l'accueil (etatDuJour :
  // jour à Paris, vacances prioritaires, semaine du lundi au dimanche ou jusqu'à `au`
  // s'il est plus tardif). Lecture seule, aucune occurrence fabriquée.
  function semaineCourante(calendrier, maintenant) {
    const etat = etatDuJour(calendrier, maintenant);
    return etat.type === 'semaine' ? etat.semaine : null;
  }

  function trouverSemaineParNumero(calendrier, numero) {
    const semaines = Array.isArray(calendrier.semaines) ? calendrier.semaines : [];
    return semaines.find((s) => Number(s.iso_week) === Number(numero)) || null;
  }

  // --- Page par niveau : un lien par classe, par défi programmé cette semaine -------

  function renderPageNiveau({ classes, calendrier, catalogue }) {
    const publies = new Set(((catalogue && catalogue.lots) || []).filter(Boolean).map((l) => l.set_id));
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

    // niveau_cible (v1) ou bande (v2) ; une entrée planifiée (sans set_id) n'est pas un défi.
    const entreesNiveau = (semaineEntry.entrees || []).filter(
      (e) => window.FondaLiens.entreeConcerneNiveau(e, niveau) && window.FondaLiens.entreeALien(e) && publies.has(e.set_id),
    );
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
  const CHEMIN_CALENDRIER = 'fonda/data/calendar.json';
  const SANS_CACHE = Object.freeze({ cache: 'no-cache' });

  async function chargerCatalogue() {
    const catalogue = await chargerJSON(CHEMIN_CATALOGUE, SANS_CACHE);
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

  // Validation du lot ENTIER avant la première carte (relecture Codex PR #2, #9) : une
  // carte malformée en milieu de paquet ne doit jamais casser une transition « Carte
  // suivante » hors de toute chaîne de promesses. Tout ou rien. Les règles dépendant
  // du profil et de l'arrondi sont celles du MOTEUR DU LOT (CDC §4.2 : valider).
  function lotEstBienForme(lot, moteur) {
    return !!lot && Array.isArray(lot.cartes) && lot.cartes.length > 0
      && lot.cartes.every((c) => moteur.valider(c).valide === true);
  }

  // Badge élève (CDC §12) : LU UNIQUEMENT dans l'entrée ATTESTÉE du catalogue
  // ({ forme, nom_affiche, id }, validé par validerCatalogue) — jamais dans le fichier
  // du lot, jamais déduit de la matière. Repli générique SANS nom si absent.
  const BADGE_SANS_NOM = Object.freeze({ forme: 'relue_par', nom_affiche: 'un professeur', id: null });
  function badgeDepuisEntree(entree) {
    const r = entree && entree.relecteur;
    return (r && typeof r.nom_affiche === 'string' && r.nom_affiche.trim()) ? r : BADGE_SANS_NOM;
  }

  // Rendu d'un paquet de cartes, une à la fois, via le composant T2 — "Carte
  // suivante" après chaque résultat, écran de fin en bout de paquet. `contexte.grp`
  // optionnel (présent pour un vrai défi de classe résolu par calendrier, absent
  // pour un paquet d'entraînement libre).
  function rendrePaquetCartes(root, lot, contexte, entree, moteur) {
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
      window.FondaCarteReponseProduite.montrerCarteReponseProduite(carteHost, {
        moteur,
        carte: moteur.preparerCarte(lot.cartes[index]),
        badge: badgeDepuisEntree(entree),
        // Navigation interne uniquement — AUCUN événement émis (T3/evenements.js,
        // hors scope de ce chantier, cf. en-tête de fichier). G2/G3 intacts.
        // E1 (CDC §4.2) : « Carte suivante » seulement quand le moteur déclare la carte
        // terminée (pas pendant une seconde chance ouverte) ; issue « erreur » comprise.
        onResultat(r) { if (r.carte_terminee === true) suivant.style.display = ''; },
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
    if (!chemin || !entree.moteur) return { indisponible: true };
    // Moteur DU LOT (CDC §4.3), par version + SRI, l'entrée étant résolue : échec ->
    // « pas disponible ».
    let moteur;
    try { moteur = await obtenirMoteur(entree.moteur.version, entree.moteur.sha256); } catch { return { indisponible: true }; }
    const lot = await chargerJSON(chemin);
    if (!lotEstPubliable(lot) || !lotEstBienForme(lot, moteur)) return { indisponible: true };
    // Le fichier servi doit être EXACTEMENT celui attesté : identité + liste blanche +
    // empreinte SHA-256 recalculée ici (Web Crypto). Sans Web Crypto : refus.
    const sha = window.FondaCatalogue.sha256WebCrypto();
    if (!sha) return { indisponible: true };
    const v = await window.FondaCatalogue.verifierLotContreEntree(lot, entree, sha);
    if (!v.valide) return { indisponible: true };
    return { lot, entree, moteur };
  }

  function lancerDefi(contexte) {
    const root = racineFonda();
    avecDelai(preparerLot(contexte), DELAI_CHARGEMENT_MS)
      .then((r) => {
        if (r.indisponible) { afficherMessage(root, 'Ce défi n\'est pas disponible.'); return; }
        rendrePaquetCartes(root, r.lot, contexte, r.entree, r.moteur);
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


  // --- Calendrier FONDA (calendar.json v2) : accueil « Notions de la semaine » et page
  // d'affichage par période. Fonctions de vue PURES (testées), puis rendu DOM. Une case
  // n'est un lien que si son entrée est publiée ET que son set_id figure dans le
  // catalogue chargé (double contrôle : le validateur l'impose déjà au commit). La
  // couleur LIT entree.difficulte.valeur — jamais une constante : passer aux stats
  // agrégées des cartes ne demandera que de réécrire ce champ.

  const JOUR_MS = 86400000;
  const MOIS_COURTS = ['jan', 'fév', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
  const JOURS_COURTS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
  const LIBELLES_MATIERE = Object.freeze({ maths: 'Mathématiques', 'français': 'Français' });
  const ORDRE_MATIERE = { maths: 0, 'français': 1 };
  const LIBELLES_DIFFICULTE = Object.freeze({ rouge: 'difficulté forte', ambre: 'difficulté moyenne', vert: 'difficulté faible' });
  const LIBELLES_BANDE = Object.freeze({ c3: '6e', 'c4-milieu': '5e – 4e', 'c4-fin': '3e' });
  const BANDE_DEFAUT = 'c4-milieu';
  const CLE_NIVEAU = 'box_fonda_niveau';

  // Jour du calendrier scolaire = date à Paris (collège de Lille), quel que soit le
  // fuseau de l'appareil. Repli sur la date locale si Intl ne connaît pas le fuseau.
  function jourParis(date) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
      const v = (t) => parts.find((x) => x.type === t).value;
      return `${v('year')}-${v('month')}-${v('day')}`;
    } catch {
      const p = (n) => String(n).padStart(2, '0');
      return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
    }
  }
  function couvreLeJour(s, j) {
    if (typeof s.du !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.du)) return false;
    const fin = ajouterJours(s.du, 6);
    return s.du <= j && j <= (typeof s.au === 'string' && s.au > fin ? s.au : fin);
  }
  function ajouterJours(iso, n) {
    return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * JOUR_MS).toISOString().slice(0, 10);
  }
  function partiesDate(iso) {
    const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
    return { jour: d.getUTCDate(), mois: MOIS_COURTS[d.getUTCMonth()], an: d.getUTCFullYear(), semaine: JOURS_COURTS[d.getUTCDay()] };
  }
  // « 2–6 nov », « 30 nov–4 déc »
  function plageCourte(du, au) {
    const a = partiesDate(du);
    const b = partiesDate(au);
    return a.mois === b.mois ? `${a.jour}–${b.jour} ${b.mois}` : `${a.jour} ${a.mois}–${b.jour} ${b.mois}`;
  }
  // « 2 nov 2026 »
  function dateCourte(iso) {
    const a = partiesDate(iso);
    return `${a.jour} ${a.mois} ${a.an}`;
  }

  // Où en est-on aujourd'hui ? Une semaine du calendrier court du lundi au dimanche
  // (le week-end garde les notions de la semaine). Lecture seule, rien n'est fabriqué.
  function etatDuJour(calendrier, maintenant) {
    const j = jourParis(maintenant);
    const cal = calendrier || {};
    const liste = (k) => (Array.isArray(cal[k]) ? cal[k].filter(Boolean) : []);
    const vac = liste('vacances').find((v) => v.du <= j && j <= v.au);
    if (vac) return { type: 'vacances', jour: j, vacances: vac };
    const semaine = liste('semaines').find((s) => couvreLeJour(s, j));
    const periodeDe = (id) => liste('periodes').find((p) => p.id === id) || null;
    if (semaine) return { type: 'semaine', jour: j, semaine, periode: periodeDe(semaine.periode_id) };
    const periode = liste('periodes').find((p) => p.du <= j && j <= p.au);
    if (periode) return { type: 'periode', jour: j, periode };
    return { type: 'hors', jour: j };
  }

  // Texte du bandeau « En ce moment » (tableau d'affichage, majuscules au rendu).
  function texteBandeau(etat) {
    if (etat.type === 'vacances') {
      const r = partiesDate(etat.vacances.reprise);
      return `${etat.vacances.libelle} · reprise ${r.semaine} ${r.jour} ${r.mois}`;
    }
    if (etat.type === 'semaine') return `Semaine ${etat.semaine.iso_week}${etat.periode ? ` · ${etat.periode.id} en cours` : ''}`;
    if (etat.type === 'periode') return `${etat.periode.id} en cours`;
    return 'Hors période scolaire';
  }

  // Une case = une entrée du calendrier, prête à rendre.
  function caseDepuisEntree(entree, { notions, publies }) {
    const n = notions.get(entree.notion_id) || {};
    const valeur = entree.difficulte && typeof entree.difficulte.valeur === 'string' ? entree.difficulte.valeur : null;
    const publie = entree.statut === 'publie' && typeof entree.set_id === 'string' && publies.has(entree.set_id);
    return {
      matiere: entree.matiere,
      libelleMatiere: LIBELLES_MATIERE[entree.matiere] || entree.matiere,
      notion: typeof n.libelle === 'string' && n.libelle ? n.libelle : entree.notion_id,
      palier: entree.palier,
      etoiles: entree.palier === 'nF' ? '★★' : '★',
      libellePalier: `palier ${PALIERS_LIBELLES[entree.palier] || entree.palier}`,
      difficulte: valeur,
      libelleDifficulte: LIBELLES_DIFFICULTE[valeur] || 'difficulté non évaluée',
      publie,
      setId: publie ? entree.set_id : null,
    };
  }

  function contexteCases(catalogue, referentiel) {
    const notions = new Map(((referentiel && referentiel.notions) || []).filter(Boolean).map((n) => [n.id, n]));
    const publies = new Set(((catalogue && catalogue.lots) || []).filter(Boolean).map((l) => l.set_id));
    return { notions, publies };
  }

  function casesDeLaSemaine(semaine, bande, ctx) {
    return (Array.isArray(semaine.entrees) ? semaine.entrees : [])
      .filter((e) => e && e.bande === bande)
      .slice()
      .sort((a, b) => (ORDRE_MATIERE[a.matiere] ?? 9) - (ORDRE_MATIERE[b.matiere] ?? 9))
      .map((e) => caseDepuisEntree(e, ctx));
  }

  function construireVueCalendrier({ calendrier, catalogue, referentiel, bande, maintenant }) {
    const etat = etatDuJour(calendrier, maintenant);
    const ctx = contexteCases(catalogue, referentiel);
    const semaines = Array.isArray(calendrier.semaines) ? calendrier.semaines.filter(Boolean) : [];
    const periodes = (Array.isArray(calendrier.periodes) ? calendrier.periodes.filter(Boolean) : []).map((p) => {
      const sem = semaines
        .filter((s) => s.periode_id === p.id)
        .slice()
        .sort((a, b) => a.du.localeCompare(b.du))
        .map((s) => ({
          isoWeek: s.iso_week,
          plage: plageCourte(s.du, s.au),
          courante: etat.type === 'semaine' && etat.semaine === s,
          cases: casesDeLaSemaine(s, bande, ctx),
        }))
        .filter((s) => s.cases.length > 0);
      const b = (p.bandes && p.bandes[bande]) || {};
      return {
        id: p.id,
        libelle: p.libelle,
        dates: `${dateCourte(p.du)} → ${dateCourte(p.au)}`,
        du: p.du,
        statut: etat.jour < p.du ? 'a_venir' : (etat.jour > p.au ? 'passee' : 'en_cours'),
        // Grisée en entier SEULEMENT si elle n'a aucune entrée pour cette bande ; sinon
        // affichée, les cases planifiées étant grisées une à une.
        vide: sem.length === 0,
        genere: b.genere === true,
        bilan: typeof b.bilan === 'string' ? b.bilan : '',
        justification: typeof b.justification === 'string' ? b.justification : '',
        semaines: sem,
      };
    });
    return { bande, bandeau: texteBandeau(etat), etat, periodes };
  }

  // Accueil : les 2 fiches de la semaine courante ; en vacances, celles de la reprise.
  function notionsDeLaSemaine({ calendrier, catalogue, referentiel, bande, maintenant }) {
    const etat = etatDuJour(calendrier, maintenant);
    const ctx = contexteCases(catalogue, referentiel);
    let semaine = null;
    let reprise = false;
    if (etat.type === 'semaine') {
      semaine = etat.semaine;
    } else if (etat.type === 'vacances') {
      semaine = (Array.isArray(calendrier.semaines) ? calendrier.semaines.filter(Boolean) : [])
        .filter((s) => s.du >= etat.vacances.reprise)
        .sort((a, b) => a.du.localeCompare(b.du))[0] || null;
      reprise = !!semaine && semaine.du === etat.vacances.reprise;
      if (!reprise) semaine = null;
    }
    return {
      bandeau: texteBandeau(etat),
      etat,
      reprise,
      semaine: semaine ? { isoWeek: semaine.iso_week, plage: plageCourte(semaine.du, semaine.au) } : null,
      cases: semaine ? casesDeLaSemaine(semaine, bande, ctx) : [],
    };
  }

  // --- Rendu ------------------------------------------------------------------------

  function el(tag, className, texte) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (texte !== undefined) e.textContent = texte;
    return e;
  }

  function hrefFonda(params) {
    const p = new URLSearchParams();
    p.set('fonda', '1');
    Object.entries(params).forEach(([k, v]) => { if (v) p.set(k, v); });
    return `${window.location.pathname}?${p.toString()}`;
  }

  function lienRetour(texte, params) {
    const a = el('a', 'fonda-header__back', texte);
    a.href = hrefFonda(params);
    return a;
  }

  // Cellules « split-flap » ; animation seulement si le navigateur la permet et que
  // l'utilisateur n'a pas demandé moins de mouvement.
  const GLYPHES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  function construireFlaps(texte) {
    const conteneur = el('span', 'fonda-flaps');
    conteneur.setAttribute('role', 'status');
    conteneur.setAttribute('aria-label', texte);
    const anime = typeof window.matchMedia === 'function'
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      && typeof window.setInterval === 'function';
    // Une cellule par caractère, regroupées par mot : le retour à la ligne ne coupe
    // jamais un mot.
    let mot = null;
    Array.from(texte.toUpperCase()).forEach((ch, i) => {
      if (ch === ' ') { mot = null; return; }
      if (!mot) {
        mot = el('span', 'fonda-flaps__mot');
        mot.setAttribute('aria-hidden', 'true');
        conteneur.appendChild(mot);
      }
      const cellule = el('span', 'fonda-flap', ch);
      mot.appendChild(cellule);
      if (!anime) return;
      const etapes = 3 + (i % 4);
      let n = 0;
      const minuterie = window.setInterval(() => {
        n += 1;
        cellule.textContent = n >= etapes ? ch : GLYPHES[Math.floor(Math.random() * GLYPHES.length)];
        if (n >= etapes) window.clearInterval(minuterie);
      }, 70);
    });
    return conteneur;
  }

  function construireBandeau(texte) {
    const bandeau = el('div', 'fonda-cal-bandeau');
    bandeau.append(el('span', 'fonda-cal-bandeau__lbl', 'En ce moment'), construireFlaps(texte));
    return bandeau;
  }

  // Tuile : lien vers le paquet si publiée, sinon case grisée sans lien. La couleur
  // n'est jamais la seule information (texte + aria-label).
  function construireTuile(c) {
    const tuile = el(c.setId ? 'a' : 'div', `fonda-cal-tuile fonda-cal-tuile--${c.difficulte || 'na'}${c.setId ? '' : ' fonda-cal-tuile--planifiee'}`);
    if (c.setId) tuile.href = hrefLot(c.setId);
    // Nom accessible = texte de la tuile (pas d'aria-label sur une div) ; les étoiles
    // sont doublées d'un texte réservé aux lecteurs d'écran.
    const etoiles = el('span', 'fonda-cal-tuile__etoiles', c.etoiles);
    etoiles.setAttribute('title', c.libellePalier);
    etoiles.setAttribute('aria-hidden', 'true');
    const pied = el('div', 'fonda-cal-tuile__pied');
    pied.append(el('span', 'fonda-cal-tuile__diff', c.libelleDifficulte), el('span', 'fonda-cal-tuile__etat', c.setId ? 'Disponible →' : 'En préparation'));
    tuile.append(
      etoiles,
      el('div', `fonda-cal-tuile__mat fonda-cal-tuile__mat--${c.matiere === 'maths' ? 'maths' : 'fr'}`, c.libelleMatiere),
      el('div', 'fonda-cal-tuile__nom', c.notion),
      el('span', 'fonda-sr', `${c.libellePalier}.`),
      pied,
    );
    return tuile;
  }

  function construireSelecteurBande(bandeActive, page) {
    const nav = el('nav', 'fonda-cal-bandes');
    nav.setAttribute('aria-label', 'Bande de niveaux');
    Object.keys(LIBELLES_BANDE).forEach((b) => {
      const a = el('a', `fonda-cal-bandes__lien${b === bandeActive ? ' fonda-cal-bandes__lien--actif' : ''}`, LIBELLES_BANDE[b]);
      a.href = hrefFonda({ page, bande: b });
      if (b === bandeActive) a.setAttribute('aria-current', 'page');
      nav.appendChild(a);
    });
    return nav;
  }

  function construireLegende() {
    const legende = el('div', 'fonda-cal-legende');
    const diff = el('span', 'fonda-cal-legende__grp');
    diff.appendChild(el('span', 'fonda-cal-legende__ttl', 'Difficulté'));
    ['rouge', 'ambre', 'vert'].forEach((v) => diff.appendChild(el('span', `fonda-cal-legende__item fonda-cal-legende__item--${v}`, LIBELLES_DIFFICULTE[v].replace('difficulté ', ''))));
    const palier = el('span', 'fonda-cal-legende__grp');
    palier.append(el('span', 'fonda-cal-legende__ttl', 'Palier'), el('span', '', '★ Initial  ★★ Final'));
    const grise = el('span', 'fonda-cal-legende__grp');
    grise.append(el('span', 'fonda-cal-legende__ttl', 'Grisé'), el('span', '', 'fiche en préparation'));
    legende.append(diff, palier, grise);
    return legende;
  }

  function construirePeriode(p, ouverte) {
    const section = el('section', `fonda-cal-periode${p.vide ? ' fonda-cal-periode--vide' : ''}`);
    const tete = el(p.vide ? 'div' : 'button', 'fonda-cal-periode__tete');
    const meta = el('div', 'fonda-cal-periode__meta');
    meta.append(el('h3', '', p.libelle), el('div', 'fonda-cal-periode__dates', p.dates));
    const TAGS = { en_cours: 'En cours', a_venir: 'À venir', passee: 'Terminée' };
    const tag = p.vide ? 'Non générée' : TAGS[p.statut];
    tete.append(el('span', 'fonda-cal-periode__no', p.id), meta, el('span', `fonda-cal-periode__tag fonda-cal-periode__tag--${p.vide ? 'vide' : p.statut}`, tag));
    section.appendChild(tete);

    if (p.vide) {
      section.appendChild(el('p', 'fonda-cal-periode__note', `À générer avant la reprise (${p.dates.split(' → ')[0]}). Les notions seront choisies d'après les bilans des périodes précédentes.`));
      return section;
    }

    const bilan = el('div', 'fonda-cal-bilan');
    bilan.appendChild(el('div', 'fonda-cal-bilan__titre', 'Bilan de période'));
    if (p.bilan) {
      bilan.appendChild(el('p', '', p.bilan));
      if (p.justification) bilan.appendChild(el('p', 'fonda-cal-bilan__justif', p.justification));
    } else {
      bilan.appendChild(el('p', 'fonda-cal-bilan__justif', 'Bilan et justification à rédiger avant la génération de la période.'));
    }
    section.appendChild(bilan);

    const semaines = el('div', 'fonda-cal-semaines');
    p.semaines.forEach((s) => {
      const ligne = el('div', `fonda-cal-semaine${s.courante ? ' fonda-cal-semaine--courante' : ''}`);
      const lbl = el('div', 'fonda-cal-semaine__lbl');
      lbl.append(el('b', '', `S${s.isoWeek}`), el('span', '', s.plage));
      const tuiles = el('div', 'fonda-cal-tuiles');
      s.cases.forEach((c) => tuiles.appendChild(construireTuile(c)));
      ligne.append(lbl, tuiles);
      semaines.appendChild(ligne);
    });
    tete.type = 'button';
    tete.setAttribute('aria-expanded', String(ouverte));
    semaines.hidden = !ouverte;
    tete.addEventListener('click', () => {
      semaines.hidden = !semaines.hidden;
      tete.setAttribute('aria-expanded', String(!semaines.hidden));
    });
    section.appendChild(semaines);
    return section;
  }

  function lireNiveauMemorise() {
    try { return localStorage.getItem(CLE_NIVEAU); } catch { return null; }
  }

  function bandeDemandee() {
    const b = param('bande');
    if (b && Object.prototype.hasOwnProperty.call(LIBELLES_BANDE, b)) return b;
    const n = lireNiveauMemorise();
    return (n && window.FondaLiens.bandeDuNiveau(n)) || BANDE_DEFAUT;
  }

  function renderPageCalendrier({ calendrier, catalogue, referentiel }) {
    const root = racineFonda();
    const bande = bandeDemandee();
    const vue = construireVueCalendrier({ calendrier, catalogue, referentiel, bande, maintenant: new Date() });
    root.innerHTML = '';
    root.appendChild(construireHeader());
    root.appendChild(lienRetour('← Notions de la semaine', {}));
    root.appendChild(construireBandeau(vue.bandeau));
    const titre = el('h2', '', 'Calendrier des fondamentaux');
    root.appendChild(titre);
    root.appendChild(el('p', 'fonda-cal-intro', 'Chaque semaine : une fiche de numératie (maths) et une de littératie (français). La couleur marque la difficulté, les étoiles le palier.'));
    root.appendChild(construireSelecteurBande(bande, 'calendrier'));
    root.appendChild(construireLegende());
    if (vue.periodes.every((p) => p.vide)) {
      root.appendChild(el('p', 'fonda-message', `Pas encore de programme pour les ${LIBELLES_BANDE[bande]}.`));
    }
    // Ouverte : la période en cours, sinon la première à venir qui a des fiches.
    const ouverte = vue.periodes.find((p) => !p.vide && p.statut === 'en_cours')
      || vue.periodes.find((p) => !p.vide && p.statut === 'a_venir');
    vue.periodes.forEach((p) => root.appendChild(construirePeriode(p, p === ouverte)));
  }

  function renderAccueil({ calendrier, catalogue, referentiel }) {
    const root = racineFonda();
    const demande = param('niveau');
    const niveau = param('choix') === 'niveau' ? null : (demande || lireNiveauMemorise());
    // Porte : sans niveau valide, le sélecteur d'abord (la vue a besoin de la bande).
    if (!niveau || !NIVEAUX_DEFAUT.includes(niveau)) { rendreSelecteurNiveau(root, { accueil: true }); return; }
    try { localStorage.setItem(CLE_NIVEAU, niveau); } catch { /* repli silencieux, G2 */ }
    const bande = window.FondaLiens.bandeDuNiveau(niveau);
    const vue = notionsDeLaSemaine({ calendrier, catalogue, referentiel, bande, maintenant: new Date() });

    root.innerHTML = '';
    root.appendChild(construireHeader());
    root.appendChild(construireBandeau(vue.bandeau));
    root.appendChild(el('h2', '', 'Notions de la semaine'));
    let sousTitre;
    if (!vue.semaine || vue.cases.length === 0) sousTitre = `Pas de fiche programmée cette semaine pour les ${LIBELLES_BANDE[bande]}.`;
    else if (vue.reprise) sousTitre = `À la reprise — semaine ${vue.semaine.isoWeek} (${vue.semaine.plage}) · ${LIBELLES_BANDE[bande]}`;
    else sousTitre = `Semaine ${vue.semaine.isoWeek} (${vue.semaine.plage}) · ${LIBELLES_BANDE[bande]}`;
    root.appendChild(el('p', 'fonda-cal-intro', sousTitre));
    if (vue.cases.length > 0) {
      const tuiles = el('div', 'fonda-cal-tuiles fonda-cal-tuiles--accueil');
      vue.cases.forEach((c) => tuiles.appendChild(construireTuile(c)));
      root.appendChild(tuiles);
    }
    // Accès enseignant direct : liens par classe de la semaine AFFICHÉE (week-end, reprise
    // après les vacances), transmise explicitement à la page niveau.
    const prof = el('a', 'fonda-cal-prof', `Défis par classe (${niveau}) — liens à partager →`);
    prof.href = hrefFonda({ page: 'niveau', niveau, semaine: vue.semaine ? String(vue.semaine.isoWeek) : null });
    root.appendChild(prof);
    const liens = el('div', 'fonda-cal-liens');
    liens.append(
      lienRetour('Voir le calendrier', { page: 'calendrier', bande }),
      lienRetour(`Changer de niveau (${niveau})`, { choix: 'niveau' }),
      construireLienIndex(),
    );
    root.appendChild(liens);
  }

  async function chargerDonneesCalendrier() {
    return avecDelai(
      chargerDependancesCalendrier().then(() => Promise.all([
        chargerJSON(CHEMIN_CALENDRIER, SANS_CACHE),
        chargerCatalogue(),
        chargerJSON('fonda/data/referentiel.json').catch(() => null),
      ])),
      DELAI_CHARGEMENT_MS,
    ).then(([calendrier, catalogue, referentiel]) => ({ calendrier, catalogue, referentiel }));
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
    // Accueil « Notions de la semaine » (?fonda=1 sans page ni défi) et page
    // d'affichage du calendrier : calendrier + catalogue + référentiel, ni lot ni classes.
    if (param('page') === 'calendrier' || (!param('page') && !param('defi'))) {
      const donnees = await chargerDonneesCalendrier().catch(() => null);
      if (!donnees) { afficherMessage(racineFonda(), 'Calendrier indisponible pour le moment — réessaie plus tard.'); return; }
      if (param('page') === 'calendrier') renderPageCalendrier(donnees);
      else renderAccueil(donnees);
      return;
    }

    if (param('page') === 'entrainement') {
      const catalogue = await avecDelai(
        chargerScript('fonda/engine/catalogue.js?v=4', 'FondaCatalogue').then(chargerCatalogue),
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
        chargerJSON(CHEMIN_CALENDRIER, SANS_CACHE),
      ])),
      DELAI_CHARGEMENT_MS,
    );

    if (param('page') === 'niveau') {
      // Défense en profondeur : seuls les set_id présents au catalogue chargé donnent
      // des liens par classe (un calendrier en retard sur un retrait n'en produit pas).
      const catalogue = await avecDelai(chargerCatalogue(), DELAI_CHARGEMENT_MS);
      renderPageNiveau({ classes, calendrier, referentiel, catalogue });
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
      semaineCourante, cheminLot, badgeDepuisEntree, lotEstPubliable, chargerScript, obtenirMoteur, sriDepuisHex, avecDelai, lotEstBienForme,
      construireEntreesIndex, PALIERS_LIBELLES, hrefLot,
      etatDuJour, texteBandeau, plageCourte, caseDepuisEntree, construireVueCalendrier, notionsDeLaSemaine,
    };
  }

  demarrer().catch(() => afficherMessage(racineFonda(), 'Entraînement libre — données indisponibles pour le moment.'));

  // Prise en charge signalée à js/app.js::initFonda() (relecture Codex PR #2 v2, #1) :
  // posé en DERNIER, donc seulement si toute l'évaluation synchrone a réussi — à
  // partir d'ici, ce sont les délais et messages de ce fichier qui s'appliquent.
  window.FondaBootstrapActif = true;
})();
