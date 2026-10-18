// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { browserPaymentProfile } from "../browser-payment-profile";

vi.mock("@/components/keryx/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/keryx/site-footer", () => ({ SiteFooter: () => null }));
const visibility = vi.hoisted(() => ({ all: false }));
vi.mock("@/lib/hooks/use-visible-ledger-section", () => ({ useVisibleLedgerSection: () => [null, visibility.all] }));
import { DashboardView } from "../../components/keryx/dashboard-view";

const records = Array.from({ length: 6 }, (_, index) => ({ id: `question-${index}`, question: `Public question ${index}`,
  createdAt: `2026-10-17T00:0${6 - index}:00.000Z`, citationCount: 0, totalSpent: 0, totalToCreators: 0 }));
const pending: Array<{ finish: (response: Response) => void; signal: AbortSignal }> = [];
type DeferredRead = { path: string; finish: (response: Response) => void; signal: AbortSignal };
const criticalReads: DeferredRead[] = [], financialReads: DeferredRead[] = [];
const limits: number[] = [];
let deferCritical: boolean;
let root: Root, container: HTMLDivElement;
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const countBody = () => ({ complete: true, network: browserPaymentProfile().networkId,
  period: "all", cohort: "default", publicQuestions: 6 });
const metricsBody = { metrics: { totalQueries: 6, totalPayments: 0, totalVolumeUsdc: 0, totalCreatorPayoutsUsdc: 0,
  creatorsEarning: 0, pendingPaymentConfirmations: 0, pendingPaymentVolumeUsdc: 0,
  failedPaymentAttempts: 0, failedPaymentVolumeUsdc: 0, recordedAccounts: 2, guestQuestions: 4 }, leaderboard: [] };
