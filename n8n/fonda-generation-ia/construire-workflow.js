#!/usr/bin/env node
// Construction du workflow n8n « BOX - FONDA Generation IA » (CDC relecture v8.3,
// §20.14 étape 4 : « n8n génère »). Produit le JSON (nœuds, connexions, réglages) à
// créer INACTIF dans l'instance ; l'ARTEFACT RELU est l'export exact du live,
// box-fonda-generation-ia.json, dont le harnais (workflow.test.js) vérifie que chaque
// nœud Code est OCTET POUR OCTET celui que construit ce script à partir du dépôt.
//
// Aucune logique métier n'est réécrite ici : les nœuds Code EMBARQUENT, à l'identique,
//   - les modules UMD du moteur (fonda/engine/catalogue.js, generation.js,
//     moteur-correction-v1.js, canonique.js, journal-set-ids.js) ;
//   - les fonctions pures du générateur local (fonda/scripts/generer-lot-fonda.js :
//     construirePrompt, parserReponseModele, trierCartesBrutes, construireCandidats,
//     construireLotFonda…), de moteurs.js (dernierMoteur) et de liaison-generation.js
//     (projectionComplete, nullsExplicites), copiées par Function.prototype.toString.
// Seule l'orchestration (lecture des entrées n8n, contrôles, refus) est propre au
// workflow. Un nœud Code s'exécute sans require, Buffer, TextEncoder ni crypto : le
// SHA-256 est en JavaScript pur (vérifié contre node:crypto par le harnais).
//
// Usage : node n8n/fonda-generation-ia/construire-workflow.js > workflow-construit.json

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RACINE = path.join(__dirname, '..', '..');
const G = require('../../fonda/scripts/generer-lot-fonda.js');
const Moteurs = require('../../fonda/scripts/moteurs.js');
const L = require('../../fonda/scripts/liaison-generation.js');
const C = require('../../fonda/engine/catalogue.js');

// --- Configuration épinglée (relue avec le workflow) --------------------------------------
const CONFIG = Object.freeze({
  nom: 'BOX - FONDA Generation IA',
  cheminWebhook: 'box-fonda-generation-ia',
  depot: 'ericduchateau/box',
  branche: 'design',
  // Drive « FONDA-Lots/candidats » (compte de l'établissement BOX).
  dossierCandidats: '1Ir-iJGZoSk5_FmJ9dnf_PM-NEBZWyn8d',
  // G5 : Sonnet épinglé, AUCUN repli. Snapshot daté À CONFIRMER à la recette §20.8.
  modele: 'claude-sonnet-5-5-20261001',
  maxTokens: 8192,
  nCartes: 6,
  credentialAnthropic: { id: 'YnhTnSOc1u7S99Q7', name: 'Anthropic FONDA' },
  credentialDrive: { id: 'cukxQDNwWIqOAK02', name: 'Google Drive la bonne!' },
  // Header Auth du webhook (en-tête X-FONDA-Token) : RÉFÉRENCE par id seulement ; la
  // valeur du jeton vit dans n8n, jamais dans le dépôt ni dans une conversation.
  credentialWebhook: { id: 'GfnXr5hYrYgC5RwA', name: 'FONDA Webhook Token' },
  // Portier (dette B) : jeton DISTINCT, détenu par l'appelant (Mac d'Éric) seulement.
  nomPortier: 'BOX - FONDA Generation IA (portier)',
  cheminPortier: 'box-fonda-generation-ia-portier',
  credentialPortier: { id: 'sdVd72oXHCWhIxTd', name: 'FONDA Portier Token' },
  urlGeneration: 'https://n8n.srv868991.hstgr.cloud/webhook/box-fonda-generation-ia',
});

const NOEUDS = Object.freeze({
  webhook: 'Webhook generation',
  entree: L.NOEUD_ENTREE,
  commit: 'Lire commit design',
  fixer: 'Fixer commit',
  journal: 'Lire journal',
  referentiel: 'Lire referentiel',
  moteurs: 'Lire moteurs',
  existant: 'Chercher candidat existant',
  preparer: 'Preparer generation',
  ia: 'Appel Sonnet',
  construire: 'Construire lot',
  deposer: 'Deposer candidat',
  sortie: L.NOEUD_SORTIE,
});

const MODULES = Object.freeze({
  catalogue: 'fonda/engine/catalogue.js',
  journal: 'fonda/engine/journal-set-ids.js',
  generation: 'fonda/engine/generation.js',
  moteur: 'fonda/engine/moteur-correction-v1.js',
  canonique: 'fonda/engine/canonique.js',
});

const lire = (rel) => fs.readFileSync(path.join(RACINE, rel), 'utf8');
const sha256Fichier = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(RACINE, rel))).digest('hex');

