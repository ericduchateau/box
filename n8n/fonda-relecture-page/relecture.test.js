// Harnais P3 (CDC relecture §21.0, §21.1, §21.5, §21.10) — workflows « FONDA - Emettre relecture » et
// « FONDA - Cloturer relecture ». Aucun réseau : simulateur n8n (fonda-generation-ia/simulateur.js,
// réutilisé SANS modification), Drive, GitHub, Data Table et Gmail simulés.
//   1. octet-identité INTERNE : export commité == construction depuis le dépôt (P2/P3 ; dépôt <-> live à P4) ;
//   2. aucun littéral secret ni donnée personnelle dans les exports (« jamais dans le dépôt », mécanique) ;
//   3. CHAÎNE RÉELLE producteur -> consommateur GELÉ : le candidat produit par Emettre et la sortie
//      cloture-fonda/v1 produite par Cloturer traversent le VRAI rattacherPage puis le VRAI evaluerPage ;
//      l'E12 lie les deux (candidat_fichier_id == candidat.drive.id ET clos_le == relecture.clos_le) ;
//   4. cas clôture du §21.10, toujours par la chaîne réelle (aucun résultat fabriqué).
// Seuls stubs hors simulateur : le nœud Crypto (non simulé) est remplacé, DANS LA COPIE de test du
// workflow, par un nœud Code rendant une clé k fixe ; aucune autre transformation.
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

const RACINE = path.join(__dirname, '..', '..');
const EXPORTS = { cloturer: 'box-fonda-cloturer-relecture.json', emettre: 'box-fonda-emettre-relecture.json' };
const lireExport = (k) => fs.readFileSync(path.join(__dirname, EXPORTS[k]));
const copie = (o) => JSON.parse(JSON.stringify(o));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const N_C = B.NOEUDS_CLOTURER; const N_E = B.NOEUDS_EMETTRE;

describe('1. octet-identité interne et 2. aucun secret ni donnée personnelle', () => {
  for (const [k, construire] of [['cloturer', B.construireCloturer], ['emettre', B.construireEmettre]]) {
    test(`${EXPORTS[k]} == construction depuis le dépôt, octet pour octet`, () => {
      assert.ok(lireExport(k).equals(Buffer.from(`${JSON.stringify(construire(), null, 2)}\n`, 'utf8')), `${EXPORTS[k]} ≠ construction : regénérer par construire-relecture.js --${k}`);
    });
    test(`${EXPORTS[k]} : aucun secret ni PII (adresse, clé, jeton, valeur de credential)`, () => {
      const t = lireExport(k).toString('utf8');
      assert.doesNotMatch(t, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, 'adresse électronique');
      assert.doesNotMatch(t, /BEGIN [A-Z ]*PRIVATE KEY|sk-ant-|Bearer [A-Za-z0-9]/, 'clé ou jeton');
      assert.doesNotMatch(t, /\b[0-9a-f]{64}\b/, 'littéral hexadécimal de 64 caractères (clé k, HMAC, empreinte de secret)');
      const wf = JSON.parse(t);
      for (const n of wf.nodes) {
        if (n.credentials) for (const c of Object.values(n.credentials)) assert.deepEqual(Object.keys(c).sort(), ['id', 'name'], `${n.name} : credential = référence (id, nom) seulement`);
        assert.equal(n.retryOnFail === true, false, `${n.name} : retryOnFail interdit`);
      }
      assert.equal(wf.pinData, undefined, 'aucune donnée épinglée');
      assert.equal(wf.active, undefined, 'export sans état actif (créé INACTIF en P4)');
    });
  }
  test('noms de nœuds de la clôture = ceux du consommateur gelé (ROLES.cloture)', () => {
    const noms = JSON.parse(lireExport('cloturer')).nodes.map((n) => n.name);
    for (const n of [P.ROLES.cloture.entree, P.ROLES.cloture.ecriture, P.ROLES.cloture.sortie]) assert.ok(noms.includes(n), n);
    assert.equal(JSON.parse(lireExport('cloturer')).nodes.find((n) => n.type === 'n8n-nodes-base.webhook').parameters.httpMethod, 'POST');
  });
});

