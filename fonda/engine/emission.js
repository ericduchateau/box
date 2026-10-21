// Émission réseau de la file locale — Box-FONDA (T5). Vide la file construite par T3
// (fonda/engine/evenements.js) vers le webhook de collecte n8n, un événement à la
// fois, en ne retirant JAMAIS un événement de la file avant confirmation explicite du
// serveur. Référence : docs/PRD-Box-FONDA.md §2, §3.2 ; AGENTS.md G2/G3.
//
// Zéro dépendance : format UMD, comme les autres modules fonda/engine/. Ce fichier ne
// fait JAMAIS lui-même de fetch/réseau : la fonction d'envoi (`envoyer`) est INJECTÉE,
// exactement comme `stockage` l'est dans evenements.js — testable sans réseau, et
// l'appelant (T4/intégration) choisit l'implémentation réelle (fetch) et l'URL.
//
// Garde-fous (non négociables) :
//   - Le corps envoyé est reconstruit CHAMP PAR CHAMP (jamais par spread/copie de
//     l'événement stocké) : exactement les 11 champs du schéma §3.2, rien d'autre —
//     même si l'événement en file contenait par accident un champ étranger (ex. une
//     corruption de stockage), il ne peut pas fuiter dans la requête réseau.
//   - Revalidé par le validateur de T1 juste avant l'envoi (défense en profondeur) :
//     un événement devenu invalide n'est jamais envoyé, mais ne bloque pas les
//     suivants (il est signalé séparément, pas silencieusement perdu ni confondu avec
//     un échec réseau).
//   - Un événement n'est retiré de la file QUE sur réponse serveur positive
//     (`envoyer` résout à `true`) — un échec réseau, une exception, ou une réponse
//     négative le laissent en file strictement inchangé : le prochain appel renverra
//     EXACTEMENT le même objet (même `ts`), jamais une reconstruction.
//   - Pas d'URL configurée (`webhookUrl` absent/vide) → mode dégradé : aucune
//     tentative, aucune exception, la file reste intacte pour un envoi ultérieur.
//     Ne bloque jamais la révision de l'élève.
//   - Jamais d'exception propagée, quoi qu'il arrive (stockage, réseau, ou données
//     corrompues) — cohérent avec evenements.js.

(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    const ev = require('./evenements.js');
    const validate = require('../scripts/validate.js');
    module.exports = factory(ev.lireFile, ev.retirerDeFile, ev.formeEvenementPlausible, validate.validerEvenement);
  } else {
    const ev = root.FondaEvenements || {};
    const validate = root.FondaValidate || {};
    root.FondaEmission = factory(ev.lireFile, ev.retirerDeFile, ev.formeEvenementPlausible, validate.validerEvenement);
  }
})(typeof self !== 'undefined' ? self : this, function (lireFile, retirerDeFile, formeEvenementPlausible, validerEvenement) {
'use strict';

// Liste blanche stricte, reconstruite ici pour ne JAMAIS dépendre d'un spread de
// l'événement stocké — un champ étranger ne peut matériellement pas apparaître dans
// le corps envoyé, quelle qu'en soit l'origine.
function construireCorps(event) {
  const e = event || {};
  return {
    ts: e.ts,
    grp: e.grp,
    defi_id: e.defi_id,
    notion_id: e.notion_id,
    palier: e.palier,
    set_id: e.set_id,
    item_id: e.item_id,
    result: e.result,
    ctx: e.ctx,
    rang_local: e.rang_local,
    dt_jours: e.dt_jours,
  };
}

/**
 * Vide la file locale (T3) vers le webhook de collecte, un événement à la fois, dans
 * l'ordre. Ne retire un événement que sur succès confirmé.
 *
 * @param {object} p
 * @param {{getItem:Function,setItem:Function}} p.stockage - ex. window.localStorage, injecté
 * @param {string} [p.webhookUrl] - URL du webhook POST /box-fonda-events ; absent/vide = mode dégradé
 * @param {(url:string, corps:object) => Promise<boolean>} p.envoyer - true = succès confirmé par le serveur
 * @returns {Promise<{tentes:number, envoyes:number, echecs:number, invalides:number}>}
 */
async function viderFileEvenements({ stockage, webhookUrl, envoyer }) {
  const resultat = { tentes: 0, envoyes: 0, echecs: 0, invalides: 0 };

  if (!webhookUrl) return resultat; // mode dégradé : rien ne bloque, rien n'est tenté

  let file;
  try {
    file = lireFile(stockage);
  } catch {
    return resultat;
  }
  if (!Array.isArray(file)) return resultat; // stockage indisponible/corrompu

  for (const event of file) {
    resultat.tentes += 1;
    const corps = construireCorps(event);

    const validation = validerEvenement(corps, [corps.notion_id]);
    // Au-delà de la liste blanche des 11 champs : contrôle de FORME (grp à 3 chiffres
    // cohérent avec defi_id, notion_id du pattern référentiel, identifiants sans texte
    // libre, ts tronqué à l'heure) — défense en profondeur contre une file altérée ou
    // un appel direct au webhook qui contournerait soumettreTentative (T3).
    if (!validation.valide || !formeEvenementPlausible(corps)) {
      resultat.invalides += 1;
      continue; // jamais envoyé, jamais bloquant pour les suivants
    }

    let ok = false;
    try {
      ok = await envoyer(webhookUrl, corps);
    } catch {
      ok = false;
    }

    if (ok) {
      resultat.envoyes += 1;
      try {
        retirerDeFile(stockage, [event]);
      } catch {
        // Le retrait a échoué (stockage devenu indisponible entre-temps) : l'événement
        // sera réémis au prochain passage. Duplication possible côté serveur, jamais
        // de perte — limite documentée (fonda/engine/README.md).
      }
    } else {
      resultat.echecs += 1; // reste en file, rien à faire
    }
  }

  return resultat;
}

return {
  viderFileEvenements,
};

}); // fin UMD