const financialPaths = ["/api/metrics", "/api/payments", "/api/withdrawals"];
function latestCritical(path: string) { return criticalReads.filter(read => read.path === path).at(-1)!; }
async function finishCritical(path: string, ok = true) {
  await act(async () => latestCritical(path).finish(ok ? json(path === "/api/runs" ? records.slice(0, 4) : countBody()) : new Response(null, { status: 503 })));
}
async function mount() { await act(async () => root.render(createElement(DashboardView, { sourcePreview: null }))); }
function more() {
  const summary = [...container.querySelectorAll("summary")].find(node => node.textContent === "More questions");
  expect(summary).toBeDefined(); return summary!.parentElement as HTMLDetailsElement;
}
async function toggle(open: boolean) {
  await act(async () => { const details = more(); details.open = open; details.dispatchEvent(new Event("toggle")); });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  limits.length = 0; pending.length = 0; criticalReads.length = 0; financialReads.length = 0;
  visibility.all = false; deferCritical = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://questions.fixture");
    if (financialPaths.includes(url.pathname)) return new Promise<Response>(finish =>
      financialReads.push({ path: url.pathname, finish, signal: init!.signal! }));
    if (url.pathname === "/api/runs/summary") return deferCritical ? new Promise<Response>(finish =>
      criticalReads.push({ path: url.pathname, finish, signal: init!.signal! })) : json(countBody());
    if (url.pathname !== "/api/runs") throw new Error("Unexpected fixture request");
    expect(url.searchParams.get("network")).toBe(browserPaymentProfile().networkId);
    expect(url.searchParams.get("period")).toBe("all");
    const limit = Number(url.searchParams.get("limit")); limits.push(limit);
    if (limit === 4) return deferCritical ? new Promise<Response>(finish =>
      criticalReads.push({ path: url.pathname, finish, signal: init!.signal! })) : json(records.slice(0, 4));
    expect(limit).toBe(25);
    return new Promise<Response>(finish => pending.push({ finish, signal: init!.signal! }));
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("fetches only the four visible bodies and keeps older bodies out of the collapsed DOM", async () => {
  await mount();
  expect(limits).toEqual([4]);
  expect(financialReads).toHaveLength(0);
  expect(container.textContent).toContain("Public question 0");
  expect(container.textContent).toContain("Public question 3");
  expect(container.textContent).not.toContain("Public question 4");
  expect(more().open).toBe(false);
});

it.each(["/api/runs/summary", "/api/runs"])("shows %s first without starting visible financial reads until both initial reads settle", async first => {
  visibility.all = true; deferCritical = true;
  await mount();
  expect(criticalReads.map(read => read.path).sort()).toEqual(["/api/runs", "/api/runs/summary"]);
  expect(financialReads).toHaveLength(0);
  expect(container.textContent).not.toContain("Public question 0");
  expect(container.textContent).not.toMatch(/6 public questions on/);
  await finishCritical(first);
  expect(financialReads).toHaveLength(0);
  if (first === "/api/runs/summary") {
    expect(container.textContent).toMatch(/6 public questions on/);
    expect(container.textContent).not.toContain("Public question 0");
  } else {
    expect(container.textContent).toContain("Public question 0");
    expect(container.textContent).not.toMatch(/6 public questions on/);
  }
  await finishCritical(first === "/api/runs" ? "/api/runs/summary" : "/api/runs");
  expect(container.textContent).toContain("Public question 0");
  expect(container.textContent).toMatch(/6 public questions on/);
  expect(financialReads.map(read => read.path).sort()).toEqual([...financialPaths].sort());
});

it.each(["/api/runs/summary", "/api/runs"])("releases visible financial reads after %s fails and keeps them enabled through retry and revocation refresh", async failed => {
  visibility.all = true; deferCritical = true;
  await mount();
  await finishCritical(failed, false);
  expect(financialReads).toHaveLength(0);
  await finishCritical(failed === "/api/runs" ? "/api/runs/summary" : "/api/runs");
  expect(financialReads).toHaveLength(3);
  const firstFinancial = [...financialReads];
  const retry = [...container.querySelectorAll("button")].find(button => button.textContent === "Retry");
  expect(retry).toBeDefined();
  await act(async () => retry!.click());
  expect(criticalReads.filter(read => read.path === failed)).toHaveLength(2);
  expect(financialReads).toEqual(firstFinancial);
  expect(firstFinancial.every(read => !read.signal.aborted)).toBe(true);
  await act(async () => { for (const read of firstFinancial) read.finish(json(read.path === "/api/metrics" ? metricsBody
    : read.path === "/api/payments" ? { payments: [] } : { withdrawals: [] })); });
  await finishCritical(failed);
  expect(container.textContent).toContain("Public question 0");
  expect(container.textContent).toMatch(/6 public questions on/);
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(limits.filter(limit => limit === 4)).toHaveLength(failed === "/api/runs" ? 3 : 2);
  expect(container.textContent).toContain("Public question 0");
  expect(financialReads).toEqual(firstFinancial);
  expect(firstFinancial.every(read => !read.signal.aborted)).toBe(true);
  await finishCritical("/api/runs", false);
  expect(container.textContent).toContain("Public question 0");
  expect(container.textContent).toContain("2 recorded accounts");
  expect(financialReads).toEqual(firstFinancial);
  expect(firstFinancial.every(read => !read.signal.aborted)).toBe(true);
});

it("loads older questions on demand without hiding current questions or duplicating them", async () => {
  await mount(); await toggle(true);
  expect(limits).toEqual([4, 25]);
  expect(container.textContent).toContain("Public question 0");
  expect(container.textContent).not.toContain("Public question 4");
  await act(async () => pending[0].finish(json([{ ...records[0], id: "newer", question: "Newer than the current snapshot", createdAt: "2026-10-18T00:00:00.000Z" }, ...records])));
  expect(container.textContent).toContain("Public question 4");
  expect(container.textContent).toContain("Public question 5");
  expect(container.querySelectorAll('a[href="/dispatch/question-0"]')).toHaveLength(1);
  expect(container.textContent).not.toContain("Newer than the current snapshot");
});

it("discards collapsed older bodies, aborts a pending read, and reopens with a fresh read", async () => {
  await mount(); await toggle(true); await act(async () => pending[0].finish(json(records)));
  expect(container.textContent).toContain("Public question 4");
  await toggle(false); expect(container.textContent).not.toContain("Public question 4");
  await toggle(true); expect(limits).toEqual([4, 25, 25]);
  expect(container.textContent).not.toContain("Public question 4");
  const old = pending[1]; await toggle(false); expect(old.signal.aborted).toBe(true);
  await act(async () => old.finish(json(records))); expect(container.textContent).not.toContain("Public question 4");
  await toggle(true); await act(async () => pending[2].finish(json(records.slice(0, 4))));
  expect(container.textContent).not.toContain("Public question 4");
  expect(container.textContent).toContain("Public question 0");
});

it("keeps the short visible-question refresh while closed and stops older polling on collapse", async () => {
  await mount(); await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(limits).toEqual([4, 4]);
  await toggle(true); await act(async () => pending[0].finish(json(records)));
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(limits.filter(value => value === 4)).toHaveLength(3);
  expect(limits.filter(value => value === 25)).toHaveLength(2);
  await toggle(false); expect(pending[1].signal.aborted).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(limits.filter(value => value === 4)).toHaveLength(4);
  expect(limits.filter(value => value === 25)).toHaveLength(2);
});
