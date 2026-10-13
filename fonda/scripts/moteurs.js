// Chargement Node des moteurs de correction élève versionnés (CDC relecture §4.3) :
// le générateur, la publication et la CI valident les cartes avec LE MOTEUR DU LOT,
// jamais avec « le correcteur courant ». Les octets exécutés sont exactement ceux
// dont l'empreinte a été vérifiée contre fonda/engine/moteurs.json (lecture unique,
// puis compilation de ce même tampon — pas de require() qui relirait le disque).

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const RACINE = path.join(__dirname, '..', '..');
const CHEMIN_REGISTRE = path.join(RACINE, 'fonda', 'engine', 'moteurs.json');

function lireRegistre() {
  return JSON.parse(fs.readFileSync(CHEMIN_REGISTRE, 'utf8'));
}

// Dernière version enregistrée (numéro le plus haut) : moteur des NOUVEAUX lots.
function dernierMoteur(registre = lireRegistre()) {
  const tries = registre.slice().sort((a, b) => Number(b.version.slice(1)) - Number(a.version.slice(1)));
  if (!tries.length) throw new Error('moteurs.json vide');
  return { version: tries[0].version, sha256: tries[0].sha256 };
}

const cache = new Map();
function chargerMoteurNode(version, sha256, registre = lireRegistre()) {
  const lignes = registre.filter((l) => l && l.version === version);
  if (lignes.length !== 1 || lignes[0].sha256 !== sha256 || lignes[0].fichier !== `fonda/engine/moteur-correction-${version}.js`) {
    throw new Error(`moteur ${version} inconnu ou empreinte discordante avec moteurs.json`);
  }
  const cle = `${version}:${sha256}`;
  if (!cache.has(cle)) {
    const octets = fs.readFileSync(path.join(RACINE, lignes[0].fichier));
    const reel = crypto.createHash('sha256').update(octets).digest('hex');
    if (reel !== sha256) throw new Error(`fichier ${lignes[0].fichier} ≠ empreinte enregistrée (${reel})`);
    const module = { exports: {} };
    vm.runInThisContext(`(function (module, exports) {${octets.toString('utf8')}\n})`, { filename: lignes[0].fichier })(module, module.exports);
    cache.set(cle, module.exports);
  }
  const instance = cache.get(cle).creerMoteur();
  if (!instance || instance.version !== version) throw new Error(`instance.version ≠ ${version}`);
  return instance;
}

module.exports = { lireRegistre, dernierMoteur, chargerMoteurNode, CHEMIN_REGISTRE };
