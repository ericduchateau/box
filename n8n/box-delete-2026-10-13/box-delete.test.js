// Tests du durcissement BOX de /box-delete (2026-10-13).
// Exécutent le VRAI JavaScript du noeud « Verifier code » généré, sur des entrées
// simulées ($('Noeud').first().json, this.helpers.getBinaryDataBuffer).
//
// Usage : node --test n8n/box-delete-2026-10-13/box-delete.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { construireSuppression, PLACEHOLDERS, CATALOGUE_PROD_ID, SOURCE_SUPPRESSION } = require('./build.js');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Exécute le jsCode d'un noeud Code n8n (mode "run once for all items").
async function executerNoeud(jsCode, { json = {}, noeuds = {}, binaire = null }) {
  const $ = (nom) => {
    if (!(nom in noeuds)) throw new Error(`noeud simulé absent : ${nom}`);
    return { first: () => ({ json: noeuds[nom] }), item: { json: noeuds[nom] } };
  };
  const helpers = {
    getBinaryDataBuffer: async () => binaire,
    prepareBinaryData: async (buffer, fileName, mimeType) => ({ buffer, fileName, mimeType }),
  };
  const fn = new AsyncFunction('$', '$json', 'Buffer', jsCode);
  return fn.call({ helpers }, $, json, Buffer);
}

const noeud = (w, nom) => w.nodes.find((n) => n.name === nom);
const lire = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, rel), 'utf8'));

// ---------------------------------------------------------------------------
// box-suppression : source = export frais du live (2026-10-13).
const SOURCE_SUPP_EFFECTIVE = SOURCE_SUPPRESSION;

