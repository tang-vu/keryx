import { spawn } from "node:child_process";
import { extractionWorker } from "./extraction-worker";
import type { ArticleRead } from "./article-reader";
import { acquireParserSlot } from "./parser-slots";
import { parse } from "parse5";
import { observeHtmlTextLayout } from "./html-text-layout";
import { observedHtmlSectionScope } from "./html-section-scope";
import { createHash } from "node:crypto";
import { rememberExtractionFailure, type ExtractionDiagnostic } from "./extraction-failure";

function failure(message: string, reason: ExtractionDiagnostic["reason"]) {
  const error = new Error(message); rememberExtractionFailure(error, { format: "html", reason }); return error;
}

export async function extractHtml(text: string, finalUrl: string, signal?: AbortSignal, fragment?: string): Promise<ArticleRead> {
  // Keep this external package visible to Next's dependency tracer; DOM construction and
  // untrusted parsing remain exclusively in the child. It also fails closed on missing runtime.
  if (typeof parse !== "function") throw failure("HTML parser unavailable", "runtime-unavailable");
  if (Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024 || finalUrl.length > 4096) throw failure("HTML parser unavailable", "input-rejected");
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  let release: () => void;
  try { release = acquireParserSlot(); } catch (error) { rememberExtractionFailure(error, { format: "html", reason: "parser-busy" }); throw error; }
  try { return await new Promise((resolve, reject) => {
    let worker: string;
    try { worker = extractionWorker("html"); } catch (error) { rememberExtractionFailure(error, { format: "html", reason: "worker-binding" }); throw error; }
    let child: ReturnType<typeof spawn>;
    try { child = spawn(process.execPath, ["--max-old-space-size=64", worker],
      { windowsHide: true, env: { NODE_ENV: "production" }, stdio: ["pipe", "pipe", "ignore"] }); }
    catch (error) { rememberExtractionFailure(error, { format: "html", reason: "worker-start" }); throw error; }
    let output = "", size = 0, failed = false;
    let reason: ExtractionDiagnostic["reason"] | undefined;
    const stop = (observed?: ExtractionDiagnostic["reason"]) => { failed = true; reason ??= observed; child.kill("SIGKILL"); };
    const abort = () => stop();
    const timer = setTimeout(() => stop("deadline"), 4000);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => { size += Buffer.byteLength(chunk); if (size > 400000) stop("output-limit"); else output += chunk; });
    child.on("error", () => stop("worker-start")); child.stdin!.on("error", () => stop("worker-io"));
    child.on("close", code => {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      release();
      if (signal?.aborted) { reject(new DOMException("Cancelled", "AbortError")); return; }
      if (failed || code !== 0) { reject(failure("HTML extraction unavailable", reason ?? "worker-exit")); return; }
      try {
        const result = JSON.parse(output) as ArticleRead;
        if (typeof result.text !== "string" || result.text.length > 60000 || !result.text.trim() ||
          typeof result.title !== "string" || result.title.length > 200 || result.finalUrl !== finalUrl || result.kind !== "html" || typeof result.truncated !== "boolean") throw new Error();
        const scope = observedHtmlSectionScope(result.htmlSectionScope);
        if (fragment !== undefined ? !scope || scope.fragment !== fragment || scope.documentCharacters !== text.length ||
          scope.documentSha256 !== createHash("sha256").update(text, "utf8").digest("hex") || !result.truncated : result.htmlSectionScope !== undefined) throw new Error();
        resolve({ ...result, ...(scope ? { htmlSectionScope: scope } : {}), htmlTextLayout: observeHtmlTextLayout(result.text, result.htmlTextLayout) });
      } catch { reject(failure("HTML extraction unavailable", "invalid-output")); }
    });
    child.stdin!.end(JSON.stringify({ text, finalUrl, fragment }));
  }); } finally { release(); }
}
