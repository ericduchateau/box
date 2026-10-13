// Test d'intégration — composant « carte réponse produite » (T2, contrat seconde chance),
// piloté par le MOTEUR v1 injecté (CDC relecture §4.2). Les attentes pédagogiques
// (statut/issue, réussite, tentative, comptage, cible, formes, seconde chance) sont
// INCHANGÉES : `ancien(r)` projette le resultat du moteur sur l'ancien contrat
// { statut, reussite, tentative, scored } pour garder les assertions à l'identique.
// Seuls les tests des écarts volontaires E1–E4 sont révisés (repérés « RÉVISÉ Ex »).
// Verrouille UNE règle : tentative/scored (PRD §5.1 — on score la 1ère tentative,
// jamais la seconde chance). Ne teste pas le rendu visuel (pas de vrai navigateur,
// zéro dépendance — pas de jsdom) : un DOM factice minimal, juste suffisant pour
// piloter le composant, sert de double de test.
//
// Usage : node --test fonda/engine/carte-reponse-produite.test.js

'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// --- DOM factice minimal (zéro dépendance) ---------------------------------

// textContent/innerHTML : derivés comme dans un vrai DOM — textContent d'un élément
// AVEC enfants = concaténation des textContent des enfants (pas la valeur assignée
// avant leur ajout, qui ne compte plus, exactement comme dans un navigateur réel) ;
// textContent d'un élément SANS enfant (feuille, ex. une icône) = la valeur assignée
// directement. innerHTML = '' (seul usage réel ici, dans rendreFeedback()) vide les
// enfants, comme un vrai navigateur.
function creerElementFactice(tag) {
  const el = {
    tagName: tag,
    _listeners: {},
    children: [],
    _text: '',
    classList: { add() {}, remove() {} },
    dataset: {},
    attributes: {},
    value: '',
    disabled: false,
    autocomplete: '',
    type: '',
    className: '',
    get textContent() {
      return this.children.length > 0
        ? this.children.map((c) => (c && typeof c.textContent === 'string') ? c.textContent : '').join('')
        : this._text;
    },
    set textContent(v) { this._text = v; this.children = []; },
    get innerHTML() { return this._text; },
    set innerHTML(v) { this._text = v; this.children = []; },
    setAttribute(k, v) { this.attributes[k] = v; },
    addEventListener(evt, fn) { (this._listeners[evt] = this._listeners[evt] || []).push(fn); },
    append(...nodes) { this.children.push(...nodes); },
    focus() {},
    // Aides de test (pas de vraie API DOM) :
    __click() { (this._listeners.click || []).forEach((fn) => fn({})); },
    __keydown(key) { (this._listeners.keydown || []).forEach((fn) => fn({ key })); },
  };
  return el;
}

const documentFactice = { createElement: (tag) => creerElementFactice(tag) };

// Le module carte-reponse-produite.js lit `document` en global (chargement <script>
// classique, sans bundler) ; le moteur, lui, est INJECTÉ (plus aucun global lu).
global.document = documentFactice;
global.window = global.window || {};
const moteur = require('./moteur-correction-v1.js').creerMoteur();
const ancien = (r) => ({ statut: r.issue, reussite: r.reussite, tentative: r.tentative, scored: r.compte });

// Le fichier sous test n'exporte rien via module.exports (format <script> classique,
// pose window.FondaCarteReponseProduite) : on le require() pour son effet de bord,
// puis on récupère la fonction sur le global window qu'on vient de poser.
delete require.cache[require.resolve('./carte-reponse-produite.js')];
require('./carte-reponse-produite.js');
const { montrerCarteReponseProduite } = global.window.FondaCarteReponseProduite;

// `relecteur` (ancienne forme : nom seul) -> badge du catalogue (CDC §12).
function monterCarte({ relecteur, forme = 'relue_et_validee', ...carte }, onResultat) {
  const container = creerElementFactice('div');
  const resultats = [];
  const bruts = [];
  montrerCarteReponseProduite(container, {
    moteur,
    carte: moteur.preparerCarte(carte),
    badge: relecteur ? { forme, nom_affiche: relecteur } : undefined,
    onResultat: (r) => { bruts.push(r); resultats.push(ancien(r)); if (onResultat) onResultat(r); },
  });
  const [, input, bouton] = container.children; // question, input, bouton, feedback
  return { container, input, bouton, resultats, bruts };
}

