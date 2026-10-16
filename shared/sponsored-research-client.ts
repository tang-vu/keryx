/** Hosted anonymous research only. This module must remain browser-safe and custody-free. */
export type SponsoredResearchInput = {
  question: string;
  mode?: "quick" | "deep";
  budget?: number;
  publicReport: true;
};

export type SponsoredResearchResult = {
  answer: string;
  queryId: string;
  dispatchUrl: string;
  citations: Array<{ sourceName: string; sourceUrl?: string; [key: string]: unknown }>;
  [key: string]: unknown;
};

export type SponsoredResearchOptions = {
  baseUrl?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (text: string) => void;
};

export const SPONSORED_RESEARCH_NOTICE =
  "Keryx pays for admitted hosted sponsored research within service limits. Your question and report become public. Source budget excludes model/search costs; server quotas and pauses apply. " +
  "Reward allocations are not settlement proof. Disconnecting may leave research or payments running; inspect the report before submitting again. No automatic retries.";
export const SPONSORED_RESEARCH_TIMEOUT_MS = 330_000;

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_FRAME_CHARS = 1024 * 1024;
const MAX_ANSWER_CHARS = 128 * 1024;
const MAX_PROGRESS_CHARS = 256 * 1024;
const REPORT_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|a2a_[0-9a-f]{64})$/;
const UNCERTAIN = "The server may still finish research or payments. Inspect the report before submitting again; no request was retried.";

type FailureDetails = {
  code?: string;
  status?: number;
  retryAfter?: string;
  queryId?: string;
  dispatchUrl?: string;
  uncertain?: boolean;
  selectionDiagnostic?: unknown;
};

/** Public diagnostics only; never retains the response, private claims, or caller credentials. */
export class SponsoredResearchError extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly retryAfter?: string;
  readonly queryId?: string;
  readonly dispatchUrl?: string;
  readonly uncertain: boolean;
  readonly selectionDiagnostic?: unknown;

  constructor(message: string, details: FailureDetails = {}) {
    super(message);
    this.name = "SponsoredResearchError";
    this.code = details.code;
    this.status = details.status;
    this.retryAfter = details.retryAfter;
    this.queryId = details.queryId;
    this.dispatchUrl = details.dispatchUrl;
    this.uncertain = details.uncertain ?? false;
    this.selectionDiagnostic = details.selectionDiagnostic;
  }
}

export function sponsoredResearchOrigin(value = "https://keryx.cc"): string {
  const invalid = () => new SponsoredResearchError("baseUrl must be a clean HTTPS origin, or explicit loopback HTTP origin.", { code: "invalid_input" });
  if (typeof value !== "string" || /[\s\u0000-\u001f\u007f\\]/u.test(value)) throw invalid();
  let url: URL;
  try { url = new URL(value); } catch { throw invalid(); }
  const loopback = url.hostname === "localhost" || url.hostname === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback) ||
    url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
    value !== url.origin && value !== `${url.origin}/`) throw invalid();
  return url.origin;
}

export function validateSponsoredResearchInput(input: SponsoredResearchInput): Required<SponsoredResearchInput> {
  if (!input || input.publicReport !== true) {
    throw new SponsoredResearchError("Explicit publicReport:true is required: your question and report become public.", { code: "invalid_input" });
  }
  if (typeof input.question !== "string" || !input.question.trim() || input.question.trim().length > 2000) {
    throw new SponsoredResearchError("question must contain 1 to 2,000 characters.", { code: "invalid_input" });
  }
  const mode = input.mode === undefined ? "deep" : input.mode, budget = input.budget === undefined ? 0.05 : input.budget;
  if (mode !== "quick" && mode !== "deep") throw new SponsoredResearchError("mode must be quick or deep.", { code: "invalid_input" });
  if (typeof budget !== "number" || !Number.isFinite(budget) || budget < 0 || budget > 0.08) {
    throw new SponsoredResearchError("Source budget must be a finite number from 0 to 0.08 USDC.", { code: "invalid_input" });
  }
  return { question: input.question.trim(), mode, budget, publicReport: true };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function plainText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
}

function invalidResponse(message: string, code = "invalid_response"): never {
  throw new SponsoredResearchError(message, { code, uncertain: true });
}

