import { createHash, randomUUID } from "node:crypto";

import { fetchPublicBytes } from "../net/public-fetch";
import { parseSourceRecencyFeed, SOURCE_RECENCY_FEED_LIMITS, sourceRecencyFeedUrl,
  type ParsedSourceRecencyFeed } from "./source-recency-feed-parser";

export interface SourceRecencyFeedRequestScope {
  readonly scope: "current-feed";
  readonly sourceId: string;
  readonly feedUrl: string;
}
declare const observedFeedBrand: unique symbol;
export interface SourceRecencyFeedObservation extends ParsedSourceRecencyFeed {
  readonly [observedFeedBrand]: true;
  readonly requestScope: Readonly<SourceRecencyFeedRequestScope & { runId: string }>;
  readonly readStartedAt: string;
  readonly capturedAt: string;
  readonly finalUrl: string;
  readonly rawBodySha256: string;
  readonly rawByteCount: number;
  readonly observationDigest: string;
}
const observations = new WeakSet<SourceRecencyFeedObservation>();
const XML_TYPES = ["application/atom+xml", "application/rss+xml", "application/xml", "text/xml"];
/** Serialized snapshots, parser results, proxies and legacy getItems arrays are not observations. */
export function isObservedSourceRecencyFeed(value: unknown): value is SourceRecencyFeedObservation {
  return typeof value === "object" && value !== null && observations.has(value as SourceRecencyFeedObservation);
}
export type SourceRecencyFeedRead = Readonly<{ status: "observed"; observation: SourceRecencyFeedObservation }> |
  Readonly<{ status: "withheld"; reason: "request-scope-unqualified" | "read-cap-exhausted" | "duplicate-probe" |
    "cancelled" | "feed-read-failed" | "feed-document-unqualified" }>;
export interface SourceRecencyFeedObserver {
  readonly runId: string;
  readonly maxReads: number;
  readonly readsUsed: number;
  observe(scope: SourceRecencyFeedRequestScope, options?: { signal?: AbortSignal }): Promise<SourceRecencyFeedRead>;
}

/**
 * Create once at the trusted run boundary. The caller grants from its existing public-read cap;
 * this does not add an allowance. One request per exact feed, including failed probes, consumes
 * one granted read. No refresh, persistence, credential, model or payment path is invoked.
 */
export function createSourceRecencyFeedObserver(options: { maxReads?: number } = {}): SourceRecencyFeedObserver {
  const maxReads = options.maxReads ?? 1;
  if (!Number.isInteger(maxReads) || maxReads < 0 || maxReads > 4) throw new Error("Invalid feed read grant");
  const runId = randomUUID(), seen = new Set<string>();
  let readsUsed = 0;
  return Object.freeze({ runId, maxReads, get readsUsed() { return readsUsed; },
    async observe(scope: SourceRecencyFeedRequestScope, { signal }: { signal?: AbortSignal } = {}): Promise<SourceRecencyFeedRead> {
      const withheld = (reason: Extract<SourceRecencyFeedRead, { status: "withheld" }>["reason"]): SourceRecencyFeedRead => Object.freeze({ status: "withheld", reason });
      const feedUrl = scope && sourceRecencyFeedUrl(scope.feedUrl);
      if (!scope || scope.scope !== "current-feed" || typeof scope.sourceId !== "string" ||
        !scope.sourceId || scope.sourceId.length > 200 || !scope.sourceId.isWellFormed() ||
        /[\u0000-\u001f\u007f]/u.test(scope.sourceId) || !feedUrl) return withheld("request-scope-unqualified");
      const sourceId = scope.sourceId;
      if (signal?.aborted) return withheld("cancelled");
      if (seen.has(feedUrl)) return withheld("duplicate-probe");
      if (readsUsed >= maxReads) return withheld("read-cap-exhausted");
      // Reserve synchronously, before the first await; concurrent requests cannot overrun a grant.
      readsUsed++; seen.add(feedUrl);
      const readStartedAt = new Date().toISOString(), ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => ctrl.abort(), SOURCE_RECENCY_FEED_LIMITS.timeoutMs);
      let phase: "read" | "parse" = "read";
      try {
        const limits = { maxBytes: SOURCE_RECENCY_FEED_LIMITS.maxBytes,
          timeoutMs: SOURCE_RECENCY_FEED_LIMITS.timeoutMs, maxHops: SOURCE_RECENCY_FEED_LIMITS.maxHops,
          signal: ctrl.signal, allowedContentTypes: [...XML_TYPES], requireFullResponse: true };
        const response = await fetchPublicBytes(feedUrl, limits);
        if (ctrl.signal.aborted) return withheld("cancelled");
        phase = "parse";
        if (response.finalUrl !== feedUrl || !XML_TYPES.includes(response.contentType) || response.bytes.byteLength > SOURCE_RECENCY_FEED_LIMITS.maxBytes)
          return withheld("feed-document-unqualified");
        const xml = new TextDecoder("utf-8", { fatal: true }).decode(response.bytes);
        const parsed = await parseSourceRecencyFeed(xml, ctrl.signal);
        if (parsed.declaredSelfUrls.some(url => sourceRecencyFeedUrl(url) !== feedUrl)) return withheld("feed-document-unqualified");
        if (ctrl.signal.aborted) return withheld("cancelled");
        const body = { ...parsed, requestScope: Object.freeze({ scope: "current-feed" as const,
          sourceId, feedUrl, runId }), readStartedAt, capturedAt: new Date().toISOString(),
          finalUrl: response.finalUrl, rawBodySha256: createHash("sha256").update(response.bytes).digest("hex"),
          rawByteCount: response.bytes.byteLength };
        const observation = Object.freeze({ ...body, observationDigest:
          `sha256:${createHash("sha256").update(JSON.stringify(body)).digest("hex")}` }) as SourceRecencyFeedObservation;
        observations.add(observation);
        return Object.freeze({ status: "observed", observation });
      } catch {
        return withheld(ctrl.signal.aborted ? "cancelled" : phase === "read" ? "feed-read-failed" : "feed-document-unqualified");
      } finally {
        clearTimeout(timer); signal?.removeEventListener("abort", onAbort);
      }
    },
  });
}
