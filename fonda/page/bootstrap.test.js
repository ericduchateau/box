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
const CATALOGUE = require('../data/catalogue-fonda.json');
// Lot HISTORIQUE épinglé (6 cartes, relu par Éric) : toujours ouvert par ?set=, jamais par
// notion/palier — ce lien-là sert le lot le PLUS RÉCENT du couple, qui change à chaque publication.
const SET_CONSIGNE_NI = 'set_fonda_comprendre-consigne_nI_01';
const CHEMIN_CONSIGNE_NI = 'fonda/data/lots/set_fonda_comprendre-consigne_nI_01.json';
const LOT_CONSIGNE_NI = require('../data/lots/set_fonda_comprendre-consigne_nI_01.json');
const LIEN_CONSIGNE_NI = `?fonda=1&page=carte&set=${SET_CONSIGNE_NI}`;
// Lot le plus récent de fr.comprendre-consigne/nI, DÉRIVÉ du catalogue (plus grande séquence).
const sequence = (setId) => Number(/_(\d{2})$/.exec(setId)[1]);
const LOTS_CONSIGNE_NI = CATALOGUE.lots.filter((e) => e.notion_id === 'fr.comprendre-consigne' && e.palier === 'nI');
const PLUS_RECENT_CONSIGNE_NI = LOTS_CONSIGNE_NI.slice().sort((a, b) => sequence(b.set_id) - sequence(a.set_id))[0];
const LOT_PLUS_RECENT_CONSIGNE_NI = require(`../data/${PLUS_RECENT_CONSIGNE_NI.fichier}`);

