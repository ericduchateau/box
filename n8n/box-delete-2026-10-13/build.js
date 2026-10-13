// Durcissement BOX de /box-delete (extrait du chantier « secrets », 2026-10-13).
// Génère, de façon REPRODUCTIBLE, les JSON à importer dans n8n à partir de l'export
// frais du live (sources/box-suppression.live.json, 2026-10-13) :
//   - refus de tout code absent, vide ou mal typé (requête ET fichier), 8 à 64
//     caractères après trim, sans format imposé (anciens SUP- + 8 OK) ;
//   - vidage du fichier AVANT mise à la corbeille (l'ancien code ne survit pas).
// Réglages de conservation des exécutions : inchangés (décision Éric).
//
// Usage : node n8n/box-delete-2026-10-13/build.js
// Aucune action réseau, aucun appel n8n : écrit seulement des fichiers locaux.

'use strict';

const fs = require('fs');
const path = require('path');

const ICI = __dirname;
const SOURCE_SUPPRESSION = path.join(ICI, 'sources', 'box-suppression.live.json');
const CATALOGUE_PROD_ID = '1AmmMsO3nh4h0GQ0I5XzIqWG_zHA9wopa';
const PLACEHOLDERS = Object.freeze({ catalogueTest: '__CATALOGUE_TEST_ID__' });

const cloner = (o) => JSON.parse(JSON.stringify(o));
function noeud(w, nom) {
  const n = w.nodes.find((x) => x.name === nom);
  if (!n) throw new Error(`noeud "${nom}" introuvable dans "${w.name}" — l'export source a changé, vérifier avant de générer`);
  return n;
}

const JS_VERIFIER_CODE = `// Durcissement /box-delete (2026-10-13) — refus explicite de tout code absent, vide ou mal
// typé, côté REQUÊTE et côté FICHIER (avant : undefined === undefined passait).
// Contrôle de longueur seulement (8 à 64 caractères après trim) : aucun format
// imposé, pour ne pas casser la suppression des jeux BOX existants (SUP- + 8).
const prevData = $('Trouver et verifier').first().json;
const buffer = await this.helpers.getBinaryDataBuffer(0, 'data');
const fiche = JSON.parse(buffer.toString('utf-8'));

function codeValide(c) {
  if (typeof c !== 'string') return null;
  const t = c.trim();
  return t.length >= 8 && t.length <= 64 ? t : null;
}
const codeDemande = codeValide(prevData.code_suppression);
const codeFichier = codeValide(fiche && fiche.code_suppression);

if (!codeDemande || !codeFichier || codeDemande !== codeFichier) {
  return [{ json: { verified: false, error: 'Code incorrect' } }];
}

// Code OK : préparer la suppression
const catalogue = prevData.catalogue;
catalogue.sets.splice(prevData.set_index, 1);
catalogue.total_sets = catalogue.sets.length;
catalogue.last_updated = new Date().toISOString();

// Contenu de remplacement écrit AVANT la mise à la corbeille : plus de cartes, plus
// de code, plus d'adresse — un fichier en corbeille (encore lisible par id tant
// qu'il n'est pas purgé) ne valide plus rien.
const fichierVide = { id: fiche.id || prevData.set_id, cartes: [], supprime_le: new Date().toISOString() };

return [{
  json: {
    verified: true,
    drive_file_id: prevData.drive_file_id,
    updated_catalogue: JSON.stringify(catalogue, null, 2),
    fichier_vide_json: JSON.stringify(fichierVide)
  }
}];`;

function construireSuppression(source, { test }) {
  const w = cloner(source);
  const verifier = noeud(w, 'Verifier code');
  const codeOk = noeud(w, 'Code OK ?');
  const supprimer = noeud(w, 'Supprimer fichier');
  noeud(w, 'Trouver et verifier');
  if (!w.connections['Code OK ?'] || w.connections['Code OK ?'].main[0][0].node !== 'Supprimer fichier') {
    throw new Error('branche "Code OK ?" -> "Supprimer fichier" introuvable : export source différent de celui attendu');
  }

  verifier.parameters.jsCode = JS_VERIFIER_CODE;

  const cred = supprimer.credentials;
  w.nodes.push({
    id: 'vider_avant_suppression',
    name: 'Vider fichier avant suppression',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [codeOk.position[0] + 120, codeOk.position[1] - 250],
    parameters: {
      method: 'PATCH',
      url: '=https://www.googleapis.com/upload/drive/v3/files/{{ $json.drive_file_id }}?uploadType=media',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleDriveOAuth2Api',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ $json.fichier_vide_json }}',
      options: {},
    },
    credentials: cloner(cred),
    notes: 'Durcissement /box-delete (2026-10-13) : vide le contenu (plus de code ni de cartes) AVANT la mise a la corbeille, meme motif que T-SEC pour le rejet.',
  });
  w.connections['Code OK ?'].main[0] = [{ node: 'Vider fichier avant suppression', type: 'main', index: 0 }];
  w.connections['Vider fichier avant suppression'] = { main: [[{ node: 'Supprimer fichier', type: 'main', index: 0 }]] };
  // Après le PATCH, $json est la réponse Drive : l'id du fichier est relu explicitement.
  supprimer.parameters.fileId = { __rl: true, mode: 'id', value: "={{ $('Verifier code').item.json.drive_file_id }}" };

  if (test) {
    w.name = 'BOX - Suppression (TEST secrets 2026-10-13)';
    delete w.id;
    w.active = false;
    const webhook = w.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
    webhook.parameters.path = 'box-delete-test';
    webhook.webhookId = 'b0c5e7a1-5ec2-4e7a-9d13-7e57de1e7e00';
    const texte = JSON.stringify(w).split(CATALOGUE_PROD_ID).join(PLACEHOLDERS.catalogueTest);
    const wt = JSON.parse(texte);
    if (JSON.stringify(wt).includes(CATALOGUE_PROD_ID)) throw new Error('id du catalogue de prod encore présent dans la copie de test');
    return wt;
  }
  return w;
}

function ecrire(rel, objet) {
  fs.writeFileSync(path.join(ICI, rel), JSON.stringify(objet, null, 2) + '\n');
  console.log('écrit :', rel);
}

function main() {
  const supp = JSON.parse(fs.readFileSync(SOURCE_SUPPRESSION, 'utf8'));
  ecrire('test/box-suppression-TEST.json', construireSuppression(supp, { test: true }));
  ecrire('prod/box-suppression.json', construireSuppression(supp, { test: false }));
}

module.exports = { construireSuppression, PLACEHOLDERS, CATALOGUE_PROD_ID, SOURCE_SUPPRESSION };

if (require.main === module) main();
