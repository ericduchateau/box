#!/usr/bin/env node
// ORCHESTRATEUR de validation multi-lots FONDA (« plomberie d'abord ») — Mac d'Éric.
//
//   node fonda/scripts/orchestrer-lots.js --lots <fichier> --branche <publie/…>
//   (<fichier> : une ligne « <set_id> <ref> » par lot ; lignes vides et « # … » ignorées)
//
// Fait défiler une LISTE de lots dans la cérémonie existante, en automatisant les étapes
// MÉCANIQUES et en s'arrêtant aux deux actes HUMAINS, lot par lot :
//   1. génération (declencher-generation.js : --etat, puis un seul déclenchement si rien n'est
//      en vol, workflows n8n vérifiés ACTIFS — jamais (dés)activés ici) ;
//   2. --diagnostic -> pret_pour_saisie ;
//   3. ACTE HUMAIN : --saisir <set_id> (terminal, carte par carte, INCHANGÉ) ;
//   4. --diagnostic -> pret_pour_cloture (intérim applicable aujourd'hui le cas échéant) ;
//   5. ACTE HUMAIN : signer-cloture.js <set_id> (passphrase, par lot, INCHANGÉ) ;
//   6. --diagnostic -> signe ;
//   7. --extraire-publication <set_id> ;
//   8. publier-lot.js --dry-run, PUIS réel si le dry-run est propre ;
//   9. un COMMIT par lot (exactement les 3 fichiers de publication) sur UNE branche de batch,
//      poussée ; à la fin : URL compare + titre/description à coller. JAMAIS de PR ouverte ni
//      de fusion ici (gestes de l'architecte et d'Éric), jamais de push sur main.
//
// GARDE-FOUS :
//   - n'appelle QUE des commandes existantes (liste fermée ci-dessous) et lit leurs codes de
//     sortie et l'état TYPÉ du diagnostic ; ne modifie aucun fichier probant ;
//   - chaque garde n'est franchie que si le diagnostic est VERT ; anomalie, état inconnu, sortie
//     illisible ou code ≠ 0 -> STOP DU LOT (consigné), lot suivant ; fail-closed ;
//   - actes humains : la commande existante est lancée avec l'entrée standard HÉRITÉE du vrai
//     terminal (aucun pipe, aucune entrée préremplie) ; l'orchestrateur ne lit, ne fournit ni ne
//     stocke jamais la passphrase ; toutes les autres commandes ont stdin FERMÉ (« ignore ») ;
//   - jamais --liberer ni --reparer automatiques : un état « envoi »/« inconnu » du verrou de
//     génération -> STOP avec la commande manuelle à lancer ;
//   - relançable : l'état de chaque lot est relu par --diagnostic (et le catalogue de la branche)
//     et les étapes déjà faites sont sautées.
// Journal de progression : ~/FONDA-clotures/orchestrations/<branche>.jsonl (ajout seul).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.join(__dirname, '..', '..');
const DEPOT = 'https://github.com/ericduchateau/box';
const WORKFLOWS_N8N = Object.freeze({ generation: 'vrqgtS5kQMvP9Ok5', portier: 'MkYrdhgTo52nA3av' });
const SET_ID = /^set_fonda_[a-z0-9-]+_n[IF]_\d{2}$/;
const REF = /^[0-9A-Za-z][0-9A-Za-z._:-]{0,99}$/;
const BRANCHE = /^publie\/[a-z0-9][a-z0-9._-]{0,80}$/;
const FICHIERS_PUBLICATION = (setId) => [`fonda/data/lots/${setId}.json`, 'fonda/data/catalogue-fonda.json', 'fonda/data/set_ids-journal.json'];

// Commandes autorisées (liste FERMÉE) : [exécutable, arguments fixes du début].
const NODE = process.execPath;
const SIGNATAIRE = 'fonda/scripts/signer-cloture.js';
const DECLENCHEUR = 'fonda/scripts/declencher-generation.js';
const PUBLICATION = 'fonda/scripts/publier-lot.js';

class Stop extends Error {
  constructor(etape, raison) { super(`${etape} : ${raison}`); this.etape = etape; this.raison = raison; }
}

