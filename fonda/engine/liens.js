// Liens par classe + résolution de défi — Box-FONDA (T4).
// Référence : docs/PRD-Box-FONDA.md §3.3 (calendar.json), §4 (défis), §6 ; AGENTS.md
// G1/G7. Logique PURE (zéro DOM, zéro fetch, zéro réseau) : lit des objets déjà
// chargés (classes.json, referentiel.json, calendar.json), n'écrit jamais rien. La
// couche qui fetch ces fichiers et rend le DOM est fonda/page/bootstrap.js — séparée
// pour rester testable en Node, comme correction.js/evenements.js.
//
// Rôle : pour un défi programmé « notion × niveau » dans calendar.json, décliner un
// lien par classe du niveau (GÉNÉRATION, page niveau) — et, à l'inverse, retrouver le
// contexte complet d'un defi_id ouvert par un élève (RÉSOLUTION, lien de classe). Les
// deux utilisent le MÊME format de defi_id (fonda/engine/evenements.js::DEFI_ID_PATTERN,
// via parserDefiId) : aucune chance de divergence entre ce qu'on émet et ce qu'on sait
// relire.
//
// Garde-fous G1/G7 (non négociables, hérités de T3) :
//   - `grp` ne sort JAMAIS d'une saisie élève : à la génération, il vient de
//     fonda/data/classes.json (liste fermée) ; à la résolution, il est EXTRAIT du
//     defi_id de l'URL, jamais redemandé.
//   - `notion_id`/`palier`/`set_id` viennent exclusivement de calendar.json (jamais
//     fabriqués à la volée) — resoudreContexteDefi refuse tout defi_id qui ne
//     correspond à aucune entrée réelle du calendrier.
//   - Lecture seule : ce module ne modifie jamais classes.json/referentiel.json/
//     calendar.json, et n'écrit rien (zéro appel localStorage/réseau).

