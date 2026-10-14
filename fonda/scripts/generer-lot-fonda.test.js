// Suite de tests — fonda/scripts/generer-lot-fonda.js (dette T6b, génération réelle).
// Teste UNIQUEMENT les fonctions pures (parsing, vérification correcteur, dérivation
// G4, reformatage box-select) — ZÉRO appel réseau ici, jamais `appellerModeleClaude`
// ni `main()`. La réponse "du modèle" est simulée par des objets écrits à la main,
// jouant exactement le rôle que jouerait un vrai texte de réponse Claude.
//
// Usage : node --test fonda/scripts/generer-lot-fonda.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  estNotionExclue,
  construirePrompt,
  parserReponseModele,
  verifierContreCorrecteur,
  verifierFormesAcceptees,
  formeSaisissable,
  trierCartesBrutes,
  autoCorrigerCarte,
  construireCandidats,
  construireLotFonda,
} = require('./generer-lot-fonda.js');

const NOTION_MATHS = Object.freeze({
  id: 'maths.geometrie',
  matiere: 'maths',
  relecteur: 'eric',
  libelle: 'Comprendre et utiliser les grandeurs géométriques',
  micro_competence: 'Calculer une aire ou un périmètre simple.',
  enonce_modele: ['Exemple PRD'],
  paliers: ['nI', 'nF'],
});

describe('parserReponseModele', () => {
  test('texte JSON valide avec cartes -> ok', () => {
    const texte = 'Voici le JSON :\n' + JSON.stringify({ cartes: [{ question: 'Q ?', reponse: 'R' }] }) + '\nFin.';
    const r = parserReponseModele(texte);
    assert.equal(r.ok, true);
    assert.equal(r.cartesBrutes.length, 1);
  });

  test('pas de JSON dans le texte -> rejeté', () => {
    const r = parserReponseModele('juste du texte, pas de JSON');
    assert.equal(r.ok, false);
  });

  test('JSON valide mais sans champ "cartes" -> rejeté', () => {
    const r = parserReponseModele(JSON.stringify({ autre_chose: [] }));
    assert.equal(r.ok, false);
  });

  test('JSON malformé -> rejeté sans exception', () => {
    const r = parserReponseModele('{ "cartes": [ incomplet');
    assert.equal(r.ok, false);
  });
});

describe('verifierContreCorrecteur — zéro tolérance', () => {
  test('carte numérique cohérente avec son unité -> acceptée', () => {
    const r = verifierContreCorrecteur({
      profil_correction: 'numerique',
      reponse: '40 m²',
      reponses_acceptees: ['40 m²', '40'],
      unite: 'm²',
    });
    assert.equal(r.ok, true);
  });

  test('carte numérique avec une unité dans la réponse mais SANS le champ "unite" déclaré -> rejetée par le correcteur lui-même', () => {
    // Confirme que la règle 4 du prompt (unité obligatoire) est bien APPLIQUÉE, pas
    // seulement demandée poliment : evaluerNumerique(), unite=null, traite tout
    // reliquat alphabétique dans la réponse comme "aucune unité n'était exigée mais
    // il y en a une -> faux" (voir fonda/engine/correction.js, dernière ligne de
    // evaluerNumerique). Une carte qui oublie "unite" est donc rejetée AVANT même
    // la relecture humaine, pas seulement documentée comme suspecte.
    const r = verifierContreCorrecteur({
      profil_correction: 'numerique',
      reponse: '40 m²',
      reponses_acceptees: ['40 m²'],
      unite: undefined,
    });
    assert.equal(r.ok, false);
  });

  test('carte numérique dont la réponse ne correspond PAS à reponses_acceptees -> rejetée', () => {
    const r = verifierContreCorrecteur({
      profil_correction: 'numerique',
      reponse: '41 m²',
      reponses_acceptees: ['40 m²', '40'],
      unite: 'm²',
    });
    assert.equal(r.ok, false);
    assert.match(r.raison, /ne valide pas/);
  });

  test('carte profil "exact" incohérente (casse/forme différente non listée) -> rejetée', () => {
    const r = verifierContreCorrecteur({
      profil_correction: 'exact',
      reponse: 'B',
      reponses_acceptees: ['A'],
      unite: null,
    });
    assert.equal(r.ok, false);
  });

  test('profil_correction invalide/inconnu -> rejetée (jamais une fausse réussite)', () => {
    const r = verifierContreCorrecteur({
      profil_correction: 'inconnu',
      reponse: 'X',
      reponses_acceptees: ['X'],
      unite: null,
    });
    assert.equal(r.ok, false);
  });
});