// ── Monde simulé : Drive (dossiers candidats/, relecture/, decisions/), GitHub au commit, Data Table, Gmail ──
const SET = 'set_fonda_comprendre-consigne_nI_92';
const COMMIT = 'c0ffee'.padEnd(40, '0');
const K = 'ab'.repeat(32);
const OCT_REF = fs.readFileSync(path.join(RACINE, 'fonda/data/referentiel.json'));
const OCT_MOT = fs.readFileSync(path.join(RACINE, 'fonda/engine/moteurs.json'));
const REF_VERSION = `sha256:${sha(OCT_REF)}`;
const MOTEUR = (() => { const r = JSON.parse(OCT_MOT.toString('utf8')); return { version: r[r.length - 1].version, sha256: r[r.length - 1].sha256 }; })();
const lotSource = (setId) => {
  const l = JSON.parse(fs.readFileSync(path.join(RACINE, 'fonda/data/lots/set_fonda_comprendre-consigne_nI_01.json'), 'utf8'));
  l.set_id = setId; l.revue_carte_par_carte = false; l.cartes.forEach((c) => { c.set_id = setId; });
  return l;
};
const contents = (chemin, octets) => ({ type: 'file', encoding: 'base64', path: chemin, size: octets.length, sha: 'blob', content: octets.toString('base64').replace(/(.{60})/g, '$1\n') + '\n' });

function monde() {
  const fichiers = new Map(); let n = 0;
  const ajouter = (dossier, nom, contenu, properties = {}) => { const id = `drv-${++n}`; fichiers.set(id, { id, dossier, nom, contenu, properties, trashed: false }); return id; };
  const dans = (dossier) => [...fichiers.values()].filter((f) => f.dossier === dossier);
  return { fichiers, ajouter, dans, envois: [] };
}
const avecK = (wf) => { const w = copie(wf); const i = w.nodes.findIndex((x) => x.name === N_E.cle); w.nodes[i] = { ...w.nodes[i], type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: `return [{ json: { k: ${JSON.stringify(K)} } }];` } }; return w; };
const nomDe = (q, motif) => { const m = new RegExp(motif).exec(q); return m && m[1]; };

async function emettre(m, setId = SET, o = {}) {
  const wf = avecK(JSON.parse(lireExport('emettre')));
  return executerGraphe(wf, {
    corps: { set_id: setId, journal_commit: COMMIT, referentiel_version: REF_VERSION, moteur: MOTEUR },
    reponses: {
      [N_E.referentiel]: async () => ({ statusCode: 200, body: contents('fonda/data/referentiel.json', OCT_REF) }),
      [N_E.moteurs]: async () => ({ statusCode: 200, body: contents('fonda/engine/moteurs.json', OCT_MOT) }),
      [N_E.chercherLot]: async (q) => { const nom = nomDe(q.queryParameters.parameters[0].value, "name = '([^']+)'"); return { statusCode: 200, body: { files: m.dans(B.CONFIG.dossierCandidats).filter((f) => f.nom === nom).map((f) => ({ id: f.id, name: f.nom })) } }; },
      [N_E.lireLot]: async (q) => ({ statusCode: 200, body: JSON.parse(m.fichiers.get(q.url.split('/').pop()).contenu) }),
      [N_E.existant]: async (q) => { const nom = nomDe(q.queryParameters.parameters[0].value, "name = '([^']+)'"); return { statusCode: 200, body: { files: m.dans(B.CONFIG.dossierRelecture).filter((f) => f.nom === nom).map((f) => ({ id: f.id, name: f.nom })) } }; },
      [N_E.ecrire]: async (q) => {
        const parties = q.body.split('\r\n\r\n'); const meta = JSON.parse(parties[1].split('\r\n')[0]); const contenu = parties[2].slice(0, parties[2].lastIndexOf('\r\n--'));
        const id = m.ajouter(meta.parents[0], meta.name, contenu, meta.properties);
        return { statusCode: 200, body: { id, name: meta.name, parents: meta.parents, properties: meta.properties } };
      },
      [N_E.adresse]: async () => ({ statusCode: 200, body: { data: [{ relecteur_attribue: 'justine', adresse: 'relectrice@exemple.invalid' }] } }),
      [N_E.envoyer]: async (q) => { m.envois.push(JSON.parse(q.jsonBody)); return { statusCode: 200, body: { id: 'msg-1' } }; },
      ...(o.reponses || {}),
    },
  });
}

