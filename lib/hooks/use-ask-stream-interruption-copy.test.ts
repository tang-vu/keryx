// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAskStream } from "./use-ask-stream";
import { ResearchTurn } from "@/components/keryx/research-turn";
import type { PaymentRecord, QueryRun, TraceStep } from "../types";

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
const sign = vi.fn(() => { throw new Error("No signing in this synthetic fixture"); });
function Probe() {
  const value = useAskStream({ getSessionWalletClient: sign });
  useLayoutEffect(() => { hook = value; });
  return createElement(ResearchTurn, { turn: { id: 1, question, payer: "Synthetic", state: value.state } });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); streams = []; sign.mockClear();
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
  await start(); await frame("error", { message: "Original terminal diagnostic <literal> {count}" }); await close();
  expect(hook.state.error).toBe("Original terminal diagnostic <literal> {count}");
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