describe('carte-reponse-produite — contrat seconde chance (tentative/scored)', () => {
  test('réponse juste du premier coup : un seul résultat, tentative 1, scored true', () => {
    const { input, bouton, resultats } = monterCarte({
      question: 'Capitale de la France ?',
      profil_correction: 'orthographe',
      reponses_acceptees: ['Paris'],
      seconde_chance: true,
    });
    input.value = 'Paris';
    bouton.__click();

    assert.equal(resultats.length, 1);
    assert.deepEqual(resultats[0], { statut: 'juste', reussite: true, tentative: 1, scored: true });
    assert.equal(input.disabled, true, 'input verrouillé après un résultat définitif');
  });

  test('"presque" avec seconde_chance:true -> 2 résultats, seule la 1ère tentative est scored', () => {
    const { input, bouton, resultats } = monterCarte({
      question: 'Écris "garçon".',
      profil_correction: 'orthographe',
      reponses_acceptees: ['garçon'],
      seconde_chance: true,
    });

    input.value = 'garcon'; // accent manquant -> presque
    bouton.__click();
    assert.equal(resultats.length, 1);
    assert.deepEqual(resultats[0], { statut: 'presque', reussite: false, tentative: 1, scored: true });
    assert.equal(input.disabled, false, 'seconde chance proposée : input toujours actif');
    assert.equal(input.value, '', 'le champ est vidé pour la relance');

    input.value = 'garçon'; // 2e tentative, corrigée
    bouton.__click();
    assert.equal(resultats.length, 2);
    assert.deepEqual(resultats[1], { statut: 'juste', reussite: true, tentative: 2, scored: false });
    assert.equal(input.disabled, true, 'verrouillé après la 2e tentative');
  });

  test('"presque" sans seconde_chance (ou seconde_chance:false) -> pas de relance, un seul résultat scored', () => {
    const { input, bouton, resultats } = monterCarte({
      question: 'Écris "garçon".',
      profil_correction: 'orthographe',
      reponses_acceptees: ['garçon'],
      seconde_chance: false,
    });
    input.value = 'garcon';
    bouton.__click();

    assert.equal(resultats.length, 1);
    assert.deepEqual(resultats[0], { statut: 'presque', reussite: false, tentative: 1, scored: true });
    assert.equal(input.disabled, true, 'pas de seconde chance : verrouillé dès la 1ère tentative');
  });

  test('"faux" avec seconde_chance:true -> pas de relance (seconde chance réservée au "presque")', () => {
    const { input, bouton, resultats } = monterCarte({
      question: 'Capitale de la France ?',
      profil_correction: 'orthographe',
      reponses_acceptees: ['Paris'],
      seconde_chance: true,
    });
    input.value = 'Lyon';
    bouton.__click();

    assert.equal(resultats.length, 1);
    assert.deepEqual(resultats[0], { statut: 'faux', reussite: false, tentative: 1, scored: true });
    assert.equal(input.disabled, true);
  });

  test('feedback : affiche la cible arrondie, pas la fraction brute (critique Codex #7)', () => {
    const { input, bouton, container } = monterCarte({
      question: 'Combien vaut 1/3, arrondi à 2 décimales ?',
      profil_correction: 'numerique',
      reponses_acceptees: ['1/3'],
      arrondi: 2,
    });
    input.value = '1/3'; // la fraction brute, non arrondie : faux, mais on vérifie le MESSAGE affiché
    bouton.__click();
    const feedback = container.children[3];
    assert.ok(feedback.textContent.includes('0,33'), `attendu "0,33" dans le feedback, reçu : "${feedback.textContent}"`);
    assert.ok(!feedback.textContent.includes('1/3'), `la fraction brute ne doit plus apparaître, reçu : "${feedback.textContent}"`);
  });

  test('feedback : affiche l\'unité manquante dans la cible (critique Codex #7)', () => {
    const { input, bouton, container } = monterCarte({
      question: 'Quelle est la longueur ?',
      profil_correction: 'numerique',
      reponses_acceptees: ['8'],
      unite: 'cm',
    });
    input.value = '8'; // valeur correcte, unité omise : presque
    bouton.__click();
    const feedback = container.children[3];
    assert.ok(feedback.textContent.includes('8 cm'), `attendu "8 cm" dans le feedback, reçu : "${feedback.textContent}"`);
  });

  test('carte_invalide (attendu incohérent) : pas de crash, pas de seconde chance, jamais scored en réussite', () => {
    const { input, bouton, resultats, container } = monterCarte({
      question: 'Quelle est la masse ?',
      profil_correction: 'numerique',
      reponses_acceptees: ['8 kg'],
      unite: 'cm',
    });
    input.value = '8 cm';
    bouton.__click();

    assert.equal(resultats.length, 1);
    assert.deepEqual(resultats[0], { statut: 'carte_invalide', reussite: false, tentative: 1, scored: true });
    assert.equal(input.disabled, true, 'pas de seconde chance sur une carte invalide');
    const feedback = container.children[3];
    assert.ok(feedback.textContent.length > 0, 'un message est affiché, pas de crash');
  });

  test('validation au clavier (Entrée) déclenche le même contrat', () => {
    const { input, resultats } = monterCarte({
      question: 'Capitale de la France ?',
      profil_correction: 'orthographe',
      reponses_acceptees: ['Paris'],
    });
    input.value = 'Paris';
    input.__keydown('Enter');

    assert.equal(resultats.length, 1);
    assert.deepEqual(resultats[0], { statut: 'juste', reussite: true, tentative: 1, scored: true });
  });
});

