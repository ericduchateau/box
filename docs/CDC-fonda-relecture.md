# Cahier des charges — Relecture FONDA `/fonda-select` (Bloc 2, étape 7)

> Statut : **projet, à valider par Éric**, puis relecture Codex ciblée, **avant** d'écrire le moindre workflow. Workflows livrés en JSON, **inactifs** ; activation sur feu vert explicite.
> Sources : critique Codex du 2026-10-13 (points 1–4, 6–9), PRD §2 bis, contrats `fonda/engine/catalogue.js`.
> Principe directeur : **la relecture ne publie rien**. Elle produit une **décision signée**. La publication reste un commit relu (`publier-lot.js` + PR). Toute anomalie non résolue **bloque** la publication au lieu de la laisser passer.

## 0. Périmètre et vocabulaire

- **Candidat** : lot généré (`lot-fonda/v1`, `revue_carte_par_carte: false`) déposé dans `FONDA-Lots/en-attente/` avec son bloc `relecture` (§3).
- **Décision** : choix du relecteur, carte par carte, enregistré dans `FONDA-Lots/relus/`. C'est soit un **lot relu** (cartes retenues, `revue_carte_par_carte: true`) accompagné de son **attestation signée**, soit un **rejet** signé.
- **Clé de relecture** (`review_key`) : secret aléatoire envoyé dans le lien du mail. Le dépôt et le fichier Drive n'en conservent que l'**empreinte**.
- **Infrastructure partagée** (Codex #6) : instance n8n, compte Google et credentials sont communs avec BOX. On parle donc de **séparation fonctionnelle**, pas d'isolation : FONDA n'utilise **aucune donnée ni route** BOX, mais une panne d'instance ou de compte toucherait les deux.

## 1. Ressources et appartenance au dossier FONDA (Codex #6)

- Dossiers Drive dédiés : `FONDA-Lots/en-attente`, `FONDA-Lots/relus`, `FONDA-Lots/attestations`. Leurs ids sont des **constantes** des workflows FONDA (placeholders dans le dépôt).
- **Aucun `file_id` reçu du client n'est utilisé.** Le lien contient `lot=<set_id>&k=<review_key>`. Le serveur retrouve le candidat par **recherche Drive restreinte au dossier** (`'<id en-attente>' in parents and name = '<set_id>.json' and trashed = false`). L'appartenance au dossier est donc garantie par construction.
- Zéro ou plus d'un résultat : **refus** (« lot introuvable ou ambigu »), sans aucune écriture.
- Écritures autorisées **uniquement** dans ces trois dossiers, par id constant. Un **test statique** vérifie que les JSON FONDA ne contiennent **aucun** id ou route BOX (`11KWo…`, `1AmmMsO3…`, `/box-select`, `/box-delete`, `/box-set`, `/box-question`) et n'utilisent que le nœud Crypto **v1**.
- Aucune boucle ; au plus 20 cartes par lot ; corps de requête POST limité (refus au-delà de 64 Ko). Les quotas Gmail et Drive sont partagés avec BOX : **une seule exécution par clic**, aucune relance automatique.

## 2. Routage du relecteur par `notion_id` (Codex #10)

- À la génération, le relecteur **attribué** est lu dans `referentiel.json` tel que publié par GitHub Pages (`…/box/fonda/data/referentiel.json`), d'après le `notion_id` du lot. Jamais d'après le libellé de matière.
- `notion_id` absent du référentiel : **refus**, aucun envoi.
- La correspondance identifiant → adresse e-mail (`eric`, `justine`) vit **dans n8n uniquement** (placeholders dans le dépôt, refus d'envoyer tant qu'un placeholder subsiste).
- **Honnêteté** : le lien est envoyé au relecteur attribué, mais **posséder le lien n'authentifie pas la personne**. L'attestation écrit donc `decide_via: "lien envoyé à <id>"`, et non « validé par <personne> ». Le nom affiché aux élèves reste celui de l'**entrée du catalogue**, choisi par Éric lors de la PR de publication.

## 3. Clé de relecture : génération, expiration, révocation (Codex #7)

- Génération : nœud **Crypto v1 « Generate »**, hex, 64 caractères (256 bits).
- Stockage : le bloc `relecture` du candidat sur Drive contient `{ cle_sha256, cree_le, expire_le, statut, decision_id, nonce_utilise }`. **Jamais la clé en clair.** Seul le mail la contient.
- Vérification : SHA-256 (nœud Crypto v1 « Hash ») de la clé reçue, comparé à `cle_sha256`.
- **Expiration** : `expire_le = cree_le + 14 jours` (durée **à confirmer par Éric**). Une fois la date passée : refus, page « lien expiré, demander un nouveau lien ».
- **Révocation et réémission** : workflow manuel `FONDA - Reemettre cle` (exécuté par Éric). Il remplace `cle_sha256` et `expire_le` et renvoie un mail. L'ancien lien devient inutilisable. Interdit si le statut n'est plus `en_attente`.
- **Journaux** : la clé apparaît en clair dans l'URL, donc dans l'historique d'exécution n8n (conservé intégralement, décision Éric) et dans l'historique du navigateur. Mitigation : usage **unique** (§5), expiration, et `Referrer-Policy: no-referrer`. Ce risque résiduel est accepté et documenté.

## 4. Page de relecture : afficher la règle de correction (Codex #1)

Pour **chaque carte**, la page affiche, tous champs échappés :
- la question et la réponse attendue ;
- le **profil de correction**, avec une phrase d'explication fixe (`exact` : saisie identique à une forme acceptée ; `sens` : tolère casse, accents et ponctuation ; `orthographe` : l'orthographe est **ce qui est évalué** ; `numerique` : valeur, et unité si elle est précisée) ;
- **toutes** les `reponses_acceptees` ;
- `unite`, `arrondi` et `seconde_chance` s'ils sont présents, avec la mention « non précisé » sinon ;
- un rappel : « Ce que vous validez = exactement cette règle de correction ».

