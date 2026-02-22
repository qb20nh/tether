export default {
  "ui": {
    "levelLabel": "關卡",
    "levelSelectAria": "選擇關卡",
    "language": "語言",
    "reset": "重置",
    "resetTitle": "重置路徑",
    "reverse": "反轉",
    "reverseTitle": "反轉路徑方向",
    "guide": "指南",
    "legend": "提示 / 約束",
    "show": "顯示",
    "hide": "隱藏",
    "puzzleGridAria": "謎題網格"
  },
  "goal": {
    "intro": "<b>目標</b>：繪製一條連續路徑，經過每個非牆格子<b>恰好一次</b>。",
    "thisLevelPrefix": "<br><b>此關卡</b>："
  },
  "completion": {
    "completed": "完成 ✅ 所有格子皆已走過，約束條件全部滿足",
    "allVisitedOk": "全部格子走訪：OK",
    "cellsLeft": "尚餘 {{count}} 個格子",
    "hintsOk": "提示：OK",
    "hintsConflict": "提示：{{count}} 個衝突",
    "stitchesOk": "十字鉤：OK",
    "stitchesConflict": "十字鉤：{{count}} 個衝突",
    "rpsOk": "猜拳：OK",
    "rpsConflict": "猜拳：{{count}} 個衝突"
  },
  "legend": {
    "controls": "操作",
    "turn": "<strong>轉彎 (t)</strong>：前一步到下一步的移動方向必須改變",
    "cw": "<strong>順時針 (r)</strong>：前→後移動必須順時針轉向",
    "ccw": "<strong>逆時針 (l)</strong>：前→後移動必須逆時針轉向",
    "straight": "<strong>直行 (s)</strong>：只能直行",
    "horizontal": "<strong>水平 (h)</strong>：只能水平移動",
    "vertical": "<strong>垂直 (v)</strong>：只能垂直移動",
    "scissors": "<strong>剪刀 (g)</strong>：剪刀",
    "rock": "<strong>石頭 (b)</strong>：石頭",
    "paper": "<strong>布 (p)</strong>：布",
    "crossStitch": "<strong>十字鉤 (x)</strong>：強制兩條對角線連結",
    "cornerCount": "<strong>拐角計數</strong>：限制某頂點周圍 4 格之間的連線數（0~3）",
    "movableWall": "<strong>可移動牆 (m)</strong>：可拖動移動"
  },
  "level": {
    "tutorial_1": {
      "name": "教學1）基礎 (3x3)",
      "desc": "從任意格子開始，造訪每個格子恰好一次。"
    },
    "tutorial_2": {
      "name": "教學2）轉彎(any)",
      "desc": "轉彎圖示要求該格必須改變方向。"
    },
    "tutorial_3": {
      "name": "教學3）直行 + 橫/直",
      "desc": "直行/水平/垂直線索會在該格強制直行。"
    },
    "tutorial_4": {
      "name": "教學4）順時針 / 逆時針",
      "desc": "CW(r) 代表從前一步到下一步順時針轉向，CCW(l) 則逆時針轉向。"
    },
    "tutorial_5": {
      "name": "教學5）十字鉤",
      "desc": "在 X 頂點，兩條對角連結(↘︎↖︎, ↙︎↗︎)都被強制，所以必須使用對角線移動。"
    },
    "tutorial_6": {
      "name": "教學6）拐角計數 (0-3)",
      "desc": "數字表示某拐角周圍四格之間存在的路徑連線數（0~3）。"
    },
    "tutorial_7": {
      "name": "教學7）剪刀 / 石頭 / 布順序",
      "desc": "RPS 格子的造訪順序必須按 剪刀→石頭→布→剪刀… 的順序。"
    },
    "tutorial_8": {
      "name": "教學8）可移動牆",
      "desc": "將可移動牆拖到空格上。 (不能放在提示或 RPS 格上)"
    },
    "pilot_1": {
      "name": "試煉1）基礎 (4x4)",
      "desc": "含混合提示的基礎版面。"
    },
    "pilot_2": {
      "name": "試煉2）軸向鎖定 (5x5)",
      "desc": "水平／垂直直行提示會鎖定空間。"
    },
    "pilot_3": {
      "name": "試煉3）順逆時針 + 牆 (5x5)",
      "desc": "方向轉彎配合牆。"
    },
    "pilot_4": {
      "name": "試煉4）十字鉤 (5x5)",
      "desc": "單一十字鉤約束。"
    },
    "pilot_5": {
      "name": "試煉5）多重十字鉤 + 順逆時針 (6x6)",
      "desc": "多個十字鉤與方向轉彎組合。"
    },
    "pilot_6": {
      "name": "試煉6）斷裂區域中的十字鉤 (6x6)",
      "desc": "牆與十字鉤一起製造分岔選擇。"
    },
    "pilot_7": {
      "name": "試煉7）壓力 (7x7)",
      "desc": "十字鉤、牆和方向提示混合。"
    },
    "pilot_8": {
      "name": "試煉8）RPS 擴散 (5x5)",
      "desc": "設計一條路徑，按順序通過剪刀/石頭/布。"
    },
    "pilot_9": {
      "name": "試煉9）RPS + 十字鉤 (5x5)",
      "desc": "RPS 順序與十字鉤（對角線強制）約束組合。"
    },
    "pilot_10": {
      "name": "試煉10）雙可移動牆 (6x6)",
      "desc": "兩個可移動牆。解題前先重新擺放。"
    }
  }
}
;
