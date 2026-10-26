import { z } from "zod";
import { MAX_LITERATURE_BYTES } from "./literature-workspace";
import { parseValidatedLiteratureBackup } from "./literature-backup";

export const literatureInspectionInput = z.object({ backup: z.string().max(MAX_LITERATURE_BYTES) }).strict();

/** Aggregate caller-supplied records only. Never expose private focus/notes or
 * turn saved metadata and personal screening into source evidence. */
export function inspectLiterature(input: z.infer<typeof literatureInspectionInput>) {
  const { backup } = literatureInspectionInput.parse(input);
  const workspace = parseValidatedLiteratureBackup(backup);
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
  };
}
