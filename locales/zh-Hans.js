export default {
  "ui": {
    "levelLabel": "关卡",
    "levelSelectAria": "选择关卡",
    "language": "语言",
    "reset": "重置",
    "resetTitle": "重置路径",
    "reverse": "反转",
    "reverseTitle": "反转路径方向",
    "guide": "指南",
    "legend": "提示 / 约束",
    "show": "显示",
    "hide": "隐藏",
    "puzzleGridAria": "谜题网格"
  },
  "goal": {
    "intro": "<b>目标</b>：绘制一条连续路径，经过每个非墙格子<b>恰好一次</b>。",
    "thisLevelPrefix": "<br><b>本关卡</b>："
  },
  "completion": {
    "completed": "完成 ✅ 所有格子都已访问，约束全部满足",
    "allVisitedOk": "全部格子访问：OK",
    "cellsLeft": "还剩 {{count}} 个格子",
    "hintsOk": "提示：OK",
    "hintsConflict": "提示：{{count}} 个冲突",
    "stitchesOk": "交叉约束：OK",
    "stitchesConflict": "交叉约束：{{count}} 个冲突",
    "rpsOk": "剪刀石头布：OK",
    "rpsConflict": "剪刀石头布：{{count}} 个冲突"
  },
  "legend": {
    "controls": "操作",
    "turn": "<strong>转弯 (t)</strong>：前后两步的移动方向必须不同",
    "cw": "<strong>顺时针 (r)</strong>：前→后移动必须顺时针转向",
    "ccw": "<strong>逆时针 (l)</strong>：前→后移动必须逆时针转向",
    "straight": "<strong>直行 (s)</strong>：只能直行",
    "horizontal": "<strong>水平 (h)</strong>：只能水平移动",
    "vertical": "<strong>垂直 (v)</strong>：只能垂直移动",
    "scissors": "<strong>剪刀 (g)</strong>：剪刀",
    "rock": "<strong>石头 (b)</strong>：石头",
    "paper": "<strong>布 (p)</strong>：布",
    "crossStitch": "<strong>十字针 (x)</strong>：强制两条对角线连接",
    "cornerCount": "<strong>拐角计数</strong>：限制某顶点周围 4 格之间的连接数量（0~3）",
    "movableWall": "<strong>可移动墙 (m)</strong>：拖动可移动"
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
      "name": "教程1）基础 (3x3)",
      "desc": "从任意格子开始，访问每个格子恰好一次。"
    },
    "tutorial_2": {
      "name": "教程2）转弯(any)",
      "desc": "转弯图标要求该格必须改变方向。"
    },
    "tutorial_3": {
      "name": "教程3）直行 + 横/纵",
      "desc": "直行/水平/垂直提示会强制该格只能直行。"
    },
    "tutorial_4": {
      "name": "教程4）顺时针 / 逆时针",
      "desc": "CW(r) 表示从前一步到下一步顺时针转向，CCW(l) 表示逆时针转向。"
    },
    "tutorial_5": {
      "name": "教程5）十字针",
      "desc": "在 X 顶点处，两个对角连接(↘︎↖︎, ↙︎↗︎) 都被强制，因此需要对角移动。"
    },
    "tutorial_6": {
      "name": "教程6）角计数 (0-3)",
      "desc": "数字表示某拐点周围4格之间存在的路径连接数量（0~3）。"
    },
    "tutorial_7": {
      "name": "教程7）剪刀/石头/布顺序",
      "desc": "RPS 格子的访问顺序必须按 剪刀→石头→布→剪刀… 的顺序进行。"
    },
    "tutorial_8": {
      "name": "教程8）可移动墙",
      "desc": "将可移动墙拖到空格上。 (不能放在提示或 RPS 格上)"
    },
    "pilot_1": {
      "name": "试炼1）基础 (4x4)",
      "desc": "带有混合提示的基础布局。"
    },
    "pilot_2": {
      "name": "试炼2）坐标锁 (5x5)",
      "desc": "水平/垂直直行提示会锁定路径空间。"
    },
    "pilot_3": {
      "name": "试炼3）顺逆时针 + 墙 (5x5)",
      "desc": "方向转弯与墙组合。"
    },
    "pilot_4": {
      "name": "试炼4）十字针 (5x5)",
      "desc": "单个十字针约束。"
    },
    "pilot_5": {
      "name": "试炼5）多重十字针 + 顺逆时针 (6x6)",
      "desc": "多个十字针与方向转弯组合。"
    },
    "pilot_6": {
      "name": "试炼6）断裂区域中的十字针 (6x6)",
      "desc": "墙和十字针共同形成分支决策。"
    },
    "pilot_7": {
      "name": "试炼7）高压 (7x7)",
      "desc": "十字针、墙和方向提示混合。"
    },
    "pilot_8": {
      "name": "试炼8）RPS 扩散 (5x5)",
      "desc": "设计一条路径按顺序经过剪刀/石头/布。"
    },
    "pilot_9": {
      "name": "试炼9）RPS + 十字针 (5x5)",
      "desc": "RPS顺序与十字针（对角线强制）约束组合。"
    },
    "pilot_10": {
      "name": "试炼10）两个可移动墙 (6x6)",
      "desc": "两个可移动墙。解题前先重新摆放。"
    }
  }
}
;
