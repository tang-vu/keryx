import { evidenceCsvCell } from "./evidence-matrix";
import type { ComparedTarget, ComparisonExcerpt, ReportComparison } from "./report-comparison";

export type ComparisonExportFormat = "json" | "markdown" | "csv";

/** Original text stays literal, including Markdown/HTML-looking source content.
 * No imported URL becomes an active link in the Markdown comparison. */
function literal(value: string): string {
  const runs = value.match(/`+/gu) ?? [];
  const fence = "`".repeat(runs.reduce((length, run) => Math.max(length, run.length + 1), 3));
  return `${fence}text\n${value}\n${fence}`;
}

export function reportComparisonJson(comparison: ReportComparison): string {
  return JSON.stringify(comparison, null, 2) + "\n";
}

export function reportComparisonMarkdown(comparison: ReportComparison): string {
  const lines = ["# Saved research comparison", "", comparison.notice, "",
    `Availability: ${comparison.availability}. Order: caller-selected.`,
    `Comparable targets: ${comparison.summary.comparableTargets}; changed targets: ${comparison.summary.changedTargets}; unknown targets: ${comparison.summary.unknownTargets}.`,
    `Added excerpt rows: ${comparison.summary.addedRows}; removed excerpt rows: ${comparison.summary.removedRows}; changed reading-context rows: ${comparison.summary.contextChangedRows}.`,
    `Illustrative excerpt rows across both inputs: ${comparison.summary.illustrativeRows}.`, "",
    "Unmatched targets are not inferred excerpt additions or losses. Missing ledger data is not evidence of a change. Retrieval timestamp alone is excluded from change detection. Unknown authenticity and factual support remain unknown."];
  for (const side of ["before", "after"] as const) {
    const report = comparison[side];
    lines.push("", `## ${side === "before" ? "Before" : "After"} receipt`, "",
      literal(JSON.stringify({ digest: report.digest, id: report.id, createdAt: report.createdAt, ledgerAvailable: report.ledgerAvailable }, null, 2)),
      "", "### Recorded question", "", report.question === null ? "Not recorded." : literal(report.question),
      "", "### Recorded answer", "", report.answer === null ? "Not recorded." : literal(report.answer));
  }
  comparison.targets.forEach((target, index) => {
    lines.push("", `## Target pair ${index + 1}`, "", `State: ${target.state}. Match: ${target.match}.`);
    for (const side of ["before", "after"] as const) {
      const original = target[side];
      lines.push("", `### ${side === "before" ? "Before" : "After"} target`, "");
      if (!original) { lines.push("Unmatched / not recorded."); continue; }
      lines.push(literal(original.claim), "", `Recorded index: ${original.claimIndex}; inspectable ledger: ${original.ledgerAvailable}; excluded rows: ${original.excludedRows}.`);
    }
    for (const row of comparisonRows(target)) {
      lines.push("", `### ${row.side} / ${row.change}`, "");
      if (!row.excerpt) { lines.push("No inspectable excerpt row."); continue; }
      const { quote, ...identity } = row.excerpt;
      lines.push(literal(quote), "", literal(JSON.stringify(identity, null, 2)));
    }
  });
  return lines.join("\n") + "\n";
}

interface ExportRow { side: "before" | "after"; change: string; excerpt?: ComparisonExcerpt }
function comparisonRows(target: ComparedTarget): ExportRow[] {
  const rows: ExportRow[] = [];
  const pair = (change: string, pairs: ComparedTarget["unchanged"]) => {
    for (const item of pairs) rows.push({ side: "before", change, excerpt: item.before }, { side: "after", change, excerpt: item.after });
  };
  pair("unchanged", target.unchanged); pair("read-context-changed", target.contextChanged);
  rows.push(...target.removed.map(excerpt => ({ side: "before" as const, change: "removed", excerpt })),
    ...target.added.map(excerpt => ({ side: "after" as const, change: "added", excerpt })));
  if (!rows.length) {
    for (const side of ["before", "after"] as const) {
      if (!target[side]) continue;
      const retained = target[side].excerpts;
      if (retained.length) rows.push(...retained.map(excerpt => ({ side, change: "retained-not-compared", excerpt })));
      else rows.push({ side, change: "no-inspectable-excerpt" });
    }
  }
  return rows;
}

/** Every cell is quoted; spreadsheet formula prefixes are neutralized. JSON and
 * Markdown preserve exact original strings without the CSV display apostrophe. */
export function reportComparisonCsv(comparison: ReportComparison): string {
  const rows: Array<Array<string | number>> = [["format", "before_payload_digest", "after_payload_digest", "availability",
    "target_state", "match", "before_claim_index", "before_target", "after_claim_index", "after_target",
    "row_change", "side", "marker", "source_id", "source_name", "item_id", "item_title", "item_url", "content_version",
    "exact_excerpt", "illustrative", "read_context_json", "excluded_rows", "notice"]];
  const prefix = [comparison.format, comparison.before.digest, comparison.after.digest, comparison.availability];
  for (const target of comparison.targets) {
    for (const row of comparisonRows(target)) {
      const item = row.excerpt;
      rows.push([...prefix, target.state, target.match, target.before?.claimIndex ?? "", target.before?.claim ?? "",
        target.after?.claimIndex ?? "", target.after?.claim ?? "", row.change, row.side, item?.marker ?? "", item?.sourceId ?? "",
        item?.sourceName ?? "", item?.itemId ?? "", item?.itemTitle ?? "", item?.itemUrl ?? "", item?.contentVersion ?? "",
        item?.quote ?? "", item ? String(item.illustrative) : "", item ? JSON.stringify(item.context) : "",
        target[row.side]?.excludedRows ?? "", comparison.notice]);
    }
  }
  if (rows.length === 1) rows.push([...prefix, ...Array<string>(19).fill(""), comparison.notice]);
  return rows.map(row => row.map(evidenceCsvCell).join(",")).join("\r\n") + "\r\n";
}

export function exportReportComparison(comparison: ReportComparison, format: ComparisonExportFormat): string {
  switch (format) {
    case "json": return reportComparisonJson(comparison);
    case "markdown": return reportComparisonMarkdown(comparison);
    case "csv": return reportComparisonCsv(comparison);
  }
}