**Choix explicite par carte** : deux boutons radio, « Garder » et « Écarter », **sans valeur par défaut**. La soumission est refusée tant qu'une carte n'a pas de choix (contrôle côté serveur, pas seulement dans le navigateur). Un bouton séparé **« Tout rejeter »** demande une confirmation.

Souhaitable, **décision Éric** : un champ « Essayer une réponse » par carte, qui exécute le vrai `correction.js` chargé depuis GitHub Pages avec intégrité SRI. Il permet à la relectrice de vérifier ce que le correcteur accepte. Ce champ ajoute une source de script à la politique CSP.

## 5. Lien au contenu, machine à états, idempotence (Codex #2, #3)

**GET `/fonda-select` : lecture seule.**
- Aucune écriture sur Drive.
- Il calcule l'**empreinte affichée**, avec le même texte canonique que `catalogue.js::texteEmpreinte` (un test vérifie l'égalité octet par octet) et le nœud Crypto v1 Hash SHA256.
- Il génère un **jeton de formulaire sans état** : `HMAC-SHA256(secret_formulaire, set_id | empreinte_affichee | expire_page | nonce)`. Le nonce est aléatoire (Crypto Generate), `expire_page` vaut maintenant + 2 h. Le secret n'existe que dans n8n.
- Champs cachés du formulaire : `lot`, `k`, `empreinte`, `expire_page`, `nonce`, `jeton`.

**POST `/fonda-select-confirm`**, dans cet ordre, sans aucune écriture avant l'étape 6 :
1. Valider strictement le corps (§7). En cas d'échec : 400, rien n'est écrit.
2. Recalculer le HMAC : il doit correspondre au jeton reçu et `expire_page` ne doit pas être dépassé. Sinon 403.
3. Retrouver le candidat dans `en-attente` (§1), puis vérifier la clé, l'expiration et `statut === 'en_attente'` (§3). Sinon 403 ou 409.
4. **Recalculer l'empreinte du candidat actuel** sur Drive : elle doit être **égale** à l'empreinte affichée. Sinon **409 « le lot a changé depuis l'affichage, rouvrir le lien »**. Cela exclut toute substitution entre GET et POST.
5. **Idempotence** : si `relecture.nonce_utilise === nonce` et qu'une décision `relus/<set_id>__<nonce>.json` existe, on renvoie **le même résultat**, sans rien réécrire (rejeu, double clic, réessai après une panne).
6. Écrire la **décision** dans `relus/<set_id>__<nonce>.json` : lot relu filtré, ou rejet. Écrire l'**attestation signée** dans `attestations/<set_id>__<nonce>.json` (§6).
7. Passer le candidat à `statut: 'decide'` (ou `'rejete'`), avec `decision_id: nonce` et `nonce_utilise: nonce`. Le contenu pédagogique n'est pas modifié (conservé pour l'audit).
8. Envoyer le mail de confirmation au relecteur attribué. **Un échec d'envoi ne relance rien et n'annule rien** : la décision est acquise.

