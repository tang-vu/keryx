import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { RESEARCH_RECEIPT_SCHEMA } from "../research-receipt-types";
import { compareSavedResearch } from "./report-comparison";
import { exportReportComparison, reportComparisonCsv, reportComparisonJson, reportComparisonMarkdown } from "./report-comparison-export";

const quote = ' \n=HYPERLINK("https://evil.invalid","open")\n```\n<img src=x onerror=alert(1)> ';
function receipt(ledger = true) {
  const identity = { marker: "S1", sourceId: "original", sourceName: "Original", itemUrl: "javascript:alert(1)", contentVersion: "v1" };
  const payload = { schema: RESEARCH_RECEIPT_SCHEMA, dispatch: { id: "one", question: "A ``` literal question", answer: "A saved answer" },
    ...(ledger ? { claims: [{ claimIndex: 0, claim: "\u200b@a, target", evidence: [{ ...identity, quote, qualifiesForReward: false, qualifiesForAnswer: true }] }], citations: [identity] } : {}) };
  return JSON.stringify({ payload, integrity: { algorithm: "sha256", canonicalization: "keryx-json-v1", scope: "payload",
    digest: `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}` } });
}
function csvCells(input: string): string[][] {
  const rows: string[][] = [], row: string[] = []; let cell = "", quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') { if (quoted && input[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if (char === "\r" && input[i + 1] === "\n" && !quoted) { row.push(cell); rows.push([...row]); row.length = 0; cell = ""; i++; }
    else cell += char;
  }
  return rows;
}

describe("portable saved report comparison", () => {
  it("binds JSON to both payload digests and preserves literal strings without changing the input", async () => {
    const before = receipt(), comparison = await compareSavedResearch({ before, after: before });
    const json = reportComparisonJson(comparison);
    expect(JSON.parse(json)).toEqual(comparison);
    expect(JSON.parse(json).targets[0].unchanged[0].before.quote).toBe(quote);
    expect(JSON.parse(json).before.digest).toBe(JSON.parse(before).integrity.digest);
    expect(before).toBe(receipt());
    expect(exportReportComparison(comparison, "json")).toBe(json);
  });
  it("keeps Markdown/HTML-looking input inside sufficiently long literal fences and never creates links", async () => {
    const comparison = await compareSavedResearch({ before: receipt(), after: receipt() });
    const md = reportComparisonMarkdown(comparison);
    expect(md).toContain(`\`\`\`\`text\n${quote}\n\`\`\`\``);
    expect(md).toContain('"itemUrl": "javascript:alert(1)"');
    expect(md).not.toContain("](javascript:");
    expect(md).toContain(comparison.before.digest);
    expect(md).toContain("Unmatched targets are not inferred excerpt additions or losses");
    expect(exportReportComparison(comparison, "markdown")).toBe(md);
  });
  it("quotes every CSV cell and neutralizes invisible-prefix formulas while retaining digest and context columns", async () => {
    const comparison = await compareSavedResearch({ before: receipt(), after: receipt() });
    const csv = reportComparisonCsv(comparison), [header, ...rows] = csvCells(csv);
    expect(header).toHaveLength(24); expect(rows).toHaveLength(2);
    expect(rows.every(row => row.length === header.length)).toBe(true);
    const objects = rows.map(row => Object.fromEntries(header.map((key, index) => [key, row[index]])));
    expect(objects[0]).toMatchObject({ exact_excerpt: "'" + quote, before_target: "'\u200b@a, target", before_payload_digest: comparison.before.digest,
      after_payload_digest: comparison.after.digest, row_change: "unchanged", read_context_json: "{}" });
    expect(objects[1].side).toBe("after");
    expect(exportReportComparison(comparison, "csv")).toBe(csv);
  });
  it("exports retained rows with unknown comparison instead of fabricated additions/losses", async () => {
    const comparison = await compareSavedResearch({ before: receipt(false), after: receipt() });
    const [header, row] = csvCells(reportComparisonCsv(comparison));
    expect(row[header.indexOf("row_change")]).toBe("retained-not-compared");
    expect(row[header.indexOf("target_state")]).toBe("comparison-unavailable");
    expect(reportComparisonMarkdown(comparison)).toContain("after / retained-not-compared");
  });
  it("keeps a bounded empty comparison's bindings and notice in CSV", async () => {
    const comparison = await compareSavedResearch({ before: receipt(false), after: receipt(false) });
    const [header, row] = csvCells(reportComparisonCsv(comparison));
    expect(row).toHaveLength(header.length);
    expect(row[1]).toBe(comparison.before.digest); expect(row.at(-1)).toBe(comparison.notice);
  });
});
