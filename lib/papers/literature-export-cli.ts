/** Deliberate local input only. No env loader, provider, wallet or network client. */
import { constants } from "node:fs";
import { open, writeFile } from "node:fs/promises";
import { MAX_LITERATURE_BYTES } from "./literature-workspace";
import { exportLiterature } from "./literature-export";

export const usage = "Usage: node --import tsx scripts/export-literature.mts --input library.json --format bibtex|ris|csl-json [--screening all|unscreened|include|exclude|undecided] [--output new-file]";
async function readBackup(path: string) {
  // Nonblocking open prevents a FIFO from hanging before the regular-file check.
  const file = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_LITERATURE_BYTES) throw new Error("input");
    const bytes = Buffer.alloc(MAX_LITERATURE_BYTES + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > MAX_LITERATURE_BYTES) throw new Error("input");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset));
  } finally { await file.close(); }
}

export async function exportLiteratureCli(args: string[]): Promise<string | null> {
  if (args.length === 1 && args[0] === "--help") return usage + "\n";
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!["--input", "--format", "--screening", "--output"].includes(key) || !value || value.startsWith("--") || options.has(key)) throw new Error("usage");
    options.set(key, value);
  }
  const format = options.get("--format"), screening = options.get("--screening");
  if (!options.has("--input") || !["bibtex", "ris", "csl-json"].includes(format ?? "") ||
      (screening !== undefined && !["all", "unscreened", "include", "exclude", "undecided"].includes(screening))) throw new Error("usage");
  const result = exportLiterature({ backup: await readBackup(options.get("--input")!),
    format: format as "bibtex" | "ris" | "csl-json", screening: screening as "all" | "unscreened" | "include" | "exclude" | "undecided" | undefined });
  if (!options.has("--output")) return result.content;
  await writeFile(options.get("--output")!, result.content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return null;
}
