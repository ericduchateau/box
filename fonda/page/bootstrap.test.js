// Suite de tests — page mode Box-FONDA (T4), fonda/page/bootstrap.js.
// Couvre spécifiquement l'exigence : un defi_id introuvable dans calendar.json
// (expiré, faute de frappe, semaine passée non programmée) doit basculer en mode
// entraînement, SANS exception JS et SANS page blanche. Dom factice, zéro dépendance.
//
// Usage : node --test fonda/page/bootstrap.test.js

'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const CLASSES = require('../data/classes.json');
const REFERENTIEL = require('../data/referentiel.json');

const SEMAINE_41 = {
  iso_week: 41,
  du: '2026-10-05',
  au: '2026-10-11',
  entrees: [
    { notion_id: 'maths.resolution-problemes', matiere: 'maths', palier: 'nI', niveau_cible: '6e', set_id: 'box_fonda_test01' },
  ],
};
const CALENDRIER = { version: 1, last_updated: '2026-10-05', semaines: [SEMAINE_41] };

// --- DOM/fetch factices (zéro dépendance) -----------------------------------------

// textContent agrège récursivement depuis les enfants, comme un vrai DOM (nécessaire
// pour vérifier le texte de la signature à deux lignes, relecture Codex #10 — voir
// carte-reponse-produite.test.js pour le même motif).
function creerElementFactice(tag) {
  return {
    tagName: tag, className: '', href: '', src: '', type: '', style: {},
    value: '', disabled: false, autocomplete: '', dataset: {}, attributes: {},
    children: [],
    _text: '',
    classList: { add() {}, remove() {} },
    get textContent() {
      return this.children.length > 0
        ? this.children.map((c) => (c && typeof c.textContent === 'string') ? c.textContent : '').join('')
        : this._text;
    },
    set textContent(v) { this._text = v; this.children = []; },
    get innerHTML() { return this._text; },
    set innerHTML(v) { this._text = v; this.children = []; },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(n) { this.children.push(n); return n; },
    setAttribute(k, v) { this.attributes[k] = v; },
    focus() {},
    addEventListener(evt, fn) { (this._listeners = this._listeners || {})[evt] = (this._listeners[evt] || []).concat(fn); },
    __click() { ((this._listeners || {}).click || []).forEach((fn) => fn({})); },
    __keydown(key) { ((this._listeners || {}).keydown || []).forEach((fn) => fn({ key })); },
  };
}

// Chargeur de <script> RÉALISTE (relecture Codex PR #2, #10) : aucun global FONDA
// n'est pré-injecté. Chaque <script> ajouté à <head> est réellement ÉVALUÉ au tick
// suivant, en mode NAVIGATEUR (vm, sans `module` ni `require` : la branche UMD
// navigateur est celle qui s'exécute, avec ses vraies dépendances globales), puis
// onload est appelé. `echecs` (Set de chemins) simule une erreur réseau -> onerror.
// `journalScripts` reçoit chaque src injectée (ordre + absence de doublons).
const vm = require('vm');
const fsTest = require('fs');
const pathTest = require('path');

function creerDocumentFactice({ echecs = new Set(), journalScripts = [] } = {}) {
  const body = creerElementFactice('body');
  const head = creerElementFactice('head');
  head.appendChild = (el) => {
    head.children.push(el);
    if (el && el.tagName === 'script') {
      journalScripts.push(el.src);
      setTimeout(() => {
        const chemin = el.src.split('?')[0];
        if (echecs.has(chemin)) { if (typeof el.onerror === 'function') el.onerror(new Error('réseau')); return; }
        const code = fsTest.readFileSync(pathTest.join(__dirname, '..', '..', chemin), 'utf8');
        vm.runInNewContext(code, { self: global.window, window: global.window, document: global.document, console });
        if (typeof el.onload === 'function') el.onload();
      }, 0);
    }
    return el;
  };
  let root = null;
  return {
    body, head,
    createElement: (tag) => creerElementFactice(tag),
    getElementById: (id) => (id === 'fondaRoot' ? root : null),
    querySelector: () => null,
    addEventListener() {},
    _definirRoot(r) { root = r; },
  };
}

// fetch factice : classes/referentiel/calendrier de test ; pour un lot FONDA
// (fonda/data/lots-fonda-calibration/...), sert soit une fixture explicite (`lots`),
// soit, par défaut, le VRAI fichier committé (cohérent pour les tests d'intégration
// qui n'ont besoin d'aucune fixture synthétique) ; échoue sur le reste.
function creerFetchFactice({ calendrier = CALENDRIER, lots = {} } = {}) {
  return async (chemin) => {
    if (chemin.includes('classes.json')) return { ok: true, json: async () => CLASSES };
    if (chemin.includes('referentiel.json')) {
      return global.__referentielEnPanne ? { ok: false } : { ok: true, json: async () => REFERENTIEL };
    }
    if (chemin.includes('calendar.json')) return { ok: true, json: async () => calendrier };
    if (chemin.includes('lots-fonda-calibration/')) {
      if (lots[chemin]) return { ok: true, json: async () => lots[chemin] };
      try {
        const donnees = require('../' + chemin.split('fonda/')[1]);
        return { ok: true, json: async () => donnees };
      } catch { return { ok: false }; }
    }
    return { ok: false };
  };
}

async function demarrerBootstrap({ search, calendrier, lots, journalFetch, echecs, journalScripts }) {
  const doc = creerDocumentFactice({ echecs, journalScripts });
  // document.body.appendChild('fondaRoot' div) -> on l'intercepte pour pouvoir le relire
  const originalAppendChild = doc.body.appendChild.bind(doc.body);
  doc.body.appendChild = (el) => { doc._definirRoot(el); return originalAppendChild(el); };

  global.document = doc;
  global.window = { location: { search, origin: 'https://ericduchateau.github.io', pathname: '/box/index.html' } };
  const fetchFactice = creerFetchFactice({ calendrier, lots });
  global.fetch = journalFetch
    ? (chemin) => { journalFetch.push(chemin); return fetchFactice(chemin); }
    : fetchFactice;

  delete require.cache[require.resolve('./bootstrap.js')];
  require('./bootstrap.js');

  // Laisse le temps à la chaîne de promesses (fetch factice + chargement de script
  // simulé via setTimeout ci-dessus) de se dérouler avant d'inspecter le DOM factice.
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0));

  return doc.getElementById('fondaRoot');
}

