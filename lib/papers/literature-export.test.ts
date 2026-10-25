import { afterEach, expect, it, vi } from "vitest";
import { literatureBackupFixture } from "../../test-support/literature-backup-fixture";
import { exportLiterature } from "./literature-export";
import { MAX_LITERATURE_BYTES, serializeLiteratureWorkspace } from "./literature-workspace";
import { paperReferencesBibtex, paperReferencesCslJson, paperReferencesRis } from "./reference-export";

afterEach(() => vi.unstubAllGlobals());
it.each(["bibtex", "ris", "csl-json"] as const)("exports only exact saved metadata in %s, with stable versions and no private review fields", format => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const workspace = literatureBackupFixture(), backup = serializeLiteratureWorkspace(workspace);
  const result = exportLiterature({ backup, format });
  const papers = workspace.entries.map(entry => entry.paper);
  const expected = format === "bibtex" ? paperReferencesBibtex(papers) : format === "ris" ? paperReferencesRis(papers) : paperReferencesCslJson(papers);
  expect(result).toEqual({ format, scope: "bibliography-only", ...expected }); expect(result.count).toBe(2);
  expect(result.content).toContain("Peer review unknown"); expect(result.content).not.toContain("PRIVATE_");
  expect(result.content).toContain(papers[1].arxivId); expect(JSON.stringify(workspace)).toBe(backup);
  expect(fetch).not.toHaveBeenCalled();
});
it("filters only by explicit saved screening state, including valid empty outputs", () => {
  const backup = serializeLiteratureWorkspace(literatureBackupFixture());
  const result = exportLiterature({ backup: "\uFEFF" + backup, format: "csl-json", screening: "exclude" });
  expect(result.count).toBe(1); expect(JSON.parse(result.content)[0].archive_location).toMatch(/v99$/);
  expect(exportLiterature({ backup, format: "csl-json", screening: "undecided" })).toMatchObject({ count: 0, content: "[]\n" });
  expect(exportLiterature({ backup, format: "ris", screening: "unscreened" }).content).toBe("");
});
it("validates excluded records, unique identities and strict backup fields before exporting", () => {
  const workspace = literatureBackupFixture(); workspace.entries[1].paper.metadataUrl = "https://evil.example/private";
  expect(() => exportLiterature({ backup: JSON.stringify(workspace), format: "ris", screening: "include" })).toThrow();
  const duplicate = literatureBackupFixture(); duplicate.entries[1].paper = duplicate.entries[0].paper;
  expect(() => exportLiterature({ backup: JSON.stringify(duplicate), format: "ris" })).toThrow();
  expect(() => exportLiterature({ backup: JSON.stringify({ ...literatureBackupFixture(), authorization: "PRIVATE_TOKEN" }), format: "ris" })).toThrow();
});
it("bounds original UTF-8 bytes including BOM and rejects invalid format/filter without coercion", () => {
  const backup = serializeLiteratureWorkspace(literatureBackupFixture());
  const padding = " ".repeat(MAX_LITERATURE_BYTES - Buffer.byteLength(backup));
  expect(exportLiterature({ backup: backup + padding, format: "ris" }).count).toBe(2);
  expect(() => exportLiterature({ backup: "\uFEFF" + backup + padding, format: "ris" })).toThrow();
  expect(() => exportLiterature({ backup: "🧪".repeat(MAX_LITERATURE_BYTES / 3), format: "ris" })).toThrow();
  for (const extra of [{ format: "csv" }, { screening: "INCLUDE" }, { url: "https://private.example" }])
    expect(() => exportLiterature({ backup, format: "ris", ...extra } as never)).toThrow();
});
