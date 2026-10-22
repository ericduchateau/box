// Octets canoniques FONDA (CDC relecture §1, §11, §11 bis, §20) — étape 3, chantier 1 ;
// étendu à l'étape 4.0 (null, « chaîne ou nombre », récapitulatif, charge signée) puis à
// la brique 1 (v8.3 §20 : génération, lot complet, lot relu, décision, charge v2).
//
// Règle (CDC §1) : JSON.stringify d'ECMAScript sur une valeur construite dans l'ORDRE
// DE CLÉS DU CONTRAT ; UTF-8 sans BOM, sans espace ni saut de ligne ; nombres finis,
// forme Number::toString (-0 normalisé en 0 ; NaN/Infinity refusés) ; chaînes SANS
// normalisation Unicode (« é » précomposé ≠ « e » + accent combinant : octets
// différents, voulu) ; tous les champs présents ; aucun champ inconnu.
//
// Mécanisme GÉNÉRIQUE piloté par schéma (données JSON, sérialisables) :
//   'chaine' | 'nombre' | 'booleen' | 'chaine_ou_nombre'
//   { type: 'tableau', elements: <schéma> }
//   { type: 'objet', champs: [[nom, <schéma>], ...] }   (ordre = ordre du contrat)
//   { type: 'nullable', de: <schéma non nullable> }     (« X ou null » : la clé reste
//                                                         présente ; null n'est jamais
//                                                         une absence)
// Deux phases : (1) copies VALIDÉES du schéma puis de l'entrée (propriétés propres de
// données lues par descripteur, une seule fois ; getters, symboles, non énumérables,
// clés inconnues refusés) ; (2) JSON.stringify natif de la copie, construite dans
// l'ordre du contrat. Frontière d'entrée garantie : données JSON ordinaires (voir
// estObjetDeDonnees). Les noms de champ de forme entière et
// « __proto__ » sont interdits dans les schémas (le moteur JS les réordonnerait).
//
// canonique.js vérifie la FORME (clés, ordre, types, null) ; les VALEURS (énumérations,
// égalités, tris, grammaire des dates) sont des invariants vérifiés par le script de
// clôture, publier-lot.js et la CI (CDC §11, §11 bis).
//
// Contrats : seuls ceux dont la forme est ENTIÈREMENT définie au CDC ont un schéma.
// Un contrat à forme incomplète (sous-objets non encore définis au CDC) est REFUSÉ
// (fail-closed) : son schéma sera ajouté, avec ses vecteurs, au chantier qui le
// produit (clôture / signer-clôture), après définition au CDC et relecture.
//
// Portabilité : zéro dépendance, aucun require, aucune API d'environnement
// (pas de TextEncoder, Buffer ni crypto) — copiable tel quel dans un nœud Code n8n,
// où `FondaCanonique` est alors une variable locale. Les vecteurs figés
// (canonique-vecteurs.json, cas positifs ET refus) DÉTECTENT les divergences entre
// copies (dépôt, nœuds Code n8n) couvertes par leurs cas — pas toutes : chaque copie
// doit rejouer tout le banc. Une divergence rendrait une signature invérifiable.

