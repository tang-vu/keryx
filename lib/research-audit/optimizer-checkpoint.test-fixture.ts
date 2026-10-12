import { selectEvidencePortfolio } from "../agent/evidence-portfolio";
import { captureOptimizer } from "../agent/optimizer-checkpoint-capture";
import { createReadCheckpointCapture } from "../agent/read-checkpoint-capture";
import type { Decision } from "../types";

/** Synthetic shared input only; no test registration, IO, model, provider or payment. */
export function optimizerPacketFixture() {
  const decisions: Decision[] = ["PRIVATE_é", "PRIVATE_e\u0301"].map((id, index) => ({ sourceId: id, assetId: id,
    sourceName: "PRIVATE_ACCOUNT_SENTINEL", rationale: "PRIVATE_MODEL_QUESTION_SENTINEL", confidence: 0.9,
    action: index ? "CACHE" : "BUY", price: index ? 0 : 0.000001, expectedValue: 0.8, targets: [index] }));
  const input = { decisions, claimCount: 2, attentionLimit: 2, fetchBudgetUsdc: 0.01 }, actual = selectEvidencePortfolio(input);
  const refs = new Map(decisions.map((row, index) => [row.assetId!, index + 1]));
  const checkpoint = captureOptimizer(input, actual, id => refs.get(id)!); if (checkpoint.status !== "available") throw Error("Optimizer fixture unavailable");
  const collector = createReadCheckpointCapture(true, undefined, true); collector.stop("evidence", 0); collector.optimizer(() => checkpoint);
  const capture = collector.finish(); if (!capture || capture.status !== "available" || capture.packet.schema !== 3) throw Error("V3 fixture unavailable");
  return { ...capture, packet: capture.packet };
}
