import { spawn } from "node:child_process";
import path from "node:path";
import type { ArticleRead } from "./article-reader";
import { acquireParserSlot } from "./parser-slots";
import { parse } from "parse5";
import { observeHtmlTextLayout } from "./html-text-layout";

export async function extractHtml(text: string, finalUrl: string, signal?: AbortSignal): Promise<ArticleRead> {
  // Keep this external package visible to Next's dependency tracer; DOM construction and
  // untrusted parsing remain exclusively in the child. It also fails closed on missing runtime.
  if (typeof parse !== "function" || Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024 || finalUrl.length > 4096) throw new Error("HTML parser unavailable");
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const release = acquireParserSlot();
  try { return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--max-old-space-size=64", path.join(process.cwd(), "lib/web-research/html-reader-worker.mjs")],
      { windowsHide: true, env: { NODE_ENV: "production" }, stdio: ["pipe", "pipe", "ignore"] });
    let output = "", size = 0, failed = false;
    const stop = () => { failed = true; child.kill("SIGKILL"); };
    const timer = setTimeout(stop, 4000);
    signal?.addEventListener("abort", stop, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { size += Buffer.byteLength(chunk); if (size > 400000) stop(); else output += chunk; });
    child.on("error", stop); child.stdin.on("error", stop);
    child.on("close", code => {
      clearTimeout(timer); signal?.removeEventListener("abort", stop);
      release();
      if (signal?.aborted) { reject(new DOMException("Cancelled", "AbortError")); return; }
      try {
        if (failed || code !== 0) throw new Error();
        const result = JSON.parse(output) as ArticleRead;
        if (typeof result.text !== "string" || result.text.length > 60000 || !result.text.trim() ||
          typeof result.title !== "string" || result.title.length > 200 || result.finalUrl !== finalUrl || result.kind !== "html" || typeof result.truncated !== "boolean") throw new Error();
        resolve({ ...result, htmlTextLayout: observeHtmlTextLayout(result.text, result.htmlTextLayout) });
      } catch { reject(new Error("HTML extraction unavailable")); }
    });
    child.stdin.end(JSON.stringify({ text, finalUrl }));
  }); } finally { release(); }
}
