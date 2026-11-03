import assert from "node:assert/strict";
import test from "node:test";
import { estimateContainerCost, estimateMigrationMonth } from "../src/cost-estimate.mjs";

test("a sleeping container consumes no running resource budget", () => {
  const value = estimateContainerCost({ hours: 0, memoryGiB: 1, diskGB: 4, activeVcpu: 0.25 });
  assert.equal(value.memoryUsd + value.cpuUsd + value.diskUsd, 0);
});

test("the proposed twenty-hour pilot fits the published included container quantities", () => {
  const value = estimateContainerCost({ hours: 20, memoryGiB: 1, diskGB: 4, activeVcpu: 0.25, included: true });
  assert.equal(value.memoryUsd + value.cpuUsd + value.diskUsd, 0);
});

test("the estimate conservatively retains costs when another project uses included allowances", () => {
  const value = estimateMigrationMonth();
  assert.ok(value.baseAndContainerUsd > 6.6 && value.baseAndContainerUsd < 6.7);
  assert.equal(value.hardSpendingCap, false);
  assert.throws(() => estimateContainerCost({ hours: Infinity, memoryGiB: 1, diskGB: 4, activeVcpu: 0.25 }));
  assert.throws(() => estimateContainerCost({ hours: -1, memoryGiB: 1, diskGB: 4, activeVcpu: 0.25 }));
});
