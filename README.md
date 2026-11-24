# Portefeuille

Application iPhone (PWA) pour suivre en un seul endroit :

- **Patrimoine** : comptes bancaires, livrets, PEA, actions Revolut / CTO, assurance-vie, crypto — avec lignes (quantité, PRU, cours) et plus/moins-values, répartition et courbe d'évolution.
- **Dépenses par semaine** : saisie rapide, budget hebdo, catégories, historique sur 8 semaines, import CSV.
- **Projets financiers** : objectif, échéance, épargne mensuelle nécessaire, suivi manuel ou lié au solde d'un compte.

**Multi-devises** : chaque compte et chaque dépense a sa devise (USD, GBP, CHF…), avec l'équivalent dans la devise principale (EUR par défaut). Taux de référence BCE téléchargés automatiquement (via Frankfurter), modifiables à la main.

Les données restent **uniquement sur l'appareil** (stockage local du navigateur). Aucun serveur, aucun compte. Fonctionne hors ligne (avec les derniers taux connus). La seule requête réseau sert à récupérer les taux de change ; aucune donnée personnelle n'est envoyée.

## Planning (dossier `planning/`)

Calendrier d'abonnement généré à partir des shifts Tanda : sommeil, Uber Eats, sport et temps libre placés automatiquement. Voir [`planning/README.md`](planning/README.md).

## Installer sur iPhone

1. Activer GitHub Pages : *Settings → Pages → Source : GitHub Actions* (le workflow `.github/workflows/pages.yml` déploie le dossier `web/` à chaque push sur `main`).
2. Ouvrir l'URL Pages dans **Safari** sur l'iPhone.
3. Toucher **Partager → Sur l'écran d'accueil**. L'app s'ouvre ensuite en plein écran comme une app native.

> Pensez à exporter une sauvegarde (Réglages → Exporter) de temps en temps : effacer les données de Safari ou supprimer l'app de l'écran d'accueil efface aussi les données.

## Développement local

Aucune dépendance ni étape de build :

```sh
cd web && python3 -m http.server 8000
```

Régénérer les icônes : `node tools/make-icons.js` (nécessite Playwright).

## Import CSV des dépenses

Une ligne par dépense, séparateur `;` ou `,` :

```
date;montant;catégorie;note
2026-11-20;12,50;restaurant;Déjeuner
21/11/2026;-45,30;courses;Carrefour
```

Catégories reconnues : courses, restaurant, transport, logement, loisirs, shopping, sante, abonnements, autre.
