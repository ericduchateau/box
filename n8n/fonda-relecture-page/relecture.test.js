// Harnais P3 (CDC relecture §21.0, §21.1, §21.5, §21.10) — workflows « FONDA - Emettre relecture » et
// « FONDA - Cloturer relecture ». Aucun réseau : simulateur n8n (fonda-generation-ia/simulateur.js,
// réutilisé SANS modification), Drive, GitHub, Data Table et Gmail simulés.
//   1. octet-identité INTERNE : export commité == construction depuis le dépôt (P2/P3 ; dépôt <-> live à P4) ;
//   2. contrôles statiques : détection de MOTIFS CONNUS de secret/PII (pas une preuve d'absence),
//      credentials par référence, authentification d'en-tête, IF stricts, modules embarqués exacts ;
//   3. FAUX DRIVE FIDÈLE : la requête `q` de chaque nœud est INTERPRÉTÉE (parents, name =, name contains,
//      properties has, trashed, and/or/parenthèses ; clause inconnue = erreur), champs `fields` projetés,
//      pagination par jeton ; producteurs (n8n) ET signataire (VRAI adaptateurs-page.lecturePage, par un
//      fetch simulé) lisent le MÊME Drive ;
//   4. CHAÎNE RÉELLE : Emettre -> (décision §21.1 + confirmation au contrat, P2 à venir) -> Cloturer ->
//      VRAI preLireDetails -> VRAI rattacherPage -> VRAI evaluerPage -> VRAIE réconciliation (L.unicite,
//      L.reconcilier, empreinte publiée par SC.lotPublie), avec les VRAIES preuves de génération ;
//      transport HTTP de la pagination reconstitué selon la configuration du nœud (jeton en query string) ;
//   5. cas du §21.10 et réémission (§21.5), toujours par la chaîne réelle.
// Seul stub hors simulateur : le nœud Crypto (non simulé) est remplacé, DANS LA COPIE de test du
// workflow, par un nœud Code rendant une clé k fixe. La confirmation (workflow P2) est représentée par
// son CONTRAT (fichier decision-fonda/v1 + exécution au format du consommateur gelé), à remplacer par
// le vrai workflow Confirmer en P2.
// Usage : node --test n8n/fonda-relecture-page/relecture.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const B = require('./construire-relecture.js');
const { executerGraphe } = require('../fonda-generation-ia/simulateur.js');
const L = require('../../fonda/scripts/liaison-generation.js');
const P = require('../../fonda/scripts/rattachement-page.js');
const A = require('../../fonda/scripts/adaptateurs-page.js');
const FC = require('../../fonda/scripts/fixtures/execution-confirmation.json');
const SC = require('../../fonda/scripts/signer-cloture.js');
const Cat = require('../../fonda/engine/catalogue.js');
const SHA = Cat.sha256WebCrypto();

const RACINE = path.join(__dirname, '..', '..');
const EXPORTS = { cloturer: 'box-fonda-cloturer-relecture.json', emettre: 'box-fonda-emettre-relecture.json' };
const lireExport = (k) => fs.readFileSync(path.join(__dirname, EXPORTS[k]));
const copie = (o) => JSON.parse(JSON.stringify(o));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const pause = () => new Promise((r) => { setTimeout(r, 3); });
const N_C = B.NOEUDS_CLOTURER; const N_E = B.NOEUDS_EMETTRE;
const { dossierCandidats: CAND, dossierRelecture: RELEC, dossierDecisions: DEC } = B.CONFIG;

