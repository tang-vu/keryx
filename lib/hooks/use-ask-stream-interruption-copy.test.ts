// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAskStream } from "./use-ask-stream";
import { ResearchTurn } from "@/components/keryx/research-turn";
import type { PaymentRecord, QueryRun, TraceStep } from "../types";
import { createPrivateClaimHandoff, type PrivateClaimHandoff } from "../run-claims/web-handoff";
import { researchRecoveryCopy } from "../research/research-recovery-copy";

vi.mock("@/components/keryx/answer-card", () => ({ AnswerCard: () => null }));
vi.mock("@/components/keryx/report-actions", () => ({ ReportActions: () => null }));
vi.mock("@/components/keryx/reasoning-console", () => ({ ReasoningConsole: () => null }));
vi.mock("@/components/keryx/creators-paid-panel", () => ({ CreatorsPaidPanel: () => null }));
vi.mock("@/components/keryx/decision-reviews", () => ({ DecisionReviews: () => null }));

const reportId = "11111111-2222-4333-8444-555555555555";
const question = "Synthetic original <literal> {count}";
const pending: PaymentRecord = { kind: "fetch", queryId: reportId, sourceId: "synthetic", sourceName: "Original source",
  payer: "synthetic-payer", payee: "synthetic-payee", amountUsdc: 0.01, network: "synthetic-fixture-only",
  settled: false, settlementStatus: "pending", authorizationId: `0x${"1".repeat(64)}`, createdAt: "2026-10-29T00:00:00Z" };
const step: TraceStep = { phase: "settle", ts: 1, message: "Original recorded pending state", detail: pending };
let root: Root, container: HTMLDivElement, hook: ReturnType<typeof useAskStream>;
let streams: ReadableStreamDefaultController<Uint8Array>[];
let privateHandoff: PrivateClaimHandoff | undefined;
const sign = vi.fn(() => { throw new Error("No signing in this synthetic fixture"); });
function Probe() {
  const value = useAskStream({ getSessionWalletClient: sign, privateClaimHandoff: privateHandoff });
  useLayoutEffect(() => { hook = value; });
  return createElement(ResearchTurn, { turn: { id: 1, question, payer: "Synthetic", state: value.state } });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); streams = []; privateHandoff = undefined; sign.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
    expect(url).toBe("/api/ask"); expect(options.method).toBe("POST");
    expect(JSON.parse(options.body as string)).toEqual({ question, budget: 0, mode: "quick" });
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { streams.push(controller); } }));
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(createElement(Probe)); });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function start() { await act(async () => { void hook.ask(question, 0); }); }
async function frame(event: string, data: unknown, index = 0) {
  await act(async () => streams[index].enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)));
}
async function close(index = 0) { await act(async () => streams[index].close()); }

it.each(["public", "unlisted", "private", "malformed", "missing"])("retains original evidence and avoids a blind retry suggestion after nonterminal EOF with %s metadata", async visibility => {
  await start();
  if (visibility !== "missing") await frame("meta", { engine: "synthetic", mode: "offline", visibility,
    reportId: visibility === "malformed" ? "https://external.invalid/record" : reportId });
  await frame("step", step); const original = JSON.stringify({ steps: hook.state.steps, payments: hook.state.payments, meta: hook.state.meta });
  await close();
  expect(hook.state.status).toBe("error"); expect(hook.state.errorKind).toBe("generic"); expect(hook.state.run).toBeNull();
  const alert = container.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("does not confirm that research or payments stopped");
  expect(alert.textContent).toContain("Keep recovery records");
  expect(alert.textContent).toContain("do not submit or sign again automatically");
  expect(alert.textContent).not.toMatch(/please try again|refund|cancelled|payment failed/iu);
  expect(alert.querySelector("p")?.getAttribute("lang")).toBe("en");
  expect(JSON.stringify({ steps: hook.state.steps, payments: hook.state.payments, meta: hook.state.meta })).toBe(original);
  expect(hook.state.payments).toEqual([pending]);
  const link = alert.querySelector("a");
  if (visibility === "public" || visibility === "unlisted") {
    expect(link?.getAttribute("href")).toBe(`/dispatch/${reportId}`);
    expect(link?.getAttribute("referrerpolicy")).toBe("no-referrer");
  } else expect(link).toBeNull();
  expect(container.textContent).toContain(question); expect(fetch).toHaveBeenCalledOnce(); expect(sign).not.toHaveBeenCalled();
});

