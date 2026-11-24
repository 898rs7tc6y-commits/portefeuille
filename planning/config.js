'use strict';

/* ==========================================================================
   Réglages du planning. Tout ce qui est marqué « HYPOTHÈSE » est une valeur
   par défaut à confirmer, pas une information que tu as donnée.
   Heures au format 'HH:MM', fuseau IANA (ex. 'Europe/Paris').
   ========================================================================== */

module.exports = {
  fuseau: 'Europe/Paris',                     // HYPOTHÈSE
  nomCalendrier: 'Mon planning',
  semainesMax: 4,                             // horizon max (le roster Tanda limite déjà)

  sommeil: {
    coucher: '23:30',                         // HYPOTHÈSE : heure de coucher les soirs sans bar
    dureeH: 8,                                // HYPOTHÈSE : durée visée
    minimumH: 7,                              // en dessous : alerte « nuit courte »
    decompressionMin: 45,                     // entre la fin du shift (+ trajet) et le coucher
    reveilMin: 45,                            // réveil -> première activité
    afficher: true,
  },

  bar: {
    libelle: '🍸 Bar',
    trajetMin: 30,                            // HYPOTHÈSE : trajet aller ou retour
    filtreTitre: null,                        // ex. 'shift' pour ne garder que certains évènements Tanda
    inclure: true,                            // recopier les shifts dans ce calendrier
  },

  uberEats: {
    libelle: '🛵 Uber Eats',
    // Fenêtres de rush par jour. Le créneau réel est la plus grande plage libre dedans.
    creneaux: {
      lundi: [['18:30', '21:30']],
      mardi: [['18:30', '21:30']],
      mercredi: [['18:30', '21:30']],
      jeudi: [['18:30', '21:30']],
      vendredi: [['18:30', '22:30']],
      samedi: [['11:30', '14:30'], ['18:30', '22:30']],
      dimanche: [['11:30', '14:30'], ['18:00', '22:00']],
    },
    joursPrioritaires: ['vendredi', 'samedi', 'dimanche'], // remplis en premier
    objectifSemaineH: 15,                     // HYPOTHÈSE : plafond d'heures UE par semaine
    sessionMinH: 1.5,                         // en dessous, pas rentable de se connecter
    pauseMin: 30,                             // tampon avant/après une session (manger, se changer)
    gainHoraireEstime: 14,                    // HYPOTHÈSE : €/h net, pour l'estimation
    devise: '€',
    rappelMin: 20,
  },

  sport: {
    libelle: '🏋️ Sport',
    seancesParSemaine: 3,                     // HYPOTHÈSE
    dureeMin: 75,                             // trajet + séance + douche
    creneaux: [['09:00', '12:30'], ['14:00', '20:00']],
    pasDeuxJoursDeSuite: true,
    maxTravailJourH: 8,                       // pas de sport un jour où bar + UE dépasse ça
    pasAvantCoucherH: 3,
    margeMin: 30,
    rappelMin: 30,
  },

  tempsLibre: {
    libelle: '🌿 Temps libre',
    blocMinH: 1.5,                            // plus petit bloc affiché
    minimumSemaineH: 15,                      // en dessous : alerte
    afficher: true,
  },

  // Créneaux fixes chaque semaine (cours, autre job, rendez-vous…), jamais touchés.
  engagements: [
    // { jour: 'lundi', debut: '09:00', fin: '12:00', libelle: '📚 Cours', margeMin: 30 },
  ],

  limites: {
    maxTravailJourH: 11,                      // bar + UE
    maxTravailSemaineH: 50,                   // bar + UE
    garderUnJourOff: true,                    // un jour sans bar reste sans UE
    reposApresNuitCourte: true,               // ni UE ni sport le lendemain d'une nuit courte
    jourOffPrefere: ['mercredi', 'mardi', 'jeudi', 'lundi', 'vendredi', 'dimanche', 'samedi'],
  },
};
