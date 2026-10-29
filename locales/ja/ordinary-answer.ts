import type { NativeAnswerCopy } from "../../lib/research/native-answer-copy";

/** Machine draft; no human review or language observation is implied. */
export const ordinaryAnswerJapanese = Object.freeze({
  summaryIntro: "モデルが作成した要約です。各文に引用を付け、確認に使った出典の原文と並べて表示します。",
  excerptIntro: "出典の抜粋のみを表示します。草稿は結論として提示せず、統合した回答の完全性は未確認です。調査対象は検討すべきテーマであり、立証済みの結論ではありません。",
  unavailableIntro: "根拠のある回答はありません。統合または根拠の確認が完了していません。元の閲覧結果と受領記録は保持されています。",
  emptyIntro: "根拠のある回答はありません。閲覧した内容には、調査対象について採用条件を満たす抜粋がありませんでした。",
  target: "調査対象",
  topic: "依頼されたテーマ（未確認）",
  source: "出典の原文",
  unavailableGap: "この実行では、この調査対象の根拠を評価できませんでした。",
  gap: "根拠の不足：この調査対象について採用条件を満たす抜粋がありません。",
  partialGap: "根拠の不足：記録された評価は、この調査対象を支持する基準に達していません。",
  reviewNotice: "各文はモデルが作成・確認したもので、独立した検証は行われていません。",
  limitations: "抜粋は出典との対応を示しますが、出典の正確さや統合した回答の完全性を証明しません。出典には誤りや矛盾がある場合があります。支払い状況は別途記録されます。",
  compactNotice: "すべての調査対象と採用済み抜粋を保ったまま、短い箇条書き{count}項目にまとめることはできませんでした。以下に調査対象ごとに示します。",
  compactNote: "モデルが作成・確認した要約です。対応する出典の抜粋と照合してください。統合した回答の完全性と出典の正確さは未確認です。支払い状況は別途記録されます。",
  confidence: Object.freeze({
    synthetic: "この実行には合成された実演用資料が含まれ、事実の確かさを裏付けるものではありません",
    "no-citation": "根拠の採用条件を満たす引用はありません",
    "unresolved-conflict": "出典間の不一致が{count}件未解決です。網羅度の点数だけでは矛盾する根拠を解消できません",
    "no-coverage": "調査対象の網羅度を評価できていません",
    gaps: "{count}件の調査対象が根拠の基準に達していません",
    incomplete: "最終評価では、依頼のすべての部分について根拠のある完全な回答を確認できていません",
    "explained-conflict": "出典を優先した理由は説明されていますが、根拠の矛盾により確信度には限界があります",
    "publisher-groups": "観測された同一DOIの文献を統合した後、出版社ドメインの{count}グループが各調査対象に対応する根拠の箇所を提供しています。ただし、この分類は独立した裏付けや事実の正確さを証明しません",
    "limited-sources": "根拠の確認を経た{count}件の出典が各調査対象をカバーしていますが、裏付けや支持の強さは限定的です",
  }),
  delivery: Object.freeze({
    unavailable: "統合または根拠の確認が完了していません。出典による支持と回答の有用性は未評価です。",
    summary: "各要約文は原文の抜粋と対応し、モデルによる確認を経ています。完全性と独立した事実の正確さは未確認です。",
    excerpts: "出典の抜粋のみを提示しています。統合した回答の完全性と各主張の裏付けは未確認です。",
  }),
  assessment: "根拠の評価",
  lowConfidence: "確信度が低い結果",
  provisional: "暫定的な結果として扱ってください。",
  sentenceEnd: "。",
}) satisfies NativeAnswerCopy;
