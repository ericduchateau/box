// Harnais P3 + P2 (CDC relecture §21.0, §21.1, §21.5, §21.6, §21.10) — workflows « FONDA - Emettre relecture »,
// « FONDA - Confirmer relecture » et « FONDA - Cloturer relecture ». Aucun réseau : simulateur n8n (fonda-generation-ia/simulateur.js,
// réutilisé SANS modification), Drive, GitHub, Data Table et Gmail simulés.
//   1. octet-identité INTERNE : export commité == construction depuis le dépôt (P2/P3 ; dépôt <-> live à P4) ;
//   2. contrôles statiques : détection de MOTIFS CONNUS de secret/PII (pas une preuve d'absence),
//      credentials par référence, authentification d'en-tête, IF stricts, modules embarqués exacts ;
//   3. FAUX DRIVE FIDÈLE : la requête `q` de chaque nœud est INTERPRÉTÉE (parents, name =, name contains,
//      properties has, trashed, and/or/parenthèses ; clause inconnue = erreur), champs `fields` projetés,
//      pagination par jeton ; producteurs (n8n) ET signataire (VRAI adaptateurs-page.lecturePage, par un
//      fetch simulé) lisent le MÊME Drive ;
//   4. CHAÎNE RÉELLE : Emettre -> VRAI Confirmer (P2 : C1–C7, decisions/) -> Cloturer ->
//      VRAI preLireDetails -> VRAI rattacherPage -> VRAI evaluerPage -> VRAIE réconciliation (L.unicite,
//      L.reconcilier, empreinte publiée par SC.lotPublie), avec les VRAIES preuves de génération ;
//      transport HTTP de la pagination reconstitué selon la configuration du nœud (jeton en query string) ;
//   5. cas du §21.10 et réémission (§21.5), toujours par la chaîne réelle.
// Adaptations au simulateur (NON modifiable), toutes dans la COPIE de test du workflow, chacune vérifiée
// statiquement sur l'export : (a) nœud Crypto (non simulé) -> nœud Code rendant une clé fixe ; (b) Respond
// to Webhook en texte (le simulateur analyse le corps comme du JSON) : corps encapsulé par JSON.stringify,
// code HTTP (expression) évalué par le harnais sur l'item répondu. La confirmation SIMULÉE AU CONTRAT ne
// subsiste que pour les contre-épreuves de réconciliation (confirmerSimule : décision fausse mais cohérente,
// qu'un vrai Confirmer ne produit pas) ; partout ailleurs, c'est le VRAI workflow Confirmer.
// Usage : node --test n8n/fonda-relecture-page/relecture.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const B = require('./construire-relecture.js');
const { executerGraphe, evaluer: evaluerExpression } = require('../fonda-generation-ia/simulateur.js');
const L = require('../../fonda/scripts/liaison-generation.js');
const P = require('../../fonda/scripts/rattachement-page.js');
const A = require('../../fonda/scripts/adaptateurs-page.js');
const FC = require('../../fonda/scripts/fixtures/execution-confirmation.json');
const SC = require('../../fonda/scripts/signer-cloture.js');
const Cat = require('../../fonda/engine/catalogue.js');
const SHA = Cat.sha256WebCrypto();

const RACINE = path.join(__dirname, '..', '..');
const EXPORTS = { cloturer: 'box-fonda-cloturer-relecture.json', emettre: 'box-fonda-emettre-relecture.json', confirmer: 'box-fonda-confirmer-relecture.json', page: 'box-fonda-page-relecture.json' };
const lireExport = (k) => fs.readFileSync(path.join(__dirname, EXPORTS[k]));
const copie = (o) => JSON.parse(JSON.stringify(o));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const pause = () => new Promise((r) => { setTimeout(r, 3); });
const N_C = B.NOEUDS_CLOTURER; const N_E = B.NOEUDS_EMETTRE; const N_F = B.NOEUDS_CONFIRMER;
const COMMUN = B.chargerCommun();
const CONSTRUCTEURS = { cloturer: B.construireCloturer, emettre: B.construireEmettre, confirmer: B.construireConfirmer, page: B.construirePage };
// Empreintes PUBLIQUES du registre des moteurs (embarquées par la Page) : seuls littéraux hex 64 admis.
const HEX_PUBLICS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'fonda/engine/moteurs.json'), 'utf8')).map((l) => l.sha256);
const sansHexPublics = (t) => HEX_PUBLICS.reduce((x, h) => x.split(h).join('<sha256-registre>'), t);
const { dossierCandidats: CAND, dossierRelecture: RELEC, dossierDecisions: DEC } = B.CONFIG;

// ── 1. et 2. Contrôles statiques ──
const SANS_MODULES = (js) => js.replace(/\/\/ >>> MODULE [\s\S]*?\/\/ <<< MODULE [^\n]*/g, '');
describe('1. octet-identité interne et 2. contrôles statiques', () => {
  for (const [k, construire] of Object.entries(CONSTRUCTEURS)) {
    test(`${EXPORTS[k]} == construction depuis le dépôt, octet pour octet`, () => {
      assert.ok(lireExport(k).equals(Buffer.from(`${JSON.stringify(construire(), null, 2)}\n`, 'utf8')), `${EXPORTS[k]} ≠ construction : regénérer par construire-relecture.js --${k}`);
    });
    test(`${EXPORTS[k]} : détection de motifs connus de secret/PII (adresse, clé, jeton, hex 64) hors modules embarqués vérifiés`, () => {
      const wf = JSON.parse(lireExport(k));
      for (const n of wf.nodes) {
        const t = sansHexPublics(n.type === 'n8n-nodes-base.code' ? JSON.stringify({ ...n, parameters: { jsCode: SANS_MODULES(n.parameters.jsCode) } }) : JSON.stringify(n));
        assert.doesNotMatch(t, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, `${n.name} : adresse électronique`);
        assert.doesNotMatch(t, /BEGIN [A-Z ]*PRIVATE KEY|sk-ant-|Bearer [A-Za-z0-9]|ghp_|xox[bp]-/, `${n.name} : clé ou jeton`);
        assert.doesNotMatch(t, /\b[0-9a-f]{64}\b/, `${n.name} : littéral hexadécimal de 64 caractères`);
        if (n.credentials) for (const c of Object.values(n.credentials)) assert.deepEqual(Object.keys(c).sort(), ['id', 'name'], `${n.name} : credential = référence (id, nom) seulement`);
        assert.equal(n.retryOnFail === true, false, `${n.name} : retryOnFail interdit`);
        assert.equal(n.disabled, undefined, `${n.name} : aucun nœud désactivé`);
      }
      assert.equal(wf.pinData, undefined, 'aucune donnée épinglée');
      assert.equal(wf.active, undefined, 'export sans état actif (créé INACTIF en P4)');
    });
    test(`${EXPORTS[k]} : webhook POST (CLI : authentification d'en-tête ; relecteur : public, réponse par nœud) ; IF v2 STRICTS sur un booléen`, () => {
      const wf = JSON.parse(lireExport(k));
      const wh = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook');
      assert.equal(wh.length, 1);
      if (k === 'page') {
        // §21.0 : GET /fonda-select, lien du courriel ; AUCUNE écriture (toute requête HTTP est un GET Drive).
        assert.deepEqual(wh[0].parameters, { httpMethod: 'GET', path: 'fonda-select', responseMode: 'responseNode', options: {} });
        assert.equal(wh[0].credentials, undefined);
        for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.httpRequest')) assert.ok([undefined, 'GET'].includes(n.parameters.method) && n.parameters.url.includes('googleapis.com/drive/v3/files'), `${n.name} : lecture Drive seulement`);
      } else if (k === 'confirmer') {
        // §21.0 : POST /fonda-select-confirm, déclenché par le navigateur du relecteur (protégé par k + jeton).
        assert.deepEqual(wh[0].parameters, { httpMethod: 'POST', path: 'fonda-select-confirm', responseMode: 'responseNode', options: {} });
        assert.equal(wh[0].credentials, undefined);
        assert.equal(wf.settings.executionTimeout, 120, 'executionTimeout = 120 s (§7)');
      } else {
        assert.deepEqual([wh[0].parameters.httpMethod, wh[0].parameters.authentication, Object.keys(wh[0].credentials)], ['POST', 'headerAuth', ['httpHeaderAuth']]);
        assert.ok(wh[0].credentials.httpHeaderAuth.id && wh[0].credentials.httpHeaderAuth.name);
      }
      assert.doesNotMatch(JSON.stringify(wf), /\/box-|BOX-Flashcards|11KWo13pczVB_eOXw-FHUXWuutfSQqbbT/, 'aucune route ni dossier BOX (PRD §2 bis)');
      const ifs = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.if');
      assert.ok(ifs.length >= 1);
      for (const n of ifs) {
        const c = n.parameters.conditions;
        assert.deepEqual(c.options, { caseSensitive: true, typeValidation: 'strict', version: 2 }, n.name);
        assert.equal(c.conditions.length, 1, n.name);
        assert.deepEqual(c.conditions[0].operator, { type: 'boolean', operation: 'true', singleValue: true }, n.name);
        assert.match(c.conditions[0].leftValue, /^=\{\{ \$json\.[a-z_]+ \}\}$/, n.name);
        assert.equal(wf.connections[n.name].main.length, 2, `${n.name} : deux sorties câblées`);
      }
    });
  }
  test('modules et fonctions embarqués = copies EXACTES des sources du dépôt (Analyser : catalogue, journal ; Preparer : catalogue, canonique, projectionComplete)', () => {
    const wf = JSON.parse(lireExport('emettre'));
    const js = (nom) => wf.nodes.find((n) => n.name === nom).parameters.jsCode;
    for (const [nom, rel] of [[N_E.analyser, B.MODULES.catalogue], [N_E.analyser, B.MODULES.journal], [N_E.preparer, B.MODULES.catalogue], [N_E.preparer, B.MODULES.canonique]]) {
      const src = fs.readFileSync(path.join(RACINE, rel), 'utf8');
      const m = new RegExp(`// >>> MODULE ${rel} \\(copie exacte, sha256=([0-9a-f]{64})\\)\\n[^\\n]*\\n\\(function \\(module, exports, require, self\\) \\{\\n([\\s\\S]*?)\\}\\)\\(M_`).exec(js(nom));
      assert.ok(m, `${nom} : ${rel}`); assert.equal(m[2], src, rel); assert.equal(m[1], sha(Buffer.from(src)), rel);
    }
    assert.ok(js(N_E.preparer).includes(`// >>> FONCTION fonda/scripts/liaison-generation.js projectionComplete (copie exacte)\n${L.projectionComplete.toString()}\n// <<< FONCTION projectionComplete`));
  });
  test('pagination des listings Drive : configuration EXACTE (jeton en query string, fin sur absence de jeton, plafond)', () => {
    for (const [k, noms] of [['cloturer', [N_C.chercher, N_C.decisions]], ['emettre', [N_E.chercherLot, N_E.existant, N_E.decisions, N_E.relister]],
      ['confirmer', [N_F.chercher, N_F.chercherDecision]], ['page', [B.NOEUDS_PAGE.chercher]]]) {
      for (const nom of noms) {
        const n = JSON.parse(lireExport(k)).nodes.find((x) => x.name === nom);
        assert.deepEqual(n.parameters.options.pagination, { pagination: {
          paginationMode: 'updateAParameterInEachRequest',
          parameters: { parameters: [{ type: 'qs', name: 'pageToken', value: '={{ $response.body.nextPageToken }}' }] },
          paginationCompleteWhen: 'other', completeExpression: '={{ !$response.body.nextPageToken }}', limitPagesFetched: true, maxRequests: B.CONFIG.maxPagesDrive,
        } }, `${k} ${nom}`);
        assert.equal(n.parameters.queryParameters.parameters.find((x) => x.name === 'pageSize').value, '1000', `${k} ${nom}`);
      }
    }
  });
  test('noms de nœuds = ceux du consommateur gelé (ROLES.cloture, ROLES.confirmation)', () => {
    for (const [k, role] of [['cloturer', 'cloture'], ['confirmer', 'confirmation']]) {
      const noms = JSON.parse(lireExport(k)).nodes.map((n) => n.name);
      for (const n of [P.ROLES[role].entree, P.ROLES[role].ecriture, P.ROLES[role].sortie]) assert.ok(noms.includes(n), `${k} : ${n}`);
    }
  });
  test('Confirmer : modules et fonctions embarqués = copies EXACTES (catalogue, canonique, projectionComplete, lotPublie) ; base commune jeton/hash identique dans chaque nœud', () => {
    const wf = JSON.parse(lireExport('confirmer'));
    const js = (nom) => wf.nodes.find((n) => n.name === nom).parameters.jsCode;
    for (const [nom, rel] of [[N_F.controler, B.MODULES.catalogue], [N_F.controler, B.MODULES.canonique], [N_F.comparer, B.MODULES.canonique]]) {
      const src = fs.readFileSync(path.join(RACINE, rel), 'utf8');
      const m = new RegExp(`// >>> MODULE ${rel} \\(copie exacte, sha256=([0-9a-f]{64})\\)\\n[^\\n]*\\n\\(function \\(module, exports, require, self\\) \\{\\n([\\s\\S]*?)\\}\\)\\(M_`).exec(js(nom));
      assert.ok(m, `${nom} : ${rel}`); assert.equal(m[2], src, rel); assert.equal(m[1], sha(Buffer.from(src)), rel);
    }
    assert.ok(js(N_F.controler).includes(`// >>> FONCTION fonda/scripts/liaison-generation.js projectionComplete (copie exacte)\n${L.projectionComplete.toString()}\n// <<< FONCTION projectionComplete`));
    assert.ok(js(N_F.controler).includes(`// >>> FONCTION fonda/scripts/signer-cloture.js lotPublie (copie exacte)\n${SC.lotPublie.toString()}\n// <<< FONCTION lotPublie`));
    for (const nom of [N_F.formulaire, N_F.controler]) assert.ok(js(nom).includes(B.COMMUN_PAGE), `${nom} : base commune`);
  });
  test('Respond to Webhook : forme vérifiée ICI (le harnais l\'adapte au simulateur dans sa copie : corps texte, code par expression)', () => {
    const r = JSON.parse(lireExport('confirmer')).nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook');
    assert.equal(r.length, 1);
    assert.deepEqual([r[0].parameters.respondWith, r[0].parameters.responseBody, r[0].parameters.options.responseCode], ['text', '={{ $json.html }}', '={{ $json.code }}']);
  });
});

