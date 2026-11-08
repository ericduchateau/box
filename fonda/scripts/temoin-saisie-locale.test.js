// TÉMOIN de la saisie locale (CDC relecture §21.8, r10.9 — garantie G1 : le CODE local est
// inchangé, à entrées et environnement identiques). Fichier de CONFIANCE (§15) : sa protection
// est PROCÉDURALE (relecture d'Éric, non délégable) ; l'ancre temoin-ancre.test.js détecte une
// modification accidentelle. Ce témoin est un filet contre les modifications ACCIDENTELLES.
//
//   0. prérequis (échec, jamais sauté) : git, SHA de référence présent, GIT_NO_REPLACE_OBJECTS=1,
//      checkout propre (aucun fichier non suivi sous fonda/, n8n/, .github/) ;
//   1. référence (git show) + PATCH FIGÉ == signer-cloture.js courant, octet pour octet ;
//   2. plein fichier identique (liste §21.8 point 2) + empreinte du fichier local figé ;
//   3. périmètre fermé (chemins de code modifiés depuis la référence ⊆ liste fermée ; aucun
//      changement de type) ;
//   4. différentiel de comportement en PROCESSUS NEUFS (référence extraite par git archive /
//      arbre courant), entrées, aléas et horloge identiques, Module._load intercepté AVANT le
//      chargement de signer-cloture.js : tout chargement de module page fait échouer ;
//   5. borne : une clôture par processus (chaque scénario tourne dans son propre processus).
// La trace de chaque scénario est UNE liste ORDONNÉE des appels aux dépendances ACCÉDÉES PAR PROPRIÉTÉ
// (API, Drive, git/journal, intérim, disque dont realpath, clés, horloge, signataire), affichages et
// questions compris ; une extraction délibérée par descripteur est hors périmètre (patch figé, G1).
// Le même fichier sert d'exécutant de scénario quand TEMOIN_SCENARIO est défini (processus neuf).

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawnSync, execFileSync } = require('child_process');

// (R-a) Référence du code local AVANT P1 — IMMUABLE de P1 à P5 (§21.8). Jamais re-fixée.
const REFERENCE = '9b7550721e03d3ea7b018dce43faa79059558939';
const RACINE = path.resolve(__dirname, '..', '..');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ═══ PATCH FIGÉ (CDC §21.8, texte EXACT) ═══
const SIG_EVALUER = 'function evaluerPage({ setId, candidatEnv, clotures, confirmations, listeDecisions, rattachement, levees, constats, sortie, relecteur, empreintes, listingDebut, registre }) {';
const LIGNE_TXT = (n) => `  if (page) require('./rattachement-page.js').verifierTxt(deps.fs, cheminRecap, \`\${rendu}\\n\\n\${shaInstantane}\\n\`); // CDC §21.7 ${n}`;
const PATCH = [
  { apres: "    listeDecisions = await lire('Drive (decisions/)', () => drive.listerDecisions(setId));", inserer: "    await require('./adaptateurs-page.js').preLireDetails({ api, lire, clotures, confirmations }); // CDC §21.8 P1" },
  { apres: '  verifier34();', inserer: LIGNE_TXT('P2') },
  { apres: '  const inst = verifier34();', inserer: LIGNE_TXT('P3') },
];
const P4 = [SIG_EVALUER, "  return require('./rattachement-page.js').evaluerPage({ setId, candidatEnv, clotures, confirmations, listeDecisions, rattachement, levees, constats, sortie, relecteur, empreintes, listingDebut, registre }); // CDC §21.8 P4", '}'];
function appliquerPatch(texte) {
  const L = texte.split('\n');
  const unique = (t) => { const i = L.indexOf(t); if (i < 0 || L.indexOf(t, i + 1) >= 0) throw new Error(`ancre absente ou dupliquée : ${t}`); return i; };
  for (const { apres, inserer } of PATCH) L.splice(unique(apres) + 1, 0, inserer);
  const d = unique(SIG_EVALUER);
  let f = d + 1; while (f < L.length && L[f] !== '}') f += 1;
  if (f >= L.length) throw new Error('fin de P4 introuvable');
  L.splice(d, f - d + 1, ...P4);
  return L.join('\n');
}