describe('defi introuvable (expiré / faute de frappe / semaine non programmée) -> entraînement, jamais d\'exception, jamais de page blanche', () => {
  const casDefiIntrouvable = [
    { libelle: 'faute de frappe dans le slug', defi: 'defi_2026-w41_601_resolution-problmes' },
    { libelle: 'semaine non programmée (absente du calendrier)', defi: 'defi_2026-w52_601_resolution-problemes' },
    { libelle: 'semaine passée, jamais programmée pour ce niveau/notion', defi: 'defi_2024-w01_601_resolution-problemes' },
    { libelle: 'grp syntaxiquement correct mais hors roster', defi: 'defi_2026-w41_609_resolution-problemes' },
    { libelle: 'defi_id complètement malformé', defi: 'pas-un-defi-id' },
    { libelle: 'defi absent (paramètre manquant)', defi: undefined },
  ];

  for (const { libelle, defi } of casDefiIntrouvable) {
    test(`${libelle} -> page non blanche, aucune exception`, async () => {
      const search = defi !== undefined ? `?fonda=1&defi=${encodeURIComponent(defi)}` : '?fonda=1';
      const root = await demarrerBootstrap({ search, calendrier: CALENDRIER });
      assert.ok(root, 'un conteneur #fondaRoot doit exister');
      const texte = (root.textContent || root.children.map((c) => c.textContent).join('')).trim();
      assert.ok(texte.length > 0, `page blanche pour le cas "${libelle}"`);
    });
  }

  test('calendrier totalement vide (état réel actuel, avant Moteur A) -> entraînement, pas de page blanche', async () => {
    const calendrierVide = { version: 1, last_updated: '', semaines: [] };
    const root = await demarrerBootstrap({ search: '?fonda=1&defi=defi_2026-w41_601_resolution-problemes', calendrier: calendrierVide });
    const texte = (root.textContent || root.children.map((c) => c.textContent).join('')).trim();
    assert.ok(texte.length > 0);
  });

  test('aucune écriture localStorage n\'est tentée pour un défi introuvable (pas d\'émission T3)', async () => {
    let ecritures = 0;
    global.localStorage = { getItem: () => null, setItem: () => { ecritures += 1; } };
    await demarrerBootstrap({ search: '?fonda=1&defi=defi_2026-w52_601_resolution-problemes', calendrier: CALENDRIER });
    assert.equal(ecritures, 0);
    delete global.localStorage;
  });
});

describe('defi résolu avec succès -> page non blanche, contenu annoncé (pas de fetch de jeu réel en T4)', () => {
  test('un lien valide affiche un message exploitant le contexte résolu (grp, notion), jamais vide', async () => {
    const root = await demarrerBootstrap({ search: '?fonda=1&defi=defi_2026-w41_601_resolution-problemes', calendrier: CALENDRIER });
    const texte = (root.textContent || root.children.map((c) => c.textContent).join('')).trim();
    assert.ok(texte.length > 0);
    assert.ok(texte.includes('601'), 'le message devrait mentionner la classe résolue');
  });
});

function trouverBoutonParTexte(el, texteBouton) {
  if (!el || !el.children) return null;
  for (const c of el.children) {
    if (c && c.textContent === texteBouton) return c;
    const trouve = trouverBoutonParTexte(c, texteBouton);
    if (trouve) return trouve;
  }
  return null;
}

function texteDe(root) {
  return (root.textContent || '').trim() || root.children.map((c) => c.textContent).join(' ');
}

// --- Sélecteur de niveau (chantier visuel feat/box-fonda-theme-switch) -------------
// Remplace l'ancien message d'erreur "Niveau manquant" : c'est la cible du switch
// BOX->FONDA (App.goFonda()) tant qu'aucun niveau n'est connu (localStorage vide).

function trouverParClasse(el, classe) {
  return (el.children || []).find((c) => c && c.className === classe);
}

describe('?page=niveau SANS niveau -> sélecteur de niveau (plus l\'ancien message d\'erreur)', () => {
  test('affiche le bloc .fonda-niveau-picker avec un bouton par niveau par défaut (calendrier vide)', async () => {
    const calendrierVide = { version: 1, last_updated: '', semaines: [] };
    const root = await demarrerBootstrap({ search: '?fonda=1&page=niveau', calendrier: calendrierVide });
    const bloc = trouverParClasse(root, 'fonda-niveau-picker');
    assert.ok(bloc, 'bloc .fonda-niveau-picker absent');
    const grille = trouverParClasse(bloc, 'fonda-niveau-picker__grille');
    assert.ok(grille, 'grille de boutons absente');
    const libelles = grille.children.map((a) => a.textContent);
    assert.deepEqual(libelles, ['6e', '5e', '4e', '3e']);
    grille.children.forEach((a) => {
      assert.match(a.href, /\?fonda=1&page=niveau&niveau=\dE/i);
    });
  });

  test('ancien message "Niveau manquant" disparu : aucun fonda-message en texte brut à sa place', async () => {
    const calendrierVide = { version: 1, last_updated: '', semaines: [] };
    const root = await demarrerBootstrap({ search: '?fonda=1&page=niveau', calendrier: calendrierVide });
    const messages = (root.children || []).filter((c) => c && c.className === 'fonda-message');
    assert.equal(messages.length, 0, 'le sélecteur remplace le message, il ne doit plus apparaître');
  });

  test('niveaux proposés dérivés de la semaine courante quand elle a des défis (pas les 4 par défaut à l\'aveugle)', async () => {
    // &semaine=41 : cible explicitement SEMAINE_41 plutôt que de compter sur
    // new Date() pour tomber dans sa plage (2026-10-05..11) — sans ça, ce test
    // casse tout seul le jour où il tourne hors de cette fenêtre (relecture Codex).
    const root = await demarrerBootstrap({ search: '?fonda=1&page=niveau&semaine=41', calendrier: CALENDRIER });
    const bloc = trouverParClasse(root, 'fonda-niveau-picker');
    const grille = trouverParClasse(bloc, 'fonda-niveau-picker__grille');
    const libelles = grille.children.map((a) => a.textContent);
    assert.deepEqual(libelles, ['6e'], 'seul "6e" a un défi programmé dans CALENDRIER (SEMAINE_41)');
  });

  test('un en-tête (.fonda-lockup) est présent sur la page du sélecteur', async () => {
    const calendrierVide = { version: 1, last_updated: '', semaines: [] };
    const root = await demarrerBootstrap({ search: '?fonda=1&page=niveau', calendrier: calendrierVide });
    const header = trouverParClasse(root, 'fonda-header');
    assert.ok(header, 'en-tête .fonda-header absent');
  });

  test('la signature est en DEUX lignes distinctes "À FOND" / "FOND[A]!" (relecture Codex #10 — jamais fusionnées sur une seule ligne)', async () => {
    const calendrierVide = { version: 1, last_updated: '', semaines: [] };
    const root = await demarrerBootstrap({ search: '?fonda=1&page=niveau', calendrier: calendrierVide });
    const header = trouverParClasse(root, 'fonda-header');
    const lockup = trouverParClasse(header, 'fonda-lockup fonda-lockup--compact');
    const sign = (lockup.children || []).find((c) => c && c.className === 'fonda-sign');
    assert.ok(sign, 'span .fonda-sign absent');
    const l1 = trouverParClasse(sign, 'l1');
    const l2 = trouverParClasse(sign, 'l2');
    assert.ok(l1 && l2, 'les deux lignes l1/l2 doivent exister séparément');
    assert.equal(l1.textContent, 'ÀFOND');
    assert.equal(l2.textContent, 'FONDA!');
  });
});

