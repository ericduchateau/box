// Tests du chantier « secrets hors du dépôt » — phase 1.
// Exécutent le VRAI JavaScript des noeuds Code des JSON générés (pas une copie), sur
// des entrées simulées : $('Noeud').first().json, $json, this.helpers.
//
// Usage : node --test n8n/secrets-2026-10-13/secrets.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  construireFondaGeneration, construireSuppression, PLACEHOLDERS,
  CATALOGUE_PROD_ID, SOURCE_FONDA, SOURCE_SUPPRESSION,
} = require('./build.js');

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
const LOT = require('../../fonda/data/lots-fonda-calibration/fr-comprendre-consigne_nI.json');
const ALEA = '0123456789abcdef';

// Configure les placeholders comme Éric le fera dans n8n après import.
function configurer(jsCode, remplacements) {
  return Object.entries(remplacements).reduce((c, [k, v]) => c.split(k).join(v), jsCode);
}

// ---------------------------------------------------------------------------
describe('box-fonda-generation — fichiers générés à jour', () => {
  for (const [rel, estTest] of [['test/box-fonda-generation-TEST.json', true], ['prod/box-fonda-generation.json', false]]) {
    test(`${rel} = sortie actuelle de build.js (aucune dérive manuelle)`, () => {
      const attendu = construireFondaGeneration(JSON.parse(fs.readFileSync(SOURCE_FONDA, 'utf8')), { test: estTest });
      assert.deepEqual(lire(rel), attendu);
    });
  }
});

