// Tests de fonda/scripts/verifier-immuabilite.js (CDC annexe B §17, §6).
// Usage : node --test fonda/scripts/verifier-immuabilite.test.js

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const I = require('./verifier-immuabilite.js');

const SHA1 = 'a'.repeat(64);
const SHA2 = 'b'.repeat(64);
const REG = [{ version: 'v1', fichier: 'fonda/engine/moteur-correction-v1.js', sha256: SHA1, sri: 'x' }];
const A = 'set_fonda_lexique_nI_01';
const B = 'set_fonda_lexique_nI_02';
const H = 'set_fonda_comprendre-consigne_nI_01';
const HIST = { [H]: 'sha256:hh' };
const M1 = { version: 'v1', sha256: SHA1 };
const e = (set_id, empreinte, moteur, extra = {}) => ({ set_id, empreinte, ...(moteur ? { moteur } : {}), ...extra });
const l = (set_id, transition, ref = `r-${set_id}-${transition}`) => ({ set_id, transition, le: '2026-10-14', ref });
const J = (...lignes) => ({ schema: 'set-ids-journal/v1', lignes });
const C = (...lots) => ({ schema: 'catalogue-fonda/v1', lots });

function d(x = {}) {
  const journal = J(l(H, 'reserve'), l(H, 'publie'));
  return {
    catalogueCourant: C(e(H, 'sha256:hh', M1)),
    journalCourant: journal,
    catalogueRef: C(e(H, 'sha256:hh', M1)),
    journalRef: journal,
    historiqueCatalogues: [C(e(H, 'sha256:hh')), C(e(H, 'sha256:hh', M1))],
    historiqueJournaux: [journal],
    registre: REG,
    historiques: HIST,
    ...x,
  };
}

describe('règle du tuple', () => {
  test('lot inchangé (et transit design -> main) : accepté', () => {
    assert.deepEqual(I.decider(d()), []);
  });
  test('remplacement d\'attestation à contenu et moteur identiques : accepté', () => {
    assert.deepEqual(I.decider(d({ catalogueCourant: C(e(H, 'sha256:hh', M1, { attestation: { type: 'autre' } })) })), []);
  });
  test('empreinte ou moteur changés : refusé', () => {
    assert.match(I.decider(d({ catalogueCourant: C(e(H, 'sha256:zz', M1)) })).join(), /tuple/);
    assert.match(I.decider(d({ catalogueCourant: C(e(H, 'sha256:hh', { version: 'v1', sha256: SHA2 })) })).join(), /tuple/);
    assert.match(I.decider(d({ catalogueCourant: C(e(H, 'sha256:hh', { version: 'v2', sha256: SHA1 })) })).join(), /tuple/);
  });
  test('deux tuples différents publiés dans l\'historique pour un même set_id : refusé', () => {
    const hist = [C(e(H, 'sha256:hh', M1)), C(e(H, 'sha256:hh', { version: 'v1', sha256: SHA2 }))];
    assert.match(I.decider(d({ historiqueCatalogues: hist })).join(), /tuple/);
  });
});

describe('première publication et journal', () => {
  const pub = (lignes, cat = C(e(H, 'sha256:hh', M1), e(B, 'sha256:bb', M1))) => d({ catalogueCourant: cat, journalCourant: J(l(H, 'reserve'), l(H, 'publie'), ...lignes) });
  test('reserve puis publie : accepté ; présence antérieure en calibration sans effet', () => {
    assert.deepEqual(I.decider(pub([l(B, 'reserve'), l(B, 'publie')])), []);
  });
  test('absent du journal : refusé', () => {
    assert.match(I.decider(pub([])).join(), /absent du journal/);
  });
  test('seulement réservé (sans publie) : refusé', () => {
    assert.match(I.decider(pub([l(B, 'reserve')])).join(), /attendu publie/);
  });
  test('abandonné : refusé, jamais réutilisable', () => {
    assert.match(I.decider(pub([l(B, 'reserve'), l(B, 'abandonne')])).join(), /abandonne/);
  });
  test('retiré puis réintroduit au catalogue : refusé', () => {
    const x = pub([l(B, 'reserve'), l(B, 'publie'), l(B, 'retire')]);
    assert.match(I.decider(x).join(), /retire/);
  });
  test('journal non conforme (double reserve) : refusé', () => {
    assert.match(I.decider(pub([l(B, 'reserve', 'r-1111'), l(B, 'reserve', 'r-2222')])).join(), /double reserve/);
  });
  test('journal en ajout seul : ligne modifiée, supprimée ou réordonnée par rapport à l\'historique -> refusé', () => {
    const publie = J(l(H, 'reserve'), l(H, 'publie'), l(A, 'reserve'));
    const base = { historiqueJournaux: [publie] };
    assert.deepEqual(I.decider(d({ ...base, journalCourant: J(l(H, 'reserve'), l(H, 'publie'), l(A, 'reserve'), l(A, 'abandonne')) })), []);
    assert.match(I.decider(d({ ...base, journalCourant: J(l(H, 'reserve'), l(H, 'publie')) })).join(), /ajout seul/);
    assert.match(I.decider(d({ ...base, journalCourant: J(l(H, 'reserve'), l(H, 'publie'), { ...l(A, 'reserve'), le: '2026-10-15' }) })).join(), /ajout seul/);
    assert.match(I.decider(d({ ...base, journalCourant: J(l(H, 'reserve'), l(A, 'reserve'), l(H, 'publie')) })).join(), /ajout seul/);
  });
});

