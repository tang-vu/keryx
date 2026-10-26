/** Deliberate local input only. No env loader, provider, wallet or network client. */
import { writeFile } from "node:fs/promises";
import { MAX_LITERATURE_BYTES } from "./literature-workspace";
import { exportLiterature, literaturePaperSelection } from "./literature-export";
import { readLiteratureFile } from "./literature-file-input";

export const MAX_LITERATURE_SELECTION_BYTES = 65_536;
export const usage = "Usage: node --import tsx scripts/export-literature.mts --input library.json --format bibtex|ris|csl-json [--screening all|unscreened|include|exclude|undecided] [--selection selected-urls.json] [--output new-file]";

export async function exportLiteratureCli(args: string[]): Promise<string | null> {
  if (args.length === 1 && args[0] === "--help") return usage + "\n";
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!["--input", "--format", "--screening", "--selection", "--output"].includes(key) || !value || value.startsWith("--") || options.has(key)) throw new Error("usage");
    options.set(key, value);
  }
  const format = options.get("--format"), screening = options.get("--screening");
  if (!options.has("--input") || !["bibtex", "ris", "csl-json"].includes(format ?? "") ||
      (screening !== undefined && !["all", "unscreened", "include", "exclude", "undecided"].includes(screening))) throw new Error("usage");
  const paperUrls = options.has("--selection")
    ? literaturePaperSelection.parse(JSON.parse(await readLiteratureFile(options.get("--selection")!, MAX_LITERATURE_SELECTION_BYTES))) : undefined;
  const result = exportLiterature({ backup: await readLiteratureFile(options.get("--input")!, MAX_LITERATURE_BYTES), paperUrls,
    format: format as "bibtex" | "ris" | "csl-json", screening: screening as "all" | "unscreened" | "include" | "exclude" | "undecided" | undefined });
  if (!options.has("--output")) return result.content;
  await writeFile(options.get("--output")!, result.content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return null;
}
