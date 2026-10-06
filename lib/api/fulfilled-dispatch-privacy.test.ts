import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { publicQueryRun } from "../research/public-query-run";
import { syntheticFailedOriginal, syntheticFulfilledRun } from "../db/a2a-fulfillment-fixture";
import { a2aResponseFromRun, quoteFromA2aOrder, publicA2aResolution } from "../a2a/result";
import { buildResearchReceipt } from "../research-receipt";

const mocked = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocked.getDb }));
import { GET } from "@/app/api/dispatch/[id]/route";

it("serves the actual public dispatch without private fulfillment authority, preserving the original stored result", async () => {
  const fixture = syntheticFailedOriginal(), claim = { ...fixture.input, failedOrder: fixture.order };
  const completion = syntheticFulfilledRun(claim), run = completion.run;
  mocked.getDb.mockResolvedValue({ getQueryRun: vi.fn(async () => run) });
  const response = await GET(new NextRequest("https://keryx.test/api/dispatch/synthetic"), { params: Promise.resolve({ id: run.id }) });
  const projected = await response.json();
  expect(response.status).toBe(200); expect(projected.answer).toBe(run.answer);
  expect(projected.originalFulfillment).toBeUndefined(); expect(projected).toEqual(publicQueryRun(run));
  expect(run.originalFulfillment).toBeDefined();
  const originals = [run.originalFulfillment!.claimId, run.originalFulfillment!.authoritySha256,
    run.originalFulfillment!.originalFailureSha256, run.originalFulfillment!.providerLedgerSha256];
  const publicValues = [projected, a2aResponseFromRun(run, quoteFromA2aOrder(fixture.order)),
    buildResearchReceipt(run, []), publicA2aResolution({ ...fixture.order, resolution: {
      action: "fulfill_failed_original", actor: "operator-cli", reason: "verified_failed_original_fulfilled",
      resolvedAt: completion.completedAt, evidence: { executionJournalVersion: 1, paymentBoundaryCrossed: false,
        resultSaveBoundaryCrossed: true, creatorAttempts: 0, settledCreatorMicros: 0, pendingCreatorMicros: 0,
        failedCreatorMicros: 0, simulatedCreatorMicros: 0, queryRunFound: true },
      fulfillment: { claimId: claim.claimId, authoritySha256: run.originalFulfillment!.authoritySha256,
        originalFailureSha256: run.originalFulfillment!.originalFailureSha256, providerLedgerSha256: completion.providerLedgerSha256,
        runSha256: completion.runSha256 } } })];
  for (const value of publicValues) for (const privateValue of originals) expect(JSON.stringify(value)).not.toContain(privateValue);
});