// ── 3. Faux Drive : requête q INTERPRÉTÉE, champs projetés, pagination par jeton ──
function analyserQ(q) {
  const jetons = []; let i = 0;
  while (i < q.length) {
    const ch = q[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === '\'') {
      let v = ''; i += 1;
      for (; i < q.length && q[i] !== '\''; i += 1) { if (q[i] === '\\') i += 1; v += q[i]; }
      if (q[i] !== '\'') throw new Error(`q : chaîne non terminée (${q})`);
      i += 1; jetons.push({ t: 'chaine', v }); continue;
    }
    if (q.startsWith('!=', i)) { jetons.push({ t: '!=' }); i += 2; continue; }
    if ('(){}='.includes(ch)) { jetons.push({ t: ch }); i += 1; continue; }
    const m = /^[A-Za-z]+/.exec(q.slice(i));
    if (!m) throw new Error(`q : caractère inattendu « ${ch} »`);
    jetons.push({ t: 'mot', v: m[0] }); i += m[0].length;
  }
  let p = 0;
  const voir = () => jetons[p];
  const prendre = (t, v) => { const j = jetons[p]; if (!j || j.t !== t || (v !== undefined && j.v !== v)) throw new Error(`q : « ${v || t} » attendu (${q})`); p += 1; return j; };
  const estMot = (v) => voir() && voir().t === 'mot' && voir().v === v;
  function clause() {
    const j = voir();
    if (j && j.t === 'chaine') { p += 1; prendre('mot', 'in'); prendre('mot', 'parents'); return (f) => f.parents.includes(j.v); }
    if (estMot('not')) { p += 1; const c = facteur(); return (f) => !c(f); }
    if (estMot('name')) {
      p += 1; const op = voir(); p += 1; const v = prendre('chaine').v;
      if (op.t === '=') return (f) => f.name === v;
      if (op.t === '!=') return (f) => f.name !== v;
      // Drive : « contains » sur name = correspondance par PRÉFIXE (modèle prudent : préfixe du nom entier).
      if (op.t === 'mot' && op.v === 'contains') return (f) => f.name.startsWith(v);
      throw new Error(`q : opérateur name non simulé (${q})`);
    }
    if (estMot('trashed')) {
      p += 1; const op = voir(); p += 1; const b = prendre('mot').v;
      if (!['true', 'false'].includes(b) || !['=', '!='].includes(op.t)) throw new Error(`q : trashed non simulé (${q})`);
      return op.t === '=' ? (f) => f.trashed === (b === 'true') : (f) => f.trashed !== (b === 'true');
    }
    if (estMot('properties')) {
      p += 1; prendre('mot', 'has'); prendre('{'); prendre('mot', 'key'); prendre('='); const k = prendre('chaine').v;
      prendre('mot', 'and'); prendre('mot', 'value'); prendre('='); const v = prendre('chaine').v; prendre('}');
      return (f) => Object.prototype.hasOwnProperty.call(f.properties, k) && f.properties[k] === v;
    }
    throw new Error(`q : clause non simulée à la position ${p} (${q})`);
  }
  function facteur() { if (voir() && voir().t === '(') { p += 1; const e = expr(); prendre(')'); return e; } return clause(); }
  function terme() { let g = facteur(); while (estMot('and')) { p += 1; const d = facteur(); const a = g; g = (f) => a(f) && d(f); } return g; }
  function expr() { let g = terme(); while (estMot('or')) { p += 1; const d = terme(); const a = g; g = (f) => a(f) || d(f); } return g; }
  const e = expr();
  if (p !== jetons.length) throw new Error(`q : reste non analysé (${q})`);
  return e;
}
function projeter(fields) {
  const m = /^nextPageToken,incompleteSearch,files\(([a-zA-Z,]+)\)$/.exec(fields || '');
  if (!m) throw new Error(`fields non simulé : ${fields}`);
  return m[1].split(',');
}
// o : { taillePage (Drive peut rendre MOINS que pageSize), incomplet(q, iPage), pagesVides: Set(iPage) }
function fauxDrive(o = {}) {
  const fichiers = new Map(); let n = 0; const sequences = new Map(); let nj = 0;
  const d = {
    fichiers, o, envois: [], appels: [], crochets: {},
    ajouter(dossier, nom, contenu, properties = {}, extra = {}) {
      const id = `drv-${++n}`;
      fichiers.set(id, { id, name: nom, parents: [dossier], mimeType: 'application/json', properties, trashed: false, contenu, modifiedTime: new Date().toISOString(), version: '1', ...extra });
      return id;
    },
    dans: (dossier) => [...fichiers.values()].filter((f) => f.parents.includes(dossier)),
    candidat: (setId) => [...fichiers.values()].find((f) => f.name === `${setId}.candidat.json` && f.parents.includes(RELEC) && !f.trashed),
    lister({ q, fields, pageSize, pageToken }) {
      d.appels.push(q);
      let seq; let iPage;
      if (pageToken) {
        if (!sequences.has(pageToken)) { const e = new Error('Drive : pageToken invalide'); e.statut = 400; throw e; }
        ({ seq, iPage } = sequences.get(pageToken));
      } else {
        const pred = analyserQ(q);
        const tous = [...fichiers.values()].filter((f) => f.mimeType !== 'application/vnd.google-apps.folder' && pred(f));
        const t = Math.min(Number(pageSize) || 100, o.taillePage || Infinity);
        const pages = [];
        for (let k = 0; k < tous.length; k += t) pages.push(tous.slice(k, k + t));
        if (!pages.length) pages.push([]);
        for (const v of [...(o.pagesVides || [])].sort((a, b) => b - a)) if (v < pages.length) pages.splice(v, 0, []);
        seq = { q, pages }; iPage = 0;
      }
      const champs = projeter(fields);
      const omis = o.omettre ? seq.pages[iPage].filter((f) => o.omettre(seq.q, f)) : [];
      const corps = { files: seq.pages[iPage].filter((f) => !omis.includes(f)).map((f) => Object.fromEntries(champs.map((c) => [c, f[c]]))) };
      if (o.incomplet && o.incomplet(seq.q, iPage)) corps.incompleteSearch = true; else corps.incompleteSearch = false;
      if (iPage + 1 < seq.pages.length) { const j = `jeton-${++nj}`; sequences.set(j, { seq, iPage: iPage + 1 }); corps.nextPageToken = j; }
      return corps;
    },
    // fetch pour le VRAI adaptateurs-page.lecturePage (signataire).
    async fetch(url, init) {
      const rep = (statut, corps) => ({ ok: statut < 400, status: statut, json: async () => corps, arrayBuffer: async () => new Uint8Array(Buffer.from(corps, 'utf8')).buffer });
      if (!/^Bearer \S+$/.test((init && init.headers && init.headers.authorization) || '')) return rep(401, {});
      const u = new URL(url);
      if (u.pathname === '/drive/v3/files') {
        try { return rep(200, d.lister({ q: u.searchParams.get('q'), fields: u.searchParams.get('fields'), pageSize: u.searchParams.get('pageSize'), pageToken: u.searchParams.get('pageToken') })); } catch (e) { return rep(e.statut || 500, {}); }
      }
      const id = decodeURIComponent(u.pathname.replace('/drive/v3/files/', ''));
      const f = fichiers.get(id);
      if (!f) return rep(404, {});
      if (u.searchParams.get('alt') === 'media') return rep(200, f.contenu);
      return rep(200, { id: f.id, mimeType: f.mimeType, trashed: f.trashed });
    },
    // Gestionnaires des nœuds HTTP n8n (requête évaluée par le simulateur).
    // Query string RECONSTITUÉE comme n8n : paramètres de requête + paramètres de pagination de type
    // « qs » seulement ; un autre type (body, headers) n'atteint pas la query string d'un GET Drive.
    n8nListe: async (r) => {
      if ((r.method || 'GET') !== 'GET' || r.url !== 'https://www.googleapis.com/drive/v3/files') return { statusCode: 404, body: {} };
      const qs = Object.fromEntries(r.queryParameters.parameters.map((x) => [x.name, x.value]));
      const pg = r.options && r.options.pagination && r.options.pagination.pagination;
      if (r.pagination && Object.keys(r.pagination).length) {
        for (const x of pg.parameters.parameters) {
          if (x.type === 'qs') qs[x.name] = r.pagination[x.name];
          else if (!['body', 'headers'].includes(x.type)) throw new Error(`type de paramètre de pagination non simulé : ${x.type}`);
        }
      }
      let corps;
      try { corps = d.lister(qs); } catch (e) { return { statusCode: e.statut || 500, body: {} }; }
      // Crochet APRÈS le calcul de la page, AVANT la réponse : écriture vraiment concurrente du listing.
      if (d.crochets.apresListe && d.crochets.apresListe.si(qs.q || '')) { const h = d.crochets.apresListe.f; d.crochets.apresListe = null; await h(); }
      return { statusCode: 200, body: corps };
    },
    n8nMeta: async (r) => {
      const f = fichiers.get(r.url.split('/').pop());
      if (d.crochets.avantMeta) { const h = d.crochets.avantMeta; d.crochets.avantMeta = null; await h(); }
      const champs = r.queryParameters.parameters.find((x) => x.name === 'fields').value.split(',');
      return f ? { statusCode: 200, body: Object.fromEntries(champs.map((c) => [c, f[c]])) } : { statusCode: 404, body: {} };
    },
    n8nMedia: async (r) => {
      const f = fichiers.get(r.url.split('/').pop());
      if (!f || !r.queryParameters.parameters.some((x) => x.name === 'alt' && x.value === 'media')) return { statusCode: 404, body: {} };
      return { statusCode: 200, body: JSON.parse(f.contenu) };
    },
    n8nCreer: async (r) => {
      // Crochet AVANT la création (écriture concurrente vraie : une autre exécution s'intercale).
      if (d.crochets.avantCreer) { const h = d.crochets.avantCreer; d.crochets.avantCreer = null; await h(); }
      const parties = r.body.split('\r\n\r\n'); const meta = JSON.parse(parties[1].split('\r\n')[0]); const contenu = parties[2].slice(0, parties[2].lastIndexOf('\r\n--'));
      const id = d.ajouter(meta.parents[0], meta.name, contenu, meta.properties);
      return { statusCode: 200, body: { id, name: meta.name, parents: meta.parents, properties: meta.properties } };
    },
    n8nReecrire: async (r) => {
      const f = fichiers.get(r.url.split('/').pop());
      if (r.method !== 'PATCH' || !f) return { statusCode: 404, body: {} };
      if (d.crochets.avantPatch) { const h = d.crochets.avantPatch; d.crochets.avantPatch = null; await h(); }
      f.contenu = r.body; f.modifiedTime = new Date().toISOString(); f.version = String(BigInt(f.version) + 1n); // int64 monotone (D6)
      const champs = r.queryParameters.parameters.find((x) => x.name === 'fields').value.split(',');
      return { statusCode: 200, body: Object.fromEntries(champs.map((c) => [c, f[c]])) };
    },
  };
  for (const id of [CAND, RELEC, DEC, 'dossier-autre']) fichiers.set(id, { id, name: id, parents: [], mimeType: 'application/vnd.google-apps.folder', properties: {}, trashed: false });
  return d;
}

describe('3. faux Drive : interpréteur de q (une clause = un test)', () => {
  const d = fauxDrive();
  const a = d.ajouter(DEC, 'set_x_nI_01-n1.json', '{}', { fonda_set_id: 'S' });
  const b = d.ajouter(DEC, 'autre.json', '{}', { fonda_set_id: 'S' });
  const c = d.ajouter('dossier-autre', 'set_x_nI_01-n2.json', '{}');
  const t = d.ajouter(DEC, 'set_x_nI_01-n3.json', '{}', {}, { trashed: true });
  const ids = (q) => d.lister({ q, fields: 'nextPageToken,incompleteSearch,files(id)' }).files.map((f) => f.id).sort();
  test('parents', () => { assert.deepEqual(ids(`'dossier-autre' in parents`), [c]); });
  test('name = (exact) et name != ', () => { assert.deepEqual(ids(`name = 'autre.json'`), [b]); assert.deepEqual(ids(`'${DEC}' in parents and name != 'autre.json'`), [a, t].sort()); });
  test('name contains (préfixe)', () => { assert.deepEqual(ids(`name contains 'set_x_nI_01-'`), [a, c, t].sort()); assert.deepEqual(ids(`name contains 'nI_01-n1'`), []); });
  test('properties has (clé ET valeur)', () => { assert.deepEqual(ids(`properties has { key='fonda_set_id' and value='S' }`), [a, b].sort()); assert.deepEqual(ids(`properties has { key='fonda_set_id' and value='T' }`), []); });
  test('trashed = false / true', () => { assert.deepEqual(ids(`'${DEC}' in parents and trashed = false`), [a, b].sort()); assert.deepEqual(ids('trashed = true'), [t]); });
  test('and / or / parenthèses (and prioritaire)', () => {
    assert.deepEqual(ids(`'${DEC}' in parents and (name contains 'set_x_nI_01-' or properties has { key='fonda_set_id' and value='S' })`), [a, b, t].sort());
    assert.deepEqual(ids(`name = 'autre.json' or 'dossier-autre' in parents and trashed = true`), [b]);
  });
  test('clause non simulée -> erreur (jamais un résultat silencieux)', () => {
    assert.throws(() => ids(`modifiedTime > '2026-01-01'`), /non simulée|attendu|inattendu/);
    assert.throws(() => ids(`fullText contains 'x'`), /non simulée/);
  });
  test('pagination : jetons, page vide avec jeton, jeton inconnu -> 400', () => {
    const d2 = fauxDrive({ taillePage: 2, pagesVides: new Set([1]) });
    for (let k = 0; k < 3; k += 1) d2.ajouter(DEC, `f${k}`, '{}');
    const p1 = d2.lister({ q: `'${DEC}' in parents`, fields: 'nextPageToken,incompleteSearch,files(id)' });
    const p2 = d2.lister({ q: 'ignoré', fields: 'nextPageToken,incompleteSearch,files(id)', pageToken: p1.nextPageToken });
    const p3 = d2.lister({ q: 'ignoré', fields: 'nextPageToken,incompleteSearch,files(id)', pageToken: p2.nextPageToken });
    assert.deepEqual([p1.files.length, p2.files.length, p3.files.length, p3.nextPageToken], [2, 0, 1, undefined]);
    assert.ok(p2.nextPageToken);
    assert.throws(() => d2.lister({ q: 'x', fields: 'nextPageToken,incompleteSearch,files(id)', pageToken: 'faux' }), /pageToken/);
  });
  test('champs projetés selon fields (rien de plus)', () => {
    assert.deepEqual(Object.keys(d.lister({ q: `name = 'autre.json'`, fields: 'nextPageToken,incompleteSearch,files(id,name)' }).files[0]), ['id', 'name']);
  });
});

// ── Monde : GitHub au commit, Data Table, Gmail ; décisions et confirmations au contrat ──
const SET = 'set_fonda_comprendre-consigne_nI_92';
const AUTRE = 'set_fonda_comprendre-consigne_nI_93';
const COMMIT = 'c0ffee'.padEnd(40, '0');
const K = 'ab'.repeat(32); const K2 = 'cd'.repeat(32);
const OCT_REF = fs.readFileSync(path.join(RACINE, 'fonda/data/referentiel.json'));
const OCT_MOT = fs.readFileSync(path.join(RACINE, 'fonda/engine/moteurs.json'));
const REF_VERSION = `sha256:${sha(OCT_REF)}`;
const REGISTRE = JSON.parse(OCT_MOT.toString('utf8'));
const MOTEUR = { version: REGISTRE[REGISTRE.length - 1].version, sha256: REGISTRE[REGISTRE.length - 1].sha256 };
const journal = (lignesEnPlus) => {
  const j = JSON.parse(fs.readFileSync(path.join(RACINE, 'fonda/data/set_ids-journal.json'), 'utf8'));
  j.lignes.push(...lignesEnPlus);
  return Buffer.from(`${JSON.stringify(j, null, 2)}\n`, 'utf8');
};
const reserve = (s) => ({ set_id: s, transition: 'reserve', le: '2026-11-08', ref: `test:${s}` });
const OCT_JOURNAL = journal([reserve(SET), reserve(AUTRE)]);
const lotSource = (setId) => {
  const l = JSON.parse(fs.readFileSync(path.join(RACINE, 'fonda/data/lots/set_fonda_comprendre-consigne_nI_01.json'), 'utf8'));
  l.set_id = setId; l.revue_carte_par_carte = false; l.cartes.forEach((c) => { c.set_id = setId; });
  return l;
};
const RELECTEUR = JSON.parse(OCT_REF.toString('utf8')).notions.find((n) => n.id === lotSource(SET).notion_id).relecteur;
const contents = (chemin, octets) => ({ type: 'file', encoding: 'base64', path: chemin, size: octets.length, sha: 'blob', content: octets.toString('base64').replace(/(.{60})/g, '$1\n') + '\n' });
const avecK = (wf, k) => { const w = copie(wf); const i = w.nodes.findIndex((x) => x.name === N_E.cle); w.nodes[i] = { ...w.nodes[i], type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: `return [{ json: { k: ${JSON.stringify(k)} } }];` } }; return w; };

function mondeAvecLot(o = {}, sets = [SET]) {
  const d = fauxDrive(o);
  for (const s of sets) d.ajouter(CAND, `${s}.lot.json`, `${JSON.stringify(lotSource(s), null, 2)}\n`);
  return d;
}
async function emettre(d, { setId = SET, k = K, reponses = {}, octJournal = OCT_JOURNAL, corps } = {}) {
  return executerGraphe(avecK(JSON.parse(lireExport('emettre')), k), {
    corps: corps || { set_id: setId, journal_commit: COMMIT, referentiel_version: REF_VERSION, moteur: MOTEUR },
    reponses: {
      [N_E.referentiel]: async (r) => { assert.match(r.url, new RegExp(`ref=${COMMIT}$`)); return { statusCode: 200, body: contents('fonda/data/referentiel.json', OCT_REF) }; },
      [N_E.moteurs]: async () => ({ statusCode: 200, body: contents('fonda/engine/moteurs.json', OCT_MOT) }),
      [N_E.journal]: async (r) => { assert.match(r.url, new RegExp(`set_ids-journal\\.json\\?ref=${COMMIT}$`)); return { statusCode: 200, body: contents('fonda/data/set_ids-journal.json', octJournal) }; },
      [N_E.chercherLot]: d.n8nListe, [N_E.lireLot]: d.n8nMedia, [N_E.existant]: d.n8nListe, [N_E.decisions]: d.n8nListe,
      [N_E.lireExistant]: d.n8nMedia, [N_E.relireVersion]: d.n8nMeta, [N_E.ecrire]: d.n8nCreer, [N_E.reecrire]: d.n8nReecrire, [N_E.relister]: d.n8nListe,
      [N_E.adresse]: async () => ({ statusCode: 200, body: { data: [{ relecteur_attribue: RELECTEUR, adresse: 'relectrice@exemple.invalid' }, { relecteur_attribue: 'eric', adresse: 'relecteur@exemple.invalid' }] } }),
      [N_E.envoyer]: async (r) => { d.envois.push(Buffer.from(JSON.parse(r.jsonBody).raw, 'base64url').toString('utf8')); return { statusCode: 200, body: { id: `msg-${d.envois.length}` } }; },
      ...reponses,
    },
  });
}

