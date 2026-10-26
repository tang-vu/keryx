import { MAX_LITERATURE_BYTES, parseLiteratureWorkspace } from "./literature-workspace";
import { paperReferencesCslJson } from "./reference-export";

/** Complete caller-supplied backup, including records a later view may omit. */
export function parseValidatedLiteratureBackup(backup: string) {
  if (new TextEncoder().encode(backup).byteLength > MAX_LITERATURE_BYTES) throw new Error("Backup limit exceeded");
  const workspace = parseLiteratureWorkspace(backup.replace(/^\uFEFF/u, ""));
  // The existing bounded public projection validates all literal reference links
  // and metadata. Keep the shared reference engine and its provenance unchanged.
  paperReferencesCslJson(workspace.entries.map(entry => entry.paper));
  return workspace;
}
