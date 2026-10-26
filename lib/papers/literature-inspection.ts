import { z } from "zod";
import { MAX_LITERATURE_BYTES, type LiteratureWorkspace } from "./literature-workspace";
import { parseValidatedLiteratureBackup } from "./literature-backup";
import { canonicalJson } from "../canonical-json";

export const literatureInspectionInput = z.object({
  backup: z.string().max(MAX_LITERATURE_BYTES),
  baselineBackup: z.string().max(MAX_LITERATURE_BYTES).optional(),
}).strict();

/** Both snapshots have passed complete backup/reference validation. Identities
 * stay local to this calculation and never enter the aggregate result. */
function compareSnapshots(before: LiteratureWorkspace, after: LiteratureWorkspace) {
  const oldByUrl = new Map(before.entries.map(entry => [entry.paper.url, entry]));
  const newByUrl = new Map(after.entries.map(entry => [entry.paper.url, entry]));
  const retainedBefore = before.entries.filter(entry => newByUrl.has(entry.paper.url)).map(entry => entry.paper.url);
  const retainedAfter = after.entries.filter(entry => oldByUrl.has(entry.paper.url)).map(entry => entry.paper.url);
  const changes = { metadataChanges: 0, metadataObservedAtChanges: 0, screeningChanges: 0, noteChanges: 0, savedAtChanges: 0 };
  for (const entry of after.entries) {
    const old = oldByUrl.get(entry.paper.url);
    if (!old) continue;
    const { metadataObservedAt: beforeObserved, ...beforeMetadata } = old.paper;
    const { metadataObservedAt: afterObserved, ...afterMetadata } = entry.paper;
    if (canonicalJson(beforeMetadata) !== canonicalJson(afterMetadata)) changes.metadataChanges++;
    if (beforeObserved !== afterObserved) changes.metadataObservedAtChanges++;
    if (old.screening !== entry.screening) changes.screeningChanges++;
    if (old.notes !== entry.notes) changes.noteChanges++;
    if (old.savedAt !== entry.savedAt) changes.savedAtChanges++;
  }
  return {
    format: "keryx-literature-comparison-v1" as const,
    beforeCount: before.entries.length, afterCount: after.entries.length,
    addedRecords: after.entries.length - retainedAfter.length,
    removedRecords: before.entries.length - retainedBefore.length,
    retainedRecords: retainedAfter.length, ...changes,
    retainedOrderChanged: retainedBefore.some((url, index) => url !== retainedAfter[index]),
    reviewFocusChanged: before.title !== after.title || before.question !== after.question,
    notice: "Records match by exact saved URL only; versions and renamed URLs are not inferred matches. Field-change counts apply only to retained records and may overlap. Metadata uses validated normalized records; personal values and recorded timestamp values compare literally. The caller selected before/after order, not timestamps. Changes establish no quality, reading, authenticity or settlement claim.",
  };
}

/** Aggregate caller-supplied records only. Never expose private focus/notes or
 * turn saved metadata and personal screening into source evidence. */
export function inspectLiterature(input: z.infer<typeof literatureInspectionInput>) {
  const { backup, baselineBackup } = literatureInspectionInput.parse(input);
  const workspace = parseValidatedLiteratureBackup(backup);
  const baseline = baselineBackup === undefined ? undefined : parseValidatedLiteratureBackup(baselineBackup);
  const screening = { unscreened: 0, include: 0, exclude: 0, undecided: 0 };
  const repositories = { arxiv: 0, openreview: 0, pmlr: 0, "acl-anthology": 0, crossref: 0 };
  const publicationKinds = { preprint: 0, "journal-article": 0, "conference-paper": 0, unknown: 0 };
  const metadataGaps = { missingNamedAuthors: 0, incompleteContributorList: 0, publicationYearNotRecorded: 0, doiNotRecorded: 0, venueNotRecorded: 0 };
  for (const entry of workspace.entries) {
    const paper = entry.paper;
    screening[entry.screening]++;
    repositories[paper.repository]++;
    publicationKinds[paper.publicationKind]++;
    if (!paper.authors.length) metadataGaps.missingNamedAuthors++;
    if (paper.authorsTruncated) metadataGaps.incompleteContributorList++;
    if (paper.publishedYear === undefined) metadataGaps.publicationYearNotRecorded++;
    if (paper.doi === undefined) metadataGaps.doiNotRecorded++;
    if (paper.venue === undefined) metadataGaps.venueNotRecorded++;
  }
  return {
    format: "keryx-literature-inspection-v1" as const, scope: "personal-bibliography-summary" as const,
    count: workspace.entries.length, screening, repositories, publicationKinds, metadataGaps,
    notice: "Counts describe saved caller-supplied records and personal screening; separate versions may overlap. Missing fields remain unknown, and gap counts may overlap. No paper lookup, reading, peer-review, withdrawal or settlement verification was performed. This summary does not replace or authenticate the backup.",
    ...(baseline === undefined ? {} : { comparison: compareSnapshots(baseline, workspace) }),
  };
}
