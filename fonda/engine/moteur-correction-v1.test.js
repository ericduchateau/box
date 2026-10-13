// Tests du moteur de correction élève v1 (CDC relecture §4, migration M1).
// Preuve du « comportement identique » exigée par le CDC §4.3 :
//   1. le corps du correcteur embarqué est OCTET POUR OCTET celui de
//      fonda/engine/correction.js au commit a418881 (design avant M1) ;
//   2. comparaison différentielle ancien/nouveau sur toutes les cartes du dépôt
//      (publiées + calibration) et un jeu de saisies dérivées : statut, réussite,
//      cible affichée, formes affichées, seconde chance, comptage ;
//   3. table des issues (CDC §4.2), écarts E1–E4 côté moteur, enregistrement
//      navigateur non réassignable (CDC §4.1).
// Usage : node --test fonda/engine/moteur-correction-v1.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const M = require('./moteur-correction-v1.js');
const moteur = M.creerMoteur();
const COMMIT_AVANT_M1 = 'a418881';
const RACINE = path.join(__dirname, '..', '..');
const CODE_MOTEUR = fs.readFileSync(path.join(__dirname, 'moteur-correction-v1.js'), 'utf8');

function gitShow(chemin) {
  try { return execFileSync('git', ['show', `${COMMIT_AVANT_M1}:${chemin}`], { cwd: RACINE, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { return null; }
}
const ANCIEN_CORRECTION = gitShow('fonda/engine/correction.js');

// Ancien correcteur, exécuté depuis ses octets historiques (branche Node de son UMD).
function chargerAncien() {
  const module = { exports: {} };
  vm.runInNewContext(ANCIEN_CORRECTION, { module, exports: module.exports });
  return module.exports;
}

describe('M1 — consolidation à comportement identique', { skip: ANCIEN_CORRECTION === null && 'historique git indisponible' }, () => {
  test('corps du correcteur embarqué = correction.js @ a418881, octet pour octet', () => {
    const debut = ANCIEN_CORRECTION.indexOf("'use strict';\n\nconst PROFILS = new Set([");
    const fin = ANCIEN_CORRECTION.indexOf('}); // fin UMD');
    assert.ok(debut > 0 && fin > debut);
    const corps = ANCIEN_CORRECTION.slice(debut, fin).replace(/\n+$/, '\n');
    const embarque = CODE_MOTEUR.slice(CODE_MOTEUR.indexOf('function fabriqueCorrection() {\n') + 'function fabriqueCorrection() {\n'.length, CODE_MOTEUR.indexOf('\n}\n\n// --- Couche moteur'))
      .split('\n').map((l) => (l.startsWith('  ') ? l.slice(2) : l)).join('\n') + '\n';
    assert.equal(embarque.replace(/\n+$/, '\n'), corps);
  });

  // Ancien parcours élève (carte-reponse-produite.js @ a418881) reconstitué sur
  // l'ancien correcteur : cible au montage, évaluation, réussite, comptage, relance.
  function ancienParcours(A, carte, saisies) {
    const cible = A.calculerCibleAffichee({ profil: carte.profil_correction, reponsesAcceptees: carte.reponses_acceptees || [], unite: carte.unite ?? null, arrondi: carte.arrondi ?? null });
    const formes = Array.isArray(carte.reponses_acceptees) ? carte.reponses_acceptees : [];
    const sorties = [];
    let tentative = 0;
    for (const saisie of saisies) {
      tentative += 1;
      const { statut } = A.evaluerReponse({ profil: carte.profil_correction, reponseDonnee: saisie, reponsesAcceptees: carte.reponses_acceptees || [], unite: carte.unite ?? null, arrondi: carte.arrondi ?? null });
      const reussite = A.compteCommeReussite(statut, carte.profil_correction);
      const relance = statut === 'presque' && !!carte.seconde_chance && tentative === 1;
      sorties.push({ statut, reussite, tentative, scored: tentative === 1, relance, cible, formes: carte.profil_correction !== 'numerique' && formes.length > 1 ? formes : [], badge: statut !== 'carte_invalide' });
      if (!relance) break;
    }
    return sorties;
  }
  function nouveauParcours(carte, saisies) {
    const c = moteur.preparerCarte(carte);
    let etat = moteur.demarrer(c);
    const sorties = [];
    for (const saisie of saisies) {
      const { etat: e, resultat: r } = moteur.soumettre(etat, saisie);
      etat = e;
      sorties.push({ statut: r.issue, reussite: r.reussite, tentative: r.tentative, scored: r.compte, relance: r.seconde_chance_ouverte, cible: r.cible_affichee, formes: [...r.formes_affichees], badge: r.afficher_badge_relecture });
      if (r.carte_terminee) break;
    }
    return sorties;
  }
  function saisiesDerivees(carte) {
    const base = [carte.reponse, ...(Array.isArray(carte.reponses_acceptees) ? carte.reponses_acceptees : [])].filter((x) => x != null).map(String);
    const out = new Set(['', ' ', 'n\'importe quoi', '0', '1/3', '0,33', '8 cm']);
    for (const b of base) {
      out.add(b);
      out.add(b.toUpperCase());
      out.add(b.toLowerCase());
      out.add(` ${b}. `);
      out.add(b.normalize('NFD').replace(/[̀-ͯ]/g, ''));
      out.add(b.replace(/s\b/g, ''));
      out.add(b.replace(/,/g, '.'));
      out.add(b.replace(/\s*[a-zA-Zé€%²³]+$/u, ''));
      out.add(`${b} cm`);
    }
    return [...out];
  }
  function toutesLesCartes() {
    const dirs = ['fonda/data/lots', 'fonda/data/lots-fonda-calibration'];
    const cartes = [];
    for (const d of dirs) {
      for (const f of fs.readdirSync(path.join(RACINE, d)).filter((x) => x.endsWith('.json'))) {
        cartes.push(...JSON.parse(fs.readFileSync(path.join(RACINE, d, f), 'utf8')).cartes);
      }
    }
    return cartes;
  }

  test('différentiel ancien/nouveau : toutes les cartes du dépôt × saisies dérivées × seconde chance on/off × arrondi invalide', () => {
    const A = chargerAncien();
    const cartes = toutesLesCartes();
    assert.ok(cartes.length >= 70, `corpus trop petit (${cartes.length})`);
    let cas = 0;
    for (const brute of cartes) {
      const variantes = [brute, { ...brute, seconde_chance: !brute.seconde_chance }, { ...brute, arrondi: 11 }, { ...brute, arrondi: 1.5 }, { ...brute, profil_correction: 'magie' }];
      for (const carte of variantes) {
        const saisies = saisiesDerivees(carte);
        for (const s1 of saisies) {
          for (const s2 of [s1, carte.reponse]) {
            assert.deepEqual(nouveauParcours(carte, [s1, s2]), ancienParcours(A, carte, [s1, s2]), `${carte.item_id} « ${s1} » puis « ${s2} »`);
            cas += 1;
          }
        }
      }
    }
    assert.ok(cas > 10000, `${cas} cas comparés`);
  });

  test('différentiel : cartes malformées (non-tableau, nombres, unité contradictoire) traitées comme avant', () => {
    const A = chargerAncien();
    const cartes = [
      { question: 'Q', profil_correction: 'exact', reponses_acceptees: 'Paris' },
      { question: 'Q', profil_correction: 'numerique', reponses_acceptees: [2, '2,0'] },
      { question: 'Q', profil_correction: 'numerique', reponses_acceptees: ['8 kg'], unite: 'cm' },
      { question: 'Q', profil_correction: 'numerique', reponses_acceptees: ['1/0'] },
      { question: 'Q', profil_correction: 'sens', reponses_acceptees: [] },
    ];
    for (const carte of cartes) {
      for (const s of ['Paris', '2', '8 cm', '8', '', 'x']) {
        assert.deepEqual(nouveauParcours(carte, [s, s]), ancienParcours(A, carte, [s, s]), `${JSON.stringify(carte)} « ${s} »`);
      }
    }
  });
});

describe('API du moteur v1 (CDC §4.2)', () => {
  const soumettre = (carte, ...saisies) => {
    let etat = moteur.demarrer(moteur.preparerCarte(carte));
    return saisies.map((s) => { const o = moteur.soumettre(etat, s); etat = o.etat; return o.resultat; });
  };

  test('forme : version, fonctions pures, objets gelés', () => {
    assert.equal(moteur.version, 'v1');
    assert.ok(Object.isFrozen(moteur) && Object.isFrozen(moteur.outils));
    const [r] = soumettre({ question: 'Q', profil_correction: 'exact', reponses_acceptees: ['a'] }, 'a');
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.verdict));
    assert.deepEqual(Object.keys(r).sort(), ['afficher_badge_relecture', 'carte_terminee', 'cible_affichee', 'compte', 'formes_affichees', 'gabarit', 'issue', 'profil_libelle', 'reussite', 'seconde_chance_ouverte', 'tentative', 'verdict', 'verrouillee'].sort());
  });

  test('table des issues : juste / presque (sens, orthographe) / faux / carte_invalide / erreur', () => {
    const ex = (carte, s) => { const [r] = soumettre(carte, s); return [r.issue, r.reussite, r.compte, r.verrouillee, r.carte_terminee, r.afficher_badge_relecture, r.verdict.icone]; };
    assert.deepEqual(ex({ question: 'Q', profil_correction: 'exact', reponses_acceptees: ['a'] }, 'a'), ['juste', true, true, true, true, true, 'succes']);
    assert.deepEqual(ex({ question: 'Q', profil_correction: 'numerique', reponses_acceptees: ['8'], unite: 'cm' }, '8'), ['presque', true, true, true, true, true, 'succes']);
    assert.deepEqual(ex({ question: 'Q', profil_correction: 'orthographe', reponses_acceptees: ['été'] }, 'ete'), ['presque', false, true, true, true, true, 'echec']);
    assert.deepEqual(ex({ question: 'Q', profil_correction: 'exact', reponses_acceptees: ['a'] }, 'b'), ['faux', false, true, true, true, true, 'echec']);
    assert.deepEqual(ex({ question: 'Q', profil_correction: 'numerique', reponses_acceptees: ['8 kg'], unite: 'cm' }, '8 cm'), ['carte_invalide', false, true, true, true, false, 'echec']);
    assert.deepEqual(ex({ question: 'Q', profil_correction: 'exact', reponses_acceptees: ['a', { toString: null }] }, 'b'), ['erreur', false, false, true, true, false, 'alerte']);
  });

  test('profil inconnu -> faux ; arrondi invalide -> comparaison exacte', () => {
    assert.equal(soumettre({ question: 'Q', profil_correction: 'magie', reponses_acceptees: ['a'] }, 'a')[0].issue, 'faux');
    assert.equal(soumettre({ question: 'Q', profil_correction: 'numerique', reponses_acceptees: ['1/3'], arrondi: 11 }, '1/3')[0].issue, 'juste');
    assert.equal(soumettre({ question: 'Q', profil_correction: 'numerique', reponses_acceptees: ['1/3'], arrondi: 11 }, '0,33')[0].issue, 'faux');
  });

  test('seconde chance : ouverte après presque en 1re tentative ; 2e jamais comptée ; carte terminée ensuite', () => {
    const [r1, r2] = soumettre({ question: 'Q', profil_correction: 'orthographe', reponses_acceptees: ['garçon'], seconde_chance: true }, 'garcon', 'garcon');
    assert.deepEqual([r1.seconde_chance_ouverte, r1.verrouillee, r1.carte_terminee, r1.compte], [true, false, false, true]);
    assert.deepEqual([r2.tentative, r2.compte, r2.seconde_chance_ouverte, r2.carte_terminee], [2, false, false, true]);
  });

  test('soumettre sur une carte terminée : refus explicite', () => {
    const etat = moteur.soumettre(moteur.demarrer(moteur.preparerCarte({ question: 'Q', profil_correction: 'exact', reponses_acceptees: ['a'] })), 'a').etat;
    assert.throws(() => moteur.soumettre(etat, 'a'), /terminée/);
  });

  test('valider : règles de l\'ancien lotEstBienForme, avec raisons', () => {
    assert.deepEqual(moteur.valider({ question: 'Q', profil_correction: 'exact', reponses_acceptees: ['a'] }), { valide: true, issue_si_invalide: 'indisponible', raisons: [] });
    for (const c of [null, { question: ' ', profil_correction: 'exact', reponses_acceptees: ['a'] }, { question: 'Q', profil_correction: 'magie', reponses_acceptees: ['a'] },
      { question: 'Q', profil_correction: 'exact', reponses_acceptees: [] }, { question: 'Q', profil_correction: 'exact', reponses_acceptees: [Number.NaN] },
      { question: 'Q', profil_correction: 'exact', reponses_acceptees: ['a'], unite: 3 }, { question: 'Q', profil_correction: 'numerique', reponses_acceptees: ['1'], arrondi: 11 },
      { question: 'Q', profil_correction: 'exact', reponses_acceptees: ['a'], seconde_chance: 'oui' }]) {
      const v = moteur.valider(c);
      assert.equal(v.valide, false, JSON.stringify(c));
      assert.ok(v.raisons.length > 0);
    }
  });

  test('cible préparée mais montrée seulement dans le résultat (préparer n\'est pas afficher)', () => {
    const c = moteur.preparerCarte({ question: 'Q', profil_correction: 'numerique', reponses_acceptees: ['1/3'], arrondi: 2 });
    assert.equal(c.cible_affichee, '0,33');
    assert.equal(soumettre({ question: 'Q', profil_correction: 'numerique', reponses_acceptees: ['1/3'], arrondi: 2 }, '1/3')[0].cible_affichee, '0,33');
  });
});

describe('enregistrement navigateur (CDC §4.1)', () => {
  const executer = (self) => vm.runInNewContext(CODE_MOTEUR, { self });

  test('seul effet de bord : FondaMoteurs non réassignable, v1 gelée et non configurable', () => {
    const self = {};
    executer(self);
    assert.deepEqual(Object.keys(self), [], 'aucun global énumérable posé');
    const d = Object.getOwnPropertyDescriptor(self, 'FondaMoteurs');
    assert.deepEqual([d.writable, d.configurable, Object.getPrototypeOf(d.value)], [false, false, null]);
    const dv = Object.getOwnPropertyDescriptor(d.value, 'v1');
    assert.deepEqual([dv.writable, dv.configurable, Object.isFrozen(dv.value)], [false, false, true]);
    assert.equal(dv.value.creerMoteur().version, 'v1');
  });

  test('réexécution : n\'écrase pas une version déjà enregistrée', () => {
    const self = {};
    executer(self);
    const avant = self.FondaMoteurs.v1;
    executer(self);
    assert.equal(self.FondaMoteurs.v1, avant);
  });

  test('registre préexistant incompatible (réassignable, configurable ou à prototype) : refus', () => {
    assert.throws(() => executer({ FondaMoteurs: {} }), /incompatible/);
    const s2 = {};
    Object.defineProperty(s2, 'FondaMoteurs', { value: {}, writable: false, configurable: false });
    assert.throws(() => executer(s2), /incompatible/);
    const s3 = {};
    Object.defineProperty(s3, 'FondaMoteurs', { value: Object.create(null), writable: false, configurable: true });
    assert.throws(() => executer(s3), /incompatible/);
  });
});
