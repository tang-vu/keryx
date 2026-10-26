import { writeFile } from "node:fs/promises";
import { MAX_LITERATURE_BYTES } from "./literature-workspace";
import { readLiteratureFile } from "./literature-file-input";
import { inspectLiterature } from "./literature-inspection";

export const usage = "Usage: node --import tsx scripts/inspect-literature.mts --input library.json [--baseline previous-library.json] [--output new-summary.json]";
export async function inspectLiteratureCli(args: string[]): Promise<string | null> {
  if (args.length === 1 && args[0] === "--help") return usage + "\n";
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!["--input", "--baseline", "--output"].includes(key) || !value || value.startsWith("--") || options.has(key)) throw new Error("usage");
    options.set(key, value);
  }
  if (!options.has("--input")) throw new Error("usage");
  const backup = await readLiteratureFile(options.get("--input")!, MAX_LITERATURE_BYTES);
  const baselineBackup = options.has("--baseline") ? await readLiteratureFile(options.get("--baseline")!, MAX_LITERATURE_BYTES) : undefined;
  const result = inspectLiterature({ backup, baselineBackup });
  const content = JSON.stringify(result, null, 2) + "\n";
  if (!options.has("--output")) return content;
  await writeFile(options.get("--output")!, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return null;
}
