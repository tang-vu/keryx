// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAskStream } from "./use-ask-stream";
import { ResearchTurn } from "@/components/keryx/research-turn";

vi.mock("@/components/keryx/answer-card", () => ({ AnswerCard: () => null }));
vi.mock("@/components/keryx/report-actions", () => ({ ReportActions: () => null }));
vi.mock("@/components/keryx/reasoning-console", () => ({ ReasoningConsole: () => null }));
vi.mock("@/components/keryx/creators-paid-panel", () => ({ CreatorsPaidPanel: () => null }));
vi.mock("@/components/keryx/decision-reviews", () => ({ DecisionReviews: () => null }));

const reportId = "4eb87a1b-1d33-4381-956c-ce83c8640d2b";
let root: Root, container: HTMLDivElement;
let hook: ReturnType<typeof useAskStream>;
let streams: ReadableStreamDefaultController<Uint8Array>[];
function Probe() {
  const value = useAskStream();
  useLayoutEffect(() => { hook = value; });
  return createElement(ResearchTurn, { turn: { id: 1, question: "Synthetic original", payer: "Synthetic", state: value.state } });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  streams = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url !== "/api/ask") throw new Error("Unexpected endpoint; recovery must be a manual GET link");
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { streams.push(controller); } }));
  }));
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(Probe)); });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove(); vi.unstubAllGlobals();
});
async function start() {
  await act(async () => { void hook.ask("Synthetic original", 0); });
}
async function meta(visibility: string, index = 0) {
  await act(async () => {
    streams[index].enqueue(new TextEncoder().encode(`: keepalive\n\nevent: meta\ndata: ${JSON.stringify({ engine: "synthetic", mode: "offline", visibility, reportId })}\n\n`));
  });
}
it.each(["public", "unlisted"])("keeps a manual original GET link after a %s stream errors without another POST", async visibility => {
  await start(); await meta(visibility);
  await act(async () => { streams[0].error(new Error("network error")); });
  const link = container.querySelector("a")!;
  expect(link.getAttribute("href")).toBe(`/dispatch/${reportId}`);
  expect(link.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(link.textContent).toBe("Open saved report");
  expect(hook.state.run).toBeNull();
  expect(fetch).toHaveBeenCalledOnce();
});
it("keeps the same recovery reference when a stream ends before its terminal event", async () => {
  await start(); await meta("unlisted");
  await act(async () => { streams[0].close(); });
  expect(hook.state.status).toBe("error");
  expect(container.querySelector("a")?.getAttribute("href")).toBe(`/dispatch/${reportId}`);
  expect(fetch).toHaveBeenCalledOnce();
});
it("never offers a public recovery link for a private transport or a stopped/replaced request", async () => {
  await start(); await meta("private");
  await act(async () => { streams[0].error(new Error("network error")); });
  expect(container.querySelector("a")).toBeNull();
  await start(); await meta("unlisted", 1);
  await act(async () => { hook.reset(); });
  expect(hook.state.meta).toBeNull();
  expect(container.querySelector("a")).toBeNull();
  await act(async () => { streams[1].error(new Error("late old error")); });
  expect(hook.state.status).toBe("idle");
  expect(container.querySelector("a")).toBeNull();
});
