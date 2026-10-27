import { createHash } from "node:crypto";
import { buildCitationExport } from "../research-citation-export";
import { paperReferencesCslJson } from "../papers/reference-export";
import type { PaperRecord } from "../papers/types";
import type { CslReference } from "../research/reference-export-core";
import type { QueryRun } from "../types";
import { ZoteroError } from "./zotero-contract";

export interface ZoteroReference { identity: string; citationKey: string; fields: Record<string, unknown> & { itemType: string; title: string; url: string }; note: string }
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const html = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
function reference(row: CslReference, reportUrl?: string, quotes: readonly string[] = []): ZoteroReference {
  // CSL is the existing canonical projection of the same recorded BibTeX fields.
  // Unsupported native fields remain explicit Extra values, never guessed metadata.
  const article = row.type === "article-journal", conference = row.type === "paper-conference", preprint = row.type === "manuscript";
  const identity = digest(`keryx-zotero-work-v1:${row.id}`), extra = [`Keryx identity: ${identity}`];
  if (row["container-title"] && !article && !conference) extra.push(`Container title: ${row["container-title"]}`);
  for (const [label, value] of [["Archive", row.archive], ["Archive location", row.archive_location], ["Content version", row.version]] as const) if (value) extra.push(`${label}: ${value}`);
  if (!article && !conference) for (const [label, value] of [["Volume", row.volume], ["Issue", row.issue], ["Pages", row.page]] as const) if (value) extra.push(`${label}: ${value}`);
  const fields = {
    itemType: article ? "journalArticle" : conference ? "conferencePaper" : preprint ? "preprint" : "webpage",
    title: row.title, url: row.URL, citationKey: row["citation-key"],
    creators: (row.author ?? []).map(author => author.family ? { creatorType: "author", lastName: author.family, firstName: author.given ?? "" } : { creatorType: "author", name: author.literal! }),
    ...(row.issued ? { date: String(row.issued["date-parts"][0][0]) } : {}),
    ...(row.DOI ? { DOI: row.DOI } : {}),
    ...(row["container-title"] && (article || conference) ? { [article ? "publicationTitle" : "proceedingsTitle"]: row["container-title"] } : {}),
    ...((article || conference) && row.volume ? { volume: row.volume } : {}), ...((article || conference) && row.issue ? { issue: row.issue } : {}),
    ...((article || conference) && row.page ? { pages: row.page } : {}),
    extra: extra.join("\n"),
  };
  const note = `<p>${html(row.note)}</p>` + (reportUrl ? `<p>Keryx report: <a href="${html(reportUrl)}">${html(reportUrl)}</a></p>` : "") +
    quotes.map(quote => `<pre>${html(quote)}</pre>`).join("");
  if (Buffer.byteLength(note, "utf8") > 131_072) throw new ZoteroError("zotero_limit");
  return { identity, citationKey: row.id, fields, note };
}
export function zoteroPaperReferences(papers: readonly PaperRecord[]) {
  const rows = JSON.parse(paperReferencesCslJson(papers).content) as CslReference[];
  return rows.map(row => reference(row));
}
/** Server-owned run only; no client-supplied excerpt or private URL enters provider notes. */
export function zoteroReportReferences(run: QueryRun, baseUrl: string) {
  if (run.originalFulfillment || run.id.startsWith("prv_") || run.citations.length > 50) throw new ZoteroError("zotero_report_not_found");
  const output = buildCitationExport(run.citations, "csl-json");
  if (output.omitted) throw new ZoteroError("zotero_conflict");
  const rows = JSON.parse(output.content) as CslReference[], reportUrl = `${new URL(baseUrl).origin}/dispatch/${encodeURIComponent(run.id)}`;
  // Explicit answer rejection wins over the historical reward-only flag, as it
  // does in report inspection. Keep this adapter's existing 16KiB exact quotation
  // contract (including old records without target metadata); notes do not make
  // a target-coverage assertion. Unlabelled demos must not become factual notes.
  const evidence = (run.evidence ?? []).filter(item => (item.qualifiesForAnswer ?? item.qualifiesForReward) === true
    && item.evidenceProvenance !== "synthetic-demo");
  return rows.map(row => {
    const matching = run.citations.filter(citation => {
      const one = JSON.parse(buildCitationExport([citation], "csl-json").content) as CslReference[];
      return one[0]?.id === row.id;
    });
    if (!matching.length) throw new ZoteroError("zotero_conflict");
    const quotes = [...new Set(evidence.filter(item => matching.some(citation =>
      item.marker === citation.marker && item.sourceId === citation.sourceId && item.itemId === citation.itemId &&
      item.itemUrl === citation.itemUrl && item.contentVersion === citation.contentVersion)).map(item => item.quote))];
    if (quotes.length > 50 || quotes.some(quote => typeof quote !== "string" || quote.length > 16_384)) throw new ZoteroError("zotero_limit");
    return reference(row, reportUrl, quotes.filter(quote => quote.trim().length > 0));
  });
}
