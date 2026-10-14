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
// La sortie est construite à la main, champ par champ, à l'identique de
// JSON.stringify (aucune dépendance à l'ordre d'insertion des clés du moteur JS).
//
// Contrats : seuls ceux dont la forme est ENTIÈREMENT définie au CDC ont un schéma.
// Un contrat à forme incomplète (sous-objets non encore définis au CDC) est REFUSÉ
// (fail-closed) : son schéma sera ajouté, avec ses vecteurs, au chantier qui le
// produit (clôture / signer-clôture), après définition au CDC et relecture.
//
// Portabilité : zéro dépendance, aucun require, aucune API d'environnement
// (pas de TextEncoder, Buffer ni crypto) — copiable tel quel dans un nœud Code n8n,
// où `FondaCanonique` est alors une variable locale. Les vecteurs figés
// (canonique-vecteurs.json) prouvent que la copie n8n et celle du dépôt produisent
// les mêmes octets ; toute divergence rendrait une signature invérifiable.

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

  function estObjetSimple(v) {
    // Indépendant du « realm » (objets venus d'un autre contexte JS, ex. n8n).
    return v !== null && typeof v === 'object' && !Array.isArray(v)
      && Object.prototype.toString.call(v) === '[object Object]';
  }

  function serialiser(valeur, schema, chemin) {
    if (schema === 'chaine') {
      if (typeof valeur !== 'string') throw erreur(chemin, 'chaîne attendue');
      return JSON.stringify(valeur);
    }
    if (schema === 'nombre') {
      if (typeof valeur !== 'number' || !isFinite(valeur)) throw erreur(chemin, 'nombre fini attendu (NaN/Infinity refusés)');
      return String(valeur === 0 ? 0 : valeur); // -0 -> 0 ; sinon Number::toString
    }
    if (schema === 'booleen') {
      if (typeof valeur !== 'boolean') throw erreur(chemin, 'booléen attendu');
      return valeur ? 'true' : 'false';
    }
    if (schema && schema.type === 'tableau') {
      if (!Array.isArray(valeur)) throw erreur(chemin, 'tableau attendu');
      var parties = [];
      for (var i = 0; i < valeur.length; i += 1) {
        if (!Object.prototype.hasOwnProperty.call(valeur, i)) throw erreur(chemin + '[' + i + ']', 'trou dans le tableau');
        parties.push(serialiser(valeur[i], schema.elements, chemin + '[' + i + ']'));
      }
      return '[' + parties.join(',') + ']';
    }
    if (schema && schema.type === 'objet') {
      if (!estObjetSimple(valeur)) throw erreur(chemin, 'objet attendu');
      var connus = {};
      var sortie = [];
      for (var j = 0; j < schema.champs.length; j += 1) {
        var nom = schema.champs[j][0];
        connus[nom] = true;
        var sous = (chemin ? chemin + '.' : '') + nom;
        if (!Object.prototype.hasOwnProperty.call(valeur, nom)) throw erreur(sous, 'champ manquant');
        sortie.push(JSON.stringify(nom) + ':' + serialiser(valeur[nom], schema.champs[j][1], sous));
      }
      var cles = Object.keys(valeur);
      for (var k = 0; k < cles.length; k += 1) {
        if (!connus[cles[k]]) throw erreur((chemin ? chemin + '.' : '') + cles[k], 'champ inconnu');
      }
      return '{' + sortie.join(',') + '}';
    }
    throw erreur(chemin, 'schéma invalide');
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
    texte: function (valeur, schema) { return serialiser(valeur, schema, ''); },
    // Octets UTF-8 (tableau d'entiers 0..255) et leur hex.
    octets: function (valeur, schema) { return utf8(serialiser(valeur, schema, '')); },
    hex: function (valeur, schema) { return hex(utf8(serialiser(valeur, schema, ''))); },
    // Par nom de contrat (refus si inconnu ou à forme incomplète).
    texteContrat: function (nom, valeur) { return serialiser(valeur, schemaDuContrat(nom), ''); },
    octetsContrat: function (nom, valeur) { return utf8(serialiser(valeur, schemaDuContrat(nom), '')); },
    hexContrat: function (nom, valeur) { return hex(utf8(serialiser(valeur, schemaDuContrat(nom), ''))); },
    contrats: function () { return Object.keys(CONTRATS).filter(function (n) { return CONTRATS[n] !== null; }); },
    contratsIncomplets: function () { return Object.keys(CONTRATS).filter(function (n) { return CONTRATS[n] === null; }); },
    _utf8: utf8,
  });
})();

if (typeof module === 'object' && module && module.exports) module.exports = FondaCanonique;
else if (typeof self !== 'undefined') self.FondaCanonique = FondaCanonique;
