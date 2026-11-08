// Tests du parcours PAGE (CDC relecture §21, r10.9) : rattacherPage (E1–E12, résultat
// discriminé, fusion), evaluerPage (R1–R6 symétriques, complétude, E12 ↔ candidat lu, rejet
// total), verifierTxt (§21.7), identité Drive non énumérable (§21.8). Fixtures synthétiques
// anonymes (fonda/scripts/fixtures/execution-{confirmation,cloture}.json).
// Usage : node --test fonda/scripts/rattachement-page.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const L = require('./liaison-generation.js');
const Canonique = require('../engine/canonique.js');
const SC = require('./signer-cloture.js');
const P = require('./rattachement-page.js');
const A = require('./adaptateurs-page.js');
const FC = require('./fixtures/execution-confirmation.json');
const FL = require('./fixtures/execution-cloture.json');

const copie = (o) => JSON.parse(JSON.stringify(o));
const obsDe = (b) => ({ id: String(b.id), workflowId: b.workflowId, status: b.status, startedAt: b.startedAt, stoppedAt: b.stoppedAt });
const rattacher = (b, role, mut) => { const d = copie(b); if (mut) mut(d); return P.rattacherPage(d, { role, workflowId: b.workflowId, observation: obsDe(b) }); };
const sortieC = (d) => d.data.resultData.runData['FONDA Sortie confirmation'][0].data.main[0][0].json;
const entreeC = (d) => d.data.resultData.runData['FONDA Entree confirmation'][0].data.main[0][0].json;
const sortieL = (d) => d.data.resultData.runData['FONDA Sortie cloture'][0].data.main[0][0].json;
const estIncident = (r) => r.nature === 'anomalie' && r.niveau === 'incident';
const estAbandon = (r) => r.nature === 'anomalie' && r.niveau === 'abandon';

