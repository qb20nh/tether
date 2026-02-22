export default {
  "ui": {
    "levelLabel": "Niveau",
    "levelSelectAria": "Sélectionner un niveau",
    "language": "Langue",
    "reset": "Réinitialiser",
    "resetTitle": "Réinitialiser le chemin",
    "reverse": "Inverser",
    "reverseTitle": "Inverser la direction du chemin",
    "guide": "Guide",
    "legend": "Indices / Contraintes",
    "show": "Afficher",
    "hide": "Masquer",
    "puzzleGridAria": "Grille du puzzle"
  },
  "goal": {
    "intro": "<b>Objectif</b> : Tracez un chemin continu qui visite chaque cellule non murale <b>exactement une fois</b>.",
    "thisLevelPrefix": "<br><b>Ce niveau</b> : "
  },
  "completion": {
    "completed": "Terminé ✅ Toutes les cellules visitées + toutes les contraintes satisfaites",
    "allVisitedOk": "Toutes les cellules visitées : OK",
    "cellsLeft": "{{count}} cellules restantes",
    "hintsOk": "Indices : OK",
    "hintsConflict": "{{count}} conflits d’indices",
    "stitchesOk": "Points de couture : OK",
    "stitchesConflict": "Points de couture : {{count}} conflits",
    "rpsOk": "PFC : OK",
    "rpsConflict": "PFC : {{count}} conflits"
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
      "name": "Didacticiel 1) Bases (3x3)",
      "desc": "Commencez sur n’importe quelle case et visitez chaque case exactement une fois."
    },
    "tutorial_2": {
      "name": "Didacticiel 2) Tour (any)",
      "desc": "Le symbole de tour force un changement de direction sur cette case."
    },
    "tutorial_3": {
      "name": "Didacticiel 3) Tout droit + H/V",
      "desc": "Les indices tout droit/horizontal/vertical forcent un segment droit sur cette case."
    },
    "tutorial_4": {
      "name": "Didacticiel 4) CW / CCW",
      "desc": "CW(r) signifie que le déplacement précédent→suivant doit tourner dans le sens des aiguilles, CCW(l) dans le sens inverse."
    },
    "tutorial_5": {
      "name": "Didacticiel 5) Couture croisée",
      "desc": "Sur un sommet X, les deux liens diagonaux (↘︎↖︎, ↙︎↗︎) sont imposés, donc un mouvement diagonal est requis."
    },
    "tutorial_6": {
      "name": "Didacticiel 6) Nombre de coins (0-3)",
      "desc": "Le nombre indique combien de liens de chemin existent entre les quatre cases autour d’un angle (0~3)."
    },
    "tutorial_7": {
      "name": "Didacticiel 7) Ordre Ciseaux/Pierre/Papier",
      "desc": "L’ordre de visite pour les cases PFC doit suivre Ciseaux→Pierre→Papier→Ciseaux… dans cet ordre."
    },
    "tutorial_8": {
      "name": "Didacticiel 8) Murs mobiles",
      "desc": "Glissez le mur mobile vers une case vide. (Impossible de le placer sur les indices/RPS)"
    },
    "pilot_1": {
      "name": "Pilote 1) Bases (4x4)",
      "desc": "Une base simple avec des indices mélangés."
    },
    "pilot_2": {
      "name": "Pilote 2) Verrous d’axe (5x5)",
      "desc": "Les espaces sont verrouillés par des indices tout droit horizontaux/verticaux."
    },
    "pilot_3": {
      "name": "Pilote 3) CW/CCW + Murs (5x5)",
      "desc": "Virages directionnels combinés à des murs."
    },
    "pilot_4": {
      "name": "Pilote 4) Couture croisée (5x5)",
      "desc": "Une seule contrainte de couture."
    },
    "pilot_5": {
      "name": "Pilote 5) Multi-coutures + CW/CCW (6x6)",
      "desc": "Multiples coutures avec virages directionnels."
    },
    "pilot_6": {
      "name": "Pilote 6) Couture dans un champ brisé (6x6)",
      "desc": "Les murs forcent des choix de branchement via les coutures."
    },
    "pilot_7": {
      "name": "Pilote 7) Stress (7x7)",
      "desc": "Un mélange de coutures, de murs et d’indices directionnels."
    },
    "pilot_8": {
      "name": "Pilote 8) Diffusion PFC (5x5)",
      "desc": "Concevez un chemin pour parcourir les ciseaux/pierre/papier dans l’ordre."
    },
    "pilot_9": {
      "name": "Pilote 9) PFC + Couture (5x5)",
      "desc": "Ordre PFC et contrainte de couture (diagonal obligée) combinés."
    },
    "pilot_10": {
      "name": "Pilote 10) Deux murs mobiles (6x6)",
      "desc": "Deux murs mobiles. Réorganisez-les avant de résoudre."
    }
  }
}
;
