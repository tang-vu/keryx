import { readBibliographicOriginal, type BibliographicOriginalReader } from "./bibliographic-original";
import { readBibliographicOriginalBody } from "./bibliographic-original-reader";
import { bibliographicOriginalDeliverable } from "./bibliographic-original-text";
import { isObservedBibliographicTask, type BibliographicTask } from "./bibliographic-task-request";
import type { BibliographicOriginalRecord } from "./bibliographic-original-types";

export interface BibliographicTaskResult {
  kind: "bibliography";
  scope: "metadata-only";
  originalQuestionSha256: string;
  requestedFields: BibliographicTask["requestedFields"];
  requestedAuthorCount: BibliographicTask["requestedAuthorCount"];
  record: BibliographicOriginalRecord;
  text: string;
  bibliographyExports: ReturnType<typeof bibliographicOriginalDeliverable>["bibliographyExports"];
}

/** Separate metadata result. No model/ordinary evidence, citations, confidence,
 * attribution or payment authority is produced, including when fields are gaps. */
export async function readBibliographicTask(task: BibliographicTask,
  options: { reader?: BibliographicOriginalReader; signal?: AbortSignal } = {}): Promise<BibliographicTaskResult> {
  if (!isObservedBibliographicTask(task)) throw new Error("Unobserved bibliographic task");
  const record = await readBibliographicOriginal(task.request, options.reader ?? readBibliographicOriginalBody, options.signal);
  return { kind: "bibliography", ...bibliographicOriginalDeliverable(record), originalQuestionSha256: task.originalQuestionSha256,
    requestedFields: task.requestedFields, requestedAuthorCount: task.requestedAuthorCount, record };
}
