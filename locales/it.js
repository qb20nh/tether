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
    "startInfinite": "Avvia infinito",
    "nextInfinite": "Prossimo livello infinito",
    "prevInfinite": "Livello infinito precedente",
    "infiniteComplete": "Infinito completato",
    "nextDisabledUncleared": "Completa prima questo livello per continuare.",
    "nextDisabledInfiniteEnd": "Sei all'ultimo livello infinito.",
    "prevInfiniteDisabledFirst": "Sei a Infinito #1.",
    "infiniteLevelOption": "Infinito #{{n}}",
    "dailyLevelOption": "Giornaliero",
    "dailyLevelOptionWithDate": "{{label}} ({{date}})",
    "dailyUnavailable": "Giornaliero (Non disponibile)",
    "dailyComplete": "Giornaliero completato",
    "dailyDateLabel": "Data",
    "dailyResetLabel": "Scade tra",
    "dailyResetNow": "Ora",
    "reset": "Reimposta",
    "resetTitle": "Reimposta percorso",
    "reverse": "Inverti",
    "reverseTitle": "Inverti direzione del percorso",
    "guide": "Guida",
    "legend": "Suggerimenti / Vincoli",
    "show": "Mostra",
    "hide": "Nascondi",
    "puzzleGridAria": "Griglia del puzzle",
    "githubRepoAria": "Visualizza Tether su GitHub",
    "githubRepoTitle": "Visualizza il codice sorgente su GitHub"
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
      "name": "Lezione 1) Base",
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
      "name": "Esercizio 1) Base",
      "desc": "Un layout di base con suggerimenti misti."
    },
    "pilot_2": {
      "name": "Esercizio 2) Blocco d’asse",
      "desc": "Gli spazi sono bloccati da indicazioni diritte orizzontali/verticali."
    },
    "pilot_3": {
      "name": "Esercizio 3) CW/CCW + Muri",
      "desc": "Curve direzionali combinate con muri."
    },
    "pilot_4": {
      "name": "Esercizio 4) Cucitura incrociata",
      "desc": "Una condizione di cucitura."
    },
    "pilot_5": {
      "name": "Esercizio 5) Cuciture multiple + CW/CCW",
      "desc": "Più cuciture con curve direzionali."
    },
    "pilot_6": {
      "name": "Esercizio 6) Cuciture in area spezzata",
      "desc": "I muri costringono scelte di diramazione tramite cuciture."
    },
    "pilot_7": {
      "name": "Esercizio 7) Stress",
      "desc": "Una combinazione di cuciture, muri e suggerimenti direzionali."
    },
    "pilot_8": {
      "name": "Esercizio 8) Diffusione RPS",
      "desc": "Disegna un percorso che passi per Forbice/Sasso/Carta in ordine."
    },
    "pilot_9": {
      "name": "Esercizio 9) RPS + Cucitura",
      "desc": "Combinazione di vincoli RPS ordinati e cucitura (diagonale forzata)."
    },
    "pilot_10": {
      "name": "Esercizio 10) Due muri mobili",
      "desc": "Due muri mobili. Riordinali prima di iniziare."
    },
    "pilot_11": {
      "name": "Esercizio 11) Intreccio d'angoli",
      "desc": "Un mix di conteggi d'angolo, suggerimenti direzionali e cuciture."
    },
    "pilot_12": {
      "name": "Esercizio 12) Trama trinitaria",
      "desc": "Un rompicapo in cui i vincoli RPS si incrociano con le cuciture."
    }
  }
}
;
