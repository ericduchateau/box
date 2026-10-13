// Test CI de toute la chaîne publiée FONDA (contrats v1, PRD §2 bis) : catalogue,
// fichiers, empreintes, attestations, référentiel, calendrier, absence de secrets.
// Échoue si un lot publié est modifié sans nouvelle relecture/attestation.
// Usage : node --test fonda/data/catalogue.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../engine/catalogue.js');

const DATA = __dirname;
const lire = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));
const CATALOGUE = lire('catalogue-fonda.json');
const REFERENTIEL = lire('referentiel.json');
const CALENDRIER = lire('calendar.json');
const sha = C.sha256WebCrypto();

// Les SEULS lots autorisés à porter une attestation « manuelle-historique » : le lot
// de validation relu par Éric le 2026-10-11 (migration du 2026-10-13). Liste close :
// un nouveau lot ne peut jamais entrer par cette voie.
const HISTORIQUES = [
  'set_fonda_comprendre-consigne_nI_01', 'set_fonda_comprendre-consigne_nF_01',
  'set_fonda_inference-implicite_nI_01', 'set_fonda_inference-implicite_nF_01',
  'set_fonda_grandeurs-mesures_nI_01', 'set_fonda_grandeurs-mesures_nF_01',
  'set_fonda_resolution-problemes_nI_01', 'set_fonda_resolution-problemes_nF_01',
];

describe('chaîne publiée FONDA — cohérence complète', () => {
  test('catalogue valide contre le référentiel', () => {
    assert.deepEqual(C.validerCatalogue(CATALOGUE, REFERENTIEL), { valide: true, erreurs: [] });
  });

  for (const e of CATALOGUE.lots) {
    test(`${e.set_id} : fichier présent, liste blanche, relu, empreinte = attestation`, async () => {
      const lot = lire(e.fichier);
      assert.deepEqual(await C.verifierLotContreEntree(lot, e, sha), { valide: true, erreurs: [] });
    });
  }

  test('aucun fichier publié orphelin dans lots/ (tout fichier est au catalogue)', () => {
    const fichiers = fs.readdirSync(path.join(DATA, 'lots')).filter((f) => f.endsWith('.json')).map((f) => `lots/${f}`).sort();
    assert.deepEqual(fichiers, CATALOGUE.lots.map((e) => e.fichier).sort());
  });

  test('attestation « manuelle-historique » : uniquement les 8 lots du 2026-10-11, relus par Éric', () => {
    for (const e of CATALOGUE.lots.filter((x) => x.attestation.type === 'manuelle-historique')) {
      assert.ok(HISTORIQUES.includes(e.set_id), `${e.set_id} ne peut pas porter une attestation manuelle-historique`);
      assert.equal(e.attestation.relecture_declaree.date, '2026-10-11');
      assert.equal(e.attestation.relecture_declaree.relu_par, 'eric');
      assert.equal(e.relecteur.id, 'eric');
    }
  });

  test('aucune attestation « n8n-relecture » tant que sa source de confiance n\'est pas spécifiée (bloc 2)', () => {
    assert.equal(CATALOGUE.lots.filter((e) => e.attestation.type === 'n8n-relecture').length, 0);
  });

  test('calendrier : tout set_id programmé est publié au catalogue', () => {
    const publies = new Set(CATALOGUE.lots.map((e) => e.set_id));
    for (const s of CALENDRIER.semaines || []) {
      for (const en of s.entrees || []) assert.ok(publies.has(en.set_id), `set_id programmé non publié : ${en.set_id}`);
    }
  });

  test('lots de calibration : conformes, NON relus, jamais au catalogue, set_id distincts des publiés', () => {
    const publies = new Set(CATALOGUE.lots.map((e) => e.set_id));
    const dir = path.join(DATA, 'lots-fonda-calibration');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const lot = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      assert.deepEqual(C.validerLot(lot), { valide: true, erreurs: [] }, f);
      assert.equal(lot.revue_carte_par_carte, false, f);
      assert.ok(!publies.has(lot.set_id), f);
    }
  });
});

describe('aucun secret ni coordonnée dans les données FONDA du dépôt public', () => {
  function fichiers(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const p = path.join(dir, d.name);
      return d.isDirectory() ? fichiers(p) : (/\.(json|md)$/.test(d.name) ? [p] : []);
    });
  }
  const cibles = [...fichiers(DATA), ...fichiers(path.join(DATA, '..', '..', 'docs')).filter((f) => f.endsWith('.md'))];
  for (const f of cibles) {
    test(path.relative(path.join(DATA, '..', '..'), f), () => {
      const t = fs.readFileSync(f, 'utf8');
      assert.doesNotMatch(t, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[a-z]{2,}/, 'adresse e-mail');
      assert.doesNotMatch(t, /SUP-[A-Z0-9]{6,}/, 'code de suppression');
      if (f.endsWith('.json')) assert.doesNotMatch(t, /"(code_suppression|prof_email|review_key|review_token)"\s*:/, 'champ secret');
    });
  }
});
