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
