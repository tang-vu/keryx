// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://keryx.cc"}
// UNRUN actual parent-mounted controls. Intercepted metadata, no financial execution.
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ResearchJobDetails } from "../../components/keryx/research-job-details";
import { accountHistoryItem } from "../a2a/account-history";
import { a2aResearchPackage } from "../a2a/research-package";
import type { A2aOrder } from "../a2a/order";
import { ResearchCheckout } from "../../components/keryx/research-checkout";
vi.mock("wagmi", () => ({ useAccount: () => ({ address: `0x${"b".repeat(40)}`, chainId: 5042002 }), useWalletClient: () => ({ data: {} }), useSwitchChain: () => ({ switchChainAsync: vi.fn(), isPending: false }) }));
vi.mock("../../components/keryx/research-funding", () => ({ ResearchFunding: () => null }));
vi.mock("../../components/keryx/research-workspace", () => ({ useResearchWorkspace: () => ({ refresh: vi.fn(), select: vi.fn() }) }));
const id = `a2a_${"a".repeat(64)}`, wallet = `0x${"b".repeat(40)}`;
let root: Root, host: HTMLDivElement, sessionId: string;
let http: ReturnType<typeof vi.fn<typeof fetch>>;
function packet(mode: "quick" | "deep" = "quick", held = false) {
  const now = Date.now(), original = { id, queryId: id, status: held ? "running" : "failed", createdAt: new Date(now - 1000).toISOString(),
    updatedAt: new Date(now - 500).toISOString(), startedAt: new Date(now - 800).toISOString(), paymentStartedAt: new Date(now - 700).toISOString(),
    executionJournalVersion: 1, resultSavingAt: null, errorCode: held ? null : "research_failed", researchMode: mode, researchPackage: a2aResearchPackage(mode),
    amountUsdc: .05, creatorBudgetUsdc: .03, serviceFeeUsdc: .02, transaction: "synthetic-original", request: null } as A2aOrder;
  return { wallet, ownership: "authenticated_original", recoveryState: "unknown", nextCursor: null,
    jobs: [{ ...accountHistoryItem(original, now, null, held), attention: "needs_review", recoveryState: held ? "held" : "unknown" }] };
}
// Stable durable tuple across reads, including fake-clock advances.
let issuedAt: number, expiresAt: number;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionId = "c".repeat(64); issuedAt = Date.now() - 2000; expiresAt = Date.now() + 300000;
  http = vi.fn<typeof fetch>().mockImplementation(async url => String(url).includes("/auth/sessions")
    ? Response.json({ sessions: [{ id: sessionId, issuedAt, expiresAt, current: true }], truncated: false }) : Response.json(packet()));
  vi.stubGlobal("fetch", http); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function mount(queryId: string = id) { await act(async () => { root.render(createElement(ResearchJobDetails, { job: { queryId, status: "processing" } })); }); }
