import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Decision, QueryRun, TraceStep } from "../types";
import { sourceReadDetail, sourceReadSummary } from "./source-read-outcomes";
vi.mock("@/lib/hooks/use-siwe-auth", () => ({ useSiweAuth: () => ({ session: null }) }));
import { AnswerCard } from "@/components/keryx/answer-card";

const decision = (id: string, kind: "public" | "cache" = "public"): Decision => ({ sourceId: id, sourceName: "Synthetic source", action: "CACHE",
  expectedValue: 0.9, confidence: 0.9, price: 0, targets: [0], rationale: "Synthetic selection",
  ...(kind === "public" ? { sourceKind: "public-reference" } : {}) });
const trace = (detail: unknown): TraceStep => ({ phase: "fetch", message: "Synthetic read outcome", ts: 1, detail });
function run(decisions = [decision("primary"), decision("secondary")], steps: TraceStep[] = []): QueryRun {
  return { id: "synthetic-read-summary", createdAt: "2026-10-19T00:00:00Z", question: "Synthetic original question", answer: "No complete supported answer.",
    budget: 0, totalSpent: 0, totalToCreators: 0, engine: "synthetic", subClaims: [], decisions, citations: [], trace: steps };
}
it("never calls two selected fresh public reads cached when historical outcomes were not recorded", () => {
  const original = run();
  expect(sourceReadSummary(original)).toEqual({ publicReads: 0, cacheHits: 0, failedReads: 0, publicSelectionsWithoutOutcome: 2, cacheSelectionsWithoutOutcome: 0 });
  const html = renderToStaticMarkup(createElement(AnswerCard, { run: original, meta: null, showFeedback: false }));
  expect(html).not.toContain("2 cached");
  expect(html).toContain("2 public read selections");
});
it("renders one successful original, one failed original and one actual cache hit separately", () => {
  const original = run([decision("primary"), decision("secondary"), decision("owned-cache", "cache")], [
    trace(sourceReadDetail("primary", "public", "failed", "transport-unavailable", { reason: "http-status", httpStatus: 403, elapsedMs: 80 })),
    trace(sourceReadDetail("secondary", "public", "succeeded")), trace(sourceReadDetail("owned-cache", "cache", "succeeded")),
  ]);
  expect(sourceReadSummary(original)).toEqual({ publicReads: 1, cacheHits: 1, failedReads: 1, publicSelectionsWithoutOutcome: 0, cacheSelectionsWithoutOutcome: 0 });
  const html = renderToStaticMarkup(createElement(AnswerCard, { run: original, meta: null, showFeedback: false }));
  for (const text of ["1 public read", "1 cache hit", "1 unavailable read"]) expect(html).toContain(text);
  expect(html).not.toContain("3 cached");
});
it("counts a failed cache lookup even after the decision is corrected to SKIP", () => {
  const d = { ...decision("cache", "cache"), action: "SKIP" as const };
  expect(sourceReadSummary(run([d], [trace(sourceReadDetail("cache", "cache", "failed", "cache-unavailable"))]))).toMatchObject({ cacheHits: 0, failedReads: 1 });
});
it("uses the latest observed source state without double-counting repeated trace delivery", () => {
  const detail = sourceReadDetail("primary", "public", "succeeded");
  expect(sourceReadSummary(run([decision("primary")], [trace(detail), trace(detail)]))).toMatchObject({ publicReads: 1, failedReads: 0 });
});
it("does not infer a read from citations, selection text, unknown outcomes or mismatched cache kinds", () => {
  const original = run([decision("primary")], [trace({ sourceRead: { ...sourceReadDetail("primary", "public", "succeeded").sourceRead, rawError: "PRIVATE" } }),
    trace(sourceReadDetail("other-id", "public", "succeeded")), trace(sourceReadDetail("primary", "cache", "succeeded"))]);
  expect(sourceReadSummary(original)).toMatchObject({ publicReads: 0, cacheHits: 0, publicSelectionsWithoutOutcome: 1 });
  expect(sourceReadDetail("url?secret=PRIVATE", "public", "failed", "PRIVATE_ERROR")).toEqual({});
  expect(sourceReadDetail("primary", "public", "failed", "PRIVATE_ERROR")).toMatchObject({ sourceRead: { failureCode: "unavailable" } });
});