function httpUrl(value: string): string {
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
      !/[\s\u0000-\u001f\u007f\\]/u.test(value)) return value;
  } catch { /* Report the invalid public URL below. */ }
  return invalidResponse("The report contained an unsupported public evidence URL.");
}

function reportUrl(value: unknown, origin: string, id: string): string {
  if (value === `${origin}/dispatch/${id}` || value === `${origin}/ask/${id}`) return value;
  return invalidResponse("The report URL did not match the hosted origin and canonical query ID.");
}

// These are the public fields from keryxMeta/surfaceResearch, not arbitrary vendor extensions.
const PUBLIC_FIELDS = ["citations", "evidence", "readCheckpoints", "provenance", "bibliography", "bibliographyExports",
  "teachingProposals", "sourceRecency", "reasoningAttempts", "reasoning", "outputLimits", "outputLimitTraceStepsOmitted",
  "creatorsPaid", "creatorsPaidAuthority", "creatorsReferenced", "creatorRewardAllocations", "paymentMode", "pendingSpendUsdc",
  "operatingFee", "subClaims", "claimCoverage", "researchExports", "totalToCreators", "engine"] as const;

/** Bounded snapshot of already-public projections; unknown top-level fields never enter it. */
function publicSnapshot(value: unknown): unknown {
  let nodes = 0;
  const copy = (item: unknown, key = "", depth = 0): unknown => {
    if (++nodes > 40_000 || depth > 24) return invalidResponse("The public report exceeded the supported structure size.", "response_too_large");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item === "string") {
      if (item.length > 256 * 1024) return invalidResponse("The public report exceeded the supported text size.", "response_too_large");
      return /url$/i.test(key) ? httpUrl(item) : plainText(item);
    }
    if (Array.isArray(item)) {
      if (item.length > 4096) return invalidResponse("The public report exceeded the supported row count.", "response_too_large");
      return item.map(entry => copy(entry, key === "urls" ? "url" : "", depth + 1));
    }
    const data = record(item);
    if (!data || Object.keys(data).length > 256) return invalidResponse("The public report contained unsupported metadata.");
    const result: Record<string, unknown> = {};
    for (const [name, entry] of Object.entries(data)) {
      if (name.length > 128) return invalidResponse("The public report contained an oversized field name.", "response_too_large");
      if (/private|ticket|account|wallet|credential|secret|authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|claim[_-]?url/i.test(name) ||
        ["__proto__", "constructor", "prototype"].includes(name)) continue;
      result[name] = copy(entry, name, depth + 1);
    }
    return result;
  };
  return copy(value);
}