// ── 1. et 2. Contrôles statiques ──
const SANS_MODULES = (js) => js.replace(/\/\/ >>> MODULE [\s\S]*?\/\/ <<< MODULE [^\n]*/g, '');
describe('1. octet-identité interne et 2. contrôles statiques', () => {
  for (const [k, construire] of [['cloturer', B.construireCloturer], ['emettre', B.construireEmettre]]) {
    test(`${EXPORTS[k]} == construction depuis le dépôt, octet pour octet`, () => {
      assert.ok(lireExport(k).equals(Buffer.from(`${JSON.stringify(construire(), null, 2)}\n`, 'utf8')), `${EXPORTS[k]} ≠ construction : regénérer par construire-relecture.js --${k}`);
    });
    test(`${EXPORTS[k]} : détection de motifs connus de secret/PII (adresse, clé, jeton, hex 64) hors modules embarqués vérifiés`, () => {
      const wf = JSON.parse(lireExport(k));
      for (const n of wf.nodes) {
        const t = n.type === 'n8n-nodes-base.code' ? JSON.stringify({ ...n, parameters: { jsCode: SANS_MODULES(n.parameters.jsCode) } }) : JSON.stringify(n);
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
    test(`${EXPORTS[k]} : webhook POST à authentification d'en-tête ; IF v2 STRICTS sur un booléen`, () => {
      const wf = JSON.parse(lireExport(k));
      const wh = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook');
      assert.equal(wh.length, 1);
      assert.deepEqual([wh[0].parameters.httpMethod, wh[0].parameters.authentication, Object.keys(wh[0].credentials)], ['POST', 'headerAuth', ['httpHeaderAuth']]);
      assert.ok(wh[0].credentials.httpHeaderAuth.id && wh[0].credentials.httpHeaderAuth.name);
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
    for (const [k, noms] of [['cloturer', [N_C.decisions]], ['emettre', [N_E.decisions, N_E.relister]]]) {
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
  test('noms de nœuds de la clôture = ceux du consommateur gelé (ROLES.cloture)', () => {
    const noms = JSON.parse(lireExport('cloturer')).nodes.map((n) => n.name);
    for (const n of [P.ROLES.cloture.entree, P.ROLES.cloture.ecriture, P.ROLES.cloture.sortie]) assert.ok(noms.includes(n), n);
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
// Confirmation au CONTRAT (P2) : fichier decision-fonda/v1 construit selon §21.1 (empreintes PÉDAGOGIQUES
// du lot source et du lot filtré, sélection dans l'ordre du candidat, hash_formulaire du §21.1) écrit dans
// decisions/ + exécution au format du consommateur gelé. hash_formulaire : aucun schéma canonique de
// tableau hétérogène n'existe encore (P2 le fixera, le harnais suivra) ; JSON.stringify du tableau ici.
async function decisionPage(setId, generation, nonce, { ecarter = [], candidat }) {
  const lot = lotSource(setId);
  const choix = lot.cartes.map((c) => [c.item_id, ecarter.includes(c.item_id) ? 'ecarter' : 'garder']);
  const selection = choix.filter((x) => x[1] === 'garder').map((x) => x[0]);
  const ecartees = choix.filter((x) => x[1] === 'ecarter').map((x) => x[0]);
  const empreinte = await Cat.calculerEmpreinte(lot, SHA);
  const rel = candidat.relecture;
  const expirePage = new Date(Math.min(Date.now() + 3600000, Date.parse(rel.expire_le))).toISOString();
  const hash = `sha256:${sha(Buffer.from(JSON.stringify(['fonda-select-form/v1', setId, generation, empreinte, rel.moteur.version, rel.moteur.sha256, expirePage, nonce, 'accepter', choix]), 'utf8'))}`;
  return { schema: 'decision-fonda/v1', set_id: setId, generation, nonce, recu_le: new Date().toISOString(),
    coeur: { action: 'accepter', selection, ecartees, empreinte_relue: empreinte, empreinte_publiee: await Cat.calculerEmpreinte(SC.lotPublie(lot, { selection }), SHA), moteur: rel.moteur },
    lot_relu: { set_id: setId, empreinte_complete: L.empreinteComplete(lot), cartes: choix.map(([item_id, c]) => ({ item_id, choix: c })) }, hash_formulaire: hash };
}
async function confirmer(d, setId, generation, { nonce = crypto.randomBytes(16).toString('hex'), muter, ecarter } = {}) {
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
      const cf = await confirmer(d, SET, 1, { muter }); await pause();
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
    d.o.incomplet = (q) => q.includes(`'${DEC}'`); // Drive déclare la recherche incomplète APRÈS l'émission
    const cf = await confirmer(d, SET, 1); await pause();
    const c = await cloturer(d, { set_id: SET });
    const s = sortieDe(c.r, N_C.sortie);
    assert.deepEqual([s.incomplete_search, s.nb_decisions_listees], [true, 1]);
    const k = await evaluer(d, SET, [c], [cf]);
    assert.equal(k.liste.incompleteSearch, true, 'le signataire voit la même recherche incomplète');
    assert.deepEqual(issues(k, 'abandon'), [], texte(k)); assert.deepEqual(issues(k, 'incident'), [], texte(k));
    assert.deepEqual(issues(k, 'temporaire').map((x) => x.raison).sort(), ['clôture technique : recherche Drive incomplète sans levée explicite (§10 C)', 'recherche Drive incomplète (decisions/) sans levée explicite'].sort());
    assert.deepEqual(k.r.diagnostic, { nb_decisions_listees: 1, decompte_signataire: 1 });
  });
  test('décision arrivée APRÈS la clôture : vue par le signataire, non comptée par le producteur -> temporaire (nouvelle clôture), jamais d\'abandon', async () => {
    const { d } = await lotEmis();
    const c = await cloturer(d, { set_id: SET }); await pause();
    const cf = await confirmer(d, SET, 1);
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
    d.crochets.apresListe = { si: (q) => q.includes(`'${DEC}'`), f: async () => { cf = await confirmer(d, SET, 1); } };
    const c = await cloturer(d, { set_id: SET });
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
    const cf = await confirmer(d, SET, 2); await pause();
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

describe('9. courses (D1, D2) : DEUX piliers — signataire + un seul écrivain CLI ; détection AVANT écriture (porteuse), APRÈS = +1 (au mieux)', () => {
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
    const cf = await confirmer(d, SET, 2); await pause();
    assert.deepEqual((await evaluer(d, SET, [await cloturer(d, { set_id: SET })], [cf])).constats, []);
  });
  test('D2, fenêtre résiduelle (au mieux) : réémission B glissée APRÈS le contrôle de version de A -> A détecte (version après ≠ avant + 1), aucun courriel de A ; seul le lien de B est parti, sous une clé désormais morte : DISPONIBILITÉ, pas intégrité', async () => {
    const d = mondeAvecLot();
    assert.equal((await emettre(d)).status, 'success');
    const K3 = 'ef'.repeat(32);
    let eB;
    d.crochets.avantPatch = async () => { eB = await emettre(d, { k: K3 }); };
    const eA = await emettre(d, { k: K2 });
    assert.equal(eB.status, 'success', eB.erreur);
    assert.equal(eA.status, 'error'); assert.equal(eA.noeudErreur, N_E.verifier); assert.match(eA.erreur, /écriture concurrente détectée/);
    assert.equal(d.envois.length, 2, 'aucun courriel de A'); assert.ok(!d.envois.some((m) => m.includes(K2)), 'la clé stockée (A) n\'a jamais été envoyée');
    assert.equal(candidatDe(d).relecture.cle_sha256, sha(Buffer.from(K2, 'utf8')), 'le lien de B ne correspond plus à cle_sha256 : lot inconfirmable (refus C3 en P2), nouvelle réémission ou abandon');
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
