import { ACTUAL_READ_POLICY, actualReadCheckpoint, checkpointData, operandMicros, readCheck, type CheckpointOutcome, type PlannedReadAction, type ReadCheck } from "./actual-read-policy";

export const MAX_READ_CHECKPOINTS = 256;
export const MAX_READ_PACKET_BYTES = 256 * 1024;
export interface ActualReadRecord {
  sequence: number; candidate: number; round: number; proposal: PlannedReadAction | "UNKNOWN";
  plan: PlannedReadAction | "UNKNOWN"; facts: "assertions"; check: ReadCheck; outcome: CheckpointOutcome;
  amounts: { priceMicros: string | null; remainingMicros: string | null };
}
export interface ActualReadPacket {
  schema: 1; policy: typeof ACTUAL_READ_POLICY; coverage: "post-portfolio-checkpoints";
  monetaryAuthority: "qualified-assertions-only"; records: ActualReadRecord[];
}
function integer(value: unknown, max: number): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) throw Error("Invalid checkpoint index");
}
function amount(value: unknown): asserts value is string | null {
  if (value !== null && (typeof value !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(value))) throw Error("Invalid monetary assertion");
}
function record(value: unknown, sequence: number): ActualReadRecord {
  const entry = checkpointData(value, ["sequence", "candidate", "round", "proposal", "plan", "facts", "check", "outcome", "amounts"]);
  integer(entry.sequence, MAX_READ_CHECKPOINTS); integer(entry.candidate, 10000); integer(entry.round, 8);
  if (entry.sequence !== sequence || entry.facts !== "assertions" ||
      !["BUY", "SKIP", "CACHE", "UNKNOWN"].includes(entry.proposal as string) ||
      !["BUY", "SKIP", "CACHE", "UNKNOWN"].includes(entry.plan as string)) throw Error("Invalid checkpoint context");
  const check = readCheck(entry.check);
  const outcome = checkpointData(entry.outcome, ["action", "rule"]);
  const expected = actualReadCheckpoint(check);
  if (outcome.action !== expected.action || outcome.rule !== expected.rule) throw Error("Checkpoint disagreement");
  const amounts = checkpointData(entry.amounts, ["priceMicros", "remainingMicros"]);
  amount(amounts.priceMicros); amount(amounts.remainingMicros);
  if (check.kind === "budget" && (amounts.remainingMicros !== operandMicros(check.remaining) ||
    check.present && amounts.priceMicros !== operandMicros(check.price))) throw Error("Monetary assertion disagreement");
  return { sequence, candidate: entry.candidate, round: entry.round, proposal: entry.proposal as ActualReadRecord["proposal"],
    plan: entry.plan as ActualReadRecord["plan"], facts: "assertions", check, outcome: expected,
    amounts: { priceMicros: amounts.priceMicros, remainingMicros: amounts.remainingMicros } };
}

export function canonicalReadPacket(value: unknown): string {
  const packet = checkpointData(value, ["schema", "policy", "coverage", "monetaryAuthority", "records"]);
  if (packet.schema !== 1 || packet.policy !== ACTUAL_READ_POLICY || packet.coverage !== "post-portfolio-checkpoints" ||
      packet.monetaryAuthority !== "qualified-assertions-only" || !Array.isArray(packet.records) || Object.getPrototypeOf(packet.records) !== Array.prototype)
    throw Error("Unsupported checkpoint packet");
  const descriptors = Object.getOwnPropertyDescriptors(packet.records) as unknown as Record<string, PropertyDescriptor>;
  const length: unknown = descriptors.length?.value;
  integer(length, MAX_READ_CHECKPOINTS);
  if (length === 0 || Reflect.ownKeys(packet.records).length !== length + 1) throw Error("Invalid checkpoint array");
  for (let index = 0; index < length; index++)
    if (!descriptors[index] || !("value" in descriptors[index])) throw Error("Invalid checkpoint array");
  // Iterate descriptors, not getters; reject holes and unknown array properties first.
  const records = Array.from({ length }, (_, index) => record(descriptors[index].value, index));
  const canonical = JSON.stringify({ schema: 1, policy: ACTUAL_READ_POLICY, coverage: "post-portfolio-checkpoints",
    monetaryAuthority: "qualified-assertions-only", records });
  if (new TextEncoder().encode(canonical).byteLength > MAX_READ_PACKET_BYTES) throw Error("Oversized checkpoint packet");
  return canonical;
}
async function digest(canonical: string) {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function actualReadPacketHash(packet: unknown): Promise<string> { return digest(canonicalReadPacket(packet)); }
/** The expected digest is trusted separately. This creates no authority or independent attestation. */
export async function verifyActualReadPacket(packet: unknown, expectedDigest: string): Promise<boolean> {
  try {
    if (typeof expectedDigest !== "string" || !/^[a-f0-9]{64}$/.test(expectedDigest)) return false;
    const canonical = canonicalReadPacket(packet);
    return await digest(canonical) === expectedDigest && canonicalReadPacket(packet) === canonical;
  } catch { return false; }
}