let horloge = Date.parse('2026-11-08T09:00:00.000Z');
async function cloturer(m, corps, o = {}) {
  const wf = JSON.parse(lireExport('cloturer'));
  const debut = new Date(horloge += 60000).toISOString();
  const r = await executerGraphe(wf, {
    corps,
    reponses: {
      [N_C.chercher]: async (q) => { const nom = nomDe(q.queryParameters.parameters[0].value, "name = '([^']+)'"); return { statusCode: 200, body: { files: m.dans(B.CONFIG.dossierRelecture).filter((f) => f.nom === nom && !f.trashed).map((f) => ({ id: f.id, name: f.nom })) } }; },
      [N_C.lire]: async (q) => ({ statusCode: 200, body: JSON.parse(m.fichiers.get(q.url.split('/').pop()).contenu) }),
      [N_C.ecrire]: async (q) => { const id = q.url.split('/').pop(); m.fichiers.get(id).contenu = q.body; return { statusCode: 200, body: { id, name: m.fichiers.get(id).nom } }; },
      [N_C.relire]: async (q) => ({ statusCode: 200, body: JSON.parse(m.fichiers.get(q.url.split('/').pop()).contenu) }),
      [N_C.decisions]: async (q) => { const setId = nomDe(q.queryParameters.parameters[0].value, "name contains '([^']+)-'"); return { statusCode: 200, body: { files: m.dans(B.CONFIG.dossierDecisions).filter((f) => f.nom.startsWith(`${setId}-`)).map((f) => ({ id: f.id, name: f.nom })), ...(o.incomplet ? { incompleteSearch: true } : {}) } }; },
      ...(o.reponses || {}),
    },
  });
  const fin = new Date(horloge += 1000).toISOString();
  const statut = r.status === 'success' ? 'success' : 'error';
  // Exécution telle que l'API publique la rendrait (métadonnées + données), pour le consommateur gelé.
  const id = String(800 + (++cloturer.n));
  const obs = { id, workflowId: 'wfClot', status: statut, startedAt: debut, stoppedAt: o.stoppedAt || fin };
  return { r, obs, detail: { ...obs, mode: 'webhook', workflowData: { pinData: null }, data: { resultData: { runData: r.runData } } } };
}
cloturer.n = 0;

// Le VRAI consommateur : rattacherPage (rôle cloture) puis evaluerPage, candidat lu « comme lireCandidat ».
function evaluer(m, setId, clotures, { idCandidat = null } = {}) {
  const f = [...m.fichiers.values()].find((x) => x.nom === `${setId}.candidat.json`);
  const env = A.avecIdentite(JSON.parse(f.contenu), { id: idCandidat || f.id, nom: f.nom, modifie_le: '2026-11-08T10:00:00.000Z' });
  const constats = new L.Constats();
  const r = P.evaluerPage({
    setId, candidatEnv: { ok: true, v: env },
    clotures: { ok: true, v: clotures.map((c) => c.obs), details: new Map(clotures.map((c) => [c.obs.id, c.detail])) },
    confirmations: { ok: true, v: [], details: new Map() },
    listeDecisions: { ok: true, v: { incompleteSearch: false, fichiers: [] } },
    rattachement: P.rattacherPage, levees: [], constats, sortie: null, relecteur: null, empreintes: null,
    listingDebut: '2026-11-09T00:00:00.000Z', registre: JSON.parse(OCT_MOT.toString('utf8')),
  });
  return { r, constats: constats.liste, env };
}
const issues = (k, issue) => k.constats.filter((c) => c.issue === issue);
const texte = (k) => JSON.stringify(k.constats);

async function lotEmis() {
  const m = monde();
  m.ajouter(B.CONFIG.dossierCandidats, `${SET}.lot.json`, `${JSON.stringify(lotSource(SET), null, 2)}\n`);
  const e = await emettre(m);
  assert.equal(e.status, 'success', e.erreur);
  return m;
}