it("keeps an explicit terminal error and its original diagnostic after EOF", async () => {
  await start(); await frame("error", { message: "元の診断 <literal> {count}" }); await close();
  expect(hook.state.error).toBe("元の診断 <literal> {count}");
  expect(container.querySelector('[role="alert"] p')?.getAttribute("lang")).toBe("und");
  expect(fetch).toHaveBeenCalledOnce(); expect(sign).not.toHaveBeenCalled();
});
it("keeps a completed report and its original bytes after EOF", async () => {
  const run: QueryRun = { id: reportId, question, answer: "Original answer <literal> {count}", createdAt: pending.createdAt,
    engine: "synthetic", budget: 0, totalSpent: 0, totalToCreators: 0, subClaims: [], decisions: [], citations: [], trace: [] };
  await start(); await frame("done", run); await close();
  expect(hook.state.status).toBe("done"); expect(hook.state.run).toEqual(run); expect(hook.state.error).toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull(); expect(fetch).toHaveBeenCalledOnce(); expect(sign).not.toHaveBeenCalled();
});
it("does not replace idle or a newer request with late EOF guidance", async () => {
  await start(); await act(async () => hook.reset()); await close(); expect(hook.state.status).toBe("idle");
  await start(); await start(); await close(1); expect(hook.state.status).toBe("streaming");
  await frame("error", { message: "Current terminal error" }, 2); await close(2);
  expect(hook.state.error).toBe("Current terminal error"); expect(fetch).toHaveBeenCalledTimes(3); expect(sign).not.toHaveBeenCalled();
});