describe('rattacherPage — résultat discriminé, jamais null (§21.2)', () => {
  test('decision « creee » nominale : tous les champs, observation FUSIONNÉE', () => {
    const r = rattacher(FC.decision_creee, 'confirmation');
    assert.equal(r.nature, 'decision');
    assert.deepEqual([r.set_id, r.nonce, r.generation, r.decision_fichier_id, r.decision_sha256, r.ecriture], [FC.set_id, FC.nonce, 1, 'drv-decision-1', FC.decision_sha256, 'creee']);
    assert.deepEqual(r.obs, obsDe(FC.decision_creee));
  });
  test('decision « existante » : sans nœud d\'écriture', () => {
    const r = rattacher(FC.decision_creee, 'confirmation', (d) => { delete d.data.resultData.runData['FONDA Ecrire decision']; sortieC(d).ecriture = 'existante'; });
    assert.equal(r.nature, 'decision');
    assert.equal(r.ecriture, 'existante');
  });
  test('E1 : INDISPONIBLE -> indisponible ; null -> incident', () => {
    assert.deepEqual(P.rattacherPage(L.INDISPONIBLE, { role: 'confirmation', workflowId: 'wfConf', observation: obsDe(FC.decision_creee) }), { nature: 'indisponible' });
    assert.ok(estIncident(P.rattacherPage(null, { role: 'confirmation', workflowId: 'wfConf', observation: obsDe(FC.decision_creee) })));
  });
  const incidents = [
    ['E2 fusion : identifiant du détail différent', (d) => { d.id = '999'; }],
    ['E2 fusion : statuts terminaux contradictoires', (d) => { d.status = 'error'; }, (o) => o],
    ['E2 fusion : dates contradictoires', (d) => { d.startedAt = '2026-10-19T16:00:00.000Z'; }],
    ['E2 : autre workflow', (d) => { d.workflowId = 'autre'; }],
    ['E2 : mode manual', (d) => { d.mode = 'manual'; }],
    ['E3 : workflowData absent (runData exploitable)', (d) => { delete d.workflowData; }],
    ['E3 : pinData non vide', (d) => { d.workflowData.pinData = { 'FONDA Sortie confirmation': [{}] }; }],
    ['E5 : deux items en sortie', (d) => { d.data.resultData.runData['FONDA Sortie confirmation'][0].data.main[0].push({ json: {} }); }],
    ['E5 : schema inconnu', (d) => { sortieC(d).schema = 'autre/v1'; }],
    ['E5 : champ en trop dans l\'entrée (jamais k)', (d) => { entreeC(d).k = 'secret'; }],
    ['E6 : lot de sortie ≠ entrée', (d) => { entreeC(d).lot = 'set_fonda_lexique_nI_92'; }],
    ['E6 : nonce de sortie ≠ entrée', (d) => { entreeC(d).nonce = 'f'.repeat(32); }],
    ['E7 : type inconnu', (d) => { sortieC(d).type = 'autre'; }],
    ['E9 : nonce non conforme', (d) => { entreeC(d).nonce = 'n1'; sortieC(d).nonce = 'n1'; }],
  ];
  for (const [nom, mut] of incidents) test(`${nom} -> incident`, () => { assert.ok(estIncident(rattacher(FC.decision_creee, 'confirmation', mut)), nom); });
  test('E4 : exécution en erreur, entrée lisible -> erreur attribuée ; entrée illisible ou crashed sans runData -> incident', () => {
    const o = { ...obsDe(FC.decision_creee), status: 'error' };
    const d = copie(FC.decision_creee); d.status = 'error';
    assert.deepEqual(P.rattacherPage(d, { role: 'confirmation', workflowId: 'wfConf', observation: o }).nature, 'erreur');
    const d2 = copie(d); delete d2.data.resultData.runData['FONDA Entree confirmation'];
    assert.ok(estIncident(P.rattacherPage(d2, { role: 'confirmation', workflowId: 'wfConf', observation: o })));
    const d3 = copie(d); d3.status = 'crashed'; d3.data = {};
    assert.ok(estIncident(P.rattacherPage(d3, { role: 'confirmation', workflowId: 'wfConf', observation: { ...o, status: 'crashed' } })));
  });
  test('rejet C2 (lot et nonce valides en entrée, nuls en sortie) -> rejet ; rejet C3 (C2 passé) -> rejet attribué', () => {
    assert.equal(rattacher(FC.rejet_c2, 'confirmation').nature, 'rejet');
    const r = rattacher(FC.rejet_c2, 'confirmation', (d) => { Object.assign(sortieC(d), { set_id: FC.set_id, nonce: FC.nonce, motif: 'C3' }); });
    assert.equal(r.nature, 'rejet'); assert.equal(r.set_id, FC.set_id);
  });
  test('E6 rejet : set_id et nonce nuls ENSEMBLE ou non nuls ensemble', () => {
    assert.ok(estIncident(rattacher(FC.rejet_c2, 'confirmation', (d) => { sortieC(d).set_id = FC.set_id; })));
  });
  test('E10 : rejet ayant exécuté le nœud d\'écriture -> incident', () => {
    assert.ok(estIncident(rattacher(FC.rejet_c2, 'confirmation', (d) => { d.data.resultData.runData['FONDA Ecrire decision'] = [{ data: { main: [[{ json: {} }]] } }]; })));
  });
  test('E11 : decision incohérente (lot prouvé) -> abandon attribué', () => {
    for (const mut of [
      (d) => { delete d.data.resultData.runData['FONDA Ecrire decision']; }, // creee sans écriture
      (d) => { sortieC(d).ecriture = 'existante'; }, // existante avec écriture
      (d) => { sortieC(d).decision_sha256 = 'x'; },
      (d) => { sortieC(d).generation = 0; },
    ]) { const r = rattacher(FC.decision_creee, 'confirmation', mut); assert.ok(estAbandon(r)); assert.equal(r.set_id, FC.set_id); }
  });
  test('conflit -> conflit (sans écriture)', () => {
    const r = rattacher(FC.decision_creee, 'confirmation', (d) => { delete d.data.resultData.runData['FONDA Ecrire decision']; Object.assign(sortieC(d), { type: 'conflit', ecriture: null }); });
    assert.equal(r.nature, 'conflit');
  });
  test('clôture nominale ; entrée {set_id} distincte ; E12 incohérente -> abandon ; set_id ≠ entrée -> incident', () => {
    const r = rattacher(FL.cloture, 'cloture');
    assert.equal(r.nature, 'cloture');
    assert.deepEqual([r.set_id, r.clos_le, r.candidat_fichier_id, r.incomplete_search], [FL.set_id, '2026-10-20T07:59:00.000Z', 'drv-candidat', false]);
    assert.ok(estAbandon(rattacher(FL.cloture, 'cloture', (d) => { sortieL(d).clos_le = 'hier'; })));
    assert.ok(estIncident(rattacher(FL.cloture, 'cloture', (d) => { sortieL(d).set_id = 'set_fonda_lexique_nI_92'; })));
    const o = { ...obsDe(FL.cloture), status: 'error' }; const d = copie(FL.cloture); d.status = 'error';
    assert.equal(P.rattacherPage(d, { role: 'cloture', workflowId: 'wfClot', observation: o }).nature, 'erreur');
  });
});

