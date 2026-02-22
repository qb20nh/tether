export const LEVELS = [
  {
    "name": "튜토리얼 1) 기본 (3x3)",
    "nameKey": "level.tutorial_1.name",
    "desc": "아무 칸에서 시작해 모든 칸을 정확히 1번씩 방문하세요.",
    "descKey": "level.tutorial_1.desc",
    "grid": [
      "...",
      "...",
      "..."
    ],
    "stitches": [],
    "difficulty": {
      "version": 1,
      "profile": "lite96",
      "score": 0,
      "label": "Trivial",
      "components": {
        "backtracking": 0,
        "retries": 0,
        "volatility": 0
      },
      "metrics": {
        "trials": 96,
        "solvedTrials": 96,
        "successRate": 1,
        "meanBacktracksSolved": 36.84375,
        "p90BacktracksSolved": 128,
        "expectedRetries": 0,
        "baselineMeanBacktracks": 40.072917,
        "baselineCvBacktracks": 1.478481,
        "unsatProofStatus": "not_run",
        "cvBacktracksSolved": 1.308168,
        "uniqueWallPlacementsSampled": 1,
        "meanNodeExpansions": 46.385417,
        "meanDeadEnds": 13.0625,
        "p90MaxDepth": 9,
        "nodeCapHits": 0
      }
    }
  },
  {
    "name": "튜토리얼 2) Turn(any)",
    "nameKey": "level.tutorial_2.name",
    "desc": "이 아이콘(꺾임)은 해당 칸에서 반드시 방향을 꺾어야 합니다.",
    "descKey": "level.tutorial_2.desc",
    "grid": [
      ".t..",
      "....",
      "..t.",
      "...."
    ],
    "stitches": [],
    "difficulty": {
      "version": 1,
      "profile": "lite96",
      "score": 11,
      "label": "Trivial",
      "components": {
        "backtracking": 8.422557,
        "retries": 0,
        "volatility": 2.375471
      },
      "metrics": {
        "trials": 96,
        "solvedTrials": 96,
        "successRate": 1,
        "meanBacktracksSolved": 97.489583,
        "p90BacktracksSolved": 294,
        "expectedRetries": 0,
        "baselineMeanBacktracks": 50.270833,
        "baselineCvBacktracks": 1.003493,
        "unsatProofStatus": "not_run",
        "cvBacktracksSolved": 1.128518,
        "uniqueWallPlacementsSampled": 1,
        "meanNodeExpansions": 113.489583,
        "meanDeadEnds": 32.78125,
        "p90MaxDepth": 16,
        "nodeCapHits": 0
      }
    }
  },
  {
    "name": "튜토리얼 3) Straight + H/V",
    "nameKey": "level.tutorial_3.name",
    "desc": "직진/가로/세로 힌트는 해당 칸에서 '직진' 형태를 강제합니다.",
    "descKey": "level.tutorial_3.desc",
    "grid": [
      ".h..",
      ".s..",
      "..v.",
      "...."
    ],
    "stitches": [],
    "difficulty": {
      "version": 1,
      "profile": "lite96",
      "score": 30,
      "label": "Easy",
      "components": {
        "backtracking": 29.720604,
        "retries": 0,
        "volatility": 0
      },
      "metrics": {
        "trials": 96,
        "solvedTrials": 96,
        "successRate": 1,
        "meanBacktracksSolved": 520.375,
        "p90BacktracksSolved": 1192,
        "expectedRetries": 0,
        "baselineMeanBacktracks": 50.270833,
        "baselineCvBacktracks": 1.003493,
        "unsatProofStatus": "not_run",
        "cvBacktracksSolved": 0.856473,
        "uniqueWallPlacementsSampled": 1,
        "meanNodeExpansions": 538.510417,
        "meanDeadEnds": 211.760417,
        "p90MaxDepth": 16,
        "nodeCapHits": 0
      }
    }
  },
  {
    "name": "튜토리얼 4) CW / CCW",
    "nameKey": "level.tutorial_4.name",
    "desc": "CW(r)는 이전→다음 이동이 시계 방향 회전이어야 하고, CCW(l)는 반시계 방향 회전이어야 합니다.",
    "descKey": "level.tutorial_4.desc",
    "grid": [
      "....",
      ".r..",
      "..l.",
      "...."
    ],
    "stitches": [],
    "difficulty": {
      "version": 1,
      "profile": "lite96",
      "score": 21,
      "label": "Easy",
      "components": {
        "backtracking": 16.312264,
        "retries": 0,
        "volatility": 4.590527
      },
      "metrics": {
        "trials": 96,
        "solvedTrials": 96,
        "successRate": 1,
        "meanBacktracksSolved": 181.302083,
        "p90BacktracksSolved": 490,
        "expectedRetries": 0,
        "baselineMeanBacktracks": 50.270833,
        "baselineCvBacktracks": 1.003493,
        "unsatProofStatus": "not_run",
        "cvBacktracksSolved": 1.2451,
        "uniqueWallPlacementsSampled": 1,
        "meanNodeExpansions": 197.5625,
        "meanDeadEnds": 68.135417,
        "p90MaxDepth": 16,
        "nodeCapHits": 0
      }
    }
  },
  {
    "name": "튜토리얼 5) Cross Stitch",
    "nameKey": "level.tutorial_5.name",
    "desc": "X 꼭짓점에서는 두 대각선 연결(↘︎↖︎, ↙︎↗︎)이 모두 강제됩니다. 따라서 대각선 이동이 필요합니다.",
    "descKey": "level.tutorial_5.desc",
    "grid": [
      "....",
      "....",
      "....",
      "...."
    ],
    "stitches": [
      [
        2,
        2
      ]
    ],
    "difficulty": {
      "version": 1,
      "profile": "lite96",
      "score": 11,
      "label": "Trivial",
      "components": {
        "backtracking": 4.904264,
        "retries": 0,
        "volatility": 6.113048
      },
      "metrics": {
        "trials": 96,
        "solvedTrials": 96,
        "successRate": 1,
        "meanBacktracksSolved": 73.927083,
        "p90BacktracksSolved": 253,
        "expectedRetries": 0,
        "baselineMeanBacktracks": 50.270833,
        "baselineCvBacktracks": 1.003493,
        "unsatProofStatus": "not_run",
        "cvBacktracksSolved": 1.325233,
        "uniqueWallPlacementsSampled": 1,
        "meanNodeExpansions": 89.927083,
        "meanDeadEnds": 26.90625,
        "p90MaxDepth": 16,
        "nodeCapHits": 0
      }
    }
  },
  {
    "name": "튜토리얼 6) Corner Count (0-3)",
    "nameKey": "level.tutorial_6.name",
    "desc": "숫자는 해당 꼭짓점 주변 4칸 사이에서 경로가 만드는 연결 수(0~3)를 뜻합니다.",
    "descKey": "level.tutorial_6.desc",
    "grid": [
      "....",
      "....",
      "....",
      "...."
    ],
    "stitches": [],
    "cornerCounts": [
      [
        1,
        1,
        2
      ],
      [
        1,
        3,
        1
      ]
    ],
    "difficulty": {
      "version": 1,
      "profile": "lite96",
      "score": 46,
      "label": "Medium",
      "components": {
        "backtracking": 46.002931,
        "retries": 0,
        "volatility": 0
      },
      "metrics": {
        "trials": 96,
        "solvedTrials": 96,
        "successRate": 1,
        "meanBacktracksSolved": 1872.322917,
        "p90BacktracksSolved": 4087,
        "expectedRetries": 0,
        "baselineMeanBacktracks": 50.270833,
        "baselineCvBacktracks": 1.003493,
        "unsatProofStatus": "not_run",
        "cvBacktracksSolved": 0.821175,
        "uniqueWallPlacementsSampled": 1,
        "meanNodeExpansions": 1891.635417,
        "meanDeadEnds": 657.8125,
        "p90MaxDepth": 16,
        "nodeCapHits": 0
      }
    }
  },
  {
    "name": "튜토리얼 7) 가위/바위/보 순서",
    "nameKey": "level.tutorial_7.name",
    "desc": "이 심볼 타일만 따로 봤을 때 방문 순서가 가위→바위→보→가위…(승자 순환)여야 합니다.",
    "descKey": "level.tutorial_7.desc",
    "grid": [
      "g...",
      ".b..",
      "..p.",
      "...."
    ],
    "stitches": [],
    "difficulty": {
      "version": 1,
      "profile": "lite96",
      "score": 3,
      "label": "Trivial",
      "components": {
        "backtracking": 0.25823,
        "retries": 0,
        "volatility": 2.301808
      },
      "metrics": {
        "trials": 96,
        "solvedTrials": 96,
        "successRate": 1,
        "meanBacktracksSolved": 51.302083,
        "p90BacktracksSolved": 118,
        "expectedRetries": 0,
        "baselineMeanBacktracks": 50.270833,
        "baselineCvBacktracks": 1.003493,
        "unsatProofStatus": "not_run",
        "cvBacktracksSolved": 1.124641,
        "uniqueWallPlacementsSampled": 1,
        "meanNodeExpansions": 67.302083,
        "meanDeadEnds": 18.375,
        "p90MaxDepth": 16,
        "nodeCapHits": 0
      }
    }
  },
  {
    "name": "튜토리얼 8) 움직이는 벽",
    "nameKey": "level.tutorial_8.name",
    "desc": "벽(이동 가능)을 드래그해서 빈 칸으로 옮기세요. (힌트/가위바위보 타일 위에는 놓을 수 없음)",
    "descKey": "level.tutorial_8.desc",
    "grid": [
      ".....",
      ".....",
      ".mh..",
      ".....",
      "....."
    ],
    "stitches": [],
    "difficulty": {
      "version": 1,
      "profile": "lite96",
      "score": 17,
      "label": "Trivial",
      "components": {
        "backtracking": 8.468595,
        "retries": 9.0309,
        "volatility": 0
      },
      "metrics": {
        "trials": 96,
        "solvedTrials": 48,
        "successRate": 0.5,
        "meanBacktracksSolved": 886.604167,
        "p90BacktracksSolved": 2129,
        "expectedRetries": 1,
        "baselineMeanBacktracks": 455.528302,
        "baselineCvBacktracks": 2.043731,
        "unsatProofStatus": "not_run",
        "cvBacktracksSolved": 1.11561,
        "uniqueWallPlacementsSampled": 23,
        "meanNodeExpansions": 9455.302083,
        "meanDeadEnds": 3877.822917,
        "p90MaxDepth": 24,
        "nodeCapHits": 48
      }
    }
  },
  {
    "name": "파일럿 1) Basic (4x4)",
    "nameKey": "level.pilot_1.name",
    "desc": "힌트 섞인 기본형.",
    "descKey": "level.pilot_1.desc",
    "grid": [
      ".ts.",
      "s..t",
      "....",
      "...."
    ],
    "stitches": [],
    "difficulty": {
      "version": 1,
      "profile": "lite96",
      "score": 29,
      "label": "Easy",
      "components": {
        "backtracking": 28.652368,
        "retries": 0,
        "volatility": 0
      },
      "metrics": {
        "trials": 96,
        "solvedTrials": 96,
        "successRate": 1,
        "meanBacktracksSolved": 478.447917,
        "p90BacktracksSolved": 1000,
        "expectedRetries": 0,
        "baselineMeanBacktracks": 50.270833,
        "baselineCvBacktracks": 1.003493,
        "unsatProofStatus": "not_run",
        "cvBacktracksSolved": 0.89277,
        "uniqueWallPlacementsSampled": 1,
        "meanNodeExpansions": 495.135417,
        "meanDeadEnds": 173.197917,
        "p90MaxDepth": 16,
        "nodeCapHits": 0
      }
    }
  },
  {
    "name": "파일럿 2) Axis Locks (5x5)",
    "nameKey": "level.pilot_2.name",
    "desc": "가로/세로 직진 힌트로 공간을 잠그는 유형.",
    "descKey": "level.pilot_2.desc",
    "grid": [
      "...t.",
      "....v",
      ".v...",
      ".v.tt",
      "...h."
    ],
    "stitches": [],
    "difficulty": {
      "version": 1,
      "profile": "lite96",
      "score": 21,
      "label": "Easy",
      "components": {
        "backtracking": 20.87494,
        "retries": 0,
        "volatility": 0
      },
      "metrics": {
        "trials": 96,
        "solvedTrials": 96,
        "successRate": 1,
        "meanBacktracksSolved": 2351.927083,
        "p90BacktracksSolved": 5467,
        "expectedRetries": 0,
        "baselineMeanBacktracks": 455.528302,
        "baselineCvBacktracks": 2.043731,
        "unsatProofStatus": "not_run",
        "cvBacktracksSolved": 0.854138,
        "uniqueWallPlacementsSampled": 1,
        "meanNodeExpansions": 2377.895833,
        "meanDeadEnds": 956.65625,
        "p90MaxDepth": 25,
        "nodeCapHits": 0
      }
    }
  },
  {
    "name": "파일럿 3) CW/CCW + Walls (5x5)",
    "nameKey": "level.pilot_3.name",
    "desc": "방향성 꺾임 + 벽 조합.",
    "descKey": "level.pilot_3.desc",
    "grid": [
      "..##.",
      "..l#.",
      "...l.",
      ".lr..",
      "...r."
    ],
    "stitches": [],
    "difficulty": {
      "version": 1,
      "profile": "lite96",
      "score": 18,
      "label": "Trivial",
      "components": {
        "backtracking": 17.971638,
        "retries": 0,
        "volatility": 0
      },
      "metrics": {
        "trials": 96,
        "solvedTrials": 96,
        "successRate": 1,
        "meanBacktracksSolved": 1871.854167,
        "p90BacktracksSolved": 3089,
        "expectedRetries": 0,
        "baselineMeanBacktracks": 455.528302,
        "baselineCvBacktracks": 2.043731,
        "unsatProofStatus": "not_run",
        "cvBacktracksSolved": 0.561167,
        "uniqueWallPlacementsSampled": 1,
        "meanNodeExpansions": 1902.770833,
        "meanDeadEnds": 842.46875,
        "p90MaxDepth": 22,
        "nodeCapHits": 0
      }
    }
  },
  {
    "name": "파일럿 4) Cross Stitch (5x5)",
    "nameKey": "level.pilot_4.name",
    "desc": "스티치 1개.",
    "descKey": "level.pilot_4.desc",
    "grid": [
      ".tt..",
      "..t..",
      "....t",
      ".v...",
      ".t..."
    ],
    "stitches": [
      [
        2,
        2
      ]
    ],
    "difficulty": {
      "version": 1,
      "profile": "lite96",
      "score": 28,
      "label": "Easy",
      "components": {
        "backtracking": 27.764192,
        "retries": 0,
        "volatility": 0
      },
      "metrics": {
        "trials": 96,
        "solvedTrials": 96,
        "successRate": 1,
        "meanBacktracksSolved": 4042.979167,
        "p90BacktracksSolved": 10784,
        "expectedRetries": 0,
        "baselineMeanBacktracks": 455.528302,
        "baselineCvBacktracks": 2.043731,
        "unsatProofStatus": "not_run",
        "cvBacktracksSolved": 1.000388,
        "uniqueWallPlacementsSampled": 1,
        "meanNodeExpansions": 4069.1875,
        "meanDeadEnds": 1516.291667,
        "p90MaxDepth": 25,
        "nodeCapHits": 0
      }
    }
  },
  {
    "name": "파일럿 5) Multi Stitch + CW/CCW (6x6)",
    "nameKey": "level.pilot_5.name",
    "desc": "스티치 다중 + 방향성 꺾임.",
    "descKey": "level.pilot_5.desc",
    "grid": [
      ".....r",
      "..l...",
      ".r....",
      "......",
      ".s.tv.",
      "..r..."
    ],
    "stitches": [
      [
        2,
        2
      ],
      [
        2,
        4
      ],
      [
        4,
        3
      ]
    ],
    "difficulty": {
      "version": 1,
      "profile": "lite96",
      "score": 16,
      "label": "Trivial",
      "components": {
        "backtracking": 13.32318,
        "retries": 2.705299,
        "volatility": 0
      },
      "metrics": {
        "trials": 96,
        "solvedTrials": 78,
        "successRate": 0.8125,
        "meanBacktracksSolved": 7970.935897,
        "p90BacktracksSolved": 15804,
        "expectedRetries": 0.230769,
        "baselineMeanBacktracks": 2795.786667,
        "baselineCvBacktracks": 1.415957,
        "unsatProofStatus": "not_run",
        "cvBacktracksSolved": 0.690894,
        "uniqueWallPlacementsSampled": 1,
        "meanNodeExpansions": 9880.635417,
        "meanDeadEnds": 4376.34375,
        "p90MaxDepth": 36,
        "nodeCapHits": 18
      }
    }
  },
  {
    "name": "파일럿 6) Stitch in a Broken Field (6x6)",
    "nameKey": "level.pilot_6.name",
    "desc": "벽이 많을 때 스티치가 만드는 강제 분기.",
    "descKey": "level.pilot_6.desc",
    "grid": [
      "......",
      "....t.",
      "#t.t..",
      "##..t.",
      "th.#..",
      ".##..."
    ],
    "stitches": [
      [
        2,
        4
      ]
    ],
    "difficulty": {
      "version": 1,
      "profile": "lite96",
      "score": 16,
      "label": "Trivial",
      "components": {
        "backtracking": 11.888942,
        "retries": 3.930387,
        "volatility": 0
      },
      "metrics": {
        "trials": 96,
        "solvedTrials": 71,
        "successRate": 0.739583,
        "meanBacktracksSolved": 7120.788732,
        "p90BacktracksSolved": 14218,
        "expectedRetries": 0.352113,
        "baselineMeanBacktracks": 2795.786667,
        "baselineCvBacktracks": 1.415957,
        "unsatProofStatus": "not_run",
        "cvBacktracksSolved": 0.686307,
        "uniqueWallPlacementsSampled": 1,
        "meanNodeExpansions": 9979.40625,
        "meanDeadEnds": 4311.677083,
        "p90MaxDepth": 30,
        "nodeCapHits": 25
      }
    }
  },
  {
    "name": "파일럿 7) Stress (7x7)",
    "nameKey": "level.pilot_7.name",
    "desc": "스티치 + 벽 + 방향 힌트 혼합.",
    "descKey": "level.pilot_7.desc",
    "grid": [
      "..#l...",
      ".......",
      ".#v....",
      "v...##.",
      "..#s#..",
      "rr#....",
      "..h..#."
    ],
    "stitches": [
      [
        5,
        1
      ],
      [
        1,
        5
      ]
    ]
  },
  {
    "name": "파일럿 8) RPS Spread (5x5)",
    "nameKey": "level.pilot_8.name",
    "desc": "가위/바위/보 타일을 순서대로 '통과'하도록 경로를 설계해 보세요.",
    "descKey": "level.pilot_8.desc",
    "grid": [
      "g...b",
      ".....",
      "b.p..",
      ".....",
      "p...g"
    ],
    "stitches": []
  },
  {
    "name": "파일럿 9) RPS + Stitch (5x5)",
    "nameKey": "level.pilot_9.name",
    "desc": "RPS 순서 제약 + 스티치(대각선 강제) 결합.",
    "descKey": "level.pilot_9.desc",
    "grid": [
      "g...b",
      ".....",
      "b.p..",
      ".....",
      "p...g"
    ],
    "stitches": [
      [
        2,
        2
      ]
    ]
  },
  {
    "name": "파일럿 10) Movable Walls x2 (6x6)",
    "nameKey": "level.pilot_10.name",
    "desc": "이동 가능한 벽 2개. 퍼즐을 풀기 전에 벽을 재배치해 보세요.",
    "descKey": "level.pilot_10.desc",
    "grid": [
      "......",
      "..m...",
      "..t#..",
      ".h....",
      "...m..",
      "......"
    ],
    "stitches": []
  },
  {
    "name": "파일럿 11) Corner Weave (6x6)",
    "nameKey": "level.pilot_11.name",
    "desc": "Corner count + 방향성 힌트 + 스티치 조합. 제약을 만족하는 순서가 다른 해법이 2개 이상 존재합니다.",
    "descKey": "level.pilot_11.desc",
    "grid": [
      ".....r",
      "..l...",
      ".r....",
      "......",
      ".s.tv.",
      "..r..."
    ],
    "stitches": [
      [
        2,
        2
      ],
      [
        2,
        4
      ],
      [
        4,
        3
      ]
    ],
    "cornerCounts": [
      [
        1,
        2,
        3
      ],
      [
        3,
        2,
        2
      ],
      [
        5,
        4,
        2
      ]
    ]
  },
  {
    "name": "파일럿 12) Trinity Weave (7x7)",
    "nameKey": "level.pilot_12.name",
    "desc": "가위바위보 제약과 스티치가 교차하는 최고 난이도 퍼즐입니다.",
    "descKey": "level.pilot_12.desc",
    "grid": [
      "....##.",
      ".##.##.",
      ".t.....",
      ".....v#",
      "...##p.",
      ".#####g",
      "bh....."
    ],
    "stitches": [
      [3, 3]
    ]
  }
];

export const DEFAULT_LEVEL_INDEX = 0;