**Atomicité : limite assumée et traitement.** n8n et Drive ne permettent **pas** d'écriture conditionnelle atomique. Deux confirmations simultanées portant des nonces différents peuvent donc toutes deux passer l'étape 3.
- **Détection** : après l'étape 7, le workflow liste `relus/` pour ce `set_id`. S'il y trouve **plus d'une décision**, il les marque toutes `conflit: true`, passe le candidat à `statut: 'conflit'` et prévient Éric. Aucune des décisions n'est publiable.
- **`publier-lot.js` refuse** toute décision en conflit, et toute situation où plusieurs décisions existent pour un même `set_id` et une même clé.
- Panne entre les étapes 6 et 7 : la décision existe mais le statut n'a pas changé. Un rejeu avec le même nonce est idempotent (étape 5). Un nouvel affichage avec un nouveau nonce mène au cas « conflit », donc bloqué, puis à une réémission manuelle.
- Le GET n'écrit jamais rien. Un GET tardif ne peut donc **pas** réécrire un ancien contenu (Codex #3).

**États du candidat** : `en_attente → decide | rejete | conflit | revoque | expire` (`expire` est calculé, pas écrit). Toute autre transition est refusée.

## 6. Attestation signée, vérifiée indépendamment du fichier (Codex #4)

Attestation `n8n-relecture` (`attestation-fonda/v1`), en JSON canonique avec un ordre de clés fixe :
```
{ schema, type: "n8n-relecture", set_id, notion_id, palier,
  empreinte_relue,       // empreinte du candidat affiché = recalculée au POST (§5.4)
  empreinte_publiee,     // empreinte du lot relu FILTRÉ = fichier à publier
  selection, ecartees,   // item_ids exacts, dans l'ordre du fichier
  relecteur_attribue,    // id, depuis referentiel.json (§2)
  decide_via,            // "lien envoyé à <id>" (§2, honnêteté)
  decide_le,             // horodatage de l'horloge n8n
  nonce, cle_sha256_prefixe, execution_n8n, version_cle_signature }
signature = Crypto v1 « Sign » RSA-SHA256 (clé privée PEM, uniquement dans n8n) sur le JSON canonique ci-dessus
```
- **Clé publique commitée** dans le dépôt (`fonda/data/cles/attestation-v1.pub.pem`) : c'est la source de confiance **indépendante du fichier**. La paire de clés est générée **localement par Éric**. La clé privée est collée dans le nœud Sign de n8n et **n'est jamais commitée**. Rotation : `version_cle_signature`, et les anciennes clés publiques restent conservées.
- **`publier-lot.js`** n'acceptera le type `n8n-relecture` (bloc 2 mergé) que si toutes ces conditions sont réunies :
  - la signature est valide (Node `crypto.verify` avec la clé publique de la bonne version) ;
  - `empreinte_publiee` correspond à l'empreinte du fichier publié ;
  - `selection` correspond aux `item_ids` du fichier, et le fichier est exactement le candidat filtré par cette sélection, ce qui se vérifie en recalculant à partir de `empreinte_relue` si le candidat est fourni ;
  - `relecteur_attribue` correspond au référentiel ;
  - il n'y a aucun conflit (§5).
- Le **test CI** revérifie la signature de toute entrée `n8n-relecture` du catalogue. Une attestation modifiée à la main, ou une réponse acceptée changée après relecture, fait échouer la CI.
- Limite : la signature prouve « décidé via le workflow FONDA avec ce contenu », **pas** l'identité de la personne qui a cliqué (§2).

## 7. Validation stricte de la sélection et « tout rejeter » (Codex #9)

- Corps accepté : `action ∈ {"decider", "rejeter_tout"}`, plus les champs du §5. Tout champ inconnu entraîne un **refus 400**.
- Avec `decider` : un champ par carte `choix_<item_id> ∈ {"garder", "ecarter"}`.
  - **chaque** `item_id` du candidat doit avoir **exactement un** choix ;
  - aucun `item_id` inconnu, pas de `parseInt` ni de conversion : comparaison stricte de chaînes au motif `^it\d{2}$` ;
  - au moins une carte gardée, sinon refus avec ce message : « Utilisez “Tout rejeter” ».
