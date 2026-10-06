import { expect, it } from "vitest";
import { decideOperatorCycle } from "./decision";
import { inventory, liquidity, NOW } from "./fixtures.test-support";

const decide = (i: unknown = inventory, l: typeof liquidity | null = liquidity) =>
  decideOperatorCycle({ inventory: i, liquidity: l, nowMs: NOW });
it("admits capacity at exact micro-USDC equality without authorizing a signature", () => {
  expect(decide(inventory, { ...liquidity, availableMicroUsdc: "60000", lifetimeCapMicroUsdc: "70000" }))
    .toMatchObject({ action: "run-next", reason: "liquidity-covered" });
});
it("retains pending exposure and holds one micro-USDC short", () => {
  expect(decide(inventory, { ...liquidity, availableMicroUsdc: "59999" })).toMatchObject({ action: "hold", reason: "liquidity-short" });
});
it.each([
  { queryCapMicroUsdc: "49999" }, { lifetimeCapMicroUsdc: "69999" }, { confirmedMicroUsdc: "20001" },
])("refuses original policy/accounting mismatch %j", change => {
  expect(decide(inventory, { ...liquidity, ...change }).reason).toBe("policy-cap");
});
it.each([null, { ...liquidity, availableMicroUsdc: "1e6" }, { ...liquidity, availableMicroUsdc: "-1" },
  { ...liquidity, availableMicroUsdc: "9007199254740992" }])("unknown/noncanonical capacity is held", value => {
  expect(decide(inventory, value).reason).toBe("liquidity-unavailable");
});
it.each([null, { ...inventory, invalidJobs: 1 }, { ...inventory, observedAt: new Date(NOW+1).toISOString() },
  { ...inventory, observedAt: new Date(NOW-30_001).toISOString() }, { ...inventory, queuedCreatorMicroUsdc: "0.05" }])("refuses incomplete/stale inventory", value => {
  expect(decide(value).reason).toBe("incomplete-inventory");
});
it("never buys again for a started or ambiguous original", () => {
  expect(decide({ ...inventory, processingJobs: 1, unfinishedCreatorMicroUsdc: "50000" }, null).reason).toBe("another-job-active");
  expect(decide({ ...inventory, reviewRequiredJobs: 1, unfinishedCreatorMicroUsdc: "50000" }, null).reason).toBe("original-job-needs-review");
});
it("protects unredeemed Monthly requests without adding their revenue again", () => {
  const prepaid = { ...inventory, queuedJobs: 0, queuedCreatorMicroUsdc: "0", prepaidRequests: 4, prepaidCreatorMicroUsdc: "200000" };
  expect(decide(prepaid).reason).toBe("liquidity-short");
  expect(decide(prepaid, { ...liquidity, availableMicroUsdc: "210000" })).toMatchObject({ action: "idle", liquidity: "covered" });
  expect(decide({ ...prepaid, queuedJobs: 1, queuedCreatorMicroUsdc: "50000" }, { ...liquidity, availableMicroUsdc: "259999" }).reason).toBe("liquidity-short");
});
it("idle and finite acceptance do not need capacity", () => {
  expect(decide({ ...inventory, queuedJobs: 0, queuedCreatorMicroUsdc: "0", largestCreatorMicroUsdc: "0" }, null).reason).toBe("no-orders");
  expect(decideOperatorCycle({ inventory, liquidity, nowMs: NOW, acceptancePaused: true }).reason).toBe("acceptance-paused");
});