describe('retraits', () => {
  const ref = C(e(H, 'sha256:hh', M1), e(B, 'sha256:bb', M1));
  const journalRef = J(l(H, 'reserve'), l(H, 'publie'), l(B, 'reserve'), l(B, 'publie'));
  const base = { catalogueRef: ref, journalRef, historiqueCatalogues: [ref], historiqueJournaux: [journalRef] };
  test('retiré du catalogue AVEC une transition retire ajoutée dans la PR : accepté', () => {
    assert.deepEqual(I.decider(d({ ...base, catalogueCourant: C(e(H, 'sha256:hh', M1)), journalCourant: J(...journalRef.lignes, l(B, 'retire')) })), []);
  });
  test('retiré du catalogue SANS transition retire : refusé', () => {
    assert.match(I.decider(d({ ...base, catalogueCourant: C(e(H, 'sha256:hh', M1)), journalCourant: journalRef })).join(), /sans transition « retire »/);
  });
});

describe('règle 0 de M1 — consommable une seule fois', () => {
  const avant = { historiqueCatalogues: [C(e(H, 'sha256:hh'))], catalogueRef: C(e(H, 'sha256:hh')) };
  test('aucun moteur dans l\'historique : lot historique figé + v1 du registre à empreinte figée -> accepté', () => {
    assert.deepEqual(I.decider(d(avant)), []);
  });
  test('aucun moteur dans l\'historique : empreinte modifiée, autre moteur, ou lot non historique -> refusé', () => {
    assert.match(I.decider(d({ ...avant, catalogueCourant: C(e(H, 'sha256:zz', M1)) })).join(), /règle 0/);
    assert.match(I.decider(d({ ...avant, catalogueCourant: C(e(H, 'sha256:hh', { version: 'v1', sha256: SHA2 })) })).join(), /règle 0/);
    assert.match(I.decider(d({ ...avant, historiques: {} })).join(), /règle 0/);
  });
  test('M1 consommée puis catalogue vidé : la règle 0 ne se réarme pas', () => {
    const hist = [C(e(H, 'sha256:hh')), C(e(H, 'sha256:hh', M1)), C()];
    const rejeu = C(e(H, 'sha256:hh', { version: 'v1', sha256: SHA2 }));
    assert.match(I.decider(d({ historiqueCatalogues: hist, catalogueCourant: rejeu, registre: [{ ...REG[0], sha256: SHA2 }] })).join(), /tuple/);
  });
  test('M1 consommée ailleurs : un lot publié seulement avant M1 ne peut plus la recevoir', () => {
    const hist = [C(e(H, 'sha256:hh'), e(A, 'sha256:aa')), C(e(A, 'sha256:aa', M1))];
    assert.match(I.decider(d({ historiqueCatalogues: hist })).join(), /M1 déjà consommée/);
  });
});

describe('formes invalides : refus explicite', () => {
  test('version historique du catalogue ou du journal invalide', () => {
    assert.match(I.decider(d({ historiqueCatalogues: [{ pas: 'de lots' }] })).join(), /forme invalide/);
    assert.match(I.decider(d({ historiqueJournaux: [{ schema: 'autre', lignes: [] }] })).join(), /forme invalide/);
  });
  test('catalogue courant invalide', () => {
    assert.match(I.decider(d({ catalogueCourant: { lots: null } })).join(), /forme invalide/);
  });
});

