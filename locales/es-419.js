export default {
  "ui": {
    "levelLabel": "Nivel",
    "levelSelectAria": "Seleccionar nivel",
    "language": "Idioma",
    "theme": "Tema",
    "themeDark": "Modo oscuro",
    "themeLight": "Modo claro",
    "themeSwitchTitle": "Cambiar tema",
    "themeSwitchPrompt": "¿Cambiar a {{theme}}?",
    "themeSwitchConfirm": "Aplicar",
    "cancel": "Cancelar",
    "nextLevel": "Siguiente nivel",
    "startInfinite": "Iniciar modo infinito",
    "nextInfinite": "Siguiente nivel infinito",
    "prevInfinite": "Nivel infinito anterior",
    "infiniteComplete": "Modo infinito completado",
    "nextDisabledUncleared": "Completa primero este nivel para continuar.",
    "nextDisabledInfiniteEnd": "Estás en el último nivel infinito.",
    "prevInfiniteDisabledFirst": "Estás en Infinito #1.",
    "infiniteLevelOption": "Infinito #{{n}}",
    "dailyLevelOption": "Diario",
    "dailyLevelOptionWithDate": "{{label}} ({{date}})",
    "dailyUnavailable": "Diario (No disponible)",
    "dailyComplete": "Diario completado",
    "dailyDateLabel": "Fecha",
    "dailyResetLabel": "Se reinicia en",
    "dailyResetNow": "Ahora",
    "reset": "Reiniciar",
    "resetTitle": "Reiniciar ruta",
    "reverse": "Invertir",
    "reverseTitle": "Invertir dirección de ruta",
    "guide": "Guía",
    "legend": "Pistas / Restricciones",
    "show": "Mostrar",
    "hide": "Ocultar",
    "puzzleGridAria": "Cuadrícula del rompecabezas",
    "githubRepoAria": "Ver Tether en GitHub",
    "githubRepoTitle": "Ver el código fuente en GitHub"
  },
  "goal": {
    "intro": "<b>Objetivo</b>: Dibuja un camino continuo que visite cada celda no pared <b>exactamente una vez</b>.",
    "thisLevelPrefix": "<br><b>Este nivel</b>: "
  },
  "completion": {
    "completed": "Completado ✅ Se visitaron todas las celdas + se satisfacen todas las restricciones"
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
  "level": {
    "tutorial_1": {
      "name": "Lección 1) Básico",
      "desc": "Comienza en cualquier celda y visita cada celda exactamente una vez."
    },
    "tutorial_2": {
      "name": "Lección 2) Giro (cualquiera)",
      "desc": "El ícono de giro obliga a un cambio de dirección en esa celda."
    },
    "tutorial_3": {
      "name": "Lección 3) Recto + H/V",
      "desc": "Las pistas de recto/horizontal/vertical fuerzan un tramo recto en esa celda."
    },
    "tutorial_4": {
      "name": "Lección 4) CW / CCW",
      "desc": "CW(r) significa que el movimiento de anterior a siguiente debe girar en sentido horario, CCW(l) en sentido antihorario."
    },
    "tutorial_5": {
      "name": "Lección 5) Costura cruzada",
      "desc": "En un vértice X se fuerzan ambas diagonales (↘︎↖︎, ↙︎↗︎), así que el movimiento diagonal es necesario."
    },
    "tutorial_6": {
      "name": "Lección 6) Conteo de esquina (0-3)",
      "desc": "El número indica cuántas conexiones de ruta existen entre las cuatro celdas de una esquina (0~3)."
    },
    "tutorial_7": {
      "name": "Lección 7) Orden de Tijera/Piedra/Papel",
      "desc": "El orden de visita de las celdas RPS debe seguir Tijera→Piedra→Papel→Tijera… en secuencia."
    },
    "tutorial_8": {
      "name": "Lección 8) Paredes móviles",
      "desc": "Arrastra la pared móvil a una celda vacía. (No se puede colocar en celdas de pistas/RPS)"
    },
    "pilot_1": {
      "name": "Práctica 1) Básico",
      "desc": "Un diseño básico con pistas mixtas."
    },
    "pilot_2": {
      "name": "Práctica 2) Bloqueos por eje",
      "desc": "Los espacios se bloquean por pistas horizontales/verticales de trazo recto."
    },
    "pilot_3": {
      "name": "Práctica 3) CW/CCW + Paredes",
      "desc": "Giros direccionales combinados con paredes."
    },
    "pilot_4": {
      "name": "Práctica 4) Costura cruzada",
      "desc": "Una única restricción de costura."
    },
    "pilot_5": {
      "name": "Práctica 5) Múltiples costuras + CW/CCW",
      "desc": "Múltiples costuras con giros direccionales."
    },
    "pilot_6": {
      "name": "Práctica 6) Costura en campo roto",
      "desc": "Las paredes fuerzan decisiones de bifurcación mediante costuras."
    },
    "pilot_7": {
      "name": "Práctica 7) Estrés",
      "desc": "Mezcla de costuras, paredes y pistas de dirección."
    },
    "pilot_8": {
      "name": "Práctica 8) RPS extendido",
      "desc": "Diseña un camino para pasar por Tijera/Piedra/Papel en orden."
    },
    "pilot_9": {
      "name": "Práctica 9) RPS + Costura",
      "desc": "Orden de RPS y restricciones de costura (diagonal obligatoria) combinadas."
    },
    "pilot_10": {
      "name": "Práctica 10) Dos paredes móviles",
      "desc": "Dos paredes móviles. Reacomódalas antes de resolver."
    },
    "pilot_11": {
      "name": "Práctica 11) Tejido de esquinas",
      "desc": "Una mezcla de conteo de esquinas, pistas de dirección y puntadas."
    },
    "pilot_12": {
      "name": "Práctica 12) Tejido trinitario",
      "desc": "Un rompecabezas donde las restricciones de Piedra-Papel-Tijeras se cruzan con las puntadas."
    }
  }
}
;
