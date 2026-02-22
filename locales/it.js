export default {
  "ui": {
    "levelLabel": "Livello",
    "levelSelectAria": "Seleziona livello",
    "language": "Lingua",
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
    "crossStitch": "<strong>Stitch incrociato (x)</strong>: viene richiesta la connessione diagonale",
    "cornerCount": "<strong>Conteggio angoli</strong>: impone il numero di connessioni (0~3) intorno a un vertice",
    "movableWall": "<strong>Muro mobile (m)</strong>: trascina per spostare"
  },
  "level": {
    "tutorial_1": {
      "name": "Tutorial 1) Base (3x3)",
      "desc": "Inizia da qualsiasi cella e visita ogni cella esattamente una volta."
    },
    "tutorial_2": {
      "name": "Tutorial 2) Curva (qualsiasi)",
      "desc": "L'icona curva forza una curva direzionale su quella cella."
    },
    "tutorial_3": {
      "name": "Tutorial 3) Dritto + O/V",
      "desc": "Le indicazioni Dritto/Orazz/Verticale forzano un percorso dritto su quella cella."
    },
    "tutorial_4": {
      "name": "Tutorial 4) CW / CCW",
      "desc": "CW(r) significa che la mossa da una cella alla successiva deve girare in senso orario, CCW(l) in senso antiorario."
    },
    "tutorial_5": {
      "name": "Tutorial 5) Stitch incrociato",
      "desc": "In un vertice X, entrambi i collegamenti diagonali (↘︎↖︎, ↙︎↗︎) sono forzati, quindi è necessario muoversi diagonalmente."
    },
    "tutorial_6": {
      "name": "Tutorial 6) Conteggio angoli (0-3)",
      "desc": "Il numero indica quante connessioni del percorso esistono tra le quattro celle attorno a un vertice (0~3)."
    },
    "tutorial_7": {
      "name": "Tutorial 7) Ordine Forbice / Sasso / Carta",
      "desc": "L'ordine di visita delle tessere RPS deve seguire Forbice→Sasso→Carta→Forbice… in sequenza."
    },
    "tutorial_8": {
      "name": "Tutorial 8) Muri mobili",
      "desc": "Trascina il muro mobile su una cella vuota (non puoi metterlo su suggerimenti o tessere RPS)."
    },
    "pilot_1": {
      "name": "Pilot 1) Base (4x4)",
      "desc": "Un layout di base con suggerimenti misti."
    },
    "pilot_2": {
      "name": "Pilot 2) Blocchi asse (5x5)",
      "desc": "Gli spazi sono bloccati da indicazioni diritte orizzontali/verticali."
    },
    "pilot_3": {
      "name": "Pilot 3) CW/CCW + Muri (5x5)",
      "desc": "Curve direzionali combinate con muri."
    },
    "pilot_4": {
      "name": "Pilot 4) Stitch incrociato (5x5)",
      "desc": "Una condizione di stitch."
    },
    "pilot_5": {
      "name": "Pilot 5) Stitch multipli + CW/CCW (6x6)",
      "desc": "Più stitch con curve direzionali."
    },
    "pilot_6": {
      "name": "Pilot 6) Stitch in campo frammentato (6x6)",
      "desc": "I muri costringono scelte di diramazione tramite stitch."
    },
    "pilot_7": {
      "name": "Pilot 7) Stress (7x7)",
      "desc": "Una combinazione di stitch, muri e suggerimenti direzionali."
    },
    "pilot_8": {
      "name": "Pilot 8) Diffusione RPS (5x5)",
      "desc": "Disegna un percorso che passi per Forbice/Sasso/Carta in ordine."
    },
    "pilot_9": {
      "name": "Pilot 9) RPS + Stitch (5x5)",
      "desc": "Combinazione di vincoli RPS ordinati e stitch (diagonale forzata)."
    },
    "pilot_10": {
      "name": "Pilot 10) Due muri mobili (6x6)",
      "desc": "Due muri mobili. Riordinali prima di iniziare."
    },
    "pilot_11": {
      "name": "Pilot 11) Corner Weave (6x6)",
      "desc": "Un mix di conteggi d'angolo, suggerimenti direzionali e stitch. Più soluzioni possono soddisfare i vincoli."
    },
    "pilot_12": {
      "name": "Pilot 12) Trinity Weave (7x7)",
      "desc": "Il rompicapo più difficile, dove i vincoli RPS si incrociano con gli stitch."
    }
  }
}
;