// Moteur embarqué = dernier moteur du registre ; son fichier doit correspondre.
function moteurEmbarque() {
  const m = Moteurs.dernierMoteur();
  if (`fonda/engine/moteur-correction-${m.version}.js` !== MODULES.moteur) throw new Error(`dernier moteur ${m.version} ≠ moteur embarqué ${MODULES.moteur}`);
  if (sha256Fichier(MODULES.moteur) !== m.sha256) throw new Error('moteur embarqué ≠ empreinte du registre');
  return { version: m.version, sha256: m.sha256 };
}

// --- Blocs de code embarqué (marqueurs relus par le harnais) ------------------------------
// Module : source EXACTE entre la ligne d'ouverture et « })( ». Le paramètre `self` est un
// objet neutre (aucun registre global) ; `require` ne résout que les modules embarqués.
function blocModule(cle) {
  const rel = MODULES[cle];
  const src = lire(rel);
  if (!src.endsWith('\n')) throw new Error(`${rel} : fin de ligne finale attendue`);
  return [
    `// >>> MODULE ${rel} (copie exacte, sha256=${sha256Fichier(rel)})`,
    `const M_${cle} = { exports: {} };`,
    `(function (module, exports, require, self) {\n${src}})(M_${cle}, M_${cle}.exports, requis, {});`,
    `// <<< MODULE ${rel}`,
  ].join('\n');
}
function blocFonction(fichier, nom, fn) {
  if (typeof fn !== 'function') throw new Error(`${fichier} : ${nom} non exportée`);
  return `// >>> FONCTION ${fichier} ${nom} (copie exacte)\n${fn.toString()}\n// <<< FONCTION ${nom}`;
}
// Ligne de constante non exportée, copiée telle quelle depuis la source.
function blocLigne(fichier, debut) {
  const lignes = lire(fichier).split('\n').filter((l) => l.startsWith(debut));
  if (lignes.length !== 1) throw new Error(`${fichier} : « ${debut} » introuvable ou ambigu`);
  return `// >>> LIGNE ${fichier} (copie exacte)\n${lignes[0]}\n// <<< LIGNE`;
}

const ENTETE = (role) => [
  `// FONDA — ${role}`,
  '// GÉNÉRÉ par n8n/fonda-generation-ia/construire-workflow.js : ne pas éditer dans',
  '// l\'interface (le harnais compare ce code, octet pour octet, à celui du dépôt).',
].join('\n');

const REQUIS = [
  '// require des modules embarqués uniquement (aucun module Node).',
  'function requis(nom) {',
  '  if (nom === \'./catalogue.js\' && typeof M_catalogue !== \'undefined\') return M_catalogue.exports;',
  '  throw new Error(\'module non embarqué : \' + nom);',
  '}',
].join('\n');

