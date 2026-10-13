import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workers = {
  html: ["web-research", "html-reader-worker.mjs"],
  pdf: ["web-research", "pdf-reader-worker.mjs"],
  bibliography: ["research", "arxiv-bibliography-worker.mjs"],
} as const;

/** Code follows this loaded module (source or compiled server chunk), never the
 * storage cwd or an ENV-selected release. Next's trace includes these assets. */
export function extractionWorker(kind: keyof typeof workers): string {
  const parts = workers[kind];
  if (!parts) throw new Error("Extraction worker binding unavailable");
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth++) {
    const manifest = path.join(directory, "package.json");
    let sourceRoot = false;
    try {
      const stat = lstatSync(manifest);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error("Extraction worker binding unavailable");
      sourceRoot = typeof JSON.parse(readFileSync(manifest, "utf8")).name === "string";
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (!sourceRoot) { directory = path.dirname(directory); continue; }
    const file = path.join(directory, "lib", ...parts);
    try {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
          realpathSync.native(file) !== file) throw new Error("Extraction worker binding unavailable");
      return file;
    } catch (error) {
      // Once the loaded package root is found, a missing/unsafe asset cannot
      // fall through to a sibling or predecessor package.
      throw new Error("Extraction worker binding unavailable", { cause: error });
    }
  }
  throw new Error("Extraction worker binding unavailable");
}
