import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { calculateDashboardMetrics } from "../db/dashboard-metrics";

const state = vi.hoisted(() => ({ metrics: null as unknown }));
vi.mock("@/lib/hooks/use-ledger-resource", () => ({ useLedgerResource: (url: string) => ({
  status: "ready", observedAt: "2026-10-14T00:00:00Z", retry: () => {}, data: url === "/api/metrics" ? state.metrics : [],
}) }));
// Site navigation/custody providers are outside this dashboard rendering regression.
vi.mock("@/components/keryx/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/keryx/site-footer", () => ({ SiteFooter: () => null }));
import { DashboardView } from "../../components/keryx/dashboard-view";

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
