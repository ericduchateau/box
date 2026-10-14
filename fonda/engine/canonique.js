// Octets canoniques FONDA (CDC relecture §1, §11) — étape 3, chantier 1.
//
// Règle (CDC §1) : JSON.stringify d'ECMAScript sur une valeur construite dans l'ORDRE
// DE CLÉS DU CONTRAT ; UTF-8 sans BOM, sans espace ni saut de ligne ; nombres finis,
// forme Number::toString (-0 normalisé en 0 ; NaN/Infinity refusés) ; chaînes SANS
// normalisation Unicode (« é » précomposé ≠ « e » + accent combinant : octets
// différents, voulu) ; tous les champs présents ; aucun champ inconnu.
//
// Mécanisme GÉNÉRIQUE piloté par schéma (données JSON, sérialisables) :
//   'chaine' | 'nombre' | 'booleen'
//   { type: 'tableau', elements: <schéma> }
//   { type: 'objet', champs: [[nom, <schéma>], ...] }   (ordre = ordre du contrat)
// Deux phases : (1) copie VALIDÉE de l'entrée (propriétés propres de données lues
// par descripteur, une seule fois ; getters, symboles, non énumérables, clés
// inconnues, objets non ordinaires refusés) ; (2) JSON.stringify natif de cette copie,
// construite dans l'ordre du contrat. Les noms de champ de forme entière et
// « __proto__ » sont interdits dans les schémas (le moteur JS les réordonnerait).
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
  var CONTRATS = {
    'moteur-fonda/v1': MOTEUR,
    'coeur-decision-fonda/v1': COEUR,
    // lot_relu (forme exacte du lot relu) non fixée au CDC §1.
    'decision-fonda/v1': null,
    // candidat_lot, lot_relu, recapitulatif non fixés au CDC §3.
    'instantane-fonda/v1': null,
    // confirmation, fidelite_transmission, provenances, execution_cloture non fixés au CDC §11.
    'attestation-cloture/v1': null,
  };

  function erreur(chemin, message) {
    return new Error('canonique : ' + (chemin || '(racine)') + ' : ' + message);
  }

  var CLE_ENTIERE = /^(0|[1-9][0-9]*)$/;

  // Validation COMPLÈTE d'un schéma avant tout parcours (y compris sous un tableau
  // vide) : types connus, noms de champs uniques, ni clé de forme entière (le moteur
  // JS les réordonnerait) ni « __proto__ ».
  function validerSchema(schema, chemin) {
    if (schema === 'chaine' || schema === 'nombre' || schema === 'booleen') return;
    if (schema && schema.type === 'tableau' && Object.keys(schema).length === 2 && 'elements' in schema) {
      validerSchema(schema.elements, chemin + '[]');
      return;
    }
    if (schema && schema.type === 'objet' && Array.isArray(schema.champs) && Object.keys(schema).length === 2) {
      var vus = Object.create(null);
      for (var i = 0; i < schema.champs.length; i += 1) {
        var c = schema.champs[i];
        if (!Array.isArray(c) || c.length !== 2 || typeof c[0] !== 'string') throw erreur(chemin, 'schéma invalide (champ mal formé)');
        if (CLE_ENTIERE.test(c[0]) || c[0] === '__proto__') throw erreur(chemin, 'schéma invalide (nom de champ interdit : ' + c[0] + ')');
        if (vus[c[0]]) throw erreur(chemin, 'schéma invalide (champ en double : ' + c[0] + ')');
        vus[c[0]] = true;
        validerSchema(c[1], (chemin ? chemin + '.' : '') + c[0]);
      }
      return;
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

  // Objet de données ordinaire : prototype nul ou prototype « Object.prototype » d'un
  // contexte JS quelconque (lui-même à prototype nul). Map, Date, instances de
  // classes… ont un prototype intermédiaire : refusés. (Un Proxy n'est pas
  // détectable de façon sûre : chaque valeur est lue une seule fois par descripteur,
  // puis la sortie est calculée sur cette COPIE ; les appelants doivent passer des
  // données ordinaires — idéalement issues de JSON.parse.)
  function estObjetDeDonnees(v) {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
    var proto = Object.getPrototypeOf(v);
    return proto === null || Object.getPrototypeOf(proto) === null;
  }

  // Phase 1 : copie VALIDÉE (données fraîches, clés dans l'ordre du contrat).
  function copier(valeur, schema, chemin) {
    if (schema === 'chaine') {
      if (typeof valeur !== 'string') throw erreur(chemin, 'chaîne attendue');
      return valeur;
    }
    if (schema === 'nombre') {
      if (typeof valeur !== 'number' || !isFinite(valeur)) throw erreur(chemin, 'nombre fini attendu (NaN/Infinity refusés)');
      return valeur === 0 ? 0 : valeur; // -0 -> 0
    }
    if (schema === 'booleen') {
      if (typeof valeur !== 'boolean') throw erreur(chemin, 'booléen attendu');
      return valeur;
    }
    if (schema.type === 'tableau') {
      if (!Array.isArray(valeur)) throw erreur(chemin, 'tableau attendu');
      var n = Object.getOwnPropertyDescriptor(valeur, 'length').value; // propre, non énumérable
      var cles = Reflect.ownKeys(valeur);
      if (cles.length !== n + 1) throw erreur(chemin, 'tableau à trous ou propriété supplémentaire refusés');
      var sortie = [];
      for (var i = 0; i < n; i += 1) {
        if (cles.indexOf(String(i)) === -1) throw erreur(chemin + '[' + i + ']', 'trou dans le tableau');
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
    validerSchema(schema, '');
    return JSON.stringify(copier(valeur, schema, ''));
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
  });
})();

if (typeof module === 'object' && module !== null && typeof module.exports === 'object') module.exports = FondaCanonique;
else if (typeof self === 'object' && self !== null) self.FondaCanonique = FondaCanonique;
