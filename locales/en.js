export default {
  "ui": {
    "levelLabel": "Level",
    "levelSelectAria": "Select level",
    "language": "Language",
    "theme": "Theme",
    "themeDark": "Dark mode",
    "themeLight": "Light mode",
    "themeSwitchTitle": "Change theme",
    "themeSwitchPrompt": "Switch to {{theme}}?",
    "themeSwitchConfirm": "Apply",
    "cancel": "Cancel",
    "nextLevel": "Next level",
    "startInfinite": "Start infinite",
    "nextInfinite": "Next infinite",
    "prevInfinite": "Previous infinite",
    "infiniteComplete": "Infinite complete",
    "nextDisabledUncleared": "Clear this level first to continue.",
    "nextDisabledInfiniteEnd": "You are at the final infinite level.",
    "prevInfiniteDisabledFirst": "You are at the first infinite level.",
    "infiniteLevelOption": "Infinite #{{n}}",
    "dailyLevelOption": "Daily",
    "scoreInfiniteLabel": "Score (Infinite)",
    "scoreDailyLabel": "Score (Daily)",
    "dailyLevelOptionWithDate": "{{label}} ({{date}})",
    "dailyUnavailable": "Daily (Unavailable)",
    "dailyComplete": "Daily complete",
    "dailyDateLabel": "Date",
    "dailyResetLabel": "Resets in",
    "dailyResetNow": "Now",
    "reset": "Reset",
    "resetTitle": "Reset path",
    "reverse": "Reverse",
    "reverseTitle": "Reverse path direction",
    "guide": "Guide",
    "legend": "Hints / Constraints",
    "show": "Show",
    "hide": "Hide",
    "puzzleGridAria": "Puzzle grid",
    "githubRepoAria": "View Tether on GitHub",
    "githubRepoTitle": "View source on GitHub"
  },
  "goal": {
    "intro": "<b>Goal</b>: Draw a continuous path that visits every non-wall cell <b>exactly once</b>.",
    "thisLevelPrefix": "<br><b>This level</b>: "
  },
  "completion": {
    "completed": "Completed ✅ Every cell visited + all constraints satisfied"
  },
  "legend": {
    "controls": "Controls",
    "turn": "<strong>Turn (t)</strong>: previous-to-next move must change direction",
    "cw": "<strong>CW (r)</strong>: previous→next move must turn clockwise",
    "ccw": "<strong>CCW (l)</strong>: previous→next move must turn counter-clockwise",
    "straight": "<strong>Straight (s)</strong>: straight moves only",
    "horizontal": "<strong>Horizontal (h)</strong>: horizontal straight moves",
    "vertical": "<strong>Vertical (v)</strong>: vertical straight moves",
    "scissors": "<strong>Scissors (g)</strong>: scissors",
    "rock": "<strong>Rock (b)</strong>: rock",
    "paper": "<strong>Paper (p)</strong>: paper",
    "crossStitch": "<strong>Cross stitch (x)</strong>: two diagonal connections enforced",
    "cornerCount": "<strong>Corner count</strong>: forces the number of 0~3 connections around a vertex",
    "movableWall": "<strong>Movable wall (m)</strong>: drag to move"
  },
  "level": {
    "tutorial_1": {
      "name": "Tutorial 1) Basic",
      "desc": "Start on any cell and visit every cell exactly once."
    },
    "tutorial_2": {
      "name": "Tutorial 2) Turn(any)",
      "desc": "The turn icon forces a directional turn on that cell."
    },
    "tutorial_3": {
      "name": "Tutorial 3) Straight + H/V",
      "desc": "Straight/Horizontal/Vertical clues force a straight path at that cell."
    },
    "tutorial_4": {
      "name": "Tutorial 4) CW / CCW",
      "desc": "CW(r) means the move from previous to next must turn clockwise, CCW(l) counter-clockwise."
    },
    "tutorial_5": {
      "name": "Tutorial 5) Cross Stitch",
      "desc": "At an X vertex, both diagonal links (↘︎↖︎, ↙︎↗︎) are enforced, so diagonal movement is required."
    },
    "tutorial_6": {
      "name": "Tutorial 6) Corner Count (0-3)",
      "desc": "The number tells how many path links exist among the four cells around a corner (0~3)."
    },
    "tutorial_7": {
      "name": "Tutorial 7) Scissors / Rock / Paper order",
      "desc": "The visit order for RPS tiles must follow Scissors→Rock→Paper→Scissors… in sequence."
    },
    "tutorial_8": {
      "name": "Tutorial 8) Movable Walls",
      "desc": "Drag the movable wall to an empty cell. (Cannot place on hint/RPS tiles)"
    },
    "pilot_1": {
      "name": "Practice 1) Basic",
      "desc": "A basic layout with mixed hints."
    },
    "pilot_2": {
      "name": "Practice 2) Axis Locks",
      "desc": "Spaces are locked by horizontal/vertical straight clues."
    },
    "pilot_3": {
      "name": "Practice 3) CW/CCW + Walls",
      "desc": "Directional turns combined with walls."
    },
    "pilot_4": {
      "name": "Practice 4) Cross Stitch",
      "desc": "One stitch constraint."
    },
    "pilot_5": {
      "name": "Practice 5) Multi Stitch + CW/CCW",
      "desc": "Multiple stitches with directional turns."
    },
    "pilot_6": {
      "name": "Practice 6) Stitch in a Broken Field",
      "desc": "Walls force branch decisions via stitches."
    },
    "pilot_7": {
      "name": "Practice 7) Stress",
      "desc": "A mix of stitches, walls, and directional clues."
    },
    "pilot_8": {
      "name": "Practice 8) RPS Spread",
      "desc": "Design a path to pass through Scissors/Rock/Paper in order."
    },
    "pilot_9": {
      "name": "Practice 9) RPS + Stitch",
      "desc": "Combined RPS ordering and stitch (forced diagonal) constraints."
    },
    "pilot_10": {
      "name": "Practice 10) Movable Walls x2",
      "desc": "Two movable walls. Rearrange them before solving."
    },
    "pilot_11": {
      "name": "Practice 11) Corner Weave",
      "desc": "A mix of corner counts, directional hints, and stitches."
    },
    "pilot_12": {
      "name": "Practice 12) Trinity Weave",
      "desc": "A puzzle where Rock-Paper-Scissors constraints cross stitches."
    }
  }
}
  ;