// ── evaluerPage : données minimales, rattachement synthétique au contrat discriminé ──
const SET = 'set_fonda_comprendre-consigne_nI_92';
const N1 = 'a'.repeat(32);
const decision = (nonce, o = {}) => ({ schema: 'decision-fonda/v1', set_id: SET, generation: 1, nonce, recu_le: '2026-10-19T17:00:01.000Z', coeur: { action: 'accepter', selection: ['it01'], ecartees: [], empreinte_relue: `sha256:${'1'.repeat(64)}`, empreinte_publiee: `sha256:${'2'.repeat(64)}`, moteur: { version: 'v1', sha256: 'm' } }, lot_relu: { set_id: SET, empreinte_complete: `sha256:${'3'.repeat(64)}`, cartes: [{ item_id: 'it01', choix: 'garder' }] }, hash_formulaire: 'h', ...o });
function cas(mut) {
  const d1 = decision(N1);
  const x = { id: '10', workflowId: 'wfConf', status: 'success', startedAt: '2026-10-19T17:00:00.000Z', stoppedAt: '2026-10-19T17:00:02.000Z' };
  const c = { id: '20', workflowId: 'wfClot', status: 'success', startedAt: '2026-10-20T07:58:00.000Z', stoppedAt: '2026-10-20T08:00:00.000Z' };
  const env = A.avecIdentite({ schema: 'candidat-fonda/v1', lot: { set_id: SET }, relecture: { statut: 'clos', generation_cle: 1, cree_le: '2026-10-18T08:00:00.000Z', clos_le: '2026-10-20T07:59:00.000Z', relecteur_attribue: 'justine', moteur: null } }, { id: 'drv-cand', nom: 'c', modifie_le: 'x' });
  const t = {
    resultats: {
      10: { nature: 'decision', set_id: SET, nonce: N1, generation: 1, decision_fichier_id: 'drv-1', decision_sha256: P.empreinteDecision(d1), ecriture: 'creee', obs: x },
      20: { nature: 'cloture', set_id: SET, clos_le: '2026-10-20T07:59:00.000Z', deja_clos: false, candidat_fichier_id: 'drv-cand', nb_decisions_listees: 1, incomplete_search: false, obs: c },
    },
    conf: [x], clot: [c], details: { 10: { id: '10' }, 20: { id: '20' } },
    fichiers: [{ id: 'drv-1', nom: `${SET}-${N1}.json`, modifie_le: '2026-10-19T17:00:01.500Z', properties: { fonda_set_id: SET, fonda_nonce: N1 }, contenu: d1 }],
    incomplete: false, levees: [], env,
  };
  if (mut) mut(t);
  const constats = new L.Constats();
  const groupe = (v, ids) => ({ ok: true, v, details: new Map(ids.map((i) => [i, t.details[i] === undefined ? L.INDISPONIBLE : t.details[i]])) });
  const r = P.evaluerPage({
    setId: SET, candidatEnv: t.candidatKo ? { ok: false } : { ok: true, v: t.env },
    clotures: t.cloturesKo ? { ok: false, partiel: t.clot, details: new Map(t.clot.map((e) => [e.id, t.details[e.id] === undefined ? L.INDISPONIBLE : t.details[e.id]])) } : groupe(t.clot, t.clot.map((e) => e.id)),
    confirmations: groupe(t.conf, t.conf.map((e) => e.id)),
    listeDecisions: { ok: true, v: { incompleteSearch: t.incomplete, fichiers: t.fichiers, ...(t.erreurs ? { erreurs: t.erreurs, complet: false } : {}) } },
    rattachement: (detail, { observation }) => (detail === L.INDISPONIBLE ? { nature: 'indisponible' } : t.resultats[observation.id]),
    levees: t.levees, constats, sortie: null, relecteur: null, empreintes: null, listingDebut: '2026-10-20T09:00:00.000Z', registre: t.registre || [],
  });
  return { r, constats: constats.liste };
}
const texteConstats = (k) => JSON.stringify(k.constats);
const aConstat = (k, issue, motif) => assert.ok(k.constats.some((c) => c.issue === issue && motif.test(c.raison)), `${issue} ${motif} absent de ${texteConstats(k)}`);
// Le moteur du candidat synthétique (null) produit toujours un constat « moteur … registre » : ignoré ici.
const sansConstat = (k, issue) => assert.ok(!k.constats.some((c) => c.issue === issue && !/moteur/.test(c.raison)), texteConstats(k));

