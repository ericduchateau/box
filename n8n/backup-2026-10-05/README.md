# Sauvegarde des workflows n8n — 2026-10-05

Export en lecture seule des 9 workflows BOX actifs en production, à la date du 2026-10-05, avant le démarrage de T5 (Box-FONDA). **Aucun workflow n'a été modifié, activé ni désactivé** pour produire cette sauvegarde — lecture seule via `n8n_list_workflows` / `n8n_get_workflow` (MCP n8n).

Instance source : `https://n8n.srv868991.hstgr.cloud/`.

## Sécurité — clé API redacted

Deux workflows (`box-generation-flashcards.json`, `box-generation-tally.json`) appellent l'API Anthropic via un node HTTP Request portant la clé API **en clair** dans ses paramètres (point de vigilance déjà noté dans `AVANCEMENT.md` — migration vers un credential n8n chiffré pas encore faite). La valeur réelle a été remplacée par `__REDACTED_SEE_N8N_CREDENTIAL_NOT_IN_GIT__` avant commit : ce repo est public (GitHub Pages), y laisser la clé l'aurait rendue publique et indexable. La vraie valeur reste consultable dans n8n (édition du node "Claude API" de chaque workflow).

## Les 9 workflows

| Fichier | Nom n8n | ID | Webhook(s) | Rôle |
|---|---|---|---|---|
| `box-catalogue-api.json` | BOX - Catalogue API | `vyBa3F03gDfDz4C3` | `GET /box-catalogue` | Sert le `catalogue.json` (liste des jeux) depuis Drive aux élèves |
| `box-fiche-api.json` | BOX - Fiche API | `LiswcNFCh5UiYuwc` | `GET /box-set` | Sert le contenu JSON d'une fiche individuelle (par `file_id`), nettoyé des champs sensibles (email prof, code suppression) |
| `box-question-eleve.json` | BOX - Question Eleve | `0lo2EJjYDUh0ouKp` | `POST /box-question` | Transmet par email au prof une question posée par un élève sur une carte |
| `box-suppression.json` | BOX - Suppression | `lCSOkYDaQt46u96y` | `POST /box-delete` | Supprime un jeu de fiches (vérifie le code de suppression, retire du catalogue, supprime le fichier Drive) |
| `box-generation-flashcards.json` | BOX - Generation Flashcards | `7UfpOH5oBBzxSM2g` | — (trigger Google Sheets, pas de webhook) | Génère les flashcards via Claude (Haiku) depuis un PDF, voie Google Form |
| `box-generation-tally.json` | BOX - Generation Tally | `aKRunzvTw7Y3WnTT` | `POST /box-tally` | Idem génération, voie Tally (profs sans compte Google) |
| `box-validation-prof.json` | BOX - Validation Prof | `PGnB14t4JJ0j7HKn` | `GET /box-validate` | Ancien lien "Valider" (emails envoyés avant le 2026-10-01) — conservé pour compat, plus utilisé pour les nouvelles générations |
| `box-rejet-prof.json` | BOX - Rejet Prof | `PQhg6g4vsfC3KHRN` | `GET /box-reject` | Ancien lien "Rejeter" (emails envoyés avant le 2026-10-01) — conservé pour compat |
| `box-selection-prof.json` | BOX - Selection Prof | `HdDyacN45SPMyZoJ` | `GET /box-select`, `POST /box-select-confirm` | Relecture carte par carte avant publication (lien envoyé depuis le 2026-10-01, remplace Validation/Rejet pour les nouvelles générations) |

Tous actifs (`active: true`) au moment de l'export. Détail des credentials référencés (Google Drive, Gmail) : identifiants n8n internes uniquement (pas de secret), résolus côté n8n.