it.each(["quick", "deep"] as const)("actual details without original prop mounts owned failed/held %s before target", async mode => {
  const expected = packet(mode, true); http.mockImplementation(async url => String(url).includes("/auth/sessions")
    ? Response.json({ sessions: [{ id: sessionId, issuedAt, expiresAt, current: true }], truncated: false }) : Response.json(expected));
  await mount(); expect(host.textContent).toContain("NeedsReview"); expect(host.textContent).toContain("explicitly retained recovery hold");
  expect(expected.jobs[0].escalation.state).toBe("within_target"); expect(expected.jobs[0].escalation.creatorPaymentState).toBe("payment_boundary_crossed");
  expect(http.mock.calls.some(([url]) => url === `/api/me/jobs?pending=owned&id=${id}`)).toBe(true);
  expect(http.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});
it.each(["foreign", "missing", "malformed", "anonymous"])("actual parent %s reference yields no owner state or financial effect", async reason => {
  http.mockImplementation(async url => {
    if (String(url).includes("/auth/sessions")) return reason === "anonymous" ? Response.json({}, { status: 401 })
      : Response.json({ sessions: [{ id: sessionId, issuedAt, expiresAt, current: true }], truncated: false });
    return Response.json({ ...packet(), jobs: reason === "foreign" ? [{ ...packet().jobs[0], id: `a2a_${"e".repeat(64)}` }] : [] });
  });
  await mount(reason === "malformed" ? "caller-controlled" : id);
  expect(host.textContent).not.toContain("NeedsReview");
  if (reason === "malformed") expect(http).not.toHaveBeenCalled();
  expect(http.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});
it.each(["fetch", "body"])("clears stale state after stalled %s and permits the next mounted read", async kind => {
  await mount(); expect(host.textContent).toContain("NeedsReview");
  let jobReads = 0;
  http.mockImplementation(async url => {
    if (String(url).includes("/auth/sessions")) return Response.json({ sessions: [{ id: sessionId, issuedAt, expiresAt, current: true }], truncated: false });
    if (++jobReads === 1) return kind === "fetch" ? new Promise<Response>(() => {}) : new Response(new ReadableStream({ start() {} }));
    return Response.json(packet());
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(host.textContent).not.toContain("NeedsReview");
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(jobReads).toBe(2); expect(host.textContent).toContain("NeedsReview");
});
it.each(["logout", "same-wallet-replacement", "unmount"])("late body after %s cannot publish old observation", async reason => {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  http.mockImplementation(async url => String(url).includes("/auth/sessions")
    ? Response.json({ sessions: [{ id: sessionId, issuedAt, expiresAt, current: true }], truncated: false })
    : new Response(new ReadableStream({ start(controller) { body = controller; } })));
  await mount();
  if (reason === "logout") await act(async () => { window.dispatchEvent(new CustomEvent("keryx:auth", { detail: "signed-out" })); });
  if (reason === "same-wallet-replacement") sessionId = "d".repeat(64);
  if (reason === "unmount") await act(async () => { root.render(null); });
  await act(async () => { try { body.enqueue(new TextEncoder().encode(JSON.stringify(packet()))); body.close(); } catch { /* Real reader cancellation already closed this body. */ } });
  expect(host.textContent).not.toContain("NeedsReview");
  expect(http.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});

it.each(["focus", "logout", "broadcast"])("real checkout ownership is optional, separate, and invalidated by %s", async reason => {
  let broadcast: (() => void) | undefined;
  vi.stubGlobal("BroadcastChannel", class { set onmessage(handler: () => void) { broadcast = handler; } close() {} });
  http.mockImplementation(async url => String(url).endsWith("/sessions")
    ? Response.json({ sessions: [{ id: sessionId, issuedAt, expiresAt, current: true }], truncated: false })
    : Response.json({ session: { address: wallet, role: "asker" } }));
  await act(async () => { root.render(createElement(ResearchCheckout, { question: "Synthetic new job", mode: "quick", budget: .03, version: "1.0.0", total: .05, payee: `0x${"e".repeat(40)}` })); });
  const review = Array.from(host.querySelectorAll("button")).find(button => /review/i.test(button.textContent ?? ""))!;
  await act(async () => { review.click(); });
  const boxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  expect(boxes).toHaveLength(2); expect(boxes[0].checked).toBe(false); expect(boxes[1].checked).toBe(false);
  expect(host.textContent).toContain(wallet); expect(host.textContent).toContain("separate from payment and wallet consent");
  await act(async () => { boxes[1].click(); });
  expect(boxes[1].checked).toBe(true); expect(boxes[0].checked).toBe(false);
  await act(async () => {
    if (reason === "focus") window.dispatchEvent(new Event("focus"));
    else if (reason === "logout") window.dispatchEvent(new CustomEvent("keryx:auth", { detail: "signed-out" }));
    else broadcast!();
  });
  expect(boxes[1].checked).toBe(false); expect(boxes[1].disabled).toBe(true);
  expect(http.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});
