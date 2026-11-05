import type { PresentationLanguage } from "../../shared/i18n/presentation-language";
import type { AnswerTableDelivery, DeliveredAnswerTableCell } from "./answer-table";

function literal(text: string): string {
  return text.replace(/[\p{Cc}\u2028\u2029]+/gu, " ")
    .replace(/[\\`*_{}\[\]()<>#!|]/gu, "$&\u200b");
}

/** Same Markdown travels in the answer, export and receipt. Original evidence and
 * notices remain intact below; repeated citations never enter reward allocation. */
export function answerTableMarkdown(table: AnswerTableDelivery | undefined, language: PresentationLanguage): string {
  const vi = language === "vi";
  if (!table) return vi ? "Chưa cung cấp được bảng đã kiểm tra; câu trả lời và các giới hạn được giữ nguyên bên dưới." :
    "A checked table could not be provided; the answer and its recorded limits are retained below.";
  const unknown = vi ? "Chưa đủ bằng chứng đã kiểm tra cho ô này." : "Not established by the checked evidence.";
  const cell = (value: DeliveredAnswerTableCell): string => {
    if (value.kind === "label") return literal(value.text);
    if (value.kind === "unknown") return unknown;
    if (value.kind === "facts") return value.statements.map(row => `${literal(row.text)} — “${literal(row.quote)}” [${row.marker}]`).join(" ");
    const markers = [...new Set(value.statements.map(row => row.marker))].map(marker => `[${marker}]`).join(" ");
    return `${vi ? "Đề xuất có điều kiện" : "Conditional proposal"}: ${literal(value.text)} ${vi ? "Điều kiện" : "Conditions"}: ${value.conditions.map(literal).join("; ")}. ${markers}`;
  };
  const line = (values: string[]) => `| ${values.join(" | ")} |`;
  const result = [vi ? "### Bảng theo yêu cầu" : "### Requested table",
    vi ? "Dữ kiện có trích đoạn; đề xuất được ghi rõ điều kiện. Phần bằng chứng và giới hạn đầy đủ nằm bên dưới." :
      "Facts include excerpts; proposals state their conditions. The full evidence and recorded limits follow below.",
    [line(table.columns.map(literal)), line(table.columns.map(() => "---")), ...table.rows.map(row => line(row.map(cell)))].join("\n"),
    ...(table.incomplete ? [vi ? "Một số ô chưa được xác minh; ô trống bằng chứng không chứng minh điều ngược lại." :
      "Some cells remain unverified; a missing finding does not establish the opposite."] : [])].join("\n\n");
  // Whole projection only. Never clip a condition, citation or original quote.
  return result.length <= 16_000 ? result : answerTableMarkdown(undefined, language);
}