// SHA-256 et UTF-8 en JavaScript pur (FIPS 180-4) : aucun crypto/Buffer/TextEncoder.
const OUTILS = `// SHA-256 (FIPS 180-4), UTF-8 et base64 en JavaScript pur.
function octetsUtf8(texte) {
  const o = [];
  for (let i = 0; i < texte.length; i += 1) {
    let c = texte.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < texte.length) {
      const d = texte.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i += 1; }
    }
    if (c >= 0xd800 && c <= 0xdfff) throw new Error('UTF-16 : substitut isolé');
    if (c < 0x80) o.push(c);
    else if (c < 0x800) o.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) o.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else o.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return o;
}
function sha256Hex(octets) {
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const n = octets.length;
  const total = Math.ceil((n + 9) / 64) * 64;
  const m = new Array(total).fill(0);
  for (let i = 0; i < n; i += 1) m[i] = octets[i];
  m[n] = 0x80;
  const bits = n * 8;
  for (let i = 0; i < 8; i += 1) m[total - 1 - i] = Math.floor(bits / Math.pow(2, 8 * i)) & 0xff;
  const w = new Array(64);
  const rotr = (x, k) => (x >>> k) | (x << (32 - k));
  for (let b = 0; b < total; b += 64) {
    for (let t = 0; t < 16; t += 1) w[t] = ((m[b + 4 * t] << 24) | (m[b + 4 * t + 1] << 16) | (m[b + 4 * t + 2] << 8) | m[b + 4 * t + 3]) | 0;
    for (let t = 16; t < 64; t += 1) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let [a, bb, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t += 1) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
function octetsBase64(b64) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const s = b64.replace(/\\n/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) throw new Error('base64 invalide');
  const o = [];
  for (let i = 0; i < s.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (s[i + k] === '=' ? 0 : A.indexOf(s[i + k])));
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    // Bits de remplissage nuls exigés (forme canonique) : « YR== » refusé (≠ « YQ== »).
    if ((s[i + 2] === '=' && (v[1] & 0x0f) !== 0) || (s[i + 3] === '=' && s[i + 2] !== '=' && (v[2] & 0x03) !== 0)) throw new Error('base64 non canonique');
    o.push((n >> 16) & 255);
    if (s[i + 2] !== '=') o.push((n >> 8) & 255);
    if (s[i + 3] !== '=') o.push(n & 255);
  }
  return o;
}
// Décodage UTF-8 STRICT : toute séquence invalide ou non canonique est refusée
// (le texte ré-encodé doit redonner exactement les mêmes octets).
function texteUtf8(octets) {
  let t = '';
  let i = 0;
  while (i < octets.length) {
    const b = octets[i];
    const n = b < 0x80 ? 0 : b >= 0xf0 ? 3 : b >= 0xe0 ? 2 : b >= 0xc0 ? 1 : -1;
    if (n < 0 || i + n >= octets.length) throw new Error('UTF-8 invalide');
    let c = n === 0 ? b : b & (0x3f >> n);
    for (let k = 1; k <= n; k += 1) {
      const x = octets[i + k];
      if ((x & 0xc0) !== 0x80) throw new Error('UTF-8 invalide');
      c = (c << 6) | (x & 0x3f);
    }
    if (c > 0x10ffff) throw new Error('UTF-8 invalide');
    t += String.fromCodePoint(c);
    i += n + 1;
  }
  const r = octetsUtf8(t);
  if (r.length !== octets.length || r.some((x, k) => x !== octets[k])) throw new Error('UTF-8 non canonique');
  return t;
}
// Fichier du dépôt lu par l'API GitHub « contents » au commit consigné : octets EXACTS
// du blob (base64), jamais un texte ré-sérialisé par le nœud HTTP.
function fichierDepot(nomNoeud, chemin) {
  const f = unItem(nomNoeud);
  if (f.type !== 'file' || f.encoding !== 'base64' || f.path !== chemin || typeof f.content !== 'string') throw new Error(nomNoeud + ' : fichier ' + chemin + ' attendu (contents, base64)');
  const octets = octetsBase64(f.content);
  if (octets.length !== f.size) throw new Error(nomNoeud + ' : taille ≠ ' + f.size + ' octets');
  return { octets, texte: texteUtf8(octets) };
}`;

const UN_ITEM = (noeud) => `function unItem(nom) {
  const items = nom === null ? $input.all() : $(nom).all();
  if (!Array.isArray(items) || items.length !== 1 || !items[0] || typeof items[0].json !== 'object' || items[0].json === null) {
    throw new Error('${noeud} : exactement un item attendu de ' + (nom === null ? 'l\\'entrée' : nom));
  }
  return items[0].json;
}`;

// --- Nœuds Code ------------------------------------------------------------------------------
// Validation UNIQUE du déclencheur (dette B) : injectée À L'IDENTIQUE dans « Valider corps »
// (portier) et « FONDA Entree generation » (workflow audité) — égalité prouvée par le harnais.
// Pure, ne lève JAMAIS : { valide: true, set_id, ref } | { valide: false, erreur }.
const VALIDER_DECLENCHEUR = `// >>> VALIDATION validerDeclencheur (commune portier / entrée)
const SET_ID_PATTERN = new RegExp(${JSON.stringify(C.SET_ID_PATTERN.source)}, ${JSON.stringify(C.SET_ID_PATTERN.flags)});
function validerDeclencheur(corps) {
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return { valide: false, erreur: 'corps JSON objet attendu' };
  if (Object.keys(corps).sort().join(',') !== 'ref,set_id') return { valide: false, erreur: 'corps : exactement { set_id, ref } attendu' };
  const { set_id, ref } = corps;
  if (typeof set_id !== 'string' || !SET_ID_PATTERN.test(set_id)) return { valide: false, erreur: 'set_id invalide' };
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > 256) return { valide: false, erreur: 'ref invalide (chaîne non vide attendue)' };
  return { valide: true, set_id, ref };
}
// <<< VALIDATION validerDeclencheur`;

function codeEntree() {
  return [
    ENTETE('déclencheur : { set_id, ref } extraits du corps du webhook, rien d\'autre.'),
    VALIDER_DECLENCHEUR,
    UN_ITEM(NOEUDS.entree),
    `const v = validerDeclencheur(unItem(null).body);
if (!v.valide) throw new Error(v.erreur); // appel direct (hors portier) avec le jeton interne seulement
return [{ json: { set_id: v.set_id, ref: v.ref } }];`,
  ].join('\n\n');
}

// --- Portier (dette B) --------------------------------------------------------------------
const NOEUDS_PORTIER = Object.freeze({
  webhook: 'Webhook portier',
  valider: 'Valider corps',
  siValide: 'Corps valide ?',
  refus: 'Repondre 400',
  transmettre: 'Transmettre a la generation',
  siAcceptee: 'Generation acceptee ?',
  accepte: 'Repondre 202',
  inconnu: 'Repondre 504',
});

