export default {
  "ui": {
    "levelLabel": "レベル",
    "levelSelectAria": "レベルを選択",
    "language": "言語",
    "theme": "テーマ",
    "themeDark": "ダークモード",
    "themeLight": "ライトモード",
    "themeSwitchTitle": "テーマを変更",
    "themeSwitchPrompt": "{{theme}} に切り替えますか？",
    "themeSwitchConfirm": "適用",
    "cancel": "キャンセル",
    "nextLevel": "次のステージ",
    "startInfinite": "無限モード開始",
    "nextInfinite": "次の無限ステージ",
    "prevInfinite": "前の無限ステージ",
    "infiniteLevelOption": "無限 #{{n}}",
    "reset": "リセット",
    "resetTitle": "パスをリセット",
    "reverse": "反転",
    "reverseTitle": "経路方向を反転",
    "guide": "ガイド",
    "legend": "ヒント / 制約",
    "show": "表示",
    "hide": "非表示",
    "puzzleGridAria": "パズルグリッド"
  },
  "goal": {
    "intro": "<b>ゴール</b>：壁でないすべてのマスを<b>ちょうど1回ずつ</b>訪問する連続した線を描いてください。",
    "thisLevelPrefix": "<br><b>このステージ</b>: "
  },
  "completion": {
    "completed": "クリア ✅ すべてのマスを訪問し、制約を満たしました"
  },
  "legend": {
    "controls": "操作",
    "turn": "<strong>ターン (t)</strong>: 前後の移動方向を変える必要があります",
    "cw": "<strong>CW (r)</strong>: 前→次の移動は時計回り",
    "ccw": "<strong>CCW (l)</strong>: 前→次の移動は反時計回り",
    "straight": "<strong>ストレート (s)</strong>: 直進のみ",
    "horizontal": "<strong>水平 (h)</strong>: 横方向に直進",
    "vertical": "<strong>垂直 (v)</strong>: 縦方向に直進",
    "scissors": "<strong>グー・チョキ・パー:チョキ (g)</strong>: チョキ",
    "rock": "<strong>グー・チョキ・パー:グー (b)</strong>: グー",
    "paper": "<strong>グー・チョキ・パー:パー (p)</strong>: パー",
    "crossStitch": "<strong>クロスステッチ (x)</strong>: 2本の対角接続を強制",
    "cornerCount": "<strong>コーナーカウント</strong>: 頂点周りの0~3の接続数を強制",
    "movableWall": "<strong>可動壁 (m)</strong>: ドラッグして移動"
  },
  "level": {
    "tutorial_1": {
      "name": "チュートリアル1) 基本 (3x3)",
      "desc": "任意のマスから開始し、すべてのマスを1回ずつ訪問します。"
    },
    "tutorial_2": {
      "name": "チュートリアル2) ターン(任意)",
      "desc": "ターンアイコンはそのマスで方向転換を要求します。"
    },
    "tutorial_3": {
      "name": "チュートリアル3) ストレート + H/V",
      "desc": "ストレート/水平/垂直ヒントはそのマスで直進を強制します。"
    },
    "tutorial_4": {
      "name": "チュートリアル4) CW / CCW",
      "desc": "CW(r) は前の移動から次の移動へは時計回り、CCW(l) は反時計回りで進む必要があります。"
    },
    "tutorial_5": {
      "name": "チュートリアル5) クロスステッチ",
      "desc": "X 頂点では、2本の対角接続(↘︎↖︎, ↙︎↗︎)が同時に強制されるため、対角移動が必要です。"
    },
    "tutorial_6": {
      "name": "チュートリアル6) コーナーカウント (0-3)",
      "desc": "数字は、ある頂点周辺4マスの間の経路接続数（0〜3）を表します。"
    },
    "tutorial_7": {
      "name": "チュートリアル7) チョキ/グー/パー順",
      "desc": "RPSマスの訪問順は、チョキ→グー→パー→チョキ… の順でなければなりません。"
    },
    "tutorial_8": {
      "name": "チュートリアル8) 可動壁",
      "desc": "可動壁を空いているマスへドラッグします（ヒント/RPSマスには置けません）。"
    },
    "pilot_1": {
      "name": "パイロット1) 基本 (4x4)",
      "desc": "ヒントが混ざった基本レイアウト。"
    },
    "pilot_2": {
      "name": "パイロット2) 軸固定 (5x5)",
      "desc": "水平/垂直ストレートヒントで空間が固定されます。"
    },
    "pilot_3": {
      "name": "パイロット3) CW/CCW + 壁 (5x5)",
      "desc": "方向転換ルールと壁の組み合わせ。"
    },
    "pilot_4": {
      "name": "パイロット4) クロスステッチ (5x5)",
      "desc": "1つのステッチ制約。"
    },
    "pilot_5": {
      "name": "パイロット5) 複数ステッチ + CW/CCW (6x6)",
      "desc": "複数のステッチと方向転換ルール。"
    },
    "pilot_6": {
      "name": "パイロット6) 破断エリアのステッチ (6x6)",
      "desc": "壁がステッチによって分岐判断を生みます。"
    },
    "pilot_7": {
      "name": "パイロット7) ストレス (7x7)",
      "desc": "ステッチ、壁、方向ヒントの混合。"
    },
    "pilot_8": {
      "name": "パイロット8) RPSスプレッド (5x5)",
      "desc": "チョキ/グー/パーを順番通り通過する経路を設計します。"
    },
    "pilot_9": {
      "name": "パイロット9) RPS + ステッチ (5x5)",
      "desc": "RPS順序と（対角強制）ステッチ制約の組み合わせ。"
    },
    "pilot_10": {
      "name": "パイロット10) 可動壁2つ (6x6)",
      "desc": "可動壁2つ。解く前に並べ替えてください。"
    },
    "pilot_11": {
      "name": "パイロット11) コーナー編み (6x6)",
      "desc": "角数、方向ヒント、ステッチ制約の組み合わせ。条件を満たす解は1つ以上存在します。"
    },
    "pilot_12": {
      "name": "パイロット12) トリニティ編み (7x7)",
      "desc": "RPS（グー・チョキ・パー）制約とステッチが交差する最難関のパズルです。"
    }
  }
}
;
