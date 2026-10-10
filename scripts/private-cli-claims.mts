import { randomUUID } from "node:crypto";
import { fstatSync, write, writeSync } from "node:fs";
import type { QueryRun } from "../lib/types.ts";
import { runClaimsEnabled, RunClaimError } from "../lib/run-claims/contracts.ts";
import { privateRunClaimPacketSchema, type preparePrivateRunClaim } from "../lib/run-claims/delivery.ts";

export class PrivateCliClaimError extends Error {
  constructor(readonly code: "private_claim_output_required" | "private_claim_output_unavailable") { super(code); }
}
export function parsePrivateCliClaimFd(value: string | undefined): number {
  if (!value || !/^(?:[3-9]|[1-5][0-9]|6[0-3])$/.test(value)) throw new PrivateCliClaimError("private_claim_output_unavailable");
  return Number(value);
}
interface PipeIdentity { dev: bigint; ino: bigint; type: bigint }
function privatePipeIdentity(fd: number): PipeIdentity {
  try {
    if (!Number.isInteger(fd) || fd < 3 || fd > 63) throw Error();
    if (process.platform !== "win32" && process.platform !== "linux") throw Error();
    const stat = fstatSync(fd, { bigint: true }), type = stat.mode & BigInt("0o170000");
    // Node's Windows named pipes report the FIFO mode even where isFIFO is unavailable.
    if (stat.ino <= BigInt(0) || type !== BigInt("0o010000") && type !== BigInt("0o140000")) throw Error();
    for (const publicFd of [1, 2]) {
      const publicStat = fstatSync(publicFd, { bigint: true });
      const publicType = publicStat.mode & BigInt("0o170000");
      // Windows reports distinct synthetic inodes for duplicate pipe handles.
      // Disjoint public types prove no alias there; Linux retains real inode comparison.
      const publicTypes = process.platform === "win32" ? ["0o100000", "0o020000"] : ["0o100000", "0o020000", "0o010000", "0o140000"];
      if (!publicTypes.some(value => publicType === BigInt(value))) throw Error();
      if (stat.dev === publicStat.dev && stat.ino === publicStat.ino) throw Error();
    }
    writeSync(fd, Buffer.alloc(0)); // Check write authority without exposing a payload.
    return { dev: stat.dev, ino: stat.ino, type };
  } catch { throw new PrivateCliClaimError("private_claim_output_unavailable"); }
}
type Prepared = NonNullable<Awaited<ReturnType<typeof preparePrivateRunClaim>>>;
type Status = "written" | "unavailable" | "not-applicable";

/** CLI has no authenticated owner input. Only this explicit private pipe carries a credential. */
export async function preparePrivateCliClaim(options: { env: Readonly<Record<string, string | undefined>>; fd?: number;
  prepare(runId: string): Promise<Prepared | null> }) {
  if (!runClaimsEnabled(options.env)) {
    if (options.fd !== undefined) throw new RunClaimError("claims_unavailable");
    return null;
  }
  if (options.fd === undefined) throw new PrivateCliClaimError("private_claim_output_required");
  const fd = options.fd, identity = privatePipeIdentity(fd), queryId = randomUUID();
  let prepared: Prepared;
  try { const result = await options.prepare(queryId); if (!result) throw Error(); prepared = result; }
  catch { throw new RunClaimError("claims_unavailable"); }
  let completed = false;
  return Object.freeze({ queryId, async complete(run: QueryRun): Promise<Status> {
    if (completed) return "unavailable";
    completed = true;
    try {
      const current = privatePipeIdentity(fd);
      if (current.dev !== identity.dev || current.ino !== identity.ino || current.type !== identity.type) return "unavailable";
      const packet = await prepared.complete(run);
      if (!packet) return "not-applicable";
      const value = privateRunClaimPacketSchema.parse(packet), bytes = Buffer.from(JSON.stringify(value) + "\n");
      if (bytes.length > 4096) return "unavailable";
      const beforeWrite = privatePipeIdentity(fd);
      if (beforeWrite.dev !== identity.dev || beforeWrite.ino !== identity.ino || beforeWrite.type !== identity.type) return "unavailable";
      // One bounded write attempt. Partial write, outage or lost acknowledgement never retries or reissues.
      const accepted = await new Promise<boolean>(done => {
        const timer = setTimeout(() => done(false), 5000);
        write(fd, bytes, 0, bytes.length, null, (error, count) => { clearTimeout(timer); done(!error && count === bytes.length); });
      });
      return accepted && value.status === "available" ? "written" : "unavailable";
    } catch { return "unavailable"; } // The saved answer and original payments remain usable.
  } });
}