function codeValiderCorps() {
  return [
    ENTETE('portier : valide { set_id, ref } SANS jamais lever d\'exception (un 400 n\'appelle rien).'),
    VALIDER_DECLENCHEUR,
    `const items = $input.all();
const corps = items.length === 1 && items[0] && items[0].json ? items[0].json.body : undefined;
const v = items.length === 1 ? validerDeclencheur(corps) : { valide: false, erreur: 'exactement une requête attendue' };
return [{ json: v }];`,
  ].join('\n\n');
}

function construireWorkflowPortier() {
  const P = NOEUDS_PORTIER;
  const repondre = (nom, code, corps) => ({
    name: nom, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1,
    parameters: { respondWith: 'json', responseBody: corps, options: { responseCode: code } },
  });
  const si = (nom, gauche, operateur, droite) => ({
    name: nom, type: 'n8n-nodes-base.if', typeVersion: 2.2,
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: uuid(`${nom}:condition`), leftValue: gauche, rightValue: droite, operator: operateur }],
        combinator: 'and',
      },
      options: {},
    },
  });
  const VC = `$('${P.valider}').first().json`;
  const noeuds = [
    {
      name: P.webhook, type: 'n8n-nodes-base.webhook', typeVersion: 2, webhookId: uuid('webhook-portier'),
      credentials: { httpHeaderAuth: CONFIG.credentialPortier },
      // Appel sans en-tête X-FONDA-Token valide : refusé par n8n. Réponse par les nœuds Respond.
      parameters: { httpMethod: 'POST', path: CONFIG.cheminPortier, authentication: 'headerAuth', responseMode: 'responseNode', options: {} },
    },
    { name: P.valider, type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: codeValiderCorps() } },
    si(P.siValide, '={{ $json.valide }}', { type: 'boolean', operation: 'true', singleValue: true }, ''),
    repondre(P.refus, 400, '={{ JSON.stringify({ erreur: $json.erreur }) }}'),
    {
      name: P.transmettre, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, retryOnFail: false,
      // Erreurs de TRANSPORT (délai, connexion refusée) -> sortie d'erreur -> 504 ; tout statut
      // HTTP sort par la sortie principale (neverError) avec statusCode (fullResponse).
      onError: 'continueErrorOutput',
      credentials: { httpHeaderAuth: CONFIG.credentialWebhook },
      parameters: {
        method: 'POST', url: CONFIG.urlGeneration,
        authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
        sendBody: true, specifyBody: 'json',
        // Corps construit EXPLICITEMENT : exactement { set_id, ref }, jamais $json.
        jsonBody: `={{ JSON.stringify({ set_id: ${VC}.set_id, ref: ${VC}.ref }) }}`,
        options: { response: { response: { fullResponse: true, neverError: true } }, timeout: 30000 },
      },
    },
    si(P.siAcceptee, '={{ $json.statusCode }}', { type: 'number', operation: 'equals' }, 200),
    repondre(P.accepte, 202, `={{ JSON.stringify({ set_id: ${VC}.set_id, ref: ${VC}.ref }) }}`),
    repondre(P.inconnu, 504, '={{ JSON.stringify({ etat: \'inconnu\', consigne: \'observer, ne jamais renvoyer\' }) }}'),
  ].map((n, i) => ({ id: uuid(`portier:${n.name}`), position: [i * 220, 0], ...n }));
  const vers = (nom) => [{ node: nom, type: 'main', index: 0 }];
  const connections = {
    [P.webhook]: { main: [vers(P.valider)] },
    [P.valider]: { main: [vers(P.siValide)] },
    [P.siValide]: { main: [vers(P.transmettre), vers(P.refus)] },
    [P.transmettre]: { main: [vers(P.siAcceptee), vers(P.inconnu)] },
    [P.siAcceptee]: { main: [vers(P.accepte), vers(P.inconnu)] },
  };
  return {
    name: CONFIG.nomPortier, nodes: noeuds, connections,
    settings: { executionOrder: 'v1', saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all', saveManualExecutions: true, timezone: 'Europe/Paris' },
  };
}

function codeFixer() {
  return [
    ENTETE('journal_commit = tête de design lue à l\'instant (chaîne du premier parent).'),
    UN_ITEM(NOEUDS.fixer),
    `const sha = unItem(null).sha;
if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) throw new Error('commit de design : 40 hex attendus');
return [{ json: { journal_commit: sha } }];`,
  ].join('\n\n');
}

