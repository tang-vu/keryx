import { expect, it } from "vitest";
import { literatureBackupFixture } from "../../test-support/literature-backup-fixture";
import { emptyLiteratureWorkspace, MAX_LITERATURE_BYTES, serializeLiteratureWorkspace, type LiteratureWorkspace } from "./literature-workspace";
import { inspectLiterature } from "./literature-inspection";

function compare(before: LiteratureWorkspace, after: LiteratureWorkspace) {
  return inspectLiterature({ backup: serializeLiteratureWorkspace(after), baselineBackup: serializeLiteratureWorkspace(before) }).comparison!;
}
function newVersion(entry: LiteratureWorkspace["entries"][number]) {
  const copy = structuredClone(entry), arxivId = copy.paper.arxivId!.replace(/v\d+$/u, "v98");
  copy.paper = { ...copy.paper, arxivId, url: `https://arxiv.org/abs/${arxivId}`, metadataUrl: `https://export.arxiv.org/api/query?id_list=${arxivId}` };
  return copy;
}
it("preserves single-backup output and compares identical snapshots without phantom changes", () => {
  const before = literatureBackupFixture(), backup = serializeLiteratureWorkspace(before);
  const original = inspectLiterature({ backup });
  expect(original).not.toHaveProperty("comparison");
  expect(inspectLiterature({ backup, baselineBackup: undefined })).toEqual(original);
  expect(compare(before, before)).toMatchObject({
    format: "keryx-literature-comparison-v1", beforeCount: 2, afterCount: 2,
    addedRecords: 0, removedRecords: 0, retainedRecords: 2, metadataChanges: 0, metadataObservedAtChanges: 0,
    screeningChanges: 0, noteChanges: 0, savedAtChanges: 0, retainedOrderChanged: false, reviewFocusChanged: false,
  });
  expect(serializeLiteratureWorkspace(before)).toBe(backup);
});
it("counts exact retained-record field changes separately from additions and removals", () => {
  const before = literatureBackupFixture(), after = structuredClone(before);
  after.entries = [after.entries[1], newVersion(after.entries[1])];
  const retained = after.entries[0];
  retained.paper.title = "PRIVATE_CHANGED_TITLE"; retained.paper.metadataObservedAt = "2026-10-25T00:00:00Z";
  retained.screening = "include"; retained.notes = "PRIVATE_CHANGED_NOTE"; retained.savedAt = "2026-10-24T00:00:00Z";
  after.question = "PRIVATE_CHANGED_QUESTION";
  expect(compare(before, after)).toMatchObject({ beforeCount: 2, afterCount: 2, addedRecords: 1, removedRecords: 1, retainedRecords: 1,
    metadataChanges: 1, metadataObservedAtChanges: 1, screeningChanges: 1, noteChanges: 1, savedAtChanges: 1,
    retainedOrderChanged: false, reviewFocusChanged: true });
  expect(before.entries[1].screening).toBe("exclude"); expect(before.entries[1].notes).toBe("PRIVATE_OTHER_NOTES");
});
it("does not call timestamp-only edits bibliographic metadata changes", () => {
  const before = literatureBackupFixture(), after = structuredClone(before);
  after.entries[0].paper.metadataObservedAt = "2026-10-25T00:00:00Z";
  after.entries[0].savedAt = "2026-10-25T01:00:00Z";
  expect(compare(before, after)).toMatchObject({ metadataChanges: 0, metadataObservedAtChanges: 1, savedAtChanges: 1,
    addedRecords: 0, removedRecords: 0, retainedRecords: 2, noteChanges: 0, screeningChanges: 0, reviewFocusChanged: false });
});
it("tracks only the relative order of retained URLs, without counting insertions as reorders", () => {
  const before = literatureBackupFixture(), after = structuredClone(before);
  after.entries.unshift(newVersion(after.entries[1]));
  expect(compare(before, after)).toMatchObject({ addedRecords: 1, removedRecords: 0, retainedRecords: 2, retainedOrderChanged: false });
  after.entries.reverse();
  expect(compare(before, after)).toMatchObject({ addedRecords: 1, retainedRecords: 2, retainedOrderChanged: true });
});
it("does not infer a match between versions, and uses caller order rather than timestamps", () => {
  const before = literatureBackupFixture(), after = structuredClone(before);
  after.entries[1] = newVersion(after.entries[1]); after.entries[1].savedAt = "2020-01-01T00:00:00Z";
  expect(compare(before, after)).toMatchObject({ addedRecords: 1, removedRecords: 1, retainedRecords: 1, metadataChanges: 0, savedAtChanges: 0 });
  const empty = emptyLiteratureWorkspace();
  expect(compare(empty, after)).toMatchObject({ beforeCount: 0, afterCount: 2, addedRecords: 2, removedRecords: 0, retainedRecords: 0 });
  expect(compare(after, empty)).toMatchObject({ beforeCount: 2, afterCount: 0, addedRecords: 0, removedRecords: 2, retainedRecords: 0 });
  expect(compare(empty, empty)).toMatchObject({ beforeCount: 0, afterCount: 0, addedRecords: 0, removedRecords: 0, reviewFocusChanged: false });
});
it("compares validated metadata rather than JSON property order or schema-trimmed whitespace", () => {
  const before = literatureBackupFixture(), after = structuredClone(before);
  after.entries[0].paper.title = "  " + after.entries[0].paper.title + "  ";
  const reordered = JSON.stringify({ entries: after.entries, question: after.question, title: after.title, scope: after.scope, version: after.version });
  const result = inspectLiterature({ backup: reordered, baselineBackup: serializeLiteratureWorkspace(before) });
  expect(result.comparison).toMatchObject({ metadataChanges: 0, metadataObservedAtChanges: 0, retainedOrderChanged: false, noteChanges: 0 });
  after.entries[0].notes += "\n"; after.question += " ";
  expect(compare(before, after)).toMatchObject({ metadataChanges: 0, noteChanges: 1, reviewFocusChanged: true });
});
it("bounds and validates the entire baseline, including BOM, even when current backup is empty", () => {
  const backup = serializeLiteratureWorkspace(emptyLiteratureWorkspace()), raw = serializeLiteratureWorkspace(literatureBackupFixture());
  const padded = raw + " ".repeat(MAX_LITERATURE_BYTES - Buffer.byteLength(raw));
  expect(inspectLiterature({ backup, baselineBackup: padded }).comparison?.removedRecords).toBe(2);
  expect(inspectLiterature({ backup, baselineBackup: "\uFEFF" + raw }).comparison?.removedRecords).toBe(2);
  const duplicate = literatureBackupFixture(); duplicate.entries[1].paper = duplicate.entries[0].paper;
  for (const baselineBackup of ["", "PRIVATE_INVALID_BASELINE", "\uFEFF" + padded, JSON.stringify(duplicate),
    "🧪".repeat(MAX_LITERATURE_BYTES / 3)]) expect(() => inspectLiterature({ backup, baselineBackup })).toThrow();
  const invalid = literatureBackupFixture(); invalid.entries[1].paper.metadataUrl = " " + invalid.entries[1].paper.metadataUrl;
  expect(() => inspectLiterature({ backup, baselineBackup: JSON.stringify(invalid) })).toThrow();
});
it("never returns private values or identities from either snapshot", () => {
  const before = literatureBackupFixture(), after = structuredClone(before);
  before.title = "PRIVATE_BEFORE_TITLE"; after.title = "PRIVATE_AFTER_TITLE";
  before.entries[0].notes = "PRIVATE_BEFORE_NOTE"; after.entries[0].notes = "PRIVATE_AFTER_NOTE";
  after.entries[1] = newVersion(after.entries[1]);
  const output = JSON.stringify(inspectLiterature({ backup: serializeLiteratureWorkspace(after), baselineBackup: serializeLiteratureWorkspace(before) }));
  expect(output).not.toContain("PRIVATE_"); expect(output).not.toContain("https://");
  for (const entry of [...before.entries, ...after.entries]) {
    expect(output).not.toContain(entry.paper.title); expect(output).not.toContain(entry.paper.arxivId);
  }
});