describe('evaluerPage — R1–R6 symétriques, complétude, E12, rejet total (§21.1, §21.2)', () => {
  test('cas nominal : aucun constat bloquant (hors moteur synthétique), derniere et duLot = observations fusionnées', () => {
    const k = cas();
    assert.equal(k.r.decisions.length, 1);
    assert.equal(k.r.derniere.id, '20');
    assert.deepEqual(k.r.duLot.map((e) => [e.x.id, e.nonce]), [['10', N1]]);
    sansConstat(k, 'incident'); sansConstat(k, 'temporaire');
  });
  test('R1 : fichier présent mais empreinte ≠ consignée -> abandon (substitution observée)', () => {
    aConstat(cas((t) => { t.fichiers[0].contenu = decision(N1, { recu_le: '2026-10-19T17:00:01.500Z' }); }), 'abandon', /substituée/);
  });
  test('R1 : fichier absent, listing COMPLET -> abandon ; listing incomplet (levée ou non) -> temporaire, pas d\'abandon', () => {
    aConstat(cas((t) => { t.fichiers = []; }), 'abandon', /absente de Drive/);
    const k = cas((t) => { t.fichiers = []; t.incomplete = true; t.levees = [{ type: 'recherche_incomplete', constat: 'x' }]; });
    aConstat(k, 'temporaire', /listing incomplet/); assert.ok(!/absente de Drive/.test(texteConstats(k)));
  });
  test('cas complémentaire : listing incomplet + levée + tous les tuples concordent -> poursuite (aucun constat sur R1)', () => {
    const k = cas((t) => { t.incomplete = true; t.levees = [{ type: 'recherche_incomplete', constat: 'x' }]; });
    sansConstat(k, 'temporaire'); sansConstat(k, 'abandon');
  });
  test('R2 : fichier non désigné, examen COMPLET -> abandon ; détail d\'une confirmation indisponible -> temporaire', () => {
    const autre = (t) => { const d = decision('b'.repeat(32)); t.fichiers.push({ id: 'drv-2', nom: `${SET}-${'b'.repeat(32)}.json`, modifie_le: '2026-10-19T17:00:01.500Z', properties: { fonda_set_id: SET, fonda_nonce: 'b'.repeat(32) }, contenu: d }); };
    aConstat(cas(autre), 'abandon', /sans exécution correspondante/);
    const k = cas((t) => { autre(t); t.conf.push({ id: '11', workflowId: 'wfConf', status: 'success', startedAt: '2026-10-19T17:00:00.000Z', stoppedAt: '2026-10-19T17:00:02.000Z' }); });
    aConstat(k, 'temporaire', /provenance non établie/); assert.ok(!/sans exécution correspondante/.test(texteConstats(k)));
  });
  test('R2 : désignation par IDENTIFIANT (même nonce, autre id = doublon physique) -> abandon', () => {
    aConstat(cas((t) => { t.fichiers.push({ ...copie(t.fichiers[0]), id: 'drv-1bis' }); }), 'abandon', /sans exécution correspondante/);
  });
  test('R3 : resoumissions du même nonce non identiques -> abandon ; identiques (une creee, une existante) -> admis', () => {
    aConstat(cas((t) => { const x2 = { ...t.conf[0], id: '12' }; t.conf.push(x2); t.details[12] = { id: '12' }; t.resultats[12] = { ...t.resultats[10], decision_fichier_id: 'drv-autre', obs: x2 }; }), 'abandon', /R3/);
    const k = cas((t) => { const x2 = { ...t.conf[0], id: '12' }; t.conf.push(x2); t.details[12] = { id: '12' }; t.resultats[12] = { ...t.resultats[10], ecriture: 'existante', obs: x2 }; });
    sansConstat(k, 'abandon');
  });
  test('R6 : generation ≠ generation_cle (exécution ou fichier) -> abandon', () => {
    aConstat(cas((t) => { t.resultats[10].generation = 2; }), 'abandon', /R6/);
    aConstat(cas((t) => { t.env.relecture.generation_cle = 2; }), 'abandon', /R6/);
  });
  test('E12 : candidat_fichier_id ≠ identité lue, clos_le ≠ candidat -> abandon ; incomplete_search sans levée -> temporaire', () => {
    aConstat(cas((t) => { t.resultats[20].candidat_fichier_id = 'autre'; }), 'abandon', /candidat_fichier_id/);
    aConstat(cas((t) => { t.resultats[20].clos_le = '2026-10-20T07:59:30.000Z'; }), 'abandon', /clos_le/);
    aConstat(cas((t) => { t.resultats[20].incomplete_search = true; }), 'temporaire', /§10 C/);
  });
  test('identité Drive absente (copie de l\'enveloppe) -> incident', () => {
    aConstat(cas((t) => { t.env = copie(t.env); }), 'incident', /\.drive/);
  });
  test('rejet sans effet ; erreur ou conflit du lot -> abandon', () => {
    const k = cas((t) => { const x = { ...t.conf[0], id: '13' }; t.conf.push(x); t.details[13] = {}; t.resultats[13] = { nature: 'rejet', set_id: null, motif: 'C2', obs: x }; });
    sansConstat(k, 'abandon'); sansConstat(k, 'incident');
    aConstat(cas((t) => { t.resultats[10] = { nature: 'erreur', set_id: SET, obs: t.conf[0] }; }), 'abandon', /blocage dur/);
    aConstat(cas((t) => { t.resultats[10] = { nature: 'conflit', set_id: SET, obs: t.conf[0] }; }), 'abandon', /conflit/);
  });
  test('« Tout rejeter » : empreinte_publiee ≠ empreinte du lot source -> abandon (§21.1)', () => {
    const rejet = (pub) => (t) => {
      const d = decision(N1, { coeur: { ...decision(N1).coeur, action: 'rejeter', selection: [], ecartees: ['it01'], empreinte_publiee: pub }, lot_relu: { ...decision(N1).lot_relu, cartes: [{ item_id: 'it01', choix: 'ecarter' }] } });
      t.fichiers[0].contenu = d; t.resultats[10].decision_sha256 = P.empreinteDecision(d);
    };
    aConstat(cas(rejet(`sha256:${'2'.repeat(64)}`)), 'abandon', /Tout rejeter/);
    assert.ok(!/Tout rejeter/.test(texteConstats(cas(rejet(`sha256:${'1'.repeat(64)}`)))));
  });
});

