# Cahier des charges — Relecture FONDA `/fonda-select` (Bloc 2, étape 7) — **v7**

> Statut : **v7 rédigée le 2026-10-13** (correctifs bornés de la v6 : B1–B3, C1–C6, marqueur remplacé par CODEOWNERS), modèle **« l'humain garantit, la technique est un filet »** (option B). À valider par Éric, puis relecture Codex ciblée. **Aucun workflow** avant validation ; workflows en JSON **inactifs**, activation sur feu vert explicite. **Annexe A : rien n'est appliqué sur GitHub sans relecture d'Éric.** **Séquencement du build : §18.** Décisions d'Éric : §19.

## 0. Garantie, filet, limites

**Garantie (humaine, vérifiable par une signature)** : un lot n'est publiable que si la relectrice a confirmé auprès d'Éric **exactement l'instantané figé** (§3) — cartes gardées et écartées, règle de correction, **moteur de correction élève** (version + empreinte) que l'élève exécutera (§4) — et si Éric a signé cet instantané sur son Mac. **Confirmation, signature et comportement exécuté par l'élève forment un seul objet lié** (§3, §4, §11).

**Filet technique** (exécutions n8n, rapprochement historique/Drive, recherches Drive, conflits, empreintes, SRI) : il **bloque** ce qu'il détecte (§10). **Il est non probant.**

> **Limite, noir sur blanc.** Drive + n8n 2.6.3 n'offrent ni écriture atomique, ni journal infalsifiable, ni rétention garantie, ni état d'exécution exhaustivement interrogeable. **Le silence du filet ne prouve pas l'exhaustivité.** FONDA ne revendique **aucune** preuve technique d'exhaustivité ni d'unicité : l'unicité de ce qui est publié repose sur la **confirmation humaine** de l'instantané exact.

**Ce que prouve la signature** : la **déclaration d'Éric** (« la relectrice `<id>` m'a confirmé, par `<mode>`, cet instantané exact, transmis sans retouche ; je l'ai signé »). Pas l'intervention indépendante de la relectrice, ni son examen réel de chaque carte.

**Non couvert, assumé** : administrateur n8n/Drive/GitHub malveillant ; relectrice confirmant sans examiner ; Éric déclarant faussement (racine de confiance).

**Périmètre** : `fonda/page/bootstrap.js` et `fonda/engine/carte-reponse-produite.js` ne servent **qu'au mode FONDA** (`?fonda=1`), **pas encore sur `main`** ; BOX (élèves actuels) n'en dépend pas. **Frontière CI** : vérification publique uniquement ; jamais la clé privée RSA ni le jeton n8n. **Le front ne vérifie pas RSA** : il sert le catalogue mergé, et vérifie l'empreinte du lot et la **SRI du moteur** qu'il charge (§4).

## 1. Contrats privés et octets canoniques

`lot-fonda/v1` public **inchangé**. Contrats privés (Drive `FONDA-Lots`) :
- **`candidat-fonda/v1`** : `{ schema, lot, relecture }` ; `relecture = { statut ∈ {"en_attente","clos","abandonne"}, generation_cle, cle_sha256, cree_le, expire_le, relecteur_attribue, referentiel_version, moteur: { version, sha256 }, envois }`.
- **`decision-fonda/v1`** : `{ schema, set_id, generation, nonce, recu_le, coeur, lot_relu, hash_formulaire }` ; `coeur = { action, selection, ecartees, empreinte_relue, empreinte_publiee, moteur: { version, sha256 } }`.

**Octets canoniques** (`fonda/engine/canonique.js`, recopié dans les nœuds Code, vecteurs fixes) : `JSON.stringify` d'ECMAScript sur une valeur construite dans l'ordre de clés du contrat ; UTF-8 sans BOM, sans espace ni saut de ligne ; nombres finis, forme `Number::toString` ; chaînes sans normalisation Unicode ; tous les champs présents ; aucun champ inconnu. **Portée d'« octet pour octet »** : cœur, instantané, charge signée, **fichier du moteur**. Les fichiers de lot publiés sont liés par leur empreinte pédagogique **et** par le couple moteur figé (§4, annexe B).

## 2. Routage figé à l'émission

Relecteur attribué lu dans `referentiel.json` publié d'après `notion_id` ; `referentiel_version` (SHA-256) retrouvé dans l'historique Git par le script local. `envois[]` trace chaque génération (`envoye_a` = identifiant).

## 3. Instantané figé et confirmation humaine (B1 v4, C3)

