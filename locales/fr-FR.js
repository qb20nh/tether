export default {
  "ui": {
    "levelLabel": "Niveau",
    "levelSelectAria": "Sélectionner un niveau",
    "language": "Langue",
    "theme": "Thème",
    "themeDark": "Mode sombre",
    "themeLight": "Mode clair",
    "themeSwitchTitle": "Changer le thème",
    "themeSwitchPrompt": "Passer à {{theme}}?",
    "themeSwitchConfirm": "Appliquer",
    "cancel": "Annuler",
    "nextLevel": "Niveau suivant",
    "startInfinite": "Démarrer l'infini",
    "nextInfinite": "Niveau infini suivant",
    "prevInfinite": "Niveau infini précédent",
    "infiniteComplete": "Mode infini terminé",
    "nextDisabledUncleared": "Terminez d'abord ce niveau pour continuer.",
    "nextDisabledInfiniteEnd": "Vous êtes au dernier niveau infini.",
    "prevInfiniteDisabledFirst": "Vous êtes à Infini #1.",
    "infiniteLevelOption": "Infini #{{n}}",
    "dailyLevelOption": "Quotidien",
    "scoreInfiniteLabel": "Score (Infini)",
    "scoreDailyLabel": "Score (Quotidien)",
    "dailyLevelOptionWithDate": "{{label}} ({{date}})",
    "dailyUnavailable": "Quotidien (Indisponible)",
    "dailyComplete": "Quotidien terminé",
    "dailyDateLabel": "Date",
    "dailyResetLabel": "Réinitialisation dans",
    "dailyResetNow": "Maintenant",
    "reset": "Réinitialiser",
    "resetTitle": "Réinitialiser le chemin",
    "reverse": "Inverser",
    "reverseTitle": "Inverser la direction du chemin",
    "guide": "Guide",
    "legend": "Indices / Contraintes",
    "show": "Afficher",
    "hide": "Masquer",
    "puzzleGridAria": "Grille du puzzle",
    "githubRepoAria": "Voir Tether sur GitHub",
    "githubRepoTitle": "Voir le code source sur GitHub"
  },
  "goal": {
    "intro": "<b>Objectif</b> : Tracez un chemin continu qui visite chaque cellule non murale <b>exactement une fois</b>.",
    "thisLevelPrefix": "<br><b>Ce niveau</b> : "
  },
  "completion": {
    "completed": "Terminé ✅ Toutes les cellules visitées + toutes les contraintes satisfaites"
  },
  "legend": {
    "controls": "Contrôles",
    "turn": "<strong>Tour (t)</strong> : la direction entre les deux déplacements doit changer",
    "cw": "<strong>CW (r)</strong> : le mouvement précédent→suivant doit tourner dans le sens des aiguilles",
    "ccw": "<strong>CCW (l)</strong> : le mouvement précédent→suivant doit tourner dans le sens inverse",
    "straight": "<strong>Tout droit (s)</strong> : déplacements droits uniquement",
    "horizontal": "<strong>Horizontal (h)</strong> : déplacements droits horizontaux",
    "vertical": "<strong>Vertical (v)</strong> : déplacements droits verticaux",
    "scissors": "<strong>Ciseaux (g)</strong> : ciseaux",
    "rock": "<strong>Pierre (b)</strong> : pierre",
    "paper": "<strong>Papier (p)</strong> : papier",
    "crossStitch": "<strong>Couture croisée (x)</strong> : deux connexions diagonales sont imposées",
    "cornerCount": "<strong>Comptage de coins</strong> : force le nombre de connexions (0~3) autour d’un sommet",
    "movableWall": "<strong>Mur mobile (m)</strong> : glisser pour déplacer"
  },
  "level": {
    "tutorial_1": {
      "name": "Tutoriel 1) Bases",
      "desc": "Commencez sur n’importe quelle case et visitez chaque case exactement une fois."
    },
    "tutorial_2": {
      "name": "Tutoriel 2) Tour (n'importe quel)",
      "desc": "Le symbole de tour force un changement de direction sur cette case."
    },
    "tutorial_3": {
      "name": "Tutoriel 3) Tout droit + H/V",
      "desc": "Les indices tout droit/horizontal/vertical forcent un segment droit sur cette case."
    },
    "tutorial_4": {
      "name": "Tutoriel 4) CW / CCW",
      "desc": "CW(r) signifie que le déplacement précédent→suivant doit tourner dans le sens des aiguilles, CCW(l) dans le sens inverse."
    },
    "tutorial_5": {
      "name": "Tutoriel 5) Couture croisée",
      "desc": "Sur un sommet X, les deux liens diagonaux (↘︎↖︎, ↙︎↗︎) sont imposés, donc un mouvement diagonal est requis."
    },
    "tutorial_6": {
      "name": "Tutoriel 6) Nombre de coins (0-3)",
      "desc": "Le nombre indique combien de liens de chemin existent entre les quatre cases autour d’un angle (0~3)."
    },
    "tutorial_7": {
      "name": "Tutoriel 7) Ordre Ciseaux/Pierre/Papier",
      "desc": "L’ordre de visite pour les cases PFC doit suivre Ciseaux→Pierre→Papier→Ciseaux… dans cet ordre."
    },
    "tutorial_8": {
      "name": "Tutoriel 8) Murs mobiles",
      "desc": "Glissez le mur mobile vers une case vide. (Impossible de le placer sur les indices/RPS)"
    },
    "pilot_1": {
      "name": "Exercice 1) Bases",
      "desc": "Une base simple avec des indices mélangés."
    },
    "pilot_2": {
      "name": "Exercice 2) Verrous d’axe",
      "desc": "Les espaces sont verrouillés par des indices tout droit horizontaux/verticaux."
    },
    "pilot_3": {
      "name": "Exercice 3) CW/CCW + Murs",
      "desc": "Virages directionnels combinés à des murs."
    },
    "pilot_4": {
      "name": "Exercice 4) Couture croisée",
      "desc": "Une seule contrainte de couture."
    },
    "pilot_5": {
      "name": "Exercice 5) Multi-coutures + CW/CCW",
      "desc": "Multiples coutures avec virages directionnels."
    },
    "pilot_6": {
      "name": "Exercice 6) Couture dans un champ brisé",
      "desc": "Les murs forcent des choix de branchement via les coutures."
    },
    "pilot_7": {
      "name": "Exercice 7) Stress",
      "desc": "Un mélange de coutures, de murs et d’indices directionnels."
    },
    "pilot_8": {
      "name": "Exercice 8) Diffusion PFC",
      "desc": "Concevez un chemin pour parcourir les ciseaux/pierre/papier dans l’ordre."
    },
    "pilot_9": {
      "name": "Exercice 9) PFC + Couture",
      "desc": "Ordre PFC et contrainte de couture (diagonal obligée) combinés."
    },
    "pilot_10": {
      "name": "Exercice 10) Deux murs mobiles",
      "desc": "Deux murs mobiles. Réorganisez-les avant de résoudre."
    },
    "pilot_11": {
      "name": "Exercice 11) Tissage d'angles",
      "desc": "Un mélange de comptage des coins, d’indices directionnels et de points de couture."
    },
    "pilot_12": {
      "name": "Exercice 12) Tissage trinaire",
      "desc": "Un puzzle où les contraintes RPS se croisent avec les points de couture."
    }
  }
}
;
