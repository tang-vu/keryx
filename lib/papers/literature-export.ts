import { z } from "zod";
import { MAX_LITERATURE_BYTES, parseLiteratureWorkspace } from "./literature-workspace";
import { paperReferencesBibtex, paperReferencesCslJson, paperReferencesRis } from "./reference-export";

export const literatureExportInput = z.object({
  backup: z.string().max(MAX_LITERATURE_BYTES),
  format: z.enum(["bibtex", "ris", "csl-json"]),
  screening: z.enum(["all", "unscreened", "include", "exclude", "undecided"]).optional(),
}).strict();

/** Caller-selected backup only. Never project private focus, notes or decisions
 * into reference records, or turn saved metadata into reading evidence. */
export function exportLiterature(input: z.infer<typeof literatureExportInput>) {
  const { backup, format, screening = "all" } = literatureExportInput.parse(input);
  if (new TextEncoder().encode(backup).byteLength > MAX_LITERATURE_BYTES) throw new Error("Backup limit exceeded");
  // Validate the complete backup before filtering: invalid excluded records must
  // not be hidden by the caller's view. The parser also checks UTF-8 byte length.
  const workspace = parseLiteratureWorkspace(backup.replace(/^\uFEFF/u, ""));
  const papers = workspace.entries.filter(entry => screening === "all" || entry.screening === screening).map(entry => entry.paper);
  const result = format === "bibtex" ? paperReferencesBibtex(papers) : format === "ris" ? paperReferencesRis(papers) : paperReferencesCslJson(papers);
  return { format, scope: "bibliography-only" as const, count: result.count, content: result.content };
}
