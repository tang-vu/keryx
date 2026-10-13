import { allocateSplit } from "../payments/split-allocation";
import { captureBudget, captureAuthorSplit } from "../agent/economic-checkpoint-capture";
import { createReadCheckpointCapture } from "../agent/read-checkpoint-capture";
import { optimizerPacketFixture } from "./optimizer-checkpoint.test-fixture";

/** Synthetic policy control only; release corpus uses the actual runner separately. */
export function economicPacketFixture() {
  const legacy = optimizerPacketFixture();
  const collector = createReadCheckpointCapture(true, undefined, true, true);
  collector.stop("evidence", 0); collector.optimizer(() => legacy.packet.optimizer);
  const amount = 0.000001, legs = allocateSplit(amount, [0.5, 0.5]);
  collector.economic("query-budget", "portfolio", 0, 0, () => captureBudget("reserve", "portfolio", 0, [amount], amount));
  collector.economic("author-split", "authors", 1, 0, () => captureAuthorSplit(amount, [0.5, 0.5], legs));
  const capture = collector.finish();
  if (!capture || capture.status !== "available" || capture.packet.schema !== 4) throw Error("V4 fixture unavailable");
  return { ...capture, packet: capture.packet };
}
