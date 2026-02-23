export default {
  "ui": {
    "levelLabel": "Ebene",
    "levelSelectAria": "Ebene auswählen",
    "language": "Sprache",
    "theme": "Thema",
    "themeDark": "Dunkelmodus",
    "themeLight": "Hellmodus",
    "themeSwitchTitle": "Thema wechseln",
    "themeSwitchPrompt": "Zu {{theme}} wechseln?",
    "themeSwitchConfirm": "Anwenden",
    "cancel": "Abbrechen",
    "nextLevel": "Nächstes Level",
    "startInfinite": "Endlosmodus starten",
    "nextInfinite": "Nächstes Endlos-Level",
    "prevInfinite": "Vorheriges Endlos-Level",
    "infiniteComplete": "Endlosmodus abgeschlossen",
    "nextDisabledUncleared": "Schließe dieses Level zuerst ab, um fortzufahren.",
    "nextDisabledInfiniteEnd": "Du bist beim letzten Endlos-Level.",
    "prevInfiniteDisabledFirst": "Du bist bei Endlos #1.",
    "infiniteLevelOption": "Endlos #{{n}}",
    "reset": "Zurücksetzen",
    "resetTitle": "Pfad zurücksetzen",
    "reverse": "Umkehren",
    "reverseTitle": "Richtung des Pfades umkehren",
    "guide": "Anleitung",
    "legend": "Hinweise / Einschränkungen",
    "show": "Anzeigen",
    "hide": "Ausblenden",
    "puzzleGridAria": "Puzzle-Raster",
    "githubRepoAria": "Tether auf GitHub ansehen",
    "githubRepoTitle": "Quellcode auf GitHub ansehen"
  },
  "goal": {
    "intro": "<b>Ziel</b>: Zeichne einen durchgehenden Pfad, der jede nichtwandige Zelle <b>genau einmal</b> besucht.",
    "thisLevelPrefix": "<br><b>Dieses Level</b>: "
  },
  "completion": {
    "completed": "Abgeschlossen ✅ Alle Zellen besucht + alle Bedingungen erfüllt"
  },
  "legend": {
    "controls": "Steuerung",
    "turn": "<strong>Kurve (t)</strong>: Bewegung vorher→nachher muss die Richtung ändern",
    "cw": "<strong>CW (r)</strong>: Bewegung vorher→nachher muss im Uhrzeigersinn drehen",
    "ccw": "<strong>CCW (l)</strong>: Bewegung vorher→nachher muss gegen den Uhrzeigersinn drehen",
    "straight": "<strong>Gerade (s)</strong>: nur gerade Bewegungen",
    "horizontal": "<strong>Horizontal (h)</strong>: horizontale Geradeausbewegung",
    "vertical": "<strong>Vertikal (v)</strong>: vertikale Geradeausbewegung",
    "scissors": "<strong>Schere (g)</strong>: Schere",
    "rock": "<strong>Stein (b)</strong>: Stein",
    "paper": "<strong>Papier (p)</strong>: Papier",
    "crossStitch": "<strong>Quernaht (x)</strong>: zwei diagonale Verbindungen werden erzwungen",
    "cornerCount": "<strong>Eckenzählung</strong>: erzwingt die Anzahl von 0~3 Verbindungen um einen Eckpunkt",
    "movableWall": "<strong>Verschiebbare Mauer (m)</strong>: ziehen zum Bewegen"
  },
  "level": {
    "tutorial_1": {
      "name": "Anleitung 1) Grundlagen (3x3)",
      "desc": "Starte auf einem beliebigen Feld und besuche jedes Feld genau einmal."
    },
    "tutorial_2": {
      "name": "Anleitung 2) Kurve (beliebig)",
      "desc": "Das Kurven-Symbol erzwingt eine Richtungsänderung auf diesem Feld."
    },
    "tutorial_3": {
      "name": "Anleitung 3) Gerade + H/V",
      "desc": "Gerade-/horizontal-/vertikal-Hinweise erzwingen auf diesem Feld einen geraden Pfad."
    },
    "tutorial_4": {
      "name": "Anleitung 4) CW / CCW",
      "desc": "CW(r) bedeutet Bewegung von vorher zu nachher im Uhrzeigersinn, CCW(l) gegen den Uhrzeigersinn."
    },
    "tutorial_5": {
      "name": "Anleitung 5) Kreuznaht",
      "desc": "An einem X-Eck werden beide diagonalen Verbindungen (↘︎↖︎, ↙︎↗︎) erzwungen, daher ist diagonaler Zug notwendig."
    },
    "tutorial_6": {
      "name": "Anleitung 6) Eckenzählung (0-3)",
      "desc": "Die Zahl sagt, wie viele Pfadverbindungen es zwischen den vier Zellen an einer Ecke gibt (0~3)."
    },
    "tutorial_7": {
      "name": "Anleitung 7) Schere / Stein / Papier Reihenfolge",
      "desc": "Die Besuchsreihenfolge für RPS-Felder muss Schere→Stein→Papier→Schere... folgen."
    },
    "tutorial_8": {
      "name": "Anleitung 8) Bewegliche Wände",
      "desc": "Ziehe die verschiebbare Wand auf ein leeres Feld. (Nicht auf Hinweis-/RPS-Felder legen)"
    },
    "pilot_1": {
      "name": "Pilot 1) Grundlagen (4x4)",
      "desc": "Ein einfaches Layout mit gemischten Hinweisen."
    },
    "pilot_2": {
      "name": "Pilot 2) Achs-Sperren (5x5)",
      "desc": "Räume werden durch horizontale/vertikale Gerade-Hinweise blockiert."
    },
    "pilot_3": {
      "name": "Pilot 3) CW/CCW + Wände (5x5)",
      "desc": "Richtungswechsel kombiniert mit Wänden."
    },
    "pilot_4": {
      "name": "Pilot 4) Kreuznaht (5x5)",
      "desc": "Eine Nahtbedingung."
    },
    "pilot_5": {
      "name": "Pilot 5) Mehrfache Nähte + CW/CCW (6x6)",
      "desc": "Mehrere Nähte mit Richtungswechsel."
    },
    "pilot_6": {
      "name": "Pilot 6) Naht in zerbrochener Fläche (6x6)",
      "desc": "Wände erzwingen Verzweigungsentscheidungen durch Nähte."
    },
    "pilot_7": {
      "name": "Pilot 7) Stress (7x7)",
      "desc": "Eine Mischung aus Nähten, Wänden und Richtungszeichen."
    },
    "pilot_8": {
      "name": "Pilot 8) RPS-Verteilung (5x5)",
      "desc": "Entwerfe einen Pfad, der Schere/Stein/Papier in Reihenfolge passiert."
    },
    "pilot_9": {
      "name": "Pilot 9) RPS + Naht (5x5)",
      "desc": "Kombinierte RPS-Reihenfolge und Naht (erzwungene Diagonale)-Beschränkungen."
    },
    "pilot_10": {
      "name": "Pilot 10) Zwei verschiebbare Wände (6x6)",
      "desc": "Zwei bewegliche Wände. Arrangiere sie vor dem Lösen neu an."
    },
    "pilot_11": {
      "name": "Pilot 11) Eckengeflecht (6x6)",
      "desc": "Eine Mischung aus Eckenzählungen, Richtungs-Hinweisen und Nähten. Es gibt mehr als eine Lösung, die alle Einschränkungen erfüllt."
    },
    "pilot_12": {
      "name": "Pilot 12) Trinitätsgeflecht (7x7)",
      "desc": "Das schwierigste Rätsel: Die RPS-Einschränkungen kreuzen sich mit Nähten."
    }
  }
}
;
