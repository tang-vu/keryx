import type { pdfReadingCopy } from "../en/pdf-reading";

/** Exact source-bound machine draft; no human approval, OCR or full-document claim. */
export const pdfReadingJapanese = Object.freeze({
  summary: "PDFのテキスト抽出で、{total}ページ中{read}ページを処理しました。",
  emptyPages: "処理対象のページ{pages}からはテキストを抽出できませんでした。これらのページはスキャン画像や空白であるか、その他の理由でテキストを読み取れない可能性があります。",
  limit: "ページ数または文字数の上限により、文書全体のテキスト抽出が完了する前に処理を停止しました。文書全体について結論を出す前に、残りの元のページを直接読んでください。文字数で打ち切られた場合は、最後に処理したページも不完全なことがあります。比較のため、このスナップショットを保持してください。",
  textOnly: "PDFの利用可能なテキストレイヤーのみを読み取りました。画像や図は解釈していません。",
  recovery: "同じ元の版を確認してください。必要に応じて、テキストレイヤーを含むPDF、公開者のテキスト、または別途OCR処理したコピーを入手してください。この実行ではOCRを行っていません。",
} satisfies typeof pdfReadingCopy);
