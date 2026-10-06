#!/usr/bin/env node
// Script one-shot — construit une FIXTURE TECHNIQUE (T6a) qui exerce la chaîne de
// génération (ids, schéma, anti-clone, routage) sur un contenu rédigé À LA MAIN, et
// la dépose en file de relecture.
// Référence : docs/PRD-Box-FONDA.md §3.6, §5.1, §9, §11, §12 ; AGENTS.md G3, G4, G5 ;
// fonda/data/referentiel.json (v2, convention.variete_generation).
//
// REQUALIFIÉ après critique Codex (T6a, voir AVANCEMENT.md) : CE N'EST PAS un
// échantillon validé de qualité pédagogique. Rejoué contre le vrai correcteur
// (fonda/engine/correction.js), 42/144 réponses de référence de ce lot échouent —
// 11 par symbole `€` (hors grammaire des unités), 1 encadrement à deux valeurs en
// profil `numerique`, 30 par absence d'un champ `unite` sur des cartes dont la
// réponse porte une unité physique. Classement (a) correcteur à élargir / (b) carte
// mal typée produit et soumis à Éric — AUCUNE correction appliquée ici tant qu'il
// n'a pas validé la répartition (ticket T6a, point 3). Des défauts éditoriaux
// (biais de réponse, amorces proches du modèle, mesure à côté de la compétence)
// ont aussi été relevés — non corrigés ici, c'est le rôle de la relecture humaine.
//
// CE QUE CE SCRIPT EST : la chaîne (ids système, schéma, anti-clone, routage —
// fonda/engine/generation.js) exercée sur un contenu RÉEL mais écrit à la main par
// Éric/Claude Code, PAS par un appel API à un modèle. Aucune credential modèle n'est
// câblée dans cet environnement ; l'appel réel à un modèle fort (Sonnet, G5) pour
// générer le VRAI lot pilote reste la dette ouverte 🔖 T6b (voir AVANCEMENT.md),
// distincte de la dette ids (celle-ci, levée par fonda/engine/generation.js).
//
// CE QUE CE SCRIPT N'EST PAS : pas un moteur de génération récurrent (Moteur B,
// §9 — déclenchement auto sur ⬛, hors scope T6), pas une écriture n8n (zéro appel
// réseau, zéro action n8n), pas une publication (statut toujours "attente").
//
// Sortie : fonda/data/pilote-t6-relecture.json — committée, lue par personne pour
// l'instant (pas de nouveau lecteur applicatif en T6) ; prête à être consommée par un
// futur câblage n8n (hors scope ici, cf. AVANCEMENT.md : le mécanisme de relecture
// existant route par email du prof soumissionnaire, PAS par relecteur nommé — un
// écart documenté, pas un bug de ce script).
//
// Usage : node fonda/scripts/generer-pilote-t6.js

'use strict';

const fs = require('fs');
const path = require('path');
const {
  genererSetId,
  genererItemId,
  relecteurDepuisMatiere,
  validerCandidate,
  validerJeu,
  deposerEnRelecture,
  SOURCE_PILOTE,
} = require('../engine/generation.js');

const ROOT = path.resolve(__dirname, '..');
const REFERENTIEL_PATH = path.join(ROOT, 'data', 'referentiel.json');
const SORTIE_PATH = path.join(ROOT, 'data', 'pilote-t6-relecture.json');

// Horodatage UNIQUE pour tout le lot — c'est un batch one-shot, pas un flux continu.
const TS_GENERATION = '2026-10-06T09:00:00.000Z';

