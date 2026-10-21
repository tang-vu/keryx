// @vitest-environment jsdom
import { act, createElement, Fragment, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnswerCard } from "../../components/keryx/answer-card";
import { AnswerEvidenceStatus } from "../../components/keryx/answer-evidence-status";
import { AskForm } from "../../components/keryx/ask-form";
import { createMessages } from "../i18n/messages";
import type { EvidenceRecord, QueryRun } from "../types";
import { buildAnswerEvidenceStatus, evidenceFollowUpContext, evidenceFollowUpHref } from "./answer-evidence-status";

const copy = createMessages("en");
function fixture(): QueryRun {
  const subClaims = ["Concurrent writes?", "Checkpoint operations?", "Network filesystem limits?"];
  const excerpt = (claimIndex: number): EvidenceRecord => ({ claimIndex, claim: subClaims[claimIndex],
    marker: "A", sourceId: "official", sourceName: "Official reference", itemId: "article", contentVersion: "v1",
    quote: "A retained exact excerpt for inspection.", support: 0.8, qualifiesForAnswer: true, qualifiesForReward: false });
  return { id: "11111111-1111-4111-8111-111111111111", question: "Compare WAL and rollback journals.",
    answer: "Original recorded answer [A]", subClaims, decisions: [], budget: 0, totalSpent: 0, totalToCreators: 0,
    createdAt: "2026-10-21T00:00:00Z", engine: "fixture", trace: [], paymentMode: "offline",
    confidence: { level: "Low", reason: "Limited recorded support." },
    citations: [{ marker: "A", sourceId: "official", sourceName: "Official reference", itemId: "article", contentVersion: "v1", weight: 1, reward: 0, rationale: "Recorded contribution" }],
    evidence: [excerpt(0), excerpt(2)],
    claimCoverage: subClaims.map((claim, claimIndex) => ({ claimIndex, claim, coverage: [0.3, 0, 0.8][claimIndex], coveredBy: claimIndex === 1 ? [] : ["A"] })),
    evidencePortfolio: { policy: "claim-coverage-v1", eligibleCandidates: 9, attentionLimit: 2, fetchBudgetUsdc: 0,
      selectedAssetIds: ["official", "other"], selectedBuyUsdc: 0, unusedFetchBudgetUsdc: 0, predictedCoveredClaims: 3, claims: [],
      outcome: { readAssetIds: ["official"], evidenceAssetIds: ["official"], nonqualifyingReads: 0, unreadSelected: 1, groundedClaims: 1, evidenceYield: 1 } },
  };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("recorded answer evidence status", () => {
  it("separates target excerpts from limited estimates and the source-yield percentage", () => {
    const run = fixture(), before = JSON.stringify(run);
    const status = buildAnswerEvidenceStatus(run);
    expect(status.withExcerpts).toBe(2);
    expect(status.needsInspection).toBe(2);
    expect(status.targets.map(row => [row.excerpts, row.estimate, row.needsInspection])).toEqual([[1, 0.3, true], [0, 0, true], [1, 0.8, false]]);
    const html = renderToStaticMarkup(createElement(AnswerCard, { run, meta: null, showFeedback: false }));
    expect(html).toContain("Targets with inspectable excerpts: 2/3.");
    expect(html).toContain("Selected sources: 2/9 proposals");
    expect(html).toContain("30% estimated");
    expect(html).toContain("missing excerpts or a low recorded support estimate: 2.");
    expect(html).not.toMatch(/evidence 100%|reward-qualifying evidence/);
    expect(html.indexOf("Targets with inspectable excerpts")).toBeLessThan(html.indexOf("Original recorded answer"));
    expect(JSON.stringify(run)).toBe(before);
  });
  it("does not turn an unavailable historical ledger into missing evidence or low support", () => {
    const run = { ...fixture(), evidence: undefined };
    const status = buildAnswerEvidenceStatus(run);
    expect(status.available).toBe(false); expect(status.needsInspection).toBe(0);
    const html = renderToStaticMarkup(createElement(AnswerEvidenceStatus, { run }));
    expect(html).toContain("no stored excerpt ledger");
    expect(html).not.toContain("Targets with inspectable excerpts: 0/");
    expect(html).not.toContain("30% estimated");
  });
  it("does not fabricate targets when no decomposition or ledger was retained", () => {
    const run = { ...fixture(), subClaims: [], claimCoverage: undefined, evidence: undefined };
    expect(buildAnswerEvidenceStatus(run).targets).toEqual([]);
    expect(renderToStaticMarkup(createElement(AnswerEvidenceStatus, { run }))).toBe("");
  });
  it.each([{ marker: "foreign" }, { sourceId: "foreign" }, { itemId: "other" }, { contentVersion: "v2" },
    { claim: "different question" }, { quote: " " }, { quote: "x".repeat(241) },
    { qualifiesForAnswer: false, qualifiesForReward: true }])("rejects inconsistent excerpt identity or qualification %j", change => {
    const run = fixture(); run.evidence = [{ ...run.evidence![0], ...change }];
    run.claimCoverage![0].coverage = 1;
    const status = buildAnswerEvidenceStatus(run);
    expect(status.withExcerpts).toBe(0); expect(status.targets[0].needsInspection).toBe(true);
  });
  it("excludes a demo marker even when another row sharing it appears eligible", () => {
    const run = fixture(); run.evidence![1].evidenceProvenance = "synthetic-demo";
    expect(buildAnswerEvidenceStatus(run).withExcerpts).toBe(0);
  });
  it("accepts historical reward-only qualification and deduplicates identical excerpts", () => {
    const run = fixture(); run.evidence![0].qualifiesForAnswer = undefined; run.evidence![0].qualifiesForReward = true;
    run.evidence!.push({ ...run.evidence![0] });
    expect(buildAnswerEvidenceStatus(run).targets[0].excerpts).toBe(1);
  });
  it.each([NaN, Infinity, -0.1, 1.1])("omits an invalid estimate %s", value => {
    const run = fixture(); run.claimCoverage![0].coverage = value;
    const row = buildAnswerEvidenceStatus(run).targets[0];
    expect(row.estimate).toBeNull(); expect(row.needsInspection).toBe(false);
  });
  it("does not select between duplicate or mismatched target estimates", () => {
    const run = fixture(); run.claimCoverage!.push({ ...run.claimCoverage![0], coverage: 1 });
    run.claimCoverage![2].claim = "another target";
    expect(buildAnswerEvidenceStatus(run).targets.map(row => row.estimate)).toEqual([null, 0, null]);
  });
});

describe("editable evidence follow-up", () => {
  it("retains original Unicode/context and encodes query-looking text without automatic execution", () => {
    const target = "Giới hạn? &run=1 #中文 {question}";
    const draft = copy("reportEvidence.draft", evidenceFollowUpContext("Câu hỏi gốc", target));
    const url = new URL(evidenceFollowUpHref(fixture().id, draft), "https://keryx.test");
    expect(url.pathname).toBe("/"); expect(url.searchParams.get("parent")).toBe(fixture().id);
    expect(url.searchParams.get("q")).toContain(target); expect(url.searchParams.get("q")).toContain("Câu hỏi gốc");
    expect([...url.searchParams.keys()]).toEqual(["q", "parent"]);
  });
  it("bounds long drafts at the actual editable form limit without splitting a surrogate pair", () => {
    const context = evidenceFollowUpContext("😀".repeat(1000), "😀".repeat(1000));
    expect(context.target.length).toBeLessThanOrEqual(1200); expect(context.question.length).toBeLessThanOrEqual(500);
    const q = new URL(evidenceFollowUpHref("foreign&run=1", "a".repeat(1999) + "😀"), "https://keryx.test").searchParams.get("q")!;
    expect(q.length).toBeLessThanOrEqual(2000); expect(q).not.toContain("\uFFFD");
    expect(new URL(evidenceFollowUpHref("foreign&run=1", "draft"), "https://keryx.test").searchParams.has("parent")).toBe(false);
  });
  it.each([false, true])("opens the real composer with an editable target draft and submits only after deliberate input (StrictMode=%s)", async strict => {
    const run = fixture(), container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container), onAsk = vi.fn();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      requests.push(input);
      const data = input === "/api/ask/visibility" ? { wallet: null, defaultVisibility: "public", privacyActive: true }
        : input === "/api/research/availability" ? { state: "not-paused" }
          : input === "/api/models" ? { models: [] } : null;
      if (!data) throw new Error(`Unexpected HTTP request: ${input}`);
      return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
    }));
    try {
      await act(async () => { root.render(createElement(AnswerEvidenceStatus, { run })); });
      const details = container.querySelector("details")!;
      details.open = true;
      const link = container.querySelector<HTMLAnchorElement>("a")!;
      expect(link.textContent).toContain(run.subClaims[0]);
      const href = link.getAttribute("href")!;
      expect(requests).toEqual([]);
      window.history.replaceState(null, "", href);
      await act(async () => { root.render(createElement(strict ? StrictMode : Fragment, null, createElement(AskForm, { onAsk }))); });
      for (let attempt = 0; attempt < 5; attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      const textarea = container.querySelector<HTMLTextAreaElement>("#ask-question")!;
      expect(textarea.value).toContain(run.subClaims[0]); expect(textarea.value).toContain(run.question);
      expect(onAsk).not.toHaveBeenCalled(); expect(requests).not.toContain("/api/ask");
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Edited target question");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })); });
      expect(onAsk).toHaveBeenCalledTimes(1);
      expect(onAsk.mock.calls[0][0]).toBe("Edited target question"); expect(onAsk.mock.calls[0][2]).toBe(run.id);
    } finally {
      await act(async () => { root.unmount(); }); container.remove(); window.history.replaceState(null, "", "/");
    }
  });
});