1. **Instantané** `instantane-fonda/v1 = { schema, set_id, candidat_lot, coeur, lot_relu, moteur: { version, sha256 }, recapitulatif }` ; `recapitulatif` = **projection déterministe** de `candidat_lot` + `coeur` + `moteur` (cartes gardées/écartées, règle de correction de chaque carte gardée, version du moteur, empreintes). `sha256_instantane` = SHA-256 complet ; **code de confirmation** = 16 premiers hex (repère humain seulement).
2. **Enregistrement unique** au moment de la construction : `instantane.json` + `export.json = { sha256_instantane, sha256_recapitulatif, exporte_le }` dans le dossier local de clôture (hors dépôt, hors Dropbox). Affichage, export et signature dérivent de cet instantané ; il n'est **jamais reconstruit**.
3. **Transmission sans retouche** : export en fichier joint `recapitulatif-<set_id>-<code>.txt` (récapitulatif + `sha256_instantane` en dernière ligne), envoyé tel quel ; la relectrice **répond à ce message** en citant le code. Vive voix : lecture commune de l'affichage du script.
4. **Contrôles obligatoires avant signature** (C3) : (a) SHA-256 recalculé de `instantane.json` = `export.json.sha256_instantane` ; (b) `recapitulatif` = projection déterministe recalculée de l'instantané, et son SHA-256 = `export.json.sha256_recapitulatif` ; (c) `coeur`, `moteur` et empreintes de la charge **proviennent exclusivement** de l'instantané ; (d) Éric tape le code confirmé (= code de l'instantané) et atteste la fidélité de transmission. Le code n'authentifie ni personne ni message.
5. **Clôture technique ≠ clôture signée** : la *clôture technique* (révocation de la clé, §9) précède la confirmation ; **sans confirmation, pas de clôture signée** et donc rien de publiable.

## 4. Moteur de correction élève versionné (B1, B2 v5 ; B1, C1, C3 v6)

**Principe** : **toute décision pédagogique observable** par l'élève est prise **par le moteur** ; le composant d'affichage et le front ne font **qu'afficher** ce que le moteur renvoie. Aujourd'hui ces décisions sont éparpillées (`correction.js`, `adapterCarte`, `carte-reponse-produite.js` : cible affichée, verdict, icône, formes affichées, seconde chance, tentative comptée, verrouillage ; `bootstrap.js` : apparition de « Carte suivante »).

### 4.1 Mécanisme d'export (fixé, testé par la preuve C8)

Fichier `fonda/engine/moteur-correction-v<N>.js`, chargé par balise `<script>` avec `integrity` et `crossorigin="anonymous"` posés **avant insertion**. Son **seul** effet de bord est l'enregistrement **sous sa version** :
```js
(self.FondaMoteurs = self.FondaMoteurs || Object.create(null));
if (Object.prototype.hasOwnProperty.call(self.FondaMoteurs, "v<N>")) { /* déjà enregistré : ne rien écraser */ }
else Object.defineProperty(self.FondaMoteurs, "v<N>", { value: Object.freeze({ version: "v<N>", creerMoteur }), writable: false, configurable: false, enumerable: true });
```
- **Jamais d'écrasement** : une version déjà enregistrée n'est ni remplacée ni modifiable (`writable: false, configurable: false`) ; aucun autre global n'est posé.
- **Chargeur** (front et page de relecture) : `obtenirMoteur(version, sha256)` — cache **indexé sur `version + ":" + sha256`** ; si la version est déjà enregistrée, l'entrée du registre `moteurs.json` doit avoir **le même `sha256`** que celui demandé (sinon refus : une même version ne peut pas correspondre à deux empreintes) ; sinon chargement du fichier de cette version avec la SRI encodant **ce** `sha256`, puis lecture de `FondaMoteurs[version]` ; `instance = fabrique.creerMoteur()` ; `instance.version === version` exigé. Chargements **concurrents** de la même version : une seule promesse partagée par clé.
- **Tests** : séquence v1 → v2 → v1 (chaque lot obtient le comportement de **sa** version, prouvé par un comportement **différent** entre v1 et v2 de test) ; deux chargements concurrents ; refus d'une version demandée avec une autre empreinte ; tentative d'écrasement d'une version enregistrée sans effet.

### 4.2 API du moteur : un résultat pédagogique complet

`creerMoteur()` renvoie `{ version, preparerCarte(carteLot) → carte, demarrer(carte) → etat, soumettre(etat, saisie) → { etat, resultat } }`, **purs** (aucun DOM, aucun réseau). `carte` contient tout ce que l'affichage montre **avant** réponse (question, `cible_affichee` — ex. `0,33` pour `1/3` avec arrondi 2 —, libellés). `resultat` est **complet et définitif** pour l'affichage :
`{ statut ∈ {"juste","presque","faux","erreur"}, reussite (booléen), verdict: { texte, icone ∈ {"succes","echec"} }, cible_affichee, formes_affichees (formes à présenter comme acceptées — vide en numérique), profil_libelle, tentative (1|2), compte (booléen = tentative scorée), seconde_chance_ouverte (booléen), verrouillee (booléen), carte_terminee (booléen) }`.
- La **normalisation** des saisies, le **parseur numérique**, la cible, les formes affichables, la règle « presque compte / ne compte pas » selon le profil, la seconde chance et le verrouillage sont **dans le moteur** ; aucun prétraitement dans l'interface.
- **Composant** `carte-reponse-produite.js` : purement présentationnel ; reçoit `{ moteur, carte, onResultat }`, affiche `carte` puis `resultat` **sans réinterpréter** (aucun `if` sur le statut ou le profil autre que le choix de gabarit d'affichage dicté par `resultat`).
- **Navigation** : « Carte suivante » n'apparaît que si `resultat.carte_terminee === true` (corrige le défaut actuel : elle apparaît dès le premier résultat alors qu'une seconde chance reste ouverte).
- **Contrat `onResultat`** : appelé **une fois par soumission**, **après** mise à jour de l'affichage et du verrouillage, avec `resultat` **tel quel** (objet gelé) ; une exception dans `onResultat` est **interceptée et journalisée** sans modifier l'affichage, le verrouillage ni l'état du moteur.
- **Ordre des cartes** : celui du tableau du lot (couvert par l'empreinte) ; le front **ne trie jamais** (ni par `numero`, ni autrement).
- **Émetteur d'événements** (futur, T3/T5) : transmet `resultat.compte`, `resultat.reussite` et `resultat.statut` **tels quels**, sans recalcul ; n'émet que si `compte === true`.

### 4.3 Registre, liaison, version figée

- **Registre** `fonda/engine/moteurs.json` = `[{ version, fichier, sha256, sri }]` ; invariant `sha256 = SHA-256(octets du fichier)` et `sri = "sha256-" + base64(même empreinte)`. Fichiers **immuables, jamais supprimés** (annexe B).
- **Liaison** : `moteur = { version, sha256 }` fixé dans le candidat → page de relecture (« Essayer une réponse » via **le même** `obtenirMoteur`) → jeton HMAC et champ POST → cœur → instantané → charge signée → entrée du catalogue.
- **Front élève** : résoudre l'entrée **avant** tout chargement ; `obtenirMoteur(entree.moteur.version, entree.moteur.sha256)` ; échec → « pas disponible ».
- **Génération, publication, CI (C3)** : toutes les validations de cartes (`verifierContreCorrecteur`, `verifierFormesAcceptees`, `formeSaisissable`) passent par **le moteur du lot** (`moteurs.json` + fichier versionné, chargé en Node), **jamais** par le correcteur courant ; aucune logique numérique parallèle.
- **Version figée par lot publié** : `entree.moteur` est figé comme l'empreinte (annexe B) ; tout changement de comportement ⇒ nouveau `set_id` + nouvelle relecture.
- **Lots historiques et migration initiale (C6)** : `moteur-correction-v1.js` = consolidation **à comportement identique** du code actuel, **sauf** le défaut « Carte suivante » (correction de navigation, documentée ; elle ne change ni l'évaluation ni le score). Preuve : tests existants rejoués + comparaisons ancien/nouveau (cible affichée, profils, Unicode, arrondi, seconde chance, callbacks). **Écart documenté** : le PRD §5.1 annonce une tolérance singulier/pluriel en profil `sens` que le normaliseur actuel ne réalise pas ; v1 **préserve** le comportement actuel. La PR de migration ajoute `moteur: { version: "v1", sha256 }` aux **8 lots historiques seulement** (empreintes pédagogiques inchangées) ; elle est la **seule** exception à la règle « moteur figé » (annexe B, règle 0).

## 5. Auto-confirmation (relecteur = clôtureur)

Règle **par identité** : `relecteur_attribue === "eric"` ⇒ `confirmation.mode = "auto"`, `par = "eric"`, `relecteur_egal_cloturer = true` ; code et instantané exigés. **Aucune double relecture revendiquée** ; badge « Fiche relue par Éric Duchateau ».

## 6. Clé, statuts, identifiants (C4 v4, C5)

- Clé : Crypto v1 « Generate », hex 64 ; seul `cle_sha256` stocké ; **14 jours**. Seuls les workflows manuels écrivent le candidat (génération, réémission, clôture technique, abandon), jamais en parallèle.
- Contrôle C3 (§7) : candidat téléchargé par l'exécution : `statut === "en_attente"`, `sha256(k)`, génération, expiration, **`moteur` = celui du formulaire**.
- **Statuts** : `en_attente → clos` ; `en_attente → en_attente` (réémission) ; `en_attente | clos → abandonne`. Après un **blocage dur propre au lot** (§10), seule issue : **abandon** + **nouveau candidat** avec **nouveau `set_id`** (cartes reprises, `set_id` réécrit dans chaque carte, `item_id` conservés, empreintes recalculées, **relecture entièrement refaite**).
- **Journal des identifiants (C5 v5, C2 v6)** : fichier **commité** `fonda/data/set_ids-journal.json` = **journal de transitions en ajout seul** `[{ set_id, transition ∈ {"reserve","publie","abandonne","retire"}, le, ref }]`. L'état courant d'un `set_id` est **dérivé** de sa dernière transition (aucune ligne n'est jamais modifiée ni supprimée). Transitions autorisées : `reserve → publie`, `reserve → abandonne`, `publie → retire` ; jamais de nouvelle `reserve` pour un `set_id` déjà présent.
  - **Amorçage** (PR de migration) : une ligne `reserve` (et `publie` pour les 8 publiés) pour **chaque** `set_id` déjà utilisé : catalogue, `lots/`, `lots-fonda-calibration/`, et tout `set_id` trouvé dans l'historique Git de ces fichiers.
  - **Autorité et sérialisation** : la branche **`design`** fait autorité. Une réservation = **un commit sur `design`** (via PR) **avant** la création du candidat dans Drive ; le générateur part de `design` à jour et prend la séquence libre suivante **dans le journal** (jamais seulement les fichiers présents) ; deux réservations concurrentes d'un même `set_id` se heurtent au merge (conflit Git) et la CI refuse un double `reserve`.
  - Séquence `99` atteinte → **arrêt explicite**, jamais de recyclage. `generer-lot-fonda.js` est migré pour lire ce journal et **s'arrêter** sur tout fichier illisible.

## 7. Page et confirmation de relecture

**GET** (aucune écriture) : par carte, question, réponse attendue, profil avec explication et exemple, toutes les réponses acceptées, `unite`, `arrondi`, `seconde_chance` ; choix « Garder / Écarter » sans défaut ; « Tout rejeter » séparé ; « Essayer une réponse » via le **moteur** du candidat (SRI, CORS). Données via `<script type="application/json">` échappé ; aucun `onclick`. CSP **en `<meta http-equiv>`** (n8n remplace l'en-tête, preuve C8) : `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-<aléa>' <URL exacte du moteur>; form-action <URL exacte de confirmation>; base-uri 'none'` (§13.0). Jeton : `HMAC-SHA256(secret, canonique(["fonda-select/v7", set_id, generation_cle, cle_sha256, empreinte_affichee, moteur.version, moteur.sha256, expire_page, nonce]))`.

**POST** : **C1** syntaxe avant Drive (≤ 64 Ko octets reçus ; champs exactement `lot, k, generation, empreinte, moteur_version, moteur_sha256, expire_page, nonce, jeton, action` + `choix_<item_id>` ou `confirmer_rejet=oui` ; doublons → 400) ; **C2** jeton ; **C3** candidat + clé + moteur ; **C4** empreinte actuelle = affichée ; **C5** sélection ; **C5bis** relecture du candidat ; **C6** recherche de tous les fichiers de même nom : cœurs identiques → même résultat ; **cœur différent → sortie `{ type: "conflit", … }` consignée puis 409** ; sinon écriture et sortie `{ type: "decision", … }` ; **C7** mail. `executionTimeout = 120 s` ; jamais de reprise manuelle d'une confirmation.

## 8. Recherche Drive stricte

`set_id` validé avant interpolation ; Advanced Search restreinte au dossier ; `nextPageToken` et `incompleteSearch` ; pagination complète ; tous les résultats traités ; 0 ou > 1 → refus ; `set_id` interne = nom. Aucun `file_id` client ; écritures uniquement dans les dossiers FONDA ; test statique : aucun id ni route BOX, Crypto v1 uniquement.

## 9. Clôture

**Workflow `FONDA - Cloturer relecture`** (manuel) = **clôture technique** : révocation (`clos`) ; listing de `decisions/` (corbeille comprise, pagination, `incompleteSearch`, chaque fichier lu) ; sortie = manifeste. Aucun fichier de clôture ne fait foi.

**Script local `fonda/scripts/signer-cloture.js`** (Mac d'Éric ; secrets locaux hors dépôt et hors Dropbox ; GET uniquement) : (1) provenance de l'exécution de clôture par l'API (workflow épinglé, `success`, même `set_id`, **la plus récente** ; écriture postérieure au listing → nouvelle clôture technique) ; (2) filet (§10) ; (3) un seul cœur distinct d'action `accepter`, enveloppes cohérentes ; (4) revérifications (candidat, filtrage, `lot-fonda/v1`, garde-fous du correcteur **via le moteur `v<N>`**, référentiel archivé) ; (5) instantané figé + confirmation (§3, §5) ; (6) **clôture signée** (§11) et revérification immédiate.

## 10. Le filet : portée et sort de chaque détection (C1 v4, C4)

**Ordre** : toutes les détections sont évaluées ; **un seul blocage dur suffit** ; une levée ne neutralise jamais un autre blocage ; le silence n'est jamais une preuve.

**A. Blocages durs propres au lot** (attribuables à ce `set_id`) — **non levables** ; issue : **abandon + nouveau candidat** (§6) :
- sortie `conflit` dans une exécution de ce lot, **quel que soit son statut** ;
- ≥ 2 cœurs distincts, ou cœurs identiques avec `lot_relu` différents ;
- décision de ce lot consignée par une exécution mais **absente de Drive** ;
- fichier de `decisions/` dont le `set_id` interne est ce lot **sans exécution correspondante** ;
- exécution de confirmation de ce lot **`error`/`crashed`/`canceled`**.

**B. Incidents de chaîne** (non attribuables à un lot) — **non levables** ; ils **suspendent toute clôture signée**, pour tous les lots, jusqu'à traitement par Éric ; l'abandon d'un lot **ne les résout pas** :
- exécution de confirmation **non terminée** ou **au statut inconnu** (dont `new`), observée avec et sans filtre, pagination complète ;
- exécution **sans données exploitables** (lot indéterminable) ;
- fichier **illisible ou non conforme** dans `decisions/` (lot indéterminable) ;
- jeton n8n sans accès aux workflows de relecture.
**Statuts d'un incident (B2)** : `incidents/<id>.json = { id, nature, detecte_le, statut ∈ {"ouvert","resolu"}, resolu_le, preuve_resolution, periode: { debut, fin } }`. **Un incident `ouvert` suspend toute clôture signée** ; l'inscrire ne suffit pas. **Résolution**, selon la nature :
- *jeton sans accès* : accès rétabli **et** observation complète refaite avec succès ;
- *exécution non terminée / statut inconnu* : exécution **terminée ou arrêtée**, puis examinée (statut final, sortie) ;
- *exécution sans données* : examinée ; si son lot reste indéterminable, elle demeure un risque pour **tous** les lots de sa période ;
- *fichier illisible* : examiné puis placé en `quarantaine/` (localisation d'origine conservée).
La **période affectée** va de la première observation possible de la cause (au plus tôt : début de l'exécution, création du fichier ; inconnue ⇒ **depuis le début**) **jusqu'à `resolu_le`**. Tout lot dont la fenêtre de candidature **recouvre** cette période ne peut être clôturé qu'après **abandon et nouveau candidat créé après `resolu_le`**. Un incident résolu reste listé dans toute attestation ultérieure (`incidents_connus`) ; aucun incident n'est jamais effacé.

**C. Levées — uniquement deux, par Éric, signées, non probantes, confirmation humaine toujours exigée** :
- recherche Drive **`incompleteSearch = true`** persistante → `levees += { type: "recherche_incomplete", constat }` ;
- historique **peut-être purgé** → `levees += { type: "historique_incomplet", constat }`.

**Non bloquant** : plusieurs fichiers de **cœur identique**. **Horloges** : les dates servent à parcourir (fenêtre élargie de 24 h), jamais seules à exclure.

## 11. Attestation : charge signée, enveloppe, clés

- **Charge** `attestation-cloture/v1` : `{ schema, set_id, notion_id, palier, coeur, sha256_instantane, code_confirmation, confirmation, fidelite_transmission, relecteur_attribue, relecteur_egal_cloturer, provenances, nb_fichiers_decision, referentiel_version, moteur: { version, sha256 }, execution_cloture, revoque_le, levees, incidents_connus, cloture_le, badge, cle_id }`.
- **Invariants** (script ; `publier-lot.js` et CI pour ce qui est public) : `code_confirmation` = code(`sha256_instantane`) (`sha256_instantane` vérifiable **localement** seulement) ; `coeur.moteur = moteur = entree.moteur` et `moteur.sha256 = registre[moteur.version].sha256` ; `confirmation.par = relecteur_attribue`, `recue_par = "eric"` ; `mode = "auto"` ⇔ `relecteur_egal_cloturer` ⇔ `relecteur_attribue = "eric"` ; badge = relecteur de l'entrée (§12) ; `selection`/`ecartees` disjointes, sans doublon, **partition du candidat** (locale) ; `selection = item_ids` du fichier ; `coeur.empreinte_publiee` = empreinte du fichier ; `coeur.action = "accepter"`.
- **Signature** RSA-SHA256 PKCS#1 v1.5 sur les octets canoniques de la **charge** (sans champ `signature`) ; **enveloppe** `attestation = { type: "cloture-signee", charge, signature }`.
- **Clés** : `fonda/data/cles/cles.json` = `[{ cle_id (unique), fichier (SPKI PEM), sha256_pem, algorithme, valide_du, valide_au, revoquee_le }]` ; chargement uniquement via `cle_id` déclaré ; **recevabilité** : `cloture_le ∈ [valide_du, valide_au]` (reste recevable après expiration) ; clé **révoquée** → toutes ses attestations irrecevables (§14).
- **Vecteurs de test** complets (charge → octets → signature → vérification ; altération → échec).

## 12. Badge élève

| Situation | `badge` signé | `entree.relecteur` | Texte |
|---|---|---|---|
| Tiers ayant confirmé | `{ forme: "relue_et_validee", nom_affiche, id }` | identique | « Fiche relue et validée par <nom> » |
| Auto-confirmation | `{ forme: "relue_par", nom_affiche: "Éric Duchateau", id: "eric" }` | identique | « Fiche relue par Éric Duchateau » |
| Sans nom | `{ forme: "relue_par", nom_affiche: "un professeur", id: null }` | identique | « Fiche relue par un professeur » |

**Même schéma** pour `badge` et `entree.relecteur` (`{ forme, nom_affiche, id }`), égalité stricte vérifiée par la CI. Lots historiques : exception figée `{ forme: "relue_par", nom_affiche: "Éric Duchateau", id: "eric" }` (libellé seulement). Le texte est construit par le composant à partir de `forme` (aujourd'hui en dur « relue et validée »).

## 13. Conditions d'activation — à prouver sur la copie de test

0. **C8 en premier (avant tout remaniement du front)** : sur l'instance 2.6.3, une page servie par `Respond to Webhook` (donc enveloppée dans l'iframe sandboxée de n8n) charge un script **depuis GitHub Pages** avec `integrity` + `crossorigin="anonymous"` : (a) le script s'exécute avec la bonne SRI ; (b) il est **refusé** avec une SRI fausse ; (c) les en-têtes CORS de Pages le permettent ; (d) la CSP effective (enveloppe n8n + la nôtre + proxy) laisse passer exactement ce qu'il faut ; (e) le formulaire POST fonctionne depuis l'iframe. **Si un point échoue**, la liaison du moteur côté relecture est revue (par exemple moteur servi inline dans la page avec son empreinte vérifiée côté n8n, ou page de relecture servie depuis Pages) **avant** de toucher au front élève.
   **Résultat (2026-10-13, instance 2.6.3, Chrome réel, workflow de test jetable supprimé ensuite)** : ✅ page servie par `Respond to Webhook` **sans enveloppe iframe** dans les faits ; ✅ CORS `access-control-allow-origin: *` sur Pages (et sur jsDelivr, hôte des moteurs de démo, Pages ne servant que `main`) ; ✅ SRI juste → chargé, SRI fausse → **bloqué** (Pages et jsDelivr) ; ✅ mécanisme §4.1 : v1 et v2 de comportements différents chacun obtenu par **sa** version, cache réutilisé (même instance), deux chargements concurrents → **une seule** balise, écrasement d'une version enregistrée **sans effet**, empreinte différente du registre **refusée** ; ✅ POST du formulaire depuis la page reçu par n8n. ⚠️ **n8n remplace notre en-tête CSP par le sien** (`Content-Security-Policy: sandbox allow-scripts allow-forms …`) : notre politique doit donc être posée en **`<meta http-equiv="Content-Security-Policy">`** en tête de page — vérifié : `script-src` (script hors liste **bloqué**), `form-action` et `base-uri` appliqués. Limite : `frame-ancestors` **ne peut pas** être posé en `<meta>` ; la protection contre l'encadrement repose sur le `sandbox` imposé par n8n et reste à évaluer (§13.3). Conclusion : **le transport est faisable** ; aucun repli nécessaire.
1. Observation des exécutions par l'API (avec et sans filtre ; accès du jeton vérifié).
2. Révocation : GET ouvert, clôture technique, soumission → refus.
3. Parcours complet en navigateur réel (GET → POST → confirmation, rejet, erreurs, conflit 409).
4. Limites : refus immédiat des requêtes invalides ; ni relance ni reprise manuelle.
5. Rétention relevée (`EXECUTIONS_DATA_PRUNE`, `…_MAX_AGE`, `…_PRUNE_MAX_COUNT`).
6. Front : chargement du moteur de la version de l'entrée avec `integrity` ; SRI en échec → « pas disponible » ; deux lots de versions différentes dans une même session → deux instances.
7. Annexe A appliquée par Éric après relecture, recette comprise.

## 14. Révocation de la clé de signature

Rotation : nouvelle clé, `valide_au` sur l'ancienne. Compromission : **une seule PR** qui fixe `revoquee_le` et, pour chaque lot concerné, soit le retire, soit le **reclôture** (instantané et confirmation refaits) à **empreinte et moteur identiques**. La CI valide l'état final contre la base (annexe B).

## 15. Fichiers de confiance et mainteneur unique (C1, C2)

- **Liste** : `.github/workflows/**` ; `fonda/engine/catalogue.js` (dont `HISTORIQUES_FIGES`) ; `fonda/engine/canonique.js` ; `fonda/engine/moteurs.json` et `fonda/engine/moteur-correction-v*.js` ; `fonda/engine/carte-reponse-produite.js` ; `fonda/page/bootstrap.js` ; `fonda/scripts/publier-lot.js` ; `fonda/scripts/signer-cloture.js` ; `fonda/scripts/verifier-immuabilite.js` ; `fonda/scripts/generer-lot-fonda.js` (tant que ses validations sont importées par `publier-lot.js`) ; `fonda/data/cles/**` ; `fonda/data/set_ids-journal.json` ; `fonda/data/catalogue-fonda.json` ; `.github/CODEOWNERS` ; les tests de ces fichiers.
- **Garantie humaine, dite explicitement** : Éric est **mainteneur unique** ; pour ces fichiers, **sa relecture en PR est la garantie** ; **aucun mécanisme ne s'y substitue**. Protéger la branche ne protège pas la valeur du contrôle (une PR peut modifier le contrôle lui-même) : **risque assumé**, couvert uniquement par cette relecture.
- **Signal (filet, non probant) : CODEOWNERS** (décision Éric, face à l'échéance du 2 novembre 2026 : GitHub a annoncé la désactivation de `pull_request_target` pour les dépôts publics concernés ; **aucun contournement** n'est monté). Fichier `.github/CODEOWNERS` désignant **`@ericduchateau`** propriétaire de **chacun des chemins de confiance** ci-dessus (et de `.github/CODEOWNERS` lui-même). Effet : GitHub **demande automatiquement sa relecture** sur toute PR touchant ces chemins (notification de plateforme) ; **sans approbation imposée** (« Require review from Code Owners » **non coché** : un auteur ne peut pas approuver sa propre PR). Ce n'est pas une barrière ; c'est un signal qui dirige la relecture d'Éric. *Remarque honnête* : quand Éric est l'auteur de la PR, GitHub ne se demande pas sa propre revue ; le signal vaut alors surtout pour les PR d'autres auteurs (agents, contributeurs). Vérifier, sans en faire un bloquant, si le dépôt est concerné par la désactivation de `pull_request_target` (aucun workflow ne l'utilise désormais).

## 16. Annexe A — Réglages GitHub (corrigés, **non appliqués**)

1. **Settings → Actions → General** : Actions autorisées ; **Workflow permissions** = **« Read repository contents and packages permissions »**. Vérifier que la **branche par défaut** du dépôt est bien `main`.
2. **Settings → Branches → « Add classic branch protection rule »**, motif **`main`** : ☑ **Require a pull request before merging** (« **Require approvals** » **laissé décoché** : mainteneur unique, une PR est imposée mais **aucune approbation n'est enregistrée par GitHub**) ; ☑ **Require status checks to pass before merging** → ☑ **Require branches to be up to date before merging** → contrôles requis **`tests (node --test)`** et **`immuabilite`**, source **GitHub Actions** ; ☑ **Do not allow bypassing the above settings** ; ☐ Allow force pushes ; ☐ Allow deletions.
3. Même règle pour **`design`**.
4. **Rulesets** : non utilisés (s'il en existe : activation et exceptions vérifiées).
5. **Settings → Pages** : **Deploy from a branch**, **`main`**, **`/ (root)`** — à vérifier.
6. **Ordre** : (a) fusionner d'abord la PR qui **installe** le job `immuabilite` et le fichier `.github/CODEOWNERS` ; (b) attendre que `immuabilite` ait **tourné au moins une fois** (sinon il n'est pas sélectionnable) ; (c) seulement alors le déclarer requis. Dans la règle de protection, laisser **« Require review from Code Owners » décoché**.
7. **Recette** : vérifier quelle règle s'applique **effectivement** à chaque branche (les règles classiques ne se cumulent pas : un seul motif par branche) ; PR cassant `node --test` → *Merge* bloqué ; PR violant l'**immuabilité** (empreinte d'un lot publié modifiée) → *Merge* bloqué ; PR (d'un autre auteur ou d'un compte de test) touchant `fonda/engine/catalogue.js` → `@ericduchateau` demandé automatiquement en relecture ; PR modifiant `.github/CODEOWNERS` → idem ; `git push` direct sur **`design` et sur `main`** → refusé.

## 17. Annexe B — Immuabilité en CI (C6)

Script `fonda/scripts/verifier-immuabilite.js` + job **`immuabilite`** :
- **Référence** : sur `pull_request`, `github.event.pull_request.base.sha` ; sur `push`, `github.event.before`. Référence **nulle, introuvable, ou historique incomplet → échec explicite** ; jamais de comparaison contre un état vide. Historique de confiance = historique **de la référence**.
- **Règles** : (0) **migration initiale** : la PR identifiée comme migration (§4.3) peut ajouter `moteur: v1` aux **8 lots historiques** (`HISTORIQUES_FIGES`) à empreintes inchangées, et **rien d'autre** ; ensuite la règle 1 s'applique sans exception ; (1) un `set_id` du catalogue de la référence garde **la même empreinte et le même moteur** (retrait autorisé ; remplacement d'attestation seulement à empreinte et moteur identiques, nouvelle clôture valide) ; (2) **promotion vs réutilisation (B3)** : un `set_id` **nouvellement publié** doit avoir, dans le journal, une transition `reserve` **sans** `abandonne` ni `retire` et **jamais** de `publie` antérieur ; sa présence antérieure en **calibration** est **autorisée** (promotion du **même** candidat réservé) ; un `set_id` abandonné ou retiré ne peut **jamais** être publié ; (3) `set_ids-journal.json` est **en ajout seul**, transitions conformes (§6), aucun double `reserve` ; (4) `moteurs.json` est **append-only** ; tout fichier `moteur-correction-v<N>.js` ayant **jamais** existé dans l'historique de confiance doit être **présent et identique** (aucune suppression, aucune réintroduction avec d'autres octets) ; (5) l'invariant SHA-256 = registre = SRI est revérifié.
- Le checkout d'une PR teste le **résultat de fusion simulé** : il est comparé à la référence de base.

## 18. Séquencement du build (décision Éric)

1. **Preuve C8 d'abord** (§13.0), sur la copie de test, avec un script de démonstration jetable **utilisant le mécanisme d'export et de chargement du §4.1** (enregistrement sous version, `obtenirMoteur`, SRI, refus d'écrasement), la CSP envisagée et le parcours GET → POST réel. C8 tranche la **faisabilité du transport**, pas l'exhaustivité du moteur. **Aucun remaniement de `bootstrap.js` tant que C8 n'est pas tranché.** Si C8 échoue : adapter la liaison côté relecture, mettre à jour ce CDC, puis seulement continuer.
2. **Chantier/PR « moteur de correction élève »**, **isolé** des workflows de relecture : consolidation en `moteur-correction-v1.js` (comportement identique, prouvé par les tests existants rejoués), registre `moteurs.json`, injection explicite dans `carte-reponse-produite.js`, chargement par version + SRI dans `bootstrap.js`, `entree.moteur` + `forme` du badge dans le catalogue, immuabilité CI des moteurs. Vérifié par la suite de tests **et** en navigateur réel (rendu, parcours complet, BOX clair intact au pixel près). **Point de merge propre** avant d'empiler le reste.
3. Ensuite seulement : `canonique.js`, clés, `set_ids-journal.json`, `publier-lot.js`, `verifier-immuabilite.js` complet, `.github/CODEOWNERS`, `signer-cloture.js` ; puis les workflows (inactifs) ; puis les conditions §13 sur la copie de test.

## 19. Décisions d'Éric (2026-10-13)

1. Clé 14 j. 2. « Essayer une réponse » en v1. 3. Clôture manuelle obligatoire. 4. Signature locale. 5. Historique n8n conservé partout. 6. CI de vérification publique. 7. Option B : l'humain garantit, la technique est un filet non probant. 8. Auto-confirmation déclarée, badge « relue par ». 9. Instantané figé unique, transmission sans retouche attestée. 10. **Moteur de correction élève versionné de bout en bout** (correcteur + adaptation + seconde chance + tentative comptée), injecté explicitement, identique relecture/élève. 11. **Moteur figé par lot publié** ; tout changement de comportement ⇒ nouveau `set_id` + nouvelle relecture. 12. Levées limitées à deux cas ; blocages durs propres au lot ⇒ abandon ; incidents de chaîne suspendent tout. 13. Mainteneur unique ; marqueur `pull_request_target` sur `main`. 14. **Séquencement : C8 prouvé d'abord ; moteur = chantier/PR isolé avant la signature/clôture ; point d'étape avec Éric avant l'étape 2.** 15. Alertes : Éric seul. 16. **Le moteur produit le résultat pédagogique complet** ; le composant n'affiche que ce résultat. 17. **Incidents `ouvert`/`resolu`** : un incident ouvert suspend tout. 18. **Journal des identifiants** en transitions, `design` fait autorité ; promotion autorisée, réutilisation interdite. 19. **Marqueur remplacé par CODEOWNERS** (signal, pas barrière ; aucun contournement de `pull_request_target`).
