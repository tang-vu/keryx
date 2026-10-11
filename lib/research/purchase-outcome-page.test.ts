import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import PurchaseOutcomesPage from "../../app/purchase-outcomes/page";
import { purchaseAggregateMessages as copy } from "../../locales/en/purchase-outcome-aggregate";
import { aggregatePurchaseOutcomes, PURCHASE_AGGREGATE_COHORTS } from "./purchase-outcome-aggregate";
import { projectPurchaseOutcomes } from "./purchase-outcomes-projector";
import retained from "../../fixtures/purchase-outcomes/retained-testnet.json";
import { createElement } from "react";
import { JSDOM } from "jsdom";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./purchase-outcome-aggregate-server", async importOriginal => ({
  ...await importOriginal<typeof import("./purchase-outcome-aggregate-server")>(), readPublicPurchaseAggregate: read,
}));
vi.mock("../../components/keryx/site-header", () => ({ SiteHeader: () => null }));
vi.mock("../../components/keryx/site-footer", () => ({ SiteFooter: () => null }));
beforeEach(() => { read.mockReset(); });
const escaped = (text: string) => renderToStaticMarkup(createElement("span", null, text)).slice(6, -7);

it("renders the recorded sample, cohort/counting rules and unmeasured gates without upgrading its evidence", async () => {
  const report = projectPurchaseOutcomes(retained.snapshot, "eip155:5042002");
  const view = aggregatePurchaseOutcomes({ window: { network: report.network, since: "2026-10-01T00:00:00.000Z",
    until: "2026-10-11T00:00:00.000Z", period: "custom" }, cohorts: PURCHASE_AGGREGATE_COHORTS.map(cohort => ({
    cohort, windowRuns: cohort === "unknown" ? 101 : 0, runs: cohort === "unknown" ? [{ id: report.dispatchId,
      createdAt: report.runCreatedAt, recordedDecisions: retained.snapshot.decisions.length, decisionsWithBasis: 0, report }] : [],
  })) });
  read.mockResolvedValue(view);
  const html = renderToStaticMarkup(await PurchaseOutcomesPage({ searchParams: Promise.resolve({ network: report.network, since: "2026-10-01" }) }));
  expect(html).toContain(escaped(copy.recordedOnly));
  expect(html).toContain(escaped(copy.cohortLimit));
  expect(html).toContain("1 of 101 (newest only)");
  expect(html).toContain("0.002 test USDC");
  expect(html).toContain(escaped(copy.rows.missed[1]));
  expect(html).toContain(escaped(copy.rows.questionType[1]));
  for (const cohort of PURCHASE_AGGREGATE_COHORTS) expect(html).toContain(copy[cohort]);
  expect(html).toContain('method="get"');
  expect(html).toContain('scope="row"'); expect(html).toContain('scope="col"');
  expect(html).toContain('/api/purchase-outcomes?network=eip155%3A5042002&amp;since=2026-10-01');
  expect(html).not.toContain(report.dispatchId);
});

it("withholds figures on storage failure and refuses duplicate filters before reading", async () => {
  read.mockRejectedValue(new Error("PRIVATE storage details"));
  const unavailable = renderToStaticMarkup(await PurchaseOutcomesPage({ searchParams: Promise.resolve({}) }));
  expect(unavailable).toContain(copy.unavailable);
  expect(unavailable).not.toContain("PRIVATE"); expect(unavailable).not.toContain("<table");
  read.mockClear();
  const invalid = renderToStaticMarkup(await PurchaseOutcomesPage({ searchParams: Promise.resolve({ period: ["7d", "30d"] }) }));
  expect(invalid).toContain(copy.invalid); expect(invalid).not.toContain("<table");
  expect(read.mock.calls).toHaveLength(0);
});

it("gives each filter a unique control with its exact text-only label", async () => {
  read.mockResolvedValue(undefined);
  const html = renderToStaticMarkup(await PurchaseOutcomesPage({ searchParams: Promise.resolve({
    network: "eip155:5042002", period: "30d", since: "2026-10-01",
  }) }));
  const { document } = new JSDOM(html).window;
  const labels = [...document.querySelectorAll<HTMLLabelElement>("form label")];
  expect(labels).toHaveLength(3);
  for (const [name, text, value] of [
    ["network", copy.network, "eip155:5042002"],
    ["period", copy.period, "30d"],
    ["since", copy.since, "2026-10-01"],
  ]) {
    const matching = labels.filter(label => label.textContent === text);
    expect(matching).toHaveLength(1);
    const control = matching[0].control as HTMLSelectElement | HTMLInputElement | null;
    expect(control?.name).toBe(name);
    expect(control?.value).toBe(value);
    expect(matching[0].querySelector("input, select")).toBeNull();
    expect(document.querySelectorAll(`[id="${control?.id}"]`)).toHaveLength(1);
    expect(control?.labels).toHaveLength(1);
  }
});
