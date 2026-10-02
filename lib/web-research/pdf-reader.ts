import { spawn } from "node:child_process";
import path from "node:path";
import { acquireParserSlot } from "./parser-slots";

export interface PdfExtractionOptions {
  signal?: AbortSignal;
  maxPages: number;
  maxChars: number;
  timeoutMs: number;
}

export interface PdfExtraction {
  text: string;
  pagesRead: number;
  totalPages: number;
  truncated: boolean;
}

const MAX_BYTES = 2 * 1024 * 1024;
const failure = () => new Error("PDF text extraction failed");
const cancelled = () => new DOMException("PDF extraction cancelled", "AbortError");

/** Parse untrusted PDF bytes in a disposable process with no inherited secrets. */
export async function extractPdfText(bytes: Uint8Array, options: PdfExtractionOptions): Promise<PdfExtraction> {
  if (options.signal?.aborted) throw cancelled();
  if (!bytes.length || bytes.length > MAX_BYTES ||
      !Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 100 ||
      !Number.isInteger(options.maxChars) || options.maxChars < 1 || options.maxChars > 200_000 ||
      !Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 60_000) throw failure();

  return new Promise((resolve, reject) => {
    let release: () => void;
    try { release = acquireParserSlot(); } catch { reject(failure()); return; }
    const worker = path.join(process.cwd(), "lib", "web-research", "pdf-reader-worker.mjs");
    let child: ReturnType<typeof spawn>;
    try { child = spawn(process.execPath, ["--max-old-space-size=64", worker,
      String(options.maxPages), String(options.maxChars)], {
      windowsHide: true,
      env: { NODE_ENV: "production" },
      stdio: ["pipe", "pipe", "ignore"],
    }); } catch { release(); reject(failure()); return; }
    let output = "";
    let outputBytes = 0;
    let error: Error | undefined;
    let settled = false;
    const stop = (reason: Error) => {
      error ??= reason;
      child.kill("SIGKILL");
    };
    const abort = () => stop(cancelled());
    const timer = setTimeout(() => stop(failure()), options.timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    const finish = (reason?: Error) => {
      if (settled) return;
      settled = true;
      release();
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (reason) { reject(reason); return; }
      try {
        const value: PdfExtraction = JSON.parse(output);
        if (typeof value.text !== "string" || !value.text.trim() || value.text.length > options.maxChars ||
            !Number.isInteger(value.pagesRead) || value.pagesRead < 1 || value.pagesRead > options.maxPages ||
            !Number.isInteger(value.totalPages) || value.totalPages < value.pagesRead ||
            typeof value.truncated !== "boolean") throw failure();
        resolve(value);
      } catch { reject(failure()); }
    };
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk, "utf8");
      if (outputBytes > options.maxChars * 6 + 2048) { stop(failure()); return; }
      output += chunk;
    });
    child.on("error", () => finish(error ?? failure()));
    child.on("close", (code) => finish(error ?? (code === 0 ? undefined : failure())));
    child.stdin!.on("error", () => stop(failure()));
    child.stdin!.end(bytes);
    if (options.signal?.aborted) abort();
  });
}