// --- Arguments ------------------------------------------------------------------------------
function lireListe(texte) {
  const lots = [];
  texte.split('\n').forEach((brut, i) => {
    const l = brut.trim();
    if (!l || l.startsWith('#')) return;
    const [setId, ref, ...reste] = l.split(/\s+/);
    if (reste.length || !SET_ID.test(setId || '') || !REF.test(ref || '')) throw new Error(`liste des lots, ligne ${i + 1} : « <set_id> <ref> » attendu (${l})`);
    if (lots.some((x) => x.setId === setId)) throw new Error(`liste des lots : ${setId} en double`);
    lots.push({ setId, ref });
  });
  if (!lots.length) throw new Error('liste des lots vide');
  return lots;
}
function analyserArguments(argv) {
  const a = [...argv];
  const opt = (nom) => { const i = a.indexOf(nom); if (i < 0) return undefined; const v = a[i + 1]; a.splice(i, 2); return v; };
  const lots = opt('--lots');
  const branche = opt('--branche');
  if (a.length) throw new Error(`argument inattendu : ${a[0]}`);
  if (!lots || !branche) throw new Error('usage : orchestrer-lots.js --lots <fichier> --branche publie/<nom>');
  if (!BRANCHE.test(branche)) throw new Error(`--branche : « publie/<nom> » attendu (${branche}) — jamais main ni design`);
  return { fichierLots: lots, branche };
}

// --- Lecture des sorties des commandes existantes -------------------------------------------
function json(r, quoi) {
  if (r.code !== 0) throw new Stop(quoi, `code de sortie ${r.code} (${(r.stderr || '').trim().split('\n').pop() || 'sans message'})`);
  try { return JSON.parse(r.stdout); } catch { throw new Stop(quoi, 'sortie illisible (JSON attendu)'); }
}

