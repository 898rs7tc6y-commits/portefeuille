# Planning

Un calendrier d'abonnement qui se met à jour tout seul à partir de tes shifts **Tanda**, et qui place autour d'eux :

| Priorité | Bloc | Règle |
|---|---|---|
| 1 | 🍸 Bar | Imposé par Tanda, + trajet aller/retour |
| 2 | 😴 Sommeil | Coucher fixe les soirs sans bar ; après un shift : fin + trajet + décompression. Écourté seulement si un shift le lendemain l'impose (alerte sous le minimum) |
| 3 | 🛵 Uber Eats | Rushs midi/soir, vendredi-samedi-dimanche d'abord ; plafonds jour/semaine ; jamais le jour off ni le lendemain d'une nuit courte |
| 4 | 🏋️ Sport | N séances/semaine, sur la combinaison de jours la moins chargée, jamais 2 jours de suite |
| 5 | 🌿 Temps libre | Ce qui reste entre le réveil et la décompression |

Chaque lundi, un évènement « journée entière » 📊 donne le bilan de la semaine (heures bar/UE, gain estimé, sport, temps libre, sommeil moyen) et les alertes.

## Mise en place (une fois)

1. **Lien Tanda** : dans Tanda, récupère le lien d'abonnement calendrier (iCal / webcal). Ce lien donne accès à tes shifts : ne le mets **jamais** dans le dépôt.
2. **Vercel** : nouveau projet sur ce dépôt, *Root Directory* = `planning`, puis deux variables d'environnement :
   - `TANDA_ICS_URL` = le lien Tanda
   - `PLANNING_KEY` = une longue chaîne aléatoire (ex. `openssl rand -hex 24`)
3. **iPhone** : Réglages → Calendrier → Comptes → Ajouter un compte → Autre → *Ajouter un calendrier avec abonnement* :
   `https://<ton-projet>.vercel.app/planning.ics?cle=<PLANNING_KEY>`
   Choisis un rafraîchissement fréquent. Pour garder les rappels UE/sport, désactive « Supprimer les alertes ».

Version lisible pour vérifier : ajoute `&format=texte` à l'URL.

> Google Agenda ne rafraîchit les abonnements que toutes les 12 à 24 h : préfère le Calendrier d'Apple.

## Réglages

Tout est dans [`config.js`](config.js) : heures de sommeil, fenêtres de rush, objectif d'heures UE, nombre de séances de sport, plafonds de travail, engagements fixes (cours, rendez-vous…). Les valeurs marquées `HYPOTHÈSE` sont à confirmer.

## En local

```sh
cd planning
npm test                                    # tests
npm run apercu                              # aperçu sur un roster fictif
node cli.js "<lien Tanda>" --ics sortie.ics # aperçu sur ton vrai roster
```

Aucune dépendance.