// ---------------------------------------------------------------------------
// Contenu pédagogique du lot pilote — RÉDIGÉ À LA MAIN (pas d'appel API).
// `enonce_modele` du référentiel est une AMORCE : chaque carte ci-dessous varie le
// contexte (situation, discipline, nombres) par rapport à l'amorce et aux autres
// cartes du même jeu (convention.variete_generation, referentiel.json). Respecte la
// spec de clarté §11 : un seul attendu, réponse courte, vocabulaire accessible.
// nI = version accessible/amorce ; nF = version aboutie/transfert simple (§11).
// ---------------------------------------------------------------------------
const CONTENU_PAR_NOTION = {
  'fr.comprendre-consigne': {
    nI: [
      { contexte: 'notice-jeu-societe', question: "Tu veux connaître le nombre de joueurs autorisé pour un jeu de société. La notice contient : A) les règles de score, B) le nombre de joueurs mini/maxi, C) l'historique du jeu. Quelle partie lis-tu ?", reponse: 'B', reponses_acceptees: ['B', 'b'], profil_correction: 'exact', difficulte: 'facile' },
      { contexte: 'recette-cuisine', question: "Tu veux savoir au bout de combien de temps sortir le gâteau du four. La recette contient : A) la liste des ingrédients, B) le temps et la température de cuisson, C) le nombre de parts. Quelle partie lis-tu ?", reponse: 'B', reponses_acceptees: ['B', 'b'], profil_correction: 'exact', difficulte: 'facile' },
      { contexte: 'reglement-sportif', question: "Tu veux savoir si toucher le ballon avec la main est une faute. Le règlement contient : A) les horaires des matchs, B) les fautes autorisées/interdites, C) la liste des arbitres. Quelle partie lis-tu ?", reponse: 'B', reponses_acceptees: ['B', 'b'], profil_correction: 'exact', difficulte: 'facile' },
      { contexte: 'programme-cinema', question: "Tu veux savoir à quelle heure commence le film. Le programme contient : A) le résumé du film, B) les horaires des séances, C) le nom des acteurs. Quelle partie lis-tu ?", reponse: 'B', reponses_acceptees: ['B', 'b'], profil_correction: 'exact', difficulte: 'facile' },
      { contexte: 'notice-velo', question: "Tu veux savoir comment régler la hauteur de la selle. La notice contient : A) le prix du vélo, B) les étapes de montage et réglage, C) la garantie. Quelle partie lis-tu ?", reponse: 'B', reponses_acceptees: ['B', 'b'], profil_correction: 'exact', difficulte: 'moyen' },
      { contexte: 'brochure-musee', question: "Tu veux savoir si l'entrée est gratuite le dimanche. La brochure contient : A) le plan des salles, B) les tarifs et horaires, C) la liste des œuvres. Quelle partie lis-tu ?", reponse: 'B', reponses_acceptees: ['B', 'b'], profil_correction: 'exact', difficulte: 'moyen' },
    ],
    nF: [
      { contexte: 'notice-four-electrique', question: "Tu veux savoir si le plat passe au lave-vaisselle. La notice contient : A) le temps de cuisson, B) l'entretien et le nettoyage, C) la liste des accessoires fournis. Quelle partie lis-tu ?", reponse: 'B', reponses_acceptees: ['B', 'b'], profil_correction: 'exact', difficulte: 'moyen' },
      { contexte: 'contrat-abonnement-sport', question: "Tu veux savoir si tu peux annuler ton abonnement avant 1 mois. Le contrat contient : A) les tarifs, B) les conditions de résiliation, C) les horaires d'ouverture. Quelle partie lis-tu ?", reponse: 'B', reponses_acceptees: ['B', 'b'], profil_correction: 'exact', difficulte: 'moyen' },
      { contexte: 'notice-jeu-video', question: "Tu veux savoir à partir de quel âge le jeu est conseillé. La notice contient : A) la configuration minimale, B) la classification d'âge, C) le mode multijoueur. Quelle partie lis-tu ?", reponse: 'B', reponses_acceptees: ['B', 'b'], profil_correction: 'exact', difficulte: 'moyen' },
      { contexte: 'billet-train', question: "Tu veux savoir si ton billet est remboursable en cas d'annulation. Le billet contient : A) le numéro de voiture, B) les conditions d'échange et de remboursement, C) l'horaire de départ. Quelle partie lis-tu ?", reponse: 'B', reponses_acceptees: ['B', 'b'], profil_correction: 'exact', difficulte: 'difficile' },
      { contexte: 'notice-medicament-enfant', question: "Tu veux savoir la dose maximale par jour. La notice contient : A) les effets indésirables, B) la posologie, C) la date de péremption. Quelle partie lis-tu ?", reponse: 'B', reponses_acceptees: ['B', 'b'], profil_correction: 'exact', difficulte: 'difficile' },
      { contexte: 'reglement-concours', question: "Tu veux savoir si tu as droit à plusieurs participations. Le règlement contient : A) les modalités de participation, B) le calendrier du concours, C) la liste des lots. Quelle partie lis-tu ?", reponse: 'A', reponses_acceptees: ['A', 'a'], profil_correction: 'exact', difficulte: 'moyen' },
    ],
  },

  'fr.changer-representation': {
    nI: [
      { contexte: 'tableau-meteo-semaine', question: "Le tableau donne les températures de la semaine : lundi 12°C, mardi 15°C, mercredi 9°C. Quel jour fait-il le plus froid ?", reponse: 'mercredi', reponses_acceptees: ['mercredi', 'Mercredi'], profil_correction: 'sens', difficulte: 'facile' },
      { contexte: 'graphique-frequentation-piscine', question: "Le graphique montre les entrées à la piscine : juin 200, juillet 500, août 350. Quel mois a eu le plus d'entrées ?", reponse: 'juillet', reponses_acceptees: ['juillet'], profil_correction: 'sens', difficulte: 'facile' },
      { contexte: 'carte-villes-france', question: "Sur la carte, Lille est au nord et Marseille au sud. Une flèche va de Lille vers Marseille. Vers quelle direction pointe-t-elle ?", reponse: 'sud', reponses_acceptees: ['sud', 'le sud'], profil_correction: 'sens', difficulte: 'facile' },
      { contexte: 'tableau-budget-club', question: "Le tableau du club indique : cotisations 800€, matériel 500€, goûters 100€. Quelle dépense est la plus élevée ?", reponse: 'cotisations', reponses_acceptees: ['cotisations', 'les cotisations'], profil_correction: 'sens', difficulte: 'facile' },
      { contexte: 'schema-cycle-eau', question: "Sur le schéma du cycle de l'eau, une flèche part du nuage et descend vers le sol. Quel phénomène représente cette flèche ?", reponse: 'pluie', reponses_acceptees: ['pluie', 'précipitations'], profil_correction: 'sens', difficulte: 'moyen' },
      { contexte: 'diagramme-repartition-sportifs', question: "Le diagramme montre : football 40%, basket 30%, natation 30%. Quel sport est pratiqué par le plus d'élèves ?", reponse: 'football', reponses_acceptees: ['football', 'le football'], profil_correction: 'sens', difficulte: 'moyen' },
    ],
    nF: [
      { contexte: 'tableau-vitesse-etapes-course', question: "Une course a 3 étapes : étape 1, 10 km en 1h ; étape 2, 20 km en 3h ; étape 3, 15 km en 1h. Sur un graphique de vitesse, quelle étape aurait la vitesse la plus faible ?", reponse: 'étape 2', reponses_acceptees: ['étape 2', '2', "l'étape 2"], profil_correction: 'sens', difficulte: 'moyen' },
      { contexte: 'tableau-double-entree-notes', question: "Un tableau croise matière et trimestre : maths 12, 14, 16 (T1 à T3) ; français 15, 14, 13 (T1 à T3). Dans quelle matière la moyenne augmente-t-elle au fil des trimestres ?", reponse: 'maths', reponses_acceptees: ['maths', 'en maths'], profil_correction: 'sens', difficulte: 'moyen' },
      { contexte: 'graphique-population-deux-villes', question: "Un graphique montre la population de deux villes entre 2000 et 2020 : ville A passe de 10 000 à 15 000 habitants, ville B de 20 000 à 18 000. Quelle ville a vu sa population baisser ?", reponse: 'ville b', reponses_acceptees: ['ville b', 'b', 'ville B'], profil_correction: 'sens', difficulte: 'moyen' },
      { contexte: 'carte-relief-region', question: "Sur une carte de relief, les zones foncées représentent les hautes altitudes. Une zone très foncée au centre de la carte correspond à quoi ?", reponse: 'montagne', reponses_acceptees: ['montagne', 'une montagne', 'massif'], profil_correction: 'sens', difficulte: 'difficile' },
      { contexte: 'tableau-resultats-sportifs-equipes', question: "Un tableau donne le nombre de victoires sur 10 matchs : équipe A 7, équipe B 4, équipe C 9. En classant du meilleur au moins bon, qui est 2e ?", reponse: 'équipe a', reponses_acceptees: ['équipe a', 'a', 'équipe A'], profil_correction: 'sens', difficulte: 'difficile' },
      { contexte: 'diagramme-energie-electrique-france', question: "Un diagramme montre la production d'électricité par source : nucléaire 65%, renouvelable 25%, autre 10%. Quelle source représente moins d'un quart de la production ?", reponse: 'autre', reponses_acceptees: ['autre', "l'autre"], profil_correction: 'sens', difficulte: 'difficile' },
    ],
  },

  'maths.geometrie': {
    nI: [
      { contexte: 'jardin-rectangulaire', question: 'Un jardin rectangulaire mesure 8 m sur 5 m. Quelle est son aire ?', reponse: '40 m²', reponses_acceptees: ['40 m²', '40'], profil_correction: 'numerique', difficulte: 'facile' },
      { contexte: 'terrain-de-sport', question: 'Un terrain de basket mesure 15 m sur 8 m. Quel est son périmètre ?', reponse: '46 m', reponses_acceptees: ['46 m', '46'], profil_correction: 'numerique', difficulte: 'facile' },
      { contexte: 'tapis-salon', question: 'Un tapis rectangulaire mesure 3 m de long et 2 m de large. Quelle est son aire ?', reponse: '6 m²', reponses_acceptees: ['6 m²', '6'], profil_correction: 'numerique', difficulte: 'facile' },
      { contexte: 'triangle-voile-bateau', question: 'Une voile triangulaire a une base de 4 m et une hauteur de 3 m. Quelle est son aire ?', reponse: '6 m²', reponses_acceptees: ['6 m²', '6'], profil_correction: 'numerique', difficulte: 'moyen' },
      { contexte: 'affiche-rectangulaire', question: 'Une affiche mesure 120 cm sur 80 cm. Quelle est son aire en m² ?', reponse: '0,96 m²', reponses_acceptees: ['0,96 m²', '0.96 m²', '0,96', '0.96'], profil_correction: 'numerique', difficulte: 'moyen' },
      { contexte: 'terrain-foot-miniature', question: 'Un terrain de mini-foot mesure 20 m sur 10 m. Quelle est son aire ?', reponse: '200 m²', reponses_acceptees: ['200 m²', '200'], profil_correction: 'numerique', difficulte: 'moyen' },
    ],
    nF: [
      { contexte: 'terrain-en-l-jardin', question: "Un terrain en forme de L se découpe en deux rectangles : 6 m × 4 m et 3 m × 2 m. Quelle est l'aire totale du terrain ?", reponse: '30 m²', reponses_acceptees: ['30 m²', '30'], profil_correction: 'numerique', difficulte: 'moyen' },
      { contexte: 'cadre-photo-bordure', question: "Un cadre mesure 30 cm sur 20 cm à l'extérieur, avec une bordure de 2 cm tout autour. Quelle est l'aire de la photo visible, sans la bordure ?", reponse: '416 cm²', reponses_acceptees: ['416 cm²', '416'], profil_correction: 'numerique', difficulte: 'difficile' },
      { contexte: 'expression-aire-rectangle-ab', question: "Un rectangle a pour longueur « a » et pour largeur « b ». Quelle est l'expression de son aire ?", reponse: 'a × b', reponses_acceptees: ['a × b', 'a×b', 'ab', 'a x b'], profil_correction: 'exact', difficulte: 'moyen' },
      { contexte: 'parcelle-perimetre-connu', question: 'Une parcelle rectangulaire a un périmètre de 60 m et une longueur de 20 m. Quelle est sa largeur ?', reponse: '10 m', reponses_acceptees: ['10 m', '10'], profil_correction: 'numerique', difficulte: 'moyen' },
      { contexte: 'triangle-rectangle-cathetes', question: 'Un triangle rectangle a deux côtés (cathètes) de 6 cm et 8 cm. Quelle est son aire ?', reponse: '24 cm²', reponses_acceptees: ['24 cm²', '24'], profil_correction: 'numerique', difficulte: 'difficile' },
      { contexte: 'salle-carrelage-longueur-inconnue', question: 'Une salle rectangulaire a une aire de 24 m² et une largeur de 4 m. Quelle est sa longueur ?', reponse: '6 m', reponses_acceptees: ['6 m', '6'], profil_correction: 'numerique', difficulte: 'difficile' },
    ],
  },

  'maths.grandeurs-mesures': {
    nI: [
      { contexte: 'cycliste-trajet', question: 'Un cycliste roule à 15 km/h pendant 2 heures. Quelle distance parcourt-il ?', reponse: '30 km', reponses_acceptees: ['30 km', '30'], profil_correction: 'numerique', difficulte: 'facile' },
      { contexte: 'echarpe-conversion-longueur', question: 'Une écharpe mesure 150 cm. Combien cela fait-il en mètres ?', reponse: '1,5 m', reponses_acceptees: ['1,5 m', '1.5 m', '1,5', '1.5'], profil_correction: 'numerique', difficulte: 'facile' },
      { contexte: 'bouteille-eau-volume', question: "Une bouteille contient 1,5 L d'eau. Combien cela fait-il en cL ?", reponse: '150 cL', reponses_acceptees: ['150 cL', '150'], profil_correction: 'numerique', difficulte: 'facile' },
      { contexte: 'colis-poste-masse', question: 'Un colis pèse 2,3 kg. Combien cela fait-il en grammes ?', reponse: '2300 g', reponses_acceptees: ['2300 g', '2300'], profil_correction: 'numerique', difficulte: 'moyen' },
      { contexte: 'cuisson-gateau-duree', question: "Un gâteau cuit pendant 45 min, en commençant à 14h30. À quelle heure sort-il du four ?", reponse: '15h15', reponses_acceptees: ['15h15', '15 h 15'], profil_correction: 'exact', difficulte: 'moyen' },
      { contexte: 'piscine-remplissage-debit', question: 'Un robinet remplit une piscine à 10 L par minute pendant 5 minutes. Quel volume est versé ?', reponse: '50 L', reponses_acceptees: ['50 L', '50'], profil_correction: 'numerique', difficulte: 'moyen' },
    ],
    nF: [
      { contexte: 'voiture-vitesse-moyenne', question: 'Une voiture parcourt 180 km en 3 heures. Quelle est sa vitesse moyenne ?', reponse: '60 km/h', reponses_acceptees: ['60 km/h', '60'], profil_correction: 'numerique', difficulte: 'moyen' },
      { contexte: 'salon-largeur-inconnue', question: 'Un salon a une aire de 56 m² et une longueur de 8 m. Quelle est sa largeur ?', reponse: '7 m', reponses_acceptees: ['7 m', '7'], profil_correction: 'numerique', difficulte: 'moyen' },
      { contexte: 'train-deux-etapes-vitesse', question: 'Un train roule à 80 km/h pendant 1h30, puis à 100 km/h pendant 1h. Quelle distance totale parcourt-il ?', reponse: '220 km', reponses_acceptees: ['220 km', '220'], profil_correction: 'numerique', difficulte: 'difficile' },
      { contexte: 'reservoir-essence-consommation', question: 'Une voiture consomme 6 L aux 100 km. Combien consomme-t-elle pour un trajet de 250 km ?', reponse: '15 L', reponses_acceptees: ['15 L', '15'], profil_correction: 'numerique', difficulte: 'difficile' },
      { contexte: 'terrain-conversion-hectare', question: 'Un terrain mesure 5000 m². Combien cela fait-il en hectares ?', reponse: '0,5 ha', reponses_acceptees: ['0,5 ha', '0.5 ha', '0,5', '0.5'], profil_correction: 'numerique', difficulte: 'difficile' },
      { contexte: 'fontaine-debit-temps', question: 'Une fontaine coule à 4 L par minute. Combien de temps faut-il pour remplir un seau de 20 L ?', reponse: '5 min', reponses_acceptees: ['5 min', '5'], profil_correction: 'numerique', difficulte: 'moyen' },
    ],
  },

  'maths.resolution-problemes': {
    nI: [
      { contexte: 'argent-poche-achats', question: 'Léo a 20€. Il achète un livre à 8€ et un cahier à 3€. Combien lui reste-t-il ?', reponse: '9 €', reponses_acceptees: ['9 €', '9'], profil_correction: 'numerique', difficulte: 'facile' },
      { contexte: 'partage-bonbons-amis', question: '36 bonbons sont partagés à parts égales entre 4 amis. Combien chacun reçoit-il ?', reponse: '9', reponses_acceptees: ['9'], profil_correction: 'numerique', difficulte: 'facile' },
      { contexte: 'billets-cinema-groupe', question: 'Un billet de cinéma coûte 7€. Combien coûtent 5 billets ?', reponse: '35 €', reponses_acceptees: ['35 €', '35'], profil_correction: 'numerique', difficulte: 'facile' },
      { contexte: 'jardin-plants-rangees', question: 'Un jardinier plante 48 plants en rangées égales de 6 plants. Combien de rangées fait-il ?', reponse: '8', reponses_acceptees: ['8'], profil_correction: 'numerique', difficulte: 'moyen' },
      { contexte: 'gouter-classe-paquets', question: 'Pour un goûter, on achète 3 paquets de 12 gâteaux. Combien de gâteaux au total ?', reponse: '36', reponses_acceptees: ['36'], profil_correction: 'numerique', difficulte: 'moyen' },
      { contexte: 'location-velo-tarif', question: 'Louer un vélo coûte 5€ plus 2€ par heure. Combien coûte une location de 3 heures ?', reponse: '11 €', reponses_acceptees: ['11 €', '11'], profil_correction: 'numerique', difficulte: 'moyen' },
    ],
    nF: [
      { contexte: 'solde-pull-boutique', question: 'Un pull coûte 40€. Il est soldé à -25%. Quel est son nouveau prix ?', reponse: '30 €', reponses_acceptees: ['30 €', '30'], profil_correction: 'numerique', difficulte: 'moyen' },
      { contexte: 'sortie-classe-subvention', question: 'Une classe de 28 élèves organise une sortie à 12€ par élève, avec 50€ de subvention. Quel est le coût total restant à payer par les élèves ?', reponse: '286 €', reponses_acceptees: ['286 €', '286'], profil_correction: 'numerique', difficulte: 'difficile' },
      { contexte: 'partage-cartes-proportionnel', question: 'Un lot de 90 cartes est partagé entre 3 personnes dans le rapport 1:2:3. Combien la personne avec la plus petite part reçoit-elle ?', reponse: '15', reponses_acceptees: ['15'], profil_correction: 'numerique', difficulte: 'difficile' },
      { contexte: 'reservoir-vidage-debit', question: "Un réservoir de 120 L, plein, se vide à 4 L par minute. Combien de temps faut-il pour qu'il reste 40 L ?", reponse: '20 min', reponses_acceptees: ['20 min', '20'], profil_correction: 'numerique', difficulte: 'moyen' },
      { contexte: 'voyage-comparaison-prix-personne', question: "Un voyage coûte 450€ pour 3 personnes, ou 560€ pour 4 personnes (même formule). Quel est le prix par personne le plus bas entre les deux options ?", reponse: '140 €', reponses_acceptees: ['140 €', '140'], profil_correction: 'numerique', difficulte: 'difficile' },
      { contexte: 'reussite-controle-pourcentage', question: "Dans une classe de 25 élèves, 80% ont réussi un contrôle. Combien d'élèves ont réussi ?", reponse: '20', reponses_acceptees: ['20'], profil_correction: 'numerique', difficulte: 'moyen' },
    ],
  },

  'fr.inference-implicite': {
    nI: [
      { contexte: 'recit-personnage-fatigue', question: "« Léa s'assit lourdement sur le canapé, les yeux mi-clos, sans dire un mot. » Comment se sent Léa ?", reponse: 'fatiguée', reponses_acceptees: ['fatiguée', 'fatigué', 'épuisée'], profil_correction: 'sens', difficulte: 'facile' },
      { contexte: 'recit-personnage-colere', question: "« Il serra les poings et claqua la porte derrière lui. » Quel sentiment ressent ce personnage ?", reponse: 'colère', reponses_acceptees: ['colère', 'énervement', 'rage'], profil_correction: 'sens', difficulte: 'facile' },
      { contexte: 'recit-lieu-hiver', question: "« Les flocons tombaient doucement sur les toits silencieux du village. » En quelle saison se passe la scène ?", reponse: 'hiver', reponses_acceptees: ['hiver'], profil_correction: 'sens', difficulte: 'facile' },
      { contexte: 'recit-personnage-timide', question: "« Elle rougit et baissa les yeux avant de murmurer sa réponse. » Quel trait de caractère montre ce personnage ?", reponse: 'timide', reponses_acceptees: ['timide', 'timidité'], profil_correction: 'sens', difficulte: 'moyen' },
      { contexte: 'recit-indice-richesse', question: "« La villa comptait dix pièces, une piscine et trois voitures dans le garage. » Que peut-on déduire de cette famille ?", reponse: 'riche', reponses_acceptees: ['riche', 'elle est riche', 'aisée'], profil_correction: 'sens', difficulte: 'moyen' },
      { contexte: 'recit-personnage-inquiet', question: "« Elle regardait sa montre toutes les deux minutes, les mains moites. » Quel sentiment éprouve-t-elle ?", reponse: 'inquiétude', reponses_acceptees: ['inquiétude', 'stress', 'anxiété', 'inquiet'], profil_correction: 'sens', difficulte: 'moyen' },
    ],
    nF: [
      { contexte: 'extrait-deux-indices-jalousie', question: "« Elle sourit poliment en félicitant son amie, mais serra les dents en apprenant la nouvelle. » En croisant ces deux indices, que ressent-elle vraiment ?", reponse: 'jalousie', reponses_acceptees: ['jalousie', 'jalouse', 'envie'], profil_correction: 'sens', difficulte: 'moyen' },
      { contexte: 'extrait-contexte-historique-guerre', question: "« Les rues étaient vides, les volets fermés, et l'on entendait au loin le bruit sourd des bombardements. » À quelle période historique ce passage fait-il penser ?", reponse: 'guerre', reponses_acceptees: ['guerre', 'une guerre', 'période de guerre'], profil_correction: 'sens', difficulte: 'moyen' },
      { contexte: 'extrait-deux-indices-mensonge', question: "« Il évitait son regard et changeait sans cesse de sujet quand on parlait de la soirée. » Que peut-on en déduire ?", reponse: 'il cache quelque chose', reponses_acceptees: ['il cache quelque chose', 'il ment', 'il a menti'], profil_correction: 'sens', difficulte: 'difficile' },
      { contexte: 'extrait-ambiance-tendue-repas', question: "« Le repas se déroula en silence, chacun fixant son assiette, évitant soigneusement un sujet que tous connaissaient. » Quelle est l'ambiance de ce repas ?", reponse: 'tendue', reponses_acceptees: ['tendue', 'tension', 'malaise'], profil_correction: 'sens', difficulte: 'difficile' },
      { contexte: 'extrait-deception-lettre', question: "« Il relut la lettre deux fois, puis la plia lentement avant de la ranger sans un mot. » Que ressent-il probablement ?", reponse: 'déception', reponses_acceptees: ['déception', 'déçu', 'tristesse'], profil_correction: 'sens', difficulte: 'difficile' },
      { contexte: 'extrait-soulagement-retour', question: "« Quand elle aperçut enfin la voiture dans l'allée, ses épaules se détendirent d'un coup. » Quel sentiment traduit ce geste ?", reponse: 'soulagement', reponses_acceptees: ['soulagement', 'soulagée', 'rassurée'], profil_correction: 'sens', difficulte: 'difficile' },
    ],
  },

  'maths.proportionnalite': {
    nI: [
      { contexte: 'recette-doses-ingredients', question: 'Une recette pour 4 personnes demande 200 g de farine. Quelle quantité faut-il pour 8 personnes ?', reponse: '400 g', reponses_acceptees: ['400 g', '400'], profil_correction: 'numerique', difficulte: 'facile' },
      { contexte: 'prix-kilo-fruits', question: "2 kg de pommes coûtent 6€. Quel est le prix d'1 kg ?", reponse: '3 €', reponses_acceptees: ['3 €', '3'], profil_correction: 'numerique', difficulte: 'facile' },
      { contexte: 'vitesse-constante-trajet-voiture', question: 'Une voiture roule à vitesse constante : 50 km en 1h. Quelle distance parcourt-elle en 3h ?', reponse: '150 km', reponses_acceptees: ['150 km', '150'], profil_correction: 'numerique', difficulte: 'facile' },
      { contexte: 'photocopies-feuilles', question: '10 photocopies utilisent 10 feuilles. Combien de feuilles pour 35 photocopies ?', reponse: '35', reponses_acceptees: ['35'], profil_correction: 'numerique', difficulte: 'moyen' },
      { contexte: 'essence-prix-litres', question: '5 L d\'essence coûtent 9€. Combien coûtent 10 L ?', reponse: '18 €', reponses_acceptees: ['18 €', '18'], profil_correction: 'numerique', difficulte: 'moyen' },
      { contexte: 'tableau-proportionnalite-complement', question: 'Dans un tableau de proportionnalité, 3 correspond à 12. Quel nombre correspond à 5 ?', reponse: '20', reponses_acceptees: ['20'], profil_correction: 'numerique', difficulte: 'moyen' },
    ],
    nF: [
      { contexte: 'solde-pourcentage-article', question: 'Un article à 80€ est soldé à -30%. Quel est son nouveau prix ?', reponse: '56 €', reponses_acceptees: ['56 €', '56'], profil_correction: 'numerique', difficulte: 'moyen' },
      { contexte: 'dilution-sirop-eau', question: "On mélange 1 volume de sirop pour 4 volumes d'eau. Combien de volumes d'eau pour 3 volumes de sirop ?", reponse: '12', reponses_acceptees: ['12'], profil_correction: 'numerique', difficulte: 'moyen' },
      { contexte: 'echelle-plan-maison', question: "Sur un plan à l'échelle 1/100, un mur mesure 4 cm. Quelle est sa longueur réelle en mètres ?", reponse: '4 m', reponses_acceptees: ['4 m', '4'], profil_correction: 'numerique', difficulte: 'difficile' },
      { contexte: 'safran-masse-fleurs', question: '80 g de fleurs donnent 1 g de safran. Quelle masse de safran obtient-on avec 1 kg de fleurs ?', reponse: '12,5 g', reponses_acceptees: ['12,5 g', '12.5 g', '12,5', '12.5'], profil_correction: 'numerique', difficulte: 'difficile' },
      { contexte: 'tableau-proportionnalite-coefficient', question: 'Dans un tableau de proportionnalité, 7 correspond à 21. Quel nombre correspond à 1 ?', reponse: '3', reponses_acceptees: ['3'], profil_correction: 'numerique', difficulte: 'moyen' },
      { contexte: 'abonnement-augmentation-pourcentage', question: "Un abonnement de 25€ augmente de 20%. Quel est son nouveau prix ?", reponse: '30 €', reponses_acceptees: ['30 €', '30'], profil_correction: 'numerique', difficulte: 'difficile' },
    ],
  },

  'maths.nombres-fractions-relatifs': {
    nI: [
      { contexte: 'temperature-ville-hiver', question: "La température est de -3°C le matin et augmente de 7°C l'après-midi. Quelle température fait-il l'après-midi ?", reponse: '4°C', reponses_acceptees: ['4°C', '4'], profil_correction: 'numerique', difficulte: 'facile' },
      { contexte: 'compte-bancaire-debit', question: 'Un compte affiche -15€. On y ajoute 20€. Quel est le nouveau solde ?', reponse: '5 €', reponses_acceptees: ['5 €', '5'], profil_correction: 'numerique', difficulte: 'facile' },
      { contexte: 'fraction-partage-pizza', question: 'Une pizza est coupée en 8 parts. Combien de parts représentent 3/4 de la pizza ?', reponse: '6', reponses_acceptees: ['6'], profil_correction: 'numerique', difficulte: 'facile' },
      { contexte: 'sous-marin-profondeur', question: 'Un sous-marin est à -120 m. Il remonte de 50 m. À quelle profondeur est-il maintenant ?', reponse: '-70 m', reponses_acceptees: ['-70 m', '-70'], profil_correction: 'numerique', difficulte: 'moyen' },
      { contexte: 'fraction-simplification-gateau', question: 'Sur un gâteau, 6/8 ont été mangés. Quelle fraction simplifiée cela représente-t-il ?', reponse: '3/4', reponses_acceptees: ['3/4'], profil_correction: 'numerique', difficulte: 'moyen' },
      { contexte: 'score-jeu-relatif', question: 'Au premier tour, un joueur a -5 points. Au second tour, il gagne 12 points. Quel est son score total ?', reponse: '7', reponses_acceptees: ['7'], profil_correction: 'numerique', difficulte: 'moyen' },
    ],
    nF: [
      { contexte: 'calcul-soustraction-relatifs', question: 'Calcule : 7 − (−5).', reponse: '12', reponses_acceptees: ['12'], profil_correction: 'numerique', difficulte: 'moyen' },
      { contexte: 'encadrement-decimal-mesure', question: 'Entre quels deux entiers consécutifs se trouve 56/10 ?', reponse: '5 et 6', reponses_acceptees: ['5 et 6', 'entre 5 et 6'], profil_correction: 'numerique', difficulte: 'moyen' },
      { contexte: 'fraction-equivalente-reconnaissance', question: '3/4 est-elle égale à 9/12 ?', reponse: 'oui', reponses_acceptees: ['oui', 'oui, elles sont égales'], profil_correction: 'sens', difficulte: 'moyen' },
      { contexte: 'plongeur-altitude-deux-etapes', question: 'Un plongeur descend à -18 m, puis remonte de 25 m. À quelle hauteur est-il par rapport à la surface ?', reponse: '7 m', reponses_acceptees: ['7 m', '7'], profil_correction: 'numerique', difficulte: 'difficile' },
      { contexte: 'fraction-addition-denominateur-commun', question: 'Calcule : 1/4 + 1/2.', reponse: '3/4', reponses_acceptees: ['3/4'], profil_correction: 'numerique', difficulte: 'difficile' },
      { contexte: 'calcul-produit-relatifs', question: 'Calcule : (−4) × (−3).', reponse: '12', reponses_acceptees: ['12'], profil_correction: 'numerique', difficulte: 'difficile' },
    ],
  },

  'maths.comprendre-document': {
    nI: [
      { contexte: 'graphique-temperature-journee', question: "Un graphique montre la température au cours d'une journée : elle monte de 8h à 14h puis redescend. À quelle heure la température est-elle la plus haute ?", reponse: '14h', reponses_acceptees: ['14h', '14 h'], profil_correction: 'exact', difficulte: 'facile' },
      { contexte: 'tableau-resultats-tournoi', question: 'Un tableau donne les scores d\'un match : équipe A 3 buts, équipe B 1 but. Qui a gagné le match ?', reponse: 'équipe a', reponses_acceptees: ['équipe a', 'équipe A', 'a'], profil_correction: 'sens', difficulte: 'facile' },
      { contexte: 'protocole-experience-eau-sel', question: "Un protocole d'expérience indique : « Verser 50 mL d'eau, puis ajouter le sel. » Que verse-t-on en premier ?", reponse: 'eau', reponses_acceptees: ['eau', "de l'eau", "l'eau"], profil_correction: 'sens', difficulte: 'facile' },
      { contexte: 'document-composite-volcans-carte', question: "Un document sur les volcans associe une carte et un texte. La carte montre les volcans actifs, le texte explique pourquoi. Quel élément du document montre où sont les volcans ?", reponse: 'la carte', reponses_acceptees: ['la carte', 'carte'], profil_correction: 'sens', difficulte: 'moyen' },
      { contexte: 'tableau-double-entree-habitat', question: "Un tableau croise espèces animales et habitats. La ligne « ours polaire » est associée à la colonne « banquise ». Où vit l'ours polaire selon ce tableau ?", reponse: 'banquise', reponses_acceptees: ['banquise', 'la banquise'], profil_correction: 'sens', difficulte: 'moyen' },
      { contexte: 'schema-etapes-digestion', question: 'Un schéma légendé montre les étapes de la digestion dans l\'ordre : bouche, estomac, intestin. Quelle est la deuxième étape ?', reponse: 'estomac', reponses_acceptees: ['estomac', "l'estomac"], profil_correction: 'sens', difficulte: 'moyen' },
    ],
    nF: [
      { contexte: 'document-compose-volcans-glace', question: "Un document combine une carte (zones volcaniques) et un texte scientifique (effet de la glace sur les éruptions). Quelle information le texte apporte-t-il que la carte seule ne montre pas ?", reponse: "l'effet de la glace", reponses_acceptees: ["l'effet de la glace", "l'effet de la glace sur les éruptions", 'le mécanisme'], profil_correction: 'sens', difficulte: 'difficile' },
      { contexte: 'graphique-deux-courbes-loups-lievres', question: "Un graphique montre deux courbes sur 10 ans : population de loups en hausse, population de lièvres en baisse. Quelle relation peut-on supposer entre ces deux espèces ?", reponse: 'prédateur-proie', reponses_acceptees: ['prédateur-proie', 'les loups mangent les lièvres', 'relation de prédation'], profil_correction: 'sens', difficulte: 'difficile' },
      { contexte: 'tableau-experience-etats-eau', question: "Un tableau d'expérience montre : à 0°C l'eau est solide, à 50°C elle est liquide, à 100°C elle est gazeuse. Que représente ce tableau ?", reponse: "les états de l'eau", reponses_acceptees: ["les états de l'eau", "changements d'état", "états de la matière"], profil_correction: 'sens', difficulte: 'moyen' },
      { contexte: 'graphique-legende-unite-ml', question: "Un graphique scientifique indique en légende : « axe Y en mL ». Que mesure cet axe ?", reponse: 'un volume', reponses_acceptees: ['un volume', 'le volume', 'la quantité de liquide'], profil_correction: 'sens', difficulte: 'moyen' },
      { contexte: 'carte-risques-zone-inondable', question: "Une carte des risques naturels colore en rouge les zones inondables. Une ville en rouge sur la carte est exposée à quel risque ?", reponse: 'inondation', reponses_acceptees: ['inondation', 'les inondations', "risque d'inondation"], profil_correction: 'sens', difficulte: 'moyen' },
      { contexte: 'tableau-comparatif-energies', question: "Un tableau compare des sources d'énergie selon coût et impact environnemental. Le solaire a un coût élevé mais un impact faible. Si l'on veut protéger l'environnement malgré le coût, quelle source privilégier ?", reponse: 'le solaire', reponses_acceptees: ['le solaire', "l'énergie solaire", 'solaire'], profil_correction: 'sens', difficulte: 'difficile' },
    ],
  },

  'fr.phrase-orthographe': {
    nI: [
      { contexte: 'accord-sujet-verbe-simple', question: '« Les élèves (ranger) leurs affaires avant de partir. » Conjugue le verbe entre parenthèses au présent.', reponse: 'rangent', reponses_acceptees: ['rangent'], profil_correction: 'orthographe', difficulte: 'facile' },
      { contexte: 'accord-adjectif-nom-feminin', question: '« Une robe (joli) » — accorde l\'adjectif.', reponse: 'jolie', reponses_acceptees: ['jolie'], profil_correction: 'orthographe', difficulte: 'facile' },
      { contexte: 'accord-pluriel-nom-cheval', question: 'Écris au pluriel : « un cheval ».', reponse: 'des chevaux', reponses_acceptees: ['des chevaux', 'chevaux'], profil_correction: 'orthographe', difficulte: 'facile' },
      { contexte: 'homophone-est-et', question: 'Complète : « Paul ... content de son résultat. » (est / et)', reponse: 'est', reponses_acceptees: ['est'], profil_correction: 'orthographe', difficulte: 'moyen' },
      { contexte: 'accord-participe-passe-etre-fleurs', question: '« Les fleurs sont (fané). » Accorde le participe passé.', reponse: 'fanées', reponses_acceptees: ['fanées'], profil_correction: 'orthographe', difficulte: 'moyen' },
      { contexte: 'accord-sujet-verbe-enfants-jardin', question: '« Les enfants (jouer) dans le jardin. » Conjugue au présent.', reponse: 'jouent', reponses_acceptees: ['jouent'], profil_correction: 'orthographe', difficulte: 'moyen' },
    ],
    nF: [
      { contexte: 'accord-sujet-eloigne-relative', question: '« Les élèves de cette classe, malgré la fatigue, (ranger) leurs affaires. » Conjugue le verbe au présent.', reponse: 'rangent', reponses_acceptees: ['rangent'], profil_correction: 'orthographe', difficulte: 'difficile' },
      { contexte: 'accord-participe-passe-cod-avant', question: '« Les photos que j\'ai (prendre) sont magnifiques. » Accorde le participe passé.', reponse: 'prises', reponses_acceptees: ['prises'], profil_correction: 'orthographe', difficulte: 'difficile' },
      { contexte: 'adjectif-couleur-invariable-orange', question: '« Des rideaux (orange). » L\'adjectif de couleur s\'accorde-t-il ici ?', reponse: 'non', reponses_acceptees: ['non', 'invariable'], profil_correction: 'orthographe', difficulte: 'difficile' },
      { contexte: 'homophone-leur-leurs', question: 'Complète : « Les enfants ont pris ... cartable. » (leur / leurs)', reponse: 'leur', reponses_acceptees: ['leur'], profil_correction: 'orthographe', difficulte: 'moyen' },
      { contexte: 'accord-sujets-multiples-chat-chien', question: '« Le chat et le chien (dormir) sur le canapé. » Conjugue au présent.', reponse: 'dorment', reponses_acceptees: ['dorment'], profil_correction: 'orthographe', difficulte: 'moyen' },
      { contexte: 'accord-participe-passe-sujet-eloigne-decisions', question: '« Les décisions, prises après de longues réunions, (être) enfin (annoncer). » Accorde.', reponse: 'ont été annoncées', reponses_acceptees: ['ont été annoncées'], profil_correction: 'orthographe', difficulte: 'difficile' },
    ],
  },

  'fr.sens-mot-inconnu': {
    nI: [
      { contexte: 'prefixe-im-impossible', question: 'Le mot « impossible » commence par le préfixe « im- ». Que signifie ce préfixe ?', reponse: 'négation', reponses_acceptees: ['négation', 'le contraire', 'pas'], profil_correction: 'sens', difficulte: 'facile' },
      { contexte: 'suffixe-able-lavable', question: '« Lavable » signifie « qui peut être lavé ». Que signifie le suffixe « -able » ?', reponse: 'qui peut être', reponses_acceptees: ['qui peut être', 'possibilité'], profil_correction: 'sens', difficulte: 'facile' },
      { contexte: 'contexte-mot-extenue-randonnee', question: '« Le randonneur, exténué, s\'assit enfin au sommet. » Que signifie « exténué » d\'après le contexte ?', reponse: 'très fatigué', reponses_acceptees: ['très fatigué', 'épuisé', 'fatigué'], profil_correction: 'sens', difficulte: 'moyen' },
      { contexte: 'racine-terr-famille-mots', question: '« Terrestre », « territoire », « atterrir » partagent la racine « terr- ». Que signifie cette racine ?', reponse: 'terre', reponses_acceptees: ['terre', 'la terre'], profil_correction: 'sens', difficulte: 'moyen' },
      { contexte: 'prefixe-re-refaire', question: '« Refaire » signifie « faire de nouveau ». Que signifie le préfixe « re- » ?', reponse: 'de nouveau', reponses_acceptees: ['de nouveau', 'encore une fois'], profil_correction: 'sens', difficulte: 'moyen' },
      { contexte: 'contexte-mot-nocturne-cameleon', question: '« Le caméléon est un animal nocturne : il chasse surtout la nuit. » Que signifie « nocturne » ?', reponse: 'qui vit la nuit', reponses_acceptees: ['qui vit la nuit', 'actif la nuit', 'de nuit'], profil_correction: 'sens', difficulte: 'moyen' },
    ],
    nF: [
      { contexte: 'deduction-hypothermie-hypotension', question: '« Hypotension » signifie une tension trop basse. En t\'appuyant sur ce mot, que signifie « hypothermie » ?', reponse: 'une température trop basse', reponses_acceptees: ['une température trop basse', 'température basse', 'trop froid'], profil_correction: 'sens', difficulte: 'difficile' },
      { contexte: 'intrus-famille-charger', question: 'Parmi « décharger », « recharger », « charger », « chariot », lequel n\'appartient pas à la même famille de sens ?', reponse: 'chariot', reponses_acceptees: ['chariot'], profil_correction: 'sens', difficulte: 'difficile' },
      { contexte: 'deduction-suffixe-logie', question: '« Biologie » = étude du vivant. « Géologie » = étude de la Terre. Que signifie le suffixe « -logie » ?', reponse: 'étude de', reponses_acceptees: ['étude de', 'science de', "l'étude"], profil_correction: 'sens', difficulte: 'difficile' },
      { contexte: 'contexte-mot-taciturne-vieil-homme', question: '« Le vieil homme, taciturne, ne répondait jamais aux questions qu\'on lui posait. » Que signifie « taciturne » ?', reponse: 'qui parle peu', reponses_acceptees: ['qui parle peu', 'silencieux', 'peu bavard'], profil_correction: 'sens', difficulte: 'difficile' },
      { contexte: 'deduction-prefixe-anti-antigel', question: '« Antigel » empêche le gel. Que signifie le préfixe « anti- » ?', reponse: 'contre', reponses_acceptees: ['contre', "qui s'oppose à"], profil_correction: 'sens', difficulte: 'moyen' },
      { contexte: 'contexte-mot-penurie-ble', question: '« La pénurie de blé a provoqué une hausse des prix. » Que signifie « pénurie » ?', reponse: 'un manque', reponses_acceptees: ['un manque', 'manque', 'rareté'], profil_correction: 'sens', difficulte: 'difficile' },
    ],
  },

  'fr.lexique': {
    nI: [
      { contexte: 'synonyme-content-qcm', question: 'Quel mot est un synonyme de « content » ? A) triste B) joyeux C) fatigué', reponse: 'B', reponses_acceptees: ['B', 'b'], profil_correction: 'exact', difficulte: 'facile' },
      { contexte: 'intrus-sens-rapide', question: 'Parmi « rapide », « vif », « lent », « véloce », lequel a un sens différent des trois autres ?', reponse: 'lent', reponses_acceptees: ['lent'], profil_correction: 'sens', difficulte: 'facile' },
      { contexte: 'nuance-regarder-fixer', question: '« Il regardait » et « il fixait » décrivent-ils la même intensité du regard ?', reponse: 'non', reponses_acceptees: ['non'], profil_correction: 'sens', difficulte: 'facile' },
      { contexte: 'synonyme-immense-qcm', question: 'Quel mot est un synonyme de « immense » ? A) petit B) énorme C) moyen', reponse: 'B', reponses_acceptees: ['B', 'b'], profil_correction: 'exact', difficulte: 'moyen' },
      { contexte: 'choix-mot-flaner-qcm', question: 'Pour décrire quelqu\'un qui marche lentement et sans but, quel mot choisir ? A) courir B) flâner C) sprinter', reponse: 'B', reponses_acceptees: ['B', 'b'], profil_correction: 'exact', difficulte: 'moyen' },
      { contexte: 'intrus-sens-peur', question: 'Parmi « peur », « crainte », « joie », « angoisse », lequel a un sens différent ?', reponse: 'joie', reponses_acceptees: ['joie'], profil_correction: 'sens', difficulte: 'moyen' },
    ],
    nF: [
      { contexte: 'extrait-horla-etat-narrateur', question: '« Il se jeta sur son lit, le cœur battant, incapable de fermer l\'œil jusqu\'à l\'aube. » Quel état du narrateur ce passage décrit-il ?', reponse: 'anxieux', reponses_acceptees: ['anxieux', 'angoissé', 'inquiet'], profil_correction: 'sens', difficulte: 'difficile' },
      { contexte: 'nuance-fameux-ironie', question: 'Dans « ce fameux plan qui a tout raté », le mot « fameux » est-il employé au sens positif ou ironique ?', reponse: 'ironique', reponses_acceptees: ['ironique'], profil_correction: 'sens', difficulte: 'difficile' },
      { contexte: 'choix-mot-glacial-qcm', question: 'Pour décrire un regard dur et menaçant, quel mot choisir ? A) tendre B) glacial C) rieur', reponse: 'B', reponses_acceptees: ['B', 'b'], profil_correction: 'exact', difficulte: 'moyen' },
      { contexte: 'intrus-sens-crier', question: 'Parmi « murmurer », « chuchoter », « crier », « susurrer », lequel a un sens différent ?', reponse: 'crier', reponses_acceptees: ['crier'], profil_correction: 'sens', difficulte: 'moyen' },
      { contexte: 'nuance-modeste-pietre', question: '« Un résultat modeste » et « un résultat piètre » traduisent-ils le même jugement ?', reponse: 'non', reponses_acceptees: ['non'], profil_correction: 'sens', difficulte: 'difficile' },
      { contexte: 'choix-mot-blafarde-qcm', question: 'Pour décrire une lumière faible et vacillante, quel mot choisir ? A) éblouissante B) vive C) blafarde', reponse: 'C', reponses_acceptees: ['C', 'c'], profil_correction: 'exact', difficulte: 'difficile' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Assemblage — exerce RÉELLEMENT la chaîne (generation.js) sur ce contenu : ids
// système, schéma candidate, anti-clone, routage par relecteur. Rien n'est écrit
// tant que tout n'est pas valide.
// ---------------------------------------------------------------------------

function construireLotPilote() {
  const referentiel = JSON.parse(fs.readFileSync(REFERENTIEL_PATH, 'utf-8'));
  const notionIds = new Set(referentiel.notions.map((n) => n.id));

  const erreurs = [];
  const toutesLesCartes = [];
  const manifesteJeux = [];

  referentiel.notions.forEach((notion) => {
    const contenu = CONTENU_PAR_NOTION[notion.id];
    if (!contenu) {
      erreurs.push(`notion "${notion.id}" : aucun contenu pilote défini`);
      return;
    }

    const relecteur = relecteurDepuisMatiere(notion.matiere);
    if (relecteur !== notion.relecteur) {
      erreurs.push(`notion "${notion.id}" : relecteur dérivé "${relecteur}" incohérent avec le référentiel "${notion.relecteur}"`);
      return;
    }

    ['nI', 'nF'].forEach((palier) => {
      const cartesBrutes = contenu[palier];
      if (!Array.isArray(cartesBrutes) || cartesBrutes.length < 5 || cartesBrutes.length > 8) {
        erreurs.push(`notion "${notion.id}" palier ${palier} : doit avoir 5 à 8 cartes (trouvé ${cartesBrutes ? cartesBrutes.length : 0})`);
        return;
      }

      const setId = genererSetId(notion.id, palier, 1);
      if (!setId) {
        erreurs.push(`notion "${notion.id}" palier ${palier} : set_id non généré`);
        return;
      }

      const cartesDuJeu = cartesBrutes.map((brute, i) => {
        const itemId = genererItemId(i + 1);
        return {
          set_id: setId,
          item_id: itemId,
          notion_id: notion.id,
          matiere: notion.matiere,
          relecteur,
          palier,
          difficulte: brute.difficulte,
          question: brute.question,
          reponse: brute.reponse,
          profil_correction: brute.profil_correction,
          reponses_acceptees: brute.reponses_acceptees,
          seconde_chance: false,
          statut: 'attente',
          source: SOURCE_PILOTE,
          ts: TS_GENERATION,
          contexte: brute.contexte,
        };
      });

      const jeuValide = validerJeu(cartesDuJeu);
      if (!jeuValide.valide) {
        erreurs.push(`jeu "${setId}" : ${jeuValide.erreurs.join(', ')}`);
      }

      cartesDuJeu.forEach((c, i) => {
        const v = validerCandidate(c, { notionIdsConnus: notionIds });
        if (!v.valide) {
          erreurs.push(`jeu "${setId}" carte ${i + 1} (${c.item_id}) : ${v.erreurs.join(', ')}`);
        }
      });

      manifesteJeux.push({ set_id: setId, notion_id: notion.id, matiere: notion.matiere, relecteur, palier, n_cartes: cartesDuJeu.length });
      toutesLesCartes.push(...cartesDuJeu);
    });
  });

  return { erreurs, toutesLesCartes, manifesteJeux, notionsCouvertes: referentiel.notions.length, notions: referentiel.notions };
}

function main() {
  const { erreurs, toutesLesCartes, manifesteJeux, notionsCouvertes, notions } = construireLotPilote();

  if (erreurs.length > 0) {
    console.log(`${erreurs.length} erreur(s) — rien n'est écrit :\n`);
    erreurs.forEach((e) => console.log(`  ✗ ${e}`));
    process.exitCode = 1;
    return;
  }

  const depot = deposerEnRelecture(toutesLesCartes, { notions });
  if (depot.invalides.length > 0 || depot.total !== toutesLesCartes.length) {
    console.log(`deposerEnRelecture a écarté ${depot.invalides.length} candidate(s) — rien n'est écrit :`);
    depot.invalides.forEach((inv) => console.log(`  ✗ index ${inv.index} : ${inv.raisons.join(', ')}`));
    process.exitCode = 1;
    return;
  }

  const sortie = {
    version: 'T6-pilote-1',
    nature: 'FIXTURE TECHNIQUE — exerce la chaîne de génération (ids système, schéma candidate, anti-clone, routage par relecteur). PAS un échantillon validé de qualité pédagogique : rejoué contre fonda/engine/correction.js, 42/144 réponses de référence échouent (incompatibilités de profil de correction — unités, encadrement) ; des défauts éditoriaux (variété, biais de réponse) ont aussi été relevés par critique Codex. Voir AVANCEMENT.md section T6a.',
    ts_generation: TS_GENERATION,
    notions_couvertes: notionsCouvertes,
    total_jeux: manifesteJeux.length,
    total_cartes: depot.total,
    repartition_relecteur: {
      justine: depot.parRelecteur.justine.length,
      eric: depot.parRelecteur.eric.length,
    },
    jeux: manifesteJeux,
    par_relecteur: depot.parRelecteur,
  };

  fs.writeFileSync(SORTIE_PATH, JSON.stringify(sortie, null, 2) + '\n');

  console.log('Box-FONDA — lot pilote T6 construit et déposé en file de relecture.');
  console.log(`${manifesteJeux.length} jeux, ${depot.total} cartes.`);
  console.log(`Répartition : justine=${depot.parRelecteur.justine.length}, eric=${depot.parRelecteur.eric.length}.`);
  console.log(`Écrit : ${path.relative(ROOT, SORTIE_PATH)}`);
}

module.exports = { construireLotPilote, CONTENU_PAR_NOTION };

if (require.main === module) {
  main();
}