// --- Cœur : un lot ---------------------------------------------------------------------------
// deps : { lancer(exe, args, { humain }) -> { code, stdout, stderr }, n8nActifs() -> { generation, portier },
//          afficher(texte), consigner(evt), dormir(ms), attenteGenerationMs, pasAttenteMs }
async function traiterLot(lot, ctx, deps) {
  const { setId, ref } = lot;
  const node = (script, ...args) => deps.lancer(NODE, [script, ...args], { humain: false });
  const humain = (script, ...args) => deps.lancer(NODE, [script, ...args], { humain: true });
  const diag = (quoi) => {
    const d = json(node(SIGNATAIRE, '--diagnostic', setId), `${quoi} (--diagnostic)`);
    if (!d || typeof d.etat !== 'string' || !Array.isArray(d.applicables)) throw new Stop(quoi, 'diagnostic sans état typé');
    deps.consigner({ set_id: setId, evt: 'diagnostic', quoi, etat: d.etat });
    return d;
  };
  const exiger = (d, attendu, quoi) => { if (d.etat !== attendu) throw new Stop(quoi, `état « ${d.etat} » (attendu « ${attendu} ») — ${typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail)}`); };

  // Déjà publié sur la branche de batch (relance) : rien à refaire.
  if (ctx.publieSurBranche(setId)) { deps.consigner({ set_id: setId, evt: 'deja_publie' }); return { setId, issue: 'deja_publie' }; }

  let d = diag('état initial');
  // Seuls états de DÉPART pris en charge ; toute anomalie (ou état inconnu) -> STOP.
  const DEPARTS = ['aucune_generation', 'pret_pour_saisie', 'pret_pour_cloture', 'signe'];
  if (!DEPARTS.includes(d.etat)) throw new Stop('état initial', `« ${d.etat} » (anomalie ou état non pris en charge) — ${typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail)}`);

  // 1. Génération (seulement si rien n'existe encore pour ce set_id).
  if (d.etat === 'aucune_generation') {
    const v = json(node(DECLENCHEUR, '--etat', setId), 'génération (--etat)');
    if (v.etat === 'envoi' || v.etat === 'inconnu') throw new Stop('génération', `verrou à l'état « ${v.etat} » : lot EN VOL ou indéterminé — jamais de nouvel envoi ; observer : declencher-generation.js --etat ${setId} (puis --liberer à la main si rien n'est observé)`);
    if (v.etat !== 'accepte') {
      if (![null, 'refuse', 'libere'].includes(v.etat)) throw new Stop('génération', `état du verrou inconnu (${v.etat})`);
      let actifs;
      try { actifs = await deps.n8nActifs(); } catch (e) { throw new Stop('génération', `activité des workflows n8n non vérifiable (${e.message}) — rien n'est envoyé`); }
      if (!actifs || actifs.generation !== true || actifs.portier !== true) {
        throw new Stop('génération', `workflows n8n INACTIFS (génération : ${actifs && actifs.generation}, portier : ${actifs && actifs.portier}) — les activer à la main avant de relancer ; rien n'est envoyé`);
      }
      ctx.n8nSollicites = true;
      const r = json(node(DECLENCHEUR, setId, ref), 'génération (déclenchement)');
      deps.consigner({ set_id: setId, evt: 'declenchement', issue: r.issue, statut: r.statut });
      if (r.issue !== 'accepte') throw new Stop('génération', `issue « ${r.issue} » (HTTP ${r.statut})${r.consigne ? ` — ${r.consigne}` : ''}`);
    }
    // Attente de la génération acceptée (jamais de second envoi), nombre de relevés BORNÉ.
    const releves = Math.max(1, Math.ceil(deps.attenteGenerationMs / deps.pasAttenteMs));
    for (let n = 1; ; n += 1) {
      d = diag('attente de la génération');
      if (d.etat === 'pret_pour_saisie') break;
      const transitoire = ['aucune_generation', 'generation_en_cours', 'generation_incoherente'].includes(d.etat);
      if (!transitoire || n >= releves) throw new Stop('génération', `état « ${d.etat} » après génération acceptée${transitoire ? ' (délai d\'attente écoulé)' : ''}`);
      await deps.dormir(deps.pasAttenteMs);
    }
  }

  // 2-3. Saisie humaine.
  if (d.etat === 'pret_pour_saisie') {
    exiger(d, 'pret_pour_saisie', 'avant saisie');
    deps.afficher(`\n═══ ACTE HUMAIN (${setId}) : SAISIE carte par carte — la commande --saisir reçoit TON terminal ═══`);
    const r = humain(SIGNATAIRE, '--saisir', setId);
    deps.consigner({ set_id: setId, evt: 'saisie_terminee', code: r.code });
    d = diag('après saisie');
    exiger(d, 'pret_pour_cloture', 'après saisie');
  }

  // 4-5. Signature humaine.
  if (d.etat === 'pret_pour_cloture') {
    deps.afficher(`\n═══ ACTE HUMAIN (${setId}) : SIGNATURE — signer-cloture.js demande TA passphrase dans TON terminal ═══`);
    const r = humain(SIGNATAIRE, setId);
    deps.consigner({ set_id: setId, evt: 'signature_terminee', code: r.code });
    d = diag('après signature');
  }

  // 6. Signé exigé.
  exiger(d, 'signe', 'avant publication');

  // 7. Extraction.
  const x = json(node(SIGNATAIRE, '--extraire-publication', setId), 'extraction');
  if (!x || typeof x.chemin !== 'string' || path.basename(x.chemin) !== 'lot-relu.json') throw new Stop('extraction', 'chemin de lot-relu.json absent');
  const attestation = path.join(path.dirname(x.chemin), 'attestation.json');

  // 8. Publication : dry-run propre, puis réel.
  const sec = node(PUBLICATION, x.chemin, attestation, '--dry-run');
  if (sec.code !== 0 || !sec.stdout.includes(`(dry-run) ${setId} publiable`)) throw new Stop('publication (dry-run)', `refusée : ${(sec.stdout + sec.stderr).trim().split('\n').slice(-3).join(' | ')}`);
  const pub = node(PUBLICATION, x.chemin, attestation);
  if (pub.code !== 0 || !pub.stdout.includes(`✓ ${setId} publié`)) throw new Stop('publication', `échec : ${(pub.stdout + pub.stderr).trim().split('\n').slice(-3).join(' | ')}`);

  // 9. Commit de EXACTEMENT les 3 fichiers, push de la branche de batch.
  ctx.commit(setId);
  deps.consigner({ set_id: setId, evt: 'publie_commite' });
  return { setId, issue: 'publie' };
}