describe('autoCorrigerCarte — réconciliation reponse/reponses_acceptees, jamais de contenu inventé (lot de validation 2026-10-11)', () => {
  test('carte déjà valide : inchangée, corrigee=false', () => {
    const carte = { profil_correction: 'exact', reponse: 'Paris', reponses_acceptees: ['Paris'] };
    const r = autoCorrigerCarte(carte);
    assert.equal(r.corrigee, false);
    assert.equal(r.carte, carte);
  });

  test('cas réel "2 pots" sans unite déclarée : corrigée en "2" (déjà présent dans reponses_acceptees)', () => {
    const carte = {
      profil_correction: 'numerique',
      reponse: '2 pots',
      reponses_acceptees: ['2 pots', '2'],
    };
    const r = autoCorrigerCarte(carte);
    assert.equal(r.corrigee, true);
    assert.equal(r.ancienneReponse, '2 pots');
    assert.equal(r.carte.reponse, '2');
    assert.equal(verifierContreCorrecteur(r.carte).ok, true, 'la carte corrigée doit repasser le correcteur');
    assert.deepEqual(r.carte.reponses_acceptees, ['2 pots', '2'], 'reponses_acceptees ne doit jamais être modifié par la correction');
  });

  test('cas réel "il a un examen important" (profil sens) : corrigée vers la forme courte déjà déclarée', () => {
    const carte = {
      profil_correction: 'sens',
      reponse: 'il a un examen important',
      reponses_acceptees: ['un examen important', 'une épreuve importante', 'un examen', 'un contrôle important'],
    };
    const r = autoCorrigerCarte(carte);
    assert.equal(r.corrigee, true);
    assert.equal(r.carte.reponse, 'un examen important');
    assert.equal(verifierContreCorrecteur(r.carte).ok, true);
  });

  test('aucune forme de reponses_acceptees ne passe (incohérence structurelle, ex. unité attendue contredite) : pas de correction possible, carte inchangée', () => {
    const carte = {
      profil_correction: 'numerique',
      reponse: '8 cm',
      reponses_acceptees: ['8 kg'],
      unite: 'cm', // incohérent avec reponses_acceptees -> carte_invalide, pas corrigeable mécaniquement
    };
    const r = autoCorrigerCarte(carte);
    assert.equal(r.corrigee, false);
    assert.equal(r.carte, carte);
    assert.equal(verifierContreCorrecteur(r.carte).ok, false, 'reste rejetée, exactement comme avant cette fonction');
  });

  test('reponses_acceptees malformé (pas un tableau) : ne plante pas, pas de correction tentée', () => {
    const carte = { profil_correction: 'exact', reponse: 'Paris', reponses_acceptees: 'Paris' };
    assert.doesNotThrow(() => autoCorrigerCarte(carte));
    const r = autoCorrigerCarte(carte);
    assert.equal(r.corrigee, false);
  });
});