let nExec = 0;
const execution = (workflowId, debut, fin, statut, runData) => {
  const obs = { id: String(800 + (++nExec)), workflowId, status: statut, startedAt: debut, stoppedAt: fin };
  return { obs, detail: { ...obs, mode: 'webhook', workflowData: { pinData: null }, data: { resultData: { runData } } } };
};
// ── Confirmer (P2) : le VRAI workflow, formulaire POSTÉ construit comme la Page (jeton HMAC de la base commune) ──
const SECRET = 'secret-de-test-de-la-page-fonda-non-hexadecimal';
const nonceAleatoire = () => crypto.randomBytes(16).toString('hex');
const encoder = (o) => new URLSearchParams(Object.entries(o).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, String(v)]]))).toString();
// Copie de test : Respond to Webhook adapté au simulateur (corps texte -> JSON.stringify ; forme vérifiée en 2.).
const simulable = (wf) => { const w = copie(wf); for (const n of w.nodes) if (n.type === 'n8n-nodes-base.respondToWebhook') n.parameters.responseBody = '={{ JSON.stringify($json.html) }}'; return w; };
async function formulaire(d, setId, { k = K, generation, nonce = nonceAleatoire(), ecarter = [], action = 'accepter', expirePage, empreinte, moteur, secret = SECRET } = {}) {
  const cand = candidatDe(d, setId); const rel = cand.relecture;
  const gen = generation === undefined ? rel.generation_cle : generation;
  const emp = empreinte || await Cat.calculerEmpreinte(cand.lot, SHA);
  const mot = moteur || rel.moteur;
  const exp = expirePage || new Date(Math.min(Date.now() + 3600000, Date.parse(rel.expire_le))).toISOString();
  const f = { lot: setId, k, generation: String(gen), empreinte: emp, moteur_version: mot.version, moteur_sha256: mot.sha256, expire_page: exp, nonce };
  f.jeton = COMMUN.jetonPage(secret, { set_id: setId, generation_cle: gen, cle_sha256: sha(Buffer.from(k, 'utf8')), empreinte: emp, moteur_version: mot.version, moteur_sha256: mot.sha256, expire_page: exp, nonce });
  f.action = action;
  if (action === 'accepter') for (const c of cand.lot.cartes) f[`choix_${c.item_id}`] = ecarter.includes(c.item_id) ? 'ecarter' : 'garder';
  else f.confirmer_rejet = 'oui';
  return f;
}
async function poster(d, corps, o = {}) {
  const debut = new Date().toISOString();
  const entetes = o.entetes || { 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(Buffer.byteLength(corps && typeof corps === 'object' && !Array.isArray(corps) ? encoder(corps) : '')) };
  const r = await executerGraphe(simulable(JSON.parse(lireExport('confirmer'))), {
    corps, entetes, contexteCode: { $env: { FONDA_PAGE_HMAC: o.secret === undefined ? SECRET : o.secret } },
    reponses: {
      [N_F.chercher]: d.n8nListe, [N_F.lire]: d.n8nMedia, [N_F.chercherDecision]: d.n8nListe, [N_F.lireDecision]: d.n8nMedia, [N_F.relire]: d.n8nMedia, [N_F.ecrire]: d.n8nCreer,
      ...(o.reponses || {}),
    },
  });
  await pause();
  const fin = new Date().toISOString();
  await pause();
  const sortie = r.runData[N_F.sortie] ? r.sorties[N_F.sortie][0].json : null;
  let http = null;
  if (r.reponseWebhook) {
    http = r.reponseWebhook.noeud === N_F.repondre
      ? { code: evaluerExpression(r.reponseWebhook.code, { $: null, $json: r.sorties[N_F.reponse][0].json }), corps: r.reponseWebhook.corps }
      : { code: r.reponseWebhook.code, corps: r.reponseWebhook.corps };
  }
  const id = sortie && sortie.type === 'decision' ? sortie.decision_fichier_id : null;
  const dec = id && d.fichiers.get(id) ? JSON.parse(d.fichiers.get(id).contenu) : null;
  return { r, sortie, http, id, dec, ...execution('wfConf', debut, fin, r.status === 'success' ? 'success' : 'error', r.runData) };
}
// Confirmation par le VRAI Confirmer (même signature qu'en P3, k de la génération confirmée).
async function confirmer(d, setId, generation, o = {}) {
  return poster(d, await formulaire(d, setId, { ...o, generation }), o);
}
// Course VRAIE : le Confirmer passe C1–C5bis puis est RETENU juste avant son écriture (crochet avantCreer) ;
// `atteinte` se résout à ce point, `liberer()` laisse l'écriture se faire, `resultat` = la confirmation.
async function confirmationRetenue(d, setId, generation, o = {}) {
  let liberer; const barriere = new Promise((r) => { liberer = r; });
  let signaler; const atteinte = new Promise((r) => { signaler = r; });
  d.crochets.avantCreer = async () => { signaler(); await barriere; };
  const resultat = confirmer(d, setId, generation, o);
  await atteinte;
  return { liberer, resultat };
}
async function cloturer(d, corps, o = {}) {
  const debut = new Date().toISOString();
  const r = await executerGraphe(JSON.parse(lireExport('cloturer')), {
    corps,
    reponses: { [N_C.chercher]: d.n8nListe, [N_C.lire]: d.n8nMedia, [N_C.relireVersion]: d.n8nMeta, [N_C.ecrire]: d.n8nReecrire, [N_C.relire]: d.n8nMedia, [N_C.decisions]: d.n8nListe, ...(o.reponses || {}) },
  });
  await pause();
  const fin = o.stoppedAt || new Date().toISOString();
  await pause();
  return { r, ...execution('wfClot', debut, fin, r.status === 'success' ? 'success' : 'error', r.runData) };
}
// Confirmation SIMULÉE AU CONTRAT, réservée aux CONTRE-ÉPREUVES de réconciliation (4 bis) : une décision
// FAUSSE mais cohérente (fichier + exécution), qu'un vrai Confirmer ne produit pas, doit être abandonnée par
// le signataire (pilier 1). hash_formulaire : MÊME définition que Confirmer (base commune, P2).
async function decisionPage(setId, generation, nonce, { ecarter = [], candidat }) {
  const lot = lotSource(setId);
  const choix = lot.cartes.map((c) => [c.item_id, ecarter.includes(c.item_id) ? 'ecarter' : 'garder']);
  const selection = choix.filter((x) => x[1] === 'garder').map((x) => x[0]);
  const ecartees = choix.filter((x) => x[1] === 'ecarter').map((x) => x[0]);
  const empreinte = await Cat.calculerEmpreinte(lot, SHA);
  const rel = candidat.relecture;
  const expirePage = new Date(Math.min(Date.now() + 3600000, Date.parse(rel.expire_le))).toISOString();
  const hash = COMMUN.hashFormulaire({ lot: setId, generation, empreinte, moteur_version: rel.moteur.version, moteur_sha256: rel.moteur.sha256, expire_page: expirePage, nonce, action: 'accepter', choix });
  return { schema: 'decision-fonda/v1', set_id: setId, generation, nonce, recu_le: new Date().toISOString(),
    coeur: { action: 'accepter', selection, ecartees, empreinte_relue: empreinte, empreinte_publiee: await Cat.calculerEmpreinte(SC.lotPublie(lot, { selection }), SHA), moteur: rel.moteur },
    lot_relu: { set_id: setId, empreinte_complete: L.empreinteComplete(lot), cartes: choix.map(([item_id, c]) => ({ item_id, choix: c })) }, hash_formulaire: hash };
}
async function confirmerSimule(d, setId, generation, { nonce = nonceAleatoire(), muter, ecarter } = {}) {
  const dec = await decisionPage(setId, generation, nonce, { ecarter, candidat: candidatDe(d, setId) });
  if (muter) muter(dec);
  const debut = new Date().toISOString();
  const id = d.ajouter(DEC, `${setId}-${nonce}.json`, JSON.stringify(dec), { fonda_set_id: setId, fonda_nonce: nonce });
  const runData = copie(FC.decision_creee.data.resultData.runData);
  runData['FONDA Entree confirmation'][0].data.main[0][0].json = { lot: setId, nonce };
  runData['FONDA Ecrire decision'][0].data.main[0][0].json = { id };
  Object.assign(runData['FONDA Sortie confirmation'][0].data.main[0][0].json, { set_id: setId, nonce, generation, decision_fichier_id: id, decision_sha256: P.empreinteDecision(dec), ecriture: 'creee' });
  return { id, dec, ...execution('wfConf', debut, new Date().toISOString(), 'success', runData) };
}
const preuvesDe = async (setId) => {
  const lot = lotSource(setId); const c = L.empreinteComplete(lot);
  return { sortie: { empreinte_complete: c, referentiel_version: REF_VERSION, moteur: MOTEUR }, relecteur: RELECTEUR, empreintes: { complete: c, pedagogique: await Cat.calculerEmpreinte(lot, SHA) } };
};
// Le VRAI signataire : lecturePage (même Drive), preLireDetails, rattacherPage, evaluerPage.
async function evaluer(d, setId, clotures, confirmations = [], { preuves: pr, levees = [] } = {}) {
  const preuves = pr || await preuvesDe(setId);
  const lp = A.lecturePage({ jeton: async () => 'jeton-test', fetch: d.fetch, dossierRelecture: RELEC, dossierDecisions: DEC });
  const details = new Map([...clotures, ...confirmations].map((x) => [x.obs.id, x.detail]));
  const groupeC = { ok: true, v: clotures.map((x) => x.obs) }; const groupeF = { ok: true, v: confirmations.map((x) => x.obs) };
  await A.preLireDetails({ api: { lireExecution: async (id) => copie(details.get(id)) }, lire: async (_q, f) => { try { return { ok: true, v: await f() }; } catch { return { ok: false }; } }, clotures: groupeC, confirmations: groupeF });
  const env = await lp.lireCandidat(setId);
  const listingDebut = new Date().toISOString();
  const liste = await lp.listerDecisions(setId);
  const constats = new L.Constats();
  const r = P.evaluerPage({ setId, candidatEnv: { ok: true, v: env }, clotures: groupeC, confirmations: groupeF, listeDecisions: { ok: true, v: liste },
    rattachement: P.rattacherPage, levees, constats, ...preuves, listingDebut, registre: REGISTRE });
  // §20.5 : réconciliation RÉELLE de chaque décision retenue, puis unicité (comme signer-cloture.js).
  if (r.decisions.length) {
    const lotLu = JSON.parse(d.dans(CAND).find((f) => f.name === `${setId}.lot.json`).contenu);
    for (const e of L.unicite(r.decisions)) constats.ajouter('abandon', `unicité (§10 A) : ${e}`);
    const empreintePubliee = async (gardees) => Cat.calculerEmpreinte(SC.lotPublie(lotLu, { selection: gardees }), SHA);
    for (const x of r.decisions) for (const e of await L.reconcilier(x, { setId, lotSource: lotLu, empreintes: preuves.empreintes, empreintePubliee })) constats.ajouter('abandon', `réconciliation : ${e}`);
  }
  return { r, constats: constats.liste, env, liste };
}
const issues = (k, issue) => k.constats.filter((c) => c.issue === issue);
const texte = (k) => JSON.stringify(k.constats);
const aIssue = (k, issue, motif) => assert.ok(k.constats.some((c) => c.issue === issue && motif.test(c.raison)), `${issue} ${motif} absent de ${texte(k)}`);
const sortieDe = (r, nom) => r.sorties[nom][0].json;
const candidatDe = (d, s = SET) => JSON.parse(d.candidat(s).contenu);

async function lotEmis(o) {
  const d = mondeAvecLot(o);
  const e = await emettre(d);
  assert.equal(e.status, 'success', e.erreur);
  return { d, e };
}
// Nœuds autorisés à porter k (données d'exécution d'Emettre, §21.5) ; partout ailleurs : absente.
const AVEC_K = new Set([N_E.cle, N_E.preparer, N_E.siReecrire]);
function kConfinee(r, k) {
  const porteurs = Object.entries(r.runData).filter(([, v]) => JSON.stringify(v).includes(k)).map(([n]) => n);
  assert.deepEqual(porteurs.filter((n) => !AVEC_K.has(n)), [], `k hors des nœuds autorisés : ${porteurs}`);
}

