// ============================================
// CONFIGURATION BOX
// A modifier avec vos valeurs reelles
// ============================================

const BOX_CONFIG = {
  // URLs des webhooks n8n (a remplir apres creation des workflows)
  WEBHOOK_CATALOGUE: 'https://n8n.srv868991.hstgr.cloud/webhook/box-catalogue',
  WEBHOOK_SET: 'https://n8n.srv868991.hstgr.cloud/webhook/box-set',
  WEBHOOK_QUESTION: 'https://n8n.srv868991.hstgr.cloud/webhook/box-question',
  WEBHOOK_DELETE: 'https://n8n.srv868991.hstgr.cloud/webhook/box-delete',

  // Couleurs par matiere (fond et texte du badge)
  MATIERES: {
    'Francais':            { bg: '#dbeafe', color: '#2563eb', border: '#2563eb' },
    'Mathematiques':       { bg: '#ede9fe', color: '#7c3aed', border: '#7c3aed' },
    'Histoire-Geographie': { bg: '#fef3c7', color: '#d97706', border: '#d97706' },
    'Histoire-Geo':        { bg: '#fef3c7', color: '#d97706', border: '#d97706' },
    'SVT':                 { bg: '#dcfce7', color: '#16a34a', border: '#16a34a' },
    'Physique-Chimie':     { bg: '#cffafe', color: '#0891b2', border: '#0891b2' },
    'Anglais':             { bg: '#fce7f3', color: '#db2777', border: '#db2777' },
    'Espagnol':            { bg: '#fee2e2', color: '#dc2626', border: '#dc2626' },
    'Technologie':         { bg: '#f1f5f9', color: '#475569', border: '#475569' },
    'Autre':               { bg: '#f1f5f9', color: '#64748b', border: '#64748b' }
  },

  // Niveaux dans l'ordre
  NIVEAUX: ['6e', '5e', '4e', '3e'],

  // Mode demo : si true, utilise des donnees fictives
  DEMO_MODE: false
};

// --- Donnees de demo (a retirer en production) ---
const DEMO_CATALOGUE = {
  last_updated: new Date().toISOString(),
  total_sets: 4,
  sets: [
    {
      id: 'box_demo0001',
      matiere: 'Mathematiques',
      niveau: '4e',
      notion: 'Theoreme de Pythagore',
      prof_nom: 'M. Martin',
      nb_cartes: 8,
      date_creation: '2026-03-10',
      drive_file_id: 'demo1'
    },
    {
      id: 'box_demo0002',
      matiere: 'Francais',
      niveau: '3e',
      notion: 'Les figures de style',
      prof_nom: 'Mme Dupont',
      nb_cartes: 10,
      date_creation: '2026-03-12',
      drive_file_id: 'demo2'
    },
    {
      id: 'box_demo0003',
      matiere: 'Histoire-Geo',
      niveau: '6e',
      notion: 'La civilisation romaine',
      prof_nom: 'M. Bernard',
      nb_cartes: 6,
      date_creation: '2026-03-14',
      drive_file_id: 'demo3'
    },
    {
      id: 'box_demo0004',
      matiere: 'SVT',
      niveau: '5e',
      notion: 'La digestion',
      prof_nom: 'Mme Leroy',
      nb_cartes: 7,
      date_creation: '2026-03-15',
      drive_file_id: 'demo4'
    }
  ]
};