function codePreparer(moteur) {
  return [
    ENTETE('contrôles AVANT tout appel au modèle, puis requête G3 (liste blanche).'),
    `const CONFIG = ${JSON.stringify({ modele: CONFIG.modele, maxTokens: CONFIG.maxTokens, nCartes: CONFIG.nCartes, moteur }, null, 2)};`,
    REQUIS,
    blocModule('catalogue'),
    blocModule('journal'),
    `// NOTIONS_EXCLUES_FIGURES (exportée par fonda/scripts/generer-lot-fonda.js)\nconst NOTIONS_EXCLUES_FIGURES = new Set(${JSON.stringify([...G.NOTIONS_EXCLUES_FIGURES])});`,
    blocFonction('fonda/scripts/generer-lot-fonda.js', 'estNotionExclue', G.estNotionExclue),
    blocFonction('fonda/scripts/generer-lot-fonda.js', 'construirePrompt', G.construirePrompt),
    blocFonction('fonda/scripts/generer-lot-fonda.js', 'notionDuSetId', G.notionDuSetId),
    blocFonction('fonda/scripts/moteurs.js', 'dernierMoteur', Moteurs.dernierMoteur),
    OUTILS,
    UN_ITEM(NOEUDS.preparer),
    `const { decomposerSetId, slugDeNotion } = M_catalogue.exports;
const Journal = M_journal.exports;
const entree = unItem(${JSON.stringify(NOEUDS.entree)});
const journalCommit = unItem(${JSON.stringify(NOEUDS.fixer)}).journal_commit;

// 1. Réservation journalisée pour (set_id, ref), état « reserve », au commit consigné.
const journal = Journal.lireJournalTexte(fichierDepot(${JSON.stringify(NOEUDS.journal)}, 'fonda/data/set_ids-journal.json').texte);
const reservation = Journal.verifierReservation(journal, entree.set_id, entree.ref);
if (!reservation.ok) throw new Error('réservation : ' + reservation.raison);

// 2. Aucun candidat déjà déposé pour ce set_id (nom ou fonda_set_id).
const listing = unItem(${JSON.stringify(NOEUDS.existant)});
if (!Array.isArray(listing.files) || listing.nextPageToken) throw new Error('listing candidats/ inexploitable');
if (listing.files.length !== 0) throw new Error(entree.set_id + ' : ' + listing.files.length + ' fichier(s) déjà dans candidats/ — jamais de second dépôt');

// 3. Notion et palier encodés dans le set_id, au référentiel du commit consigné.
const fichierReferentiel = fichierDepot(${JSON.stringify(NOEUDS.referentiel)}, 'fonda/data/referentiel.json');
const referentiel = JSON.parse(fichierReferentiel.texte);
const { notion, palier } = notionDuSetId(entree.set_id, referentiel);
if (estNotionExclue(notion.id)) throw new Error(notion.id + ' exclue de la génération automatique');
const referentiel_version = 'sha256:' + sha256Hex(fichierReferentiel.octets); // octets exacts du blob

// 4. Moteur : le dernier du registre au commit consigné = celui embarqué ici.
const registre = JSON.parse(fichierDepot(${JSON.stringify(NOEUDS.moteurs)}, 'fonda/engine/moteurs.json').texte);
const dernier = dernierMoteur(registre);
if (dernier.version !== CONFIG.moteur.version || dernier.sha256 !== CONFIG.moteur.sha256) throw new Error('moteur embarqué ≠ dernier moteur de moteurs.json au commit consigné');

// 5. G3 : la notion transmise au modèle est RÉDUITE à la liste blanche ; ni taux_eval,
//    ni priorite_initiale, ni frequence_base_semaines, ni aucune donnée de cours, de
//    classe ou d'élève. Aucun contexte d'autres lots n'est transmis.
const notionG3 = {
  id: notion.id, libelle: notion.libelle, matiere: notion.matiere, axe: notion.axe,
  micro_competence: notion.micro_competence, enonce_modele: notion.enonce_modele,
};
const prompt = construirePrompt({ notion: notionG3, palier, nCartes: CONFIG.nCartes, contextesDejaUtilises: [], contextesAutresPaliers: [] });

return [{ json: {
  set_id: entree.set_id, ref: entree.ref, journal_commit: journalCommit, notion: notionG3, palier,
  referentiel_version, moteur: { version: dernier.version, sha256: dernier.sha256 },
  requete: { model: CONFIG.modele, max_tokens: CONFIG.maxTokens, messages: [{ role: 'user', content: prompt }] },
} }];`,
  ].join('\n\n');
}

