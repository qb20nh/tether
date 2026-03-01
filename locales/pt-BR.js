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
    "startInfinite": "Iniciar modo infinito",
    "nextInfinite": "Próximo nível infinito",
    "prevInfinite": "Nível infinito anterior",
    "infiniteComplete": "Modo infinito concluído",
    "nextDisabledUncleared": "Conclua este nível primeiro para continuar.",
    "nextDisabledInfiniteEnd": "Você está no último nível infinito.",
    "prevInfiniteDisabledFirst": "Você está no Infinito #1.",
    "infiniteLevelOption": "Infinito #{{n}}",
    "dailyLevelOption": "Diário",
    "dailyLevelOptionWithDate": "{{label}} ({{date}})",
    "dailyUnavailable": "Diário (Indisponível)",
    "dailyComplete": "Diário concluído",
    "dailyDateLabel": "Data",
    "dailyResetLabel": "Reinicia em",
    "dailyResetNow": "Agora",
    "reset": "Reiniciar",
    "resetTitle": "Reiniciar caminho",
    "reverse": "Inverter",
    "reverseTitle": "Inverter direção do caminho",
    "guide": "Guia",
    "legend": "Dicas / Restrições",
    "show": "Mostrar",
    "hide": "Esconder",
    "puzzleGridAria": "Grade do quebra-cabeça",
    "githubRepoAria": "Ver Tether no GitHub",
    "githubRepoTitle": "Ver código-fonte no GitHub"
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
      "name": "Lição 1) Básico",
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
      "name": "Prática 1) Básico",
      "desc": "Um layout básico com pistas mistas."
    },
    "pilot_2": {
      "name": "Prática 2) Travamentos de eixo",
      "desc": "Os espaços são travados por pistas horizontais/verticais retas."
    },
    "pilot_3": {
      "name": "Prática 3) CW/CCW + Paredes",
      "desc": "Viradas direcionais combinadas com paredes."
    },
    "pilot_4": {
      "name": "Prática 4) Costura cruzada",
      "desc": "Uma única restrição de costura."
    },
    "pilot_5": {
      "name": "Prática 5) Múltiplas costuras + CW/CCW",
      "desc": "Múltiplas costuras com viradas direcionais."
    },
    "pilot_6": {
      "name": "Prática 6) Costura em campo quebrado",
      "desc": "As paredes forçam decisões de ramificação por costuras."
    },
    "pilot_7": {
      "name": "Prática 7) Estresse",
      "desc": "Uma mistura de costuras, paredes e pistas de direção."
    },
    "pilot_8": {
      "name": "Prática 8) Dispersão RPS",
      "desc": "Desenhe um caminho para passar por Tesoura/Pedra/Papel nesta ordem."
    },
    "pilot_9": {
      "name": "Prática 9) RPS + Costura",
      "desc": "Ordem de RPS e restrições de costura (diagonal obrigatória) combinadas."
    },
    "pilot_10": {
      "name": "Prática 10) Duas paredes móveis",
      "desc": "Duas paredes móveis. Rearranje antes de resolver."
    },
    "pilot_11": {
      "name": "Prática 11) Tecido de cantos",
      "desc": "Uma mistura de contagem de cantos, dicas direcionais e costuras."
    },
    "pilot_12": {
      "name": "Prática 12) Tecido trinitário",
      "desc": "Um quebra-cabeça em que as restrições de Pedra, Papel e Tesoura cruzam as costuras."
    }
  }
}
;
