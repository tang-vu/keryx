import { z } from "zod";
import { MAX_LITERATURE_BYTES, MAX_SAVED_PAPERS } from "./literature-workspace";
import { paperReferencesBibtex, paperReferencesCslJson, paperReferencesRis } from "./reference-export";
import { paperHttpsUrlSchema } from "./types";
import { parseValidatedLiteratureBackup } from "./literature-backup";

export const literaturePaperSelection = z.array(paperHttpsUrlSchema).max(MAX_SAVED_PAPERS)
  .refine(urls => new Set(urls).size === urls.length, "Duplicate selected paper");

export const literatureExportInput = z.object({
  backup: z.string().max(MAX_LITERATURE_BYTES),
  format: z.enum(["bibtex", "ris", "csl-json"]),
  screening: z.enum(["all", "unscreened", "include", "exclude", "undecided"]).optional(),
  paperUrls: literaturePaperSelection.optional(),
}).strict();

/** Caller-selected backup only. Never project private focus, notes or decisions
 * into reference records, or turn saved metadata into reading evidence. */
export function exportLiterature(input: z.infer<typeof literatureExportInput>) {
  const { backup, format, screening = "all", paperUrls } = literatureExportInput.parse(input);
  const workspace = parseValidatedLiteratureBackup(backup);
  const byUrl = new Map(workspace.entries.map(entry => [entry.paper.url, entry]));
  const selected = paperUrls === undefined ? workspace.entries : paperUrls.map(url => {
    const entry = byUrl.get(url);
    if (!entry) throw new Error("Selected paper unavailable");
    return entry;
  });
  const papers = selected.filter(entry => screening === "all" || entry.screening === screening).map(entry => entry.paper);
  const result = format === "bibtex" ? paperReferencesBibtex(papers) : format === "ris" ? paperReferencesRis(papers) : paperReferencesCslJson(papers);
  return { format, scope: "bibliography-only" as const, count: result.count, content: result.content };
}