it.each(["public", "unlisted", "private"])("preserves a completed %s report when its reader subsequently rejects", async visibility => {
  const run: QueryRun = { id: reportId, question, answer: "Completed answer <literal> {count}", createdAt: pending.createdAt,
    engine: "synthetic", budget: 0, totalSpent: 0, totalToCreators: 0, subClaims: [], decisions: [], citations: [], trace: [step],
    confidence: { level: "Low", reason: "Original evidence limitation" } };
  await start(); await frame("meta", { reportId, visibility, engine: "synthetic", mode: "offline" });
  await frame("step", step); await frame("done", run);
  expect(hook.state.status).toBe("done");
  const original = JSON.stringify(hook.state);
  await act(async () => streams[0].error(new TypeError("Failed to fetch after completed delivery")));
  expect(JSON.stringify(hook.state)).toBe(original);
  expect(hook.state.run).toEqual(run); expect(hook.state.payments).toEqual([pending]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(fetch).toHaveBeenCalledOnce(); expect(sign).not.toHaveBeenCalled();
});

it.each(["generic", "research_paused"])("retains the explicit %s terminal diagnostic when its reader subsequently rejects", async code => {
  await start(); await frame("step", step);
  await frame("error", { code, message: "Original diagnosis <literal> {count}", reportId });
  const original = JSON.stringify(hook.state), alert = container.querySelector('[role="alert"]')?.textContent;
  await act(async () => streams[0].error(new Error("Later transport exception")));
  expect(JSON.stringify(hook.state)).toBe(original);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(alert);
  expect(fetch).toHaveBeenCalledOnce(); expect(sign).not.toHaveBeenCalled();
});

it.each(["public", "unlisted", "private"].flatMap(visibility => ["TypeError", "AbortError"].map(name => ({ visibility, name }))))("explains uncertainty and preserves the original $visibility evidence on nonterminal $name reader rejection", async ({ visibility, name }) => {
  await start(); await frame("meta", { reportId, visibility, engine: "synthetic", mode: "offline" }); await frame("step", step);
  const original = JSON.stringify({ meta: hook.state.meta, payments: hook.state.payments, steps: hook.state.steps });
  await act(async () => streams[0].error(Object.assign(new Error("Transport interrupted"), { name })));
  expect(hook.state.status).toBe("error"); expect(hook.state.run).toBeNull();
  expect(hook.state.error).toBe(researchRecoveryCopy.interrupted);
  expect(JSON.stringify({ meta: hook.state.meta, payments: hook.state.payments, steps: hook.state.steps })).toBe(original);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("do not submit or sign again automatically");
  const link = container.querySelector('[role="alert"] a');
  expect(link?.getAttribute("href") ?? null).toBe(visibility === "private" ? null : `/dispatch/${reportId}`);
  expect(fetch).toHaveBeenCalledOnce(); expect(sign).not.toHaveBeenCalled();
});

it.each(["clean EOF", "reader rejection"])("keeps private report and claim delivery separate after %s", async ending => {
  const opened: string[] = [], states: string[] = [];
  privateHandoff = createPrivateClaimHandoff({ origin: () => "https://private.test", documentProof: () => "synthetic-document-proof",
    open: url => { opened.push(url); }, now: () => Date.parse("2026-11-07T00:00:00Z") });
  privateHandoff.subscribe(status => states.push(status));
  await act(async () => root.render(createElement(Probe)));
  const run: QueryRun = { id: reportId, question, answer: "Completed private answer", createdAt: pending.createdAt,
    engine: "synthetic", budget: 0, totalSpent: 0, totalToCreators: 0, subClaims: [], decisions: [], citations: [], trace: [] };
  await start(); await frame("done", run);
  await frame("private-run-claim", { version: 1, runId: reportId, status: "available", delivery: { version: 1,
    claimUrl: `https://private.test/claim-run#${"a".repeat(64)}`, expiresAt: "2026-11-08T00:00:00.000Z" } });
  expect(states.at(-1)).toBe("waiting");
  await act(async () => ending === "clean EOF" ? streams[0].close() : streams[0].error(new TypeError("Failed to fetch")));
  expect(hook.state.status).toBe("done"); expect(hook.state.run).toEqual(run);
  expect(states.at(-1)).toBe(ending === "clean EOF" ? "available" : "lost");
  privateHandoff.open(); privateHandoff.open();
  expect(opened).toEqual(ending === "clean EOF" ? [`https://private.test/claim-run#${"a".repeat(64)}`] : []);
  expect(JSON.stringify(hook.state)).not.toContain("claim-run#");
  expect(fetch).toHaveBeenCalledOnce(); expect(sign).not.toHaveBeenCalled();
});

it("preserves a terminal update queued in the same React batch as its transport failure", async () => {
  const run: QueryRun = { id: reportId, question, answer: "Completed in the same batch", createdAt: pending.createdAt,
    engine: "synthetic", budget: 0, totalSpent: 0, totalToCreators: 0, subClaims: [], decisions: [], citations: [], trace: [] };
  await start();
  await act(async () => {
    streams[0].enqueue(new TextEncoder().encode(`event: done\ndata: ${JSON.stringify(run)}\n\n`));
    await Promise.resolve();
    streams[0].error(new Error("Transport failed before React committed the terminal state"));
  });
  expect(hook.state.status).toBe("done"); expect(hook.state.run).toEqual(run); expect(hook.state.error).toBeNull();
  expect(fetch).toHaveBeenCalledOnce(); expect(sign).not.toHaveBeenCalled();
});

it.each(["TypeError", "AbortError"])("explains uncertainty on an initial fetch %s without fabricating a saved report or retry", async name => {
  vi.mocked(fetch).mockRejectedValueOnce(Object.assign(new Error("Transport interrupted"), { name })); await start();
  expect(hook.state.status).toBe("error"); expect(hook.state.error).toBe(researchRecoveryCopy.interrupted);
  expect(hook.state.meta).toBeNull(); expect(hook.state.run).toBeNull();
  expect(container.querySelector('[role="alert"] a')).toBeNull();
  expect(fetch).toHaveBeenCalledOnce(); expect(sign).not.toHaveBeenCalled();
});