describe('identité Drive non énumérable et verifierTxt (§21.7, §21.8)', () => {
  test('.drive : ignorée par JSON, REFUSÉE par canonique.js, PERDUE par copie ; la projection explicite est canonisable', () => {
    const env = A.avecIdentite({ a: 1 }, { id: 'drv' });
    assert.equal(env.drive.id, 'drv');
    assert.equal(JSON.stringify(env), '{"a":1}');
    assert.equal({ ...env }.drive, undefined);
    assert.equal(JSON.parse(JSON.stringify(env)).drive, undefined);
    const d = decision(N1);
    assert.doesNotThrow(() => Canonique.octetsContrat('decision-fonda/v1', d));
    assert.throws(() => Canonique.octetsContrat('decision-fonda/v1', A.avecIdentite(copie(d), { id: 'x' })), /drive/);
  });
  test('verifierTxt : identique -> ok ; octets différents ou fichier illisible -> Refus « local »', () => {
    const fs = { lire: (p) => { if (p === 'absent') throw new Error('absent'); return Buffer.from('recap\n'); } };
    assert.doesNotThrow(() => P.verifierTxt(fs, 'a.txt', 'recap\n'));
    for (const [chemin, attendu] of [['a.txt', 'recap modifié\n'], ['absent', 'recap\n']]) {
      assert.throws(() => P.verifierTxt(fs, chemin, attendu), (e) => e instanceof SC.Refus && e.issue === 'local');
    }
  });
});

