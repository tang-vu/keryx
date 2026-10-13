import { checkpointData } from "./actual-read-policy";
import type { ActualReadPacketV3 } from "./actual-read-v3";
import { economicCapture, type EconomicCapture } from "./economic-checkpoint";

export const ACTUAL_READ_CAPTURE_V4 = "ordinary-query-economics-v4" as const;
export type ActualReadPacketV4 = Omit<ActualReadPacketV3, "schema" | "policy" | "coverage"> & {
  schema: 4; policy: typeof ACTUAL_READ_CAPTURE_V4; coverage: "normalization-optimizer-query-economics-checkpoints"; economics: EconomicCapture;
};
export function canonicalReadPacketV4(value: unknown, legacy: (value: unknown) => string): string {
  const row = checkpointData(value, ["schema", "policy", "coverage", "monetaryAuthority", "records", "mappings", "normalizations", "portfolio", "stops", "observations", "optimizer", "economics"]);
  if (row.schema !== 4 || row.policy !== ACTUAL_READ_CAPTURE_V4 || row.coverage !== "normalization-optimizer-query-economics-checkpoints") throw Error("Unsupported economic capture");
  const { economics, ...base } = row;
  const v3 = JSON.parse(legacy({ ...base, schema: 3, policy: "ordinary-read-optimizer-v3", coverage: "normalization-optimizer-read-checkpoints" }));
  const canonical = JSON.stringify({ ...v3, schema: 4, policy: ACTUAL_READ_CAPTURE_V4, coverage: "normalization-optimizer-query-economics-checkpoints",
    economics: economicCapture(economics, v3.records.length) });
  if (new TextEncoder().encode(canonical).byteLength > 256 * 1024) throw Error("Oversized economic capture");
  return canonical;
}
