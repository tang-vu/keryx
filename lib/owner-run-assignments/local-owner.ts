import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { AssignmentError, type OwnerAction } from "./contracts";
import { assignmentDigest } from "./protocol";

declare const localOwner: unique symbol;
export type LocalOwnerAuthorization = { readonly [localOwner]: true };
const authorizations = new WeakMap<object, string>();
function assertOwnerProcess(): void {
  if (process.platform === "win32" || typeof process.getuid !== "function" || typeof process.geteuid !== "function"
    || process.getuid() !== 0 || process.geteuid() !== 0 || !process.argv[1]
    || realpathSync(process.argv[1]) !== realpathSync(resolve("scripts/owner-run-assignment.mts")))
    throw new AssignmentError("assignment_owner_required");
}
/** Trusted local OS capability, deliberately unavailable to HTTP/server processes,
 * Windows, API keys, role JWTs and user-entered owner names. No key is created.
 * Deployment operator must explicitly invoke this exact script as POSIX uid 0.
 * It authorizes only the reviewed complete operation digest for this invocation. */
export function authorizeLocalOwner(input: OwnerAction, approvedDigest: string): LocalOwnerAuthorization {
  assertOwnerProcess();
  if (approvedDigest !== assignmentDigest("owner-operation", input)) throw new AssignmentError("assignment_owner_required");
  const capability = Object.freeze({}) as LocalOwnerAuthorization;
  authorizations.set(capability, approvedDigest);
  return capability;
}
export function assertLocalOwner(capability: LocalOwnerAuthorization, input: OwnerAction): string {
  assertOwnerProcess();
  const digest = authorizations.get(capability);
  if (!digest || digest !== assignmentDigest("owner-operation", input)) throw new AssignmentError("assignment_owner_required");
  return digest;
}