// ═══ Passe de correction P1 (relecture Codex) : chaque correction verrouillée ═══
const autreLot = 'set_fonda_lexique_nI_92';
describe('correction P1 — tuple complet, identité physique, R6 direct, clôtures prouvées, états du candidat, lectures partielles', () => {
  test('point 0 : exécution nonce B, fichier nonce A, même id et même empreinte -> abandon (tuple complet, jamais sur la foi de la sortie)', () => {
    const k = cas((t) => { t.resultats[10].nonce = 'b'.repeat(32); });
    aConstat(k, 'abandon', /substituée/);
    aConstat(k, 'abandon', /sans exécution correspondante/); // R2 : le fichier n'est désigné par aucun tuple complet
  });
  test('point 3 : l\'identifiant consigné contient une décision d\'un AUTRE lot, listing incomplet -> abandon (substitution observée), jamais temporaire', () => {
    const k = cas((t) => { t.incomplete = true; t.levees = [{ type: 'recherche_incomplete', constat: 'x' }]; t.fichiers[0].contenu = { ...decision(N1), set_id: autreLot, lot_relu: { ...decision(N1).lot_relu, set_id: autreLot } }; });
    aConstat(k, 'abandon', /substituée/);
    assert.ok(!/absence non établie/.test(texteConstats(k)));
  });
  test('point 2 : R6 exécution ↔ fichier comparés DIRECTEMENT, même candidat indisponible', () => {
    const k = cas((t) => { t.candidatKo = true; const d = decision(N1, { generation: 2 }); t.fichiers[0].contenu = d; t.resultats[10].decision_sha256 = P.empreinteDecision(d); });
    aConstat(k, 'abandon', /R6/);
  });
  test('point 1 : listing des clôtures en panne, clôture observée avec clos_le ≠ candidat -> abandon (pas seulement temporaire)', () => {
    aConstat(cas((t) => { t.cloturesKo = true; t.resultats[20].clos_le = '2026-10-20T07:59:30.000Z'; }), 'abandon', /clos_le/);
  });
  test('point 1 : détail d\'une clôture plus récente indisponible -> aucune « dernière » retenue, aucun abandon déduit d\'une sélection non prouvée', () => {
    const k = cas((t) => { t.clot.push({ id: '21', workflowId: 'wfClot', status: 'success', startedAt: '2026-10-20T08:10:00.000Z', stoppedAt: '2026-10-20T08:20:00.000Z' }); t.resultats[20].incomplete_search = true; });
    assert.equal(k.r.derniere, null);
    aConstat(k, 'temporaire', /clôture non lu/);
    assert.ok(!/§10 C/.test(texteConstats(k)), 'contrôle propre à la « dernière » non appliqué sur une sélection non prouvée');
  });
  test('point 1 : clôture répétée (deja_clos, même clos_le) -> admise ; clôture d\'un autre lot cohérente -> ignorée', () => {
    const k = cas((t) => {
      const x2 = { id: '22', workflowId: 'wfClot', status: 'success', startedAt: '2026-10-20T08:30:00.000Z', stoppedAt: '2026-10-20T08:31:00.000Z' };
      const x3 = { id: '23', workflowId: 'wfClot', status: 'success', startedAt: '2026-10-20T08:40:00.000Z', stoppedAt: '2026-10-20T08:41:00.000Z' };
      t.clot.push(x2, x3); t.details[22] = {}; t.details[23] = {};
      t.resultats[22] = { ...t.resultats[20], deja_clos: true, obs: x2 };
      t.resultats[23] = { ...t.resultats[20], set_id: autreLot, candidat_fichier_id: 'autre', clos_le: '2026-01-01T00:00:00.000Z', obs: x3 };
    });
    assert.equal(k.r.derniere.id, '22');
    sansConstat(k, 'abandon'); sansConstat(k, 'temporaire'); sansConstat(k, 'incident');
  });
  test('point 5 : en_attente avec clos_le null -> temporaire seul ; abandonne -> abandon ; statut inconnu -> incident', () => {
    const k = cas((t) => { t.env.relecture.statut = 'en_attente'; t.env.relecture.clos_le = null; });
    aConstat(k, 'temporaire', /en_attente/); sansConstat(k, 'incident');
    aConstat(cas((t) => { t.env.relecture.statut = 'abandonne'; }), 'abandon', /abandonne/);
    aConstat(cas((t) => { t.env.relecture.statut = 'bizarre'; }), 'incident', /inconnu/);
  });
  test('point 4 : lecture partielle de decisions/ (erreur conservée) -> temporaire, listing jamais complet ; 403 -> incident', () => {
    const k = cas((t) => { t.fichiers = [{ ...t.fichiers[0], contenu: null, erreur: { statut: 503, message: 'x' } }]; t.erreurs = [{ quoi: 'décision a', statut: 503, message: 'x' }]; });
    aConstat(k, 'temporaire', /lecture partielle/);
    assert.ok(!/absente de Drive|substituée/.test(texteConstats(k)), 'fichier non lu : ni absence ni substitution établies');
    aConstat(cas((t) => { t.erreurs = [{ quoi: 'liste', statut: 403, message: 'interdit' }]; }), 'incident', /lecture partielle/);
  });
  test('point 9 : nb_decisions_listees en diagnostic seulement (aucun constat, même divergent)', () => {
    const k = cas((t) => { t.resultats[20].nb_decisions_listees = 7; });
    assert.deepEqual(k.r.diagnostic, { nb_decisions_listees: 7, decompte_signataire: 1 });
    sansConstat(k, 'abandon'); sansConstat(k, 'temporaire');
  });
  test('§21.10 : réémission en génération 2 entièrement cohérente -> aucun constat', () => {
    const k = cas((t) => { t.env.relecture.generation_cle = 2; const d = decision(N1, { generation: 2 }); t.fichiers[0].contenu = d; t.resultats[10] = { ...t.resultats[10], generation: 2, decision_sha256: P.empreinteDecision(d) }; });
    sansConstat(k, 'abandon'); sansConstat(k, 'incident'); sansConstat(k, 'temporaire');
  });
  test('§21.10 : anomalies isolées de nom et de properties -> abandon', () => {
    aConstat(cas((t) => { t.fichiers[0].nom = 'autre.json'; }), 'abandon', /nom ≠/);
    aConstat(cas((t) => { t.fichiers[0].properties = {}; }), 'abandon', /properties/);
  });
  test('§21.10 : modification après la clôture -> nouvelle clôture technique ; + contenu ≠ consigné -> abandon', () => {
    aConstat(cas((t) => { t.fichiers[0].modifie_le = '2026-10-20T08:00:00.001Z'; }), 'temporaire', /nouvelle clôture technique/);
    const k = cas((t) => { t.fichiers[0].modifie_le = '2026-10-20T08:00:00.001Z'; t.fichiers[0].contenu = decision(N1, { recu_le: '2026-10-20T08:00:00.000Z' }); });
    aConstat(k, 'temporaire', /nouvelle clôture technique/); aConstat(k, 'abandon', /substituée/);
  });
  test('§21.10 : resoumission identique d\'un rejet total (creee + existante) -> aucun constat R3', () => {
    const k = cas((t) => {
      const d = decision(N1, { coeur: { ...decision(N1).coeur, action: 'rejeter', selection: [], ecartees: ['it01'], empreinte_publiee: decision(N1).coeur.empreinte_relue }, lot_relu: { ...decision(N1).lot_relu, cartes: [{ item_id: 'it01', choix: 'ecarter' }] } });
      t.fichiers[0].contenu = d; t.resultats[10].decision_sha256 = P.empreinteDecision(d);
      const x2 = { ...t.conf[0], id: '12' }; t.conf.push(x2); t.details[12] = {}; t.resultats[12] = { ...t.resultats[10], ecriture: 'existante', obs: x2 };
    });
    assert.ok(!/R3|Tout rejeter/.test(texteConstats(k)));
  });
});

