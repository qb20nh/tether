export default {
  "ui": {
    "levelLabel": "Nível",
    "levelSelectAria": "Selecionar nível",
    "language": "Idioma",
    "theme": "Tema",
    "themeDark": "Modo escuro",
    "themeLight": "Modo claro",
    "themeSwitchTitle": "Alterar tema",
    "themeSwitchPrompt": "Mudar para {{theme}}?",
    "themeSwitchConfirm": "Aplicar",
    "cancel": "Cancelar",
    "nextLevel": "Próximo nível",
    "reset": "Reiniciar",
    "resetTitle": "Reiniciar caminho",
    "reverse": "Inverter",
    "reverseTitle": "Inverter direção do caminho",
    "guide": "Guia",
    "legend": "Dicas / Restrições",
    "show": "Mostrar",
    "hide": "Esconder",
    "puzzleGridAria": "Grade do quebra-cabeça"
  },
  "goal": {
    "intro": "<b>Objetivo</b>: Desenhe um caminho contínuo que visite cada célula sem parede <b>exatamente uma vez</b>.",
    "thisLevelPrefix": "<br><b>Este nível</b>: "
  },
  "completion": {
    "completed": "Concluído ✅ Todas as células visitadas + todas as restrições satisfeitas"
  },
  "legend": {
    "controls": "Controles",
    "turn": "<strong>Virada (t)</strong>: o movimento anterior→próximo deve mudar a direção",
    "cw": "<strong>CW (r)</strong>: o movimento anterior→próximo deve girar no sentido horário",
    "ccw": "<strong>CCW (l)</strong>: o movimento anterior→próximo deve girar no sentido anti-horário",
    "straight": "<strong>Reto (s)</strong>: apenas movimentos retos",
    "horizontal": "<strong>Horizontal (h)</strong>: movimentos retos horizontais",
    "vertical": "<strong>Vertical (v)</strong>: movimentos retos verticais",
    "scissors": "<strong>Tesoura (g)</strong>: tesoura",
    "rock": "<strong>Pedra (b)</strong>: pedra",
    "paper": "<strong>Papel (p)</strong>: papel",
    "crossStitch": "<strong>Costura cruzada (x)</strong>: duas conexões diagonais obrigatórias",
    "cornerCount": "<strong>Contagem de canto</strong>: força o número de conexões 0~3 ao redor de um vértice",
    "movableWall": "<strong>Parede móvel (m)</strong>: arrastar para mover"
  },
  "level": {
    "tutorial_1": {
      "name": "Lição 1) Básico (3x3)",
      "desc": "Comece em qualquer célula e visite cada célula exatamente uma vez."
    },
    "tutorial_2": {
      "name": "Lição 2) Virada (qualquer)",
      "desc": "O ícone de virada exige uma mudança de direção nessa célula."
    },
    "tutorial_3": {
      "name": "Lição 3) Reto + H/V",
      "desc": "As pistas de reto/horizontal/vertical forçam um caminho reto naquela célula."
    },
    "tutorial_4": {
      "name": "Lição 4) CW / CCW",
      "desc": "CW(r) significa que o movimento de anterior para próximo deve girar no sentido horário, CCW(l) no anti-horário."
    },
    "tutorial_5": {
      "name": "Lição 5) Costura cruzada",
      "desc": "No vértice em X, ambas as conexões diagonais (↘︎↖︎, ↙︎↗︎) são obrigatórias, logo o movimento diagonal é necessário."
    },
    "tutorial_6": {
      "name": "Lição 6) Contagem de canto (0-3)",
      "desc": "O número indica quantas conexões existem entre as quatro células ao redor de um canto (0~3)."
    },
    "tutorial_7": {
      "name": "Lição 7) Ordem Pedra/Papel/Tesoura",
      "desc": "A ordem de visita das células RPS deve seguir Tesoura→Pedra→Papel→Tesoura… em sequência."
    },
    "tutorial_8": {
      "name": "Lição 8) Paredes móveis",
      "desc": "Arraste a parede móvel para uma célula vazia. (Não pode ficar em dicas/tiles RPS)"
    },
    "pilot_1": {
      "name": "Piloto 1) Básico (4x4)",
      "desc": "Um layout básico com pistas mistas."
    },
    "pilot_2": {
      "name": "Piloto 2) Travamentos de eixo (5x5)",
      "desc": "Os espaços são travados por pistas horizontais/verticais retas."
    },
    "pilot_3": {
      "name": "Piloto 3) CW/CCW + Paredes (5x5)",
      "desc": "Viradas direcionais combinadas com paredes."
    },
    "pilot_4": {
      "name": "Piloto 4) Costura cruzada (5x5)",
      "desc": "Uma única restrição de costura."
    },
    "pilot_5": {
      "name": "Piloto 5) Múltiplas costuras + CW/CCW (6x6)",
      "desc": "Múltiplas costuras com viradas direcionais."
    },
    "pilot_6": {
      "name": "Piloto 6) Costura em campo quebrado (6x6)",
      "desc": "As paredes forçam decisões de ramificação por costuras."
    },
    "pilot_7": {
      "name": "Piloto 7) Estresse (7x7)",
      "desc": "Uma mistura de costuras, paredes e pistas de direção."
    },
    "pilot_8": {
      "name": "Piloto 8) Dispersão RPS (5x5)",
      "desc": "Desenhe um caminho para passar por Tesoura/Pedra/Papel nesta ordem."
    },
    "pilot_9": {
      "name": "Piloto 9) RPS + Costura (5x5)",
      "desc": "Ordem de RPS e restrições de costura (diagonal obrigatória) combinadas."
    },
    "pilot_10": {
      "name": "Piloto 10) Duas paredes móveis (6x6)",
      "desc": "Duas paredes móveis. Rearranje antes de resolver."
    },
    "pilot_11": {
      "name": "Piloto 11) Tecido de cantos (6x6)",
      "desc": "Uma mistura de contagem de cantos, dicas direcionais e costuras. Mais de uma solução pode satisfazer as restrições."
    },
    "pilot_12": {
      "name": "Piloto 12) Tecido trinitário (7x7)",
      "desc": "O quebra-cabeça mais difícil, onde as restrições de Pedra, Papel e Tesoura cruzam as costuras."
    }
  }
}
;