describe('4. chaîne RÉELLE Emettre -> confirmation -> Cloturer -> signataire (même Drive), vraies preuves', () => {
  test('Emettre : candidat-fonda/v1 conforme, SEUL cle_sha256 stocké, envois = 1 tentative ; sortie FINALE de forme exacte, sans k', async () => {
    const { d, e } = await lotEmis();
    const f = d.candidat(SET); const c = JSON.parse(f.contenu);
    assert.deepEqual(Object.keys(c), ['schema', 'lot', 'relecture']);
    assert.deepEqual(Object.keys(c.relecture).sort(), ['clos_le', 'cle_sha256', 'cree_le', 'envois', 'expire_le', 'generation_cle', 'moteur', 'referentiel_version', 'relecteur_attribue', 'statut'].sort());
    assert.deepEqual([c.relecture.statut, c.relecture.clos_le, c.relecture.generation_cle, c.relecture.relecteur_attribue], ['en_attente', null, 1, RELECTEUR]);
    assert.equal(c.relecture.cle_sha256, sha(Buffer.from(K, 'utf8')));
    assert.equal(Date.parse(c.relecture.expire_le) - Date.parse(c.relecture.cree_le), 14 * 86400000);
    assert.deepEqual(c.relecture.envois, [{ generation_cle: 1, envoye_a: RELECTEUR, le: c.relecture.cree_le }]);
    assert.deepEqual(c.relecture.moteur, MOTEUR); assert.equal(c.relecture.referentiel_version, REF_VERSION);
    assert.deepEqual(c.lot, lotSource(SET)); assert.deepEqual(f.properties, { fonda_set_id: SET });
    assert.ok(!f.contenu.includes(K), 'k jamais stockée');
    const s = sortieDe(e, N_E.sortie);
    assert.deepEqual(s, { schema: 'emission-fonda/v1', set_id: SET, candidat_fichier_id: f.id, relecteur_attribue: RELECTEUR, generation_cle: 1, reemission: false });
    assert.ok(!JSON.stringify(e.sorties[N_E.sortie]).includes(K), 'k absente de la sortie FINALE');
    kConfinee(e, K);
    assert.equal(d.envois.length, 1); assert.match(d.envois[0], new RegExp(`\\?lot=${SET}&k=${K}\\r\\n`));
  });
  test('NOMINAL complet : décision + confirmation + clôture -> aucun constat, décision retenue, diagnostic égal', async () => {
    const { d } = await lotEmis();
    const cf = await confirmer(d, SET, 1); await pause();
    const c1 = await cloturer(d, { set_id: SET });
    assert.equal(c1.r.status, 'success', c1.r.erreur);
    const s = sortieDe(c1.r, N_C.sortie);
    assert.ok(P.ROLES.cloture.formeSortie && Object.keys(s).sort().join() === Object.keys(P.ROLES.cloture.formeSortie).sort().join(), 'forme exacte cloture-fonda/v1');
    assert.deepEqual([s.deja_clos, s.nb_decisions_listees, s.incomplete_search, s.candidat_fichier_id], [false, 1, false, d.candidat(SET).id]);
    const k = await evaluer(d, SET, [c1], [cf]);
    assert.deepEqual(k.constats, []);
    assert.equal(k.r.derniere.id, c1.obs.id); assert.equal(k.r.decisions.length, 1);
    assert.deepEqual(k.r.diagnostic, { nb_decisions_listees: 1, decompte_signataire: 1 });
    assert.equal(k.env.drive.id, s.candidat_fichier_id); assert.equal(k.env.relecture.clos_le, s.clos_le);
  });
  test('VERROU E12 (contre-épreuve) : candidat SUBSTITUÉ sur Drive (même contenu, autre identifiant) -> abandon', async () => {
    const { d } = await lotEmis();
    const c1 = await cloturer(d, { set_id: SET });
    const f = d.candidat(SET); f.trashed = true;
    d.ajouter(RELEC, f.name, f.contenu, f.properties);
    aIssue(await evaluer(d, SET, [c1]), 'abandon', /candidat_fichier_id ≠ identité Drive/);
  });
  test('VERROU E12 (contre-épreuve) : clos_le du candidat modifié sur Drive après clôture -> abandon', async () => {
    const { d } = await lotEmis();
    const c1 = await cloturer(d, { set_id: SET });
    const f = d.candidat(SET); const c = JSON.parse(f.contenu); c.relecture.clos_le = '2026-01-01T00:00:00.000Z'; f.contenu = JSON.stringify(c);
    aIssue(await evaluer(d, SET, [c1]), 'abandon', /clos_le ≠ relecture\.clos_le/);
  });
  for (const [nom, muter, motif] of [
    ['empreinte complète de la génération ≠ lot du candidat', (p) => { p.empreintes.complete = `sha256:${'0'.repeat(64)}`; }, /lot de l'enveloppe de relecture ≠ lot généré/],
    ['referentiel_version de la génération ≠ candidat', (p) => { p.sortie.referentiel_version = `sha256:${'1'.repeat(64)}`; }, /referentiel_version du candidat ≠ génération/],
    ['moteur de la génération ≠ candidat', (p) => { p.sortie.moteur = { version: MOTEUR.version, sha256: '2'.repeat(64) }; }, /moteur du candidat ≠ moteur de la génération/],
    ['relecteur du référentiel archivé ≠ candidat', (p) => { p.relecteur = 'autre-relecteur'; }, /relecteur attribué du candidat ≠ référentiel archivé/],
  ]) {
    test(`vraies preuves (contre-épreuve) : ${nom} -> abandon`, async () => {
      const { d } = await lotEmis();
      const cf = await confirmer(d, SET, 1); await pause();
      const c1 = await cloturer(d, { set_id: SET });
      const p = await preuvesDe(SET); muter(p);
      const k = await evaluer(d, SET, [c1], [cf], { preuves: p });
      assert.ok(issues(k, 'abandon').some((c) => motif.test(c.raison)), texte(k));
    });
  }
});

describe('4 bis. réconciliation RÉELLE (§20.5) au bout de la chaîne : la décision §21.1 survit, les fausses non', () => {
  test('cartes écartées : selection / ecartees dans l\'ordre du candidat, empreinte publiée du lot FILTRÉ -> aucun constat', async () => {
    const { d } = await lotEmis();
    const ecarter = [lotSource(SET).cartes[1].item_id];
    const cf = await confirmer(d, SET, 1, { ecarter }); await pause();
    const c = await cloturer(d, { set_id: SET });
    const k = await evaluer(d, SET, [c], [cf]);
    assert.deepEqual(k.constats, []); assert.deepEqual(cf.dec.coeur.ecartees, ecarter);
  });
  test('D4 : deux décisions CONFORMES, sélections différentes, chacune confirmée -> abandon pour UNICITÉ seule (L.unicite)', async () => {
    const { d } = await lotEmis();
    const cf1 = await confirmer(d, SET, 1); const cf2 = await confirmer(d, SET, 1, { ecarter: [lotSource(SET).cartes[1].item_id] }); await pause();
    const c = await cloturer(d, { set_id: SET });
    const k = await evaluer(d, SET, [c], [cf1, cf2]);
    assert.equal(k.r.decisions.length, 2);
    assert.deepEqual(k.constats, [{ issue: 'abandon', raison: 'unicité (§10 A) : 2 cœurs distincts' }, { issue: 'abandon', raison: 'unicité (§10 A) : 2 lot_relu distincts' }]);
  });
  for (const [nom, muter, motif] of [
    ['empreinte_relue = empreinte COMPLÈTE (au lieu de pédagogique)', (x) => { x.coeur.empreinte_relue = x.lot_relu.empreinte_complete; }, /empreinte_relue ≠ empreinte pédagogique/],
    ['empreinte_publiee ≠ lot filtré', (x) => { x.coeur.empreinte_publiee = x.coeur.empreinte_relue; x.coeur.selection.pop(); x.coeur.ecartees.push(x.lot_relu.cartes[x.lot_relu.cartes.length - 1].item_id); x.lot_relu.cartes[x.lot_relu.cartes.length - 1].choix = 'ecarter'; }, /empreinte_publiee ≠ empreinte du lot filtré/],
    ['selection dans un AUTRE ordre que le candidat', (x) => { x.coeur.selection.reverse(); }, /selection ≠ cartes « garder »/],
    ['lot_relu.empreinte_complete ≠ lot source', (x) => { x.lot_relu.empreinte_complete = `sha256:${'4'.repeat(64)}`; }, /lot_relu\.empreinte_complete ≠/],
  ]) {
    test(`contre-épreuve : ${nom} -> abandon de réconciliation`, async () => {
      const { d } = await lotEmis();
      const cf = await confirmerSimule(d, SET, 1, { muter }); await pause();
      const c = await cloturer(d, { set_id: SET });
      aIssue(await evaluer(d, SET, [c], [cf]), 'abandon', motif);
    });
  }
});

describe('5. Cloturer sur le faux Drive (finding 1) : chaque clause traversée par le workflow', () => {
  test('propriété seule : décision renommée portant fonda_set_id -> comptée', async () => {
    const { d } = await lotEmis();
    d.ajouter(DEC, 'renomme.json', '{}', { fonda_set_id: SET });
    d.ajouter(DEC, 'autre-lot.json', '{}', { fonda_set_id: AUTRE });
    const c = await cloturer(d, { set_id: SET });
    assert.equal(sortieDe(c.r, N_C.sortie).nb_decisions_listees, 1);
  });
  test('corbeille : décision à la corbeille COMPTÉE ; candidat à la corbeille NON trouvé (clôture en erreur)', async () => {
    const { d } = await lotEmis();
    d.ajouter(DEC, `${SET}-${'b'.repeat(32)}.json`, '{}', {}, { trashed: true });
    assert.equal(sortieDe((await cloturer(d, { set_id: SET })).r, N_C.sortie).nb_decisions_listees, 1);
    const d2 = (await lotEmis()).d; d2.candidat(SET).trashed = true;
    const c2 = await cloturer(d2, { set_id: SET });
    assert.equal(c2.r.status, 'error'); assert.match(c2.r.erreur, /0 fichier\(s\) pour du candidat/);
  });
  test('mauvais dossier : décision et candidat hors dossier -> ignorés', async () => {
    const { d } = await lotEmis();
    d.ajouter('dossier-autre', `${SET}-${'c'.repeat(32)}.json`, '{}', { fonda_set_id: SET });
    assert.equal(sortieDe((await cloturer(d, { set_id: SET })).r, N_C.sortie).nb_decisions_listees, 0);
    const d2 = (await lotEmis()).d; d2.candidat(SET).parents = ['dossier-autre'];
    assert.match((await cloturer(d2, { set_id: SET })).r.erreur, /0 fichier\(s\) pour du candidat/);
  });
  test('name = exact : un « .candidat.json.bak » voisin n\'est pas pris pour le candidat', async () => {
    const { d } = await lotEmis();
    d.ajouter(RELEC, `${SET}.candidat.json.bak`, d.candidat(SET).contenu);
    const c = await cloturer(d, { set_id: SET });
    assert.equal(c.r.status, 'success', c.r.erreur); assert.equal(sortieDe(c.r, N_C.sortie).candidat_fichier_id, d.candidat(SET).id);
  });
  test('plusieurs pages : 5 décisions, pages de 2 -> 3 pages lues, 5 comptées, complet', async () => {
    const { d } = await lotEmis({ taillePage: 2 });
    for (let i = 0; i < 5; i += 1) d.ajouter(DEC, `${SET}-${String(i).repeat(32)}.json`, '{}');
    const c = await cloturer(d, { set_id: SET });
    assert.equal(c.r.sorties[N_C.decisions].length, 3);
    assert.deepEqual([sortieDe(c.r, N_C.sortie).nb_decisions_listees, sortieDe(c.r, N_C.sortie).incomplete_search], [5, false]);
  });
  test('page VIDE portant un jeton : la pagination continue, rien de perdu', async () => {
    const { d } = await lotEmis({ taillePage: 2, pagesVides: new Set([1]) });
    for (let i = 0; i < 3; i += 1) d.ajouter(DEC, `${SET}-${String(i).repeat(32)}.json`, '{}');
    const s = sortieDe((await cloturer(d, { set_id: SET })).r, N_C.sortie);
    assert.deepEqual([s.nb_decisions_listees, s.incomplete_search], [3, false]);
  });
  test('incompleteSearch sur une page INTERMÉDIAIRE -> incomplete_search', async () => {
    const { d } = await lotEmis({ taillePage: 1, incomplet: (q, i) => q.includes(`'${DEC}'`) && i === 1 });
    for (let i = 0; i < 3; i += 1) d.ajouter(DEC, `${SET}-${String(i).repeat(32)}.json`, '{}');
    const s = sortieDe((await cloturer(d, { set_id: SET })).r, N_C.sortie);
    assert.deepEqual([s.nb_decisions_listees, s.incomplete_search], [3, true]);
  });
  test(`plafond : ${B.CONFIG.maxPagesDrive} pages exactes -> complet ; une de plus -> ERREUR d'exécution (aucune sortie) -> abandon au signataire ; incomplete_search = OU Drive seul`, async () => {
    const { d } = await lotEmis({ taillePage: 1 });
    for (let i = 0; i < B.CONFIG.maxPagesDrive; i += 1) d.ajouter(DEC, `${SET}-${String(i).padStart(32, '0')}.json`, '{}');
    const s = sortieDe((await cloturer(d, { set_id: SET })).r, N_C.sortie);
    assert.deepEqual([s.nb_decisions_listees, s.incomplete_search], [B.CONFIG.maxPagesDrive, false]);
    d.ajouter(DEC, `${SET}-${'f'.repeat(32)}.json`, '{}');
    const c = await cloturer(d, { set_id: SET });
    assert.equal(c.r.status, 'error'); assert.match(c.r.erreur, /plafond/); assert.equal(c.r.runData[N_C.sortie], undefined);
    assert.equal(P.rattacherPage(c.detail, { role: 'cloture', workflowId: 'wfClot', observation: c.obs }).nature, 'erreur');
    assert.ok(issues(await evaluer(d, SET, [c]), 'abandon').some((x) => /blocage dur/.test(x.raison)));
  });
});

describe('6. cas clôture du §21.10, par la chaîne réelle', () => {
  test('D6 : version Drive au-delà de 2^53 -> incrément EXACT (BigInt) dans le faux Drive ET dans le contrôle après écriture de Cloturer', async () => {
    const { d } = await lotEmis();
    d.candidat(SET).version = '9007199254740993';
    const c = await cloturer(d, { set_id: SET });
    assert.equal(c.r.status, 'success', c.r.erreur);
    assert.equal(d.candidat(SET).version, '9007199254740994');
  });
  test('clôture répétée : deja_clos, clos_le INCHANGÉ, nœud d\'écriture NON exécuté ; deux clôtures cohérentes acceptées', async () => {
    const { d } = await lotEmis();
    const cf = await confirmer(d, SET, 1); await pause();
    const c1 = await cloturer(d, { set_id: SET });
    const c2 = await cloturer(d, { set_id: SET });
    assert.equal(sortieDe(c2.r, N_C.sortie).deja_clos, true);
    assert.equal(sortieDe(c2.r, N_C.sortie).clos_le, sortieDe(c1.r, N_C.sortie).clos_le);
    assert.ok(!c2.r.runData[N_C.ecrire], 'aucune réécriture');
    const k = await evaluer(d, SET, [c1, c2], [cf]);
    assert.equal(k.r.derniere.id, c2.obs.id); assert.deepEqual(k.constats, []);
  });
  test('clôture d\'un AUTRE lot (cohérente) : rattachée à cet autre lot, sans effet sur le lot examiné', async () => {
    const d = mondeAvecLot({}, [SET, AUTRE]);
    assert.equal((await emettre(d)).status, 'success'); assert.equal((await emettre(d, { setId: AUTRE })).status, 'success');
    const cf = await confirmer(d, SET, 1); await pause();
    const c1 = await cloturer(d, { set_id: SET }); const cA = await cloturer(d, { set_id: AUTRE });
    assert.equal(P.rattacherPage(cA.detail, { role: 'cloture', workflowId: 'wfClot', observation: cA.obs }).set_id, AUTRE);
    const k = await evaluer(d, SET, [c1, cA], [cf]);
    assert.equal(k.r.derniere.id, c1.obs.id); assert.deepEqual(k.constats, []);
  });
  test('exécution en ERREUR, entrée lisible (Drive en panne) -> erreur attribuée au lot -> abandon', async () => {
    const { d } = await lotEmis();
    const c = await cloturer(d, { set_id: SET }, { reponses: { [N_C.chercher]: async () => { throw new Error('Drive injoignable'); } } });
    assert.equal(c.r.status, 'error');
    assert.equal(P.rattacherPage(c.detail, { role: 'cloture', workflowId: 'wfClot', observation: c.obs }).nature, 'erreur');
    aIssue(await evaluer(d, SET, [c]), 'abandon', /blocage dur/);
  });
  test('exécution en ERREUR, entrée illisible (set_id absent) -> incident de chaîne', async () => {
    const { d } = await lotEmis();
    const c = await cloturer(d, { autre: 1 });
    assert.equal(c.r.status, 'error');
    assert.ok(issues(await evaluer(d, SET, [c]), 'incident').length >= 1);
  });
  test('deux clôtures du lot à la MÊME date -> abandon (aucun départage arbitraire)', async () => {
    const { d } = await lotEmis();
    const t = new Date(Date.now() + 1000).toISOString();
    const c1 = await cloturer(d, { set_id: SET }, { stoppedAt: t }); const c2 = await cloturer(d, { set_id: SET }, { stoppedAt: t });
    aIssue(await evaluer(d, SET, [c1, c2]), 'abandon', /même date/);
  });
  test('listing INCOMPLET sur le MÊME Drive (producteur ET signataire) : refus temporaires §10 C et decisions/, jamais d\'abandon ; diagnostic égal', async () => {
    const { d } = await lotEmis();
    const cf = await confirmer(d, SET, 1); await pause();
    d.o.incomplet = (q) => q.includes(`'${DEC}'`); // Drive déclare la recherche incomplète APRÈS l'émission
    const c = await cloturer(d, { set_id: SET });
    const s = sortieDe(c.r, N_C.sortie);
    assert.deepEqual([s.incomplete_search, s.nb_decisions_listees], [true, 1]);
    const k = await evaluer(d, SET, [c], [cf]);
    assert.equal(k.liste.incompleteSearch, true, 'le signataire voit la même recherche incomplète');
    assert.deepEqual(issues(k, 'abandon'), [], texte(k)); assert.deepEqual(issues(k, 'incident'), [], texte(k));
    assert.deepEqual(issues(k, 'temporaire').map((x) => x.raison).sort(), ['clôture technique : recherche Drive incomplète sans levée explicite (§10 C)', 'recherche Drive incomplète (decisions/) sans levée explicite'].sort());
    assert.deepEqual(k.r.diagnostic, { nb_decisions_listees: 1, decompte_signataire: 1 });
  });
  test('décision ÉCRITE APRÈS la clôture (Confirmer passé par C5bis AVANT, écriture retenue) : vue par le signataire, non comptée par le producteur -> temporaire (nouvelle clôture), jamais d\'abandon', async () => {
    const { d } = await lotEmis();
    const enVol = await confirmationRetenue(d, SET, 1);
    const c = await cloturer(d, { set_id: SET }); await pause();
    enVol.liberer(); const cf = await enVol.resultat;
    assert.equal(cf.sortie.ecriture, 'creee', 'C5bis passé avant la clôture : l\'écriture a lieu');
    const k = await evaluer(d, SET, [c], [cf]);
    assert.deepEqual(issues(k, 'abandon'), [], texte(k));
    assert.ok(issues(k, 'temporaire').some((x) => /écrit après la clôture technique/.test(x.raison)), texte(k));
    assert.deepEqual(k.r.diagnostic, { nb_decisions_listees: 0, decompte_signataire: 1 });
  });
  test('listing de clôture incomplet OMETTANT une décision (compteur inférieur) ; signataire complet -> refus temporaire §10 C seul, diagnostic divergent', async () => {
    const { d } = await lotEmis();
    const cf1 = await confirmer(d, SET, 1); const cf2 = await confirmer(d, SET, 1); // resoumission : même cœur, autre nonce
    // Le Drive omet cf2 de la recherche du PRODUCTEUR (requête par nom/propriété) et la déclare incomplète.
    d.o.incomplet = (q) => q.includes('fonda_set_id'); d.o.omettre = (q, f) => q.includes('fonda_set_id') && f.id === cf2.id;
    await pause();
    const c = await cloturer(d, { set_id: SET });
    assert.deepEqual([sortieDe(c.r, N_C.sortie).nb_decisions_listees, sortieDe(c.r, N_C.sortie).incomplete_search], [1, true]);
    const k = await evaluer(d, SET, [c], [cf1, cf2]);
    assert.deepEqual(k.r.diagnostic, { nb_decisions_listees: 1, decompte_signataire: 2 });
    assert.deepEqual(k.constats, [{ issue: 'temporaire', raison: 'clôture technique : recherche Drive incomplète sans levée explicite (§10 C)' }]);
  });
  test('tuple consigné, fichier ABSENT d\'un listing decisions/ INCOMPLET (signataire) -> refus temporaire, jamais d\'abandon ; MÊME CAS avec levée -> toujours temporaire', async () => {
    const { d } = await lotEmis();
    const cf = await confirmer(d, SET, 1); await pause();
    const c = await cloturer(d, { set_id: SET });
    d.o.incomplet = (q) => q.includes(`'${DEC}'`); d.o.omettre = (q, f) => f.id === cf.id;
    for (const levees of [[], [{ type: 'recherche_incomplete' }]]) {
      const k = await evaluer(d, SET, [c], [cf], { levees });
      assert.deepEqual(issues(k, 'abandon'), [], texte(k)); assert.deepEqual(issues(k, 'incident'), [], texte(k));
      aIssue(k, 'temporaire', /non trouvée dans un listing incomplet/);
    }
  });
  test('listing incomplet, levée « recherche_incomplete » présente, TOUS les tuples retrouvés -> poursuite (aucun constat)', async () => {
    const { d } = await lotEmis();
    const cf = await confirmer(d, SET, 1); await pause();
    d.o.incomplet = (q) => q.includes(`'${DEC}'`);
    const c = await cloturer(d, { set_id: SET });
    assert.equal(sortieDe(c.r, N_C.sortie).incomplete_search, true);
    assert.deepEqual((await evaluer(d, SET, [c], [cf], { levees: [{ type: 'recherche_incomplete' }] })).constats, []);
    assert.ok(issues(await evaluer(d, SET, [c], [cf]), 'temporaire').length === 2, 'sans levée : deux refus temporaires');
  });
  test('D5 : décision VRAIMENT écrite pendant le listing de Cloturer (après le calcul de la page), absente de ce listing -> aucun constat, décision retenue, compteur divergent en diagnostic', async () => {
    const { d } = await lotEmis();
    let cf;
    // Le VRAI Confirmer a passé C1–C5bis avant la clôture ; son écriture est libérée PENDANT le listing de Cloturer.
    const enVol = await confirmationRetenue(d, SET, 1);
    d.crochets.apresListe = { si: (q) => q.includes(`'${DEC}'`), f: async () => { enVol.liberer(); cf = await enVol.resultat; } };
    const c = await cloturer(d, { set_id: SET });
    assert.equal(cf.sortie.ecriture, 'creee', JSON.stringify(cf.sortie));
    assert.equal(c.r.status, 'success', c.r.erreur); assert.ok(cf, 'écriture concurrente effectuée');
    assert.equal(sortieDe(c.r, N_C.sortie).nb_decisions_listees, 0, 'absente du listing de clôture');
    const f = d.fichiers.get(cf.id);
    assert.ok(f.modifiedTime >= c.obs.startedAt && f.modifiedTime <= c.obs.stoppedAt, 'écrite PENDANT l\'exécution de clôture');
    const k = await evaluer(d, SET, [c], [cf]);
    assert.deepEqual(k.constats, []);
    assert.deepEqual(k.r.diagnostic, { nb_decisions_listees: 0, decompte_signataire: 1 }); assert.equal(k.r.decisions.length, 1);
  });
  test('fichier compté à la clôture PUIS modifié après : modifie_le > fin -> temporaire ; contenu ≠ tuple consigné -> abandon', async () => {
    const { d } = await lotEmis();
    const cf = await confirmer(d, SET, 1); await pause();
    const c = await cloturer(d, { set_id: SET }); await pause();
    const f = d.fichiers.get(cf.id); f.modifiedTime = new Date().toISOString();
    aIssue(await evaluer(d, SET, [c], [cf]), 'temporaire', /écrit après la clôture technique/);
    const x = JSON.parse(f.contenu); x.recu_le = new Date().toISOString(); f.contenu = JSON.stringify(x);
    aIssue(await evaluer(d, SET, [c], [cf]), 'abandon', /substituée sur Drive/);
  });
  test('candidat « abandonne » : la clôture technique refuse (exécution en erreur attribuée au lot)', async () => {
    const { d } = await lotEmis();
    const f = d.candidat(SET); const cand = JSON.parse(f.contenu); cand.relecture.statut = 'abandonne'; f.contenu = JSON.stringify(cand);
    const c = await cloturer(d, { set_id: SET });
    assert.equal(c.r.status, 'error'); assert.match(c.r.erreur, /abandonne/);
  });
  test('candidat déjà clos avec clos_le MAL FORMÉ : clôture en erreur AVANT toute sortie, rien réécrit', async () => {
    const { d } = await lotEmis();
    const f = d.candidat(SET); const cand = JSON.parse(f.contenu); cand.relecture.statut = 'clos'; cand.relecture.clos_le = '2026-11-08 10:00'; f.contenu = JSON.stringify(cand);
    const avant = f.contenu;
    const c = await cloturer(d, { set_id: SET });
    assert.equal(c.r.status, 'error'); assert.match(c.r.erreur, /clos_le absent ou mal formé/);
    assert.ok(!c.r.runData[N_C.sortie] && !c.r.runData[N_C.ecrire]); assert.equal(f.contenu, avant);
  });
});

describe('7 bis. recherches par NOM EXACT paginées (défaut P3 corrigé en P2) : page vide portant un jeton -> page suivante lue, jamais une erreur', () => {
  const pageVideDabord = (d) => { d.o.taillePage = 1; d.o.pagesVides = new Set([0]); };
  test('Emettre : lot source (émission initiale)', async () => {
    const d = mondeAvecLot(); pageVideDabord(d);
    const e = await emettre(d);
    assert.equal(e.status, 'success', e.erreur); assert.equal(e.sorties[N_E.chercherLot].length, 2, 'page vide + page du lot');
  });
  test('Emettre : candidat existant (réémission)', async () => {
    const d = mondeAvecLot(); assert.equal((await emettre(d)).status, 'success'); pageVideDabord(d);
    const e = await emettre(d, { k: K2 });
    assert.equal(e.status, 'success', e.erreur); assert.equal(e.sorties[N_E.existant].length, 2); assert.equal(candidatDe(d).relecture.generation_cle, 2);
  });
  test('Cloturer : candidat de clôture', async () => {
    const { d } = await lotEmis(); pageVideDabord(d);
    const c = await cloturer(d, { set_id: SET });
    assert.equal(c.r.status, 'success', c.r.erreur); assert.equal(c.r.sorties[N_C.chercher].length, 2); assert.equal(candidatDe(d).relecture.statut, 'clos');
  });
  test('incompleteSearch sur une recherche par nom exact (lot source, candidat existant, candidat de clôture) -> ERREUR, jamais une conclusion', async () => {
    const d1 = mondeAvecLot(); d1.o.incomplet = (q) => q.includes('.lot.json');
    const e1 = await emettre(d1); assert.equal(e1.status, 'error'); assert.match(e1.erreur, /recherche du lot source incomplète/);
    const d2 = mondeAvecLot(); assert.equal((await emettre(d2)).status, 'success'); d2.o.incomplet = (q) => q.includes('.candidat.json') && !q.includes('trashed');
    const e2 = await emettre(d2, { k: K2 }); assert.equal(e2.status, 'error'); assert.match(e2.erreur, /candidat existant incomplète/); assert.equal(candidatDe(d2).relecture.generation_cle, 1);
    const { d: d3 } = await lotEmis(); d3.o.incomplet = (q) => q.includes('.candidat.json');
    const c = await cloturer(d3, { set_id: SET }); assert.equal(c.r.status, 'error'); assert.match(c.r.erreur, /recherche du candidat incomplète/);
  });
  test('comptage inchangé : DEUX fichiers de même nom répartis sur deux pages -> refus (exactement un attendu)', async () => {
    const d = mondeAvecLot(); d.o.taillePage = 1;
    d.ajouter(CAND, `${SET}.lot.json`, `${JSON.stringify(lotSource(SET), null, 2)}\n`);
    const e = await emettre(d);
    assert.equal(e.status, 'error'); assert.match(e.erreur, /2 fichier\(s\) pour du lot source/);
  });
});

describe('7. Emettre : pré-conditions §21.5 vérifiées par le workflow (finding 3a)', () => {
  const refuse = async (d, opts, motif) => {
    const e = await emettre(d, opts);
    assert.equal(e.status, 'error'); assert.match(e.erreur, motif);
    assert.equal(d.candidat(SET), undefined, 'aucun candidat écrit'); assert.equal(d.envois.length, 0, 'aucun courriel');
  };
  const lotModifie = (mut) => { const d = fauxDrive(); const l = lotSource(SET); mut(l); d.ajouter(CAND, `${SET}.lot.json`, JSON.stringify(l)); return d; };
  test('lot source SANS cartes -> refus', async () => { await refuse(lotModifie((l) => { l.cartes = []; l.nb_cartes = 0; }), {}, /cartes absentes ou vides/); });
  test('lot source avec un champ hors liste blanche -> refus', async () => { await refuse(lotModifie((l) => { l.prof_email = 'x'; }), {}, /non autorisés/); });
  test('lot source d\'une autre notion que le set_id -> refus', async () => {
    await refuse(lotModifie((l) => { l.notion_id = 'fr.inference-implicite'; l.cartes.forEach((c) => { c.notion_id = l.notion_id; }); }), {}, /notion ou palier/);
  });
  test('journal sans réservation du set_id -> refus', async () => { await refuse(mondeAvecLot(), { octJournal: journal([reserve(AUTRE)]) }, /non réservé/); });
  test('journal : set_id réservé puis abandonné -> refus', async () => {
    await refuse(mondeAvecLot(), { octJournal: journal([reserve(SET), { set_id: SET, transition: 'abandonne', le: '2026-11-08', ref: `test:${SET}:abandonne` }]) }, /état ≠ « reserve »/);
  });
  test('référentiel au commit ≠ referentiel_version annoncée -> refus', async () => {
    await refuse(mondeAvecLot(), { corps: { set_id: SET, journal_commit: COMMIT, referentiel_version: `sha256:${'9'.repeat(64)}`, moteur: MOTEUR } }, /référentiel au commit/);
  });
  test('moteur absent du registre -> refus', async () => {
    await refuse(mondeAvecLot(), { corps: { set_id: SET, journal_commit: COMMIT, referentiel_version: REF_VERSION, moteur: { version: 'v99', sha256: 'x' } } }, /moteur absent/);
  });
  test('émission initiale avec une décision du lot déjà dans decisions/ -> refus', async () => {
    const d = mondeAvecLot(); d.ajouter(DEC, 'x.json', '{}', { fonda_set_id: SET });
    await refuse(d, {}, /décision\(s\) du lot/);
  });
});

describe('8. RÉÉMISSION (§21.5, décision point 4) : en_attente ET decisions/ PROUVÉ vide, sinon refus', () => {
  test('panne de courriel -> candidat écrit, tentative consignée ; réémission -> generation_cle 2, nouvelle clé, puis chaîne nominale en génération 2', async () => {
    const d = mondeAvecLot();
    const e1 = await emettre(d, { reponses: { [N_E.envoyer]: async () => ({ statusCode: 503, body: {} }) } });
    assert.equal(e1.status, 'error'); assert.equal(e1.noeudErreur, N_E.envoyer);
    const c1 = candidatDe(d);
    assert.equal(c1.relecture.envois.length, 1, 'la tentative échouée est consignée');
    const id = d.candidat(SET).id;
    const e2 = await emettre(d, { k: K2 });
    assert.equal(e2.status, 'success', e2.erreur);
    assert.equal(e2.runData[N_E.ecrire], undefined, 'aucune création'); assert.ok(e2.runData[N_E.reecrire]);
    const c2 = candidatDe(d);
    assert.equal(d.candidat(SET).id, id, 'même fichier');
    assert.deepEqual(c2.lot, c1.lot);
    assert.deepEqual([c2.relecture.statut, c2.relecture.clos_le, c2.relecture.generation_cle], ['en_attente', null, 2]);
    assert.equal(c2.relecture.cle_sha256, sha(Buffer.from(K2, 'utf8'))); assert.notEqual(c2.relecture.cle_sha256, c1.relecture.cle_sha256);
    assert.equal(c2.relecture.cree_le, c1.relecture.cree_le);
    const le2 = c2.relecture.envois[1].le;
    assert.equal(Date.parse(c2.relecture.expire_le) - Date.parse(le2), 14 * 86400000, 'expire_le = réémission + 14 j (borné)');
    assert.deepEqual(c2.relecture.envois, [c1.relecture.envois[0], { generation_cle: 2, envoye_a: RELECTEUR, le: le2 }]);
    assert.ok(!d.candidat(SET).contenu.includes(K2));
    assert.deepEqual(sortieDe(e2, N_E.sortie), { schema: 'emission-fonda/v1', set_id: SET, candidat_fichier_id: id, relecteur_attribue: RELECTEUR, generation_cle: 2, reemission: true });
    kConfinee(e2, K2);
    assert.equal(d.envois.length, 1); assert.match(d.envois[0], new RegExp(`&k=${K2}\\r\\n`)); assert.match(d.envois[0], /remplace le lien/);
    const cf = await confirmer(d, SET, 2, { k: K2 }); await pause();
    assert.equal(cf.sortie.ecriture, 'creee', JSON.stringify(cf.sortie));
    const cl = await cloturer(d, { set_id: SET });
    assert.deepEqual((await evaluer(d, SET, [cl], [cf])).constats, []);
  });
  const refusReemission = async (preparer, motif, o = {}) => {
    const d = mondeAvecLot(o);
    assert.equal((await emettre(d)).status, 'success');
    await preparer(d);
    const avant = d.candidat(SET) && d.candidat(SET).contenu;
    const e = await emettre(d, { k: K2 });
    assert.equal(e.status, 'error'); assert.match(e.erreur, motif);
    assert.equal(e.runData[N_E.reecrire] || e.runData[N_E.ecrire], undefined, 'aucune écriture');
    if (avant) assert.equal(d.candidat(SET).contenu, avant, 'candidat inchangé');
    assert.equal(d.envois.length, 1, 'aucun nouveau courriel');
  };
  test('une décision du lot (nom) -> refus', async () => { await refusReemission(async (d) => { await confirmer(d, SET, 1); }, /décision\(s\) du lot/); });
  test('une décision du lot (propriété seule, à la corbeille) -> refus', async () => { await refusReemission((d) => { d.ajouter(DEC, 'x.json', '{}', { fonda_set_id: SET }, { trashed: true }); }, /décision\(s\) du lot/); });
  test('recherche decisions/ incomplète (incompleteSearch) -> refus, jamais de nouvelle k', async () => {
    await refusReemission((d) => { d.o.incomplet = (q) => q.includes(`'${DEC}'`); }, /incomplète \(incompleteSearch\)/);
  });
  test(`plafond de ${B.CONFIG.maxPagesDrive} pages atteint -> refus DISTINCT d'incompleteSearch`, async () => {
    await refusReemission((d) => { d.o.taillePage = 1; for (let i = 0; i <= B.CONFIG.maxPagesDrive; i += 1) d.ajouter(DEC, `autre-${i}.json`, '{}', { fonda_set_id: SET }); }, /plafond/);
  });
  test('candidat clos -> refus', async () => {
    await refusReemission((d) => { const f = d.candidat(SET); const c = JSON.parse(f.contenu); c.relecture.statut = 'clos'; c.relecture.clos_le = new Date().toISOString(); f.contenu = JSON.stringify(c); }, /statut « clos »/);
  });
  test('candidat abandonne -> refus', async () => {
    await refusReemission((d) => { const f = d.candidat(SET); const c = JSON.parse(f.contenu); c.relecture.statut = 'abandonne'; f.contenu = JSON.stringify(c); }, /statut « abandonne »/);
  });
  test('candidat à la corbeille -> refus', async () => { await refusReemission((d) => { d.candidat(SET).trashed = true; }, /corbeille/); });
  test('deux candidats -> refus', async () => { await refusReemission((d) => { d.ajouter(RELEC, `${SET}.candidat.json`, '{}'); }, /2 candidats existants/); });
  test('lot du candidat ≠ lot source -> refus', async () => {
    await refusReemission((d) => { const f = d.candidat(SET); const c = JSON.parse(f.contenu); c.lot.cartes[0].question += ' (modifiée)'; f.contenu = JSON.stringify(c); }, /lot ≠ lot source/);
  });
  test('même clé que la précédente -> refus', async () => {
    const d = mondeAvecLot();
    assert.equal((await emettre(d)).status, 'success');
    const e = await emettre(d, { k: K });
    assert.equal(e.status, 'error'); assert.match(e.erreur, /identique/);
  });
  test('C6 : enveloppe existante invalide (cree_le, envois, generation_cle non incrémentable) -> refus AVANT toute modification', async () => {
    for (const muter of [(r) => { r.cree_le = 'invalide'; }, (r) => { r.envois = [{ foo: 'bar' }]; }, (r) => { r.generation_cle = Number.MAX_SAFE_INTEGER; }, (r) => { r.envois[0].le = '2026-11-08'; }, (r) => { r.cle_sha256 = 'x'; }]) {
      await refusReemission((d) => { const f = d.candidat(SET); const c = JSON.parse(f.contenu); muter(c.relecture); f.contenu = JSON.stringify(c); }, /cree_le|envois|generation_cle|cle_sha256/);
    }
  });
  test('D3 : lot du candidat NON CONFORME malgré une empreinte_complete égale (schema faux, champ ajouté) -> refus AVANT toute modification', async () => {
    for (const muter of [(l) => { l.schema = 'lot-fonda/v0'; }, (l) => { l.code_suppression = '1234'; }]) {
      await refusReemission((d) => { const f = d.candidat(SET); const c = JSON.parse(f.contenu); muter(c.lot); f.contenu = JSON.stringify(c); }, /lot non conforme/);
    }
  });
  test('D3 : cree_le FUTUR (≤ expire_le lu) -> refus : jamais expire_le ≤ cree_le dans le résultat', async () => {
    await refusReemission((d) => {
      const f = d.candidat(SET); const c = JSON.parse(f.contenu);
      c.relecture.cree_le = new Date(Date.now() + 20 * 86400000).toISOString(); c.relecture.expire_le = new Date(Date.now() + 25 * 86400000).toISOString();
      f.contenu = JSON.stringify(c);
    }, /cree_le futur ou expire_le ≤ cree_le/);
  });
  test('C7 : lot du candidat aux clés RÉORDONNÉES (même empreinte_complete) -> réémission acceptée', async () => {
    const d = mondeAvecLot();
    assert.equal((await emettre(d)).status, 'success');
    const f = d.candidat(SET); const c = JSON.parse(f.contenu);
    const inverse = (o) => Object.fromEntries(Object.entries(o).reverse());
    c.lot = inverse({ ...c.lot, cartes: c.lot.cartes.map(inverse) }); f.contenu = JSON.stringify(c);
    const e = await emettre(d, { k: K2 });
    assert.equal(e.status, 'success', e.erreur); assert.equal(candidatDe(d).relecture.generation_cle, 2);
  });
});

describe('9. courses (D1, D2, E1) : pilier 1 signataire, pilier 2 verrou « un seul écrivain CLI » (P5) ; contrôles de version = signal précoce, pas intégrité', () => {
  test('DÉTECTION : candidat modifié entre l\'analyse et la réécriture (clôture intercalée) -> refus, rien réécrit, candidat clos intact', async () => {
    const d = mondeAvecLot();
    assert.equal((await emettre(d)).status, 'success');
    let c1;
    d.crochets.avantMeta = async () => { c1 = await cloturer(d, { set_id: SET }); };
    const e = await emettre(d, { k: K2 });
    assert.equal(e.status, 'error'); assert.match(e.erreur, /course détectée/); assert.equal(e.runData[N_E.reecrire], undefined);
    assert.equal(c1.r.status, 'success');
    assert.equal(candidatDe(d).relecture.statut, 'clos'); assert.equal(candidatDe(d).relecture.clos_le, sortieDe(c1.r, N_C.sortie).clos_le);
    assert.equal(d.envois.length, 1);
  });
  test('D1 : clôture lisant la génération 1, réémission en génération 2 intercalée, confirmation de génération 1 en vol -> Cloturer ÉCHOUE au contrôle de version, rien réécrit ; le signataire ABANDONNE', async () => {
    const d = mondeAvecLot();
    assert.equal((await emettre(d)).status, 'success');
    let e2; let cf;
    // Cloturer a lu la génération 1 ; AVANT son contrôle de version : réémission (gén. 2) puis confirmation par l'ancien lien.
    d.crochets.avantMeta = async () => { e2 = await emettre(d, { k: K2 }); cf = await confirmer(d, SET, 1); };
    const c = await cloturer(d, { set_id: SET });
    assert.equal(e2.status, 'success', e2.erreur);
    assert.equal(c.r.status, 'error'); assert.equal(c.r.noeudErreur, N_C.verifierVersion); assert.match(c.r.erreur, /course détectée/);
    assert.equal(c.r.runData[N_C.ecrire], undefined, 'rien réécrit');
    assert.deepEqual([candidatDe(d).relecture.statut, candidatDe(d).relecture.generation_cle, candidatDe(d).relecture.cle_sha256], ['en_attente', 2, sha(Buffer.from(K2, 'utf8'))], 'génération 2 intacte (clé révoquée NON rétablie)');
    assert.equal(P.rattacherPage(c.detail, { role: 'cloture', workflowId: 'wfClot', observation: c.obs }).nature, 'erreur');
    const k = await evaluer(d, SET, [c], [cf]);
    aIssue(k, 'abandon', /blocage dur/); assert.notDeepEqual(k.constats, []);
  });
  test('D1, fenêtre résiduelle (au mieux) : réémission glissée APRÈS le contrôle de version de Cloturer -> version après ≠ avant + 1 -> Cloturer en ERREUR ; le signataire ABANDONNE', async () => {
    const d = mondeAvecLot();
    assert.equal((await emettre(d)).status, 'success');
    let e2; let cf;
    d.crochets.avantPatch = async () => { e2 = await emettre(d, { k: K2 }); cf = await confirmer(d, SET, 1); };
    const c = await cloturer(d, { set_id: SET });
    assert.equal(e2.status, 'success', e2.erreur);
    assert.equal(c.r.status, 'error'); assert.equal(c.r.noeudErreur, N_C.sortie); assert.match(c.r.erreur, /écriture concurrente détectée/);
    assert.equal(c.r.runData[N_C.sortie], undefined, 'aucune sortie observée');
    aIssue(await evaluer(d, SET, [c], [cf]), 'abandon', /blocage dur/);
  });
  test('D2 : deux réémissions parties du MÊME état -> la seconde à écrire ÉCHOUE au contrôle de version (aucune génération réutilisée, aucun courriel) ; la chaîne de la première reste nominale', async () => {
    const d = mondeAvecLot();
    assert.equal((await emettre(d)).status, 'success');
    const K3 = 'ef'.repeat(32);
    let eB;
    d.crochets.avantMeta = async () => { eB = await emettre(d, { k: K3 }); };
    const eA = await emettre(d, { k: K2 });
    assert.equal(eB.status, 'success', eB.erreur);
    assert.equal(eA.status, 'error'); assert.equal(eA.noeudErreur, N_E.verifierVersion); assert.match(eA.erreur, /course détectée/); assert.equal(eA.runData[N_E.reecrire], undefined);
    assert.deepEqual([candidatDe(d).relecture.generation_cle, candidatDe(d).relecture.cle_sha256], [2, sha(Buffer.from(K3, 'utf8'))]);
    assert.equal(d.envois.length, 2, 'émission initiale + B seulement'); assert.match(d.envois[1], new RegExp(`&k=${K3}\\r\\n`));
    const cf = await confirmer(d, SET, 2, { k: K3 }); await pause();
    assert.equal(cf.sortie.ecriture, 'creee', JSON.stringify(cf.sortie));
    assert.deepEqual((await evaluer(d, SET, [await cloturer(d, { set_id: SET })], [cf])).constats, []);
  });
  test('E1 — ÉCART CONNU, FERMÉ PAR LE VERROU P5 SEULEMENT : réémission B (et sa confirmation) glissées APRÈS le contrôle de version de A -> A écrase la clé de B puis échoue APRÈS écriture ; le signataire ACCEPTE (constats: []) une décision sous une clé qui n\'est plus celle du candidat', async () => {
    const d = mondeAvecLot();
    assert.equal((await emettre(d)).status, 'success');
    const K3 = 'ef'.repeat(32);
    let eB; let cfB;
    // Deux écrivains CLI en parallèle (erreur de l'opérateur) : B réémet et le relecteur confirme sous la clé de B,
    // pendant que A, déjà passé par son contrôle de version, s'apprête à réécrire.
    d.crochets.avantPatch = async () => { eB = await emettre(d, { k: K3 }); cfB = await confirmer(d, SET, 2, { k: K3 }); };
    const eA = await emettre(d, { k: K2 });
    assert.equal(eB.status, 'success', eB.erreur); assert.equal(cfB.sortie.ecriture, 'creee', 'le VRAI Confirmer accepte la clé de B');
    assert.equal(eA.status, 'error'); assert.equal(eA.noeudErreur, N_E.verifier); assert.match(eA.erreur, /écriture concurrente détectée/);
    assert.ok(eA.runData[N_E.reecrire], 'l\'erreur d\'Emettre survient APRÈS son écriture et ne l\'annule pas');
    assert.equal(d.envois.length, 2, 'aucun courriel de A'); assert.match(d.envois[1], new RegExp(`&k=${K3}\\r\\n`));
    assert.deepEqual([candidatDe(d).relecture.generation_cle, candidatDe(d).relecture.cle_sha256], [2, sha(Buffer.from(K2, 'utf8'))], 'la clé utilisée (B) n\'est plus celle du candidat (A)');
    await pause();
    const c = await cloturer(d, { set_id: SET });
    assert.equal(c.r.status, 'success', c.r.erreur);
    // ÉPINGLÉ : le signataire (P1 gelé) ne peut pas distinguer les deux émissions de génération 2. Ce test
    // DOCUMENTE l'écart ; s'il change, la doctrine (README « Où vit chaque garantie ») doit être relue.
    assert.deepEqual((await evaluer(d, SET, [c], [cfB])).constats, []);
  });
  test('BACKSTOP signataire : clôture glissée après le contrôle de version d\'Emettre -> Emettre détecte (au mieux) ; même sans cette détection, le signataire REFUSE puis ABANDONNE à la re-clôture', async () => {
    const d = mondeAvecLot();
    assert.equal((await emettre(d)).status, 'success');
    let c1;
    d.crochets.avantPatch = async () => { c1 = await cloturer(d, { set_id: SET }); };
    const e = await emettre(d, { k: K2 });
    assert.equal(e.status, 'error'); assert.match(e.erreur, /écriture concurrente détectée/); assert.equal(d.envois.length, 1, 'aucun nouveau courriel');
    assert.equal(c1.r.status, 'success');
    assert.deepEqual([candidatDe(d).relecture.statut, candidatDe(d).relecture.clos_le, candidatDe(d).relecture.generation_cle], ['en_attente', null, 2]);
    const k1 = await evaluer(d, SET, [c1]);
    aIssue(k1, 'temporaire', /« en_attente »/);
    assert.notDeepEqual(k1.constats, [], 'jamais de signature sur cet état');
    const c2 = await cloturer(d, { set_id: SET });
    assert.equal(c2.r.status, 'success');
    aIssue(await evaluer(d, SET, [c1, c2]), 'abandon', /clôtures du lot contradictoires entre elles \(clos_le différents\)/);
  });
  test('BACKSTOP : relecteur confirmant avec l\'ANCIEN lien pendant la réémission -> Emettre détecte après écriture (aucun courriel) ; le signataire ABANDONNE (R6)', async () => {
    const d = mondeAvecLot();
    assert.equal((await emettre(d)).status, 'success');
    let cf;
    d.crochets.avantPatch = async () => { cf = await confirmer(d, SET, 1); };
    const e = await emettre(d, { k: K2 });
    assert.equal(e.status, 'error'); assert.equal(e.noeudErreur, N_E.verifier); assert.match(e.erreur, /décision\(s\) apparue\(s\)/);
    assert.equal(d.envois.length, 1, 'aucun nouveau courriel');
    assert.equal(candidatDe(d).relecture.generation_cle, 2);
    await pause();
    const c = await cloturer(d, { set_id: SET });
    aIssue(await evaluer(d, SET, [c], [cf]), 'abandon', /\(R6\)/);
  });
});

// ════════════════════════════════════════ P2 ════════════════════════════════════════
describe('10. base commune Page/Confirmer : jeton (§21.6) et hash_formulaire (§21.1), vecteurs indépendants (crypto Node)', () => {
  const J = { set_id: SET, generation_cle: 1, cle_sha256: '4'.repeat(64), empreinte: `sha256:${'1'.repeat(64)}`, moteur_version: 'v1', moteur_sha256: '2'.repeat(64), expire_page: '2026-11-09T10:00:00.000Z', nonce: '3'.repeat(32) };
  const F = { lot: SET, generation: 1, empreinte: J.empreinte, moteur_version: 'v1', moteur_sha256: J.moteur_sha256, expire_page: J.expire_page, nonce: J.nonce, action: 'accepter', choix: [['it01', 'garder'], ['it02', 'ecarter']] };
  test('jeton = HMAC-SHA256(secret, octets de JSON.stringify(["fonda-select/v7", …])) ; vecteur figé', () => {
    const msg = JSON.stringify(['fonda-select/v7', J.set_id, 1, J.cle_sha256, J.empreinte, 'v1', J.moteur_sha256, J.expire_page, J.nonce]);
    assert.equal(COMMUN.jetonPage(SECRET, J), crypto.createHmac('sha256', SECRET).update(msg, 'utf8').digest('hex'));
    assert.equal(COMMUN.jetonPage(SECRET, J), '72db8206fb5c000031e195dc728b60b98798622aef775f43a884b5e594a375f9');
    const long = 'é'.repeat(80); // clé > 64 octets : hachée d'abord (RFC 2104)
    assert.equal(COMMUN.jetonPage(long, J), crypto.createHmac('sha256', long).update(msg, 'utf8').digest('hex'));
  });
  test('hash_formulaire = "sha256:" + SHA-256(JSON.stringify(["fonda-select-form/v1", …, choix])) ; vecteur figé ; « tout rejeter » : choix []', () => {
    const attendu = (f) => `sha256:${sha(Buffer.from(JSON.stringify(['fonda-select-form/v1', f.lot, f.generation, f.empreinte, f.moteur_version, f.moteur_sha256, f.expire_page, f.nonce, f.action, f.choix]), 'utf8'))}`;
    assert.equal(COMMUN.hashFormulaire(F), attendu(F));
    assert.equal(COMMUN.hashFormulaire(F), 'sha256:1854e1e7b120e5ee4754a6a913e689d518c085545df3840805e7a268bd9a62d1');
    const R = { ...F, action: 'rejeter', choix: [] };
    assert.equal(COMMUN.hashFormulaire(R), attendu(R));
  });
  test('schéma VALIDÉ avant calcul : type faux, entier non sûr, choix mal formé, objet, longueur -> refus ; aucune normalisation Unicode', () => {
    for (const mut of [{ generation: '1' }, { generation: 1.5 }, { generation: -1 }, { generation: 2 ** 53 }, { lot: { set_id: SET } }, { choix: [['it01', 'garde']] }, { choix: [['it01']] },
      { choix: [['', 'garder']] }, { choix: { it01: 'garder' } }, { nonce: null }]) {
      assert.throws(() => COMMUN.hashFormulaire({ ...F, ...mut }), /tableau canonique/, JSON.stringify(mut));
    }
    assert.throws(() => COMMUN.tableauCanonique(['chaine'], ['a', 'b']), /longueur/);
    assert.notEqual(COMMUN.hashFormulaire({ ...F, nonce: 'é' }), COMMUN.hashFormulaire({ ...F, nonce: 'é' }));
  });
  test('secret absent ou court -> ERREUR (configuration), jamais un jeton faible', () => {
    for (const s of [undefined, null, '', 'court']) assert.throws(() => COMMUN.jetonPage(s, J), /secret HMAC/);
  });
});

describe('11. Confirmer (VRAI workflow) : contrat gelé ROLES.confirmation, C1–C7, nonce, R3, 409, §21.10', () => {
  const rattacher = (cf) => P.rattacherPage(cf.detail, { role: 'confirmation', workflowId: 'wfConf', observation: cf.obs });
  const formeExacte = (s) => assert.deepEqual(Object.keys(s).sort(), Object.keys(P.ROLES.confirmation.formeSortie).sort());
  const rejete = async (d, cf, motif, apresC2) => {
    assert.equal(cf.r.status, 'success', `${cf.r.noeudErreur} : ${cf.r.erreur}`);
    formeExacte(cf.sortie);
    assert.deepEqual(cf.sortie, { schema: 'confirmation-fonda/v1', type: 'rejet', set_id: apresC2 ? SET : null, nonce: apresC2 ? cf.sortie.nonce : null,
      generation: null, decision_fichier_id: null, decision_sha256: null, ecriture: null, motif });
    if (apresC2) assert.match(cf.sortie.nonce, /^[0-9a-f]{32}$/);
    assert.equal(cf.r.runData[N_F.ecrire], undefined, 'rien écrit');
    assert.equal(cf.http.code, B.CODES_HTTP[motif]);
    assert.deepEqual(d.dans(DEC), [], 'decisions/ vide');
    const r = rattacher(cf);
    assert.deepEqual([r.nature, r.set_id, r.motif], ['rejet', apresC2 ? SET : null, motif]);
  };
  const AVEC_K_CONF = new Set([N_F.webhook]);

  test('NOMINAL : decision « creee », forme exacte, fichier <set_id>-<nonce>.json (dossier, propriétés), décision conforme, hash_formulaire EXACT, k confinée ; chaîne -> aucun constat', async () => {
    const { d } = await lotEmis();
    const nonce = nonceAleatoire();
    const f = await formulaire(d, SET, { generation: 1, nonce, ecarter: ['it02'] });
    const cf = await poster(d, f);
    assert.equal(cf.r.status, 'success', cf.r.erreur); formeExacte(cf.sortie);
    assert.deepEqual({ ...cf.sortie, decision_fichier_id: null }, { schema: 'confirmation-fonda/v1', type: 'decision', set_id: SET, nonce, generation: 1, decision_fichier_id: null, decision_sha256: P.empreinteDecision(cf.dec), ecriture: 'creee', motif: null });
    assert.equal(cf.http.code, 200); assert.match(cf.http.corps, /enregistrée/);
    const fich = d.fichiers.get(cf.id);
    assert.deepEqual([fich.name, fich.parents, fich.properties], [`${SET}-${nonce}.json`, [DEC], { fonda_set_id: SET, fonda_nonce: nonce }]);
    assert.ok(SC.decisionConforme(cf.dec));
    const lot = lotSource(SET);
    const choix = lot.cartes.map((c) => [c.item_id, c.item_id === 'it02' ? 'ecarter' : 'garder']);
    assert.equal(cf.dec.hash_formulaire, `sha256:${sha(Buffer.from(JSON.stringify(['fonda-select-form/v1', SET, 1, f.empreinte, f.moteur_version, f.moteur_sha256, f.expire_page, nonce, 'accepter', choix]), 'utf8'))}`);
    assert.deepEqual(cf.dec.coeur.ecartees, ['it02']); assert.deepEqual(cf.dec.lot_relu.cartes.map((c) => [c.item_id, c.choix]), choix);
    assert.deepEqual(rattacher(cf).nature, 'decision');
    const porteurs = Object.entries(cf.r.runData).filter(([, v]) => JSON.stringify(v).includes(K) || JSON.stringify(v).includes(f.jeton)).map(([n]) => n);
    assert.deepEqual(porteurs.filter((n) => !AVEC_K_CONF.has(n)), [], `k ou jeton hors du webhook : ${porteurs}`);
    await pause();
    assert.deepEqual((await evaluer(d, SET, [await cloturer(d, { set_id: SET })], [cf])).constats, []);
  });
  test('R3 : resoumission IDENTIQUE SÉQUENTIELLE (même nonce, même formulaire) -> « existante », même fichier, SHA du fichier RELU, rien réécrit ; signataire : aucun constat', async () => {
    const { d } = await lotEmis();
    const f = await formulaire(d, SET, { generation: 1 });
    const cf1 = await poster(d, f); const cf2 = await poster(d, f);
    assert.deepEqual([cf1.sortie.ecriture, cf2.sortie.ecriture, cf2.http.code], ['creee', 'existante', 200]);
    assert.equal(cf2.sortie.decision_fichier_id, cf1.sortie.decision_fichier_id); assert.equal(cf2.sortie.decision_sha256, P.empreinteDecision(JSON.parse(d.fichiers.get(cf1.id).contenu)));
    assert.equal(cf2.r.runData[N_F.ecrire], undefined); assert.equal(d.dans(DEC).length, 1);
    assert.equal(rattacher(cf2).ecriture, 'existante');
    await pause();
    assert.deepEqual((await evaluer(d, SET, [await cloturer(d, { set_id: SET })], [cf1, cf2])).constats, []);
  });
  test('C6 : resoumission DIFFÉRENTE (même nonce, autre sélection) -> « conflit » 409, rien écrit, fichier existant intact ; signataire : ABANDON', async () => {
    const { d } = await lotEmis();
    const nonce = nonceAleatoire();
    const cf1 = await confirmer(d, SET, 1, { nonce });
    const avant = d.fichiers.get(cf1.id).contenu;
    const cf2 = await confirmer(d, SET, 1, { nonce, ecarter: ['it01'] });
    assert.equal(cf2.r.status, 'success'); formeExacte(cf2.sortie);
    assert.deepEqual([cf2.sortie.type, cf2.sortie.decision_fichier_id, cf2.sortie.ecriture, cf2.sortie.motif, cf2.http.code], ['conflit', cf1.id, null, null, 409]);
    assert.notEqual(cf2.sortie.decision_sha256, cf1.sortie.decision_sha256, 'SHA de la décision REFUSÉE');
    assert.equal(cf2.r.runData[N_F.ecrire], undefined); assert.equal(d.dans(DEC).length, 1); assert.equal(d.fichiers.get(cf1.id).contenu, avant);
    assert.equal(rattacher(cf2).nature, 'conflit');
    await pause();
    aIssue(await evaluer(d, SET, [await cloturer(d, { set_id: SET })], [cf1, cf2]), 'abandon', /« conflit »/);
  });
  test('C6 : DEUX fichiers de même nom (état anormal) -> ERREUR, aucune troisième écriture', async () => {
    const { d } = await lotEmis();
    const nonce = nonceAleatoire();
    for (let i = 0; i < 2; i += 1) d.ajouter(DEC, `${SET}-${nonce}.json`, '{}', { fonda_set_id: SET, fonda_nonce: nonce });
    const cf = await confirmer(d, SET, 1, { nonce });
    assert.equal(cf.r.status, 'error'); assert.match(cf.r.erreur, /2 décisions de même nom/); assert.equal(d.dans(DEC).length, 2);
  });
  test('C6 : fichier de même nom NON CONFORME (déposé par un tiers) -> « conflit », jamais « existante »', async () => {
    const { d } = await lotEmis();
    const nonce = nonceAleatoire();
    d.ajouter(DEC, `${SET}-${nonce}.json`, '{"schema":"autre"}', { fonda_set_id: SET, fonda_nonce: nonce });
    const cf = await confirmer(d, SET, 1, { nonce });
    assert.deepEqual([cf.sortie.type, cf.http.code], ['conflit', 409]);
  });
  test('multi-nonce : deux affichages, MÊME sélection -> deux décisions créées, un seul cœur -> aucun constat ; sélections DIFFÉRENTES -> abandon (unicité)', async () => {
    const { d } = await lotEmis();
    const a = await confirmer(d, SET, 1); const b = await confirmer(d, SET, 1);
    assert.deepEqual([a.sortie.ecriture, b.sortie.ecriture], ['creee', 'creee']); assert.notEqual(a.id, b.id);
    await pause();
    const c = await cloturer(d, { set_id: SET });
    assert.deepEqual((await evaluer(d, SET, [c], [a, b])).constats, []);
    const x = await confirmer(d, SET, 1, { k: K, ecarter: ['it03'] });
    assert.equal(x.sortie.type, 'rejet', 'après clôture : C3'); assert.equal(x.sortie.motif, 'C3');
    const d2 = (await lotEmis()).d;
    const p = await confirmer(d2, SET, 1); const q = await confirmer(d2, SET, 1, { ecarter: ['it03'] }); await pause();
    aIssue(await evaluer(d2, SET, [await cloturer(d2, { set_id: SET })], [p, q]), 'abandon', /unicité \(§10 A\) : 2 cœurs distincts/);
  });
  test('« TOUT REJETER » : action rejeter, selection [], ecartees = toutes (ordre du candidat), empreinte_publiee = empreinte du LOT SOURCE ; resoumission identique -> « existante »', async () => {
    const { d } = await lotEmis();
    const f = await formulaire(d, SET, { generation: 1, action: 'rejeter' });
    const cf = await poster(d, f); const cf2 = await poster(d, f);
    const ids = lotSource(SET).cartes.map((c) => c.item_id);
    const empreinte = await Cat.calculerEmpreinte(lotSource(SET), SHA);
    assert.deepEqual([cf.sortie.ecriture, cf2.sortie.ecriture], ['creee', 'existante']);
    assert.deepEqual(cf.dec.coeur, { action: 'rejeter', selection: [], ecartees: ids, empreinte_relue: empreinte, empreinte_publiee: empreinte, moteur: MOTEUR });
    assert.deepEqual(cf.dec.lot_relu.cartes, ids.map((item_id) => ({ item_id, choix: 'ecarter' })));
    assert.equal(cf.dec.hash_formulaire, COMMUN.hashFormulaire({ lot: SET, generation: 1, empreinte, moteur_version: MOTEUR.version, moteur_sha256: MOTEUR.sha256, expire_page: f.expire_page, nonce: f.nonce, action: 'rejeter', choix: [] }));
    await pause();
    const k = await evaluer(d, SET, [await cloturer(d, { set_id: SET })], [cf, cf2]);
    assert.ok(!k.constats.some((c) => /Tout rejeter/.test(c.raison)), texte(k));
  });

  describe('C1 (syntaxe, AVANT Drive) -> rejet 400, set_id/nonce nuls, aucune lecture Drive', () => {
    const cas = [
      ['champ manquant (jeton)', (f) => { delete f.jeton; }],
      ['champ en trop', (f) => { f.extra = 'x'; }],
      ['DOUBLON (lot posté deux fois)', (f) => { f.lot = [f.lot, f.lot]; }],
      ['tableau à UN élément (lot[]=…, se lit comme une chaîne valide)', (f) => { f.lot = [f.lot]; }],
      ['lot invalide', (f) => { f.lot = '../set_x'; }],
      ['action inconnue', (f) => { f.action = 'publier'; }],
      ['accepter SANS aucun choix_', (f) => { for (const c of Object.keys(f)) if (c.startsWith('choix_')) delete f[c]; }],
      ['rejeter AVEC un choix_', (f) => { f.action = 'rejeter'; f.confirmer_rejet = 'oui'; }],
      ['valeur de choix inconnue', (f) => { f.choix_it01 = 'peut-etre'; }],
      ['clé de choix mal formée', (f) => { f.choix___proto__ = 'garder'; }],
      ['generation non entière', (f) => { f.generation = '1.0'; }],
      ['expire_page non canonique', (f) => { f.expire_page = '2026-11-09 10:00'; }],
    ];
    for (const [nom, muter] of cas) {
      test(nom, async () => {
        const { d } = await lotEmis(); const n = d.appels.length;
        const f = await formulaire(d, SET, { generation: 1 }); muter(f);
        const cf = await poster(d, f);
        await rejete(d, cf, 'C1', false); assert.equal(d.appels.length, n, 'aucune requête Drive');
      });
    }
    test('taille : content-length > 64 Ko, absent, ou champs reçus > 64 Ko -> C1', async () => {
      const { d } = await lotEmis();
      const f = await formulaire(d, SET, { generation: 1 });
      const ct = { 'content-type': 'application/x-www-form-urlencoded' };
      await rejete(d, await poster(d, f, { entetes: { ...ct, 'content-length': '65537' } }), 'C1', false);
      await rejete(d, await poster(d, f, { entetes: { ...ct } }), 'C1', false);
      await rejete(d, await poster(d, { ...f, moteur_version: 'v'.repeat(70000) }, { entetes: { ...ct, 'content-length': '100' } }), 'C1', false);
      assert.equal((await poster(d, f, { entetes: { ...ct, 'content-length': '65536' } })).sortie.ecriture, 'creee', 'borne incluse');
    });
    test('entrée NE LÈVE JAMAIS : corps absent, tableau, nombres, chaînes > 128 -> { lot, nonce } nuls ou copiés, rejet C1, exécution « success »', async () => {
      const { d } = await lotEmis();
      for (const corps of [null, [], 'texte', { lot: 7, nonce: {} }, { lot: 'x'.repeat(129), nonce: 'a'.repeat(32) }]) {
        const cf = await poster(d, corps);
        await rejete(d, cf, 'C1', false);
        const e = cf.r.sorties[N_F.entree][0].json;
        assert.deepEqual(e, { lot: null, nonce: corps && corps.nonce === 'a'.repeat(32) ? 'a'.repeat(32) : null });
      }
    });
  });

  test('C2 : jeton faux, autre secret, ou champ modifié après signature -> rejet 403, set_id/nonce NULS (lot et nonce pourtant valides), aucune lecture Drive', async () => {
    const { d } = await lotEmis(); const n = d.appels.length;
    const f = await formulaire(d, SET, { generation: 1 });
    await rejete(d, await poster(d, { ...f, jeton: (f.jeton[0] === 'a' ? 'b' : 'a') + f.jeton.slice(1) }), 'C2', false);
    await rejete(d, await poster(d, await formulaire(d, SET, { generation: 1, secret: 'un-autre-secret-de-test-assez-long-pour-hmac' })), 'C2', false);
    await rejete(d, await poster(d, { ...f, empreinte: `sha256:${'0'.repeat(64)}` }), 'C2', false);
    await rejete(d, await poster(d, { ...f, k: K2 }), 'C2', false);
    assert.equal(d.appels.length, n);
  });
  test('C2 : secret de l\'instance ABSENT -> ERREUR d\'exécution (configuration), rien écrit, 500 ; erreur attribuée au lot', async () => {
    const { d } = await lotEmis();
    const cf = await poster(d, await formulaire(d, SET, { generation: 1 }), { secret: null });
    assert.equal(cf.r.status, 'error'); assert.match(cf.r.erreur, /secret HMAC/); assert.equal(cf.http.code, 500); assert.deepEqual(d.dans(DEC), []);
    assert.deepEqual([rattacher(cf).nature, rattacher(cf).set_id], ['erreur', SET]);
  });

  describe('C3 (fraîcheur contre le candidat COURANT, C2 passé : set_id/nonce NON nuls) -> rejet 410', () => {
    test('§21.10 : clé révoquée par la clôture technique (statut clos)', async () => {
      const { d } = await lotEmis();
      await cloturer(d, { set_id: SET });
      await rejete(d, await confirmer(d, SET, 1), 'C3', true);
    });
    test('clé REMPLACÉE à génération ÉGALE (écrasement par un second écrivain, cf. E1) : seul le contrôle de cle_sha256 la refuse', async () => {
      const { d } = await lotEmis();
      const f = d.candidat(SET); const c = JSON.parse(f.contenu); c.relecture.cle_sha256 = sha(Buffer.from(K2, 'utf8')); f.contenu = JSON.stringify(c);
      await rejete(d, await confirmer(d, SET, 1, { k: K }), 'C3', true);
    });
    test('ancien lien après réémission (clé et génération remplacées)', async () => {
      const { d } = await lotEmis();
      assert.equal((await emettre(d, { k: K2 })).status, 'success');
      await rejete(d, await confirmer(d, SET, 1, { k: K }), 'C3', true);
      assert.equal((await confirmer(d, SET, 2, { k: K2 })).sortie.ecriture, 'creee', 'le nouveau lien fonctionne');
    });
    for (const [nom, opts] of [
      ['génération signée ≠ generation_cle', { generation: 2 }],
      ['expire_page dépassée', { generation: 1, expirePage: new Date(Date.now() - 1000).toISOString() }],
      ['expire_page au-delà de expire_le', { generation: 1, expirePage: new Date(Date.now() + 30 * 86400000).toISOString() }],
      ['moteur ≠ moteur du candidat', { generation: 1, moteur: { version: 'v1', sha256: '9'.repeat(64) } }],
    ]) test(nom, async () => { const { d } = await lotEmis(); await rejete(d, await confirmer(d, SET, opts.generation, opts), 'C3', true); });
    test('candidat absent (à la corbeille) ou abandonné', async () => {
      const { d } = await lotEmis();
      const f = await formulaire(d, SET, { generation: 1 });
      d.candidat(SET).trashed = true;
      await rejete(d, await poster(d, f), 'C3', true);
      const d2 = (await lotEmis()).d; const g = d2.candidat(SET); const c = JSON.parse(g.contenu); c.relecture.statut = 'abandonne'; g.contenu = JSON.stringify(c);
      await rejete(d2, await confirmer(d2, SET, 1), 'C3', true);
    });
  });
  test('C4 : empreinte affichée (signée) ≠ empreinte actuelle du candidat -> rejet 410', async () => {
    const { d } = await lotEmis();
    await rejete(d, await confirmer(d, SET, 1, { empreinte: `sha256:${'5'.repeat(64)}` }), 'C4', true);
  });
  test('C5 : carte sans choix, carte inconnue, aucune carte gardée -> rejet 400', async () => {
    const { d } = await lotEmis();
    for (const muter of [(f) => { delete f.choix_it03; }, (f) => { f.choix_it99 = 'garder'; }, (f) => { delete f.choix_it03; f.choix_it99 = 'garder'; }, (f) => { for (const c of Object.keys(f)) if (c.startsWith('choix_')) f[c] = 'ecarter'; }]) {
      const f = await formulaire(d, SET, { generation: 1 }); muter(f);
      await rejete(d, await poster(d, f), 'C5', true);
    }
  });
  test('C5bis : réémission glissée entre C3 et l\'écriture (pendant la recherche C6) -> candidat RELU non courant -> rejet 410, rien écrit', async () => {
    const { d } = await lotEmis();
    const f = await formulaire(d, SET, { generation: 1 });
    let e2;
    d.crochets.apresListe = { si: (q) => q.includes(`-${f.nonce}.json`), f: async () => { e2 = await emettre(d, { k: K2 }); } };
    const cf = await poster(d, f);
    assert.equal(e2.status, 'success', e2.erreur);
    await rejete(d, cf, 'C5bis', true);
    assert.ok(cf.r.runData[N_F.relire], 'candidat relu');
  });
  test('panne Drive (lecture du candidat) -> ERREUR d\'exécution, 500, rien écrit ; attribuée au lot -> ABANDON au signataire', async () => {
    const { d } = await lotEmis();
    const cf = await poster(d, await formulaire(d, SET, { generation: 1 }), { reponses: { [N_F.lire]: async () => { throw new Error('Drive injoignable'); } } });
    assert.equal(cf.r.status, 'error'); assert.equal(cf.http.code, 500); assert.deepEqual(d.dans(DEC), []);
    assert.deepEqual([rattacher(cf).nature, rattacher(cf).set_id], ['erreur', SET]);
    aIssue(await evaluer(d, SET, [await cloturer(d, { set_id: SET })], [cf]), 'abandon', /blocage dur/);
  });
  test('C6 : recherche du nom INCOMPLÈTE -> ERREUR (absence non prouvée, jamais d\'écriture)', async () => {
    const { d } = await lotEmis();
    d.o.incomplet = (q) => / name = '.*-[0-9a-f]{32}\.json'/.test(q);
    const cf = await confirmer(d, SET, 1);
    assert.equal(cf.r.status, 'error'); assert.match(cf.r.erreur, /absence non prouvée/); assert.deepEqual(d.dans(DEC), []);
  });
  test('PRINCIPE (arbitrage P2) : l\'exécution OBSERVÉE ne contient que le travail essentiel — aucun courriel, Data Table ni nœud « au mieux » ; la réponse HTTP est le DERNIER nœud', () => {
    const wf = JSON.parse(lireExport('confirmer'));
    const urls = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest').map((n) => n.parameters.url);
    assert.ok(urls.every((u) => /googleapis\.com\/(upload\/)?drive\/v3\/files/.test(u)), `HTTP hors Drive : ${urls}`);
    assert.ok(wf.nodes.every((n) => n.onError === undefined && !n.continueOnFail), 'aucune erreur absorbée');
    assert.equal(wf.connections[N_F.repondre], undefined, 'rien après la réponse');
    for (const k of ['cloturer']) {
      const w = JSON.parse(lireExport(k));
      assert.ok(w.nodes.every((n) => n.onError === undefined && !n.continueOnFail && !/gmail|data-tables/.test(JSON.stringify(n.parameters || {}))), `${k} : aucun effet de bord au mieux`);
    }
  });
  test('C1 : encodage ≠ formulaire URL-encodé (JSON, absent) -> rejet 400 : un doublon JSON (dernière valeur gagnante) ne peut pas passer', async () => {
    const { d } = await lotEmis();
    const f = await formulaire(d, SET, { generation: 1 });
    const lg = String(Buffer.byteLength(encoder(f)));
    for (const ct of ['application/json', 'text/plain', undefined, 'multipart/form-data; boundary=x']) {
      await rejete(d, await poster(d, f, { entetes: { ...(ct ? { 'content-type': ct } : {}), 'content-length': lg } }), 'C1', false);
    }
    assert.equal((await poster(d, f, { entetes: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'content-length': lg } })).sortie.ecriture, 'creee');
  });
  test('C6 et C3 PAGINÉS : page vide portant un jeton, résultats sur plusieurs pages -> pages suivantes lues, jamais une erreur', async () => {
    const { d } = await lotEmis();
    d.o.taillePage = 1; d.o.pagesVides = new Set([0]); // après l'émission (Emettre/Cloturer, P3 : recherches non paginées, signalé)
    const nonce = nonceAleatoire();
    const cf1 = await confirmer(d, SET, 1, { nonce });
    assert.equal(cf1.sortie.ecriture, 'creee', cf1.r.erreur);
    assert.equal(cf1.r.sorties[N_F.chercher].length, 2, 'candidat : page vide + page');
    assert.equal(cf1.r.sorties[N_F.chercherDecision].length, 2, 'absence prouvée sur DEUX pages vides');
    const cf2 = await confirmer(d, SET, 1, { nonce });
    assert.deepEqual([cf2.sortie.ecriture, cf2.r.sorties[N_F.chercherDecision].length], ['existante', 2], 'décision existante trouvée en page 2');
    assert.deepEqual(cf2.r.sorties[N_F.chercherDecision][0].json.files, [], 'page 1 vide');
    const autre = await confirmer(d, SET, 1, { nonce, ecarter: ['it01'] });
    assert.equal(autre.sortie.type, 'conflit');
  });
  test('LIMITE (disponibilité, pas intégrité) : deux resoumissions IDENTIQUES SIMULTANÉES -> deux créations (Drive sans écriture conditionnelle) ; le signataire ABANDONNE (R3, pilier 1)', async () => {
    const { d } = await lotEmis();
    const f = await formulaire(d, SET, { generation: 1 });
    let liberer; const barriere = new Promise((r) => { liberer = r; });
    let signaler; const atteinte = new Promise((r) => { signaler = r; });
    d.crochets.avantCreer = async () => { signaler(); await barriere; };
    const pA = poster(d, f); await atteinte; // A : C6 a constaté l'absence, écriture retenue
    const b = await poster(d, f); liberer(); const a = await pA;
    assert.deepEqual([a.sortie.ecriture, b.sortie.ecriture], ['creee', 'creee']); assert.notEqual(a.id, b.id);
    await pause();
    aIssue(await evaluer(d, SET, [await cloturer(d, { set_id: SET })], [a, b]), 'abandon', /resoumissions non identiques \(R3\)/);
  });
});