function terminalResult(meta: Record<string, unknown>, answer: string, origin: string): SponsoredResearchResult {
  const id = meta.queryId;
  if (typeof id !== "string" || !REPORT_ID.test(id)) return invalidResponse("The terminal report lacked a canonical query ID.");
  const dispatchUrl = reportUrl(meta.dispatchUrl, origin, id);
  if (!answer.trim() || !Array.isArray(meta.citations)) return invalidResponse("The terminal report lacked an answer or citations.");
  const fields: Record<string, unknown> = {};
  for (const key of PUBLIC_FIELDS) if (meta[key] !== undefined) fields[key] = meta[key];
  const safe = publicSnapshot(fields) as Record<string, unknown>;
  const citations = (safe.citations as unknown[]).map(value => {
    const citation = record(value);
    if (!citation || typeof citation.sourceName !== "string" || !citation.sourceName.trim() || citation.sourceName.length > 4096) {
      return invalidResponse("The report contained an invalid citation.");
    }
    const sourceUrl = citation.sourceUrl ?? citation.itemUrl ?? record(citation.scholarly)?.recordUrl;
    if (sourceUrl !== undefined && typeof sourceUrl !== "string") return invalidResponse("The report contained an invalid citation URL.");
    return { ...citation, sourceName: citation.sourceName, ...(sourceUrl ? { sourceUrl: httpUrl(sourceUrl) } : {}) };
  });
  const result = { ...safe, answer: plainText(answer), queryId: id, dispatchUrl, citations };
  if (JSON.stringify(result).length > 2 * 1024 * 1024) return invalidResponse("The public report exceeded the supported output size.", "response_too_large");
  return result;
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("aborted"));
    if (signal.aborted) { operation.catch(() => {}); abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function researchSponsored(input: SponsoredResearchInput, options: SponsoredResearchOptions = {}): Promise<SponsoredResearchResult> {
  const fields = validateSponsoredResearchInput(input), origin = sponsoredResearchOrigin(options.baseUrl);
  const controller = new AbortController();
  let timedOut = false, submitted = false;
  let queryId: string | undefined, dispatchUrl: string | undefined;
  let httpStatus: number | undefined, httpRetryAfter: string | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(() => { timedOut = true; abort(); }, SPONSORED_RESEARCH_TIMEOUT_MS);
  try {
    if (controller.signal.aborted) throw new Error("aborted");
    submitted = true;
    const response = await abortable((options.fetch ?? globalThis.fetch)(`${origin}/api/v1/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: "Bearer keryx" },
      credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal,
      body: JSON.stringify({ model: "keryx", stream: true, messages: [{ role: "user", content: fields.question }],
        budget: fields.budget, mode: fields.mode, publicReport: true }),
    }), controller.signal);
    if (response.redirected || response.status >= 300 && response.status < 400) {
      throw new SponsoredResearchError("The hosted endpoint redirected; the request was not retried.", { code: "redirect_refused", status: response.status, uncertain: true });
    }
    const retryAfter = response.headers.get("Retry-After")?.slice(0, 128);
    if (!response.ok) {
      httpStatus = response.status;
      httpRetryAfter = retryAfter;
      let text = "", bytes = 0;
      if (response.body) {
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const chunk = await abortable(reader.read(), controller.signal);
          if (chunk.done) { text += decoder.decode(); break; }
          if ((bytes += chunk.value.byteLength) > 64 * 1024) throw new SponsoredResearchError("The HTTP error body exceeded the supported size.", {
            code: "response_too_large", status: response.status, retryAfter, uncertain: response.status >= 500 && response.status !== 503 });
          text += decoder.decode(chunk.value, { stream: true });
        }
      }
      let body: Record<string, unknown> | undefined;
      try { body = record(JSON.parse(text)); } catch { /* Non-JSON failures still retain HTTP diagnostics. */ }
      const error = record(body?.error), message = error?.message ?? body?.message;
      const code = error?.code ?? (typeof body?.error === "string" ? body.error : undefined);
      const identity = typeof body?.queryId === "string" ? body : error;
      if (typeof identity?.queryId === "string" && REPORT_ID.test(identity.queryId)) {
        queryId = identity.queryId;
        dispatchUrl = `${origin}/dispatch/${queryId}`;
        const reportedUrl = identity.dispatchUrl ?? identity.reportUrl;
        if (reportedUrl !== undefined) dispatchUrl = reportUrl(reportedUrl, origin, queryId);
      }
      throw new SponsoredResearchError(typeof message === "string" ? plainText(message).slice(0, 2000) : `Keryx returned HTTP ${response.status}.`, {
        status: response.status, code: typeof code === "string" ? plainText(code).slice(0, 128) : "http_error",
        retryAfter: retryAfter ?? (typeof body?.retryAfter === "number" && Number.isFinite(body.retryAfter) ? String(body.retryAfter) : undefined),
        uncertain: response.status >= 500 && response.status !== 503,
        ...(error?.selectionDiagnostic ? { selectionDiagnostic: publicSnapshot(error.selectionDiagnostic) } : {}),
      });
    }
    if (response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "text/event-stream" || !response.body) {
      return invalidResponse("Keryx did not return the required research event stream.");
    }
    reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let buffer = "", answer = "", bytes = 0, frames = 0, progressChars = 0, done = false;
    let result: SponsoredResearchResult | undefined;
    const frame = (event: string) => {
      if (++frames > 4096 || event.length > MAX_FRAME_CHARS) return invalidResponse("The research stream exceeded the supported event size/count.", "response_too_large");
      const data = event.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n").trim();
      if (!data) return;
      if (done) return invalidResponse("The research stream contained data after [DONE].");
      if (data === "[DONE]") { done = true; return; }
      let chunk: Record<string, unknown> | undefined;
      try { chunk = record(JSON.parse(data)); } catch { return invalidResponse("The research stream contained an unreadable event."); }
      if (!chunk) return invalidResponse("The research stream contained an invalid event.");
      if (typeof chunk.id === "string") {
        const id = chunk.id.startsWith("chatcmpl-") ? chunk.id.slice(9) : "";
        if (!REPORT_ID.test(id) || queryId && queryId !== id) return invalidResponse("The research stream changed its canonical query ID.");
        queryId = id;
        dispatchUrl ??= `${origin}/dispatch/${id}`;
      }
      const choice = record(Array.isArray(chunk.choices) ? chunk.choices[0] : undefined), delta = record(choice?.delta);
      const content = delta?.content;
      if (chunk.keryx_error || chunk.error || typeof content === "string" && content.trimStart().startsWith("[keryx error]")) {
        const error = record(chunk.keryx_error) ?? record(chunk.error);
        throw new SponsoredResearchError(typeof content === "string" ? plainText(content.replace(/^\s*\[keryx error\]\s*/, "")).slice(0, 2000) :
          typeof error?.message === "string" ? plainText(error.message).slice(0, 2000) : "Research could not finish.", {
          code: typeof error?.code === "string" ? plainText(error.code).slice(0, 128) : "research_failed", uncertain: true,
          ...(error?.selectionDiagnostic ? { selectionDiagnostic: publicSnapshot(error.selectionDiagnostic) } : {}),
        });
      }
      if (result) return invalidResponse("The research stream contained data after the terminal report.");
      if (typeof delta?.reasoning_content === "string") {
        progressChars += delta.reasoning_content.length;
        if (progressChars > MAX_PROGRESS_CHARS) return invalidResponse("The research progress exceeded the supported size.", "response_too_large");
        options.onProgress?.(plainText(delta.reasoning_content));
      }
      if (typeof content === "string") {
        if (answer.length + content.length > MAX_ANSWER_CHARS) return invalidResponse("The research answer exceeded the supported size.", "response_too_large");
        answer += content;
      }
      if (choice?.finish_reason != null) {
        const meta = record(chunk.keryx);
        if (choice.finish_reason !== "stop" || !meta) return invalidResponse("The research stream ended without a complete Keryx report.");
        if (typeof meta.queryId === "string" && REPORT_ID.test(meta.queryId)) {
          if (queryId && meta.queryId !== queryId) return invalidResponse("The terminal report changed the canonical query ID.");
          queryId = meta.queryId;
          dispatchUrl = reportUrl(meta.dispatchUrl, origin, queryId);
        }
        result = terminalResult(meta, answer, origin);
        if (queryId && result.queryId !== queryId) return invalidResponse("The terminal report changed the canonical query ID.");
        queryId = result.queryId;
        dispatchUrl = result.dispatchUrl;
      }
    };
    for (;;) {
      const chunk = await abortable(reader.read(), controller.signal);
      if (!chunk.done && (bytes += chunk.value.byteLength) > MAX_BODY_BYTES) return invalidResponse("The research stream exceeded the supported body size.", "response_too_large");
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        frame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
      if (buffer.length > MAX_FRAME_CHARS) return invalidResponse("The research event exceeded the supported size.", "response_too_large");
      if (chunk.done) { if (buffer.trim()) frame(buffer); break; }
      if (done) { if (buffer.trim()) return invalidResponse("The research stream contained trailing data."); break; }
    }
    if (!done || !result) return invalidResponse("The research stream ended before the terminal report and [DONE].", "incomplete_stream");
    return result;
  } catch (error) {
    const failure = error instanceof SponsoredResearchError ? error : undefined;
    const code = controller.signal.aborted ? timedOut ? "timeout" : "aborted" : failure?.code ?? "transport_error";
    const uncertain = submitted && (controller.signal.aborted || (failure?.uncertain ?? true));
    const message = controller.signal.aborted ? timedOut ? "Watching sponsored research timed out." : "Stopped watching sponsored research." :
      failure?.message ?? "The sponsored research response could not be read.";
    throw new SponsoredResearchError(`${message}${uncertain ? ` ${UNCERTAIN}` : ""}`, {
      code, uncertain, status: failure?.status ?? httpStatus, retryAfter: failure?.retryAfter ?? httpRetryAfter, queryId, dispatchUrl,
      selectionDiagnostic: failure?.selectionDiagnostic,
    });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    // Cancellation is best effort: a peer must not keep this function pending during cleanup.
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    controller.abort();
  }
}
