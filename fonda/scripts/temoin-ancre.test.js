// ANCRE du témoin (CDC relecture §21.8, point 6) — fichier de CONFIANCE (§15). Détecteur
// d'ACCIDENT : vérifie que temoin-saisie-locale.test.js a l'empreinte fixée en P1 et que la
// même valeur est consignée au CDC. Une modification intentionnelle du témoin passe par la mise
// à jour de cette ancre ET du CDC, donc par une PR relue par Éric (protection procédurale).
// Usage : node --test fonda/scripts/temoin-ancre.test.js

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EMPREINTE_TEMOIN = 'sha256:67d3f11b824028370befce6bb8f9f241e9e3dfdb89d91c397019b557a88f21b0';
const RACINE = path.resolve(__dirname, '..', '..');

test('ancre : empreinte du témoin = constante, et consignée au CDC §21.8', () => {
  const octets = fs.readFileSync(path.join(__dirname, 'temoin-saisie-locale.test.js'));
  assert.equal(`sha256:${crypto.createHash('sha256').update(octets).digest('hex')}`, EMPREINTE_TEMOIN, 'témoin modifié : mettre à jour l\'ancre et le CDC par une PR relue par Éric');
  const cdc = fs.readFileSync(path.join(RACINE, 'docs/CDC-fonda-relecture.md'), 'utf8');
  assert.ok(cdc.includes(`EMPREINTE_TEMOIN = ${EMPREINTE_TEMOIN}`), 'empreinte du témoin absente du CDC §21.8');
});