(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    const ev = require('./evenements.js');
    module.exports = factory(ev.parserDefiId, ev.grpEstAutorise);
  } else {
    root.FondaLiens = factory(
      root.FondaEvenements && root.FondaEvenements.parserDefiId,
      root.FondaEvenements && root.FondaEvenements.grpEstAutorise,
    );
  }
})(typeof self !== 'undefined' ? self : this, function (parserDefiId, grpEstAutorise) {
'use strict';

// grp = 3 chiffres, le premier identifie le niveau (classes.json : 6xx/5xx/4xx/3xx).
const NIVEAU_DEPUIS_PREFIXE = { 6: '6e', 5: '5e', 4: '4e', 3: '3e' };
const PREFIXE_DEPUIS_NIVEAU = { '6e': '6', '5e': '5', '4e': '4', '3e': '3' };

// Bandes du calendrier FONDA (calendar.json v2) -> niveaux couverts. Les classes s'en
// déduisent par le préfixe (classes.json reste la liste fermée, inchangée) :
// c3 = 601–605 ; c4-milieu = 501–505 + 401–405 ; c4-fin = 301–305.
const BANDES = Object.freeze({
  c3: Object.freeze(['6e']),
  'c4-milieu': Object.freeze(['5e', '4e']),
  'c4-fin': Object.freeze(['3e']),
});

function niveauxDeLaBande(bande) {
  return Object.prototype.hasOwnProperty.call(BANDES, bande) ? BANDES[bande].slice() : [];
}

function bandeDuNiveau(niveau) {
  return Object.keys(BANDES).find((b) => BANDES[b].includes(niveau)) || null;
}

function classesDeLaBande(bande, classesAutorisees) {
  return niveauxDeLaBande(bande).flatMap((n) => classesDuNiveau(n, classesAutorisees)).sort();
}

// Une entrée concerne un niveau par son ancien `niveau_cible` (calendrier v1, conservé)
// ou par sa `bande` (v2 : une entrée c4-milieu concerne la 5e ET la 4e).
function entreeConcerneNiveau(entree, niveau) {
  if (!entree || typeof niveau !== 'string') return false;
  if (entree.niveau_cible === niveau) return true;
  return typeof entree.bande === 'string' && niveauxDeLaBande(entree.bande).includes(niveau);
}

// Seule une entrée pointant un set_id (publiée) produit un lien : une entrée planifiée
// (programme connu, fiche pas encore produite) n'a pas de set_id — jamais de lien mort.
// Défense en profondeur : statut « planifie » refusé même si un set_id traîne (le
// validateur l'interdit déjà) ; une entrée v1, sans statut, reste acceptée.
function entreeALien(entree) {
  return !!entree && entree.statut !== 'planifie' && typeof entree.set_id === 'string' && entree.set_id.length > 0;
}

function extraireNotionSlug(notionId) {
  if (typeof notionId !== 'string') return null;
  const i = notionId.indexOf('.');
  if (i <= 0 || i === notionId.length - 1) return null;
  return notionId.slice(i + 1);
}

function classesDuNiveau(niveau, classesAutorisees) {
  const prefixe = PREFIXE_DEPUIS_NIVEAU[niveau];
  if (!prefixe) return [];
  const classes = classesAutorisees instanceof Set ? [...classesAutorisees] : (classesAutorisees || []);
  return classes.filter((c) => typeof c === 'string' && c[0] === prefixe).slice().sort();
}

function genererDefiId({ annee, semaine, grp, notionSlug }) {
  return `defi_${annee}-w${semaine}_${grp}_${notionSlug}`;
}

// Décline, pour un niveau et une semaine donnés, un lien par classe du niveau pour
// chaque entrée programmée (notion × niveau) de cette semaine. `entreesNiveau` :
// sous-ensemble DÉJÀ FILTRÉ de `semaine.entrees` pour ce niveau (évite que ce module
// ait besoin de connaître la forme exacte du calendrier pour la génération simple).
function genererLiensNiveau({ niveau, annee, semaine, entreesNiveau, classesAutorisees }) {
  const classes = classesDuNiveau(niveau, classesAutorisees);
  const liens = [];
  for (const entree of entreesNiveau || []) {
    if (!entreeALien(entree)) continue; // entrée planifiée : aucun lien
    const slug = extraireNotionSlug(entree.notion_id);
    if (!slug) continue; // notion_id absent/malformé : on n'invente pas de lien
    for (const grp of classes) {
      liens.push({
        grp,
        notionId: entree.notion_id,
        palier: entree.palier,
        setId: entree.set_id,
        defiId: genererDefiId({ annee, semaine, grp, notionSlug: slug }),
      });
    }
  }
  return liens;
}

// Retrouve, dans le calendrier, la semaine dont le numéro ISO correspond à celui
// encodé dans un defi_id (comparaison numérique : "41" === "041" === 41).
function trouverSemaine(calendrier, semaineRecherchee) {
  const semaines = (calendrier && Array.isArray(calendrier.semaines)) ? calendrier.semaines : [];
  const cible = Number(semaineRecherchee);
  return semaines.find((s) => Number(s.iso_week) === cible) || null;
}

/**
 * Résout le contexte complet d'un defi_id ouvert par un élève (lien de classe), à
 * partir UNIQUEMENT du vrai calendrier et du vrai roster — jamais d'invention. Si
 * quoi que ce soit ne correspond pas à une entrée réelle, `valide: false` : c'est le
 * signal pour la page de basculer en mode entraînement, sans émettre d'événement.
 * @returns {{valide:true, grp, notionId, palier, setId} | {valide:false}}
 */
function resoudreContexteDefi({ defiId, calendrier, classesAutorisees }) {
  const parse = parserDefiId(defiId);
  if (!parse) return { valide: false };
  if (!grpEstAutorise(parse.grp, classesAutorisees)) return { valide: false };

  const niveau = NIVEAU_DEPUIS_PREFIXE[parse.grp[0]];
  if (!niveau) return { valide: false };

  const semaineEntry = trouverSemaine(calendrier, parse.semaine);
  if (!semaineEntry) return { valide: false };

  const entrees = Array.isArray(semaineEntry.entrees) ? semaineEntry.entrees : [];
  const entree = entrees.find(
    (e) => entreeALien(e) && entreeConcerneNiveau(e, niveau) && extraireNotionSlug(e.notion_id) === parse.notionSlug,
  );
  if (!entree) return { valide: false };

  return {
    valide: true,
    grp: parse.grp,
    notionId: entree.notion_id,
    palier: entree.palier,
    setId: entree.set_id,
  };
}

return {
  BANDES,
  niveauxDeLaBande,
  bandeDuNiveau,
  classesDeLaBande,
  entreeConcerneNiveau,
  entreeALien,
  extraireNotionSlug,
  classesDuNiveau,
  genererDefiId,
  genererLiensNiveau,
  resoudreContexteDefi,
};

}); // fin UMD
