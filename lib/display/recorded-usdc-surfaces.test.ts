import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ArchiveAnswerRow } from "../../components/keryx/archive-answer-row";
import { RelatedDispatches } from "../../components/keryx/related-dispatches";
import { PaymentsFeed } from "../../components/keryx/payments-feed";
import { AnswerCard } from "../../components/keryx/answer-card";
import { buildAnswerText as telegram } from "../telegram/ask-message";
import { buildAnswerText as slack } from "../slack/ask-command";
import { buildAnswerMessage as discord } from "../discord/ask-interaction";
import { buildAnswerContent, keryxMeta } from "../openai-compat";
import { remoteResearchResult } from "../mcp/remote-server";
import { buildResearchReceipt, canonicalJson } from "../research-receipt";
import { researchReportMarkdown } from "../research-report-export";
import type { ArchiveEntry } from "../answers-archive";
import type { PaymentRecord, QueryRun } from "../types";

function run(amount = 0.000001): QueryRun {
  return { id: "local-rendering-fixture", question: "Synthetic local rendering fixture", budget: 0.05,
    engine: "heuristic", subClaims: [], decisions: [],
    citations: [{ marker: "S1", sourceId: "creator-1", sourceName: "Fixture creator", weight: 1,
      reward: amount, rationale: "Fixture allocation" }],
    answer: 'Exact retained-format output, including "quoted text". [S1]',
    totalSpent: amount, totalToCreators: amount, trace: [], createdAt: "2026-10-08T00:00:00.000Z",
    paymentMode: "offline", paymentAttempts: 1, settledPayments: 0, pendingPayments: 0 };
}
function entry(amount = 0.000001): ArchiveEntry {
  return { id: "local-rendering-fixture", question: "An intact question with https://example.org/" + "x".repeat(384),
    answerSnippet: "Synthetic local rendering fixture", citationCount: 1, toCreators: amount,
    totalSpent: amount, sourceNames: ["Fixture creator"], createdAt: "2026-10-08T00:00:00.000Z", confidence: null };
}
function payment(status: PaymentRecord["settlementStatus"], amount = 0.000001): PaymentRecord {
  return { id: status, kind: "citation", queryId: "local-rendering-fixture", sourceId: "creator-1",
    sourceName: "Fixture creator", payer: "fixture-payer", payee: "fixture-payee", amountUsdc: amount,
    network: "eip155:5042002", settled: status === "settled", settlementStatus: status,
    txHash: status === "settled" ? "fixture-Circle-reference" : null, createdAt: "2026-10-08T00:00:00.000Z" };
}

describe("recorded monetary presentation across surfaces", () => {
  it.each([telegram, slack, (value: QueryRun) => JSON.stringify(discord(value)), buildAnswerContent])(
    "keeps one micro-USDC visible in the human reply without mutating the original", reply => {
      const original = run(), before = JSON.stringify(original);
      const text = reply(original);
      expect(text).toContain("$0.000001");
      expect(text).not.toContain("$0.0000 ");
      expect(text).toMatch(/planned|allocations/);
      expect(text).toMatch(/not settlement|do not establish settlement/);
      expect(JSON.stringify(original)).toBe(before);
    },
  );

  it.each([telegram, slack, (value: QueryRun) => JSON.stringify(discord(value)), buildAnswerContent])(
    "shows an unknown legacy fractional micro amount without inventing zero", reply => {
      const text = reply(run(0.0000001));
      expect(text).toContain("Amount unavailable");
      expect(text).not.toContain("$0.0000");
    },
  );

  it("preserves full public question, link and historical network labels in archive cards", () => {
    const value = entry();
    const archive = renderToStaticMarkup(createElement(ArchiveAnswerRow, { entry: value }));
    const related = renderToStaticMarkup(createElement(RelatedDispatches, { entries: [value] }));
    for (const html of [archive, related]) {
      expect(html).toContain("$0.000001");
      expect(html).toContain(value.question);
      expect(html).toContain('href="/dispatch/local-rendering-fixture"');
      expect(html).toContain("recorded creator rewards");
    }
    const historical = renderToStaticMarkup(createElement(RelatedDispatches,
      { entries: [{ ...value, archivedNetwork: "eip155:5042002" }] }));
    expect(historical).toContain("0.000001 test USDC");
    expect(historical).not.toContain("$0.000001");
  });

  it.each([true, false])("keeps payment state separate from exact amount, compact=%s", compact => {
    const html = renderToStaticMarkup(createElement(PaymentsFeed,
      { payments: [payment("settled"), payment("pending"), payment("failed"), payment("simulated")], compact }));
    expect(html.match(/\$0\.000001/g)).toHaveLength(4);
    for (const word of ["pending", "failed", "simulated"]) expect(html).toContain(word);
    expect(html).toContain(compact ? "settled in batch" : "Recorded reference: fixture-Circle-reference");
    expect(html).toContain("Arc Testnet");
  });

  it("keeps offline answer, planned allocations and simulated spend intact with exact display", () => {
    const value = run();
    const html = renderToStaticMarkup(createElement(AnswerCard,
      { run: value, meta: null, showFeedback: false, payments: [payment("simulated")] }));
    expect(html).toContain("$0.000001");
    expect(html).toContain("Simulated spend");
    expect(html).toContain("planned");
    expect(value.answer).toBe('Exact retained-format output, including "quoted text". [S1]');
  });

  it("leaves structured numbers, portable receipt bytes and export text untouched by presentation", () => {
    const value = run(), payments = [payment("simulated")];
    const receiptBefore = canonicalJson(buildResearchReceipt(value, payments));
    const exportBefore = researchReportMarkdown(value, null, payments);
    const openaiBefore = JSON.stringify(keryxMeta(value));
    const mcpBefore = JSON.stringify(remoteResearchResult(value));
    const http = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network allowed"));
    try {
      for (const reply of [telegram, slack, discord, buildAnswerContent]) reply(value);
      renderToStaticMarkup(createElement(AnswerCard, { run: value, meta: null, showFeedback: false, payments }));
      expect(canonicalJson(buildResearchReceipt(value, payments))).toBe(receiptBefore);
      expect(researchReportMarkdown(value, null, payments)).toBe(exportBefore);
      expect(JSON.stringify(keryxMeta(value))).toBe(openaiBefore);
      expect(JSON.stringify(remoteResearchResult(value))).toBe(mcpBefore);
      expect(keryxMeta(value).totalToCreators).toBe(0.000001);
      expect(remoteResearchResult(value).answer).toBe(value.answer);
      expect(http).not.toHaveBeenCalled();
    } finally { http.mockRestore(); }
  });
});
