import { closeSync, constants, fstatSync, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { storageIdentityDigest, validateStorageIdentity, refuseStorage, STORAGE_DIGEST_PATTERN, type StorageIdentity } from "./storage-identity";
import { assertStorageFences, assertStorageIdentity, holdStorageTarget, insertStorageIdentity, installStorageFences,
  registerStorageCapability, assertStorageCreationParent, STORAGE_IDENTITY_TABLE } from "./storage-identity-sqlite";
import { scanFullStorageSnapshot, STORAGE_SNAPSHOT_LIMITS } from "./storage-identity-snapshot";
import type { ReviewedStorageEnrollment, StorageEnrollmentInspection, StorageProvisionReceipt } from "./storage-identity-provision";

/** The exclusive creation descriptor remains held; matching pathname alone cannot adopt a replacement. */
export function assertExclusiveCreatedTarget(createdDescriptor: number, held: ReturnType<typeof holdStorageTarget>): void {
  const created=fstatSync(createdDescriptor,{bigint:true}), admitted=fstatSync(held.descriptor,{bigint:true});
  if(created.dev!==admitted.dev||created.ino!==admitted.ino||created.birthtimeNs!==admitted.birthtimeNs) refuseStorage("target_replaced");
}

export interface StorageProvisionRequest {
  mode: "inspect" | "create" | "enroll"; file: string; identity: StorageIdentity; reviewed?: ReviewedStorageEnrollment;
}
function canonicalEvidence(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalEvidence).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonicalEvidence((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return refuseStorage("review_required");
}
/** Child-only native work: public callers use the killable provision wrapper, never this helper. */
export async function provisionStorageInChild(request: StorageProvisionRequest): Promise<StorageEnrollmentInspection | StorageProvisionReceipt> {
  const identity = validateStorageIdentity(request.identity), digest = storageIdentityDigest(identity);
  let createdDescriptor: number | undefined;
  if (!["inspect", "create", "enroll"].includes(request.mode)) refuseStorage("invalid_operation");
  // The mainnet namespace starts empty. An existing testnet store is never adopted or relabelled.
  if (identity.authorityMode === "mainnet-real" && request.mode === "enroll") refuseStorage("mainnet_fresh_storage_required");
  if (request.mode === "create") {
    assertStorageCreationParent(request.file);
    createdDescriptor = openSync(request.file, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600);
  }
  let held: ReturnType<typeof holdStorageTarget> | undefined;
  let db: DatabaseSync | undefined;
  try {
    held = holdStorageTarget(request.file);
    if (createdDescriptor !== undefined) {
      assertExclusiveCreatedTarget(createdDescriptor,held);
    }
    if (fstatSync(held.descriptor).size > STORAGE_SNAPSHOT_LIMITS.fileBytes) refuseStorage("file_limit");
    db = new DatabaseSync(request.file, { readOnly: request.mode === "inspect", allowExtension: false });
    held.verify();
    // The initial schema read can race another enroller's exclusive COMMIT
    // lock too. Bound that wait before any read, not only BEGIN IMMEDIATE.
    db.exec("PRAGMA busy_timeout=1000");
    // Inspect existing marker under a read transaction before durability settings
    // or an enrollment write lock; exact repeats return without repair or mutation.
    db.exec("BEGIN");
    let present = db.prepare("SELECT 1 FROM sqlite_schema WHERE name=?").get(STORAGE_IDENTITY_TABLE);
    if (present) {
      assertStorageIdentity(db, identity); assertStorageFences(db, identity); held.verify();
      if (request.mode === "create") refuseStorage("existing_storage");
      if (request.mode === "enroll") {
        // Exact repeat checks before any repair, provenance read, schema mutation or row rewrite.
        db.exec("ROLLBACK");
        return { format: "keryx-storage-provision-receipt-v1", status: "already_enrolled", identityDigest: digest };
      }
    }
    if (request.mode !== "inspect") {
      db.exec("ROLLBACK; PRAGMA synchronous=FULL; BEGIN IMMEDIATE");
      // Another owner may have enrolled while we acquired the exclusive write lock.
      present = db.prepare("SELECT 1 FROM sqlite_schema WHERE name=?").get(STORAGE_IDENTITY_TABLE);
      if (present) {
        assertStorageIdentity(db, identity); assertStorageFences(db, identity); held.verify();
        db.exec("ROLLBACK");
        return { format: "keryx-storage-provision-receipt-v1", status: "already_enrolled", identityDigest: digest };
      }
    }
    if (db.prepare("PRAGMA integrity_check(1)").get()?.integrity_check !== "ok") refuseStorage("integrity_failed");
    const snapshot = scanFullStorageSnapshot(db);
    if (identity.authorityMode !== "mainnet-real" && ["research_purchase_authorizations","research_monthly","research_monthly_redemptions"].some(table=>Object.hasOwn(snapshot.tableCounts,table))) snapshot.enrollmentRefusal="unsupported_table";
    const inspection: StorageEnrollmentInspection = { format: "keryx-storage-enrollment-inspection-v1",
      targetIdentityDigest: held.identity, expectedIdentityDigest: digest, ...snapshot };
    if (request.mode === "inspect") { held.verify(); db.exec("ROLLBACK"); return inspection; }
    if (request.mode === "create") {
      if (snapshot.rowCount || Object.keys(snapshot.tableCounts).length || snapshot.enrollmentRefusal) refuseStorage("creation_not_empty");
    } else {
      if (snapshot.enrollmentRefusal) refuseStorage(snapshot.enrollmentRefusal);
      const reviewed = request.reviewed;
      if (!reviewed || reviewed.format !== "keryx-reviewed-storage-enrollment-v1" ||
          reviewed.provenanceDocumentDigest !== identity.provenanceDigest || !STORAGE_DIGEST_PATTERN.test(reviewed.provenanceDocumentDigest) ||
          !Array.isArray(reviewed.unknownClassAttestation) || reviewed.unknownClassAttestation.some(value => typeof value !== "string") ||
          JSON.stringify(reviewed.unknownClassAttestation) !== JSON.stringify(snapshot.unknownClasses)) refuseStorage("review_required");
      // Compare all inspection fields, not selected-authority intake or a claimed network column.
      if (canonicalEvidence(reviewed.inspection) !== canonicalEvidence(inspection)) refuseStorage("snapshot_changed");
    }
    registerStorageCapability(db, identity, () => true);
    if (identity.authorityMode === "mainnet-real") {
      (await import("./mainnet-application-schema")).installMainnetApplicationSchema(db);
    }
    insertStorageIdentity(db, identity);
    installStorageFences(db, identity);
    assertStorageFences(db, identity);
    held.verify(); db.exec("COMMIT");
    return { format: "keryx-storage-provision-receipt-v1", status: request.mode === "create" ? "created" : "enrolled", identityDigest: digest };
  } finally {
    try { if (db) { try { db.exec("ROLLBACK"); } catch {} db.close(); } }
    finally { try { held?.close(); } finally { if (createdDescriptor !== undefined) closeSync(createdDescriptor); } }
  }
}
