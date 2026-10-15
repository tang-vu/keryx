// @vitest-environment jsdom
// UNRUN mounted failure fixture. No provider, payment or recovery execution.
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AccountJobs } from "../../components/keryx/account-jobs";
import { paidJobEscalation } from "./overdue-status";
import { accountHistoryItem } from "./account-history";
import { a2aResearchPackage } from "./research-package";
import type { A2aOrder } from "./order";

let root: Root | undefined, host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove(); root = undefined; host = undefined;
  vi.unstubAllGlobals(); vi.useRealTimers();
});
it.each(["quick", "deep"] as const)("mounts NeedsReview before the %s target without promoting uncertain payment", async mode => {
  vi.useFakeTimers();
  const created = Date.now() - 1000, id = `a2a_${"a".repeat(64)}`;
  const original = { id, queryId: id, status: "failed", createdAt: new Date(created).toISOString(),
    updatedAt: new Date(created + 500).toISOString(), startedAt: new Date(created + 100).toISOString(),
    paymentStartedAt: new Date(created + 200).toISOString(), resultSavingAt: null, executionJournalVersion: 1,
    errorCode: "research_failed", researchMode: mode, researchPackage: a2aResearchPackage(mode),
    creatorBudgetUsdc: 0.03, request: { network: "eip155:5042" } } as A2aOrder;
  const escalation = paidJobEscalation(original, created + 1000, null);
  expect(escalation.state).toBe("within_target"); expect(escalation.creatorPaymentState).toBe("payment_boundary_crossed");
  expect(escalation.acceptedAt).toBe(original.createdAt);
  expect(escalation.targetCompletionMs).toBe(mode === "quick" ? 180000 : 300000);
  const packet = { wallet: `0x${"a".repeat(40)}`, ownership: "authenticated_original", recoveryState: "unknown", nextCursor: null,
    jobs: [{ ...accountHistoryItem(original, created + 1000, null), attention: "needs_review", recoveryState: "unknown" }] };
  const current = { id: "c".repeat(64), issuedAt: created - 1000, expiresAt: created + 300000, current: true };
  const selectedUrl = `/api/me/jobs?pending=owned&id=${id}`;
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async url => {
    if (url === "/api/auth/sessions") return Response.json({ sessions: [current], truncated: false });
    if (url === selectedUrl) return Response.json(packet);
    throw new Error("Unexpected mounted metadata endpoint");
  });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(createElement(AccountJobs, { orderId: id })); });
  expect(host.textContent).toContain("NeedsReview"); expect(host.textContent).toContain("payment state remains unchanged");
  expect(host.textContent).toContain("Recovery evidence is unknown");
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/auth/sessions", selectedUrl, "/api/auth/sessions"]);
  expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  expect(host.querySelector("[data-owned-job]")?.getAttribute("data-owned-job")).toBe(id);
  expect(escalation.creatorPaymentState).toBe("payment_boundary_crossed");
});

it("never calls unknown recovery a hold and clears stale owner observations on refusal", async () => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const id = `a2a_${"b".repeat(64)}`;
  const now = Date.now(), original = { id, queryId: id, status: "running", createdAt: new Date(now - 1000).toISOString(),
    updatedAt: new Date(now - 500).toISOString(), startedAt: null, paymentStartedAt: null, resultSavingAt: null,
    executionJournalVersion: null, errorCode: null, researchMode: "quick", researchPackage: a2aResearchPackage("quick"),
    creatorBudgetUsdc: 0.03, request: null } as A2aOrder;
  const packet = { wallet: `0x${"a".repeat(40)}`, ownership: "authenticated_original", recoveryState: "unknown", nextCursor: null,
    jobs: [{ ...accountHistoryItem(original, now, null), attention: "unknown", recoveryState: "unknown" }] };
  expect(packet.jobs[0].escalation.creatorPaymentState).toBe("unknown");
  const current = { id: "d".repeat(64), issuedAt: now - 2000, expiresAt: now + 300000, current: true };
  const selectedUrl = `/api/me/jobs?pending=owned&id=${id}`;
  let jobReads = 0;
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async url => {
    if (url === "/api/auth/sessions") return Response.json({ sessions: [current], truncated: false });
    if (url === selectedUrl) return ++jobReads === 1 ? Response.json(packet) : Response.json({ error: "session ended" }, { status: 401 });
    throw new Error("Unexpected mounted metadata endpoint");
  });
  vi.stubGlobal("fetch", fetch);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(createElement(AccountJobs, { orderId: id })); });
  // The final session read is reached only after the bounded owned packet parses.
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/auth/sessions", selectedUrl, "/api/auth/sessions"]);
  expect(host.textContent).not.toContain("NeedsReview"); expect(host.textContent).not.toContain("hold");
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(jobReads).toBe(2);
  expect(host.textContent).toBe("");
});
