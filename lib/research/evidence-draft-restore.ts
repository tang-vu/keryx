import { buildEvidenceDraft, evidenceDraftWorkspace, MAX_EVIDENCE_DRAFT_BYTES, parseEvidenceDraftRequest } from "./evidence-draft";

// A downloaded JSON file can contain indentation; the validated compact packet
// retains the existing, smaller draft limit.
export const MAX_EVIDENCE_DRAFT_BACKUP_BYTES = MAX_EVIDENCE_DRAFT_BYTES * 4;

export function prepareEvidenceDraftRestore(raw: string) {
  if (new TextEncoder().encode(raw).byteLength > MAX_EVIDENCE_DRAFT_BACKUP_BYTES) throw new Error("Draft backup is too large");
  const parsed = parseEvidenceDraftRequest(JSON.parse(raw));
  // Opening a saved request must not replay its one-shot assembly operation.
  const { assembly: _assembly, ...editable } = parsed;
  const request = { ...editable, workspace: evidenceDraftWorkspace(editable.workspace) };
  const draft = buildEvidenceDraft(request);
  return { request, summary: {
    title: request.workspace.title, papers: request.workspace.entries.length,
    reports: request.reports.length, claims: request.claims.length,
    themes: request.themes.length, excerpts: draft.excerpts.length,
    passage: Array.from(request.passage).slice(0, 240).join(""),
  } };
}

export type EvidenceDraftRestore = ReturnType<typeof prepareEvidenceDraftRestore>;