describe('box-fonda-generation (prod) — code généré par n8n, adresse routée, deux contrats', () => {
  const w = lire('prod/box-fonda-generation.json');
  const js = configurer(noeud(w, 'Preparer fichier et destinataire').parameters.jsCode, {
    [PLACEHOLDERS.emailFrancais]: 'fr@exemple.test',
    [PLACEHOLDERS.emailMaths]: 'maths@exemple.test',
  });

  test('noeud natif Crypto/Generate (hex, 16) branché entre "Coller lot FONDA" et "Preparer fichier"', () => {
    const c = noeud(w, 'Generer code suppression');
    assert.equal(c.type, 'n8n-nodes-base.crypto');
    assert.equal(c.typeVersion, 1, 'v1 : la v2 n\'est pas reconnue par l\'éditeur de l\'instance');
    assert.deepEqual(c.parameters, { action: 'generate', dataPropertyName: 'code_aleatoire', encodingType: 'hex', stringLength: 16 });
    assert.equal(w.connections['Coller lot FONDA'].main[0][0].node, 'Generer code suppression');
    assert.equal(w.connections['Generer code suppression'].main[0][0].node, 'Preparer fichier et destinataire');
    assert.doesNotMatch(JSON.stringify(w), /require\(['"]crypto['"]\)/);
  });

  test('le code/l\'adresse du JSON collé sont IGNORÉS ; le fichier Drive porte ceux de n8n', async () => {
    const colle = { ...LOT, code_suppression: 'SUP-PUBLIC00', prof_email: 'pirate@exemple.test' };
    const [sortie] = await executerNoeud(js, { json: { lot_json: colle, code_aleatoire: ALEA } });
    const fichier = JSON.parse(sortie.binary.data.buffer.toString('utf8'));
    assert.equal(fichier.code_suppression, 'SUP-0123456789ABCDEF');
    assert.equal(fichier.prof_email, 'fr@exemple.test');
    assert.equal(sortie.json.code_suppression, 'SUP-0123456789ABCDEF');
    assert.equal(sortie.json.prof_email_route, 'fr@exemple.test');
    assert.deepEqual(fichier.cartes, LOT.cartes, 'contenu des cartes inchangé');
  });

  test('lot commité SANS code ni adresse (contrat cible) : fichier Drive complété quand même', async () => {
    const { code_suppression, prof_email, ...propre } = LOT;
    const [sortie] = await executerNoeud(js, { json: { lot_json: JSON.stringify(propre), code_aleatoire: ALEA } });
    const fichier = JSON.parse(sortie.binary.data.buffer.toString('utf8'));
    assert.equal(fichier.code_suppression, 'SUP-0123456789ABCDEF');
    assert.equal(fichier.prof_email, 'fr@exemple.test');
  });

  test('maths -> adresse maths', async () => {
    const lotMaths = require('../../fonda/data/lots-fonda-calibration/maths-resolution-problemes_nI.json');
    const [sortie] = await executerNoeud(js, { json: { lot_json: lotMaths, code_aleatoire: ALEA } });
    assert.equal(sortie.json.prof_email_route, 'maths@exemple.test');
  });

  for (const [libelle, alea] of [['absent', undefined], ['vide', ''], ['trop court', 'abc'], ['non hex', 'zzzzzzzzzzzzzzzz'], ['nombre', 1234567890123456]]) {
    test(`aléa ${libelle} -> refus explicite (jamais de fichier sans code)`, async () => {
      await assert.rejects(executerNoeud(js, { json: { lot_json: LOT, code_aleatoire: alea } }), /Code aleatoire absent ou invalide/);
    });
  }

  test('placeholder d\'adresse non remplacé -> refus d\'envoyer', async () => {
    const brut = noeud(w, 'Preparer fichier et destinataire').parameters.jsCode;
    await assert.rejects(executerNoeud(brut, { json: { lot_json: LOT, code_aleatoire: ALEA } }), /Adresse de relecture non configuree/);
  });

  test('le mail de relecture contient EXACTEMENT le code écrit dans le fichier Drive', async () => {
    const [prep] = await executerNoeud(js, { json: { lot_json: LOT, code_aleatoire: ALEA } });
    const codeFichier = JSON.parse(prep.binary.data.buffer.toString('utf8')).code_suppression;
    const [mail] = await executerNoeud(noeud(w, 'Preparer Email Validation').parameters.jsCode, {
      noeuds: { 'Preparer fichier et destinataire': prep.json, 'Upload Flashcards': { id: 'FILEID' } },
    });
    assert.ok(mail.json.email_html.includes(encodeURIComponent(codeFichier)), 'code absent du lien');
    assert.ok(mail.json.email_html.includes(`<code>${codeFichier}</code>`), 'code absent du rappel');
    assert.match(mail.json.email_html, /\/box-select\?file_id=FILEID/);
    assert.equal(mail.json.prof_email, 'fr@exemple.test');
  });

  test('aucune adresse e-mail réelle dans le JSON prod commité', () => {
    const emails = JSON.stringify(w).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
    assert.deepEqual(emails, []);
  });

  test('conservation des exécutions inchangée (décision Éric : historique complet gardé) ; inactif', () => {
    const source = JSON.parse(fs.readFileSync(SOURCE_FONDA, 'utf8'));
    assert.deepEqual(w.settings, source.settings);
    assert.equal(w.active, false);
  });
});

describe('box-fonda-generation (TEST) — isolé de la prod', () => {
  const w = lire('test/box-fonda-generation-TEST.json');
  test('dossier Drive de test, destinataire de test, lien /box-select-test', async () => {
    assert.equal(noeud(w, 'Upload Flashcards').parameters.folderId.value, PLACEHOLDERS.dossierDriveTest);
    const js = configurer(noeud(w, 'Preparer fichier et destinataire').parameters.jsCode, { [PLACEHOLDERS.emailTest]: 'test@exemple.test' });
    const [prep] = await executerNoeud(js, { json: { lot_json: LOT, code_aleatoire: ALEA } });
    assert.equal(prep.json.prof_email_route, 'test@exemple.test');
    const lotMaths = require('../../fonda/data/lots-fonda-calibration/maths-resolution-problemes_nI.json');
    const [prepMaths] = await executerNoeud(js, { json: { lot_json: lotMaths, code_aleatoire: ALEA } });
    assert.equal(prepMaths.json.prof_email_route, 'test@exemple.test', 'les deux matières vont au destinataire de test');
    const [mail] = await executerNoeud(noeud(w, 'Preparer Email Validation').parameters.jsCode, {
      noeuds: { 'Preparer fichier et destinataire': prep.json, 'Upload Flashcards': { id: 'F' } },
    });
    assert.match(mail.json.email_html, /\/box-select-test\?file_id=F/);
    assert.doesNotMatch(mail.json.email_html, /\/box-select\?/);
    assert.match(noeud(w, 'Email Validation').parameters.subject, /^=\[TEST\]/);
  });
  test('aucun identifiant de dossier Drive de prod', () => {
    assert.doesNotMatch(JSON.stringify(w), /11KWo13pczVB_eOXw-FHUXWuutfSQqbbT/);
  });
});

// ---------------------------------------------------------------------------
// box-suppression : logique testée sur la transformation. Source = export frais du
// live s'il est présent ; sinon l'export du 05/10, UNIQUEMENT pour éprouver la
// transformation (aucun fichier prod/ n'en est généré).
const SOURCE_SUPP_EFFECTIVE = fs.existsSync(SOURCE_SUPPRESSION)
  ? SOURCE_SUPPRESSION
  : path.join(__dirname, '..', 'backup-2026-10-05', 'box-suppression.json');

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

  test('les JSON box-suppression ne sont générés QUE depuis l\'export frais du live', () => {
    const presents = ['test/box-suppression-TEST.json', 'prod/box-suppression.json'].filter((f) => fs.existsSync(path.join(__dirname, f)));
    if (!fs.existsSync(SOURCE_SUPPRESSION)) {
      assert.deepEqual(presents, [], 'JSON de suppression présents sans export frais du live');
    } else {
      const live = JSON.parse(fs.readFileSync(SOURCE_SUPPRESSION, 'utf8'));
      assert.deepEqual(lire('prod/box-suppression.json'), construireSuppression(live, { test: false }));
      assert.deepEqual(lire('test/box-suppression-TEST.json'), construireSuppression(live, { test: true }));
    }
  });
});