// ── Page (P2, §21.6) : VRAI workflow ; copie de test adaptée au simulateur (voir en-tête) ──
const N_P = B.NOEUDS_PAGE;
const REG_PAGE = B.registrePage();
const URL_CONFIRMER = `${B.CONFIG.urlN8n}/webhook/${B.CONFIG.cheminConfirmer}`;
// Copie de test : (a) Crypto -> aléas fournis ; (c) requête GET injectée (le simulateur ne transmet pas la query
// string) par un nœud intercalé entre le webhook et « Lire requete », qui lit son ENTRÉE (vérifié en 12.) ; (b) Respond.
function pageSimulable(query, aleas) {
  const w = simulable(JSON.parse(lireExport('page')));
  const i = (nom) => w.nodes.findIndex((x) => x.name === nom);
  w.nodes[i(N_P.nonceCsp)] = { ...w.nodes[i(N_P.nonceCsp)], type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: `return [{ json: { ...$input.first().json, nonce_csp: ${JSON.stringify(aleas.csp)} } }];` } };
  w.nodes[i(N_P.nonce)] = { ...w.nodes[i(N_P.nonce)], type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: `return [{ json: { ...$input.first().json, nonce: ${JSON.stringify(aleas.nonce)} } }];` } };
  w.nodes.push({ name: '(test) requete GET', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: `return [{ json: { ...$input.first().json, query: ${JSON.stringify(query)} } }];` } });
  w.connections[N_P.webhook] = { main: [lien('(test) requete GET')] };
  w.connections['(test) requete GET'] = { main: [lien(N_P.requete)] };
  return w;
}
const lien = (vers) => [{ node: vers, type: 'main', index: 0 }];
async function afficher(d, query, o = {}) {
  const aleas = o.aleas || { csp: nonceAleatoire(), nonce: nonceAleatoire() };
  const r = await executerGraphe(pageSimulable(query, aleas), {
    corps: {}, contexteCode: { $env: { FONDA_PAGE_HMAC: o.secret === undefined ? SECRET : o.secret } },
    reponses: { [N_P.chercher]: d.n8nListe, [N_P.lire]: d.n8nMedia, ...(o.reponses || {}) },
  });
  const http = r.reponseWebhook && r.reponseWebhook.noeud === N_P.repondre
    ? { code: evaluerExpression(r.reponseWebhook.code, { $: null, $json: (r.sorties[N_P.construire] || r.sorties[N_P.indisponible])[0].json }), html: r.reponseWebhook.corps }
    : r.reponseWebhook && { code: r.reponseWebhook.code, html: null };
  return { r, http, aleas };
}
const donneesDe = (html) => JSON.parse(/<script type="application\/json" id="donnees">([\s\S]*?)<\/script>/.exec(html)[1]);
// Ce que fait le script de la page à l'envoi (soumettre) : champs du formulaire + action + choix.
const corpsDepuisPage = (D, { ecarter = [], action = 'accepter' } = {}) => {
  const f = { ...D.formulaire.champs, action };
  if (action === 'accepter') for (const c of D.cartes) f[`choix_${c.item_id}`] = ecarter.includes(c.item_id) ? 'ecarter' : 'garder';
  else f.confirmer_rejet = 'oui';
  return f;
};

