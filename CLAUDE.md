# BOX — Flashcards de révision pour Devoirs Faits

## Architecture
```
Prof remplit Google Form (PDF du cours)
  → Google Sheet BOX-Responses
    → n8n : BOX-Generation (Claude Haiku génère les flashcards JSON)
      → JSON stocké sur Google Drive (dossier BOX-Flashcards)
        → catalogue.json mis à jour

Élève ouvre le frontend (GitHub Pages)
  → Charge catalogue.json via webhook n8n
    → Choisit un jeu de fiches
      → Révision avec répétition espacée (localStorage)
```

## IDs Google
- Dossier BOX : `1kWDKFrV9NYsEe7Ol9noD3gzUbyye_r_U`
- Dossier BOX-Flashcards : `11KWo13pczVB_eOXw-FHUXWuutfSQqbbT`
- catalogue.json : `1AmmMsO3nh4h0GQ0I5XzIqWG_zHA9wopa`
- Form ID : `1Ni7Craa4s5kgfm4AX-q3pnTWI1ML_94Qx5jMBW0Ye1s`
- Sheet BOX-Responses : `1HCJZ0mWtpOsCCVpLUd3dyRGB-7btiVSXBcQCmGCd4AE`

## Workflows n8n
| Workflow | ID | Rôle |
|----------|-----|------|
| BOX - Catalogue API | `vyBa3F03gDfDz4C3` | Sert le catalogue.json aux élèves |
| BOX - Fiche API | `LiswcNFCh5UiYuwc` | Sert une fiche individuelle |
| BOX - Question Eleve | `0lo2EJjYDUh0ouKp` | Envoie la question d'un élève au prof par email |
| BOX - Suppression | `lCSOkYDaQt46u96y` | Supprime un jeu de fiches (code de suppression) |
| BOX - Generation Flashcards | `7UfpOH5oBBzxSM2g` | Génère les flashcards depuis le PDF via Claude Haiku |

## Webhooks n8n
- `/box-catalogue` — Liste des jeux disponibles
- `/box-set` — Contenu d'un jeu de fiches
- `/box-question` — Question d'élève vers le prof
- `/box-delete` — Suppression d'un jeu

## URLs
- Form profs : `https://docs.google.com/forms/d/e/1FAIpQLSfJqn4AyDaJJocITESsLRgLzqv1Qp0V-U7rMqowKRjArgzaGw/viewform`
- Form edit : `https://docs.google.com/forms/d/1Ni7Craa4s5kgfm4AX-q3pnTWI1ML_94Qx5jMBW0Ye1s/edit`

## Frontend
- `index.html` — Page principale avec sélection des fiches et révision
- `css/style.css` — Styles
- `js/config.js` — Configuration (DEMO_MODE, URLs webhooks)
- `js/app.js` — Logique de l'application
- Mode démo actif (`DEMO_MODE: true` dans config.js) — passer à `false` en production

## Actions manuelles restantes
1. Ajouter le champ "Fichier PDF" (upload) dans le Google Form (non supporté par l'API)
2. Lier le Form au Sheet BOX-Responses (onglet Réponses > icône Sheets)
3. Configurer les credentials Google OAuth2 et Gmail dans chaque workflow n8n
4. Remplacer la clé API Anthropic dans le workflow Generation
5. Créer un compte GitHub + repo + activer Pages
6. Uploader les fichiers frontend sur GitHub
7. Mettre `DEMO_MODE` à `false` et renseigner les URLs webhooks dans `config.js`