const DEMO_SETS = {
  'box_demo0001': {
    id: 'box_demo0001',
    matiere: 'Mathematiques',
    niveau: '4e',
    notion: 'Theoreme de Pythagore',
    prof_nom: 'M. Martin',
    date_creation: '2026-03-10',
    nb_cartes: 8,
    cartes: [
      { numero: 1, question: "Qu'est-ce que l'hypotenuse d'un triangle rectangle ?", reponse: "L'hypotenuse est le cote le plus long du triangle rectangle. C'est le cote oppose a l'angle droit.", difficulte: 'facile' },
      { numero: 2, question: "Enonce le theoreme de Pythagore.", reponse: "Dans un triangle rectangle, le carre de l'hypotenuse est egal a la somme des carres des deux autres cotes. Si BC est l'hypotenuse : BC\u00b2 = AB\u00b2 + AC\u00b2.", difficulte: 'facile' },
      { numero: 3, question: "Dans un triangle ABC rectangle en A, si AB = 3 cm et AC = 4 cm, combien mesure BC ?", reponse: "BC\u00b2 = AB\u00b2 + AC\u00b2 = 9 + 16 = 25, donc BC = 5 cm.", difficulte: 'moyen' },
      { numero: 4, question: "A quoi sert la reciproque du theoreme de Pythagore ?", reponse: "Elle permet de prouver qu'un triangle est rectangle. Si l'egalite BC\u00b2 = AB\u00b2 + AC\u00b2 est verifiee, alors le triangle est rectangle.", difficulte: 'moyen' },
      { numero: 5, question: "Un triangle a pour cotes 5, 12 et 13 cm. Est-il rectangle ?", reponse: "13\u00b2 = 169 et 5\u00b2 + 12\u00b2 = 25 + 144 = 169. L'egalite est verifiee, le triangle est rectangle.", difficulte: 'moyen' },
      { numero: 6, question: "Quelle est la difference entre le theoreme direct et sa reciproque ?", reponse: "Le theoreme direct part d'un triangle rectangle pour calculer une longueur. La reciproque part des longueurs pour prouver qu'un triangle est rectangle.", difficulte: 'difficile' },
      { numero: 7, question: "Un triangle a pour cotes 4, 5 et 7 cm. Est-il rectangle ?", reponse: "7\u00b2 = 49 et 4\u00b2 + 5\u00b2 = 16 + 25 = 41. 49 \u2260 41, le triangle n'est pas rectangle.", difficulte: 'moyen' },
      { numero: 8, question: "Comment trouver un cote de l'angle droit si on connait l'hypotenuse et l'autre cote ?", reponse: "On utilise AB\u00b2 = BC\u00b2 - AC\u00b2. Par exemple si BC = 10 et AC = 6 : AB\u00b2 = 100 - 36 = 64, donc AB = 8.", difficulte: 'difficile' }
    ]
  },
  'box_demo0002': {
    id: 'box_demo0002',
    matiere: 'Francais',
    niveau: '3e',
    notion: 'Les figures de style',
    prof_nom: 'Mme Dupont',
    date_creation: '2026-03-12',
    nb_cartes: 10,
    cartes: [
      { numero: 1, question: "Qu'est-ce qu'une metaphore ?", reponse: "Une comparaison sans outil de comparaison. Exemple : 'Cette fille est un soleil'.", difficulte: 'facile' },
      { numero: 2, question: "Qu'est-ce qu'une comparaison ?", reponse: "Un rapprochement entre deux elements a l'aide d'un outil de comparaison (comme, tel, pareil a...). Exemple : 'Il est fort comme un lion'.", difficulte: 'facile' },
      { numero: 3, question: "Qu'est-ce qu'une hyperbole ?", reponse: "Une exageration volontaire pour frapper l'esprit. Exemple : 'Je meurs de faim'.", difficulte: 'moyen' },
      { numero: 4, question: "Qu'est-ce qu'une litote ?", reponse: "Dire moins pour suggerer plus. Exemple : 'Ce n'est pas mal' pour dire 'C'est bien'.", difficulte: 'moyen' },
      { numero: 5, question: "Qu'est-ce qu'une anaphore ?", reponse: "La repetition d'un mot ou groupe de mots en debut de phrase ou de vers. Exemple : 'Paris ! Paris outrage ! Paris brise !' (De Gaulle).", difficulte: 'moyen' },
      { numero: 6, question: "Qu'est-ce qu'une personnification ?", reponse: "Attribuer des caractristiques humaines a un objet, un animal ou une idee. Exemple : 'Le vent hurle'.", difficulte: 'facile' },
      { numero: 7, question: "Qu'est-ce qu'un oxymore ?", reponse: "Alliance de deux mots de sens contraires. Exemple : 'Cette obscure clarte' (Corneille).", difficulte: 'difficile' },
      { numero: 8, question: "Qu'est-ce qu'une antithese ?", reponse: "Opposition de deux idees dans une meme phrase. Exemple : 'Certains aiment le jour, d'autres preferent la nuit'.", difficulte: 'moyen' },
      { numero: 9, question: "Qu'est-ce qu'une enumeration ?", reponse: "Suite de mots ou groupes de mots de meme nature. Exemple : 'Il acheta des pommes, des poires, des bananes et des cerises'.", difficulte: 'facile' },
      { numero: 10, question: "Qu'est-ce qu'une periphrase ?", reponse: "Remplacer un mot par une expression plus longue. Exemple : 'La capitale de la France' pour 'Paris'.", difficulte: 'moyen' }
    ]
  },
  'box_demo0003': {
    id: 'box_demo0003',
    matiere: 'Histoire-Geo',
    niveau: '6e',
    notion: 'La civilisation romaine',
    prof_nom: 'M. Bernard',
    date_creation: '2026-03-14',
    nb_cartes: 6,
    cartes: [
      { numero: 1, question: "Quelle est la date traditionnelle de la fondation de Rome ?", reponse: "753 avant J.-C., selon la legende, par Romulus.", difficulte: 'facile' },
      { numero: 2, question: "Qu'est-ce que la Republique romaine ?", reponse: "Un regime politique ou le pouvoir est exerce par des magistrats elus (consuls, senateurs). Elle dure de 509 a 27 av. J.-C.", difficulte: 'moyen' },
      { numero: 3, question: "Qui est Jules Cesar ?", reponse: "Un general et homme politique romain qui a conquis la Gaule. Il a ete assassine en 44 av. J.-C.", difficulte: 'facile' },
      { numero: 4, question: "Qu'est-ce qu'un amphitheatre romain ?", reponse: "Un grand batiment ovale ou se deroulent des spectacles (combats de gladiateurs). Le plus celebre est le Colisee a Rome.", difficulte: 'facile' },
      { numero: 5, question: "Qu'est-ce que la romanisation ?", reponse: "Le processus par lequel les peuples conquis adoptent la langue, le mode de vie et la culture romaine.", difficulte: 'moyen' },
      { numero: 6, question: "En quelle annee chute l'Empire romain d'Occident ?", reponse: "En 476 apres J.-C.", difficulte: 'moyen' }
    ]
  },
  'box_demo0004': {
    id: 'box_demo0004',
    matiere: 'SVT',
    niveau: '5e',
    notion: 'La digestion',
    prof_nom: 'Mme Leroy',
    date_creation: '2026-03-15',
    nb_cartes: 7,
    cartes: [
      { numero: 1, question: "Qu'est-ce que la digestion ?", reponse: "La transformation des aliments en nutriments assimilables par l'organisme, grace a des actions mecaniques et chimiques.", difficulte: 'facile' },
      { numero: 2, question: "Quel est le role des enzymes digestives ?", reponse: "Ce sont des substances chimiques qui decoupent les grosses molecules alimentaires en molecules plus petites (nutriments).", difficulte: 'moyen' },
      { numero: 3, question: "Dans quel organe commence la digestion chimique ?", reponse: "Dans la bouche, grace a la salive qui contient l'amylase (enzyme qui decoupe l'amidon).", difficulte: 'moyen' },
      { numero: 4, question: "Quel est le role de l'estomac ?", reponse: "Il brasse les aliments et les melange au suc gastrique (acide + enzymes) pour poursuivre la digestion.", difficulte: 'facile' },
      { numero: 5, question: "Ou sont absorbes les nutriments ?", reponse: "Dans l'intestin grele, a travers les villosites intestinales qui augmentent la surface d'absorption.", difficulte: 'moyen' },
      { numero: 6, question: "Quel est le role du gros intestin ?", reponse: "Il absorbe l'eau restante et forme les matieres fecales a partir des dechets non digeres.", difficulte: 'facile' },
      { numero: 7, question: "Cite les organes du tube digestif dans l'ordre.", reponse: "Bouche, oesophage, estomac, intestin grele, gros intestin (colon), rectum, anus.", difficulte: 'facile' }
    ]
  }
};
