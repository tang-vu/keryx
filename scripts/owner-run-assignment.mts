import { openSync, readSync, closeSync, fstatSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { canonicalJson } from "../lib/canonical-json";
import { inspectStorageDeploymentManifest } from "../lib/db/runtime-storage-config";
import { storageIdentityDigest } from "../lib/db/storage-identity";
import { openVerifiedSqliteStorage } from "../lib/db/storage-identity-connection";
import { supportedSqliteApplicationProfiles } from "../lib/db/enrolled-sqlite-schema-profile";
import { createEnrolledSqliteOwnerRunAssignments } from "../lib/db/owner-run-assignments-sqlite";
import { AssignmentError, ownerActionSchema } from "../lib/owner-run-assignments/contracts";
import { assignmentDigest, parseManifest } from "../lib/owner-run-assignments/protocol";
import { authorizeLocalOwner } from "../lib/owner-run-assignments/local-owner";

/** No env loader, getDb, network, migration, discovery or automatic retry. */
function readBoundedJson(file: string, limit = 16_384): unknown {
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > limit) throw new AssignmentError("invalid_assignment_request");
    const bytes = Buffer.alloc(limit + 1); let size = 0;
    while (size < bytes.length) { const n = readSync(fd, bytes, size, bytes.length - size, size); if (!n) break; size += n; }
    if (size !== stat.size || size > limit || fstatSync(fd).mtimeMs !== stat.mtimeMs) throw new AssignmentError("invalid_assignment_request");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)).replace(/\n$/, "");
    const value: unknown = JSON.parse(text);
    if (canonicalJson(value) !== text) throw new AssignmentError("invalid_assignment_request");
    return value;
  } finally { closeSync(fd); }
}
export function ownerRunAssignmentCommand(argv: readonly string[]) {
  const verb = argv[0] && !argv[0].startsWith("--") ? argv[0] : "stage";
  const args = verb === argv[0] ? argv.slice(1) : argv;
  if (!["stage", "review-operation", "receipt", "apply", "undo", "cleanup"].includes(verb) || args.length % 2) throw new AssignmentError("invalid_assignment_request");
  const allowed = new Set(["--storage-manifest", "--identity-digest", "--input", "--consent-id", "--approve-operation-digest"]);
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || options.has(args[i]) || !args[i + 1]) throw new AssignmentError("invalid_assignment_request");
    options.set(args[i], args[i + 1]);
  }
  // Owner-only local operational surface. This is an OS capability check, not a
  // submitted username, dev role, service credential or detached consent proof.
  if (process.platform === "win32" || process.getuid?.() !== 0 || process.geteuid?.() !== 0) throw new AssignmentError("assignment_owner_required");
  const inputFile = options.get("--input"); if (!inputFile) throw new AssignmentError("invalid_assignment_request");
  const raw = readBoundedJson(inputFile);
  if (verb === "review-operation") {
    const operation = ownerActionSchema.parse(raw);
    return { operation, approvedOperationDigest: assignmentDigest("owner-operation", operation), meaning: "review-only-no-store-opened" };
  }
  const mutation = !["stage", "receipt"].includes(verb), operation = verb !== "stage" ? ownerActionSchema.parse(raw) : undefined;
  if (operation && verb !== "receipt" && operation.action !== verb) throw new AssignmentError("invalid_assignment_request");
  const capability = operation ? authorizeLocalOwner(operation, options.get("--approve-operation-digest") ?? "") : undefined;
  if (verb === "stage" && options.has("--approve-operation-digest")) throw new AssignmentError("invalid_assignment_request");
  const manifestPath = options.get("--storage-manifest"); if (!manifestPath) throw new AssignmentError("invalid_assignment_request");
  const deployment = inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: manifestPath });
  const pin = canonicalJson(deployment);
  if (deployment.backend.kind !== "sqlite" || storageIdentityDigest(deployment.identity) !== options.get("--identity-digest"))
    throw new AssignmentError("assignment_unavailable");
  const connection = openVerifiedSqliteStorage(deployment.backend.databasePath, deployment.identity, { readOnly: !mutation,
    applicationProfiles: supportedSqliteApplicationProfiles(true), runtimeGuard() {
      if (canonicalJson(inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: manifestPath })) !== pin)
        throw new AssignmentError("assignment_unavailable");
    } });
  try {
    const store = createEnrolledSqliteOwnerRunAssignments(connection.db);
    if (!store) throw new AssignmentError("assignment_unavailable");
    return operation && capability ? verb === "receipt" ? store.lookupOwner(operation, capability) : store.owner(operation, capability)
      : store.stage(parseManifest(raw), options.get("--consent-id"));
  } finally { connection.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(canonicalJson(ownerRunAssignmentCommand(process.argv.slice(2))) + "\n"); }
  catch (error) {
    process.stderr.write(canonicalJson({ error: error instanceof AssignmentError ? error.code : "assignment_unavailable",
      recovery: "Retain the exact operation ID and bytes. Uncertain outcome is unresolved; no automatic or replacement-ID retry." }) + "\n");
    process.exitCode = 1;
  }
}
