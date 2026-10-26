import type { PaperRecord } from "./types";
import { paperReferencesCslJson } from "./reference-export";
import type { CslReference } from "../research/reference-export-core";

const heading = (value: string) => value.replace(/[\\`*_{}\[\]()<>#!|]/g, "\\$&");
/** Provider text may itself contain Markdown fences. Keep it literal and exact. */
function literal(value: string): string[] {
  let length = 3;
  for (const match of value.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = "`".repeat(length);
  return [fence, value, fence, ""];
}

/** The same validated, bounded, metadata-only records as the CSL export. This is
 * an inspection document, not a literature synthesis or evidence admission. */
export function literatureReferencesMarkdown(papers: readonly PaperRecord[]) {
  const canonical = paperReferencesCslJson(papers);
  const rows = JSON.parse(canonical.content) as CslReference[];
  if (!rows.length) return { count: 0, content: "" };
  const lines = ["# Saved bibliography", "",
    "Saved bibliographic metadata only. Paper text unread; peer-review and withdrawal status unknown. No reading, citation or settlement evidence.", ""];
  for (const [index, row] of rows.entries()) {
    lines.push(`## ${index + 1}. ${heading(row.title)}`, "");
    const fields: Array<[string, string | undefined]> = [
      ["Reference key", row["citation-key"]], ["Reference type", row.type],
      ["Authors", row.author?.map(author => author.literal ?? [author.given, author.family].filter(Boolean).join(" ")).join("; ") || "Not recorded"],
      ["Publication date", row.issued?.["date-parts"][0].join("-") ?? "Not recorded"],
      ["Publication", row["container-title"] ?? "Not recorded"], ["DOI", row.DOI ?? "Not recorded"],
      ["Archive", row.archive], ["Exact archive identifier", row.archive_location], ["Content version", row.version],
      ["URL", row.URL], ["Recorded provenance", row.note],
    ];
    for (const [label, value] of fields) if (value !== undefined) lines.push(`**${label}**`, "", ...literal(value));
  }
  return { count: canonical.count, content: lines.join("\n") + "\n" };
}
