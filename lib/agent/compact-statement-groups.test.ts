import { describe, expect, it } from "vitest";
import { compactStatementGroups } from "./compact-statement-groups";
import type { CitedStatement } from "./cited-statements";
import type { EvidenceLedger } from "./evidence-ledger";

function fixture(claims: number[], quotes: string[]) {
  const summary: CitedStatement[] = claims.map((claimIndex, index) => ({ claimIndex, marker: "S1", quote: quotes[index], text: `Sentence ${index}.` }));
  const evidence: EvidenceLedger["evidence"] = summary.map(statement => ({ ...statement,
    claim: `Target ${statement.claimIndex}`, sourceId: "one", sourceName: "One", itemId: "item", itemUrl: "https://one.test/item", contentVersion: "v1", support: 1, qualifiesForAnswer: true, qualifiesForReward: false }));
  return { summary, evidence };
}

describe("compact statement grouping preserves admitted bindings", () => {
  it("joins same-target pairs and literal nested quotes transitively, without losing statements", () => {
    const { summary, evidence } = fixture([0, 1, 1, 2], ["A complete sentence.", "A complete sentence. Another one.", "A different sentence.", "Unrelated text."]);
    const before = JSON.stringify({ summary, evidence });
    expect(compactStatementGroups(summary, evidence)).toEqual([[...summary.slice(0, 3)], [summary[3]]]);
    expect(JSON.stringify({ summary, evidence })).toBe(before);
  });

  it("does not join distinct quotes across different targets from the same source", () => {
    const { summary, evidence } = fixture([0, 1], ["First unrelated sentence.", "Second unrelated sentence."]);
    expect(compactStatementGroups(summary, evidence)).toEqual(summary.map(statement => [statement]));
  });

  it.each(["sourceId", "contentVersion", "itemId", "itemUrl"] as const)("keeps a same-marker different %s binding separate", field => {
    const { summary, evidence } = fixture([0, 0], ["An exact sentence.", "An exact sentence. Another one."]);
    evidence[1][field] = "different";
    expect(compactStatementGroups(summary, evidence)).toEqual(summary.map(statement => [statement]));
  });

  it("keeps distinct markers separate even with matching text and source identity", () => {
    const { summary, evidence } = fixture([0, 0], ["An exact sentence.", "An exact sentence."]);
    summary[1].marker = evidence[1].marker = "S2";
    expect(compactStatementGroups(summary, evidence)).toEqual(summary.map(statement => [statement]));
  });

  it("refuses absent, empty-source or ambiguous bindings", () => {
    const { summary, evidence } = fixture([0], ["An exact sentence."]);
    expect(compactStatementGroups(summary, [])).toBeUndefined();
    expect(compactStatementGroups(summary, [{ ...evidence[0], sourceId: "" }])).toBeUndefined();
    expect(compactStatementGroups(summary, [evidence[0], { ...evidence[0], contentVersion: "v2" }])).toBeUndefined();
  });
});