function codeConstruire(moteur) {
  return [
    ENTETE('lot candidat lot-fonda/v1 depuis la réponse du modèle, empreintes, corps du dépôt Drive.'),
    `const CONFIG = ${JSON.stringify({ modele: CONFIG.modele, dossierCandidats: CONFIG.dossierCandidats, moteur }, null, 2)};`,
    REQUIS,
    blocModule('catalogue'),
    blocModule('generation'),
    blocModule('moteur'),
    blocModule('canonique'),
    `const Canonique = M_canonique.exports;
const { genererSetId, genererItemId, relecteurDepuisMatiere, validerCandidate, validerJeu, deposerEnRelecture } = M_generation.exports;
const { SCHEMA_LOT, validerLot: validerLotFonda, decomposerSetId, calculerEmpreinte } = M_catalogue.exports;
const MOTEUR = M_moteur.exports.creerMoteur();
if (MOTEUR.version !== CONFIG.moteur.version) throw new Error('moteur embarqué : version inattendue');
const OUTILS_MOTEUR = MOTEUR.outils;
const verifierContreCorrecteur = OUTILS_MOTEUR.verifierReponseOr;
const { verifierFormesAcceptees } = OUTILS_MOTEUR;
const SOURCE_FONDA_SEED = ${JSON.stringify(G.SOURCE_FONDA_SEED)};`,
    blocLigne('fonda/scripts/generer-lot-fonda.js', 'const LABEL_MATIERE = '),
    blocLigne('fonda/scripts/generer-lot-fonda.js', 'const LABEL_PALIER = '),
    blocFonction('fonda/scripts/generer-lot-fonda.js', 'parserReponseModele', G.parserReponseModele),
    blocFonction('fonda/scripts/generer-lot-fonda.js', 'autoCorrigerCarte', G.autoCorrigerCarte),
    blocFonction('fonda/scripts/generer-lot-fonda.js', 'trierCartesBrutes', G.trierCartesBrutes),
    blocFonction('fonda/scripts/generer-lot-fonda.js', 'construireCandidats', G.construireCandidats),
    blocFonction('fonda/scripts/generer-lot-fonda.js', 'construireLotFonda', G.construireLotFonda),
    blocFonction('fonda/scripts/liaison-generation.js', 'nullsExplicites', L.nullsExplicites),
    blocFonction('fonda/scripts/liaison-generation.js', 'projectionComplete', L.projectionComplete),
    OUTILS,
    UN_ITEM(NOEUDS.construire),
    `const prep = unItem(${JSON.stringify(NOEUDS.preparer)});
const reponse = unItem(null);

// G5 : modèle LU DANS LA RÉPONSE ; tout autre modèle que celui épinglé est refusé (aucun repli).
const modele = reponse.model;
if (typeof modele !== 'string' || modele !== CONFIG.modele) throw new Error('modèle de la réponse « ' + modele + ' » ≠ modèle épinglé ' + CONFIG.modele + ' (aucun repli)');
const blocTexte = (Array.isArray(reponse.content) ? reponse.content : []).find((b) => b && b.type === 'text');
const texteReponse = blocTexte ? blocTexte.text : '';
if (!texteReponse && reponse.stop_reason === 'max_tokens') throw new Error('budget max_tokens épuisé avant toute réponse — 0 carte');
const analyse = parserReponseModele(texteReponse);
if (!analyse.ok) throw new Error('réponse du modèle : ' + analyse.erreur);

// Même chaîne que generer-lot-fonda.js (genererLotPourNotionPalier puis genererReserve).
const { cartesValides } = trierCartesBrutes(analyse.cartesBrutes);
if (cartesValides.length === 0) throw new Error('aucune carte valide après vérification par le correcteur');
const d = decomposerSetId(prep.set_id);
if (!d) throw new Error('set_id indécomposable');
const candidats = construireCandidats({ notion: prep.notion, palier: prep.palier, cartesBrutes: cartesValides, sequence: d.sequence, ts: new Date().toISOString() });
const jeu = validerJeu(candidats);
if (!jeu.valide) throw new Error('jeu : ' + jeu.erreurs.join(', '));
const referentiel = JSON.parse(fichierDepot(${JSON.stringify(NOEUDS.referentiel)}, 'fonda/data/referentiel.json').texte);
const notionIdsConnus = new Set(referentiel.notions.map((n) => n.id));
candidats.forEach((c, i) => {
  const v = validerCandidate(c, { notionIdsConnus });
  if (!v.valide) throw new Error('carte ' + i + ' rejetée par validerCandidate : ' + v.erreurs.join(', '));
});
const depot = deposerEnRelecture(candidats, { notions: referentiel.notions });
if (depot.invalides.length > 0) throw new Error(depot.invalides.length + ' carte(s) écartée(s) par deposerEnRelecture — aucun dépôt');
const lot = construireLotFonda({ notion: prep.notion, palier: prep.palier, candidats: depot.parRelecteur[relecteurDepuisMatiere(prep.notion.matiere)] });
if (lot.set_id !== prep.set_id) throw new Error('set_id produit ' + lot.set_id + ' ≠ set_id réservé ' + prep.set_id);
const nuls = nullsExplicites(lot);
if (nuls.length) throw new Error('null explicite dans le lot : ' + nuls.join(', '));

// Empreintes du lot TEL QU'IL SERA DÉPOSÉ (relues par le signataire sur le fichier).
const contenu = JSON.stringify(lot, null, 2) + '\\n';
const relu = JSON.parse(contenu);
const empreinte_pedagogique = await calculerEmpreinte(relu, async (t) => sha256Hex(octetsUtf8(t)));
const empreinte_complete = 'sha256:' + sha256Hex(Canonique.octetsContrat('lot-complet-fonda/v1', projectionComplete(relu)));

const generation = {
  schema: 'generation-fonda/v1', set_id: prep.set_id, ref: prep.ref, notion_id: lot.notion_id, palier: lot.palier,
  moteur: { version: prep.moteur.version, sha256: prep.moteur.sha256 }, referentiel_version: prep.referentiel_version,
  journal_commit: prep.journal_commit, modele, empreinte_pedagogique, empreinte_complete, candidat_fichier_id: '',
};
Canonique.octetsContrat('generation-fonda/v1', generation); // forme vérifiée AVANT le dépôt

// Dépôt Drive : properties PUBLIQUES posées à la création (un seul appel, sans repli).
const nom = prep.set_id + '.lot.json';
const properties = { fonda_set_id: prep.set_id, fonda_execution_id: String($execution.id) };
if (!properties.fonda_execution_id) throw new Error('identifiant d\\'exécution indisponible');
const metadonnees = { name: nom, mimeType: 'application/json', parents: [CONFIG.dossierCandidats], properties };
const frontiere = 'fonda-' + sha256Hex(octetsUtf8(contenu)).slice(0, 32);
if (contenu.indexOf(frontiere) !== -1) throw new Error('frontière multipart présente dans le contenu');
const corps = '--' + frontiere + '\\r\\nContent-Type: application/json; charset=UTF-8\\r\\n\\r\\n' + JSON.stringify(metadonnees)
  + '\\r\\n--' + frontiere + '\\r\\nContent-Type: application/json; charset=UTF-8\\r\\n\\r\\n' + contenu + '\\r\\n--' + frontiere + '--\\r\\n';

return [{ json: { generation, depot: { nom, properties, frontiere, corps } } }];`,
  ].join('\n\n');
}

