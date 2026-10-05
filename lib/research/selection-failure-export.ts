import { parseSelectionDiagnostic } from "./selection-diagnostic";

/** Explicit caller download. No question, provider payload, credentials or receipt claims. */
export function selectionFailureExport(value: unknown): { filename: string; text: string } | undefined {
  const diagnostic = parseSelectionDiagnostic(value);
  if (!diagnostic || diagnostic.outcome !== "refused") return;
  return {
    filename: `keryx-source-selection-failure-${diagnostic.id}.json`,
    text: JSON.stringify({ format: "keryx-research-failure-v1", outcome: "failed",
      notice: "Failure diagnostic only. Not a completed research report or payment receipt.",
      selectionDiagnostic: diagnostic }, null, 2) + "\n",
  };
}
