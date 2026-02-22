export default {
  "ui": {
    "levelLabel": "Livello",
    "levelSelectAria": "Seleziona livello",
    "language": "Lingua",
    "theme": "Tema",
    "themeDark": "Modalità scura",
    "themeLight": "Modalità chiara",
    "themeSwitchTitle": "Cambia tema",
    "themeSwitchPrompt": "Passa a {{theme}}?",
    "themeSwitchConfirm": "Applica",
    "cancel": "Annulla",
    "nextLevel": "Prossimo livello",
    "reset": "Reimposta",
    "resetTitle": "Reimposta percorso",
    "reverse": "Inverti",
    "reverseTitle": "Inverti direzione del percorso",
    "guide": "Guida",
    "legend": "Suggerimenti / Vincoli",
    "show": "Mostra",
    "hide": "Nascondi",
    "puzzleGridAria": "Griglia del puzzle"
  },
  "goal": {
    "intro": "<b>Obiettivo</b>: disegna un percorso continuo che visita ogni cella senza muri <b>esattamente una volta</b>.",
    "thisLevelPrefix": "<br><b>Questo livello</b>: "
  },
  "completion": {
    "completed": "Completato ✅ Tutte le celle visitate + tutti i vincoli soddisfatti"
  },
  "legend": {
    "controls": "Controlli",
    "turn": "<strong>Curva (t)</strong>: la mossa precedente→successiva deve cambiare direzione",
    "cw": "<strong>CW (r)</strong>: la mossa precedente→successiva deve girare in senso orario",
    "ccw": "<strong>CCW (l)</strong>: la mossa precedente→successiva deve girare in senso antiorario",
    "straight": "<strong>Retto (s)</strong>: solo mosse dritte",
    "horizontal": "<strong>Orizzontale (h)</strong>: mosse dritte orizzontali",
    "vertical": "<strong>Verticale (v)</strong>: mosse dritte verticali",
    "scissors": "<strong>Forbice (g)</strong>: forbice",
    "rock": "<strong>Sasso (b)</strong>: sasso",
    "paper": "<strong>Carta (p)</strong>: carta",
    "crossStitch": "<strong>Cucitura incrociata (x)</strong>: viene richiesta la connessione diagonale",
    "cornerCount": "<strong>Conteggio angoli</strong>: impone il numero di connessioni (0~3) intorno a un vertice",
    "movableWall": "<strong>Muro mobile (m)</strong>: trascina per spostare"
  },
  "level": {
    "tutorial_1": {
      "name": "Lezione 1) Base (3x3)",
      "desc": "Inizia da qualsiasi cella e visita ogni cella esattamente una volta."
    },
    "tutorial_2": {
      "name": "Lezione 2) Curva (qualsiasi)",
      "desc": "L'icona curva forza una curva direzionale su quella cella."
    },
    "tutorial_3": {
      "name": "Lezione 3) Dritto + O/V",
      "desc": "Le indicazioni Dritto/Orazz/Verticale forzano un percorso dritto su quella cella."
    },
    "tutorial_4": {
      "name": "Lezione 4) CW / CCW",
      "desc": "CW(r) significa che la mossa da una cella alla successiva deve girare in senso orario, CCW(l) in senso antiorario."
    },
    "tutorial_5": {
      "name": "Lezione 5) Cucitura incrociata",
      "desc": "In un vertice X, entrambi i collegamenti diagonali (↘︎↖︎, ↙︎↗︎) sono forzati, quindi è necessario muoversi diagonalmente."
    },
    "tutorial_6": {
      "name": "Lezione 6) Conteggio angoli (0-3)",
      "desc": "Il numero indica quante connessioni del percorso esistono tra le quattro celle attorno a un vertice (0~3)."
    },
    "tutorial_7": {
      "name": "Lezione 7) Ordine Forbice / Sasso / Carta",
      "desc": "L'ordine di visita delle tessere RPS deve seguire Forbice→Sasso→Carta→Forbice… in sequenza."
    },
    "tutorial_8": {
      "name": "Lezione 8) Muri mobili",
      "desc": "Trascina il muro mobile su una cella vuota (non puoi metterlo su suggerimenti o tessere RPS)."
    },
    "pilot_1": {
      "name": "Pilota 1) Base (4x4)",
      "desc": "Un layout di base con suggerimenti misti."
    },
    "pilot_2": {
      "name": "Pilota 2) Blocco d’asse (5x5)",
      "desc": "Gli spazi sono bloccati da indicazioni diritte orizzontali/verticali."
    },
    "pilot_3": {
      "name": "Pilota 3) CW/CCW + Muri (5x5)",
      "desc": "Curve direzionali combinate con muri."
    },
    "pilot_4": {
      "name": "Pilota 4) Cucitura incrociata (5x5)",
      "desc": "Una condizione di cucitura."
    },
    "pilot_5": {
      "name": "Pilota 5) Cuciture multiple + CW/CCW (6x6)",
      "desc": "Più cuciture con curve direzionali."
    },
    "pilot_6": {
      "name": "Pilota 6) Cuciture in area spezzata (6x6)",
      "desc": "I muri costringono scelte di diramazione tramite cuciture."
    },
    "pilot_7": {
      "name": "Pilota 7) Stress (7x7)",
      "desc": "Una combinazione di cuciture, muri e suggerimenti direzionali."
    },
    "pilot_8": {
      "name": "Pilota 8) Diffusione RPS (5x5)",
      "desc": "Disegna un percorso che passi per Forbice/Sasso/Carta in ordine."
    },
    "pilot_9": {
      "name": "Pilota 9) RPS + Cucitura (5x5)",
      "desc": "Combinazione di vincoli RPS ordinati e cucitura (diagonale forzata)."
    },
    "pilot_10": {
      "name": "Pilota 10) Due muri mobili (6x6)",
      "desc": "Due muri mobili. Riordinali prima di iniziare."
    },
    "pilot_11": {
      "name": "Pilota 11) Intreccio d'angoli (6x6)",
      "desc": "Un mix di conteggi d'angolo, suggerimenti direzionali e cuciture. Più soluzioni possono soddisfare i vincoli."
    },
    "pilot_12": {
      "name": "Pilota 12) Trama trinitaria (7x7)",
      "desc": "Il rompicapo più difficile, dove i vincoli RPS si incrociano con le cuciture."
    }
  }
}
;