// --- Intégration Git (dépôts temporaires) -------------------------------------------
describe('intégration Git : références, premier parent, lecture fail-closed', () => {
  function depot() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'immu-'));
    const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    g('init', '-q', '-b', 'design'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
    fs.mkdirSync(path.join(dir, 'fonda/data'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'fonda/engine'), { recursive: true });
    return { dir, g };
  }
  const ecrire = (dir, rel, o) => fs.writeFileSync(path.join(dir, rel), typeof o === 'string' ? o : JSON.stringify(o));
  function etat(dir, catalogue, journal) {
    ecrire(dir, 'fonda/data/catalogue-fonda.json', catalogue);
    ecrire(dir, 'fonda/data/set_ids-journal.json', journal);
    ecrire(dir, 'fonda/engine/moteurs.json', REG);
  }
  // Les historiques réels de ce module utilisent HISTORIQUES_FIGES ; on teste ici des
  // set_id NON historiques, qui suivent donc la règle générale.
  test('PR de première publication puis merge : accepté au contrôle de PR et au push', () => {
    const { dir, g } = depot();
    etat(dir, C(), J());
    g('add', '.'); g('commit', '-q', '-m', 'vide');
    const avant = g('rev-parse', 'HEAD');
    g('checkout', '-q', '-b', 'pr');
    etat(dir, C(e(A, 'sha256:aa', M1)), J(l(A, 'reserve'), l(A, 'publie')));
    g('commit', '-q', '-am', 'publication');
    g('checkout', '-q', 'design');
    g('merge', '-q', '--no-ff', '-m', 'Merge', 'pr');
    assert.deepEqual(I.verifier({ refBase: avant, racine: dir }), []);
  });
  test('modification d\'un tuple publié sur design : refusée', () => {
    const { dir, g } = depot();
    etat(dir, C(e(A, 'sha256:aa', M1)), J(l(A, 'reserve'), l(A, 'publie')));
    g('add', '.'); g('commit', '-q', '-m', 'publié');
    const avant = g('rev-parse', 'HEAD');
    etat(dir, C(e(A, 'sha256:zz', M1)), J(l(A, 'reserve'), l(A, 'publie')));
    assert.match(I.verifier({ refBase: avant, racine: dir }).join(), /tuple/);
  });
  test('référence nulle, absente ou introuvable : échec explicite', () => {
    const { dir, g } = depot();
    etat(dir, C(), J()); g('add', '.'); g('commit', '-q', '-m', 'x');
    assert.match(I.verifier({ refBase: '0'.repeat(40), racine: dir }).join(), /nulle/);
    assert.match(I.verifier({ refBase: undefined, racine: dir }).join(), /nulle/);
    assert.match(I.verifier({ refBase: 'deadbeef', racine: dir }).join(), /introuvable/);
  });
  test('journal historique illisible : échec (jamais assimilé à une absence)', () => {
    const { dir, g } = depot();
    etat(dir, C(), J()); ecrire(dir, 'fonda/data/set_ids-journal.json', '{ cassé');
    g('add', '.'); g('commit', '-q', '-m', 'x');
    const ref = g('rev-parse', 'HEAD');
    etat(dir, C(), J());
    assert.match(I.verifier({ refBase: ref, racine: dir }).join(), /illisible|JSON invalide/);
  });
  test('référence hors de la chaîne du premier parent : continuité rompue', () => {
    const { dir, g } = depot();
    etat(dir, C(), J()); g('add', '.'); g('commit', '-q', '-m', 'base');
    g('checkout', '-q', '-b', 'cote');
    ecrire(dir, 'x.txt', 'x'); g('add', '.'); g('commit', '-q', '-m', 'cote');
    const cote = g('rev-parse', 'HEAD');
    g('checkout', '-q', 'design');
    assert.match(I.verifier({ refBase: cote, racine: dir }).join(), /continuité rompue/);
  });
  test('mutation : sans --first-parent, les brouillons d\'une PR (tuple provisoire) font refuser à tort', () => {
    // Copie du vérificateur avec verifier-moteurs muté, dans une arborescence temporaire.
    const racineCode = fs.mkdtempSync(path.join(os.tmpdir(), 'immu-mut-'));
    for (const rel of ['fonda/scripts/verifier-immuabilite.js', 'fonda/scripts/verifier-moteurs.js', 'fonda/engine/journal-set-ids.js', 'fonda/engine/catalogue.js']) {
      fs.mkdirSync(path.dirname(path.join(racineCode, rel)), { recursive: true });
      let src = fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
      if (rel.endsWith('verifier-moteurs.js')) {
        const mutant = src.replace("git(['rev-list', '--first-parent', ref])", "git(['rev-list', ref])");
        assert.notEqual(mutant, src, 'point de mutation introuvable');
        src = mutant;
      }
      fs.writeFileSync(path.join(racineCode, rel), src);
    }
    const Mut = require(path.join(racineCode, 'fonda/scripts/verifier-immuabilite.js'));
    const { dir, g } = depot();
    etat(dir, C(), J()); g('add', '.'); g('commit', '-q', '-m', 'vide');
    const avant = g('rev-parse', 'HEAD');
    g('checkout', '-q', '-b', 'pr');
    etat(dir, C(e(A, 'sha256:brouillon', M1)), J(l(A, 'reserve'), l(A, 'publie'))); g('commit', '-q', '-am', 'brouillon');
    etat(dir, C(e(A, 'sha256:aa', M1)), J(l(A, 'reserve'), l(A, 'publie'))); g('commit', '-q', '-am', 'final');
    g('checkout', '-q', 'design');
    g('merge', '-q', '--no-ff', '-m', 'Merge', 'pr');
    assert.deepEqual(I.verifier({ refBase: avant, racine: dir }), [], 'réel : accepté');
    assert.match(Mut.verifier({ refBase: avant, racine: dir }).join(), /tuple/, 'mutant : faux refus');
  });
});