describe('?page=niveau AVEC niveau -> comportement inchangé, plus la persistance du choix', () => {
  test('niveau connu : écrit le niveau dans localStorage (pour que le switch BOX->FONDA le retrouve)', async () => {
    const ecritures = [];
    global.localStorage = { getItem: () => null, setItem: (k, v) => ecritures.push([k, v]) };
    await demarrerBootstrap({ search: '?fonda=1&page=niveau&niveau=6e', calendrier: CALENDRIER });
    delete global.localStorage;
    assert.deepEqual(ecritures, [['box_fonda_niveau', '6e']]);
  });

  test('localStorage indisponible (navigation privée) : aucune exception, page toujours rendue', async () => {
    global.localStorage = { getItem() { throw new Error('indisponible'); }, setItem() { throw new Error('indisponible'); } };
    // &semaine=41 : même raison que ci-dessus, pas de dépendance à new Date().
    const root = await demarrerBootstrap({ search: '?fonda=1&page=niveau&niveau=6e&semaine=41', calendrier: CALENDRIER });
    delete global.localStorage;
    const liste = trouverParClasse(root, 'fonda-liens-niveau');
    assert.ok(liste, 'la page doit continuer de se rendre malgré le repli localStorage');
  });

  test('un lien "Changer de niveau" est présent sur la liste de défis (relecture Codex #6 — plus d\'impasse une fois un niveau choisi)', async () => {
    const root = await demarrerBootstrap({ search: '?fonda=1&page=niveau&niveau=6e&semaine=41', calendrier: CALENDRIER });
    const liens = (root.children || []).filter((c) => c && c.className === 'fonda-header__back');
    const lienChanger = liens.find((a) => a.textContent === 'Changer de niveau');
    assert.ok(lienChanger, 'lien "Changer de niveau" absent');
    assert.match(lienChanger.href, /\?fonda=1&page=niveau&semaine=41$/, 'le lien ne doit pas réutiliser le niveau actuel');
  });

  test('valeur de niveau invalide (ni niveau par défaut, ni défi programmé) : sélecteur affiché, AUCUNE écriture localStorage (relecture Codex #6)', async () => {
    const ecritures = [];
    global.localStorage = { getItem: () => null, setItem: (k, v) => ecritures.push([k, v]) };
    const root = await demarrerBootstrap({ search: '?fonda=1&page=niveau&niveau=zzz&semaine=41', calendrier: CALENDRIER });
    delete global.localStorage;
    assert.deepEqual(ecritures, [], 'une valeur invalide ne doit jamais être persistée');
    const bloc = trouverParClasse(root, 'fonda-niveau-picker');
    assert.ok(bloc, 'une valeur invalide doit retomber sur le sélecteur, pas sur un résultat basé sur elle');
  });
});

// --- Câblage des fiches FONDA (chantier feat/box-fonda-cablage) --------------------

// Récupère les fonctions pures exportées par bootstrap.js (adapterCarte, cheminLot...)
// — search '?page=carte' sans notion : demarrer() sort de façon SYNCHRONE (message
// "notion ou palier manquant"), sans aucune continuation asynchrone qui viendrait
// écrire plus tard dans le DOM factice du test suivant.
function obtenirExportsBootstrap() {
  global.document = creerDocumentFactice();
  global.window = { location: { search: '?page=carte' } };
  delete require.cache[require.resolve('./bootstrap.js')];
  return require('./bootstrap.js');
}

describe('cheminLot — convention de nommage (même motif que generer-lot-fonda.js)', () => {
  test('notion_id à points -> tirets, palier inchangé', () => {
    const { cheminLot } = obtenirExportsBootstrap();
    assert.equal(cheminLot('fr.comprendre-consigne', 'nI'), 'fonda/data/lots-fonda-calibration/fr-comprendre-consigne_nI.json');
    assert.equal(cheminLot('maths.resolution-problemes', 'nF'), 'fonda/data/lots-fonda-calibration/maths-resolution-problemes_nF.json');
  });
});

describe('adapterCarte — relecteur LU depuis la donnée, jamais déduit (décision Éric, chantier câblage)', () => {
  test('lit lot.relecteur quand il est présent', () => {
    const { adapterCarte } = obtenirExportsBootstrap();
    const carte = adapterCarte(
      { question: 'Q ?', profil_correction: 'exact', reponses_acceptees: ['R'] },
      { relecteur: 'Justine Leblanc', matiere: 'Français' },
    );
    assert.equal(carte.relecteur, 'Justine Leblanc');
  });

  test('repli générique SANS nom quand lot.relecteur est absent — ne déduit JAMAIS de matiere', () => {
    const { adapterCarte } = obtenirExportsBootstrap();
    const carte = adapterCarte(
      { question: 'Q ?', profil_correction: 'exact', reponses_acceptees: ['R'] },
      { matiere: 'Mathématiques' }, // pas de champ relecteur — ne doit PAS produire "Éric Duchateau"
    );
    assert.equal(carte.relecteur, 'un professeur');
  });

  test('repli générique aussi si "lot" lui-même est absent/null', () => {
    const { adapterCarte } = obtenirExportsBootstrap();
    const carte = adapterCarte({ question: 'Q ?', profil_correction: 'exact', reponses_acceptees: ['R'] }, null);
    assert.equal(carte.relecteur, 'un professeur');
  });

  test('transporte question/profil_correction/reponses_acceptees/unite tels quels', () => {
    const { adapterCarte } = obtenirExportsBootstrap();
    const carte = adapterCarte(
      { question: 'Combien ?', profil_correction: 'numerique', reponses_acceptees: ['8 cm', '8'], unite: 'cm', numero: 1, contexte: 'x' },
      { relecteur: 'Éric Duchateau' },
    );
    assert.equal(carte.question, 'Combien ?');
    assert.equal(carte.profil_correction, 'numerique');
    assert.deepEqual(carte.reponses_acceptees, ['8 cm', '8']);
    assert.equal(carte.unite, 'cm');
  });
});

