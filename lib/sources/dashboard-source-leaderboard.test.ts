import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { calculateDashboardMetrics } from "../db/dashboard-metrics";

const state = vi.hoisted(() => ({ metrics: null as unknown, history: [] as unknown[] | null, historyStatus: "ready",
  publicCount: 0 as number | null, publicCountStatus: "ready", requests: [] as string[] }));
vi.mock("@/lib/hooks/use-ledger-resource", () => ({ useLedgerResource: (url: string) => {
  state.requests.push(url);
  const summary = url.startsWith("/api/runs/summary"), history = url.startsWith("/api/runs?");
  return { status: summary ? state.publicCountStatus : history ? state.historyStatus : "ready", observedAt: "2026-10-14T00:00:00Z", retry: () => {},
    data: url === "/api/metrics?view=dashboard" ? state.metrics : summary ? state.publicCount === null ? null : { publicQuestions: state.publicCount } : history ? state.history : [] };
} }));
// Site navigation/custody providers are outside this dashboard rendering regression.
vi.mock("@/components/keryx/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/keryx/site-footer", () => ({ SiteFooter: () => null }));
import { DashboardView } from "../../components/keryx/dashboard-view";
import { browserPaymentProfile } from "../browser-payment-profile";

beforeEach(() => {
  state.metrics = { metrics: { ...calculateDashboardMetrics([], []), totalQueries: 156 }, leaderboard: [] };
  state.history = []; state.historyStatus = "ready"; state.requests = [];
  state.publicCount = 0; state.publicCountStatus = "ready";
});

it("distinguishes recorded activity from an empty current-network public listing", () => {
  const html = renderToStaticMarkup(createElement(DashboardView, { sourcePreview: null }));
  expect(html).toContain("156");
  expect(html).toContain("Recent public questions");
  expect(html).toContain("Recorded totals cover all saved activity in this database");
  expect(html).toContain("public questions on");
  expect(html).toContain("No public questions to display.");
  expect(html).not.toContain("No dispatches yet");
  expect(state.requests).toContain("/api/metrics?view=dashboard");
  const url = new URL(state.requests.find(url => url.startsWith("/api/runs"))!, "https://keryx.invalid");
  expect(url.searchParams.get("network")).toBe(browserPaymentProfile().networkId);
  expect(url.searchParams.get("period")).toBe("all");
  expect(url.searchParams.get("limit")).toBe("4");
  expect(url.searchParams.has("archive")).toBe(false);
});

it("uses the complete public population and refuses to turn an unavailable count into zero", () => {
  state.publicCount = 123;
  state.history = [{ id: "one-row", question: "One row in this public page", createdAt: "2026-10-14T00:00:00Z", citationCount: 0, totalSpent: 0, totalToCreators: 0 }];
  const ready = renderToStaticMarkup(createElement(DashboardView, { sourcePreview: null }));
  expect(ready).toContain(">123</span> public questions on");
  expect(ready).toContain(">156</span> recorded questions");
  state.publicCount = null; state.publicCountStatus = "error";
  const failed = renderToStaticMarkup(createElement(DashboardView, { sourcePreview: null }));
  expect(failed).toContain("Public question count unavailable");
  expect(failed).not.toContain(">0</span> public questions on");
  expect(failed).toContain("One row in this public page");
});

it("shows available public questions and distinguishes a failed history read from an empty one", () => {
  state.history = [{ id: "public-question", question: "Published research question", createdAt: "2026-10-14T00:00:00Z",
    citationCount: 2, totalSpent: 0, totalToCreators: 0 }];
  const html = renderToStaticMarkup(createElement(DashboardView, { sourcePreview: null }));
  expect(html).toContain("Published research question");
  expect(html).toContain('href="/dispatch/public-question"');
  expect(html).not.toContain("No public questions to display.");
  state.history = null; state.historyStatus = "error";
  const failed = renderToStaticMarkup(createElement(DashboardView, { sourcePreview: null }));
  expect(failed).toContain("Question records unavailable");
  expect(failed).not.toContain("No public questions to display.");
});

it("mounts the source leaderboard with zero creator earnings and zero cash-outs", () => {
  state.metrics = { metrics: calculateDashboardMetrics([], []), leaderboard: [], sourceLeaderboard: {
    catalogStatus: "ready", operatingFeesStatus: "ready", operatingFeeNetwork: "eip155:5042", rows: [{
      sourceId: "public:zero", sourceName: "Zero activity catalog source", href: "https://public.example/", kind: "public-reference",
      creatorEarnedUsdc: 0, citationCount: 0, paymentCount: 0, operatingFeeUsdc: 0, operatingFeeCitationCount: 0,
      operatingFeePaymentCount: 0, feeBeneficiaries: [],
    }],
  } };
  const html = renderToStaticMarkup(createElement(DashboardView, { sourcePreview: null }));
  expect(html).toContain("source leaderboard");
  expect(html).toContain('data-source-id="public:zero"');
  expect(html).toContain("Zero activity catalog source");
});
