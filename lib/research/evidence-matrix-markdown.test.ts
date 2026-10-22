import { describe, expect, it } from "vitest";
import type { EvidenceRecord } from "../types";
import { evidenceMatrixMarkdown } from "./evidence-matrix-markdown";

function exportRecord(fields: Partial<EvidenceRecord> = {}): string {
  const item: EvidenceRecord = { claimIndex: 0, claim: "Target?", marker: "S1", sourceId: "one",
    sourceName: "Publication", quote: "Exact excerpt", support: 0.8, qualifiesForReward: true, ...fields };
  return evidenceMatrixMarkdown({ subClaims: [item.claim], evidence: [item],
    citations: [{ marker: item.marker, sourceId: item.sourceId, sourceName: item.sourceName,
      itemId: item.itemId, contentVersion: item.contentVersion, weight: 1, reward: 0, rationale: "" }] });
}

describe("Markdown evidence fidelity", () => {
  it.each(["Exact excerpt  ", "\tTiếng Việt / 第二行\n\n\n  tail \t\n\n", "A\r\nB\rC  ", "<b>literal</b> &amp; **text**"])(
    "keeps the final excerpt's whitespace and characters: %j", quote => {
      expect(exportRecord({ quote })).toContain(`Exact excerpt:\n\n\`\`\`\n${quote}\n\`\`\`\n`);
    });

  it("keeps targets, source identities, and article metadata inside literal blocks", () => {
    const value = "Recorded\n\n# Spoofed heading\n<script>alert(1)</script>\n[link](https://example.invalid)  ";
    const fields = { claim: value, marker: value, sourceId: value, sourceName: value,
      itemTitle: value, itemUrl: value, itemPublishedAt: value, itemId: value, contentVersion: value };
    const text = exportRecord(fields);
    for (const label of ["Research target (unverified):", "Source marker:", "Source id:", "Publication:",
      "Article title:", "Article URL:", "Published:", "Item id:", "Content version:"]) {
      expect(text).toContain(`${label}\n\n\`\`\`\n${value}\n\`\`\`\n`);
    }
    expect(text).toContain("### Evidence 1\n");
    expect(text).not.toContain(`### ${value}`);
  });

  it("uses a longer fence when recorded text could close a code block", () => {
    const value = "\n```\n# Still literal\n`````\n~~~\n";
    const text = exportRecord({ claim: value, sourceName: value, quote: value });
    for (const label of ["Research target (unverified):", "Publication:", "Exact excerpt:"]) {
      expect(text).toContain(`${label}\n\n\`\`\`\`\`\`\n${value}\n\`\`\`\`\`\`\n`);
    }
  });
});