const SEMAINE_41 = {
  iso_week: 41,
  du: '2026-10-05',
  au: '2026-10-11',
  entrees: [
    { notion_id: 'maths.resolution-problemes', matiere: 'maths', palier: 'nI', niveau_cible: '6e', set_id: 'set_fonda_resolution-problemes_nI_01' },
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
// SRI : si la balise porte `integrity`, l'empreinte des octets servis est réellement
// comparée (comme un navigateur) — discordance -> onerror, script jamais exécuté.
// `remplacements` (chemin -> code) sert un autre contenu que le fichier committé.
const vm = require('vm');
const fsTest = require('fs');
const pathTest = require('path');

const cryptoTest = require('crypto');
function creerDocumentFactice({ echecs = new Set(), journalScripts = [], remplacements = {} } = {}) {
  const body = creerElementFactice('body');
  const head = creerElementFactice('head');
  head.appendChild = (el) => {
    head.children.push(el);
    if (el && el.tagName === 'script') {
      journalScripts.push(el.src);
      setTimeout(() => {
        const chemin = el.src.split('?')[0];
        if (echecs.has(chemin)) { if (typeof el.onerror === 'function') el.onerror(new Error('réseau')); return; }
        const code = remplacements[chemin] !== undefined ? remplacements[chemin] : fsTest.readFileSync(pathTest.join(__dirname, '..', '..', chemin), 'utf8');
        if (el.integrity) {
          const sri = 'sha256-' + cryptoTest.createHash('sha256').update(code).digest('base64');
          if (el.integrity !== sri || el.crossOrigin !== 'anonymous') { if (typeof el.onerror === 'function') el.onerror(new Error('SRI')); return; }
        }
        vm.runInNewContext(code, { self: global.window, window: global.window, document: global.document, console, crypto: globalThis.crypto, TextEncoder });
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
const MOTEURS = require('../engine/moteurs.json');
function creerFetchFactice({ calendrier = CALENDRIER, lots = {}, catalogue = CATALOGUE, moteurs = MOTEURS } = {}) {
  return async (chemin) => {
    if (chemin === 'fonda/engine/moteurs.json') return { ok: true, json: async () => JSON.parse(JSON.stringify(moteurs)) };
    if (chemin.includes('classes.json')) return { ok: true, json: async () => CLASSES };
    if (chemin.includes('referentiel.json')) {
      return global.__referentielEnPanne ? { ok: false } : { ok: true, json: async () => REFERENTIEL };
    }
    if (chemin.includes('calendar.json')) return { ok: true, json: async () => calendrier };
    if (chemin === 'fonda/data/catalogue-fonda.json') {
      return catalogue ? { ok: true, json: async () => JSON.parse(JSON.stringify(catalogue)) } : { ok: false };
    }
    if (chemin.startsWith('fonda/data/lots/')) {
      if (lots[chemin]) return { ok: true, json: async () => lots[chemin] };
      try {
        const donnees = JSON.parse(fsTest.readFileSync(pathTest.join(__dirname, '../..', chemin), 'utf8'));
        return { ok: true, json: async () => donnees };
      } catch { return { ok: false }; }
    }
    return { ok: false };
  };
}

async function demarrerBootstrap({ search, calendrier, lots, catalogue, journalFetch, journalOptions, echecs, journalScripts, remplacements }) {
  const doc = creerDocumentFactice({ echecs, journalScripts, remplacements });
  // document.body.appendChild('fondaRoot' div) -> on l'intercepte pour pouvoir le relire
  const originalAppendChild = doc.body.appendChild.bind(doc.body);
  doc.body.appendChild = (el) => { doc._definirRoot(el); return originalAppendChild(el); };

  global.document = doc;
  global.window = { location: { search, origin: 'https://ericduchateau.github.io', pathname: '/box/index.html' } };
  const fetchFactice = creerFetchFactice({ calendrier, lots, ...(catalogue !== undefined ? { catalogue } : {}) });
  global.fetch = (chemin, options) => {
    if (journalFetch) journalFetch.push(chemin);
    if (journalOptions) journalOptions.push([chemin, options]);
    return fetchFactice(chemin);
  };

  delete require.cache[require.resolve('./bootstrap.js')];
  require('./bootstrap.js');

  // Laisse le temps à la chaîne de promesses (fetch factice + chargement de script
  // simulé via setTimeout ci-dessus) de se dérouler avant d'inspecter le DOM factice.
  for (let i = 0; i < 40; i += 1) await new Promise((r) => setTimeout(r, 0));

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

describe('defi résolu avec succès -> le lot programmé (set_id du calendrier) est rendu', () => {
  test('un lien valide rend le lot dont le set_id vient du calendrier, avec la classe résolue', async () => {
    const root = await demarrerBootstrap({ search: '?fonda=1&defi=defi_2026-w41_601_resolution-problemes', calendrier: CALENDRIER });
    assert.match(texteDe(root), /classe 601/);
    assert.match(texteDe(root), /Carte 1 \/ 6/);
  });

  test('set_id programmé mais absent du catalogue publié -> « pas disponible », rien rendu', async () => {
    const cal = { ...CALENDRIER, semaines: [{ ...SEMAINE_41, entrees: [{ ...SEMAINE_41.entrees[0], set_id: 'set_fonda_resolution-problemes_nI_92' }] }] };
    const root = await demarrerBootstrap({ search: '?fonda=1&defi=defi_2026-w41_601_resolution-problemes', calendrier: cal });
    assert.match(texteDe(root), /pas disponible/);
    assert.doesNotMatch(texteDe(root), /Carte 1/);
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

describe('cheminLot — chemin issu de l\'entrée du catalogue, jamais d\'un paramètre d\'URL', () => {
  test('entrée conforme -> fonda/data/lots/<set_id>.json', () => {
    const { cheminLot } = obtenirExportsBootstrap();
    assert.equal(cheminLot(CATALOGUE.lots[0]), `fonda/data/lots/${CATALOGUE.lots[0].set_id}.json`);
  });
  test('entrée absente ou fichier ≠ lots/<set_id>.json -> null', () => {
    const { cheminLot } = obtenirExportsBootstrap();
    assert.equal(cheminLot(null), null);
    assert.equal(cheminLot({ set_id: SET_CONSIGNE_NI, fichier: '../referentiel.json' }), null);
    assert.equal(cheminLot({ set_id: SET_CONSIGNE_NI, fichier: 'lots/autre.json' }), null);
  });
});

const MOTEUR_V1 = require('../engine/moteur-correction-v1.js').creerMoteur();

describe('badge élève — LU dans l\'entrée attestée du catalogue, jamais déduit (CDC §12)', () => {
  test('renvoie entree.relecteur tel quel ({ forme, nom_affiche, id })', () => {
    const { badgeDepuisEntree } = obtenirExportsBootstrap();
    const r = { forme: 'relue_par', nom_affiche: 'Éric Duchateau', id: 'eric' };
    assert.equal(badgeDepuisEntree({ relecteur: r }), r);
  });
  test('repli générique SANS nom si l\'entrée n\'a pas de relecteur exploitable — jamais déduit de la matière', () => {
    const { badgeDepuisEntree } = obtenirExportsBootstrap();
    for (const e of [null, {}, { relecteur: {} }, { relecteur: { nom_affiche: ' ' } }, { relecteur: { nom_affiche: { toString: null } } }, { matiere: 'Mathématiques' }]) {
      assert.deepEqual({ ...badgeDepuisEntree(e) }, { forme: 'relue_par', nom_affiche: 'un professeur', id: null });
    }
  });
  test('preparerCarte (moteur) transporte question/profil/reponses_acceptees/unite, jamais contexte', () => {
    const c = MOTEUR_V1.preparerCarte({ question: 'Combien ?', profil_correction: 'numerique', reponses_acceptees: ['8 cm', '8'], unite: 'cm', numero: 1, contexte: 'x' });
    assert.equal(c.question, 'Combien ?');
    assert.deepEqual([...c.reponses_acceptees], ['8 cm', '8']);
    assert.equal(c.unite, 'cm');
    assert.equal('contexte' in c, false, 'contexte jamais transmis (ni affiché ni noté)');
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
  test('lot manquant dans le lien : message clair, pas de crash', async () => {
    const root = await demarrerBootstrap({ search: '?fonda=1&page=carte', calendrier: CALENDRIER });
    assert.match(texteDe(root), /lot manquant/i);
  });

  test('lien canonique ?set=<set_id> : le lot publié est rendu', async () => {
    const root = await demarrerBootstrap({ search: `?fonda=1&page=carte&set=${SET_CONSIGNE_NI}` });
    assert.match(texteDe(root), /Carte 1 \/ 6/);
  });

  test('compat ancien lien notion/palier : résolu par le catalogue vers le lot le PLUS RÉCENT du couple (dérivé)', async () => {
    const journal = [];
    const root = await demarrerBootstrap({ search: '?fonda=1&page=carte&notion=fr.comprendre-consigne&palier=nI', journalFetch: journal });
    assert.match(texteDe(root), new RegExp(`Carte 1 / ${LOT_PLUS_RECENT_CONSIGNE_NI.cartes.length}(?!\\d)`));
    assert.ok(journal.includes(`fonda/data/${PLUS_RECENT_CONSIGNE_NI.fichier}`), 'le lot servi est le plus récent du catalogue');
    for (const e of LOTS_CONSIGNE_NI.filter((x) => x !== PLUS_RECENT_CONSIGNE_NI)) assert.ok(!journal.includes(`fonda/data/${e.fichier}`), `${e.set_id} : plus ancien, jamais servi par ce lien`);
  });

  test('lot introuvable (fetch échoue) : message clair, pas de page blanche', async () => {
    const root = await demarrerBootstrap({ search: '?fonda=1&page=carte&notion=inconnue.xyz&palier=nI', calendrier: CALENDRIER });
    const texte = (root.textContent || root.children.map((c) => c.textContent).join('')).trim();
    assert.ok(texte.length > 0);
    assert.doesNotMatch(texte, /contenu à venir/, 'le stub ne doit plus jamais apparaître');
  });

  test('paquet réel ÉPINGLÉ (set=…_nI_01, fichier committé) : carte 1 rendue avec le relecteur ATTESTÉ ("Éric Duchateau")', async () => {
    const root = await demarrerBootstrap({ search: LIEN_CONSIGNE_NI, calendrier: CALENDRIER });
    const texte = (root.textContent || '').trim() || root.children.map((c) => c.textContent).join(' ');
    assert.match(texte, /Comprendre une consigne/, 'le titre du lot doit apparaître');
    assert.match(texte, /Carte 1 \/ 6/, 'le compteur doit annoncer 6 cartes (lot réel committé)');
    assert.doesNotMatch(texte, /contenu à venir/);
    // Relecture Codex PR #2 (#10) : le nom du relecteur doit réellement s'afficher
    // (bandeau de correction, après "Valider").
    trouverBoutonParTexte(root, 'Valider').__click();
    await new Promise((r) => setTimeout(r, 0));
    assert.match(texteDe(root), /Éric Duchateau/);
    assert.doesNotMatch(texteDe(root), /Justine/);
  });

  test('"Carte suivante" fait avancer le paquet jusqu\'à l\'écran de fin', async () => {
    const root = await demarrerBootstrap({ search: LIEN_CONSIGNE_NI, calendrier: CALENDRIER });

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

describe('G4 — seuls les lots du catalogue publié, intacts et attestés, sont affichables', () => {
  test('lotEstPubliable : true strict uniquement', () => {
    const { lotEstPubliable } = obtenirExportsBootstrap();
    assert.equal(lotEstPubliable({ revue_carte_par_carte: true }), true);
    for (const v of [false, 'true', undefined]) assert.equal(lotEstPubliable({ revue_carte_par_carte: v }), false);
    assert.equal(lotEstPubliable(null), false);
  });

  const refus = [
    ['lot NON relu (fr.lexique), ancien lien', '?fonda=1&page=carte&notion=fr.lexique&palier=nI'],
    ['set_id de calibration non publié', '?fonda=1&page=carte&set=set_fonda_lexique_nI_01'],
    ['palier hostile (traversée)', '?fonda=1&page=carte&notion=x&palier=' + encodeURIComponent('nI/../../referentiel.json#')],
    ['set hostile (traversée)', '?fonda=1&page=carte&set=' + encodeURIComponent('../referentiel')],
  ];
  for (const [libelle, search] of refus) {
    test(`${libelle} : refusé, AUCUN fetch de lot, message visible`, async () => {
      const journal = [];
      const root = await demarrerBootstrap({ search, journalFetch: journal });
      assert.deepEqual(journal.filter((c) => c !== 'fonda/data/catalogue-fonda.json'), []);
      assert.match(texteDe(root), /pas disponible/);
      assert.doesNotMatch(texteDe(root), /Carte 1/);
    });
  }

  const alterations = [
    ['drapeau revue à false', (l) => ({ ...l, revue_carte_par_carte: false })],
    ['UNE réponse acceptée modifiée après attestation (empreinte ≠)', (l) => ({ ...l, cartes: l.cartes.map((c, i) => (i === 2 ? { ...c, reponses_acceptees: [...c.reponses_acceptees, 'triche'] } : c)) })],
    ['question modifiée après attestation (empreinte ≠)', (l) => ({ ...l, cartes: [{ ...l.cartes[0], question: l.cartes[0].question + ' ' }, ...l.cartes.slice(1)] })],
    ['champ hors liste blanche (code_suppression)', (l) => ({ ...l, code_suppression: 'SUP-AAAA1111' })],
    ['champ hors liste blanche dans une carte (prof_email)', (l) => ({ ...l, cartes: [{ ...l.cartes[0], prof_email: 'x@y.z' }, ...l.cartes.slice(1)] })],
    ['set_id du fichier ≠ entrée', (l) => ({ ...l, set_id: 'set_fonda_comprendre-consigne_nI_92' })],
    ['cartes réordonnées (item_ids ≠ entrée)', (l) => ({ ...l, cartes: [l.cartes[1], l.cartes[0], ...l.cartes.slice(2)] })],
  ];
  for (const [libelle, alterer] of alterations) {
    test(`fichier publié altéré — ${libelle} : refusé au rendu`, async () => {
      const root = await demarrerBootstrap({ search: `?fonda=1&page=carte&set=${SET_CONSIGNE_NI}`, lots: { [CHEMIN_CONSIGNE_NI]: alterer(LOT_CONSIGNE_NI) } });
      assert.match(texteDe(root), /pas disponible/);
      assert.doesNotMatch(texteDe(root), /Carte 1/);
    });
  }

  test('catalogue non conforme (entrée sans attestation) -> message visible, aucun lot chargé', async () => {
    const journal = [];
    const cat = { ...CATALOGUE, lots: CATALOGUE.lots.map(({ attestation, ...e }) => e) };
    const root = await demarrerBootstrap({ search: `?fonda=1&page=carte&set=${SET_CONSIGNE_NI}`, catalogue: cat, journalFetch: journal });
    assert.match(texteDe(root), /Impossible de charger ce défi/);
    assert.deepEqual(journal, ['fonda/data/catalogue-fonda.json']);
  });

  test('catalogue indisponible -> message visible', async () => {
    const root = await demarrerBootstrap({ search: `?fonda=1&page=carte&set=${SET_CONSIGNE_NI}`, catalogue: null });
    assert.match(texteDe(root), /Impossible de charger ce défi/);
  });

  test('page=carte : seuls catalogue + registre des moteurs + lot sont lus (ni calendrier, ni classes, ni référentiel)', async () => {
    const journal = [];
    await demarrerBootstrap({ search: `?fonda=1&page=carte&set=${SET_CONSIGNE_NI}`, journalFetch: journal });
    assert.deepEqual(journal, ['fonda/data/catalogue-fonda.json', 'fonda/engine/moteurs.json', CHEMIN_CONSIGNE_NI]);
  });
});

// --- Chargement réel des dépendances navigateur (relecture Codex PR #2, #2/#3) ---------

describe('chargement des dépendances FONDA en conditions navigateur (aucun global pré-injecté)', () => {
  const ORDRE = [
    'fonda/engine/catalogue.js?v=4',
    'fonda/engine/evenements.js?v=3',
    'fonda/engine/liens.js?v=4',
    'fonda/engine/carte-reponse-produite.js?v=4',
  ];
  const MOTEUR = 'fonda/engine/moteur-correction-v1.js';

  test('lien de défi (calendrier) : graphe complet chargé dans l\'ordre, une seule fois, et le défi se lance', async () => {
    const journalScripts = [];
    const root = await demarrerBootstrap({ search: '?fonda=1&defi=defi_2026-w41_601_resolution-problemes', calendrier: CALENDRIER, journalScripts });
    assert.deepEqual(journalScripts, [...ORDRE, MOTEUR], 'moteur chargé en dernier, après résolution de l\'entrée');
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

  test('échec réseau du moteur : « pas disponible » (CDC §4.3), aucune carte', async () => {
    const root = await demarrerBootstrap({ search: `?fonda=1&page=carte&set=${SET_CONSIGNE_NI}`, echecs: new Set([MOTEUR]) });
    assert.match(texteDe(root), /pas disponible/);
    assert.doesNotMatch(texteDe(root), /Carte 1/);
  });

  test('moteur servi altéré (SRI discordante) : jamais exécuté, « pas disponible »', async () => {
    const code = fsTest.readFileSync(pathTest.join(__dirname, '../..', MOTEUR), 'utf8').replace("issue === 'presque' && carte.seconde_chance", "issue !== 'juste' && carte.seconde_chance");
    const root = await demarrerBootstrap({ search: `?fonda=1&page=carte&set=${SET_CONSIGNE_NI}`, remplacements: { [MOTEUR]: code } });
    assert.match(texteDe(root), /pas disponible/);
    assert.equal(global.window.FondaMoteurs, undefined, 'le code altéré ne doit jamais s\'exécuter');
  });

  test('entrée sans moteur ou moteur discordant du registre : « pas disponible », moteur jamais chargé', async () => {
    const autre = '0'.repeat(64);
    for (const modifier of [(e) => { e.moteur = { version: 'v1', sha256: autre }; }, (e) => { e.moteur = { version: 'v9', sha256: e.moteur.sha256 }; }]) {
      const cat = JSON.parse(JSON.stringify(CATALOGUE));
      modifier(cat.lots.find((e) => e.set_id === SET_CONSIGNE_NI));
      const journalScripts = [];
      const root = await demarrerBootstrap({ search: `?fonda=1&page=carte&set=${SET_CONSIGNE_NI}`, catalogue: cat, journalScripts });
      assert.doesNotMatch(texteDe(root), /Carte 1/);
      assert.equal(journalScripts.includes(MOTEUR), false);
    }
  });

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

describe('preparerCarte — arrondi et seconde_chance transmis (relecture Codex PR #2, #6)', () => {
  test('arrondi: 2 conservé -> "0,33" juste pour un attendu 1/3 après préparation', () => {
    const c = MOTEUR_V1.preparerCarte({ question: 'Q', profil_correction: 'numerique', reponses_acceptees: ['1/3'], arrondi: 2 });
    assert.equal(c.arrondi, 2);
    assert.equal(MOTEUR_V1.soumettre(MOTEUR_V1.demarrer(c), '0,33').resultat.issue, 'juste');
  });

  test('seconde_chance conservée', () => {
    const c = MOTEUR_V1.preparerCarte({ question: 'Q', profil_correction: 'sens', reponses_acceptees: ['a'], seconde_chance: true });
    assert.equal(c.seconde_chance, true);
  });
});

describe('lot validé EN ENTIER avant affichage (relecture Codex PR #2, #9)', () => {
  const CHEMIN = CHEMIN_CONSIGNE_NI;
  const VRAI = LOT_CONSIGNE_NI;

  test('les lots publiés sont bien formés', () => {
    const { cheminLot, lotEstBienForme } = obtenirExportsBootstrap();
    for (const e of CATALOGUE.lots) assert.ok(lotEstBienForme(require('../../' + cheminLot(e)), MOTEUR_V1), e.set_id);
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
        search: LIEN_CONSIGNE_NI,
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
  const CHEMIN = CHEMIN_CONSIGNE_NI;
  const VRAI = LOT_CONSIGNE_NI;

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
      assert.equal(lotEstBienForme(lot, MOTEUR_V1), false);
    });
  }

  test('réponse nombre fini acceptée par la validation', () => {
    const { lotEstBienForme } = obtenirExportsBootstrap();
    assert.equal(lotEstBienForme({ cartes: [{ question: 'Q', profil_correction: 'numerique', reponses_acceptees: [2] }] }, MOTEUR_V1), true);
  });

  // Test d'ORIGINE rétabli (relecture Codex étape 2, #3) : la lecture de la saisie
  // lève au clic. RÉVISÉ E4 seulement sur le canal (onResultat/carte_terminee au lieu
  // d'onErreur).
  test('au clic : si la lecture de la saisie plante, message visible + « Carte suivante » révélé', async () => {
    const root = await demarrerBootstrap({
      search: LIEN_CONSIGNE_NI,
      lots: { [CHEMIN]: VRAI },
    });
    const carteHote = root.children.find((c) => c && c.classList && (c.children || []).some((x) => x.className === 'fonda-question'));
    const valider = trouverBoutonParTexte(root, 'Valider');
    const suivant = trouverBoutonParTexte(root, 'Carte suivante →');
    const input = carteHote.children.find((x) => x.className === 'fonda-reponse-input');
    Object.defineProperty(input, 'value', { get() { throw new Error('boom'); } });
    assert.doesNotThrow(() => valider.__click());
    assert.match(texteDe(root), /Impossible de corriger cette réponse/);
    assert.equal(suivant.style.display, '', '« Carte suivante » doit permettre d\'avancer');
  });

  // Variante : donnée qui a passé la validation et l'empreinte puis fait planter
  // l'évaluation dans le moteur (carte 2 altérée en mémoire après le contrôle).
  test('au clic : si l\'évaluation plante dans le moteur, message visible + « Carte suivante » révélé', async () => {
    const lot = JSON.parse(JSON.stringify(VRAI));
    const root = await demarrerBootstrap({
      search: LIEN_CONSIGNE_NI,
      lots: { [CHEMIN]: lot },
    });
    lot.cartes[1].reponses_acceptees.push({ toString: null });
    trouverBoutonParTexte(root, 'Valider').__click();
    trouverBoutonParTexte(root, 'Carte suivante →').__click();
    const suivant = trouverBoutonParTexte(root, 'Carte suivante →');
    assert.equal(suivant.style.display, 'none');
    assert.doesNotThrow(() => trouverBoutonParTexte(root, 'Valider').__click());
    assert.match(texteDe(root), /Impossible de corriger cette réponse/);
    assert.equal(suivant.style.display, '', '« Carte suivante » doit permettre d\'avancer');
  });
});

describe('validation du lot — compléments (relecture Codex ciblée)', () => {
  test('arrondi hors bornes du correcteur (11) : lot refusé ; 10 accepté', () => {
    const { lotEstBienForme } = obtenirExportsBootstrap();
    const avec = (a) => ({ ...LOT_CONSIGNE_NI, cartes: [{ ...LOT_CONSIGNE_NI.cartes[0], arrondi: a }] });
    assert.equal(lotEstBienForme(avec(11), MOTEUR_V1), false);
    assert.equal(lotEstBienForme(avec(10), MOTEUR_V1), true);
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

describe('construireEntreesIndex — dérivé du catalogue publié, libellés du référentiel', () => {
  test('une ligne par notion du catalogue, triées par `ordre` du référentiel, un lien par set_id', () => {
    const { construireEntreesIndex } = obtenirExportsBootstrap();
    const entrees = construireEntreesIndex(CATALOGUE, REFERENTIEL);
    assert.deepEqual(entrees.map((e) => e.notionId),
      ['fr.comprendre-consigne', 'maths.grandeurs-mesures', 'maths.resolution-problemes', 'fr.inference-implicite', 'maths.nombres-fractions-relatifs']);
    // Première fiche signée (lot 8) : notion de maths, ordre 8 du référentiel, palier nI seulement.
    const nfr = entrees.find((e) => e.notionId === 'maths.nombres-fractions-relatifs');
    assert.equal(nfr.libelle, REFERENTIEL.notions.find((n) => n.id === 'maths.nombres-fractions-relatifs').libelle);
    assert.equal(nfr.matiere, 'maths');
    assert.deepEqual(nfr.paliers, [{ palier: 'nI', setId: 'set_fonda_nombres-fractions-relatifs_nI_03', libelle: 'Initial' }]);
    const consigne = entrees[0];
    assert.equal(consigne.libelle, REFERENTIEL.notions.find((n) => n.id === 'fr.comprendre-consigne').libelle);
    assert.equal(consigne.matiere, 'français');
    // UN LIEN PAR LOT du couple (notion, palier), compte DÉRIVÉ du catalogue : « Initial » seul,
    // ou « Initial 1 », « Initial 2 »… dès qu'un même palier a plusieurs lots publiés.
    const BASE = { nI: 'Initial', nF: 'Final' };
    const attendus = ['nI', 'nF'].flatMap((p) => {
      const ids = CATALOGUE.lots.filter((e) => e.notion_id === 'fr.comprendre-consigne' && e.palier === p).map((e) => e.set_id).sort();
      return ids.map((setId, i) => ({ palier: p, setId, libelle: ids.length > 1 ? `${BASE[p]} ${i + 1}` : BASE[p] }));
    });
    assert.deepEqual(consigne.paliers, attendus);
    assert.equal(consigne.paliers.filter((x) => x.palier === 'nI').length, LOTS_CONSIGNE_NI.length);
    assert.ok(consigne.paliers.some((x) => x.setId === SET_CONSIGNE_NI), 'le lot historique reste listé');
  });

  test('pas de liste en dur : un lot ajouté au catalogue apparaît ; deux lots du même couple sont numérotés', () => {
    const { construireEntreesIndex } = obtenirExportsBootstrap();
    const cat = { lots: [
      { set_id: 'set_fonda_comprendre-consigne_nI_01', notion_id: 'fr.comprendre-consigne', palier: 'nI' },
      { set_id: 'set_fonda_comprendre-consigne_nI_92', notion_id: 'fr.comprendre-consigne', palier: 'nI' },
      { set_id: 'set_fonda_fictive_nF_01', notion_id: 'x.fictive', palier: 'nF' },
    ] };
    const entrees = construireEntreesIndex(cat, REFERENTIEL);
    assert.deepEqual(entrees.map((e) => [e.notionId, e.paliers.map((p) => p.libelle)]),
      [['fr.comprendre-consigne', ['Initial 1', 'Initial 2']], ['x.fictive', ['Final']]]);
  });

  test('référentiel absent ou malformé : repli sur l\'identifiant, aucune entrée perdue', () => {
    const { construireEntreesIndex } = obtenirExportsBootstrap();
    for (const ref of [null, {}, { notions: 'x' }, { notions: [null] }]) {
      const entrees = construireEntreesIndex(CATALOGUE, ref);
      assert.equal(entrees.length, new Set(CATALOGUE.lots.map((e) => e.notion_id)).size); // notions distinctes du catalogue (5 après _nI_03)
      entrees.forEach((e) => assert.equal(e.libelle, e.notionId));
    }
  });
});

describe('?page=entrainement — index des lots publiés', () => {
  test('un lien ?set=<set_id> par lot du catalogue', async () => {
    const root = await demarrerBootstrap({ search: '?fonda=1&page=entrainement' });
    const liens = liensIndex(root);
    const obtenus = liens.map((a) => {
      const q = new URLSearchParams(a.href.split('?')[1]);
      assert.equal(q.get('fonda'), '1');
      assert.equal(q.get('page'), 'carte');
      return q.get('set');
    }).sort();
    assert.deepEqual(obtenus, CATALOGUE.lots.map((e) => e.set_id).sort());
    assert.equal(obtenus.length, CATALOGUE.lots.length); // 9 après _nI_03
    assert.match(texteDe(root), /S'entraîner sur les fondamentaux/);
    assert.match(texteDe(root), /Comprendre une consigne et sélectionner l'information utile/);
    assert.match(texteDe(root), /Français/);
  });

  test('ne lit QUE le catalogue et le référentiel ; seul catalogue.js est chargé', async () => {
    const journal = [];
    const journalScripts = [];
    await demarrerBootstrap({ search: '?fonda=1&page=entrainement', journalFetch: journal, journalScripts });
    assert.deepEqual(journal, ['fonda/data/catalogue-fonda.json', 'fonda/data/referentiel.json']);
    assert.deepEqual(journalScripts, ['fonda/engine/catalogue.js?v=4']);
  });

  test('référentiel indisponible : la liste s\'affiche quand même (identifiants)', async () => {
    global.__referentielEnPanne = true;
    const root = await demarrerBootstrap({ search: '?fonda=1&page=entrainement' });
    delete global.__referentielEnPanne;
    assert.equal(liensIndex(root).length, CATALOGUE.lots.length);
    assert.match(texteDe(root), /fr\.comprendre-consigne/);
  });

  test('catalogue indisponible ou non conforme : message visible, pas d\'index vide', async () => {
    for (const catalogue of [null, { schema: 'autre', lots: [] }]) {
      const root = await demarrerBootstrap({ search: '?fonda=1&page=entrainement', catalogue });
      assert.match(texteDe(root), /Entraînement indisponible/);
      assert.equal(liensIndex(root).length, 0);
    }
  });
});

describe('retour vers l\'index depuis un paquet libre', () => {
  const versIndex = (root) => (root.children || []).find((c) => c && c.textContent === '← Toutes les notions');

  test('paquet libre (page=carte) : lien « ← Toutes les notions » présent, puis encore sur l\'écran de fin', async () => {
    const root = await demarrerBootstrap({ search: LIEN_CONSIGNE_NI });
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
// L'index dérive du catalogue ; la barrière de rendu exige EN PLUS
// revue_carte_par_carte === true, la liste blanche et l'empreinte attestée (la
// cohérence fichiers <-> catalogue est verrouillée par fonda/data/catalogue.test.js). Si les deux divergeaient,
// l'index proposerait un lien qui meurt sur « Ce défi n'est pas disponible ».

describe('invariant « listé = affichable » : chaque entrée de l\'index passe la barrière de rendu', () => {
  test('parcours réel : chacun des liens de l\'index ouvre bien « Carte 1 / N » (jamais « pas disponible »)', async () => {
    const index = await demarrerBootstrap({ search: '?fonda=1&page=entrainement' });
    const liens = liensIndex(index);
    assert.equal(liens.length, CATALOGUE.lots.length);
    for (const a of liens) {
      const search = '?' + a.href.split('?')[1];
      const root = await demarrerBootstrap({ search });
      const entree = CATALOGUE.lots.find((e) => e.set_id === new URLSearchParams(search).get('set'));
      assert.match(texteDe(root), new RegExp(`Carte 1 / ${entree.item_ids.length}`), `lien mort : ${search}`);
      assert.doesNotMatch(texteDe(root), /pas disponible/);
    }
  });
});

// --- Chargeur de moteurs versionnés (CDC relecture §4.1) --------------------------
// v2 = FIXTURE DE TEST (jamais commitée comme moteur) : le code v1 réenregistré sous
// « v2 » avec un verdict différent, servi via `remplacements` + un registre de test.

describe('obtenirMoteur — version + empreinte + SRI, registre non réassignable (CDC §4.1)', () => {
  const V1 = MOTEURS[0];
  const CODE_V1 = fsTest.readFileSync(pathTest.join(__dirname, '../..', V1.fichier), 'utf8');
  const CODE_V2 = CODE_V1.replace("var VERSION = 'v1';", "var VERSION = 'v2';").replace("juste: function () { return 'Bonne réponse'; }", "juste: function () { return 'Bravo (v2)'; }");
  const digest = (code) => cryptoTest.createHash('sha256').update(code).digest();
  const V2 = { version: 'v2', fichier: 'fonda/engine/moteur-correction-v2.js', sha256: digest(CODE_V2).toString('hex'), sri: 'sha256-' + digest(CODE_V2).toString('base64') };
  const CARTE = { question: 'Q', profil_correction: 'exact', reponses_acceptees: ['a'] };
  const verdict = (m) => m.soumettre(m.demarrer(m.preparerCarte(CARTE)), 'a').resultat.verdict.texte;

  function preparer({ echecs, moteurs = [V1, V2] } = {}) {
    const journalScripts = [];
    global.document = creerDocumentFactice({ journalScripts, echecs, remplacements: { [V2.fichier]: CODE_V2 } });
    global.window = { location: { search: '?page=carte' } };
    global.fetch = creerFetchFactice({ moteurs });
    delete require.cache[require.resolve('./bootstrap.js')];
    const { obtenirMoteur, sriDepuisHex } = require('./bootstrap.js');
    return { obtenirMoteur, sriDepuisHex, journalScripts };
  }

  test('SRI calculée = colonne sri du registre (même empreinte, base64)', () => {
    const { sriDepuisHex } = preparer();
    assert.equal(sriDepuisHex(V1.sha256), V1.sri);
    assert.equal(sriDepuisHex(V2.sha256), V2.sri);
  });

  test('séquence v1 -> v2 -> v1 : comportements différents, une balise par version', async () => {
    const { obtenirMoteur, journalScripts } = preparer();
    const a = await obtenirMoteur('v1', V1.sha256);
    const b = await obtenirMoteur('v2', V2.sha256);
    const c = await obtenirMoteur('v1', V1.sha256);
    assert.deepEqual([a.version, b.version, c.version], ['v1', 'v2', 'v1']);
    assert.deepEqual([verdict(a), verdict(b), verdict(c)], ['Bonne réponse', 'Bravo (v2)', 'Bonne réponse']);
    assert.deepEqual(journalScripts, [V1.fichier, V2.fichier]);
    assert.notEqual(a, c, 'deux instances distinctes issues d\'une fabrique chargée une fois');
  });

  test('deux chargements concurrents de même clé : une seule balise', async () => {
    const { obtenirMoteur, journalScripts } = preparer();
    const [a, b] = await Promise.all([obtenirMoteur('v1', V1.sha256), obtenirMoteur('v1', V1.sha256)]);
    assert.equal(a.version, 'v1');
    assert.equal(b.version, 'v1');
    assert.deepEqual(journalScripts, [V1.fichier]);
  });

  test('deux premières demandes simultanées d\'empreintes différentes : l\'une refusée, aucune balise pour elle', async () => {
    const { obtenirMoteur, journalScripts } = preparer();
    const [ok, ko] = await Promise.allSettled([obtenirMoteur('v1', V1.sha256), obtenirMoteur('v1', V2.sha256)]);
    assert.equal(ok.status, 'fulfilled');
    assert.equal(ko.status, 'rejected');
    assert.match(ko.reason.message, /empreinte discordante/);
    assert.deepEqual(journalScripts, [V1.fichier]);
  });

  test('version inconnue du registre ou paramètres invalides : refus, aucune balise', async () => {
    const { obtenirMoteur, journalScripts } = preparer({ moteurs: [V1] });
    await assert.rejects(obtenirMoteur('v2', V2.sha256), /inconnu/);
    await assert.rejects(obtenirMoteur('../x', V1.sha256), /invalide/);
    await assert.rejects(obtenirMoteur('v1', 'sha256:' + V1.sha256), /invalide/);
    assert.deepEqual(journalScripts, []);
  });

  test('réassignation du registre entier sans effet (affectation et defineProperty)', async () => {
    const { obtenirMoteur } = preparer();
    await obtenirMoteur('v1', V1.sha256);
    const avant = global.window.FondaMoteurs;
    const factice = { v1: { version: 'v1', creerMoteur: () => ({ version: 'v1', pirate: true }) } };
    try { global.window.FondaMoteurs = factice; } catch { /* mode strict : TypeError, attendu */ }
    assert.throws(() => Object.defineProperty(global.window, 'FondaMoteurs', { value: factice }), TypeError);
    assert.equal(global.window.FondaMoteurs, avant);
    const m = await obtenirMoteur('v1', V1.sha256);
    assert.equal(m.pirate, undefined);
    assert.equal(verdict(m), 'Bonne réponse');
  });

  test('écrasement d\'une version déjà enregistrée sans effet', async () => {
    const { obtenirMoteur } = preparer();
    await obtenirMoteur('v1', V1.sha256);
    const R = global.window.FondaMoteurs;
    const pirate = { version: 'v1', creerMoteur: () => ({ version: 'v1', pirate: true }) };
    try { R.v1 = pirate; } catch { /* attendu */ }
    assert.throws(() => Object.defineProperty(R, 'v1', { value: pirate }), TypeError);
    assert.equal((await obtenirMoteur('v1', V1.sha256)).pirate, undefined);
    // Le fichier v1 réexécuté (autre balise) ne remplace pas non plus l'entrée existante.
    vm.runInNewContext(CODE_V2.replace("var VERSION = 'v2';", "var VERSION = 'v1';"), { self: global.window });
    assert.equal(verdict(await obtenirMoteur('v1', V1.sha256)), 'Bonne réponse');
  });

  test('registre préexistant incompatible (réassignable) : refus', async () => {
    const { obtenirMoteur } = preparer();
    global.window.FondaMoteurs = { v1: { version: 'v1', creerMoteur: () => ({ version: 'v1' }) } };
    await assert.rejects(obtenirMoteur('v1', V1.sha256));
  });

  test('version présente dans le registre sans avoir été chargée par ce chargeur : refus, aucune balise', async () => {
    const { obtenirMoteur, journalScripts } = preparer();
    vm.runInNewContext(CODE_V1, { self: global.window }); // enregistrée hors chargeur
    await assert.rejects(obtenirMoteur('v1', V1.sha256), /sans avoir été chargé/);
    assert.deepEqual(journalScripts, []);
  });

  test('échec de chargement puis nouvelle tentative : nouvelle balise, succès', async () => {
    const echecs = new Set([V1.fichier]);
    const { obtenirMoteur, journalScripts } = preparer({ echecs });
    await assert.rejects(obtenirMoteur('v1', V1.sha256), /chargement impossible/);
    echecs.clear();
    assert.equal((await obtenirMoteur('v1', V1.sha256)).version, 'v1');
    assert.deepEqual(journalScripts, [V1.fichier, V1.fichier]);
  });

  test('chargé SANS export : refus, clé purgée, nouvel essai = nouvelle balise (relecture Codex étape 2, #4)', async () => {
    const vide = '/* script servi sans enregistrement */';
    const sha = digest(vide);
    const V2v = { ...V2, sha256: sha.toString('hex'), sri: 'sha256-' + sha.toString('base64') };
    const { obtenirMoteur, journalScripts } = preparer({ moteurs: [V1, V2v] });
    global.document = creerDocumentFactice({ journalScripts, remplacements: { [V2.fichier]: vide } });
    await assert.rejects(obtenirMoteur('v2', V2v.sha256), /sans exposer/);
    await assert.rejects(obtenirMoteur('v2', V2v.sha256), /sans exposer/);
    assert.deepEqual(journalScripts, [V2.fichier, V2.fichier], 'chaque essai doit recharger réellement');
  });

  test('instance.version ≠ version demandée : refus, et nouvel essai = nouvelle balise', async () => {
    const code = CODE_V2.replace("version: VERSION,\n    valider", "version: 'v1',\n    valider");
    assert.notEqual(code, CODE_V2);
    const sha = digest(code);
    const V2b = { ...V2, sha256: sha.toString('hex'), sri: 'sha256-' + sha.toString('base64') };
    const { obtenirMoteur } = preparer({ moteurs: [V1, V2b] });
    const journal = [];
    global.document = creerDocumentFactice({ journalScripts: journal, remplacements: { [V2.fichier]: code } });
    await assert.rejects(obtenirMoteur('v2', V2b.sha256), /instance\.version/);
    await assert.rejects(obtenirMoteur('v2', V2b.sha256), /instance\.version/);
    assert.equal(journal.length, 2);
  });
});

// --- Calendrier FONDA v2 : accueil « Notions de la semaine » et page=calendrier -----
// Données RÉELLES (calendar.json, catalogue, référentiel committés) ; la date est
// pilotée (mock de Date uniquement — setTimeout reste réel pour le harnais).
const { mock: mockCal } = require('node:test');
const CALENDRIER_REEL = require('../data/calendar.json');

function tousParClasse(el, fragment, acc = []) {
  for (const c of (el && el.children) || []) {
    if (c && typeof c.className === 'string' && c.className.split(' ').includes(fragment)) acc.push(c);
    tousParClasse(c, fragment, acc);
  }
  return acc;
}
function tousParTag(el, tag, acc = []) {
  for (const c of (el && el.children) || []) {
    if (c && c.tagName === tag) acc.push(c);
    tousParTag(c, tag, acc);
  }
  return acc;
}

async function demarrerLe(dateIso, opts) {
  mockCal.timers.enable({ apis: ['Date'], now: new Date(`${dateIso}T10:00:00`) });
  try {
    return await demarrerBootstrap({ calendrier: CALENDRIER_REEL, ...opts });
  } finally {
    mockCal.timers.reset();
  }
}

describe('calendrier v2 — fonctions de vue pures', () => {
  test('etatDuJour : vacances, semaine (week-end compris), hors calendrier', () => {
    const { etatDuJour, texteBandeau } = obtenirExportsBootstrap();
    const vac = etatDuJour(CALENDRIER_REEL, new Date('2026-10-27T10:00:00'));
    assert.equal(vac.type, 'vacances');
    assert.equal(texteBandeau(vac), 'Vacances de la Toussaint · reprise lun 2 nov');
    const sem = etatDuJour(CALENDRIER_REEL, new Date('2026-11-04T10:00:00'));
    assert.equal(sem.type, 'semaine');
    assert.equal(texteBandeau(sem), 'Semaine 45 · P2 en cours');
    assert.equal(etatDuJour(CALENDRIER_REEL, new Date('2026-11-08T18:00:00+01:00')).semaine.iso_week, 45, 'le dimanche (heure de Paris) reste dans la semaine');
    const p3 = etatDuJour(CALENDRIER_REEL, new Date('2027-01-12T10:00:00'));
    assert.equal(p3.type, 'periode');
    assert.equal(texteBandeau(p3), 'P3 en cours');
    assert.equal(texteBandeau(etatDuJour({}, new Date('2026-08-01T10:00:00'))), 'Hors période scolaire');
  });

  test('plageCourte : même mois / deux mois', () => {
    const { plageCourte } = obtenirExportsBootstrap();
    assert.equal(plageCourte('2026-11-02', '2026-11-06'), '2–6 nov');
    assert.equal(plageCourte('2026-11-30', '2026-12-04'), '30 nov–4 déc');
  });

  test('caseDepuisEntree : couleur LUE dans difficulte.valeur, étoiles du palier, lien seulement si publiée ET au catalogue', () => {
    const { caseDepuisEntree } = obtenirExportsBootstrap();
    const notions = new Map(REFERENTIEL.notions.map((n) => [n.id, n]));
    const publies = new Set(['set_fonda_grandeurs-mesures_nI_02']);
    const base = { notion_id: 'maths.grandeurs-mesures', matiere: 'maths', palier: 'nI', bande: 'c4-milieu', statut: 'publie', set_id: 'set_fonda_grandeurs-mesures_nI_02', difficulte: { valeur: 'rouge', source: 'priorite_initiale' } };
    const c = caseDepuisEntree(base, { notions, publies });
    assert.equal(c.setId, 'set_fonda_grandeurs-mesures_nI_02');
    assert.equal(c.difficulte, 'rouge');
    assert.equal(c.etoiles, '★');
    assert.equal(c.notion, notions.get('maths.grandeurs-mesures').libelle);
    assert.equal(caseDepuisEntree({ ...base, difficulte: { valeur: 'vert', source: 'stats_cartes' } }, { notions, publies }).difficulte, 'vert');
    assert.equal(caseDepuisEntree({ ...base, palier: 'nF' }, { notions, publies }).etoiles, '★★');
    assert.equal(caseDepuisEntree(base, { notions, publies: new Set() }).setId, null, 'set_id absent du catalogue chargé : pas de lien');
    const planifiee = { ...base, statut: 'planifie' };
    delete planifiee.set_id;
    assert.equal(caseDepuisEntree(planifiee, { notions, publies }).setId, null);
  });

  test('construireVueCalendrier (bande milieu) : P2 affichée, 14 cases dont 3 liées ; P3–P5 vides (grisées)', () => {
    const { construireVueCalendrier } = obtenirExportsBootstrap();
    const vue = construireVueCalendrier({ calendrier: CALENDRIER_REEL, catalogue: CATALOGUE, referentiel: REFERENTIEL, bande: 'c4-milieu', maintenant: new Date('2026-11-10T10:00:00') });
    const [p2, ...autres] = vue.periodes;
    assert.equal(p2.id, 'P2');
    assert.equal(p2.vide, false, 'P2 a des entrées : jamais grisée en entier, même genere:false');
    assert.equal(p2.genere, false);
    assert.equal(p2.statut, 'en_cours');
    assert.equal(p2.semaines.length, 7);
    assert.equal(p2.semaines.filter((s) => s.courante).map((s) => s.isoWeek).join(), '46');
    const cases = p2.semaines.flatMap((s) => s.cases);
    assert.equal(cases.length, 14);
    assert.deepEqual(cases.filter((c) => c.setId).map((c) => c.setId), [
      'set_fonda_grandeurs-mesures_nI_02', 'set_fonda_nombres-fractions-relatifs_nI_03', 'set_fonda_grandeurs-mesures_nI_02',
    ]);
    assert.ok(cases.every((c) => c.matiere !== 'français' || c.setId === null), 'français : tout planifié');
    assert.ok(p2.semaines.every((s) => s.cases[0].matiere === 'maths' && s.cases[1].matiere === 'français'));
    assert.deepEqual(autres.map((p) => [p.id, p.vide]), [['P3', true], ['P4', true], ['P5', true]]);
    const c3 = construireVueCalendrier({ calendrier: CALENDRIER_REEL, catalogue: CATALOGUE, referentiel: REFERENTIEL, bande: 'c3', maintenant: new Date('2026-11-10T10:00:00') });
    assert.ok(c3.periodes.every((p) => p.vide), 'bande c3 : aucun contenu pour l\'instant');
  });

  test('notionsDeLaSemaine : semaine courante ; en vacances, la semaine de la reprise', () => {
    const { notionsDeLaSemaine } = obtenirExportsBootstrap();
    const args = { calendrier: CALENDRIER_REEL, catalogue: CATALOGUE, referentiel: REFERENTIEL, bande: 'c4-milieu' };
    const s48 = notionsDeLaSemaine({ ...args, maintenant: new Date('2026-11-25T10:00:00') });
    assert.equal(s48.semaine.isoWeek, 48);
    assert.equal(s48.reprise, false);
    assert.deepEqual(s48.cases.map((c) => c.setId), ['set_fonda_nombres-fractions-relatifs_nI_03', null]);
    const toussaint = notionsDeLaSemaine({ ...args, maintenant: new Date('2026-10-27T10:00:00') });
    assert.equal(toussaint.reprise, true);
    assert.equal(toussaint.semaine.isoWeek, 45);
    assert.equal(toussaint.cases.length, 2);
    const noel = notionsDeLaSemaine({ ...args, maintenant: new Date('2026-12-24T10:00:00') });
    assert.equal(noel.semaine, null, 'reprise de janvier non programmée : rien d\'inventé');
    assert.equal(notionsDeLaSemaine({ ...args, bande: 'c3', maintenant: new Date('2026-11-25T10:00:00') }).cases.length, 0);
  });
});

describe('?fonda=1 — accueil « Notions de la semaine » (porte : sélecteur de niveau)', () => {
  test('sans niveau (rien en mémoire) : sélecteur d\'abord, liens vers l\'accueil (pas la page niveau)', async () => {
    global.localStorage = { getItem: () => null, setItem() {} };
    const root = await demarrerLe('2026-11-04', { search: '?fonda=1' });
    delete global.localStorage;
    const boutons = tousParClasse(root, 'fonda-niveau-picker__bouton');
    assert.deepEqual(boutons.map((b) => b.textContent), ['6e', '5e', '4e', '3e']);
    assert.ok(boutons.every((b) => /\?fonda=1&niveau=[3-6]e$/.test(b.href)), boutons.map((b) => b.href).join());
  });

  test('niveau 5e : les 2 fiches de la semaine (maths liée, français grisé sans lien), choix mémorisé', async () => {
    const ecritures = [];
    global.localStorage = { getItem: () => null, setItem: (k, v) => ecritures.push([k, v]) };
    const root = await demarrerLe('2026-11-04', { search: '?fonda=1&niveau=5e' });
    delete global.localStorage;
    assert.deepEqual(ecritures, [['box_fonda_niveau', '5e']]);
    assert.ok(tousParTag(root, 'h2').some((h) => h.textContent === 'Notions de la semaine'));
    const tuiles = tousParClasse(root, 'fonda-cal-tuile');
    assert.equal(tuiles.length, 2);
    assert.equal(tuiles[0].tagName, 'a');
    assert.match(tuiles[0].href, /\?fonda=1&page=carte&set=set_fonda_grandeurs-mesures_nI_02$/);
    // Nom accessible = texte de la tuile : matière, notion, palier (texte lecteur d'écran),
    // difficulté et état — jamais la couleur seule, jamais d'aria-label sur une div.
    assert.match(tuiles[0].textContent, /Mathématiques.*palier Initial\..*difficulté forte.*Disponible/);
    assert.equal(tuiles[1].tagName, 'div', 'case planifiée : jamais un lien');
    assert.ok(tuiles[1].className.includes('fonda-cal-tuile--planifiee'));
    assert.match(tuiles[1].textContent, /Français.*palier Initial\..*En préparation/);
    assert.ok(tuiles.every((t) => !('aria-label' in t.attributes)));
    const liens = tousParTag(root, 'a').map((a) => a.href);
    assert.ok(liens.some((h) => /page=calendrier&bande=c4-milieu$/.test(h)), 'lien vers le calendrier de la bande');
    assert.ok(liens.some((h) => /choix=niveau$/.test(h)), 'changer de niveau');
    const prof = tousParClasse(root, 'fonda-cal-prof');
    assert.equal(prof.length, 1, 'accès enseignant mis en avant');
    assert.match(prof[0].href, /page=niveau&niveau=5e&semaine=45$/, 'la semaine affichée est transmise');
  });

  test('niveau mémorisé (switch BOX -> FONDA sans paramètre) : accueil direct ; ?choix=niveau rouvre le sélecteur', async () => {
    global.localStorage = { getItem: () => '4e', setItem() {} };
    const root = await demarrerLe('2026-11-04', { search: '?fonda=1' });
    assert.equal(tousParClasse(root, 'fonda-cal-tuile').length, 2);
    const choix = await demarrerLe('2026-11-04', { search: '?fonda=1&choix=niveau' });
    delete global.localStorage;
    assert.equal(tousParClasse(choix, 'fonda-niveau-picker__bouton').length, 4);
  });

  test('pendant les vacances : bandeau vacances + les fiches de la reprise', async () => {
    const root = await demarrerLe('2026-10-27', { search: '?fonda=1&niveau=5e' });
    const flaps = tousParClasse(root, 'fonda-flaps')[0];
    assert.equal(flaps.attributes['aria-label'], 'Vacances de la Toussaint · reprise lun 2 nov');
    assert.ok(tousParClasse(root, 'fonda-cal-intro').some((p) => /^À la reprise — semaine 45/.test(p.textContent)));
    assert.equal(tousParClasse(root, 'fonda-cal-tuile').length, 2);
  });

  test('niveau 6e (bande sans contenu) : message, aucune tuile, aucune exception', async () => {
    const root = await demarrerLe('2026-11-04', { search: '?fonda=1&niveau=6e' });
    assert.equal(tousParClasse(root, 'fonda-cal-tuile').length, 0);
    assert.ok(tousParClasse(root, 'fonda-cal-intro').some((p) => /Pas de fiche programmée/.test(p.textContent)));
  });

  test('catalogue indisponible : message visible, jamais de page blanche', async () => {
    const root = await demarrerLe('2026-11-04', { search: '?fonda=1&niveau=5e', catalogue: null });
    assert.match(texteDe(root), /Calendrier indisponible/);
  });
});

describe('?fonda=1&page=calendrier — page d\'affichage par période', () => {
  test('bande milieu : P2 dépliable avec 14 tuiles dont 3 liens ; P3–P5 grisées « Non générée »', async () => {
    const root = await demarrerLe('2026-11-04', { search: '?fonda=1&page=calendrier' });
    const periodes = tousParClasse(root, 'fonda-cal-periode');
    assert.equal(periodes.length, 4);
    assert.equal(periodes[0].className, 'fonda-cal-periode');
    assert.equal(tousParClasse(root, 'fonda-cal-periode--vide').length, 3);
    const tuiles = tousParClasse(periodes[0], 'fonda-cal-tuile');
    assert.equal(tuiles.length, 14);
    assert.equal(tuiles.filter((t) => t.tagName === 'a').length, 3);
    assert.equal(tousParClasse(root, 'fonda-cal-tuile--planifiee').length, 11);
    const tete = tousParClasse(periodes[0], 'fonda-cal-periode__tete')[0];
    assert.equal(tete.attributes['aria-expanded'], 'true', 'période en cours dépliée');
    const semaines = tousParClasse(periodes[0], 'fonda-cal-semaines')[0];
    tete.__click();
    assert.equal(semaines.hidden, true);
    assert.equal(tete.attributes['aria-expanded'], 'false');
    assert.equal(tousParClasse(root, 'fonda-cal-semaine--courante').length, 1);
    assert.match(texteDe(periodes[1]), /À générer avant la reprise/);
  });

  test('sélecteur de bande : 3 bandes, active marquée ; bande c4-fin vide -> « Pas encore de programme »', async () => {
    const root = await demarrerLe('2026-11-04', { search: '?fonda=1&page=calendrier&bande=c4-fin' });
    const liens = tousParClasse(root, 'fonda-cal-bandes__lien');
    assert.deepEqual(liens.map((a) => a.textContent), ['6e', '5e – 4e', '3e']);
    assert.equal(liens[2].attributes['aria-current'], 'page');
    assert.ok(liens.every((a) => /page=calendrier&bande=/.test(a.href)));
    assert.ok(tousParClasse(root, 'fonda-message').some((p) => /Pas encore de programme pour les 3e/.test(p.textContent)));
    assert.equal(tousParClasse(root, 'fonda-cal-tuile').length, 0);
  });

  test('bande inconnue dans l\'URL : repli sur la bande milieu, jamais une valeur arbitraire', async () => {
    const root = await demarrerLe('2026-11-04', { search: '?fonda=1&page=calendrier&bande=__proto__' });
    const actif = tousParClasse(root, 'fonda-cal-bandes__lien--actif');
    assert.equal(actif.length, 1);
    assert.equal(actif[0].textContent, '5e – 4e');
  });

  test('page niveau (parcours existant) avec le vrai calendrier v2 : liens de la seule fiche publiée, jamais de lien planifié', async () => {
    const root = await demarrerLe('2026-11-04', { search: '?fonda=1&page=niveau&niveau=4e' });
    const liens = tousParClasse(root, 'fonda-lien-classe');
    assert.equal(liens.length, 5, '401..405 pour grandeurs-mesures uniquement');
    assert.ok(liens.every((li) => /_grandeurs-mesures$/.test(decodeURIComponent(li.children[1].href))));
  });
});

describe('calendrier v2 — corrections après relecture Codex', () => {
  test('jour du calendrier = date à Paris, quel que soit le fuseau de l\'appareil', () => {
    const { etatDuJour } = obtenirExportsBootstrap();
    // 8 nov. 2026, 23 h 30 UTC = 9 nov., 0 h 30 à Paris : semaine 46, pas 45.
    assert.equal(etatDuJour(CALENDRIER_REEL, new Date('2026-11-08T23:30:00Z')).semaine.iso_week, 46);
    assert.equal(etatDuJour(CALENDRIER_REEL, new Date('2026-11-08T22:30:00Z')).semaine.iso_week, 45);
  });

  test('week-end : l\'accueil (S45) et « Défis par classe » montrent la même semaine', async () => {
    const accueil = await demarrerLe('2026-11-08', { search: '?fonda=1&niveau=4e' });
    const prof = tousParClasse(accueil, 'fonda-cal-prof')[0];
    assert.match(prof.href, /semaine=45$/);
    const page = await demarrerLe('2026-11-08', { search: prof.href.slice(prof.href.indexOf('?')) });
    assert.equal(tousParClasse(page, 'fonda-lien-classe').length, 5, '401..405, pas « Aucun défi »');
  });

  test('vacances : « Défis par classe » vise la semaine de la reprise', async () => {
    const accueil = await demarrerLe('2026-10-27', { search: '?fonda=1&niveau=5e' });
    assert.match(tousParClasse(accueil, 'fonda-cal-prof')[0].href, /semaine=45$/);
  });

  test('page niveau : un set_id absent du catalogue chargé ne donne aucun lien (calendrier en retard sur un retrait)', async () => {
    const catalogue = { ...CATALOGUE, lots: CATALOGUE.lots.filter((l) => l.set_id !== 'set_fonda_grandeurs-mesures_nI_02') };
    const root = await demarrerLe('2026-11-04', { search: '?fonda=1&page=niveau&niveau=5e', catalogue });
    assert.equal(tousParClasse(root, 'fonda-lien-classe').length, 0);
    assert.match(texteDe(root), /Aucun défi programmé pour 5e/);
  });

  test('calendrier et catalogue lus en cache « no-cache » (fiche publiée visible aussitôt)', async () => {
    const journalOptions = [];
    await demarrerLe('2026-11-04', { search: '?fonda=1&niveau=5e', journalOptions });
    const opts = new Map(journalOptions);
    assert.deepEqual(opts.get('fonda/data/calendar.json'), { cache: 'no-cache' });
    assert.deepEqual(opts.get('fonda/data/catalogue-fonda.json'), { cache: 'no-cache' });
  });
});

describe('page niveau ouverte directement : même règle de jour que l\'accueil (Paris, lundi→dimanche)', () => {
  test('dimanche 8 nov. et 2 nov. 0 h 30 à Paris : semaine 45, comme l\'accueil', () => {
    const { semaineCourante, etatDuJour } = obtenirExportsBootstrap();
    for (const instant of ['2026-11-08T12:00:00Z', '2026-11-01T23:30:00Z']) {
      const d = new Date(instant);
      assert.equal(semaineCourante(CALENDRIER_REEL, d).iso_week, 45, instant);
      assert.equal(etatDuJour(CALENDRIER_REEL, d).semaine.iso_week, 45, instant);
    }
    assert.equal(semaineCourante(CALENDRIER_REEL, new Date('2026-11-01T22:30:00Z')), null, 'encore en vacances à Paris');
    for (const jour of ['2026-12-19T10:00:00Z', '2026-12-20T10:00:00Z']) {
      assert.equal(semaineCourante(CALENDRIER_REEL, new Date(jour)), null, `${jour} : vacances de Noël prioritaires`);
      assert.equal(etatDuJour(CALENDRIER_REEL, new Date(jour)).type, 'vacances');
    }
  });

  test('accès direct sans semaine= le dimanche : liens par classe affichés', async () => {
    const root = await demarrerLe('2026-11-08', { search: '?fonda=1&page=niveau&niveau=4e' });
    assert.equal(tousParClasse(root, 'fonda-lien-classe').length, 5);
  });
});