- Avec `rejeter_tout` : aucun champ `choix_*` toléré, et la confirmation explicite `confirmer_rejet=oui` est exigée.
- Le lot relu garde les cartes retenues **dans l'ordre du candidat**, avec leurs `item_id` d'origine, sans renumérotation. Le fichier est conforme à la liste blanche `lot-fonda/v1`, avec `revue_carte_par_carte: true` et **aucun** champ de relecture.
- Fichier candidat absent, corrompu (non conforme à `lot-fonda/v1`), déjà décidé, révoqué ou expiré : **message explicite, aucune écriture**.

## 8. Protections XSS et en-têtes (Codex #8)

- **Tout** texte inséré dans le HTML passe par `escapeHtml` (repris de l'existant). Attributs toujours entre guillemets. Les paramètres d'URL sont encodés avec `encodeURIComponent`. **Aucun** HTML brut construit à partir des données.
- En-têtes de **toutes** les réponses GET et POST, y compris les erreurs :
  - `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action https://n8n.srv868991.hstgr.cloud/webhook/fonda-select-confirm; frame-ancestors 'none'; base-uri 'none'` (avec en plus `script-src` limité à `correction.js` sur Pages, avec SRI, si l'essai du correcteur est retenu) ;
  - `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.
- **Vérification réelle** : `curl -I` sur la copie de test, car le proxy Hostinger peut retirer des en-têtes. Le résultat est consigné dans le README.

## 9. Tests exigés avant toute activation

1. Tests unitaires sur le **vrai JavaScript** de chaque nœud Code (même harnais que `n8n/secrets-2026-10-13`).
2. Égalité octet par octet entre le texte canonique d'empreinte de n8n et `catalogue.js::texteEmpreinte`.
3. **Charges XSS** (`<img src=x onerror=…>`, `"><script>`, `javascript:`, entités) dans **chaque** champ affiché, y compris chaque réponse acceptée, l'unité et le libellé de notion : aucun HTML actif dans la sortie.
4. Sélection malformée : `1abc`, `it1`, `it01 `, doublon, `item_id` inconnu, choix manquant, valeur hors liste, `rejeter_tout` accompagné de choix, corps trop gros. Tous refusés, **zéro écriture** (écritures simulées et comptées).
5. Scénarios d'état : rejeu du même nonce (même résultat, zéro écriture) ; deux nonces (conflit détecté, rien de publiable) ; clé expirée, révoquée ou mauvaise ; candidat modifié entre GET et POST (409) ; fichier introuvable ou en double dans le dossier ; panne simulée entre les étapes 6 et 7.
6. Signature : signer dans n8n (nœud Sign) puis vérifier en Node avec la clé publique de test. Une attestation altérée d'un seul octet est refusée. `publier-lot.js` est étendu et testé sur les cas acceptés et refusés.
7. Test statique : aucun id ni route BOX, Crypto v1 uniquement, webhooks `/fonda-select*` seulement, aucune adresse e-mail ni clé privée dans le dépôt.
8. Copie de test sur l'instance (dossiers et destinataire de test) : parcours réel GET puis POST, `curl -I` des en-têtes, et vérification que le Crypto v1 **Sign** existe bien sur l'instance (2.6.3). Le constat de disponibilité a été fait sur un n8n 1.91 local.

## 10. Hors périmètre de ce cahier des charges

- Le workflow `FONDA - Generation` (étape 6) : il devra produire le candidat avec le bloc `relecture` (§3) et le routage du §2. Il est spécifié à part, avec les mêmes contraintes.
- `FONDA - Retirer lot` (étape 8) et le retrait de l'orpheline BOX (étape 11).
- La collecte d'événements (`/box-fonda-events`).

## 11. Décisions attendues d'Éric

1. Durée de validité de la clé de relecture : **14 jours** proposés.
2. Essai du correcteur dans la page de relecture (§4) : oui ou non, en v1.
3. Génération de la paire de clés RSA (§6) : Claude Code fournit la commande `openssl`, Éric l'exécute localement, commite la clé publique et colle la clé privée dans n8n.
4. Destinataire des alertes « conflit » (§5) : Éric uniquement ?
