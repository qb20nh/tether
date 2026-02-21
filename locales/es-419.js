export default {
  "ui": {
    "levelLabel": "Nivel",
    "levelSelectAria": "Seleccionar nivel",
    "language": "Idioma",
    "reset": "Reiniciar",
    "resetTitle": "Reiniciar ruta",
    "reverse": "Invertir",
    "reverseTitle": "Invertir dirección de ruta",
    "guide": "Guía",
    "legend": "Pistas / Restricciones",
    "show": "Mostrar",
    "hide": "Ocultar",
    "puzzleGridAria": "Cuadrícula del rompecabezas"
  },
  "goal": {
    "intro": "<b>Objetivo</b>: Dibuja un camino continuo que visite cada celda no pared <b>exactamente una vez</b>.",
    "thisLevelPrefix": "<br><b>Este nivel</b>: "
  },
  "completion": {
    "completed": "Completado ✅ Se visitaron todas las celdas + se satisfacen todas las restricciones",
    "allVisitedOk": "Todas las celdas visitadas: OK",
    "cellsLeft": "Quedan {{count}} celdas",
    "hintsOk": "Pistas: OK",
    "hintsConflict": "Pistas: {{count}} conflictos",
    "stitchesOk": "Costuras: OK",
    "stitchesConflict": "Costuras: {{count}} conflictos",
    "rpsOk": "Piedra/Papel/Tijeras: OK",
    "rpsConflict": "Piedra/Papel/Tijeras: {{count}} conflictos"
  },
  "legend": {
    "controls": "Controles",
    "turn": "<strong>Giro (t)</strong>: el movimiento previo→siguiente debe cambiar de dirección",
    "cw": "<strong>CW (r)</strong>: el movimiento previo→siguiente debe girar en sentido horario",
    "ccw": "<strong>CCW (l)</strong>: el movimiento previo→siguiente debe girar en sentido antihorario",
    "straight": "<strong>Recto (s)</strong>: solo movimientos rectos",
    "horizontal": "<strong>Horizontal (h)</strong>: movimientos rectos horizontales",
    "vertical": "<strong>Vertical (v)</strong>: movimientos rectos verticales",
    "scissors": "<strong>Tijera (g)</strong>: tijera",
    "rock": "<strong>Piedra (b)</strong>: piedra",
    "paper": "<strong>Papel (p)</strong>: papel",
    "crossStitch": "<strong>Costura cruzada (x)</strong>: se exigen dos conexiones diagonales",
    "cornerCount": "<strong>Conteo de esquinas</strong>: fuerza el número de conexiones de 0~3 alrededor de un vértice",
    "movableWall": "<strong>Pared móvil (m)</strong>: arrastrar para mover"
  },
  "lang": {
    "ko": "한국어",
    "en": "English",
    "en-US": "English (US)",
    "en-GB": "English (UK)",
    "zh-Hans": "中文（简体）",
    "zh-Hant": "中文（繁體）",
    "es-419": "Español (Latinoamérica)",
    "pt-BR": "Português (Brasil)",
    "ar": "العربية",
    "ja-JP": "日本語",
    "ko-KR": "한국어",
    "de-DE": "Deutsch",
    "fr-FR": "Français"
  },
  "level": {
    "tutorial_1": {
      "name": "Tutorial 1) Básico (3x3)",
      "desc": "Comienza en cualquier celda y visita cada celda exactamente una vez."
    },
    "tutorial_2": {
      "name": "Tutorial 2) Giro (any)",
      "desc": "El ícono de giro obliga a un cambio de dirección en esa celda."
    },
    "tutorial_3": {
      "name": "Tutorial 3) Recto + H/V",
      "desc": "Las pistas de recto/horizontal/vertical fuerzan un tramo recto en esa celda."
    },
    "tutorial_4": {
      "name": "Tutorial 4) CW / CCW",
      "desc": "CW(r) significa que el movimiento de anterior a siguiente debe girar en sentido horario, CCW(l) en sentido antihorario."
    },
    "tutorial_5": {
      "name": "Tutorial 5) Costura cruzada",
      "desc": "En un vértice X se fuerzan ambas diagonales (↘︎↖︎, ↙︎↗︎), así que el movimiento diagonal es necesario."
    },
    "tutorial_6": {
      "name": "Tutorial 6) Conteo de esquina (0-3)",
      "desc": "El número indica cuántas conexiones de ruta existen entre las cuatro celdas de una esquina (0~3)."
    },
    "tutorial_7": {
      "name": "Tutorial 7) Orden de Tijera/Piedra/Papel",
      "desc": "El orden de visita de las celdas RPS debe seguir Tijera→Piedra→Papel→Tijera… en secuencia."
    },
    "tutorial_8": {
      "name": "Tutorial 8) Paredes móviles",
      "desc": "Arrastra la pared móvil a una celda vacía. (No se puede colocar en celdas de pistas/RPS)"
    },
    "pilot_1": {
      "name": "Piloto 1) Básico (4x4)",
      "desc": "Un diseño básico con pistas mixtas."
    },
    "pilot_2": {
      "name": "Piloto 2) Bloqueos por eje (5x5)",
      "desc": "Los espacios se bloquean por pistas horizontales/verticales de trazo recto."
    },
    "pilot_3": {
      "name": "Piloto 3) CW/CCW + Paredes (5x5)",
      "desc": "Giros direccionales combinados con paredes."
    },
    "pilot_4": {
      "name": "Piloto 4) Costura cruzada (5x5)",
      "desc": "Una única restricción de costura."
    },
    "pilot_5": {
      "name": "Piloto 5) Múltiples costuras + CW/CCW (6x6)",
      "desc": "Múltiples costuras con giros direccionales."
    },
    "pilot_6": {
      "name": "Piloto 6) Costura en campo roto (6x6)",
      "desc": "Las paredes fuerzan decisiones de bifurcación mediante costuras."
    },
    "pilot_7": {
      "name": "Piloto 7) Estrés (7x7)",
      "desc": "Mezcla de costuras, paredes y pistas de dirección."
    },
    "pilot_8": {
      "name": "Piloto 8) RPS extendido (5x5)",
      "desc": "Diseña un camino para pasar por Tijera/Piedra/Papel en orden."
    },
    "pilot_9": {
      "name": "Piloto 9) RPS + Costura (5x5)",
      "desc": "Orden de RPS y restricciones de costura (diagonal obligatoria) combinadas."
    },
    "pilot_10": {
      "name": "Piloto 10) Dos paredes móviles (6x6)",
      "desc": "Dos paredes móviles. Reacomódalas antes de resolver."
    }
  }
}
;