describe('12. Page (VRAI workflow, §21.6) : C3 au GET, jeton, deux aléas, CSP, SRI, données échappées, aucune écriture', () => {
  test('statique : Crypto v1 « Generate » hex 32 ×2 ; « Lire requete » lit son ENTRÉE (webhook câblé directement) ; catalogue embarqué exact ; base commune et script de page EXACTS', () => {
    const wf = JSON.parse(lireExport('page'));
    const n = (nom) => wf.nodes.find((x) => x.name === nom);
    for (const [nom, champ] of [[N_P.nonceCsp, 'nonce_csp'], [N_P.nonce, 'nonce']]) assert.deepEqual([n(nom).type, n(nom).typeVersion, n(nom).parameters], ['n8n-nodes-base.crypto', 1, { action: 'generate', dataPropertyName: champ, encodingType: 'hex', stringLength: 32 }]);
    assert.deepEqual(wf.connections[N_P.webhook], { main: [lien(N_P.requete)] });
    assert.match(n(N_P.requete).parameters.jsCode, /const w = unItem\(null\);/);
    const js = n(N_P.construire).parameters.jsCode;
    const src = fs.readFileSync(path.join(RACINE, B.MODULES.catalogue), 'utf8');
    assert.ok(js.includes(`\n${src}})(M_catalogue`), 'catalogue : copie exacte');
    assert.ok(js.includes(B.COMMUN_PAGE) && js.includes(B.GABARIT_PAGE));
    assert.ok(js.includes(`const SCRIPT = ${JSON.stringify(`(${B.appPage.toString()})();`)};`), 'script de page : copie exacte de appPage');
  });
  test('registre de la page : sha256 du fichier = registre ; SRI = sha384 du fichier ; URL exacte (base P4 + nom du fichier)', () => {
    for (const l of REGISTRE) {
      const o = fs.readFileSync(path.join(RACINE, l.fichier));
      const p = REG_PAGE.find((x) => x.version === l.version);
      assert.deepEqual(p, { version: l.version, sha256: sha(o), url: `${B.CONFIG.urlMoteurs}/${path.basename(l.fichier)}`, integrite: `sha384-${crypto.createHash('sha384').update(o).digest('base64')}` });
      assert.equal(p.sha256, l.sha256);
    }
  });
  test('profils : explications par VERSION du moteur ; CHAQUE exemple vérifié par ce moteur (dont « chats » refusé en sens, CDC §4.3) ; tous les profils couverts', () => {
    for (const l of REGISTRE) {
      const M = require(path.join(RACINE, l.fichier)).creerMoteur();
      const p = B.PROFILS_MOTEUR[l.version];
      assert.ok(p, `explications absentes pour ${l.version}`);
      assert.deepEqual(Object.keys(p).sort(), ['exact', 'numerique', 'orthographe', 'sens']);
      for (const [profil, x] of Object.entries(p)) {
        for (const [attendue, saisie, issue] of x.exemples) {
          assert.equal(M.soumettre(M.demarrer(M.preparerCarte({ question: 'q', profil_correction: profil, reponses_acceptees: [attendue] })), saisie).resultat.issue, issue, `${l.version} ${profil} « ${saisie} » / « ${attendue} »`);
        }
      }
    }
    assert.ok(B.PROFILS_MOTEUR.v1.sens.exemples.some(([a, s, i]) => a === 'chat' && s === 'chats' && i === 'faux'));
    assert.match(B.PROFILS_MOTEUR.v1.sens.explication, /singulier\/pluriel n’est PAS pardonné/);
  });

  test('CHAÎNE NOMINALE COMPLÈTE : Emettre -> lien du courriel -> VRAIE Page -> formulaire construit depuis la page -> VRAI Confirmer -> Cloturer -> signataire : aucun constat', async () => {
    const { d } = await lotEmis();
    const k = new RegExp(`\\?lot=${SET}&k=([0-9a-f]{64})\\r\\n`).exec(d.envois[0])[1];
    const avant = JSON.stringify([...d.fichiers.values()]);
    const p = await afficher(d, { lot: SET, k });
    assert.equal(p.r.status, 'success', p.r.erreur); assert.equal(p.http.code, 200);
    assert.equal(JSON.stringify([...d.fichiers.values()]), avant, 'la Page n\'écrit RIEN');
    const D = donneesDe(p.http.html);
    const cand = candidatDe(d);
    assert.deepEqual(D.cartes.map((c) => c.item_id), cand.lot.cartes.map((c) => c.item_id), 'ordre du candidat');
    const ch = D.formulaire.champs;
    assert.deepEqual(Object.keys(ch).sort(), B.CHAMPS_FORMULAIRE.filter((c) => c !== 'action').sort());
    assert.deepEqual([ch.lot, ch.k, ch.generation, ch.nonce, ch.moteur_version, ch.moteur_sha256, D.formulaire.action], [SET, k, '1', p.aleas.nonce, MOTEUR.version, MOTEUR.sha256, URL_CONFIRMER]);
    assert.equal(ch.empreinte, await Cat.calculerEmpreinte(cand.lot, SHA));
    const dt = Date.parse(ch.expire_page) - Date.now();
    assert.ok(dt > 3590000 && dt <= 3600000, 'expire_page = affichage + 60 min');
    assert.equal(ch.jeton, COMMUN.jetonPage(SECRET, { set_id: SET, generation_cle: 1, cle_sha256: cand.relecture.cle_sha256, empreinte: ch.empreinte, moteur_version: ch.moteur_version, moteur_sha256: ch.moteur_sha256, expire_page: ch.expire_page, nonce: ch.nonce }));
    const cf = await poster(d, corpsDepuisPage(D, { ecarter: ['it04'] }));
    assert.equal(cf.sortie.ecriture, 'creee', JSON.stringify(cf.sortie));
    assert.deepEqual(cf.dec.coeur.ecartees, ['it04']);
    assert.equal(cf.dec.hash_formulaire, COMMUN.hashFormulaire({ lot: SET, generation: 1, empreinte: ch.empreinte, moteur_version: ch.moteur_version, moteur_sha256: ch.moteur_sha256, expire_page: ch.expire_page, nonce: ch.nonce, action: 'accepter', choix: D.cartes.map((c) => [c.item_id, c.item_id === 'it04' ? 'ecarter' : 'garder']) }));
    await pause();
    assert.deepEqual((await evaluer(d, SET, [await cloturer(d, { set_id: SET })], [cf])).constats, []);
  });
  test('« Tout rejeter » depuis la page -> décision rejeter ; deux affichages -> deux nonces et deux jetons distincts, chacun valable', async () => {
    const { d } = await lotEmis();
    const D1 = donneesDe((await afficher(d, { lot: SET, k: K })).http.html);
    const D2 = donneesDe((await afficher(d, { lot: SET, k: K })).http.html);
    assert.notEqual(D1.formulaire.champs.nonce, D2.formulaire.champs.nonce); assert.notEqual(D1.formulaire.champs.jeton, D2.formulaire.champs.jeton);
    const a = await poster(d, corpsDepuisPage(D1, { action: 'rejeter' }));
    const b = await poster(d, corpsDepuisPage(D2));
    assert.deepEqual([a.sortie.ecriture, a.dec.coeur.action, b.sortie.ecriture, b.dec.coeur.action], ['creee', 'rejeter', 'creee', 'accepter']);
  });
  test('HTML : CSP EXACTE en <meta> (aléa CSP, URL exacte du moteur, URL exacte de confirmation), aléas DISTINCTS, aléa CSP jamais posté ; scripts : données JSON, moteur avec SRI, script sous nonce ; aucun gestionnaire inline, aucun <form>, aucun innerHTML ; noscript', async () => {
    const { d } = await lotEmis();
    const { http, aleas } = await afficher(d, { lot: SET, k: K });
    const h = http.html;
    const m = REG_PAGE.find((x) => x.version === MOTEUR.version);
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${aleas.csp}' ${m.url}; form-action ${URL_CONFIRMER}; base-uri 'none'`;
    assert.ok(h.includes(`<meta http-equiv="Content-Security-Policy" content="${csp.replace(/'/g, '\'')}">`), 'CSP exacte §21.6');
    assert.notEqual(aleas.csp, aleas.nonce);
    const D = donneesDe(h);
    assert.ok(!JSON.stringify(D).includes(aleas.csp), 'aléa CSP absent des données (jamais posté)');
    const scripts = [...h.matchAll(/<script([^>]*)>/g)].map((x) => x[1]);
    assert.deepEqual(scripts, [' type="application/json" id="donnees"', ` src="${m.url}" integrity="${m.integrite}" crossorigin="anonymous" referrerpolicy="no-referrer"`, ` nonce="${aleas.csp}"`]);
    assert.doesNotMatch(h, /\son[a-z]+\s*=/i, 'aucun gestionnaire inline');
    assert.doesNotMatch(h, /<form/i, 'aucun formulaire dans le HTML (construit par le script)');
    assert.doesNotMatch(h, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
    assert.match(h, /<noscript><p>Page de relecture indisponible sans JavaScript\.<\/p><\/noscript>/);
    assert.match(h, /<meta name="referrer" content="no-referrer">/);
    assert.equal(h.split(K).length - 1, 1, 'k : une seule occurrence (champ k du formulaire, dans les données)');
    assert.equal(D.formulaire.champs.k, K);
  });
  test('données ÉCHAPPÉES : une question contenant </script>, <, >, &, U+2028 reste DANS le bloc JSON et se relit à l\'identique', async () => {
    const d = fauxDrive();
    const l = lotSource(SET); l.cartes[0].question = 'a</script><script>alert(1)</script> & <b> \u2028 </script x <!-- fin';
    d.ajouter(CAND, `${SET}.lot.json`, JSON.stringify(l));
    assert.equal((await emettre(d)).status, 'success');
    const h = (await afficher(d, { lot: SET, k: K })).http.html;
    assert.equal(h.split('</script').length - 1, 3, 'seules les trois balises de fermeture légitimes (« </script » ferme même sans « > »)');
    assert.ok(!h.includes('<!--'));
    assert.equal(donneesDe(h).cartes[0].question, l.cartes[0].question);
  });
  describe('C3 au GET -> page INDISPONIBLE (410) SANS aucune donnée du lot ; requête mal formée -> 400 sans lecture Drive', () => {
    const indisponible = (p, code) => {
      assert.equal(p.r.status, 'success', p.r.erreur); assert.equal(p.http.code, code);
      assert.match(p.http.html, /n’est pas \(ou plus\) valable/);
      assert.ok(!p.http.html.includes(SET) && !p.http.html.includes('donnees') && !p.http.html.includes('<script'), 'aucune donnée du lot');
    };
    for (const [nom, query] of [['k absente', { lot: SET }], ['paramètre en trop', { lot: SET, k: K, x: '1' }], ['k non hexadécimale', { lot: SET, k: 'Z'.repeat(64) }], ['lot invalide', { lot: '../x', k: K }], ['k en tableau', { lot: SET, k: [K, K] }]]) {
      test(`requête : ${nom} -> 400`, async () => { const { d } = await lotEmis(); const n = d.appels.length; indisponible(await afficher(d, query), 400); assert.equal(d.appels.length, n); });
    }
    test('mauvaise clé, ancienne clé après réémission', async () => {
      const { d } = await lotEmis();
      indisponible(await afficher(d, { lot: SET, k: K2 }), 410);
      assert.equal((await emettre(d, { k: K2 })).status, 'success');
      indisponible(await afficher(d, { lot: SET, k: K }), 410);
      assert.equal((await afficher(d, { lot: SET, k: K2 })).http.code, 200);
    });
    test('candidat clos (clé révoquée), expiré, abandonné, absent', async () => {
      const { d } = await lotEmis(); await cloturer(d, { set_id: SET });
      indisponible(await afficher(d, { lot: SET, k: K }), 410);
      for (const muter of [(r) => { r.expire_le = new Date(Date.now() - 1000).toISOString(); }, (r) => { r.statut = 'abandonne'; }]) {
        const d2 = (await lotEmis()).d; const f = d2.candidat(SET); const c = JSON.parse(f.contenu); muter(c.relecture); f.contenu = JSON.stringify(c);
        indisponible(await afficher(d2, { lot: SET, k: K }), 410);
      }
      const d3 = (await lotEmis()).d; d3.candidat(SET).trashed = true;
      indisponible(await afficher(d3, { lot: SET, k: K }), 410);
      const d4 = (await lotEmis()).d; d4.ajouter(RELEC, `${SET}.candidat.json`, d4.candidat(SET).contenu);
      indisponible(await afficher(d4, { lot: SET, k: K }), 410);
    });
    test('moteur du candidat ABSENT du registre (sha256 ≠) -> indisponible, moteur jamais chargé', async () => {
      const { d } = await lotEmis(); const f = d.candidat(SET); const c = JSON.parse(f.contenu); c.relecture.moteur = { version: MOTEUR.version, sha256: '9'.repeat(64) }; f.contenu = JSON.stringify(c);
      indisponible(await afficher(d, { lot: SET, k: K }), 410);
    });
  });
  test('expire_page BORNÉE par expire_le (moins d\'une heure restante)', async () => {
    const { d } = await lotEmis();
    const f = d.candidat(SET); const c = JSON.parse(f.contenu); c.relecture.expire_le = new Date(Date.now() + 600000).toISOString(); f.contenu = JSON.stringify(c);
    assert.equal(donneesDe((await afficher(d, { lot: SET, k: K })).http.html).formulaire.champs.expire_page, c.relecture.expire_le);
  });
  test('secret ABSENT -> erreur (500), jamais une page à jeton faible ; aléas égaux -> erreur', async () => {
    const { d } = await lotEmis();
    const p = await afficher(d, { lot: SET, k: K }, { secret: null });
    assert.equal(p.r.status, 'error'); assert.match(p.r.erreur, /secret HMAC/); assert.equal(p.http.code, 500);
    const a = nonceAleatoire();
    assert.match((await afficher(d, { lot: SET, k: K }, { aleas: { csp: a, nonce: a } })).r.erreur, /aléas de la page/);
  });
});

// ── 13. Script de la page EXÉCUTÉ (DOM minimal en vm, sans dépendance) : SOUMISSION SIMULÉE — les occurrences
// réellement soumises par le script sont sérialisées en URL-encodé, décodées EN CONSERVANT les doublons, puis
// postées au VRAI Confirmer (le transport navigateur -> webhook est une recette P4). Le DOM n'implémente que ce
// que le script doit utiliser ; innerHTML, outerHTML, insertAdjacentHTML et document.write LÈVENT. ──
const INTERDIT = (quoi) => () => { throw new Error(`DOM simulé : ${quoi} interdit (textContent seulement)`); };
// Décodage d'un corps URL-encodé : un nom répété devient un TABLEAU (forme attendue de n8n, point P4).
function decoderFormulaire(texte) {
  const o = {};
  for (const [k, v] of new URLSearchParams(texte)) {
    if (!Object.prototype.hasOwnProperty.call(o, k)) o[k] = v; else o[k] = [].concat(o[k], v);
  }
  return o;
}
function navigateur(html, { moteur = true } = {}) {
  const soumis = []; const images = [];
  class Noeud {
    constructor(tag) { Object.assign(this, { tag, enfants: [], parent: null, texte: '', attrs: {}, ecouteurs: {}, disabled: false, hidden: false, checked: false, className: '', type: '', name: '', value: '', method: '', action: '', id: '' }); }
    get firstChild() { return this.enfants[0] || null; }
    appendChild(e) { if (e.parent) e.parent.removeChild(e); e.parent = this; this.enfants.push(e); return e; }
    removeChild(e) { const i = this.enfants.indexOf(e); if (i < 0) throw new Error('removeChild : pas un enfant'); this.enfants.splice(i, 1); e.parent = null; return e; }
    insertBefore(e, ref) { if (e.parent) e.parent.removeChild(e); const i = ref ? this.enfants.indexOf(ref) : -1; e.parent = this; this.enfants.splice(i < 0 ? this.enfants.length : i, 0, e); return e; }
    get textContent() { return this.texte + this.enfants.map((e) => e.textContent).join(''); }
    set textContent(v) { for (const e of this.enfants) e.parent = null; this.enfants = []; this.texte = String(v); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener(t, f) { (this.ecouteurs[t] = this.ecouteurs[t] || []).push(f); }
    // Envoi : le corps est FIGÉ ICI, au moment de submit() (une mutation ultérieure du formulaire est sans effet).
    submit() { if (nav.avantEnvoi) nav.avantEnvoi(this); soumis.push({ method: this.method, action: this.action, corps: serialiser(this) }); }
    get innerHTML() { return INTERDIT('innerHTML')(); }
    set innerHTML(v) { INTERDIT('innerHTML')(); }
    get outerHTML() { return INTERDIT('outerHTML')(); }
    set outerHTML(v) { INTERDIT('outerHTML')(); }
    insertAdjacentHTML() { INTERDIT('insertAdjacentHTML')(); }
  }
  const donnees = new Noeud('script'); donnees.texte = /<script type="application\/json" id="donnees">([\s\S]*?)<\/script>/.exec(html)[1];
  const ids = { donnees, app: new Noeud('main'), rejet: new Noeud('section') };
  ids.rejet.hidden = true;
  const body = new Noeud('body'); for (const e of [ids.app, ids.rejet]) body.appendChild(e);
  const ctx = vm.createContext({ document: { createElement: (t) => new Noeud(t), getElementById: (i) => ids[i] || null, body, write: INTERDIT('document.write'), writeln: INTERDIT('document.writeln') },
    window: { scrollTo() {} }, requestAnimationFrame: (f) => { images.push(f); } });
  vm.runInContext('var self = globalThis;', ctx);
  const m = REG_PAGE.find((x) => html.includes(`src="${x.url}" integrity="${x.integrite}"`));
  if (moteur) {
    const src = fs.readFileSync(path.join(RACINE, REGISTRE.find((l) => l.version === m.version).fichier));
    assert.equal(`sha384-${crypto.createHash('sha384').update(src).digest('base64')}`, m.integrite, 'SRI : le fichier chargé correspond à l\'intégrité de la page');
    vm.runInContext(src.toString('utf8'), ctx); // <script src integrity> accepté
  }
  vm.runInContext(/<script nonce="[0-9a-f]{32}">([\s\S]*?)<\/script>/.exec(html)[1], ctx);
  const tous = (n = body) => [n, ...n.enfants.flatMap((e) => tous(e))];
  // Structure soumise FIGÉE : uniquement des champs cachés ENFANTS DIRECTS du formulaire, NOMMÉS, ACTIFS, sans
  // descendant. Un champ désactivé ou sans nom (qu'un navigateur omettrait), ou imbriqué, fait ÉCHOUER le test
  // au lieu d'être silencieusement sérialisé ou ignoré. Occurrences dans l'ordre du DOM, doublons compris.
  function serialiser(f) {
    for (const x of f.enfants) {
      if (x.tag !== 'input' || x.type !== 'hidden' || typeof x.name !== 'string' || x.name === '' || x.disabled || x.enfants.length) {
        throw new Error(`structure soumise hors gabarit : <${x.tag} type="${x.type}" name="${x.name}"${x.disabled ? ' disabled' : ''}>${x.enfants.length ? ' avec descendants' : ''}`);
      }
    }
    return new URLSearchParams(f.enfants.map((x) => [x.name, String(x.value)])).toString();
  }
  const nav = {
    avantEnvoi: null,
    soumis, body, app: ids.app, rejet: ids.rejet,
    boutons: () => tous().filter((n) => n.tag === 'button').map((b) => b.textContent),
    bouton: (t) => tous().find((n) => n.tag === 'button' && n.textContent === t),
    cliquer(t) { const b = nav.bouton(t); assert.ok(b, `bouton « ${t} » absent (${nav.boutons()})`); assert.equal(b.disabled, false, `bouton « ${t} » désactivé`); for (const f of b.ecouteurs.click || []) f({ target: b }); },
    images() { while (images.length) images.shift()(); },
    texte: () => body.textContent,
    // Corps figé à l'envoi -> décodage EN CONSERVANT les doublons.
    champs: (e) => decoderFormulaire(e.corps),
    Noeud,
    tous,
  };
  return nav;
}
const vm = require('vm');

describe('13. script de la page EXÉCUTÉ (DOM minimal) -> soumission SIMULÉE (occurrences réelles) -> VRAI Confirmer', () => {
  const pageDe = async () => { const { d } = await lotEmis(); return { d, html: (await afficher(d, { lot: SET, k: K })).http.html }; };
  // Poste le corps URL-encodé EXACT des occurrences soumises (content-length = ses octets).
  const posterSoumis = (d, e) => poster(d, decoderFormulaire(e.corps), { entetes: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(Buffer.byteLength(e.corps)) } });
  test('DOM simulé : innerHTML, outerHTML, insertAdjacentHTML, document.write LÈVENT (un script qui les utilise échoue)', async () => {
    const { html } = await pageDe();
    const n = navigateur(html);
    const e = new n.Noeud('div');
    assert.throws(() => { e.innerHTML = '<b>x</b>'; }, /innerHTML interdit/); assert.throws(() => e.innerHTML, /innerHTML interdit/);
    assert.throws(() => { e.outerHTML = 'x'; }, /outerHTML interdit/); assert.throws(() => e.insertAdjacentHTML('beforeend', 'x'), /insertAdjacentHTML interdit/);
    const injecter = (code) => { assert.equal(html.split("'use strict';").length, 2); return html.replace("'use strict';", `'use strict'; ${code}`); };
    assert.throws(() => navigateur(injecter('document.getElementById("app").innerHTML = "";')), /innerHTML interdit/);
    assert.throws(() => navigateur(injecter('document.write("x");')), /document\.write interdit/);
    assert.doesNotThrow(() => navigateur(injecter('document.getElementById("app").textContent = "";')), 'contre-épreuve : textContent permis');
  });
  const jusquauRecap = (n) => { for (let i = 0; i < 6; i += 1) { n.images(); n.cliquer('Garder'); n.cliquer(i < 5 ? 'Carte suivante' : 'Récapitulatif'); } };
  test('doublon PRÉSENT AU MOMENT DE L\'ENVOI (champ homonyme ajouté avant submit) -> capturé dans le corps figé, conservé au décodage -> C1 (400), rien écrit ; une mutation APRÈS l\'envoi est sans effet', async () => {
    const { d, html } = await pageDe();
    const n = navigateur(html);
    jusquauRecap(n);
    n.avantEnvoi = (f) => { const dup = new n.Noeud('input'); dup.type = 'hidden'; dup.name = 'choix_it01'; dup.value = 'ecarter'; f.appendChild(dup); };
    n.cliquer('Envoyer ma relecture');
    const e = n.soumis[0];
    assert.deepEqual(n.champs(e).choix_it01, ['garder', 'ecarter']);
    const cf = await posterSoumis(d, e);
    assert.deepEqual([cf.sortie.type, cf.sortie.motif, cf.http.code], ['rejet', 'C1', 400]); assert.deepEqual(d.dans(DEC), []);
    const n2 = navigateur(html);
    jusquauRecap(n2); let formulaire;
    n2.avantEnvoi = (f) => { formulaire = f; };
    n2.cliquer('Envoyer ma relecture');
    const avant = n2.soumis[0].corps;
    const tard = new n2.Noeud('input'); tard.type = 'hidden'; tard.name = 'choix_it01'; tard.value = 'ecarter'; formulaire.appendChild(tard);
    assert.equal(n2.soumis[0].corps, avant, 'corps figé à l\'envoi'); assert.equal(n2.champs(n2.soumis[0]).choix_it01, 'garder');
  });
  test('structure soumise FIGÉE : un champ désactivé, sans nom, non caché ou imbriqué fait ÉCHOUER l\'envoi (jamais sérialisé ni ignoré en silence)', async () => {
    const { html } = await pageDe();
    for (const [nom, muter] of [
      ['désactivé', (x) => { x.disabled = true; }], ['sans nom', (x) => { x.name = ''; }], ['non caché', (x) => { x.type = 'text'; }],
      ['imbriqué', (x, n) => { x.appendChild(new n.Noeud('input')); }],
    ]) {
      const n = navigateur(html);
      jusquauRecap(n);
      n.avantEnvoi = (f) => muter(f.enfants[0], n);
      assert.throws(() => n.cliquer('Envoyer ma relecture'), /structure soumise hors gabarit/, nom);
      assert.equal(n.soumis.length, 0, nom);
    }
    const n = navigateur(html); jusquauRecap(n);
    n.avantEnvoi = (f) => { const div = new n.Noeud('div'); f.appendChild(div); };
    assert.throws(() => n.cliquer('Envoyer ma relecture'), /structure soumise hors gabarit : <div/);
  });
  test('NOMINAL : une carte à la fois (ordre du candidat), Garder/Écarter DÉSACTIVÉS avant le rendu complet, aucun choix par défaut, « Carte suivante » seulement après un choix ; récapitulatif ; soumission simulée -> Confirmer « creee » -> signataire : aucun constat', async () => {
    const { d, html } = await pageDe();
    const n = navigateur(html);
    const ids = lotSource(SET).cartes.map((c) => c.item_id);
    for (const [i, id] of ids.entries()) {
      assert.match(n.texte(), new RegExp(`Carte ${i + 1} sur ${ids.length}`));
      assert.ok(n.texte().includes(lotSource(SET).cartes[i].question));
      assert.equal(n.bouton('Garder').disabled, true, 'désactivé avant le rendu'); assert.equal(n.bouton('Écarter').disabled, true);
      assert.ok(!n.bouton('Carte suivante') && !n.bouton('Récapitulatif'), 'aucun choix par défaut, pas de suite');
      n.images();
      n.cliquer(id === 'it02' ? 'Écarter' : 'Garder');
      n.cliquer(i + 1 < ids.length ? 'Carte suivante' : 'Récapitulatif');
    }
    assert.match(n.texte(), /Récapitulatif/); assert.equal(n.soumis.length, 0, 'rien envoyé avant le récapitulatif');
    n.cliquer('Envoyer ma relecture'); n.bouton('Envoyer ma relecture').disabled = false; n.cliquer('Envoyer ma relecture');
    assert.equal(n.soumis.length, 1, 'un seul envoi (double clic)');
    const e = n.soumis[0];
    assert.deepEqual([e.method, e.action], ['post', URL_CONFIRMER]);
    const champs = n.champs(e);
    assert.deepEqual(Object.keys(champs).sort(), [...B.CHAMPS_FORMULAIRE, ...ids.map((x) => `choix_${x}`)].sort());
    assert.ok(Object.values(champs).every((v) => typeof v === 'string'), 'aucun doublon soumis');
    const cf = await posterSoumis(d, e);
    assert.equal(cf.sortie.ecriture, 'creee', JSON.stringify(cf.sortie)); assert.deepEqual(cf.dec.coeur.ecartees, ['it02']);
    await pause();
    assert.deepEqual((await evaluer(d, SET, [await cloturer(d, { set_id: SET })], [cf])).constats, []);
  });
  test('retour arrière et changement de choix : la carte est réaffichée, le choix courant indiqué, le POST porte le DERNIER choix', async () => {
    const { d, html } = await pageDe();
    const n = navigateur(html);
    n.images(); n.cliquer('Garder'); n.cliquer('Carte suivante');
    n.images(); n.cliquer('Carte précédente');
    assert.match(n.texte(), /Carte 1 sur/); assert.match(n.texte(), /Choix actuel : Garder/);
    n.images(); n.cliquer('Écarter');
    for (let i = 0; i < 6; i += 1) { if (i) { n.images(); n.cliquer('Garder'); } n.cliquer(i < 5 ? 'Carte suivante' : 'Récapitulatif'); }
    n.cliquer('Envoyer ma relecture');
    assert.deepEqual((await posterSoumis(d, n.soumis[0])).dec.coeur.ecartees, ['it01']);
  });
  test('toutes les cartes écartées : envoi IMPOSSIBLE depuis le récapitulatif ; « Tout rejeter » exige la case de confirmation -> POST rejeter -> Confirmer « creee » (action rejeter)', async () => {
    const { d, html } = await pageDe();
    const n = navigateur(html);
    assert.equal(n.rejet.hidden, false, 'section « Tout rejeter » séparée, visible avec JavaScript');
    for (let i = 0; i < 6; i += 1) { n.images(); n.cliquer('Écarter'); n.cliquer(i < 5 ? 'Carte suivante' : 'Récapitulatif'); }
    assert.equal(n.bouton('Envoyer ma relecture').disabled, true); assert.match(n.texte(), /utilisez « Tout rejeter »/);
    assert.equal(n.bouton('Tout rejeter').disabled, true, 'confirmation explicite requise');
    const caseRejet = n.tous().find((x) => x.tag === 'input' && x.type === 'checkbox');
    caseRejet.checked = true; for (const f of caseRejet.ecouteurs.change) f({});
    n.cliquer('Tout rejeter');
    const champs = n.champs(n.soumis[0]);
    assert.deepEqual([champs.action, champs.confirmer_rejet, Object.keys(champs).some((c) => c.startsWith('choix_'))], ['rejeter', 'oui', false]);
    const cf = await posterSoumis(d, n.soumis[0]);
    assert.deepEqual([cf.sortie.ecriture, cf.dec.coeur.action], ['creee', 'rejeter']);
  });
  test('« Essayer une réponse » : corrigée par le MOTEUR du candidat (verdict affiché) ; profil et exemples affichés', async () => {
    const { html } = await pageDe();
    const n = navigateur(html);
    const saisie = n.tous().find((x) => x.tag === 'input' && x.type === 'text');
    const c0 = lotSource(SET).cartes[0];
    const M = require('../../fonda/engine/moteur-correction-v1.js').creerMoteur();
    for (const essai of [String(c0.reponses_acceptees[0]), 'réponse fausse']) {
      saisie.value = essai; n.cliquer('Corriger');
      const attendu = M.soumettre(M.demarrer(M.preparerCarte(c0)), essai).resultat.verdict.texte;
      assert.ok(n.texte().includes(attendu), `verdict du moteur « ${attendu} » affiché pour « ${essai} »`);
    }
    const p = B.PROFILS_MOTEUR.v1[c0.profil_correction];
    assert.ok(n.texte().includes(p.explication)); assert.ok(n.texte().includes(`Exemples« ${p.exemples[0][1]} »`));
  });
  test('moteur NON chargé (SRI refusée ou réseau) : relecture impossible, AUCUN bouton de choix ni d\'envoi', async () => {
    const { html } = await pageDe();
    const n = navigateur(html, { moteur: false });
    assert.match(n.texte(), /Moteur de correction indisponible/);
    assert.deepEqual(n.boutons(), []); assert.equal(n.rejet.hidden, true);
  });
});
