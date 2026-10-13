// Chantier « secrets hors du dépôt » — phase 1 (durcir n8n, sur copies de test).
// Génère, de façon REPRODUCTIBLE, les JSON à importer dans n8n à partir des sources :
//   - box-fonda-generation : source = n8n/fonda-generation/box-fonda-generation.json
//     (le dépôt fait foi : workflow FONDA importé inactif depuis ce fichier) ;
//   - box-suppression      : source = sources/box-suppression.live.json, export FRAIS
//     du live fourni par Éric. Tant qu'il n'est pas là, rien n'est écrit pour ce
//     workflow (décision Éric : ne pas partir de l'export du 05/10).
//
// Usage : node n8n/secrets-2026-10-13/build.js
// Aucune action réseau, aucun appel n8n : écrit seulement des fichiers locaux.

'use strict';

const fs = require('fs');
const path = require('path');

const ICI = __dirname;
const RACINE = path.join(ICI, '..', '..');
const SOURCE_FONDA = path.join(RACINE, 'n8n', 'fonda-generation', 'box-fonda-generation.json');
const SOURCE_SUPPRESSION = path.join(ICI, 'sources', 'box-suppression.live.json');

// Conservation des exécutions : AUCUN changement (décision Éric, 2026-10-13 —
// l'historique complet, réussites + erreurs, est gardé pour le diagnostic). Les
// réglages `settings` des sources sont recopiés tels quels.

// Coordonnées privées : JAMAIS dans le dépôt. Remplacées dans n8n après import.
const PLACEHOLDERS = Object.freeze({
  emailFrancais: '__EMAIL_RELECTEUR_FRANCAIS__',
  emailMaths: '__EMAIL_RELECTEUR_MATHS__',
  emailTest: '__EMAIL_TEST__',
  dossierDriveTest: '__DOSSIER_DRIVE_TEST__',
  catalogueTest: '__CATALOGUE_TEST_ID__',
});

const CATALOGUE_PROD_ID = '1AmmMsO3nh4h0GQ0I5XzIqWG_zHA9wopa';

const cloner = (o) => JSON.parse(JSON.stringify(o));
function noeud(w, nom) {
  const n = w.nodes.find((x) => x.name === nom);
  if (!n) throw new Error(`noeud "${nom}" introuvable dans "${w.name}" — l'export source a changé, vérifier avant de générer`);
  return n;
}

// ---------------------------------------------------------------------------
// box-fonda-generation : code de suppression généré par n8n (Crypto/Generate),
// adresse routée par n8n, les deux ÉCRITS dans le fichier Drive avant l'upload.
// Contrat « lot commité » : sans code ni adresse (ignorés s'ils sont présents).
// Contrat « fichier Drive » : complété ici, c'est lui que lisent /box-delete
// (code), box-selection-prof et box-question-eleve (prof_email).
// ---------------------------------------------------------------------------

function jsPreparerFichier({ emailFr, emailMaths }) {
  return `// Chantier secrets (2026-10-13) — DEUX CONTRATS :
//  - lot commité (dépôt public) : SANS code_suppression ni prof_email ; s'ils sont
//    présents dans le JSON collé, ils sont IGNORÉS ;
//  - fichier Drive (privé) : complété ICI avec le code généré par n8n (noeud
//    Crypto/Generate ; le module crypto est interdit en noeud Code sur l'instance) et l'adresse
//    routée par matière — lus ensuite par /box-delete (code), box-selection-prof et
//    box-question-eleve (prof_email).
// Plomberie uniquement : AUCUNE régénération de contenu, AUCUN appel réseau ici.

const raw = $json.lot_json;
const data = typeof raw === 'string' ? JSON.parse(raw) : raw;

if (!data || typeof data !== 'object' || data._INSTRUCTION) {
  throw new Error('Colle le JSON complet d\\'un lot FONDA dans le noeud "Coller lot FONDA" avant d\\'executer ce workflow.');
}
if (!data.id) throw new Error('Champ "id" manquant dans le JSON colle.');
if (!Array.isArray(data.cartes) || data.cartes.length === 0) throw new Error('Champ "cartes" manquant ou vide dans le JSON colle.');

// Aléa du noeud "Generer code suppression" (Crypto/Generate, hex, 16 caractères).
const alea = $json.code_aleatoire;
if (typeof alea !== 'string' || !/^[0-9a-f]{16}$/i.test(alea)) {
  throw new Error('Code aleatoire absent ou invalide : verifier le noeud "Generer code suppression" (Crypto / Generate, hex, longueur 16).');
}
const codeSuppression = 'SUP-' + alea.toUpperCase();

// Routage par matière (AGENTS.md : français -> relectrice de français, maths -> Éric).
// Adresses = PLACEHOLDERS dans le dépôt, remplacées dans n8n après import (jamais
// d'adresse réelle commitée). Garde-fou : refus d'envoyer tant qu'un placeholder reste.
const EMAIL_FRANCAIS = '${emailFr}';
const EMAIL_MATHS = '${emailMaths}';
function routerEmail(matiereLabel) {
  const m = String(matiereLabel || '').toLowerCase();
  const email = m.startsWith('fran') ? EMAIL_FRANCAIS : m.startsWith('math') ? EMAIL_MATHS : null;
  if (!email) throw new Error('Matiere non reconnue pour le routage de relecture : "' + matiereLabel + '"');
  if (email.startsWith('__') || !email.includes('@')) {
    throw new Error('Adresse de relecture non configuree (' + email + ') : remplacer le placeholder dans ce noeud apres import.');
  }
  return email;
}
const profEmail = routerEmail(data.matiere);

// Fichier Drive : on écrase TOUJOURS code et adresse par les valeurs n8n.
const fichier = { ...data, code_suppression: codeSuppression, prof_email: profEmail };
const buffer = Buffer.from(JSON.stringify(fichier, null, 2), 'utf-8');

return [{
  json: {
    id: data.id,
    matiere: data.matiere,
    niveau: data.niveau,
    notion: data.notion,
    code_suppression: codeSuppression,
    cartes: data.cartes,
    nb_cartes: data.cartes.length,
    prof_email_route: profEmail
  },
  binary: {
    data: await this.helpers.prepareBinaryData(buffer, data.id + '.json', 'application/json')
  }
}];`;
}

