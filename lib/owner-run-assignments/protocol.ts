import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { AssignmentError, MANIFEST_BYTES, manifestSchema, type Manifest } from "./contracts";

export const assignmentDigest = (domain: string, value: unknown) => createHash("sha256")
  .update(`keryx-owner269-${domain}-v1\0`).update(canonicalJson(value)).digest("hex");
export function parseManifest(value: unknown): Manifest {
  const parsed = manifestSchema.parse(value);
  if (Buffer.byteLength(canonicalJson(parsed)) > MANIFEST_BYTES) throw new AssignmentError("invalid_assignment_request");
  return parsed;
}
