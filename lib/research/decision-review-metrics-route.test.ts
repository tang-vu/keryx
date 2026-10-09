import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { createSqliteDecisionReviews } from "../db/decision-reviews-sqlite";
import { config } from "../config";
import { decisionReviewMetricsSchema } from "./decision-review-types";
const db = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ getDb: db }));
import { GET } from "@/app/api/decision-reviews/metrics/route";
const url = "https://keryx.cc/api/decision-reviews/metrics?since=2026-10-08T00:00:00.000Z&until=2026-10-09T00:00:00.000Z";
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime("2026-10-10T12:00:00Z"); });
afterEach(() => vi.useRealTimers());
it("exposes configured-network whole-period counts without private identities, names or reasons", async () => {
  const connection = new DatabaseSync(":memory:"), store = createSqliteDecisionReviews(connection), owner = `0x${"1".repeat(40)}`;
  try {
    const record = await store.capture(owner, { policyVersion: "captured-owner-decisions-v1", engine: "synthetic", requestedModel: null,
      runId: randomUUID(), round: 0, ordinal: 0, sourceName: "PRIVATE SOURCE", modelAction: "BUY", codeAction: "SKIP", codeRule: "budget",
      terms: { assetId: "private-asset", sourceId: "private-source", owned: true, network: config.profile.networkId, payTo: owner,
        priceMicroUsdc: "1000", listPriceMicroUsdc: "1000", citationBudgetMicroUsdc: "5000" },
      reviewFirst: false, cohort: "unknown", cohortEvidence: null }, Date.parse("2026-10-08T12:00:00.000Z"));
    await store.verdict(owner, { id: record.id, key: randomUUID(), context: "opinion", expectedCode: { action: "SKIP", rule: "budget" }, value: "disagree", reason: "PRIVATE REASON" });
    db.mockResolvedValue({ decisionReviews: store }); const response = await GET(new Request(url));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const value = decisionReviewMetricsSchema.parse(await response.json());
    expect(value.network).toBe(config.profile.networkId); expect(value.cohorts[3]).toMatchObject({ decisions: 1, disagrees: 1, codeRefusals: 1, refusalReasons: { budget: 1 } });
    expect(value.cohorts[0].agreementRate).toBeNull(); expect(JSON.stringify(value)).not.toMatch(/PRIVATE|private-source|private-asset|wallet|runId|0x111|reason"/);
  } finally { connection.close(); }
});
it.each([`${url}&network=eip155:5042`, `${url}&wallet=private`, `${url}&since=2026-10-08T00:00:00.000Z`,
  url.replace("2026-10-09T00", "2026-10-11T00"), url.replace("2026-10-08T00", "2026-02-30T00")])("refuses incomplete/duplicate/foreign selectors and invalid/future periods before storage: %s", async target => {
  expect((await GET(new Request(target))).status).toBe(400); expect(db).not.toHaveBeenCalled();
});
it("refuses an unavailable/sealed ordinary capability without fabricating zero agreement", async () => {
  db.mockResolvedValue({}); const response = await GET(new Request(url));
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "review_unavailable" });
});
