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

function creerElementFactice() {
  return {
    innerHTML: '', textContent: '', className: '', href: '',
    children: [],
    classList: { add() {}, remove() {} },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(n) { this.children.push(n); return n; },
    addEventListener() {},
  };
}

function creerDocumentFactice() {
  const body = creerElementFactice();
  let root = null;
  return {
    body,
    createElement: () => creerElementFactice(),
    getElementById: (id) => (id === 'fondaRoot' ? root : null),
    addEventListener() {},
    _definirRoot(r) { root = r; },
  };
}

// fetch factice : répond avec les vraies données (classes/referentiel), le calendrier
// de test, et échoue sur tout le reste.
function creerFetchFactice({ calendrier = CALENDRIER } = {}) {
  return async (chemin) => {
    const corps = chemin.includes('classes.json') ? CLASSES
      : chemin.includes('referentiel.json') ? REFERENTIEL
        : chemin.includes('calendar.json') ? calendrier
          : null;
    if (corps === null) return { ok: false };
    return { ok: true, json: async () => corps };
  };
}

async function demarrerBootstrap({ search, calendrier }) {
  const doc = creerDocumentFactice();
  // document.body.appendChild('fondaRoot' div) -> on l'intercepte pour pouvoir le relire
  const originalAppendChild = doc.body.appendChild.bind(doc.body);
  doc.body.appendChild = (el) => { doc._definirRoot(el); return originalAppendChild(el); };

  global.document = doc;
  global.window = { location: { search, origin: 'https://ericduchateau.github.io', pathname: '/box/index.html' } };
  global.fetch = creerFetchFactice({ calendrier });
  global.window.FondaLiens = require('../engine/liens.js');
  global.window.FondaEvenements = require('../engine/evenements.js');

  delete require.cache[require.resolve('./bootstrap.js')];
  require('./bootstrap.js');

  // Laisse le temps à la chaîne de promesses (fetch factice, toujours déjà résolu) de
  // se dérouler complètement avant d'inspecter le DOM factice.
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));

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
});