describe(`box-suppression — transformation (source : ${path.relative(path.join(__dirname, '..', '..'), SOURCE_SUPP_EFFECTIVE)})`, () => {
  const source = JSON.parse(fs.readFileSync(SOURCE_SUPP_EFFECTIVE, 'utf8'));
  const prod = construireSuppression(source, { test: false });
  const essai = construireSuppression(source, { test: true });
  const jsVerifier = noeud(prod, 'Verifier code').parameters.jsCode;

  const CATALOGUE = { total_sets: 2, sets: [{ id: 'box_a', drive_file_id: 'FA' }, { id: 'box_b', drive_file_id: 'FB' }] };
  async function verifier(codeDemande, codeFichier) {
    const fiche = { id: 'box_b', cartes: [{ q: 1 }], prof_email: 'p@exemple.test' };
    if (codeFichier !== '__ABSENT__') fiche.code_suppression = codeFichier;
    const [r] = await executerNoeud(jsVerifier, {
      noeuds: { 'Trouver et verifier': { found: true, set_id: 'box_b', code_suppression: codeDemande, drive_file_id: 'FB', set_index: 1, catalogue: JSON.parse(JSON.stringify(CATALOGUE)) } },
      binaire: Buffer.from(JSON.stringify(fiche)),
    });
    return r.json;
  }

  const refus = [
    ['code absent des DEUX côtés (faille actuelle)', undefined, '__ABSENT__'],
    ['code requête absent', undefined, 'SUP-ABCDEFGH'],
    ['code fichier absent', 'SUP-ABCDEFGH', '__ABSENT__'],
    ['vides des deux côtés', '', ''],
    ['espaces seulement', '        ', '        '],
    ['nombre', 12345678, 12345678],
    ['objet', { a: 1 }, { a: 1 }],
    ['null des deux côtés', null, null],
    ['trop court (7)', 'SUP-ABC', 'SUP-ABC'],
    ['trop long (65)', 'X'.repeat(65), 'X'.repeat(65)],
    ['codes différents', 'SUP-ABCDEFGH', 'SUP-ABCDEFGX'],
  ];
  for (const [libelle, demande, fichier] of refus) {
    test(`refusé : ${libelle}`, async () => {
      const r = await verifier(demande, fichier);
      assert.equal(r.verified, false);
      assert.equal(r.updated_catalogue, undefined, 'aucun catalogue préparé');
    });
  }

  test('accepté : ancien format SUP- + 8 (jeux BOX existants), espaces autour tolérés', async () => {
    const r = await verifier('  SUP-ABCDEFGH ', 'SUP-ABCDEFGH');
    assert.equal(r.verified, true);
    assert.deepEqual(JSON.parse(r.updated_catalogue).sets.map((s) => s.id), ['box_a']);
  });

  test('accepté : nouveau format SUP- + 16 hex ; fichier de remplacement sans code, sans cartes, sans adresse', async () => {
    const r = await verifier('SUP-0123456789ABCDEF', 'SUP-0123456789ABCDEF');
    assert.equal(r.verified, true);
    const vide = JSON.parse(r.fichier_vide_json);
    assert.deepEqual(Object.keys(vide).sort(), ['cartes', 'id', 'supprime_le']);
    assert.deepEqual(vide.cartes, []);
    assert.equal(vide.id, 'box_b');
  });

  test('graphe : "Code OK ?" -> Vider (PATCH) -> Supprimer fichier (id relu depuis "Verifier code") -> MAJ Catalogue', () => {
    assert.equal(prod.connections['Code OK ?'].main[0][0].node, 'Vider fichier avant suppression');
    assert.equal(prod.connections['Vider fichier avant suppression'].main[0][0].node, 'Supprimer fichier');
    assert.equal(prod.connections['Supprimer fichier'].main[0][0].node, 'MAJ Catalogue');
    assert.equal(prod.connections['Code OK ?'].main[1][0].node, 'Repondre 403', 'branche refus inchangée');
    const vider = noeud(prod, 'Vider fichier avant suppression');
    assert.equal(vider.parameters.method, 'PATCH');
    assert.equal(vider.parameters.jsonBody, '={{ $json.fichier_vide_json }}');
    assert.match(noeud(prod, 'Supprimer fichier').parameters.fileId.value, /\$\('Verifier code'\)\.item\.json\.drive_file_id/);
  });

  test('prod : même webhook /box-delete, même id, catalogue de prod ; réglages de conservation inchangés', () => {
    assert.equal(prod.id, source.id);
    assert.equal(prod.nodes.find((n) => n.type === 'n8n-nodes-base.webhook').parameters.path, 'box-delete');
    assert.match(JSON.stringify(prod), new RegExp(CATALOGUE_PROD_ID));
    assert.deepEqual(prod.settings, source.settings);
    assert.deepEqual(essai.settings, source.settings);
  });

  test('TEST : webhook /box-delete-test, catalogue de test, aucun id de catalogue prod, inactif, sans id de workflow', () => {
    const wh = essai.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
    assert.equal(wh.parameters.path, 'box-delete-test');
    assert.notEqual(wh.webhookId, source.nodes.find((n) => n.type === 'n8n-nodes-base.webhook').webhookId);
    assert.doesNotMatch(JSON.stringify(essai), new RegExp(CATALOGUE_PROD_ID));
    assert.match(JSON.stringify(essai), new RegExp(PLACEHOLDERS.catalogueTest));
    assert.equal(essai.active, false);
    assert.equal(essai.id, undefined);
  });

  test('JSON commités = sortie actuelle de build.js depuis l\'export live (aucune dérive manuelle)', () => {
    assert.deepEqual(lire('prod/box-suppression.json'), construireSuppression(source, { test: false }));
    assert.deepEqual(lire('test/box-suppression-TEST.json'), construireSuppression(source, { test: true }));
  });

  test('aucune adresse e-mail ni code SUP- dans les JSON commités', () => {
    for (const f of ['prod/box-suppression.json', 'test/box-suppression-TEST.json', 'sources/box-suppression.live.json']) {
      const t = fs.readFileSync(path.join(__dirname, f), 'utf8');
      assert.doesNotMatch(t, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, f);
      assert.doesNotMatch(t, /SUP-[A-Z0-9]{4,}/, f);
    }
  });
});
