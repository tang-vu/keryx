import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("@/lib/hooks/use-siwe-auth", () => ({ useSiweAuth: () => ({ session: null }) }));
import { DispatchView } from "@/app/dispatch/[id]/dispatch-view";
import { ReasoningConsole } from "@/components/keryx/reasoning-console";
import { TraceRow } from "@/components/keryx/trace-row";
import { stepPaymentTotals } from "@/components/keryx/budget-meter";
import { UiCopyContext, englishUiCopy } from "../i18n/ui-copy-context";
import { createMessages } from "../i18n/messages";
import { loadUiPreview } from "../i18n/ui-preview-catalogues";
import { validatePrivacyRun } from "../run-privacy/contracts";
import { createReadCheckpointCapture } from "../agent/read-checkpoint-capture";
import { actualReadCheckpoint } from "../research-audit/actual-read-policy";
import { projectActualReadCheckpoints } from "../research-audit/actual-read-projection";
import { buildResearchReceipt, canonicalJson } from "../research-receipt";
import { publicQueryRun } from "./public-query-run";
import { sourceReadDetail, sourceReadSummary } from "./source-read-outcomes";
import { presentationRun } from "./presentation.test-fixture";

const id = "eab736d0-3c4d-48e3-b045-2dab3b051eb5";
const opaque = [
  { name: "null", value: null }, { name: "number", value: 19 },
  { name: "boolean", value: false }, { name: "string", value: "Opaque retained value" },
  { name: "array", value: [{ message: "OPAQUE_ARRAY_SENTINEL" }] },
  { name: "unknown phase", value: { phase: "future-observation", message: "Original future message", ts: 2 } },
  { name: "inherited phase name", value: { phase: "toString", message: "Original inherited-name message", ts: 2 } },
  { name: "object message", value: { phase: "discover", message: { text: "OPAQUE_OBJECT_SENTINEL" }, ts: 2 } },
  { name: "unconvertible timestamp", value: { phase: "discover", message: "Original timestamp message", ts: { toString: null } } },
];
const payment = (status: string, amountUsdc: number, conflict = false) => ({ kind: "citation", queryId: id,
  sourceId: "source-original", sourceName: "Synthetic retained payment", payer: "fixture-payer", payee: "fixture-payee",
  amountUsdc, network: "eip155:5042002", settled: conflict || status === "settled", settlementStatus: status,
  createdAt: "2026-10-12T00:00:00.000Z" });
const validTrace = () => [
  { phase: "fetch", ts: 1, message: "Recorded public read", detail: sourceReadDetail("source-original", "public", "succeeded") },
  ...[payment("settled", 0.000001), payment("pending", 0.000002), payment("simulated", 0.000004),
    payment("failed", 0.000008), payment("pending", 0.000016, true)].map((detail, index) => ({ phase: "settle", ts: index + 3, message: "Synthetic retained payment detail", detail })),
  { phase: "verdict", ts: 9, message: "Original assessment", detail: { level: "Low", reason: "Original assessment" } },
];
function admitted(trace: unknown[], extra: Record<string, unknown> = {}) {
  return validatePrivacyRun(JSON.parse(JSON.stringify({ ...presentationRun(), id,
    decisions: [{ sourceId: "source-original", sourceName: "Synthetic original", sourceKind: "public-reference", action: "CACHE",
      expectedValue: 0.8, confidence: 0.8, price: 0, targets: [0], rationale: "Recorded selection" }], trace, ...extra })), id);
}
function mixed(value: unknown) { const trace: unknown[] = validTrace(); trace.splice(1, 0, value); return admitted(trace); }
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const expectedTotals = { settled: 0.000001, pending: 0.000002, simulated: 0.000004, failed: 0.000008, unverified: 0.000016 };

