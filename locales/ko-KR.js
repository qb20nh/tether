export default {
  "ui": {
    "levelLabel": "레벨",
    "levelSelectAria": "레벨 선택",
    "language": "언어",
    "theme": "테마",
    "themeDark": "다크 모드",
    "themeLight": "라이트 모드",
    "themeSwitchTitle": "테마 변경",
    "themeSwitchPrompt": "{{theme}}로 전환하시겠습니까?",
    "themeSwitchConfirm": "적용",
    "cancel": "취소",
    "nextLevel": "다음 레벨",
    "reset": "초기화",
    "resetTitle": "경로 초기화",
    "reverse": "뒤집기",
    "reverseTitle": "경로 방향 뒤집기",
    "guide": "가이드",
    "legend": "힌트 / 제약",
    "show": "보이기",
    "hide": "숨기기",
    "puzzleGridAria": "퍼즐 그리드"
  },
  "goal": {
    "intro": "<b>목표</b>: 벽이 아닌 모든 칸을 <b>정확히 1번씩</b> 방문하는 연속 경로를 만드세요.",
    "thisLevelPrefix": "<br><b>이 레벨</b>: "
  },
    "completion": {
    "completed": "완료 ✅ 모든 칸 방문 + 모든 제약 만족"
  },
  "legend": {
    "controls": "조작",
    "turn": "<strong>회전 (t)</strong>: 이전 칸에서 다음 칸으로 가는 방향은 달라야 함",
    "cw": "<strong>시계방향 (r)</strong>: 이전→다음이 시계 방향으로 회전",
    "ccw": "<strong>반시계방향 (l)</strong>: 이전→다음이 반시계 방향으로 회전",
    "straight": "<strong>직선 (s)</strong>: 직진만 허용",
    "horizontal": "<strong>가로 (h)</strong>: 가로로 직진",
    "vertical": "<strong>세로 (v)</strong>: 세로로 직진",
    "scissors": "<strong>가위 (g)</strong>: 가위",
    "rock": "<strong>바위 (b)</strong>: 바위",
    "paper": "<strong>보 (p)</strong>: 보",
    "crossStitch": "<strong>십자수 (x)</strong>: 대각선 연결 두 개를 강제",
    "cornerCount": "<strong>코너 카운트</strong>: 꼭짓점 주변 4칸 사이 연결 수(0~3)를 강제",
    "movableWall": "<strong>이동 가능한 벽 (m)</strong>: 드래그로 이동"
  },
  "level": {
    "tutorial_1": {
      "name": "튜토리얼 1) 기본 (3x3)",
      "desc": "아무 칸에서 시작해 모든 칸을 정확히 1번씩 방문하세요."
    },
    "tutorial_2": {
      "name": "튜토리얼 2) 회전(임의)",
      "desc": "이 아이콘(꺾임)은 해당 칸에서 반드시 방향을 꺾어야 합니다."
    },
    "tutorial_3": {
      "name": "튜토리얼 3) 직진 + H/V",
      "desc": "직진/가로/세로 힌트는 해당 칸에서 \"직진\" 형태를 강제합니다."
    },
    "tutorial_4": {
      "name": "튜토리얼 4) CW / CCW",
      "desc": "CW(r)는 이전→다음 이동이 시계 방향 회전이어야 하고, CCW(l)는 반시계 방향 회전이어야 합니다."
    },
    "tutorial_5": {
      "name": "튜토리얼 5) 십자수",
      "desc": "X 꼭짓점에서는 두 대각선 연결(↘︎↖︎, ↙︎↗︎)이 모두 강제됩니다. 따라서 대각선 이동이 필요합니다."
    },
    "tutorial_6": {
      "name": "튜토리얼 6) 코너 카운트 (0-3)",
      "desc": "숫자는 해당 꼭짓점 주변 4칸 사이에서 경로가 만드는 연결 수(0~3)를 뜻합니다."
    },
    "tutorial_7": {
      "name": "튜토리얼 7) 가위/바위/보 순서",
      "desc": "이 심볼 타일만 따로 봤을 때 방문 순서가 가위→바위→보→가위…(승자 순환)여야 합니다."
    },
    "tutorial_8": {
      "name": "튜토리얼 8) 움직이는 벽",
      "desc": "벽(이동 가능)을 드래그해서 빈 칸으로 옮기세요. (힌트/가위바위보 타일 위에는 놓을 수 없음)"
    },
    "pilot_1": {
      "name": "파일럿 1) 기본 (4x4)",
      "desc": "힌트 섞인 기본형."
    },
    "pilot_2": {
      "name": "파일럿 2) 축 고정 (5x5)",
      "desc": "가로/세로 직진 힌트로 공간을 잠그는 유형."
    },
    "pilot_3": {
      "name": "파일럿 3) CW/CCW + 벽 (5x5)",
      "desc": "방향성 꺾임 + 벽 조합."
    },
    "pilot_4": {
      "name": "파일럿 4) 십자수 (5x5)",
      "desc": "십자수 1개."
    },
    "pilot_5": {
      "name": "파일럿 5) 다중 십자수 + CW/CCW (6x6)",
      "desc": "다중 십자수 + 방향성 꺾임."
    },
    "pilot_6": {
      "name": "파일럿 6) 균열 지역의 십자수 (6x6)",
      "desc": "벽이 많을 때 십자수가 만드는 강제 분기."
    },
    "pilot_7": {
      "name": "파일럿 7) 스트레스 (7x7)",
      "desc": "십자수 + 벽 + 방향 힌트 혼합."
    },
    "pilot_8": {
      "name": "파일럿 8) RPS 확산 (5x5)",
      "desc": "가위/바위/보 타일을 순서대로 \"통과\"하도록 경로를 설계해 보세요."
    },
    "pilot_9": {
      "name": "파일럿 9) RPS + 십자수 (5x5)",
      "desc": "RPS 순서 제약 + 십자수(대각선 강제) 결합."
    },
    "pilot_10": {
      "name": "파일럿 10) 이동 가능한 벽 x2 (6x6)",
      "desc": "이동 가능한 벽 2개. 퍼즐을 풀기 전에 벽을 재배치해 보세요."
    },
    "pilot_11": {
      "name": "파일럿 11) 모서리 직조 (6x6)",
      "desc": "코너 카운트 + 방향성 힌트 + 십자수의 조합. 제약을 만족하는 해법이 2개 이상 존재합니다."
    },
    "pilot_12": {
      "name": "파일럿 12) 트리니티 직조 (7x7)",
      "desc": "가위바위보 제약과 십자수가 교차하는 최고 난이도 퍼즐입니다."
    }
  }
}
;
