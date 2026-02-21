export default {
  "ui": {
    "levelLabel": "레벨",
    "levelSelectAria": "레벨 선택",
    "language": "언어",
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
    "completed": "완료 ✅ 모든 칸 방문 + 모든 제약 만족",
    "allVisitedOk": "모든 칸 방문: OK",
    "cellsLeft": "{{count}}칸 남음",
    "hintsOk": "힌트: OK",
    "hintsConflict": "힌트: 충돌 {{count}}개",
    "stitchesOk": "스티치: OK",
    "stitchesConflict": "스티치: 충돌 {{count}}개",
    "rpsOk": "RPS: OK",
    "rpsConflict": "RPS: 충돌 {{count}}개"
  },
  "legend": {
    "controls": "조작",
    "turn": "<strong>Turn (t)</strong>: 이전·다음 이동 방향이 달라야 함",
    "cw": "<strong>CW (r)</strong>: 이전→다음이 시계 방향 회전",
    "ccw": "<strong>CCW (l)</strong>: 이전→다음이 반시계 방향 회전",
    "straight": "<strong>Straight (s)</strong>: 직진만 허용",
    "horizontal": "<strong>Horizontal (h)</strong>: 가로로 직진",
    "vertical": "<strong>Vertical (v)</strong>: 세로로 직진",
    "scissors": "<strong>Scissors (g)</strong>: 가위",
    "rock": "<strong>Rock (b)</strong>: 바위",
    "paper": "<strong>Paper (p)</strong>: 보",
    "crossStitch": "<strong>Cross stitch (x)</strong>: 십자수",
    "cornerCount": "<strong>Corner count</strong>: 꼭짓점 주변 4칸 사이 연결 수(0~3)를 강제",
    "movableWall": "<strong>Movable wall (m)</strong>: 드래그로 이동"
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
      "name": "튜토리얼 1) 기본 (3x3)",
      "desc": "아무 칸에서 시작해 모든 칸을 정확히 1번씩 방문하세요."
    },
    "tutorial_2": {
      "name": "튜토리얼 2) Turn(any)",
      "desc": "이 아이콘(꺾임)은 해당 칸에서 반드시 방향을 꺾어야 합니다."
    },
    "tutorial_3": {
      "name": "튜토리얼 3) Straight + H/V",
      "desc": "직진/가로/세로 힌트는 해당 칸에서 \"직진\" 형태를 강제합니다."
    },
    "tutorial_4": {
      "name": "튜토리얼 4) CW / CCW",
      "desc": "CW(r)는 이전→다음 이동이 시계 방향 회전이어야 하고, CCW(l)는 반시계 방향 회전이어야 합니다."
    },
    "tutorial_5": {
      "name": "튜토리얼 5) Cross Stitch",
      "desc": "X 꼭짓점에서는 두 대각선 연결(↘︎↖︎, ↙︎↗︎)이 모두 강제됩니다. 따라서 대각선 이동이 필요합니다."
    },
    "tutorial_6": {
      "name": "튜토리얼 6) Corner Count (0-3)",
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
      "name": "파일럿 1) Basic (4x4)",
      "desc": "힌트 섞인 기본형."
    },
    "pilot_2": {
      "name": "파일럿 2) Axis Locks (5x5)",
      "desc": "가로/세로 직진 힌트로 공간을 잠그는 유형."
    },
    "pilot_3": {
      "name": "파일럿 3) CW/CCW + Walls (5x5)",
      "desc": "방향성 꺾임 + 벽 조합."
    },
    "pilot_4": {
      "name": "파일럿 4) Cross Stitch (5x5)",
      "desc": "스티치 1개."
    },
    "pilot_5": {
      "name": "파일럿 5) Multi Stitch + CW/CCW (6x6)",
      "desc": "스티치 다중 + 방향성 꺾임."
    },
    "pilot_6": {
      "name": "파일럿 6) Stitch in a Broken Field (6x6)",
      "desc": "벽이 많을 때 스티치가 만드는 강제 분기."
    },
    "pilot_7": {
      "name": "파일럿 7) Stress (7x7)",
      "desc": "스티치 + 벽 + 방향 힌트 혼합."
    },
    "pilot_8": {
      "name": "파일럿 8) RPS Spread (5x5)",
      "desc": "가위/바위/보 타일을 순서대로 \"통과\"하도록 경로를 설계해 보세요."
    },
    "pilot_9": {
      "name": "파일럿 9) RPS + Stitch (5x5)",
      "desc": "RPS 순서 제약 + 스티치(대각선 강제) 결합."
    },
    "pilot_10": {
      "name": "파일럿 10) Movable Walls x2 (6x6)",
      "desc": "이동 가능한 벽 2개. 퍼즐을 풀기 전에 벽을 재배치해 보세요."
    }
  }
}
;