function codeSortie() {
  return [
    ENTETE('sortie generation-fonda/v1, relue par le signataire (liaison-generation.rapprocher).'),
    `const CONFIG = ${JSON.stringify({ dossierCandidats: CONFIG.dossierCandidats }, null, 2)};`,
    UN_ITEM(NOEUDS.sortie),
    `const prep = unItem(${JSON.stringify(NOEUDS.construire)});
const fichier = unItem(null);
const attendu = prep.depot;
if (typeof fichier.id !== 'string' || !fichier.id) throw new Error('dépôt Drive : identifiant absent');
if (fichier.name !== attendu.nom) throw new Error('dépôt Drive : nom ≠ ' + attendu.nom);
if (!Array.isArray(fichier.parents) || fichier.parents.length !== 1 || fichier.parents[0] !== CONFIG.dossierCandidats) throw new Error('dépôt Drive : dossier ≠ candidats/');
const p = fichier.properties;
if (!p || typeof p !== 'object' || Object.keys(p).sort().join(',') !== 'fonda_execution_id,fonda_set_id'
  || p.fonda_set_id !== attendu.properties.fonda_set_id || p.fonda_execution_id !== attendu.properties.fonda_execution_id) {
  throw new Error('dépôt Drive : properties ≠ { fonda_set_id, fonda_execution_id } attendues');
}
const sortie = { ...prep.generation, candidat_fichier_id: fichier.id };
const CHAMPS = 'schema,set_id,ref,notion_id,palier,moteur,referentiel_version,journal_commit,modele,empreinte_pedagogique,empreinte_complete,candidat_fichier_id';
if (Object.keys(sortie).join(',') !== CHAMPS) throw new Error('sortie : champs ≠ generation-fonda/v1');
return [{ json: sortie }];`,
  ].join('\n\n');
}