// --- Rendu enrichi (docs/box-fonda-design/BRIEF.md) : verdict/icône, réponse
// attendue, réponses acceptées, profil, mention relecteur. Purement présentationnel
// — ne touche à aucune des assertions ci-dessus sur statut/reussite/tentative/scored.

function trouverEnfant(el, classe) {
  return (el.children || []).find((c) => c && c.className === classe);
}

describe('carte-reponse-produite — rendu enrichi par profil (thème FONDA)', () => {
  test('statut "juste" : icône ✓, verdict "Bonne réponse", profil affiché', () => {
    const { input, bouton, container } = monterCarte({
      question: 'Capitale de la France ?',
      profil_correction: 'orthographe',
      reponses_acceptees: ['Paris'],
    });
    input.value = 'Paris';
    bouton.__click();

    const feedback = container.children[3];
    assert.equal(feedback.dataset.statut, 'juste');
    const verdict = trouverEnfant(feedback, 'fonda-feedback__verdict');
    assert.ok(verdict, 'bloc verdict absent');
    const mark = trouverEnfant(verdict, 'fonda-feedback__mark');
    assert.equal(mark.textContent, '✓');
    assert.match(verdict.textContent, /Bonne réponse/);
    const profil = trouverEnfant(feedback, 'fonda-feedback__profil');
    assert.match(profil.textContent, /orthographe/);
  });

  test('statut "faux" : icône ✗, verdict "Pas tout à fait", réponse attendue affichée', () => {
    const { input, bouton, container } = monterCarte({
      question: 'Capitale de la France ?',
      profil_correction: 'exact',
      reponses_acceptees: ['Paris'],
    });
    input.value = 'Lyon';
    bouton.__click();

    const feedback = container.children[3];
    const verdict = trouverEnfant(feedback, 'fonda-feedback__verdict');
    const mark = trouverEnfant(verdict, 'fonda-feedback__mark');
    assert.equal(mark.textContent, '✗');
    assert.match(verdict.textContent, /Pas tout à fait/);
    const detail = trouverEnfant(feedback, 'fonda-feedback__detail');
    assert.match(detail.textContent, /Paris/, 'la réponse attendue doit apparaître');
  });

  test('"reponses_acceptees" avec plusieurs formes : bloc "aussi acceptées" listant chaque forme', () => {
    const { input, bouton, container } = monterCarte({
      question: 'Sens du mot ?',
      profil_correction: 'sens',
      reponses_acceptees: ['camper', 'passer la nuit dehors', 'dormir en plein air'],
    });
    input.value = 'camper';
    bouton.__click();

    const feedback = container.children[3];
    const accept = trouverEnfant(feedback, 'fonda-feedback__accept');
    assert.ok(accept, 'bloc "aussi acceptées" absent alors que plusieurs formes existent');
    assert.match(accept.textContent, /passer la nuit dehors/);
    assert.match(accept.textContent, /dormir en plein air/);
  });

  test('"reponses_acceptees" avec une seule forme : pas de bloc "aussi acceptées" (rien à lister)', () => {
    const { input, bouton, container } = monterCarte({
      question: 'Capitale de la France ?',
      profil_correction: 'exact',
      reponses_acceptees: ['Paris'],
    });
    input.value = 'Paris';
    bouton.__click();

    const feedback = container.children[3];
    assert.equal(trouverEnfant(feedback, 'fonda-feedback__accept'), undefined);
  });

  test('"relecteur" fourni : mention "Fiche relue et validée par ..." affichée', () => {
    const { input, bouton, container } = monterCarte({
      question: 'Capitale de la France ?',
      profil_correction: 'exact',
      reponses_acceptees: ['Paris'],
      relecteur: 'Justine Leblanc',
    });
    input.value = 'Paris';
    bouton.__click();

    const feedback = container.children[3];
    const relecteur = trouverEnfant(feedback, 'fonda-feedback__relecteur');
    assert.ok(relecteur, 'bloc relecteur absent alors que "relecteur" est fourni');
    assert.match(relecteur.textContent, /Justine Leblanc/);
    assert.match(relecteur.textContent, /relue et validée/);
  });

  test('"relecteur" absent (comportement par défaut, rétro-compatible) : aucun bloc relecteur', () => {
    const { input, bouton, container } = monterCarte({
      question: 'Capitale de la France ?',
      profil_correction: 'exact',
      reponses_acceptees: ['Paris'],
    });
    input.value = 'Paris';
    bouton.__click();

    const feedback = container.children[3];
    assert.equal(trouverEnfant(feedback, 'fonda-feedback__relecteur'), undefined);
  });

  test('statut "presque" : icône ✓ (compte comme réussite en sens/numerique, jamais présenté comme un échec)', () => {
    const { input, bouton, container } = monterCarte({
      question: 'Quelle est la masse ?',
      profil_correction: 'numerique',
      reponses_acceptees: ['8'],
      unite: 'cm',
    });
    input.value = '8'; // valeur correcte, unité omise -> presque
    bouton.__click();

    const feedback = container.children[3];
    assert.equal(feedback.dataset.statut, 'presque');
    assert.equal(feedback.dataset.reussite, 'true');
    const verdict = trouverEnfant(feedback, 'fonda-feedback__verdict');
    const mark = trouverEnfant(verdict, 'fonda-feedback__mark');
    assert.equal(mark.textContent, '✓', 'presque compte juste en numerique : pas la croix rouge');
  });

  test('statut "presque" en profil orthographe : icône ✗ (compte FAUX — l\'accent/le pluriel est la cible, PRD §5.1 ; relecture Codex #2)', () => {
    const { input, bouton, container } = monterCarte({
      question: 'Quel mois sommes-nous ?',
      profil_correction: 'orthographe',
      reponses_acceptees: ['été'],
    });
    input.value = 'ete'; // accent manquant -> presque au sens du moteur, mais FAUX en orthographe
    bouton.__click();

    const feedback = container.children[3];
    assert.equal(feedback.dataset.statut, 'presque');
    assert.equal(feedback.dataset.reussite, 'false', 'presque compte faux en orthographe, data-reussite doit le refléter');
    const verdict = trouverEnfant(feedback, 'fonda-feedback__verdict');
    const mark = trouverEnfant(verdict, 'fonda-feedback__mark');
    assert.equal(mark.textContent, '✗', 'jamais un ✓ qui contredirait la mesure en orthographe');
    assert.doesNotMatch(verdict.textContent, /Bonne réponse|^Presque ! \(voir/, 'le texte ne doit pas sous-entendre une réussite');
  });

  test('profil "numerique" : jamais de bloc "aussi acceptées", même avec plusieurs formes (relecture Codex #4 — formes brutes trompeuses avant arrondi/unité)', () => {
    const { input, bouton, container } = monterCarte({
      question: 'Combien vaut 1/3, arrondi à 2 décimales ?',
      profil_correction: 'numerique',
      reponses_acceptees: ['1/3', '0,33'],
      arrondi: 2,
    });
    input.value = '0,33';
    bouton.__click();

    const feedback = container.children[3];
    assert.equal(trouverEnfant(feedback, 'fonda-feedback__accept'), undefined, '"1/3" listé tel quel serait trompeur (le correcteur le refuse avec arrondi:2)');
    const detail = trouverEnfant(feedback, 'fonda-feedback__detail');
    assert.match(detail.textContent, /0,33/, 'la réponse attendue correcte (arrondie) reste affichée');
  });

  test('"reponses_acceptees" malformé (pas un tableau) : ne plante pas, onResultat est quand même appelé (relecture Codex #5)', () => {
    const { input, bouton, resultats, container } = monterCarte({
      question: 'Capitale de la France ?',
      profil_correction: 'exact',
      reponses_acceptees: 'Paris', // malformé : chaîne au lieu de tableau
    });
    input.value = 'Paris';
    assert.doesNotThrow(() => bouton.__click());

    assert.equal(resultats.length, 1, 'onResultat doit être appelé malgré la donnée malformée');
    const feedback = container.children[3];
    assert.equal(trouverEnfant(feedback, 'fonda-feedback__accept'), undefined);
  });

  test('statut "carte_invalide" : aucune mention relecteur même si "relecteur" est fourni (ce n\'est pas une carte validée dans cet état)', () => {
    const { input, bouton, container } = monterCarte({
      question: 'Quelle est la masse ?',
      profil_correction: 'numerique',
      reponses_acceptees: ['8 kg'],
      unite: 'cm', // incohérent avec reponses_acceptees -> carte_invalide
      relecteur: 'Éric Duchateau',
    });
    input.value = '8 cm';
    bouton.__click();

    const feedback = container.children[3];
    assert.equal(feedback.dataset.statut, 'carte_invalide');
    assert.equal(trouverEnfant(feedback, 'fonda-feedback__relecteur'), undefined, 'ne pas affirmer une validation sur une carte signalée incohérente');
  });
});

describe('carte-reponse-produite — correction qui plante (relecture Codex PR #2 v2, #4)', () => {
  // RÉVISÉ E4 : l'issue « erreur » passe par onResultat (plus d'onErreur). Inchangé :
  // message visible, aucune exception, rien de compté, saisie verrouillée.
  test('reponses_acceptees avec {toString:null} : au clic, message visible, aucune exception, issue « erreur » non comptée', () => {
    const { input, bouton, container, bruts } = monterCarte({
      question: 'Q ?', profil_correction: 'exact', reponses_acceptees: ['a', { toString: null }],
    });
    const feedback = container.children[3];
    input.value = 'b';
    assert.doesNotThrow(() => bouton.__click());
    assert.match(feedback.textContent, /Impossible de corriger cette réponse/);
    assert.equal(feedback.dataset.statut, 'erreur');
    assert.equal(bruts.length, 1);
    assert.equal(bruts[0].issue, 'erreur');
    assert.equal(bruts[0].compte, false, 'rien de compté pour une carte non corrigeable');
    assert.equal(bruts[0].afficher_badge_relecture, false);
    assert.equal(bruts[0].carte_terminee, true, 'l\'élève peut avancer');
    assert.equal(bouton.disabled, true);
  });
});

describe('carte-reponse-produite — exception à la frontière DOM (test d\'origine rétabli)', () => {
  // Attente d'origine (avant moteur) : la lecture de la saisie qui lève -> message
  // visible, saisie verrouillée, rien de compté, on peut avancer. E4 : le signal
  // passe par onResultat (issue « erreur » fournie par moteur.echec).
  test('getter de saisie qui lève : message visible, aucune exception, issue « erreur » non comptée, verrouillée', () => {
    const { input, bouton, container, bruts } = monterCarte({ question: 'Q ?', profil_correction: 'exact', reponses_acceptees: ['a'] });
    Object.defineProperty(input, 'value', { get() { throw new Error('boom'); } });
    assert.doesNotThrow(() => bouton.__click());
    const feedback = container.children[3];
    assert.match(feedback.textContent, /Impossible de corriger cette réponse/);
    assert.equal(feedback.dataset.statut, 'erreur');
    assert.equal(bouton.disabled, true);
    assert.equal(bruts.length, 1);
    assert.deepEqual([bruts[0].issue, bruts[0].compte, bruts[0].carte_terminee], ['erreur', false, true]);
  });
});

describe('carte-reponse-produite — exception dans onResultat', () => {
  // RÉVISÉ E3 : l'exception de l'appelant est interceptée et journalisée, sans rien
  // changer à l'affichage ni au verrouillage (avant : elle remontait).
  test('interceptée : pas d\'exception au clic, verdict affiché, saisie verrouillée', () => {
    const erreurConsole = console.error;
    const journal = [];
    console.error = (...a) => journal.push(a);
    try {
      const { input, bouton, container } = monterCarte({
        question: 'Q ?', profil_correction: 'exact', reponses_acceptees: ['a'],
      }, () => { throw new Error('bug appelant'); });
      const feedback = container.children[3];
      input.value = 'a';
      assert.doesNotThrow(() => bouton.__click());
      assert.equal(feedback.dataset.statut, 'juste');
      assert.doesNotMatch(feedback.textContent, /Impossible de corriger/);
      assert.equal(input.disabled, true);
      assert.equal(journal.length, 1, 'exception journalisée');
    } finally { console.error = erreurConsole; }
  });
});

describe('carte-reponse-produite — écarts volontaires E1/E2 et badge (CDC §4.2, §12)', () => {
  test('E2 : onResultat est appelé APRÈS le rendu et le verrouillage, avec le resultat gelé', () => {
    let vu = null;
    const { input, bouton, container } = monterCarte({
      question: 'Q ?', profil_correction: 'exact', reponses_acceptees: ['a'],
    }, (r) => { vu = { disabled: input.disabled, statut: container.children[3].dataset.statut, gele: Object.isFrozen(r) }; });
    input.value = 'a';
    bouton.__click();
    assert.deepEqual(vu, { disabled: true, statut: 'juste', gele: true });
  });

  test('E1 : seconde chance ouverte -> carte_terminee false ; après la 2e tentative -> true', () => {
    const { input, bouton, bruts } = monterCarte({
      question: 'Écris "garçon".', profil_correction: 'orthographe', reponses_acceptees: ['garçon'], seconde_chance: true,
    });
    input.value = 'garcon';
    bouton.__click();
    assert.equal(bruts[0].seconde_chance_ouverte, true);
    assert.equal(bruts[0].carte_terminee, false, '« Carte suivante » ne doit pas apparaître ici');
    input.value = 'garçon';
    bouton.__click();
    assert.equal(bruts[1].carte_terminee, true);
  });

  test('badge « relue_par » (lots historiques, auto-confirmation) : « Fiche relue par Éric Duchateau »', () => {
    const { input, bouton, container } = monterCarte({
      question: 'Q ?', profil_correction: 'exact', reponses_acceptees: ['a'], relecteur: 'Éric Duchateau', forme: 'relue_par',
    });
    input.value = 'a';
    bouton.__click();
    const relecteur = trouverEnfant(container.children[3], 'fonda-feedback__relecteur');
    assert.equal(relecteur.textContent, '✓Fiche relue par Éric Duchateau');
  });

  test('sans moteur : refus explicite au montage (aucune correction implicite)', () => {
    assert.throws(() => montrerCarteReponseProduite(creerElementFactice('div'), { carte: {} }), /moteur et carte requis/);
  });
});