describe('correction P1 — rattacherPage : cas §21.10 manquants', () => {
  test('rejet C1 (lot illisible en entrée, tout nul en sortie) -> rejet', () => {
    const r = rattacher(FC.rejet_c2, 'confirmation', (d) => { entreeC(d).lot = null; entreeC(d).nonce = null; sortieC(d).motif = 'C1'; });
    assert.equal(r.nature, 'rejet'); assert.equal(r.set_id, null);
  });
  test('arrêt au timeout (canceled), entrée lisible -> erreur attribuée au lot', () => {
    const d = copie(FC.decision_creee); d.status = 'canceled';
    assert.equal(P.rattacherPage(d, { role: 'confirmation', workflowId: 'wfConf', observation: { ...obsDe(FC.decision_creee), status: 'canceled' } }).nature, 'erreur');
  });
  test('retour terminal -> running dans le détail -> incident (fusion)', () => {
    assert.ok(estIncident(rattacher(FC.decision_creee, 'confirmation', (d) => { d.status = 'running'; d.stoppedAt = null; })));
  });
  test('clôture répétée (deja_clos) -> cloture ; clôture en erreur à entrée illisible -> incident', () => {
    const r = rattacher(FL.cloture, 'cloture', (d) => { sortieL(d).deja_clos = true; delete d.data.resultData.runData['FONDA Ecrire candidat clos']; });
    assert.equal(r.nature, 'cloture'); assert.equal(r.deja_clos, true);
    const d = copie(FL.cloture); d.status = 'error'; delete d.data.resultData.runData['FONDA Entree cloture'];
    assert.ok(estIncident(P.rattacherPage(d, { role: 'cloture', workflowId: 'wfClot', observation: { ...obsDe(FL.cloture), status: 'error' } })));
  });
});

