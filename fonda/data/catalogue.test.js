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
const { chargerMoteurNode } = require('../scripts/moteurs.js');

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

  // CDC §4.3 (C3) : chaque lot est validé par SON moteur (registre + octets vérifiés),
  // jamais par le correcteur courant.
  for (const e of CATALOGUE.lots) {
    test(`${e.set_id} : moteur ${e.moteur && e.moteur.version} enregistré, cartes valides et cohérentes pour CE moteur`, () => {
      const m = chargerMoteurNode(e.moteur.version, e.moteur.sha256);
      for (const c of lire(e.fichier).cartes) {
        assert.equal(m.valider(c).valide, true, `${c.item_id} : ${m.valider(c).raisons}`);
        assert.deepEqual(m.outils.verifierReponseOr(c), { ok: true }, c.item_id);
        assert.deepEqual(m.outils.verifierFormesAcceptees(c), { ok: true }, c.item_id);
      }
    });
  }

  // Journal des identifiants (CDC §6) — cohérence de CET état du dépôt. Le contrôle
  // sur l'historique de confiance (ajout seul, double reserve à travers les fusions)
  // appartient à verifier-immuabilite.js (étape 3, chantier 3).
  test('journal des set_id : conforme, catalogue = publiés, calibration réservée ou abandonnée', () => {
    const J = require('../engine/journal-set-ids.js');
    const journal = J.lireJournalTexte(fs.readFileSync(path.join(DATA, 'set_ids-journal.json'), 'utf8'));
    assert.deepEqual(J.validerJournal(journal).erreurs, []);
    const calibrationIds = fs.readdirSync(path.join(DATA, 'lots-fonda-calibration')).filter((f) => f.endsWith('.json'))
      .map((f) => lire(`lots-fonda-calibration/${f}`).set_id);
    assert.deepEqual(J.coherenceAvecDepot(journal, { catalogueIds: CATALOGUE.lots.map((e) => e.set_id), calibrationIds }), []);
  });

  test('M2 : amorçage figé — 8 publiés (reserve+publie), 8 de calibration (reserve), rien d\'autre', () => {
    const J = require('../engine/journal-set-ids.js');
    const journal = J.lireJournalTexte(fs.readFileSync(path.join(DATA, 'set_ids-journal.json'), 'utf8'));
    const m2 = journal.lignes.filter((l) => l.ref.startsWith('m2-2026-10-14:'));
    const etats = J.validerJournal({ schema: journal.schema, lignes: m2 }).etats;
    assert.deepEqual([...etats.entries()].filter(([, e]) => e === 'publie').map(([id]) => id).sort(), [...HISTORIQUES].sort());
    assert.equal([...etats.values()].filter((e) => e === 'reserve').length, 8);
    assert.equal(etats.size, 16);
  });

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

  // Type 2 (CDC §11, §14) : chaque clôture signée est RE-VÉRIFIÉE en CI avec les clés du
  // dépôt (signature, recevabilité, invariants de valeur et de dépôt). Une clé révoquée
  // rend ses attestations irrecevables : la CI échoue jusqu'au retrait ou à la reclôture.
  test('modèles autorisés (G5, §20.8) : fichier conforme ; identifiants Sonnet ÉPINGLÉS seulement (claude-sonnet-5-5 depuis la sonde, exécution n8n 279792)', () => {
    const S = require('../scripts/attestation-signee.js');
    assert.ok(Array.isArray(S.lireModelesAutorises(fs.readFileSync(path.join(DATA, 'modeles-autorises.json'), 'utf8'))));
  });
  test('clés du dépôt : cles.json conforme (clé publique eric-2026)', () => {
    const { clesDuDepot } = require('../scripts/publier-lot.js');
    assert.ok(Array.isArray(clesDuDepot().ids));
  });
  // Relecteur attribué contrôlé contre le RÉFÉRENTIEL ARCHIVÉ de la charge (CDC v8.3
  // §20.12), retrouvé sur l'historique de confiance (premier parent de design et de la
  // référence du contrôle) — jamais contre le référentiel courant.
  for (const e of CATALOGUE.lots.filter((x) => x.attestation.type === 'cloture-signee')) {
    test(`${e.set_id} : clôture signée vérifiée (signature, clé, invariants, référentiel archivé)`, () => {
      const { clesDuDepot, verifierClotureDuCatalogue } = require('../scripts/publier-lot.js');
      const RA = require('../scripts/referentiel-archive.js');
      const registre = require('../engine/moteurs.json');
      const refs = RA.refsDeConfiance();
      const resoudre = (version) => RA.resoudreReferentiel({ version, refs });
      const modelesAutorises = require('../scripts/attestation-signee.js').lireModelesAutorises(fs.readFileSync(path.join(DATA, 'modeles-autorises.json'), 'utf8'));
      assert.deepEqual(verifierClotureDuCatalogue(e, { resoudre, cles: clesDuDepot(), registre, modelesAutorises }), []);
    });
  }

  // Calendrier v2 : une entrée « publie » pointe un set_id publié ; une entrée
  // « planifie » (fiche pas encore produite) n'a AUCUN set_id — jamais de lien mort.
  test('calendrier : tout set_id programmé est publié au catalogue', () => {
    const publies = new Set(CATALOGUE.lots.map((e) => e.set_id));
    let programmes = 0;
    for (const s of CALENDRIER.semaines || []) {
      for (const en of s.entrees || []) {
        if (en.statut === 'planifie') {
          assert.ok(!('set_id' in en), `entrée planifiée avec un set_id : ${en.notion_id} (S${s.iso_week})`);
          continue;
        }
        programmes += 1;
        assert.ok(publies.has(en.set_id), `set_id programmé non publié : ${en.set_id}`);
      }
    }
    assert.ok(programmes > 0, 'le calendrier réel doit programmer au moins une fiche publiée');
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

// Plage _90–_99 RÉSERVÉE aux set_id FICTIFS des tests (lot 8 : la vraie réservation de
// set_fonda_grandeurs-mesures_nI_02 heurtait des scénarios de test qui l'utilisaient comme
// numéro fictif). Aucun set_id RÉEL ne doit jamais y entrer : la séquence réelle s'arrête
// donc à _89 par (notion, palier) — élargir la plage des tests plutôt que d'y empiéter.
describe('plage _90–_99 réservée aux set_id fictifs des tests', () => {
  const PLAGE_TESTS = /_n[IF]_9\d$/;
  const G = require('../scripts/generer-lot-fonda.js');
  const J = require('../engine/journal-set-ids.js');
  test('aucun set_id réel dans la plage réservée : journal RÉEL, catalogue RÉEL, fichiers de calibration et lots publiés', () => {
    const journal = J.lireJournalTexte(fs.readFileSync(path.join(DATA, 'set_ids-journal.json'), 'utf8'));
    const sources = {
      journal: journal.lignes.map((l) => l.set_id),
      catalogue: CATALOGUE.lots.map((e) => e.set_id),
      'calibration + lots publiés (setIdsExistants)': G.setIdsExistants(null),
    };
    for (const [source, ids] of Object.entries(sources)) {
      const fautifs = [...new Set(ids.filter((id) => PLAGE_TESTS.test(id)))];
      assert.deepEqual(fautifs, [], `set_id réel dans la plage réservée aux tests (${source}) : ${fautifs.join(', ')}`);
    }
    assert.ok(sources.journal.length > 0 && sources.catalogue.length > 0, 'sources réelles non vides');
  });
});