// --- Git (branche de batch, un commit par lot) ----------------------------------------------
function git(deps, ...args) {
  const r = deps.lancer('git', args, { humain: false });
  if (r.code !== 0) throw new Stop('git', `git ${args.join(' ')} : code ${r.code} (${(r.stderr || '').trim().split('\n').pop()})`);
  return r.stdout;
}
function preparerBranche(branche, deps) {
  if (git(deps, 'status', '--porcelain', '--untracked-files=no').trim()) throw new Stop('git', 'modifications suivies non commitées : arrêt (rien n\'est fait)');
  git(deps, 'fetch', '--quiet', 'origin', '+refs/heads/design:refs/remotes/origin/design');
  const existe = deps.lancer('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branche}`], { humain: false }).code === 0;
  if (existe) git(deps, 'switch', '--quiet', branche);
  else git(deps, 'switch', '--quiet', '-c', branche, 'refs/remotes/origin/design');
}
function contexteGit(branche, deps) {
  return {
    n8nSollicites: false,
    publieSurBranche(setId) {
      const cat = JSON.parse(git(deps, 'show', 'HEAD:fonda/data/catalogue-fonda.json'));
      return Array.isArray(cat.lots) && cat.lots.some((e) => e.set_id === setId);
    },
    commit(setId) {
      const attendus = FICHIERS_PUBLICATION(setId);
      // Fichiers SUIVIS modifiés : exactement catalogue + journal ; le lot : nouveau fichier non suivi.
      const suivis = git(deps, 'status', '--porcelain', '--untracked-files=no').split('\n').filter(Boolean).map((l) => l.slice(3)).sort();
      if (JSON.stringify(suivis) !== JSON.stringify(attendus.slice(1).sort())) throw new Stop('git', `fichiers suivis modifiés ≠ catalogue + journal (${suivis.join(', ') || 'aucun'}) — rien n'est commité`);
      if (git(deps, 'ls-files', '--others', '--exclude-standard', '--', attendus[0]).trim() !== attendus[0]) throw new Stop('git', `${attendus[0]} absent ou déjà suivi — rien n'est commité`);
      git(deps, 'add', '--', ...attendus);
      const indexe = git(deps, 'diff', '--cached', '--name-only').split('\n').filter(Boolean).sort();
      if (JSON.stringify(indexe) !== JSON.stringify([...attendus].sort())) throw new Stop('git', `index ≠ 3 fichiers de publication (${indexe.join(', ')})`);
      git(deps, 'commit', '--quiet', '-m', `FONDA : publication de ${setId}\n\nLot relu en saisie locale et signé (une passphrase), publié par orchestrer-lots.js :\nlot, entrée du catalogue, transition publie du journal.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`);
      git(deps, 'push', '--quiet', '-u', 'origin', `refs/heads/${branche}:refs/heads/${branche}`);
    },
  };
}

// --- Batch ---------------------------------------------------------------------------------
async function orchestrer({ lots, branche }, deps) {
  if (!BRANCHE.test(branche)) throw new Error(`branche refusée : ${branche}`);
  preparerBranche(branche, deps);
  const ctx = contexteGit(branche, deps);
  deps.consigner({ evt: 'debut', branche, lots: lots.map((l) => l.setId) });
  const resultats = [];
  for (const lot of lots) {
    deps.afficher(`\n──── ${lot.setId} (ref ${lot.ref}) ────`);
    try {
      const r = await traiterLot(lot, ctx, deps);
      resultats.push(r);
      deps.afficher(`✓ ${lot.setId} : ${r.issue === 'publie' ? 'publié et commité' : 'déjà publié sur la branche'}`);
    } catch (e) {
      const raison = e instanceof Stop ? e.message : `erreur inattendue : ${e.message}`;
      resultats.push({ setId: lot.setId, issue: 'stoppe', raison });
      deps.consigner({ set_id: lot.setId, evt: 'stop', raison });
      deps.afficher(`✗ ${lot.setId} STOPPÉ — ${raison}`);
    }
  }
  const publies = resultats.filter((r) => r.issue === 'publie' || r.issue === 'deja_publie');
  const url = `${DEPOT}/compare/design...${branche}`;
  const resume = [
    '\n════ RÉSUMÉ ════',
    `Publiés (${publies.length}) : ${publies.map((r) => r.setId).join(', ') || '—'}`,
    `Stoppés (${resultats.length - publies.length}) :${resultats.filter((r) => r.issue === 'stoppe').map((r) => `\n  - ${r.setId} : ${r.raison}`).join('') || ' —'}`,
  ];
  if (publies.length) {
    resume.push(`\nBranche poussée : ${branche} — PR à OUVRIR À LA MAIN (jamais fusionnée ici) :\n  ${url}`,
      `Titre : FONDA : publication de ${publies.length} lot(s) (${publies.map((r) => r.setId).join(', ')})`,
      `Description :\n  Un commit par lot (lot, entrée du catalogue, transition publie du journal), chacun relu en saisie locale et signé séparément (une passphrase par lot), publié par orchestrer-lots.js (dry-run propre puis réel). Relecture commit par commit.`);
  }
  if (ctx.n8nSollicites) resume.push('\n⚠ n8n toujours ACTIFS (génération + portier) — pense à les désactiver.');
  deps.afficher(resume.join('\n'));
  deps.consigner({ evt: 'fin', resultats });
  return { resultats, url: publies.length ? url : null, n8nSollicites: ctx.n8nSollicites };
}

// --- Adaptateurs de production --------------------------------------------------------------
// Lancement : stdin FERMÉ pour les commandes mécaniques ; HÉRITÉ (vrai terminal) pour les actes
// humains, sans aucun pipe ni entrée fournie par l'orchestrateur.
const OPTIONS_HUMAIN = Object.freeze({ cwd: RACINE, stdio: 'inherit' });
const OPTIONS_MECANIQUE = Object.freeze({ cwd: RACINE, stdio: Object.freeze(['ignore', 'pipe', 'pipe']), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
function lancerProduction(exe, args, { humain }, spawn = spawnSync) {
  const r = spawn(exe, args, humain ? OPTIONS_HUMAIN : OPTIONS_MECANIQUE);
  return { code: r.status === null ? 1 : r.status, stdout: humain ? '' : (r.stdout || ''), stderr: humain ? '' : (r.stderr || '') };
}
// Activité des workflows (lecture seule, clé d'API n8n du signataire ; jamais affichée).
async function n8nActifsProduction({ dossierCles = path.join(os.homedir(), '.fonda-cles'), url = 'https://n8n.srv868991.hstgr.cloud', fetch: f = globalThis.fetch } = {}) {
  const cle = fs.readFileSync(path.join(dossierCles, 'n8n-signataire.cle'), 'utf8').trim();
  const actif = async (id) => {
    const r = await f(`${url}/api/v1/workflows/${id}`, { headers: { 'X-N8N-API-KEY': cle, accept: 'application/json' } });
    if (!r.ok) throw new Error(`workflow ${id} : HTTP ${r.status}`);
    return (await r.json()).active === true;
  };
  return { generation: await actif(WORKFLOWS_N8N.generation), portier: await actif(WORKFLOWS_N8N.portier) };
}
function consignerFichier(branche) {
  const dir = path.join(os.homedir(), 'FONDA-clotures', 'orchestrations');
  const fichier = path.join(dir, `${branche.replace(/\//g, '_')}.jsonl`);
  return (evt) => { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.appendFileSync(fichier, `${JSON.stringify({ le: new Date().toISOString(), ...evt })}\n`); };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const { fichierLots, branche } = analyserArguments(argv);
    const lots = lireListe(fs.readFileSync(fichierLots, 'utf8'));
    await orchestrer({ lots, branche }, {
      lancer: lancerProduction, n8nActifs: () => n8nActifsProduction(), afficher: (t) => console.log(t), consigner: consignerFichier(branche),
      dormir: (ms) => new Promise((r) => setTimeout(r, ms)), attenteGenerationMs: 10 * 60 * 1000, pasAttenteMs: 15 * 1000,
    });
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exitCode = 1;
  }
}

module.exports = { analyserArguments, lireListe, traiterLot, orchestrer, preparerBranche, contexteGit, lancerProduction, n8nActifsProduction, OPTIONS_HUMAIN, OPTIONS_MECANIQUE, Stop, WORKFLOWS_N8N, FICHIERS_PUBLICATION, SIGNATAIRE, DECLENCHEUR, PUBLICATION };

if (require.main === module) main();
