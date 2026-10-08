import { spawn } from "node:child_process";
import path from "node:path";
import { parse } from "parse5";
import { z } from "zod";
import { acquireParserSlot } from "../web-research/parser-slots";
import { BibliographicOriginalError } from "./bibliographic-original-types";

const unitSchema = z.object({
  value: z.string().max(1200).optional(), overBound: z.literal(true).optional(), unavailable: z.literal("hidden").optional(), path: z.string().max(200),
  start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), rawExcerpt: z.string().max(1600).optional(),
}).strict().refine(unit => Number(unit.value !== undefined) + Number(unit.overBound === true) + Number(unit.unavailable !== undefined) === 1,
  "Exactly one observed value, bound failure or unavailable slot");
const pageSchema = z.object({ metadata: z.record(z.enum(["citation_title", "citation_author", "citation_arxiv_id", "citation_date", "citation_doi", "citation_journal_title", "citation_publication_status"]), z.array(unitSchema).max(150)), versions: z.array(unitSchema).max(150),
  titles: z.array(unitSchema).max(150), statuses: z.array(unitSchema).max(150) }).strict();
export type ArxivBibliographicUnit = z.infer<typeof unitSchema>;

/** Separate child and shared parser admission, matching ordinary HTML extraction
 * containment. The returned observations have no evidence or payout capability. */
export async function observeArxivBibliographicPage(html: string, signal?: AbortSignal) {
  if (typeof parse !== "function" || Buffer.byteLength(html, "utf8") > 250000) throw new BibliographicOriginalError("invalid-metadata-read");
  if (signal?.aborted) throw new DOMException("Metadata read cancelled", "AbortError");
  const release = acquireParserSlot();
  try {
    return await new Promise<z.infer<typeof pageSchema>>((resolve, reject) => {
      const child = spawn(process.execPath, ["--max-old-space-size=64", path.join(process.cwd(), "lib/research/arxiv-bibliography-worker.mjs")],
        { windowsHide: true, env: { NODE_ENV: "production" }, stdio: ["pipe", "pipe", "ignore"] });
      let output = "", bytes = 0, failed = false;
      const stop = () => { failed = true; child.kill("SIGKILL"); };
      const timer = setTimeout(stop, 2000);
      signal?.addEventListener("abort", stop, { once: true });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { bytes += Buffer.byteLength(chunk, "utf8"); if (bytes > 200000) stop(); else output += chunk; });
      child.on("error", stop); child.stdin.on("error", stop);
      child.on("close", code => {
        clearTimeout(timer); signal?.removeEventListener("abort", stop); release();
        if (signal?.aborted) { reject(new DOMException("Metadata read cancelled", "AbortError")); return; }
        try {
          if (failed || code !== 0) throw new Error();
          const page = pageSchema.parse(JSON.parse(output));
          const units = [...Object.values(page.metadata).flat(), ...page.versions, ...page.titles, ...page.statuses];
          if (units.length > 150 || units.some(unit => unit.end <= unit.start || unit.end > html.length ||
            (unit.end - unit.start <= 1600 || unit.rawExcerpt !== undefined) && unit.rawExcerpt !== html.slice(unit.start, unit.end))) throw new Error();
          resolve(page);
        } catch { reject(new BibliographicOriginalError("invalid-metadata-read")); }
      });
      child.stdin.end(JSON.stringify(html));
    });
  } finally { release(); }
}