describe('3. chaîne RÉELLE Emettre -> Cloturer -> rattacherPage(cloture) -> evaluerPage (consommateur gelé)', () => {
  test('Emettre : candidat-fonda/v1 conforme, SEUL cle_sha256 stocké, relecteur du référentiel archivé, k jamais en sortie', async () => {
    const m = await lotEmis();
    const f = m.dans(B.CONFIG.dossierRelecture)[0];
    const c = JSON.parse(f.contenu);
    assert.equal(c.schema, 'candidat-fonda/v1');
    assert.deepEqual(Object.keys(c.relecture).sort(), ['clos_le', 'cle_sha256', 'cree_le', 'envois', 'expire_le', 'generation_cle', 'moteur', 'referentiel_version', 'relecteur_attribue', 'statut'].sort());
    assert.equal(c.relecture.statut, 'en_attente'); assert.equal(c.relecture.clos_le, null); assert.equal(c.relecture.generation_cle, 1);
    assert.equal(c.relecture.cle_sha256, sha(Buffer.from(K, 'utf8')));
    assert.equal(Date.parse(c.relecture.expire_le) - Date.parse(c.relecture.cree_le), 14 * 86400000);
    assert.equal(c.relecture.relecteur_attribue, 'justine');
    assert.deepEqual(c.relecture.moteur, MOTEUR); assert.equal(c.relecture.referentiel_version, REF_VERSION);
    assert.ok(!f.contenu.includes(K), 'k jamais stockée');
    assert.deepEqual(c.lot, lotSource(SET), 'lot = copie exacte du lot source');
    assert.equal(f.properties.fonda_set_id, SET);
    assert.equal(m.envois.length, 1);
    assert.match(Buffer.from(m.envois[0].raw, 'base64url').toString('utf8'), new RegExp(`\\?lot=${SET}&k=${K}`));
  });
  test('VERROU E12 : candidat d\'Emettre + clôture de Cloturer, VRAI rattacherPage puis VRAI evaluerPage -> lien candidat_fichier_id ET clos_le établi, aucun abandon/incident', async () => {
    const m = await lotEmis();
    const c1 = await cloturer(m, { set_id: SET });
    assert.equal(c1.r.status, 'success', c1.r.erreur);
    const rr = P.rattacherPage(c1.detail, { role: 'cloture', workflowId: 'wfClot', observation: c1.obs });
    assert.equal(rr.nature, 'cloture', JSON.stringify(rr));
    const k = evaluer(m, SET, [c1]);
    assert.equal(k.r.derniere.id, c1.obs.id);
    assert.equal(rr.candidat_fichier_id, k.env.drive.id); assert.equal(rr.clos_le, k.env.relecture.clos_le);
    assert.deepEqual(issues(k, 'abandon'), [], texte(k)); assert.deepEqual(issues(k, 'incident'), [], texte(k));
    assert.ok(!/clôture technique requise|aucune clôture/.test(texte(k)), texte(k));
  });
  test('VERROU E12 (contre-épreuve) : candidat lu avec un AUTRE identifiant Drive -> abandon', async () => {
    const m = await lotEmis();
    const c1 = await cloturer(m, { set_id: SET });
    assert.match(texte(evaluer(m, SET, [c1], { idCandidat: 'drv-autre' })), /candidat_fichier_id ≠ identité Drive/);
  });
  test('VERROU E12 (contre-épreuve) : clos_le du candidat lu ≠ clôture -> abandon', async () => {
    const m = await lotEmis();
    const c1 = await cloturer(m, { set_id: SET });
    const f = m.dans(B.CONFIG.dossierRelecture)[0];
    const c = JSON.parse(f.contenu); c.relecture.clos_le = '2026-01-01T00:00:00.000Z'; f.contenu = JSON.stringify(c);
    assert.match(texte(evaluer(m, SET, [c1])), /clos_le ≠ relecture\.clos_le/);
  });
});