// ═══ Listes (§21.8 points 2 et 3) ═══
const PLEIN_FICHIER = [
  'fonda/scripts/adaptateurs-production.js', 'fonda/scripts/moteurs.js', 'fonda/scripts/verifier-moteurs.js', 'fonda/scripts/publier-lot.js',
  'fonda/scripts/liaison-generation.js', 'fonda/scripts/attestation-signee.js', 'fonda/scripts/interim.js', 'fonda/scripts/referentiel-archive.js',
  'fonda/scripts/champs-canonique.js', 'fonda/engine/canonique.js', 'fonda/engine/catalogue.js', 'fonda/engine/journal-set-ids.js',
  'fonda/engine/moteur-correction-v1.js', 'fonda/engine/moteurs.json',
];
// Empreinte du fichier des cas locaux FIGÉ (fixée en P1, modifiable seulement par décision d'Éric).
const EMPREINTE_LOCAL = 'sha256:cf6d9ede5084b04d21abf3f8dc6d4ef2a702c6ee199bc49708e5f0b8e248bde3';
const LISTE_FERMEE = new Set([
  'fonda/scripts/signer-cloture.js', 'fonda/scripts/rattachement-page.js', 'fonda/scripts/adaptateurs-page.js',
  'fonda/scripts/rattachement-page.test.js', 'fonda/scripts/adaptateurs-page.test.js', 'fonda/scripts/temoin-saisie-locale.test.js',
  'fonda/scripts/temoin-ancre.test.js', 'fonda/scripts/signer-cloture-local.test.js', 'fonda/scripts/signer-cloture.test.js',
  // Décision d'Éric (P1) : SEULE la ligne d'empreinte de signer-cloture.js, forcée par le patch figé.
  'fonda/scripts/orchestrer-lots.test.js',
]);
// orchestrer-lots.test.js (décision d'Éric, P1) : SEULE substitution autorisée = la ligne d'empreinte
// de signer-cloture.js du tripwire + le commentaire qui l'explique ; comparaison OCTET POUR OCTET.
const ORCH = {
  ancre: "// évolution FUTURE de l'un d'eux doit mettre à jour cette liste EXPLICITEMENT (signal de relecture).",
  commentaire: [
    '// P1 (parcours page) : signer-cloture.js est épinglé ici à son état POST-P1 (référence 9b75507 + patch',
    '// figé du CDC §21.8). Le garant autoritaire est le témoin temoin-saisie-locale.test.js (§21.8) ; ce pin',
    '// reste un signal grossier, redondant (défense en profondeur).',
  ],
  avant: "    ['fonda/scripts/signer-cloture.js', '7d12a4d56e4ddb8e8fd21e65b266916cbbff1998d7302975cad9ffedd972956a'],",
  apres: "    ['fonda/scripts/signer-cloture.js', '33b586d6f0cf7d99b4121a06ff252d0c3a1e8144253eb6c0f0e323e727987482'],",
};
function attenduOrchestrateur(texte) {
  const L = texte.split('\n');
  const unique = (t) => { const i = L.indexOf(t); if (i < 0 || L.indexOf(t, i + 1) >= 0) throw new Error(`orchestrer-lots.test.js : ligne absente ou dupliquée : ${t}`); return i; };
  L[unique(ORCH.avant)] = ORCH.apres;
  L.splice(unique(ORCH.ancre) + 1, 0, ...ORCH.commentaire);
  return L.join('\n');
}
const DANS_PERIMETRE = (p) => /^(fonda|n8n)\/.*\.js$/.test(p) || p === 'fonda/engine/moteurs.json' || p.startsWith('.github/workflows/') || p === 'package.json';

const MODULES_PAGE = /[\\/](rattachement-page|adaptateurs-page)\.js$/;

