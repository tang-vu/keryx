import type { QueryRun } from "../types";
import { canonicalReadPacket, type ActualReadPacket } from "./actual-read-record";
import { checkpointData } from "./actual-read-policy";

export function projectReadCheckpointCapture(value: unknown) {
  try {
    if (!value || typeof value !== "object") return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, "status");
    if (!descriptor || !("value" in descriptor)) return null;
    if (descriptor.value === "unavailable") { checkpointData(value, ["status"]); return { status: "unavailable" as const }; }
    const capture = checkpointData(value, ["status", "packet", "retainedDigest"]);
    if (capture.status !== "available" || typeof capture.retainedDigest !== "string" || !/^[a-f0-9]{64}$/.test(capture.retainedDigest)) return null;
    return { status: "available" as const, packet: JSON.parse(canonicalReadPacket(capture.packet)) as ActualReadPacket,
      retainedDigest: capture.retainedDigest };
  } catch { return null; }
}

/** Missing identity or any original marker is an unknown/private disclosure boundary. */
export function ordinaryPublicCheckpointRun(run: Pick<QueryRun, "id" | "originalFulfillment">): boolean {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(run, "id");
    const id = descriptor && "value" in descriptor ? descriptor.value : undefined;
    return typeof id === "string" && id.length > 0 && id.length <= 128 && !id.startsWith("prv_") && !Object.hasOwn(run, "originalFulfillment");
  } catch { return false; }
}

/** Public pure projection: never enrich from private sidecars, native stores or owner review. */
export function projectActualReadCheckpoints(run: Pick<QueryRun, "id" | "trace" | "originalFulfillment">) {
  try {
    if (!ordinaryPublicCheckpointRun(run)) return null;
    const candidates = run.trace.filter(step => Object.hasOwn(step, "readCheckpoints"));
    if (candidates.length !== 1 || candidates[0].phase !== "done") return null;
    const descriptor = Object.getOwnPropertyDescriptor(candidates[0], "readCheckpoints");
    if (!descriptor || !("value" in descriptor)) return null;
    const capture = projectReadCheckpointCapture(descriptor.value);
    return capture?.status === "available" ? capture : null;
  } catch { return null; }
}
