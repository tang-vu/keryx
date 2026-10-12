import { checkpointData } from "./actual-read-policy";
import type { ActualReadPacketV2 } from "./actual-read-v2";
import { optimizerCheckpoint, type OptimizerCheckpoint } from "./optimizer-checkpoint";

export const ACTUAL_READ_CAPTURE_V3 = "ordinary-read-optimizer-v3" as const;
export type ActualReadPacketV3 = Omit<ActualReadPacketV2, "schema" | "policy" | "coverage"> & {
  schema: 3; policy: typeof ACTUAL_READ_CAPTURE_V3; coverage: "normalization-optimizer-read-checkpoints"; optimizer: OptimizerCheckpoint;
};
export function canonicalReadPacketV3(value: unknown, legacy: (value: unknown) => string): string {
  const row = checkpointData(value, ["schema", "policy", "coverage", "monetaryAuthority", "records", "mappings", "normalizations", "portfolio", "stops", "observations", "optimizer"]);
  if (row.schema !== 3 || row.policy !== ACTUAL_READ_CAPTURE_V3 || row.coverage !== "normalization-optimizer-read-checkpoints") throw Error("Unsupported optimizer capture");
  const { optimizer, ...base } = row;
  const v2 = JSON.parse(legacy({ ...base, schema: 2, policy: "ordinary-read-capture-v2", coverage: "normalization-and-read-checkpoints" }));
  const canonical = JSON.stringify({ ...v2, schema: 3, policy: ACTUAL_READ_CAPTURE_V3, coverage: "normalization-optimizer-read-checkpoints", optimizer: optimizerCheckpoint(optimizer) });
  if (new TextEncoder().encode(canonical).byteLength > 256 * 1024) throw Error("Oversized optimizer capture"); return canonical;
}
