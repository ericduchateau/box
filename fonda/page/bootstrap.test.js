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

function creerDocumentFactice() {
  const body = creerElementFactice('body');
  const head = creerElementFactice('head');
  // Tout <script> ajouté à <head> "charge" avec succès au tick suivant (onload) —
  // simule le chargement dynamique de fonda/engine/*.js (chargerScript ci-contre
  // dans bootstrap.js). Les modules réels sont de toute façon injectés en globals
  // ci-dessous (FondaLiens/FondaCorrection/FondaCarteReponseProduite) : ce qui compte
  // ici est seulement que la promesse chargerScript() SE RÉSOLVE, pas qu'elle exécute
  // réellement un fichier (ça, c'est le rôle du smoke-test manuel en navigateur).
  head.appendChild = (el) => {
    head.children.push(el);
    if (el && el.tagName === 'script') setTimeout(() => { if (typeof el.onload === 'function') el.onload(); }, 0);
    return el;
  };
  let root = null;
  return {
    body, head,
    createElement: (tag) => creerElementFactice(tag),
    getElementById: (id) => (id === 'fondaRoot' ? root : null),
    querySelector: () => null, // jamais de script déjà présent : chaque test repart d'un DOM vierge
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
    if (chemin.includes('referentiel.json')) return { ok: true, json: async () => REFERENTIEL };
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

async function demarrerBootstrap({ search, calendrier, lots, journalFetch }) {
  const doc = creerDocumentFactice();
  // document.body.appendChild('fondaRoot' div) -> on l'intercepte pour pouvoir le relire
  const originalAppendChild = doc.body.appendChild.bind(doc.body);
  doc.body.appendChild = (el) => { doc._definirRoot(el); return originalAppendChild(el); };

  global.document = doc;
  global.window = { location: { search, origin: 'https://ericduchateau.github.io', pathname: '/box/index.html' } };
  const fetchFactice = creerFetchFactice({ calendrier, lots });
  global.fetch = journalFetch
    ? (chemin) => { journalFetch.push(chemin); return fetchFactice(chemin); }
    : fetchFactice;
  global.window.FondaLiens = require('../engine/liens.js');
  global.window.FondaEvenements = require('../engine/evenements.js');
  // Modules réels (pas des bouchons) — mêmes motifs que carte-reponse-produite.test.js :
  // correction.js DOIT être posé sur window avant que carte-reponse-produite.js ne soit
  // require()-é (il lit window.FondaCorrection à l'évaluation du fichier).
  global.window.FondaCorrection = require('../engine/correction.js');
  delete require.cache[require.resolve('../engine/carte-reponse-produite.js')];
  require('../engine/carte-reponse-produite.js');

  delete require.cache[require.resolve('./bootstrap.js')];
  require('./bootstrap.js');

  // Laisse le temps à la chaîne de promesses (fetch factice + "chargement" de script
  // simulé via setTimeout ci-dessus) de se dérouler avant d'inspecter le DOM factice.
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));

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

// Récupère les fonctions pures exportées par bootstrap.js (adapterCarte, cheminLot)
// — demarrer() tourne en tâche de fond (recherche vide -> branche "else", inoffensive)
// mais le require() lui-même, synchrone, a déjà posé module.exports avant ça.
function obtenirExportsBootstrap() {
  global.document = creerDocumentFactice();
  global.window = { location: { search: '' } };
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

describe('Page niveau -> lien "Voir un défi de démonstration"', () => {
  test('le lien est présent et pointe vers ?page=carte&notion=fr.comprendre-consigne&palier=nI', async () => {
    const calendrierVide = { version: 1, last_updated: '', semaines: [] };
    const root = await demarrerBootstrap({ search: '?fonda=1&page=niveau', calendrier: calendrierVide });
    const liens = (root.children || []).filter((c) => c && c.className === 'fonda-header__back');
    const demo = liens.find((a) => a.textContent === 'Voir un défi de démonstration');
    assert.ok(demo, 'lien de démonstration absent de la page niveau');
    assert.match(demo.href, /\?fonda=1&page=carte&notion=fr\.comprendre-consigne&palier=nI$/);
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
  });

  test('"Carte suivante" fait avancer le paquet jusqu\'à l\'écran de fin', async () => {
    const root = await demarrerBootstrap({ search: '?fonda=1&page=carte&notion=fr.comprendre-consigne&palier=nI', calendrier: CALENDRIER });

    function trouverBouton(el, texteBouton) {
      if (!el || !el.children) return null;
      for (const c of el.children) {
        if (c && c.textContent === texteBouton) return c;
        const trouve = trouverBouton(c, texteBouton);
        if (trouve) return trouve;
      }
      return null;
    }

    // "Valider" (carte-reponse-produite.js) doit produire un résultat pour révéler
    // "Carte suivante" — on la clique 6 fois (6 cartes dans ce lot réel) pour
    // atteindre l'écran de fin, sans jamais planter.
    for (let i = 0; i < 6; i += 1) {
      const valider = trouverBouton(root, 'Valider');
      assert.ok(valider, `bouton "Valider" absent à l'itération ${i}`);
      valider.__click();
      await new Promise((r) => setTimeout(r, 0));
      const suivant = trouverBouton(root, 'Carte suivante →');
      assert.ok(suivant, `bouton "Carte suivante" absent à l'itération ${i}`);
      suivant.__click();
      await new Promise((r) => setTimeout(r, 0));
    }

    const texteFin = (root.textContent || '').trim() || root.children.map((c) => c.textContent).join(' ');
    assert.match(texteFin, /Paquet terminé — 6 carte\(s\) vue\(s\)/);
  });
});

// --- G4 : liste fermée + drapeau de relecture vérifié au rendu (relecture Codex PR #2) ---

function texteDe(root) {
  return (root.textContent || '').trim() || root.children.map((c) => c.textContent).join(' ');
}

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