var FondaCanonique = (function () {
  'use strict';

  var MOTEUR = { type: 'objet', champs: [['version', 'chaine'], ['sha256', 'chaine']] };

  // CDC §1 : coeur = { action, selection, ecartees, empreinte_relue, empreinte_publiee, moteur }.
  var COEUR = {
    type: 'objet',
    champs: [
      ['action', 'chaine'],
      ['selection', { type: 'tableau', elements: 'chaine' }],
      ['ecartees', { type: 'tableau', elements: 'chaine' }],
      ['empreinte_relue', 'chaine'],
      ['empreinte_publiee', 'chaine'],
      ['moteur', MOTEUR],
    ],
  };

  // null = contrat connu mais à forme INCOMPLÈTE au CDC -> refus explicite.
  // --- CDC v8.2 §11 bis (étape 4.0) ---------------------------------------------
  var nul = function (s) { return { type: 'nullable', de: s }; };
  var objet = function (champs) { return { type: 'objet', champs: champs }; };
  var tableau = function (s) { return { type: 'tableau', elements: s }; };

  var CARTE_RECAP = objet([
    ['item_id', 'chaine'], ['question', 'chaine'], ['reponse', nul('chaine')],
    ['profil_correction', 'chaine'], ['reponses_acceptees', tableau('chaine_ou_nombre')],
    ['unite', nul('chaine')], ['arrondi', nul('nombre')], ['seconde_chance', nul('booleen')],
  ]);
  var RECAPITULATIF = objet([
    ['schema', 'chaine'], ['set_id', 'chaine'], ['notion_id', 'chaine'], ['palier', 'chaine'],
    ['moteur', MOTEUR], ['empreinte_relue', 'chaine'], ['empreinte_publiee', 'chaine'],
    ['cartes_gardees', tableau(CARTE_RECAP)],
    ['cartes_ecartees', tableau(objet([['item_id', 'chaine'], ['question', 'chaine']]))],
  ]);
  var CONFIRMATION = objet([['mode', 'chaine'], ['par', 'chaine'], ['recue_par', 'chaine'], ['le', 'chaine']]);
  var FIDELITE = objet([['atteste_par', 'chaine'], ['le', 'chaine']]);
  var PROVENANCE = objet([['execution_id', 'chaine'], ['workflow_id', 'chaine'], ['statut', 'chaine'], ['demarree_le', 'chaine']]);
  var EXECUTION_CLOTURE = objet([['execution_id', 'chaine'], ['workflow_id', 'chaine'], ['statut', 'chaine'], ['terminee_le', 'chaine']]);
  var LEVEE = objet([['type', 'chaine'], ['constat', 'chaine']]);
  var INCIDENT = objet([
    ['id', 'chaine'], ['nature', 'chaine'], ['detecte_le', 'chaine'], ['statut', 'chaine'],
    ['resolu_le', nul('chaine')], ['preuve_resolution', nul('chaine')],
    ['periode', objet([['debut', nul('chaine')], ['fin', nul('chaine')]])],
  ]);
  var BADGE = objet([['forme', 'chaine'], ['nom_affiche', 'chaine'], ['id', nul('chaine')]]);
  // Charge signée : ordre EXACT du §11 ; jamais de champ « signature ».
  var ATTESTATION = objet([
    ['schema', 'chaine'], ['set_id', 'chaine'], ['notion_id', 'chaine'], ['palier', 'chaine'],
    ['coeur', COEUR], ['sha256_instantane', 'chaine'], ['code_confirmation', 'chaine'],
    ['confirmation', CONFIRMATION], ['fidelite_transmission', FIDELITE],
    ['relecteur_attribue', 'chaine'], ['relecteur_egal_cloturer', 'booleen'],
    ['provenances', tableau(PROVENANCE)], ['nb_fichiers_decision', 'nombre'],
    ['referentiel_version', 'chaine'], ['moteur', MOTEUR], ['execution_cloture', EXECUTION_CLOTURE],
    ['revoque_le', 'chaine'], ['levees', tableau(LEVEE)], ['incidents_connus', tableau(INCIDENT)],
    ['cloture_le', 'chaine'], ['badge', BADGE], ['cle_id', 'chaine'],
  ]);

  // --- CDC v8.3 §20 (brique 1, ADDITIF) : v1 ci-dessus INCHANGÉE --------------------
  // Sortie métier du workflow de génération (§20.3).
  var GENERATION = objet([
    ['schema', 'chaine'], ['set_id', 'chaine'], ['ref', 'chaine'], ['notion_id', 'chaine'], ['palier', 'chaine'],
    ['moteur', MOTEUR], ['referentiel_version', 'chaine'], ['journal_commit', 'chaine'], ['modele', 'chaine'],
    ['empreinte_pedagogique', 'chaine'], ['empreinte_complete', 'chaine'], ['candidat_fichier_id', 'chaine'],
  ]);
  // Projection complète du lot source (§20.4), utilisée UNIQUEMENT pour empreinte_complete.
  var CARTE_COMPLETE = objet([
    ['item_id', 'chaine'], ['numero', nul('nombre')], ['question', 'chaine'], ['reponse', nul('chaine')],
    ['difficulte', nul('chaine')], ['palier', 'chaine'], ['profil_correction', 'chaine'],
    ['reponses_acceptees', tableau('chaine_ou_nombre')], ['unite', nul('chaine')], ['arrondi', nul('nombre')],
    ['seconde_chance', nul('booleen')], ['contexte', nul('chaine')], ['set_id', 'chaine'], ['notion_id', 'chaine'],
  ]);
  var LOT_COMPLET = objet([
    ['schema', 'chaine'], ['set_id', 'chaine'], ['notion_id', 'chaine'], ['palier', 'chaine'],
    ['matiere', nul('chaine')], ['notion', nul('chaine')], ['niveau', nul('chaine')],
    ['revue_carte_par_carte', 'booleen'], ['nb_cartes', 'nombre'], ['date_creation', nul('chaine')],
    ['cartes', tableau(CARTE_COMPLETE)],
  ]);
  // État relu (§20.5) et décision (§1, désormais définie).
  var LOT_RELU = objet([
    ['set_id', 'chaine'], ['empreinte_complete', 'chaine'],
    ['cartes', tableau(objet([['item_id', 'chaine'], ['choix', 'chaine']]))],
  ]);
  var DECISION = objet([
    ['schema', 'chaine'], ['set_id', 'chaine'], ['generation', 'nombre'], ['nonce', 'chaine'], ['recu_le', 'chaine'],
    ['coeur', COEUR], ['lot_relu', LOT_RELU], ['hash_formulaire', 'chaine'],
  ]);
  // Charge v2 (§20.9) : v1 + execution_cloture nullable, source_decisions, generation,
  // fin_saisie_le, revoque_le nullable. Ordre EXACT du §20.9.
  var GENERATION_CHARGE = objet([
    ['execution_id', 'chaine'], ['workflow_id', 'chaine'], ['statut', 'chaine'], ['demarree_le', 'chaine'],
    ['terminee_le', 'chaine'], ['modele', 'chaine'], ['empreinte_complete', 'chaine'], ['journal_commit', 'chaine'],
    ['listing_debut_le', 'chaine'], ['listing_fin_le', 'chaine'],
  ]);
  var ATTESTATION_V2 = objet([
    ['schema', 'chaine'], ['set_id', 'chaine'], ['notion_id', 'chaine'], ['palier', 'chaine'],
    ['coeur', COEUR], ['sha256_instantane', 'chaine'], ['code_confirmation', 'chaine'],
    ['confirmation', CONFIRMATION], ['fidelite_transmission', FIDELITE],
    ['relecteur_attribue', 'chaine'], ['relecteur_egal_cloturer', 'booleen'],
    ['provenances', tableau(PROVENANCE)], ['nb_fichiers_decision', 'nombre'],
    ['referentiel_version', 'chaine'], ['moteur', MOTEUR], ['execution_cloture', nul(EXECUTION_CLOTURE)],
    ['source_decisions', 'chaine'], ['generation', GENERATION_CHARGE], ['fin_saisie_le', nul('chaine')],
    ['revoque_le', nul('chaine')], ['levees', tableau(LEVEE)], ['incidents_connus', tableau(INCIDENT)],
    ['cloture_le', 'chaine'], ['badge', BADGE], ['cle_id', 'chaine'],
  ]);

  var CONTRATS = {
    'moteur-fonda/v1': MOTEUR,
    'coeur-decision-fonda/v1': COEUR,
    'recapitulatif-fonda/v1': RECAPITULATIF,
    'attestation-cloture/v1': ATTESTATION,
    'generation-fonda/v1': GENERATION,
    'lot-complet-fonda/v1': LOT_COMPLET,
    'lot_relu-fonda/v1': LOT_RELU,
    'decision-fonda/v1': DECISION,
    'attestation-cloture/v2': ATTESTATION_V2,
    // Instantané : JAMAIS reconstruit, vérifié en octets bruts (§3.2, §20.5) -> aucune
    // forme canonique, refusé ici.
    'instantane-fonda/v1': null,
  };

  function erreur(chemin, message) {
    return new Error('canonique : ' + (chemin || '(racine)') + ' : ' + message);
  }

  var CLE_ENTIERE = /^(0|[1-9][0-9]*)$/;

  // Lecture d'un objet de SCHÉMA : propriétés propres de données, énumérables, clés
  // EXACTEMENT celles attendues (rien d'hérité, rien de caché, aucun accesseur).
  function lireSchema(objet, attendues, chemin) {
    if (objet === null || typeof objet !== 'object' || Array.isArray(objet)) throw erreur(chemin, 'schéma invalide');
    var propres = Reflect.ownKeys(objet);
    if (propres.length !== attendues.length) throw erreur(chemin, 'schéma invalide (clés)');
    var sortie = {};
    for (var i = 0; i < attendues.length; i += 1) {
      var d = Object.getOwnPropertyDescriptor(objet, attendues[i]);
      if (!d || !('value' in d) || !d.enumerable) throw erreur(chemin, 'schéma invalide (' + attendues[i] + ')');
      sortie[attendues[i]] = d.value;
    }
    return sortie;
  }

  // COPIE VALIDÉE d'un schéma, faite une seule fois avant tout parcours (y compris
  // sous un tableau vide) ; seule cette copie est utilisée ensuite. Types connus,
  // noms de champs uniques, ni clé de forme entière (le moteur JS les réordonnerait)
  // ni « __proto__ ».
  function copierSchema(schema, chemin) {
    if (schema === 'chaine' || schema === 'nombre' || schema === 'booleen' || schema === 'chaine_ou_nombre') return schema;
    if (schema === null || typeof schema !== 'object') throw erreur(chemin, 'schéma invalide');
    var dType = Object.getOwnPropertyDescriptor(schema, 'type');
    var type = dType && 'value' in dType ? dType.value : undefined;
    if (type === 'nullable') {
      var u = lireSchema(schema, ['type', 'de'], chemin);
      var de = copierSchema(u.de, chemin);
      if (de && de.type === 'nullable') throw erreur(chemin, 'schéma invalide (nullable imbriqué)');
      return Object.freeze({ type: 'nullable', de: de });
    }
    if (type === 'tableau') {
      var t = lireSchema(schema, ['type', 'elements'], chemin);
      return Object.freeze({ type: 'tableau', elements: copierSchema(t.elements, chemin + '[]') });
    }
    if (type === 'objet') {
      var o = lireSchema(schema, ['type', 'champs'], chemin);
      if (!Array.isArray(o.champs)) throw erreur(chemin, 'schéma invalide (champs)');
      var n = Object.getOwnPropertyDescriptor(o.champs, 'length').value;
      var vus = Object.create(null);
      var champs = [];
      for (var i = 0; i < n; i += 1) {
        var dc = Object.getOwnPropertyDescriptor(o.champs, String(i));
        if (!dc || !('value' in dc) || !dc.enumerable || !Array.isArray(dc.value)) throw erreur(chemin, 'schéma invalide (champ mal formé)');
        var c = dc.value;
        var d0 = Object.getOwnPropertyDescriptor(c, '0');
        var d1 = Object.getOwnPropertyDescriptor(c, '1');
        // Paire EXACTE : length 2, clés « 0 », « 1 », « length », données énumérables.
        if (Object.getOwnPropertyDescriptor(c, 'length').value !== 2 || Reflect.ownKeys(c).length !== 3
          || !d0 || !d1 || !('value' in d0) || !('value' in d1) || !d0.enumerable || !d1.enumerable
          || typeof d0.value !== 'string') {
          throw erreur(chemin, 'schéma invalide (champ mal formé)');
        }
        var nom = d0.value;
        if (CLE_ENTIERE.test(nom) || nom === '__proto__') throw erreur(chemin, 'schéma invalide (nom de champ interdit : ' + nom + ')');
        if (vus[nom]) throw erreur(chemin, 'schéma invalide (champ en double : ' + nom + ')');
        vus[nom] = true;
        champs.push(Object.freeze([nom, copierSchema(d1.value, (chemin ? chemin + '.' : '') + nom)]));
      }
      if (Reflect.ownKeys(o.champs).length !== n + 1) throw erreur(chemin, 'schéma invalide (champs)');
      return Object.freeze({ type: 'objet', champs: Object.freeze(champs) });
    }
    throw erreur(chemin, 'schéma invalide');
  }

  // Valeur d'une propriété PROPRE de DONNÉES, lue par son descripteur (jamais par un
  // accesseur : un getter est refusé, rien n'est exécuté).
  function valeurPropre(objet, cle, chemin) {
    var d = Object.getOwnPropertyDescriptor(objet, cle);
    if (!d) throw erreur(chemin, 'champ manquant');
    if (!('value' in d)) throw erreur(chemin, 'accesseur (getter/setter) refusé');
    if (!d.enumerable) throw erreur(chemin, 'propriété non énumérable refusée');
    return d.value;
  }

  // FRONTIÈRE D'ENTRÉE GARANTIE : des DONNÉES JSON ORDINAIRES (issues de JSON.parse
  // ou de littéraux), éventuellement d'un autre contexte JS (ex. n8n). Admis : objet à
  // prototype nul, ou dont le prototype est un « Object.prototype » (prototype à
  // parent nul dont `constructor` est la fonction native Object). Refusés : Map, Set,
  // Date (marques internes vérifiées), instances de classes, prototypes personnalisés.
  // Ce filtre n'est PAS une détection générale des objets exotiques : un Proxy (dont
  // les traps peuvent s'exécuter) ou un objet construit pour imiter Object.prototype
  // ne sont pas détectables de façon sûre. Chaque valeur est lue une fois par
  // descripteur et la sortie est calculée sur la COPIE.
  function aUneMarque(v) {
    var essais = [
      function () { Map.prototype.has.call(v, 0); },
      function () { Set.prototype.has.call(v, 0); },
      function () { Date.prototype.getTime.call(v); },
    ];
    for (var i = 0; i < essais.length; i += 1) {
      try { essais[i](); return true; } catch (e) { /* pas cette marque */ }
    }
    return false;
  }
  function estObjectPrototype(proto) {
    if (Object.getPrototypeOf(proto) !== null) return false;
    var d = Object.getOwnPropertyDescriptor(proto, 'constructor');
    if (!d || !('value' in d) || typeof d.value !== 'function' || d.value.name !== 'Object') return false;
    var dp = Object.getOwnPropertyDescriptor(d.value, 'prototype');
    if (!dp || dp.value !== proto) return false;
    return /\{\s*\[native code\]\s*\}\s*$/.test(Function.prototype.toString.call(d.value));
  }
  function estObjetDeDonneesStrict(v) {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
    var proto = Object.getPrototypeOf(v);
    if (proto !== null && !estObjectPrototype(proto)) return false;
    return !aUneMarque(v);
  }
  // BI-MODE (correctif runtime n8n, lot 8) : le moteur de code de n8n NEUTRALISE la
  // lecture de prototype (Object.getPrototypeOf = () => ({}), accesseur __proto__
  // absent — vérifié dans le vrai moteur, sonde 279808) : le contrôle strict y refuse
  // TOUT objet. Détection UNE seule fois, au chargement :
  //   - prototype LISIBLE (Node : signataire, CI, publication, front) -> contrôle STRICT
  //     ci-dessus, INCHANGÉ ;
  //   - prototype NEUTRALISÉ (n8n) -> REPLI STRUCTUREL : objet non tableau, étiquette
  //     interne « [object Object] », aucune marque Map/Set/Date. Plus large (une instance
  //     de classe y passerait) mais sans effet sur la preuve : le texte canonique d'une
  //     donnée acceptée est le MÊME dans les deux modes (lecture par descripteur, clés du
  //     contrat, accesseurs et champs inconnus refusés dans les deux), et le signataire,
  //     sous Node en mode strict, RECALCULE lui-même les empreintes depuis le fichier.
  //     LIMITE CONNUE du repli (relecture Codex) : Object.prototype.toString lit
  //     Symbol.toStringTag ; un accesseur sur cette clé (propre ou hérité) s'EXÉCUTE donc
  //     une fois avant le refus de l'objet (jamais en mode strict). Sans conséquence pour le
  //     nœud n8n, dont les entrées sont des données JSON ; le contrôle est gardé.
  var PROTOTYPE_LISIBLE = (function () {
    try {
      return Object.getPrototypeOf(Object.create(null)) === null
        && Object.getPrototypeOf(Object.prototype) === null
        && Object.getPrototypeOf({}) === Object.prototype;
    } catch (e) { return false; }
  })();
  function estObjetDeDonneesRepli(v) {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
    if (Object.prototype.toString.call(v) !== '[object Object]') return false;
    return !aUneMarque(v);
  }
  var estObjetDeDonnees = PROTOTYPE_LISIBLE ? estObjetDeDonneesStrict : estObjetDeDonneesRepli;

  // Phase 1 : copie VALIDÉE (données fraîches, clés dans l'ordre du contrat).
  function copier(valeur, schema, chemin) {
    if (schema === 'chaine') {
      if (typeof valeur !== 'string') throw erreur(chemin, 'chaîne attendue');
      return valeur;
    }
    if (schema === 'nombre') {
      if (typeof valeur !== 'number' || !isFinite(valeur)) throw erreur(chemin, 'nombre fini attendu (NaN/Infinity refusés)');
      return valeur === 0 ? 0 : valeur; // -0 -> 0 (JSON.stringify le fait aussi ; explicite)
    }
    if (schema === 'booleen') {
      if (typeof valeur !== 'boolean') throw erreur(chemin, 'booléen attendu');
      return valeur;
    }
    if (schema === 'chaine_ou_nombre') {
      if (typeof valeur === 'string') return valeur;
      if (typeof valeur === 'number' && isFinite(valeur)) return valeur === 0 ? 0 : valeur;
      throw erreur(chemin, 'chaîne ou nombre fini attendu');
    }
    if (schema.type === 'nullable') {
      // null explicite seulement : undefined (ou absence de la clé, refusée en amont)
      // n'est jamais assimilé à null.
      return valeur === null ? null : copier(valeur, schema.de, chemin);
    }
    if (schema.type === 'tableau') {
      if (!Array.isArray(valeur)) throw erreur(chemin, 'tableau attendu');
      var n = Object.getOwnPropertyDescriptor(valeur, 'length').value; // propre, non énumérable
      var cles = Reflect.ownKeys(valeur);
      // Contrôle linéaire : exactement « length » + les indices 0..n-1 (clés distinctes).
      if (cles.length !== n + 1) throw erreur(chemin, 'tableau à trous ou propriété supplémentaire refusés');
      for (var q = 0; q < cles.length; q += 1) {
        if (cles[q] !== 'length' && !(typeof cles[q] === 'string' && CLE_ENTIERE.test(cles[q]) && Number(cles[q]) < n)) {
          throw erreur(chemin, 'tableau à trous ou propriété supplémentaire refusés');
        }
      }
      var sortie = [];
      for (var i = 0; i < n; i += 1) {
        sortie.push(copier(valeurPropre(valeur, String(i), chemin + '[' + i + ']'), schema.elements, chemin + '[' + i + ']'));
      }
      return sortie;
    }
    // objet
    if (!estObjetDeDonnees(valeur)) throw erreur(chemin, 'objet de données attendu');
    var connus = Object.create(null);
    var copie = {};
    for (var j = 0; j < schema.champs.length; j += 1) {
      var nom = schema.champs[j][0];
      connus[nom] = true;
      var sous = (chemin ? chemin + '.' : '') + nom;
      copie[nom] = copier(valeurPropre(valeur, nom, sous), schema.champs[j][1], sous);
    }
    var propres = Reflect.ownKeys(valeur); // symboles et non énumérables compris
    for (var k = 0; k < propres.length; k += 1) {
      var cle = propres[k];
      if (typeof cle !== 'string' || connus[cle] !== true) {
        throw erreur((chemin ? chemin + '.' : '') + String(cle), 'champ inconnu');
      }
    }
    return copie;
  }

  // Phase 2 : JSON.stringify d'ECMAScript sur la copie construite dans l'ordre du
  // contrat (CDC §1, littéralement). Sans espace ni saut de ligne.
  function serialiser(valeur, schema) {
    var sch = copierSchema(schema, '');
    return JSON.stringify(copier(valeur, sch, ''));
  }

  // UTF-8 (sans BOM) écrit à la main : aucune dépendance à TextEncoder/Buffer.
  // Les chaînes produites par JSON.stringify sont bien formées (substituts isolés
  // échappés en \uXXXX), donc tout substitut rencontré ici est apparié.
  function utf8(texte) {
    var o = [];
    for (var i = 0; i < texte.length; i += 1) {
      var c = texte.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < texte.length) {
        var d = texte.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i += 1; }
      }
      if (c >= 0xd800 && c <= 0xdfff) throw erreur('', 'substitut UTF-16 isolé');
      if (c < 0x80) o.push(c);
      else if (c < 0x800) o.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) o.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else o.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return o;
  }

  function hex(octets) {
    var s = '';
    for (var i = 0; i < octets.length; i += 1) s += (octets[i] < 16 ? '0' : '') + octets[i].toString(16);
    return s;
  }

  function schemaDuContrat(nom) {
    if (!Object.prototype.hasOwnProperty.call(CONTRATS, nom)) throw erreur('', 'contrat inconnu : ' + nom);
    if (CONTRATS[nom] === null) throw erreur('', 'contrat à forme incomplète au CDC (refusé tant que ses sous-objets ne sont pas définis) : ' + nom);
    return CONTRATS[nom];
  }

  return Object.freeze({
    // Texte canonique (chaîne JS) d'une valeur selon un schéma explicite.
    texte: function (valeur, schema) { return serialiser(valeur, schema); },
    // Octets UTF-8 (tableau d'entiers 0..255) et leur hex.
    octets: function (valeur, schema) { return utf8(serialiser(valeur, schema)); },
    hex: function (valeur, schema) { return hex(utf8(serialiser(valeur, schema))); },
    // Par nom de contrat (refus si inconnu ou à forme incomplète).
    texteContrat: function (nom, valeur) { return serialiser(valeur, schemaDuContrat(nom)); },
    octetsContrat: function (nom, valeur) { return utf8(serialiser(valeur, schemaDuContrat(nom))); },
    hexContrat: function (nom, valeur) { return hex(utf8(serialiser(valeur, schemaDuContrat(nom)))); },
    contrats: function () { return Object.keys(CONTRATS).filter(function (n) { return CONTRATS[n] !== null; }); },
    contratsIncomplets: function () { return Object.keys(CONTRATS).filter(function (n) { return CONTRATS[n] === null; }); },
    _utf8: utf8,
    // Mode du contrôle d'objet retenu au chargement (diagnostic, tests) : 'strict' | 'repli'.
    _mode: PROTOTYPE_LISIBLE ? 'strict' : 'repli',
  });
})();

if (typeof module === 'object' && module !== null && typeof module.exports === 'object') module.exports = FondaCanonique;
else if (typeof self === 'object' && self !== null) self.FondaCanonique = FondaCanonique;