describe('construireCandidats — dérivation G4 (jamais confiance au contenu modèle)', () => {
  test('set_id/item_id/relecteur dérivés du référentiel, jamais du modèle', () => {
    const cartesBrutes = [
      { question: 'Q1', reponse: 'R1', difficulte: 'facile', profil_correction: 'numerique', reponses_acceptees: ['R1'], contexte: 'ctx-1' },
      { question: 'Q2', reponse: 'R2', difficulte: 'moyen', profil_correction: 'exact', reponses_acceptees: ['R2'], contexte: 'ctx-2' },
    ];
    const candidats = construireCandidats({ notion: NOTION_MATHS, palier: 'nI', cartesBrutes, sequence: 1, ts: '2026-10-10T00:00:00.000Z' });

    assert.equal(candidats.length, 2);
    candidats.forEach((c, i) => {
      assert.equal(c.notion_id, 'maths.geometrie');
      assert.equal(c.matiere, 'maths');
      assert.equal(c.relecteur, 'eric'); // dérivé, pas lu sur une carte brute qui n'a même pas ce champ.
      assert.equal(c.palier, 'nI');
      assert.equal(c.statut, 'attente');
      assert.equal(c.item_id, i === 0 ? 'it01' : 'it02');
      assert.match(c.set_id, /^set_fonda_geometrie_nI_\d{2}$/);
    });
  });

  test('un champ "relecteur" ou "matiere" injecté dans une carte brute (si jamais le modèle en produisait un) est ignoré — la dérivation l\'écrase toujours', () => {
    const cartesBrutes = [
      { question: 'Q1', reponse: 'R1', difficulte: 'facile', profil_correction: 'numerique', reponses_acceptees: ['R1'], contexte: 'ctx-1', relecteur: 'justine', matiere: 'français' },
    ];
    const candidats = construireCandidats({ notion: NOTION_MATHS, palier: 'nI', cartesBrutes, sequence: 1, ts: '2026-10-10T00:00:00.000Z' });
    assert.equal(candidats[0].relecteur, 'eric'); // PAS "justine" — la fonction ne lit même pas ce champ en entrée.
    assert.equal(candidats[0].matiere, 'maths'); // PAS "français".
  });
});

describe('construireLotFonda — contrat lot-fonda/v1, aucun secret (chaîne FONDA séparée)', () => {
  const { validerLot } = require('../engine/catalogue.js');
  const candidatsExemple = [
    { relecteur: 'eric', palier: 'nI', numero: 1, question: 'Q1 ?', reponse: 'R1', difficulte: 'facile', profil_correction: 'numerique', reponses_acceptees: ['R1'], unite: 'm²', contexte: 'ctx-1', set_id: 'set_fonda_geometrie_nI_02', item_id: 'it01', notion_id: 'maths.geometrie' },
    { relecteur: 'eric', palier: 'nI', numero: 2, question: 'Q2 ?', reponse: 'R2', difficulte: 'moyen', profil_correction: 'exact', reponses_acceptees: ['R2'], contexte: 'ctx-2', set_id: 'set_fonda_geometrie_nI_02', item_id: 'it02', notion_id: 'maths.geometrie' },
  ];

  test('produit un lot lot-fonda/v1 valide, non relu, set_id à la racine', () => {
    const lot = construireLotFonda({ notion: NOTION_MATHS, palier: 'nI', candidats: candidatsExemple });
    assert.equal(lot.schema, 'lot-fonda/v1');
    assert.equal(lot.set_id, 'set_fonda_geometrie_nI_02');
    assert.equal(lot.revue_carte_par_carte, false);
    assert.equal(lot.nb_cartes, 2);
    assert.deepEqual(validerLot(lot), { valide: true, erreurs: [] });
    assert.deepEqual(lot.cartes.map((c) => c.item_id), ['it01', 'it02']);
    assert.equal(lot.cartes[0].unite, 'm²');
    assert.equal('unite' in lot.cartes[1], false, 'pas de champ unite vide');
  });

  test('aucun secret ni coordonnée : ni id box_, ni prof_email, ni code_suppression, ni relecteur', () => {
    const t = JSON.stringify(construireLotFonda({ notion: NOTION_MATHS, palier: 'nI', candidats: candidatsExemple }));
    for (const interdit of ['"id"', 'box_', 'prof_email', 'prof_nom', 'code_suppression', 'SUP-', '"relecteur"', '@']) {
      assert.ok(!t.includes(interdit), `présent : ${interdit}`);
    }
  });

  test('candidats de set_id différents -> refus explicite', () => {
    const mixte = [candidatsExemple[0], { ...candidatsExemple[1], set_id: 'set_fonda_geometrie_nI_03' }];
    assert.throws(() => construireLotFonda({ notion: NOTION_MATHS, palier: 'nI', candidats: mixte }), /set_id différents/);
  });
});