// --- Workflow ----------------------------------------------------------------------------------
const uuid = (graine) => {
  const h = crypto.createHash('sha256').update(`fonda-generation-ia:${graine}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
// Format de réponse : TOUJOURS « autodetect » (option absente). Dans n8n 2.6.3
// (HttpRequestV3), « text » sur un corps JSON le PARSE puis le RE-SÉRIALISE (octets
// changés), et « json » avec un corps brut (raw) renvoie un flux NON LU ; seul
// l'autodetect lit le flux et décode selon le Content-Type.
const GITHUB_ENTETES = { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }, { name: 'User-Agent', value: 'box-fonda-generation-ia' }] };
const fichierHttp = (nom, fichier) => ({
  name: nom, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
  parameters: {
    url: `={{ 'https://api.github.com/repos/${CONFIG.depot}/contents/${fichier}?ref=' + $('${NOEUDS.fixer}').first().json.journal_commit }}`,
    sendHeaders: true, headerParameters: GITHUB_ENTETES, options: { timeout: 30000 },
  },
});

function construireWorkflow() {
  const moteur = moteurEmbarque();
  const noeuds = [
    {
      name: NOEUDS.webhook, type: 'n8n-nodes-base.webhook', typeVersion: 2, webhookId: uuid('webhook'),
      credentials: { httpHeaderAuth: CONFIG.credentialWebhook },
      // Appel sans en-tête X-FONDA-Token valide : refusé par n8n AVANT toute exécution.
      // Réponse immédiate (défaut onReceived, omis comme le fait l'éditeur).
      parameters: { httpMethod: 'POST', path: CONFIG.cheminWebhook, authentication: 'headerAuth', options: {} },
    },
    { name: NOEUDS.entree, type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: codeEntree() } },
    {
      name: NOEUDS.commit, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      parameters: {
        url: `https://api.github.com/repos/${CONFIG.depot}/commits/${CONFIG.branche}`,
        sendHeaders: true,
        headerParameters: GITHUB_ENTETES,
        options: { timeout: 30000 },
      },
    },
    { name: NOEUDS.fixer, type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: codeFixer() } },
    fichierHttp(NOEUDS.journal, 'fonda/data/set_ids-journal.json'),
    fichierHttp(NOEUDS.referentiel, 'fonda/data/referentiel.json'),
    fichierHttp(NOEUDS.moteurs, 'fonda/engine/moteurs.json'),
    {
      name: NOEUDS.existant, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      credentials: { googleDriveOAuth2Api: CONFIG.credentialDrive },
      parameters: {
        url: 'https://www.googleapis.com/drive/v3/files',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleDriveOAuth2Api',
        sendQuery: true,
        queryParameters: { parameters: [
          { name: 'q', value: `={{ "'${CONFIG.dossierCandidats}' in parents and trashed = false and (name = '" + $('${NOEUDS.entree}').first().json.set_id + ".lot.json' or properties has { key='fonda_set_id' and value='" + $('${NOEUDS.entree}').first().json.set_id + "' })" }}` },
          { name: 'fields', value: 'nextPageToken,files(id,name,properties)' },
          { name: 'pageSize', value: '100' },
        ] },
        options: { timeout: 30000 },
      },
    },
    { name: NOEUDS.preparer, type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: codePreparer(moteur) } },
    {
      name: NOEUDS.ia, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, retryOnFail: false,
      credentials: { anthropicApi: CONFIG.credentialAnthropic },
      parameters: {
        method: 'POST', url: 'https://api.anthropic.com/v1/messages',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'anthropicApi',
        sendHeaders: true,
        headerParameters: { parameters: [{ name: 'anthropic-version', value: '2023-06-01' }] },
        sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.requete) }}',
        options: { timeout: 600000 },
      },
    },
    { name: NOEUDS.construire, type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: codeConstruire(moteur) } },
    {
      name: NOEUDS.deposer, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, retryOnFail: false,
      credentials: { googleDriveOAuth2Api: CONFIG.credentialDrive },
      parameters: {
        method: 'POST', url: 'https://www.googleapis.com/upload/drive/v3/files',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googleDriveOAuth2Api',
        sendQuery: true,
        queryParameters: { parameters: [{ name: 'uploadType', value: 'multipart' }, { name: 'fields', value: 'id,name,parents,properties' }] },
        sendBody: true, contentType: 'raw',
        rawContentType: '={{ \'multipart/related; boundary=\' + $json.depot.frontiere }}',
        body: '={{ $json.depot.corps }}',
        options: { timeout: 60000 },
      },
    },
    { name: NOEUDS.sortie, type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: codeSortie() } },
  ].map((n, i) => ({ id: uuid(n.name), position: [i * 220, 0], ...n }));
  const connections = {};
  for (let i = 0; i < noeuds.length - 1; i += 1) connections[noeuds[i].name] = { main: [[{ node: noeuds[i + 1].name, type: 'main', index: 0 }]] };
  return {
    name: CONFIG.nom,
    nodes: noeuds,
    connections,
    // §20.10 (a) : exécutions réussies, en erreur ET manuelles conservées.
    settings: { executionOrder: 'v1', saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all', saveManualExecutions: true, saveExecutionProgress: true, timezone: 'Europe/Paris' },
  };
}

module.exports = { CONFIG, NOEUDS, MODULES, construireWorkflow, OUTILS, NOEUDS_PORTIER, construireWorkflowPortier, VALIDER_DECLENCHEUR };

if (require.main === module) process.stdout.write(JSON.stringify(process.argv.includes('--portier') ? construireWorkflowPortier() : construireWorkflow(), null, 2) + '\n');