describe('Page niveau -> lien vers l\'index d\'entraînement libre', () => {
  test('le lien est présent et pointe vers ?fonda=1&page=entrainement', async () => {
    const calendrierVide = { version: 1, last_updated: '', semaines: [] };
    const root = await demarrerBootstrap({ search: '?fonda=1&page=niveau', calendrier: calendrierVide });
    const liens = (root.children || []).filter((c) => c && c.className === 'fonda-header__back');
    const index = liens.find((a) => a.textContent === 'S\'entraîner librement — toutes les notions');
    assert.ok(index, 'lien vers l\'index absent de la page niveau');
    assert.match(index.href, /\?fonda=1&page=entrainement$/);
  });
});

describe('?page=carte — rendu réel d\'un paquet FONDA (plus de stub "contenu à venir")', () => {
  test('notion ou palier manquant dans le lien : message clair, pas de crash', async () => {
    const root = await demarrerBootstrap({ search: '?fonda=1&page=carte', calendrier: CALENDRIER });
    const texte = (root.textContent || root.children.map((c) => c.textContent).join('')).trim();
    assert.match(texte, /notion ou palier manquant/i);
  });

  test('lot introuvable (fetch échoue) : message clair, pas de page blanche', async () => {
    const root = await demarrerBootstrap({ search: '?fonda=1&page=carte&notion=inconnue.xyz&palier=nI', calendrier: CALENDRIER });
    const texte = (root.textContent || root.children.map((c) => c.textContent).join('')).trim();
    assert.ok(texte.length > 0);
    assert.doesNotMatch(texte, /contenu à venir/, 'le stub ne doit plus jamais apparaître');
  });

  test('paquet réel (fr.comprendre-consigne/nI, fichier committé) : carte 1 rendue avec son VRAI relecteur ("Justine Leblanc")', async () => {
    const root = await demarrerBootstrap({ search: '?fonda=1&page=carte&notion=fr.comprendre-consigne&palier=nI', calendrier: CALENDRIER });
    const texte = (root.textContent || '').trim() || root.children.map((c) => c.textContent).join(' ');
    assert.match(texte, /Comprendre une consigne/, 'le titre du lot doit apparaître');
    assert.match(texte, /Carte 1 \/ 6/, 'le compteur doit annoncer 6 cartes (lot réel committé)');
    assert.doesNotMatch(texte, /contenu à venir/);
    // Relecture Codex PR #2 (#10) : le nom du relecteur doit réellement s'afficher
    // (bandeau de correction, après "Valider").
    trouverBoutonParTexte(root, 'Valider').__click();
    await new Promise((r) => setTimeout(r, 0));
    assert.match(texteDe(root), /Justine Leblanc/);
  });

  test('"Carte suivante" fait avancer le paquet jusqu\'à l\'écran de fin', async () => {
    const root = await demarrerBootstrap({ search: '?fonda=1&page=carte&notion=fr.comprendre-consigne&palier=nI', calendrier: CALENDRIER });

    const trouverBouton = trouverBoutonParTexte;

    // "Valider" (carte-reponse-produite.js) doit produire un résultat pour révéler
    // "Carte suivante" — on la clique 6 fois (6 cartes dans ce lot réel) pour
    // atteindre l'écran de fin, sans jamais planter.
    for (let i = 0; i < 6; i += 1) {
      const valider = trouverBouton(root, 'Valider');
      assert.ok(valider, `bouton "Valider" absent à l'itération ${i}`);
      const suivant = trouverBouton(root, 'Carte suivante →');
      assert.ok(suivant, `bouton "Carte suivante" absent à l'itération ${i}`);
      // Relecture Codex PR #2 (#10) : "Carte suivante" n'apparaît qu'APRÈS un
      // résultat (onResultat) — supprimer ce câblage doit faire échouer ce test.
      assert.equal(suivant.style.display, 'none', `"Carte suivante" visible avant Valider (itération ${i})`);
      valider.__click();
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(suivant.style.display, '', `"Carte suivante" toujours masqué après Valider (itération ${i})`);
      suivant.__click();
      await new Promise((r) => setTimeout(r, 0));
    }

    const texteFin = (root.textContent || '').trim() || root.children.map((c) => c.textContent).join(' ');
    assert.match(texteFin, /Paquet terminé — 6 carte\(s\) vue\(s\)/);
  });
});

// --- G4 : liste fermée + drapeau de relecture vérifié au rendu (relecture Codex PR #2) ---

