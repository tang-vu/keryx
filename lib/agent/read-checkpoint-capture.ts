import { createHash } from "node:crypto";
import { reviewMicros } from "../research/decision-review-types";
import { ACTUAL_READ_POLICY, type ReadCheck, type CheckpointOutcome } from "../research-audit/actual-read-policy";
import { canonicalReadPacket, MAX_READ_CHECKPOINTS, type ActualReadPacket, type ActualReadRecord } from "../research-audit/actual-read-record";

export type ReadCheckpointCapture = { status: "unavailable" } | {
  status: "available"; packet: ActualReadPacket; retainedDigest: string;
};
export interface ReadCheckpointContext {
  candidate: number; round: number; proposal: ActualReadRecord["proposal"]; plan: ActualReadRecord["plan"];
  price?: number; remaining?: number;
}
/** Existing ordinary optional port is an immutable own data property. No native fallback or IO. */
export function ordinaryCheckpointCapability(db: unknown): boolean {
  try {
    if (!db || typeof db !== "object") return false;
    const descriptor = Object.getOwnPropertyDescriptor(db, "decisionReviews");
    return !!descriptor && "value" in descriptor && !!descriptor.value && !descriptor.get && !descriptor.set;
  } catch { return false; }
}
function qualifiedMicros(value?: number): string | null {
  if (value === undefined) return null;
  try { return reviewMicros(value); } catch { return null; }
}

/** Optional capture cannot escape into agent execution, including a throwing trusted sink. */
export function createReadCheckpointCapture(enabled: boolean, sink?: (record: ActualReadRecord) => void) {
  const records: ActualReadRecord[] = [];
  let unavailable = !enabled;
  return {
    append(check: ReadCheck, outcome: CheckpointOutcome, context: ReadCheckpointContext) {
      if (unavailable) return;
      try {
        if (records.length >= MAX_READ_CHECKPOINTS) throw Error("Checkpoint capacity");
        const entry: ActualReadRecord = { sequence: records.length, candidate: context.candidate, round: context.round,
          proposal: context.proposal, plan: context.plan, facts: "assertions", check: { ...check }, outcome: { ...outcome },
          amounts: { priceMicros: qualifiedMicros(context.price), remainingMicros: qualifiedMicros(context.remaining) } };
        // A trusted observer receives a separate snapshot; it cannot rewrite the retained record.
        const observed: unknown = sink?.(structuredClone(entry));
        if (observed !== undefined) {
          // A void observer must complete synchronously. Consume any rejected promise
          // without awaiting it or letting it escape into answer/payment delivery.
          void Promise.resolve(observed).catch(() => undefined);
          throw Error("Asynchronous capture unsupported");
        }
        records.push(entry);
      } catch { unavailable = true; records.length = 0; }
    },
    finish(): ReadCheckpointCapture | undefined {
      if (!enabled) return undefined;
      try {
        if (unavailable || !records.length) return { status: "unavailable" };
        const packet: ActualReadPacket = { schema: 1, policy: ACTUAL_READ_POLICY, coverage: "post-portfolio-checkpoints",
          monetaryAuthority: "qualified-assertions-only", records };
        const canonical = canonicalReadPacket(packet);
        return { status: "available", packet: JSON.parse(canonical), retainedDigest: createHash("sha256").update(canonical).digest("hex") };
      } catch { return { status: "unavailable" }; }
    },
  };
}
