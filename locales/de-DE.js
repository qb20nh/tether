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
    "dailyLevelOption": "Täglich",
    "scoreInfiniteLabel": "Punkte (Endlos)",
    "scoreDailyLabel": "Punkte (Täglich)",
    "dailyLevelOptionWithDate": "{{label}} ({{date}})",
    "dailyUnavailable": "Täglich (Nicht verfügbar)",
    "dailyComplete": "Täglich abgeschlossen",
    "dailyDateLabel": "Datum",
    "dailyResetLabel": "Neustart in",
    "dailyResetNow": "Jetzt",
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
      "name": "Einführung 1) Grundlagen",
      "desc": "Starte auf einem beliebigen Feld und besuche jedes Feld genau einmal."
    },
    "tutorial_2": {
      "name": "Einführung 2) Kurve (beliebig)",
      "desc": "Das Kurven-Symbol erzwingt eine Richtungsänderung auf diesem Feld."
    },
    "tutorial_3": {
      "name": "Einführung 3) Gerade + H/V",
      "desc": "Gerade-/horizontal-/vertikal-Hinweise erzwingen auf diesem Feld einen geraden Pfad."
    },
    "tutorial_4": {
      "name": "Einführung 4) CW / CCW",
      "desc": "CW(r) bedeutet Bewegung von vorher zu nachher im Uhrzeigersinn, CCW(l) gegen den Uhrzeigersinn."
    },
    "tutorial_5": {
      "name": "Einführung 5) Kreuznaht",
      "desc": "An einem X-Eck werden beide diagonalen Verbindungen (↘︎↖︎, ↙︎↗︎) erzwungen, daher ist diagonaler Zug notwendig."
    },
    "tutorial_6": {
      "name": "Einführung 6) Eckenzählung (0-3)",
      "desc": "Die Zahl sagt, wie viele Pfadverbindungen es zwischen den vier Zellen an einer Ecke gibt (0~3)."
    },
    "tutorial_7": {
      "name": "Einführung 7) Schere / Stein / Papier Reihenfolge",
      "desc": "Die Besuchsreihenfolge für RPS-Felder muss Schere→Stein→Papier→Schere... folgen."
    },
    "tutorial_8": {
      "name": "Einführung 8) Bewegliche Wände",
      "desc": "Ziehe die verschiebbare Wand auf ein leeres Feld. (Nicht auf Hinweis-/RPS-Felder legen)"
    },
    "pilot_1": {
      "name": "Übung 1) Grundlagen",
      "desc": "Ein einfaches Layout mit gemischten Hinweisen."
    },
    "pilot_2": {
      "name": "Übung 2) Achs-Sperren",
      "desc": "Räume werden durch horizontale/vertikale Gerade-Hinweise blockiert."
    },
    "pilot_3": {
      "name": "Übung 3) CW/CCW + Wände",
      "desc": "Richtungswechsel kombiniert mit Wänden."
    },
    "pilot_4": {
      "name": "Übung 4) Kreuznaht",
      "desc": "Eine Nahtbedingung."
    },
    "pilot_5": {
      "name": "Übung 5) Mehrfache Nähte + CW/CCW",
      "desc": "Mehrere Nähte mit Richtungswechsel."
    },
    "pilot_6": {
      "name": "Übung 6) Naht in zerbrochener Fläche",
      "desc": "Wände erzwingen Verzweigungsentscheidungen durch Nähte."
    },
    "pilot_7": {
      "name": "Übung 7) Stress",
      "desc": "Eine Mischung aus Nähten, Wänden und Richtungszeichen."
    },
    "pilot_8": {
      "name": "Übung 8) RPS-Verteilung",
      "desc": "Entwerfe einen Pfad, der Schere/Stein/Papier in Reihenfolge passiert."
    },
    "pilot_9": {
      "name": "Übung 9) RPS + Naht",
      "desc": "Kombinierte RPS-Reihenfolge und Naht (erzwungene Diagonale)-Beschränkungen."
    },
    "pilot_10": {
      "name": "Übung 10) Zwei verschiebbare Wände",
      "desc": "Zwei bewegliche Wände. Arrangiere sie vor dem Lösen neu an."
    },
    "pilot_11": {
      "name": "Übung 11) Eckengeflecht",
      "desc": "Eine Mischung aus Eckenzählungen, Richtungs-Hinweisen und Nähten."
    },
    "pilot_12": {
      "name": "Übung 12) Trinitätsgeflecht",
      "desc": "Ein Rätsel, in dem sich RPS-Einschränkungen mit Nähten kreuzen."
    }
  }
}
;
