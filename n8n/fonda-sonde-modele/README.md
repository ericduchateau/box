# Sonde modèle §20.8 (lot 6) — ARCHIVE

Workflow n8n **« BOX - FONDA Sonde modele »** (`ZQASW4PKigh1JaHt`) :
- créé **inactif** le 2026-10-21, déclenchement **manuel** uniquement ;
- credential « Anthropic FONDA » (`YnhTnSOc1u7S99Q7`) ;
- séparé du workflow de génération : le signataire ne l'observe jamais ;
- aucune donnée élève, aucun Drive, aucun journal.

Export : `box-fonda-sonde-modele.json`, état final (version 2), sans le champ `shared`, qui contient l'adresse du propriétaire.

## Preuves (exécutions manuelles, conservées sur l'instance)

| Exécution | Date (UTC) | Modèle demandé | Statut HTTP | Champ `model` de la réponse |
|---|---|---|---|---|
| `279791` | 2026-10-21 14:14:41 | `claude-sonnet-5-5-20261001` | 404 `not_found_error` | — |
| `279792` | 2026-10-21 14:18:46 | `claude-sonnet-5-5` | 200 (réponse « OK. ») | `claude-sonnet-5-5` |

`GET /v1/models` (même exécution) : seul `claude-sonnet-4-5-20250929` est daté parmi les Sonnet ; Sonnet 5.5 n'existe que sous `claude-sonnet-5-5`.

D'après la documentation Anthropic, les identifiants sans date depuis la génération 4.6 sont des snapshots épinglés (CDC r8, §20.8).

## Ce que la sonde a justifié

- `fonda/data/modeles-autorises.json` = `["claude-sonnet-5-5"]` ;
- le workflow de génération est épinglé sur `claude-sonnet-5-5`.

## Archivage

Le workflow reste sur l'instance, **inactif**, pour garder les exécutions de preuve.
- **Ne pas le supprimer** : la suppression effacerait aussi son historique d'exécution.
- L'archivage dans n8n se fait depuis l'interface (« Archive »), à la main par Éric.