// ═══ Trace ORDONNÉE UNIQUE par Proxy générique (harnais seulement, identique sur les deux arbres) ═══
// PÉRIMÈTRE (§21.8) : tous les appels aux dépendances ACCÉDÉES PAR PROPRIÉTÉ sont tracés (deps et ses
// conteneurs de services api, drive, fs, interim, cles). Une extraction DÉLIBÉRÉE par descripteur
// (Object.getOwnPropertyDescriptor(...).value) sort du périmètre du différentiel — filet contre les
// modifications ACCIDENTELLES — et est couverte par le patch figé (G1).
// Transparence : piège get via Reflect.get, aucune pré-énumération (un accesseur ne se déclenche qu'à
// l'accès réel), seules les fonctions sont enveloppées, wrappers MÉMORISÉS (identité stable), receveur
// d'origine restitué (table Proxy -> cible, y compris sur .call), résultats, erreurs et promesses rendus
// tels quels. Sérialisation déterministe des arguments, SANS appeler aucun accesseur. Types admis :
// null, undefined, booléen, nombre, chaîne (tronquée + empreinte au-delà de 160), BigInt, fonction (sans
// identité), Buffer/Uint8Array (taille + empreinte), Date (ISO), tableau, objet simple (propriétés de
// données ; accesseurs marqués <accesseur>). Map, Set, WeakMap, WeakSet et Promise : marqueur explicite
// <non supporté:Type>. Les AUTRES objets (ex. RegExp) ne sont pas admis : ils se sérialisent comme un objet
// simple (souvent {}), sans marqueur. Aucun n'est utilisé par le parcours local. Préfixes de chemins remplacés.
function serialiser(v, remplacements = [], vus = new WeakSet()) {
  if (v === null || v === undefined || typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (typeof v === 'bigint') return `${v}n`;
  if (typeof v === 'string') {
    let t = v;
    for (const [de, vers] of remplacements) if (de) t = t.split(de).join(vers);
    return JSON.stringify(t.length > 160 ? `${t.slice(0, 80)}…[${t.length}:${sha256(t).slice(0, 16)}]` : t);
  }
  if (typeof v === 'function') return '<fn>';
  if (typeof v !== 'object') return `<${typeof v}>`;
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return `<octets:${v.length}:${sha256(Buffer.from(v)).slice(0, 16)}>`;
  if (v instanceof Date) return `<date:${Number.isNaN(v.getTime()) ? 'invalide' : v.toISOString()}>`;
  if (v instanceof Map || v instanceof Set || v instanceof WeakMap || v instanceof WeakSet || v instanceof Promise) return `<non supporté:${v.constructor.name}>`;
  if (vus.has(v)) return '<cycle>';
  vus.add(v);
  const valeur = (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); return d && 'value' in d ? serialiser(d.value, remplacements, vus) : '<accesseur>'; };
  if (Array.isArray(v)) return `[${Array.from({ length: v.length }, (_, i) => valeur(v, String(i))).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${valeur(v, k)}`).join(',')}}`;
}
function tracer(deps, journal, remplacements = []) {
  const CONTENEURS = new Set(['api', 'drive', 'fs', 'interim', 'cles']);
  const cibles = new WeakMap(); // Proxy -> cible d'origine (receveur restitué)
  const parCible = new WeakMap(); // cible -> Map(nom -> wrapper) (identité stable)
  const enveloppeFonction = (fn, chemin) => {
    const p = new Proxy(fn, {
      apply(t, ceci, args) {
        journal.push(`${chemin}(${args.map((a) => serialiser(a, remplacements)).join(',')})`);
        return Reflect.apply(t, cibles.has(ceci) ? cibles.get(ceci) : ceci, args);
      },
    });
    cibles.set(p, fn);
    return p;
  };
  const memo = (cible, nom, valeurCourante, fabriquer) => {
    if (!parCible.has(cible)) parCible.set(cible, new Map());
    const m = parCible.get(cible);
    // Wrapper renouvelé dès que la valeur ACTUELLEMENT lue diffère de celle qu'il enveloppe.
    if (!m.has(nom) || m.get(`${nom}\0valeur`) !== valeurCourante) { m.set(nom, fabriquer()); m.set(`${nom}\0valeur`, valeurCourante); }
    return m.get(nom);
  };
  const conteneur = (objet, chemin) => {
    const p = new Proxy(objet, {
      get(t, k, r) {
        const v = Reflect.get(t, k, r);
        return typeof v === 'function' ? memo(t, String(k), v, () => enveloppeFonction(v, `${chemin}.${String(k)}`)) : v;
      },
    });
    cibles.set(p, objet);
    return p;
  };
  const racine = new Proxy(deps, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (typeof v === 'function') return memo(t, String(k), v, () => enveloppeFonction(v, `deps.${String(k)}`));
      if (CONTENEURS.has(k) && v && typeof v === 'object') return memo(t, String(k), v, () => conteneur(v, `deps.${String(k)}`));
      return v;
    },
  });
  cibles.set(racine, deps);
  return racine;
}

// ═══════════════════════════════ EXÉCUTANT DE SCÉNARIO ═══════════════════════════════
async function executerScenario() {
  const ARBRE = process.env.TEMOIN_ARBRE;
  const DONNEES = process.env.TEMOIN_DONNEES;
  const NOM = process.env.TEMOIN_SCENARIO;
  const CLE = JSON.parse(fs.readFileSync(process.env.TEMOIN_CLE, 'utf8'));
  // Interception AVANT tout chargement du code sous test.
  const Module = require('module');
  const chargesPage = [];
  const origine = Module._load;
  Module._load = function charger(request, parent, isMain) {
    let r = null;
    try { r = Module._resolveFilename(request, parent, isMain); } catch { /* laissé à l'original */ }
    if (r && MODULES_PAGE.test(r)) chargesPage.push(path.basename(r));
    return origine.apply(this, arguments);
  };
  const mod = (rel) => require(path.join(ARBRE, rel));
  if (NOM === 'auto-controle-interception') { mod('fonda/scripts/rattachement-page.js'); process.stdout.write(`\n@@RAPPORT@@${JSON.stringify({ chargesPage })}\n`); return; }
  const SC = mod('fonda/scripts/signer-cloture.js');
  const C = mod('fonda/engine/catalogue.js');
  const L = mod('fonda/scripts/liaison-generation.js');
  const S = mod('fonda/scripts/attestation-signee.js');
  const I = mod('fonda/scripts/interim.js');
  const REGISTRE = JSON.parse(fs.readFileSync(path.join(ARBRE, 'fonda/engine/moteurs.json'), 'utf8'));
  const donnee = (rel) => fs.readFileSync(path.join(DONNEES, rel));
  const copie = (o) => JSON.parse(JSON.stringify(o));
  const octetsJson = (o) => Buffer.from(`${JSON.stringify(o, null, 2)}\n`);
  const sha = C.sha256WebCrypto();

  const MOTEUR = { version: 'v1', sha256: REGISTRE[0].sha256 };
  const OCTETS_REF = donnee('fonda/data/referentiel.json');
  const REF_VERSION = `sha256:${sha256(OCTETS_REF)}`;
  const FIXTURE = JSON.parse(donnee('fonda/scripts/fixtures/execution-generation.json'));
  const COMMIT = 'c0ffee'.padEnd(40, '0');
  const DECL = { cle_id: 'cle-temoin', fichier: 'cles/cle-temoin.pem', sha256_pem: sha256(CLE.pem), algorithme: 'RSA-SHA256-PKCS1v15', valide_du: '2026-01-01T00:00:00.000Z', valide_au: '2027-12-31T00:00:00.000Z', revoquee_le: null };
  const CLES = S.chargerCles([DECL], () => CLE.pem);
  const interim = NOM.startsWith('interim');
  const setId = interim ? 'set_fonda_comprendre-consigne_nI_92' : 'set_fonda_grandeurs-mesures_nI_92';
  const lot = JSON.parse(donnee(`fonda/data/lots/${interim ? 'set_fonda_comprendre-consigne_nI_01' : 'set_fonda_grandeurs-mesures_nI_01'}.json`));
  lot.set_id = setId; lot.revue_carte_par_carte = false; lot.cartes.forEach((c) => { c.set_id = setId; });
  const ids = lot.cartes.map((c) => c.item_id);
  const empreintes = { pedagogique: await C.calculerEmpreinte(lot, sha), complete: L.empreinteComplete(lot) };
  const coeurDe = async (gardees) => {
    const filtre = { ...lot, revue_carte_par_carte: true, nb_cartes: gardees.length, cartes: lot.cartes.filter((c) => gardees.includes(c.item_id)) };
    return { action: 'accepter', selection: gardees, ecartees: ids.filter((i) => !gardees.includes(i)), empreinte_relue: empreintes.pedagogique, empreinte_publiee: await C.calculerEmpreinte(filtre, sha), moteur: { ...MOTEUR } };
  };
  const decisionDe = async (gardees) => ({
    schema: 'decision-fonda/v1', set_id: setId, generation: 0, nonce: 'f3a9c0d1e2b4a5c6', recu_le: interim ? '2026-11-04T17:00:01.000Z' : '2026-10-19T17:00:01.000Z',
    coeur: await coeurDe(gardees), lot_relu: { set_id: setId, empreinte_complete: empreintes.complete, cartes: ids.map((i) => ({ item_id: i, choix: gardees.includes(i) ? 'garder' : 'ecarter' })) }, hash_formulaire: 'saisie-locale',
  });
  const instancier = (g, v) => { let t = JSON.stringify(g); for (const [k, x] of Object.entries(v)) t = t.split(`<<${k}>>`).join(x); return JSON.parse(t); };
  const ref = `test-2026-10-17:${setId}`;
  const fx = instancier(FIXTURE, { SET_ID: setId, REF: ref, NOTION_ID: lot.notion_id, PALIER: lot.palier, MOTEUR_SHA256: MOTEUR.sha256, REFERENTIEL_VERSION: REF_VERSION, JOURNAL_COMMIT: COMMIT, EMPREINTE_PEDAGOGIQUE: empreintes.pedagogique, EMPREINTE_COMPLETE: empreintes.complete });
  const gen = { 501: fx.reussie };
  const execGen = [{ id: 501, workflowId: 'wfGen', status: 'success', startedAt: '2026-10-18T07:00:00.000Z', stoppedAt: '2026-10-18T07:01:00.000Z' }];
  const lotGenere = { id: 'drv-lot', nom: `${setId}.lot.json`, modifie_le: '2026-10-18T07:00:30.000Z', octets: Buffer.from(`${JSON.stringify(lot, null, 2)}\n`) };
  const candidats = [{ id: 'drv-lot', nom: `${setId}.lot.json`, modifie_le: '2026-10-18T07:00:30.000Z', properties: { fonda_set_id: setId, fonda_execution_id: '501' }, proprietesLisibles: true }];
  const journal = { schema: 'set-ids-journal/v1', lignes: [{ set_id: setId, transition: 'reserve', le: '2026-10-17', ref }] };
  const etat = { signatures: 0, ecrits: new Map(), affiche: '', questions: [], heure: Date.parse(interim ? '2026-11-05T09:00:00.000Z' : '2026-10-20T09:00:00.000Z'), appels: [], poison: 0, accesPage: [] };
  let decision = await decisionDe(ids.slice(0, -1));
  const locales = [];
  let code = null;
  const deps = {
    rattachement: (...a) => { etat.poison += 1; return SC.RATTACHEMENT_SAISIE_LOCALE(...a); },
    api: {
      async listerExecutions({ workflowId, status }) { if (workflowId !== 'wfGen') etat.accesPage.push(`workflow ${workflowId}`); return copie(status ? execGen.filter((e) => e.status === status) : execGen); },
      async lireExecution(id) { return gen[id] ? copie(gen[id]) : null; },
    },
    config: { source: 'saisie_locale', workflowGeneration: 'wfGen', dossier: '/tmp/fonda-temoin', cleId: 'cle-temoin', modelesAutorises: [FIXTURE.modele] },
    drive: {
      lireLotGenere: async () => { if (NOM === 'refus-lecture-indisponible') throw new Error('Drive injoignable'); return { ...lotGenere, octets: Buffer.from(lotGenere.octets) }; },
      listerCandidats: async () => { return { incompleteSearch: false, fichiers: copie(candidats) }; },
      get lireCandidat() { etat.accesPage.push('lireCandidat'); return undefined; },
      get listerDecisions() { etat.accesPage.push('listerDecisions'); return undefined; },
    },
    journal: async (c) => (c === COMMIT ? { surPremierParent: true, journal: copie(journal) } : { surPremierParent: false, journal: null }),
    decisionsLocales: async () => locales.map((f) => ({ nom: f.nom, octets: Buffer.from(f.octets) })),
    incidents: async () => [],
    referentielArchive: async (v) => { if (v !== REF_VERSION) throw new Error('introuvable'); return OCTETS_REF; },
    tableRelecteurs: { justine: 'Relectrice de test' },
    fs: {
      ecrireExclusif(p, t) { if (etat.ecrits.has(p)) throw new Error('existe déjà'); etat.ecrits.set(p, Buffer.from(t, 'utf8')); },
      lire(p) { if (!etat.ecrits.has(p)) throw new Error('absent'); return etat.ecrits.get(p); },
      existe(p) { return etat.ecrits.has(p); },
      realpath: (chemin) => fs.realpathSync.native(chemin),
      lister(d) { const n = new Set(); for (const p of etat.ecrits.keys()) if (p.startsWith(`${d}/`)) n.add(p.slice(d.length + 1).split('/')[0]); return [...n]; },
    },
    signer: (octets) => { etat.signatures += 1; return crypto.sign('sha256', octets, { key: CLE.prive, padding: crypto.constants.RSA_PKCS1_PADDING }); },
    cles: CLES, registre: REGISTRE,
    horloge: () => { etat.heure += 1000; return new Date(etat.heure); },
    afficher: (t) => { etat.affiche += t; },
    saisir: async (q) => {
      etat.questions.push(q);
      if (/Mode/.test(q)) return 'reponse_message';
      if (/Code/.test(q)) return code || /CODE DE CONFIRMATION : ([0-9a-f]{16})/.exec(etat.affiche).pop();
      return 'oui';
    },
    levees: [],
  };
  if (interim) {
    const FICHIER = JSON.parse(donnee('fonda/scripts/fixtures/relecture-interim.json'));
    const OCT_CAL = donnee('fonda/data/calendar.json');
    const DEST = JSON.parse(donnee('fonda/data/destinataires.json').toString('utf8'));
    const SHA_DESIGN = 'd'.repeat(40);
    const etatI = { fichier: copie(FICHIER), n: 0, historique: new Map([[SHA_DESIGN, { octetsInterim: octetsJson(FICHIER), octetsCalendrier: OCT_CAL }]]) };
    deps.interim = {
      observer: async () => {
        etatI.n += 1;
        if (NOM === 'interim-retire-c2-c3' && etatI.n === 3) etatI.fichier = { schema: 'relecture-interim/v1', entrees: [] };
        return { sha: SHA_DESIGN, octetsInterim: octetsJson(etatI.fichier), octetsCalendrier: OCT_CAL, octetsDestinataires: octetsJson(DEST) };
      },
      aCommit: (c) => (etatI.historique.has(c) ? { surPremierParent: true, ...etatI.historique.get(c) } : { surPremierParent: false }),
    };
    decision = { ...decision, schema: 'decision-fonda/v2', relecture_interim: I.blocDecision(FICHIER.entrees[0], `sha256:${sha256(octetsJson(FICHIER))}`, SHA_DESIGN) };
  }
  if (NOM === 'observe-substitution-avant-instantane') decision = { ...(await decisionDe(ids)), ...(interim ? {} : {}) };
  locales.push({ nom: 'decision.json', octets: octetsJson(decision) });
  if (NOM === 'refus-conflit') locales.push({ nom: 'decision-2.json', octets: octetsJson(await decisionDe(ids)) });
  if (NOM === 'refus-code-faux') code = '0'.repeat(16);

  // Chemins réels d'abord (Node résout les liens : /var -> /private/var sous macOS), puis tels que fournis.
  const depsTracees = tracer(deps, etat.appels, [[fs.realpathSync.native(ARBRE), '<ARBRE>'], [ARBRE, '<ARBRE>'], [fs.realpathSync.native(DONNEES), '<DONNEES>'], [DONNEES, '<DONNEES>']]);
  const essais = [];
  const essayer = async () => {
    try { const r = await SC.cloturer(setId, depsTracees); essais.push({ issue: 'succes', dossier: r.dossierLot }); } catch (e) { essais.push({ issue: e.issue || 'exception', message: e.message }); }
  };
  if (NOM === 'refus-substitution-apres-instantane') {
    code = '0'.repeat(16); await essayer(); code = null;
    locales[0] = { nom: 'decision.json', octets: octetsJson(await decisionDe(ids)) };
  }
  await essayer();
  const rapport = {
    essais, signatures: etat.signatures, poison: etat.poison, accesPage: etat.accesPage, chargesPage, appels: etat.appels, affiche: etat.affiche, questions: etat.questions,
    ecrits: [...etat.ecrits.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, b]) => [p, b.toString('base64')]),
  };
  process.stdout.write(`\n@@RAPPORT@@${JSON.stringify(rapport)}\n`);
}

if (process.env.TEMOIN_SCENARIO) {
  executerScenario().catch((e) => { process.stdout.write(`\n@@ERREUR@@${e.stack}\n`); process.exitCode = 2; });
} else {
  // ═══════════════════════════════════ TÉMOIN ═══════════════════════════════════
  const { test, describe, before, after } = require('node:test');
  const assert = require('node:assert/strict');
  const ENV_GIT = { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' };
  const git = (args, opts = {}) => execFileSync('git', args, { cwd: RACINE, env: ENV_GIT, maxBuffer: 64 * 1024 * 1024, ...opts });

  describe('témoin saisie locale (CDC §21.8, G1)', () => {
    let tmp = null;
    before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'temoin-saisie-locale-')); });
    after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

    test('0. prérequis : git, SHA de référence présent, checkout propre (échec, jamais sauté)', () => {
      assert.match(git(['--version']).toString(), /git version/);
      assert.equal(git(['cat-file', '-t', REFERENCE]).toString().trim(), 'commit', `SHA de référence ${REFERENCE} absent`);
      const nonSuivis = git(['status', '--porcelain', '--untracked-files=all', '--', 'fonda', 'n8n', '.github']).toString().split('\n').filter((l) => l.startsWith('??'));
      assert.deepEqual(nonSuivis, [], 'checkout propre exigé : aucun fichier non suivi sous fonda/, n8n/, .github/');
    });

    test('1. référence + PATCH FIGÉ == signer-cloture.js courant, octet pour octet', () => {
      const reference = git(['show', `${REFERENCE}:fonda/scripts/signer-cloture.js`]);
      const attendu = Buffer.from(appliquerPatch(reference.toString('utf8')), 'utf8');
      assert.ok(Buffer.from(appliquerPatch(reference.toString('utf8')), 'utf8').equals(attendu));
      assert.ok(fs.readFileSync(path.join(RACINE, 'fonda/scripts/signer-cloture.js')).equals(attendu), 'signer-cloture.js ≠ référence + patch figé');
    });

    test('2. plein fichier identique à la référence ; fichier local figé = son empreinte', () => {
      for (const p of PLEIN_FICHIER) assert.ok(fs.readFileSync(path.join(RACINE, p)).equals(git(['show', `${REFERENCE}:${p}`])), `${p} modifié depuis la référence`);
      assert.equal(`sha256:${sha256(fs.readFileSync(path.join(RACINE, 'fonda/scripts/signer-cloture-local.test.js')))}`, EMPREINTE_LOCAL, 'signer-cloture-local.test.js modifié (figé par empreinte)');
    });

    test('3 bis. orchestrer-lots.test.js = référence + la SEULE substitution d\'empreinte (et son commentaire), octet pour octet', () => {
      const ref = git(['show', `${REFERENCE}:fonda/scripts/orchestrer-lots.test.js`]).toString('utf8');
      assert.ok(fs.readFileSync(path.join(RACINE, 'fonda/scripts/orchestrer-lots.test.js')).equals(Buffer.from(attenduOrchestrateur(ref), 'utf8')), 'orchestrer-lots.test.js modifié au-delà de la substitution autorisée');
    });

    test('3. périmètre fermé : chemins de code modifiés ⊆ liste fermée ; aucun changement de type', () => {
      const lignes = git(['diff', '--name-status', '--no-renames', REFERENCE]).toString().split('\n').filter(Boolean);
      const hors = []; const types = [];
      for (const l of lignes) {
        const [statut, chemin] = l.split('\t');
        if (!DANS_PERIMETRE(chemin)) continue;
        if (statut.startsWith('T')) types.push(chemin);
        if (!LISTE_FERMEE.has(chemin)) hors.push(`${statut} ${chemin}`);
      }
      const modes = git(['diff', '--summary', REFERENCE]).toString().split('\n').filter((l) => /mode change|symlink/.test(l));
      assert.deepEqual(types, [], 'changement de type refusé');
      assert.deepEqual(modes.filter((l) => DANS_PERIMETRE(l.trim().split(' ').pop())), [], 'changement de mode refusé');
      assert.deepEqual(hors, [], 'chemins de code hors liste fermée');
    });

    // ── 4. Différentiel en processus neufs ──
    const SCENARIOS = [
      ['succes-eric', 'succes'], ['interim-succes', 'succes'],
      ['refus-substitution-apres-instantane', 'abandon'], ['refus-conflit', 'abandon'], ['interim-retire-c2-c3', 'refus'],
      ['refus-code-faux', 'local'], ['refus-lecture-indisponible', 'temporaire'],
      ['observe-substitution-avant-instantane', 'succes'],
    ];
    let arbreRef = null; let fichierCle = null;
    const executer = (arbre, nom) => {
      const r = spawnSync(process.execPath, [__filename], { env: { PATH: process.env.PATH, HOME: process.env.HOME, TEMOIN_SCENARIO: nom, TEMOIN_ARBRE: arbre, TEMOIN_DONNEES: RACINE, TEMOIN_CLE: fichierCle }, encoding: 'utf8', timeout: 60000 });
      assert.equal(r.error, undefined, `scénario ${nom} : ${r.error}`);
      assert.equal(r.signal, null, `scénario ${nom} : tué par ${r.signal}`);
      assert.equal(r.status, 0, `scénario ${nom} : code de sortie ${r.status} ; ${r.stderr}`);
      const m = /@@RAPPORT@@(.*)\n/.exec(r.stdout || '');
      assert.ok(m, `scénario ${nom} (${arbre === RACINE ? 'courant' : 'référence'}) sans rapport : ${r.stdout}${r.stderr}`);
      return JSON.parse(m[1]);
    };
    test('4. différentiel : extraction de la référence (git archive) et clé de test', () => {
      arbreRef = path.join(tmp, 'reference');
      fs.mkdirSync(arbreRef);
      const archive = git(['archive', '--format=tar', REFERENCE, 'fonda']);
      execFileSync('tar', ['-x', '-C', arbreRef], { input: archive });
      assert.ok(!fs.existsSync(path.join(arbreRef, 'fonda/scripts/rattachement-page.js')), 'la référence ne contient aucun module page');
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
      fichierCle = path.join(tmp, 'cle.json');
      fs.writeFileSync(fichierCle, JSON.stringify({ pem: publicKey.export({ type: 'spki', format: 'pem' }), prive: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
    });
    test('4. auto-contrôle de la trace : un appel de dépendance AJOUTÉ (cles.obtenir) dans une COPIE JETABLE de signer-cloture.js change la trace', () => {
      const mutant = path.join(tmp, 'mutant');
      fs.cpSync(path.join(RACINE, 'fonda'), path.join(mutant, 'fonda'), { recursive: true });
      const cible = path.join(mutant, 'fonda/scripts/signer-cloture.js');
      const debut = 'async function cloturer(setId, deps) {';
      const src = fs.readFileSync(cible, 'utf8');
      assert.equal(src.split(debut).length, 2, 'ancre de mutation unique');
      fs.writeFileSync(cible, src.replace(debut, `${debut}\n  deps.cles.obtenir(deps.config.cleId);`));
      const compter = (r) => r.appels.filter((a) => a.startsWith('deps.cles.obtenir(')).length;
      const normal = executer(RACINE, 'succes-eric');
      assert.ok(normal.appels.some((a) => a.startsWith('deps.fs.realpath(')), 'fs.realpath injecté et tracé (1a)');
      const mute = executer(mutant, 'succes-eric');
      assert.equal(compter(mute), compter(normal) + 1, 'l\'appel ajouté apparaît dans la trace');
      assert.notDeepEqual(mute.appels, normal.appels);
      assert.ok(!fs.existsSync(path.join(RACINE, 'fonda/scripts/signer-cloture.js.mutant')), 'aucun fichier laissé sous fonda/');
    });
    test('4. auto-contrôle : l\'interception de Module._load DÉTECTE un chargement de module page', () => {
      assert.deepEqual(executer(RACINE, 'auto-controle-interception').chargesPage, ['rattachement-page.js']);
    });
    test('4. traceur transparent : un argument porteur d\'un getter-poison n\'est PAS déclenché par la sérialisation', () => {
      let declenche = 0;
      const arg = { a: 1 }; Object.defineProperty(arg, 'poison', { enumerable: true, get() { declenche += 1; throw new Error('poison'); } });
      const journal = []; let recu = null;
      const t = tracer({ afficher: (x) => { recu = x; } }, journal);
      t.afficher(arg);
      assert.equal(declenche, 0, 'accesseur déclenché par la trace');
      assert.equal(recu, arg, 'argument transmis tel quel');
      assert.deepEqual(journal, ['deps.afficher({"a":1,"poison":<accesseur>})']);
    });
    test('4. traceur transparent : identité stable des wrappers, receveur d\'origine restitué (.call compris), accesseurs paresseux', () => {
      let acces = 0; let ceciVu = null;
      const svc = { m() { ceciVu = this; return 42; } };
      const deps = { api: svc, signer: () => 1 }; Object.defineProperty(deps, 'drive', { enumerable: true, get() { acces += 1; return {}; } });
      const journal = [];
      const t = tracer(deps, journal);
      assert.equal(acces, 0, 'aucune pré-énumération');
      assert.equal(t.api, t.api); assert.equal(t.signer, t.signer); assert.equal(t.api.m, t.api.m);
      const f = t.api.m;
      assert.equal(f.call(t.api), 42); assert.equal(ceciVu, svc, 'receveur d\'origine restitué sur .call');
      assert.equal(t.api.m(), 42); assert.equal(ceciVu, svc);
      assert.deepEqual(journal, ['deps.api.m()', 'deps.api.m()']);
    });
    test('4. traceur transparent : une dépendance REMPLACÉE (méthode ou conteneur) est appelée et tracée dans sa NOUVELLE version', () => {
      const journal = [];
      const deps = { api: { m: () => 1 } };
      const t = tracer(deps, journal);
      assert.equal(t.api.m(), 1);
      deps.api.m = () => 2; // remplacement d'une méthode
      assert.equal(t.api.m(), 2, 'nouvelle méthode appelée');
      deps.api = { m: () => 3 }; // remplacement du conteneur
      assert.equal(t.api.m(), 3, 'nouveau conteneur appelé');
      assert.deepEqual(journal, ['deps.api.m()', 'deps.api.m()', 'deps.api.m()']);
      assert.equal(t.api, t.api, 'identité stable tant que la valeur ne change pas');
    });
    test('4. sérialisation : types admis déterministes, BigInt distingués, Map/Set marqués non supportés, chemins de l\'arbre remplacés', () => {
      assert.notEqual(serialiser(1n), serialiser(2n));
      assert.equal(serialiser(new Map([[1, 2]])), '<non supporté:Map>');
      assert.equal(serialiser('/x/arbre/fonda/a.js', [['/x/arbre', '<ARBRE>']]), '"<ARBRE>/fonda/a.js"');
      assert.equal(serialiser({ b: 1, a: [Buffer.from('z'), new Date(0)] }), serialiser({ a: [Buffer.from('z'), new Date(0)], b: 1 }));
    });
    test('4. trace déterministe : deux exécutions du même scénario sur le même arbre -> rapports identiques', () => {
      assert.deepEqual(executer(RACINE, 'interim-succes'), executer(RACINE, 'interim-succes'));
    });
    for (const [nom, attendue] of SCENARIOS) {
      test(`4. différentiel « ${nom} » : référence et courant identiques (issue ${attendue}), aucun code page chargé`, () => {
        const a = executer(arbreRef, nom);
        const b = executer(RACINE, nom);
        for (const [quoi, r] of [['référence', a], ['courant', b]]) {
          assert.deepEqual(r.chargesPage, [], `${quoi} : module page chargé en saisie locale`);
          assert.deepEqual(r.accesPage, [], `${quoi} : dépendance page sollicitée`);
          assert.equal(r.poison, 0, `${quoi} : poison invoqué`);
          assert.equal(r.essais[r.essais.length - 1].issue, attendue, `${quoi} : ${JSON.stringify(r.essais)}`);
          if (attendue !== 'succes') {
            assert.equal(r.signatures, 0, `${quoi} : signature sur un refus`);
            assert.ok(!r.ecrits.some(([p]) => /attestation\.json$|signature/.test(p)), `${quoi} : marqueur ou attestation écrits sur un refus`);
          } else {
            assert.equal(r.signatures, 1);
            assert.match(r.affiche, /CODE DE CONFIRMATION : [0-9a-f]{16}/, `${quoi} : récapitulatif et code affichés avant la confirmation`);
            assert.ok(r.questions.some((q) => /Code/.test(q)), `${quoi} : code demandé`);
          }
        }
        assert.deepEqual(b, a, 'comportement courant ≠ référence');
      });
    }
  });
}