describe('4. cas clôture du §21.10, par la chaîne réelle', () => {
  test('clôture répétée : deja_clos, clos_le INCHANGÉ, nœud d\'écriture NON exécuté ; deux clôtures cohérentes acceptées', async () => {
    const m = await lotEmis();
    const c1 = await cloturer(m, { set_id: SET });
    const c2 = await cloturer(m, { set_id: SET });
    const s2 = c2.r.sorties[N_C.sortie][0].json;
    assert.equal(s2.deja_clos, true);
    assert.equal(s2.clos_le, c1.r.sorties[N_C.sortie][0].json.clos_le);
    assert.ok(!c2.r.runData[N_C.ecrire], 'aucune réécriture');
    const k = evaluer(m, SET, [c1, c2]);
    assert.equal(k.r.derniere.id, c2.obs.id);
    assert.deepEqual(issues(k, 'abandon'), [], texte(k));
  });
  test('clôture d\'un AUTRE lot (cohérente) : rattachée à cet autre lot, sans effet sur le lot examiné', async () => {
    const m = await lotEmis();
    const AUTRE = 'set_fonda_comprendre-consigne_nI_93';
    m.ajouter(B.CONFIG.dossierCandidats, `${AUTRE}.lot.json`, `${JSON.stringify(lotSource(AUTRE), null, 2)}\n`);
    assert.equal((await emettre(m, AUTRE)).status, 'success');
    const c1 = await cloturer(m, { set_id: SET }); const cAutre = await cloturer(m, { set_id: AUTRE });
    assert.equal(P.rattacherPage(cAutre.detail, { role: 'cloture', workflowId: 'wfClot', observation: cAutre.obs }).set_id, AUTRE);
    const k = evaluer(m, SET, [c1, cAutre]);
    assert.equal(k.r.derniere.id, c1.obs.id);
    assert.deepEqual(issues(k, 'abandon'), [], texte(k)); assert.deepEqual(issues(k, 'incident'), [], texte(k));
  });
  test('exécution en ERREUR, entrée lisible (Drive en panne) -> erreur attribuée au lot -> abandon', async () => {
    const m = await lotEmis();
    const c = await cloturer(m, { set_id: SET }, { reponses: { [N_C.chercher]: async () => { throw new Error('Drive injoignable'); } } });
    assert.equal(c.r.status, 'error');
    assert.equal(P.rattacherPage(c.detail, { role: 'cloture', workflowId: 'wfClot', observation: c.obs }).nature, 'erreur');
    assert.match(texte(evaluer(m, SET, [c])), /blocage dur/);
  });
  test('exécution en ERREUR, entrée illisible (set_id absent) -> incident de chaîne', async () => {
    const m = await lotEmis();
    const c = await cloturer(m, { autre: 1 });
    assert.equal(c.r.status, 'error');
    const k = evaluer(m, SET, [c]);
    assert.ok(issues(k, 'incident').length >= 1, texte(k));
  });
  test('deux clôtures du lot à la MÊME date -> abandon (aucun départage arbitraire)', async () => {
    const m = await lotEmis();
    const c1 = await cloturer(m, { set_id: SET }, { stoppedAt: '2026-11-08T12:00:00.000Z' });
    const c2 = await cloturer(m, { set_id: SET }, { stoppedAt: '2026-11-08T12:00:00.000Z' });
    assert.match(texte(evaluer(m, SET, [c1, c2])), /même date/);
  });
  test('listing de decisions/ incomplet (compteur inférieur) -> incomplete_search -> refus temporaire §10 C, jamais un abandon ; compteur en diagnostic', async () => {
    const m = await lotEmis();
    m.ajouter(B.CONFIG.dossierDecisions, `${SET}-${'a'.repeat(32)}.json`, '{}');
    const c = await cloturer(m, { set_id: SET }, { incomplet: true });
    const s = c.r.sorties[N_C.sortie][0].json;
    assert.equal(s.incomplete_search, true); assert.equal(s.nb_decisions_listees, 1);
    const k = evaluer(m, SET, [c]);
    assert.match(texte(k), /§10 C/); assert.ok(!/§10 C[^"]*abandon/.test(texte(k)));
    assert.deepEqual(k.r.diagnostic, { nb_decisions_listees: 1, decompte_signataire: 0 });
  });
  test('candidat « abandonne » : la clôture technique refuse (exécution en erreur attribuée au lot)', async () => {
    const m = await lotEmis();
    const f = m.dans(B.CONFIG.dossierRelecture)[0];
    const cand = JSON.parse(f.contenu); cand.relecture.statut = 'abandonne'; f.contenu = JSON.stringify(cand);
    const c = await cloturer(m, { set_id: SET });
    assert.equal(c.r.status, 'error'); assert.match(c.r.erreur, /abandonne/);
  });
});