it.each(opaque)("preserves the public JSON history: $name", ({ value }) => {
  const run = mixed(value), before = hash(run), projected = publicQueryRun(run);
  expect(projected.trace).toEqual(run.trace);
  expect(projected.trace.length).toBe(run.trace.length);
  expect(projected.answer).toBe(run.answer); expect(projected.citations).toEqual(run.citations);
  expect(hash(run)).toBe(before);
});
it.each(opaque)("renders the full admitted report without losing its answer: $name", ({ value }) => {
  const run = mixed(value), before = hash(run);
  const html = renderToStaticMarkup(createElement(DispatchView, { run: publicQueryRun(run), payments: [], historical: true }));
  expect(html).toContain("Decision log");
  expect(html).toContain("Source");
  expect(html).not.toContain("OPAQUE_OBJECT_SENTINEL"); expect(html).not.toContain("OPAQUE_ARRAY_SENTINEL");
  if (!(value && typeof value === "object" && "phase" in value && value.phase === "discover" && typeof value.message === "string")) expect(html).toContain('data-trace-unavailable="true"');
  expect(hash(run)).toBe(before);
});
it.each(opaque)("keeps the live console readable and the original rows intact: $name", ({ value }) => {
  const run = mixed(value), before = hash(run);
  const html = renderToStaticMarkup(createElement(ReasoningConsole, { steps: run.trace, streaming: false, budget: run.budget }));
  expect((html.match(/<li\b/g) ?? []).length).toBe(run.trace.length);
  expect(html).toContain("Recorded public read");
  expect(html).not.toContain("OPAQUE_OBJECT_SENTINEL"); expect(html).not.toContain("OPAQUE_ARRAY_SENTINEL");
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") expect(html).toContain(value.message);
  if (!(value && typeof value === "object" && "phase" in value && value.phase === "discover" && typeof value.message === "string")) expect(html).toContain('data-trace-unavailable="true"');
  expect(hash(run)).toBe(before);
});
it.each(opaque)("retains only actual source-read facts: $name", ({ value }) => {
  const run = mixed(value), before = hash(run);
  expect(sourceReadSummary(run)).toEqual({ publicReads: 1, cacheHits: 0, failedReads: 0, publicSelectionsWithoutOutcome: 0, cacheSelectionsWithoutOutcome: 0 });
  expect(hash(run)).toBe(before);
});
it.each(opaque)("keeps payment classification and portable receipt bytes unchanged: $name", ({ value }) => {
  const run = mixed(value), before = hash(run);
  expect(stepPaymentTotals(run.trace)).toEqual(expectedTotals);
  expect(buildResearchReceipt(run, [])).toEqual(buildResearchReceipt(admitted(validTrace()), []));
  expect(hash(run)).toBe(before);
});

it.each(["en", "vi", "zh-Hans", "es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id", "ru", "ar"] as const)("uses existing native unavailable copy instead of inventing a completed phase: %s", async locale => {
  const preview = await loadUiPreview(locale), message = createMessages(locale, preview.$messages);
  const ui = { ...englishUiCopy, locale, preview, message };
  const step = admitted([{ phase: "toString", message: { text: "OPAQUE_OBJECT_SENTINEL" }, ts: 0 }]).trace[0];
  const html = renderToStaticMarkup(createElement(UiCopyContext.Provider, { value: ui }, createElement(TraceRow, { step })));
  expect(html).toContain(message("format.unavailable"));
  expect(html).not.toContain("text-paid"); expect(html).not.toContain("OPAQUE_OBJECT_SENTINEL");
});

function captureFixture() {
  const capture = createReadCheckpointCapture(true), check = { kind: "channel", creatorFree: false, cache: false } as const;
  capture.append(check, actualReadCheckpoint(check), { candidate: 1, round: 0, proposal: "BUY", plan: "BUY", price: 0.002, remaining: 0.03 });
  const result = capture.finish(); if (result?.status !== "available") throw Error("Invalid capture fixture"); return result;
}
it("retains one valid ordinary-public checkpoint beside opaque history", () => {
  const capture = captureFixture(), run = admitted([null, { phase: "done", message: "Recorded completion", ts: 10, readCheckpoints: capture }]), before = hash(run);
  expect(projectActualReadCheckpoints(run)).toEqual(capture);
  expect(projectActualReadCheckpoints(publicQueryRun(run))).toEqual(capture);
  expect(hash(run)).toBe(before);
});
it.each(["private-original", "duplicate", "unknown-packet", "wrong-phase"] as const)("keeps the checkpoint disclosure gate closed: %s", kind => {
  const capture = captureFixture(), done = { phase: kind === "wrong-phase" ? "fetch" : "done", message: "Recorded entry", ts: 10,
    readCheckpoints: kind === "unknown-packet" ? { ...capture, packet: { ...capture.packet, privateMarker: "PRIVATE_CAPTURE_SENTINEL" } } : capture };
  const run = admitted([null, done, ...(kind === "duplicate" ? [done] : [])], kind === "private-original" ? { originalFulfillment: {} } : {}), before = hash(run);
  expect(projectActualReadCheckpoints(run)).toBeNull();
  const projected = publicQueryRun(run);
  expect(projectActualReadCheckpoints(projected)).toBeNull();
  expect(JSON.stringify(projected)).not.toContain("readCheckpoints");
  expect(JSON.stringify(projected)).not.toContain("PRIVATE_CAPTURE_SENTINEL");
  expect(projected).not.toHaveProperty("originalFulfillment"); expect(hash(run)).toBe(before);
});