function construireFondaGeneration(source, { test }) {
  const w = cloner(source);
  w.name = test
    ? 'BOX-FONDA - Generation (TEST secrets 2026-10-13)'
    : 'BOX-FONDA - Generation (distribution lot calibre)';
  delete w.id;
  w.active = false;
  // Nouveau noeud natif Crypto/Generate entre "Coller lot FONDA" et "Preparer fichier".
  const preparer = noeud(w, 'Preparer fichier et destinataire');
  w.nodes.push({
    id: 'crypto_code_suppression',
    name: 'Generer code suppression',
    type: 'n8n-nodes-base.crypto',
    typeVersion: 2,
    position: [preparer.position[0], preparer.position[1]],
    parameters: { action: 'generate', dataPropertyName: 'code_aleatoire', encodingType: 'hex', stringLength: 16 },
    notes: 'Chantier secrets (2026-10-13) : code de suppression genere par n8n a chaque distribution (jamais repris du JSON colle). Noeud natif : le module crypto est interdit dans un noeud Code sur cette instance.',
  });
  // Mise en page lisible : le noeud Crypto prend la place de "Preparer fichier",
  // tous les noeuds situés à sa droite (lui compris) sont décalés d'un cran.
  const xCrypto = preparer.position[0];
  for (const n of w.nodes) {
    if (n.name !== 'Generer code suppression' && n.position[0] >= xCrypto) n.position = [n.position[0] + 240, n.position[1]];
  }
  w.connections['Coller lot FONDA'] = { main: [[{ node: 'Generer code suppression', type: 'main', index: 0 }]] };
  w.connections['Generer code suppression'] = { main: [[{ node: 'Preparer fichier et destinataire', type: 'main', index: 0 }]] };

  preparer.parameters.jsCode = jsPreparerFichier(test
    ? { emailFr: PLACEHOLDERS.emailTest, emailMaths: PLACEHOLDERS.emailTest }
    : { emailFr: PLACEHOLDERS.emailFrancais, emailMaths: PLACEHOLDERS.emailMaths });

  if (test) {
    const upload = noeud(w, 'Upload Flashcards');
    upload.parameters.folderId = { __rl: true, mode: 'id', value: PLACEHOLDERS.dossierDriveTest };
    const email = noeud(w, 'Preparer Email Validation');
    const avant = email.parameters.jsCode;
    email.parameters.jsCode = avant.replace('${baseUrl}/box-select?', '${baseUrl}/box-select-test?');
    if (email.parameters.jsCode === avant) throw new Error('lien /box-select introuvable dans "Preparer Email Validation"');
    noeud(w, 'Email Validation').parameters.subject = '=[TEST] BOX-FONDA - Fiches "{{ $json.notion }}" a valider';
  }
  return w;
}

// ---------------------------------------------------------------------------
// box-suppression : refus de tout code absent/vide/mal typé (requête ET fichier,
// 8 à 64 caractères après trim, sans contrainte de format -> anciens SUP-+8 OK),
// et vidage du fichier AVANT mise à la corbeille (l'ancien code ne survit pas).
// ---------------------------------------------------------------------------

const JS_VERIFIER_CODE = `// Chantier secrets (2026-10-13) — refus explicite de tout code absent, vide ou mal
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
    notes: 'Chantier secrets (2026-10-13) : vide le contenu (plus de code ni de cartes) AVANT la mise a la corbeille, meme motif que T-SEC pour le rejet.',
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
  const fonda = JSON.parse(fs.readFileSync(SOURCE_FONDA, 'utf8'));
  ecrire('test/box-fonda-generation-TEST.json', construireFondaGeneration(fonda, { test: true }));
  ecrire('prod/box-fonda-generation.json', construireFondaGeneration(fonda, { test: false }));

  if (fs.existsSync(SOURCE_SUPPRESSION)) {
    const supp = JSON.parse(fs.readFileSync(SOURCE_SUPPRESSION, 'utf8'));
    ecrire('test/box-suppression-TEST.json', construireSuppression(supp, { test: true }));
    ecrire('prod/box-suppression.json', construireSuppression(supp, { test: false }));
  } else {
    console.log('EN ATTENTE : sources/box-suppression.live.json (export frais du live) — box-suppression non généré.');
  }
}

module.exports = {
  construireFondaGeneration, construireSuppression, PLACEHOLDERS,
  CATALOGUE_PROD_ID, SOURCE_FONDA, SOURCE_SUPPRESSION,
};

if (require.main === module) main();
