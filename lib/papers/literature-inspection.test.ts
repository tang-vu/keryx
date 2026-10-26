import { afterEach, expect, it, vi } from "vitest";
import { literatureBackupFixture } from "../../test-support/literature-backup-fixture";
import { emptyLiteratureWorkspace, MAX_LITERATURE_BYTES, serializeLiteratureWorkspace } from "./literature-workspace";
import { inspectLiterature } from "./literature-inspection";

afterEach(() => vi.unstubAllGlobals());
it("counts exact saved versions and personal screening without research or input mutation", () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const workspace = literatureBackupFixture(), backup = serializeLiteratureWorkspace(workspace);
  const result = inspectLiterature({ backup });
  expect(result).toMatchObject({
    format: "keryx-literature-inspection-v1", scope: "personal-bibliography-summary", count: 2,
    screening: { unscreened: 0, include: 1, exclude: 1, undecided: 0 },
    repositories: { arxiv: 2, openreview: 0, pmlr: 0, "acl-anthology": 0, crossref: 0 },
    publicationKinds: { preprint: 2, "journal-article": 0, "conference-paper": 0, unknown: 0 },
    metadataGaps: { missingNamedAuthors: 0, incompleteContributorList: 0, publicationYearNotRecorded: 0, doiNotRecorded: 2, venueNotRecorded: 2 },
  });
  expect(Object.values(result.screening).reduce((a, b) => a + b, 0)).toBe(2);
  expect(Object.values(result.repositories).reduce((a, b) => a + b, 0)).toBe(2);
  expect(result.notice).toContain("Missing fields remain unknown");
  expect(serializeLiteratureWorkspace(workspace)).toBe(backup); expect(fetch).not.toHaveBeenCalled();
});
it("omits private focus, notes and every individual paper identity from the summary", () => {
  const workspace = literatureBackupFixture();
  for (const entry of workspace.entries) {
    entry.paper.title = "PRIVATE_PAPER_TITLE"; entry.paper.authors = ["PRIVATE_AUTHOR"];
  }
  const output = JSON.stringify(inspectLiterature({ backup: serializeLiteratureWorkspace(workspace) }));
  expect(output).not.toContain("PRIVATE_");
  for (const entry of workspace.entries) {
    expect(output).not.toContain(entry.paper.url); expect(output).not.toContain(entry.paper.metadataUrl);
    expect(output).not.toContain(entry.paper.arxivId);
  }
});
it("keeps overlapping gaps and unknown publication metadata explicit", () => {
  const workspace = literatureBackupFixture(), [a, b] = workspace.entries;
  a.paper.authorCount = 3; a.paper.authorsTruncated = true; delete a.paper.publishedYear;
  a.paper.doi = "10.1234/synthetic"; a.paper.venue = "Recorded venue";
  b.paper.authors = []; b.paper.authorCount = 0; b.paper.authorsTruncated = false; b.paper.publicationKind = "unknown";
  a.screening = "undecided"; b.screening = "unscreened";
  expect(inspectLiterature({ backup: serializeLiteratureWorkspace(workspace) })).toMatchObject({
    count: 2, screening: { unscreened: 1, undecided: 1, include: 0, exclude: 0 },
    publicationKinds: { preprint: 1, unknown: 1, "journal-article": 0, "conference-paper": 0 },
    metadataGaps: { missingNamedAuthors: 1, incompleteContributorList: 1, publicationYearNotRecorded: 1, doiNotRecorded: 1, venueNotRecorded: 1 },
  });
});
it("counts a DOI repository and recorded journal type without certifying peer review", () => {
  const workspace = literatureBackupFixture();
  workspace.entries[1].paper = { ...workspace.entries[1].paper, repository: "crossref", arxivId: undefined,
    url: "https://doi.org/10.1234/synthetic", metadataUrl: "https://api.crossref.org/works/10.1234%2Fsynthetic",
    doi: "10.1234/synthetic", publicationKind: "journal-article" };
  const result = inspectLiterature({ backup: serializeLiteratureWorkspace(workspace) });
  expect(result.repositories).toMatchObject({ arxiv: 1, crossref: 1 });
  expect(result.publicationKinds).toMatchObject({ preprint: 1, "journal-article": 1 });
  expect(result.notice).toContain("No paper lookup, reading, peer-review");
});
it("accepts a valid empty backup and returns explicit zero counts", () => {
  const result = inspectLiterature({ backup: serializeLiteratureWorkspace(emptyLiteratureWorkspace()) });
  expect(result.count).toBe(0);
  for (const counts of [result.screening, result.repositories, result.publicationKinds, result.metadataGaps])
    expect(Object.values(counts).every(value => value === 0)).toBe(true);
});
it("bounds original UTF-8 bytes including BOM without truncation", () => {
  const backup = serializeLiteratureWorkspace(literatureBackupFixture());
  expect(inspectLiterature({ backup: "\uFEFF" + backup }).count).toBe(2);
  const padded = backup + " ".repeat(MAX_LITERATURE_BYTES - Buffer.byteLength(backup));
  expect(inspectLiterature({ backup: padded }).count).toBe(2);
  expect(() => inspectLiterature({ backup: "\uFEFF" + padded })).toThrow();
  expect(() => inspectLiterature({ backup: "🧪".repeat(MAX_LITERATURE_BYTES / 3) })).toThrow();
});
it("validates the complete strict backup and all literal reference fields before counting", () => {
  const workspace = literatureBackupFixture(), duplicate = literatureBackupFixture();
  duplicate.entries[1].paper = duplicate.entries[0].paper;
  expect(() => inspectLiterature({ backup: JSON.stringify(duplicate) })).toThrow();
  workspace.entries[1].paper.metadataUrl = " " + workspace.entries[1].paper.metadataUrl;
  expect(() => inspectLiterature({ backup: JSON.stringify(workspace) })).toThrow();
  for (const backup of ["PRIVATE_INVALID_JSON", JSON.stringify({ ...literatureBackupFixture(), owner: "PRIVATE_OWNER" })])
    expect(() => inspectLiterature({ backup })).toThrow();
  expect(() => inspectLiterature({ backup: JSON.stringify(literatureBackupFixture()), upload: "PRIVATE_TARGET" } as never)).toThrow();
});