describe('G4 — seuls les lots relus carte par carte sont affichables', () => {
  test('LOTS_PUBLIABLES = exactement les 8 lots du lot de validation (4 notions × nI/nF)', () => {
    const { LOTS_PUBLIABLES } = obtenirExportsBootstrap();
    assert.deepEqual(LOTS_PUBLIABLES, {
      'fr.comprendre-consigne': ['nI', 'nF'],
      'fr.inference-implicite': ['nI', 'nF'],
      'maths.grandeurs-mesures': ['nI', 'nF'],
      'maths.resolution-problemes': ['nI', 'nF'],
    });
  });

  test('chaque lot de la liste fermée porte revue_carte_par_carte: true ; tous les autres fichiers du dossier restent à false', () => {
    const fs = require('fs');
    const path = require('path');
    const { cheminLot, LOTS_PUBLIABLES } = obtenirExportsBootstrap();
    const publiables = new Set();
    for (const [notion, paliers] of Object.entries(LOTS_PUBLIABLES)) {
      for (const palier of paliers) publiables.add(path.basename(cheminLot(notion, palier)));
    }
    const dossier = path.join(__dirname, '../data/lots-fonda-calibration');
    for (const f of fs.readdirSync(dossier).filter((x) => x.endsWith('.json'))) {
      const lot = JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8'));
      assert.equal(lot.revue_carte_par_carte, publiables.has(f), `drapeau inattendu pour ${f}`);
    }
  });

  test('cheminLot refuse tout couple hors liste (lot non relu, palier inconnu, traversée de chemin)', () => {
    const { cheminLot } = obtenirExportsBootstrap();
    assert.equal(cheminLot('fr.lexique', 'nI'), null, 'lot de calibration non relu');
    assert.equal(cheminLot('fr.comprendre-consigne', 'nX'), null);
    assert.equal(cheminLot('fr.comprendre-consigne', 'nI/../../referentiel.json#'), null);
    assert.equal(cheminLot('constructor', 'nI'), null, 'clé héritée du prototype');
    assert.equal(cheminLot('x', 'nI/../../referentiel.json#'), null);
  });

  test('lotEstPubliable : true strict uniquement', () => {
    const { lotEstPubliable } = obtenirExportsBootstrap();
    assert.equal(lotEstPubliable({ revue_carte_par_carte: true }), true);
    assert.equal(lotEstPubliable({ revue_carte_par_carte: false }), false);
    assert.equal(lotEstPubliable({ revue_carte_par_carte: 'true' }), false);
    assert.equal(lotEstPubliable({}), false);
    assert.equal(lotEstPubliable(null), false);
  });

  test('?page=carte sur un lot NON relu (fr.lexique) : refusé, AUCUN fetch de lot, message visible', async () => {
    const journal = [];
    const root = await demarrerBootstrap({ search: '?fonda=1&page=carte&notion=fr.lexique&palier=nI', journalFetch: journal });
    assert.equal(journal.filter((c) => c.includes('lots-fonda-calibration')).length, 0);
    assert.match(texteDe(root), /pas disponible/);
    assert.doesNotMatch(texteDe(root), /Carte 1/);
  });

  test('?page=carte avec palier hostile (traversée) : aucun fetch hors liste, message visible', async () => {
    const journal = [];
    const search = '?fonda=1&page=carte&notion=x&palier=' + encodeURIComponent('nI/../../referentiel.json#');
    const root = await demarrerBootstrap({ search, journalFetch: journal });
    assert.deepEqual(journal, []);
    assert.match(texteDe(root), /pas disponible/);
  });

  test('lot de la liste mais drapeau à false dans la donnée : refusé au rendu (défense en profondeur)', async () => {
    const vrai = require('../data/lots-fonda-calibration/fr-comprendre-consigne_nI.json');
    const lots = { 'fonda/data/lots-fonda-calibration/fr-comprendre-consigne_nI.json': { ...vrai, revue_carte_par_carte: false } };
    const root = await demarrerBootstrap({ search: '?fonda=1&page=carte&notion=fr.comprendre-consigne&palier=nI', lots });
    assert.match(texteDe(root), /pas disponible/);
    assert.doesNotMatch(texteDe(root), /Carte 1/);
  });

  test('page=carte : aucun fetch calendrier/classes/referentiel (court-circuit du Promise.all)', async () => {
    const journal = [];
    await demarrerBootstrap({ search: '?fonda=1&page=carte&notion=fr.comprendre-consigne&palier=nI', journalFetch: journal });
    assert.deepEqual(journal, ['fonda/data/lots-fonda-calibration/fr-comprendre-consigne_nI.json']);
  });
});

// --- Chargement réel des dépendances navigateur (relecture Codex PR #2, #2/#3) ---------