describe('correction P1 (2e passe) — cohérence mutuelle des clôtures, abandon avant clôture', () => {
  test('item 3 : candidat « abandonne » avec clos_le null -> UN SEUL constat : abandon, zéro incident', () => {
    const k = cas((t) => {
      t.env.relecture.statut = 'abandonne'; t.env.relecture.clos_le = null;
      t.env.relecture.moteur = { version: 'v1', sha256: 'm' }; t.registre = [{ version: 'v1', sha256: 'm' }];
    });
    assert.deepEqual(k.constats.map((c) => c.issue), ['abandon'], texteConstats(k));
  });
  test('item 2 : deux clôtures du lot aux clos_le différents, candidat indisponible -> abandon (sans le candidat)', () => {
    const k = cas((t) => {
      t.candidatKo = true;
      const x2 = { id: '26', workflowId: 'wfClot', status: 'success', startedAt: '2026-10-20T08:30:00.000Z', stoppedAt: '2026-10-20T08:31:00.000Z' };
      t.clot.push(x2); t.details[26] = {}; t.resultats[26] = { ...t.resultats[20], clos_le: '2026-10-20T08:29:00.000Z', obs: x2 };
    });
    aConstat(k, 'abandon', /contradictoires entre elles \(clos_le/);
  });
  test('item 2 : candidat_fichier_id différents entre clôtures du lot, listing des clôtures en panne -> abandon', () => {
    const k = cas((t) => {
      t.candidatKo = true; t.cloturesKo = true;
      const x2 = { id: '27', workflowId: 'wfClot', status: 'success', startedAt: '2026-10-20T08:30:00.000Z', stoppedAt: '2026-10-20T08:31:00.000Z' };
      t.clot.push(x2); t.details[27] = {}; t.resultats[27] = { ...t.resultats[20], candidat_fichier_id: 'drv-autre', obs: x2 };
    });
    aConstat(k, 'abandon', /contradictoires entre elles \(candidat_fichier_id/);
  });
});