describe('estNotionExclue — périmètre figures géré en amont, pas seulement par le prompt', () => {
  test('maths.geometrie est exclue', () => {
    assert.equal(estNotionExclue('maths.geometrie'), true);
  });

  test('une notion ordinaire (texte seul) n\'est pas exclue', () => {
    assert.equal(estNotionExclue('maths.proportionnalite'), false);
    assert.equal(estNotionExclue('fr.lexique'), false);
  });
});

describe('construirePrompt — points de vigilance (règle 1 réponse courte, règle 8 micro-compétence)', () => {
  const args = {
    notion: NOTION_MATHS,
    palier: 'nI',
    nCartes: 4,
    contextesDejaUtilises: [],
  };

  test('la règle "réponse courte" est bien la règle 1 (la plus visible), pas noyée en bas', () => {
    const prompt = construirePrompt(args);
    const indexRegle1 = prompt.indexOf('1. RÉPONSE TRÈS COURTE OBLIGATOIRE');
    const indexRegle2 = prompt.indexOf('2. ÉNONCÉ DÉTERMINÉ');
    assert.ok(indexRegle1 > -1, 'règle 1 "réponse courte" absente ou mal numérotée');
    assert.ok(indexRegle1 < indexRegle2, 'la règle réponse courte doit précéder les autres règles numérotées');
  });

  test('la règle 8 (mobiliser réellement la micro-compétence) est présente avec l\'exemple du défaut "changer de représentation"', () => {
    const prompt = construirePrompt(args);
    assert.match(prompt, /MOBILISER LA MICRO-COMPÉTENCE/);
    assert.match(prompt, /changer de représentation/);
  });

  test('MODELE est un identifiant Sonnet renseigné, distinct de "claude-sonnet-5-5" (rejeté comme invalide)', () => {
    const { MODELE } = require('./generer-lot-fonda.js');
    assert.match(MODELE, /^claude-sonnet-/);
    assert.notEqual(MODELE, 'claude-sonnet-5-5');
  });

  test('la définition du palier nF interdit explicitement la simple application directe (gradation nI/nF, retour de calibration)', () => {
    const prompt = construirePrompt({ ...args, palier: 'nF' });
    assert.match(prompt, /JAMAIS une simple application directe/);
    assert.match(prompt, /même geste qu.une carte nI/);
  });

  test('la règle "unité obligatoire" interdit explicitement le mélange d\'unités dans reponses_acceptees (retour de calibration : "600 mL" rejeté quand unite="L")', () => {
    const prompt = construirePrompt(args);
    assert.match(prompt, /UNIQUE/);
    assert.match(prompt, /une seule unité par carte/);
    assert.match(prompt, /0,6 L.*600 mL/);
  });

  test('règle QCM lettre+mot : "exact" interdit quand reponses_acceptees mélange lettre et mot entier, "sens" recommandé à la place (retour de calibration lexique)', () => {
    const prompt = construirePrompt(args);
    assert.match(prompt, /PIÈGE À ÉVITER/);
    assert.match(prompt, /jamais "exact"/);
  });

  test('règle QCM anti-biais de position : la bonne réponse ne doit pas être déductible d\'un repère ordinal cité dans l\'énoncé (retour de lot de validation, fr.comprendre-consigne/nI)', () => {
    const prompt = construirePrompt(args);
    assert.match(prompt, /ANTI-BIAIS DE POSITION/);
    assert.match(prompt, /question 2.*option B/);
  });

  test('contextesAutresPaliers (contextes déjà utilisés dans l\'autre palier nI/nF) apparaissent dans l\'interdiction de réutilisation', () => {
    const prompt = construirePrompt({ ...args, contextesAutresPaliers: ['recette-riz-portions', 'carnet-billets-concert'] });
    assert.match(prompt, /recette-riz-portions/);
    assert.match(prompt, /carnet-billets-concert/);
    assert.match(prompt, /dans ce lot ET dans l'autre palier/);
  });
});

// --- Garde-fou des formes acceptées (relecture Codex PR #2, #8) --------------------

describe('verifierFormesAcceptees — chaque forme déclarée doit passer son propre correcteur', () => {
  const carte = (extra) => ({ question: 'Q', reponse: '2', profil_correction: 'numerique', reponses_acceptees: ['2'], ...extra });

  test('cas réel "2 bus" sans unite déclarée -> refusé, la forme fautive est nommée', () => {
    const v = verifierFormesAcceptees(carte({ reponses_acceptees: ['2', '2 bus'] }));
    assert.equal(v.ok, false);
    assert.match(v.raison, /"2 bus"/);
  });

  test('nombre seul avec unite déclarée ("presque" = réussite en numérique) -> accepté', () => {
    assert.equal(verifierFormesAcceptees(carte({ reponse: '9 km', reponses_acceptees: ['9 km', '9'], unite: 'km' })).ok, true);
  });

  test('profil sens/exact : toutes les formes passent -> accepté', () => {
    assert.equal(verifierFormesAcceptees({ profil_correction: 'sens', reponse: 'a', reponses_acceptees: ['un examen', 'examen'] }).ok, true);
  });

  test('trierCartesBrutes rejette la carte "2 bus" (chaîne complète, après auto-correction)', () => {
    const { cartesValides, rejets } = trierCartesBrutes([
      carte({ reponses_acceptees: ['2', '2 bus'] }),
      carte({ reponse: '3', reponses_acceptees: ['3'] }),
    ]);
    assert.equal(cartesValides.length, 1);
    assert.equal(rejets.length, 1);
    assert.equal(rejets[0].index, 0);
  });
});

describe('chaque lot PUBLIÉ (catalogue-fonda.json) repasse TOUS les garde-fous du générateur', () => {
  const LOTS = require('../data/catalogue-fonda.json').lots.map((e) => e.fichier);
  test('le catalogue publie bien 8 lots', () => assert.equal(LOTS.length, 8));
  for (const f of LOTS) {
    test(f, () => {
      const lot = require('../data/' + f);
      lot.cartes.forEach((c, i) => {
        const v = verifierContreCorrecteur(c);
        assert.ok(v.ok, `${f} carte ${i + 1} : ${v.raison}`);
        const vf = verifierFormesAcceptees(c);
        assert.ok(vf.ok, `${f} carte ${i + 1} : ${vf.raison}`);
      });
    });
  }
});

describe('garde-fou : cible APRÈS arrondi, pas la forme littérale (relecture Codex PR #2 v2, #3)', () => {
  const carte = (extra) => ({ question: 'Q', profil_correction: 'numerique', reponse: '0,33', reponses_acceptees: ['1/3'], arrondi: 2, ...extra });

  test('reponses_acceptees ["1/3"] + arrondi 2 : accepté (forme saisissable "0,33")', () => {
    assert.equal(formeSaisissable(carte(), '1/3'), '0,33');
    assert.equal(verifierFormesAcceptees(carte()).ok, true);
    assert.equal(verifierContreCorrecteur(carte()).ok, true);
  });

  test('réponse-or testée littéralement : "0,334" (mal arrondie) et "1/3" (non arrondie) rejetées', () => {
    assert.equal(verifierContreCorrecteur(carte({ reponse: '0,334' })).ok, false);
    assert.equal(verifierContreCorrecteur(carte({ reponse: '1/3' })).ok, false);
    const { cartesValides } = trierCartesBrutes([carte({ reponse: '0,334' })]);
    assert.equal(cartesValides.length, 0, 'une réponse-or fausse ne doit jamais atteindre le fichier box-select');
  });

  test('avec unité déclarée : "1/3 cm" -> "0,33 cm", accepté', () => {
    const c = carte({ reponse: '0,33 cm', reponses_acceptees: ['1/3 cm', '1/3'], unite: 'cm' });
    assert.equal(formeSaisissable(c, '1/3 cm'), '0,33 cm');
    assert.equal(verifierFormesAcceptees(c).ok, true);
    assert.equal(verifierContreCorrecteur(c).ok, true);
  });

  test('arrondi ne masque pas le cas "2 bus" sans unite déclarée', () => {
    const c = carte({ reponse: '2', reponses_acceptees: ['2', '2 bus'] });
    assert.equal(verifierFormesAcceptees(c).ok, false);
  });

  test('sans arrondi : forme littérale inchangée', () => {
    assert.equal(formeSaisissable({ profil_correction: 'numerique' }, '1/3'), '1/3');
  });

  for (const arrondi of [2, 0]) {
    test(`arrondi ${arrondi} transmis jusqu'au fichier candidat lot-fonda/v1 (sinon correction publiée différente)`, () => {
      const c = arrondi === 0 ? carte({ arrondi: 0, reponse: '0', reponses_acceptees: ['1/3'] }) : carte();
      const candidats = construireCandidats({ notion: NOTION_MATHS, palier: 'nI', cartesBrutes: [c], sequence: 1, ts: '2026-10-12T00:00:00Z' });
      assert.equal(candidats[0].arrondi, arrondi);
      const lot = construireLotFonda({ notion: NOTION_MATHS, palier: 'nI', candidats });
      assert.equal(JSON.parse(JSON.stringify(lot)).cartes[0].arrondi, arrondi);
    });
  }
});

// --- Journal des identifiants (CDC §6) : réservation, arrêts explicites -------------
describe('generer-lot-fonda — journal des set_id (fail-closed)', () => {
  const G = require('./generer-lot-fonda.js');
  const fsJ = require('fs');
  const osJ = require('os');
  const pathJ = require('path');
  const REF = require('../data/referentiel.json');

  test('séquence 99 atteinte : arrêt explicite, jamais de recyclage', () => {
    const existants = ['set_fonda_lexique_nI_99'];
    assert.throws(() => G.prochainSetIdReserve('fr.lexique', 'nI', existants), /99 atteinte/);
    assert.equal(G.prochainSetIdReserve('fr.lexique', 'nI', ['set_fonda_lexique_nI_01']), 'set_fonda_lexique_nI_02');
  });

  test('un set_id réservé désigne exactement sa notion et son palier', () => {
    const r = G.notionDuSetId('set_fonda_lexique_nF_03', REF);
    assert.deepEqual([r.notion.id, r.palier, r.sequence], ['fr.lexique', 'nF', 3]);
    assert.throws(() => G.notionDuSetId('set_fonda_inexistante_nI_01', REF), /introuvable/);
    assert.throws(() => G.notionDuSetId('pas-un-set-id', REF), /invalide/);
  });

  test('setIdsExistants : un fichier illisible ARRÊTE (plus jamais ignoré) ; le journal compte', () => {
    const dir = fsJ.mkdtempSync(pathJ.join(osJ.tmpdir(), 'gen-'));
    fsJ.writeFileSync(pathJ.join(dir, 'ok.json'), JSON.stringify({ set_id: 'set_fonda_lexique_nI_01' }));
    const journal = { schema: 'set-ids-journal/v1', lignes: [{ set_id: 'set_fonda_lexique_nI_05', transition: 'reserve', le: '2026-10-14', ref: 'r-0001' }] };
    const ids = G.setIdsExistants(journal, { dirs: [dir], cataloguePath: pathJ.join(dir, 'absent.json') });
    assert.deepEqual(ids.sort(), ['set_fonda_lexique_nI_01', 'set_fonda_lexique_nI_05']);
    assert.equal(G.prochainSetIdReserve('fr.lexique', 'nI', ids), 'set_fonda_lexique_nI_06', 'une réservation abandonnée ou en cours n\'est jamais recyclée');
    fsJ.writeFileSync(pathJ.join(dir, 'casse.json'), '{ cassé');
    assert.throws(() => G.setIdsExistants(journal, { dirs: [dir], cataloguePath: pathJ.join(dir, 'absent.json') }), /illisible/);
    fsJ.writeFileSync(pathJ.join(dir, 'catalogue.json'), '{ cassé');
    fsJ.rmSync(pathJ.join(dir, 'casse.json'));
    assert.throws(() => G.setIdsExistants(journal, { dirs: [dir], cataloguePath: pathJ.join(dir, 'catalogue.json') }), /illisible/);
  });
});