describe('chargement des dépendances FONDA en conditions navigateur (aucun global pré-injecté)', () => {
  const ORDRE = [
    'fonda/engine/evenements.js?v=1',
    'fonda/engine/liens.js?v=1',
    'fonda/engine/correction.js?v=1',
    'fonda/engine/carte-reponse-produite.js?v=1',
  ];

  test('lien de défi (calendrier) : graphe complet chargé dans l\'ordre, une seule fois, et le défi se lance', async () => {
    const journalScripts = [];
    const root = await demarrerBootstrap({ search: '?fonda=1&defi=defi_2026-w41_601_resolution-problemes', calendrier: CALENDRIER, journalScripts });
    assert.deepEqual(journalScripts, ORDRE);
    assert.match(texteDe(root), /classe 601/);
    assert.match(texteDe(root), /Carte 1 \/ 6/);
  });

  test('page niveau avec défis programmés : FondaLiens disponible (plus de "FondaLiens is undefined")', async () => {
    const root = await demarrerBootstrap({ search: '?fonda=1&page=niveau&niveau=6e&semaine=41', calendrier: CALENDRIER });
    assert.ok(trouverParClasse(root, 'fonda-liens-niveau'), 'liste de liens absente');
  });

  for (const fichier of ORDRE.map((s) => s.split('?')[0])) {
    test(`échec réseau de ${fichier} : message visible, jamais de page blanche`, async () => {
      const root = await demarrerBootstrap({
        search: '?fonda=1&page=carte&notion=fr.comprendre-consigne&palier=nI',
        echecs: new Set([fichier]),
      });
      assert.match(texteDe(root), /Impossible de charger ce défi/);
    });
  }

  test('échec réseau d\'une dépendance sur la page niveau : message visible (catch de demarrer)', async () => {
    const root = await demarrerBootstrap({ search: '?fonda=1&page=niveau', echecs: new Set(['fonda/engine/liens.js']) });
    assert.match(texteDe(root), /données indisponibles/);
  });

  test('BOX sans fonda : bootstrap.js n\'est jamais chargé (initFonda seulement si ?fonda=1)', () => {
    const app = fsTest.readFileSync(pathTest.join(__dirname, '../../js/app.js'), 'utf8');
    assert.match(app, /if \(params\.get\('fonda'\) === '1'\) \{ this\.initFonda\(\); return; \}/);
    const index = fsTest.readFileSync(pathTest.join(__dirname, '../../index.html'), 'utf8');
    assert.doesNotMatch(index, /<script[^>]+fonda\//);
  });
});

describe('chargerScript — idempotence réelle (relecture Codex PR #2, #3)', () => {
  // Document à chargement PILOTÉ : rien ne se charge tant que le test n'appelle pas
  // onload/onerror lui-même sur la balise injectée.
  function exportsAvecHeadPilote() {
    const { chargerScript } = obtenirExportsBootstrap();
    const balises = [];
    global.document.head.appendChild = (el) => { balises.push(el); return el; };
    return { chargerScript, balises };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  test('deux appels concurrents : UNE seule balise, aucun des deux ne résout avant onload', async () => {
    const { chargerScript, balises } = exportsAvecHeadPilote();
    let resolus = 0;
    const p1 = chargerScript('x.js', 'FondaX').then(() => { resolus += 1; });
    const p2 = chargerScript('x.js', 'FondaX').then(() => { resolus += 1; });
    await tick();
    assert.equal(balises.length, 1);
    assert.equal(resolus, 0, 'résolu avant onload');
    global.window.FondaX = {};
    balises[0].onload();
    await Promise.all([p1, p2]);
    assert.equal(resolus, 2);
  });

  test('après onerror, un nouvel appel retente réellement (nouvelle balise)', async () => {
    const { chargerScript, balises } = exportsAvecHeadPilote();
    const p1 = chargerScript('y.js', 'FondaY');
    balises[0].onerror();
    await assert.rejects(p1);
    const p2 = chargerScript('y.js', 'FondaY');
    assert.equal(balises.length, 2, 'aucune nouvelle tentative après échec');
    global.window.FondaY = {};
    balises[1].onload();
    await p2;
  });

  test('onload sans l\'export attendu : rejet (une balise n\'est pas une preuve d\'exécution)', async () => {
    const { chargerScript, balises } = exportsAvecHeadPilote();
    const p = chargerScript('z.js', 'FondaZ');
    balises[0].onload();
    await assert.rejects(p, /sans exposer FondaZ/);
  });

  test('export déjà présent : résolu sans injecter de balise', async () => {
    const { chargerScript, balises } = exportsAvecHeadPilote();
    global.window.FondaW = {};
    await chargerScript('w.js', 'FondaW');
    assert.equal(balises.length, 0);
  });
});

describe('attente bornée et échec du bootstrap (relecture Codex PR #2, #5)', () => {
  test('avecDelai : une promesse qui ne répond jamais est rejetée passé le délai', async () => {
    const { avecDelai } = obtenirExportsBootstrap();
    await assert.rejects(avecDelai(new Promise(() => {}), 10), /délai de chargement dépassé/);
  });

  test('avecDelai : une promesse rapide passe inchangée', async () => {
    const { avecDelai } = obtenirExportsBootstrap();
    assert.equal(await avecDelai(Promise.resolve(42), 1000), 42);
  });

});

describe('adapterCarte — arrondi et seconde_chance transmis (relecture Codex PR #2, #6)', () => {
  test('arrondi: 2 conservé -> "0,33" juste pour un attendu 1/3 après adaptation', () => {
    const { adapterCarte } = obtenirExportsBootstrap();
    const { evaluerReponse } = require('../engine/correction.js');
    const c = adapterCarte({ question: 'Q', profil_correction: 'numerique', reponses_acceptees: ['1/3'], arrondi: 2 }, { relecteur: 'R' });
    assert.equal(c.arrondi, 2);
    const { statut } = evaluerReponse({ profil: c.profil_correction, reponseDonnee: '0,33', reponsesAcceptees: c.reponses_acceptees, unite: c.unite ?? null, arrondi: c.arrondi ?? null });
    assert.equal(statut, 'juste');
  });

  test('seconde_chance conservée', () => {
    const { adapterCarte } = obtenirExportsBootstrap();
    const c = adapterCarte({ question: 'Q', profil_correction: 'sens', reponses_acceptees: ['a'], seconde_chance: true }, {});
    assert.equal(c.seconde_chance, true);
  });
});

describe('lot validé EN ENTIER avant affichage (relecture Codex PR #2, #9)', () => {
  const CHEMIN = 'fonda/data/lots-fonda-calibration/fr-comprendre-consigne_nI.json';
  const VRAI = require('../data/lots-fonda-calibration/fr-comprendre-consigne_nI.json');

  test('les 8 lots publiables sont bien formés', () => {
    const { cheminLot, LOTS_PUBLIABLES, lotEstBienForme } = obtenirExportsBootstrap();
    for (const [notion, paliers] of Object.entries(LOTS_PUBLIABLES)) {
      for (const palier of paliers) {
        assert.ok(lotEstBienForme(require('../../' + cheminLot(notion, palier))), `${notion}/${palier}`);
      }
    }
  });

  const casMalformes = [
    ['carte null en position 2', (l) => ({ ...l, cartes: [l.cartes[0], null, ...l.cartes.slice(2)] })],
    ['question vide', (l) => ({ ...l, cartes: [l.cartes[0], { ...l.cartes[1], question: ' ' }] })],
    ['profil inconnu', (l) => ({ ...l, cartes: [l.cartes[0], { ...l.cartes[1], profil_correction: 'magie' }] })],
    ['reponses_acceptees non tableau', (l) => ({ ...l, cartes: [l.cartes[0], { ...l.cartes[1], reponses_acceptees: 'x' }] })],
    ['cartes vide', (l) => ({ ...l, cartes: [] })],
  ];
  for (const [libelle, abimer] of casMalformes) {
    test(`${libelle} : refusé AVANT la 1re carte, message visible`, async () => {
      const root = await demarrerBootstrap({
        search: '?fonda=1&page=carte&notion=fr.comprendre-consigne&palier=nI',
        lots: { [CHEMIN]: abimer(VRAI) },
      });
      assert.match(texteDe(root), /pas disponible/);
      assert.doesNotMatch(texteDe(root), /Carte 1/);
    });
  }
});

describe('lien vers l\'index aussi sur les pages niveau sans défi (relecture Codex PR #2, #11)', () => {
  const cas = [
    ['calendrier vide, niveau mémorisé', '?fonda=1&page=niveau&niveau=6e', { version: 1, last_updated: '', semaines: [] }],
    ['semaine programmée mais rien pour ce niveau', '?fonda=1&page=niveau&niveau=3e&semaine=41', CALENDRIER],
  ];
  for (const [libelle, search, calendrier] of cas) {
    test(libelle, async () => {
      const root = await demarrerBootstrap({ search, calendrier });
      const lien = (root.children || []).find((c) => c && c.textContent === 'S\'entraîner librement — toutes les notions');
      assert.ok(lien, 'lien vers l\'index absent');
      assert.match(lien.href, /\?fonda=1&page=entrainement$/);
    });
  }
});

describe('chargerScript — expiration (relecture Codex PR #2 v2, #2)', () => {
  test('délai dépassé -> rejet ; nouvel essai = NOUVELLE balise, qui réussit ; callback tardif de l\'ancienne ignoré', async () => {
    const { chargerScript } = obtenirExportsBootstrap();
    const balises = [];
    global.document.head.appendChild = (el) => { balises.push(el); return el; };

    const p1 = chargerScript('lent.js', 'FondaLent', 20);
    await assert.rejects(p1, /délai dépassé/);
    assert.equal(balises[0].onload, null, 'callbacks de la balise expirée non neutralisés');

    const p2 = chargerScript('lent.js', 'FondaLent', 1000);
    assert.equal(balises.length, 2, 'aucune nouvelle tentative après expiration');
    global.window.FondaLent = {};
    balises[1].onload();
    await p2;
  });

  test('onload puis délai : le délai ne rejette pas une promesse déjà résolue', async () => {
    const { chargerScript } = obtenirExportsBootstrap();
    const balises = [];
    global.document.head.appendChild = (el) => { balises.push(el); return el; };
    const p = chargerScript('rapide.js', 'FondaRapide', 20);
    global.window.FondaRapide = {};
    balises[0].onload();
    await p;
    await new Promise((r) => setTimeout(r, 40));
  });
});

describe('réponses non textuelles (relecture Codex PR #2 v2, #4)', () => {
  const CHEMIN = 'fonda/data/lots-fonda-calibration/fr-comprendre-consigne_nI.json';
  const VRAI = require('../data/lots-fonda-calibration/fr-comprendre-consigne_nI.json');

  const casRefuses = [
    ['réponse {toString:null}', { reponses_acceptees: ['a', { toString: null }] }],
    ['réponse chaîne vide', { reponses_acceptees: ['a', '  '] }],
    ['réponse NaN', { reponses_acceptees: [Number.NaN] }],
    ['unite non texte', { unite: 3 }],
    ['arrondi négatif', { arrondi: -1 }],
    ['seconde_chance non booléen', { seconde_chance: 'oui' }],
  ];
  for (const [libelle, champs] of casRefuses) {
    test(`${libelle} : lot refusé avant la 1re carte`, () => {
      const { lotEstBienForme } = obtenirExportsBootstrap();
      const lot = { ...VRAI, cartes: [VRAI.cartes[0], { ...VRAI.cartes[1], profil_correction: 'exact', ...champs }] };
      assert.equal(lotEstBienForme(lot), false);
    });
  }

  test('réponse nombre fini acceptée par la validation', () => {
    const { lotEstBienForme } = obtenirExportsBootstrap();
    assert.equal(lotEstBienForme({ cartes: [{ question: 'Q', profil_correction: 'numerique', reponses_acceptees: [2] }] }), true);
  });

  test('au clic : si la correction plante malgré tout, message visible + « Carte suivante » révélé', async () => {
    const root = await demarrerBootstrap({
      search: '?fonda=1&page=carte&notion=fr.comprendre-consigne&palier=nI',
      lots: { [CHEMIN]: VRAI },
    });
    // Sabote la correction APRÈS le montage (simule une donnée qui aurait passé la
    // validation mais fait planter evaluerReponse au clic).
    const carteHote = root.children.find((c) => c && c.classList && (c.children || []).some((x) => x.className === 'fonda-question'));
    const valider = trouverBoutonParTexte(root, 'Valider');
    const suivant = trouverBoutonParTexte(root, 'Carte suivante →');
    const input = carteHote.children.find((x) => x.className === 'fonda-reponse-input');
    Object.defineProperty(input, 'value', { get() { throw new Error('boom'); } });
    assert.doesNotThrow(() => valider.__click());
    assert.match(texteDe(root), /Impossible de corriger cette réponse/);
    assert.equal(suivant.style.display, '', '« Carte suivante » doit permettre d\'avancer');
  });
});

describe('validation du lot — compléments (relecture Codex ciblée)', () => {
  const VRAI = require('../data/lots-fonda-calibration/fr-comprendre-consigne_nI.json');
  test('relecteur {toString:null} : lot refusé', () => {
    const { lotEstBienForme } = obtenirExportsBootstrap();
    assert.equal(lotEstBienForme({ ...VRAI, relecteur: { toString: null } }), false);
    assert.equal(lotEstBienForme({ ...VRAI, relecteur: ' ' }), false);
    const { relecteur, ...sansRelecteur } = VRAI;
    assert.equal(lotEstBienForme(sansRelecteur), true, 'absent = repli générique, accepté');
  });
  test('arrondi hors bornes du correcteur (11) : lot refusé ; 10 accepté', () => {
    const { lotEstBienForme } = obtenirExportsBootstrap();
    const avec = (a) => ({ ...VRAI, cartes: [{ ...VRAI.cartes[0], arrondi: a }] });
    assert.equal(lotEstBienForme(avec(11)), false);
    assert.equal(lotEstBienForme(avec(10)), true);
  });
});

// --- Index d'entraînement libre (chantier feat/box-fonda-index) --------------------

function liensIndex(root) {
  const out = [];
  (function parcourir(el) {
    for (const c of (el && el.children) || []) {
      if (c && typeof c.className === 'string' && c.className.includes('fonda-index__lot')) out.push(c);
      parcourir(c);
    }
  })(root);
  return out;
}

describe('construireEntreesIndex — dérivé de LOTS_PUBLIABLES, libellés du référentiel', () => {
  test('une entrée par notion de LOTS_PUBLIABLES, triées par `ordre` du référentiel, libellés lus', () => {
    const { construireEntreesIndex, LOTS_PUBLIABLES } = obtenirExportsBootstrap();
    const entrees = construireEntreesIndex(LOTS_PUBLIABLES, REFERENTIEL);
    assert.deepEqual(entrees.map((e) => e.notionId),
      ['fr.comprendre-consigne', 'maths.grandeurs-mesures', 'maths.resolution-problemes', 'fr.inference-implicite']);
    const consigne = entrees[0];
    assert.equal(consigne.libelle, REFERENTIEL.notions.find((n) => n.id === 'fr.comprendre-consigne').libelle);
    assert.equal(consigne.matiere, 'français');
    assert.deepEqual(consigne.paliers, [{ palier: 'nI', libelle: 'Initial' }, { palier: 'nF', libelle: 'Final' }]);
  });

  test('pas de liste en dur : un couple ajouté à la source apparaît, un couple retiré disparaît', () => {
    const { construireEntreesIndex } = obtenirExportsBootstrap();
    const entrees = construireEntreesIndex({ 'x.fictive': ['nF'], 'fr.comprendre-consigne': ['nI'] }, REFERENTIEL);
    assert.deepEqual(entrees.map((e) => [e.notionId, e.paliers.map((p) => p.palier)]),
      [['fr.comprendre-consigne', ['nI']], ['x.fictive', ['nF']]]);
  });

  test('référentiel absent ou malformé : repli sur l\'identifiant, aucune entrée perdue', () => {
    const { construireEntreesIndex, LOTS_PUBLIABLES } = obtenirExportsBootstrap();
    for (const ref of [null, {}, { notions: 'x' }, { notions: [null] }]) {
      const entrees = construireEntreesIndex(LOTS_PUBLIABLES, ref);
      assert.equal(entrees.length, 4);
      entrees.forEach((e) => assert.equal(e.libelle, e.notionId));
    }
  });
});

describe('?page=entrainement — index des 8 lots publiables', () => {
  test('8 liens, un par couple de LOTS_PUBLIABLES, chacun accepté par cheminLot', async () => {
    const { LOTS_PUBLIABLES, cheminLot } = obtenirExportsBootstrap();
    const attendus = Object.entries(LOTS_PUBLIABLES).flatMap(([n, ps]) => ps.map((p) => `${n}|${p}`)).sort();
    const root = await demarrerBootstrap({ search: '?fonda=1&page=entrainement' });
    const liens = liensIndex(root);
    assert.equal(liens.length, 8);
    const obtenus = liens.map((a) => {
      const q = new URLSearchParams(a.href.split('?')[1]);
      assert.equal(q.get('fonda'), '1');
      assert.equal(q.get('page'), 'carte');
      assert.ok(cheminLot(q.get('notion'), q.get('palier')), `lien hors liste fermée : ${a.href}`);
      return `${q.get('notion')}|${q.get('palier')}`;
    }).sort();
    assert.deepEqual(obtenus, attendus);
    assert.match(texteDe(root), /S'entraîner sur les fondamentaux/);
    assert.match(texteDe(root), /Comprendre une consigne et sélectionner l'information utile/);
    assert.match(texteDe(root), /Français/);
  });

  test('ne lit QUE referentiel.json : ni lot, ni classes, ni calendrier, ni script moteur', async () => {
    const journal = [];
    const journalScripts = [];
    await demarrerBootstrap({ search: '?fonda=1&page=entrainement', journalFetch: journal, journalScripts });
    assert.deepEqual(journal, ['fonda/data/referentiel.json']);
    assert.deepEqual(journalScripts, []);
  });

  test('référentiel indisponible : la liste s\'affiche quand même (identifiants), jamais une impasse', async () => {
    const journal = [];
    global.__referentielEnPanne = true;
    const root = await demarrerBootstrap({ search: '?fonda=1&page=entrainement', journalFetch: journal });
    delete global.__referentielEnPanne;
    assert.equal(liensIndex(root).length, 8);
    assert.match(texteDe(root), /fr\.comprendre-consigne/);
  });
});

describe('retour vers l\'index depuis un paquet libre', () => {
  const versIndex = (root) => (root.children || []).find((c) => c && c.textContent === '← Toutes les notions');

  test('paquet libre (page=carte) : lien « ← Toutes les notions » présent, puis encore sur l\'écran de fin', async () => {
    const root = await demarrerBootstrap({ search: '?fonda=1&page=carte&notion=fr.comprendre-consigne&palier=nI' });
    assert.ok(versIndex(root), 'retour index absent pendant le paquet');
    assert.match(versIndex(root).href, /\?fonda=1&page=entrainement$/);
    for (let i = 0; i < 6; i += 1) {
      trouverBoutonParTexte(root, 'Valider').__click();
      await new Promise((r) => setTimeout(r, 0));
      trouverBoutonParTexte(root, 'Carte suivante →').__click();
      await new Promise((r) => setTimeout(r, 0));
    }
    assert.match(texteDe(root), /Paquet terminé/);
    assert.ok(versIndex(root), 'retour index absent sur l\'écran de fin');
  });

  test('défi de classe (calendrier, grp) : pas de lien vers l\'index (parcours de classe inchangé)', async () => {
    const root = await demarrerBootstrap({ search: '?fonda=1&defi=defi_2026-w41_601_resolution-problemes', calendrier: CALENDRIER });
    assert.match(texteDe(root), /classe 601/);
    assert.equal(versIndex(root), undefined);
  });
});

// --- Invariant G4 « listé = affichable » (décision Éric, chantier feat/box-fonda-index)
// L'index dérive de LOTS_PUBLIABLES ; la barrière de rendu exige EN PLUS
// revue_carte_par_carte === true et un lot bien formé. Si les deux divergeaient,
// l'index proposerait un lien qui meurt sur « Ce défi n'est pas disponible ».

describe('invariant « listé = affichable » : chaque entrée de l\'index passe la barrière de rendu', () => {
  test('tout lot de LOTS_PUBLIABLES : fichier présent, revue_carte_par_carte === true, bien formé', () => {
    const { LOTS_PUBLIABLES, cheminLot, lotEstPubliable, lotEstBienForme } = obtenirExportsBootstrap();
    for (const [notion, paliers] of Object.entries(LOTS_PUBLIABLES)) {
      for (const palier of paliers) {
        const chemin = cheminLot(notion, palier);
        assert.ok(fsTest.existsSync(pathTest.join(__dirname, '../..', chemin)), `fichier absent : ${chemin}`);
        const lot = JSON.parse(fsTest.readFileSync(pathTest.join(__dirname, '../..', chemin), 'utf8'));
        assert.equal(lot.revue_carte_par_carte, true, `${notion}/${palier} listé mais non relu -> lien mort`);
        assert.ok(lotEstPubliable(lot) && lotEstBienForme(lot), `${notion}/${palier} bloqué au rendu`);
      }
    }
  });

  test('parcours réel : chacun des 8 liens de l\'index ouvre bien « Carte 1 / N » (jamais « pas disponible »)', async () => {
    const index = await demarrerBootstrap({ search: '?fonda=1&page=entrainement' });
    const liens = liensIndex(index);
    assert.equal(liens.length, 8);
    for (const a of liens) {
      const search = '?' + a.href.split('?')[1];
      const root = await demarrerBootstrap({ search });
      const q = new URLSearchParams(search);
      const lot = require('../../' + obtenirExportsBootstrap().cheminLot(q.get('notion'), q.get('palier')));
      assert.match(texteDe(root), new RegExp(`Carte 1 / ${lot.cartes.length}`), `lien mort : ${search}`);
      assert.doesNotMatch(texteDe(root), /pas disponible/);
    }
  });
});
